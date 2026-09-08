// 웹 디버그 — 앵커 후보를 눈으로 본다
//
// 문서 03 §42 · §43. 자유 웹은 코드보다 튜닝이 어려운 작업이고,
// 튜닝은 "왜 저 건물에 걸렸지"를 추측으로 고치기 시작하는 순간 망한다.
// 그래서 AUTO ANCHOR V2(A2)보다 이걸 먼저 만든다.
//
// 이 파일은 게임을 모른다. 후보를 받아 담고, 정렬하고, 글자로 만든다.
// THREE 오브젝트를 여기서 만들지 않는 것도 의도다 — 마커는 부르는 쪽이
// '켤 때' 만든다. 선언 자리에서 만들면 uuid 가 난수를 먹어 도시 생성이
// 통째로 밀린다 (상완에서 한 번, 보조 웹에서 한 번 겪었다).

const MAX_CAND = 64;          // 이 이상은 화면에서도 안 읽힌다

let on = false;
const cands = [];             // { x, y, z, score, ok, why, side }
let picked = null;            // 채택된 지점 { x, y, z }
let pickIdx = -1;

function dbgOn() { return on; }

function setDbg(v) {
  on = !!v;
  if (!on) dbgClear();
  return on;
}

function dbgClear() { cands.length = 0; picked = null; pickIdx = -1; }

// 한 번의 탐색 시작. 매 탐색마다 불러 이전 후보를 지운다.
function dbgBegin() { if (on) dbgClear(); }

// 후보 하나. ok=false 면 왜 떨어졌는지 why 에 짧게 남긴다.
//   why 예: "짧음" "멂" "아래" "뒤" "막힘"
function dbgCand(p, score, ok, why, side) {
  if (!on || cands.length >= MAX_CAND) return;
  cands.push({
    x: p.x, y: p.y, z: p.z,
    score: score, ok: !!ok,
    why: why || "", side: side || "",
  });
}

// 최종 채택. 좌표로 후보 목록에서 몇 번이었는지 되찾아 둔다 —
// 화면에서 "23개 중 7번이 뽑혔다"가 보여야 점수식을 의심할 수 있다.
function dbgPick(p) {
  if (!on) return;
  if (!p) { picked = null; pickIdx = -1; return; }
  picked = { x: p.x, y: p.y, z: p.z };
  pickIdx = -1;
  let bd = 1e9;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    const d = (c.x - p.x) ** 2 + (c.y - p.y) ** 2 + (c.z - p.z) ** 2;
    if (d < bd) { bd = d; pickIdx = i; }
  }
  if (bd > 0.25) pickIdx = -1;      // 후보 목록에 없는 지점이면 표시하지 않는다
}

function dbgCands() { return cands; }
function dbgPicked() { return picked; }
function dbgPickIdx() { return pickIdx; }
function dbgAccepted() { let n = 0; for (const c of cands) if (c.ok) n++; return n; }

// 점수 높은 순 상위 몇 개. 화면에 다 못 넣으니 잘라서 준다.
function dbgTop(n) {
  return cands.slice().sort((a, b) => b.score - a.score).slice(0, n || 5);
}

function num(v, d) { return (v === undefined || v === null || v !== v) ? "—" : v.toFixed(d === undefined ? 1 : d); }
function vec(v, d) { return v ? `(${num(v.x, d)}, ${num(v.y, d)}, ${num(v.z, d)})` : "—"; }

// 패널 본문. 게임 상태를 받아 줄 배열로 돌려준다.
// 순수 함수라 테스트가 쉽다 — 화면에 뭘 그렸는지가 아니라
// 무엇을 보여주기로 했는지를 검사한다.
function dbgLines(s) {
  s = s || {};
  const L = [];
  L.push(`조준 ${s.aim || "—"}   시점 ${s.view || "—"}   웹 ${s.webMode || "AUTO"}`);
  L.push(`주웹 ${s.webR || "없음"}`);
  L.push(`보조 ${s.webL || "없음"}`);
  L.push(`손   주 ${s.primary || "—"}   직전 ${s.lastHand || "—"}`);
  L.push(`앵커 ${vec(s.anchor)}`);
  const nOk = dbgAccepted();
  L.push(`후보 ${cands.length}개 (통과 ${nOk})   채택 ${pickIdx >= 0 ? "#" + pickIdx : "—"}` +
         `   점수 ${pickIdx >= 0 ? num(cands[pickIdx].score, 2) : "—"}`);
  for (const c of dbgTop(4)) {
    const i = cands.indexOf(c);
    L.push(`  #${i} ${num(c.score, 2).padStart(6)} ${c.side || "-"} ` +
           (c.ok ? "통과" : "기각 " + c.why));
  }
  L.push(`속도 ${num(s.speed)} m/s   ${vec(s.vel)}`);
  L.push(`의도 ${vec(s.intent, 2)}`);
  L.push(`벽   plant ${num(s.plantT, 2)}  cd ${num(s.plantCd, 2)}  cling ${s.cling ? "O" : "X"}`);
  L.push(`카메라 dist ${num(s.camDist)}  fov ${num(s.fov)}  roll ${num(s.roll, 2)}`);
  L.push(`곡예 ${s.acro || 0}  연출 ${s.cine || 0}  등반 ${s.vclimb || 0}`);
  return L;
}

export {
  MAX_CAND, dbgOn, setDbg, dbgClear, dbgBegin, dbgCand, dbgPick,
  dbgCands, dbgPicked, dbgPickIdx, dbgAccepted, dbgTop, dbgLines,
};
