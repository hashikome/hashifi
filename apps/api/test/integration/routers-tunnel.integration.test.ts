import { describe, expect, test } from "bun:test";
import { generateWireguardKeyPair } from "../../src/services/router-provision/tunnel.js";
import { addStaff } from "../../src/staff/add-staff.js";
import { browser, enrollAuthenticatorFor, useApi } from "./api.js";
import { useTestDatabase } from "./harness.js";

const t = useTestDatabase();
const platform = generateWireguardKeyPair();
const api = useApi({
  TUNNEL_NETWORK: "10.88.0.0/16",
  TUNNEL_PLATFORM_PUBLIC_KEY: platform.publicKey,
  TUNNEL_ENDPOINT: "tunnel.example.com:51820",
  ROUTER_MANAGEMENT_URL: "http://10.88.0.1:8080",
});

interface Script {
  script: string;
  tunnel: boolean;
  resolved: { apiPassword: string };
}

describe("bootstrap with the management tunnel", () => {
  test("allocates the router's tunnel once, and the script opens it to the platform", async () => {
    await addStaff(t.db, { email: "admin@example.com", name: "Admin", role: "admin" });
    const c = browser(api);
    await enrollAuthenticatorFor(api, c, "admin@example.com");
    const venue = await t.db.venue.create({ data: { name: "Home", city: "Dar es Salaam" } });
    const router = await t.db.router.create({
      data: {
        venueId: venue.id,
        name: "Lobby",
        ipAddress: "192.168.0.161",
        apiUsername: "hashifi",
      },
    });

    const first = (await c.request("POST", `/api/routers/${router.id}/bootstrap-script`, {}))
      .body as Script;
    expect(first.tunnel).toBe(true);
    expect(first.script).toContain(platform.publicKey);
    expect(first.script).toContain("tunnel.example.com");
    expect(first.script).toContain("10.88.0.2/16");
    expect(first.script).toContain("10.88.0.1/32");

    const second = (await c.request("POST", `/api/routers/${router.id}/bootstrap-script`, {}))
      .body as Script;
    expect(second.script).toBe(first.script);

    const saved = await t.db.router.findUniqueOrThrow({ where: { id: router.id } });
    expect(saved.tunnelAddress).toBe("10.88.0.2");
    expect(saved.tunnelPrivateKeyEncrypted).not.toBeNull();
    const shown = await c.request("GET", `/api/routers/${router.id}`);
    expect(shown.body).toMatchObject({ router: { tunnelAddress: "10.88.0.2" } });
    expect(JSON.stringify(shown.body)).not.toContain(saved.tunnelPrivateKeyEncrypted ?? "-");
  });
});
