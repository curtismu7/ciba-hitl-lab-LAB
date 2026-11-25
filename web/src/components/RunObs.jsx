// Rule 27: the shared run-observability panel for this lab, with the lab's own states around it. The panel shows ONE run: the write call
// the page just made (POST /api/write). The server's answer to that call says which run it was (`run: { id }`); this file reads that field
// and never guesses it. An approve, a deny, an expire or a Reset began no run: the page says so and shows no older record. Nothing is
// re-read on a timer and there is no re-read button: this lab reads no logs, so a re-read could find nothing new.
import React, { useEffect, useState } from "react";
import RunObservability from "../run-observability/RunObservability.jsx";
import { getJson } from "../lib/api.js";

// Where this lab's run leaves logs and where they can stream (the README says the same).
export const LOG_STREAMS = [
  { product: "CIBA HITL LAB (this lab's container)", lives: "its stdout. Each decision of a run is one line: the time, a step, the layer, the actor, a result and a run id. A line never holds a token, an identifier or an address. Mock and Real write the steps the flow computed for one write call", streams: "nowhere today: the family log collector's source list does not name this container, so it would need an entry first" },
];

const TITLE = "What each layer logged for this run";
// What a rejected answer, a missing field or an answer of another shape all come to: the page's own state, not a record.
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** What the server said about the run of one answer: { runId, source } | { none: text } | { bad: true } (the answer did not say). `d` is the answer's JSON body. */
export function headOf(d) {
  if (isObj(d) && "run" in d) {
    const mode = d.source === "mock" || d.source === "real" ? d.source : null;
    if (isObj(d.run) && typeof d.run.id === "string" && d.run.id) return mode ? { runId: d.run.id, source: mode } : { bad: true };
    if (d.run === null) return { none: typeof d.runNote === "string" && d.runNote ? d.runNote : "This request began no run, so nothing was recorded." };
  }
  return { bad: true };
}

// The record route's answer -> what to show. Pure and total: no shape of answer can throw here.
function shapeOf(r) {
  const d = r?.data;
  if (!r?.ok) return { problem: isObj(d) && typeof d.message === "string" && d.message ? d.message : `The lab answered ${r?.status ?? "nothing"} when asked for this run's record.` };
  if (isObj(d) && "record" in d) {
    if (d.record === null) return { empty: typeof d.message === "string" && d.message ? d.message : "There is no record for this run." };
    if (isObj(d.record)) return { record: d.record };
  }
  return { problem: "The lab's answer was not a run record." };
}

const Note = ({ id, role, children }) => (
  <section className="ro" data-testid={id} aria-label={TITLE}>
    <h2>{TITLE}</h2>
    <p className="ro-muted" role={role}>{children}</p>
  </section>
);

// The one line under the panel: what a row is in this lab, true for every write call the page can make.
const NOTE = "Rows are the steps the lab's flow computed for one write call; nothing is read from a product log. The OBO exchange is an allowed Privilege-layer row; the write's policy decision (DENY with a CIBA identifier, or PERMIT after a verified approval) is the Authorize layer's refused or allowed row. The gateway's JSON-RPC rewrite of a raw 403 repeats that decision, so it is information, and the mock resource server's tool run is the Resource server row. Person is the persona's sub and Agent is the agent client id, both read from the OBO token the run itself minted; Scopes are the token's scope claim, read back from the run's answer. A denied write never reaches the resource server. In Real mode the exchange row is the live PingOne call; the rest stays simulated. An approve, a deny, an expire or a Reset began no run: no record is shown for them, never an older one.";

export default function RunObs({ head, loading = false, empty = "Nothing has run yet. Call the write tool and its record appears here." }) {
  const runId = !loading && head?.runId ? head.runId : null;
  const source = head?.source === "real" ? "real" : "mock"; // the mode the run was made in, as the write answer said it
  const key = runId ?? (head?.none ? "none" : head ? "bad" : "empty");
  const [answer, setAnswer] = useState(null); // { key, ...shapeOf }: the answer to the request for `key`
  useEffect(() => {
    if (!runId) return undefined;
    let live = true;
    const done = (a) => { if (live) setAnswer({ key, ...a }); };
    getJson(`/api/write/run?runId=${encodeURIComponent(runId)}`).then((d) => done(shapeOf({ ok: true, data: d }))).catch((e) => done({ problem: `Could not reach the lab (${String(e?.message || e).slice(0, 120)}).` }));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps -- a new run asks again; nothing else does

  if (loading) return <Note id="ro-loading">Collecting this run's logs…</Note>;
  if (!head) return <Note id="ro-empty">{empty}</Note>;
  if (head.bad) return <Note id="ro-bad" role="alert">The lab's answer did not say which run it was, so there is no record to show (and no older one is shown in its place).</Note>;
  if (head.none) return <Note id="ro-no-run">{head.none}</Note>;
  if (!answer || answer.key !== key) return <Note id="ro-loading">Collecting this run's logs…</Note>; // never the previous record
  if (answer.problem) return <Note id="ro-problem" role="alert">{answer.problem}</Note>;
  if (answer.empty) return <Note id="ro-gone">{answer.empty}</Note>;
  return (
    <div data-testid="ro-wrap">
      <RunObservability record={answer.record} source={source} streams={LOG_STREAMS} />
      <p className="ro-muted" data-testid="ro-lab-note">{NOTE}</p>
    </div>
  );
}
