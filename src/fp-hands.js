// 1인칭 손과 웹슈터. 모델 파일 없이 캡슐·박스로 조립한다.
//
// game3d.js에서 그대로 옮겨온 코드다. 내용은 한 줄도 바꾸지 않았다.
// 게임 상태를 전혀 참조하지 않는다 — makeHand()가 손 오브젝트를 만들어 돌려주고,
// poseHand()는 넘겨받은 손을 주어진 값대로 굽힐 뿐이다.
// 손을 어디에 두고 언제 굽힐지는 여전히 game3d.js의 updateCamera가 정한다.
//
// 재질 4개(장갑·소매·웹슈터·노즐)는 이 파일 밖에서 쓰이지 않아 같이 옮겼다.

// 브라우저는 importmap으로 "three"를 이 파일로 보낸다. 여기서는 상대경로를 직접 쓴다 —
// 테스트 하네스(Node)에는 importmap이 없고, 어차피 같은 파일로 해석되어 인스턴스도 하나다.
import * as THREE from "../lib/three.module.js";

import { makeWebGloveTexture } from "./textures.js";

let gloveMat = null, sleeveMat = null, shooterMat = null, nozzleMat = null;

// game3d.js가 원래 이 재질들을 만들던 바로 그 자리에서 한 번 불러준다.
// 모듈 최상위에서 만들면 안 된다 — import는 game3d.js 본문보다 먼저 실행되는데
// 그 시점엔 아직 캔버스(document)가 준비되지 않아 하네스가 죽는다. 실제로 겪었다.
function initHands() {
  gloveMat = new THREE.MeshStandardMaterial({ map: makeWebGloveTexture(), color: 0xffffff, roughness: 0.55 });
  sleeveMat = new THREE.MeshStandardMaterial({ color: 0xd6182b, roughness: 0.7 });
  shooterMat = new THREE.MeshStandardMaterial({ color: 0x252a34, roughness: 0.35, metalness: 0.55 });
  nozzleMat = new THREE.MeshStandardMaterial({ color: 0xb9c2cf, roughness: 0.25, metalness: 0.85 });
}

// 손가락 = 두 마디. root를 굽히면 손가락 전체가, mid를 굽히면 끝마디만 접힌다.
function makeFinger(len, thick) {
  const root = new THREE.Group();
  const prox = new THREE.Mesh(new THREE.CapsuleGeometry(thick, len * 0.5, 3, 6), gloveMat);
  prox.rotation.x = Math.PI / 2;
  prox.position.z = -(len * 0.25 + thick * 0.2);
  root.add(prox);
  const mid = new THREE.Group();
  mid.position.z = -(len * 0.5 + thick * 0.4);
  const dist = new THREE.Mesh(new THREE.CapsuleGeometry(thick * 0.84, len * 0.4, 3, 6), gloveMat);
  dist.rotation.x = Math.PI / 2;
  dist.position.z = -(len * 0.2 + thick * 0.18);
  mid.add(dist);
  root.add(mid);
  root.userData.mid = mid;
  return root;
}

// 상완 — 어깨에서 팔꿈치까지.
//
// 지금까지는 전완과 손만 있어서 팔이 화면에 둥둥 떠 있었다. 특히 팔을 뻗으면
// 팔꿈치 아래가 허공에서 끊겼다. 어깨는 화면 밖 아래 모서리에 고정해 두고,
// 팔꿈치는 팔이 움직이는 대로 따라가므로 둘 사이 거리가 매 프레임 바뀐다.
// 그래서 길이를 고정하지 않고 늘였다 줄인다 (scale.z).
//
// 원통은 +Y로 서 있다. -90도 돌려 -Z를 향하게 하고, 0에서 -1까지 뻗도록
// 반 칸 밀어둔다. 그러면 group.scale.z 가 곧 길이(m)가 된다.
function makeUpperArm() {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.074, 0.086, 1, 12), sleeveMat);
  m.rotation.x = -Math.PI / 2;
  m.position.z = -0.5;
  g.add(m);
  return g;
}

