import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const cfg = JSON.parse(readFileSync(`${homedir()}/.openclaw/openclaw.json`, "utf8"));
const token = cfg.gateway.auth.token;

const ws = new WebSocket("ws://127.0.0.1:18789", { headers: { Origin: "http://127.0.0.1:18789" } });
let pendingDeletes = 0;

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
  if (f.type === "res" && f.id === "1") {
    if (!f.ok) { console.error("connect:", f.error); process.exit(1); }
    ws.send(JSON.stringify({ type: "req", id: "list", method: "agents.list", params: {} }));
    return;
  }
  if (f.id === "list") {
    const agents = f.payload?.agents ?? [];
    console.log("Before:", agents.map(a => a.id));
    const toDel = agents.map(a => a.id).filter(id => id !== "main");
    pendingDeletes = toDel.length;
    if (pendingDeletes === 0) { ws.close(); return; }
    for (const id of toDel) {
      ws.send(JSON.stringify({ type: "req", id: `d-${id}`, method: "agents.delete", params: { agentId: id } }));
    }
    return;
  }
  if (f.id?.startsWith("d-")) {
    console.log(f.id, ":", f.ok ? "OK" : JSON.stringify(f.error));
    pendingDeletes--;
    if (pendingDeletes === 0) {
      ws.send(JSON.stringify({ type: "req", id: "list2", method: "agents.list", params: {} }));
    }
  }
  if (f.id === "list2") {
    const agents = f.payload?.agents ?? [];
    console.log("After:", agents.map(a => a.id));
    ws.close();
    process.exit(0);
  }
});
ws.on("error", e => { console.error(e.message); process.exit(1); });
setTimeout(() => process.exit(0), 15000);
