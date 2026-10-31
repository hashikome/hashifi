import { describe, expect, test } from "bun:test";
import { environment, migrationState, type Release, validateRelease } from "./release.js";

const revision = "a".repeat(40);
const digest = `sha256:${"b".repeat(64)}`;
const release: Release = {
  revision,
  attempt: "12-1",
  apiImage: `ghcr.io/hashikome/hashifi/api:${revision}@${digest}`,
  webImage: `ghcr.io/hashikome/hashifi/web:${revision}@${digest}`,
  tunnelImage: `ghcr.io/hashikome/hashifi/tunnel:${revision}@${digest}`,
  application: "app",
  migration: "migrate",
  registry: "registry",
};

const inputs = `PUBLIC_HOST=hashifi.hashikome.com
INGRESS_NETWORK=dokploy-network
BACKEND_NETWORK=data
HTTPS_ENTRYPOINT=websecure
TLS_RESOLVER=letsencrypt
TRUSTED_PROXIES=10.0.1.0/24
EMAIL_FROM=HashiFi
R2_ENDPOINT=https://x.r2.cloudflarestorage.com
R2_BUCKET=hashifi
ROUTER_MANAGEMENT_URL=http://10.88.0.1:8080
TUNNEL_ADDRESS=10.88.0.1/16
TUNNEL_NETWORK=10.88.0.0/16
TUNNEL_PLATFORM_PUBLIC_KEY=key
TUNNEL_ENDPOINT=host:51820
TUNNEL_PRIVATE_KEY_SECRET=hashifi_tunnel_private_key
TUNNEL_SYNC_SECRET=hashifi_tunnel_sync_20261031_v1
SENTRY_DSN_SECRET=hashifi_sentry_dsn_20261031_v1
DATABASE_URL_SECRET=hashifi_database_url
ENCRYPTION_KEY_SECRET=hashifi_encryption_key
AUTH_SECRET=hashifi_auth_secret
RESEND_KEY_SECRET=hashifi_resend_key
R2_ACCESS_KEY_ID_SECRET=hashifi_r2_access_key_id
R2_SECRET_ACCESS_KEY_SECRET=hashifi_r2_secret_access_key
`;

describe("release", () => {
  test("only this revision's exact images can ship", () => {
    expect(() => validateRelease(release)).not.toThrow();
    expect(() =>
      validateRelease({ ...release, apiImage: "ghcr.io/hashikome/hashifi/api:latest" }),
    ).toThrow();
    expect(() => validateRelease({ ...release, migration: "app" })).toThrow();
  });

  test("the stack gets every input it needs, and nothing unknown", () => {
    expect(environment(inputs, release)).toContain("APP_REPLICAS=1");
    expect(() => environment(`${inputs}SURPRISE=1\n`, release)).toThrow(/Unexpected/);
    expect(() => environment(inputs.replace("R2_BUCKET=hashifi\n", ""), release)).toThrow(
      /R2_BUCKET/,
    );
    expect(() =>
      environment(inputs.replace("hashifi.hashikome.com", "other.example"), release),
    ).toThrow(/host/);
  });

  test("a failed migration stops the release before the application changes", () => {
    const task = (status: string, exit: number) => ({
      Config: {
        Image: release.apiImage,
        Env: ["RELEASE_ATTEMPT=12-1"],
        Cmd: ["bun", "--bun", "prisma", "migrate", "deploy"],
        Labels: { "com.docker.swarm.service.name": "x_migration", "com.docker.swarm.task.id": "t" },
      },
      State: { Status: status, ExitCode: exit },
    });
    expect(migrationState(task("exited", 0), "x", release)).toBe("complete");
    expect(migrationState(task("running", 0), "x", release)).toBe("pending");
    expect(() => migrationState(task("exited", 1), "x", release)).toThrow(/failed/);
  });
});
