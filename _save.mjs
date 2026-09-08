// 저장 / 이어하기 (문서 02 §29~32)
//
// 이 파일은 하네스를 안 쓴다. src/save.js 가 브라우저를 모르게 만들어 뒀으므로
// 도시도 THREE 도 필요 없다. 그게 이 설계의 목적이다.
import {
  SCHEMA, defaultSave, migrate, loadSave, writeSave, clearSave, saveSummary, fill,
} from "./src/save.js";

let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };

// 가짜 저장소. 브라우저 없이 그대로 돌린다.
function mkStore(init) {
  const m = new Map(Object.entries(init || {}));
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    _map: m,
  };
}
// 무엇을 해도 던지는 저장소 (사생활 보호 모드 흉내)
const angry = {
  getItem() { throw new Error("nope"); },
  setItem() { throw new Error("nope"); },
  removeItem() { throw new Error("nope"); },
};

console.log("===== 1. 처음 켰을 때 =====");
{
  const s = mkStore();
  const r = loadSave(s);
  ok(r.fresh, "저장본이 없으면 새 게임이다");
  ok(!r.broken, "없는 것과 깨진 것은 다르다");
  ok(r.data.schemaVersion === SCHEMA, "스키마 버전이 박혀 있다");
  ok(Array.isArray(r.data.story.cleared), "기본값이 온전하다");
  ok(r.data.unlocked.characters.length === 3, "캐릭터 셋은 처음부터 열려 있다");
}

console.log("\n===== 2. 쓰고 다시 읽는다 =====");
{
  const s = mkStore();
  const d = defaultSave();
  d.story.chapter = 2;
  d.story.mission = "m5";
  d.story.cleared = ["m1", "m2", "m3", "m4"];
  d.character = "swinger";
  d.tutorial.done = ["swing", "combat"];
  d.challenges.c1 = { best: 72.5, rank: "A", runs: 3 };
  ok(writeSave(s, d), "쓰기가 성공한다");

  const r = loadSave(s);
  ok(!r.fresh, "다음에 켜면 이어하기가 있다");
  ok(r.data.story.mission === "m5", "진행 중인 미션이 살아 있다");
  ok(r.data.story.cleared.length === 4, "클리어 목록이 살아 있다");
  ok(r.data.character === "swinger", "고른 캐릭터가 살아 있다");
  ok(r.data.challenges.c1.best === 72.5, "챌린지 기록이 살아 있다");

  const sum = saveSummary(r.data);
  ok(sum.chapter === 2 && sum.cleared === 4, "이어하기 카드에 띄울 요약이 나온다");

  ok(clearSave(s), "지울 수 있다 (새 게임)");
  ok(loadSave(s).fresh, "지우면 처음 상태로 돌아간다");
}

console.log("\n===== 3. 깨진 저장본을 버리지 않는다 =====");
{
  // 문서 02 §46: "Save 업데이트 후 깨짐" 이 이 규모에서 제일 흔한 사고다.
  ok(loadSave(mkStore({ "spiderman.save": "{{{" })).broken, "JSON이 깨졌으면 broken 으로 알린다");
  ok(loadSave(mkStore({ "spiderman.save": "{{{" })).fresh, "깨졌으면 기본값으로 시작한다");

  // 필드가 빠진 옛 저장본 — 통째로 버리면 진행도가 날아간다
  const old = JSON.stringify({ schemaVersion: 1, story: { chapter: 3, mission: "m7" } });
  const r = loadSave(mkStore({ "spiderman.save": old }));
  ok(!r.fresh, "필드가 빠져도 저장본으로 인정한다");
  ok(r.data.story.chapter === 3 && r.data.story.mission === "m7", "있던 값은 그대로 산다");
  ok(Array.isArray(r.data.story.cleared), "없던 값은 기본값으로 메운다");
  ok(r.data.challenges && typeof r.data.challenges === "object", "없던 묶음도 메운다");

  // 미래 버전은 못 읽는다 (읽으면 더 위험하다)
  ok(migrate({ schemaVersion: 999 }) === null, "모르는 미래 버전은 거부한다");
  ok(migrate(null) === null && migrate("x") === null, "쓰레기를 넣어도 안 터진다");
}

console.log("\n===== 4. 저장소가 막혀 있어도 게임은 돈다 =====");
{
  // 사생활 보호 모드에서 localStorage 가 던지는 브라우저가 있다.
  const r = loadSave(angry);
  ok(r.fresh, "읽기가 막혀도 기본값으로 시작한다");
  ok(writeSave(angry, defaultSave()) === false, "쓰기가 막히면 false 를 돌려줄 뿐 안 던진다");
  ok(clearSave(angry) === false, "지우기가 막혀도 안 던진다");
}

console.log("\n===== 5. 병합 규칙 =====");
{
  ok(fill({ a: 1, b: { c: 2 } }, { b: { c: 9 } }).b.c === 9, "있는 값이 이긴다");
  ok(fill({ a: 1, b: { c: 2 } }, { b: {} }).a === 1, "없는 값은 기본값으로 메운다");
  ok(fill({ list: [1, 2] }, { list: [] }).list.length === 0,
     "배열은 통째로 바꾼다 (병합하면 지운 항목이 되살아난다)");
  ok(fill({ a: 1 }, { a: "문자열" }).a === 1, "타입이 다르면 기본값을 지킨다");
  ok(fill({ a: 1 }, { z: 5 }).z === 5, "기본값에 없는 키도 남긴다");
}

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