// 어깨와 팔꿈치를 잇는다. 게임 상태를 안 본다 — 팔의 현재 변환만 읽는다.
// elbowZ = 팔 로컬에서 팔꿈치가 있는 자리(전완 뒤끝). 팔이 뒤집힌 왼손도 z는 그대로다.
const _elbow = new THREE.Vector3(), _dir = new THREE.Vector3();
const _FWD = new THREE.Vector3(0, 0, -1);
// 어깨 쪽에서 얼마나 잘라낼지. 0.45 면 어깨에서 45% 지점부터 그린다.
//
// 사람은 자기 어깨를 못 본다 — 시야 원뿔 밖이다. 그런데 우리는 어깨(눈에서
// 37cm)에서 시작하는 원통을 그대로 그렸고, 광각(95도)에서 그 부분이 렌즈에
// 붙어 화면을 빨간 원뿔로 덮었다. 실제로 그렇게 보였다.
// 어깨 쪽 구간을 빼면 팔이 화면 가장자리에서 들어오는 그림이 된다.
const UPPER_TRIM = 0.45;

function linkUpperArm(up, arm, shoulder, elbowZ) {
  up.visible = arm.visible;
  if (!arm.visible) return;
  // 팔꿈치. 팔뚝(arm)의 +Z 방향으로 그만큼 뒤. 회전은 쿼터니언을 쓴다 —
  // 조준 정렬에서 quaternion.slerp 로 덮어쓰므로 Euler 를 읽으면 어긋난다.
  _elbow.set(0, 0, (elbowZ === undefined ? 0.40 : elbowZ) * Math.abs(arm.scale.z))
        .applyQuaternion(arm.quaternion).add(arm.position);
  _dir.copy(_elbow).sub(shoulder);
  const len = _dir.length();
  if (len < 1e-4) { up.visible = false; return; }
  _dir.divideScalar(len);
  // 어깨 쪽을 잘라내고 그 지점부터 팔꿈치까지만 그린다
  up.position.copy(shoulder).addScaledVector(_dir, len * UPPER_TRIM);
  up.quaternion.setFromUnitVectors(_FWD, _dir);
  up.scale.set(1, 1, len * (1 - UPPER_TRIM));
}

// 손은 -Z 방향을 향하고, 손바닥이 하늘(+Y)을 본다.
// 따라서 손가락은 +X 회전으로 손바닥 쪽(위)으로 말린다.
function makeHand(mirror) {
  const g = new THREE.Group();

  // 전완은 짧게. 길면 손을 뒤로 당기는 포즈에서 뒷끝이 카메라 근평면(0.1)을 넘어
  // 잘려나가 "팔이 손에서 떨어진" 것처럼 보인다.
  const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.088, 0.34, 4, 10), sleeveMat);
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = 0.24;
  g.add(sleeve);

  // 웹슈터: 손목 밴드 + 아래쪽 노즐
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.098, 0.075, 12), shooterMat);
  band.rotation.x = Math.PI / 2;
  band.position.z = 0.045;
  g.add(band);
  // 손바닥이 하늘을 보므로 웹슈터 노즐도 손바닥 쪽(+Y)에 붙는다
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.1, 8), nozzleMat);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0.052, -0.03);
  g.add(nozzle);

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.062, 0.15), gloveMat);
  palm.position.z = -0.06;
  g.add(palm);

  // 검지 · 중지 · 약지 · 소지
  const spec = [
    { x: -0.055, len: 0.115, th: 0.021 },
    { x: -0.019, len: 0.128, th: 0.022 },
    { x:  0.017, len: 0.118, th: 0.021 },
    { x:  0.05,  len: 0.095, th: 0.018 },
  ];
  const fingers = spec.map(s => {
    const f = makeFinger(s.len, s.th);
    f.position.set(s.x, 0.004, -0.13);
    g.add(f);
    return f;
  });

  // 오른손 + 손바닥이 하늘 -> 엄지는 오른쪽(+X)에 온다
  const thumb = makeFinger(0.082, 0.023);
  thumb.position.set(0.076, 0.012, -0.052);
  thumb.rotation.set(0, -0.85, 0);
  g.add(thumb);

  g.userData.nozzle = nozzle;   // 손목 웹슈터 — 거미줄이 여기서 나간다
  g.userData.fingers = fingers;
  g.userData.thumb = thumb;
  g.userData.curl = [0, 0, 0, 0];   // 손마다 따로 (양손이 서로 값을 덮어쓰지 않게)
  if (mirror) mirrorInPlace(g);
  g.visible = false;
  return g;
}

