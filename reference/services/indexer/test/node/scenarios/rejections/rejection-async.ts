/** Async negatives retain accepted progress between settlement, recovery, pause and grouped delivery checks. */
import type { ReadQueries } from "@ctvs/integration/query";
import type { Flow } from "../../support/flow.js";
import {
  minimumRejections,
  pausedBatchRejections,
  zeroBatchRejections,
} from "./rejection-async-batch.js";
import { rejectionRequests } from "./rejection-async-source.js";
import type { Actor } from "./rejection-common.js";
import { rejectionPoint } from "./rejection-control.js";
import { deliveryRejections } from "./rejection-delivery.js";
import { opaqueRejections, refundRejections } from "./rejection-refund.js";

export async function asyncRejections(
  f: Flow,
  requested: ReadQueries,
  actor: Actor,
  withdrawal: string,
) {
  const requests = await rejectionRequests(f);

  await rejectionPoint(f, requested, "async-rejection-baseline");

  const minimum = await minimumRejections(f, requested, requests.refs, requests.bad, actor);
  const refunds = await refundRejections(f, requested, requests.bad, actor);
  const opaque = await opaqueRejections(f, requested, actor);
  const paused = await pausedBatchRejections(f, requested, requests.refs, actor);
  const settled = await zeroBatchRejections(f, requested, requests.refs, actor);
  const delivered = await deliveryRejections(f, requested, requests.refs, actor, withdrawal);

  return {
    rejected: [
      ...minimum,
      ...refunds,
      ...opaque,
      ...paused,
      ...settled.rejected,
      ...delivered.rejected,
    ],
    history: delivered.history,
  };
}
