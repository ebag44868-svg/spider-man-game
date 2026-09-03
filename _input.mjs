import { T } from "./_harness.mjs";
const DT = 1/120;
T.syncWorld();
const W = globalThis.__win, C = globalThis.__cv;
const key = c => (W.keydown||[]).forEach(f => f({ code: c, preventDefault(){} }));
const keyUp = c => (W.keyup||[]).forEach(f => f({ code: c, preventDefault(){} }));
const md = b => (C.mousedown||[]).forEach(f => f({ button: b, preventDefault(){} }));
const mu = b => (C.mouseup||[]).forEach(f => f({ button: b, preventDefault(){} }));
const move = (dx,dy) => (globalThis.__handlers.mousemove||(()=>{}))({ movementX:dx, movementY:dy, clientX:0, clientY:0 });
let pass=0, fail=0;
const ok=(c,m,x="")=>{ if(c){pass++;console.log("  OK   "+m);} else {fail++;console.log("  FAIL "+m+"  "+x);} };
function place(x,y,z,vx,vz){ T.player.pos.set(x,y,z); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(vx||0,0,vz||0); T.player.grounded=false; T.setClinging(null); T.releaseWeb(); }
console.log("리스너 잡힘: window="+Object.keys(W).join(",")+" / canvas="+Object.keys(C).join(","));

for (const fp of [true, false]) {
  console.log(`\n===== ${fp ? "1인칭" : "3인칭"} =====`);
  T.setFP(fp); T.aimYaw(0.6); T.setPitch(-0.1);

  // 우클릭 = 집라인
  place(0, 150, 0, 10, 10);
  for(let i=0;i<40;i++){ T.updateCamera(DT); T.update(DT); }
  T.syncWorld();
  md(2);
  ok(!!T.zip, "우클릭 단독으로 집라인이 걸린다");
  mu(2); T.setZip && T.setZip(null);

  // 시점: 마우스 이동만으로 돌아간다 (버튼 안 누름)
  const y0 = T.viewYaw;
  move(120, 0);
  ok(Math.abs(T.viewYaw - y0) > 0.1, "버튼 없이 마우스 이동만으로 시점이 돌아간다", `${y0.toFixed(2)} -> ${T.viewYaw.toFixed(2)}`);

  // 조준점은 중앙
  const nd = T.cursorNdc ? T.cursorNdc() : null;
  if (nd) ok(nd.x === 0 && nd.y === 0, "조준점이 화면 중앙에 고정된다");

  // T = 잡기 스킬
  T.setAttack && T.setAttack(true);
  T.spawnEnemies && null;
  const before = { lunge: !!T.lunge, grab: T.grabT };
  key("KeyT");
  ok(true, "T키가 예외 없이 처리된다");

  // C = 카메라 토글
  const ca = T.camAuto;
  key("KeyC");
  ok(T.camAuto !== ca, "C키로 자동/수동 카메라가 토글된다", `${ca} -> ${T.camAuto}`);
  key("KeyC");

  // G = 덤블링
  place(0, 150, 0, 0, 0);
  const sp0 = T.player.vel.length();
  key("KeyG");
  ok(T.player.vel.length() > sp0 + 1 || T.tumbleT > 0, "G키로 덤블링이 나간다");
}

console.log("\n===== 3인칭 자동카메라 복귀 =====");
T.setFP(false); T.camAutoSet && null;
place(0, 150, 0, 40, 0);
move(200, 0);
ok(!T.camAuto, "마우스로 돌리면 수동으로 전환된다");
for (let i=0;i<120*3.5;i++){ T.updateCamera(DT); T.update(DT); }
ok(T.camAuto, "손을 떼고 잠시 지나면 자동으로 복귀한다");

console.log(`\n통과 ${pass} / 실패 ${fail}`);
