import { test } from "node:test";
import assert from "node:assert/strict";
import type { RawRecord } from "../src/decode.js";
import { buildReport } from "../src/report.js";

let seq = 1000;
function rec(ts: string, o: { meter?: string; powerW?: number | null; counter: number; sf?: number; uptime: number }): RawRecord {
  const bits = Buffer.alloc(4);
  if (o.powerW === null) bits.writeUInt32BE(0x7fc00000, 0);
  else bits.writeFloatBE(o.powerW ?? 1000, 0);
  const p = bits.readUInt32BE(0);
  return {
    gw_seq: ++seq,
    ts,
    meter: o.meter ?? "M1",
    unit_id: 1,
    fc: 3,
    start_addr: 100,
    qty: 7,
    regs: [p & 0xffff, p >>> 16, o.counter & 0xffff, Math.floor(o.counter / 65536), (o.sf ?? 0) & 0xffff, o.uptime & 0xffff, Math.floor(o.uptime / 65536)],
    fw_msg: "OK",
  };
}

const day = (r: ReturnType<typeof buildReport>, date: string, meter = "M1") =>
  r.daily.find((d) => d.date === date && d.meter === meter)!;

test("an interval belongs to the day it starts, even if it ends after midnight", () => {
  const r = buildReport([
    rec("2026-10-24 23:55:00", { counter: 1000, uptime: 0 }),
    rec("2026-10-25 00:00:00", { counter: 3000, uptime: 300 }), // 2000 Wh, starts on the 24th
    rec("2026-10-25 00:05:00", { counter: 3500, uptime: 600 }), // 500 Wh, starts on the 25th
  ]);
  assert.equal(day(r, "2026-10-24").energy_kwh, 2);
  assert.equal(day(r, "2026-10-24").intervals, 1);
  assert.equal(day(r, "2026-10-25").energy_kwh, 0.5);
  assert.equal(day(r, "2026-10-25").intervals, 1);
});

test("peak ignores 'not available' power and is reported as read (no x3)", () => {
  const r = buildReport([
    rec("2026-10-24 10:00:00", { powerW: 30000, counter: 0, uptime: 0 }),
    rec("2026-10-24 10:05:00", { powerW: null, counter: 10, uptime: 300 }),
    rec("2026-10-24 10:10:00", { powerW: 41234.56, counter: 20, uptime: 600 }),
    rec("2026-10-24 10:15:00", { powerW: 35000, counter: 30, uptime: 900 }),
  ]);
  assert.equal(day(r, "2026-10-24").peak_power_w, 41234.6);
  assert.equal(day(r, "2026-10-24").peak_at, "2026-10-24T10:10:00+02:00");
  assert.equal(r.invalid_power_readings, 1);
  assert.ok(r.events.some((e) => e.type === "invalid_power"));
});

test("a day with no valid power reports null, not a made-up peak", () => {
  const r = buildReport([rec("2026-10-24 10:00:00", { powerW: null, counter: 0, uptime: 0 })]);
  assert.equal(day(r, "2026-10-24").peak_power_w, null);
  assert.equal(day(r, "2026-10-24").peak_at, null);
});

test("scale factor is applied", () => {
  const r = buildReport([
    rec("2026-10-24 10:00:00", { counter: 0, sf: -1, uptime: 0 }),
    rec("2026-10-24 10:05:00", { counter: 1000, sf: -1, uptime: 300 }), // 100 Wh
  ]);
  assert.equal(day(r, "2026-10-24").energy_kwh, 0.1);
});

test("gap events: energy counted when the meter kept running, not when it restarted", () => {
  const kept = buildReport([
    rec("2026-10-24 10:00:00", { counter: 0, uptime: 1000 }),
    rec("2026-10-24 10:30:00", { counter: 5000, uptime: 2800 }),
  ]);
  const g1 = kept.events.find((e) => e.type === "gap")!;
  assert.equal(g1.energy_counted, true);
  assert.equal(day(kept, "2026-10-24").energy_kwh, 5);

  const restarted = buildReport([
    rec("2026-10-24 10:00:00", { counter: 9000, uptime: 5000 }),
    rec("2026-10-24 10:45:00", { counter: 8000, uptime: 100 }),
  ]);
  const g2 = restarted.events.find((e) => e.type === "gap")!;
  assert.equal(g2.energy_counted, false);
  assert.equal(day(restarted, "2026-10-24").energy_kwh, 0);
  assert.equal(day(restarted, "2026-10-24").intervals, 1);
});

test("duplicates are dropped and counted; out-of-order input is fine", () => {
  const a = rec("2026-10-24 10:00:00", { counter: 0, uptime: 0 });
  const b = rec("2026-10-24 10:05:00", { counter: 1000, uptime: 300 });
  const r = buildReport([b, a, b]);
  assert.equal(r.duplicates_dropped, 1);
  assert.equal(day(r, "2026-10-24").energy_kwh, 1);
});

test("repeated DST hour: both passes count, peak time carries the right offset", () => {
  const r = buildReport([
    rec("2026-10-25 02:50:00", { powerW: 1000, counter: 0, uptime: 0 }),
    rec("2026-10-25 02:55:00", { powerW: 1000, counter: 100, uptime: 300 }),
    rec("2026-10-25 02:00:00", { powerW: 9000, counter: 200, uptime: 600 }), // second pass, +01:00
    rec("2026-10-25 02:05:00", { powerW: 1000, counter: 300, uptime: 900 }),
  ]);
  assert.equal(day(r, "2026-10-25").intervals, 3);
  assert.equal(day(r, "2026-10-25").energy_kwh, 0.3);
  assert.equal(day(r, "2026-10-25").peak_at, "2026-10-25T02:00:00+01:00");
  assert.ok(r.events.some((e) => e.type === "clock_repeated_hour"));
});
