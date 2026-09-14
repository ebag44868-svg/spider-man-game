// 뉴욕 소품 — Fab 에셋을 도시에 깐다
//
// 도시(건물·인도·도로)는 코드로 만든다. 여기서는 그 위에 '사람 눈높이의 물건'을
// 얹는다: 옥상 물탱크·실외기, 인도의 소화전·쓰레기통·우체통·벤치·버스정류장·
// 쓰레기봉투·수거함, 차도의 맨홀, 그리고 가까운 가로등과 차를 실제 모델로.
//
// ── 지키는 원칙 ──
//
// 1. 도시 생성 난수를 건드리지 않는다.
//    THREE 객체 생성자는 uuid 를 만들며 Math.random 을 먹는다. 도시·차 생성 도중에
//    객체를 만들면 난수열이 밀린다(tools/check-rng.mjs 가 감시). 그래서 배치 계산은
//    전용 시드 난수(mulberry32)로 하고, 모델 객체는 GLB 로드가 끝난 뒤(= 도시가 다
//    만들어진 뒤) 비동기로 만든다.
//
// 2. 가까운 것만 모델로 그린다.
//    가로등만 도시에 약 2천 개다. 가로등 모델(1,600 삼각형)로 전부 그리면 320만
//    삼각형이다. 그래서 종류마다 반경을 두고, 그 안의 인스턴스만 InstancedMesh 에
//    채운다(0.25초마다). 멀리 있는 가로등·차는 원래의 단순한 상자가 그대로 맡는다.
//
// 3. 파일이 없거나 로드에 실패하면 조용히 원래 도시로 남는다. 모델은 덤이다.
//
// 4. 이 파일은 게임을 모른다. 필요한 건 전부 init 으로 주입받는다.
import * as THREE from "../lib/three.module.js";
import { PROP_SCALE, CAR_SCALE } from "./scale.js";

const BASE = "assets/models/nyc/";
const REBUILD_T = 0.25;
const GRID = 110;                    // 공간 격자 한 칸 (m)

// 종류별 설정.
//   r      모델로 그리는 반경. 물탱크는 지붕 실루엣이라 멀리서도 보여야 한다.
//   shadow 그림자를 드리울지. 작은 소품 그림자는 비용만 크고 안 보인다.
//   yaw    모델의 정면 보정 (라디안). 원본마다 앞이 제각각이다.
const TYPES = {
  // 실측: 반경 1.4km 에선 물탱크(1,736 삼각형)가 거의 전부 그려져 45만 삼각형이었다.
  // 800m 면 여러 블록 너머 지붕선까지는 보이고 비용은 절반 아래로 준다.
  // 5배로 키우면서 반경도 늘렸다 — 큰 물건이 코앞에서 갑자기 생기면 티가 난다.
  // 대신 배치 간격도 넓혀서 그려지는 개수는 비슷하게 유지한다.
  water_tower:  { r: 1000, shadow: true,  yaw: 0 },
  ac_unit:      { r: 450,  shadow: false, yaw: 0 },
  hydrant:      { r: 380,  shadow: false, yaw: 0 },
  trash_bin:    { r: 380,  shadow: false, yaw: 0 },
  mailbox:      { r: 380,  shadow: false, yaw: 0 },
  newspapers:   { r: 260,  shadow: false, yaw: 0 },
  bench:        { r: 380,  shadow: false, yaw: 0 },
  bus_stop:     { r: 480,  shadow: false, yaw: 0 },
  dumpster:     { r: 420,  shadow: false, yaw: 0 },
  trash_bag_a:  { r: 300,  shadow: false, yaw: 0 },
  trash_bag_b:  { r: 300,  shadow: false, yaw: 0 },
  manhole:      { r: 260,  shadow: false, yaw: 0 },
  street_light: { r: 420,  shadow: false, yaw: 0 },
};
const CAR_R = 520;                   // 이 안의 차만 모델로 바뀐다
const CAR_YAW = 0;                   // 차 모델 정면 보정

// ─────────────────────────── 시드 난수 ───────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────── 상태 ───────────────────────────
let S = null;          // 주입받은 게임 정보
const kinds = {};      // name -> { cfg, parts, items, cells, meshes }
let cars = null;       // { list, bodyMesh, topMesh, types: {taxi, sedan, police}, pick: [] }
let lamps = null;      // { data, meshes: [pole, arm, head], orig: [] }
let rebuildT = 0, ready = false, loadedCount = 0;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _zero = new THREE.Matrix4().makeScale(0, 0, 0);

