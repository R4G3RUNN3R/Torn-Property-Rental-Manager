'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
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

function makeController(options = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.torn.com/properties.php'
  });
  const storage = options.storage || memoryStorage();
  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClient: options.apiClient,
    apiClientFactory: options.apiClientFactory,
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: { save(d) { return d; }, loadFor() { return null; }, clear() {} },
    navigate() {}
  });
  return { dom, storage, controller };
}

test('saved API key is never rendered back into the settings DOM', () => {
  const storage = memoryStorage();
  App.saveSettings(storage, { apiKey: 'existing-secret' });
  const { dom, controller } = makeController({
    storage,
    apiClient: { async fetchOwnedProperties() { return []; }, async scanMarkets() { return {}; } }
  });

  controller.openSettings();
  const input = dom.window.document.querySelector('[data-role="api-key-input"]');
  assert.ok(input);
  assert.equal(input.type, 'password');
  assert.equal(input.value, '');
  assert.equal(dom.window.document.body.textContent.includes('existing-secret'), false);
  assert.equal(dom.window.document.documentElement.outerHTML.includes('existing-secret'), false);
});

test('setApiKey persists a replacement key without keeping it in an input element', () => {
  const { dom, storage, controller } = makeController({
    apiClient: { async fetchOwnedProperties() { return []; }, async scanMarkets() { return {}; } }
  });

  controller.openSettings();
  controller.setApiKey('new-secret');

  assert.equal(App.loadSettings(storage).apiKey, 'new-secret');
  const input = dom.window.document.querySelector('[data-role="api-key-input"]');
  assert.ok(input);
  assert.equal(input.value, '');
  assert.equal(dom.window.document.documentElement.outerHTML.includes('new-secret'), false);
});

test('factory-backed controller requires key setup before scanning and rebuilds client after save', async () => {
  const seenKeys = [];
  const { dom, controller } = makeController({
    apiClientFactory(apiKey) {
      seenKeys.push(apiKey);
      return {
        async fetchOwnedProperties() { return []; },
        async scanMarkets() { return {}; }
      };
    }
  });

  const first = await controller.load();
  assert.equal(seenKeys.length, 0);
  assert.equal(first.needsApiKey, true);
  assert.match(dom.window.document.querySelector('#r4g3-prm-panel').textContent, /API key/i);

  controller.setApiKey('configured-key');
  const second = await controller.load();
  assert.deepEqual(seenKeys, ['configured-key']);
  assert.equal(second.needsApiKey, false);
});
