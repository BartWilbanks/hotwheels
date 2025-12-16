# Hotwheels-Style Multiplayer Racer (MVP)

This project hosts:
- `index.html` (Host screen) — create room, build track, run race simulation
- `controller.html` (Phone controllers) — join by room code, steer/gas/brake
- WebSocket server (`server.js`) — rooms + realtime inputs

## Local run
```bash
npm install
npm start
```

Then open:
- Host: http://localhost:3000/
- Controller: http://localhost:3000/controller.html

## Notes
- Rooms are in-memory only (reset when server restarts).
- This is an MVP (no lap counting, collisions, or validation of connected track pieces yet).
