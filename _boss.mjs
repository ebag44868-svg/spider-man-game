// 보스 (문서 02 §25)
//
// 재는 것은 하나다 — 이게 "HP 큰 일반 적"이 아닌가.
//   · 페이즈마다 행동이 는다
//   · 페이즈는 체력으로만 올라간다 (시간으로 올리면 잘 싸울수록 손해다)
//   · 빨간 예고는 못 쳐낸다. 회피를 배우게 하는 장치다
//   · 쳐내면 크게 벌어진다 (반격할 틈)
import { MOVES, PHASES, phaseOf, makeBoss, pickMove, updateBoss, bossDamage } from "./src/boss.js";

let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };
const DT = 1 / 60;
// 사건을 모으며 n초 돌린다. rnd 를 고정해 결과를 재현 가능하게 둔다.
function run(b, w, secs, rnd) {
  const out = [];
  const n = Math.round(secs / DT);
  for (let i = 0; i < n; i++) {
    const e = updateBoss(b, w, DT, rnd === undefined ? 0 : rnd);
    if (e) out.push(e);
  }
  return out;
}

console.log("===== 1. 페이즈는 체력으로 올라간다 =====");
{
  ok(phaseOf(1).n === 1, "가득 차 있으면 1페이즈");
  ok(phaseOf(0.5).n === 2, "절반이면 2페이즈");
  ok(phaseOf(0.2).n === 3, "3분의 1 아래면 3페이즈");
  ok(phaseOf(0).n === 3, "0이어도 3페이즈 (마지막을 넘지 않는다)");

  // 시간으로는 안 올라간다
  const b = makeBoss(100);
  run(b, { dist: 10 }, 60, 0);
  ok(b.phase === 1, "60초를 버텨도 체력이 그대로면 1페이즈 그대로다", `phase ${b.phase}`);
}

console.log("\n===== 2. 페이즈마다 행동이 는다 =====");
{
  const n1 = PHASES.find(p => p.n === 1).moves.length;
  const n2 = PHASES.find(p => p.n === 2).moves.length;
  const n3 = PHASES.find(p => p.n === 3).moves.length;
  ok(n2 > n1 && n3 > n2, "행동 수가 페이즈마다 늘어난다", `${n1} -> ${n2} -> ${n3}`);
  ok(PHASES.every(p => p.learn), "페이즈마다 배울 것이 정해져 있다");
  ok(PHASES.find(p => p.n === 3).moves.includes("hurl"), "3페이즈에서만 원거리 기술이 나온다");
  ok(!PHASES.find(p => p.n === 1).moves.includes("swipe"), "1페이즈는 쳐낼 기술이 없다 (회피부터 배운다)");
}

console.log("\n===== 3. 페이즈 전환 =====");
{
  const b = makeBoss(100);
  bossDamage(b, 40);                        // 60% — 2페이즈
  const ev = run(b, { dist: 10 }, 0.05, 0);
  ok(ev.some(e => e.type === "phase" && e.phase.n === 2), "체력이 내려가면 페이즈 사건이 나온다");
  ok(b.state === "rest", "전환 직후에는 쉰다 (연출 동안 안 때린다)");
  const ev2 = run(b, { dist: 10 }, 1.0, 0);
  ok(!ev2.some(e => e.type === "hit"), "전환 연출 동안 판정이 안 나간다");
}

console.log("\n===== 4. 예고 → 판정 =====");
{
  const b = makeBoss(100);
  const ev = run(b, { dist: 10 }, 3, 0);
  const tell = ev.find(e => e.type === "tell");
  ok(!!tell, "예고가 먼저 나온다");
  const hit = ev.find(e => e.type === "hit");
  ok(!!hit, "예고 뒤에 판정이 나온다");
  ok(ev.indexOf(tell) < ev.indexOf(hit), "순서가 예고 → 판정이다");
  ok(tell.spec.tell > 0.3, "예고가 읽을 만큼 길다", `${tell.spec.tell}초`);
}

