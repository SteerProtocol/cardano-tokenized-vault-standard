/** Inspect actual mint/signature fields without relying on planner intent or reader projection. */
import { CML, withCMLScope } from "@lucid-evolution/lucid";

export function maintenanceEvidence(cbor: string) {
  return withCMLScope((own) => {
    const tx = own(CML.Transaction.from_cbor_hex(cbor));
    const body = own(tx.body());
    const mint = own(body.mint());
    const required = own(body.required_signers());
    const witnesses = own(tx.witness_set());
    const keys = own(witnesses.vkeywitnesses());
    const requiredSigners: string[] = [];
    const signerHashes: string[] = [];

    for (let i = 0; i < (required?.len() ?? 0); i++) {
      const hash = required && own(required.get(i));

      if (hash) requiredSigners.push(hash.to_hex());
    }

    for (let i = 0; i < (keys?.len() ?? 0); i++) {
      const witness = keys && own(keys.get(i));

      if (witness) {
        const key = own(witness.vkey());

        signerHashes.push(own(key.hash()).to_hex());
      }
    }

    return { hasMint: mint !== undefined, requiredSigners, signerHashes };
  });
}
