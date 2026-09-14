// 거리 상호작용 — 차 충돌 · 체력 · 거미줄로 소품 잡기
//
//   1) 차에 치이면 체력이 닳고, 차 진행 방향으로 밀려난다. 차 속에 남지 않는다
//   2) 한 번 치인 직후엔 연달아 안 닳는다
//   3) 위에서 내려앉으면 지붕에 선다 — 안 아프다
//   4) 안 다치면 다시 찬다 · 0이 되면 시작 광장에서 체력 가득
//   5) 소품: 잡으면 인스턴스에서 빠지고, 던지면 날아가서, 멈추면 새 자리에 돌아온다
import { T } from "./_harness.mjs";
const DT = 1 / 120;
T.syncWorld();
// 소품 배치는 부팅 타이머 뒤에 돈다. 소품이 깔릴 때까지 기다린다.
for (let i = 0; i < 100 && !T.nycFind("trash_bin", 0, 0); i++) await new Promise(r => setTimeout(r, 50));
let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };
const P = T.player;

function place(x, y, z, vx = 0, vy = 0, vz = 0) {
  T.releaseWeb(); T.setClinging(null);
  P.pos.set(x, y, z); P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.vel.set(vx, vy, vz);
}
// 앞뒤 150m 에 다른 차가 없는 애비뉴 차 (다른 차에 또 치이면 시험이 흐려진다)
const car = T.cars.find(c => c.axis === "z" &&
  !T.cars.some(o => o !== c && Math.hypot(o.x - c.x, o.z - c.z) < 150));
const inCar = () => Math.abs(P.pos.x - car.x) < T.CAR_W / 2 && Math.abs(P.pos.z - car.z) < T.CAR_L / 2
  && P.pos.y < T.CAR_ROOF();

console.log("===== 1. 차에 치이면 닳고 밀려난다 =====");
{
  ok(!!car, "시험할 차를 찾았다", `${T.cars.length}대`);
  T.setHp(T.HP_MAX);
  // 차 바로 앞(범퍼 안쪽 0.3m)에 서 있다가 치인다
  place(car.x, 0.2, car.z + car.dir * (T.CAR_L / 2 + 0.3));
  const hp0 = T.hp, hits0 = T.carHits;
  T.update(DT);
  ok(T.hp < hp0, "체력이 닳는다", `${hp0} -> ${T.hp.toFixed(1)}`);
  ok(T.carHits === hits0 + 1, "충돌이 한 번 잡힌다");
  const vAlong = P.vel.z * car.dir;
  ok(vAlong > car.speed, "차보다 빠르게 진행 방향으로 튕겨난다", `${vAlong.toFixed(1)} > ${car.speed.toFixed(1)} m/s`);
  ok(P.vel.y > 0, "살짝 떠오른다", `vy ${P.vel.y.toFixed(1)}`);
  ok(!inCar(), "차 속에 남지 않는다");

  console.log("\n===== 2. 연달아 안 닳는다 =====");
  const hp1 = T.hp;
  place(car.x, 0.2, car.z + car.dir * (T.CAR_L / 2 + 0.3));
  T.update(DT);
  ok(T.hp === hp1, "1.4초 안에 다시 부딪혀도 그대로다", `${hp1.toFixed(1)} -> ${T.hp.toFixed(1)}`);
  for (let i = 0; i < 180; i++) T.update(DT);
  place(car.x, 0.2, car.z + car.dir * (T.CAR_L / 2 + 0.3));
  const hp2 = T.hp;
  T.update(DT);
  ok(T.hp < hp2, "시간이 지나면 다시 닳는다", `${hp2.toFixed(1)} -> ${T.hp.toFixed(1)}`);

  // 차 옆을 나란히 스치기만 하면 안 아프다 (다가오는 속도가 없다)
  for (let i = 0; i < 180; i++) T.update(DT);
  T.setHp(T.HP_MAX);
  place(car.x + (T.CAR_W / 2 + P.r - 0.2), 0.2, car.z, 0, 0, car.dir * car.speed);
  T.update(DT);
  ok(T.hp === T.HP_MAX, "같은 속도로 옆에 붙어 있으면 안 아프다", `${T.hp}`);
}

console.log("\n===== 3. 위에서 내려앉으면 지붕에 선다 =====");
{
  for (let i = 0; i < 180; i++) T.update(DT);
  T.setHp(T.HP_MAX);
  const roof = T.CAR_ROOF();
  place(car.x, roof + 6, car.z, 0, -8, 0);
  for (let i = 0; i < 240; i++) T.update(DT);
  ok(Math.abs(P.pos.y - roof) < 0.6, "지붕 높이에 서 있다", `y ${P.pos.y.toFixed(2)} / 지붕 ${roof.toFixed(2)}`);
  ok(T.hp === T.HP_MAX, "지붕에 내려앉는 건 안 아프다", `${T.hp}`);
  ok(P.grounded, "서 있는 상태다 (걷고 점프할 수 있다)");
  // 차가 움직이면 같이 실려 간다
  const z0 = P.pos.z;
  car.z += car.dir * 3; T.update(DT); car.z += car.dir * 3; T.update(DT);
  ok(Math.abs((P.pos.z - z0) * car.dir - 6) < 0.5, "차가 움직인 만큼 같이 간다", `${((P.pos.z - z0) * car.dir).toFixed(2)}m / 6m`);
}

