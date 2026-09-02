const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = 8173;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json"
};

http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);

  // 개발용: 페이지가 캡처한 화면을 shots/ 에 저장 (POST /__shot?name=xxx, 본문 = dataURL)
  if (req.method === "POST" && p === "/__shot") {
    const name = (new URL(req.url, "http://x").searchParams.get("name") || "shot")
      .replace(/[^a-z0-9_-]/gi, "");
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      const b64 = body.replace(/^data:image\/\w+;base64,/, "");
      fs.mkdirSync(path.join(root, "shots"), { recursive: true });
      fs.writeFileSync(path.join(root, "shots", name + ".jpg"), Buffer.from(b64, "base64"));
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
    });
    return;
  }

  if (p === "/") p = "/game3d.html";
  const file = path.normalize(path.join(root, p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("404"); }
    res.writeHead(200, { "Content-Type": mime[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
}).listen(port, () => console.log(`server running: http://localhost:${port}`));
