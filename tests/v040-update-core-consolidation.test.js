'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function optionalRequire(modulePath) {
  try { return require(modulePath); } catch (error) { return null; }
}

const UpdateCore = optionalRequire('../src/update-core');
const build = require('../scripts/build-userscript');

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

test('stable update-core preserves snapshot keys and truthful split timestamps', () => {
  assert.ok(UpdateCore, 'stable update-core should exist');
  assert.equal(UpdateCore.SETTINGS_KEY, 'r4g3_property_rental_manager.v034.updates');
  assert.equal(UpdateCore.SNAPSHOT_KEY, 'r4g3_property_rental_manager.v034.snapshot');

  const normalized = UpdateCore.normalizeSnapshot({
    properties: [{ id: 101 }],
    markets: { 1: { rentals: [] } },
    propertyMarkets: {},
    updatedAt: 100,
    propertyUpdatedAt: { 101: 90 },
    propertyCheckedAt: { 101: 95 },
    marketCheckedAt: { 101: 80 }
  });

  assert.equal(normalized.propertyCheckedAt['101'], 95);
  assert.equal(normalized.marketCheckedAt['101'], 80);
});

test('stable update-core preserves legacy timestamp migration and persistence', () => {
  assert.ok(UpdateCore, 'stable update-core should exist');
  const storage = memoryStorage();
  const saved = UpdateCore.saveSnapshot(storage, {
    properties: [{ id: 101 }],
    markets: {},
    propertyMarkets: {},
    updatedAt: 100,
    propertyUpdatedAt: { 101: 90 }
  });
  const loaded = UpdateCore.loadSnapshot(storage);

  assert.equal(saved.propertyCheckedAt['101'], 90);
  assert.equal(saved.marketCheckedAt['101'], 90);
  assert.equal(loaded.propertyCheckedAt['101'], 90);
  assert.equal(loaded.marketCheckedAt['101'], 90);
});

test('userscript build ships one stable update core instead of update-core-v034', () => {
  assert.ok(build.sourceFiles.includes('src/update-core.js'));
  assert.ok(!build.sourceFiles.includes('src/update-core-v034.js'));
  assert.equal(
    build.sourceFiles.filter(file => ['update-core.js', 'update-core-v034.js'].includes(path.basename(file))).length,
    1
  );
});
