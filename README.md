# chatbot-builder

A builder UI for [chatbot-engine](https://github.com/choiyounggi/chatbot-engine): edit blocks
(intents + scenarios), entities, skills and a knowledge base, test a draft, deploy and roll back.

> Status: B3 — bot list, scenario/block editor (examples, parameters with optional/default, block
> groups, text / image / card / list / carousel replies, buttons and quick replies that move to a block),
> 기본 시나리오 (welcome, fallback, escape, scenario settings), entity panel, bot test panel (chat with a
> test build of the saved draft: welcome messages, rich messages, block buttons, what the engine decided),
> one shared draft saved with its ETag. The other menus say which step builds them.
> Plan: [docs/builder-plan.md](docs/builder-plan.md) (Korean).

## Run it

Needs Node 24+ and a running engine.

```sh
# 1. the engine (in the chatbot-engine checkout)
make serve                               # 127.0.0.1:8000; CHATCORE_ADMIN_TOKEN=... to require a token

# 2. the builder (here)
npm ci
npm run dev                              # http://127.0.0.1:5173, proxies /v1 to the engine
```

`CHATCORE_ENGINE_URL=http://host:port npm run dev` points the proxy at another engine.
If the engine runs with `CHATCORE_ADMIN_TOKEN`, the builder asks for it once per browser tab.

## Check

```sh
npm run check   # tsc + eslint + vitest (coverage gate) — the same as CI
npm run build   # production bundle in dist/
npm run gen:api # regenerate src/api/schema.d.ts from the engine (ENGINE_OPENAPI=path/to/openapi.json)
ENGINE_DIR=../chatbot-engine npm run e2e   # Playwright against a real engine (hashing embedder, no model)
```
