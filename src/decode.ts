// Decoding of raw telemetry lines using the PM-3 register map.
// Register map addresses are Modicon (4xxxx); telemetry uses PDU addresses (= table - 40001).

export interface RawRecord {
  gw_seq: number;
  ts: string;
  meter: string;
  unit_id: number;
  fc: number;
  start_addr: number;
  qty: number;
  regs: number[];
  fw_msg: string;
}

export interface Reading {
  gwSeq: number;
  ts: string; // gateway local wall-clock, no offset
  meter: string;
  /** Per-phase active power in W, or null when the meter reported "not available". */
  phasePowerW: number | null;
  /** Raw uint32 energy counter (unscaled). */
  counter: number;
  /** Power-of-ten scale factor; energy Wh = counter * 10^sf. */
  sf: number;
  uptimeS: number;
}

// PDU addresses = Modicon table address - 40001
const ADDR_MODEL = 99;
const ADDR_POWER = 100;
const ADDR_ENERGY = 102;
const ADDR_SF = 104;
const ADDR_UPTIME = 105;
const MODEL_PM3 = 0x1f4a;
const NA_FLOAT_BITS = 0x7fc00000;

export function parseLine(line: string): RawRecord {
  const o = JSON.parse(line) as RawRecord;
  if (!Array.isArray(o.regs) || o.regs.length !== o.qty) {
    throw new Error(`gw_seq ${o.gw_seq}: regs length does not match qty`);
  }
  return o;
}

/** Two consecutive registers, low word first, as an unsigned 32-bit value. */
export function u32LowWordFirst(lo: number, hi: number): number {
  return hi * 0x10000 + lo;
}

/** float32 from two registers (low word first), or null for the "not available" marker. */
export function f32LowWordFirst(lo: number, hi: number): number | null {
  const bits = u32LowWordFirst(lo, hi);
  if (bits === NA_FLOAT_BITS) return null;
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(bits, 0);
  const v = buf.readFloatBE(0);
  return Number.isFinite(v) ? v : null;
}

export function int16(v: number): number {
  return v > 0x7fff ? v - 0x10000 : v;
}

export function decodeRecord(r: RawRecord): Reading {
  if (r.fc !== 3) throw new Error(`gw_seq ${r.gw_seq}: unexpected function code ${r.fc}`);
  const at = (addr: number): number => {
    const v = r.regs[addr - r.start_addr];
    if (v === undefined || addr < r.start_addr) {
      throw new Error(`gw_seq ${r.gw_seq}: address ${addr} not in read (${r.start_addr}+${r.qty})`);
    }
    return v;
  };

  if (r.start_addr <= ADDR_MODEL && at(ADDR_MODEL) !== MODEL_PM3) {
    throw new Error(`gw_seq ${r.gw_seq}: unexpected model id ${at(ADDR_MODEL)}`);
  }

  return {
    gwSeq: r.gw_seq,
    ts: r.ts,
    meter: r.meter,
    phasePowerW: f32LowWordFirst(at(ADDR_POWER), at(ADDR_POWER + 1)),
    counter: u32LowWordFirst(at(ADDR_ENERGY), at(ADDR_ENERGY + 1)),
    sf: int16(at(ADDR_SF)),
    uptimeS: u32LowWordFirst(at(ADDR_UPTIME), at(ADDR_UPTIME + 1)),
  };
}
