/** Byte-equivalent hex must identify one deployment without admitting malformed or foreign identities. */
import { stateData } from "@ctvs/protocol";
import { expect, test } from "vitest";
import { assertContext, resolveState } from "../src/context.js";
import { createGenesisPlan } from "../src/genesis.js";
import { validatePlan } from "../src/plan.js";
import { stateValue } from "../src/value.js";
import { fixture, required, source, stateRef } from "./fixtures.js";

const policy = "ab".repeat(28),
  networkDomain = "cd".repeat(32);

test.each(["ctvs1", "ctvs2"] as const)(
  "%s context and State bindings compare hex identities as bytes",
  (family) => {
    const overrides = { terms: { networkDomain }, state: { vaultPolicy: policy } };
    const f = family === "ctvs1" ? fixture("ctvs1", overrides) : fixture("ctvs2", overrides);
    const deployment = {
      ...f.deployment,
      policy: policy.toUpperCase(),
      networkDomain: networkDomain.toUpperCase(),
      termsHash: f.deployment.termsHash.toUpperCase(),
    };
    const context = {
      ...f,
      deployment,
      stateInput: source(stateRef, stateData(f.state), stateValue(f.state, f.terms), policy),
    };

    expect(resolveState(context, family)).toEqual(f.state);
    expect(() =>
      assertContext(
        {
          ...context,
          terms: { ...f.terms, networkDomain: networkDomain.toUpperCase() },
          deployment: { ...deployment, networkDomain },
        },
        family,
      ),
    ).not.toThrow();
  },
);

test("case equivalence never admits malformed or different deployment hashes", () => {
  const f = fixture("ctvs1");

  for (const field of ["networkDomain", "termsHash"] as const) {
    for (const invalid of ["gg".repeat(32), "a".repeat(63), "00".repeat(32)]) {
      expect(() =>
        assertContext(
          {
            ...f,
            deployment: { ...f.deployment, [field]: invalid },
          },
          "ctvs1",
        ),
      ).toThrow();
    }
  }
});

test("underlying assets under the vault policy remain forbidden across hex casing", () => {
  const f = fixture("ctvs1", { terms: { underlying: { policy, name: "ff" } } });

  expect(() =>
    assertContext(
      {
        ...f,
        deployment: { ...f.deployment, policy: policy.toUpperCase() },
      },
      "ctvs1",
    ),
  ).toThrow(/under vault policy/);
});

test("plan mint identity permits equivalent hex and rejects malformed or foreign policies", () => {
  const f = fixture("ctvs1");
  const plan = createGenesisPlan("ctvs1", {
    ...f,
    deployment: { ...f.deployment, policy },
    seed: stateRef,
    configReserve: 2_000_000n,
    stateReserve: 3_000_000n,
  });
  const mint = required(plan.mint[0]);

  expect(() =>
    validatePlan({ ...plan, mint: [{ ...mint, policy: policy.toUpperCase() }] }),
  ).not.toThrow();

  for (const invalid of ["gg".repeat(28), "a".repeat(55), "ff".repeat(28)]) {
    expect(() => validatePlan({ ...plan, mint: [{ ...mint, policy: invalid }] })).toThrow();
  }

  expect(() =>
    validatePlan({
      ...plan,
      implementation: { ...plan.implementation, policy: "gg".repeat(28) },
      mint: [{ ...mint, policy: "gg".repeat(28) }],
    }),
  ).toThrow();
});
