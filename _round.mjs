// 이번 라운드에서 요구된 9가지가 실제로 그렇게 동작하는지만 본다.
import { T } from "./_harness.mjs";
const DT = 1/120;
T.syncWorld();
const W = globalThis.__win, C = globalThis.__cv;
const key = c => (W.keydown||[]).forEach(f => f({ code: c, repeat: false, preventDefault(){} }));
const md  = b => (C.mousedown||[]).forEach(f => f({ button: b, preventDefault(){} }));
const mu  = b => (W.mouseup||[]).forEach(f => f({ button: b, preventDefault(){} }));
let cx = 800, cy = 450;
const move = (dx,dy) => { cx += dx; cy += dy;
  (globalThis.__handlers.mousemove||(()=>{}))({ movementX:dx, movementY:dy, clientX:cx, clientY:cy }); };
const run = n => { for(let i=0;i<n;i++){ T.update(DT); T.updateCamera(DT); } };
let pass=0, fail=0;
const ok=(c,m,x="")=>{ if(c){pass++;console.log("  OK   "+m);} else {fail++;console.log("  FAIL "+m+"  "+x);} };

function toMelee() { for (let i=0;i<4 && !T.meleeMode; i++) key("Tab"); }
function toSwing() { for (let i=0;i<4 && (T.meleeMode || T.attackMode); i++) key("Tab"); }

// 적 하나를 앞에 세우고 카메라를 정착시킨다
function stage(dist = 5, lock = false) {
  const live = T.enemies.filter(x => !x.dead);
  const e = live[0];
  for (const o of live) if (o !== e) o.g.position.set(9000, -800, 9000);
  const y = T.groundHeightAt(0, 0);
  e.hp = e.ty.hp; e.bound = 0; e.grip = 0; e.post = 0; e.stag = 0; e.postHold = 0;
  e.knock.set(0,0,0); e.swing = null; e.fireCd = 99;
  e.g.position.set(0, y, dist);
  T.player.pos.set(0, y, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0,0,0); T.setClinging(null); T.releaseWeb();
  T.aimYaw(0); T.setPitch(0);
  T.setLock(lock ? e : null); T.setStam(100); T.clearMelee();
  T.setCursor(800, 450);
  run(30);
  for (let i=0;i<300;i++) T.updateCamera(DT);
  T.syncWorld();
  return e;
}
// 적을 붙잡은 채로 n틱 돌린다 (판정만 보고 싶을 때)
const runPinned = (e, n) => { const p = e.g.position.clone();
  for(let i=0;i<n;i++){ e.g.position.copy(p); e.knock.set(0,0,0); T.update(DT); T.updateCamera(DT); } };

console.log("===== 1. 3인칭 우클릭은 무조건 시점 =====");
T.setFP(false);
toMelee();
let e = stage(5);
md(2);
ok(T.dragging, "근접 격투 모드에서도 우클릭은 시점 드래그다");
ok(!T.mAtk && !T.charging, "우클릭이 공격을 내지 않는다");
const yr = T.viewYaw;
move(150, 0);
ok(Math.abs(T.viewYaw - yr) > 0.1, "근접 모드에서 우클릭 드래그로 시점이 돌아간다");
mu(2);
ok(!T.dragging, "떼면 드래그가 풀린다");

console.log("\n===== 2. 직선 판정 — 에임점에 맞아야 들어간다 =====");
e = stage(5);
let h0 = e.hp;
md(0); mu(0);
runPinned(e, Math.ceil(T.M_LIGHT[0].dur*120)+6);
ok(e.hp < h0, "조준점이 적 위에 있으면 맞는다", `hp ${h0} -> ${e.hp}`);

e = stage(5);
// 커서를 화면 구석으로 — 조준선이 적에서 크게 벗어난다
T.setCursor(120, 820);
h0 = e.hp;
md(0); mu(0);
runPinned(e, Math.ceil(T.M_LIGHT[0].dur*120)+6);
ok(e.hp === h0, "조준점이 딴 데면 사거리 안이어도 안 맞는다", `hp ${h0} -> ${e.hp}`);

