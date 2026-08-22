'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

function optionalRequire(path) {
  try { return require(path); } catch (error) { return null; }
}

const ApiCoreV039 = optionalRequire('../src/api-core-v039');
const AppV039 = optionalRequire('../src/app-v039');

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

function response(body) {
  return { ok: true, status: 200, async json() { return body; } };
}

function rentalRows(count, offset) {
  return Array.from({ length: count }, (_, index) => ({
    happy: 100,
    cost: 100000 + offset + index,
    cost_per_day: 1000 + offset + index,
    rental_period: 100,
    market_price: 100000,
    upkeep: 0,
    modifications: []
  }));
}

test('rental market uses metadata total plus offsets and reports page progress instead of sitting at 35 percent', async () => {
  assert.ok(ApiCoreV039, 'v0.3.9 API core should exist');
  const urls = [];
  const progress = [];
  const client = ApiCoreV039.createClient({
    apiKey: 'test-key',
    storage: memoryStorage(),
    scheduler: { run(task) { return task(); } },
    fetchImpl: async url => {
      urls.push(String(url));
      const parsed = new URL(String(url));
      const offset = Number(parsed.searchParams.get('offset') || 0);
      const remaining = Math.max(0, 250 - offset);
      const count = Math.min(100, remaining);
      return response({
        rentals: { listings: rentalRows(count, offset), property: { id: 1, name: 'Apartment' } },
        rentals_timestamp: 123,
        rentals_delay: 60,
        _metadata: { links: { total: 250, next: null } }
      });
    }
  });

  const market = await client.fetchRentalMarket(1, {
    force: true,
    onPageProgress(entry) { progress.push(entry); }
  });

  assert.equal(market.rentals.length, 250);
  assert.equal(urls.length, 3);
  assert.ok(urls.some(url => /[?&]offset=100(?:&|$)/.test(url)));
  assert.ok(urls.some(url => /[?&]offset=200(?:&|$)/.test(url)));
  assert.deepEqual(progress.map(entry => [entry.donePages, entry.totalPages]), [[1, 3], [2, 3], [3, 3]]);
});

test('wrapped single-property scan shows page progress and removes it when the market completes', async () => {
  assert.ok(AppV039, 'v0.3.9 app wrapper should exist');
  const dom = new JSDOM(`<!doctype html><html><body>
    <section data-property-id="101">
      <div data-role="v034-card-controls">
        <div data-role="v035-update-progress">
          <small data-role="v035-update-progress-label">Searching rental market… 35%</small>
          <div role="progressbar" aria-valuenow="35"><div data-role="v035-update-progress-fill"></div></div>
        </div>
      </div>
    </section>
  </body></html>`, { url: 'https://www.torn.com/properties.php' });

  let releaseScan;
  const scanGate = new Promise(resolve => { releaseScan = resolve; });
  const originalClient = {
    async scanMarkets(properties, options) {
      assert.deepEqual(properties.map(property => property.id), [101]);
      assert.equal(typeof options.onPageProgress, 'function');
      options.onPageProgress({ id: 1, donePages: 1, totalPages: 4, rowsDone: 100, totalRows: 350 });
      await scanGate;
      if (typeof options.onProgress === 'function') {
        options.onProgress({ id: 1, done: 1, total: 1, market: { rentals: rentalRows(2, 0), fromCache: false } });
      }
      return { 1: { rentals: rentalRows(2, 0), fromCache: false } };
    }
  };

  const client = AppV039.wrapApiClient(originalClient, dom.window.document);
  const pending = client.scanMarkets([{ id: 101, propertyTypeId: 1 }], { onProgress() {} });
  await Promise.resolve();

  const pageProgress = dom.window.document.querySelector('[data-role="v039-market-page-progress"]');
  const bar = pageProgress && pageProgress.querySelector('[role="progressbar"]');
  const label = pageProgress && pageProgress.querySelector('[data-role="v039-market-page-progress-label"]');
  assert.ok(bar, 'single-property scan should show page-level progress');
  const percent = Number(bar.getAttribute('aria-valuenow'));
  assert.ok(percent > 35 && percent < 92, `expected visible page progress between 35 and 92, saw ${percent}`);
  assert.match(label.textContent, /page\s+1\s*\/\s*4/i);
  assert.match(label.textContent, /100\s*\/\s*350 listings/i);
  assert.equal(dom.window.document.querySelector('[data-role="v035-update-progress"]').style.display, 'none');

  releaseScan();
  await pending;

  assert.equal(dom.window.document.querySelector('[data-role="v039-market-page-progress"]'), null);
  assert.equal(dom.window.document.querySelector('[data-role="v035-update-progress"]').style.display, '');
  dom.window.close();
});
