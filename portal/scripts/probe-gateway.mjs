import WebSocket from "ws";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const cfg = JSON.parse(readFileSync(`${homedir()}/.openclaw/openclaw.json`, "utf8"));
const token = cfg.gateway?.auth?.token;
if (!token) { console.error("no token"); process.exit(1); }

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
    ws.send(JSON.stringify({ type: "req", id: "2", method: "models.list", params: {} }));
    return;
  }
  if (f.type === "res" && f.id === "2") {
    const models = f.payload?.models ?? [];
    console.log(`total: ${models.length}`);
    console.log("first 3 entries:");
    for (const m of models.slice(0, 3)) console.log(JSON.stringify(m));
    const ours = models.filter((m) => m.provider === "openai" || m.provider === "openai-dev");
    console.log(`\nFlatClaw providers (openai + openai-dev): ${ours.length} model(s)`);
    for (const m of ours) console.log("  ", JSON.stringify(m));
    ws.close();
    process.exit(0);
  }
});
ws.on("error", (e) => { console.error("ws error:", e.message); process.exit(1); });
setTimeout(() => { console.error("timeout"); process.exit(2); }, 30000);
