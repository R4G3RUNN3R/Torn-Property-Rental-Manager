// ==UserScript==
// @name         R4G3RUNN3R Property Rental Manager
// @namespace    https://github.com/R4G3RUNN3R
// @version      0.3.2
// @description  Price owned Torn rentals from exact market matches and list them through an explicit two-click workflow.
// @author       R4G3RUNN3R
// @match        https://www.torn.com/properties.php*
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @run-at       document-idle
// ==/UserScript==

/* ===== src/property-core.js ===== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PROPERTY_IMAGE_BASE = 'https://www.torn.com/images/v2/properties/350x230/350x230_default_';
  const PROPERTY_IMAGE_SLUGS = Object.freeze({
    'trailer': 'trailer',
    'apartment': 'apartment',
    'semi-detached house': 'semi_detached',
    'detached house': 'detached',
    'beach house': 'beach_house',
    'chalet': 'chalet',
    'villa': 'villa',
    'penthouse': 'penthouse',
    'mansion': 'mansion',
    'ranch': 'ranch',
    'palace': 'palace',
    'castle': 'castle',
    'private island': 'private_island'
  });

  function asPositiveInt(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
  }

  function asNonNegativeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
  }

  function normalizePerson(value) {
    if (!value || typeof value !== 'object') return null;
    const id = asPositiveInt(value.id);
    const name = typeof value.name === 'string' ? value.name.trim() : '';
    if (!id && !name) return null;
    const person = {};
    if (id) person.id = id;
    if (name) person.name = name;
    return person;
  }

  function normalizeModifications(value) {
    if (!Array.isArray(value)) return [];
    return [...new Set(value
      .map(item => typeof item === 'string' ? item : item && item.name)
      .map(item => typeof item === 'string' ? item.trim() : '')
      .filter(Boolean))];
  }

  function normalizeStatus(value) {
    return String(value == null ? '' : value).trim().toLowerCase();
  }

  function propertyImageUrl(value) {
    const name = String(value == null ? '' : value).trim();
    if (!name) return '';
    const key = name.toLowerCase();
    const slug = PROPERTY_IMAGE_SLUGS[key] || key
      .replace(/[’']/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return slug ? `${PROPERTY_IMAGE_BASE}${slug}.png` : '';
  }

  function normalizeProperty(raw, currentUserId) {
    if (!raw || typeof raw !== 'object') return null;

    const ownerId = String(
      (raw.owner && raw.owner.id) != null ? raw.owner.id :
      raw.owner_id != null ? raw.owner_id : ''
    );

    if (currentUserId != null && ownerId !== String(currentUserId)) {
      return null;
    }

    const property = raw.property && typeof raw.property === 'object' ? raw.property : {};

    return {
      id: asPositiveInt(raw.id != null ? raw.id : raw.property_id),
      propertyTypeId: asPositiveInt(
        property.id != null ? property.id :
        raw.property_type_id != null ? raw.property_type_id : raw.type_id
      ),
      name: String(property.name != null ? property.name : raw.name != null ? raw.name : 'Unknown property'),
      ownerId,
      happy: Number(raw.happy != null ? raw.happy : property.happy != null ? property.happy : 0) || 0,
      status: normalizeStatus(raw.status),
      modifications: normalizeModifications(raw.modifications),
      cost: asNonNegativeNumber(raw.cost),
      costPerDay: asNonNegativeNumber(raw.cost_per_day != null ? raw.cost_per_day : raw.costPerDay),
      rentalPeriod: asNonNegativeNumber(raw.rental_period != null ? raw.rental_period : raw.rentalPeriod),
      rentalPeriodRemaining: asNonNegativeNumber(
        raw.rental_period_remaining != null ? raw.rental_period_remaining : raw.rentalPeriodRemaining
      ),
      rentedBy: normalizePerson(raw.rented_by != null ? raw.rented_by : raw.rentedBy),
      renterAsked: normalizePerson(raw.renter_asked != null ? raw.renter_asked : raw.renterAsked),
      leaseExtension: raw.lease_extension != null ? raw.lease_extension : raw.leaseExtension != null ? raw.leaseExtension : null,
      raw
    };
  }

  function normalizeProperties(rows, currentUserId) {
    if (!Array.isArray(rows)) return [];
    return rows
      .map(row => normalizeProperty(row, currentUserId))
      .filter(Boolean);
  }

  function isEligibleForLease(property) {
    return normalizeStatus(property && property.status) === 'none';
  }

  function leaseUrl(propertyId) {
    const id = asPositiveInt(propertyId);
    if (!id) throw new TypeError('A positive property ID is required');
    return `https://www.torn.com/properties.php#/p=options&ID=${id}&tab=lease`;
  }

  function uniquePropertyTypeIds(properties) {
    if (!Array.isArray(properties)) return [];
    return [...new Set(properties
      .map(property => asPositiveInt(property && property.propertyTypeId))
      .filter(Boolean))]
      .sort((a, b) => a - b);
  }

  return Object.freeze({
    PROPERTY_IMAGE_BASE,
    PROPERTY_IMAGE_SLUGS,
    propertyImageUrl,
    normalizeProperty,
    normalizeProperties,
    isEligibleForLease,
    leaseUrl,
    uniquePropertyTypeIds
  });
}));

/* ===== src/market-core.js ===== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3MarketCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function stringSet(values) {
    if (!Array.isArray(values)) return new Set();
    return new Set(values
      .map(value => typeof value === 'string' ? value : value && value.name)
      .map(value => typeof value === 'string' ? value.trim() : '')
      .filter(Boolean));
  }

  function normalizeRental(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      id: number(source.id != null ? source.id : source.rental_id, 0),
      happy: number(source.happy, 0),
      cost: number(source.cost, 0),
      cost_per_day: number(source.cost_per_day != null ? source.cost_per_day : source.costPerDay, 0),
      rental_period: number(source.rental_period != null ? source.rental_period : source.rentalPeriod, 0),
      market_price: number(source.market_price != null ? source.market_price : source.marketPrice, 0),
      upkeep: number(source.upkeep, 0),
      modifications: [...stringSet(source.modifications)],
      raw: source
    };
  }

  function happySimilarity(ownedHappy, listingHappy) {
    const owned = Math.max(0, number(ownedHappy, 0));
    const listing = Math.max(0, number(listingHappy, 0));
    if (owned === 0 && listing === 0) return 1;
    const denominator = Math.max(owned, 1);
    return Math.max(0, 1 - Math.abs(listing - owned) / denominator);
  }

  function modificationSimilarity(a, b) {
    const setA = stringSet(a);
    const setB = stringSet(b);
    if (setA.size === 0 && setB.size === 0) return 1;

    let intersection = 0;
    for (const value of setA) {
      if (setB.has(value)) intersection += 1;
    }
    const union = new Set([...setA, ...setB]).size;
    return union ? intersection / union : 1;
  }

  function exactModificationMatch(a, b) {
    const setA = stringSet(a);
    const setB = stringSet(b);
    if (setA.size !== setB.size) return false;
    for (const value of setA) {
      if (!setB.has(value)) return false;
    }
    return true;
  }

  function similarity(owned, listing) {
    const happyScore = happySimilarity(owned && owned.happy, listing && listing.happy);
    const modificationScore = modificationSimilarity(
      owned && owned.modifications,
      listing && listing.modifications
    );
    return happyScore * 0.7 + modificationScore * 0.3;
  }

  function withSimilarity(owned, listings) {
    return (Array.isArray(listings) ? listings : [])
      .map(normalizeRental)
      .map(row => Object.assign(row, { _similarity: similarity(owned || {}, row) }))
      .sort((a, b) => b._similarity - a._similarity || a.cost_per_day - b.cost_per_day || a.id - b.id);
  }

  function selectComparables(owned, listings) {
    const scored = withSimilarity(owned, listings);
    let selected = scored.filter(row => row._similarity >= 0.90);
    if (selected.length < 5) selected = scored.filter(row => row._similarity >= 0.75);
    if (selected.length < 5) selected = scored.slice(0, 10);
    return selected.slice(0, 30);
  }

  function percentile(sortedValues, p) {
    if (!sortedValues.length) return null;
    if (sortedValues.length === 1) return sortedValues[0];
    const index = (sortedValues.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sortedValues[lower];
    const weight = index - lower;
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  function integerMedian(sortedValues) {
    if (!sortedValues.length) return null;
    const middle = Math.floor(sortedValues.length / 2);
    if (sortedValues.length % 2) return Math.floor(sortedValues[middle]);
    return Math.floor((sortedValues[middle - 1] + sortedValues[middle]) / 2);
  }

  function cleanPriceRows(rows) {
    const usable = rows
      .filter(row => number(row.cost_per_day, 0) > 0)
      .sort((a, b) => a.cost_per_day - b.cost_per_day);

    if (usable.length < 4) return usable;

    const prices = usable.map(row => row.cost_per_day);
    const q1 = percentile(prices, 0.25);
    const q3 = percentile(prices, 0.75);
    const iqr = q3 - q1;
    const min = q1 - 1.5 * iqr;
    const max = q3 + 1.5 * iqr;
    const trimmed = usable.filter(row => row.cost_per_day >= min && row.cost_per_day <= max);
    return trimmed.length >= 3 ? trimmed : usable;
  }

  function marketStats(owned, listings, settings) {
    const options = Object.assign({
      undercutPercent: 0.5,
      minimumMedianRatio: 0.70
    }, settings || {});

    const selected = selectComparables(owned || {}, listings || []);
    const cleaned = cleanPriceRows(selected);

    if (!cleaned.length) {
      return {
        marketFloor: null,
        q1: null,
        median: null,
        q3: null,
        sampleSize: 0,
        averageSimilarity: 0,
        suggestedDaily: null,
        confidence: 'Low',
        comparableIds: []
      };
    }

    const prices = cleaned.map(row => row.cost_per_day).sort((a, b) => a - b);
    const marketFloor = Math.floor(prices[0]);
    const q1 = percentile(prices, 0.25);
    const q3 = percentile(prices, 0.75);
    const median = integerMedian(prices);
    const averageSimilarity = cleaned.reduce((sum, row) => sum + row._similarity, 0) / cleaned.length;
    const undercutPercent = Math.max(0, number(options.undercutPercent, 0.5));
    const minimumMedianRatio = Math.max(0, number(options.minimumMedianRatio, 0.70));
    const undercutPrice = Math.floor(marketFloor * (1 - undercutPercent / 100));
    const safetyPrice = Math.floor(median * minimumMedianRatio);
    const suggestedDaily = Math.max(1, undercutPrice, safetyPrice);

    let confidence = 'Low';
    if (cleaned.length >= 8 && averageSimilarity >= 0.90) confidence = 'High';
    else if (cleaned.length >= 5 && averageSimilarity >= 0.75) confidence = 'Medium';

    return {
      marketFloor,
      q1,
      median,
      q3,
      sampleSize: cleaned.length,
      averageSimilarity,
      suggestedDaily,
      confidence,
      comparableIds: cleaned.map(row => row.id)
    };
  }

  function rentalQuote(owned, listings, settings) {
    const options = Object.assign({
      targetDays: 100,
      undercutPercent: 0.5
    }, settings || {});
    const targetDays = Math.max(1, Math.floor(number(options.targetDays, 100)) || 100);
    const undercutPercent = Math.max(0, number(options.undercutPercent, 0.5));
    const rows = (Array.isArray(listings) ? listings : [])
      .map(normalizeRental)
      .filter(row => exactModificationMatch(owned && owned.modifications, row.modifications))
      .filter(row => row.cost > 0 && row.rental_period > 0)
      .map(row => Object.assign({}, row, {
        equivalentTotal: row.cost / row.rental_period * targetDays
      }));

    if (!rows.length) {
      return {
        targetDays,
        exactMatchCount: 0,
        lowestTotal: null,
        highestTotal: null,
        averageTotal: null,
        proposedTotal: null,
        exactMatches: []
      };
    }

    const totals = rows.map(row => row.equivalentTotal);
    const rawAverage = totals.reduce((sum, value) => sum + value, 0) / totals.length;
    const multiplier = Math.max(0, 1 - undercutPercent / 100);

    return {
      targetDays,
      exactMatchCount: rows.length,
      lowestTotal: Math.floor(Math.min(...totals)),
      highestTotal: Math.floor(Math.max(...totals)),
      averageTotal: Math.floor(rawAverage),
      proposedTotal: Math.floor(rawAverage * multiplier),
      exactMatches: rows
    };
  }

  return Object.freeze({
    normalizeRental,
    happySimilarity,
    modificationSimilarity,
    exactModificationMatch,
    similarity,
    selectComparables,
    marketStats,
    rentalQuote
  });
}));

/* ===== src/api-core.js ===== */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3ApiCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const API_ORIGIN = 'https://api.torn.com';
  const API_BASE = `${API_ORIGIN}/v2`;
  const CACHE_PREFIX = 'r4g3_property_rental_manager.market.';
  const FALLBACK_CACHE_MS = 15 * 60 * 1000;
  const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;
  const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

  function defaultSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function createScheduler(options) {
    const config = Object.assign({
      minGapMs: 800,
      maxPerMinute: 75,
      now: () => Date.now(),
      sleep: defaultSleep
    }, options || {});

    const minGapMs = Math.max(0, Number(config.minGapMs) || 0);
    const maxPerMinute = Math.max(1, Math.floor(Number(config.maxPerMinute) || 75));
    const now = config.now;
    const sleep = config.sleep;
    const starts = [];
    let lastStartedAt = null;
    let slotTail = Promise.resolve();

    function prune(current) {
      while (starts.length && current - starts[0] >= 60000) starts.shift();
    }

    async function waitForSlot() {
      while (true) {
        const current = now();
        prune(current);

        const gapWait = lastStartedAt == null ? 0 : Math.max(0, minGapMs - (current - lastStartedAt));
        const capWait = starts.length >= maxPerMinute
          ? Math.max(0, 60000 - (current - starts[0]))
          : 0;
        const waitMs = Math.max(gapWait, capWait);

        if (waitMs <= 0) {
          const startedAt = now();
          prune(startedAt);
          starts.push(startedAt);
          lastStartedAt = startedAt;
          return startedAt;
        }

        await sleep(waitMs);
      }
    }

    function run(task) {
      if (typeof task !== 'function') return Promise.reject(new TypeError('Scheduler task must be a function'));

      let release;
      const previous = slotTail;
      slotTail = new Promise(resolve => { release = resolve; });

      return (async () => {
        try {
          await previous;
          await waitForSlot();
          release();
          release = null;
          return await task();
        } catch (error) {
          if (release) release();
          throw error;
        }
      })();
    }

    return Object.freeze({ run });
  }

  function safeStorage(storage) {
    if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') return storage;
    const map = new Map();
    return {
      getItem(key) { return map.has(key) ? map.get(key) : null; },
      setItem(key, value) { map.set(key, String(value)); },
      removeItem(key) { map.delete(key); }
    };
  }

  function redact(value, apiKey) {
    let text = String(value == null ? '' : value);
    if (apiKey) text = text.split(String(apiKey)).join('[REDACTED]');
    return text;
  }

  function collection(body, key) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body[key])) return body[key];
    if (body && body.data && Array.isArray(body.data[key])) return body.data[key];

    if (key === 'rentals') {
      if (body && body.rentals && Array.isArray(body.rentals.listings)) return body.rentals.listings;
      if (body && body.data && body.data.rentals && Array.isArray(body.data.rentals.listings)) {
        return body.data.rentals.listings;
      }
    }

    return [];
  }

  function nextLink(body) {
    if (!body || typeof body !== 'object') return null;
    return (
      body._metadata && body._metadata.links && body._metadata.links.next ||
      body.metadata && body.metadata.links && body.metadata.links.next ||
      body._metadata && body._metadata.next ||
      body.metadata && body.metadata.next ||
      null
    );
  }

  function normalizeContinuation(next) {
    if (!next) return null;
    let url;
    try {
      url = new URL(String(next), API_ORIGIN);
    } catch (error) {
      throw new Error('Invalid Torn API continuation URL');
    }
    if (url.origin !== API_ORIGIN || !url.pathname.startsWith('/v2/')) {
      throw new Error('Rejected non-Torn API continuation URL');
    }
    return url.toString();
  }

  function positiveInt(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
  }

  function apiErrorDetail(body) {
    if (!body || !body.error) return '';
    return body.error.error || body.error.message || JSON.stringify(body.error);
  }

  function apiErrorCode(body) {
    return Number(body && body.error && body.error.code) || 0;
  }

  function isRateLimited(response, body) {
    return Number(response && response.status) === 429 || apiErrorCode(body) === 5 || /too many requests/i.test(apiErrorDetail(body));
  }

  function createClient(options) {
    const config = Object.assign({}, options || {});
    const apiKey = String(config.apiKey || '').trim();
    const fetchImpl = config.fetchImpl || (root && root.fetch ? root.fetch.bind(root) : null);
    const now = config.now || (() => Date.now());
    const sleep = config.sleep || defaultSleep;
    const storage = safeStorage(config.storage || (root && root.localStorage));
    const scheduler = config.scheduler || createScheduler({ now, sleep });
    let currentUserIdPromise = null;

    if (!fetchImpl) throw new Error('A fetch implementation is required');

    async function requestJson(url, attempt) {
      const tryNumber = attempt || 0;
      if (!apiKey) throw new Error('A Torn API key is required');

      let response;
      try {
        response = await scheduler.run(() => fetchImpl(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            Authorization: `ApiKey ${apiKey}`
          }
        }));
      } catch (error) {
        if (tryNumber < 2) {
          await sleep(250 * (tryNumber + 1));
          return requestJson(url, tryNumber + 1);
        }
        throw new Error(redact(`Torn API network error: ${error && error.message || error}`, apiKey));
      }

      let body = null;
      try {
        body = await response.json();
      } catch (error) {
        body = null;
      }

      if (isRateLimited(response, body)) {
        if (tryNumber < 2) {
          await sleep(RATE_LIMIT_COOLDOWN_MS);
          return requestJson(url, tryNumber + 1);
        }
        const detail = apiErrorDetail(body) || `HTTP ${response.status}`;
        throw new Error(redact(`Torn API rate limit: ${detail}`, apiKey));
      }

      if (!response.ok) {
        if (TRANSIENT_STATUSES.has(Number(response.status)) && tryNumber < 2) {
          await sleep(250 * (tryNumber + 1));
          return requestJson(url, tryNumber + 1);
        }
        const detail = apiErrorDetail(body) || `HTTP ${response.status}`;
        throw new Error(redact(`Torn API ${response.status}: ${detail}`, apiKey));
      }

      if (body && body.error) {
        const detail = apiErrorDetail(body);
        throw new Error(redact(`Torn API error: ${detail}`, apiKey));
      }

      return body || {};
    }

    async function collectPages(initialUrl, key) {
      const rows = [];
      let url = initialUrl;
      let firstBody = null;

      for (let page = 0; page < 100 && url; page += 1) {
        const body = await requestJson(url, 0);
        if (!firstBody) firstBody = body;
        rows.push(...collection(body, key));
        url = normalizeContinuation(nextLink(body));
      }

      if (url) throw new Error('Torn API pagination exceeded 100 pages');
      return { rows, firstBody: firstBody || {} };
    }

    function readCache(propertyTypeId) {
      try {
        const raw = storage.getItem(`${CACHE_PREFIX}${propertyTypeId}`);
        if (!raw) return null;
        const cached = JSON.parse(raw);
        if (!cached || !Array.isArray(cached.rentals) || !Number.isFinite(Number(cached.fetchedAt))) return null;
        return cached;
      } catch (error) {
        return null;
      }
    }

    function writeCache(propertyTypeId, value) {
      try {
        storage.setItem(`${CACHE_PREFIX}${propertyTypeId}`, JSON.stringify(value));
      } catch (error) {
        // Cache failure must not break market scanning.
      }
    }

    function cacheIsFresh(cached) {
      const delaySeconds = Number(cached.rentals_delay);
      const ttl = Number.isFinite(delaySeconds) && delaySeconds > 0
        ? delaySeconds * 1000
        : FALLBACK_CACHE_MS;
      return now() - Number(cached.fetchedAt) < ttl;
    }

    async function fetchCurrentUserId() {
      if (!currentUserIdPromise) {
        currentUserIdPromise = (async () => {
          const body = await requestJson(`${API_BASE}/user/basic`, 0);
          const profile = body && body.profile && typeof body.profile === 'object' ? body.profile : body;
          const id = positiveInt(profile && (profile.id != null ? profile.id : profile.player_id));
          if (!id) throw new Error('Torn API user/basic response did not contain a valid user id');
          return id;
        })().catch(error => {
          currentUserIdPromise = null;
          throw error;
        });
      }
      return currentUserIdPromise;
    }

    async function fetchOwnedProperties() {
      const result = await collectPages(`${API_BASE}/user/properties?filters=ownedByUser&limit=100`, 'properties');
      return result.rows;
    }

    async function fetchRentalMarket(propertyTypeId, options) {
      const id = positiveInt(propertyTypeId);
      if (!id) throw new TypeError('A positive property type ID is required');
      const force = Boolean(options && options.force);

      if (!force) {
        const cached = readCache(id);
        if (cached && cacheIsFresh(cached)) {
          return Object.assign({}, cached, { fromCache: true });
        }
      }

      const result = await collectPages(`${API_BASE}/market/${id}/rentals?limit=100`, 'rentals');
      const rentalRoot = result.firstBody && result.firstBody.rentals && typeof result.firstBody.rentals === 'object'
        ? result.firstBody.rentals
        : result.firstBody && result.firstBody.data && result.firstBody.data.rentals && typeof result.firstBody.data.rentals === 'object'
          ? result.firstBody.data.rentals
          : null;
      const market = {
        rentals: result.rows,
        property: rentalRoot && rentalRoot.property ? rentalRoot.property : null,
        rentals_timestamp: result.firstBody.rentals_timestamp == null ? null : result.firstBody.rentals_timestamp,
        rentals_delay: result.firstBody.rentals_delay == null ? null : result.firstBody.rentals_delay,
        fetchedAt: now(),
        fromCache: false
      };
      writeCache(id, market);
      return market;
    }

    async function scanMarkets(properties, options) {
      const scanOptions = options || {};
      const onProgress = typeof scanOptions.onProgress === 'function' ? scanOptions.onProgress : null;
      const ids = [...new Set((Array.isArray(properties) ? properties : [])
        .map(property => positiveInt(property && property.propertyTypeId))
        .filter(Boolean))]
        .sort((a, b) => a - b);

      const markets = {};
      let done = 0;

      await Promise.all(ids.map(async id => {
        let market;
        try {
          market = await fetchRentalMarket(id, scanOptions);
        } catch (error) {
          market = {
            rentals: [],
            property: null,
            rentals_timestamp: null,
            rentals_delay: null,
            fetchedAt: now(),
            fromCache: false,
            error: redact(error && error.message || error, apiKey)
          };
        }

        markets[id] = market;
        done += 1;
        if (onProgress) {
          onProgress({
            id,
            done,
            total: ids.length,
            market
          });
        }
      }));

      return markets;
    }

    return Object.freeze({
      fetchCurrentUserId,
      fetchOwnedProperties,
      fetchRentalMarket,
      scanMarkets
    });
  }

  return Object.freeze({
    API_ORIGIN,
    API_BASE,
    RATE_LIMIT_COOLDOWN_MS,
    createScheduler,
    createClient
  });
}));

