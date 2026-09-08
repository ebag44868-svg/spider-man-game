// 미션 정의 — 데이터만 있는 파일
//
// 문서 02 §19 의 MVP 규모를 그대로 따랐다. Main 8 · Boss 1 · 챌린지 3.
// 코드는 없다. 목표 종류를 해석하는 건 src/mission.js 가 한다.
//
// 좌표를 직접 박지 않는다. 도시는 매번 같은 씨앗으로 생성되지만 구역 위치는
// 코드가 정하는 값이라, 여기에 숫자를 박으면 도시를 손댈 때마다 미션이 깨진다.
// 대신 `zone: n` 으로 가리키고 게임 쪽이 시작할 때 실제 좌표로 바꿔 넣는다.
//
// 스토리는 게임플레이를 잇는 구조다 (문서 02 §18). 컷신을 만들지 않는다 —
// 짧은 브리핑 한 줄이면 충분하다.

const CHAPTERS = [
  { id: 0, name: "프롤로그", desc: "도시를 익힌다" },
  { id: 1, name: "이상 신호",  desc: "거리에서 사건이 늘고 있다" },
  { id: 2, name: "조직",      desc: "누가 뒤에 있는지 알아낸다" },
  { id: 3, name: "정면",      desc: "도시 위기와 마지막 상대" },
];

// type 은 HUD 와 결과 화면의 표시에만 쓴다. 판정은 objectives 가 한다.
const MISSIONS = [
  {
    id: "m1", chapter: 1, type: "combat",
    title: "첫 순찰",
    brief: "구역에 무장 인원이 모였다. 정리하고 온다.",
    objectives: [
      { type: "reach", zone: 0, r: 60, label: "구역으로 이동" },
      { type: "defeat", n: 5 },
    ],
    failConditions: [{ type: "death" }],
    reward: { text: "웹스윙 감각", ability: null },
    next: "m2",
  },
  {
    id: "m2", chapter: 1, type: "traversal",
    title: "추적",
    brief: "차량이 도심을 가로질러 달아난다. 놓치지 마라.",
    objectives: [
      { type: "checkpoints", points: [{ zone: 0, r: 45 }, { zone: 1, r: 45 }, { zone: 2, r: 45 }] },
    ],
    failConditions: [{ type: "death" }, { type: "timeout", t: 240 }],
    gold: 75, silver: 105, bronze: 150,
    reward: { text: "양손 웹 감각", ability: "dual" },
    next: "m3",
  },
  {
    id: "m3", chapter: 1, type: "rescue",
    title: "버텨라",
    brief: "구조대가 올 때까지 자리를 지킨다.",
    objectives: [
      { type: "reach", zone: 1, r: 60, label: "현장으로" },
      { type: "survive", t: 40 },
    ],
    failConditions: [{ type: "death" }],
    reward: { text: "버티는 법", ability: null },
    next: "m4",
  },
  {
    id: "m4", chapter: 2, type: "training",
    title: "손에 익히기",
    brief: "쳐내기와 띄우기를 실전에서 쓴다.",
    objectives: [
      { type: "action", key: "parry", name: "쳐내기", n: 3 },
      { type: "action", key: "launch", name: "띄우기", n: 2 },
    ],
    failConditions: [{ type: "death" }],
    reward: { text: "근접 연계", ability: null },
    next: "m5",
  },
  {
    id: "m5", chapter: 2, type: "combat",
    title: "소탕",
    brief: "구역 하나를 통째로 비운다.",
    objectives: [
      { type: "reach", zone: 2, r: 60, label: "구역으로 이동" },
      { type: "defeat", n: 12 },
    ],
    failConditions: [{ type: "death" }],
    reward: { text: "전투 지구력", ability: null },
    next: "m6",
  },
  {
    id: "m6", chapter: 2, type: "traversal",
    title: "위로",
    brief: "벽을 타고 올라가 옥상에서 신호를 잡는다.",
    objectives: [
      { type: "action", key: "plant", name: "벽 짚기", n: 5 },
      { type: "action", key: "vclimb", name: "건물 타기", n: 3 },
      { type: "reach", zone: 3, r: 60, label: "옥상 지점으로" },
    ],
    failConditions: [{ type: "death" }],
    reward: { text: "수직 이동", ability: "vclimb" },
    next: "m7",
  },
  {
    id: "m7", chapter: 3, type: "combat",
    title: "정예",
    brief: "훈련된 인원이다. 시간을 끌면 불리하다.",
    objectives: [
      { type: "reach", zone: 4, r: 60, label: "구역으로 이동" },
      { type: "defeat", n: 8 },
    ],
    failConditions: [{ type: "death" }, { type: "timeout", t: 180 }],
    gold: 90, silver: 120, bronze: 160,
    reward: { text: "정예 격파", ability: null },
    next: "m8",
  },
  {
    id: "m8", chapter: 3, type: "boss",
    title: "마지막 상대",
    brief: "도시 한복판. 여기서 끝낸다.",
    objectives: [
      { type: "reach", zone: 5, r: 60, label: "결전 장소로" },
      { type: "boss", n: 1, label: "상대를 쓰러뜨린다" },
    ],
    failConditions: [{ type: "death" }],
    reward: { text: "도시를 지켰다", ability: null },
    next: null,
  },
];

// 챌린지. 미션과 같은 시스템이고 record 만 다르다 (문서 02 §23~24).
const CHALLENGES = [
  {
    id: "c1", type: "timetrial", record: true,
    title: "타임 트라이얼",
    brief: "체크포인트를 순서대로. 기록이 남는다.",
    objectives: [
      { type: "checkpoints", points: [{ zone: 0, r: 40 }, { zone: 2, r: 40 }, { zone: 4, r: 40 }, { zone: 1, r: 40 }] },
    ],
    failConditions: [{ type: "timeout", t: 300 }],
    gold: 70, silver: 100, bronze: 140,
  },
  {
    id: "c2", type: "combat", record: true,
    title: "전투 챌린지",
    brief: "제한 시간 안에 10명.",
    objectives: [{ type: "defeat", n: 10 }],
    failConditions: [{ type: "death" }, { type: "timeout", t: 120 }],
    gold: 45, silver: 70, bronze: 100,
  },
  {
    id: "c3", type: "training", record: true,
    title: "연계 훈련",
    brief: "쳐내기 · 띄우기 · 처형을 이어서.",
    objectives: [
      { type: "action", key: "parry", name: "쳐내기", n: 5 },
      { type: "action", key: "launch", name: "띄우기", n: 5 },
      { type: "action", key: "exec", name: "처형", n: 3 },
    ],
    failConditions: [{ type: "death" }, { type: "timeout", t: 180 }],
    gold: 60, silver: 90, bronze: 130,
  },
];

const byId = (list, id) => list.find(m => m.id === id) || null;
const missionById = (id) => byId(MISSIONS, id);
const challengeById = (id) => byId(CHALLENGES, id);
const firstMission = () => MISSIONS[0];
function nextMission(id) {
  const m = missionById(id);
  return m && m.next ? missionById(m.next) : null;
}
function chapterOf(id) {
  const m = missionById(id);
  return m ? m.chapter : 0;
}

export {
  CHAPTERS, MISSIONS, CHALLENGES,
  missionById, challengeById, firstMission, nextMission, chapterOf,
};
