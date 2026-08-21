'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ApiCore = require('../src/api-core');

test('default scheduler spaces Torn requests by 750ms', async () => {
  let clock = 0;
  const starts = [];
  const scheduler = ApiCore.createScheduler({
    now: () => clock,
    sleep: async ms => { clock += ms; }
  });

  await scheduler.run(async () => { starts.push(clock); });
  await scheduler.run(async () => { starts.push(clock); });
  await scheduler.run(async () => { starts.push(clock); });

  assert.deepEqual(starts, [0, 750, 1500]);
});

test('default scheduler caps request starts at 80 per rolling minute', async () => {
  let clock = 0;
  const starts = [];
  const scheduler = ApiCore.createScheduler({
    minGapMs: 0,
    now: () => clock,
    sleep: async ms => { clock += ms; }
  });

  for (let i = 0; i < 81; i += 1) {
    await scheduler.run(async () => { starts.push(clock); });
  }

  assert.equal(starts.slice(0, 80).every(value => value === 0), true);
  assert.ok(starts[80] >= 60000, String(starts[80]));
});
