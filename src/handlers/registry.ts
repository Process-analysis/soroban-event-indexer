import { type DecodedEvent, type EventHandler, type HandlerContext } from "../types/index.js";
import { matchesTopicPattern } from "../engine/filter.js";

export interface HandlerRegistration {
  pattern: string | string[];
  handler: EventHandler;
  contractId?: string | undefined;
}

export class HandlerRegistry {
  private registrations: HandlerRegistration[] = [];

  /**
   * Register a handler for an event topic pattern (or exact name).
   * Supports wildcard segments, e.g. ["VeryPrince", "*"] or "OrgFunded".
   */
  on(pattern: string | string[], handler: EventHandler, contractId?: string): this {
    this.registrations.push({
      pattern,
      handler,
      contractId,
    });
    return this;
  }

  /**
   * Return all handlers whose pattern matches the given event.
   */
  getHandlersFor(event: DecodedEvent): EventHandler[] {
    return this.registrations
      .filter((reg) => {
        if (reg.contractId && reg.contractId !== event.contractId) {
          return false;
        }
        return matchesTopicPattern(event.topics, reg.pattern);
      })
      .map((reg) => reg.handler);
  }

  /**
   * Execute all matching handlers for an event within an active transaction context.
   */
  async dispatch(event: DecodedEvent, ctx: HandlerContext): Promise<void> {
    const handlers = this.getHandlersFor(event);
    for (const handler of handlers) {
      await handler(event, ctx);
    }
  }

  /**
   * Return count of registered handlers.
   */
  count(): number {
    return this.registrations.length;
  }
}
