'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const BaseApp = require('../src/app');
const FormCore = require('../src/form-core');
const Bootstrap = require('../src/bootstrap');
const PropertyCore = require('../src/property-core');
const MarketCore = require('../src/market-core');

function optionalRequire(path) {
  try { return require(path); } catch (error) { return null; }
}

const UpdateCore = optionalRequire('../src/update-core-v034');
const AppV034 = optionalRequire('../src/app-v034');

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
    { id: 201, property: { id: 11, name: 'Palace' }, owner: { id: 1 }, happy: 4800, status: 'for_rent', cost: 500000, rental_period: 100, modifications: [] }
  ];
}

function marketFor(typeId) {
  return {
    rentals: [{ id: typeId * 10, modifications: [], cost: 300000, rental_period: 100, cost_per_day: 3000 }],
    fromCache: false
  };
}

function snapshot(storage) {
  assert.ok(UpdateCore, 'update-core-v034 should exist');
  const normalized = PropertyCore.normalizeProperties(rawProperties(), 1);
  UpdateCore.saveSnapshot(storage, {
    properties: normalized,
    markets: { 13: marketFor(13), 10: marketFor(10), 11: marketFor(11) },
    updatedAt: 1000,
    propertyUpdatedAt: { 101: 1000, 102: 1000, 201: 1000 }
  });
}

function createBaseController(apiClient, storage = memoryStorage()) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
  const controller = BaseApp.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClient,
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: { save(d) { return d; }, loadFor() { return null; }, clear() {} },
    navigate() {}
  });
  return { dom, controller };
}

function createV034Controller(options = {}) {
  assert.ok(AppV034, 'app-v034 should exist');
  assert.ok(UpdateCore, 'update-core-v034 should exist');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
  Object.defineProperty(dom.window, 'innerWidth', { value: 1100, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 800, configurable: true });
  const storage = options.storage || memoryStorage();
  if (options.withSnapshot !== false) snapshot(storage);
  const calls = { owned: 0, markets: [], prepareCancel: [], cancel: [] };
  let nativeCancelReady = Boolean(options.nativeCancelReady);
  const apiClient = options.apiClient || {
    async fetchCurrentUserId() { return 1; },
    async fetchOwnedProperties() {
      calls.owned += 1;
      return rawProperties();
    },
    async scanMarkets(properties, scanOptions) {
      calls.markets.push({ ids: properties.map(property => Number(property.id)), force: Boolean(scanOptions && scanOptions.force) });
      const result = {};
      for (const property of properties) result[property.propertyTypeId] = marketFor(property.propertyTypeId);
      return result;
    }
  };
  const controller = AppV034.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClient,
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: { save(d) { return d; }, loadFor() { return null; }, clear() {} },
    navigate() {},
    canListProperty() { return false; },
    listProperty() { return { submitted: false }; },
    prepareCancelProperty(id) {
      calls.prepareCancel.push(Number(id));
      return { prepared: true, propertyId: Number(id) };
    },
    canCancelProperty() { return nativeCancelReady; },
    cancelProperty(id) {
      calls.cancel.push(Number(id));
      return { submitted: true, propertyId: Number(id) };
    }
  });
  return { dom, storage, controller, calls, setNativeCancelReady(value) { nativeCancelReady = Boolean(value); } };
}

async function settle(dom) {
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
}

test('v0.3.4 update settings default automatic page update to off and persist opt-in', () => {
  assert.ok(UpdateCore, 'update-core-v034 should exist');
  const storage = memoryStorage();
  assert.equal(UpdateCore.loadSettings(storage).autoPageUpdate, false);
  UpdateCore.saveSettings(storage, { autoPageUpdate: true });
  assert.equal(UpdateCore.loadSettings(storage).autoPageUpdate, true);
});

test('base controller can hydrate a saved snapshot without making API calls', () => {
  let calls = 0;
  const apiClient = {
    async fetchOwnedProperties() { calls += 1; return []; },
    async scanMarkets() { calls += 1; return {}; }
  };
  const { controller } = createBaseController(apiClient);
  assert.equal(typeof controller.hydrate, 'function');
  controller.hydrate({
    properties: PropertyCore.normalizeProperties(rawProperties(), 1),
    markets: { 13: marketFor(13) }
  });
  assert.equal(calls, 0);
  assert.equal(controller.getState().properties.length, 3);
  assert.equal(controller.getState().rows.length, 3);
});

test('base controller updates only the selected property card market while preserving other saved properties', async () => {
  const scanCalls = [];
  const apiClient = {
    async fetchCurrentUserId() { return 1; },
    async fetchOwnedProperties() {
      return rawProperties().map(row => row.id === 101 ? Object.assign({}, row, { status: 'for_rent', cost: 333000, rental_period: 100 }) : row);
    },
    async scanMarkets(properties, options) {
      scanCalls.push({ ids: properties.map(property => property.id), force: Boolean(options && options.force) });
      return { 13: marketFor(13) };
    }
  };
  const { controller } = createBaseController(apiClient);
  assert.equal(typeof controller.hydrate, 'function');
  assert.equal(typeof controller.updateProperty, 'function');
  controller.hydrate({ properties: PropertyCore.normalizeProperties(rawProperties(), 1), markets: { 13: marketFor(13), 10: marketFor(10), 11: marketFor(11) } });

  await controller.updateProperty(101, { force: true });

  assert.deepEqual(scanCalls, [{ ids: [101], force: true }]);
  assert.equal(controller.getState().properties.find(property => property.id === 101).status, 'for_rent');
  assert.equal(controller.getState().properties.find(property => property.id === 102).status, 'rented');
});

