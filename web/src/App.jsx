import React, { useCallback, useEffect, useState } from "react";
import ShelfLink from "./components/ShelfLink.jsx";
import VerifyMark from "./components/VerifyMark.jsx";
// Opened from Customer Agent LAB (UC-LEARN14 routes here): strip + header Back only; no scenario or vertical is preselected.
import ReturnLink from "./return-link/ReturnLink.jsx";
import { getCatalog, getInfo, getTalkTrack, requestModeSwitch, resetServer, runWrite, approveCiba, denyCiba, expireCiba } from "./lib/api.js";
import TopMenu from "./top-menu/TopMenu";
import TalkTrackDialog from "./talk-track/TalkTrackDialog.jsx";
import FlowTab from "./tabs/FlowTab.jsx";
import RunTab from "./tabs/RunTab.jsx";
import RunObs, { headOf } from "./components/RunObs.jsx";

export const TABS = [["flow", "Flow"], ["run", "Live run"]];
export const FALLBACK_BANNER = "MOCK mode. SIMULATED: in-process mock IAM, mock Authorize policy, mock CIBA, mock gateway and mock MCP/RS. No tenant, no outbound network.";
const read = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* not remembered */ } };
const tabFromHash = () => { const id = window.location.hash.replace(/^#\/?/, "").split("?")[0]; return TABS.some(([t]) => t === id) ? id : "flow"; };
const typing = (t) => !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);

export default function App() {
  const [catalog, setCatalog] = useState(null);
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [tab, setTab] = useState(tabFromHash);
  const [theme, setTheme] = useState(() => (["light", "dark"].includes(read("ciba.theme", "")) ? read("ciba.theme", "") : "auto"));
  const [present, setPresent] = useState(() => read("ciba.present", "0") === "1");
  const [talkOpen, setTalkOpen] = useState(false);
  const [talk, setTalk] = useState([]);
  useEffect(() => { getTalkTrack().then((t) => setTalk(t.talkTrack ?? [])).catch(() => {}); }, []);
  const [run, setRun] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [announce, setAnnounce] = useState("");

  const loadAll = useCallback(async () => {
    const [c, i] = await Promise.all([getCatalog(), getInfo()]);
    setCatalog(c); setInfo(i);
  }, []);
  useEffect(() => { loadAll().catch((e) => setLoadError(e.message)); }, [loadAll]);
  useEffect(() => { const on = () => setTab(tabFromHash()); window.addEventListener("hashchange", on); return () => window.removeEventListener("hashchange", on); }, []);
  useEffect(() => { if (theme === "auto") { try { localStorage.removeItem("ciba.theme"); } catch { /* not remembered */ } delete document.documentElement.dataset.theme; } else { write("ciba.theme", theme); document.documentElement.dataset.theme = theme; } }, [theme]);
  useEffect(() => { if (present) document.documentElement.dataset.present = "1"; else delete document.documentElement.dataset.present; }, [present]);
  useEffect(() => {
    const on = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      if (e.key === "p" || e.key === "P") setPresent((v) => { write("ciba.present", v ? "0" : "1"); return !v; });
      else if (e.key === "Escape") setPresent((v) => { if (v) write("ciba.present", "0"); return false; });
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  const onWrite = useCallback(async (identifierHeader) => {
    setBusy(true); setError(null);
    try {
      const r = await runWrite(identifierHeader || undefined);
      setRun(r);
      setAnnounce(r.outcome === "permit" ? "Permitted: the CIBA approval was verified and the tool ran."
        : r.outcome === "hitl_required" ? "Denied with an identifier: approve as the human, then replay."
        : `Result: ${r.outcome}.`);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }, []);
  const onApprove = useCallback(async (id) => { setBusy(true); setError(null); try { await approveCiba(id); setAnnounce("Approved. Replay the write with the identifier."); } catch (e) { setError(e.message); } setBusy(false); }, []);
  const onDeny = useCallback(async (id) => { setBusy(true); setError(null); try { await denyCiba(id); setAnnounce("Refused. The refusal is terminal: no replay with this identifier can ever permit."); } catch (e) { setError(e.message); } setBusy(false); }, []);
  const onExpire = useCallback(async (id) => { setBusy(true); setError(null); try { await expireCiba(id); setAnnounce("Expired. An unanswered request expires: a replay with this identifier denies again."); } catch (e) { setError(e.message); } setBusy(false); }, []);
  const onReset = useCallback(async () => { await resetServer(); setRun(null); setAnnounce("Reset."); }, []);

  const onMode = useCallback(async (next) => {
    try {
      const r = await requestModeSwitch(next);
      setInfo(r);
      setAnnounce(r.message ?? `Mode: ${r.source}.`);
      setRun(null);
      const c = await getCatalog(); setCatalog(c); // reload all data after a switch (rule 19)
    } catch (e) { setAnnounce(e.message); }
  }, []);

  const banner = info?.banner ?? FALLBACK_BANNER;

  if (loadError || !catalog) {
    return (
      <>
        <a className="skip" href="#main">Skip to content</a>
        <main className="page" id="main" tabIndex={-1}>
          <p className="banner" role="note">{FALLBACK_BANNER}</p>
          {loadError ? <p className="alert" role="alert">Could not reach the lab server: {loadError}</p> : <p className="muted" role="status">Loading the lab...</p>}
        </main>
      </>
    );
  }

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="shell-bar">
        <span className="shell-brand">
          <span className="shell-logo" aria-hidden="true">LAB</span>
          <h1>CIBA HITL Lab</h1>
          {info?.source === "real"
            ? <span className="shell-badge shell-badge--real" data-testid="mode-badge">Real<span className="sr-only">: agent identity and token exchange run against your configured PingOne tenant</span></span>
            : <span className="shell-badge" data-testid="mode-badge">Mock<span className="sr-only">: in-process mocks, no tenant contacted</span></span>}
        </span>
        <nav className="shell-nav" aria-label="Tabs">
          {TABS.map(([id, label]) => <a key={id} href={`#/${id}`} aria-current={tab === id ? "page" : undefined}>{label}</a>)}
        </nav>
        <TopMenu
          postman={{ repo: "curtismu7/ciba-hitl-lab-LAB", slug: "ciba-hitl-lab" }}
          mode={{ value: info?.source === "real" ? "real" : "mock", onChange: onMode, realAvailable: info ? info.realAvailable : null, realHint: info?.realReason || undefined }}
          theme={{ value: theme, onChange: setTheme }}
          present={{ active: present, onToggle: () => setPresent((v) => { write("ciba.present", v ? "0" : "1"); return !v; }) }}
          talkTrack={{ active: talkOpen, onToggle: () => setTalkOpen((v) => !v) }}
          help={{ href: "https://github.com/curtismu7/ciba-hitl-lab#readme" }}
          version={info?.version || null}
          onReset={onReset}
        >
          <ShelfLink />
          <VerifyMark id="ciba-hitl-lab" />
          <ReturnLink app="ciba-hitl-lab" variant="header" />
        </TopMenu>
      </header>
      <main className="page" id="main" tabIndex={-1}>
        <p className="banner" role="note" data-testid="banner">{banner}</p>
        <ReturnLink app="ciba-hitl-lab" />
        {tab === "flow"
          ? <FlowTab catalog={catalog} />
          : <RunTab run={run} busy={busy} error={error} onWrite={onWrite} onApprove={onApprove} onDeny={onDeny} onExpire={onExpire} onReset={onReset} source={info?.source} />}
        {tab === "run" ? <RunObs head={run ? headOf(run) : null} loading={busy} /> : null}
      </main>
      <footer><p className="muted small">One login, one token exchange, one approval. The OBO token keeps the full scope set; per-tool narrowing happens in the Authorize policy, and a write only runs after a human - verified by Authorize, never by the agent.</p></footer>
      <div aria-live="polite" className="sr-only">{announce}</div>
      <TalkTrackDialog isOpen={talkOpen} onClose={() => setTalkOpen(false)} talk={talk} />
    </>
  );
}
