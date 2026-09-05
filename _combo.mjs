// 콤보 갈래.
//
// 지금까지 근접은 약공격 3타 한 줄뿐이라 어떻게 쳐도 같은 그림이 나왔다.
// 강공격을 "언제 넣느냐"로 결과가 갈리게 했다.
//   강 (mChain 0) 차징 강타 · 약강 (1) 밀어내기 · 약약강 (2) 띄우기
//
// 새 상태는 안 만들었다. 이미 있던 mChain(이어친 약공격 수)이 곧 입력 순서다.
import { T } from "./_harness.mjs";
const DT = 1 / 120;
T.syncWorld();

const W = globalThis.__win, C = globalThis.__cv;
const key = c => (W.keydown || []).forEach(f => f({ code: c, repeat: false, preventDefault() {} }));
const md = b => (C.mousedown || []).forEach(f => f({ button: b, preventDefault() {} }));
const mu = b => (W.mouseup || []).forEach(f => f({ button: b, preventDefault() {} }));

let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };
const run = n => { for (let i = 0; i < n; i++) { T.update(DT); T.updateCamera(DT); } };

// 적 하나를 코앞에 세운다 (_melee.mjs와 같은 방식). 체간은 안 무너지게 크게 잡는다 —
// 무너지면 강공격이 처형으로 바뀌어 갈래 시험이 안 된다.
function stage(dist = 4) {
  const live = T.enemies.filter(x => !x.dead);
  const e = live[0];
  for (const o of live) if (o !== e) o.g.position.set(9000, -800, 9000);
  const y = T.groundHeightAt(0, 0);
  e.hp = 9999; e.bound = 0; e.grip = 0; e.post = 0; e.postMax = 99999; e.stag = 0; e.postHold = 0;
  e.hitT = 0; e.swing = null; e.aimT = 0; e.tok = false;
  e.knock.set(0, 0, 0);
  e.g.position.set(0, y, dist);
  T.player.pos.set(0, y, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0, 0, 0); T.setClinging(null); T.releaseWeb();
  T.aimYaw(0); T.setPitch(0);
  T.setLock(e); T.setStam(100);
  T.clearMelee();
  T.syncWorld();
  return e;
}

// 한 방을 내보내고 그 방의 갈래·스펙을 잡아 돌려준다.
// hold = 좌클릭을 문 시간(초). CHARGE_MIN(0.33) 이상이면 강공격이 된다.
function swing(hold) {
  md(0);
  if (hold > 0) run(Math.ceil(hold * 120));
  mu(0);
  let seen = null;
  for (let i = 0; i < 200; i++) {
    T.update(DT); T.updateCamera(DT);
    if (T.mAtk && !seen) seen = { branch: T.mAtk.branch, spec: T.mAtk.spec, heavy: T.mAtk.heavy };
    if (seen && !T.mAtk) break;
  }
  return seen;
}
const light = () => swing(0);
const heavy = () => swing(0.36);

for (let i = 0; i < 4 && !T.meleeMode; i++) key("Tab");
ok(T.meleeMode, "근접 격투 모드로 들어갔다");

console.log("\n===== 1. 약공격 3타는 예전 그대로다 =====");
{
  stage();
  const a = light(), b = light(), c = light();
  ok(a.spec === T.M_LIGHT[0], "1타 = M_LIGHT[0]", a.branch);
  ok(b.spec === T.M_LIGHT[1], "2타 = M_LIGHT[1]", b.branch);
  ok(c.spec === T.M_LIGHT[2], "3타 = M_LIGHT[2]", c.branch);
  ok(a.branch === "light" && c.branch === "light", "약공격은 갈래가 안 생긴다");
  // 회귀: 3타 총합이 표 값과 같다
  const dmg = T.M_LIGHT.reduce((s, x) => s + x.dmg, 0);
  const post = T.M_LIGHT.reduce((s, x) => s + x.post, 0);
  ok(dmg === 4 && post === 42, "약 3타 총 피해 4 / 총 체간 42 (예전 값 그대로)", `${dmg} / ${post}`);
}

console.log("\n===== 2. 강공격이 넣는 시점에 따라 갈린다 =====");
{
  stage();
  const h0 = heavy();
  ok(h0.branch === "heavy" && h0.spec.launch === undefined, "강 (체인 없음) = 차징 강타", h0.branch);

  stage();
  light();
  const h1 = heavy();
  ok(h1.branch === "shove", "약강 = 밀어내기", h1.branch);
  ok(h1.spec.kb > T.M_HEAVY.kb, "밀어내기가 강타보다 훨씬 크게 민다",
     `kb ${h1.spec.kb} vs 강타 ${T.M_HEAVY.kb}`);

  stage();
  light(); light();
  const h2 = heavy();
  ok(h2.branch === "launch", "약약강 = 띄우기", h2.branch);
  ok(h2.spec.launch > 0, "띄우기는 위로 올리는 세기를 따로 갖는다", `launch ${h2.spec.launch}`);

  stage();
  light(); light(); light();
  const h3 = heavy();
  ok(h3.branch === "heavy", "약약약 뒤의 강은 다시 차징 강타다 (체인이 한 바퀴 돌았다)", h3.branch);
}

