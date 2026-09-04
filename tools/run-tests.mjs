// 회귀 테스트 러너.
//
// 하는 일은 두 가지뿐이다.
//   1) game3d.js 로부터 테스트 하네스를 새로 만든다 (항상 최신 코드로 검증하려고)
//   2) 합/불을 내는 테스트 파일을 순서대로 돌리고 합계를 출력한다
//
// 진단용 스크립트(_play, _duel, _stall 등)는 여기 넣지 않는다.
// 그쪽은 수치를 재는 도구지 통과/실패가 없어서, 섞으면 회귀 판정이 흐려진다.
// 그건 `npm run bench` 로 따로 돌린다.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// 통과/실패를 출력하는 회귀 테스트. 순서는 싼 것부터.
const SUITE = [
  "_regress.mjs",     // 벽 관통 · 벽타기 · 착지 · 벽점프 · 웹스윙 · 장시간 구동
  "_input.mjs",       // 1인칭/3인칭 조작 분리 · 시점 모드 · 카메라 방향 고정
  "_atk.mjs",         // 원거리 조준 정확도 (거리별 + 대조군)
  "_lock.mjs",        // 락온 · TAB 3모드 순환 · Ctrl 해방
  "_melee.mjs",       // 근접 격투 전반 (약/강/패링/구르기/체간/처형/접근)
  "_brawl.mjs",       // 격투병 패턴 · 간격 유지
  "_real.mjs",        // 실전 상황 재현 (락온 없이 · 공중 · X키 주먹)
  "_round.mjs",       // 조작 개편 항목 + 에임 + 체력바
  "_rig.mjs",         // 적 팔다리 리그 · 회피 대시 · 애니메이션 슬롯
  "_wallenemy.mjs",   // 적이 벽 속으로 안 들어가는지
];

// Node가 뱉는 잡음(ESM 경고, 실험 기능 안내)은 결과 판독을 방해한다.
const NOISE = /warning|reparsing|eliminate this warning|trace-warnings|experimentalwarning|localstorage/i;
const clean = (s) => s.split("\n").filter((l) => !NOISE.test(l)).join("\n");

function run(cmd, args, label) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf8", shell: false });
  if (r.error) {
    console.error(`  ${label} 실행 실패: ${r.error.message}`);
    return { out: "", code: 1 };
  }
  return { out: clean((r.stdout || "") + (r.stderr || "")), code: r.status ?? 1 };
}

// --- 1) 하네스 생성 ---
const gen = run(process.execPath, ["tools/mkharness.cjs"], "하네스");
if (gen.code !== 0 || !existsSync(join(ROOT, "_harness.mjs"))) {
  console.error("하네스를 만들지 못했습니다. game3d.js 문법을 먼저 확인하세요.");
  console.error(gen.out.trim());
  process.exit(1);
}

// --- 2) 테스트 실행 ---
const t0 = Date.now();
let totalPass = 0, totalFail = 0, crashed = 0;
const rows = [];

for (const file of SUITE) {
  if (!existsSync(join(ROOT, file))) {
    rows.push([file, "파일 없음", true]);
    crashed++;
    continue;
  }
  const { out, code } = run(process.execPath, [file], file);
  // 한 파일이 여러 번 합계를 찍기도 한다(중간 소계 + 최종). 마지막 것이 진짜다.
  const all = [...out.matchAll(/통과 (\d+) \/ 실패 (\d+)/g)];
  const last = all[all.length - 1];
  if (!last) {
    rows.push([file, code === 0 ? "합계 출력 없음" : `크래시 (exit ${code})`, true]);
    crashed++;
    if (out.trim()) console.error(out.trim().split("\n").slice(-8).join("\n"));
    continue;
  }
  const pass = +last[1], fail = +last[2];
  totalPass += pass; totalFail += fail;
  rows.push([file, `통과 ${pass} / 실패 ${fail}`, fail > 0]);
}

const ms = Date.now() - t0;

// --- 3) 결과 ---
for (const [file, text, bad] of rows) {
  console.log(`  ${bad ? "FAIL" : "ok  "}  ${file.padEnd(16)} ${text}`);
}
console.log("  " + "-".repeat(44));
console.log(`  합계  통과 ${totalPass} / 실패 ${totalFail}${crashed ? ` / 실행 못함 ${crashed}` : ""}`);
console.log(`  시간  ${(ms / 1000).toFixed(2)}초`);

if (totalFail > 0 || crashed > 0) {
  console.log("\n  baseline보다 실패가 늘었는지 확인하세요. 늘었다면 다음 작업으로 넘어가지 않습니다.");
  process.exit(1);
}
