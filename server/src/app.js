// One Express app. /api = the CIBA HITL lab: the 24-step walkthrough data, a live write call
// (403 + JSON-RPC rewrite -> approve -> replay -> permit), the CIBA approve/deny, decode.
// Loopback Host check and same-origin writes everywhere.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { hostCheck, sameOriginWrites } from './safety.js';
import { createHealth, DEMO } from './health.js';
import { createFlow, personaOf, agentOf, gatewayOf, downstreamOf, jwtDecode } from './flow.js';
import { buildDiagram } from './diagramData.js';
import { createMode, MODES } from './mode.js';
import { realRun } from './realPingOne.js';
import { workspaceId } from './workspace.js';
import { shelfInfo } from './shelfLink.js';
import { NO_RUN, OTHER_MODE, NO_LONGER_KEPT, createRunLog, writeEvents, recordOf, reportFailure, runField } from './runObs.js';
import { RunObsError } from './runObservability.js';
import { TALK_INTRO, TALK_OUTRO, talkLines } from './talkTrack.js';

const WEB_DIST = process.env.WEB_DIST || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const bad = (res, message, status = 400) => res.status(status).json({ error: status === 404 ? 'not_found' : 'bad_request', message });
export const BANNER = (source) => source === 'real'
  ? 'REAL mode: the agent identity, the RFC 8693 exchange and the CIBA backchannel run against YOUR PingOne tenant (owner-configured). The policy decision, the gateway JSON-RPC rewrite and the MCP tool execution stay SIMULATED app-side. Token bodies stay on the server; the Worker secret is a hash only.'
  : 'MOCK mode. SIMULATED: in-process mock IAM, mock Authorize policy, mock CIBA, mock gateway and mock MCP/RS. No tenant, no outbound network. Tokens are mock and labelled.';

