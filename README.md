# Torn Property Rental Manager

A standalone Torn.com userscript by **R4G3RUNN3R** for pricing and managing properties you own using Torn's rental market.

## v0.3.10

The manager automatically loads and verifies **your owned properties** without scanning Torn's rental market. Market pricing is requested deliberately with **SCAN MARKET** for one property or **UPDATE ALL** for all relevant property types.

The pricing engine compares only rental listings for the **same property type with the exact same upgrades/modifications**, normalizes every comparable to an equivalent **100-day total**, filters statistically extreme prices, and lets the user choose the cleaned market figure used as the pricing basis.

`100-day equivalent = (listing total cost / listing rental period) * 100`

Available pricing bases:

- **Lowest market price**
- **Median market price**
- **Average market price**
- **Highest market price**

The default proposed rent remains **Average market price minus 0.5%**, rounded down to a whole dollar.

### New in v0.3.10

- Property state and rental-market state now have **separate timestamps**:
  - **Property checked** means Torn confirmed the owned-property record/status.
  - **Market checked** means the rental-market scan completed successfully.
- A failed rental-market request can no longer make a property card look successfully market-updated.
- If a property check succeeds but its market scan fails, the manager preserves the **last known good market snapshot** and reports the market failure explicitly.
- Forced SCAN MARKET refreshes are now **timestamp-aware**. The first market page is fetched and its Torn `rentals_timestamp` is compared with the saved complete snapshot.
- If Torn reports the same market timestamp, the scan stops after **one page** and reuses the previous complete rental dataset instead of downloading identical pages again.
- Unchanged data keeps its original full-snapshot `fetchedAt` time while recording a new successful market check time.
- Large changed markets use at most **two page workers**. All page requests still pass through the existing shared Torn API scheduler.
- Per-property scans expose **CANCEL SCAN** while active.
- Cancelling aborts the real Tampermonkey `GM_xmlhttpRequest` where supported, prevents queued work from continuing, and never records a successful market check.
- Transient HTTP/network retries and Torn rate-limit cooldowns are shown directly on the active property card instead of looking like a frozen progress bar.
- Automatic startup property sync advances only **Property checked** and preserves the previous successful **Market checked** timestamp.
- Existing ownership verification, exact-upgrade matching, outlier protection, safe listing/cancellation, 750 ms request spacing, 80-per-minute cap and 60-second rate-limit cooldown remain in force.

## Updates and scanning

### Automatic owned-property refresh

When the manager starts or opens:

1. It verifies the current Torn API user.
2. It fetches that user's owned properties.
3. It rejects rows whose ownership cannot be verified as belonging to that API user.
4. It renders the owned-property cards.
5. It updates **Property checked** for the verified properties.
6. It makes **zero rental-market requests**.
7. It preserves the previous successful **Market checked** time and saved market snapshot.

Property discovery and market pricing are intentionally separate operations.

### Individual SCAN MARKET

Press **SCAN MARKET** on a property card to:

1. Refresh the verified owned-property state needed for that property.
2. Start a cancellable scan only for that property's matching rental-market type.
3. Fetch the first 100-row market page.
4. Compare Torn's current `rentals_timestamp` with the saved complete market snapshot.
5. If unchanged, reuse the complete saved snapshot and stop after the first page.
6. If changed, fetch the remaining offset pages with at most two page workers.
7. Show live page/listing progress while pages are collected.
8. Show retry or rate-limit status when Torn delays a request.
9. Record **Market checked** only after a successful scan.

Other property cards keep their own previous market snapshots until explicitly scanned.

### Cancelling a scan

While an individual market scan is active, the property card exposes **CANCEL SCAN**.

Cancellation:

- aborts the active request when the transport supports it
- prevents additional queued market pages from starting
- is propagated through the API layer as `AbortError`
- does not overwrite the last good rental-market snapshot
- does not advance **Market checked**
- can still preserve the successful **Property checked** timestamp if ownership/status verification completed first

### Retry and cooldown diagnostics

The active property card reports request recovery states such as:

- transient network/API request failed, retrying
- HTTP 502/503/504 retry
- Torn rate limit detected, cooling down before retry

The status disappears when the request recovers, the scan completes, is cancelled, or fails permanently.

### UPDATE ALL

**UPDATE ALL** is an explicit bulk market action. It refreshes verified owned properties and scans all relevant unique rental-market types sequentially.

- Unique property types are processed one at a time.
- Bulk scans pause **1.5 seconds between completed property-type scans**.
- Every individual Torn request still obeys the shared **750 ms minimum request-start spacing** and **80 requests per rolling minute** ceiling.
- Large markets use the same timestamp-aware first-page check and bounded page workers.
- A real global progress bar shows how many property-type markets have completed.
- UPDATE ALL is never started automatically by page load or by a legacy Automatic page update preference.

## Market matching and pricing

The manager prices a property only from rental listings for the **same property type and exact same modification set**.

Every exact match is normalized to 100 days before filtering or calculating statistics.

For example, a listing at `$100,000` for `30 days` becomes:

