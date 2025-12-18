(() => {
  const $ = (id)=>document.getElementById(id);
  const roomInput = $("room");
  const nameInput = $("name");
  const joinBtn = $("join");
  const statusEl = $("joinStatus");
  const connEl = $("conn");

  const gasBtn = $("gas");
  const brakeBtn = $("brake");
  const leftBtn = $("left");
  const rightBtn = $("right");
  const calBtn = $("cal");
  const tiltReadout = $("tiltReadout");

  const state = {
    ws:null,
    joined:false,
    input:{gas:false,brake:false,left:false,right:false,tilt:0},
    tilt0:null,
    tiltScale:1.2
  };

  function wsUrl(){
    const proto = location.protocol==="https:" ? "wss:" : "ws:";
    return proto + "//" + location.host;
  }
  function send(obj){
    if(state.ws && state.ws.readyState===1) state.ws.send(JSON.stringify(obj));
  }
  function connect(){
    state.ws = new WebSocket(wsUrl());
    connEl.textContent="connecting…";
    state.ws.onopen=()=>{ connEl.textContent="connected"; };
    state.ws.onclose=()=>{ connEl.textContent="disconnected"; setTimeout(connect,800); };
    state.ws.onmessage=(ev)=>{
      const msg=JSON.parse(ev.data);
      if(msg.type==="joined"){
        state.joined=true;
        statusEl.textContent="Joined room " + (msg.room?.code||"") + " ✅";
      }
      if(msg.type==="error") statusEl.textContent=msg.message||"Error";
    };
  }

  function hold(btn, key){
    const on=()=>{ state.input[key]=true; send({type:"input", input:state.input}); btn.classList.add("btn-primary"); };
    const off=()=>{ state.input[key]=false; send({type:"input", input:state.input}); btn.classList.remove("btn-primary"); };
    btn.addEventListener("touchstart",(e)=>{e.preventDefault(); on();},{passive:false});
    btn.addEventListener("touchend",(e)=>{e.preventDefault(); off();},{passive:false});
    btn.addEventListener("touchcancel",(e)=>{e.preventDefault(); off();},{passive:false});
    btn.addEventListener("mousedown", on);
    btn.addEventListener("mouseup", off);
    btn.addEventListener("mouseleave", off);
  }
  hold(gasBtn,"gas"); hold(brakeBtn,"brake"); hold(leftBtn,"left"); hold(rightBtn,"right");

  joinBtn.onclick=()=>{
    const code=(roomInput.value||"").trim().toUpperCase();
    const name=(nameInput.value||"").trim() || "Player";
    if(code.length!==4){ statusEl.textContent="Enter a 4-letter room code."; return; }
    send({type:"join_room", code, name});
    statusEl.textContent="Joining…";
  };

  // URL param room
  const params=new URLSearchParams(location.search);
  const rp=params.get("room");
  if(rp) roomInput.value = rp.toUpperCase().slice(0,4);

  async function calibrate(){
    // iOS permission gate
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function"){
      const res = await DeviceMotionEvent.requestPermission().catch(()=>null);
      if(res !== "granted"){ statusEl.textContent="Motion permission denied."; return; }
    }
    statusEl.textContent="Calibrated ✅";
    // tilt0 will be set on next orientation event
    state.tilt0 = null;
  }
  calBtn.onclick=calibrate;

  window.addEventListener("deviceorientation",(e)=>{
    const gamma=(e.gamma ?? 0);
    if(state.tilt0===null) state.tilt0 = gamma;
    const tilt = ((gamma - state.tilt0)/35) * state.tiltScale;
    const clamped = Math.max(-1, Math.min(1, tilt));
    state.input.tilt = clamped;
    tiltReadout.textContent="tilt: " + clamped.toFixed(2);
    if(state.joined) send({type:"input", input:state.input});
  });

  connect();
})();
