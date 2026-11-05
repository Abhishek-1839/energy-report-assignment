import { test } from "node:test";
import assert from "node:assert/strict";
import { candidateInstants, formatIso, localDate, offsetMinutesAt, resolveInstants } from "../src/time.js";

const utc = (iso: string): number => Date.parse(iso);

test("offsets: CEST before the change, CET after", () => {
  assert.equal(offsetMinutesAt(utc("2026-10-24T12:00:00Z")), 120);
  assert.equal(offsetMinutesAt(utc("2026-10-25T00:59:59Z")), 120);
  assert.equal(offsetMinutesAt(utc("2026-10-25T01:00:00Z")), 60);
  assert.equal(offsetMinutesAt(utc("2026-10-26T12:00:00Z")), 60);
});

test("ordinary wall-clock time has exactly one instant", () => {
  assert.deepEqual(candidateInstants("2026-10-24 09:00:00"), [utc("2026-10-24T07:00:00Z")]);
  assert.deepEqual(candidateInstants("2026-10-26 09:00:00"), [utc("2026-10-26T08:00:00Z")]);
});

test("repeated hour has two instants, CEST first", () => {
  assert.deepEqual(candidateInstants("2026-10-25 02:30:00"), [
    utc("2026-10-25T00:30:00Z"),
    utc("2026-10-25T01:30:00Z"),
  ]);
});

test("boundaries of the repeated hour", () => {
  assert.equal(candidateInstants("2026-10-25 01:59:59").length, 1);
  assert.equal(candidateInstants("2026-10-25 02:00:00").length, 2);
  assert.equal(candidateInstants("2026-10-25 02:59:59").length, 2);
  assert.equal(candidateInstants("2026-10-25 03:00:00").length, 1);
});

test("resolveInstants puts the second pass through 02:xx on +01:00", () => {
  const stamps = [
    "2026-10-25 01:55:00",
    "2026-10-25 02:00:00",
    "2026-10-25 02:55:00",
    "2026-10-25 02:00:00", // second pass
    "2026-10-25 02:55:00",
    "2026-10-25 03:00:00",
  ];
  const got = resolveInstants(stamps).map(formatIso);
  assert.deepEqual(got, [
    "2026-10-25T01:55:00+02:00",
    "2026-10-25T02:00:00+02:00",
    "2026-10-25T02:55:00+02:00",
    "2026-10-25T02:00:00+01:00",
    "2026-10-25T02:55:00+01:00",
    "2026-10-25T03:00:00+01:00",
  ]);
});

test("resolved instants are strictly increasing across the change", () => {
  const stamps = ["2026-10-25 02:55:00", "2026-10-25 02:00:00", "2026-10-25 02:05:00"];
  const t = resolveInstants(stamps);
  assert.equal(t[1]! - t[0]!, 5 * 60 * 1000); // 02:55 CEST -> 02:00 CET is 5 minutes
  assert.equal(t[2]! - t[1]!, 5 * 60 * 1000);
});

test("a clock that really goes backwards is rejected", () => {
  assert.throws(() => resolveInstants(["2026-10-24 10:00:00", "2026-10-24 09:00:00"]), /backwards/);
});

test("formatIso gives local time with offset", () => {
  assert.equal(formatIso(utc("2026-10-24T07:00:00Z")), "2026-10-24T09:00:00+02:00");
  assert.equal(formatIso(utc("2026-10-26T23:00:00Z")), "2026-10-27T00:00:00+01:00");
});

test("localDate follows Berlin, not UTC", () => {
  assert.equal(localDate(utc("2026-10-24T22:00:00Z")), "2026-10-25");
  assert.equal(localDate(utc("2026-10-24T21:59:59Z")), "2026-10-24");
  assert.equal(localDate(utc("2026-10-25T23:00:00Z")), "2026-10-26"); // CET midnight
});

test("25 Oct is a 25-hour local day", () => {
  const start = utc("2026-10-24T22:00:00Z"); // 25 Oct 00:00 CEST
  const end = utc("2026-10-25T23:00:00Z"); // 26 Oct 00:00 CET
  assert.equal((end - start) / 3600000, 25);
});
