import { TRACKS } from "./tracks.js";

const canvas=document.getElementById("c");
const ctx=canvas.getContext("2d");

const trackSel=document.getElementById("trackSel");
const lapsSel=document.getElementById("lapsSel");
const playersEl=document.getElementById("players");
const createRoomBtn=document.getElementById("createRoom");
const copyLinkBtn=document.getElementById("copyLink");
const roomCodeEl=document.getElementById("roomCode");
const connEl=document.getElementById("conn");
const driveBtn=document.getElementById("driveBtn");
const resetBtn=document.getElementById("resetBtn");
const clearBtn=document.getElementById("clearBtn");
const overlay=document.getElementById("overlay");
const winnerNameEl=document.getElementById("winnerName");
const winnerMetaEl=document.getElementById("winnerMeta");
const backToBuildBtn=document.getElementById("backToBuild");

let ws, room=null, mode="build", lapsToWin=Number(lapsSel.value||3);
const trackWidth=120, halfW=trackWidth/2;

const cars=new Map();
const inputs=new Map();
let players=[];

for(const t of TRACKS){
  const o=document.createElement("option"); o.value=t.id; o.textContent=t.name; trackSel.appendChild(o);
}
trackSel.value="t1";

function connect(){
  const proto=location.protocol==="https:"?"wss":"ws";
  ws=new WebSocket(`${proto}://${location.host}`);
  ws.onopen=()=>{connEl.textContent="Server: connected"; if(room) send({type:"host_join",room});};
  ws.onclose=()=>connEl.textContent="Server: disconnected";
  ws.onmessage=(ev)=>{
    const msg=JSON.parse(ev.data);
    if(msg.type==="room_created"){
      room=msg.room; roomCodeEl.textContent=room;
      send({type:"host_join",room});
      publishState();
    }
    if(msg.type==="room_snapshot"){
      players=msg.snapshot.players||[];
      if(msg.snapshot.state){
        lapsToWin=Number(msg.snapshot.state.lapsToWin||lapsToWin);
        lapsSel.value=String(lapsToWin);
        if(msg.snapshot.state.trackId) trackSel.value=msg.snapshot.state.trackId;
        mode=msg.snapshot.state.mode||mode;
      }
      renderPlayers();
      syncCars();
    }
    if(msg.type==="player_input") inputs.set(msg.playerId, msg.input);
    if(msg.type==="host_reset") resetCars();
  };
}
connect();

function send(obj){ if(ws && ws.readyState===1) ws.send(JSON.stringify(obj)); }
function publishState(){ if(!room) return; send({type:"host_set_state",room,state:{mode,trackId:trackSel.value,lapsToWin}}); }

createRoomBtn.addEventListener("click",()=>send({type:"create_room"}));
copyLinkBtn.addEventListener("click", async ()=>{
  if(!room) return;
  const url=`${location.origin}/controller.html?room=${room}`;
  await navigator.clipboard.writeText(url);
  copyLinkBtn.textContent="Copied!";
  setTimeout(()=>copyLinkBtn.textContent="Copy Controller Link",900);
});

lapsSel.addEventListener("change",()=>{lapsToWin=Number(lapsSel.value||3); publishState();});
trackSel.addEventListener("change",()=>{ if(mode!=="build") return; publishState(); resetCars(); });

driveBtn.addEventListener("click",()=>{
  if(!room) return;
  mode = (mode==="build") ? "drive" : "build";
  overlay.classList.remove("show");
  publishState();
});
resetBtn.addEventListener("click",()=>send({type:"host_reset",room}));
clearBtn.addEventListener("click",()=>flash("Custom builder comes next — v5.1 focuses on steering/collisions inside preset tracks."));
backToBuildBtn.addEventListener("click",()=>{mode="build"; overlay.classList.remove("show"); publishState();});

