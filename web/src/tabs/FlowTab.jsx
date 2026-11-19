// The 24-step diagram, rendered from the server's diagram-studio/1 data (catalog.diagram).
// Rule 17: the nodes/edges/steps are server-side data validated with the studio's gate; this
// component only renders them. Movable boxes, Simulate, Reset (restores positions), speed control.
// Diagram standard: the shared diagram-kit draws the arrow labels (above the boxes, clear of each
// other) and a click expands a box in place with its passport.
import React, { useEffect, useMemo, useState } from "react";
import { ReactFlow, Background, Controls, Panel, MarkerType, Handle, Position, useNodesState } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowNoLabel, EdgeLabels, FitOpen, Passport, PassportActions } from "../diagram-kit/DiagramKit.jsx";
import { boxPassport, sidePoint } from "../diagram-kit/diagramKit.js";
import "../diagram-kit/diagram-kit.css";

// Group colors are the six diagram-studio palette names, mapped onto the lab's theme tokens
// (the same roles as AI-DEMO2's shared participant palette: user/info blue, agent/dark, PingOne/success green,
// gateway/warning amber, resource/grey, deny/Ping Red). No hex literals: everything is a var(--...).
const GROUP_COLORS = {
  red: "var(--accent)", dark: "var(--box-dark)", grey: "var(--box-grey)",
  blue: "var(--box-blue)", green: "var(--status-ok)", amber: "var(--status-warn)",
};
const SIDES = { l: Position.Left, r: Position.Right, t: Position.Top, b: Position.Bottom };
const POS = [10, 30, 50, 70, 90];

function Box({ data }) {
  return (
    <div className={`dg-node dg-${data.role} ${data.hot ? "hot" : ""}${data.passport ? " dk-open" : ""}`}>
      {Object.entries(SIDES).map(([k, pos]) =>
        POS.map((p) => (
          <Handle key={k + p} id={k + p} type="source" position={pos}
            style={(k === "l" || k === "r") ? { top: `${p}%` } : { left: `${p}%` }} />
        )))}
      <div>{data.label}</div>
      {data.passport && <Passport p={data.passport} />}
    </div>
  );
}
const nodeTypes = { box: Box };
// The arrow draws the curve only: EdgeLabels draws every label, above the boxes.
const edgeTypes = { arrow: ArrowNoLabel };

