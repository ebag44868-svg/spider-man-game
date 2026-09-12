// 1인칭 몸 — 무릎 관절 · 관성 쏠림 · 롤 설정
//
// "날아가는 사람의 시야"가 되려면 몸이 관성에 반응해야 한다. 그게 보이는지를
// 잰다. 스프링을 쓴 이유가 오버슈트(=쏠림)라서, 그 오버슈트를 직접 확인한다.
import { T } from "./_harness.mjs";
const DT = 1 / 120;
T.syncWorld();
let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };
const P = T.player;

// 1인칭으로 두고 몸을 만들어 둔다 (몸은 첫 프레임에 만들어진다 — 난수 제약)
T.setFP(true);
P.pos.set(0, T.groundHeightAt(0, 0) + 100, 0);
P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
P.vel.set(0, 0, 20); P.grounded = false;
T.setClinging(null); T.releaseWeb();
for (let i = 0; i < 10; i++) { T.update(DT); T.updateCamera(DT); }

console.log("===== 1. 몸이 실제로 있는가 =====");
const B = T.fpBody;
ok(!!B, "1인칭 몸이 만들어진다");
if (!B) { console.log("\n최종  통과 " + pass + " / 실패 " + (fail + 20)); process.exit(1); }
ok(B.userData.legs && B.userData.legs.length === 2, "다리가 둘이다");
const hip = B.userData.legs[0];
ok(!!hip.userData.knee, "무릎 관절이 있다");
ok(!!hip.userData.ankle, "발목 관절이 있다");
ok(!!B.userData.waist && !!B.userData.pelvis, "허리와 골반이 따로 있다");
// 골반이 허리의 자식이어야 허리를 접을 때 다리가 같이 간다
ok(B.userData.pelvis.parent === B.userData.waist, "골반이 허리에 매달려 있다");
ok(hip.parent === B.userData.pelvis, "다리가 골반에 매달려 있다");

console.log("\n===== 2. 굵기 =====");
{
  // 아래를 볼 때 화면을 덩어리로 덮으면 안 된다. 사람보다 얇게 잡았다.
  const r = B.userData.chest.geometry.parameters.radius;
  ok(r < 0.16, "가슴이 너무 굵지 않다", `반지름 ${r.toFixed(3)}m`);
  const th = hip.children.find(c => c.isMesh).geometry.parameters.radius;
  ok(th < 0.09, "허벅지가 너무 굵지 않다", `반지름 ${th.toFixed(3)}m`);
}

console.log("\n===== 3. 무릎은 한쪽으로만 접힌다 =====");
{
  // 사람 무릎은 뒤로만 접힌다. Three.js 에서 그건 rotation.x 가 음수인 방향이다 —
  // 양수가 나오면 무릎이 앞으로 꺾인 것이고, 그게 부러진 그림이다.
  P.pos.set(0, T.groundHeightAt(0, 0), 0);
  P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.grounded = true;
  let minKnee = -9;
  T.setKey("KeyW", true);
  for (let i = 0; i < 600; i++) {
    T.update(DT); T.updateCamera(DT);
    for (const h of B.userData.legs) minKnee = Math.max(minKnee, h.userData.knee.rotation.x);
  }
  T.setKey("KeyW", false);
  ok(minKnee <= 1e-6, "걷는 동안 무릎이 앞으로 꺾이지 않는다 (항상 뒤로만)",
     `최대 ${minKnee.toFixed(3)}`);
}

console.log("\n===== 4. 관성 쏠림 =====");
{
  // 줄이 당겨 감속하는 동안 다리가 앞으로 나가야 한다.
  T.releaseWeb();
  P.pos.set(0, T.groundHeightAt(0, 0) + 120, 0);
  P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.vel.set(0, -4, 46); P.grounded = false;
  for (let i = 0; i < 5; i++) { T.update(DT); T.updateCamera(DT); }
  const flat = B.userData.legs[0].rotation.x;

  const a = T.findSwingAnchor();
  ok(!!a, "시험용 앵커를 찾았다");
  if (a) {
    T.attachWeb(a, T.autoHand);
    let maxHip = -9, maxSwing = -9;
    for (let i = 0; i < 300; i++) {
      T.update(DT); P.renderPos.lerpVectors(P.prevPos, P.pos, 1); T.updateCamera(DT);
      maxHip = Math.max(maxHip, B.userData.legs[0].rotation.x);
      maxSwing = Math.max(maxSwing, T.fpIne ? T.fpIne.swing : -9);
    }
    ok(maxHip > flat + 0.25, "스윙 중 다리가 앞으로 쏠린다",
       `평상시 ${flat.toFixed(2)} -> 최대 ${maxHip.toFixed(2)}`);
    ok(T.fpIne && maxSwing > 0.1, "관성값이 실제로 차오른다", `최대 ${maxSwing.toFixed(2)}`);
  }
}

