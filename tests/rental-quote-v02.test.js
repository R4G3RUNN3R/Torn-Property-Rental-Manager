'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ApiCore = require('../src/api-core');
const MarketCore = require('../src/market-core');

function okJson(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

test('reads listings from current MarketRentalsResponse rentals.listings shape', async () => {
  const client = ApiCore.createClient({
    apiKey: 'k',
    scheduler: { run: fn => fn() },
    storage: memoryStorage(),
    fetchImpl: async () => okJson({
      rentals: {
        property: { id: 13, name: 'Private Island' },
        listings: [
          {
            happy: 5025,
            cost: 100_000,
            cost_per_day: 3333,
            rental_period: 30,
            market_price: 500_000_000,
            upkeep: 500_000,
            modifications: ['Hot Tub', 'Sauna']
          }
        ]
      },
      rentals_timestamp: 123,
      rentals_delay: 900,
      _metadata: { links: { next: null }, total: 1 }
    })
  });

  const market = await client.fetchRentalMarket(13, { force: true });
  assert.equal(market.rentals.length, 1);
  assert.equal(market.rentals[0].cost, 100_000);
  assert.equal(market.property.id, 13);
});

test('exact modification matching is order independent and rejects different upgrades', () => {
  assert.equal(
    MarketCore.exactModificationMatch(['Hot Tub', 'Sauna'], ['Sauna', 'Hot Tub']),
    true
  );
  assert.equal(
    MarketCore.exactModificationMatch(['Hot Tub', 'Sauna'], ['Hot Tub']),
    false
  );
  assert.equal(
    MarketCore.exactModificationMatch([], []),
    true
  );
});

test('normalizes every exact-match listing to 100 days and proposes average minus 0.5 percent', () => {
  const owned = {
    happy: 5025,
    modifications: ['Hot Tub', 'Sauna']
  };
  const listings = [
    {
      happy: 5025,
      modifications: ['Sauna', 'Hot Tub'],
      cost: 100_000,
      rental_period: 30,
      cost_per_day: 3333
    },
    {
      happy: 5025,
      modifications: ['Hot Tub', 'Sauna'],
      cost: 200_000,
      rental_period: 100,
      cost_per_day: 2000
    },
    {
      happy: 6000,
      modifications: ['Hot Tub', 'Sauna', 'Open Bar'],
      cost: 900_000,
      rental_period: 100,
      cost_per_day: 9000
    }
  ];

  const quote = MarketCore.rentalQuote(owned, listings, {
    targetDays: 100,
    undercutPercent: 0.5
  });

  assert.equal(quote.exactMatchCount, 2);
  assert.equal(quote.targetDays, 100);
  assert.equal(quote.lowestTotal, 200_000);
  assert.equal(quote.highestTotal, 333_333);
  assert.equal(quote.averageTotal, 266_666);
  assert.equal(quote.proposedTotal, 265_333);
});

test('rental quote uses all exact matches regardless of their original duration', () => {
  const owned = { modifications: [] };
  const listings = [
    { modifications: [], cost: 30_000, rental_period: 30, cost_per_day: 1000 },
    { modifications: [], cost: 60_000, rental_period: 60, cost_per_day: 1000 },
    { modifications: [], cost: 100_000, rental_period: 100, cost_per_day: 1000 }
  ];

  const quote = MarketCore.rentalQuote(owned, listings, {});
  assert.equal(quote.exactMatchCount, 3);
  assert.equal(quote.lowestTotal, 100_000);
  assert.equal(quote.highestTotal, 100_000);
  assert.equal(quote.averageTotal, 100_000);
  assert.equal(quote.proposedTotal, 99_500);
});

test('rental quote refuses to invent a price when there are no exact upgrade matches', () => {
  const quote = MarketCore.rentalQuote(
    { modifications: ['Hot Tub'] },
    [{ modifications: ['Sauna'], cost: 100_000, rental_period: 30, cost_per_day: 3333 }],
    {}
  );

  assert.equal(quote.exactMatchCount, 0);
  assert.equal(quote.lowestTotal, null);
  assert.equal(quote.highestTotal, null);
  assert.equal(quote.averageTotal, null);
  assert.equal(quote.proposedTotal, null);
});
