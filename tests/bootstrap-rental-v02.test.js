'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

const FormCore = require('../src/form-core');
global.R4G3FormCore = FormCore;
global.R4G3ApiCore = { API_ORIGIN: 'https://api.torn.com' };
const Bootstrap = require('../src/bootstrap');

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

test('lease preparer fills the matching form but keeps the draft armed for LIST PROPERTY', () => {
  const dom = leaseDom(101);
  const draft = { propertyId: 101, days: 100, totalCost: 331_667, dailyPrice: 3316 };
  let clears = 0;
  let preparedCalls = 0;
  const draftStore = {
    loadFor(id) { return id === 101 ? draft : null; },
    clear() { clears += 1; }
  };
  const preparer = Bootstrap.createLeasePreparer({
    window: dom.window,
    document: dom.window.document,
    draftStore,
    onPrepared() { preparedCalls += 1; }
  });

  const result = preparer.prepareOnce();
  assert.equal(result.prepared, true);
  assert.equal(clears, 0);
  assert.equal(preparedCalls, 1);
  assert.equal(dom.window.document.querySelector('li.amount input').value, '100');
  assert.equal(dom.window.document.querySelector('li.cost input').value, '331667');
});

test('lease lister arms only for matching route/draft/form and clears after one explicit list action', () => {
  const dom = leaseDom(101);
  const draft = { propertyId: 101, days: 100, totalCost: 331_667, dailyPrice: 3316 };
  let clears = 0;
  let clicks = 0;
  dom.window.document.querySelector('li.submit button').addEventListener('click', event => {
    clicks += 1;
    event.preventDefault();
  });
  const draftStore = {
    loadFor(id) { return id === 101 ? draft : null; },
    clear() { clears += 1; }
  };
  const lister = Bootstrap.createLeaseLister({
    window: dom.window,
    document: dom.window.document,
    draftStore
  });

  assert.equal(lister.canList(999), false);
  assert.equal(lister.canList(101), true);

  const result = lister.list(101);
  assert.equal(result.submitted, true);
  assert.equal(clicks, 1);
  assert.equal(clears, 1);
});

test('lease lister never submits automatically merely because it is armed', () => {
  const dom = leaseDom(101);
  const draft = { propertyId: 101, days: 100, totalCost: 331_667, dailyPrice: 3316 };
  let clicks = 0;
  dom.window.document.querySelector('li.submit button').addEventListener('click', event => {
    clicks += 1;
    event.preventDefault();
  });
  const lister = Bootstrap.createLeaseLister({
    window: dom.window,
    document: dom.window.document,
    draftStore: { loadFor() { return draft; }, clear() {} }
  });

  assert.equal(lister.canList(101), true);
  assert.equal(clicks, 0);
});
