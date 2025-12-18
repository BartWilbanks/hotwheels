import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use((req, res, next) => { res.setHeader("Cache-Control", "no-store, max-age=0"); next(); });
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_, res) => res.status(200).send("ok"));
app.get("/", (_, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
app.get("/controller", (_, res) => res.redirect(302, "/controller.html"));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// Rooms are in-memory. Restarting the service clears them.
const rooms = new Map(); // code -> { hostWs, players: Map(id -> {ws,name}) }

function makeRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
function makeId() { return crypto.randomBytes(8).toString("hex"); }
function send(ws, obj) { if (ws?.readyState === 1) ws.send(JSON.stringify(obj)); }
function broadcast(roomCode, obj) {
  const room = rooms.get(roomCode);
  if (!room) return;
  if (room.hostWs) send(room.hostWs, obj);
  for (const p of room.players.values()) send(p.ws, obj);
}
function playersList(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return [];
  return Array.from(room.players.entries()).map(([id, p]) => ({ id, name: p.name }));
}

wss.on("connection", (ws) => {
  ws._role = "unknown";
  ws._room = null;
  ws._playerId = null;

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString("utf-8")); } catch { return; }
    if (!msg?.t) return;

    if (msg.t === "create-room") {
      let code = makeRoomCode();
      while (rooms.has(code)) code = makeRoomCode();
      rooms.set(code, { hostWs: ws, players: new Map() });
      ws._role = "host";
      ws._room = code;
      send(ws, { t: "room-created", room: code, players: [] });
      return;
    }

    if (msg.t === "join" && msg.room) {
      const code = String(msg.room).toUpperCase();
      const room = rooms.get(code);
      if (!room || !room.hostWs) { send(ws, { t:"error", message:"Room not found. Host must click Create Room." }); return; }

      const playerId = makeId();
      const name = String(msg.name || "Player").slice(0, 16);
      room.players.set(playerId, { ws, name });

      ws._role = "player";
      ws._room = code;
      ws._playerId = playerId;

      send(ws, { t:"joined", room: code, playerId });
      send(room.hostWs, { t:"player-joined", room: code, playerId, name });
      broadcast(code, { t:"state", room: code, players: playersList(code) });
      return;
    }

    if (msg.t === "input" && msg.room && msg.playerId && msg.inputs) {
      const code = String(msg.room).toUpperCase();
      const room = rooms.get(code);
      if (!room?.hostWs) return;
      // Only accept inputs from the player who owns that playerId on this ws
      if (ws._role !== "player" || ws._playerId !== msg.playerId) return;
      send(room.hostWs, { t:"input", room: code, playerId: msg.playerId, inputs: msg.inputs });
      return;
    }

    // Host broadcast messages
    if ((msg.t === "mode" || msg.t === "track" || msg.t === "race" || msg.t === "preset" || msg.t === "announce") && msg.room) {
      const code = String(msg.room).toUpperCase();
      const room = rooms.get(code);
      if (!room || room.hostWs !== ws) return;
      broadcast(code, msg);
      return;
    }
  });

  ws.on("close", () => {
    const code = ws._room;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (ws._role === "host") {
      for (const p of room.players.values()) { try { p.ws.close(); } catch {} }
      rooms.delete(code);
      return;
    }
    if (ws._role === "player" && ws._playerId) {
      room.players.delete(ws._playerId);
      if (room.hostWs) send(room.hostWs, { t:"player-left", room: code, playerId: ws._playerId });
      broadcast(code, { t:"state", room: code, players: playersList(code) });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
