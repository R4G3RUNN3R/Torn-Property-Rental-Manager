# Torn Property Rental Manager

A standalone Torn.com userscript by **R4G3RUNN3R** for pricing and listing properties you own using the Torn rental market.

## What v0.3.1 does

For each property positively verified as belonging to the API-key owner, the manager:

1. Scans the Torn rental market for the same property type.
2. Keeps only listings with the **exact same modification / upgrade set** as your property.
3. Accepts comparable rentals of any duration.
4. Converts every comparable to an equivalent **100-day rental total**:

   `100-day equivalent = (listing total cost / listing rental period) * 100`

5. Shows the **lowest**, **highest**, and **average** 100-day totals across the exact matches.
6. Proposes a 100-day rental amount at **0.5% below the average** by default:

   `proposed rent = floor(average 100-day total * 0.995)`

7. Keeps listing as two explicit user actions:
   - **SET PRICE** stores the proposed 100-day total, opens the matching native Torn lease page, and fills the period and price.
   - **LIST PROPERTY** becomes available only for the matching prepared Torn form and triggers one native listing click.

If the market contains no exact-upgrade matches, the manager does not invent a price.

### New in v0.3.1

- Uses the same conservative pacing as Recruitment Agency: **75 Torn API request starts per rolling 60 seconds** and at least **800 ms between request starts**.
- Reuses one API client/scheduler for the configured key instead of creating a fresh allowance on every refresh or retry.
- Prevents overlapping full scans from running at the same time.
- Torn error code **5 / Too many requests** causes a full **60-second cooldown** before a bounded retry instead of immediately hitting the API again.
- Reads and caches the API-key owner's user ID from Torn, then accepts only property rows whose owner ID exactly matches it.
- Spouse-owned, other-player-owned, and unverified-owner rows are discarded before market scanning.
- Adds a visible bottom-right **resize handle** while retaining native desktop resize support; saved width and height persist.
- Shows a compact Torn-hosted property artwork thumbnail beside each property without making another Torn API call for the image.

### Included from v0.3

- Faster market scans: unique property-type requests are queued together while the scheduler controls request starts.
- Progressive `done / total` scan status.
- Partial market failures remain isolated and can be retried with **RETRY MARKET**.
- Normal **Refresh** reuses fresh cached market data.
- **Force Market Refresh** bypasses the rental-market cache deliberately.
- Rentable properties appear first.
- Cached/live market-source indicators.
- Persistent **Minimize**, **Close**, window position and dimensions.
- Torn **Information** launcher with floating fallback and SPA rerender recovery.

## Install

The generated installable userscript is:

`R4G3RUNN3R-Property-Rental-Manager.user.js`

Main-branch raw userscript:

`https://raw.githubusercontent.com/R4G3RUNN3R/Torn-Property-Rental-Manager/main/R4G3RUNN3R-Property-Rental-Manager.user.js`

The script deliberately remains scoped to:

`https://www.torn.com/properties.php*`

## First setup

1. Install the userscript in Tampermonkey or another compatible userscript manager.
2. Open Torn's Properties page.
3. Open **Settings** in Property Rental Manager.
4. Enter a **Limited-or-higher Torn API key**.
5. Save settings and press **Refresh**.

The saved key remains browser-local. The settings UI never renders the saved key back into the page, and the key is sent only in the `Authorization: ApiKey ...` header to `api.torn.com`.

## Ownership boundary

The property request uses Torn's `ownedByUser` filter. v0.3.1 adds defense in depth by also resolving the API-key owner's user ID once and checking each returned property row locally.

When the user ID is known, a property is accepted only when its owner ID exactly equals that user ID. A spouse ID, another player ID, or a missing owner ID is rejected rather than guessed to be yours.

## Rental workflow

For an owned property whose status is `none`, a priced row includes:

- property artwork
- exact matches
- lowest 100-day rent
- highest 100-day rent
- average 100-day rent
- proposed 100-day rent
- market source: Cached or Live
- **SET PRICE**
- **LIST PROPERTY**

Properties already rented, listed for rent, for sale, or in use do not receive new-rental actions.

### SET PRICE

Pressing **SET PRICE**:

