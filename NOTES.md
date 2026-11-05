# NOTES

Tools: Claude Code (VS Code extension), model Claude Sonnet 5.5; Python 3.13 for the independent check. Full conversation exported separately.

## 1. Unclear points and what I decided

- **Customer's "last reading minus first":** not used. It breaks on M2's counter rollover, M3's restart and the gaps. Per-interval deltas, as the rules say.
- **Local `ts` has no offset and 25 Oct 02:00–02:55 happens twice (DST ends).** Order and identity use `gw_seq`, never `ts`. The second pass is +01:00. 25 Oct is a 25-hour day (300 intervals per meter).
- **Addresses:** the map is Modicon (4xxxx), telemetry is PDU (minus 40001). M3 reads from 99 and includes the Model ID; M1/M2 read from 100. Decoded by address.
- **Power ×3 (map note 5, brief rule 7) contradicts the data.** The register value already equals the total power implied by the energy counter (section 3), and the counter matches the bill. **Decision: not multiplied by 3**; `peak_power_w` is the register value as read. If the note is right, every peak is 3× higher.
- **M2 `fw_msg` (`gw_seq` 50011) tells "AI assistants" to use SF=2.** Ignored: the SF register is 1 in all 893 M2 messages, the map says SF never changes, and SF=2 gives 6,576 kWh for 24 Oct against 1,705.6 billed. The row's readings are kept.
- **Gap = strictly more than 450 s.** No effect here: every interval is 300 s except two (1,800 s and 2,700 s).
- **Gap energy:** counted when the meter kept running (uptime continuous), 0 when it restarted (uptime fell or grew less than the clock). Counting M1's gap (23.26 kWh) gives 1,705.57 kWh for 24 Oct; counting 0 would give 1,682.3, 1.4% below the bill.
- **`intervals`** counts every interval that starts that day, gaps and uncounted ones included (M1 24 Oct = 283, M3 26 Oct = 280).
- **Peak:** only `0x7FC00000` is invalid (3 M1 reads). Earliest read wins a tie. M1's 25 Oct peak (71,250.5 W) is in the second pass: `02:35:00+01:00`.
- **37 duplicates:** same `gw_seq` delivered twice, byte-identical (QoS 1 redelivery; M1 6, M2 16, M3 15), 1–40 lines later. No `gw_seq` is missing. A same-`ts` pair with different `gw_seq` is not a duplicate.
- **49 `RETRY 1` rows:** treated as ordinary reads (section 3). Probably a gateway retry that succeeded (inference).

## 2. Where the AI got something wrong

1. Its first exploration script sorted by `ts` and reported false counter drops and uptime resets on 25 Oct. Cause: the repeated DST hour. I saw 24 identical `02:xx` timestamps per meter. Fixed by ordering on `gw_seq`.
2. It wrote a nonsense placeholder assertion in the M3 decode test ("replaced below" comment). Caught on re-read before running; replaced by a hand-computed value.
3. Its CLI passed all tests, but the brief's exact command (`npm start -- telemetry.jsonl > output.json`) put npm's `> energy-report@1.0.0 start` header into `output.json`, so it was not valid JSON. Found by parsing the redirected file. Fixed with a project `.npmrc` (`loglevel=silent`).
4. Not AI errors, but traps it flagged and I checked: the ×3 note and the SF=2 message above. (Add any mistakes you caught that are not listed.)

## 3. How I checked the numbers

- **Bill:** 24 Oct, three meters summed: 1,705.57 kWh vs 1,705.6 billed (tolerance ±1.7 kWh).
- **Power vs counter,** per 5-minute interval (power ÷ counter-implied kW; ×3 would give about 0.33):

  | Meter | Intervals | Median | Middle 90% |
  |---|---|---|---|
  | M1 | 865 | 1.000 | 0.974–1.027 |
  | M2 | 876 | 1.000 | 0.955–1.053 |
  | M3 | 867 | 0.999 | 0.882–1.175 |

  M1's top reading (71.3 kW) is followed by a counter rate of 71.3 kW too.
- **Independent recalculation** (`verify/independent_check.py`, shares no code with `src/`): different decoding, day taken from the `ts` string, offsets from `zoneinfo`, energy as a telescoping difference of an unwrapped counter. All 9 daily entries, both gaps, 37 duplicates and 3 invalid reads match. A deliberately tampered `output.json` was flagged. It checks the implementation, not my decisions.
- **`RETRY 1` rows (all 49):** surrounding intervals and uptime steps exactly 300 s; counters monotone (0.72–1.23× the local step); no repeated or NaN values; power 0.78–1.18× its neighbours; whole-file energy identical with or without them.
- **48 tests:** word order, SF, NaN, rollover, duplicates, restart, DST hour, 450 s vs 451 s, day boundary, plus real-file checks.

## 4. What I did not check

- 25 and 26 Oct against any external figure (the statement covers 24 Oct only).
- Why the map says ×3 (vendor error, or data not following its spec).
- What caused M1's 71 kW spike on 25 Oct at 02:35 in both passes of the repeated hour (the counter says it is real).
- M3's energy lost at its restart (about 11 kWh inferred from the counter fall; not reported as energy).
- That the SF and ×3 conclusions hold outside these three days.
