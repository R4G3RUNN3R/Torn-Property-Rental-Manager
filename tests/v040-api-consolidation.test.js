'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ApiCore = require('../src/api-core');
const build = require('../scripts/build-userscript');

test('stable api-core owns the v0.3.10 paginated market API surface', () => {
  assert.equal(ApiCore.PAGE_LIMIT, 100);
  assert.equal(ApiCore.PAGE_WORKERS, 2);
  assert.equal(ApiCore.MAX_PAGES, 100);
  assert.equal(typeof ApiCore.metadataTotal, 'function');
  assert.equal(typeof ApiCore.offsetUrl, 'function');

  const url = new URL(ApiCore.offsetUrl(7, 200));
  assert.equal(url.origin, 'https://api.torn.com');
  assert.equal(url.pathname, '/v2/market/7/rentals');
  assert.equal(url.searchParams.get('limit'), '100');
  assert.equal(url.searchParams.get('offset'), '200');
});

test('userscript build has one stable API implementation and no versioned API wrapper', () => {
  assert.ok(build.sourceFiles.includes('src/api-core.js'));
  assert.ok(!build.sourceFiles.includes('src/api-core-v039.js'));
  assert.equal(
    build.sourceFiles.filter(file => path.basename(file).startsWith('api-core')).length,
    1
  );
});
