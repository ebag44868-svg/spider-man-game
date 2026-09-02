import * as THREE from "three";
import { GLTFLoader } from "./lib/loaders/GLTFLoader.js";
import { mergeGeometries } from "./lib/utils/BufferGeometryUtils.js";

// preserveDrawingBuffer: 개발 중 화면을 캡처해서 확인하기 위해 켜둔다
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(innerWidth, innerHeight);
// 해상도 배율은 고정하지 않는다. 아래 adaptRes()가 프레임 시간에 맞춰 조절한다.
let resScale = 1;
const RES_MIN = 0.55, RES_MAX = Math.min(devicePixelRatio, 1.5);
resScale = RES_MAX;
renderer.setPixelRatio(resScale);
document.body.appendChild(renderer.domElement);

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
if (renderer.compile) {   // 헤드리스 테스트 환경에는 실제 WebGL 컨텍스트가 없다
  const pmrem = new THREE.PMREMGenerator(renderer);
  const skyScene = new THREE.Scene();
  skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), skyMat));
  scene.environment = pmrem.fromScene(skyScene, 0.04).texture;
  pmrem.dispose();
}

// ===================== 도시 생성 (맨해튼 비례) =====================
// 실제 뉴욕의 느낌은 "정사각 격자"가 아니라 비대칭 격자에서 나온다.
//   애비뉴(남북) — 넓고, 서로 멀다  -> 길게 뻗은 광폭 대로
//   스트리트(동서) — 좁고, 촘촘하다 -> 짧은 간격의 골목 같은 길
// 그래서 블록이 동서로 길쭉하고, 그 긴 면에 좁은 건물들이 다닥다닥 붙는다.
// 이 비례만 맞춰도 스윙할 때 도시가 뉴욕처럼 읽힌다.
const AVE_SPACING = 296;   // 애비뉴 간격 (동서 방향 블록 길이)
const ST_SPACING  = 108;   // 스트리트 간격 (남북 방향 블록 폭)
const AVE_ROAD_W  = 68;    // 애비뉴 노폭 (넓다)
const ST_ROAD_W   = 48;    // 스트리트 노폭 (좁다)
const N_AVE = 10;          // 애비뉴 개수
const N_ST  = 30;          // 스트리트 개수

const BLOCK_W = AVE_SPACING - AVE_ROAD_W;   // 블록 동서 길이 234m
const BLOCK_D = ST_SPACING - ST_ROAD_W;     // 블록 남북 폭   64m

const WORLD_SIZE = Math.max(N_AVE * AVE_SPACING, N_ST * ST_SPACING);
// 공간 해시는 도시 배치와 무관한 순수 가속 구조라 따로 둔다
const CELL = 100;
const CELLS = Math.ceil(WORLD_SIZE / CELL) + 2;

const KIND_BRICK = 0;   // 브라운스톤 (저층, 붉은 벽돌)
const KIND_GLASS = 1;   // 유리 타워 (고층)
const KIND_CONC  = 2;   // 콘크리트 오피스 (중층)
const KIND_IND   = 3;   // 산업·창고 (저층, 골강판)
const KIND_COUNT = 4;

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

for (let ai = 0; ai < N_AVE; ai++) {
  for (let si = 0; si < N_ST; si++) {
    const cx = (ai - AVE_C) * AVE_SPACING;
    const cz = (si - ST_C) * ST_SPACING;
    const x0 = cx - BLOCK_W / 2, x1 = cx + BLOCK_W / 2;
    const z0 = cz - BLOCK_D / 2, z1 = cz + BLOCK_D / 2;
    blocks.push({ key: si * N_AVE + ai, x0, x1, z0, z1 });

    // 도심 정도 — 가운데일수록 높다
    const dist = Math.hypot((ai - AVE_C) / N_AVE, (si - ST_C) / N_ST) * 2;
    const downtown = Math.max(0, 1 - dist / 0.75);
    const midtown = Math.max(0, 1 - dist / 1.4);

    // 블록의 긴 면(동서)을 따라 좁은 필지로 쪼갠다 -> 다닥다닥 붙은 건물 줄
    let x = x0;
    while (x < x1 - 12) {
      const lotW = Math.min(x1 - x, 20 + Math.random() * 34);
      // 가끔 필지 몇 개를 합쳐 큰 타워를 세운다
      const bigLot = downtown > 0.35 && Math.random() < 0.22;
      const w = bigLot ? Math.min(x1 - x, lotW + 40 + Math.random() * 40) : lotW;

      let h = 26 + Math.random() * 34;
      h += midtown * 70 * Math.random();
      h += downtown * (150 + Math.random() * 190);
      if (bigLot) h *= 1.5 + Math.random() * 0.6;
      const landmark = downtown > 0.45 && Math.random() < 0.09;
      if (landmark) h *= 1.9 + Math.random() * 1.0;

      let kind;
      if (h > 300) kind = Math.random() < 0.72 ? KIND_GLASS : KIND_CONC;
      else if (h > 130) kind = Math.random() < 0.5 ? KIND_CONC : KIND_GLASS;
      else if (h < 50 && Math.random() < 0.3) kind = KIND_IND;
      else kind = Math.random() < 0.72 ? KIND_BRICK : KIND_CONC;

      const bx = x + w / 2;
      // 블록 깊이를 그대로 쓰되 살짝 물러나게 해 안뜰 느낌을 만든다
      const d = BLOCK_D * (0.86 + Math.random() * 0.14);

      if (landmark || (h > 220 && Math.random() < 0.5)) {
        addSetbackTower(bx, cz, w, d, h, kind);
      } else {
        addBox(bx, cz, w, d, h, kind);
        // 벽에서 툭 튀어나온 캔틸레버
        if (h > 130 && Math.random() < 0.16) {
          const out = 12 + Math.random() * 14;
          const y0 = h * (0.4 + Math.random() * 0.4);
          const side = Math.random() < 0.5 ? 1 : -1;
          addBox(bx, cz + side * (d / 2 + out / 2), Math.min(w, 18), out, 7 + Math.random() * 9, kind, y0);
        }
      }
      x += w + 0.5;
    }
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
      addBox((a.x + nb.x) / 2, (z0 + z1) / 2, 8 + Math.random() * 8, z1 - z0, 4.5, KIND_CONC, y0);
    }
  }
}

const boxGeo = new THREE.BoxGeometry(1, 1, 1);
boxGeo.translate(0, 0.5, 0);

function makeFacadeTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");

  const baseR = 182, baseG = 168, baseB = 148;
  g.fillStyle = `rgb(${baseR}, ${baseG}, ${baseB})`;
  g.fillRect(0, 0, 256, 256);

  const brickW = 32, brickH = 16, mortarW = 2;

  for (let y = 0; y < Math.ceil(256 / (brickH + mortarW)); y++) {
    for (let x = 0; x < Math.ceil(256 / (brickW + mortarW)); x++) {
      const offsetX = (y % 2) * ((brickW + mortarW) / 2);
      const px = x * (brickW + mortarW) + offsetX;
      const py = y * (brickH + mortarW);

      if (px + brickW > 256 || py + brickH > 256) continue;

      const shade = 0.9 + Math.random() * 0.1;
      g.fillStyle = `rgb(${Math.floor(baseR * shade)}, ${Math.floor(baseG * shade)}, ${Math.floor(baseB * shade)})`;
      g.fillRect(px, py, brickW, brickH);

      g.strokeStyle = "rgba(0,0,0,0.17)";
      g.lineWidth = mortarW;
      g.strokeRect(px, py, brickW, brickH);
    }
  }

  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 1;
  return t;
}

// 인스턴스마다 크기가 제각각인데 UV는 0..1이라, 그냥 두면 큰 오브젝트에서 텍스처가
// 늘어나 뭉개진다(366m 건물의 벽돌 한 장이 수십 미터가 되는 식).
// 인스턴스 행렬에서 실제 치수를 뽑아 UV를 미터 단위로 다시 매기면 어디서나 같은 밀도가 된다.
function worldScaleUv(mat, tile) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <uv_vertex>",
      `#include <uv_vertex>
      #ifdef USE_INSTANCING
        vec3 iScale = vec3(
          length(instanceMatrix[0].xyz),
          length(instanceMatrix[1].xyz),
          length(instanceMatrix[2].xyz));
        vec3 an = abs(normal);
        vec2 dims = an.y > 0.5 ? vec2(iScale.x, iScale.z)
                  : an.x > 0.5 ? vec2(iScale.z, iScale.y)
                               : vec2(iScale.x, iScale.y);
        vec2 wuv = uv * dims / float(${tile.toFixed(1)});
        // 색/노멀/러프니스가 각자 다른 varying을 쓰므로 전부 같은 좌표로 맞춰야 한다.
        // 하나라도 빠뜨리면 요철과 무늬가 서로 어긋나 표면이 깨져 보인다.
        #ifdef USE_MAP
          vMapUv = wuv;
        #endif
        #ifdef USE_NORMALMAP
          vNormalMapUv = wuv;
        #endif
        #ifdef USE_ROUGHNESSMAP
          vRoughnessMapUv = wuv;
        #endif
        #ifdef USE_EMISSIVEMAP
          vEmissiveMapUv = wuv;
        #endif
      #endif`
    );
  };
  return mat;
}

// --- 유리 커튼월: 층/기둥 격자 + 불 켜진 칸 --- (타일 1장 = 6m ≒ 두 개 층)
function makeGlassTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  // 실제 커튼월은 패널이 가로 1.5m x 세로 3m 정도. 이 타일 1장이 6m를 덮으므로
  // 4x2 격자여야 비례가 맞는다. 더 잘게 쪼개면 모자이크처럼 보인다.
  const COLS = 4, ROWS = 2, cw = 512 / COLS, ch = 512 / ROWS;
  g.fillStyle = '#33505f';
  g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const px = x * cw, py = y * ch;
      // 대부분은 비슷한 청록 유리. 변화폭을 좁게 둬야 '한 장의 커튼월'로 읽힌다.
      const b = 74 + Math.random() * 26;
      g.fillStyle = `rgb(${(b * 0.62) | 0},${(b * 0.95) | 0},${(b * 1.15) | 0})`;
      g.fillRect(px, py, cw, ch);
      // 하늘 반사: 위에서 아래로 밝기가 떨어지는 그라디언트
      const grd = g.createLinearGradient(px, py, px, py + ch);
      grd.addColorStop(0, 'rgba(200,225,245,0.34)');
      grd.addColorStop(0.45, 'rgba(160,195,220,0.10)');
      grd.addColorStop(1, 'rgba(10,25,40,0.20)');
      g.fillStyle = grd;
      g.fillRect(px, py, cw, ch);
      // 드물게 불 켜진 사무실
      if (Math.random() < 0.10) {
        g.fillStyle = 'rgba(255,232,180,0.5)';
        g.fillRect(px + cw * 0.1, py + ch * 0.18, cw * 0.8, ch * 0.6);
      }
    }
  }
  // 멀리언(창틀) — 가로선을 세로선보다 진하게 해야 층이 읽힌다
  g.strokeStyle = 'rgba(214,224,234,0.75)';
  g.lineWidth = 5;
  for (let i = 0; i <= ROWS; i++) { g.beginPath(); g.moveTo(0, i * ch); g.lineTo(512, i * ch); g.stroke(); }
  g.strokeStyle = 'rgba(200,212,224,0.45)';
  g.lineWidth = 3;
  for (let i = 0; i <= COLS; i++) { g.beginPath(); g.moveTo(i * cw, 0); g.lineTo(i * cw, 512); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 1;
  return t;
}

// --- 콘크리트 오피스: 밝은 벽면에 창을 파낸 격자 ---
function makeConcreteFacadeTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#b9b3a6";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 7000; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  const COLS = 6, ROWS = 6, cw = 512 / COLS, ch = 512 / ROWS;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const px = x * cw + cw * 0.18, py = y * ch + ch * 0.2;
      const ww = cw * 0.64, wh = ch * 0.5;
      const lit = Math.random() < 0.18;
      g.fillStyle = lit ? "#f0e2b4" : `rgb(${40 + Math.random() * 22 | 0},${50 + Math.random() * 24 | 0},${62 + Math.random() * 26 | 0})`;
      g.fillRect(px, py, ww, wh);
      // 창 아래 그림자 = 벽에서 창이 파인 느낌
      g.fillStyle = "rgba(0,0,0,0.28)";
      g.fillRect(px, py, ww, wh * 0.16);
      g.fillStyle = "rgba(255,255,255,0.22)";
      g.fillRect(px, py + wh, ww, 3);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 1;
  return t;
}

// --- 산업·창고: 세로 골강판 + 녹 ---
function makeIndustrialTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#7d8489";
  g.fillRect(0, 0, 512, 512);
  for (let x = 0; x < 512; x += 16) {
    g.fillStyle = "rgba(255,255,255,0.13)";
    g.fillRect(x, 0, 6, 512);
    g.fillStyle = "rgba(0,0,0,0.22)";
    g.fillRect(x + 10, 0, 5, 512);
  }
  for (let i = 0; i < 26; i++) {
    g.fillStyle = `rgba(${120 + Math.random() * 50 | 0},${60 + Math.random() * 30 | 0},30,${0.06 + Math.random() * 0.12})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 20 + Math.random() * 70, 20 + Math.random() * 90);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 1;
  return t;
}

// --- Poly Haven CC0 PBR 텍스처 ---
// 캔버스로 그린 그림 대신 사진 기반 albedo/normal/roughness를 쓴다.
// normal map이 있어야 1인칭에서 벽에 붙었을 때 표면 요철이 빛을 받아 살아난다.
const texLoader = new THREE.TextureLoader();
function loadPbr(name, srgb = true) {
  const t = texLoader.load(`assets/textures/${name}.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 1;
  return t;
}
// 같은 재질을 여러 번 만들지 않도록 한 번만 읽어 캐시한다
function pbrSet(base) {
  return {
    map: loadPbr(`${base}_diff`),
    normalMap: loadPbr(`${base}_nor`, false),
    roughnessMap: loadPbr(`${base}_rough`, false),
  };
}
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
const KIND_DEF = [
  { pbr: PBR.brick,    tile: 4,  rough: 1,    hue: [0.04, 0.05], sat: [0.10, 0.12], lig: [0.62, 0.16] }, // 벽돌
  { tex: makeGlassTexture(), tile: 6, rough: 0.18, metal: 0.35, hue: [0.53, 0.10], sat: [0.10, 0.14], lig: [0.70, 0.16] }, // 유리
  { pbr: PBR.concrete, tile: 6,  rough: 1,    hue: [0.09, 0.06], sat: [0.02, 0.05], lig: [0.74, 0.16] }, // 콘크리트
  { tex: makeIndustrialTexture(), tile: 5, rough: 0.7, hue: [0.55, 0.08], sat: [0.04, 0.06], lig: [0.62, 0.14] }, // 산업
];

