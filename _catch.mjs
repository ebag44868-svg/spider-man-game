import { T } from "./_harness.mjs";
const DT=1/120;
T.syncWorld();
function place(x,y,z,vx,vz){ T.player.pos.set(x,y,z); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(vx||0,0,vz||0); T.player.grounded=false; T.setClinging(null); T.releaseWeb(); }
function settle(){ for(let k=0;k<8;k++) T.updateCamera(DT); T.syncWorld(); }
let caught = 0;
for (let run = 0; run < 6 && caught < 3; run++) {
  const a = run * Math.PI / 3;
  place((Math.random()-0.5)*800, 130, (Math.random()-0.5)*800, Math.sin(a)*50, Math.cos(a)*50);
  T.setFP(true); T.aimYaw(a); T.setPitch(-0.1); settle();
  let held = 0;
  for (let i = 0; i < 120*25 && caught < 3; i++) {
    T.updateCamera(DT);
    let justAttached = false;
    if (T.web) { held += DT; if (T.player.vel.y > 2 && held > 0.4) { T.releaseWeb(); held = 0; } }
    else if (T.player.vel.y < -2) { T.syncWorld(); justAttached = T.tryAttachAuto(); }
    const b4 = { sp: T.player.vel.length(), web: !!T.web, cling: !!T.clinging, zip: !!T.zip, lunge: !!T.lunge };
    T.update(DT);
    const after = T.player.vel.length();
    if (b4.sp > 20 && after < b4.sp * 0.3) {
      caught++;
      console.log(`#${caught} ${b4.sp.toFixed(0)} -> ${after.toFixed(0)} m/s`);
      console.log(`   직전: web=${b4.web} cling=${b4.cling} zip=${b4.zip} lunge=${b4.lunge} 방금부착=${justAttached}`);
      console.log(`   직후: web=${!!T.web} cling=${!!T.clinging} grounded=${T.player.grounded} y=${T.player.pos.y.toFixed(0)}`);
      if (T.web) console.log(`   로프 길이 ${T.web.len.toFixed(0)}m, 앵커까지 ${T.player.pos.distanceTo(T.web.a).toFixed(0)}m, grip t=${T.web.t.toFixed(2)}`);
    }
    if (T.player.grounded || T.player.pos.y < 4) break;
  }
}
