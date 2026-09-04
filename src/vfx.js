// 타격 연출. 튀는 알갱이와 퍼져나가는 충격 링.
//
// game3d.js에서 그대로 옮겨온 코드다. 함수 본문은 한 줄도 바꾸지 않았다.
// 게임 로직은 모르고, "이 지점에 이런 종류의 타격이 있었다"만 받아서 그린다.
//
// scene / camera / IMPACT / partGeo / particles 는 import 하면 game3d.js와
// 순환 참조가 되므로 initVfx()로 참조만 넘겨받는다. 새로 만들지 않는다 —
// 이유는 아래 initVfx 주석 참고.

// 브라우저는 importmap으로 "three"를 이 파일로 보낸다. 여기서는 상대경로를 직접 쓴다 —
// 테스트 하네스(Node)에는 importmap이 없고, 어차피 같은 파일로 해석되어 인스턴스도 하나다.
import * as THREE from "../lib/three.module.js";

let scene = null, camera = null;
let IMPACT = null, partGeo = null, particles = null;
const impactRings = [];   // 퍼져나가는 충격파 링. 풀에서 돌려 쓴다.

// game3d.js가 원래 링 풀을 만들던 그 자리에서 한 번 부른다.
//
// 오브젝트를 여기서 새로 만들지 않고 game3d.js가 만든 것을 넘겨받는다.
// THREE는 재질·지오메트리를 만들 때마다 UUID를 뽑느라 Math.random()을
// 여러 번 소비한다. 테스트 하네스는 시드 난수를 game3d.js 본문 맨 위에서
// 심으므로, 생성 위치가 한 줄이라도 옮겨지면 난수 순서가 밀려 도시와 적
// 구성이 통째로 달라진다. 실제로 겪었다 — 적 구성이
// (사수 92·저격수 42·돌격병 43·격투병 39) 에서
// (사수 83·격투병 41·돌격병 46·저격수 46) 으로 바뀌어 테스트가 깨졌다.
// 그래서 IMPACT / partGeo / particles 는 game3d.js의 원래 자리에 그대로 두고
// 참조만 받아온다.
function initVfx(sc, cam, impactTable, particleGeo, particleList) {
  scene = sc;
  camera = cam;
  IMPACT = impactTable;
  partGeo = particleGeo;
  particles = particleList;
  const ringGeo = new THREE.RingGeometry(0.55, 1, 20);
  for (let i = 0; i < 10; i++) {
    const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide,
      depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
    m.visible = false;
    m.frustumCulled = false;
    scene.add(m);
    impactRings.push({ m, t: 0, size: 1 });
  }
}

function spawnRing(p, color, size) {
  const r = impactRings.find(x => !x.m.visible);
  if (!r) return;
  r.m.visible = true;
  r.m.position.copy(p);
  r.m.material.color.setHex(color);
  r.t = 1;
  r.size = size;
}

function updateRings(dt) {
  for (const r of impactRings) {
    if (!r.m.visible) continue;
    r.t -= dt * 4.5;
    if (r.t <= 0) { r.m.visible = false; continue; }
    const k = 1 - r.t;                       // 0 -> 1
    r.m.scale.setScalar((0.6 + k * 5.5) * r.size);
    r.m.material.opacity = r.t * 0.85;
    r.m.lookAt(camera.position);             // 항상 화면을 향하게
  }
}

// kind: 'wall' | 'hit' | 'kill' | 'web'
function spawnImpact(p, n, kind) {
  const d = IMPACT[kind] || IMPACT.wall;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, d.mat);
    m.position.copy(p);
    // 크기를 흩뿌려야 알갱이가 뭉쳐 보이지 않는다
    m.scale.setScalar((0.7 + Math.random() * 0.9) * d.size);
    scene.add(m);
    particles.push({
      m, life: 0.28 + Math.random() * 0.22,
      v: new THREE.Vector3((Math.random() - 0.5) * d.spread,
                          (Math.random() - 0.15) * d.spread * 0.85,
                          (Math.random() - 0.5) * d.spread)
    });
  }
  spawnRing(p, d.ring, d.size);
}

export {
  spawnRing,
  updateRings,
  spawnImpact,
  initVfx,
  impactRings,
};
