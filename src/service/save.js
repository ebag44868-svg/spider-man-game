// 저장 (게임 밖 서비스 층)
//
// v1.0 의 save.js 를 웹스윙 전용판에 맞춰 다시 세웠다. 원칙은 그대로다.
//   - schemaVersion 은 반드시 둔다. 업데이트 뒤 저장본이 깨지는 게 가장 흔한 사고다.
//   - 이 파일은 브라우저를 모른다. storage 를 인자로 받는다 (localStorage 여도, 테스트용 가짜여도 된다).
//   - 깨졌거나 모르는 필드는 버리지 않고 기본값으로 메운다. 통째로 버리면 기록이 날아간다.
//
// 지금은 이 브라우저 안에만 저장한다. 계정·클라우드 저장이 생기면 storage 자리에
// 원격 어댑터를 끼우면 된다 (getItem / setItem 두 개만 맞추면 된다).

const SCHEMA = 1;
const KEY = "spiderman.v1.save";

function defaultSave() {
  return {
    schemaVersion: SCHEMA,
    createdAt: 0,
    lastPlayed: 0,
    profile: { name: "" },          // 닉네임. 비어 있으면 화면에 '플레이어'
    settings: {},                   // 설정 키 -> 값 (game3d.js 의 SETTINGS 표 키)
    stats: {},                      // stats.js 의 누적 기록
    records: {},                    // 모드별 최고 기록 (모드 id -> { best, at })
    achievements: {},               // 업적 id -> 달성 시각(ms)
    lastSpot: null,                 // 이어하기 자리 { x, y, z, yaw }
    seenNews: "",                   // 마지막으로 읽은 소식 id
  };
}

// 깊은 병합. 저장본에 없는 필드는 기본값으로 채운다. 배열은 통째로 바꾼다.
function fill(base, got) {
  if (got === undefined) return base;
  if (base === null) return got;               // null 자리는 '아직 정해지지 않음'이다. 타입으로 거르지 않는다
  if (got === null) return base;
  if (Array.isArray(base)) return Array.isArray(got) ? got : base;
  if (typeof base !== "object") return typeof got === typeof base ? got : base;
  if (typeof got !== "object" || Array.isArray(got)) return base;
  const out = {};
  for (const k of Object.keys(base)) out[k] = fill(base[k], got[k]);
  for (const k of Object.keys(got)) if (!(k in out)) out[k] = got[k];
  return out;
}

// 옛 저장본을 지금 모양으로. 버전이 오르면 여기에 단계를 덧붙인다. 예: if (v < 2) { ... }
function migrate(raw) {
  if (!raw || typeof raw !== "object") return null;
  const v = raw.schemaVersion;
  if (typeof v !== "number" || v > SCHEMA) return null;     // 미래 버전은 못 읽는다
  const out = fill(defaultSave(), raw);
  out.schemaVersion = SCHEMA;
  return out;
}

function loadSave(storage, key) {
  let txt = null;
  try { txt = storage && storage.getItem(key || KEY); } catch (e) { txt = null; }
  if (!txt) return { data: defaultSave(), fresh: true, broken: false };
  let raw = null;
  try { raw = JSON.parse(txt); } catch (e) { raw = null; }
  const m = raw ? migrate(raw) : null;
  if (!m) return { data: defaultSave(), fresh: true, broken: true };
  return { data: m, fresh: false, broken: false };
}

// 실패해도 게임이 멈추면 안 된다 (사생활 보호 모드에서 던지는 브라우저가 있다).
function writeSave(storage, data, key) {
  if (!storage) return false;
  try { storage.setItem(key || KEY, JSON.stringify(data)); return true; }
  catch (e) { return false; }
}

function clearSave(storage, key) {
  if (!storage) return false;
  try { storage.removeItem(key || KEY); return true; } catch (e) { return false; }
}

// 내보내기 / 가져오기. 가져오기도 migrate 를 거친다 — 손으로 고친 파일이 들어올 수 있다.
function exportSave(data) { return JSON.stringify(data, null, 2); }
function importSave(txt) {
  let raw = null;
  try { raw = JSON.parse(txt); } catch (e) { return null; }
  return migrate(raw);
}

export { SCHEMA, KEY, defaultSave, fill, migrate, loadSave, writeSave, clearSave, exportSave, importSave };
