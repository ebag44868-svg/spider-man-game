import { T } from "./_harness.mjs";
const DT = 1/120;
T.syncWorld();
const W = globalThis.__win, C = globalThis.__cv;
const key = c => (W.keydown||[]).forEach(f => f({ code: c, repeat: false, preventDefault(){} }));
const md  = b => (C.mousedown||[]).forEach(f => f({ button: b, preventDefault(){} }));
const mu  = b => (W.mouseup||[]).forEach(f => f({ button: b, preventDefault(){} }));
let pass=0, fail=0;
const ok=(c,m,x="")=>{ if(c){pass++;console.log("  OK   "+m);} else {fail++;console.log("  FAIL "+m+"  "+x);} };
const run = n => { for(let i=0;i<n;i++){ T.update(DT); T.updateCamera(DT); } };
const HV = () => Math.ceil(T.M_HEAVY.dur * 120) + 4;

function toMelee() { for (let i=0;i<4 && !T.meleeMode; i++) key("Tab"); }

// 적 하나를 코앞에 세운다. 나머지는 멀리 치운다.
function stage(dist = 4, hp = 20) {
  const live = T.enemies.filter(x => !x.dead);
  const e = live[0];
  for (const o of live) if (o !== e) o.g.position.set(9000, -800, 9000);
  const y = T.groundHeightAt(0, 0);
  e.hp = hp; e.bound = 0; e.grip = 0; e.post = 0; e.stag = 0; e.postHold = 0;
  e.knock.set(0,0,0);
  e.g.position.set(0, y, dist);
  T.player.pos.set(0, y, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0,0,0); T.setClinging(null); T.releaseWeb();
  T.aimYaw(0); T.setPitch(0);
  T.setLock(e); T.setStam(100);
  T.clearMelee();
  T.syncWorld();
  return e;
}

toMelee();
console.log("===== 약공격 =====");
let e = stage();
let hp0 = e.hp;
md(0); mu(0);
run(60);
ok(e.hp < hp0, "좌클릭으로 약공격이 들어간다", `hp ${hp0} -> ${e.hp}`);
ok(e.post > 0, "약공격이 체간을 깎는다", `체간 ${e.post.toFixed(0)}/${e.postMax}`);

e = stage();
const dmgs = [], posts = [];
for (let n = 0; n < 3; n++) {
  const h0 = e.hp, p0 = e.post;
  md(0); mu(0);
  run(Math.ceil(T.M_LIGHT[n].dur * 120) + 4);
  dmgs.push(h0 - e.hp); posts.push(Math.round(e.post - p0));
}
ok(dmgs[2] > dmgs[0], "3타째가 1타보다 세다", `피해 ${dmgs.join("/")}  체간 ${posts.join("/")}`);

console.log("\n===== 강공격 =====");
e = stage();
hp0 = e.hp;
md(2); mu(2);
run(HV());
ok(e.hp < hp0, "우클릭으로 강공격이 들어간다", `hp ${hp0} -> ${e.hp}`);
ok(e.post >= Math.min(T.M_HEAVY.post, e.postMax) - 1, "강공격이 체간을 크게 깎는다", `체간 ${e.post.toFixed(0)}`);

// 무너질 때까지 몇 방 걸리는지가 체간 설계의 전부다
e = stage();
let heavies = 0;
while (e.stag <= 0 && heavies < 6) { md(2); mu(2); run(HV()); heavies++; }
ok(e.stag > 0, `강공격 ${heavies}방에 체간이 무너진다`, `체간 ${e.post.toFixed(0)}/${e.postMax}`);
ok(heavies >= 2, "한 방에 무너지지는 않는다", `${heavies}방`);

console.log("\n===== 처형 =====");
// 무너진 적에게 넣는 다음 강공격은 공격이 아니라 처형이다
e.hp = 99;
const dExec = T.player.pos.distanceTo(e.g.position);
ok(dExec < 9, "무너뜨린 뒤에도 적이 처형 사거리 안에 남아 있다", dExec.toFixed(1) + "m");
md(2); mu(2);
ok(T.execT > 0, "무너진 적에게 강공격을 넣으면 처형이 시작된다");
ok(T.invulnNow > 0.5, "처형 중에는 무적이다", `invuln=${T.invulnNow.toFixed(2)}`);
run(Math.ceil(T.EXEC_TIME * 120) + 10);
ok(e.dead, "처형하면 HP 99여도 즉사한다");
ok(T.execT === 0, "처형이 끝나면 상태가 풀린다");

