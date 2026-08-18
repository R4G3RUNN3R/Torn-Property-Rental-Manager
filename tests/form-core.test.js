'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const FormCore = require('../src/form-core');

function makeDom(url = 'https://www.torn.com/properties.php#/p=options&ID=7&tab=lease') {
  return new JSDOM(`<!doctype html><html><body>
    <div id="market">
      <ul class="lease-input">
        <li class="amount"><input class="input-money" /></li>
        <li class="cost"><input class="lease input-money" /></li>
      </ul>
      <button id="native-submit" type="button">Lease</button>
    </div>
  </body></html>`, { url });
}

test('parses property id only from native lease route', () => {
  assert.equal(FormCore.parseLeasePropertyId({ hash: '#/p=options&ID=7&tab=lease' }), 7);
  assert.equal(FormCore.parseLeasePropertyId({ hash: '#/p=options&ID=7&tab=details' }), null);
  assert.equal(FormCore.parseLeasePropertyId({ hash: '#/p=options&ID=0&tab=lease' }), null);
});

test('finds the visible lease day and cost inputs', () => {
  const dom = makeDom();
  const form = FormCore.findLeaseForm(dom.window.document);
  assert.ok(form);
  assert.equal(form.daysInput.matches('li.amount input.input-money'), true);
  assert.equal(form.costInput.matches('li.cost input.lease.input-money'), true);
});

test('prepares days and total cost while dispatching input/change events', () => {
  const dom = makeDom();
  const { document } = dom.window;
  const days = document.querySelector('li.amount input');
  const cost = document.querySelector('li.cost input');
  const submit = document.querySelector('#native-submit');
  let daysEvents = 0;
  let costEvents = 0;
  let clicked = false;

  for (const eventName of ['input', 'change']) {
    days.addEventListener(eventName, () => { daysEvents += 1; });
    cost.addEventListener(eventName, () => { costEvents += 1; });
  }
  submit.click = () => { clicked = true; };

  const result = FormCore.prepareLeaseForm({
    document,
    window: dom.window,
    location: dom.window.location,
    draft: {
      propertyId: 7,
      days: 30,
      dailyPrice: 100,
      totalCost: 3000,
      marketFloor: 110,
      median: 120,
      confidence: 'High'
    }
  });

  assert.equal(result.prepared, true);
  assert.equal(days.value, '30');
  assert.equal(cost.value, '3000');
  assert.equal(daysEvents, 2);
  assert.equal(costEvents, 2);
  assert.equal(clicked, false);

  const summary = document.querySelector('.r4g3-prm-inline-summary');
  assert.ok(summary);
  assert.match(summary.textContent, /100\/day/);
  assert.match(summary.textContent, /3,000/);
  assert.match(summary.textContent, /High/);
});

test('refuses a draft for a different property', () => {
  const dom = makeDom();
  const result = FormCore.prepareLeaseForm({
    document: dom.window.document,
    window: dom.window,
    location: dom.window.location,
    draft: { propertyId: 8, days: 30, dailyPrice: 100, totalCost: 3000 }
  });

  assert.equal(result.prepared, false);
  assert.match(result.reason, /property/i);
  assert.equal(dom.window.document.querySelector('li.amount input').value, '');
});

test('fails safely when Torn lease selectors are not recognized', () => {
  const dom = new JSDOM('<div id="market"><p>changed markup</p></div>', {
    url: 'https://www.torn.com/properties.php#/p=options&ID=7&tab=lease'
  });

  const result = FormCore.prepareLeaseForm({
    document: dom.window.document,
    window: dom.window,
    location: dom.window.location,
    draft: { propertyId: 7, days: 30, dailyPrice: 100, totalCost: 3000 }
  });

  assert.equal(result.prepared, false);
  assert.equal(result.reason, 'Form not recognized');
});
