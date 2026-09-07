// 근접 조작감 1차 — 스파이더맨2 방향.
//
// 여기서 지키려는 것은 네 가지다.
//   1) 소프트 락온   조준점을 맞출 필요 없이, 가려는 쪽/보는 쪽의 적을 알아서 고른다
//   2) 파고들기      판정 프레임까지 목표 앞에 반드시 도착한다 (멀어도 맞는다)
//   3) 회피 취소     판정이 나간 뒤에는 후딜을 구르기로 끊을 수 있다
//   4) 선입력 개방   휘두르는 도중 아무 때나 눌러도 다음 타가 예약된다
// 덧붙여 약공격은 움직이면서 칠 수 있고, 강공격은 발이 묶인다.
import { T } from "./_harness.mjs";
const DT = 1/120;
T.syncWorld();
const W = globalThis.__win, C = globalThis.__cv;
const kd  = c => (W.keydown||[]).forEach(f => f({ code: c, repeat: false, preventDefault(){} }));
const ku  = c => (W.keyup||[]).forEach(f => f({ code: c }));
const key = c => { kd(c); ku(c); };
const md  = b => (C.mousedown||[]).forEach(f => f({ button: b, preventDefault(){} }));
const mu  = b => (W.mouseup||[]).forEach(f => f({ button: b, preventDefault(){} }));
const light = () => { md(0); mu(0); };
let pass=0, fail=0;
const ok=(c,m,x="")=>{ if(c){pass++;console.log("  OK   "+m);} else {fail++;console.log("  FAIL "+m+"  "+x);} };
const run = n => { for(let i=0;i<n;i++){ T.update(DT); T.updateCamera(DT); } };
// 적이 밀려나면 거리 측정이 흔들린다. 자리에 못 박고 돌린다.
const runPin = (list, n) => {
  const p = list.map(e => e.g.position.clone());
  for (let i=0;i<n;i++){
    T.update(DT); T.updateCamera(DT);
    list.forEach((e, j) => { e.g.position.copy(p[j]); e.knock.set(0,0,0); });
  }
};

for (let i=0;i<4 && !T.meleeMode; i++) key("Tab");

// 적을 원하는 자리에 놓는다. 나머지는 멀리 치운다.
function place(spots) {
  const live = T.enemies.filter(x => !x.dead);
  const y = T.groundHeightAt(0, 0);
  const used = live.slice(0, spots.length);
  for (const o of live) if (!used.includes(o)) o.g.position.set(9000, -800, 9000);
  used.forEach((e, i) => {
    e.hp = 60; e.bound = 0; e.grip = 0; e.post = 0; e.stag = 0; e.postHold = 0;
    e.air = 0; e.down = 0; e.swing = null; e.fireCd = 99; e.knock.set(0,0,0);
    e.g.position.set(spots[i][0], y, spots[i][1]);
  });
  T.player.pos.set(0, y, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0,0,0); T.setClinging(null); T.releaseWeb();
  T.aimYaw(0); T.setPitch(0);
  T.setLock(null); T.setStam(100); T.clearMelee();
  T.setCursor(800, 450);
  run(20);
  for (let i=0;i<200;i++) T.updateCamera(DT);
  T.syncWorld();
  return used;
}
const clearKeys = () => ["KeyW","KeyA","KeyS","KeyD"].forEach(ku);

console.log("===== 1. 소프트 락온 — 조준점 없이 고른다 =====");
{
  // 왼쪽과 오른쪽에 하나씩. 조준점은 화면 한가운데 그대로 두고 WASD로만 가리킨다.
  // 주의: +Z를 보고 있으면 플레이어의 오른쪽은 월드 -X다 (right = fwd x up).
  let [R, L] = place([[-6, 6], [6, 6]]);
  kd("KeyD");                                   // 오른쪽으로 간다 = 오른쪽 놈을 친다
  const t1 = T.findMeleeTarget(T.LUNGE_MAX, 1.6);
  ku("KeyD"); kd("KeyA");                       // 왼쪽
  const t2 = T.findMeleeTarget(T.LUNGE_MAX, 1.6);
  clearKeys();
  ok(t1 === R, "WASD가 오른쪽이면 오른쪽 적을 고른다");
  ok(t2 === L, "WASD가 왼쪽이면 왼쪽 적을 고른다");

  // 아무 것도 안 누르면 시선 쪽
  [R, L] = place([[-9, 3], [9, 3]]);
  T.aimYaw(Math.atan2(9, 3));                   // +X쪽(=L)을 본다
  ok(T.findMeleeTarget(T.LUNGE_MAX, 1.6) === L, "입력이 없으면 보고 있는 쪽 적을 고른다");
}

