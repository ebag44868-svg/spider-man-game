import { T } from "./_harness.mjs";
const DT = 1/120;
T.syncWorld();
const W = globalThis.__win, C = globalThis.__cv;
const key = c => (W.keydown||[]).forEach(f => f({ code: c, repeat: false, preventDefault(){} }));
const md  = b => (C.mousedown||[]).forEach(f => f({ button: b, preventDefault(){} }));
const mu  = b => (W.mouseup||[]).forEach(f => f({ button: b, preventDefault(){} }));
for (let i=0;i<4 && !T.meleeMode; i++) key("Tab");

function stageBrawler(dist) {
  const live = T.enemies.filter(x => !x.dead);
  const e = live.find(x => x.ty.brawler) || T.enemies.find(x => x.ty.brawler);
  if (!e) return null;
  e.dead = false; e.deadT = 0;      // 죽은 격투병을 되살려 표본이 줄지 않게 한다
  for (const o of live) if (o !== e) o.g.position.set(9000, -800, 9000);
  const y = T.groundHeightAt(0, 0);
  e.hp = e.ty.hp; e.bound = 0; e.grip = 0; e.post = 0; e.stag = 0; e.postHold = 0;
  e.knock.set(0,0,0); e.swing = null; e.fireCd = 0; e.lastBrawl = -1;
  e.g.position.set(0, y, dist);
  T.player.pos.set(0, y, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0,0,0); T.setClinging(null); T.releaseWeb();
  T.aimYaw(0); T.setPitch(0);
  T.setLock(e); T.setStam(100); T.clearMelee();
  T.syncWorld();
  return e;
}

// skill: 반응 오차(초). 0이면 완벽, 크면 서툴다.
function duel(skill, maxSec = 60) {
  const e = stageBrawler(30);
  if (!e) return null;
  const hp0 = T.hp;
  let t = 0, parried = 0, rolled = 0, executed = 0, heavies = 0, lights = 0, dashes = 0;
  let react = 0, plan = null, handled = null;   // handled: 이미 대응한 공격 (한 번만 반응한다)
  for (let i = 0; i < 120 * maxSec; i++) {
    t += DT;
    const dist = T.player.pos.distanceTo(e.g.position);

    // --- 적이 휘두르면 대응한다. 사람처럼 반응이 조금 늦는다. ---
    if (e.swing && !e.swing.done && !plan && e.swing !== handled) {
      handled = e.swing;
      const spec = T.BRAWL[e.swing.kind];
      plan = spec.parry ? 'parry' : 'roll';
      // 판정 시각에 맞춰 행동할 시점 (창의 절반쯤 앞에서)
      const lead = plan === 'parry' ? T.PARRY_WIN * 0.5 : T.ROLL_IFR * 0.55;
      react = spec.hitAt - e.swing.t - lead + (Math.random() * 2 - 1) * skill;
    }
    if (plan) {
      react -= DT;
      if (react <= 0) {
        if (plan === 'parry') { key("KeyE"); parried++; }
        else { T.keys["KeyS"] = true; key("ShiftLeft"); T.keys["KeyS"] = false; rolled++; }
        plan = null;
      }
    } else if (!e.swing) {
      // --- 반격 ---
      // 처형은 실제로 시작됐을 때만 센다. 눌렀다고 다 나가는 게 아니다.
      if (e.stag > 0 && dist < 9) { const w = T.execT; md(2); mu(2); if (T.execT > w) executed++; }
      else if (dist > 12) { key("KeyF"); dashes++; }
      else if (dist < 8) {
        // 회수가 긴 강공격은 적이 안 움직일 때만. 평소엔 약공격으로 안전하게.
        if (Math.random() < 0.55) { md(2); mu(2); heavies++; }
        else { md(0); mu(0); lights++; }
      }
    }

    T.update(DT); T.updateCamera(DT);
    if (e.dead) return { win: true, t, hpLost: hp0 - T.hp, parried, rolled, executed, heavies, lights, dashes };
    if (T.deadT > 0) return { win: false, t, hpLost: hp0 - T.hp, parried, rolled, executed, heavies, lights, dashes };
  }
  return { win: false, t, timeout: true, hpLost: hp0 - T.hp, parried, rolled, executed, heavies, lights, dashes };
}

// 패링 연타 봇: 예고를 안 보고 E만 계속 친다. 이게 통하면 패링 설계가 망가진 것이다.
function spamDuel(maxSec = 60) {
  const e = stageBrawler(30);
  if (!e) return null;
  const hp0 = T.hp;
  let t = 0, parried = 0;
  for (let i = 0; i < 120 * maxSec; i++) {
    t += DT;
    const dist = T.player.pos.distanceTo(e.g.position);
    if (i % 30 === 0) { key("KeyE"); parried++; }          // 0.25초마다 무조건 E
    else if (i % 30 === 15) {
      if (dist > 12) key("KeyF");
      else if (dist < 8) { md(2); mu(2); }
    }
    T.update(DT); T.updateCamera(DT);
    if (e.dead) return { win: true, t, hpLost: hp0 - T.hp, parried };
    if (T.deadT > 0) return { win: false, t, hpLost: hp0 - T.hp, parried };
  }
  return { win: false, t, timeout: true, hpLost: hp0 - T.hp, parried };
}

for (const [name, skill] of [["숙련 (반응오차 ±0.03s)", 0.03], ["보통 (±0.09s)", 0.09], ["서툼 (±0.18s)", 0.18], ["패링 연타 (예고를 안 봄)", null]]) {
  let wins = 0, times = [], hpl = [], ex = 0, pr = 0;
  const N = 12;
  for (let n = 0; n < N; n++) {
    const r = skill === null ? spamDuel() : duel(skill);
    if (!r) { console.log("격투병 없음"); break; }
    if (r.win) { wins++; times.push(r.t); }
    hpl.push(r.hpLost); ex += (r.executed || 0); pr += r.parried;
    T.setStam(100);
    if (T.deadT > 0) for (let i=0;i<120*3;i++) T.update(DT);   // 리스폰 대기
  }
  const avgT = times.length ? (times.reduce((a,b)=>a+b,0)/times.length).toFixed(1) : "-";
  const avgH = (hpl.reduce((a,b)=>a+b,0)/hpl.length).toFixed(1);
  console.log(`${name}: 승 ${wins}/${N}  평균 ${avgT}초  평균 잃은 체력 ${avgH}  처형 ${ex}회  쳐내기 시도 ${pr}회`);
}
