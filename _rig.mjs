import { T } from "./_harness.mjs";
const DT = 1/120;
T.syncWorld();
let pass=0, fail=0;
const ok=(c,m,x="")=>{ if(c){pass++;console.log("  OK   "+m);} else {fail++;console.log("  FAIL "+m+"  "+x);} };
const run = n => { for(let i=0;i<n;i++){ T.update(DT); T.updateCamera(DT); } };

console.log("===== 적 팔다리 리그 =====");
// 플레이어를 적 무리 한가운데로
const live = T.enemies.filter(e => !e.dead);
const near = live[0];
T.player.pos.copy(near.g.position).add(new (T.player.pos.constructor)(0, 0, -8));
T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
T.player.vel.set(0,0,0); T.setClinging(null); T.releaseWeb();
T.syncWorld();
T.updateRigs(1/60);

const used = T.rigPool.filter(r => r.owner);
ok(used.length > 0, "가까운 적에게 리그가 붙는다", `${used.length}/${T.RIG_POOL}개 사용`);
ok(used.length <= T.RIG_POOL, "풀 상한을 넘지 않는다");
ok(used.every(r => r.owner.body && !r.owner.body.visible), "리그가 붙은 적은 캡슐이 꺼진다");
ok(used.every(r => r.root.visible), "리그가 화면에 켜진다");
ok(used.every(r => r.torso.material === r.owner.mat), "적 색상을 그대로 쓴다 (종류 구분 유지)");
const far = live.find(e => e.g.position.distanceTo(T.player.pos) > T.RIG_RANGE + 20);
ok(!far || !far.rig, "사거리 밖 적에게는 안 붙는다");

// 멀어지면 떨어진다
const owner0 = used[0] ? used[0].owner : null;
T.player.pos.set(0, 4000, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
T.updateRigs(1/60);
ok(T.rigPool.every(r => !r.owner), "다 멀어지면 리그가 전부 떨어진다");
ok(!owner0 || owner0.body.visible, "떨어지면 캡슐이 다시 켜진다");

console.log("\n===== 공격 패턴이 팔로 읽히나 =====");
// 격투병을 코앞에 세우고 패턴별로 오른팔 각도가 실제로 달라지는지
const br = T.enemies.find(e => e.ty.brawler) || T.enemies[0];
br.dead = false; br.deadT = 0; br.hp = 99; br.bound = 0; br.grip = 0; br.stag = 0;
const gy = T.groundHeightAt(0, 0);
br.g.position.set(0, gy, 6);
T.player.pos.set(0, gy, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
T.player.vel.set(0,0,0);
T.syncWorld();
T.updateRigs(1/60);
ok(!!br.rig, "격투병에게 리그가 붙는다");

function poseAt(kind, frac) {
  br.swing = { kind, t: T.BRAWL[kind].hitAt * frac, done: false };
  T.poseRig(br, br.rig, 1/60);
  const a = br.rig.armR.piv.rotation;
  return { x: +a.x.toFixed(2), y: +a.y.toFixed(2) };
}
const p0 = poseAt(0, 0.95);   // 가로베기 준비 끝
const p1 = poseAt(1, 0.95);   // 내리침 준비 끝
const p2 = poseAt(2, 0.95);   // 지연 준비 끝
console.log(`       가로베기 팔 x=${p0.x} y=${p0.y} / 내리침 x=${p1.x} y=${p1.y} / 지연 x=${p2.x} y=${p2.y}`);
ok(Math.abs(p0.y) > 1.0, "가로베기는 팔이 옆으로 크게 돈다 (Y축)");
ok(p1.x < -2.0 && Math.abs(p1.y) < 0.1, "내리침은 팔이 머리 위로 올라간다 (X축)");
ok(p2.x < -2.5, "지연은 팔을 가장 크게 젖힌다");
ok(Math.abs(p0.x - p1.x) > 0.5 && Math.abs(p1.x - p2.x) > 0.1, "세 패턴의 팔 자세가 서로 다르다");

// 판정 후에는 팔이 앞으로 나간다
const before = poseAt(1, 0.9);
br.swing = { kind: 1, t: T.BRAWL[1].hitAt * 1.15, done: true };
T.poseRig(br, br.rig, 1/60);
ok(br.rig.armR.piv.rotation.x > before.x, "판정을 지나면 팔이 앞으로 내려온다");

// 붕괴하면 늘어진다
br.swing = null; br.stag = 3;
T.poseRig(br, br.rig, 1/60);
ok(br.rig.armR.piv.rotation.x > 0.3 && br.rig.torso.rotation.x > 0.3, "체간이 무너지면 팔이 늘어지고 상체가 꺾인다");
br.stag = 0;

console.log("\n===== 드로우콜 예산 =====");
const meshPerRig = 5;
console.log(`       리그 ${T.RIG_POOL}개 x 메시 ${meshPerRig} = 최대 ${T.RIG_POOL * meshPerRig} 드로우콜 추가`);
ok(T.RIG_POOL * meshPerRig <= 60, "추가 드로우콜이 60 이하");

console.log(`\n통과 ${pass} / 실패 ${fail}`);
