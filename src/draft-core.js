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
