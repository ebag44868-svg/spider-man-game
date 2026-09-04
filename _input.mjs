import { T } from "./_harness.mjs";
const DT = 1/120;
T.syncWorld();
const W = globalThis.__win, C = globalThis.__cv;
const key   = c => (W.keydown||[]).forEach(f => f({ code: c, preventDefault(){} }));
const md    = b => (C.mousedown||[]).forEach(f => f({ button: b, preventDefault(){} }));
const mu    = b => (W.mouseup||[]).forEach(f => f({ button: b, preventDefault(){} }));
// 실제 브라우저처럼 위치와 이동량을 같이 실어 보낸다
let cx = 800, cy = 450;
const move = (dx,dy) => { cx += dx; cy += dy;
  (globalThis.__handlers.mousemove||(()=>{}))({ movementX:dx, movementY:dy, clientX:cx, clientY:cy }); };
let pass=0, fail=0;
const ok=(c,m,x="")=>{ if(c){pass++;console.log("  OK   "+m);} else {fail++;console.log("  FAIL "+m+"  "+x);} };
function place(x,y,z,vx,vz){ T.player.pos.set(x,y,z); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(vx||0,0,vz||0); T.player.grounded=false; T.setClinging(null); T.releaseWeb(); }
const clearZip = () => { T.releaseWeb(); if (T.zip) for(let i=0;i<200;i++) T.update(DT); };

console.log("===== 1인칭: 락 + 화면 중앙 조준, 마우스 이동 = 시점 =====");
T.setFP(true); T.aimYaw(0.6); T.setPitch(-0.1);

place(0, 150, 0, 10, 10);
for(let i=0;i<40;i++){ T.updateCamera(DT); T.update(DT); }
T.syncWorld();
md(2);
ok(!!T.zip, "우클릭 단독으로 양손 거미줄이 나간다");
mu(2); clearZip();

const y1 = T.viewYaw;
move(120, 0);
ok(Math.abs(T.viewYaw - y1) > 0.1, "버튼 없이 마우스 이동만으로 시점이 돌아간다", `${y1.toFixed(2)} -> ${T.viewYaw.toFixed(2)}`);

const n1 = T.cursorNdc();
ok(n1.x === 0 && n1.y === 0, "조준점이 화면 정중앙에 고정된다");
ok(!T.dragging, "우클릭을 눌러도 시점 드래그 모드로 안 들어간다");

console.log("\n===== 3인칭: 커서 = 조준점, 우클릭 드래그 = 시점 =====");
T.setFP(false); T.aimYaw(0.6); T.setPitch(-0.1);
place(0, 150, 0, 10, 10);
for(let i=0;i<40;i++){ T.updateCamera(DT); T.update(DT); }
T.syncWorld();

// 우클릭은 시점 드래그. 집라인이 아니다.
md(2);
ok(T.dragging && !T.zip, "우클릭은 시점 드래그다 (집라인이 아니다)");

const y2 = T.viewYaw;
move(120, 0);
ok(Math.abs(T.viewYaw - y2) > 0.1, "우클릭을 누른 채 움직이면 시점이 돌아간다", `${y2.toFixed(2)} -> ${T.viewYaw.toFixed(2)}`);
mu(2);
ok(!T.dragging, "우클릭을 떼면 드래그가 풀린다");

const y3 = T.viewYaw;
move(150, 80);
ok(Math.abs(T.viewYaw - y3) < 1e-6, "버튼을 안 누르면 마우스를 움직여도 시점이 안 돈다", `${y3.toFixed(4)} -> ${T.viewYaw.toFixed(4)}`);

// 커서가 곧 조준점
// cursorNdc는 공유 벡터를 돌려준다. 값을 비교하려면 복사해야 한다.
T.setCursor(400, 300);
const n2 = T.cursorNdc().clone();
T.setCursor(1200, 700);
const n3 = T.cursorNdc().clone();
ok(Math.abs(n2.x - n3.x) > 0.5 && Math.abs(n2.y - n3.y) > 0.5, "커서를 옮기면 조준점이 따라 움직인다",
   `(${n2.x.toFixed(2)},${n2.y.toFixed(2)}) -> (${n3.x.toFixed(2)},${n3.y.toFixed(2)})`);

// 조준선도 실제로 커서를 따라간다
const dA = new (T.player.pos.constructor)(), oA = new (T.player.pos.constructor)();
T.setCursor(300, 250); T.aimRay(oA, dA); const dirA = dA.clone();
T.setCursor(1300, 750); T.aimRay(oA, dA);
ok(dirA.dot(dA) < 0.97, "조준선 방향이 커서를 따라 실제로 바뀐다", `dot=${dirA.dot(dA).toFixed(3)}`);
T.setCursor(800, 450);

// F = 양손 거미줄
place(0, 150, 0, 10, 10);
for(let i=0;i<40;i++){ T.updateCamera(DT); T.update(DT); }
T.syncWorld();
key("KeyF");
ok(!!T.zip, "F키로 양손 거미줄이 나간다");
clearZip();

