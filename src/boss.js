// 보스
//
// 문서 02 §25. **HP가 큰 일반 적은 금지다.** 각 페이즈가 핵심 기술 하나를
// 시험하고, 페이즈마다 행동이 하나씩 는다.
//
//   1페이즈  회피    — 빨간 예고(돌진). 쳐낼 수 없다. 피해야만 한다
//   2페이즈  쳐내기  — 파란 예고(내려찍기·휘두르기)가 섞인다
//   3페이즈  환경    — 멀리서 잔해를 던진다. 붙어 있어야 안 맞는다
//
// 이 파일은 게임을 모른다. '지금 상황'을 받아 다음에 무엇을 할지만 답한다.
// 그래서 도시도 적도 없이 검증된다. 피해를 주고 넉백을 거는 건 부르는 쪽이 한다.
//
// 예고 색 규칙은 기존 적과 같다 — 파랑은 쳐낼 수 있고 빨강은 피해야 한다.
// 새 언어를 만들지 않는다. 플레이어가 이미 배운 것을 그대로 쓴다.

const MOVES = {
  charge: { name: "돌진",      tell: 0.80, hit: 0.22, dmg: 1.6, min: 8,  max: 46, parry: false, lunge: 42 },
  slam:   { name: "내려찍기",  tell: 0.62, hit: 0.20, dmg: 1.4, min: 0,  max: 13, parry: true,  lunge: 0 },
  swipe:  { name: "휘두르기",  tell: 0.42, hit: 0.14, dmg: 1.0, min: 0,  max: 15, parry: true,  lunge: 6 },
  hurl:   { name: "잔해 투척", tell: 0.95, hit: 0.28, dmg: 1.8, min: 20, max: 110, parry: false, lunge: 0 },
};

// 체력 비율이 이 아래로 내려가면 그 페이즈다. 위에서부터 본다.
const PHASES = [
  { n: 3, at: 0.34, name: "3페이즈", learn: "환경", moves: ["charge", "slam", "swipe", "hurl"], rest: 0.55, speed: 1.25 },
  { n: 2, at: 0.67, name: "2페이즈", learn: "쳐내기", moves: ["charge", "slam", "swipe"],        rest: 0.75, speed: 1.10 },
  { n: 1, at: 1.01, name: "1페이즈", learn: "회피",   moves: ["charge", "slam"],                 rest: 1.05, speed: 1.00 },
];

function phaseOf(ratio) {
  for (const p of PHASES) if (ratio <= p.at) return p;
  return PHASES[PHASES.length - 1];
}

function makeBoss(maxHp) {
  return {
    maxHp: maxHp || 60,
    hp: maxHp || 60,
    phase: 1,
    state: "idle",       // idle | tell | strike | rest | dead
    move: null,          // 지금 쓰는 기술 이름
    t: 0,                // 지금 상태에 머문 시간
    rest: 0,             // 다음 행동까지 남은 시간
    hits: 0,             // 맞힌 횟수 (검증용)
    parried: 0,          // 쳐내기당한 횟수
  };
}

// 거리에 맞는 기술을 고른다. 없으면 null (붙거나 물러날 시간이다).
function pickMove(phase, dist, rnd) {
  const ok = phase.moves.filter(k => {
    const m = MOVES[k];
    return dist >= m.min && dist <= m.max;
  });
  if (!ok.length) return null;
  // 같은 기술만 반복하면 읽히는 게 아니라 지루해진다. 고르되 치우치지 않게.
  const r = typeof rnd === "number" ? rnd : Math.random();
  return ok[Math.min(ok.length - 1, Math.floor(r * ok.length))];
}

// 한 틱. w = { dist, parryHit }  parryHit = 이번 틱에 플레이어가 쳐냈는가.
// 돌려주는 것은 이번 틱에 일어난 사건 하나다.
//   { type: "phase", phase }   페이즈가 올라갔다 (연출·안내)
//   { type: "tell", move, spec }  예고 시작 (파랑/빨강 표시를 켠다)
//   { type: "hit", move, spec }   판정 (피해를 줄지는 부르는 쪽이 거리로 정한다)
//   { type: "parried" }           쳐내기당했다 (크게 무너진다)
//   { type: "dead" }
//   null                          아무 일 없음
function updateBoss(b, w, dt, rnd) {
  if (b.state === "dead") return null;
  if (b.hp <= 0) { b.state = "dead"; b.move = null; return { type: "dead" }; }

  // 페이즈는 체력만 본다. 시간으로 올리면 잘 싸울수록 손해가 된다.
  const p = phaseOf(b.hp / b.maxHp);
  if (p.n !== b.phase) {
    b.phase = p.n;
    b.state = "rest";
    b.rest = 1.2;                 // 전환 연출 동안은 때리지 않는다
    b.move = null;
    b.t = 0;
    return { type: "phase", phase: p };
  }

  b.t += dt;

  if (b.state === "tell") {
    const spec = MOVES[b.move];
    // 쳐낼 수 있는 기술만 쳐내진다. 빨간 예고는 피해야 한다 — 이게 페이즈의 교훈이다.
    if (w.parryHit && spec.parry) {
      b.parried++;
      b.state = "rest";
      b.rest = 1.6;               // 쳐내면 크게 벌어진다. 반격할 틈이다
      b.move = null; b.t = 0;
      return { type: "parried", spec };
    }
    if (b.t >= spec.tell) { b.state = "strike"; b.t = 0; return { type: "hit", move: b.move, spec }; }
    return null;
  }

  if (b.state === "strike") {
    const spec = MOVES[b.move];
    if (b.t >= spec.hit) {
      b.hits++;
      b.state = "rest";
      b.rest = p.rest;
      b.move = null; b.t = 0;
    }
    return null;
  }

  if (b.state === "rest") {
    b.rest -= dt;
    if (b.rest <= 0) { b.state = "idle"; b.t = 0; }
    return null;
  }

  // idle — 거리를 보고 다음 기술을 고른다
  const k = pickMove(p, w.dist, rnd);
  if (!k) return null;            // 사거리 밖. 부르는 쪽이 걸어오게 한다
  b.move = k;
  b.state = "tell";
  b.t = 0;
  return { type: "tell", move: k, spec: MOVES[k] };
}

function bossDamage(b, amount) {
  if (b.state === "dead") return false;
  b.hp = Math.max(0, b.hp - amount);
  return b.hp <= 0;
}

export { MOVES, PHASES, phaseOf, makeBoss, pickMove, updateBoss, bossDamage };
