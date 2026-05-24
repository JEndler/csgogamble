import type {
  NormalizedEvent,
  NormalizedMarket,
  NormalizedOutcome,
  ParsedMarketTitleFields,
  RawGammaEvent,
  RawGammaMarket,
} from './types';

/**
 * Defensive JSON-string parse for Gamma list fields. Gamma encodes
 * `outcomes`, `outcomePrices`, and `clobTokenIds` as JSON strings, but some
 * historical responses ship them as native arrays or null. This helper
 * accepts all of those and returns `[]` for anything it cannot interpret.
 */
export function parseJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => (entry === null || entry === undefined ? '' : String(entry)));
  }
  if (typeof value !== 'string' || value.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => (entry === null || entry === undefined ? '' : String(entry)));
    }
  } catch {
    // Fall through to return [].
  }
  return [];
}

function toBoolOrNull(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const lowered = value.toLowerCase();
    if (lowered === 'true') return true;
    if (lowered === 'false') return false;
  }
  return null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number') return String(value);
  return null;
}

export function normalizeEvent(raw: RawGammaEvent): NormalizedEvent | null {
  const slug = toStringOrNull(raw.slug);
  if (!slug) return null;
  return {
    polymarketEventId: toStringOrNull(raw.id),
    slug,
    title: toStringOrNull(raw.title),
    category: toStringOrNull(raw.category),
    startDate: toStringOrNull(raw.startDate),
    endDate: toStringOrNull(raw.endDate),
    closed: toBoolOrNull(raw.closed),
    archived: toBoolOrNull(raw.archived),
    active: toBoolOrNull(raw.active),
    volume: toNumberOrNull(raw.volume),
    liquidity: toNumberOrNull(raw.liquidity),
  };
}

export function normalizeOutcomes(raw: RawGammaMarket): NormalizedOutcome[] {
  const labels = parseJsonStringArray(raw.outcomes);
  const prices = parseJsonStringArray(raw.outcomePrices);
  const tokenIds = parseJsonStringArray(raw.clobTokenIds);

  const count = Math.max(labels.length, prices.length, tokenIds.length);
  const outcomes: NormalizedOutcome[] = [];
  for (let index = 0; index < count; index += 1) {
    const label = labels[index] ?? null;
    const tokenId = tokenIds[index] ?? null;
    const priceRaw = prices[index];
    const price = priceRaw !== undefined ? toNumberOrNull(priceRaw) : null;
    outcomes.push({
      index,
      label: label && label.length > 0 ? label : null,
      tokenId: tokenId && tokenId.length > 0 ? tokenId : null,
      lastPrice: price,
    });
  }
  return outcomes;
}

export function normalizeMarket(raw: RawGammaMarket): NormalizedMarket | null {
  const conditionId = toStringOrNull(raw.conditionId);
  if (!conditionId) return null;
  return {
    conditionId,
    questionId: toStringOrNull(raw.questionId),
    slug: toStringOrNull(raw.slug),
    question: toStringOrNull(raw.question),
    description: toStringOrNull(raw.description),
    closed: toBoolOrNull(raw.closed),
    archived: toBoolOrNull(raw.archived),
    active: toBoolOrNull(raw.active),
    acceptingOrders: toBoolOrNull(raw.acceptingOrders),
    endDate: toStringOrNull(raw.endDate),
    startDate: toStringOrNull(raw.startDate),
    resolutionSource: toStringOrNull(raw.resolutionSource),
    outcomes: normalizeOutcomes(raw),
  };
}

/** Lowercase + collapse whitespace + strip punctuation for similarity-friendly comparison. */
export function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-set Jaccard similarity over normalized names; 1.0 means equal token sets. */
export function nameSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalizeName(left).split(' ').filter(Boolean));
  const rightTokens = new Set(normalizeName(right).split(' ').filter(Boolean));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = leftTokens.size + rightTokens.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const MAP_NAME_PATTERNS = [
  'mirage',
  'inferno',
  'nuke',
  'overpass',
  'ancient',
  'anubis',
  'vertigo',
  'train',
  'dust2',
  'dust 2',
];

function detectMapName(text: string): string | null {
  const lowered = text.toLowerCase();
  for (const map of MAP_NAME_PATTERNS) {
    if (lowered.includes(map)) {
      return map === 'dust 2' ? 'Dust2' : map.charAt(0).toUpperCase() + map.slice(1);
    }
  }
  return null;
}

const VS_SPLIT_REGEX = /\s+(?:vs\.?|v\.?|versus)\s+/i;

function splitTeamsFromTitle(title: string): { team1: string; team2: string } | null {
  const trimmed = title.replace(/\?+$/g, '').trim();
  const match = trimmed.split(VS_SPLIT_REGEX);
  if (match.length !== 2) return null;
  const team1 = match[0]?.trim();
  const team2 = match[1]?.trim();
  if (!team1 || !team2) return null;
  return { team1, team2 };
}

const WILL_X_BEAT_Y_REGEX = /will\s+(.+?)\s+beat\s+(.+?)[?.!]?$/i;

/**
 * Parse loose fields out of a market title. The intent is best-effort
 * extraction: callers must tolerate any field being null.
 */
export function parseMarketTitle(question: string | null, description: string | null): ParsedMarketTitleFields {
  const fields: ParsedMarketTitleFields = {
    team1Name: null,
    team2Name: null,
    mapName: null,
    totalValue: null,
    handicapValue: null,
  };
  const text = `${question ?? ''} ${description ?? ''}`.trim();
  if (text.length === 0) return fields;

  const split = question ? splitTeamsFromTitle(question) : null;
  if (split) {
    fields.team1Name = split.team1;
    fields.team2Name = split.team2;
  } else if (question) {
    const will = question.match(WILL_X_BEAT_Y_REGEX);
    if (will) {
      fields.team1Name = will[1]?.trim() ?? null;
      fields.team2Name = will[2]?.trim() ?? null;
    }
  }

  fields.mapName = detectMapName(text);

  const totalMatch = text.match(/(?:over|under|total)[^0-9]*([0-9]+(?:\.[0-9]+)?)/i);
  if (totalMatch?.[1]) {
    const value = Number(totalMatch[1]);
    if (Number.isFinite(value)) fields.totalValue = value;
  }

  if (/handicap/i.test(text)) {
    const handicapMatch = text.match(/[+-]?\s*[0-9]+(?:\.[0-9]+)?/);
    if (handicapMatch?.[0]) {
      const value = Number(handicapMatch[0].replace(/\s+/g, ''));
      if (Number.isFinite(value)) fields.handicapValue = value;
    }
  }

  return fields;
}
