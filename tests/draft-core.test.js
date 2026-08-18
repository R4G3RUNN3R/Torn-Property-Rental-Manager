'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const DraftCore = require('../src/draft-core');

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

test('validates property, rental period and daily price', () => {
  const store = DraftCore.createStore(memoryStorage(), { now: () => 1000 });

  assert.throws(() => store.save({ propertyId: 0, days: 30, dailyPrice: 100 }), /property/i);
  assert.throws(() => store.save({ propertyId: 1, days: 0, dailyPrice: 100 }), /days/i);
  assert.throws(() => store.save({ propertyId: 1, days: 366, dailyPrice: 100 }), /days/i);
  assert.throws(() => store.save({ propertyId: 1, days: 30, dailyPrice: 0 }), /price/i);

  const saved = store.save({ propertyId: 1, days: 30, dailyPrice: 100 });
  assert.equal(saved.totalCost, 3000);
  assert.equal(saved.createdAt, 1000);
});

test('draft is property-specific and expires after thirty minutes by default', () => {
  let clock = 1000;
  const storage = memoryStorage();
  const store = DraftCore.createStore(storage, { now: () => clock });

  store.save({ propertyId: 7, days: 30, dailyPrice: 100 });
  assert.equal(store.loadFor(8), null);
  assert.equal(store.loadFor(7).totalCost, 3000);

  clock += 30 * 60 * 1000 + 1;
  assert.equal(store.loadFor(7), null);
});

test('clear removes the pending draft', () => {
  const store = DraftCore.createStore(memoryStorage(), { now: () => 1000 });
  store.save({ propertyId: 2, days: 14, dailyPrice: 250 });
  store.clear();
  assert.equal(store.loadFor(2), null);
});

test('preserves optional market summary fields without trusting arbitrary extras', () => {
  const store = DraftCore.createStore(memoryStorage(), { now: () => 1000 });
  const saved = store.save({
    propertyId: 9,
    days: 30,
    dailyPrice: 123456,
    marketFloor: 125000,
    median: 130000,
    confidence: 'High',
    injected: '<script>no</script>'
  });

  assert.equal(saved.marketFloor, 125000);
  assert.equal(saved.median, 130000);
  assert.equal(saved.confidence, 'High');
  assert.equal(Object.hasOwn(saved, 'injected'), false);
});