// X = 주먹
place(0, 150, 0, 0, 0);
key("KeyX");
ok(T.punchT > 0, "X키로 근접 주먹이 나간다", `punchT=${T.punchT}`);

// G = 덤블링
place(0, 150, 0, 0, 0);
key("KeyG");
ok(T.tumbleT > 0, "G키로 덤블링이 나간다");

console.log("\n===== 시점 모드: 자동/수동은 오직 C가 정한다 =====");
T.setFP(false); T.setAuto(true);
place(0, 150, 0, 40, 0);
// 드래그는 시점만 돌린다. 모드까지 건드리면 C로 걸어둔 수동이 제멋대로 풀린다.
md(2); move(200, 0); mu(2);
ok(T.camAuto, "우클릭 드래그는 자동/수동 상태를 바꾸지 않는다");
for(let i=0;i<120*4;i++) T.update(DT);
ok(T.camAuto, "드래그 뒤에도 자동은 자동 그대로다");

// 자동 모드라도 붙잡고 있는 동안은 자동 정렬이 손과 싸우지 않는다
T.setAuto(true); place(0, 150, 0, 40, 0); T.aimYaw(0);
md(2);
const yDrag = T.viewYaw;
for(let i=0;i<120;i++){ T.player.vel.set(50,0,0); T.update(DT); T.updateCamera(DT); }
ok(Math.abs(T.viewYaw - yDrag) < 0.02, "드래그를 붙잡고 있는 동안은 카메라가 진행 방향으로 안 끌려간다",
   `${(yDrag*57.3).toFixed(0)}도 -> ${(T.viewYaw*57.3).toFixed(0)}도`);
mu(2);

// C 수동은 무슨 일이 있어도 안 움직인다
key("KeyC");
ok(!T.camAuto && T.camHold, "C키로 수동 시점이 켜진다");
place(0, 150, 0, 0, 0); T.aimYaw(0);
const yMan = T.viewYaw;
for(let i=0;i<120*8;i++){ T.player.vel.set(50, 0, 30); T.update(DT); T.updateCamera(DT); }
ok(!T.camAuto, "C 수동은 8초가 지나도 자동으로 안 돌아간다");
ok(Math.abs(T.viewYaw - yMan) < 1e-6, "C 수동에서는 빠르게 날아도 시점이 1도도 안 움직인다",
   `${(yMan*57.3).toFixed(1)}도 -> ${(T.viewYaw*57.3).toFixed(1)}도`);
key("KeyC");
ok(T.camAuto && !T.camHold, "C키를 다시 누르면 자동으로 돌아간다");

console.log("\n===== 자동 시점: 수직 상승에서 빙글빙글 안 돈다 =====");
T.setFP(false); T.setAuto(true);
// 몸 방향(bodyYaw)은 update()에서 계산된다. updateCamera만 돌리면 아무것도 안 변해
// 테스트가 통째로 무효가 된다 — 둘 다 돌리고 속도는 매 틱 다시 강제한다.
// 스윙 정점에서 실제로 나오는 값: 수평 4m/s에 수직 55m/s.
// 수평 속도가 예전 임계(1.5)는 넘지만 방향은 사실상 노이즈인 구간이다.
place(0, 600, 0, 0, 0);
T.aimYaw(0);
const prof = i => [4 * Math.sin(i * 0.7), 55 - i * 0.2, 4 * Math.cos(i * 0.9)];
let spin = 0, prev = T.viewYaw;
for(let i=0;i<120*2;i++){
  const [vx,vy,vz] = prof(i);
  T.player.vel.set(vx, vy, vz);
  T.update(DT); T.updateCamera(DT);
  spin += Math.abs(Math.atan2(Math.sin(T.viewYaw - prev), Math.cos(T.viewYaw - prev)));
  prev = T.viewYaw;
}
// 같은 속도 프로필을 예전 규칙(hsp>1.5, 10*dt)에 넣으면 얼마나 도는지 나란히 잰다
const lerpA=(a,b,t)=>{ const d=Math.atan2(Math.sin(b-a),Math.cos(b-a)); return a+d*t; };
let oldYaw=0, oldBody=0, oldSpin=0, oldPrev=0;
for(let i=0;i<120*2;i++){
  const [vx,vy,vz] = prof(i);
  const hsp = Math.hypot(vx,vz);
  if (hsp > 1.5) oldBody = lerpA(oldBody, Math.atan2(vx,vz), Math.min(1,10*DT));
  if (hsp > 3) oldYaw = lerpA(oldYaw, oldBody, Math.min(1,3.5*DT));
  oldSpin += Math.abs(Math.atan2(Math.sin(oldYaw-oldPrev),Math.cos(oldYaw-oldPrev)));
  oldPrev = oldYaw;
}
ok(spin < oldSpin * 0.35, "솟구치는 2초 동안 시점이 거의 안 돈다 (예전엔 빙글빙글)",
   `지금 ${(spin*57.3).toFixed(1)}도 / 예전 규칙 ${(oldSpin*57.3).toFixed(1)}도`);
