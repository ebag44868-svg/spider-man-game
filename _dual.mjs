// STEP 4 — 양손 웹 (좌/우 분리 + 보조 웹)
//
// 문서 01 §7. 두 로프를 동시에 구속하지 않는다.
//   주 웹  = 실제 스윙 constraint
//   보조 웹 = 구속 없이 방향만 당기는 힘
// 화면에서는 양손이 각각 다른 곳을 잡고 있는 것으로 보인다.
import { T } from "./_harness.mjs";
const DT = 1 / 120;
T.syncWorld();
let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };
// tryAttach() 는 인자를 안 받는다 — 조준선으로 앵커를 스스로 고른다.
// 원하는 자리에 걸려면 attachWeb(point) 를 직접 불러야 한다.
// 처음에 tryAttach 에 좌표를 넘겼다가 "왼쪽에 걸었는데 오른손"이 나왔다.
const A = (x, y, z) => T.player.pos.clone().set(x, y, z);

console.log("===== 1. 손 고르기 =====");
{
  const P = T.player;
  P.pos.set(0, 50, 0);
  T.aimYaw(0);                       // +Z 를 본다 → 오른쪽은 월드 -X
  ok(T.sideOf({ x: -20, y: 60, z: 20 }) === "R", "오른쪽 앵커는 오른손");
  ok(T.sideOf({ x: 20, y: 60, z: 20 }) === "L", "왼쪽 앵커는 왼손");
  ok(T.otherSide("R") === "L" && T.otherSide("L") === "R", "반대 손을 안다");

  T.aimYaw(Math.PI);                 // 반대로 돌면 좌우가 뒤집힌다
  ok(T.sideOf({ x: -20, y: 60, z: -20 }) === "L", "몸을 돌리면 같은 앵커가 반대 손이 된다");
  T.aimYaw(0);
}

console.log("\n===== 2. 주 웹이 손을 기억한다 =====");
{
  const P = T.player;
  // 빈 하늘을 찾아 세운다
  let site = null;
  for (const b of T.buildings) {
    if (b.h < 90 || b.w < 14) continue;
    const x = b.x + b.w / 2 + 20, y = b.y0 + 40;
    P.pos.set(x, y, b.z); P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
    P.vel.set(0, 0, 0); T.setClinging(null); T.releaseWeb(); T.syncWorld();
    T.update(DT);
    if (Math.hypot(P.pos.x - x, P.pos.z - b.z) < 0.3) { site = { b, x, y }; break; }
  }
  ok(!!site, "빈 하늘을 찾았다");

  // 오른쪽(월드 -X)에 걸어본다
  P.pos.set(site.x, site.y, site.b.z);
  P.prevPos.copy(P.pos); P.renderPos.copy(P.pos); P.vel.set(0, 0, 0);
  T.releaseWeb(); T.aimYaw(0); T.syncWorld();
  T.attachWeb(A(site.x - 30, site.y + 30, site.b.z + 30));
  ok(!!T.web, "줄이 걸렸다");
  ok(T.web.side === "R", "오른쪽에 건 줄은 오른손이 잡는다", `side ${T.web && T.web.side}`);

  T.releaseWeb();
  T.attachWeb(A(site.x + 30, site.y + 30, site.b.z + 30));
  ok(T.web.side === "L", "왼쪽에 건 줄은 왼손이 잡는다", `side ${T.web && T.web.side}`);
  T.releaseWeb();
  ok(!T.web, "놓으면 사라진다");
}

console.log("\n===== 3. 보조 웹 =====");
{
  const P = T.player;
  const b = T.buildings.find(x => x.h > 90 && x.w > 14);
  const x0 = b.x + b.w / 2 + 20, y0 = b.y0 + 40;
  P.pos.set(x0, y0, b.z); P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.vel.set(0, 0, 0);
  T.setClinging(null); T.releaseWeb(); T.aimYaw(0); T.setPitch(0); T.syncWorld();

  ok(!T.web2, "처음엔 보조 웹이 없다");
  // 보조 웹은 주 웹이 있을 때만 붙는다 (혼자 쓰면 그냥 견인이 된다)
  T.setWeb2Held(true);
  for (let i = 0; i < 30; i++) T.update(DT);
  ok(!T.web2, "주 웹 없이는 보조 웹이 안 붙는다");
  T.setWeb2Held(false);

  // 주 웹을 걸고 다시
  P.pos.set(x0, y0, b.z); P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.vel.set(0, 0, 0); T.syncWorld();
  T.attachWeb(A(x0 - 30, y0 + 30, b.z + 30));
  const c0 = T.web2Count;
  T.setWeb2Held(true);
  for (let i = 0; i < 60; i++) T.update(DT);
  const got = !!T.web2;
  ok(T.web2Count > c0 && got, "주 웹이 있으면 보조 웹이 붙는다", `${T.web2Count - c0}회 / web2 ${got}`);

  if (got) {
    ok(T.web.side !== undefined, "주 웹에 손이 배정돼 있다");
    // 보조 웹은 구속이 아니라 힘이다 — 거리가 고정되지 않는다
    const d0 = Math.hypot(T.web2.a.x - P.pos.x, T.web2.a.y - P.pos.y, T.web2.a.z - P.pos.z);
    for (let i = 0; i < 60; i++) T.update(DT);
    const d1 = T.web2 ? Math.hypot(T.web2.a.x - P.pos.x, T.web2.a.y - P.pos.y, T.web2.a.z - P.pos.z) : 0;
    ok(!T.web2 || Math.abs(d1 - d0) > 0.01, "보조 웹은 거리를 고정하지 않는다 (구속이 아니라 힘)",
       `${d0.toFixed(1)} -> ${d1.toFixed(1)}`);
  }
  T.setWeb2Held(false);
  for (let i = 0; i < 5; i++) T.update(DT);
  ok(!T.web2, "버튼을 떼면 보조 웹이 사라진다");

  T.releaseWeb();
  ok(!T.web2, "주 웹을 놓으면 보조도 같이 놓는다");
}

