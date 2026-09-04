// 3인칭 카메라 충돌.
//
// 이 게임은 건물 사이를 스치고 벽을 타므로 카메라가 수시로 벽 속으로 들어갔다.
// 여기서 보는 것은 네 가지다.
//   1) 벽을 등지고 서면 카메라가 건물 안으로 안 들어간다
//   2) 막히지 않았을 때는 예전과 완전히 똑같이 움직인다 (평상시 체감을 안 건드렸나)
//   3) 아래를 볼 때 땅을 뚫지 않는다
//   4) 1인칭과 시점 방향에는 손대지 않았다
import { T } from "./_harness.mjs";
const DT = 1 / 120;
T.syncWorld();

let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };

function place(x, y, z) {
  T.player.pos.set(x, y, z);
  T.player.prevPos.copy(T.player.pos);
  T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0, 0, 0);
  T.player.grounded = false;
  T.setClinging(null);
  T.releaseWeb();
}
// 카메라를 목표 위치에 수렴시킨다 (보간이라 한 프레임으로는 안 닿는다)
function settle(n = 120) { for (let i = 0; i < n; i++) T.updateCamera(DT); }

// 카메라가 어떤 건물 안에 들어가 있나. 1m 여유를 두고 본다 —
// 벽면에 딱 붙는 것까지 실패로 치면 CAM_WALL_PAD를 그대로 재는 셈이 된다.
function insideBuilding(p, pad = 0) {
  for (const b of T.buildings) {
    if (p.y > b.y0 + b.h + pad || p.y < b.y0 - pad) continue;
    if (p.x > b.x - b.w / 2 - pad && p.x < b.x + b.w / 2 + pad &&
        p.z > b.z - b.d / 2 - pad && p.z < b.z + b.d / 2 + pad) return b;
  }
  return null;
}

console.log("===== 1. 벽을 등지면 카메라가 건물 안으로 안 들어간다 =====");
T.setFP(false);
{
  // 충분히 큰 건물을 고른다. 작은 건물은 카메라가 그냥 지나쳐 버려 시험이 안 된다.
  const big = T.buildings.filter(b => b.w > 40 && b.d > 40 && b.h > 60)
                         .sort((a, b) => b.h - a.h)[0];
  let blockedSeen = 0, inside = 0, tries = 0;
  // 건물 네 면 앞에 서서 각각 벽을 등져 본다
  const faces = [
    { dx: 0, dz: 1, yaw: 0 },            // 북쪽 면 앞에서 건물 반대를 봄 -> 카메라가 건물로
    { dx: 0, dz: -1, yaw: Math.PI },
    { dx: 1, dz: 0, yaw: Math.PI / 2 },
    { dx: -1, dz: 0, yaw: -Math.PI / 2 },
  ];
  for (const f of faces) {
    const gap = 2.2;
    const px = big.x + f.dx * (big.w / 2 + gap);
    const pz = big.z + f.dz * (big.d / 2 + gap);
    place(px, big.y0 + big.h * 0.5, pz);
    // yaw가 f 방향(건물 바깥)을 향하면 카메라는 그 반대인 건물 쪽으로 간다
    T.setView(Math.atan2(f.dx, f.dz), 0);
    settle();
    tries++;
    if (T.camBlocked) blockedSeen++;
    if (insideBuilding(T.camera.position, -0.2)) inside++;
  }
  ok(inside === 0, `네 면 모두에서 카메라가 건물 안에 없다`, `안에 들어간 횟수 ${inside}/${tries}`);
  ok(blockedSeen === tries, `네 면 모두에서 막힘을 인식한다`, `${blockedSeen}/${tries}`);
}

