import { type DecodedEvent } from "../types/index.js";
import { decodeScVal } from "./scval.js";

/**
 * Raw event payload shape as returned by Soroban JSON-RPC getEvents.
 */
export interface RawRpcEvent {
  id: string;
  type: "contract" | "system" | "diagnostic";
  ledger: number;
  ledgerClosedAt: string;
  contractId: string;
  topic: string[];
  value: { xdr: string } | string;
  pagingToken: string;
  inSuccessfulContractCall?: boolean | undefined;
}

/**
 * Decodes a raw RPC event into a strongly-typed DecodedEvent.
 * Unknown or malformed ScVal fields are flagged as decodeError without throwing.
 */
export function decodeEvent(raw: RawRpcEvent): DecodedEvent {
  const rawTopicsXdr = raw.topic || [];
  const rawDataXdr = typeof raw.value === "string" ? raw.value : raw.value?.xdr || "";

  const decodedTopics: unknown[] = [];
  let decodeError = false;
  let decodeErrorReason: string | undefined;

  for (let i = 0; i < rawTopicsXdr.length; i++) {
    const topicXdr = rawTopicsXdr[i]!;
    const res = decodeScVal(topicXdr);
    if (!res.success) {
      decodeError = true;
      decodeErrorReason = `Failed to decode topic index ${i}: ${res.error}`;
      decodedTopics.push(topicXdr);
    } else {
      decodedTopics.push(res.value);
    }
  }

  let decodedData: unknown = null;
  if (rawDataXdr) {
    const dataRes = decodeScVal(rawDataXdr);
    if (!dataRes.success) {
      decodeError = true;
      decodeErrorReason = decodeErrorReason
        ? `${decodeErrorReason}; Failed to decode event data: ${dataRes.error}`
        : `Failed to decode event data: ${dataRes.error}`;
      decodedData = rawDataXdr;
    } else {
      decodedData = dataRes.value;
    }
  }

  const result: DecodedEvent = {
    id: raw.id,
    ledger: raw.ledger,
    ledgerClosedAt: raw.ledgerClosedAt,
    contractId: raw.contractId,
    type: raw.type,
    topics: decodedTopics,
    data: decodedData,
    decodeError,
    rawTopicsXdr,
    rawDataXdr,
    pagingToken: raw.pagingToken,
  };

  if (decodeErrorReason !== undefined) {
    result.decodeErrorReason = decodeErrorReason;
  }

  return result;
}

export * from "./scval.js";
