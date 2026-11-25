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
