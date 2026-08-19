'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const DraftCore = require('../src/draft-core');
const FormCore = require('../src/form-core');

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

test('draft store preserves an exact 100-day total rather than recomputing from rounded daily price', () => {
  const store = DraftCore.createStore(memoryStorage(), { now: () => 1000 });
  const saved = store.save({
    propertyId: 101,
    days: 100,
    totalCost: 331_667
  });

  assert.equal(saved.days, 100);
  assert.equal(saved.totalCost, 331_667);
  assert.equal(store.loadFor(101).totalCost, 331_667);
});

test('SET PRICE preparation fills 100 days and the exact proposed total cost', () => {
  const dom = leaseDom(101);
  const result = FormCore.prepareLeaseForm({
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    draft: {
      propertyId: 101,
      days: 100,
      totalCost: 331_667,
      dailyPrice: 3316
    }
  });

  assert.equal(result.prepared, true);
  assert.equal(result.days, 100);
  assert.equal(result.totalCost, 331_667);
  assert.equal(dom.window.document.querySelector('li.amount input').value, '100');
  assert.equal(dom.window.document.querySelector('li.cost input').value, '331667');
});

test('LIST PROPERTY user gesture clicks the native submit exactly once for the matching property', () => {
  const dom = leaseDom(101);
  const draft = { propertyId: 101, days: 100, totalCost: 331_667, dailyPrice: 3316 };
  FormCore.prepareLeaseForm({
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    draft
  });

  const native = dom.window.document.querySelector('li.submit button');
  let clicks = 0;
  native.addEventListener('click', event => {
    clicks += 1;
    event.preventDefault();
  });

  const result = FormCore.submitLeaseFromUserGesture({
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    draft
  });

  assert.equal(result.submitted, true);
  assert.equal(result.propertyId, 101);
  assert.equal(clicks, 1);
});

test('LIST PROPERTY refuses to click anything for a different property', () => {
  const dom = leaseDom(101);
  const native = dom.window.document.querySelector('li.submit button');
  let clicks = 0;
  native.addEventListener('click', event => {
    clicks += 1;
    event.preventDefault();
  });

  const result = FormCore.submitLeaseFromUserGesture({
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    draft: { propertyId: 999, days: 100, totalCost: 331_667, dailyPrice: 3316 }
  });

  assert.equal(result.submitted, false);
  assert.equal(clicks, 0);
});
