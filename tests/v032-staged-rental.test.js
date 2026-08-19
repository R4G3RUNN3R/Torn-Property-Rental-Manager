'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const FormCore = require('../src/form-core');
const DraftCore = require('../src/draft-core');
const PropertyCore = require('../src/property-core');
const MarketCore = require('../src/market-core');
const App = require('../src/app');

global.R4G3FormCore = FormCore;
global.R4G3ApiCore = { API_ORIGIN: 'https://api.torn.com' };
const Bootstrap = require('../src/bootstrap');

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

function leaseDom(propertyId = 101) {
  return new JSDOM(`<!doctype html><html><body>
    <div id="market">
      <form>
        <ul class="lease-input">
          <li class="amount"><input class="input-money" type="text" value="30"></li>
          <li class="cost"><input class="lease input-money" type="text" value="0"></li>
          <li class="submit"><button type="submit">List Property</button></li>
        </ul>
      </form>
    </div>
  </body></html>`, {
    url: `https://www.torn.com/properties.php#/p=options&ID=${propertyId}&tab=lease`
  });
}

function draft() {
  return { propertyId: 101, days: 100, totalCost: 331_667, dailyPrice: 3316 };
}

function makeController(canListProperty = () => true) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.torn.com/properties.php#/p=options&ID=101&tab=lease'
  });
  const storage = memoryStorage();
  const apiClient = {
    async fetchOwnedProperties() {
      return [{
        id: 101,
        property: { id: 13, name: 'Private Island' },
        owner: { id: 3877028 },
        status: 'none',
        modifications: []
      }];
    },
    async scanMarkets() {
      return {
        13: {
          rentals: [
            { modifications: [], cost: 300_000, rental_period: 100 },
            { modifications: [], cost: 400_000, rental_period: 100 }
          ],
          fromCache: false
        }
      };
    }
  };

  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClient,
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: DraftCore.createStore(memoryStorage()),
    navigate() {},
    canListProperty,
    listProperty() { return { submitted: false }; }
  });
  return { dom, controller };
}

test('lease preparation dispatches input change keyup and blur for both native Torn fields', () => {
  const dom = leaseDom();
  const days = dom.window.document.querySelector('li.amount input');
  const cost = dom.window.document.querySelector('li.cost input');
  const seen = { days: [], cost: [] };

  for (const name of ['input', 'change', 'keyup', 'blur']) {
    days.addEventListener(name, () => seen.days.push(name));
    cost.addEventListener(name, () => seen.cost.push(name));
  }

  const result = FormCore.prepareLeaseForm({
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    draft: draft()
  });

  assert.equal(result.prepared, true);
  assert.deepEqual(seen.days, ['input', 'change', 'keyup', 'blur']);
  assert.deepEqual(seen.cost, ['input', 'change', 'keyup', 'blur']);
});

test('prepared lease verification accepts Torn formatting but rejects changed values', () => {
  const dom = leaseDom();
  const preparedDraft = draft();
  FormCore.prepareLeaseForm({
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    draft: preparedDraft
  });

  const cost = dom.window.document.querySelector('li.cost input');
  cost.value = '$331,667';
  const exact = FormCore.verifyPreparedLeaseForm({
    document: dom.window.document,
    window: dom.window,
    location: dom.window.location,
    draft: preparedDraft
  });
  assert.equal(exact.verified, true);

  cost.value = '400000';
  const changed = FormCore.verifyPreparedLeaseForm({
    document: dom.window.document,
    window: dom.window,
    location: dom.window.location,
    draft: preparedDraft
  });
  assert.equal(changed.verified, false);
  assert.match(changed.reason, /changed|prepare/i);
});

test('LIST PROPERTY refuses altered Torn values without restoring or clicking them', () => {
  const dom = leaseDom();
  const preparedDraft = draft();
  FormCore.prepareLeaseForm({
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    draft: preparedDraft
  });

  const cost = dom.window.document.querySelector('li.cost input');
  cost.value = '400000';
  let clicks = 0;
  dom.window.document.querySelector('li.submit button').addEventListener('click', event => {
    clicks += 1;
    event.preventDefault();
  });

  const result = FormCore.submitLeaseFromUserGesture({
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    draft: preparedDraft
  });

  assert.equal(result.submitted, false);
  assert.match(result.reason, /changed|prepare/i);
  assert.equal(cost.value, '400000', 'submission must never silently restore a changed price');
  assert.equal(clicks, 0);
});

test('bootstrap lister is armed only while the visible Torn form still matches the prepared draft', () => {
  const dom = leaseDom();
  const storage = memoryStorage();
  const store = DraftCore.createStore(storage, { now: () => 1000 });
  store.save(draft());
  FormCore.prepareLeaseForm({
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    draft: store.loadFor(101)
  });

  const lister = Bootstrap.createLeaseLister({
    window: dom.window,
    document: dom.window.document,
    draftStore: store
  });

  assert.equal(lister.canList(101), true);
  dom.window.document.querySelector('li.amount input').value = '99';
  assert.equal(lister.canList(101), false);

  const result = lister.list(101);
  assert.equal(result.submitted, false);
  assert.match(result.reason, /changed|prepare|ready/i);
  assert.ok(store.loadFor(101), 'a failed verification must keep the draft available for re-preparation');
});

test('eligible property row uses PREPARE RENTAL and shows READY TO LIST when Torn form is armed', async () => {
  const { dom, controller } = makeController(() => true);
  await controller.load();
  Bootstrap.decorateRentalActions({
    document: dom.window.document,
    canListProperty: () => true
  });

  const row = dom.window.document.querySelector('[data-property-id="101"]');
  const prepare = row.querySelector('[data-action="set-price"]');
  const list = row.querySelector('[data-action="list-property"]');

  assert.equal(prepare.textContent, 'PREPARE RENTAL');
  assert.equal(list.disabled, false);
  assert.match(row.textContent, /READY TO LIST/i);
  assert.match(row.textContent, /100 days/i);
});
