import { test } from "node:test";
import assert from "node:assert/strict";
import { buildIntervals, type TimedReading } from "../src/intervals.js";

let seq = 0;
const rd = (tSec: number, counter: number, uptimeS: number, sf = 0): TimedReading => ({
  gwSeq: ++seq,
  ts: "",
  meter: "M1",
  phasePowerW: 1000,
  counter,
  sf,
  uptimeS,
  instantMs: tSec * 1000,
});

test("normal interval: counter delta scaled by 10^SF into kWh", () => {
  const [i] = buildIntervals([rd(0, 1000, 100, 0), rd(300, 3000, 400, 0)]);
  assert.equal(i!.energyKwh, 2); // 2000 Wh
  assert.equal(i!.energyCounted, true);
  assert.equal(i!.isGap, false);
});

test("SF=1 and SF=-1 scale correctly", () => {
  assert.equal(buildIntervals([rd(0, 0, 0, 1), rd(300, 100, 300, 1)])[0]!.energyKwh, 1); // 100*10 Wh
  assert.equal(buildIntervals([rd(0, 0, 0, -1), rd(300, 100, 300, -1)])[0]!.energyKwh, 0.01); // 100*0.1 Wh
});

test("uint32 rollover adds 2^32 back", () => {
  const [i] = buildIntervals([rd(0, 4294967264, 0), rd(300, 47, 300)]);
  assert.equal(i!.rollover, true);
  assert.equal(i!.energyCounted, true);
  assert.equal(i!.energyKwh, (47 + 4294967296 - 4294967264) / 1000); // 79 Wh
});

test("exactly 450 s is not a gap; 451 s is", () => {
  assert.equal(buildIntervals([rd(0, 0, 0), rd(450, 1, 450)])[0]!.isGap, false);
  assert.equal(buildIntervals([rd(0, 0, 0), rd(451, 1, 451)])[0]!.isGap, true);
});

test("gap with continuous uptime still counts its energy", () => {
  const [i] = buildIntervals([rd(0, 0, 1000), rd(1800, 23258, 2800)]);
  assert.equal(i!.isGap, true);
  assert.equal(i!.energyCounted, true);
  assert.equal(i!.energyKwh, 23.258);
});

test("restart (uptime fell) is not counted, even though the counter fell back", () => {
  const [i] = buildIntervals([rd(0, 15794389, 466179), rd(2700, 15684399, 202)]);
  assert.equal(i!.isGap, true);
  assert.equal(i!.energyCounted, false);
  assert.equal(i!.energyKwh, 0);
  assert.equal(i!.unknown, "meter_restart");
  assert.equal(i!.rollover, false);
});

test("restart is detected even if uptime did not go below its old value", () => {
  // off for ~1 hour but uptime only advanced 300 s
  const [i] = buildIntervals([rd(0, 100, 1000), rd(3600, 90, 1300)]);
  assert.equal(i!.energyCounted, false);
  assert.equal(i!.unknown, "meter_restart");
});

test("a restart is not mistaken for a rollover", () => {
  const [i] = buildIntervals([rd(0, 5000, 9000), rd(300, 4000, 10)]);
  assert.equal(i!.rollover, false);
  assert.equal(i!.energyKwh, 0);
});

test("changed scale factor is not counted", () => {
  const [i] = buildIntervals([rd(0, 0, 0, 0), rd(300, 10, 300, 1)]);
  assert.equal(i!.energyCounted, false);
  assert.equal(i!.unknown, "scale_factor_changed");
});

test("interval length comes from resolved instants (DST hour is 5 minutes, not 55)", () => {
  // 02:55 CEST -> 02:00 CET is 5 minutes of real time
  const [i] = buildIntervals([rd(0, 0, 0), rd(300, 1, 300)]);
  assert.equal(i!.seconds, 300);
});
