'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const App = require('../src/app-v037');
const Bootstrap = require('../src/bootstrap');
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

function rawProperties() {
  return [
    { id: 101, property: { id: 13, name: 'Private Island' }, owner: { id: 1 }, happy: 4500, status: 'none', modifications: [] },
    { id: 102, property: { id: 10, name: 'Castle' }, owner: { id: 1 }, happy: 5000, status: 'rented', modifications: ['Hot Tub'] },
    { id: 999, property: { id: 11, name: 'Palace' }, owner: { id: 2 }, happy: 4800, status: 'none', modifications: [] }
  ];
}

test('startup property sync loads only verified owned properties and never scans rental markets', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
  const calls = { owner: 0, properties: 0, markets: 0 };
  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage: memoryStorage(),
    apiClient: {
      async fetchCurrentUserId() { calls.owner += 1; return 1; },
      async fetchOwnedProperties() { calls.properties += 1; return rawProperties(); },
      async scanMarkets() { calls.markets += 1; throw new Error('startup must not scan markets'); }
    },
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: { save(d) { return d; }, loadFor() { return null; }, clear() {} },
    navigate() {}
  });

  assert.equal(typeof controller.syncOwnedProperties, 'function');
  await controller.syncOwnedProperties();

  assert.deepEqual(calls, { owner: 1, properties: 1, markets: 0 });
  assert.deepEqual(controller.getState().properties.map(property => property.id), [101, 102]);
  assert.equal(controller.getState().rows.length, 2);

  for (const id of [101, 102]) {
    const card = dom.window.document.querySelector(`[data-property-id="${id}"]`);
    assert.ok(card, `property ${id} should render after startup sync`);
    const scan = card.querySelector('[data-action="v034-update-property"]');
    assert.ok(scan, `property ${id} should have its own market scan action`);
    assert.match(scan.textContent, /SCAN MARKET/i);
  }
});

test('bootstrap startup always performs property-only sync and never automatic UPDATE ALL', async () => {
  assert.equal(typeof Bootstrap.runInitialUpdate, 'function');
  let propertySyncs = 0;
  let marketScans = 0;

  const controller = {
    getUpdateSettings() { return { autoPageUpdate: true }; },
    async syncOwnedProperties() { propertySyncs += 1; return { properties: [] }; },
    async updateAll() { marketScans += 1; }
  };

  assert.equal(await Bootstrap.runInitialUpdate(controller), true);
  assert.equal(propertySyncs, 1);
  assert.equal(marketScans, 0);
});
