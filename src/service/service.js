// 게임 밖 서비스 층의 창구 하나.
//
// game3d.js 는 이것만 안다: startSession / tick / event / endSession / setting / save.
// 저장 · 기록 · 업적이 각자 어떻게 도는지는 몰라도 된다. 화면(shell.js)도 이 창구로 읽는다.
// THREE 도 DOM 도 모른다 — Node 테스트에서 가짜 storage 로 그대로 검증한다.

import { loadSave, writeSave, clearSave, exportSave, importSave, defaultSave } from "./save.js";
import { newStats, mergeStats, newSession, tickSession, countEvent } from "./stats.js";
import { checkAchievements } from "./achievements.js";

const AUTOSAVE = 20;        // 초. 판 중간에 이만큼마다 기록을 저장본에 넣는다
const CHECK_EVERY = 0.5;    // 초. 업적 검사 주기 — 매 스텝(120Hz) 할 일이 아니다

function createService(opts) {
  const storage = opts && opts.storage || null;
  const now = opts && opts.now || (() => Date.now());
  const first = loadSave(storage);
  let data = first.data;
  let session = null;
  let checkT = 0, saveT = 0;
  const handlers = { unlock: [], saved: [] };
  const emit = (ev, x) => { for (const f of handlers[ev]) { try { f(x); } catch (e) { /* 화면 쪽 오류가 게임을 멈추면 안 된다 */ } } };

  // 저장본 누적 + 아직 안 넣은 몫
  function liveStats() {
    const t = mergeStats(newStats(), data.stats);
    return session ? mergeStats(t, session.pend) : t;
  }
  function commit() {
    if (!session) return;
    mergeStats(data.stats, session.pend);
    session.pend = newStats();
  }
  function save() {
    commit();
    data.lastPlayed = now();
    const ok = writeSave(storage, data);
    if (ok) emit("saved", data.lastPlayed);
    return ok;
  }
  function checkNow() {
    const got = checkAchievements(liveStats(), data.achievements, now());
    for (const id of got) {
      if (session) session.newAch.push(id);
      emit("unlock", id);
    }
    if (got.length) save();
    return got;
  }

  return {
    get data() { return data; },
    get fresh() { return first.fresh; },
    get broken() { return first.broken; },
    get session() { return session; },
    get hasStorage() { return !!storage; },
    hasContinue() { return !!data.lastSpot; },
    liveStats,

    startSession(mode) {
      if (session) this.endSession();
      if (!data.createdAt) data.createdAt = now();
      session = newSession(now(), mode);
      checkT = 0; saveT = 0;
      return session;
    },
    // 판을 닫는다. 결과 화면에 쓸 요약을 돌려준다.
    endSession() {
      if (!session) return null;
      countEvent(session, "sessions");
      checkNow();
      const out = { mode: session.mode, stats: { ...session.stats }, newAch: session.newAch.slice(), startedAt: session.startedAt };
      save();
      session = null;
      return out;
    },
    // 매 물리 스텝. s = { speed, alt, air }
    tick(dt, s) {
      if (!session) return;
      tickSession(session, dt, s);
      checkT += dt;
      if (checkT >= CHECK_EVERY) { checkT = 0; checkNow(); }
      saveT += dt;
      if (saveT >= AUTOSAVE) { saveT = 0; save(); }
    },
    event(name, n) { if (session) countEvent(session, name, n); },
    setSpot(spot) { data.lastSpot = spot ? { x: +spot.x, y: +spot.y, z: +spot.z, yaw: +spot.yaw || 0 } : null; },
    setting(key, v) { data.settings[key] = v; save(); },
    setName(name) { data.profile.name = String(name || "").trim().slice(0, 16); save(); },
    markNews(id) { data.seenNews = id; save(); },
    save,
    checkNow,
    on(ev, f) { if (handlers[ev]) handlers[ev].push(f); },

    exportText() { commit(); return exportSave(data); },
    importText(txt) {
      const d = importSave(txt);
      if (!d) return false;
      data = d;
      if (session) session.pend = newStats();
      save();
      return true;
    },
    // 기록 · 업적 · 이어하기를 지운다. 설정은 남긴다 — 초기화할 때마다 감도를 다시 맞추게 하면 짜증난다.
    reset() {
      const keep = data.settings;
      clearSave(storage);
      data = defaultSave();
      data.settings = keep;
      if (session) session = newSession(now(), session.mode);
      save();
    },
  };
}

export { createService, AUTOSAVE, CHECK_EVERY };
