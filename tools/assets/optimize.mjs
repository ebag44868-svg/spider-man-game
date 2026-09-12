// 고른 에셋을 게임용으로 깎는다.
//
// 원본은 웹 게임에 넣을 수 없는 크기다 — 소화전 하나가 8만 삼각형에 4096 텍스처,
// 에어컨 실외기 하나가 7만 6천 삼각형이다. 도시에 수백~수천 개를 깔아야 하므로
// 종류당 수백~천오백 삼각형, 텍스처 512 로 줄인다.
//
// 처리 순서 (에셋마다)
//   1. 계층을 풀고 월드 변환을 정점에 굽는다   — 인스턴싱하려면 메시 하나여야 한다
//   2. 같은 재질끼리 합친다 (join)            — 종류당 드로우콜을 줄인다
//   3. 실제 크기(미터)로 맞추고 바닥을 y=0 에   — 원본 단위가 제각각이다 (cm, m, 임의)
//   4. 정점 병합 후 목표 삼각형 수로 단순화
//   5. 텍스처를 512 webp 로
//   6. 텍스처 없는 흰 재질엔 뉴욕다운 색을 칠한다
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
  dedup, prune, weld, unweld, normals, simplify, join, flatten, getBounds,
  transformMesh, textureCompress, resample, unpartition,
} from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import sharp from "sharp";
import { mat4 } from "gl-matrix";
import fs from "node:fs";
import path from "node:path";

const GLB = "C:/spider_assets_raw/_glb";
const OUT = "C:/Users/SAMSUNG/OneDrive/Desktop/spider man/assets/models/nyc";
fs.mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

// fit: 어느 축을 몇 미터로 맞출지 ('y' 높이 / 'long' 가장 긴 수평축)
// tris: 목표 삼각형 수 (원본보다 크면 그대로)
// color: 텍스처 없는 흰 재질에만 칠한다
const LIST = [
  // ── 옥상 ──
  { name: "water_tower", src: "water_tower_gltf_scene", fit: ["y", 7.0], tris: 1800, tex: 512 },
  // 옥상 실외기는 멀리서만 보인다. 텍스처를 버리고 회색 덩어리로 — 대신 삼각형을 크게 줄인다
  // 오차 0.2 로 700 삼각형까지 깎았더니 면이 날아가 속이 빈 상자처럼 부서졌다. 덜 깎고 양면으로.
  { name: "ac_unit", src: "air_conditioner_gltf_scene", fit: ["y", 1.2], tris: 2200, error: 0.05, strip: true, dropTex: true, doubleSided: true, color: [0.46, 0.48, 0.5] },
  // ── 인도 ──
  { name: "street_light", src: "stylized_street_light_gltf_scene", fit: ["y", 9.0], tris: 1600, tex: 512 },
  { name: "hydrant", src: "fbx2_fbx_sm_firehydrant", fit: ["y", 0.85], tris: 700, color: [0.78, 0.16, 0.13] },
  { name: "trash_bin", src: "fbx2_fbx_sm_trash_bin", fit: ["y", 0.95], tris: 600, color: [0.17, 0.27, 0.21], error: 0.15, strip: true },
  { name: "mailbox", src: "fbx2_fbx_sm_mailbox", fit: ["y", 1.25], tris: 600, color: [0.11, 0.24, 0.55] },
  // 원본은 가판대가 아니라 바닥에 쌓인 신문 뭉치였다. 1.1m 로 늘리니 거대해져서 뭉치 크기로 둔다
  { name: "newspapers", src: "fbx2_fbx_sm_newspaper", fit: ["long", 0.55], tris: 500, error: 0.08, color: [0.82, 0.8, 0.74] },
  { name: "bench", src: "street_wooden_bench_scene", fit: ["long", 1.8], tris: 1400, tex: 512 },
  { name: "bus_stop", src: "busstop_shelter_a_fbx_busstop_shelter_a_fbx_busstop_shelter_a", fit: ["y", 2.6], tris: 1500, color: [0.28, 0.31, 0.35], error: 0.15, strip: true },
  { name: "dumpster", src: "dumpsters_fbx_dumpsters_fbx", fit: ["y", 1.45], tris: 1600, color: [0.16, 0.34, 0.22], error: 0.2, strip: true },
  { name: "trash_bag_a", src: "pallets_and_rubbish_bags_meshes_sm_rubbish_bug_1t", fit: ["y", 0.62], tris: 500, color: [0.06, 0.06, 0.07] },
  { name: "trash_bag_b", src: "pallets_and_rubbish_bags_meshes_sm_rubbish_bug_2t", fit: ["y", 0.55], tris: 500, color: [0.06, 0.06, 0.07] },
  // ── 차도 ──
  { name: "manhole", src: "fbx2_fbx_sm_manhole_02", fit: ["long", 0.95], tris: 512, color: [0.16, 0.16, 0.17] },
  // ── 차 ── (길이를 기존 차 상자 4.6m 에 맞춘다)
  { name: "car_taxi", src: "freeamericansedanshm_assets_taxi_stylized", fit: ["long", 4.7], tris: 900, error: 0.2, strip: true },
  { name: "car_sedan", src: "freeamericansedanshm_assets_car_stylized", fit: ["long", 4.7], tris: 900, error: 0.2, strip: true },
  { name: "car_police", src: "freeamericansedanshm_assets_police_stylized", fit: ["long", 4.7], tris: 900, error: 0.2, strip: true },
];

