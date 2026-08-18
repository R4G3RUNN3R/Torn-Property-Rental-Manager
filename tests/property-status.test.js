'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const PropertyCore = require('../src/property-core');

test('normalizes rented property financial and renter details from Torn extended response', () => {
  const property = PropertyCore.normalizeProperty({
    id: 42,
    owner: { id: 3877028, name: 'R4G3RUNN3R' },
    property: { id: 13, name: 'Private Island' },
    happy: 4500,
    status: 'rented',
    modifications: ['Airstrip'],
    cost: 90_000_000,
    cost_per_day: 3_000_000,
    rental_period: 30,
    rental_period_remaining: 12,
    rented_by: { id: 99, name: 'Tenant' }
  }, 3877028);

  assert.equal(property.cost, 90_000_000);
  assert.equal(property.costPerDay, 3_000_000);
  assert.equal(property.rentalPeriod, 30);
  assert.equal(property.rentalPeriodRemaining, 12);
  assert.deepEqual(property.rentedBy, { id: 99, name: 'Tenant' });
});

test('normalizes for-rent listing and interested renter details', () => {
  const property = PropertyCore.normalizeProperty({
    id: 43,
    owner: { id: 3877028, name: 'R4G3RUNN3R' },
    property: { id: 10, name: 'Castle' },
    happy: 4200,
    status: 'for_rent',
    modifications: [],
    cost: 60_000_000,
    cost_per_day: 2_000_000,
    rental_period: 30,
    renter_asked: { id: 77, name: 'Applicant' }
  }, 3877028);

  assert.equal(property.cost, 60_000_000);
  assert.equal(property.costPerDay, 2_000_000);
  assert.equal(property.rentalPeriod, 30);
  assert.deepEqual(property.renterAsked, { id: 77, name: 'Applicant' });
});
