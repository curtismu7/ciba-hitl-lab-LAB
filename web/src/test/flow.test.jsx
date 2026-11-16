import { test, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import fs from "node:fs";
import path from "node:path";
import App, { FALLBACK_BANNER } from "../App.jsx";
import { runWrite, approveCiba, requestModeSwitch, getInfo } from "../lib/api.js";
import { setJsonView } from "../components/JsonPane.jsx";

vi.mock("../lib/api.js", () => ({
  requestModeSwitch: vi.fn(async (source) => ({ source, realAvailable: false, realReason: "Set PINGONE_* in ~/Development/.env", banner: "B" })),
  getCatalog: vi.fn(async () => ({
    banner: "B", source: "mock",
    persona: { sub: "user.0042", clientId: "web-banking" },
    agent: { clientId: "personal-agent" },
    gateway: { aud: "https://ai-gateway.invalid" },
    downstream: { aud: "https://api.fabrikam.example" },
    diagram: {
      title: "CIBA HITL", intro: "i",
      groups: { login: { label: "G1", color: "blue" }, write: { label: "G2", color: "red" } },
      nodes: [
        { id: "app", label: "Application", kind: "login", x: 0, y: 0 },
        { id: "gw", label: "Gateway", kind: "write", x: 300, y: 200 },
      ],
      edges: Array.from({ length: 24 }, (_, i) => ({ from: "app", to: "gw", dashed: false })),
      steps: Array.from({ length: 24 }, (_, i) => ({ from: "app", to: "gw", label: `Step ${i + 1}`, what: `w${i + 1}`, why: `y${i + 1}` })),
    },
  })),
  getInfo: vi.fn(async () => ({ source: "mock", realAvailable: false, realReason: "Set PINGONE_*", banner: "B" })),
  resetServer: vi.fn(async () => ({ ok: true })),
  runWrite: vi.fn(),
  approveCiba: vi.fn(async () => ({ ok: true })),
  denyCiba: vi.fn(async () => ({ ok: true })),
  decodeToken: vi.fn(),
}));

// The Form | JSON choice is shared module state: every test names the view it reads.
beforeEach(() => setJsonView("raw"));

test("flow tab: 24 numbered steps, simulate walks to step 1, the owner-approved names show", async () => {
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("banner");
  expect(screen.getByTestId("steplist").textContent).toContain("Step 24");
  await user.click(screen.getByRole("button", { name: "Simulate" }));
  await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/step 1 of 24/), { timeout: 4000 });
});

