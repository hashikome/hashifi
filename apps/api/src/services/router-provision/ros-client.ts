/**
 * Thin, logged wrapper around the RouterOS API.
 *
 * Every call goes through `RouterLogger`, so a provisioning run produces a complete,
 * visible transcript of what was sent and what came back. Steps use this instead of
 * touching `conn.write()` directly.
 */

import type { MikroTikConn } from "../mikrotik.js";
import type { RouterLogger } from "../router-log.js";

export type RosRow = Record<string, string | undefined>;

/** A row's RouterOS `.id`. Every row the router returns carries one; a row without it is a protocol fault. */
export function rowId(row: RosRow): string {
  const id = row[".id"];
  if (!id) throw new Error("RouterOS returned a row without an .id");
  return id;
}

function toRows(result: unknown): RosRow[] {
  return Array.isArray(result) ? (result as RosRow[]) : [];
}

/** Objects this system owns are tagged so we never touch hand-made rules. */
export const WBS_TAG = "wbs";

export function tagFor(stepId: string): string {
  return `${WBS_TAG}:${stepId}`;
}

export class RosClient {
  constructor(
    private readonly conn: MikroTikConn,
    readonly logger: RouterLogger,
    readonly host: string,
  ) {}

  /** `menu` is a RouterOS path without the trailing action, e.g. "/ip/firewall/filter" */
  async print(menu: string, filters: string[] = []): Promise<RosRow[]> {
    const command = `${menu}/print`;
    const result = await this.logger.run({ host: this.host, command, params: filters }, () =>
      this.conn.write(command, filters),
    );
    return toRows(result);
  }

  /** Returns null when the menu doesn't exist on this firmware, instead of throwing. */
  async tryPrint(menu: string, filters: string[] = []): Promise<RosRow[] | null> {
    const command = `${menu}/print`;
    const result = await this.logger.probe({ host: this.host, command, params: filters }, () =>
      this.conn.write(command, filters),
    );
    return result === null ? null : toRows(result);
  }

  async add(menu: string, params: string[]): Promise<string | null> {
    const command = `${menu}/add`;
    const result = await this.logger.run({ host: this.host, command, params }, () =>
      this.conn.write(command, params),
    );
    const rows = toRows(result);
    return rows[0]?.ret ?? rows[0]?.[".id"] ?? null;
  }

  async set(menu: string, id: string, params: string[]): Promise<void> {
    const command = `${menu}/set`;
    const withId = [`=.id=${id}`, ...params];
    await this.logger.run({ host: this.host, command, params: withId }, () =>
      this.conn.write(command, withId),
    );
  }

  /** For singleton menus with no `.id`, e.g. /ip/dns, /system/identity */
  async setSingleton(menu: string, params: string[]): Promise<void> {
    const command = `${menu}/set`;
    await this.logger.run({ host: this.host, command, params }, () =>
      this.conn.write(command, params),
    );
  }

  async remove(menu: string, id: string): Promise<void> {
    const command = `${menu}/remove`;
    const params = [`=.id=${id}`];
    await this.logger.run({ host: this.host, command, params }, () =>
      this.conn.write(command, params),
    );
  }

  /** Like `exec`, but null when the command doesn't exist on this firmware. */
  async tryExec(command: string, params: string[] = []): Promise<RosRow[] | null> {
    const result = await this.logger.probe({ host: this.host, command, params }, () =>
      this.conn.write(command, params),
    );
    return result === null ? null : toRows(result);
  }

  /** Raw escape hatch for commands that aren't add/set/print (e.g. /tool/fetch). */
  async exec(command: string, params: string[] = []): Promise<RosRow[]> {
    const result = await this.logger.run({ host: this.host, command, params }, () =>
      this.conn.write(command, params),
    );
    return toRows(result);
  }

  /** First object in `menu` carrying our step tag, or null. */
  async findByTag(menu: string, stepId: string): Promise<RosRow | null> {
    const rows = await this.print(menu, [`?comment=${tagFor(stepId)}`]);
    return rows[0] ?? null;
  }

  async findByName(menu: string, name: string): Promise<RosRow | null> {
    const rows = await this.print(menu, [`?name=${name}`]);
    return rows[0] ?? null;
  }
}
