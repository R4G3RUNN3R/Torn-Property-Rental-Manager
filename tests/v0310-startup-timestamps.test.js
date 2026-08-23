'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const AppV0310 = require('../src/app-v0310');
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

function rawProperty() {
  return {
    id: 101,
    owner: { id: 1 },
    property: { id: 1, name: 'Apartment', happy: 100 },
    happy: 100,
    status: 'none',
    modifications: []
  };
}

function draftStore() {
  return { save() { return true; }, loadFor() { return null; }, clear() { return true; } };
}

test('automatic owned-property sync advances property check time but preserves the last successful market check', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
  const property = PropertyCore.normalizeProperty(rawProperty(), 1);
  const storage = memoryStorage({
    [UpdateCore.SNAPSHOT_KEY]: JSON.stringify({
      properties: [property],
      markets: {},
      propertyMarkets: {},
      propertyCheckedAt: { 101: 1000 },
      marketCheckedAt: { 101: 2222 }
    })
  });
  let marketScans = 0;
  const apiClient = {
    async fetchCurrentUserId() { return 1; },
    async fetchOwnedProperties() { return [rawProperty()]; },
    async scanMarkets() {
      marketScans += 1;
      return {};
    }
  };

  const before = Date.now();
  const controller = AppV0310.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClient,
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: draftStore()
  });

  await controller.syncOwnedProperties();
  const snapshot = UpdateCore.loadSnapshot(storage);

  assert.equal(marketScans, 0, 'startup sync must not scan rental markets');
  assert.ok(snapshot.propertyCheckedAt['101'] >= before, 'property check should reflect the startup sync');
  assert.equal(snapshot.marketCheckedAt['101'], 2222, 'market check must remain the last successful market scan');

  controller.destroy();
  dom.window.close();
});