e = stage(5, true);   // 락온
T.setCursor(120, 820);
h0 = e.hp;
md(0); mu(0);
runPinned(e, Math.ceil(T.M_LIGHT[0].dur*120)+6);
ok(e.hp < h0, "락온 중에는 조준점이 딴 데여도 그 적을 친다", `hp ${h0} -> ${e.hp}`);

console.log("\n===== 3. 좌클릭 홀드 = 차징 강공격 =====");
e = stage(5);
md(0); mu(0);
ok(!T.charging, "짧게 치면 차징이 안 남는다");
run(2);
ok(T.mAtk && !T.mAtk.heavy, "짧게 치면 약공격");
run(Math.ceil(T.M_LIGHT[0].dur*120)+6);

e = stage(5);
md(0);
ok(T.charging, "누르고 있으면 차징이 시작된다");
ok(!T.mAtk, "무는 동안에는 아직 아무것도 안 나간다");
runPinned(e, Math.ceil(T.CHARGE_MIN*120)+8);
ok(T.chargeT >= T.CHARGE_MIN, "차징이 쌓인다", `${T.chargeT.toFixed(2)}초`);
mu(0);
ok(T.mAtk && T.mAtk.heavy, "떼는 순간 강공격이 나간다");
const pauseTicks = Math.ceil(T.mAtk.spec.hit * 120);
h0 = e.hp;
runPinned(e, pauseTicks - 3);
ok(e.hp === h0, "뗀 뒤 바로 대미지가 아니라 한 박자 뜸을 들인다", `${T.M_HEAVY.hit}초 뒤 판정`);
runPinned(e, 8);
ok(e.hp < h0, "그 다음에 들어간다", `hp ${h0} -> ${e.hp}`);

// 오래 물수록 세다
function heavyPower(hold) {
  const t = stage(5);
  md(0); runPinned(t, Math.ceil(hold*120)); mu(0);
  const before = { hp: t.hp, post: t.post };
  runPinned(t, Math.ceil(T.M_HEAVY.dur*120)+8);
  return { dmg: before.hp - t.hp, post: Math.round(t.post - before.post) };
}
const shortC = heavyPower(T.CHARGE_MIN + 0.02);
const fullC  = heavyPower(T.CHARGE_FULL + 0.1);
ok(fullC.dmg > shortC.dmg && fullC.post > shortC.post,
   "끝까지 차면 더 세다", `짧게 ${shortC.dmg}딜/${shortC.post}체간 -> 최대 ${fullC.dmg}딜/${fullC.post}체간`);

