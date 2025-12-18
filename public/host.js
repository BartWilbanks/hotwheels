/* Top-down Arcade v5 Host
   - True track constraint using polyline centerline + lateral offset
   - 3-wide track (widthPx)
   - Car-to-car collisions
   - Lap counting with finish line at track.finishAtS (distance along path)
   - Custom builder: grid pieces -> generated polyline (closed) + required Finish
*/
(() => {
  const canvas = document.getElementById("c");
  const ctx = canvas.getContext("2d");
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  function fitCanvas(){
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  window.addEventListener("resize", fitCanvas);
  setTimeout(fitCanvas, 0);

  const ui = {
    btnCreate: document.getElementById("btnCreate"),
    btnCopy: document.getElementById("btnCopy"),
    roomCode: document.getElementById("roomCode"),
    wsStatus: document.getElementById("wsStatus"),
    trackSelect: document.getElementById("trackSelect"),
    lapsToWin: document.getElementById("lapsToWin"),
    btnBuild: document.getElementById("btnBuild"),
    btnDrive: document.getElementById("btnDrive"),
    btnReset: document.getElementById("btnReset"),
    btnClear: document.getElementById("btnClear"),
    playersList: document.getElementById("playersList"),
    ctrlUrl: document.getElementById("ctrlUrl"),
    overlay: document.getElementById("overlay"),
    winnerName: document.getElementById("winnerName"),
    btnBackToBuild: document.getElementById("btnBackToBuild"),
  };

  // populate tracks select
  for(const t of TRACKS){
    const opt = document.createElement("option");
    opt.value = t.id; opt.textContent = t.name;
    ui.trackSelect.appendChild(opt);
  }

  // --- websocket ---
  const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
  let ws = null;
  let roomCode = null;

  function connectWS(){
    ws = new WebSocket(wsUrl);
    ui.wsStatus.textContent = "Server: connecting…";
    ws.addEventListener("open", () => {
      ui.wsStatus.textContent = "Server: connected";
    });
    ws.addEventListener("close", () => {
      ui.wsStatus.textContent = "Server: disconnected";
    });
    ws.addEventListener("message", (ev) => {
      let msg; try{ msg = JSON.parse(ev.data); }catch{ return; }
      onMsg(msg);
    });
  }
  connectWS();

  function send(obj){
    if(ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  // --- game state ---
  const state = {
    mode: "build", // build|drive|finish
    trackId: "t1",
    lapsToWin: 3,
    custom: null, // {pathPoints,widthPx,finishAtS,loopZones}
  };

  const room = {
    players: new Map(), // id -> {id,name,color,input}
    cars: new Map(),    // id -> car
    inputs: new Map(),  // id -> input
  };

  // --- track handling ---
  function currentTrack(){
    if(state.trackId === "custom" && state.custom) return state.custom;
    const t = TRACKS.find(x => x.id === state.trackId) || TRACKS[0];
    return t;
  }

  function getPath(){
    const t = currentTrack();
    return buildPath(t.points);
  }

  // --- physics constants ---
  const CAR = { w: 22, h: 36 };
  const MAX_SPEED = 520;         // px/s along track
  const ACCEL = 520;             // px/s^2
  const BRAKE = 820;
  const STEER_RATE = 240;        // px/s lateral change
  const OFFTRACK_FRICTION = 0.55;
  const WALL_BOUNCE = 0.35;

  function spawnCars(){
    const t = currentTrack();
    const path = getPath();
    const width = t.widthPx || 180;
    const lanes = 3;
    const laneSpacing = width / lanes; // approx
    const baseS = (t.finishAtS || 20) + 30;
    const ids = [...room.players.keys()];
    ids.forEach((id, idx) => {
      const p = room.players.get(id);
      const lane = idx % lanes;
      const d = (lane - (lanes-1)/2) * laneSpacing * 0.8;
      room.cars.set(id, {
        id,
        name: p.name,
        color: p.color,
        s: baseS + idx*12,
        d,
        v: 0,
        laps: 0,
        finished: false,
        lastS: baseS + idx*12,
        crashT: 0
      });
    });
  }

  function syncCarsToPlayers(){
    // ensure each player has a car object when in build/drive
    for(const [id,p] of room.players){
      if(!room.cars.has(id)){
        // spawn new car near finish with lane assignment based on join order
        const t = currentTrack();
        const width = t.widthPx || 180;
        const lanes = 3;
        const laneSpacing = width / lanes;
        const idx = [...room.players.keys()].indexOf(id);
        const lane = idx % lanes;
        const d = (lane - (lanes-1)/2) * laneSpacing * 0.8;
        const baseS = (t.finishAtS || 20) + 30;
        room.cars.set(id, {
          id, name:p.name, color:p.color,
          s: baseS + idx*12, d, v:0, laps:0,
          finished:false, lastS: baseS + idx*12, crashT:0
        });
      }
    }
    // remove cars for disconnected players
    for(const id of [...room.cars.keys()]){
      if(!room.players.has(id)) room.cars.delete(id);
    }
  }

  function resetRace(){
    ui.overlay.classList.add("hidden");
    state.mode = "build";
    updateModeButtons();
    for(const c of room.cars.values()){
      c.v = 0; c.laps=0; c.finished=false; c.crashT=0;
    }
    spawnCars();
    publishState();
  }

  function setMode(m){
    state.mode = m;
    if(m === "build"){
      ui.overlay.classList.add("hidden");
      // stop cars
      for(const c of room.cars.values()){ c.v = 0; c.finished=false; c.crashT=0; }
    }
    if(m === "drive"){
      ui.overlay.classList.add("hidden");
      syncCarsToPlayers();
      // if no cars yet, spawn
      if(room.cars.size === 0) spawnCars();
      for(const c of room.cars.values()){
        c.lastS = c.s;
        c.finished = false;
      }
    }
    updateModeButtons();
    publishState();
  }

  function updateModeButtons(){
    ui.btnBuild.classList.toggle("on", state.mode === "build");
    ui.btnDrive.classList.toggle("on", state.mode === "drive");
  }

  // --- UI actions ---
  ui.btnCreate.addEventListener("click", () => {
    send({type:"host_create_room"});
  });

  ui.btnCopy.addEventListener("click", async () => {
    if(!roomCode) return;
    const url = `${location.origin}/controller.html?room=${roomCode}`;
    try { await navigator.clipboard.writeText(url); } catch {}
    ui.ctrlUrl.textContent = url;
  });

  ui.trackSelect.addEventListener("change", () => {
    if(state.mode !== "build") return; // only change in build
    const id = ui.trackSelect.value;
    if(id === "custom"){
      // keep current custom
      state.trackId = "custom";
    } else {
      state.trackId = id;
      state.custom = null;
    }
    spawnCars();
    publishState();
  });

  ui.lapsToWin.addEventListener("change", () => {
    state.lapsToWin = parseInt(ui.lapsToWin.value, 10) || 3;
    publishState();
  });

  ui.btnBuild.addEventListener("click", () => setMode("build"));
  ui.btnDrive.addEventListener("click", () => setMode("drive"));
  ui.btnReset.addEventListener("click", () => {
    if(state.mode === "finish") ui.overlay.classList.add("hidden");
    spawnCars();
    publishState();
  });
  ui.btnClear.addEventListener("click", () => {
    if(state.mode !== "build") return;
    clearCustom();
    publishState();
  });

  ui.btnBackToBuild.addEventListener("click", () => {
    ui.overlay.classList.add("hidden");
    setMode("build");
  });

  // --- room + messages ---
  function onMsg(msg){
    if(msg.type === "room_created"){
      roomCode = msg.code;
      ui.roomCode.textContent = roomCode;
      const url = `${location.origin}/controller.html?room=${roomCode}`;
      ui.ctrlUrl.textContent = url;
      applySnapshot(msg.snapshot);
      // add custom option to track select
      ensureCustomOption();
      publishState();
      spawnCars();
    }
    if(msg.type === "room_update"){
      applySnapshot(msg.snapshot);
    }
    if(msg.type === "inputs"){
      // host receives inputs from server
      for(const row of (msg.inputs || [])){
        room.inputs.set(row.id, row.input);
      }
    }
  }

  function applySnapshot(snapshot){
    if(!snapshot) return;
    // players
    room.players.clear();
    for(const p of (snapshot.players || [])){
      room.players.set(p.id, { ...p });
      if(!room.inputs.has(p.id)) room.inputs.set(p.id, {gas:0,brake:0,steer:0});
    }
    syncCarsToPlayers();
    renderPlayers();
  }

  function renderPlayers(){
    ui.playersList.innerHTML = "";
    for(const p of room.players.values()){
      const row = document.createElement("div");
      row.className = "playerRow";
      const left = document.createElement("div");
      left.style.display="flex";left.style.alignItems="center";left.style.gap="8px";
      const dot = document.createElement("div"); dot.className="dot"; dot.style.background=p.color;
      const nm = document.createElement("div"); nm.className="playerName"; nm.textContent=p.name;
      left.appendChild(dot); left.appendChild(nm);
      const meta = document.createElement("div"); meta.className="playerMeta"; meta.textContent=p.id.slice(-4);
      row.appendChild(left); row.appendChild(meta);
      ui.playersList.appendChild(row);
    }
  }

  function publishState(){
    if(!roomCode) return;
    send({type:"host_set_state", code: roomCode, state});
  }

  // --- Custom track builder ---
  // Grid-based pieces with 90deg rotation and 2-connector validity.
  const GRID = {
    size: 40,
    cols: 26,
    rows: 16,
    originX: 80,
    originY: 70
  };

  const pieces = new Map(); // key "c,r" -> {type, rot, loop:boolean, finish:boolean}
  let selectedPiece = "straight";

  function key(c,r){ return c+","+r; }
  function cellToXY(c,r){
    return { x: GRID.originX + c*GRID.size, y: GRID.originY + r*GRID.size };
  }

  // connectors are N,E,S,W (0,1,2,3)
  function rotateDir(d, rot){ return (d + rot) % 4; }

  function pieceConnectors(type, rot){
    // base orientation rot=0
    // straight: connects W<->E
    // curveR: connects N<->E (turn right)
    // curveL: connects N<->W (turn left)
    // loop: straight but speed gate
    // finish: straight with finish line
    let dirs;
    if(type === "straight" || type==="loop" || type==="finish") dirs = [3,1]; // W,E
    else if(type === "curveR") dirs = [0,1]; // N,E
    else if(type === "curveL") dirs = [0,3]; // N,W
    else dirs = [];
    return dirs.map(d => rotateDir(d, rot));
  }

  function neighbor(c,r,dir){
    if(dir===0) return {c, r:r-1};
    if(dir===1) return {c:c+1, r};
    if(dir===2) return {c, r:r+1};
    return {c:c-1, r};
  }

  function isValidPlacement(c,r,type,rot){
    // if empty board, allow anything except erase
    if(type==="erase") return true;
    // must fit within grid
    if(c<0||r<0||c>=GRID.cols||r>=GRID.rows) return false;
    const conns = pieceConnectors(type,rot);
    if(conns.length<2) return false;
    // validity rule:
    // - each connector either connects to neighbor that has reciprocal connector, OR is currently open.
    // - but we only "snap valid" when at least one connector matches an existing neighbor (unless it's the first piece).
    const hasAny = pieces.size>0;
    let matches = 0;
    for(const d of conns){
      const nb = neighbor(c,r,d);
      const nbPiece = pieces.get(key(nb.c, nb.r));
      if(nbPiece){
        const nbConns = pieceConnectors(nbPiece.type, nbPiece.rot);
        const opposite = (d+2)%4;
        if(nbConns.includes(opposite)) matches++;
        else return false; // adjacent but incompatible
      }
    }
    if(!hasAny) return true;
    return matches>0;
  }

  function placePiece(c,r,type,rot){
    if(type==="erase"){
      pieces.delete(key(c,r));
      rebuildCustomTrack();
      return;
    }
    if(!isValidPlacement(c,r,type,rot)) return;
    pieces.set(key(c,r), {type, rot});
    rebuildCustomTrack();
  }

  function clearCustom(){
    pieces.clear();
    state.custom = null;
    if(state.trackId==="custom"){
      state.trackId="t1";
      ui.trackSelect.value="t1";
    }
    spawnCars();
  }

  function ensureCustomOption(){
    if(![...ui.trackSelect.options].some(o=>o.value==="custom")){
      const opt = document.createElement("option");
      opt.value="custom"; opt.textContent="Custom • Design Your Own";
      ui.trackSelect.appendChild(opt);
    }
  }

  function rebuildCustomTrack(){
    // build a continuous loop polyline by walking connectors if possible
    // must be closed and contain a finish piece to be selectable as "custom"
    const all = [...pieces.entries()].map(([k,v])=>{
      const [c,r]=k.split(",").map(Number);
      return {c,r, ...v};
    });
    if(all.length < 6){ state.custom=null; return; }

    // find finish
    const finishCell = all.find(p => p.type === "finish");
    if(!finishCell){ state.custom=null; return; }

    // Build graph nodes at cell centers; edges between connected neighbors
    const nodes = new Map(); // "c,r" -> {c,r, conns:[dir..]}
    for(const p of all){
      nodes.set(key(p.c,p.r), {c:p.c,r:p.r,type:p.type,rot:p.rot, conns: pieceConnectors(p.type,p.rot)});
    }
    // build adjacency list
    const adj = new Map(); // key -> array of neighbor keys
    for(const [k,n] of nodes){
      const out=[];
      for(const d of n.conns){
        const nb = neighbor(n.c,n.r,d);
        const nk = key(nb.c,nb.r);
        const nbNode = nodes.get(nk);
        if(!nbNode) continue;
        const opp=(d+2)%4;
        if(nbNode.conns.includes(opp)) out.push({k:nk,dir:d});
      }
      adj.set(k,out);
    }

    // each node should have degree 2 for a perfect loop (except allow degree 1 temporarily -> invalid)
    for(const [k, out] of adj){
      if(out.length !== 2){ state.custom=null; return; }
    }

    // walk loop starting from finishCell in a deterministic direction
    const startK = key(finishCell.c, finishCell.r);
    const start = nodes.get(startK);
    const firstNext = adj.get(startK)[0].k;

    const visited = new Set();
    const seq = [];
    let curK = startK;
    let prevK = null;
    while(true){
      if(visited.has(curK)) break;
      visited.add(curK);
      const n = nodes.get(curK);
      seq.push(n);
      const options = adj.get(curK).map(x=>x.k);
      let nextK = options[0] === prevK ? options[1] : options[0];
      prevK = curK;
      curK = nextK;
      if(curK === startK) break;
      if(seq.length > 500){ state.custom=null; return; }
    }
    if(curK !== startK) { state.custom=null; return; } // not closed

    // convert sequence of cell centers into polyline points
    const pts = [];
    for(const n of seq){
      const center = cellToXY(n.c,n.r);
      pts.push([center.x, center.y]);
    }
    pts.push(pts[0]); // close

    // loop zones from "loop" pieces: define s ranges later after path built
    const path = buildPath(pts);
    const loopZones=[];
    for(const n of seq){
      if(n.type==="loop"){
        const center = cellToXY(n.c,n.r);
        const near = nearestOnPath(path, center.x, center.y);
        loopZones.push({fromS: near.s-40, toS: near.s+40, minSpeed: 360});
      }
    }
    // finishAtS from finish cell
    const fCenter = cellToXY(finishCell.c, finishCell.r);
    const nearF = nearestOnPath(path, fCenter.x, fCenter.y);

    state.custom = {
      id:"custom",
      name:"Custom • Design Your Own",
      widthPx: 180,
      points: pts,
      finishAtS: nearF.s,
      loopZones
    };
    // if we're in build mode and user is building, allow selecting custom
    ensureCustomOption();
    state.trackId = "custom";
    ui.trackSelect.value = "custom";
    spawnCars();
  }

  // piece selection buttons
  document.querySelectorAll(".pieceBtn").forEach(btn=>{
    btn.addEventListener("click", ()=>{
      selectedPiece = btn.dataset.piece;
      document.querySelectorAll(".pieceBtn").forEach(b=>b.classList.remove("on"));
      btn.classList.add("on");
    });
  });

  // interactions on canvas (build mode)
  canvas.addEventListener("contextmenu", e => e.preventDefault());
  canvas.addEventListener("mousedown", (e)=>{
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left);
    const y = (e.clientY - rect.top);
    if(state.mode !== "build") return;

    const c = Math.round((x - GRID.originX)/GRID.size);
    const r = Math.round((y - GRID.originY)/GRID.size);
    const k = key(c,r);
    if(e.button === 2){
      // right click delete
      pieces.delete(k);
      rebuildCustomTrack();
      return;
    }
    const existing = pieces.get(k);
    if(existing){
      // rotate +90
      existing.rot = (existing.rot + 1) % 4;
      // validate rotation wrt neighbors; if invalid, roll back
      if(!isValidPlacement(c,r, existing.type, existing.rot)){
        existing.rot = (existing.rot + 3) % 4;
      }
      rebuildCustomTrack();
      return;
    }
    placePiece(c,r, selectedPiece==="erase"?"erase":selectedPiece, 0);
  });

  // --- simulation loop ---
  let last = performance.now();
  function tick(now){
    const dt = Math.min(0.033, (now-last)/1000);
    last = now;
    step(dt);
    draw();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  function inLoopZone(track, s){
    for(const z of (track.loopZones||[])){
      let a = z.fromS, b = z.toS;
      // normalize wrap by checking both
      if(a<0 || b<0 || a>trackPath.total || b>trackPath.total){
        // allow loose; handle by modulo checks
      }
      const S=((s%trackPath.total)+trackPath.total)%trackPath.total;
      const from=((a%trackPath.total)+trackPath.total)%trackPath.total;
      const to=((b%trackPath.total)+trackPath.total)%trackPath.total;
      if(from <= to){
        if(S>=from && S<=to) return z;
      }else{
        if(S>=from || S<=to) return z;
      }
    }
    return null;
  }

  let trackPath = getPath();

  function step(dt){
    // keep current path updated if track changes / custom changes
    trackPath = getPath();

    if(state.mode !== "drive") return;

    syncCarsToPlayers();

    const t = currentTrack();
    const width = t.widthPx || 180;
    const half = width/2;

    // update cars from inputs
    for(const [id, car] of room.cars){
      if(car.finished) continue;

      const inp = room.inputs.get(id) || {gas:0,brake:0,steer:0};

      // acceleration/brake along s
      if(inp.gas) car.v += ACCEL*dt;
      if(inp.brake) car.v -= BRAKE*dt;
      car.v = Math.max(0, Math.min(MAX_SPEED, car.v));

      // lateral (steer) changes offset
      car.d += inp.steer * STEER_RATE * dt;

      // offtrack clamp + friction
      if(Math.abs(car.d) > half){
        const sign = Math.sign(car.d);
        car.d = sign * half;
        car.v *= OFFTRACK_FRICTION;
        // bounce effect: push back a bit
        car.d -= sign * 10 * WALL_BOUNCE;
      }

      // loop segment gate
      const z = inLoopZone(t, car.s);
      if(z && car.v < z.minSpeed){
        // "crash" slowdown
        car.v *= 0.35;
        car.crashT = 0.6;
      }
      if(car.crashT>0) car.crashT = Math.max(0, car.crashT - dt);

      // advance along path
      const prevS = car.s;
      car.s += car.v * dt;
      // lap detection: crossing finish line s position forward with wrap
      const finishS = (t.finishAtS || 20);
      const a = ((prevS%trackPath.total)+trackPath.total)%trackPath.total;
      const b = ((car.s%trackPath.total)+trackPath.total)%trackPath.total;
      // detect wrap
      const wrapped = (b < a);
      if(wrapped){
        // only count if finish line is near start section or we crossed full loop
        car.laps += 1;
        if(car.laps >= state.lapsToWin){
          car.finished = true;
          // declare winner
          declareWinner(car);
        }
      } else {
        // optionally count if finish line is crossed without wrap (for tracks where finishS not near 0)
        if(a < finishS && b >= finishS && car.v > 60){
          // count when crossing finish line forward
          car.laps += 1;
          if(car.laps >= state.lapsToWin){
            car.finished = true;
            declareWinner(car);
          }
        }
      }

      car.lastS = prevS;
    }

    // car-to-car collisions (simple)
    const cars = [...room.cars.values()];
    for(let i=0;i<cars.length;i++){
      for(let j=i+1;j<cars.length;j++){
        const A = cars[i], B = cars[j];
        if(A.finished || B.finished) continue;
        const pa = carWorldPos(A);
        const pb = carWorldPos(B);
        const dx = pb.x - pa.x, dy = pb.y - pa.y;
        const d = Math.hypot(dx,dy);
        const minD = 26;
        if(d < minD && d>0.001){
          const push = (minD - d)/2;
          const nx = dx/d, ny = dy/d;
          // push lateral offsets a bit (approx)
          A.d -= nx*push*0.5;
          B.d += nx*push*0.5;
          A.v *= 0.92; B.v *= 0.92;
        }
      }
    }
  }

  function declareWinner(car){
    if(state.mode === "finish") return;
    state.mode = "finish";
    updateModeButtons();
    ui.winnerName.textContent = car.name || "—";
    ui.overlay.classList.remove("hidden");
    publishState();
  }

  function carWorldPos(car){
    const p = sampleAtS(trackPath, car.s);
    const x = p.x + p.nx * car.d;
    const y = p.y + p.ny * car.d;
    const ang = Math.atan2(p.ty, p.tx);
    return {x,y,ang,tx:p.tx,ty:p.ty,nx:p.nx,ny:p.ny};
  }

  // --- rendering ---
  function draw(){
    const rect = canvas.getBoundingClientRect();
    // clear
    ctx.clearRect(0,0,rect.width,rect.height);

    // draw track
    const t = currentTrack();
    const width = t.widthPx || 180;
    drawTrack(trackPath, width, t);

    // draw builder overlay grid + pieces in build mode
    if(state.mode === "build"){
      drawGrid();
      drawPieces();
      drawBuildHint();
    }

    // draw cars
    for(const car of room.cars.values()){
      const p = carWorldPos(car);
      drawCar(p.x,p.y,p.ang,car.color,car.name,car.laps);
    }

    // HUD
    drawHud();
  }

  function drawTrack(path, width, t){
    // centerline sampling for stroke outline
    const steps = 240;
    const pts = [];
    for(let i=0;i<=steps;i++){
      const s = (i/steps)*path.total;
      const p = sampleAtS(path, s);
      pts.push(p);
    }

    // base orange ribbon
    ctx.save();
    ctx.lineJoin="round";
    ctx.lineCap="round";

    // shadow outer
    ctx.strokeStyle="rgba(0,0,0,.45)";
    ctx.lineWidth = width + 24;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for(const p of pts) ctx.lineTo(p.x,p.y);
    ctx.stroke();

    // orange
    ctx.strokeStyle="#ff7a18";
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for(const p of pts) ctx.lineTo(p.x,p.y);
    ctx.stroke();

    // lane lines (3 lanes)
    ctx.strokeStyle="rgba(255,255,255,.18)";
    ctx.lineWidth = 3;
    for(const off of [-width/6, width/6]){
      ctx.beginPath();
      for(let i=0;i<pts.length;i++){
        const p = pts[i];
        const x = p.x + p.nx * off;
        const y = p.y + p.ny * off;
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();
    }

    // decals
    ctx.fillStyle="rgba(0,0,0,.18)";
    for(let k=0;k<12;k++){
      const s = (k/12)*path.total;
      const p = sampleAtS(path, s);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(p.ty,p.tx));
      ctx.fillRect(-10, -width/2 + 12, 20, 6);
      ctx.restore();
    }

    // finish banner
    const fs = t.finishAtS || 20;
    const fp = sampleAtS(path, fs);
    ctx.save();
    ctx.translate(fp.x, fp.y);
    ctx.rotate(Math.atan2(fp.ty, fp.tx));
    ctx.fillStyle="rgba(0,0,0,.35)";
    ctx.fillRect(-2, -width/2-18, 4, width+36);
    ctx.fillStyle="rgba(255,255,255,.9)";
    for(let i=-Math.floor(width/2)-10;i<Math.floor(width/2)+10;i+=12){
      ctx.fillRect(-18, i, 10, 8);
      ctx.fillRect(8, i+6, 10, 8);
    }
    ctx.fillStyle="rgba(255,255,255,.85)";
    ctx.font="900 12px system-ui";
    ctx.textAlign="center";
    ctx.fillText("FINISH", 0, -width/2-26);
    ctx.restore();

    // loop zones highlight
    ctx.strokeStyle="rgba(255,255,255,.20)";
    ctx.lineWidth=8;
    for(const z of (t.loopZones||[])){
      const p1 = sampleAtS(path, z.fromS);
      const p2 = sampleAtS(path, z.toS);
      ctx.beginPath();
      ctx.moveTo(p1.x,p1.y);
      // draw short arc by sampling
      const seg = 22;
      for(let i=0;i<=seg;i++){
        const s = z.fromS + (i/seg)*(z.toS - z.fromS);
        const p = sampleAtS(path, s);
        ctx.lineTo(p.x,p.y);
      }
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawCar(x,y,ang,color,name,laps){
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate(ang);
    // shadow
    ctx.fillStyle="rgba(0,0,0,.35)";
    ctx.fillRect(-CAR.w/2-2, -CAR.h/2+3, CAR.w+4, CAR.h+4);
    // body
    ctx.fillStyle=color || "#00E5FF";
    ctx.fillRect(-CAR.w/2, -CAR.h/2, CAR.w, CAR.h);
    // windshield
    ctx.fillStyle="rgba(255,255,255,.25)";
    ctx.fillRect(-CAR.w/2+4, -CAR.h/2+6, CAR.w-8, 10);
    // stripes
    ctx.fillStyle="rgba(0,0,0,.18)";
    ctx.fillRect(-2, -CAR.h/2, 4, CAR.h);
    ctx.restore();

    // name tag
    ctx.save();
    ctx.fillStyle="rgba(0,0,0,.55)";
    ctx.fillRect(x-42, y-52, 84, 20);
    ctx.fillStyle="#fff";
    ctx.font="800 11px system-ui";
    ctx.textAlign="center";
    ctx.fillText(name || "", x, y-38);
    ctx.fillStyle="rgba(255,255,255,.75)";
    ctx.font="700 10px system-ui";
    ctx.fillText(`Lap ${laps||0}/${state.lapsToWin}`, x, y-24);
    ctx.restore();
  }

  function drawHud(){
    ctx.save();
    ctx.fillStyle="rgba(0,0,0,.35)";
    ctx.fillRect(14, 14, 220, 66);
    ctx.fillStyle="rgba(255,255,255,.9)";
    ctx.font="900 12px system-ui";
    ctx.fillText(`Mode: ${state.mode.toUpperCase()}`, 24, 38);
    const t = currentTrack();
    ctx.fillStyle="rgba(255,255,255,.75)";
    ctx.font="700 12px system-ui";
    ctx.fillText(`Track: ${t.name}`, 24, 58);
    ctx.restore();
  }

  function drawGrid(){
    ctx.save();
    ctx.strokeStyle="rgba(255,255,255,.06)";
    for(let c=0;c<=GRID.cols;c++){
      const x = GRID.originX + c*GRID.size;
      ctx.beginPath();
      ctx.moveTo(x, GRID.originY);
      ctx.lineTo(x, GRID.originY + GRID.rows*GRID.size);
      ctx.stroke();
    }
    for(let r=0;r<=GRID.rows;r++){
      const y = GRID.originY + r*GRID.size;
      ctx.beginPath();
      ctx.moveTo(GRID.originX, y);
      ctx.lineTo(GRID.originX + GRID.cols*GRID.size, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPieces(){
    ctx.save();
    for(const [k,p] of pieces.entries()){
      const [c,r]=k.split(",").map(Number);
      const {x,y}=cellToXY(c,r);
      ctx.save();
      ctx.translate(x,y);
      ctx.rotate((Math.PI/2)*p.rot);
      // draw piece token
      ctx.fillStyle = "rgba(255,255,255,.08)";
      ctx.fillRect(-18,-18,36,36);
      ctx.strokeStyle="rgba(255,255,255,.15)";
      ctx.strokeRect(-18,-18,36,36);

      // icon
      ctx.strokeStyle = p.type==="finish" ? "rgba(255,255,255,.9)" : "rgba(255,255,255,.55)";
      ctx.lineWidth=4;
      ctx.lineCap="round";
      ctx.beginPath();
      if(p.type==="straight" || p.type==="loop" || p.type==="finish"){
        ctx.moveTo(-14,0); ctx.lineTo(14,0);
      }else if(p.type==="curveR"){
        ctx.arc(0,0,14, -Math.PI/2, 0);
      }else if(p.type==="curveL"){
        ctx.arc(0,0,14, -Math.PI/2, -Math.PI);
      }
      ctx.stroke();

      if(p.type==="loop"){
        ctx.fillStyle="rgba(255,255,255,.75)";
        ctx.font="900 10px system-ui";
        ctx.textAlign="center";
        ctx.fillText("LOOP",0,4);
      }
      if(p.type==="finish"){
        ctx.fillStyle="rgba(255,255,255,.85)";
        ctx.font="900 10px system-ui";
        ctx.textAlign="center";
        ctx.fillText("FIN",0,4);
      }

      ctx.restore();
    }
    ctx.restore();
  }

  function drawBuildHint(){
    const ok = !!state.custom;
    ctx.save();
    ctx.fillStyle = ok ? "rgba(118,255,3,.18)" : "rgba(255,145,0,.16)";
    ctx.fillRect(14, canvas.getBoundingClientRect().height-54, 360, 40);
    ctx.fillStyle = ok ? "rgba(118,255,3,.85)" : "rgba(255,145,0,.85)";
    ctx.font="900 12px system-ui";
    ctx.fillText(ok ? "Custom track is VALID (closed loop + finish) — select Custom in Track list"
                    : "Custom track not valid yet: must be a closed loop and include a Finish Line piece",
                 24, canvas.getBoundingClientRect().height-29);
    ctx.restore();
  }

  // Add custom option
  ensureCustomOption();
  updateModeButtons();
})();
