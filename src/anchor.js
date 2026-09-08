// AUTO ANCHOR V2 — "내가 어디로 가고 싶은지"를 읽는다
//
// 문서 03 §9~§12. 이 게임의 정체성이라고 세 문서가 모두 지목한 시스템이다.
//
// 기존(legacy)은 viewYaw 하나만 봤다. 부채꼴 ±55도를 쏘고, 진행 방향과의
// 일치도·길이·높이로 점수를 냈다. 문제는 두 가지였다.
//
//   1. "내가 보는 곳"은 잘 읽는데 "내가 가고 싶은 방향"을 못 읽는다.
//      레퍼런스 영상에서는 시선과 웹이 자주 따로 논다 — 옆 건물 벽면에
//      걸어놓고 고개는 다른 데를 본다.
//   2. 좌우를 구분하지 않는다. 디버그 오버레이(F3)를 켜자마자 잡혔는데,
//      좌우 최고 점수가 소수점 셋째 자리까지 같았다:
//          좌 [4.114, 3.917, 3.834]   우 [4.114, 3.917, 3.834]
//      즉 어느 손이 잡을지가 사실상 루프 순서로 정해지고 있었다.
//
// 이 파일은 게임도 THREE 도 모른다. 숫자만 받아 숫자를 돌려준다.
// 그래서 테스트가 쉽고, 나중에 다른 엔진으로 그대로 옮길 수 있다.

// ---------- 튜닝 상수 ----------
// 코드에 박지 말고 여기 모아둔다 (문서 §9.2). 전부 플레이로 정할 값이다.
const TUNE = {
  // 의도 벡터의 배합
  SP_REF:      55,    // 이 속도를 '빠름'의 기준으로 본다 (m/s)
  W_CAM_SLOW:  1.60,  // 느릴 때 카메라 비중 — 조준한 곳으로 간다
  W_CAM_FAST:  0.70,  // 빠를 때는 낮춘다. 안 그러면 고개 돌릴 때마다 90도로 꺾인다
  W_MOM_SLOW:  0.25,  // 느릴 때 관성 비중
  W_MOM_FAST:  1.55,  // 빠를 때는 관성이 주도한다 (급snap 방지)
  W_MOVE:      0.55,  // WASD 방향
  W_TURN:      0.90,  // A/D 만의 옆 편향 — "왼쪽으로 꺾고 싶다"

  // 점수
  W_FWD:       1.60,  // 의도 방향과의 일치도
  W_LEN:       1.20,  // 줄 길이의 질
  W_STEEP:     0.80,  // 머리 바로 위는 그네가 아니라 정지다
  W_HIGH:      1.10,  // 높을수록 좋지만 필수는 아니다
  W_HAND:      0.55,  // 손 쪽 편향 — 기계적 교대가 되지 않을 만큼만
  W_ALT:       0.30,  // 직전에 쓴 손의 반대쪽에 주는 보너스 (문서 §18)
  W_SHARP:     1.30,  // 급선회 벌점 (빠를수록 커진다)

  LEN_BEST:    0.62,  // 최대 사거리의 62% 근처가 제일 좋은 호를 만든다
  LEN_SPAN:    0.45,
  DROP_MAX:    14,    // 이보다 아래는 그네가 아니라 추락
  BACK_MIN:    -0.15, // 의도 방향 기준 이보다 뒤면 버린다
};

// ---------- 부채꼴 ----------
// legacy 는 ±55도였다. 레퍼런스는 저고도 골목에서 바로 옆 건물 '벽면'에
// 거는 장면이 지배적이라 그 각도로는 후보에 아예 안 잡힌다. 옆으로 넓힌다.
// 손 쪽을 더 촘촘히 훑어서 왼손이면 왼쪽에서 더 좋은 후보를 찾게 한다.
const FAN_YAW  = [0, 15, -15, 32, -32, 52, -52, 74, -74, 96, -96];
const FAN_PITCH = [34, 44, 24, 56, 14, 68, 4, -6];

// 손 쪽 각도를 앞쪽으로, 반대쪽을 뒤로 살짝 민다.
// 완전히 한쪽만 보게 하지는 않는다 — 문서 §11 "기계적으로 만들지 않는다".
const FAN_SKEW = 10;
function fanYaw(hand) {
  const s = hand === "L" ? -1 : hand === "R" ? 1 : 0;
  return FAN_YAW.map(y => y + FAN_SKEW * s * (Math.abs(y) > 40 ? 1 : 0.35));
}

function norm2(x, z) {
  const l = Math.hypot(x, z);
  return l > 1e-6 ? { x: x / l, z: z / l, l } : { x: 0, z: 0, l: 0 };
}

