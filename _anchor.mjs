// AUTO ANCHOR V2 — 문서 03 §9~§12
//
// 재는 것은 하나다. **정확히 조준하지 않아도 내가 가고 싶은 쪽에 걸리는가.**
// 문서 §49 의 1차 성공 기준이 그 문장이다.
import { T } from "./_harness.mjs";
const DT = 1 / 120;
T.syncWorld();
let pass = 0, fail = 0;
const ok = (c, m, x = "") => { if (c) { pass++; console.log("  OK   " + m); } else { fail++; console.log("  FAIL " + m + "  " + x); } };
const P = T.player;

// yaw=0 이면 앞은 +Z, 오른쪽은 -X 다 (rightV = fwd x up).
// 예전에 여기서 좌우를 뒤집어 읽고 한참 헤맸다.
function ctx(o) {
  return Object.assign({ px: 0, py: 100, pz: 0, vx: 0, vz: 0, camYaw: 0,
                         moveX: 0, moveZ: 0, hand: "R",
                         ropeMax: 150, minLen: 18 }, o);
}
const deg = v => (v * 180 / Math.PI).toFixed(1);
function dirDeg(d) { return Math.atan2(d.x, d.z) * 180 / Math.PI; }

console.log("===== 1. 의도 벡터 =====");
{
  // 가만히 서서 보는 곳 = 가고 싶은 곳
  let i = T.intentDir(ctx({}));
  ok(Math.abs(dirDeg(i)) < 1, "멈춰 있으면 시선 방향", deg(Math.atan2(i.x, i.z)));

  // 빠르게 날면서 고개만 돌렸다 — 앵커가 고개를 그대로 따라가면 안 된다.
  // 이게 legacy 의 가장 큰 문제였다: 고속에서 시선만 보고 90도로 꺾였다.
  const fast = T.intentDir(ctx({ vz: 80, camYaw: Math.PI / 2 }));
  const slow = T.intentDir(ctx({ vz: 6, camYaw: Math.PI / 2 }));
  const fastOff = Math.abs(dirDeg(fast));      // 0 = 관성(+Z) 유지, 90 = 시선 추종
  const slowOff = Math.abs(dirDeg(slow));
  ok(fastOff < slowOff - 15, "빠를수록 관성이 이긴다 (급snap 방지)",
     `고속 ${fastOff.toFixed(0)}도 vs 저속 ${slowOff.toFixed(0)}도`);
  ok(fastOff < 55, "고속에서는 시선을 90도 꺾어도 절반 이하만 꺾인다", `${fastOff.toFixed(0)}도`);
  ok(slowOff > 60, "저속에서는 시선을 거의 그대로 따른다", `${slowOff.toFixed(0)}도`);

  // A 를 누르면 왼쪽으로. 이게 "A 누르며 웹 = 왼쪽 건물"의 근거다.
  const left  = T.intentDir(ctx({ vz: 40, moveX: -1 }));
  const right = T.intentDir(ctx({ vz: 40, moveX:  1 }));
  ok(left.x > 0.1, "A 를 누르면 의도가 왼쪽(+X)으로 기운다", left.x.toFixed(2));
  ok(right.x < -0.1, "D 를 누르면 오른쪽(-X)으로", right.x.toFixed(2));
  ok(Math.abs(left.x + right.x) < 1e-6, "좌우가 대칭이다");

  // 어떤 입력에도 단위벡터여야 한다 (NaN/0 벡터 금지)
  for (const o of [{}, { vz: 100, moveX: 1, moveZ: -1 }, { vx: 50, vz: -50, camYaw: 2.1 }]) {
    const d = T.intentDir(ctx(o));
    ok(Math.abs(Math.hypot(d.x, d.z) - 1) < 1e-6, "항상 단위벡터", JSON.stringify(o));
  }
}

