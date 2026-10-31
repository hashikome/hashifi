import { readFileSync } from "node:fs";

type Api = (
  operation: string,
  payload?: Record<string, unknown>,
  query?: Record<string, string>,
) => Promise<unknown>;
interface Compose {
  composeId: string;
  appName: string;
  composeType: string;
  sourceType: string;
  autoDeploy: boolean;
  serverId?: string | null;
  env: string;
}
interface Container {
  Config?: { Image?: string; Env?: string[]; Cmd?: string[]; Labels?: Record<string, string> };
  State?: { Status?: string; ExitCode?: number; OOMKilled?: boolean; Health?: { Status?: string } };
}
export interface Release {
  revision: string;
  attempt: string;
  apiImage: string;
  webImage: string;
  tunnelImage: string;
  application: string;
  migration: string;
  registry: string;
}

const SERVICES = ["hashifi-api", "hashifi-web", "hashifi-tunnel"];

export function validateRelease(release: Release) {
  if (!/^[a-f0-9]{40}$/.test(release.revision) || !/^\d+-\d+$/.test(release.attempt))
    throw new Error("A full revision and GitHub run-attempt identity are required.");
  for (const [kind, image] of [
    ["api", release.apiImage],
    ["web", release.webImage],
    ["tunnel", release.tunnelImage],
  ]) {
    if (
      !new RegExp(
        `^ghcr\\.io/hashikome/hashifi/${kind}:${release.revision}@sha256:[a-f0-9]{64}$`,
      ).test(image)
    )
      throw new Error(
        "Both images must match this revision in the product's immutable GHCR packages.",
      );
  }
  if (!release.application || !release.migration || release.application === release.migration)
    throw new Error("Application and migration require distinct Dokploy targets.");
}

