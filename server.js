const path = require("path");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => res.redirect("/index.html"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

function rid() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

const rooms = new Map(); // code -> {createdAt, hostWs, players: Map(pid -> player), trackState}

function safeSend(ws, obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

function broadcastRoom(code, obj) {
  const room = rooms.get(code);
  if (!room) return;
  for (const p of room.players.values()) safeSend(p.ws, obj);
  safeSend(room.hostWs, obj);
}

function roomSnapshot(code) {
  const room = rooms.get(code);
  if (!room) return null;
  const players = [...room.players.values()].map(p => ({
    id: p.id, name: p.name, color: p.color, connected: true
  }));
  return {
    code,
    players,
    trackState: room.trackState || null,
    started: !!(room.trackState && room.trackState.mode === "drive")
  };
}

wss.on("connection", (ws) => {
  ws.on("message", (msg) => {
    let data;
    try { data = JSON.parse(msg.toString()); } catch { return; }
    const t = data.type;

    if (t === "host_create_room") {
      let code = rid();
      while (rooms.has(code)) code = rid();
      rooms.set(code, {
        createdAt: Date.now(),
        hostWs: ws,
        players: new Map(),
        trackState: { mode: "build", trackId: "t1", custom: null, lapsToWin: 3 }
      });
      ws.__role = "host";
      ws.__room = code;
      safeSend(ws, { type:"room_created", code, snapshot: roomSnapshot(code) });
      return;
    }

    if (t === "host_set_state") {
      const code = ws.__room || data.code;
      const room = rooms.get(code);
      if (!room) return;
      room.hostWs = ws;
      // merge allowed fields
      room.trackState = {
        ...(room.trackState || {}),
        ...(data.state || {})
      };
      broadcastRoom(code, { type:"room_update", snapshot: roomSnapshot(code) });
      return;
    }

    if (t === "player_join") {
      const code = (data.code || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) { safeSend(ws, { type:"join_error", message:"Room not found. Ask host to Create Room."}); return; }

      const id = "p_" + Math.random().toString(16).slice(2, 10);
      const palette = ["#00E5FF","#FFEA00","#FF1744","#76FF03","#FF9100","#B388FF","#1DE9B6","#FF80AB"];
      const color = palette[Math.floor(Math.random()*palette.length)];
      const name = (data.name || "Player").slice(0, 18);

      const player = { id, name, color, ws, input: {gas:0, brake:0, steer:0}, lastSeen: Date.now() };
      room.players.set(id, player);
      ws.__role = "player";
      ws.__room = code;
      ws.__pid = id;

      // send join ack to player
      safeSend(ws, { type:"join_ok", code, playerId:id, snapshot: roomSnapshot(code) });

      // notify host + others
      broadcastRoom(code, { type:"room_update", snapshot: roomSnapshot(code) });
      return;
    }

    if (t === "player_input") {
      const code = ws.__room || (data.code || "").toUpperCase();
      const room = rooms.get(code);
      if (!room) return;
      const pid = ws.__pid || data.playerId;
      const p = room.players.get(pid);
      if (!p) return;
      p.input = {
        gas: data.gas ? 1 : 0,
        brake: data.brake ? 1 : 0,
        steer: Math.max(-1, Math.min(1, Number(data.steer || 0)))
      };
      p.lastSeen = Date.now();
      // forward to host (host drives simulation)
      safeSend(room.hostWs, { type:"inputs", inputs: [{ id: pid, input: p.input }] });
      return;
    }

    if (t === "host_ping") {
      const code = ws.__room || data.code;
      const room = rooms.get(code);
      if (!room) return;
      safeSend(ws, { type:"pong", ts: Date.now() });
      return;
    }
  });

  ws.on("close", () => {
    const role = ws.__role;
    const code = ws.__room;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    if (role === "host") {
      // keep room alive briefly; if host reconnects it can continue
      room.hostWs = null;
      broadcastRoom(code, { type:"host_disconnected" });
    } else if (role === "player") {
      const pid = ws.__pid;
      if (pid && room.players.has(pid)) {
        room.players.delete(pid);
        broadcastRoom(code, { type:"room_update", snapshot: roomSnapshot(code) });
      }
    }
    // cleanup empty rooms
    if (!room.hostWs && room.players.size === 0) rooms.delete(code);
  });
});

// periodic cleanup stale players
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    for (const [pid, p] of room.players.entries()) {
      if (p.ws.readyState !== WebSocket.OPEN || (now - p.lastSeen) > 60_000) {
        try { p.ws.close(); } catch {}
        room.players.delete(pid);
      }
    }
    if (!room.hostWs && room.players.size === 0) rooms.delete(code);
  }
}, 10_000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on port", PORT));