// ─────────────────────────── GLB → 재질별 합친 형상 ───────────────────────────
// 인스턴싱은 (형상, 재질) 한 쌍마다 한 번이다. GLB 안의 메시들을 월드 변환째로 굽고
// 같은 재질끼리 합쳐서 드로우콜을 줄인다.
// GLB 속성이 인터리브(한 버퍼에 여러 속성이 섞여 저장)면 mergeGeometries 가 거부한다.
// 경량화 도구가 정점 버퍼를 인터리브로 써서 실외기 합치기가 실제로 실패했다.
// 합치기 전에 속성마다 평범한 배열로 풀어준다.
function plainAttr(a) {
  if (!a.isInterleavedBufferAttribute) return a;
  const n = a.count, k = a.itemSize, out = new Float32Array(n * k);
  const get = [a.getX, a.getY, a.getZ, a.getW];
  for (let i = 0; i < n; i++) for (let j = 0; j < k; j++) out[i * k + j] = get[j].call(a, i);
  return new THREE.BufferAttribute(out, k, a.normalized);
}

function extractParts(root, merge) {
  root.updateMatrixWorld(true);
  const byMat = new Map();
  root.traverse(o => {
    if (!o.isMesh || !o.geometry) return;
    let g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    for (const name of Object.keys(g.attributes)) g.setAttribute(name, plainAttr(g.attributes[name]));
    if (g.index) g = g.toNonIndexed();         // 합칠 때 색인 유무가 섞이면 실패한다
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(g);
  });
  const parts = [];
  for (const [mat, geos] of byMat) {
    // 합치려면 속성 집합이 같아야 한다 — 공통 속성만 남긴다
    const common = Object.keys(geos[0].attributes).filter(k => geos.every(g => g.attributes[k]));
    for (const g of geos) for (const k of Object.keys(g.attributes)) if (!common.includes(k)) g.deleteAttribute(k);
    const geo = geos.length === 1 ? geos[0] : merge(geos, false);
    if (!geo) continue;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.computeBoundingSphere();
    let tris = geo.attributes.position.count / 3;
    parts.push({ geometry: geo, material: mat, tris });
  }
  return parts;
}

function loadGlb(Loader, name) {
  return new Promise(res => {
    try {
      new Loader().load(BASE + name + ".glb", g => res(g.scene), undefined, () => res(null));
    } catch (e) { res(null); }
  });
}

// ─────────────────────────── 배치 계산 (순수 데이터) ───────────────────────────
function cellKey(x, z) { return Math.floor(x / GRID) + "," + Math.floor(z / GRID); }

function addItem(name, x, y, z, yaw, s) {
  const k = kinds[name];
  if (!k) return;
  const i = k.items.length;
  k.items.push({ x, y, z, yaw, s });
  const key = cellKey(x, z);
  if (!k.cells.has(key)) k.cells.set(key, []);
  k.cells.get(key).push(i);
}

// 지붕 위 한 점이 더 높은 건물에 덮여 있는지. 계단식 마천루는 넓은 아래층 박스와
// 좁은 위층 박스가 전부 지면에서 시작하므로, 아래층 지붕 가운데는 위층이 뚫고 지나간다.
function buildRoofGrid(buildings) {
  const g = new Map();
  buildings.forEach((b, i) => {
    const x0 = Math.floor((b.x - b.w / 2) / 60), x1 = Math.floor((b.x + b.w / 2) / 60);
    const z0 = Math.floor((b.z - b.d / 2) / 60), z1 = Math.floor((b.z + b.d / 2) / 60);
    for (let gx = x0; gx <= x1; gx++) for (let gz = z0; gz <= z1; gz++) {
      const k = gx + "," + gz;
      if (!g.has(k)) g.set(k, []);
      g.get(k).push(i);
    }
  });
  return g;
}
function coveredAt(grid, buildings, self, x, z, top, pad) {
  const list = grid.get(Math.floor(x / 60) + "," + Math.floor(z / 60)) || [];
  for (const i of list) {
    if (i === self) continue;
    const c = buildings[i];
    if (c.y0 + c.h <= top + 0.4) continue;           // 더 낮거나 같으면 막지 않는다
    if (Math.abs(x - c.x) < c.w / 2 + pad && Math.abs(z - c.z) < c.d / 2 + pad) return true;
  }
  return false;
}

function planRooftops(rand) {
  const B = S.buildings;
  const grid = buildRoofGrid(B);
  let towers = 0, acs = 0;
  B.forEach((b, i) => {
    if (b.w < 12 || b.d < 12 || b.h < 10) return;
    const top = b.y0 + b.h;
    const placed = [];
    // 물탱크: 뉴욕에서는 20층 안팎의 오래된 건물 옥상에 있다. 초고층 유리 타워엔 없다.
    // 5배 물탱크는 폭 16m · 높이 35m 다. 돌려 놓아도 지붕 밖으로 안 나가게 26m 이상 지붕에만.
    if (b.h > 20 && b.h < 115 && b.w >= 26 && b.d >= 26 && rand() < 0.2) {
      for (let t = 0; t < 8; t++) {
        const x = b.x + (rand() - 0.5) * (b.w - 22), z = b.z + (rand() - 0.5) * (b.d - 22);
        if (coveredAt(grid, B, i, x, z, top, 10)) continue;
        addItem("water_tower", x, top, z, rand() * Math.PI * 2, 0.85 + rand() * 0.35);
        placed.push([x, z, 14]); towers++;
        break;
      }
    }
    // 실외기
    if (rand() < 0.55) {
      const n = 1 + (rand() * 4 | 0);
      for (let a = 0; a < n; a++) {
        for (let t = 0; t < 5; t++) {
          const x = b.x + (rand() - 0.5) * (b.w - 10), z = b.z + (rand() - 0.5) * (b.d - 10);
          if (coveredAt(grid, B, i, x, z, top, 4.5)) continue;
          if (placed.some(p => Math.hypot(p[0] - x, p[1] - z) < p[2])) continue;
          addItem("ac_unit", x, top, z, (rand() * 4 | 0) * Math.PI / 2, 0.9 + rand() * 0.5);
          placed.push([x, z, 7]); acs++;
          break;
        }
      }
    }
  });
  return { towers, acs };
}