console.log("\n===== 패링 =====");
e = stage(6);
const pp0 = e.post;
key("KeyE");
ok(T.parryT > 0, "E로 쳐내기 창이 열린다", `창 ${T.parryT.toFixed(2)}초`);
ok(T.tryParry(e, true), "창 안에 들어온 공격을 쳐낸다");
ok(e.post > pp0 + T.PARRY_POST - 1, "쳐내면 적 체간이 크게 무너진다", `체간 ${pp0} -> ${e.post.toFixed(0)}`);

e = stage(6);
key("KeyE");
ok(T.parryT > 0, "모드를 오간 뒤에도 쳐내기가 씹히지 않는다");
run(Math.ceil((T.PARRY_WIN + 0.02) * 120));
ok(T.parryT === 0, "창은 저절로 닫힌다");
ok(!T.tryParry(e, true), "창이 닫힌 뒤에는 못 막는다");
ok(T.parryRec > 0, "헛치면 잠시 굳는다", `굳음 ${T.parryRec.toFixed(2)}초`);

e = stage(6);
key("KeyE");
ok(!T.tryParry(e, false), "패링 불가 공격은 창 안이어도 못 막는다");

console.log("\n===== 구르기 =====");
e = stage(6);
T.setStam(100);
const st0 = T.stam;
T.keys["KeyA"] = true;
key("ShiftLeft");
ok(T.rollT > 0, "Shift로 구른다");
ok(T.stam < st0, "구르기가 스태미나를 먹는다", `${st0} -> ${T.stam.toFixed(0)}`);
ok(T.invulnNow > 0, "구르기 앞부분은 무적이다", `invuln=${T.invulnNow.toFixed(2)}`);
const x0 = T.player.pos.x;
run(Math.ceil(T.ROLL_TIME * 120));
ok(Math.abs(T.player.pos.x - x0) > 3, "실제로 그 방향으로 굴러간다", `x ${x0.toFixed(1)} -> ${T.player.pos.x.toFixed(1)}`);
T.keys["KeyA"] = false;
ok(T.rollT === 0, "구르기가 끝난다");

e = stage(6);
T.setStam(2);
key("ShiftLeft");
ok(T.rollT === 0, "스태미나가 없으면 구르지 못한다");

console.log("\n===== 체간 회복 =====");
e = stage(6);
T.addPosture(e, 30);
const pk = e.post;
run(120 * 3);
ok(e.post < pk - 10, "몰아치지 않으면 체간이 도로 회복된다", `${pk} -> ${e.post.toFixed(0)}`);

console.log("\n===== 모드 밖에서는 안 나간다 =====");
e = stage(4);
key("Tab");
ok(!T.meleeMode, "근접 모드에서 나왔다");
md(2); mu(2); run(90);
ok(T.execT === 0 && !T.mAtk, "근접 모드가 아니면 우클릭이 강공격이 아니다");
key("KeyE");
ok(T.parryT === 0, "근접 모드가 아니면 E는 패링이 아니다");

console.log(`\n통과 ${pass} / 실패 ${fail}`);

console.log("\n===== F 거미줄 접근 =====");
toMelee();
e = stage(50);
T.setStam(100);
let d0 = T.player.pos.distanceTo(e.g.position);
key("KeyF");
ok(T.dashIn > 0, "F로 락온 대상에게 거미줄 접근이 시작된다");
ok(!!T.dualWebTarget(), "접근 중에는 양손 거미줄 두 가닥이 그려진다");
run(120);
const d1 = T.player.pos.distanceTo(e.g.position);
ok(d1 < d0 - 20, "실제로 대상 쪽으로 붙는다", `${d0.toFixed(0)}m -> ${d1.toFixed(0)}m`);
ok(d1 > 2, "적을 뚫고 지나가지는 않는다", `${d1.toFixed(1)}m`);

e = stage(4);
key("KeyF");
ok(T.dashIn === 0, "이미 붙어 있으면 접근하지 않는다");

e = stage(50);
T.setLock(null);
key("KeyF");
ok(T.dashIn === 0, "락온이 없으면 접근하지 않는다");

e = stage(50);
T.setStam(3);
key("KeyF");
ok(T.dashIn === 0, "스태미나가 없으면 접근하지 않는다");

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
