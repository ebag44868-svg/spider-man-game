// 적 팔다리 리그.
//
// game3d.js에서 그대로 옮겨온 코드다. 함수 본문은 한 줄도 바꾸지 않았다.
// 바꾼 것은 두 가지뿐이다.
//   · 지오메트리·재질·리그 풀 생성을 initRigs() 안으로 모았다 (아래 이유 참고)
//   · scene / enemies / player / BRAWL / mergeGeometries 를 import 대신 주입받는다
//     (import하면 game3d.js와 순환 참조가 된다)
//
// 생성 순서는 원래와 똑같다. initRigs()를 game3d.js가 원래 이것들을 만들던
// 바로 그 자리에서 부르기 때문이다. THREE 객체는 만들 때마다 uuid를 뽑느라
// Math.random()을 소비하므로, 순서가 한 칸만 밀려도 도시와 적 구성이 통째로
// 달라진다 (tools/check-rng.mjs 가 그걸 감시한다).

// 브라우저는 importmap으로 "three"를 이 파일로 보낸다. 여기서는 상대경로를 직접 쓴다 —
// 테스트 하네스(Node)에는 importmap이 없고, 어차피 같은 파일로 해석되어 인스턴스도 하나다.
import * as THREE from "../lib/three.module.js";

// 근접 격투는 "지금 뭘 휘두르는지"가 보여야 성립한다. 캡슐 하나로는 가로베기와
// 내리침이 색으로만 구분됐다. 그래서 팔다리를 붙인다.
//
// 다만 216명 전부에 달면 한 명당 메시 5개 = 1,000개가 넘는 드로우콜이 된다.
// 근접 격투는 코앞에서만 벌어지므로, 가까운 몇 명에게만 돌려 쓰는 풀을 둔다.
// 멀리 있는 적은 지금까지처럼 캡슐 하나로 그린다.
const RIG_POOL  = 20;      // 동시에 팔다리를 붙일 최대 인원
const RIG_RANGE = 150;     // 이 거리 안에서만
// 경계에서 붙었다 떨어졌다 깜빡이지 않도록, 뗄 때는 더 멀리 나가야 뗀다.
const RIG_DROP  = RIG_RANGE * 1.25;

// game3d.js에서 주입받는 것들. scene/enemies/player/BRAWL은 재대입되지 않는
// 객체라 참조만 들고 있으면 된다.
let scene = null, enemies = null, player = null, BRAWL = null, mergeGeometries = null;
let _rigTorsoGeo = null, _rigArmGeo = null, _rigLegGeo = null, _rigFallbackMat = null;
const rigPool = [];

// game3d.js가 원래 이 오브젝트들을 만들던 그 자리에서 한 번 부른다.
function initRigs(sc, enemyList, pl, brawlTable, mergeFn) {
  scene = sc;
  enemies = enemyList;
  player = pl;
  BRAWL = brawlTable;
  mergeGeometries = mergeFn;

  _rigTorsoGeo = (() => {
    const b = new THREE.BoxGeometry(2.3, 3.1, 1.5); b.translate(0, 4.3, 0);
    const h = new THREE.SphereGeometry(0.95, 10, 8); h.translate(0, 6.5, 0);
    return mergeGeometries([b, h], false) || b;
  })();
  // 팔다리는 관절에서 매달리도록 원점을 위쪽 끝에 둔다 (회전이 어깨/골반에서 걸리게)
  _rigArmGeo = (() => { const g = new THREE.BoxGeometry(0.68, 2.9, 0.68); g.translate(0, -1.45, 0); return g; })();
  _rigLegGeo = (() => { const g = new THREE.BoxGeometry(0.86, 3.0, 0.86); g.translate(0, -1.5, 0); return g; })();

  _rigFallbackMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5 });
  for (let i = 0; i < RIG_POOL; i++) { const r = makeRig(); scene.add(r.root); rigPool.push(r); }
}