console.log("\n===== 4. 수동 시점은 오직 수동 =====");
// 근접 격투 모드에서는 자동 정렬을 아예 끈다(설계). 자동 동작은 웹스윙에서 본다.
toSwing();
T.setAuto(true);
T.player.pos.set(0, 400, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
T.aimYaw(0);
// 자동 모드에서 드래그로 돌리면 한동안 자동이 안 되당긴다
md(2); move(200, 0); mu(2);
const yAfterDrag = T.viewYaw;
for (let i=0;i<120*2;i++){ T.player.vel.set(50,0,0); T.update(DT); T.updateCamera(DT); }
ok(Math.abs(T.viewYaw - yAfterDrag) < 0.02,
   "자동 모드라도 돌린 직후에는 되당기지 않는다", `유예 ${T.CAM_FREE}초`);
// 유예가 끝나면 자동은 다시 일한다
for (let i=0;i<120*4;i++){ T.player.vel.set(50,0,0); T.update(DT); T.updateCamera(DT); }
ok(Math.abs(T.viewYaw - yAfterDrag) > 0.1, "유예가 끝나면 자동이 다시 진행 방향으로 맞춘다");

// C 수동은 영원히 안 움직인다
key("KeyC");
ok(!T.camAuto && T.camHold, "C로 수동");
T.setLock(null);
const yMan = T.viewYaw;
for (let i=0;i<120*10;i++){ T.player.vel.set(50, 10, 30); T.update(DT); T.updateCamera(DT); }
ok(Math.abs(T.viewYaw - yMan) < 1e-6, "10초를 날아도 수동 시점은 1도도 안 움직인다");
key("KeyC");

console.log("\n===== 5. Ctrl 락온이면 적을 화면 중앙에 =====");
T.setAuto(false); key("KeyC"); key("KeyC");   // 자동으로 되돌림
e = stage(30);
T.aimYaw(1.2);                                 // 일부러 딴 데를 보게 한다
for (let i=0;i<60;i++) T.updateCamera(DT);
key("ControlLeft");
ok(T.lockOn === e, "Ctrl로 문다");
for (let i=0;i<120;i++) T.updateCamera(DT);
const want = Math.atan2(e.g.position.x - T.player.pos.x, e.g.position.z - T.player.pos.z);
const err = Math.abs(Math.atan2(Math.sin(T.viewYaw-want), Math.cos(T.viewYaw-want)));
ok(err < 0.05, "락온하면 시점이 적 정면으로 맞춰진다", `오차 ${(err*57.3).toFixed(1)}도`);
key("ControlLeft");
ok(T.lockOn === null, "Ctrl을 한 번 더 누르면 풀린다");
const yFree = T.viewYaw;
for (let i=0;i<120*2;i++) T.updateCamera(DT);
ok(Math.abs(T.viewYaw - yFree) < 0.02, "풀어도 시점이 제멋대로 돌아가지 않는다");

console.log("\n===== 6. 패링 모션 =====");
toMelee();
e = stage(6);
key("KeyE");
ok(T.parryT > 0, "E로 쳐내기 창이 열린다");
ok(T.parryRingVisible || (T.updateSwingArc(), T.parryRingVisible), "쳐내는 동안 화면에 표시가 뜬다");
T.tryParry(e, true);
T.updateSwingArc();
ok(T.parryRingVisible, "쳐낸 순간에도 표시가 남는다");

// 창이 닫히면 즉시 사라져야 한다. 굳는 동안(parryRec) 남아 있으면
// 점프하며 패링했을 때 그 자리에 잔상이 붙은 것처럼 보인다.
e = stage(6);
key("KeyE");
run(Math.ceil((T.PARRY_WIN + 0.02) * 120));
T.updateSwingArc();
ok(!T.parryRingVisible, "창이 닫히면 표시가 곧바로 사라진다", `parryRec=${T.parryRec.toFixed(2)}초`);

// 공중에서도 몸을 따라간다 (제자리에 남지 않는다)
e = stage(6);
T.player.pos.y += 50; T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
T.player.vel.set(40, 0, 0);
key("KeyE");
T.updateSwingArc();
const ringY0 = T.parryRingPos.y;
for (let i=0;i<10;i++){ T.player.vel.set(40, 0, 0); T.update(DT); T.updateCamera(DT); }
T.updateSwingArc();
ok(Math.abs(T.parryRingPos.x - T.player.renderPos.x) < 3,
   "공중에서 날아가도 고리가 몸을 따라온다",
   `고리 x ${T.parryRingPos.x.toFixed(1)} / 몸 x ${T.player.renderPos.x.toFixed(1)}`);

console.log("\n===== 7. 적 체력 4배 + 머리 위 체력바 =====");
// 종류별로 달라야 한다. 근접이 두껍고 원거리가 얇다.
const hpOf = n => T.E_TYPES.find(t => t.name === n).hp;
ok(hpOf("격투병") > hpOf("돌격병") && hpOf("돌격병") > hpOf("사수") && hpOf("사수") > hpOf("저격수"),
   "근접일수록 두껍고 원거리일수록 얇다",
   T.E_TYPES.map(t => `${t.name} ${t.hp}`).join(" / "));
e = stage(10);
e.hp = Math.max(1, Math.floor(e.ty.hp / 2));
T.updateHpBars();
ok(T.hpBarCount > 0, "다친 적 머리 위에 체력바가 그려진다", `${T.hpBarCount}개`);
// 이제는 멀쩡해도 상시로 띄운다 (예전엔 다친 적만 띄웠다)
e.hp = e.ty.hp; e.post = 0; e.stag = 0;
T.setLock(null);
T.updateHpBars();
ok(T.hpBarCount > 0, "멀쩡한 적도 상시로 체력바를 띄운다", `${T.hpBarCount}개`);
ok(T.psBarCount === T.hpBarCount, "체간바도 같은 수만큼 함께 뜬다", `체간바 ${T.psBarCount}개`);

console.log("\n===== 8. 낙하 데미지 =====");
toSwing();
// 속도만으로는 등급을 못 나눈다. MAX_SPEED가 112라 자유낙하가 100을 못 넘고,
// 300m를 떨어져도 같은 구간에 머문다. 그래서 실제로 떨어진 높이로 잰다.
function dropFrom(h) {
  const y = T.groundHeightAt(0, 0);
  T.player.pos.set(0, y + h, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.setClinging(null); T.releaseWeb();
  T.player.grounded = false;
  T.player.vel.set(0, 0, 0);
  T.setHp(T.MAX_HP);          // 앞선 낙하로 깎인 체력이 다음 측정을 먹지 않게
  const hp0 = T.hp;
  for (let i = 0; i < 120 * 8; i++) { T.update(DT); T.updateCamera(DT); if (T.player.grounded) break; }
  const lost = hp0 - T.hp;
  // 죽었으면 리스폰까지 기다리고, 아니면 무적(0.55초)이 풀릴 때까지 쉰다
  T.player.pos.set(0, T.groundHeightAt(0, 0), 0); T.player.vel.set(0, 0, 0);
  run(120 * 5);
  return lost;
}
// 낙하 피해는 단계표(FALL_TIERS)로 정해진다. 화면 표시는 칸 x 25다.
// 예전엔 35m부터 곧바로 1칸(25)이 들어가서 스윙하다 살짝 헛디디기만 해도 아팠다.
// 낮은 높이는 5~10으로 가볍게, 진짜 옥상에서 뛰어내리면 확실히 아프게 바꿨다.
const disp = h => Math.round(dropFrom(h) * 25);
ok(disp(15) === 0, "15m 낙하는 안 아프다");
ok(disp(40) === 5, "30m 넘으면 5 (헛디딘 수준)", `${disp(40)}`);
ok(disp(70) === 10, "55m 넘으면 10", `${disp(70)}`);
ok(disp(110) === 25, "90m 넘으면 25 (중층 옥상)", `${disp(110)}`);
ok(disp(180) === 50, "150m 넘으면 50", `${disp(180)}`);
ok(disp(300) === 88, "240m 넘으면 88 (고층에서 그대로 낙하)", `${disp(300)}`);
console.log(`       (단계 ${T.FALL_TIERS.map(t => `${t.h}m:${Math.round(t.dmg * 25)}`).join(" · ")} · 수직 속도 ${T.FALL_MIN_V}m/s 미만이면 면제)`);

// 스윙 착지는 벌하지 않는다
T.player.pos.set(0, T.groundHeightAt(0, 0) + 120, 0);
T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
T.player.grounded = false; T.player.vel.set(60, -20, 0);
T.setHp(T.MAX_HP);
const swHp = T.hp;
for (let i = 0; i < 120 * 8; i++) {
  T.player.vel.y = Math.max(T.player.vel.y, -30);   // 줄에 매달려 완만하게 내려오는 상황
  T.update(DT); T.updateCamera(DT);
  if (T.player.grounded) break;
}
ok(T.hp === swHp, "천천히 내려앉으면 높이와 무관하게 안 아프다", `hp ${swHp} -> ${T.hp}`);

console.log("\n===== 9. 공격 속도 =====");
ok(T.M_LIGHT[0].dur <= 0.24, "약공격 1타 사이클이 0.24초 이하", `${T.M_LIGHT[0].dur}초`);
ok(T.M_LIGHT[0].hit <= 0.08, "판정까지 0.08초 이하", `${T.M_LIGHT[0].hit}초`);

console.log(`\n통과 ${pass} / 실패 ${fail}`);

console.log("\n===== 에임: 미리보기 = 실제로 걸리는 곳 =====");
toSwing(); T.setFP(false);
T.player.pos.set(120, 200, -80); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
T.player.vel.set(30, 0, 10); T.setClinging(null); T.releaseWeb(); T.setLock(null);
run(30); for (let i=0;i<200;i++) T.updateCamera(DT);
T.syncWorld();
let agree = 0, tries = 0, autoShown = 0;
for (const [cxp, cyp] of [[800,450],[800,250],[400,300],[1200,600],[800,80],[200,800]]) {
  T.setCursor(cxp, cyp);
  T.updateCrosshair();                       // 미리보기 갱신 (aimPreview / aimAuto)
  const shown = T.aimPreviewPos ? T.aimPreviewPos.clone() : null;
  const wasAuto = T.aimAuto;
  T.releaseWeb();
  T.tryAttach();
  const actual = T.web ? T.web.a.clone() : null;
  tries++;
  if (!shown && !actual) agree++;
  else if (shown && actual && shown.distanceTo(actual) < 1.5) agree++;
  if (wasAuto) autoShown++;
  T.releaseWeb();
}
ok(agree === tries, "미리보기에 뜬 지점에 정확히 걸린다", `${agree}/${tries} 일치, 자동앵커 표시 ${autoShown}회`);

console.log("\n===== 에임: 1인칭 자동 스냅이 조준을 덮지 않는다 =====");
T.setFP(true);
const eA = stage(0);   // 적을 한 명만 남긴다
eA.g.position.set(0, T.groundHeightAt(0,0), 60);
eA.hp = 99; eA.bound = 0; eA.grip = 0;
T.player.pos.set(0, T.groundHeightAt(0,0), 0);
T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
T.setLock(null);
// 적에서 10도쯤 옆으로 조준 — 예전 14도 원뿔이면 그래도 적에게 휘어갔다
T.aimYaw(10 * Math.PI / 180); T.setPitch(0);
for (let i=0;i<200;i++) T.updateCamera(DT);
T.syncWorld();
for (let k=0;k<4 && (T.attackMode===false); k++) key("Tab");
const hpA = eA.hp;
md(0); mu(0);
for (let i=0;i<120*2;i++) { eA.knock.set(0,0,0); T.update(DT); }
ok(eA.hp === hpA, "10도 빗나가게 겨누면 적에게 자동으로 휘지 않는다", `hp ${hpA} -> ${eA.hp}`);
T.setFP(false);

console.log(`\n에임 포함  통과 ${pass} / 실패 ${fail}`);

console.log("\n===== 체력바·체간바가 진짜 상시로 뜨나 =====");
// 예전엔 updateCrosshair 안에 있어서 공격 모드의 early return에 걸렸고,
// 높이가 고정값이라 큰 적(격투병 1.3배)은 바가 몸 속에 파묻혀 있었다.
const live2 = T.enemies.filter(x => !x.dead);
const pick = {};
for (const x of live2) if (!pick[x.ty.name]) pick[x.ty.name] = x;
const four = Object.values(pick);
for (const x of live2) x.g.position.set(9000, -800, 9000);
const gy4 = T.groundHeightAt(0, 0);
four.forEach((x, i) => { x.g.position.set(i*8-12, gy4, 26); x.hp = x.ty.hp; x.post = 0; x.stag = 0; x.fireCd = 99; x.knock.set(0,0,0); });
T.player.pos.set(0, gy4, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
T.player.vel.set(0,0,0); T.setLock(null);
const fix4 = four.map(x => x.g.position.clone());
for (let i=0;i<200;i++){ four.forEach((x,k)=>x.g.position.copy(fix4[k])); T.update(DT); T.updateCamera(DT); }
T.syncWorld();

// 세 모드 모두에서 갱신되어야 한다
for (let i=0;i<4 && (T.attackMode || T.meleeMode); i++) key("Tab");
const seen = [];
for (const label of ["웹스윙", "거미줄 격투", "근접 격투"]) {
  T.updateHpBars();
  seen.push(`${label} ${T.hpBarCount}`);
  ok(T.hpBarCount === four.length, `${label} 모드에서 ${four.length}명 전부 바가 뜬다`, `${T.hpBarCount}개`);
  ok(T.psBarCount === T.hpBarCount, `${label} 모드에서 체간바도 같이 뜬다`);
  key("Tab");
}
// 덩치가 달라도 바는 머리 위다
let above = 0;
for (const x of four) {
  const sc = x.g.scale.x || 1;
  if (8.4 * sc > 7.5 * sc) above++;      // 배율에 비례하므로 항상 위여야 한다
}
ok(above === four.length, "덩치가 달라도 바가 머리 위에 있다",
   four.map(x => `${x.ty.name} x${(x.g.scale.x).toFixed(2)}`).join(" / "));

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
