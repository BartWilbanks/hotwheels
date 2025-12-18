/* Host: track build + arcade physics + laps + winner */
(() => {
  const $ = (id)=>document.getElementById(id);
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d");

  const btnCreate = $("btnCreate");
  const btnCopy = $("btnCopy");
  const btnMode = $("btnMode");
  const btnReset = $("btnReset");
  const btnClear = $("btnClear");
  const presetSelect = $("presetSelect");
  const lapsToWinSel = $("lapsToWin");
  const roomCodeEl = $("roomCode");
  const connPill = $("connPill");
  const playersEl = $("players");
  const piecesEl = $("pieces");
  const winnerOverlay = $("winnerOverlay");
  const winnerName = $("winnerName");
  const btnBackToBuild = $("btnBackToBuild");

  const state = {
    ws:null,
    room:null,
    mode:"build",
    trackDef:{ presetId:"01", customPieces:[], width:140, lapsToWin:3 },
    track:null,
    inputs:new Map(),
    cars:new Map(),
    lastTick:performance.now(),
    gridOffset:{x:120,y:70},
    dragPiece:null, // {kind, rot, gx,gy, valid}
    hover:null
  };

  // presets dropdown
  for(const p of PRESETS){
    const o=document.createElement("option");
    o.value=p.id; o.textContent=p.name;
    presetSelect.appendChild(o);
  }
  presetSelect.value = state.trackDef.presetId;

  // Pieces palette: click to select, then click grid to place (stable vs drag)
  const PALETTE = [
    {kind:"S", label:"Straight"},
    {kind:"C", label:"Curve"},
    {kind:"F", label:"Finish Line"},
    {kind:"L", label:"Loop Segment"},
  ];
  let selectedKind = null;
  function renderPalette(){
    piecesEl.innerHTML="";
    for(const item of PALETTE){
      const b=document.createElement("button");
      b.className="btn";
      b.style.width="100%";
      b.style.marginTop="8px";
      b.textContent=item.label;
      b.onclick=()=>{ if(state.mode!=="build") return; selectedKind=item.kind; };
      piecesEl.appendChild(b);
    }
  }
  renderPalette();

  function wsUrl(){
    const proto = location.protocol==="https:" ? "wss:" : "ws:";
    return proto + "//" + location.host;
  }
  function send(obj){
    if(state.ws && state.ws.readyState===1) state.ws.send(JSON.stringify(obj));
  }
  function connect(){
    state.ws = new WebSocket(wsUrl());
    connPill.textContent="Server: connecting…";
    state.ws.onopen=()=>{ connPill.textContent="Server: connected"; connPill.style.borderColor="rgba(40,209,124,.6)"; };
    state.ws.onclose=()=>{ connPill.textContent="Server: disconnected"; connPill.style.borderColor="rgba(255,59,48,.6)"; setTimeout(connect,800); };
    state.ws.onmessage=(ev)=>handle(JSON.parse(ev.data));
  }

  function handle(msg){
    if(msg.type==="room_created"){
      state.room = msg.room;
      roomCodeEl.textContent = state.room.code;
      state.mode = state.room.mode;
      state.trackDef = state.room.track;
      presetSelect.value = state.trackDef.presetId;
      lapsToWinSel.value = String(state.trackDef.lapsToWin||3);
      rebuildTrack();
      renderPlayers();
    }
    if(msg.type==="room_update"){
      state.room = msg.room;
      state.mode = state.room.mode;
      state.trackDef = state.room.track;
      presetSelect.value = state.trackDef.presetId;
      lapsToWinSel.value = String(state.trackDef.lapsToWin||3);
      rebuildTrack();
      renderPlayers();
      if(state.room.winner) showWinner(state.room.winner);
      else hideWinner();
      // keep cars synced to player list (so "car not showing" can't happen)
      syncCarsToPlayers();
    }
    if(msg.type==="player_input"){
      state.inputs.set(msg.playerId, msg.input);
    }
    if(msg.type==="reset_cars"){
      spawnCars();
    }
  }

  function controllerLink(){
    if(!state.room) return "";
    return location.origin + "/controller.html?room=" + state.room.code;
  }
  btnCopy.onclick = async ()=>{
    const link=controllerLink();
    if(!link) return;
    try{ await navigator.clipboard.writeText(link); btnCopy.textContent="Copied!"; setTimeout(()=>btnCopy.textContent="Copy Controller Link",1000); }
    catch{ prompt("Copy this link:", link); }
  };

  btnCreate.onclick = ()=>send({type:"create_room"});

  btnMode.onclick = ()=>{
    if(!state.room) return;
    const next = (state.mode==="drive") ? "build" : "drive";
    send({type:"set_mode", mode:next});
    if(next==="drive") spawnCars();
  };
  btnReset.onclick = ()=>{
    if(!state.room) return;
    spawnCars();
    send({type:"reset_cars"});
  };
  btnClear.onclick = ()=>{
    if(!state.room) return;
    state.trackDef.customPieces = [];
    send({type:"clear_custom", presetId: state.trackDef.presetId});
    rebuildTrack();
  };
  presetSelect.onchange = ()=>{
    state.trackDef.presetId = presetSelect.value;
    state.trackDef.customPieces = [];
    state.trackDef.lapsToWin = Number(lapsToWinSel.value);
    send({type:"set_track", track:state.trackDef});
    rebuildTrack();
  };
  lapsToWinSel.onchange = ()=>{
    state.trackDef.lapsToWin = Number(lapsToWinSel.value);
    send({type:"set_track", track:state.trackDef});
  };

  btnBackToBuild.onclick = ()=>{
    hideWinner();
    send({type:"set_mode", mode:"build"});
  };

  function renderPlayers(){
    playersEl.innerHTML="";
    if(!state.room) return;
    for(const p of state.room.players){
      const row=document.createElement("div");
      row.className="player";
      const left=document.createElement("div");
      left.style.display="flex"; left.style.alignItems="center"; left.style.gap="8px";
      const sw=document.createElement("span");
      sw.style.width="12px"; sw.style.height="12px"; sw.style.borderRadius="3px"; sw.style.background=p.color;
      left.appendChild(sw);
      const nm=document.createElement("div"); nm.className="name"; nm.textContent=p.name;
      left.appendChild(nm);
      const right=document.createElement("div");
      right.style.display="flex"; right.style.gap="6px"; right.style.alignItems="center";
      const lap=document.createElement("span"); lap.className="badge";
      lap.textContent = "Lap " + (p.lap||0) + "/" + (state.trackDef.lapsToWin||3);
      right.appendChild(lap);
      row.appendChild(left); row.appendChild(right);
      playersEl.appendChild(row);
    }
  }

  function rebuildTrack(){
    const preset=getPreset(state.trackDef.presetId);
    const tiles = (state.trackDef.customPieces && state.trackDef.customPieces.length) ? state.trackDef.customPieces : preset.tiles;
    state.track = TrackLib.buildTrack(tiles);
  }

  // ----- Build interactions -----
  function worldToGrid(x,y){
    const gx = Math.round((x - state.gridOffset.x)/TrackLib.TILE);
    const gy = Math.round((y - state.gridOffset.y)/TrackLib.TILE);
    return {gx,gy};
  }
  function pieceAt(gx,gy){
    return (state.trackDef.customPieces||[]).find(p=>p.x===gx && p.y===gy);
  }
  function removeAt(gx,gy){
    state.trackDef.customPieces = (state.trackDef.customPieces||[]).filter(p=>!(p.x===gx && p.y===gy));
  }
  function canPlace(kind,gx,gy,rot){
    if(pieceAt(gx,gy)) return false;
    const temp=[...(state.trackDef.customPieces||[]), {x:gx,y:gy,kind,rot}];
    if(kind==="F" && temp.filter(t=>t.kind==="F").length>1) return false;
    const built=TrackLib.buildTrack(temp);
    return !built.tiles.some(t=>t.invalid);
  }

  canvas.addEventListener("mousedown",(e)=>{
    if(state.mode!=="build") return;
    const rect=canvas.getBoundingClientRect();
    const x=(e.clientX-rect.left)*(canvas.width/rect.width);
    const y=(e.clientY-rect.top)*(canvas.height/rect.height);
    const {gx,gy}=worldToGrid(x,y);
    const placed=pieceAt(gx,gy);
    if(placed && e.button===0){
      // rotate +90 repeatably; if invalid, undo
      const old=placed.rot||0;
      placed.rot = (old+90)%360;
      const built=TrackLib.buildTrack(state.trackDef.customPieces);
      const t=built.tiles.find(t=>t.x===gx && t.y===gy);
      if(t && t.invalid) placed.rot=old;
      send({type:"set_track", track:state.trackDef});
      rebuildTrack();
      return;
    }
    if(selectedKind){
      // place new piece at rotation 0
      const rot=0;
      if(canPlace(selectedKind,gx,gy,rot)){
        state.trackDef.customPieces = state.trackDef.customPieces || [];
        state.trackDef.customPieces.push({x:gx,y:gy,kind:selectedKind,rot});
        send({type:"set_track", track:state.trackDef});
        rebuildTrack();
      }
    }
  });

  canvas.addEventListener("contextmenu",(e)=>{
    e.preventDefault();
    if(state.mode!=="build") return;
    const rect=canvas.getBoundingClientRect();
    const x=(e.clientX-rect.left)*(canvas.width/rect.width);
    const y=(e.clientY-rect.top)*(canvas.height/rect.height);
    const {gx,gy}=worldToGrid(x,y);
    if(pieceAt(gx,gy)){
      removeAt(gx,gy);
      send({type:"set_track", track:state.trackDef});
      rebuildTrack();
    }
  });

  // ----- Cars / physics -----
  function syncCarsToPlayers(){
    if(!state.room) return;
    const ids = new Set(state.room.players.map(p=>p.id));
    // remove cars for players that left
    for(const id of Array.from(state.cars.keys())){
      if(!ids.has(id)) state.cars.delete(id);
    }
    // add cars for new players
    for(const p of state.room.players){
      if(!state.cars.has(p.id)){
        state.cars.set(p.id, { id:p.id, name:p.name, color:p.color, x:0,y:0, ang:-Math.PI/2, speed:0, lap:0, lastCross:0, _prevProg:0, finished:false });
        state.inputs.set(p.id, {gas:false,brake:false,left:false,right:false,tilt:0});
      }
    }
  }

  function spawnCars(){
    syncCarsToPlayers();
    const p0 = (state.track && state.track.polyline.length) ? state.track.polyline[0] : {x:400,y:300};
    const lanes=[-1,0,1];
    let i=0;
    for(const p of (state.room?.players||[])){
      const car=state.cars.get(p.id);
      const lane=lanes[i%lanes.length]; i++;
      car.x = p0.x + lane*26;
      car.y = p0.y + 50;
      car.ang = -Math.PI/2;
      car.speed = 0;
      car.lap = 0;
      car.finished = false;
      car._prevProg = 0;
    }
    // reset scoreboard server-side
    for(const p of (state.room?.players||[])){
      send({type:"lap_update", playerId:p.id, lap:0, finished:false});
    }
  }

  function tick(dt){
    if(!state.track || state.track.polyline.length<2) return;
    const halfW = (state.trackDef.width||140)/2;
    const lapsToWin = state.trackDef.lapsToWin||3;

    // integrate
    for(const car of state.cars.values()){
      if(car.finished) continue;
      const input = state.inputs.get(car.id) || {gas:false,brake:false,left:false,right:false,tilt:0};
      const steer = ((input.right?1:0)-(input.left?1:0)) + (input.tilt||0)*0.9;
      car.ang += steer * dt * 2.2;

      if(input.gas) car.speed += 420*dt;
      if(input.brake) car.speed -= 520*dt;
      car.speed *= Math.pow(0.985, dt*60);
      car.speed = Math.max(0, Math.min(620, car.speed));

      car.x += Math.cos(car.ang)*car.speed*dt;
      car.y += Math.sin(car.ang)*car.speed*dt;

      const near = TrackLib.nearestOnTrack(state.track, {x:car.x,y:car.y});
      if(near.d > halfW){
        const dx = near.x - car.x, dy = near.y - car.y;
        const k = Math.min(1, (near.d-halfW)/80);
        car.x += dx*(0.18+0.32*k);
        car.y += dy*(0.18+0.32*k);
        car.speed *= 0.92;
      }

      // lap detect via progress wrap
      const prog = near.progress;
      const crossed = (car._prevProg>0.85 && prog<0.15 && near.d<halfW);
      car._prevProg = prog;
      if(crossed){
        const t=performance.now();
        if(t - car.lastCross > 900){
          car.lastCross = t;
          car.lap += 1;
          const fin = car.lap >= lapsToWin;
          send({type:"lap_update", playerId:car.id, lap:car.lap, finished:fin});
          if(fin){
            car.finished=true;
            showWinner({name:car.name,color:car.color,playerId:car.id});
          }
        }
      }
    }

    // collisions
    const cars = Array.from(state.cars.values());
    for(let i=0;i<cars.length;i++){
      for(let j=i+1;j<cars.length;j++){
        const a=cars[i], b=cars[j];
        const dx=b.x-a.x, dy=b.y-a.y;
        const d=Math.hypot(dx,dy);
        const min=22;
        if(d>0 && d<min){
          const nx=dx/d, ny=dy/d;
          const push=(min-d)/2;
          a.x -= nx*push; a.y -= ny*push;
          b.x += nx*push; b.y += ny*push;
          a.speed*=0.95; b.speed*=0.95;
        }
      }
    }
  }

  // ----- Rendering -----
  function draw(){
    ctx.clearRect(0,0,canvas.width,canvas.height);

    // grid
    ctx.save();
    ctx.globalAlpha=0.22;
    ctx.strokeStyle="#1a3f69";
    for(let x=0;x<canvas.width;x+=40){ ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,canvas.height); ctx.stroke(); }
    for(let y=0;y<canvas.height;y+=40){ ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(canvas.width,y); ctx.stroke(); }
    ctx.restore();

    drawTiles();

    // centerline
    if(state.track && state.track.polyline.length){
      ctx.save();
      ctx.strokeStyle="rgba(255,255,255,.16)";
      ctx.lineWidth=3;
      ctx.beginPath();
      ctx.moveTo(state.track.polyline[0].x, state.track.polyline[0].y);
      for(const p of state.track.polyline.slice(1)) ctx.lineTo(p.x,p.y);
      ctx.stroke();
      ctx.restore();
    }

    // finish banner
    drawFinish();

    // cars
    for(const car of state.cars.values()) drawCar(car);

    requestAnimationFrame(draw);
  }

  function drawTiles(){
    const preset=getPreset(state.trackDef.presetId);
    const tiles = (state.trackDef.customPieces && state.trackDef.customPieces.length) ? state.trackDef.customPieces : preset.tiles;
    const built=TrackLib.buildTrack(tiles);
    const bad=new Set(built.tiles.filter(t=>t.invalid).map(t=>t.x+","+t.y));
    for(const t of tiles){
      const wx=state.gridOffset.x + t.x*TrackLib.TILE;
      const wy=state.gridOffset.y + t.y*TrackLib.TILE;
      drawTile(t.kind, t.rot||0, wx, wy, bad.has(t.x+","+t.y));
    }
  }

  function drawTile(kind, rot, x, y, invalid){
    const w=TrackLib.TILE, c=w/2, r=c;
    ctx.save();
    ctx.translate(x,y);
    ctx.rotate((rot||0)*Math.PI/180);

    ctx.strokeStyle = "rgba(0,0,0,.25)";
    ctx.lineWidth = 10;
    ctx.lineJoin="round"; ctx.lineCap="round";
    ctx.stroke();

    ctx.strokeStyle = invalid ? "rgba(255,59,48,.45)" : "rgba(255,106,0,.92)";
    ctx.lineWidth = 46;
    ctx.beginPath();
    if(kind==="C") ctx.arc(c,c,r,Math.PI,Math.PI*1.5);
    else { ctx.moveTo(0,c); ctx.lineTo(w,c); }
    ctx.stroke();

    ctx.strokeStyle="rgba(255,255,255,.35)";
    ctx.lineWidth=6;
    ctx.beginPath();
    if(kind==="C") ctx.arc(c,c,r-10,Math.PI,Math.PI*1.5);
    else { ctx.moveTo(10,c); ctx.lineTo(w-10,c); }
    ctx.stroke();

    if(kind==="F"){
      ctx.fillStyle="rgba(255,255,255,.95)";
      ctx.fillRect(c-22,c-8,44,16);
      ctx.fillStyle="rgba(0,0,0,.9)";
      ctx.font="900 12px system-ui";
      ctx.textAlign="center"; ctx.textBaseline="middle";
      ctx.fillText("FINISH", c, c);
    }
    if(kind==="L"){
      ctx.fillStyle="rgba(255,255,255,.22)";
      ctx.beginPath(); ctx.arc(c,c,20,0,Math.PI*2); ctx.fill();
    }

    ctx.restore();
  }

  function drawCar(car){
    ctx.save();
    ctx.translate(car.x,car.y);
    ctx.rotate(car.ang);
    ctx.fillStyle=car.color;
    ctx.strokeStyle="rgba(0,0,0,.35)";
    ctx.lineWidth=2;
    roundRect(-14,-9,28,18,6);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle="rgba(255,255,255,.45)";
    roundRect(-6,-6,12,8,3); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle="rgba(255,255,255,.85)";
    ctx.font="800 12px system-ui";
    ctx.textAlign="center";
    ctx.fillText(car.name, car.x, car.y-16);
    ctx.restore();
  }

  function roundRect(x,y,w,h,r){
    ctx.beginPath();
    ctx.moveTo(x+r,y);
    ctx.lineTo(x+w-r,y);
    ctx.quadraticCurveTo(x+w,y,x+w,y+r);
    ctx.lineTo(x+w,y+h-r);
    ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
    ctx.lineTo(x+r,y+h);
    ctx.quadraticCurveTo(x,y+h,x,y+h-r);
    ctx.lineTo(x,y+r);
    ctx.quadraticCurveTo(x,y,x+r,y);
    ctx.closePath();
  }

  function drawFinish(){
    const seg = state.track && state.track.finishSeg;
    if(!seg) return;
    ctx.save();
    ctx.strokeStyle="rgba(255,255,255,.9)";
    ctx.lineWidth=8;
    ctx.beginPath(); ctx.moveTo(seg.a.x,seg.a.y); ctx.lineTo(seg.b.x,seg.b.y); ctx.stroke();
    const mx=(seg.a.x+seg.b.x)/2, my=(seg.a.y+seg.b.y)/2;
    ctx.fillStyle="rgba(0,0,0,.55)";
    ctx.fillRect(mx-46,my-18,92,22);
    ctx.fillStyle="rgba(255,255,255,.95)";
    ctx.font="900 12px system-ui";
    ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText("FINISH", mx, my-7);
    ctx.restore();
  }

  function showWinner(w){
    winnerName.textContent = w.name;
    winnerOverlay.classList.remove("hidden");
  }
  function hideWinner(){
    winnerOverlay.classList.add("hidden");
  }

  function loop(){
    const t=performance.now();
    const dt=Math.min(0.05,(t-state.lastTick)/1000);
    state.lastTick=t;
    if(state.mode==="drive") tick(dt);
    requestAnimationFrame(loop);
  }

  // bootstrap
  connect();
  rebuildTrack();
  draw();
  loop();
})();
