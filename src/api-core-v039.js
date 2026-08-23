(function (root, factory) {
  const baseApi = typeof module === 'object' && module.exports ? require('./api-core') : root.R4G3ApiCore;
  const api = factory(root, baseApi);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3ApiCore = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (root, baseApi) {
  'use strict';

  if (!baseApi) throw new Error('v0.3.9 API dependency is unavailable');

  const API_ORIGIN = baseApi.API_ORIGIN || 'https://api.torn.com';
  const API_BASE = baseApi.API_BASE || `${API_ORIGIN}/v2`;
  const CACHE_PREFIX = 'r4g3_property_rental_manager.market.';
  const FALLBACK_CACHE_MS = 15 * 60 * 1000;
  const RATE_LIMIT_COOLDOWN_MS = Number(baseApi.RATE_LIMIT_COOLDOWN_MS) || 60 * 1000;
  const PAGE_LIMIT = 100;
  const PAGE_WORKERS = 2;
  const MAX_PAGES = 100;
  const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

  function defaultSleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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

  function positiveInt(value) {
    const number = Number(value);
    return Number.isInteger(number) && number > 0 ? number : 0;
  }

  function redact(value, apiKey) {
    let text = String(value == null ? '' : value);
    if (apiKey) text = text.split(String(apiKey)).join('[REDACTED]');
    return text;
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

  function abortError() {
    const error = new Error('Scan cancelled');
    error.name = 'AbortError';
    return error;
  }

  function isAbortError(error) {
    return Boolean(error && error.name === 'AbortError');
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) throw abortError();
  }

  function rentalRows(body) {
    if (Array.isArray(body)) return body;
    if (body && Array.isArray(body.rentals)) return body.rentals;
    if (body && body.rentals && Array.isArray(body.rentals.listings)) return body.rentals.listings;
    if (body && body.data && Array.isArray(body.data.rentals)) return body.data.rentals;
    if (body && body.data && body.data.rentals && Array.isArray(body.data.rentals.listings)) return body.data.rentals.listings;
    return [];
  }

  function metadataTotal(body) {
    const candidates = [
      body && body._metadata && body._metadata.links && body._metadata.links.total,
      body && body.metadata && body.metadata.links && body.metadata.links.total,
      body && body._metadata && body._metadata.total,
      body && body.metadata && body.metadata.total
    ];
    for (const candidate of candidates) {
      const number = Number(candidate);
      if (Number.isFinite(number) && number >= 0) return Math.floor(number);
    }
    return null;
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

  function offsetUrl(propertyTypeId, offset) {
    const id = positiveInt(propertyTypeId);
    if (!id) throw new TypeError('A positive property type ID is required');
    const url = new URL(`${API_BASE}/market/${id}/rentals`);
    url.searchParams.set('limit', String(PAGE_LIMIT));
    url.searchParams.set('offset', String(Math.max(0, Math.floor(Number(offset) || 0))));
    return url.toString();
  }

  function createClient(options) {
    const config = Object.assign({}, options || {});
    const apiKey = String(config.apiKey || '').trim();
    const fetchImpl = config.fetchImpl || (root && root.fetch ? root.fetch.bind(root) : null);
    const now = config.now || (() => Date.now());
    const sleep = config.sleep || defaultSleep;
    const storage = safeStorage(config.storage || (root && root.localStorage));
    const scheduler = config.scheduler || baseApi.createScheduler({ now, sleep });

    if (!fetchImpl) throw new Error('A fetch implementation is required');

    const baseClient = baseApi.createClient(Object.assign({}, config, {
      fetchImpl,
      now,
      sleep,
      storage,
      scheduler
    }));

    function emit(callback, entry) {
      if (typeof callback !== 'function') return;
      try { callback(entry); } catch (error) { /* Reporting must never break the request. */ }
    }

    async function wait(ms, signal) {
      throwIfAborted(signal);
      if (!signal || typeof signal.addEventListener !== 'function') {
        await sleep(ms);
        return;
      }
      let onAbort;
      const aborted = new Promise((resolve, reject) => {
        onAbort = () => reject(abortError());
        signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        await Promise.race([sleep(ms), aborted]);
      } finally {
        if (onAbort && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
      }
      throwIfAborted(signal);
    }

    async function requestJson(url, attempt, requestOptions) {
      const tryNumber = attempt || 0;
      const options = requestOptions || {};
      const signal = options.signal || null;
      const onRequestStatus = typeof options.onRequestStatus === 'function' ? options.onRequestStatus : null;
      if (!apiKey) throw new Error('A Torn API key is required');
      throwIfAborted(signal);

      let response;
      try {
        response = await scheduler.run(() => {
          throwIfAborted(signal);
          return fetchImpl(url, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
              Authorization: `ApiKey ${apiKey}`
            },
            signal
          });
        });
      } catch (error) {
        if (isAbortError(error) || signal && signal.aborted) throw abortError();
        if (tryNumber < 2) {
          const delayMs = 250 * (tryNumber + 1);
          emit(onRequestStatus, {
            type: 'retry',
            attempt: tryNumber + 1,
            maxAttempts: 3,
            delayMs,
            status: 0,
            message: `Network request failed; retrying ${tryNumber + 1} / 2`
          });
          await wait(delayMs, signal);
          return requestJson(url, tryNumber + 1, options);
        }
        throw new Error(redact(`Torn API network error: ${error && error.message || error}`, apiKey));
      }

      throwIfAborted(signal);
      let body = null;
      try {
        body = await response.json();
      } catch (error) {
        body = null;
      }

      if (isRateLimited(response, body)) {
        if (tryNumber < 2) {
          emit(onRequestStatus, {
            type: 'cooldown',
            attempt: tryNumber + 1,
            maxAttempts: 3,
            delayMs: RATE_LIMIT_COOLDOWN_MS,
            status: Number(response && response.status) || 429,
            message: 'Torn rate limit detected; cooling down before retry'
          });
          await wait(RATE_LIMIT_COOLDOWN_MS, signal);
          return requestJson(url, tryNumber + 1, options);
        }
        const detail = apiErrorDetail(body) || `HTTP ${response.status}`;
        throw new Error(redact(`Torn API rate limit: ${detail}`, apiKey));
      }

      if (!response.ok) {
        if (TRANSIENT_STATUSES.has(Number(response.status)) && tryNumber < 2) {
          const delayMs = 250 * (tryNumber + 1);
          emit(onRequestStatus, {
            type: 'retry',
            attempt: tryNumber + 1,
            maxAttempts: 3,
            delayMs,
            status: Number(response.status) || 0,
            message: `Torn API ${response.status}; retrying ${tryNumber + 1} / 2`
          });
          await wait(delayMs, signal);
          return requestJson(url, tryNumber + 1, options);
        }
        const detail = apiErrorDetail(body) || `HTTP ${response.status}`;
        throw new Error(redact(`Torn API ${response.status}: ${detail}`, apiKey));
      }

      if (body && body.error) {
        throw new Error(redact(`Torn API error: ${apiErrorDetail(body)}`, apiKey));
      }

      return body || {};
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

    function emitPageProgress(callback, entry) {
      emit(callback, entry);
    }

    function sameRentalTimestamp(cached, firstBody) {
      if (!cached || !Array.isArray(cached.rentals) || !cached.rentals.length) return false;
      const cachedTimestamp = Number(cached.rentals_timestamp);
      const currentTimestamp = Number(firstBody && firstBody.rentals_timestamp);
      return Number.isFinite(cachedTimestamp) && Number.isFinite(currentTimestamp) && cachedTimestamp === currentTimestamp;
    }

    async function collectRentalPages(propertyTypeId, scanOptions, cached) {
      const options = scanOptions || {};
      const onPageProgress = typeof options.onPageProgress === 'function' ? options.onPageProgress : null;
      const firstBody = await requestJson(offsetUrl(propertyTypeId, 0), 0, options);
      const firstRows = rentalRows(firstBody);
      const total = metadataTotal(firstBody);

      if (sameRentalTimestamp(cached, firstBody)) {
        emitPageProgress(onPageProgress, {
          id: Number(propertyTypeId),
          donePages: 1,
          totalPages: 1,
          rowsDone: cached.rentals.length,
          totalRows: total == null ? cached.rentals.length : total,
          fromCache: true,
          unchanged: true
        });
        return { rows: cached.rentals.slice(), firstBody, reused: true };
      }

      if (total != null) {
        const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));
        if (totalPages > MAX_PAGES) throw new Error(`Torn API pagination exceeded ${MAX_PAGES} pages`);

        let donePages = 1;
        let rowsDone = firstRows.length;
        emitPageProgress(onPageProgress, {
          id: Number(propertyTypeId),
          donePages,
          totalPages,
          rowsDone,
          totalRows: total
        });

        const offsets = [];
        for (let offset = PAGE_LIMIT; offset < total; offset += PAGE_LIMIT) offsets.push(offset);
        const pageRows = new Array(offsets.length);
        let cursor = 0;

        async function worker() {
          while (true) {
            throwIfAborted(options.signal);
            const index = cursor;
            cursor += 1;
            if (index >= offsets.length) return;
            const offset = offsets[index];
            const body = await requestJson(offsetUrl(propertyTypeId, offset), 0, options);
            const rows = rentalRows(body);
            pageRows[index] = rows;
            donePages += 1;
            rowsDone += rows.length;
            emitPageProgress(onPageProgress, {
              id: Number(propertyTypeId),
              donePages,
              totalPages,
              rowsDone: Math.min(rowsDone, total),
              totalRows: total
            });
          }
        }

        const workers = Math.min(PAGE_WORKERS, offsets.length);
        if (workers > 0) await Promise.all(Array.from({ length: workers }, () => worker()));
        return { rows: firstRows.concat(...pageRows), firstBody, reused: false };
      }

      const rows = firstRows.slice();
      let url = normalizeContinuation(nextLink(firstBody));
      let donePages = 1;
      emitPageProgress(onPageProgress, {
        id: Number(propertyTypeId),
        donePages,
        totalPages: null,
        rowsDone: rows.length,
        totalRows: null
      });

      while (url && donePages < MAX_PAGES) {
        throwIfAborted(options.signal);
        const body = await requestJson(url, 0, options);
        const pageRows = rentalRows(body);
        rows.push(...pageRows);
        donePages += 1;
        emitPageProgress(onPageProgress, {
          id: Number(propertyTypeId),
          donePages,
          totalPages: null,
          rowsDone: rows.length,
          totalRows: null
        });
        url = normalizeContinuation(nextLink(body));
      }
      if (url) throw new Error(`Torn API pagination exceeded ${MAX_PAGES} pages`);
      return { rows, firstBody, reused: false };
    }

    async function fetchRentalMarket(propertyTypeId, options) {
      const id = positiveInt(propertyTypeId);
      if (!id) throw new TypeError('A positive property type ID is required');
      const scanOptions = options || {};
      const force = Boolean(scanOptions.force);
      const onPageProgress = typeof scanOptions.onPageProgress === 'function' ? scanOptions.onPageProgress : null;
      throwIfAborted(scanOptions.signal);
      const cached = readCache(id);

      if (!force && cached && cacheIsFresh(cached)) {
        emitPageProgress(onPageProgress, {
          id,
          donePages: 1,
          totalPages: 1,
          rowsDone: cached.rentals.length,
          totalRows: cached.rentals.length,
          fromCache: true
        });
        return Object.assign({}, cached, { fromCache: true });
      }

      const result = await collectRentalPages(id, scanOptions, cached);
      const checkedAt = now();
      if (result.reused && cached) {
        const reused = Object.assign({}, cached, {
          checkedAt,
          fromCache: true,
          unchanged: true
        });
        writeCache(id, reused);
        return reused;
      }

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
        fetchedAt: checkedAt,
        checkedAt,
        fromCache: false,
        unchanged: false
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
        throwIfAborted(scanOptions.signal);
        let market;
        try {
          market = await fetchRentalMarket(id, scanOptions);
        } catch (error) {
          if (isAbortError(error) || scanOptions.signal && scanOptions.signal.aborted) throw abortError();
          market = {
            rentals: [],
            property: null,
            rentals_timestamp: null,
            rentals_delay: null,
            fetchedAt: now(),
            checkedAt: null,
            fromCache: false,
            unchanged: false,
            error: redact(error && error.message || error, apiKey)
          };
        }

        markets[id] = market;
        done += 1;
        if (onProgress) {
          onProgress({ id, done, total: ids.length, market });
        }
      }

      if (sequential) {
        for (let index = 0; index < ids.length; index += 1) {
          await scanOne(ids[index]);
          if (betweenMarketsMs > 0 && index < ids.length - 1) await wait(betweenMarketsMs, scanOptions.signal);
        }
      } else {
        await Promise.all(ids.map(scanOne));
      }

      return markets;
    }

    return Object.freeze(Object.assign({}, baseClient, {
      fetchRentalMarket,
      scanMarkets
    }));
  }

  return Object.freeze(Object.assign({}, baseApi, {
    PAGE_LIMIT,
    PAGE_WORKERS,
    MAX_PAGES,
    metadataTotal,
    offsetUrl,
    createClient
  }));
}));
