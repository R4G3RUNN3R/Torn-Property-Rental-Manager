'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const MarketCore = require('../src/market-core');
const App = require('../src/app-v033');
const PropertyCore = require('../src/property-core');

const owned = { modifications: [] };

function listing(id, total, days = 100) {
  return {
    id,
    modifications: [],
    cost: total,
    rental_period: days,
    cost_per_day: total / days
  };
}

test('rentalQuote excludes absurd low and high exact-match prices before calculating market figures', () => {
  const quote = MarketCore.rentalQuote(owned, [
    listing(1, 1),
    listing(2, 48_000_000),
    listing(3, 50_000_000),
    listing(4, 52_000_000),
    listing(5, 1_000_000_000)
  ], { targetDays: 100, pricingBasis: 'lowest', undercutPercent: 0 });

  assert.equal(quote.exactMatchCount, 5);
  assert.equal(quote.usedMatchCount, 3);
  assert.equal(quote.outlierCount, 2);
  assert.equal(quote.sampleStatus, 'ok');
  assert.equal(quote.lowestTotal, 48_000_000);
  assert.equal(quote.medianTotal, 50_000_000);
  assert.equal(quote.averageTotal, 50_000_000);
  assert.equal(quote.highestTotal, 52_000_000);
  assert.equal(quote.proposedTotal, 48_000_000);
});

test('rentalQuote applies outlier protection after normalizing mixed rental durations to 100 days', () => {
  const quote = MarketCore.rentalQuote(owned, [
    listing(1, 300, 30),
    listing(2, 14_400_000, 30),
    listing(3, 30_000_000, 60),
    listing(4, 52_000_000, 100),
    listing(5, 300_000_000, 30)
  ], { targetDays: 100, pricingBasis: 'average', undercutPercent: 0 });

  assert.equal(quote.exactMatchCount, 5);
  assert.equal(quote.usedMatchCount, 3);
  assert.equal(quote.outlierCount, 2);
  assert.equal(quote.lowestTotal, 48_000_000);
  assert.equal(quote.medianTotal, 50_000_000);
  assert.equal(quote.averageTotal, 50_000_000);
  assert.equal(quote.highestTotal, 52_000_000);
});

test('two exact matches more than five times apart fail closed instead of proposing a price', () => {
  const quote = MarketCore.rentalQuote(owned, [
    listing(1, 1_000_000),
    listing(2, 10_000_000)
  ], { targetDays: 100, pricingBasis: 'lowest', undercutPercent: 0.5 });

  assert.equal(quote.exactMatchCount, 2);
  assert.equal(quote.usedMatchCount, 0);
  assert.equal(quote.outlierCount, 0);
  assert.equal(quote.sampleStatus, 'price_data_too_inconsistent');
  assert.equal(quote.lowestTotal, null);
  assert.equal(quote.medianTotal, null);
  assert.equal(quote.averageTotal, null);
  assert.equal(quote.highestTotal, null);
  assert.equal(quote.proposedTotal, null);
});

test('two exact matches within the five-times guard remain usable', () => {
  const quote = MarketCore.rentalQuote(owned, [
    listing(1, 40_000_000),
    listing(2, 60_000_000)
  ], { targetDays: 100, pricingBasis: 'average', undercutPercent: 0 });

  assert.equal(quote.sampleStatus, 'ok');
  assert.equal(quote.usedMatchCount, 2);
  assert.equal(quote.outlierCount, 0);
  assert.equal(quote.averageTotal, 50_000_000);
  assert.equal(quote.proposedTotal, 50_000_000);
});

test('a single exact match is reported as insufficient and never produces an automatic price', () => {
  const quote = MarketCore.rentalQuote(owned, [listing(1, 50_000_000)], {
    targetDays: 100,
    pricingBasis: 'average',
    undercutPercent: 0.5
  });

  assert.equal(quote.exactMatchCount, 1);
  assert.equal(quote.usedMatchCount, 0);
  assert.equal(quote.outlierCount, 0);
  assert.equal(quote.sampleStatus, 'insufficient_market_sample');
  assert.equal(quote.proposedTotal, null);
});

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

test('property card tells the user how many exact matches were used and ignored', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
  Object.defineProperty(dom.window, 'innerWidth', { value: 1024, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 768, configurable: true });

  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage: memoryStorage(),
    apiClient: {
      async fetchOwnedProperties() {
        return [{ id: 101, property: { id: 13, name: 'Private Island' }, owner: { id: 1 }, happy: 4500, status: 'none', modifications: [] }];
      },
      async scanMarkets() {
        return {
          13: {
            rentals: [
              listing(1, 1),
              listing(2, 48_000_000),
              listing(3, 50_000_000),
              listing(4, 52_000_000),
              listing(5, 1_000_000_000)
            ],
            fromCache: false
          }
        };
      }
    },
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: { save(d) { return d; }, loadFor() { return null; }, clear() {} },
    navigate() {},
    canListProperty() { return false; },
    listProperty() { return { submitted: false }; }
  });

  await controller.load();
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  const row = dom.window.document.querySelector('[data-property-id="101"]');
  const sample = row.querySelector('[data-role="v036-market-sample"]');
  assert.ok(sample);
  assert.match(sample.textContent, /Exact matches:\s*5/i);
  assert.match(sample.textContent, /Used:\s*3/i);
  assert.match(sample.textContent, /Outliers ignored:\s*2/i);
  assert.match(row.textContent, /Lowest 100-day:\s*\$48,000,000/i);
});
