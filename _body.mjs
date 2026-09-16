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

console.log("\n===== 5b. 두 다리가 따로 움직인다 =====");
{
  // 같은 값을 공유하면 다리가 아니라 판자 두 개다. 중력과 관성은 각 다리에
  // 따로 걸리고, 두 진자는 유효 길이·감쇠가 조금만 달라도 위상이 안 맞는다.
  const ine = T.makeBodyInertia();
  ok(ine.legs && ine.legs.length === 2, "다리마다 자기 상태가 있다");
  ok(ine.legs[0].k !== ine.legs[1].k, "두 다리의 강성이 다르다",
     `${ine.legs[0].k} / ${ine.legs[1].k}`);

  const g = T.fpBody;
  const ctx = { run: 0, air: 1, lean: 0.3, fwdAcc: -40, upVel: 5, ropeBack: 0.8,
                grounded: false, t: 0 };
  let maxGap = 0, sameCount = 0, n = 0;
  for (let i = 0; i < 300; i++) {
    ctx.fwdAcc = -40 * Math.sin(i * 0.03);       // 줄이 당겼다 놓는 것을 흉내낸다
    ctx.lean = 0.3 * Math.cos(i * 0.02);
    T.poseFpBody(g, 0, ctx, ine, DT);
    const a0 = g.userData.legs[0].rotation.x, a1 = g.userData.legs[1].rotation.x;
    const gap = Math.abs(a0 - a1);
    maxGap = Math.max(maxGap, gap);
    if (gap < 1e-6) sameCount++;
    n++;
  }
  ok(maxGap > 0.08, "두 다리 각도가 실제로 벌어진다 (공중에서도)",
     `최대 차이 ${(maxGap * 57.3).toFixed(1)}도`);
  ok(sameCount < n * 0.1, "둘이 똑같이 움직이는 프레임이 거의 없다",
     `${sameCount} / ${n} 프레임`);

  const z0 = g.userData.legs[0].rotation.z, z1 = g.userData.legs[1].rotation.z;
  ok(Math.abs(z0 - z1) > 1e-4, "좌우 벌어짐도 다리마다 다르다",
     `${z0.toFixed(3)} / ${z1.toFixed(3)}`);
}

console.log("\n===== 5d. 마디가 위 마디를 뒤따른다 (한 덩어리로 안 움직인다) =====");
{
  const g = T.fpBody;
  const hip0 = g.userData.legs[0];
  ok(!!hip0.userData.toe, "발끝 관절이 있다");
  ok(hip0.userData.toe.parent === hip0.userData.ankle, "발끝이 발목에 매달려 있다");
  ok(!!g.userData.chestJoint, "가슴도 관절이다 (목에 붙은 통짜가 아니다)");
  ok(g.userData.waist.parent === g.userData.chestJoint, "허리가 가슴에 매달려 있다");
  ok(!!T.armR.userData.wrist, "손목 관절이 있다");

  // 멈춰 있다가 갑자기 뛰어오른다. 골반이 먼저 돌고 무릎이 뒤따라야 한다.
  const ine = T.makeBodyInertia();
  const ctx = { run: 0, air: 0, lean: 0, fwdAcc: 0, upVel: 0, ropeBack: 0, grounded: true, t: 0 };
  for (let i = 0; i < 120; i++) T.poseFpBody(g, 0, ctx, ine, DT);   // 가만히 서 있기
  ctx.grounded = false; ctx.air = 1; ctx.upVel = 26; ctx.fwdAcc = -40; ctx.ropeBack = 0.9;
  const hist = [];
  for (let i = 0; i < 60; i++) {
    T.poseFpBody(g, 0, ctx, ine, DT);
    hist.push([Math.abs(hip0.rotation.x), Math.abs(hip0.userData.knee.rotation.x),
               Math.abs(hip0.userData.ankle.rotation.x)]);
  }
  const early = hist[6], late = hist[hist.length - 1];
  ok(early[0] > 0.02, "뛰어오르면 골반이 먼저 돈다", `${(early[0] * 57.3).toFixed(1)}도`);
  ok(early[1] < late[1] * 0.75, "무릎은 한 박자 늦게 접힌다",
     `0.05초 ${(early[1] * 57.3).toFixed(1)}도 → 0.5초 ${(late[1] * 57.3).toFixed(1)}도`);
  ok(early[2] < late[2] * 0.85, "발목은 무릎보다 더 늦다",
     `0.05초 ${(early[2] * 57.3).toFixed(1)}도 → 0.5초 ${(late[2] * 57.3).toFixed(1)}도`);

  // 두 다리의 무릎이 서로 다른 순간에 접힌다
  const k0 = [], k1 = [];
  for (let i = 0; i < 200; i++) {
    ctx.fwdAcc = -40 * Math.sin(i * 0.05);
    T.poseFpBody(g, 0, ctx, ine, DT);
    k0.push(g.userData.legs[0].userData.knee.rotation.x);
    k1.push(g.userData.legs[1].userData.knee.rotation.x);
  }
  let maxKneeGap = 0;
  for (let i = 0; i < k0.length; i++) maxKneeGap = Math.max(maxKneeGap, Math.abs(k0[i] - k1[i]));
  ok(maxKneeGap > 0.05, "두 무릎이 따로 접힌다", `최대 차이 ${(maxKneeGap * 57.3).toFixed(1)}도`);
}

