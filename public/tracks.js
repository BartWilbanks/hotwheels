/**
 * Tracks are centerline polylines in world space (canvas coords).
 * Physics constrains cars to a lateral offset from this centerline.
 * widthPx is full track width; we draw 3 lanes by default.
 * loopZones define "loop segment" gates: if speed < minSpeed -> crash slowdown.
 */
const TRACKS = [
  {
    id:"t1",
    name:"01 • Orange Oval",
    widthPx: 180,
    points: [
      [220,160],[860,160],[980,260],[980,440],[860,540],[220,540],[100,440],[100,260],[220,160]
    ],
    finishAtS: 40,
    loopZones:[]
  },
  {
    id:"t2",
    name:"02 • Figure‑8 Crossover",
    widthPx: 180,
    points: [
      [240,180],[600,180],[820,260],[820,340],[600,420],[380,500],[220,420],[220,340],[380,260],[600,260],[760,340],[760,420],[600,500],[380,500],
      [240,420],[240,340],[380,260],[600,180],[240,180]
    ],
    finishAtS: 30,
    loopZones:[{fromS:260,toS:320,minSpeed:320}] // "loop" gate on one leg
  },
  {
    id:"t3",
    name:"03 • S‑Curve Sprint",
    widthPx: 180,
    points: [
      [160,520],[260,420],[360,320],[500,260],[640,300],[760,360],[900,320],[980,220],[820,160],[620,180],[460,220],[320,200],[220,160],[120,220],[140,360],[220,460],[340,540],[520,560],[720,520],[860,460],[820,520],[700,580],[500,610],[320,600],[200,560],[160,520]
    ],
    finishAtS: 20,
    loopZones:[]
  },
  {
    id:"t4",
    name:"04 • Big Loop Challenge",
    widthPx: 180,
    points: [
      [240,520],[700,520],[860,460],[940,340],[860,220],[700,160],[520,160],[380,220],[360,340],[440,420],[560,420],[640,340],[600,260],[520,260],[480,340],[520,380],[600,380],[720,300],[820,340],[740,460],[520,560],[320,560],[240,520]
    ],
    finishAtS: 35,
    loopZones:[{fromS:140,toS:200,minSpeed:360}]
  },
  {
    id:"t5",
    name:"05 • Tight Technical",
    widthPx: 180,
    points: [
      [180,520],[300,520],[300,420],[420,420],[420,520],[620,520],[620,420],[740,420],[740,520],[920,520],[920,360],[820,360],[820,260],[920,260],
      [920,120],[740,120],[740,220],[620,220],[620,120],[420,120],[420,220],[300,220],[300,120],[120,120],[120,300],[220,300],[220,420],[120,420],
      [120,560],[180,560],[180,520]
    ],
    finishAtS: 25,
    loopZones:[]
  }
];

// --- polyline helpers ---
function dist(ax,ay,bx,by){const dx=ax-bx,dy=ay-by;return Math.hypot(dx,dy);}
function buildPath(points){
  // returns {points, segLen[], cumLen[], total}
  const segLen=[], cum=[0];
  let total=0;
  for(let i=0;i<points.length-1;i++){
    const [x1,y1]=points[i], [x2,y2]=points[i+1];
    const L=dist(x1,y1,x2,y2);
    segLen.push(L); total += L; cum.push(total);
  }
  return {points, segLen, cumLen:cum, total};
}
function sampleAtS(path, s){
  // wrap
  const S=((s%path.total)+path.total)%path.total;
  // find segment
  let i=0;
  while(i<path.segLen.length-1 && path.cumLen[i+1] < S) i++;
  const segS = S - path.cumLen[i];
  const L = path.segLen[i] || 1;
  const t = Math.max(0, Math.min(1, segS / L));
  const [x1,y1]=path.points[i];
  const [x2,y2]=path.points[i+1];
  const x = x1 + (x2-x1)*t;
  const y = y1 + (y2-y1)*t;
  const tx = (x2-x1)/L;
  const ty = (y2-y1)/L;
  // normal (left)
  const nx = -ty;
  const ny = tx;
  return {x,y, tx,ty, nx,ny, i, t, S};
}
function nearestOnPath(path, x, y){
  // returns {s, d, dist2}
  let best = {s:0, d:0, dist2:1e18};
  for(let i=0;i<path.points.length-1;i++){
    const [ax,ay]=path.points[i];
    const [bx,by]=path.points[i+1];
    const vx=bx-ax, vy=by-ay;
    const L2 = vx*vx+vy*vy || 1;
    let t = ((x-ax)*vx + (y-ay)*vy) / L2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + vx*t;
    const py = ay + vy*t;
    const dx = x - px, dy = y - py;
    const d2 = dx*dx + dy*dy;
    if(d2 < best.dist2){
      const L = Math.sqrt(L2);
      const tx = vx / L, ty = vy / L;
      const nx = -ty, ny = tx;
      const d = dx*nx + dy*ny; // signed
      const s = path.cumLen[i] + L*t;
      best = {s, d, dist2:d2};
    }
  }
  return best;
}
