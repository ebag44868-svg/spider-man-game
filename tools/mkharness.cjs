// game3d.js -> _harness.mjs (테스트용). 문자열 치환만 한다.
//
// 하는 일
//   1) "three" import를 실제 파일 경로로 바꾸고, 그 자리에 시드 PRNG와 DOM 스텁을 심는다
//   2) WebGLRenderer / GLTFLoader / RGBELoader 를 아무것도 안 하는 스텁으로 바꾼다
//   3) rAF 루프를 떼어낸다 (테스트가 직접 스텝을 돌린다)
//   4) 내부 식별자 200여 개를 참조하는 T 객체를 파일 끝에 붙인다
//
// ★ 리팩터링할 때 반드시 알아야 할 것 ★
//
// 시드 PRNG는 game3d.js "본문 맨 위"에 심긴다. 그런데 ESM은 import한 모듈을
// 본문보다 먼저 평가한다. 그래서 src/*.js 의 모듈 최상위에서 THREE 객체를
// 만들면, 그 난수 소비가 시드가 심기기 전에 일어나 전체 순서가 밀린다.
//
// THREE는 Object3D / Material / BufferGeometry / Texture 를 만들 때마다
// uuid를 뽑느라 Math.random()을 여러 번 쓴다.
// (Vector3 / Matrix4 / Quaternion / Color / Loader 는 안 쓴다 — 옮겨도 안전하다)
//
// 실제로 두 번 당했다. vfx를 떼어내며 재질을 모듈 최상위로 올렸더니 적 구성이
//   사수 92 · 저격수 42 · 돌격병 43 · 격투병 39
//   -> 사수 83 · 격투병 41 · 돌격병 46 · 저격수 46
// 으로 바뀌었고, 엉뚱한 테스트 하나가 깨져 원인을 찾는 데 한참 걸렸다.
//
// 그래서 규칙은 하나다:
//   THREE 객체를 만드는 코드는 game3d.js가 "원래 만들던 그 자리"에서 실행돼야 한다.
//   모듈로 옮길 때는 initXxx() 안에 넣고, 그 자리에서 initXxx()를 부른다.
//   그리고 npm run rng 으로 도시·차·적 구성이 그대로인지 확인한다.
const fs=require('fs');
let s=fs.readFileSync('game3d.js','utf8').replace(/^﻿/,'');
s=s.replace('import * as THREE from "three";','import * as THREE from "./lib/three.module.js";\n'+`
const _g=globalThis;
// 결정적 도시 생성용 시드 PRNG (설정 비교가 노이즈에 묻히지 않도록)
let _seed = _g.__SEED__ || 12345;
Math.random = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
function _mkEl(){
  const e={style:{setProperty(){}},textContent:'',classList:{toggle(){},add(){},remove(){},contains(){return false;}},children:[],appendChild(){},addEventListener(){},requestPointerLock(){},querySelector(){return _mkEl();},getBoundingClientRect(){return {left:0,top:0,width:100,height:100};},dataset:{},closest(){return null;}};
  Object.defineProperty(e,"firstElementChild",{get:()=>_mkEl()});
  return e;
}
const _grad={addColorStop(){}};
const ctx2d=new Proxy({},{get:(t,k)=>(k==='canvas'?{width:256,height:256}:(k==='createLinearGradient'||k==='createRadialGradient'||k==='createPattern')?(()=>_grad):()=>{}),set:()=>true});
_g.__handlers={};
_g.document={createElement:()=>({width:0,height:0,getContext:()=>ctx2d,style:{},addEventListener(){},requestPointerLock(){}}),
  createElementNS:()=>({style:{},getContext:()=>ctx2d,addEventListener(){},setAttribute(){}}),
  getElementById:()=>_mkEl(),querySelector:()=>_mkEl(),body:{appendChild(){},classList:{add(){},remove(){},toggle(){}}},addEventListener(n,f){ _g.__handlers[n]=f; },exitPointerLock(){},pointerLockElement:null};
_g.location={search:""};   // node에 navigator는 이미 있다(maxTouchPoints undefined)
_g.innerWidth=1600;_g.innerHeight=900;_g.devicePixelRatio=1;
_g.__cv={};_g.__win={};_g.addEventListener=(nm,f)=>{ (_g.__win[nm]=_g.__win[nm]||[]).push(f); };_g.performance=_g.performance||{now:()=>Date.now()};
_g.requestAnimationFrame=()=>0;_g.window={};
`);
s=s.replace('new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })',
  '{ domElement:{style:{},addEventListener(nm,f){ (globalThis.__cv[nm]=globalThis.__cv[nm]||[]).push(f); },requestPointerLock(){}}, setSize(){}, setPixelRatio(){}, render(){}, shadowMap:{}, capabilities:null, toneMapping:0, toneMappingExposure:1 }');