// 진짜 거울상으로 만든다.
//
// 예전에는 scale.x = -1 하나로 뒤집었다. 그게 팔이 기괴하게 꺾인 진짜 원인이다 —
// 음수 스케일은 그 아래 모든 좌표계의 손잡이(handedness)를 뒤집어서, 회전을 하나
// 얹을 때마다 화면에서는 반대로 돈다. 포즈를 손으로 맞춰 놓아도 reach 처럼 나중에
// 회전을 더하는 쪽이 생기면 그때부터 어긋난다. 법선도 뒤집혀 조명이 이상해진다.
//
// 대신 자식들의 로컬 변환을 x=0 평면에 대해 반사한다. 각 단계에서 x 위치와
// y·z 회전을 뒤집으면 전체가 정확히 거울상이 되고, 스케일은 양수로 남는다.
// 그러면 왼팔도 오른팔과 **똑같은 회전 규칙**을 쓴다.
function mirrorInPlace(root) {
  root.traverse(o => {
    if (o === root) return;
    o.position.x = -o.position.x;
    o.rotation.y = -o.rotation.y;
    o.rotation.z = -o.rotation.z;
  });
}

// 1인칭 몸 — 가슴과 다리.
//
// 문서 01 §15. "날아다니는 카메라"가 아니라 **몸을 가진 캐릭터의 시점**이어야 한다.
// 레퍼런스 영상에서도 아래를 보면 다리가 보인다. 팔만 떠 있으면 팔이 어디에
// 붙어 있는지 안 읽혀서, 같은 팔이라도 더 어색해 보인다.
//
// 카메라의 자식으로 달되 고개 각도(pitch)는 되돌린다 — 위를 봐도 다리는 아래에
// 있어야 한다. 그 되돌리기는 부르는 쪽이 poseFpBody 로 한다.
// 1인칭 몸 — 가슴 · 허리 · 골반 · 두 다리(무릎 관절)
//
// 1인칭은 "날아가는 사람의 시야"다. 평소 화면을 채우는 건 팔이지만,
// 고개를 숙이면 내 몸이 보여야 하고, 스윙 최저점을 지날 때는 관성 때문에
// 몸과 다리가 앞으로 쏠리는 게 보여야 한다. 그게 보이면 "카메라가 날아간다"가
// 아니라 "내가 날아간다"가 된다.
//
// 위치 잡기를 세 번 틀렸다. 실제 사람 비율(눈~가슴 35cm)로 놨더니 아래를 볼 때
// 화면이 덩어리로 덮였고, 내리고 뒤로 밀었더니 z 부호를 반대로 넣어 몸이 머리
// 뒤에 달렸다. 지금은 살짝 앞(-Z)·아래에 두고, 굵기를 줄여 시야를 막지 않는다.
//
// 마디를 계층으로 쌓는다. 골반을 돌리면 다리가 같이 가고, 무릎은 그 아래에서
// 접힌다 — 관성 쏠림을 골반 하나로 만들 수 있는 이유다.
//   root(카메라 자식) → chest → waist → pelvis → hip(L/R) → knee → ankle
function makeFpBody() {
  const g = new THREE.Group();

  // ── 회전 중심은 목이다 ──
  //
  // 몸을 카메라 원점(=눈)에서 회전시키면, 고개를 숙일 때 가슴이 시야 **중앙**으로
  // 올라와 화면을 덮는다. 실제로 그렇게 보였다. 사람 머리는 눈이 아니라 목에서
  // 꺾인다 — 목은 눈보다 아래이고 살짝 뒤다. 그 자리를 회전 중심으로 삼으면
  // 고개를 숙일 때 몸이 화면 아래쪽에서 들어온다.
  g.position.set(0, -0.17, 0.09);

  // ── 굵기와 방향 ──
  //
  // 캡슐을 rotation.x = PI/2 로 눕혀놨던 게 두 번째 문제였다. 그러면 캡슐이
  // Z축(=카메라 정면)을 향한 관이 되어, 아래를 볼 때 굵은 원통이 얼굴 쪽으로
  // 튀어나온다. 몸통은 세로(Y)여야 한다. 대신 앞뒤로 눌러서 납작하게 만든다 —
  // 사람 가슴은 원기둥이 아니라 좌우로 넓고 앞뒤로 얇다.
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.20, 5, 12), sleeveMat);
  chest.position.set(0, -0.32, -0.03);
  chest.scale.set(1.25, 1, 0.68);        // 좌우로 넓고 앞뒤로 얇게
  g.add(chest);
  g.userData.chest = chest;

  // 허리 — 가슴보다 얇다. 여기서 몸이 접힌다.
  const waist = new THREE.Group();
  waist.position.set(0, -0.56, -0.02);
  const waistMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.082, 0.14, 4, 10), sleeveMat);
  waistMesh.scale.set(1.2, 1, 0.7);
  waist.add(waistMesh);
  g.add(waist);
  g.userData.waist = waist;

  // 골반 — 다리의 뿌리. 이건 좌우로 넓은 게 맞으니 X축으로 눕힌다.
  const pelvis = new THREE.Group();
  pelvis.position.set(0, -0.20, 0);
  const pelvisMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.088, 0.09, 4, 10), sleeveMat);
  pelvisMesh.rotation.z = Math.PI / 2;
  pelvisMesh.scale.set(1, 1, 0.8);
  pelvis.add(pelvisMesh);
  waist.add(pelvis);
  g.userData.pelvis = pelvis;

  // ── 다리 — 허벅지 / 종아리 / 발 ──
  // 발은 몸과 같은 재질(sleeveMat)로 간다. 장갑 재질(gloveMat)을 쓰니까
  // 거미줄 무늬 판자가 발 대신 떠 있는 것처럼 보였다.
  const legs = [];
  for (const side of [1, -1]) {            // [0]=오른다리(+X), [1]=왼다리
    const hip = new THREE.Group();
    hip.position.set(side * 0.082, -0.05, 0);

    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.076, 0.28, 4, 10), sleeveMat);
    thigh.position.set(0, -0.20, 0);
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.set(0, -0.40, 0);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.060, 0.27, 4, 10), sleeveMat);
    shin.position.set(0, -0.19, 0);
    knee.add(shin);

    const ankle = new THREE.Group();
    ankle.position.set(0, -0.38, 0);
    const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, 0.11, 3, 8), sleeveMat);
    foot.position.set(0, -0.02, -0.06);
    foot.rotation.x = Math.PI / 2;         // 발만은 앞으로 눕는 게 맞다
    foot.scale.set(1, 1, 0.65);
    ankle.add(foot);
    knee.add(ankle);

    hip.add(knee);
    hip.userData.knee = knee;
    hip.userData.ankle = ankle;
    pelvis.add(hip);
    legs.push(hip);
  }
  g.userData.legs = legs;
  return g;
}

