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
  if (mirror) g.scale.x = -1;
  g.visible = false;
  return g;
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
  makeFinger,
  makeHand,
  poseHand,
  initHands,
};