const cityMeshes = [];
{
  const byKind = Array.from({ length: KIND_COUNT }, () => []);
  for (const b of buildings) byKind[b.kind].push(b);

  const c = new THREE.Color();
  KIND_DEF.forEach((def, k) => {
    const list = byKind[k];
    if (!list.length) return;
    const mat = def.pbr
      ? new THREE.MeshStandardMaterial({ ...def.pbr, color: 0xffffff, roughness: def.rough,
          normalScale: new THREE.Vector2(1.4, 1.4), envMapIntensity: 0.75 })
      : new THREE.MeshStandardMaterial({ map: def.tex, color: 0xffffff, roughness: def.rough,
          metalness: def.metal || 0, envMapIntensity: 0.85 });
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
    if (b.kind === KIND_GLASS) continue;
    if (Math.min(b.w, b.d) < 14) continue;
    if (Math.random() > 0.42) continue;
    const r = 2.4 + Math.random() * 1.3;
    towers.push({
      x: b.x + (Math.random() - 0.5) * (b.w - r * 2 - 4),
      z: b.z + (Math.random() - 0.5) * (b.d - r * 2 - 4),
      y: b.h, r, legH: 3 + Math.random() * 2.5, tankH: 5 + Math.random() * 2.5,
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
      dummy.scale.set(0.32, t.legH, 0.32);
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
const SIDEWALK_W = 4.5;    // 인도 폭 (좁은 스트리트에도 차도가 남도록)
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

function makeConcreteTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 512;
  const g = c.getContext("2d");
  g.fillStyle = "#9aa0a8";
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(0,0,0,${Math.random() * 0.07})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  // 보도블록 줄눈 — 텍스처 1장이 2m 이므로 128px = 0.5m 간격 판
  g.strokeStyle = "rgba(0,0,0,0.3)";
  g.lineWidth = 2.5;
  for (let i = 0; i <= 512; i += 128) {
    g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 512); g.stroke();
    g.beginPath(); g.moveTo(0, i); g.lineTo(512, i); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 1;
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

// --- 차선 점선 & 횡단보도 ---
// 애비뉴는 넓어 중앙선이 두 줄, 스트리트는 좁아 한 줄.
const paintMat = new THREE.MeshBasicMaterial({ color: 0xd8d4b8 });
const paint = [];
const DASH_LEN = 4, DASH_GAP = 7, DASH_W = 0.4;
const HALF_X = (N_AVE * AVE_SPACING) / 2, HALF_Z = (N_ST * ST_SPACING) / 2;

// 애비뉴(남북 도로): 애비뉴 사이 경계마다
for (let ai = 0; ai < N_AVE - 1; ai++) {
  const cx = (ai - AVE_C) * AVE_SPACING + AVE_SPACING / 2;
  for (const lane of [-7, 7]) {          // 넓은 대로라 차선 두 줄
    for (let z = -HALF_Z; z < HALF_Z; z += DASH_LEN + DASH_GAP) {
      // 교차로(스트리트와 만나는 곳)는 비워둔다
      if (Math.abs(((z + HALF_Z) % ST_SPACING) - ST_SPACING / 2) > ST_SPACING / 2 - 14) continue;
      paint.push({ x: cx + lane, z, w: DASH_W, d: DASH_LEN });
    }
  }
}
// 스트리트(동서 도로)
for (let si = 0; si < N_ST - 1; si++) {
  const cz = (si - ST_C) * ST_SPACING + ST_SPACING / 2;
  for (let x = -HALF_X; x < HALF_X; x += DASH_LEN + DASH_GAP) {
    if (Math.abs(((x + HALF_X) % AVE_SPACING) - AVE_SPACING / 2) > AVE_SPACING / 2 - 24) continue;
    paint.push({ x, z: cz, w: DASH_LEN, d: DASH_W });
  }
}
// 횡단보도: 교차로 네 방향
const ZEBRA_W = 0.75;
for (let ai = 0; ai < N_AVE - 1; ai++) {
  for (let si = 0; si < N_ST - 1; si++) {
    const cx = (ai - AVE_C) * AVE_SPACING + AVE_SPACING / 2;
    const cz = (si - ST_C) * ST_SPACING + ST_SPACING / 2;
    for (let k = 0; k < 8; k++) {
      const o = (k - 3.5) * 2.4;
      // 애비뉴를 건너는 횡단보도 (넓다)
      paint.push({ x: cx + o, z: cz - ST_ROAD_W / 2 - 3, w: ZEBRA_W, d: AVE_ROAD_W * 0.5 });
      paint.push({ x: cx + o, z: cz + ST_ROAD_W / 2 + 3, w: ZEBRA_W, d: AVE_ROAD_W * 0.5 });
    }
    for (let k = 0; k < 5; k++) {
      const o = (k - 2) * 2.4;
      // 스트리트를 건너는 횡단보도 (좁다)
      paint.push({ x: cx - AVE_ROAD_W / 2 - 3, z: cz + o, w: AVE_ROAD_W * 0.5, d: ZEBRA_W });
      paint.push({ x: cx + AVE_ROAD_W / 2 + 3, z: cz + o, w: AVE_ROAD_W * 0.5, d: ZEBRA_W });
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
let neonMat = null, neonGlowMesh = null, signalMat = null;
let streetDetailCount = 0;

// ===================== 가로등 =====================
// 도로변을 따라 일정 간격으로. 기둥 + 도로 쪽으로 뻗은 팔 + 램프 헤드.
{
  const poles = [], arms = [], heads = [];
  const POLE_H = 9, ARM_L = 3.2, GAP = 68;
  for (const bl of blocks) {
    // 블록 네 변 중 긴 면(스트리트 쪽) 위주로 세운다
    for (let x = bl.x0 + 14; x < bl.x1 - 10; x += GAP) {
      for (const side of [-1, 1]) {
        const z = side < 0 ? bl.z0 - SIDEWALK_W + 1.2 : bl.z1 + SIDEWALK_W - 1.2;
        poles.push({ x, z, h: POLE_H });
        arms.push({ x, z: z + side * ARM_L / 2, y: POLE_H - 0.5, w: 0.22, d: ARM_L, dir: side });
        heads.push({ x, z: z + side * ARM_L, y: POLE_H - 0.75 });
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
    dummy.scale.set(0.16, p.h, 0.16);
    dummy.updateMatrix(); poleMesh.setMatrixAt(i, dummy.matrix);
  });
  const armMesh = new THREE.InstancedMesh(boxGeo, poleMat, arms.length);
  arms.forEach((a, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(a.x, a.y, a.z);
    dummy.scale.set(a.w, 0.18, a.d);
    dummy.updateMatrix(); armMesh.setMatrixAt(i, dummy.matrix);
  });
  const headMesh = new THREE.InstancedMesh(boxGeo, headMat, heads.length);
  heads.forEach((h, i) => {
    dummy.rotation.set(0, 0, 0);
    dummy.position.set(h.x, h.y, h.z);
    dummy.scale.set(0.5, 0.26, 1.1);
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
    dummy.position.set(h.x, h.y - 0.6, h.z);
    dummy.scale.set(5.2, 2.2, 6.2);
    dummy.updateMatrix(); lampGlowMesh.setMatrixAt(i, dummy.matrix);
  });
  lampGlowMesh.instanceMatrix.needsUpdate = true;
  lampGlowMesh.frustumCulled = false;
  lampGlowMesh.visible = false;
  scene.add(lampGlowMesh);

  lampCount = poles.length;
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
      for (const sgn of [-1, 1]) {
        const px = cx + sgn * (AVE_ROAD_W / 2 + SIDEWALK_W * 0.6);
        const pz = cz + sgn * (ST_ROAD_W / 2 + SIDEWALK_W * 0.6);
        poles.push({ x: px, z: pz, h: 8.4 });
        bars.push({ x: px - sgn * 3.4, z: pz, y: 7.9, w: 6.8 });
        heads.push({ x: px - sgn * 6.4, z: pz, y: 7.1 });
      }
    }
  }

  // --- 비상계단 / 네온 / 차양: 블록 밖으로 드러난 모든 벽면에 붙인다 ---
  // ±z만 쓰면 정작 스윙으로 지나는 애비뉴(±x 면이 마주 본다)가 텅 빈 채로 남는다.
  const EDGE = 2.5;
  for (const b of buildings) {
    if (b.y0 !== 0 || b.h < 14) continue;
    const bl = blockBounds.get(blockIndex(b.x, b.z));
    if (!bl) continue;

    // 드러난 면: 축(x/z) · 바깥 방향 · 벽면 좌표 · 그 면의 가로 길이
    const faces = [];
    if (b.x - b.w / 2 <= bl.x0 + EDGE) faces.push({ ax: "x", sg: -1, len: b.d });
    if (b.x + b.w / 2 >= bl.x1 - EDGE) faces.push({ ax: "x", sg:  1, len: b.d });
    if (b.z - b.d / 2 <= bl.z0 + EDGE) faces.push({ ax: "z", sg: -1, len: b.w });
    if (b.z + b.d / 2 >= bl.z1 - EDGE) faces.push({ ax: "z", sg:  1, len: b.w });
    if (!faces.length) continue;

    // 면 위의 한 점을 구한다. u는 면을 따라가는 좌우 오프셋, out은 벽에서 튀어나온 거리.
    const at = (f, u, out) => f.ax === "x"
      ? { x: b.x + f.sg * (b.w / 2 + out), z: b.z + u, ry: f.sg * Math.PI / 2 }
      : { x: b.x + u, z: b.z + f.sg * (b.d / 2 + out), ry: 0 };

    for (const f of faces) {
      const uHalf = Math.max(1, Math.min(f.len, 26) / 2 - 2);

      // 비상계단: 벽돌·산업 건물의 전형. 층마다 발판 + 위아래를 잇는 세로 난간.
      if ((b.kind === KIND_BRICK || b.kind === KIND_IND) && b.h > 22 && Math.random() < 0.3) {
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

  inst(cyl, darkMetal, poles, p => { dummy.position.set(p.x, CURB_H, p.z); dummy.scale.set(0.14, p.h, 0.14); }, true);
  inst(boxGeo, darkMetal, bars, b => { dummy.position.set(b.x, b.y, b.z); dummy.scale.set(b.w, 0.16, 0.22); }, false);
  inst(boxGeo, signalMat, heads, h => { dummy.position.set(h.x, h.y, h.z); dummy.scale.set(0.5, 1.5, 0.42); }, false);
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
    if (m.userData.kind === KIND_GLASS) {
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
  camMsg = 1.6;
}

// ===================== 자동차 =====================
// 도로 격자를 따라 실제로 달린다. 뉴욕이라 노란 택시 비중을 높게 잡았다.
// 애비뉴는 실제처럼 일방통행(차선마다 방향이 정해짐), 스트리트는 양방향.
const cars = [];
const CAR_L = 4.6, CAR_W = 1.95, CAR_H = 1.35;
{
  // 차는 '개수'가 아니라 '간격'으로 깔아야 한다.
  // 차선당 몇 대씩 두면 월드가 2.5km라 360m에 한 대꼴이 돼서 텅 빈 도로가 된다.
  const LEN_Z = N_ST * ST_SPACING, LEN_X = N_AVE * AVE_SPACING;
  const laneOff = [-24, -12, 12, 24];        // 애비뉴 4차선 (넓어진 노폭에 맞춤)
  for (let ai = 0; ai < N_AVE - 1; ai++) {
    const cx = (ai - AVE_C) * AVE_SPACING + AVE_SPACING / 2;
    const oneWay = ai % 2 === 0 ? 1 : -1;    // 애비뉴별 일방통행
    for (const off of laneOff) {
      for (let z = -LEN_Z / 2; z < LEN_Z / 2; z += 80 + Math.random() * 110) {
        cars.push({ axis: 'z', x: cx + off, z, dir: oneWay, speed: 16 + Math.random() * 12 });
      }
    }
  }
  const stLane = [-9, 9];                    // 스트리트 2차선(양방향)
  for (let si = 0; si < N_ST - 1; si++) {
    if (Math.random() < 0.5) continue;
    const cz = (si - ST_C) * ST_SPACING + ST_SPACING / 2;
    for (const off of stLane) {
      for (let x = -LEN_X / 2; x < LEN_X / 2; x += 105 + Math.random() * 150) {
        cars.push({ axis: 'x', x, z: cz + off, dir: off < 0 ? 1 : -1, speed: 11 + Math.random() * 8 });
      }
    }
  }
}

const carBodyMesh = new THREE.InstancedMesh(
  boxGeo, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.35 }), cars.length);
const carTopMesh = new THREE.InstancedMesh(
  boxGeo, new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.15, metalness: 0.2 }), cars.length);
{
  const c = new THREE.Color();
  cars.forEach((car, i) => {
    const r = Math.random();
    if (r < 0.42) c.setHex(0xf2b70c);        // 노란 택시
    else if (r < 0.58) c.setHex(0xe8e8ea);
    else if (r < 0.72) c.setHex(0x23262b);
    else if (r < 0.84) c.setHex(0x6d7580);
    else if (r < 0.93) c.setHex(0x8d2626);
    else c.setHex(0x1f3d68);
    carBodyMesh.setColorAt(i, c);
  });
}
carBodyMesh.castShadow = true;
carTopMesh.castShadow = false;   // 차체 그림자에 어차피 묻힌다
carBodyMesh.frustumCulled = false;
carTopMesh.frustumCulled = false;
scene.add(carBodyMesh);
scene.add(carTopMesh);

const CAR_HALF_X = (N_AVE * AVE_SPACING) / 2, CAR_HALF_Z = (N_ST * ST_SPACING) / 2;
function updateCars(dt) {
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    if (car.axis === "z") {
      car.z += car.dir * car.speed * dt;
      // 끝에 닿으면 반대편에서 다시 들어온다
      if (car.z > CAR_HALF_Z) car.z = -CAR_HALF_Z;
      else if (car.z < -CAR_HALF_Z) car.z = CAR_HALF_Z;
      dummy.rotation.set(0, car.dir > 0 ? 0 : Math.PI, 0);
      dummy.scale.set(CAR_W, CAR_H, CAR_L);
    } else {
      car.x += car.dir * car.speed * dt;
      if (car.x > CAR_HALF_X) car.x = -CAR_HALF_X;
      else if (car.x < -CAR_HALF_X) car.x = CAR_HALF_X;
      dummy.rotation.set(0, car.dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      dummy.scale.set(CAR_W, CAR_H, CAR_L);
    }
    dummy.position.set(car.x, 0.05, car.z);
    dummy.updateMatrix();
    carBodyMesh.setMatrixAt(i, dummy.matrix);

    // 캐빈(지붕)은 차체보다 작고 살짝 뒤쪽에
    dummy.scale.set(CAR_W * 0.86, CAR_H * 0.62, CAR_L * 0.48);
    dummy.position.set(car.x, 0.05 + CAR_H, car.z);
    dummy.updateMatrix();
    carTopMesh.setMatrixAt(i, dummy.matrix);
  }
  carBodyMesh.instanceMatrix.needsUpdate = true;
  carTopMesh.instanceMatrix.needsUpdate = true;
}
updateCars(0);

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
const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55, 1.1, 6, 12), bodyMat);
body.position.y = 1.1;
spiderGroup.add(body);
const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10), headMat);
head.position.y = 2.15;
spiderGroup.add(head);
scene.add(spiderGroup);

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
};
// 한 번만 재생하고 마지막 포즈로 멈춰야 자연스러운 클립들.
// (스윙은 "한 번 크게 휘두르는" 동작이라 루프시키면 계속 되감기는 것처럼 보인다)
const CLIP_ONCE = new Set(["Swing", "Land"]);

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

const enemies = [];
const projectiles = [];
const particles = [];

let attackMode = false;
let attackCd = 0;
// 탄창: 공격 모드에서만 소모. 비면 자동 재장전
// (지금은 손이 화면 밖으로 내려갔다 올라오는 정도. 나중에 카트리지 교체 모션으로 구체화)
const MAG_SIZE = 80;
const RELOAD_TIME = 1.6;
let ammo = MAG_SIZE;
let reloadT = 0;          // 남은 재장전 시간, 0이면 장전 완료
let hitStop = 0;        // 명중 순간 화면을 잠깐 멈춰 타격감을 만든다
let shake = 0;
let hitMark = 0;        // 조준점 히트마커
let hitKill = false;    // 이번 히트마커가 처치인지 (빨간 X)
let lockSettle = false; // 포인터 락 직후 첫 mousemove를 버리기 위한 플래그
let combo = 0, comboT = 0;

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

function makeEnemy(x, y, z, type) {
  const g = new THREE.Group();
  const ty = E_TYPES[type === undefined ? rollEnemyType() : type];
  // 적마다 재질을 따로 만든다 — 피격 플래시를 개별로 줘야 하므로 공유하면 안 된다
  const mat = new THREE.MeshStandardMaterial({ color: ty.color, emissive: 0x000000, roughness: 0.5 });
  g.add(new THREE.Mesh(enemyGeo, mat));
  // 실루엣으로도 구분되게 크기를 달리한다 (색만으로는 원거리에서 안 읽힌다)
  g.scale.setScalar(ty.melee ? 1.15 : ty === E_TYPES[2] ? 0.88 : 1);
  g.position.set(x, y, z);
  scene.add(g);
  // 구역은 위치로 정해진다. zones가 아직 없으면(초기 로드 순서) 나중에 채운다.
  enemies.push({
    g, mat, type: E_TYPES.indexOf(ty), ty, hp: ty.hp, flash: 0, dead: false, deadT: 0,
    bound: 0, cocoon: null,
    knock: new THREE.Vector3(),
    yaw: Math.random() * 6.283, wob: Math.random() * 6.283,
    zone: null,
    // --- AI ---
    // aimT > 0 이면 조준 중(예고 구간). 이 구간이 없으면 맞고 나서야 공격을 안다.
    state: "patrol", aimT: 0, fireCd: 1 + Math.random() * 3,
    // grip 0=자유 / 1=제자리 고정(돌진 대상) / 2=공중으로 끌려오는 중
    grip: 0,
    hx: x, hz: z,                       // 초기 자리 — 순찰은 이 주변을 돈다
    px: x, pz: z,                       // 현재 순찰 목표
    beam: null,
  });
}

// ================== 적 AI · 적의 공격 · 플레이어 피격 ==================
// 종류별 성격표. 여기 숫자만 만지면 적 성향이 바뀐다.
const E_TYPES = [
  { name: '사수',   color: 0xd41f2b, hp: 3, sight: 150, range: 130, aim: 0.95, cd: 2.2,
    dmg: 1, spd: 5.5, chase: 1.5, strafe: 7,  proj: 117, melee: false },
  { name: '돌격병', color: 0xff7a18, hp: 2, sight: 200, range: 7,   aim: 0.45, cd: 1.2,
    dmg: 1, spd: 8,   chase: 2.6, strafe: 0,  proj: 0,   melee: true  },
  { name: '저격수', color: 0x9b4dff, hp: 2, sight: 300, range: 280, aim: 1.9,  cd: 3.4,
    dmg: 2, spd: 3,   chase: 0.7, strafe: 3,  proj: 190, melee: false },
];
// 사수를 기본으로 두고 돌격병·저격수를 섞는다
function rollEnemyType() {
  const r = Math.random();
  return r < 0.55 ? 0 : r < 0.82 ? 1 : 2;
}

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
const eProjectiles = [];

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
function takeBeam() { for (const b of beamPool) if (!b.visible) { b.visible = true; return b; } return null; }
function freeBeam(e) { if (e.beam) { e.beam.visible = false; e.beam = null; } }

// --- 플레이어 체력 ---
const MAX_HP = 8;
let hp = MAX_HP;
let hurtFx = 0;      // 화면 붉은 플래시 잔량
let invuln = 0;      // 연타로 순삭당하지 않게 하는 무적 시간
let deadT = 0;       // 사망 후 리스폰까지
// --- 스태미나 ---
const MAX_STAM   = 100;
const STAM_SWING = 9;    // 스윙 중 초당 소모
const STAM_GND   = 55;   // 발을 붙이고 있을 때 초당 회복 (빠르게)
const STAM_AIR   = 11;   // 공중에서 줄을 놓고 있을 때 (느리게)
const STAM_MIN   = 15;   // 바닥나면 이만큼 찰 때까지 다시 못 건다
let stam = MAX_STAM;
let stamEmpty = false;   // 바닥난 상태 (STAM_MIN 넘을 때까지 유지)
let stamFx = 0;          // 바닥났을 때 UI를 붉게 번쩍이는 잔량

const REGEN_DELAY = 5.5;   // 마지막 피격 후 이만큼 안 맞아야 회복 시작
const REGEN_TIME  = 1.4;   // 한 칸 차오르는 데 걸리는 시간
let regenWait = 0;         // 회복 시작까지 남은 시간
let regenT = 0;            // 현재 칸의 진행도 (0..REGEN_TIME)

function damagePlayer(amount) {
  if (invuln > 0 || deadT > 0) return;
  hp -= amount;
  regenWait = REGEN_DELAY;   // 맞을 때마다 회복 대기가 처음부터 다시
  regenT = 0;
  invuln = 0.55;
  hurtFx = 1;
  shake = Math.max(shake, 0.35);
  sfxHurt();
  if (hp <= 0) { hp = 0; deadT = 1.8; releaseWeb(); zip = null; clinging = null; clearGrip(); }
}

function respawn() {
  hp = MAX_HP;
  stam = MAX_STAM; stamEmpty = false;
  regenWait = 0; regenT = 0;
  const y = groundHeightAt(0, 0) + 2;
  player.pos.set(0, y + 60, 0);
  player.vel.set(0, 0, 0);
  // 카메라는 보간 위치를 따르므로 순간이동 때 같이 맞춰야 한 프레임 튀지 않는다
  player.prevPos.copy(player.pos);
  player.renderPos.copy(player.pos);
  invuln = 2;
  hurtFx = 0;
}

const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();

function enemyFire(e) {
  const ty = e.ty;
  const from = _e1.set(e.g.position.x, e.g.position.y + 4.0, e.g.position.z);
  // 리드 사격: 완전히 리드하면 절대 못 피하고, 안 하면 스윙 중엔 절대 안 맞는다.
  const t = from.distanceTo(player.pos) / ty.proj;
  const to = _e2.copy(player.vel).multiplyScalar(t * E_LEAD).add(player.pos);
  to.y += 1.0;
  const dir = to.sub(from).normalize();
  const m = new THREE.Mesh(eProjGeo, eProjMat);
  m.position.copy(from);
  m.frustumCulled = false;
  scene.add(m);
  eProjectiles.push({ m, pos: from.clone(), vel: dir.clone().multiplyScalar(ty.proj), life: E_LIFE, dmg: ty.dmg });
  sfxEnemyShot();
}

// 적 눈높이에서 플레이어까지 막힌 게 없는가.
// 탄 충돌과 같은 공간 해시라 싸다. 조준 시작·발사 순간에만 부르면 부담이 없다.
const _losA = new THREE.Vector3(), _losB = new THREE.Vector3(), _losH = new THREE.Vector3();
function canSeePlayer(e) {
  _losA.set(e.g.position.x, e.g.position.y + 4.0, e.g.position.z);
  _losB.set(player.pos.x - _losA.x, player.pos.y + 1.0 - _losA.y, player.pos.z - _losA.z);
  return !segHitWorld(_losA, _losB, _losH);
}

// 적 한 명의 사고. dist는 플레이어까지 거리(제곱근 이미 계산됨).
const _eBoxes = [];
// 그 지점이 건물 안인가. 발밑에서 어깨높이 사이를 막는 박스가 있으면 못 간다.
function blockedAt(x, z, y) {
  nearbyBuildings(x, z, 2, _eBoxes);
  for (let i = 0; i < _eBoxes.length; i++) {
    const b = _eBoxes[i];
    if (y + 3.5 < b.y0 || y + 0.5 > b.y0 + b.h) continue;
    if (Math.abs(x - b.x) < b.w / 2 + 0.8 && Math.abs(z - b.z) < b.d / 2 + 0.8) return true;
  }
  return false;
}
// 목표 쪽으로 한 걸음. 막히면 그 자리에 서고 순찰 목표는 새로 잡는다.
function stepEnemy(e, dx, dz, spd, dt) {
  const l = Math.hypot(dx, dz) || 1;
  const nx = e.g.position.x + (dx / l) * spd * dt;
  const nz = e.g.position.z + (dz / l) * spd * dt;
  if (blockedAt(nx, nz, e.g.position.y)) return false;
  e.g.position.x = nx;
  e.g.position.z = nz;
  return true;
}

function updateEnemyAI(e, dt, dist) {
  if (e.dead || e.bound > 0 || e.grip) { freeBeam(e); e.aimT = 0; return; }
  if (e.fireCd > 0) e.fireCd -= dt;

  const ty = e.ty;
  const seen = dist < ty.sight && deadT <= 0;
  if (!seen) {
    // --- 순찰: 자기 자리 주변을 어슬렁거린다 ---
    freeBeam(e);
    e.aimT = 0;
    e.state = "patrol";
    const dx = e.px - e.g.position.x, dz = e.pz - e.g.position.z;
    const d2 = Math.hypot(dx, dz);
    if (d2 < 2) {
      const a = Math.random() * Math.PI * 2, r = 6 + Math.random() * 26;
      e.px = e.hx + Math.cos(a) * r;
      e.pz = e.hz + Math.sin(a) * r;
    } else {
      if (!stepEnemy(e, dx, dz, ty.spd, dt)) e.px = e.hx, e.pz = e.hz;   // 막히면 제자리로
      e.yaw = Math.atan2(dx, dz);
    }
    return;
  }

  // --- 교전: 플레이어를 향해 돌아서고, 사거리 밖이면 좁힌다 ---
  const tx = player.pos.x - e.g.position.x, tz = player.pos.z - e.g.position.z;
  e.yaw = lerpAngle(e.yaw, Math.atan2(tx, tz), Math.min(1, 6 * dt));

  if (dist > ty.range) {
    e.state = "chase";
    freeBeam(e);
    e.aimT = 0;
    stepEnemy(e, tx, tz, ty.spd * ty.chase, dt);
    return;
  }

  // 사거리 안에서는 서 있지 않는다. 플레이어를 중심으로 옆으로 돌면서 쏜다.
  // 가만히 선 과녁은 위협이 안 되고, 조준 예고선도 의미가 없어진다.
  if (ty.strafe > 0) {
    e.wob += dt * 0.9;
    const side = Math.sin(e.wob * 0.7);
    stepEnemy(e, -tz * side, tx * side, ty.strafe, dt);   // 진행 방향에 수직
  }

  if (e.aimT > 0) {
    // --- 조준: 붉게 달아오르고 예고선이 진해진다. 이 구간이 회피 기회다. ---
    e.aimT -= dt;
    e.state = "aim";
    if (!e.beam) e.beam = takeBeam();
    if (e.beam) {
      const from = _e1.set(e.g.position.x, e.g.position.y + 4.0, e.g.position.z);
      const to = _e2.copy(player.pos).setY(player.pos.y + 1.0);
      const len = from.distanceTo(to);
      e.beam.position.copy(from);
      e.beam.scale.set(1, len, 1);
      e.beam.lookAt(to);
      e.beam.rotateX(Math.PI / 2);          // 실린더는 +Y가 길이축이라 한 번 눕힌다
      e.beam.material.opacity = 0.16 + (1 - e.aimT / ty.aim) * 0.5;
    }
    e.mat.emissive.setRGB(0.9 * (1 - e.aimT / ty.aim), 0.1, 0.05);
    if (e.aimT <= 0) {
      freeBeam(e);
      // 예고 도중에 엄폐물 뒤로 숨었으면 쏘지 않는다. 피한 보람이 있어야 한다.
      if (!canSeePlayer(e)) {
        e.fireCd = ty.cd * 0.4;              // 곧 다시 노린다
      } else if (ty.melee) {
        // 돌격병은 탄이 없다. 붙어 있으면 그 자리에서 후려친다.
        if (dist < ty.range + 3) { damagePlayer(ty.dmg); sfxEnemyShot(); }
      } else enemyFire(e);
      if (e.fireCd <= 0) e.fireCd = ty.cd * (0.7 + Math.random() * 0.6);
    }
    return;
  }

  e.state = "engage";
  // 안 보이면 조준을 시작하지 않는다. 엄폐가 실제로 통해야 한다.
  if (e.fireCd <= 0 && canSeePlayer(e)) e.aimT = ty.aim;
}

// 전부 길바닥에 세워두면 스윙 중에는 아무 일도 안 일어난다.
// 절반 이상을 옥상·스카이브리지 위에 올려 고도차 있는 교전을 만든다.
// --- 구역 ---
const ZONE_N = 3;                                   // 3x3 = 9구역
const ZONE_W = (N_AVE * AVE_SPACING) / ZONE_N;
const ZONE_D = (N_ST * ST_SPACING) / ZONE_N;
const zones = [];
for (let zx = 0; zx < ZONE_N; zx++) {
  for (let zz = 0; zz < ZONE_N; zz++) {
    zones.push({
      id: zones.length,
      name: `${"북중남"[zz]}${"서중동"[zx]} 구역`,
      cx: (zx - (ZONE_N - 1) / 2) * ZONE_W,
      cz: (zz - (ZONE_N - 1) / 2) * ZONE_D,
      total: 0, cleared: false,
    });
  }
}
function zoneOf(x, z) {
  const zx = Math.min(ZONE_N - 1, Math.max(0, Math.floor(x / ZONE_W + ZONE_N / 2)));
  const zz = Math.min(ZONE_N - 1, Math.max(0, Math.floor(z / ZONE_D + ZONE_N / 2)));
  return zones[zx * ZONE_N + zz];
}
let activeZone = null;
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

function zoneRemaining(z) {
  let c = 0;
  for (const e of enemies) if (!e.dead && e.zone === z) c++;
  return c;
}

// 가장 가까운, 아직 적이 남은 구역을 목표로 잡는다
function pickZone() {
  // 지금 서 있는 구역에 적이 남아 있으면 그곳부터. 시작하자마자 도시 반대편으로
  // 보내면 목표가 심부름처럼 느껴진다.
  const here = zoneOf(player.pos.x, player.pos.z);
  if (here && !here.cleared && zoneRemaining(here) > 0) {
    activeZone = here;
    beacon.visible = true;
    beacon.position.set(here.cx, 380, here.cz);
    say(`목표: ${here.name} — 적 ${zoneRemaining(here)}명`, 3);
    return;
  }
  let best = null, bestD = Infinity;
  for (const z of zones) {
    if (z.cleared) continue;
    if (zoneRemaining(z) === 0) { z.cleared = true; continue; }
    const d = Math.hypot(z.cx - player.pos.x, z.cz - player.pos.z);
    if (d < bestD) { bestD = d; best = z; }
  }
  activeZone = best;
  if (best) {
    beacon.visible = true;
    beacon.position.set(best.cx, 380, best.cz);
    say(`목표: ${best.name} — 적 ${zoneRemaining(best)}명`, 3);
  } else {
    beacon.visible = false;
    say("모든 구역 정화 완료", 5);
  }
}

function updateZones(dt) {
  if (zoneFlash > 0) zoneFlash -= dt;
  if (!activeZone) return;
  if (zoneRemaining(activeZone) === 0) {
    activeZone.cleared = true;
    zonesCleared++;
    zoneFlash = 2;
    // 보상: 체력 2칸 + 궁 게이지. 구역을 밀 이유가 생긴다.
    hp = Math.min(MAX_HP, hp + 2);
    ultFake = Math.min(1, ultFake + 0.25);
    stam = MAX_STAM;
    sfxZoneClear();
    say(`${activeZone.name} 정화 완료  (+체력 +궁게이지)`, 3.5);
    pickZone();
  }
}

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

// 원점 주변에 반경으로 뿌리면 구역 절반이 텅 빈다. 구역마다 같은 수를 심어야
// "다음 구역으로 이동한다"는 목표가 실제로 도시를 가로지르는 이동이 된다.
const _spawnB = [];
function spawnEnemies(n) {
  const per = Math.max(1, Math.round(n / zones.length));
  for (const z of zones) {
    for (let i = 0; i < per; i++) {
      const x = z.cx + (Math.random() - 0.5) * ZONE_W * 0.86;
      const zz = z.cz + (Math.random() - 0.5) * ZONE_D * 0.86;
      let placed = false;
      if (Math.random() < 0.6) {
        // 옥상: 그 지점 근처에서 설 만한 넓이가 되는 구조물을 고른다
        nearbyBuildings(x, zz, 140, _spawnB);
        let b = null;
        for (let k = 0; k < _spawnB.length; k++) {
          const c = _spawnB[(Math.random() * _spawnB.length) | 0];
          if (!c || c.w < 8 || c.d < 8 || c.h < 6) continue;
          const top = c.y0 + c.h;
          if (top < 10 || top > 220) continue;
          b = c; break;
        }
        if (b) {
          makeEnemy(b.x + (Math.random() - 0.5) * (b.w - 5), b.y0 + b.h,
                    b.z + (Math.random() - 0.5) * (b.d - 5));
          placed = true;
        }
      }
      if (!placed) makeEnemy(x, groundHeightAt(x, zz), zz);
    }
  }
}

// 주의: 아래 임시 벡터들은 segHitsSphere 전용이다.
// 호출자의 step 벡터와 같은 객체를 쓰면 내부에서 정규화하는 순간 step이 덮어써져
// 탄이 프레임당 1m만 전진하는 버그가 생긴다.
const _s0 = new THREE.Vector3(), _s1 = new THREE.Vector3(), _s2 = new THREE.Vector3();
// 이동 선분 vs 구. 빠른 투사체가 프레임 사이에 적을 통과해버리는 걸 막는다.
function segHitsSphere(p0, step, c, r) {
  const len = step.length();
  if (len < 1e-6) return p0.distanceTo(c) <= r;
  const d = _s0.copy(step).divideScalar(len);
  const t = Math.max(0, Math.min(len, _s1.copy(c).sub(p0).dot(d)));
  return _s2.copy(p0).addScaledVector(d, t).distanceTo(c) <= r;
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

function spawnImpact(p, n) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, partMat);
    m.position.copy(p);
    scene.add(m);
    particles.push({
      m, life: 0.3 + Math.random() * 0.15,
      v: new THREE.Vector3((Math.random() - 0.5) * 24, (Math.random() - 0.15) * 20, (Math.random() - 0.5) * 24)
    });
  }
}

