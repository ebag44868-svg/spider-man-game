import { T } from "./_harness.mjs";
const DT=1/120; T.syncWorld();
const C=globalThis.__cv, W=globalThis.__win;
const md=b=>(C.mousedown||[]).forEach(f=>f({button:b,preventDefault(){}}));
const mu=b=>(W.mouseup||[]).forEach(f=>f({button:b,preventDefault(){}}));
const key=c=>(W.keydown||[]).forEach(f=>f({code:c,preventDefault(){}}));
key("Tab");
for (const fp of [true,false]) {
  T.setFP(fp);
  const e = T.enemies.find(x=>!x.dead && !x.grip && x.bound<=0);
  e.hp=99; e.bound=0; e.grip=null; e.g.position.set(0,60,90);
  T.player.pos.set(0,59,0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0,0,0); T.player.grounded=false; T.setClinging(null); T.releaseWeb();
  T.aimYaw(0); T.setPitch(Math.atan2(60-(59+1.4), 90));
  for(let i=0;i<8;i++) T.updateCamera(DT);
  T.syncWorld();
  const cam = T.camera2;
  cam.updateMatrixWorld(true);   // 브라우저에선 render()가 매 프레임 해준다. 하네스는 스텁이라 직접.
  console.log(`\n${fp?"1인칭":"3인칭"}`);
  console.log(`  카메라 위치 (${cam.position.x.toFixed(1)}, ${cam.position.y.toFixed(1)}, ${cam.position.z.toFixed(1)})  플레이어 (0, 59, 0)  적 (0, 60, 90)`);
  const lock = T.pickEnemy ? T.pickEnemy(0.97, 400) : "미노출";
  console.log(`  pickEnemy 결과: ${lock === "미노출" ? lock : (lock ? "적 찾음" : "못 찾음")}`);
  const n0 = T.projectiles.length;
  md(0); mu(0);
  const p = T.projectiles[T.projectiles.length-1];
  if (T.projectiles.length > n0 && p) {
    const v = p.vel.clone().normalize();
    const want = { x: 0-p.pos.x, y: 60-p.pos.y, z: 90-p.pos.z };
    const wl = Math.hypot(want.x, want.y, want.z);
    const dot = (v.x*want.x + v.y*want.y + v.z*want.z)/wl;
    console.log(`  총구 (${p.pos.x.toFixed(1)}, ${p.pos.y.toFixed(1)}, ${p.pos.z.toFixed(1)})  발사각 오차 ${(Math.acos(Math.min(1,dot))*180/Math.PI).toFixed(2)}도`);
  } else console.log("  탄이 안 나감");
  for(let i=0;i<120*3;i++) T.update(DT);
  console.log(`  hp 99 -> ${e.hp}`);
}