console.log("\n===== 3. 띄우기가 실제로 적을 띄운다 =====");
{
  const e = stage(4);
  light(); light();
  // 띄우는 순간의 세로 속도를 잡는다
  md(0); run(Math.ceil(0.36 * 120)); mu(0);
  let peakY = 0, peakUp = 0;
  const y0 = e.g.position.y;
  for (let i = 0; i < 240; i++) {
    T.update(DT); T.updateCamera(DT);
    peakUp = Math.max(peakUp, e.knock.y);
    peakY = Math.max(peakY, e.g.position.y - y0);
  }
  ok(peakUp > 20, "띄우는 순간 위로 미는 힘이 걸린다", `knock.y 최대 ${peakUp.toFixed(1)}`);
  ok(peakY > 2, "적이 실제로 떠오른다", `최고 ${peakY.toFixed(2)}m`);
  ok(Math.abs(e.g.position.y - y0) < 0.5, "떴다가 다시 착지한다", `착지 후 ${(e.g.position.y - y0).toFixed(2)}m`);

  // 대조군: 그냥 약공격은 이만큼 안 뜬다
  const e2 = stage(4);
  const z0 = e2.g.position.y;
  let plainY = 0;
  light();
  for (let i = 0; i < 240; i++) { T.update(DT); T.updateCamera(DT); plainY = Math.max(plainY, e2.g.position.y - z0); }
  ok(plainY < peakY * 0.5, "약공격만으로는 그만큼 안 뜬다", `약 ${plainY.toFixed(2)}m vs 띄우기 ${peakY.toFixed(2)}m`);
}

console.log("\n===== 4. 갈래를 쓰면 체인이 초기화된다 =====");
{
  stage();
  light(); light();
  ok(T.mChain === 2, "약 2타 뒤 체인이 2다", `mChain ${T.mChain}`);
  heavy();
  ok(T.mChain === 0, "갈래(띄우기)를 쓰면 체인이 풀린다", `mChain ${T.mChain}`);
}

console.log("\n===== 5. 차징하는 동안에는 체인이 안 끊긴다 =====");
{
  // 약약 뒤에 0.36초를 물어야 띄우기가 나가는데, 그동안 체인(0.65초)이 풀리면
  // 갈래를 낼 방법이 아예 없어진다.
  stage();
  light(); light();
  const c0 = T.mChain;
  md(0);
  run(Math.ceil(0.6 * 120));          // 체인 유지시간(0.65)에 가깝게 문다
  ok(T.mChain === c0, "0.6초를 물고 있어도 체인이 그대로다", `${c0} -> ${T.mChain}`);
  mu(0);
  let seen = null;
  for (let i = 0; i < 200; i++) { T.update(DT); T.updateCamera(DT); if (T.mAtk && !seen) seen = T.mAtk.branch; if (seen && !T.mAtk) break; }
  ok(seen === "launch", "오래 물었어도 띄우기가 나간다", seen);

  // 반대로 안 물고 가만히 두면 체인은 풀려야 한다
  stage();
  light(); light();
  run(Math.ceil(T.M_CHAIN_T * 120) + 20);
  ok(T.mChain === 0, "가만히 두면 체인이 시간에 풀린다", `mChain ${T.mChain}`);
}