console.log("\n===== 5c. 팔이 어깨에서 목표 방향으로 뻗는다 =====");
{
  // 손목을 화면 앞쪽에 박아두면 위팔이 늘어나 V자로 꺾인다. 손목이 어깨에서
  // 목표 방향으로 나가야 어깨-팔꿈치-손목이 한 줄에 놓인다.
  // 이 파일에는 _reach.mjs 의 P()/settle() 헬퍼가 없다. 여기서 만든다.
  //
  // reachWrist 는 카메라 로컬 좌표로 답한다. 그래서 카메라를 먼저 아는 자리에
  // 세워야 한다 — 앞선 검사가 남긴 위치를 그대로 쓰면 "정면"이 정면이 아니다.
  // ★ 이 게임의 정면은 viewYaw=0 에서 월드 **+Z** 다 (viewDir = cos(yaw) 가 z).
  // three.js 카메라 자체의 정면은 -Z 이므로 둘이 반대다. 여기서 한 번 틀렸다 —
  // 월드 +Z 에 둔 목표가 "등 뒤"가 아니라 정면으로 잡혔다.
  const V = T.player.pos.constructor;
  const pt = (x, y, z) => new V(x, y, z);
  T.setFP(true);
  T.releaseWeb(); T.setClinging(null);
  P.pos.set(0, 300, 0); P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.vel.set(0, 0, 0); P.grounded = false;
  T.setView(0, 0);
  for (let i = 0; i < 4; i++) { T.update(DT); T.updateCamera(DT); }
  const settle = (n) => { for (let i = 0; i < n; i++) { T.updateReach(DT); } };
  const sh = new V(0.21, -0.30, 0.02);
  const out = new V();

  T.setReach("R", pt(0, 301.8, 20));   // 정면 = 월드 +Z settle(40);
  T.reachWrist(out, sh, "R");
  ok(out.z < sh.z - 0.5, "정면을 향하면 손목이 앞으로 나간다", `z ${out.z.toFixed(2)}`);

  // 등 뒤 목표 — 손목이 어깨보다 뒤로 가야 한다 (= 화면 밖)
  //
  // 좌우도 주의해야 한다. +Z 를 보고 있을 때 플레이어의 **오른쪽은 월드 -X** 다.
  // 여기서 두 번째로 틀렸다 — x 를 +6 으로 두니 오른손 기준 '몸을 가로지르는'
  // 방향이 되어 안쪽 한계(YAW_IN 0.5)에 걸렸고, 팔이 뒤로 안 갔다.
  // 오른손이 바깥으로 뻗는 등 뒤 = (-x, -z).
  T.setReach("R", pt(-6, 303, -14)); settle(40);
  T.reachWrist(out, sh, "R");
  ok(out.z > sh.z + 0.1, "등 뒤를 향하면 손목이 어깨보다 뒤로 간다 (화면 밖)",
     `z ${out.z.toFixed(2)} > ${sh.z.toFixed(2)}`);

  const d = out.distanceTo(sh);
  ok(Math.abs(d - T.REACH_LEN) < 1e-6, "어깨~손목 거리가 팔 길이로 일정하다",
     `${d.toFixed(3)}m = ${T.REACH_LEN}m`);
  T.clearReach("R"); settle(60);
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
