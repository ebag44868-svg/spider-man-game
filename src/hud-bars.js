// 적 머리 위 체력바와 체간바.
//
// 적이 200명이 넘으므로 개별 메시로 만들면 드로우콜이 터진다.
// 인스턴스 두 장(바탕 + 채움)으로 가까운 적만 그린다.
//
// game3d.js에서 그대로 옮겨온 코드다. mkBar / putBar / updateHpBars 세 함수는
// 한 줄도 바꾸지 않았다. 바꾼 것은 두 가지뿐이다.
//   · 지오메트리와 인스턴스 메시 4장 생성을 initHpBars() 안으로 모았다
//   · scene / camera / enemies / player 를 import 대신 주입받는다
//     (import하면 game3d.js와 순환 참조가 된다)
//
// 생성 순서는 원래와 똑같다. initHpBars()를 game3d.js가 원래 이것들을 만들던
// 바로 그 자리에서 부르기 때문이다. THREE 객체는 만들 때마다 uuid를 뽑느라
// Math.random()을 소비하므로, 순서가 한 칸만 밀려도 도시와 적 구성이 통째로
// 달라진다 (tools/check-rng.mjs 가 그걸 감시한다).
//
// 아래 임시 Matrix4/Vector3/Quaternion/Color는 uuid를 만들지 않아
// 모듈 최상위에 둬도 난수에 영향이 없다.

// 브라우저는 importmap으로 "three"를 이 파일로 보낸다. 여기서는 상대경로를 직접 쓴다 —
// 테스트 하네스(Node)에는 importmap이 없고, 어차피 같은 파일로 해석되어 인스턴스도 하나다.
import * as THREE from "../lib/three.module.js";

// game3d.js에서 주입받는다. 넷 다 재대입되지 않는 객체라 참조만 들고 있으면 된다.
let scene = null, camera = null, enemies = null, player = null;
let _hbGeo = null;
// 바탕 -> 체력(붉은) -> 체간 바탕 -> 체간(노란) 순으로 겹쳐 그린다.
// let 이지만 export는 살아 있는 바인딩이라, game3d.js도 대입된 뒤의 값을 본다.
let hpBarBg = null, hpBarFill = null, psBarBg = null, psBarFill = null;

// game3d.js가 원래 이 오브젝트들을 만들던 그 자리에서 한 번 부른다.
function initHpBars(sc, cam, enemyList, pl) {
  scene = sc;
  camera = cam;
  enemies = enemyList;
  player = pl;
  _hbGeo = new THREE.PlaneGeometry(1, 1);
  hpBarBg   = mkBar(0x0a0d12, 0.62); hpBarBg.renderOrder = 5;
  hpBarFill = mkBar(null,     0.95); hpBarFill.renderOrder = 6;
  psBarBg   = mkBar(0x0a0d12, 0.5);  psBarBg.renderOrder = 5;
  psBarFill = mkBar(null,     0.95); psBarFill.renderOrder = 6;
}

const HPBAR_MAX = 48;        // 동시에 그릴 최대 개수 (상시 표시라 늘렸다)
const HPBAR_RANGE = 110;     // 이 거리 안의 적만
const HPBAR_W = 3.2, HPBAR_H = 0.34;
const POSTBAR_H = 0.20;      // 체간바는 체력바보다 얇게 — 한눈에 구분된다
function mkBar(color, opacity) {
  const m = new THREE.InstancedMesh(_hbGeo,
    new THREE.MeshBasicMaterial(color === null
      ? { transparent: true, opacity, depthWrite: false }
      : { color, transparent: true, opacity, depthWrite: false }), HPBAR_MAX);
  m.frustumCulled = false; m.count = 0;
  scene.add(m);
  return m;
}
const _hbM = new THREE.Matrix4(), _hbP = new THREE.Vector3(), _hbP2 = new THREE.Vector3();
const _hbQ = new THREE.Quaternion(), _hbS = new THREE.Vector3(), _hbR = new THREE.Vector3();
const _hbC = new THREE.Color();
// 한 줄(바탕 + 채움)을 인스턴스에 써 넣는다. 채움은 왼쪽 정렬이라
// 줄어든 만큼 카메라 기준 왼쪽으로 밀어야 가운데서 줄지 않는다.
function putBar(bg, fill, i, cx, cy, cz, w, h, ratio, col) {
  _hbP.set(cx, cy, cz);
  _hbM.compose(_hbP, _hbQ, _hbS.set(w, h, 1));
  bg.setMatrixAt(i, _hbM);
  const r = Math.max(0, Math.min(1, ratio));
  _hbP2.copy(_hbP).addScaledVector(_hbR, -w * (1 - r) * 0.5);
  _hbM.compose(_hbP2, _hbQ, _hbS.set(Math.max(0.001, w * r), h * 0.66, 1));
  fill.setMatrixAt(i, _hbM);
  fill.setColorAt(i, col);
}

function updateHpBars() {
  let n = 0;
  _hbQ.copy(camera.quaternion);
  _hbR.set(1, 0, 0).applyQuaternion(_hbQ);          // 카메라 기준 오른쪽 — 왼쪽 정렬에 쓴다
  for (const e of enemies) {
    if (n >= HPBAR_MAX) break;
    if (e.dead) continue;
    if (e.g.position.distanceTo(player.pos) > HPBAR_RANGE) continue;
    const maxHp = e.ty.hp || 1;
    const hr = Math.max(0, Math.min(1, e.hp / maxHp));
    const pr = e.postMax ? Math.max(0, Math.min(1, (e.post || 0) / e.postMax)) : 0;

    // 적마다 덩치가 다르다(격투병 1.3배). 그만큼 위로 올려야 머리 위에 뜬다 —
    // 고정값이었을 때는 큰 적일수록 바가 몸 속에 파묻혀 안 보였다.
    const sc = e.g.scale.x || 1;
    const barY = e.g.position.y + 8.4 * sc;
    // 멀어지면 화면에서 작아져 안 읽힌다. 거리에 따라 조금 키운다.
    const dCam = camera.position.distanceTo(e.g.position);
    const gz = 1 + Math.min(1.1, dCam / 90);

    // 체력바 — 상시 붉은색. 체간이 무너지면 하얗게 (지금 처형 가능하다는 신호)
    if (e.stag > 0) _hbC.setRGB(1, 1, 1);
    else _hbC.setRGB(0.95, 0.13, 0.15);
    putBar(hpBarBg, hpBarFill, n, e.g.position.x, barY, e.g.position.z,
           HPBAR_W * gz, HPBAR_H * gz, hr, _hbC);

    // 체간바 — 체력바 바로 아래, 더 얇게. 노랑에서 붕괴가 가까울수록 하얘진다.
    if (e.stag > 0) _hbC.setRGB(1, 1, 1);
    else _hbC.setRGB(1, 0.78 + pr * 0.2, 0.25 + pr * 0.6);
    putBar(psBarBg, psBarFill, n, e.g.position.x, barY - (HPBAR_H + POSTBAR_H) * 0.75 * gz, e.g.position.z,
           HPBAR_W * 0.86 * gz, POSTBAR_H * gz, e.stag > 0 ? 1 : pr, _hbC);
    n++;
  }
  for (const m of [hpBarBg, hpBarFill, psBarBg, psBarFill]) {
    m.count = n;
    if (n > 0) {
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }
}

export {
  initHpBars, updateHpBars, mkBar, putBar,
  HPBAR_MAX, HPBAR_RANGE, HPBAR_W, HPBAR_H, POSTBAR_H,
  hpBarBg, hpBarFill, psBarBg, psBarFill,
};
