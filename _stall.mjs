import { T } from "./_harness.mjs";
const DT=1/120;
T.syncWorld();
function place(x,y,z,vx,vz){ T.player.pos.set(x,y,z); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(vx||0,0,vz||0); T.player.grounded=false; T.setClinging(null); T.releaseWeb(); }
function settle(){ for(let k=0;k<8;k++) T.updateCamera(DT); T.syncWorld(); }

// 사람이 하듯 스윙: 떨어지면 걸고, 올라가기 시작하면 놓는다
console.log("=== 스윙 중 급감속 사건 ===");
let stalls = [], samples = 0, totalTime = 0;
for (let run = 0; run < 24; run++) {
  const a = run * 0.83;
  place((Math.random()-0.5)*800, 130, (Math.random()-0.5)*800, Math.sin(a)*50, Math.cos(a)*50);
  T.setFP(true); T.aimYaw(a); T.setPitch(-0.1); settle();
  let held = 0;
  for (let i = 0; i < 120 * 25; i++) {
    T.updateCamera(DT);
    if (T.web) { held += DT; if (T.player.vel.y > 2 && held > 0.4) { T.releaseWeb(); held = 0; } }
    else if (T.player.vel.y < -2) { T.syncWorld(); T.tryAttachAuto(); }
    const before = T.player.vel.length();
    const bw = T.lastWall;
    T.update(DT);
    totalTime += DT; samples++;
    const after = T.player.vel.length();
    // 한 틱에 30% 넘게 잃으면 '걸렸다'로 본다
    if (before > 20 && after < before * 0.7) {
      const w = T.lastWall;
      stalls.push({ before: before|0, after: after|0,
        box: w && w.b ? { w:+w.b.w.toFixed(0), d:+w.b.d.toFixed(0), h:+w.b.h.toFixed(0), y0:+w.b.y0.toFixed(0) } : null,
        y: T.player.pos.y|0 });
    }
    if (T.player.grounded || T.player.pos.y < 4) break;
  }
}
console.log(` ${totalTime.toFixed(0)}초 스윙 중 급감속 ${stalls.length}회 (${(stalls.length/totalTime*60).toFixed(1)}회/분)`);
const dead = stalls.filter(s => s.after < 10).length;
const half = stalls.filter(s => s.after < s.before * 0.45).length;
console.log(` 그중 사실상 정지(10m/s 미만): ${dead}회 / 절반 이하로 떨어짐: ${half}회`);
// 어떤 박스에 걸렸나 — 작은 돌출물인지 큰 건물인지
const small = stalls.filter(s => s.box && Math.min(s.box.w, s.box.d) < 20).length;
const big = stalls.filter(s => s.box && Math.min(s.box.w, s.box.d) >= 20).length;
console.log(` 작은 돌출물(한 변 20m 미만)에 걸림: ${small}회 / 큰 건물: ${big}회`);
console.log(" 사실상 정지 목록:");
for (const s of stalls.filter(s=>s.after<10).slice(0,10)) {
  console.log(`   ${s.before}->${s.after} m/s @ y=${s.y}  박스 ${s.box ? s.box.w+"x"+s.box.d+"x"+s.box.h+" (y0="+s.box.y0+")" : "?"}`);
}
