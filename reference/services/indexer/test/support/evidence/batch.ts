/** Read actual signed mint and signature fields without inferring gross obligations from net mint. */
import assert from "node:assert/strict";
import { NAMES } from "@ctvs/protocol";
import { CML, withCMLScope } from "@lucid-evolution/lucid";
import { maintenanceEvidence } from "./authorization.js";

export function batchEvidence(cbor: string, policy: string) {
  const authorization = maintenanceEvidence(cbor);
  const shares = withCMLScope((own) => {
    const tx = own(CML.Transaction.from_cbor_hex(cbor));
    const mint = own(own(tx.body()).mint());

    if (!mint) return null;

    const policies = own(mint.keys());

    assert.equal(policies.len(), 1);

    const id = own(policies.get(0));

    assert.equal(id.to_hex(), policy);

    const assets = own(mint.get_assets(id));

    assert.ok(assets);

    const names = own(assets.keys());

    assert.equal(names.len(), 1);

    const name = own(names.get(0));

    assert.equal(name.to_hex(), NAMES.share);

    const quantity = assets.get(name);

    assert.ok(quantity !== undefined);

    return quantity;
  });

  return { ...authorization, shares };
}
