(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3UiObserver = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const hubs = typeof WeakMap === 'function' ? new WeakMap() : new Map();

  function normalizeOptions(value) {
    const source = value && typeof value === 'object' ? value : {};
    return {
      childList: source.childList === true,
      attributes: source.attributes === true,
      characterData: source.characterData === true,
      subtree: source.subtree === true,
      attributeOldValue: source.attributeOldValue === true,
      characterDataOldValue: source.characterDataOldValue === true,
      attributeFilter: Array.isArray(source.attributeFilter) ? source.attributeFilter.map(String) : null
    };
  }

  function recordMatches(registration, record) {
    if (!registration || !record) return false;
    const options = registration.options;
    if (record.type === 'childList' && !options.childList) return false;
    if (record.type === 'attributes' && !options.attributes) return false;
    if (record.type === 'characterData' && !options.characterData) return false;
    if (record.type === 'attributes' && options.attributeFilter && options.attributeFilter.length) {
      if (!options.attributeFilter.includes(String(record.attributeName || ''))) return false;
    }

    const target = registration.target;
    if (record.target === target) return true;
    if (!options.subtree || !target) return false;
    if (typeof target.contains === 'function') {
      try { return target.contains(record.target); } catch (error) { return false; }
    }
    return false;
  }

  function mergedNativeOptions(observers) {
    const merged = {
      childList: false,
      attributes: false,
      characterData: false,
      subtree: true,
      attributeOldValue: false,
      characterDataOldValue: false
    };
    let attributeFilter = null;
    let hasRegistration = false;

    for (const observer of observers) {
      for (const registration of observer._registrations.values()) {
        hasRegistration = true;
        const options = registration.options;
        merged.childList = merged.childList || options.childList;
        merged.attributes = merged.attributes || options.attributes;
        merged.characterData = merged.characterData || options.characterData;
        merged.attributeOldValue = merged.attributeOldValue || options.attributeOldValue;
        merged.characterDataOldValue = merged.characterDataOldValue || options.characterDataOldValue;
        if (options.attributeFilter && options.attributeFilter.length) {
          if (attributeFilter === null) attributeFilter = new Set(options.attributeFilter);
          else for (const name of options.attributeFilter) attributeFilter.add(name);
        }
      }
    }

    if (!hasRegistration) return null;
    if (!merged.childList && !merged.attributes && !merged.characterData) merged.childList = true;
    if (merged.attributes && attributeFilter && attributeFilter.size) merged.attributeFilter = [...attributeFilter];
    return merged;
  }

  function createHub(windowLike, documentLike) {
    if (!windowLike || !documentLike) throw new TypeError('window and document are required');
    if (hubs.has(documentLike)) return hubs.get(documentLike);

    const NativeMutationObserver = windowLike.MutationObserver;
    const rootTarget = documentLike.documentElement || documentLike.body || null;
    const observers = new Set();
    let nativeObserver = null;

    function dispatch(records) {
      const source = Array.isArray(records) ? records : Array.from(records || []);
      for (const observer of [...observers]) {
        if (!observer._registrations.size) continue;
        const matched = source.filter(record => {
          for (const registration of observer._registrations.values()) {
            if (recordMatches(registration, record)) return true;
          }
          return false;
        });
        if (!matched.length) continue;
        try { observer._callback(matched, observer); } catch (error) {
          const schedule = typeof windowLike.setTimeout === 'function' ? windowLike.setTimeout.bind(windowLike) : setTimeout;
          schedule(() => { throw error; }, 0);
        }
      }
    }

    function reconfigure() {
      const options = mergedNativeOptions(observers);
      if (!options || !rootTarget || typeof NativeMutationObserver !== 'function') {
        if (nativeObserver) nativeObserver.disconnect();
        return;
      }
      if (!nativeObserver) nativeObserver = new NativeMutationObserver(dispatch);
      else nativeObserver.disconnect();
      nativeObserver.observe(rootTarget, options);
    }

    class MultiplexedMutationObserver {
      constructor(callback) {
        if (typeof callback !== 'function') throw new TypeError('MutationObserver callback must be a function');
        this._callback = callback;
        this._registrations = new Map();
      }

      observe(target, options) {
        if (!target) throw new TypeError('MutationObserver target is required');
        const normalized = normalizeOptions(options);
        if (!normalized.childList && !normalized.attributes && !normalized.characterData) {
          throw new TypeError('MutationObserver options must enable childList, attributes, or characterData');
        }
        this._registrations.set(target, { target, options: normalized });
        observers.add(this);
        reconfigure();
      }

      disconnect() {
        this._registrations.clear();
        observers.delete(this);
        reconfigure();
      }

      takeRecords() {
        return [];
      }
    }

    const hub = Object.freeze({
      MutationObserver: MultiplexedMutationObserver,
      activeObserverCount() { return observers.size; },
      disconnectAll() {
        for (const observer of [...observers]) observer._registrations.clear();
        observers.clear();
        if (nativeObserver) nativeObserver.disconnect();
      }
    });
    hubs.set(documentLike, hub);
    return hub;
  }

  function createWindowProxy(windowLike, documentLike) {
    const hub = createHub(windowLike, documentLike);
    if (typeof Proxy !== 'function') {
      const fallback = Object.create(windowLike);
      fallback.MutationObserver = hub.MutationObserver;
      return fallback;
    }

    const bound = new Map();
    return new Proxy(windowLike, {
      get(target, property) {
        if (property === 'MutationObserver') return hub.MutationObserver;
        const value = Reflect.get(target, property, target);
        if (typeof value !== 'function') return value;
        if (!bound.has(property) || bound.get(property).source !== value) {
          bound.set(property, { source: value, value: value.bind(target) });
        }
        return bound.get(property).value;
      },
      set(target, property, value) {
        return Reflect.set(target, property, value, target);
      },
      has(target, property) {
        if (property === 'MutationObserver') return true;
        return property in target;
      }
    });
  }

  return Object.freeze({
    createHub,
    createWindowProxy
  });
}));
