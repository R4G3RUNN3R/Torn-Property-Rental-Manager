(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3UpdateCoreV034 = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SETTINGS_KEY = 'r4g3_property_rental_manager.v034.updates';
  const SNAPSHOT_KEY = 'r4g3_property_rental_manager.v034.snapshot';
  const DEFAULT_SETTINGS = Object.freeze({ autoPageUpdate: false });

  function normalizeSettings(value) {
    const source = value && typeof value === 'object' ? value : {};
    return { autoPageUpdate: source.autoPageUpdate === true };
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
    const normalized = normalizeSettings(Object.assign({}, loadSettings(storage), next || {}));
    if (storage && typeof storage.setItem === 'function') {
      storage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
    }
    return normalized;
  }

  function timestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
  }

  function normalizeTimestampMap(value) {
    const source = value && typeof value === 'object' ? value : {};
    const result = {};
    for (const [key, raw] of Object.entries(source)) {
      const id = Number(key);
      const time = timestamp(raw);
      if (Number.isInteger(id) && id > 0 && time) result[String(id)] = time;
    }
    return result;
  }

  function normalizeSnapshot(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.properties)) return null;
    const markets = value.markets && typeof value.markets === 'object' && !Array.isArray(value.markets)
      ? value.markets
      : {};
    const propertyMarkets = value.propertyMarkets && typeof value.propertyMarkets === 'object' && !Array.isArray(value.propertyMarkets)
      ? value.propertyMarkets
      : {};
    return {
      properties: value.properties,
      markets,
      propertyMarkets,
      updatedAt: timestamp(value.updatedAt),
      propertyUpdatedAt: normalizeTimestampMap(value.propertyUpdatedAt)
    };
  }

  function loadSnapshot(storage) {
    if (!storage || typeof storage.getItem !== 'function') return null;
    try {
      const raw = storage.getItem(SNAPSHOT_KEY);
      return raw ? normalizeSnapshot(JSON.parse(raw)) : null;
    } catch (error) {
      return null;
    }
  }

  function saveSnapshot(storage, next) {
    const normalized = normalizeSnapshot(next);
    if (!normalized) return null;
    if (storage && typeof storage.setItem === 'function') {
      try {
        storage.setItem(SNAPSHOT_KEY, JSON.stringify(normalized));
      } catch (error) {
        return normalized;
      }
    }
    return normalized;
  }

  return Object.freeze({
    SETTINGS_KEY,
    SNAPSHOT_KEY,
    DEFAULT_SETTINGS,
    normalizeSettings,
    loadSettings,
    saveSettings,
    normalizeSnapshot,
    loadSnapshot,
    saveSnapshot
  });
}));
