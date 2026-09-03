import { T } from "./_harness.mjs";
const DT=1/120; T.syncWorld();
const C=globalThis.__cv, W=globalThis.__win;
const md=b=>(C.mousedown||[]).forEach(f=>f({button:b,preventDefault(){}}));
const mu=b=>(W.mouseup||[]).forEach(f=>f({button:b,preventDefault(){}}));
T.setFP(true); T.aimYaw(0.3); T.setPitch(-0.15);
T.player.pos.set(120,200,-80); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
T.player.vel.set(30,0,10); T.player.grounded=false; T.setClinging(null); T.releaseWeb();
T.keys["KeyW"]=true;
let held=0, cool=0;
for(let i=0;i<120*14;i++){
  T.updateCamera(DT); T.syncWorld();
  if(cool>0) cool-=DT;
  if(!T.web){ if(T.player.vel.y<-2 && cool<=0){ md(0); cool=0.3; if(!T.web) mu(0); } }
  else { held+=DT; if(T.player.vel.y>2 && held>0.35){ mu(0); held=0; } }
  T.keys["KeyE"] = T.web && held>0.15;
  T.update(DT);
  if(i%60===0){ const p=T.player.pos, v=T.player.vel;
    console.log(`t=${(i/120).toFixed(1)}s  y=${p.y.toFixed(0)}  sp=${v.length().toFixed(1)}  web=${T.web?("len "+T.web.len.toFixed(0)):"-"}  cling=${!!T.clinging}  stam=${T.stamina!==undefined?T.stamina.toFixed(2):"?"}  hover=${T.hoverT>0}`); }
}