// 인도. 블록 경계 밖으로 SIDEWALK_W 폭이 인도다.
//   바깥 줄(연석 쪽): 소화전 · 쓰레기통 · 우체통 · 벤치 · 버스정류장
//   안쪽 줄(건물 쪽): 쓰레기봉투 더미 · 수거함 · 신문 뭉치
function planSidewalks(rand) {
  const { blocks, SIDEWALK_W: SW, groundAt } = S;
  let n = 0;
  // 가로등 자리를 피한다. 소화전이 가로등 기둥에 박혀 있으면 바로 티가 난다.
  const lampGrid = new Map();
  if (lamps) for (const L of lamps.data) {
    const k = Math.floor(L.x / 16) + "," + Math.floor(L.z / 16);
    if (!lampGrid.has(k)) lampGrid.set(k, []);
    lampGrid.get(k).push(L);
  }
  const nearLamp = (x, z) => {
    const gx = Math.floor(x / 16), gz = Math.floor(z / 16);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      for (const L of lampGrid.get((gx + a) + "," + (gz + b)) || []) if (Math.hypot(L.x - x, L.z - z) < 8) return true;
    }
    return false;
  };
  const y = (x, z) => groundAt(x, z, 6);
  for (const bl of blocks) {
    // 네 변: [시작, 끝, 고정좌표(바깥), 고정좌표(안쪽), 축, 도로쪽 방향]
    const sides = [
      // 5배 소품은 깊이가 3~6m 라 연석 쪽 줄은 연석에서 3m, 건물 쪽 줄은 벽에서 3m 안쪽에 둔다
      { a: bl.x0, b: bl.x1, outer: bl.z0 - SW + 3, inner: bl.z0 - 3, axis: "x", face: -1, street: true },
      { a: bl.x0, b: bl.x1, outer: bl.z1 + SW - 3, inner: bl.z1 + 3, axis: "x", face: 1, street: true },
      { a: bl.z0, b: bl.z1, outer: bl.x0 - SW + 3, inner: bl.x0 - 3, axis: "z", face: -1, street: false },
      { a: bl.z0, b: bl.z1, outer: bl.x1 + SW - 3, inner: bl.x1 + 3, axis: "z", face: 1, street: false },
    ];
    for (const sd of sides) {
      const len = sd.b - sd.a;
      if (len < 40) continue;
      const outerT = [];                  // 바깥 줄에 놓인 자리 — 안쪽 줄이 그 옆에 겹쳐 서지 않게
      // 도로를 바라보는 방향
      const faceYaw = sd.axis === "x" ? (sd.face > 0 ? 0 : Math.PI) : (sd.face > 0 ? Math.PI / 2 : -Math.PI / 2);
      const P = (t, off) => sd.axis === "x" ? [t, off] : [off, t];

      // 버스정류장 — 애비뉴 변에 가끔 하나
      if (!sd.street && rand() < 0.3) {
        const t = sd.a + len * (0.3 + rand() * 0.4);
        const [x, z] = P(t, sd.outer - sd.face * 0.4);
        addItem("bus_stop", x, y(x, z), z, faceYaw, 1); n++;
        outerT.push(t, t - 9, t + 9);
      }

      // 바깥 줄
      // 뉴욕 인도는 복잡하다. 처음 밀도로는 50m 에 하나꼴이라 휑해 보였다.
      // 소품이 5배라 간격도 3배쯤 넓혔다. 촘촘하게 두면 인도가 물건 벽이 된다.
      for (let t = sd.a + 12; t < sd.b - 12; t += 22 + rand() * 26) {
        const r = rand();
        const [x, z] = P(t, sd.outer);
        if (nearLamp(x, z)) continue;
        const gy = y(x, z);
        if (r < 0.12) { addItem("hydrant", x, gy, z, faceYaw, 1); n++; outerT.push(t); }
        else if (r < 0.32) { addItem("trash_bin", x, gy, z, faceYaw + (rand() - 0.5) * 0.4, 1); n++; outerT.push(t); }
        else if (r < 0.38) { addItem("mailbox", x, gy, z, faceYaw, 1); n++; outerT.push(t); }
        else if (r < 0.45) { addItem("bench", x, gy, z, faceYaw + Math.PI, 1); n++; outerT.push(t); }
      }

      // 안쪽 줄 — 쓰레기봉투 더미는 뉴욕 인도의 상징이다
      for (let t = sd.a + 12; t < sd.b - 12; t += 26 + rand() * 34) {
        const r = rand();
        if (outerT.some(o => Math.abs(o - t) < 9)) continue;
        const [x, z] = P(t, sd.inner);
        const gy = y(x, z);
        if (r < 0.24) {
          const c = 2 + (rand() * 5 | 0);
          for (let k = 0; k < c; k++) {
            const [bx, bz] = P(t + (rand() - 0.5) * 10, sd.inner + sd.face * rand() * 2);
            addItem(rand() < 0.5 ? "trash_bag_a" : "trash_bag_b", bx, y(bx, bz), bz, rand() * 6.28, 0.85 + rand() * 0.35);
            n++;
          }
        } else if (r < 0.28) { addItem("dumpster", x, gy, z, faceYaw + Math.PI / 2, 1); n++; }
        else if (r < 0.34) { addItem("newspapers", x, gy, z, rand() * 6.28, 1); n++; }
      }
    }
  }
  return n;
}

