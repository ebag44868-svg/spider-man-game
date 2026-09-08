// 저장 / 이어하기
//
// 문서 02 §29. 웹 게임이니 local save 가 현실적이다. 작게 시작하되
// **schemaVersion 은 반드시 둔다** — 업데이트 후 저장 데이터가 깨지는 게
// 이 규모 프로젝트에서 제일 흔한 사고다.
//
// 이 파일은 브라우저를 모른다. storage 를 인자로 받는다 (localStorage 여도 되고
// 테스트용 가짜여도 된다). 그래서 Node 하네스에서 그대로 검증할 수 있다.
//
// 읽기 규칙: 저장본이 깨졌거나 모르는 버전이면 **버리지 않고 기본값으로 메운다.**
// 통째로 버리면 사소한 필드 하나 때문에 진행도가 날아간다.

const SCHEMA = 1;
const KEY = "spiderman.save";

// 기본 저장본. 새 항목을 추가할 때는 여기와 migrate 둘 다 손댄다.
function defaultSave() {
  return {
    schemaVersion: SCHEMA,
    createdAt: 0,
    lastPlayed: 0,
    playtime: 0,                 // 초
    character: "fighter",        // 마지막으로 고른 캐릭터
    story: { chapter: 0, mission: null, cleared: [] },
    unlocked: { characters: ["swinger", "shooter", "fighter"], abilities: [] },
    tutorial: { done: [] },      // 끝낸 튜토리얼 id
    challenges: {},              // id -> { best, rank, runs }
    settings: {},                // SettingsManager 가 채운다
    checkpoint: null,            // { missionId, stage }
  };
}

// 깊은 병합. 저장본에 없는 필드는 기본값으로 채우고, 있는 필드는 그대로 둔다.
// 배열은 통째로 바꾼다 (원소를 병합하면 지운 항목이 되살아난다).
function fill(base, got) {
  if (got === undefined) return base;
  // 기본값이 null 인 자리(진행 중인 미션 · 체크포인트)는 아직 정해지지 않았다는 뜻이다.
  // 타입으로 거르면 안 된다 — 실제로 story.mission 에 넣은 "m5" 가 통째로 버려졌다.
  if (base === null) return got;
  if (got === null) return base;
  if (Array.isArray(base)) return Array.isArray(got) ? got : base;
  if (typeof base !== "object") return typeof got === typeof base ? got : base;
  if (typeof got !== "object" || Array.isArray(got)) return base;
  const out = {};
  for (const k of Object.keys(base)) out[k] = fill(base[k], got[k]);
  // 기본값에 없는 키도 남긴다 (앞선 버전에서 지운 항목을 되살릴 여지)
  for (const k of Object.keys(got)) if (!(k in out)) out[k] = got[k];
  return out;
}

// 옛 저장본을 지금 모양으로. 버전이 올라가면 여기에 단계를 덧붙인다.
function migrate(raw) {
  if (!raw || typeof raw !== "object") return null;
  const v = raw.schemaVersion;
  if (typeof v !== "number" || v > SCHEMA) return null;   // 미래 버전은 못 읽는다
  // v1 이 최초라 아직 올릴 단계가 없다. 예: if (v < 2) { ...; }
  const out = fill(defaultSave(), raw);
  out.schemaVersion = SCHEMA;
  return out;
}

// 읽는다. 저장본이 없거나 못 읽으면 { data: 기본값, fresh: true }.
function loadSave(storage, key) {
  const k = key || KEY;
  let txt = null;
  try { txt = storage && storage.getItem(k); } catch (e) { txt = null; }
  if (!txt) return { data: defaultSave(), fresh: true, broken: false };
  let raw = null;
  try { raw = JSON.parse(txt); } catch (e) { raw = null; }
  const m = raw ? migrate(raw) : null;
  if (!m) return { data: defaultSave(), fresh: true, broken: true };
  return { data: m, fresh: false, broken: false };
}

// 쓴다. 실패해도 게임이 멈추면 안 된다 (사생활 보호 모드에서 던지는 브라우저가 있다).
function writeSave(storage, data, key) {
  try {
    storage.setItem(key || KEY, JSON.stringify(data));
    return true;
  } catch (e) { return false; }
}

function clearSave(storage, key) {
  try { storage.removeItem(key || KEY); return true; } catch (e) { return false; }
}

// 이어하기 카드에 띄울 요약 (문서 02 §5.3)
function saveSummary(data) {
  if (!data) return null;
  return {
    chapter: data.story.chapter,
    mission: data.story.mission,
    cleared: data.story.cleared.length,
    character: data.character,
    lastPlayed: data.lastPlayed,
    playtime: data.playtime,
    tutorials: data.tutorial.done.length,
  };
}

export { SCHEMA, KEY, defaultSave, migrate, loadSave, writeSave, clearSave, saveSummary, fill };
