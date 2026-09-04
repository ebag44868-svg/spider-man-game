// 각도와 선분 계산. 게임 상태를 전혀 모르는 순수 함수만 모았다.
//
// game3d.js에서 그대로 옮겨온 코드다. 내용은 한 줄도 바꾸지 않았다.
// scene / player / enemies 어느 것도 참조하지 않고, 넘겨받은 값으로만 계산한다.
// THREE는 임시 벡터(Vector3)를 만드는 데만 쓴다.
//
// 참고: Vector3는 uuid를 만들지 않아 Math.random()을 소비하지 않는다.
// (재질·지오메트리·Object3D는 소비한다 — src/vfx.js의 initVfx 주석 참고)

// 브라우저는 importmap으로 "three"를 이 파일로 보낸다. 여기서는 상대경로를 직접 쓴다 —
// 테스트 하네스(Node)에는 importmap이 없고, 어차피 같은 파일로 해석되어 인스턴스도 하나다.
import * as THREE from "../lib/three.module.js";

// 주의: 아래 임시 벡터들은 segHitsSphere 전용이다.
// 호출자의 step 벡터와 같은 객체를 쓰면 내부에서 정규화하는 순간 step이 덮어써져
// 탄이 프레임당 1m만 전진하는 버그가 생긴다.
const _s0 = new THREE.Vector3(), _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3();

// 이동 선분 vs 구. 빠른 투사체가 프레임 사이에 적을 통과해버리는 걸 막는다.
function segHitsSphere(p0, step, c, r) {
  const len = step.length();
  if (len < 1e-6) return p0.distanceTo(c) <= r;
  const d = _s0.copy(step).divideScalar(len);
  const t = Math.max(0, Math.min(len, _s1.copy(c).sub(p0).dot(d)));
  return _s2.copy(p0).addScaledVector(d, t).distanceTo(c) <= r;
}

// 선분(p0 -> p0+step)이 축정렬 박스를 지나는 첫 지점의 t(0..1). 안 지나면 -1.
function segBoxT(p, d, x0, y0, z0, x1, y1, z1) {
  // 시작점이 이미 박스 안이면 무시한다. 1인칭 총구는 벽에 살짝 파고들 수 있는데,
  // 그걸 명중으로 치면 벽에 붙어 있는 동안 쏘는 족족 총구에서 터진다.
  if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1 && p.z > z0 && p.z < z1) return -1;
  let tmin = 0, tmax = 1;
  // x
  if (Math.abs(d.x) < 1e-9) { if (p.x < x0 || p.x > x1) return -1; }
  else {
    let a = (x0 - p.x) / d.x, b = (x1 - p.x) / d.x;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > tmin) tmin = a;
    if (b < tmax) tmax = b;
    if (tmin > tmax) return -1;
  }
  // y
  if (Math.abs(d.y) < 1e-9) { if (p.y < y0 || p.y > y1) return -1; }
  else {
    let a = (y0 - p.y) / d.y, b = (y1 - p.y) / d.y;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > tmin) tmin = a;
    if (b < tmax) tmax = b;
    if (tmin > tmax) return -1;
  }
  // z
  if (Math.abs(d.z) < 1e-9) { if (p.z < z0 || p.z > z1) return -1; }
  else {
    let a = (z0 - p.z) / d.z, b = (z1 - p.z) / d.z;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > tmin) tmin = a;
    if (b < tmax) tmax = b;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

// 각도 차를 -PI..PI로 접는다. 시점이 한 바퀴 돌 때 스웨이가 튀지 않게.
function shortAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export {
  segHitsSphere,
  segBoxT,
  shortAngle,
  lerpAngle,
};
