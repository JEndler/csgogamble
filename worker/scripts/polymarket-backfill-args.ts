export type Phase = 'gamma' | 'price-history';
export type MarketType =
  | 'match_winner'
  | 'map_winner'
  | 'total_maps'
  | 'map_handicap'
  | 'outright'
  | 'player_prop'
  | 'other'
  | 'unknown';

export interface PolymarketBackfillArgs {
  phase: Phase;
  apply: boolean;
  closed?: boolean;
  archived?: boolean;
  pageLimit: number;
  maxPagesPerCall: number;
  marketType: MarketType;
  interval: string;
  fidelity: number;
  batchSize: number;
  throttleMs: number;
  maxCalls: number;
  checkpoint: string;
  startTs?: number;
  endTs?: number;
}

function parseFlag(args: string[], name: string): string | null {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

function numberFlag(args: string[], name: string, fallback: number): number {
  const raw = parseFlag(args, name);
  const value = raw === null ? fallback : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function booleanFlag(args: string[], name: string): boolean | undefined {
  const raw = parseFlag(args, name);
  if (raw === null) return undefined;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return undefined;
}

function priceHistoryCheckpointSuffix(interval: string, startTs?: number, endTs?: number): string {
  if (interval !== 'window') return '';
  const start = startTs === undefined ? 'open' : String(startTs);
  const end = endTs === undefined ? 'open' : String(endTs);
  return `-window-${start}-${end}`;
}

export function parsePolymarketBackfillArgs(argv: string[] = process.argv.slice(2)): PolymarketBackfillArgs {
  const phase = (parseFlag(argv, '--phase') ?? 'gamma') as Phase;
  if (phase !== 'gamma' && phase !== 'price-history') throw new Error(`Unsupported --phase ${phase}`);

  const intervalFlag = parseFlag(argv, '--interval');
  const startTs = parseFlag(argv, '--start-ts') === null ? undefined : numberFlag(argv, '--start-ts', 0);
  const endTs = parseFlag(argv, '--end-ts') === null ? undefined : numberFlag(argv, '--end-ts', 0);
  const hasExplicitWindow = startTs !== undefined || endTs !== undefined;
  const interval = intervalFlag ?? (phase === 'price-history' && hasExplicitWindow ? 'window' : '1h');
  const marketType = (parseFlag(argv, '--market-type') ?? 'match_winner') as MarketType;
  const fidelityRaw = parseFlag(argv, '--fidelity') ?? '60';
  const defaultCheckpoint =
    phase === 'gamma'
      ? `.polymarket-backfill/gamma-closed=${parseFlag(argv, '--closed') ?? 'true'}-archived=${parseFlag(argv, '--archived') ?? 'false'}.json`
      : `.polymarket-backfill/price-history-${marketType}-${interval}-fidelity=${fidelityRaw}${priceHistoryCheckpointSuffix(
          interval,
          startTs,
          endTs,
        )}.json`;

  return {
    phase,
    apply: argv.includes('--apply'),
    closed: booleanFlag(argv, '--closed'),
    archived: booleanFlag(argv, '--archived'),
    pageLimit: numberFlag(argv, '--page-limit', 500),
    maxPagesPerCall: numberFlag(argv, '--max-pages-per-call', 10),
    marketType,
    interval,
    fidelity: numberFlag(argv, '--fidelity', 60),
    batchSize: numberFlag(argv, '--batch-size', 100),
    throttleMs: numberFlag(argv, '--throttle-ms', 1000),
    maxCalls: numberFlag(argv, '--max-calls', Number.POSITIVE_INFINITY),
    checkpoint: parseFlag(argv, '--checkpoint') ?? defaultCheckpoint,
    startTs,
    endTs,
  };
}
