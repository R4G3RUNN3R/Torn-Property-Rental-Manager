'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MarketCore = require('../src/market-core');

test('calculates happy and modification similarity', () => {
  assert.equal(MarketCore.happySimilarity(4500, 4500), 1);
  assert.equal(MarketCore.happySimilarity(4500, 4050), 0.9);
  assert.equal(MarketCore.happySimilarity(0, 0), 1);
  assert.equal(MarketCore.modificationSimilarity(['A', 'B'], ['B', 'C']), 1 / 3);
  assert.equal(MarketCore.modificationSimilarity([], []), 1);
});

test('combines happy and modification similarity using 70/30 weighting', () => {
  const score = MarketCore.similarity(
    { happy: 4500, modifications: ['A', 'B'] },
    { happy: 4050, modifications: ['B', 'C'] }
  );
  assert.ok(Math.abs(score - (0.9 * 0.7 + (1 / 3) * 0.3)) < 1e-12);
});

test('widens comparable threshold when exact-like sample is too small', () => {
  const owned = { happy: 4500, modifications: [] };
  const listings = [
    { id: 1, happy: 4500, modifications: [], cost_per_day: 100 },
    { id: 2, happy: 4490, modifications: [], cost_per_day: 101 },
    { id: 3, happy: 4000, modifications: [], cost_per_day: 102 },
    { id: 4, happy: 3950, modifications: [], cost_per_day: 103 },
    { id: 5, happy: 3900, modifications: [], cost_per_day: 104 }
  ];

  const selected = MarketCore.selectComparables(owned, listings);
  assert.equal(selected.length, 5);
  assert.deepEqual(selected.map(row => row.id), [1, 2, 3, 4, 5]);
});

test('uses top ten listings when threshold samples remain too small', () => {
  const owned = { happy: 10000, modifications: ['A'] };
  const listings = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    happy: 1000 + i,
    modifications: [],
    cost_per_day: 1000 + i
  }));

  const selected = MarketCore.selectComparables(owned, listings);
  assert.equal(selected.length, 10);
  assert.ok(selected[0]._similarity >= selected[9]._similarity);
});

test('removes extreme outliers and applies undercut with median floor', () => {
  const owned = { happy: 4500, modifications: [] };
  const listings = [100, 101, 102, 103, 104, 105, 106, 1000].map((price, i) => ({
    id: i + 1,
    happy: 4500,
    modifications: [],
    cost_per_day: price
  }));

  const stats = MarketCore.marketStats(owned, listings, {
    undercutPercent: 0.5,
    minimumMedianRatio: 0.70
  });

  assert.equal(stats.marketFloor, 100);
  assert.equal(stats.median, 103);
  assert.equal(stats.suggestedDaily, 99);
  assert.equal(stats.sampleSize, 7);
  assert.equal(stats.confidence, 'Medium');
});

test('median safety floor prevents pathological underpricing', () => {
  const owned = { happy: 4500, modifications: [] };
  // Two low listings keep the floor inside the Tukey fence while the market median stays high.
  const listings = [10, 10, 101, 102, 103, 104, 105].map((price, i) => ({
    id: i + 1,
    happy: 4500,
    modifications: [],
    cost_per_day: price
  }));

  const stats = MarketCore.marketStats(owned, listings, {
    undercutPercent: 0.5,
    minimumMedianRatio: 0.70
  });

  assert.equal(stats.marketFloor, 10);
  assert.equal(stats.median, 102);
  assert.equal(stats.suggestedDaily, 71);
});

test('returns no-data result when no positive daily prices exist', () => {
  const stats = MarketCore.marketStats(
    { happy: 4500, modifications: [] },
    [{ id: 1, happy: 4500, modifications: [], cost_per_day: 0 }],
    {}
  );

  assert.equal(stats.marketFloor, null);
  assert.equal(stats.suggestedDaily, null);
  assert.equal(stats.sampleSize, 0);
  assert.equal(stats.confidence, 'Low');
});