// 관성 쏠림 상태. 스프링-댐퍼 하나로 만든다.
//
// 왜 스프링인가: 관성은 "목표를 지나쳤다가 되돌아오는 것"이다. 목표값을 그냥
// 따라가게 하면(lerp) 절대 지나치지 않아서 관성으로 안 보인다. 스프링은
// 감쇠가 약하면 오버슈트하고, 그 오버슈트가 정확히 "쏠림"이다.
// 애니메이션 클립을 만들지 않고 이 느낌을 얻는 가장 싼 방법이다.
function makeBodyInertia() {
  return {
    // 몸통(허리·골반)의 쏠림
    swing: 0, swingV: 0, side: 0, sideV: 0,
    // ★ 다리는 **각각** 자기 스프링을 갖는다.
    //
    // 예전에는 두 다리가 같은 값을 써서 늘 똑같이 움직였다. 그건 다리가 아니라
    // 판자 두 개다. 실제로는 중력과 관성이 각 다리에 따로 걸리고, 두 진자는
    // 유효 길이와 감쇠가 조금만 달라도 영원히 위상이 안 맞는다.
    // 그래서 강성·감쇠를 일부러 다르게 주고, 초기값도 살짝 어긋나게 둔다.
    legs: [
      { sw: 0, v: 0, sd: 0, sdv: 0, k: 9.6, d: 3.10 },   // 오른다리
      { sw: 0.08, v: 0, sd: 0, sdv: 0, k: 8.2, d: 3.65 },  // 왼다리 — 조금 무겁고 더 감쇠
    ],
  };
}

