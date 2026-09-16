// 3인칭 캐릭터에 스파이더맨 수트를 코드로 입힌다.
//
// 모델(미시모 Beta)은 몸 전체가 메시 두 개(살 + 관절 패드)뿐이고 텍스처가 없다.
// 그래서 "가슴만 빨강" 같은 걸 재질로는 못 나눈다. 대신 셰이더에서 **뼈가 움직이기
// 전 좌표(바인드 포즈)**를 보고 부위를 가른다. 그 좌표는 정점마다 고정이라 팔을
// 아무리 휘둘러도 무늬가 몸에서 미끄러지지 않는다.
//
// 부위 경계는 눈대중이 아니라 **뼈 위치**에서 가져온다 — 목·허리·어깨·무릎·발목.
// 모델을 바꿔도 뼈 이름만 같으면 그대로 맞는다.
import * as THREE from "../lib/three.module.js";

const RED = new THREE.Color(0xc21020);
const BLUE = new THREE.Color(0x14307e);

const VERT_HEAD = `
uniform mat4 uToRoot;
varying vec3 vSuit;
`;
const VERT_BODY = `
  vSuit = (uToRoot * vec4(position, 1.0)).xyz;
`;
const FRAG_HEAD = `
uniform vec3 uRed, uBlue;
uniform float uWaistY, uBootY, uArmX, uChestY, uChestR, uEyeY, uHeadR, uFace, uWebN, uWebW;
varying vec3 vSuit;

// 얼굴 쪽인가 (모델이 바라보는 방향 = uFace)
float faceSide(vec3 b) { return b.z * uFace; }
`;
const FRAG_BODY = `
{
  vec3 b = vSuit;
  bool arm = abs(b.x) > uArmX;
  // 빨강: 머리 · 가슴 · 팔 · 부츠 / 파랑: 배 · 골반 · 다리
  vec3 sc = (b.y > uWaistY || arm || b.y < uBootY) ? uRed : uBlue;
  float red = (b.y > uWaistY || arm || b.y < uBootY) ? 1.0 : 0.0;

  // 거미줄 — 세 방향 격자의 선. 빨간 면에만 넣는다 (원작이 그렇다).
  vec3 w = fract(b * uWebN) - 0.5;
  float d = min(min(abs(w.x), abs(w.y)), abs(w.z));
  float line = (1.0 - smoothstep(uWebW, uWebW * 2.4, d)) * red;
  sc = mix(sc, sc * 0.18, line * 0.85);

  // 가슴·등의 거미 문양
  float emR = uChestR * 1.15;
  float ex = b.x / emR;
  float ey = (b.y - uChestY) / emR;
  float rr = length(vec2(ex, ey * 1.05));
  if (rr < 1.15) {
    float bodyDot = 1.0 - smoothstep(0.30, 0.38, rr);
    float ang = atan(ey, ex);
    float ray = (1.0 - smoothstep(0.10, 0.22, abs(sin(ang * 4.0))))
              * smoothstep(0.26, 0.34, rr) * (1.0 - smoothstep(0.95, 1.12, rr));
    sc = mix(sc, vec3(0.02, 0.02, 0.03), clamp(bodyDot + ray, 0.0, 1.0));
  }

  // 눈 — 얼굴 쪽에만. 바깥이 살짝 올라간 눈매.
  if (faceSide(b) > uHeadR * 0.12 && b.y > uEyeY - uHeadR && b.y < uEyeY + uHeadR) {
    float hx = b.x / uHeadR;
    float hy = (b.y - uEyeY) / uHeadR;
    vec2 e = vec2(abs(hx) - 0.42, hy - (abs(hx) - 0.42) * 0.3);
    float ed = length(e * vec2(1.0, 1.85));
    float white = 1.0 - smoothstep(0.30, 0.36, ed);
    float rim = (1.0 - smoothstep(0.40, 0.46, ed)) - white;
    sc = mix(sc, vec3(0.90, 0.92, 0.95), white);
    sc = mix(sc, vec3(0.02), clamp(rim, 0.0, 1.0));
  }

  diffuseColor.rgb = sc;
}
`;

// 뼈 하나를 이름 끝으로 찾는다 (mixamorig: 접두사가 붙어 있다)
function findBone(root, suffix) {
  let hit = null;
  root.traverse(o => { if (!hit && o.isBone && o.name.endsWith(suffix)) hit = o; });
  return hit;
}

