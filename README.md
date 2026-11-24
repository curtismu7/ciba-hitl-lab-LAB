# CIBA HITL LAB

Tier: Demo
Repo: https://github.com/curtismu7/ciba-hitl-lab-LAB
Catalog: C1 (provisional, owner to confirm)
Ports: 7580-7589 (default 7580)

Twenty-four steps from scope to tool, with a human in the loop. One login (full scope consent, once), one agent identity, ONE RFC 8693 token exchange: the OBO token keeps the FULL scope set — per-tool narrowing never happens in the token, the Authorize policy does it. A write is DENIED with a CIBA identifier (403); the gateway rewrites the 403 into a JSON-RPC 2.0 error so SDKs that treat raw 403s as fatal keep the session; the human approves; the agent replays with the identifier header; Authorize verifies the CIBA record (never the agent's word) and PERMITs; the tool runs and the response is inspected on the way back. Steps 19-24 are owner-named (2026-11-03).

## What is simulated

**Everything here is SIMULATED.** **Mock mode: everything is SIMULATED** — in-process mock IAM, mock Authorize policy, mock CIBA, mock gateway, mock MCP/RS; every token is mock and labelled; the banner on every page says so. **Real mode: the agent identity and the token exchange run against YOUR PingOne tenant** (owner-configured); the policy decision, the CIBA identifier flow and the MCP tool execution stay SIMULATED app-side in both modes, and the banner names them.

## Run from a clone

```bash
npm ci
npm test          # server (node --test) + web (vitest) + repo checks
npm run doctor    # preflight: ports, hosts, netguard, the mock write cycle behaves as written
npm start         # http://localhost:7580
./scripts/run.sh  # same, checks the port first
```

Endpoints: `GET /api/health`, `GET /api/catalog`, `POST /api/write`, `POST /api/approve`, `POST /api/deny`, `POST /api/decode`, `POST /api/reset`, `POST /api/mode`, `GET /api/info`.

## What each layer logged for this run (rule 27)

The Run tab shows the shared panel under the run: one write call across the six layers. Rows are what the lab's flow computed for that call; nothing is read from a product log.

- **Where the lines live.** The lab process's stdout: one line per decision, `<time> ciba-hitl-lab decision step=... layer=... actor=... result=passed|stopped|unclear run=<id>`. Every value passes the masker and the line sanitiser; no field names a matcher word, a token or an identifier.
- **What is a decision.** The OBO exchange is an allowed Privilege-layer row (the token minted with its actor claim). The write's policy decision is the Authorize layer: refused on the first call (DENY with a CIBA identifier), allowed on an approved replay (PERMIT, single use). The gateway's JSON-RPC rewrite of the raw 403 repeats that decision, so it is information; the mock resource server's tool run is the Resource server row. A denied write never reaches the resource server.
- **The chain.** Person is the persona's sub and Agent is the agent client id, both read from the OBO token the run itself minted (simulated); Scopes are the token's scope claim, read back from the run's answer; the Policies node is the write decision (the mock Authorize policy's deny or permit, with the CIBA identifier as its id).
- **No run, no record.** An approve, a deny, an expire or a Reset began no run (they change a CIBA record the NEXT replay reads): the page says so and shows no older record. The lab keeps the last 12 runs; Reset clears them.
- **Real mode.** The token legs run live against the owner's tenant and the run is recorded the same way; the decision, the rewrite and the tool execution stay simulated, and the panel's rows say which is which.

How it fits together: `docs/architecture.md`. What is honest and what is not: `docs/safety.md`. Sources: `docs/references.md`. Owner-only live comparisons: `docs/live-checks.md`. Generated from the step data: `docs/talk-track.md`, `content-pack.json`, `docs/shelf-entry.json`.

## Settings file

Real mode reads the ONE shared settings file `~/Development/.env` (never a per-app file):
`PINGONE_ENVIRONMENT_ID`, Worker app client id + secret, `CIBA_LAB_PERSON_TOKEN` (a real person access token from your own sign-in — agents never sign a person in), `CIBA_LAB_AUDIENCE`, optional `CIBA_LAB_SCOPE` and `CIBA_LAB_AGENT_SCOPE`. See `.env.example`.

## Try it

1. **Flow tab**: press Simulate and walk all 24 steps; click any step for what/why/open; drag boxes, Reset restores the layout.
2. **Live run tab**: Call the write tool -> DENY + identifier + the JSON-RPC 2.0 error. Approve as the human, replay with the identifier -> PERMIT, the tool result returns. Replay again with the same identifier -> denied (single use).
3. **Real button**: disabled with a how-to until the `PINGONE_*` + `CIBA_LAB_*` variables exist in `~/Development/.env` (restart after setting).

### Postman

`postman/ciba-hitl-lab.postman_collection.json` drives the beat without the UI: the write tool (DENY + identifier, chained via a collection variable), the tokenless negative, Approve (state becomes `approved`), the expire path, the decode negative and Reset. No environment needed — every server is an in-process labelled mock.

```
node ../../shared/postman/generator.mjs --spec postman/spec.json            # regenerate (never hand-edit the output)
npx newman run postman/ciba-hitl-lab.postman_collection.json
```

## Ports

7580-7589, default 7580. Start with `PORT=<other port in 7580-7589> npm start`.

## Ports, and what to do if the port is taken

7580-7589, default 7580. If it is taken, find the holder with `lsof -iTCP:7580 -sTCP:LISTEN -n -P` and start with `PORT=<other port in 7580-7589> npm start`.

## Mock and Real modes

Mock (default): in-process mock IAM, Authorize policy, CIBA, gateway, MCP and RS; fully offline; the netguard proves zero outbound. Real: the agent identity and the token exchange run against YOUR PingOne tenant from `~/Development/.env` (owner-set); policy, gateway rewrite and MCP stay simulated in both modes. The toggle is in the header of every page; switching reloads all data without a restart.

## Health, doctor and reset

`GET /api/health` returns `demo-health/1`. `npm run doctor` runs the same checks plus a full HTTP cycle (write -> deny -> approve -> permit) and the port check. `npm run reset` (or the Reset control) clears the approval records so identifiers deny again.

## Docker

OrbStack, never Docker Desktop: `HOST_PORT=7580 docker compose up --build -d` -> http://127.0.0.1:7580 (published on 127.0.0.1 only; the container binds 0.0.0.0 via `CIBA_BIND`).

## Tests

`npm test` runs the server tests (node --test), the web tests (vitest) and the repo checks. `npm run mutation-check` pins the policy rule, the single-use identifier, sub/act and the safety middlewares (8 mutants, all killed). `npm run content-pack` rebuilds `content-pack.json`; `npm run talk-track` rebuilds `docs/talk-track.md`.

## Troubleshooting

- **Real button disabled.** Set the `PINGONE_*` + `CIBA_LAB_*` variables in `~/Development/.env` and restart.
- **Port taken.** See the Ports section.
- **Container unhealthy.** `docker compose up --build` again; the healthcheck needs `demo-health/1` ready.

## Ownership

Owned by the owner's AI-DEMO2 session (2026-11-03). Ports 7580-7589. Catalog id C1 is provisional until the owner assigns a real one. GitHub repo, runner and shelf entry need owner approval.
