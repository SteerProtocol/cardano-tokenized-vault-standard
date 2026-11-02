/** Synthetic records for component transport tests, not real protocol evidence. */
export const network = {
  networkId: 0,
  networkMagic: 42,
  genesisHash: "11".repeat(32),
};

export function rule(match, extra = {}) {
  return {
    source: "positions",
    match,
    from: { tag: "origin" },
    history: "spent-required",
    ...extra,
  };
}

export function exampleDeployment() {
  return {
    network,
    rules: [
      rule(
        { tag: "address", val: "deployment-address" },
        {
          source: "positions-\u03bb-\uD83C\uDF10",
          from: {
            tag: "point",
            val: { slot: "9007199254740993", blockHash: "22".repeat(32) },
          },
        },
      ),
      rule({ tag: "payment-credential", val: "33".repeat(28) }),
      rule({ tag: "policy", val: "44".repeat(28) }),
      rule(
        {
          tag: "asset",
          val: { policyId: "55".repeat(28), assetName: "" },
        },
        { history: "unspent-sufficient" },
      ),
    ],
  };
}

export function manyRulesDeployment(count) {
  return {
    network,
    rules: Array.from({ length: count }, (_, index) =>
      rule({
        tag: "asset",
        val: {
          policyId: "66".repeat(28),
          assetName: index.toString(16).padStart(8, "0"),
        },
      }),
    ),
  };
}

// The native test runner uses Serde's generated Rust representation on stdin
// and stdout. These conversions are fixture transport only, not a plugin codec.
function nativeMatch(match) {
  const names = {
    address: "Address",
    "payment-credential": "PaymentCredential",
    policy: "Policy",
    asset: "Asset",
  };
  const value =
    match.tag === "asset"
      ? { policy_id: match.val.policyId, asset_name: match.val.assetName }
      : match.val;

  return { [names[match.tag]]: value };
}

function nativeDeployment(config) {
  return {
    network: {
      network_id: config.network.networkId,
      network_magic: config.network.networkMagic,
      genesis_hash: config.network.genesisHash,
    },
    rules: config.rules.map((record) => ({
      source: record.source,
      match_: nativeMatch(record.match),
      from:
        record.from.tag === "origin"
          ? "Origin"
          : {
              Point: { slot: record.from.val.slot, block_hash: record.from.val.blockHash },
            },
      history: record.history === "spent-required" ? "SpentRequired" : "UnspentSufficient",
    })),
  };
}

export function nativeRequest(call) {
  return {
    config: nativeDeployment(call.config),
    cursor: call.cursor ?? null,
    page_size: call.pageSize,
  };
}

export function nativeSuccess(page) {
  return {
    ok: {
      schema: page.schema,
      ...nativeDeployment(page),
      next_cursor: page.nextCursor ?? null,
    },
  };
}

export function nativeFailure(error) {
  const codes = {
    "invalid-network": "InvalidNetwork",
    "invalid-page-size": "InvalidPageSize",
    "invalid-cursor": "InvalidCursor",
  };

  return { error: { code: codes[error.code], message: error.message } };
}
