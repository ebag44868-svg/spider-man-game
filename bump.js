// 배포할 때마다 game3d.js 주소에 버전을 붙여 캐시를 무력화한다.
// 깃허브 Pages는 max-age=600을 강제해서, 주소가 같으면 아이패드가 10분간 옛 파일을 쓴다.
const fs = require("fs");
const F = "game3d.html";
let h = fs.readFileSync(F, "utf8");
const v = Date.now().toString(36);
const before = h;
h = h.replace(/src="\.\/game3d\.js(\?v=[^"]*)?"/, `src="./game3d.js?v=${v}"`);
if (h === before) { console.error("script 태그를 못 찾음"); process.exit(1); }
fs.writeFileSync(F, h);
console.log("cache bust: v=" + v);
