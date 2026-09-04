import { T } from "./_harness.mjs";
const DT = 1/120;
T.syncWorld();
let pass=0, fail=0;
const ok=(c,m,x="")=>{ if(c){pass++;console.log("  OK   "+m);} else {fail++;console.log("  FAIL "+m+"  "+x);} };
const run = n => { for(let i=0;i<n;i++) T.update(DT); };

console.log("===== 적이 벽 속으로 안 들어간다 =====");
// 넓은 건물 하나를 골라 옆면에 적을 붙여 세우고, 벽 쪽으로 세게 밀어본다
const b = T.buildings.find(x => x.w > 24 && x.d > 24 && x.h > 30);
ok(!!b, "시험용 건물을 찾았다", b ? `${b.w|0}x${b.d|0}x${b.h|0}` : "");
const live = T.enemies.filter(e => !e.dead);
const e = live[0];
for (const o of live) if (o !== e) o.g.position.set(9000, -800, 9000);

// 건물 -x 면 바로 바깥에 세운다
const faceX = b.x - b.w/2 - 3;
e.dead=false; e.deadT=0; e.hp=99; e.bound=0; e.grip=0; e.stag=0; e.fireCd=99; e.swing=null;
e.g.position.set(faceX, b.y0, b.z);
e.knock.set(0,0,0);
run(10);
const inside = (p) => Math.abs(p.x - b.x) < b.w/2 - 0.5 && Math.abs(p.z - b.z) < b.d/2 - 0.5
                   && p.y + 3.5 > b.y0 && p.y + 0.5 < b.y0 + b.h;
ok(!inside(e.g.position), "시작 위치는 건물 밖이다");

// 벽 쪽(+x)으로 아주 세게 민다
let worst = 0;
for (let k = 0; k < 6; k++) {
  e.knock.set(90, 0, 0);
  for (let i = 0; i < 60; i++) { T.update(DT); if (inside(e.g.position)) worst++; }
}
ok(worst === 0, "넉백으로 세게 밀어도 건물 안으로 안 들어간다", `안에 있던 틱 ${worst}`);
ok(e.g.position.x < b.x - b.w/2, "벽 바깥에 남아 있다", `x ${e.g.position.x.toFixed(1)} / 벽면 ${(b.x-b.w/2).toFixed(1)}`);

// 몸이 벽에 파묻히지 않을 만큼 떨어져 있나
const gap = (b.x - b.w/2) - e.g.position.x;
ok(gap > 1.2, "몸통이 벽에 파묻히지 않는다", `간격 ${gap.toFixed(2)}m (여유 ${T.E_WALL_PAD}m)`);

// AI가 걸어서 벽을 뚫지도 않는다
e.g.position.set(faceX, b.y0, b.z);
e.knock.set(0,0,0);
T.player.pos.set(b.x, b.y0, b.z);          // 건물 한가운데에 플레이어 -> 적이 파고들려 함
T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
let inTicks = 0;
for (let i = 0; i < 120*6; i++) { T.update(DT); if (inside(e.g.position)) inTicks++; }
ok(inTicks === 0, "플레이어를 쫓아도 벽을 통과하지 않는다", `안에 있던 틱 ${inTicks}`);

console.log(`\n통과 ${pass} / 실패 ${fail}`);
