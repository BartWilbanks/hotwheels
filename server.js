import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (req, res) => res.status(200).send("ok"));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

// In-memory rooms (fine for MVP). Render free tier may sleep; rooms reset on restart.
const rooms = new Map(); // roomCode -> { hostWs, players: Map(playerId -> {ws, name}) }

function makeRoomCode() {
  // 4 chars, avoid confusing letters
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 4; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

function makeId() {
  return crypto.randomBytes(8).toString("hex");
}

function send(ws, obj) {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(obj));
}

function broadcast(roomCode, obj) {
  const room = rooms.get(roomCode);
  if (!room) return;
  // host
  if (room.hostWs) send(room.hostWs, obj);
  // players
  for (const p of room.players.values()) send(p.ws, obj);
}

function getRoomPlayers(roomCode) {
  const room = rooms.get(roomCode);
  if (!room) return [];
  return Array.from(room.players.entries()).map(([playerId, p]) => ({ playerId, name: p.name }));
}

wss.on("connection", (ws) => {
  ws._role = "unknown"; // host|player
  ws._room = null;
  ws._playerId = null;

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString("utf-8")); } catch { return; }
    if (!msg || !msg.t) return;

    if (msg.t === "create-room") {
      // Host creating room
      let code = makeRoomCode();
      while (rooms.has(code)) code = makeRoomCode();

      rooms.set(code, { hostWs: ws, players: new Map() });
      ws._role = "host";
      ws._room = code;

      send(ws, { t: "room-created", room: code });
      return;
    }

    if (msg.t === "host-rejoin" && msg.room) {
      const code = String(msg.room).toUpperCase();
      const room = rooms.get(code);
      if (!room) {
        send(ws, { t:"error", message:"Room not found (it may have restarted)." });
        return;
      }
      room.hostWs = ws;
      ws._role = "host";
      ws._room = code;
      send(ws, { t:"host-rejoined", room: code, players: getRoomPlayers(code) });
      return;
    }

    if (msg.t === "join" && msg.room) {
      // Player joining
      const code = String(msg.room).toUpperCase();
      const room = rooms.get(code);
      if (!room || !room.hostWs) {
        send(ws, { t:"error", message:"Room not found. Make sure the host clicked Create Room." });
        return;
      }

      const playerId = makeId();
      const name = String(msg.name || "Player").slice(0, 16);

      room.players.set(playerId, { ws, name });
      ws._role = "player";
      ws._room = code;
      ws._playerId = playerId;

      send(ws, { t:"joined", room: code, playerId });

      // notify host
      send(room.hostWs, { t:"player-joined", room: code, playerId, name });

      // notify everyone with updated roster (host also re-sends richer state)
      broadcast(code, { t:"state", room: code, players: getRoomPlayers(code).map(p => ({id:p.playerId, name:p.name})) });
      return;
    }

    // relay inputs from controller to host
    if (msg.t === "input" && msg.room && msg.playerId && msg.inputs) {
      const code = String(msg.room).toUpperCase();
      const room = rooms.get(code);
      if (!room || !room.hostWs) return;
      // only accept if it matches this socket's assigned playerId
      if (ws._role !== "player" || ws._playerId !== msg.playerId) return;

      send(room.hostWs, { t:"input", room: code, playerId: msg.playerId, inputs: msg.inputs });
      return;
    }

    // host broadcasts mode/track/state
    if ((msg.t === "mode" || msg.t === "track" || msg.t === "state") && msg.room) {
      const code = String(msg.room).toUpperCase();
      const room = rooms.get(code);
      if (!room || room.hostWs !== ws) return; // only host can broadcast
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
      // keep room for a bit (players may still be connected); but without host it's not usable
      room.hostWs = null;
      // optionally, you could close players too:
      for (const p of room.players.values()) {
        try { p.ws.close(); } catch {}
      }
      rooms.delete(code);
      return;
    }

    if (ws._role === "player" && ws._playerId) {
      room.players.delete(ws._playerId);
      if (room.hostWs) send(room.hostWs, { t:"player-left", room: code, playerId: ws._playerId });
      broadcast(code, { t:"state", room: code, players: getRoomPlayers(code).map(p => ({id:p.playerId, name:p.name})) });
      return;
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