// 광장·공원. 공원은 동서 산책로 양옆에 길을 보는 벤치, 광장은 긴 변 안쪽에 벤치와 쓰레기통.
// 벤치 방향은 인도와 같은 규칙이다 (앉는 쪽이 -z 를 보면 yaw 0).
function planPlazas(rand) {
  const { plazas, groundAt } = S;
  if (!plazas) return 0;
  let n = 0;
  for (const p of plazas) {
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    if (p.kind === "park") {
      for (let x = p.x0 + 16; x < p.x1 - 16; x += 28 + rand() * 18) {
        if (Math.abs(x - cx) < 20) continue;             // 가운데 분수 자리
        for (const sg of [-1, 1]) {
          if (rand() < 0.3) continue;
          const z = cz + sg * 8.5;
          addItem("bench", x, groundAt(x, z, 6), z, sg > 0 ? 0 : Math.PI, 1); n++;
        }
      }
      continue;
    }
    for (let x = p.x0 + 10; x < p.x1 - 10; x += 22 + rand() * 16) {
      for (const [z, yaw] of [[p.z0 + 22, Math.PI], [p.z1 - 22, 0]]) {
        const r = rand();
        if (r < 0.4) { addItem("bench", x, groundAt(x, z, 6), z, yaw, 1); n++; }
        else if (r < 0.55) { addItem("trash_bin", x, groundAt(x, z, 6), z, yaw, 1); n++; }
      }
    }
  }
  return n;
}

// 차도 맨홀 — 블록 사이 도로 한가운데 근처
function planManholes(rand) {
  const { blocks, ST_ROAD_W, AVE_ROAD_W, groundAt } = S;
  let n = 0;
  for (const bl of blocks) {
    const zc = bl.z1 + ST_ROAD_W / 2;
    for (let k = 0; k < 2; k++) {
      if (rand() < 0.5) continue;
      const x = bl.x0 + rand() * (bl.x1 - bl.x0), z = zc + (rand() < 0.5 ? -6 : 6);
      addItem("manhole", x, groundAt(x, z, 2) + 0.012, z, rand() * 6.28, 1); n++;
    }
    const xc = bl.x1 + AVE_ROAD_W / 2;
    if (rand() < 0.6) {
      const z = bl.z0 + rand() * (bl.z1 - bl.z0), x = xc + (rand() < 0.5 ? -15.5 : 15.5);
      addItem("manhole", x, groundAt(x, z, 2) + 0.012, z, rand() * 6.28, 1); n++;
    }
  }
  return n;
}

// ─────────────────────────── 인스턴스 메시 ───────────────────────────
function buildMeshes(name) {
  const k = kinds[name];
  if (!k.parts || !k.items.length) return;
  k.meshes = k.parts.map(p => {
    const m = new THREE.InstancedMesh(p.geometry, p.material, k.items.length);
    m.count = 0;
    m.castShadow = k.cfg.shadow;
    m.receiveShadow = true;
    m.frustumCulled = false;         // 인스턴스가 흩어져 있어 형상 경계구가 의미 없다
    m.name = "nyc_" + name;
    S.scene.add(m);
    return m;
  });
}

function setItemMatrix(it, extraYaw) {
  _p.set(it.x, it.y, it.z);
  _q.setFromAxisAngle(_up, it.yaw + extraYaw);
  _s.setScalar(it.s * PROP_SCALE);
  _m.compose(_p, _q, _s);
  return _m;
}

