import { POLYMARKET_CLASSIFIER_VERSION } from './constants';
import { parseMarketTitle } from './normalize';
import type { ClassifierSignals, MarketClassification, MarketType, NormalizedMarket } from './types';

const TOTAL_KEYWORDS = ['total maps', 'over/under', 'total rounds', 'over ', 'under '];
const HANDICAP_KEYWORDS = ['handicap', '+1.5', '-1.5', '+0.5', '-0.5', 'map handicap'];
const MAP_KEYWORDS = ['map 1', 'map 2', 'map 3', 'map 4', 'map 5', 'map winner'];
const PLAYER_PROP_KEYWORDS = ['most kills', 'first kill', 'mvp', 'highest rating', 'most headshots', 'top fragger'];
const OUTRIGHT_KEYWORDS = [
  'win the',
  'champion',
  'winner of',
  'tournament winner',
  'group stage',
  'reach the',
  'qualify',
];
const VS_REGEX = /\b(?:vs\.?|versus|v\.)\b/i;
const MAP_NAMES = ['mirage', 'inferno', 'nuke', 'overpass', 'ancient', 'anubis', 'vertigo', 'train', 'dust2'];

function detectSignals(market: NormalizedMarket): ClassifierSignals {
  const text = `${market.question ?? ''} ${market.description ?? ''}`.toLowerCase();
  const hasMapName = MAP_NAMES.some((map) => text.includes(map));
  return {
    hasVsKeyword: VS_REGEX.test(text),
    hasMapKeyword: MAP_KEYWORDS.some((keyword) => text.includes(keyword)),
    hasMapName,
    hasTotalKeyword: TOTAL_KEYWORDS.some((keyword) => text.includes(keyword)),
    hasHandicapKeyword: HANDICAP_KEYWORDS.some((keyword) => text.includes(keyword)),
    hasPlayerPropKeyword: PLAYER_PROP_KEYWORDS.some((keyword) => text.includes(keyword)),
    hasOutrightKeyword: OUTRIGHT_KEYWORDS.some((keyword) => text.includes(keyword)),
    outcomeCount: market.outcomes.length,
    notes: [],
  };
}

function decideType(signals: ClassifierSignals): MarketType {
  if (signals.hasPlayerPropKeyword) return 'player_prop';
  if (signals.hasHandicapKeyword) return 'map_handicap';
  if (signals.hasTotalKeyword) return 'total_maps';
  if (signals.hasMapKeyword && signals.hasVsKeyword) return 'map_winner';
  if (signals.hasOutrightKeyword && !signals.hasVsKeyword) return 'outright';
  if (signals.hasVsKeyword && signals.outcomeCount === 2 && !signals.hasMapName) return 'match_winner';
  if (signals.hasVsKeyword && signals.outcomeCount === 2 && signals.hasMapName) return 'map_winner';
  if (signals.outcomeCount > 0) return 'other';
  return 'unknown';
}

/**
 * Deterministically classify a normalized Polymarket market into our market
 * type taxonomy. The output is intentionally conservative: when in doubt the
 * classifier returns `other` (recognized but not understood) or `unknown`
 * (no useful signal), never a false positive into a confident bucket.
 */
export function classifyMarket(market: NormalizedMarket): MarketClassification {
  const signals = detectSignals(market);
  const marketType = decideType(signals);
  const parsed = parseMarketTitle(market.question, market.description);
  if (marketType === 'unknown' && (market.question?.length ?? 0) === 0) {
    signals.notes.push('empty-question');
  }
  return {
    marketType,
    classifierVersion: POLYMARKET_CLASSIFIER_VERSION,
    signals,
    parsed,
  };
}