function renderPlayers(){
  playersEl.innerHTML="";
  for(const p of players){
    const d=document.createElement("div");
    d.className="player";
    d.innerHTML=`<div><strong>${esc(p.name)}</strong><div style="font-size:12px;opacity:.7">${p.id}</div></div><div class="badge">${p.connected?"online":"off"}</div>`;
    playersEl.appendChild(d);
  }
}
function esc(s){return String(s).replace(/[&<>"']/g,m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[m]));}

function getTrack(){ return TRACKS.find(t=>t.id===trackSel.value)||TRACKS[0]; }
function dist2(ax,ay,bx,by){const dx=ax-bx,dy=ay-by; return dx*dx+dy*dy;}

function nearestPoint(pt, poly){
  let best=null, cum=0;
  for(let i=0;i<poly.length-1;i++){
    const [x1,y1]=poly[i], [x2,y2]=poly[i+1];
    const vx=x2-x1, vy=y2-y1;
    const wx=pt.x-x1, wy=pt.y-y1;
    const vv=vx*vx+vy*vy || 1e-9;
    let t=(wx*vx+wy*vy)/vv; t=Math.max(0,Math.min(1,t));
    const px=x1+t*vx, py=y1+t*vy;
    const d=dist2(pt.x,pt.y,px,py);
    const segLen=Math.sqrt(vv);
    const along=cum + t*segLen;
    if(!best || d<best.d) best={x:px,y:py,vx,vy,d,along,segLen};
    cum += segLen;
  }
  best.totalLen=cum;
  return best;
}
function segNorm(vx,vy){
  const len=Math.hypot(vx,vy)||1;
  return {nx:-vy/len, ny:vx/len, tx:vx/len, ty:vy/len};
}

const carR=12;
const maxSpeed=520, accel=520, brakeDecel=760, drag=1.5, steerRate=2.8, wallF=0.65;

function resetCars(){
  cars.clear();
  const t=getTrack();
  const np=nearestPoint({x:t.centerline[0][0],y:t.centerline[0][1]}, t.centerline);
  const n=segNorm(np.vx,np.vy);
  const lane=[-30,0,30,-60,60];
  let idx=0;
  for(const p of players){
    if(!p.connected) continue;
    const off=lane[idx%lane.length];
    cars.set(p.id,{id:p.id,name:p.name,x:np.x+n.nx*off,y:np.y+n.ny*off,a:Math.atan2(n.ty,n.tx),v:0,vx:0,vy:0,color:pick(idx),laps:0,lastAlong:np.along,finished:false});
    idx++;
  }
}
function syncCars(){
  for(const p of players){ if(p.connected && !cars.has(p.id)) return resetCars(); }
}
function pick(i){return ["#00d1ff","#ffd400","#ff4d6d","#7cff4d","#b06cff","#ff9f1c","#2ec4b6"][i%7];}
function clamp(v,a,b){return Math.max(a,Math.min(b,v));}
function flash(t){connEl.textContent=t; setTimeout(()=>connEl.textContent=(ws?.readyState===1?"Server: connected":"Server: disconnected"),1400);}

let lastT=performance.now();
function loop(now){
  const dt=Math.min(0.033,(now-lastT)/1000); lastT=now;
  if(mode==="drive") sim(dt);
  draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

function sim(dt){
  const track=getTrack();
  for(const car of cars.values()){
    if(car.finished) continue;
    const inp=inputs.get(car.id)||{steer:0,throttle:0,brake:0,tilt:0};
    const steer=clamp(inp.steer+inp.tilt,-1,1);
    const throttle=clamp(inp.throttle,0,1);
    const brake=clamp(inp.brake,0,1);

    const speed01=clamp(Math.abs(car.v)/maxSpeed,0,1);
    car.a += steer*steerRate*(0.25+0.75*speed01)*dt;

    if(throttle>0) car.v += accel*throttle*dt;
    if(brake>0) car.v -= brakeDecel*brake*dt;
    car.v = clamp(car.v, -maxSpeed*0.3, maxSpeed);
    car.v *= Math.exp(-drag*dt);

    car.vx = Math.cos(car.a)*car.v;
    car.vy = Math.sin(car.a)*car.v;
    car.x += car.vx*dt;
    car.y += car.vy*dt;

    constrain(car, track);

    if(track.loopGate){
      const dx=car.x-track.loopGate.p[0], dy=car.y-track.loopGate.p[1];
      if(dx*dx+dy*dy < track.loopGate.r*track.loopGate.r){
        if(Math.abs(car.v) < track.loopGate.minSpeed) car.v *= 0.3;
        else car.v = Math.min(maxSpeed, car.v*1.02);
      }
    }

    const np=nearestPoint({x:car.x,y:car.y}, track.centerline);
    const alongN=np.along/np.totalLen;
    const prevN=car.lastAlong/np.totalLen;
    if(prevN>0.85 && alongN<0.15 && car.v>40){
      car.laps += 1;
      if(car.laps>=lapsToWin){
        car.finished=true;
        winnerNameEl.textContent=car.name;
        winnerMetaEl.textContent=`Laps: ${car.laps}/${lapsToWin}`;
        overlay.classList.add("show");
        mode="finish";
        publishState();
      }
    }
    car.lastAlong=np.along;
  }

  const arr=[...cars.values()].filter(c=>!c.finished);
  for(let i=0;i<arr.length;i++){
    for(let j=i+1;j<arr.length;j++) collide(arr[i],arr[j]);
  }
}

function constrain(car, track){
  const np=nearestPoint({x:car.x,y:car.y}, track.centerline);
  const n=segNorm(np.vx,np.vy);
  const dx=car.x-np.x, dy=car.y-np.y;
  const lat=dx*n.nx + dy*n.ny;

  const limit = halfW - carR;
  if(Math.abs(lat)>limit){
    const cl=clamp(lat,-limit,limit);
    const tx=np.x + n.nx*cl, ty=np.y + n.ny*cl;

    const vdotn = car.vx*n.nx + car.vy*n.ny;
    const rvx = car.vx - 2*vdotn*n.nx;
    const rvy = car.vy - 2*vdotn*n.ny;

    car.x=tx; car.y=ty;
    car.vx=rvx*wallF; car.vy=rvy*wallF;
    car.v=Math.hypot(car.vx,car.vy)*Math.sign(car.v);
    car.a=Math.atan2(car.vy,car.vx);
  }
}

function collide(a,b){
  const dx=b.x-a.x, dy=b.y-a.y;
  const d=Math.hypot(dx,dy)||1e-6;
  const minD=carR*2.1;
  if(d>=minD) return;
  const nx=dx/d, ny=dy/d;
  const overlap=minD-d;
  a.x -= nx*overlap/2; a.y -= ny*overlap/2;
  b.x += nx*overlap/2; b.y += ny*overlap/2;

  const rel=(b.vx-a.vx)*nx + (b.vy-a.vy)*ny;
  const imp=rel*0.9;
  a.vx += imp*nx; a.vy += imp*ny;
  b.vx -= imp*nx; b.vy -= imp*ny;

  a.v=Math.hypot(a.vx,a.vy); a.a=Math.atan2(a.vy,a.vx);
  b.v=Math.hypot(b.vx,b.vy); b.a=Math.atan2(b.vy,b.vx);
}

function draw(){
  ctx.clearRect(0,0,canvas.width,canvas.height);
  const t=getTrack();
  drawTrack(t);
  drawFinish(t);
  for(const car of cars.values()) drawCar(car);
  drawHUD();
}

function drawTrack(t){
  const pts=t.centerline;
  ctx.lineJoin="round"; ctx.lineCap="round";
  ctx.strokeStyle="rgba(0,0,0,.35)"; ctx.lineWidth=trackWidth+26; ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]); ctx.stroke();
  ctx.strokeStyle="rgba(255,255,255,.10)"; ctx.lineWidth=trackWidth+14; ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]); ctx.stroke();
  ctx.strokeStyle="#ff7a18"; ctx.lineWidth=trackWidth; ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]); ctx.stroke();
  ctx.strokeStyle="rgba(255,255,255,.22)"; ctx.lineWidth=8; ctx.setLineDash([22,18]); ctx.beginPath(); ctx.moveTo(pts[0][0],pts[0][1]); for(let i=1;i<pts.length;i++) ctx.lineTo(pts[i][0],pts[i][1]); ctx.stroke(); ctx.setLineDash([]);
}