console.log("\n===== 2. 손 편향 (문서 §11) =====");
{
  // 이게 A2 를 시작한 이유다. legacy 는 좌우 점수가 소수점 셋째 자리까지 같았다.
  const c0 = ctx({ vz: 40 });
  const i = T.intentDir(c0);
  const rightCand = { x: -50, y: 130, z: 60 };   // yaw=0 에서 -X 가 오른쪽
  const leftCand  = { x:  50, y: 130, z: 60 };

  const rR = T.scoreAnchorV2(rightCand, ctx({ vz: 40, hand: "R" }), i);
  const rL = T.scoreAnchorV2(rightCand, ctx({ vz: 40, hand: "L" }), i);
  ok(rR.score > rL.score, "오른쪽 앵커는 오른손이 더 높게 친다",
     `R ${rR.score.toFixed(3)} > L ${rL.score.toFixed(3)}`);

  const lR = T.scoreAnchorV2(leftCand, ctx({ vz: 40, hand: "R" }), i);
  const lL = T.scoreAnchorV2(leftCand, ctx({ vz: 40, hand: "L" }), i);
  ok(lL.score > lR.score, "왼쪽 앵커는 왼손이 더 높게 친다",
     `L ${lL.score.toFixed(3)} > R ${lR.score.toFixed(3)}`);

  ok(Math.abs(rR.score - lL.score) < 1e-9, "좌우가 정확히 대칭이다 (한쪽만 유리하면 안 된다)");
  ok(Math.abs(rR.score - rL.score) > 0.1,
     "★ legacy 의 문제였던 '좌우 동점'이 사라졌다", `차이 ${(rR.score - rL.score).toFixed(3)}`);

  // 다만 기계적이면 안 된다 — 정면의 훨씬 좋은 후보를 손 편향이 못 이겨야 한다
  const front = { x: 0, y: 145, z: 92 };
  const fL = T.scoreAnchorV2(front, ctx({ vz: 40, hand: "L" }), i);
  ok(fL.score > lL.score,
     "손 편향이 '더 좋은 정면 후보'를 뒤집지는 못한다 (기계적 교대 방지)",
     `정면 ${fL.score.toFixed(2)} > 왼쪽 ${lL.score.toFixed(2)}`);
}

console.log("\n===== 3. 급선회 벌점 =====");
{
  // 고속에서 뒤쪽으로 꺾이는 앵커를 잡으면 속도가 통째로 날아간다.
  // 등 뒤 후보는 '뒤'로 먼저 기각돼서 벌점을 잴 수 없다 (처음에 그렇게 짰다가 틀렸다).
  // 통과는 하되 크게 꺾어야 하는 옆 후보로 잰다.
  const back = { x: -112, y: 130, z: 26 };
  const slowI = T.intentDir(ctx({ vz: 8 }));
  const fastI = T.intentDir(ctx({ vz: 95 }));
  const s = T.scoreAnchorV2(back, ctx({ vz: 8 }), slowI);
  const f = T.scoreAnchorV2(back, ctx({ vz: 95 }), fastI);
  const sv = s.score > -1 ? s.score : -1, fv = f.score > -1 ? f.score : -1;
  ok(fv < sv, "같은 옆앵커라도 빠를 때 더 깎인다",
     `저속 ${sv.toFixed(2)} -> 고속 ${fv.toFixed(2)}`);
}

console.log("\n===== 4. 기각 사유 =====");
{
  const i = T.intentDir(ctx({ vz: 40 }));
  const c = ctx({ vz: 40 });
  ok(T.scoreAnchorV2({ x: 1, y: 101, z: 1 }, c, i).why === "짧음", "코앞은 짧음");
  ok(T.scoreAnchorV2({ x: 0, y: 100, z: 9999 }, c, i).why === "멂", "멀면 멂");
  ok(T.scoreAnchorV2({ x: 0, y: 40, z: 60 }, c, i).why === "아래", "발밑은 아래");
  ok(T.scoreAnchorV2({ x: 0, y: 112, z: -60 }, c, i).why === "뒤", "등 뒤는 뒤");
  ok(T.scoreAnchorV2({ x: 0, y: 130, z: 70 }, c, i).why === "", "통과는 사유 없음");
}