test('v0.3.4 controller starts from saved snapshot with zero API requests and renders manual update controls', () => {
  const { dom, controller, calls } = createV034Controller();
  assert.equal(calls.owned, 0);
  assert.equal(calls.markets.length, 0);
  assert.equal(controller.getState().rows.length, 3);
  assert.ok(dom.window.document.querySelector('[data-action="v034-update-all"]'));
  assert.ok(dom.window.document.querySelector('[data-property-id="101"] [data-action="v034-update-property"]'));
  assert.match(dom.window.document.querySelector('[data-property-id="101"]').textContent, /Last updated/i);
});

test('individual UPDATE refreshes only that property and persists the new snapshot timestamp', async () => {
  const { dom, storage, controller, calls } = createV034Controller();
  const button = dom.window.document.querySelector('[data-property-id="101"] [data-action="v034-update-property"]');
  button.click();
  await settle(dom);

  assert.equal(calls.owned, 1);
  assert.deepEqual(calls.markets, [{ ids: [101], force: true }]);
  const saved = UpdateCore.loadSnapshot(storage);
  assert.ok(saved.propertyUpdatedAt['101'] > 1000);
  assert.equal(saved.properties.length, 3);
});

test('settings expose automatic page update and read-only 80 per minute API safety information', () => {
  const { dom, controller } = createV034Controller();
  controller.openSettings();
  const settings = dom.window.document.querySelector('#r4g3-prm-settings-window');
  assert.ok(settings.querySelector('[data-role="auto-page-update-input"]'));
  assert.match(settings.textContent, /80\s*\/\s*minute/i);
  assert.match(settings.textContent, /750\s*ms/i);
});

test('bootstrap initial update is manual by default and runs once when automatic page update is enabled', async () => {
  assert.equal(typeof Bootstrap.runInitialUpdate, 'function');
  let calls = 0;
  const off = {
    getUpdateSettings() { return { autoPageUpdate: false }; },
    async updateAll() { calls += 1; }
  };
  const on = {
    getUpdateSettings() { return { autoPageUpdate: true }; },
    async updateAll() { calls += 1; }
  };

  assert.equal(await Bootstrap.runInitialUpdate(off), false);
  assert.equal(calls, 0);
  assert.equal(await Bootstrap.runInitialUpdate(on), true);
  assert.equal(calls, 1);
});

test('native rental cancellation finds Torn Remove from market and clicks only from explicit matching user gesture', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="market"><button id="native-remove">Remove from market</button></div>
    <aside id="r4g3-prm-panel"><button>Cancel Listing</button></aside>
  </body></html>`, { url: 'https://www.torn.com/properties.php#/p=options&ID=201&tab=lease' });
  let clicks = 0;
  dom.window.document.querySelector('#native-remove').addEventListener('click', () => { clicks += 1; });

  assert.equal(typeof FormCore.findRentalCancelButton, 'function');
  assert.equal(typeof FormCore.canCancelRentalListing, 'function');
  assert.equal(typeof FormCore.cancelRentalListingFromUserGesture, 'function');
  assert.equal(FormCore.findRentalCancelButton(dom.window.document).id, 'native-remove');
  assert.equal(FormCore.canCancelRentalListing({ document: dom.window.document, location: dom.window.location, propertyId: 201 }), true);

  const wrong = FormCore.cancelRentalListingFromUserGesture({ document: dom.window.document, location: dom.window.location, propertyId: 999 });
  assert.equal(wrong.submitted, false);
  assert.equal(clicks, 0);

  const result = FormCore.cancelRentalListingFromUserGesture({ document: dom.window.document, location: dom.window.location, propertyId: 201 });
  assert.equal(result.submitted, true);
  assert.equal(clicks, 1);
});

test('for-rent property uses two explicit cancel clicks and does not auto-refresh after cancellation', async () => {
  const { dom, controller, calls, setNativeCancelReady } = createV034Controller();
  let card = dom.window.document.querySelector('[data-property-id="201"]');
  let cancel = card.querySelector('[data-action="v034-cancel-listing"]');
  assert.ok(cancel);
  assert.match(cancel.textContent, /CANCEL LISTING/i);

  cancel.click();
  await settle(dom);
  assert.deepEqual(calls.prepareCancel, [201]);
  assert.deepEqual(calls.cancel, []);
  assert.equal(calls.owned, 0);

  setNativeCancelReady(true);
  controller.render();
  await settle(dom);
  card = dom.window.document.querySelector('[data-property-id="201"]');
  cancel = card.querySelector('[data-action="v034-cancel-listing"]');
  assert.match(cancel.textContent, /CONFIRM CANCEL LISTING/i);
  cancel.click();
  await settle(dom);

  assert.deepEqual(calls.cancel, [201]);
  assert.equal(calls.owned, 0);
  card = dom.window.document.querySelector('[data-property-id="201"]');
  assert.match(card.textContent, /CANCELLATION SENT/i);
  assert.match(card.textContent, /UPDATE PROPERTY/i);
});

test('already rented property never offers listing cancellation', () => {
  const { dom } = createV034Controller();
  const rented = dom.window.document.querySelector('[data-property-id="102"]');
  assert.equal(rented.querySelector('[data-action="v034-cancel-listing"]'), null);
  assert.match(rented.textContent, /active lease cannot be cancelled/i);
});
