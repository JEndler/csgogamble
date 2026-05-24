/**
 * Polymarket H1/H2 typed surface.
 *
 * The Gamma REST API returns JSON shapes that vary across endpoints and over
 * time. Several "list" fields (outcomes / outcomePrices / clobTokenIds) are
 * delivered as JSON-encoded strings, not arrays. We model the raw payloads as
 * loose `unknown`-based shapes and only commit to concrete types after
 * normalization in `normalize.ts`.
 */

import type { POLYMARKET_CLASSIFIER_VERSION } from './constants';

export const MARKET_TYPES = [
  'match_winner',
  'map_winner',
  'total_maps',
  'map_handicap',
  'outright',
  'player_prop',
  'other',
  'unknown',
] as const;

export type MarketType = (typeof MARKET_TYPES)[number];

/** Raw Gamma event payload — fields used by H1. Anything we do not consume is left untyped. */
export interface RawGammaEvent {
  id?: string | number;
  slug?: string;
  title?: string;
  category?: string;
  startDate?: string;
  endDate?: string;
  closed?: boolean;
  archived?: boolean;
  active?: boolean;
  volume?: number | string;
  liquidity?: number | string;
  markets?: RawGammaMarket[];
}

export interface RawGammaMarket {
  id?: string | number;
  conditionId?: string;
  questionId?: string;
  slug?: string;
  question?: string;
  description?: string;
  closed?: boolean;
  archived?: boolean;
  active?: boolean;
  acceptingOrders?: boolean;
  endDate?: string;
  startDate?: string;
  resolutionSource?: string;
  /** JSON-stringified array of human-readable outcome labels. */
  outcomes?: string | string[];
  /** JSON-stringified array of last-trade prices aligned with `outcomes`. */
  outcomePrices?: string | string[];
  /** JSON-stringified array of CLOB token ids aligned with `outcomes`. */
  clobTokenIds?: string | string[];
}

export interface RawGammaEventsResponse {
  /** Gamma /events/keyset shape. */
  events?: RawGammaEvent[];
  /** Older /events shape; accepted for tests/replay compatibility. */
  data?: RawGammaEvent[];
  next_cursor?: string;
}

/** Normalized Gamma event shape after parsing JSON-string fields. */
export interface NormalizedEvent {
  polymarketEventId: string | null;
  slug: string;
  title: string | null;
  category: string | null;
  startDate: string | null;
  endDate: string | null;
  closed: boolean | null;
  archived: boolean | null;
  active: boolean | null;
  volume: number | null;
  liquidity: number | null;
}

/** Normalized Gamma market shape, with outcomes exploded into typed records. */
export interface NormalizedMarket {
  conditionId: string;
  questionId: string | null;
  slug: string | null;
  question: string | null;
  description: string | null;
  closed: boolean | null;
  archived: boolean | null;
  active: boolean | null;
  acceptingOrders: boolean | null;
  endDate: string | null;
  startDate: string | null;
  resolutionSource: string | null;
  outcomes: NormalizedOutcome[];
}

export interface NormalizedOutcome {
  index: number;
  label: string | null;
  tokenId: string | null;
  lastPrice: number | null;
}

/** Classifier output for a single market. */
export interface MarketClassification {
  marketType: MarketType;
  classifierVersion: typeof POLYMARKET_CLASSIFIER_VERSION;
  signals: ClassifierSignals;
  parsed: ParsedMarketTitleFields;
}

export interface ClassifierSignals {
  hasVsKeyword: boolean;
  hasMapKeyword: boolean;
  hasMapName: boolean;
  hasTotalKeyword: boolean;
  hasHandicapKeyword: boolean;
  hasPlayerPropKeyword: boolean;
  hasOutrightKeyword: boolean;
  outcomeCount: number;
  notes: string[];
}

/** Loose fields parsed out of a market question/title for downstream linking. */
export interface ParsedMarketTitleFields {
  team1Name: string | null;
  team2Name: string | null;
  mapName: string | null;
  totalValue: number | null;
  handicapValue: number | null;
}

/** Raw CLOB prices-history response shape (public API). */
export interface RawClobPriceHistoryResponse {
  history?: Array<{ t: number; p: number | string }>;
}

/** A normalized price-history sample (one JSONL line in R2). */
export interface NormalizedPricePoint {
  /** Unix seconds (Polymarket samples at minute fidelity at best). */
  t: number;
  /** Last sampled implied probability in [0, 1]. NOT executable bid/ask. */
  p: number;
}
