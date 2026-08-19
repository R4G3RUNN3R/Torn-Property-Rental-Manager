'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PropertyCore = require('../src/property-core');

test('API-owner filtering excludes properties whose owner cannot be verified', () => {
  const rows = [
    { id: 101, property: { id: 13, name: 'Private Island' }, owner: { id: 3877028 }, status: 'none', modifications: [] },
    { id: 102, property: { id: 13, name: 'Private Island' }, owner: { id: 999999 }, status: 'none', modifications: [] },
    { id: 103, property: { id: 13, name: 'Private Island' }, status: 'none', modifications: [] }
  ];

  assert.deepEqual(
    PropertyCore.normalizeProperties(rows, 3877028).map(property => property.id),
    [101]
  );
});
