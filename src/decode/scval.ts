import { xdr, Address, scValToNative } from "@stellar/stellar-sdk";

export interface DecodeResult<T = unknown> {
  success: boolean;
  value?: T | undefined;
  error?: string | undefined;
  rawXdr: string;
}

/**
 * Decodes a single ScVal from base64 XDR or xdr.ScVal into native JavaScript value.
 * Never throws: wraps any parsing or decoding error in DecodeResult.
 */
export function decodeScVal(input: string | xdr.ScVal): DecodeResult {
  const rawXdr = typeof input === "string" ? input : input.toXDR("base64");

  try {
    let scVal: xdr.ScVal;
    if (typeof input === "string") {
      scVal = xdr.ScVal.fromXDR(input, "base64");
    } else {
      scVal = input;
    }

    const nativeValue = convertScValToNative(scVal);
    return {
      success: true,
      value: nativeValue,
      rawXdr,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      error: errorMsg,
      rawXdr,
    };
  }
}

/**
 * Custom recursive conversion that handles Addresses, BigInts, Symbols,
 * Byte arrays, Vectors, and Maps reliably.
 */
export function convertScValToNative(scVal: xdr.ScVal): unknown {
  const scValAny = scVal as any;
  const switchVal = typeof scValAny.switch === "function" ? scValAny.switch() : null;
  const switchName = (
    switchVal && typeof switchVal.name === "string"
      ? switchVal.name
      : typeof scValAny.arm === "string"
        ? scValAny.arm
        : ""
  )
    .toLowerCase()
    .replace(/^scv/, "");

  switch (switchName) {
    case "b":
    case "bool":
      return typeof scValAny.b === "function" ? scValAny.b() : scValToNative(scVal);

    case "void":
      return null;

    case "u32":
      return typeof scValAny.u32 === "function" ? scValAny.u32() : scValToNative(scVal);

    case "i32":
      return typeof scValAny.i32 === "function" ? scValAny.i32() : scValToNative(scVal);

    case "u64": {
      const u64Val = typeof scValAny.u64 === "function" ? scValAny.u64() : scValAny.value();
      return BigInt(u64Val.toString());
    }

    case "i64": {
      const i64Val = typeof scValAny.i64 === "function" ? scValAny.i64() : scValAny.value();
      return BigInt(i64Val.toString());
    }

    case "u128": {
      const parts = typeof scValAny.u128 === "function" ? scValAny.u128() : scValAny.value();
      const hi = BigInt(parts.hi().toString());
      const lo = BigInt(parts.lo().toString());
      return (hi << 64n) | lo;
    }

    case "i128": {
      const parts = typeof scValAny.i128 === "function" ? scValAny.i128() : scValAny.value();
      const hi = BigInt(parts.hi().toString());
      const lo = BigInt(parts.lo().toString());
      // Reconstruct signed 128-bit integer
      const unsigned = (hi << 64n) | lo;
      const signBit = 1n << 127n;
      return (unsigned & signBit) !== 0n ? unsigned - (1n << 128n) : unsigned;
    }

    case "u256": {
      const parts = typeof scValAny.u256 === "function" ? scValAny.u256() : scValAny.value();
      const hiHi = BigInt(parts.hiHi().toString());
      const hiLo = BigInt(parts.hiLo().toString());
      const loHi = BigInt(parts.loHi().toString());
      const loLo = BigInt(parts.loLo().toString());
      return (hiHi << 192n) | (hiLo << 128n) | (loHi << 64n) | loLo;
    }

    case "i256": {
      const parts = typeof scValAny.i256 === "function" ? scValAny.i256() : scValAny.value();
      const hiHi = BigInt(parts.hiHi().toString());
      const hiLo = BigInt(parts.hiLo().toString());
      const loHi = BigInt(parts.loHi().toString());
      const loLo = BigInt(parts.loLo().toString());
      const unsigned = (hiHi << 192n) | (hiLo << 128n) | (loHi << 64n) | loLo;
      const signBit = 1n << 255n;
      return (unsigned & signBit) !== 0n ? unsigned - (1n << 256n) : unsigned;
    }

    case "sym":
    case "symbol":
      return typeof scValAny.sym === "function"
        ? scValAny.sym().toString()
        : String(scValToNative(scVal));

    case "str":
    case "string":
      return typeof scValAny.str === "function"
        ? scValAny.str().toString()
        : String(scValToNative(scVal));

    case "bytes":
      return Buffer.from(
        typeof scValAny.bytes === "function" ? scValAny.bytes() : scValAny.value(),
      ).toString("hex");

    case "address": {
      try {
        return Address.fromScVal(scVal).toString();
      } catch {
        return scValToNative(scVal);
      }
    }

    case "vec": {
      const vec = typeof scValAny.vec === "function" ? scValAny.vec() : scValAny.value();
      if (!vec) return [];
      return (vec as xdr.ScVal[]).map((item) => convertScValToNative(item));
    }

    case "map": {
      const map = typeof scValAny.map === "function" ? scValAny.map() : scValAny.value();
      if (!map) return {};
      const result: Record<string, unknown> = {};
      for (const entry of map as xdr.ScMapEntry[]) {
        const key = String(convertScValToNative(entry.key()));
        result[key] = convertScValToNative(entry.val());
      }
      return result;
    }

    default:
      return scValToNative(scVal);
  }
}
