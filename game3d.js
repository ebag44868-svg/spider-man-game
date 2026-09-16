import * as THREE from "three";
import { GLTFLoader } from "./lib/loaders/GLTFLoader.js";
import { mergeGeometries } from "./lib/utils/BufferGeometryUtils.js";
import { RGBELoader } from "./lib/loaders/RGBELoader.js";
import {
  initCars, updateCars, cars, carBodyMesh, carTopMesh, CAR_L, CAR_W, CAR_H,
} from "./src/cars.js";
import {
  segHitsSphere, segBoxT, shortAngle, lerpAngle,
} from "./src/mathx.js";
import {
  spawnRing, updateRings, spawnImpact, initVfx, impactRings,
} from "./src/vfx.js";
import {
  makeFinger, makeHand, poseHand, initHands, makeUpperArm, linkUpperArm,
  makeFpBody, poseFpBody, makeBodyInertia,
} from "./src/fp-hands.js";
import {
  vclimbAnchor, vclimbShouldFire,
  VC_NEAR, VC_STEP, VC_OUT, VC_ARRIVE, VC_TOP, VC_CD,
} from "./src/vclimb.js";
import {
  plantCheck, plantImpulse, plantSide,
  PLANT_LOOK, PLANT_MIN_V, PLANT_TIME, PLANT_KEEP, PLANT_PUSH, PLANT_PUSH_MAX, PLANT_BOUNCE, PLANT_UP, PLANT_CD,
} from "./src/wallplant.js";
import {
  init3p, pose3p, bones3p, ready3p,
} from "./src/rig3p.js";
import { initNycProps, updateNycProps, nycStats, nycFind,
  propPick, propGrab, propYank, propThrow, propStep, propBodies } from "./src/nyc-props.js";
import { PROP_SCALE } from "./src/scale.js";
import {
  TUNE as A_TUNE, FAN_PITCH, fanYaw, intentDir, scoreAnchorV2,
} from "./src/anchor.js";
import {
  dbgOn, setDbg, dbgBegin, dbgCand, dbgPick, dbgCands, dbgPicked,
  dbgPickIdx, dbgAccepted, dbgTop, dbgLines, MAX_CAND,
} from "./src/webdbg.js";
import {
  initReach, setReach, clearReach, updateReach, getReach, applyReach, soft,
  reachDir, reachWrist, REACH_LEN,
  SHOOT_T, CATCH_T, REL_T, YAW_MAX, PITCH_MAX, YAW_OUT, YAW_IN, PITCH_UP, PITCH_DN,
} from "./src/reach.js";
import {
  makeFacadeTexture, makeGlassTexture, makeConcreteFacadeTexture, makeIndustrialTexture, makeConcreteTexture, makeWebStrandTexture, makeWebGloveTexture, setTextureRenderer,
  worldScaleUv, loadPbr, pbrSet,
} from "./src/textures.js";
// 사운드는 게임 상태를 전혀 모르는 독립 모듈이라 가장 먼저 떼어냈다. src/audio.js 참고.
import {
  initAudio, windActive, setWind,
  setAudioEnabled, sfxZoneClear, sfxMiss, sfxEnemyShot, sfxRegen, sfxDodge, sfxPerfect, sfxHurt, sfxShot, sfxHit, sfxReload, sfxBind, sfxUlt, sfxWhoosh, sfxThwip, sfxThud, sfxDash, sfxStrain,
} from "./src/audio.js";

// preserveDrawingBuffer: 개발 중 화면을 캡처해서 확인하기 위해 켜둔다
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
// 해상도 배율은 고정하지 않는다. 아래 adaptRes()가 프레임 시간에 맞춰 조절한다.
let resScale = 1;
const RES_MIN = 0.55, RES_MAX = Math.min(devicePixelRatio, 1.5);
resScale = RES_MAX;
renderer.setPixelRatio(resScale);
document.body.appendChild(renderer.domElement);
setTextureRenderer(renderer);   // 텍스처 모듈이 anisotropy 상한을 읽을 수 있게

// 게임 화면처럼 보이게 하는 3요소: 필믹 톤매핑 / 그림자 / 대기.
// 셋 다 없으면 텍스처가 아무리 좋아도 "3D 뷰어" 느낌을 못 벗어난다.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;   // Soft는 픽셀당 샘플이 훨씬 많다

const scene = new THREE.Scene();
// 지수 안개라야 거리에 따라 자연스럽게 깔린다 (원경 공기 원근)
scene.fog = new THREE.FogExp2(0xc3d6e6, 0.00034);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.1, 6000);

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const SUN_DIR = new THREE.Vector3(0.38, 0.86, 0.28).normalize();

const hemi = new THREE.HemisphereLight(0xd6e6f7, 0x7d8794, 1.05);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dc, 3.1);
sun.position.copy(SUN_DIR).multiplyScalar(600);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
// 그림자 카메라는 좁게 잡고 플레이어를 따라다니게 한다.
// 도시 전체(2688m)를 한 장에 담으면 픽셀당 1m가 넘어 그림자가 뭉개진다.
{
  const S = 240;
  const c = sun.shadow.camera;
  c.left = -S; c.right = S; c.top = S; c.bottom = -S;
  c.near = 1; c.far = 1900;
  c.updateProjectionMatrix();
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.9;
}
scene.add(sun);
scene.add(sun.target);

// --- 하늘: 지평선에서 천정으로 가는 그라디언트 + 태양 원반/글로우 ---
const skyUniforms = {
  topColor:    { value: new THREE.Color(0x3f7fc4) },
  bottomColor: { value: new THREE.Color(0xdfe9f0) },
  sunDir:      { value: SUN_DIR.clone() },
  sunColor:    { value: new THREE.Color(0xfff3d8) },
};
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyUniforms,
  vertexShader: `
    varying vec3 vDir;
    void main() {
      vDir = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 topColor, bottomColor, sunDir, sunColor;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 col = mix(bottomColor, topColor, pow(h, 0.7));
      float s = max(dot(d, normalize(sunDir)), 0.0);
      col += sunColor * pow(s, 900.0) * 4.0;    // 태양 원반
      col += sunColor * pow(s, 9.0) * 0.22;     // 주변 헤이즈
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(4200, 32, 16), skyMat);
skyMesh.frustumCulled = false;
scene.add(skyMesh);

// 하늘을 환경맵으로 구워 넣는다. 유리 파사드가 하늘을 반사해야 유리처럼 읽힌다.
// 절차적 하늘로 한 번 구워두고, HDRI 파일이 있으면 아래에서 덮어쓴다.
function bakeProceduralEnv() {
  if (!renderer.compile) return;   // 헤드리스 테스트 환경에는 실제 WebGL 컨텍스트가 없다
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  scene.environment = pmrem.fromScene(skyScene, 0.04).texture;
  pmrem.dispose();
}
bakeProceduralEnv();

// ══════════════ HDRI 하늘 슬롯 ══════════════
// assets/hdri/day.hdr 를 넣으면 하늘이 그걸로 바뀐다. 없으면 지금 셰이더 하늘 그대로.
// 야간 모드용은 night.hdr. 없으면 낮 것을 어둡게 써서 대체한다.
// 하늘만 바뀌는 게 아니라 유리 반사가 전부 같이 좋아진다.
const HDRI = { day: null, night: null, on: false };

function applyHdri(which) {
  const tex = HDRI[which] || HDRI.day;
  if (!tex || !renderer.compile) return false;
  scene.environment = tex;
  scene.background = tex;
  // 사진 하늘을 쓰면 셰이더 하늘은 가려버린다 (둘 다 그리면 겹친다)
  skyMesh.visible = false;
  HDRI.on = true;
  // 밤인데 night.hdr이 없으면 낮 것을 어둡게 눌러 쓴다
  scene.backgroundIntensity = (which === 'night' && !HDRI.night) ? 0.12 : 1;
  scene.environmentIntensity = (which === 'night' && !HDRI.night) ? 0.2 : 1;
  return true;
}

// 파일이 없으면 조용히 넘어간다 — 슬롯만 파두고 나중에 채우기 위한 구조.
function tryLoadHdri(name, key) {
  if (!renderer.compile) return;
  new RGBELoader().load(`assets/hdri/${name}.hdr`,
    (tex) => {
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const pmrem = new THREE.PMREMGenerator(renderer);
      HDRI[key] = pmrem.fromEquirectangular(tex).texture;
      pmrem.dispose();
      tex.dispose();
      console.log(`[HDRI] ${name}.hdr 적용`);
      applyHdri(night ? 'night' : 'day');
    },
    undefined,
    () => { /* 파일 없음 — 셰이더 하늘을 그대로 쓴다 */ });
}
tryLoadHdri('day', 'day');
tryLoadHdri('night', 'night');

// ===================== 도시 생성 (맨해튼 비례) =====================
// 실제 뉴욕의 느낌은 "정사각 격자"가 아니라 비대칭 격자에서 나온다.
//   애비뉴(남북) — 넓고, 서로 멀다  -> 길게 뻗은 광폭 대로
//   스트리트(동서) — 좁고, 촘촘하다 -> 짧은 간격의 골목 같은 길
// 그래서 블록이 동서로 길쭉하고, 그 긴 면에 좁은 건물들이 다닥다닥 붙는다.
// 이 비례만 맞춰도 스윙할 때 도시가 뉴욕처럼 읽힌다.
// 소품 5배·차 15배(src/scale.js)에 맞춰 도로를 넓혔다. 차 폭이 29m 라
//   애비뉴 = 인도 9m ×2 + 차도 62m (일방통행 2차선)
//   스트리트 = 인도 9m ×2 + 차도 36m (일방통행 1차선)
const AVE_SPACING = 300;   // 애비뉴 간격 (동서 방향 블록 길이)
const ST_SPACING  = 118;   // 스트리트 간격 (남북 방향 블록 폭)
const AVE_ROAD_W  = 80;    // 애비뉴 노폭 (블록 경계 사이. 인도 포함)
const ST_ROAD_W   = 54;    // 스트리트 노폭 (블록 경계 사이. 인도 포함)
const N_AVE = 10;          // 애비뉴 개수
const N_ST  = 28;          // 스트리트 개수

const BLOCK_W = AVE_SPACING - AVE_ROAD_W;   // 블록 동서 길이 220m
const BLOCK_D = ST_SPACING - ST_ROAD_W;     // 블록 남북 폭   64m

const WORLD_SIZE = Math.max(N_AVE * AVE_SPACING, N_ST * ST_SPACING);
// 공간 해시는 도시 배치와 무관한 순수 가속 구조라 따로 둔다
const CELL = 100;
const CELLS = Math.ceil(WORLD_SIZE / CELL) + 2;

// 파사드 '계열'. 게임 로직이 보는 값이다 (야간 창문 = 유리, 비상계단 = 벽돌·산업).
// 생김새 변종은 아래 FACADES에서 얼마든지 늘릴 수 있고, 계열만 맞으면 로직이 따라온다.
const FAM_BRICK = 0, FAM_GLASS = 1, FAM_CONC = 2, FAM_IND = 3;

// ══════════════ 파사드 슬롯 ══════════════
// 텍스처를 받아오면 여기에 한 줄만 추가하면 도시에 섞인다. 다른 코드는 안 건드려도 된다.
//
//   file : assets/textures/<file>_diff.jpg / _nor.jpg / _rough.jpg  (1K JPG 권장)
//   fam  : 계열. 야간에 창문이 켜지려면 FAM_GLASS, 비상계단이 붙으려면 FAM_BRICK/FAM_IND
//   tile : 텍스처 한 장이 덮는 실제 길이(m). 작을수록 무늬가 촘촘해진다
//   hue/sat/lig : 건물마다 [기준, 흔들림] 만큼 색을 흩뿌린다 (같은 텍스처도 다르게 보이게)
//
// 파일이 아직 없으면 같은 계열의 기본 텍스처로 조용히 대체된다. 넣는 순간 자동으로 바뀐다.
const FACADES = [
  { file: 'brick',    fam: FAM_BRICK, tile: 4,  rough: 1,    hue: [0.04, 0.05], sat: [0.10, 0.12], lig: [0.62, 0.16] },
  { proc: 'glass',    fam: FAM_GLASS, tile: 6,  rough: 0.18, metal: 0.35, hue: [0.53, 0.10], sat: [0.10, 0.14], lig: [0.70, 0.16] },
  { file: 'concrete', fam: FAM_CONC,  tile: 6,  rough: 1,    hue: [0.09, 0.06], sat: [0.02, 0.05], lig: [0.74, 0.16] },
  { proc: 'industrial', fam: FAM_IND, tile: 5,  rough: 0.7,  hue: [0.55, 0.08], sat: [0.04, 0.06], lig: [0.62, 0.14] },

  // ───── 여기부터 추가 (주석만 풀거나 새로 쓰면 된다) ─────
  // { file: 'facade1', fam: FAM_GLASS, tile: 6, rough: 0.25, metal: 0.30, hue: [0.55, 0.08], sat: [0.08, 0.10], lig: [0.66, 0.14] },
  // { file: 'facade2', fam: FAM_CONC,  tile: 7, rough: 0.95, hue: [0.08, 0.05], sat: [0.03, 0.05], lig: [0.70, 0.14] },
  // { file: 'facade3', fam: FAM_BRICK, tile: 4, rough: 1.0,  hue: [0.02, 0.04], sat: [0.14, 0.10], lig: [0.52, 0.14] },
];

const KIND_COUNT = FACADES.length;
const famOf = k => FACADES[k].fam;
// 계열별로 어떤 변종이 있는지 미리 모아둔다 (건물마다 무작위로 하나 고른다)
const BY_FAM = [[], [], [], []];
FACADES.forEach((f, i) => BY_FAM[f.fam].push(i));
// 계열 안에 변종이 하나도 없으면 0번으로 떨어뜨린다 (설정 실수로 도시가 비지 않게)
function pickKind(fam) {
  const list = BY_FAM[fam];
  if (!list || !list.length) return 0;
  return list[(Math.random() * list.length) | 0];
}
const KIND_DEF = FACADES;

const buildings = [];
const dummy = new THREE.Object3D();

function addBox(x, z, w, d, h, kind, y0 = 0) {
  buildings.push({ x, z, w, d, h, y0, kind });
}

// 위로 갈수록 좁아지는 계단식 마천루. 단마다 처마가 생겨 스윙하며 돌기 좋다.
function addSetbackTower(x, z, w, d, h, kind) {
  const tiers = 2 + (Math.random() * 2 | 0);
  let cw = w, cd = d, top = 0;
  for (let i = 0; i < tiers; i++) {
    const frac = i === tiers - 1 ? 1 : (0.42 + Math.random() * 0.22);
    const th = h * frac;
    addBox(x, z, cw, cd, Math.max(top + 12, th), kind);
    top = th;
    cw *= 0.62 + Math.random() * 0.12;
    cd *= 0.62 + Math.random() * 0.12;
  }
  if (Math.random() < 0.55) addBox(x, z, cw * 0.28, cd * 0.28, h * (1.06 + Math.random() * 0.22), kind);
}

// 블록 = 도로로 둘러싸인 한 덩어리. 인도와 지형 높이가 이 경계를 공유한다.
const blocks = [];
const AVE_C = (N_AVE - 1) / 2, ST_C = (N_ST - 1) / 2;
const blockIndex = (x, z) =>
  Math.round(z / ST_SPACING + ST_C) * N_AVE + Math.round(x / AVE_SPACING + AVE_C);

// ══════════════ 도시 배치 ══════════════
// 예전 배치는 바둑판 칸마다 같은 방식으로 건물 줄을 세우고 가운데로 갈수록 높이기만 했다.
// 그래서 어디를 봐도 같은 높은 벽이었고 내려앉을 옥상이 거의 없었다.
// 이제는 '동네'를 먼저 정하고, 블록마다 모양을 고른다.
//
//   동네     타워 강도(0~1). 미드타운·다운타운 두 덩어리만 높고 나머지는 저층 옥상 지대
//   블록     한 줄 · 뒷골목 낀 두 줄 · 중정 · 창고 · 광장 타워 · 공원
//   큰 광장  교차로 몇 곳은 네 귀퉁이 건물을 비워서 사거리 전체가 광장이 된다
//
// 광장·공원 자리는 plazas 에 모은다. 바닥 포장·나무·분수·벤치가 이걸 보고 깔린다.
const plazas = [];   // { x0, x1, z0, z1, kind: 'square' | 'plaza' | 'park' }

// 도심 언덕. 가우스 봉우리 중 가장 높은 값이 그 자리의 타워 강도다.
const TOWER_HUBS = [
  { x: 0,    z: 0,     r: 430, k: 1.0 },   // 미드타운 — 도시 한가운데 (회귀 테스트도 여기서 스윙한다)
  { x: 450,  z: -1150, r: 420, k: 1.0 },   // 다운타운 — 남쪽 끝
  { x: 900,  z: 1200,  r: 300, k: 0.65 },  // 북동쪽 작은 부도심
];
function towerAt(x, z) {
  let t = 0;
  for (const c of TOWER_HUBS) t = Math.max(t, c.k * Math.exp(-((x - c.x) ** 2 + (z - c.z) ** 2) / (2 * c.r * c.r)));
  return t;
}

// 큰 광장 교차로 "애비뉴 번호,스트리트 번호". 첫 번째가 시작 지점(-600, 590) 교차로다 —
// 저층 지대 한복판이지만 광장 둘레 블록은 고층으로 세우므로, 시작하자마자 탁 트인 광장과 타워 벽이 보인다.
const SQUARE_AT = new Set(["2,18", "6,5", "5,11", "7,23"]);
const SQ_CUT = 70;                                        // 광장 쪽으로 블록을 비우는 폭 (m)
const PARK_BLOCKS = new Set(["6,15", "7,15", "6,16", "7,16"]);   // 2×2 블록 공원 "애비뉴,스트리트"

function pickFam(h) {
  if (h > 300) return pickKind(Math.random() < 0.72 ? FAM_GLASS : FAM_CONC);
  if (h > 130) return pickKind(Math.random() < 0.5 ? FAM_CONC : FAM_GLASS);
  if (h < 50 && Math.random() < 0.3) return pickKind(FAM_IND);
  return pickKind(Math.random() < 0.72 ? FAM_BRICK : FAM_CONC);
}

// 타워 강도에 따른 필지 하나의 높이
function lotH(T) {
  if (T > 0.55) {                                         // 도심
    if (Math.random() < 0.2) return 60 + Math.random() * 60;   // 도심에도 중층이 섞여야 계단처럼 내려앉을 데가 생긴다
    let h = 90 + T * (110 + Math.random() * 230);
    if (Math.random() < 0.08) h *= 1.7 + Math.random() * 0.6;  // 랜드마크
    return h;
  }
  if (T > 0.25) return Math.random() < 0.15 ? 120 + Math.random() * 90 : 40 + Math.random() * 60;
  return Math.random() < 0.1 ? 55 + Math.random() * 35 : 18 + Math.random() * 26;   // 저층 옥상 지대
}

function addLot(bx, zc, w, d, h) {
  const kind = pickFam(h);
  if (h > 220 && Math.random() < 0.5) { addSetbackTower(bx, zc, w, d, h, kind); return; }
  addBox(bx, zc, w, d, h, kind);
  // 벽에서 툭 튀어나온 캔틸레버
  if (h > 130 && Math.random() < 0.16) {
    const out = 12 + Math.random() * 14;
    const y0 = h * (0.4 + Math.random() * 0.4);
    const side = Math.random() < 0.5 ? 1 : -1;
    addBox(bx, zc + side * (d / 2 + out / 2), Math.min(w, 18), out, 7 + Math.random() * 9, kind, y0);
  }
}

// 동서로 필지를 잘라 건물 줄을 세운다.
//   face   -1 = za 쪽 길에 붙인다 · 1 = zb 쪽 · 0 = 가운데
//   baseH  주면 모든 필지가 그 높이 ± jitter (중정 블록처럼 옥상이 이어져야 할 때)
//   pocket 필지 대신 작은 광장을 둘 확률
function rowLots(xa, xb, za, zb, T, o = {}) {
  const face = o.face || 0, minW = o.minW || 20, varW = o.varW || 34;
  let x = xa, prevH = o.baseH || lotH(T);
  while (x < xb - 12) {
    if (o.pocket && xb - x > 90 && Math.random() < o.pocket) {
      const pw = 30 + Math.random() * 20;
      plazas.push({ x0: x, x1: x + pw, z0: za, z1: zb, kind: "plaza" });
      x += pw;
      continue;
    }
    let w = Math.min(xb - x, minW + Math.random() * varW);
    if (xb - (x + w) < 12) w = xb - x;                    // 끝에 자투리 필지를 남기지 않는다
    let h;
    if (o.baseH) h = Math.max(14, o.baseH + (Math.random() - 0.5) * (o.jitter || 8));
    // 저층 지대는 옆 건물과 높이가 비슷해야 옥상을 이어 달릴 수 있다
    else if (T <= 0.25 && Math.random() < 0.7) h = Math.max(14, prevH + (Math.random() - 0.5) * 14);
    else h = lotH(T);
    prevH = h;
    const d = (zb - za) * (face ? 1 : 0.88 + Math.random() * 0.12);
    const zc = face < 0 ? za + d / 2 : face > 0 ? zb - d / 2 : (za + zb) / 2;
    addLot(x + w / 2, zc, w, d, h);
    x += w + 0.5;
  }
}

function genBlock(xa, xb, z0, z1, cz, T) {
  const D = z1 - z0, W = xb - xa, r = Math.random();

  // 광장 타워: 넓은 광장 가운데 타워 하나 (시그램 빌딩 · 록펠러 센터 느낌)
  const plazaTower = T > 0.55 ? r < 0.22 : T > 0.25 ? r < 0.1 : false;
  if (plazaTower && W > 150) {
    const w = 70 + Math.random() * 40, d = D * 0.78;
    const bx = xa + W * (0.35 + Math.random() * 0.3);
    const h = Math.max(T > 0.55 ? 220 : 130, lotH(T));
    addSetbackTower(bx, cz, w, d, h, pickFam(h));
    plazas.push({ x0: xa, x1: bx - w / 2 - 1, z0, z1, kind: "plaza" });
    plazas.push({ x0: bx + w / 2 + 1, x1: xb, z0, z1, kind: "plaza" });
    return;
  }
  if (T > 0.55) {                                         // 도심 타워 줄. 필지가 넓고 사이에 포켓 광장
    rowLots(xa, xb, z0, z1, T, { minW: 40, varW: 55, pocket: 0.12 });
    return;
  }

  const q = Math.random();
  if (q < 0.25) {                                         // 뒷골목 낀 두 줄
    const gap = 8 + Math.random() * 6, dd = (D - gap) / 2;
    rowLots(xa, xb, z0, z0 + dd, T, { face: -1 });
    rowLots(xa, xb, z1 - dd, z1, T, { face: 1 });
  } else if (q < 0.40) {                                  // 중정: 가장자리만 건물, 옥상이 고리처럼 이어진다
    const rd = 16 + Math.random() * 6;
    const hb = T > 0.25 ? 45 + Math.random() * 45 : 22 + Math.random() * 22;
    const ew = 24 + Math.random() * 12;
    rowLots(xa, xb, z0, z0 + rd, T, { face: -1, baseH: hb });
    rowLots(xa, xb, z1 - rd, z1, T, { face: 1, baseH: hb });
    for (const [bx, sg] of [[xa + ew / 2, -1], [xb - ew / 2, 1]]) {
      addBox(bx, cz, ew, D - rd * 2 - 1, Math.max(14, hb + (Math.random() - 0.5) * 8), pickFam(hb));
    }
  } else if (q < 0.55 && T <= 0.25) {                     // 창고: 넓고 낮은 지붕 두세 개
    const n = 2 + (Math.random() * 2 | 0), gw = W / n;
    for (let k = 0; k < n; k++) {
      const h = 14 + Math.random() * 18;
      addBox(xa + gw * (k + 0.5), cz, gw - 1, D * (0.9 + Math.random() * 0.1), h,
             pickKind(Math.random() < 0.6 ? FAM_IND : FAM_BRICK));
    }
  } else {                                                // 한 줄
    rowLots(xa, xb, z0, z1, T, { pocket: T <= 0.25 ? 0.05 : 0.06 });
  }
}

for (let ai = 0; ai < N_AVE; ai++) {
  for (let si = 0; si < N_ST; si++) {
    const cx = (ai - AVE_C) * AVE_SPACING;
    const cz = (si - ST_C) * ST_SPACING;
    const x0 = cx - BLOCK_W / 2, x1 = cx + BLOCK_W / 2;
    const z0 = cz - BLOCK_D / 2, z1 = cz + BLOCK_D / 2;
    blocks.push({ key: si * N_AVE + ai, x0, x1, z0, z1 });

    // 블록 네 귀퉁이가 닿는 교차로: 서쪽 (ai-1, si-1|si) · 동쪽 (ai, si-1|si)
    const sqW = SQUARE_AT.has(`${ai - 1},${si - 1}`) || SQUARE_AT.has(`${ai - 1},${si}`);
    const sqE = SQUARE_AT.has(`${ai},${si - 1}`) || SQUARE_AT.has(`${ai},${si}`);

    if (PARK_BLOCKS.has(`${ai},${si}`) ||
        (!sqW && !sqE && towerAt(cx, cz) < 0.45 && Math.random() < 0.05)) {
      plazas.push({ x0, x1, z0, z1, kind: "park" });
      continue;
    }
    let xa = x0, xb = x1;
    if (sqW) { plazas.push({ x0, x1: x0 + SQ_CUT, z0, z1, kind: "square" }); xa += SQ_CUT; }
    if (sqE) { plazas.push({ x0: x1 - SQ_CUT, x1, z0, z1, kind: "square" }); xb -= SQ_CUT; }
    // 광장을 둘러싼 블록은 고층으로 — 트인 자리 둘레에 벽이 서야 광장으로 읽힌다
    const T = sqW || sqE ? Math.max(0.6, towerAt(cx, cz)) : towerAt(cx, cz);
    genBlock(xa, xb, z0, z1, cz, T);
  }
}

// 공중 통로 — 같은 블록 줄에서 이웃한 건물끼리, 그리고 스트리트를 건너서
{
  const tallest = new Map();   // 블록별 가장 높은 건물
  for (const b of buildings) {
    if (b.y0 !== 0) continue;
    const k = blockIndex(b.x, b.z);
    const cur = tallest.get(k);
    if (!cur || b.h > cur.h) tallest.set(k, b);
  }
  for (const [k, a] of tallest) {
    const ai = k % N_AVE, si = (k - ai) / N_AVE;
    // 남쪽(스트리트 건너) 이웃 — 좁은 길이라 다리가 자연스럽다
    const nb = tallest.get((si + 1) * N_AVE + ai);
    if (!nb) continue;
    if (Math.random() > 0.55) continue;
    const top = Math.min(a.h, nb.h);
    if (top < 55) continue;
    const decks = top > 200 && Math.random() < 0.45 ? 2 : 1;
    for (let dk = 0; dk < decks; dk++) {
      const y0 = top * (0.3 + Math.random() * 0.5);
      const z0 = a.z + a.d / 2, z1 = nb.z - nb.d / 2;
      if (z1 - z0 < 6) continue;
      addBox((a.x + nb.x) / 2, (z0 + z1) / 2, 8 + Math.random() * 8, z1 - z0, 4.5, pickKind(FAM_CONC), y0);
    }
  }
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
boxGeo.translate(0, 0.5, 0);






// 계열별 대체 텍스처 — 새 슬롯의 파일이 아직 없을 때 이걸로 버틴다
const FAM_FALLBACK = ['brick', 'concrete', 'concrete', 'concrete'];
const PBR = {
  brick: pbrSet("brick"),
  concrete: pbrSet("concrete"),
  asphalt: pbrSet("asphalt"),
  sidewalk: pbrSet("sidewalk"),
};

// 실제 뉴욕 옥상은 검은 타르/자갈이다. 밝게 두면 햇빛에 하얗게 날아가 실루엣이 뭉개진다.
const roofMat = new THREE.MeshStandardMaterial({ color: 0x40454b, roughness: 1, envMapIntensity: 0.25 });

// 종류마다 재질 + 타일 크기 + 색조 범위를 따로 준다
// 유리 커튼월만 절차적으로 남긴다 — 창틀 격자와 불 켜진 칸은 사진 텍스처로 대체가 안 된다.
// 나머지는 Poly Haven PBR.

// 코드로 그리는 텍스처들. FACADES에서 proc: '이름' 으로 참조한다.
const PROC_TEX = {
  glass: makeGlassTexture(),
  industrial: makeIndustrialTexture(),
};

const cityMeshes = [];
{
  const byKind = Array.from({ length: KIND_COUNT }, () => []);
  for (const b of buildings) byKind[b.kind].push(b);

  const c = new THREE.Color();
  KIND_DEF.forEach((def, k) => {
    const list = byKind[k];
    if (!list.length) return;
    // file 슬롯은 PBR 3종 세트, proc 슬롯은 코드로 그린 텍스처를 쓴다
    const mat = def.file
      ? new THREE.MeshStandardMaterial({ ...pbrSet(def.file, FAM_FALLBACK[def.fam]),
          color: 0xffffff, roughness: def.rough, metalness: def.metal || 0,
          normalScale: new THREE.Vector2(1.4, 1.4), envMapIntensity: 0.75 })
      : new THREE.MeshStandardMaterial({ map: PROC_TEX[def.proc], color: 0xffffff,
          roughness: def.rough, metalness: def.metal || 0, envMapIntensity: 0.85 });
    worldScaleUv(mat, def.tile);
    const mesh = new THREE.InstancedMesh(boxGeo, [mat, mat, roofMat, roofMat, mat, mat], list.length);
    list.forEach((b, i) => {
      // h는 언제나 "박스 자체의 높이". 지면 건물은 y0=0이라 꼭대기가 그대로 h가 되고,
      // 공중 구조물은 y0 위로 h만큼 두꺼운 판이 된다. 꼭대기는 항상 y0 + h.
      dummy.position.set(b.x, b.y0, b.z);
      dummy.scale.set(b.w, b.h, b.d);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      c.setHSL(
        def.hue[0] + Math.random() * def.hue[1],
        def.sat[0] + Math.random() * def.sat[1],
        def.lig[0] + Math.random() * def.lig[1]
      );
      mesh.setColorAt(i, c);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    mesh.userData.kind = k;   // 야간 모드에서 유리만 창문을 켠다
    cityMeshes.push(mesh);
  });
}


const propList = [];
for (const b of buildings) {
  if (b.y0 !== 0 || b.h < 40) continue;   // 공중 구조물 위엔 소품을 얹지 않는다
  const n = 1 + (Math.random() * 3 | 0);
  for (let i = 0; i < n; i++) {
    if (Math.random() < 0.3) continue;
    propList.push({
      x: b.x - b.w / 2 + 4 + Math.random() * (b.w - 8),
      z: b.z - b.d / 2 + 4 + Math.random() * (b.d - 8),
      w: 2 + Math.random() * 4, d: 2 + Math.random() * 4, h: 1.5 + Math.random() * 2.5, y: b.y0 + b.h
    });
  }
  if (b.h > 100 && Math.random() < 0.6) {
    propList.push({
      x: b.x + (Math.random() - 0.5) * (b.w - 6),
      z: b.z + (Math.random() - 0.5) * (b.d - 6),
      w: 0.5, d: 0.5, h: 8 + Math.random() * 10, y: b.y0 + b.h
    });
  }
}
let waterTowerCount = 0;
let lampCount = 0;
// ===================== 옥상 물탱크 =====================
// 뉴욕 옥상의 상징. 나무통 + 원뿔 지붕 + 강철 다리.
// 스카이라인 실루엣에 이것만 얹어도 도시가 단번에 뉴욕으로 읽힌다.
{
  const towers = [];
  for (const b of buildings) {
    if (b.y0 !== 0) continue;
    // 저·중층 벽돌/콘크리트 옥상에 주로 올라간다 (초고층 유리타워엔 없다)
    if (b.h < 34 || b.h > 190) continue;
    if (famOf(b.kind) === FAM_GLASS) continue;   // 유리 타워엔 물탱크를 안 올린다
    // 이 물탱크는 원래부터 모델 물탱크보다 두 배 굵었다. 소품 배율의 절반만 키워 둘을 맞춘다.
    const TS = PROP_SCALE / 2;
    if (Math.min(b.w, b.d) < 24) continue;
    if (Math.random() > 0.42) continue;
    const r = (2.4 + Math.random() * 1.3) * TS;
    towers.push({
      x: b.x + (Math.random() - 0.5) * Math.max(0, b.w - r * 2 - 4),
      z: b.z + (Math.random() - 0.5) * Math.max(0, b.d - r * 2 - 4),
      y: b.h, r, legH: (3 + Math.random() * 2.5) * TS, tankH: (5 + Math.random() * 2.5) * TS,
    });
  }

  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4b33, roughness: 0.95 });
  const coneMat = new THREE.MeshStandardMaterial({ color: 0x4a4f57, roughness: 0.9 });
  const legMat = new THREE.MeshStandardMaterial({ color: 0x3c4148, roughness: 0.8, metalness: 0.4 });

  // 세그먼트를 12로 낮춰 나무 판자 느낌을 낸다
  const tankGeo = new THREE.CylinderGeometry(1, 1, 1, 12); tankGeo.translate(0, 0.5, 0);
  const coneGeo = new THREE.ConeGeometry(1, 1, 12);        coneGeo.translate(0, 0.5, 0);
  const legGeo = new THREE.BoxGeometry(1, 1, 1);           legGeo.translate(0, 0.5, 0);

  const tankMesh = new THREE.InstancedMesh(tankGeo, woodMat, towers.length);
  const coneMesh = new THREE.InstancedMesh(coneGeo, coneMat, towers.length);
  const legMesh = new THREE.InstancedMesh(legGeo, legMat, towers.length * 4);
  let li = 0;
  towers.forEach((t, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(t.x, t.y + t.legH, t.z);
    dummy.scale.set(t.r, t.tankH, t.r);
    dummy.updateMatrix();
    tankMesh.setMatrixAt(i, dummy.matrix);

    dummy.position.set(t.x, t.y + t.legH + t.tankH, t.z);
    dummy.scale.set(t.r * 1.14, t.r * 0.85, t.r * 1.14);
    dummy.updateMatrix();
    coneMesh.setMatrixAt(i, dummy.matrix);

    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      dummy.position.set(t.x + Math.cos(a) * t.r * 0.72, t.y, t.z + Math.sin(a) * t.r * 0.72);
      dummy.scale.set(0.32 * PROP_SCALE / 2, t.legH, 0.32 * PROP_SCALE / 2);
      dummy.updateMatrix();
      legMesh.setMatrixAt(li++, dummy.matrix);
    }
  });
  for (const m of [tankMesh, coneMesh, legMesh]) {
    m.instanceMatrix.needsUpdate = true;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
  waterTowerCount = towers.length;
}

const propMesh = new THREE.InstancedMesh(
  boxGeo,
  new THREE.MeshStandardMaterial({ color: 0x5c646d, roughness: 0.95, envMapIntensity: 0.3 }),
  propList.length
);
propList.forEach((p, i) => {
  dummy.position.set(p.x, p.y, p.z);
  dummy.scale.set(p.w, p.h, p.d);
  dummy.updateMatrix();
  propMesh.setMatrixAt(i, dummy.matrix);
});
propMesh.instanceMatrix.needsUpdate = true;
propMesh.castShadow = true;
propMesh.receiveShadow = true;
scene.add(propMesh);

// 벽면에서 튀어나온 구조물 — 거미줄을 걸 만한 표적을 도시 전체에 뿌린다.
// 층 띠(코니스)는 건물을 두르는 얇은 슬래브, 암(arm)은 벽에서 옆으로 뻗은 간판/봉.
const ledgeList = [];
for (const b of buildings) {
  if (b.y0 !== 0) continue;   // 처마는 지면에서 올라온 벽에만
  const gap = 26 + Math.random() * 16;
  for (let y = gap; y < b.h - 6; y += gap) {
    if (Math.random() < 0.4) continue;
    ledgeList.push({ x: b.x, z: b.z, w: b.w + 2.4, d: b.d + 2.4, h: 1.2, y });
  }
  const arms = Math.random() * 3 | 0;
  for (let i = 0; i < arms; i++) {
    if (b.h < 34) break;
    const y = 18 + Math.random() * (b.h - 28);
    const out = 3.5 + Math.random() * 3.5;
    const jx = (Math.random() - 0.5) * b.w * 0.66;
    const jz = (Math.random() - 0.5) * b.d * 0.66;
    switch (Math.random() * 4 | 0) {
      case 0: ledgeList.push({ x: b.x + b.w / 2 + out / 2, z: b.z + jz, w: out, d: 0.9, h: 0.9, y }); break;
      case 1: ledgeList.push({ x: b.x - b.w / 2 - out / 2, z: b.z + jz, w: out, d: 0.9, h: 0.9, y }); break;
      case 2: ledgeList.push({ x: b.x + jx, z: b.z + b.d / 2 + out / 2, w: 0.9, d: out, h: 0.9, y }); break;
      default: ledgeList.push({ x: b.x + jx, z: b.z - b.d / 2 - out / 2, w: 0.9, d: out, h: 0.9, y });
    }
  }
}
const ledgeMesh = new THREE.InstancedMesh(
  boxGeo,
  new THREE.MeshStandardMaterial({ color: 0x8f97a4, roughness: 0.9 }),
  ledgeList.length
);
ledgeList.forEach((p, i) => {
  dummy.position.set(p.x, p.y, p.z);
  dummy.scale.set(p.w, p.h, p.d);
  dummy.updateMatrix();
  ledgeMesh.setMatrixAt(i, dummy.matrix);
});
ledgeMesh.instanceMatrix.needsUpdate = true;
ledgeMesh.castShadow = true;
ledgeMesh.receiveShadow = true;
scene.add(ledgeMesh);

// ===================== 바닥: 실제 지오메트리로 구성 =====================
// 예전에는 2688m 평면 한 장에 256px 텍스처를 24번 반복해서 1m당 2.3픽셀이었다.
// 1인칭에서 바닥이 화면의 절반인데 그게 뭉개지면 다른 걸 아무리 올려도 소용이 없다.
// 이제 아스팔트는 8m 단위로 타일링하고, 인도·차선·횡단보도는 진짜 지오메트리로 만든다.
// WORLD_SIZE는 도시 생성부에서 이미 정의됨 (애비뉴/스트리트 기준)
const SIDEWALK_W = 9;      // 인도 폭. 5배 소품(쓰레기통 깊이 4.5m)이 두 줄로 들어가야 한다
const CURB_H = 0.18;       // 연석 높이 (플레이어가 실제로 올라선다)
const ASPHALT_TILE = 5;    // 아스팔트 텍스처 1장이 덮는 실제 거리(m). 작을수록 결이 또렷하다

function makeAsphaltTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#41474f";
  g.fillRect(0, 0, 512, 512);
  // 자갈 알갱이
  for (let i = 0; i < 9000; i++) {
    const v = Math.random();
    g.fillStyle = v < 0.5
      ? `rgba(0,0,0,${0.05 + Math.random() * 0.18})`
      : `rgba(255,255,255,${0.02 + Math.random() * 0.09})`;
    const s = 1 + Math.random() * 2.2;
    g.fillRect(Math.random() * 512, Math.random() * 512, s, s);
  }
  // 낡은 보수 자국
  for (let i = 0; i < 14; i++) {
    g.fillStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.07})`;
    const w = 40 + Math.random() * 150, h = 25 + Math.random() * 110;
    g.fillRect(Math.random() * 512, Math.random() * 512, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 1;
  t.repeat.set(WORLD_SIZE / ASPHALT_TILE, WORLD_SIZE / ASPHALT_TILE);
  return t;
}


const groundRepeat = WORLD_SIZE / ASPHALT_TILE;
for (const t of [PBR.asphalt.map, PBR.asphalt.normalMap, PBR.asphalt.roughnessMap]) t.repeat.set(groundRepeat, groundRepeat);
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE),
  new THREE.MeshStandardMaterial({ ...PBR.asphalt, roughness: 1, color: 0x7c8086, envMapIntensity: 0.35,
    normalScale: new THREE.Vector2(1.6, 1.6) })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.position.y = -0.02;
scene.add(ground);
// --- 인도: 블록 경계를 그대로 두른다 ---
// 블록은 생성 단계에서 이미 정의돼 있으므로 건물에서 역산하지 않는다.
// 눈에 보이는 인도와 발이 닿는 높이가 같은 데이터를 쓰게 하려는 것.
const blockBounds = new Map();
for (const bl of blocks) blockBounds.set(bl.key, bl);

const sidewalkMat = new THREE.MeshStandardMaterial({ ...PBR.sidewalk, roughness: 1,
  color: 0x9fa6ad, normalScale: new THREE.Vector2(1.5, 1.5), envMapIntensity: 0.4 });   // 누런 톤을 회색 콘크리트로 중화
worldScaleUv(sidewalkMat, 2.2);

const sidewalkMesh = new THREE.InstancedMesh(boxGeo, sidewalkMat, blocks.length);
blocks.forEach((e, i) => {
  dummy.position.set((e.x0 + e.x1) / 2, 0, (e.z0 + e.z1) / 2);
  dummy.scale.set((e.x1 - e.x0) + SIDEWALK_W * 2, CURB_H, (e.z1 - e.z0) + SIDEWALK_W * 2);
  dummy.updateMatrix();
  sidewalkMesh.setMatrixAt(i, dummy.matrix);
});
sidewalkMesh.instanceMatrix.needsUpdate = true;
sidewalkMesh.castShadow = true;
sidewalkMesh.receiveShadow = true;
scene.add(sidewalkMesh);

// --- 광장 포장 · 공원 잔디 · 나무 · 분수 ---
// 광장은 인도 위에 색이 다른 돌 포장을 한 겹 깐다. 공원은 산책로 십자로 나눈 잔디 네 칸.
// 전부 눈으로만 보이는 장식이다 (충돌 없음). 발은 인도 높이(CURB_H)를 그대로 밟는다.
let parkTreeCount = 0;
{
  dummy.rotation.set(0, 0, 0);
  const paveMat = new THREE.MeshStandardMaterial({ ...PBR.sidewalk, roughness: 0.95,
    color: 0xd9d4cc, normalScale: new THREE.Vector2(1.2, 1.2), envMapIntensity: 0.4 });
  worldScaleUv(paveMat, 5);
  const lawnMat = new THREE.MeshStandardMaterial({ color: 0x4d7236, roughness: 1, envMapIntensity: 0.3 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9c968c, roughness: 0.9 });
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x3f6f8f, roughness: 0.15, metalness: 0.2, envMapIntensity: 1 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true });

  const pave = [], lawns = [], trees = [], fountains = [];
  for (const p of plazas) {
    const cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2, W = p.x1 - p.x0, D = p.z1 - p.z0;
    if (p.kind === "park") {
      // 가장자리 6m 는 인도 포장 그대로, 가운데 십자 산책로(폭 10m)
      const qs = [[p.x0 + 6, cx - 5, p.z0 + 6, cz - 5], [cx + 5, p.x1 - 6, p.z0 + 6, cz - 5],
                  [p.x0 + 6, cx - 5, cz + 5, p.z1 - 6], [cx + 5, p.x1 - 6, cz + 5, p.z1 - 6]];
      for (const [a, b, c, d] of qs) {
        lawns.push({ x0: a, x1: b, z0: c, z1: d });
        const n = Math.round((b - a) * (d - c) / 260);
        for (let k = 0; k < n; k++) {
          trees.push({ x: a + 5 + Math.random() * (b - a - 10), z: c + 5 + Math.random() * (d - c - 10),
                       s: 0.75 + Math.random() * 0.55 });
        }
      }
      fountains.push({ x: cx, z: cz, r: 9 });
      continue;
    }
    pave.push(p);
    // 광장: 긴 변을 따라 가로수, 넓으면 가운데 분수
    for (let x = p.x0 + 12; x < p.x1 - 8; x += 26 + Math.random() * 10) {
      for (const z of [p.z0 + 7, p.z1 - 7]) {
        if (Math.random() < 0.55) trees.push({ x, z, s: 0.6 + Math.random() * 0.3 });
      }
    }
    if (W >= 60 && D >= 50 && Math.random() < 0.5) fountains.push({ x: cx, z: cz, r: 8 + Math.random() * 3 });
  }

  const add = (geo, mat, list, fn, shadow) => {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((o, i) => { dummy.rotation.set(0, 0, 0); fn(o); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); });
    m.instanceMatrix.needsUpdate = true;
    m.castShadow = !!shadow;
    m.receiveShadow = true;
    scene.add(m);
    return m;
  };
  add(boxGeo, paveMat, pave, p => { dummy.position.set((p.x0 + p.x1) / 2, CURB_H, (p.z0 + p.z1) / 2); dummy.scale.set(p.x1 - p.x0, 0.04, p.z1 - p.z0); });
  add(boxGeo, lawnMat, lawns, p => { dummy.position.set((p.x0 + p.x1) / 2, CURB_H, (p.z0 + p.z1) / 2); dummy.scale.set(p.x1 - p.x0, 0.06, p.z1 - p.z0); });

  // 나무: 기둥 + 뭉툭한 이십면체 수관. 도시가 3배 스케일이라 나무도 25~35m 로 크게.
  const trunkGeo = new THREE.CylinderGeometry(0.7, 1, 1, 6); trunkGeo.translate(0, 0.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(1, 1);
  add(trunkGeo, trunkMat, trees, t => { dummy.position.set(t.x, CURB_H, t.z); dummy.scale.set(1.1 * t.s, 10 * t.s, 1.1 * t.s); });
  const crowns = add(crownGeo, crownMat, trees, t => {
    dummy.position.set(t.x, CURB_H + 17 * t.s, t.z); dummy.rotation.set(0, t.x % 6.28, 0);
    dummy.scale.set(10 * t.s, 9 * t.s, 10 * t.s);
  }, true);
  if (crowns) {
    const c = new THREE.Color();
    trees.forEach((t, i) => crowns.setColorAt(i, c.setHSL(0.25 + Math.random() * 0.07, 0.42 + Math.random() * 0.18, 0.1 + Math.random() * 0.07)));
    crowns.instanceColor.needsUpdate = true;
  }

  // 분수: 돌 수반 + 물 + 가운데 기둥
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 24); cylGeo.translate(0, 0.5, 0);
  add(cylGeo, stoneMat, fountains, f => { dummy.position.set(f.x, CURB_H, f.z); dummy.scale.set(f.r, 1.6, f.r); });
  add(cylGeo, waterMat, fountains, f => { dummy.position.set(f.x, CURB_H + 1.2, f.z); dummy.scale.set(f.r - 0.8, 0.5, f.r - 0.8); });
  add(cylGeo, stoneMat, fountains, f => { dummy.position.set(f.x, CURB_H, f.z); dummy.scale.set(1.4, 8, 1.4); }, true);
  parkTreeCount = trees.length;
}

// --- 차선 점선 & 횡단보도 ---
// 애비뉴는 넓어 중앙선이 두 줄, 스트리트는 좁아 한 줄.
const paintMat = new THREE.MeshBasicMaterial({ color: 0xd8d4b8 });
const paint = [];
// 차가 15배라 도로 칠도 같이 굵게 한다. 4m 점선은 29m 차 밑에서 안 보인다.
const DASH_LEN = 12, DASH_GAP = 18, DASH_W = 1.0;
const HALF_X = (N_AVE * AVE_SPACING) / 2, HALF_Z = (N_ST * ST_SPACING) / 2;

// 애비뉴(남북 도로): 일방통행 2차선이라 가운데에 차선 경계 한 줄
for (let ai = 0; ai < N_AVE - 1; ai++) {
  const cx = (ai - AVE_C) * AVE_SPACING + AVE_SPACING / 2;
  for (let z = -HALF_Z; z < HALF_Z; z += DASH_LEN + DASH_GAP) {
    // 블록 옆으로만 긋고 교차로(스트리트와 만나는 곳)는 비워둔다
    if (Math.abs(((z + HALF_Z) % ST_SPACING) - ST_SPACING / 2) > BLOCK_D / 2 - 2) continue;
    paint.push({ x: cx, z, w: DASH_W, d: DASH_LEN });
  }
}
// 스트리트(동서 도로)는 1차선 일방통행이라 중앙선이 없다.

// 횡단보도: 인도 줄을 그대로 이어서 차도를 건넌다. 줄무늬는 차 진행 방향으로 길다.
const ZEBRA_W = 1.6, ZEBRA_STEP = 3.4, ZEBRA_LEN = SIDEWALK_W * 0.8;
const AVE_DRIVE = AVE_ROAD_W / 2 - SIDEWALK_W, ST_DRIVE = ST_ROAD_W / 2 - SIDEWALK_W;
for (let ai = 0; ai < N_AVE - 1; ai++) {
  for (let si = 0; si < N_ST - 1; si++) {
    const cx = (ai - AVE_C) * AVE_SPACING + AVE_SPACING / 2;
    const cz = (si - ST_C) * ST_SPACING + ST_SPACING / 2;
    for (const sg of [-1, 1]) {
      // 애비뉴를 건너는 횡단보도 (넓다)
      for (let o = -AVE_DRIVE + 2; o <= AVE_DRIVE - 2; o += ZEBRA_STEP) {
        paint.push({ x: cx + o, z: cz + sg * (ST_ROAD_W / 2 - SIDEWALK_W / 2), w: ZEBRA_W, d: ZEBRA_LEN });
      }
      // 스트리트를 건너는 횡단보도 (좁다)
      for (let o = -ST_DRIVE + 2; o <= ST_DRIVE - 2; o += ZEBRA_STEP) {
        paint.push({ x: cx + sg * (AVE_ROAD_W / 2 - SIDEWALK_W / 2), z: cz + o, w: ZEBRA_LEN, d: ZEBRA_W });
      }
    }
  }
}
// 노면에 눕는 평면. 윗면 말고는 보일 일이 없어 박스일 이유가 없다(12 -> 2 삼각형).
const flatGeo = new THREE.PlaneGeometry(1, 1);
flatGeo.rotateX(-Math.PI / 2);
const paintMesh = new THREE.InstancedMesh(flatGeo, paintMat, paint.length);
paint.forEach((p, i) => {
  dummy.position.set(p.x, 0.02, p.z);
  dummy.scale.set(p.w, 1, p.d);
  dummy.updateMatrix();
  paintMesh.setMatrixAt(i, dummy.matrix);
});
paintMesh.instanceMatrix.needsUpdate = true;
scene.add(paintMesh);

// 야간 모드에서 켜고 끄는 핸들들. 생성 블록 스코프 밖에서 잡아둔다.
let lampHeadMat = null, lampGlowMesh = null;
// 뉴욕 소품 모듈이 가까운 가로등을 모델로 바꾸려고 쓴다 (위치 + 상자 메시 3장)
let lampHandle = null;
let neonMat = null, neonGlowMesh = null, signalMat = null;
let streetDetailCount = 0;

// ===================== 가로등 =====================
// 도로변을 따라 일정 간격으로. 기둥 + 도로 쪽으로 뻗은 팔 + 램프 헤드.
{
  const poles = [], arms = [], heads = [];
  // 소품 배율만큼 키운다. 멀리 있는 이 상자 가로등이 가까이 오면 모델로 바뀌므로 크기가 같아야 한다.
  const LS = PROP_SCALE;
  const POLE_H = 9 * LS, ARM_L = 3.2 * LS, GAP = 100;
  for (const bl of blocks) {
    // 블록 네 변 중 긴 면(스트리트 쪽) 위주로 세운다
    for (let x = bl.x0 + 20; x < bl.x1 - 16; x += GAP) {
      for (const side of [-1, 1]) {
        const z = side < 0 ? bl.z0 - SIDEWALK_W + 2.5 : bl.z1 + SIDEWALK_W - 2.5;
        poles.push({ x, z, h: POLE_H, side });
        arms.push({ x, z: z + side * ARM_L / 2, y: POLE_H - 0.5 * LS, w: 0.22 * LS, d: ARM_L, dir: side });
        heads.push({ x, z: z + side * ARM_L, y: POLE_H - 0.75 * LS });
      }
    }
  }
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2f343a, roughness: 0.6, metalness: 0.5 });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x9aa2ab, roughness: 0.4, metalness: 0.4,
    emissive: 0x2a2415, emissiveIntensity: 1,   // 낮에도 램프가 죽어 보이지 않게 살짝
  });
  lampHeadMat = headMat;   // 야간 모드에서 밝기를 올린다
  const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 6); cylGeo.translate(0, 0.5, 0);

  const poleMesh = new THREE.InstancedMesh(cylGeo, poleMat, poles.length);
  poles.forEach((p, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(p.x, CURB_H, p.z);
    dummy.scale.set(0.16 * LS, p.h, 0.16 * LS);
    dummy.updateMatrix(); poleMesh.setMatrixAt(i, dummy.matrix);
  });
  const armMesh = new THREE.InstancedMesh(boxGeo, poleMat, arms.length);
  arms.forEach((a, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(a.x, a.y, a.z);
    dummy.scale.set(a.w, 0.18 * LS, a.d);
    dummy.updateMatrix(); armMesh.setMatrixAt(i, dummy.matrix);
  });
  const headMesh = new THREE.InstancedMesh(boxGeo, headMat, heads.length);
  heads.forEach((h, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(h.x, h.y, h.z);
    dummy.scale.set(0.5 * LS, 0.26 * LS, 1.1 * LS);
    dummy.updateMatrix(); headMesh.setMatrixAt(i, dummy.matrix);
  });
  for (const m of [poleMesh, armMesh, headMesh]) {
    m.instanceMatrix.needsUpdate = true;
    m.castShadow = m === poleMesh;   // 얇은 팔·헤드 그림자는 안 보이는데 비용만 든다
    scene.add(m);
  }
  // 밤에만 켜지는 빛웅덩이. 실제 광원을 3천 개 둘 수는 없으니 가산합성 판으로 흉내낸다.
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0xffca7a, transparent: true, opacity: 0.42, blending: THREE.AdditiveBlending,
    depthWrite: false, toneMapped: false,
  });
  lampGlowMesh = new THREE.InstancedMesh(boxGeo, glowMat, heads.length);
  heads.forEach((h, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(h.x, h.y - 0.6 * LS, h.z);
    dummy.scale.set(5.2 * LS, 2.2 * LS, 6.2 * LS);
    dummy.updateMatrix(); lampGlowMesh.setMatrixAt(i, dummy.matrix);
  });
  lampGlowMesh.instanceMatrix.needsUpdate = true;
  lampGlowMesh.frustumCulled = false;
  lampGlowMesh.visible = false;
  scene.add(lampGlowMesh);

  lampCount = poles.length;
  lampHandle = { data: poles.map(p => ({ x: p.x, z: p.z, y: CURB_H, side: p.side })), meshes: [poleMesh, armMesh, headMesh] };
}


// ============ 거리 디테일 (신호등 · 비상계단 · 네온 간판 · 차양) ============
// 도시가 비어 보이는 건 건물이 적어서가 아니라 사람 눈높이에 물건이 없어서다.
// 전부 인스턴싱이라 종류당 드로우콜 하나씩만 는다.
const NEON_COLORS = [0xff2d78, 0x22e0ff, 0xffd21e, 0x8b5cff, 0x2bff88, 0xff6a1e, 0xff3b3b, 0x18ffe0];
{
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 8); cyl.translate(0, 0.5, 0);
  const poles = [], bars = [], heads = [];      // 신호등
  const steps = [], rails = [];                 // 비상계단
  const signs = [], awns = [], edges = [];      // 네온 간판 · 차양 · 네온 엣지

  // --- 신호등: 교차로 대각 두 귀퉁이에 세우고 도로 위로 팔을 뻗는다 ---
  for (let ai = 0; ai < N_AVE - 1; ai++) {
    for (let si = 0; si < N_ST - 1; si++) {
      const cx = (ai - AVE_C) * AVE_SPACING + AVE_SPACING / 2;
      const cz = (si - ST_C) * ST_SPACING + ST_SPACING / 2;
      // 인도 모서리에 세운다 (예전 식은 블록 안 = 건물 속에 박혀 있었다). 소품 배율만큼 키운다.
      const S = PROP_SCALE;
      for (const sgn of [-1, 1]) {
        const px = cx + sgn * (AVE_ROAD_W / 2 - SIDEWALK_W * 0.35);
        const pz = cz + sgn * (ST_ROAD_W / 2 - SIDEWALK_W * 0.35);
        poles.push({ x: px, z: pz, h: 8.4 * S });
        bars.push({ x: px - sgn * 3.4 * S, z: pz, y: 7.9 * S, w: 6.8 * S });
        heads.push({ x: px - sgn * 6.4 * S, z: pz, y: 7.1 * S });
      }
    }
  }

  // --- 비상계단 / 네온 / 차양: 블록 밖으로 드러난 모든 벽면에 붙인다 ---
  // ±z만 쓰면 정작 스윙으로 지나는 애비뉴(±x 면이 마주 본다)가 텅 빈 채로 남는다.
  // 드러난 면 = 벽 바로 앞(2m)이 같은 블록의 다른 건물로 막혀 있지 않은 면.
  // 예전엔 블록 경계에 닿은 면만 봤다. 광장·공원·뒷골목 쪽 벽이 생기면서 그걸로는 모자라다.
  const byBlk = new Map();
  for (const o of buildings) {
    if (o.y0 !== 0) continue;
    const k = blockIndex(o.x, o.z);
    if (!byBlk.has(k)) byBlk.set(k, []);
    byBlk.get(k).push(o);
  }
  const blockedAt = (self, x, z) => (byBlk.get(blockIndex(x, z)) || []).some(o =>
    o !== self && o.h > 12 && Math.abs(x - o.x) < o.w / 2 && Math.abs(z - o.z) < o.d / 2);
  const openFace = (b, ax, sg) => {
    let open = 0;
    for (const u of [-0.35, 0, 0.35]) {
      const x = ax === "x" ? b.x + sg * (b.w / 2 + 2) : b.x + u * b.w;
      const z = ax === "x" ? b.z + u * b.d : b.z + sg * (b.d / 2 + 2);
      if (!blockedAt(b, x, z)) open++;
    }
    return open >= 2;
  };
  for (const b of buildings) {
    if (b.y0 !== 0 || b.h < 14) continue;

    // 드러난 면: 축(x/z) · 바깥 방향 · 벽면 좌표 · 그 면의 가로 길이
    const faces = [];
    if (openFace(b, "x", -1)) faces.push({ ax: "x", sg: -1, len: b.d });
    if (openFace(b, "x",  1)) faces.push({ ax: "x", sg:  1, len: b.d });
    if (openFace(b, "z", -1)) faces.push({ ax: "z", sg: -1, len: b.w });
    if (openFace(b, "z",  1)) faces.push({ ax: "z", sg:  1, len: b.w });
    if (!faces.length) continue;

    // 면 위의 한 점을 구한다. u는 면을 따라가는 좌우 오프셋, out은 벽에서 튀어나온 거리.
    const at = (f, u, out) => f.ax === "x"
      ? { x: b.x + f.sg * (b.w / 2 + out), z: b.z + u, ry: f.sg * Math.PI / 2 }
      : { x: b.x + u, z: b.z + f.sg * (b.d / 2 + out), ry: 0 };

    for (const f of faces) {
      const uHalf = Math.max(1, Math.min(f.len, 26) / 2 - 2);

      // 비상계단: 벽돌·산업 건물의 전형. 층마다 발판 + 위아래를 잇는 세로 난간.
      const fam = famOf(b.kind);
      if ((fam === FAM_BRICK || fam === FAM_IND) && b.h > 22 && Math.random() < 0.3) {
        const top = Math.min(b.h - 4, 46);
        const u = (Math.random() - 0.5) * uHalf;
        for (let y = 8; y < top; y += 5.4) {
          const p = at(f, u, 0.7), q = at(f, u, 1.35);
          steps.push({ ...p, y, w: 3.6, h: 0.14, d: 1.4 });
          rails.push({ ...q, y: y + 1.1, w: 3.6, h: 1.1, d: 0.1 });
        }
        for (const du of [-1.7, 1.7]) {
          rails.push({ ...at(f, u + du, 1.3), y: 8, w: 0.12, h: top - 8, d: 0.12 });
        }
      }

      // 네온 간판: 세로 배너와 가로 간판을 섞는다. 낮에는 칠한 판, 밤에는 광원.
      for (let i = 0, k = b.h > 60 ? 8 : 5; i < k; i++) {
        if (Math.random() > 0.75) continue;
        const vertical = Math.random() < 0.55;
        signs.push({
          ...at(f, (Math.random() - 0.5) * uHalf * 1.8, 0.6),
          y: 4.5 + Math.random() * Math.min(b.h - 9, 62),
          w: vertical ? 2.1 : 5.4 + Math.random() * 3.4,
          h: vertical ? 6 + Math.random() * 4.5 : 1.9,
          c: NEON_COLORS[(Math.random() * NEON_COLORS.length) | 0],
        });
      }

      // 차양: 1층 출입구. 도시를 사람 스케일로 읽히게 하는 가장 싼 장치.
      if (Math.random() < 0.5) {
        awns.push({
          ...at(f, (Math.random() - 0.5) * uHalf, 0.95), y: 3.6,
          c: NEON_COLORS[(Math.random() * NEON_COLORS.length) | 0],
        });
      }

      // 네온 엣지: 고층 모서리를 따라 올라가는 띠. 밤 실루엣을 만드는 건 결국 이것.
      if (b.h > 40 && Math.random() < 0.75) {
        const h = Math.min(b.h - 6, 120);
        edges.push({
          ...at(f, (Math.random() < 0.5 ? -1 : 1) * (f.len / 2 - 1.2), 0.5),
          y: 10 + Math.random() * 8, h,
          c: NEON_COLORS[(Math.random() * NEON_COLORS.length) | 0],
        });
      }
    }
  }

  const darkMetal = new THREE.MeshStandardMaterial({ color: 0x24282e, roughness: 0.55, metalness: 0.6 });
  const feMat = new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: 0.8, metalness: 0.5 });
  signalMat = new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.5, metalness: 0.4,
    emissive: 0x220800, emissiveIntensity: 1 });
  // 간판은 조명을 안 받는 판. 낮엔 color를 낮춰 칠한 판, 밤엔 1.0으로 올려 광원이 된다.
  neonMat = new THREE.MeshBasicMaterial({ color: 0x8a8a8a, toneMapped: false, side: THREE.DoubleSide });
  // 벽면 판이라 평면 하나면 된다. 박스로 그리면 삼각형이 6배가 된다.
  const panelGeo = new THREE.PlaneGeometry(1, 1);
  const awnMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });

  function inst(geo, mat, list, fn, shadow) {
    if (!list.length) return null;
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((o, i) => {
      dummy.rotation.set(0, 0, 0); dummy.scale.set(1, 1, 1);
      fn(o); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.castShadow = !!shadow;
    m.frustumCulled = false;
    scene.add(m);
    return m;
  }

  const PS = PROP_SCALE;
  inst(cyl, darkMetal, poles, p => { dummy.position.set(p.x, CURB_H, p.z); dummy.scale.set(0.14 * PS, p.h, 0.14 * PS); }, true);
  inst(boxGeo, darkMetal, bars, b => { dummy.position.set(b.x, b.y, b.z); dummy.scale.set(b.w, 0.16 * PS, 0.22 * PS); }, false);
  inst(boxGeo, signalMat, heads, h => { dummy.position.set(h.x, h.y, h.z); dummy.scale.set(0.5 * PS, 1.5 * PS, 0.42 * PS); }, false);
  inst(boxGeo, feMat, steps, o => { dummy.position.set(o.x, o.y, o.z); dummy.scale.set(o.w, o.h, o.d); }, false);
  inst(boxGeo, feMat, rails, o => { dummy.position.set(o.x, o.y, o.z); dummy.scale.set(o.w, o.h, o.d); }, false);

  const col = new THREE.Color();
  const signMesh = inst(panelGeo, neonMat, signs, o => {
    dummy.position.set(o.x, o.y, o.z); dummy.rotation.y = o.ry; dummy.scale.set(o.w, o.h, 1);
  }, false);
  if (signMesh) signs.forEach((o, i) => signMesh.setColorAt(i, col.setHex(o.c)));

  // 모서리를 타고 올라가는 네온 띠 (간판과 같은 재질을 공유해 낮/밤이 함께 바뀐다)
  const edgeMesh = inst(panelGeo, neonMat, edges, o => {
    dummy.position.set(o.x, o.y, o.z); dummy.rotation.y = o.ry; dummy.scale.set(0.55, o.h, 1);
  }, false);
  if (edgeMesh) edges.forEach((o, i) => edgeMesh.setColorAt(i, col.setHex(o.c)));

  // 간판·엣지 뒤에 덧대는 가산합성 헤일로. 후처리 블룸 없이 네온의 번짐을 흉내낸다.
  const neonGlowMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4,
    blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const halo = signs.concat(edges.map(e => ({ ...e, w: 0.55 })));
  neonGlowMesh = inst(panelGeo, neonGlowMat, halo, o => {
    dummy.position.set(o.x, o.y, o.z); dummy.rotation.y = o.ry;
    dummy.scale.set(o.w + 1.8, o.h + 1.8, 1);
  }, false);
  if (neonGlowMesh) {
    halo.forEach((o, i) => neonGlowMesh.setColorAt(i, col.setHex(o.c)));
    neonGlowMesh.visible = false;
  }

  const awnMesh = inst(boxGeo, awnMat, awns, o => {
    dummy.position.set(o.x, o.y, o.z); dummy.rotation.set(0.32, o.ry, 0);
    dummy.scale.set(4.4, 0.16, 1.9);
  }, false);
  if (awnMesh) awns.forEach((o, i) => awnMesh.setColorAt(i, col.setHex(o.c).multiplyScalar(0.75)));

  streetDetailCount = poles.length + steps.length + signs.length + edges.length + awns.length;
}

// ============ 야간 모드 (+ 키) ============
// 밤은 "어둡게 만드는" 게 아니라 "빛의 출처를 바꾸는" 작업이다.
// 태양을 끄는 대신 창문·네온·가로등을 켜서 도시 자체를 광원으로 만든다.
let night = false;
function setNight(on) {
  night = on;
  skyUniforms.topColor.value.setHex(on ? 0x090d24 : 0x3f7fc4);
  skyUniforms.bottomColor.value.setHex(on ? 0x3d2050 : 0xdfe9f0);
  skyUniforms.sunColor.value.setHex(on ? 0x2b3a7a : 0xfff3d8);   // 태양 원반이 달로
  scene.fog.color.setHex(on ? 0x1a1030 : 0xc3d6e6);
  scene.fog.density = on ? 0.00040 : 0.00034;
  // 도시 반사광 몫. 여기를 너무 낮추면 사이버펑크가 아니라 그냥 검은 화면이 된다.
  hemi.color.setHex(on ? 0x4b5fb0 : 0xd6e6f7);
  hemi.groundColor.setHex(on ? 0x6b3a72 : 0x7d8794);
  hemi.intensity = on ? 1.15 : 1.05;
  sun.color.setHex(on ? 0xaebdff : 0xfff2dc);   // 달빛
  sun.intensity = on ? 0.55 : 3.1;
  renderer.toneMappingExposure = on ? 1.32 : 1.08;

  for (const m of cityMeshes) {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    if (famOf(m.userData.kind) === FAM_GLASS) {
      // 유리 텍스처에 이미 불 켜진 칸이 그려져 있으니 그대로 emissiveMap으로 쓴다
      mat.emissiveMap = on ? mat.map : null;
      mat.emissive.setHex(on ? 0xffd9a0 : 0x000000);
      mat.emissiveIntensity = on ? 0.85 : 0;
    } else {
      mat.emissive.setHex(on ? 0x1b1024 : 0x000000);
      mat.emissiveIntensity = 1;
    }
    mat.needsUpdate = true;
  }
  if (neonMat) neonMat.color.setScalar(on ? 1 : 0.52);
  paintMat.color.setHex(on ? 0x9d9a86 : 0xd8d4b8);
  if (neonGlowMesh) neonGlowMesh.visible = on;
  if (signalMat) { signalMat.emissive.setHex(on ? 0xff5a1e : 0x220800); signalMat.emissiveIntensity = on ? 2.4 : 1; }
  if (lampHeadMat) { lampHeadMat.emissive.setHex(on ? 0xffd79a : 0x2a2415); lampHeadMat.emissiveIntensity = on ? 3.2 : 1; }
  if (lampGlowMesh) lampGlowMesh.visible = on;
  // HDRI를 쓰는 중이면 하늘도 같이 갈아끼운다
  if (HDRI.on || HDRI.day || HDRI.night) applyHdri(on ? 'night' : 'day');
  camMsg = 1.6;
}

// ===================== 자동차 =====================
// 실제 구현은 src/cars.js 로 옮겼다. 여기서 부르는 이유는 생성 순서 때문이다 —
// 그쪽 파일 머리말 참고.
initCars(scene, boxGeo, dummy, { N_AVE, N_ST, AVE_SPACING, ST_SPACING, AVE_C, ST_C });

const WORLD_HALF = (CELLS * CELL) / 2;

// ---------------------------------------------------------------------------
// 공간 인덱스: 건물 576개 전수 검사 -> 격자 조회
// ---------------------------------------------------------------------------
const GRID_N = CELLS;
const grid = [];
for (let i = 0; i < GRID_N * GRID_N; i++) grid.push([]);
for (const b of buildings) {
  const x0 = Math.max(0, Math.floor((b.x - b.w / 2 + WORLD_HALF) / CELL));
  const x1 = Math.min(GRID_N - 1, Math.floor((b.x + b.w / 2 + WORLD_HALF) / CELL));
  const z0 = Math.max(0, Math.floor((b.z - b.d / 2 + WORLD_HALF) / CELL));
  const z1 = Math.min(GRID_N - 1, Math.floor((b.z + b.d / 2 + WORLD_HALF) / CELL));
  for (let gz = z0; gz <= z1; gz++) {
    for (let gx = x0; gx <= x1; gx++) grid[gz * GRID_N + gx].push(b);
  }
}
let gstamp = 0;
const _nbG = [], _nbI = [], _nbA = [], _nbS = [], _nbC = [], _nbP = [];
function nearbyBuildings(x, z, radius, out) {
  out.length = 0;
  gstamp++;
  const g0x = Math.max(0, Math.floor((x - radius + WORLD_HALF) / CELL));
  const g1x = Math.min(GRID_N - 1, Math.floor((x + radius + WORLD_HALF) / CELL));
  const g0z = Math.max(0, Math.floor((z - radius + WORLD_HALF) / CELL));
  const g1z = Math.min(GRID_N - 1, Math.floor((z + radius + WORLD_HALF) / CELL));
  for (let gz = g0z; gz <= g1z; gz++) {
    for (let gx = g0x; gx <= g1x; gx++) {
      const cell = grid[gz * GRID_N + gx];
      for (let i = 0; i < cell.length; i++) {
        const b = cell[i];
        if (b._s !== gstamp) { b._s = gstamp; out.push(b); }
      }
    }
  }
  return out;
}

// 현재 미사용. 장애물/적 배치 시 겹침 검사용으로 남겨둔다.
function insideBuilding(x, y, z, pad, except) {
  const list = nearbyBuildings(x, z, pad + 2, _nbI);
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (b === except) continue;
    if (y < b.h + pad &&
        x > b.x - b.w / 2 - pad && x < b.x + b.w / 2 + pad &&
        z > b.z - b.d / 2 - pad && z < b.z + b.d / 2 + pad) return true;
  }
  return false;
}

const player = {
  pos: new THREE.Vector3(-CELL * 6, 0, CELL * 6),
  vel: new THREE.Vector3(),
  r: 0.9,
  grounded: true,
  prevPos: new THREE.Vector3(),   // 직전 물리 스텝 위치
  renderPos: new THREE.Vector3()  // 렌더 시각에 보간된 위치
};
player.prevPos.copy(player.pos);
player.renderPos.copy(player.pos);
let web = null;

const spiderGroup = new THREE.Group();
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.6 });
const headMat = new THREE.MeshStandardMaterial({ color: 0xe11d2e, roughness: 0.5 });
const headMat2 = headMat;      // 캐릭터 색을 바꿀 때 쓰는 이름 (가로등 headMat과 구분)
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.1, 6, 12), bodyMat);
body.position.y = 1.1;
spiderGroup.add(body);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), headMat);
head.position.y = 2.15;
spiderGroup.add(head);
scene.add(spiderGroup);
// 3인칭 캐릭터 크기. 도시·차·소품이 다 커진 데 비해 캐릭터가 점처럼 보여서 키워 그린다.
// 그림만 커진다 — 충돌 반경(player.r)과 1인칭 시점 높이는 그대로다.
const HERO_3P_SCALE = 2.4;     // 1.7 에서 다시 1.4배
spiderGroup.scale.setScalar(HERO_3P_SCALE);

// --- 3인칭 캐릭터 모델 교체 시스템 ------------------------------------
// assets/models/player/HeroPlaceholder.glb 를 시도해서 불러온다.
// 없으면(개발 초기) 위의 캡슐+구 임시 모델을 그대로 쓴다 — 모델 부재가 개발을 막지 않는다.
// 나중에 MakeHuman→Mixamo→Blender로 만든 진짜 캐릭터로 같은 파일명만 교체하면 끝.
const CLIP_NAMES = ["Idle", "Run", "Sprint", "Jump", "Fall", "Land", "Swing", "WallRun", "WallHang"];
const HERO_HEIGHT = 2.7;              // 화면에서 보이는 캐릭터 키(m)
// 이동 애니메이션은 제자리여야 한다. Mixamo에서 "In Place" 없이 받으면 힙이 앞으로
// 쭉 이동했다가 루프 시작점으로 순간이동해서 매 사이클 툭툭 끊겨 보인다.
// 위치는 물리가 담당하므로 힙의 수평 이동(X/Z)만 0으로 고정하고 상하 바운스(Y)는 남긴다.
function stripRootMotion(clip) {
  const t = clip.tracks.find(tr => /Hips\.position$/.test(tr.name));
  if (!t) return clip;
  const v = t.values;
  for (let i = 0; i < v.length; i += 3) { v[i] = v[0]; v[i + 2] = v[2]; }
  return clip;
}
let heroMixer = null;
let heroActions = {};   // { Idle: AnimationAction, ... }
let heroCurrentClip = null;
let heroRoot = null;    // GLTF 씬 루트 (spiderGroup 아래 붙는다)

function crossfadeTo(name, dur = 0.25) {
  if (!heroMixer || heroCurrentClip === name) return;
  const next = heroActions[name];
  if (!next) return;   // 그 이름의 클립이 glb에 없으면 조용히 무시 (에러로 게임을 막지 않는다)
  const prev = heroActions[heroCurrentClip];
  next.reset().fadeIn(dur).play();
  if (prev) prev.fadeOut(dur);
  heroCurrentClip = name;
}

// 클립별로 따로 받은 애니메이션 전용 glb (메시 없이 mixamorig 스켈레톤+애니메이션만).
// 같은 X Bot 리그에서 뽑은 거라 본 이름이 동일해서, AnimationMixer가 이름으로 트랙을 찾아
// 그대로 재생할 수 있다 — 노드 그래프를 합칠 필요가 없다.
const ANIM_ONLY_FILES = {
  Run: "assets/models/player/anims/Run.glb",
  Sprint: "assets/models/player/anims/Sprint.glb",
  Jump: "assets/models/player/anims/Jump.glb",
  Fall: "assets/models/player/anims/Fall.glb",
  Land: "assets/models/player/anims/Land.glb",
  WallRun: "assets/models/player/anims/WallRun.glb",
  WallHang: "assets/models/player/anims/WallHang.glb",
  Swing: "assets/models/player/anims/Swing.glb",
  // --- 근접 격투 (아직 안 받은 파일은 조용히 무시되고 기존 절차적 동작으로 돌아간다) ---
  Punch:   "assets/models/player/anims/Punch.glb",     // 약공격
  Heavy:   "assets/models/player/anims/Heavy.glb",     // 차징 강공격
  Parry:   "assets/models/player/anims/Parry.glb",     // 쳐내기
  Roll:    "assets/models/player/anims/Roll.glb",      // 구르기
  Takedown:"assets/models/player/anims/Takedown.glb",  // 처형
};
// 한 번만 재생하고 마지막 포즈로 멈춰야 자연스러운 클립들.
// (스윙은 "한 번 크게 휘두르는" 동작이라 루프시키면 계속 되감기는 것처럼 보인다)
const CLIP_ONCE = new Set(["Swing", "Land", "Punch", "Heavy", "Parry", "Roll", "Takedown"]);

new GLTFLoader().load(
  "assets/models/player/HeroPlaceholder.glb",
  (gltf) => {
    heroRoot = gltf.scene;
    // 임시 캡슐 모델은 숨기고 로드된 모델로 교체 (완전히 지우지 않는 건 롤백 편의를 위해)
    body.visible = false;
    head.visible = false;

    // FBX 단위(cm/m)에 상관없이 항상 같은 키가 되도록 실측해서 맞춘다
    const bb = new THREE.Box3().setFromObject(heroRoot);
    const h = bb.max.y - bb.min.y;
    if (h > 0.01) heroRoot.scale.setScalar(HERO_HEIGHT / h);
    spiderGroup.add(heroRoot);

    heroMixer = new THREE.AnimationMixer(heroRoot);
    for (const clip of gltf.animations) {
      if (CLIP_NAMES.includes(clip.name)) {
        heroActions[clip.name] = heroMixer.clipAction(stripRootMotion(clip));
      }
    }

    // 나머지 클립은 별도 glb에서 하나씩 불러와 같은 mixer에 등록한다.
    for (const [name, path] of Object.entries(ANIM_ONLY_FILES)) {
      if (heroActions[name]) continue;   // 혹시 기본 glb에 이미 있으면 건너뜀
      new GLTFLoader().load(
        path,
        (animGltf) => {
          const clip = animGltf.animations[0];
          if (!clip) return;
          clip.name = name;
          const act = heroMixer.clipAction(stripRootMotion(clip));
          if (CLIP_ONCE.has(name)) {
            act.setLoop(THREE.LoopOnce, 1);
            act.clampWhenFinished = true;   // 끝난 뒤 T포즈로 튀지 않고 마지막 자세를 유지
          }
          heroActions[name] = act;
        },
        undefined,
        () => { /* 아직 이 상태 애니메이션을 안 받은 것 — 조용히 무시 */ }
      );
    }

    if (heroActions.Idle) { heroActions.Idle.play(); heroCurrentClip = "Idle"; }
  },
  undefined,
  () => {
    // 404 등 — 아직 모델을 안 넣은 상태. 정상. 캡슐 임시 모델로 계속 진행한다.
  }
);

// ================== 적 · 공격 · 타격감 ==================
const ENEMY_HIT_R = 4.3;       // 적 명중 판정 반경 (체격을 키운 만큼 함께)
const PLAYER_HIT_R = 1.5;      // 플레이어 피격 반경 (적 탄이 여기 닿으면 피해)       // 명중 판정 반경 (적을 키운 만큼 함께 확대)
const ATTACK_CD = 0.12;        // 연사 방지 (클릭 한 번 = 한 발이라 실사용 상한)
const PROJ_SPEED = 320;        // 총알처럼 빠르게
const PROJ_RANGE = 900;        // 조준선이 하늘을 향할 때 쓸 기준 사거리
const PROJ_LIFE = 2.6;         // 320 * 2.6 = 약 830m 사거리

const projectiles = [];
const particles = [];

// ================== 캐릭터 ==================
// 한 캐릭터에 세 모드가 다 들어 있으니 조작이 너무 많다는 얘기가 나왔다.
// 특화를 나눠서 한 캐릭터당 손에 쥐는 게 줄어들게 한다.
//
// 전원 공통: 웹스윙 · 기본 주먹(X) · 기본 거미줄 발사
// 캐릭터별: TAB으로 들어가는 특화 모드가 하나씩 (스윙어는 아예 없다 — 제일 단순)
//
// 새 물리도 새 AI도 없다. "쓸 수 있는 모드 + 배율" 표일 뿐이다.
// 나중에 캐릭터별 고유 기능이 붙을 자리도 여기다.
const HEROES = [
  { id: 'swinger', name: '스윙어', tag: '웹스윙 특화', color: '#7dffa0', clip: 'Swing',
    body: '#14532d', head: '#7dffa0',
    mode: null,                       // TAB 없음. 오직 웹스윙
    spd: 1.15, hp: 0.85,
    skills: [
      ['이동', '가장 빠르다. 걷기·스윙 모두 15% 빠름'],
      ['전투', '기본 주먹과 기본 거미줄만. 대신 손이 제일 단순하다'],
      ['체력', '가장 얇다 (212). 맞기 전에 빠져나가는 캐릭터'],
      ['추천', '처음 잡는 사람 / 도시를 날아다니고 싶은 사람'],
    ] },
  { id: 'shooter', name: '웹슈터', tag: '거미줄 격투 특화', color: '#ffd24a', clip: 'Punch',
    body: '#1d4ed8', head: '#e11d2e',
    mode: 'attack',                   // TAB = 웹스윙 <-> 거미줄 격투
    spd: 1.0, hp: 1.0,
    skills: [
      ['특화', 'TAB으로 거미줄 격투. 조준 사격 · 속박(E) · 잡기(F) · 끌어오기(R)'],
      ['거리', '멀리서 정리한다. 붙기 전에 묶고 끌어당긴다'],
      ['체력', '보통 (250)'],
      ['추천', '거리를 재며 싸우는 걸 좋아하는 사람'],
    ] },
  { id: 'fighter', name: '파이터', tag: '근접 격투 특화', color: '#ff9a6a', clip: 'Heavy',
    body: '#3f1420', head: '#ff9a6a',
    mode: 'melee',                    // TAB = 웹스윙 <-> 근접 격투
    spd: 0.95, hp: 1.2,
    skills: [
      ['특화', 'TAB으로 근접 격투. 콤보 갈래 · 쳐내기(E) · 구르기 · 처형'],
      ['콤보', '약약강으로 띄우고 공중에서 이어친다'],
      ['체력', '가장 두껍다 (300). 맞아가며 파고드는 캐릭터'],
      ['추천', '소울류 손맛을 좋아하는 사람'],
    ] },
];
let hero = HEROES[2];          // 기본은 파이터 (지금까지의 조작과 가장 가깝다)
const HP_BASE = 10;            // 칸. 캐릭터 배율을 곱해 MAX_HP가 정해진다
const SPD_BASE = 19;

// 캐릭터를 적용한다. 모드 배치와 배율만 바꾼다.
function applyHero(h) {
  hero = h;
  rig3pOn = false;                // 모델이 바뀌면 뼈를 다시 찾는다
  MOVE_SPEED = SPD_BASE * h.spd;
  // 외형. 모델이 아직 하나뿐이라 색으로라도 갈라야 고른 게 보인다.
  // 나중에 캐릭터별 모델을 씌우면 이 줄이 그 자리를 대신한다.
  if (bodyMat) bodyMat.color.setStyle(h.body);
  if (headMat2) headMat2.color.setStyle(h.head);
  document.body.classList.toggle("hero-swinger", h.id === "swinger");
  document.body.classList.toggle("hero-shooter", h.id === "shooter");
  document.body.classList.toggle("hero-fighter", h.id === "fighter");
  // 이 캐릭터가 못 쓰는 모드에 들어가 있으면 웹스윙으로 되돌린다
}

let attackCd = 0;
// 탄창: 공격 모드에서만 소모. 비면 자동 재장전
// (지금은 손이 화면 밖으로 내려갔다 올라오는 정도. 나중에 카트리지 교체 모션으로 구체화)
const MAG_SIZE = 80;
const RELOAD_TIME = 1.6;
let ammo = MAG_SIZE;
let reloadT = 0;          // 남은 재장전 시간, 0이면 장전 완료
let shake = 0;
let hitMark = 0;        // 조준점 히트마커
let hitKill = false;    // 이번 히트마커가 처치인지 (빨간 X)
let lockSettle = false; // 포인터 락 직후 첫 mousemove를 버리기 위한 플래그
// --- 콤보 보상 ---
// 지금까지 combo는 화면에 숫자만 떴다. 아무 효과가 없어서 이어칠 이유가 없었다.
// 단계가 오를수록 타격이 무거워지고 궁극기가 빨리 찬다.
const COMBO_STOP  = [1, 1.25, 1.5, 1.8];    // 히트스톱 배율 (단계 0~3)
const COMBO_ULT   = [1, 1.4, 1.9, 2.6];     // 궁극기 충전 배율
const COMBO_ULT_HIT = 0.006;                // 한 대당 기본 충전량. 죽여야만 차던 걸 바꾼다

// 멀리서도 눈에 띄어야 한다. 기본 체격을 키우고 판정 반경도 같이 올린다.
const E_SCALE = 1.4;
const enemyBodyGeo = new THREE.CapsuleGeometry(1.15 * E_SCALE, 2.5 * E_SCALE, 6, 12);
const enemyHeadGeo = new THREE.SphereGeometry(0.86 * E_SCALE, 10, 8);
// 예광탄: +Y 축으로 길게 뻗은 실린더. 발사할 때 진행 방향으로 눕힌다.
const projGeo = new THREE.CylinderGeometry(0.28, 0.28, 5.2, 8);
const projMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const partGeo = new THREE.SphereGeometry(0.15, 5, 4);
const partMat = new THREE.MeshBasicMaterial({ color: 0xffffff });

// 몸통과 머리를 미리 하나로 합쳐 둔다. 적 한 명 = 드로우콜 하나.
const enemyGeo = (() => {
  const b = enemyBodyGeo.clone(); b.translate(0, 2.4 * E_SCALE, 0);
  const h = enemyHeadGeo.clone(); h.translate(0, 4.5 * E_SCALE, 0);
  return mergeGeometries([b, h], false) || b;
})();


// ================== 적 AI · 적의 공격 · 플레이어 피격 ==================
// 종류별 성격표. 여기 숫자만 만지면 적 성향이 바뀐다.

const E_SIGHT   = 150;   // (기본값 — 실제로는 종류별 sight를 쓴다)
const E_RANGE   = 130;   // 사격 사거리
const E_AIM     = 0.95;  // 조준(예고) 시간 — 피할 시간을 주는 구간
const E_CD      = 2.2;   // 재사격 간격
const E_SPD     = 320;   // 적 탄속 (플레이어 탄 320보다 훨씬 느리게 두면 피할 수 있다)
const E_PROJ_V  = 117;   // 적 탄속
const E_LIFE    = 3.0;
const E_LEAD    = 0.55;  // 예측 사격 정도. 1이면 완벽히 리드해서 회피가 불가능해진다
const E_DMG     = 1;
const E_PATROL  = 5.5;   // 순찰 이동 속도
const E_ACTIVE  = 260;   // 이 밖의 적은 AI를 돌리지 않는다
const E_VISIBLE = 420;   // 이 밖의 적은 그리지 않는다 (적 1명 = 드로우콜 2개)

const eProjGeo = new THREE.SphereGeometry(0.85, 10, 8);
const eProjMat = new THREE.MeshBasicMaterial({ color: 0xff8a2b, toneMapped: false });

// 조준 예고선. 적마다 메시를 두면 256개가 되니 몇 개만 만들어 돌려 쓴다.
const beamGeo = new THREE.CylinderGeometry(0.055, 0.055, 1, 5);
beamGeo.translate(0, 0.5, 0);            // 원점에서 +Y로 뻗도록
const beamPool = [];
for (let i = 0; i < 10; i++) {
  const m = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({
    color: 0xff3b2b, transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false }));
  m.visible = false;
  m.frustumCulled = false;
  scene.add(m);
  beamPool.push(m);
}

// --- 플레이어 체력 ---
// 체력은 '칸'으로 센다. 화면에는 칸 x 25로 표시한다 (10칸 = 250).
// 8칸(200)이었을 때는 사수 한 발이 25, 저격수가 50이라 순식간에 녹았다.
// 칸은 정수가 아니어도 된다 — 낙하 피해처럼 작은 피해를 주려면 소수가 필요하다.
let hurtFx = 0;      // 화면 붉은 플래시 잔량
let invuln = 0;      // 연타로 순삭당하지 않게 하는 무적 시간
// --- 스태미나 ---
// 스태미나 1.5배. 총량만 늘리면 회복도 1.5배 느려져서 "늘었는데 답답한"
// 상태가 된다. 회복 속도와 재개 문턱을 같은 비율로 올려서
// **스윙은 1.5배 길어지고 회복에 걸리는 시간은 그대로**가 되게 맞췄다.
const MAX_STAM   = 150;  // 100 -> 150
const STAM_SWING = 9;    // 스윙 중 초당 소모 (그대로 — 총량이 늘어 지속이 1.5배)
const STAM_GND   = 82;   // 발을 붙이고 있을 때 초당 회복 (55 * 1.5)
const STAM_AIR   = 16;   // 공중에서 줄을 놓고 있을 때 (11 * 1.5)
const STAM_MIN   = 22;   // 바닥나면 이만큼 찰 때까지 다시 못 건다 (15 * 1.5)
let stamFx = 0;          // 바닥났을 때 UI를 붉게 번쩍이는 잔량

const REGEN_DELAY = 5.5;   // 마지막 피격 후 이만큼 안 맞아야 회복 시작
const REGEN_TIME  = 1.4;   // 한 칸 차오르는 데 걸리는 시간
let regenWait = 0;         // 회복 시작까지 남은 시간
let regenT = 0;            // 현재 칸의 진행도 (0..REGEN_TIME)



const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();


// 적 눈높이에서 플레이어까지 막힌 게 없는가.
// 탄 충돌과 같은 공간 해시라 싸다. 조준 시작·발사 순간에만 부르면 부담이 없다.
const _losA = new THREE.Vector3(), _losB = new THREE.Vector3(), _losH = new THREE.Vector3();

// --- 격투병의 공격 패턴 ---
// 소울류가 성립하는 최소 조건: 예고를 보고 "막을 것인가 구를 것인가"를 고르게 하는 것.
// 그래서 패턴은 색으로 갈린다 — 파랗게 달아오르면 쳐낼 수 있고, 붉으면 무조건 피해야 한다.
const BRAWL_HOLD = 0.22;   // 지연 패턴이 판정 직전에 멈춰 있는 시간
// --- 공중 / 다운 ---
// 적은 이미 세로 물리를 갖고 있다 (knock.y · 중력 -46 · 지면 스냅).
// 없던 것은 상태뿐이라, 지금까지는 띄워놔도 공중에서 걸어다니고 공격했다.
const AIR_MAX   = 4.0;   // 아무리 띄워도 이 시간을 넘겨 떠 있지 않는다 (안전장치)
const AIR_HITS  = 4;     // 공중에서 이만큼 띄우면 더는 안 뜬다 (무한 저글링 방지)
const AIR_FALL  = 0.62;  // 연달아 띄울 때마다 높이가 이 비율로 줄어든다
const DOWN_TIME = 0.9;   // 착지 후 못 일어나는 시간

// --- 공중 콤보 ---
// 띄워놓고 올려다보기만 하면 띄우는 의미가 없다. 플레이어도 같이 떠서 이어친다.
// 새 물리를 만들지 않는다 — 이미 있는 hoverT(약한 중력 G*0.16 + 낙하속도 -7 제한)를
// 그대로 쓴다. update()의 고정 timestep과 웹스윙에는 손대지 않는다.
// 근접 모드에서만 일어나는 일이라 스윙 상태와 겹칠 수도 없다.
const AIR_RISE  = 26;    // 띄우는 순간 플레이어가 같이 솟는 속도 (M_LAUNCH.launch와 같게)
const AIR_HOVER = 2.6;   // 띄운 뒤 떠 있는 시간 (적이 공중에 있는 시간과 맞췄다)
const AIR_KEEP  = 1.1;   // 공중의 적을 맞힐 때마다 다시 채우는 체공 시간
const AIR_LIFT  = 4;     // 공중에서 맞힐 때 살짝 따라 올라간다 (적의 AIR_HOLD와 같게)
// 공중 콤보 중 플레이어에게 걸리는 중력 배율.
// 적은 46 * AIR_GRAV(0.5) = 23을 받는다. 플레이어 기준 중력은 G=72이므로
// 23 / 72 = 0.32로 맞춰야 둘이 같은 포물선을 탄다. 안 맞추면 적은 15m까지
// 올라가는데 플레이어는 절반도 못 따라가서 사거리 밖에서 헛친다 (실측: 17.8 vs 7.8).
const AIR_COMBO_G = 0.32;
const AIR_COMBO_FALL = 30;   // 공중 콤보 중 낙하 속도 제한. 평소 7이면 내려올 때 뒤처진다
let airComboT = 0;           // 공중 콤보가 살아 있는 시간. hoverT와 따로 둔다 —
                             // hoverT는 집라인·잡기에서도 켜지는데 거기선 이 물리를 쓰면 안 된다
const AIR_GRAV  = 0.5;   // 뜬 적에게 걸리는 중력 배율 (46 * 0.5 = 23). 이걸로 포물선이 잡힌다
const AIR_HOLD  = 4;     // 공중에서 맞힐 때 받쳐 올리는 세기 (꼭대기에 붙들어 둔다)
const AIR_SIDE  = 0.25;  // 공중에서는 옆으로 이만큼만 민다. 밀려나면 콤보가 저절로 끊긴다


// 피격 반응이 유지되는 시간. 맞은 순간 상체가 젖혀지고 팔이 흐트러진다.
// 지금까지 적은 맞아도 자세가 그대로여서 "때린 것 같지가 않다"는 느낌이 있었다.
// 짧게 잡는다 — 길면 다음 동작을 잡아먹어서 오히려 굼떠 보인다.
const HIT_REACT = 0.26;

// 이보다 가까우면 물러난다. 서로 몸이 겹치면 누가 뭘 하는지 화면에서 안 읽힌다.
const E_STANDOFF = 6.0;
// 공격권이 없는 근접 적이 지키는 거리. E_STANDOFF보다 확실히 뒤여야 한다 —
// 전부 사거리까지 붙어버리면 플레이어 몸이 적들에게 묻혀서, 지금 누가 들어오는지도
// 무엇을 쳐내야 하는지도 안 보인다. 들어오는 놈만 6~8m로 파고든다.
const E_WAIT_RING = 12.0;

// 다음 패턴을 고른다. 붉은 패턴이 연달아 나오면 읽을 수가 없다.
// ---------- 보스 ----------
// 문서 02 §25. HP 큰 일반 적이 아니다. 페이즈마다 기술이 하나씩 는다.
//
// 예고·쳐내기·피해는 격투병이 쓰던 시스템을 그대로 쓴다. 파랑은 쳐낼 수 있고
// 빨강은 피해야 한다는 언어를 플레이어가 이미 배웠으니, 보스만 다른 규칙을
// 쓰면 처음부터 다시 배워야 한다. 표만 따로 둔다.
const BOSS_KIND = { swipe: 0, slam: 1, charge: 2, hurl: 3 };
const BOSS_HP = 90;
let bossE = null;          // 지금 살아 있는 보스 (적 하나를 빌려 쓴다)
let bossDead = false;
let bossPhase = 0;




const _bwA = new THREE.Vector3();


// ================== Combat Director (공격권 배분) ==================
// 적은 지금까지 서로를 전혀 몰랐다. 근처에 격투병 다섯이면 다섯이 동시에
// 휘둘렀고, 예고 색(파랑=쳐낼 수 있음 / 빨강=못 막음)이 다섯 개 겹쳐서
// 읽을 수가 없었다. 소울류에서 다대일이 성립하는 이유는 연출이 좋아서가
// 아니라 한 번에 한둘만 들어오기 때문이다.
//
// 그래서 "공격권 토큰"을 둔다. 토큰이 있는 적만 새 공격을 시작한다.
// 나머지는 지금까지처럼 움직이되 공격만 안 한다 — 간격을 재며 기다린다.
//
// 차선(lane)은 유형별로 따로 둔다. 근접이 붙어 있어도 사수가 쏠 수 있어야
// 화면이 심심하지 않다. 근접끼리는 한 차선을 나눠 쓴다 — 돌격병과 격투병이
// 동시에 붙으면 결국 같은 곳이 시끄러워지기 때문이다.
const DIR_LANES = [
  { name: '사수',   max: 1 },
  { name: '근접',   max: 1 },   // 돌격병 + 격투병 공용
  { name: '저격수', max: 1 },
];
const DIR_LANE_OF = [0, 1, 2, 1];   // E_TYPES 순서: 사수 / 돌격병 / 저격수 / 격투병
const DIR_MAX = DIR_LANES.reduce((a, l) => a + l.max, 0);   // 동시 교전 최대 3명

const DIR_TICK = 0.08;      // 배분 주기. 매 스텝(120Hz) 돌릴 이유가 없고, 덜 흔들린다
const DIR_REST = 1.1;       // 한 번 공격하고 나면 이만큼은 다음 차례에 양보한다
const DIR_HOLD = 2.5;       // 토큰만 쥐고 아무것도 안 하면 이 시간 뒤 회수한다
const DIR_MELEE_RING = 16;  // 근접은 이 안에 들어오면 후보. 사거리(7~8m)만 보면
                            // 달려오는 중에는 아무도 후보가 아니라 순번이 안 정해진다

let dirT = 0;
const dirHeld = [0, 0, 0];  // 차선별 현재 인원 (HUD/테스트용)
const _dirCand = [];

// 이미 공격 동작에 들어갔는가. 들어갔으면 토큰을 뺏지 않는다 — 도중에 끊으면
// 예고만 띄우고 사라지는 꼴이 되어 오히려 더 안 읽힌다.



// 적 한 명의 사고. dist는 플레이어까지 거리(제곱근 이미 계산됨).
const _eBoxes = [];
// 그 지점이 건물 안인가. 발밑에서 어깨높이 사이를 막는 박스가 있으면 못 간다.
// 적 몸통 반경만큼 벽에서 띄운다. 0.8이었을 때는 몸이 벽에 절반쯤 박혀 보였다.
const E_WALL_PAD = 1.7;


// 전부 길바닥에 세워두면 스윙 중에는 아무 일도 안 일어난다.
// 절반 이상을 옥상·스카이브리지 위에 올려 고도차 있는 교전을 만든다.
// --- 구역 ---
const ZONE_N = 3;                                   // 3x3 = 9구역
const ZONE_W = (N_AVE * AVE_SPACING) / ZONE_N;
const ZONE_D = (N_ST * ST_SPACING) / ZONE_N;
let zonesCleared = 0;
let zoneFlash = 0;        // 정화 직후 연출 잔량

// 빛기둥 — 멀리서도 목표가 어디인지 한눈에 보여야 한다
const beacon = new THREE.Mesh(
  new THREE.CylinderGeometry(14, 14, 900, 12, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0xffd24a, transparent: true, opacity: 0.16,
    side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
);
beacon.frustumCulled = false;
beacon.visible = false;
scene.add(beacon);





// 원점 주변에 반경으로 뿌리면 구역 절반이 텅 빈다. 구역마다 같은 수를 심어야
// "다음 구역으로 이동한다"는 목표가 실제로 도시를 가로지르는 이동이 된다.
const _spawnB = [];







// 임팩트 종류별 재질. 무엇에 맞았는지가 색으로 바로 읽혀야 한다.
const IMPACT = {
  wall: { mat: new THREE.MeshBasicMaterial({ color: 0xd8d8d8, toneMapped: false }), ring: 0xbfc8d4, spread: 22, size: 1.0 },
  hit:  { mat: new THREE.MeshBasicMaterial({ color: 0xffd86a, toneMapped: false }), ring: 0xffc23a, spread: 30, size: 1.3 },
  kill: { mat: new THREE.MeshBasicMaterial({ color: 0xff5a4a, toneMapped: false }), ring: 0xff4433, spread: 40, size: 1.7 },
  web:  { mat: new THREE.MeshBasicMaterial({ color: 0xf2f6ff, toneMapped: false }), ring: 0xdfe8ff, spread: 26, size: 1.1 },
};

// 충격 링 풀 생성. 원래 이 자리에서 만들던 것을 그대로 유지한다 (src/vfx.js).
initVfx(scene, camera, IMPACT, partGeo, particles);




const _up = new THREE.Vector3(0, 1, 0);



// ---- 속박(E): 적을 거미줄 고치로 감싸 일정 시간 완전히 묶는다 ----
const BIND_TIME = 5.0;
const BIND_CD = 1.2;
let bindCd = 0;
const cocoonGeo = new THREE.CapsuleGeometry(1.5, 2.7, 6, 14);
const strandGeo = new THREE.CylinderGeometry(0.07, 0.07, 1, 5);
const bindProjGeo = new THREE.CylinderGeometry(0.46, 0.46, 3.4, 8);
const bindProjMat = new THREE.MeshBasicMaterial({ color: 0xcfe4ff });
const grabProjMat = new THREE.MeshBasicMaterial({ color: 0xffd24a, toneMapped: false });
const pullProjMat = new THREE.MeshBasicMaterial({ color: 0x7bff9d, toneMapped: false });




// --- 궁극기 ---
const ULT_R = 75;        // 광역 속박 반경
const ULT_DMG = 1;

// 바닥에서 퍼져 나가는 충격파 링
const ultRingMesh = new THREE.Mesh(
  new THREE.RingGeometry(0.86, 1, 48),
  new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0,
    side: THREE.DoubleSide, depthWrite: false, toneMapped: false })
);
ultRingMesh.rotation.x = -Math.PI / 2;
ultRingMesh.frustumCulled = false;
ultRingMesh.visible = false;
scene.add(ultRingMesh);





// ================== 적 팔다리 리그 ==================
// 실제 구현은 src/enemy-rig.js 로 옮겼다. 여기서 부르는 이유는 생성 순서 때문이다 —
// 그쪽 파일 머리말 참고.

// ============ 근접 주먹 ============
// 쿨타임을 따로 두지 않는다. 뻗었다 돌아오는 동안 다시 못 뻗는 것 자체가 쿨타임이다.
const PUNCH_TIME = 0.19;   // 한 사이클(뻗기 + 복귀). 빠르게 치고 빠지는 맛.
const PUNCH_HIT  = 0.5;    // 사이클의 이 지점(=완전히 뻗은 순간)에 판정
const PUNCH_R    = 6.5;    // 주먹이 닿는 거리 (적이 6m 간격을 두므로 그만큼 필요)
const PUNCH_CONE = 0.55;   // 정면 원뿔 (dot 기준)
const PUNCH_DMG  = 1;
const PUNCH_KB   = 40;
let punchHit = false;      // 이번 사이클에서 이미 판정했는지
const _pv = new THREE.Vector3(), _pv2 = new THREE.Vector3();



// ================== 근접 격투 ==================
// 소울류 문법 그대로. 약공격 3타 체인 / 강공격 / 패링(E) / 구르기(Shift).
// 적은 HP와 별개로 '체간'을 갖는다. 체간이 무너지면 처형으로 즉사한다 —
// 그래서 강공격과 패링이 "딜을 넣는 수단"이 아니라 "무너뜨리는 수단"이 된다.

// 한 방의 사양. hit은 사이클 시작으로부터 판정이 나가는 시각(초).
// cancel 이후에는 다음 입력을 선입력으로 받아 이어친다.
const M_LIGHT = [
  { dur: 0.23, hit: 0.075, dmg: 1, post: 10, kb: 6,  r: 7.2, cancel: 0.14 },
  { dur: 0.21, hit: 0.065, dmg: 1, post: 10, kb: 6,  r: 7.2, cancel: 0.13 },
  { dur: 0.38, hit: 0.14,  dmg: 2, post: 22, kb: 15, r: 7.8, cancel: 0.26 },
];
// 강공격은 느리고 크게 무너뜨린다. 체간 44면 세 방에 붕괴한다.
// 강공격은 뗀 뒤에도 한 박자 뜸을 들였다가 들어간다 (차징했다 때리는 맛).
const M_HEAVY  = { dur: 0.62, hit: 0.30, dmg: 2, post: 44, kb: 22, r: 8.6, cancel: 0.46 };

// --- 콤보 갈래 ---
// 지금까지는 약공격 3타 한 줄뿐이라 어떻게 쳐도 같은 그림이 나왔다.
// 강공격을 "언제 넣느냐"로 결과가 갈리게 한다. 새 상태를 만들지 않는다 —
// 이미 있는 mChain(이어친 약공격 수)이 그대로 입력 순서다.
//
//   강        (mChain 0)  차징 강타   체간을 크게 깎는다. 지금 그대로.
//   약강      (mChain 1)  밀어내기    피해는 없다시피, 대신 크게 민다.
//   약약강    (mChain 2)  띄우기      적을 공중에 올린다.
//   약약약                기본 3타    지금 그대로 (M_LIGHT).
//
// 차징 배율은 강타에만 건다. 갈래 둘은 콤보 흐름 안에서 나가는 마무리라
// 문 시간까지 보태면 손이 너무 바빠진다.
const M_SHOVE  = { dur: 0.42, hit: 0.16, dmg: 1, post: 18, kb: 46, r: 8.2, cancel: 0.28 };
// launch = 위로 밀어올리는 세기. 옆으로 미는 kb와 따로 둔다.
// launch = 위로 밀어올리는 세기. 감쇠 없이 중력만 받으므로 포물선이 그대로 나온다.
// 26이면 꼭대기 약 15m / 왕복 2.3초. "아예 높게 띄웠다가 내려온다"가 목표다.
const M_LAUNCH = { dur: 0.50, hit: 0.20, dmg: 1, post: 26, kb: 10, r: 8.0, cancel: 0.34, launch: 26 };

const M_CHAIN_T = 0.65;   // 이 안에 다음 약공격을 넣어야 체인이 이어진다
// 선입력은 넉넉해야 한다. 사람은 판정 프레임을 보고 누르지 않는다.
const M_BUF_T   = 0.42;   // 선입력 유지 시간
const M_STEP    = 26;     // (예전 파고들기 상한 — 지금은 LUNGE_CAP이 쓰인다)
// --- 파고들기(루트 모션) ---
// 예전에는 공격 시작 때 속도를 한 번만 줬다. 그래서 목표가 조금만 멀어도
// 판정 시각에 아직 도착을 못 했고, "쳤는데 안 맞는다"가 됐다.
// 스파이더맨2는 애니메이션이 캐릭터를 대상까지 끌고 간다. 그 방식을 따라간다 —
// 판정 프레임까지 남은 시간으로 필요한 속도를 매 틱 다시 계산해서 반드시 도착시킨다.
const LUNGE_MAX = 16;     // 이보다 멀면 붙지 않는다 (그 거리는 F 거미줄 접근의 몫)
const LUNGE_CAP = 58;     // 파고드는 속도 상한
const MELEE_STAND = 5.0;  // 목표 앞 이 거리에 서려고 한다. 3.4였을 때는 서로 몸이 겹쳤다.

let mChain = 0, mChainT = 0;
let mBuf = 0, mBufT = 0;  // 선입력: 1 = 약, 2 = 강

// --- 차징 강공격 ---
// 우클릭을 시점에 통째로 내줬으므로 강공격은 좌클릭 홀드가 맡는다.
// 짧게 치면 약공격, 물고 있으면 차오르고, 떼는 순간 나간다.
// 게임 중 사람이 클릭하는 시간은 150~300ms다. 0.2초로 잡았더니 평범한 클릭이
// 죄다 강공격으로 나가서 "약공격이 안 나간다"가 됐다. 의도적으로 꾹 눌러야
// 강공격이 되도록 문턱을 올린다.
const CHARGE_MIN  = 0.33;   // 이보다 오래 물어야 강공격
const CHARGE_FULL = 0.95;   // 최대 차징

// --- 패링 ---
// 세키로의 쳐내기. 창이 좁고, 헛치면 그 사이에 그대로 맞는다.
const PARRY_WIN  = 0.20;  // 판정 창
const PARRY_REC  = 0.32;  // 헛쳤을 때 굳는 시간
const PARRY_CD   = 0.38;
const PARRY_POST = 34;    // 쳐내면 적 체간이 이만큼 무너진다
let parryCount = 0;

// --- 구르기 ---
// 짧고 빠르게 "휙" 빠진다. 예전엔 0.42초 동안 30m/s로 미끄러져서
// 회피라기보다 그냥 이동으로 보였다.
const ROLL_TIME  = 0.34;
const ROLL_IFR   = 0.22;  // 앞쪽 이 구간만 무적. 끝까지 무적이면 구르기가 답이 된다.
const ROLL_SPEED = 52;    // 초속. 앞부분에 몰아 쓰고 뒤는 급히 죽인다.
const ROLL_STAM  = 20;
const ROLL_BURST = 0.16;  // 이 시간까지는 속도를 유지하고, 지나면 확 잡는다
let rollFx = 0;                 // 회피 대시 연출 잔량
let wl0 = 0;                    // 이번 틱의 이동 입력 크기 (연출용)
const rollDir = new THREE.Vector3();

// --- 체간 · 처형 ---
const POST_DECAY = 14;    // 초당 회복. 몰아치지 않으면 도로 차오른다.
const POST_HOLD  = 0.7;   // 마지막 타격 후 이만큼은 회복이 멈춘다
const STAG_TIME  = 4.0;   // 붕괴 지속
const EXEC_TIME  = 0.9;   // 처형 연출 (이 동안 무적)
const EXEC_REACH = 9;

// --- 거미줄 접근 ---
// 지상 고정 모드라 거리 좁히는 수단이 없으면 원거리 적을 영영 못 잡는다.
// F로 락온 대상에게 양손 거미줄을 걸고 순식간에 붙는다.
const DASH_IN_SPEED = 62;
const DASH_IN_MIN = 7, DASH_IN_MAX = 75, DASH_IN_STAM = 12;

// --- 휘두르는 그림 ---
// 3인칭에는 주먹 모션이 아예 없었다 (기존 punch 연출은 1인칭 전용이다).
// 그래서 사거리 밖에서 치면 화면에 아무 일도 안 일어나 "공격이 안 나간다"로 읽혔다.
// 몸통 비틀기 + 바닥을 쓸고 지나가는 호로 헛쳐도 휘둘렀다는 게 보이게 한다.

const _mDir = new THREE.Vector3(), _mh = new THREE.Vector3(), _mImp = new THREE.Vector3();
const _w2v = new THREE.Vector3();      // 보조 웹 방향 계산용
const _w2s = new THREE.Vector3();      // 보조 웹 줄이 나가는 손 위치




// WASD가 가리키는 월드 방향. 아무것도 안 눌렀으면 null.
function moveDirWorld(out) {
  let ix = 0, iz = 0;
  if (keys["KeyW"]) iz -= 1;
  if (keys["KeyS"]) iz += 1;
  if (keys["KeyA"]) ix -= 1;
  if (keys["KeyD"]) ix += 1;
  if (ix === 0 && iz === 0) return null;
  const fx = Math.sin(viewYaw), fz = Math.cos(viewYaw);
  // rightV = fwd x up
  const rx = -fz, rz = fx;
  return out.set(fx * -iz + rx * ix, 0, fz * -iz + rz * ix).normalize();
}

// 지금 다른 동작에 묶여 있는가








// 근접은 "화면의 에임점이 적 위에 있는가"로 판정한다.
// 월드 좌표로 조준선과의 수직 거리를 재면, 가까울수록 같은 화면 거리라도
// 월드 거리가 작아져서 코앞의 적이 오히려 판정에서 빠졌다. 실측으로 확인했다.
// 화면 픽셀로 재면 "보이는 대로" 맞아서 거리에 상관없이 일관된다.
const MELEE_AIM_R = 2.4;                    // (원거리 조준선 판정에 남겨둔 값)
const _mo = new THREE.Vector3(), _md = new THREE.Vector3(), _mv = new THREE.Vector3();
const _msV = new THREE.Vector3();
// 고정 픽셀 반경으로는 안 된다. 3인칭 카메라는 플레이어 뒤·위에 있어서
// 정면의 적이라도 화면 중앙에 오지 않고, 거리에 따라 크게 흔들린다.
// 대신 "적이 화면에 보이는 크기"를 판정 반경으로 쓴다 — 가까우면 크게 보이니
// 판정도 커지고, 멀면 작아진다. 보이는 대로 맞는다.
const MELEE_AIM_PAD = 55;                   // 몸통 상자 바깥으로 이만큼은 봐준다(픽셀)
// 적을 원이 아니라 '세로로 긴 직사각형'으로 본다. 사람 몸은 원이 아니라
// 머리부터 발까지 길쭉해서, 원으로 재면 가슴은 맞는데 머리·다리가 빗나갔다.
const E_BOX_W = ENEMY_HIT_R * 0.95;         // 몸통 반폭 (월드)
const E_BOX_TOP = 7.2, E_BOX_BOT = 0.2;     // 발밑부터 머리끝까지 (월드)
const _bxA = new THREE.Vector3(), _bxB = new THREE.Vector3();

// 지금 때릴 수 있는 적 — '소프트 락온'.
//
// 예전에는 "조준점이 적 몸통 상자 안에 있는가"가 필수 조건이었다. 그래서 Ctrl
// 락온을 안 걸면 대부분 헛쳤고, 락온이 사실상 강제였다. 근접 조작감이 나빴던
// 가장 큰 이유가 이것이다.
// 스파이더맨2는 락온이 없다. 스틱 방향(없으면 카메라 정면)으로 매 타격마다 가장
// 그럴듯한 적을 점수로 고르고, 캐릭터가 그쪽으로 붙는다. 그래서 3타 콤보가 서로
// 다른 세 명을 훑고 지나간다. 여기서도 화면 판정을 '필수'에서 '가산점'으로 내리고
// 방향·거리·상태를 함께 점수로 매긴다.
// 하드 락온(Ctrl)은 남긴다 — "이 놈만 팬다"는 여전히 필요하다.
const SOFT_CONE   = 0.10;   // 이보다 앞이면 후보 (대략 ±84도)
const SOFT_W_DIR  = 2.4;    // 의도 방향과 맞을수록
const SOFT_W_AIM  = 1.0;    // 조준점이 몸에 얹혀 있으면
const SOFT_W_AIR  = 0.9;    // 띄워둔 / 쓰러진 적을 이어친다
const SOFT_W_LAST = 0.6;    // 방금 친 적을 조금 우선한다 (콤보가 흩어지지 않게)
const _mIntent = new THREE.Vector3();
let lastMeleeTarget = null;













// ============ 근접 기동: C 돌진 · R 끌어오기 · 좌클릭 발차기 ============
// 원거리 총질만 있으면 스파이더맨이 아니라 3인칭 슈터다.
// "잡는다 -> 멈칫한다 -> 날아간다 -> 타이밍 맞춰 찬다"의 4박자를 만든다.
const GRAB_SPEED  = 430;   // 잡기 투사체 — 즉발처럼 느껴져야 한다
const LUNGE_HOLD  = 0.34;  // 잡은 직후의 정지. 이 멈칫이 있어야 다음 가속이 세게 느껴진다
const LUNGE_SPEED = 750;   // 적에게 날아가는 속도 (반동처럼 휙)
const LUNGE_MAX_T = 1.6;
const LUNGE_CD    = 1.5;
const PULL_SPEED  = 200;   // 적이 끌려오는 속도 (반동처럼 휙)
const PULL_MAX_T  = 2.2;
const PULL_CD     = 1.8;
const KICK_R      = 15;    // 이 안에 들어오면 발차기 입력을 받는다 (빨라진 만큼 넉넉히)
const KICK_BUF    = 0.28;  // 창 열리기 직전 입력도 살려주는 선입력 버퍼
const KICK_WIN    = 0.45;  // 창이 열려 있는 시간. 무한정 열어두면 타이밍 게임이 아니다
const KICK_DMG    = 3;     // 제대로 맞추면 한 방
const KICK_KB     = 66;
const WHIFF_DMG   = 1;     // 타이밍을 놓치면 서로 부딪혀 동반 피해
const WHIFF_KB    = 34;

let lungeCd = 0, pullCd = 0;
// 공중에서 스킬을 쓰면 그동안 중력을 끊어 잠깐 떠 있게 한다.
// 시전 중에 뚝 떨어지면 조준한 게 무의미해지고 연출도 죽는다.
let hoverT = 0;
let kickOpen = false;      // 발차기 입력 창이 열려 있는지
let kickBuf = 0;           // 선입력 남은 시간
let kickFx = 0;            // 발차기 연출(손 포즈/FOV)
const _lv = new THREE.Vector3(), _lv2 = new THREE.Vector3();

// 대상의 가슴 높이. 발 밑이 아니라 여기로 줄이 가야 잡은 것처럼 보인다.

// 리스폰 대기 중에는 입력이 전부 무시돼야 한다. 스킬마다 따로 검사하면 반드시 하나를 빠뜨린다.
// 전투를 걷어내서 행동을 막을 상태가 없다. 자리는 남겨둔다 — 연출이 생기면 여기다.
function canAct() { return true; }

// ================== 락온 ==================
// 3인칭에서 커서로 적을 계속 따라가며 맞추는 건 사실상 무리다. 엘든링처럼
// 대상을 하나 물면 카메라가 알아서 그 적을 본다. 근접 격투의 전제이기도 하다 —
// 락온이 없으면 우클릭이 시점 드래그에 묶여 강공격을 걸 자리가 없다.
let lockLost = 0;              // 대상이 안 보인 채로 흐른 시간
const LOCK_RANGE = 130;        // 새로 물 수 있는 거리
const LOCK_BREAK = 190;        // 이보다 멀어지면 저절로 풀린다
const LOCK_BLIND = 1.2;        // 이만큼 계속 안 보이면 놓친다
const _lkO = new THREE.Vector3(), _lkD = new THREE.Vector3(), _lkT = new THREE.Vector3();
const _lkA = new THREE.Vector3(), _lkB = new THREE.Vector3(), _lkH = new THREE.Vector3();











// 조준점에 가장 가까운 적을 고른다. 반경 3.1m 표적을 200m 밖에서 정확히 맞추라는 건
// 콤보의 시작 기술로는 너무 가혹하다 — 원뿔 안에 들어오면 그 적을 노린다.
const _pk = new THREE.Vector3(), _pk2 = new THREE.Vector3();

// 조준선의 출발점. 1인칭은 눈, 3인칭은 거미줄이 실제로 나가는 가슴 높이.
const _aimO = new THREE.Vector3(), _aimD = new THREE.Vector3();
const _aimStep = new THREE.Vector3(), _aimHit = new THREE.Vector3();
function aimOrigin(out) {
  if (firstPerson) return out.copy(camera.position);
  return out.set(player.pos.x, player.pos.y + 1.7, player.pos.z);
}
// 1인칭 시선 방향. 총구를 눈앞으로 밀어낼 때만 쓴다.
function aimDir(out) {
  const cp = Math.cos(viewPitch);
  return out.set(Math.sin(viewYaw) * cp, Math.sin(viewPitch), Math.cos(viewYaw) * cp);
}

// 조준선. 1인칭과 3인칭은 조준 방식 자체가 다르다.
//  1인칭 — 조준점이 화면 정중앙에 고정. 시선각이 곧 조준선이다.
//  3인칭 — 마우스 커서가 조준점이다. 카메라에서 커서를 통과하는 선을 쓴다.
// 3인칭에서 카메라 정면을 조준선으로 쓰면, 카메라가 플레이어를 내려다보는 만큼
// 화면 중앙이 발밑 땅을 가리켜 전 거리에서 빗나간다.
function aimRay(outO, outD) {
  if (firstPerson) {
    outO.copy(camera.position);
    aimDir(outD);
    return;
  }
  camera.updateMatrixWorld();
  raycaster.setFromCamera(cursorNdc(), camera);
  outO.copy(raycaster.ray.origin);
  outD.copy(raycaster.ray.direction);
}
// 3인칭 광선은 카메라에서 출발한다. 카메라가 뒤로 빠진 만큼 사거리를 더 준다.
// 실제 사거리 제한은 부르는 쪽에서 플레이어 기준으로 다시 잰다.
const AIM_BACK = 60;
// 조준선이 실제로 닿는 지점. minDist는 카메라가 아니라 플레이어 기준 거리다.
function aimHit(range, minDist) {
  aimRay(_aimO, _aimD);
  _aimStep.copy(_aimD).multiplyScalar(range + (firstPerson ? 0 : AIM_BACK));
  if (!segHitWorld(_aimO, _aimStep, _aimHit, 0)) return null;
  if (minDist && player.pos.distanceTo(_aimHit) < minDist) return null;
  return _aimHit.clone();
}
function aimPointOrFar(range) {
  const p = aimHit(range, 0);
  if (p) return p;
  aimRay(_aimO, _aimD);
  return _aimO.clone().addScaledVector(_aimD, range + (firstPerson ? 0 : AIM_BACK));
}


// 조준점이 가리키는 지점 (적이 없을 때의 대체 목표)





const _cv = new THREE.Vector3();
const _stepV = new THREE.Vector3();   // 탄 이동량 전용 (segHitsSphere 임시벡터와 절대 겹치면 안 됨)
const _impV = new THREE.Vector3();    // 임팩트 위치 전용
const _wallP = new THREE.Vector3();   // 탄이 지형에 닿은 지점 전용
const projRay = new THREE.Raycaster();   // 조준선 미리보기 등 드문 용도에만 남겨둔다
const _segBoxes = [];


// 이번 틱에 탄이 지나간 선분이 건물/지면에 닿았으면 그 지점을 out에 담고 true.
function segHitWorld(p0, step, out, minT) {
  const len = step.length();
  if (len < 1e-6) return false;
  const lo = minT || 0;          // 이 비율보다 가까운 충돌은 무시 (벽에 붙어 있을 때)
  let best = 2;
  nearbyBuildings(p0.x + step.x * 0.5, p0.z + step.z * 0.5, len * 0.5 + 6, _segBoxes);
  for (let i = 0; i < _segBoxes.length; i++) {
    const b = _segBoxes[i];
    const t = segBoxT(p0, step,
      b.x - b.w / 2, b.y0, b.z - b.d / 2,
      b.x + b.w / 2, b.y0 + b.h, b.z + b.d / 2);
    if (t >= lo && t < best) best = t;
  }
  // 지면(인도 턱 포함)
  if (step.y < 0) {
    const gy = groundHeightAt(p0.x + step.x, p0.z + step.z, p0.y);
    if (p0.y > gy && p0.y + step.y <= gy) {   // 이미 지면 아래면 무시
      const t = (gy - p0.y) / step.y;
      if (t >= lo && t < best) best = t;
    }
  }
  if (best > 1) return false;
  out.copy(p0).addScaledVector(step, best);
  return true;
}

// 굵기가 보이는 빌보드 리본. 세그먼트마다 처짐/두께 테이퍼 적용
const WEB_SEGS = 14;
// 메인 스윙 거미줄도 집라인과 같은 원통 가닥을 쓴다 (아래 makeStrand 정의 참조)
let webStrand = null;
let webLine = null;

// 우클릭 집라인용 양손 거미줄 — 같은 리본 구조를 좌/우 손 몫으로 하나씩 더 만든다
// 거미줄은 납작한 빌보드 판이 아니라 "꼬인 실 가닥"이어야 한다.
// 판으로 두면 가까이서 흰 종잇장처럼 보인다. 단면에 링을 둘러 원통으로 만들고
// 표면에 세로 섬유 무늬를 넣어 실이 꼬인 것처럼 읽히게 한다.
const WEB_RADIAL = 6;   // 단면 링의 정점 수

const webStrandTex = makeWebStrandTexture();

function makeStrand() {
  const geo = new THREE.BufferGeometry();
  const rings = WEB_SEGS + 1;
  const pos = new Float32Array(rings * WEB_RADIAL * 3);
  const nrm = new Float32Array(rings * WEB_RADIAL * 3);
  const uv = new Float32Array(rings * WEB_RADIAL * 2);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  const idx = [];
  for (let i = 0; i < WEB_SEGS; i++) {
    for (let r = 0; r < WEB_RADIAL; r++) {
      const r2 = (r + 1) % WEB_RADIAL;
      const a = i * WEB_RADIAL + r, b = i * WEB_RADIAL + r2;
      const c2 = (i + 1) * WEB_RADIAL + r, d = (i + 1) * WEB_RADIAL + r2;
      idx.push(a, c2, b, b, c2, d);
    }
  }
  geo.setIndex(idx);
  // UV는 고정이라 한 번만 채운다 (u = 둘레, v = 길이)
  for (let i = 0; i < rings; i++) {
    for (let r = 0; r < WEB_RADIAL; r++) {
      const o = (i * WEB_RADIAL + r) * 2;
      uv[o] = r / WEB_RADIAL;
      uv[o + 1] = (i / WEB_SEGS) * 3;   // 길이 방향으로 3번 반복
    }
  }
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: webStrandTex, color: 0xffffff, roughness: 0.85,
    emissive: 0x9aa6bb, emissiveIntensity: 0.25,   // 그늘에서도 줄이 보이게
  }));
  mesh.visible = false;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return { geo, pos, nrm, mesh };
}
const zipWebL = makeStrand();
const zipWebR = makeStrand();
webStrand = makeStrand();
webLine = webStrand.mesh;

const anchorMark = new THREE.Mesh(
  new THREE.SphereGeometry(0.22, 8, 8),   // 가닥이 얇아진 만큼 부착점도 작게
  new THREE.MeshBasicMaterial({ color: 0xf0f4fa })
);
anchorMark.visible = false;
scene.add(anchorMark);

// 지금 좌클릭하면 어디에 붙는지 미리 보여주는 마커 (가독성 = 사용감)
const aimMark = new THREE.Mesh(
  new THREE.SphereGeometry(1.15, 10, 8),
  new THREE.MeshBasicMaterial({ color: 0x7dffa0, transparent: true, opacity: 0.45, depthTest: false })
);
aimMark.renderOrder = 5;
aimMark.visible = false;
scene.add(aimMark);


// 적 머리 위 체력바/체간바. 실제 구현은 src/hud-bars.js 로 옮겼다.
// 여기서 부르는 이유는 생성 순서 때문이다 — 그쪽 파일 머리말 참고.

// 락온 표시. 대상 가슴에 띄우고 항상 카메라를 향하게 눕힌다.
const lockMark = new THREE.Mesh(
  new THREE.TorusGeometry(1.6, 0.16, 6, 22),
  new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.9, depthTest: false })
);
lockMark.renderOrder = 6;
lockMark.visible = false;
scene.add(lockMark);


initHands();   // 1인칭 손 재질 생성. 원래 이 자리에서 만들던 것을 그대로 유지한다.




// 손이 닿아야 할 곳. 이 값 하나로 1인칭 손과(나중에) 3인칭 뼈가 같이 움직인다.
// 지금 손은 셰이더로 깎은 것이지만, Fab 모델로 갈아끼울 때 바꿀 곳은 아래
// applyReach를 먹이는 줄뿐이고 src/reach.js는 그대로 쓴다.
const armR = makeHand(false);
const armL = makeHand(true);
armR.position.set(0.5, -0.46, -0.52);
armR.rotation.x = 0.55;
armR.scale.setScalar(0.72);
camera.add(armR);
camera.add(armL);

// 상완. 어깨는 화면 밖 아래 모서리에 고정하고, 팔꿈치까지를 매 프레임 잇는다.
// 이게 없으면 팔이 팔꿈치 아래에서 끊겨 허공에 떠 보인다.
//
// 여기서 바로 만들면 안 된다. THREE의 Group/Mesh/Geometry 생성자가 uuid를
// 만들면서 Math.random()을 먹는데, 이 자리는 아직 도시와 적이 다 생기기 전이라
// 그 뒤의 난수열이 통째로 밀린다. 실제로 적 유형 분포가 바뀌었다.
// 그래서 첫 프레임에, 월드 생성이 전부 끝난 뒤에 만든다.
let upperR = null, upperL = null;
let fpBody = null;
// 몸의 관성 상태. 스프링이라 프레임 간에 유지돼야 한다.
let fpIne = null;
// 가속도를 직접 재려고 지난 프레임의 진행 속력을 들고 있는다.
// 물리 쪽에 훅을 박지 않으려는 것이다 — 여기서 차분만 낸다.
let fpPrevSp = 0, fpFwdAcc = 0;                       // 1인칭 가슴·다리
function ensureUpperArms() {
  if (upperR) return;
  upperR = makeUpperArm();
  upperL = makeUpperArm();
  camera.add(upperR);
  camera.add(upperL);
  fpBody = makeFpBody();
  fpIne = makeBodyInertia();
  camera.add(fpBody);
}
// 어깨 자리. 눈보다 아래·뒤이고, 생각보다 몸에 가깝다.
// 예전 값(바깥 0.40 · 아래 0.74)은 어깨가 아니라 허리 높이였다. 그 자리에서
// 팔을 뻗으면 어깨가 몸 밖에 떠 있는 것처럼 보이고, 위팔이 비정상적으로 길어진다.
const SHOULDER_R = new THREE.Vector3(0.21, -0.30, 0.02);
const SHOULDER_L = new THREE.Vector3(-0.21, -0.30, 0.02);
// 매 프레임 계산한 어깨 자리. 손이 향하는 쪽으로 어깨도 조금 따라간다.
const _shR = new THREE.Vector3(), _shL = new THREE.Vector3();
// 뻗은 정도만큼 손목을 해부학적 자리로 옮기고, 팔뚝을 그 방향으로 맞춘다.
//
// 위치만 옮기면 부족했다. 팔뚝 회전은 '기본 자세 + reach 델타'라서 목표 방향과
// 정확히 나란하지 않고, 그러면 팔꿈치가 어깨~손목 선에서 벗어나 위팔이 늘어난다.
// 실측으로 위팔이 0.55m까지 늘어났다(정상 0.30). 그 늘어난 삼각형이 곧 V자 꺾임이다.
//
// 팔뚝을 목표 방향으로 직접 향하게 하면 어깨-팔꿈치-손목이 한 줄에 놓이고,
// 위팔 길이가 각도와 무관하게 일정해진다.
const _wr = new THREE.Vector3(), _rd = new THREE.Vector3();
const _aimQ = new THREE.Quaternion();
const _ARM_FWD = new THREE.Vector3(0, 0, -1);
function armReachPos(arm, shoulder, side) {
  const r = getReach(side);
  if (!r || r.on < 0.001) return;
  reachDir(_rd, side);
  _wr.copy(_rd).multiplyScalar(REACH_LEN).add(shoulder);
  arm.position.lerp(_wr, r.on);
  _aimQ.setFromUnitVectors(_ARM_FWD, _rd);
  arm.quaternion.slerp(_aimQ, r.on);
}

function shoulderFor(out, base, r, side) {
  out.copy(base);
  if (!r || r.on < 0.001) return out;
  // 바깥쪽으로 벌릴 때만 어깨가 크게 따라간다. 몸을 가로지를 때 어깨까지
  // 따라가면 어깨가 가슴 앞으로 넘어와서 더 이상해진다.
  const outward = (r.yaw >= 0) === (side > 0);
  out.x += Math.sin(r.yaw) * (outward ? 0.30 : 0.10) * r.on;
  out.y += Math.sin(r.pitch) * 0.20 * r.on;
  out.z -= Math.max(0, Math.cos(r.yaw) - 0.7) * 0.10 * r.on;
  return out;
}

const handAnchor = new THREE.Object3D();
handAnchor.position.set(0.36, -0.3, -0.78);
camera.add(handAnchor);
scene.add(camera);
initReach(camera);


const keys = {};
addEventListener("keydown", e => {
  keys[e.code] = true;
  // Ctrl = 락온 토글. 브라우저 기본 단축키가 끼어들지 않게 막는다.
  if (e.code === "ControlLeft" || e.code === "ControlRight") {
    e.preventDefault();
  }
  // Shift = 구르기 (근접 모드 전용). 다른 모드에서는 달리기/대시 그대로다.
  if (e.code === "KeyP") {
    firstPerson = !firstPerson;
    spiderGroup.visible = !firstPerson;
    dragging = false;
    if (firstPerson) {
      // 1인칭: 커서를 가두고 조준점을 화면 중앙에 박는다. 마우스 이동 = 시점.
      camAuto = false;
      requestLook();
      crosshairEl.style.left = "50%";
      crosshairEl.style.top = "50%";
    } else {
      // 3인칭: 락을 풀어 커서를 되돌린다. 커서가 곧 조준점이다.
      document.exitPointerLock();
      crosshairEl.style.left = `${mx}px`;
      crosshairEl.style.top = `${my}px`;
      camAuto = !camHold;        // C로 수동을 걸어뒀으면 그 상태를 지킨다
      lookIdle = 0;
    }
  }
  // H = 화면 정리 단계 순환. 웹스윙만 하고 싶을 때 전부 치운다.
  if (e.code === "KeyH" && !e.repeat) {
    setOpt("ui", (uiMode + 1) % 3);
    say(["화면 전체", "화면 최소", "화면 없음 — 웹스윙에 집중"][uiMode], 2);
  }
  // Esc = 시작 화면으로. 캐릭터를 다시 고르거나 튜토리얼을 다시 볼 수 있다.
  if (e.code === "Escape") {
    // F1이 열려 있으면 그것부터 닫는다. 바로 시작 화면으로 튀면 놀란다.
    if (hudEl.classList.contains("show")) { hudEl.classList.remove("show"); return; }
    if (!menuOn) { showMenu(true); return; }
  }
  // Enter = 이 단계 건너뛰기. 막히면 튜토리얼이 감옥이 된다.
  // O = 조준 방식 전환 (실험). 커서 조준 <-> 중앙 고정 + 어깨너머.
  // 단축키도 설정과 같은 경로를 탄다 — 두 군데서 상태를 만지면 반드시 어긋난다.
  if (e.code === "KeyO" && !e.repeat) {
    setAim(!aimCenter);
    say(aimCenter ? "중앙 조준 · 어깨너머 카메라 (O 또는 F1 설정)" : "커서 조준 (O 또는 F1 설정)", 2.5);
  }
  // C = 시점 자동/수동. 설정과 같은 경로를 탄다.
  // (실제 처리는 아래 기존 블록이 하고, 설정 칩만 다시 그린다)
  if (e.code === "KeyC" || e.code === "KeyZ") {
    camAuto = !camAuto;
    camHold = !camAuto;
    camMsg = 1.6;
    lookIdle = 0;
  }
  // T = 잡기 돌진. C에 있던 걸 옮겼다 (C는 시점 토글과 겹쳤다).
  // R = 적을 눈앞으로 끌어온다. 끌려오는 동안 좌클릭 타이밍을 맞추면 발차기.
  // + = 야간/주간 전환. 자판마다 + 자리가 달라 = 키와 넘패드 +를 모두 받는다.
  if (e.code === "Equal" || e.code === "NumpadAdd") setNight(!night);
  // F1 = 조작법 패널. 브라우저 기본 도움말이 뜨는 걸 막는다.
  if (e.code === "F1") {
    e.preventDefault();
    hudEl.classList.toggle("show");
    // 조작법을 읽는 동안 커서가 갇혀 있으면 못 읽는다 (1인칭은 포인터 락이 걸려 있다)
    if (hudEl.classList.contains("show")) { document.exitPointerLock(); drawSettings(); }
    else if (firstPerson || aimCenter) requestLook();
  }
  // F3 = 웹 디버그. 앵커 후보와 점수를 화면에 띄운다 (문서 03 §42). 기본 OFF.
  if (e.code === "F3" && !e.repeat) { e.preventDefault(); toggleWebDbg(); }
  // F4 = 자동 앵커 V2 / legacy 전환. 튜닝용 — 둘을 번갈아 켜서 비교한다.
  if (e.code === "F4" && !e.repeat) {
    e.preventDefault();
    autoV2 = !autoV2;
    say(autoV2 ? "자동 앵커 V2 (의도 기반)" : "자동 앵커 legacy (시선 기반)", 2);
  }
  if (e.code === "Escape") hudEl.classList.remove("show");
  // X = 근접 주먹. 마우스 앞쪽 사이드 버튼으로도 나간다.
  // E = 패링(쳐내기). 근접 모드 전용 — 다른 모드의 E는 속박/가속 그대로다.
  // 수동 재장전
});
addEventListener("keyup", e => { keys[e.code] = false; });

// 낙하 피해. 속도만으로는 등급을 못 나눈다 — MAX_SPEED가 112라 자유낙하가
// 100을 못 넘고, 300m를 떨어져도 60~100 구간에 머문다. 그래서 실제로 떨어진
// 높이로 등급을 나누고, 수직 속도는 "진짜 추락인가"를 가리는 문지기로만 쓴다.
// (스윙으로 부드럽게 내려앉는 건 수직 속도가 낮아 통째로 면제된다)
const FALL_MIN_V = 45;                       // 이보다 느리게 내려앉으면 안 아프다
// 떨어진 높이(m)와 그때의 피해(칸). 화면 표시는 칸 x 25다.
// 예전엔 35m부터 곧바로 1칸(25)이 들어가서, 스윙하다 살짝 헛디디기만 해도 아팠다.
// 웹스윙 게임에서 낙하는 실수라기보다 이동의 일부라 낮은 높이는 가볍게 잡는다.
// 대신 진짜 옥상에서 뛰어내리면 확실히 아프다.
const FALL_TIERS = [
  { h: 30,  dmg: 0.2 },   //  30m -> 5     (헛디딘 수준)
  { h: 55,  dmg: 0.4 },   //  55m -> 10
  { h: 90,  dmg: 1.0 },   //  90m -> 25    (중층 건물 옥상)
  { h: 150, dmg: 2.0 },   // 150m -> 50
  { h: 240, dmg: 3.5 },   // 240m -> 88    (고층에서 그대로 낙하)
];
let fallTopY = 0;                            // 공중에 뜬 뒤 도달한 가장 높은 지점
const G = 72;        // 무게감. 큰 스케일에서 붕 뜨지 않도록 실제 중력보다 크게 잡는다
const JUMP_V = 42;   // 중력을 올린 만큼 초속도도 올려 도약 높이를 유지
// 근접 적이 붙으면 떼어낼 수가 없다는 얘기가 있어서 올렸다.
// 적 추격 속도(격투병 14.7 / 돌격병 13.0)보다 걷기만 해도 빠르다.
let MOVE_SPEED = 19;
const SPRINT_MULT = 1.85;   // 지상 Shift 달리기 배수
const ACCEL = 118;       // 지상 가속. 90이었을 때는 출발이 무거웠다
const AIR_ACCEL = 42;    // 공중 조작 가속. 30이었을 때는 스윙 중 방향 전환이 굼떴다
const PUMP_ACCEL = 58;   // E 홀드 속도 증강
const ROPE_MIN = 12;
// 이보다 가까운 곳에 걸면 그네가 되지 않는다. 자동·수동 앵커가 같은 값을 쓴다.
const SWING_MIN_LEN = 18;
// 집라인(우클릭): 양손 거미줄로 앵커를 잡고 자신을 끌어당기는 이동기.
// 줄이 걸리자마자 튀어나가면 가볍게 느껴진다. 짧게 힘을 모으는 구간을 두면
// "당겨진다"는 인과가 눈에 보이고 발사 순간의 가속이 훨씬 세게 체감된다.
const ZIP_CHARGE = 0.3;   // 시전 딜레이 — 줄을 걸고 힘을 모으는 시간
const ZIP_SPEED = 150;    // 당겨지는 목표 속도
const ZIP_GRAB = 11;      // 목표 속도에 붙는 빠르기
const ZIP_ARRIVE = 10;    // 앵커에 이만큼 가까워지면 종료 (빨라진 만큼 넉넉히)
const ZIP_MAX_T = 2.4;    // 안전 타임아웃
// 도착 순간 속도를 깎아버리면 이 이동기가 "순간이동"이 된다.
// 속도를 거의 그대로 남기고, 상한만 서서히 되돌려 그 속도를 반동으로 쓰게 한다.
const ZIP_KEEP = 0.5;     // 도착 시 남기는 속도 비율
const ZIP_MOMENT = 0.5;   // 상한이 MAX_SPEED로 돌아오기까지의 시간(초)
let boostT = 0;           // 남은 관성 유예
let boostCap = 0;         // 유예 시작 시점의 속도 (여기서 MAX_SPEED로 선형 하강)
let zip = null;
const _zv = new THREE.Vector3(), _zv2 = new THREE.Vector3();

// 조준점 주변까지 훑어 사거리 안의 앵커를 찾는다. 정중앙부터 시작해 점점 넓게.
const ZIP_ASSIST = [
  [0, 0],
  [0, 0.10], [0, -0.10], [0.10, 0], [-0.10, 0],
  [0.08, 0.08], [-0.08, 0.08], [0.08, -0.08], [-0.08, -0.08],
  [0, 0.20], [0, -0.20], [0.20, 0], [-0.20, 0],
  [0.16, 0.16], [-0.16, 0.16], [0.16, -0.16], [-0.16, -0.16],
];
const _zndc = new THREE.Vector2();

const MAX_SPEED = 112;
const SOFT_SPEED = 82;      // 이 위로는 하드 클램프 대신 드래그가 서서히 걸림
const DASH_SPEED = 58;
const DASH_CD = 0.8;
const CLIMB_SPEED = 25;
const TUMBLE_SPEED = 34;   // 지상 구르기 속도
const TUMBLE_AIR = 16;     // 공중제비 시 더해지는 전방 추진
const WALLJUMP_OUT = 24;
const WALLJUMP_UP = 17;

// --- 스윙 튜닝 노브 (여기만 만지면 감이 바뀝니다) ---
const ROPE_MAX = 150;       // 거미줄 사거리 = 최대 로프 길이. 에임원 색이 이 기준
const GRIP_TIME = 0.07;     // 로프가 완전히 물리기까지. 붙는 순간 덜컹거림 제거 (0.13은 굼떴다)
const REEL_RATE = 40;       // 로프 길이가 목표를 따라가는 속도 (m/s)
const REEL_MANUAL = 26;     // Space 홀드 시 줄을 감는 속도 (m/s)
const PUMP_DEPTH = 0.12;    // 호 바닥에서 로프가 줄어드는 비율 = 자동 펌핑 강도
const SWING_CONVERT = 0.995; // 낙하(반경) 속도를 접선 속도로 되돌리는 비율. 1이면 무손실
const CAM_ROLL = 0.5;       // 뱅킹 롤 강도
// 3인칭 카메라 충돌. 지금까지 아무 검사가 없어서 벽을 끼고 돌면 카메라가
// 건물 안으로 들어가 화면이 통째로 벽면으로 덮였다.
const CAM_WALL_PAD = 0.55;  // 벽에서 이만큼 앞에 서고 싶다
const CAM_MIN_DIST = 1.25;  // 머리에서 이만큼은 떨어지고 싶다
const CAM_NEAR_SKIN = 0.15; // 벽까지 최소한 이만큼은 남긴다. near 평면이 0.1이다
const CAM_HIDE_DIST = 1.1;  // 이보다 붙으면 몸 안이 보이므로 캐릭터를 숨긴다
// 3인칭 카메라가 발밑에서 얼마나 위에 있는가. 캐릭터를 2.4배로 키운 뒤 3.0m 는 허리 높이라 올렸다.
const CAM_RISE_3P = 5.5;
const CAM_PIVOT_Y = 1.7;    // 선분을 쏘는 기준점 높이 = 시선 높이
let camBlocked = false;     // 지금 벽에 막혀 있나 (테스트/디버그용)

// hitD에서 막혔을 때 카메라가 설 거리.
// 두 요구(벽에서 떨어지기 / 머리에서 떨어지기)가 부딪히면 벽이 이긴다 —
// 벽을 뚫는 것보다 캐릭터에 붙는 쪽이 훨씬 낫다. 벽에 등을 붙이고 서면
// 벽까지가 1m도 안 되므로 이 양보가 없으면 매번 벽을 뚫는다.
function camStandDist(hitD) {
  return Math.min(Math.max(CAM_MIN_DIST, hitD - CAM_WALL_PAD),
                  Math.max(0, hitD - CAM_NEAR_SKIN));
}

let camAuto = true;
// 직접 돌린 직후 자동 정렬이 곧바로 되당기면 "돌려놨는데 혼자 돌아간다"가 된다.
// 드래그를 놓고 이만큼은 자동이 손을 뗀다.
const CAM_FREE = 3.2;
let camFree = 0;
// C로 켠 수동 시점. 우클릭 드래그로 잠깐 물러난 것과 구분한다 —
// 드래그는 손을 떼면 자동으로 되돌아오지만, C 수동은 C를 다시 누를 때까지 유지된다.
let camHold = false;
let camMsg = 0;
let toast = "";        // 화면에 잠깐 띄우는 안내 문구
let toastT = 0;
function say(msg, t = 1.1) { toast = msg; toastT = t; }
let climbFx = 0;
let dragging = false;
let mx = innerWidth / 2;
let my = innerHeight / 2;
let viewYaw = Math.PI;
let viewPitch = 0.08;
let bodyYaw = Math.PI;
let prevSpace = false;
let wasGrounded = true;
let fallSpeed = 0;
let landFx = 0;   // 착지 애니메이션(Land) 유지 시간
let prevShift = false;
// --- 회피 ---
// 예고선이 떠 있는 동안 대시하면 회피가 된다. 딱 맞추면 슬로우모로 보상한다.
const DODGE_IFRAME  = 0.45;   // 회피 성공 시 무적 시간
const DODGE_PERFECT = 0.35;   // 예고 종료 이 시간 안에 피하면 '완벽'
const DODGE_SLOWMO  = 0.55;   // 완벽 회피 슬로우모 길이
let dodgeFx = 0;              // 회피 연출 잔량 (화면 테두리)
let perfectFx = 0;            // 완벽 회피 문구 잔량
let dodgeCount = 0, perfectCount = 0;


let hasDash = true;
let dashTimer = 0;
let dashKick = 0;
let pumpFx = 0;
let tumbleT = 0;        // 남은 덤블링 시간
let tumbleDur = 0;      // 이번 덤블링의 전체 길이 (회전 위상 계산용)
let firstPerson = false;
let armPulse = 0;
let fireKick = 0;        // 발사 반동 0..1
let climbMouse = false;  // 마우스 사이드 버튼(뒤로/앞으로)을 누르고 있는지
// 벽타기 입력: Ctrl 또는 마우스 좌측 사이드 버튼
function climbHeld() {
  // Ctrl은 락온으로 갔다. 벽타기는 마우스 뒤쪽 사이드 버튼 전담이다.
  return climbMouse;
}
let swayX = 0, swayY = 0;
let swayPrevYaw = 0, swayPrevPitch = 0;
let armExt = 0;
let clinging = null;
let sliding = false;
let lastWall = null;
let wallBump = 0;   // 벽에 세게 박았을 때의 연출 잔량
let mouseDownL = false;
let mouseDownR = false;
// 좌우 동시 클릭 판정 여유. 사람이 두 손가락을 정확히 같은 밀리초에 누르지는 못한다.
const ZIP_CHORD = 0.34;
// ---------- 양손 새총 (좌클릭 + 우클릭 + S) ----------
// 두 건물에 좌클릭·우클릭으로 줄을 따닥 걸고, S로 몸을 뒤로 당겨 힘을 모았다가
// 두 버튼을 다 놓는 순간 두 줄이 당기는 쪽으로 튕겨 나간다.
//
// 몸은 거의 안 움직인다. 아주 살짝 뒤로 밀리면서 속도가 죽을 뿐이다 — 그 정지가
// 있어야 놓는 순간의 가속이 크게 읽힌다. 충전량은 화면 게이지와 삐걱이는 소리로 알린다.
//
// 예전 슬링샷(좌+우+휠 세 버튼 홀드)을 이것으로 대체했다. 세 버튼은 외우기도,
// 누르기도 어려웠고 '양손으로 당긴다'는 그림이 조작에 드러나지 않았다.
const SLING_CHARGE_T = 1.1;   // 최대까지 차는 시간 (초)
const SLING_MIN_K    = 0.12;  // 이보다 덜 찼으면 그냥 줄을 놓은 것으로 본다
const SLING_V_MIN    = 46;    // 최소 충전 발사 속도 (m/s)
const SLING_V_MAX    = 95;    // 최대 충전 발사 속도
const SLING_BACK     = 6;     // 뒤로 당겨지는 가속 (m/s^2). 1초 물어도 1m 를 안 간다
const SLING_HOLD     = 7;     // 충전 중 속도가 죽는 세기
// 공중은 느낌이 다르다. 땅에서는 버티고 서서 힘을 모으지만, 공중에서는 붙잡을 데가 없으니
// 몸 자체가 새총의 돌이 된다 — 두 줄을 걸면 바로 뒤로 쭉 끌려갔다가 튕겨 나간다.
const SLING_AIR_DRAW = 17;    // 공중에서 뒤로 끌리는 거리 (m)
const SLING_AIR_T    = 0.8;   // 끝까지 끌리는 시간 (초)
const SLING_V_AIR    = 135;   // 공중 최대 충전 발사 속도. 상한(112)을 넘기므로 유예 가속을 쓴다
const SLING_GLIDE    = 1.8;   // 발사 뒤 이 시간 동안은 소프트캡과 중력을 덜 먹는다 (멀리 난다)
const SLING_AIR_STALL = 0.18; // 뒤에 벽이 있어 더 못 끌릴 때 이만큼 버티면 그냥 쏜다
let midDown = false;          // 휠 버튼. 지금은 쓰지 않지만 입력은 계속 받아둔다
let slingK = 0;               // 힘 0..1 (지상은 충전량, 공중은 끌려간 정도)
let slingCreak = 0;           // 다음 삐걱임까지 남은 시간
let slingCount = 0;
let slingAir = false;         // 공중 새총으로 끌려가는 중
let slingGlide = 0, slingSoft = 0;   // 발사 직후 유예 (속도가 깎이지 않게)
// 두 줄을 물기 시작한 순간의 상태로 모드를 고정한다. 줄이 팽팽해지면 땅에 서 있다가도
// 몸이 살짝 뜬다 — 그 한 순간에 지상 충전이 공중 새총으로 바뀌면 조작이 생각대로 안 간다.
let slingMode = "";           // "" | "ground" | "air"
let slingDrawn = 0, slingStall = 0;
const _slv = new THREE.Vector3(), _slt = new THREE.Vector3(), _slp = new THREE.Vector3();

// 두 줄이 당기는 방향 = 각 줄 방향(단위벡터)의 합
function slingDir(out) {
  if (!web || !web2) return false;
  out.copy(web.a).sub(player.pos);
  if (out.lengthSq() < 1e-6) return false;
  out.normalize();
  _slt.copy(web2.a).sub(player.pos);
  if (_slt.lengthSq() < 1e-6) return false;
  out.add(_slt.normalize());
  if (out.lengthSq() < 1e-6) return false;
  out.normalize();
  if (out.y < 0.12) { out.y = 0.12; out.normalize(); }   // 땅으로 처박는 발사는 막는다
  return true;
}
function slingArmed() { return slingK >= SLING_MIN_K && !!web && !!web2; }

// 좌우 클릭을 거의 같이 누르면 두 줄을 알아서 건다.
// 두 건물을 따로 조준해서 따닥 거는 건 실제로 해보면 너무 어렵다 — 조준은 한 번이면 된다.
const DUAL_WINDOW = 0.35;     // 좌우 클릭이 이 안에 들어오면 '동시'로 본다 (초)
const DUAL_SPREAD = 28;       // 두 앵커가 이만큼은 떨어져야 새총이 된다 (m)
// 좌우 한 쌍을 한 번에 고른다.
//
// 예전에는 '첫 줄을 조준해서 걸고, 그 옆에서 둘째를 찾는' 식이었다. 그러면 첫 줄이
// 어디에 붙느냐에 따라 두 줄이 한쪽으로 쏠려서, 내가 부채꼴의 중심이 아니라 끝에 매달렸다.
// 이제는 보는 방향을 가운데 축으로 두고, 그 **좌우 대칭**으로 한 쌍을 고른다.
// 내가 호의 중심에 서고 두 줄이 V 자로 벌어지는 그림이 되어야 새총이 새총으로 읽힌다.
const DUAL_YAW = [14, 22, 30, 38, 47, 57, 68, 80];   // 축에서 좌/우로 벌리는 각도
// 위로 올려다보는 각도. 옥상보다 높이 날 때는 걸 데가 아래에 있어 아래쪽까지 훑는다
const DUAL_PITCH = [40, 30, 21, 13, 6, -3, -12, -22];
const DUAL_IDEAL_YAW = 40;                    // 이 정도로 벌어진 게 가장 보기 좋다
const _dualO = new THREE.Vector3(), _dualD = new THREE.Vector3(), _dualS = new THREE.Vector3();
const _dualHit = new THREE.Vector3();

// 한쪽(sign = -1 왼쪽 / +1 오른쪽)에서 걸 수 있는 자리를 모은다
function scanDualSide(baseA, sign, out) {
  out.length = 0;
  for (const yd of DUAL_YAW) {
    const a = baseA + sign * yd * Math.PI / 180;
    for (const pd of DUAL_PITCH) {
      const cs = Math.cos(pd * Math.PI / 180), sy = Math.sin(pd * Math.PI / 180);
      _dualD.set(Math.sin(a) * cs, sy, Math.cos(a) * cs).normalize();
      _dualS.copy(_dualD).multiplyScalar(ROPE_MAX);
      if (!segHitWorld(_dualO, _dualS, _dualHit, SWING_MIN_LEN / ROPE_MAX)) continue;
      const d = player.pos.distanceTo(_dualHit);
      if (d < SWING_MIN_LEN || d > ROPE_MAX) continue;
      const up = _dualHit.y - player.pos.y;
      if (up < -55) continue;                 // 너무 깊은 아래에 걸면 새총이 아니라 추락이다
      out.push({ p: _dualHit.clone(), yaw: yd, d, up });
      break;                                  // 같은 각도에서는 가장 높이 걸리는 것 하나면 된다
    }
  }
  return out;
}

// 두 앵커가 얼마나 '부채꼴'인가.
//
// 중요한 건 시선 축에 딱 맞추는 게 아니라, 내가 두 줄의 **가운데**에 서는 것이다.
// 한쪽에 걸 건물이 없으면 부채꼴 자체를 좀 돌려서라도 대칭을 지키는 게 낫다.
// 그래서 축(두 줄의 이등분선)이 시선에서 벗어난 만큼만 감점한다.
function dualPairScore(L, R, maxBias, maxOpen) {
  const spread = L.p.distanceTo(R.p);
  if (spread < DUAL_SPREAD) return -Infinity;
  const bias = Math.abs(R.yaw - L.yaw) / 2;      // 축이 시선에서 기울어진 각도
  const open = (R.yaw + L.yaw) / 2;              // 부채꼴이 벌어진 각도 (한쪽)
  if (bias > maxBias || open > maxOpen) return -Infinity;   // 너무 많이 벌어지면 두 줄이 서로 반대로 당겨 힘이 죽는다
  return -bias * 1.4                                          // 축은 보는 쪽에 가까울수록 좋다
         - Math.abs(open - DUAL_IDEAL_YAW) * 0.9              // 적당히 벌어진 V 자
         - Math.abs(L.d - R.d) * 0.5                          // 거리 대칭
         - Math.abs(L.up - R.up) * 0.35                       // 높이 대칭
         - Math.max(0, (L.d + R.d) / 2 - 90) * 0.2            // 너무 멀면 감점
         + Math.min(L.up, R.up) * 0.15;                       // 둘 다 높을수록 좋다
}

const _dualL = [], _dualR = [];
// 보는 방향을 축으로 좌우 한 쌍을 고른다. 못 찾으면 null.
function findDualAnchors() {
  _dualO.set(player.pos.x, player.pos.y + 1.6, player.pos.z);
  const baseA = viewYaw;                      // 화면이 보는 쪽이 부채꼴의 축이다
  scanDualSide(baseA, -1, _dualL);
  scanDualSide(baseA, 1, _dualR);
  if (!_dualL.length || !_dualR.length) return null;
  // 대칭이 잘 맞는 쌍부터 찾고, 없으면 기준을 단계적으로 푸다
  for (const [maxBias, maxOpen] of [[10, 52], [20, 58], [32, 66], [999, 999]]) {
    let best = null, bestScore = -Infinity;
    for (const L of _dualL) for (const R of _dualR) {
      const sc = dualPairScore(L, R, maxBias, maxOpen);
      if (sc > bestScore) { bestScore = sc; best = { L: L.p, R: R.p }; }
    }
    if (best) return best;
  }
  return null;
}

// 좌우 동시 클릭에서 부른다. 두 줄을 좌우 대칭으로 새로 건다.
function autoDualWeb() {
  initAudio();
  const pair = findDualAnchors();
  if (!pair) {
    // 한 쌍을 못 찾으면 평범한 스윙으로 떨어진다 (줄 하나라도 걸리게)
    if (!web) return tryAttach();
    return false;
  }
  releaseWeb(); releaseWeb2();
  attachWeb(pair.R, "R");        // 오른손은 오른쪽 앵커
  attachWeb2(pair.L);            // 보조 줄은 반대 손에서 나간다
  web2Held = true;
  armPulse = 0.35;
  return true;
}

// 새총을 당기는 중인가 (보조 웹의 조향력을 끄고, 게이지를 지상에서만 띄우는 데 쓴다)
function slingPulling() { return slingK > 0 || slingAir; }

function fireSling() {
  if (!slingArmed() || !slingDir(_slv)) { slingK = 0; return false; }
  const k = slingK;
  const vmax = slingAir ? SLING_V_AIR : SLING_V_MAX;   // 공중이 더 세다 — 몸 전체가 돌이 되어 날아간다
  const v = SLING_V_MIN + (vmax - SLING_V_MIN) * k;
  slingK = 0;
  player.vel.copy(_slv).multiplyScalar(v);
  // 상한을 넘겨 쏜다. 유예가 없으면 다음 프레임에 그대로 잘려서 세게 쏜 티가 안 난다.
  boostCap = Math.max(MAX_SPEED, v);
  boostT = ZIP_MOMENT;
  slingGlide = SLING_GLIDE;
  slingSoft = v;
  slingAir = false; slingDrawn = 0; slingStall = 0; slingMode = "";
  releaseWeb();
  releaseWeb2();
  web2Held = false;
  hasDash = true;
  slingCount++;
  shake = Math.max(shake, 0.5 + k * 0.4);
  pumpFx = Math.max(pumpFx, 0.6);
  sfxDash();
  return true;
}

function updateSling(dt) {
  const both = !!web && !!web2 && !clinging;
  const holding = both && mouseDownL && mouseDownR;
  if (!holding) slingMode = "";
  // 발밑 높이로 가른다. grounded 만 보면, 줄을 거는 순간 몸이 한 테이크 뜸 때 공중으로 찍힌다.
  else if (!slingMode) {
    const gh = groundHeightAt(player.pos.x, player.pos.z, player.pos.y);
    slingMode = player.grounded || player.pos.y - gh < 3.5 ? "ground" : "air";
  }

  // ── 공중: S 없이, 두 줄을 걸고 두 버튼을 물면 그 순간부터 뒤로 쭉 끌린다 ──
  if (holding && slingMode === "air") {
    if (!slingAir) { slingAir = true; slingDrawn = 0; slingStall = 0; slingK = 0; }
    if (slingDir(_slt)) {
      _slp.copy(player.pos);
      // 뒤로 끌려가는 속도. 줄은 그만큼 늘어난다 (안 늘리면 로프 구속이 도로 잡아당긴다)
      player.vel.copy(_slt).multiplyScalar(-SLING_AIR_DRAW / SLING_AIR_T);
      const dw = Math.max(0, player.pos.distanceTo(web.a) + 0.4);
      if (dw > web.len) { web.len = dw; web.base = dw; }
      const moved = _slp.distanceTo(player.prevPos);
      slingDrawn += moved;
      slingStall = moved < (SLING_AIR_DRAW / SLING_AIR_T) * dt * 0.3 ? slingStall + dt : 0;
      slingK = Math.min(1, slingDrawn / SLING_AIR_DRAW);
      slingCreak -= dt;
      if (slingCreak <= 0) { slingCreak = 0.12; sfxStrain(slingK); }
      // 끝까지 끌렸거나(또는 뒤가 막혔거나) 하면 손을 안 떼도 저절로 나간다
      if (slingDrawn >= SLING_AIR_DRAW || slingStall > SLING_AIR_STALL) { slingK = Math.max(slingK, SLING_MIN_K); fireSling(); }
    }
    return;
  }
  if (slingAir) {                       // 공중에서 당기다 버튼을 놓았다 — 끌린 만큼 나간다
    slingAir = false;
    if (slingK >= SLING_MIN_K && both) { fireSling(); return; }
    slingK = 0; slingDrawn = 0;
    if (!mouseDownL && web) releaseWeb();
    if (!mouseDownR) web2Held = false;
    return;
  }

  // ── 지상: S로 버티며 힘을 모은다 ──
  if (holding && slingMode === "ground" && keys["KeyS"]) {
    slingK = Math.min(1, slingK + dt / SLING_CHARGE_T);
    const k2 = Math.exp(-SLING_HOLD * dt);
    player.vel.multiplyScalar(k2);                       // 제자리에 붙잡힌다
    player.vel.y += G * dt;                              // 두 줄이 몸을 받친다 — 안 상쇄하면 1초에 8m 가라앉는다
    if (slingDir(_slt)) player.vel.addScaledVector(_slt, -SLING_BACK * dt);   // 아주 살짝 뒤로
    slingCreak -= dt;
    if (slingCreak <= 0) { slingCreak = 0.17 - slingK * 0.08; sfxStrain(slingK); }
    return;
  }
  if (slingK <= 0) return;
  if (!both) { slingK = 0; return; }                              // 줄이 끊겼다
  if (!mouseDownL && !mouseDownR) { fireSling(); return; }        // 두 버튼을 다 놓았다 = 발사
  slingK = Math.max(0, slingK - dt / 0.5);                        // S만 뗐다 — 힘이 빠진다
  if (slingK === 0 && !mouseDownL) releaseWeb();                  // 안 나갔으면 그냥 놓는다
}

let lClickT = -1, rClickT = -1;
let diving = false;
let diveFx = 0;      // 급강하 연출 강도 0..1 (서서히 차오르고 서서히 빠진다)
let camRoll = 0;
// 1인칭 화면 롤 세기. 0이면 화면은 수평을 지키고 몸만 기운다.
//
// 레퍼런스 영상의 가장 큰 특징이 이 롤이다 — 거의 모든 컷에서 수평선이
// 20~60도 누워 있고 완전히 뒤집힌 컷도 있다. 그런데 그게 정확히 멀미를
// 만드는 것이기도 하다. 그래서 값 하나로 두지 않고 설정으로 뺀다.
let fpRoll = 0.45;
// ---------- 시네마틱 카메라 ----------
// 문서 01 §22. 컷신을 남발하지 않는다. 조작을 뺏지 않고 **짧게 얹기만** 한다.
//   Base Follow + Cinematic Offset = Final Camera
// 시야각과 거리만 건드린다. 각도를 뺏으면 그 순간이 곧 버그로 읽힌다.
const CINE_MAX = 0.9;
let cineT = 0, cineKind = "", cineCd = 0, cineCount = 0;
function cineFire(kind, strength) {
  if (cineCd > 0) return false;
  cineT = CINE_MAX * Math.min(1, strength === undefined ? 1 : strength);
  cineKind = kind;
  cineCd = 2.4;                    // 최근에 한 번 했으면 가중치를 낮춘다
  cineCount++;
  return true;
}
// 지금 프레임의 연출 세기 0..1
function cineAmt() { return cineT > 0 ? cineT / CINE_MAX : 0; }
let aimPreview = null;
let aimAuto = false;        // 지금 미리보기가 자동 앵커인가 (조준이 빗나갔다는 뜻)
let aimTick = 0;
const lookTarget = new THREE.Vector3();

const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const crosshairEl = document.getElementById("crosshair");
const hudEl = document.getElementById("hud");

// 메뉴가 떠 있는 동안은 물리를 멈춘다. 화면은 계속 그린다.
// 결과 화면이 떠 있는 동안. 물리는 계속 돌되 조작만 막는다 —
// 통째로 얼리면 착지하다 공중에 굳어서 다시 시작할 때 어색하다.


let charPop = 0;                     // 모델이 살짝 커졌다 돌아오는 잔량



let uiMode = 0;        // 0 전체 · 1 최소 · 2 없음 (H키로 순환)

// ================== 설정 ==================
// 조준 방식은 시작 화면과 F1(일시정지) 둘 다에서 바꾼다. 어디서 바꾸든 같은
// 상태 하나(aimCenter)를 만지고, 칩은 그 상태를 다시 그린다.
// 단축키로만 바꿀 수 있던 것들을 전부 설정으로 끌어올린다.
// 표 하나로 두 화면(시작 화면 / F1)을 같이 칠한다 — 두 군데서 따로 만지면
// 반드시 어긋난다. 단축키(O·C·P)도 여기 set()을 부른다.
// ================== 시간 배속 · 접근성 ==================
// 문서 02 §10. hit stop · 연출 슬로모션 · 접근성 속도를 변수 하나에 엉키게
// 두지 않는다. 각자 따로 두고 쓰는 자리에서 곱한다.
//   speedBase  접근성 설정 (사용자가 고른 전체 속도)
// 여기서 새로 만드는 건 speedBase 하나뿐이다. 나머지는 제자리에 있다.
let speedBase = 1;
function timeScale() { return speedBase; }
// 접근성: 화면 흔들림 세기, 소리 켜기 (문서 02 §9)
let shakeScale = 1;
let audioOn = true;





const SETTINGS = {
  aim: {
    get: () => aimCenter,
    opts: [
      { v: false, label: "커서", desc: "마우스가 조준점을 옮긴다. 시점은 우클릭 드래그" },
      { v: true,  label: "중앙", desc: "조준점이 화면 중앙 고정, 마우스 = 시점 (어깨너머 카메라)" },
    ],
    set(v) {
      if (aimCenter === v) return;
      aimCenter = v;
      dragging = false;
      if (aimCenter) {
        camAuto = false;
        if (!firstPerson) requestLook();
        crosshairEl.style.left = "50%";
        crosshairEl.style.top = "50%";
      } else if (!firstPerson) {
        document.exitPointerLock();
        crosshairEl.style.left = mx + "px";
        crosshairEl.style.top = my + "px";
        camAuto = !camHold;
      }
    },
  },
  cam: {
    get: () => !camAuto,
    opts: [
      { v: false, label: "자동", desc: "진행 방향으로 시점이 따라온다" },
      { v: true,  label: "수동", desc: "오직 내가 돌린 대로만. 중앙 조준에서는 항상 수동이다" },
    ],
    set(v) { camHold = v; camAuto = !v; camMsg = 1.6; },
  },
  ui: {
    get: () => uiMode,
    opts: [
      { v: 0, label: "전체", desc: "전부 보인다" },
      { v: 1, label: "최소", desc: "체력·궁·조준점만. 속도계·목표·스킬칸이 사라진다" },
      { v: 2, label: "없음", desc: "조준점만 남는다. 웹스윙에만 집중하고 싶을 때 (H키)" },
    ],
    set(v) {
      uiMode = v;
      document.body.classList.toggle("ui-min", v === 1);
      document.body.classList.toggle("ui-off", v === 2);
    },
  },
  speed: {
    get: () => speedBase,
    opts: [
      { v: 0.75, label: "느리게", desc: "전체 속도 75%. 조작이 벅찰 때" },
      { v: 1,    label: "보통",   desc: "기본 속도" },
      { v: 1.15, label: "빠르게", desc: "전체 속도 115%" },
    ],
    set(v) { speedBase = v; },
  },
  roll: {
    get: () => fpRoll,
    opts: [
      { v: 0,    label: "없음", desc: "1인칭에서 화면이 안 기운다. 멀미가 가장 적다" },
      { v: 0.45, label: "약",   desc: "살짝 기운다. 기본값" },
      { v: 1,    label: "강",   desc: "레퍼런스 영상처럼 크게 눕는다. 어지러울 수 있다" },
    ],
    set(v) { fpRoll = v; },
  },
  shake: {
    get: () => shakeScale,
    opts: [
      { v: 0,   label: "없음", desc: "화면이 안 흔들린다" },
      { v: 0.5, label: "약",   desc: "절반만" },
      { v: 1,   label: "보통", desc: "기본" },
    ],
    set(v) { shakeScale = v; },
  },
  audio: {
    get: () => audioOn,
    opts: [
      { v: true,  label: "켬", desc: "효과음을 낸다" },
      { v: false, label: "끔", desc: "전부 음소거" },
    ],
    set(v) { audioOn = v; setAudioEnabled(v); },
  },
  view: {
    get: () => firstPerson,
    opts: [
      { v: false, label: "3인칭", desc: "몸이 보인다. 웹스윙과 근접 격투는 이쪽이 편하다" },
      { v: true,  label: "1인칭", desc: "조준점이 화면 중앙 고정. 사격이 정확하다" },
    ],
    set(v) {
      if (firstPerson === v) return;
      firstPerson = v;
      spiderGroup.visible = !firstPerson;
      dragging = false;
      if (firstPerson) { camAuto = false; requestLook(); }
      else if (!aimCenter) { document.exitPointerLock(); camAuto = !camHold; lookIdle = 0; }
    },
  },
};
// 설정은 메모리에만 둔다 — 진행도 저장을 없앴다. 껐다 켜면 기본값이다.
function setOpt(key, v) {
  SETTINGS[key].set(v);
  drawSettings();
}

function setAim(v) { setOpt("aim", v); }        // 예전 이름을 남겨둔다
function drawSettings() {
  for (const key of Object.keys(SETTINGS)) {
    const S = SETTINGS[key], cur = S.get();
    document.querySelectorAll('.chips[data-set="' + key + '"]').forEach(box => {
      box.innerHTML = S.opts.map((o, i) =>
        '<button class="chip' + (o.v === cur ? ' on' : '') + '" data-v="' + i + '">' + o.label + '</button>').join("");
      box.querySelectorAll(".chip").forEach(b => b.onclick = () => setOpt(key, S.opts[+b.dataset.v].v));
    });
    const txt = (S.opts.find(o => o.v === cur) || S.opts[0]).desc;
    for (const id of [key + "Desc", key + "Desc2"]) {
      const d = document.getElementById(id);
      if (d) d.textContent = txt;
    }
  }
}
// aimCenter는 이 아래에서 선언된다. 여기서 바로 부르면 TDZ에 걸리므로 한 박자 미룬다.
// 저장본의 설정을 먼저 적용하고 그린다. TDZ 때문에 한 틱 미룬다.
// 부팅 화면을 닫는다. 도시·모델이 다 선 뒤에.
function bootDone() {
  const el = document.getElementById("boot");
  if (!el) return;
  const p = document.getElementById("bootProg");
  if (p) p.style.width = "100%";
  const m = document.getElementById("bootMsg");
  if (m) m.textContent = "준비 완료";
  el.classList.add("gone");
  setTimeout(() => el.classList.remove("show"), 320);
}
function bootStep(pct, msg) {
  const p = document.getElementById("bootProg");
  if (p) p.style.width = Math.max(0, Math.min(100, pct)) + "%";
  const m = document.getElementById("bootMsg");
  if (m && msg) m.textContent = msg;
}

setTimeout(() => {
  // 1인칭이 기본이다. 레퍼런스가 1인칭이고, 이 빌드는 이동 감각만 보는 판이다.
  setOpt("aim", true);
  setOpt("view", true);
  bootStep(70, "모델을 불러오는 중…");
  // 뉴욕 소품. 도시가 전부 만들어진 뒤에 부른다 — 모델 객체는 GLB 로드가 끝난
  // 뒤에 생기므로 도시 생성 난수열에 끼어들지 않는다. 파일이 없으면 조용히 넘어간다.
  initNycProps({
    scene, GLTFLoader, mergeGeometries,
    buildings, blocks, SIDEWALK_W, CURB_H, ST_ROAD_W, AVE_ROAD_W,
    groundAt: groundHeightAt,
    lamps: lampHandle, plazas, nearBoxes: nearbyBuildings,
    carList: cars, carBodyMesh, carTopMesh,
  }).catch(e => console.warn("[NYC] 소품 로드 실패", e));
  // 첫 프레임이 실제로 그려진 뒤에 닫는다. 먼저 닫으면 검은 화면이 잠깐 보인다.
  requestAnimationFrame(() => requestAnimationFrame(bootDone));
  // 안전장치: 탭이 뒤에 있으면 브라우저가 rAF 를 멈춰서 위 줄이 영영 안 돈다.
  // 그대로 두면 로딩 화면에 갇힌다. 실제로 그렇게 됐다.
  setTimeout(bootDone, 4000);
}, 0);
const optsEl = document.getElementById("opts");
document.getElementById("btnOptsBack").onclick = () => optsEl.classList.remove("show");
document.getElementById("btnResume").onclick = () => hudEl.classList.remove("show");
// 일시정지에서 바로 미션·튜토리얼로 (문서 02 §3)
// 캐릭터 미리보기 조명.
//
// 처음엔 점광원을 세웠는데 벽과 바닥만 환해지고 모델은 그대로 어두웠다.
// 도시가 밤이면 주변 조명이 거의 없어서 어느 각도에 놔도 모델에 닿는 빛이 부족하다.
// 그래서 조명을 세우는 대신 모델 재질을 직접 밝힌다 — 배경이 아무리 어두워도
// 모델만 확실히 뜬다. 고른 캐릭터 색으로 물들여서 어느 쪽을 골랐는지도 같이 보인다.
let charMats = null;                     // 원래 emissive를 기억해 뒀다가 되돌린다
const _menuAt = new THREE.Vector3();
crosshairEl.style.left = `${mx}px`;
crosshairEl.style.top = `${my}px`;

// 1인칭은 항상 화면 정중앙. 포인터락이 풀려도 조준 기준이 흔들리면 안 된다.
// 3인칭은 커서가 곧 조준점이다. 시점(우클릭 드래그)과 조준(커서)이 따로 논다.
// --- 조준 방식 (O키로 전환. 어느 쪽이 나은지 직접 눌러보고 정하려고 토글로 뒀다) ---
//
// 기본(커서 조준): 마우스가 조준점을 옮기고, 시점은 우클릭 드래그가 맡는다.
//   마우스 하나가 조준과 시점 두 가지 일을 해서, 적을 겨누면서 시점을 돌릴 수가 없다.
//
// 중앙 조준(오버워치 / PS4 스파이더맨): 조준점을 화면 정중앙에 박고 마우스는 시점만
//   돌린다. 대신 카메라를 어깨 뒤로 붙이고 캐릭터를 한쪽으로 비켜 세워 중앙을 비운다.
//   1인칭과 같은 체계가 되어 손이 훨씬 단순해진다.
let aimCenter = false;
const CAM_SHOULDER = 0.85;   // 어깨너머 옆 오프셋(m). 크면 근거리 시차가 커진다
const CAM_TIGHT = 0.72;      // 중앙 조준일 때 카메라 거리 배율

function cursorNdc() {
  if (firstPerson || aimCenter) return _ndc.set(0, 0);
  return _ndc.set((mx / innerWidth) * 2 - 1, -(my / innerHeight) * 2 + 1);
}

// 조준 대상. 나중에 장애물/적을 추가하면 addAimTarget()으로 여기 넣으면 된다.
// 건물 종류마다 메시가 따로라 전부 조준 표적에 넣어야 어느 건물에든 거미줄이 걸린다
const aimTargets = [...cityMeshes, propMesh, ledgeMesh, sidewalkMesh, ground];
function addAimTarget(obj) { if (!aimTargets.includes(obj)) aimTargets.push(obj); }

// 조준선이 맞은 지점을 그대로 돌려준다. 보정도, 스냅도, 자동 탐색도 없다.
// 화면에 보이는 그 점에 정확히 붙는 것이 유일한 규칙.
function resolveAnchor() {
  // 조준선 기준. 최소 길이는 여기서 바로 걸러 코앞 벽에 붙는 걸 막는다.
  // (3인칭은 카메라가 뒤에 있어 aimHit이 사거리를 알아서 늘려준다)
  const p = aimHit(ROPE_MAX, SWING_MIN_LEN);
  if (!p) return null;
  const d = player.pos.distanceTo(p);
  if (d > ROPE_MAX) return null;
  // 자동 앵커와 같은 최소 조건. 코앞 벽에 걸면 줄이 ROPE_MIN으로 잘려
  // 그네가 아니라 벽에 그대로 처박힌다. 실제로 여기서 스윙이 죽었다.
  if (d < SWING_MIN_LEN) return null;
  // 발밑을 조준하면 그네가 아니라 추락이다
  if (p.y - player.pos.y < -14) return null;
  return p.clone();
}

function attachWeb(point, hand) {
  const d = Math.max(player.pos.distanceTo(point), ROPE_MIN);
  // 어느 손으로 잡는가. 자동 앵커가 골라줬으면 그걸 쓰고(문서 §18),
  // 아니면 예전처럼 지점의 좌우로 정한다. 조준해서 쏜 경우가 후자다.
  web = { a: point.clone(), len: d, base: d, t: 0, side: hand || sideOf(point) };
  hasDash = true;
  armPulse = 0.35;
  sfxThwip();
}

function releaseWeb() {
  // 빠르게 놓으면 짧게 시야가 트인다 (문서 01 §22 의 Web Release)
  if (web && player.vel.length() > 34) cineFire("release", Math.min(1, player.vel.length() / 70));
  web2 = null;
  web = null;
}

// --- 자동 앵커 (터치 전용) ---
const AUTO_YAW = [0, 18, -18, 36, -36, 55, -55];   // 진행 방향 기준 좌우
const AUTO_PITCH = [22, 34, 46, 16, 56, 8, 0, -8]; // 위로 올려다보는 각도 (수평 아래까지)
const _aDir = new THREE.Vector3(), _aOrigin = new THREE.Vector3();
const _aStep = new THREE.Vector3(), _aHit = new THREE.Vector3();

// 스윙하기 좋은 앵커인가를 점수로 매긴다.
// 왜 떨어졌는지. 디버그 패널이 읽는다 (문서 03 §43) —
// 점수만 보면 "왜 이 건물이 후보에서 빠졌지"를 끝내 알 수 없다.
let scoreWhy = "";
function scoreAnchor(p, fx, fz) {
  scoreWhy = "";
  const dx = p.x - player.pos.x, dy = p.y - player.pos.y, dz = p.z - player.pos.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < SWING_MIN_LEN) { scoreWhy = "짧음"; return -1; }   // 너무 짧으면 덜컹
  if (len > ROPE_MAX) { scoreWhy = "멂"; return -1; }          // 너무 길면 안 당겨짐
  if (dy < -14) { scoreWhy = "아래"; return -1; }        // 너무 아래면 그네가 아니라 추락이다
  const h = Math.hypot(dx, dz) || 1;
  const fwd = (dx / h) * fx + (dz / h) * fz;        // 진행 방향과의 일치도 (-1..1)
  if (fwd < -0.15) { scoreWhy = "뒤"; return -1; }      // 뒤쪽은 버린다
  // 줄 길이는 최대의 45~85%가 가장 좋은 호를 만든다
  const r = len / ROPE_MAX;
  const lenScore = 1 - Math.min(1, Math.abs(r - 0.62) / 0.45);
  // 머리 바로 위는 그네가 아니라 정지다
  const steep = Math.min(1, Math.hypot(dx, dz) / Math.max(1, Math.abs(dy)));
  // 높을수록 좋지만 필수는 아니다. 스카이라인 위를 날 때도 걸 데가 있어야 한다.
  const highScore = Math.max(0, Math.min(1, (dy + 14) / 45));
  return fwd * 1.5 + lenScore * 1.2 + steep * 0.8 + highScore * 1.1;
}


// ---------- AUTO ANCHOR V2 (문서 03 §9~§12) ----------
// legacy 는 viewYaw 하나만 봤다. V2 는 카메라 + 관성 + WASD + 선회를 합친
// '의도 벡터'로 방향을 정하고, 후보마다 어느 손이 잡을지까지 고른다.
//
// 레이는 한 번만 쏜다. 손별로 부채꼴을 두 번 쏘면 비용이 두 배인데,
// 채점은 공짜다 — 맞은 지점마다 왼손/오른손 두 점수를 내고 좋은 쪽을 쓴다.
let autoV2 = true;                  // F4 로 legacy 와 비교한다
let autoHand = null;                // 마지막 탐색이 고른 손
const _v2Ctx = { px:0, py:0, pz:0, vx:0, vz:0, camYaw:0, moveX:0, moveZ:0,
                 hand:"R", lastHand:null, ropeMax:ROPE_MAX, minLen:SWING_MIN_LEN };
let lastAutoHand = null;      // 직전에 쓴 손 — 교대 보너스의 기준 (문서 §18)

function findSwingAnchorV2() {
  _v2Ctx.px = player.pos.x; _v2Ctx.py = player.pos.y; _v2Ctx.pz = player.pos.z;
  _v2Ctx.vx = player.vel.x; _v2Ctx.vz = player.vel.z;
  _v2Ctx.camYaw = viewYaw;
  // 지금 눌려 있는 이동 입력. 의도의 절반이 여기서 나온다.
  let ix = 0, iz = 0;
  if (keys["KeyW"]) iz -= 1;
  if (keys["KeyS"]) iz += 1;
  if (keys["KeyA"]) ix -= 1;
  if (keys["KeyD"]) ix += 1;
  if (stickLen > 0.08) { ix = stickX; iz = stickY; }
  _v2Ctx.moveX = ix; _v2Ctx.moveZ = iz;
  // 지금 줄을 잡고 있으면 그 손이 직전 손이다. 놓은 뒤라면 마지막으로 쓴 손.
  _v2Ctx.lastHand = web ? web.side : lastAutoHand;

  const intent = intentDir(_v2Ctx);
  // 부채꼴은 의도 방향을 중심으로 편다. legacy 는 시선 중심이었다 —
  // 그래서 고개와 진행 방향이 다르면 엉뚱한 데를 훑었다.
  const baseA = Math.atan2(intent.x, intent.z);
  _aOrigin.set(player.pos.x, player.pos.y + 1.6, player.pos.z);
  dbgBegin();

  let best = null, bestScore = -Infinity, bestHand = "R";
  const fan = fanYaw(null);          // 손 편향은 채점에서 준다 (레이는 공용)
  for (const yd of fan) {
    const a = baseA + yd * Math.PI / 180;
    for (const pd of FAN_PITCH) {
      const c = Math.cos(pd * Math.PI / 180), sy = Math.sin(pd * Math.PI / 180);
      _aDir.set(Math.sin(a) * c, sy, Math.cos(a) * c).normalize();
      _aStep.copy(_aDir).multiplyScalar(ROPE_MAX);
      if (!segHitWorld(_aOrigin, _aStep, _aHit, 18 / ROPE_MAX)) continue;

      _v2Ctx.hand = "R";
      const rR = scoreAnchorV2(_aHit, _v2Ctx, intent);
      _v2Ctx.hand = "L";
      const rL = scoreAnchorV2(_aHit, _v2Ctx, intent);
      const useR = rR.score >= rL.score;
      const sc = useR ? rR.score : rL.score;
      const hand = useR ? "R" : "L";
      const why = useR ? rR.why : rL.why;

      if (dbgOn()) dbgCand(_aHit, sc, sc > -1, why, hand);
      if (sc > -1 && sc > bestScore) { bestScore = sc; best = _aHit.clone(); bestHand = hand; }
    }
  }
  autoHand = best ? bestHand : null;
  if (autoHand) lastAutoHand = autoHand;
  dbgPick(best);
  return best;
}

// legacy. 지우지 않는다 — F4 로 언제든 되돌려 비교할 수 있어야
// "V2 가 정말 나아졌나"를 감이 아니라 화면으로 판단할 수 있다 (문서 §12).
function findSwingAnchorLegacy() {
  // 보는 쪽을 기준으로 삼는다. 속도 기준으로 하면 시선과 다른 데 붙어서
  // "왜 저기에 걸리지"가 되고, 조작이 통제 불능으로 느껴진다.
  const fx = Math.sin(viewYaw), fz = Math.cos(viewYaw);
  _aOrigin.set(player.pos.x, player.pos.y + 1.6, player.pos.z);
  dbgBegin();                       // 이번 탐색의 후보를 새로 담는다
  let best = null, bestScore = -Infinity;
  for (const yd of AUTO_YAW) {
    const a = Math.atan2(fx, fz) + yd * Math.PI / 180;
    for (const pd of AUTO_PITCH) {
      const c = Math.cos(pd * Math.PI / 180), sy = Math.sin(pd * Math.PI / 180);
      _aDir.set(Math.sin(a) * c, sy, Math.cos(a) * c).normalize();
      // Raycaster로 InstancedMesh를 훑으면 1발에 0.88ms — 40발이면 프레임이 죽는다.
      // 탄 충돌과 같은 공간 해시를 쓴다. 18m 안쪽은 무시해야 벽에 붙어서도 걸 곳을 찾는다.
      _aStep.copy(_aDir).multiplyScalar(ROPE_MAX);
      if (!segHitWorld(_aOrigin, _aStep, _aHit, 18 / ROPE_MAX)) continue;
      const sc = scoreAnchor(_aHit, fx, fz);
      if (dbgOn()) dbgCand(_aHit, sc, sc > -1, scoreWhy, yd < 0 ? "L" : yd > 0 ? "R" : "C");
      if (sc > -1 && sc > bestScore) { bestScore = sc; best = _aHit.clone(); }
    }
  }
  dbgPick(best);
  return best;
}

// 실제로 불리는 쪽. autoV2 하나로 갈아끼운다.
function findSwingAnchor() {
  return autoV2 ? findSwingAnchorV2() : findSwingAnchorLegacy();
}


// ---------- 웹 디버그 오버레이 (문서 03 §42 · §43) ----------
// 자유 웹은 튜닝이 8할이다. 이게 없으면 "왜 저 건물에 걸렸지"를
// 추측으로 고치게 된다. AUTO ANCHOR V2 보다 이걸 먼저 만든 이유다.
//
// 표식은 **켤 때** 만든다. 선언 자리에서 만들면 uuid 가 Math.random 을
// 먹어 도시 생성 난수열이 통째로 밀린다. npm run rng 이 이걸 지킨다.
let dbgMarks = null, dbgVelLine = null, dbgPanelEl = null, dbgTick = 0, dbgScan = 0;
const _dbgM = new THREE.Matrix4();
const _dbgQ = new THREE.Quaternion();
const _dbgS = new THREE.Vector3();
const _dbgP = new THREE.Vector3();
const _dbgC = new THREE.Color();

function ensureDbgMarks() {
  if (dbgMarks) return;
  const geo = new THREE.SphereGeometry(1, 8, 6);
  const mat = new THREE.MeshBasicMaterial({ depthTest: false, toneMapped: false });
  dbgMarks = new THREE.InstancedMesh(geo, mat, MAX_CAND);
  dbgMarks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dbgMarks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX_CAND * 3), 3);
  dbgMarks.frustumCulled = false;
  dbgMarks.renderOrder = 998;
  dbgMarks.visible = false;
  scene.add(dbgMarks);
  // 속도 벡터. 지금 어디로 가고 있는지가 안 보이면 의도 벡터를 못 읽는다.
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
  dbgVelLine = new THREE.Line(lg, new THREE.LineBasicMaterial({
    color: 0x4affc8, depthTest: false, toneMapped: false }));
  dbgVelLine.frustumCulled = false;
  dbgVelLine.renderOrder = 998;
  dbgVelLine.visible = false;
  scene.add(dbgVelLine);
}

function toggleWebDbg() {
  const v = setDbg(!dbgOn());
  if (v) ensureDbgMarks();
  if (dbgMarks) { dbgMarks.visible = v; dbgVelLine.visible = v; }
  if (dbgPanelEl) dbgPanelEl.classList.toggle("show", v);
  say(v ? "웹 디버그 ON (F3)" : "웹 디버그 OFF", 1.6);
  return v;
}

// 웹 상태 한 줄. "R 연결 34.2m" 같은 형태.
function dbgWebLine(w, hand) {
  if (!w) return "없음";
  return `${hand} 연결  길이 ${w.len.toFixed(1)}m / 기준 ${w.base.toFixed(1)}m  경과 ${w.t.toFixed(2)}s`;
}

function updateWebDbg(dtReal) {
  if (!dbgOn()) return;
  ensureDbgMarks();

  // 후보를 계속 채워둔다. 데스크톱에서는 조준선으로 붙기 때문에
  // 가만히 두면 자동 앵커가 아예 안 돌아 후보가 빈 채로 남는다.
  // 6Hz. 한 번에 0.08ms 라 이 정도는 프레임에 영향이 없다.
  dbgScan -= dtReal;
  if (dbgScan <= 0) { dbgScan = 1 / 6; findSwingAnchor(); }

  const cs = dbgCands(), pi = dbgPickIdx();
  for (let i = 0; i < MAX_CAND; i++) {
    const c = i < cs.length ? cs[i] : null;
    if (!c) { _dbgS.setScalar(0); _dbgP.set(0, -9999, 0); }
    else {
      _dbgP.set(c.x, c.y, c.z);
      // 멀수록 크게 그려 화면상 크기를 유지한다 (앵커 미리보기와 같은 방식)
      const d = camera.position.distanceTo(_dbgP);
      _dbgS.setScalar(Math.max(0.5, d * (i === pi ? 0.016 : 0.008)));
      _dbgC.setHex(i === pi ? 0xffd24a : c.ok ? 0x5fff8a : 0xff5f6a);
      dbgMarks.setColorAt(i, _dbgC);
    }
    _dbgM.compose(_dbgP, _dbgQ, _dbgS);
    dbgMarks.setMatrixAt(i, _dbgM);
  }
  dbgMarks.instanceMatrix.needsUpdate = true;
  if (dbgMarks.instanceColor) dbgMarks.instanceColor.needsUpdate = true;

  const pa = dbgVelLine.geometry.attributes.position.array;
  pa[0] = player.renderPos.x; pa[1] = player.renderPos.y + 1.4; pa[2] = player.renderPos.z;
  pa[3] = pa[0] + player.vel.x * 0.35;
  pa[4] = pa[1] + player.vel.y * 0.35;
  pa[5] = pa[2] + player.vel.z * 0.35;
  dbgVelLine.geometry.attributes.position.needsUpdate = true;

  // 글자는 10Hz. 매 프레임 innerHTML 을 갈면 그 자체가 프레임을 먹는다.
  dbgTick -= dtReal;
  if (dbgTick > 0) return;
  dbgTick = 0.1;
  if (!dbgPanelEl) {
    dbgPanelEl = document.getElementById("wdbg");
    if (!dbgPanelEl) return;
    dbgPanelEl.classList.add("show");
  }
  const pri = web ? web.side : "—";
  dbgPanelEl.textContent = dbgLines({
    aim: firstPerson ? "1인칭(중앙)" : aimCenter ? "중앙" : "커서",
    view: firstPerson ? "1P" : "3P",
    webMode: autoV2 ? "V2(의도)" : "legacy(시선)",
    webR: dbgWebLine(web, pri),
    webL: dbgWebLine(web2, web ? otherSide(web.side) : "—"),
    primary: pri,
    lastHand: pri,
    anchor: web ? web.a : dbgPicked(),
    speed: player.vel.length(),
    vel: player.vel,
    intent: (() => { const i = intentDir(_v2Ctx); return { x: i.x, y: i.speedK, z: i.z }; })(),
    plantT: plantT, plantCd: plantCd, cling: !!clinging,
    camDist: camera.position.distanceTo(player.renderPos),
    fov: camera.fov, roll: camRoll,
    acro: acroCount, cine: cineCount, vclimb: vcCount,
  }).join(String.fromCharCode(10));
}

// 붙을 지점 미리보기. 벽에 가려도 보여야 하므로 깊이검사를 끈다.
const swingMark = new THREE.Group();
{
  const core = new THREE.Mesh(new THREE.SphereGeometry(1.5, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0x6ff0ff, depthTest: false, toneMapped: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(3.4, 4.4, 24),
    new THREE.MeshBasicMaterial({ color: 0x6ff0ff, side: THREE.DoubleSide,
      transparent: true, opacity: 0.75, depthTest: false, toneMapped: false }));
  swingMark.add(core); swingMark.add(ring);
  swingMark.userData.ring = ring;
  swingMark.renderOrder = 999;
  swingMark.visible = false;
  scene.add(swingMark);
}
let swingPreview = null;

// 매 프레임 갱신해도 되는 비용(0.08ms)이라 항상 최신 지점을 보여준다.
function updateSwingPreview() {
  if (!touchMode || web || zip || !canAct()) { swingMark.visible = false; swingPreview = null; return; }
  swingPreview = findSwingAnchor();
  if (!swingPreview) { swingMark.visible = false; return; }
  swingMark.visible = true;
  swingMark.position.copy(swingPreview);
  swingMark.userData.ring.lookAt(camera.position);
  // 멀수록 크게 그려 화면상 크기를 일정하게 유지한다
  const d = camera.position.distanceTo(swingPreview);
  swingMark.scale.setScalar(Math.max(0.6, d * 0.012));
}

// 터치용 부착: 조준 대신 자동 앵커를 쓴다. 나머지는 tryAttach와 같다.
function tryAttachAuto() {
  if (!canAct()) return false;
  initAudio();
  const p = findSwingAnchor();
  if (!p) { say("걸 곳 없음"); sfxMiss(); return false; }
  attachWeb(p, autoHand);
  return true;
}

function tryAttach() {
  if (!canAct()) return false;
  initAudio();
  // 먼저 조준한 곳에 건다. 정확히 노린 앵커가 있으면 그게 우선이다.
  let point = resolveAnchor();
  // 조준선이 하늘이나 먼 곳을 향하면 그대로 헛방이었다. 실측 성공률이 2%였다.
  // 스파이더맨 게임들은 스윙에 조준을 요구하지 않는다 — 헛치면 흐름이 통째로 끊긴다.
  // 노린 데가 비면 근처에서 스윙하기 좋은 앵커를 자동으로 골라준다.
  let autoPick = null;
  if (!point) { point = findSwingAnchor(); autoPick = autoHand; }
  if (!point) { fireMissShot(); return false; }   // 걸 곳이 없어도 줄은 나간다 — 뻗었다가 끊긴다
  attachWeb(point, autoPick);   // 자동으로 고른 경우에만 손이 정해져 있다
  return true;
}

// 마우스 사이드 버튼(3=뒤로, 4=앞으로)은 기본 동작이 페이지 이동이라 반드시 막는다.
// 사이드 버튼 둘 중 뒤쪽(3)은 벽타기, 앞쪽(4)은 근접 주먹.
addEventListener("mousedown", e => {
  if (e.button === 3) { climbMouse = true; e.preventDefault(); }
  else if (e.button === 1) { midDown = true; e.preventDefault(); }
}, { capture: true });
addEventListener("mouseup", e => {
  if (e.button === 3) { climbMouse = false; e.preventDefault(); }
  else if (e.button === 4) e.preventDefault();
  else if (e.button === 1) { midDown = false; e.preventDefault(); }
}, { capture: true });
addEventListener("auxclick", e => {
  if (e.button === 3 || e.button === 4) e.preventDefault();
}, { capture: true });

renderer.domElement.addEventListener("mousedown", e => {
  // 락이 아직 안 걸렸으면 여기서 다시 잡는다. 키 입력으로는 거부될 때가 있다.
  if (wantLock && (firstPerson || aimCenter) && !document.pointerLockElement) requestLook();
  initAudio();
  if (e.button === 3 || e.button === 4) return;
  const nowS = performance.now() / 1000;
  if (e.button === 2) {
    mouseDownR = true;
    rClickT = nowS;
    // 우클릭 = 급선회용 두 번째 거미줄. 주 웹에 매달려 있을 때만 나간다.
    // 집라인은 세 버튼 홀드(슬링샷)로 옮겼다 — 우클릭 한 번으로 날아갈 수
    // 있으면 이동이 전부 그것만 된다.
    // 좌클릭과 거의 같이 눌렀으면 양손 새총 — 두 줄을 알아서 건다
    if (mouseDownL || nowS - lClickT < DUAL_WINDOW) { autoDualWeb(); return; }
    if (web) { web2Held = true; return; }   // 주 웹이 걸려 있으면 땅에서도 두 번째 줄
    // 매달린 게 없으면 예전대로. 3인칭은 시점 드래그, 1인칭은 시점이 이미 마우스다.
    if (!firstPerson) dragging = true;
    return;
  }
  if (e.button !== 0) return;
  mouseDownL = true;
  lClickT = nowS;
  // 1인칭에서 락이 안 걸려 있으면 이 클릭으로 다시 시도한다.
  // 3인칭은 커서가 조준점이라 절대 락을 걸지 않는다.
  if (firstPerson && document.pointerLockElement !== renderer.domElement) requestLook();
  if (clinging) {
    wallJump();
    return;
  }
  // 우클릭과 거의 같이 눌렀으면 양손 새총 (순서는 상관없다)
  if (mouseDownR || nowS - rClickT < DUAL_WINDOW) { autoDualWeb(); armPulse = 0.35; return; }
  // 클릭 한 번에 정확히 한 발. 홀드해도 재발사하지 않는다.
  // 조준한 곳에 잡을 소품이 있으면 소품이 먼저다 (탭 = 끌어오기 · 홀드 = 들기 · 떼면 던지기).
  // 없으면 스윙 앵커, 그것도 없으면 헛방 줄.
  if (!grabStart()) tryAttach();
  armPulse = 0.35;
});
addEventListener("mouseup", e => {
  if (e.button === 0) {
    mouseDownL = false;
    // 양손 새총을 물고 있으면 줄을 놓지 않는다. 두 버튼이 다 떨어지는 순간 updateSling이 쏜다.
    if (slingArmed()) return;
    if (grabbed) grabEnd();                        // 들고 있던 소품: 탭이면 끌어오기, 홀드였으면 던지기
    releaseWeb();                                  // 떼면 즉시 손 놓기
  }
  if (e.button === 2) {
    mouseDownR = false; dragging = false;
    if (slingArmed()) return;
    web2Held = false;
  }
});
// ---------- 자동 곡예 (문서 01 §14) ----------
// 플레이어가 공중제비 버튼을 외울 필요는 없다. 조건이 맞으면 알아서 나간다.
// 안전 규칙: **애니메이션은 궤적을 바꾸지 않는다.** tumble 은 연출만 건드린다.
const ACRO_CLEAR = 26;    // 지면까지 이만큼은 비어 있어야 한다 (낮은 데서 돌면 박는다)
const ACRO_SPEED = 26;    // 이보다 빨라야 곡예로 읽힌다
const ACRO_CD    = 2.2;   // 같은 동작이 연달아 나오면 지루하다
let acroCd = 0, acroCount = 0;



// 3인칭 휠 줌. 기본 거리에 곱해지는 배율이라 속도에 따른 거리 변화와 공존한다.
// 한 칸에 30%씩 곱해서 바꾼다. 0.09씩 더하던 때는 몇 칸을 돌려도 티가 안 났고,
// 더하기는 가까울 때와 멀 때 체감이 달라 곱하기로 바꿨다.
const ZOOM_MIN = 0.3, ZOOM_MAX = 2.8, ZOOM_STEP = 1.3;
let camZoom = 0.62;          // 기본값을 1보다 작게 — 지금 기본이 너무 멀다
addEventListener("wheel", e => {
  if (firstPerson) return;
  camZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, e.deltaY > 0 ? camZoom * ZOOM_STEP : camZoom / ZOOM_STEP));
  camMsg = 0.9;
}, { passive: true });

// 포인터 락이 새로 걸릴 때마다 첫 이벤트를 버리도록 표시한다
document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === renderer.domElement) lockSettle = true;
});
// 락이 거부돼도 시점 조작은 계속된다(위 mousemove 참고). 커서만 안 가둬질 뿐이라 알리기만 한다.
document.addEventListener("pointerlockerror", () => {
  console.warn("[포인터 락 실패] 커서가 화면에 갇히지 않지만 1인칭 시점 조작은 계속 동작합니다. 캔버스를 한 번 클릭해보세요.");
});

// 락 요청은 프라미스를 반환할 수 있고 거부될 수 있다. 거부돼도 게임이 멈추면 안 된다.
// 락이 거부되면(Esc 직후 쿨다운 등) 다음 클릭에 다시 시도한다.
// 거부돼도 조작은 mousemove 이동량으로 계속되지만, 커서가 창 밖으로 나가면
// 클릭이 게임에 안 들어와서 답답해진다.
let wantLock = false;
function requestLook() {
  wantLock = true;
  try {
    const r = renderer.domElement.requestPointerLock();
    if (r && typeof r.catch === "function") r.catch(() => {});
  } catch (err) { /* 락 미지원 — 조작은 mousemove로 계속된다 */ }
}

addEventListener("contextmenu", e => e.preventDefault());
addEventListener("blur", () => { dragging = false; mouseDownL = false; mouseDownR = false; midDown = false; web2Held = false; slingK = 0; releaseWeb(); });

document.addEventListener("mousemove", e => {
  // 1인칭은 포인터 락 성공 여부와 관계없이 이동량으로 시점을 돌린다.
  // (락이 거부되는 환경에서도 조작이 죽지 않게 — 락은 커서를 가두는 역할만 한다)
  // 1인칭, 그리고 3인칭 중앙 조준 모드: 이동량이 곧 시점이다. 조준점은 화면 중앙 고정.
  if (firstPerson || aimCenter) {
    // 락이 막 걸린 직후 첫 이벤트에는 커서가 중앙으로 순간이동한 거리가 통째로 실려온다.
    // 그대로 반영하면 시점이 홱 돌아가므로 한 번 버린다.
    if (lockSettle) { lockSettle = false; return; }
    // 창 전환·프레임 드랍 뒤에 큰 델타가 몰려올 수 있으니 상한을 둔다.
    const dx = Math.max(-140, Math.min(140, e.movementX || 0));
    const dy = Math.max(-140, Math.min(140, e.movementY || 0));
    // 3인칭은 카메라가 뒤에 있어 같은 델타라도 화면 이동이 작게 느껴진다. 조금 더 준다.
    viewYaw -= dx * (firstPerson ? 0.0022 : 0.0026);
    viewPitch -= dy * (firstPerson ? 0.0018 : 0.0021);
    viewPitch = Math.min(Math.max(viewPitch, -1.2), 1.35);
    if (!firstPerson) { camFree = CAM_FREE; lookIdle = 0; }   // 자동 정렬이 끼어들면 조준이 흔들린다
    return;
  }
  // 3인칭: 마우스 이동은 조준점(커서)을 옮긴다. 시점은 우클릭 드래그가 맡는다.
  // 1인칭과 조작 체계를 아예 분리했다 — 1인칭은 락 + 중앙 조준이다.
  mx = e.clientX;
  my = e.clientY;
  crosshairEl.style.left = `${mx}px`;
  crosshairEl.style.top = `${my}px`;
  if (dragging) {
    const dx = Math.max(-140, Math.min(140, e.movementX || 0));
    const dy = Math.max(-140, Math.min(140, e.movementY || 0));
    viewYaw -= dx * 0.005;
    viewPitch -= dy * 0.004;
    viewPitch = Math.min(Math.max(viewPitch, -1.0), 1.2);
    // 자동/수동 모드는 건드리지 않는다. 그건 C키만의 몫이다.
    // 대신 자동 정렬을 잠시 재운다 — 놓자마자 되당기면 돌린 의미가 없다.
    camFree = CAM_FREE;
    lookIdle = 0;
  }
});

// fromY를 주면 "그 높이 이하에 있는 가장 높은 바닥"만 고른다.
// 공중 구조물(캔틸레버·공중통로) 밑을 지날 때 머리 위 판을 바닥으로 착각하지 않게 하려는 것.
// 생략하면 예전처럼 가장 높은 면을 그대로 돌려준다.
function groundHeightAt(x, z, fromY = Infinity) {
  const list = nearbyBuildings(x, z, 2, _nbG);
  let h = 0;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (
      x >= b.x - b.w / 2 && x <= b.x + b.w / 2 &&
      z >= b.z - b.d / 2 && z <= b.z + b.d / 2
    ) {
      const top = b.y0 + b.h;
      if (top > fromY + 0.6) continue;
      if (top > h) h = top;
    }
  }
  if (h > 0) return h;
  // 건물 밖이면 인도 위인지 본다. 인도 지오메트리와 같은 셀 경계를 쓰므로 눈과 발이 어긋나지 않는다.
  const e = blockBounds.get(blockIndex(x, z));
  if (e &&
      x >= e.x0 - SIDEWALK_W && x <= e.x1 + SIDEWALK_W &&
      z >= e.z0 - SIDEWALK_W && z <= e.z1 + SIDEWALK_W) {
    return CURB_H;
  }
  return 0;
}


// 튕겨내지 않고 벽을 따라 미끄러진다. 스치듯 맞으면 속도를 거의 그대로 유지
// 한 프레임에 여러 박스를 해결할 때 마찰이 겹쳐 곱해지면 속도가 순식간에 죽는다.
// 프레임마다 한 번만 깎는다.
let wallFrictionUsed = false;
// 이번 틱에 이미 걸린 축. 모서리에 박으면 두 축이 연달아 걸리는데,
// 그러면 첫 축에서 살려둔 속도를 두 번째 축이 도로 0으로 만들어 완전히 선다.
let wallAxisHit = null;
const GLIDE_MIN_SPEED = 16;    // 이보다 느리면 굳이 흘려보내지 않는다
const GLIDE_KEEP = 0.78;       // 정면 충돌에서 벽을 따라 남기는 속도 비율
let glideCd = 0;               // 연속 활강으로 속도가 갈려나가지 않게 하는 쿨타임
// 빠르게 날던 직후에는 벽에 자동으로 달라붙지 않는다.
// 스치면서 순간 느려진 걸 '멈춰 섰다'로 오해해 붙여버리면 스윙이 통째로 끊긴다.
let noGrabT = 0;
// 벽점프 직후 잠깐. 오르기 키를 잡은 채로 점프하면 그 자리에서 다시 붙어버려
// 점프가 통째로 무효가 된다. 튀어나갈 시간을 준다.
let jumpLockT = 0;

function resolveAxis(axis, bound, dirIn, b) {
  // 표면에서 살짝 띄운다. 딱 붙여두면 다음 틱에도 닿아 있어 충돌이 반복된다.
  player.pos[axis] = bound + dirIn * 0.06;
  const v = player.vel[axis];
  if ((dirIn < 0 && v > 0) || (dirIn > 0 && v < 0)) {
    const sp = player.vel.length();
    // 벽을 파고드는 성분을 지운다
    player.vel[axis] = 0;
    const headOn = sp > 0.01 ? Math.min(1, Math.abs(v) / sp) : 0;

    // 긁히는 마찰. 프레임당 한 번만, 그리고 약하게.
    if (!wallFrictionUsed) {
      wallFrictionUsed = true;
      player.vel.multiplyScalar(1 - 0.16 * headOn * headOn);
    }

    // --- 벽 타고 미끄러지기 ---
    // 정면으로 박아 남은 속도가 거의 없으면 그대로 서버린다. 그게 '탁 걸리는' 느낌이다.
    // 벽면 안에서 내가 가려던 쪽을 찾아 그리로 흘려보낸다.
    const after = player.vel.length();
    // 쿨타임은 '잘 흐르고 있는데 또 꺾이는' 걸 막는 용도다.
    // 거의 멈춰버리는 경우(모서리에 낀 경우)는 쿨타임을 무시하고 구제한다.
    const nearStop = after < sp * 0.4;

    // 모서리: 이번 틱에 다른 축이 이미 걸렸다면 가로로 나갈 길이 없다.
    // 남은 속도를 아래로 돌려 벽을 타고 미끄러지게 한다. 서는 것보단 훨씬 낫다.
    if (wallAxisHit && wallAxisHit !== axis) {
      if (sp > GLIDE_MIN_SPEED) {
        const down = -sp * 0.55;
        if (player.vel.y > down) player.vel.y = down;
        noGrabT = 0.9;
      }
      lastWall = { axis, dir: dirIn, b, bound };
      return;
    }
    wallAxisHit = axis;

    if (!clinging && (glideCd <= 0 || nearStop) && sp > GLIDE_MIN_SPEED && after < sp * 0.5) {
      const other = axis === 'x' ? 'z' : 'x';
      // 벽면 위에서 방향을 고른다: 이미 그쪽으로 흐르고 있었으면 그 방향,
      // 아니면 지금 보고 있는 쪽. 둘 다 없으면 임의로 한쪽.
      let side = player.vel[other];
      if (Math.abs(side) < 2) side = other === 'x' ? Math.sin(viewYaw) : Math.cos(viewYaw);
      if (Math.abs(side) < 0.05) side = 1;
      const dirS = Math.sign(side);
      // 잃은 속도의 일부를 벽을 따라가는 방향으로 되돌린다
      const glide = sp * GLIDE_KEEP;
      const wantH = Math.sqrt(Math.max(0, glide * glide - player.vel.y * player.vel.y));
      if (Math.abs(player.vel[other]) < wantH) player.vel[other] = dirS * wantH;
      // 아래로 살짝 흘려 벽을 타고 내려가는 모양이 되게 한다
      if (player.vel.y > -4) player.vel.y -= 3;
      glideCd = 0.3;
      noGrabT = 0.9;             // 흘려보낸 직후엔 자동으로 붙지 않는다
    }

    if (headOn > 0.55 && sp > 26) {
      wallBump = Math.min(1, (sp - 26) / 60);   // 세게 박으면 화면에 알린다
      shake = Math.max(shake, wallBump * 0.4);
    }
  }
  lastWall = { axis, dir: dirIn, b, bound };
}

// 공중에서 벽타기 키를 눌렀을 때 잡을 벽을 찾는다.
// 충돌(lastWall)은 실제로 부딪혀야 생기므로, 살짝 떨어진 벽도 잡히게 별도로 탐색한다.
const _nbW = [];
// ---------- 양손 웹 ----------
// 문서 01 §7. 두 로프를 동시에 구속하면 과구속·진동·에너지 폭주가 난다.
// 그래서 실제 스윙 constraint 는 '주 웹' 하나만 담당하고, '보조 웹'은 구속 없이
// 방향만 당긴다. 화면에서는 양손이 각각 다른 곳을 잡고 있는 것으로 보인다.
//
// 손 배정: 주 웹이 걸린 쪽이 그 손, 보조 웹은 반대 손. 앵커가 왼쪽에 있으면
// 왼손으로 잡는다 — 지금까지는 어디에 걸든 늘 오른손이었다.
const WEB2_PULL = 62;        // 보조 웹이 당기는 가속 (m/s^2)
const WEB2_FADE = 45;        // 이 거리부터 당기는 힘이 약해진다
let web2 = null;             // { a, t }
let web2Held = false;        // 가운데 버튼을 누르고 있는가
let web2Strand = null;       // 두 번째 줄 (첫 프레임에 만든다 — 난수 때문에)
let web2Count = 0;

// 이 점이 플레이어의 어느 쪽인가. 잡을 손을 고른다.
// right = forward x up, forward = (sin, 0, cos) 이므로 오른쪽은 (-cos, 0, sin).
function sideOf(p) {
  const rx = -Math.cos(viewYaw), rz = Math.sin(viewYaw);
  return ((p.x - player.pos.x) * rx + (p.z - player.pos.z) * rz) >= 0 ? "R" : "L";
}
function otherSide(s) { return s === "R" ? "L" : "R"; }

function releaseWeb2() { web2 = null; }
// 두 번째 줄을 건다. 게임에서는 우클릭이, 시험에서는 하네스가 같은 길로 부른다.
function attachWeb2(point) {
  web2 = { a: point.clone(), t: 0 };
  web2Count++;
  armPulse = 0.3;
  sfxThwip();
}

// ---------- 웹으로 건물 타기 ----------
// 벽타기 버튼을 누른 채 공중에서 벽 옆에 있으면, 위쪽에 줄을 걸어 끌려 올라간다.
// 기존 '벽 붙기'의 기어오르기(CLIMB_SPEED)는 그대로 남는다 — 그쪽은 붙어서
// 천천히 오르는 것이고, 이쪽은 줄로 훅훅 타고 오르는 것이다.
let vcCd = 0, vcCount = 0;
const vcPoint = new THREE.Vector3();

// ---------- 벽 짚기 (Wall Plant) ----------
// 자동으로 나간다. 키가 없다 — 문서 01이 말한 "플레이어는 의도만 입력"이다.
// 빠르게 벽으로 가면 알아서 짚고, 속도를 죽이지 않고 방향만 꺾어 밀어낸다.
// 느리게 다가가면 이게 안 나가고 기존 '벽 붙기'(Ctrl)가 그대로 맡는다.
let plantT = 0;                 // 손이 벽에 닿아 있는 남은 시간
let plantCd = 0;
let plantHand = "R";            // 짚는 손
let plantCount = 0;             // 검증용
const plantPoint = new THREE.Vector3();

const WALL_GRAB_REACH = 2.6;
function findNearbyWall(reach) {
  const list = nearbyBuildings(player.pos.x, player.pos.z, reach + 4, _nbW);
  let best = null, bestGap = Infinity;
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (player.pos.y > b.y0 + b.h || player.pos.y < Math.max(1, b.y0)) continue;   // 박스 범위 밖은 벽이 아니다
    const hx = b.w / 2 + player.r, hz = b.d / 2 + player.r;
    const dx = player.pos.x - b.x, dz = player.pos.z - b.z;
    // x축 면(±x): z 범위 안에 있어야 그 면에 붙을 수 있다
    if (Math.abs(dz) <= hz) {
      const gap = Math.abs(dx) - hx;
      if (gap > -1.0 && gap < reach && gap < bestGap) {
        const s = dx >= 0 ? 1 : -1;
        bestGap = gap;
        best = { axis: "x", dir: s, b, bound: b.x + s * hx };
      }
    }
    // z축 면(±z)
    if (Math.abs(dx) <= hx) {
      const gap = Math.abs(dz) - hz;
      if (gap > -1.0 && gap < reach && gap < bestGap) {
        const s = dz >= 0 ? 1 : -1;
        bestGap = gap;
        best = { axis: "z", dir: s, b, bound: b.z + s * hz };
      }
    }
  }
  return best;
}

function collideWalls(prevX, prevZ) {
  let hit = false;
  const near = nearbyBuildings(player.pos.x, player.pos.z, player.r + 6, _nbC);
  for (const b of near) {
    // 박스의 실제 위/아래 범위 밖이면 벽이 아니다 (공중 구조물 밑을 지날 수 있어야 한다)
    if (player.pos.y > b.y0 + b.h - 1.5) continue;
    if (player.pos.y < b.y0 - 1.5) continue;
    const minX = b.x - b.w / 2 - player.r, maxX = b.x + b.w / 2 + player.r;
    const minZ = b.z - b.d / 2 - player.r, maxZ = b.z + b.d / 2 + player.r;
    if (
      player.pos.x > minX && player.pos.x < maxX &&
      player.pos.z > minZ && player.pos.z < maxZ
    ) {
      const inX = prevX > minX && prevX < maxX;
      const inZ = prevZ > minZ && prevZ < maxZ;
      if (!inX && !inZ) {
        const entryX = prevX < b.x ? minX - prevX : prevX - maxX;
        const entryZ = prevZ < b.z ? minZ - prevZ : prevZ - maxZ;
        if (entryX <= entryZ) {
          if (prevX < b.x) resolveAxis("x", minX, -1, b); else resolveAxis("x", maxX, 1, b);
        } else {
          if (prevZ < b.z) resolveAxis("z", minZ, -1, b); else resolveAxis("z", maxZ, 1, b);
        }
      } else if (!inX) {
        if (prevX < b.x) resolveAxis("x", minX, -1, b); else resolveAxis("x", maxX, 1, b);
      } else if (!inZ) {
        if (prevZ < b.z) resolveAxis("z", minZ, -1, b); else resolveAxis("z", maxZ, 1, b);
      } else {
        const dl = player.pos.x - minX, dr = maxX - player.pos.x;
        const du = player.pos.z - minZ, dd = maxZ - player.pos.z;
        const m = Math.min(dl, dr, du, dd);
        if (m === dl) resolveAxis("x", minX, -1, b);
        else if (m === dr) resolveAxis("x", maxX, 1, b);
        else if (m === du) resolveAxis("z", minZ, -1, b);
        else resolveAxis("z", maxZ, 1, b);
      }
      hit = true;
    }
  }
  return hit;
}

function wallJump() {
  const c = clinging;
  const nx = c.axis === "x" ? c.dir : 0;
  const nz = c.axis === "z" ? c.dir : 0;
  player.vel.set(nx * WALLJUMP_OUT, WALLJUMP_UP, nz * WALLJUMP_OUT);
  bodyYaw = Math.atan2(nx, nz);
  // 수동 모드(C)에서는 시점에 일절 손대지 않는다.
  if (camAuto) {
    viewYaw = bodyYaw;
    viewPitch = Math.max(viewPitch, -0.1);
  }
  clinging = null;
  jumpLockT = 0.35;
  sfxDash();
}

function softWallPush(dt) {
  if (player.grounded || clinging || !web) return;
  const hs = Math.hypot(player.vel.x, player.vel.z);
  if (hs < 8) return;
  const margin = 2.5;
  const near = nearbyBuildings(player.pos.x, player.pos.z, player.r + margin + 4, _nbP);
  for (const b of near) {
    if (player.pos.y > b.h - 1) continue;
    const minX = b.x - b.w / 2 - player.r - margin, maxX = b.x + b.w / 2 + player.r + margin;
    const minZ = b.z - b.d / 2 - player.r - margin, maxZ = b.z + b.d / 2 + player.r + margin;
    const px = player.pos.x, pz = player.pos.z;
    if (px > minX && px < maxX && pz > minZ && pz < maxZ) {
      const dxl = px - minX, dxr = maxX - px, dzl = pz - minZ, dzr = maxZ - pz;
      const m = Math.min(dxl, dxr, dzl, dzr);
      const p = Math.min(hs * 0.6, 22) * dt;
      if (m === dxl && dxl > player.r) { player.pos.x += p; if (player.vel.x < 0) player.vel.x *= 0.96; }
      else if (m === dxr && dxr > player.r) { player.pos.x -= p; if (player.vel.x > 0) player.vel.x *= 0.96; }
      else if (m === dzl && dzl > player.r) { player.pos.z += p; if (player.vel.z < 0) player.vel.z *= 0.96; }
      else if (m === dzr && dzr > player.r) { player.pos.z -= p; if (player.vel.z > 0) player.vel.z *= 0.96; }
    }
  }
}

const fwdFlat = new THREE.Vector3();
const rightV = new THREE.Vector3();
const _off = new THREE.Vector3();
const _n = new THREE.Vector3();
const _w0 = new THREE.Vector3();
const _w1 = new THREE.Vector3();
const _w2 = new THREE.Vector3();
const _w3 = new THREE.Vector3();
const _w4 = new THREE.Vector3();
const _c0 = new THREE.Vector3();
const _c1 = new THREE.Vector3();
// 카메라 충돌 전용 임시 벡터. _c0(desired)와 겹치면 안 된다.
const _cPiv = new THREE.Vector3(), _cSeg = new THREE.Vector3(), _cHit = new THREE.Vector3();

// ===================== 차 충돌 · 체력 =====================
// 체력은 차에 치일 때만 닳는다. 가만히 두면 다시 찬다. 0이 되면 시작 광장에서 다시 선다.
const HP_MAX = 100;
const HP_REGEN_WAIT = 4;       // 마지막으로 다친 뒤 이만큼 지나야 회복이 시작된다 (초)
const HP_REGEN = 10;           // 초당 회복량
const CAR_HIT_CD = 1.4;        // 한 번 치이면 이만큼은 다시 안 다친다 — 한 대에 연달아 갈리지 않게
const CAR_ROOF = () => CAR_H * 1.2;   // 차 지붕 높이 (상자 차 차체 + 캐빈 일부. 모델 차 지붕과 비슷하다)
const SPAWN = new THREE.Vector3(-CELL * 6, 0, CELL * 6);
let hp = HP_MAX, hpHitCd = 0, hpRegenWait = 0, carHits = 0;
let rideCar = null, rideX = 0, rideZ = 0;   // 지붕에 올라탄 차와 직전 스텝의 그 차 위치

// 차 한 대는 진행 방향으로 긴 상자다. 파고든 가장 얕은 축으로 밀어내고,
// 서로 다가오던 속도만큼 아프게 하고 튕겨낸다. 위에서 내려앉으면 지붕에 선다.
function hitCars(dt) {
  if (hpHitCd > 0) hpHitCd -= dt;
  const p = player.pos, r = player.r, roof = CAR_ROOF();
  const wasRiding = rideCar;
  rideCar = null;
  if (p.y > roof + 0.5) return;
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i], alongZ = car.axis === "z";
    const hx = (alongZ ? CAR_W : CAR_L) / 2 + r, hz = (alongZ ? CAR_L : CAR_W) / 2 + r;
    const dx = p.x - car.x, dz = p.z - car.z;
    if (Math.abs(dx) >= hx || Math.abs(dz) >= hz || p.y >= roof) continue;
    const cvx = alongZ ? 0 : car.dir * car.speed, cvz = alongZ ? car.dir * car.speed : 0;

    if (player.prevPos.y >= roof - 0.35 && player.vel.y <= 0.5) {
      // 지붕: 다치지 않는다. 차가 실제로 움직인 만큼 같이 실려 간다.
      // (차는 프레임마다, 물리는 스텝마다 돈다. 속도로 밀면 슬로모션에서 지붕 밖으로 미끄러진다)
      p.y = roof;
      if (player.vel.y < 0) player.vel.y = 0;
      player.grounded = true;
      if (wasRiding === car) {
        const mx = car.x - rideX, mz = car.z - rideZ;
        if (Math.abs(mx) + Math.abs(mz) < 60) { p.x += mx; p.z += mz; }   // 월드 끝에서 반대편으로 넘어간 순간은 무시
      }
      rideCar = car; rideX = car.x; rideZ = car.z;
      continue;
    }
    const ox = hx - Math.abs(dx), oz = hz - Math.abs(dz);
    let nx = 0, nz = 0;
    if (ox < oz) { nx = Math.sign(dx) || 1; p.x = car.x + nx * hx; }
    else         { nz = Math.sign(dz) || 1; p.z = car.z + nz * hz; }
    // 차 기준 상대 속도로 본 "서로 다가오는 속도"
    const into = -((player.vel.x - cvx) * nx + (player.vel.z - cvz) * nz);
    if (into <= 0) continue;
    const carN = cvx * nx + cvz * nz;
    const push = Math.max(carN, 0) + into * 0.5 + 10;          // 밀려나는 속도 (법선 방향)
    const vn = player.vel.x * nx + player.vel.z * nz;
    player.vel.x += (push - vn) * nx;
    player.vel.z += (push - vn) * nz;
    // 앞범퍼에 치였으면 옆으로도 튕긴다. 진행 방향으로만 밀면 차가 따라와서 또 친다.
    const front = alongZ ? nz !== 0 : nx !== 0;
    if (front) {
      const lat = alongZ ? dx : dz;
      const side = Math.abs(lat) > 0.3 ? Math.sign(lat) : (car.x + car.z) % 2 < 1 ? 1 : -1;
      // 차 폭(23m)의 절반을 반 초 안에 빠져나갈 만큼
      if (alongZ) player.vel.x = side * Math.max(Math.abs(player.vel.x), 24 + into * 0.3);
      else        player.vel.z = side * Math.max(Math.abs(player.vel.z), 24 + into * 0.3);
    }
    if (into > 6 && hpHitCd <= 0) {
      const dmg = Math.min(45, Math.max(8, into * 0.9));
      hurtPlayer(dmg);
      player.vel.y = Math.max(player.vel.y, 9 + into * 0.3);   // 떠 있어야 바닥 마찰에 옆으로 튕기는 힘이 안 죽는다
      player.grounded = false;
      hpHitCd = CAR_HIT_CD;
      carHits++;
      spawnImpact(_impV.set(p.x, p.y + 1, p.z), 10 + dmg * 0.3, 'kill');
    }
  }
}

function hurtPlayer(dmg) {
  hp = Math.max(0, hp - dmg);
  hpRegenWait = HP_REGEN_WAIT;
  hurtFx = Math.min(1.4, hurtFx + 0.5 + dmg / 40);
  shake = Math.max(shake, 0.35 + dmg / 60);
  sfxHurt();
  say(`쾅!  -${Math.round(dmg)}`, 0.9);
  if (hp <= 0) respawnPlayer();
}

function respawnPlayer() {
  releaseWeb();
  web2 = null; zip = null; clinging = null;
  player.pos.set(SPAWN.x, groundHeightAt(SPAWN.x, SPAWN.z), SPAWN.z);
  player.prevPos.copy(player.pos); player.renderPos.copy(player.pos);
  player.vel.set(0, 0, 0);
  hp = HP_MAX; hpRegenWait = 0; hpHitCd = 1.5;
  hurtFx = 1.4;
  say("쓰러졌다 — 시작 광장에서 다시", 2.2);
}

function tickHp(dt) {
  if (hurtFx > 0) hurtFx = Math.max(0, hurtFx - dt * 1.6);
  if (hpRegenWait > 0) { hpRegenWait -= dt; return; }
  if (hp < HP_MAX) hp = Math.min(HP_MAX, hp + HP_REGEN * dt);
}

// ===================== 거미줄로 소품 잡기 (좌클릭) =====================
// 탭 = 확 끌어오기 (발 앞에 떨어진다) · 홀드 = 들고 다니기 · 홀드했다 떼면 = 조준 방향으로 던지기
const GRAB_RANGE = 90;        // 플레이어에서 이만큼 안의 소품만
const GRAB_TAP = 0.22;        // 이보다 짧게 누르면 탭
const THROW_SPEED = 75;
let grabbed = null, grabT = 0, grabLineT = 0, grabHint = null, grabHintT = 0, grabLine = null;
const _gO = new THREE.Vector3(), _gD = new THREE.Vector3(), _gHold = new THREE.Vector3();
const _gTmp = new THREE.Vector3(), _gHit = new THREE.Vector3(), _gFrom = new THREE.Vector3();
let grabLast = null;          // 방금 놓은 소품 — 줄을 잠깐 더 그린다

function grabCandidate() {
  aimRay(_gO, _gD);
  const c = propPick(_gO, _gD, GRAB_RANGE + (firstPerson ? 0 : AIM_BACK));
  if (!c) return null;
  if (player.pos.distanceTo(_gTmp.set(c.x, c.y, c.z)) > GRAB_RANGE) return null;
  // 건물에 가려져 있으면 못 잡는다
  _gTmp.set(c.x - _gO.x, c.y - _gO.y, c.z - _gO.z).multiplyScalar(0.96);
  if (segHitWorld(_gO, _gTmp, _gHit, 0)) return null;
  return c;
}
function grabStart() {
  if (grabbed) return true;
  const c = grabCandidate();
  if (!c) return false;
  grabbed = propGrab(c);
  if (!grabbed) return false;
  releaseWeb();
  grabT = 0;
  armPulse = 0.35;
  sfxThwip();
  return true;
}
function grabEnd() {
  if (!grabbed) return;
  const b = grabbed;
  grabbed = null;
  if (grabT < GRAB_TAP) {
    camera.getWorldDirection(_gD); _gD.y = 0;
    if (_gD.lengthSq() < 1e-6) _gD.set(0, 0, 1);
    _gD.normalize();
    propYank(b, _gTmp.set(player.pos.x + _gD.x * (6 + b.R), player.pos.y, player.pos.z + _gD.z * (6 + b.R)));
  } else {
    aimRay(_gO, _gD);
    propThrow(b, _gTmp.copy(_gD).multiplyScalar(THROW_SPEED).addScaledVector(player.vel, 0.6));
    sfxWhoosh();
  }
  grabLast = b; grabLineT = 0.15;
}
// 들고 있을 점: 1인칭은 시선 앞 조금 아래, 3인칭은 캐릭터 머리 위 앞쪽
function grabHoldPoint(out) {
  camera.getWorldDirection(_gD);
  const dist = (firstPerson ? 7 : 9) + grabbed.R * 1.5;
  if (firstPerson) {
    // 조준점을 가리지 않게 오른쪽으로 비켜 든다
    out.copy(camera.position).addScaledVector(_gD, dist)
       .addScaledVector(_gTmp.set(1, 0, 0).applyQuaternion(camera.quaternion), 3.5 + grabbed.R);
    out.y -= 0.6;
  } else {
    _gD.y = 0; if (_gD.lengthSq() < 1e-6) _gD.set(0, 0, 1); _gD.normalize();
    out.set(player.renderPos.x, player.renderPos.y + 3.2 * HERO_3P_SCALE + grabbed.H * 0.5, player.renderPos.z)
       .addScaledVector(_gD, dist);
  }
  return out;
}
function updateGrab(dt) {
  if (grabbed) {
    grabT += dt;
    if (grabbed.state === "gone") grabbed = null;
  }
  propStep(dt, grabbed ? { hold: grabHoldPoint(_gHold), holdVel: player.vel } : null);
  // 조준한 소품 이름 — 0.1초마다만 찾는다
  grabHintT -= dt;
  if (grabHintT <= 0) { grabHintT = 0.1; grabHint = grabbed ? null : grabCandidate(); }

  // 손에서 소품까지 줄. 처음 잡을 때 만든다 (도시 생성 중에 THREE 객체를 만들면 난수가 밀린다).
  if (grabLineT > 0) grabLineT -= dt;
  const target = grabbed || (grabLineT > 0 && grabLast && grabLast.state !== "gone" ? grabLast : null);
  if (!target) { if (grabLine) grabLine.visible = false; return; }
  if (!grabLine) {
    grabLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ color: 0xf4f4f4 }));
    grabLine.frustumCulled = false;
    scene.add(grabLine);
  }
  if (firstPerson) (armR.userData.nozzle || handAnchor).getWorldPosition(_gFrom);
  else _gFrom.set(player.renderPos.x, player.renderPos.y + 1.8 * HERO_3P_SCALE, player.renderPos.z);
  const a = grabLine.geometry.attributes.position;
  a.setXYZ(0, _gFrom.x, _gFrom.y, _gFrom.z);
  a.setXYZ(1, target.pos.x, target.pos.y + target.H * 0.5, target.pos.z);
  a.needsUpdate = true;
  grabLine.visible = true;
}
function grabHintText() {
  if (grabbed) return grabT < GRAB_TAP ? "" : `  [좌클릭 떼면 ${grabbed.label} 던지기]`;
  return grabHint ? `  [좌클릭: ${grabHint.label} 끌어오기 · 길게 눌러 들기]` : "";
}

function update(dt) {
  // 고정 스텝 물리와 가변 렌더를 잇기 위해 직전 위치를 남긴다.
  // 이게 없으면 렌더가 스텝 사이에 걸릴 때마다 카메라가 튄다(저더).
  player.prevPos.copy(player.pos);
  lastWall = null;

  // (자동 재부착 없음. 발사는 mousedown에서만 일어난다.)

  let ix = 0, iz = 0;
  if (keys["KeyW"]) iz -= 1;
  // 양손 새총을 당기는 동안의 S 는 이동이 아니라 충전이다 (공중 이동이 같이 걸리면 몸이 뒤로 끌려간다)
  if (keys["KeyS"] && slingMode !== "ground") iz += 1;
  if (keys["KeyA"]) ix -= 1;
  if (keys["KeyD"]) ix += 1;
  // 가상 스틱(터치). 키보드와 섞이지 않게 스틱이 밀려 있을 때만 덮어쓴다.
  if (stickLen > 0.08) { ix = stickX; iz = stickY; }

  fwdFlat.set(Math.sin(viewYaw), 0, Math.cos(viewYaw));
  rightV.crossVectors(fwdFlat, new THREE.Vector3(0, 1, 0));

  // 근접 격투에서 휘두르거나 구르는 중에는 발이 묶인다. 때리면서 자유 이동이 되면
  // 소울류의 "한 방을 거는 결단"이 사라진다.
  let wx = fwdFlat.x * -iz + rightV.x * ix;
  let wz = fwdFlat.z * -iz + rightV.z * ix;
  const wl = Math.hypot(wx, wz);
  wl0 = wl;                     // 프레임 루프의 연출 판단에 쓴다
  if (wl > 0) { wx /= wl; wz /= wl; }

  if (clinging) {
    const c = clinging;
    player.vel.set(0, 0, 0);
    if (c.axis === "x") player.pos.x = c.bound;
    else player.pos.z = c.bound;

    // --- 벽타기: F 홀드 = 활발, F 떼면 = 슬라이드 다운 ---
    if (climbHeld()) {
      sliding = false;
      const nx = c.axis === "x" ? c.dir : 0;
      const nz = c.axis === "z" ? c.dir : 0;
      const rx = nz, rz = -nx;

      let mv = 0, mh = 0;
      if (keys["KeyW"]) mv += 1;
      if (keys["KeyS"]) mv -= 1;
      if (keys["KeyD"]) mh += 1;
      if (keys["KeyA"]) mh -= 1;
      if (mv === 0 && mh === 0) mv = 1;
      const ml = Math.hypot(mv, mh);
      mv /= ml; mh /= ml;

      const step = CLIMB_SPEED * dt;
      player.pos.y += mv * step;
      player.pos.x += rx * mh * step;
      player.pos.z += rz * mh * step;
      climbFx = 0.1;
    } else {
      sliding = true;
    }

    if (sliding) {
      player.pos.y -= (CLIMB_SPEED * 0.25) * dt;
      climbFx = 0.05;
    }

    if (player.pos.y >= c.b.h - 0.6) {
      player.pos.y = c.b.h;
      if (c.axis === "x") player.pos.x -= c.dir * (player.r + 0.7);
      else player.pos.z -= c.dir * (player.r + 0.7);
      player.grounded = true;
      clinging = null;
      sliding = false;
    } else if (player.pos.y <= groundHeightAt(player.pos.x, player.pos.z, player.pos.y)) {
      clinging = null;
      sliding = false;
    } else {
      const half = c.axis === "x" ? c.b.d / 2 : c.b.w / 2;
      const mid = c.axis === "x" ? c.b.z : c.b.x;
      const cur = c.axis === "x" ? player.pos.z : player.pos.x;
      if (Math.abs(cur - mid) > half + player.r) {
        clinging = null;
        sliding = false;
      }
    }
  } else {
    diving = !web && (keys["ShiftLeft"] || keys["ShiftRight"]);
    // 집라인 중에는 중력을 거의 죽여야 앵커까지 직선으로 시원하게 당겨진다.
    // 공중 콤보 분기는 전투를 걷어낼 때 같이 지웠다 — 여기가 그 사슬의 머리다.
    if (airComboT > 0) {
      // 공중 콤보 중에는 적과 같은 포물선을 탄다. 감쇠도 없고 낙하 제한도 느슨하다 —
      // 올라갈 때도 내려올 때도 붙어 있어야 이어치기가 성립한다.
      player.vel.y -= G * AIR_COMBO_G * dt;
      player.vel.y = Math.max(player.vel.y, -AIR_COMBO_FALL);
    }
    else if (hoverT > 0) {
      player.vel.y -= G * 0.16 * dt;               // 약한 중력
      player.vel.y = Math.max(player.vel.y, -7);   // 천천히 내려오는 속도로 제한
      // 위로 솟구치던 속도도 서서히 잡아준다 (붕 뜨는 느낌 방지)
      if (player.vel.y > 0) player.vel.y *= Math.exp(-3.5 * dt);
    }
    else {
      player.vel.y -= G * dt * (diving ? 3.4 : 1) * (zip ? 0.12 : 1) * (slingGlide > 0 ? 0.5 : 1);
      // 중력만으론 종단속도에서 멈춘다. 아래로 직접 밀어야 "내리꽂는" 느낌이 난다.
      if (diving) player.vel.y -= 34 * dt;
    }
  }

  if (player.grounded) {
    // 지상에서 Shift 홀드 = 달리기 (공중 Shift는 아래쪽 대시 로직이 따로 처리)
    const sprinting = wl > 0 && !!(keys["ShiftLeft"] || keys["ShiftRight"]);
    const spd = sprinting ? MOVE_SPEED * SPRINT_MULT : MOVE_SPEED;
    const tx = wx * spd;
    const tz = wz * spd;
    const t = Math.min(1, (ACCEL / MOVE_SPEED) * dt);
    player.vel.x += (tx - player.vel.x) * t;
    player.vel.z += (tz - player.vel.z) * t;
  } else if (wl > 0) {
    const acc = web ? AIR_ACCEL : AIR_ACCEL * 0.6;
    player.vel.x += wx * acc * dt;
    player.vel.z += wz * acc * dt;
  }

  // 우클릭 집라인: 양손 거미줄로 앵커를 잡고 자신을 빠르게 당겨간다
  if (zip) {
    const to = _zv.copy(zip.a).sub(player.pos);
    const d = to.length();

    if (zip.charge > 0) {
      // --- 시전 구간: 줄은 이미 걸렸고 힘을 모은다 ---
      // 속도를 죽여 잠깐 멈칫하게 만든다. 이 정지가 있어야 다음 순간의 가속이 크게 느껴진다.
      zip.charge -= dt;
      player.vel.multiplyScalar(Math.exp(-6 * dt));
      player.vel.y -= G * 0.25 * dt;      // 완전히 공중정지하면 어색하니 살짝만 떨어진다
      player.grounded = false;
      if (zip.charge <= 0) {
        // 발사: 목표 속도의 상당 부분을 즉시 얹어 "튕겨나가는" 느낌을 준다
        if (d > 0.001) {
          const dir = _zv2.copy(to).divideScalar(d);
          player.vel.copy(dir).multiplyScalar(ZIP_SPEED * 0.7);
        }
        sfxDash();
        dashKick = 0.3;                   // 화면 FOV 킥 재사용
      }
    } else {
      zip.t += dt;
      if (d < ZIP_ARRIVE || zip.t > ZIP_MAX_T) {
        // 도착해도 거의 감속하지 않는다. 이 속도를 그대로 스윙·도약으로 흘려보내는 게
        // 이 이동기의 핵심이라, 여기서 깎으면 반동이 통째로 사라진다.
        player.vel.multiplyScalar(ZIP_KEEP);
        boostCap = Math.max(MAX_SPEED, player.vel.length());
        boostT = ZIP_MOMENT;
        zip = null;
      } else {
        to.divideScalar(d);
        const want = _zv2.copy(to).multiplyScalar(ZIP_SPEED);
        const k = 1 - Math.exp(-ZIP_GRAB * dt);
        player.vel.x += (want.x - player.vel.x) * k;
        player.vel.y += (want.y - player.vel.y) * k;
        player.vel.z += (want.z - player.vel.z) * k;
        player.grounded = false;
      }
    }
  }

  if (web && keys["KeyE"]) {   // E = 순수 속도 부스트 (길이는 Space가 담당)
    const hs = Math.hypot(player.vel.x, player.vel.z);
    if (hs > 0.5) {
      player.vel.x += (player.vel.x / hs) * PUMP_ACCEL * dt;
      player.vel.z += (player.vel.z / hs) * PUMP_ACCEL * dt;
      player.vel.y += Math.max(0, -player.vel.y) * 0.15 * dt * (PUMP_ACCEL / 10);
    }
    pumpFx = 0.18;
  }
  if (pumpFx > 0) pumpFx -= dt;

  const dragF = Math.exp(-(player.grounded ? 0.06 : web ? 0.003 : 0.02) * dt);
  player.vel.x *= dragF;
  player.vel.z *= dragF;
  if (!player.grounded) player.vel.y *= Math.exp(-0.01 * dt);

  // 하드 클램프는 "속도가 쌓이는 맛"을 죽인다. 소프트캡 위로만 드래그가 붙음.
  // 집라인은 의도적으로 이 상한을 크게 넘기는 이동기라 예외로 둔다.
  // (안 그러면 ZIP_SPEED를 아무리 올려도 MAX_SPEED에서 잘려 3배가 체감되지 않는다)
  const sp = player.vel.length();
  // 집라인이 끝났다고 상한을 즉시 MAX_SPEED로 되돌리면 315m/s가 한 프레임에 잘려나간다.
  // 유예 시간 동안 상한을 선형으로 내려 속도가 관성으로 빠져나가게 한다.
  if (boostT > 0) boostT -= dt;
  const momentCap = boostT > 0
    ? MAX_SPEED + (boostCap - MAX_SPEED) * (boostT / ZIP_MOMENT)
    : 0;
  // 새총 직후에는 소프트캡을 발사 속도까지 올린다. 안 그러면 82m/s 위가 1초에 다 깎여
  // "세게 쏘긴 했는데 금방 느려지는" 그림이 된다.
  if (slingGlide > 0) slingGlide -= dt;
  const soft = slingGlide > 0 ? Math.max(SOFT_SPEED, slingSoft) : SOFT_SPEED;
  const cap = zip
    ? ZIP_SPEED * 1.15
    : Math.max(diving ? MAX_SPEED * 2.3 : MAX_SPEED, momentCap, slingGlide > 0 ? slingSoft : 0);
  if (!zip && sp > soft) {
    const over = (sp - soft) / Math.max(1, cap - soft);
    player.vel.multiplyScalar(Math.exp(-over * over * 3 * dt));
  }
  if (sp > cap) player.vel.multiplyScalar(cap / sp);

  if (!clinging) {
    const steps = Math.min(8, Math.max(1, Math.ceil((sp * dt) / (player.r * 0.7))));
    wallFrictionUsed = false;          // 이번 틱의 마찰은 한 번만
    wallAxisHit = null;
    for (let s = 0; s < steps; s++) {
      const px0 = player.pos.x, pz0 = player.pos.z;
      player.pos.addScaledVector(player.vel, dt / steps);
      const half = WORLD_HALF + 40;
      player.pos.x = Math.min(Math.max(player.pos.x, -half), half);
      player.pos.z = Math.min(Math.max(player.pos.z, -half), half);
      const hitWall = collideWalls(px0, pz0);
      if (hitWall && web && player.vel.lengthSq() < 20) {
        releaseWeb();
      }
    }

    softWallPush(dt);
  }

  if (web) {
    web.t += dt;
    const grip = Math.min(1, web.t / GRIP_TIME);

    const off = _off.subVectors(player.pos, web.a);
    const d = Math.max(off.length(), 0.001);
    const ux = off.x / d, uy = off.y / d, uz = off.z / d;

    // --- 수동 릴 인 (Space) ---
    // 누르고 있는 동안 줄을 계속 감는다. 팽팽할 때 감으면 아래 각운동량 보존이
    // 걸려서 그대로 가속으로 이어진다.
    if (keys["Space"]) {
      web.base = Math.max(ROPE_MIN, web.base - REEL_MANUAL * dt);
      pumpFx = 0.1;
    }

    // --- 자동 펌핑 (약하게) ---
    // 호 바닥에 가까울수록 살짝 감고 올라가면서 푼다. 그네에서 무릎 굽혔다 펴는 것.
    const phase = Math.max(0, -uy);
    let desired = web.base * (1 - PUMP_DEPTH * phase * phase);
    // 지면 여유를 이유로 로프를 자동으로 줄이지 않는다.
    // 앵커가 옥상 평면에 붙으면 groundHeightAt이 그 건물 높이를 그대로 돌려줘서
    // 걸자마자 최소 길이로 감겨 위로 튕겨 올라가는 문제가 있었다.
    // 낮게 걸면 낮게 스윙하는 것이 맞다 — 길이는 플레이어가 정한다.
    desired = Math.max(ROPE_MIN, desired);

    const oldLen = web.len;
    const rate = REEL_RATE * (desired < web.len ? 1 : 0.7);
    web.len += Math.max(-rate * dt, Math.min(rate * dt, desired - web.len));

    // 팽팽한 상태에서 감기면 각운동량 보존으로 접선 속도가 붙는다 (채찍 가속)
    if (d >= oldLen - 0.35 && web.len < oldLen) {
      const k = Math.min(oldLen / Math.max(web.len, 1), 1.01);
      const vr = player.vel.x * ux + player.vel.y * uy + player.vel.z * uz;
      player.vel.set(
        (player.vel.x - ux * vr) * k + ux * vr,
        (player.vel.y - uy * vr) * k + uy * vr,
        (player.vel.z - uz * vr) * k + uz * vr
      );
    }

    // --- 로프 구속 ---
    if (d > web.len) {
      const spBefore = player.vel.length();
      off.multiplyScalar(web.len / d);
      player.pos.copy(web.a).add(off);
      const n = _n.copy(off).divideScalar(web.len);
      const vr = player.vel.dot(n);
      if (vr > 0) player.vel.addScaledVector(n, -vr);
      // 잘려나간 반경 속도를 접선 속도로 되돌린다.
      // 이게 없으면 매 스윙 "덜컹"하고 속도가 깎여 절대 빨라지지 않음.
      const spAfter = player.vel.length();
      if (spAfter > 0.01 && spBefore > spAfter) {
        const target = spAfter + (spBefore - spAfter) * SWING_CONVERT * grip;
        player.vel.multiplyScalar(Math.min(target, cap) / spAfter);
      }
    }

    // 보조 웹. 구속하지 않고 방향만 당긴다 — 이게 문서 01 §7이 말한
    // "primary constraint + secondary steering force" 다.
    // 두 번째 constraint 를 걸면 두 줄이 서로를 잡아당겨 진동한다.
    if (web2Held && !web2) {
      // 조준한 곳이 먼저다. 하늘을 보고 있으면 자동 탐색으로 넘어간다 —
      // 주 웹이 그렇게 하고 있고, 보조만 조준을 요구하면 거의 안 붙는다.
      // (실측: 조준 전용으로 두니 붙는 횟수가 0이었다)
      // 조준한 곳이 먼저다. 주 웹과 같은 건물이면 자동 탐색으로 넘긴다 —
      // 두 줄이 같은 데 붙으면 새총이 아니라 줄 하나와 다를 게 없다.
      let p2 = resolveAnchor();
      if (p2 && web && p2.distanceTo(web.a) < 10) p2 = null;
      if (!p2) p2 = findSwingAnchor();
      if (p2) attachWeb2(p2);
    } else if (!web2Held && web2) releaseWeb2();
    if (web2) {
      web2.t += dt;
      _w2v.copy(web2.a).sub(player.pos);
      const d2 = _w2v.length();
      if (d2 > ROPE_MAX * 1.15) releaseWeb2();      // 너무 멀어지면 저절로 끊긴다
      else if (d2 > 1 && !slingPulling()) {
        // 새총을 당기는 동안엔 이 힘을 끔다. 안 그러면 몸이 앵커 쪽으로 끌려가서
        // '제자리에서 살짝 뒤로'가 아니라 그냥 빨려들어간다 (실측 1.1초에 9m).
        // 멀수록 약하게. 가까이서 세게 당기면 앵커로 빨려들어가 스윙이 망가진다.
        const k = WEB2_PULL * Math.min(1, WEB2_FADE / d2);
        player.vel.addScaledVector(_w2v.divideScalar(d2), k * dt);
      }
    }

    // 자동 릴리즈 없음. 좌클릭을 뗄 때까지 계속 매달려 있는다.
    collideWalls(player.pos.x, player.pos.z);
  }

  // 웹으로 건물 타기. 벽 붙기(clinging)보다 먼저 본다 — 줄이 걸리면 아래
  // 벽 붙기 블록이 !zip 조건에 걸려 저절로 비켜난다.
  if (vcCd > 0) vcCd -= dt;
  if (climbHeld() && !player.grounded && !clinging
      && vclimbShouldFire(player.pos, true, zip ? zip.a : null, vcCd)) {
    // 손이 닿는 거리면 줄을 쏘지 않는다 — 그건 기존 '벽 붙기'의 몫이다.
    // 손이 닿으면 붙고, 안 닿으면 줄을 쏜다. 이 한 줄이 두 기능을 가른다.
    const vw = findNearbyWall(WALL_GRAB_REACH) ? null : findNearbyWall(VC_NEAR);
    const va = vclimbAnchor(player.pos, vw, player.r);
    if (va) {
      releaseWeb();
      zip = { a: vcPoint.set(va.x, va.y, va.z).clone(), t: 0, charge: ZIP_CHARGE * 0.4 };
      armPulse = 0.35;
      vcCount++;
      vcCd = VC_CD;
      sfxThwip();
    }
  }

  // 벽 짚기. 기존 충돌 해결을 대체하지 않는다 — 그 전에 속도의 방향만 바꿔서
  // 애초에 벽에 처박히지 않게 한다. 스윙 중에도 나간다 (영상이 그렇다).
  // 드래그 직후 자동 정렬을 잠깐 쉬게 하는 타이머. 이 감쇠가 원래
  // updateLungePull(전투 함수) 안에 얹혀 있어서, 전투를 걷어내자 영영 안 줄어들었다.
  // 그러면 한 번 시점을 드래그한 뒤로 자동 카메라가 다시는 안 켜진다.
  if (camFree > 0) camFree -= dt;

  if (plantCd > 0) plantCd -= dt;
  if (plantT > 0) plantT -= dt;
  if (!clinging && !player.grounded && plantCd <= 0 && plantT <= 0 && !zip) {
    const pw = findNearbyWall(7);
    const hit = plantCheck(player.pos, player.vel, pw, player.r);
    if (hit) {
      plantImpulse(player.vel, hit);
      plantT = PLANT_TIME;
      plantCd = PLANT_CD;
      plantCount++;
      plantHand = plantSide(hit, player.pos, viewYaw);
      plantPoint.set(hit.x, hit.y, hit.z);
      spawnImpact(_impV.set(hit.x, hit.y, hit.z), 6, 'wall');
      shake = Math.max(shake, 0.25);
      sfxDodge();
    }
  }

  // 벽 붙기
  // 1) 그냥 부딪혔을 때: 느릴 때만 붙는다 (빠르면 스쳐 지나가야 흐름이 안 끊긴다)
  // 2) 벽타기 키를 누르고 있을 때: 공중에서 속도와 무관하게 근처 벽을 즉시 잡는다
  if (!clinging && !web && !zip && !player.grounded && jumpLockT <= 0) {
    let grab = null;
    if (climbHeld()) grab = lastWall || findNearbyWall(WALL_GRAB_REACH);
    else if (lastWall && noGrabT <= 0 && player.vel.length() < 14) grab = lastWall;
    if (grab) {
      clinging = { axis: grab.axis, dir: grab.dir, b: grab.b, bound: grab.bound };
      // 잡는 순간 벽면에 정확히 붙인다 (공중에서 잡으면 살짝 떨어져 있을 수 있다)
      if (grab.axis === "x") player.pos.x = grab.bound;
      else player.pos.z = grab.bound;
      player.vel.set(0, 0, 0);
      sliding = false;
      armPulse = 0.3;
    }
  }

  const gh = groundHeightAt(player.pos.x, player.pos.z, player.pos.y);
  if (player.pos.y <= gh && player.vel.y <= 0) {
    player.pos.y = gh;
    player.vel.y = 0;
    player.grounded = true;
    releaseWeb();
  } else {
    player.grounded = false;
  }
  if (player.grounded) clinging = null;

  if (!wasGrounded && player.grounded && fallSpeed > 18) sfxThud(fallSpeed);
  // 낙하 피해: 수평 속도는 안 본다. 스윙으로 빠르게 날아다니는 건 벌하지 않고,
  // 진짜로 수직으로 떨어져 박았을 때만 아프다.
  if (!wasGrounded && player.grounded) {
    const drop = Math.max(0, fallTopY - player.pos.y);
    // 표에서 떨어진 높이에 해당하는 가장 높은 단계를 고른다
    let fd = 0;
    if (fallSpeed >= FALL_MIN_V) for (const t of FALL_TIERS) if (drop > t.h) fd = t.dmg;
    if (fd > 0) {
      // 피해는 없다. 높이에 따른 충격 연출만 남긴다 — 낙하의 무게는 보여야 한다.
      shake = Math.max(shake, 0.5 + fd * 0.35);
      spawnImpact(_impV.set(player.pos.x, player.pos.y + 0.2, player.pos.z), 10 + fd * 8, 'kill');
      say(`낙하 ${drop | 0}m  -${Math.round(fd * 25)}`, 1.1);
    }
  }
  if (!wasGrounded && player.grounded) landFx = 0.3;   // Land 애니메이션을 잠깐 재생
  if (landFx > 0) landFx -= dt;
  wasGrounded = player.grounded;
  if (!player.grounded) fallSpeed = -player.vel.y;
  // 떨어진 높이를 재려면 "뜬 뒤 가장 높았던 지점"을 들고 있어야 한다.
  // 벽에 붙거나 줄에 매달리면 그 지점부터 다시 센다 — 스윙은 낙하가 아니다.
  if (player.grounded || clinging || web) fallTopY = player.pos.y;
  else fallTopY = Math.max(fallTopY, player.pos.y);

  // 스윙 중 Space는 줄 감기(위 로프 블록)라서 여기서는 지상 점프만 처리한다
  if (keys["Space"] && !prevSpace && !clinging && !web && player.grounded) {
    player.vel.y = JUMP_V;
    player.grounded = false;
  }
  prevSpace = !!keys["Space"];

  const shiftNow = !!(keys["ShiftLeft"] || keys["ShiftRight"]);
  if (shiftNow && !prevShift && !player.grounded && !clinging && hasDash && dashTimer <= 0) {
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    player.vel.copy(dir).multiplyScalar(DASH_SPEED);
    releaseWeb();
    hasDash = false;
    dashTimer = DASH_CD;
    dashKick = 0.25;
    sfxDash();

  }
  prevShift = shiftNow;
  if (cineCd > 0) cineCd -= dt;
  if (cineT > 0) cineT = Math.max(0, cineT - dt);
  // 큰 낙하 — 아래가 한참 비어 있고 빠르게 떨어지는 중
  if (cineCd <= 0 && !player.grounded && player.vel.y < -46
      && player.pos.y - groundHeightAt(player.pos.x, player.pos.z, player.pos.y) > 90) {
    cineFire("drop", 1);
  }
  updateSling(dt);
  if (dashTimer > 0) dashTimer -= dt;
  if (dashKick > 0) dashKick -= dt;
  if (player.grounded) hasDash = true;

  const hsp = Math.hypot(player.vel.x, player.vel.z);
  if (clinging) {
    const nx = clinging.axis === "x" ? clinging.dir : 0;
    const nz = clinging.axis === "z" ? clinging.dir : 0;
    bodyYaw = Math.atan2(-nx, -nz);
  } else if (zip) {
    // 집라인 중에는 진행 방향이 아니라 앵커를 정면으로 본다
    bodyYaw = lerpAngle(bodyYaw, Math.atan2(zip.a.x - player.pos.x, zip.a.z - player.pos.z), Math.min(1, 12 * dt));
  } else if (hsp > 6 && hsp > Math.abs(player.vel.y) * 0.3) {
    // 거의 수직으로 솟거나 떨어질 땐 수평 속도가 사실상 노이즈다. 그 방향을 따라가면
    // 몸이 홱홱 돌고, 자동 카메라가 그걸 그대로 물려받아 빙글빙글 돈다.
    // 그래서 수직이 지배적이거나 느릴 땐 방향을 아예 갱신하지 않는다.
    // 빠를수록 빠르게 따라붙는다 — 저속에서 급하게 붙이면 그 자체가 흔들림이 된다.
    const k = Math.min(1, (hsp - 6) / 16);
    bodyYaw = lerpAngle(bodyYaw, Math.atan2(player.vel.x, player.vel.z), Math.min(1, (2.5 + 7.5 * k) * dt));
  }
  hitCars(dt);
  tickHp(dt);
  spiderGroup.position.copy(player.renderPos);
  spiderGroup.rotation.y = bodyYaw;
  // 덤블링: 진행 방향 축으로 한 바퀴. 끝나면 정확히 0으로 되돌아온다.
  if (tumbleT > 0) {
    tumbleT -= dt;
    if (tumbleT <= 0) { tumbleT = 0; spiderGroup.rotation.x = 0; }
    else spiderGroup.rotation.x = Math.PI * 2 * (1 - tumbleT / tumbleDur);
  }

  // --- 애니메이션 상태 전환 (Mixamo 클립 이름과 맞춘 8종) ---
  if (heroMixer) {
    heroMixer.update(dt);
    let state = "Idle";
    // 이동 상태에 맞는 클립을 고른다. 위에서 아래로 우선순위다.
    //
    // 근접 동작 분기는 전투와 함께 없어졌다. 그래서 클립 길이를 동작 길이에
    // 맞춰 늘리던 clipFit 도 필요 없다 — 이제 전부 순환 클립이다.
    //
    // 벽: 실제로 오를 때만 등반 모션, 붙어만 있으면 매달린 자세.
    if (landFx > 0) state = "Land";
    else if (clinging) state = climbHeld() ? "WallRun" : "WallHang";
    else if (web || zip) state = "Swing";
    else if (!player.grounded) state = player.vel.y > 0.5 ? "Jump" : "Fall";
    else if (hsp > MOVE_SPEED * 1.6) state = "Sprint";
    else if (hsp > 1.5) state = "Run";
    crossfadeTo(state, 0.25);
  }
}

// 카메라가 갱신된 뒤에 불러야 함 (빌보드 계산에 camera.position이 필요)
// 시작점 s -> 앵커 a 사이를 리본으로 채운다 (web / zip 공용)
// 시작점 s -> 앵커 a 를 잇는 원통형 실 가닥을 만든다.
// 각 단면마다 진행 방향에 수직인 링을 둘러 원통을 세운다.
const _wA = new THREE.Vector3(), _wB = new THREE.Vector3(), _wC = new THREE.Vector3();
function fillRibbon(rb, s, a, sag, radius) {
  const dir = _w1.copy(a).sub(s);
  // 진행 방향에 수직인 두 축(u, v)을 잡는다. 방향과 나란하지 않은 아무 벡터로 외적하면 된다.
  _wA.copy(dir).normalize();
  _wB.set(0, 1, 0);
  if (Math.abs(_wA.dot(_wB)) > 0.94) _wB.set(1, 0, 0);   // 거의 수직이면 다른 축으로
  _wC.crossVectors(_wA, _wB).normalize();                 // u
  _wB.crossVectors(_wC, _wA).normalize();                 // v

  for (let i = 0; i <= WEB_SEGS; i++) {
    const t = i / WEB_SEGS;
    const px = s.x + dir.x * t;
    const py = s.y + dir.y * t - Math.sin(Math.PI * t) * sag;
    const pz = s.z + dir.z * t;
    // 굵기를 고정하면 손 앞(0.5m)에서는 통나무처럼, 멀리서는 실처럼 보인다.
    // 카메라와의 거리에 비례시켜 화면상 두께를 일정하게 유지한다.
    const camD = Math.hypot(px - camera.position.x, py - camera.position.y, pz - camera.position.z);
    const rad = Math.min(0.055, Math.max(0.011, camD * 0.0012));
    for (let r = 0; r < WEB_RADIAL; r++) {
      const ang = (r / WEB_RADIAL) * Math.PI * 2;
      const cx = Math.cos(ang), sy = Math.sin(ang);
      const nx = _wC.x * cx + _wB.x * sy;
      const ny = _wC.y * cx + _wB.y * sy;
      const nz = _wC.z * cx + _wB.z * sy;
      const o = (i * WEB_RADIAL + r) * 3;
      rb.pos[o] = px + nx * rad; rb.pos[o + 1] = py + ny * rad; rb.pos[o + 2] = pz + nz * rad;
      rb.nrm[o] = nx; rb.nrm[o + 1] = ny; rb.nrm[o + 2] = nz;
    }
  }
  rb.geo.attributes.position.needsUpdate = true;
  rb.geo.attributes.normal.needsUpdate = true;
}

// 양손 거미줄의 목표점. 집라인이면 앵커, 잡기/끌어오기면 대상의 가슴.
const _dualT = new THREE.Vector3();


function dualWebTarget() {
  if (zip) return _dualT.copy(zip.a);
  return null;
}


function updateWebVisual() {
  updateWeb2Visual();
  if (!web) {
    webLine.visible = false;
    anchorMark.visible = false;
    return;
  }
  webLine.visible = true;
  anchorMark.visible = true;
  anchorMark.position.copy(web.a);
  anchorMark.scale.setScalar(pumpFx > 0 ? 1.9 : 1);
  webLine.material.color.setHex(pumpFx > 0 ? 0xffd24a : 0xf2f6ff);

  const s = _w0;
  // 손목 웹슈터 노즐에서 정확히 나가야 한다.
  // 예전엔 카메라에 고정된 handAnchor를 썼는데, 손은 스웨이·반동·재장전으로 계속
  // 움직이므로 줄이 손에서 떨어진 허공에서 시작하는 것처럼 보였다.
  // 줄은 '잡은 손'에서 나가야 한다. 지금까지는 어디에 걸든 오른손 노즐에서
  // 나갔다 — 왼손이 뻗어 있는데 줄만 오른쪽에서 나오는 그림이 됐다.
  const wHand = web.side === "L" ? armL : armR;
  if (firstPerson && wHand.userData.nozzle) wHand.userData.nozzle.getWorldPosition(s);
  else if (firstPerson) handAnchor.getWorldPosition(s);
  else s.set(player.pos.x, player.pos.y + 1.8 * HERO_3P_SCALE, player.pos.z);

  const shoot = Math.min(1, web.t / WEB_SHOOT_T);     // 발사 순간 뻗어나가는 연출
  const slack = Math.max(0, web.len - s.distanceTo(web.a));
  // 느슨하면 처지고 팽팽하면 일직선. 뻗어나가는 동안은 완전히 곧게 — 총알처럼 꽂혀야 한다.
  const sag = shoot < 1 ? 0 : Math.min(1.2, slack * 0.25) + 0.1;
  const rad = 0.038 + Math.min(0.022, player.vel.length() * 0.0006);

  // 아직 다 안 뻗은 끝점을 구해 그 지점까지만 가닥을 만든다
  _w4.copy(web.a).sub(s).multiplyScalar(shoot).add(s);
  fillRibbon(webStrand, s, _w4, sag, rad);
}

// 헛방: 걸 데가 없어도 줄은 나간다. 조준 방향으로 곧게 뻗었다가 끊어진다.
// 메시는 첫 헛방 때 만든다 (도시 생성 중에 만들면 난수가 밀린다).
const WEB_SHOOT_T = 0.035;   // 줄이 끝까지 뻗는 시간 (걸리는 줄)
const MISS_OUT_T = 0.09;     // 헛방 줄이 사거리 끝까지 뻗는 시간
const MISS_CUT_T = 0.2;      // 그 뒤 끊겨서 사라지기까지
let missShot = null, missStrand = null;
const _msS = new THREE.Vector3(), _msA = new THREE.Vector3(), _msB = new THREE.Vector3();
function fireMissShot() {
  aimRay(_aimO, _aimD);
  const end = aimHit(ROPE_MAX, 0) || aimOrigin(_msA).addScaledVector(_aimD, ROPE_MAX);
  missShot = { end: end.clone ? end.clone() : end, t: 0, side: web2 ? "L" : "R" };
  armPulse = 0.35;
  sfxThwip();
}
function updateMissVisual(dt) {
  if (!missShot) { if (missStrand) missStrand.mesh.visible = false; return; }
  missShot.t += Math.max(0, dt);
  if (missShot.t > MISS_OUT_T + MISS_CUT_T) { missShot = null; missStrand.mesh.visible = false; return; }
  if (!missStrand) { missStrand = makeStrand(); scene.add(missStrand.mesh); }
  const s = _msS;
  const hand = missShot.side === "L" ? armL : armR;
  if (firstPerson && hand.userData.nozzle) hand.userData.nozzle.getWorldPosition(s);
  else if (firstPerson) handAnchor.getWorldPosition(s);
  else s.set(player.pos.x, player.pos.y + 1.8 * HERO_3P_SCALE, player.pos.z);
  const out = Math.min(1, missShot.t / MISS_OUT_T);
  // 끊긴 뒤에는 손 쪽 끝이 앞으로 따라가며 줄이 짧아진다
  const cut = Math.max(0, (missShot.t - MISS_OUT_T) / MISS_CUT_T);
  _msB.copy(missShot.end).sub(s).multiplyScalar(out).add(s);
  _msA.copy(s).lerp(_msB, cut);
  missStrand.mesh.visible = true;
  fillRibbon(missStrand, _msA, _msB, cut * 2.5, 0.03);    // 끊기면 힘없이 처진다
}

// 보조 웹의 줄. 주 웹과 같은 방식으로 그리되 반대 손에서 나간다.
// 메시는 첫 사용 때 만든다 — 선언 자리에서 만들면 uuid가 난수를 먹어 도시 생성이
// 통째로 밀린다 (상완에서 이미 한 번 겪었다).
function updateWeb2Visual() {
  if (!web2) { if (web2Strand) web2Strand.mesh.visible = false; return; }
  if (!web2Strand) { web2Strand = makeStrand(); scene.add(web2Strand.mesh); }
  web2Strand.mesh.visible = true;
  const s = _w2s;
  const hand = web && web.side === "R" ? armL : armR;      // 주 웹의 반대 손
  if (firstPerson && hand.userData.nozzle) hand.userData.nozzle.getWorldPosition(s);
  else if (firstPerson) handAnchor.getWorldPosition(s);
  else s.set(player.pos.x, player.pos.y + 1.8 * HERO_3P_SCALE, player.pos.z);
  const shoot = Math.min(1, web2.t / WEB_SHOOT_T);
  _w4.copy(web2.a).sub(s).multiplyScalar(shoot).add(s);
  fillRibbon(web2Strand, s, _w4, shoot < 1 ? 0 : 0.15, 0.034);
}

// 1인칭 손 포즈. updateCamera 안에 110줄 넘게 섞여 있던 것을 그대로 떼어냈다.
// 코드는 한 줄도 바꾸지 않았다 — updateCamera에서 부르는 위치도 원래 그 자리다.
//
// src/fp-hands.js 로 옮기지 않은 이유: 이 블록은 armPulse / fireKick / swayX /
// swayY / armExt 같은 최상위 let 을 직접 대입한다. 모듈로 빼면 export가
// 읽기 전용이라 그 대입이 전부 배선 작업이 되고, 그건 "옮기기"가 아니라
// 상태 재설계다. 상태를 먼저 묶은 뒤에 옮기는 게 맞다.
//
// sp = player.vel.length(). updateCamera가 이미 구해둔 값을 그대로 받는다.
function updateHands(dt, sp) {
  // 진행 방향 가속도. 줄이 당기기 시작하면 음수(감속)가 되고, 최저점을 지나
  // 튕겨 나갈 때 양수가 된다. 몸의 관성 쏠림이 이 부호를 따라간다.
  if (dt > 1e-6) fpFwdAcc = (sp - fpPrevSp) / dt;
  fpPrevSp = sp;
  // ── 이 손이 지금 무엇을 잡고 있는가 ───────────────────────────
  // 게임플레이 코어에 훅을 박지 않는다. 이미 있는 상태를 읽어 목표만 정하고,
  // 발사/포착 판정은 reach.js가 목표가 바뀐 것을 보고 스스로 한다.
  // 오른손 = 웹스윙/집라인/거미줄 격투. 왼손은 STEP 4(양손 웹)에서 붙인다.
  // 어느 손이 무엇을 잡는가.
  // 주 웹은 걸린 쪽 손, 보조 웹은 반대 손. 벽 짚기는 가까운 쪽 손.
  const tgt = { R: null, L: null };
  const kind = { R: "web", L: "web" };
  const pSide = web ? web.side : "R";
  if (web) tgt[pSide] = web.a;
  else if (zip) tgt.R = zip.a;
  if (web2) tgt[otherSide(pSide)] = web2.a;
  // 벽을 짚는 순간이 가장 급하다. 웹보다 먼저다.
  if (plantT > 0) { tgt[plantHand] = plantPoint; kind[plantHand] = "wall"; }
  setReach("R", tgt.R, kind.R);
  setReach("L", tgt.L, kind.L);
  updateReach(dt);

  armPulse = Math.max(0, armPulse - dt);
  const kf = Math.min(1, 14 * dt);          // 손가락 보간 계수 (프레임레이트 독립)
  const now = performance.now();

  // 발사 반동: armPulse가 0.28에서 시작해 줄어드는 것을 0..1 킥으로 바꾼다
  fireKick += ((armPulse > 0 ? Math.min(1, armPulse / 0.18) : 0) - fireKick) * Math.min(1, 20 * dt);
  // 시점을 홱 돌리면 손이 관성으로 살짝 끌린다 (웨폰 스웨이)
  const dYaw = shortAngle(viewYaw - swayPrevYaw);
  swayPrevYaw = viewYaw;
  swayX += (THREE.MathUtils.clamp(-dYaw * 1.6, -0.11, 0.11) - swayX) * Math.min(1, 9 * dt);
  swayY += (THREE.MathUtils.clamp((viewPitch - swayPrevPitch) * 1.4, -0.09, 0.09) - swayY) * Math.min(1, 9 * dt);
  swayPrevPitch = viewPitch;

  if (firstPerson && zip) {
    // 집라인/잡기/끌어오기 모두 "양손을 앞으로 뻗은" 같은 계열의 포즈를 쓴다.
    // ch = 1이면 힘을 모으거나 움켜쥔 상태, 0이면 완전히 뻗은 상태.
    let ch = 0;
    if (zip) ch = zip.charge > 0 ? zip.charge / ZIP_CHARGE : 0;
    // 이름을 pull로 두면 위의 끌어오기 상태 변수와 같은 블록에서 충돌한다(TDZ)
    const back = ch * 0.16;                 // 힘 모으는 동안 끌어당기는 양
    const reach = (1 - ch) * 0.16;          // 발사 후 앞으로
    armR.visible = true;
    armL.visible = true;
    // 두 가지를 동시에 지켜야 한다.
    //  (1) 당김은 z(뒤)가 아니라 y(아래)로. z로 당기면 전완이 근평면(0.1)에 잘린다.
    //  (2) 팔을 시선축과 나란히 두면 전완 캡슐의 둥근 끝이 손을 통째로 가린다.
    //      화면 아래 양옆에서 안쪽 위로 모아 올려야 장갑과 웹슈터가 보인다.
    armR.position.set(0.44 + swayX, -0.40 + swayY - back * 0.4, -0.68 - reach + back * 0.3);
    armR.rotation.set(0.34 - ch * 0.16, 0.30, -0.46);
    armL.position.set(-0.44 + swayX, -0.40 + swayY - back * 0.4, -0.68 - reach + back * 0.3);
    armL.rotation.set(0.34 - ch * 0.16, 0.30, -0.46);   // 오른팔과 같은 규칙 (거울은 기하가 맡는다)
    armR.scale.setScalar(0.72);
    armL.scale.setScalar(0.72);          // 거울은 이제 기하로 구웠다. 음수 스케일 불필요
    // 줄을 쏘는 손이므로 웹슈팅 자세(검지·소지 편 채)를 유지한다
    // 잡는 순간(hold)에는 주먹을 쥐듯 움켜쥔 손, 그 외에는 웹슈팅 자세
    const grip = 0;
    // 잡은 것이 있으면 그쪽으로 팔을 돌린다. 이 자세는 원래 양손을 앞으로 모으는
    // 그림이라 다 돌리면 어깨가 뒤틀린다 — 절반만 먹인다.
    const rr = applyReach(armR, "R", 0.55);
    poseHand(armR, 1 - grip, Math.max(grip, rr.grip), 0.5, Math.max(1 - ch, rr.fire), kf);
    poseHand(armL, 1 - grip, grip, 0.5, 1 - ch, kf);
  } else if (firstPerson && clinging) {
    // 벽 짚기: 양손 모두 벽면을 움켜쥔다. F4로 오를 때는 좌우 손이 번갈아 뻗는다.
    const climbing = !!climbHeld();
    const step = now * (climbing ? 0.009 : 0.0022);
    const reachR = climbing ? Math.sin(step) : Math.sin(step) * 0.25;
    const reachL = climbing ? Math.sin(step + Math.PI) : Math.sin(step + Math.PI) * 0.25;
    armR.visible = true;
    armL.visible = true;
    armR.position.set(0.34 + swayX, -0.16 + reachR * 0.07 + swayY, -0.70 - Math.max(0, reachR) * 0.05);
    armR.rotation.set(-0.24 + reachR * 0.12, 0.1, -0.5);
    armL.position.set(-0.34 + swayX, -0.16 + reachL * 0.07 + swayY, -0.70 - Math.max(0, reachL) * 0.05);
    armL.rotation.set(-0.24 + reachL * 0.12, 0.1, -0.5);
    armR.scale.setScalar(0.72);
    armL.scale.setScalar(0.72);
    poseHand(armR, 0, 1, 1, 0, kf);
    poseHand(armL, 0, 1, 1, 0, kf);
  } else {
    // 왼손: 주먹을 뻗는 동안만 보인다. 뻗기 40% / 복귀 60%로 나가는 건 빠르고 오는 건 느리다.
      const swingProg = -1;         // 근접 주먹을 걷어내서 이 연출은 더 이상 안 쓴다
    if (swingProg >= 0 && firstPerson) {
      const k = swingProg;                               // 0 -> 1
      const ext = k < 0.4 ? k / 0.4 : 1 - (k - 0.4) / 0.6;
      const e2 = ext * ext * (3 - 2 * ext);              // 부드럽게
      armL.visible = true;
      armL.position.set(-0.34 + e2 * 0.30 + swayX, -0.34 + e2 * 0.14 + swayY, -0.62 - e2 * 0.62);
      armL.rotation.set(0.30 - e2 * 0.30, 0.22 - e2 * 0.22, -0.40 + e2 * 0.40);
      armL.scale.setScalar(0.72);
      poseHand(armL, 0, 1, 0, 1, kf);                    // 주먹 쥔 손
    } else if (firstPerson && getReach("L").on > 0.01) {
      // 왼손이 무언가를 잡고 있다 (주 웹이 왼쪽이거나, 보조 웹이거나, 벽을 짚거나).
      // 오른손과 좌우 대칭인 기본 자세를 두고, 그 위에 목표 방향을 얹는다.
      const lr = getReach("L");
      armL.visible = true;
      armL.position.set(-0.5 + 0.14 * lr.on, -0.40 + 0.16 * lr.on, -0.52 - 0.1 * lr.on);
      armL.rotation.set(0.55 - 0.4 * lr.on, 0, -0.06 * lr.on);
      applyReach(armL, "L");
      armL.scale.setScalar(0.72);
      poseHand(armL, 1 - lr.grip, lr.grip, 0.4, lr.fire, kf);
    } else {
      armL.visible = false;
    }
    const armTarget = firstPerson && (getReach("R").on > 0.01 || armPulse > 0) ? 1 : 0;
    armExt += (armTarget - armExt) * Math.min(1, 10 * dt);

    // 줄에 매달린 동안 팔이 앵커 쪽으로 당겨지고, 장력에 따라 미세하게 떨린다
    let tugY = 0, tugZ = 0;
    if (web) {
      const tension = THREE.MathUtils.clamp((player.pos.distanceTo(web.a) - web.len) / 6 + 0.5, 0, 1);
      // 속도가 붙을수록 장력 떨림이 커진다 — 줄이 버티고 있다는 신호
      const tShake = tension * (0.6 + Math.min(1, sp / MAX_SPEED) * 1.6);
      tugY = Math.sin(now * 0.034) * 0.016 * tShake;
      tugZ = -tension * 0.03 - Math.sin(now * 0.047) * 0.006 * tShake;
    }
    // 고속에서는 바람에 팔이 뒤로 밀리고 손가락이 살짝 벌어진다
    const spd = Math.min(sp / MAX_SPEED, 1);
    const idle = Math.sin(now * 0.0026) * 0.008 + Math.sin(now * 0.0041) * 0.004;

    // 재장전: 손을 화면 아래로 내렸다가 비틀어 올린다 (카트리지 교체의 자리표시)
    // 0 -> 1 -> 0 종 모양이라 내려갔다 올라오는 왕복이 한 번에 나온다
    const rl = reloadT > 0 ? Math.sin(Math.PI * (1 - reloadT / RELOAD_TIME)) : 0;

    armR.position.set(
      0.5 - 0.14 * armExt + swayX + rl * 0.1,
      -0.40 + 0.16 * armExt + idle + tugY + swayY - fireKick * 0.035 - rl * 0.42,
      -0.52 - 0.1 * armExt + tugZ + spd * 0.035 + fireKick * 0.07 + rl * 0.12
    );
    armR.rotation.set(
      0.55 - 0.4 * armExt - fireKick * 0.22 + idle * 0.5 + rl * 0.85,
      swayX * 0.7 + rl * 0.7,
      -0.06 * armExt + fireKick * 0.1 - rl * 0.5
    );
    // 앵커 쪽으로 팔을 돌린다. 지금까지는 armExt로 "앞으로 조금 뻗는" 흉내만
    // 냈을 뿐, 줄을 어디에 걸었든 팔은 늘 같은 곳을 보고 있었다.
    const rr = applyReach(armR, "R");
    armR.scale.setScalar(0.72);
    armR.visible = firstPerson;
    poseHand(armR, 1 - rr.grip, rr.grip, 0.35 + spd * 0.65,
             Math.max(fireKick, rr.fire), kf);
  }

  // 몸 — 팔이 어디에 붙어 있는지 보이게 한다 (문서 01 §15).
  if (fpBody) {
    fpBody.visible = firstPerson;
    if (fpBody.visible) {
      const sp2 = Math.min(1, sp / 26);
      const runK = player.grounded ? sp2 : 0;
      const airK = player.grounded ? 0 : Math.min(1, 0.55 + (web ? 0.45 : 0));

      // 줄이 등 뒤로 얼마나 넘어갔는가. 최저점을 지났다는 신호다.
      //
      // 스윙은 앵커를 지나쳐 가는 운동이다. 지나치는 순간 줄은 뒤로 눕고,
      // 그때 몸통은 뒤에 남고 다리가 앞으로 쏠린다 — 레퍼런스에서 다리가
      // 하늘로 뻗는 컷이 정확히 그 순간이다.
      let ropeBack = 0;
      if (web) {
        const bx = web.a.x - player.renderPos.x, bz = web.a.z - player.renderPos.z;
        const bl = Math.hypot(bx, bz);
        if (bl > 0.5) {
          // 진행 방향과 앵커 방향의 내적. 앵커가 등 뒤면 음수다.
          const hl = Math.hypot(player.vel.x, player.vel.z) || 1;
          const dot = (bx / bl) * (player.vel.x / hl) + (bz / bl) * (player.vel.z / hl);
          ropeBack = Math.max(0, -dot);
        }
      }

      poseFpBody(fpBody, viewPitch, {
        run: runK, air: airK, lean: swayX * 2.2,
        fwdAcc: fpFwdAcc, upVel: player.vel.y,
        ropeBack, grounded: player.grounded, t: now * 0.001,
      }, fpIne, dt);
    }
  }

  // 어깨~팔꿈치를 잇는다. 분기마다 팔 위치가 다르므로 전부 끝난 뒤 한 번만 한다.
  //
  // 어깨를 고정해 두면 팔을 크게 뻗을 때 상완과 전완이 V자로 꺾인다 — 사람 팔이
  // 아니라 부러진 막대로 보인다. 어깨도 같은 방향으로 조금 따라 옮기면 둘이
  // 한 줄에 가까워져서 팔꿈치가 자연스럽게 편다.
  ensureUpperArms();
  shoulderFor(_shR, SHOULDER_R, getReach("R"), 1);
  shoulderFor(_shL, SHOULDER_L, getReach("L"), -1);

  // 손목을 어깨에서 목표 방향으로 내보낸다.
  //
  // 위의 분기들은 손목을 화면 앞쪽 '보기 좋은 자리'에 박아둔다. 그건 아무것도
  // 잡지 않았을 때는 맞지만, 뭔가를 향해 뻗는 동안에는 틀리다 — 어깨와
  // 손목이 따로 놀아서 위팔이 늘어나고 팔꿈치가 V자로 꺾인다.
  // 그래서 뻗은 정도(r.on)만큼 해부학적으로 맞는 자리로 섞는다.
  armReachPos(armR, _shR, "R");
  armReachPos(armL, _shL, "L");

  linkUpperArm(upperR, armR, _shR);
  linkUpperArm(upperL, armL, _shL);
}

function updateCamera(dt) {
  const hsp = Math.hypot(player.vel.x, player.vel.z);

  // 그림자 카메라를 플레이어와 함께 옮긴다. 좁은 프러스텀을 유지해야 그림자가 선명하다.
  sun.target.position.set(player.pos.x, player.pos.y, player.pos.z);
  sun.position.set(player.pos.x + SUN_DIR.x * 700, player.pos.y + SUN_DIR.y * 700, player.pos.z + SUN_DIR.z * 700);
  sun.target.updateMatrixWorld();

  // 자동 시점: 진행 방향으로 따라온다. 락온 블록을 걷어낼 때 이 조건줄이
  // 같이 날아가서(둘이 else-if 사슬이었다) 자동 카메라가 죽어 있었다.
  if (camAuto && !aimCenter && !dragging && camFree <= 0 && !firstPerson && (hsp > 3 || clinging)) {
    // 좌우: 느릴수록 천천히. 저속에서 급하게 붙이면 방향이 조금만 흔들려도 같이 흔들린다.
    const k = clinging ? 4 : Math.min(3.5, 0.9 + hsp * 0.07);
    viewYaw = lerpAngle(viewYaw, bodyYaw, Math.min(1, k * dt));
    // 위아래: 진행 각도를 절반만 따라간다. 솟구치면 올려다보고, 낙하하면 내려다본다.
    // 그대로 따라가면 화면이 하늘/땅으로 꽉 차서 앵커가 안 보인다.
    const vsp = Math.hypot(hsp, player.vel.y);
    let wantPitch = 0;
    if (!clinging && vsp > 10) wantPitch = Math.atan2(player.vel.y, hsp) * 0.5;
    wantPitch = Math.max(-0.5, Math.min(0.45, wantPitch));
    viewPitch += (wantPitch - viewPitch) * Math.min(1, 1.8 * dt);
  }

  const sp = player.vel.length();
  const cp = Math.cos(viewPitch);
  const viewDir = new THREE.Vector3(
    Math.sin(viewYaw) * cp,
    Math.sin(viewPitch),
    Math.cos(viewYaw) * cp
  );

  if (firstPerson) {
    camera.position.set(
      player.renderPos.x + viewDir.x * 0.25,
      player.renderPos.y + 1.8,
      player.renderPos.z + viewDir.z * 0.25
    );
    camera.lookAt(
      camera.position.x + viewDir.x,
      camera.position.y + viewDir.y,
      camera.position.z + viewDir.z
    );
  } else {
    const hug = Math.min(sp / MAX_SPEED, 1);
    // 빠를수록 뒤로 더 빠져야 속도가 읽힌다. 상한도 같이 올린다.
    // 휠 줌 배율을 곱한다. 가까이 당기면 캐릭터가 크게, 멀리 밀면 속도가 잘 읽힌다.
    const camDist = Math.min(9.5 + hsp * 0.28, 34) * camZoom * (aimCenter ? CAM_TIGHT : 1);
    const desired = _c0.set(
      player.renderPos.x - viewDir.x * camDist,
      player.renderPos.y + (CAM_RISE_3P - hug * 1.4) - viewDir.y * camDist * 0.55,
      player.renderPos.z - viewDir.z * camDist
    );
    // 어깨너머: 캐릭터를 화면 한쪽으로 비켜 세워 정중앙(조준점)을 비운다.
    // 오버워치 3인칭도 캐릭터가 화면 중앙이 아니라 한쪽에 서 있다 — 안 그러면
    // 조준점이 자기 몸에 가린다.
    if (aimCenter) {
      const rx = -viewDir.z, rz = viewDir.x;          // 카메라 오른쪽 = 시선 x 위
      const rl = Math.hypot(rx, rz) || 1;
      desired.x += (rx / rl) * CAM_SHOULDER;
      desired.z += (rz / rl) * CAM_SHOULDER;
    }
    // 카메라 충돌. 머리에서 desired까지 선분을 한 번 쏴서 막혔으면 벽 앞으로 당긴다.
    // 기존 공간해시(nearbyBuildings)와 선분 검사(segHitWorld)를 그대로 쓴다 —
    // 지면과 인도 턱까지 같은 함수가 봐주므로 아래를 볼 때 땅을 뚫는 것도 같이 막힌다.
    const pivot = _cPiv.set(player.renderPos.x, player.renderPos.y + CAM_PIVOT_Y, player.renderPos.z);
    const seg = _cSeg.copy(desired).sub(pivot);
    const dFree = seg.length();
    let dLimit = dFree;
    if (dFree > 1e-4 && segHitWorld(pivot, seg, _cHit, 0)) {
      dLimit = Math.min(dFree, camStandDist(_cHit.distanceTo(pivot)));
      if (dLimit < dFree) desired.copy(pivot).addScaledVector(seg, dLimit / dFree);
    }
    camBlocked = dLimit < dFree - 1e-4;

    const cl = 1 - Math.exp(-(6.5 + hug * 5.5) * dt);
    camera.position.lerp(desired, cl);

    // 위 검사는 "가려던 곳"만 본다. 그런데 보간은 한 프레임 늦어서, 빠르게 달릴 때
    // 카메라는 머리-desired 선분에서 한참 벗어난 곳에 뒤처져 있다. 그 지연 위치가
    // 하필 다른 건물 안일 수 있다 — 도시 횡단 시험에서 실제로 21프레임이 그랬다.
    // 그래서 "지금 있는 곳"까지 한 번 더 쏜다. 막히지 않았으면 아무 일도 안 일어난다.
    // 들어올 때만 즉시 당기고, 나갈 때는 위 보간이 알아서 부드럽게 밀어낸다.
    const back = _cSeg.copy(camera.position).sub(pivot);
    const dBack = back.length();
    if (dBack > 1e-4 && segHitWorld(pivot, back, _cHit, 0)) {
      const dOk = camStandDist(_cHit.distanceTo(pivot));
      if (dOk < dBack) {
        camera.position.copy(pivot).addScaledVector(back, dOk / dBack);
        camBlocked = true;
        dLimit = Math.min(dLimit, dOk);
      }
    }

    // 벽에 밀려 카메라가 몸 안까지 들어오면 캐릭터 내부가 화면을 덮는다.
    // 그럴 때만 숨긴다 — 평상시(dLimit이 기본 거리)에는 항상 보인다.
    // 캐릭터를 1.7배로 키운 뒤로는 머리까지 거리만으로 모자라다 — 올려다보면 카메라가 땅에 막혀
    // 다리 속으로 들어간다. 카메라가 캐릭터 몸통 원기둥 안이면 숨긴다.
    const chx = camera.position.x - player.renderPos.x, chz = camera.position.z - player.renderPos.z;
    const chy = camera.position.y - player.renderPos.y;
    const inHero = chx * chx + chz * chz < (0.9 * HERO_3P_SCALE) ** 2 && chy > -0.3 && chy < HERO_HEIGHT * HERO_3P_SCALE;
    spiderGroup.visible = dLimit > CAM_HIDE_DIST && !inHero;
    // 중앙 조준에서는 화면 중앙이 곧 조준 방향이어야 한다. 목표점을 보면 어깨
    // 오프셋만큼 화면이 돌아가서 조준점과 실제 방향이 어긋난다.
    if (camAuto && !aimCenter) {
      // 자동: 진행 방향을 살짝 앞서 본다. 속도감이 여기서 나온다.
      lookTarget.lerp(_c1.set(
        player.renderPos.x + player.vel.x * 0.16,
        player.renderPos.y + 1.7 * HERO_3P_SCALE + player.vel.y * 0.05,
        player.renderPos.z + player.vel.z * 0.16
      ), 1 - Math.exp(-12 * dt));
      camera.lookAt(lookTarget);
    } else {
      // 수동: 시점은 오직 viewYaw/viewPitch가 정한다.
      // 예전엔 여기서도 lookAt(플레이어 + 속도*0.16)을 썼다. viewYaw는 고정인데
      // 좌우로 걸으면 그 목표점이 옆으로 밀려 카메라가 20도 넘게 돌아갔다.
      // "수동인데 시점이 조금씩 바뀐다"의 진짜 원인이 이것이었다.
      // 1인칭과 똑같이 시선 벡터로 직접 맞춘다 — 속도와 완전히 무관해진다.
      lookTarget.set(player.renderPos.x, player.renderPos.y + 1.7, player.renderPos.z);
      camera.lookAt(
        camera.position.x + viewDir.x,
        camera.position.y + viewDir.y,
        camera.position.z + viewDir.z
      );
    }
  }

  // 뱅킹: 로프가 걸린 쪽으로 기울인다. 웹스윙 체감의 절반이 여기서 나온다.
  // 수동 시점에서는 뱅킹도 끈다. 화면이 기우는 것도 "시점이 움직인다"로 읽힌다.
  let targetRoll = 0;
  if (web && !clinging && (camAuto || firstPerson)) {
    rightV.set(-Math.cos(viewYaw), 0, Math.sin(viewYaw));
    const ox = player.pos.x - web.a.x, oz = player.pos.z - web.a.z;
    const ol = Math.hypot(ox, oz);
    if (ol > 0.5) {
      const lat = (ox / ol) * rightV.x + (oz / ol) * rightV.z;
      targetRoll = lat * CAM_ROLL * Math.min(1.35, hsp / 30);
    }
  }
  camRoll += (targetRoll - camRoll) * Math.min(1, 5 * dt);
  // 1인칭에서는 **화면을 기울이지 않는다.** 대신 몸이 기운다.
  //
  // 뱅킹은 3인칭에서 스윙 체감의 절반이지만, 1인칭에서는 원인이 화면 밖에
  // 있어서 "내 몸이 기운다"가 아니라 "세상이 돈다"로 읽힌다. 그게 멀미다.
  // 이제 1인칭에도 가슴과 다리가 있으니 기울일 대상이 생겼다 —
  // 시점은 수평을 지키고, 몸이 도는 걸 눈으로 본다.
  // 몸 기울이기는 여기서 하지 않는다 — updateHands 가 이 아래에서 돌면서
  // fpBody.rotation 을 통째로 다시 쓴다. 실제 적용은 그 뒤에서 한다.
  if (!firstPerson && Math.abs(camRoll) > 0.0005) camera.rotateZ(camRoll);

  // 고속 진동: 바람에 밀리는 느낌. 피격 흔들림과 겹쳐도 되게 따로 더한다.
  // 임계 이하에서는 0이라 평상시엔 화면이 흔들리지 않는다.
  const buffet = Math.max(0, sp - SOFT_SPEED * 0.75) / MAX_SPEED;
  if (buffet > 0.01) {
    const b = buffet * buffet * 0.5;
    camera.position.x += (Math.random() - 0.5) * b;
    camera.position.y += (Math.random() - 0.5) * b;
    camera.position.z += (Math.random() - 0.5) * b;
  }

  // 피격 카메라 흔들림 (제곱으로 감쇠시켜 초반만 강하게)
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 3.4);
    const s = shake * shake * 0.6 * shakeScale;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
  }

  // 1인칭 덤블링 — **시점은 안 돌린다.**
  //
  // 예전엔 camera.rotateX 로 화면을 통째로 360도 넘겼다. "1인칭은 몸이 안
  // 보이니 시야를 넘겨야 덤블링이 보인다"는 이유였는데, 그건 화면 전체가
  // 뒤집히는 거라 그냥 멀미다. 그리고 그 전제가 이제 틀렸다 — 1인칭에도
  // 가슴과 다리가 있다 (문서 01 §15).
  //
  // 그래서 카메라는 가만히 두고 **몸만** 돈다. fpBody 는 카메라의 자식이라
  // 여기서 돌려도 시점은 1도 안 움직인다. poseFpBody 는 위(6779행)에서
  // 이미 돌았으므로 여기서 더해도 덮이지 않는다.
  // (적용은 updateHands 뒤에서 — poseFpBody 가 덮어쓰기 때문이다)

  // 속도 구간을 제곱으로 밟아 고속에서 확 벌어지게 한다 (선형이면 밋밋하다)
  const spN = Math.min(sp / MAX_SPEED, 1.25);
  // 1인칭 시야각. 레퍼런스는 화면 가장자리가 눈에 보이게 휠 만큼 광각이다 —
  // 건물이 시야를 스치며 지나가는 게 속도감의 큰 몫이다. 78은 좁았다.
  const targetFov = (firstPerson ? 95 : 70)
    + spN * spN * (firstPerson ? 26 : 40)
    + Math.max(dashKick, 0) * 48
    + Math.max(pumpFx, 0) * 30
    + (diving ? 8 + diveFx * 16 : 0);
  // 시네마틱은 목표 시야각에 얹는다. 카메라 각도는 건드리지 않는다 —
  // 조작 중에 시점을 뺏으면 그 순간이 곧 버그로 읽힌다 (문서 01 §22).
  const cineFov = cineT > 0
    ? (cineKind === "drop" ? 10 : cineKind === "release" ? 7 : 5) * cineAmt() : 0;
  camera.fov += (targetFov + cineFov - camera.fov) * Math.min(1, 5 * dt);
  camera.updateProjectionMatrix();

  updateHands(dt, sp);

  // ---------- 1인칭: 시점은 고정, 몸만 돈다 ----------
  //
  // 어지러움의 원인은 하나였다. 모델이 돌 때 시점이 같이 돌았다.
  //   · 덤블링   camera.rotateX 로 화면을 통째로 360도 넘겼다
  //   · 스윙 뱅킹 camera.rotateZ 로 화면을 기울였다
  // 3인칭에서는 이게 체감의 절반이지만, 1인칭에서는 원인이 화면 밖에 있어서
  // "내 몸이 기운다"가 아니라 "세상이 돈다"로 읽힌다. 그게 멀미다.
  //
  // 이제 1인칭에도 가슴과 다리가 있으니 기울일 대상이 생겼다. 카메라는
  // 수평을 지키고, 몸이 도는 걸 눈으로 본다.
  //
  // 반드시 updateHands **뒤**여야 한다. poseFpBody 가 매 프레임
  // fpBody.rotation 을 통째로 다시 쓰기 때문이다 — 앞에서 더하면 사라진다.
  if (firstPerson && fpBody) {
    // 화면을 기울이는 양과 몸을 기울이는 양을 나눈다 (설정 SETTINGS.roll).
    //   0  화면은 수평을 지키고 몸만 기운다 — 멀미가 가장 적다
    //   1  레퍼런스처럼 화면이 같이 눕는다
    // 화면이 누울수록 몸 기울기는 줄인다. 둘을 다 세게 주면 이중으로 기운다.
    if (Math.abs(camRoll) > 0.0005 && fpRoll > 0.001) camera.rotateZ(camRoll * fpRoll);
    fpBody.rotation.z -= camRoll * 0.85 * (1 - fpRoll * 0.5);
    if (tumbleT > 0) {                              // 덤블링도 몸으로
      const spin = Math.PI * 2 * (1 - tumbleT / tumbleDur);
      fpBody.rotation.x -= spin;
      if (upperR) upperR.rotation.x -= spin * 0.5;  // 팔은 절반만 — 화면을 가리면 안 된다
      if (upperL) upperL.rotation.x -= spin * 0.5;
    }
  }

  if (windActive()) {
    const r = Math.min(sp / MAX_SPEED, 1);
    setWind(r * r * 0.3 + diveFx * 0.35, 250 + r * 900 + diveFx * 1400);
  }
}

// ================== 미션 ==================
// 판정은 전부 src/mission.js 가 한다. 여기서는 '세상의 요약'을 만들어 넘기고
// 결과를 화면에 옮길 뿐이다. 미션마다 if 문을 세우지 않기 위한 경계다.
let mDef = null;              // 그 정의 (좌표가 풀린 사본)
let mIsChal = false;
let mKills = 0;               // 전역 누적 처치 수
let mResult = null;









// ================== 미니맵 ==================
// 문서 02 §7. 항상 모든 걸 보여주지 않는다 — 지금 찾아가야 할 것만 찍는다.
// 보스를 못 찾겠다는 말이 나온 게 이 화면이 없어서다.
const mmCv = document.getElementById("mmCv");
// 하네스(Node)의 DOM 스텁에는 getContext 가 없다. 있는지 보고 쓴다 —
// 없으면 미니맵만 안 그려질 뿐 게임은 그대로 돈다.
const mmCtx = mmCv && mmCv.getContext ? mmCv.getContext("2d") : null;
const mmTagEl = document.getElementById("mmTag");
const MM_R = Math.max(N_AVE * AVE_SPACING, N_ST * ST_SPACING) * 0.5 + 200;  // 도시 반경
const MM_PAD = 8;

// 월드 좌표를 미니맵 픽셀로. 북쪽(-z)이 위로 가게 둔다.
function mmPt(x, z, size) {
  const r = size * 0.5 - MM_PAD;
  return [size * 0.5 + (x / MM_R) * r, size * 0.5 + (z / MM_R) * r];
}
function mmDot(c, x, z, size, color, rad, ring) {
  const p = mmPt(x, z, size);
  c.beginPath(); c.arc(p[0], p[1], rad, 0, Math.PI * 2);
  c.fillStyle = color; c.fill();
  if (ring) { c.lineWidth = 1.5; c.strokeStyle = ring; c.stroke(); }
  return p;
}
// 화면 밖이면 가장자리에 붙여 방향만 알려준다. 이게 없으면 멀리 있는 목표가 안 보인다.
function mmEdge(c, x, z, size, color) {
  const r = size * 0.5 - MM_PAD;
  const d = Math.hypot(x, z) / MM_R;
  if (d <= 1) return null;
  const a = Math.atan2(x, z);
  const px = size * 0.5 + Math.sin(a) * r, py = size * 0.5 + Math.cos(a) * r;
  c.save();
  c.translate(px, py); c.rotate(-a);
  c.beginPath(); c.moveTo(0, -5); c.lineTo(4, 4); c.lineTo(-4, 4); c.closePath();
  c.fillStyle = color; c.fill();
  c.restore();
  return [px, py];
}

// 건물 바닥면은 한 번만 그려서 캐시한다. 2,235개를 20Hz로 다시 그리면
// 미니맵 하나가 프레임을 갉아먹는다. 도시는 안 변하니 한 장이면 된다.
let mmCity = null;
function mmBuildCity(S) {
  if (mmCity) return mmCity;
  const cv = typeof document !== "undefined" && document.createElement
    ? document.createElement("canvas") : null;
  if (!cv || !cv.getContext) return null;
  cv.width = S; cv.height = S;
  const c = cv.getContext("2d");
  if (!c) return null;
  c.fillStyle = "rgba(190,205,230,.30)";
  for (const b of buildings) {
    const a = mmPt(b.x - b.w / 2, b.z - b.d / 2, S);
    const d = mmPt(b.x + b.w / 2, b.z + b.d / 2, S);
    const w = Math.max(1, d[0] - a[0]), h = Math.max(1, d[1] - a[1]);
    c.fillRect(a[0], a[1], w, h);
  }
  mmCity = cv;
  return cv;
}

let mmT = 0;
function updateMinimap(dtReal) {
  if (!mmCtx) return;
  // 매 프레임 다시 그릴 이유가 없다. 20Hz면 충분하고 프레임을 안 갉는다.
  mmT -= dtReal;
  if (mmT > 0) return;
  mmT = 0.05;

  const S = mmCv.width || 176;
  const c = mmCtx;
  c.clearRect(0, 0, S, S);

  // 건물 (미리 그려둔 한 장을 얹는다)
  const city = mmBuildCity(S);
  if (city) c.drawImage(city, 0, 0);

  // 구역 격자
  c.strokeStyle = "rgba(255,255,255,.16)";
  c.lineWidth = 1;

  // 적 — 가까운 것만. 전부 찍으면 점이 216개라 아무것도 안 읽힌다.
  c.fillStyle = "rgba(255,120,120,.55)";
  let shown = 0;

  let tag = "";


  // 보스 — 제일 눈에 띄어야 한다
  if (bossE && !bossE.dead) {
    const bx = bossE.g.position.x, bz = bossE.g.position.z;
    const p = mmPt(bx, bz, S);
    c.beginPath(); c.arc(p[0], p[1], 6.5, 0, Math.PI * 2);
    c.fillStyle = "rgba(255,60,60,.92)"; c.fill();
    c.lineWidth = 2; c.strokeStyle = "#fff"; c.stroke();
    mmEdge(c, bx - player.pos.x, bz - player.pos.z, S, "rgba(255,60,60,.95)");
    const d = Math.hypot(bx - player.pos.x, bz - player.pos.z);
    tag = "<b>보스</b> " + (d > 999 ? (d / 1000).toFixed(1) + "km" : (d | 0) + "m")
        + " · " + bossPhase + "페이즈";
  }

  // 나 — 삼각형으로 보는 방향까지
  const me = mmPt(player.pos.x, player.pos.z, S);
  c.save();
  c.translate(me[0], me[1]);
  c.rotate(-viewYaw);
  c.beginPath(); c.moveTo(0, -6); c.lineTo(4.2, 5); c.lineTo(0, 3); c.lineTo(-4.2, 5);
  c.closePath();
  c.fillStyle = "#e8eef7"; c.fill();
  c.lineWidth = 1; c.strokeStyle = "rgba(0,0,0,.7)"; c.stroke();
  c.restore();

  if (mmTagEl) mmTagEl.innerHTML = tag;
}

// ---------- 3인칭 뼈 보정 ----------
// STEP 1 의 reachTarget 을 그대로 쓴다. 1인칭은 손에, 3인칭은 뼈에 먹인다 —
// 값은 하나고 먹이는 대상만 다르다. 이게 reach.js 를 손과 무관하게 만든 이유다.
let rig3pOn = false;
const _look3 = new THREE.Vector3();
function pose3pNow() {
  if (firstPerson) return;
  if (!rig3pOn) { rig3pOn = init3p(spiderGroup); if (!rig3pOn) return; }

  // 손이 향할 곳. 1인칭에서 쓰는 것과 같은 규칙이다.
  const pSide = web ? web.side : "R";
  let tR = null, tL = null;
  if (web) { if (pSide === "R") tR = web.a; else tL = web.a; }
  else if (zip) tR = zip.a;
  if (web2) { if (pSide === "R") tL = web2.a; else tR = web2.a; }
  if (plantT > 0) { if (plantHand === "R") tR = plantPoint; else tL = plantPoint; }

  // 몸 기울기. 도는 쪽으로 기울고, 솟구치면 젖히고 낙하하면 숙인다.
  const hsp = Math.hypot(player.vel.x, player.vel.z);
  const turn = shortAngle(bodyYaw, Math.atan2(player.vel.x, player.vel.z));
  const lean = Math.max(-1, Math.min(1, turn * 0.9)) * Math.min(1, hsp / 30);
  const pitchLean = Math.max(-1, Math.min(1, -player.vel.y / 45));

  // 머리는 잡은 쪽을, 없으면 가는 쪽을 본다.
  let look = tR || tL;
  if (!look && hsp > 6) {
    look = _look3.set(player.pos.x + player.vel.x * 2,
                      player.pos.y + 1.6 + player.vel.y * 0.6,
                      player.pos.z + player.vel.z * 2);
  }

  pose3p({
    targetR: tR, targetL: tL,
    wR: getReach("R").on, wL: getReach("L").on,
    lean, pitchLean, look, wHead: 0.45,
  });
}

const _objV = new THREE.Vector3();

function updateCrosshair() {
  // 중앙 조준이면 OS 커서를 감춘다. 매 프레임 맞춰서 어떤 경로로 들어와도 어긋나지 않게.
  // F1 조작법이 열려 있을 때는 돌려줘야 스크롤을 할 수 있다.
  document.body.classList.toggle("aimlock", aimCenter && !hudEl.classList.contains("show"));
  // 1인칭 조준점은 항상 화면 정중앙. 매 프레임 강제해서 어떤 경로로도 밀리지 않게 한다.
  if (firstPerson || aimCenter) {
    crosshairEl.style.left = "50%";
    crosshairEl.style.top = "50%";
  }
  // 히트마커는 조준점 위치를 그대로 따라간다 (3인칭은 커서를 따라가므로)
  if (hitMark > 0) {
    const k = hitMark / 0.17;            // 1 -> 0
    // 살짝 벌어지면서 사라진다
  } else {
  }


  // 부착과 완전히 같은 함수로 미리보기를 뽑는다. 마커가 거짓말하지 않는다.
  // resolveAnchor는 전체 레이캐스트라 한 번에 0.88ms다. 마커는 몇 프레임 늦어도 안 보인다.
  if (web) aimPreview = null;
  else if (--aimTick <= 0) {
    aimTick = 5;
    // tryAttach와 정확히 같은 순서로 뽑는다. 보이는 것 = 실제로 걸리는 곳.
    aimPreview = resolveAnchor();
    aimAuto = false;
    if (!aimPreview) { aimPreview = findSwingAnchor(); aimAuto = !!aimPreview; }
  }
  if (aimPreview && !web) {
    aimMark.visible = true;
    aimMark.position.copy(aimPreview);
    aimMark.scale.setScalar((aimAuto ? 1.25 : 1) * (1 + Math.sin(performance.now() * 0.006) * 0.12));
    // 초록 = 조준한 그 지점 / 노랑 = 조준이 빗나가 자동으로 골라준 앵커
    aimMark.material.color.setHex(aimAuto ? 0xffd24a : 0x7dffa0);
    crosshairEl.style.borderColor = aimAuto
      ? "rgba(255,210,74,0.95)"
      : "rgba(120,255,140,0.95)";
  } else {
    // 사거리 밖이거나 하늘 -> 흰색 (스윙 중에는 노란색 유지)
    aimMark.visible = false;
    crosshairEl.style.borderColor = web
      ? "rgba(255,210,74,0.9)"
      : "rgba(255,255,255,0.75)";
  }
}

const speedEl = document.getElementById("speed");
const pumpEl = document.getElementById("pumpfx");
const linesEl = document.getElementById("speedlines");
const diveEl = document.getElementById("divefx");

// ---------------- 인게임 HUD ----------------
// --- 스파이더 센스: 화면을 중앙 기준 8분할해 위협 방향을 옅게 밝힌다 ---
// 화살표 하나는 "목표"밖에 못 알려준다. 방향 감각은 시야 전체로 오는 게 맞다.
const SENSE_R = 150;          // 이 안의 적만 감지
const SENSE_N = 8;
const senseFoe = [], senseObj = [];
{
  // 각 조각은 중앙에서 뻗어나가는 부채꼴. clip-path로 잘라 가장자리만 빛나게 한다.
  const R = 130;              // 화면 밖까지 덮도록 넉넉히
  const pt = (deg) => {
    const a = deg * Math.PI / 180;
    return (50 + R * Math.sin(a)).toFixed(1) + "% " + (50 - R * Math.cos(a)).toFixed(1) + "%";
  };
  for (let i = 0; i < SENSE_N; i++) {
    const c = i * (360 / SENSE_N);
    const half = 360 / SENSE_N / 2;
    const clip = "polygon(50% 50%, " + pt(c - half) + ", " + pt(c) + ", " + pt(c + half) + ")";
    for (const [arr, cls] of [[senseObj, "obj"], [senseFoe, "foe"]]) {
      const d = document.createElement("div");
      d.className = "senseSeg " + cls;
      d.style.clipPath = clip;
      d.style.webkitClipPath = clip;
      arr.push(d);
    }
  }
}
// 부드럽게 켜지고 꺼지도록 현재 밝기를 따로 들고 간다 (매 프레임 튀면 깜빡인다)
const senseFoeLv = new Array(SENSE_N).fill(0);
const senseObjLv = new Array(SENSE_N).fill(0);
const _snF = new THREE.Vector3();


const hurtEl = document.getElementById("hurt");
const hpBarEl = document.getElementById("hpBar"), hpNumEl = document.getElementById("hpNum");
const slingGaugeEl = document.getElementById("slingGauge");
const dodgeEl = document.getElementById("dodgeFx");


function updateHud(dtReal) {
  // 스태미나 — 초록 막대. 바닥나면 붉게 번쩍여서 이유를 바로 알 수 있게.

  updateMinimap(dtReal);
  updateSwingPreview();
  if (touchMode && window.__touchCd) window.__touchCd();

  // 체력 — 10칸. 덜 찬 칸은 초록(차오르는 중)
  if (hpBarEl && hpBarEl.children) {              // 테스트 하네스의 가짜 DOM 에는 children 이 없다
    if (hpBarEl.children.length !== 10) hpBarEl.innerHTML = "<i></i>".repeat(10);
    for (let i = 0; i < hpBarEl.children.length; i++) {
      hpBarEl.children[i].className = hp >= (i + 1) * 10 - 0.01 ? "" : hp > i * 10 ? "regen" : "off";
    }
    hpNumEl.textContent = `${Math.ceil(hp)} / ${HP_MAX}`;
    hpNumEl.classList.toggle("low", hp < 30);
  }
  // 양손 새총 충전 게이지 — 조준점 아래. 충전 중에만 보인다.
  if (slingGaugeEl) {
    slingGaugeEl.style.display = slingK > 0 && !slingAir ? "block" : "none";   // 공중에서는 몸이 끌리는 것 자체가 게이지다
    if (slingK > 0) slingGaugeEl.firstElementChild.style.width = `${Math.round(slingK * 100)}%`;
  }
  hurtEl.style.opacity = Math.max(0, Math.min(1, hurtFx)) * 0.85;
  dodgeEl.style.opacity = Math.max(0, Math.min(1, dodgeFx)) * 0.7;
  // 완벽 회피 문구는 커졌다 사라진다
  const pf = Math.max(0, Math.min(1, perfectFx));

}

let last = performance.now();
let acc = 0;
const DT = 1 / 120;
// 최근 프레임 시간의 중앙값을 보고 해상도 배율을 천천히 움직인다.
// 매 프레임 튕기면 화면이 일렁이므로 변화는 작게, 반영은 드물게.
const ftBuf = new Array(30).fill(16);
let ftIdx = 0, resCheck = 0;
function adaptRes(ms) {
  ftBuf[ftIdx++ % ftBuf.length] = ms;
  if (--resCheck > 0) return;
  resCheck = 30;
  const sorted = ftBuf.slice().sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  const prev = resScale;
  if (med > 20 && resScale > RES_MIN) resScale = Math.max(RES_MIN, resScale - 0.1);        // 50fps 미만
  else if (med < 13 && resScale < RES_MAX) resScale = Math.min(RES_MAX, resScale + 0.05);  // 여유 있음
  if (resScale !== prev) {
    renderer.setPixelRatio(resScale);
    renderer.setSize(innerWidth, innerHeight);
  }
}

let frameErrs = 0;
// ===================== 시작 화면 =====================
// 게임이 시작되기 전에는 물리를 돌리지 않는다. 카메라만 도시 위를 천천히 돈다 —
// 글자 뒤로 배경이 은은하게 지나가는 그 화면이다 (v1.0 에서 가져왔다).
let menuOn = true, menuAngle = 0;
const titleEl = document.getElementById("title");
function updateMenuCamera(dt) {
  menuAngle += dt * 0.055;
  _menuAt.set(0, 210, 0);
  const r = 460;
  camera.position.set(Math.sin(menuAngle) * r, 210 + Math.sin(menuAngle * 0.7) * 55, Math.cos(menuAngle) * r);
  camera.lookAt(_menuAt.x, 120, _menuAt.z);
  camera.fov = 62;
  camera.updateProjectionMatrix();
}
function showMenu(on) {
  menuOn = on;
  if (titleEl) titleEl.classList.toggle("show", on);
  if (on) {
    // 메뉴로 돌아가면 손에 든 것부터 놓는다 (줄을 잡은 채로 멈춰 있으면 돌아왔을 때 엉킨다)
    mouseDownL = false; mouseDownR = false; web2Held = false;
    releaseWeb(); releaseWeb2();
    document.exitPointerLock();
  } else {
    last = performance.now();     // 메뉴에 머문 시간만큼 물리가 한 번에 밀리지 않게
    acc = 0;
    initAudio();
    if (firstPerson) requestLook();
  }
}
if (titleEl) {
  titleEl.classList.add("show");
  const btn = document.getElementById("btnStart");
  if (btn) btn.addEventListener("click", () => showMenu(false));
}

function frame(now) {
  try { frameBody(now); }
  catch (err) {
    if (frameErrs++ < 5) {
      console.error("[frame 예외]", err);
      say("오류: " + (err && err.message ? err.message : err), 4);
    }
  }
  requestAnimationFrame(frame);
}

function frameBody(now) {
  const realDt = Math.min(0.05, (now - last) / 1000);
  adaptRes((now - last) || 16);
  // 시작 화면: 물리·입력은 멈추고 카메라만 돈다
  if (menuOn) {
    last = now;
    updateMenuCamera(realDt);
    skyMesh.position.copy(camera.position);
    renderer.render(scene, camera);
    return;
  }
  last = now;
  // F1 조작법이 열려 있으면 게임을 멈춘다. 화면은 계속 그린다.
  // acc를 비워야 닫는 순간 밀린 물리 스텝이 한꺼번에 터지지 않는다.
  if (hudEl.classList.contains("show")) {
    acc = 0;
    renderer.render(scene, camera);
    return;
  }
  acc += realDt * speedBase;
  while (acc >= DT) {
    update(DT);
    acc -= DT;
  }
  // 렌더 시각은 보통 물리 스텝 사이에 걸린다. 그 사이를 메워야 화면이 매끄럽다.
  player.renderPos.lerpVectors(player.prevPos, player.pos, Math.min(1, acc / DT));
  spiderGroup.position.copy(player.renderPos);
  // 차량은 프레임당 한 번만 갱신한다. 물리 스텝마다 돌리면 2,825대 x 2메시의
  // 인스턴스 버퍼를 초당 수십 번 통째로 GPU에 올려 프레임이 끊긴다.
  updateCars(realDt);
  // 가까운 차·소품을 모델로. 상자 차 행렬을 덮어쓰므로 반드시 updateCars 뒤다.
  updateNycProps(realDt, player.renderPos.x, player.renderPos.z);
  updateGrab(realDt);            // 잡은 소품 · 날아다니는 소품 (소품 인스턴스를 고친 뒤)
  updateCamera(Math.min(0.05, (frame.prev ? now - frame.prev : 16) / 1000));
  frame.prev = now;
  skyMesh.position.copy(camera.position);
  updateWebVisual();
  updateMissVisual(realDt);
  // 월드에 그리는 표식들은 조준점 로직과 무관하게 매 프레임 갱신한다.
  // 예전엔 updateCrosshair 안에 있어서 공격 모드의 early return에 걸렸다.
  updateCrosshair();
  updateHud(realDt);
  updateWebDbg(realDt);
  if (camMsg > 0) camMsg -= 1 / 60;
  if (toastT > 0) toastT -= 1 / 60;
  if (climbFx > 0) climbFx -= 1 / 60;
  const camLabel = camAuto ? "CAM 자동" : "CAM 수동";
  speedEl.textContent =
    `${Math.round(player.vel.length() * 3.6)} km/h · DASH ${hasDash ? "READY" : `${Math.max(dashTimer, 0).toFixed(1)}s`}`
    + (camMsg > 0 ? ` · ${camLabel} ←` : "")

    + grabHintText()
    + (toastT > 0 ? `   ▸ ${toast}` : "")
    + (clinging ? (sliding ? "  [벽: 미끄러지는 중 · Ctrl로 붙잡기]" : "  [벽타기: WASD]") : "");
  pumpEl.style.opacity = Math.min(1, Math.max(pumpFx, 0) * 6);
  // 급강하 연출: 목표치로 서서히 붙였다 빠진다. 즉시 켜고 끄면 화면이 깜빡인다.
  diveFx += ((diving ? 1 : 0) - diveFx) * Math.min(1, 5 * (1 / 60));
  // 임계 이하에서는 0으로 눌러 평상시 화면이 뿌옇지 않게 한다
  const lineSp = Math.max(0, player.vel.length() - SOFT_SPEED * 0.5) / MAX_SPEED;
  // 달리기(Shift)는 바람이 스치는 정도만. 예전엔 속도선이 회피와 똑같이 세서
  // 둘이 구분이 안 됐다.
  const sprintWind = (player.grounded && wl0 > 0
    && (keys["ShiftLeft"] || keys["ShiftRight"])) ? 0.14 : 0;
  // 회피는 짧고 강하게 — 시작 순간에 확 올라왔다 빠진다
  linesEl.style.opacity = sprintWind + Math.max(rollFx * rollFx * 1.1, 0) + Math.min(0.95,
    lineSp * lineSp * 1.6
    + (pumpFx > 0 ? 0.35 : 0)
    + (dashKick > 0 ? 0.4 : 0)
    + diveFx * 0.55);
  diveEl.style.opacity = (diveFx * 0.85).toFixed(3);
  if (diveFx > 0.02) {
    // 아래로 흐르는 줄무늬. 속도가 빠를수록 빨리 흐른다.
    diveEl.style.backgroundPositionY = ((performance.now() * (0.4 + player.vel.length() * 0.012)) % 1000) + "px";
  }
  // 3인칭 뼈 보정. 클립이 적용된 **뒤**, 렌더 **전**이어야 한다 —
  // 먼저 부르면 클립이 우리 회전을 덮어쓴다.
  pose3pNow();
  renderer.render(scene, camera);
}
// 적 배치가 끝난 뒤에 구역을 배정하고 첫 목표를 정한다
requestAnimationFrame(frame);


// ---------------------------------------------------------------------------
// 개발용 화면 캡처 훅.
// 미리보기 패널이 백그라운드면 rAF가 멈춰 화면이 갱신되지 않는다.
// 이 훅으로 원하는 위치·방향에서 강제로 한 장 렌더해 JPEG로 뽑아낸다.
window.__shotWeb = (opts = {}) => {
  // 지정 위치에서 거미줄을 걸고 그 상태로 한 장 찍는다
  if (opts.x !== undefined) {
    player.pos.set(opts.x, opts.y, opts.z); player.vel.set(0,0,0);
    player.prevPos.copy(player.pos); player.renderPos.copy(player.pos);
  }
  firstPerson = opts.fp !== false;
  viewYaw = opts.yaw || 0; viewPitch = opts.pitch || -0.3;
  for (let i=0;i<10;i++) updateCamera(0.1);
  scene.updateMatrixWorld(true);
  mouseDownL = true;
  const ok = tryAttach();
  if (ok) { web.t = 1; for (let i=0;i<6;i++) update(1/120); }
  const url = window.__shot(opts);
  return { ok, url };
};

window.__shot = (opts = {}) => {
  const o = Object.assign({ yaw: 0, pitch: -0.15, fov: 70, w: 1280, h: 720, fp: false }, opts);
  if (o.x !== undefined) {
    player.pos.set(o.x, o.y, o.z); player.vel.set(0, 0, 0);
    // 카메라는 보간 위치를 따르므로 순간이동 시 함께 맞춰야 한다
    player.prevPos.copy(player.pos); player.renderPos.copy(player.pos);
  }
  firstPerson = o.fp;
  spiderGroup.visible = !o.fp;
  viewYaw = o.yaw;
  viewPitch = o.pitch;
  const oldW = renderer.domElement.width, oldH = renderer.domElement.height;
  renderer.setSize(o.w, o.h, false);
  camera.aspect = o.w / o.h;
  camera.fov = o.fov;
  camera.updateProjectionMatrix();
  // 카메라 보간을 건너뛰고 즉시 자리잡게 큰 dt로 여러 번 돌린다
  for (let i = 0; i < 40; i++) updateCamera(0.2);
  updateWebVisual();
  scene.updateMatrixWorld(true);
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/jpeg", 0.85);
  // 숨겨진 패널에서는 캔버스 크기가 0일 수 있다. 그대로 복원하면 종횡비가 NaN이 되고
  // 이후 모든 레이캐스트(조준·부착)가 조용히 실패한다.
  const rw = oldW > 0 ? oldW : o.w, rh = oldH > 0 ? oldH : o.h;
  renderer.setSize(rw, rh, false);
  camera.aspect = rw / rh;
  camera.updateProjectionMatrix();
  return url;
};
// ================== 터치 조작 (아이패드) ==================
// 조준을 요구하지 않는 게 핵심이다. 스윙 앵커는 findSwingAnchor가 고른다.
let touchMode = false;
let stickX = 0, stickY = 0, stickLen = 0;
// 손을 뗀 뒤 이만큼 지나면 자동 카메라가 다시 붙는다.
const CAM_RETURN = 2.5;
let lookIdle = 0;          // 마지막 시점 조작 이후 흐른 시간
let lookActive = false;    // 지금 손가락으로 시점을 돌리는 중인가

function enableTouch() {
  if (touchMode) return;
  touchMode = true;
  document.body.classList.add('touch');
  camAuto = true;            // 자동 카메라가 있어야 시점을 거의 안 만진다
  firstPerson = false;       // 3인칭이 터치에 훨씬 편하다
  spiderGroup.visible = true;
  const vw = innerWidth || document.documentElement.clientWidth || 1024;
  const vh = innerHeight || document.documentElement.clientHeight || 768;
  mx = vw / 2; my = vh / 2;      // 터치엔 커서가 없다 — 조준 기준을 화면 중앙으로
  say('터치 모드', 2.5);
}

// 터치 UI를 켤지 판정한다.
//  · maxTouchPoints는 못 쓴다 — 터치스크린/정밀 터치패드 노트북이 10을 보고한다.
//  · pointer:coarse(주 입력이 손가락) + hover:none(호버 불가) 이라야 태블릿·폰이다.
// ?touch=1 강제 켜기 / ?touch=0 강제 끄기. 한 번 정하면 그 기기에 기억된다.
function wantTouchUI() {
  const q = /[?&]touch=([01])/.exec(location.search);
  if (q) {
    try { localStorage.setItem('touchUI', q[1]); } catch (e) {}
    return q[1] === '1';
  }
  try {
    const saved = localStorage.getItem('touchUI');
    if (saved !== null) return saved === '1';
  } catch (e) {}
  const mm = window.matchMedia;
  if (!mm) return false;
  return mm('(pointer: coarse)').matches && mm('(hover: none)').matches;
}
if (wantTouchUI()) enableTouch();

{
  const padEl = document.getElementById('touchUI');
  const stickBase = document.getElementById('stickBase');
  const stickKnob = document.getElementById('stickKnob');
  const STICK_R = 62;                 // 스틱 최대 반경(px)

  // pointerId -> 이 손가락이 무슨 역할인지
  const active = new Map();

  function updateStickVisual(dx, dy) {
    stickKnob.style.transform = 'translate(' + dx.toFixed(0) + 'px,' + dy.toFixed(0) + 'px)';
  }

  // 베이스는 화면에 고정. 어디를 짚든 베이스 중심을 원점으로 삼는다.
  function stickCenter() {
    const r = stickBase.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function beginStick(id, x, y) {
    stickBase.classList.add('on');
    active.set(id, { kind: 'stick' });
    moveStick(null, x, y);
  }
  function moveStick(t, x, y) {
    const c = stickCenter();
    let dx = x - c.x, dy = y - c.y;
    const l = Math.hypot(dx, dy);
    if (l > STICK_R) { dx = dx / l * STICK_R; dy = dy / l * STICK_R; }
    updateStickVisual(dx, dy);
    stickX = dx / STICK_R;
    stickY = dy / STICK_R;          // 화면 아래 = 뒤로 (iz 부호와 같다)
    stickLen = Math.min(1, l / STICK_R);
  }
  function endStick() {
    stickX = stickY = stickLen = 0;
    stickBase.classList.remove('on');
    updateStickVisual(0, 0);
  }

  function onDown(e) {
    if (!touchMode) return;
    const btn = e.target.closest && e.target.closest('.tbtn');
    if (btn) {
      e.preventDefault();
      active.set(e.pointerId, { kind: 'btn', el: btn });
      btn.classList.add('on');
      pressBtn(btn.dataset.act);
      return;
    }
    e.preventDefault();
    initAudio();
    // 화면 왼쪽 42%는 이동 스틱, 나머지는 시점.
    // innerWidth가 0으로 잡히는 순간(회전 직후 등)이 있어 대체값을 둔다.
    const vw = innerWidth || document.documentElement.clientWidth || 1024;
    if (e.clientX < vw * 0.42) beginStick(e.pointerId, e.clientX, e.clientY);
    else active.set(e.pointerId, { kind: 'look', px: e.clientX, py: e.clientY });
  }

  function onMove(e) {
    const t = active.get(e.pointerId);
    if (!t) return;
    e.preventDefault();
    if (t.kind === 'stick') moveStick(t, e.clientX, e.clientY);
    else if (t.kind === 'look') {
      viewYaw -= (e.clientX - t.px) * 0.006;
      viewPitch -= (e.clientY - t.py) * 0.005;
      viewPitch = Math.min(Math.max(viewPitch, -1.0), 1.2);
      t.px = e.clientX; t.py = e.clientY;
      camAuto = false;            // 직접 돌리는 동안만 물러난다 (아래에서 되돌아온다)
      lookIdle = 0;
      lookActive = true;
    }
  }

  function onUp(e) {
    const t = active.get(e.pointerId);
    if (!t) return;
    active.delete(e.pointerId);
    if (t.kind === 'stick') endStick();
    else if (t.kind === 'look') { lookActive = false; lookIdle = 0; }
    else if (t.kind === 'btn') { t.el.classList.remove('on'); releaseBtn(t.el.dataset.act); }
  }

  // 거미줄 버튼 상태: 누른 시각과 이번 누름으로 새로 붙였는지
  let webBtnDown = false;

  function pressBtn(act) {
    if (act === 'web') {
      webBtnDown = true;
      if (web) releaseWeb();                    // 붙어 있으면 이번 탭은 놓기
      else { mouseDownL = true; tryAttachAuto(); }
    }
    else if (act === 'reel') keys['Space'] = true;      // 줄 감기 (거미줄 옆 버튼)
    else if (act === 'boost') keys['KeyE'] = true;      // 속도 부스트
    else if (act === 'jump') keys['Space'] = true;
    else if (act === 'dash') { keys['ShiftLeft'] = true; }
    else if (act === 'help') hudEl.classList.toggle('show');
    else if (act === 'view') {
      firstPerson = !firstPerson;
      spiderGroup.visible = !firstPerson;
      say(firstPerson ? '1인칭' : '3인칭', 1.6);
    }
  }
  function releaseBtn(act) {
    // 거미줄은 떼도 줄이 유지된다. 감기만 멈춘다.
    if (act === 'web') webBtnDown = false;    // 떼도 줄은 유지된다
    else if (act === 'reel') keys['Space'] = false;
    else if (act === 'boost') keys['KeyE'] = false;
    else if (act === 'jump') keys['Space'] = false;
    else if (act === 'dash') keys['ShiftLeft'] = false;
  }

  // 스킬 버튼 쿨타임 — 아래에서 차오르는 층으로 남은 시간을 보여준다
  const cdMap = [
    ['btnC', () => lungeCd / LUNGE_CD],
    ['btnR', () => pullCd / PULL_CD],
    ['btnE', () => bindCd / BIND_CD],
  ].map(([id, f]) => {
    const el = document.getElementById(id);
    return el ? [el.querySelector('.cd'), f, el] : null;
  }).filter(Boolean);
  const modeEl = document.getElementById('btnMode');
  let camPrevT = performance.now();
  function updateTouchCd() {
    // 시점에서 손을 뗀 뒤 CAM_RETURN 만큼 지나면 자동 카메라가 다시 붙는다.
    // 한 번 만졌다고 영영 수동으로 두면 스윙 내내 시점을 직접 몰아야 한다.
    const nowMs = performance.now();
    const dtc = Math.min(0.1, (nowMs - camPrevT) / 1000);
    camPrevT = nowMs;
    if (!lookActive) {
      lookIdle += dtc;
      if (lookIdle > CAM_RETURN && !camAuto && !camHold) { camAuto = true; camMsg = 1.2; }
    }
    for (const [bar, f, el] of cdMap) {
      const v = Math.max(0, Math.min(1, f()));
      bar.style.height = (v * 100).toFixed(0) + '%';
      el.classList.toggle('ready', v <= 0);
    }
  }
  window.__touchCd = updateTouchCd;

  if (padEl) {
    addEventListener('pointerdown', onDown, { passive: false });
    addEventListener('pointermove', onMove, { passive: false });
    addEventListener('pointerup', onUp);
    addEventListener('pointercancel', onUp);
  }
  // 디버그용
  window.__touch = { get mode(){ return touchMode; }, enableTouch, keys,
    get camAuto(){ return camAuto; }, get lookIdle(){ return lookIdle; }, CAM_RETURN,
    get stick(){ return { x: stickX, y: stickY, len: stickLen }; },
    onDown, onMove, onUp, findSwingAnchor, tryAttachAuto };
}

window.__dbg = { scene, camera, renderer, player, frameBody, updateWebVisual, nycStats, nycFind,
  get fpIne(){ return fpIne; }, get fpFwdAcc(){ return fpFwdAcc; }, get fpRoll(){ return fpRoll; }, makeBodyInertia,
  get hp(){ return hp; }, setHp(v){ hp = v; }, HP_MAX, SPAWN, hitCars, tickHp, get carHits(){ return carHits; }, CAR_ROOF, HERO_3P_SCALE,
  grabStart, grabEnd, updateGrab, get grabbed(){ return grabbed; }, get missShot(){ return missShot; }, get missStrand(){ return missStrand; }, tryAttach, propBodies, propPick, propGrab, propYank, propThrow, propStep, CAR_L, CAR_W, CAR_H,
  YAW_OUT, YAW_IN, PITCH_UP, PITCH_DN, spiderGroup, buildings, blocks, cars, groundAt: groundHeightAt, updateCars, setNight, get night(){ return night; }, HEROES, applyHero, get hero(){ return hero; }, get speedBase(){ return speedBase; }, get shakeScale(){ return shakeScale; }, get audioOn(){ return audioOn; }, bootDone, bootStep, showMenu, get menuOn(){ return menuOn; }, updateMenuCamera, update, updateCamera, updateCrosshair, updateHud, get viewYaw(){ return viewYaw; }, get viewPitch(){ return viewPitch; }, setView(y,p){ viewYaw = y; viewPitch = p; }, setKey(k,v){ if(v) keys[k]=true; else delete keys[k]; }, setMouseL(v){ mouseDownL = v; }, setMouseR(v){ mouseDownR = v; }, setMid(v){ midDown = v; }, setCursor(x,y){ mx = x; my = y; }, canAct, // 웹
  get web(){ return web; }, get web2(){ return web2; }, get zip(){ return zip; }, attachWeb, releaseWeb, attachWeb2, releaseWeb2, tryAttach, resolveAnchor, sideOf, otherSide, setWeb2Held(v){ web2Held = v; }, get web2Held(){ return web2Held; }, get web2Count(){ return web2Count; }, WEB2_PULL, WEB2_FADE, armR, armL, webStrand, // 자동 앵커
  findSwingAnchor, findSwingAnchorV2, findSwingAnchorLegacy, scoreAnchor, scoreAnchorV2, intentDir, fanYaw, A_TUNE, FAN_PITCH, get autoV2(){ return autoV2; }, setAutoV2(v){ autoV2 = !!v; }, get autoHand(){ return autoHand; }, get scoreWhy(){ return scoreWhy; }, // 디버그 오버레이
  toggleWebDbg, updateWebDbg, dbgOn, setDbg, dbgCands, dbgPicked, dbgPickIdx, dbgAccepted, dbgLines, MAX_CAND, get dbgMarks(){ return dbgMarks; }, // 벽 짚기 · 건물 타기
  plantCheck, plantImpulse, plantSide, plantPoint, findNearbyWall, PLANT_TIME, PLANT_MIN_V, PLANT_PUSH, PLANT_KEEP, PLANT_CD, PLANT_LOOK, get plantT(){ return plantT; }, get plantCd(){ return plantCd; }, get plantHand(){ return plantHand; }, get plantCount(){ return plantCount; }, vclimbAnchor, vclimbShouldFire, VC_NEAR, VC_STEP, VC_OUT, VC_ARRIVE, VC_TOP, VC_CD, get vcCount(){ return vcCount; }, get vcCd(){ return vcCd; }, setClimb(v){ climbMouse = v; }, // 슬링샷
  fireSling, updateSling, slingArmed, slingDir, autoDualWeb, findDualAnchors, DUAL_SPREAD, SLING_AIR_DRAW, SLING_V_AIR, get slingK(){ return slingK; }, get slingCount(){ return slingCount; }, get slingAir(){ return slingAir; }, get slingDrawn(){ return slingDrawn; }, get slingMode(){ return slingMode; }, SLING_CHARGE_T, SLING_MIN_K, SLING_V_MIN, SLING_V_MAX, SLING_AIR_DRAW, // 손 · 몸 표현
  getReach, setReach, clearReach, updateReach, applyReach, initReach, init3p, pose3p, bones3p, ready3p, pose3pNow, get rig3pOn(){ return rig3pOn; }, get fpBody(){ return fpBody; }, poseFpBody, ensureUpperArms, linkUpperArm, get upperR(){ return upperR; }, get upperL(){ return upperL; }, SHOULDER_R, SHOULDER_L, // 카메라 · 설정
  cineFire, cineAmt, get cineT(){ return cineT; }, camStandDist, CAM_SHOULDER, CAM_TIGHT, CAM_WALL_PAD, CAM_MIN_DIST, CAM_NEAR_SKIN, CAM_HIDE_DIST, CAM_PIVOT_Y, get camZoom(){ return camZoom; }, get camBlocked(){ return camBlocked; }, SETTINGS, setOpt, setAim, drawSettings, get aimCenter(){ return aimCenter; }, setAimCenter(v){ aimCenter = v; if (v) camAuto = false; }, get uiMode(){ return uiMode; }, // 미니맵 · 기타
  updateMinimap, mmPt, MM_R, mmBuildCity, MOVE_SPEED, FALL_MIN_V, get diving(){ return diving; }, get toast(){ return toastT > 0 ? toast : ""; }, get heroClip(){ return heroCurrentClip; }, get heroClips(){ return Object.keys(heroActions); } };