const _up = new THREE.Vector3(0, 1, 0);
function startReload() {
  if (reloadT > 0 || ammo === MAG_SIZE) return;
  reloadT = RELOAD_TIME;
  sfxReload();
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

function fireWeb() {
  if (!canAct()) return;
  if (attackCd > 0 || reloadT > 0) return;
  if (ammo <= 0) { startReload(); return; }
  ammo--;
  if (ammo === 0) startReload();
  attackCd = ATTACK_CD;

  // 조준점(=커서)이 실제로 가리키는 지점을 먼저 구한다.
  // 3인칭 조준점은 커서를 따라가므로 카메라 정면으로 쏘면 조준과 탄도가 어긋난다.
  raycaster.setFromCamera(cursorNdc(), camera);
  raycaster.far = Infinity;
  const hits = raycaster.intersectObjects(aimTargets, false);
  const target = hits.length
    ? hits[0].point.clone()
    : raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, PROJ_RANGE);

  // 총구는 눈/가슴 높이에서. 방향은 총구 -> 조준지점.
  const muzzle = firstPerson
    ? camera.position.clone().addScaledVector(raycaster.ray.direction, 0.6)
    : new THREE.Vector3(player.pos.x, player.pos.y + 1.7, player.pos.z);
  const dir = target.sub(muzzle);
  if (dir.lengthSq() < 1e-6) return;
  dir.normalize();

  const m = new THREE.Mesh(projGeo, projMat);
  m.position.copy(muzzle);
  m.quaternion.setFromUnitVectors(_up, dir);   // 예광탄을 진행 방향으로 눕힌다
  scene.add(m);
  projectiles.push({ m, pos: muzzle.clone(), vel: dir.clone().multiplyScalar(PROJ_SPEED), life: PROJ_LIFE });
  armPulse = 0.35;
  sfxShot();
}

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

function buildCocoon() {
  const grp = new THREE.Group();
  // 반투명 고치 — 안의 붉은 적이 비쳐 보여서 "묶인 적"임이 읽힌다
  const shell = new THREE.Mesh(cocoonGeo, new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.85, transparent: true, opacity: 0.8
  }));
  shell.position.y = 2.4;
  grp.add(shell);
  // 몸을 가로로 감은 거미줄 밴드
  for (let i = 0; i < 5; i++) {
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(1.56 - Math.abs(i - 2) * 0.13, 0.1, 5, 14),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    band.position.y = 1.15 + i * 0.72;
    band.rotation.x = Math.PI / 2;
    band.rotation.z = (Math.random() - 0.5) * 0.5;
    grp.add(band);
  }
  // 바닥으로 뻗은 고정줄
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const strand = new THREE.Mesh(strandGeo, new THREE.MeshBasicMaterial({ color: 0xf4f8ff }));
    strand.position.set(Math.cos(a) * 1.25, 1.2, Math.sin(a) * 1.25);
    strand.scale.y = 2.4;
    strand.rotation.z = Math.cos(a) * 0.5;
    strand.rotation.x = -Math.sin(a) * 0.5;
    grp.add(strand);
  }
  return grp;
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