function makeRig() {
  const root = new THREE.Object3D();
  const torso = new THREE.Mesh(_rigTorsoGeo, _rigFallbackMat);
  root.add(torso);
  const mk = (geo, x, y) => {
    const piv = new THREE.Object3D();
    piv.position.set(x, y, 0);
    const m = new THREE.Mesh(geo, _rigFallbackMat);
    piv.add(m);
    root.add(piv);
    return { piv, m };
  };
  const armL = mk(_rigArmGeo, -1.55, 5.4);
  const armR = mk(_rigArmGeo,  1.55, 5.4);
  const legL = mk(_rigLegGeo, -0.65, 2.9);
  const legR = mk(_rigLegGeo,  0.65, 2.9);
  root.visible = false;
  return { root, torso, armL, armR, legL, legR, owner: null };
}


function rigAttach(r, e) {
  if (r.owner === e) return;
  rigDetach(r);
  r.owner = e;
  e.rig = r;
  if (e.body) e.body.visible = false;      // 캡슐을 끄고 팔다리로 대체한다
  e.g.add(r.root);
  r.root.visible = true;
  for (const m of [r.torso, r.armL.m, r.armR.m, r.legL.m, r.legR.m]) m.material = e.mat;
}
function rigDetach(r) {
  const e = r.owner;
  if (!e) return;
  if (e.body) e.body.visible = true;
  if (e.rig === r) e.rig = null;
  e.g.remove(r.root);
  r.root.visible = false;
  r.owner = null;
}

// 가까운 적에게 리그를 나눠준다. 매 프레임 한 번.
const _rigCand = [];
function assignRigs() {
  _rigCand.length = 0;
  for (const e of enemies) {
    if (e.dead) continue;
    const d = e.g.position.distanceTo(player.pos);
    if (d > RIG_RANGE) continue;
    _rigCand.push({ e, d });
  }
  _rigCand.sort((a, b) => a.d - b.d);
  const want = _rigCand.slice(0, RIG_POOL).map(c => c.e);
  // 더 이상 대상이 아닌 리그부터 뗀다
  // 이미 붙어 있는 적은 RIG_DROP까지는 봐준다. 경계에서 팔다리가 깜빡이면
  // "중간에 팔다리가 생기는" 것처럼 보인다.
  for (const r of rigPool) {
    if (!r.owner) continue;
    const keep = !r.owner.dead
      && r.owner.g.position.distanceTo(player.pos) <= RIG_DROP;
    if (!keep) rigDetach(r);
  }
  for (const e of want) {
    if (e.rig) continue;
    const free = rigPool.find(r => !r.owner);
    if (!free) break;
    rigAttach(free, e);
  }
}

