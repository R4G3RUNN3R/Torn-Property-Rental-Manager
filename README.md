# Torn Property Rental Manager

A standalone Torn.com userscript by **R4G3RUNN3R** for pricing and managing properties you own using Torn's rental market.

## v0.3.4

The manager compares only rental listings for the **same property type with the exact same upgrades/modifications**, normalizes every comparable to an equivalent **100-day total**, and lets the user choose the market figure used as the pricing basis.

`100-day equivalent = (listing total cost / listing rental period) * 100`

Available pricing bases:

- **Lowest market price**
- **Median market price**
- **Average market price**
- **Highest market price**

The configured undercut percentage is applied to the selected raw figure and the final proposed rent is rounded down to a whole dollar. The default remains **Average market price minus 0.5%**.

### New in v0.3.4

- **Manual updates by default.** Opening Torn's Properties page or opening the manager does not automatically refresh Torn API data.
- Every property card has its own **UPDATE** action.
- The title bar has **UPDATE ALL** for a deliberate full refresh.
- The manager stores the last known property and market snapshot locally, so it can reopen with useful cached information without making an API request.
- Each property displays a **Last updated** time.
- An individual property update refreshes verified owned-property state and scans only that property's rental-market type.
- Settings includes **Automatic page update**, default **OFF**. When enabled, it performs one UPDATE ALL when Torn's Properties page loads. It does not poll in the background.
- Properties with status **for_rent** expose a staged cancellation flow: **CANCEL LISTING → CONFIRM CANCEL LISTING**.
- The cancellation confirmation may click Torn's recognized native remove-from-market control exactly once and only from the explicit user action.
- After a cancellation is sent, the script does **not** silently refresh. **UPDATE PROPERTY** must be pressed to verify Torn has returned the property to an available state before repricing/relisting.
- Properties with an active **rented** lease do not expose cancellation; the UI states that the active lease cannot be cancelled through this workflow.
- Shared Torn API pacing is now **80 request starts per rolling 60 seconds** with at least **750 ms between request starts**.
- Torn rate-limit responses still trigger the existing **60-second cooldown** before bounded retry.

## Updates

### Manual mode, default

When **Automatic page update** is OFF:

- opening `properties.php` makes no automatic property/market refresh
- opening Property Rental Manager makes no automatic property/market refresh
- **UPDATE** refreshes one property
- **UPDATE ALL** refreshes all verified owned properties and their relevant rental markets

The most recent saved snapshot remains visible between page visits.

### Automatic page update, optional

Settings includes:

**Automatic page update: OFF / ON**

When enabled, the script performs one **UPDATE ALL** when the Torn Properties page loads. This is a one-shot page-load refresh, not background polling. SPA rerenders, MutationObservers, timers and repeated DOM changes do not start extra API refreshes.

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
5. The card shows **CANCELLATION SENT** and requires **UPDATE PROPERTY**.
6. Once Torn reports the property as available again, normal pricing and **PREPARE RENTAL → LIST PROPERTY** can be used to relist it at the newly calculated price.

A property whose status is **rented** does not receive a cancel-listing action.

## Pricing settings

Open the gear button in the manager title bar.

### Pricing

- Rental period: **100 days fixed**
- Pricing basis: Lowest / Median / Average / Highest
- Undercut: **0% to 25%**
- Default: **Average minus 0.5%**

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

- Automatic page update: OFF / ON
- Default: **OFF**
- OFF keeps updates completely manual
- ON performs one UPDATE ALL on Properties page load

### Torn API

API-key controls remain at the bottom of Settings. The saved key remains browser-local, is never rendered back into an input, and is sent only in the `Authorization: ApiKey ...` header to `api.torn.com`.

The settings window also displays the script's API safety policy:

- **80 requests / rolling minute maximum**
- **750 ms minimum spacing**
- **60-second rate-limit cooldown**

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

Every real Torn API request start passes through the shared scheduler for the configured key.

Hard request controls:

- maximum **80 request starts per rolling 60 seconds**
- minimum **750 ms** between Torn API request starts
- no overlapping full update scan
- **60-second cooldown** after Torn error 5 / Too many requests before bounded retry
- bounded retry for other transient failures
- pagination continuation URLs accepted only from `https://api.torn.com/v2/`
- one API client/scheduler per configured key
- API-owner identity verification rejects spouse-owned, other-player-owned and unverified-owner property rows

An individual property update still obtains the verified owned-property state needed to confirm status/ownership, but it refreshes rental-market data only for the selected property's type.

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
6. Save the key.
7. Press **UPDATE ALL** to load the first snapshot.

## Safety boundary

The userscript does not perform unattended native Torn listing or cancellation actions.

- Market/property reads use Torn API requests through the shared scheduler.
- **PREPARE RENTAL** is a manual user action that fills the matching visible native lease form.
- **LIST PROPERTY** is a second manual action that verifies visible prepared values before one native listing click.
- **CANCEL LISTING** only prepares/navigates the cancellation flow.
- **CONFIRM CANCEL LISTING** is the explicit action allowed to click Torn's recognized native remove-from-market control once.
- Cancellation does not automatically trigger an API verification refresh.
- Automatic page update, when enabled, only performs read/update requests. It never submits a native listing or cancellation action.
- No CAPTCHA handling, external backend or telemetry is used.

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
- `src/api-core.js` - Torn API client, owner lookup, pagination, caching, cooldown and shared request scheduling
- `src/draft-core.js` - short-lived property-specific lease drafts
- `src/form-core.js` - native lease preparation/verification plus explicit native cancellation recognition/action
- `src/app.js` - stable rental-manager controller and base rendering
- `src/ui-core-v033.js` - v0.3.3 pricing/sorting/settings helpers
- `src/app-v033.js` - v0.3.3 settings window, sorting and presentation layer
- `src/update-core-v034.js` - v0.3.4 update preferences and saved snapshot storage
- `src/app-v034.js` - v0.3.4 manual update controls, timestamps and cancellation/relisting UI
- `src/bootstrap.js` - userscript startup, Torn transport, launcher, page-load update policy and native action bridges
- `tests/` - Node test suite
- `scripts/build-userscript.js` - deterministic single-file userscript builder

## v0.3.4 non-goals

This release does not buy properties, scan the property sale market for investments, cancel an already-active rental lease, automatically reprice already-listed properties without user actions, submit lease extensions, or submit/cancel listings without the user's explicit native-action confirmation.