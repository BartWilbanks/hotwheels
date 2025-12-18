(() => {
  const qs = new URLSearchParams(location.search);
  const codeFromUrl = (qs.get("room") || "").toUpperCase();

  const el = {
    name: document.getElementById("name"),
    code: document.getElementById("code"),
    join: document.getElementById("join"),
    status: document.getElementById("status"),
    gas: document.getElementById("gas"),
    brake: document.getElementById("brake"),
    left: document.getElementById("left"),
    right: document.getElementById("right"),
    steerVal: document.getElementById("steerVal"),
    enableTilt: document.getElementById("enableTilt"),
    calibrate: document.getElementById("calibrate"),
  };

  if(codeFromUrl) el.code.value = codeFromUrl;

  const wsUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host;
  let ws = null;
  let joined = false;
  let roomCode = null;
  let playerId = null;

  const input = { gas:0, brake:0, steer:0 };
  let tiltEnabled = false;
  let neutralBeta = 0;
  let neutralGamma = 0;

  function connect(){
    ws = new WebSocket(wsUrl);
    el.status.textContent = "Connecting…";
    ws.addEventListener("open", () => {
      el.status.textContent = "Connected";
    });
    ws.addEventListener("close", () => {
      el.status.textContent = "Disconnected";
      joined = false;
    });
    ws.addEventListener("message", (ev) => {
      let msg; try{ msg = JSON.parse(ev.data); }catch{ return; }
      if(msg.type === "join_ok"){
        joined = true;
        roomCode = msg.code;
        playerId = msg.playerId;
        el.status.textContent = "Joined: " + roomCode;
      }
      if(msg.type === "join_error"){
        el.status.textContent = "Error: " + msg.message;
      }
    });
  }
  connect();

  function send(obj){
    if(ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  el.join.addEventListener("click", () => {
    const name = (el.name.value || "Player").trim();
    const code = (el.code.value || "").trim().toUpperCase();
    if(!code || code.length < 4){
      el.status.textContent = "Enter 4-letter room code";
      return;
    }
    send({type:"player_join", name, code});
  });

  // button inputs
  function bindHold(btn, onDown, onUp){
    const down = (e)=>{ e.preventDefault(); onDown(); };
    const up = (e)=>{ e.preventDefault(); onUp(); };
    btn.addEventListener("touchstart", down, {passive:false});
    btn.addEventListener("touchend", up, {passive:false});
    btn.addEventListener("touchcancel", up, {passive:false});
    btn.addEventListener("mousedown", down);
    btn.addEventListener("mouseup", up);
    btn.addEventListener("mouseleave", up);
  }

  bindHold(el.gas, ()=>{input.gas=1;}, ()=>{input.gas=0;});
  bindHold(el.brake, ()=>{input.brake=1;}, ()=>{input.brake=0;});
  bindHold(el.left, ()=>{input.steer=-1;}, ()=>{ if(input.steer<0) input.steer=0; });
  bindHold(el.right, ()=>{input.steer=1;}, ()=>{ if(input.steer>0) input.steer=0; });

  // gyro / tilt steering
  async function requestTiltPermission(){
    // iOS requires requestPermission()
    if(typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function"){
      const res = await DeviceOrientationEvent.requestPermission();
      return res === "granted";
    }
    return true; // Android/others
  }

  el.enableTilt.addEventListener("click", async () => {
    const ok = await requestTiltPermission().catch(()=>false);
    if(!ok){
      el.status.textContent = "Tilt permission denied";
      return;
    }
    tiltEnabled = true;
    el.status.textContent = joined ? ("Joined: " + roomCode + " (tilt on)") : "Tilt enabled";
  });

  el.calibrate.addEventListener("click", () => {
    neutralBeta = lastBeta;
    neutralGamma = lastGamma;
    el.status.textContent = joined ? ("Joined: " + roomCode + " (calibrated)") : "Calibrated";
  });

  let lastBeta=0, lastGamma=0;
  window.addEventListener("deviceorientation", (ev) => {
    if(!tiltEnabled) return;
    // gamma: left-right (-90..90). beta: front-back (-180..180)
    lastBeta = ev.beta ?? 0;
    lastGamma = ev.gamma ?? 0;
    const g = (lastGamma - neutralGamma);
    // normalize to [-1,1]
    const steer = Math.max(-1, Math.min(1, g / 25));
    input.steer = steer;
    el.steerVal.textContent = steer.toFixed(2);
  });

  // send input at 30Hz
  setInterval(() => {
    if(!joined || !roomCode || !playerId) return;
    send({type:"player_input", code: roomCode, playerId, gas: !!input.gas, brake: !!input.brake, steer: input.steer});
  }, 33);
})();
