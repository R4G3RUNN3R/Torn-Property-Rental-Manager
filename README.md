# Torn Property Rental Manager

A standalone Torn.com userscript by **R4G3RUNN3R** for scanning properties you own, comparing the current Torn rental market, recommending competitive lease pricing, and preparing Torn's native lease form for manual submission.

## Install

Install the userscript from the feature branch while v0.1.0 is under review:

`https://raw.githubusercontent.com/R4G3RUNN3R/Torn-Property-Rental-Manager/feature/initial-implementation/R4G3RUNN3R-Property-Rental-Manager.user.js`

The script matches only:

`https://www.torn.com/properties.php*`

## What it does

- Loads **only properties owned by your API-key account** using Torn API v2 `filters=ownedByUser`.
- Scans rental listings only for property types you actually own.
- Reuses Torn rental-market cache timing where available instead of hammering the API.
- Scores comparable rentals by property happy and modifications.
- Removes obvious price outliers before pricing.
- Recommends a competitive daily rent using a configurable market-floor undercut and median safety floor.
- Shows confidence based on comparable count and similarity.
- Tracks `none`, `in_use`, `for_sale`, `rented`, and `for_rent` states.
- Shows current renter, remaining rental time, current asking rent, and interested renter details when Torn provides them.
- Creates one pending lease draft when you explicitly press **Prepare Lease**.
- Opens the native Torn property lease page and fills the visible lease period and total cost.
- Leaves Torn's final native submission entirely to you.

## First setup

1. Install the userscript in Tampermonkey or another compatible userscript manager.
2. Open Torn's Properties page.
3. Open **Settings** in Property Rental Manager.
4. Enter a **Limited-or-higher Torn API key**.
5. Save settings and refresh the manager.

The saved key remains browser-local. The settings UI never renders a saved key back into the page, and the key is sent only in the `Authorization: ApiKey ...` header to `api.torn.com`.

## Simple mode

Simple mode focuses on the useful bits without requiring an economics degree to rent out a virtual house:

- property and status
- happy
- market floor per day
- recommended rent per day
- lease period
- projected lease value
- pricing confidence
- **Prepare Lease** for eligible properties

## Advanced mode

Advanced mode adds:

- market median, Q1 and Q3
- comparable count
- average similarity
- modification list
- market timestamp and cache/API source
- current rental/listing details for rented and for-rent properties
- per-property daily-price override
- configurable undercut percentage
- configurable median safety ratio

## Pricing method

Comparables use the same property type and are scored with:

- **70% happy similarity**
- **30% modification similarity** using Jaccard set similarity

Selection widens from similarity `>= 0.90`, to `>= 0.75`, then to the ten best same-type matches when the market is sparse. At most 30 comparables are used.

Positive daily prices are cleaned with Tukey IQR filtering when enough data exists.

Defaults:

- market-floor undercut: **0.5%**
- minimum median ratio: **70%**
- lease period: **30 days**

The default recommendation is:

`max(floor(marketFloor * 0.995), floor(median * 0.70))`

You can override the daily price for an individual eligible property in Advanced mode before pressing **Prepare Lease**.

## Refresh and API pacing

The normal scanner reuses fresh local rental-market cache data. **Refresh** bypasses that local freshness decision and asks the Torn API again, while still going through the shared rate scheduler.

Hard request controls:

- minimum **800 ms** between Torn API request starts
- maximum **75 requests per rolling 60 seconds**
- bounded retries for transient failures
- pagination continuation URLs accepted only from `https://api.torn.com/v2/`

## Lease workflow and safety boundary

The script deliberately does **not** auto-submit leases.

The supported workflow is:

1. The manager scans and prices using Torn API data.
2. You press **Prepare Lease** on one eligible property.
3. The script stores one short-lived session draft and opens that property's native lease page.
4. The visible native lease form is filled with the selected days and total cost.
5. **You review and submit Torn's native form yourself.**

The userscript contains no automatic native lease submission, no programmatic click on the final Torn action control, no CAPTCHA handling, no background non-API Torn requests, no external backend, and no telemetry.

## Interface

- movable and resizable desktop panel
- persistent desktop geometry
- responsive full-screen-style mobile fallback
- Simple / Advanced modes
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

The generated installable file is:

`R4G3RUNN3R-Property-Rental-Manager.user.js`

GitHub Actions runs the full test suite, JavaScript syntax checks, and verifies that the committed userscript exactly matches the deterministic build output.

## Repository structure

- `src/property-core.js` - owned property normalization and lease eligibility
- `src/market-core.js` - comparable selection and pricing statistics
- `src/api-core.js` - Torn API client, pagination, caching and rate scheduling
- `src/draft-core.js` - short-lived pending lease drafts
- `src/form-core.js` - safe visible-form field preparation
- `src/app.js` - manager UI and orchestration
- `src/bootstrap.js` - userscript startup and Torn-only network adapter
- `tests/` - Node test suite
- `scripts/build-userscript.js` - deterministic single-file userscript builder

## v0.1.0 non-goals

This release does not auto-buy properties, scan the property sale market for investments, auto-submit leases, automatically reprice existing listings, auto-submit lease extensions, or use an external shared-pricing service.
