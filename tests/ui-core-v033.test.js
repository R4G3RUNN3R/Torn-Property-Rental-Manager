'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const UiCore = require('../src/ui-core-v033');

function row(id, name, status, proposedTotal, happy) {
  return { property: { id, name, status, happy }, quote: { proposedTotal } };
}

test('v0.3.3 settings keep safe defaults and validate user choices', () => {
  const defaults = UiCore.normalizeSettings({}, 0.5);
  assert.equal(defaults.pricingBasis, 'average');
  assert.equal(defaults.undercutPercent, 0.5);
  assert.equal(defaults.sortMode, 'recommended');
  assert.equal(defaults.density, 'comfortable');
  assert.equal(defaults.showImages, true);
  assert.equal(defaults.marketDetail, 'full');

  const normalized = UiCore.normalizeSettings({
    pricingBasis: 'highest', undercutPercent: '1.25', sortMode: 'rent-desc',
    density: 'compact', showImages: false, marketDetail: 'compact'
  }, 0.5);
  assert.equal(normalized.pricingBasis, 'highest');
  assert.equal(normalized.undercutPercent, 1.25);
  assert.equal(normalized.sortMode, 'rent-desc');
  assert.equal(normalized.density, 'compact');
  assert.equal(normalized.showImages, false);
  assert.equal(normalized.marketDetail, 'compact');
});

test('listed properties sort below available and other statuses', () => {
  const rows = [
    row(3, 'Castle', 'for_rent', 300, 3000),
    row(2, 'Palace', 'rented', 200, 2000),
    row(1, 'Island', 'none', 100, 1000)
  ];
  assert.deepEqual(UiCore.sortRows(rows, { sortMode: 'recommended' }, new Set()).map(x => x.property.id), [1, 2, 3]);
});

test('successful just-listed property goes to the absolute bottom immediately', () => {
  const rows = [
    row(1, 'Island', 'none', 500, 1000),
    row(2, 'Castle', 'for_rent', 100, 2000),
    row(3, 'Palace', 'none', 300, 3000)
  ];
  const sorted = UiCore.sortRows(rows, { sortMode: 'rent-desc' }, new Set([1]));
  assert.deepEqual(sorted.map(x => x.property.id), [3, 2, 1]);
});

test('custom sort modes operate inside status groups', () => {
  const rows = [
    row(1, 'B', 'none', 100, 1000),
    row(2, 'A', 'none', 300, 3000),
    row(3, 'C', 'none', 200, 2000)
  ];
  assert.deepEqual(UiCore.sortRows(rows, { sortMode: 'rent-desc' }, new Set()).map(x => x.property.id), [2, 3, 1]);
  assert.deepEqual(UiCore.sortRows(rows, { sortMode: 'happy-asc' }, new Set()).map(x => x.property.id), [1, 3, 2]);
  assert.deepEqual(UiCore.sortRows(rows, { sortMode: 'name-asc' }, new Set()).map(x => x.property.id), [2, 1, 3]);
});

test('panel position is constrained so a desktop window cannot be stranded off-screen', () => {
  assert.deepEqual(
    UiCore.clampPanelPosition({ left: 900, top: 700, width: 400, height: 300 }, { width: 1024, height: 768 }),
    { left: 616, top: 460 }
  );
  assert.deepEqual(
    UiCore.clampPanelPosition({ left: -20, top: -50, width: 400, height: 300 }, { width: 1024, height: 768 }),
    { left: 8, top: 8 }
  );
});

test('pricing basis labels are explicit for the property card formula', () => {
  assert.equal(UiCore.pricingBasisLabel('lowest'), 'Lowest market price');
  assert.equal(UiCore.pricingBasisLabel('median'), 'Median market price');
  assert.equal(UiCore.pricingBasisLabel('average'), 'Average market price');
  assert.equal(UiCore.pricingBasisLabel('highest'), 'Highest market price');
});
