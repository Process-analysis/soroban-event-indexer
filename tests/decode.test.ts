import { describe, it, expect } from "vitest";
import { xdr, Address, Keypair } from "@stellar/stellar-sdk";
import { decodeScVal, decodeEvent } from "../src/decode/index.js";

describe("ScVal Decoder Unit Tests", () => {
  it("decodes boolean ScVal (true and false)", () => {
    const valTrue = xdr.ScVal.scvBool(true);
    const resTrue = decodeScVal(valTrue);
    expect(resTrue.success).toBe(true);
    expect(resTrue.value).toBe(true);

    const valFalse = xdr.ScVal.scvBool(false);
    const resFalse = decodeScVal(valFalse);
    expect(resFalse.success).toBe(true);
    expect(resFalse.value).toBe(false);
  });

  it("decodes void ScVal to null", () => {
    const valVoid = xdr.ScVal.scvVoid();
    const res = decodeScVal(valVoid);
    expect(res.success).toBe(true);
    expect(res.value).toBe(null);
  });

  it("decodes u32 and i32 ScVal numbers", () => {
    const u32 = xdr.ScVal.scvU32(12345);
    const resU32 = decodeScVal(u32);
    expect(resU32.success).toBe(true);
    expect(resU32.value).toBe(12345);

    const i32 = xdr.ScVal.scvI32(-42);
    const resI32 = decodeScVal(i32);
    expect(resI32.success).toBe(true);
    expect(resI32.value).toBe(-42);
  });

  it("decodes u64 and i64 ScVal to bigint", () => {
    const u64 = xdr.ScVal.scvU64(new xdr.Uint64([100, 200]));
    const resU64 = decodeScVal(u64);
    expect(resU64.success).toBe(true);
    expect(typeof resU64.value).toBe("bigint");

    const i64 = xdr.ScVal.scvI64(new xdr.Int64([10, 20]));
    const resI64 = decodeScVal(i64);
    expect(resI64.success).toBe(true);
    expect(typeof resI64.value).toBe("bigint");
  });

  it("decodes i128 and u128 to bigint correctly including two's complement negative values", () => {
    // Positive i128: 1000000000000n
    const posParts = new xdr.Int128Parts({
      hi: new xdr.Int64([0, 0]),
      lo: new xdr.Uint64([0, 1000]),
    });
    const i128Pos = xdr.ScVal.scvI128(posParts);
    const resPos = decodeScVal(i128Pos);
    expect(resPos.success).toBe(true);
    expect(typeof resPos.value).toBe("bigint");

    // Negative i128
    const negParts = new xdr.Int128Parts({
      hi: new xdr.Int64([0, -1]),
      lo: new xdr.Uint64([0, -1]),
    });
    const i128Neg = xdr.ScVal.scvI128(negParts);
    const resNeg = decodeScVal(i128Neg);
    expect(resNeg.success).toBe(true);
    expect(typeof resNeg.value).toBe("bigint");
    expect(resNeg.value as bigint).toBeLessThan(0n);
  });

  it("decodes symbols and strings to string", () => {
    const sym = xdr.ScVal.scvSymbol("VeryPrince");
    const resSym = decodeScVal(sym);
    expect(resSym.success).toBe(true);
    expect(resSym.value).toBe("VeryPrince");

    const str = xdr.ScVal.scvString("hello soroban indexer");
    const resStr = decodeScVal(str);
    expect(resStr.success).toBe(true);
    expect(resStr.value).toBe("hello soroban indexer");
  });

  it("decodes account Address and contract Address into strkey strings", () => {
    const kp = Keypair.random();
    const addr = Address.fromString(kp.publicKey());
    const scVal = addr.toScVal();

    const res = decodeScVal(scVal);
    expect(res.success).toBe(true);
    expect(res.value).toBe(kp.publicKey());
  });

  it("decodes byte arrays to hex string", () => {
    const rawBytes = Buffer.from([0xca, 0xfe, 0xba, 0xbe]);
    const scVal = xdr.ScVal.scvBytes(rawBytes);
    const res = decodeScVal(scVal);
    expect(res.success).toBe(true);
    expect(res.value).toBe("cafebabe");
  });

  it("decodes nested vectors and maps", () => {
    const vecVal = xdr.ScVal.scvVec([xdr.ScVal.scvSymbol("org1"), xdr.ScVal.scvU32(100)]);
    const resVec = decodeScVal(vecVal);
    expect(resVec.success).toBe(true);
    expect(resVec.value).toEqual(["org1", 100]);

    const mapVal = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("keyA"),
        val: xdr.ScVal.scvU32(42),
      }),
    ]);
    const resMap = decodeScVal(mapVal);
    expect(resMap.success).toBe(true);
    expect(resMap.value).toEqual({ keyA: 42 });
  });

  it("decodes ScVal directly from valid base64 XDR", () => {
    const sym = xdr.ScVal.scvSymbol("OrgFunded");
    const base64 = sym.toXDR("base64");

    const res = decodeScVal(base64);
    expect(res.success).toBe(true);
    expect(res.value).toBe("OrgFunded");
    expect(res.rawXdr).toBe(base64);
  });

  describe("Edge Cases and Malformed Inputs", () => {
    it("handles invalid base64 input without throwing and returns decode failure", () => {
      const res = decodeScVal("not-valid-base64-!@#$%^&*()");
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
      expect(res.rawXdr).toBe("not-valid-base64-!@#$%^&*()");
    });

    it("handles truncated or corrupt XDR bytes gracefully", () => {
      const res = decodeScVal("AAAAAA=="); // invalid truncated XDR arm
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it("handles empty string gracefully", () => {
      const res = decodeScVal("");
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
    });

    it("decodeEvent isolates corrupt topic and flags decodeError: true", () => {
      const validSym = xdr.ScVal.scvSymbol("VeryPrince").toXDR("base64");
      const corruptXdr = "corrupted_payload_99999";

      const decoded = decodeEvent({
        id: "evt-001",
        type: "contract",
        ledger: 100,
        ledgerClosedAt: "2026-11-08T00:00:00Z",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        topic: [validSym, corruptXdr],
        value: { xdr: validSym },
        pagingToken: "token-001",
      });

      expect(decoded.decodeError).toBe(true);
      expect(decoded.decodeErrorReason).toContain("Failed to decode topic index 1");
      expect(decoded.topics[0]).toBe("VeryPrince");
      expect(decoded.topics[1]).toBe(corruptXdr);
      expect(decoded.rawTopicsXdr).toEqual([validSym, corruptXdr]);
    });

    it("decodeEvent isolates corrupt data payload and preserves rawDataXdr", () => {
      const validSym = xdr.ScVal.scvSymbol("VeryPrince").toXDR("base64");
      const corruptData = "bad_data_123";

      const decoded = decodeEvent({
        id: "evt-002",
        type: "contract",
        ledger: 101,
        ledgerClosedAt: "2026-11-08T00:00:05Z",
        contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        topic: [validSym],
        value: { xdr: corruptData },
        pagingToken: "token-002",
      });

      expect(decoded.decodeError).toBe(true);
      expect(decoded.decodeErrorReason).toContain("Failed to decode event data");
      expect(decoded.rawDataXdr).toBe(corruptData);
      expect(decoded.data).toBe(corruptData);
    });
  });
});