export function createApp({ health = createHealth(), mode = createMode(), flow = createFlow(), runLog = createRunLog() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(hostCheck);
  app.use(sameOriginWrites);
  app.use((_req, res, next) => { res.set('X-Content-Type-Options', 'nosniff'); next(); });

  const api = express.Router();
  api.use(express.json({ limit: '8kb' }));
  // eslint-disable-next-line no-unused-vars
  api.use((err, _req, res, _next) => {
    if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large' || err instanceof SyntaxError) {
      return res.status(err.type === 'entity.too.large' ? 413 : 400).json({ error: 'bad_request', message: err.type === 'entity.too.large' ? 'request body over 8kb' : 'request body is not valid JSON' });
    }
    return res.status(400).json({ error: 'bad_request', message: 'bad request' });
  });
  api.use('/health', health.router);

  api.get('/info', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json({ ...mode.info(), version: DEMO.version || null, banner: BANNER(mode.source()), epoch: flow.state.runs.length }); });
  // Rule 19: POST /api/mode with exactly {"source": "mock"|"real"}. Real unconfigured -> 409 with the how-to.
  api.post('/mode', (req, res) => {
    const b = req.body;
    if (!b || typeof b !== 'object' || Array.isArray(b) || Object.keys(b).length !== 1 || !MODES.includes(b.source)) return bad(res, 'body must be exactly {"source": "mock" or "real"}');
    if (b.source === 'real' && mode.info().realAvailable !== true) return res.status(409).json({ error: 'conflict', message: mode.info().realReason });
    mode.set(b.source);
    return res.json({ ...mode.info(), version: DEMO.version || null, banner: BANNER(mode.source()) });
  });

  api.get('/talk', (_req, res) => res.json({ talkTrack: [{ id: 'intro', title: 'Say first', say: TALK_INTRO }, ...talkLines(), { id: 'outro', title: 'Close', say: TALK_OUTRO }] }));
  api.get('/catalog', (_req, res) => res.json({
    banner: BANNER(mode.source()), source: mode.source(),
    persona: personaOf(), agent: agentOf(), gateway: gatewayOf(), downstream: downstreamOf(),
    diagram: buildDiagram(),
    workspaceId: workspaceId(_req),
  }));

  // The live write call. Without an identifier: steps 1-12 (403 + JSON-RPC error). With one and a
  // recorded approval: steps 15-24 (PERMIT, tool ran). In Real mode the token legs are live.
  // Rule 27: one write call is one run; the record is built from the answer the flow already computed.
  // An approve/deny/expire changes a CIBA record the NEXT replay reads; it began no run of its own.
  api.post('/write', async (req, res) => {
    const h = req.body?.identifierHeader;
    if (h !== undefined && (typeof h !== 'string' || h.length > 200)) return bad(res, 'identifierHeader must be a string of at most 200 characters');
    try {
      const source = mode.source();
      const run = source === 'real'
        ? { ...(await realRun()), outcome: 'real_token_legs', note: 'Real mode runs the token legs live; approve/replay below are the simulated legs.' }
        : await flow.writeCall({ identifierHeader: h });
      run.workspaceId = workspaceId(req);
      const runId = runLog.mock(() => writeEvents(run), { source, workspace: run.workspaceId });
      const head = runId ? runField(runId) : { run: null, runNote: RECORDER_DOWN };
      return res.json({ banner: BANNER(source), source, ...run, ...head });
    } catch (e) {
      return res.status(502).json({ error: 'real_unavailable', message: e.message });
    }
  });

  // The record of one run (rule 27), asked for by the id the run's own answer carried.
  api.get('/write/run', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (Object.keys(req.query).some((k) => k !== 'runId')) return bad(res, 'the query carries a parameter this route does not take');
    const id = req.query.runId;
    if (typeof id !== 'string' || !/^write-[0-9a-f]{6}-[0-9]{1,9}$/.test(id)) return bad(res, 'runId must be the id of one run');
    // The run is read in this workspace only, and only in the mode it was made in (the mode is stored on the run).
    const run = runLog.get(id, { workspace: workspaceId(req) });
    if (!run) return res.json({ record: null, message: NO_LONGER_KEPT });
    if (run.source !== mode.source()) return res.json({ record: null, message: OTHER_MODE });
    try {
      return res.json({ record: await recordOf(run) });
    } catch (err) {
      if (err instanceof RunObsError) return res.status(err.status).json({ error: err.code, message: err.message });
      reportFailure('record', err);
      return res.status(500).json({ error: 'server_error', message: 'The lab could not build this run\'s record (the server log says why).' });
    }
  });

  // Step 14: the human accepted (or refused) in the application.
  api.post('/approve', (req, res) => {
    const id = req.body?.identifier;
    if (typeof id !== 'string' || id.length === 0 || id.length > 200) return bad(res, 'identifier required');
    return flow.approve(id) ? res.json({ ok: true, identifier: id, state: 'approved' }) : res.status(404).json({ error: 'not_found', message: 'unknown or expired identifier' });
  });
  api.post('/deny', (req, res) => {
    const id = req.body?.identifier;
    if (typeof id !== 'string' || id.length === 0 || id.length > 200) return bad(res, 'identifier required');
    return flow.denyCiba(id) ? res.json({ ok: true, identifier: id, state: 'denied' }) : res.status(404).json({ error: 'not_found', message: 'unknown or expired identifier' });
  });
  // Demo knob: let a pending CIBA record expire now (unanswered-request path). A replay with
  // an expired identifier denies again, exactly as step 17 says for an expired request.
  api.post('/expire', (req, res) => {
    const id = req.body?.identifier;
    if (typeof id !== 'string' || id.length === 0 || id.length > 200) return bad(res, 'identifier required');
    return flow.expireCiba(id) ? res.json({ ok: true, identifier: id, state: 'expired' }) : res.status(404).json({ error: 'not_found', message: 'unknown or expired identifier' });
  });

  api.post('/decode', (req, res) => {
    const t = String(req.body?.token ?? '');
    const claims = jwtDecode(t);
    if (!claims) return bad(res, 'not a decodable JWT');
    return res.json({ claims });
  });

  api.post('/reset', (_req, res) => { flow.reset(); runLog.clear(); return res.json({ ok: true, epoch: flow.state.runs.length }); });

  if (fs.existsSync(WEB_DIST)) app.use(express.static(WEB_DIST));
  app.get('/favicon.ico', (_req, res) => { res.set('Content-Type', 'image/svg+xml'); res.set('Cache-Control', 'public, max-age=86400'); res.send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="%23b5122f"/><path d="M4 9h5M8 5l3 4-3 4" stroke="white" stroke-width="2" fill="none"/></svg>'); });
  app.get('/api/shelf', (_req, res) => { res.set('Cache-Control', 'no-store'); res.json(shelfInfo()); }); // the header "Shelf" button
  app.use('/api', api);
  app.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  return app;
}
