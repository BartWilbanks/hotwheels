const path = require("path");
const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

app.get("/healthz", (req,res)=>res.status(200).send("ok"));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();

function makeCode() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i=0;i<4;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

function safeSend(ws, obj){
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(obj));
}

function broadcast(room, obj){
  for (const ws of room.sockets){
    safeSend(ws, obj);
  }
}

function createRoom(){
  let code;
  do { code = makeCode(); } while (rooms.has(code));
  const room = {
    code,
    hostId: null,
    sockets: new Set(),
    players: new Map(),
    mode: "build",
    track: { presetId: "01", customPieces: [], width: 140, lapsToWin: 3 },
    winner: null,
    createdAt: Date.now()
  };
  rooms.set(code, room);
  return room;
}

function roomSnapshot(room){
  return {
    code: room.code,
    mode: room.mode,
    track: room.track,
    players: Array.from(room.players.values()).map(p=>({
      id:p.id, name:p.name, color:p.color, lap:p.lap||0, finished: !!p.finished
    })),
    winner: room.winner
  };
}

let nextClientId = 1;
function newClientId(){ return String(nextClientId++); }

function randomColor(){
  const colors = ["#ff3b30","#34c759","#0a84ff","#ff9f0a","#bf5af2","#64d2ff","#ffd60a","#ff375f"];
  return colors[Math.floor(Math.random()*colors.length)];
}

wss.on("connection", (ws) => {
  ws.id = newClientId();
  ws.role = "unknown";
  ws.roomCode = null;
  ws.playerId = null;

  safeSend(ws, { type:"hello", id: ws.id });

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }

    if (msg.type === "create_room") {
      const room = createRoom();
      ws.role = "host";
      ws.roomCode = room.code;
      room.hostId = ws.id;
      room.sockets.add(ws);
      safeSend(ws, { type:"room_created", room: roomSnapshot(room) });
      return;
    }

    if (msg.type === "join_room") {
      const code = (msg.code||"").toUpperCase().trim();
      const room = rooms.get(code);
      if (!room){
        safeSend(ws, { type:"error", message:"Room not found" });
        return;
      }
      ws.roomCode = code;
      ws.role = "player";
      room.sockets.add(ws);

      const name = String(msg.name||"Player").slice(0,18).trim() || "Player";
      const playerId = "p_" + ws.id;
      ws.playerId = playerId;

      room.players.set(playerId, {
        id: playerId,
        name,
        color: randomColor(),
        inputs: { gas:false, brake:false, left:false, right:false, tilt:0 },
        lap: 0,
        finished: false
      });

      broadcast(room, { type:"room_update", room: roomSnapshot(room) });
      safeSend(ws, { type:"joined", room: roomSnapshot(room), playerId });
      return;
    }

    const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
    if (!room) return;

    if (msg.type === "set_track") {
      if (ws.role !== "host") return;
      const t = msg.track || {};
      room.track = {
        presetId: String(t.presetId || room.track.presetId),
        customPieces: Array.isArray(t.customPieces) ? t.customPieces.slice(0,600) : [],
        width: Number(t.width || room.track.width || 140),
        lapsToWin: Math.max(1, Math.min(9, Number(t.lapsToWin || room.track.lapsToWin || 3)))
      };
      room.mode = "build";
      room.winner = null;
      for (const p of room.players.values()){ p.lap=0; p.finished=false; }
      broadcast(room, { type:"room_update", room: roomSnapshot(room) });
      return;
    }

    if (msg.type === "set_mode") {
      if (ws.role !== "host") return;
      const m = msg.mode;
      if (!["build","drive","winner"].includes(m)) return;
      room.mode = m;
      if (m !== "winner") room.winner = null;
      if (m === "build"){
        for (const p of room.players.values()){ p.lap=0; p.finished=false; }
      }
      broadcast(room, { type:"room_update", room: roomSnapshot(room) });
      return;
    }

    if (msg.type === "reset_cars") {
      if (ws.role !== "host") return;
      broadcast(room, { type:"reset_cars" });
      return;
    }

    if (msg.type === "clear_custom") {
      if (ws.role !== "host") return;
      room.track.customPieces = [];
      room.track.presetId = String(msg.presetId || room.track.presetId || "01");
      broadcast(room, { type:"room_update", room: roomSnapshot(room) });
      return;
    }

    if (msg.type === "input") {
      if (ws.role !== "player") return;
      const p = room.players.get(ws.playerId);
      if (!p) return;
      const upd = msg.input || {};
      const i = p.inputs;
      if (typeof upd.gas === "boolean") i.gas = upd.gas;
      if (typeof upd.brake === "boolean") i.brake = upd.brake;
      if (typeof upd.left === "boolean") i.left = upd.left;
      if (typeof upd.right === "boolean") i.right = upd.right;
      if (typeof upd.tilt === "number") i.tilt = Math.max(-1, Math.min(1, upd.tilt));
      // Broadcast to all so host receives it even if it reconnects
      broadcast(room, { type:"player_input", playerId: p.id, input: i });
      return;
    }

    if (msg.type === "lap_update") {
      if (ws.role !== "host") return;
      const { playerId, lap, finished } = msg;
      const p = room.players.get(playerId);
      if (!p) return;
      if (typeof lap === "number") p.lap = lap;
      if (typeof finished === "boolean") p.finished = finished;
      if (finished && !room.winner){
        room.winner = { playerId: p.id, name: p.name, color: p.color };
        room.mode = "winner";
      }
      broadcast(room, { type:"room_update", room: roomSnapshot(room) });
      return;
    }
  });

  ws.on("close", () => {
    const room = ws.roomCode ? rooms.get(ws.roomCode) : null;
    if (room){
      room.sockets.delete(ws);
      if (ws.role === "player" && ws.playerId){
        room.players.delete(ws.playerId);
      }
      if (ws.role === "host"){
        room.hostId = null;
        room.mode = "build";
        room.winner = null;
      }
      broadcast(room, { type:"room_update", room: roomSnapshot(room) });
      if (room.sockets.size === 0){
        rooms.delete(room.code);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on port", PORT));