import { classifyMarket } from '../src/polymarket/classifier';
import type { NormalizedMarket, NormalizedOutcome } from '../src/polymarket/types';
import { executeD1, queryD1, sqlString, toNullableString, toNumber } from './ops-utils';

interface Options {
  apply: boolean;
  marketType: string;
  limit: number;
}

interface MarketRow {
  id: number;
  conditionId: string;
  question: string | null;
  description: string | null;
  existingMarketType: string;
  existingTeam1Name: string | null;
  existingTeam2Name: string | null;
  outcomeLabels: string[];
}

interface UpdateRow {
  id: number;
  conditionId: string;
  before: {
    marketType: string;
    team1Name: string | null;
    team2Name: string | null;
  };
  after: {
    marketType: string;
    team1Name: string | null;
    team2Name: string | null;
  };
  sql: string;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const valueFor = (name: string): string | null => {
    const inline = args.find((arg) => arg.startsWith(`${name}=`));
    if (inline) return inline.slice(name.length + 1);
    const index = args.indexOf(name);
    return index >= 0 ? (args[index + 1] ?? null) : null;
  };
  const limitRaw = valueFor('--limit') ?? '5000';
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`--limit must be a positive integer, got ${limitRaw}`);
  }
  return {
    apply: args.includes('--apply'),
    marketType: valueFor('--market-type') ?? 'match_winner',
    limit: Math.min(limit, 20_000),
  };
}

function outcomeLabelsFromPacked(value: string | null): string[] {
  if (!value) return [];
  return value
    .split('\u001f')
    .map((label) => label.trim())
    .filter(Boolean);
}

function placeholderOutcomes(labels: string[]): NormalizedOutcome[] {
  return labels.map((label, index) => ({ index, label, tokenId: null, lastPrice: null }));
}

function marketFromRow(row: MarketRow): NormalizedMarket {
  return {
    conditionId: row.conditionId,
    questionId: null,
    slug: null,
    question: row.question,
    description: row.description,
    closed: null,
    archived: null,
    active: null,
    acceptingOrders: null,
    endDate: null,
    startDate: null,
    resolutionSource: null,
    outcomes: placeholderOutcomes(row.outcomeLabels),
  };
}

function updateSql(row: MarketRow): UpdateRow | null {
  const classification = classifyMarket(marketFromRow(row));
  const after = {
    marketType: classification.marketType,
    team1Name: classification.parsed.team1Name,
    team2Name: classification.parsed.team2Name,
  };
  const before = {
    marketType: row.existingMarketType,
    team1Name: row.existingTeam1Name,
    team2Name: row.existingTeam2Name,
  };
  if (
    before.marketType === after.marketType &&
    before.team1Name === after.team1Name &&
    before.team2Name === after.team2Name
  ) {
    return null;
  }

  const sql = `UPDATE polymarket_markets
    SET market_type = ${sqlString(classification.marketType)},
        classifier_version = ${sqlString(classification.classifierVersion)},
        classifier_signals = ${sqlString(JSON.stringify(classification.signals))},
        parsed_team1_name = ${classification.parsed.team1Name === null ? 'NULL' : sqlString(classification.parsed.team1Name)},
        parsed_team2_name = ${classification.parsed.team2Name === null ? 'NULL' : sqlString(classification.parsed.team2Name)},
        parsed_map_name = ${classification.parsed.mapName === null ? 'NULL' : sqlString(classification.parsed.mapName)},
        parsed_total_value = ${classification.parsed.totalValue === null ? 'NULL' : classification.parsed.totalValue},
        parsed_handicap_value = ${classification.parsed.handicapValue === null ? 'NULL' : classification.parsed.handicapValue}
    WHERE id = ${row.id};`;

  return { id: row.id, conditionId: row.conditionId, before, after, sql };
}

async function main(): Promise<void> {
  const options = parseArgs();
  const marketTypeWhere = options.marketType === 'all' ? '1=1' : `m.market_type = ${sqlString(options.marketType)}`;
  const rows = await queryD1(
    `SELECT m.id,
            m.condition_id,
            m.question,
            m.description,
            m.market_type,
            m.parsed_team1_name,
            m.parsed_team2_name,
            GROUP_CONCAT(COALESCE(o.label, ''), char(31)) AS outcome_labels
       FROM polymarket_markets m
       LEFT JOIN polymarket_outcomes o ON o.market_id = m.id
      WHERE ${marketTypeWhere}
      GROUP BY m.id
      ORDER BY m.id
      LIMIT ${options.limit};`,
    (raw): MarketRow => ({
      id: toNumber(raw.id),
      conditionId: String(raw.condition_id),
      question: toNullableString(raw.question),
      description: toNullableString(raw.description),
      existingMarketType: String(raw.market_type),
      existingTeam1Name: toNullableString(raw.parsed_team1_name),
      existingTeam2Name: toNullableString(raw.parsed_team2_name),
      outcomeLabels: outcomeLabelsFromPacked(toNullableString(raw.outcome_labels)),
    }),
  );

  const updates = rows.map(updateSql).filter((row): row is UpdateRow => row !== null);
  console.log(
    JSON.stringify(
      {
        apply: options.apply,
        marketType: options.marketType,
        scanned: rows.length,
        updates: updates.length,
        samples: updates.slice(0, 10).map(({ id, conditionId, before, after }) => ({ id, conditionId, before, after })),
      },
      null,
      2,
    ),
  );

  if (!options.apply || updates.length === 0) return;

  const batchSize = 50;
  for (let index = 0; index < updates.length; index += batchSize) {
    const batch = updates.slice(index, index + batchSize);
    // Sequential D1 batches avoid oversized Cloudflare API requests and make progress logs honest.
    // biome-ignore lint/performance/noAwaitInLoops: intentional operational pacing for remote D1 mutation batches.
    await executeD1(batch.map((update) => update.sql).join('\n'));
    console.error(`applied ${Math.min(index + batch.length, updates.length)}/${updates.length}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
