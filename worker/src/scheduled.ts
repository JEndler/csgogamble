import { createDiscoverResultsMessage, enqueueMessages } from './queue';
import type { Env } from './types';

export async function enqueueScheduledDiscovery(env: Env, controller: ScheduledController): Promise<void> {
  await enqueueMessages(env, [
    createDiscoverResultsMessage({
      source: `cron:${controller.cron}`,
      acquisitionMode: 'browser-session',
      browserSessionKey: `cron-${controller.scheduledTime}`,
      maxMatches: 20,
    }),
  ]);
}