// ---------- 의도 벡터 ----------
// 카메라 + 관성 + WASD + 선회를 하나로 합친다 (문서 §9.2).
//
// 핵심 원칙 하나: **속도가 높을수록 관성이 이긴다.** 빠르게 날고 있는데
// 고개를 홱 돌렸다고 앵커가 90도 옆에 걸리면 그건 조작이 아니라 사고다.
function intentDir(ctx) {
  const yaw = ctx.camYaw || 0;
  const fx = Math.sin(yaw), fz = Math.cos(yaw);        // 시선(수평)
  const rx = -Math.cos(yaw), rz = Math.sin(yaw);       // 오른쪽
  const sp = Math.hypot(ctx.vx || 0, ctx.vz || 0);
  const k = Math.min(1, sp / TUNE.SP_REF);             // 0 느림 .. 1 빠름

  const wCam = TUNE.W_CAM_SLOW + (TUNE.W_CAM_FAST - TUNE.W_CAM_SLOW) * k;
  const wMom = TUNE.W_MOM_SLOW + (TUNE.W_MOM_FAST - TUNE.W_MOM_SLOW) * k;

  let x = fx * wCam, z = fz * wCam;

  const m = norm2(ctx.vx || 0, ctx.vz || 0);
  x += m.x * wMom; z += m.z * wMom;

  // WASD 를 세계 방향으로. 게임의 규약과 같다: fwd * (-iz) + right * ix
  const ix = ctx.moveX || 0, iz = ctx.moveZ || 0;
  const w = norm2(fx * -iz + rx * ix, fz * -iz + rz * ix);
  x += w.x * TUNE.W_MOVE; z += w.z * TUNE.W_MOVE;

  // A/D 만의 옆 편향. "왼쪽으로 꺾고 싶다"는 의도는 이동과 별개다 —
  // 이게 있어야 A 를 누른 채 웹을 쏠 때 왼쪽 건물이 잡힌다.
  x += rx * ix * TUNE.W_TURN; z += rz * ix * TUNE.W_TURN;

  const n = norm2(x, z);
  return { x: n.x, z: n.z, speedK: k, speed: sp };
}

// ---------- 후보 점수 ----------
// 반환: { score, why }  — why 는 기각 사유 (디버그 패널이 읽는다)
//
// 요소를 7개로 묶었다. 문서 §12 가 경고한 대로 더 늘리면 디버깅이 불가능해진다.
function scoreAnchorV2(c, ctx, intent) {
  const dx = c.x - ctx.px, dy = c.y - ctx.py, dz = c.z - ctx.pz;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < ctx.minLen) return { score: -1, why: "짧음" };
  if (len > ctx.ropeMax) return { score: -1, why: "멂" };
  if (dy < -TUNE.DROP_MAX) return { score: -1, why: "아래" };

  const h = Math.hypot(dx, dz) || 1;
  const hx = dx / h, hz = dz / h;

  // 1. 의도 방향과의 일치도. legacy 는 여기에 viewYaw 를 썼다.
  const fwd = hx * intent.x + hz * intent.z;
  if (fwd < TUNE.BACK_MIN) return { score: -1, why: "뒤" };

  // 2. 급선회 벌점. 지금 가는 방향에서 얼마나 꺾어야 하는가.
  //    빠를수록 크게 문다 — 고속에서 90도 꺾이면 속도가 통째로 날아간다.
  let sharp = 0;
  if (intent.speed > 6) {
    const m = norm2(ctx.vx, ctx.vz);
    const md = hx * m.x + hz * m.z;                 // -1 정반대 .. 1 같은 방향
    sharp = Math.max(0, (1 - md) * 0.5) * intent.speedK;
  }

  // 3. 줄 길이의 질
  const r = len / ctx.ropeMax;
  const lenScore = 1 - Math.min(1, Math.abs(r - TUNE.LEN_BEST) / TUNE.LEN_SPAN);

  // 4. 머리 바로 위 회피
  const steep = Math.min(1, h / Math.max(1, Math.abs(dy)));

  // 5. 높이
  const high = Math.max(0, Math.min(1, (dy + TUNE.DROP_MAX) / 45));

  // 6. 손 쪽 편향 (문서 §11). 오른손은 오른쪽을 선호한다.
  //    다만 W_HAND 를 작게 둬서 관성·방향이 여전히 이긴다.
  const yaw = ctx.camYaw || 0;
  const rx = -Math.cos(yaw), rz = Math.sin(yaw);
  const lat = hx * rx + hz * rz;                    // + 오른쪽, - 왼쪽
  const side = ctx.hand === "L" ? -1 : ctx.hand === "R" ? 1 : 0;
  const handScore = lat * side;

  // 7. 교대 (문서 §18). 직진할 때는 좌우 점수가 거의 같아져서 어느 손이
  //    잡을지가 다시 우연이 된다. 직전과 반대 손에 작은 보너스를 준다.
  //    기계적인 R->L->R 이 아니라, 비슷할 때만 갈리게 하는 정도다.
  const alt = (ctx.lastHand && ctx.hand && ctx.hand !== ctx.lastHand) ? 1 : 0;

  const score =
      fwd       * TUNE.W_FWD
    + lenScore  * TUNE.W_LEN
    + steep     * TUNE.W_STEEP
    + high      * TUNE.W_HIGH
    + handScore * TUNE.W_HAND
    + alt       * TUNE.W_ALT
    - sharp     * TUNE.W_SHARP;

  return { score, why: "", lat, fwd, sharp, len };
}

export { TUNE, FAN_YAW, FAN_PITCH, FAN_SKEW, fanYaw, intentDir, scoreAnchorV2, norm2 };
