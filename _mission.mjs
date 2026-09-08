// 미션 / 챌린지 프레임워크 (문서 02 §20~24)
//
// 하네스를 안 쓴다. mission.js 가 '세상의 요약'만 받도록 만들어 뒀으므로
// 도시도 적도 없이 검증된다. 미션마다 if 문을 세우지 않기 위한 설계다.
import {
  makeRun, updateRun, currentObj, objText, objProgress,
  rankOf, rankBetter, makeResult, updateRecord,
} from "./src/mission.js";
import { MISSIONS, CHALLENGES, missionById, nextMission, firstMission } from "./src/missions.js";

let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };
const DT = 1 / 60;
// 세상의 요약. 미션은 이것만 본다.
const W = (o) => Object.assign({ x: 0, z: 0, y: 0, killed: 0, alive: 0, hp: 10, acts: {}, hostage: "safe" }, o);
function run(r, w, secs) {
  const n = Math.round(secs / DT);
  for (let i = 0; i < n && r.state === "run"; i++) updateRun(r, w, DT);
  return r.state;
}

console.log("===== 1. 목표 종류 =====");
{
  // defeat — 미션 시작 시점의 누적값을 빼야 이번 미션의 몫이 나온다
  const r = makeRun({ id: "t", objectives: [{ type: "defeat", n: 3 }] }, { killed: 100 });
  ok(run(r, W({ killed: 102 }), 1) === "run", "아직 2명이면 안 끝난다");
  ok(r.objs[0].n === 2, "이번 미션에서 잡은 수만 센다 (전역 누적이 아니다)", `n ${r.objs[0].n}`);
  ok(run(r, W({ killed: 103 }), 1) === "clear", "3명이면 끝난다");
}
{
  const r = makeRun({ id: "t", objectives: [{ type: "reach", x: 100, z: 0, r: 20 }] }, {});
  ok(run(r, W({ x: 0, z: 0 }), 1) === "run", "멀면 안 끝난다");
  ok(run(r, W({ x: 95, z: 5 }), 0.1) === "clear", "반경 안에 들면 끝난다");
}
{
  const pts = [{ x: 0, z: 0, r: 10 }, { x: 50, z: 0, r: 10 }, { x: 100, z: 0, r: 10 }];
  const r = makeRun({ id: "t", objectives: [{ type: "checkpoints", points: pts }] }, {});
  run(r, W({ x: 100, z: 0 }), 0.1);
  ok(r.objs[0].idx === 0, "순서를 건너뛸 수 없다 (3번을 먼저 밟아도 안 센다)");
  run(r, W({ x: 0, z: 0 }), 0.1);
  run(r, W({ x: 50, z: 0 }), 0.1);
  ok(r.objs[0].idx === 2, "순서대로 밟으면 센다", `idx ${r.objs[0].idx}`);
  ok(run(r, W({ x: 100, z: 0 }), 0.1) === "clear", "마지막까지 밟으면 끝난다");
}
{
  const r = makeRun({ id: "t", objectives: [{ type: "survive", t: 5 }] }, {});
  ok(run(r, W(), 4) === "run", "4초로는 부족하다");
  ok(run(r, W(), 1.2) === "clear", "5초 버티면 끝난다");
}
{
  const r = makeRun({ id: "t", objectives: [{ type: "action", key: "parry", n: 3 }] }, { acts: { parry: 7 } });
  ok(run(r, W({ acts: { parry: 9 } }), 1) === "run", "2회로는 부족하다");
  ok(run(r, W({ acts: { parry: 10 } }), 1) === "clear", "3회면 끝난다");
}
{
  const r = makeRun({ id: "t", objectives: [{ type: "무슨소리야" }] }, {});
  ok(run(r, W(), 0.1) === "clear", "모르는 목표는 막지 않는다 (미션이 통째로 멈추면 더 나쁘다)");
}

console.log("\n===== 2. 순서 =====");
{
  const def = { id: "t", objectives: [{ type: "defeat", n: 2 }, { type: "survive", t: 3 }] };
  const r = makeRun(def, {});
  run(r, W(), 4);
  ok(!r.objs[1].done && r.objs[1].t === 0, "앞 목표가 안 끝나면 뒤 목표는 시작도 안 한다");
  run(r, W({ killed: 2 }), 0.1);
  ok(r.objs[0].done, "앞 목표가 끝났다");
  ok(run(r, W({ killed: 2 }), 3.2) === "clear", "그때부터 뒤 목표가 돈다");

  // 동시 진행도 된다
  const r2 = makeRun({ id: "t", sequential: false, objectives: [{ type: "defeat", n: 1 }, { type: "survive", t: 2 }] }, {});
  run(r2, W({ killed: 1 }), 2.2);
  ok(r2.state === "clear", "sequential:false 면 한꺼번에 진행한다");
}

