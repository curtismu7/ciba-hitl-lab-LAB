// The header shows this lab's own Verified / In progress mark, read from the same /api/shelf call the Shelf link makes (through the lab-proxy
// that call reaches the shelf, whose payload lists every demo with its mark). Opened on its own port, /api/shelf has no demos, so no mark.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";

vi.mock("../lib/api.js", () => ({
  getTalkTrack: vi.fn(async () => ({ talkTrack: [] })),
  requestModeSwitch: vi.fn(),
  getCatalog: vi.fn(async () => ({
    banner: "B", source: "mock",
    persona: { sub: "user.0042", clientId: "web-banking" },
    agent: { clientId: "personal-agent" },
    gateway: { aud: "https://ai-gateway.invalid" },
    downstream: { aud: "https://api.downstream.invalid" },
    diagram: {
      title: "CIBA HITL", intro: "i",
      groups: { login: { label: "G1", color: "blue" } },
      nodes: [{ id: "app", label: "Application", kind: "login", x: 0, y: 0 }, { id: "gw", label: "Gateway", kind: "login", x: 300, y: 200 }],
      edges: [{ from: "app", to: "gw", dashed: false }],
      steps: [{ from: "app", to: "gw", label: "Step 1", what: "w", why: "y" }],
    },
  })),
  getInfo: vi.fn(async () => ({ source: "mock", realAvailable: false, realReason: "x", banner: "B" })),
  resetServer: vi.fn(), runWrite: vi.fn(), approveCiba: vi.fn(), denyCiba: vi.fn(), decodeToken: vi.fn(),
}));
import App from "../App.jsx";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mark = (status, label, extra = {}) => ({ status, label, note: "", updatedAt: "2026-11-15", source: "shipped", ...extra });
function withShelf(payload) {
  vi.stubGlobal("fetch", (url) => (url === "/api/shelf" ? Promise.resolve(new Response(JSON.stringify(payload))) : Promise.reject(new Error(`unexpected ${url}`))));
}

describe("verification mark in the header", () => {
  it("shows this lab's own mark beside the Shelf link, once, and no other lab's", async () => {
    withShelf({
      shelfUrl: "http://shelf.example",
      demos: [
        { id: "other-lab", verification: mark("in-progress", "In progress") },
        { id: "ciba-hitl-lab", verification: mark("verified", "Verified", { note: "All 24 steps run on the mock" }) },
      ],
    });
    render(<App />);
    const bar = within(await screen.findByTestId("top-menu"));
    expect(await bar.findByText("Verified")).toBeInTheDocument();
    expect(bar.getByRole("link", { name: "Shelf" })).toBeInTheDocument();
    expect(bar.queryByText("In progress")).toBeNull();
    expect(document.querySelectorAll(".verify")).toHaveLength(1);
    expect(bar.getByText("Verified").closest(".verify")).toHaveAttribute("title", expect.stringContaining("All 24 steps run on the mock"));
  });

  it("shows nothing when the lab is opened on its own port (only { shelfUrl }), when the shelf has no mark for it, or when the mark is none", async () => {
    for (const payload of [
      { shelfUrl: "http://shelf.example" },
      { shelfUrl: "http://shelf.example", demos: [{ id: "ciba-hitl-lab", verification: null }] },
      { shelfUrl: "http://shelf.example", demos: [{ id: "ciba-hitl-lab", verification: mark("none", "None") }] },
      { shelfUrl: "http://shelf.example", demos: [{ id: "other-lab", verification: mark("verified", "Verified") }] },
    ]) {
      withShelf(payload);
      const { unmount } = render(<App />);
      const bar = within(await screen.findByTestId("top-menu"));
      expect(await bar.findByRole("link", { name: "Shelf" })).toBeInTheDocument(); // the shelf answered, and still no badge
      expect(document.querySelector(".verify")).toBeNull();
      unmount();
    }
  });
});
