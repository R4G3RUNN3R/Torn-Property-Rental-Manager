# Torn Property Rental Manager

A standalone Torn.com userscript by **R4G3RUNN3R** for pricing and listing properties you own using Torn's rental market.

## v0.3.3

The manager scans rentals for the same property type, keeps only listings with the **exact same upgrades/modifications**, and normalizes every accepted listing to an equivalent **100-day rental total**:

`100-day equivalent = (listing total cost / listing rental period) * 100`

It then exposes four market figures:

- **Lowest market price**
- **Median market price**
- **Average market price**
- **Highest market price**

The user chooses which figure should be the pricing basis. The configured undercut percentage is applied to that selected raw market figure and the final proposed rent is rounded down to a whole dollar.

Default behavior remains **Average market price minus 0.5%**, so upgrading from v0.3.2 does not silently change the pricing strategy.

### New in v0.3.3

- Pricing-basis dropdown: **Lowest / Median / Average / Highest**.
- Configurable undercut percentage, including **0%** to use the selected market basis exactly.
- Property cards display low, median, average, high and the formula used for the proposed 100-day rent.
- Property sorting options: Recommended, name A-Z/Z-A, proposed rent high/low, happiness high/low and Property ID.
- Properties already listed for rent stay below unlisted properties regardless of the chosen sort.
- A successfully submitted listing is marked **LISTED FOR RENT** and moved to the absolute bottom immediately, without waiting for another Torn API scan.
- Failed listing attempts do not change property order or listed state.
- The main desktop title bar is a larger drag surface while controls remain excluded from dragging.
- Main-window movement is constrained to keep the manager recoverable on-screen.
- The existing resize behavior and persisted desktop geometry remain intact.
- Inline settings are replaced by a **gear button** that opens a separate settings window.
- The Settings window is independently movable/resizable on desktop and responsive on mobile.
- Appearance settings: Dark/Light theme, Comfortable/Compact density, property images Show/Hide and Full/Compact market detail.
- API-key controls live at the bottom of Settings. A stored API key is never rendered back into the DOM.
- Cleaner cards, stronger price hierarchy, status badges, spacing and restrained Torn-adjacent styling.

## Rental safety workflow

v0.3.3 deliberately preserves the v0.3.2 staged native workflow.

1. **PREPARE RENTAL** stores the exact proposed 100-day total, opens the matching Torn lease page and fills Torn's visible rental-period and total-cost inputs.
2. **LIST PROPERTY** is a second explicit user action. It verifies the route, draft, visible values and native Torn listing control before clicking Torn's native final button exactly once.

If the visible Torn days or total are changed after preparation, LIST PROPERTY refuses to submit and leaves the user's edited values untouched. **PREPARE RENTAL** must be pressed again deliberately.

No timer, MutationObserver, page load, refresh, retry callback or form-preparation step may trigger the native final listing action.

## Settings

Open the gear button in the manager title bar.

### Pricing

- Rental period: **100 days fixed**
- Pricing basis: Lowest / Median / Average / Highest
- Undercut: **0% to 25%**
- Default: **Average minus 0.5%**

Changing pricing settings recalculates already-loaded market data immediately. It does not make an unnecessary market API request just to change the formula.

### Property sorting

- Recommended
- Property name A → Z
- Property name Z → A
- Proposed rent: highest first
- Proposed rent: lowest first
- Happiness: highest first
- Happiness: lowest first
- Property ID

Listed-for-rent properties remain in the bottom group. A property successfully listed during the current session is placed after that group immediately.

### Appearance

- Dark / Light theme
- Comfortable / Compact card density
- Show / Hide property images
- Full / Compact market detail

### Torn API

API-key controls are kept at the bottom of the Settings window. The saved key remains browser-local, is never rendered back into an input, and is sent only in the `Authorization: ApiKey ...` header to `api.torn.com`.

## Matching and pricing example

A listing at `$100,000` for `30 days` becomes:

- `$100,000 / 30 = $3,333.33...` per day
- `$333,333.33...` for 100 days

The same conversion is performed for every exact-upgrade match before the low, median, arithmetic average and high are calculated.

If the selected basis is Highest at `$360,000` and the undercut is `0.5%`:

`proposed rent = floor($360,000 * 0.995) = $358,200`

If undercut is `0%`, the selected raw basis is used exactly before whole-dollar rounding.

If there are no exact-upgrade matches, the manager does not invent a price.

## API pacing and ownership boundary

The manager retains the v0.3.1 safeguards:

- **75 Torn API request starts per rolling 60 seconds**
- at least **800 ms between request starts**
- no overlapping full scans
- **60-second cooldown** after Torn error 5 / Too many requests before bounded retry
- pagination continuation URLs accepted only from `https://api.torn.com/v2/`
- one API client/scheduler per configured key
- API-owner identity verification rejects spouse-owned, other-player-owned and unverified-owner property rows

Normal **Refresh** reuses fresh rental-market cache entries. **Force Market Refresh** deliberately bypasses the market cache.

## Install

Install the generated userscript:

`R4G3RUNN3R-Property-Rental-Manager.user.js`

Main-branch raw userscript:

`https://raw.githubusercontent.com/R4G3RUNN3R/Torn-Property-Rental-Manager/main/R4G3RUNN3R-Property-Rental-Manager.user.js`

The userscript is deliberately scoped to:

`https://www.torn.com/properties.php*`

## First setup

1. Install the userscript in Tampermonkey or another compatible userscript manager.
2. Open Torn's Properties page.
3. Open Property Rental Manager.
4. Click the **gear**.
5. Enter a **Limited-or-higher Torn API key** in the API section at the bottom.
6. Save the key and refresh property data.

## Development

Requires Node.js `>=20.19.0`.

```bash
npm install
npm test
npm run build
npm run verify
```

GitHub Actions runs the full test suite, JavaScript syntax checks and deterministic userscript build-parity verification.

## Repository structure

- `src/property-core.js` - property normalization, verified-owner filtering, artwork URL mapping and lease eligibility
- `src/market-core.js` - exact-upgrade matching, normalized 100-day market figures and selectable pricing basis
- `src/api-core.js` - Torn API client, owner lookup, pagination, caching, cooldown and request scheduling
- `src/draft-core.js` - short-lived property-specific lease drafts with exact total preservation
- `src/form-core.js` - native lease preparation, visible-value verification and explicit user-triggered final listing
- `src/app.js` - stable v0.3.2 rental-manager controller and staged UI foundation
- `src/ui-core-v033.js` - v0.3.3 settings normalization, sorting and viewport rules
- `src/app-v033.js` - v0.3.3 settings window, presentation layer, pricing strategy integration and immediate listed-state UI
- `src/bootstrap.js` - userscript startup, Torn-only transport, launcher integration and native-form bridge
- `tests/` - Node test suite
- `scripts/build-userscript.js` - deterministic single-file userscript builder

## Non-goals

The script does not buy properties, automatically reprice already-listed properties, submit lease extensions, bypass Torn controls, handle CAPTCHAs, or submit listings without the user's explicit verified LIST PROPERTY action.
