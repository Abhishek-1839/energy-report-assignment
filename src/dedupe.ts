import type { RawRecord } from "./decode.js";

export interface Deduped {
  /** Unique records in gateway polling order (ascending gw_seq). */
  records: RawRecord[];
  duplicatesDropped: number;
}

/**
 * QoS 1 can redeliver a message, so the same gw_seq may arrive more than once, and
 * delivery order is not polling order. gw_seq is the identity and the order key.
 * (Timestamps are not: the repeated DST hour gives distinct reads the same `ts`.)
 */
export function dedupeAndOrder(input: RawRecord[]): Deduped {
  const bySeq = new Map<number, RawRecord>();
  let duplicatesDropped = 0;

  for (const rec of input) {
    const seen = bySeq.get(rec.gw_seq);
    if (!seen) {
      bySeq.set(rec.gw_seq, rec);
      continue;
    }
    if (JSON.stringify(seen) !== JSON.stringify(rec)) {
      throw new Error(`gw_seq ${rec.gw_seq} delivered twice with different content`);
    }
    duplicatesDropped++;
  }

  const records = [...bySeq.values()].sort((a, b) => a.gw_seq - b.gw_seq);
  return { records, duplicatesDropped };
}
