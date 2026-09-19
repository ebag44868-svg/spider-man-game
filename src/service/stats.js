// 플레이 기록 (게임 밖 서비스 층)
//
// 게임은 매 스텝 속도·고도·공중 여부만 넘기고, 사건(거미줄·새총·스침·차 사고·쓰러짐)은
// 이름으로 센다. 여기선 THREE 도 DOM 도 모른다 — Node 테스트에서 그대로 돈다.
//
// 기록은 두 갈래로 쌓인다.
//   stats  이번 판 전체 — 결과 화면에 보여준다
//   pend   아직 저장본에 안 넣은 몫 — 자동 저장 때 누적 기록에 합치고 비운다
// 이렇게 나눠야 판 중간에 탭을 닫아도 그때까지의 기록이 남고, 두 번 더해지지도 않는다.

// SUM 은 더하고, MAX 는 큰 쪽을 남긴다.
const STAT_KIND = {
  playtime: "sum",      // 초
  distance: "sum",      // m (속도 x 시간)
  airDistance: "sum",   // m, 땅을 안 밟고 간 거리
  webs: "sum",          // 쏜 거미줄 (빗나간 것 포함)
  slings: "sum",        // 양손 새총 발사
  grazes: "sum",        // 벽 스침
  carHits: "sum",       // 차에 치인 횟수
  falls: "sum",         // 쓰러져서 다시 시작한 횟수
  sessions: "sum",      // 판 수
  topSpeed: "max",      // m/s
  maxAlt: "max",        // m
  longestAir: "max",    // 초, 땅을 안 밟고 버틴 최장 시간
};
const STAT_KEYS = Object.keys(STAT_KIND);

function newStats() {
  const s = {};
  for (const k of STAT_KEYS) s[k] = 0;
  return s;
}

// into 에 add 를 합친다 (into 가 바뀐다). 저장본의 stats 는 비어 있거나 모르는 키가 섞여 있을 수 있다.
function mergeStats(into, add) {
  for (const k of STAT_KEYS) {
    const a = typeof into[k] === "number" && isFinite(into[k]) ? into[k] : 0;
    const b = typeof add[k] === "number" && isFinite(add[k]) ? add[k] : 0;
    into[k] = STAT_KIND[k] === "max" ? Math.max(a, b) : a + b;
  }
  return into;
}

function newSession(startedAt, mode) {
  return { startedAt, mode: mode || "free", stats: newStats(), pend: newStats(), air: 0, newAch: [] };
}

// s = { speed (m/s), alt (m, 지면 기준 아님 — 월드 높이), air (bool) }
function tickSession(sess, dt, s) {
  if (!(dt > 0)) return;
  const d = Math.max(0, s.speed || 0) * dt;
  for (const st of [sess.stats, sess.pend]) {
    st.playtime += dt;
    st.distance += d;
    if (s.air) st.airDistance += d;
    if (s.speed > st.topSpeed) st.topSpeed = s.speed;
    if (s.alt > st.maxAlt) st.maxAlt = s.alt;
  }
  sess.air = s.air ? sess.air + dt : 0;
  if (sess.air > sess.stats.longestAir) sess.stats.longestAir = sess.air;
  if (sess.air > sess.pend.longestAir) sess.pend.longestAir = sess.air;
}

function countEvent(sess, name, n) {
  if (STAT_KIND[name] !== "sum") return false;
  const k = n === undefined ? 1 : n;
  sess.stats[name] += k;
  sess.pend[name] += k;
  return true;
}

// 화면 표시용. 단위를 여기서 한 번에 정한다 — 화면마다 따로 바꾸면 반드시 어긋난다.
const STAT_INFO = [
  { key: "playtime", label: "플레이 시간" },
  { key: "sessions", label: "플레이 횟수" },
  { key: "distance", label: "이동 거리" },
  { key: "airDistance", label: "공중 이동" },
  { key: "topSpeed", label: "최고 속도" },
  { key: "maxAlt", label: "최고 고도" },
  { key: "longestAir", label: "최장 체공" },
  { key: "webs", label: "거미줄" },
  { key: "slings", label: "양손 새총" },
  { key: "grazes", label: "벽 스침" },
  { key: "carHits", label: "차 사고" },
  { key: "falls", label: "쓰러짐" },
];

function fmtStat(key, v) {
  v = v || 0;
  switch (key) {
    case "playtime": {
      const m = Math.floor(v / 60), h = Math.floor(m / 60);
      if (h > 0) return `${h}시간 ${m % 60}분`;
      if (m > 0) return `${m}분 ${Math.floor(v % 60)}초`;
      return `${Math.floor(v)}초`;
    }
    case "distance": case "airDistance":
      return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} km` : `${Math.round(v)} m`;
    case "topSpeed": return `${Math.round(v * 3.6)} km/h`;
    case "maxAlt": return `${Math.round(v).toLocaleString("ko-KR")} m`;
    case "longestAir": return `${v.toFixed(1)}초`;
    default: return `${Math.round(v).toLocaleString("ko-KR")}${key === "sessions" ? "판" : "회"}`;
  }
}

export { STAT_KIND, STAT_KEYS, STAT_INFO, newStats, mergeStats, newSession, tickSession, countEvent, fmtStat };
