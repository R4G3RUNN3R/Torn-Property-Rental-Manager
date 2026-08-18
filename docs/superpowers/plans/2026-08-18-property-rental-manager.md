# Property Rental Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Torn userscript that scans owned properties and current rental-market listings, recommends competitive rent, and prepares one native lease form per explicit user action without auto-submitting Torn game actions.

**Architecture:** Pure property/pricing/draft/form modules are tested independently, API access is centralized behind one throttled scheduler, app/UI orchestration stays separate from pure logic, and the release is bundled into one installable userscript.

**Tech Stack:** JavaScript, Tampermonkey userscript APIs, Torn v2 API, browser localStorage/sessionStorage, Node 20 node:test, jsdom, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-18-property-rental-manager-design.md`

## Global Constraints

- Minimum 800 ms between Torn API request starts.
- Hard maximum 75 API request starts per rolling minute.
- API key only in `Authorization: ApiKey {key}` to `api.torn.com`, never in URLs or logs.
- No automatic native rental submission or action-button clicking.
- No background non-API requests to `torn.com`.
- Rental period defaults to 30 days and validates 1-365.
- Pricing defaults: 0.5% undercut, 0.70 minimum median ratio.
- Desktop UI movable/resizable with persistent geometry.
- Simple/Advanced modes and dark/light themes.
- Userscript matches `https://www.torn.com/properties.php*` only.

---

### Task 1: Property and pricing engines

**Files:** `src/property-core.js`, `src/market-core.js`, `tests/property-core.test.js`, `tests/market-core.test.js`

**Interfaces:**
- `PropertyCore.normalizeProperty(raw,currentUserId)`
- `PropertyCore.normalizeProperties(rows,currentUserId)`
- `PropertyCore.isEligibleForLease(property)`
- `PropertyCore.leaseUrl(propertyId)`
- `PropertyCore.uniquePropertyTypeIds(properties)`
- `MarketCore.normalizeRental(raw)`
- `MarketCore.happySimilarity(ownedHappy,listingHappy)`
- `MarketCore.modificationSimilarity(a,b)`
- `MarketCore.similarity(owned,listing)`
- `MarketCore.selectComparables(owned,listings)`
- `MarketCore.marketStats(owned,listings,settings)`

- [ ] Write failing property-core and market-core tests.
- [ ] Run them and confirm missing-module failures.
- [ ] Implement minimal pure modules to satisfy tests.
- [ ] Re-run tests to green.
- [ ] Commit.

### Task 2: API scheduler and Torn v2 client

**Files:** `src/api-core.js`, `tests/api-core.test.js`

Required tests cover Authorization header use, no API key in URL/errors, 800 ms spacing, rolling 75/minute cap, pagination validation, unique property-type scans, cache reuse/force bypass, and bounded retry behavior.

Interfaces:
- `ApiCore.createScheduler(options)`
- `ApiCore.createClient(options)`
- `client.fetchOwnedProperties()`
- `client.fetchRentalMarket(propertyTypeId,{force})`
- `client.scanMarkets(properties,{force})`

- [ ] Write failing API tests with injected fetch/clock/sleep/storage.
- [ ] Confirm failure.
- [ ] Implement scheduler and client.
- [ ] Re-run to green.
- [ ] Commit.

### Task 3: Lease draft and visible native form preparation

**Files:** `src/draft-core.js`, `src/form-core.js`, `tests/draft-core.test.js`, `tests/form-core.test.js`

Interfaces:
- `DraftCore.createStore(storage,options)`
- `store.save(draft)`, `store.loadFor(propertyId)`, `store.clear()`
- `FormCore.parseLeasePropertyId(locationLike)`
- `FormCore.findLeaseForm(document)`
- `FormCore.setNativeValue(input,value,windowLike)`
- `FormCore.prepareLeaseForm({document,window,location,draft})`

Required tests cover 1-365-day validation, total calculation, expiry/property matching, route parsing, selector recognition, value/event updates, summary rendering, and an explicit assertion that no submit/click path is invoked.

- [ ] Write failing draft/form tests.
- [ ] Confirm failure.
- [ ] Implement minimal draft/form modules.
- [ ] Re-run to green.
- [ ] Commit.

### Task 4: Application shell, persistence and pricing workflow

**Files:** `src/app.js`, `tests/app.test.js`

The app loads settings, validates API key presence, scans owned properties and unique markets, renders Simple/Advanced views, shows actionable/non-actionable statuses, permits daily-price override, creates one session draft, and navigates to the native lease route only from the user's Prepare Lease click.

Required UI behavior: persistent theme/mode/geometry, readable dark/light colors, drag/resize on desktop, responsive mobile fallback, visible error/diagnostic states without displaying the API key.

- [ ] Write failing application/persistence tests with jsdom.
- [ ] Confirm failure.
- [ ] Implement app shell and orchestration.
- [ ] Re-run to green.
- [ ] Commit.

### Task 5: Installable userscript and build/static safeguards

**Files:** `R4G3RUNN3R-Property-Rental-Manager.user.js`, `scripts/build-userscript.js`, `tests/userscript-static.test.js`, `package.json`

Bundle core modules and app into one userscript. Static tests assert the properties.php match, absence of `form.submit()`, absence of automated native submit `.click()` code paths, no non-API Torn fetch helper, and no API-key URL interpolation.

- [ ] Write failing static tests.
- [ ] Confirm failure.
- [ ] Implement deterministic build script and metadata.
- [ ] Build userscript.
- [ ] Run all tests and `node --check` on source/release files.
- [ ] Commit.

### Task 6: CI, documentation and final verification

**Files:** `.github/workflows/test.yml`, `README.md`

CI runs on pushes/PRs using Node 20, `npm ci`, tests, build, and syntax checks. README documents installation, Limited-or-higher API key requirement, pricing method, compliance boundary, Simple/Advanced controls, and the manual-submit rule.

- [ ] Confirm CI catches a deliberately missing implementation before production code exists.
- [ ] Finish implementation tasks until CI is green.
- [ ] Review all changed files for spec coverage and forbidden action paths.
- [ ] Open a PR from `feature/initial-implementation` to `main` for review.