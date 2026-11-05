import { decodeRecord, type RawRecord } from "./decode.js";
import { dedupeAndOrder } from "./dedupe.js";
import { buildIntervals, type Interval, type TimedReading } from "./intervals.js";
import { SITE_TZ, formatIso, localDate, resolveInstants } from "./time.js";

export const REPORT_DAYS = ["2026-10-24", "2026-10-25", "2026-10-26"];

export interface DailyEntry {
  date: string;
  meter: string;
  energy_kwh: number;
  intervals: number;
  peak_power_w: number | null;
  peak_at: string | null;
}

export interface ReportEvent {
  meter: string;
  type: string;
  from: string;
  to: string;
  energy_counted?: boolean;
  detail: string;
}

export interface Report {
  site_timezone: string;
  daily: DailyEntry[];
  events: ReportEvent[];
  duplicates_dropped: number;
  invalid_power_readings: number;
}

const round = (v: number, dp: number): number => Number(v.toFixed(dp));

function intervalEvents(iv: Interval, prev: TimedReading, next: TimedReading): ReportEvent[] {
  const from = formatIso(iv.startMs);
  const to = formatIso(iv.endMs);
  const events: ReportEvent[] = [];

  if (iv.isGap) {
    let detail = `no reads for ${iv.seconds} s`;
    if (iv.unknown === "meter_restart") {
      detail += `; meter restarted (uptime ${prev.uptimeS} s -> ${next.uptimeS} s), counter fell back to its last hourly save, energy not knowable so counted as 0`;
    } else if (iv.unknown === "scale_factor_changed") {
      detail += "; scale factor changed, energy not knowable so counted as 0";
    } else {
      detail += "; meter kept running (uptime continuous), counter change counted";
    }
    events.push({ meter: iv.meter, type: "gap", from, to, energy_counted: iv.energyCounted, detail });
  } else if (!iv.energyCounted) {
    events.push({
      meter: iv.meter,
      type: iv.unknown ?? "energy_unknown",
      from,
      to,
      energy_counted: false,
      detail: "energy not knowable from the counter, counted as 0",
    });
  }

  if (iv.rollover) {
    events.push({
      meter: iv.meter,
      type: "counter_rollover",
      from,
      to,
      energy_counted: true,
      detail: "uint32 energy counter wrapped past 4294967295; 2^32 added back",
    });
  }
  return events;
}

export function buildReport(raw: RawRecord[]): Report {
  const { records, duplicatesDropped } = dedupeAndOrder(raw);
  const instants = resolveInstants(records.map((r) => r.ts));
  const readings: TimedReading[] = records.map((r, i) => ({ ...decodeRecord(r), instantMs: instants[i]! }));

  const meters = [...new Set(readings.map((r) => r.meter))].sort();
  const daily: DailyEntry[] = [];
  const events: ({ at: number } & ReportEvent)[] = [];
  let invalidPower = 0;

  for (const meter of meters) {
    const rs = readings.filter((r) => r.meter === meter);
    const intervals = buildIntervals(rs);

    intervals.forEach((iv, i) => {
      for (const e of intervalEvents(iv, rs[i]!, rs[i + 1]!)) events.push({ at: iv.startMs, ...e });
    });

    for (let i = 1; i < rs.length; i++) {
      const a = rs[i - 1]!;
      const b = rs[i]!;
      if (b.ts < a.ts) {
        events.push({
          at: a.instantMs,
          meter,
          type: "clock_repeated_hour",
          from: formatIso(a.instantMs),
          to: formatIso(b.instantMs),
          detail: `local clock stepped back (${a.ts} -> ${b.ts}, DST ends); reads ordered by gw_seq, not by timestamp`,
        });
      }
    }

    for (const r of rs) {
      if (r.phasePowerW === null) {
        invalidPower++;
        events.push({
          at: r.instantMs,
          meter,
          type: "invalid_power",
          from: formatIso(r.instantMs),
          to: formatIso(r.instantMs),
          detail: "power reported as not available (0x7FC00000); excluded from peak",
        });
      }
    }

    for (const date of REPORT_DAYS) {
      const day = intervals.filter((iv) => localDate(iv.startMs) === date);
      const energy = day.reduce((s, iv) => s + iv.energyKwh, 0);

      // Peak: register value as read (see NOTES.md: it already equals the total). Earliest wins a tie.
      let peak: TimedReading | undefined;
      for (const r of rs) {
        if (r.phasePowerW === null || localDate(r.instantMs) !== date) continue;
        if (!peak || r.phasePowerW > peak.phasePowerW!) peak = r;
      }

      daily.push({
        date,
        meter,
        energy_kwh: round(energy, 2),
        intervals: day.length,
        peak_power_w: peak ? round(peak.phasePowerW!, 1) : null,
        peak_at: peak ? formatIso(peak.instantMs) : null,
      });
    }
  }

  daily.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.meter < b.meter ? -1 : 1));
  events.sort((a, b) => a.at - b.at || (a.meter < b.meter ? -1 : a.meter > b.meter ? 1 : 0));

  return {
    site_timezone: SITE_TZ,
    daily,
    events: events.map(({ at: _at, ...e }) => e),
    duplicates_dropped: duplicatesDropped,
    invalid_power_readings: invalidPower,
  };
}
