// 웹으로 건물 타기 (Web-assisted Vertical Traversal)
//
// 문서 01 §11. 단순한 벽 기어오르기보다 웹의 정체성을 살린다.
// 화면에서 이 순서가 반복되어야 한다:
//
//   쏨 → 잡음 → 끌림 → (벽에 가까워지면) 짚음 → 밀어냄 → 다시 쏨
//
// 앞의 셋은 STEP 1(reachTarget)과 기존 집라인이, 가운데 둘은 STEP 2(벽 짚기)가
// 이미 한다. 여기서 새로 하는 일은 하나뿐이다 — **어디에 걸 것인가**.
//
// 조준선 레이캐스트(findZipAnchor)를 쓰지 않는다. 그건 커서가 가리키는 곳을
// 찾는 함수라 "지금 붙어 있는 이 벽을 타고 오른다"에는 맞지 않는다. 대신 옆에
// 있는 벽면 자체에서 잡을 자리를 계산한다 — 그래야 어디를 보고 있든 벽을 탄다.
//
// 이 파일은 게임 상태를 모른다. 위치와 벽면 하나를 받아 잡을 자리만 답한다.
import * as THREE from "../lib/three.module.js";

const VC_NEAR   = 9;     // 벽에서 이 안쪽에 있어야 '건물을 타는 중'이다
const VC_STEP   = 45;    // 한 번에 타고 오르는 높이. 밧줄 사거리 안쪽이어야 한다
// 벽에서 이만큼 띄운 자리에 건다. 벽면에 바로 걸면 처박히기도 하고, 더 중요하게는
// 도착하는 순간 손이 닿는 거리(2.6m)에 들어가 '벽 붙기'가 가로채 버린다. 그러면
// 타고 오르다 말고 붙어서 기어오르게 된다. 손이 안 닿는 거리에 걸어야 반복된다.
const VC_OUT    = 3.6;
const VC_ARRIVE = 7;     // 앵커에 이만큼 가까워지면 다음 자리를 잡는다
const VC_TOP    = 2.5;   // 지붕을 이만큼 넘겨 잡아야 옥상으로 올라선다
const VC_CD     = 0.30;  // 연속 발사 간격

// 이 벽을 타고 오를 다음 자리.
// wall 은 findNearbyWall 이 주는 모양 그대로 — { axis, dir, b, bound }.
// 이미 지붕 위로 올라섰으면 null (더 탈 게 없다).
function vclimbAnchor(pos, wall, r, opt) {
  if (!wall || !wall.b) return null;
  const o = opt || {};
  const step = o.step === undefined ? VC_STEP : o.step;
  const top = wall.b.y0 + wall.b.h;
  if (pos.y >= top + VC_TOP - 0.5) return null;      // 이미 다 올라왔다

  // 벽 표면에서 살짝 바깥으로. bound 에는 플레이어 반지름이 이미 들어 있다.
  const surf = wall.bound - wall.dir * r;
  const off = surf + wall.dir * VC_OUT;
  const ax = wall.axis === "x";
  return {
    x: ax ? off : pos.x,
    y: Math.min(top + VC_TOP, pos.y + step),
    z: ax ? pos.z : off,
    top,
  };
}

// 지금 다음 줄을 쏠 때인가.
//   held    타는 의도를 입력하고 있는가
//   zipTo   지금 걸려 있는 앵커 (없으면 null)
function vclimbShouldFire(pos, held, zipTo, cd) {
  if (!held || cd > 0) return false;
  if (!zipTo) return true;                            // 걸린 게 없으면 바로 쏜다
  // 걸어둔 자리에 거의 도착했으면 다음 자리로 옮겨 잡는다.
  const dx = zipTo.x - pos.x, dy = zipTo.y - pos.y, dz = zipTo.z - pos.z;
  return Math.hypot(dx, dy, dz) < VC_ARRIVE;
}

export {
  vclimbAnchor, vclimbShouldFire,
  VC_NEAR, VC_STEP, VC_OUT, VC_ARRIVE, VC_TOP, VC_CD,
};