console.log("\n===== 2. 막히지 않으면 예전과 똑같이 움직인다 =====");
{
  // 하늘 한복판. 주변에 건물이 없다.
  place(0, 900, 0);
  T.setView(0.7, -0.1);
  settle();
  ok(!T.camBlocked, "탁 트인 공중에서는 막히지 않는다");
  const d = T.camera.position.distanceTo(T.player.renderPos);
  // 정지 상태 기본 거리 = min(9.5, 34) * camZoom(0.62) 근방. 높이 오프셋 때문에 조금 크다.
  ok(d > 5 && d < 12, "기본 카메라 거리가 그대로다", `${d.toFixed(2)}m`);

  // 충돌 코드가 평상시에도 카메라를 당기면 보간이 목표에 수렴하지 못하고 계속 떤다.
  // 충분히 수렴시킨 뒤 프레임 간 이동량이 사실상 0인지 본다.
  settle(600);
  const before = T.camera.position.clone();
  T.updateCamera(DT);
  const drift = before.distanceTo(T.camera.position);
  ok(drift < 1e-3, "막히지 않으면 카메라가 목표에 그대로 수렴한다 (매 프레임 당기지 않는다)",
     `프레임당 ${drift.toExponential(2)}m`);
}

console.log("\n===== 3. 아래를 보면 땅을 뚫지 않는다 =====");
{
  // 넓은 도로 위. 위를 올려다보면 카메라는 뒤아래로 내려가 땅을 파고든다.
  const gx = 0, gz = 0;
  const gy = T.groundHeightAt(gx, gz, 100);
  place(gx, gy + 1.0, gz);
  T.setView(0, 0.9);              // 크게 올려다본다 -> 카메라는 뒤아래로
  settle();
  const camGround = T.groundHeightAt(T.camera.position.x, T.camera.position.z, 400);
  ok(T.camera.position.y > camGround - 0.6, "카메라가 지면 아래로 내려가지 않는다",
     `cam.y ${T.camera.position.y.toFixed(2)} / ground ${camGround.toFixed(2)}`);
}

console.log("\n===== 4. 시점 방향과 1인칭은 그대로다 =====");
{
  // 수동 시점: 벽에 막혀 카메라가 당겨져도 보는 방향은 viewYaw/viewPitch 그대로여야 한다.
  const big = T.buildings.filter(b => b.w > 40 && b.d > 40 && b.h > 60)[0];
  T.setFP(false);
  T.setAuto(false);
  place(big.x, big.y0 + big.h * 0.5, big.z + big.d / 2 + 2.2);
  T.setView(0, 0);
  settle();
  const dir = T.camera.getWorldDirection(new (T.player.pos.constructor)());
  ok(T.camBlocked, "벽에 막힌 상황이 맞다");
  // viewYaw=0 이면 시선은 +z. 오차는 롤/버핏 정도.
  ok(dir.z > 0.98, "수동 시점에서 카메라가 당겨져도 보는 방향은 그대로다", `dir.z ${dir.z.toFixed(4)}`);

  // 1인칭은 충돌 코드를 아예 안 탄다 (같은 자리에서 시점만 바꿔 본다)
  T.setFP(true);
  settle(4);
  const head = T.camera.position.distanceTo(T.player.renderPos);
  ok(head < 2.2, "1인칭 카메라는 여전히 머리 위치다", `${head.toFixed(2)}m`);
  T.setFP(false);
  T.setAuto(true);
}

