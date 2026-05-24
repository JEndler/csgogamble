import { describe, expect, it } from 'vitest';
import {
  nameSimilarity,
  normalizeEvent,
  normalizeMarket,
  normalizeName,
  normalizeOutcomes,
  parseJsonStringArray,
  parseMarketTitle,
} from '../src/polymarket/normalize';

describe('parseJsonStringArray', () => {
  it('parses JSON-encoded strings', () => {
    expect(parseJsonStringArray('["a", "b"]')).toEqual(['a', 'b']);
  });

  it('passes through native arrays', () => {
    expect(parseJsonStringArray(['a', 'b'])).toEqual(['a', 'b']);
  });

  it('returns empty array for malformed input', () => {
    expect(parseJsonStringArray('not json')).toEqual([]);
    expect(parseJsonStringArray(null)).toEqual([]);
  });
});

describe('normalizeOutcomes', () => {
  it('zips outcomes/prices/tokenIds from JSON-string fields', () => {
    const outcomes = normalizeOutcomes({
      outcomes: '["Yes","No"]',
      outcomePrices: '["0.55","0.45"]',
      clobTokenIds: '["tok-y","tok-n"]',
    });
    expect(outcomes).toEqual([
      { index: 0, label: 'Yes', tokenId: 'tok-y', lastPrice: 0.55 },
      { index: 1, label: 'No', tokenId: 'tok-n', lastPrice: 0.45 },
    ]);
  });

  it('tolerates missing arrays and short tail prices', () => {
    const outcomes = normalizeOutcomes({ outcomes: '["A","B","C"]' });
    expect(outcomes).toHaveLength(3);
    expect(outcomes[2]?.tokenId).toBeNull();
  });
});

describe('normalizeEvent/normalizeMarket', () => {
  it('drops events without a slug', () => {
    expect(normalizeEvent({})).toBeNull();
  });

  it('keeps numeric ids as strings', () => {
    const event = normalizeEvent({ id: 42, slug: 'an-event', title: 'An Event' });
    expect(event?.polymarketEventId).toBe('42');
  });

  it('drops markets without a condition_id', () => {
    expect(normalizeMarket({ slug: 'a' })).toBeNull();
  });
});

describe('normalizeName / nameSimilarity', () => {
  it('normalizes punctuation and case', () => {
    expect(normalizeName('Team Liquid!')).toBe('team liquid');
  });

  it('matches identical names with similarity 1.0', () => {
    expect(nameSimilarity('Liquid', 'Liquid')).toBe(1);
  });

  it('partial token overlap returns fractional similarity', () => {
    const score = nameSimilarity('Team Liquid', 'Liquid');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe('parseMarketTitle', () => {
  it('splits a head-to-head title into team1/team2', () => {
    const parsed = parseMarketTitle('Liquid vs Falcons - Map 1', null);
    expect(parsed.team1Name).toBe('Liquid');
    expect(parsed.team2Name).toBe('Falcons - Map 1');
  });

  it('detects map names case-insensitively', () => {
    const parsed = parseMarketTitle('Mirage winner', null);
    expect(parsed.mapName).toBe('Mirage');
  });

  it('extracts a numeric total', () => {
    const parsed = parseMarketTitle('Over 2.5 maps', null);
    expect(parsed.totalValue).toBe(2.5);
  });
});