console.log("\n===== 4. 회복 · 쓰러짐 =====");
{
  place(T.SPAWN.x + 400, 300, T.SPAWN.z);          // 차와 먼 공중
  T.setHp(80);
  T.hurtPlayer(30);
  for (let i = 0; i < 120; i++) { P.pos.y = 300; P.vel.set(0, 0, 0); T.update(DT); }
  const early = T.hp;
  for (let i = 0; i < 120 * 6; i++) { P.pos.y = 300; P.vel.set(0, 0, 0); T.update(DT); }
  ok(early === 50, "막 다친 직후 4초는 안 찬다", `1초 뒤 ${early.toFixed(1)}`);
  ok(T.hp > 60, "그 뒤로 다시 찬다", `7초 뒤 ${T.hp.toFixed(1)}`);

  T.setHp(5);
  for (let i = 0; i < 180; i++) { P.pos.y = 300; T.update(DT); }
  place(car.x, 0.2, car.z + car.dir * (T.CAR_L / 2 + 0.3));
  T.update(DT);
  ok(T.hp === T.HP_MAX, "0이 되면 체력이 가득 찬다", `${T.hp}`);
  ok(Math.hypot(P.pos.x - T.SPAWN.x, P.pos.z - T.SPAWN.z) < 1, "시작 광장으로 돌아간다",
     `(${P.pos.x.toFixed(0)}, ${P.pos.z.toFixed(0)})`);
}

console.log("\n===== 5. 소품 잡기 =====");
{
  // 원점 근처 쓰레기통 하나를 위에서 내려다보며 조준한다
  const V = P.pos.constructor;
  let pick = null, o = null, d = null;
  for (const r of [60, 120, 200, 320]) {
    for (let a = 0; a < 16 && !pick; a++) {
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
      o = new V(cx, 40, cz);
      // 이 점에서 가장 가까운 쓰레기통을 겨눈다
      const it = T.nycFind("trash_bin", cx, cz);
      if (!it || Math.hypot(it.x - cx, it.z - cz) > 70) continue;
      d = new V(it.x - o.x, it.y + 2 - o.y, it.z - o.z).normalize();
      pick = T.propPick(o, d, 90);
    }
    if (pick) break;
  }
  ok(!!pick && pick.name === "trash_bin", "조준한 쓰레기통을 고른다", pick ? pick.name : "없음");
  if (pick) {
    const b = T.propGrab(pick);
    ok(!!b && b.it.dyn, "잡으면 인스턴스에서 빠진다");
    ok(T.propPick(o, d, 90)?.i !== pick.i || T.propPick(o, d, 90)?.name !== pick.name, "잡힌 건 다시 고르지 않는다");
    const x0 = b.pos.x, z0 = b.pos.z;
    T.propThrow(b, new V(40, 20, 0));
    let t = 0;
    while (b.state !== "gone" && t < 16) { T.propStep(1 / 60, null); t += 1 / 60; }
    ok(b.state === "gone", "던진 소품이 결국 멈추고 인스턴스로 돌아간다", `${t.toFixed(1)}초`);
    ok(!b.it.dyn && Math.hypot(b.it.x - x0, b.it.z - z0) > 20, "옮겨진 자리에 남는다",
       `${Math.hypot(b.it.x - x0, b.it.z - z0).toFixed(0)}m 이동`);
    ok(b.it.y >= T.groundAt(b.it.x, b.it.z, b.it.y + 3) - 0.05, "바닥 밑으로 안 빠진다", `y ${b.it.y.toFixed(2)}`);

    // 탭: 발 앞으로 끌어온다
    const c2 = T.propPick(o, new V(b.it.x - o.x, b.it.y + 2 - o.y, b.it.z - o.z).normalize(), 200);
    if (c2) {
      const b2 = T.propGrab(c2);
      const target = new V(o.x, T.groundAt(o.x, o.z, 1e4), o.z);
      T.propYank(b2, target);
      let best = Infinity, tt = 0;
      while (b2.state !== "gone" && tt < 16) {
        T.propStep(1 / 60, null); tt += 1 / 60;
        best = Math.min(best, Math.hypot(b2.pos.x - target.x, b2.pos.z - target.z));
      }
      ok(best < 25, "탭하면 플레이어 쪽으로 날아온다", `가장 가까이 ${best.toFixed(1)}m`);
    } else ok(false, "끌어올 소품을 다시 찾았다");
  }
}

console.log(`\n합계 통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
