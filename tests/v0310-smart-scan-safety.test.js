'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

function optionalRequire(path) {
  try { return require(path); } catch (error) { return null; }
}

const ApiCore = require('../src/api-core-v039');
const AppV0310 = optionalRequire('../src/app-v0310');
const UpdateCore = require('../src/update-core-v034');
const PropertyCore = require('../src/property-core');
const MarketCore = require('../src/market-core');

function memoryStorage(initial) {
  const map = new Map(Object.entries(initial || {}));
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; }
  };
}

function rentalRows(count, offset = 0) {
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

function rawProperty(id = 101) {
  return {
    id,
    owner: { id: 1 },
    property: { id: 1, name: 'Apartment', happy: 100 },
    happy: 100,
    status: 'none',
    modifications: []
  };
}

function normalizedProperty(id = 101) {
  return PropertyCore.normalizeProperty(rawProperty(id), 1);
}

function draftStore() {
  return {
    save() { return true; },
    loadFor() { return null; },
    clear() { return true; }
  };
}

test('force market refresh reuses the complete cached snapshot after one page when rentals_timestamp is unchanged', async () => {
  const cachedRows = rentalRows(250);
  const storage = memoryStorage({
    'r4g3_property_rental_manager.market.1': JSON.stringify({
      rentals: cachedRows,
      property: { id: 1, name: 'Apartment' },
      rentals_timestamp: 123,
      rentals_delay: 60,
      fetchedAt: 500,
      checkedAt: 500,
      fromCache: false
    })
  });
  const urls = [];
  const client = ApiCore.createClient({
    apiKey: 'test-key',
    storage,
    now: () => 1000,
    scheduler: { run(task) { return task(); } },
    fetchImpl: async url => {
      urls.push(String(url));
      return response({
        rentals: { listings: rentalRows(100), property: { id: 1, name: 'Apartment' } },
        rentals_timestamp: 123,
        rentals_delay: 60,
        _metadata: { links: { total: 250, next: null } }
      });
    }
  });

  const market = await client.fetchRentalMarket(1, { force: true });

  assert.equal(urls.length, 1, 'unchanged Torn cache should need only the first page');
  assert.equal(market.rentals.length, 250);
  assert.equal(market.unchanged, true);
  assert.equal(market.fromCache, true);
  assert.equal(market.checkedAt, 1000);
  assert.equal(market.fetchedAt, 500, 'reused data keeps the time the full snapshot was fetched');
});

test('large rental pagination uses at most two concurrent page workers', async () => {
  let active = 0;
  let maxActive = 0;
  const client = ApiCore.createClient({
    apiKey: 'test-key',
    storage: memoryStorage(),
    scheduler: { run(task) { return task(); } },
    fetchImpl: async url => {
      const parsed = new URL(String(url));
      const offset = Number(parsed.searchParams.get('offset') || 0);
      if (offset > 0) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 10));
        active -= 1;
      }
      const remaining = Math.max(0, 500 - offset);
      return response({
        rentals: { listings: rentalRows(Math.min(100, remaining), offset), property: { id: 1, name: 'Apartment' } },
        rentals_timestamp: 456,
        rentals_delay: 60,
        _metadata: { links: { total: 500, next: null } }
      });
    }
  });

  const market = await client.fetchRentalMarket(1, { force: true });
  assert.equal(market.rentals.length, 500);
  assert.ok(maxActive <= 2, `expected at most two page workers, saw ${maxActive}`);
});

test('transient failures emit retry diagnostics before the retry succeeds', async () => {
  let calls = 0;
  const statuses = [];
  const client = ApiCore.createClient({
    apiKey: 'test-key',
    storage: memoryStorage(),
    sleep: async () => {},
    scheduler: { run(task) { return task(); } },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return response({}, 503);
      return response({
        rentals: { listings: rentalRows(1), property: { id: 1, name: 'Apartment' } },
        rentals_timestamp: 789,
        rentals_delay: 60,
        _metadata: { links: { total: 1, next: null } }
      });
    }
  });

  await client.fetchRentalMarket(1, {
    force: true,
    onRequestStatus(entry) { statuses.push(entry); }
  });

  assert.equal(calls, 2);
  assert.ok(statuses.some(entry => entry.type === 'retry' && entry.status === 503 && entry.attempt === 1));
});

test('an aborted market scan rejects as AbortError before starting another request', async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const client = ApiCore.createClient({
    apiKey: 'test-key',
    storage: memoryStorage(),
    scheduler: { run(task) { return task(); } },
    fetchImpl: async () => {
      calls += 1;
      return response({
        rentals: { listings: rentalRows(1), property: { id: 1, name: 'Apartment' } },
        rentals_timestamp: 999,
        rentals_delay: 60,
        _metadata: { links: { total: 1, next: null } }
      });
    }
  });

  await assert.rejects(
    client.fetchRentalMarket(1, { force: true, signal: controller.signal }),
    error => error && error.name === 'AbortError'
  );
  assert.equal(calls, 0);
});

