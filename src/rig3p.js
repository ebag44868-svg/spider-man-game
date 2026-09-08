// 3인칭 본 레이어 — reachTarget 을 모델 뼈에 먹인다
//
// 문서 01 §16. 3인칭에서 모델보다 중요한 건 실루엣과 포즈다. 캐릭터가 위치만
// 따라가는 마네킹처럼 보이면 실패다.
//
// 지금까지 3인칭은 100% 클립 재생이었다. 그래서 줄을 어디에 걸든 팔이 늘 같은
// 곳을 보고 있었다 — 1인칭에서 고친 것과 같은 문제가 3인칭에 그대로 남아 있었다.
// STEP 1 에서 만든 reachTarget 을 여기서 뼈에 옮긴다. 값은 같고 먹이는 대상만 다르다.
//
// 순서가 중요하다. AnimationMixer 가 클립을 적용한 **뒤에**, 렌더 **전에** 불러야
// 한다. 먼저 부르면 클립이 우리 회전을 덮어쓴다.
//
// 이 파일은 게임을 모른다. 모델과 '무엇을 향해야 하는지'만 받는다.
import * as THREE from "../lib/three.module.js";

const B = {};                 // 이름 -> 뼈
const AX = {};                // 뼈가 가리키는 축 (모델마다 다르다)
let ready = false;

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _rest = {};             // 클립이 준 원래 회전 (섞어 쓰려고 보관)

// Mixamo 이름. 다른 리그를 쓰게 되면 여기만 갈아끼우면 된다.
const NAMES = {
  spine:  "mixamorigSpine1",
  chest:  "mixamorigSpine2",
  head:   "mixamorigHead",
  armR:   "mixamorigRightArm",
  foreR:  "mixamorigRightForeArm",
  handR:  "mixamorigRightHand",
  armL:   "mixamorigLeftArm",
  foreL:  "mixamorigLeftForeArm",
  handL:  "mixamorigLeftHand",
};

function init3p(root) {
  ready = false;
  for (const k of Object.keys(B)) delete B[k];
  if (!root) return false;
  const byName = {};
  root.traverse(o => { if (o.isBone) byName[o.name] = o; });
  for (const k of Object.keys(NAMES)) {
    const b = byName[NAMES[k]];
    if (b) B[k] = b;
  }
  // 뼈가 어느 축을 향하는지는 자식 뼈가 어디 붙어 있는지로 정한다.
  // 모델마다 다르므로 값을 박아두면 안 된다 — 실제 리그에서 읽는다.
  const pairs = [["armR", "foreR"], ["foreR", "handR"], ["armL", "foreL"], ["foreL", "handL"]];
  for (const [a, c] of pairs) {
    if (!B[a] || !B[c]) continue;
    const v = B[c].position.clone();
    if (v.lengthSq() < 1e-8) continue;
    AX[a] = v.normalize();
  }
  ready = !!(B.armR && B.armL);
  return ready;
}

// 뼈를 월드의 한 점으로 향하게 한다.
// weight 0 이면 클립 그대로, 1 이면 완전히 그쪽을 본다.
function aimBone(key, worldTarget, weight) {
  const bone = B[key], ax = AX[key];
  if (!bone || !ax || weight <= 0.001) return false;
  const p = bone.parent;
  if (!p) return false;
  p.updateMatrixWorld();
  _m.copy(p.matrixWorld).invert();
  _v.copy(worldTarget).applyMatrix4(_m).sub(bone.position);
  if (_v.lengthSq() < 1e-8) return false;
  _v.normalize();
  _q.setFromUnitVectors(ax, _v);
  bone.quaternion.slerp(_q, Math.min(1, weight));
  return true;
}

// 한 프레임. ctx 는 게임이 아는 것만 담는다.
//   targetR / targetL  그 손이 향할 월드 좌표 (없으면 null)
//   wR / wL            0..1 — 얼마나 향할지 (reach 의 on 을 그대로 쓴다)
//   lean               좌우 기울기 (-1..1)
//   pitchLean          앞뒤 기울기 (-1..1) — 솟구치면 뒤로, 낙하하면 앞으로
//   look               머리가 볼 월드 좌표 (없으면 안 돌린다)
function pose3p(ctx) {
  if (!ready || !ctx) return false;

  // 몸통. 클립 위에 얹는다 — 덮어쓰면 걷기·주먹 모션이 통째로 죽는다.
  if (B.spine) {
    _rest.spine = _rest.spine || new THREE.Quaternion();
    B.spine.rotation.z -= (ctx.lean || 0) * 0.28;
    B.spine.rotation.x += (ctx.pitchLean || 0) * 0.20;
  }
  if (B.chest) {
    B.chest.rotation.z -= (ctx.lean || 0) * 0.18;
    B.chest.rotation.x += (ctx.pitchLean || 0) * 0.14;
  }

  // 팔. 위팔을 목표로 돌리고, 아래팔은 절반만 따라간다 —
  // 둘 다 완전히 돌리면 팔꿈치가 펴져서 막대처럼 보인다.
  if (ctx.targetR) {
    aimBone("armR", ctx.targetR, ctx.wR === undefined ? 1 : ctx.wR);
    aimBone("foreR", ctx.targetR, (ctx.wR === undefined ? 1 : ctx.wR) * 0.45);
  }
  if (ctx.targetL) {
    aimBone("armL", ctx.targetL, ctx.wL === undefined ? 1 : ctx.wL);
    aimBone("foreL", ctx.targetL, (ctx.wL === undefined ? 1 : ctx.wL) * 0.45);
  }

  // 머리. 가는 쪽이나 잡은 쪽을 본다. 이게 없으면 시선이 늘 정면이라 죽어 보인다.
  if (B.head && ctx.look) aimBoneHead(ctx.look, ctx.wHead === undefined ? 0.55 : ctx.wHead);
  return true;
}

// 머리는 자식 뼈가 끝(HeadTop_End)이라 축을 따로 잡는다. +Y 가 정수리다.
const _headAx = new THREE.Vector3(0, 1, 0);
function aimBoneHead(worldTarget, weight) {
  const bone = B.head;
  const p = bone.parent;
  if (!p) return false;
  p.updateMatrixWorld();
  _m.copy(p.matrixWorld).invert();
  _v.copy(worldTarget).applyMatrix4(_m).sub(bone.position);
  if (_v.lengthSq() < 1e-8) return false;
  _v.normalize();
  // 목은 많이 못 돌아간다. 정수리 축에서 너무 벗어나면 눌러준다.
  const dot = _v.dot(_headAx);
  if (dot < -0.2) return false;
  _q.setFromUnitVectors(_headAx, _v);
  bone.quaternion.slerp(_q, Math.min(0.6, weight));
  return true;
}

function bones3p() { return B; }
function ready3p() { return ready; }

export { init3p, pose3p, aimBone, bones3p, ready3p, NAMES };