console.log("\n===== 4. 두 줄이 서로를 흔들지 않는다 =====");
{
  // 과구속이면 속도가 발산하거나 NaN이 된다. 그게 문서 01 §7이 경고한 것이다.
  const P = T.player;
  const b = T.buildings.find(x => x.h > 90 && x.w > 14);
  const x0 = b.x + b.w / 2 + 20, y0 = b.y0 + 40;
  P.pos.set(x0, y0, b.z); P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.vel.set(0, 0, 30);
  T.setClinging(null); T.releaseWeb(); T.aimYaw(0); T.syncWorld();
  T.attachWeb(A(x0 - 30, y0 + 35, b.z + 30));
  T.setWeb2Held(true);
  let maxSp = 0, bad = false;
  for (let i = 0; i < 600; i++) {
    T.update(DT);
    const sp = P.vel.length();
    if (!isFinite(sp) || !isFinite(P.pos.x)) { bad = true; break; }
    maxSp = Math.max(maxSp, sp);
  }
  T.setWeb2Held(false);
  ok(!bad, "5초 동안 값이 터지지 않는다 (NaN/무한대 없음)");
  ok(maxSp < 200, "속도가 발산하지 않는다", `최대 ${maxSp.toFixed(1)} m/s`);
  T.releaseWeb();
}

console.log("\n===== 5. 왼손에도 구동이 생겼다 =====");
{
  // STEP 1~3 에서 왼팔은 주먹 지를 때 말고는 늘 숨어 있었다.
  T.setOpt && T.setOpt("view", true);          // 1인칭
  T.clearReach("R"); T.clearReach("L");
  for (let i = 0; i < 90; i++) T.updateReach(DT);
  ok(T.getReach("L").on < 0.02, "잡은 게 없으면 왼손은 쉰다");

  T.setReach("L", { x: 10, y: 5, z: -10 }, "web");
  for (let i = 0; i < 40; i++) T.updateReach(DT);
  ok(T.getReach("L").on > 0.9, "왼손도 목표를 잡는다");
  ok(Math.abs(T.getReach("L").yaw) > 0.3, "왼손이 목표 쪽을 본다", `yaw ${T.getReach("L").yaw.toFixed(2)}`);

  // 좌우가 서로를 안 건드린다
  T.setReach("R", { x: -10, y: 5, z: -10 }, "web");
  for (let i = 0; i < 40; i++) T.updateReach(DT);
  ok(T.getReach("R").yaw < 0 && T.getReach("L").yaw > 0,
     "양손이 서로 반대쪽을 잡는다",
     `R ${T.getReach("R").yaw.toFixed(2)} / L ${T.getReach("L").yaw.toFixed(2)}`);
  T.clearReach("R"); T.clearReach("L");
  for (let i = 0; i < 150; i++) T.updateReach(DT);
}

