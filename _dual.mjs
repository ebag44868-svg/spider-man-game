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

console.log("\n===== 6. 슬링샷 (좌 + 우 + 가운데) =====");
{
  // 집라인이 우클릭 한 번이면 이동이 전부 그것만 된다. 세 버튼으로 문턱을 올렸다.
  const P = T.player;
  // 도심 한복판 상공. _input.mjs 가 집라인을 검증할 때 쓰는 자리와 같다 —
  // 여기서는 조준선에 확실히 건물이 걸린다.
  const put = () => {
    // 앞선 집라인이 아직 당기고 있으면 다음 측정이 그 힘에 오염된다.
    // 실제로 "한 틱만 물었다 뗀 건 무시한다"가 그것 때문에 실패했다.
    T.releaseWeb();
    for (let i = 0; i < 400 && T.zip; i++) T.update(DT);
    P.pos.set(0, 150, 0);
    P.prevPos.copy(P.pos); P.renderPos.copy(P.pos); P.vel.set(0, 0, 24);
    P.grounded = false;
    T.setClinging(null); T.releaseWeb();
    T.aimYaw(0.6); T.setPitch(-0.1); T.syncWorld();
    // 슬링샷은 **잡고 있는 줄을 타고** 나간다. 줄이 없으면 아무 일도 없는 게
    // 정상이므로, 이 검사에서는 먼저 줄을 걸어둔다. (예전에는 줄이 없으면
    // 집라인을 새로 쐈고, 이 테스트는 그 동작에 기대고 있었다.)
    const a = T.findSwingAnchor();
    if (a) T.attachWeb(a, T.autoHand);
  };
  T.setMouseL(false); T.setMouseR(false); T.setMid(false);
  put();
  for (let i = 0; i < 5; i++) T.update(DT);

  T.setMouseL(true); T.setMouseR(true);
  for (let i = 0; i < 30; i++) T.update(DT);
  ok(T.slingT === 0, "두 버튼만으로는 힘이 안 모인다 (가운데까지 필요하다)");

  T.setMid(true);
  const sp0 = P.vel.length();
  for (let i = 0; i < Math.ceil(T.SLING_MAX * 120) + 4; i++) T.update(DT);
  ok(T.slingT >= T.SLING_MAX - 1e-6, "세 버튼을 물면 최대까지 찬다", `${T.slingT.toFixed(2)}초`);
  const spHold = P.vel.length();
  ok(spHold < sp0, "물고 있는 동안 속도가 죽는다 (잡아 땡기는 느낌)",
     `${sp0.toFixed(1)} -> ${spHold.toFixed(1)}`);

  T.setMid(false);
  T.update(DT);
  const spGo = P.vel.length();
  ok(spGo > spHold + 10, "떼면 튀어나간다", `${spHold.toFixed(1)} -> ${spGo.toFixed(1)}`);
  T.setMouseL(false); T.setMouseR(false);

  // 살짝 스친 건 무시한다
  put();
  T.setMouseL(true); T.setMouseR(true); T.setMid(true);
  T.update(DT);
  const spB = P.vel.length();
  T.setMid(false); T.update(DT);
  ok(P.vel.length() < spB + 5, "한 틱만 물었다 뗀 건 무시한다",
     `${spB.toFixed(1)} -> ${P.vel.length().toFixed(1)}`);
  T.setMouseL(false); T.setMouseR(false);
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
