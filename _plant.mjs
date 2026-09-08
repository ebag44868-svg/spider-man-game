// STEP 2 — 벽 짚기 (Wall Plant)
//
// 성공 기준은 문서 01 §10 그대로다.
//   · 벽에서 0속도로 멈추지 않는다
//   · 벽 안으로 파고들지 않는다
//   · 손이 접촉 위치와 대략 일치한다
//   · 고속에서 "비비는" 시간이 짧다
//   · 벽 접촉 후 다음 이동으로 자연스럽게 이어진다
import { T } from "./_harness.mjs";
const DT = 1 / 120;
T.syncWorld();
let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };
const V = (x, y, z) => ({ x, y, z });

// 벽 앞 14m 지점이 진짜 빈 하늘인 건물을 찾는다.
// 세워두고 한 틱 굴려서 옆으로 튕기지 않으면 빈 자리다 (튕기면 다른 건물 안이었다).
const P0 = T.player;
function tryStand(b, d) {
  const y = Math.max(b.y0 + 8, b.y0 + b.h * 0.5);
  const x = b.x + b.w / 2 + d;
  P0.pos.set(x, y, b.z);
  P0.prevPos.copy(P0.pos); P0.renderPos.copy(P0.pos);
  P0.vel.set(0, 0, 0);
  T.setClinging(null); T.releaseWeb(); T.syncWorld();
  T.update(1 / 120);
  return Math.hypot(P0.pos.x - x, P0.pos.z - b.z) < 0.3;
}
function pickSite() {
  for (const b of T.buildings) {
    if (b.h < 60 || b.w < 14 || b.d < 14) continue;
    if (tryStand(b, 14)) return { b, d: 14 };
  }
  return null;
}
function place(site, vx, vz) {
  const b = site.b;
  const y = Math.max(b.y0 + 8, b.y0 + b.h * 0.5);
  P0.pos.set(b.x + b.w / 2 + site.d, y, b.z);
  P0.prevPos.copy(P0.pos); P0.renderPos.copy(P0.pos);
  P0.vel.set(vx, 0, vz);
  T.setClinging(null); T.releaseWeb();
  T.setView(Math.PI * 1.5, 0);
  T.syncWorld();
}

console.log("===== 1. 판정 — 언제 짚는가 =====");
{
  // +x 면. 플레이어는 바깥(+x)에 있고 -x 방향으로 날아간다.
  const wall = { axis: "x", dir: 1, b: {}, bound: 100 };
  // 40m/s 로 다가가면 0.20초 예측 창 = 8m. 그 안쪽에 둔다.
  const pos = V(106, 50, 0);

  ok(!!T.plantCheck(pos, V(-40, 0, 0), wall, 1), "빠르게 다가가면 짚는다");
  ok(!T.plantCheck(pos, V(-8, 0, 0), wall, 1), "느리면 안 짚는다 (기존 벽 붙기의 몫)");
  ok(!T.plantCheck(pos, V(40, 0, 0), wall, 1), "멀어지는 중이면 안 짚는다");
  ok(!T.plantCheck(V(300, 50, 0), V(-40, 0, 0), wall, 1), "아직 멀면 안 짚는다");
  ok(!T.plantCheck(pos, V(-1, 0, 40), wall, 1), "벽과 나란히 가면 안 짚는다");
  ok(!T.plantCheck(pos, V(-40, 0, 0), null, 1), "벽이 없으면 아무 일도 없다");

  // 접촉점이 벽면 위에 있어야 한다 (bound 는 반지름이 더해진 평면이다)
  const h = T.plantCheck(pos, V(-40, 0, 0), wall, 1);
  ok(Math.abs(h.x - 99) < 1e-6, "접촉점이 벽 표면 위다", `x ${h.x}`);
  ok(h.y > pos.y, "접촉점이 발밑이 아니라 어깨쯤이다", `y ${h.y.toFixed(2)} (pos ${pos.y})`);
  ok(h.t > 0 && h.t <= T.PLANT_LOOK, "닿기까지 남은 시간이 예측 창 안이다", `t ${h.t.toFixed(3)}`);
}

