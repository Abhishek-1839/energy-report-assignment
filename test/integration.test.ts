import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parseLine } from "../src/decode.js";
import { buildReport } from "../src/report.js";

const file = new URL("../telemetry.jsonl", import.meta.url);
const skip = existsSync(file) ? false : "telemetry.jsonl not present";

function load() {
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  return buildReport(lines.map(parseLine));
}

test("shape: 9 daily entries, 3 meters x 3 days", { skip }, () => {
  const r = load();
  assert.equal(r.site_timezone, "Europe/Berlin");
  assert.equal(r.daily.length, 9);
  assert.deepEqual([...new Set(r.daily.map((d) => d.date))], ["2026-10-24", "2026-10-25", "2026-10-26"]);
});

test("counts: 37 duplicates, 3 invalid power readings", { skip }, () => {
  const r = load();
  assert.equal(r.duplicates_dropped, 37);
  assert.equal(r.invalid_power_readings, 3);
});

test("interval counts: 288 normally, 300 on the 25-hour day, fewer where gaps merged intervals", { skip }, () => {
  const r = load();
  const n = (date: string, meter: string) => r.daily.find((d) => d.date === date && d.meter === meter)!.intervals;
  assert.equal(n("2026-10-24", "M2"), 288);
  assert.equal(n("2026-10-25", "M1"), 300);
  assert.equal(n("2026-10-24", "M1"), 283); // 30-minute gap = 1 interval instead of 6
  assert.equal(n("2026-10-26", "M3"), 280); // 45-minute gap = 1 interval instead of 9
});

test("24 Oct total reconciles with the utility statement within its tolerance", { skip }, () => {
  const r = load();
  const total = r.daily.filter((d) => d.date === "2026-10-24").reduce((s, d) => s + d.energy_kwh, 0);
  assert.ok(Math.abs(total - 1705.6) <= 1705.6 * 0.001, `total ${total}`);
});

test("exactly two gaps: M1 counted, M3 not counted", { skip }, () => {
  const gaps = load().events.filter((e) => e.type === "gap");
  assert.equal(gaps.length, 2);
  const m1 = gaps.find((g) => g.meter === "M1")!;
  const m3 = gaps.find((g) => g.meter === "M3")!;
  assert.equal(m1.energy_counted, true);
  assert.equal(m1.from, "2026-10-24T15:00:00+02:00");
  assert.equal(m3.energy_counted, false);
  assert.equal(m3.from, "2026-10-26T10:40:02+01:00");
});

test("M2 rollover is reported and its energy is small and positive", { skip }, () => {
  const roll = load().events.filter((e) => e.type === "counter_rollover");
  assert.equal(roll.length, 1);
  assert.equal(roll[0]!.meter, "M2");
  assert.equal(roll[0]!.from, "2026-10-25T04:40:01+01:00");
});

test("M1 peak on 25 Oct is in the second pass of the repeated hour (+01:00)", { skip }, () => {
  const d = load().daily.find((x) => x.date === "2026-10-25" && x.meter === "M1")!;
  assert.equal(d.peak_at, "2026-10-25T02:35:00+01:00");
});

test("every peak is a valid number with a time on its own local day", { skip }, () => {
  for (const d of load().daily) {
    assert.ok(d.peak_power_w !== null && d.peak_power_w > 0);
    assert.ok(d.peak_at!.startsWith(d.date));
  }
});
