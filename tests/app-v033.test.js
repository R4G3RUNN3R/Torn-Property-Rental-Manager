'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const App = require('../src/app-v033');
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

function properties() {
  return [
    { id: 101, property: { id: 13, name: 'Private Island' }, owner: { id: 1 }, happy: 4500, status: 'none', modifications: [] },
    { id: 102, property: { id: 13, name: 'Private Island' }, owner: { id: 1 }, happy: 4200, status: 'rented', modifications: [] },
    { id: 201, property: { id: 10, name: 'Castle' }, owner: { id: 1 }, happy: 5000, status: 'for_rent', modifications: ['Hot Tub'] }
  ];
}

function rentals() {
  return [
    { modifications: [], cost: 90_000, rental_period: 30, cost_per_day: 3000 },
    { modifications: [], cost: 210_000, rental_period: 60, cost_per_day: 3500 },
    { modifications: [], cost: 400_000, rental_period: 100, cost_per_day: 4000 }
  ];
}

function makeController(options = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
  Object.defineProperty(dom.window, 'innerWidth', { value: 1024, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 768, configurable: true });
  const storage = memoryStorage();
  const listCalls = [];
  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClient: {
      async fetchOwnedProperties() { return properties(); },
      async scanMarkets() {
        return {
          13: { rentals: rentals(), fromCache: false },
          10: { rentals: [{ modifications: ['Hot Tub'], cost: 500_000, rental_period: 100, cost_per_day: 5000 }], fromCache: true }
        };
      }
    },
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: { save(d) { return d; }, loadFor() { return null; }, clear() {} },
    navigate() {},
    canListProperty(id) { return id === 101; },
    listProperty(id) {
      listCalls.push(id);
      return options.listFails ? { submitted: false } : { submitted: true, propertyId: id };
    }
  });
  return { dom, storage, controller, listCalls };
}

async function settle(dom) {
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  await new Promise(resolve => dom.window.setTimeout(resolve, 0));
}

test('gear opens a separate settings window with every pricing basis and API controls at the bottom', async () => {
  const { dom, controller } = makeController();
  await controller.load();
  await settle(dom);

  const gear = dom.window.document.querySelector('[data-action="v033-settings"]');
  assert.ok(gear);
  assert.match(gear.textContent, /⚙/);
  assert.equal(dom.window.document.querySelector('#r4g3-prm-panel .r4g3-prm-settings'), null);

  gear.click();
  const settings = dom.window.document.querySelector('#r4g3-prm-settings-window');
  assert.ok(settings);
  const basis = settings.querySelector('[data-role="pricing-basis-select"]');
  assert.deepEqual([...basis.options].map(option => option.value), ['lowest', 'median', 'average', 'highest']);
  assert.equal(settings.lastElementChild.getAttribute('data-role'), 'api-settings');
  assert.equal(settings.querySelector('[data-role="api-key-input"]').value, '');
});

test('changing to highest market price recalculates immediately without another market scan', async () => {
  const { dom, controller } = makeController();
  await controller.load();
  controller.openSettings();
  const settings = dom.window.document.querySelector('#r4g3-prm-settings-window');
  settings.querySelector('[data-role="pricing-basis-select"]').value = 'highest';
  settings.querySelector('[data-role="undercut-input"]').value = '0.5';
  settings.querySelector('[data-action="v033-save-settings"]').click();
  await settle(dom);

  const row = dom.window.document.querySelector('[data-property-id="101"]');
  assert.match(row.textContent, /Proposed 100-day rent:\s*\$398,000/i);
  assert.match(row.textContent, /Highest market price\s*−\s*0\.5%/i);
});

test('successful listing moves the property to the absolute bottom and marks it listed', async () => {
  const { dom, controller, listCalls } = makeController();
  await controller.load();
  await settle(dom);

  dom.window.document.querySelector('[data-property-id="101"] [data-action="list-property"]').click();
  await settle(dom);
  assert.deepEqual(listCalls, [101]);
  const cards = [...dom.window.document.querySelectorAll('#r4g3-prm-panel [data-property-id]')];
  assert.equal(cards.at(-1).getAttribute('data-property-id'), '101');
  assert.match(cards.at(-1).textContent, /LISTED FOR RENT/i);
  assert.equal(cards.at(-1).querySelector('[data-action="list-property"]'), null);
});

test('failed listing does not change property order or mark it listed', async () => {
  const { dom, controller } = makeController({ listFails: true });
  await controller.load();
  await settle(dom);
  const before = [...dom.window.document.querySelectorAll('#r4g3-prm-panel [data-property-id]')].map(x => x.getAttribute('data-property-id'));
  dom.window.document.querySelector('[data-property-id="101"] [data-action="list-property"]').click();
  await settle(dom);
  const after = [...dom.window.document.querySelectorAll('#r4g3-prm-panel [data-property-id]')].map(x => x.getAttribute('data-property-id'));
  assert.deepEqual(after, before);
  assert.doesNotMatch(dom.window.document.querySelector('[data-property-id="101"]').textContent, /LISTED FOR RENT/i);
});

test('entire desktop header acts as a drag surface while controls are excluded', async () => {
  const { dom, controller, storage } = makeController();
  await controller.load();
  await settle(dom);
  const panel = dom.window.document.querySelector('#r4g3-prm-panel');
  const header = panel.querySelector('.r4g3-prm-header');
  assert.equal(header.getAttribute('data-role'), 'window-drag-surface');
  assert.equal(header.querySelector('[data-action="v033-settings"]').getAttribute('data-no-drag'), 'true');

  header.dispatchEvent(new dom.window.MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 50, clientY: 50 }));
  dom.window.dispatchEvent(new dom.window.MouseEvent('mousemove', { bubbles: true, clientX: 120, clientY: 100 }));
  dom.window.dispatchEvent(new dom.window.MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 100 }));
  assert.notEqual(panel.style.left, '32px');
  assert.ok(App.loadSettings(storage).geometry.left >= 0);
});

test('settings window is independently movable/resizable and appearance controls can hide images', async () => {
  const { dom, controller } = makeController();
  await controller.load();
  controller.openSettings();
  const settings = dom.window.document.querySelector('#r4g3-prm-settings-window');
  assert.equal(settings.style.resize, 'both');
  assert.ok(settings.querySelector('[data-role="settings-drag-handle"]'));

  const images = settings.querySelector('[data-role="show-images-input"]');
  images.checked = false;
  settings.querySelector('[data-action="v033-save-settings"]').click();
  await settle(dom);
  assert.equal(dom.window.document.querySelector('[data-property-id="101"] [data-role="property-image"]'), null);
});
