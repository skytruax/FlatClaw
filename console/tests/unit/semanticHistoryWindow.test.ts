import { describe, expect, it } from "vitest";

import {
  countSemanticTurns,
  selectSemanticHistoryWindow,
  type SemanticHistoryMessage,
} from "@/lib/controlplane/semantic-history-window";

const chatMessage = (params: {
  role: string;
  content: string;
  timestamp?: string;
  stopReason?: string;
  errorMessage?: string;
}): SemanticHistoryMessage => ({
  role: params.role,
  content: params.content,
  timestamp: params.timestamp ?? "2026-03-03T00:00:00.000Z",
  ...(params.stopReason ? { stopReason: params.stopReason } : {}),
  ...(params.errorMessage ? { errorMessage: params.errorMessage } : {}),
});

describe("semantic-history-window", () => {
  it("counts semantic turns from user and assistant messages", () => {
    const messages: SemanticHistoryMessage[] = [
      chatMessage({ role: "user", content: "u1" }),
      chatMessage({ role: "assistant", content: "a1" }),
      chatMessage({ role: "system", content: "internal" }),
    ];
    expect(countSemanticTurns(messages)).toBe(2);
  });

  it("builds semantic windows by turn count", () => {
    const messages: SemanticHistoryMessage[] = [
      chatMessage({ role: "user", content: "u1" }),
      chatMessage({ role: "assistant", content: "a1" }),
      chatMessage({ role: "user", content: "u2" }),
      chatMessage({ role: "assistant", content: "a2" }),
      chatMessage({ role: "user", content: "u3" }),
    ];

    const window = selectSemanticHistoryWindow({
      messages,
      turnLimit: 2,
      hasMoreBefore: true,
    });

    expect(window.messages).toEqual([
      chatMessage({ role: "assistant", content: "a2" }),
      chatMessage({ role: "user", content: "u3" }),
    ]);
    expect(window.semanticTurnsIncluded).toBe(2);
    expect(window.windowTruncated).toBe(true);
  });

  it("keeps hasMoreBefore signal when no local truncation occurred", () => {
    const messages: SemanticHistoryMessage[] = [
      chatMessage({ role: "user", content: "u1" }),
      chatMessage({ role: "assistant", content: "a1" }),
    ];

    const window = selectSemanticHistoryWindow({
      messages,
      turnLimit: 20,
      hasMoreBefore: true,
    });

    expect(window.messages).toEqual(messages);
    expect(window.semanticTurnsIncluded).toBe(2);
    expect(window.windowTruncated).toBe(true);
  });

  it("treats missing-role aborted/error messages as assistant turns", () => {
    const messages: SemanticHistoryMessage[] = [
      { content: "aborted", stopReason: "aborted" },
      { content: "errored", errorMessage: "boom" },
      chatMessage({ role: "user", content: "u1" }),
    ];

    expect(countSemanticTurns(messages)).toBe(3);
  });
});
