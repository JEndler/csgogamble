import { describe, expect, it } from 'vitest';
import {
  buildIngestMatchMessages,
  createDiscoverResultsMessage,
  createIngestMatchMessage,
  parseQueueMessage,
} from '../src/queue';

describe('queue orchestration helpers', () => {
  it('creates and parses a discover-results queue message', () => {
    const message = createDiscoverResultsMessage({
      pageUrl: 'https://www.hltv.org/results?offset=100',
      persistHtml: false,
      source: 'scheduled',
      acquisitionMode: 'browser-session',
      browserSessionKey: 'cron-batch-1',
    });

    expect(parseQueueMessage(message)).toEqual(message);
  });

  it('creates ingest-match queue messages from discovered URLs', () => {
    expect(
      buildIngestMatchMessages(
        ['https://www.hltv.org/matches/123/alpha-vs-beta', 'https://www.hltv.org/matches/456/gamma-vs-delta'],
        {
          persistHtml: false,
          source: 'cron:*/15 * * * *',
          acquisitionMode: 'browser-session',
          browserSessionKey: 'cron-batch-1',
        },
      ),
    ).toEqual([
      createIngestMatchMessage({
        matchUrl: 'https://www.hltv.org/matches/123/alpha-vs-beta',
        persistHtml: false,
        source: 'cron:*/15 * * * *',
        acquisitionMode: 'browser-session',
        browserSessionKey: 'cron-batch-1',
      }),
      createIngestMatchMessage({
        matchUrl: 'https://www.hltv.org/matches/456/gamma-vs-delta',
        persistHtml: false,
        source: 'cron:*/15 * * * *',
        acquisitionMode: 'browser-session',
        browserSessionKey: 'cron-batch-1',
      }),
    ]);
  });

  it('rejects malformed queue messages', () => {
    expect(() => parseQueueMessage({ type: 'unknown', payload: {} })).toThrow('Unsupported queue message type');
    expect(() => parseQueueMessage({ type: 'discover-results', payload: { pageUrl: 123 } })).toThrow(
      'Queue discovery job requires a string pageUrl when provided',
    );
    expect(() => parseQueueMessage({ type: 'ingest-match', payload: {} })).toThrow(
      'Queue ingest job requires either matchUrl or matchId',
    );
  });
});
