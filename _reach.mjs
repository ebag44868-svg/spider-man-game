// STEP 1 — reachTarget: 손이 실제로 웹 앵커를 향하는가.
//
// 여기서 재는 것은 표현 계층 하나뿐이다. 물리는 건드리지 않았으므로
// 이 파일은 카메라와 팔만 놓고 본다 — 도시도 적도 필요 없다.
import { T } from "./_harness.mjs";
const DT = 1 / 120;
let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };

// 카메라를 원점에 두고 -Z를 보게 한다. reach는 이 축을 정면으로 친다.
function aimCam() {
  T.camera.position.set(0, 0, 0);
  T.camera.rotation.set(0, 0, 0);
  T.camera.updateMatrixWorld(true);
}
// 목표는 {x,y,z}면 된다 — reach.js는 THREE 타입을 요구하지 않는다.
// (Fab 모델로 갈아끼워도 이 인터페이스는 그대로다)
const P = (x, y, z) => ({ x, y, z });
function settle(n) { for (let i = 0; i < n; i++) T.updateReach(DT); }
function reset() { T.clearReach("R"); settle(60); aimCam(); }

console.log("===== 1. 방향 — 앵커 쪽을 본다 =====");
{
  reset();
  T.setReach("R", P(0, 0, -10));      // 정면
  settle(30);
  let r = T.getReach("R");
  ok(Math.abs(r.yaw) < 0.02, "정면 앵커면 좌우 각이 0이다", `yaw ${r.yaw.toFixed(3)}`);
  ok(Math.abs(r.pitch) < 0.02, "정면 앵커면 위아래 각이 0이다", `pitch ${r.pitch.toFixed(3)}`);

  reset();
  T.setReach("R", P(10, 0, -10));     // 오른쪽 위 45도
  settle(30);
  r = T.getReach("R");
  // 45도(0.785)는 소프트 클램프에 눌려 0.65쯤으로 나온다. 눌리는 게 정상이다 —
  // 그대로 쓰면 시야를 크게 돌릴 때 팔이 한계에서 뚝 꺾인다.
  ok(r.yaw > 0.5 && r.yaw < 0.8, "오른쪽 앵커면 yaw가 오른쪽(+)이다", `yaw ${r.yaw.toFixed(3)}`);

  reset();
  T.setReach("R", P(-10, 0, -10));
  settle(30);
  // 오른손이 왼쪽(몸 안쪽)을 향하는 건 사람 어깨가 잘 못 하는 동작이다.
  // 가슴이 막으므로 안쪽 한계(YAW_IN)에 바짝 붙어 나오는 게 정상이다.
  // 바깥쪽은 귀 뒤까지 열려 있으니(YAW_OUT) 둘의 비대칭이 핵심이다.
  ok(T.getReach("R").yaw < -0.3 && T.getReach("R").yaw > -T.YAW_IN - 0.02,
     "왼쪽 앵커면 yaw가 왼쪽(-)이고 안쪽 한계에 눌린다", `yaw ${T.getReach("R").yaw.toFixed(3)}`);

  reset();
  T.setReach("R", P(0, 10, -10));     // 머리 위쪽 — 스윙 중 대부분이 이 상황이다
  settle(30);
  r = T.getReach("R");
  ok(r.pitch > 0.5, "위쪽 앵커면 pitch가 위(+)다", `pitch ${r.pitch.toFixed(3)}`);
  ok(Math.abs(r.dist - Math.hypot(10, 10)) < 0.01, "거리를 정확히 잰다", `dist ${r.dist.toFixed(2)}`);

  // 등 뒤 앵커에도 어깨가 뒤집히지 않아야 한다
  reset();
  T.setReach("R", P(0, 0, 10));
  settle(30);
  ok(Math.abs(T.getReach("R").yaw) <= T.YAW_MAX + 1e-6, "등 뒤여도 팔 각도가 한계 안에 든다",
     `yaw ${T.getReach("R").yaw.toFixed(3)} / max ${T.YAW_MAX}`);
  ok(Math.abs(T.getReach("R").pitch) < 1.2, "등 뒤여도 위아래가 뒤집히지 않는다");

  // 어깨는 좌우가 대칭이 아니다. 같은 45도라도 바깥쪽이 훨씬 크게 열린다.
  reset();
  T.setReach("R", P(10, 0, -10)); settle(30);
  const outR = T.getReach("R").yaw;
  reset();
  T.setReach("R", P(-10, 0, -10)); settle(30);
  const inR = Math.abs(T.getReach("R").yaw);
  ok(outR > inR * 1.4, "바깥쪽이 안쪽보다 훨씬 크게 열린다",
     `바깥 ${outR.toFixed(2)} / 안쪽 ${inR.toFixed(2)}`);
  ok(T.YAW_IN < T.YAW_OUT && T.PITCH_DN < T.PITCH_UP, "안쪽·아래쪽 한계가 더 좁다");

  // 왼손은 반대다. 왼쪽이 바깥이다.
  reset();
  T.setReach("L", P(-10, 0, -10)); settle(30);
  const outL = Math.abs(T.getReach("L").yaw);
  reset();
  T.setReach("L", P(10, 0, -10)); settle(30);
  const inL = Math.abs(T.getReach("L").yaw);
  T.clearReach("L"); settle(150);
  ok(outL > inL * 1.4, "왼손은 왼쪽이 바깥이다 (좌우가 뒤집힌다)",
     `바깥 ${outL.toFixed(2)} / 안쪽 ${inL.toFixed(2)}`);

  // 소프트 클램프: 각도가 커질수록 완만하게 멈춘다. 뚝 잘리면 팔이 꺾여 보인다.
  ok(Math.abs(T.soft(0.2, T.YAW_MAX) - 0.2) < 0.02, "작은 각도는 거의 그대로 지나간다",
     `${T.soft(0.2, T.YAW_MAX).toFixed(3)}`);
  ok(T.soft(9.0, T.YAW_MAX) < T.YAW_MAX && T.soft(9.0, T.YAW_MAX) > T.YAW_MAX * 0.9,
     "큰 각도는 한계에 붙되 넘지 않는다", `${T.soft(9.0, T.YAW_MAX).toFixed(3)}`);

  // ★ 등 뒤 앵커. 스윙은 앵커를 지나쳐 가는 운동이라 이게 기본 상황이다.
  // 예전에는 바깥 한계가 57도여서 140도 뒤의 앵커가 55도로 눌렸다 —
  // 줄은 뒤로 가는데 팔은 옆을 보는 그림이 되고, 그게 "팔이 꺾인다"였다.
  // 이제는 귀 뒤까지 넘어가야 한다. 화면 밖으로 나가는 게 정답이다.
  reset();
  T.setReach("R", P(6, 2, 14));            // 오른쪽 등 뒤 (카메라는 -Z 를 본다)
  settle(30);
  const back = T.getReach("R");
  ok(back.yaw > 1.6, "등 뒤 앵커면 팔이 귀 뒤로 넘어간다 (90도 초과)",
     `yaw ${(back.yaw * 57.3).toFixed(0)}도`);
  ok(back.yaw < T.YAW_OUT, "그래도 어깨 한계는 넘지 않는다",
     `${(back.yaw * 57.3).toFixed(0)}도 < ${(T.YAW_OUT * 57.3).toFixed(0)}도`);
  ok(T.soft(1.0, T.YAW_MAX) > T.soft(0.8, T.YAW_MAX),
     "한계 근처에서도 단조증가한다 (평평해지면 방향을 못 읽는다)");
}

