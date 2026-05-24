import { existsSync, readFileSync } from 'node:fs';

export interface WorkerInvokeOptions {
  url: string;
  adminToken: string;
  body?: unknown;
}

function loadDotEnvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    const key = trimmed
      .slice(0, separator)
      .trim()
      .replace(/^export\s+/, '');
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    process.env[key] = process.env[key] ?? value;
  }
}

function loadEnv(): void {
  loadDotEnvFile('.env');
  loadDotEnvFile('.dev.vars');
  process.env.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CF_API_TOKEN;
  process.env.CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID ?? process.env.CF_ACCOUNT_ID;
}

function parseFlag(args: string[], name: string): string | null {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

function numberFlag(args: string[], name: string): number | undefined {
  const value = parseFlag(args, name);
  return value === null ? undefined : Number(value);
}

function booleanFlag(args: string[], name: string): boolean | undefined {
  const value = parseFlag(args, name);
  if (value === null) return undefined;
  return value === 'true' ? true : value === 'false' ? false : undefined;
}

async function invoke(path: string, body?: unknown): Promise<unknown> {
  const workerUrl = process.env.WORKER_URL;
  const adminToken = process.env.ADMIN_TOKEN;
  if (!workerUrl) throw new Error('WORKER_URL is required');
  if (!adminToken) throw new Error('ADMIN_TOKEN is required');
  const response = await fetch(new URL(path, workerUrl).toString(), {
    method: path.endsWith('/status') ? 'GET' : 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-token': adminToken,
    },
    body: path.endsWith('/status') ? undefined : JSON.stringify(body ?? {}),
  });
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = { raw: text };
  }
  if (!response.ok) {
    throw new Error(`Worker ${response.status}: ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  loadEnv();
  const args = process.argv.slice(2);
  const command = args[0] ?? 'status';
  let result: unknown;
  if (command === 'gamma') {
    result = await invoke('/admin/polymarket/gamma/run', {
      runId: numberFlag(args, '--run-id'),
      cursor: parseFlag(args, '--cursor'),
      pageIndex: numberFlag(args, '--page-index'),
      maxPages: numberFlag(args, '--max-pages'),
      pageLimit: numberFlag(args, '--page-limit'),
      tagId: numberFlag(args, '--tag-id'),
      closed: booleanFlag(args, '--closed'),
      archived: booleanFlag(args, '--archived'),
    });
  } else if (command === 'price-history') {
    const tokenIds = parseFlag(args, '--token-ids')?.split(',').filter(Boolean);
    result = await invoke('/admin/polymarket/price-history/run', {
      runId: numberFlag(args, '--run-id'),
      tokenIds,
      marketType: parseFlag(args, '--market-type') ?? undefined,
      limit: numberFlag(args, '--limit'),
      interval: parseFlag(args, '--interval') ?? undefined,
      fidelityMinutes: numberFlag(args, '--fidelity'),
      startTs: numberFlag(args, '--start-ts'),
      endTs: numberFlag(args, '--end-ts'),
      onlyMissing: booleanFlag(args, '--only-missing'),
    });
  } else if (command === 'status') {
    result = await invoke('/admin/polymarket/status');
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
