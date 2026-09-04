import { getAppLogger } from "../observability/logger.js";
import type { WatchFiring } from "../types/watch.js";
import { evaluateWatchThresholds, loadWatchSnapshot } from "./watch-evaluate.js";
import {
  getWatchStore,
  type WatchRecord,
  withFiring
} from "./watch-store.js";
import {
  buildWatchWebhookDelivery,
  postWatchWebhook,
  type WatchWebhookPoster
} from "./watch-webhook.js";

export interface WatchPollDependencies {
  nowMs?: number;
  loadSnapshot?: typeof loadWatchSnapshot;
  postWebhook?: WatchWebhookPoster;
}

export interface WatchPollSummary {
  watches: number;
  fired: number;
  delivered: number;
  failed: number;
  stored: number;
}

export async function runWatchPoll(
  deps: WatchPollDependencies = {}
): Promise<WatchPollSummary> {
  const nowMs = deps.nowMs ?? Date.now();
  const loadSnapshot = deps.loadSnapshot ?? loadWatchSnapshot;
  const postWebhook = deps.postWebhook ?? postWatchWebhook;
  const store = getWatchStore();
  const watches = await store.listActive(nowMs);
  const summary: WatchPollSummary = {
    watches: watches.length,
    fired: 0,
    delivered: 0,
    failed: 0,
    stored: 0
  };

  for (const watch of watches) {
    try {
      const snapshot = await loadSnapshot(watch.address);
      const evaluation = evaluateWatchThresholds(
        watch.watchId,
        watch.thresholds,
        watch.lastSnapshot,
        snapshot,
        nowMs
      );
      let next: WatchRecord = {
        ...watch,
        lastSnapshot: evaluation.nextSnapshot
      };

      const pending = [
        ...evaluation.firings,
        ...watch.firings.filter(
          (firing) =>
            firing.deliveryStatus === "pending" || firing.deliveryStatus === "failed"
        )
      ];
      const seen = new Set<string>();
      for (const firing of pending) {
        if (seen.has(firing.idempotencyKey)) {
          continue;
        }
        seen.add(firing.idempotencyKey);
        if (evaluation.firings.some((item) => item.idempotencyKey === firing.idempotencyKey)) {
          summary.fired += 1;
        }
        const delivered = await deliverFiring(next, firing, postWebhook);
        next = withFiring(next, delivered);
        if (delivered.deliveryStatus === "delivered") {
          summary.delivered += 1;
        } else if (delivered.deliveryStatus === "stored") {
          summary.stored += 1;
        } else {
          summary.failed += 1;
        }
      }

      await store.save(next, nowMs);
    } catch (error) {
      getAppLogger().error(
        {
          event: "watch_poll_error",
          watchId: watch.watchId,
          err: error instanceof Error ? error.message : String(error)
        },
        "Watch poll failed for one retainer"
      );
    }
  }

  return summary;
}

async function deliverFiring(
  watch: WatchRecord,
  firing: WatchFiring,
  postWebhook: WatchWebhookPoster
): Promise<WatchFiring> {
  if (!watch.webhookUrl) {
    return { ...firing, delivered: true, deliveryStatus: "stored" };
  }
  const delivery = buildWatchWebhookDelivery(watch.webhookUrl, watch.webhookSecret, {
    watchId: watch.watchId,
    address: watch.address,
    kind: firing.kind,
    idempotencyKey: firing.idempotencyKey,
    firedAt: firing.firedAt,
    threshold: firing.threshold,
    previous: firing.previous,
    current: firing.current,
    ...(firing.opportunityId ? { opportunityId: firing.opportunityId } : {})
  });
  const result = await postWebhook(delivery);
  if (result.ok) {
    return { ...firing, delivered: true, deliveryStatus: "delivered" };
  }
  return { ...firing, delivered: false, deliveryStatus: "failed" };
}