console.log("\n===== 2. 위상 — 쏨 → 잡음 → 유지 → 놓음 =====");
{
  reset();
  ok(T.getReach("R").phase === "idle", "잡은 게 없으면 idle이다");
  T.setReach("R", P(0, 8, -8));
  T.updateReach(DT);
  ok(T.getReach("R").phase === "shoot", "걸면 shoot으로 시작한다");
  ok(T.getReach("R").fire > 0.5, "쏘는 동안 fire가 살아 있다");

  settle(Math.ceil(T.SHOOT_T * 120) + 1);
  ok(T.getReach("R").phase === "catch", "쏨이 끝나면 catch로 넘어간다");
  ok(T.getReach("R").kick > 0.3, "잡히는 순간 반동이 있다", `kick ${T.getReach("R").kick.toFixed(2)}`);

  settle(Math.ceil(T.CATCH_T * 120) + 1);
  ok(T.getReach("R").phase === "hold", "반동이 끝나면 hold로 간다");
  ok(T.getReach("R").grip > 0.6, "잡고 있는 동안 손을 움켜쥔다", `grip ${T.getReach("R").grip.toFixed(2)}`);

  // 같은 앵커를 계속 주면 다시 쏘지 않는다 (매 프레임 부르는 구조라 중요하다)
  for (let i = 0; i < 30; i++) { T.setReach("R", P(0, 8, -8)); T.updateReach(DT); }
  ok(T.getReach("R").phase === "hold", "같은 앵커를 계속 줘도 다시 쏘지 않는다");

  // 앵커가 크게 옮겨가면 새로 쏜다
  T.setReach("R", P(9, 8, -8));
  T.updateReach(DT);
  ok(T.getReach("R").phase === "shoot", "앵커가 바뀌면 새로 쏜다");

  T.clearReach("R");
  T.updateReach(DT);
  ok(T.getReach("R").phase === "release", "놓으면 release로 간다");
  settle(Math.ceil(T.REL_T * 120) + 1);
  ok(T.getReach("R").phase === "idle", "되돌아오면 idle이다");
  settle(120);
  ok(T.getReach("R").on < 0.02, "놓고 나면 기본 자세로 완전히 돌아온다", `on ${T.getReach("R").on.toFixed(3)}`);
}