function rebuildKind(name, px, pz) {
  const k = kinds[name];
  if (!k.meshes) return;
  const r = k.cfg.r, r2 = r * r;
  const g0x = Math.floor((px - r) / GRID), g1x = Math.floor((px + r) / GRID);
  const g0z = Math.floor((pz - r) / GRID), g1z = Math.floor((pz + r) / GRID);
  let n = 0;
  for (let gx = g0x; gx <= g1x; gx++) for (let gz = g0z; gz <= g1z; gz++) {
    const list = k.cells.get(gx + "," + gz);
    if (!list) continue;
    for (const i of list) {
      const it = k.items[i];
      if (it.dyn) continue;                     // 날아다니는 중인 소품은 따로 그린다
      const dx = it.x - px, dz = it.z - pz;
      if (dx * dx + dz * dz > r2) continue;
      setItemMatrix(it, k.cfg.yaw);
      for (const m of k.meshes) m.setMatrixAt(n, _m);
      n++;
    }
  }
  for (const m of k.meshes) { m.count = n; m.instanceMatrix.needsUpdate = true; }
}

// 가로등: 가까운 것만 모델로, 나머지는 원래 상자 가로등
function rebuildLamps(px, pz) {
  if (!lamps || !kinds.street_light.meshes) return;
  const r2 = TYPES.street_light.r ** 2;
  // 원래 행렬로 되돌린 다음 가까운 것만 지운다
  lamps.meshes.forEach((m, j) => { m.instanceMatrix.array.set(lamps.orig[j]); });
  const models = kinds.street_light.meshes;
  let n = 0;
  lamps.data.forEach((L, i) => {
    const dx = L.x - px, dz = L.z - pz;
    if (dx * dx + dz * dz > r2) return;
    for (const m of lamps.meshes) m.setMatrixAt(i, _zero);
    _p.set(L.x, L.y, L.z);
    _q.setFromAxisAngle(_up, (L.side > 0 ? 0 : Math.PI) + TYPES.street_light.yaw);
    _s.setScalar(PROP_SCALE);
    _m.compose(_p, _q, _s);
    for (const m of models) m.setMatrixAt(n, _m);
    n++;
  });
  for (const m of models) { m.count = n; m.instanceMatrix.needsUpdate = true; }
  for (const m of lamps.meshes) m.instanceMatrix.needsUpdate = true;
}

// ─────────────────────────── 차 ───────────────────────────
// 가까운 차는 모델로 바꾸고 그 자리의 상자는 지운다. 매 프레임 — 차는 움직인다.
// 상자 행렬은 updateCars 가 매 프레임 새로 쓰므로, 반드시 그 **뒤**에 불러야 한다.
function updateCarModels(px, pz) {
  if (!cars) return;
  const r2 = CAR_R * CAR_R;
  const cnt = { taxi: 0, sedan: 0, police: 0 };
  const list = cars.list;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    const dx = c.x - px, dz = c.z - pz;
    if (dx * dx + dz * dz > r2) continue;
    const type = cars.pick[i];
    const T = cars.types[type];
    if (!T) continue;
    const yaw = (c.axis === "z" ? (c.dir > 0 ? 0 : Math.PI) : (c.dir > 0 ? Math.PI / 2 : -Math.PI / 2)) + CAR_YAW;
    _p.set(c.x, 0.05, c.z);
    _q.setFromAxisAngle(_up, yaw);
    _s.setScalar(CAR_SCALE);
    _m.compose(_p, _q, _s);
    const slot = cnt[type]++;
    for (const m of T.meshes) m.setMatrixAt(slot, _m);
    if (T.tint) T.tint.setColorAt(slot, cars.color[i]);
    cars.bodyMesh.setMatrixAt(i, _zero);
    cars.topMesh.setMatrixAt(i, _zero);
  }
  for (const type of Object.keys(cars.types)) {
    const T = cars.types[type];
    if (!T) continue;
    for (const m of T.meshes) { m.count = cnt[type]; m.instanceMatrix.needsUpdate = true; }
    if (T.tint && T.tint.instanceColor) T.tint.instanceColor.needsUpdate = true;
  }
  cars.bodyMesh.instanceMatrix.needsUpdate = true;
  cars.topMesh.instanceMatrix.needsUpdate = true;
}

async function setupCars(Loader, merge) {
  const { carList, carBodyMesh, carTopMesh } = S;
  if (!carList || !carBodyMesh) return;
  const types = {};
  for (const [type, file] of [["taxi", "car_taxi"], ["sedan", "car_sedan"], ["police", "car_police"]]) {
    const root = await loadGlb(Loader, file);
    if (!root) continue;
    const parts = extractParts(root, merge);
    if (!parts.length) continue;
    const meshes = parts.map(p => {
      const m = new THREE.InstancedMesh(p.geometry, p.material, carList.length);
      m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
      m.name = "nyc_car_" + type;
      S.scene.add(m);
      return m;
    });
    // 세단은 차체 색만 차마다 다르게 — 가장 큰 부분을 차체로 본다
    let tint = null;
    if (type === "sedan") {
      let bi = 0;
      parts.forEach((p, i) => { if (p.tris > parts[bi].tris) bi = i; });
      tint = meshes[bi];
      tint.material = tint.material.clone();
      tint.material.color.setRGB(1, 1, 1);
      tint.setColorAt(0, new THREE.Color(1, 1, 1));
    }
    types[type] = { meshes, tint };
  }
  if (!Object.keys(types).length) return;

  // 차 종류는 원래 상자 차의 색으로 정한다: 노랑=택시, 남색=경찰, 나머지=세단
  const col = new THREE.Color();
  const pick = [], color = [];
  for (let i = 0; i < carList.length; i++) {
    carBodyMesh.getColorAt(i, col);
    const hex = col.getHex();
    const c = col.clone();
    color.push(c);
    // 색 성분(col.r 등)은 선형 색공간 값이라 노란색이 g=0.47 로 나온다. 처음엔 그걸로
    // 비교해서 택시가 한 대도 안 잡혔다. cars.js 팔레트의 16진수로 직접 비교한다.
    let t = "sedan";
    if (hex === 0xf2b70c) t = "taxi";
    else if (hex === 0x1f3d68) t = "police";
    if (!types[t]) t = types.sedan ? "sedan" : Object.keys(types)[0];
    pick.push(t);
  }
  cars = { list: carList, bodyMesh: carBodyMesh, topMesh: carTopMesh, types, pick, color };
}

