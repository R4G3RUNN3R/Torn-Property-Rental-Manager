'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const AppV034 = require('../src/app-v034');
const UpdateCore = require('../src/update-core-v034');
const PropertyCore = require('../src/property-core');
const MarketCore = require('../src/market-core');
const FormCore = require('../src/form-core');

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

function market(cost) {
  return {
    rentals: [{ id: cost, modifications: [], cost, rental_period: 100, cost_per_day: cost / 100 }],
    fetchedAt: 1000,
    fromCache: false
  };
}

function sameTypeRawProperties() {
  return [
    { id: 101, property: { id: 13, name: 'Private Island' }, owner: { id: 1 }, happy: 4500, status: 'none', modifications: [] },
    { id: 103, property: { id: 13, name: 'Private Island' }, owner: { id: 1 }, happy: 4200, status: 'none', modifications: [] },
    { id: 201, property: { id: 11, name: 'Palace' }, owner: { id: 1 }, happy: 4800, status: 'for_rent', cost: 500000, rental_period: 100, modifications: [] }
  ];
}

function seedSnapshot(storage) {
  const properties = PropertyCore.normalizeProperties(sameTypeRawProperties(), 1);
  UpdateCore.saveSnapshot(storage, {
    properties,
    markets: { 13: market(300000), 11: market(500000) },
    updatedAt: 1000,
    propertyUpdatedAt: { 101: 1000, 103: 1000, 201: 1000 }
  });
}

function createController(options = {}) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.torn.com/properties.php'
  });
  Object.defineProperty(dom.window, 'innerWidth', { value: 1100, configurable: true });
  Object.defineProperty(dom.window, 'innerHeight', { value: 800, configurable: true });

  const storage = memoryStorage();
  seedSnapshot(storage);
  const calls = { owned: 0, markets: [], nativeRemove: 0, nativeConfirm: 0 };

  let resolveMarket;
  const marketGate = options.delayMarket
    ? new Promise(resolve => { resolveMarket = resolve; })
    : null;

  const apiClient = {
    async fetchCurrentUserId() { return 1; },
    async fetchOwnedProperties() {
      calls.owned += 1;
      return sameTypeRawProperties();
    },
    async scanMarkets(properties, scanOptions) {
      calls.markets.push(properties.map(property => Number(property.id)));
      if (typeof scanOptions.onProgress === 'function') {
        scanOptions.onProgress({ id: 13, done: 0, total: 1, phase: 'market' });
      }
      if (marketGate) await marketGate;
      const result = {};
      for (const property of properties) result[property.propertyTypeId] = market(900000);
      if (typeof scanOptions.onProgress === 'function') {
        scanOptions.onProgress({ id: 13, done: 1, total: 1, market: result[13], phase: 'market' });
      }
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
    draftStore: { save(value) { return value; }, loadFor() { return null; }, clear() {} },
    navigate() {},
    canListProperty() { return false; },
    listProperty() { return { submitted: false }; },
    prepareCancelProperty(id) {
      dom.window.location.hash = `#/p=options&ID=${Number(id)}&tab=lease`;
      return { prepared: true, propertyId: Number(id) };
    },
    canCancelProperty(id) {
      return FormCore.canCancelRentalListing({ document: dom.window.document, location: dom.window.location, propertyId: id });
    },
    cancelProperty(id) {
      return FormCore.cancelRentalListingFromUserGesture({ document: dom.window.document, location: dom.window.location, propertyId: id });
    },
    canConfirmCancelProperty(id) {
      return FormCore.canConfirmRentalCancellation({ document: dom.window.document, location: dom.window.location, propertyId: id });
    },
    confirmCancelProperty(id) {
      return FormCore.confirmRentalCancellationFromUserGesture({ document: dom.window.document, location: dom.window.location, propertyId: id });
    }
  });

  return {
    dom,
    storage,
    controller,
    calls,
    releaseMarket() { if (resolveMarket) resolveMarket(); }
  };
}

async function settle(dom, turns = 3) {
  for (let i = 0; i < turns; i += 1) {
    await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  }
}

test('real gear click exposes persistent MANUAL and AUTOMATIC update mode buttons', async () => {
  const { dom, controller } = createController();
  const gear = dom.window.document.querySelector('[data-action="v033-settings"]');
  assert.ok(gear, 'gear button should exist');

  gear.click();
  await settle(dom);

  const settings = dom.window.document.querySelector('#r4g3-prm-settings-window');
  assert.ok(settings, 'settings window should open from the actual gear button');
  const manual = settings.querySelector('[data-action="v035-update-mode-manual"]');
  const automatic = settings.querySelector('[data-action="v035-update-mode-automatic"]');
  assert.ok(manual, 'manual update mode button should be visible');
  assert.ok(automatic, 'automatic update mode button should be visible');
  assert.equal(manual.getAttribute('aria-pressed'), 'true');

  automatic.click();
  await settle(dom);
  assert.equal(controller.getUpdateSettings().autoPageUpdate, true);

  const reopenedGear = dom.window.document.querySelector('[data-action="v033-settings"]');
  reopenedGear.click();
  await settle(dom);
  const reopened = dom.window.document.querySelector('#r4g3-prm-settings-window');
  assert.equal(reopened.querySelector('[data-action="v035-update-mode-automatic"]').getAttribute('aria-pressed'), 'true');
});