console.log("\n===== 3. 팔에 실제로 먹는가 =====");
{
  reset();
  // 기본 자세를 흉내 낸다 (게임의 웹스윙 분기가 세팅하는 값과 같은 자리)
  const base = { y: 0, x: 0.55, z: -0.52 };
  const put = () => { T.armR.rotation.set(base.x, base.y, 0); T.armR.position.set(0.5, -0.4, base.z); };

  put();
  T.applyReach(T.armR, "R");
  ok(Math.abs(T.armR.rotation.y - base.y) < 1e-6, "잡은 게 없으면 팔을 안 건드린다");

  // 거울: 왼팔은 scale.x 가 음수라 회전을 그대로 더하면 화면에서 반대로 돈다.
  T.setReach("L", P(-10, 0, -10)); settle(40);
  T.armL.rotation.set(0.55, 0, 0);
  T.armL.scale.set(-0.72, 0.72, 0.72);
  T.applyReach(T.armL, "L");
  const lrot = T.armL.rotation.y;
  T.armL.rotation.set(0.55, 0, 0);
  T.armL.scale.set(0.72, 0.72, 0.72);      // 거울이 아닌 척 해본다
  T.applyReach(T.armL, "L");
  ok(Math.sign(lrot) !== Math.sign(T.armL.rotation.y),
     "거울인 팔은 회전 부호가 뒤집힌다 (왼팔이 기괴하게 꺾이던 원인)",
     `${lrot.toFixed(3)} vs ${T.armL.rotation.y.toFixed(3)}`);
  T.armL.scale.set(-0.72, 0.72, 0.72);
  T.clearReach("L"); settle(150);

  T.setReach("R", P(10, 0, -10));   // 오른쪽
  settle(40);
  put();
  T.applyReach(T.armR, "R");
  ok(T.armR.rotation.y < base.y - 0.5,
     "오른쪽 앵커면 팔이 오른쪽으로 돈다 (-Z축 규칙상 rotation.y는 음수)",
     `y ${T.armR.rotation.y.toFixed(3)}`);

  reset();
  T.setReach("R", P(0, 10, -10));   // 위쪽
  settle(40);
  put();
  T.applyReach(T.armR, "R");
  ok(T.armR.rotation.x > base.x + 0.5, "위쪽 앵커면 팔이 위로 든다", `x ${T.armR.rotation.x.toFixed(3)}`);

  // 세기를 줄이면 덜 돈다 (거미줄 격투 분기가 0.55로 쓴다)
  reset();
  T.setReach("R", P(10, 0, -10));
  settle(40);
  put(); T.applyReach(T.armR, "R", 1);
  const full = T.armR.rotation.y;
  put(); T.applyReach(T.armR, "R", 0.55);
  const half = T.armR.rotation.y;
  ok(Math.abs(half - base.y) < Math.abs(full - base.y) * 0.8,
     "세기를 줄이면 덜 돈다", `full ${full.toFixed(3)} / half ${half.toFixed(3)}`);
}

