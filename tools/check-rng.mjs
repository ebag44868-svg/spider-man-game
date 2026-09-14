// 난수 순서가 밀렸는지 확인한다.
//
// 왜 필요한가: THREE는 재질·지오메트리·Object3D를 만들 때마다 uuid를 뽑느라
// Math.random()을 여러 번 소비한다. 테스트 하네스는 시드 난수를 game3d.js 본문
// 맨 위에서 심는데, import된 모듈은 그보다 먼저 실행된다. 그래서 모듈을 떼어내며
// THREE 객체 생성 지점이 한 줄이라도 옮겨지면 도시 구성이 통째로 달라진다.
//
// 실제로 세 번 걸렸다 — 상완, 보조 웹, 디버그 마커. 전부 "선언 자리에서 만들지 말고
// 첫 사용 때 만든다"로 고쳤다.
//
// 적·구역은 전투를 걷어낼 때 같이 없어졌다. 그래서 기준선을 도시(건물·차량)로
// 다시 잡았다. 감시하려는 대상은 그대로다 — THREE 객체 생성 순서.
//
// 쓰는 법: npm run rng   (하네스는 먼저 만들어져 있어야 한다)
import { T } from "../_harness.mjs";

// 기준값. 리팩터링으로 이 숫자가 바뀌면 난수가 밀린 것이다 — 절대 갱신하지 말 것.
const BASE = { buildings: 2059, cars: 250 };

const now = { buildings: T.buildings.length, cars: T.cars.length };

const same = JSON.stringify(now) === JSON.stringify(BASE);
console.log("  기준  " + JSON.stringify(BASE));
console.log("  현재  " + JSON.stringify(now));
console.log(same ? "  일치 — 난수 순서가 유지됐다" : "  X 불일치 — THREE 객체 생성 순서가 바뀌었다");
process.exit(same ? 0 : 1);