function bindEnemy(e) {
  if (e.dead || e.bound > 0) return;
  e.bound = BIND_TIME;
  e.knock.set(0, 0, 0);            // 묶였으니 더는 밀려나지 않는다
  e.cocoon = buildCocoon();
  e.g.add(e.cocoon);
  spawnImpact(_impV.set(e.g.position.x, e.g.position.y + 2.8, e.g.position.z), 10);
  hitMark = 0.17; hitKill = false;
  shake = Math.max(shake, 0.35);
  sfxBind();
}

// --- 궁극기 ---
const ULT_R = 75;        // 광역 속박 반경
const ULT_DMG = 1;
let ultRing = 0;         // 확장 링 연출 잔량 (1 -> 0)

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

function fireUlt() {
  if (!canAct()) return;
  if (ultFake < 1) {
    say("궁극기 " + Math.round(ultFake * 100) + "%");
    sfxMiss();
    return;
  }
  ultFake = 0;
  let hit = 0;
  for (const e of enemies) {
    if (e.dead) continue;
    if (e.g.position.distanceTo(player.pos) > ULT_R) continue;
    bindEnemy(e);
    e.hp -= ULT_DMG;
    e.flash = 0.35;
    if (e.hp <= 0 && !e.dead) { e.dead = true; e.deadT = 0.5; }
    hit++;
  }
  ultRing = 1;
  ultRingMesh.visible = true;
  ultRingMesh.position.set(player.pos.x, player.pos.y + 1, player.pos.z);
  hitStop = 0.34;
  shake = Math.max(shake, 1.8);
  hitMark = 0.25; hitKill = hit > 0;
  say(hit ? "광역 속박 — " + hit + "명" : "사거리 안에 적이 없다", 2.5);
  sfxUlt();
}

// 링을 키우고 지운다
function updateUlt(dt) {
  if (ultRing <= 0) return;
  ultRing -= dt * 1.4;
  if (ultRing <= 0) { ultRingMesh.visible = false; return; }
  const k = 1 - ultRing;                 // 0 -> 1
  ultRingMesh.scale.setScalar(4 + k * ULT_R);
  ultRingMesh.material.opacity = ultRing * 0.7;
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

function fireBind() {
  if (!canAct()) return;
  if (bindCd > 0) { say(`속박 쿨타임 ${bindCd.toFixed(1)}s`); sfxMiss(); return; }
  bindCd = BIND_CD;
  airHover(0.35);
  raycaster.setFromCamera(cursorNdc(), camera);
  raycaster.far = Infinity;
  const hits = raycaster.intersectObjects(aimTargets, false);
  const target = hits.length
    ? hits[0].point.clone()
    : raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, PROJ_RANGE);
  const muzzle = firstPerson
    ? camera.position.clone().addScaledVector(raycaster.ray.direction, 0.6)
    : new THREE.Vector3(player.pos.x, player.pos.y + 1.7, player.pos.z);
  const dir = target.sub(muzzle);
  if (dir.lengthSq() < 1e-6) return;
  dir.normalize();
  const m = new THREE.Mesh(bindProjGeo, bindProjMat);
  m.position.copy(muzzle);
  m.quaternion.setFromUnitVectors(_up, dir);
  scene.add(m);
  projectiles.push({
    m, pos: muzzle.clone(), vel: dir.clone().multiplyScalar(PROJ_SPEED * 0.72),
    life: PROJ_LIFE, bind: true
  });
  armPulse = 0.35;
  sfxShot();
}

// ============ 근접 주먹 ============
// 쿨타임을 따로 두지 않는다. 뻗었다 돌아오는 동안 다시 못 뻗는 것 자체가 쿨타임이다.
const PUNCH_TIME = 0.32;   // 한 사이클(뻗기 + 복귀)
const PUNCH_HIT  = 0.5;    // 사이클의 이 지점(=완전히 뻗은 순간)에 판정
const PUNCH_R    = 5.5;    // 주먹이 닿는 거리
const PUNCH_CONE = 0.55;   // 정면 원뿔 (dot 기준)
const PUNCH_DMG  = 1;
const PUNCH_KB   = 40;
let punchT = 0;            // 남은 사이클 시간
let punchHit = false;      // 이번 사이클에서 이미 판정했는지
const _pv = new THREE.Vector3(), _pv2 = new THREE.Vector3();

function punch() {
  if (!canAct()) return;
  if (punchT > 0) return;          // 아직 팔이 돌아오는 중
  punchT = PUNCH_TIME;
  punchHit = false;
  armPulse = 0.25;
  airHover(0.18);                  // 공중에서 쳐도 잠깐 버틴다
  sfxWhoosh();
}

function updatePunch(dt) {
  if (punchT <= 0) return;
  const prev = punchT;
  punchT -= dt;
  // 완전히 뻗은 순간을 지나갈 때 한 번만 판정한다
  const hitAt = PUNCH_TIME * (1 - PUNCH_HIT);
  if (!punchHit && prev > hitAt && punchT <= hitAt) {
    punchHit = true;
    camera.getWorldDirection(_pv);
    let best = null, bestD = PUNCH_R;
    for (const e of enemies) {
      if (e.dead) continue;
      _pv2.set(e.g.position.x, e.g.position.y + 2.8, e.g.position.z).sub(camera.position);
      const d = _pv2.length();
      if (d > PUNCH_R) continue;
      if (_pv2.divideScalar(d).dot(_pv) < PUNCH_CONE) continue;
      if (d < bestD) { bestD = d; best = e; }
    }
    if (best) {
      const killed = best.hp - PUNCH_DMG <= 0;
      best.hp -= PUNCH_DMG;
      best.flash = 0.2;
      best.knock.add(_pv2.copy(_pv).multiplyScalar(PUNCH_KB).setY(PUNCH_KB * 0.3));
      spawnImpact(gripPoint(best, _impV), killed ? 20 : 12);
      hitStop = killed ? 0.14 : 0.08;
      shake = Math.max(shake, killed ? 1.1 : 0.6);
      hitMark = 0.18;
      hitKill = killed;
      combo++; comboT = 1.8;
      sfxHit(killed);
      if (killed && !best.dead) { best.dead = true; best.deadT = 0.5; ultFake = Math.min(1, ultFake + 0.04); }
      // 친 반동으로 살짝 밀린다
      player.vel.addScaledVector(_pv, -5);
    }
  }
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

let lunge = null;          // { e, phase: "hold"|"dash", t }
let pull  = null;          // { e, t }
let lungeCd = 0, pullCd = 0;
// 공중에서 스킬을 쓰면 그동안 중력을 끊어 잠깐 떠 있게 한다.
// 시전 중에 뚝 떨어지면 조준한 게 무의미해지고 연출도 죽는다.
let hoverT = 0;
function airHover(t) { if (!player.grounded) hoverT = Math.max(hoverT, t); }
let kickOpen = false;      // 발차기 입력 창이 열려 있는지
let kickBuf = 0;           // 선입력 남은 시간
let kickFx = 0;            // 발차기 연출(손 포즈/FOV)
const _lv = new THREE.Vector3(), _lv2 = new THREE.Vector3();

// 대상의 가슴 높이. 발 밑이 아니라 여기로 줄이 가야 잡은 것처럼 보인다.
function gripPoint(e, out) { return out.set(e.g.position.x, e.g.position.y + 2.8, e.g.position.z); }

// 리스폰 대기 중에는 입력이 전부 무시돼야 한다. 스킬마다 따로 검사하면 반드시 하나를 빠뜨린다.
function canAct() { return deadT <= 0; }

function clearGrip() {
  if (lunge && lunge.e) lunge.e.grip = 0;
  if (pull && pull.e) pull.e.grip = 0;
  lunge = null; pull = null; kickOpen = false;
}

function startLunge(e) {
  if (e.dead) return;
  clearGrip();
  releaseWeb(); zip = null; clinging = null;
  lunge = { e, phase: "hold", t: LUNGE_HOLD };
  e.grip = 1;
  player.vel.set(0, 0, 0);
  hoverT = Math.max(hoverT, LUNGE_HOLD + 0.1);
  hitStop = 0.3;                      // 잡는 순간 화면을 확실히 세운다
  shake = Math.max(shake, 0.9);
  dashKick = 0.45;
  hitMark = 0.2;
  hitKill = false;
  e.flash = 0.3;                      // 잡힌 적이 번쩍인다
  spawnImpact(gripPoint(e, _impV), 14);
  sfxThwip();
  sfxHit(false);
}

function startPull(e) {
  if (e.dead) return;
  clearGrip();
  pull = { e, t: 0 };
  e.grip = 2;
  e.knock.set(0, 0, 0);
  hoverT = Math.max(hoverT, 0.5);
  hitStop = 0.26;                     // 걸린 순간의 퍼즈
  shake = Math.max(shake, 0.8);
  hitMark = 0.2;
  hitKill = false;
  e.flash = 0.3;
  spawnImpact(gripPoint(e, _impV), 14);
  sfxThwip();
  sfxHit(false);
}

function doKick(e) {
  // 카메라 정면으로 찬다. 조준한 방향으로 날아가야 통제감이 있다.
  camera.getWorldDirection(_lv);
  const killed = e.hp - KICK_DMG <= 0;
  e.hp -= KICK_DMG;
  e.flash = 0.2;
  e.knock.add(_lv2.copy(_lv).multiplyScalar(KICK_KB).setY(KICK_KB * 0.42));
  spawnImpact(gripPoint(e, _impV), 26);
  hitStop = 0.2;
  shake = Math.max(shake, 1.6);
  hitMark = 0.2;
  hitKill = killed;
  combo++; comboT = 1.8;
  kickFx = 0.32;
  sfxHit(killed);
  if (killed && !e.dead) { e.dead = true; e.deadT = 0.5; ultFake = Math.min(1, ultFake + 0.08); }
  // 찬 반동으로 살짝 튕겨 나온다 (적 안으로 파고드는 걸 막는 역할도 한다)
  player.vel.addScaledVector(_lv, -16);
  player.vel.y += 8;
  e.grip = 0;
  lunge = null; pull = null; kickOpen = false;
}

// 타이밍을 놓쳤을 때. 그냥 지나치면 위험이 없어 스킬이 공짜가 된다.
function kickWhiff(e) {
  gripPoint(e, _lv2);
  _lv.copy(_lv2).sub(player.pos);
  if (_lv.lengthSq() < 1e-6) _lv.set(0, 0, 1);
  _lv.normalize();
  // 서로 부딪혀 양쪽 다 튕긴다
  player.vel.copy(_lv).multiplyScalar(-WHIFF_KB);
  player.vel.y = WHIFF_KB * 0.4;
  e.knock.add(_lv2.copy(_lv).multiplyScalar(WHIFF_KB * 0.8).setY(WHIFF_KB * 0.3));
  const killed = e.hp - WHIFF_DMG <= 0;
  e.hp -= WHIFF_DMG;
  e.flash = 0.16;
  if (killed && !e.dead) { e.dead = true; e.deadT = 0.5; }
  spawnImpact(_lv2.copy(gripPoint(e, _impV)), 10);
  damagePlayer(WHIFF_DMG);
  e.grip = 0;
  lunge = null; pull = null; kickOpen = false;
}

// 좌클릭이 발차기로 소비됐으면 true
function tryKick() {
  const e = (lunge && lunge.e) || (pull && pull.e);
  if (!e) return false;
  if (kickOpen) { doKick(e); return true; }
  kickBuf = KICK_BUF;    // 아직 창이 안 열렸으면 선입력으로 저장
  return true;
}

// 조준점에 가장 가까운 적을 고른다. 반경 3.1m 표적을 200m 밖에서 정확히 맞추라는 건
// 콤보의 시작 기술로는 너무 가혹하다 — 원뿔 안에 들어오면 그 적을 노린다.
const _pk = new THREE.Vector3(), _pk2 = new THREE.Vector3();
function pickEnemy(cosCone, maxDist) {
  camera.getWorldDirection(_pk);
  let best = null, bestDot = cosCone;
  for (const e of enemies) {
    if (e.dead || e.grip || e.bound > 0) continue;
    gripPoint(e, _pk2).sub(camera.position);
    const d = _pk2.length();
    if (d > maxDist || d < 1) continue;
    const dot = _pk2.divideScalar(d).dot(_pk);
    if (dot > bestDot) { bestDot = dot; best = e; }
  }
  return best;
}

// 투사체 하나를 쏜다. 적을 지정하면 그 적의 가슴을 정확히 겨눈다.
function shootAt(target, mat, speed, flag) {
  const muzzle = firstPerson
    ? camera.position.clone().addScaledVector(_pk.set(0,0,0) || _pk, 0)
    : new THREE.Vector3(player.pos.x, player.pos.y + 1.7, player.pos.z);
  if (firstPerson) {
    camera.getWorldDirection(_pk);
    muzzle.copy(camera.position).addScaledVector(_pk, 0.6);
  }
  const dir = target.clone().sub(muzzle);
  if (dir.lengthSq() < 1e-6) return false;
  dir.normalize();
  const m = new THREE.Mesh(bindProjGeo, mat);
  m.position.copy(muzzle);
  m.quaternion.setFromUnitVectors(_up, dir);
  scene.add(m);
  const p = { m, pos: muzzle.clone(), vel: dir.multiplyScalar(speed), life: PROJ_LIFE };
  p[flag] = true;
  projectiles.push(p);
  armPulse = 0.35;
  sfxThwip();
  return true;
}

// 조준점이 가리키는 지점 (적이 없을 때의 대체 목표)
function aimFallback() {
  raycaster.setFromCamera(cursorNdc(), camera);
  raycaster.far = Infinity;
  const hits = raycaster.intersectObjects(aimTargets, false);
  return hits.length
    ? hits[0].point.clone()
    : raycaster.ray.origin.clone().addScaledVector(raycaster.ray.direction, PROJ_RANGE);
}

// 잡기 투사체 (C 준비 후 좌클릭)
function fireGrab() {
  if (!canAct()) return;
  if (lungeCd > 0) { say(`돌진 쿨타임 ${lungeCd.toFixed(1)}s`); sfxMiss(); return; }
  const e = pickEnemy(0.93, 260);           // 약 21도 원뿔 (13도는 조준이 너무 빡빡했다)
  if (!e) { say("조준선에 적이 없다"); sfxMiss(); return; }
  lungeCd = LUNGE_CD;
  airHover(0.45);                           // 줄이 날아가는 동안 공중에 뜬다
  shootAt(gripPoint(e, _lv), grabProjMat, GRAB_SPEED, "grab");
}

// 끌어오기 투사체 (X)
function firePull() {
  if (!canAct()) return;
  if (pullCd > 0) { say(`끌어오기 쿨타임 ${pullCd.toFixed(1)}s`); sfxMiss(); return; }
  const e = pickEnemy(0.93, 190);           // 약 21도 원뿔
  if (!e) { say("조준선에 적이 없다"); sfxMiss(); return; }
  pullCd = PULL_CD;
  airHover(0.45);
  shootAt(gripPoint(e, _lv), pullProjMat, GRAB_SPEED * 0.85, "pull");
}

function updateLungePull(dt) {
  if (lungeCd > 0) lungeCd -= dt;
  if (pullCd > 0) pullCd -= dt;
  if (kickBuf > 0) kickBuf -= dt;
  if (hoverT > 0) hoverT -= dt;
  updatePunch(dt);
  updateZones(dt);
  updateUlt(dt);
  if (pull) airHover(0.2);          // 끌어오는 내내 떠 있는다
  if (kickFx > 0) kickFx -= dt;

  if (lunge) {
    const e = lunge.e;
    if (e.dead) { e.grip = 0; lunge = null; kickOpen = false; return; }
    gripPoint(e, _lv2);
    const d = player.pos.distanceTo(_lv2);

    if (lunge.phase === "hold") {
      // 잡은 채로 정지. 이 멈칫 없이 바로 튀어나가면 그냥 순간이동처럼 보인다.
      lunge.t -= dt;
      player.vel.set(0, 0, 0);
      player.grounded = false;
      if (lunge.t <= 0) {
        lunge.phase = "dash";
        lunge.t = LUNGE_MAX_T;
        dashKick = 0.55;
        sfxDash();
      }
      return;
    }

    lunge.t -= dt;
    player.grounded = false;

    if (lunge.win === undefined) {
      // 아직 창이 안 열렸다: 매 프레임 적 쪽으로 유도한다 (적이 밀려나도 따라붙는다)
      _lv.copy(_lv2).sub(player.pos);
      if (_lv.lengthSq() > 1e-6) player.vel.copy(_lv.normalize()).multiplyScalar(LUNGE_SPEED);
      if (d < KICK_R) {
        lunge.win = KICK_WIN;                 // 창 개시 — 이 순간부터 유도를 끊는다
        player.vel.multiplyScalar(0.1);       // 대상 앞에서 급정거
        hitStop = 0.09;
      }
      else if (lunge.t <= 0) { kickWhiff(e); return; }
      kickOpen = false;
      return;
    }

    // 창이 열린 뒤에는 관성으로 스쳐 지나간다. 계속 유도하면 적 주위를 맴돌아
    // 타이밍이랄 게 없어진다.
    lunge.win -= dt;
    kickOpen = true;
    if (kickBuf > 0) { doKick(e); return; }
    if (lunge.win <= 0) { kickWhiff(e); return; }
    return;
  }

  if (pull) {
    const e = pull.e;
    if (e.dead) { e.grip = 0; pull = null; kickOpen = false; return; }
    pull.t += dt;
    // 눈앞 4m 지점으로 끌어온다
    camera.getWorldDirection(_lv);
    _lv2.copy(player.pos).addScaledVector(_lv, 4).setY(player.pos.y + 0.6);
    _lv.copy(_lv2).sub(gripPoint(e, _impV));
    const d = _lv.length();
    if (d > 0.001) {
      const stepLen = Math.min(d, PULL_SPEED * dt);
      e.g.position.addScaledVector(_lv.divideScalar(d), stepLen);
    }
    e.yaw = lerpAngle(e.yaw, Math.atan2(player.pos.x - e.g.position.x, player.pos.z - e.g.position.z), Math.min(1, 10 * dt));

    if (pull.win === undefined) {
      if (d < KICK_R) pull.win = KICK_WIN;
      else if (pull.t > PULL_MAX_T) { kickWhiff(e); return; }
      kickOpen = false;
      return;
    }
    pull.win -= dt;
    kickOpen = true;
    if (kickBuf > 0) { doKick(e); return; }
    if (pull.win <= 0) { kickWhiff(e); return; }
    return;
  }

  kickOpen = false;
}

function onHit(e, vel) {
  e.hp -= 1;
  e.flash = 0.16;
  const killed = e.hp <= 0;
  hitStop = killed ? 0.095 : 0.055;
  shake = Math.max(shake, killed ? 1.0 : 0.55);
  hitMark = 0.17;
  combo++; comboT = 1.8;
  const kb = vel.clone().normalize().multiplyScalar(killed ? 30 : 8);
  kb.y = killed ? 9 : 2.2;
  e.knock.add(kb);
  spawnImpact(_impV.set(e.g.position.x, e.g.position.y + 2.8, e.g.position.z), killed ? 14 : 7);
  sfxHit(killed);
  hitKill = killed;
  if (killed && !e.dead) { e.dead = true; e.deadT = 0.5; ultFake = Math.min(1, ultFake + 0.05); }
}

const _cv = new THREE.Vector3();
const _stepV = new THREE.Vector3();   // 탄 이동량 전용 (segHitsSphere 임시벡터와 절대 겹치면 안 됨)
const _impV = new THREE.Vector3();    // 임팩트 위치 전용
const _wallP = new THREE.Vector3();   // 탄이 지형에 닿은 지점 전용
const projRay = new THREE.Raycaster();   // 조준선 미리보기 등 드문 용도에만 남겨둔다
const _segBoxes = [];

// 선분(p0 -> p0+step)이 축정렬 박스를 지나는 첫 지점의 t(0..1). 안 지나면 -1.
function segBoxT(p, d, x0, y0, z0, x1, y1, z1) {
  // 시작점이 이미 박스 안이면 무시한다. 1인칭 총구는 벽에 살짝 파고들 수 있는데,
  // 그걸 명중으로 치면 벽에 붙어 있는 동안 쏘는 족족 총구에서 터진다.
  if (p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1 && p.z > z0 && p.z < z1) return -1;
  let tmin = 0, tmax = 1;
  // x
  if (Math.abs(d.x) < 1e-9) { if (p.x < x0 || p.x > x1) return -1; }
  else {
    let a = (x0 - p.x) / d.x, b = (x1 - p.x) / d.x;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > tmin) tmin = a;
    if (b < tmax) tmax = b;
    if (tmin > tmax) return -1;
  }
  // y
  if (Math.abs(d.y) < 1e-9) { if (p.y < y0 || p.y > y1) return -1; }
  else {
    let a = (y0 - p.y) / d.y, b = (y1 - p.y) / d.y;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > tmin) tmin = a;
    if (b < tmax) tmax = b;
    if (tmin > tmax) return -1;
  }
  // z
  if (Math.abs(d.z) < 1e-9) { if (p.z < z0 || p.z > z1) return -1; }
  else {
    let a = (z0 - p.z) / d.z, b = (z1 - p.z) / d.z;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > tmin) tmin = a;
    if (b < tmax) tmax = b;
    if (tmin > tmax) return -1;
  }
  return tmin;
}

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
function updateCombat(dt) {
  if (attackCd > 0) attackCd -= dt;
  if (bindCd > 0) bindCd -= dt;
  updateLungePull(dt);
  if (reloadT > 0) {
    reloadT -= dt;
    if (reloadT <= 0) { reloadT = 0; ammo = MAG_SIZE; }
  }
  if (hitMark > 0) hitMark -= dt;
  if (comboT > 0) { comboT -= dt; if (comboT <= 0) combo = 0; }

  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    const step = _stepV.copy(p.vel).multiplyScalar(dt);
    let hit = null;
    for (const e of enemies) {
      if (e.dead) continue;
      _cv.set(e.g.position.x, e.g.position.y + 2.8, e.g.position.z);
      if (segHitsSphere(p.pos, step, _cv, ENEMY_HIT_R)) { hit = e; break; }
    }
    // 지형/건물 충돌은 실제 레이캐스트로 잡는다.
    // (groundHeightAt은 건물 옥상 높이라 벽 옆을 지나는 탄까지 "지하"로 오판한다)
    let wallHit = null;
    if (!hit && segHitWorld(p.pos, step, _wallP)) wallHit = _wallP;

    p.pos.add(step);
    p.m.position.copy(p.pos);
    p.life -= dt;

    if (hit || wallHit || p.life <= 0) {
      if (hit) {
        if (p.bind) bindEnemy(hit);
        else if (p.grab) startLunge(hit);
        else if (p.pull) startPull(hit);
        else onHit(hit, p.vel);
      }
      else if (wallHit) {
        spawnImpact(wallHit, 4);
        shake = Math.max(shake, 0.12);
        if (p.grab || p.pull) say("빗나감 — 적을 맞춰야 한다");
      } else if (p.life <= 0 && (p.grab || p.pull)) say("빗나감 — 적을 맞춰야 한다");
      scene.remove(p.m);
      projectiles.splice(i, 1);
    }
  }

  // --- 적의 탄 ---
  // 플레이어는 구(반경 PLAYER_HIT_R)로 잡고, 선분-구 판정으로 프레임 사이 통과를 막는다.
  for (let i = eProjectiles.length - 1; i >= 0; i--) {
    const p = eProjectiles[i];
    const step = _stepV.copy(p.vel).multiplyScalar(dt);
    _cv.set(player.pos.x, player.pos.y + 1.0, player.pos.z);
    let done = false;
    if (deadT <= 0 && invuln <= 0 && segHitsSphere(p.pos, step, _cv, PLAYER_HIT_R)) {
      damagePlayer(p.dmg || E_DMG);
      spawnImpact(_impV.copy(_cv), 5);
      done = true;
    }
    if (!done && segHitWorld(p.pos, step, _wallP)) { spawnImpact(_wallP, 3); done = true; }
    p.pos.add(step);
    p.m.position.copy(p.pos);
    p.life -= dt;
    if (done || p.life <= 0) { scene.remove(p.m); eProjectiles.splice(i, 1); }
  }

  // --- 스태미나 ---
  // 벽에 붙어 있는 것도 "발을 붙인" 것으로 친다 (스파이더맨이니까)
  const footed = player.grounded || !!clinging;
  if (web) {
    stam -= STAM_SWING * dt;
    if (stam <= 0) {
      stam = 0;
      stamEmpty = true;
      stamFx = 1;
      releaseWeb();          // 힘이 빠지면 줄을 놓친다
      say("스태미나 소진");
    }
  } else {
    stam = Math.min(MAX_STAM, stam + (footed ? STAM_GND : STAM_AIR) * dt);
  }
  if (stamEmpty && stam >= STAM_MIN) stamEmpty = false;
  if (stamFx > 0) stamFx -= dt * 1.5;

  // --- 자가 치유 ---
  if (deadT <= 0) {
    if (regenWait > 0) regenWait -= dt;
    else if (hp < MAX_HP) {
      regenT += dt;
      if (regenT >= REGEN_TIME) { regenT = 0; hp++; sfxRegen(); }
    }
  }

  // --- 피격/사망 타이머 ---
  if (invuln > 0) invuln -= dt;
  if (hurtFx > 0) hurtFx -= dt * 1.6;
  if (deadT > 0) { deadT -= dt; if (deadT <= 0) respawn(); }

  for (let i = particles.length - 1; i >= 0; i--) {
    const q = particles[i];
    q.life -= dt;
    q.v.y -= 52 * dt;
    q.m.position.addScaledVector(q.v, dt);
    q.m.scale.setScalar(Math.max(0.05, q.life * 3));
    if (q.life <= 0) { scene.remove(q.m); particles.splice(i, 1); }
  }

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    // 적 1명 = 드로우콜 2개. 256명을 전부 그리면 그것만으로 512콜이라 멀면 끈다.
    const dist = e.g.position.distanceTo(player.pos);
    e.g.visible = dist < E_VISIBLE;

    if (e.flash > 0) e.flash -= dt;
    // 조준 중에는 AI가 emissive를 직접 몰기 때문에 피격 플래시가 없을 때만 덮어쓴다
    if (e.flash > 0 || e.aimT <= 0) e.mat.emissive.setScalar(Math.max(0, e.flash) * 4);

    // 멀리 있는 적까지 매 프레임 사고시킬 이유가 없다
    if (!e.dead && dist < E_ACTIVE) updateEnemyAI(e, dt, dist);
    else if (e.beam) freeBeam(e);

    // 속박 진행/해제
    if (e.bound > 0) {
      e.bound -= dt;
      e.knock.set(0, 0, 0);                    // 묶인 동안은 완전히 고정
      if (e.cocoon) {
        // 끝나기 직전 깜빡여서 풀린다는 걸 미리 알린다
        const blink = e.bound < 1.2 && Math.sin(e.bound * 26) < 0;
        e.cocoon.visible = !blink;
      }
      if (e.bound <= 0 && e.cocoon) {
        e.g.remove(e.cocoon);
        e.cocoon = null;
        spawnImpact(_impV.set(e.g.position.x, e.g.position.y + 2.8, e.g.position.z), 6);
      }
    }

    e.g.position.addScaledVector(e.knock, dt);
    e.knock.multiplyScalar(Math.exp(-5.5 * dt));
    if (e.grip !== 2) {
      const gy = groundHeightAt(e.g.position.x, e.g.position.z, e.g.position.y);
      if (e.g.position.y < gy) { e.g.position.y = gy; e.knock.y = 0; }
      else if (e.g.position.y > gy) e.knock.y -= 46 * dt;
    }

    if (e.dead) {
      e.deadT -= dt;
      e.g.scale.setScalar(Math.max(0.01, e.deadT / 0.5));
      e.g.rotation.z += dt * 7;
      if (e.deadT <= 0) {
        freeBeam(e);
        if (lunge && lunge.e === e) { lunge = null; kickOpen = false; }
        if (pull && pull.e === e) { pull = null; kickOpen = false; }
        scene.remove(e.g);
        enemies.splice(i, 1);
      }
    } else if (e.bound > 0) {
      e.g.rotation.y = e.yaw;                  // 묶였으면 몸부림도 멈춘다
    } else if (e.state === "aim") {
      e.g.rotation.y = e.yaw;                  // 조준 중엔 흔들리지 않는다
    } else {
      e.wob += dt * 2.2;
      e.g.rotation.y = e.yaw + Math.sin(e.wob) * (e.state === "patrol" ? 0.35 : 0.12);
    }
  }
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

