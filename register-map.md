# PM-3 energy meter — Modbus register map (excerpt)

Holding registers, read with function code 03.

## Addressing

Addresses in the table are in Modicon notation (4xxxx, 1-based).
Protocol (PDU) address = table address − 40001.

## Data types

| Type | Registers | Notes |
|------|-----------|-------|
| uint16 | 1 | |
| int16 | 1 | Two's complement |
| uint32 | 2 | See word order |
| float32 | 2 | IEEE 754 single precision. See word order |

**Word order.** 32-bit values use two consecutive registers, **low word first**: the
register at the lower address holds the least significant 16 bits. Bytes inside each
register are big-endian.

**Not available.** A float32 value of `0x7FC00000` means "value not available" (for
example, while the measurement settles after a range change). It is not a reading.

## Registers

| Address | Name | Type | Unit | Notes |
|---|---|---|---|---|
| 40100 | Model ID | uint16 | — | `0x1F4A` for PM-3 |
| 40101–40102 | Active power, per phase | float32 | W | Import is positive. Note 5 |
| 40103–40104 | Active energy import counter | uint32 | 10^SF Wh | Notes 1–3 |
| 40105 | Energy scale factor (SF) | int16 | — | Power of ten. Note 3 |
| 40106–40107 | Uptime | uint32 | s | Seconds since power-up |

## Notes

1. The energy counter is cumulative. After 4 294 967 295 it rolls over to 0 and keeps
   counting.
2. The counter is saved to non-volatile memory at the top of each hour (hh:00). After a
   power loss the meter resumes from the last saved value. Energy counted between that
   save and the power loss is lost from the counter.
3. Energy in Wh = counter × 10^SF. SF is set at the factory per meter and does not change
   in operation.
4. Uptime resets to 0 at power-up.
5. Active power is measured on L1 and reported per phase. For the three-phase total,
   multiply by 3 (balanced load assumed).
