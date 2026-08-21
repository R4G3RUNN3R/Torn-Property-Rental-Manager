# Torn Property Rental Manager

A standalone Torn.com userscript by **R4G3RUNN3R** for pricing and managing properties you own using Torn's rental market.

## v0.3.7

The manager compares only rental listings for the **same property type with the exact same upgrades/modifications**, normalizes every comparable to an equivalent **100-day total**, filters statistically extreme prices, and then lets the user choose the cleaned market figure used as the pricing basis.

`100-day equivalent = (listing total cost / listing rental period) * 100`

Available pricing bases:

- **Lowest market price**
- **Median market price**
- **Average market price**
- **Highest market price**

The configured undercut percentage is applied to the selected raw figure and the final proposed rent is rounded down to a whole dollar. The default remains **Average market price minus 0.5%**.

### New in v0.3.7

- **UPDATE ALL is deliberately paced.** Rental markets are scanned one property type at a time instead of starting every unique property type concurrently.
- Bulk scans wait **1.5 seconds between completed property-type market scans**, on top of the existing shared **750 ms minimum request-start spacing** and **80 requests per rolling minute** ceiling.
- Pagination for the current property type is allowed to finish before the next property type begins, reducing the chance of several market scans piling into the Torn API at once.
- **UPDATE ALL now has a real global progress bar** showing completed rental markets such as `3 / 12` and a percentage.
- The bar follows actual market completion events and survives the manager's full-panel rerenders while a bulk update is active.
- Individual **UPDATE** remains isolated to the selected property and is not slowed by the new bulk-only pacing.
- Existing manual-update defaults, cancellation safety, outlier protection and PREPARE RENTAL → LIST PROPERTY safeguards remain unchanged.

### New in v0.3.6

- **Outlier protection is always enabled.** Exact-upgrade rental listings are normalized to 100 days before any price is judged.
- With three or more exact matches, prices more than **5× above** or below **1/5 of** the median are excluded first, then a **1.5× IQR** filter removes remaining statistical extremes where the sample is large enough.
- Lowest / Median / Average / Highest and the proposed rent are calculated only from the trusted sample.
- With exactly two exact matches, values more than **5× apart** are treated as **PRICE DATA TOO INCONSISTENT** and no automatic rent is proposed.
- With only one exact match, the card reports **INSUFFICIENT MARKET SAMPLE** and no automatic rent is proposed.
- Property cards show **Exact matches / Used / Outliers ignored**, so excluded listings are visible rather than silently discarded.
- Outlier filtering is local and adds **no Torn API requests**.

### New in v0.3.5

- **Individual UPDATE is isolated:** only the selected property card receives fresh property state, rental-market data and a new timestamp. Another property of the same type keeps its previous snapshot until you update it.
- Each selected property now shows a visible **search/update progress bar** while its refresh is running.
- Settings now exposes explicit **MANUAL** and **AUTOMATIC** update-mode buttons. MANUAL remains the default; AUTOMATIC still means one UPDATE ALL on Properties page load, never background polling.
- The real gear-button settings path is now covered, so update-mode controls appear when Settings is opened normally.
- Rental cancellation now notices Torn controls rendered asynchronously and searches the full native page instead of assuming a particular market container.
- Torn's native removal confirmation is handled as another explicit stage: **CANCEL LISTING → CONFIRM CANCEL LISTING → FINAL CONFIRM CANCEL** when Torn presents its confirmation dialog. No observer, timer or callback may click a native cancellation control.
- Existing **80 requests per rolling minute**, **750 ms minimum spacing**, 60-second rate-limit cooldown and PREPARE RENTAL → LIST PROPERTY safety rules remain unchanged.

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
- **UPDATE ALL** refreshes all verified owned properties and their relevant rental markets sequentially

During UPDATE ALL, the manager displays a global progress bar showing how many unique rental markets have completed. Bulk market scans pause 1.5 seconds between property types.

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
5. If Torn presents a native confirmation dialog, the script exposes **FINAL CONFIRM CANCEL** and only that additional explicit click may confirm it.
6. The card shows **CANCELLATION SENT** and requires **UPDATE PROPERTY**.
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

- Automatic page update: OFF / ON
- Default: **OFF**
- OFF keeps updates completely manual
- ON performs one UPDATE ALL on Properties page load
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
- UPDATE ALL processes unique property-type rental markets **sequentially**
- UPDATE ALL waits **1.5 seconds between completed property-type scans**
- no overlapping full update scan
- **60-second cooldown** after Torn error 5 / Too many requests before bounded retry
- bounded retry for other transient failures
- pagination continuation URLs accepted only from `https://api.torn.com/v2/`
- one API client/scheduler per configured key
- API-owner identity verification rejects spouse-owned, other-player-owned and unverified-owner property rows

An individual property update still obtains the verified owned-property state needed to confirm status/ownership, but it refreshes rental-market data only for the selected property's type and does not incur the bulk inter-market delay.

## Install

Install the generated userscript:

`R4G3RUNN3R-Property-Rental-Manager.user.js`
