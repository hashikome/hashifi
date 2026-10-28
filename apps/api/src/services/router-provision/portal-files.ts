/**
 * The hotspot HTML pages (login.html, alogin.html, status.html) that live in
 * `backend/mikrotik-files/`,
 * with the backend address templated in at push time.
 *
 * Those files ship with a hardcoded `http://192.168.0.15:8080`. Rather than requiring
 * anyone to hand-edit them when the backend moves (§3.1, §10), we rewrite the base URL
 * on the way to the router.
 */

import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** src/services/router-provision → backend/mikrotik-files */
const FILES_DIR = join(HERE, "..", "..", "..", "mikrotik-files");

/**
 * Every page pushed to a router. Adding a name here is all it takes: the `portal-files` step
 * uploads and byte-verifies each one, `verify.ts` checks each is present at the expected length,
 * and `/portal/hotspot-files/:name` will serve it.
 *
 * `status.html` replaces the stock RouterOS page — a bare four-row table with a popup logout that
 * mobile browsers block — with one matching alogin.html. It is the only screen a returning
 * customer ever sees.
 */
export const PORTAL_FILES = ["login.html", "alogin.html", "status.html"] as const;
export type PortalFileName = (typeof PORTAL_FILES)[number];

/** Any `http://<ipv4>:<port>` in the templates is the backend base URL. */
const BACKEND_URL_PATTERN = /https?:\/\/\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?/g;

export async function renderPortalFile(name: PortalFileName, backendUrl: string): Promise<string> {
  const raw = await readFile(join(FILES_DIR, name), "utf8");
  return raw.replace(BACKEND_URL_PATTERN, backendUrl.replace(/\/+$/, ""));
}

/** Path on the router — RouterOS serves the hotspot pages from `hotspot/`. */
export function routerPathFor(name: PortalFileName): string {
  return `hotspot/${name}`;
}