// ─────────────────────────── 잡을 수 있는 소품 ───────────────────────────
// 거미줄로 확 끌어오거나 들고 던진다. 잡힌 소품은 인스턴스에서 빠져 따로 된 몸체로
// 날아다니고, 멈추면 그 자리에서 다시 인스턴스로 돌아간다 (옮겨진 위치 그대로 남는다).
//   r, h  모델 실측 반경·높이 (manifest.json). 쓸 때 배율(it.s × PROP_SCALE)을 곱한다
const GRAB = {
  trash_bin:   { r: 0.45, h: 0.95, label: "쓰레기통" },
  trash_bag_a: { r: 0.28, h: 0.62, label: "쓰레기봉투" },
  trash_bag_b: { r: 0.26, h: 0.55, label: "쓰레기봉투" },
  newspapers:  { r: 0.30, h: 0.23, label: "신문 뭉치" },
  hydrant:     { r: 0.24, h: 0.85, label: "소화전" },
  mailbox:     { r: 0.30, h: 1.25, label: "우체통" },
  bench:       { r: 0.90, h: 1.30, label: "벤치" },
  dumpster:    { r: 1.20, h: 1.45, label: "수거함" },
};
const PROP_G = 30;           // 소품 중력 (m/s²)
const MAX_BODIES = 24;       // 동시에 날아다닐 수 있는 수. 넘치면 가장 오래된 것부터 내려앉힌다
const bodies = [];
const _near = [];

function moveCell(k, i, ox, oz, nx, nz) {
  const a = cellKey(ox, oz), b = cellKey(nx, nz);
  if (a === b) return;
  const la = k.cells.get(a);
  if (la) { const j = la.indexOf(i); if (j >= 0) la.splice(j, 1); }
  if (!k.cells.has(b)) k.cells.set(b, []);
  k.cells.get(b).push(i);
}

// 조준선 근처에서 잡을 소품을 고른다. 선에서 떨어진 거리 ÷ (소품 크기 + 보정) 이 가장 작은 것.
function propPick(o, d, maxDist) {
  if (!S) return null;
  let best = null, bestScore = 1;
  const g0x = Math.floor((o.x - maxDist) / GRID), g1x = Math.floor((o.x + maxDist) / GRID);
  const g0z = Math.floor((o.z - maxDist) / GRID), g1z = Math.floor((o.z + maxDist) / GRID);
  for (const name of Object.keys(GRAB)) {
    const k = kinds[name];
    if (!k) continue;
    const G = GRAB[name];
    for (let gx = g0x; gx <= g1x; gx++) for (let gz = g0z; gz <= g1z; gz++) {
      const list = k.cells.get(gx + "," + gz);
      if (!list) continue;
      for (const i of list) {
        const it = k.items[i];
        if (it.dyn) continue;
        const sc = it.s * PROP_SCALE;
        const cx = it.x - o.x, cy = it.y + G.h * sc * 0.5 - o.y, cz = it.z - o.z;
        const t = cx * d.x + cy * d.y + cz * d.z;
        if (t < 1 || t > maxDist) continue;
        const px = cx - d.x * t, py = cy - d.y * t, pz = cz - d.z * t;
        const tol = Math.max(G.r, G.h * 0.5) * sc + 1.5 + t * 0.02;
        const score = Math.sqrt(px * px + py * py + pz * pz) / tol;
        if (score < bestScore) {
          bestScore = score;
          best = { name, i, t, label: G.label, x: it.x, y: it.y + G.h * sc * 0.5, z: it.z };
        }
      }
    }
  }
  return best;
}

function syncGroup(b) {
  b.group.position.set(b.pos.x, b.pos.y + b.H * 0.5, b.pos.z);   // 중심을 축으로 굴러야 자연스럽다
  b.group.rotation.set(b.tilt, b.yaw + kinds[b.name].cfg.yaw, 0, "YXZ");
}

