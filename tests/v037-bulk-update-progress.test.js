'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const ApiCore = require('../src/api-core');
const App = require('../src/app-v037');
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

function property(id, typeId) {
  return {
    id,
    property: { id: typeId, name: `Type ${typeId}` },
    propertyTypeId: typeId,
    owner: { id: 1 },
    modifications: [],
    status: 'none',
    happy: 1000
  };
}

test('sequential market scan finishes one property type before starting the next and pauses between types', async () => {
  const events = [];
  const sleeps = [];
  let releaseFirst;
  const firstDone = new Promise(resolve => { releaseFirst = resolve; });
  let allowFirstFinish;
  const firstGate = new Promise(resolve => { allowFirstFinish = resolve; });

  const client = ApiCore.createClient({
    apiKey: 'test-key',
    storage: memoryStorage(),
    scheduler: { run: task => task() },
    sleep: async ms => { sleeps.push(ms); },
    fetchImpl: async url => {
      const match = String(url).match(/\/market\/(\d+)\/rentals/);
      if (!match) throw new Error(`unexpected ${url}`);
      const id = Number(match[1]);
      events.push(`start-${id}`);
      if (id === 10) {
        releaseFirst();
        await firstGate;
      }
      events.push(`finish-${id}`);
      return { ok: true, status: 200, async json() { return { rentals: { listings: [] } }; } };
    }
  });

  const scan = client.scanMarkets([property(1, 10), property(2, 20)], {
    force: true,
    sequential: true,
    betweenMarketsMs: 1200
  });

  await firstDone;
  await Promise.resolve();
  assert.deepEqual(events, ['start-10']);
  allowFirstFinish();
  await scan;

  assert.deepEqual(events, ['start-10', 'finish-10', 'start-20', 'finish-20']);
  assert.deepEqual(sleeps, [1200]);
});

test('UPDATE ALL requests paced sequential markets and renders a real global progress bar', async () => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://www.torn.com/properties.php' });
  const storage = memoryStorage();
  let scanOptions = null;
  let releaseScan;
  const scanGate = new Promise(resolve => { releaseScan = resolve; });
  let progress;
  let markProgressObserved;
  const progressObserved = new Promise(resolve => { markProgressObserved = resolve; });

  const controller = App.createController({
    window: dom.window,
    document: dom.window.document,
    storage,
    apiClient: {
      async fetchCurrentUserId() { return 1; },
      async fetchOwnedProperties() { return [property(101, 10), property(202, 20)]; },
      async scanMarkets(properties, options) {
        scanOptions = options;
        options.onProgress({ id: 10, done: 1, total: 2, market: { rentals: [] } });
        progress = dom.window.document.querySelector('[data-role="v037-update-all-progress"]');
        markProgressObserved();
        await scanGate;
        options.onProgress({ id: 20, done: 2, total: 2, market: { rentals: [] } });
        return { 10: { rentals: [] }, 20: { rentals: [] } };
      }
    },
    propertyCore: PropertyCore,
    marketCore: MarketCore,
    draftStore: { save(d) { return d; }, loadFor() { return null; }, clear() {} },
    navigate() {}
  });

  controller.open();
  const pending = controller.updateAll();
  await progressObserved;

  assert.equal(scanOptions.sequential, true);
  assert.ok(Number(scanOptions.betweenMarketsMs) >= 1000);
  assert.ok(progress);
  assert.match(progress.textContent, /1\s*\/\s*2/);
  const bar = progress.querySelector('[role="progressbar"]');
  assert.ok(bar);
  assert.equal(bar.getAttribute('aria-valuenow'), '50');

  releaseScan();
  await pending;
  assert.equal(dom.window.document.querySelector('[data-role="v037-update-all-progress"]'), null);
});
