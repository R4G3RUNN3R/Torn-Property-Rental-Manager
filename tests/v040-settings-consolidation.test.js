'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function optionalRequire(modulePath) {
  try { return require(modulePath); } catch (error) { return null; }
}

const SettingsCore = optionalRequire('../src/settings-core');
const build = require('../scripts/build-userscript');

function memoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

test('stable settings-core preserves the v0.3.10 pricing and display contract', () => {
  assert.ok(SettingsCore, 'stable settings-core should exist');
  assert.deepEqual(SettingsCore.PRICING_BASES, ['lowest', 'median', 'average', 'highest']);
  assert.ok(SettingsCore.SORT_MODES.includes('recommended'));
  assert.ok(SettingsCore.SORT_MODES.includes('rent-desc'));

  const normalized = SettingsCore.normalizeSettings({
    pricingBasis: 'median',
    undercutPercent: 1.25,
    sortMode: 'rent-desc',
    theme: 'light',
    density: 'compact',
    showImages: false,
    marketDetail: 'compact'
  }, 0.5, 'dark');

  assert.equal(normalized.pricingBasis, 'median');
  assert.equal(normalized.undercutPercent, 1.25);
  assert.equal(normalized.sortMode, 'rent-desc');
  assert.equal(normalized.theme, 'light');
  assert.equal(normalized.density, 'compact');
  assert.equal(normalized.showImages, false);
  assert.equal(normalized.marketDetail, 'compact');
});

test('stable settings-core keeps the existing storage key and persistence behavior', () => {
  assert.ok(SettingsCore, 'stable settings-core should exist');
  assert.equal(SettingsCore.SETTINGS_KEY, 'r4g3_property_rental_manager.v033');
  const storage = memoryStorage();
  const saved = SettingsCore.saveSettings(storage, { pricingBasis: 'highest', undercutPercent: 2 }, 0.5, 'dark');
  const loaded = SettingsCore.loadSettings(storage, 0.5, 'dark');
  assert.equal(saved.pricingBasis, 'highest');
  assert.equal(loaded.pricingBasis, 'highest');
  assert.equal(loaded.undercutPercent, 2);
});

test('userscript build ships one stable settings implementation instead of ui-core-v033', () => {
  assert.ok(build.sourceFiles.includes('src/settings-core.js'));
  assert.ok(!build.sourceFiles.includes('src/ui-core-v033.js'));
  assert.equal(
    build.sourceFiles.filter(file => ['settings-core.js', 'ui-core-v033.js'].includes(path.basename(file))).length,
    1
  );
});
