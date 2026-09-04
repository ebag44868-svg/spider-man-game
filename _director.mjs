// Combat Director — 공격권 배분.
//
// 이 파일이 지키는 것은 하나다: "한 번에 몇 명이 덤비는가".
// 예전에는 근처에 있는 적이 전부 동시에 덤볐다. 격투병 다섯이면 예고 색이
// 다섯 개 겹쳐서 무엇을 쳐내고 무엇을 피할지 읽을 수가 없었다.
//
// 정한 상한: 근접 2 · 사수 1 · 저격수 1 = 동시에 최대 4명.
import { T } from "./_harness.mjs";
const DT = 1 / 120;
T.syncWorld();

let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };

// 건물보다 높은 곳에서 붙인다. 가장 높은 건물이 1,685m라 2,500m면 시야를
// 가리는 게 아무것도 없다 — 엄폐나 길막 때문에 공격을 못 하는 경우를 배제하고
// "누가 공격해도 되는가"만 보려는 것이다.
//
// 대신 높이를 매 스텝 고정해야 한다. 적에게도 중력이 있어서 그냥 두면 초당 8.5m씩
// 가라앉고, 몇 초 만에 세로 거리가 벌어져 아무도 사거리 안에 없게 된다.
const SKY = 2500;

// 한 스텝. 플레이어와 시험용 적의 높이를 붙들어 둔다.
function step(fighters) {
  T.setInvuln(5);                       // 죽으면 Director가 멈춰 측정이 끊긴다
  T.player.pos.set(0, SKY, 0);
  T.player.prevPos.copy(T.player.pos);
  T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0, 0, 0);
  for (const e of fighters) { e.g.position.y = SKY; e.knock.set(0, 0, 0); }
  T.update(DT);
  for (const e of fighters) { e.g.position.y = SKY; e.knock.set(0, 0, 0); }
}

// 유형별로 몇 명을 플레이어 주변에 세울지. 상한(근접 2/사수 1/저격수 1)보다
// 넉넉히 둬야 "넘치는 인원이 기다리는가"를 볼 수 있다.
const SETUP = [
  { type: 0, n: 5, r: 55 },    // 사수   (사거리 130)
  { type: 1, n: 4, r: 11 },    // 돌격병 (근접)
  { type: 2, n: 3, r: 120 },   // 저격수 (사거리 280)
  { type: 3, n: 6, r: 11 },    // 격투병 (근접)
];

// 실제 적 목록에서 유형별로 골라 플레이어 주위에 배치한다.
function setupFight() {
  T.player.pos.set(0, SKY, 0);
  T.player.prevPos.copy(T.player.pos);
  T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0, 0, 0);
  T.player.grounded = false;
  T.setClinging(null);
  T.releaseWeb();
  T.setFP(false);

  const picked = [];
  for (const s of SETUP) {
    const pool = T.enemies.filter(e => e.type === s.type && !picked.includes(e)).slice(0, s.n);
    pool.forEach((e, i) => {
      const a = (i / s.n) * Math.PI * 2 + s.type * 0.4;
      e.g.position.set(Math.cos(a) * s.r, SKY, Math.sin(a) * s.r);
      e.hx = e.px = e.g.position.x;
      e.hz = e.pz = e.g.position.z;
      e.dead = false; e.deadT = 0; e.bound = 0; e.grip = 0;
      e.stag = 0; e.post = 0; e.hp = e.ty.hp;
      e.swing = null; e.aimT = 0; e.fireCd = 0.2 + Math.random() * 0.3;
      e.tok = false; e.tokIdle = 0; e.atkRest = 0;
      e.knock.set(0, 0, 0);
      picked.push(e);
    });
  }
  // 나머지 적은 멀리 치워 이 시험에 끼어들지 않게 한다
  for (const e of T.enemies) {
    if (picked.includes(e)) continue;
    if (e.g.position.distanceTo(T.player.pos) < 400) e.g.position.y = 0;
  }
  T.syncWorld();
  return picked;
}

// 지금 공격 동작에 들어가 있는 적 (예고 포함)
const attacking = (list) => list.filter(e => T.dirBusy(e));

