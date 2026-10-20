/** Native SHARE and asset Claim custody are restored by real delivery/settlement rollbacks. */
import { readAcceptedTransaction } from "@ctvs/integration";
import type { Address } from "@ctvs/protocol";
import { expect, it } from "vitest";
import deposit from "../fixtures/accepted/ctvs2-native-deposit-real-rollback.json" with {
  type: "json",
};
import redeem from "../fixtures/accepted/ctvs2-native-redeem-real-rollback.json" with {
  type: "json",
};
import {
  apply,
  backward,
  custody,
  type Event,
  projection,
  state,
  wire,
} from "./native-rollback-fixture.js";

const value = (raw: Record<string, string>) =>
  Object.fromEntries(Object.entries(raw).map(([unit, amount]) => [unit, BigInt(amount)]));

for (const fixture of [deposit, redeem]) {
  const { policy, underlying, owner, kind } = fixture.expected;
  const request = { ...fixture.expected.request, index: BigInt(fixture.expected.request.index) };
  const claim = { ...fixture.expected.claim, index: BigInt(fixture.expected.claim.index) };

  it(`restores the native ${kind} funded Claim and ownership after actual delivery rollback`, () => {
    const reader = projection(fixture);
    let reversals = 0;

    for (const event of fixture.sessions.delivery as Event[]) {
      if (backward(event)) {
        expect(reader.request(policy, request).data.status).toBe("delivered");
        expect(reader.claim(policy, claim).data.delivered).toBe(true);
        apply(reader, event);
        expect(reader.request(policy, request).data.status).toBe("claimable");
        expect(reader.request(policy, request).data.completion).toBeNull();
        expect(reader.claim(policy, claim).data.delivered).toBe(false);
        expect(reader.claim(policy, claim).data.source.value).toEqual(
          value(fixture.expected.claimValue),
        );
        state(reader, policy, fixture.expected.deliveredState);
        custody(reader, policy, underlying);

        const ownership = reader.ownership(policy, owner as Address).data;

        expect(ownership.freeShares).toBe(kind === "deposit" ? 0n : 90000000n);
        expect(ownership.issuedUndeliveredShares).toBe(kind === "deposit" ? 100000000n : 0n);
        expect(ownership.fixedAssetClaims).toBe(kind === "redeem" ? 9900990n : 0n);
        reversals++;
      } else apply(reader, event);
    }

    expect(reversals).toBe(1);
  });

  it(`restores native ${kind} escrow and preserves its complete refund on the replacement branch`, () => {
    const reader = projection(fixture);
    let reversals = 0;

    for (const event of fixture.sessions.settlement as Event[]) {
      if (backward(event)) {
        expect(reader.request(policy, request).data.status).toBe("claimable");
        apply(reader, event);
        expect(reader.request(policy, request).data.status).toBe("pending_escrow");
        expect(reader.request(policy, request).data.settlement).toBeNull();
        expect(() => reader.claim(policy, claim)).toThrow();
        expect(reader.recoverySource(policy, request).source.value).toEqual(
          value(fixture.expected.requestValue),
        );
        state(reader, policy, fixture.expected.restoredState);
        custody(reader, policy, underlying);
        reversals++;
      } else apply(reader, event);
    }

    expect(reversals).toBe(1);
    expect(reader.request(policy, request).data.status).toBe("refunded");
    expect(reader.request(policy, request).data.completion?.txId).toBe(fixture.expected.cancel);
    expect(() => reader.claim(policy, claim)).toThrow();
    expect(() => reader.recoverySource(policy, request)).toThrow("no unspent");
    state(reader, policy, fixture.expected.restoredState);
    custody(reader, policy, underlying);

    const accepted = (fixture.sessions.settlement as Event[])
      .flatMap((event) => (event.direction === "forward" ? event.block.transactions : []))
      .map(readAcceptedTransaction)
      .find((tx) => tx.id === fixture.expected.cancel);

    expect(accepted?.outputs[0]?.value).toEqual(value(fixture.expected.requestValue));
    expect(accepted?.inputs).not.toContainEqual(reader.context(policy).stateInput.ref);
    expect(reader.ownership(policy, owner as Address).data.freeShares).toBe(
      kind === "deposit" ? 0n : 100000000n,
    );
  });

  it(`matches native ${kind} fork targets to original Ogmios backward messages`, () => {
    for (const name of ["delivery", "settlement"] as const)
      wire(fixture.sessions[name] as Event[], fixture.wire[name]);
  });
}
