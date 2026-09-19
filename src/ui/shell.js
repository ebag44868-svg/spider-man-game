// 게임 밖 화면 — 타이틀 메뉴 · 모드 선택 · 기록 · 업적 · 슈트 · 설정 · 소식 · 크레딧 · 일시정지 · 결과
//
// 문서 02: UI 는 DOM/CSS, 게임은 Three.js. game3d.js 에 화면 코드를 쌓지 않는다.
// 게임과는 initShell(bridge) 로 받은 창구로만 이야기한다 (bridge 가 뭘 주는지는 game3d.js 의
// '게임 밖 화면' 절에 한 군데 모여 있다). 목록은 src/service/catalog.js 데이터를 그리기만 한다.
//
// 화면은 스택이다. ESC 는 맨 위 한 장을 닫는다. 게임 중 스택이 비어 있으면 ESC = 일시정지.
// 이 모듈은 최상위에서 DOM 을 건드리지 않는다 — 테스트 하네스(DOM 없음)가 import 만 해도 안전하다.

import { MODES, SUITS, NEWS, CREDITS, SETTINGS_TABS, GAME_VERSION } from "../service/catalog.js";
import { STAT_INFO, fmtStat } from "../service/stats.js";
import { ACHIEVEMENTS, progressOf, achById } from "../service/achievements.js";

let B = null;                 // bridge
let root = null, toastBox = null, savedTag = null;
const stack = [];             // [{ id, el, opts }]
let pauseAt = 0;

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
const $ = (sel, from) => (from || document).querySelector(sel);

// ---------------------------------------------------------------- 알림
function toast(head, msg, sec) {
  if (!toastBox) return;
  const t = el(`<div class="toast"><b>${esc(head)}</b>${esc(msg || "")}</div>`);
  toastBox.appendChild(t);
  setTimeout(() => t.classList.add("out"), (sec || 3.2) * 1000);
  setTimeout(() => t.remove(), (sec || 3.2) * 1000 + 350);
}
let savedTimer = 0;
function flashSaved() {
  if (!savedTag || !B.inGame()) return;
  savedTag.classList.add("on");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => savedTag.classList.remove("on"), 1400);
}

// ---------------------------------------------------------------- 시트 스택
function sheet(title, sub, cls) {
  return el(`<div class="sheet ${cls || ""}"><div class="scard">
    <header><h2>${esc(title)}</h2><span class="ssub">${esc(sub || "")}</span>
      <button class="sbtn sx" data-act="close">닫기 <kbd class="shk">ESC</kbd></button></header>
    <div class="sbody"></div></div></div>`);
}
function open(id, opts) {
  const make = SCREENS[id];
  if (!make) return;
  const node = make(opts || {});
  node.dataset.id = id;
  node.addEventListener("click", e => { if (e.target.closest('[data-act="close"]')) close(); });
  root.appendChild(node);
  stack.push({ id, el: node, opts });
  // 밑에 깔린 시트는 숨긴다. 반투명이 겹치면 글자가 겹쳐 읽힌다.
  stack.forEach((s, i) => { s.el.style.visibility = i === stack.length - 1 ? "" : "hidden"; });
}
function close() {
  const top = stack.pop();
  if (!top) return;
  top.el.remove();
  if (stack.length) stack[stack.length - 1].el.style.visibility = "";
  if (top.id === "pause") B.pause(false);
  if (top.id === "result") refreshTitle();
  if (!stack.length && !B.inGame()) refreshTitle();
}
function closeAll() { while (stack.length) stack.pop().el.remove(); }
// 같은 시트를 다시 그린다 (값이 바뀌었을 때)
function redraw() {
  const top = stack[stack.length - 1];
  if (!top) return;
  const node = SCREENS[top.id](top.opts || {});
  node.dataset.id = top.id;
  node.addEventListener("click", e => { if (e.target.closest('[data-act="close"]')) close(); });
  top.el.replaceWith(node);
  top.el = node;
}

