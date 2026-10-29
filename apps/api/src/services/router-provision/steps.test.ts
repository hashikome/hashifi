import { describe, expect, test } from "bun:test";
import type { RosClient } from "./ros-client.js";
import { addRuleFirst, moveRuleAheadOfHotspotRules, ruleAheadOfHotspotRules } from "./steps.js";

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
    expect(added[0]?.some((p) => p.startsWith("=place-before="))).toBe(false);
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
describe("ruleAheadOfHotspotRules", () => {
  const rowsFor = (order: string[]) =>
    order.map((o) =>
      o === "dyn"
        ? { dynamic: "true" }
        : o === "placeholder"
          ? { comment: "place hotspot rules here", dynamic: "false", disabled: "true" }
          : { comment: o, dynamic: "false" },
    ) as Record<string, string>[];

  const ros = (rows: Record<string, string>[]) =>
    ({ print: async () => rows }) as unknown as Parameters<typeof ruleAheadOfHotspotRules>[0];

  test("true when our rule is above the dynamic rules", async () => {
    const rows = rowsFor(["wbs:firewall-forward-backend", "dyn", "dyn"]);
    expect(
      await ruleAheadOfHotspotRules(ros(rows), "/ip/firewall/filter", "firewall-forward-backend"),
    ).toBe(true);
  });

  test("false when the dynamic rules got in front — the bug this catches", async () => {
    const rows = rowsFor(["dyn", "dyn", "wbs:firewall-forward-backend"]);
    expect(
      await ruleAheadOfHotspotRules(ros(rows), "/ip/firewall/filter", "firewall-forward-backend"),
    ).toBe(false);
  });

  test("true when there are no dynamic rules to be above", async () => {
    const rows = rowsFor(["wbs:firewall-forward-backend"]);
    expect(
      await ruleAheadOfHotspotRules(ros(rows), "/ip/firewall/filter", "firewall-forward-backend"),
    ).toBe(true);
  });

  test("true above the hotspot's placeholder even while dynamic rules list first", async () => {
    // RouterOS 7.25 (CHR): a running hotspot keeps its dynamic rules first and re-inserts them
    // directly above the placeholder when it starts. Measured in the router lab.
    const rows = rowsFor(["dyn", "dyn", "wbs:firewall-forward-backend", "placeholder"]);
    expect(
      await ruleAheadOfHotspotRules(ros(rows), "/ip/firewall/filter", "firewall-forward-backend"),
    ).toBe(true);
  });

  test("false below the placeholder, where the hotspot's rules will stay ahead", async () => {
    const rows = rowsFor(["dyn", "dyn", "placeholder", "wbs:firewall-forward-backend"]);
    expect(
      await ruleAheadOfHotspotRules(ros(rows), "/ip/firewall/filter", "firewall-forward-backend"),
    ).toBe(false);
  });

  test("false when the rule is missing entirely", async () => {
    expect(
      await ruleAheadOfHotspotRules(
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
      expect(await ruleAheadOfHotspotRules(ros(rows), "/ip/firewall/filter", id)).toBe(true);
    }
  });
});

/**
 * The fresh-board race, measured on CHR 7.25 in the router lab: the hotspot adds its dynamic
 * rules and placeholder just after the server is created, above the rule the firewall step had
 * already placed, so the read-back found it below the placeholder.
 */
describe("moveRuleAheadOfHotspotRules", () => {
  const ours = { ".id": "*1", comment: "wbs:firewall-forward-backend", dynamic: "false" };
  const placeholder = {
    ".id": "*3",
    comment: "place hotspot rules here",
    dynamic: "false",
    disabled: "true",
  };
  const dynamicRule = { ".id": "*4", dynamic: "true" };

  function lateHotspot(emptyPrints: number) {
    let prints = 0;
    const moves: string[][] = [];
    const ros = {
      print: async () => {
        prints += 1;
        return prints <= emptyPrints ? [ours] : [dynamicRule, placeholder, ours];
      },
      exec: async (_command: string, params: string[]) => {
        moves.push(params);
        return [];
      },
    } as unknown as RosClient;
    return { ros, moves };
  }

  test("waits for the hotspot's rules, then moves ours above the placeholder", async () => {
    const { ros, moves } = lateHotspot(2);
    await moveRuleAheadOfHotspotRules(
      ros,
      "/ip/firewall/filter",
      "firewall-forward-backend",
      5_000,
    );
    expect(moves).toEqual([["=numbers=*1", "=destination=*3"]]);
  });

  test("gives up waiting and leaves the rule when no hotspot rules appear", async () => {
    const { ros, moves } = lateHotspot(Number.POSITIVE_INFINITY);
    await moveRuleAheadOfHotspotRules(ros, "/ip/firewall/filter", "firewall-forward-backend", 300);
    expect(moves).toEqual([]);
  });
});