console.log("\n===== 5. 부채꼴 =====");
{
  const R = T.fanYaw("R"), L = T.fanYaw("L"), C = T.fanYaw(null);
  ok(Math.max(...C.map(Math.abs)) > 90,
     "legacy 의 ±55도보다 훨씬 넓다 (레퍼런스는 옆 건물 벽면에 건다)",
     `±${Math.max(...C.map(Math.abs)).toFixed(0)}도`);
  const avgR = R.reduce((a, b) => a + b, 0) / R.length;
  const avgL = L.reduce((a, b) => a + b, 0) / L.length;
  ok(avgR > avgL, "오른손 부채꼴이 오른쪽으로 치우친다", `${avgR.toFixed(1)} vs ${avgL.toFixed(1)}`);
  ok(Math.abs(avgR + avgL) < 1e-9, "좌우 치우침이 대칭이다");
  ok(T.FAN_PITCH.some(p => p < 10),
     "낮은 각도도 훑는다 — 저고도 골목에서 옆 벽면에 걸어야 한다");
}

console.log("\n===== 5b. 교대 (문서 §18) =====");
{
  // 직진할 때는 좌우 점수가 거의 같아진다. 그러면 어느 손이 잡을지가 다시
  // 우연이 된다 — 레퍼런스에서는 R->L->R 교대가 눈에 띄게 보인다.
  const i = T.intentDir(ctx({ vz: 45 }));
  const straight = { x: 0, y: 138, z: 88 };            // 정면 = 좌우 편향 0
  const noPrev = T.scoreAnchorV2(straight, ctx({ vz: 45, hand: "R" }), i);
  const afterL = T.scoreAnchorV2(straight, ctx({ vz: 45, hand: "R", lastHand: "L" }), i);
  const afterR = T.scoreAnchorV2(straight, ctx({ vz: 45, hand: "R", lastHand: "R" }), i);
  ok(afterL.score > afterR.score, "직전이 왼손이면 오른손이 더 높게 친다",
     afterL.score.toFixed(3) + " > " + afterR.score.toFixed(3));
  ok(Math.abs(afterR.score - noPrev.score) < 1e-9, "같은 손이면 보너스 없음");
  ok(afterL.score - afterR.score < 0.5,
     "보너스가 방향 판단을 뒤집을 만큼 크지는 않다 (기계적 교대 방지)",
     (afterL.score - afterR.score).toFixed(2));

  // 옆으로 확실히 좋은 후보가 있으면 교대 보너스가 그걸 못 이긴다
  const farLeft = { x: 95, y: 138, z: 55 };
  const lAfterL = T.scoreAnchorV2(farLeft, ctx({ vz: 45, hand: "L", lastHand: "L" }), i);
  const rAfterL = T.scoreAnchorV2(farLeft, ctx({ vz: 45, hand: "R", lastHand: "L" }), i);
  ok(lAfterL.score > rAfterL.score,
     "왼쪽 앵커는 직전이 왼손이어도 여전히 왼손이 잡는다",
     lAfterL.score.toFixed(2) + " > " + rAfterL.score.toFixed(2));
}

