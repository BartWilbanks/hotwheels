/**
 * 5 preset Hot Wheels–style tracks.
 */
const PRESETS = [
  { id:"01", name:"01 • Orange Oval", lapsToWin:3, tiles:[
    {x:5,y:3,kind:"C",rot:0},{x:6,y:3,kind:"S",rot:90},{x:7,y:3,kind:"S",rot:90},{x:8,y:3,kind:"C",rot:90},
    {x:8,y:4,kind:"S",rot:0},{x:8,y:5,kind:"S",rot:0},{x:8,y:6,kind:"C",rot:180},
    {x:7,y:6,kind:"S",rot:90},{x:6,y:6,kind:"S",rot:90},{x:5,y:6,kind:"C",rot:270},
    {x:5,y:5,kind:"S",rot:0},{x:5,y:4,kind:"S",rot:0},
    {x:6,y:3,kind:"F",rot:90},
  ]},
  { id:"02", name:"02 • Figure-8 Crossover", lapsToWin:3, tiles:[
    {x:5,y:3,kind:"C",rot:0},{x:6,y:3,kind:"S",rot:90},{x:7,y:3,kind:"C",rot:90},
    {x:7,y:4,kind:"S",rot:0},{x:7,y:5,kind:"C",rot:180},
    {x:6,y:5,kind:"S",rot:90},{x:5,y:5,kind:"C",rot:270},
    {x:5,y:4,kind:"S",rot:0},
    {x:6,y:4,kind:"L",rot:0},
    {x:6,y:3,kind:"F",rot:90},
  ]},
  { id:"03", name:"03 • S-Curve Sprint", lapsToWin:3, tiles:[
    {x:4,y:5,kind:"C",rot:270},{x:4,y:4,kind:"S",rot:0},{x:4,y:3,kind:"C",rot:0},
    {x:5,y:3,kind:"S",rot:90},{x:6,y:3,kind:"C",rot:90},
    {x:6,y:4,kind:"S",rot:0},{x:6,y:5,kind:"C",rot:180},
    {x:5,y:5,kind:"S",rot:90},{x:4,y:5,kind:"F",rot:90},
  ]},
  { id:"04", name:"04 • Big Loop Challenge", lapsToWin:3, tiles:[
    {x:4,y:3,kind:"C",rot:0},{x:5,y:3,kind:"S",rot:90},{x:6,y:3,kind:"S",rot:90},{x:7,y:3,kind:"C",rot:90},
    {x:7,y:4,kind:"L",rot:0},
    {x:7,y:5,kind:"S",rot:0},{x:7,y:6,kind:"C",rot:180},
    {x:6,y:6,kind:"S",rot:90},{x:5,y:6,kind:"S",rot:90},{x:4,y:6,kind:"C",rot:270},
    {x:4,y:5,kind:"S",rot:0},{x:4,y:4,kind:"S",rot:0},
    {x:5,y:3,kind:"F",rot:90},
  ]},
  { id:"05", name:"05 • Tight Technical", lapsToWin:3, tiles:[
    {x:5,y:2,kind:"C",rot:0},{x:6,y:2,kind:"S",rot:90},{x:7,y:2,kind:"C",rot:90},
    {x:7,y:3,kind:"S",rot:0},{x:7,y:4,kind:"C",rot:180},
    {x:6,y:4,kind:"S",rot:90},{x:5,y:4,kind:"C",rot:270},
    {x:5,y:3,kind:"S",rot:0},
    {x:6,y:2,kind:"F",rot:90},
  ]},
];
function getPreset(id){ return PRESETS.find(p=>p.id===id) || PRESETS[0]; }