console.log("===== 1. 동시에 덤비는 인원이 상한을 넘지 않는다 =====");
{
  const fighters = setupFight();
  ok(fighters.length === 18, "시험용 적 18명을 세웠다", `${fighters.length}명`);

  let maxAll = 0, maxLane = [0, 0, 0];
  const everAttacked = new Set();
  const swingSeen = new Map();     // 시작한 스윙이 끝까지 갔는가
  let cutShort = 0;

  for (let i = 0; i < 120 * 40; i++) {          // 40초
    step(fighters);

    const busy = attacking(fighters);
    maxAll = Math.max(maxAll, busy.length);
    const lane = [0, 0, 0];
    for (const e of busy) {
      lane[T.DIR_LANE_OF[e.type]]++;
      everAttacked.add(e);
    }
    for (let l = 0; l < 3; l++) maxLane[l] = Math.max(maxLane[l], lane[l]);

    // 스윙이 도중에 끊기지 않는지: 시작한 스윙의 t가 뒤로 가거나 사라졌는데
    // 지속시간을 못 채웠으면 끊긴 것이다.
    for (const e of fighters) {
      const prev = swingSeen.get(e);
      if (e.swing) swingSeen.set(e, e.swing);
      else if (prev) {
        if (prev.t < T.BRAWL[prev.kind].dur - 1e-6) cutShort++;
        swingSeen.delete(e);
      }
    }
  }

  ok(maxAll <= T.DIR_MAX, `동시 공격이 ${T.DIR_MAX}명을 넘지 않는다`, `최대 ${maxAll}명`);
  ok(maxLane[1] <= 2, "근접(돌격병+격투병)은 동시에 최대 2명", `최대 ${maxLane[1]}명`);
  ok(maxLane[0] <= 1, "사수는 동시에 1명", `최대 ${maxLane[0]}명`);
  ok(maxLane[2] <= 1, "저격수는 동시에 1명", `최대 ${maxLane[2]}명`);
  ok(cutShort === 0, "시작한 공격이 도중에 끊기지 않는다", `끊김 ${cutShort}회`);

  console.log(`\n===== 2. 순번이 돌아간다 (한 명이 독점하지 않는다) =====`);
  // 상한이 4인데 40초 동안 4명만 계속 때렸다면 나머지는 구경만 한 것이다.
  ok(everAttacked.size > T.DIR_MAX, "상한보다 많은 적이 돌아가며 공격했다",
     `${everAttacked.size}명 / 세운 18명`);
  const meleeAtk = [...everAttacked].filter(e => e.ty.melee).length;
  ok(meleeAtk >= 4, "근접도 여러 명이 번갈아 들어왔다", `${meleeAtk}명`);
  console.log(`       40초 동안: 세운 18명 중 ${everAttacked.size}명이 공격 (근접 ${meleeAtk}/10)`);
  console.log(`       동시 최대: 전체 ${maxAll} · 사수 ${maxLane[0]} · 근접 ${maxLane[1]} · 저격수 ${maxLane[2]}`);
}

console.log("\n===== 3. 그래도 싸움은 성립한다 (조용해지지 않았다) =====");
{
  const fighters = setupFight();
  let busyFrames = 0, frames = 0;
  for (let i = 0; i < 120 * 20; i++) {
    step(fighters);
    frames++;
    if (attacking(fighters).length > 0) busyFrames++;
  }
  const ratio = busyFrames / frames;
  ok(ratio > 0.8, "대부분의 시간에 누군가는 공격 중이다 (빈 시간이 안 생긴다)",
     `${(ratio * 100).toFixed(1)}%의 프레임`);
}

console.log("\n===== 4. 싸울 수 없는 적은 공격권을 쥐지 않는다 =====");
{
  const fighters = setupFight();
  for (let i = 0; i < 120; i++) step(fighters);
  // 근접 몇을 묶고 체간을 무너뜨린다
  const melee = fighters.filter(e => e.ty.melee);
  melee[0].bound = 5;
  melee[1].stag = 5;
  melee[2].grip = 1;
  melee[3].dead = true;
  for (let i = 0; i < 120; i++) step(fighters);
  const bad = [melee[0], melee[1], melee[2], melee[3]].filter(e => e.tok).length;
  ok(bad === 0, "묶임 / 체간붕괴 / 잡힘 / 사망 상태는 공격권을 못 가진다", `${bad}명이 쥐고 있다`);
  // 원상복구
  melee[0].bound = 0; melee[1].stag = 0; melee[2].grip = 0; melee[3].dead = false;
}

console.log("\n===== 5. 멀리 있는 적은 후보가 아니다 =====");
{
  const fighters = setupFight();
  // 근접을 전부 링 밖으로 보낸다
  const melee = fighters.filter(e => e.ty.melee);
  melee.forEach((e, i) => {
    const a = i / melee.length * Math.PI * 2;
    const r = T.DIR_MELEE_RING + 25;
    e.g.position.set(Math.cos(a) * r, SKY, Math.sin(a) * r);
    e.tok = false; e.swing = null; e.aimT = 0;
  });
  // 한 스텝만 돌려 Director가 배분하게 한다 (달려와서 다시 들어오기 전에)
  for (let i = 0; i < 12; i++) step(fighters);
  const far = melee.filter(e => e.g.position.distanceTo(T.player.pos) > T.DIR_MELEE_RING);
  const farTok = far.filter(e => e.tok).length;
  ok(far.length > 0, "실제로 링 밖에 근접 적이 있다", `${far.length}명`);
  ok(farTok === 0, "링 밖의 근접 적은 공격권을 못 받는다", `${farTok}명이 받았다`);
}

