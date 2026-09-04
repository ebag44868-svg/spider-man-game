// 사운드. 전부 Web Audio API로 즉석 합성한다 — 오디오 파일이 하나도 없다.
//
// 이 모듈은 게임 상태를 일절 모른다. scene / camera / player / enemies 어느 것도
// 참조하지 않고, 오직 AudioContext와 그 위의 노드만 만진다. 그래서 가장 먼저
// 떼어냈다. (game3d.js에서 옮겨온 코드이며 내용은 한 줄도 바꾸지 않았다)
//
// 바람 소리만 예외로 게임 쪽 값을 받는다. 속도와 급강하 정도를 계산하는 건
// game3d.js가 하고, 여기서는 받은 숫자를 노드에 꽂기만 한다.

let actx = null;
let windGain = null;
let windFilter = null;

// 정화 완료음 — 상승하는 3음
function sfxZoneClear() {
  if (!actx) return;
  const t = actx.currentTime;
  [523, 659, 880].forEach((f, i) => {
    const o = actx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(f, t + i * 0.09);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t + i * 0.09);
    g.gain.exponentialRampToValueAtTime(0.08, t + i * 0.09 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.3);
    o.connect(g); g.connect(actx.destination);
    o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.32);
  });
}

// 적의 사격 — 플레이어 총성보다 낮고 둔탁하게 깔아 서로 구분되게 한다
// 입력은 받았지만 대상이 없을 때. 짧고 낮게 "틱" — 성공음과 확실히 구분되게.
function sfxMiss() {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  o.type = "square";
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(90, t + 0.05);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.05, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + 0.08);
}

function sfxEnemyShot() {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  o.type = "square";
  o.frequency.setValueAtTime(260, t);
  o.frequency.exponentialRampToValueAtTime(70, t + 0.11);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.07, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + 0.15);
}

// 피격 — 낮게 웅 하고 울려 "내가 맞았다"를 즉시 알린다
// 한 칸 회복. 피격음과 반대로 올라가서 좋은 일임이 바로 읽힌다.
function sfxRegen() {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(520, t);
  o.frequency.exponentialRampToValueAtTime(880, t + 0.12);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.05, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + 0.17);
}

// 회피 — 짧게 스치는 바람소리
function sfxDodge() {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(900, t);
  o.frequency.exponentialRampToValueAtTime(1600, t + 0.09);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.06, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + 0.13);
}

// 완벽 회피 — 맑게 울리는 두 음. 잘했다는 신호는 확실해야 한다.
function sfxPerfect() {
  if (!actx) return;
  const t = actx.currentTime;
  [1320, 1760].forEach((f, i) => {
    const o = actx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f, t + i * 0.07);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t + i * 0.07);
    g.gain.exponentialRampToValueAtTime(0.09, t + i * 0.07 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.3);
    o.connect(g); g.connect(actx.destination);
    o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.32);
  });
}

function sfxHurt() {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(180, t);
  o.frequency.exponentialRampToValueAtTime(48, t + 0.26);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.2, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + 0.32);
}

function sfxShot() {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(880, t);
  o.frequency.exponentialRampToValueAtTime(180, t + 0.07);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.16, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + 0.1);
}

// 오버워치식 피격 "핑". 처치는 한 옥타브 낮게 두 번 울린다.
function sfxHit(killed) {
  if (!actx) return;
  const t = actx.currentTime;
  const ping = (freq, at, vol) => {
    const o = actx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, t + at);
    const g = actx.createGain();
    g.gain.setValueAtTime(0, t + at);
    g.gain.linearRampToValueAtTime(vol, t + at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + at + 0.11);
    o.connect(g); g.connect(actx.destination);
    o.start(t + at); o.stop(t + at + 0.13);
  };
  if (killed) { ping(1050, 0, 0.22); ping(700, 0.06, 0.2); }
  else ping(1500, 0, 0.17);
}

