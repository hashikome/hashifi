import { describe, expect, test } from "bun:test";
import WebSocket from "ws";
import { LiveHub } from "../../src/live/live-hub.js";
import { RouterLogger } from "../../src/services/router-log.js";
import { addStaff } from "../../src/staff/add-staff.js";
import {
  browser,
  type Client,
  enrollAuthenticatorFor,
  FRONTEND_ORIGIN,
  signInWithCode,
  useApi,
} from "./api.js";
import { useTestDatabase } from "./harness.js";

const t = useTestDatabase();
const api = useApi();

/** Opens the live socket as `client`; resolves with it open, or rejects with the HTTP status. */
function connect(client: Client | null, origin = FRONTEND_ORIGIN): Promise<LiveSocket> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { Origin: origin };
    if (client) headers.Cookie = client.cookieHeader();
    const socket = new WebSocket(`${api.url.replace(/^http/, "ws")}/ws/live`, { headers });
    const live = new LiveSocket(socket);
    socket.on("open", () => resolve(live));
    socket.on("unexpected-response", (_req, res) => reject(new Error(String(res.statusCode))));
    socket.on("error", reject);
  });
}

class LiveSocket {
  readonly messages: { type: string; venueId?: string }[] = [];
  closedWith: number | null = null;

  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => this.messages.push(JSON.parse(String(data))));
    socket.on("close", (code) => {
      this.closedWith = code;
    });
  }

  close() {
    this.socket.close();
  }
}

const settle = () => Bun.sleep(100);

function update(venueId: string) {
  return {
    type: "hotspot_update" as const,
    routerId: "r",
    routerName: "Lobby",
    venueId,
    venueName: "Venue",
    timestamp: new Date().toISOString(),
    clients: [],
  };
}

describe("live view", () => {
  test("refuses anyone not signed in, other origins, and admins without an authenticator", async () => {
    await expect(connect(null)).rejects.toThrow("401");
    await addStaff(t.db, { email: "m@example.com", name: "M", role: "manager" });
    const m = browser(api);
    await signInWithCode(api, m, "m@example.com");
    await expect(connect(m, "https://evil.example")).rejects.toThrow("403");

    await addStaff(t.db, { email: "new@example.com", name: "New", role: "admin" });
    const unenrolled = browser(api);
    await signInWithCode(api, unenrolled, "new@example.com");
    await expect(connect(unenrolled)).rejects.toThrow("401");
  });

  test("a manager gets their venues' hotspots only; admins get everything", async () => {
    const { id } = await addStaff(t.db, { email: "m@example.com", name: "M", role: "manager" });
    const mine = await t.db.venue.create({ data: { name: "Home", city: "Dar", operatorId: id } });
    const theirs = await t.db.venue.create({ data: { name: "Other", city: "Arusha" } });
    const m = browser(api);
    await signInWithCode(api, m, "m@example.com");
    await addStaff(t.db, { email: "admin@example.com", name: "Admin", role: "admin" });
    const a = browser(api);
    await enrollAuthenticatorFor(api, a, "admin@example.com");

    const managerSocket = await connect(m);
    const adminSocket = await connect(a);
    const hub = api.app.get(LiveHub);
    expect(hub.watching()).toBe(true);
    hub.publishHotspot(update(mine.id));
    hub.publishHotspot(update(theirs.id));
    new RouterLogger("provision").info("Applying the hotspot step");
    await settle();

    expect(managerSocket.messages.map((x) => [x.type, x.venueId])).toEqual([
      ["hotspot_update", mine.id],
    ]);
    expect(adminSocket.messages.map((x) => x.type)).toEqual([
      "hotspot_update",
      "hotspot_update",
      "provision_log",
    ]);
    managerSocket.close();
    adminSocket.close();
    await settle();
    expect(hub.watching()).toBe(false);
  });

  test("a suspended manager is disconnected at the next check", async () => {
    const { id } = await addStaff(t.db, { email: "m@example.com", name: "M", role: "manager" });
    const m = browser(api);
    await signInWithCode(api, m, "m@example.com");
    const socket = await connect(m);
    await t.db.staff.update({ where: { id }, data: { status: "suspended" } });
    await api.app.get(LiveHub).revalidate();
    await settle();
    expect(socket.closedWith).toBe(4401);
  });
});
