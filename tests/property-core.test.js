'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PropertyCore = require('../src/property-core');

test('normalizes only properties owned by current user', () => {
  const rows = [
    {
      id: 10,
      property: { id: 13, name: 'Private Island' },
      owner: { id: 3877028 },
      happy: 4500,
      status: 'none',
      modifications: ['Airstrip']
    },
    {
      id: 11,
      property: { id: 13, name: 'Private Island' },
      owner: { id: 999 },
      happy: 4500,
      status: 'none',
      modifications: []
    }
  ];

  const out = PropertyCore.normalizeProperties(rows, '3877028');
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 10);
  assert.equal(out[0].propertyTypeId, 13);
  assert.deepEqual(out[0].modifications, ['Airstrip']);
});

test('normalizes common property response aliases', () => {
  const out = PropertyCore.normalizeProperty({
    property_id: '25',
    property_type_id: '9',
    name: 'Castle',
    owner_id: '3877028',
    happy: '4200',
    status: 'FOR_RENT',
    modifications: [{ name: 'Hot Tub' }, { name: 'Hot Tub' }, 'Sauna']
  }, 3877028);

  assert.equal(out.id, 25);
  assert.equal(out.propertyTypeId, 9);
  assert.equal(out.status, 'for_rent');
  assert.deepEqual(out.modifications, ['Hot Tub', 'Sauna']);
});

test('lease eligibility is restricted to status none', () => {
  assert.equal(PropertyCore.isEligibleForLease({ status: 'none' }), true);
  for (const status of ['in_use', 'for_sale', 'rented', 'for_rent', '']) {
    assert.equal(PropertyCore.isEligibleForLease({ status }), false, status);
  }
});

test('builds native lease hash URL', () => {
  assert.equal(
    PropertyCore.leaseUrl(123),
    'https://www.torn.com/properties.php#/p=options&ID=123&tab=lease'
  );
  assert.throws(() => PropertyCore.leaseUrl(0), /property/i);
});

test('returns sorted unique positive property type ids', () => {
  assert.deepEqual(
    PropertyCore.uniquePropertyTypeIds([
      { propertyTypeId: 13 },
      { propertyTypeId: 10 },
      { propertyTypeId: 13 },
      { propertyTypeId: 0 },
      { propertyTypeId: null }
    ]),
    [10, 13]
  );
});
