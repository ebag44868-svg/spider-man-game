import { T } from "./_harness.mjs";
const DT=1/120; T.syncWorld();
const C=globalThis.__cv, W=globalThis.__win;
const md=b=>(C.mousedown||[]).forEach(f=>f({button:b,preventDefault(){}}));
const mu=b=>(W.mouseup||[]).forEach(f=>f({button:b,preventDefault(){}}));
const key=c=>(W.keydown||[]).forEach(f=>f({code:c,preventDefault(){}}));
key("Tab");   // 공격 모드
let pass=0, fail=0;
const ok=(c,m)=>{ if(c){pass++;console.log("  OK   "+m);} else {fail++;console.log("  FAIL "+m);} };

// 적 하나를 원하는 거리에 놓고 카메라가 완전히 자리잡을 때까지 돌린다.
function setup(e, dist, fp) {
  T.setFP(fp);
  e.hp = 99; e.bound = 0; e.grip = null;
  e.g.position.set(0, 60, dist);
  T.player.pos.set(0, 59, 0); T.player.prevPos.copy(T.player.pos); T.player.renderPos.copy(T.player.pos);
  T.player.vel.set(0,0,0); T.player.grounded=false; T.setClinging(null); T.releaseWeb();
  T.aimYaw(0); T.setPitch(Math.atan2(e.g.position.y-(T.player.pos.y+1.4), dist));
  for(let i=0;i<400;i++) T.updateCamera(DT);   // 카메라 lerp가 완전히 정착할 때까지
  T.syncWorld();
}
function shoot(e) {
  const hp0 = e.hp;
  md(0); mu(0);
  for(let i=0;i<120*3;i++) T.update(DT);
  return e.hp < hp0 || e.bound > 0;
}
const chest = e => e.g.position.clone().setY(e.g.position.y + 1.4);

for (const dist of [40, 90, 150]) {
  for (const fp of [true,false]) {
    const e = T.enemies.find(x=>!x.dead && !x.grip && x.bound<=0);
    if(!e){ console.log("적 없음"); break; }
    const tag = `${fp?"1인칭":"3인칭"} ${dist}m`;

    setup(e, dist, fp);
    if (!fp) {
      const sc = T.screenOf(chest(e));
      const onScreen = sc.front && sc.x>0 && sc.x<1600 && sc.y>0 && sc.y<900;
      ok(onScreen, `${tag} 적이 화면 안에 보인다 (${sc.x|0},${sc.y|0})`);
      T.setCursor(sc.x, sc.y);
    }
    ok(shoot(e), `${tag} 조준한 곳으로 명중`);

    // 대조군: 3인칭에서 커서를 크게 빗나가게 두면 못 맞아야 한다.
    // (여기서 맞으면 커서가 아니라 다른 게 조준하고 있다는 뜻이다)
    if (!fp) {
      setup(e, dist, fp);
      const sc = T.screenOf(chest(e));
      T.setCursor(sc.x + 600, sc.y + 330);
      ok(!shoot(e), `${tag} 커서를 딴 데 두면 빗나간다`);
    }
  }
}
console.log(`\n통과 ${pass} / 실패 ${fail}`);
