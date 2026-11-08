import { rpc } from "@stellar/stellar-sdk";
import {
  type SorobanRpcClient,
  type GetEventsParams,
  type GetEventsResponse,
  type LatestLedgerResponse,
} from "./types.js";
import { type RawRpcEvent } from "../decode/index.js";

export class RetentionWindowExceededError extends Error {
  constructor(
    public readonly requestedLedger?: number,
    public readonly oldestRetainedLedger?: number,
    message?: string,
  ) {
    const detail =
      message ||
      `Requested ledger ${requestedLedger ?? "cursor"} is older than the Soroban RPC node's retained history window.` +
        (oldestRetainedLedger !== undefined
          ? ` (Oldest retained ledger: ${oldestRetainedLedger}).`
          : "") +
        ` Action required: Soroban RPC nodes retain a bounded range of recent ledgers. To index historical events before this window, ingest from a Stellar History Archive or an archival Soroban provider, or update your start ledger.`;
    super(detail);
    this.name = "RetentionWindowExceededError";
  }
}

export interface RpcClientOptions {
  rpcUrl: string;
  timeoutMs?: number;
}

export class DefaultSorobanRpcClient implements SorobanRpcClient {
  private server: rpc.Server;

  constructor(options: RpcClientOptions) {
    this.server = new rpc.Server(options.rpcUrl, {
      allowHttp: options.rpcUrl.startsWith("http://"),
      timeout: options.timeoutMs || 30000,
    });
  }

  async getLatestLedger(): Promise<LatestLedgerResponse> {
    try {
      const resp = await this.server.getLatestLedger();
      const proto =
        typeof resp.protocolVersion === "string"
          ? parseInt(resp.protocolVersion, 10)
          : Number(resp.protocolVersion);
      return {
        id: resp.id,
        sequence: resp.sequence,
        protocolVersion: isNaN(proto) ? undefined : proto,
      };
    } catch (err: any) {
      this.handleRpcError(err);
      throw err;
    }
  }

  async getEvents(params: GetEventsParams): Promise<GetEventsResponse> {
    try {
      const rpcFilters: rpc.Api.EventFilter[] = [];
      if (params.filters) {
        for (const f of params.filters) {
          const item: rpc.Api.EventFilter = {
            type: (f.type as any) || "contract",
          };
          if (f.contractIds) {
            item.contractIds = f.contractIds;
          }
          if (f.topics) {
            item.topics = f.topics as any;
          }
          rpcFilters.push(item);
        }
      }

      const rpcRequest: rpc.Server.GetEventsRequest = {
        filters: rpcFilters,
      };
      if (params.startLedger !== undefined) {
        rpcRequest.startLedger = params.startLedger;
      }
      if (params.cursor !== undefined) {
        rpcRequest.cursor = params.cursor;
      }
      if (params.limit !== undefined) {
        rpcRequest.limit = params.limit;
      }

      const response = await this.server.getEvents(rpcRequest);

      const events: RawRpcEvent[] = (response.events || []).map((e: any) => ({
        id: e.id,
        type: e.type,
        ledger: e.ledger,
        ledgerClosedAt: e.ledgerClosedAt,
        contractId: e.contractId,
        topic: e.topic || [],
        value: e.value,
        pagingToken: e.pagingToken || e.id,
        inSuccessfulContractCall: e.inSuccessfulContractCall,
      }));

      const result: GetEventsResponse = {
        events,
        latestLedger: response.latestLedger,
      };
      if (response.cursor !== undefined) {
        result.cursor = response.cursor;
      }

      return result;
    } catch (err: any) {
      this.handleRpcError(err, params.startLedger);
      throw err;
    }
  }

  private handleRpcError(err: any, requestedLedger?: number): void {
    const message = (err?.message || "").toLowerCase();
    const data = JSON.stringify(err?.data || "").toLowerCase();

    // Check for retention window errors from Soroban RPC
    if (
      message.includes("retention window") ||
      message.includes("older than the oldest") ||
      message.includes("history window") ||
      data.includes("retention") ||
      data.includes("oldest ledger")
    ) {
      const match = message.match(/oldest.*?(\d+)/i) || data.match(/oldest.*?(\d+)/i);
      const oldest = match && match[1] ? parseInt(match[1], 10) : undefined;
      throw new RetentionWindowExceededError(requestedLedger, oldest, err?.message);
    }
  }
}