test('individual UPDATE shows a progress bar only on the selected property while its search is running', async () => {
  const { dom, releaseMarket } = createController({ delayMarket: true });
  const selectedButton = dom.window.document.querySelector('[data-property-id="101"] [data-action="v034-update-property"]');
  selectedButton.click();
  await settle(dom);

  const selected = dom.window.document.querySelector('[data-property-id="101"]');
  const untouched = dom.window.document.querySelector('[data-property-id="103"]');
  const progress = selected.querySelector('[data-role="v035-update-progress"]');
  const progressExists = Boolean(progress);
  const progressBarExists = Boolean(progress && progress.querySelector('[role="progressbar"]'));
  const untouchedProgressExists = Boolean(untouched.querySelector('[data-role="v035-update-progress"]'));

  releaseMarket();
  await settle(dom, 5);

  assert.equal(progressExists, true, 'selected property should show update progress');
  assert.equal(progressBarExists, true);
  assert.equal(untouchedProgressExists, false);
  assert.equal(dom.window.document.querySelector('[data-property-id="101"] [data-role="v035-update-progress"]'), null);
});

test('individual UPDATE keeps another property of the same type on its previous market snapshot', async () => {
  const { controller } = createController();
  const before = controller.getState().rows.find(entry => Number(entry.property.id) === 103);
  const beforeProposed = before.quote.proposedTotal;
  const beforeMarketCost = before.market.rentals[0].cost;

  await controller.updateProperty(101);

  const selected = controller.getState().rows.find(entry => Number(entry.property.id) === 101);
  const untouched = controller.getState().rows.find(entry => Number(entry.property.id) === 103);
  assert.equal(selected.market.rentals[0].cost, 900000);
  assert.equal(untouched.market.rentals[0].cost, beforeMarketCost);
  assert.equal(untouched.quote.proposedTotal, beforeProposed);
});

test('cancel listing notices Torn native Remove from market when it appears later and outside an unrelated #market node', async () => {
  const { dom } = createController();
  const cancel = dom.window.document.querySelector('[data-property-id="201"] [data-action="v034-cancel-listing"]');
  cancel.click();
  await settle(dom);

  const unrelated = dom.window.document.createElement('div');
  unrelated.id = 'market';
  dom.window.document.body.appendChild(unrelated);
  const lease = dom.window.document.createElement('section');
  lease.id = 'lease-options';
  lease.innerHTML = '<button id="native-remove">Remove from market</button>';
  dom.window.document.body.appendChild(lease);
  await settle(dom, 5);

  const ready = dom.window.document.querySelector('[data-property-id="201"] [data-action="v034-cancel-listing"]');
  assert.match(ready.textContent, /CONFIRM CANCEL LISTING/i);
  assert.equal(ready.disabled, false);
});

test('cancel listing can complete Torn native confirmation through a third explicit script click', async () => {
  const { dom, calls } = createController();
  let cancel = dom.window.document.querySelector('[data-property-id="201"] [data-action="v034-cancel-listing"]');
  cancel.click();
  await settle(dom);

  const nativeRemove = dom.window.document.createElement('button');
  nativeRemove.id = 'native-remove';
  nativeRemove.textContent = 'Remove from market';
  nativeRemove.addEventListener('click', () => {
    calls.nativeRemove += 1;
    const dialog = dom.window.document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.innerHTML = '<p>Are you sure you want to remove this property from the market?</p><button id="native-confirm">Yes</button>';
    dialog.querySelector('#native-confirm').addEventListener('click', () => { calls.nativeConfirm += 1; });
    dom.window.document.body.appendChild(dialog);
  });
  dom.window.document.body.appendChild(nativeRemove);
  await settle(dom, 5);

  cancel = dom.window.document.querySelector('[data-property-id="201"] [data-action="v034-cancel-listing"]');
  cancel.click();
  await settle(dom, 5);
  assert.equal(calls.nativeRemove, 1);

  cancel = dom.window.document.querySelector('[data-property-id="201"] [data-action="v034-cancel-listing"]');
  assert.match(cancel.textContent, /FINAL CONFIRM CANCEL/i);
  assert.equal(cancel.disabled, false);
  cancel.click();
  await settle(dom, 3);

  assert.equal(calls.nativeConfirm, 1);
  const card = dom.window.document.querySelector('[data-property-id="201"]');
  assert.match(card.textContent, /CANCELLATION SENT/i);
  assert.match(card.textContent, /UPDATE PROPERTY/i);
});

test('native cancellation confirmation helper only clicks confirmation inside a remove-from-market dialog', () => {
  const dom = new JSDOM(`<!doctype html><html><body>
    <button id="unrelated">Yes</button>
    <div role="dialog" id="cancel-dialog">
      <p>Are you sure you want to remove this property from the market?</p>
      <button id="confirm">Yes</button>
    </div>
  </body></html>`, { url: 'https://www.torn.com/properties.php#/p=options&ID=201&tab=lease' });
  let unrelatedClicks = 0;
  let confirmClicks = 0;
  dom.window.document.querySelector('#unrelated').addEventListener('click', () => { unrelatedClicks += 1; });
  dom.window.document.querySelector('#confirm').addEventListener('click', () => { confirmClicks += 1; });

  assert.equal(typeof FormCore.findRentalCancelConfirmationButton, 'function');
  assert.equal(typeof FormCore.canConfirmRentalCancellation, 'function');
  assert.equal(typeof FormCore.confirmRentalCancellationFromUserGesture, 'function');
  assert.equal(FormCore.findRentalCancelConfirmationButton(dom.window.document).id, 'confirm');
  assert.equal(FormCore.canConfirmRentalCancellation({ document: dom.window.document, location: dom.window.location, propertyId: 201 }), true);

  const result = FormCore.confirmRentalCancellationFromUserGesture({ document: dom.window.document, location: dom.window.location, propertyId: 201 });
  assert.equal(result.submitted, true);
  assert.equal(confirmClicks, 1);
  assert.equal(unrelatedClicks, 0);
});
