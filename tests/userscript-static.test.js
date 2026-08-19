'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const releasePath = path.join(root, 'R4G3RUNN3R-Property-Rental-Manager.user.js');

function release() {
  return fs.readFileSync(releasePath, 'utf8');
}

test('release userscript has narrow Torn properties metadata and v0.3.1 version', () => {
  const source = release();
  assert.match(source, /@name\s+R4G3RUNN3R Property Rental Manager/);
  assert.match(source, /@version\s+0\.3\.1/);
  assert.match(source, /@match\s+https:\/\/www\.torn\.com\/properties\.php\*/);
  assert.match(source, /@connect\s+api\.torn\.com/);
  assert.match(source, /@grant\s+GM_xmlhttpRequest/);
  assert.doesNotMatch(source, /@match\s+https:\/\/www\.torn\.com\/\*/);
});

test('release supports one explicit LIST PROPERTY click without automatic form submission APIs', () => {
  const source = release();
  assert.doesNotMatch(source, /\.submit\s*\(/);
  assert.doesNotMatch(source, /\.requestSubmit\s*\(/);
  assert.match(source, /function submitLeaseFromUserGesture/);
  assert.match(source, /submitButton\.click\(\)/);
  assert.match(source, /data-action['"]?:?\s*['"]list-property|createButton\('LIST PROPERTY', 'list-property'\)/);
  assert.match(source, /if \(action === 'list-property'\)/);
});

test('release never places an API key in a URL', () => {
  const source = release();
  assert.doesNotMatch(source, /[?&](?:key|apiKey)=/i);
  assert.doesNotMatch(source, /apiKey\s*\}\s*[&?#]/);
  assert.match(source, /Authorization:\s*`ApiKey \$\{apiKey\}`/);
});

test('userscript network adapter rejects non-api.torn.com requests', () => {
  const source = release();
  assert.match(source, /url\.origin !== R4G3ApiCore\.API_ORIGIN/);
  assert.match(source, /Rejected non-Torn API request/);
  assert.doesNotMatch(source, /fetch\s*\(\s*['"`]https:\/\/www\.torn\.com/i);
  assert.doesNotMatch(source, /GM_xmlhttpRequest\s*\(\s*\{[^}]*url:\s*['"`]https:\/\/www\.torn\.com/is);
});

test('release keeps SET PRICE preparation armed until explicit LIST PROPERTY', () => {
  const source = release();
  assert.match(source, /R4G3FormCore\.parseLeasePropertyId/);
  assert.match(source, /R4G3FormCore\.prepareLeaseForm/);
  assert.match(source, /function createLeaseLister/);
  assert.match(source, /canListProperty\(propertyId\)/);
  assert.match(source, /listProperty\(propertyId\)/);
  assert.match(source, /R4G3FormCore\.submitLeaseFromUserGesture/);
  assert.match(source, /draftStore\.clear\(\)/);
  assert.match(source, /MutationObserver/);
});

test('release contains current nested rental parsing and 100-day quote workflow', () => {
  const source = release();
  assert.match(source, /body\.rentals\.listings/);
  assert.match(source, /function exactModificationMatch/);
  assert.match(source, /function rentalQuote/);
  assert.match(source, /targetDays:\s*TARGET_DAYS/);
  assert.match(source, /Proposed 100-day rent/);
});

test('build script declares every source module in deterministic order', () => {
  const buildPath = path.join(root, 'scripts', 'build-userscript.js');
  const source = fs.readFileSync(buildPath, 'utf8');
  const expected = [
    'src/property-core.js',
    'src/market-core.js',
    'src/api-core.js',
    'src/draft-core.js',
    'src/form-core.js',
    'src/app.js',
    'src/bootstrap.js'
  ];
  let last = -1;
  for (const file of expected) {
    const index = source.indexOf(file);
    assert.ok(index > last, `${file} should appear in build order`);
    last = index;
  }
});
