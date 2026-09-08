// 벽 짚기 (Wall Plant)
//
// 목표는 문서 01 §10 그대로다 — "벽과 충돌"이 아니라 "벽을 이용한 이동".
//
// 지금까지는 빠르게 벽으로 가면 그냥 스쳐 지나갔다. 느릴 때만 붙었다
// (game3d.js의 벽 붙기: 속도 14 미만). 빠른 접근은 아무 일도 안 일어나는
// 구간이었고, 레퍼런스 영상에서 가장 인상적인 장면이 바로 그 구간이다.
//
// 이 파일은 게임 상태를 모른다. 위치·속도·벽면 하나를 받아서
//   (1) 곧 닿는가
//   (2) 닿는다면 손이 어디에 닿는가
//   (3) 속도를 어떻게 바꿔야 안 멈추고 이어지는가
// 만 답한다. 언제 부를지, 결과로 무엇을 할지는 부르는 쪽이 정한다.
//
// 물리를 새로 쓰지 않는다. 기존 충돌 해결(collideWalls)은 그대로 두고,
// 그보다 '먼저' 속도의 방향만 바꿔서 애초에 처박히지 않게 한다.
import * as THREE from "../lib/three.module.js";

const PLANT_LOOK  = 0.20;   // 이 시간 안에 벽면을 넘어설 것 같으면 짚는다
const PLANT_MIN_V = 15;     // 이보다 느리면 짚지 않는다 — 기존 '벽 붙기'의 몫이다
const PLANT_TIME  = 0.30;   // 손이 벽에 닿아 있는 시간 (연출)
const PLANT_KEEP  = 0.88;   // 벽면을 따라 흐르는 속도를 이만큼 남긴다
// 되미는 세기는 고정이 아니라 '들어온 속도에 비례'한다.
// 고정값이면 정면으로 빠르게 박을수록 손해가 커진다 — 46m/s로 들어가서 15m/s로
// 나오면 그건 짚은 게 아니라 부딪힌 거다. 실측하고 바꿨다.
const PLANT_BOUNCE = 0.45;   // 벽을 향하던 속도의 이만큼으로 되밀린다
const PLANT_PUSH  = 11;      // 최소치. 느리게 닿아도 이만큼은 떨어져 나온다
const PLANT_PUSH_MAX = 28;   // 상한. 없으면 고속에서 튕겨 날아간다
const PLANT_UP    = 7;      // 살짝 위로. 없으면 짚을 때마다 고도가 깎인다
const PLANT_CD    = 0.45;   // 같은 벽을 무한히 되짚지 않게
const PLANT_HAND_Y = 1.15;  // 접촉점을 어깨 높이쯤으로 올린다 (발밑을 짚으면 이상하다)

// 곧 이 벽면에 닿는가.
// wall 은 game3d.js의 findNearbyWall 이 주는 모양 그대로다.
//   { axis: 'x'|'z', dir: ±1, b, bound }
//   dir = +1 이면 플레이어가 그 면의 + 바깥쪽에 있다.
//   bound 는 이미 플레이어 반지름이 더해진 '멈추는 평면'이다.
//
// 닿으면 { ax, dir, x, y, z, t } 를 준다. x/y/z 는 손이 짚을 벽면 위의 점이다.
function plantCheck(pos, vel, wall, r, opt) {
  if (!wall) return null;
  const o = opt || {};
  const minV = o.minV === undefined ? PLANT_MIN_V : o.minV;
  const look = o.look === undefined ? PLANT_LOOK : o.look;

  const sp = Math.hypot(vel.x, vel.z);
  if (sp < minV) return null;                    // 느리면 짚을 이유가 없다

  const ax = wall.axis === "x";
  const p = ax ? pos.x : pos.z;
  const v = ax ? vel.x : vel.z;

  const gap = (p - wall.bound) * wall.dir;       // 면까지 남은 거리 (양수면 아직 바깥)
  const closing = -v * wall.dir;                 // 면으로 다가가는 속도
  if (closing <= 1) return null;                 // 멀어지는 중이거나 거의 나란히 간다
  const t = gap / closing;
  if (t < 0 || t > look) return null;            // 아직 멀거나 이미 지났다

  // 닿을 자리. 벽면(진짜 표면)은 bound 에서 반지름만큼 안쪽이다.
  const surf = wall.bound - wall.dir * r;
  return {
    ax, dir: wall.dir, t,
    x: ax ? surf : pos.x + vel.x * t,
    y: pos.y + vel.y * t + PLANT_HAND_Y,
    z: ax ? pos.z + vel.z * t : surf,
  };
}

// 속도를 바꾼다. 벽을 향하던 성분은 되밀고, 벽면을 따르던 성분은 대부분 남긴다.
// 남기는 게 핵심이다 — 여기서 속도를 죽이면 그냥 '부딪힘'이 된다.
function plantImpulse(vel, hit, opt) {
  const o = opt || {};
  const keep = o.keep === undefined ? PLANT_KEEP : o.keep;
  const up = o.up === undefined ? PLANT_UP : o.up;
  const vn = Math.abs(hit.ax ? vel.x : vel.z);          // 벽을 향하던 속도
  const push = o.push === undefined
    ? Math.min(PLANT_PUSH_MAX, Math.max(PLANT_PUSH, vn * PLANT_BOUNCE))
    : o.push;
  if (hit.ax) { vel.x = hit.dir * push; vel.z *= keep; }
  else        { vel.z = hit.dir * push; vel.x *= keep; }
  // 아래로 떨어지던 중이면 위로 세워준다. 위로 가던 중이면 건드리지 않는다.
  if (vel.y < up) vel.y = Math.min(up, vel.y + up);
}

// 접촉점이 플레이어의 어느 쪽인가. 짚는 손을 고른다.
// 오른쪽(+)이면 오른손. viewYaw 기준 오른쪽 벡터는 (-cos, 0, sin) 이다
// (right = forward x up, forward = (sin, 0, cos)).
function plantSide(hit, pos, viewYaw) {
  const rx = -Math.cos(viewYaw), rz = Math.sin(viewYaw);
  return ((hit.x - pos.x) * rx + (hit.z - pos.z) * rz) >= 0 ? "R" : "L";
}

export {
  plantCheck, plantImpulse, plantSide,
  PLANT_LOOK, PLANT_MIN_V, PLANT_TIME, PLANT_KEEP, PLANT_PUSH, PLANT_PUSH_MAX, PLANT_BOUNCE, PLANT_UP, PLANT_CD,
};
