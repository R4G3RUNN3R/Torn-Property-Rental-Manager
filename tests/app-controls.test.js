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

function ownedRows() {
  return [{
    id: 101,
    property: { id: 13, name: 'Private Island' },
    owner: { id: 3877028 },
    happy: 4500,
    status: 'none',
    modifications: []
  }];
}

function rentals() {
  return [
    { modifications: [], cost: 90_000, rental_period: 30, cost_per_day: 3000 },
    { modifications: [], cost: 210_000, rental_period: 60, cost_per_day: 3500 },
    { modifications: [], cost: 400_000, rental_period: 100, cost_per_day: 4000 }
  ];
}

function makeController(options = {}) {
  const dom = makeDom(options.width || 1024);
  const scanOptions = [];
  const storage = options.storage || memoryStorage();
  const apiClient = {
    async fetchOwnedProperties() { return ownedRows(); },
    async scanMarkets(_properties, optionsArg) {
      scanOptions.push(optionsArg || {});
      return { 13: { rentals: rentals(), rentals_timestamp: 123, fromCache: false } };
    }
  };
  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClient,
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: { save(d) { return d; }, loadFor() { return null; }, clear() {} },
    navigate() {},
    canListProperty() { return false; },
    listProperty() { return { submitted: false }; }
  });
  return { dom, controller, scanOptions, storage };
}

test('Refresh uses fresh rental cache while Force Market Refresh bypasses it', async () => {
  const { dom, controller, scanOptions } = makeController();
  await controller.load();
  assert.equal(scanOptions[0].force, false);

  const refresh = dom.window.document.querySelector('[data-action="refresh"]');
  assert.ok(refresh);
  refresh.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  assert.equal(scanOptions.length, 2);
  assert.equal(scanOptions[1].force, false);

  controller.openSettings();
  const force = dom.window.document.querySelector('[data-action="force-refresh"]');
  assert.ok(force);
  force.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  assert.equal(scanOptions.length, 3);
  assert.equal(scanOptions[2].force, true);
});

test('settings expose fixed 100-day period and changing undercut recalculates proposed rent', async () => {
  const { dom, controller } = makeController();
  await controller.load();
  controller.openSettings();

  const panel = dom.window.document.querySelector('#r4g3-prm-panel');
  assert.match(panel.textContent, /Rental period:\s*100 days/i);
  assert.equal(dom.window.document.querySelector('[data-role="days-input"]'), null);

  const undercut = dom.window.document.querySelector('[data-role="undercut-input"]');
  assert.ok(undercut);
  undercut.value = '1';
  const save = dom.window.document.querySelector('[data-action="save-settings"]');
  save.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  const row = dom.window.document.querySelector('[data-property-id="101"]');
  assert.match(row.textContent, /Proposed 100-day rent:\s*\$346,500/i);
});

test('theme toggle persists and dark theme keeps readable green accent', async () => {
  const { dom, controller, storage } = makeController();
  await controller.load();
  const darkPanel = dom.window.document.querySelector('#r4g3-prm-panel');
  assert.equal(darkPanel.classList.contains('r4g3-prm-theme-dark'), true);
  assert.match(darkPanel.querySelector('[data-role="drag-handle"]').style.color, /rgb\(116, 255, 139\)|#74ff8b/i);

  const theme = darkPanel.querySelector('[data-action="toggle-theme"]');
  theme.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  const lightPanel = dom.window.document.querySelector('#r4g3-prm-panel');
  assert.equal(lightPanel.classList.contains('r4g3-prm-theme-light'), true);
  assert.equal(App.loadSettings(storage).theme, 'light');
});

test('desktop shell is movable and resizable', async () => {
  const { dom, controller } = makeController();
  await controller.load();
  const panel = dom.window.document.querySelector('#r4g3-prm-panel');
  const handle = dom.window.document.querySelector('[data-role="drag-handle"]');
  assert.equal(panel.style.resize, 'both');
  assert.ok(handle);
  assert.equal(handle.style.cursor, 'move');
});

test('minimize and close persist UI state and controller can restore the panel', async () => {
  const { dom, controller, storage } = makeController();
  await controller.load();

  let panel = dom.window.document.querySelector('#r4g3-prm-panel');
  const minimize = panel.querySelector('[data-action="minimize"]');
  const close = panel.querySelector('[data-action="close"]');
  assert.ok(minimize);
  assert.ok(close);

  minimize.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  panel = dom.window.document.querySelector('#r4g3-prm-panel');
  assert.equal(App.loadSettings(storage).uiState, 'minimized');
  assert.equal(panel.querySelector('[data-property-id="101"]'), null);

  controller.open();
  panel = dom.window.document.querySelector('#r4g3-prm-panel');
  assert.equal(App.loadSettings(storage).uiState, 'open');
  assert.ok(panel.querySelector('[data-property-id="101"]'));

  panel.querySelector('[data-action="close"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(App.loadSettings(storage).uiState, 'closed');
  assert.equal(dom.window.document.querySelector('#r4g3-prm-panel'), null);

  controller.open();
  assert.ok(dom.window.document.querySelector('#r4g3-prm-panel'));
  assert.equal(App.loadSettings(storage).uiState, 'open');
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