console.log("\n===== 4. 좌우 손은 독립이다 (STEP 4 양손 웹의 토대) =====");
{
  reset();
  T.clearReach("L"); settle(60);
  T.setReach("R", P(10, 0, -10));
  T.setReach("L", P(-10, 0, -10));
  settle(40);
  ok(T.getReach("R").yaw > 0.5 && T.getReach("L").yaw < -0.5,
     "두 손이 서로 다른 곳을 본다",
     `R ${T.getReach("R").yaw.toFixed(2)} / L ${T.getReach("L").yaw.toFixed(2)}`);
  T.clearReach("L"); settle(150);      // 놓은 팔은 천천히(6/s) 돌아온다
  ok(T.getReach("L").on < 0.02 && T.getReach("R").on > 0.9,
     "한 손을 놔도 다른 손은 그대로다");
  T.clearReach("R"); settle(60);
}

console.log("\n===== 5. 상완 — 어깨와 팔꿈치가 이어진다 =====");
{
  // 지금까지는 전완과 손만 있어서 팔이 팔꿈치 아래에서 끊겨 허공에 떠 보였다.
  T.ensureUpperArms();
  const up = T.upperR;
  ok(!!up, "상완이 만들어진다");
  T.armR.visible = true;
  T.armR.position.set(0.5, -0.4, -0.52);
  T.armR.rotation.set(0.55, 0.2, 0);
  T.armR.scale.setScalar(0.72);
  T.linkUpperArm(up, T.armR, T.SHOULDER_R);
  ok(up.visible, "팔이 보이면 상완도 보인다");
  // 어깨 쪽은 잘라낸다 — 사람은 자기 어깨를 못 보고, 광각에서 그 부분이
  // 렌즈에 붙어 화면을 덮었다. 그래서 어깨에서 시작하지 않는 게 정상이다.
  // 다만 어깨~팔꿈치 **선 위에** 있어야 한다.
  {
    const V = T.player.pos.constructor;
    const elbow = new V(0, 0, 0.40 * Math.abs(T.armR.scale.z))
      .applyQuaternion(T.armR.quaternion).add(T.armR.position);
    const seg = elbow.clone().sub(T.SHOULDER_R);
    const segLen = seg.length();
    const toUp = up.position.clone().sub(T.SHOULDER_R);
    const along = toUp.dot(seg) / (segLen * segLen);       // 0=어깨 1=팔꿈치
    const off = toUp.clone().addScaledVector(seg, -along).length();
    ok(off < 1e-5, "상완이 어깨~팔꿈치 선 위에 있다", `벗어남 ${off.toFixed(6)}`);
    ok(along > 0.2 && along < 0.7, "어깨 쪽 구간은 그리지 않는다",
       `시작 ${(along * 100).toFixed(0)}%`);
    ok(Math.abs(up.scale.z - segLen * (1 - along)) < 1e-5,
       "길이가 남은 구간과 맞는다", `${up.scale.z.toFixed(3)}`);
  }
  const len1 = up.scale.z;
  ok(len1 > 0.1 && len1 < 2, "길이가 그럴듯하다", `${len1.toFixed(3)}m`);

  // 팔을 멀리 뻗으면 상완도 길어져야 한다. 고정 길이면 팔꿈치가 떨어진다.
  T.armR.position.set(0.5, -0.1, -0.95);
  T.linkUpperArm(up, T.armR, T.SHOULDER_R);
  ok(up.scale.z > len1, "팔을 뻗으면 상완이 늘어난다", `${len1.toFixed(3)} -> ${up.scale.z.toFixed(3)}`);

  T.armR.visible = false;
  T.linkUpperArm(up, T.armR, T.SHOULDER_R);
  ok(!up.visible, "팔이 안 보이면 상완도 숨는다");
  T.armR.visible = true;
}

