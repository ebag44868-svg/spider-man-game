// 모든 원본 모델을 GLB 로 모으고 검사한다.
//   FBX       -> FBX2glTF 로 변환
//   GLTF/GLB  -> 그대로 읽어 GLB 로 다시 쓴다 (텍스처를 한 파일에 묶기 위해)
// 결과: _glb/<id>.glb  +  inventory.json  +  화면 표
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const RAW = "C:/spider_assets_raw/_work";
const OUT = "C:/spider_assets_raw/_glb";
fs.mkdirSync(OUT, { recursive: true });

const FBX2GLTF = path.resolve("node_modules/fbx2gltf/bin/Windows_NT/FBX2glTF.exe");
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

function walk(dir) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else out.push(p);
  }
  return out;
}

// 이미지 헤더에서 해상도만 읽는다 (PNG / JPEG)
function imgSize(buf, mime) {
  try {
    if (mime === "image/png") return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    if (mime === "image/jpeg") {
      let i = 2;
      while (i < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1], len = buf.readUInt16BE(i + 2);
        if (m >= 0xc0 && m <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
        i += 2 + len;
      }
    }
  } catch {}
  return [0, 0];
}

const files = walk(RAW).filter(f => /\.(fbx|glb|gltf)$/i.test(f));
// 같은 에셋이 여러 포맷으로 들어 있으면 glb > gltf > fbx 하나만 쓴다
const byDir = new Map();
for (const f of files) {
  const key = f.replace(/\.(fbx|glb|gltf)$/i, "").toLowerCase();
  const rank = /\.glb$/i.test(f) ? 0 : /\.gltf$/i.test(f) ? 1 : 2;
  const cur = byDir.get(key);
  if (!cur || rank < cur.rank) byDir.set(key, { f, rank });
}

const rows = [];
for (const { f } of byDir.values()) {
  const rel = path.relative(RAW, f).replace(/\\/g, "/");
  const id = rel.replace(/\.(fbx|glb|gltf)$/i, "").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase().slice(0, 80);
  const dst = path.join(OUT, id + ".glb");
  const row = { id, src: rel };
  try {
    if (/\.fbx$/i.test(f)) {
      if (!fs.existsSync(dst)) {
        execFileSync(FBX2GLTF, ["-b", "--pbr-metallic-roughness", "-i", f, "-o", dst.replace(/\.glb$/, "")],
                     { stdio: "pipe", timeout: 300000, maxBuffer: 1 << 26 });
      }
    } else if (!fs.existsSync(dst)) {
      const d = await io.read(f);
      await io.write(dst, d);
    }
    const doc = await io.read(dst);
    const root = doc.getRoot();
    let tris = 0;
    for (const m of root.listMeshes()) for (const p of m.listPrimitives()) {
      const idx = p.getIndices(), pos = p.getAttribute("POSITION");
      if (!pos) continue;
      tris += Math.floor((idx ? idx.getCount() : pos.getCount()) / 3);
    }
    let texMax = 0, texBytes = 0;
    for (const t of root.listTextures()) {
      const img = t.getImage();
      if (!img) continue;
      texBytes += img.byteLength;
      const [w, h] = imgSize(Buffer.from(img), t.getMimeType());
      texMax = Math.max(texMax, w, h);
    }
    const scene = root.getDefaultScene() || root.listScenes()[0];
    const b = scene ? getBounds(scene) : { min: [0, 0, 0], max: [0, 0, 0] };
    const size = b.max.map((v, i) => +(v - b.min[i]).toFixed(2));
    Object.assign(row, {
      ok: true,
      tris,
      meshes: root.listMeshes().length,
      textures: root.listTextures().length,
      texMax,
      texMB: +(texBytes / 1048576).toFixed(1),
      skins: root.listSkins().length,
      anims: root.listAnimations().length,
      size,
      glbMB: +(fs.statSync(dst).size / 1048576).toFixed(1),
    });
  } catch (e) {
    Object.assign(row, { ok: false, err: String(e.message || e).split("\n")[0].slice(0, 120) });
  }
  rows.push(row);
  const r = row;
  console.log(r.ok
    ? `${r.id.padEnd(52)} ${String(r.tris).padStart(8)}tri  tex${String(r.textures).padStart(2)} max${String(r.texMax).padStart(5)}  skin${r.skins} anim${r.anims}  크기 ${r.size.join("x")}  ${r.glbMB}MB`
    : `${r.id.padEnd(52)} 실패: ${r.err}`);
}
fs.writeFileSync("C:/spider_assets_raw/inventory.json", JSON.stringify(rows, null, 1));
console.log(`\n총 ${rows.length}개 · 실패 ${rows.filter(r => !r.ok).length}`);