function drawFinish(t){
  const f=t.finish;
  ctx.save();
  ctx.strokeStyle="#eaeaea"; ctx.lineWidth=6;
  ctx.beginPath(); ctx.moveTo(f.a[0],f.a[1]); ctx.lineTo(f.b[0],f.b[1]); ctx.stroke();
  ctx.fillStyle="rgba(0,0,0,.65)"; ctx.font="900 12px system-ui"; ctx.textAlign="center";
  ctx.fillText("FINISH",(f.a[0]+f.b[0])/2,(f.a[1]+f.b[1])/2-10);
  ctx.restore();
}

function drawCar(c){
  ctx.save(); ctx.translate(c.x,c.y); ctx.rotate(c.a);
  ctx.fillStyle=c.color; rr(-18,-10,36,20,8);
  ctx.fillStyle="rgba(0,0,0,.25)"; rr(-10,-7,20,14,6);
  ctx.fillStyle="rgba(255,255,255,.35)"; rr(10,-5,7,10,3);
  ctx.fillStyle="rgba(0,0,0,.65)"; ctx.font="900 10px system-ui"; ctx.textAlign="center";
  ctx.fillText(c.name.slice(0,6),0,3);
  ctx.restore();
}
function rr(x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r);
  ctx.fill();
}

function drawHUD(){
  ctx.save();
  ctx.fillStyle="rgba(0,0,0,.40)"; ctx.fillRect(12,12,240,20+cars.size*18);
  ctx.fillStyle="#eaf2ff"; ctx.font="800 12px system-ui";
  ctx.fillText(`Mode: ${mode.toUpperCase()}  •  ${trackSel.options[trackSel.selectedIndex]?.textContent||""}`,20,28);
  let y=46;
  for(const c of cars.values()){
    ctx.fillStyle=c.color; ctx.fillRect(20,y-10,10,10);
    ctx.fillStyle="#eaf2ff"; ctx.fillText(`${c.name}: ${c.laps}/${lapsToWin}`,36,y);
    y+=18;
  }
  ctx.restore();
}

// init
resetCars();
publishState();