// 스프링 한 스텝. k=강성, d=감쇠(1보다 작으면 오버슈트한다)
function spring(cur, vel, target, k, d, dt) {
  const a = (target - cur) * k - vel * d;
  const v = vel + a * dt;
  return [cur + v * dt, v];
}

// 몸을 자세에 맞춘다.
//
//   pitch   카메라 고개 각도 (되돌려서 몸은 세계 기준으로 서 있게)
//   ctx     { run, air, lean, fwdAcc, upVel, ropeBack, grounded, t }
//     run       달리는 정도 0..1   — 다리가 번갈아 나온다
//     air       공중에 뜬 정도 0..1 — 다리를 접는다
//     lean      좌우 기울기 -1..1
//     fwdAcc    진행 방향 가속도 (m/s^2). 줄이 당기면 음수(감속) → 다리가 앞으로 쏠린다
//     upVel     수직 속도 (m/s)      — 솟구치면 다리가 앞·위로 올라간다
//     ropeBack  줄이 등 뒤로 넘어간 정도 0..1 — 최저점을 지났다는 신호
//     grounded  발이 땅에 있는가
//     t         시간 (걷기 위상)
//   ine     makeBodyInertia() 로 만든 상태 객체 (프레임 간 유지)
function poseFpBody(g, pitch, ctx, ine, dt) {
  // 고개를 숙이면 몸이 시야에 들어와야 한다. 몸은 카메라의 자식이라, 카메라가
  // 숙인 만큼 되돌려야(= -pitch) 몸이 세계 기준으로 똑바로 선다.
  g.rotation.x = -pitch;
  g.rotation.z = -(ctx.lean || 0) * 0.35;

  const legs = g.userData.legs;
  if (!legs) return;
  const dtc = Math.min(0.05, dt || 1 / 60);

  // ── 관성 목표 ──
  // 줄이 당기면 몸통은 뒤에 남고 다리가 앞으로 나간다. 최저점을 지나 줄이
  // 등 뒤로 넘어가면 그 쏠림이 가장 커진다 — 레퍼런스에서 다리가 하늘을
  // 향해 뻗는 컷이 그 순간이다.
  const acc = Math.max(-1, Math.min(1, -(ctx.fwdAcc || 0) / 45));
  const rise = Math.max(-1, Math.min(1, (ctx.upVel || 0) / 30));
  let swingTarget = ctx.grounded ? 0
    : acc * 0.55 + rise * 0.45 + (ctx.ropeBack || 0) * 0.60;
  swingTarget = Math.max(-0.5, Math.min(1.15, swingTarget));

  // 강성 9 / 감쇠 3.4 — 임계 이하라 살짝 지나쳤다 돌아온다. 그게 관성이다.
  [ine.swing, ine.swingV] = spring(ine.swing, ine.swingV, swingTarget, 9, 3.4, dtc);
  [ine.side, ine.sideV] = spring(ine.side, ine.sideV, (ctx.lean || 0) * 0.5, 11, 4.0, dtc);

  // 다리는 각자 따로 적분한다.
  //
  // 두 다리에 같은 목표를 주되, 강성·감쇠가 달라서 반응 속도와 오버슈트가
  // 갈린다. 거기에 좌우 기울기를 반대 부호로 얹는다 — 도는 쪽 바깥 다리가
  // 더 크게 흔들리는 게 실제 모습이다.
  // 공중에서는 중력이 다리를 아래로 당기므로 목표를 살짝 내린다(-0.12).
  const grav = ctx.grounded ? 0 : -0.12;
  for (let i = 0; i < ine.legs.length; i++) {
    const s = i === 0 ? 1 : -1;
    const L = ine.legs[i];
    const tgt = swingTarget + grav + (ctx.lean || 0) * s * 0.22;
    const r1 = spring(L.sw, L.v, tgt, L.k, L.d, dtc);
    L.sw = r1[0]; L.v = r1[1];
    const r2 = spring(L.sd, L.sdv, (ctx.lean || 0) * s * 0.35, L.k * 1.15, L.d * 1.1, dtc);
    L.sd = r2[0]; L.sdv = r2[1];
  }

  // 몸통도 같이 접힌다. 다리만 움직이면 하반신만 따로 노는 것처럼 보인다.
  const fold = Math.max(0, ine.swing);
  g.userData.waist.rotation.x = fold * 0.30;
  g.userData.waist.rotation.z = ine.side * 0.18;
  g.userData.pelvis.rotation.x = fold * 0.22;

  const step = (ctx.t || 0) * 9;
  const run = ctx.run || 0, air = ctx.air || 0;
  for (let i = 0; i < legs.length; i++) {
    const s = i === 0 ? 1 : -1;            // +1 오른다리 / -1 왼다리
    const hip = legs[i], knee = hip.userData.knee, ankle = hip.userData.ankle;

    // 지상: 좌우 번갈아 걷는다. 공중: 각자 자기 관성으로 흔들린다.
    const gait = Math.sin(step + (i ? Math.PI : 0)) * run * 0.55;
    const L = ine.legs[i];

    // 골반 굽힘 = 걷기 + 공중 기본자세 + 관성 쏠림
    // 상한을 둔다. 안 두면 최고점에서 발이 가슴까지 올라와 화면을 덮는다.
    hip.rotation.x = Math.min(1.25, gait + air * 0.55 + L.sw * 0.85);
    hip.rotation.z = s * (0.05 + air * 0.09) + L.sd * 0.30;

    // ── 무릎 방향 ──
    //
    // 사람 무릎은 **뒤로만** 접힌다. 앞으로 꺾이면 부러진 것이다.
    // Three.js 에서 rotation.x 양수는 -Y(아래)를 -Z(앞)로 보낸다. 즉 양수를
    // 주면 정강이가 앞으로 튀어나가 무릎이 반대로 꺾인다 — 실제로 그렇게
    // 보였고, 그래서 다리가 곧은 막대처럼 렌더됐다.
    // 굽힘량(bend)은 항상 0 이상으로 계산하고, 부호는 여기서 한 번만 뒤집는다.
    const bend = Math.max(0, -gait * 0.8)              // 뒤로 간 다리를 접는다
               + air * 0.85                            // 공중에서는 접고 있다
               + Math.max(0, L.sw) * 0.55;             // 앞으로 쏠리면 더 접힌다
    knee.rotation.x = -Math.min(1.55, bend);

    // 발목. 무릎이 접힌 만큼 발끝을 펴준다(포인). 없으면 발이 정강이에
    // 못박힌 판자로 보인다.
    ankle.rotation.x = Math.min(1.55, bend) * 0.30 + (ctx.grounded ? 0 : 0.20);
  }
}

