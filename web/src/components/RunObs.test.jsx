// Rule 27: the lab's page wrapper for the run panel. The panel must show the run in the mode the run was made in.
import { test, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import React from "react";
import RunObs, { headOf } from "./RunObs.jsx";
import { getJson } from "../lib/api.js";
import { realRecord } from "../run-observability/fixtures.js";

vi.mock("../lib/api.js", () => ({ getJson: vi.fn() }));

test("the head of a write answer carries the mode the run was made in", () => {
  expect(headOf({ run: { id: "write-abc123-1" }, source: "real" })).toEqual({ runId: "write-abc123-1", source: "real" });
  expect(headOf({ run: { id: "write-abc123-1" }, source: "mock" })).toEqual({ runId: "write-abc123-1", source: "mock" });
});

test("a write answer that does not say its mode is an alert, never a guessed mode", () => {
  expect(headOf({ run: { id: "write-abc123-1" } })).toEqual({ bad: true });
});

test("a Real run's record is shown in Real, not refused as a Mock page", async () => {
  getJson.mockResolvedValue({ record: realRecord });
  const { container } = render(<RunObs head={{ runId: "write-abc123-1", source: "real" }} />);
  await waitFor(() => expect(container.querySelector('[data-testid="ro-wrap"]')).not.toBeNull());
  expect(container.textContent).not.toMatch(/Not shown/);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

// Review fix (finding 2): the one-line note must agree with the server: person and agent have no row of their own in this lab.
test("the note under the panel says person and agent sit on the exchange row, as the server does", async () => {
  getJson.mockResolvedValue({ record: realRecord });
  const { container } = render(<RunObs head={{ runId: "write-abc123-1", source: "real" }} />);
  await waitFor(() => expect(container.querySelector('[data-testid="ro-lab-note"]')).not.toBeNull());
  const note = container.querySelector('[data-testid="ro-lab-note"]').textContent;
  expect(note).not.toMatch(/Person is the persona/);
  expect(note).not.toMatch(/Agent is the agent client id/);
  expect(note).toMatch(/exchange row/);
});

// Review nit (finding 4): the page states that a run's answer can carry, without a record.
test("no run yet shows the empty note, a run that began none shows the server's note, a bad answer is an alert", async () => {
  const empty = render(<RunObs head={null} />);
  expect(empty.container.querySelector('[data-testid="ro-empty"]')).not.toBeNull();
  empty.unmount();
  const none = render(<RunObs head={{ none: "This request began no run, so nothing was recorded." }} />);
  expect(none.container.querySelector('[data-testid="ro-no-run"]').textContent).toMatch(/began no run/);
  none.unmount();
  const bad = render(<RunObs head={{ bad: true }} />);
  expect(bad.container.querySelector('[role="alert"]')).not.toBeNull();
});