function propGrab(c) {
  const k = kinds[c.name], it = k && k.items[c.i];
  if (!it || it.dyn) return null;
  while (bodies.length >= MAX_BODIES) {
    const old = bodies.find(b => b.state === "free");
    if (!old) return null;
    settleBody(old);
  }
  const G = GRAB[c.name], sc = it.s * PROP_SCALE;
  const group = new THREE.Group(), inner = new THREE.Group();
  inner.position.y = -G.h * 0.5;               // 바깥 그룹이 배율을 가지므로 모델 단위로 내린다
  for (const part of k.parts || []) {
    const m = new THREE.Mesh(part.geometry, part.material);
    m.castShadow = true; m.receiveShadow = true;
    inner.add(m);
  }
  group.add(inner);
  group.scale.setScalar(sc);
  group.name = "nyc_dyn_" + c.name;
  S.scene.add(group);
  it.dyn = true;
  k.dirty = true;
  const b = {
    name: c.name, i: c.i, it, R: G.r * sc, H: G.h * sc, label: G.label,
    pos: new THREE.Vector3(it.x, it.y, it.z), vel: new THREE.Vector3(),
    yaw: it.yaw, spin: 0, tilt: 0, tiltV: 0, state: "held", rest: 0, age: 0, group,
  };
  bodies.push(b);
  syncGroup(b);
  return b;
}

// 탭: target(플레이어 발 앞)으로 포물선을 그리며 날아와 떨어진다
function propYank(b, target) {
  const dx = target.x - b.pos.x, dz = target.z - b.pos.z;
  const T = Math.min(0.9, Math.max(0.35, Math.hypot(dx, dz) / 70));
  b.vel.set(dx / T, (target.y - b.pos.y) / T + 0.5 * PROP_G * T, dz / T);
  b.spin = (Math.random() - 0.5) * 8;
  b.tiltV = (Math.random() - 0.5) * 6;
  b.state = "free"; b.age = 0;
}
function propThrow(b, vel) {
  b.vel.copy(vel);
  b.spin = (Math.random() - 0.5) * 6;
  b.tiltV = 7 + Math.random() * 6;
  b.state = "free"; b.age = 0;
}

function settleBody(b) {
  const k = kinds[b.name], it = b.it;
  moveCell(k, b.i, it.x, it.z, b.pos.x, b.pos.z);
  it.x = b.pos.x; it.z = b.pos.z; it.yaw = b.yaw;
  it.y = S.groundAt(b.pos.x, b.pos.z, b.pos.y + b.H * 0.5);
  it.dyn = false;
  k.dirty = true;
  S.scene.remove(b.group);
  bodies.splice(bodies.indexOf(b), 1);
  b.state = "gone";
}

const wrapPi = a => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

// 건물 벽: 가장 얕게 파고든 축으로 밀어내고 튕긴다. 지붕 위에서 내려앉는 중이면 바닥(groundAt)이 받는다.
function collideBoxes(b) {
  if (!S.nearBoxes) return;
  const p = b.pos, v = b.vel, r = b.R;
  const list = S.nearBoxes(p.x, p.z, r + 2, _near);
  for (let n = 0; n < list.length; n++) {
    const o = list[n], top = o.y0 + o.h;
    if (p.y > top - 1.5 || p.y + b.H < o.y0) continue;
    const dx = p.x - o.x, dz = p.z - o.z;
    const ox = o.w / 2 + r - Math.abs(dx), oz = o.d / 2 + r - Math.abs(dz);
    if (ox <= 0 || oz <= 0) continue;
    if (ox < oz) { const sg = Math.sign(dx) || 1; p.x = o.x + sg * (o.w / 2 + r); if (v.x * sg < 0) v.x *= -0.35; }
    else         { const sg = Math.sign(dz) || 1; p.z = o.z + sg * (o.d / 2 + r); if (v.z * sg < 0) v.z *= -0.35; }
    b.spin *= -0.6;
  }
}

function stepBody(b, dt, ctx) {
  const p = b.pos, v = b.vel;
  b.age += dt;
  if (b.state === "held" && ctx) {
    // 들고 있는 동안: 손 앞 목표점으로 임계 감쇠 스프링. 감쇠는 플레이어 속도 기준이라 스윙해도 따라온다.
    const K = 70, C = 2 * Math.sqrt(K), hv = ctx.holdVel;
    v.x += ((ctx.hold.x - p.x) * K - (v.x - hv.x) * C) * dt;
    v.y += ((ctx.hold.y - b.H * 0.5 - p.y) * K - (v.y - hv.y) * C) * dt;
    v.z += ((ctx.hold.z - p.z) * K - (v.z - hv.z) * C) * dt;
    b.spin *= Math.exp(-3 * dt);
    b.tilt *= Math.exp(-4 * dt);
  } else {
    if (b.state === "held") b.state = "free";
    v.y -= PROP_G * dt;
  }
  p.addScaledVector(v, dt);
  b.yaw += b.spin * dt;
  b.tilt += b.tiltV * dt;
  collideBoxes(b);
  const gy = S.groundAt(p.x, p.z, p.y + b.H * 0.5);
  if (p.y <= gy) {
    p.y = gy;
    if (v.y < 0) v.y *= -0.28;
    if (v.y < 2.5) v.y = 0;
    const f = Math.exp(-5 * dt);
    v.x *= f; v.z *= f; b.spin *= f; b.tiltV *= f;
    b.tilt = wrapPi(b.tilt) * Math.exp(-7 * dt);   // 인스턴스로 돌아갈 때 곧게 서 있어야 한다
    if (b.state === "free" && v.lengthSq() < 2) b.rest += dt; else b.rest = 0;
  } else b.rest = 0;
}

