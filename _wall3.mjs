import { T } from "./_harness.mjs";
const DT=1/120;
T.syncWorld();
const b = T.buildings.find(x => x.y0===0 && x.h>60 && x.w>40 && x.d>40);
console.log(`건물 중심(${b.x.toFixed(0)}, ${b.z.toFixed(0)}) 크기 ${b.w.toFixed(0)}x${b.d.toFixed(0)} 높이 ${b.h.toFixed(0)}`);
console.log(`-x 면 = ${(b.x - b.w/2).toFixed(1)}, 플레이어 반경 ${T.player.r}`);
T.player.pos.set(b.x - b.w/2 - 14, 30, b.z);
T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
T.player.vel.set(60, 0, 0);
T.player.grounded = false;
console.log("\n  t     x        z       y     수평속도   lastWall");
for (let i=0;i<=60;i++){
  if (i % 6 === 0) {
    const w = T.lastWall;
    console.log(`  ${(i*DT).toFixed(2)}  ${T.player.pos.x.toFixed(1).padStart(8)} ${T.player.pos.z.toFixed(1).padStart(8)} ${T.player.pos.y.toFixed(0).padStart(5)}   ${Math.hypot(T.player.vel.x,T.player.vel.z).toFixed(0).padStart(5)}     ${w? w.axis+" "+w.dir : "-"}`);
  }
  T.update(DT);
}