console.log("\n===== 6. 양손 새총 — 지상 (S로 힘을 모은다) =====");
{
  const P = T.player;
  const V = P.pos.constructor;
  // 옥상에 서서 두 줄을 건다. 앵커는 직접 준다 — 지형 운에 시험이 좌우되면 안 된다.
  const b = T.buildings.find(o => o.y0 === 0 && o.h > 60 && o.w > 30 && o.d > 30);
  const setup = (grounded) => {
    T.setMouseL(false); T.setMouseR(false); T.setKey("KeyS", false);
    T.setWeb2Held(false); T.releaseWeb(); T.releaseWeb2(); T.setClinging(null);
    for (let i = 0; i < 3; i++) T.update(DT);
    if (grounded) P.pos.set(b.x, b.h, b.z);
    else P.pos.set(b.x, b.h + 120, b.z);
    P.prevPos.copy(P.pos); P.renderPos.copy(P.pos); P.vel.set(0, 0, 0);
    P.grounded = grounded;
    T.syncWorld();
    T.attachWeb(new V(P.pos.x + 34, P.pos.y + 46, P.pos.z + 12), "R");
    T.attachWeb2(new V(P.pos.x - 30, P.pos.y + 44, P.pos.z + 16));
    T.setWeb2Held(true);
    T.setMouseL(true); T.setMouseR(true);
    return !!(T.web && T.web2);
  };

  ok(setup(true), "두 줄이 걸린다");
  for (let i = 0; i < 60; i++) T.update(DT);
  ok(T.slingK === 0, "땅에서는 두 버튼만으로 안 모인다 (S가 있어야 한다)", `${T.slingK}`);

  const p0 = P.pos.clone();
  T.setKey("KeyS", true);
  for (let i = 0; i < Math.ceil(T.SLING_CHARGE_T * 120) + 6; i++) T.update(DT);
  ok(T.slingK >= 1 - 1e-6, "S를 물면 최대까지 찬다", `${T.slingK.toFixed(2)}`);
  ok(P.pos.distanceTo(p0) < 2, "몸은 아주 살짝만 움직인다", `${P.pos.distanceTo(p0).toFixed(2)}m`);

  const dir = new V();
  T.slingDir(dir);
  const n0 = T.slingCount;
  T.setMouseL(false);
  T.update(DT);
  ok(!!T.web && !!T.web2 && T.slingCount === n0, "한 손만 놓으면 아직 안 나간다");
  T.setMouseR(false);
  T.update(DT);
  const v = P.vel.clone();
  ok(T.slingCount === n0 + 1, "두 버튼을 다 놓으면 발사된다");
  ok(v.length() > T.SLING_V_MAX - 6, "최대 충전이면 가장 빠르게 나간다", `${v.length().toFixed(0)} m/s`);
  ok(v.clone().normalize().dot(dir) > 0.9, "두 줄이 당기는 쪽으로 간다",
     `dot ${v.clone().normalize().dot(dir).toFixed(2)}`);
  ok(!T.web && !T.web2, "발사하면 두 줄 다 끊긴다");
  T.setKey("KeyS", false);

  // 살짝 물었다 뗀 건 발사가 아니다
  if (setup(true)) {
    T.setKey("KeyS", true);
    T.update(DT);
    T.setKey("KeyS", false);
    const spB = P.vel.length(), n1 = T.slingCount;
    T.setMouseL(false); T.setMouseR(false);
    for (let i = 0; i < 4; i++) T.update(DT);
    ok(T.slingCount === n1, "한 틱만 물었다 뗀 건 발사가 아니다");
    ok(P.vel.length() < spB + 8, "속도도 안 튄다", `${spB.toFixed(1)} -> ${P.vel.length().toFixed(1)}`);
  } else ok(false, "두 번째 시험 준비");

  console.log("\n===== 6b. 양손 새총 — 공중 (S 없이 쭉 끌렸다가 저절로) =====");
  ok(setup(false), "공중에서도 두 줄이 걸린다");
  const a0 = P.pos.clone();
  const dirA = new V();
  T.slingDir(dirA);
  const n2 = T.slingCount;
  T.update(DT); T.update(DT);
  ok(T.slingAir, "두 줄을 물면 S 없이 바로 끌리기 시작한다");
  let fired = 0;
  for (let i = 0; i < 120 && !fired; i++) { T.update(DT); if (T.slingCount > n2) fired = i + 1; }
  ok(fired > 0, "손을 안 떼도 저절로 발사된다", `${(fired / 120).toFixed(2)}초`);
  const drawn = a0.distanceTo(P.pos);
  ok(drawn > T.SLING_AIR_DRAW * 0.6, "그 전에 몸이 뒤로 끌려간다", `${drawn.toFixed(1)}m`);
  const vA = P.vel.clone();
  ok(vA.length() > T.SLING_V_MAX - 8, "끝까지 끌렸으니 최대로 나간다", `${vA.length().toFixed(0)} m/s`);
  ok(vA.clone().normalize().dot(dirA) > 0.85, "두 줄이 당기는 쪽으로 간다",
     `dot ${vA.clone().normalize().dot(dirA).toFixed(2)}`);
  ok(!T.web && !T.web2 && !T.slingAir, "발사하면 줄이 끊기고 상태가 풀린다");

  // 중간에 손을 떼면 끌린 만큼만
  if (setup(false)) {
    const n3 = T.slingCount;
    for (let i = 0; i < 12; i++) T.update(DT);       // 0.1초만 끌린다
    T.setMouseL(false); T.setMouseR(false);
    T.update(DT);
    ok(T.slingCount === n3 + 1, "중간에 떼도 나간다");
    ok(P.vel.length() < T.SLING_V_MAX - 15, "덜 끌렸으면 약하게 나간다", `${P.vel.length().toFixed(0)} m/s`);
  } else ok(false, "세 번째 시험 준비");
  T.setWeb2Held(false); T.releaseWeb(); T.releaseWeb2();

  console.log("\n===== 6c. 좌우 동시 클릭 = 두 줄 자동 =====");
  {
    const C = globalThis.__cv, W = globalThis.__win;
    const down = btn => (C.mousedown || []).forEach(f => f({ button: btn, preventDefault() {} }));
    const up = btn => (W.mouseup || []).forEach(f => f({ button: btn, preventDefault() {} }));
    up(0); up(2);
    T.setMouseL(false); T.setMouseR(false); T.setWeb2Held(false);
    T.releaseWeb(); T.releaseWeb2();
    // 도심 상공에서 아래를 보며 좌우를 같이 누른다
    P.pos.set(0, 220, 0); P.prevPos.copy(P.pos); P.renderPos.copy(P.pos); P.vel.set(0, 0, 26);
    P.grounded = false;
    T.setFP(true); T.aimYaw(0.6); T.setPitch(-0.05); T.syncWorld();
    for (let i = 0; i < 3; i++) T.updateCamera(DT);
    down(0);
    down(2);
    ok(!!T.web && !!T.web2, "좌우를 같이 누르면 두 줄이 한 번에 걸린다",
       `web ${!!T.web} web2 ${!!T.web2}`);
    if (T.web && T.web2) {
      const gap = T.web.a.distanceTo(T.web2.a);
      ok(gap >= T.DUAL_SPREAD, "두 앵커가 충분히 벌어져 있다", `${gap.toFixed(0)}m`);
      // 내가 부채꼴의 중심이어야 한다 — 두 줄이 시선 축의 좌우로 하나씩, 비슷한 각도로
      const fx = Math.sin(T.viewYaw), fz = Math.cos(T.viewYaw);
      const side = a => {
        const dx = a.x - P.pos.x, dz = a.z - P.pos.z;
        return { cross: fx * dz - fz * dx, ang: Math.abs(Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz)) * 180 / Math.PI };
      };
      const sR = side(T.web.a), sL = side(T.web2.a);
      ok(sR.cross * sL.cross < 0, "두 줄이 시선의 좌우로 하나씩 걸린다",
         `${sR.cross.toFixed(0)} / ${sL.cross.toFixed(0)}`);
      // 부채꼴의 축(두 줄의 이등분선)이 시선에서 크게 안 벗어나고, 적당히 벌어져 있어야 한다.
      // 축을 시선에 딱 고정하면 한쪽에 걸 건물이 없을 때 아예 못 건다 — 축이 좀 도는 건 허용한다.
      const bias = Math.abs(sR.ang - sL.ang) / 2, open = (sR.ang + sL.ang) / 2;
      ok(bias < 25, "부채꼴의 축이 보는 쪽에서 크게 안 벗어난다", `${bias.toFixed(0)}도`);
      ok(open > 18 && open < 80, "좌우로 적당히 벌어진다", `한쪽 ${open.toFixed(0)}도`);
      const dR = P.pos.distanceTo(T.web.a), dL = P.pos.distanceTo(T.web2.a);
      ok(Math.abs(dR - dL) < Math.max(dR, dL) * 0.65, "줄 길이도 크게 안 차이 난다",
         `${dR.toFixed(0)}m / ${dL.toFixed(0)}m`);
      for (let i = 0; i < 4; i++) T.update(DT);
      ok(T.slingAir, "그 상태로 바로 공중 새총이 시작된다");
    }
    up(0); up(2);
    T.setMouseL(false); T.setMouseR(false); T.setWeb2Held(false);
    T.releaseWeb(); T.releaseWeb2();
  }
}

console.log("\n===== 7. 미니맵 좌표 =====");
{
  const S = 176;
  const c = T.mmPt(0, 0, S);
  ok(Math.abs(c[0] - S / 2) < 0.01 && Math.abs(c[1] - S / 2) < 0.01, "원점은 한가운데다");
  const r = T.mmPt(T.MM_R, 0, S);
  ok(r[0] > S / 2 + 60, "+X 는 오른쪽으로 간다", `${r[0].toFixed(0)}`);
  const up = T.mmPt(0, -T.MM_R, S);
  ok(up[1] < S / 2 - 60, "-Z(북쪽)는 위로 간다", `${up[1].toFixed(0)}`);
  ok(r[0] <= S && up[1] >= 0, "가장자리 여백 안에 들어온다");
}

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
