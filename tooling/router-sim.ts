// The router sim: a MikroTik Cloud Hosted Router (CHR) in QEMU, standing in for a venue's router
// so onboarding, provisioning and verification run against real RouterOS without hardware.
// Procedure and topology: docs/runbooks/router-sim.md.
//
// bun run router-sim <up|down|reset|status|console|hub|bootstrap|setup|verify|voucher|guest|guest-test>

import { createHash, randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { AuditLog } from "../apps/api/src/audit/audit-log.js";
import { SecretBox } from "../apps/api/src/crypto/secret-box.js";
import { createPrismaClient, type PrismaClient } from "../apps/api/src/database/client.js";
import type { Router } from "../apps/api/src/generated/prisma/client.js";
import {
  closeConnection,
  connectToRouter,
  disconnectHotspotDevice,
  hotspotUserExists,
  kickHotspotSession,
  loginHotspotClient,
  type MikroTikConn,
  setDeviceBlocked,
} from "../apps/api/src/services/mikrotik.js";
import { RouterAccess } from "../apps/api/src/services/router-credentials.js";
import { RouterLogger } from "../apps/api/src/services/router-log.js";
import { buildBootstrapScript } from "../apps/api/src/services/router-provision/bootstrap.js";
import {
  type BackendSettings,
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
import { PrismaRouterStore } from "../apps/api/src/services/router-provision/prisma-store.js";
import { probeRouterMerged } from "../apps/api/src/services/router-provision/probe.js";
import { toRows } from "../apps/api/src/services/router-provision/ros-client.js";
import { setupRouter } from "../apps/api/src/services/router-provision/setup.js";
import {
  generateWireguardKeyPair,
  type WireguardKeyPair,
} from "../apps/api/src/services/router-provision/tunnel.js";
import { probeVerify } from "../apps/api/src/services/router-provision/verify.js";
import { describeFailures, outcomeOk, RouterSync } from "../apps/api/src/services/router-sync.js";
import { addStaff } from "../apps/api/src/staff/add-staff.js";

const ROOT = resolve(import.meta.dir, "..");
const SIM = join(ROOT, "data", "router-sim");
const ROS_VERSION = "7.25";
const BASE_IMAGE = join(SIM, `chr-${ROS_VERSION}.img`);
const OVERLAY = join(SIM, "sim.qcow2");
const SERIAL = join(SIM, "serial.sock");
const MONITOR = join(SIM, "monitor.sock");
const PID_FILE = join(SIM, "qemu.pid");
const STATE_FILE = join(SIM, "state.json");

/** The sim venue LAN is QEMU's user network: the host is the "ISP router" at 10.0.2.2. */
const LAN = { routerIp: "10.0.2.15", prefix: 24, gatewayIp: "10.0.2.2" } as const;
/** UDP ports on 127.0.0.1 carrying the guest link (router ether2 <-> guest eth0). */
const GUEST_LINK = { router: 18100, guest: 18101 } as const;
/** Host ports forwarded to the router's RouterOS API, SSH and WinBox. */
const FORWARD = { api: 18728, ssh: 18022, winbox: 18291 } as const;
/** The host side of 10.0.2.2:8080, where the router fetches its portal pages. */
const BACKEND_PORT = 8080;
const BACKEND_URL = `http://${LAN.gatewayIp}:${BACKEND_PORT}`;
const API_USER = "hashifi";
/**
 * The sim's own database on the compose.yml PostgreSQL, migrated by the real migrations. From
 * inside the hub container the host's loopback is not reachable, so the hub joins the compose
 * network and reaches PostgreSQL by its container name.
 */
const SIM_DATABASE = "hashifi_sim";
const COMPOSE_NETWORK = "hashifi_default";
function simDatabaseUrl(): string {
  return IN_HUB
    ? `postgresql://hashifi:hashifi@hashifi-postgres:5432/${SIM_DATABASE}`
    : `postgresql://hashifi:hashifi@127.0.0.1:5437/${SIM_DATABASE}`;
}
const API_PORT = 8728;

/**
 * The management tunnel. The hub container stands in for the platform: the router dials it at
 * 10.0.2.2:51820 (QEMU's user network, outbound only, like carrier-grade NAT), and the sim
 * reaches the router through the tunnel alone.
 */
const TUNNEL = {
  serverIp: "10.88.0.1",
  routerIp: "10.88.0.2",
  prefix: 24,
  port: 51820,
} as const;
const HUB = { container: "hashifi-router-sim-hub", image: "hashifi-router-sim-hub:1" } as const;
/** Set when this process runs inside the hub container, on the platform side of the tunnel. */
const IN_HUB = process.env.SIM_IN_HUB === "1";

interface SimState {
  adminPassword: string | null;
  apiPassword: string | null;
  tunnel: { router: WireguardKeyPair; server: WireguardKeyPair } | null;
  /** The sim's encryption key (hex), sealing the router's credentials in its database. */
  encryptionKey: string | null;
  /** The sim router's row in the sim database. */
  routerId: string | null;
}

function readState(): SimState {
  const empty: SimState = {
    adminPassword: null,
    apiPassword: null,
    tunnel: null,
    encryptionKey: null,
    routerId: null,
  };
  if (!existsSync(STATE_FILE)) return empty;
  const stored: Partial<SimState> = JSON.parse(readFileSync(STATE_FILE, "utf8"));
  return { ...empty, ...stored };
}

function writeState(state: SimState): void {
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
    console.log("Router sim is already running.");
    return;
  }
  if (!existsSync(BASE_IMAGE)) {
    throw new Error(
      `Missing ${BASE_IMAGE}. Download and verify the CHR image first (docs/runbooks/router-sim.md).`,
    );
  }
  mkdirSync(SIM, { recursive: true });
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
    "hashifi-router-sim",
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
    // ether2: the guest network, a point-to-point UDP link to the guest VM. Not multicast: the
    // host may route multicast into a VPN (Cloudflare WARP did), where it never loops back.
    "-netdev",
    `socket,id=guests,udp=127.0.0.1:${GUEST_LINK.guest},localaddr=127.0.0.1:${GUEST_LINK.router}`,
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
  console.log(`Router sim is up: RouterOS ${ROS_VERSION}, API on 127.0.0.1:${FORWARD.api}.`);
}

function down(): void {
  const pid = qemuPid();
  if (pid === null) {
    console.log("Router sim is not running.");
    return;
  }
  process.kill(pid, "SIGTERM");
  console.log("Router sim stopped.");
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

  static async open(path: string = SERIAL): Promise<SerialConsole> {
    const serial = new SerialConsole();
    serial.socket = await Bun.connect({
      unix: path,
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
    const marker = `SIM-DONE-${crypto.randomUUID().slice(0, 8)}`;
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

// ── Onboarding (docs/runbooks/router-onboarding.md) ─────────────────

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
    routerName: "hashifi-sim",
    ipAddress: LAN.routerIp,
    lanPrefix: LAN.prefix,
    gatewayIp: LAN.gatewayIp,
    apiUsername: API_USER,
    apiPassword,
    apiPort: API_PORT,
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
      .filter((line) => !line.includes("] >") && !line.includes("SIM-DONE"))
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
  if (tunnel) console.log("Start or refresh the platform side with `bun run router-sim hub up`.");
}

// ── Setup and verification through the real provisioning code ────────────────

/** The management URL the router uses to reach "the API" in this sim. */
function managementUrl(state: SimState): string {
  return state.tunnel ? `http://${TUNNEL.serverIp}:${BACKEND_PORT}` : BACKEND_URL;
}

/** The sim's backend settings, as the API takes them from its configuration. */
function simBackend(state: SimState): BackendSettings {
  return {
    managementUrl: managementUrl(state),
    portalOrigin: process.env.PORTAL_ORIGIN ?? null,
    listenPort: BACKEND_PORT,
  };
}

/**
 * Re-runs this command inside the hub when the router is managed over the tunnel, because only
 * the hub is on the platform side of it. Returns true when it did.
 */
function delegateToHub(state: SimState, command: string, extra: string[] = []): boolean {
  if (!state.tunnel || IN_HUB) return false;
  const env = ["-e", "SIM_IN_HUB=1"];
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
      "tooling/router-sim.ts",
      command,
      ...extra,
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  process.exitCode = result.exitCode;
  return true;
}

/**
 * Router access as the API has it, except that without a tunnel the sim reaches the router's
 * API through QEMU's port forward rather than at its LAN address.
 */
class SimRouterAccess extends RouterAccess {
  override managementTarget(router: Router): { host: string; port: number } {
    return router.tunnelAddress
      ? { host: router.tunnelAddress, port: API_PORT }
      : { host: "127.0.0.1", port: FORWARD.api };
  }
}

/** Creates and migrates the sim database when needed. Runs on the host, before any hub run. */
function ensureSimDatabase(): void {
  if (IN_HUB) return;
  const exists = Bun.spawnSync([
    "docker",
    "exec",
    "hashifi-postgres",
    "psql",
    "-U",
    "hashifi",
    "-d",
    "hashifi",
    "-tAc",
    `SELECT 1 FROM pg_database WHERE datname = '${SIM_DATABASE}'`,
  ]);
  if (exists.exitCode !== 0) {
    throw new Error("PostgreSQL is not running: start it with `bun run infra:up`.");
  }
  if (exists.stdout.toString().trim() !== "1") {
    run(["docker", "exec", "hashifi-postgres", "createdb", "-U", "hashifi", SIM_DATABASE]);
  }
  const migrate = Bun.spawnSync(["bun", "--bun", "prisma", "migrate", "deploy"], {
    cwd: join(ROOT, "apps", "api"),
    env: { ...process.env, DATABASE_URL: simDatabaseUrl() },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (migrate.exitCode !== 0) {
    throw new Error(`Migrating the sim database failed: ${migrate.stderr.toString().trim()}`);
  }
}

interface SimServices {
  db: PrismaClient;
  access: RouterAccess;
  sync: RouterSync;
  store: PrismaRouterStore;
  router: Router;
}

/**
 * The API's own services on the sim database, with the sim router's row brought up to date
 * from the sim state (credentials sealed, tunnel address when there is a tunnel).
 */
async function simServices(state: SimState): Promise<SimServices> {
  if (!state.apiPassword) throw new Error("Run `bun run router-sim bootstrap` first.");
  const encryptionKey = state.encryptionKey ?? randomBytes(32).toString("hex");
  const box = new SecretBox(Buffer.from(encryptionKey, "hex"));
  const db = createPrismaClient(simDatabaseUrl());
  const access = new SimRouterAccess(box, API_PORT, 10);
  const sync = new RouterSync(db, access, new AuditLog(db));
  const fields = {
    name: "hashifi-sim",
    ipAddress: LAN.routerIp,
    apiUsername: API_USER,
    apiPasswordEncrypted: box.seal(state.apiPassword),
    // CHR has no radio: the hotspot runs on the guest-side ethernet port.
    hotspotInterface: "ether2",
    tunnelAddress: state.tunnel ? TUNNEL.routerIp : null,
    tunnelPublicKey: state.tunnel?.router.publicKey ?? null,
    tunnelPrivateKeyEncrypted: state.tunnel ? box.seal(state.tunnel.router.privateKey) : null,
  };
  const existing = state.routerId
    ? await db.router.findUnique({ where: { id: state.routerId } })
    : null;
  const router = existing
    ? await db.router.update({ where: { id: existing.id }, data: fields })
    : await db.router.create({
        data: {
          ...fields,
          venue: { create: { name: "Router sim venue", city: "Dar es Salaam" } },
        },
      });
  if (router.id !== state.routerId || encryptionKey !== state.encryptionKey) {
    writeState({ ...state, routerId: router.id, encryptionKey });
  }
  return {
    db,
    access,
    sync,
    store: new PrismaRouterStore(db, access, sync, simBackend(state)),
    router,
  };
}

/** Serves the portal pages the router fetches, as the API's captive-portal route does. */
function serveBackend(state: SimState, routerId: string): ReturnType<typeof Bun.serve> {
  const origin = simBackend(state).portalOrigin ?? managementUrl(state);
  return Bun.serve({
    hostname: IN_HUB ? "0.0.0.0" : "127.0.0.1",
    port: BACKEND_PORT,
    async fetch(req) {
      const name = new URL(req.url).pathname.split("/").at(-1) ?? "";
      if (!(PORTAL_FILES as readonly string[]).includes(name)) {
        return new Response("not found", { status: 404 });
      }
      const body = await renderPortalFile(name as PortalFileName, origin, routerId);
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
  ensureSimDatabase();
  if (delegateToHub(state, "setup")) return;
  const { db, store, router } = await simServices(state);
  const backend = serveBackend(state, router.id);
  try {
    const logger = new RouterLogger("provision");
    const report = await setupRouter(router.id, store, { force: false, logger });
    printEvents(logger);
    const saved = await db.router.findUniqueOrThrow({ where: { id: router.id } });
    console.log(
      `\nSetup ${report.ok ? "succeeded" : "FAILED"}${report.stoppedAt ? ` at ${report.stoppedAt}` : ""}.` +
        ` Database: router ${saved.status}, ${saved.rosVersion ?? "no version"}, ` +
        `provisioned ${saved.provisionedAt ? "yes" : "no"}.`,
    );
    for (const blocker of report.blockers)
      console.log(`  blocker: ${blocker.reason}\n    fix: ${blocker.fix}`);
    if (!report.ok) process.exitCode = 1;
  } finally {
    backend.stop(true);
    await db.$disconnect();
  }
}

async function verify(): Promise<void> {
  const state = readState();
  ensureSimDatabase();
  if (delegateToHub(state, "verify")) return;
  const { db, access, router } = await simServices(state);
  try {
    const creds = access.credentials(router);
    if (!creds) throw new Error("The sim router has no usable credentials");
    const logger = new RouterLogger("probe");
    const profile = await probeRouterMerged(creds, logger, router.capabilities);
    const report = await probeVerify(creds, logger, {
      routerId: router.id,
      dialect: dialectFor(profile),
      plan: buildHotspotPlan(router, profile),
      endpoints: resolveBackendEndpoints(router.ipAddress, simBackend(state)),
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
  } finally {
    await db.$disconnect();
  }
}

// ── Guest: a client on the hotspot segment, standing in for a phone ───────────

const GUEST = {
  iso: join(SIM, "alpine-virt-3.24.3-x86_64.iso"),
  serial: join(SIM, "guest-serial.sock"),
  pid: join(SIM, "guest.pid"),
} as const;
const HOTSPOT_GATEWAY = "10.5.50.1";

function guestPid(): number | null {
  if (!existsSync(GUEST.pid)) return null;
  const pid = Number(readFileSync(GUEST.pid, "utf8").trim());
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}

/** The guest's shell over its serial console. */
class GuestShell {
  private constructor(private readonly serial: SerialConsole) {}

  static async open(): Promise<GuestShell> {
    const serial = await SerialConsole.open(GUEST.serial);
    serial.send("\r");
    const text = await serial.waitFor(/(login:|# )\s*$/, 120_000);
    if (/login:\s*$/.test(text)) {
      serial.send("root\r");
      await serial.waitFor(/# \s*$/, 30_000);
    }
    return new GuestShell(serial);
  }

  /** Runs a shell command and returns its output and exit status. */
  async run(command: string, timeoutMs = 60_000): Promise<{ output: string; status: number }> {
    const marker = `SIM-DONE-${crypto.randomUUID().slice(0, 8)}`;
    // printf starts the marker on a fresh line: output cut short (head -c) has no final newline.
    this.serial.send(`${command}; printf '\\n%s %d\\n' ${marker} $?\r`);
    const text = await this.serial.waitFor(new RegExp(`\\n${marker} (\\d+)\\n`), timeoutMs);
    const match = text.match(new RegExp(`\\n${marker} (\\d+)\\n`));
    const body = text.slice(0, match?.index ?? text.length);
    // Drop the echoed command line.
    const output = body.slice(body.indexOf("\n") + 1);
    return { output, status: Number(match?.[1] ?? 1) };
  }

  close(): void {
    this.serial.close();
  }
}

function guest(): void {
  const action = args[0] ?? "up";
  if (action === "down") {
    const pid = guestPid();
    if (pid !== null) process.kill(pid, "SIGTERM");
    console.log("Guest stopped.");
    return;
  }
  if (guestPid() !== null) {
    console.log("Guest is already running.");
    return;
  }
  if (!existsSync(GUEST.iso)) {
    throw new Error(`Missing ${GUEST.iso}. See docs/runbooks/router-sim.md (Guest).`);
  }
  run([
    "qemu-system-x86_64",
    "-name",
    "hashifi-router-sim-guest",
    "-enable-kvm",
    "-m",
    "256",
    "-smp",
    "1",
    "-cdrom",
    GUEST.iso,
    "-boot",
    "d",
    // The other end of the router's ether2 link: a client of the hotspot and nothing else.
    "-netdev",
    `socket,id=guests,udp=127.0.0.1:${GUEST_LINK.router},localaddr=127.0.0.1:${GUEST_LINK.guest}`,
    "-device",
    "virtio-net-pci,netdev=guests,mac=52:54:00:4a:00:10",
    "-display",
    "none",
    "-serial",
    `unix:${GUEST.serial},server=on,wait=off`,
    "-pidfile",
    GUEST.pid,
    "-daemonize",
  ]);
  console.log("Guest is booting.");
}

/**
 * Sells a voucher the way the API will: a package and voucher rows in the sim database, pushed to
 * the venue's routers by RouterSync and confirmed by the router. Prints `VOUCHER=<code>`.
 */
async function voucher(): Promise<void> {
  const state = readState();
  ensureSimDatabase();
  if (delegateToHub(state, "voucher", args)) return;
  const minutes = Number(args[0] ?? 1);
  const { db, access, sync, router } = await simServices(state);
  try {
    const pkg = await db.package.create({
      data: {
        name: `Sim ${minutes} min`,
        durationMinutes: minutes,
        downloadSpeedMbps: 2,
        uploadSpeedMbps: 1,
        priceTsh: "500",
      },
    });
    const code = `SIM${randomPassword(6).toUpperCase()}`;
    await db.voucher.create({
      data: {
        code,
        venueId: router.venueId,
        packageId: pkg.id,
        priceTsh: pkg.priceTsh,
        durationMinutes: minutes,
      },
    });
    const outcome = await sync.pushVouchers(router.venueId, [code], pkg, null);
    if (!outcomeOk(outcome))
      throw new Error(`The router did not take it: ${describeFailures(outcome)}`);
    const creds = access.credentials(router);
    if (!creds) throw new Error("The sim router has no usable credentials");
    const conn = await connectToRouter(creds);
    try {
      if (!(await hotspotUserExists(conn, code)))
        throw new Error("The router did not confirm the voucher");
    } finally {
      await closeConnection(conn);
    }
    console.log(`VOUCHER=${code}`);
  } finally {
    await db.$disconnect();
  }
}

/** Runs one shell command on the guest and prints its output. */
async function guestRun(): Promise<void> {
  const shell = await GuestShell.open();
  try {
    const { output, status } = await shell.run(args.join(" "), 60_000);
    console.log(output.trimEnd());
    if (status !== 0) process.exitCode = status;
  } finally {
    shell.close();
  }
}

/** The real API on the sim database, reaching the router through its port forward. */
async function startApi(
  state: SimState,
  stableAuth = false,
): Promise<ReturnType<typeof Bun.spawn>> {
  const api = Bun.spawn(["bun", "apps/api/src/entrypoint.ts"], {
    cwd: ROOT,
    stdout: "ignore",
    stderr: "inherit",
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "development",
      PORT: String(BACKEND_PORT),
      DATABASE_URL: simDatabaseUrl(),
      ENCRYPTION_KEY: state.encryptionKey ?? "",
      // The demo's sign-ins and authenticators outlive a restart.
      BETTER_AUTH_SECRET: stableAuth
        ? createHash("sha256").update(`auth:${state.encryptionKey}`).digest("hex")
        : randomBytes(32).toString("hex"),
      ROUTER_MANAGEMENT_URL: managementUrl(state),
      ...(process.env.PORTAL_ORIGIN ? { PORTAL_ORIGIN: process.env.PORTAL_ORIGIN } : {}),
      MIKROTIK_TARGET_OVERRIDE: `127.0.0.1:${FORWARD.api}`,
    },
  });
  for (let i = 0; i < 60; i++) {
    const up = await fetch(`http://127.0.0.1:${BACKEND_PORT}/api/health`).catch(() => null);
    if (up?.ok) return api;
    await Bun.sleep(500);
  }
  api.kill();
  throw new Error("The API did not start");
}

/** The latest sign-in code the API wrote to the outbox: there is no real email in development. */
function latestCode(): void {
  const outbox = join(ROOT, "data", "email");
  const newest = readdirSync(outbox)
    .map((name) => ({ name, time: statSync(join(outbox, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time)
    .map(({ name }) => readFileSync(join(outbox, name), "utf8"))
    .find((text) => /\b\d{6}\b/.test(text));
  console.log(newest?.match(/\b\d{6}\b/)?.[0] ?? "No code yet: ask for one on the sign-in page.");
}

/**
 * Everything together, to use in a browser: the router, a guest device, the API and the web. The
 * browser stands in for the guest's phone, naming the guest VM, so a voucher redeemed there really
 * signs that device in. Runs until stopped.
 */
async function demo(): Promise<void> {
  const state = readState();
  if (state.tunnel) throw new Error("The demo runs the API on this machine: use LAN mode.");
  if (!state.apiPassword) throw new Error("Run `reset`, `bootstrap` and `setup` first.");
  if (qemuPid() === null) await up();
  const booting = guestPid() === null;
  if (booting) guest();
  if (booting) await Bun.sleep(25_000);

  const services = await simServices(state);
  const email = "admin@example.com";
  if (!(await services.db.user.findFirst({ where: { email } }))) {
    await addStaff(services.db, { email, name: "Demo Admin", role: "admin" });
  }
  const issued = Bun.spawnSync(["bun", "tooling/router-sim.ts", "voucher", "60"], {
    stdout: "pipe",
    cwd: ROOT,
  });
  const code = issued.stdout.toString().match(/VOUCHER=(\S+)/)?.[1] ?? "none";

  const api = await startApi(state, true);
  const web = Bun.spawn(["bun", "run", "--filter", "@hashifi/web", "dev"], {
    cwd: ROOT,
    stdout: "ignore",
    stderr: "ignore",
  });
  const stop = () => {
    api.kill();
    web.kill();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  // The router forgets a host idle for 5 minutes, and a real phone is never that quiet.
  const shell = await GuestShell.open();
  await shell.run("ip link set eth0 up; udhcpc -i eth0 -n -q -t 4 -T 2 2>&1 | tail -1", 30_000);
  await shell.run(
    "(while :; do wget -q -T 5 -O /dev/null http://example.com/; sleep 60; done) >/dev/null 2>&1 &",
  );
  shell.close();
  await Bun.sleep(3_000);

  const creds = services.access.credentials(services.router);
  if (!creds) throw new Error("The sim router has no usable credentials");
  const conn = await connectToRouter(creds);
  const [host] = toRows(await conn.write("/ip/hotspot/host/print"));
  await closeConnection(conn);
  const fragment = new URLSearchParams({
    router: services.router.id,
    mac: host?.get("mac-address") ?? "",
    ip: host?.get("address") ?? "",
    "link-orig": "https://example.com/",
  });
  console.log(`
HashiFi is running. Stop with Ctrl-C.

  Admin    http://localhost:4000
           Sign in as ${email}. Get the emailed code with: bun run router-sim code
  Guest    http://localhost:4000/portal/login#${fragment}
           A voucher to try: ${code}
`);
  await new Promise(() => {});
}

/** Every step a guest takes, from joining the network to being cut off at expiry. */
async function guestTest(): Promise<void> {
  const state = readState();
  if (state.tunnel) throw new Error("The guest test runs the API on this machine: use LAN mode.");
  const services = await simServices(state);
  const api = await startApi(state);
  const portalOrigin = portalOriginFor(
    managementUrl(readState()),
    process.env.PORTAL_ORIGIN ?? null,
  );
  const shell = await GuestShell.open();
  const results: { step: string; ok: boolean; detail: string }[] = [];
  const record = (step: string, ok: boolean, detail: string) => {
    results.push({ step, ok, detail });
    console.log(`${ok ? "✓" : "✗"} ${step}${detail ? ` — ${detail}` : ""}`);
  };
  /** Fetches a page in full and reports what it is: the open internet, the portal, or neither. */
  const fetchPage = async (url: string) => {
    const result = await shell.run(
      `rm -f /tmp/page; wget -q -T 8 -O /tmp/page '${url}' 2>&1 | head -c 300; ` +
        // printf formats keep the result words out of the echoed command line, which the serial
        // console prints back and which would otherwise match.
        "grep -q 'Example Domain' /tmp/page && printf 'PAGE=%s\\n' internet; " +
        "grep -o 'https\\?://[^\"]*/portal/login' /tmp/page | head -1 | sed 's/^/PORTAL /'",
      30_000,
    );
    return {
      internet: result.output.includes("PAGE=internet"),
      portal: result.output.match(/PORTAL (https?:\/\/\S+)/)?.[1] ?? null,
      raw: result.output.trim(),
    };
  };
  const describe = (page: Awaited<ReturnType<typeof fetchPage>>) =>
    page.internet
      ? "the open internet"
      : page.portal
        ? `the portal (${page.portal})`
        : `neither: ${page.raw.slice(-160)}`;

  try {
    // A cookie from an earlier run would sign the guest straight in, with nothing to test.
    const creds = services.access.credentials(services.router);
    if (!creds) throw new Error("The sim router has no usable credentials");
    const conn = await connectToRouter(creds);
    for (const menu of ["/ip/hotspot/active", "/ip/hotspot/cookie"]) {
      for (const row of toRows(await conn.write(`${menu}/print`))) {
        await conn.write(`${menu}/remove`, [`=.id=${row.get(".id") ?? ""}`]);
      }
    }
    await closeConnection(conn);

    await shell.run("ip link set eth0 up");
    const lease = await shell.run(
      "udhcpc -i eth0 -n -q -t 6 -T 2 2>&1; ip -4 -o addr show eth0",
      60_000,
    );
    const address = lease.output.match(/inet (10\.5\.50\.\d+)/)?.[1] ?? null;
    record(
      "Gets an address from the hotspot",
      address !== null,
      address ?? lease.output.trim().slice(-120),
    );

    const intercepted = await fetchPage("http://example.com/");
    record(
      "An unauthenticated page request gets the portal",
      !intercepted.internet && intercepted.portal === `${portalOrigin}/portal/login`,
      describe(intercepted),
    );

    /** Whether an HTTPS request completes against the real site (not the hotspot's redirect). */
    const httpsReaches = async (url: string) => {
      const r = await shell.run(
        `wget -q -T 8 -S -O /dev/null '${url}' 2>&1 | grep -qE 'HTTP/[0-9.]+ [0-9]+' && printf 'TLS=%s\\n' ok`,
        30_000,
      );
      return r.output.includes("TLS=ok");
    };
    if (portalOrigin.startsWith("https://")) {
      record(
        "Before login the portal host is reachable over HTTPS (walled garden)",
        await httpsReaches(`${portalOrigin}/`),
        portalOrigin,
      );
    }
    record(
      "Before login other HTTPS sites are blocked",
      !(await httpsReaches("https://example.com/")),
      "https://example.com/",
    );

    // What the router's redirect carries, which is all the portal page would be told.
    const redirect = (
      await shell.run("grep -oE '(router=|&mac=|&ip=|&link-orig=)[^\"]*' /tmp/page", 15_000)
    ).output;
    const redirected = (pattern: RegExp) => redirect.match(pattern)?.[1] ?? "";
    const routerId = redirected(/router=([0-9a-f-]{36})/);
    const mac = redirected(/&mac=([0-9A-F:]{17})/);
    const ip = redirected(/&ip=(\d+\.\d+\.\d+\.\d+)/);
    record(
      "The router's redirect names it and the device",
      routerId === services.router.id && mac !== "" && ip !== "",
      `${routerId} ${mac} ${ip}`,
    );

    const issued = Bun.spawnSync(["bun", "tooling/router-sim.ts", "voucher", "30"], {
      stdout: "pipe",
      stderr: "pipe",
      cwd: ROOT,
    });
    const code = issued.stdout.toString().match(/VOUCHER=(\S+)/)?.[1] ?? null;
    record(
      "A voucher is issued",
      code !== null,
      code ?? issued.stderr.toString().trim().slice(-200),
    );
    if (!code) return;

    const refused = await shell.run(
      `wget -q -T 8 -O /dev/null --post-data 'username=${code}&password=${code}&dst=' 'http://${HOTSPOT_GATEWAY}/login' 2>&1 | head -c 200`,
      30_000,
    );
    const stillOut = await fetchPage("http://example.com/");
    record(
      "The router itself accepts no code, even a right one, so nothing can guess at it",
      !stillOut.internet,
      `${describe(stillOut)}; ${refused.output.trim().slice(-80)}`,
    );

    /** Redeems through the walled garden, as the portal page does. */
    const redeem = (voucher: string, device = { mac, ip }) =>
      shell.run(
        "wget -q -T 20 -O - --header 'Content-Type: application/json' --post-data " +
          `'${JSON.stringify({ router: routerId, ...device, code: voucher })}' ` +
          `'${portalOrigin}/api/guest/redeem' 2>&1 | head -c 400`,
        40_000,
      );

    const absent = await redeem(code, { mac: "02:00:00:00:00:99", ip });
    const unstarted = await services.db.voucher.findUniqueOrThrow({ where: { code } });
    record(
      "A device the router cannot see is refused, and the voucher's clock does not start",
      unstarted.status === "unused" && unstarted.activatedAt === null,
      `${unstarted.status}; ${absent.output.trim().slice(-120)}`,
    );

    const signIn = () => redeem(code);
    const onRouter = async <T>(work: (conn: MikroTikConn) => Promise<T>): Promise<T> => {
      const creds = services.access.credentials(services.router);
      if (!creds) throw new Error("The sim router has no usable credentials");
      const conn = await connectToRouter(creds);
      try {
        return await work(conn);
      } finally {
        await closeConnection(conn);
      }
    };

    /** What a phone does when it joins the network again. */
    const rejoin = async () => {
      // As a phone does, it keeps asking for an address until it has one.
      for (let attempt = 0; attempt < 5; attempt++) {
        await shell.run("udhcpc -i eth0 -n -q -t 4 -T 2 2>&1 | tail -1", 30_000);
        const address = await shell.run("ip -4 -o addr show eth0", 10_000);
        if (/inet 10\.5\.50\.\d+/.test(address.output)) return;
        await Bun.sleep(3_000);
      }
    };

    await signIn();
    const redeemed = await services.db.voucher.findUniqueOrThrow({ where: { code } });
    record(
      "The guest redeems through the walled garden, and the voucher goes active",
      redeemed.status === "active",
      redeemed.status,
    );
    const loggedIn = await fetchPage("http://example.com/");
    record(
      "The API signing the device in opens the internet, with no code sent to the router",
      loggedIn.internet,
      describe(loggedIn),
    );

    const cookieLeft = await onRouter(async (conn) => {
      const [cookie] = toRows(await conn.write("/ip/hotspot/cookie/print", [`?user=${code}`]));
      return cookie?.get("expires-in") ?? "none";
    });
    record(
      "The device's cookie lasts as long as its package, not the router's default 3 days",
      /^\d+m/.test(cookieLeft),
      cookieLeft,
    );

    // The poll runs every 30 s while nobody watches the live view.
    let session: { macAddress: string } | null = null;
    for (let i = 0; i < 20 && session === null; i++) {
      await Bun.sleep(2_000);
      session = await services.db.wifiSession.findFirst({
        where: { status: "connected", voucher: { code } },
      });
    }
    record(
      "The live monitor opens the session from what the router reports",
      session?.macAddress === mac,
      session?.macAddress ?? "no session",
    );

    await onRouter(async (conn) => {
      await kickHotspotSession(conn, code);
      await loginHotspotClient(conn, { user: code, ip, mac });
    });
    const throttled = await fetchPage("http://example.com/");
    record(
      "A device dropped for a new speed is signed back in by the API, with no code sent to it",
      throttled.internet,
      describe(throttled),
    );

    // The router's keepalive timeout is 2 minutes: gone longer than that, the session ends.
    console.log("  taking the guest offline for 135 s…");
    await shell.run("ip link set eth0 down; sleep 135; ip link set eth0 up; sleep 2", 150_000);
    await rejoin();
    const returned = await fetchPage("http://example.com/");
    const byCookie = await onRouter(async (conn) =>
      toRows(await conn.write("/log/print", ["?topics=hotspot,info,debug"])).some((row) =>
        row.get("message")?.includes("by mac-cookie"),
      ),
    );
    record(
      "A device that left and came back is signed in by its MAC cookie, with no code sent",
      returned.internet && byCookie,
      `${describe(returned)}; mac-cookie in the log: ${byCookie}`,
    );

    await onRouter((conn) => disconnectHotspotDevice(conn, code, mac));
    await Bun.sleep(2_000);
    const forgotten = await fetchPage("http://example.com/");
    record(
      "A disconnected device is forgotten and must sign in again",
      !forgotten.internet && forgotten.portal !== null,
      describe(forgotten),
    );

    await onRouter((conn) => setDeviceBlocked(conn, mac, true));
    await signIn();
    const blocked = await fetchPage("http://example.com/");
    await onRouter((conn) => setDeviceBlocked(conn, mac, false));
    record(
      "A blocked device gets nowhere, whatever it tries at the router",
      !blocked.internet && blocked.portal === null,
      describe(blocked),
    );

    // The router takes up to a minute to forget a device that sent traffic while blocked.
    const unblockedAt = Date.now();
    let again = await fetchPage("http://example.com/");
    while (!again.internet && Date.now() - unblockedAt < 90_000) {
      await rejoin();
      await signIn();
      again = await fetchPage("http://example.com/");
    }
    record(
      "Unblocked, it signs in again within 90 s",
      again.internet,
      `after ${Math.round((Date.now() - unblockedAt) / 1000)} s; ${describe(again)}`,
    );
    await onRouter((conn) => disconnectHotspotDevice(conn, code, mac));

    const short = Bun.spawnSync(["bun", "tooling/router-sim.ts", "voucher", "1"], {
      stdout: "pipe",
      cwd: ROOT,
    });
    const shortCode = short.stdout.toString().match(/VOUCHER=(\S+)/)?.[1] ?? "";
    await redeem(shortCode);
    // limit-uptime is enforced by the router; allow its accounting interval on top.
    console.log("  waiting 80 s for a 1-minute voucher to expire…");
    await Bun.sleep(80_000);
    const expired = await fetchPage("http://example.com/");
    record(
      "At expiry the router cuts the guest off",
      !expired.internet && expired.portal === `${portalOrigin}/portal/login`,
      describe(expired),
    );
  } finally {
    shell.close();
    api.kill();
    await services.db.$disconnect();
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\nGuest test: ${results.length - failed} passed, ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
  }
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
  if (!tunnel) throw new Error("No tunnel: run `bun run router-sim bootstrap --tunnel` first.");
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
      // PostgreSQL is reachable from the hub only on the compose network.
      "--network",
      COMPOSE_NETWORK,
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
    console.log(qemuPid() === null ? "Router sim is not running." : "Router sim is running."),
  console: () => consoleCommand(args.join(" ")),
  demo,
  code: latestCode,
  hub,
  "tunnel-status": tunnelStatus,
  guest,
  voucher,
  "guest-test": guestTest,
  "guest-run": guestRun,
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