console.log("\n===== 3. 실패 =====");
{
  const def = { id: "t", objectives: [{ type: "survive", t: 60 }], failConditions: [{ type: "death" }] };
  const r = makeRun(def, {});
  run(r, W({ hp: 0 }), 0.1);
  ok(r.state === "fail" && r.failReason.includes("쓰러"), "죽으면 실패한다", r.failReason);
}
{
  const def = { id: "t", objectives: [{ type: "survive", t: 60 }], failConditions: [{ type: "timeout", t: 5 }] };
  const r = makeRun(def, {});
  ok(run(r, W(), 6) === "fail", "시간 초과로 실패한다");
}
{
  const def = { id: "t", objectives: [{ type: "survive", t: 60 }], failConditions: [{ type: "hostage" }] };
  const r = makeRun(def, {});
  run(r, W({ hostage: "lost" }), 0.1);
  ok(r.state === "fail", "인질을 잃으면 실패한다");
}

console.log("\n===== 4. 등급과 기록 =====");
{
  const def = { id: "t", gold: 60, silver: 90, bronze: 120, objectives: [] };
  ok(rankOf(def, { t: 50, state: "clear" }) === "S", "금 기준 안이면 S");
  ok(rankOf(def, { t: 80, state: "clear" }) === "A", "은 기준이면 A");
  ok(rankOf(def, { t: 110, state: "clear" }) === "B", "동 기준이면 B");
  ok(rankOf(def, { t: 200, state: "clear" }) === "C", "넘으면 C");
  ok(rankOf({ objectives: [] }, { t: 999, state: "clear" }) === "A", "시간 기준이 없으면 클리어만 본다");

  ok(rankBetter("B", "A"), "A가 B보다 낫다");
  ok(!rankBetter("S", "A"), "S보다 나은 건 없다");

  ok(updateRecord(null, { clear: true, time: 80, rank: "A" }), "첫 기록은 무조건 갱신");
  ok(updateRecord({ best: 90, rank: "A" }, { clear: true, time: 80, rank: "A" }), "더 빠르면 갱신");
  ok(!updateRecord({ best: 70, rank: "S" }, { clear: true, time: 80, rank: "A" }), "느리고 등급도 낮으면 그대로");
  ok(!updateRecord({ best: 70, rank: "A" }, { clear: false, time: 10, rank: "-" }), "실패는 기록이 안 된다");
}

console.log("\n===== 5. 결과 화면에 넘길 값 =====");
{
  const def = { id: "m1", title: "첫 순찰", gold: 60, reward: { text: "보상" }, next: "m2", objectives: [{ type: "defeat", n: 1 }] };
  const r = makeRun(def, {});
  run(r, W({ killed: 1 }), 0.1);
  const res = makeResult(r);
  ok(res.clear && res.rank === "S", "클리어 결과가 나온다");
  ok(res.reward && res.next === "m2", "보상과 다음 미션이 실려 있다");

  const r2 = makeRun(Object.assign({}, def, { failConditions: [{ type: "death" }] }), {});
  run(r2, W({ hp: 0 }), 0.1);
  const res2 = makeResult(r2);
  ok(!res2.clear && res2.reward === null, "실패하면 보상이 없다");
  ok(res2.reason.length > 0, "왜 실패했는지 알려준다", res2.reason);
}

console.log("\n===== 6. 미션 데이터가 성립하는가 =====");
{
  ok(MISSIONS.length >= 6, "본 미션이 MVP 규모(6~8)다", `${MISSIONS.length}개`);
  ok(CHALLENGES.length >= 2, "챌린지가 2개 이상이다", `${CHALLENGES.length}개`);
  ok(MISSIONS.every(m => m.id && m.title && m.objectives && m.objectives.length),
     "모든 미션에 id·제목·목표가 있다");
  ok(MISSIONS.every(m => (m.objectives || []).every(o => o.type)), "모든 목표에 종류가 있다");
  ok(CHALLENGES.every(c => c.record), "챌린지는 전부 기록을 남긴다");
  ok(MISSIONS.some(m => m.type === "boss"), "보스 미션이 있다");

  // 사슬이 끊기지 않고 마지막까지 이어지는가
  let m = firstMission(), n = 0, seen = new Set();
  while (m && n < 50) {
    ok(!seen.has(m.id) || n === 0, "사슬이 되돌아오지 않는다");
    seen.add(m.id);
    const nx = nextMission(m.id);
    if (!nx) break;
    ok(!!missionById(nx.id), `${m.id} 다음(${nx.id})이 실재한다`);
    m = nx; n++;
  }
  ok(seen.size === MISSIONS.length, "모든 미션이 사슬 위에 있다 (고아 미션 없음)",
     `${seen.size} / ${MISSIONS.length}`);
  ok(m && m.next === null, "마지막 미션의 다음은 없다");
}

console.log("\n===== 7. HUD 문구 =====");
{
  const r = makeRun({ id: "t", objectives: [{ type: "defeat", n: 5 }, { type: "survive", t: 30 }] }, {});
  const o = currentObj(r);
  ok(o === r.objs[0], "지금 할 목표를 알려준다");
  ok(objText(o).includes("5"), "무엇을 해야 하는지 문장이 나온다", objText(o));
  ok(objProgress(o) === "0 / 5", "진행도가 나온다", objProgress(o));
  run(r, W({ killed: 5 }), 0.1);
  ok(currentObj(r) === r.objs[1], "끝나면 다음 목표로 넘어간다");
  ok(objText(currentObj(r)).includes("30"), "다음 목표 문장도 나온다", objText(currentObj(r)));
  run(r, W({ killed: 5 }), 31);
  ok(currentObj(r) === null, "다 끝나면 보여줄 목표가 없다");
}

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