- `$100,000 / 30 = $3,333.33...` per day
- `$333,333.33...` for 100 days

### Outlier protection

Outlier protection is always enabled.

- With three or more exact matches, normalized prices outside **median / 5 through median * 5** are excluded first.
- With at least four remaining trusted rows, a **1.5× IQR** filter removes remaining statistical extremes.
- With exactly two exact matches more than **5× apart**, the sample is reported as **PRICE DATA TOO INCONSISTENT** and no automatic price is proposed.
- With one exact match, the card reports **INSUFFICIENT MARKET SAMPLE** and no automatic price is proposed.
- Cards display **Exact matches / Used / Outliers ignored**.

For normalized exact-match totals of `$1`, `$48,000,000`, `$50,000,000`, `$52,000,000`, and `$1,000,000,000`, the trusted sample becomes `$48,000,000`, `$50,000,000`, and `$52,000,000`.

### Pricing settings

- Rental period: **100 days fixed**
- Pricing basis: Lowest / Median / Average / Highest
- Undercut: **0% to 25%**
- Default: **Average minus 0.5%**
- Outlier protection: **always on**

Changing the pricing basis or undercut recalculates already-loaded market data immediately and does not require another market request.

## Rental listing workflow

For an available property with a trustworthy exact-match market quote:

1. **PREPARE RENTAL** stores the exact proposed 100-day total, opens the matching Torn lease page, and fills Torn's visible rental-period and total-cost inputs.
2. **LIST PROPERTY** is a second explicit user action. It verifies the route, draft, visible values, and native Torn listing control before clicking Torn's native final button exactly once.

If the visible Torn days or total are changed after preparation, LIST PROPERTY refuses to submit and leaves the edited values untouched. **PREPARE RENTAL** must be pressed again deliberately.

No page load, timer, MutationObserver, refresh, retry callback, or form-preparation step may trigger the native final listing action.

## Cancelling and relisting a property listing

For a property whose verified status is **for_rent**:

1. Press **CANCEL LISTING**.
2. The script opens/uses the matching Torn property lease/options route and waits for Torn's native remove-from-market control.
3. When the exact native control is recognized and enabled, the action becomes **CONFIRM CANCEL LISTING**.
4. Only that explicit confirmation may click Torn's native remove control once.
5. If Torn presents a native confirmation dialog, the script exposes **FINAL CONFIRM CANCEL** and only that additional explicit click may confirm it.
6. The card shows **CANCELLATION SENT** and requires a deliberate **SCAN MARKET** to verify the current property state before repricing/relisting.
7. Once Torn reports the property as available again, normal pricing and **PREPARE RENTAL → LIST PROPERTY** can be used again.

A property whose status is **rented** does not receive a cancel-listing action.

## Interface and settings

The manager supports:

- movable/resizable desktop panel
- mobile-safe layout
- minimize / close / launcher restore
- movable/resizable Settings window
- Dark / Light theme
- Comfortable / Compact card density
- Show / Hide property images
- Full / Compact market detail
- property sorting by recommended order, name, rent, happiness, or ID

Properties listed for rent remain in the bottom status group. A property successfully listed during the current session moves there immediately.

## Torn API safety

The API key remains browser-local, is never rendered back into an input, and is sent only in the `Authorization: ApiKey ...` header to `api.torn.com`.

Hard request controls:

- maximum **80 request starts per rolling 60 seconds**
- minimum **750 ms** between Torn API request starts
- maximum **two active page workers** inside one changed rental market
- UPDATE ALL processes unique property-type markets **sequentially**
- UPDATE ALL waits **1.5 seconds between completed property-type scans**
- **60-second cooldown** after Torn error 5 / Too many requests before bounded retry
- bounded retry for transient network failures and HTTP 429/502/503/504 responses
- pagination continuation URLs accepted only from `https://api.torn.com/v2/`
- API-owner identity verification rejects spouse-owned, other-player-owned, and unverified-owner property rows

## Recent release history

### v0.3.9

- Added total/offset pagination for large rental markets.
- Added live page/listing progress instead of appearing frozen at 35%.
- Kept validated Torn continuation-link fallback when a total count is unavailable.

### v0.3.8

- Added automatic owned-property discovery with zero automatic rental-market requests.
- Added explicit per-property **SCAN MARKET**.
- Disabled legacy automatic UPDATE ALL behavior.

### v0.3.7

- Made UPDATE ALL sequential by property type with a 1.5-second inter-market pause.
- Added a real global bulk progress bar.

### v0.3.6

- Added always-on exact-match outlier protection and tiny-sample fail-closed behavior.
- Added Exact matches / Used / Outliers ignored counts.

### v0.3.5 and earlier

- Added per-property market isolation and progress.
- Added explicit staged rental cancellation and confirmation.
- Added safe PREPARE RENTAL → LIST PROPERTY flow.
- Added shared API pacing, snapshots, sorting, appearance controls, and ownership verification.

## Install

Install the generated userscript:

`R4G3RUNN3R-Property-Rental-Manager.user.js`
