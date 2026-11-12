// A test LLM for the end-to-end tests: an OpenAI-compatible POST /v1/chat/completions that answers
// "안내해 드릴게요. " + the first sentence of [자료 1]'s text (after its heading line). Deterministic, no model.
import { createServer } from "node:http";

const port = Number(process.env.LLM_PORT ?? 8798);
createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404, { "Content-Type": "application/json" }).end("{}");
      return;
    }
    let request;
    try {
      request = JSON.parse(body || "{}");
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" }).end('{"error":"not JSON"}');
      return;
    }
    const messages = Array.isArray(request?.messages) ? request.messages : [];
    const user = String(messages.find((m) => m?.role === "user")?.content ?? "");
    const system = String(messages.find((m) => m?.role === "system")?.content ?? "");
    if (system.includes("오타 생성기") || system.includes("학습 데이터")) { // the builder's "LLM으로 더 만들기"
      const first = /^- (.+)$/m.exec(user)?.[1] ?? "문장";
      const items = system.includes("오타 생성기")
        ? { typo: [`${first} 오타`, first] } // the second repeats the original: the engine marks it
        : { casual: [`${first} 좀`], paraphrase: [`${first} 부탁해요`], synonym: [] };
      res.writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ model: request.model, choices: [{ index: 0, finish_reason: "stop",
          message: { role: "assistant", content: JSON.stringify(items) } }] }));
      return;
    }
    const passage = /\[자료 1\] [^\n]*\n([^\n]*)/.exec(user)?.[1] ?? "";
    const first = /^.*?[.!?](?=\s|$)/.exec(passage)?.[0] ?? passage;
    const content = first ? `안내해 드릴게요. ${first}` : "네";
    res.writeHead(200, { "Content-Type": "application/json" })
      .end(JSON.stringify({ model: request.model, choices: [{ index: 0, message: { role: "assistant", content } }] }));
  });
}).listen(port, "127.0.0.1");
