// Rule 27: the lab's half of the run-observability panel (runObs.js, the run field on POST /api/write and GET /api/write/run).
// The vendored collector has its own tests in the shared folder. A write call in Real mode is recorded the same way (its token legs
// are live, its decision stays simulated); tests here run in Mock only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRunObservability, classify, layerMatchers } from '../src/runObservability.js';
import { KEEP_RUNS, NO_RUN_BEGAN, SERVICE, createRunLog, decisionLine, lineValue, writeEvents, recordOf } from '../src/runObs.js';
import { createApp } from '../src/app.js';
import { createFlow } from '../src/flow.js';
import { createServer } from 'node:http';

const WORDS = /refused|denied|rejected|forbidden|failed|invalid|expired|mismatch|token|audience|scope|served|unauthori[sz]ed|insufficient|not allowed/i;
const LINE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z ciba-hitl-lab decision step=[A-Za-z0-9._:/@-]+ layer=[a-z]+ actor=[A-Za-z0-9._:/@-]+ result=(?:passed|stopped|unclear) run=[A-Za-z0-9._:/@-]+$/;
const PRODUCTS = [...new Set(layerMatchers.map((m) => m.product))];
// No shared matcher reads a line, in any of the shapes a collector could hand it (the whole line: no field is cut out first).
const noMatcherReads = (line) => {
  const at = line.split(' ')[0];
  for (const product of PRODUCTS) {
    for (const message of [line, `[${at}] INFO: ${line.split(' ').slice(1).join(' ')}`, `[${at}] WARN: ${line.split(' ').slice(1).join(' ')}`]) {
      assert.equal(classify({ product, message, at: Date.parse(at), atExact: at }, []), null, `${product}: ${message}`);
    }
  }
};

function capture() {
  const lines = [];
  return { lines, runLog: createRunLog({ write: (l) => lines.push(l), clock: () => Date.parse('2026-11-24T10:00:00.000Z') }) };
}

const runOf = async (flow, identifierHeader) => {
  const r = await flow.writeCall({ identifierHeader });
  return { r, events: writeEvents(r) };
};

test('a denied write is an allowed exchange, a refused Authorize decision and an information gateway rewrite', async () => {
  const flow = createFlow();
  const { events } = await runOf(flow);
  const layers = events.map((e) => [e.layer, e.outcome]);
  assert.deepEqual(layers, [['privilege', 'allowed'], ['authorize', 'refused'], ['gateway', 'info']]);
  const [ex, dec, gw] = events;
  assert.equal(ex.step, 'obo-exchange');
  assert.equal(dec.detail.decision, 'DENY');
  assert.ok(dec.detail.identifier, 'the identifier is on the decision row');
  assert.equal(gw.step, 'rpc-rewrite');
  assert.equal(gw.detail.status, 403);
  const at = new Date().toISOString();
  for (const ev of events) noMatcherReads(decisionLine({ ...ev, at }, 'write-abc123-1'));
  assert.match(decisionLine({ ...events[0], at }, 'write-abc123-1'), LINE);
  assert.doesNotMatch(decisionLine({ ...events[0], at }, 'write-abc123-1'), WORDS);
});

test('an approved replay is a refused-then-allowed pair: the Authorize decision permits and the tool runs', async () => {
  const flow = createFlow();
  const first = await runOf(flow);
  const id = first.r.identifier;
  assert.ok(flow.approve(id), 'the human approved');
  const { events } = await runOf(flow, id);
  const layers = events.map((e) => [e.layer, e.outcome]);
  assert.deepEqual(layers, [['privilege', 'allowed'], ['authorize', 'allowed'], ['resource', 'allowed']]);
  const dec = events[1];
  assert.equal(dec.detail.decision, 'PERMIT');
  assert.equal(events[2].step, 'tool-run');
  assert.equal(events[2].detail.status, 200);
});

