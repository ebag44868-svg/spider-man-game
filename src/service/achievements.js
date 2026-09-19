// 업적 (게임 밖 서비스 층)
//
// 전부 데이터다. 업적마다 if 문을 새로 짜지 않는다 — stats.js 의 기록 하나(stat)가
// 목표치(goal)를 넘으면 달성이다. 기록으로 못 재는 업적이 필요해지면 그때 stats 에 칸을 늘린다.
// hidden 은 달성 전까지 이름·설명을 가린다.

const ACHIEVEMENTS = [
  { id: "first_web",  name: "첫 거미줄",        desc: "거미줄을 처음 쏜다",                  stat: "webs",       goal: 1 },
  { id: "web_500",    name: "실 공장",          desc: "거미줄 500발",                        stat: "webs",       goal: 500 },
  { id: "km_1",       name: "동네 한 바퀴",     desc: "누적 1km 이동",                       stat: "distance",   goal: 1000 },
  { id: "km_42",      name: "마라톤",           desc: "누적 42.195km 이동",                  stat: "distance",   goal: 42195 },
  { id: "speed_200",  name: "고속도로",         desc: "시속 200km 돌파",                     stat: "topSpeed",   goal: 200 / 3.6 },
  { id: "speed_350",  name: "한계 속도",        desc: "시속 350km 돌파",                     stat: "topSpeed",   goal: 350 / 3.6 },
  { id: "alt_400",    name: "전망대",           desc: "고도 400m",                           stat: "maxAlt",     goal: 400 },
  { id: "alt_1000",   name: "구름 위",          desc: "고도 1,000m — 도심 한복판 초고층",    stat: "maxAlt",     goal: 1000 },
  { id: "air_20",     name: "날개 없는 비행",   desc: "땅을 안 밟고 20초",                   stat: "longestAir", goal: 20 },
  { id: "sling_10",   name: "인간 새총",        desc: "양손 새총 10번",                      stat: "slings",     goal: 10 },
  { id: "graze_50",   name: "간발의 차",        desc: "벽을 스치며 50번",                    stat: "grazes",     goal: 50 },
  { id: "hour_1",     name: "뉴욕 주민",        desc: "1시간 플레이",                        stat: "playtime",   goal: 3600 },
  { id: "car_1",      name: "무단횡단",         desc: "차에 치인다",                         stat: "carHits",    goal: 1, hidden: true },
];

function progressOf(a, totals) {
  const v = totals && typeof totals[a.stat] === "number" ? totals[a.stat] : 0;
  return Math.max(0, Math.min(1, v / a.goal));
}

// unlocked(id -> 시각)에 새로 달성한 것을 적고, 새로 달성한 id 목록을 돌려준다.
function checkAchievements(totals, unlocked, at) {
  const got = [];
  for (const a of ACHIEVEMENTS) {
    if (unlocked[a.id]) continue;
    if (progressOf(a, totals) >= 1) { unlocked[a.id] = at || 1; got.push(a.id); }
  }
  return got;
}

function achById(id) { return ACHIEVEMENTS.find(a => a.id === id) || null; }

export { ACHIEVEMENTS, progressOf, checkAchievements, achById };
