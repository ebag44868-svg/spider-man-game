// STEP 3 — 웹으로 건물 타기 (Web-assisted Vertical Traversal)
//
// 문서 01 §11. 화면에서 이 순서가 반복되어야 한다:
//   쏨 → 잡음 → 끌림 → (벽에 가까워지면) 짚음 → 밀어냄 → 다시 쏨
//
// 여기서 재는 것:
//   · 벽 옆 공중에서 버튼을 누르면 위쪽에 줄을 건다
//   · 한 번이 아니라 반복해서 건다 (한 번에 다 올라가면 '타는' 게 아니다)
//   · 실제로 고도가 오른다
//   · 옥상에 올라서면 멈춘다
//   · 손이 닿는 거리에서는 기존 '벽 붙기'에 양보한다
import { T } from "./_harness.mjs";
const DT = 1 / 120;
T.syncWorld();
let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };

console.log("===== 1. 어디에 거는가 =====");
{
  // +x 면. 건물은 높이 200, 플레이어는 y=50 에 있다.
  const wall = { axis: "x", dir: 1, b: { y0: 0, h: 200 }, bound: 100 };
  const pos = { x: 104, y: 50, z: 7 };
  const a = T.vclimbAnchor(pos, wall, 1);
  ok(!!a, "탈 자리를 찾는다");
  ok(a.y > pos.y, "지금보다 위에 건다", `y ${pos.y} -> ${a.y}`);
  ok(Math.abs(a.y - (pos.y + T.VC_STEP)) < 1e-6, "한 번에 오르는 높이만큼 위다", `${a.y}`);
  ok(a.x > 99, "벽 표면보다 바깥에 건다 (벽면에 걸면 처박힌다)", `x ${a.x}`);
  ok(Math.abs(a.x - (99 + T.VC_OUT)) < 1e-6, "정확히 VC_OUT 만큼 띄운다", `${a.x}`);
  ok(a.z === pos.z, "옆으로는 안 흐른다 (같은 자리에서 수직으로 오른다)");

  // 지붕 근처에서는 지붕을 살짝 넘겨 잡아야 올라선다
  const near = T.vclimbAnchor({ x: 104, y: 190, z: 0 }, wall, 1);
  ok(Math.abs(near.y - (200 + T.VC_TOP)) < 1e-6, "지붕 근처면 지붕을 살짝 넘겨 잡는다", `${near.y}`);

  ok(!T.vclimbAnchor({ x: 104, y: 205, z: 0 }, wall, 1), "이미 옥상이면 더 안 탄다");
  ok(!T.vclimbAnchor(pos, null, 1), "벽이 없으면 아무 일도 없다");
}

console.log("\n===== 2. 언제 다시 쏘는가 =====");
{
  const pos = { x: 0, y: 0, z: 0 };
  ok(T.vclimbShouldFire(pos, true, null, 0), "걸린 게 없으면 바로 쏜다");
  ok(!T.vclimbShouldFire(pos, false, null, 0), "누르지 않으면 안 쏜다");
  ok(!T.vclimbShouldFire(pos, true, null, 0.2), "쿨다운 중에는 안 쏜다");
  ok(!T.vclimbShouldFire(pos, true, { x: 0, y: 40, z: 0 }, 0), "멀리 걸려 있으면 그대로 끌려간다");
  ok(T.vclimbShouldFire(pos, true, { x: 0, y: 4, z: 0 }, 0), "다 왔으면 다음 자리로 옮겨 잡는다");
}

console.log("\n===== 3. 실제로 건물을 타는가 =====");
{
  // 도시가 빽빽해서 빈 자리를 찾아야 한다.
  T.showMenu && T.showMenu("play");
  const P = T.player;
  function tryStand(b, d) {
    const y = b.y0 + 12;
    const x = b.x + b.w / 2 + d;
    P.pos.set(x, y, b.z);
    P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
    P.vel.set(0, 0, 0);
    T.setClinging(null); T.releaseWeb(); T.setClimb(false); T.syncWorld();
    T.update(DT);
    return Math.hypot(P.pos.x - x, P.pos.z - b.z) < 0.3;
  }
  let site = null;
  for (const b of T.buildings) {
    if (b.h < 120 || b.w < 14 || b.d < 14) continue;   // 여러 번 타야 할 만큼 높은 건물
    if (tryStand(b, 5)) { site = b; break; }
  }
  ok(!!site, "충분히 높은 건물 옆 빈 자리를 찾았다", site ? `h ${site.h.toFixed(0)}m` : "");

  const y0 = site.y0 + 12;
  P.pos.set(site.x + site.w / 2 + 5, y0, site.z);
  P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.vel.set(0, 0, 0);
  T.setClinging(null); T.releaseWeb();
  T.syncWorld();

  const c0 = T.vcCount;
  T.setClimb(true);                    // 벽타기 버튼을 누른 채로 둔다
  let topY = y0;
  for (let i = 0; i < 900; i++) {      // 7.5초
    T.update(DT);
    topY = Math.max(topY, P.pos.y);
  }
  T.setClimb(false);

  const shots = T.vcCount - c0;
  const roof = site.y0 + site.h;
  ok(shots >= 2, "한 번에 다 올라가지 않고 여러 번 걸어 탄다", `${shots}번`);
  ok(topY > y0 + 40, "실제로 고도가 오른다", `${y0.toFixed(0)}m -> ${topY.toFixed(0)}m`);
  ok(topY > roof - 20, "옥상 가까이까지 오른다", `${topY.toFixed(0)}m / 옥상 ${roof.toFixed(0)}m`);

  // 옥상에 올라선 뒤에는 더 쏘지 않는다
  P.pos.set(site.x, roof + 3, site.z);
  P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.vel.set(0, 0, 0);
  T.releaseWeb(); T.syncWorld();
  const c1 = T.vcCount;
  T.setClimb(true);
  for (let i = 0; i < 240; i++) T.update(DT);
  T.setClimb(false);
  ok(T.vcCount === c1, "옥상에 올라서면 그만 탄다", `${T.vcCount - c1}번 더 쐈다`);
}

console.log("\n===== 4. 벽 붙기와 안 싸운다 =====");
{
  // 손이 닿는 거리(2.6m)에서는 줄을 쏘지 않고 기존 '벽 붙기'에 양보한다.
  const P = T.player;
  const b = T.buildings.find(x => x.h > 120 && x.w > 14 && x.d > 14);
  P.pos.set(b.x + b.w / 2 + 1.5, b.y0 + 20, b.z);
  P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.vel.set(0, 0, 0);
  T.setClinging(null); T.releaseWeb(); T.syncWorld();
  const c0 = T.vcCount;
  T.setClimb(true);
  for (let i = 0; i < 60; i++) T.update(DT);
  T.setClimb(false);
  ok(T.vcCount === c0, "손이 닿는 거리에서는 줄을 안 쏜다 (벽 붙기의 몫)", `${T.vcCount - c0}번 쐈다`);
}

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