function triCount(doc) {
  let t = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices(), pos = p.getAttribute("POSITION");
    if (pos) t += Math.floor((idx ? idx.getCount() : pos.getCount()) / 3);
  }
  return t;
}

// 모든 메시 노드의 월드 변환을 정점에 굽고, 노드는 장면 바로 아래 항등 변환으로 둔다
function bakeTransforms(doc) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const used = new Set();
  const meshNodes = [];
  scene.traverse(n => { if (n.getMesh()) meshNodes.push(n); });
  for (const n of meshNodes) {
    let mesh = n.getMesh();
    if (used.has(mesh)) { mesh = mesh.clone(); n.setMesh(mesh); }   // 공유 메시는 복제해서 따로 굽는다
    used.add(mesh);
    const wm = n.getWorldMatrix();
    transformMesh(mesh, wm);
  }
  // 새 장면: 메시 노드만 항등 변환으로
  const fresh = doc.createScene("baked");
  for (const n of meshNodes) {
    const nn = doc.createNode(n.getName()).setMesh(n.getMesh());
    fresh.addChild(nn);
  }
  for (const s of root.listScenes()) if (s !== fresh) s.dispose();
  root.setDefaultScene(fresh);
}

function fitSize(doc, fit) {
  const scene = doc.getRoot().getDefaultScene();
  const b = getBounds(scene);
  const sx = b.max[0] - b.min[0], sy = b.max[1] - b.min[1], sz = b.max[2] - b.min[2];
  const cur = fit[0] === "y" ? sy : Math.max(sx, sz);
  const k = cur > 1e-6 ? fit[1] / cur : 1;
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
  // 가운데를 원점으로, 바닥을 y=0 으로, 그리고 크기를 맞춘다
  const m = mat4.create();
  mat4.scale(m, m, [k, k, k]);
  mat4.translate(m, m, [-cx, -b.min[1], -cz]);
  for (const mesh of doc.getRoot().listMeshes()) transformMesh(mesh, m);
  const nb = getBounds(scene);
  return nb.max.map((v, i) => +(v - nb.min[i]).toFixed(2));
}

