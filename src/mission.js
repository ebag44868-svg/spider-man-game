// 미션 / 챌린지 — 데이터 기반
//
// 문서 02 §20~24. 미션을 코드에 하나씩 하드코딩하지 않는다. 미션마다 if 문을
// 세우기 시작하면 곧 손댈 수 없게 된다. 정의는 데이터로 두고, 여기서는
// **목표 종류(objective type)** 몇 개만 해석한다.
//
// 챌린지도 같은 시스템이다. 기록을 남기느냐(record) 만 다르다 — 별도 시스템을
// 만들면 같은 코드를 두 벌 갖게 된다.
//
// 이 파일은 게임을 모른다. 매 틱 '세상의 요약'을 받아 진행도만 갱신한다.
//   w = { x, z, y, killed, alive, hp, maxHp, acts: {키: 횟수}, hostage: 'safe'|'lost' }
// 그래서 Node 하네스에서 도시 없이도 검증된다.

// ---------- 목표 ----------
// 새 종류를 더할 때 손댈 곳은 makeObj / stepObj 두 군데뿐이다.
//   defeat      적을 n명 쓰러뜨린다
//   reach       한 지점 반경 r 안에 들어간다
//   checkpoints 여러 지점을 순서대로 지난다 (타임어택)
//   survive     t초 버틴다
//   action      특정 행동을 n번 한다 (쳐내기 · 띄우기 · 벽 짚기 …)
//   boss        보스를 쓰러뜨린다 (defeat 의 특수형 — 연출과 HUD가 다르다)
function makeObj(spec) {
  const o = { spec, done: false, n: 0, need: 1, t: 0, idx: 0 };
  if (spec.type === "defeat" || spec.type === "boss") o.need = spec.n || 1;
  else if (spec.type === "action") o.need = spec.n || 1;
  else if (spec.type === "checkpoints") o.need = (spec.points || []).length;
  else if (spec.type === "survive") o.need = spec.t || 10;
  return o;
}

function near(w, p, r) {
  const dx = w.x - p.x, dz = w.z - p.z;
  return Math.hypot(dx, dz) <= (r === undefined ? p.r || 18 : r);
}

// 목표 하나를 한 틱 진행시킨다. base 는 미션 시작 시점의 누적값이다
// (킬 수 같은 건 전역 카운터라 시작점을 빼야 이번 미션의 몫이 나온다).
function stepObj(o, w, dt, base) {
  if (o.done) return;
  const s = o.spec;
  o.t += dt;
  switch (s.type) {
    case "defeat":
      o.n = Math.max(0, (w.killed || 0) - (base.killed || 0));
      if (o.n >= o.need) o.done = true;
      break;
    case "boss":
      // 잡몹 처치 수로 세면 안 된다. 보스전 중에 부하를 잡아도 끝나 버린다.
      o.n = w.bossDead ? 1 : 0;
      if (o.n >= 1) o.done = true;
      break;
    case "reach":
      if (near(w, s, s.r)) { o.n = 1; o.done = true; }
      break;
    case "checkpoints": {
      const pts = s.points || [];
      if (o.idx < pts.length && near(w, pts[o.idx], pts[o.idx].r)) o.idx++;
      o.n = o.idx;
      if (o.idx >= pts.length) o.done = true;
      break;
    }
    case "survive":
      o.n = Math.min(o.need, o.t);
      if (o.t >= o.need) o.done = true;
      break;
    case "action": {
      const cur = (w.acts && w.acts[s.key]) || 0;
      o.n = Math.max(0, cur - ((base.acts && base.acts[s.key]) || 0));
      if (o.n >= o.need) o.done = true;
      break;
    }
    default:
      o.done = true;      // 모르는 종류는 막지 않는다. 미션이 통째로 멈추면 더 나쁘다
  }
}

