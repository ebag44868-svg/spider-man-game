// 도로를 달리는 자동차.
// 도로 격자를 따라 실제로 달린다. 뉴욕이라 노란 택시 비중을 높게 잡았다.
// 애비뉴는 실제처럼 일방통행(차선마다 방향이 정해짐), 스트리트는 양방향.
//
// game3d.js에서 그대로 옮겨온 코드다. updateCars는 한 줄도 바꾸지 않았다.
// 바꾼 것은 두 가지뿐이다.
//   · 차 배치·인스턴스 메시 2장·색칠을 initCars() 안으로 모았다
//   · scene / boxGeo / dummy 와 도로 격자 상수 6개를 import 대신 주입받는다
//     (import하면 game3d.js와 순환 참조가 된다)
//
// 생성 순서는 원래와 똑같다. initCars()를 game3d.js가 원래 차를 깔던 바로 그
// 자리에서 부르기 때문이다. 이 구간은 Math.random()을 수백 번 쓰고 THREE 객체도
// 만든다. 순서가 한 칸만 밀려도 도시와 적 구성이 통째로 달라진다
// (tools/check-rng.mjs 가 그걸 감시한다).

// 브라우저는 importmap으로 "three"를 이 파일로 보낸다. 여기서는 상대경로를 직접 쓴다 —
// 테스트 하네스(Node)에는 importmap이 없고, 어차피 같은 파일로 해석되어 인스턴스도 하나다.
import * as THREE from "../lib/three.module.js";
import { CAR_SCALE } from "./scale.js";

// game3d.js에서 주입받는다. 도로 격자 상수는 이름을 그대로 쓴다 —
// 옮겨온 코드를 한 글자도 안 고치려면 이 이름들이 그대로 보여야 한다.
let scene = null, boxGeo = null, dummy = null;
let N_AVE = 0, N_ST = 0, AVE_SPACING = 0, ST_SPACING = 0, AVE_C = 0, ST_C = 0;

const cars = [];
// 실제 차 크기 × 15 (src/scale.js). 도시가 사람 기준 3배라 실제 크기는 점으로 보였다.
const CAR_L = 4.6 * CAR_SCALE, CAR_W = 1.95 * CAR_SCALE, CAR_H = 1.35 * CAR_SCALE;
// let 이지만 export는 살아 있는 바인딩이라, game3d.js도 대입된 뒤의 값을 본다.
let carBodyMesh = null, carTopMesh = null;
let CAR_HALF_X = 0, CAR_HALF_Z = 0;

// game3d.js가 원래 차를 깔던 그 자리에서 한 번 부른다.
function initCars(sc, geo, dm, city) {
  scene = sc;
  boxGeo = geo;
  dummy = dm;
  ({ N_AVE, N_ST, AVE_SPACING, ST_SPACING, AVE_C, ST_C } = city);

  {
    // 차는 '개수'가 아니라 '간격'으로 깔아야 한다.
    // 차선당 몇 대씩 두면 월드가 2.5km라 360m에 한 대꼴이 돼서 텅 빈 도로가 된다.
    const LEN_Z = N_ST * ST_SPACING, LEN_X = N_AVE * AVE_SPACING;
    // 차 폭이 29m 라 애비뉴(차도 62m)엔 2차선, 스트리트(차도 36m)엔 1차선만 들어간다.
    // 같은 차선의 차는 같은 속도로 달린다 — 길이 69m 짜리가 앞차를 뚫고 지나가면 바로 보인다.
    const laneOff = [-15.5, 15.5];             // 애비뉴 2차선
    for (let ai = 0; ai < N_AVE - 1; ai++) {
      const cx = (ai - AVE_C) * AVE_SPACING + AVE_SPACING / 2;
      const oneWay = ai % 2 === 0 ? 1 : -1;    // 애비뉴별 일방통행
      for (const off of laneOff) {
        const speed = 16 + Math.random() * 12;
        for (let z = -LEN_Z / 2; z < LEN_Z / 2; z += 100 + Math.random() * 140) {
          cars.push({ axis: 'z', x: cx + off, z, dir: oneWay, speed });
        }
      }
    }
    for (let si = 0; si < N_ST - 1; si++) {    // 스트리트 1차선 (뉴욕 스트리트는 대부분 일방통행)
      if (Math.random() < 0.5) continue;
      const cz = (si - ST_C) * ST_SPACING + ST_SPACING / 2;
      const speed = 11 + Math.random() * 8;
      const dir = si % 2 === 0 ? 1 : -1;
      for (let x = -LEN_X / 2; x < LEN_X / 2; x += 110 + Math.random() * 160) {
        cars.push({ axis: 'x', x, z: cz, dir, speed });
      }
    }
  }

  carBodyMesh = new THREE.InstancedMesh(
    boxGeo, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.35 }), cars.length);
  carTopMesh = new THREE.InstancedMesh(
    boxGeo, new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.15, metalness: 0.2 }), cars.length);
  {
    const c = new THREE.Color();
    cars.forEach((car, i) => {
      const r = Math.random();
      if (r < 0.42) c.setHex(0xf2b70c);        // 노란 택시
      else if (r < 0.58) c.setHex(0xe8e8ea);
      else if (r < 0.72) c.setHex(0x23262b);
      else if (r < 0.84) c.setHex(0x6d7580);
      else if (r < 0.93) c.setHex(0x8d2626);
      else c.setHex(0x1f3d68);
      carBodyMesh.setColorAt(i, c);
    });
  }
  carBodyMesh.castShadow = true;
  carTopMesh.castShadow = false;   // 차체 그림자에 어차피 묻힌다
  carBodyMesh.frustumCulled = false;
  carTopMesh.frustumCulled = false;
  scene.add(carBodyMesh);
  scene.add(carTopMesh);

  CAR_HALF_X = (N_AVE * AVE_SPACING) / 2, CAR_HALF_Z = (N_ST * ST_SPACING) / 2;

  updateCars(0);
}

function updateCars(dt) {
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    if (car.axis === "z") {
      car.z += car.dir * car.speed * dt;
      // 끝에 닿으면 반대편에서 다시 들어온다
      if (car.z > CAR_HALF_Z) car.z = -CAR_HALF_Z;
      else if (car.z < -CAR_HALF_Z) car.z = CAR_HALF_Z;
      dummy.rotation.set(0, car.dir > 0 ? 0 : Math.PI, 0);
      dummy.scale.set(CAR_W, CAR_H, CAR_L);
    } else {
      car.x += car.dir * car.speed * dt;
      if (car.x > CAR_HALF_X) car.x = -CAR_HALF_X;
      else if (car.x < -CAR_HALF_X) car.x = CAR_HALF_X;
      dummy.rotation.set(0, car.dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0);
      dummy.scale.set(CAR_W, CAR_H, CAR_L);
    }
    dummy.position.set(car.x, 0.05, car.z);
    dummy.updateMatrix();
    carBodyMesh.setMatrixAt(i, dummy.matrix);

    // 캐빈(지붕)은 차체보다 작고 살짝 뒤쪽에
    dummy.scale.set(CAR_W * 0.86, CAR_H * 0.62, CAR_L * 0.48);
    dummy.position.set(car.x, 0.05 + CAR_H, car.z);
    dummy.updateMatrix();
    carTopMesh.setMatrixAt(i, dummy.matrix);
  }
  carBodyMesh.instanceMatrix.needsUpdate = true;
  carTopMesh.instanceMatrix.needsUpdate = true;
}

export {
  initCars, updateCars, cars,
  carBodyMesh, carTopMesh,
  CAR_L, CAR_W, CAR_H,
};
