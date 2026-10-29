// The router lab: a MikroTik Cloud Hosted Router (CHR) in QEMU, standing in for a venue's router
// so onboarding, provisioning and verification run against real RouterOS without hardware.
// Procedure and topology: docs/runbooks/router-lab.md.
//
// bun run lab <up|down|reset|status|console|bootstrap|setup|verify>

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RouterCredentials } from "../apps/api/src/services/mikrotik.js";
import { RouterLogger } from "../apps/api/src/services/router-log.js";
import { buildBootstrapScript } from "../apps/api/src/services/router-provision/bootstrap.js";
import {
  buildHotspotPlan,
  resolveBackendUrl,
} from "../apps/api/src/services/router-provision/context.js";
import { dialectFor } from "../apps/api/src/services/router-provision/dialect.js";
import {
  PORTAL_FILES,
  type PortalFileName,
  renderPortalFile,
} from "../apps/api/src/services/router-provision/portal-files.js";
import { probeRouterMerged } from "../apps/api/src/services/router-provision/probe.js";
import { setupRouter } from "../apps/api/src/services/router-provision/setup.js";
import type { RouterRow, RouterStore } from "../apps/api/src/services/router-provision/store.js";
import { probeVerify } from "../apps/api/src/services/router-provision/verify.js";

const ROOT = resolve(import.meta.dir, "..");
const LAB = join(ROOT, "data", "router-lab");
const ROS_VERSION = "7.25";
const BASE_IMAGE = join(LAB, `chr-${ROS_VERSION}.img`);
const OVERLAY = join(LAB, "lab.qcow2");
const SERIAL = join(LAB, "serial.sock");
const MONITOR = join(LAB, "monitor.sock");
const PID_FILE = join(LAB, "qemu.pid");
const STATE_FILE = join(LAB, "state.json");

/** The lab venue LAN is QEMU's user network: the host is the "ISP router" at 10.0.2.2. */
const LAN = { routerIp: "10.0.2.15", prefix: 24, gatewayIp: "10.0.2.2" } as const;
/** Host ports forwarded to the router's RouterOS API, SSH and WinBox. */
const FORWARD = { api: 18728, ssh: 18022, winbox: 18291 } as const;
/** The host side of 10.0.2.2:8080, where the router fetches its portal pages. */
const BACKEND_PORT = 8080;
const BACKEND_URL = `http://${LAN.gatewayIp}:${BACKEND_PORT}`;
const ROUTER_ID = "lab-router";
const API_USER = "hashifi";

interface LabState {
  adminPassword: string | null;
  apiPassword: string | null;
  capabilities: unknown;
}

function readState(): LabState {
  if (!existsSync(STATE_FILE))
    return { adminPassword: null, apiPassword: null, capabilities: null };
  return JSON.parse(readFileSync(STATE_FILE, "utf8")) as LabState;
}

