'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const MarketCore = require('../src/market-core');

const owned = { modifications: [] };
const listings = [
  { id: 1, modifications: [], cost: 90_000, rental_period: 30, cost_per_day: 3_000 },
  { id: 2, modifications: [], cost: 210_000, rental_period: 60, cost_per_day: 3_500 },
  { id: 3, modifications: [], cost: 400_000, rental_period: 100, cost_per_day: 4_000 },
  { id: 4, modifications: ['Hot Tub'], cost: 900_000, rental_period: 100, cost_per_day: 9_000 }
];

test('rentalQuote exposes normalized lowest median average and highest totals', () => {
  const quote = MarketCore.rentalQuote(owned, listings, { targetDays: 100, undercutPercent: 0.5 });
  assert.equal(quote.lowestTotal, 300_000);
  assert.equal(quote.medianTotal, 350_000);
  assert.equal(quote.averageTotal, 350_000);
  assert.equal(quote.highestTotal, 400_000);
});

test('rentalQuote supports lowest median average and highest pricing bases', () => {
  const expected = {
    lowest: [300_000, 298_500],
    median: [350_000, 348_250],
    average: [350_000, 348_250],
    highest: [400_000, 398_000]
  };

  for (const [pricingBasis, [base, proposed]] of Object.entries(expected)) {
    const quote = MarketCore.rentalQuote(owned, listings, {
      targetDays: 100,
      undercutPercent: 0.5,
      pricingBasis
    });
    assert.equal(quote.pricingBasis, pricingBasis);
    assert.equal(quote.pricingBaseTotal, base);
    assert.equal(quote.proposedTotal, proposed);
  }
});

test('zero undercut uses the selected pricing basis exactly', () => {
  const quote = MarketCore.rentalQuote(owned, listings, {
    targetDays: 100,
    undercutPercent: 0,
    pricingBasis: 'highest'
  });
  assert.equal(quote.proposedTotal, 400_000);
});

test('unknown pricing basis safely falls back to average', () => {
  const quote = MarketCore.rentalQuote(owned, listings, {
    targetDays: 100,
    undercutPercent: 1,
    pricingBasis: 'moon-price'
  });
  assert.equal(quote.pricingBasis, 'average');
  assert.equal(quote.pricingBaseTotal, 350_000);
  assert.equal(quote.proposedTotal, 346_500);
});
