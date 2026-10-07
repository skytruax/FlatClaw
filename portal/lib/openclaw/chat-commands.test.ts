import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ALLOWED_CHAT_COMMANDS, isAllowedChatCommand } from "./chat-commands";

describe("chat command filter", () => {
  it("lets the own-session commands through as the whole message", () => {
    for (const name of ALLOWED_CHAT_COMMANDS) {
      assert.equal(isAllowedChatCommand(`/${name}`), true, name);
      assert.equal(isAllowedChatCommand(`  /${name.toUpperCase()}\n`), true, name);
    }
  });

  it("treats every gateway-level command as text", () => {
    for (const message of [
      "/restart",
      "/update",
      "/model gemma-4-31b-it -g",
      "/model",
      "/openclaw",
      "/exec ask=always",
      "/elevated full",
      "/config set tools.deny []",
      "/plugins install x",
      "/bash rm -rf /",
      "/subagents",
      "/approve",
      "/think high",
    ]) {
      assert.equal(isAllowedChatCommand(message), false, message);
    }
  });

  it("does not let a directive ride along with an allowed command", () => {
    assert.equal(isAllowedChatCommand("/status /model x -g"), false);
    assert.equal(isAllowedChatCommand("/compact and then /restart"), false);
    assert.equal(isAllowedChatCommand("/new\n/model x -g"), false);
  });

  it("leaves ordinary text alone, including text that only looks like a path", () => {
    for (const message of ["hello", "", "read /data/report.pdf", "/data/report.pdf", "/status?", "//status"]) {
      assert.equal(isAllowedChatCommand(message), false, message);
    }
  });
});
