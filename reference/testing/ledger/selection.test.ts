/** Pins retry classification to known resource errors so semantic failures cannot masquerade as smaller-batch retries. */
import { ResourceLimitError } from "@ctvs/cardano";
import { expect, it } from "vitest";
import { constructionResourceFailure } from "./selection.js";

it.each([
  ["Max transaction size of 16384 exceeded. Found: 18324", "size"],
  [
    "failed script execution Spend[4] execution went over budget Mem -3323 CPU 3745941125",
    "memory",
  ],
  ["failed script execution Spend[4] execution went over budget Mem 3323 CPU -3745", "steps"],
  ["Signed aggregate memory budget exceeds transaction limit", "memory"],
  ["Signed aggregate step budget exceeds transaction limit", "steps"],
])("classifies only pinned resource failure %s", (message, resource) => {
  expect(constructionResourceFailure(new Error(message))?.resource).toBe(resource);
});

it.each([
  "unauthorized settler",
  "request minimum violated",
  "minimum ADA changed protected output",
  "failed script execution: validator returned false",
  "Missing authentic input",
])("does not retry semantic or construction-integrity failure %s", (message) => {
  expect(constructionResourceFailure(new Error(message))).toBeNull();
});

it("preserves typed signed-size failures", () => {
  const error = new ResourceLimitError("size", "Signed size exceeds limit");

  expect(constructionResourceFailure(error)).toBe(error);
});
