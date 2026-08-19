# Torn Property Rental Manager

A standalone Torn.com userscript by **R4G3RUNN3R** for pricing and listing properties you own using the Torn rental market.

## What v0.3.2 does

For each property positively verified as belonging to the API-key owner, the manager:

1. Scans the Torn rental market for the same property type.
2. Keeps only listings with the **exact same modification / upgrade set** as your property.
3. Accepts comparable rentals of any duration.
4. Converts every comparable to an equivalent **100-day rental total**:

   `100-day equivalent = (listing total cost / listing rental period) * 100`

5. Shows the **lowest**, **highest**, and **average** 100-day totals across the exact matches.
6. Proposes a 100-day rental amount at **0.5% below the average** by default:

   `proposed rent = floor(average 100-day total * 0.995)`

7. Uses a staged two-click native Torn rental workflow:
   - **PREPARE RENTAL** stores the proposed 100-day total, opens the matching native Torn lease page, waits for Torn's form to appear, then fills the period and exact total.
   - **LIST PROPERTY** becomes available only when the matching draft, route, visible values and native Torn submit control all verify correctly.

If the market contains no exact-upgrade matches, the manager does not invent a price.

### New in v0.3.2

- Renames the first rental action to **PREPARE RENTAL** to make the two-stage workflow explicit.
- Fills Torn's native lease inputs using the native `HTMLInputElement.value` setter.
- Dispatches `input`, `change`, `keyup` and `blur` after each prepared value so Torn's own UI code sees the update.
- Keeps the existing short wait/retry bridge while Torn's SPA renders the lease form.
- Shows **READY TO LIST** when the current Torn form is still armed and verified for that property.
- Adds a verification-only second stage: **LIST PROPERTY no longer rewrites the form before submitting**.
- The visible Torn rental days and total cost must still exactly match the prepared draft before the final native listing click is allowed.
- Harmless Torn formatting such as `$331,667` is accepted as the same value.
- If you manually change the days or total after preparation, listing is blocked, the edited values are left untouched, and the inline status tells you to press **PREPARE RENTAL** again.
- A failed verification keeps the short-lived draft available so re-preparing is deliberate rather than destructive.
- The final native listing button is still clicked exactly once and only from the user's explicit **LIST PROPERTY** action.

### Included from v0.3.1

- Conservative pacing: **75 Torn API request starts per rolling 60 seconds** and at least **800 ms between request starts**.
- One API client/scheduler per configured key instead of resetting the request allowance on every refresh.
- No overlapping full scans.
- Torn error code **5 / Too many requests** causes a **60-second cooldown** before bounded retry.
- API-owner identity verification rejects spouse-owned, other-player-owned and unverified-owner property rows.
- Visible persistent desktop resize handle.
- Torn-hosted property artwork thumbnails without extra Torn API calls.

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

The property request uses Torn's `ownedByUser` filter. The manager also resolves the API-key owner's user ID once and checks each returned property row locally.

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
- **PREPARE RENTAL**
- **LIST PROPERTY**

Properties already rented, listed for rent, for sale, or in use do not receive new-rental actions.

### PREPARE RENTAL

Pressing **PREPARE RENTAL**:

- saves one short-lived property-specific draft
- fixes the rental period at **100 days**
- preserves the exact proposed total amount
- opens Torn's native lease page for that property
- waits for the visible lease form when Torn's SPA is still rendering it
- fills the visible lease-period and total-cost fields using the native input value setter
- dispatches `input`, `change`, `keyup` and `blur` for both fields
- leaves Torn's native listing button untouched

When the form, route and values verify correctly, the manager shows **READY TO LIST**.

### LIST PROPERTY

**LIST PROPERTY** is allowed only when all of these are true:

- you are on the matching property's native lease route
- the matching short-lived draft still exists
- Torn's visible lease form is recognized
- the visible rental period still equals the prepared **100 days**
- the visible total cost still equals the exact prepared total
- Torn's native listing control exists and is enabled

The second click performs verification only. It does **not** re-fill or silently correct the form.

If either visible value changed, submission is refused and the user's edited Torn values remain exactly as they are. The prepared draft remains available so **PREPARE RENTAL** can be pressed again deliberately.

Only an explicit **LIST PROPERTY** click can trigger Torn's native listing control, exactly once. Opening the page, the form appearing, a timer firing, a MutationObserver running, or a refresh never submits anything.

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
- staged **PREPARE RENTAL → READY TO LIST → LIST PROPERTY** workflow
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
- **PREPARE RENTAL** is a manual user action that navigates to and fills the visible native lease form.
- Form waiting/retry logic may locate and fill the form, but never triggers the listing button.
- **LIST PROPERTY** is a second manual user action that first verifies the still-visible prepared values and then causes one native listing click.
- No automatic listing occurs on page load, timers, observers, refreshes, background loops, or form preparation.
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
- `src/form-core.js` - native lease preparation, native event dispatch, visible-value verification and explicit user-triggered listing action
- `src/app.js` - rental-manager UI, persistent client lifetime, window state, resizing and progressive market display
- `src/bootstrap.js` - userscript startup, Torn-only API transport, launcher integration, staged-rental UI decoration and native-form bridge
- `tests/` - Node test suite
- `scripts/build-userscript.js` - deterministic single-file userscript builder

## v0.3.2 non-goals

This release does not buy properties, scan the property sale market for investments, automatically reprice already-listed properties, submit lease extensions, or submit listings without the user's explicit verified listing click.