function sfxReload() {
  if (!actx) return;
  const t = actx.currentTime;
  // 딸깍(빼기) — 철컥(끼우기) 두 번
  [[0, 300], [0.55, 220]].forEach(([at, f]) => {
    const o = actx.createOscillator();
    o.type = "square";
    o.frequency.setValueAtTime(f, t + at);
    o.frequency.exponentialRampToValueAtTime(f * 0.45, t + at + 0.06);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.11, t + at);
    g.gain.exponentialRampToValueAtTime(0.001, t + at + 0.09);
    o.connect(g); g.connect(actx.destination);
    o.start(t + at); o.stop(t + at + 0.1);
  });
}

function sfxBind() {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(320, t);
  o.frequency.exponentialRampToValueAtTime(1400, t + 0.16);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.15, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + 0.22);
}

// 낮게 깔리는 굉음 + 상승음
function sfxUlt() {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(70, t);
  o.frequency.exponentialRampToValueAtTime(320, t + 0.5);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.22, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + 0.62);
}

// 헛치는 소리 — 맞았을 때와 구분되게 바람 소리만
function sfxWhoosh() {
  if (!actx) return;
  const t = actx.currentTime;
  const src = actx.createBufferSource();
  const len = Math.floor(actx.sampleRate * 0.14);
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / len);
  src.buffer = buf;
  const f = actx.createBiquadFilter();
  f.type = "bandpass"; f.frequency.setValueAtTime(700, t);
  f.frequency.exponentialRampToValueAtTime(1800, t + 0.12);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.09, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  src.connect(f); f.connect(g); g.connect(actx.destination);
  src.start(t);
}

function initAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const len = actx.sampleRate * 2;
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = actx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    windFilter = actx.createBiquadFilter();
    windFilter.type = "bandpass";
    windFilter.frequency.value = 400;
    windFilter.Q.value = 0.6;
    windGain = actx.createGain();
    windGain.gain.value = 0;
    src.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(actx.destination);
    src.start();
  } catch (e) { actx = null; }
}

function sfxThwip() {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(1200, t);
  o.frequency.exponentialRampToValueAtTime(220, t + 0.14);
  const g = actx.createGain();
  g.gain.setValueAtTime(0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  o.connect(g);
  g.connect(actx.destination);
  o.start(t);
  o.stop(t + 0.2);
}

function sfxThud(intensity) {
  if (!actx) return;
  const t = actx.currentTime;
  const o = actx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(110, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.18);
  const g = actx.createGain();
  g.gain.setValueAtTime(Math.min(0.35, 0.08 + intensity * 0.004), t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  o.connect(g);
  g.connect(actx.destination);
  o.start(t);
  o.stop(t + 0.25);
}

function sfxDash() {
  if (!actx) return;
  const t = actx.currentTime;
  const dur = 0.3;
  const buf = actx.createBuffer(1, actx.sampleRate * dur, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = actx.createBufferSource();
  src.buffer = buf;
  const f = actx.createBiquadFilter();
  f.type = "bandpass";
  f.frequency.setValueAtTime(300, t);
  f.frequency.exponentialRampToValueAtTime(1800, t + dur);
  f.Q.value = 1.2;
  const g = actx.createGain();
  g.gain.setValueAtTime(0.28, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(actx.destination);
  src.start(t);
}

// 바람 소리 노드가 살아 있는가. game3d.js가 계산을 시작하기 전에 물어본다.
function windActive() { return !!windGain; }

// 바람 소리 세기와 음색. 값 계산은 부르는 쪽 몫이다.
function setWind(gain, freq) {
  if (!windGain) return;
  windGain.gain.value = gain;
  windFilter.frequency.value = freq;
}

export {
  initAudio,
  windActive, setWind,
  sfxZoneClear, sfxMiss, sfxEnemyShot, sfxRegen, sfxDodge, sfxPerfect, sfxHurt, sfxShot, sfxHit, sfxReload, sfxBind, sfxUlt, sfxWhoosh, sfxThwip, sfxThud, sfxDash,
};
