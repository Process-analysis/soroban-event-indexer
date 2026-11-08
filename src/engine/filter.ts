import { type DecodedEvent, type EventFilter } from "../types/index.js";

/**
 * Checks if a single topic array matches a topic pattern.
 * Supports wildcard "*" segment.
 */
export function matchesTopicPattern(topics: unknown[], pattern: string | string[]): boolean {
  if (typeof pattern === "string") {
    // If pattern is a single string (e.g. "OrgFunded"), match if any topic segment equals it
    return topics.some((t) => String(t) === pattern);
  }

  if (!Array.isArray(pattern)) {
    return false;
  }

  // If pattern is an array of segment matchers (e.g. ["VeryPrince", "*", "Claimed"])
  if (pattern.length > topics.length) {
    return false;
  }

  for (let i = 0; i < pattern.length; i++) {
    const p = pattern[i];
    if (p === "*") {
      continue;
    }
    const t = topics[i];
    if (String(t) !== p) {
      return false;
    }
  }

  return true;
}

/**
 * Checks if an event matches a set of configured filters.
 * Returns true if no filters are configured (match all).
 */
export function matchesFilters(event: DecodedEvent, filters: EventFilter[]): boolean {
  if (!filters || filters.length === 0) {
    return true;
  }

  return filters.some((filter) => {
    // Check contract ID
    if (filter.contractIds && filter.contractIds.length > 0) {
      if (!filter.contractIds.includes(event.contractId)) {
        return false;
      }
    }

    // Check topics
    if (filter.topics && filter.topics.length > 0) {
      const topicMatches = filter.topics.some((pattern) =>
        matchesTopicPattern(event.topics, pattern),
      );
      if (!topicMatches) {
        return false;
      }
    }

    return true;
  });
}