console.log(`       (누적 회전: 지금 ${(spin*57.3).toFixed(1)}도  <-  예전 ${(oldSpin*57.3).toFixed(1)}도)`);

// 반대로 실제로 빠르게 방향을 틀 땐 따라와야 한다
T.setAuto(true); place(0, 600, 0, 0, 0);
T.aimYaw(0);
for(let i=0;i<120*2;i++){ T.player.vel.set(50, 0, 0); T.update(DT); T.updateCamera(DT); }
ok(Math.abs(Math.abs(T.viewYaw) - Math.PI/2) < 0.25, "수평으로 빠르게 날면 진행 방향으로 따라온다", `yaw=${T.viewYaw.toFixed(2)}`);

// 위아래도 따라온다
T.setAuto(true); place(0, 900, 0, 0, 0);
T.setView(0, 0);
for(let i=0;i<120*2;i++){ T.player.vel.set(0, -50, 30); T.update(DT); T.updateCamera(DT); }
ok(T.viewPitch < -0.15, "낙하 중에는 자동 시점이 아래를 본다", `pitch=${T.viewPitch.toFixed(2)}`);
T.setAuto(true); place(0, 600, 0, 0, 0); T.setView(0, 0);
for(let i=0;i<120*2;i++){ T.player.vel.set(0, 50, 30); T.update(DT); T.updateCamera(DT); }
ok(T.viewPitch > 0.15, "솟구칠 때는 자동 시점이 위를 본다", `pitch=${T.viewPitch.toFixed(2)}`);

console.log(`\n통과 ${pass} / 실패 ${fail}`);

console.log("\n===== 수동 시점: 카메라 '방향'이 진짜 고정인가 =====");
// viewYaw만 재면 안 된다. viewYaw가 고정이어도 camera.lookAt이 속도에 끌려
// 실제 화면이 20도 넘게 돌아가고 있었다 — 그래서 이 검사는 카메라 방향을 직접 잰다.
const _cd = new (T.player.pos.constructor)();
const camDir = () => { T.camera.updateMatrixWorld(); T.camera.getWorldDirection(_cd); return _cd.clone(); };
const angDeg = (a, b) => Math.acos(Math.max(-1, Math.min(1, a.dot(b)))) * 57.3;

T.setFP(false);
T.setAuto(false);                       // 수동
const gy2 = T.groundHeightAt(0, 0);
function stand() {
  T.player.pos.set(0, gy2, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0,0,0); T.setClinging(null); T.releaseWeb(); T.setLock(null);
  for (const k of ["KeyW","KeyA","KeyS","KeyD"]) T.keys[k] = false;
  for (let i=0;i<240;i++){ T.update(DT); T.updateCamera(DT); }
}
stand();
let base = camDir(), worst = 0;
for (const k of ["KeyA","KeyD","KeyW","KeyS"]) {
  T.keys[k] = true;
  for (let i=0;i<120;i++){ T.update(DT); T.updateCamera(DT); worst = Math.max(worst, angDeg(base, camDir())); }
  T.keys[k] = false;
  for (let i=0;i<60;i++){ T.update(DT); T.updateCamera(DT); }
}
ok(worst < 0.5, "수동에서 WASD로 움직여도 카메라 방향이 안 돈다", `최대 ${worst.toFixed(2)}도`);

// 빠르게 날아도 마찬가지
stand();
base = camDir(); worst = 0;
for (let i=0;i<120*3;i++){ T.player.vel.set(60, 8, 40); T.update(DT); T.updateCamera(DT); worst = Math.max(worst, angDeg(base, camDir())); }
ok(worst < 0.5, "수동에서 60m/s로 날아도 카메라 방향이 안 돈다", `최대 ${worst.toFixed(2)}도`);

// 우클릭 드래그로는 돌아가야 한다
stand();
base = camDir();
md(2);
for (let i=0;i<6;i++) move(40, 0);
mu(2);
for (let i=0;i<30;i++){ T.update(DT); T.updateCamera(DT); }
ok(angDeg(base, camDir()) > 10, "그래도 우클릭 드래그로는 돌아간다", `${angDeg(base, camDir()).toFixed(0)}도`);

// 자동 모드는 예전처럼 따라가야 한다
T.setAuto(true);
stand();
base = camDir();
let auto = 0;
for (let i=0;i<120*2;i++){ T.player.vel.set(50,0,0); T.update(DT); T.updateCamera(DT); auto = Math.max(auto, angDeg(base, camDir())); }
ok(auto > 10, "자동 모드는 여전히 진행 방향을 따라간다", `${auto.toFixed(0)}도`);
T.setAuto(false);

console.log(`\n최종  통과 ${pass} / 실패 ${fail}`);
