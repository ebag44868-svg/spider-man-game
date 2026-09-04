import { T } from "./_harness.mjs";
const DT = 1/120;
T.syncWorld();
const W = globalThis.__win, C = globalThis.__cv;
const key = c => (W.keydown||[]).forEach(f => f({ code: c, repeat: false, preventDefault(){} }));
const md  = b => (C.mousedown||[]).forEach(f => f({ button: b, preventDefault(){} }));
let pass=0, fail=0;
const ok=(c,m,x="")=>{ if(c){pass++;console.log("  OK   "+m);} else {fail++;console.log("  FAIL "+m+"  "+x);} };
const run = n => { for(let i=0;i<n;i++){ T.update(DT); T.updateCamera(DT); } };

for (let i=0;i<4 && !T.meleeMode; i++) key("Tab");

// 격투병 하나를 코앞에 세운다
function stageBrawler(dist = 6) {
  const live = T.enemies.filter(x => !x.dead);
  let e = live.find(x => x.ty.brawler) || T.enemies.find(x => x.ty.brawler);
  if (!e) return null;
  e.dead = false; e.deadT = 0;      // 죽은 격투병을 되살려 표본이 줄지 않게 한다
  for (const o of live) if (o !== e) o.g.position.set(9000, -800, 9000);
  const y = T.groundHeightAt(0, 0);
  e.hp = 99; e.bound = 0; e.grip = 0; e.post = 0; e.stag = 0; e.postHold = 0;
  e.knock.set(0,0,0); e.swing = null; e.fireCd = 0; e.lastBrawl = -1;
  e.g.position.set(0, y, dist);
  T.player.pos.set(0, y, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0,0,0); T.setClinging(null); T.releaseWeb();
  T.aimYaw(0); T.setPitch(0);
  T.setLock(e); T.setStam(100); T.clearMelee();
  T.syncWorld();
  return e;
}

console.log("===== 격투병이 존재한다 =====");
const brawlers = T.enemies.filter(e => e.ty.brawler);
ok(brawlers.length > 0, "도시에 격투병이 섞여 있다", `${brawlers.length} / ${T.enemies.length}명`);
ok(brawlers[0].postMax >= 120, "격투병은 체간이 두껍다", `체간 상한 ${brawlers[0].postMax}`);

console.log("\n===== 실제로 휘두른다 =====");
let e = stageBrawler(6);
if (!e) { console.log("격투병 없음 — 생략"); }
else {
  let swung = false;
  for (let i=0;i<120*3 && !swung;i++){ T.update(DT); if (e.swing) swung = true; }
  ok(swung, "사거리 안에 들어오면 휘두른다", swung ? T.BRAWL[e.swing.kind].name : "");
  ok(e.swing && e.swing.t < T.BRAWL[e.swing.kind].hitAt, "판정 전에 예고 구간이 있다",
     e.swing ? `${e.swing.t.toFixed(2)}s / 판정 ${T.BRAWL[e.swing.kind].hitAt}s` : "");
}

console.log("\n===== 패턴 3개가 다 나온다 =====");
const seen = new Set();
for (let n = 0; n < 200 && seen.size < 3; n++) {
  const t = stageBrawler(6);
  if (!t) break;
  for (let i=0;i<120*4 && !t.swing;i++) T.update(DT);
  if (t.swing) seen.add(t.swing.kind);
}
ok(seen.size === 3, "가로베기·내리침·지연 세 패턴이 모두 나온다", `나온 패턴 ${[...seen].map(k=>T.BRAWL[k].name).join(", ")}`);

console.log("\n===== 파란 공격은 쳐낼 수 있다 =====");
// 쳐낼 수 있는 패턴만 골라 강제로 걸고, 판정 직전에 E를 친다
function forceSwing(kind) {
  const t = stageBrawler(6);
  if (!t) return null;
  t.swing = { kind, t: 0, done: false };
  return t;
}
e = forceSwing(0);
if (e) {
  const spec = T.BRAWL[0];
  const hp0 = T.hp, post0 = e.post;
  // 판정 직전까지 돌린다
  while (e.swing && e.swing.t < spec.hitAt - T.PARRY_WIN * 0.5) T.update(DT);
  key("KeyE");
  run(Math.ceil(T.PARRY_WIN * 120) + 4);
  ok(T.hp === hp0, "가로베기를 쳐내면 피해를 안 입는다", `hp ${hp0} -> ${T.hp}`);
  ok(e.post > post0 + T.PARRY_POST - 1, "쳐내면 격투병 체간이 크게 무너진다", `체간 ${post0} -> ${e.post.toFixed(0)}`);
}

console.log("\n===== 붉은 공격은 못 막는다 =====");
e = forceSwing(2);
if (e) {
  const spec = T.BRAWL[2];
  ok(!spec.parry, "지연 패턴은 패링 불가로 설정돼 있다");
  const hp0 = T.hp;
  while (e.swing && e.swing.t < spec.hitAt - T.PARRY_WIN * 0.5) T.update(DT);
  key("KeyE");
  run(Math.ceil((T.PARRY_WIN + 0.3) * 120));
  ok(T.hp < hp0, "붉은 공격은 쳐내려 해도 그대로 맞는다", `hp ${hp0} -> ${T.hp}`);
}

console.log("\n===== 붉은 공격도 구르면 피한다 =====");
e = forceSwing(2);
if (e) {
  const spec = T.BRAWL[2];
  const hp0 = T.hp;
  // 판정 직전에 구른다 (무적 구간이 판정을 덮게)
  while (e.swing && e.swing.t < spec.hitAt - T.ROLL_IFR * 0.5) T.update(DT);
  T.setStam(100);
  T.keys["KeyS"] = true;
  key("ShiftLeft");
  run(Math.ceil(T.ROLL_IFR * 120));
  T.keys["KeyS"] = false;
  ok(T.hp === hp0, "구르기 무적으로 붉은 공격을 넘긴다", `hp ${hp0} -> ${T.hp}`);
}

console.log("\n===== 맞으면 아프다 =====");
e = forceSwing(1);
if (e) {
  const hp0 = T.hp;
  run(Math.ceil(T.BRAWL[1].dur * 120) + 6);
  ok(T.hp < hp0, "가만히 있으면 내리침에 맞는다", `hp ${hp0} -> ${T.hp}`);
}

console.log("\n===== 붕괴하면 멈춘다 =====");
e = stageBrawler(6);
if (e) {
  T.addPosture(e, e.postMax);
  ok(e.stag > 0, "체간을 채우면 붕괴한다");
  e.swing = null; e.fireCd = 0;
  run(120 * 2);
  ok(!e.swing, "붕괴한 격투병은 휘두르지 못한다");
  ok(e.state === "stagger", "상태가 붕괴로 바뀐다", `state=${e.state}`);
}

console.log(`\n통과 ${pass} / 실패 ${fail}`);
