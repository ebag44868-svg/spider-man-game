// 게임 밖 서비스 층 — 저장 · 기록 · 업적 (하네스 없이 모듈만 직접 부른다)
//
//   1) 저장본: 없음 / 깨짐 / 미래 버전 / 옛 필드 누락 → 기본값으로 메우고 버리지 않는다
//   2) 기록: 판 중간 자동 저장이 기록을 두 번 더하지 않는다 · 최대값 항목은 더하지 않는다
//   3) 업적: 목표를 넘는 순간 한 번만 달성 · 판 요약에 실린다
//   4) 초기화는 설정을 남긴다 · 내보내기 → 가져오기가 왕복한다
import { createService, AUTOSAVE } from "./src/service/service.js";
import { loadSave, SCHEMA, KEY } from "./src/service/save.js";
import { fmtStat } from "./src/service/stats.js";
import { ACHIEVEMENTS } from "./src/service/achievements.js";
import { MODES, SETTINGS_TABS, SUITS } from "./src/service/catalog.js";

let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };
function memStore(init) {
  const m = new Map(Object.entries(init || {}));
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m };
}
const DT = 1 / 120;
function run(svc, sec, s) { for (let i = 0; i < Math.round(sec / DT); i++) svc.tick(DT, s); }

console.log("===== 1. 저장본 읽기 =====");
{
  ok(loadSave(memStore()).fresh, "저장본이 없으면 새로 시작");
  const br = loadSave(memStore({ [KEY]: "{깨짐" }));
  ok(br.fresh && br.broken, "깨진 저장본 → 기본값 + broken 표시");
  ok(loadSave(memStore({ [KEY]: JSON.stringify({ schemaVersion: SCHEMA + 1 }) })).broken, "미래 버전은 못 읽는다고 표시");
  const old = loadSave(memStore({ [KEY]: JSON.stringify({ schemaVersion: 1, stats: { webs: 7 }, mystery: 3 }) }));
  ok(!old.fresh && old.data.stats.webs === 7 && old.data.achievements && old.data.mystery === 3,
    "빠진 필드는 메우고, 있는 값과 모르는 키는 남긴다");
  ok(loadSave(null).fresh && createService({ storage: null }).save() === false, "저장소가 없어도(시크릿 창) 안 죽는다");
}

console.log("===== 2. 기록 =====");
{
  const st = memStore();
  const svc = createService({ storage: st });
  svc.startSession("free");
  run(svc, 30, { speed: 40, alt: 120, air: true });           // 30초 = 자동 저장 한 번 이상
  svc.event("webs", 3); svc.event("slings");
  const saved = JSON.parse(st.getItem(KEY));
  ok(saved.stats.distance >= 790 && saved.stats.distance < 1200, "판 중간 저장(자동 20초 · 업적 달성 시)에 이동 거리가 들어간다", saved.stats.distance);
  const r = svc.endSession();
  const again = JSON.parse(st.getItem(KEY)).stats;
  ok(Math.abs(again.distance - 1200) < 1, "판을 닫아도 거리가 두 번 더해지지 않는다 (40m/s x 30초 = 1200m)", again.distance);
  ok(Math.abs(r.stats.distance - 1200) < 1 && r.stats.webs === 3 && r.stats.slings === 1, "판 요약 = 이번 판 전체");
  ok(Math.abs(again.longestAir - 30) < 0.05 && again.sessions === 1, "최장 체공 30초 · 1판");
  // 두 번째 판 — 최대값 항목은 더하지 않는다
  svc.startSession("free");
  run(svc, 5, { speed: 20, alt: 80, air: false });
  svc.endSession();
  const t2 = svc.liveStats();
  ok(Math.abs(t2.topSpeed - 40) < 1e-6 && Math.abs(t2.maxAlt - 120) < 1e-6, "최고 속도·고도는 큰 쪽만 남는다");
  ok(Math.abs(t2.distance - 1300) < 1 && t2.sessions === 2, "거리는 더해진다 (1200 + 100)");
  ok(fmtStat("topSpeed", 40) === "144 km/h" && fmtStat("distance", 1300) === "1.30 km" && fmtStat("playtime", 3725) === "1시간 2분",
    "표시 단위", `${fmtStat("topSpeed", 40)} / ${fmtStat("distance", 1300)} / ${fmtStat("playtime", 3725)}`);
  ok(AUTOSAVE <= 30, "자동 저장 주기");
}

console.log("===== 3. 업적 =====");
{
  const svc = createService({ storage: memStore() });
  const got = [];
  svc.on("unlock", id => got.push(id));
  svc.startSession("free");
  svc.event("webs");
  run(svc, 1, { speed: 60, alt: 50, air: true });            // 216 km/h
  ok(got.includes("first_web") && got.includes("speed_200"), "첫 거미줄 · 시속 200 달성", got.join(","));
  const n = got.length;
  run(svc, 1, { speed: 60, alt: 50, air: true });
  ok(got.length === n, "같은 업적이 두 번 뜨지 않는다");
  const r = svc.endSession();
  ok(r.newAch.includes("first_web"), "판 요약에 새 업적이 실린다");
  ok(ACHIEVEMENTS.every(a => a.goal > 0 && a.stat), "업적 표에 빈 목표가 없다");
}

console.log("===== 4. 초기화 · 내보내기 · 이어하기 =====");
{
  const st = memStore();
  const svc = createService({ storage: st });
  svc.setting("sens", 1.25);
  svc.startSession("free"); svc.event("webs", 5);
  svc.setSpot({ x: 10, y: 40, z: -20, yaw: 1.5 });
  svc.endSession();
  ok(svc.hasContinue(), "이어하기 자리가 저장된다");
  const txt = svc.exportText();
  svc.reset();
  ok(!svc.hasContinue() && (svc.liveStats().webs === 0) && svc.data.settings.sens === 1.25, "초기화: 기록·이어하기는 지우고 설정은 남긴다");
  ok(svc.importText(txt) && svc.liveStats().webs === 5 && svc.hasContinue(), "내보낸 파일을 다시 가져온다");
  ok(!svc.importText("아무거나") && svc.liveStats().webs === 5, "엉뚱한 파일은 거부하고 지금 기록을 지킨다");
  const svc2 = createService({ storage: st });
  ok(svc2.data.settings.sens === 1.25 && svc2.data.lastSpot.z === -20, "새로 켜도 설정·자리가 살아 있다");
}

console.log("===== 5. 목록 데이터 =====");
{
  ok(MODES.filter(m => m.status === "open").length >= 1 && MODES.find(m => m.id === "free").status === "open", "자유 탐험은 열려 있다");
  ok(SUITS.every(s => !s.unlock || ACHIEVEMENTS.some(a => a.id === s.unlock)), "슈트 해금 조건이 실제 업적을 가리킨다");
  const keys = SETTINGS_TABS.flatMap(t => t.rows.filter(r => r.key).map(r => r.key));
  ok(new Set(keys).size === keys.length, "설정 항목이 두 탭에 겹치지 않는다");
}

console.log(`\n통과 ${pass} / 실패 ${fail}`);
if (fail) process.exitCode = 1;
