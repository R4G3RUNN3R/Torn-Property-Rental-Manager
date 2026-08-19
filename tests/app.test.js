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
      happy: 5000,
      status: 'for_rent',
      modifications: ['Hot Tub']
    }
  ];
}

function islandRentals() {
  return [
    { modifications: [], cost: 90_000, rental_period: 30, cost_per_day: 3000 },
    { modifications: [], cost: 210_000, rental_period: 60, cost_per_day: 3500 },
    { modifications: [], cost: 400_000, rental_period: 100, cost_per_day: 4000 },
    { modifications: ['Hot Tub'], cost: 900_000, rental_period: 100, cost_per_day: 9000 }
  ];
}

function makeApiClient(scanOptions) {
  return {
    async fetchOwnedProperties() { return propertyRows(); },
    async scanMarkets(_properties, options) {
      if (scanOptions) scanOptions.push(options || {});
      return {
        13: { rentals: islandRentals(), rentals_timestamp: 123, fetchedAt: 1000, fromCache: false },
        10: {
          rentals: [
            { modifications: ['Hot Tub'], cost: 500_000, rental_period: 100, cost_per_day: 5000 }
          ],
          rentals_timestamp: 124,
          fetchedAt: 1000,
          fromCache: false
        }
      };
    }
  };
}

function createController(options = {}) {
  const dom = options.dom || makeDom();
  const storage = options.storage || memoryStorage();
  const saved = [];
  const navigations = [];
  const listCalls = [];
  let listReady = Boolean(options.listReady);
  const draftStore = options.draftStore || {
    save(draft) { saved.push(draft); return draft; },
    loadFor() { return null; },
    clear() {}
  };

  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClient: options.apiClient || makeApiClient(options.scanOptions),
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore,
    navigate(url) { navigations.push(url); },
    canListProperty(id) { return listReady && id === 101; },
    listProperty(id) { listCalls.push(id); return { submitted: true, propertyId: id }; }
  });

  return {
    dom,
    storage,
    controller,
    saved,
    navigations,
    listCalls,
    setListReady(value) { listReady = Boolean(value); controller.render(); }
  };
}

test('renders exact-match low high average and proposed 100-day rent without analytics clutter', async () => {
  const { dom, controller } = createController();
  await controller.load();

  const row = dom.window.document.querySelector('[data-property-id="101"]');
  assert.ok(row);
  assert.match(row.textContent, /Exact matches:\s*3/i);
  assert.match(row.textContent, /Lowest 100-day:\s*\$300,000/i);
  assert.match(row.textContent, /Highest 100-day:\s*\$400,000/i);
  assert.match(row.textContent, /Average 100-day:\s*\$350,000/i);
  assert.match(row.textContent, /Proposed 100-day rent:\s*\$348,250/i);
  assert.doesNotMatch(row.textContent, /Median|Q1|Q3|Average similarity|Confidence/i);
});

test('SET PRICE saves the exact proposed 100-day total and opens the native lease route', async () => {
  const { dom, controller, saved, navigations } = createController();
  await controller.load();

  const row = dom.window.document.querySelector('[data-property-id="101"]');
  const setPrice = row.querySelector('[data-action="set-price"]');
  assert.ok(setPrice);
  setPrice.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.equal(saved.length, 1);
  assert.equal(saved[0].propertyId, 101);
  assert.equal(saved[0].days, 100);
  assert.equal(saved[0].totalCost, 348_250);
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0], 'https://www.torn.com/properties.php#/p=options&ID=101&tab=lease');
});

test('LIST PROPERTY is disabled until the matching native lease form is armed and then fires once', async () => {
  const context = createController();
  await context.controller.load();

  let listButton = context.dom.window.document.querySelector('[data-property-id="101"] [data-action="list-property"]');
  assert.ok(listButton);
  assert.equal(listButton.disabled, true);
  listButton.click();
  assert.equal(context.listCalls.length, 0);

  context.setListReady(true);
  listButton = context.dom.window.document.querySelector('[data-property-id="101"] [data-action="list-property"]');
  assert.equal(listButton.disabled, false);
  listButton.click();
  assert.deepEqual(context.listCalls, [101]);
});

test('new-rental actions are not shown for rented or already-listed properties', async () => {
  const { dom, controller } = createController();
  await controller.load();

  for (const id of [102, 201]) {
    const row = dom.window.document.querySelector(`[data-property-id="${id}"]`);
    assert.ok(row);
    assert.equal(row.querySelector('[data-action="set-price"]'), null);
    assert.equal(row.querySelector('[data-action="list-property"]'), null);
  }
});

test('no exact upgrade matches produces no proposed price and no rental action', async () => {
  const dom = makeDom();
  const apiClient = {
    async fetchOwnedProperties() {
      return [{
        id: 301,
        property: { id: 13, name: 'Private Island' },
        owner: { id: 3877028 },
        happy: 4500,
        status: 'none',
        modifications: ['Hot Tub']
      }];
    },
    async scanMarkets() {
      return { 13: { rentals: islandRentals().filter(row => row.modifications.length === 0) } };
    }
  };
  const { controller } = createController({ dom, apiClient });
  await controller.load();

  const row = dom.window.document.querySelector('[data-property-id="301"]');
  assert.match(row.textContent, /No exact market matches/i);
  assert.equal(row.querySelector('[data-action="set-price"]'), null);
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
    navigate() {},
    canListProperty() { return false; },
    listProperty() { return { submitted: false }; }
  });

  await assert.rejects(() => controller.load(), /Rejected key/);
  const panel = dom.window.document.querySelector('#r4g3-prm-panel');
  assert.match(panel.textContent, /Unable to load property data/);
  assert.equal(panel.textContent.includes('ultra-secret'), false);
});
