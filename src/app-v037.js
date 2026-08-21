(function (root, factory) {
  const baseApp = typeof module === 'object' && module.exports ? require('./app-v036') : root.R4G3PropertyRentalApp;
  const api = factory(baseApp);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.R4G3PropertyRentalApp = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function (baseApp) {
  'use strict';

  if (!baseApp) throw new Error('v0.3.7 app dependency is unavailable');

  const BULK_MARKET_DELAY_MS = 1500;

  function uniquePropertyTypeCount(properties) {
    return new Set((Array.isArray(properties) ? properties : [])
      .map(property => Number(property && property.propertyTypeId))
      .filter(id => Number.isInteger(id) && id > 0)).size;
  }

  function wrapApiClient(client, afterProgress) {
    if (!client || typeof client.scanMarkets !== 'function') return client;
    return Object.assign({}, client, {
      scanMarkets(properties, options) {
        const scanOptions = Object.assign({}, options || {});
        if (scanOptions.force === true && uniquePropertyTypeCount(properties) > 1) {
          scanOptions.sequential = true;
          scanOptions.betweenMarketsMs = Math.max(
            BULK_MARKET_DELAY_MS,
            Number(scanOptions.betweenMarketsMs) || 0
          );
        }

        const originalProgress = typeof scanOptions.onProgress === 'function'
          ? scanOptions.onProgress
          : null;
        if (originalProgress && typeof afterProgress === 'function') {
          scanOptions.onProgress = entry => {
            originalProgress(entry);
            afterProgress(entry);
          };
        }
        return client.scanMarkets(properties, scanOptions);
      }
    });
  }

  function createController(options) {
    const config = Object.assign({}, options || {});
    const windowLike = config.window;
    const documentLike = config.document;
    if (!windowLike || !documentLike) throw new TypeError('window and document are required');

    let baseController = null;
    let refreshProgress = () => null;
    const progressHook = () => refreshProgress();

    if (config.apiClient) config.apiClient = wrapApiClient(config.apiClient, progressHook);
    if (typeof config.apiClientFactory === 'function') {
      const factory = config.apiClientFactory;
      config.apiClientFactory = apiKey => wrapApiClient(factory(apiKey), progressHook);
    }

    baseController = baseApp.createController(config);
    let observer = null;
    let scheduled = false;
    let destroyed = false;

    function progressState() {
      const state = baseController && baseController.getState();
      if (!state || state.loading !== true) return null;
      const scan = state.scanProgress && typeof state.scanProgress === 'object'
        ? state.scanProgress
        : null;
      const total = Math.max(0, Number(scan && scan.total) || 0);
      const done = Math.max(0, Math.min(total || Infinity, Number(scan && scan.done) || 0));
      const percent = total > 0 ? Math.max(0, Math.min(100, Math.round(done / total * 100))) : 0;
      return {
        done,
        total,
        percent,
        label: total > 0
          ? `Updating rental markets… ${done} / ${total}`
          : 'Loading owned properties…'
      };
    }

    function enhanceBulkProgress() {
      scheduled = false;
      if (destroyed) return null;
      const panel = documentLike.getElementById('r4g3-prm-panel');
      if (!panel) return null;

      const state = progressState();
      let progress = panel.querySelector('[data-role="v037-update-all-progress"]');
      if (!state) {
        if (progress && progress.parentNode) progress.remove();
        return null;
      }

      if (!progress) {
        progress = documentLike.createElement('div');
        progress.dataset.role = 'v037-update-all-progress';
        progress.style.padding = '9px 12px';
        progress.style.display = 'grid';
        progress.style.gap = '6px';
        progress.style.borderBottom = '1px solid rgba(128,128,128,0.25)';

        const label = documentLike.createElement('small');
        label.dataset.role = 'v037-update-all-progress-label';
        label.style.fontWeight = '700';

        const track = documentLike.createElement('div');
        track.setAttribute('role', 'progressbar');
        track.setAttribute('aria-label', 'Update all progress');
        track.setAttribute('aria-valuemin', '0');
        track.setAttribute('aria-valuemax', '100');
        track.style.height = '9px';
        track.style.border = '1px solid currentColor';
        track.style.borderRadius = '999px';
        track.style.overflow = 'hidden';
        track.style.opacity = '0.9';

        const fill = documentLike.createElement('div');
        fill.dataset.role = 'v037-update-all-progress-fill';
        fill.style.height = '100%';
        fill.style.width = '0%';
        fill.style.background = 'currentColor';
        fill.style.transition = 'width 160ms linear';
        track.appendChild(fill);
        progress.append(label, track);

        const header = panel.querySelector('.r4g3-prm-header');
        if (header && header.nextSibling) panel.insertBefore(progress, header.nextSibling);
        else if (header) panel.appendChild(progress);
        else panel.prepend(progress);
      }

      const label = progress.querySelector('[data-role="v037-update-all-progress-label"]');
      const track = progress.querySelector('[role="progressbar"]');
      const fill = progress.querySelector('[data-role="v037-update-all-progress-fill"]');
      if (label && label.textContent !== state.label) label.textContent = state.label;
      if (track) {
        track.setAttribute('aria-valuenow', String(state.percent));
        track.setAttribute('aria-valuetext', state.total > 0 ? `${state.done} of ${state.total} markets` : 'Loading properties');
      }
      if (fill) fill.style.width = `${state.percent}%`;
      return progress;
    }

    refreshProgress = enhanceBulkProgress;

    function scheduleEnhance() {
      if (scheduled || destroyed) return;
      scheduled = true;
      const schedule = typeof windowLike.queueMicrotask === 'function'
        ? windowLike.queueMicrotask.bind(windowLike)
        : callback => Promise.resolve().then(callback);
      schedule(enhanceBulkProgress);
    }

    if (typeof windowLike.MutationObserver === 'function' && (documentLike.body || documentLike.documentElement)) {
      observer = new windowLike.MutationObserver(() => scheduleEnhance());
      observer.observe(documentLike.body || documentLike.documentElement, { childList: true, subtree: true });
    }

    async function wrapAsync(method, args) {
      try {
        return await baseController[method](...args);
      } finally {
        enhanceBulkProgress();
      }
    }

    const controller = Object.assign({}, baseController, {
      load(...args) { return wrapAsync('load', args); },
      updateAll(...args) { return wrapAsync('updateAll', args); },
      updateProperty(...args) { return wrapAsync('updateProperty', args); },
      render() {
        const result = baseController.render();
        enhanceBulkProgress();
        return result;
      },
      open() {
        const result = baseController.open();
        enhanceBulkProgress();
        return result;
      },
      destroy() {
        destroyed = true;
        if (observer) observer.disconnect();
        observer = null;
        return baseController.destroy();
      }
    });

    enhanceBulkProgress();
    return Object.freeze(controller);
  }

  return Object.freeze(Object.assign({}, baseApp, {
    BULK_MARKET_DELAY_MS,
    wrapApiClient,
    createController
  }));
}));
