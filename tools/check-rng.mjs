// 난수 순서가 밀렸는지 확인한다.
//
// 왜 필요한가: THREE는 재질·지오메트리·Object3D를 만들 때마다 uuid를 뽑느라
// Math.random()을 여러 번 소비한다. 테스트 하네스는 시드 난수를 game3d.js 본문
// 맨 위에서 심는데, import된 모듈은 그보다 먼저 실행된다. 그래서 모듈을 떼어내며
// THREE 객체 생성 지점이 한 줄이라도 옮겨지면 도시와 적 구성이 통째로 달라진다.
//
// 실제로 두 번 겪었다. 적 구성이
//   사수 92 · 저격수 42 · 돌격병 43 · 격투병 39   (기준)
//   사수 83 · 격투병 41 · 돌격병 46 · 저격수 46   (vfx 추출 실패 당시)
// 로 바뀌었고, 테스트 하나가 엉뚱한 이유로 깨졌다.
//
// 쓰는 법: npm run rng   (하네스는 먼저 만들어져 있어야 한다)
import { T } from "../_harness.mjs";

// 기준값. 리팩터링으로 이 숫자가 바뀌면 난수가 밀린 것이다 — 절대 갱신하지 말 것.
const BASE = { buildings: 2235, enemies: 216, byType: { "1": 43, "2": 42, "3": 39, "0": 92 } };

const byType = {};
for (const e of T.enemies) {
  const k = String(e.type ?? 0);
  byType[k] = (byType[k] || 0) + 1;
}
const now = { buildings: T.buildings.length, enemies: T.enemies.length, byType };

const same = JSON.stringify(now) === JSON.stringify(BASE);
console.log("  기준  " + JSON.stringify(BASE));
console.log("  현재  " + JSON.stringify(now));
console.log(same ? "  일치 — 난수 순서가 유지됐다" : "  X 불일치 — THREE 객체 생성 순서가 바뀌었다");
process.exit(same ? 0 : 1);
