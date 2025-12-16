
import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_,res)=>res.send("ok"));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

server.listen(process.env.PORT || 3000, () => {
  console.log("Server running");
});