console.log("\n===== 손: 마디별 관절 · 쏘고 나서 줄을 잡는다 =====");
{
  reset();
  const h = T.armR;
  const f0 = h.userData.fingers[0];
  ok(!!f0.userData.mid && !!f0.userData.tip, "손가락이 마디 셋으로 나뉜다 (뿌리·가운데·끝)");
  ok(!!h.userData.gripPoint, "줄을 쥐는 지점이 있다");

  for (let i = 0; i < 40; i++) T.poseHand(h, 0, 0, 1, 0, 0.5);
  const flat = h.userData.fingers.map(f => f.rotation.x + f.userData.mid.rotation.x);
  ok(flat.every(v => v < 0.2), "아무것도 안 쥐면 손가락이 펴져 있다", flat.map(v => v.toFixed(2)).join(" "));
  const thFlat = Math.abs(h.userData.thumb.rotation.y);

  for (let i = 0; i < 40; i++) T.poseHand(h, 1, 0, 1, 0, 0.5);
  const sp = h.userData.fingers.map(f => f.rotation.x);
  ok(sp[1] > 1 && sp[2] > 1 && sp[0] < 0.2 && sp[3] < 0.2,
     "웹슈팅 자세는 중지·약지만 접는다", sp.map(v => v.toFixed(2)).join(" "));

  for (let i = 0; i < 40; i++) T.poseHand(h, 0, 1, 1, 0, 0.5);
  const g = h.userData.fingers;
  ok(g.every(f => f.rotation.x > 1.2), "줄을 쥐면 네 손가락이 다 말린다",
     g.map(f => f.rotation.x.toFixed(2)).join(" "));
  ok(g[0].userData.mid.rotation.x > g[0].rotation.x, "가운데 마디가 뿌리보다 더 굽는다",
     `뿌리 ${g[0].rotation.x.toFixed(2)} / 가운데 ${g[0].userData.mid.rotation.x.toFixed(2)}`);
  ok(g[0].userData.tip.rotation.x > 0.5 && g[0].userData.tip.rotation.x < g[0].userData.mid.rotation.x,
     "끝마디는 조금 덜 굽는다", g[0].userData.tip.rotation.x.toFixed(2));
  ok(Math.abs(h.userData.thumb.rotation.y) > thFlat, "엄지가 쥘 때 손바닥 쪽으로 덮는다",
     `${thFlat.toFixed(2)} -> ${Math.abs(h.userData.thumb.rotation.y).toFixed(2)}`);
  ok(h.userData.thumb.userData.mid.rotation.x > 0.7, "엄지도 마디가 접힌다",
     h.userData.thumb.userData.mid.rotation.x.toFixed(2));

  // 쏘는 동안은 아직 안 쥐고, 걸리면 쥔다. 놓으면 편다.
  const r = T.getReach("R");
  T.setReach("R", P(0, 3, -30), "web");
  settle(1);
  ok(r.phase === "shoot" && r.grip < 0.2, "쏘는 동안은 아직 안 쥔다", `grip ${r.grip.toFixed(2)}`);
  settle(40);
  ok(r.grip > 0.8, "걸리면 0.33초 안에 줄을 잡는다", `grip ${r.grip.toFixed(2)}`);
  ok(r.kick >= 0, "잡는 순간 반동값이 나온다");
  T.clearReach("R");
  settle(1);
  ok(r.open > 0.8, "놓는 순간 손을 편다", `open ${r.open.toFixed(2)}`);
  settle(40);
  ok(r.open === 0 && r.grip < 0.4, "펴고 나면 원래 손으로 돌아온다", `grip ${r.grip.toFixed(2)}`);
  reset();
}

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
