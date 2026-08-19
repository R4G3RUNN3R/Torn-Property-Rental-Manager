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

    function canList(propertyId) {
      const id = Number(propertyId);
      const routeId = R4G3FormCore.parseLeasePropertyId(windowLike && windowLike.location);
      if (!Number.isInteger(id) || id <= 0 || routeId !== id) return false;
      const draft = draftStore.loadFor(id);
      if (!draft) return false;
      const form = R4G3FormCore.findLeaseForm(documentLike);
      if (!form) return false;
      const submit = R4G3FormCore.findLeaseSubmitButton(documentLike, form.root);
      if (!submit) return false;
      if (submit.disabled) return false;
      if (submit.getAttribute && submit.getAttribute('aria-disabled') === 'true') return false;
      return true;
    }

    function list(propertyId) {
      const id = Number(propertyId);
      if (!canList(id)) return { submitted: false, reason: 'Matching prepared lease form is not ready' };
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
      }
      return result;
    }

    return Object.freeze({ canList, list });
  }

  function start(windowLike) {
    const win = windowLike || root;
    if (!win || !win.document || !win.location) return null;
    if (win.location.hostname !== 'www.torn.com' || win.location.pathname !== '/properties.php') return null;

    const draftStore = R4G3DraftCore.createStore(win.sessionStorage);
    const apiFetch = createApiFetch(win);
    let controller = null;
    const leasePreparer = createLeasePreparer({
      window: win,
      document: win.document,
      draftStore,
      onPrepared() {
        if (controller) controller.render();
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

    const onHashChange = () => {
      leasePreparer.prepareWithWait();
      controller.render();
    };
    win.addEventListener('hashchange', onHashChange);
    leasePreparer.prepareWithWait();
    controller.load().catch(() => {
      // The controller renders a sanitized error state. Never log the API key-bearing error.
    });

    return Object.freeze({
      controller,
      leasePreparer,
      leaseLister,
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
    createLeaseLister,
    start
  });
}));