console.log("\n===== 2. 파고들기 — 멀어도 맞는다 =====");
{
  // 12m. 예전에는 시작할 때 한 번 미는 방식이라 판정 시각에 도착을 못 했다.
  const [e] = place([[0, 12]]);
  const hp0 = e.hp;
  light();
  runPin([e], Math.ceil(T.M_LIGHT[0].dur*120)+6);
  ok(e.hp < hp0, "12m 밖의 적도 휘두르며 붙어서 맞힌다", `hp ${hp0} -> ${e.hp}`);
  ok(T.player.pos.distanceTo(e.g.position) < 6.5, "판정 시각에는 목표 앞에 서 있다",
     `거리 ${T.player.pos.distanceTo(e.g.position).toFixed(2)}`);
}
{
  // 사거리 밖. 여기까지 붙어버리면 순간이동이 된다 — 그 거리는 F 거미줄 접근의 몫이다.
  const [e] = place([[0, 26]]);
  const hp0 = e.hp, p0 = T.player.pos.clone();
  light();
  runPin([e], Math.ceil(T.M_LIGHT[0].dur*120)+6);
  ok(e.hp === hp0, "16m 밖으로는 붙지 않는다", `hp ${hp0} -> ${e.hp}`);
  ok(T.player.pos.distanceTo(p0) < 3, "그 자리에서 헛친다",
     `이동 ${T.player.pos.distanceTo(p0).toFixed(2)}m`);
}

console.log("\n===== 3. 회피 취소 =====");
{
  const [e] = place([[0, 4]]);
  T.startMelee(false, 0);
  runPin([e], 1);                                // 판정 전
  T.meleeRoll();
  ok(!!T.mAtk && T.rollT === 0, "판정이 나가기 전에는 구르기로 못 끊는다");

  runPin([e], Math.ceil(T.M_LIGHT[0].hit*120)+3);  // 판정 이후
  T.meleeRoll();
  ok(!T.mAtk && T.rollT > 0, "판정이 나간 뒤에는 후딜을 구르기로 끊는다");
}
{
  // 회피로 끊어도 콤보 체인은 살아 있어야 한다. 안 그러면 회피를 쓸수록 손해다.
  const [e] = place([[0, 4]]);
  light();
  runPin([e], Math.ceil(T.M_LIGHT[0].hit*120)+3);
  const chain = T.mChain;
  T.meleeRoll();
  runPin([e], Math.ceil(0.34*120)+2);            // 구르기가 끝날 때까지
  light();
  runPin([e], 2);
  ok(chain === 1 && T.mChain === 2, "구르고 나서도 콤보가 이어진다", `${chain} -> ${T.mChain}`);
}

console.log("\n===== 4. 선입력 — 휘두르는 도중 아무 때나 =====");
{
  const [e] = place([[0, 4]]);
  const hp0 = e.hp;
  light();
  runPin([e], 2);                                // t=0.017 — cancel(0.14) 한참 전
  light();                                       // 예전 규칙이면 이 입력은 버려졌다
  runPin([e], Math.ceil((T.M_LIGHT[0].dur + T.M_LIGHT[1].dur)*120)+10);
  ok(hp0 - e.hp >= 2, "공격 시작 직후에 눌러도 다음 타가 나간다", `hp ${hp0} -> ${e.hp}`);
}

console.log("\n===== 5. 약공격은 움직이면서, 강공격은 제자리 =====");
{
  // 실제 이동 거리는 지형·착지 상태에 흔들린다. 여기서는 이동을 여닫는 배수
  // 자체를 본다 — 이 값이 지상 이동 목표속도에 그대로 곱해진다.
  place([]);
  ok(T.meleeMoveMul() === 1, "공격이 없으면 이동은 온전하다");
  T.startMelee(false, 0);
  const ml = T.meleeMoveMul();
  ok(ml > 0.4 && ml < 1, "약공격 중에는 느려질 뿐 움직인다", `배수 ${ml}`);
  T.clearMelee();
  T.startMelee(true, 0);
  ok(T.meleeMoveMul() === 0, "강공격 중에는 발이 묶인다", `배수 ${T.meleeMoveMul()}`);
  T.clearMelee();
  ok(T.meleeMoveMul() === 1, "공격이 끝나면 이동이 온전히 돌아온다");
}

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
