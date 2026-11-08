import { type RawRpcEvent } from "../decode/index.js";

export interface GetEventsParams {
  startLedger?: number | undefined;
  cursor?: string | undefined;
  limit?: number | undefined;
  filters?:
    | Array<{
        type?: "contract" | "system" | "diagnostic" | undefined;
        contractIds?: string[] | undefined;
        topics?: string[][] | undefined;
      }>
    | undefined;
}

export interface GetEventsResponse {
  events: RawRpcEvent[];
  latestLedger: number;
  cursor?: string | undefined;
}

export interface LatestLedgerResponse {
  id: string;
  sequence: number;
  protocolVersion?: number | undefined;
}

/**
 * Interface representing the RPC client operations needed by the engine.
 */
export interface SorobanRpcClient {
  getEvents(params: GetEventsParams): Promise<GetEventsResponse>;
  getLatestLedger(): Promise<LatestLedgerResponse>;
}
