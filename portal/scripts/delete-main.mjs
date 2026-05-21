import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
const cfg = JSON.parse(readFileSync(`${homedir()}/.openclaw/openclaw.json`, "utf8"));
const token = cfg.gateway.auth.token;
const ws = new WebSocket("ws://127.0.0.1:18789", { headers: { Origin: "http://127.0.0.1:18789" } });
ws.on("message", (raw) => {
  const f = JSON.parse(raw.toString());
  if (f.type === "event" && f.event === "connect.challenge") {
    ws.send(JSON.stringify({
      type: "req", id: "1", method: "connect", params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: "openclaw-control-ui", version: "dev", platform: "web", mode: "webchat" },
        role: "operator",
        scopes: ["operator.admin","operator.read","operator.write","operator.approvals","operator.pairing"],
        caps: ["tool-events"],
        auth: { token },
      },
    }));
    return;
  }
  if (f.id === "1") {
    if (!f.ok) { console.error("connect:", f.error); process.exit(1); }
    ws.send(JSON.stringify({ type: "req", id: "del", method: "agents.delete", params: { agentId: "main" } }));
    return;
  }
  if (f.id === "del") {
    console.log("agents.delete main:", f.ok ? "OK" : JSON.stringify(f.error));
    process.exit(0);
  }
});
ws.on("error", e => { console.error(e.message); process.exit(1); });
setTimeout(() => process.exit(0), 8000);