function makeWebStrandTexture() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#e9eef7";
  g.fillRect(0, 0, 64, 128);
  // 길이 방향으로 흐르는 섬유 몇 가닥
  for (let i = 0; i < 9; i++) {
    const x = Math.random() * 64;
    g.strokeStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.9)" : "rgba(150,165,190,0.55)";
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + 8, 42, x - 8, 86, x + (Math.random() - 0.5) * 6, 128);
    g.stroke();
  }
  // 가로로 감긴 매듭 자국
  for (let i = 0; i < 12; i++) {
    g.strokeStyle = "rgba(120,135,160,0.28)";
    g.lineWidth = 1;
    const y = Math.random() * 128;
    g.beginPath(); g.moveTo(0, y); g.lineTo(64, y + 3); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
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

// 장갑에 새길 거미줄 무늬 (방사선 + 늘어진 호)
function makeWebGloveTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#1e3fa8";
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = "rgba(0,0,0,0.6)";
  g.lineWidth = 1.5;
  const SPOKES = 8;
  for (let i = 0; i < SPOKES; i++) {
    const a = (i / SPOKES) * Math.PI * 2;
    g.beginPath();
    g.moveTo(64, 64);
    g.lineTo(64 + Math.cos(a) * 100, 64 + Math.sin(a) * 100);
    g.stroke();
  }
  for (let r = 13; r <= 96; r += 14) {
    g.beginPath();
    for (let i = 0; i < SPOKES; i++) {
      const a0 = (i / SPOKES) * Math.PI * 2;
      const a1 = ((i + 1) / SPOKES) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      if (i === 0) g.moveTo(64 + Math.cos(a0) * r, 64 + Math.sin(a0) * r);
      g.quadraticCurveTo(
        64 + Math.cos(am) * r * 0.84, 64 + Math.sin(am) * r * 0.84,
        64 + Math.cos(a1) * r, 64 + Math.sin(a1) * r
      );
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const gloveMat = new THREE.MeshStandardMaterial({ map: makeWebGloveTexture(), color: 0xffffff, roughness: 0.55 });
const sleeveMat = new THREE.MeshStandardMaterial({ color: 0xd6182b, roughness: 0.7 });
const shooterMat = new THREE.MeshStandardMaterial({ color: 0x252a34, roughness: 0.35, metalness: 0.55 });
const nozzleMat = new THREE.MeshStandardMaterial({ color: 0xb9c2cf, roughness: 0.25, metalness: 0.85 });

// 손가락 = 두 마디. root를 굽히면 손가락 전체가, mid를 굽히면 끝마디만 접힌다.
function makeFinger(len, thick) {
  const root = new THREE.Group();
  const prox = new THREE.Mesh(new THREE.CapsuleGeometry(thick, len * 0.5, 3, 6), gloveMat);
  prox.rotation.x = Math.PI / 2;
  prox.position.z = -(len * 0.25 + thick * 0.2);
  root.add(prox);
  const mid = new THREE.Group();
  mid.position.z = -(len * 0.5 + thick * 0.4);
  const dist = new THREE.Mesh(new THREE.CapsuleGeometry(thick * 0.84, len * 0.4, 3, 6), gloveMat);
  dist.rotation.x = Math.PI / 2;
  dist.position.z = -(len * 0.2 + thick * 0.18);
  mid.add(dist);
  root.add(mid);
  root.userData.mid = mid;
  return root;
}

// 손은 -Z 방향을 향하고, 손바닥이 하늘(+Y)을 본다.
// 따라서 손가락은 +X 회전으로 손바닥 쪽(위)으로 말린다.
function makeHand(mirror) {
  const g = new THREE.Group();

  // 전완은 짧게. 길면 손을 뒤로 당기는 포즈에서 뒷끝이 카메라 근평면(0.1)을 넘어
  // 잘려나가 "팔이 손에서 떨어진" 것처럼 보인다.
  const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.088, 0.34, 4, 10), sleeveMat);
  sleeve.rotation.x = Math.PI / 2;
  sleeve.position.z = 0.24;
  g.add(sleeve);

  // 웹슈터: 손목 밴드 + 아래쪽 노즐
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.098, 0.075, 12), shooterMat);
  band.rotation.x = Math.PI / 2;
  band.position.z = 0.045;
  g.add(band);
  // 손바닥이 하늘을 보므로 웹슈터 노즐도 손바닥 쪽(+Y)에 붙는다
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.1, 8), nozzleMat);
  nozzle.rotation.x = Math.PI / 2;
  nozzle.position.set(0, 0.052, -0.03);
  g.add(nozzle);

  const palm = new THREE.Mesh(new THREE.BoxGeometry(0.155, 0.062, 0.15), gloveMat);
  palm.position.z = -0.06;
  g.add(palm);

  // 검지 · 중지 · 약지 · 소지
  const spec = [
    { x: -0.055, len: 0.115, th: 0.021 },
    { x: -0.019, len: 0.128, th: 0.022 },
    { x:  0.017, len: 0.118, th: 0.021 },
    { x:  0.05,  len: 0.095, th: 0.018 },
  ];
  const fingers = spec.map(s => {
    const f = makeFinger(s.len, s.th);
    f.position.set(s.x, 0.004, -0.13);
    g.add(f);
    return f;
  });

  // 오른손 + 손바닥이 하늘 -> 엄지는 오른쪽(+X)에 온다
  const thumb = makeFinger(0.082, 0.023);
  thumb.position.set(0.076, 0.012, -0.052);
  thumb.rotation.set(0, -0.85, 0);
  g.add(thumb);

  g.userData.nozzle = nozzle;   // 손목 웹슈터 — 거미줄이 여기서 나간다
  g.userData.fingers = fingers;
  g.userData.thumb = thumb;
  g.userData.curl = [0, 0, 0, 0];   // 손마다 따로 (양손이 서로 값을 덮어쓰지 않게)
  if (mirror) g.scale.x = -1;
  g.visible = false;
  return g;
}

