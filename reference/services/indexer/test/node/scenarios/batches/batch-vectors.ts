/** Independent integer vectors for the fixture's one-percent fees and unit price. */
export const batchVectors = [
  {
    stage: "mixed-issue",
    deposit: 13466671n,
    issued: 13333337n,
    entryFee: 133334n,
    redeem: 7777777n,
    redeemed: 7700769n,
    exitFee: 77008n,
    delta: 5555560n,
    backing: 105555560n,
    fees: 1210342n,
    sequence: 2n,
  },
  {
    stage: "mixed-burn",
    deposit: 5050003n,
    issued: 5000002n,
    entryFee: 50001n,
    redeem: 13333337n,
    redeemed: 13201323n,
    exitFee: 132014n,
    delta: -8333335n,
    backing: 97222225n,
    fees: 1392357n,
    sequence: 3n,
  },
  {
    stage: "zero-net",
    deposit: 10100003n,
    issued: 10000002n,
    entryFee: 100001n,
    redeem: 10000002n,
    redeemed: 9900992n,
    exitFee: 99010n,
    delta: 0n,
    backing: 97222225n,
    fees: 1591368n,
    sequence: 4n,
  },
] as const;

export type BatchVector = Omit<(typeof batchVectors)[number], "stage"> & { stage: string };
