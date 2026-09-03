import { T } from "./_harness.mjs";
const DT=1/120; T.syncWorld();
const C=globalThis.__cv, W=globalThis.__win;
const md=b=>(C.mousedown||[]).forEach(f=>f({button:b,preventDefault(){}}));
const mu=b=>(W.mouseup||[]).forEach(f=>f({button:b,preventDefault(){}}));
const key=c=>(W.keydown||[]).forEach(f=>f({code:c,preventDefault(){}}));
key("Tab");   // 공격 모드
for (const dist of [40, 90, 150]) {
  for (const fp of [true,false]) {
    T.setFP(fp);
    // 깨끗한 적 하나를 원하는 거리에 놓는다
    const e = T.enemies.find(e=>!e.dead && !e.grip && e.bound<=0);
    if(!e){ console.log("적 없음"); break; }
    e.hp = 99; e.bound = 0; e.grip = null;
    e.g.position.set(0, 60, dist);
    T.player.pos.set(0, 59, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
    T.player.vel.set(0,0,0); T.player.grounded=false; T.setClinging(null); T.releaseWeb();
    T.aimYaw(0); T.setPitch(Math.atan2(e.g.position.y-(T.player.pos.y+1.4), dist));
    for(let i=0;i<8;i++) T.updateCamera(DT);
    T.syncWorld();
    const hp0=e.hp;
    md(0); mu(0);
    for(let i=0;i<120*3;i++) T.update(DT);
    console.log(`${fp?"1인칭":"3인칭"} ${dist}m 정면: hp ${hp0} -> ${e.hp}  ${e.hp<hp0?"명중":"빗나감"}  (묶임 ${e.bound>0?"O":"X"})`);
  }
}
