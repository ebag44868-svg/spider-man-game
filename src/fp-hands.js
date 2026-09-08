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
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.095, 1, 10), sleeveMat);
  m.rotation.x = -Math.PI / 2;
  m.position.z = -0.5;
  g.add(m);
  return g;
}

// 어깨와 팔꿈치를 잇는다. 게임 상태를 안 본다 — 팔의 현재 변환만 읽는다.
// elbowZ = 팔 로컬에서 팔꿈치가 있는 자리(전완 뒤끝). 팔이 뒤집힌 왼손도 z는 그대로다.
const _elbow = new THREE.Vector3(), _dir = new THREE.Vector3();
const _FWD = new THREE.Vector3(0, 0, -1);
function linkUpperArm(up, arm, shoulder, elbowZ) {
  up.visible = arm.visible;
  if (!arm.visible) return;
  _elbow.set(0, 0, (elbowZ === undefined ? 0.40 : elbowZ) * Math.abs(arm.scale.z))
        .applyEuler(arm.rotation).add(arm.position);
  up.position.copy(shoulder);
  _dir.copy(_elbow).sub(shoulder);
  const len = _dir.length();
  if (len < 1e-4) { up.visible = false; return; }
  up.quaternion.setFromUnitVectors(_FWD, _dir.divideScalar(len));
  up.scale.set(1, 1, len);
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
function makeFpBody() {
  const g = new THREE.Group();

  // 눈에서 가슴까지가 실제로는 35cm 남짓이다. 그대로 두면 아래를 볼 때 화면을
  // 통째로 덮는다 — 처음에 그렇게 만들었다가 빨간 덩어리가 화면을 가렸다.
  // 게임들이 하는 대로 조금 내리고 뒤로 밀어 시야를 비운다.
  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.165, 0.24, 4, 10), sleeveMat);
  chest.position.set(0, -0.60, 0.10);
  chest.rotation.x = Math.PI / 2;
  g.add(chest);

  const belly = new THREE.Mesh(new THREE.CapsuleGeometry(0.128, 0.20, 4, 10), sleeveMat);
  belly.position.set(0, -0.90, 0.12);
  belly.rotation.x = Math.PI / 2;
  g.add(belly);

  // 다리 — 허벅지와 종아리 두 마디. 무릎에서 접힌다.
  const legs = [];
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(side * 0.115, -1.06, 0.12);
    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.085, 0.32, 4, 10), sleeveMat);
    thigh.position.set(0, -0.22, 0);
    hip.add(thigh);
    const knee = new THREE.Group();
    knee.position.set(0, -0.44, 0);
    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.070, 0.30, 4, 10), gloveMat);
    shin.position.set(0, -0.21, 0);
    knee.add(shin);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.115, 0.06, 0.22), gloveMat);
    foot.position.set(0, -0.42, -0.05);
    knee.add(foot);
    hip.add(knee);
    hip.userData.knee = knee;
    g.add(hip);
    legs.push(hip);
  }
  g.userData.legs = legs;
  return g;
}

// 몸을 자세에 맞춘다.
//   pitch    카메라 고개 각도 (되돌려서 몸은 서 있게)
//   run      달리는 정도 0..1 (다리가 번갈아 나온다)
//   air      공중에 뜬 정도 0..1 (다리를 접는다 — 스윙 자세)
//   lean     좌우 기울기
function poseFpBody(g, pitch, run, air, lean, t) {
  // 고개를 들어도 몸은 서 있는다. 다만 절반만 되돌려서 완전히 뻣뻣하진 않게.
  g.rotation.x = -pitch * 0.82;
  g.rotation.z = -lean * 0.35;
  const legs = g.userData.legs;
  if (!legs) return;
  const step = t * 9;
  for (let i = 0; i < legs.length; i++) {
    const s = i === 0 ? 1 : -1;
    const hip = legs[i], knee = hip.userData.knee;
    // 공중에서는 두 다리를 접어 뒤로 당긴다 (스윙 자세). 지상에서는 번갈아 걷는다.
    const swing = Math.sin(step + (i ? Math.PI : 0)) * run * 0.55;
    hip.rotation.x = swing + air * 0.75 + pitch * 0.18;
    hip.rotation.z = s * (0.04 + air * 0.10);
    knee.rotation.x = Math.max(0, -swing * 0.8) + air * 0.95;
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
  makeUpperArm, linkUpperArm, mirrorInPlace, makeFpBody, poseFpBody,
  makeFinger,
  makeHand,
  poseHand,
  initHands,
};
