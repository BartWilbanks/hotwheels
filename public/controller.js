const statusEl=document.getElementById("status");
const roomEl=document.getElementById("room");
const nameEl=document.getElementById("name");
const joinBtn=document.getElementById("join");
const gasBtn=document.getElementById("gas");
const brakeBtn=document.getElementById("brake");
const leftBtn=document.getElementById("left");
const rightBtn=document.getElementById("right");
const enableTiltBtn=document.getElementById("enableTilt");
const calTiltBtn=document.getElementById("calTilt");

const qs=new URLSearchParams(location.search);
if(qs.get("room")) roomEl.value=qs.get("room").toUpperCase();

let ws, playerId=null, room=null;
let steer=0, throttle=0, brake=0;
let tiltEnabled=false, tiltZero=0, tiltValue=0;

function connect(){
  const proto=location.protocol==="https:"?"wss":"ws";
  ws=new WebSocket(`${proto}://${location.host}`);
  ws.onopen=()=>statusEl.textContent="Connected. Join a room.";
  ws.onclose=()=>statusEl.textContent="Disconnected. Refresh.";
  ws.onmessage=(ev)=>{
    const msg=JSON.parse(ev.data);
    if(msg.type==="joined"){
      playerId=msg.playerId; room=msg.room;
      statusEl.textContent=`Joined room ${room} as ${msg.name}`;
    }
  };
}
connect();

function sendInput(){
  if(!ws||ws.readyState!==1||!playerId||!room) return;
  ws.send(JSON.stringify({type:"controller_input",room,playerId,steer,throttle,brake,tilt:tiltEnabled?tiltValue:0}));
}
function bindHold(btn, onDown, onUp){
  const down=e=>{e.preventDefault();onDown();sendInput();};
  const up=e=>{e.preventDefault();onUp();sendInput();};
  btn.addEventListener("pointerdown",down);
  btn.addEventListener("pointerup",up);
  btn.addEventListener("pointercancel",up);
  btn.addEventListener("pointerleave",up);
}
bindHold(gasBtn,()=>throttle=1,()=>throttle=0);
bindHold(brakeBtn,()=>brake=1,()=>brake=0);
bindHold(leftBtn,()=>steer=-1,()=>steer=0);
bindHold(rightBtn,()=>steer=1,()=>steer=0);

joinBtn.addEventListener("click",()=>{
  const r=(roomEl.value||"").trim().toUpperCase();
  const n=(nameEl.value||"Player").trim();
  if(!r){statusEl.textContent="Enter a room code";return;}
  if(!ws||ws.readyState!==1){statusEl.textContent="Not connected yet";return;}
  ws.send(JSON.stringify({type:"controller_join",room:r,name:n}));
});

async function requestTiltPerm(){
  const D=window.DeviceOrientationEvent;
  if(D && typeof D.requestPermission==="function"){
    const res=await D.requestPermission();
    if(res!=="granted") throw new Error("permission denied");
  }
}
enableTiltBtn.addEventListener("click", async ()=>{
  try{await requestTiltPerm();tiltEnabled=true;statusEl.textContent="Tilt enabled. Tap Calibrate.";}
  catch(e){statusEl.textContent=`Tilt not enabled: ${e.message}`;}
});
calTiltBtn.addEventListener("click",()=>{tiltZero=tiltValue;statusEl.textContent="Tilt calibrated.";});

window.addEventListener("deviceorientation",(e)=>{
  if(!tiltEnabled) return;
  const gamma = (typeof e.gamma==="number")?e.gamma:0;
  const raw=(gamma-tiltZero)/25;
  tiltValue=Math.max(-1,Math.min(1,raw));
});

setInterval(sendInput,50);