function writeState(state: LabState): void {
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function randomPassword(length: number): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

// ── QEMU ──────────────────────────────────────────────────────────────────────

function qemuPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

async function up(): Promise<void> {
  if (qemuPid() !== null) {
    console.log("Router lab is already running.");
    return;
  }
  if (!existsSync(BASE_IMAGE)) {
    throw new Error(
      `Missing ${BASE_IMAGE}. Download and verify the CHR image first (docs/runbooks/router-lab.md).`,
    );
  }
  mkdirSync(LAB, { recursive: true });
  if (!existsSync(OVERLAY)) {
    run(["qemu-img", "create", "-q", "-f", "qcow2", "-b", BASE_IMAGE, "-F", "raw", OVERLAY]);
  }
  const forwards = [
    `hostfwd=tcp:127.0.0.1:${FORWARD.api}-:8728`,
    `hostfwd=tcp:127.0.0.1:${FORWARD.ssh}-:22`,
    `hostfwd=tcp:127.0.0.1:${FORWARD.winbox}-:8291`,
  ].join(",");
  run([
    "qemu-system-x86_64",
    "-name",
    "hashifi-router-lab",
    "-enable-kvm",
    "-m",
    "256",
    "-smp",
    "1",
    "-drive",
    `file=${OVERLAY},if=virtio,format=qcow2`,
    // ether1: the venue LAN, uplink to the "ISP router".
    "-netdev",
    `user,id=lan,net=10.0.2.0/${LAN.prefix},host=${LAN.gatewayIp},${forwards}`,
    "-device",
    "virtio-net-pci,netdev=lan,mac=52:54:00:4a:00:01",
    // ether2: the guest network, a multicast segment a client VM can join.
    "-netdev",
    "socket,id=guests,mcast=230.0.0.1:18100",
    "-device",
    "virtio-net-pci,netdev=guests,mac=52:54:00:4a:00:02",
    "-display",
    "none",
    "-serial",
    `unix:${SERIAL},server=on,wait=off`,
    "-monitor",
    `unix:${MONITOR},server=on,wait=off`,
    "-pidfile",
    PID_FILE,
    "-daemonize",
  ]);
  const serial = await SerialConsole.open();
  await serial.waitFor(/Login:\s*$/, 120_000);
  serial.close();
  console.log(`Router lab is up: RouterOS ${ROS_VERSION}, API on 127.0.0.1:${FORWARD.api}.`);
}

function down(): void {
  const pid = qemuPid();
  if (pid === null) {
    console.log("Router lab is not running.");
    return;
  }
  process.kill(pid, "SIGTERM");
  console.log("Router lab stopped.");
}

async function reset(): Promise<void> {
  down();
  await Bun.sleep(1000);
  rmSync(OVERLAY, { force: true });
  rmSync(STATE_FILE, { force: true });
  await up();
}

function run(cmd: string[]): void {
  const result = Bun.spawnSync(cmd, { stdout: "inherit", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`${cmd[0]} failed: ${result.stderr.toString().trim()}`);
  }
}

// ── Serial console ────────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips the terminal's ANSI escape sequences
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]|\x1b[=>]|\r/g;

/** The router's serial console, driven the way an operator would type into a terminal. */
class SerialConsole {
  private buffer = "";
  private socket: Bun.Socket<undefined> | null = null;

  static async open(): Promise<SerialConsole> {
    const serial = new SerialConsole();
    serial.socket = await Bun.connect({
      unix: SERIAL,
      socket: {
        data: (_socket, data) => {
          serial.buffer += data.toString("utf8");
        },
      },
    });
    return serial;
  }

  send(text: string): void {
    this.socket?.write(text);
  }

  close(): void {
    this.socket?.end();
  }

  /** Waits until the cleaned output matches, and returns everything received until then. */
  async waitFor(pattern: RegExp, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const text = this.buffer.replace(ANSI, "");
      if (pattern.test(text)) {
        this.buffer = "";
        return text;
      }
      await Bun.sleep(50);
    }
    const tail = this.buffer.replace(ANSI, "").slice(-300);
    throw new Error(
      `Timed out waiting for ${pattern} on the serial console. Last output:\n${tail}`,
    );
  }

  /**
   * Logs in as admin, answering first-login prompts. Tries each candidate password in turn,
   * and sets `newPassword` when RouterOS insists on a change.
   */
  async login(candidates: string[], newPassword: string): Promise<void> {
    const remaining = [...candidates];
    this.send("\r");
    for (let i = 0; i < 20; i++) {
      const text = await this.waitFor(
        /(Login:|Password:|\[Y\/n\]:|-- press Enter \(q to abort\)|repeat new password>|new password>|\[admin@[^\]]+\] >)\s*$/,
        60_000,
      );
      if (/\[admin@[^\]]+\] >\s*$/.test(text)) return;
      if (/Login:\s*$/.test(text)) {
        if (/incorrect username or password/.test(text) && remaining.length === 0) {
          throw new Error("Serial login failed with every known admin password");
        }
        this.send("admin\r");
      } else if (/Password:\s*$/.test(text)) {
        this.send(`${remaining.shift() ?? ""}\r`);
      } else if (/\[Y\/n\]:\s*$/.test(text)) {
        this.send("n");
      } else if (/press Enter/.test(text)) {
        this.send("q");
      } else {
        this.send(`${newPassword}\r`);
      }
    }
    throw new Error("Serial login did not reach a prompt");
  }

  /** Runs one console statement and returns its output, failing on a RouterOS error. */
  async exec(statement: string, timeoutMs = 60_000): Promise<string> {
    let output = "";
    this.send(`${statement}\r`);
    // Long output opens RouterOS's pager, which would swallow anything typed next: page on with
    // space until the command returns to the prompt. (Its D writes the rest to a file instead.)
    for (;;) {
      const text = await this.waitFor(/(-- \[Q quit\|D dump\|down\]|\] >)\s*$/, timeoutMs);
      output += text;
      if (!/-- \[Q quit\|D dump\|down\]\s*$/.test(text)) break;
      this.send(" ");
    }
    // The prompt can also be a redraw before the command finishes; a marker proves it has.
    const marker = `LAB-DONE-${crypto.randomUUID().slice(0, 8)}`;
    this.send(`:put "${marker}"\r`);
    const rest = await this.waitFor(new RegExp(`\\n${marker}\\n[\\s\\S]*\\] >\\s*$`), timeoutMs);
    output += rest.slice(0, rest.lastIndexOf(`\n${marker}`));
    if (
      /(syntax error|failure:|bad command name|expected end of command|no such item)/i.test(output)
    ) {
      throw new Error(`RouterOS rejected: ${statement.slice(0, 120)}\n${output.trim()}`);
    }
    return output;
  }
}

