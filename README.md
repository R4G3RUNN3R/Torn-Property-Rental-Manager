# Torn Property Rental Manager

A standalone Torn.com userscript by **R4G3RUNN3R** for pricing and managing properties you own using Torn's rental market.

## v0.3.8

The manager automatically loads and verifies **your owned properties** without scanning Torn's rental market. Market pricing is then requested deliberately, either for one property with **SCAN MARKET** or for all owned property types with **UPDATE ALL**.

The pricing engine still compares only rental listings for the **same property type with the exact same upgrades/modifications**, normalizes every comparable to an equivalent **100-day total**, filters statistically extreme prices, and lets the user choose the cleaned market figure used as the pricing basis.

`100-day equivalent = (listing total cost / listing rental period) * 100`

Available pricing bases:

- **Lowest market price**
- **Median market price**
- **Average market price**
- **Highest market price**

The configured undercut percentage is applied to the selected raw figure and the final proposed rent is rounded down to a whole dollar. The default remains **Average market price minus 0.5%**.

### New in v0.3.8

- **Owned properties load automatically.** The manager fetches the current API user identity and owned-property list when it starts/opens.
- Automatic property discovery makes **zero rental-market requests**.
- API-owner verification still rejects spouse-owned, other-player-owned and unverified-owner rows.
- Every owned-property card is rendered even when there is no previous saved market snapshot.
- Each property now has an explicit **SCAN MARKET** action. It refreshes that property's verified state and scans only the matching rental-market type.
- **UPDATE ALL remains manual** and is reserved for a deliberate bulk rental-market scan.
- A legacy saved **Automatic page update** preference can no longer start UPDATE ALL automatically.
- Settings explains the new split clearly: owned-property refresh is automatic; rental-market scanning is manual.
- Existing UPDATE ALL pacing, progress, pricing safeguards, cancellation safety and PREPARE RENTAL → LIST PROPERTY rules remain unchanged.

### New in v0.3.7

- **UPDATE ALL is deliberately paced.** Rental markets are scanned one property type at a time instead of starting every unique property type concurrently.
- Bulk scans wait **1.5 seconds between completed property-type market scans**, on top of the existing shared **750 ms minimum request-start spacing** and **80 requests per rolling minute** ceiling.
- Pagination for the current property type is allowed to finish before the next property type begins, reducing the chance of several market scans piling into the Torn API at once.
- **UPDATE ALL has a real global progress bar** showing completed rental markets such as `3 / 12` and a percentage.
- The bar follows actual market completion events and survives the manager's full-panel rerenders while a bulk update is active.
- Individual property market scans are not slowed by the bulk-only inter-market delay.

### New in v0.3.6

- **Outlier protection is always enabled.** Exact-upgrade rental listings are normalized to 100 days before any price is judged.
- With three or more exact matches, prices more than **5× above** or below **1/5 of** the median are excluded first, then a **1.5× IQR** filter removes remaining statistical extremes where the sample is large enough.
- Lowest / Median / Average / Highest and the proposed rent are calculated only from the trusted sample.
- With exactly two exact matches, values more than **5× apart** are treated as **PRICE DATA TOO INCONSISTENT** and no automatic rent is proposed.
- With only one exact match, the card reports **INSUFFICIENT MARKET SAMPLE** and no automatic rent is proposed.
- Property cards show **Exact matches / Used / Outliers ignored**, so excluded listings are visible rather than silently discarded.
- Outlier filtering is local and adds **no Torn API requests**.

### New in v0.3.5

- Individual property refreshes are isolated: only the selected property receives fresh property state, rental-market data and a new market timestamp.
- Each selected property shows a visible **search/update progress bar** while its refresh is running.
- Rental cancellation notices Torn controls rendered asynchronously and searches the full native page instead of assuming a particular market container.
- Torn's native removal confirmation is handled as another explicit stage: **CANCEL LISTING → CONFIRM CANCEL LISTING → FINAL CONFIRM CANCEL** when Torn presents its confirmation dialog. No observer, timer or callback may click a native cancellation control.
- Existing **80 requests per rolling minute**, **750 ms minimum spacing**, 60-second rate-limit cooldown and PREPARE RENTAL → LIST PROPERTY safety rules remain unchanged.

### New in v0.3.4

- The manager stores the last known property and market snapshot locally.
- Each property displays a **Last updated** market time.
- Properties with status **for_rent** expose a staged cancellation flow.
- After a cancellation is sent, the script does not silently market-scan or relist.
- Properties with an active **rented** lease do not expose cancellation.
- Shared Torn API pacing is **80 request starts per rolling 60 seconds** with at least **750 ms between request starts**.
- Torn rate-limit responses trigger a **60-second cooldown** before bounded retry.

## Updates

### Automatic owned-property refresh

When the manager starts or opens:

1. It verifies the current Torn API user.
2. It fetches that user's owned properties.
3. It filters out property rows whose ownership cannot be verified as belonging to that API user.
4. It renders those property cards.
5. It does **not** request any rental-market listings.

This property-only refresh is intentionally separate from market pricing. Existing saved market results can remain visible, but they are not silently refreshed.

### Individual market scan

Press **SCAN MARKET** on a property card to:

- refresh the verified owned-property state needed for that property
- scan only that property's matching rental-market type
- update only that property's market snapshot and price calculation
- show a progress bar on that property while the scan is running

Other property cards keep their previous market snapshots until explicitly scanned.

### UPDATE ALL

