import { evaluateCircuit, SCHEDULED_DISCOVERY_CIRCUIT_KEY } from './circuit';
import { createIngestRun } from './db';
import { createDiscoverResultsMessage, enqueueMessages } from './queue';
import type { Env } from './types';

const DEFAULT_DISCOVERY_FANOUT_MAX_MATCHES = 40;
/**
 * Canary discoveries fetch a tiny slice of the source first. If they succeed,
 * the consumer enqueues the real fan-out; if they're challenged or classified
 * as a known failure, the circuit opens immediately (threshold=1) and the next
 * cron tick will skip cleanly instead of hammering HLTV.
 */
const CANARY_MAX_MATCHES = 1;

export async function enqueueScheduledDiscovery(env: Env, controller: ScheduledController): Promise<void> {
  // Skip enqueueing entirely when the discovery circuit is open. The queue consumer
  // would otherwise just write a skipped_circuit_open row each tick, but recording
  // it here keeps the cron path itself observable in ingest_runs.
  const decision = await evaluateCircuit(env, { key: SCHEDULED_DISCOVERY_CIRCUIT_KEY });
  if (decision.open) {
    const cooldownMinutes = Math.ceil(decision.cooldownRemainingMs / 60_000);
    await createIngestRun(
      env,
      'scheduled-discovery',
      `cron-${controller.scheduledTime}`,
      'skipped_circuit_open',
      `Cron tick skipped while circuit open; cooldown ${cooldownMinutes}m remaining (lastClass=${decision.state.lastFailureClass ?? 'none'})`,
      decision.state.lastFailureClass,
    );
    return;
  }

  await enqueueMessages(env, [
    createDiscoverResultsMessage({
      source: `cron:${controller.cron}`,
      acquisitionMode: 'http-stealth',
      browserSessionKey: `cron-${controller.scheduledTime}`,
      maxMatches: CANARY_MAX_MATCHES,
      canary: true,
      followupMaxMatches: DEFAULT_DISCOVERY_FANOUT_MAX_MATCHES,
    }),
  ]);
}
