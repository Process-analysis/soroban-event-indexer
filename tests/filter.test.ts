import { describe, it, expect } from "vitest";
import { matchesTopicPattern, matchesFilters } from "../src/engine/filter.js";
import { type DecodedEvent } from "../src/types/index.js";

describe("Topic Filter and Pattern Matching Tests", () => {
  describe("matchesTopicPattern", () => {
    it("matches single string pattern against any topic segment", () => {
      const topics = ["VeryPrince", "OrgFunded"];
      expect(matchesTopicPattern(topics, "OrgFunded")).toBe(true);
      expect(matchesTopicPattern(topics, "VeryPrince")).toBe(true);
      expect(matchesTopicPattern(topics, "UnknownEvent")).toBe(false);
    });

    it("matches exact array of topic segments", () => {
      const topics = ["VeryPrince", "OrgFunded"];
      expect(matchesTopicPattern(topics, ["VeryPrince", "OrgFunded"])).toBe(true);
      expect(matchesTopicPattern(topics, ["VeryPrince", "PayoutAllocated"])).toBe(false);
    });

    it("matches wildcard '*' segment in pattern", () => {
      const topics = ["VeryPrince", "OrgFunded", "v1"];
      expect(matchesTopicPattern(topics, ["VeryPrince", "*"])).toBe(true);
      expect(matchesTopicPattern(topics, ["*", "OrgFunded"])).toBe(true);
      expect(matchesTopicPattern(topics, ["*", "*", "v1"])).toBe(true);
      expect(matchesTopicPattern(topics, ["*", "*", "v2"])).toBe(false);
    });

    it("returns false if pattern has more segments than event topics", () => {
      const topics = ["VeryPrince"];
      expect(matchesTopicPattern(topics, ["VeryPrince", "OrgFunded"])).toBe(false);
    });

    it("handles non-string topics gracefully by string conversion", () => {
      const topics = ["Transfer", 100, true];
      expect(matchesTopicPattern(topics, ["Transfer", "100", "true"])).toBe(true);
    });
  });

  describe("matchesFilters", () => {
    const sampleEvent: DecodedEvent = {
      id: "evt-001",
      ledger: 100,
      ledgerClosedAt: "2026-11-08T00:00:00Z",
      contractId: "C1111111111111111111111111111111111111111111111111111111",
      type: "contract",
      topics: ["VeryPrince", "OrgFunded"],
      data: 5000,
      decodeError: false,
      rawTopicsXdr: [],
      rawDataXdr: "",
      pagingToken: "token-001",
    };

    it("returns true when no filters are defined (match all)", () => {
      expect(matchesFilters(sampleEvent, [])).toBe(true);
    });

    it("matches when both contractId and topic pattern match", () => {
      const filters = [
        {
          contractIds: ["C1111111111111111111111111111111111111111111111111111111"],
          topics: [["VeryPrince", "OrgFunded"]],
        },
      ];
      expect(matchesFilters(sampleEvent, filters)).toBe(true);
    });

    it("rejects when contractId matches but topic does not", () => {
      const filters = [
        {
          contractIds: ["C1111111111111111111111111111111111111111111111111111111"],
          topics: [["PayoutClaimed"]],
        },
      ];
      expect(matchesFilters(sampleEvent, filters)).toBe(false);
    });

    it("rejects when topic matches but contractId does not", () => {
      const filters = [
        {
          contractIds: ["C2222222222222222222222222222222222222222222222222222222"],
          topics: [["VeryPrince", "*"]],
        },
      ];
      expect(matchesFilters(sampleEvent, filters)).toBe(false);
    });

    it("evaluates multiple filter rules with logical OR semantics", () => {
      const filters = [
        {
          contractIds: ["C_OTHER"],
          topics: ["SomeEvent"],
        },
        {
          contractIds: ["C1111111111111111111111111111111111111111111111111111111"],
          topics: ["OrgFunded"],
        },
      ];
      expect(matchesFilters(sampleEvent, filters)).toBe(true);
    });
  });
});
