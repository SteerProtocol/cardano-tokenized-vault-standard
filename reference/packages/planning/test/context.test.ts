/** Supplied-evidence checks reject conflicting family, deployment, datum and custody claims. */
import { constr, stateData } from "@ctvs/protocol";
import { expect, test } from "vitest";
import {
  assertContext,
  assertDeploymentFamily,
  assertProtectedInput,
  finiteValidity,
  resolveState,
} from "../src/context.js";
import { fixture, policy, source, stateRef } from "./fixtures.js";

test("family binding rejects cross-family deployments and incompatible advertised modes", () => {
  const sync = fixture("ctvs1"),
    async = fixture("ctvs2");

  expect(() => assertContext(sync, "ctvs1")).not.toThrow();
  expect(() => assertContext(async, "ctvs2")).not.toThrow();
  expect(() => assertContext(async, "ctvs1")).toThrow(/expected ctvs1/);
  expect(() => assertContext(sync, "ctvs2")).toThrow(/expected ctvs2/);
  expect(() =>
    assertContext(fixture("ctvs1", { terms: { executionModes: 15n } }), "ctvs1"),
  ).toThrow(/incompatible/);
  expect(() => assertContext(fixture("ctvs2", { terms: { executionModes: 3n } }), "ctvs2")).toThrow(
    /incompatible/,
  );
  expect(() =>
    Reflect.apply(assertDeploymentFamily, undefined, [
      { ...sync.deployment, claimScript: policy },
      "ctvs1",
    ]),
  ).toThrow(/cannot depend/);
  expect(() =>
    Reflect.apply(assertDeploymentFamily, undefined, [
      { ...async.deployment, claimScript: null },
      "ctvs2",
    ]),
  ).toThrow(/requires/);
});
test("network, implementation and committed terms are never inferred from labels", () => {
  const f = fixture("ctvs1");

  for (const change of [{ network: "" }, { networkDomain: "00".repeat(32) }]) {
    expect(() =>
      assertContext({ ...f, deployment: { ...f.deployment, ...change } }, "ctvs1"),
    ).toThrow(/network/);
  }

  expect(() =>
    assertContext({ ...f, deployment: { ...f.deployment, termsHash: "00".repeat(32) } }, "ctvs1"),
  ).toThrow(/commitment/);
  expect(() =>
    assertContext({ ...f, deployment: { ...f.deployment, buildId: "" } }, "ctvs1"),
  ).toThrow(/build binding/);
  expect(() =>
    assertContext({ ...f, deployment: { ...f.deployment, configLock: "00" } }, "ctvs1"),
  ).toThrow();
  expect(() =>
    assertContext(fixture("ctvs1", { terms: { underlying: { policy, name: "ff" } } }), "ctvs1"),
  ).toThrow(/under vault policy/);
  expect(() =>
    assertContext(
      {
        ...f,
        deployment: { ...f.deployment, chainPoint: { slot: -1n, blockHash: "11".repeat(32) } },
      },
      "ctvs1",
    ),
  ).toThrow(/slot/);
});
test("resolved State checks own address, datum mode, reference script, identities and actual funding", () => {
  const f = fixture("ctvs1");

  expect(resolveState(f, "ctvs1")).toEqual(f.state);
  expect(() =>
    assertProtectedInput(
      {
        ...f.stateInput,
        address: { ...f.stateInput.address, stake: { type: "key", hash: policy } },
      },
      policy,
    ),
  ).toThrow(/address/);
  expect(() =>
    Reflect.apply(assertProtectedInput, undefined, [
      { ...f.stateInput, referenceScript: "nonempty" },
      policy,
    ]),
  ).toThrow(/reference script/);
  expect(() =>
    Reflect.apply(assertProtectedInput, undefined, [
      { ...f.stateInput, datumMode: "hash" },
      policy,
    ]),
  ).toThrow(/inline/);
  expect(() =>
    resolveState(
      {
        ...f,
        stateInput: source(
          stateRef,
          stateData({ ...f.state, termsHash: "00".repeat(32) }),
          f.stateInput.value,
        ),
      },
      "ctvs1",
    ),
  ).toThrow(/binding/);
  expect(() =>
    resolveState({ ...f, stateInput: source(stateRef, constr(999), f.stateInput.value) }, "ctvs1"),
  ).toThrow();
  expect(() =>
    resolveState(
      { ...f, stateInput: { ...f.stateInput, value: { ...f.stateInput.value, ada: 1n } } },
      "ctvs1",
    ),
  ).toThrow(/equation/);
});
test("settlement and recovery ranges use finite ordered bigint bounds", () => {
  expect(finiteValidity({ lowerPosixMs: 0n, upperPosixMs: 1n })).toEqual({
    lowerPosixMs: 0n,
    upperPosixMs: 1n,
    lowerInclusive: true,
    upperExclusive: true,
  });
  expect(() => finiteValidity({ lowerPosixMs: 1n, upperPosixMs: 1n })).toThrow(/nonempty/);
  expect(() => finiteValidity({ lowerPosixMs: 2n, upperPosixMs: 1n })).toThrow(/nonempty/);
  expect(() => finiteValidity({ lowerPosixMs: -1n, upperPosixMs: 1n })).toThrow(/lower/);
});
