import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i=0;i<4;i++) s += chars[Math.floor(Math.random()*chars.length)];
  return s;
}

function getRoom(code) {
  if (!rooms.has(code)) rooms.set(code, { code, host: null, players: new Map(), state: { mode:"build", trackId:"t1", lapsToWin:3 } });
  return rooms.get(code);
}

function snapshot(room){
  return {
    code: room.code,
    state: room.state,
    players: Array.from(room.players.values()).map(p => ({ id:p.id, name:p.name, connected: p.ws?.readyState===1 }))
  };
}

function broadcast(room, obj){
  const msg = JSON.stringify(obj);
  if (room.host && room.host.readyState===1) room.host.send(msg);
  for (const p of room.players.values()){
    if (p.ws && p.ws.readyState===1) p.ws.send(msg);
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (buf) => {
    let data;
    try { data = JSON.parse(buf.toString()); } catch { return; }
    const type = data?.type;

    if (type === "create_room") {
      let code = makeRoomCode();
      while (rooms.has(code)) code = makeRoomCode();
      const room = getRoom(code);
      broadcast(room, { type:"room_created", room: code });
      return;
    }

    if (type === "host_join") {
      const room = getRoom(data.room);
      room.host = ws;
      ws._room = room.code; ws._role="host";
      ws.send(JSON.stringify({ type:"room_snapshot", snapshot: snapshot(room) }));
      return;
    }

    if (type === "controller_join") {
      const room = getRoom(data.room);
      const name = (data.name || "Player").toString().slice(0, 18);
      const id = "p" + Math.random().toString(16).slice(2, 10);
      room.players.set(id, { id, name, ws, input:{steer:0, throttle:0, brake:0, tilt:0} });
      ws._room = room.code; ws._role="controller"; ws._playerId=id;
      ws.send(JSON.stringify({ type:"joined", room: room.code, playerId: id, name }));
      broadcast(room, { type:"room_snapshot", snapshot: snapshot(room) });
      return;
    }

    if (type === "controller_input") {
      const room = rooms.get(data.room);
      if (!room) return;
      const p = room.players.get(data.playerId);
      if (!p) return;
      p.input = {
        steer: Number(data.steer) || 0,
        throttle: Number(data.throttle) || 0,
        brake: Number(data.brake) || 0,
        tilt: Number(data.tilt) || 0,
      };
      if (room.host && room.host.readyState===1){
        room.host.send(JSON.stringify({ type:"player_input", playerId: p.id, input: p.input }));
      }
      return;
    }

    if (type === "host_set_state") {
      const room = rooms.get(data.room);
      if (!room) return;
      room.state = {
        mode: data.state?.mode || room.state.mode,
        trackId: data.state?.trackId || room.state.trackId,
        lapsToWin: Number(data.state?.lapsToWin || room.state.lapsToWin)
      };
      broadcast(room, { type:"room_snapshot", snapshot: snapshot(room) });
      return;
    }

    if (type === "host_reset") {
      const room = rooms.get(data.room);
      if (!room) return;
      broadcast(room, { type:"host_reset" });
      return;
    }
  });

  ws.on("close", () => {
    const code = ws._room;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;

    if (ws._role==="host" && room.host===ws) room.host=null;
    if (ws._role==="controller") {
      const pid = ws._playerId;
      if (pid && room.players.has(pid)) {
        const p = room.players.get(pid);
        if (p) p.ws = null;
      }
    }
    broadcast(room, { type:"room_snapshot", snapshot: snapshot(room) });
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log("Server listening on port", PORT));
