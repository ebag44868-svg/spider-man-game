// 손이 닿아야 할 곳 — reachTarget
//
// 이 파일은 손이 어떻게 생겼는지 모른다. 지금 손은 셰이더로 깎은 캡슐 덩어리지만,
// 나중에 Fab이나 다른 모델링을 가져와 뼈로 갈아끼워도 이 파일은 손댈 데가 없다.
// 여기서 내놓는 것은 "카메라 기준으로 어느 쪽을, 얼마나 뻗어서, 어떤 위상으로
// 잡고 있는가" 하나뿐이고, 그 값을 무엇에 먹일지는 부르는 쪽이 정한다.
//
// 위상은 문서 01 §8 그대로다.
//   SHOOT   손이 목표를 향해 나간다. 손가락을 편다.
//   CATCH   줄이 걸린 직후의 짧은 반동. 손이 닫힌다.
//   HOLD    잡고 있는 동안. 목표를 계속 따라본다.
//   RELEASE 놓고 기본 자세로 돌아온다.
//
// 목표가 바뀌었는지는 이 파일이 스스로 본다. 부르는 쪽은 매 프레임 "지금 이 손의
// 목표는 여기"라고만 알려주면 되고, 발사/포착 이벤트를 따로 쏠 필요가 없다.
// 게임플레이 코어에 훅을 박지 않으려는 것이다 — 물리는 한 줄도 안 건드린다.
import * as THREE from "../lib/three.module.js";

const SHOOT_T = 0.10;   // 뻗어나가는 시간
const CATCH_T = 0.13;   // 걸린 직후 반동
const REL_T   = 0.20;   // 놓고 되돌아오는 시간
// 팔이 돌아갈 수 있는 한계. 안 걸면 등 뒤 앵커를 향해 어깨가 뒤집힌다.
//
// 각도를 그대로 쓰다가 한계에서 뚝 자르면 팔이 꺾인 것처럼 보인다. tanh로 눌러
// 커질수록 완만하게 포화시킨다 — 작은 각도는 거의 그대로, 큰 각도는 서서히 멈춘다.
//
// 사람 어깨는 좌우가 대칭이 아니다. 바깥(몸에서 멀어지는 쪽)으로는 크게 벌어지지만
// 안쪽(몸을 가로지르는 쪽)으로는 얼마 못 간다. 한 값으로 두면 오른팔이 왼쪽
// 앵커를 향할 때 가슴을 뚫고 지나가는 그림이 나온다 — 실제로 그렇게 보였다.
const YAW_OUT   = 1.00;   // 바깥쪽 (오른손이 오른쪽을 볼 때)
const YAW_IN    = 0.42;   // 안쪽 (몸을 가로지른다)
const PITCH_UP  = 1.05;   // 위로는 잘 올라간다
const PITCH_DN  = 0.60;   // 아래로는 겨드랑이가 막는다
const YAW_MAX   = YAW_OUT;
const PITCH_MAX = PITCH_UP;
function soft(a, max) { return max * Math.tanh(a / max); }

let camera = null;
const _v = new THREE.Vector3();

// 한 손의 상태. 좌우가 완전히 독립이라 나중에 양손 웹으로 갈 때 그대로 쓴다.
function mkSide() {
  return {
    p: new THREE.Vector3(),   // 목표 월드 좌표
    has: false,               // 지금 목표가 있는가
    kind: "",                 // 'web' | 'wall' | 'target' — 부르는 쪽이 의미를 붙인다
    phase: "idle",
    t: 0,
    on: 0,                    // 기본 자세(0) ↔ 목표를 향한 자세(1)
    yaw: 0, pitch: 0, dist: 0,
    fire: 0,                  // 쏘는 순간 (손가락 폄)
    grip: 0,                  // 움켜쥠
    kick: 0,                  // 걸린 순간의 반동
  };
}
const sides = { R: mkSide(), L: mkSide() };

function initReach(cam) { camera = cam; }

// 매 프레임 부른다. point가 null이면 "이 손은 지금 잡은 게 없다".
// 같은 자리를 계속 주면 HOLD가 유지되고, 다른 자리를 주면 새로 쏜다.
function setReach(side, point, kind) {
  const s = sides[side];
  if (!s) return;
  if (!point) {
    if (s.has) { s.has = false; s.phase = "release"; s.t = 0; }
    return;
  }
  // 목표가 크게 옮겨갔으면 새 발사로 친다. 같은 앵커의 미세한 흔들림은 무시한다.
  const moved = !s.has || s.p.distanceToSquared(point) > 4;
  s.p.copy(point);
  s.kind = kind || "web";
  if (moved) { s.has = true; s.phase = "shoot"; s.t = 0; }
  else s.has = true;
}

function clearReach(side) { setReach(side, null); }