// ── Onboarding (docs: apps/api/mikrotik-knowledge-files/ROUTER_ONBOARDING.md) ─────────────────

async function bootstrap(): Promise<void> {
  const state = readState();
  const adminPassword = state.adminPassword ?? randomPassword(20);
  const apiPassword = randomPassword(24);
  const serial = await SerialConsole.open();

  // Step 1: reset to no defaults, as the onboarding procedure requires.
  await serial.login([adminPassword, ""], adminPassword);
  serial.send("/system reset-configuration no-defaults=yes skip-backup=yes\r");
  await serial.waitFor(/\[y\/N\]:\s*$/, 30_000);
  serial.send("y");
  await serial.waitFor(/Login:\s*$/, 180_000);

  // Step 2: paste the generated bootstrap script, one statement at a time.
  await serial.login(["", adminPassword], adminPassword);
  const { script, resolved } = buildBootstrapScript({
    routerName: "hashifi-lab",
    ipAddress: LAN.routerIp,
    lanPrefix: LAN.prefix,
    gatewayIp: LAN.gatewayIp,
    apiUsername: API_USER,
    apiPassword,
  });
  const statements = script
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trimStart().startsWith("#"));
  for (const statement of statements) {
    const output = await serial.exec(statement);
    // Keep what the statement printed; drop the console's echo and prompt redraws.
    const shown = output
      .split("\n")
      .filter((line) => !line.includes("] >") && !line.includes("LAB-DONE"))
      .join("\n")
      .trim();
    console.log(`✓ ${statement.slice(0, 90)}${statement.length > 90 ? " …" : ""}`);
    if (shown) console.log(`    ${shown.replaceAll("\n", "\n    ")}`);
  }
  serial.close();
  writeState({ ...state, adminPassword, apiPassword: resolved.apiPassword });
  console.log(`Bootstrap applied: ${statements.length} statements, API user "${API_USER}".`);
}

// ── Setup and verification through the real provisioning code ────────────────

function labCredentials(state: LabState): RouterCredentials {
  if (!state.apiPassword) throw new Error("Run `bun run lab bootstrap` first.");
  return { host: "127.0.0.1", port: FORWARD.api, username: API_USER, password: state.apiPassword };
}

function labRouter(state: LabState): RouterRow {
  const now = new Date();
  return {
    id: ROUTER_ID,
    venueId: "lab-venue",
    name: "hashifi-lab",
    model: null,
    identity: null,
    ipAddress: LAN.routerIp,
    hotspotGatewayIp: null,
    macAddress: null,
    apiUsername: API_USER,
    apiPasswordEncrypted: null,
    enablePppoe: false,
    enableHotspot: true,
    pppoeSecretEncrypted: null,
    hotspotName: null,
    // CHR has no radio: the hotspot runs on the guest-side ethernet port.
    hotspotInterface: "ether2",
    ssid: null,
    networkRange: null,
    provisioningCommand: null,
    provisionedAt: null,
    rosVersion: null,
    architecture: null,
    capabilities: state.capabilities,
    lastProvisionReport: null,
    lastSeenAt: null,
    uptimeSeconds: 0,
    connectedDevices: 0,
    status: "offline",
    createdAt: now,
    updatedAt: now,
  };
}