/* ===== src/draft-core.js ===== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3DraftCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const KEY = 'r4g3_property_rental_manager.pending_lease';
  const DEFAULT_EXPIRY_MS = 30 * 60 * 1000;

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
  }

  function optionalMoney(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
  }

  function normalizeConfidence(value) {
    return ['High', 'Medium', 'Low'].includes(value) ? value : null;
  }

  function createStore(storage, options) {
    if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
      throw new TypeError('A sessionStorage-compatible object is required');
    }

    const config = Object.assign({
      now: () => Date.now(),
      expiryMs: DEFAULT_EXPIRY_MS
    }, options || {});
    const now = config.now;
    const expiryMs = Math.max(1, Number(config.expiryMs) || DEFAULT_EXPIRY_MS);

    function clear() {
      storage.removeItem(KEY);
    }

    function normalizeInput(draft, createdAt) {
      const source = draft && typeof draft === 'object' ? draft : {};
      const propertyId = positiveInteger(source.propertyId);
      const days = positiveInteger(source.days);
      const suppliedDailyPrice = positiveInteger(source.dailyPrice);
      const suppliedTotalCost = positiveInteger(source.totalCost);

      if (!propertyId) throw new TypeError('A positive property ID is required');
      if (!days || days > 365) throw new RangeError('Lease days must be an integer from 1 to 365');
      if (!suppliedDailyPrice && !suppliedTotalCost) throw new RangeError('Daily price or total cost must be a positive integer');

      const totalCost = suppliedTotalCost || days * suppliedDailyPrice;
      const dailyPrice = suppliedDailyPrice || Math.max(1, Math.floor(totalCost / days));
      const normalized = {
        propertyId,
        days,
        dailyPrice,
        totalCost,
        createdAt: Number.isFinite(Number(createdAt)) ? Number(createdAt) : now()
      };

      const marketFloor = optionalMoney(source.marketFloor);
      const median = optionalMoney(source.median);
      const confidence = normalizeConfidence(source.confidence);
      if (marketFloor != null) normalized.marketFloor = marketFloor;
      if (median != null) normalized.median = median;
      if (confidence) normalized.confidence = confidence;

      return normalized;
    }

    function save(draft) {
      const normalized = normalizeInput(draft, now());
      storage.setItem(KEY, JSON.stringify(normalized));
      return Object.assign({}, normalized);
    }

    function loadFor(propertyId) {
      const requestedId = positiveInteger(propertyId);
      if (!requestedId) return null;

      let parsed;
      try {
        const raw = storage.getItem(KEY);
        if (!raw) return null;
        parsed = JSON.parse(raw);
      } catch (error) {
        clear();
        return null;
      }

      let normalized;
      try {
        normalized = normalizeInput(parsed, parsed && parsed.createdAt);
      } catch (error) {
        clear();
        return null;
      }

      if (!Number.isFinite(normalized.createdAt) || now() - normalized.createdAt > expiryMs) {
        clear();
        return null;
      }

      if (normalized.propertyId !== requestedId) return null;
      return Object.assign({}, normalized);
    }

    return Object.freeze({
      save,
      loadFor,
      clear
    });
  }

  return Object.freeze({
    KEY,
    DEFAULT_EXPIRY_MS,
    createStore
  });
}));

/* ===== src/form-core.js ===== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3FormCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
  }

  function inputIntegerValue(input) {
    const raw = String(input && input.value != null ? input.value : '').trim();
    if (!raw) return 0;
    const digits = raw.replace(/[^0-9]/g, '');
    return positiveInteger(digits);
  }

  function parseLeasePropertyId(locationLike) {
    const hash = String(locationLike && locationLike.hash || '');
    if (!hash.includes('p=options') || !hash.includes('tab=lease')) return null;
    const match = hash.match(/[?&#]ID=(\d+)/i);
    const id = match ? positiveInteger(match[1]) : 0;
    return id || null;
  }

  function findLeaseForm(documentLike) {
    if (!documentLike || typeof documentLike.querySelector !== 'function') return null;
    const root = documentLike.querySelector('#market ul.lease-input');
    if (!root) return null;

    const daysInput = root.querySelector('li.amount input.input-money:not([type="hidden"])');
    const costInput = root.querySelector('li.cost input.lease.input-money:not([type="hidden"])') ||
      root.querySelector('li.cost input.lease.input-money');

    if (!daysInput || !costInput) return null;
    return { root, daysInput, costInput };
  }

  function findLeaseSubmitButton(documentLike, formRoot) {
    if (!documentLike || typeof documentLike.querySelector !== 'function') return null;
    const root = formRoot || documentLike.querySelector('#market ul.lease-input');
    if (!root) return null;

    const direct = root.querySelector('li.submit button, li.submit input[type="submit"]');
    if (direct) return direct;

    const scope = root.closest && (root.closest('form') || root.closest('section')) || root.parentElement;
    if (!scope || typeof scope.querySelectorAll !== 'function') return null;
    const candidates = [...scope.querySelectorAll('button, input[type="submit"]')];
    return candidates.find(candidate => {
      const text = String(candidate.textContent || candidate.value || '').trim();
      return /^(?:send|offer|submit|next|list property|list)$/i.test(text);
    }) || null;
  }

  function setNativeValue(input, value, windowLike) {
    if (!input) throw new TypeError('Input element is required');
    const win = windowLike || input.ownerDocument && input.ownerDocument.defaultView;
    const prototype = win && win.HTMLInputElement && win.HTMLInputElement.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(input, String(value));
    else input.value = String(value);

    if (win && typeof win.Event === 'function') {
      for (const eventName of ['input', 'change', 'keyup', 'blur']) {
        input.dispatchEvent(new win.Event(eventName, { bubbles: true }));
      }
    }
  }

  function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'n/a';
    return Math.floor(number).toLocaleString('en-US');
  }

  function upsertSummary(formRoot, draft, totalCost) {
    const documentLike = formRoot.ownerDocument;
    let summary = documentLike.querySelector('.r4g3-prm-inline-summary');
    if (!summary) {
      summary = documentLike.createElement('div');
      summary.className = 'r4g3-prm-inline-summary';
      summary.setAttribute('role', 'status');
      formRoot.insertAdjacentElement('afterend', summary);
    }

    const bits = [
      `${draft.days} days`,
      `Total $${money(totalCost)}`
    ];
    if (draft.dailyPrice) bits.unshift(`Approx. $${money(draft.dailyPrice)}/day`);
    if (draft.marketFloor != null) bits.push(`Floor $${money(draft.marketFloor)}/day`);
    if (draft.median != null) bits.push(`Median $${money(draft.median)}/day`);
    if (draft.confidence) bits.push(`Confidence ${draft.confidence}`);

    summary.textContent = bits.join(' • ');
    return summary;
  }

  function draftLeaseValues(draft) {
    if (!draft || typeof draft !== 'object') return null;
    const days = positiveInteger(draft.days);
    const suppliedTotal = positiveInteger(draft.totalCost);
    const suppliedDaily = positiveInteger(draft.dailyPrice);
    if (!days || days > 365 || (!suppliedTotal && !suppliedDaily)) return null;
    const totalCost = suppliedTotal || days * suppliedDaily;
    const dailyPrice = suppliedDaily || Math.max(1, Math.floor(totalCost / days));
    return { days, totalCost, dailyPrice };
  }

  function prepareLeaseForm(options) {
    const config = options || {};
    const documentLike = config.document;
    const windowLike = config.window;
    const locationLike = config.location || windowLike && windowLike.location;
    const draft = config.draft && typeof config.draft === 'object' ? config.draft : null;
    const propertyId = parseLeasePropertyId(locationLike);

    if (!propertyId) return { prepared: false, reason: 'Not a lease route' };
    if (!draft || positiveInteger(draft.propertyId) !== propertyId) {
      return { prepared: false, reason: 'Draft does not match this property' };
    }

    const values = draftLeaseValues(draft);
    if (!values) return { prepared: false, reason: 'Invalid lease draft' };

    const form = findLeaseForm(documentLike);
    if (!form) return { prepared: false, reason: 'Form not recognized' };

    setNativeValue(form.daysInput, values.days, windowLike);
    setNativeValue(form.costInput, values.totalCost, windowLike);
    const summary = upsertSummary(form.root, Object.assign({}, draft, {
      days: values.days,
      dailyPrice: values.dailyPrice
    }), values.totalCost);

    return {
      prepared: true,
      propertyId,
      days: values.days,
      dailyPrice: values.dailyPrice,
      totalCost: values.totalCost,
      form,
      summary
    };
  }

  function verifyPreparedLeaseForm(options) {
    const config = options || {};
    const documentLike = config.document;
    const windowLike = config.window;
    const locationLike = config.location || windowLike && windowLike.location;
    const draft = config.draft && typeof config.draft === 'object' ? config.draft : null;
    const propertyId = parseLeasePropertyId(locationLike);

    if (!propertyId) return { verified: false, reason: 'Not a lease route' };
    if (!draft || positiveInteger(draft.propertyId) !== propertyId) {
      return { verified: false, reason: 'Draft does not match this property' };
    }

    const values = draftLeaseValues(draft);
    if (!values) return { verified: false, reason: 'Invalid lease draft' };

    const form = findLeaseForm(documentLike);
    if (!form) return { verified: false, reason: 'Form not recognized' };

    const actualDays = inputIntegerValue(form.daysInput);
    const actualTotalCost = inputIntegerValue(form.costInput);
    if (actualDays !== values.days || actualTotalCost !== values.totalCost) {
      return {
        verified: false,
        reason: 'Prepared lease values changed; press PREPARE RENTAL again',
        propertyId,
        expectedDays: values.days,
        expectedTotalCost: values.totalCost,
        actualDays,
        actualTotalCost,
        form
      };
    }

    return {
      verified: true,
      propertyId,
      days: values.days,
      dailyPrice: values.dailyPrice,
      totalCost: values.totalCost,
      form
    };
  }

  function submitLeaseFromUserGesture(options) {
    const config = options || {};
    const documentLike = config.document;
    const windowLike = config.window;
    const locationLike = config.location || windowLike && windowLike.location;
    const draft = config.draft && typeof config.draft === 'object' ? config.draft : null;

    const verified = verifyPreparedLeaseForm({
      document: documentLike,
      window: windowLike,
      location: locationLike,
      draft
    });
    if (!verified.verified) return { submitted: false, reason: verified.reason };

    const submitButton = findLeaseSubmitButton(documentLike, verified.form.root);
    if (!submitButton) return { submitted: false, reason: 'Submit control not recognized' };
    if (submitButton.disabled || submitButton.getAttribute && submitButton.getAttribute('aria-disabled') === 'true') {
      return { submitted: false, reason: 'Submit control is disabled' };
    }

    submitButton.click();
    return {
      submitted: true,
      propertyId: verified.propertyId,
      days: verified.days,
      totalCost: verified.totalCost
    };
  }

  return Object.freeze({
    parseLeasePropertyId,
    findLeaseForm,
    findLeaseSubmitButton,
    setNativeValue,
    verifyPreparedLeaseForm,
    prepareLeaseForm,
    submitLeaseFromUserGesture
  });
}));

/* ===== src/app.js ===== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SETTINGS_KEY = 'r4g3_property_rental_manager.settings';
  const TARGET_DAYS = 100;
  const MOBILE_BREAKPOINT = 700;
  const DEFAULT_SETTINGS = Object.freeze({
    apiKey: '',
    theme: 'dark',
    undercutPercent: 0.5,
    days: TARGET_DAYS,
    uiState: 'open',
    geometry: Object.freeze({ left: 32, top: 90, width: 920, height: 560 })
  });

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function integer(value, min, max, fallback) {
    return Math.round(clamp(value, min, max, fallback));
  }

  function normalizeGeometry(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      left: integer(source.left, 0, 10000, DEFAULT_SETTINGS.geometry.left),
      top: integer(source.top, 0, 10000, DEFAULT_SETTINGS.geometry.top),
      width: integer(source.width, 360, 3000, DEFAULT_SETTINGS.geometry.width),
      height: integer(source.height, 260, 2400, DEFAULT_SETTINGS.geometry.height)
    };
  }

  function normalizeUiState(value) {
    return value === 'closed' || value === 'minimized' ? value : 'open';
  }

  function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : DEFAULT_SETTINGS.apiKey,
      theme: source.theme === 'light' ? 'light' : 'dark',
      undercutPercent: clamp(source.undercutPercent, 0, 25, DEFAULT_SETTINGS.undercutPercent),
      days: TARGET_DAYS,
      uiState: normalizeUiState(source.uiState),
      geometry: normalizeGeometry(source.geometry)
    };
  }

  function loadSettings(storage) {
    if (!storage || typeof storage.getItem !== 'function') return normalizeSettings({});
    try {
      const raw = storage.getItem(SETTINGS_KEY);
      return normalizeSettings(raw ? JSON.parse(raw) : {});
    } catch (error) {
      return normalizeSettings({});
    }
  }

  function saveSettings(storage, next) {
    const current = loadSettings(storage);
    const source = next && typeof next === 'object' ? next : {};
    const normalized = normalizeSettings(Object.assign({}, current, source, {
      geometry: source.geometry ? source.geometry : current.geometry
    }));
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    }
    return normalized;
  }

  function money(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return 'n/a';
    return Math.floor(number).toLocaleString('en-US');
  }

  function labelStatus(status) {
    const text = String(status || 'unknown').replace(/_/g, ' ').trim();
    return text ? text.replace(/\b\w/g, char => char.toUpperCase()) : 'Unknown';
  }

  function el(documentLike, tag, options) {
    const node = documentLike.createElement(tag);
    const config = options || {};
    if (config.className) node.className = config.className;
    if (config.text != null) node.textContent = String(config.text);
    if (config.attrs) {
      for (const [name, value] of Object.entries(config.attrs)) {
        node.setAttribute(name, String(value));
      }
    }
    return node;
  }

  function createController(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const storage = config.storage || windowLike && windowLike.localStorage;
    const fixedApiClient = config.apiClient || null;
    const apiClientFactory = typeof config.apiClientFactory === 'function' ? config.apiClientFactory : null;
    const propertyCore = config.propertyCore;
    const marketCore = config.marketCore;
    const draftStore = config.draftStore;
    const navigate = typeof config.navigate === 'function'
      ? config.navigate
      : url => { if (windowLike && windowLike.location) windowLike.location.href = url; };
    const canListProperty = typeof config.canListProperty === 'function'
      ? config.canListProperty
      : () => false;
    const listProperty = typeof config.listProperty === 'function'
      ? config.listProperty
      : () => ({ submitted: false, reason: 'Listing action unavailable' });

    if (!windowLike || !documentLike) throw new TypeError('window and document are required');
    if (!fixedApiClient && !apiClientFactory) throw new TypeError('apiClient or apiClientFactory is required');
    if (fixedApiClient && (typeof fixedApiClient.fetchOwnedProperties !== 'function' || typeof fixedApiClient.scanMarkets !== 'function')) {
      throw new TypeError('apiClient is invalid');
    }
    if (!propertyCore || !marketCore || !draftStore) throw new TypeError('Core dependencies are required');

    let settings = loadSettings(storage);
    let state = {
      properties: [],
      markets: {},
      rows: [],
      loading: false,
      error: null,
      needsApiKey: false,
      actionMessage: '',
      scanProgress: null
    };
    let panel = null;
    let dragCleanup = null;
    let resizeCleanup = null;
    let resizeObserver = null;
    let settingsOpen = false;
    let cachedApiClient = null;
    let cachedApiKey = '';
    let activeLoadPromise = null;

    function isMobile() {
      return Number(windowLike.innerWidth) <= MOBILE_BREAKPOINT;
    }

    function persistSettings(patch) {
      settings = saveSettings(storage, Object.assign({}, settings, patch || {}));
      return settings;
    }

    function getApiClient() {
      if (apiClientFactory) {
        if (!settings.apiKey) return null;
        if (cachedApiClient && cachedApiKey === settings.apiKey) return cachedApiClient;
        const client = apiClientFactory(settings.apiKey);
        if (!client || typeof client.fetchOwnedProperties !== 'function' || typeof client.scanMarkets !== 'function') {
          throw new TypeError('apiClientFactory returned an invalid client');
        }
        cachedApiClient = client;
        cachedApiKey = settings.apiKey;
        return client;
      }
      return fixedApiClient;
    }

    function computeRows(properties, markets) {
      return properties.map(property => {
        const market = markets && markets[property.propertyTypeId];
        const quote = marketCore.rentalQuote(
          property,
          market && Array.isArray(market.rentals) ? market.rentals : [],
          {
            targetDays: TARGET_DAYS,
            undercutPercent: settings.undercutPercent
          }
        );
        return { property, market: market || null, quote };
      }).sort((a, b) => {
        const aEligible = propertyCore.isEligibleForLease(a.property) ? 1 : 0;
        const bEligible = propertyCore.isEligibleForLease(b.property) ? 1 : 0;
        if (aEligible !== bEligible) return bEligible - aEligible;
        return String(a.property.name || '').localeCompare(String(b.property.name || '')) || Number(a.property.id) - Number(b.property.id);
      });
    }

    function applyPanelGeometry(node) {
      node.style.position = 'fixed';
      node.style.overflow = settings.uiState === 'minimized' ? 'hidden' : 'auto';
      node.style.zIndex = '99999';
      node.style.maxWidth = 'calc(100vw - 16px)';
      node.style.maxHeight = 'calc(100vh - 16px)';

      if (isMobile()) {
        node.style.left = '8px';
        node.style.top = '8px';
        node.style.width = 'calc(100vw - 16px)';
        node.style.height = settings.uiState === 'minimized' ? 'auto' : 'calc(100vh - 16px)';
        node.style.resize = 'none';
        return;
      }

      const geometry = settings.geometry;
      node.style.left = `${geometry.left}px`;
      node.style.top = `${geometry.top}px`;
      node.style.width = `${geometry.width}px`;
      node.style.height = settings.uiState === 'minimized' ? 'auto' : `${geometry.height}px`;
      node.style.resize = settings.uiState === 'minimized' ? 'none' : 'both';
    }

    function addStyles(node) {
      node.style.boxSizing = 'border-box';
      node.style.border = '1px solid rgba(90, 255, 120, 0.35)';
      node.style.borderRadius = '10px';
      node.style.boxShadow = '0 12px 34px rgba(0, 0, 0, 0.35)';
      node.style.fontFamily = 'Arial, sans-serif';
      node.style.fontSize = '13px';
      node.style.padding = '0';
      node.style.background = settings.theme === 'light' ? '#f5f5f2' : '#111512';
      node.style.color = settings.theme === 'light' ? '#171917' : '#ecf4ed';
    }

    function createButton(text, action, title) {
      const button = el(documentLike, 'button', { text, attrs: { type: 'button', 'data-action': action } });
      button.style.cursor = 'pointer';
      button.style.padding = '7px 10px';
      button.style.borderRadius = '6px';
      button.style.border = '1px solid currentColor';
      button.style.background = 'transparent';
      button.style.color = 'inherit';
      if (title) button.title = title;
      return button;
    }

    function renderHeader(container) {
      const header = el(documentLike, 'div', { className: 'r4g3-prm-header' });
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.flexWrap = 'wrap';
      header.style.gap = '8px';
      header.style.padding = '9px 10px';
      header.style.borderBottom = settings.uiState === 'minimized' ? '0' : '1px solid rgba(128,128,128,0.35)';
      header.style.position = 'sticky';
      header.style.top = '0';
      header.style.background = settings.theme === 'light' ? '#f5f5f2' : '#111512';
      header.style.zIndex = '2';

      const dragHandle = el(documentLike, 'strong', {
        text: 'Property Rental Manager',
        attrs: { 'data-role': 'drag-handle' }
      });
      dragHandle.style.cursor = isMobile() ? 'default' : 'move';
      dragHandle.style.userSelect = 'none';
      dragHandle.style.marginRight = 'auto';
      dragHandle.style.color = settings.theme === 'light' ? '#102513' : '#74ff8b';
      header.appendChild(dragHandle);

      if (settings.uiState !== 'minimized') {
        const refreshButton = createButton(state.loading ? 'Scanning…' : 'Refresh', 'refresh', 'Refresh properties and use fresh cached market data when available');
        refreshButton.disabled = Boolean(state.loading);
        const settingsButton = createButton(settingsOpen ? 'Close Settings' : 'Settings', 'toggle-settings');
        const themeButton = createButton(settings.theme === 'dark' ? 'Light' : 'Dark', 'toggle-theme');
        header.append(refreshButton, settingsButton, themeButton);
      }

      header.appendChild(createButton(settings.uiState === 'minimized' ? '□' : '—', 'minimize', settings.uiState === 'minimized' ? 'Restore' : 'Minimize'));
      header.appendChild(createButton('×', 'close', 'Close'));
      container.appendChild(header);
    }

    function renderSettings(container) {
      if (!settingsOpen || settings.uiState === 'minimized') return;
      const box = el(documentLike, 'section', { className: 'r4g3-prm-settings' });
      box.style.padding = '10px';
      box.style.margin = '8px';
      box.style.border = '1px solid rgba(128,128,128,0.35)';
      box.style.borderRadius = '8px';
      box.style.display = 'grid';
      box.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
      box.style.gap = '10px';

      const keyWrap = el(documentLike, 'label', { text: settings.apiKey ? 'Torn API key (saved): ' : 'Torn API key: ' });
      const keyInput = el(documentLike, 'input', {
        attrs: {
          type: 'password',
          'data-role': 'api-key-input',
          autocomplete: 'off',
          placeholder: settings.apiKey ? 'Enter replacement key' : 'Limited-or-higher API key'
        }
      });
      keyInput.value = '';
      keyWrap.appendChild(keyInput);
      box.appendChild(keyWrap);

      const period = el(documentLike, 'div', { text: `Rental period: ${TARGET_DAYS} days` });
      box.appendChild(period);

      const undercutWrap = el(documentLike, 'label', { text: 'Average undercut %: ' });
      const undercutInput = el(documentLike, 'input', {
        attrs: { type: 'number', min: '0', max: '25', step: '0.1', 'data-role': 'undercut-input' }
      });
      undercutInput.value = String(settings.undercutPercent);
      undercutWrap.appendChild(undercutInput);
      box.appendChild(undercutWrap);

      const actions = el(documentLike, 'div');
      actions.style.gridColumn = '1 / -1';
      actions.style.display = 'flex';
      actions.style.flexWrap = 'wrap';
      actions.style.gap = '8px';
      actions.appendChild(createButton('Save Settings', 'save-settings'));
      actions.appendChild(createButton('Force Market Refresh', 'force-refresh', 'Bypass cached Torn rental-market data for all property types'));
      if (settings.apiKey) actions.appendChild(createButton('Clear API Key', 'clear-api-key'));
      box.appendChild(actions);

      const note = el(documentLike, 'small', {
        text: 'Market rentals are normalized to a 100-day total before averaging. Normal Refresh reuses fresh Torn market cache; Force Market Refresh bypasses it.'
      });
      note.style.gridColumn = '1 / -1';
      note.style.opacity = '0.72';
      box.appendChild(note);
      container.appendChild(box);
    }

    function addCell(row, label, value, emphasized) {
      const cell = el(documentLike, 'div');
      const heading = el(documentLike, 'span', { text: `${label}: ` });
      heading.style.opacity = '0.68';
      cell.appendChild(heading);
      const valueNode = el(documentLike, emphasized ? 'strong' : 'span', { text: value });
      if (emphasized) valueNode.style.color = settings.theme === 'light' ? '#0d5c19' : '#74ff8b';
      cell.appendChild(valueNode);
      row.appendChild(cell);
      return cell;
    }

    function renderRow(entry, container) {
      const { property, quote, market } = entry;
      const row = el(documentLike, 'section', {
        className: 'r4g3-prm-property',
        attrs: { 'data-property-id': property.id }
      });
      row.style.padding = '12px';
      row.style.margin = '8px';
      row.style.border = '1px solid rgba(128,128,128,0.28)';
      row.style.borderRadius = '8px';
      row.style.display = 'grid';
      row.style.gridTemplateColumns = 'repeat(auto-fit, minmax(175px, 1fr))';
      row.style.gap = '8px 14px';

      const identity = el(documentLike, 'div');
      identity.style.gridColumn = '1 / -1';
      identity.style.display = 'flex';
      identity.style.alignItems = 'center';
      identity.style.gap = '12px';
      identity.style.minWidth = '0';

      const imageUrl = typeof propertyCore.propertyImageUrl === 'function' ? propertyCore.propertyImageUrl(property.name) : '';
      if (imageUrl) {
        const image = el(documentLike, 'img', {
          attrs: {
            src: imageUrl,
            alt: `${property.name} property`,
            'data-role': 'property-image'
          }
        });
        image.style.width = '112px';
        image.style.height = '74px';
        image.style.objectFit = 'cover';
        image.style.borderRadius = '7px';
        image.style.border = '1px solid rgba(128,128,128,0.3)';
        image.style.flex = '0 0 auto';
        image.loading = 'lazy';
        image.addEventListener('error', () => { image.style.display = 'none'; }, { once: true });
        identity.appendChild(image);
      }

      const title = el(documentLike, 'strong', { text: `${property.name} #${property.id}` });
      title.style.fontSize = '14px';
      identity.appendChild(title);
      row.appendChild(identity);

      addCell(row, 'Status', labelStatus(property.status));
      addCell(row, 'Happy', money(property.happy));
      addCell(row, 'Upgrades', property.modifications && property.modifications.length ? property.modifications.join(', ') : 'None');

      if (market && market.error) {
        const failed = el(documentLike, 'div', { text: `Market scan failed for this property type: ${market.error}` });
        failed.style.gridColumn = '1 / -1';
        row.appendChild(failed);
        const retry = createButton('RETRY MARKET', 'retry-market');
        retry.dataset.propertyTypeId = String(property.propertyTypeId);
        row.appendChild(retry);
      } else if (!market && state.loading) {
        const pending = el(documentLike, 'div', { text: 'Market scan pending…' });
        pending.style.gridColumn = '1 / -1';
        pending.style.opacity = '0.72';
        row.appendChild(pending);
      } else if (quote.exactMatchCount > 0) {
        addCell(row, 'Exact matches', quote.exactMatchCount);
        addCell(row, 'Lowest 100-day', `$${money(quote.lowestTotal)}`);
        addCell(row, 'Highest 100-day', `$${money(quote.highestTotal)}`);
        addCell(row, 'Average 100-day', `$${money(quote.averageTotal)}`);
        addCell(row, 'Proposed 100-day rent', `$${money(quote.proposedTotal)}`, true);
        addCell(row, 'Market source', market && market.fromCache ? 'Cached' : 'Live');
      } else {
        const noMatches = el(documentLike, 'div', { text: 'No exact market matches for this upgrade configuration.' });
        noMatches.style.gridColumn = '1 / -1';
        noMatches.style.opacity = '0.78';
        row.appendChild(noMatches);
      }

      if (propertyCore.isEligibleForLease(property) && quote.proposedTotal != null) {
        const actions = el(documentLike, 'div');
        actions.style.gridColumn = '1 / -1';
        actions.style.display = 'flex';
        actions.style.flexWrap = 'wrap';
        actions.style.gap = '8px';

        const setPrice = createButton('SET PRICE', 'set-price');
        setPrice.dataset.propertyId = String(property.id);
        setPrice.style.color = settings.theme === 'light' ? '#0d5c19' : '#74ff8b';

        const list = createButton('LIST PROPERTY', 'list-property');
        list.dataset.propertyId = String(property.id);
        list.disabled = !canListProperty(property.id);
        list.style.opacity = list.disabled ? '0.45' : '1';
        list.title = list.disabled
          ? 'Press SET PRICE first, then list from the prepared Torn lease page.'
          : `List this property for $${money(quote.proposedTotal)} over ${TARGET_DAYS} days`;

        actions.append(setPrice, list);
        row.appendChild(actions);
      }

      container.appendChild(row);
    }

    function renderStatus(container) {
      if (state.actionMessage) {
        const message = el(documentLike, 'div', { text: state.actionMessage });
        message.style.padding = '8px 12px';
        message.style.borderBottom = '1px solid rgba(128,128,128,0.25)';
        container.appendChild(message);
      }
      if (state.needsApiKey) {
        const keyMessage = el(documentLike, 'div', {
          text: 'A Limited-or-higher Torn API key is required. Open Settings to configure it.'
        });
        keyMessage.style.padding = '14px';
        container.appendChild(keyMessage);
        return true;
      }
      if (state.loading) {
        const progress = state.scanProgress && state.scanProgress.total
          ? `Scanning rental markets… ${state.scanProgress.done}/${state.scanProgress.total}`
          : 'Scanning owned properties and rental markets…';
        const loading = el(documentLike, 'div', { text: progress });
        loading.style.padding = '10px 14px';
        loading.style.borderBottom = '1px solid rgba(128,128,128,0.2)';
        container.appendChild(loading);
        return !state.rows.length;
      }
      if (state.error) {
        const error = el(documentLike, 'div', { text: 'Unable to load property data. Check your Torn API key and try again.' });
        error.style.padding = '14px';
        container.appendChild(error);
        return true;
      }
      if (!state.rows.length) {
        const empty = el(documentLike, 'div', { text: 'No owned properties were returned.' });
        empty.style.padding = '14px';
        container.appendChild(empty);
        return true;
      }
      return false;
    }

    function readSettingsFields(node) {
      const keyInput = node.querySelector('[data-role="api-key-input"]');
      const undercutInput = node.querySelector('[data-role="undercut-input"]');
      return {
        apiKey: keyInput && keyInput.value ? keyInput.value.trim() : null,
        undercutPercent: undercutInput ? undercutInput.value : settings.undercutPercent
      };
    }

    function setPriceForProperty(propertyId) {
      const id = Number(propertyId);
      const entry = state.rows.find(row => row.property.id === id);
      if (!entry || !propertyCore.isEligibleForLease(entry.property) || entry.quote.proposedTotal == null) return false;

      draftStore.save({
        propertyId: id,
        days: TARGET_DAYS,
        totalCost: entry.quote.proposedTotal,
        dailyPrice: Math.max(1, Math.floor(entry.quote.proposedTotal / TARGET_DAYS))
      });
      navigate(propertyCore.leaseUrl(id));
      return true;
    }

    function listPreparedProperty(propertyId) {
      const id = Number(propertyId);
      const entry = state.rows.find(row => row.property.id === id);
      if (!entry || !propertyCore.isEligibleForLease(entry.property) || entry.quote.proposedTotal == null) return false;
      if (!canListProperty(id)) return false;

      const result = listProperty(id);
      if (result && result.submitted) {
        state = Object.assign({}, state, { actionMessage: `Listing submitted for ${entry.property.name} #${id}.` });
        render();
      }
      return result || false;
    }

    async function retryMarket(propertyTypeId) {
      const id = Number(propertyTypeId);
      const apiClient = getApiClient();
      if (!apiClient || typeof apiClient.fetchRentalMarket !== 'function' || !id) return false;
      state = Object.assign({}, state, { actionMessage: `Retrying market ${id}…` });
      render();
      try {
        const market = await apiClient.fetchRentalMarket(id, { force: true });
        const markets = Object.assign({}, state.markets, { [id]: market });
        state = Object.assign({}, state, {
          markets,
          rows: computeRows(state.properties, markets),
          actionMessage: `Market ${id} refreshed.`
        });
        render();
        return true;
      } catch (error) {
        const markets = Object.assign({}, state.markets, {
          [id]: { rentals: [], error: String(error && error.message || error) }
        });
        state = Object.assign({}, state, { markets, rows: computeRows(state.properties, markets), actionMessage: `Market ${id} retry failed.` });
        render();
        return false;
      }
    }

    function closePanel() {
      persistGeometryFromPanel();
      persistSettings({ uiState: 'closed' });
      render();
      return true;
    }

    function toggleMinimize() {
      if (settings.uiState === 'minimized') persistSettings({ uiState: 'open' });
      else {
        persistGeometryFromPanel();
        persistSettings({ uiState: 'minimized' });
      }
      render();
      return settings.uiState;
    }

    function open() {
      persistSettings({ uiState: 'open' });
      render();
      return true;
    }

    function attachPanelEvents(node) {
      node.addEventListener('click', event => {
        const button = event.target && event.target.closest && event.target.closest('[data-action]');
        if (!button || !node.contains(button)) return;
        const action = button.dataset.action;
        if (action === 'refresh') {
          load({ force: false }).catch(() => {});
          return;
        }
        if (action === 'force-refresh') {
          load({ force: true }).catch(() => {});
          return;
        }
        if (action === 'retry-market') {
          retryMarket(Number(button.dataset.propertyTypeId)).catch(() => {});
          return;
        }
        if (action === 'minimize') {
          toggleMinimize();
          return;
        }
        if (action === 'close') {
          closePanel();
          return;
        }
        if (action === 'toggle-theme') {
          setTheme(settings.theme === 'dark' ? 'light' : 'dark');
          return;
        }
        if (action === 'toggle-settings') {
          settingsOpen = !settingsOpen;
          render();
          return;
        }
        if (action === 'save-settings') {
          const fields = readSettingsFields(node);
          const patch = { undercutPercent: fields.undercutPercent };
          if (fields.apiKey) patch.apiKey = fields.apiKey;
          persistSettings(patch);
          state.rows = computeRows(state.properties, state.markets);
          render();
          return;
        }
        if (action === 'clear-api-key') {
          setApiKey('');
          return;
        }
        if (action === 'set-price') {
          setPriceForProperty(Number(button.dataset.propertyId));
          return;
        }
        if (action === 'list-property') {
          listPreparedProperty(Number(button.dataset.propertyId));
        }
      });
    }

    function attachDrag(node) {
      if (isMobile()) return;
      const handle = node.querySelector('[data-role="drag-handle"]');
      if (!handle) return;
      let dragging = false;
      let startX = 0;
      let startY = 0;
      let originLeft = 0;
      let originTop = 0;

      const onMove = event => {
        if (!dragging) return;
        node.style.left = `${Math.max(0, originLeft + event.clientX - startX)}px`;
        node.style.top = `${Math.max(0, originTop + event.clientY - startY)}px`;
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        persistGeometryFromPanel();
      };
      const onDown = event => {
        if (event.button != null && event.button !== 0) return;
        dragging = true;
        startX = event.clientX;
        startY = event.clientY;
        originLeft = parseInt(node.style.left, 10) || 0;
        originTop = parseInt(node.style.top, 10) || 0;
        if (typeof event.preventDefault === 'function') event.preventDefault();
      };

      handle.addEventListener('mousedown', onDown);
      windowLike.addEventListener('mousemove', onMove);
      windowLike.addEventListener('mouseup', onUp);
      dragCleanup = () => {
        handle.removeEventListener('mousedown', onDown);
        windowLike.removeEventListener('mousemove', onMove);
        windowLike.removeEventListener('mouseup', onUp);
      };
    }

    function persistGeometryFromPanel() {
      if (!panel || isMobile() || settings.uiState === 'minimized') return;
      const geometry = {
        left: parseInt(panel.style.left, 10) || 0,
        top: parseInt(panel.style.top, 10) || 0,
        width: panel.offsetWidth || parseInt(panel.style.width, 10) || settings.geometry.width,
        height: panel.offsetHeight || parseInt(panel.style.height, 10) || settings.geometry.height
      };
      persistSettings({ geometry });
    }

    function attachResize(node) {
      if (isMobile() || settings.uiState === 'minimized') return;
      if (windowLike.ResizeObserver) {
        resizeObserver = new windowLike.ResizeObserver(() => persistGeometryFromPanel());
        resizeObserver.observe(node);
      }
    }

    function renderResizeHandle(container) {
      if (isMobile() || settings.uiState === 'minimized') return;
      const handle = el(documentLike, 'div', {
        attrs: {
          'data-role': 'resize-handle',
          title: 'Drag to resize Property Rental Manager',
          'aria-label': 'Resize Property Rental Manager'
        }
      });
      handle.style.position = 'absolute';
      handle.style.right = '1px';
      handle.style.bottom = '1px';
      handle.style.width = '20px';
      handle.style.height = '20px';
      handle.style.cursor = 'nwse-resize';
      handle.style.zIndex = '4';
      handle.style.borderRight = settings.theme === 'light' ? '3px solid #0d5c19' : '3px solid #74ff8b';
      handle.style.borderBottom = settings.theme === 'light' ? '3px solid #0d5c19' : '3px solid #74ff8b';
      handle.style.borderRadius = '0 0 8px 0';
      handle.style.boxSizing = 'border-box';
      container.appendChild(handle);
    }

    function attachExplicitResize(node) {
      if (isMobile() || settings.uiState === 'minimized') return;
      const handle = node.querySelector('[data-role="resize-handle"]');
      if (!handle) return;
      let resizing = false;
      let startX = 0;
      let startY = 0;
      let originWidth = 0;
      let originHeight = 0;

      const onMove = event => {
        if (!resizing) return;
        const width = integer(originWidth + event.clientX - startX, 360, 3000, originWidth);
        const height = integer(originHeight + event.clientY - startY, 260, 2400, originHeight);
        node.style.width = `${width}px`;
        node.style.height = `${height}px`;
      };
      const onUp = () => {
        if (!resizing) return;
        resizing = false;
        persistGeometryFromPanel();
      };
      const onDown = event => {
        if (event.button != null && event.button !== 0) return;
        resizing = true;
        startX = event.clientX;
        startY = event.clientY;
        originWidth = node.offsetWidth || parseInt(node.style.width, 10) || settings.geometry.width;
        originHeight = node.offsetHeight || parseInt(node.style.height, 10) || settings.geometry.height;
        if (typeof event.preventDefault === 'function') event.preventDefault();
        if (typeof event.stopPropagation === 'function') event.stopPropagation();
      };

      handle.addEventListener('mousedown', onDown);
      windowLike.addEventListener('mousemove', onMove);
      windowLike.addEventListener('mouseup', onUp);
      resizeCleanup = () => {
        handle.removeEventListener('mousedown', onDown);
        windowLike.removeEventListener('mousemove', onMove);
        windowLike.removeEventListener('mouseup', onUp);
      };
    }

    function render() {
      if (dragCleanup) {
        dragCleanup();
        dragCleanup = null;
      }
      if (resizeCleanup) {
        resizeCleanup();
        resizeCleanup = null;
      }
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (panel && panel.parentNode) panel.remove();
      panel = null;

      if (settings.uiState === 'closed') return null;

      panel = el(documentLike, 'aside', { attrs: { id: 'r4g3-prm-panel' } });
      panel.className = `r4g3-prm-theme-${settings.theme}`;
      applyPanelGeometry(panel);
      addStyles(panel);
      renderHeader(panel);

      if (settings.uiState !== 'minimized') {
        renderSettings(panel);
        if (!renderStatus(panel)) {
          for (const row of state.rows) renderRow(row, panel);
        }
        renderResizeHandle(panel);
      }

      documentLike.body.appendChild(panel);
      attachPanelEvents(panel);
      attachDrag(panel);
      attachResize(panel);
      attachExplicitResize(panel);
      return panel;
    }

    async function performLoad(options) {
      if (apiClientFactory && !settings.apiKey) {
        settingsOpen = true;
        state = {
          properties: [],
          markets: {},
          rows: [],
          loading: false,
          error: null,
          needsApiKey: true,
          actionMessage: '',
          scanProgress: null
        };
        render();
        return state;
      }

      const apiClient = getApiClient();
      state = Object.assign({}, state, { loading: true, error: null, needsApiKey: false, actionMessage: '', scanProgress: null });
      render();
      try {
        const currentUserId = typeof apiClient.fetchCurrentUserId === 'function'
          ? await apiClient.fetchCurrentUserId()
          : null;
        const rawProperties = await apiClient.fetchOwnedProperties();
        const properties = propertyCore.normalizeProperties(rawProperties, currentUserId);
        const typeIds = [...new Set(properties.map(property => Number(property.propertyTypeId)).filter(Boolean))];
        state = Object.assign({}, state, {
          properties,
          markets: {},
          rows: computeRows(properties, {}),
          scanProgress: { done: 0, total: typeIds.length }
        });
        render();

        const markets = await apiClient.scanMarkets(properties, {
          force: Boolean(options && options.force),
          onProgress(entry) {
            const nextMarkets = Object.assign({}, state.markets, { [entry.id]: entry.market });
            state = Object.assign({}, state, {
              markets: nextMarkets,
              rows: computeRows(properties, nextMarkets),
              scanProgress: { done: entry.done, total: entry.total }
            });
            render();
          }
        });
        const rows = computeRows(properties, markets);
        state = { properties, markets, rows, loading: false, error: null, needsApiKey: false, actionMessage: '', scanProgress: null };
        render();
        return state;
      } catch (error) {
        state = Object.assign({}, state, { loading: false, error: error || new Error('Unknown load failure'), needsApiKey: false, scanProgress: null });
        render();
        throw error;
      }
    }

    function load(options) {
      if (activeLoadPromise) return activeLoadPromise;
      activeLoadPromise = performLoad(options).finally(() => {
        activeLoadPromise = null;
      });
      return activeLoadPromise;
    }

    function setTheme(theme) {
      persistSettings({ theme });
      render();
      return settings.theme;
    }

    function setMode() {
      return 'simple';
    }

    function openSettings() {
      if (settings.uiState === 'closed' || settings.uiState === 'minimized') persistSettings({ uiState: 'open' });
      settingsOpen = true;
      render();
      return true;
    }

    function setApiKey(apiKey) {
      persistSettings({ apiKey: String(apiKey || '').trim() });
      if (cachedApiKey !== settings.apiKey) {
        cachedApiClient = null;
        cachedApiKey = '';
      }
      state = Object.assign({}, state, { needsApiKey: apiClientFactory ? !settings.apiKey : false, error: null });
      settingsOpen = true;
      render();
      return Boolean(settings.apiKey);
    }

    function destroy() {
      if (dragCleanup) dragCleanup();
      if (resizeCleanup) resizeCleanup();
      if (resizeObserver) resizeObserver.disconnect();
      if (panel && panel.parentNode) panel.remove();
      panel = null;
    }

    render();

    return Object.freeze({
      load,
      render,
      open,
      close: closePanel,
      toggleMinimize,
      retryMarket,
      setPriceForProperty,
      listPreparedProperty,
      prepareLease: setPriceForProperty,
      setMode,
      setTheme,
      openSettings,
      setApiKey,
      destroy,
      getState: () => state,
      getSettings: () => Object.assign({}, settings, { geometry: Object.assign({}, settings.geometry) })
    });
  }

  return Object.freeze({
    SETTINGS_KEY,
    TARGET_DAYS,
    DEFAULT_SETTINGS,
    normalizeSettings,
    loadSettings,
    saveSettings,
    createController
  });
}));

/* ===== src/bootstrap.js ===== */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalBootstrap = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function assertApiUrl(value) {
    const url = new URL(String(value), R4G3ApiCore.API_ORIGIN);
    if (url.origin !== R4G3ApiCore.API_ORIGIN || !url.pathname.startsWith('/v2/')) {
      throw new Error('Rejected non-Torn API request');
    }
    return url;
  }

  function createApiFetch(windowLike) {
    return function apiFetch(value, init) {
      let url;
      try {
        url = assertApiUrl(value);
      } catch (error) {
        return Promise.reject(error);
      }

      const request = init || {};
      if (typeof GM_xmlhttpRequest === 'function') {
        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: request.method || 'GET',
            url: url.toString(),
            headers: request.headers || {},
            timeout: 30000,
            onload(response) {
              const status = Number(response.status) || 0;
              resolve({
                ok: status >= 200 && status < 300,
                status,
                async json() {
                  const text = response.responseText || '{}';
                  return JSON.parse(text);
                }
              });
            },
            ontimeout() {
              reject(new Error('Torn API request timed out'));
            },
            onerror() {
              reject(new Error('Torn API request failed'));
            }
          });
        });
      }

      if (!windowLike || typeof windowLike.fetch !== 'function') {
        return Promise.reject(new Error('No supported HTTP transport is available'));
      }
      return windowLike.fetch(url.toString(), request);
    };
  }

  function findInformationSection(documentLike) {
    if (!documentLike || !documentLike.querySelectorAll) return null;
    const candidates = documentLike.querySelectorAll('h1,h2,h3,h4,h5,h6,span,div,strong');
    for (const node of candidates) {
      if (String(node.textContent || '').trim().toLowerCase() !== 'information') continue;
      if (node.closest) {
        const section = node.closest('section,aside,nav,li,div');
        if (section) return section;
      }
      if (node.parentElement) return node.parentElement;
    }
    return null;
  }

  function createLauncher(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const onOpen = typeof config.onOpen === 'function' ? config.onOpen : () => {};
    const onEnsure = typeof config.onEnsure === 'function' ? config.onEnsure : () => {};
    let observer = null;

    function makeButton(id, floating) {
      const button = documentLike.createElement('button');
      button.id = id;
      button.type = 'button';
      button.title = 'Open Property Rental Manager';
      button.setAttribute('aria-label', 'Open Property Rental Manager');
      button.style.cursor = 'pointer';
      button.style.display = 'inline-flex';
      button.style.alignItems = 'center';
      button.style.justifyContent = 'center';
      button.style.gap = '6px';
      button.style.border = '1px solid rgba(116,255,139,0.55)';
      button.style.borderRadius = '7px';
      button.style.background = '#111512';
      button.style.color = '#74ff8b';
      button.style.padding = floating ? '9px 11px' : '6px 8px';
      button.style.fontSize = '12px';
      button.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M3 11.5 12 4l9 7.5v8a1 1 0 0 1-1 1h-5.5v-6h-5v6H4a1 1 0 0 1-1-1v-8Z"/></svg><span>Rentals</span>';
      button.addEventListener('click', event => {
        if (event && typeof event.preventDefault === 'function') event.preventDefault();
        onOpen();
      });
      if (floating) {
        button.style.position = 'fixed';
        button.style.right = '14px';
        button.style.bottom = '76px';
        button.style.zIndex = '99998';
        button.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
      }
      return button;
    }

    function finishEnsure(button) {
      onEnsure();
      return button;
    }

    function ensure() {
      if (!documentLike || !documentLike.body) return null;
      let sidebar = documentLike.getElementById('r4g3-prm-sidebar-launcher');
      let floating = documentLike.getElementById('r4g3-prm-floating-launcher');
      const information = findInformationSection(documentLike);

      if (information) {
        if (!sidebar || !information.contains(sidebar)) {
          if (sidebar && sidebar.parentNode) sidebar.remove();
          sidebar = makeButton('r4g3-prm-sidebar-launcher', false);
          const host = information.querySelector && information.querySelector('.links,ul,ol') || information;
          host.appendChild(sidebar);
        }
        if (floating && floating.parentNode) floating.remove();
        return finishEnsure(sidebar);
      }

      if (sidebar && sidebar.parentNode) sidebar.remove();
      if (!floating) {
        floating = makeButton('r4g3-prm-floating-launcher', true);
        documentLike.body.appendChild(floating);
      }
      return finishEnsure(floating);
    }

    function start() {
      ensure();
      if (windowLike && windowLike.MutationObserver && documentLike && documentLike.body) {
        observer = new windowLike.MutationObserver(() => ensure());
        observer.observe(documentLike.body, { childList: true, subtree: true });
      }
      return true;
    }

    function destroy() {
      if (observer) observer.disconnect();
      observer = null;
      const sidebar = documentLike && documentLike.getElementById('r4g3-prm-sidebar-launcher');
      const floating = documentLike && documentLike.getElementById('r4g3-prm-floating-launcher');
      if (sidebar && sidebar.parentNode) sidebar.remove();
      if (floating && floating.parentNode) floating.remove();
    }

    return Object.freeze({ ensure, start, destroy });
  }

  function createLeasePreparer(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const draftStore = config.draftStore;
    const onPrepared = typeof config.onPrepared === 'function' ? config.onPrepared : () => {};
    let observer = null;
    let timeoutId = null;

    function stop() {
      if (observer) observer.disconnect();
      observer = null;
      if (timeoutId != null && windowLike) windowLike.clearTimeout(timeoutId);
      timeoutId = null;
    }

    function prepareOnce() {
      const propertyId = R4G3FormCore.parseLeasePropertyId(windowLike && windowLike.location);
      if (!propertyId) {
        stop();
        return { prepared: false, reason: 'Not a lease route' };
      }

      const draft = draftStore.loadFor(propertyId);
      if (!draft) {
        stop();
        return { prepared: false, reason: 'No pending lease draft' };
      }

      const result = R4G3FormCore.prepareLeaseForm({
        document: documentLike,
        window: windowLike,
        location: windowLike.location,
        draft
      });
      if (result.prepared) {
        stop();
        onPrepared(result, draft);
      }
      return result;
    }

    function prepareWithWait() {
      stop();
      const first = prepareOnce();
      if (first.prepared || first.reason !== 'Form not recognized') return first;
      if (!windowLike || !windowLike.MutationObserver || !documentLike || !documentLike.body) return first;

      observer = new windowLike.MutationObserver(() => {
        const result = prepareOnce();
        if (result.prepared) stop();
      });
      observer.observe(documentLike.body, { childList: true, subtree: true });
      timeoutId = windowLike.setTimeout(stop, 15000);
      return first;
    }

    return Object.freeze({
      prepareOnce,
      prepareWithWait,
      stop
    });
  }

  function createLeaseLister(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const draftStore = config.draftStore;
    const onListed = typeof config.onListed === 'function' ? config.onListed : () => {};

    function markChanged(reason) {
      if (!/changed/i.test(String(reason || ''))) return;
      const summary = documentLike && documentLike.querySelector && documentLike.querySelector('.r4g3-prm-inline-summary');
      const message = 'VALUES CHANGED • Press PREPARE RENTAL again';
      if (summary && summary.textContent !== message) summary.textContent = message;
    }

    function canList(propertyId) {
      const id = Number(propertyId);
      const routeId = R4G3FormCore.parseLeasePropertyId(windowLike && windowLike.location);
      if (!Number.isInteger(id) || id <= 0 || routeId !== id) return false;
      const draft = draftStore.loadFor(id);
      if (!draft) return false;

      const verified = R4G3FormCore.verifyPreparedLeaseForm({
        document: documentLike,
        window: windowLike,
        location: windowLike.location,
        draft
      });
      if (!verified.verified) {
        markChanged(verified.reason);
        return false;
      }

      const submit = R4G3FormCore.findLeaseSubmitButton(documentLike, verified.form.root);
      if (!submit) return false;
      if (submit.disabled) return false;
      if (submit.getAttribute && submit.getAttribute('aria-disabled') === 'true') return false;
      return true;
    }

    function list(propertyId) {
      const id = Number(propertyId);
      const routeId = R4G3FormCore.parseLeasePropertyId(windowLike && windowLike.location);
      if (!Number.isInteger(id) || id <= 0 || routeId !== id) {
        return { submitted: false, reason: 'Matching prepared lease form is not ready' };
      }
      const draft = draftStore.loadFor(id);
      if (!draft) return { submitted: false, reason: 'No pending lease draft' };

      const result = R4G3FormCore.submitLeaseFromUserGesture({
        document: documentLike,
        window: windowLike,
        location: windowLike.location,
        draft
      });
      if (result.submitted) {
        draftStore.clear();
        onListed(result, draft);
      } else {
        markChanged(result.reason);
      }
      return result;
    }

    return Object.freeze({ canList, list });
  }

  function decorateRentalActions(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const canListProperty = typeof config.canListProperty === 'function' ? config.canListProperty : () => false;
    const onPrepareRental = typeof config.onPrepareRental === 'function' ? config.onPrepareRental : null;
    if (!documentLike || typeof documentLike.querySelectorAll !== 'function') return 0;

    let decorated = 0;
    for (const row of documentLike.querySelectorAll('[data-property-id]')) {
      const prepare = row.querySelector('[data-action="set-price"]');
      const list = row.querySelector('[data-action="list-property"]');
      if (!prepare || !list) continue;

      const propertyId = Number(row.getAttribute('data-property-id'));
      if (prepare.textContent !== 'PREPARE RENTAL') prepare.textContent = 'PREPARE RENTAL';
      prepare.title = 'Open Torn lease options and fill the prepared 100-day rental values';

      if (onPrepareRental && prepare.dataset.r4g3PrepareHook !== '1') {
        prepare.dataset.r4g3PrepareHook = '1';
        prepare.addEventListener('click', () => {
          const run = () => onPrepareRental(propertyId);
          if (windowLike && typeof windowLike.setTimeout === 'function') windowLike.setTimeout(run, 0);
          else Promise.resolve().then(run);
        });
      }

      const ready = canListProperty(propertyId);
      list.disabled = !ready;
      list.style.opacity = ready ? '1' : '0.45';
      list.title = ready
        ? 'Verify the visible Torn values and list this property once'
        : 'Press PREPARE RENTAL first and keep Torn\'s prepared values unchanged.';

      let status = row.querySelector('[data-role="staged-rental-status"]');
      if (ready) {
        if (!status) {
          status = documentLike.createElement('div');
          status.setAttribute('data-role', 'staged-rental-status');
          status.style.gridColumn = '1 / -1';
          status.style.fontWeight = '700';
          status.style.marginTop = '2px';
          const actions = list.parentElement;
          if (actions && actions.parentElement === row) row.insertBefore(status, actions);
          else row.appendChild(status);
        }
        const readyText = 'READY TO LIST • 100 days • visible Torn values verified';
        if (status.textContent !== readyText) status.textContent = readyText;
      } else if (status && status.parentNode) {
        status.remove();
      }
      decorated += 1;
    }
    return decorated;
  }

  function start(windowLike) {
    const win = windowLike || root;
    if (!win || !win.document || !win.location) return null;
    if (win.location.hostname !== 'www.torn.com' || win.location.pathname !== '/properties.php') return null;

    const draftStore = R4G3DraftCore.createStore(win.sessionStorage);
    const apiFetch = createApiFetch(win);
    let controller = null;
    let refreshRentalActions = () => {};
    const leasePreparer = createLeasePreparer({
      window: win,
      document: win.document,
      draftStore,
      onPrepared() {
        if (controller) {
          controller.render();
          refreshRentalActions();
        }
      }
    });
    const leaseLister = createLeaseLister({
      window: win,
      document: win.document,
      draftStore
    });

    controller = R4G3PropertyRentalApp.createController({
      window: win,
      document: win.document,
      storage: win.localStorage,
      propertyCore: R4G3PropertyCore,
      marketCore: R4G3MarketCore,
      draftStore,
      apiClientFactory(apiKey) {
        return R4G3ApiCore.createClient({
          apiKey,
          fetchImpl: apiFetch,
          storage: win.localStorage
        });
      },
      navigate(url) {
        win.location.href = url;
      },
      canListProperty(propertyId) {
        return leaseLister.canList(propertyId);
      },
      listProperty(propertyId) {
        return leaseLister.list(propertyId);
      }
    });

    refreshRentalActions = () => decorateRentalActions({
      window: win,
      document: win.document,
      canListProperty(propertyId) {
        return leaseLister.canList(propertyId);
      },
      onPrepareRental() {
        leasePreparer.prepareWithWait();
      }
    });

    const launcher = createLauncher({
      window: win,
      document: win.document,
      onOpen() {
        controller.open();
        refreshRentalActions();
      },
      onEnsure() {
        refreshRentalActions();
      }
    });

    const onHashChange = () => {
      leasePreparer.prepareWithWait();
      controller.render();
      refreshRentalActions();
      launcher.ensure();
    };
    win.addEventListener('hashchange', onHashChange);
    leasePreparer.prepareWithWait();
    launcher.start();
    controller.load().then(() => {
      refreshRentalActions();
    }).catch(() => {
      // The controller renders a sanitized error state. Never log the API key-bearing error.
    });

    return Object.freeze({
      controller,
      leasePreparer,
      leaseLister,
      launcher,
      refreshRentalActions,
      destroy() {
        win.removeEventListener('hashchange', onHashChange);
        leasePreparer.stop();
        launcher.destroy();
        controller.destroy();
      }
    });
  }

  return Object.freeze({
    assertApiUrl,
    createApiFetch,
    findInformationSection,
    createLauncher,
    createLeasePreparer,
    createLeaseLister,
    decorateRentalActions,
    start
  });
}));

/* ===== userscript start ===== */
R4G3PropertyRentalBootstrap.start();
