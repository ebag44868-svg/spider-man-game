import { T } from "./_harness.mjs";
const DT = 1/120;
T.syncWorld();
let pass = 0, fail = 0;
const ok = (c, m, extra="") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + extra); } };
function place(x,y,z){ T.player.pos.set(x,y,z); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0,0,0); T.player.grounded=false; T.setClinging(null); T.releaseWeb(); }
function run(n){ for(let i=0;i<n;i++){ T.updateCamera(DT); T.update(DT); } }

// 1) 벽을 뚫고 지나가지 않는다
console.log("1. 벽 관통");
{
  const b = T.buildings.find(b => b.w > 40 && b.d > 40 && b.h > 60);
  place(b.x - b.w/2 - 40, b.y0 + 30, b.z);
  T.player.vel.set(120, 0, 0);
  let inside = false;
  for (let i=0;i<120*2;i++){ T.update(DT);
    const p = T.player.pos;
    if (Math.abs(p.x-b.x) < b.w/2-1 && Math.abs(p.z-b.z) < b.d/2-1 && p.y > b.y0+1 && p.y < b.y0+b.h-1) inside = true; }
  ok(!inside, "120m/s로 박아도 건물 안으로 들어가지 않는다");
}

// 2) 벽타기
console.log("2. 벽타기");
{
  const b = T.buildings.find(b => b.w > 40 && b.h > 80);
  place(b.x - b.w/2 - 1.2, b.y0 + 20, b.z);
  T.player.vel.set(-4, 0, 0);        // 벽 쪽으로 살살
  T.keys["ControlLeft"] = true;
  run(30);
  const clung = !!T.clinging;
  const y0 = T.player.pos.y;
  T.keys["KeyW"] = true; run(120); T.keys["KeyW"] = false;
  ok(clung, "천천히 벽에 닿으면 붙는다");
  ok(T.player.pos.y > y0 + 3, "붙은 채로 W를 누르면 올라간다", `y ${y0.toFixed(1)} -> ${T.player.pos.y.toFixed(1)}`);
  T.keys["ControlLeft"] = false;
}

// 3) 빠르게 스치면 붙지 않고 흘러간다
console.log("3. 고속 스침");
{
  const b = T.buildings.find(b => b.w > 40 && b.h > 100);
  place(b.x - b.w/2 - 30, b.y0 + 60, b.z);
  T.player.vel.set(60, 0, 0);
  run(60);
  ok(!T.clinging, "60m/s로 벽에 박아도 자동으로 붙어 멈추지 않는다");
  ok(T.player.vel.length() > 20, "속도가 남아 흘러간다", `${T.player.vel.length().toFixed(0)} m/s`);
}

// 4) 착지
console.log("4. 착지");
{
  const b = T.buildings.find(b => b.w > 40 && b.h > 60);
  place(b.x, b.y0 + b.h + 40, b.z);
  run(240);
  ok(T.player.grounded, "옥상에 착지한다");
  ok(Math.abs(T.player.pos.y - (b.y0+b.h)) < 3, "옥상 높이에 선다", `y=${T.player.pos.y.toFixed(1)} 옥상=${(b.y0+b.h).toFixed(1)}`);
  ok(!T.clinging, "착지하면 매달림이 풀린다");
}

// 5) 벽점프
console.log("5. 벽점프");
{
  // -x쪽에 이웃 건물이 없는 벽을 고른다. 틈새에 끼면 점프해도 나갈 데가 없다.
  const b = T.buildings.find(b => b.w > 40 && b.h > 80 &&
    !T.buildings.some(o => o !== b && Math.abs(o.z - b.z) < 40 &&
      o.x + o.w/2 > b.x - b.w/2 - 25 && o.x + o.w/2 < b.x - b.w/2));
  place(b.x - b.w/2 - 1.2, b.y0 + 30, b.z);
  T.player.vel.set(-4,0,0); T.keys["ControlLeft"] = true; run(90);
  const was = !!T.clinging;
  T.wallJump(); run(20);
  ok(was && !T.clinging, "벽점프하면 벽에서 떨어진다");
  ok(T.player.vel.length() > 8, "벽점프에 속도가 실린다", `${T.player.vel.length().toFixed(0)} m/s`);
  T.keys["ControlLeft"] = false;
}

// 6) 스윙이 실제로 성립한다
console.log("6. 웹스윙");
{
  place(0, 200, 0); T.player.vel.set(35,0,0);
  T.setFP(true); T.aimYaw(0); T.setPitch(-0.1);
  let attached = 0, maxSp = 0, held = 0;
  for (let i=0;i<120*20;i++){
    T.updateCamera(DT);
    if (T.web) { held += DT; if (T.player.vel.y > 2 && held > 0.4) { T.releaseWeb(); held = 0; } }
    else if (T.player.vel.y < -2) { T.syncWorld(); if (T.tryAttachAuto()) attached++; }
    T.keys["KeyE"] = true;
    T.update(DT);
    maxSp = Math.max(maxSp, T.player.vel.length());
    if (T.player.pos.y < 5) break;
  }
  T.keys["KeyE"] = false;
  ok(attached >= 3, "20초 동안 여러 번 줄이 걸린다", `${attached}회`);
  ok(maxSp > 55, "스윙으로 속도가 붙는다", `최고 ${maxSp.toFixed(0)} m/s`);
}

// 7) 장시간 무사고
console.log("7. 장시간 구동");
{
  place(0, 260, 0); T.player.vel.set(40,0,20);
  let err = null, held = 0;
  try {
    for (let i=0;i<120*60;i++){
      T.updateCamera(DT);
      if (T.web) { held += DT; if (T.player.vel.y > 2 && held > 0.4) { T.releaseWeb(); held = 0; } }
      else if (T.player.vel.y < -2) { T.syncWorld(); T.tryAttachAuto(); }
      if (i % 600 === 300) T.dash?.();
      T.update(DT);
      const p = T.player.pos;
      if (!Number.isFinite(p.x+p.y+p.z) || !Number.isFinite(T.player.vel.length())) { err = "NaN @ tick "+i; break; }
      if (p.y < -50) { err = "바닥 관통 @ tick "+i; break; }
    }
  } catch(e) { err = e.message; }
  ok(!err, "60초 스윙 동안 예외/NaN/관통 없음", err||"");
}

console.log(`\n통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
