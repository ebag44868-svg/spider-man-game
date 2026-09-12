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
// 팔이 돌아갈 수 있는 한계.
//
// ★ 팔이 꺾여 보인 진짜 이유가 여기 있었다.
//
// 예전 값은 바깥쪽 1.00rad(57도)였다. 그런데 스윙은 본질적으로 **앵커를
// 지나쳐 가는 운동**이다. 최저점을 지나면 줄은 등 뒤로 140~170도까지 넘어간다.
// 그걸 57도로 눌러버리니, 줄은 뒤로 가는데 팔은 옆을 보고 있었다. 손목에
// 줄이 붙어 있으니 그 어긋남이 "팔이 접힌다"로 보였다.
//
// 실제 사람은 줄을 잡은 팔을 **귀 뒤로 넘긴다.** 그리고 그 순간 팔은
// 시야에서 사라진다. 1인칭은 날아가는 사람의 시야지, 팔을 보여주는 화면이
// 아니다. 팔이 화면 밖으로 나가는 건 버그가 아니라 정답이다.
//
// 그래서 바깥쪽은 사람 어깨가 실제로 가는 만큼 열어준다(약 160도).
// 안쪽은 그대로 좁게 둔다 — 가슴을 가로질러 반대편으로 넘어갈 수는 없다.
// tanh 포화는 유지한다. 한계에서 뚝 자르면 그게 또 꺾임이 된다.
const YAW_OUT   = 2.80;   // 바깥쪽 — 귀 뒤까지 넘어간다 (약 160도)
const YAW_IN    = 0.50;   // 안쪽 — 가슴이 막는다
const PITCH_UP  = 1.45;   // 위로는 거의 수직까지 (약 83도)
const PITCH_DN  = 0.85;   // 아래로는 겨드랑이가 막는다
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
// 왼팔도 오른팔과 **같은 회전 규칙**을 쓴다. 예전에는 왼손이 scale.x = -1 로
// 뒤집혀 있어서 회전을 더할 때마다 화면에서 반대로 돌았고, 그게 팔이 기괴하게
// 꺾여 보인 원인이었다. 지금은 거울이 기하에 구워져 있어서(fp-hands 의
// mirrorInPlace) 부호를 나눌 필요가 없다.
// 혹시 음수 스케일인 팔이 들어와도 안 깨지게 아래 mir 는 남겨둔다.
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
  // 팔이 뒤로 넘어갈수록 어깨를 뒤로 뺀다.
  //
  // 팔은 어깨에서 회전한다. 그런데 1인칭에서 어깨는 카메라(=눈)보다 뒤·아래에
  // 있다. 어깨를 그 자리에 두지 않으면, 팔이 등 뒤를 향할 때 위팔이 얼굴을
  // 가로질러 지나간다. cos 이 음수가 되는 구간(90도 넘어감)에서만 뒤로 밀어
  // 회전 중심을 실제 어깨 위치로 옮긴다.
  const back = Math.max(0, -Math.cos(s.yaw));       // 0 -> 1 (90도 넘어서면 커진다)
  arm.position.z += back * 0.34 * k;                 // +Z = 뒤
  arm.position.y -= back * 0.10 * k;                 // 어깨는 눈보다 아래다
  // 쏘는 순간과 잡히는 순간에 어깨가 앞뒤로 반응한다. 이게 없으면 팔만 돌아가고
  // 몸이 가만히 있어서 "닿았다"가 아니라 "가리킨다"로 보인다.
  arm.position.z -= (s.fire * 0.10 - s.kick * 0.06) * k;
  arm.position.y += s.kick * 0.03 * k;
  return s;
}

export { initReach, setReach, clearReach, updateReach, getReach, applyReach, soft,
         SHOOT_T, CATCH_T, REL_T, YAW_MAX, PITCH_MAX, YAW_OUT, YAW_IN, PITCH_UP, PITCH_DN };