// 위상을 진행시키고, 목표를 카메라 기준 방향으로 환산한다.
function updateReach(dt) {
  // 카메라의 월드 행렬을 먼저 최신으로 만든다.
  // 이 함수는 렌더 '전'에 불리고, three는 렌더 시점에야 행렬을 갱신한다.
  // 안 해주면 한 프레임 전(심하면 초기) 행렬로 좌표를 환산해서 방향이 통째로
  // 틀어진다 — 실제로 77m 앵커의 거리가 850m로 나왔다.
  if (camera) camera.updateMatrixWorld();
  for (const k of ["R", "L"]) {
    const s = sides[k];
    s.t += dt;

    if (s.phase === "shoot" && s.t >= SHOOT_T) { s.phase = "catch"; s.t = 0; }
    else if (s.phase === "catch" && s.t >= CATCH_T) { s.phase = "hold"; s.t = 0; }
    else if (s.phase === "release" && s.t >= REL_T) { s.phase = "idle"; s.t = 0; }

    // 목표를 향한 정도. 쏘는 동안 빠르게 차오르고, 놓으면 천천히 빠진다.
    const want = s.has ? 1 : 0;
    const rate = s.has ? 18 : 6;
    s.on += (want - s.on) * Math.min(1, rate * dt);

    // 연출값
    s.fire = s.phase === "shoot" ? 1 - s.t / SHOOT_T : 0;
    s.kick = s.phase === "catch" ? 1 - s.t / CATCH_T : 0;
    // 걸린 뒤에는 움켜쥔다. 쏘는 동안은 편다.
    const gripWant = s.has && (s.phase === "hold" || s.phase === "catch") ? 1 : 0;
    s.grip += (gripWant - s.grip) * Math.min(1, 14 * dt);

    if (s.on < 0.001 || !camera) { s.yaw = s.pitch = 0; s.dist = 0; continue; }

    // 월드 목표를 카메라 로컬로. 카메라 정면은 -Z다.
    _v.copy(s.p);
    camera.worldToLocal(_v);
    s.dist = _v.length();
    if (s.dist < 0.01) { s.yaw = s.pitch = 0; continue; }
    // 어느 쪽이 바깥인가는 손마다 다르다. 오른손은 +yaw 가 바깥이다.
    const rawYaw = Math.atan2(_v.x, -_v.z);
    const outward = (k === "R") === (rawYaw >= 0);
    const rawPitch = Math.atan2(_v.y, Math.hypot(_v.x, _v.z));
    s.yaw = soft(rawYaw, outward ? YAW_OUT : YAW_IN);
    s.pitch = soft(rawPitch, rawPitch >= 0 ? PITCH_UP : PITCH_DN);
  }
}

function getReach(side) { return sides[side]; }

// 팔 하나에 결과를 얹는다. 기본 자세는 부르는 쪽이 이미 세팅해 둔 상태고,
// 여기서는 그 위에 "목표 쪽으로 돌리는 양"만 더한다. 그래서 기존 연출
// (바람에 밀림 · 장력 떨림 · 재장전)이 전부 살아 있는 채로 방향만 붙는다.
//
// arm.rotation 규칙: 팔이 가리키는 축은 -Z다.
//   Ry(θ)·(0,0,-1) = (-sinθ, 0, -cosθ)  →  오른쪽(+X)을 보려면 θ = -yaw
//   Rx(φ)·(0,0,-1) = (0, sinφ, -cosφ)   →  위(+Y)를 보려면  φ = +pitch
// mirror: 왼손 모델은 scale.x 가 음수라 좌우가 뒤집혀 그려진다. 회전을 그대로
// 더하면 화면에서는 반대로 돈다 — 왼팔이 기괴하게 꺾여 보인 진짜 이유다.
// 뒤집힌 팔에는 y·z 회전의 부호를 같이 뒤집는다.
function applyReach(arm, side, strength) {
  const s = sides[side];
  const k = s.on * (strength === undefined ? 1 : strength);
  if (k < 0.001) return s;
  const mir = arm.scale && arm.scale.x < 0 ? -1 : 1;
  arm.rotation.y += -s.yaw * k * mir;
  arm.rotation.x += s.pitch * k;
  // 회전만으로 목표를 좇으면 어깨가 제자리에서 비틀린다. 어깨 자체도 목표 쪽으로
  // 조금 옮겨야 "몸을 튼다"로 보인다 — 이게 없으면 큰 각도에서 팔만 꺾인다.
  arm.position.x += Math.sin(s.yaw) * 0.12 * k;
  arm.position.y += Math.sin(s.pitch) * 0.10 * k;
  // 쏘는 순간과 잡히는 순간에 어깨가 앞뒤로 반응한다. 이게 없으면 팔만 돌아가고
  // 몸이 가만히 있어서 "닿았다"가 아니라 "가리킨다"로 보인다.
  arm.position.z -= (s.fire * 0.10 - s.kick * 0.06) * k;
  arm.position.y += s.kick * 0.03 * k;
  return s;
}

export { initReach, setReach, clearReach, updateReach, getReach, applyReach, soft,
         SHOOT_T, CATCH_T, REL_T, YAW_MAX, PITCH_MAX, YAW_OUT, YAW_IN, PITCH_UP, PITCH_DN };
