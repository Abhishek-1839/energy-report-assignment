import type { Reading } from "./decode.js";

export const GAP_THRESHOLD_S = 450; // 7m30s; strictly longer is a gap
const UPTIME_TOLERANCE_S = 2;
const COUNTER_MODULUS = 0x1_0000_0000; // uint32 rolls over to 0 after 4294967295

export type Unknowable = "meter_restart" | "scale_factor_changed";

export interface TimedReading extends Reading {
  /** Resolved instant of the read (epoch ms). */
  instantMs: number;
}

export interface Interval {
  meter: string;
  startMs: number;
  endMs: number;
  seconds: number;
  isGap: boolean;
  /** Energy for the interval in kWh; 0 when it cannot be known from the counter. */
  energyKwh: number;
  energyCounted: boolean;
  /** Why the energy is not counted, when it is not. */
  unknown?: Unknowable;
  /** True when the counter passed 4294967295 and wrapped within this interval. */
  rollover: boolean;
}

/**
 * Intervals between consecutive reads of ONE meter (readings already in polling order).
 *
 * Energy is the counter change. It is not knowable when:
 *  - the meter restarted: uptime went backwards or grew by less than the clock did.
 *    The counter then resumed from the last hourly save, so the delta is meaningless.
 *  - the scale factor differs between the two reads.
 * Otherwise a falling counter is a uint32 rollover and 2^32 is added back.
 */
export function buildIntervals(readings: TimedReading[]): Interval[] {
  const out: Interval[] = [];
  for (let i = 1; i < readings.length; i++) {
    const a = readings[i - 1]!;
    const b = readings[i]!;
    const seconds = (b.instantMs - a.instantMs) / 1000;
    const base = {
      meter: b.meter,
      startMs: a.instantMs,
      endMs: b.instantMs,
      seconds,
      isGap: seconds > GAP_THRESHOLD_S,
    };

    const restarted = b.uptimeS < a.uptimeS || b.uptimeS - a.uptimeS + UPTIME_TOLERANCE_S < seconds;
    if (restarted || a.sf !== b.sf) {
      out.push({
        ...base,
        energyKwh: 0,
        energyCounted: false,
        unknown: restarted ? "meter_restart" : "scale_factor_changed",
        rollover: false,
      });
      continue;
    }

    let delta = b.counter - a.counter;
    let rollover = false;
    if (delta < 0) {
      delta += COUNTER_MODULUS;
      rollover = true;
    }
    out.push({
      ...base,
      energyKwh: (delta * 10 ** a.sf) / 1000,
      energyCounted: true,
      rollover,
    });
  }
  return out;
}