console.log("\n===== 5. 실제 비행: 도시를 가로질러도 벽 속에 안 들어간다 =====");
{
  // 건물이 빽빽한 도심을 여러 방향으로 훑는다. 예전에는 여기서 수시로 파묻혔다.
  T.setFP(false);
  T.setAuto(true);
  // 위치를 직접 밀기 때문에 플레이어 자신이 건물을 통과하는 프레임이 생긴다.
  // 실제 게임에서는 collideWalls가 그걸 막으므로, 그런 프레임은 세지 않는다.
  // (머리가 벽 속에 있으면 그 건물은 선분 검사에서 제외된다 — segBoxT는 시작점이
  //  박스 안이면 -1을 준다. 1인칭에서 총구가 벽에 살짝 박혔을 때를 위한 규칙이다.)
  const _v = T.player.pos.clone();
  let frames = 0, inside = 0, blocked = 0, skipped = 0, worst = 0;
  for (const yaw of [0, 0.8, 1.6, 2.4, 3.1, 3.9, 4.7, 5.5]) {
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    place(-300, 40, -300);
    T.setView(yaw, 0);
    settle(30);
    for (let i = 0; i < 240; i++) {
      T.player.pos.addScaledVector(_v.set(dx, 0, dz), 2.5);
      T.player.renderPos.copy(T.player.pos);
      T.player.vel.set(dx * 30, 0, dz * 30);
      T.updateCamera(DT * 4);

      // 머리(=선분 시작점)가 건물 안이면 이 프레임은 시험 대상이 아니다
      const pivot = _v.set(T.player.renderPos.x, T.player.renderPos.y + T.CAM_PIVOT_Y, T.player.renderPos.z);
      if (insideBuilding(pivot, 0.5)) { skipped++; continue; }

      frames++;
      if (T.camBlocked) blocked++;
      const b = insideBuilding(T.camera.position, -0.2);
      if (b) {
        inside++;
        const p = T.camera.position;
        const dep = Math.min(
          b.x + b.w / 2 - p.x, p.x - (b.x - b.w / 2),
          b.z + b.d / 2 - p.z, p.z - (b.z - b.d / 2));
        worst = Math.max(worst, dep);
      }
    }
  }
  ok(inside === 0, `${frames}프레임 비행 중 카메라가 건물 안에 들어간 적이 없다`,
     `들어감 ${inside}회, 최대 침투 ${worst.toFixed(2)}m (머리가 벽 속이라 건너뛴 프레임 ${skipped})`);
  ok(blocked > 0, "그 사이 실제로 막힌 프레임이 있었다 (시험이 헛돌지 않았다)",
     `${blocked}/${frames} 프레임`);
}

console.log("\n===== 6. 벽에 바짝 붙어도 뚫지 않는다 (최소 거리보다 벽이 우선) =====");
{
  // 벽에 등을 대고 서면 머리에서 벽까지가 1m도 안 된다. 최소 거리(1.25m)를
  // 고집하면 그 순간 카메라가 벽을 뚫는다. 그럴 땐 벽이 이겨야 한다.
  const big = T.buildings.filter(b => b.w > 40 && b.d > 40 && b.h > 60)
                         .sort((a, b) => b.h - a.h)[0];
  T.setFP(false);
  T.setAuto(false);
  let worstIn = 0, hidden = 0, n = 0;
  for (const gap of [0.6, 0.9, 1.2, 2.0, 4.0]) {
    place(big.x, big.y0 + big.h * 0.4, big.z + big.d / 2 + gap);
    T.setView(0, 0);              // +z(건물 반대)를 본다 -> 카메라는 건물 쪽으로
    settle();
    n++;
    // 건물 앞면보다 안쪽으로 들어갔으면 침투
    const face = big.z + big.d / 2;
    const dep = face - T.camera.position.z;
    if (dep > 0) worstIn = Math.max(worstIn, dep);
    if (!T.spiderGroup.visible) hidden++;
  }
  ok(worstIn <= 0, `벽까지 ${0.6}m까지 붙어도 카메라가 벽면을 넘지 않는다`,
     `최대 침투 ${worstIn.toFixed(3)}m`);
  ok(hidden > 0 && hidden < n, "바짝 붙었을 때만 캐릭터를 숨긴다",
     `${hidden}/${n} 상황에서 숨김`);

  // camStandDist 자체의 계약: 항상 벽보다 CAM_NEAR_SKIN 이상 앞이고, 음수가 아니다
  let bad = 0;
  for (let h = 0; h <= 40; h += 0.05) {
    const d = T.camStandDist(h);
    if (d < 0 || d > Math.max(0, h - T.CAM_NEAR_SKIN) + 1e-9) bad++;
  }
  ok(bad === 0, "camStandDist는 어떤 거리에서도 벽 앞에 선다", `위반 ${bad}건`);

  T.setAuto(true);
}

console.log(`\n통과 ${pass} / 실패 ${fail}`);