// ---------------------------------------------------------------- 화면들
const SCREENS = {
  modes() {
    const s = sheet("모드 선택", "지금은 자유 탐험만 열려 있다");
    const g = el(`<div class="sgrid"></div>`);
    for (const m of MODES) {
      const openM = m.status === "open";
      const c = el(`<button class="scell ${openM ? "" : "locked"}" ${openM ? "" : "disabled"}>
        <b>${esc(m.name)}</b><span class="d">${esc(m.desc)}</span>
        ${openM ? `<span class="m">클릭하면 시작 지점에서 시작</span>` : `<span class="soon">준비 중</span>`}</button>`);
      if (openM) c.onclick = () => { closeAll(); B.start(m.id, null); };
      g.appendChild(c);
    }
    $(".sbody", s).appendChild(g);
    return s;
  },

  records() {
    const t = B.svc.liveStats();
    const s = sheet("기록", B.svc.data.createdAt ? `첫 플레이 ${new Date(B.svc.data.createdAt).toLocaleDateString("ko-KR")}` : "아직 기록이 없다");
    const box = el(`<div class="stable"></div>`);
    for (const { key, label } of STAT_INFO) box.appendChild(el(`<div class="stat"><div class="k">${esc(label)}</div><div class="v">${esc(fmtStat(key, t[key]))}</div></div>`));
    const b = $(".sbody", s);
    b.appendChild(box);
    b.appendChild(el(`<div class="sblock"><span class="soon">준비 중</span><div><b>온라인 순위</b><div class="d">최고 속도 · 최장 체공 · 레이스 기록을 다른 플레이어와 겨룬다</div></div></div>`));
    return s;
  },

  achievements() {
    const t = B.svc.liveStats(), got = B.svc.data.achievements;
    const n = ACHIEVEMENTS.filter(a => got[a.id]).length;
    const s = sheet("업적", `${n} / ${ACHIEVEMENTS.length} 달성`);
    const g = el(`<div class="sgrid"></div>`);
    for (const a of ACHIEVEMENTS) {
      const done = !!got[a.id], p = progressOf(a, t), veil = a.hidden && !done;
      g.appendChild(el(`<div class="scell ${done ? "got" : ""}">
        <b>${veil ? "???" : esc(a.name)}</b><span class="d">${veil ? "숨겨진 업적" : esc(a.desc)}</span>
        <div class="bar"><i style="width:${(p * 100).toFixed(1)}%"></i></div>
        <span class="m">${done ? new Date(got[a.id]).toLocaleDateString("ko-KR") + " 달성" : Math.floor(p * 100) + "%"}</span></div>`));
    }
    $(".sbody", s).appendChild(g);
    return s;
  },

  suits() {
    const s = sheet("슈트", "업적을 달성하면 새 슈트가 열린다");
    const g = el(`<div class="sgrid"></div>`);
    for (const u of SUITS) {
      const a = u.unlock ? achById(u.unlock) : null;
      const on = u.id === "classic";
      g.appendChild(el(`<div class="scell ${on ? "on" : "locked"}"><b>${esc(u.name)}</b><span class="d">${esc(u.desc)}</span>
        ${on ? `<span class="m">착용 중</span>` : `<span class="m">해금: 업적 '${esc(a ? a.name : "?")}'</span><span class="soon">준비 중</span>`}</div>`));
    }
    $(".sbody", s).appendChild(g);
    return s;
  },

  settings(o) {
    const tabs = [...SETTINGS_TABS, { id: "data", name: "프로필 · 데이터" }];
    const cur = o.tab || "play";
    const s = sheet("설정", "바꾸면 바로 적용되고 저장된다");
    const b = $(".sbody", s);
    const bar = el(`<div class="stabs"></div>`);
    for (const t of tabs) {
      const x = el(`<button class="sbtn ${t.id === cur ? "on" : ""}">${esc(t.name)}</button>`);
      x.onclick = () => { stack[stack.length - 1].opts = { tab: t.id }; redraw(); };
      bar.appendChild(x);
    }
    b.appendChild(bar);
    if (cur === "data") { b.appendChild(dataTab()); return s; }
    const tab = tabs.find(t => t.id === cur);
    const S = B.settings;
    for (const r of tab.rows) {
      if (!r.key || !S[r.key]) {
        b.appendChild(el(`<div class="srow"><span class="k">${esc(r.label)}</span><span class="soon">준비 중</span>${r.soon ? `<span class="d">${esc(r.soon)}</span>` : ""}</div>`));
        continue;
      }
      b.appendChild(el(`<div class="srow"><span class="k">${esc(r.label)}</span><span class="chips" data-set="${r.key}"></span><span class="d" data-desc="${r.key}"></span></div>`));
    }
    // 칩은 game3d.js 의 drawSettings 가 칠한다 (F1 카드와 같은 경로 — 두 군데서 상태를 만지면 어긋난다)
    const fillDesc = () => {
      for (const d of s.querySelectorAll("[data-desc]")) {
        const X = S[d.dataset.desc], v = X.get();
        d.textContent = (X.opts.find(q => q.v === v) || X.opts[0]).desc;
      }
    };
    queueMicrotask(() => { B.drawSettings(); fillDesc(); });   // 시트가 문서에 붙은 직후 (open 이 붙인다)
    b.addEventListener("click", () => setTimeout(fillDesc, 0));
    return s;
  },

  news() {
    const s = sheet("소식", `버전 ${GAME_VERSION}`);
    const b = $(".sbody", s);
    for (const n of NEWS) b.appendChild(el(`<div class="news"><b>${esc(n.title)}</b><span class="t">${esc(n.id)}</span><p>${esc(n.body)}</p></div>`));
    if (NEWS[0] && B.svc.data.seenNews !== NEWS[0].id) B.svc.markNews(NEWS[0].id);
    return s;
  },

  credits() {
    const s = sheet("크레딧", `SPIDER MAN · New York  ${GAME_VERSION}`);
    const b = $(".sbody", s);
    for (const c of CREDITS) b.appendChild(el(`<div class="srow"><span class="k">${esc(c.role)}</span><span>${esc(c.who)}</span></div>`));
    b.appendChild(el(`<p class="snote">팬 제작 비상업 프로젝트. 스파이더맨 관련 권리는 각 권리자에게 있다.</p>`));
    return s;
  },

  pause() {
    const st = B.svc.session ? B.svc.session.stats : null;
    const s = el(`<div class="sheet pause"><div class="pmenu">
      <h2>일시정지</h2>
      <p class="pnow">${st ? `이번 판 ${esc(fmtStat("playtime", st.playtime))} · ${esc(fmtStat("distance", st.distance))} · 최고 ${esc(fmtStat("topSpeed", st.topSpeed))}` : ""}</p>
      <button class="sbtn primary" data-p="resume">계속하기 <kbd class="shk">ESC</kbd></button>
      <button class="sbtn" data-p="settings">설정</button>
      <button class="sbtn" data-p="help">조작법 <kbd class="shk">F1</kbd></button>
      <button class="sbtn" data-p="records">기록</button>
      <button class="sbtn" data-p="achievements">업적</button>
      <button class="sbtn" data-p="quit">타이틀로 (저장하고 나가기)</button>
    </div></div>`);
    s.addEventListener("click", e => {
      const k = e.target.closest("[data-p]");
      if (!k) return;
      const p = k.dataset.p;
      if (p === "resume") close();
      else if (p === "help") { stack.pop(); s.remove(); B.help(); }
      else if (p === "quit") quit();
      else open(p);
    });
    return s;
  },

  result(sum) {
    const st = sum.stats || {};
    const s = sheet("플레이 결과", MODES.find(m => m.id === sum.mode)?.name || "");
    const b = $(".sbody", s);
    const box = el(`<div class="stable"></div>`);
    for (const key of ["playtime", "distance", "topSpeed", "maxAlt", "longestAir", "webs", "slings", "grazes"]) {
      const info = STAT_INFO.find(i => i.key === key);
      box.appendChild(el(`<div class="stat"><div class="k">${esc(info.label)}</div><div class="v">${esc(fmtStat(key, st[key]))}</div></div>`));
    }
    b.appendChild(box);
    if (sum.newAch && sum.newAch.length) {
      b.appendChild(el(`<h3 style="margin:18px 0 8px;font-size:15px">새 업적</h3>`));
      const g = el(`<div class="sgrid"></div>`);
      for (const id of sum.newAch) { const a = achById(id); if (a) g.appendChild(el(`<div class="scell got"><b>${esc(a.name)}</b><span class="d">${esc(a.desc)}</span></div>`)); }
      b.appendChild(g);
    }
    b.appendChild(el(`<p class="snote">기록은 저장됐다. 타이틀의 '이어하기' 로 마지막으로 서 있던 곳에서 다시 시작한다.</p>`));
    const x = $(".sx", s); x.innerHTML = `확인 <kbd class="shk">ESC</kbd>`; x.classList.add("primary");
    return s;
  },
};

