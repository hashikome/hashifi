import { describe, expect, test } from "bun:test";
import { pingTotals } from "./readiness.js";
import { RosRow, rowId, toRows } from "./ros-client.js";

describe("RouterOS rows", () => {
  test("a field the router did not send is null, not undefined", () => {
    const [row] = toRows([{ ".id": "*1", name: "ether1" }]);
    expect(row?.get("name")).toBe("ether1");
    expect(row?.get("comment")).toBeNull();
  });

  test("a reply that is not a list has no rows", () => {
    expect(toRows(null)).toEqual([]);
    expect(toRows("done")).toEqual([]);
  });

  test("a row without an .id is a protocol fault", () => {
    expect(rowId(new RosRow({ ".id": "*2" }))).toBe("*2");
    expect(() => rowId(new RosRow({}))).toThrow(/without an \.id/);
  });
});

describe("ping totals", () => {
  test("come from the last row when it carries them", () => {
    expect(pingTotals(toRows([{ sent: "1" }, { sent: "3", received: "2" }]))).toEqual({
      sent: 3,
      received: 2,
    });
  });

  test("a reported zero stays zero", () => {
    expect(pingTotals(toRows([{ sent: "2", received: "0" }])).received).toBe(0);
  });

  test("fall back to counting replies when the router sends no totals", () => {
    expect(pingTotals(toRows([{ time: "10ms" }, { time: "12ms" }, {}]))).toEqual({
      sent: 3,
      received: 2,
    });
  });
});
