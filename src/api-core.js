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
