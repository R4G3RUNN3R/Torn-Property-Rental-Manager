# Torn Property Rental Manager

A standalone Torn.com userscript by **R4G3RUNN3R** for pricing and listing properties you own using the Torn rental market.

## What v0.3 does

For each owned property, the manager:

1. Scans the Torn rental market for the same property type.
2. Keeps only listings with the **exact same modification / upgrade set** as your property.
3. Accepts comparable rentals of any duration.
4. Converts every comparable to an equivalent **100-day rental total**:

   `100-day equivalent = (listing total cost / listing rental period) * 100`

5. Shows the **lowest**, **highest**, and **average** 100-day totals across the exact matches.
6. Proposes a 100-day rental amount at **0.5% below the average** by default:

   `proposed rent = floor(average 100-day total * 0.995)`

7. Gives an eligible property two explicit actions:
   - **SET PRICE**: stores the proposed 100-day total, opens that property's native Torn lease page, and fills 100 days plus the exact total cost.
   - **LIST PROPERTY**: becomes available only when the matching prepared Torn lease form is visible; your second explicit click triggers the one native listing action.

If the market contains no exact-upgrade matches, the manager does not invent a price.

### New in v0.3

- Faster market scans: unique property-type requests are queued together while the existing scheduler still controls request-start pacing.
- Progressive results and `done / total` scan status while markets finish.
- A failed market no longer destroys the whole scan; successful property types remain usable and failed markets get **RETRY MARKET**.
- Normal **Refresh** reuses fresh cached market data.
- **Force Market Refresh** in Settings explicitly bypasses the market cache.
- Rentable properties are shown first.
- Rows identify whether their market result came from **Cached** or **Live** data.
- Persistent **Minimize** and **Close** controls, while preserving desktop geometry.
- A **Rentals** launcher is inserted into Torn's **Information** area when that structure is available, with a floating fallback if Torn's page layout does not expose it.
- The launcher is automatically restored after Torn SPA DOM rerenders.

## Install

The generated installable userscript is:

`R4G3RUNN3R-Property-Rental-Manager.user.js`

Main-branch raw userscript:

`https://raw.githubusercontent.com/R4G3RUNN3R/Torn-Property-Rental-Manager/main/R4G3RUNN3R-Property-Rental-Manager.user.js`

The script deliberately remains scoped to:

`https://www.torn.com/properties.php*`

That means the Rentals launcher belongs to the Properties area rather than injecting the manager across unrelated Torn pages.

## First setup

1. Install the userscript in Tampermonkey or another compatible userscript manager.
2. Open Torn's Properties page.
3. Open **Settings** in Property Rental Manager.
4. Enter a **Limited-or-higher Torn API key**.
5. Save settings and press **Refresh**.

The saved key remains browser-local. The settings UI never renders the saved key back into the page, and the key is sent only in the `Authorization: ApiKey ...` header to `api.torn.com`.

## Rental workflow

For an owned property whose status is `none`, a priced row includes:

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

Only your explicit **LIST PROPERTY** click triggers that native control, exactly once. Merely opening the page, refreshing it, or the form becoming visible does not submit anything.

## Matching and pricing

A comparable is accepted only when its modification set exactly matches your property's modification set. Matching is order-independent.

Different rental durations are deliberately allowed because every listing is normalized to the same 100-day basis before comparison.

Example:

- Market listing: `$100,000` for `30 days`
- Daily equivalent: `$100,000 / 30 = $3,333.33...`
- 100-day equivalent: `$333,333.33...`

The manager performs this conversion for every exact match, then calculates the low, high and arithmetic average. The final proposed amount is the raw average reduced by the configured undercut percentage and rounded down to a whole dollar.

Default settings:

- rental period: **100 days** (fixed)
- average undercut: **0.5%**

## Refresh, resilience and API pacing

A normal **Refresh** reuses a fresh rental-market cache entry when Torn's cache timing says it is still valid. **Force Market Refresh** bypasses that cache deliberately.

Market types are queued together so network waits can overlap, but actual API request starts still pass through the shared scheduler.

Hard request controls:

- minimum **800 ms** between Torn API request starts
- maximum **75 request starts per rolling 60 seconds**
- bounded retries for transient failures
- pagination continuation URLs accepted only from `https://api.torn.com/v2/`
- rental-market responses read from Torn's current `rentals.listings[]` structure

If one property type fails after retries, that failure is isolated to the affected type. Other completed markets remain displayed and usable.

## Safety boundary

The userscript does not perform unattended native Torn actions.

- Market scanning uses Torn API requests.
- **SET PRICE** is a manual user action that navigates to and fills the visible native lease form.
- **LIST PROPERTY** is a second manual user action that causes one native listing click on that active page.
- No automatic listing occurs on page load, timers, observers, refreshes, or background loops.
- No CAPTCHA handling, external backend, or telemetry is used.

## Interface

- focused property-by-property landlord view
- rentable properties first
- fixed 100-day rental pricing
- exact-upgrade match counts
- low / high / average / proposed 100-day totals
- cached/live source indicator
- progressive scan status
- per-market retry on failure
- movable and resizable desktop panel
- persistent desktop geometry and open/minimized/closed state
- Minimize and Close titlebar controls
- Torn Information launcher plus floating fallback
- responsive mobile layout
- dark and light themes
- readable dark-mode text with green accents

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

- `src/property-core.js` - owned property normalization and lease eligibility
- `src/market-core.js` - exact-upgrade matching and normalized 100-day rental quotes
- `src/api-core.js` - Torn API client, current rental response parsing, pagination, caching, concurrent market orchestration and rate scheduling
- `src/draft-core.js` - short-lived property-specific lease drafts with exact total preservation
- `src/form-core.js` - native lease field preparation and explicit user-triggered listing action
- `src/app.js` - rental-manager UI, window state, progressive market display and two-button orchestration
- `src/bootstrap.js` - userscript startup, Torn-only API transport, launcher integration and live native-form bridge
- `tests/` - Node test suite
- `scripts/build-userscript.js` - deterministic single-file userscript builder

## v0.3 non-goals

This release does not buy properties, scan the property sale market for investments, automatically reprice already-listed properties, submit lease extensions, or submit listings without the user's explicit listing click.