const report = [];
for (const it of LIST) {
  const srcPath = path.join(GLB, it.src + ".glb");
  if (!fs.existsSync(srcPath)) { console.log(`없음: ${it.src}`); continue; }
  const doc = await io.read(srcPath);
  const before = triCount(doc);

  await doc.transform(unpartition(), flatten());
  bakeTransforms(doc);
  await doc.transform(dedup(), join({ keepNamed: false }), prune());
  const size = fitSize(doc, it.fit);

  // strip: UV·노멀을 떼고 위치만으로 정점을 합친다.
  // 단순화가 목표에 못 미친 이유가 이것이었다 — UV 경계와 노멀이 갈라진 모서리에서는
  // 같은 위치의 정점이 여러 개라 합칠 수가 없고, 거기서 단순화가 멈춘다.
  if (it.strip) {
    if (it.dropTex) {
      for (const mat of doc.getRoot().listMaterials()) {
        mat.setBaseColorTexture(null); mat.setNormalTexture(null); mat.setOcclusionTexture(null);
        mat.setMetallicRoughnessTexture(null); mat.setEmissiveTexture(null);
        mat.setBaseColorFactor([1, 1, 1, 1]);          // 아래 색칠 단계에서 칠해지게 흰색으로
      }
    }
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
      const mat = prim.getMaterial();
      const needUV = mat && (mat.getBaseColorTexture() || mat.getNormalTexture());
      for (const sem of prim.listSemantics()) {
        if (sem === "NORMAL" || sem === "TANGENT" || (!needUV && sem.startsWith("TEXCOORD")) || sem.startsWith("COLOR")) {
          const acc = prim.getAttribute(sem); prim.setAttribute(sem, null);
          if (acc && acc.listParents().length <= 1) acc.dispose();
        }
      }
    }
    await doc.transform(prune());
  }
  await doc.transform(weld());
  const now = triCount(doc);
  if (now > it.tris) {
    const ratio = Math.max(0.005, it.tris / now);
    await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio, error: it.error || 0.02, lockBorder: false }));
  }

  // 떼어낸 노멀을 각진(flat) 노멀로 다시 만든다. 부드러운 노멀은 합쳐진 모서리에서
  // 로우폴리가 녹아내린 덩어리처럼 보인다. 도시가 원래 각진 느낌이라 이쪽이 맞는다.
  if (it.strip) await doc.transform(unweld(), normals({ overwrite: true }));

  // 텍스처 없는 재질에 색.
  //
  // 처음엔 "흰색(0.85 이상)일 때만" 칠했다. 그런데 원본 재질이 옅은 회색(0.8)이라 조건에
  // 안 걸려서 쓰레기통·버스정류장이 하얗게 나왔다. 이제 color 가 지정된 에셋은 텍스처 없는
  // 재질을 전부 칠한다 — 삼각형이 가장 많은 재질(=몸통)은 지정색, 나머지(=부속)는 한 톤 어둡게.
  let painted = 0;
  if (it.color) {
    const trisOf = new Map();
    for (const mesh of doc.getRoot().listMeshes()) for (const prim of mesh.listPrimitives()) {
      const m = prim.getMaterial(); if (!m) continue;
      const idx = prim.getIndices(), pos = prim.getAttribute("POSITION");
      trisOf.set(m, (trisOf.get(m) || 0) + Math.floor((idx ? idx.getCount() : pos.getCount()) / 3));
    }
    let body = null;
    for (const [m, t] of trisOf) if (!body || t > trisOf.get(body)) body = m;
    for (const mat of doc.getRoot().listMaterials()) {
      if (mat.getBaseColorTexture()) continue;
      const k = mat === body ? 1 : 0.55;
      mat.setBaseColorFactor([it.color[0] * k, it.color[1] * k, it.color[2] * k, 1]);
      mat.setRoughnessFactor(0.7); mat.setMetallicFactor(0.15);
      painted++;
    }
  }

  // 작은 소품은 멀리서 보인다. 노멀·반사·AO 맵은 거의 안 보이는데 용량만 차지한다.
  if (it.lite) {
    for (const mat of doc.getRoot().listMaterials()) {
      mat.setNormalTexture(null); mat.setOcclusionTexture(null);
      mat.setMetallicRoughnessTexture(null); mat.setEmissiveTexture(null);
    }
    await doc.transform(prune());
  }
  if (it.doubleSided) for (const mat of doc.getRoot().listMaterials()) mat.setDoubleSided(true);
  const texSize = it.tex || 512;
  if (doc.getRoot().listTextures().length) {
    await doc.transform(textureCompress({ encoder: sharp, targetFormat: "webp", resize: [texSize, texSize], quality: 82 }));
  }
  await doc.transform(dedup(), prune(), resample());

  const dst = path.join(OUT, it.name + ".glb");
  await io.write(dst, doc);
  const r = {
    name: it.name, before, after: triCount(doc), size,
    textures: doc.getRoot().listTextures().length, painted,
    materials: doc.getRoot().listMaterials().length,
    kb: Math.round(fs.statSync(dst).size / 1024),
  };
  report.push(r);
  console.log(`${r.name.padEnd(15)} ${String(r.before).padStart(7)} -> ${String(r.after).padStart(5)}tri  ` +
              `재질${r.materials} 텍스처${r.textures} 칠함${r.painted}  ${r.size.join("x")}m  ${r.kb}KB`);
}
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(report, null, 1));
const total = report.reduce((a, r) => a + r.kb, 0);
console.log(`\n${report.length}개 · 합계 ${(total / 1024).toFixed(2)}MB`);
