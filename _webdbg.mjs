// 웹 디버그 오버레이 — 문서 03 §42 · §43
//
// 이건 기능이 아니라 도구다. 그래서 "잘 보이는가"가 아니라
// "튜닝에 필요한 사실을 잃지 않고 담는가"를 잰다.
import { T } from "./_harness.mjs";
const DT = 1 / 120;
T.syncWorld();
let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };
const P = T.player;

console.log("===== 1. 기본은 꺼져 있다 =====");
{
  // 릴리즈 기본 OFF (문서 §42 마지막 줄). 켜지 않으면 아무 비용도 없어야 한다.
  ok(!T.dbgOn(), "처음에는 꺼져 있다");
  T.findSwingAnchor();
  ok(T.dbgCands().length === 0, "꺼져 있으면 후보를 담지 않는다");
}

console.log("\n===== 2. 후보를 담는다 =====");
{
  T.setDbg(true);
  // 건물이 많은 곳 위 (도시 한복판, 공중)
  P.pos.set(0, T.groundHeightAt(0, 0) + 60, 0);
  P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.vel.set(0, 0, 30); P.grounded = false;
  T.setClinging(null); T.releaseWeb();
  T.syncWorld();

  const best = T.findSwingAnchor();
  const cs = T.dbgCands();
  ok(cs.length > 0, "후보가 담긴다", `${cs.length}개`);
  ok(cs.length <= T.MAX_CAND, "상한을 넘지 않는다", `${cs.length} <= ${T.MAX_CAND}`);
  ok(cs.every(c => typeof c.score === "number" && c.score === c.score),
     "모든 후보에 점수가 있다 (NaN 없음)");
  ok(cs.every(c => typeof c.ok === "boolean"), "통과/기각이 표시된다");
  ok(cs.filter(c => !c.ok).every(c => c.why.length > 0),
     "기각된 후보는 반드시 사유를 남긴다");
  ok(cs.every(c => c.side === "L" || c.side === "R" || c.side === "C"),
     "어느 쪽에서 찾은 후보인지 남는다");

  // 채택된 것이 실제로 최고점이어야 한다. 이게 틀리면 점수식을 못 믿는다.
  if (best) {
    const pi = T.dbgPickIdx();
    ok(pi >= 0, "채택된 후보를 목록에서 찾을 수 있다", `idx ${pi}`);
    const okOnes = cs.filter(c => c.ok);
    const top = Math.max(...okOnes.map(c => c.score));
    ok(pi >= 0 && Math.abs(cs[pi].score - top) < 1e-9,
       "채택 = 통과한 후보 중 최고점", pi >= 0 ? `${cs[pi].score.toFixed(3)} vs ${top.toFixed(3)}` : "");
    const p = T.dbgPicked();
    ok(p && Math.abs(p.x - best.x) < 1e-6 && Math.abs(p.z - best.z) < 1e-6,
       "채택 좌표가 실제 반환값과 같다");
  } else {
    ok(false, "이 위치에서 앵커를 찾지 못했다 — 테스트 위치를 옮겨야 한다");
  }
}

console.log("\n===== 3. 탐색마다 새로 담는다 =====");
{
  // 후보가 누적되면 화면이 며칠 전 후보로 뒤덮인다
  const n1 = T.findSwingAnchor() , a = T.dbgCands().length;
  const n2 = T.findSwingAnchor() , b = T.dbgCands().length;
  ok(a === b, "두 번 돌려도 개수가 그대로다 (누적되지 않는다)", `${a} -> ${b}`);
}

console.log("\n===== 4. 기각 사유가 실제 이유와 맞는가 =====");
{
  // 사유가 틀리면 있으나 마나다. 조건을 직접 만들어 확인한다.
  P.pos.set(0, T.groundHeightAt(0, 0) + 60, 0);
  P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  T.syncWorld();
  const near = { x: P.pos.x + 1, y: P.pos.y + 1, z: P.pos.z + 1 };
  T.scoreAnchor(near, 0, 1);
  ok(T.scoreWhy === "짧음", "코앞은 '짧음'", T.scoreWhy);
  const far = { x: P.pos.x, y: P.pos.y, z: P.pos.z + 9999 };
  T.scoreAnchor(far, 0, 1);
  ok(T.scoreWhy === "멂", "너무 멀면 '멂'", T.scoreWhy);
  const low = { x: P.pos.x, y: P.pos.y - 40, z: P.pos.z + 40 };
  T.scoreAnchor(low, 0, 1);
  ok(T.scoreWhy === "아래", "발밑은 '아래'", T.scoreWhy);
  const back = { x: P.pos.x, y: P.pos.y + 10, z: P.pos.z - 40 };
  T.scoreAnchor(back, 0, 1);
  ok(T.scoreWhy === "뒤", "등 뒤는 '뒤'", T.scoreWhy);
  const good = { x: P.pos.x, y: P.pos.y + 12, z: P.pos.z + 45 };
  const sc = T.scoreAnchor(good, 0, 1);
  ok(sc > 0 && T.scoreWhy === "", "통과한 후보는 사유가 비어 있다", `${sc.toFixed(2)} "${T.scoreWhy}"`);
}

console.log("\n===== 5. 패널 =====");
{
  const L = T.dbgLines({ aim: "중앙", view: "3P", speed: 42.8, vel: { x: 1, y: -2, z: 3 } });
  ok(Array.isArray(L) && L.length > 6, "여러 줄을 돌려준다", `${L.length}줄`);
  const all = L.join("\n");
  // 문서 §42 가 요구한 항목이 실제로 들어 있는가
  for (const k of ["조준", "후보", "속도", "의도", "벽", "카메라"]) {
    ok(all.includes(k), `'${k}' 항목이 있다`);
  }
  ok(!all.includes("NaN") && !all.includes("undefined"),
     "값이 없어도 NaN/undefined 를 뱉지 않는다");

  // 값이 하나도 없어도 죽지 않아야 한다 (부팅 직후에 열릴 수 있다)
  let threw = false;
  try { T.dbgLines(); T.dbgLines({}); } catch (e) { threw = true; }
  ok(!threw, "빈 상태로 불러도 죽지 않는다");
}

console.log("\n===== 6. 끄면 지운다 =====");
{
  T.findSwingAnchor();
  ok(T.dbgCands().length > 0, "켜져 있는 동안은 담겨 있다");
  T.setDbg(false);
  ok(!T.dbgOn(), "꺼진다");
  ok(T.dbgCands().length === 0 && T.dbgPicked() === null,
     "끄면 후보와 채택을 지운다 (다음에 켤 때 옛 데이터가 안 보이게)");
}

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
