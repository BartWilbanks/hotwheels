/**
 * Track library: grid tiles -> centerline polyline + distance queries.
 * Arcade geometry, built for stability and simplicity.
 */
const TrackLib = (() => {
  const TILE = 120;
  const CENTER = TILE / 2;

  // Directions: 0=up,1=right,2=down,3=left
  const DIR_V = [
    {dx:0,dy:-1},
    {dx:1,dy:0},
    {dx:0,dy:1},
    {dx:-1,dy:0},
  ];

  function key(x,y){ return x + "," + y; }
  function rotDir(d, rot){ return (d + ((rot/90)|0)) & 3; }

  function arcPts(cx,cy,r,a0,a1,n){
    const pts=[];
    for(let i=0;i<=n;i++){
      const t=i/n;
      const a=a0+(a1-a0)*t;
      pts.push({x:cx+Math.cos(a)*r,y:cy+Math.sin(a)*r});
    }
    return pts;
  }

  function transformPts(pts, rot){
    const r = ((rot||0)/90)|0;
    return pts.map(p=>{
      let x=p.x, y=p.y;
      for(let i=0;i<r;i++){
        const nx = TILE - y;
        const ny = x;
        x=nx; y=ny;
      }
      return {x,y};
    });
  }

  // Base shapes are defined at rot=0
  // Straight: left -> right
  // Curve: left -> up (quarter arc)
  const SHAPES = {
    "S": { in:3, out:1, pts:[{x:0,y:CENTER},{x:TILE,y:CENTER}] },
    "F": { in:3, out:1, pts:[{x:0,y:CENTER},{x:TILE,y:CENTER}], finish:true },
    "L": { in:3, out:1, pts:[{x:0,y:CENTER},{x:TILE,y:CENTER}], loop:true },
    "C": { in:3, out:0, pts: arcPts(CENTER,CENTER,CENTER, Math.PI, Math.PI*1.5, 10) },
  };

  function shapeFor(kind, rot){
    const base = SHAPES[kind];
    if(!base) return null;
    return {
      kind, rot: rot||0,
      pts: transformPts(base.pts, rot||0),
      inDir: rotDir(base.in, rot||0),
      outDir: rotDir(base.out, rot||0),
      finish: !!base.finish,
      loop: !!base.loop
    };
  }

  function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }

  function connects(shape, dirWanted){
    return shape.inDir === dirWanted || shape.outDir === dirWanted;
  }

  function projSeg(p,a,b){
    const vx=b.x-a.x, vy=b.y-a.y;
    const wx=p.x-a.x, wy=p.y-a.y;
    const vv=vx*vx+vy*vy || 1;
    let u=(wx*vx+wy*vy)/vv;
    u=Math.max(0,Math.min(1,u));
    const x=a.x+u*vx, y=a.y+u*vy;
    const dx=p.x-x, dy=p.y-y;
    return { x,y,u,d:Math.hypot(dx,dy) };
  }

  function buildTrack(tiles){
    const map = new Map();
    for(const t of tiles){
      const s = shapeFor(t.kind, t.rot||0);
      if(!s) continue;
      map.set(key(t.x,t.y), { ...t, shape:s });
    }

    let finishTile = null;
    for(const item of map.values()){
      const {x,y,shape} = item;
      if(shape.finish) finishTile = item;

      const a = DIR_V[shape.inDir];
      const b = DIR_V[shape.outDir];
      const n1 = map.get(key(x+a.dx,y+a.dy));
      const n2 = map.get(key(x+b.dx,y+b.dy));
      if(!n1 || !connects(n1.shape, (shape.inDir+2)&3)) item.invalid = true;
      if(!n2 || !connects(n2.shape, (shape.outDir+2)&3)) item.invalid = true;
    }

    const start = finishTile || map.values().next().value;
    const poly = [];
    const visited = new Set();
    if(start){
      let cur = start;
      let guard=0;
      while(cur && guard++ < 1200){
        const {x,y,shape} = cur;
        const visitKey = key(x,y) + ":" + shape.kind + ":" + shape.rot;
        if(visited.has(visitKey)) break;
        visited.add(visitKey);

        const world = shape.pts.map(p=>({x: x*TILE + p.x, y: y*TILE + p.y}));
        if(poly.length) poly.push(...world.slice(1));
        else poly.push(...world);

        const v = DIR_V[shape.outDir];
        cur = map.get(key(x+v.dx, y+v.dy));
      }
    }

    const cum=[0];
    for(let i=1;i<poly.length;i++) cum[i]=cum[i-1]+dist(poly[i-1], poly[i]);
    const total = cum[cum.length-1] || 1;

    // Finish segment
    let finishSeg=null;
    if(finishTile){
      const {x,y,shape}=finishTile;
      const mid={x:x*TILE+CENTER,y:y*TILE+CENTER};
      const d=shape.outDir;
      const perp = (d===0||d===2) ? {x:1,y:0} : {x:0,y:1};
      const half=60;
      finishSeg = { a:{x:mid.x-perp.x*half,y:mid.y-perp.y*half}, b:{x:mid.x+perp.x*half,y:mid.y+perp.y*half}, dir:d };
    }

    return { tiles:Array.from(map.values()), polyline:poly, cumlen:cum, totalLen:total, finishSeg };
  }

  function nearestOnTrack(track, pt){
    const poly = track.polyline;
    if(poly.length < 2) return { x:pt.x,y:pt.y, s:0, d:1e9, progress:0 };
    let best = { x:poly[0].x, y:poly[0].y, s:0, d:1e9, progress:0 };
    for(let i=1;i<poly.length;i++){
      const a=poly[i-1], b=poly[i];
      const pr=projSeg(pt,a,b);
      if(pr.d < best.d){
        const segLen = dist(a,b);
        const s = track.cumlen[i-1] + pr.u*segLen;
        best = { x:pr.x, y:pr.y, s, d:pr.d, progress: s/track.totalLen };
      }
    }
    return best;
  }

  return { TILE, buildTrack, nearestOnTrack };
})();
