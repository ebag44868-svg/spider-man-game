import { T } from "./_harness.mjs";
const DT=1/120; T.syncWorld();
const C = globalThis.__cv, W = globalThis.__win;
const md=b=>(C.mousedown||[]).forEach(f=>f({button:b,preventDefault(){}}));
const mu=b=>(W.mouseup||[]).forEach(f=>f({button:b,preventDefault(){}}));
function place(x,y,z,vx,vz){ T.player.pos.set(x,y,z); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(vx||0,0,vz||0); T.player.grounded=false; T.setClinging(null); T.releaseWeb(); }

// 사람이 실제로 하는 조작으로 스윙: 떨어지기 시작하면 좌클릭, 올라가면 뗀다
function swingRun(fp, secs) {
  T.setFP(fp); T.aimYaw(0.3); T.setPitch(-0.15);
  place(120, 200, -80, 30, 10);
  T.keys["KeyW"] = true;          // 사람은 늘 전진 입력을 넣고 있다
  let held=0, attach=0, miss=0, maxSp=0, sum=0, ticks=0, ground=0, low=0, cool=0;
  for (let i=0;i<120*secs;i++){
    T.updateCamera(DT); T.syncWorld();
    if (cool > 0) cool -= DT;
    if (!T.web) {
      // 사람처럼: 떨어지기 시작하면 한 번 누르고, 실패해도 0.3초는 쉬었다 다시 누른다
      if (T.player.vel.y < -2 && cool <= 0) { md(0); cool = 0.3; if (T.web) attach++; else { miss++; mu(0); } }
    } else { held+=DT; if (T.player.vel.y > 2 && held > 0.35) { mu(0); held=0; } }
    T.keys["KeyE"] = T.web && held > 0.15;   // 줄이 걸리면 가속을 넣는다
    T.update(DT);
    const sp = T.player.vel.length();
    maxSp=Math.max(maxSp,sp); sum+=sp; ticks++;
    if (T.player.grounded) ground++;
    if (T.player.pos.y < 20) low++;
    if (T.player.pos.y < 3) { place(120, 200, -80, 30, 10); }
  }
  T.keys["KeyW"]=false; T.keys["KeyE"]=false;
  return { attach, miss, maxSp, avg: sum/ticks, groundPct: ground/ticks*100, lowPct: low/ticks*100 };
}

for (const fp of [true, false]) {
  const r = swingRun(fp, 45);
  console.log(`${fp?"1인칭":"3인칭"} 45초 스윙`);
  console.log(`  줄 걸림 ${r.attach}회 / 헛침 ${r.miss}회  (성공률 ${(r.attach/(r.attach+r.miss)*100||0).toFixed(0)}%)`);
  console.log(`  평균 ${r.avg.toFixed(0)} m/s  최고 ${r.maxSp.toFixed(0)} m/s  땅에 붙어있던 비율 ${r.groundPct.toFixed(1)}%  저공(20m 미만) ${r.lowPct.toFixed(1)}%`);
}

// 공격: 적을 만들고 조준해서 맞는지
console.log("\n공격 정확도");
for (const fp of [true, false]) {
  T.setFP(fp);
  place(0, 60, 0, 0, 0);
  const es = T.spawnEnemies ? null : null;
  const alive = T.enemies.filter(e=>!e.dead);
  if (!alive.length) { console.log("  적 없음 — 생략"); break; }
  // 가장 가까운 적을 향해 시점을 맞춘다
  let best=null, bd=1e9;
  for (const e of alive){ const d=Math.hypot(e.g.position.x, e.g.position.z, e.g.position.y-60); if(d<bd){bd=d;best=e;} }
  T.player.pos.set(best.g.position.x - 0, best.g.position.y + 2, best.g.position.z - 60);
  T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  const dx = best.g.position.x - T.player.pos.x, dz = best.g.position.z - T.player.pos.z, dy = best.g.position.y - (T.player.pos.y+1.4);
  T.aimYaw(Math.atan2(dx, dz)); T.setPitch(Math.atan2(dy, Math.hypot(dx,dz)));
  for(let i=0;i<6;i++) T.updateCamera(DT);
  T.syncWorld();
  const hp0 = best.hp;
  T.setAttack ? T.setAttack(true) : null;
  (W.keydown||[]).forEach(f=>f({code:"Tab",preventDefault(){}}));
  md(0); mu(0);
  for(let i=0;i<120*2;i++) T.update(DT);
  console.log(`  ${fp?"1인칭":"3인칭"} 정면 ${bd.toFixed(0)}m 적: hp ${hp0} -> ${best.hp} ${best.hp<hp0?"(명중)":"(빗나감)"}`);
  (W.keydown||[]).forEach(f=>f({code:"Tab",preventDefault(){}}));
}