test('single-property update reports property success separately from a failed market scan', async () => {
  assert.ok(AppV0310, 'v0.3.10 app wrapper should exist');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
  const property = normalizedProperty();
  const previousMarket = { rentals: rentalRows(2), rentals_timestamp: 100, fetchedAt: 100, checkedAt: 100 };
  const apiClient = {
    async fetchCurrentUserId() { return 1; },
    async fetchOwnedProperties() { return [rawProperty()]; },
    async scanMarkets() {
      return { 1: { rentals: [], error: 'Torn API request timed out', fetchedAt: 200, fromCache: false } };
    }
  };
  const controller = AppV0310.createController({
    window: dom.window,
    document: dom.window.document,
    storage: memoryStorage(),
    apiClient,
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: draftStore()
  });
  controller.hydrate({ properties: [property], markets: {}, propertyMarkets: { 101: previousMarket } });

  const state = await controller.updateProperty(101, { force: true, silent: true });

  assert.equal(state.lastUpdate.propertyChecked, true);
  assert.equal(state.lastUpdate.marketChecked, false);
  assert.match(state.lastUpdate.marketError, /timed out/i);
  assert.match(state.actionMessage, /market scan failed/i);
  assert.equal(state.propertyMarkets['101'], previousMarket, 'last good market snapshot must survive a failed scan');
  controller.destroy();
  dom.window.close();
});

test('snapshot metadata stores property-checked and market-checked timestamps independently', () => {
  const snapshot = UpdateCore.normalizeSnapshot({
    properties: [normalizedProperty()],
    markets: {},
    propertyMarkets: {},
    propertyCheckedAt: { 101: 1111 },
    marketCheckedAt: { 101: 2222 }
  });

  assert.deepEqual(snapshot.propertyCheckedAt, { 101: 1111 });
  assert.deepEqual(snapshot.marketCheckedAt, { 101: 2222 });
});

test('property cards show separate property and market timestamps instead of one ambiguous Last updated value', () => {
  assert.ok(AppV0310, 'v0.3.10 app wrapper should exist');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
  const property = normalizedProperty();
  const storage = memoryStorage({
    [UpdateCore.SNAPSHOT_KEY]: JSON.stringify({
      properties: [property],
      markets: {},
      propertyMarkets: {},
      propertyCheckedAt: { 101: Date.now() - 2000 },
      marketCheckedAt: { 101: Date.now() - 1000 }
    })
  });
  const apiClient = {
    async fetchOwnedProperties() { return []; },
    async scanMarkets() { return {}; }
  };

  const controller = AppV0310.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClient,
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: draftStore()
  });

  const controls = dom.window.document.querySelector('[data-role="v034-card-controls"]');
  assert.ok(controls);
  assert.match(controls.textContent, /Property checked:/i);
  assert.match(controls.textContent, /Market checked:/i);
  assert.doesNotMatch(controls.textContent, /Last updated:/i);
  controller.destroy();
  dom.window.close();
});

test('an in-flight per-property scan exposes CANCEL SCAN and aborts without recording a successful market update', async () => {
  assert.ok(AppV0310, 'v0.3.10 app wrapper should exist');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
  const property = normalizedProperty();
  let receivedSignal = null;
  const apiClient = {
    async fetchCurrentUserId() { return 1; },
    async fetchOwnedProperties() { return [rawProperty()]; },
    scanMarkets(properties, options) {
      receivedSignal = options && options.signal;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => resolve({ 1: { rentals: rentalRows(2), rentals_timestamp: 123 } }), 100);
        if (receivedSignal) {
          receivedSignal.addEventListener('abort', () => {
            clearTimeout(timer);
            const error = new Error('Scan cancelled');
            error.name = 'AbortError';
            reject(error);
          }, { once: true });
        }
      });
    }
  };
  const controller = AppV0310.createController({
    window: dom.window,
    document: dom.window.document,
    storage: memoryStorage(),
    apiClient,
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: draftStore()
  });
  controller.hydrate({ properties: [property], markets: {}, propertyMarkets: {} });

  const pending = controller.updateProperty(101);
  await new Promise(resolve => setTimeout(resolve, 0));
  const cancel = dom.window.document.querySelector('[data-action="v0310-cancel-scan"]');
  assert.ok(cancel, 'in-flight scan should expose a cancel control');
  cancel.click();
  const result = await pending;

  assert.ok(receivedSignal && receivedSignal.aborted);
  assert.equal(result, false);
  assert.equal(dom.window.document.querySelector('[data-action="v0310-cancel-scan"]'), null);
  controller.destroy();
  dom.window.close();
});
