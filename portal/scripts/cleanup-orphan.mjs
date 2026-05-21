import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const cfg = JSON.parse(readFileSync(`${homedir()}/.openclaw/openclaw.json`, "utf8"));
const token = cfg.gateway.auth.token;

const ws = new WebSocket("ws://127.0.0.1:18789", { headers: { Origin: "http://127.0.0.1:18789" } });
let connected = false;

ws.on("message", (raw) => {
  const f = JSON.parse(raw.toString());
  if (f.type === "event" && f.event === "connect.challenge") {
    ws.send(JSON.stringify({
      type: "req", id: "1", method: "connect", params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: "openclaw-control-ui", version: "dev", platform: "web", mode: "webchat" },
        role: "operator",
        scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.pairing"],
        caps: ["tool-events"],
        auth: { token },
      },
    }));
    return;
  }
  if (f.type === "res" && f.id === "1") {
    if (!f.ok) { console.error("connect rejected:", JSON.stringify(f.error)); process.exit(1); }
    connected = true;
    ws.send(JSON.stringify({ type: "req", id: "2", method: "agents.list", params: {} }));
    return;
  }
  if (f.type === "res" && f.id === "2") {
    console.log("agents.list:", JSON.stringify(f.payload));
    const agents = f.payload?.agents ?? [];
    const targets = agents.filter(a => a.id?.includes("skyler") || a.id?.includes("truax")).map(a => a.id);
    if (targets.length === 0) { console.log("no orphan to delete"); process.exit(0); }
    console.log("deleting:", targets);
    let pending = targets.length;
    for (const t of targets) {
      const id = `del-${t}`;
      ws.send(JSON.stringify({ type: "req", id, method: "agents.delete", params: { agentId: t } }));
    }
    setTimeout(() => process.exit(0), 4000);
    return;
  }
  if (f.type === "res" && f.id?.startsWith("del-")) {
    console.log(`${f.id}:`, f.ok ? "ok" : f.error);
  }
});
ws.on("error", (e) => { console.error("err:", e.message); process.exit(1); });
setTimeout(() => process.exit(2), 10000);
