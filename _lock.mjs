import { T } from "./_harness.mjs";
const DT = 1/120;
T.syncWorld();
const W = globalThis.__win, C = globalThis.__cv;
const key = c => (W.keydown||[]).forEach(f => f({ code: c, repeat: false, preventDefault(){} }));
let pass=0, fail=0;
const ok=(c,m,x="")=>{ if(c){pass++;console.log("  OK   "+m);} else {fail++;console.log("  FAIL "+m+"  "+x);} };

// 깨끗한 적 하나를 원하는 자리에 세우고 나머지는 치운다
function stage(dist, dy=0) {
  // 죽인 적은 배열에서 빠진다. 치울 땐 죽이지 말고 멀리 보낸다.
  const live = T.enemies.filter(x => !x.dead);
  const e = live[0];
  for (const o of live) if (o !== e) o.g.position.set(9000, -800, 9000);
  e.hp = 9; e.bound = 0; e.grip = 0;
  e.g.position.set(0, 300 + dy, dist);
  T.player.pos.set(0, 300, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0,0,0); T.player.grounded = false; T.setClinging(null); T.releaseWeb();
  T.setLock(null);
  T.syncWorld();
  return e;
}

console.log("===== 락온 =====");
T.setFP(false);

let e = stage(40);
T.aimYaw(0); T.setPitch(0);
for(let i=0;i<200;i++) T.updateCamera(DT);
T.syncWorld();
key("ControlLeft");
ok(T.lockOn === e, "Ctrl로 정면의 적을 문다");

key("ControlLeft");
ok(T.lockOn === null, "Ctrl을 다시 누르면 풀린다");

// 등 뒤의 적은 안 문다
e = stage(-40);
T.aimYaw(0); T.setPitch(0);
for(let i=0;i<200;i++) T.updateCamera(DT);
T.syncWorld();
key("ControlLeft");
ok(T.lockOn === null, "등 뒤의 적은 물지 않는다");

// 사거리 밖
e = stage(T.LOCK_RANGE + 40);
T.aimYaw(0); T.setPitch(0);
for(let i=0;i<200;i++) T.updateCamera(DT);
T.syncWorld();
key("ControlLeft");
ok(T.lockOn === null, `${T.LOCK_RANGE}m 밖의 적은 물지 않는다`);

// 카메라가 대상을 따라간다 — 옆으로 90도 벗어난 적을 물면 시점이 돌아간다
e = stage(0); e.g.position.set(50, 300, 0);
T.aimYaw(0); T.setPitch(0);
for(let i=0;i<200;i++) T.updateCamera(DT);
T.syncWorld();
T.setLock(e);
const y0 = T.viewYaw;
for(let i=0;i<120*1.5;i++) T.updateCamera(DT);
const want = Math.atan2(50, 0);
const err = Math.abs(Math.atan2(Math.sin(T.viewYaw-want), Math.cos(T.viewYaw-want)));
ok(err < 0.06, "락온하면 카메라가 대상 쪽으로 돌아간다", `${(y0*57.3).toFixed(0)}도 -> ${(T.viewYaw*57.3).toFixed(0)}도 (목표 ${(want*57.3).toFixed(0)}도)`);

// 위/아래도 따라간다
e = stage(40, 60);     // 60m 위
T.aimYaw(0); T.setPitch(0);
for(let i=0;i<200;i++) T.updateCamera(DT);
T.setLock(e);
for(let i=0;i<120*1.5;i++) T.updateCamera(DT);
ok(T.viewPitch > 0.4, "위에 있는 적을 물면 시점이 올라간다", `pitch=${T.viewPitch.toFixed(2)}`);

// 대상이 죽으면 자동 해제
e = stage(40); T.setLock(e);
e.dead = true;
for(let i=0;i<20;i++) T.update(DT);
ok(T.lockOn === null, "대상이 죽으면 락온이 풀린다");

// 너무 멀어지면 자동 해제
e = stage(40); T.setLock(e);
e.g.position.set(0, 300, T.LOCK_BREAK + 30);
for(let i=0;i<20;i++) T.update(DT);
ok(T.lockOn === null, `${T.LOCK_BREAK}m 넘게 멀어지면 락온이 풀린다`);

// 락온 대상이 공격 목표가 된다 — 커서를 딴 데 둬도 맞는다
e = stage(60);
T.aimYaw(0); T.setPitch(0);
for(let i=0;i<300;i++) T.updateCamera(DT);
T.syncWorld();
T.setCursor(120, 820);                 // 화면 구석 — 락온이 없으면 절대 못 맞는다
T.applyHero(T.HEROES[1]);               // 웹슈터 — 거미줄 격투 담당
key("Tab");                            // 거미줄 격투 모드
const hp0 = e.hp;
T.setLock(e);
(C.mousedown||[]).forEach(f=>f({button:0,preventDefault(){}}));
(W.mouseup||[]).forEach(f=>f({button:0,preventDefault(){}}));
for(let i=0;i<120*3;i++) T.update(DT);
ok(e.hp < hp0 || e.bound > 0, "락온 중에는 커서가 딴 데 있어도 대상을 맞춘다", `hp ${hp0} -> ${e.hp}`);

console.log("\n===== TAB = 웹스윙 <-> 그 캐릭터의 특화 모드 =====");
// 캐릭터를 나누면서 TAB이 3모드 순환에서 2모드 토글로 바뀌었다.
// 한 캐릭터가 쥐는 조작을 줄이는 게 목적이라 순환이 아니라 토글이어야 한다.
T.setLock(null);
const toSwing = () => { for (let i=0;i<3 && (T.attackMode || T.meleeMode); i++) key("Tab"); };

T.applyHero(T.HEROES[1]); toSwing();               // 웹슈터
ok(!T.attackMode && !T.meleeMode, "시작은 웹스윙");
key("Tab"); ok(T.attackMode && !T.meleeMode, "웹슈터: TAB = 거미줄 격투");
key("Tab"); ok(!T.attackMode && !T.meleeMode, "웹슈터: 한 번 더 = 웹스윙");

T.applyHero(T.HEROES[2]); toSwing();               // 파이터
key("Tab"); ok(!T.attackMode && T.meleeMode, "파이터: TAB = 근접 격투");
key("Tab"); ok(!T.attackMode && !T.meleeMode, "파이터: 한 번 더 = 웹스윙");

T.applyHero(T.HEROES[0]); toSwing();               // 스윙어 — 특화가 없다
key("Tab"); ok(!T.attackMode && !T.meleeMode, "스윙어: TAB이 아무것도 안 한다 (웹스윙 전용)");
ok(T.HEROES[0].mode === null, "스윙어는 특화 모드가 없다");
T.applyHero(T.HEROES[1]); toSwing(); key("Tab");   // 뒤 시험을 위해 되돌린다

console.log("\n===== Ctrl 해방 =====");
T.setClimbMouse(false);
T.keys["ControlLeft"] = true;
ok(!T.climbHeld(), "Ctrl을 눌러도 벽타기 입력이 아니다");
T.keys["ControlLeft"] = false;
T.setClimbMouse(true);
ok(T.climbHeld(), "마우스 뒤쪽 사이드 버튼만이 벽타기다");
T.setClimbMouse(false);

console.log(`\n통과 ${pass} / 실패 ${fail}`);