function objText(o) {
  const s = o.spec;
  if (s.label) return s.label;
  switch (s.type) {
    case "defeat": return `적 ${o.need}명 처치`;
    case "boss":   return `보스 처치`;
    case "reach":  return `목표 지점 도달`;
    case "checkpoints": return `체크포인트 ${o.need}곳 통과`;
    case "survive": return `${o.need}초 버티기`;
    case "action": return `${s.name || s.key} ${o.need}회`;
    default: return "목표";
  }
}
function objProgress(o) {
  const s = o.spec;
  if (s.type === "reach") return o.done ? "완료" : "";
  if (s.type === "survive") return `${Math.min(o.need, Math.floor(o.n))} / ${o.need}초`;
  return `${Math.floor(o.n)} / ${o.need}`;
}

// ---------- 진행 ----------
function makeRun(def, base) {
  return {
    def,
    base: { killed: (base && base.killed) || 0, acts: Object.assign({}, (base && base.acts) || {}) },
    objs: (def.objectives || []).map(makeObj),
    t: 0,
    state: "run",          // run | clear | fail
    failReason: "",
  };
}

// 실패 조건. 문서 02 §20 의 failConditions.
function checkFail(run, w) {
  for (const f of run.def.failConditions || []) {
    if (f.type === "death" && w.hp <= 0) return "쓰러졌다";
    if (f.type === "timeout" && run.t >= f.t) return "시간 초과";
    if (f.type === "hostage" && w.hostage === "lost") return "인질을 지키지 못했다";
  }
  return "";
}

function updateRun(run, w, dt) {
  if (run.state !== "run") return run.state;
  run.t += dt;
  const bad = checkFail(run, w);
  if (bad) { run.state = "fail"; run.failReason = bad; return run.state; }
  // 목표는 순서대로 하나씩 연다. 한 번에 다 열면 무엇을 할지 안 읽힌다.
  const seq = run.def.sequential !== false;
  for (let i = 0; i < run.objs.length; i++) {
    const o = run.objs[i];
    if (o.done) continue;
    stepObj(o, w, dt, run.base);
    if (seq) break;
  }
  if (run.objs.every(o => o.done)) run.state = "clear";
  return run.state;
}

// 지금 보여줄 목표 (HUD 한 줄). 다 끝났으면 null.
function currentObj(run) {
  for (const o of run.objs) if (!o.done) return o;
  return null;
}

// ---------- 결과 ----------
// 등급. 문서 02 §24 — 점수 시스템을 복잡하게 만들지 않는다.
// 시간 기준이 있으면 시간으로, 없으면 클리어 자체로 친다.
const RANKS = ["S", "A", "B", "C"];
function rankOf(def, run) {
  const g = def.gold, s = def.silver, b = def.bronze;
  if (!g) return run.state === "clear" ? "A" : "-";
  const t = run.t;
  if (t <= g) return "S";
  if (t <= (s || g * 1.35)) return "A";
  if (t <= (b || g * 1.8)) return "B";
  return "C";
}
function rankBetter(a, b) {
  if (!a) return true;
  const ia = RANKS.indexOf(a), ib = RANKS.indexOf(b);
  if (ia < 0) return true;
  if (ib < 0) return false;
  return ib < ia;
}

function makeResult(run) {
  const def = run.def;
  return {
    id: def.id,
    title: def.title,
    clear: run.state === "clear",
    reason: run.failReason,
    time: run.t,
    rank: run.state === "clear" ? rankOf(def, run) : "-",
    reward: run.state === "clear" ? (def.reward || null) : null,
    next: def.next || null,
    record: !!def.record,
  };
}

// 기록 갱신. 챌린지에서 쓴다. 더 좋아졌으면 true.
function updateRecord(rec, result) {
  if (!result.clear) return false;
  const better = !rec || result.time < rec.best || rankBetter(rec.rank, result.rank);
  if (!better) return false;
  return true;
}

export {
  makeObj, stepObj, objText, objProgress,
  makeRun, updateRun, currentObj, checkFail,
  rankOf, rankBetter, makeResult, updateRecord, RANKS,
};
