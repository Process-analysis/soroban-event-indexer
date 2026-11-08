import {
  type SorobanRpcClient,
  type GetEventsParams,
  type GetEventsResponse,
  type LatestLedgerResponse,
} from "./types.js";
import { type RawRpcEvent } from "../decode/index.js";
import { RetentionWindowExceededError } from "./client.js";

export interface FakeRpcOptions {
  events?: RawRpcEvent[];
  latestLedger?: number;
  oldestRetainedLedger?: number;
}

export class FakeSorobanRpcClient implements SorobanRpcClient {
  public events: RawRpcEvent[] = [];
  public latestLedger = 1000;
  public oldestRetainedLedger = 100;
  public queriesCount = 0;
  private queuedErrors: Error[] = [];

  constructor(options?: FakeRpcOptions) {
    if (options?.events) this.events = [...options.events];
    if (options?.latestLedger !== undefined) this.latestLedger = options.latestLedger;
    if (options?.oldestRetainedLedger !== undefined)
      this.oldestRetainedLedger = options.oldestRetainedLedger;
  }

  queueError(err: Error): void {
    this.queuedErrors.push(err);
  }

  addEvent(event: RawRpcEvent): void {
    this.events.push(event);
    if (event.ledger > this.latestLedger) {
      this.latestLedger = event.ledger;
    }
  }

  async getLatestLedger(): Promise<LatestLedgerResponse> {
    if (this.queuedErrors.length > 0) {
      throw this.queuedErrors.shift()!;
    }
    return {
      id: "fake-latest-ledger-id",
      sequence: this.latestLedger,
      protocolVersion: 22,
    };
  }

  async getEvents(params: GetEventsParams): Promise<GetEventsResponse> {
    this.queriesCount++;

    if (this.queuedErrors.length > 0) {
      throw this.queuedErrors.shift()!;
    }

    // Check retention window
    if (params.startLedger !== undefined && params.startLedger < this.oldestRetainedLedger) {
      throw new RetentionWindowExceededError(params.startLedger, this.oldestRetainedLedger);
    }

    let matching = [...this.events];

    // Filter by start ledger if cursor is not provided
    if (params.cursor) {
      const cursorIdx = matching.findIndex(
        (e) => e.pagingToken === params.cursor || e.id === params.cursor,
      );
      if (cursorIdx !== -1) {
        matching = matching.slice(cursorIdx + 1);
      }
    } else if (params.startLedger !== undefined) {
      matching = matching.filter((e) => e.ledger >= params.startLedger!);
    }

    // Apply contract ID filters if specified
    if (params.filters && params.filters.length > 0) {
      const allowedContracts = new Set<string>();
      for (const f of params.filters) {
        if (f.contractIds) {
          f.contractIds.forEach((id) => allowedContracts.add(id));
        }
      }
      if (allowedContracts.size > 0) {
        matching = matching.filter((e) => allowedContracts.has(e.contractId));
      }
    }

    const limit = params.limit || 100;
    const page = matching.slice(0, limit);
    const nextCursor = page.length > 0 ? page[page.length - 1]!.pagingToken : params.cursor;

    const res: GetEventsResponse = {
      events: page,
      latestLedger: this.latestLedger,
    };
    if (nextCursor !== undefined) {
      res.cursor = nextCursor;
    }

    return res;
  }
}
