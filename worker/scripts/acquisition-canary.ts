interface Options {
  workerUrl: string;
  adminToken: string;
  modes: string[];
  repetitions: number;
  pageUrl: string | null;
  matchUrl: string | null;
  label: string;
  json: boolean;
}

interface CanaryTablePayload {
  operatorLabel: string;
  summary: {
    ok: number;
    challenge: number;
    unusable: number;
    error: number;
    byMode: Record<string, { attempts: number; ok: number; challenge: number; unusable: number; error: number }>;
  };
  results: Array<{
    mode: string;
    targetName: string;
    repetition: number;
    status: string;
    title: string | null;
    htmlBytes: number;
    discoveredMatchUrlCount: number | null;
    challengeMarkers: string[];
    error: string | null;
  }>;
}

interface CanaryTargetBody {
  name: string;
  kind: 'results' | 'match';
  pageUrl?: string;
  matchUrl?: string;
}

function value(args: string[], name: string): string | null {
  const prefix = `${name}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const workerUrl = value(args, '--worker-url') ?? process.env.WORKER_URL;
  const adminToken = value(args, '--admin-token') ?? process.env.ADMIN_TOKEN;
  if (!workerUrl) throw new Error('--worker-url or WORKER_URL is required');
  if (!adminToken) throw new Error('--admin-token or ADMIN_TOKEN is required');
  return {
    workerUrl: workerUrl.replace(/\/$/, ''),
    adminToken,
    modes: (value(args, '--modes') ?? 'http-stealth,browser-native,browser-stealth,browser-session-stealth')
      .split(',')
      .map((mode) => mode.trim())
      .filter(Boolean),
    repetitions: Number(value(args, '--repetitions') ?? '1'),
    pageUrl: value(args, '--page-url'),
    matchUrl: value(args, '--match-url'),
    label: value(args, '--label') ?? `stealth-canary-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    json: args.includes('--json'),
  };
}

function buildTargets(options: Options): CanaryTargetBody[] {
  const targets: CanaryTargetBody[] = [];
  if (options.pageUrl) targets.push({ name: 'results', kind: 'results', pageUrl: options.pageUrl });
  if (options.matchUrl) targets.push({ name: 'match', kind: 'match', matchUrl: options.matchUrl });
  if (targets.length === 0) targets.push({ name: 'results', kind: 'results', pageUrl: 'https://www.hltv.org/results' });
  return targets;
}

function printTable(payload: CanaryTablePayload): void {
  console.log(`Canary ${payload.operatorLabel}`);
  console.log(
    `Summary: ok=${payload.summary.ok} challenge=${payload.summary.challenge} unusable=${payload.summary.unusable} error=${payload.summary.error}`,
  );
  for (const [mode, stats] of Object.entries(payload.summary.byMode)) {
    const row = stats as { attempts: number; ok: number; challenge: number; unusable: number; error: number };
    console.log(
      `${mode}: attempts=${row.attempts} ok=${row.ok} challenge=${row.challenge} unusable=${row.unusable} error=${row.error}`,
    );
  }
  for (const result of payload.results) {
    console.log(
      `${result.mode} ${result.targetName}#${result.repetition}: ${result.status} title=${JSON.stringify(result.title)} bytes=${result.htmlBytes} discovered=${result.discoveredMatchUrlCount ?? '-'} markers=${result.challengeMarkers.join('|') || '-'} error=${result.error ?? '-'}`,
    );
  }
}

async function main(): Promise<void> {
  const options = parseArgs();
  const response = await fetch(`${options.workerUrl}/admin/acquisition/canary`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-admin-token': options.adminToken,
    },
    body: JSON.stringify({
      operatorLabel: options.label,
      targets: buildTargets(options),
      modes: options.modes,
      repetitions: options.repetitions,
      sessionPolicy: 'fresh-per-attempt',
      closeSessions: true,
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status}: ${text}`);
  if (options.json) {
    console.log(text);
    return;
  }
  printTable(JSON.parse(text));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