console.log("\n===== 2. 속도 — 죽이지 않고 꺾는다 =====");
{
  const wall = { axis: "x", dir: 1, b: {}, bound: 100 };
  const hit = T.plantCheck(V(103, 50, 0), V(-40, 0, 30), wall, 1);
  const vel = { x: -40, y: -12, z: 30 };
  const before = Math.hypot(vel.x, vel.z);
  T.plantImpulse(vel, hit);

  ok(vel.x > 0, "벽을 향하던 성분이 되밀린다", `x ${vel.x}`);
  ok(Math.abs(vel.x - 40 * T.PLANT_BOUNCE) < 1e-6,
     "되미는 세기가 들어온 속도에 비례한다", `40 -> ${vel.x}`);
  ok(vel.z > 30 * 0.8, "벽면을 따르던 속도는 대부분 남는다", `z 30 -> ${vel.z}`);
  ok(vel.y > -12, "떨어지던 중이면 위로 세워준다", `y -12 -> ${vel.y}`);
  const after = Math.hypot(vel.x, vel.z);
  ok(after > before * 0.5, "벽에서 0속도로 멈추지 않는다", `${before.toFixed(1)} -> ${after.toFixed(1)}`);

  // 위로 솟구치던 중이면 y를 건드리지 않는다
  const up = { x: -40, y: 20, z: 0 };
  T.plantImpulse(up, hit);
  ok(up.y === 20, "위로 가던 중이면 세로 속도를 안 건드린다", `y ${up.y}`);
}

console.log("\n===== 3. 짚는 손 =====");
{
  const pos = V(0, 0, 0);
  // viewYaw 0 = +Z를 본다. 이때 오른쪽은 월드 -X다.
  ok(T.plantSide({ x: -10, z: 5 }, pos, 0) === "R", "오른쪽 벽은 오른손으로 짚는다");
  ok(T.plantSide({ x: 10, z: 5 }, pos, 0) === "L", "왼쪽 벽은 왼손으로 짚는다");
}

console.log("\n===== 4. 실제 도시에서 =====");
{
  // 도시가 빽빽해서 아무 데나 세우면 다른 건물 안이다. 빈 자리를 찾아야 한다.
  T.showMenu && T.showMenu("play");
  const site = pickSite();
  ok(!!site, "빈 하늘에서 벽으로 날아갈 자리를 찾았다");
  const b = site.b;
  const P = T.player;
  place(site, -46, 6);

  const c0 = T.plantCount;
  let minGap = Infinity, maxPen = 0;
  let planted = false, spAtPlant = 0, spAfter = 0;
  for (let i = 0; i < 90; i++) {
    T.update(DT);
    const gap = (P.pos.x - b.x) - b.w / 2;     // 벽면까지 (음수면 안으로 들어간 것)
    if (Math.abs(P.pos.y - (b.y0 + b.h)) > 2 && P.pos.y > b.y0) {
      minGap = Math.min(minGap, gap);
      if (gap < 0) maxPen = Math.max(maxPen, -gap);
    }
    if (!planted && T.plantCount > c0) {
      planted = true;
      spAtPlant = Math.hypot(P.vel.x, P.vel.z);
    } else if (planted && T.plantT <= 0 && spAfter === 0) {
      spAfter = Math.hypot(P.vel.x, P.vel.z);
    }
  }

  ok(planted, "빠르게 벽으로 가면 짚는다", `plantCount ${c0} -> ${T.plantCount}`);
  ok(maxPen < 1.0, "벽 안으로 파고들지 않는다", `최대 침투 ${maxPen.toFixed(2)}m`);
  ok(spAtPlant > 20, "짚는 순간에도 속도가 살아 있다", `${spAtPlant.toFixed(1)} m/s`);
  ok(P.pos.x > b.x + b.w / 2, "짚고 나서 벽 바깥에 있다", `x ${P.pos.x.toFixed(1)} / 벽 ${(b.x + b.w / 2).toFixed(1)}`);
  ok(T.plantCount - c0 <= 3, "쿨다운이 있어 한 벽을 무한히 되짚지 않는다", `${T.plantCount - c0}회`);
}

console.log("\n===== 5. 손이 벽을 향한다 =====");
{
  const site = pickSite();
  place(site, -46, 0);
  const c0 = T.plantCount;
  let sawWall = false;
  for (let i = 0; i < 90; i++) {
    T.update(DT);
    T.updateCamera(DT);
    if (T.plantT > 0 && T.getReach("R").kind === "wall") sawWall = true;
  }
  ok(T.plantCount > c0, "다시 짚었다");
  ok(sawWall, "짚는 동안 손의 목표가 벽 접촉점이다");
  ok(T.plantPoint.length() > 0, "접촉점이 기록된다");
}

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
