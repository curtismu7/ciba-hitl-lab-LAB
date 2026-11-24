// Rule 27: this lab's side of the shared run-observability panel. The vendored collector (runObservability.js) is never edited here;
// this is the one file that maps this lab's decisions onto the six layers. This lab reads no logs, so it vendors the core only: no
// readers file and no reader setting anywhere.
//
// What a run is here. ONE write call (POST /api/write): the flow computed the whole leg once (the token legs, the policy decision, the
// JSON-RPC rewrite or the tool run), so the rows are steps that answer holds and nothing is computed twice. The approve/deny/expire
// routes change a CIBA record the NEXT replay reads; they began no run of their own — the answer says so instead of showing an older record.
//
// Which layer holds what. The RFC 8693 exchange and its policy are the Privilege layer (an allowed row: the exchange granted the OBO
// token; this lab's mock Authorize does not refuse it). The write's policy decision (DENY with identifier / PERMIT) is the Authorize
// layer. The gateway's JSON-RPC rewrite of the raw 403 is the Agent gateway row (information: the rewrite repeats the decision above
// it). The MCP tool run (or its absence) is the Resource server row. The person is the persona's sub; the agent is the agent client id;
// the scopes are the OBO token's scope claim, read back from the run's own answer.
//
// Stdout line: `<iso> ciba-hitl-lab decision step=<step> layer=<layer> actor=<who> result=passed|stopped|unclear run=<id>`, one per
// decision, stamped once. Every value passes the masker and the line sanitiser; no field names a matcher word.
import crypto from 'node:crypto';
import { createMasker, createRunObservability, LAYERS } from './runObservability.js';

export const SERVICE = 'ciba-hitl-lab';
export const KEEP_RUNS = 12; // closed runs kept: a replay reads the CIBA record an approve left, so the last few are enough
export const NO_RUN_BEGAN = 'This request began no run, so nothing was recorded.';
export const RECORDER_DOWN = 'The lab could not keep a record of this run (the server log says why).';
export const NO_LONGER_KEPT = 'That run is no longer kept: the lab keeps the last few runs, and Reset clears them.';

// Only safe characters survive, so a typed identifier cannot add a second key=value pair, a quote or a line.
export const lineValue = (v, n = 64) => String(v ?? '').replace(/[^A-Za-z0-9._:/@-]+/g, '_').slice(0, n) || '-';
const MATCHER_WORDS = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served|unauthori[sz]ed|insufficient/gi;
const { mask } = createMasker();
const field = (v) => lineValue(mask(String(v ?? ''))).replace(MATCHER_WORDS, '_');
const RESULT = { allowed: 'passed', refused: 'stopped', blocked: 'stopped', info: 'unclear' };

// A recorder that throws must never break the run or the answer: the failure goes to stderr and the run goes on. Only a code (or the
// error's name) is written, never the error's text.
export function reportFailure(where, err) {
  process.stderr.write(`[${SERVICE}] run observability: ${lineValue(where, 40)} ${lineValue(err?.code || err?.name || 'error', 40)} (the error's text is not logged)\n`);
}
export function safely(where, fn) {
  try { return fn(); } catch (err) { reportFailure(where, err); return undefined; }
}

const PRODUCT = {
  person: 'lab mock', agent: 'lab mock agent client', privilege: 'lab mock IAM exchange',
  authorize: 'lab mock Authorize policy', gateway: 'lab mock gateway', resource: 'lab mock MCP resource server',
};