- saves one short-lived property-specific draft
- fixes the rental period at **100 days**
- preserves the exact proposed total amount
- opens Torn's native lease page for that property
- fills the visible lease-period and total-cost fields

The draft stays armed after the fields are prepared so the manager can enable the second action.

### LIST PROPERTY

**LIST PROPERTY** is disabled until all of these are true:

- you are on the matching property's native lease route
- the matching short-lived draft still exists
- Torn's visible lease form is recognized
- Torn's native listing control exists and is enabled

Only your explicit **LIST PROPERTY** click triggers that native control, exactly once. Opening the page, refreshing it, or the form becoming visible never submits the listing automatically.

## Matching and pricing

A comparable is accepted only when its modification set exactly matches your property's modification set. Matching is order-independent.

Different rental durations are allowed because every listing is normalized to the same 100-day basis before comparison.

Example:

- Market listing: `$100,000` for `30 days`
- Daily equivalent: `$100,000 / 30 = $3,333.33...`
- 100-day equivalent: `$333,333.33...`

The manager performs this conversion for every exact match, then calculates the low, high and arithmetic average. The final proposed amount is the raw average reduced by the configured undercut percentage and rounded down to a whole dollar.

Default settings:

- rental period: **100 days** fixed
- average undercut: **0.5%**

## Refresh, resilience and API pacing

A normal **Refresh** reuses fresh rental-market cache entries. **Force Market Refresh** bypasses that cache deliberately.

Market types can be queued together, but every real Torn API request start passes through one shared client scheduler for the configured API key.

Hard request controls:

- minimum **800 ms** between Torn API request starts
- maximum **75 request starts per rolling 60 seconds**
- no overlapping full refresh scan
- **60-second cooldown** after Torn error 5 / Too many requests before retry
- bounded retries for other transient failures
- pagination continuation URLs accepted only from `https://api.torn.com/v2/`
- rental-market responses read from Torn's current `rentals.listings[]` structure

If one property type fails after retries, that failure remains isolated to the affected type. Other completed markets stay displayed and usable.

## Interface

- focused property-by-property landlord view
- compact Torn-hosted property artwork thumbnails
- rentable properties first
- fixed 100-day pricing
- exact-upgrade match counts
- low / high / average / proposed 100-day totals
- cached/live source indicator
- progressive scan status
- per-market retry on failure
- movable desktop panel
- native browser resize plus a visible bottom-right resize handle
- persistent desktop position, dimensions and open/minimized/closed state
- Minimize and Close titlebar controls
- Torn Information launcher plus floating fallback
- responsive mobile layout
- dark and light themes
- readable dark-mode text with green accents

## Safety boundary

The userscript does not perform unattended native Torn actions.

- Market scanning uses Torn API requests.
- **SET PRICE** is a manual user action that navigates to and fills the visible native lease form.
- **LIST PROPERTY** is a second manual user action that causes one native listing click on that active page.
- No automatic listing occurs on page load, timers, observers, refreshes, or background loops.
- No CAPTCHA handling, external backend, or telemetry is used.

## Development

Requires Node.js `>=20.19.0`.

```bash
npm install
npm test
npm run build
npm run verify
```

GitHub Actions runs the full test suite, JavaScript syntax checks, and verifies that the committed userscript exactly matches the deterministic build output.

## Repository structure

- `src/property-core.js` - property normalization, verified-owner filtering, artwork URL mapping and lease eligibility
- `src/market-core.js` - exact-upgrade matching and normalized 100-day rental quotes
- `src/api-core.js` - Torn API client, owner lookup, pagination, caching, market orchestration, cooldown and request scheduling
- `src/draft-core.js` - short-lived property-specific lease drafts with exact total preservation
- `src/form-core.js` - native lease field preparation and explicit user-triggered listing action
- `src/app.js` - rental-manager UI, persistent client lifetime, window state, resizing and progressive market display
- `src/bootstrap.js` - userscript startup, Torn-only API transport, launcher integration and native-form bridge
- `tests/` - Node test suite
- `scripts/build-userscript.js` - deterministic single-file userscript builder

## v0.3.1 non-goals

This release does not buy properties, scan the property sale market for investments, automatically reprice already-listed properties, submit lease extensions, or submit listings without the user's explicit listing click.
