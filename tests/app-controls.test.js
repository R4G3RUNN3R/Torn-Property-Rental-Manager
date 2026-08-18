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

function makeDom(width = 1024) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.torn.com/properties.php'
  });
  Object.defineProperty(dom.window, 'innerWidth', { value: width, configurable: true });
  return dom;
}

function rows() {
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
      modifications: [],
      cost: 90_000_000,
      cost_per_day: 3_000_000,
      rental_period: 30,
      rental_period_remaining: 12,
      rented_by: { id: 99, name: 'Tenant' }
    },
    {
      id: 103,
      property: { id: 13, name: 'Private Island' },
      owner: { id: 3877028 },
      happy: 4500,
      status: 'for_rent',
      modifications: [],
      cost: 84_000_000,
      cost_per_day: 2_800_000,
      rental_period: 30,
      renter_asked: { id: 77, name: 'Applicant' }
    }
  ];
}

function rentals() {
  return Array.from({ length: 8 }, (_, i) => ({
    id: i + 1,
    happy: 4500,
    modifications: [],
    cost_per_day: 2_500_000 + i * 10_000
  }));
}

function makeController(options = {}) {
  const dom = makeDom(options.width || 1024);
  const scanOptions = [];
  const savedDrafts = [];
  const navigations = [];
  const apiClient = {
    async fetchOwnedProperties() { return rows(); },
    async scanMarkets(_properties, optionsArg) {
      scanOptions.push(optionsArg || {});
      return { 13: { rentals: rentals(), rentals_timestamp: 123, fromCache: false } };
    }
  };
  const draftStore = {
    save(draft) { savedDrafts.push(draft); return draft; },
    loadFor() { return null; },
    clear() {}
  };
  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage: memoryStorage(),
    apiClient,
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore,
    navigate(url) { navigations.push(url); }
  });
  return { dom, controller, scanOptions, savedDrafts, navigations };
}

test('Refresh forces rental-market cache bypass', async () => {
  const { dom, controller, scanOptions } = makeController();
  await controller.load();
  assert.equal(scanOptions[0].force, false);

  const refresh = dom.window.document.querySelector('[data-action="refresh"]');
  assert.ok(refresh);
  refresh.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));

  assert.equal(scanOptions.length, 2);
  assert.equal(scanOptions[1].force, true);
});

test('advanced per-property price override is used by Prepare Lease', async () => {
  const { dom, controller, savedDrafts, navigations } = makeController();
  await controller.load();
  controller.setMode('advanced');

  const row = dom.window.document.querySelector('[data-property-id="101"]');
  const override = row.querySelector('[data-role="daily-price-override"]');
  assert.ok(override);
  override.value = '3000000';
  override.dispatchEvent(new dom.window.Event('change', { bubbles: true }));

  const action = row.querySelector('[data-action="prepare-lease"]');
  action.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.equal(savedDrafts.length, 1);
  assert.equal(savedDrafts[0].dailyPrice, 3_000_000);
  assert.equal(savedDrafts[0].propertyId, 101);
  assert.equal(navigations.length, 1);
});

test('advanced mode shows current rented and for-rent details', async () => {
  const { dom, controller } = makeController();
  await controller.load();
  controller.setMode('advanced');

  const rented = dom.window.document.querySelector('[data-property-id="102"]').textContent;
  const forRent = dom.window.document.querySelector('[data-property-id="103"]').textContent;

  assert.match(rented, /Tenant/);
  assert.match(rented, /12 days/i);
  assert.match(rented, /3,000,000/);
  assert.match(forRent, /2,800,000/);
  assert.match(forRent, /Applicant/);
});

test('mobile shell stays on-screen and disables desktop resize affordance', async () => {
  const { dom, controller } = makeController({ width: 600 });
  await controller.load();

  const panel = dom.window.document.querySelector('#r4g3-prm-panel');
  assert.equal(panel.style.left, '8px');
  assert.equal(panel.style.top, '8px');
  assert.equal(panel.style.width, 'calc(100vw - 16px)');
  assert.equal(panel.style.height, 'calc(100vh - 16px)');
  assert.equal(panel.style.resize, 'none');
});
