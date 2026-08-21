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
      minGapMs: 750,
      maxPerMinute: 80,
      now: () => Date.now(),
      sleep: defaultSleep
    }, options || {});

    const minGapMs = Math.max(0, Number(config.minGapMs) || 0);
    const maxPerMinute = Math.max(1, Math.floor(Number(config.maxPerMinute) || 80));
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
      const sequential = scanOptions.sequential === true;
      const betweenMarketsMs = Math.max(0, Number(scanOptions.betweenMarketsMs) || 0);
      const ids = [...new Set((Array.isArray(properties) ? properties : [])
        .map(property => positiveInt(property && property.propertyTypeId))
        .filter(Boolean))]
        .sort((a, b) => a - b);

      const markets = {};
      let done = 0;

      async function scanOne(id) {
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
      }

      if (sequential) {
        for (let index = 0; index < ids.length; index += 1) {
          await scanOne(ids[index]);
          if (betweenMarketsMs > 0 && index < ids.length - 1) await sleep(betweenMarketsMs);
        }
      } else {
        await Promise.all(ids.map(scanOne));
      }

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