console.log("\n===== 6. 순번을 기다리는 근접은 한 발 뒤에서 기다린다 =====");
{
  // 전부 사거리까지 붙어버리면 플레이어 몸이 적들에게 묻혀서 무엇을 쳐낼지
  // 안 보인다. 들어오는 놈만 파고들고 나머지는 대기 링을 지켜야 한다.
  const fighters = setupFight();
  const melee = fighters.filter(e => e.ty.melee);
  for (let i = 0; i < 120 * 3; i++) step(fighters);   // 자리를 잡을 시간

  let waitNear = 0, waitFrames = 0, atkFrames = 0;
  let sumWait = 0, sumAtk = 0, minWait = 99;
  let stateOk = 0, stateAll = 0;
  for (let i = 0; i < 120 * 20; i++) {
    step(fighters);
    for (const e of melee) {
      const d = e.g.position.distanceTo(T.player.pos);
      if (e.tok) { atkFrames++; sumAtk += d; }
      else if (d < T.DIR_MELEE_RING) {
        waitFrames++; sumWait += d;
        minWait = Math.min(minWait, d);
        if (d < T.E_STANDOFF) waitNear++;
        // "engage"는 지금 들어가는 놈의 상태다. 대기 중인 적이 그걸 달고 있으면
        // 리그가 대기 자세를 안 잡는다. swing은 예외 — 공격권을 놓는 순간과
        // 휘두르기가 끝나는 순간 사이에 한 프레임 남는다.
        stateAll++;
        if (e.state !== "engage") stateOk++;
      }
    }
  }
  const avgWait = sumWait / Math.max(1, waitFrames);
  const avgAtk = sumAtk / Math.max(1, atkFrames);
  ok(waitFrames > 0 && atkFrames > 0, "대기하는 적과 들어오는 적이 둘 다 있었다",
     `대기 ${waitFrames} / 공격권 ${atkFrames} 프레임`);
  ok(avgWait > avgAtk + 2, "기다리는 적이 들어오는 적보다 확실히 뒤에 있다",
     `대기 평균 ${avgWait.toFixed(1)}m vs 공격권 평균 ${avgAtk.toFixed(1)}m`);
  ok(waitNear / waitFrames < 0.02, "기다리는 적이 접근 거리(6m) 안까지 들어오지 않는다",
     `${(waitNear / waitFrames * 100).toFixed(2)}%의 프레임`);
  ok(stateOk === stateAll, "기다리는 적이 교전(engage) 상태를 달고 있지 않다",
     `${stateOk}/${stateAll}`);
  console.log(`       대기 최근접 ${minWait.toFixed(1)}m · 대기 평균 ${avgWait.toFixed(1)}m · 공격권 평균 ${avgAtk.toFixed(1)}m`);
}

