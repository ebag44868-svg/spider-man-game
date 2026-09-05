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

console.log(`\n통과 ${pass} / 실패 ${fail}`);