test("live run: write -> hitl_required with the JSON-RPC rewrite; approve -> replay permits", async () => {
  runWrite.mockResolvedValueOnce({
    ok: true, outcome: "hitl_required", identifier: "ciba-1", source: "mock",
    rpcError: { jsonrpc: "2.0", id: 1, error: { code: -32001, message: "Approval required", data: { identifier: "ciba-1" } } },
    decision: { sub: "user.0042", act: "personal-agent", tool: "update_record", result: "DENY", reason: "write requires human-in-the-loop" },
    obo: { claims: { sub: "user.0042", act: { sub: "personal-agent" } } },
  });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("banner");
  await user.click(screen.getByRole("link", { name: "Live run" }));
  await user.click(screen.getByTestId("run-write"));
  await waitFor(() => expect(screen.getByTestId("outcome")).toHaveTextContent("hitl_required"));
  // JSON view: the exact JSON text, the identifier stood out (hot) in the pane
  expect(screen.getByTestId("rpc")).toHaveTextContent('"code": -32001');
  expect(screen.getByTestId("rpc")).toHaveTextContent('"identifier": "ciba-1"');
  expect(screen.getByTestId("rpc-box")).toHaveAttribute("data-view", "raw");
  const hot = [...screen.getByTestId("rpc").querySelectorAll(".jtok--hot")].map((n) => n.textContent);
  expect(hot.some((t) => t.includes("identifier"))).toBe(true);
  expect(hot.some((t) => t.includes("code"))).toBe(true);
  // Form view: the same data as label + value rows, switched with the Form button
  await user.click(screen.getByTestId("rpc-formatted"));
  expect(screen.getByTestId("rpc-box")).toHaveAttribute("data-view", "form");
  expect(screen.getByTestId("rpc")).toHaveTextContent("-32001");
  expect(screen.getByTestId("rpc")).toHaveTextContent("ciba-1");
  await user.click(screen.getByTestId("rpc-raw"));
  expect(screen.getByTestId("rpc-box")).toHaveAttribute("data-view", "raw");
  // approve, then replay
  runWrite.mockResolvedValueOnce({
    ok: true, outcome: "permit", identifier: "ciba-1", source: "mock",
    decision: { sub: "user.0042", act: "personal-agent", tool: "update_record", result: "PERMIT", reason: "CIBA approval verified" },
    mcp: { status: 200, result: { record: "id-9012", status: "updated" } },
    obo: { claims: { sub: "user.0042", act: { sub: "personal-agent" } } },
  });
  await user.click(screen.getByTestId("run-approve"));
  await waitFor(() => expect(approveCiba).toHaveBeenCalledWith("ciba-1"));
  await user.type(screen.getByLabelText(/Identifier header/), "ciba-1");
  await user.click(screen.getByTestId("run-replay"));
  await waitFor(() => expect(screen.getByTestId("outcome")).toHaveTextContent("permit"));
  expect(screen.getByTestId("mcp")).toHaveTextContent('"status": "updated"');
  // the tool result and the OBO claims are shared JsonPane panes too (JSON view here)
  expect(screen.getByTestId("mcp")).toHaveClass("json--raw");
  expect(screen.getByTestId("obo")).toHaveClass("json--raw");
  expect(screen.getByTestId("obo")).toHaveTextContent('"sub": "user.0042"');
});

test("rule 19: the mode select renders; Real disabled with how-to when unconfigured", async () => {
  render(<App />);
  await screen.findByTestId("banner");
  const real = screen.getByTestId("mode-select").querySelector('option[value="real"]');
  expect(real).toBeDisabled();
  expect(real.getAttribute("title")).toMatch(/PINGONE/);
  expect(screen.getByTestId("mode-select")).toHaveValue("mock");
});

test("mode switch reloads data and the run", async () => {
  const user = userEvent.setup();
  // make Real available from the first load, as a configured server would
  getInfo.mockResolvedValue({ source: "mock", realAvailable: true, banner: "B" });
  render(<App />);
  await screen.findByTestId("banner");
  await waitFor(() => expect(screen.getByTestId("mode-select").querySelector('option[value="real"]')).not.toBeDisabled());
  requestModeSwitch.mockResolvedValueOnce({ source: "real", realAvailable: true, banner: "REAL B" });
  await user.selectOptions(screen.getByTestId("mode-select"), "real");
  await waitFor(() => expect(requestModeSwitch).toHaveBeenCalledWith("real"));
  await waitFor(() => expect(screen.getByTestId("banner")).toHaveTextContent("REAL B"));
});

test("the live announcement is screen-reader only: it carries the shared sr-only class, which app.css defines", async () => {
  runWrite.mockResolvedValueOnce({
    ok: true, outcome: "hitl_required", identifier: "ciba-1", source: "mock",
    rpcError: { jsonrpc: "2.0", id: 1, error: { code: -32001, message: "Approval required", data: { identifier: "ciba-1" } } },
    decision: { sub: "user.0042", act: "personal-agent", tool: "update_record", result: "DENY", reason: "write requires human-in-the-loop" },
    obo: { claims: { sub: "user.0042", act: { sub: "personal-agent" } } },
  });
  const user = userEvent.setup();
  render(<App />);
  await screen.findByTestId("banner");
  await user.click(screen.getByRole("link", { name: "Live run" }));
  await user.click(screen.getByTestId("run-write"));
  const live = await screen.findByText(/^Denied with an identifier/);
  expect(live).toHaveAttribute("aria-live", "polite");
  expect(live).toHaveClass("sr-only");
  expect(live).not.toHaveClass("visually-hidden");
  const css = fs.readFileSync(path.join(process.cwd(), "src", "app.css"), "utf8");
  expect(css).toMatch(/\.sr-only\s*\{[^}]*clip:/);
});
