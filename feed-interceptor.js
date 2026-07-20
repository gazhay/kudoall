/**
 * Feed interceptor - runs in the MAIN world to intercept Strava's fetch calls.
 * Posts intercepted feed data back to the content script via window.postMessage.
 */
(function() {
    "use strict";

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const response = await originalFetch.apply(this, args);
        try {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
            // Match Strava feed pagination requests (they contain 'cursor' or '/feed')
            if (url.includes('/feed') || url.includes('cursor')) {
                const clone = response.clone();
                clone.json().then(data => {
                    window.postMessage({ type: 'VIRTUALMAP_FEED_DATA', payload: data }, '*');
                }).catch(() => {});
            }
        } catch (e) {}
        return response;
    };

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method, url) {
        this._vmUrl = url;
        return originalOpen.apply(this, arguments);
    };
    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            try {
                const url = this._vmUrl || '';
                if (url.includes('/feed') || url.includes('cursor')) {
                    const data = JSON.parse(this.responseText);
                    window.postMessage({ type: 'VIRTUALMAP_FEED_DATA', payload: data }, '*');
                }
            } catch (e) {}
        });
        return originalSend.apply(this, arguments);
    };
})();
