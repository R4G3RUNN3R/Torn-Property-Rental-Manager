'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const ApiCore = require('../src/api-core');
const App = require('../src/app');
const PropertyCore = require('../src/property-core');
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

function makeDom() {
  return new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.torn.com/properties.php'
  });
}

function marketRows() {
  return [
    { modifications: [], cost: 300_000, rental_period: 100, cost_per_day: 3000 },
    { modifications: [], cost: 400_000, rental_period: 100, cost_per_day: 4000 }
  ];
}

function makeFixedController() {
  const dom = makeDom();
  const storage = memoryStorage();
  const apiClient = {
    async fetchOwnedProperties() {
      return [{
        id: 101,
        property: { id: 13, name: 'Private Island' },
        owner: { id: 3877028 },
        happy: 4500,
        status: 'none',
        modifications: []
      }];
    },
    async scanMarkets() {
      return { 13: { rentals: marketRows(), fromCache: false } };
    }
  };
  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClient,
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: { save(draft) { return draft; }, loadFor() { return null; }, clear() {} },
    navigate() {},
    canListProperty() { return false; },
    listProperty() { return { submitted: false }; }
  });
  return { dom, storage, controller };
}

test('Torn API error 5 cools down before retrying instead of hammering the API', async () => {
  const sleeps = [];
  let calls = 0;
  const client = ApiCore.createClient({
    apiKey: 'test-api-key',
    scheduler: { run: fn => fn() },
    sleep: async ms => { sleeps.push(ms); },
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return okJson({ error: { code: 5, error: 'Too many requests' } });
      return okJson({ properties: [] });
    }
  });

  const rows = await client.fetchOwnedProperties();
  assert.deepEqual(rows, []);
  assert.equal(calls, 2);
  assert.ok(sleeps.some(ms => ms >= 60_000), `expected a rate-limit cooldown, got ${sleeps.join(', ')}`);
});

test('current API user id is read once from user/basic and then cached', async () => {
  let calls = 0;
  const client = ApiCore.createClient({
    apiKey: 'test-api-key',
    scheduler: { run: fn => fn() },
    fetchImpl: async url => {
      calls += 1;
      assert.match(url, /\/v2\/user\/basic/);
      return okJson({ profile: { id: 3877028, name: 'R4G3RUNN3R' } });
    }
  });

  assert.equal(await client.fetchCurrentUserId(), 3877028);
  assert.equal(await client.fetchCurrentUserId(), 3877028);
  assert.equal(calls, 1);
});

test('controller reuses one API client and excludes spouse-owned properties using the API user id', async () => {
  const dom = makeDom();
  const storage = memoryStorage();
  App.saveSettings(storage, { apiKey: 'test-api-key' });
  let factoryCalls = 0;
  let scannedProperties = [];

  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClientFactory() {
      factoryCalls += 1;
      return {
        async fetchCurrentUserId() { return 3877028; },
        async fetchOwnedProperties() {
          return [
            { id: 101, property: { id: 13, name: 'Private Island' }, owner: { id: 3877028 }, status: 'none', modifications: [] },
            { id: 102, property: { id: 13, name: 'Private Island' }, owner: { id: 999999 }, status: 'none', modifications: [] }
          ];
        },
        async scanMarkets(properties) {
          scannedProperties = properties;
          return { 13: { rentals: marketRows(), fromCache: false } };
        }
      };
    },
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: { save(draft) { return draft; }, loadFor() { return null; }, clear() {} },
    navigate() {},
    canListProperty() { return false; },
    listProperty() { return { submitted: false }; }
  });

  await controller.load();
  await controller.load();

  assert.equal(factoryCalls, 1, 'refreshes must share one scheduler/client for the same API key');
  assert.deepEqual(controller.getState().properties.map(row => row.id), [101]);
  assert.deepEqual(scannedProperties.map(row => row.id), [101]);
});

test('desktop panel exposes a visible resize handle and persists dragged dimensions', async () => {
  const { dom, storage, controller } = makeFixedController();
  await controller.load();

  const panel = dom.window.document.querySelector('#r4g3-prm-panel');
  const handle = panel.querySelector('[data-role="resize-handle"]');
  assert.ok(handle, 'a visible bottom-right resize handle should exist');
  assert.equal(handle.style.cursor, 'nwse-resize');

  handle.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, clientX: 900, clientY: 550, button: 0 }));
  dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 1000, clientY: 600 }));
  dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, clientX: 1000, clientY: 600, button: 0 }));

  const width = parseInt(panel.style.width, 10);
  const height = parseInt(panel.style.height, 10);
  assert.ok(width > 920, `expected width > 920, got ${width}`);
  assert.ok(height > 560, `expected height > 560, got ${height}`);
  const saved = App.loadSettings(storage).geometry;
  assert.equal(saved.width, width);
  assert.equal(saved.height, height);
});

test('property artwork uses Torn-hosted property images without API requests', async () => {
  assert.equal(
    PropertyCore.propertyImageUrl('Private Island'),
    'https://www.torn.com/images/v2/properties/350x230/350x230_default_private_island.png'
  );
  assert.equal(
    PropertyCore.propertyImageUrl('Detached House'),
    'https://www.torn.com/images/v2/properties/350x230/350x230_default_detached.png'
  );

  const { dom, controller } = makeFixedController();
  await controller.load();
  const image = dom.window.document.querySelector('[data-property-id="101"] [data-role="property-image"]');
  assert.ok(image);
  assert.match(image.src, /350x230_default_private_island\.png$/);
  assert.match(image.alt, /Private Island/i);
});