// 손 포즈. spider=1이면 중지·약지를 접은 웹슈팅 자세, grip=1이면 벽 짚는 자세.
function poseHand(h, spider, grip, splay, fire, k) {
  const f = h.userData.fingers;
  const curl = h.userData.curl;
  for (let i = 0; i < 4; i++) {
    const isFolded = (i === 1 || i === 2);
    // 웹슈팅: 중지·약지만 손바닥으로 말아 넣는다
    // 뿌리 1.75 + 끝마디 1.66 = 약 195도. 손끝이 손바닥 위에 얹힌다 (더 굽히면 뚫고 들어간다).
    const sp = isFolded ? 1.75 + fire * 0.3 : 0.06;
    // 벽 짚기: 네 손가락 모두 적당히 구부려 표면을 움켜쥔다
    const gr = 0.85 + (isFolded ? 0.12 : 0.05);
    const target = sp * spider + gr * grip;
    curl[i] += (target - curl[i]) * k;
    f[i].rotation.x = curl[i];
    f[i].rotation.z = (i - 1.5) * 0.055 * splay;
    f[i].userData.mid.rotation.x = curl[i] * (isFolded ? 0.95 : 0.35);
  }
  h.userData.thumb.rotation.x = 0.35 + grip * 0.5 + fire * 0.2;
}

const armR = makeHand(false);
const armL = makeHand(true);
armR.position.set(0.5, -0.46, -0.52);
armR.rotation.x = 0.55;
armR.scale.setScalar(0.72);
camera.add(armR);
camera.add(armL);

const handAnchor = new THREE.Object3D();
handAnchor.position.set(0.36, -0.3, -0.78);
camera.add(handAnchor);
scene.add(camera);

let actx = null;
let windGain = null;
let windFilter = null;
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

const keys = {};
addEventListener("keydown", e => {
  keys[e.code] = true;
  // 벽타기 키(로지텍 사이드 버튼 = F4). 브라우저 기본 동작을 막아야 홀드가 끊기지 않는다.
  if (e.code === "ControlLeft" || e.code === "ControlRight") e.preventDefault();
  if (e.code === "KeyP") {
    firstPerson = !firstPerson;
    spiderGroup.visible = !firstPerson;
    if (firstPerson) {
      camAuto = false;
      requestLook();
      crosshairEl.style.left = "50%";
      crosshairEl.style.top = "50%";
    } else {
      document.exitPointerLock();
    }
  }
  // C = 돌진. 1인칭·3인칭 모두 동작한다 (3인칭에서 카메라 토글이던 걸 Z로 옮겼다).
  if (e.code === "KeyC") fireGrab();
  if (e.code === "KeyZ") { camAuto = !camAuto; camMsg = 1.6; }
  // R = 적을 눈앞으로 끌어온다. 끌려오는 동안 좌클릭 타이밍을 맞추면 발차기.
  if (e.code === "KeyR" && firstPerson) firePull();
  // + = 야간/주간 전환. 자판마다 + 자리가 달라 = 키와 넘패드 +를 모두 받는다.
  if (e.code === "Equal" || e.code === "NumpadAdd") setNight(!night);
  // F1 = 조작법 패널. 브라우저 기본 도움말이 뜨는 걸 막는다.
  if (e.code === "F1") {
    e.preventDefault();
    hudEl.classList.toggle("show");
  }
  if (e.code === "Escape") hudEl.classList.remove("show");
  if (e.code === "Tab") {
    e.preventDefault();          // 안 막으면 브라우저가 포커스를 옮겨버린다
    attackMode = !attackMode;
    camMsg = 1.6;
    if (attackMode) { releaseWeb(); zip = null; }   // 공격 모드로 들어가면 줄은 놓는다 (잡기는 유지)
  }
  // E = 속박 (공격 모드 전용). 스윙 중 E는 기존 속도 부스트라 서로 겹치지 않는다.
  if (e.code === "KeyQ") fireUlt();        // 궁극기 — 광역 속박
  if (e.code === "KeyF") punch();          // 근접 주먹
  if (e.code === "KeyE" && attackMode) fireBind();
  // 수동 재장전
  if (e.code === "KeyV" && attackMode) startReload();
});
addEventListener("keyup", e => { keys[e.code] = false; });

const G = 72;        // 무게감. 큰 스케일에서 붕 뜨지 않도록 실제 중력보다 크게 잡는다
const JUMP_V = 42;   // 중력을 올린 만큼 초속도도 올려 도약 높이를 유지
const MOVE_SPEED = 16;
const SPRINT_MULT = 1.85;   // 지상 Shift 달리기 배수
const ACCEL = 90;
const AIR_ACCEL = 30;
const PUMP_ACCEL = 44;   // E 홀드 속도 증강
const ROPE_MIN = 12;
// 집라인(우클릭): 양손 거미줄로 앵커를 잡고 자신을 끌어당기는 이동기.
// 줄이 걸리자마자 튀어나가면 가볍게 느껴진다. 짧게 힘을 모으는 구간을 두면
// "당겨진다"는 인과가 눈에 보이고 발사 순간의 가속이 훨씬 세게 체감된다.
const ZIP_CHARGE = 0.3;   // 시전 딜레이 — 줄을 걸고 힘을 모으는 시간
const ZIP_SPEED = 200;    // 당겨지는 목표 속도
const ZIP_GRAB = 11;      // 목표 속도에 붙는 빠르기
const ZIP_ARRIVE = 10;    // 앵커에 이만큼 가까워지면 종료 (빨라진 만큼 넉넉히)
const ZIP_MAX_T = 2.4;    // 안전 타임아웃
// 도착 순간 속도를 깎아버리면 이 이동기가 "순간이동"이 된다.
// 속도를 거의 그대로 남기고, 상한만 서서히 되돌려 그 속도를 반동으로 쓰게 한다.
const ZIP_KEEP = 0.72;    // 도착 시 남기는 속도 비율
const ZIP_MOMENT = 0.9;   // 상한이 MAX_SPEED로 돌아오기까지의 시간(초)
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
function findZipAnchor() {
  const base = cursorNdc();
  let best = null, bestD = Infinity;
  for (const [ox, oy] of ZIP_ASSIST) {
    _zndc.set(base.x + ox, base.y + oy);
    raycaster.setFromCamera(_zndc, camera);
    raycaster.far = Infinity;
    const hits = raycaster.intersectObjects(aimTargets, false);
    if (!hits.length) continue;
    const p = hits[0].point;
    const d = player.pos.distanceTo(p);
    if (d > ROPE_MAX) continue;
    // 정중앙(첫 항목)이 맞으면 그대로 쓴다. 보조는 어디까지나 차선책이다.
    if (ox === 0 && oy === 0) return p.clone();
    if (d < bestD) { bestD = d; best = p.clone(); }
  }
  return best;
}

function tryZip() {
  if (!canAct()) return false;
  const p = findZipAnchor();
  if (!p) {
    // 조용히 실패하면 "키가 안 먹는다"로 읽힌다. 실패도 반드시 알린다.
    say("걸 곳 없음 (사거리 " + ROPE_MAX + "m)");
    sfxMiss();
    return false;
  }
  releaseWeb();
  clearGrip();          // 잡거나 끌던 걸 놓는다 (안 놓으면 두 시스템이 속도를 서로 덮어씀)
  clinging = null;
  zip = { a: p, t: 0, charge: ZIP_CHARGE };
  armPulse = 0.35;
  sfxThwip();
  return true;
}
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
const GRIP_TIME = 0.13;     // 로프가 완전히 물리기까지. 붙는 순간 덜컹거림 제거
const REEL_RATE = 40;       // 로프 길이가 목표를 따라가는 속도 (m/s)
const REEL_MANUAL = 26;     // Space 홀드 시 줄을 감는 속도 (m/s)
const PUMP_DEPTH = 0.12;    // 호 바닥에서 로프가 줄어드는 비율 = 자동 펌핑 강도
const SWING_CONVERT = 0.985; // 낙하(반경) 속도를 접선 속도로 되돌리는 비율. 1이면 무손실
const CAM_ROLL = 0.5;       // 뱅킹 롤 강도

let camAuto = true;
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
  return !!(keys["ControlLeft"] || keys["ControlRight"] || climbMouse);
}
let swayX = 0, swayY = 0;
let swayPrevYaw = 0, swayPrevPitch = 0;
// 각도 차를 -PI..PI로 접는다. 시점이 한 바퀴 돌 때 스웨이가 튀지 않게.
function shortAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
let armExt = 0;
let clinging = null;
let sliding = false;
let lastWall = null;
let wallBump = 0;   // 벽에 세게 박았을 때의 연출 잔량
let mouseDownL = false;
let mouseDownR = false;
// 좌우 동시 클릭 판정 여유. 사람이 두 손가락을 정확히 같은 밀리초에 누르지는 못한다.
const ZIP_CHORD = 0.34;
let lClickT = -1, rClickT = -1;
let diving = false;
let diveFx = 0;      // 급강하 연출 강도 0..1 (서서히 차오르고 서서히 빠진다)
let camRoll = 0;
let aimPreview = null;
let aimTick = 0;
const lookTarget = new THREE.Vector3();

const raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const crosshairEl = document.getElementById("crosshair");
const hudEl = document.getElementById("hud");
const hitmarkEl = document.getElementById("hitmarker");
crosshairEl.style.left = `${mx}px`;
crosshairEl.style.top = `${my}px`;

// 1인칭은 항상 화면 정중앙. 포인터락이 풀려도 조준 기준이 흔들리면 안 된다.
function cursorNdc() {
  if (firstPerson) return _ndc.set(0, 0);
  return _ndc.set((mx / innerWidth) * 2 - 1, -(my / innerHeight) * 2 + 1);
}

// 조준 대상. 나중에 장애물/적을 추가하면 addAimTarget()으로 여기 넣으면 된다.
// 건물 종류마다 메시가 따로라 전부 조준 표적에 넣어야 어느 건물에든 거미줄이 걸린다
const aimTargets = [...cityMeshes, propMesh, ledgeMesh, sidewalkMesh, ground];
function addAimTarget(obj) { if (!aimTargets.includes(obj)) aimTargets.push(obj); }

// 조준선이 맞은 지점을 그대로 돌려준다. 보정도, 스냅도, 자동 탐색도 없다.
// 화면에 보이는 그 점에 정확히 붙는 것이 유일한 규칙.
function resolveAnchor() {
  raycaster.setFromCamera(cursorNdc(), camera);
  raycaster.far = Infinity;
  const hits = raycaster.intersectObjects(aimTargets, false);
  if (!hits.length) return null;
  const p = hits[0].point;
  // 사거리는 카메라가 아니라 플레이어(거미줄이 나가는 곳) 기준으로 잰다
  if (player.pos.distanceTo(p) > ROPE_MAX) return null;
  return p.clone();
}

function attachWeb(point) {
  const d = Math.max(player.pos.distanceTo(point), ROPE_MIN);
  web = { a: point.clone(), len: d, base: d, t: 0 };
  hasDash = true;
  armPulse = 0.35;
  sfxThwip();
}

function releaseWeb() {
  web = null;
}

// --- 자동 앵커 (터치 전용) ---
const AUTO_YAW = [0, 18, -18, 36, -36, 55, -55];   // 진행 방향 기준 좌우
const AUTO_PITCH = [22, 34, 46, 16, 56, 8, 0, -8]; // 위로 올려다보는 각도 (수평 아래까지)
const _aDir = new THREE.Vector3(), _aOrigin = new THREE.Vector3();
const _aStep = new THREE.Vector3(), _aHit = new THREE.Vector3();

// 스윙하기 좋은 앵커인가를 점수로 매긴다.
function scoreAnchor(p, fx, fz) {
  const dx = p.x - player.pos.x, dy = p.y - player.pos.y, dz = p.z - player.pos.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 18 || len > ROPE_MAX) return -1;        // 너무 짧으면 덜컹, 길면 안 당겨짐
  if (dy < -14) return -1;                          // 너무 아래면 그네가 아니라 추락이다
  const h = Math.hypot(dx, dz) || 1;
  const fwd = (dx / h) * fx + (dz / h) * fz;        // 진행 방향과의 일치도 (-1..1)
  if (fwd < -0.15) return -1;                       // 뒤쪽은 버린다
  // 줄 길이는 최대의 45~85%가 가장 좋은 호를 만든다
  const r = len / ROPE_MAX;
  const lenScore = 1 - Math.min(1, Math.abs(r - 0.62) / 0.45);
  // 머리 바로 위는 그네가 아니라 정지다
  const steep = Math.min(1, Math.hypot(dx, dz) / Math.max(1, Math.abs(dy)));
  // 높을수록 좋지만 필수는 아니다. 스카이라인 위를 날 때도 걸 데가 있어야 한다.
  const highScore = Math.max(0, Math.min(1, (dy + 14) / 45));
  return fwd * 1.5 + lenScore * 1.2 + steep * 0.8 + highScore * 1.1;
}

// 진행 방향(느리면 시선) 기준으로 부채꼴을 쏴 제일 좋은 앵커를 고른다.
function findSwingAnchor() {
  // 보는 쪽을 기준으로 삼는다. 속도 기준으로 하면 시선과 다른 데 붙어서
  // "왜 저기에 걸리지"가 되고, 조작이 통제 불능으로 느껴진다.
  const fx = Math.sin(viewYaw), fz = Math.cos(viewYaw);
  _aOrigin.set(player.pos.x, player.pos.y + 1.6, player.pos.z);
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
      if (sc > -1 && sc > bestScore) { bestScore = sc; best = _aHit.clone(); }
    }
  }
  return best;
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
  if (stamEmpty) { say("스태미나 부족"); sfxMiss(); stamFx = 1; return false; }
  initAudio();
  const p = findSwingAnchor();
  if (!p) { say("걸 곳 없음"); sfxMiss(); return false; }
  attachWeb(p);
  return true;
}

function tryAttach() {
  if (!canAct()) return false;
  if (stamEmpty) { say("스태미나 부족"); sfxMiss(); stamFx = 1; return false; }
  initAudio();
  const point = resolveAnchor();
  if (!point) return false;      // 빈 발. 조준한 곳에 걸 수 없으면 그냥 실패한다.
  attachWeb(point);
  return true;
}

// 마우스 사이드 버튼(3=뒤로, 4=앞으로)은 기본 동작이 페이지 이동이라 반드시 막는다.
// 사이드 버튼 둘 중 뒤쪽(3)은 벽타기, 앞쪽(4)은 근접 주먹.
addEventListener("mousedown", e => {
  if (e.button === 3) { climbMouse = true; e.preventDefault(); }
  else if (e.button === 4) { punch(); e.preventDefault(); }
}, { capture: true });
addEventListener("mouseup", e => {
  if (e.button === 3) { climbMouse = false; e.preventDefault(); }
  else if (e.button === 4) e.preventDefault();
}, { capture: true });
addEventListener("auxclick", e => {
  if (e.button === 3 || e.button === 4) e.preventDefault();
}, { capture: true });