// 캐릭터 루트에 수트를 입힌다. 뼈를 못 찾으면 아무것도 안 하고 false.
function applySuit(root, opts = {}) {
  root.updateMatrixWorld(true);
  const _v = new THREE.Vector3();
  const inRoot = b => { b.getWorldPosition(_v); return root.worldToLocal(_v.clone()); };

  const neck = findBone(root, "Neck"), head = findBone(root, "Head");
  const spine1 = findBone(root, "Spine1") || findBone(root, "Spine");
  const arm = findBone(root, "LeftArm") || findBone(root, "RightArm");
  const knee = findBone(root, "LeftLeg") || findBone(root, "RightLeg");
  const ankle = findBone(root, "LeftFoot") || findBone(root, "RightFoot");
  if (!neck || !head || !spine1 || !arm || !knee || !ankle) return false;

  const pNeck = inRoot(neck), pHead = inRoot(head), pSpine = inRoot(spine1);
  const pArm = inRoot(arm), pKnee = inRoot(knee), pAnkle = inRoot(ankle);
  const headR = Math.max(0.06, (pNeck.y - pHead.y) === 0 ? 0.12 : Math.abs(pHead.y - pNeck.y) * 1.6);

  // 팔 판정 기준은 어깨보다 넓어야 한다. 어깨폭을 그대로 쓰면 허벅지·골반까지 팔로 잎혀
  // 하체가 통째로 빨간색이 된다 (실측: 빨강 86%). 몸통의 실제 최대 폭을 재서 그보다 바깥만 팔로 본다.
  let bodyMaxX = Math.abs(pArm.x);
  let loY = Infinity, hiY = -Infinity;
  root.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) { const y = a.getY(i); if (y < loY) loY = y; if (y > hiY) hiY = y; }
  });
  const armBandY = loY + (hiY - loY) * 0.70;         // 이 아래는 몸통·다리다
  root.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const a = o.geometry.attributes.position;
    for (let i = 0; i < a.count; i += 2) {
      if (a.getY(i) < armBandY) bodyMaxX = Math.max(bodyMaxX, Math.abs(a.getX(i)));
    }
  });

  const u = {
    uRed: { value: (opts.red || RED).clone() },
    uBlue: { value: (opts.blue || BLUE).clone() },
    uWaistY: { value: pSpine.y },                                  // 이 위는 빨강
    uBootY: { value: pAnkle.y + (pKnee.y - pAnkle.y) * 0.5 },      // 이 아래는 부츠(빨강)
    uArmX: { value: bodyMaxX * 1.12 },                             // 이 바깥은 팔(빨강)
    uChestY: { value: (pSpine.y + pNeck.y) * 0.5 },
    uChestR: { value: Math.max(0.08, Math.abs(pArm.x) * 0.85) },
    uEyeY: { value: pHead.y + headR * 0.35 },
    uHeadR: { value: headR },
    uFace: { value: opts.face === undefined ? 1 : opts.face },      // 모델이 바라보는 z 방향
    uWebN: { value: opts.webN === undefined ? 9 : opts.webN },      // 거미줄 격자 밀도
    uWebW: { value: opts.webW === undefined ? 0.035 : opts.webW },  // 선 굵기
  };

  const toRoot = new THREE.Matrix4();
  const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  let n = 0;
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    o.updateWorldMatrix(true, false);
    toRoot.copy(rootInv).multiply(o.matrixWorld);
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const out = mats.map(src => {
      const m = new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.62, metalness: 0.05,
        skinning: src.skinning, side: src.side,
      });
      m.userData.suit = true;
      m.onBeforeCompile = (sh) => {
        sh.uniforms.uToRoot = { value: toRoot.clone() };
        for (const k of Object.keys(u)) sh.uniforms[k] = u[k];
        sh.vertexShader = VERT_HEAD + sh.vertexShader.replace(
          "#include <begin_vertex>", "#include <begin_vertex>\n" + VERT_BODY);
        sh.fragmentShader = FRAG_HEAD + sh.fragmentShader.replace(
          "#include <color_fragment>", "#include <color_fragment>\n" + FRAG_BODY);
      };
      m.customProgramCacheKey = () => "suit";
      return m;
    });
    o.material = Array.isArray(o.material) ? out : out[0];
    n++;
  });
  if (!n) return false;
  // 값을 돌려준다 — 화면으로 확인하기 어려운 경계를 숫자로 볼 수 있어야 한다.
  const info = { meshes: n };
  for (const k of Object.keys(u)) info[k] = u[k].value.isColor ? u[k].value.getHexString() : u[k].value;
  return info;
}

export { applySuit, RED, BLUE };