export function environment(previous: string, release: Release, migration = false) {
  const allowed = new Set([
    "PUBLIC_HOST",
    "API_IMAGE",
    "WEB_IMAGE",
    "TUNNEL_IMAGE",
    "APP_REPLICAS",
    "RELEASE_ATTEMPT",
    "RELEASE_SHA",
    "INGRESS_NETWORK",
    "BACKEND_NETWORK",
    "HTTPS_ENTRYPOINT",
    "TLS_RESOLVER",
    "TRUSTED_PROXIES",
    "EMAIL_FROM",
    "R2_ENDPOINT",
    "R2_BUCKET",
    "ROUTER_MANAGEMENT_URL",
    "TUNNEL_ADDRESS",
    "TUNNEL_NETWORK",
    "TUNNEL_PLATFORM_PUBLIC_KEY",
    "TUNNEL_ENDPOINT",
    "TUNNEL_PRIVATE_KEY_SECRET",
    "TUNNEL_SYNC_SECRET",
    "SENTRY_DSN_SECRET",
    "DATABASE_URL_SECRET",
    "MIGRATION_DATABASE_URL_SECRET",
    "ENCRYPTION_KEY_SECRET",
    "AUTH_KEY_SECRET",
    "RESEND_KEY_SECRET",
    "R2_ACCESS_KEY_ID_SECRET",
    "R2_SECRET_ACCESS_KEY_SECRET",
  ]);
  const values: Record<string, string> = {};
  for (const line of previous.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match || !allowed.has(match[1]) || Object.hasOwn(values, match[1]))
      throw new Error("Unexpected or duplicate deployment input; configuration withheld.");
    values[match[1]] = match[2];
  }
  Object.assign(values, {
    API_IMAGE: release.apiImage,
    WEB_IMAGE: release.webImage,
    TUNNEL_IMAGE: release.tunnelImage,
    RELEASE_SHA: release.revision,
    RELEASE_ATTEMPT: release.attempt,
    APP_REPLICAS: "1",
  });
  const manifest = readFileSync(
    new URL(
      migration ? "../deploy/docker-stack.migrate.yml" : "../deploy/docker-stack.prod.yml",
      import.meta.url,
    ),
    "utf8",
  );
  const required = [...manifest.matchAll(/\$\{([A-Z0-9_]+)(?::\?[^}]*)?\}/g)].map(
    (match) => match[1],
  );
  for (const name of required) {
    if (!values[name] || values[name].includes("SET_") || /[\r\n$`]/.test(values[name]))
      throw new Error(`Missing or unresolved deployment input: ${name}`);
    if (name.endsWith("_SECRET") && !/^[a-zA-Z0-9_.-]+$/.test(values[name]))
      throw new Error(`Expected a secret name: ${name}`);
  }
  if (
    !migration &&
    (values.PUBLIC_HOST !== "hashifi.hashikome.com" || values.INGRESS_NETWORK !== "dokploy-network")
  )
    throw new Error("Unexpected product host or platform ingress.");
  return `${Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`;
}

function inspect(value: unknown): Container {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  return (Array.isArray(parsed) ? parsed[0] : parsed) ?? {};
}

export function migrationState(container: Container, appName: string, release: Release) {
  if (
    container.Config?.Labels?.["com.docker.swarm.service.name"] !==
      `${appName}_hashifi-migration` ||
    !container.Config.Labels["com.docker.swarm.task.id"] ||
    container.Config.Image !== release.apiImage ||
    !container.Config.Env?.includes(`RELEASE_ATTEMPT=${release.attempt}`)
  )
    return "stale";
  if (
    JSON.stringify(container.Config.Cmd) !==
    JSON.stringify(["bun", "--bun", "prisma", "migrate", "deploy"])
  )
    throw new Error("Migration task does not run the reviewed migration.");
  if (container.State?.OOMKilled || container.State?.Status === "dead")
    throw new Error("Migration task died; application remains unchanged.");
  if (container.State?.Status !== "exited") return "pending";
  if (container.State.ExitCode !== 0)
    throw new Error("Migration task failed; application remains unchanged.");
  return "complete";
}

async function waitFor(
  api: Api,
  target: Compose,
  title: string,
  release: Release,
  migration: boolean,
  sleep: () => Promise<void>,
  attempts: number,
) {
  for (let i = 0; i < attempts; i++) {
    const deployments = (await api("deployment.allByCompose", undefined, {
      composeId: target.composeId,
    })) as { title: string; status: string }[];
    const deployment = deployments.find((item) => item.title === title);
    if (deployment?.status === "error")
      throw new Error("Dokploy deployment failed; inspect before retrying.");
    if (deployment?.status === "done") {
      // v0.30.8's stack listing filters desired-state=running. The local all-state
      // listing includes completed migrations; verify exact Swarm labels below.
      const list = (await api("docker.getContainersByAppNameMatch", undefined, {
        appName: target.appName,
        ...(migration ? {} : { appType: "stack" }),
      })) as { containerId: string; state: string }[];
      let complete = 0;
      let matched = 0;
      const running = new Map<string, number>();
      for (const item of list) {
        if (!/^[a-f0-9]{12,64}$/.test(item.containerId)) continue;
        const container = inspect(
          await api("docker.getConfig", undefined, { containerId: item.containerId }),
        );
        if (migration) {
          const state = migrationState(container, target.appName, release);
          if (state !== "stale") matched++;
          if (state === "complete") complete++;
        } else if (container.State?.Status === "running") {
          const name = container.Config?.Labels?.["com.docker.swarm.service.name"];
          const service = name?.startsWith(`${target.appName}_`)
            ? name.slice(target.appName.length + 1)
            : "";
          const expected =
            service === "hashifi-web"
              ? release.webImage
              : service === "hashifi-tunnel"
                ? release.tunnelImage
                : release.apiImage;
          if (!SERVICES.includes(service ?? "") || container.Config?.Image !== expected) {
            continue;
          }
          if (!container.Config.Env?.includes(`RELEASE_ATTEMPT=${release.attempt}`)) continue;
          if (container.State.Health?.Status !== "healthy") continue;
          running.set(service as string, (running.get(service as string) ?? 0) + 1);
        }
      }
      if (migration && matched > 1)
        throw new Error("Ambiguous migration completion; inspect the target.");
      if (migration && complete === 1) return;
      if (
        !migration &&
        list.filter((item) => item.state === "running").length === 3 &&
        SERVICES.every((service) => running.get(service) === 1)
      )
        return;
    }
    await sleep();
  }
  throw new Error("Release acceptance timed out; no automatic schema or image rollback.");
}

export async function promote(
  api: Api,
  release: Release,
  sleep = () => Bun.sleep(5000),
  attempts = 120,
) {
  validateRelease(release);
  const application = (await api("compose.one", undefined, {
    composeId: release.application,
  })) as Compose;
  const migration = (await api("compose.one", undefined, {
    composeId: release.migration,
  })) as Compose;
  for (const [target, prefix] of [
    [application, /^hashifi-[a-z0-9]{6}$/],
    [migration, /^hashifi-release-[a-z0-9]{6}$/],
  ] as const) {
    if (
      target.composeType !== "stack" ||
      target.sourceType !== "raw" ||
      target.autoDeploy !== false ||
      target.serverId ||
      !prefix.test(target.appName) ||
      !/^[a-z0-9-]+$/.test(target.appName)
    )
      throw new Error(
        "Expected dedicated local raw-source product Stacks with auto-deploy disabled.",
      );
  }
  const appEnv = environment(application.env, release);
  const migrationEnv = environment(migration.env, release, true);
  const shared = (value: string, key: string) =>
    value.split("\n").find((line) => line.startsWith(`${key}=`));
  if (shared(appEnv, "BACKEND_NETWORK") !== shared(migrationEnv, "BACKEND_NETWORK"))
    throw new Error("Application and migration must use the same data network.");
  if (
    shared(appEnv, "MIGRATION_DATABASE_URL_SECRET") !==
    shared(migrationEnv, "MIGRATION_DATABASE_URL_SECRET")
  )
    throw new Error("Application allocation and migration credential references differ.");
  await api("registry.testRegistryById", { registryId: release.registry });
  for (const [target, env, isMigration] of [
    [migration, migrationEnv, true],
    [application, appEnv, false],
  ] as const) {
    const title = `HashiFi ${isMigration ? "migration" : "application"} ${release.revision} (${release.attempt})`;
    const manifest = readFileSync(
      new URL(
        isMigration ? "../deploy/docker-stack.migrate.yml" : "../deploy/docker-stack.prod.yml",
        import.meta.url,
      ),
      "utf8",
    );
    await api("compose.update", {
      composeId: target.composeId,
      composeFile: manifest,
      env,
      command: "",
      autoDeploy: false,
    });
    await api("compose.deploy", { composeId: target.composeId, title });
    await waitFor(api, target, title, release, isMigration, sleep, attempts);
  }
}

async function main() {
  if (process.env.GITHUB_ACTIONS !== "true" || process.env.GITHUB_REF !== "refs/heads/main")
    throw new Error("Run release promotion from the main-branch GitHub workflow.");
  const revision = process.env.GITHUB_SHA ?? "";
  const head = Bun.spawn(
    ["gh", "api", "repos/hashikome/hashifi/git/ref/heads/main", "--jq", ".object.sha"],
    { stdout: "pipe", stderr: "ignore" },
  );
  const latest = (await new Response(head.stdout).text()).trim();
  if ((await head.exited) !== 0 || latest !== revision)
    throw new Error("Source revision is superseded or unreadable.");
  const key = process.env.DOKPLOY_API_KEY;
  if (!key || /[\r\n]/.test(key)) throw new Error("Missing deployment credential.");
  const api: Api = async (operation, payload, query) => {
    const url = `https://dokploy.hashikome.com/api/${operation}${query ? `?${new URLSearchParams(query)}` : ""}`;
    const config = [
      `url = ${JSON.stringify(url)}`,
      `header = ${JSON.stringify(`x-api-key: ${key}`)}`,
    ];
    if (payload)
      config.push(
        'header = "Content-Type: application/json"',
        `data = ${JSON.stringify(JSON.stringify(payload))}`,
      );
    const child = Bun.spawn(
      [
        "curl",
        "--silent",
        "--show-error",
        "--max-time",
        "45",
        "--config",
        "-",
        "--write-out",
        "\n%{http_code}",
      ],
      {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "ignore",
      },
    );
    child.stdin.write(config.join("\n"));
    child.stdin.end();
    const output = await new Response(child.stdout).text();
    if ((await child.exited) !== 0 || !output.endsWith("\n200"))
      throw new Error(`Dokploy ${operation} failed; response withheld.`);
    return JSON.parse(output.slice(0, -4) || "null");
  };
  await promote(api, {
    application: process.env.DOKPLOY_APPLICATION ?? "",
    migration: process.env.DOKPLOY_MIGRATION ?? "",
    revision,
    attempt: `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,
    apiImage: process.env.API_IMAGE ?? "",
    webImage: process.env.WEB_IMAGE ?? "",
    tunnelImage: process.env.TUNNEL_IMAGE ?? "",
    registry: process.env.DOKPLOY_REGISTRY_ID ?? "",
  });
  console.log("HashiFi migration completed and the application converged. Check the live product.");
}

if (import.meta.main)
  main().catch(() => {
    console.error(
      "Release refused or failed. Inspect the selected deployment; credentials and API bodies are withheld. No automatic rollback was attempted.",
    );
    process.exitCode = 1;
  });
