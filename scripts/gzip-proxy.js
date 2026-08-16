// gzip-proxy.js — 本地 gzip 反向代理：把 dsh 的一次性 JSON 响应压缩后再下发。
// 手机链路: 手机 -> tailscale serve (443) -> 本代理 (127.0.0.1:3081) -> dsh web (127.0.0.1:3080)
// 只压缩可压缩的 JSON/text 且 >= 阈值；WebSocket 长连接直通，不做压缩。
"use strict";
const http = require("http");
const net = require("net");
const zlib = require("zlib");

const LISTEN_HOST = "127.0.0.1";
const LISTEN_PORT = Number(process.env.DSH_GZIP_PORT || 3081);
const TARGET_HOST = "127.0.0.1";
const TARGET_PORT = Number(process.env.DSH_WEB_PORT || 3080);
const MIN_COMPRESS_BYTES = 1024;

function pickEncoding(req, headers, bodyLen) {
  if (bodyLen < MIN_COMPRESS_BYTES) return null;
  if (headers["content-encoding"]) return null; // already encoded
  const ct = String(headers["content-type"] || "");
  if (!/(json|text|javascript|xml|svg|x-www-form-urlencoded)/i.test(ct)) return null;
  const accept = String(req.headers["accept-encoding"] || "");
  if (/\bbr\b/.test(accept)) return "br";
  if (/\bgzip\b/.test(accept)) return "gzip";
  return null;
}

function serializeUpgradeHeaders(headers) {
  let out = "";
  for (const [k, v] of Object.entries(headers)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) out += k + ": " + item + "\r\n";
    else out += k + ": " + v + "\r\n";
  }
  return out + "\r\n";
}

const proxy = http.createServer((req, res) => {
  const upstream = http.request({
    hostname: TARGET_HOST,
    port: TARGET_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: req.headers.host || (TARGET_HOST + ":" + TARGET_PORT) },
  }, (upRes) => {
    const chunks = [];
    upRes.on("data", (c) => chunks.push(c));
    upRes.on("end", () => {
      let body = Buffer.concat(chunks);
      const enc = pickEncoding(req, upRes.headers, body.length);
      if (enc) {
        const compressed = enc === "br" ? zlib.brotliCompressSync(body) : zlib.gzipSync(body);
        const headers = { ...upRes.headers };
        delete headers["content-length"];
        delete headers["transfer-encoding"];
        headers["content-encoding"] = enc;
        headers["content-length"] = compressed.length;
        headers["vary"] = headers["vary"] ? headers["vary"] + ", Accept-Encoding" : "Accept-Encoding";
        res.writeHead(upRes.statusCode, headers);
        res.end(compressed);
      } else {
        res.writeHead(upRes.statusCode, upRes.headers);
        res.end(body);
      }
    });
  });
  upstream.on("error", () => { if (!res.headersSent) { res.writeHead(502); } res.end(); });
  req.on("error", () => upstream.destroy());
  req.pipe(upstream);
});

// WebSocket 直通（/api/events.mux、/api/events.host 的实时流）
proxy.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(TARGET_PORT, TARGET_HOST, () => {
    upstream.write(req.method + " " + req.url + " HTTP/1.1\r\n" + serializeUpgradeHeaders(req.headers));
    if (head && head.length) upstream.write(head);
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
  socket.on("close", () => upstream.destroy());
  upstream.on("close", () => socket.destroy());
});

proxy.listen(LISTEN_PORT, LISTEN_HOST, () => {
  console.log("gzip-proxy: " + LISTEN_HOST + ":" + LISTEN_PORT + " -> " + TARGET_HOST + ":" + TARGET_PORT);
});
proxy.on("error", (e) => { console.error("gzip-proxy error:", e.message); process.exit(1); });
