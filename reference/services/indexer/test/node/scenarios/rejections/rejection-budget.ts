/** Real control execution must fit every declared purpose budget and the pinned ledger limits. */
import assert from "node:assert/strict";
import { CML, type EvalRedeemer, fromCMLRedeemerTag, withCMLScope } from "@lucid-evolution/lucid";
import type { Flow } from "../../support/flow.js";

export function controlBudgets(f: Flow, cbor: string, evaluated: EvalRedeemer[]) {
  withCMLScope((own) => {
    const witnesses = own(own(CML.Transaction.from_cbor_hex(cbor)).witness_set());
    const optional = witnesses.redeemers();

    assert.ok(optional);

    const rows = own(own(optional).to_flat_format());
    let mem = 0n,
      steps = 0n;

    assert.equal(rows.len(), evaluated.length);

    for (let index = 0; index < rows.len(); index++) {
      const row = own(rows.get(index));
      const units = own(row.ex_units());
      const actual = evaluated.find(
        (value) =>
          value.redeemer_tag === fromCMLRedeemerTag(row.tag()) &&
          BigInt(value.redeemer_index) === row.index(),
      );

      assert.ok(actual);
      assert.ok(
        units.mem() >= BigInt(actual.ex_units.mem),
        "control purpose exceeds declared memory",
      );
      assert.ok(
        units.steps() >= BigInt(actual.ex_units.steps),
        "control purpose exceeds declared steps",
      );
      mem += units.mem();
      steps += units.steps();
    }

    assert.ok(mem <= f.w.parameters.maxTxExMem && steps <= f.w.parameters.maxTxExSteps);
  });
}
