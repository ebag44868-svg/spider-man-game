import * as THREE from "./lib/three.module.js";
import { T } from "./_harness.mjs";
const DT=1/120;
T.syncWorld();
function place(x,y,z){ T.player.pos.set(x,y,z); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos); T.player.vel.set(0,0,0); T.player.grounded=false; }
const b = T.buildings.find(x => x.y0===0 && x.h>60 && x.w>40 && x.d>40);
const faceX = b.x - b.w/2;
console.log(`대상 벽 x=${faceX.toFixed(0)}, ${b.w.toFixed(0)}x${b.d.toFixed(0)}x${b.h.toFixed(0)}`);

function run(label, vx, vz, speed){
  place(faceX - 14, b.y0 + 30, b.z);
  T.aimYaw(Math.atan2(vx, vz));
  const v = new THREE.Vector3(vx, 0, vz).normalize().multiplyScalar(speed);
  T.player.vel.copy(v);
  const s = T.player.pos.clone();
  let minSp = 999, along = 0, ticks = 0;
  for (let i=0;i<120*3;i++){
    const p0 = T.player.pos.clone();
    T.update(DT);
    ticks++;
    const sp = Math.hypot(T.player.vel.x, T.player.vel.z);
    if (i > 2) minSp = Math.min(minSp, sp);
    if (T.player.grounded || T.player.pos.y < 4) break;
  }
  along = Math.abs(T.player.pos.z - s.z);
  const endH = Math.hypot(T.player.vel.x, T.player.vel.z);
  console.log(` ${label.padEnd(16)} 진입 ${speed} → 최저 수평속도 ${minSp.toFixed(0)} m/s, 벽 따라 ${along.toFixed(0)}m 이동, 3초 후 ${endH.toFixed(0)} m/s`);
}
console.log("\n=== 벽 충돌 (탁 멈추지 않고 흘러가야 한다) ===");
run("완전 정면", 1, 0, 60);
run("완전 정면 90", 1, 0, 90);
run("15도 비스듬", 1, 0.27, 70);
run("30도", 1, 0.58, 70);
run("거의 평행", 1, 5, 70);
