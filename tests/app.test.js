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
    removeItem(key) { map.delete(key); },
    dump() { return Object.fromEntries(map.entries()); }
  };
}

function makeDom() {
  return new JSDOM('<!doctype html><html><body><main id="torn-content"></main></body></html>', {
    url: 'https://www.torn.com/properties.php'
  });
}

function rentals(base) {
  return Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    happy: 4500,
    modifications: [],
    cost_per_day: base + i * 1000
  }));
}

function propertyRows() {
  return [
    {
      id: 101,
      property: { id: 13, name: 'Private Island' },
      owner: { id: 3877028 },
      happy: 4500,
      status: 'none',
      modifications: []
    },
    {
      id: 102,
      property: { id: 13, name: 'Private Island' },
      owner: { id: 3877028 },
      happy: 4500,
      status: 'rented',
      modifications: []
    },
    {
      id: 201,
      property: { id: 10, name: 'Castle' },
      owner: { id: 3877028 },
      happy: 4500,
      status: 'for_rent',
      modifications: ['Hot Tub']
    }
  ];
}

function makeApiClient() {
  return {
    async fetchOwnedProperties() { return propertyRows(); },
    async scanMarkets() {
      return {
        13: { rentals: rentals(2_500_000), rentals_timestamp: 123, fetchedAt: 1000, fromCache: false },
        10: { rentals: rentals(1_000_000), rentals_timestamp: 124, fetchedAt: 1000, fromCache: false }
      };
    }
  };
}

test('loads owned properties and renders pricing without exposing the API key', async () => {
  const dom = makeDom();
  const storage = memoryStorage();
  const draftStore = { save() { throw new Error('not used'); }, loadFor() { return null; }, clear() {} };
  App.saveSettings(storage, { apiKey: 'secret-api-key', theme: 'dark', mode: 'simple' });

  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClient: makeApiClient(),
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore,
    navigate() {}
  });

  await controller.load();

  const panel = dom.window.document.querySelector('#r4g3-prm-panel');
  assert.ok(panel);
  assert.match(panel.textContent, /Private Island/);
  assert.match(panel.textContent, /2,487,500/);
  assert.equal(panel.textContent.includes('secret-api-key'), false);
  assert.equal(panel.classList.contains('r4g3-prm-theme-dark'), true);
});

test('only status none receives Prepare Lease and click saves exactly one property draft', async () => {
  const dom = makeDom();
  const saved = [];
  const navigations = [];
  const draftStore = {
    save(draft) { saved.push(draft); return draft; },
    loadFor() { return null; },
    clear() {}
  };

  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage: memoryStorage(),
    apiClient: makeApiClient(),
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore,
    navigate(url) { navigations.push(url); }
  });

  await controller.load();

  const buttons = [...dom.window.document.querySelectorAll('[data-action="prepare-lease"]')];
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].dataset.propertyId, '101');
  assert.match(dom.window.document.querySelector('[data-property-id="102"]').textContent, /rented/i);
  assert.match(dom.window.document.querySelector('[data-property-id="201"]').textContent, /for rent/i);

  buttons[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.equal(saved.length, 1);
  assert.equal(saved[0].propertyId, 101);
  assert.equal(saved[0].days, 30);
  assert.ok(saved[0].dailyPrice > 0);
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0], 'https://www.torn.com/properties.php#/p=options&ID=101&tab=lease');
});

test('advanced mode exposes market diagnostics and persists mode/theme settings', async () => {
  const dom = makeDom();
  const storage = memoryStorage();
  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClient: makeApiClient(),
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: { save(d) { return d; }, loadFor() { return null; }, clear() {} },
    navigate() {}
  });

  await controller.load();
  assert.equal(dom.window.document.querySelectorAll('.r4g3-prm-advanced').length, 0);

  controller.setMode('advanced');
  controller.setTheme('light');

  const panel = dom.window.document.querySelector('#r4g3-prm-panel');
  assert.ok(dom.window.document.querySelector('.r4g3-prm-advanced'));
  assert.match(panel.textContent, /Median/i);
  assert.match(panel.textContent, /Comparables/i);
  assert.equal(panel.classList.contains('r4g3-prm-theme-light'), true);

  const settings = App.loadSettings(storage);
  assert.equal(settings.mode, 'advanced');
  assert.equal(settings.theme, 'light');
});

test('settings normalize pricing bounds and geometry persists', () => {
  const storage = memoryStorage();
  App.saveSettings(storage, {
    apiKey: 'k',
    days: 999,
    undercutPercent: -10,
    minimumMedianRatio: 5,
    geometry: { left: 123, top: 45, width: 777, height: 555 }
  });

  const settings = App.loadSettings(storage);
  assert.equal(settings.days, 365);
  assert.equal(settings.undercutPercent, 0);
  assert.equal(settings.minimumMedianRatio, 1);
  assert.deepEqual(settings.geometry, { left: 123, top: 45, width: 777, height: 555 });
});

test('desktop shell is explicitly movable and resizable', async () => {
  const dom = makeDom();
  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage: memoryStorage(),
    apiClient: makeApiClient(),
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: { save(d) { return d; }, loadFor() { return null; }, clear() {} },
    navigate() {}
  });

  await controller.load();
  const panel = dom.window.document.querySelector('#r4g3-prm-panel');
  const handle = dom.window.document.querySelector('[data-role="drag-handle"]');
  assert.equal(panel.style.resize, 'both');
  assert.ok(handle);
  assert.equal(handle.style.cursor, 'move');
});

test('load failure is rendered without leaking the configured API key', async () => {
  const dom = makeDom();
  const storage = memoryStorage();
  App.saveSettings(storage, { apiKey: 'ultra-secret' });
  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClient: {
      async fetchOwnedProperties() { throw new Error('Rejected key ultra-secret'); },
      async scanMarkets() { return {}; }
    },
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: { save(d) { return d; }, loadFor() { return null; }, clear() {} },
    navigate() {}
  });

  await assert.rejects(() => controller.load(), /Rejected key/);
  const panel = dom.window.document.querySelector('#r4g3-prm-panel');
  assert.match(panel.textContent, /Unable to load property data/);
  assert.equal(panel.textContent.includes('ultra-secret'), false);
});