function labStore(): RouterStore {
  return {
    async load(routerId) {
      return routerId === ROUTER_ID ? labRouter(readState()) : null;
    },
    credentials: () => labCredentials(readState()),
    async markProvisioning() {},
    async recordProvisionOutcome(_router, { ok, profile }) {
      console.log(`  (lab) outcome recorded: ok=${ok}, board ${profile.boardName ?? "unknown"}`);
    },
    async recordCapabilities(_routerId, capabilities) {
      writeState({ ...readState(), capabilities });
    },
    async resyncVouchers() {
      console.log("  (lab) no vouchers to re-sync");
    },
  };
}

/** Serves the portal pages the router fetches, as the API's captive-portal route does. */
function serveBackend(): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: BACKEND_PORT,
    async fetch(req) {
      const name = new URL(req.url).pathname.replace(/^\/portal\/hotspot-files\//, "");
      if (!(PORTAL_FILES as readonly string[]).includes(name)) {
        return new Response("not found", { status: 404 });
      }
      const body = await renderPortalFile(name as PortalFileName, BACKEND_URL);
      return new Response(body, { headers: { "Content-Type": "text/html; charset=utf-8" } });
    },
  });
}

function printEvents(logger: RouterLogger): void {
  for (const event of logger.events()) {
    if (event.level === "debug") continue;
    console.log(`  [${event.level}] ${event.message}`);
  }
}

async function setup(): Promise<void> {
  process.env.BACKEND_LAN_URL = BACKEND_URL;
  const backend = serveBackend();
  try {
    const logger = new RouterLogger("provision");
    const report = await setupRouter(ROUTER_ID, labStore(), { force: false, logger });
    printEvents(logger);
    console.log(
      `\nSetup ${report.ok ? "succeeded" : "FAILED"}${report.stoppedAt ? ` at ${report.stoppedAt}` : ""}.`,
    );
    for (const blocker of report.blockers)
      console.log(`  blocker: ${blocker.reason}\n    fix: ${blocker.fix}`);
    if (!report.ok) process.exitCode = 1;
  } finally {
    backend.stop(true);
  }
}

async function verify(): Promise<void> {
  process.env.BACKEND_LAN_URL = BACKEND_URL;
  const state = readState();
  const creds = labCredentials(state);
  const logger = new RouterLogger("probe");
  const router = labRouter(state);
  const profile = await probeRouterMerged(creds, logger, router.capabilities);
  const backend = resolveBackendUrl(router.ipAddress);
  const report = await probeVerify(creds, logger, {
    dialect: dialectFor(profile),
    plan: buildHotspotPlan(router, profile),
    backendUrl: backend.url,
    backendIp: backend.ip,
  });
  for (const check of report.checks) {
    console.log(
      `  ${check.status.padEnd(7)} ${check.title}${check.status === "pass" ? "" : ` — ${check.detail}`}`,
    );
  }
  console.log(
    `\nVerify: ${report.summary.pass} pass, ${report.summary.warn} warn, ${report.summary.fail} fail.`,
  );
  if (!report.ok) process.exitCode = 1;
}

async function consoleCommand(statement: string): Promise<void> {
  const state = readState();
  const adminPassword = state.adminPassword ?? randomPassword(20);
  const serial = await SerialConsole.open();
  await serial.login([adminPassword, ""], adminPassword);
  writeState({ ...state, adminPassword });
  console.log((await serial.exec(statement)).trim().split("\n").slice(1).join("\n"));
  serial.close();
}

const [command = "status", ...args] = process.argv.slice(2);
const commands: Record<string, () => Promise<void> | void> = {
  up,
  down,
  reset,
  status: () =>
    console.log(qemuPid() === null ? "Router lab is not running." : "Router lab is running."),
  console: () => consoleCommand(args.join(" ")),
  bootstrap,
  setup,
  verify,
};
const action = commands[command];
if (!action) {
  console.error(`Unknown command "${command}". Commands: ${Object.keys(commands).join(", ")}`);
  process.exit(2);
}
await action();
