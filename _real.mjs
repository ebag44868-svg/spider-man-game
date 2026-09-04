import { T } from "./_harness.mjs";
const DT = 1/120;
T.syncWorld();
const W = globalThis.__win, C = globalThis.__cv;
const key = c => (W.keydown||[]).forEach(f => f({ code: c, repeat: false, preventDefault(){} }));
const md  = b => (C.mousedown||[]).forEach(f => f({ button: b, preventDefault(){} }));
const mu  = b => (W.mouseup||[]).forEach(f => f({ button: b, preventDefault(){} }));
const run = n => { for(let i=0;i<n;i++){ T.update(DT); T.updateCamera(DT); } };
let pass=0, fail=0;
const ok=(c,m,x="")=>{ if(c){pass++;console.log("  OK   "+m);} else {fail++;console.log("  FAIL "+m+"  "+x);} };

// 실전 그대로: 락온을 안 걸고, 땅에 서서, 앞에 있는 적을 친다
function real(dist, yawOff = 0) {
  const live = T.enemies.filter(x => !x.dead);
  const e = live[0];
  for (const o of live) if (o !== e) o.g.position.set(9000, -800, 9000);
  const y = T.groundHeightAt(0, 0);
  e.hp = 99; e.bound = 0; e.grip = 0; e.post = 0; e.stag = 0; e.postHold = 0;
  e.knock.set(0,0,0); e.swing = null; e.fireCd = 99;   // 적은 가만히 있게
  e.g.position.set(0, y, dist);
  T.player.pos.set(0, y, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0,0,0); T.setClinging(null); T.releaseWeb();
  T.aimYaw(yawOff); T.setPitch(0);
  T.setLock(null);          // ★ 락온 없음 — 실전 기본 상태
  T.setStam(100); T.clearMelee();
  run(30);                  // 땅에 안착
  T.syncWorld();
  return e;
}

for (let i=0;i<4 && !T.meleeMode; i++) key("Tab");
console.log("===== 락온 없이 (실전 기본) =====");
ok(T.meleeMode, "TAB 두 번이면 근접 격투 모드");
ok(T.lockOn === null, "락온은 걸려 있지 않다");

// 적이 달려와서 맞는 것과 내 공격이 닿는 것을 구분해야 한다.
// 적을 매 틱 제자리에 못박고, 파고드는 거리만으로 닿는지를 잰다.
for (const dist of [3, 5, 6, 7, 9, 12, 16]) {
  const e = real(dist);
  const fix = e.g.position.clone();
  const h0 = e.hp;
  md(0); mu(0);
  const n = Math.ceil(T.M_LIGHT[0].dur * 120) + 6;
  for (let i=0;i<n;i++){ e.g.position.copy(fix); e.knock.set(0,0,0); T.update(DT); T.updateCamera(DT); }
  const hit = e.hp < h0;
  const closed = dist - T.player.pos.distanceTo(fix);
  console.log(`  ${dist}m 정면 약공격: ${hit ? "명중" : "빗나감"}  (파고든 거리 ${closed.toFixed(1)}m, 사거리 ${T.M_LIGHT[0].r}m)`);
}
let e = real(5);
let h0 = e.hp;
md(0); mu(0);
run(Math.ceil(T.M_LIGHT[0].dur * 120) + 6);
ok(e.hp < h0, "락온 없이도 정면 5m 적을 친다", `hp ${h0} -> ${e.hp}`);

console.log("\n===== 옆/뒤는 안 맞아야 한다 =====");
for (const [deg, want] of [[0,true],[30,true],[60,false],[120,false],[180,false]]) {
  const t = real(5, deg * Math.PI / 180);
  const a = t.hp;
  md(0); mu(0);
  run(Math.ceil(T.M_LIGHT[0].dur * 120) + 6);
  const hit = t.hp < a;
  console.log(`  시선 ${deg}도 어긋남: ${hit ? "명중" : "빗나감"} ${hit === want ? "" : "  <-- 기대와 다름"}`);
}

console.log("\n===== 연타로 3타가 실제로 이어지나 =====");
e = real(5);
h0 = e.hp;
let landed = 0;
for (let n = 0; n < 3; n++) {
  const a = e.hp;
  md(0); mu(0);
  run(Math.ceil(T.M_LIGHT[Math.min(n,2)].dur * 120) + 4);
  if (e.hp < a) landed++;
}
ok(landed === 3, "약공격 3타가 전부 들어간다", `${landed}/3  총 피해 ${h0 - e.hp}`);

console.log("\n===== 공중에서도 나가나 =====");
e = real(5);
T.player.pos.y += 40; T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
T.player.vel.set(0,0,0);
e.g.position.y = T.player.pos.y;
// 판정이 조준선(카메라 -> 커서) 기준이라 카메라가 자리를 잡아야 의미가 있다.
for (let i=0;i<300;i++) T.updateCamera(DT);
T.syncWorld();
h0 = e.hp;
md(0); mu(0);
run(Math.ceil(T.M_LIGHT[0].dur * 120) + 6);
ok(e.hp < h0, "공중에서도 근접 공격이 나간다", `hp ${h0} -> ${e.hp}`);

console.log("\n===== 3인칭 근접 공격에 눈에 보이는 모션이 있나 =====");
e = real(5);
const rot0 = T.spiderRotX, pt0 = T.punchT;
md(0); mu(0);
run(8);
ok(T.spiderRotX !== rot0 || T.punchT > pt0 || T.swingFx > 0,
   "휘두르는 동안 화면에 뭔가 움직인다",
   `spiderRotX=${T.spiderRotX} punchT=${T.punchT} swingFx=${T.swingFx}`);

console.log(`\n통과 ${pass} / 실패 ${fail}`);

console.log("\n===== X키 주먹 (근접 모드 밖) =====");
for (let i=0;i<4 && (T.meleeMode || T.attackMode); i++) key("Tab");   // 웹스윙으로
ok(!T.meleeMode && !T.attackMode, "웹스윙 모드");
for (const fp of [true, false]) {
  T.setFP(fp);
  const t = real(4);
  T.setFP(fp);
  for (let i=0;i<300;i++) T.updateCamera(DT);      // 카메라를 완전히 정착시킨다
  T.syncWorld();
  const fix = t.g.position.clone();
  const a = t.hp;
  key("KeyX");
  for (let i=0;i<50;i++){ t.g.position.copy(fix); t.knock.set(0,0,0); T.update(DT); T.updateCamera(DT); }
  ok(t.hp < a, `${fp?"1인칭":"3인칭"} X키 주먹이 4m 적에게 닿는다`, `hp ${a} -> ${t.hp}`);
}

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
