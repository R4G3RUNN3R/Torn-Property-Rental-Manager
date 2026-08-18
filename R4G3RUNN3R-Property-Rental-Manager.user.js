// ==UserScript==
// @name         R4G3RUNN3R Property Rental Manager
// @namespace    https://github.com/R4G3RUNN3R
// @version      0.1.0
// @description  Scan owned Torn properties, compare rental listings, and safely prepare native lease forms.
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

  function normalizeProperty(raw, currentUserId) {
    if (!raw || typeof raw !== 'object') return null;

    const ownerId = String(
      (raw.owner && raw.owner.id) != null ? raw.owner.id :
      raw.owner_id != null ? raw.owner_id : ''
    );

    if (currentUserId != null && ownerId && ownerId !== String(currentUserId)) {
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

  return Object.freeze({
    normalizeRental,
    happySimilarity,
    modificationSimilarity,
    similarity,
    selectComparables,
    marketStats
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

  function createClient(options) {
    const config = Object.assign({}, options || {});
    const apiKey = String(config.apiKey || '').trim();
    const fetchImpl = config.fetchImpl || (root && root.fetch ? root.fetch.bind(root) : null);
    const now = config.now || (() => Date.now());
    const sleep = config.sleep || defaultSleep;
    const storage = safeStorage(config.storage || (root && root.localStorage));
    const scheduler = config.scheduler || createScheduler({ now, sleep });

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

      if (!response.ok) {
        if (TRANSIENT_STATUSES.has(Number(response.status)) && tryNumber < 2) {
          await sleep(250 * (tryNumber + 1));
          return requestJson(url, tryNumber + 1);
        }
        const detail = body && body.error
          ? (body.error.error || body.error.message || JSON.stringify(body.error))
          : `HTTP ${response.status}`;
        throw new Error(redact(`Torn API ${response.status}: ${detail}`, apiKey));
      }

      if (body && body.error) {
        const detail = body.error.error || body.error.message || JSON.stringify(body.error);
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
      const market = {
        rentals: result.rows,
        rentals_timestamp: result.firstBody.rentals_timestamp == null ? null : result.firstBody.rentals_timestamp,
        rentals_delay: result.firstBody.rentals_delay == null ? null : result.firstBody.rentals_delay,
        fetchedAt: now(),
        fromCache: false
      };
      writeCache(id, market);
      return market;
    }

    async function scanMarkets(properties, options) {
      const ids = [...new Set((Array.isArray(properties) ? properties : [])
        .map(property => positiveInt(property && property.propertyTypeId))
        .filter(Boolean))]
        .sort((a, b) => a - b);

      const markets = {};
      for (const id of ids) {
        markets[id] = await fetchRentalMarket(id, options || {});
      }
      return markets;
    }

    return Object.freeze({
      fetchOwnedProperties,
      fetchRentalMarket,
      scanMarkets
    });
  }

  return Object.freeze({
    API_ORIGIN,
    API_BASE,
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
      const dailyPrice = positiveInteger(source.dailyPrice);

      if (!propertyId) throw new TypeError('A positive property ID is required');
      if (!days || days > 365) throw new RangeError('Lease days must be an integer from 1 to 365');
      if (!dailyPrice) throw new RangeError('Daily price must be a positive integer');

      const normalized = {
        propertyId,
        days,
        dailyPrice,
        totalCost: days * dailyPrice,
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

  function setNativeValue(input, value, windowLike) {
    if (!input) throw new TypeError('Input element is required');
    const win = windowLike || input.ownerDocument && input.ownerDocument.defaultView;
    const prototype = win && win.HTMLInputElement && win.HTMLInputElement.prototype;
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'value');

    if (descriptor && typeof descriptor.set === 'function') descriptor.set.call(input, String(value));
    else input.value = String(value);

    if (win && typeof win.Event === 'function') {
      input.dispatchEvent(new win.Event('input', { bubbles: true }));
      input.dispatchEvent(new win.Event('change', { bubbles: true }));
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
      `Recommended $${money(draft.dailyPrice)}/day`,
      `${draft.days} days`,
      `Total $${money(totalCost)}`
    ];
    if (draft.marketFloor != null) bits.push(`Floor $${money(draft.marketFloor)}/day`);
    if (draft.median != null) bits.push(`Median $${money(draft.median)}/day`);
    if (draft.confidence) bits.push(`Confidence ${draft.confidence}`);

    summary.textContent = bits.join(' • ');
    return summary;
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

    const days = positiveInteger(draft.days);
    const dailyPrice = positiveInteger(draft.dailyPrice);
    if (!days || days > 365 || !dailyPrice) {
      return { prepared: false, reason: 'Invalid lease draft' };
    }

    const form = findLeaseForm(documentLike);
    if (!form) return { prepared: false, reason: 'Form not recognized' };

    const totalCost = days * dailyPrice;
    setNativeValue(form.daysInput, days, windowLike);
    setNativeValue(form.costInput, totalCost, windowLike);
    const summary = upsertSummary(form.root, Object.assign({}, draft, { days, dailyPrice }), totalCost);

    return {
      prepared: true,
      propertyId,
      days,
      dailyPrice,
      totalCost,
      summary
    };
  }

  return Object.freeze({
    parseLeasePropertyId,
    findLeaseForm,
    setNativeValue,
    prepareLeaseForm
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
  const MOBILE_BREAKPOINT = 700;
  const DEFAULT_SETTINGS = Object.freeze({
    apiKey: '',
    theme: 'dark',
    mode: 'simple',
    days: 30,
    undercutPercent: 0.5,
    minimumMedianRatio: 0.70,
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

  function positiveInteger(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
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

  function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : DEFAULT_SETTINGS.apiKey,
      theme: source.theme === 'light' ? 'light' : 'dark',
      mode: source.mode === 'advanced' ? 'advanced' : 'simple',
      days: integer(source.days, 1, 365, DEFAULT_SETTINGS.days),
      undercutPercent: clamp(source.undercutPercent, 0, 25, DEFAULT_SETTINGS.undercutPercent),
      minimumMedianRatio: clamp(source.minimumMedianRatio, 0, 1, DEFAULT_SETTINGS.minimumMedianRatio),
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
    const normalized = normalizeSettings(Object.assign({}, current, next || {}, {
      geometry: next && next.geometry ? next.geometry : current.geometry
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

  function percent(value) {
    const number = Number(value);
    return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : 'n/a';
  }

  function labelStatus(status) {
    const text = String(status || 'unknown').replace(/_/g, ' ').trim();
    return text ? text.replace(/\b\w/g, char => char.toUpperCase()) : 'Unknown';
  }

  function personLabel(person) {
    if (!person || typeof person !== 'object') return 'n/a';
    if (person.name && person.id) return `${person.name} [${person.id}]`;
    if (person.name) return person.name;
    if (person.id) return `#${person.id}`;
    return 'n/a';
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
      needsApiKey: false
    };
    const priceOverrides = new Map();
    let panel = null;
    let dragCleanup = null;
    let resizeObserver = null;
    let settingsOpen = false;

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
        const client = apiClientFactory(settings.apiKey);
        if (!client || typeof client.fetchOwnedProperties !== 'function' || typeof client.scanMarkets !== 'function') {
          throw new TypeError('apiClientFactory returned an invalid client');
        }
        return client;
      }
      return fixedApiClient;
    }

    function computeRows(properties, markets) {
      return properties.map(property => {
        const market = markets && markets[property.propertyTypeId];
        const stats = marketCore.marketStats(
          property,
          market && Array.isArray(market.rentals) ? market.rentals : [],
          {
            undercutPercent: settings.undercutPercent,
            minimumMedianRatio: settings.minimumMedianRatio
          }
        );
        return { property, market: market || null, stats };
      });
    }

    function effectiveDailyPrice(entry) {
      const override = positiveInteger(priceOverrides.get(entry.property.id));
      if (override) return override;
      return positiveInteger(entry.stats.suggestedDaily) || null;
    }

    function applyPanelGeometry(node) {
      node.style.position = 'fixed';
      node.style.overflow = 'auto';
      node.style.zIndex = '99999';
      node.style.maxWidth = 'calc(100vw - 16px)';
      node.style.maxHeight = 'calc(100vh - 16px)';

      if (isMobile()) {
        node.style.left = '8px';
        node.style.top = '8px';
        node.style.width = 'calc(100vw - 16px)';
        node.style.height = 'calc(100vh - 16px)';
        node.style.resize = 'none';
        return;
      }

      const geometry = settings.geometry;
      node.style.left = `${geometry.left}px`;
      node.style.top = `${geometry.top}px`;
      node.style.width = `${geometry.width}px`;
      node.style.height = `${geometry.height}px`;
      node.style.resize = 'both';
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

    function createButton(text, action) {
      const button = el(documentLike, 'button', { text, attrs: { type: 'button', 'data-action': action } });
      button.style.cursor = 'pointer';
      button.style.padding = '6px 9px';
      button.style.borderRadius = '6px';
      button.style.border = '1px solid currentColor';
      button.style.background = 'transparent';
      button.style.color = 'inherit';
      return button;
    }

    function renderHeader(container) {
      const header = el(documentLike, 'div', { className: 'r4g3-prm-header' });
      header.style.display = 'flex';
      header.style.alignItems = 'center';
      header.style.flexWrap = 'wrap';
      header.style.gap = '8px';
      header.style.padding = '9px 10px';
      header.style.borderBottom = '1px solid rgba(128,128,128,0.35)';
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

      const refreshButton = createButton(state.loading ? 'Scanning…' : 'Refresh', 'refresh');
      refreshButton.disabled = Boolean(state.loading);
      const settingsButton = createButton(settingsOpen ? 'Close Settings' : 'Settings', 'toggle-settings');
      const modeButton = createButton(settings.mode === 'advanced' ? 'Simple' : 'Advanced', 'toggle-mode');
      const themeButton = createButton(settings.theme === 'dark' ? 'Light' : 'Dark', 'toggle-theme');
      header.append(refreshButton, settingsButton, modeButton, themeButton);
      container.appendChild(header);
    }

    function renderSettings(container) {
      if (!settingsOpen) return;
      const box = el(documentLike, 'section', { className: 'r4g3-prm-settings' });
      box.style.padding = '10px';
      box.style.margin = '8px';
      box.style.border = '1px solid rgba(128,128,128,0.35)';
      box.style.borderRadius = '8px';
      box.style.display = 'grid';
      box.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))';
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

      const daysWrap = el(documentLike, 'label', { text: 'Default lease days: ' });
      const daysInput = el(documentLike, 'input', {
        attrs: { type: 'number', min: '1', max: '365', 'data-role': 'days-input' }
      });
      daysInput.value = String(settings.days);
      daysWrap.appendChild(daysInput);
      box.appendChild(daysWrap);

      const undercutWrap = el(documentLike, 'label', { text: 'Undercut %: ' });
      const undercutInput = el(documentLike, 'input', {
        attrs: { type: 'number', min: '0', max: '25', step: '0.1', 'data-role': 'undercut-input' }
      });
      undercutInput.value = String(settings.undercutPercent);
      undercutWrap.appendChild(undercutInput);
      box.appendChild(undercutWrap);

      const ratioWrap = el(documentLike, 'label', { text: 'Median safety ratio: ' });
      const ratioInput = el(documentLike, 'input', {
        attrs: { type: 'number', min: '0', max: '1', step: '0.01', 'data-role': 'median-ratio-input' }
      });
      ratioInput.value = String(settings.minimumMedianRatio);
      ratioWrap.appendChild(ratioInput);
      box.appendChild(ratioWrap);

      const actions = el(documentLike, 'div');
      actions.style.gridColumn = '1 / -1';
      actions.style.display = 'flex';
      actions.style.gap = '8px';
      actions.appendChild(createButton('Save Settings', 'save-settings'));
      if (settings.apiKey) actions.appendChild(createButton('Clear API Key', 'clear-api-key'));
      box.appendChild(actions);

      const note = el(documentLike, 'small', {
        text: 'Saved API keys are never rendered back into this page. Replacing a key requires entering it again.'
      });
      note.style.gridColumn = '1 / -1';
      note.style.opacity = '0.72';
      box.appendChild(note);
      container.appendChild(box);
    }

    function addCell(row, label, value, className, role) {
      const cell = el(documentLike, 'div', { className: className || '' });
      if (role) cell.dataset.role = role;
      const heading = el(documentLike, 'span', { text: `${label}: ` });
      heading.style.opacity = '0.68';
      cell.appendChild(heading);
      cell.appendChild(documentLike.createTextNode(String(value)));
      row.appendChild(cell);
      return cell;
    }

    function renderPriceOverride(entry, row) {
      if (settings.mode !== 'advanced' || !propertyCore.isEligibleForLease(entry.property) || entry.stats.suggestedDaily == null) return;
      const wrap = el(documentLike, 'label', { className: 'r4g3-prm-advanced', text: 'Daily price override: ' });
      const input = el(documentLike, 'input', {
        attrs: {
          type: 'number',
          min: '1',
          step: '1',
          'data-role': 'daily-price-override',
          'data-property-id': entry.property.id
        }
      });
      input.value = String(effectiveDailyPrice(entry));
      input.style.width = '120px';
      wrap.appendChild(input);
      row.appendChild(wrap);
    }

    function renderStatusDetails(property, row) {
      if (settings.mode !== 'advanced') return;
      if (property.status === 'rented') {
        addCell(row, 'Current rent / day', property.costPerDay == null ? 'n/a' : `$${money(property.costPerDay)}`, 'r4g3-prm-advanced');
        addCell(row, 'Rental period', property.rentalPeriod == null ? 'n/a' : `${money(property.rentalPeriod)} days`, 'r4g3-prm-advanced');
        addCell(row, 'Remaining', property.rentalPeriodRemaining == null ? 'n/a' : `${money(property.rentalPeriodRemaining)} days`, 'r4g3-prm-advanced');
        addCell(row, 'Rented by', personLabel(property.rentedBy), 'r4g3-prm-advanced');
      }
      if (property.status === 'for_rent') {
        addCell(row, 'Current asking / day', property.costPerDay == null ? 'n/a' : `$${money(property.costPerDay)}`, 'r4g3-prm-advanced');
        addCell(row, 'Listing period', property.rentalPeriod == null ? 'n/a' : `${money(property.rentalPeriod)} days`, 'r4g3-prm-advanced');
        if (property.renterAsked) addCell(row, 'Interested renter', personLabel(property.renterAsked), 'r4g3-prm-advanced');
      }
    }

    function renderRow(entry, container) {
      const { property, market, stats } = entry;
      const daily = effectiveDailyPrice(entry);
      const row = el(documentLike, 'section', {
        className: 'r4g3-prm-property',
        attrs: { 'data-property-id': property.id }
      });
      row.style.padding = '10px';
      row.style.margin = '8px';
      row.style.border = '1px solid rgba(128,128,128,0.28)';
      row.style.borderRadius = '8px';
      row.style.display = 'grid';
      row.style.gridTemplateColumns = 'repeat(auto-fit, minmax(145px, 1fr))';
      row.style.gap = '7px 12px';

      const title = el(documentLike, 'strong', { text: `${property.name} #${property.id}` });
      title.style.gridColumn = '1 / -1';
      row.appendChild(title);
      addCell(row, 'Status', labelStatus(property.status));
      addCell(row, 'Happy', money(property.happy));
      addCell(row, 'Market floor / day', stats.marketFloor == null ? 'No market data' : `$${money(stats.marketFloor)}`);
      addCell(row, 'Suggested / day', stats.suggestedDaily == null ? 'n/a' : `$${money(stats.suggestedDaily)}`);
      addCell(row, 'Lease period', `${settings.days} days`);
      addCell(row, 'Total lease value', daily == null ? 'n/a' : `$${money(daily * settings.days)}`, '', 'total-value');
      addCell(row, 'Confidence', stats.confidence);

      if (settings.mode === 'advanced') {
        addCell(row, 'Median', stats.median == null ? 'n/a' : `$${money(stats.median)}`, 'r4g3-prm-advanced');
        addCell(row, 'Q1', stats.q1 == null ? 'n/a' : `$${money(stats.q1)}`, 'r4g3-prm-advanced');
        addCell(row, 'Q3', stats.q3 == null ? 'n/a' : `$${money(stats.q3)}`, 'r4g3-prm-advanced');
        addCell(row, 'Comparables', stats.sampleSize, 'r4g3-prm-advanced');
        addCell(row, 'Average similarity', percent(stats.averageSimilarity), 'r4g3-prm-advanced');
        addCell(row, 'Modifications', property.modifications.length ? property.modifications.join(', ') : 'None', 'r4g3-prm-advanced');
        addCell(row, 'Market timestamp', market && market.rentals_timestamp != null ? market.rentals_timestamp : 'n/a', 'r4g3-prm-advanced');
        addCell(row, 'Market source', market && market.fromCache ? 'Cache' : 'API', 'r4g3-prm-advanced');
      }

      renderStatusDetails(property, row);
      renderPriceOverride(entry, row);

      if (propertyCore.isEligibleForLease(property) && daily != null) {
        const action = createButton('Prepare Lease', 'prepare-lease');
        action.dataset.propertyId = String(property.id);
        action.style.color = settings.theme === 'light' ? '#0d5c19' : '#74ff8b';
        row.appendChild(action);
      }

      container.appendChild(row);
    }

    function renderStatus(container) {
      if (state.needsApiKey) {
        const keyMessage = el(documentLike, 'div', {
          text: 'A Limited-or-higher Torn API key is required. Open Settings to configure it.'
        });
        keyMessage.style.padding = '14px';
        container.appendChild(keyMessage);
        return true;
      }
      if (state.loading) {
        const loading = el(documentLike, 'div', { text: 'Scanning owned properties and rental markets…' });
        loading.style.padding = '14px';
        container.appendChild(loading);
        return true;
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
      const daysInput = node.querySelector('[data-role="days-input"]');
      const undercutInput = node.querySelector('[data-role="undercut-input"]');
      const ratioInput = node.querySelector('[data-role="median-ratio-input"]');
      return {
        apiKey: keyInput && keyInput.value ? keyInput.value.trim() : null,
        days: daysInput ? daysInput.value : settings.days,
        undercutPercent: undercutInput ? undercutInput.value : settings.undercutPercent,
        minimumMedianRatio: ratioInput ? ratioInput.value : settings.minimumMedianRatio
      };
    }

    function updateOverrideFromInput(input) {
      const propertyId = positiveInteger(input && input.dataset && input.dataset.propertyId);
      if (!propertyId) return;
      const value = positiveInteger(input.value);
      if (value) priceOverrides.set(propertyId, value);
      else priceOverrides.delete(propertyId);

      const entry = state.rows.find(row => row.property.id === propertyId);
      const propertyRow = input.closest('[data-property-id]');
      const total = propertyRow && propertyRow.querySelector('[data-role="total-value"]');
      if (entry && total) {
        const daily = effectiveDailyPrice(entry);
        total.textContent = `Total lease value: ${daily == null ? 'n/a' : `$${money(daily * settings.days)}`}`;
      }
    }

    function attachPanelEvents(node) {
      node.addEventListener('change', event => {
        const input = event.target;
        if (input && input.matches && input.matches('[data-role="daily-price-override"]')) {
          updateOverrideFromInput(input);
        }
      });

      node.addEventListener('click', event => {
        const button = event.target && event.target.closest && event.target.closest('[data-action]');
        if (!button || !node.contains(button)) return;
        const action = button.dataset.action;
        if (action === 'refresh') {
          load({ force: true }).catch(() => {});
          return;
        }
        if (action === 'toggle-mode') {
          setMode(settings.mode === 'advanced' ? 'simple' : 'advanced');
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
          const patch = {
            days: fields.days,
            undercutPercent: fields.undercutPercent,
            minimumMedianRatio: fields.minimumMedianRatio
          };
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
        if (action === 'prepare-lease') {
          prepareLease(Number(button.dataset.propertyId));
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
      if (!panel || isMobile()) return;
      const geometry = {
        left: parseInt(panel.style.left, 10) || 0,
        top: parseInt(panel.style.top, 10) || 0,
        width: panel.offsetWidth || parseInt(panel.style.width, 10) || settings.geometry.width,
        height: panel.offsetHeight || parseInt(panel.style.height, 10) || settings.geometry.height
      };
      persistSettings({ geometry });
    }

    function attachResize(node) {
      if (isMobile()) return;
      if (windowLike.ResizeObserver) {
        resizeObserver = new windowLike.ResizeObserver(() => persistGeometryFromPanel());
        resizeObserver.observe(node);
      }
    }

    function render() {
      if (dragCleanup) { dragCleanup(); dragCleanup = null; }
      if (resizeObserver) { resizeObserver.disconnect(); resizeObserver = null; }
      if (panel && panel.parentNode) panel.remove();

      panel = el(documentLike, 'aside', {
        className: `r4g3-prm-theme-${settings.theme}`,
        attrs: { id: 'r4g3-prm-panel', 'aria-label': 'Property Rental Manager' }
      });
      applyPanelGeometry(panel);
      addStyles(panel);
      renderHeader(panel);
      renderSettings(panel);

      const body = el(documentLike, 'div', { className: 'r4g3-prm-body' });
      if (!renderStatus(body)) {
        for (const row of state.rows) renderRow(row, body);
      }
      panel.appendChild(body);
      documentLike.body.appendChild(panel);
      attachPanelEvents(panel);
      attachDrag(panel);
      attachResize(panel);
      return panel;
    }

    async function load(options) {
      if (apiClientFactory && !settings.apiKey) {
        settingsOpen = true;
        state = {
          properties: [],
          markets: {},
          rows: [],
          loading: false,
          error: null,
          needsApiKey: true
        };
        render();
        return state;
      }

      const apiClient = getApiClient();
      state = Object.assign({}, state, { loading: true, error: null, needsApiKey: false });
      render();
      try {
        const rawProperties = await apiClient.fetchOwnedProperties();
        const properties = propertyCore.normalizeProperties(rawProperties, null);
        const markets = await apiClient.scanMarkets(properties, { force: Boolean(options && options.force) });
        const rows = computeRows(properties, markets);
        state = { properties, markets, rows, loading: false, error: null, needsApiKey: false };
        render();
        return state;
      } catch (error) {
        state = Object.assign({}, state, { loading: false, error: error || new Error('Unknown load failure'), needsApiKey: false });
        render();
        throw error;
      }
    }

    function prepareLease(propertyId) {
      const id = Number(propertyId);
      const entry = state.rows.find(row => row.property.id === id);
      const dailyPrice = entry ? effectiveDailyPrice(entry) : null;
      if (!entry || !propertyCore.isEligibleForLease(entry.property) || dailyPrice == null) return false;

      draftStore.save({
        propertyId: id,
        days: settings.days,
        dailyPrice,
        marketFloor: entry.stats.marketFloor,
        median: entry.stats.median,
        confidence: entry.stats.confidence
      });
      navigate(propertyCore.leaseUrl(id));
      return true;
    }

    function setMode(mode) {
      persistSettings({ mode });
      state.rows = computeRows(state.properties, state.markets);
      render();
      return settings.mode;
    }

    function setTheme(theme) {
      persistSettings({ theme });
      render();
      return settings.theme;
    }

    function openSettings() {
      settingsOpen = true;
      render();
      return true;
    }

    function setApiKey(apiKey) {
      persistSettings({ apiKey: String(apiKey || '').trim() });
      state = Object.assign({}, state, { needsApiKey: apiClientFactory ? !settings.apiKey : false, error: null });
      settingsOpen = true;
      render();
      return Boolean(settings.apiKey);
    }

    function destroy() {
      if (dragCleanup) dragCleanup();
      if (resizeObserver) resizeObserver.disconnect();
      if (panel && panel.parentNode) panel.remove();
      panel = null;
    }

    render();

    return Object.freeze({
      load,
      render,
      prepareLease,
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

  function createLeasePreparer(options) {
    const config = options || {};
    const windowLike = config.window;
    const documentLike = config.document;
    const draftStore = config.draftStore;
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
        draftStore.clear();
        stop();
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

  function start(windowLike) {
    const win = windowLike || root;
    if (!win || !win.document || !win.location) return null;
    if (win.location.hostname !== 'www.torn.com' || win.location.pathname !== '/properties.php') return null;

    const draftStore = R4G3DraftCore.createStore(win.sessionStorage);
    const apiFetch = createApiFetch(win);
    const leasePreparer = createLeasePreparer({
      window: win,
      document: win.document,
      draftStore
    });

    const controller = R4G3PropertyRentalApp.createController({
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
      }
    });

    const onHashChange = () => leasePreparer.prepareWithWait();
    win.addEventListener('hashchange', onHashChange);
    leasePreparer.prepareWithWait();
    controller.load().catch(() => {
      // The controller renders a sanitized error state. Never log the API key-bearing error.
    });

    return Object.freeze({
      controller,
      leasePreparer,
      destroy() {
        win.removeEventListener('hashchange', onHashChange);
        leasePreparer.stop();
        controller.destroy();
      }
    });
  }

  return Object.freeze({
    assertApiUrl,
    createApiFetch,
    createLeasePreparer,
    start
  });
}));

/* ===== userscript start ===== */
R4G3PropertyRentalBootstrap.start();