console.log("\n===== 7. 맞으면 반응이 보인다 =====");
{
  // 지금까지 적은 맞아도 자세가 그대로였다. 때린 쪽에서 "들어갔다"는 걸
  // 화면으로 알 방법이 피격 플래시(0.16초 번쩍임)뿐이었다.
  const W = globalThis.__win, C = globalThis.__cv;
  const key = c => (W.keydown || []).forEach(f => f({ code: c, repeat: false, preventDefault() {} }));
  const md = b => (C.mousedown || []).forEach(f => f({ button: b, preventDefault() {} }));
  const mu = b => (W.mouseup || []).forEach(f => f({ button: b, preventDefault() {} }));
  const run = n => { for (let i = 0; i < n; i++) { T.update(DT); T.updateCamera(DT); } };

  // 적 하나를 코앞에 세우고 근접 모드로 들어간다 (_melee.mjs와 같은 방식)
  const live = T.enemies.filter(x => !x.dead);
  const e = live.find(x => x.ty.brawler) || live[0];
  for (const o of live) if (o !== e) o.g.position.set(9000, -800, 9000);
  const y = T.groundHeightAt(0, 0);
  e.hp = 400; e.bound = 0; e.grip = 0; e.post = 0; e.postMax = 9999; e.stag = 0; e.postHold = 0;
  e.hitT = 0; e.swing = null; e.knock.set(0, 0, 0);
  e.g.position.set(0, y, 4);
  T.player.pos.set(0, y, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0, 0, 0); T.setClinging(null); T.releaseWeb();
  T.aimYaw(0); T.setPitch(0); T.setLock(e); T.setStam(100); T.clearMelee();
  T.syncWorld();
  for (let i = 0; i < 4 && !T.meleeMode; i++) key("Tab");
  run(30);
  T.updateRigs(DT);

  const rest = e.rig ? e.rig.armL.piv.rotation.x : null;
  ok(!!e.rig, "적에게 팔다리 리그가 붙어 있다");

  const hp0 = e.hp;
  md(0); mu(0);
  let peak = 0;
  for (let i = 0; i < 60; i++) { T.update(DT); T.updateCamera(DT); peak = Math.max(peak, e.hitT); }
  ok(e.hp < hp0, "약공격이 실제로 들어갔다", `hp ${hp0} -> ${e.hp}`);
  ok(peak > 0.9, "맞은 순간 피격 반응이 걸린다", `최대 hitT ${peak.toFixed(2)}`);

  // 자세가 실제로 달라지는가
  e.hitT = 1; e.swing = null;
  T.updateRigs(DT);
  const hitPose = e.rig.armL.piv.rotation.x;
  ok(Math.abs(hitPose - rest) > 0.3, "피격 자세가 평상시와 확실히 다르다",
     `평상시 ${rest.toFixed(2)} -> 피격 ${hitPose.toFixed(2)}`);
  ok(e.rig.torso.rotation.x < -0.2, "상체가 뒤로 젖혀진다", `lean ${e.rig.torso.rotation.x.toFixed(2)}`);

  // 반응은 짧아야 한다. 길면 다음 동작을 잡아먹어 굼떠 보인다.
  e.hitT = 1;
  let secs = 0;
  for (let i = 0; i < 120 * 2 && e.hitT > 0; i++) { T.update(DT); secs += DT; }
  ok(secs > 0.15 && secs < 0.45, "반응이 짧게 끝난다", `${secs.toFixed(2)}초 (설정 ${T.HIT_REACT})`);

  // 휘두르는 중에 맞아도 예고 동작은 안 끊긴다
  e.hitT = 1;
  e.swing = { kind: 1, t: 0.4, done: false };
  T.updateRigs(DT);
  const swingPose = e.rig.armR.piv.rotation.x;
  e.hitT = 0;
  T.updateRigs(DT);
  ok(Math.abs(swingPose - e.rig.armR.piv.rotation.x) < 1e-6,
     "휘두르는 중에는 피격 자세가 예고 동작을 덮지 않는다",
     `맞은 채 ${swingPose.toFixed(3)} vs 안 맞은 채 ${e.rig.armR.piv.rotation.x.toFixed(3)}`);
  e.swing = null;
}

console.log("\n===== 8. 난이도 안전망 =====");
{
  // Director는 동시에 덤비는 인원을 줄인다. 줄이는 게 목적이지만 너무 줄면
  // 그냥 쉬운 게임이 된다. 18명에게 둘러싸여 가만히 서 있을 때 몇 초를
  // 버티는지 못 박아둔다 — 나중에 상한이나 쿨다운을 만졌을 때 균형이 어디로
  // 갔는지 이 숫자 하나로 바로 보인다.
  const fighters = setupFight();
  T.setHp(T.MAX_HP);
  T.setInvuln(0);
  let t = 0;
  for (let i = 0; i < 120 * 90 && T.deadT <= 0; i++) {
    T.player.pos.set(0, SKY, 0);          // step()과 달리 무적을 주지 않는다
    T.player.prevPos.copy(T.player.pos);
    T.player.renderPos.copy(T.player.pos);
    T.player.vel.set(0, 0, 0);
    for (const e of fighters) { e.g.position.y = SKY; e.knock.set(0, 0, 0); }
    T.update(DT);
    for (const e of fighters) { e.g.position.y = SKY; e.knock.set(0, 0, 0); }
    t += DT;
  }
  const died = T.deadT > 0;
  ok(died, "18명에게 둘러싸여 가만히 있으면 죽는다 (Director가 게임을 무르게 만들지 않았다)",
     `${t.toFixed(1)}초 뒤에도 살아있음`);
  ok(t > 2, "그래도 즉사는 아니다 (피할 시간이 있다)", `${t.toFixed(1)}초`);
  console.log(`       가만히 서서 버틴 시간 ${t.toFixed(1)}초 (체력 ${T.MAX_HP}칸)`);
  T.setHp(T.MAX_HP);
}

console.log(`\n통과 ${pass} / 실패 ${fail}`);
