'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const PropertyCore = require('../src/property-core');
const MarketCore = require('../src/market-core');

function optionalRequire(path) {
  try { return require(path); } catch (error) { return null; }
}

const ApiCoreV039 = optionalRequire('../src/api-core-v039');
const AppV039 = optionalRequire('../src/app-v039');

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
  assert.ok(ApiCoreV039, 'v0.3.9 API core should exist');
  const urls = [];
  const progress = [];
  const client = ApiCoreV039.createClient({
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

test('individual property progress visibly advances during rental pagination before the market scan completes', async () => {
  assert.ok(AppV039, 'v0.3.9 app wrapper should exist');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
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
      if (typeof options.onProgress === 'function') {
        options.onProgress({ id: 1, done: 1, total: 1, market: { rentals: rentalRows(2, 0), fromCache: false } });
      }
      return { 1: { rentals: rentalRows(2, 0), fromCache: false } };
    }
  };

  const controller = AppV039.createController({
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
  controller.render();

  const pending = controller.updateProperty(101);
  await new Promise(resolve => setTimeout(resolve, 0));

  const row = dom.window.document.querySelector('[data-property-id="101"]');
  const pageProgress = row && row.querySelector('[data-role="v039-market-page-progress"]');
  const bar = pageProgress && pageProgress.querySelector('[role="progressbar"]');
  const label = pageProgress && pageProgress.querySelector('[data-role="v039-market-page-progress-label"]');
  assert.ok(bar, 'individual market scan should show observer-safe page progress');
  const percent = Number(bar.getAttribute('aria-valuenow'));
  assert.ok(percent > 35 && percent < 92, `expected visible page progress between 35 and 92, saw ${percent}`);
  assert.match(label.textContent, /page\s+1\s*\/\s*4/i);

  releaseScan();
  await pending;
  assert.equal(dom.window.document.querySelector('[data-role="v039-market-page-progress"]'), null);
});