console.log("\n===== 6. 뜬 적은 아무것도 못 한다 =====");
{
  // 띄우기의 보상은 피해가 아니라 '그동안 아무것도 못 한다'는 것이다.
  // 지금까지는 띄워놔도 공중에서 걸어다니고 공격했다.
  const e = stage(4);
  const x0 = e.g.position.x, z0 = e.g.position.z;
  T.launchEnemy(e, 30);
  ok(e.air > 0, "띄우면 공중 상태가 된다", `air ${e.air}`);
  ok(!e.tok, "띄우는 순간 공격권을 잃는다");

  let swung = 0, moved = 0, states = new Set();
  for (let i = 0; i < 120 * 2 && e.air > 0; i++) {
    e.tok = true;                       // 억지로 공격권을 줘도
    T.update(DT); T.updateCamera(DT);
    if (e.swing || e.aimT > 0) swung++;
    states.add(e.state);
    moved = Math.max(moved, Math.hypot(e.g.position.x - x0, e.g.position.z - z0));
  }
  ok(swung === 0, "뜬 동안에는 공격을 시작하지 않는다 (공격권을 억지로 줘도)", `${swung}프레임`);
  ok(states.has("air"), "상태가 air로 잡힌다", [...states].join(","));
  ok(moved < 1.0, "뜬 동안 걸어다니지 않는다", `${moved.toFixed(2)}m 이동`);

  ok(e.down > 0, "착지하면 다운 경직이 걸린다", `down ${e.down.toFixed(2)}`);
  let downSwung = 0;
  while (e.down > 0) { e.tok = true; T.update(DT); T.updateCamera(DT); if (e.swing || e.aimT > 0) downSwung++; }
  ok(downSwung === 0, "다운 중에도 공격을 시작하지 않는다", `${downSwung}프레임`);

  // 다운이 풀리면 돌아온다
  T.update(DT);
  ok(e.air === 0 && e.down === 0, "다운이 풀리면 평소 상태로 돌아온다");
}

console.log("\n===== 7. 무한 저글링은 안 된다 =====");
{
  const e = stage(4);
  const ups = [];
  for (let i = 0; i < T.AIR_HITS + 3; i++) {
    e.knock.y = 0;
    const okLaunch = T.launchEnemy(e, 30);
    ups.push(okLaunch ? +e.knock.y.toFixed(1) : null);
  }
  const landed = ups.filter(v => v !== null);
  ok(landed.length === T.AIR_HITS, `공중에서 ${T.AIR_HITS}번까지만 띄운다`, `${landed.length}번`);
  ok(ups.slice(T.AIR_HITS).every(v => v === null), "상한을 넘으면 아예 안 뜬다", JSON.stringify(ups));
  let falling = true;
  for (let i = 1; i < landed.length; i++) if (landed[i] >= landed[i - 1]) falling = false;
  ok(falling, "연달아 띄울수록 낮아진다", landed.join(" -> "));

  // 착지하면 횟수가 초기화된다
  for (let i = 0; i < 120 * 4 && (e.air > 0 || e.down > 0); i++) { T.update(DT); T.updateCamera(DT); }
  ok(e.airHits === 0, "착지하면 띄운 횟수가 초기화된다", `airHits ${e.airHits}`);
}

console.log("\n===== 8. 안전장치: 영영 떠 있지 않는다 =====");
{
  const e = stage(4);
  T.launchEnemy(e, 30);
  // 중력이 안 먹는 상황을 흉내낸다 — 매 스텝 위로 다시 밀어올린다
  let t = 0;
  for (let i = 0; i < 120 * 6 && e.air > 0; i++) {
    e.knock.y = 40;
    T.update(DT); T.updateCamera(DT);
    t += DT;
  }
  ok(e.air === 0, "AIR_MAX가 지나면 강제로 내려온다", `${t.toFixed(2)}초`);
  ok(t <= T.AIR_MAX + 0.2, `${T.AIR_MAX}초 안에 끝난다`, `${t.toFixed(2)}초`);
}

console.log("\n===== 9. 공중/다운 자세가 실제로 다르다 =====");
{
  const e = stage(4);
  for (let i = 0; i < 30; i++) { T.update(DT); T.updateCamera(DT); }
  T.updateRigs(DT);
  ok(!!e.rig, "리그가 붙어 있다");
  e.air = 0; e.down = 0; e.hitT = 0; e.swing = null;
  T.updateRigs(DT);
  const rest = { arm: e.rig.armL.piv.rotation.x, torso: e.rig.torso.rotation.x };

  e.air = 0.5;
  T.updateRigs(DT);
  const air = { arm: e.rig.armL.piv.rotation.x, torso: e.rig.torso.rotation.x };
  ok(air.arm < rest.arm - 1.0, "공중에서는 팔이 위로 흩어진다", `${rest.arm.toFixed(2)} -> ${air.arm.toFixed(2)}`);
  ok(air.torso < -0.3, "공중에서는 상체가 젖혀진다", `lean ${air.torso.toFixed(2)}`);

  e.air = 0; e.down = 0.5;
  T.updateRigs(DT);
  const down = { arm: e.rig.armL.piv.rotation.x, torso: e.rig.torso.rotation.x };
  ok(down.torso > 0.5, "다운에서는 상체가 앞으로 꺾인다", `lean ${down.torso.toFixed(2)}`);
  ok(Math.abs(down.arm - air.arm) > 1.0, "공중 자세와 다운 자세가 다르다",
     `공중 ${air.arm.toFixed(2)} vs 다운 ${down.arm.toFixed(2)}`);
  e.down = 0;
}

console.log(`\n통과 ${pass} / 실패 ${fail}`);