// 손 포즈. spider=1이면 중지·약지를 접은 웹슈팅 자세, grip=1이면 벽 짚는 자세.
function poseHand(h, spider, grip, splay, fire, k) {
  const f = h.userData.fingers;
  const curl = h.userData.curl;
  for (let i = 0; i < 4; i++) {
    const isFolded = (i === 1 || i === 2);
    // 웹슈팅: 중지·약지만 손바닥으로 말아 넣는다
    // 뿌리 1.75 + 끝마디 1.66 = 약 195도. 손끝이 손바닥 위에 얹힌다 (더 굽히면 뚫고 들어간다).
    const sp = isFolded ? 1.75 + fire * 0.3 : 0.06;
    // 벽 짚기: 네 손가락 모두 적당히 구부려 표면을 움켜쥔다
    const gr = 0.85 + (isFolded ? 0.12 : 0.05);
    const target = sp * spider + gr * grip;
    curl[i] += (target - curl[i]) * k;
    f[i].rotation.x = curl[i];
    f[i].rotation.z = (i - 1.5) * 0.055 * splay;
    f[i].userData.mid.rotation.x = curl[i] * (isFolded ? 0.95 : 0.35);
  }
  h.userData.thumb.rotation.x = 0.35 + grip * 0.5 + fire * 0.2;
}

export {
  makeUpperArm, linkUpperArm, mirrorInPlace, makeFpBody, poseFpBody, makeBodyInertia,
  makeFinger,
  makeHand,
  poseHand,
  initHands,
};