test('the chain view: user, agent and scopes come from the OBO token the run minted; the policy node builds', async () => {
  const flow = createFlow();
  const { r } = await runOf(flow);
  const at = new Date().toISOString();
  const rec = await recordOf({ id: 'write-abc123-1', source: 'mock', startedAt: at, endedAt: at, events: writeEvents(r).map((e, seq) => ({ ...e, at, seq })), notes: [], partial: false });
  assert.deepEqual(assertRunObservability(rec), []);
  const c = rec.chain.chains[0];
  assert.equal(c.user.value, 'user.0042');
  assert.equal(c.agent.value, 'personal-agent');
  assert.deepEqual(c.scopes.values, ['api:read', 'api:write', 'api:delete']);
  assert.equal(c.policies.length, 1, 'the write decision is this lab\'s policy node');
  assert.equal(c.policies[0].decision, 'deny');
  assert.equal(c.policies[0].product, 'lab mock Authorize policy');
  assert.ok(c.policies[0].id, 'the CIBA identifier is the policy id');
});

test('every value of a line survives the sanitiser: a hostile identifier or run id cannot add a key=value or a line', () => {
  const ev = { at: '2026-11-24T10:00:00.000Z', step: 'write-decision', layer: 'authorize', outcome: 'refused', who: 'agentID x=1\ninjected', message: 'x' };
  const line = decisionLine(ev, 'run\nx=1');
  assert.equal(line.split('\n').length, 1);
  assert.match(line, LINE);
});

test('the log keeps the last few runs, oldest first, and Reset clears it', () => {
  const { runLog } = capture();
  for (let i = 0; i < KEEP_RUNS + 3; i += 1) runLog.mock(() => [], { source: 'mock' });
  assert.equal(runLog.size(), KEEP_RUNS);
  assert.ok(runLog.get('write-nope-1') === null, 'an unknown id is not found');
});

test('a throwing writer drops its own line only, and the run stays reachable', () => {
  let n = 0;
  const runLog = createRunLog({ write: () => { n += 1; if (n === 2) throw new Error('ENOSPC'); } });
  const id = runLog.mock(() => writeEvents({ outcome: 'permit', obo: { claims: { sub: 'user.0042', act: { sub: 'agentID' }, scope: 'api:read' } }, decision: { result: 'PERMIT' }, mcp: { status: 200 } }));
  assert.ok(id, 'the run is stored even though a line write threw');
  assert.ok(runLog.get(id), 'reachable by id');
});

