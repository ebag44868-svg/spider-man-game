// 절차적 텍스처. 이미지 파일 없이 캔버스에 그려서 THREE.CanvasTexture로 만든다.
//
// game3d.js에서 그대로 옮겨온 코드다. 내용은 한 줄도 바꾸지 않았다.
// 게임 상태는 만지지 않고, renderer는 anisotropy 상한을 읽는 데만 쓴다.
// 그 renderer를 import하면 game3d.js와 순환 참조가 되므로,
// game3d.js가 renderer를 만든 직후 setTextureRenderer()로 넘겨준다.
//
// 주의: makeFacadeTexture / makeConcreteFacadeTexture / makeConcreteTexture 셋은
// 현재 호출되는 곳이 없다 (PBR 텍스처 로딩으로 대체됐다). 이번 단계는 "옮기기"만
// 하므로 지우지 않고 그대로 뒀다.
//
// makeAsphaltTexture 는 game3d.js에 남겼다. 그것만 WORLD_SIZE / ASPHALT_TILE 을
// 참조하는데 두 상수는 game3d.js의 다른 곳에서도 쓰여 같이 옮길 수 없다.
// 죽은 코드를 옮기자고 상수 배선을 새로 만들 이유가 없다.

// 브라우저는 importmap으로 "three"를 이 파일로 보낸다. 여기서는 상대경로를 직접 쓴다 —
// 테스트 하네스(Node)에는 importmap이 없고, 어차피 같은 파일로 해석되어 인스턴스도 하나다.
import * as THREE from "../lib/three.module.js";

let renderer = null;
// game3d.js가 renderer를 만든 직후 한 번 불러준다. 순환 import를 피하려는 것.
function setTextureRenderer(r) { renderer = r; }

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

// ---------------------------------------------------------------------------
// 사진 기반 PBR 텍스처 (Poly Haven CC0). 위쪽 절차적 텍스처와 달리 파일을 읽는다.
// game3d.js에서 그대로 옮겨왔고 내용은 한 줄도 바꾸지 않았다.
// ---------------------------------------------------------------------------

// --- Poly Haven CC0 PBR 텍스처 ---
// 캔버스로 그린 그림 대신 사진 기반 albedo/normal/roughness를 쓴다.
// normal map이 있어야 1인칭에서 벽에 붙었을 때 표면 요철이 빛을 받아 살아난다.
const texLoader = new THREE.TextureLoader();

// 파일이 없으면 fallback 텍스처의 이미지를 같은 텍스처 객체에 밀어넣는다.
// 슬롯만 등록해 두고 파일은 나중에 넣어도 화면이 깨지지 않게 하기 위한 장치다.
function loadPbr(name, srgb = true, fallback) {
  const t = texLoader.load(`assets/textures/${name}.jpg`, undefined, undefined, () => {
    if (!fallback) return;
    console.warn(`[텍스처 없음] ${name}.jpg → ${fallback}.jpg 로 대체`);
    texLoader.load(`assets/textures/${fallback}.jpg`, (f) => {
      t.image = f.image;
      t.needsUpdate = true;
    });
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities ? renderer.capabilities.getMaxAnisotropy() : 1;
  return t;
}

// 같은 재질을 여러 번 만들지 않도록 한 번만 읽어 캐시한다
function pbrSet(base, fallback) {
  return {
    map: loadPbr(`${base}_diff`, true, fallback && `${fallback}_diff`),
    normalMap: loadPbr(`${base}_nor`, false, fallback && `${fallback}_nor`),
    roughnessMap: loadPbr(`${base}_rough`, false, fallback && `${fallback}_rough`),
  };
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

export {
  makeFacadeTexture,
  makeGlassTexture,
  makeConcreteFacadeTexture,
  makeIndustrialTexture,
  makeConcreteTexture,
  makeWebStrandTexture,
  makeWebGloveTexture,
  setTextureRenderer,
  worldScaleUv, loadPbr, pbrSet,
};
