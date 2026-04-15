import { handleRequest } from './app';
import { BrowserSession } from './browser-session';
import { processQueueBatch } from './queue';
import { enqueueScheduledDiscovery } from './scheduled';
import type { Env } from './types';

/** Worker entrypoint exposing HTTP, scheduled, and queue-driven ingestion flows. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(enqueueScheduledDiscovery(env, controller));
  },

  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    await processQueueBatch(batch, env);
  },
};

export { BrowserSession };
