// Europe/Berlin wall-clock <-> instant, without external libraries.
// The gateway stamps local time with no offset, so in the hour DST ends the same
// wall-clock value occurs twice. Order (gw_seq) decides which one a read belongs to.

export const SITE_TZ = "Europe/Berlin";

const fmt = new Intl.DateTimeFormat("en-US", {
  timeZone: SITE_TZ,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface LocalParts {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  s: number;
}

function localParts(utcMs: number): LocalParts {
  const p: Record<string, number> = {};
  for (const part of fmt.formatToParts(new Date(utcMs))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { y: p.year!, mo: p.month!, d: p.day!, h: p.hour!, mi: p.minute!, s: p.second! };
}

/** UTC offset of the site at an instant, in minutes (+120 summer, +60 winter). */
export function offsetMinutesAt(utcMs: number): number {
  const p = localParts(utcMs);
  const asUtc = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** Parse "YYYY-MM-DD HH:MM:SS" as if it were UTC, giving a "naive local" millisecond value. */
function naiveMs(ts: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(ts);
  if (!m) throw new Error(`bad timestamp: ${ts}`);
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

/**
 * All instants (ascending) at which the local wall-clock reads `ts`:
 * one normally, two in the repeated hour, none in a skipped hour.
 */
export function candidateInstants(ts: string): number[] {
  const naive = naiveMs(ts);
  const HALF_DAY = 12 * 3600 * 1000;
  const offsets = new Set([offsetMinutesAt(naive - HALF_DAY), offsetMinutesAt(naive + HALF_DAY)]);
  const out: number[] = [];
  for (const off of offsets) {
    const utc = naive - off * 60000;
    if (offsetMinutesAt(utc) === off) out.push(utc);
  }
  return out.sort((a, b) => a - b);
}

/**
 * Resolve wall-clock stamps, given in polling order, to instants. The clock never runs
 * backwards in real time, so each read takes the earliest candidate that is not before
 * the previous read. That puts the second pass through the repeated hour on +01:00.
 */
export function resolveInstants(stampsInPollingOrder: string[]): number[] {
  const out: number[] = [];
  let prev = -Infinity;
  for (const ts of stampsInPollingOrder) {
    const cands = candidateInstants(ts);
    if (cands.length === 0) throw new Error(`${ts} does not exist in ${SITE_TZ}`);
    const pick = cands.find((c) => c >= prev);
    if (pick === undefined) throw new Error(`${ts} is earlier than the previous read; clock went backwards`);
    out.push(pick);
    prev = pick;
  }
  return out;
}

const pad = (n: number, w = 2): string => String(n).padStart(w, "0");

/** Local calendar date (YYYY-MM-DD) at an instant. */
export function localDate(utcMs: number): string {
  const p = localParts(utcMs);
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}`;
}

/** ISO 8601 local time with UTC offset, e.g. 2026-10-24T09:00:00+02:00. */
export function formatIso(utcMs: number): string {
  const p = localParts(utcMs);
  const off = offsetMinutesAt(utcMs);
  const sign = off < 0 ? "-" : "+";
  const a = Math.abs(off);
  return (
    `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}` +
    `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`
  );
}