**UPDATE ALL** is an explicit bulk market action. It refreshes verified owned properties and scans all relevant unique rental-market types sequentially.

During UPDATE ALL, the manager displays a global progress bar showing how many unique rental markets have completed. Bulk market scans pause **1.5 seconds between property types** in addition to the shared request scheduler.

UPDATE ALL is never started automatically by page load or by a legacy Automatic page update preference.

## Rental listing workflow

For an available property with an exact-match market quote:

1. **PREPARE RENTAL** stores the exact proposed 100-day total, opens the matching Torn lease page and fills Torn's visible rental-period and total-cost inputs.
2. **LIST PROPERTY** is a second explicit user action. It verifies the route, draft, visible values and native Torn listing control before clicking Torn's native final button exactly once.

If the visible Torn days or total are changed after preparation, LIST PROPERTY refuses to submit and leaves the edited values untouched. **PREPARE RENTAL** must be pressed again deliberately.

No page load, timer, MutationObserver, refresh, retry callback or form-preparation step may trigger the native final listing action.

## Cancelling and relisting

For a property whose verified status is **for_rent**:

1. Press **CANCEL LISTING**.
2. The script opens/uses the matching Torn property lease/options route and waits for Torn's native remove-from-market control.
3. When the exact native control is recognized and enabled, the action becomes **CONFIRM CANCEL LISTING**.
4. Only that explicit confirmation may click Torn's native remove control once.
5. If Torn presents a native confirmation dialog, the script exposes **FINAL CONFIRM CANCEL** and only that additional explicit click may confirm it.
6. The card shows **CANCELLATION SENT** and requires a deliberate **SCAN MARKET** to verify the current property state before repricing/relisting.
7. Once Torn reports the property as available again, normal pricing and **PREPARE RENTAL → LIST PROPERTY** can be used to relist it at the newly calculated price.

A property whose status is **rented** does not receive a cancel-listing action.

## Pricing settings

Open the gear button in the manager title bar.

### Pricing

- Rental period: **100 days fixed**
- Pricing basis: Lowest / Median / Average / Highest
- Undercut: **0% to 25%**
- Default: **Average minus 0.5%**
- Outlier protection: **always on**

Changing the pricing basis or undercut recalculates already-loaded market data immediately and does not require another market request.

### Property sorting

- Recommended
- Property name A → Z
- Property name Z → A
- Proposed rent: highest first
- Proposed rent: lowest first
- Happiness: highest first
- Happiness: lowest first
- Property ID

Properties listed for rent remain in the bottom group. A property successfully listed during the current session moves there immediately without waiting for another API scan.

### Appearance

- Dark / Light theme
- Comfortable / Compact card density
- Show / Hide property images
- Full / Compact market detail

### Updates

- Owned-property list refresh: **automatic**
- Individual rental-market pricing: **SCAN MARKET**
- Bulk rental-market pricing: **UPDATE ALL**
- No automatic market scanning on page load
- UPDATE ALL scans unique property types sequentially with a visible global progress bar

### Torn API

API-key controls remain at the bottom of Settings. The saved key remains browser-local, is never rendered back into an input, and is sent only in the `Authorization: ApiKey ...` header to `api.torn.com`.

The settings window also displays the script's API safety policy:

- **80 requests / rolling minute maximum**
- **750 ms minimum spacing** between Torn API request starts
- **1.5 second bulk pause** between completed property-type market scans during UPDATE ALL
- **60-second rate-limit cooldown**

## Matching, outlier filtering and pricing example

A listing at `$100,000` for `30 days` becomes:

- `$100,000 / 30 = $3,333.33...` per day
- `$333,333.33...` for 100 days

The same conversion is performed for every exact-upgrade match before outlier protection and before the low, median, arithmetic average and high are calculated.

For example, normalized exact-match totals of `$1`, `$48,000,000`, `$50,000,000`, `$52,000,000`, and `$1,000,000,000` become a trusted sample of `$48,000,000`, `$50,000,000`, and `$52,000,000`. The `$1` and `$1,000,000,000` listings are ignored as extreme outliers.

If the selected basis is Highest at `$52,000,000` and the undercut is `0.5%`:

`proposed rent = floor($52,000,000 * 0.995) = $51,740,000`

If undercut is `0%`, the selected raw basis is used exactly before whole-dollar rounding.

If there are no exact-upgrade matches, only one exact match, or a tiny contradictory sample that cannot be trusted, the manager does not invent a price.

## API pacing and ownership boundary

Every real Torn API request start passes through the shared scheduler for the configured key.

Hard request controls:

- maximum **80 request starts per rolling 60 seconds**
- minimum **750 ms** between Torn API request starts
- automatic owned-property sync makes **no rental-market request**
- UPDATE ALL processes unique property-type rental markets **sequentially**
- UPDATE ALL waits **1.5 seconds between completed property-type scans**
- no overlapping full update scan
- **60-second cooldown** after Torn error 5 / Too many requests before bounded retry
- bounded retry for other transient failures
- pagination continuation URLs accepted only from `https://api.torn.com/v2/`
- API-owner identity verification rejects spouse-owned, other-player-owned and unverified-owner property rows

An individual SCAN MARKET still obtains the verified owned-property state needed to confirm status/ownership, but it refreshes rental-market data only for the selected property's type and does not incur the bulk inter-market delay.

## Install

Install the generated userscript:

`R4G3RUNN3R-Property-Rental-Manager.user.js`
