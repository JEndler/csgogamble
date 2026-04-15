/**
 * Download a GOTV demo file from an HLTV match page, upload it to R2,
 * and record the metadata via the worker's /ingest/demo endpoint.
 *
 * Prerequisites:
 *   1. npm install && npx playwright install chromium
 *   2. Start the worker locally: npm run dev
 *
 * Usage:
 *   npm run download-demo -- <match-url>
 *   npm run download-demo -- <match-url> --worker-url http://localhost:8787
 *   npm run download-demo -- <match-url> --remote   # upload to remote R2
 */

import { execFile } from 'node:child_process';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { extractMatchIdFromUrl } from '../src/hltv';
import { demoStorageKey } from '../src/storage';
import { launchBrowser } from './browser';

const execFileAsync = promisify(execFile);
const DEFAULT_WORKER_URL = 'http://localhost:8787';

interface DownloadDemoOptions {
  workerUrl: string;
  remote: boolean;
}

function parseArgs(): { options: DownloadDemoOptions; matchUrl: string } {
  const args = process.argv.slice(2);
  const options: DownloadDemoOptions = {
    workerUrl: DEFAULT_WORKER_URL,
    remote: false,
  };

  let matchUrl = '';
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--worker-url' && args[index + 1]) {
      options.workerUrl = args[index + 1];
      index += 1;
    } else if (arg === '--remote') {
      options.remote = true;
    } else if (!matchUrl) {
      matchUrl = arg;
    }
  }

  if (!matchUrl) {
    throw new Error('Usage: npm run download-demo -- <match-url> [--worker-url http://localhost:8787] [--remote]');
  }

  return { options, matchUrl };
}

async function acceptCookies(page: import('playwright').Page): Promise<void> {
  const decline = page.locator('#CybotCookiebotDialogBodyButtonDecline');
  if (await decline.count()) {
    await decline.click();
    await page.waitForTimeout(500);
  }
}

async function main(): Promise<void> {
  const { options, matchUrl } = parseArgs();
  const matchId = extractMatchIdFromUrl(matchUrl);

  const { browser, page } = await launchBrowser({ downloads: true });

  try {
    await page.goto(matchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    await acceptCookies(page);

    const demoPath = await page.locator('[data-demo-link]').first().getAttribute('data-demo-link');
    if (!demoPath) {
      throw new Error('No demo link found on page');
    }

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.locator('[data-demo-link-button]').first().click(),
    ]);

    const tempDir = await mkdtemp(join(tmpdir(), 'hltv-demo-'));
    const suggestedName = download.suggestedFilename();
    const downloadTarget = join(tempDir, suggestedName);
    await download.saveAs(downloadTarget);
    const stats = await stat(downloadTarget);

    const storageKey = demoStorageKey(matchId, suggestedName);
    const objectPath = `csgogamble-demos/${storageKey}`;
    const wranglerArgs = ['r2', 'object', 'put', objectPath, '--file', downloadTarget];
    wranglerArgs.push(options.remote ? '--remote' : '--local');
    await execFileAsync('wrangler', wranglerArgs, { cwd: process.cwd() });

    const response = await fetch(`${options.workerUrl}/ingest/demo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        matchId,
        rawDemoUrl: `https://www.hltv.org${demoPath}`,
        demoR2Key: storageKey,
        downloadFileName: basename(suggestedName),
        contentType: 'application/vnd.rar',
        byteSize: stats.size,
      }),
    });

    if (!response.ok) {
      throw new Error(`Failed to record demo metadata: ${response.status} ${await response.text()}`);
    }

    console.log(
      JSON.stringify(
        {
          ok: true,
          matchId,
          rawDemoUrl: `https://www.hltv.org${demoPath}`,
          demoR2Key: storageKey,
          fileName: suggestedName,
          byteSize: stats.size,
          storageMode: options.remote ? 'remote' : 'local',
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