export default function FlowTab({ catalog }) {
  const diagram = catalog?.diagram;
  const nodesData = diagram?.nodes ?? [];
  const edgesData = diagram?.edges ?? [];
  const steps = diagram?.steps ?? [];
  const groups = diagram?.groups ?? {};
  const groupEntries = Object.entries(groups);

  const initNodes = useMemo(() => nodesData.map((n) => ({ id: n.id, type: "box", position: { x: n.x, y: n.y }, data: { label: n.label, kind: n.kind, role: n.role } })), [nodesData]);
  const ns = useNodesState(initNodes);
  const nodes = ns[0], setNodes = ns[1], onNodesChange = ns[2];
  useEffect(() => { setNodes(initNodes); }, [initNodes, setNodes]); // Reset restores positions

  const [step, setStep] = useState(-1);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [open, setOpen] = useState(-1);
  const [openBox, setOpenBox] = useState(null);
  const [collapsed, setCollapsed] = useState({});

  useEffect(() => { if (running) setOpen(step); }, [running, step]);
  useEffect(() => {
    if (step < 0 || !steps[step]) return undefined;
    const gi = groupEntries.findIndex(([key]) => key === nodesData.find((n) => n.id === steps[step].from)?.kind || key === nodesData.find((n) => n.id === steps[step].to)?.kind);
    if (gi >= 0) setCollapsed((c) => { const n = { ...c }; delete n[gi]; return n; });
  }, [step]); // eslint-disable-line
  useEffect(() => {
    if (!running) return undefined;
    if (step >= steps.length - 1) { setRunning(false); return undefined; }
    const t = setTimeout(() => setStep((s) => s + 1), 2800 / speed);
    return () => clearTimeout(t);
  }, [running, step, speed, steps.length]);

  const colorOf = (n) => GROUP_COLORS[groups[n.kind]?.color] ?? "var(--box-grey)";
  const stepColor = (i) => {
    const s = steps[i];
    if (!s) return "var(--box-grey)";
    const n = nodesData.find((x) => x.id === s.to) ?? nodesData.find((x) => x.id === s.from);
    return n ? colorOf(n) : "var(--box-grey)";
  };

  const edges = useMemo(() => steps.map((s, i) => {
    const color = stepColor(i);
    const active = i === step, seen = i < step;
    return {
      id: `e${i}`, source: s.from, target: s.to,
      type: "arrow", animated: active,
      className: active ? "dg-edge--active" : undefined,
      style: { stroke: s.color ? `var(--dg-${s.color})` : color, strokeWidth: active ? 3.5 : 1.8, strokeDasharray: s.dashed ? "6 4" : undefined, opacity: step === -1 ? 0.9 : active ? 1 : seen ? 0.7 : 0.3 },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      zIndex: active ? 10 : 1,
    };
  }).filter(Boolean), [steps, step]);

  // One label per arrow, drawn by the kit above the boxes, clear of the other labels.
  const labels = useMemo(() => steps.map((s, i) => ({
    id: `e${i}`, text: String(i + 1), source: s.from, target: s.to,
    sourceHandle: "r", targetHandle: "l",
    active: i === step, dim: step >= 0 && i > step,
  })), [steps, step]);

  // The graph for the box passport (group, reach, arrows).
  const graph = useMemo(() => ({
    nodes: nodesData.map((n) => ({ id: n.id, label: n.label, group: n.kind })),
    edges: steps.map((s, i) => ({ source: s.from, target: s.to, label: `${i + 1}. ${s.label}` })),
  }), [nodesData, steps]);

  const actions = useMemo(() => ({
    open: (id) => setOpenBox(id), close: () => setOpenBox(null),
    link: (id) => { const u = new URL(window.location.href); u.searchParams.set("box", id); return u.toString(); },
  }), []);

  const shownNodes = useMemo(() => {
    const hot = step >= 0 && steps[step] ? [steps[step].from, steps[step].to] : [];
    return nodes.map((n) => ({
      ...n,
      zIndex: n.id === openBox ? 10 : undefined,
      data: { ...n.data, hot: hot.includes(n.id), passport: n.id === openBox ? boxPassport(graph, n.id) : null },
    }));
  }, [nodes, step, steps, openBox, graph]);

  const curG = step >= 0 && steps[step]
    ? groupEntries.findIndex(([key]) => key === (nodesData.find((n) => n.id === steps[step].to)?.kind))
    : -1;
  const reset = () => { setRunning(false); setStep(-1); setOpen(-1); setOpenBox(null); setNodes(initNodes); };
  const simulate = () => {
    if (running) { setRunning(false); return; }
    if (step >= steps.length - 1 || step < 0) setStep(0);
    setRunning(true);
  };

  const s = step >= 0 ? steps[step] : null;
  if (!diagram) return <p className="muted" role="status">Loading the diagram...</p>;
  return (
    <div className="flowwrap">
      <div className="flow-tools">
        <h2 className="flow-h"><span className="step-num" aria-hidden="true">1</span>Walk the flow</h2>
        <button type="button" className="btn primary" onClick={simulate}>{running ? "Pause" : step >= steps.length - 1 ? "Replay" : "Simulate"}</button>
        <button type="button" className="btn" onClick={() => { setRunning(false); setStep((x) => Math.min(x + 1, steps.length - 1)); }}>Next step</button>
        <button type="button" className="btn" onClick={reset}>Reset</button>
        <label className="inline">Speed
          <select value={speed} onChange={(e) => setSpeed(parseFloat(e.target.value))}>
            <option value="0.5">0.5x</option><option value="1">1x</option><option value="2">2x</option><option value="4">4x</option>
          </select>
        </label>
      </div>
      <div className="caption" role="status">
        {s ? (
          <>
            <b>{curG >= 0 ? groupEntries[curG][1].label : diagram.title} · step {step + 1} of {steps.length} · {s.label}.</b> {s.what}
          </>
        ) : <>{diagram.intro} Press <b>Simulate</b> to walk the flow step by step, or click a step in the list to expand it. Drag any box to rearrange (Reset restores the layout).</>}
      </div>
      <div className="flow-main">
        <div className="steplist" data-testid="steplist">
          <h2 className="flow-h"><span className="step-num" aria-hidden="true">2</span>Steps</h2>
          {groupEntries.map(([key, g], gi) => {
            const members = steps.map((st, i) => ({ st, i })).filter(({ st }) => (nodesData.find((n) => n.id === st.to)?.kind) === key);
            if (!members.length) return null;
            return (
              <React.Fragment key={key}>
                <div className={"grp" + (gi === curG ? " on" : "")} style={{ "--gc": GROUP_COLORS[g.color] }} role="button" tabIndex={0}
                  onClick={() => setCollapsed((c) => ({ ...c, [gi]: !c[gi] }))}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setCollapsed((c) => ({ ...c, [gi]: !c[gi] })); } }}>
                  <span>{g.label}</span><small>{members.length === 1 ? `step ${members[0].i + 1}` : `steps ${members[0].i + 1}-${members[members.length - 1].i + 1}`}</small>
                </div>
                {collapsed[gi] ? null : members.map(({ st, i }) => (
                  <div key={i} className={"item" + (i === step ? " on" : i < step ? " seen" : "")} style={{ "--gc": GROUP_COLORS[g.color] }}>
                    <div className="head" role="button" tabIndex={0}
                      onClick={() => { setRunning(false); setStep(i); setOpen(open === i ? -1 : i); }}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setRunning(false); setStep(i); setOpen(open === i ? -1 : i); } }}>
                      <span className="n">{i + 1}</span><span>{st.label}</span>
                    </div>
                    {open === i ? (
                      <div className="detail">
                        <h4>What happens</h4><p>{st.what}</p>
                        {st.why ? (<><h4>Why it matters</h4><p>{st.why}</p></>) : null}
                      </div>
                    ) : null}
                  </div>
                ))}
              </React.Fragment>
            );
          })}
        </div>
        <div className="canvas" data-testid="diagram">
          <h2 className="flow-h flow-h--canvas"><span className="step-num" aria-hidden="true">3</span>The diagram</h2>
          <PassportActions.Provider value={actions}>
            <ReactFlow nodes={shownNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange}
              connectionMode="loose" nodesConnectable={false} fitView fitViewOptions={{ padding: 0.1 }} minZoom={0.3} proOptions={{ hideAttribution: true }}
              onNodeClick={(_, n) => setOpenBox((o) => (o === n.id ? null : n.id))} onPaneClick={() => setOpenBox(null)}>
              <Background gap={20} />
              <Controls showInteractive={false} />
              <EdgeLabels items={labels} pointFor={(box, handle) => sidePoint(box, String(handle))} fallback={{ w: 60, h: 30 }} />
              <FitOpen open={openBox} closePadding={0.1} />
              <Panel position="bottom-left" className="legend">
                {groupEntries.map(([key, g], gi) => (
                  <button key={key} type="button" className={"chip" + (gi === curG ? " on" : "")} style={{ "--gc": GROUP_COLORS[g.color] }}
                    title={g.label} onClick={() => {
                      const first = steps.findIndex((st) => (nodesData.find((n) => n.id === st.to)?.kind) === key);
                      if (first >= 0) { setRunning(false); setStep(first); setOpen(first); }
                    }}>
                    {g.label}
                  </button>
                ))}
              </Panel>
            </ReactFlow>
          </PassportActions.Provider>
        </div>
      </div>
    </div>
  );
}