s=s.replace(/requestAnimationFrame\(frame\);\s*$/,'');
s=s.replace('import { GLTFLoader } from "./lib/loaders/GLTFLoader.js";','import { GLTFLoader } from "./lib/loaders/GLTFLoader_node.js";');
s=s.replace(/^import { RGBELoader }.*$/m, "const RGBELoader = class { load(){} };");
s=s.replace('from "./lib/utils/BufferGeometryUtils.js"','from "./lib/utils/BufferGeometryUtils_node.js"');
// node에서는 상대경로 fetch가 동기적으로 던져 하네스가 죽는다.
// 모델은 물리/도시 생성에 영향이 없으므로 로더 호출만 무해하게 바꾼다.
s=s.replace("new GLTFLoader().load(","new (class{load(){}})().load(");
s+=`
const _mmHandler = globalThis.__handlers["mousemove"];
const _plHandler = globalThis.__handlers["pointerlockchange"];
export const T = {
  player, camera, update, updateCamera, groundHeightAt, keys, buildings,
  get web(){ return web; },
  arm(){ mouseDownL = true; }, disarm(){ mouseDownL = false; },
  tryAttach, releaseWeb, resolveAnchor, camera2: camera,
  setFP(v){ firstPerson = v; },
  // 교전 시험용: 플레이어가 죽으면 Director가 멈춰서 측정이 끊긴다.
  setInvuln(v){ invuln = v; }, get invuln(){ return invuln; },
  setPitch(v){ viewPitch = v; },
  get viewYaw(){ return viewYaw; },
  get viewPitch(){ return viewPitch; },
  get clinging(){ return clinging; },
  get sliding(){ return sliding; },
  get camAuto(){ return camAuto; },
  setAuto(v){ camAuto = v; },
  setClinging(c){ clinging = c; },
  wallJump, armR, armL, webStrand, updateWebVisual,
  get heroMixer(){ return heroMixer; },
  get heroActions(){ return heroActions; },
  get heroCurrentClip(){ return heroCurrentClip; },
  get bodyVisible(){ return body.visible; },
  get climbMouse(){ return climbMouse; }, setClimbMouse(v){ climbMouse = v; },
  get spiderRotX(){ return spiderGroup.rotation.x; },
  tumble(){ if(tumbleT>0||clinging) return; const f=new THREE.Vector3(); camera.getWorldDirection(f); f.y=0; const l=f.length(); if(l<0.001) return; f.divideScalar(l); if(player.grounded){tumbleDur=0.5;player.vel.x=f.x*TUMBLE_SPEED;player.vel.z=f.z*TUMBLE_SPEED;}else{tumbleDur=0.65;player.vel.x+=f.x*TUMBLE_AIR;player.vel.z+=f.z*TUMBLE_AIR;} tumbleT=tumbleDur; },
  fire(){ armPulse = 0.35; },
  get ledgeCount(){ return ledgeList.length; },
  get tumbleT(){ return tumbleT; },
  get heroRoot(){ return heroRoot; },
  get enemies(){ return enemies; },
  get projectiles(){ return projectiles; },
  get particles(){ return particles; },
  get attackMode(){ return attackMode; }, setAttackMode(v){ attackMode = v; },
  get hitStop(){ return hitStop; },
  get shake(){ return shake; },
  get combo(){ return combo; },
  fireWeb, fireBind, tryZip, spawnEnemies, makeEnemy,
  get zip(){ return zip; },
  get lunge(){ return lunge; }, get pull(){ return pull; }, get kickOpen(){ return kickOpen; },
  fireGrab, firePull, tryKick, findZipAnchor, startLunge, startPull,
  punch, get punchT(){ return punchT; }, get hoverT(){ return hoverT; }, get diving(){ return diving; },
  LUNGE_HOLD, LUNGE_SPEED, KICK_R, KICK_DMG, WHIFF_DMG,
  enemies2: enemies, eProjectiles, get hp(){ return hp; }, get deadT(){ return deadT; },
  get stam(){ return stam; }, get stamEmpty(){ return stamEmpty; }, MAX_STAM, MAX_HP,
  zones, get activeZone(){ return activeZone; }, get zonesCleared(){ return zonesCleared; }, zoneRemaining, pickZone, zoneOf,
  fireUlt, get ultRing(){ return ultRing; }, ULT_R, get ult(){ return ultFake; }, setUlt(v){ ultFake = v; }, BIND_TIME,
  E_TYPES, rollEnemyType,
  senseSector, senseFoeLv, senseObjLv, SENSE_R, updateSense,
  findSwingAnchor, tryAttachAuto, ROPE_MAX,
  get invuln(){ return invuln; }, damagePlayer, updateEnemyAI, makeEnemy, setNight,
  E_SIGHT, E_RANGE, E_AIM, E_CD, E_ACTIVE, E_PROJ_V, MAX_HP, PLAYER_HIT_R,
  get bindCd(){ return bindCd; },
  ROPE_MAX, ENEMY_HIT_R, BIND_TIME, findNearbyWall, WALL_GRAB_REACH, ZIP_SPEED, ZIP_CHARGE,
  get sidewalkCount(){ return sidewalkMesh.count; },
  get paintCount(){ return paintMesh.count; },
  CURB_H, SIDEWALK_W, blockBounds, blocks, blockIndex, cityMeshes, aimTargets,
  FACADES, famOf, pickKind, KIND_COUNT, BY_FAM,
  spawnImpact, impactRings, IMPACT, particles,
  incomingThreat, get slowmo(){ return slowmo; }, get dodgeCount(){ return dodgeCount; },
  get lastWall(){ return lastWall; }, collideWalls, resolveAxis, get wallBump(){ return wallBump; },
  get perfectCount(){ return perfectCount; }, DODGE_PERFECT, DODGE_IFRAME, get invuln2(){ return invuln; },
  get camZoom(){ return camZoom; }, ZIP_SPEED, ZIP_KEEP, ZIP_MOMENT, get hoverT(){ return hoverT; }, airHover,
  get camBlocked(){ return camBlocked; }, CAM_WALL_PAD, CAM_MIN_DIST, CAM_NEAR_SKIN, CAM_HIDE_DIST, CAM_PIVOT_Y, camStandDist, segHitWorld, nearbyBuildings, spiderGroup,
  AVE_SPACING, ST_SPACING, AVE_ROAD_W, ST_ROAD_W, N_AVE, N_ST, WORLD_SIZE,
  get waterTowerCount(){ return waterTowerCount; },
  get lampCount(){ return lampCount; },
  cars, updateCars, carBodyMesh,
  get ammo(){ return ammo; }, get reloadT(){ return reloadT; },
  MAG_SIZE, RELOAD_TIME, startReload, updateHud,
  mouseLook(dx,dy){ const ev={movementX:dx,movementY:dy,clientX:0,clientY:0}; _mmHandler(ev); },
  lockOn(){ _plHandler(); },
  lockPointer(){ document.pointerLockElement = renderer.domElement; },
  unlockPointer(){ document.pointerLockElement = null; },
  updateCrosshair,
  crosshairPos(){ return { left: crosshairEl.style.left, top: crosshairEl.style.top }; },
  get hitMark(){ return hitMark; },
  get hitKill(){ return hitKill; },
  G,
  setCursor(x,y){ mx=x; my=y; },
  aimRayDir(){ raycaster.setFromCamera(cursorNdc(), camera); return raycaster.ray.direction.clone(); },
  syncWorld(){ scene.updateMatrixWorld(true); },
  aimPoint(){ scene.updateMatrixWorld(true); raycaster.setFromCamera(cursorNdc(), camera); raycaster.far=Infinity; const h=raycaster.intersectObjects(aimTargets,false); return h.length? h[0].point.clone() : null; },
  aimYaw(v){ viewYaw = v; bodyYaw = v; },
  get camHold(){ return camHold; },
  get lockOn(){ return lockOn; }, setLock(e){ lockOn = e; },
  toggleLock, pickLockTarget, canSeeEnemy, updateLock, updateLockMark,
  climbHeld,
  meleeInput, parry, meleeRoll, startMelee, updateMelee, clearMelee, addPosture, tryParry, startExecute,
  BRAWL, BRAWL_HOLD, E_STANDOFF, brawlerAI, pickBrawl,
  updateDirector, DIR_LANES, DIR_LANE_OF, DIR_MAX, DIR_TICK, DIR_REST, DIR_HOLD, DIR_MELEE_RING, dirHeld, dirBusy, makeEnemy, E_STANDOFF, E_WAIT_RING,
  E_TYPES, updateSwingArc, E_WALL_PAD, blockedAt, stepEnemy, updateRigs, rigPool, RIG_POOL, RIG_RANGE, RIG_DROP, rigDetach, get rollFx(){ return rollFx; }, ANIM_ONLY_FILES, CLIP_ONCE, poseRig, assignRigs, get aimAuto(){ return aimAuto; }, get aimPreviewPos(){ return aimPreview; }, findSwingAnchor,
  meleePress, meleeRelease, get charging(){ return charging; }, get chargeT(){ return chargeT; },
  CHARGE_MIN, CHARGE_FULL, MELEE_AIM_R, FALL_MIN_V, FALL_H1, FALL_H2, FALL_H3, get fallTopY(){ return fallTopY; }, setHp(v){ hp = v; invuln = 0; regenWait = 0; regenT = 0; deadT = 0; },
  updateHpBars, get hpBarCount(){ return hpBarBg.count; }, get psBarCount(){ return psBarFill.count; }, HPBAR_RANGE, HPBAR_MAX,
  get camFree(){ return camFree; }, CAM_FREE, get dragging(){ return dragging; },
  get swingLineVisible(){ return swingLine.visible; },
  get chargeRingVisible(){ return chargeRing.visible; }, get parryRingVisible(){ return parryRing.visible; }, get parryRingPos(){ return parryRing.position; }, PARRY_WIN, PARRY_REC,
  get swingFx(){ return swingFx; }, get swingArcVisible(){ return swingArcPivot.visible; }, findMeleeTarget, MELEE_STAND, updateSwingArc,
  meleeDashIn, get dashIn(){ return dashIn; }, get dashInE(){ return dashInE; }, DASH_IN_MIN, DASH_IN_MAX, DASH_IN_SPEED, dualWebTarget,
  get mAtk(){ return mAtk; }, get mChain(){ return mChain; }, get mBuf(){ return mBuf; },
  get parryT(){ return parryT; }, get parryRec(){ return parryRec; }, get parryCd(){ return parryCd; },
  get parryCount(){ return parryCount; }, get rollT(){ return rollT; },
  get execT(){ return execT; }, get execTarget(){ return execTarget; },
  M_LIGHT, M_HEAVY, PARRY_WIN, PARRY_POST, ROLL_TIME, ROLL_IFR, ROLL_STAM, ROLL_BURST, ROLL_SPEED, EXEC_TIME, STAG_TIME, POST_DECAY,
  setStam(v){ stam = v; stamEmpty = false; },
  get invulnNow(){ return invuln; },
  get lockMarkVisible(){ return lockMark.visible; },
  get meleeMode(){ return meleeMode; },
  LOCK_RANGE, LOCK_BREAK, LOCK_BLIND,
  get dragging(){ return dragging; },
  get bodyYaw(){ return bodyYaw; },
  get cursor(){ return { x: mx, y: my }; },
  cursorNdc, aimRay, pickEnemy, aimPointOrFar, aimHit, aimOrigin,
  setView(y,p){ viewYaw = y; viewPitch = p; },
  // 월드 좌표를 화면 픽셀로. 3인칭 테스트에서 커서를 적 위에 올리는 데 쓴다.
  screenOf(p){ camera.updateMatrixWorld(); const v = p.clone().project(camera);
    return { x: (v.x*0.5+0.5)*innerWidth, y: (-v.y*0.5+0.5)*innerHeight, front: v.z < 1 }; }
};
`;
fs.writeFileSync('_harness.mjs', s, 'utf8');
console.log('harness written (seeded)');
