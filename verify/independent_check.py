"""Independent re-calculation of output.json. Shares no code with src/.

Differences from the TypeScript tool, on purpose:
  * different language; registers decoded with struct, not arithmetic
  * the local DAY comes straight from the ts string (no timezone maths needed);
    UTC offsets come from zoneinfo, with the repeated hour resolved by "second time
    this meter shows the same ts" instead of a monotonic-clock rule
  * energy is a TELESCOPING sum of an unwrapped counter per day, not a sum of intervals
  * Decimal arithmetic for scaling and rounding

Usage: python verify/independent_check.py telemetry.jsonl output.json
"""
import json
import math
import struct
import sys
from datetime import datetime, timezone
from decimal import ROUND_HALF_EVEN, Decimal
from zoneinfo import ZoneInfo

BERLIN = ZoneInfo("Europe/Berlin")
DAYS = ["2026-10-24", "2026-10-25", "2026-10-26"]


def u32(lo, hi):
    return struct.unpack(">I", struct.pack(">HH", hi, lo))[0]


def f32(lo, hi):
    return struct.unpack(">f", struct.pack(">HH", hi, lo))[0]


def decode(rec):
    regs, a0 = rec["regs"], rec["start_addr"]
    at = lambda addr: regs[addr - a0]  # PDU addresses: power 100, energy 102, sf 104, uptime 105
    p = f32(at(100), at(101))
    sf = at(104)
    return {
        "seq": rec["gw_seq"],
        "ts": rec["ts"],
        "meter": rec["meter"],
        "power": None if math.isnan(p) else p,
        "counter": u32(at(102), at(103)),
        "sf": sf - 65536 if sf > 32767 else sf,
        "uptime": u32(at(105), at(106)),
    }


def main(tele_path, out_path):
    uniq = {}
    for line in open(tele_path, encoding="utf-8"):
        if not line.strip():
            continue
        rec = json.loads(line)
        if rec["gw_seq"] in uniq:
            assert uniq[rec["gw_seq"]] == rec, "conflicting duplicate"
        uniq[rec["gw_seq"]] = rec
    dropped = sum(1 for _ in open(tele_path, encoding="utf-8") if _.strip()) - len(uniq)
    reads = [decode(uniq[k]) for k in sorted(uniq)]

    # real time: second appearance of the same ts for a meter = after the clock went back
    seen = set()
    for r in reads:
        key = (r["meter"], r["ts"])
        fold = 1 if key in seen else 0
        seen.add(key)
        local = datetime.strptime(r["ts"], "%Y-%m-%d %H:%M:%S").replace(tzinfo=BERLIN, fold=fold)
        r["utc"] = local.astimezone(timezone.utc)
        r["iso"] = local.isoformat()
        r["day"] = r["ts"][:10]

    expected = {}
    invalid = sum(1 for r in reads if r["power"] is None)
    gaps = []
    for m in sorted({r["meter"] for r in reads}):
        rs = [r for r in reads if r["meter"] == m]
        for a, b in zip(rs, rs[1:]):
            if (b["utc"] - a["utc"]).total_seconds() > 450:
                gaps.append((m, a["iso"], b["iso"], b["uptime"] >= a["uptime"]))

        # unwrap the counter inside each segment between restarts (uptime going backwards)
        seg, wraps = 0, 0
        for i, r in enumerate(rs):
            if i:
                prev = rs[i - 1]
                if r["uptime"] < prev["uptime"]:
                    seg, wraps = seg + 1, 0
                elif r["counter"] < prev["counter"]:
                    wraps += 1
            r["seg"] = seg
            r["unwrapped"] = r["counter"] + wraps * 2**32

        for day in DAYS:
            starts = [i for i, r in enumerate(rs[:-1]) if r["day"] == day]  # interval starts today
            total_wh = Decimal(0)
            for s in sorted({rs[i]["seg"] for i in starts}):
                idx = [i for i in starts if rs[i]["seg"] == s]
                first, last = idx[0], idx[-1]
                end = last + 1 if rs[last + 1]["seg"] == s else last  # restart interval: unknown, add nothing
                units = rs[end]["unwrapped"] - rs[first]["unwrapped"]
                total_wh += Decimal(units) * (Decimal(10) ** rs[first]["sf"])
            kwh = (total_wh / 1000).quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN)
            valid = [r for r in rs if r["day"] == day and r["power"] is not None]
            peak = max(valid, key=lambda r: (r["power"], -r["utc"].timestamp()))
            expected[(day, m)] = (kwh, len(starts), round(peak["power"], 1), peak["iso"])

    out = json.load(open(out_path, encoding="utf-8"))
    bad = 0
    for d in out["daily"]:
        kwh, n, pk, at = expected[(d["date"], d["meter"])]
        ok = (
            abs(Decimal(str(d["energy_kwh"])) - kwh) <= Decimal("0.01")
            and d["intervals"] == n
            and abs(d["peak_power_w"] - pk) <= 0.05
            and d["peak_at"] == at
        )
        bad += not ok
        print(f"{'OK ' if ok else 'BAD'} {d['date']} {d['meter']}: tool {d['energy_kwh']} kWh/{d['intervals']}/{d['peak_power_w']} W @ {d['peak_at']}"
              f" | independent {kwh} kWh/{n}/{pk} W @ {at}")

    tool_gaps = sorted((e["meter"], e["from"], e["to"], e["energy_counted"]) for e in out["events"] if e["type"] == "gap")
    print("gaps independent:", sorted(gaps))
    print("gaps tool       :", tool_gaps)
    print("duplicates tool/independent:", out["duplicates_dropped"], dropped, "| invalid power tool/independent:", out["invalid_power_readings"], invalid)
    bad += sorted(gaps) != tool_gaps or out["duplicates_dropped"] != dropped or out["invalid_power_readings"] != invalid

    day1 = sum(expected[(DAYS[0], m)][0] for m in ("M1", "M2", "M3"))
    print(f"24 Oct all feeders {day1} kWh vs statement 1705.6 kWh (diff {day1 - Decimal('1705.6')}, tolerance +/-{Decimal('1705.6') * Decimal('0.001'):.2f})")
    print("RESULT:", "ALL MATCH" if not bad else f"{bad} MISMATCH(ES)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2]))
