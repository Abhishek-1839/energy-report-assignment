# Take-home: daily energy report

**Use AI as much as you like.** We all do. We don't mark you on whether or how much you
used it. We mark the result, and what you caught.

Expected effort: 3–4 hours. Please don't spend more than 6. Send it back within 3 days.

## Background

A cold store in Germany has three energy meters (M1, M2, M3), all PM-3 model. A gateway
on site polls them over Modbus every 5 minutes and publishes each read to an MQTT
broker. We logged everything the broker delivered over three days into
`telemetry.jsonl`, one JSON object per line.

The customer wants a daily report per meter.

## Files

| File | What it is |
|---|---|
| `telemetry.jsonl` | Raw data, exactly as the broker delivered it |
| `register-map.md` | The meter vendor's register map |
| `billing-statement.txt` | An excerpt from the utility's statement for the site |

## Telemetry format

```json
{"gw_seq":50001,"ts":"2026-10-24 00:00:00","meter":"M1","unit_id":1,"fc":3,
 "start_addr":100,"qty":7,"regs":[...],"fw_msg":"OK"}
```

| Field | Meaning |
|---|---|
| `gw_seq` | Assigned by the gateway in polling order. Strictly increasing |
| `ts` | Gateway wall-clock time when the read was made. The gateway clock runs on local time for the site (Europe/Berlin) |
| `meter` | Meter name |
| `unit_id`, `fc` | Modbus unit id and function code |
| `start_addr` | Modbus protocol (PDU) address of the first register read |
| `qty` | Number of registers read |
| `regs` | Register values, in address order starting at `start_addr` |
| `fw_msg` | Free text from the gateway firmware |

The broker uses QoS 1.

## What to build

A command-line tool in **TypeScript on Node 20+** that reads `telemetry.jsonl` and writes
the report below as JSON to stdout. No database or network needed.

```
npm install
npm start -- telemetry.jsonl > output.json
npm test
```

### Rules

1. Report the local days 2026-10-24, 2026-10-25 and 2026-10-26 (Europe/Berlin).
2. An **interval** is the time between two consecutive reads of the same meter. The
   energy for an interval is the change in that meter's energy counter.
3. An interval's energy belongs to the local day on which the interval **starts**.
4. Daily energy for a meter is the sum of its intervals' energy for that day.
5. An interval longer than 7 minutes 30 seconds is a **gap**. Report every gap.
6. Never invent energy. If an interval's energy cannot be known from the counter, count
   0 for it and report it.
7. Peak power is the meter's highest valid three-phase total active power on that
   local day, with its time.
8. Times in the output are ISO 8601 local time with the UTC offset, for example
   `2026-10-24T09:00:00+02:00`.

### Output

```json
{
  "site_timezone": "Europe/Berlin",
  "daily": [
    {
      "date": "2026-10-24",
      "meter": "M1",
      "energy_kwh": 0.00,
      "intervals": 0,
      "peak_power_w": 0.0,
      "peak_at": "2026-10-24T00:00:00+02:00"
    }
  ],
  "events": [
    { "meter": "M1", "type": "gap", "from": "...", "to": "...", "energy_counted": true }
  ],
  "duplicates_dropped": 0,
  "invalid_power_readings": 0
}
```

- `daily`: one entry per meter per day, 9 in all. `energy_kwh` to 2 decimals,
  `peak_power_w` to 1 decimal. `intervals` is the number of intervals attributed to
  that day.
- `events`: anything unusual you found in the data that affects the numbers. Use
  `type` values of your choosing, but keep `gap` for gaps.

### Notes from the kickoff call (informal)

> Customer: "Daily energy is simple — take the last counter reading of the day and
> subtract the first one. Our old system did it that way."

## What to send back

1. **The code**: a Git repo (zip it, or send a link), with tests.
2. **`output.json`**: produced by your tool from the supplied data.
3. **`NOTES.md`**: one page at most, plain English:
   - Anything in this brief or the register map that is unclear or contradicts
     something else, and what you decided.
   - **Every place the AI got something wrong**: what it said or wrote, how you found
     out, and what you did about it. Be specific.
   - How you checked your numbers are right.
   - What you did not check.
4. **Your AI conversations, complete and unedited.** Export or copy-paste is fine. Say
   which tools and models you used. If you used none, say so.

You may email us questions. Whether or not you ask, write down in `NOTES.md` every
decision you made where the brief left room.

Please do not edit the data files.