// 팔다리를 상태에 맞춰 움직인다. 이게 격투를 읽히게 하는 전부다.
const _rigPrev = new THREE.Vector3();
function poseRig(e, r, dt) {
  const t = performance.now() * 0.001;
  const sw = e.swing;
  // 걷기 흔들림. 실제 속도를 재는 대신 AI 상태를 쓴다 — 넉백에 다리가 튀지 않는다.
  const spd = e.state === "chase" ? 1 : e.state === "patrol" ? 0.45
            : e.state === "engage" ? 0.3 : e.state === "wait" ? 0.35 : 0;
  const step = Math.sin(t * (5 + spd * 6)) * spd;

  let aL = 0, aR = 0;       // 팔 X 회전 (앞뒤)
  let sL = 0, sR = 0;       // 팔 Z 회전 (좌우로 벌리기)
  let yR = 0;               // 오른팔 Y 회전 (가로로 휘두르기)
  let lean = 0, twist = 0;  // 몸통

  if (e.bound > 0) {
    // 고치에 묶임 — 팔을 몸에 붙이고 굳는다
    sL = 0.25; sR = -0.25;
  } else if (e.stag > 0) {
    // 체간 붕괴 — 팔이 축 늘어지고 상체가 앞으로 꺾인다
    const w = Math.sin(t * 3) * 0.12;
    aL = 0.5 + w; aR = 0.5 - w;
    lean = 0.42;
  } else if (sw) {
    // 격투병의 휘두르기. 준비 -> 판정 -> 회수를 한 몸짓으로.
    const spec = BRAWL[sw.kind];
    const k = Math.min(1.4, sw.t / spec.hitAt);          // 1에서 판정
    if (sw.kind === 0) {
      // 가로베기: 오른팔을 뒤로 감았다가 몸 앞을 가로질러 훑는다
      yR = k <= 1 ? -1.7 * k : -1.7 + (k - 1) * 8.5;
      aR = -1.35; sR = -0.5;
      twist = k <= 1 ? -0.5 * k : -0.5 + (k - 1) * 2.4;
    } else if (sw.kind === 1) {
      // 내리침: 오른팔을 머리 위로 들었다가 수직으로 찍는다
      aR = k <= 1 ? -2.7 * k : -2.7 + (k - 1) * 12;
      aL = -0.3;
      lean = k <= 1 ? -0.3 * k : -0.3 + (k - 1) * 2.2;
    } else {
      // 지연 페인트: 두 팔을 크게 젖히고 멈췄다가 한꺼번에 내리찍는다
      const hold = k > 0.72 && k <= 1;
      const raise = hold ? 0.72 : Math.min(0.72, k);
      aR = -3.0 * (raise / 0.72); aL = -3.0 * (raise / 0.72);
      if (k > 1) { aR += (k - 1) * 13; aL += (k - 1) * 13; }
      lean = k <= 1 ? -0.45 * (raise / 0.72) : -0.45 + (k - 1) * 3;
    }
  } else if (e.hitT > 0) {
    // 피격 반응. 상체가 뒤로 밀리고 팔이 흐트러진다.
    // 휘두르는 중(sw)에는 이 가지에 안 온다 — 예고 동작이 끊기면 무엇이 오는지
    // 못 읽게 되고, 그건 맞은 표시보다 훨씬 큰 손해다.
    const k = Math.min(1, e.hitT);
    const w = Math.sin(k * Math.PI * 3) * 0.2 * k;   // 짧게 떨린다
    aL = 0.85 * k + w;  aR = 0.85 * k - w;
    sL = 0.55 * k;      sR = -0.55 * k;
    lean = -0.38 * k;                                 // 뒤로 젖혀진다
    twist = w * 1.2;
  } else if (e.state === "wait") {
    // 순번을 기다리는 중. 가드를 올리고 발을 잘게 놀린다.
    // "구경하는 놈"과 "다음에 들어올 놈"이 달라 보여야 대기가 대기로 읽힌다.
    aL = -0.62; aR = -0.62;
    sL = 0.34; sR = -0.34;
    lean = 0.12;
  } else if (e.aimT > 0) {
    // 사수·저격수의 조준: 오른팔을 플레이어 쪽으로 곧게 뻗는다
    aR = -1.55; sR = -0.12;
    aL = -0.5;
  } else {
    // 평상시: 걸음에 맞춰 팔다리가 엇갈린다
    aL = step * 0.75;  aR = -step * 0.75;
    sL = 0.14; sR = -0.14;
  }

  r.armL.piv.rotation.set(aL, 0, sL);
  r.armR.piv.rotation.set(aR, yR, sR);
  r.legL.piv.rotation.set(-step * 0.7, 0, 0);
  r.legR.piv.rotation.set(step * 0.7, 0, 0);
  r.torso.rotation.set(lean, twist, 0);
}

function updateRigs(dt) {
  assignRigs();
  for (const r of rigPool) if (r.owner && !r.owner.dead) poseRig(r.owner, r, dt);
}

export {
  initRigs,
  RIG_POOL, RIG_RANGE, RIG_DROP,
  rigPool, makeRig, rigAttach, rigDetach, assignRigs, poseRig, updateRigs,
};
