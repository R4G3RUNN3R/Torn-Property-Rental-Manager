'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const ApiCore = require('../src/api-core');
const App = require('../src/app');
const PropertyCore = require('../src/property-core');
const MarketCore = require('../src/market-core');

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

function response(body) {
  return { ok: true, status: 200, async json() { return body; } };
}

function rentalRows(count, offset) {
  return Array.from({ length: count }, (_, index) => ({
    happy: 100,
    cost: 100000 + offset + index,
    cost_per_day: 1000 + offset + index,
    rental_period: 100,
    market_price: 100000,
    upkeep: 0,
    modifications: []
  }));
}

test('rental market uses metadata total plus offsets and reports page progress instead of sitting at 35 percent', async () => {
  const urls = [];
  const progress = [];
  const client = ApiCore.createClient({
    apiKey: 'test-key',
    storage: memoryStorage(),
    scheduler: { run(task) { return task(); } },
    fetchImpl: async url => {
      urls.push(String(url));
      const parsed = new URL(String(url));
      const offset = Number(parsed.searchParams.get('offset') || 0);
      const remaining = Math.max(0, 250 - offset);
      const count = Math.min(100, remaining);
      return response({
        rentals: { listings: rentalRows(count, offset), property: { id: 1, name: 'Apartment' } },
        rentals_timestamp: 123,
        rentals_delay: 60,
        _metadata: { links: { total: 250, next: null } }
      });
    }
  });

  const market = await client.fetchRentalMarket(1, {
    force: true,
    onPageProgress(entry) { progress.push(entry); }
  });

  assert.equal(market.rentals.length, 250);
  assert.equal(urls.length, 3);
  assert.ok(urls.some(url => /[?&]offset=100(?:&|$)/.test(url)));
  assert.ok(urls.some(url => /[?&]offset=200(?:&|$)/.test(url)));
  assert.deepEqual(progress.map(entry => [entry.donePages, entry.totalPages]), [[1, 3], [2, 3], [3, 3]]);
});

test('individual property progress advances during rental pagination before the market scan completes', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
  const seen = [];
  let releaseScan;
  const scanGate = new Promise(resolve => { releaseScan = resolve; });
  const raw = { id: 101, property: { id: 1, name: 'Apartment' }, owner: { id: 1 }, happy: 100, status: 'none', modifications: [] };
  const apiClient = {
    async fetchCurrentUserId() { return 1; },
    async fetchOwnedProperties() { return [raw]; },
    async scanMarkets(properties, options) {
      assert.equal(properties.length, 1);
      assert.equal(typeof options.onPageProgress, 'function');
      options.onPageProgress({ id: 1, donePages: 1, totalPages: 4, rowsDone: 100, totalRows: 350 });
      await scanGate;
      return { 1: { rentals: rentalRows(2, 0), fromCache: false } };
    }
  };

  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage: memoryStorage(),
    apiClient,
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: { save(d) { return d; }, loadFor() { return null; }, clear() {} },
    navigate() {}
  });
  controller.hydrate({ properties: PropertyCore.normalizeProperties([raw], 1), markets: {} });

  const pending = controller.updateProperty(101, {
    force: true,
    silent: true,
    onProgress(entry) { seen.push(entry); }
  });
  await new Promise(resolve => setTimeout(resolve, 0));

  const percentages = seen.map(entry => Number(entry.percent));
  assert.ok(percentages.includes(35));
  assert.ok(percentages.some(value => value > 35 && value < 92), `expected page progress between 35 and 92, saw ${percentages.join(', ')}`);

  releaseScan();
  await pending;
});
