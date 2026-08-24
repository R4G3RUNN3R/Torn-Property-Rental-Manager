'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const build = require('../scripts/build-userscript');

function optionalRequire(path) {
  try { return require(path); } catch (error) { return null; }
}

const UiObserver = optionalRequire('../src/ui-observer');
const AppRuntime = optionalRequire('../src/app-runtime');
const LegacyApp = require('../src/app-v0310');

test('v0.4.0 build ships stable app runtime modules instead of versioned app files', () => {
  assert.ok(build.sourceFiles.includes('src/ui-observer.js'));
  assert.ok(build.sourceFiles.includes('src/app-runtime.js'));
  assert.equal(build.sourceFiles.includes('src/app.js'), false);
  assert.equal(build.sourceFiles.some(file => /^src\/app-v\d+\.js$/.test(file)), false);
});

test('stable app runtime exposes the same public controller surface as v0.3.10', () => {
  assert.ok(AppRuntime, 'stable app-runtime should exist');
  assert.equal(typeof AppRuntime.createController, 'function');
  for (const key of Object.keys(LegacyApp)) {
    assert.ok(Object.prototype.hasOwnProperty.call(AppRuntime, key), `missing legacy export ${key}`);
  }
});

test('UI observer multiplexer gives app layers one native MutationObserver', () => {
  assert.ok(UiObserver, 'ui-observer should exist');
  let nativeConstructors = 0;
  let nativeCallback = null;
  let observeCalls = 0;
  let disconnectCalls = 0;

  class NativeMutationObserver {
    constructor(callback) {
      nativeConstructors += 1;
      nativeCallback = callback;
    }
    observe() { observeCalls += 1; }
    disconnect() { disconnectCalls += 1; }
    takeRecords() { return []; }
  }

  const root = {
    contains(node) { return node === this || node && node.parent === this; }
  };
  const documentLike = { documentElement: root, body: root };
  const windowLike = { MutationObserver: NativeMutationObserver };
  const AppMutationObserver = UiObserver.createWindowProxy(windowLike, documentLike).MutationObserver;
  const calls = [];
  const first = new AppMutationObserver(records => calls.push(['first', records.length]));
  const second = new AppMutationObserver(records => calls.push(['second', records.length]));

  first.observe(root, { childList: true, subtree: true });
  second.observe(root, { childList: true, subtree: true });
  assert.equal(nativeConstructors, 1, 'all app observers should share one native observer');
  assert.ok(observeCalls >= 1);

  nativeCallback([{ type: 'childList', target: root, addedNodes: [], removedNodes: [] }]);
  assert.deepEqual(calls, [['first', 1], ['second', 1]]);

  first.disconnect();
  second.disconnect();
  assert.ok(disconnectCalls >= 1);
});