// 매 프레임. ctx = { hold: 들고 있을 점, holdVel: 플레이어 속도 } 또는 null
function propStep(dt, ctx) {
  if (!bodies.length) return;
  const n = Math.max(1, Math.ceil(dt / (1 / 90))), h = dt / n;
  for (let s = 0; s < n; s++) for (const b of bodies) stepBody(b, h, ctx);
  for (let i = bodies.length - 1; i >= 0; i--) {
    const b = bodies[i];
    if (b.state === "free" && (b.rest > 0.5 || b.age > 15 || b.pos.y < -50)) settleBody(b);
    else syncGroup(b);
  }
}
function propBodies() { return bodies; }

// ─────────────────────────── 시작 · 매 프레임 ───────────────────────────
async function initNycProps(opts) {
  if (typeof window === "undefined") return false;     // 테스트 하네스(Node)에서는 아무것도 안 한다
  S = opts;
  const rand = mulberry32(0x5EEDC17A);
  for (const name of Object.keys(TYPES)) kinds[name] = { cfg: TYPES[name], parts: null, items: [], cells: new Map(), meshes: null };

  // 가로등 핸들을 먼저 잡는다 — 인도 배치가 가로등 자리를 피해야 한다
  if (S.lamps && S.lamps.data && S.lamps.meshes) {
    lamps = { data: S.lamps.data, meshes: S.lamps.meshes, orig: S.lamps.meshes.map(m => m.instanceMatrix.array.slice()) };
    for (const L of lamps.data) addItem("street_light", L.x, L.y, L.z, 0, 1);   // 인스턴스 개수 확보용
  }
  const stats = { ...planRooftops(rand), sidewalk: planSidewalks(rand), manholes: planManholes(rand), plazas: planPlazas(rand) };

  const Loader = S.GLTFLoader, merge = S.mergeGeometries;
  const names = Object.keys(TYPES);
  await Promise.all(names.map(async name => {
    const root = await loadGlb(Loader, name);
    if (!root) return;
    kinds[name].parts = extractParts(root, merge);
    buildMeshes(name);
    loadedCount++;
  }));
  await setupCars(Loader, merge);

  ready = true;
  rebuildT = 0;
  const summary = Object.fromEntries(names.map(n => [n, kinds[n].items.length]));
  console.log(`[NYC] 소품 ${loadedCount}/${names.length}종 로드 · 차 모델 ${cars ? Object.keys(cars.types).length : 0}종`, stats, summary);
  return true;
}

function updateNycProps(dt, px, pz) {
  if (!ready) return;
  // 잡히거나 내려앉은 소품이 있는 종류는 기다리지 않고 바로 다시 채운다 (안 그러면 0.25초 동안 두 개로 보인다)
  for (const name of Object.keys(kinds)) {
    const k = kinds[name];
    if (k.dirty) { k.dirty = false; rebuildKind(name, px, pz); }
  }
  rebuildT -= dt;
  if (rebuildT <= 0) {
    rebuildT = REBUILD_T;
    for (const name of Object.keys(kinds)) {
      if (name === "street_light") continue;
      rebuildKind(name, px, pz);
    }
    rebuildLamps(px, pz);
  }
  updateCarModels(px, pz);
}

function nycStats() {
  const o = {};
  for (const [n, k] of Object.entries(kinds)) o[n] = { items: k.items.length, drawn: k.meshes && k.meshes[0] ? k.meshes[0].count : 0, parts: k.parts ? k.parts.length : 0 };
  if (cars) o.cars = Object.fromEntries(Object.entries(cars.types).map(([t, T]) => [t, T.meshes[0].count]));
  return { ready, loaded: loadedCount, bodies: bodies.length, ...o };
}

// 디버그: 이 점에서 가장 가까운 소품 위치. 눈으로 확인할 때 카메라를 거기로 옮긴다.
function nycFind(name, x, z) {
  const k = kinds[name];
  if (!k) return null;
  let best = null, bd = Infinity;
  for (const it of k.items) {
    const d2 = (it.x - x) ** 2 + (it.z - z) ** 2;
    if (d2 < bd) { bd = d2; best = it; }
  }
  return best;
}

export { initNycProps, updateNycProps, nycStats, nycFind, TYPES, CAR_R,
  GRAB, propPick, propGrab, propYank, propThrow, propStep, propBodies };