console.log("\n===== 5. 관성은 지나쳤다 돌아온다 (스프링) =====");
{
  // 목표를 그냥 따라가면(lerp) 절대 지나치지 않아서 관성으로 안 보인다.
  // 스프링이면 오버슈트한다. 그 오버슈트가 '쏠림'이다.
  const ine = T.makeBodyInertia();
  ok(ine && ine.swing === 0, "관성 상태를 따로 만들 수 있다");
  // 목표 1 로 계단 입력을 주고 최대치를 본다
  const g = T.fpBody;
  let peak = 0, last = 0, fell = false;
  const ctx = { run: 0, air: 1, lean: 0, fwdAcc: -45, upVel: 0, ropeBack: 1, grounded: false, t: 0 };
  for (let i = 0; i < 240; i++) {
    T.poseFpBody(g, 0, ctx, ine, DT);
    peak = Math.max(peak, ine.swing);
    if (i > 40 && ine.swing < last - 1e-4) fell = true;
    last = ine.swing;
  }
  ok(peak > 1.0, "계단 입력에 크게 반응한다", `최대 ${peak.toFixed(2)}`);
  ok(fell, "지나쳤다가 되돌아온다 (오버슈트)");
}

console.log("\n===== 6. 고개를 숙이면 몸이 시야에 들어온다 =====");
{
  const g = T.fpBody;
  const ine = T.makeBodyInertia();
  const ctx = { run: 0, air: 0, lean: 0, fwdAcc: 0, upVel: 0, ropeBack: 0, grounded: true, t: 0 };
  T.poseFpBody(g, 0, ctx, ine, DT);
  const up = g.rotation.x;
  T.poseFpBody(g, -0.9, ctx, ine, DT);     // 아래를 본다
  ok(Math.abs(g.rotation.x - 0.9) < 1e-6,
     "고개 각도를 온전히 되돌린다 (몸은 세계 기준으로 서 있다)", `${g.rotation.x.toFixed(3)}`);
  ok(Math.abs(up) < 1e-6, "정면을 볼 때는 몸도 똑바로다");
}

console.log("\n===== 7. 1인칭 롤 설정 =====");
{
  ok(T.SETTINGS && T.SETTINGS.roll, "롤이 설정 항목으로 있다");
  const opts = T.SETTINGS.roll.opts.map(o => o.v);
  ok(opts.length === 3 && opts[0] === 0, "없음 / 약 / 강 세 단계다", opts.join(", "));

  // 화면 기울기를 실제로 재본다. 0 이면 수평, 1 이면 눕는다.
  const measure = (v) => {
    T.SETTINGS.roll.set(v);
    T.setFP(true); T.releaseWeb(); T.setClinging(null);
    P.pos.set(0, T.groundHeightAt(0, 0) + 110, 0);
    P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
    P.vel.set(0, -2, 50); P.grounded = false;
    T.setView(0, -0.05);
    const a2 = T.findSwingAnchor();
    if (a2) T.attachWeb(a2, T.autoHand);
    let mx = 0;
    for (let i = 0; i < 240; i++) {
      T.update(DT); P.renderPos.lerpVectors(P.prevPos, P.pos, 1); T.updateCamera(DT);
      const r = T.camRight();
      mx = Math.max(mx, Math.abs(Math.asin(Math.max(-1, Math.min(1, r.y)))) * 180 / Math.PI);
    }
    T.releaseWeb();
    return mx;
  };
  const r0 = measure(0), r1 = measure(1);
  ok(r0 < 0.5, "없음: 화면이 수평을 지킨다", `${r0.toFixed(2)}도`);
  ok(r1 > 8, "강: 화면이 실제로 눕는다", `${r1.toFixed(1)}도`);
  ok(r1 > r0 + 5, "설정이 실제로 차이를 만든다", `${r0.toFixed(1)}도 -> ${r1.toFixed(1)}도`);
  T.SETTINGS.roll.set(0.45);
}

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