renderer.domElement.addEventListener("mousedown", e => {
  initAudio();
  if (e.button === 3 || e.button === 4) return;
  const nowS = performance.now() / 1000;
  if (e.button === 2) {
    mouseDownR = true;
    rClickT = nowS;
    // 1인칭: 우클릭만으로 바로 집라인. 3인칭: 우드래그가 시점이라 좌우 동시일 때만.
    if (firstPerson || mouseDownL || nowS - lClickT < ZIP_CHORD) {
      releaseWeb();          // 좌클릭이 먼저 걸어둔 줄이 있으면 취소
      if (tryZip()) return;
      // 1인칭에서는 실패해도 시점 드래그로 넘기지 않는다 (넘기면 "먹통"으로 읽힌다)
      if (firstPerson) return;
    }
    dragging = true;
    return;
  }
  if (e.button !== 0) return;
  mouseDownL = true;
  lClickT = nowS;
  // 우클릭이 이미 눌려 있으면 = 동시 클릭 -> 양손 집라인
  if (mouseDownR || nowS - rClickT < ZIP_CHORD) {
    dragging = false;
    if (tryZip()) return;
  }
  // 1인칭에서 락이 안 걸려 있으면 이 클릭으로 다시 시도한다.
  // (락 여부와 무관하게 시점은 돌아가므로 클릭을 삼키지 않고 그대로 진행한다)
  if (firstPerson && document.pointerLockElement !== renderer.domElement) requestLook();
  // 잡거나 끌어오는 중이면 좌클릭은 오직 발차기 입력이다
  if (lunge || pull) { tryKick(); return; }
  // 공격 모드에서는 좌클릭이 거미줄 발사 (클릭 한 번 = 한 발)
  if (attackMode) {
    fireWeb();
    return;
  }
  if (clinging) {
    wallJump();
    return;
  }
  // 클릭 한 번에 정확히 한 발. 홀드해도 재발사하지 않는다.
  tryAttach();
  armPulse = 0.35;
});
addEventListener("mouseup", e => {
  if (e.button === 0) { mouseDownL = false; if (!lunge && !pull) releaseWeb(); }   // 떼면 즉시 손 놓기
  if (e.button === 2) { mouseDownR = false; dragging = false; }
});
// 휠 아래로 = 덤블링. 지상이면 구르기(전방 추진), 공중이면 공중제비.
addEventListener("wheel", e => {
  if (e.deltaY <= 0 || tumbleT > 0 || clinging) return;
  const fwd = new THREE.Vector3();
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  const l = fwd.length();
  if (l < 0.001) return;
  fwd.divideScalar(l);
  if (player.grounded) {
    tumbleDur = 0.5;
    player.vel.x = fwd.x * TUMBLE_SPEED;
    player.vel.z = fwd.z * TUMBLE_SPEED;
  } else {
    tumbleDur = 0.65;
    player.vel.x += fwd.x * TUMBLE_AIR;
    player.vel.z += fwd.z * TUMBLE_AIR;
  }
  tumbleT = tumbleDur;
  sfxDash();
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
function requestLook() {
  try {
    const r = renderer.domElement.requestPointerLock();
    if (r && typeof r.catch === "function") r.catch(() => {});
  } catch (err) { /* 락 미지원 — 조작은 mousemove로 계속된다 */ }
}

addEventListener("contextmenu", e => e.preventDefault());
addEventListener("blur", () => { dragging = false; mouseDownL = false; mouseDownR = false; releaseWeb(); });

document.addEventListener("mousemove", e => {
  // 1인칭은 포인터 락 성공 여부와 관계없이 이동량으로 시점을 돌린다.
  // (락이 거부되는 환경에서도 조작이 죽지 않게 — 락은 커서를 가두는 역할만 한다)
  if (firstPerson) {
    // 락이 막 걸린 직후 첫 이벤트에는 커서가 중앙으로 순간이동한 거리가 통째로 실려온다.
    // 그대로 반영하면 시점이 홱 돌아가므로 한 번 버린다.
    if (lockSettle) { lockSettle = false; return; }
    // 창 전환·프레임 드랍 뒤에 큰 델타가 몰려올 수 있으니 상한을 둔다.
    const dx = Math.max(-140, Math.min(140, e.movementX || 0));
    const dy = Math.max(-140, Math.min(140, e.movementY || 0));
    viewYaw -= dx * 0.0022;
    viewPitch -= dy * 0.0018;
    viewPitch = Math.min(Math.max(viewPitch, -1.2), 1.35);
    return;
  }
  mx = e.clientX;
  my = e.clientY;
  crosshairEl.style.left = `${mx}px`;
  crosshairEl.style.top = `${my}px`;
  if (dragging) {
    viewYaw -= e.movementX * 0.005;
    viewPitch -= e.movementY * 0.004;
    viewPitch = Math.min(Math.max(viewPitch, -1.0), 1.2);
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

function lerpAngle(a, b, t) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// 튕겨내지 않고 벽을 따라 미끄러진다. 스치듯 맞으면 속도를 거의 그대로 유지
function resolveAxis(axis, bound, dirIn, b) {
  player.pos[axis] = bound;
  const v = player.vel[axis];
  if ((dirIn < 0 && v < 0) || (dirIn > 0 && v > 0)) {
    const sp = player.vel.length();
    // 벽을 파고드는 성분만 지운다. 남는 건 벽을 따라가는 성분뿐이라
    // 스치면 그대로 흘러가고, 정면이면 남는 게 없어 선다. 에너지를 되돌려주지 않는다.
    player.vel[axis] = 0;
    // 정면에 가까울수록 벽에 긁히는 느낌으로 접선 속도도 조금 깎는다
    const headOn = sp > 0.01 ? Math.min(1, Math.abs(v) / sp) : 0;
    player.vel.multiplyScalar(1 - 0.35 * headOn * headOn);
    if (headOn > 0.55 && sp > 26) {
      wallBump = Math.min(1, (sp - 26) / 60);   // 세게 박으면 화면에 알린다
      shake = Math.max(shake, wallBump * 0.5);
    }
  }
  lastWall = { axis, dir: dirIn, b, bound };
}

// 공중에서 벽타기 키를 눌렀을 때 잡을 벽을 찾는다.
// 충돌(lastWall)은 실제로 부딪혀야 생기므로, 살짝 떨어진 벽도 잡히게 별도로 탐색한다.
const _nbW = [];
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

function update(dt) {
  // 고정 스텝 물리와 가변 렌더를 잇기 위해 직전 위치를 남긴다.
  // 이게 없으면 렌더가 스텝 사이에 걸릴 때마다 카메라가 튄다(저더).
  player.prevPos.copy(player.pos);
  lastWall = null;

  // (자동 재부착 없음. 발사는 mousedown에서만 일어난다.)

  let ix = 0, iz = 0;
  if (keys["KeyW"]) iz -= 1;
  if (keys["KeyS"]) iz += 1;
  if (keys["KeyA"]) ix -= 1;
  if (keys["KeyD"]) ix += 1;
  // 가상 스틱(터치). 키보드와 섞이지 않게 스틱이 밀려 있을 때만 덮어쓴다.
  if (stickLen > 0.08) { ix = stickX; iz = stickY; }

  fwdFlat.set(Math.sin(viewYaw), 0, Math.cos(viewYaw));
  rightV.crossVectors(fwdFlat, new THREE.Vector3(0, 1, 0));

  let wx = fwdFlat.x * -iz + rightV.x * ix;
  let wz = fwdFlat.z * -iz + rightV.z * ix;
  const wl = Math.hypot(wx, wz);
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
    // 집라인 중에는 중력을 거의 죽여야 앵커까지 직선으로 시원하게 당겨진다
    // 돌진은 직선으로 꽂혀야 해서 중력을 완전히 끈다.
    // 스킬 시전 중(hoverT)에도 중력을 끊고 수직 속도를 죽여 공중에 잠깐 멈춰 선다.
    if (lunge) { /* 유도가 속도를 직접 지정한다 */ }
    else if (hoverT > 0) player.vel.y *= Math.exp(-7 * dt);
    else {
      player.vel.y -= G * dt * (diving ? 3.4 : 1) * (zip ? 0.12 : 1);
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
  const cap = zip
    ? ZIP_SPEED * 1.15
    : lunge ? LUNGE_SPEED * 1.2
    : Math.max(diving ? MAX_SPEED * 2.3 : MAX_SPEED, momentCap);
  if (!zip && !lunge && sp > SOFT_SPEED) {
    const over = (sp - SOFT_SPEED) / Math.max(1, cap - SOFT_SPEED);
    player.vel.multiplyScalar(Math.exp(-over * over * 3 * dt));
  }
  if (sp > cap) player.vel.multiplyScalar(cap / sp);

  if (!clinging) {
    const steps = Math.min(8, Math.max(1, Math.ceil((sp * dt) / (player.r * 0.7))));
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

    // 자동 릴리즈 없음. 좌클릭을 뗄 때까지 계속 매달려 있는다.
    collideWalls(player.pos.x, player.pos.z);
  }

  // 벽 붙기
  // 1) 그냥 부딪혔을 때: 느릴 때만 붙는다 (빠르면 스쳐 지나가야 흐름이 안 끊긴다)
  // 2) 벽타기 키를 누르고 있을 때: 공중에서 속도와 무관하게 근처 벽을 즉시 잡는다
  if (!clinging && !web && !zip && !lunge && !pull && !player.grounded) {
    let grab = null;
    if (climbHeld()) grab = lastWall || findNearbyWall(WALL_GRAB_REACH);
    else if (lastWall && player.vel.length() < 14) grab = lastWall;   // 34는 너무 헐거웠다
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
  if (!wasGrounded && player.grounded) landFx = 0.3;   // Land 애니메이션을 잠깐 재생
  if (landFx > 0) landFx -= dt;
  wasGrounded = player.grounded;
  if (!player.grounded) fallSpeed = -player.vel.y;

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
  updateCombat(dt);
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
  } else if (hsp > 1.5) {
    bodyYaw = lerpAngle(bodyYaw, Math.atan2(player.vel.x, player.vel.z), Math.min(1, 10 * dt));
  }
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
    if (landFx > 0) state = "Land";
    // 벽: 실제로 오를 때만 등반 모션, 붙어만 있으면 매달린 자세
    else if (clinging) state = climbHeld() ? "WallRun" : "WallHang";
    else if (web || zip) state = "Swing";
    else if (!player.grounded) state = player.vel.y > 0.5 ? "Jump" : "Fall";
    else if (hsp > MOVE_SPEED * 1.6) state = "Sprint";
    else if (hsp > 1.5) state = "Run";
    crossfadeTo(state);
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
  const e = (lunge && lunge.e) || (pull && pull.e);
  if (e && !e.dead) return gripPoint(e, _dualT);
  return null;
}

// 집라인·잡기·끌어오기 중에는 양손에서 대상으로 두 가닥이 뻗는다
function updateZipVisual() {
  const anchor = dualWebTarget();
  if (!anchor) {
    zipWebL.mesh.visible = false;
    zipWebR.mesh.visible = false;
    return;
  }
  zipWebL.mesh.visible = true;
  zipWebR.mesh.visible = true;

  // 1인칭에서는 실제 손 모델의 손목 웹슈터에서 줄이 나가야 한다.
  // 카메라 기준으로 대충 벌려두면 손과 줄이 따로 놀아서 바로 티가 난다.
  if (firstPerson && armR.userData.nozzle && armL.userData.nozzle) {
    armR.userData.nozzle.getWorldPosition(_w4);
    fillRibbon(zipWebR, _w4, anchor, 0.12, 0.04);
    armL.userData.nozzle.getWorldPosition(_w4);
    fillRibbon(zipWebL, _w4, anchor, 0.12, 0.04);
    return;
  }

  // 3인칭은 몸통 좌우 어깨쯤에서
  const right = _w0.set(camera.matrixWorld.elements[0], camera.matrixWorld.elements[1], camera.matrixWorld.elements[2]).normalize();
  const cy = player.pos.y + 1.8;
  _zv2.set(player.pos.x - right.x * 0.7, cy, player.pos.z - right.z * 0.7);
  fillRibbon(zipWebL, _zv2, anchor, 0.15, 0.05);
  _zv2.set(player.pos.x + right.x * 0.7, cy, player.pos.z + right.z * 0.7);
  fillRibbon(zipWebR, _zv2, anchor, 0.15, 0.05);
}

function updateWebVisual() {
  updateZipVisual();
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
  if (firstPerson && armR.userData.nozzle) armR.userData.nozzle.getWorldPosition(s);
  else if (firstPerson) handAnchor.getWorldPosition(s);
  else s.set(player.pos.x, player.pos.y + 1.8, player.pos.z);

  const shoot = Math.min(1, web.t / 0.05);            // 발사 순간 뻗어나가는 연출
  const slack = Math.max(0, web.len - s.distanceTo(web.a));
  const sag = Math.min(3.2, slack * 0.6) + 0.3;       // 느슨하면 축 처지고 팽팽하면 일직선
  const rad = 0.038 + Math.min(0.022, player.vel.length() * 0.0006);

  // 아직 다 안 뻗은 끝점을 구해 그 지점까지만 가닥을 만든다
  _w4.copy(web.a).sub(s).multiplyScalar(shoot).add(s);
  fillRibbon(webStrand, s, _w4, sag, rad);
}

function updateCamera(dt) {
  const hsp = Math.hypot(player.vel.x, player.vel.z);

  // 그림자 카메라를 플레이어와 함께 옮긴다. 좁은 프러스텀을 유지해야 그림자가 선명하다.
  sun.target.position.set(player.pos.x, player.pos.y, player.pos.z);
  sun.position.set(player.pos.x + SUN_DIR.x * 700, player.pos.y + SUN_DIR.y * 700, player.pos.z + SUN_DIR.z * 700);
  sun.target.updateMatrixWorld();
  // 자동 모드: 진행 방향(또는 붙어 있는 벽)으로 계속 정렬.
  // 수동 모드(C)에서는 이 블록이 통째로 꺼져서 시점은 우클릭 드래그로만 움직인다.
  if (camAuto && !dragging && !firstPerson && (hsp > 3 || clinging)) {
    viewYaw = lerpAngle(viewYaw, bodyYaw, Math.min(1, 3.5 * dt));
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
    const camDist = Math.min(9.5 + hsp * 0.2, 26);
    const desired = _c0.set(
      player.renderPos.x - viewDir.x * camDist,
      player.renderPos.y + (3.0 - hug * 1.4) - viewDir.y * camDist * 0.55,
      player.renderPos.z - viewDir.z * camDist
    );
    const cl = 1 - Math.exp(-(6.5 + hug * 5.5) * dt);
    camera.position.lerp(desired, cl);
    lookTarget.lerp(_c1.set(
      player.renderPos.x + player.vel.x * 0.16,
      player.renderPos.y + 1.7 + player.vel.y * 0.05,
      player.renderPos.z + player.vel.z * 0.16
    ), 1 - Math.exp(-12 * dt));
    camera.lookAt(lookTarget);
  }

  // 뱅킹: 로프가 걸린 쪽으로 기울인다. 웹스윙 체감의 절반이 여기서 나온다.
  let targetRoll = 0;
  if (web && !clinging) {
    rightV.set(-Math.cos(viewYaw), 0, Math.sin(viewYaw));
    const ox = player.pos.x - web.a.x, oz = player.pos.z - web.a.z;
    const ol = Math.hypot(ox, oz);
    if (ol > 0.5) {
      const lat = (ox / ol) * rightV.x + (oz / ol) * rightV.z;
      targetRoll = lat * CAM_ROLL * Math.min(1, hsp / 34) * (firstPerson ? 0.65 : 1);
    }
  }
  camRoll += (targetRoll - camRoll) * Math.min(1, 5 * dt);
  if (Math.abs(camRoll) > 0.0005) camera.rotateZ(camRoll);

  // 피격 카메라 흔들림 (제곱으로 감쇠시켜 초반만 강하게)
  if (shake > 0) {
    shake = Math.max(0, shake - dt * 3.4);
    const s = shake * shake * 0.6;
    camera.position.x += (Math.random() - 0.5) * s;
    camera.position.y += (Math.random() - 0.5) * s;
    camera.position.z += (Math.random() - 0.5) * s;
  }

  // 1인칭은 몸 모델이 안 보이므로 시야 자체를 넘겨야 덤블링이 보인다. 3인칭과 같은 뒤로 넘기.
  if (firstPerson && tumbleT > 0) camera.rotateX(Math.PI * 2 * (1 - tumbleT / tumbleDur));

  const targetFov = (firstPerson ? 78 : 70)
    + Math.min(sp / MAX_SPEED, 1) * (firstPerson ? 14 : 26)
    + Math.max(dashKick, 0) * 48
    + Math.max(pumpFx, 0) * 30
    + (diving ? 8 + diveFx * 16 : 0);
  camera.fov += (targetFov - camera.fov) * Math.min(1, 5 * dt);
  camera.updateProjectionMatrix();

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

  if (firstPerson && (zip || lunge || pull)) {
    // 집라인/잡기/끌어오기 모두 "양손을 앞으로 뻗은" 같은 계열의 포즈를 쓴다.
    // ch = 1이면 힘을 모으거나 움켜쥔 상태, 0이면 완전히 뻗은 상태.
    let ch = 0;
    if (zip) ch = zip.charge > 0 ? zip.charge / ZIP_CHARGE : 0;
    else if (lunge) ch = lunge.phase === "hold" ? lunge.t / LUNGE_HOLD : 0;
    else if (pull) ch = Math.max(0, 1 - pull.t / 0.3);   // 끌어올 때는 손을 되당긴다
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
    armL.rotation.set(0.34 - ch * 0.16, -0.30, 0.46);
    armR.scale.setScalar(0.72);
    armL.scale.set(-0.72, 0.72, 0.72);   // 왼손은 거울상 유지 (setScalar면 mirror가 지워진다)
    // 줄을 쏘는 손이므로 웹슈팅 자세(검지·소지 편 채)를 유지한다
    // 잡는 순간(hold)에는 주먹을 쥐듯 움켜쥔 손, 그 외에는 웹슈팅 자세
    const grip = lunge && lunge.phase === "hold" ? 1 : 0;
    poseHand(armR, 1 - grip, grip, 0.5, 1 - ch, kf);
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
    armL.rotation.set(-0.24 + reachL * 0.12, -0.1, 0.5);
    armR.scale.setScalar(0.72);
    armL.scale.set(-0.72, 0.72, 0.72);
    poseHand(armR, 0, 1, 1, 0, kf);
    poseHand(armL, 0, 1, 1, 0, kf);
  } else {
    // 왼손: 주먹을 뻗는 동안만 보인다. 뻗기 40% / 복귀 60%로 나가는 건 빠르고 오는 건 느리다.
    if (punchT > 0 && firstPerson) {
      const k = 1 - punchT / PUNCH_TIME;                 // 0 -> 1
      const ext = k < 0.4 ? k / 0.4 : 1 - (k - 0.4) / 0.6;
      const e2 = ext * ext * (3 - 2 * ext);              // 부드럽게
      armL.visible = true;
      armL.position.set(-0.34 + e2 * 0.30 + swayX, -0.34 + e2 * 0.14 + swayY, -0.62 - e2 * 0.62);
      armL.rotation.set(0.30 - e2 * 0.30, -0.22 + e2 * 0.22, 0.40 - e2 * 0.40);
      armL.scale.set(-0.72, 0.72, 0.72);
      poseHand(armL, 0, 1, 0, 1, kf);                    // 주먹 쥔 손
    } else {
      armL.visible = false;
    }
    const armTarget = firstPerson && (web !== null || armPulse > 0) ? 1 : 0;
    armExt += (armTarget - armExt) * Math.min(1, 10 * dt);

    // 줄에 매달린 동안 팔이 앵커 쪽으로 당겨지고, 장력에 따라 미세하게 떨린다
    let tugY = 0, tugZ = 0;
    if (web) {
      const tension = THREE.MathUtils.clamp((player.pos.distanceTo(web.a) - web.len) / 6 + 0.5, 0, 1);
      tugY = Math.sin(now * 0.021) * 0.012 * tension;
      tugZ = -tension * 0.03;
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
    armR.scale.setScalar(0.72);
    armR.visible = firstPerson;
    poseHand(armR, 1, 0, 0.35 + spd * 0.65, fireKick, kf);
  }

  if (windGain) {
    const r = Math.min(sp / MAX_SPEED, 1);
    windGain.gain.value = r * r * 0.3 + diveFx * 0.35;
    windFilter.frequency.value = 250 + r * 900 + diveFx * 1400;
  }
}

const _objV = new THREE.Vector3();
function updateObjective() {
  if (!activeZone) {
    objEl.classList.add("done");
    objNameEl.textContent = "모든 구역 정화 완료";
    objCntEl.textContent = "";
    objDistEl.textContent = "";
    objProgEl.style.width = "100%";
    return;
  }
  objEl.classList.remove("done");
  objEl.classList.toggle("flash", zoneFlash > 0);
  const left = zoneRemaining(activeZone);
  const total = activeZone.total || 1;
  objNameEl.textContent = activeZone.name;
  objCntEl.textContent = "적 " + left + " / " + total;
  objProgEl.style.width = ((1 - left / total) * 100).toFixed(1) + "%";

  const dx = activeZone.cx - player.pos.x, dz = activeZone.cz - player.pos.z;
  const dist = Math.hypot(dx, dz);
  objDistEl.textContent = dist > 999 ? (dist / 1000).toFixed(1) + "km" : (dist | 0) + "m";

}

function updateCrosshair() {
  // 1인칭 조준점은 항상 화면 정중앙. 매 프레임 강제해서 어떤 경로로도 밀리지 않게 한다.
  if (firstPerson) {
    crosshairEl.style.left = "50%";
    crosshairEl.style.top = "50%";
  }
  // 히트마커는 조준점 위치를 그대로 따라간다 (3인칭은 커서를 따라가므로)
  hitmarkEl.style.left = crosshairEl.style.left || "50%";
  hitmarkEl.style.top = crosshairEl.style.top || "50%";
  if (hitMark > 0) {
    const k = hitMark / 0.17;            // 1 -> 0
    hitmarkEl.style.opacity = Math.min(1, k * 1.6);
    // 살짝 벌어지면서 사라진다
    hitmarkEl.style.transform = `translate(-50%,-50%) scale(${1.5 - k * 0.5})`;
    for (const arm of hitmarkEl.children) arm.style.background = hitKill ? "#ff4d4d" : "#fff";
  } else {
    hitmarkEl.style.opacity = 0;
  }

  // 공격 모드에서는 조준점을 붉게 유지 (거미줄 미리보기는 끈다)
  if (attackMode) {
    aimMark.visible = false;
    crosshairEl.style.borderColor = "rgba(255,96,96,0.95)";
    return;
  }

  // 부착과 완전히 같은 함수로 미리보기를 뽑는다. 마커가 거짓말하지 않는다.
  // resolveAnchor는 전체 레이캐스트라 한 번에 0.88ms다. 마커는 몇 프레임 늦어도 안 보인다.
  if (web) aimPreview = null;
  else if (--aimTick <= 0) { aimTick = 5; aimPreview = resolveAnchor(); }
  if (aimPreview && !web) {
    // 사거리 안 + 걸 수 있음 -> 초록
    aimMark.visible = true;
    aimMark.position.copy(aimPreview);
    aimMark.scale.setScalar(1 + Math.sin(performance.now() * 0.006) * 0.12);
    crosshairEl.style.borderColor = "rgba(120,255,140,0.95)";
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
const ammoNumEl = document.getElementById("ammoNum");
const ammoBarEl = document.querySelector("#ammoBar i");
const reloadMsgEl = document.getElementById("reloadMsg");
const skModeEl = document.getElementById("skMode");
const skBindEl = document.getElementById("skBind");
const skDashEl = document.getElementById("skDash");
const skLungeEl = document.getElementById("skLunge");
const skPullEl = document.getElementById("skPull");
const kickCueEl = document.getElementById("kickCue");
const ultNumEl = document.getElementById("ultNum");
const ultRingEl = document.getElementById("ultRing");
const hpSegEls = Array.from(document.getElementById("hpBar").children);
const hpNumEl = document.getElementById("hpNum");
const stamBarEl = document.getElementById("stamFill");
const objEl = document.getElementById("objective");
const objNameEl = document.getElementById("objName");
const objCntEl = document.getElementById("objCount");
const objDistEl = document.getElementById("objDist");
const objProgEl = document.getElementById("objProg");
// --- 스파이더 센스: 화면을 중앙 기준 8분할해 위협 방향을 옅게 밝힌다 ---
// 화살표 하나는 "목표"밖에 못 알려준다. 방향 감각은 시야 전체로 오는 게 맞다.
const SENSE_R = 150;          // 이 안의 적만 감지
const SENSE_N = 8;
const senseWrap = document.getElementById("spiderSense");
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
      senseWrap.appendChild(d);
      arr.push(d);
    }
  }
}
// 부드럽게 켜지고 꺼지도록 현재 밝기를 따로 들고 간다 (매 프레임 튀면 깜빡인다)
const senseFoeLv = new Array(SENSE_N).fill(0);
const senseObjLv = new Array(SENSE_N).fill(0);
const _snF = new THREE.Vector3();

// 카메라 정면 기준 수평 방위를 8조각 중 하나로 (0 = 정면, 2 = 오른쪽, 4 = 뒤)
function senseSector(tx, tz) {
  camera.getWorldDirection(_snF);
  const fa = Math.atan2(_snF.x, _snF.z);
  const ta = Math.atan2(tx, tz);
  let d = fa - ta;          // 화면 좌우와 부호가 반대라 뒤집는다
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  const idx = Math.round(d / (Math.PI * 2 / SENSE_N));
  return ((idx % SENSE_N) + SENSE_N) % SENSE_N;
}

function updateSense(k) {
  const foe = senseFoeLv.map(() => 0);
  const obj = senseObjLv.map(() => 0);
  for (const e of enemies) {
    if (e.dead) continue;
    const tx = e.g.position.x - player.pos.x, tz = e.g.position.z - player.pos.z;
    const dy = e.g.position.y - player.pos.y;
    const dist = Math.sqrt(tx * tx + tz * tz + dy * dy);
    if (dist > SENSE_R) continue;
    // 가까울수록, 그리고 조준 중인 적은 더 세게
    let v = 1 - dist / SENSE_R;
    v *= v;
    if (e.aimT > 0) v = Math.min(1, v * 2.2 + 0.25);   // 나를 조준 중이면 확실히
    const i = senseSector(tx, tz);
    if (v > foe[i]) foe[i] = v;
  }
  if (activeZone) {
    const i = senseSector(activeZone.cx - player.pos.x, activeZone.cz - player.pos.z);
    obj[i] = 1;
  }
  for (let i = 0; i < SENSE_N; i++) {
    senseFoeLv[i] += (foe[i] - senseFoeLv[i]) * k;
    senseObjLv[i] += (obj[i] - senseObjLv[i]) * k;
    senseFoe[i].style.opacity = (senseFoeLv[i] * 0.5).toFixed(3);
    senseObj[i].style.opacity = (senseObjLv[i] * 0.3).toFixed(3);
  }
}
const stamWrapEl = document.getElementById("stamBar");
const hurtEl = document.getElementById("hurt");
const deadEl = document.getElementById("deadMsg");

// 쿨타임을 버튼 아래에서 차오르는 게이지로. left=남은비율(1이면 꽉 참=사용 불가)
function setCd(el, left) {
  const cd = el.firstElementChild;
  cd.style.height = `${Math.max(0, Math.min(1, left)) * 100}%`;
  el.classList.toggle("ready", left <= 0);
}

let ultFake = 0;      // 궁극기 자체는 아직 없지만 게이지는 실제 처치로 찬다
function updateHud(dtReal) {
  // 체력: 칸 단위로 꺼진다. 오버워치식으로 남은 칸만 밝게.
  for (let i = 0; i < hpSegEls.length; i++) {
    const el = hpSegEls[i];
    el.classList.toggle("off", i >= hp);
    // 지금 차오르는 중인 칸 하나만 반쯤 켜서 회복 중임을 보여준다
    const filling = i === hp && regenWait <= 0 && hp < MAX_HP;
    el.classList.toggle("regen", filling);
    if (filling) el.style.opacity = 0.25 + (regenT / REGEN_TIME) * 0.6;
    else el.style.opacity = "";
  }
  hpNumEl.textContent = `${hp * 25} / ${MAX_HP * 25}`;
  hpNumEl.classList.toggle("low", hp <= 2);
  // 스태미나 — 초록 막대. 바닥나면 붉게 번쩍여서 이유를 바로 알 수 있게.
  stamBarEl.style.width = (stam / MAX_STAM * 100).toFixed(1) + "%";
  stamWrapEl.classList.toggle("empty", stamEmpty);
  stamWrapEl.classList.toggle("flash", stamFx > 0);

  updateObjective();
  updateSwingPreview();
  if (touchMode && window.__touchCd) window.__touchCd();
  updateSense(Math.min(1, 6 * dtReal));

  hurtEl.style.opacity = Math.max(0, Math.min(1, hurtFx)) * 0.85;
  deadEl.classList.toggle("show", deadT > 0);

  // 탄창
  ammoNumEl.textContent = reloadT > 0 ? "· · ·" : `${ammo}`;
  ammoNumEl.classList.toggle("low", reloadT <= 0 && ammo <= MAG_SIZE * 0.25);
  ammoBarEl.style.width = `${(reloadT > 0
    ? 1 - reloadT / RELOAD_TIME       // 재장전 중에는 차오르는 게이지로 진행도를 보여준다
    : ammo / MAG_SIZE) * 100}%`;
  reloadMsgEl.textContent = reloadT > 0 ? "재장전 중" : (ammo === 0 ? "V 재장전" : "");

  // 스킬 쿨타임
  setCd(skBindEl, bindCd / BIND_CD);
  setCd(skDashEl, hasDash && dashTimer <= 0 ? 0 : Math.max(dashTimer / DASH_CD, hasDash ? 0 : 1));
  setCd(skModeEl, 0);
  skModeEl.classList.toggle("on", attackMode);
  setCd(skLungeEl, lungeCd / LUNGE_CD);
  setCd(skPullEl, pullCd / PULL_CD);
  // 발차기 입력 창 — 타이밍 게임이라 화면에 크게 알려야 한다
  kickCueEl.classList.toggle("show", kickOpen);

  // 궁극기(표시용)
  ultFake = Math.min(1, ultFake + dtReal * 0.004);
  ultRingEl.classList.toggle("ready", ultFake >= 1);
  ultRingEl.style.setProperty("--ult", `${(ultFake * 100).toFixed(0)}%`);
  ultNumEl.textContent = `${Math.round(ultFake * 100)}%`;
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
  last = now;
  // 히트스톱: 명중 순간 시뮬레이션만 멈춘다 (렌더는 계속 -> 타격이 "박히는" 느낌)
  if (hitStop > 0) {
    hitStop -= realDt;
  } else {
    acc += realDt;
    while (acc >= DT) {
      update(DT);
      acc -= DT;
    }
  }
  // 렌더 시각은 보통 물리 스텝 사이에 걸린다. 그 사이를 메워야 화면이 매끄럽다.
  player.renderPos.lerpVectors(player.prevPos, player.pos, Math.min(1, acc / DT));
  spiderGroup.position.copy(player.renderPos);
  // 차량은 프레임당 한 번만 갱신한다. 물리 스텝마다 돌리면 2,825대 x 2메시의
  // 인스턴스 버퍼를 초당 수십 번 통째로 GPU에 올려 프레임이 끊긴다.
  updateCars(realDt);
  updateCamera(Math.min(0.05, (frame.prev ? now - frame.prev : 16) / 1000));
  frame.prev = now;
  skyMesh.position.copy(camera.position);
  updateWebVisual();
  updateCrosshair();
  updateHud(realDt);
  if (camMsg > 0) camMsg -= 1 / 60;
  if (toastT > 0) toastT -= 1 / 60;
  if (climbFx > 0) climbFx -= 1 / 60;
  const camLabel = camAuto ? "CAM 자동" : "CAM 수동";
  speedEl.textContent =
    `${Math.round(player.vel.length() * 3.6)} km/h · DASH ${hasDash ? "READY" : `${Math.max(dashTimer, 0).toFixed(1)}s`}`
    + ` · ${camLabel}${camMsg > 0 ? " ←" : ""}`
    + (attackMode ? `  ⚔ 공격모드 · 적 ${enemies.length}` : `  적 ${enemies.length} (TAB=공격모드)`)
    + (combo > 1 ? `  ${combo} COMBO` : "")
    + (toastT > 0 ? `   ▸ ${toast}` : "")
    + (clinging ? (sliding ? "  [벽: 미끄러지는 중 · Ctrl로 붙잡기]" : "  [벽타기: WASD로 이동]") : "");
  pumpEl.style.opacity = Math.min(1, Math.max(pumpFx, 0) * 6);
  // 급강하 연출: 목표치로 서서히 붙였다 빠진다. 즉시 켜고 끄면 화면이 깜빡인다.
  diveFx += ((diving ? 1 : 0) - diveFx) * Math.min(1, 5 * (1 / 60));
  linesEl.style.opacity = Math.min(0.95,
    (player.vel.length() / MAX_SPEED) * 0.45
    + (pumpFx > 0 ? 0.35 : 0)
    + (dashKick > 0 ? 0.4 : 0)
    + diveFx * 0.55);
  diveEl.style.opacity = (diveFx * 0.85).toFixed(3);
  if (diveFx > 0.02) {
    // 아래로 흐르는 줄무늬. 속도가 빠를수록 빨리 흐른다.
    diveEl.style.backgroundPositionY = ((performance.now() * (0.4 + player.vel.length() * 0.012)) % 1000) + "px";
  }
  renderer.render(scene, camera);
}
spawnEnemies(220);
// 적 배치가 끝난 뒤에 구역을 배정하고 첫 목표를 정한다
for (const e of enemies) { e.zone = zoneOf(e.g.position.x, e.g.position.z); e.zone.total++; }
pickZone();
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
    else if (act === 'mode') { attackMode = !attackMode; camMsg = 1.6;
      if (attackMode) { releaseWeb(); zip = null; } }
    else if (act === 'jump') keys['Space'] = true;
    else if (act === 'dash') { keys['ShiftLeft'] = true; }
    else if (act === 'help') hudEl.classList.toggle('show');
    else if (act === 'lunge') fireGrab();
    else if (act === 'pull') firePull();
    else if (act === 'bind') fireBind();      // 터치엔 모드가 없다 — 바로 나간다
    else if (act === 'ult') fireUlt();
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
    ['btnQ', () => 1 - ultFake],
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
      if (lookIdle > CAM_RETURN && !camAuto) { camAuto = true; camMsg = 1.2; }
    }
    if (modeEl) modeEl.classList.toggle('on2', attackMode);
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

window.__dbg = { scene, camera, renderer, PBR, cityMeshes, ground, sidewalkMesh, buildings, groundAt: groundHeightAt, blocks, AVE_SPACING, ST_SPACING, AVE_ROAD_W, ST_ROAD_W, cars, player, updateCars, carBodyMesh, resolveAnchor, armR, armL, webStrand, get web(){ return web; }, get zip(){ return zip; }, tryZip, setNight, get night(){ return night; }, get streetDetailCount(){ return streetDetailCount; }, get lunge(){ return lunge; }, get pull(){ return pull; }, get attackMode(){ return attackMode; }, get kickOpen(){ return kickOpen; }, get punchT(){ return punchT; }, get hoverT(){ return hoverT; }, get diving(){ return diving; }, punch, get lungeCd(){ return lungeCd; }, get pullCd(){ return pullCd; }, fireGrab, firePull, tryKick, findZipAnchor, get toast(){ return toastT > 0 ? toast : ""; }, enemies, eProjectiles, get hp(){ return hp; }, get stam(){ return stam; }, zones, get activeZone(){ return activeZone; }, fireUlt, get ultRing(){ return ultRing; }, senseFoeLv, senseObjLv, senseSector, SENSE_R, E_TYPES, ULT_R, get ult(){ return ultFake; }, setUlt(v){ ultFake = v; }, get zonesCleared(){ return zonesCleared; }, zoneRemaining, pickZone, get stamEmpty(){ return stamEmpty; }, MAX_STAM, damagePlayer, get deadT(){ return deadT; }, E_SIGHT, E_RANGE, E_AIM, E_ACTIVE, updateEnemyAI, get lampCount(){ return lampCount; } };
