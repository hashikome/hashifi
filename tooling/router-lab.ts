// The router lab: a MikroTik Cloud Hosted Router (CHR) in QEMU, standing in for a venue's router
// so onboarding, provisioning and verification run against real RouterOS without hardware.
// Procedure and topology: docs/runbooks/router-lab.md.
//
// bun run lab <up|down|reset|status|console|hub|bootstrap|setup|verify>

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RouterCredentials } from "../apps/api/src/services/mikrotik.js";
import { RouterLogger } from "../apps/api/src/services/router-log.js";
import { buildBootstrapScript } from "../apps/api/src/services/router-provision/bootstrap.js";
import {
  buildHotspotPlan,
  portalOriginFor,
  resolveBackendEndpoints,
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
import {
  generateWireguardKeyPair,
  type WireguardKeyPair,
} from "../apps/api/src/services/router-provision/tunnel.js";
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
const API_PORT = 8728;

/**
 * The management tunnel. The hub container stands in for the platform: the router dials it at
 * 10.0.2.2:51820 (QEMU's user network, outbound only, like carrier-grade NAT), and the lab
 * reaches the router through the tunnel alone.
 */
const TUNNEL = {
  serverIp: "10.88.0.1",
  routerIp: "10.88.0.2",
  prefix: 24,
  port: 51820,
} as const;
const HUB = { container: "hashifi-lab-hub", image: "hashifi-lab-hub:1" } as const;
/** Set when this process runs inside the hub container, on the platform side of the tunnel. */
const IN_HUB = process.env.LAB_IN_HUB === "1";

interface LabState {
  adminPassword: string | null;
  apiPassword: string | null;
  capabilities: unknown;
  tunnel: { router: WireguardKeyPair; server: WireguardKeyPair } | null;
}

function readState(): LabState {
  if (!existsSync(STATE_FILE)) {
    return { adminPassword: null, apiPassword: null, capabilities: null, tunnel: null };
  }
  const state = JSON.parse(readFileSync(STATE_FILE, "utf8")) as LabState;
  return { ...state, tunnel: state.tunnel ?? null };
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
  const tunnel = args.includes("--tunnel")
    ? {
        router: generateWireguardKeyPair(),
        server: state.tunnel?.server ?? generateWireguardKeyPair(),
      }
    : null;
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
    tunnel: tunnel && {
      routerPrivateKey: tunnel.router.privateKey,
      routerAddress: `${TUNNEL.routerIp}/${TUNNEL.prefix}`,
      serverPublicKey: tunnel.server.publicKey,
      serverAddress: TUNNEL.serverIp,
      endpointHost: LAN.gatewayIp,
      endpointPort: TUNNEL.port,
    },
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
  writeState({ ...state, adminPassword, apiPassword: resolved.apiPassword, tunnel });
  console.log(
    `Bootstrap applied: ${statements.length} statements, API user "${API_USER}"` +
      `${tunnel ? `, management tunnel to ${LAN.gatewayIp}:${TUNNEL.port}` : ""}.`,
  );
  if (tunnel) console.log("Start or refresh the platform side with `bun run lab hub up`.");
}

// ── Setup and verification through the real provisioning code ────────────────

function labCredentials(state: LabState): RouterCredentials {
  if (!state.apiPassword) throw new Error("Run `bun run lab bootstrap` first.");
  // With a tunnel the router's API accepts only the platform's tunnel address.
  const target = state.tunnel
    ? { host: TUNNEL.routerIp, port: API_PORT }
    : { host: "127.0.0.1", port: FORWARD.api };
  return { ...target, username: API_USER, password: state.apiPassword };
}

/** The management URL the router uses to reach "the API" in this lab. */
function managementUrl(state: LabState): string {
  return state.tunnel ? `http://${TUNNEL.serverIp}:${BACKEND_PORT}` : BACKEND_URL;
}

/**
 * Re-runs this command inside the hub when the router is managed over the tunnel, because only
 * the hub is on the platform side of it. Returns true when it did.
 */
function delegateToHub(state: LabState, command: string): boolean {
  if (!state.tunnel || IN_HUB) return false;
  const env = ["-e", "LAB_IN_HUB=1"];
  if (process.env.PORTAL_ORIGIN) env.push("-e", `PORTAL_ORIGIN=${process.env.PORTAL_ORIGIN}`);
  const result = Bun.spawnSync(
    [
      "docker",
      "exec",
      "-u",
      `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
      ...env,
      HUB.container,
      "bun",
      "tooling/router-lab.ts",
      command,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  process.exitCode = result.exitCode;
  return true;
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
function serveBackend(state: LabState): ReturnType<typeof Bun.serve> {
  const origin = portalOriginFor(managementUrl(state));
  return Bun.serve({
    hostname: IN_HUB ? "0.0.0.0" : "127.0.0.1",
    port: BACKEND_PORT,
    async fetch(req) {
      const name = new URL(req.url).pathname.replace(/^\/portal\/hotspot-files\//, "");
      if (!(PORTAL_FILES as readonly string[]).includes(name)) {
        return new Response("not found", { status: 404 });
      }
      const body = await renderPortalFile(name as PortalFileName, origin);
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
  const state = readState();
  if (delegateToHub(state, "setup")) return;
  process.env.ROUTER_MANAGEMENT_URL = managementUrl(state);
  const backend = serveBackend(state);
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
  const state = readState();
  if (delegateToHub(state, "verify")) return;
  process.env.ROUTER_MANAGEMENT_URL = managementUrl(state);
  const creds = labCredentials(state);
  const logger = new RouterLogger("probe");
  const router = labRouter(state);
  const profile = await probeRouterMerged(creds, logger, router.capabilities);
  const report = await probeVerify(creds, logger, {
    dialect: dialectFor(profile),
    plan: buildHotspotPlan(router, profile),
    endpoints: resolveBackendEndpoints(router.ipAddress),
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

// ── Hub: the platform side of the management tunnel ───────────────────────────

function docker(cmd: string[], input: string | null = null): string {
  const result = Bun.spawnSync(["docker", ...cmd], {
    stdin: input === null ? "ignore" : new TextEncoder().encode(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`docker ${cmd[0]} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString().trim();
}

function hub(): void {
  const action = args[0] ?? "up";
  if (action === "down") {
    Bun.spawnSync(["docker", "rm", "-f", HUB.container], { stdout: "ignore", stderr: "ignore" });
    console.log("Hub stopped.");
    return;
  }
  const { tunnel } = readState();
  if (!tunnel) throw new Error("No tunnel: run `bun run lab bootstrap --tunnel` first.");
  if (action === "restart") {
    // A restart drops the hub's WireGuard state, as a platform restart would: the router must
    // re-establish the tunnel on its own.
    docker(["restart", HUB.container]);
  } else {
    Bun.spawnSync(["docker", "rm", "-f", HUB.container], { stdout: "ignore", stderr: "ignore" });
    docker([
      "run",
      "-d",
      "--name",
      HUB.container,
      "--cap-add",
      "NET_ADMIN",
      "-p",
      `127.0.0.1:${TUNNEL.port}:${TUNNEL.port}/udp`,
      "-v",
      `${ROOT}:${ROOT}`,
      "-w",
      ROOT,
      HUB.image,
      "sleep",
      "infinity",
    ]);
  }
  docker(
    [
      "exec",
      "-i",
      "-u",
      "0",
      HUB.container,
      "sh",
      "-c",
      [
        "set -e",
        "umask 077",
        "cat > /run/wg.key",
        "ip link add wg0 type wireguard",
        `wg set wg0 private-key /run/wg.key listen-port ${TUNNEL.port}`,
        `ip address add ${TUNNEL.serverIp}/${TUNNEL.prefix} dev wg0`,
        "ip link set wg0 up",
      ].join("; "),
    ],
    tunnel.server.privateKey,
  );
  docker([
    "exec",
    "-u",
    "0",
    HUB.container,
    "wg",
    "set",
    "wg0",
    "peer",
    tunnel.router.publicKey,
    "allowed-ips",
    `${TUNNEL.routerIp}/32`,
  ]);
  console.log(
    `Hub ${action === "restart" ? "restarted" : "up"}: ${TUNNEL.serverIp}/${TUNNEL.prefix}, listening on 127.0.0.1:${TUNNEL.port}/udp.`,
  );
}

function tunnelStatus(): void {
  console.log(docker(["exec", "-u", "0", HUB.container, "wg", "show", "wg0"]));
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
  hub,
  "tunnel-status": tunnelStatus,
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
