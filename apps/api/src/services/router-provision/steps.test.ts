import { describe, expect, test } from "bun:test";
import { addRuleFirst, ruleBeforeDynamic } from "./steps.js";
import type { RosClient } from "./ros-client.js";

/**
 * The `place-before` regression.
 *
 * Both firewall steps used to send `=place-before=0`, which RouterOS rejects with `no such item`
 * when nothing occupies index 0. On a freshly reset board they run moments after the hotspot server
 * is created, before RouterOS has populated its dynamic rules — so the list is empty, the add
 * fails, and because both steps are critical the entire Set up aborts before the portal pages are
 * ever uploaded.
 *
 * It passed the first clean-board test and failed the second, which is exactly the shape of bug a
 * unit test is for.
 */
function fakeRos(rows: Record<string, string>[]) {
  const added: string[][] = [];
  const ros = {
    print: async () => rows,
    add: async (_menu: string, params: string[]) => {
      added.push(params);
      return null;
    },
  } as unknown as RosClient;
  return { ros, added };
}

describe("addRuleFirst", () => {
  test("omits place-before when the list is empty", async () => {
    const { ros, added } = fakeRos([]);
    await addRuleFirst(ros, "/ip/firewall/filter", "firewall-forward-backend", ["=chain=forward"]);
    expect(added).toHaveLength(1);
    expect(added[0]!.some((p) => p.startsWith("=place-before="))).toBe(false);
  });

  test("never sends the numeric index that the board rejects", async () => {
    for (const rows of [[], [{ ".id": "*2" }]]) {
      const { ros, added } = fakeRos(rows);
      await addRuleFirst(ros, "/ip/firewall/filter", "firewall-input-backend", ["=chain=input"]);
      expect(added[0]).not.toContain("=place-before=0");
    }
  });

  test("places before the current first rule by its real .id", async () => {
    // Measured on an hAP lite: an `.id` is accepted and lands the rule at position 0.
    const { ros, added } = fakeRos([{ ".id": "*2" }, { ".id": "*3" }]);
    await addRuleFirst(ros, "/ip/firewall/filter", "firewall-forward-backend", ["=chain=forward"]);
    expect(added[0]).toContain("=place-before=*2");
  });

  test("always carries the wbs: tag, so the rule stays ours to manage", async () => {
    const { ros, added } = fakeRos([]);
    await addRuleFirst(ros, "/ip/firewall/filter", "firewall-forward-backend", ["=chain=forward"]);
    expect(added[0]).toContain("=comment=wbs:firewall-forward-backend");
  });

  test("passes the caller's params through untouched", async () => {
    const { ros, added } = fakeRos([]);
    const params = ["=chain=forward", "=src-address=10.5.50.0/24", "=action=accept"];
    await addRuleFirst(ros, "/ip/firewall/filter", "firewall-forward-backend", params);
    for (const p of params) expect(added[0]).toContain(p);
  });
});

/**
 * Position is part of correctness for the firewall rules.
 *
 * `addRuleFirst` appending to an empty list is not enough on its own: RouterOS materialises the
 * hotspot's dynamic rules a moment later and they land ABOVE our static accept, leaving it at index
 * 15 of 16 where the hotspot's own reject pre-empts it. Measured on a clean board.
 */
describe("ruleBeforeDynamic", () => {
  const rowsFor = (order: string[]) =>
    order.map((o) =>
      o === "dyn" ? { dynamic: "true" } : { comment: o, dynamic: "false" },
    ) as Record<string, string>[];

  const ros = (rows: Record<string, string>[]) =>
    ({ print: async () => rows }) as unknown as Parameters<typeof ruleBeforeDynamic>[0];

  test("true when our rule is above the dynamic rules", async () => {
    const rows = rowsFor(["wbs:firewall-forward-backend", "dyn", "dyn"]);
    expect(
      await ruleBeforeDynamic(ros(rows), "/ip/firewall/filter", "firewall-forward-backend"),
    ).toBe(true);
  });

  test("false when the dynamic rules got in front — the bug this catches", async () => {
    const rows = rowsFor(["dyn", "dyn", "wbs:firewall-forward-backend"]);
    expect(
      await ruleBeforeDynamic(ros(rows), "/ip/firewall/filter", "firewall-forward-backend"),
    ).toBe(false);
  });

  test("true when there are no dynamic rules to be above", async () => {
    const rows = rowsFor(["wbs:firewall-forward-backend"]);
    expect(
      await ruleBeforeDynamic(ros(rows), "/ip/firewall/filter", "firewall-forward-backend"),
    ).toBe(true);
  });

  test("false when the rule is missing entirely", async () => {
    expect(
      await ruleBeforeDynamic(
        ros(rowsFor(["dyn"])),
        "/ip/firewall/filter",
        "firewall-forward-backend",
      ),
    ).toBe(false);
  });

  test("BOTH firewall rules can satisfy it at once", async () => {
    /*
     * The criterion is "above the dynamics", not "first in the list", and that is the whole point:
     * only one rule can ever be index 0, so demanding that would have the two steps shove each
     * other aside on every run and phase 5 could never report a clean re-check.
     */
    const rows = rowsFor(["wbs:firewall-forward-backend", "wbs:firewall-input-backend", "dyn"]);
    for (const id of ["firewall-forward-backend", "firewall-input-backend"]) {
      expect(await ruleBeforeDynamic(ros(rows), "/ip/firewall/filter", id)).toBe(true);
    }
  });
});