console.log("\n===== 6. 실제 월드에서 =====");
{
  // 도시 한복판 공중. 조준 없이 A/D 만으로 좌우가 갈리는가.
  function tryDir(moveX) {
    P.pos.set(0, T.groundHeightAt(0, 0) + 70, 0);
    P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
    P.vel.set(0, -3, 45); P.grounded = false;
    T.setClinging(null); T.setView(0, 0);
    T.setKey("KeyA", moveX < 0); T.setKey("KeyD", moveX > 0);
    T.syncWorld();
    const p = T.findSwingAnchorV2();
    T.setKey("KeyA", false); T.setKey("KeyD", false);
    return p ? { x: p.x, z: p.z, hand: T.autoHand } : null;
  }
  // 한 지점만 보면 안 된다 — 거기 왼쪽에 건물이 없을 수도 있다.
  // 실제로 처음에 그래서 틀린 실패를 봤다. 여러 지점에서 경향을 본다.
  const spots = [[0, 0], [180, 60], [-140, 220], [90, -190], [-260, -80]];
  let win = 0, tried = 0, handOk = 0, skipped = 0;
  T.setDbg(true);   // 후보 목록을 읽어야 "양쪽에 있었는지"를 판단할 수 있다
  let sample = "";
  for (const [sx, sz] of spots) {
    const go = m => {
      P.pos.set(sx, T.groundHeightAt(sx, sz) + 70, sz);
      P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
      P.vel.set(0, -3, 45); P.grounded = false;
      T.setClinging(null); T.setView(0, 0);
      T.setKey("KeyA", m < 0); T.setKey("KeyD", m > 0);
      T.syncWorld();
      const p = T.findSwingAnchorV2();
      T.setKey("KeyA", false); T.setKey("KeyD", false);
      const cs = T.dbgCands().filter(c => c.ok);
      const nL = cs.filter(c => c.x - sx > 8).length;   // yaw=0 에서 왼쪽은 +X
      const nR = cs.filter(c => c.x - sx < -8).length;
      return p ? { x: p.x, hand: T.autoHand, bothSides: nL > 0 && nR > 0 } : null;
    };
    const l = go(-1), r = go(1);
    if (!l || !r) continue;
    // 한쪽에 건물이 아예 없는 지점이 있다. 진단해 보니 [180,60] 은 통과 후보가
    // 2개뿐이고 둘 다 왼쪽, [-260,-80] 은 오른쪽 후보가 0개였다. 거기서 없는 쪽을
    // 억지로 고르는 것보다 실제 앵커를 고르는 게 맞다 (문서 §11 "기계적으로 만들지
    // 않는다"). 그래서 양쪽에 후보가 있는 지점에서만 좌우를 따진다.
    if (!(l.bothSides && r.bothSides)) { skipped++; continue; }
    tried++;
    if (l.x > r.x) win++;                       // yaw=0 에서 왼쪽은 +X
    if (l.hand === "L" && r.hand === "R") handOk++;
    if (!sample) sample = `A x=${l.x.toFixed(0)}(${l.hand}) / D x=${r.x.toFixed(0)}(${r.hand})`;
  }
  ok(tried >= 3, "양쪽에 걸 곳이 있는 지점이 충분하다", `${tried}개 (한쪽만 있는 지점 ${skipped}개 제외)`);
  ok(win === tried, "양쪽에 후보가 있으면 A 는 항상 왼쪽에 건다", `${win}/${tried} · ${sample}`);
  ok(handOk === tried, "그때 손도 A->왼손 D->오른손", `${handOk}/${tried}`);

  // legacy 와 달라야 의미가 있다
  P.pos.set(0, T.groundHeightAt(0, 0) + 70, 0);
  P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.vel.set(38, -3, 30); P.grounded = false; T.setView(0, 0); T.syncWorld();
  const v2 = T.findSwingAnchorV2(), lg = T.findSwingAnchorLegacy();
  ok(v2 && lg, "둘 다 후보를 찾는다");
  if (v2 && lg) {
    const d = Math.hypot(v2.x - lg.x, v2.z - lg.z);
    ok(d > 1, "시선과 진행 방향이 다를 때 V2 는 legacy 와 다른 곳을 고른다",
       `거리 ${d.toFixed(1)}m`);
  }

  // 안전: 어떤 상황에서도 NaN 을 돌려주면 안 된다
  let bad = 0;
  for (let i = 0; i < 40; i++) {
    P.pos.set((i % 7) * 90 - 270, T.groundHeightAt(0, 0) + 20 + i * 6, (i % 5) * 110 - 220);
    P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
    P.vel.set(Math.sin(i) * 60, -4, Math.cos(i) * 60);
    T.setView(i * 0.3, 0); T.syncWorld();
    const p = T.findSwingAnchorV2();
    if (p && (p.x !== p.x || p.y !== p.y || p.z !== p.z)) bad++;
  }
  ok(bad === 0, "40개 지점에서 NaN 없음");
}

console.log("\n===== 7. legacy 는 살아 있다 =====");
{
  T.setAutoV2(false);
  ok(T.autoV2 === false, "F4 로 끌 수 있다");
  P.pos.set(0, T.groundHeightAt(0, 0) + 70, 0);
  P.prevPos.copy(P.pos); P.renderPos.copy(P.pos);
  P.vel.set(0, -3, 45); T.setView(0, 0); T.syncWorld();
  ok(T.findSwingAnchor() !== null, "꺼도 legacy 로 정상 동작한다");
  T.setAutoV2(true);
  ok(T.autoV2 === true, "다시 켤 수 있다");
}

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
process.exit(fail ? 1 : 0);