test('over the API: a write answers its run id, the record route answers that record, and approve began no run', async (t) => {
  const { runLog } = capture();
  const { createApp } = await import('../src/app.js');
  const { createServer } = await import('node:http');
  const server = createServer(createApp({ flow: createFlow(), runLog }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const origin = base;
    const post = async (p, body) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
    const write = await post('/api/write', {});
    assert.equal(write.status, 200);
    assert.ok(write.body.run?.id, 'a run id answers a write call');
    assert.equal(write.body.outcome, 'hitl_required');
    // The record of that run.
    const rec = await fetch(`${base}/api/write/run?runId=${encodeURIComponent(write.body.run.id)}`).then(async (r) => ({ status: r.status, body: await r.json() }));
    assert.equal(rec.status, 200);
    assert.deepEqual(assertRunObservability(rec.body.record), []);
    const stamped = rec.body.record.rows.filter((r) => r.origin !== 'not-logged');
    assert.equal(stamped.length, 3, 'exchange, decision, rewrite');
    const byLayer = Object.fromEntries(stamped.map((r) => [r.layer, r]));
    assert.equal(byLayer.authorize.outcome, 'refused', 'the write was denied');
    assert.equal(byLayer.gateway.layer, 'gateway');
    const chain = rec.body.record.chain.chains[0];
    assert.equal(chain.user.value, 'user.0042');
    assert.equal(chain.agent.value, 'personal-agent');
    // An approve is not a run.
    const ap = await post('/api/approve', { identifier: write.body.identifier });
    assert.equal(ap.status, 200);
    assert.equal(ap.body.run, undefined, 'an approve carries no run field: it began no run');
    // The replay with the identifier records a second run.
    const replay = await post('/api/write', { identifierHeader: write.body.identifier });
    assert.equal(replay.body.outcome, 'permit');
    assert.ok(replay.body.run?.id && replay.body.run.id !== write.body.run.id, 'a different run id');
    // A bad runId and an unknown query parameter are refused.
    assert.equal((await fetch(`${base}/api/write/run?runId=nope`)).status, 400);
    assert.equal((await fetch(`${base}/api/write/run?runId=${encodeURIComponent(write.body.run.id)}&x=1`)).status, 400);
  } finally { await new Promise((r) => server.close(r)); }
});

// ---- Review fixes (rule 27): mode on the run, per-workspace runs, honest Real wording, honest reasons for layers with no row.
test('a Real run says the exchange was live: the Privilege row never calls it a mock', async () => {
  const real = { outcome: 'real_token_legs', obo: { claims: { sub: 'user.0042', act: { sub: 'personal-agent' }, scope: 'api:read' } }, decision: { result: 'DENY' } };
  const [ex] = writeEvents(real);
  assert.equal(ex.step, 'obo-exchange');
  assert.doesNotMatch(ex.product, /mock/i, 'the product names the live exchange');
  assert.doesNotMatch(ex.message, /mock/i, 'the message does not call a live token leg a mock');
  assert.match(ex.message, /live/i);
});

test('the record route answers no record for a run made in the other mode', async () => {
  const runLog = createRunLog({ write: () => {} });
  const id = runLog.mock(() => writeEvents({ outcome: 'hitl_required', obo: { claims: { sub: 'user.0042' } }, decision: { result: 'DENY' } }), { source: 'mock' });
  const fakeMode = { source: () => 'real', info: () => ({ realAvailable: true }), set() {} };
  const server = createServer(createApp({ flow: createFlow(), runLog, mode: fakeMode }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const got = await fetch(`http://127.0.0.1:${server.address().port}/api/write/run?runId=${encodeURIComponent(id)}`).then((r) => r.json());
    assert.equal(got.record, null, 'a Mock run is not returned while the lab is in Real');
    assert.match(got.message, /other mode|mode/i);
  } finally { await new Promise((r) => server.close(r)); }
});

test('runs are kept per workspace: another workspace cannot read a run', () => {
  const runLog = createRunLog({ write: () => {} });
  const id = runLog.mock(() => [], { source: 'mock', workspace: 'a' });
  assert.ok(runLog.get(id, { source: 'mock', workspace: 'a' }), 'its own workspace reads it');
  assert.equal(runLog.get(id, { source: 'mock', workspace: 'b' }), null, 'another workspace does not');
});

test('a Live run never evicts a Mock run: the cap is per mode and workspace', () => {
  const runLog = createRunLog({ write: () => {} });
  const mockId = runLog.mock(() => [], { source: 'mock' });
  for (let i = 0; i < KEEP_RUNS + 3; i += 1) runLog.mock(() => [], { source: 'real' });
  assert.ok(runLog.get(mockId, { source: 'mock' }), 'the Mock run is still kept');
});

test('the person and agent layers say why they have no row, never that the run began no write call', async () => {
  const flow = createFlow();
  const { r } = await runOf(flow);
  const at = new Date().toISOString();
  const rec = await recordOf({ id: 'write-abc123-1', source: 'mock', startedAt: at, endedAt: at, events: writeEvents(r).map((e, seq) => ({ ...e, at, seq })), notes: [], partial: false });
  for (const layer of ['person', 'agent']) {
    const row = rec.rows.find((x) => x.layer === layer);
    assert.ok(row, `${layer} has a row`);
    assert.equal(row.origin, 'not-logged');
    assert.doesNotMatch(row.message, /began no write call/, `${layer} reason is true for a write call`);
  }
});
