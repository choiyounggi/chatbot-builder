// A test skill server for the end-to-end tests: POST /order answers like a shop's order API.
import { createServer } from "node:http";

const port = Number(process.env.SKILL_PORT ?? 8799);
createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    if (req.method !== "POST" || req.url !== "/order") {
      res.writeHead(404, { "Content-Type": "application/json" }).end("{}");
      return;
    }
    const request = JSON.parse(body || "{}");
    const no = request?.action?.params?.no ?? "?";
    res.writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ order: `A-${no}`, status: "배송 중", key: req.headers["x-shop-key"] ? "yes" : "no" }));
  });
}).listen(port, "127.0.0.1");
