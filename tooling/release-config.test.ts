import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const config = JSON.parse(read("deploy/release.json"));
const known = new Set<string>([
  ...config.allowedInputs,
  ...Object.keys(config.images),
  "RELEASE_SHA",
  "RELEASE_ATTEMPT",
  "APP_REPLICAS",
]);
const inputs = (manifest: string) =>
  [...manifest.matchAll(/\$\{([A-Z0-9_]+)(?::\?[^}]*)?(?::-[^}]*)?\}/g)].map((match) => match[1]);
const services = (manifest: string) =>
  Object.keys((Bun.YAML.parse(manifest) as { services: Record<string, unknown> }).services);

// The shared release action refuses anything this configuration doesn't name, so a stack change
// that isn't reflected here would stop the next release.
describe("deploy/release.json", () => {
  test("covers every input the stacks read and the template lists", () => {
    for (const path of [config.application.manifest, config.migration.manifest])
      for (const name of inputs(read(path))) expect(known).toContain(name);
    const stack = read(".env.example").split("The deployment's stack")[1] ?? "";
    for (const [, name] of stack.matchAll(/^# ([A-Z0-9_]+)=/gm)) expect(known).toContain(name);
  });

  test("names the stacks' exact services", () => {
    expect(Object.keys(config.services).sort()).toEqual(
      services(read(config.application.manifest)).sort(),
    );
    expect(services(read(config.migration.manifest))).toEqual([config.migration.service]);
  });

  test("runs the migration the stack declares", () => {
    const stack = Bun.YAML.parse(read(config.migration.manifest)) as {
      services: Record<string, { command: string[] }>;
    };
    expect(stack.services[config.migration.service]?.command).toEqual(config.migration.command);
  });
});