// 프로필 · 저장 데이터 탭
function dataTab() {
  const svc = B.svc;
  const w = el(`<div>
    <div class="srow"><span class="k">닉네임</span><input type="text" maxlength="16" placeholder="플레이어"><button class="sbtn" data-d="name">저장</button></div>
    <div class="srow"><span class="k">계정</span><span class="soon">준비 중</span><span class="d">로그인하면 다른 기기와 기록을 맞춘다. 지금은 이 브라우저에만 저장된다.</span></div>
    <div class="srow"><span class="k">저장 위치</span><span>${svc.hasStorage ? "이 브라우저 (자동 저장)" : "저장 불가 — 시크릿 창이거나 저장소가 막혀 있다"}</span></div>
    <div class="srow"><span class="k">저장 데이터</span>
      <button class="sbtn" data-d="export">내보내기</button>
      <button class="sbtn" data-d="import">가져오기</button>
      <button class="sbtn danger" data-d="reset">기록 초기화</button>
      <input type="file" accept=".json,application/json" hidden>
      <span class="d">초기화는 기록 · 업적 · 이어하기 자리를 지운다. 설정은 남는다.</span></div>
  </div>`);
  const name = $("input[type=text]", w), file = $("input[type=file]", w);
  name.value = svc.data.profile.name || "";
  let armed = 0;
  w.addEventListener("click", e => {
    const k = e.target.closest("[data-d]");
    if (!k) return;
    const d = k.dataset.d;
    if (d === "name") { svc.setName(name.value); toast("저장", "닉네임을 바꿨다"); refreshTitle(); }
    if (d === "export") {
      const blob = new Blob([svc.exportText()], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `spiderman-save-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
    if (d === "import") file.click();
    if (d === "reset") {
      if (Date.now() - armed > 3000) { armed = Date.now(); k.textContent = "한 번 더 누르면 지운다"; setTimeout(() => { k.textContent = "기록 초기화"; }, 3000); return; }
      svc.reset(); toast("초기화", "기록과 업적을 지웠다"); refreshTitle(); redraw();
    }
  });
  file.onchange = async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    const ok = svc.importText(await f.text());
    if (ok) { B.applySettings(); refreshTitle(); redraw(); }
    toast(ok ? "가져오기" : "가져오기 실패", ok ? "저장 데이터를 불러왔다" : "이 게임의 저장 파일이 아니다");
    file.value = "";
  };
  return w;
}

// ---------------------------------------------------------------- 흐름
// fromLock = 포인터 락이 풀려서 열었다 (브라우저가 ESC 를 먹은 경우)
function openPause(fromLock) {
  if (!B.inGame() || stack.some(s => s.id === "pause")) return;
  B.pause(true);
  pauseAt = fromLock ? performance.now() : 0;
  open("pause");
}
function quit() {
  closeAll();
  const sum = B.quit();
  if (sum) open("result", sum);
  refreshTitle();
}
// ESC 를 여기서 먼저 받는다. 처리했으면 true.
function onEscape() {
  if (!stack.length) {
    if (B.inGame()) { openPause(); return true; }
    return false;
  }
  // 포인터 락이 풀리며 일시정지가 열린 바로 그 ESC 가 keydown 으로 한 번 더 들어오는 브라우저가 있다.
  // 그걸 '닫기'로 받으면 열리자마자 닫힌다. 락 해제로 연 직후 한 번만 흘려보낸다.
  if (stack[stack.length - 1].id === "pause" && pauseAt && performance.now() - pauseAt < 300) { pauseAt = 0; return true; }
  close();
  return true;
}

function refreshTitle() {
  const svc = B.svc;
  const cont = $("#btnContinue");
  if (cont) cont.hidden = !svc.hasContinue();
  const start = $("#btnStart");
  if (start) start.classList.toggle("primary", !svc.hasContinue());
  const nm = $("#tProfName");
  if (nm) nm.textContent = svc.data.profile.name || "플레이어";
  const ach = $("#tAchN");
  if (ach) ach.textContent = `${ACHIEVEMENTS.filter(a => svc.data.achievements[a.id]).length}/${ACHIEVEMENTS.length}`;
  const nb = $('#title [data-open="news"]');
  if (nb) nb.classList.toggle("new", !!NEWS[0] && svc.data.seenNews !== NEWS[0].id);
  const sv = $("#tSave");
  if (sv) { sv.textContent = svc.hasStorage ? (svc.broken ? "저장 데이터 복구됨" : "자동 저장") : "저장 안 됨"; sv.classList.toggle("warn", !svc.hasStorage || svc.broken); }
}

function initShell(bridge) {
  B = bridge;
  root = el(`<div id="shell"></div>`);
  toastBox = el(`<div id="toasts"></div>`);
  savedTag = el(`<div id="savedTag2">저장됨</div>`);
  document.body.append(root, toastBox, savedTag);

  const cont = $("#btnContinue"), start = $("#btnStart");
  if (cont) cont.onclick = () => B.start("free", B.svc.data.lastSpot);
  if (start) start.onclick = () => open("modes");
  document.querySelectorAll("#title [data-open]").forEach(b => { b.onclick = () => open(b.dataset.open); });
  const prof = $("#tProf");
  if (prof) prof.onclick = () => open("settings", { tab: "data" });
  const login = $("#btnLogin");
  if (login) login.onclick = () => toast("준비 중", "계정 기능은 아직 없다 — 기록은 이 브라우저에 저장된다");
  const ver = $("#tVer");
  if (ver) ver.textContent = "v" + GAME_VERSION;

  B.svc.on("unlock", id => { const a = achById(id); if (a) toast("업적 달성", a.name, 4); });
  B.svc.on("saved", flashSaved);
  if (B.svc.broken) toast("저장 데이터", "읽지 못해서 기본값으로 시작한다", 5);
  refreshTitle();
  return { onEscape, openPause, toast, refreshTitle, get depth() { return stack.length; }, get top() { return stack.length ? stack[stack.length - 1].id : null; }, open, close };
}

export { initShell };
