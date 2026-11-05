import { test } from "node:test";
import assert from "node:assert/strict";
import type { RawRecord } from "../src/decode.js";
import { dedupeAndOrder } from "../src/dedupe.js";

const rec = (gw_seq: number, ts = "2026-10-24 00:00:00", meter = "M1"): RawRecord => ({
  gw_seq,
  ts,
  meter,
  unit_id: 1,
  fc: 3,
  start_addr: 100,
  qty: 1,
  regs: [gw_seq],
  fw_msg: "OK",
});

test("identical redelivery is dropped and counted", () => {
  const r = dedupeAndOrder([rec(1), rec(2), rec(1)]);
  assert.deepEqual(r.records.map((x) => x.gw_seq), [1, 2]);
  assert.equal(r.duplicatesDropped, 1);
});

test("out-of-order delivery is sorted by gw_seq", () => {
  const r = dedupeAndOrder([rec(3), rec(1), rec(2)]);
  assert.deepEqual(r.records.map((x) => x.gw_seq), [1, 2, 3]);
  assert.equal(r.duplicatesDropped, 0);
});

test("same timestamp, different gw_seq is NOT a duplicate (repeated DST hour)", () => {
  const r = dedupeAndOrder([rec(1, "2026-10-25 02:05:00"), rec(2, "2026-10-25 02:05:00")]);
  assert.equal(r.records.length, 2);
  assert.equal(r.duplicatesDropped, 0);
});

test("same gw_seq with different content is an error, not a silent drop", () => {
  const a = rec(1);
  const b = { ...rec(1), regs: [999] };
  assert.throws(() => dedupeAndOrder([a, b]), /different content/);
});