// The decisions one write call computed (flow.js writeCall): the answer is the single source. `identifierHeader` says whether the call
// replayed with one. Every row here is the flow's own event, computed once.
export function writeEvents(run) {
  if (!run || typeof run !== 'object') return [];
  const claims = run.obo?.claims ?? {};
  const sub = typeof claims.sub === 'string' ? claims.sub : null;
  const agent = typeof claims.act?.sub === 'string' ? claims.act.sub : null;
  const scopes = typeof claims.scope === 'string' ? claims.scope.split(/\s+/).filter(Boolean).slice(0, 20) : [];
  const chain = {
    ...(sub ? { user: sub } : {}),
    ...(agent ? { agent } : {}),
    ...(scopes.length ? { scopes } : {}),
  };
  const ev = (layer, step, outcome, message, detail = {}) => ({
    layer, product: PRODUCT[layer], step, outcome, who: agent ?? sub ?? 'the application', message, detail: { ...detail, ...chain },
  });
  const evs = [];
  // The exchange (steps 1-7): the OBO token was minted with the actor claim. An allowed Privilege-layer row.
  evs.push(ev('privilege', 'obo-exchange', 'allowed',
    `The mock exchange granted the OBO token: subject kept, actor ${agent ? 'added' : 'absent'}, audience moved to the AI gateway, the full scope set kept. The token does not narrow per tool.`,
    { exchange: 'rfc8693', ...(run.decision?.sub ? { subject: run.decision.sub } : {}) }));
  // The policy decision on the write (step 10 / step 17): DENY with identifier, or PERMIT.
  const permit = run.outcome === 'permit';
  evs.push(ev('authorize', 'write-decision', permit ? 'allowed' : 'refused',
    permit
      ? 'The mock Authorize policy verified the CIBA approval for this identifier (single use) and permitted the write.'
      : 'The mock Authorize policy requires human approval for a write: it denied the call and started a CIBA request, returning the identifier to carry to the replay.',
    { decision: permit ? 'PERMIT' : 'DENY', ...(run.identifier ? { identifier: run.identifier } : {}), ...(run.decision?.reason ? { reason: run.decision.reason } : {}) }));
  // The gateway rewrite (step 12) or the relayed answer (steps 21-24): information, it repeats the decision above it.
  if (!permit) {
    evs.push({
      layer: 'gateway', product: PRODUCT.gateway, step: 'rpc-rewrite', outcome: 'info', who: agent ?? 'the application',
      message: 'The mock gateway rewrote the raw 403 into a JSON-RPC error that carries the CIBA identifier, so the agent can relay it. The rewrite repeats the policy decision above it: it is information, not a second decision.',
      detail: { ...chain, status: 403, ...(run.rpcError?.error?.code !== undefined ? { rpcCode: run.rpcError.error.code } : {}) },
    });
  } else {
    // The tool ran (steps 18-20): the Resource server row.
    const ok = run.mcp?.status === 200;
    evs.push({
      layer: 'resource', product: PRODUCT.resource, step: 'tool-run', outcome: ok ? 'allowed' : 'info', who: agent ?? 'the application',
      message: ok
        ? 'The mock resource server verified the OBO token (audience and actor claim) and ran the tool. Nothing was written to any real system: the record is the mock\'s own.'
        : 'The mock resource server did not accept the OBO token, so the tool did not run.',
      detail: { ...chain, status: run.mcp?.status ?? null, ...(run.mcp?.why ? { why: run.mcp.why } : {}) },
    });
  }
  return evs;
}

// ---- Stdout lines ------------------------------------------------------------------------------------------------------------------------------------
export function decisionLine(ev, runId) {
  return `${ev.at} ${SERVICE} decision step=${lineValue(ev.step)} layer=${lineValue(ev.layer, 12)} actor=${field(ev.who)} result=${RESULT[ev.outcome] ?? 'unclear'} run=${lineValue(runId)}`;
}

// ---- The run log: bounded, one list. Real mode runs the token legs live and is recorded the same way (its legs are real, the decision stays simulated).
export function createRunLog({ write = (line) => process.stdout.write(`${line}\n`), clock = Date.now } = {}) {
  const part = crypto.randomBytes(3).toString('hex'); // so an id never repeats after a restart or in another process
  let made = 0;
  const kept = [];
  const prune = () => { while (kept.length > KEEP_RUNS) kept.shift(); };
  const line = (ev, id) => safely('line', () => write(decisionLine(ev, id)));

  return {
    // One write call = one run. `build` may throw: then nothing is stored and the answer is the baseline's.
    mock(build, { source = 'mock' } = {}) {
      return safely('mock-run', () => {
        const events = build();
        const at = new Date(clock()).toISOString();
        const run = { id: `write-${part}-${++made}`, source, startedAt: at, endedAt: at, events: events.map((e, seq) => ({ ...e, at, seq })), notes: [], partial: false };
        kept.push(run); prune();
        for (const ev of run.events) line(ev, run.id);
        return run.id;
      }) ?? null;
    },
    get(id) { return kept.find((r) => r.id === id) || null; },
    clear() { kept.length = 0; },
    size() { return kept.length; },
  };
}
export const runField = (id) => (id ? { run: { id } } : { run: null, runNote: RECORDER_DOWN });
export const NO_RUN = Object.freeze({ run: null, runNote: NO_RUN_BEGAN });

// ---- The record ----------------------------------------------------------------------------------------------------------------------------------------
const WHY = {
  person: 'The person step shows the persona\'s sub, read from the OBO token the run minted: the lab has no real sign-in.',
  agent: 'This run began no write call (an approve, a deny, an expire or a read): the CIBA record it changed is read by the NEXT replay.',
  authorize: 'This run began no write call, so the mock Authorize policy decided nothing.',
  privilege: 'This run began no write call, so no exchange ran.',
  gateway: 'This run began no write call, so the gateway rewrote nothing.',
  resource: 'A denied write never reaches the mock resource server: the tool runs only after a verified approval.',
};

export async function recordOf(run, { clock = Date.now } = {}) {
  return createRunObservability({ clock }).collectRun({
    runId: run.id, startedAt: run.startedAt, endedAt: run.endedAt, source: run.source,
    layers: LAYERS.map((layer) => {
      const own = run.events.filter((e) => e.layer === layer).map((e) => ({ at: e.at, product: e.product, outcome: e.outcome, message: e.message, detail: { ...e.detail, eventSeq: e.seq } }));
      return { layer, products: [], reason: WHY[layer], simulated: own };
    }),
  });
}
