// 자동 곡예 · 시네마틱 카메라 · 능력 해금
//
// 문서 01 §14 · §22, 문서 02 §27.
// 셋 다 "조작을 뺏지 않는다"가 공통 규칙이다. 그게 지켜지는지 재는 파일이다.
import { T } from "./_harness.mjs";
const DT = 1 / 120;
T.syncWorld();
let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };
const P = T.player;

// 빈 하늘 높은 곳
function sky(vy) {
  P.pos.set(0, 400, 0);
  P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.vel.set(0, vy === undefined ? 12 : vy, 40);
  P.grounded = false;
  T.setClinging(null); T.releaseWeb();
  T.setMouseL(false); T.setMouseR(false); T.setMid(false);
  T.syncWorld();
}

console.log("===== 1. 자동 곡예 =====");
{
  // 조건이 맞으면 알아서 나간다 — 버튼을 외울 필요가 없다 (문서 01 §14)
  sky(12);
  const c0 = T.acroCount;
  T.acroTry(DT);
  ok(T.acroCount > c0, "빠르고 높고 솟구치는 중이면 알아서 돈다");

  // 쿨다운: 같은 동작이 연달아 나오면 지루하다
  const c1 = T.acroCount;
  T.acroTry(DT);
  ok(T.acroCount === c1, "곧바로 또 나오지는 않는다 (쿨다운)");

  // 낮은 데서는 안 돈다 — 착지가 엉킨다
  for (let i = 0; i < 400; i++) T.acroTry(DT);      // 쿨다운 흘려보내기
  P.pos.set(0, T.groundHeightAt(0, 0) + 6, 0);
  P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.vel.set(0, 12, 40); P.grounded = false;
  const c2 = T.acroCount;
  T.acroTry(DT);
  ok(T.acroCount === c2, "지면이 가까우면 안 돈다", `여유 ${T.ACRO_CLEAR}m 필요`);

  // 느리면 곡예로 안 읽힌다
  sky(12); P.vel.set(0, 12, 4);
  const c3 = T.acroCount;
  T.acroTry(DT);
  ok(T.acroCount === c3, "느리면 안 돈다");

  // 떨어지는 중에는 안 돈다 — 낙하 제어가 안 된다
  sky(-20);
  const c4 = T.acroCount;
  T.acroTry(DT);
  ok(T.acroCount === c4, "떨어지는 중에는 안 돈다");

  // 줄에 매달려 있으면 안 돈다
  sky(12);
  T.attachWeb(P.pos.clone().set(30, 460, 30));
  const c5 = T.acroCount;
  T.acroTry(DT);
  ok(T.acroCount === c5, "줄에 매달려 있으면 안 돈다");
  T.releaseWeb();
}

console.log("\n===== 2. 시네마틱 카메라 =====");
{
  // 조작을 뺏지 않는다. 시야각만 짧게 얹는다 (문서 01 §22)
  //
  // 지면에 세워두고 잰다. 공중에 두면 '큰 낙하' 연출이 계속 스스로 켜져서
  // 쿨다운이 영영 안 풀린다 — 처음에 그렇게 재려다 전부 실패했다.
  P.pos.set(0, T.groundHeightAt(0, 0), 0);
  P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.vel.set(0, 0, 0); P.grounded = true;
  T.setClinging(null); T.releaseWeb(); T.syncWorld();
  for (let i = 0; i < 400; i++) T.update(DT);        // 쿨다운 정리
  const c0 = T.cineCount;
  ok(T.cineFire("release", 1), "연출을 켤 수 있다");
  ok(T.cineCount === c0 + 1 && T.cineAmt() > 0.9, "세기가 최대로 들어온다");
  ok(!T.cineFire("drop", 1), "직후에 또 켜지지 않는다 (최근 연출이면 가중치를 낮춘다)");

  // 짧게 들어왔다 짧게 빠진다
  const yaw0 = T.viewYaw, pitch0 = T.viewPitch;
  let fovMax = 0;
  for (let i = 0; i < 120; i++) {
    T.update(DT); T.updateCamera(DT);
    fovMax = Math.max(fovMax, T.camera.fov);
  }
  ok(T.cineAmt() === 0, "1초 안에 빠진다 (컷신이 아니다)");
  ok(Math.abs(T.viewYaw - yaw0) < 1e-6 && Math.abs(T.viewPitch - pitch0) < 1e-6,
     "시점을 뺏지 않는다 — 각도는 그대로다",
     `yaw ${(T.viewYaw - yaw0).toFixed(4)} / pitch ${(T.viewPitch - pitch0).toFixed(4)}`);
  ok(fovMax > T.camera.fov + 1, "시야각만 잠깐 넓어졌다 돌아온다",
     `최대 ${fovMax.toFixed(1)} -> ${T.camera.fov.toFixed(1)}`);
}

console.log("\n===== 3. 능력 해금 =====");
{
  // 스토리 밖에서는 전부 열어둔다. 시작도 안 한 사람에게 잠그면 불편일 뿐이다.
  const s = T.save;
  s.story.cleared = []; s.story.mission = null; s.unlocked.abilities = [];
  ok(T.hasAbility("dual") && T.hasAbility("vclimb"), "스토리 밖에서는 전부 열려 있다");

  // 스토리를 시작하면 잠긴다
  s.story.mission = "m1";
  ok(!T.hasAbility("dual"), "스토리를 시작하면 아직 안 배운 건 잠긴다");
  ok(!T.hasAbility("vclimb"), "건물 타기도 마찬가지");

  // 보상으로 열린다
  s.unlocked.abilities = ["dual"];
  ok(T.hasAbility("dual"), "보상으로 받으면 열린다");
  ok(!T.hasAbility("vclimb"), "안 받은 건 그대로 잠겨 있다");

  // 연습·튜토리얼에서는 전부 열어둔다 (배우는 곳이다)
  T.startPractice("combat");
  ok(T.hasAbility("vclimb"), "연습 모드에서는 전부 열려 있다");
  T.stopPractice();
  ok(!T.hasAbility("vclimb"), "연습에서 나오면 도로 잠긴다");

  // 되돌려 놓는다 (다음 파일에 영향 주지 않게)
  s.story.mission = null; s.story.cleared = []; s.unlocked.abilities = [];
}

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
