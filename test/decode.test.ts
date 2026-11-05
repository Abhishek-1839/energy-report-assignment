import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeRecord, f32LowWordFirst, int16, parseLine, u32LowWordFirst } from "../src/decode.js";

const m1Line =
  '{"gw_seq":50001,"ts":"2026-10-24 00:00:00","meter":"M1","unit_id":1,"fc":3,"start_addr":100,"qty":7,"regs":[10394,18162,52501,1883,0,21271,15],"fw_msg":"OK"}';
const m3Line =
  '{"gw_seq":50003,"ts":"2026-10-24 00:00:02","meter":"M3","unit_id":3,"fc":3,"start_addr":99,"qty":8,"regs":[8010,31949,17749,46143,150,65535,54771,3],"fw_msg":"OK"}';

test("uint32 is low word first", () => {
  assert.equal(u32LowWordFirst(52501, 1883), 1883 * 65536 + 52501);
  assert.equal(u32LowWordFirst(0xffff, 0xffff), 4294967295);
});

test("float32 is low word first; 1.0 = 0x3F800000", () => {
  assert.equal(f32LowWordFirst(0x0000, 0x3f80), 1);
});

test("0x7FC00000 is 'not available', not a reading", () => {
  assert.equal(f32LowWordFirst(0x0000, 0x7fc0), null);
});

test("int16 is two's complement", () => {
  assert.equal(int16(65535), -1);
  assert.equal(int16(1), 1);
  assert.equal(int16(0), 0);
});

test("M1 (start 100, qty 7) decodes", () => {
  const r = decodeRecord(parseLine(m1Line));
  assert.equal(r.meter, "M1");
  assert.equal(r.counter, 1883 * 65536 + 52501);
  assert.equal(r.sf, 0);
  assert.equal(r.uptimeS, 15 * 65536 + 21271);
  assert.ok(r.phasePowerW !== null && r.phasePowerW > 10000 && r.phasePowerW < 100000);
});

test("M3 (start 99, qty 8, includes model id) decodes the same layout", () => {
  const r = decodeRecord(parseLine(m3Line));
  assert.equal(r.counter, 150 * 65536 + 46143);
  assert.equal(r.sf, -1);
  assert.equal(r.uptimeS, u32LowWordFirst(54771, 3));
});

test("wrong model id is rejected", () => {
  const bad = m3Line.replace("[8010,", "[1234,");
  assert.throws(() => decodeRecord(parseLine(bad)), /model id/);
});

test("regs length must match qty", () => {
  const bad = m1Line.replace('"qty":7', '"qty":6');
  assert.throws(() => parseLine(bad), /qty/);
});
