'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const Bootstrap = require('../src/bootstrap');
const AppV0310 = require('../src/app-v0310');
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

test('createApiFetch aborts the real GM request and rejects AbortError when its signal is cancelled', async () => {
  const original = global.GM_xmlhttpRequest;
  let abortCalled = false;
  global.GM_xmlhttpRequest = options => {
    const timer = setTimeout(() => {
      options.onload({ status: 200, responseText: '{}' });
    }, 20);
    return {
      abort() {
        abortCalled = true;
        clearTimeout(timer);
      }
    };
  };

  try {
    const controller = new AbortController();
    const apiFetch = Bootstrap.createApiFetch({ fetch: global.fetch });
    const pending = apiFetch('https://api.torn.com/v2/market/1/rentals?limit=100', {
      method: 'GET',
      signal: controller.signal
    });
    controller.abort();

    await assert.rejects(pending, error => error && error.name === 'AbortError');
    assert.equal(abortCalled, true);
  } finally {
    if (original === undefined) delete global.GM_xmlhttpRequest;
    else global.GM_xmlhttpRequest = original;
  }
});

test('per-property scan renders retry diagnostics and clears them after the request recovers', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
  const property = PropertyCore.normalizeProperty(rawProperty(), 1);
  let finishMarket;
  const apiClient = {
    async fetchCurrentUserId() { return 1; },
    async fetchOwnedProperties() { return [rawProperty()]; },
    scanMarkets(properties, options) {
      if (options && typeof options.onRequestStatus === 'function') {
        options.onRequestStatus({
          type: 'retry',
          attempt: 1,
          maxAttempts: 3,
          delayMs: 250,
          status: 503,
          message: 'Torn API 503; retrying 1 / 2'
        });
      }
      return new Promise(resolve => {
        finishMarket = () => resolve({
          1: {
            rentals: [
              { happy: 100, cost: 100000, cost_per_day: 1000, rental_period: 100, modifications: [] },
              { happy: 100, cost: 101000, cost_per_day: 1010, rental_period: 100, modifications: [] }
            ],
            rentals_timestamp: 123,
            checkedAt: Date.now(),
            fetchedAt: Date.now(),
            fromCache: false
          }
        });
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
  const status = dom.window.document.querySelector('[data-role="v0310-request-status"]');
  assert.ok(status, 'retry state should be visible on the active property card');
  assert.match(status.textContent, /503|retry/i);

  finishMarket();
  await pending;
  assert.equal(dom.window.document.querySelector('[data-role="v0310-request-status"]'), null);
  controller.destroy();
  dom.window.close();
});