console.log("\n===== 5. 빨간 예고는 못 쳐낸다 =====");
{
  // 1페이즈의 돌진(charge)은 parry:false — 회피를 배우게 하는 장치다.
  ok(MOVES.charge.parry === false, "돌진은 쳐낼 수 없다");
  ok(MOVES.slam.parry === true && MOVES.swipe.parry === true, "내려찍기·휘두르기는 쳐낼 수 있다");
  ok(MOVES.hurl.parry === false, "원거리 투척도 쳐낼 수 없다");

  // 못 쳐내는 기술에 쳐내기를 눌러도 안 막힌다
  const b = makeBoss(100);
  run(b, { dist: 30 }, 0.05, 0);              // 30m — 돌진만 사거리 안
  ok(b.move === "charge", "먼 거리에서는 돌진을 고른다", `move ${b.move}`);
  const ev = run(b, { dist: 30, parryHit: true }, 1.2, 0);
  ok(!ev.some(e => e.type === "parried"), "빨간 예고는 쳐내기가 안 먹는다");
  ok(ev.some(e => e.type === "hit"), "그대로 판정이 나간다");
}

console.log("\n===== 6. 쳐내면 크게 벌어진다 =====");
{
  const b = makeBoss(100);
  bossDamage(b, 40);                          // 2페이즈 (쳐낼 기술이 생긴다)
  run(b, { dist: 5 }, 1.5, 0);                // 전환 연출을 흘려보낸다
  // 근접 거리에서 쳐낼 수 있는 기술이 나올 때까지 돌린다
  let got = null;
  for (let i = 0; i < 600 && !got; i++) {
    const e = updateBoss(b, { dist: 5 }, DT, 0.9);
    if (e && e.type === "tell" && e.spec.parry) got = e;
  }
  ok(!!got, "근접에서 쳐낼 수 있는 기술이 나온다", got ? got.move : "-");
  const e2 = updateBoss(b, { dist: 5, parryHit: true }, DT, 0.9);
  ok(e2 && e2.type === "parried", "쳐내면 막힌다");
  ok(b.rest > 1.2, "쳐내면 다음 행동까지 크게 벌어진다 (반격할 틈)", `${b.rest.toFixed(2)}초`);
  ok(b.parried === 1, "쳐낸 횟수를 센다");
}

console.log("\n===== 7. 거리에 맞는 기술을 고른다 =====");
{
  const p1 = PHASES.find(p => p.n === 1);
  ok(pickMove(p1, 3, 0) === "slam", "코앞이면 내려찍기");
  ok(pickMove(p1, 30, 0) === "charge", "멀면 돌진");
  ok(pickMove(p1, 200, 0) === null, "사거리를 다 벗어나면 아무것도 안 고른다");
  const p3 = PHASES.find(p => p.n === 3);
  ok(pickMove(p3, 80, 0) === "hurl", "3페이즈에서 아주 멀면 투척");
  ok(pickMove(p3, 80, 0.99) === "hurl", "그 거리에서 고를 게 그것뿐이면 난수와 무관하다");
}

console.log("\n===== 8. 죽음 =====");
{
  const b = makeBoss(50);
  ok(!bossDamage(b, 20), "아직 안 죽었다");
  ok(bossDamage(b, 40), "체력이 다하면 죽음을 알린다");
  ok(b.hp === 0, "체력은 음수로 안 내려간다");
  const ev = run(b, { dist: 5 }, 1, 0);
  ok(ev.length === 1 && ev[0].type === "dead", "죽은 뒤에는 사건이 한 번만 나온다");
  ok(b.state === "dead" && !b.move, "죽으면 쓰던 기술도 사라진다");
  ok(run(b, { dist: 5 }, 1, 0).length === 0, "죽은 보스는 더 이상 아무것도 안 한다");
  ok(!bossDamage(b, 10), "죽은 뒤 때려도 다시 죽지 않는다");
}

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
