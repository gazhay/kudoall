(function() {
    "use strict";

    console.log("[VirtualMap] Initializing virtual map replacement");

    const replacedElements = new WeakSet();
    const virtualActivities = new Map();
    // Cache fetched polylines to avoid re-fetching
    const polylineCache = new Map();

    /**
     * Extract virtual activity data from the dashboard MFE props.
     */
    function extractVirtualActivities() {
        const mfeDiv = document.querySelector('.dashboard-mfe[data-react-props]');
        if (!mfeDiv) {
            console.log("[VirtualMap] No dashboard MFE div found");
            return;
        }

        let props;
        try {
            props = JSON.parse(mfeDiv.getAttribute('data-react-props'));
        } catch (e) {
            console.error("[VirtualMap] Failed to parse react props:", e);
            return;
        }

        const entries = props?.appContext?.feedProps?.preFetchedEntries || [];
        
        for (const entry of entries) {
            // GroupActivity entries - already have map_polyline
            if (entry.entity === "GroupActivity" && entry.rowData?.activities) {
                for (const activity of entry.rowData.activities) {
                    if (activity.is_virtual) {
                        const worldName = parseWorldName(activity.name, activity.description);
                        const actId = String(activity.activity_id || activity.entity_id);
                        virtualActivities.set(actId, {
                            polyline: activity.map_polyline || null,
                            worldName: worldName,
                            name: activity.name
                        });
                    }
                }
            }
            
            // Regular Activity entries
            if (entry.entity === "Activity" && entry.activity) {
                const act = entry.activity;
                const tagKeys = act.tagKeys || [];
                if (act.isVirtual || tagKeys.includes("virtual")) {
                    const actId = String(act.id);
                    const desc = stripHtml(act.description || "");
                    const name = act.activityName || "";
                    const worldName = parseWorldName(name, desc);
                    virtualActivities.set(actId, {
                        polyline: null,
                        worldName: worldName,
                        name: name
                    });
                }
            }
        }

        console.log(`[VirtualMap] Found ${virtualActivities.size} virtual activities`);
        for (const [id, data] of virtualActivities) {
            console.log(`[VirtualMap]   ${id}: "${data.name}" → ${data.worldName || "unknown world"} ${data.polyline ? '(polyline ready)' : '(will fetch)'}`);
        }
    }

    /**
     * Fetch the latlng stream for an activity from Strava.
     * Works because we're on strava.com with session cookies.
     */
    async function fetchPolyline(activityId) {
        if (polylineCache.has(activityId)) {
            return polylineCache.get(activityId);
        }

        try {
            const resp = await fetch(`/activities/${activityId}/streams?stream_types[]=latlng`, {
                credentials: 'same-origin'
            });
            if (!resp.ok) {
                console.warn(`[VirtualMap] Failed to fetch streams for ${activityId}: ${resp.status}`);
                polylineCache.set(activityId, null);
                return null;
            }
            const data = await resp.json();
            // Response is typically: { latlng: [[lat,lng], ...] } or an array of stream objects
            let latlng = null;
            if (data.latlng) {
                latlng = data.latlng;
            } else if (Array.isArray(data)) {
                const stream = data.find(s => s.type === 'latlng');
                if (stream) latlng = stream.data;
            }
            polylineCache.set(activityId, latlng);
            return latlng;
        } catch (e) {
            console.warn(`[VirtualMap] Error fetching streams for ${activityId}:`, e);
            polylineCache.set(activityId, null);
            return null;
        }
    }

    /**
     * Parse the Zwift world name from activity name and description.
     */
    function parseWorldName(activityName, description) {
        activityName = activityName || "";
        description = stripHtml(description || "");

        // 1. "🗺️ ... in WorldName" in description
        const emojiMatch = description.match(/🗺️\s*(.+?)\s+in\s+(\S+.*?)$/im);
        if (emojiMatch) {
            const world = findWorld(emojiMatch[2].trim());
            if (world) return world.nicename;
        }

        // 2. "in WorldName" in activity name
        const nameMatch = activityName.match(/\bin\s+(\S+.*?)$/i);
        if (nameMatch) {
            const candidate = nameMatch[1].trim().replace(/\s*\(.*\)$/, '');
            const world = findWorld(candidate);
            if (world) return world.nicename;
        }

        // 3. Fallback: longest world name match in combined text
        const combined = (activityName + " " + description).toLowerCase();
        const sorted = [...window.locationlib.worldCourseDescs].sort((a, b) => 
            b.nicename.length - a.nicename.length
        );
        for (const world of sorted) {
            if (combined.includes(world.nicename.toLowerCase())) return world.nicename;
            if (combined.includes(world.name.toLowerCase())) return world.nicename;
        }

        return null;
    }

    function findWorld(str) {
        return window.locationlib?.findWorldCourse?.(str) || null;
    }

    function stripHtml(html) {
        const tmp = document.createElement('div');
        tmp.innerHTML = html;
        return tmp.textContent || tmp.innerText || '';
    }

    function getBasemapUrl(worldName) {
        if (!worldName) return null;
        const nameToFile = {
            'Watopia': 'watopia',
            'Richmond': 'richmond',
            'London': 'london',
            'New York': 'newyork',
            'Innsbruck': 'innsbruck',
            'Bologna': 'bologna',
            'Yorkshire': 'yorkshire',
            'Crit City': 'critcity',
            'Makuri Islands': 'makuriislands',
            'France': 'france',
            'Paris': 'paris',
            'Gravel Mountain': 'gravelmountain',
            'Scotland': 'scotland'
        };
        const filename = nameToFile[worldName];
        if (!filename) return null;
        return chrome.runtime.getURL(`maps/${filename}.webp`);
    }

    /**
     * Replace a map image with a Leaflet map showing the basemap + route.
     */
    async function replaceMapInCard(img, activityId, actData) {
        if (replacedElements.has(img)) return;
        replacedElements.add(img);

        const worldName = actData.worldName;
        if (!worldName) {
            console.log(`[VirtualMap] No world identified for "${actData.name}", skipping`);
            return;
        }

        const extentsData = window.locationlib.extentsFromName(worldName);
        if (!extentsData) {
            console.log(`[VirtualMap] No extents for "${worldName}", skipping`);
            return;
        }

        // Get the polyline - use cached from GroupActivity, or fetch it
        let polyline = actData.polyline;
        if (!polyline) {
            polyline = await fetchPolyline(activityId);
        }

        if (!polyline || polyline.length === 0) {
            console.log(`[VirtualMap] No route data for activity ${activityId}, skipping`);
            return;
        }

        // Get dimensions
        const rect = img.getBoundingClientRect();
        const width = Math.round(rect.width) || img.offsetWidth || 300;
        const height = Math.round(rect.height) || img.offsetHeight || 160;
        if (width < 50 || height < 50) return;

        console.log(`[VirtualMap] Replacing: "${actData.name}" in ${worldName} (${width}x${height}, ${polyline.length} pts)`);

        // Create map container
        const mapDiv = document.createElement('div');
        mapDiv.style.width = width + 'px';
        mapDiv.style.height = height + 'px';
        mapDiv.style.borderRadius = window.getComputedStyle(img).borderRadius || '8px';
        mapDiv.style.overflow = 'hidden';
        mapDiv.classList.add('virtualmap-leaflet');

        // Replace
        const picture = img.closest('picture');
        (picture || img).replaceWith(mapDiv);

        // Add "Zwift" badge
        const badge = document.createElement('div');
        badge.className = 'virtualmap-badge';
        badge.textContent = 'Zwift';
        mapDiv.appendChild(badge);

        // Init Leaflet
        const map = L.map(mapDiv, {
            zoomControl: false,
            attributionControl: false,
            dragging: false,
            scrollWheelZoom: false,
            doubleClickZoom: false,
            touchZoom: false,
            boxZoom: false,
            keyboard: false
        });

        // Basemap image overlay at world extents
        const worldBounds = L.latLngBounds(
            L.latLng(extentsData[1][0], extentsData[1][1]),
            L.latLng(extentsData[0][0], extentsData[0][1])
        );

        const basemapUrl = getBasemapUrl(worldName);
        if (basemapUrl) {
            L.imageOverlay(basemapUrl, worldBounds).addTo(map);
        }

        // Draw route and fit view to it
        const routeLine = L.polyline(polyline, {
            color: '#fc5200',
            weight: 3,
            opacity: 0.9,
            smoothFactor: 1
        }).addTo(map);

        map.fitBounds(routeLine.getBounds(), { padding: [10, 10] });
    }

    /**
     * Scan the DOM for activity cards and replace maps.
     */
    function scanAndReplace() {
        if (virtualActivities.size === 0) return;

        for (const [activityId, actData] of virtualActivities) {
            const links = document.querySelectorAll(`a[href*="/activities/${activityId}"]`);
            
            for (const link of links) {
                // Find map image in this link or its parent card
                let mapImg = link.querySelector('img[src*="d3o5xota0a1fcr.cloudfront.net"]');
                
                if (!mapImg) {
                    const card = link.closest('[class*="EntryBody"]')
                              || link.closest('[class*="entry"]')
                              || link.closest('[data-testid]')
                              || link.closest('article');
                    if (card) {
                        mapImg = card.querySelector('img[src*="d3o5xota0a1fcr.cloudfront.net"]');
                    }
                }

                if (mapImg && !replacedElements.has(mapImg) && mapImg.offsetWidth > 50) {
                    replaceMapInCard(mapImg, activityId, actData);
                }
            }
        }
    }

    function observeDom() {
        let scanTimeout = null;
        const observer = new MutationObserver(() => {
            if (scanTimeout) clearTimeout(scanTimeout);
            scanTimeout = setTimeout(scanAndReplace, 500);
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function fixLeafletIconPaths() {
        if (typeof L !== 'undefined' && chrome?.runtime?.getURL) {
            delete L.Icon.Default.prototype._getIconUrl;
            L.Icon.Default.mergeOptions({
                iconRetinaUrl: chrome.runtime.getURL('lib/images/marker-icon-2x.png'),
                iconUrl: chrome.runtime.getURL('lib/images/marker-icon.png'),
                shadowUrl: chrome.runtime.getURL('lib/images/marker-shadow.png')
            });
        }
    }

    function init() {
        fixLeafletIconPaths();

        // Detect which page we're on
        const path = window.location.pathname;

        if (path.startsWith('/activities/')) {
            initActivityPage();
        } else if (path.startsWith('/dashboard')) {
            initDashboard();
        }
    }

    /**
     * Dashboard page: replace maps in the feed.
     */
    function initDashboard() {
        extractVirtualActivities();
        
        if (virtualActivities.size === 0) {
            console.log("[VirtualMap] No virtual activities found");
            return;
        }

        scanAndReplace();
        observeDom();
        setTimeout(scanAndReplace, 1000);
        setTimeout(scanAndReplace, 2500);
    }

    /**
     * Activity page: replace the map if it's a virtual activity.
     */
    async function initActivityPage() {
        const activityId = window.location.pathname.match(/\/activities\/(\d+)/)?.[1];
        if (!activityId) return;

        // Check if this is a virtual activity by looking at the page content
        // Strava puts activity data in a script tag or data attributes
        const isVirtual = await detectVirtualActivity();
        if (!isVirtual) {
            console.log("[VirtualMap] Activity is not virtual, skipping");
            return;
        }

        console.log(`[VirtualMap] Virtual activity page detected: ${activityId}`);

        // Determine the world from page content
        const worldName = detectWorldFromPage();
        if (!worldName) {
            console.log("[VirtualMap] Could not determine Zwift world");
            return;
        }

        const extentsData = window.locationlib.extentsFromName(worldName);
        if (!extentsData) {
            console.log(`[VirtualMap] No extents for "${worldName}"`);
            return;
        }

        // Fetch the route
        const polyline = await fetchPolyline(activityId);
        if (!polyline || polyline.length === 0) {
            console.log("[VirtualMap] No route data available");
            return;
        }

        console.log(`[VirtualMap] Activity page: "${worldName}", ${polyline.length} pts`);

        // Find and replace the existing map
        replaceActivityPageMap(worldName, extentsData, polyline);
    }

    /**
     * Detect if the current activity page is for a virtual activity.
     */
    async function detectVirtualActivity() {
        // Method 1: check for "Virtual" in the activity type badge or tags
        const pageText = document.body.innerText || '';
        if (pageText.includes('Virtual Ride') || pageText.includes('Virtual Run')) return true;

        // Method 2: look for data in script tags (Strava often embeds JSON)
        const scripts = document.querySelectorAll('script[type="application/json"], script:not([src])');
        for (const script of scripts) {
            const text = script.textContent;
            if (text.includes('"virtual"') && (text.includes('"VirtualRide"') || text.includes('"VirtualRun"'))) {
                return true;
            }
        }

        // Method 3: check page heading/type
        const typeEl = document.querySelector('[class*="activity-type"], [data-testid*="type"]');
        if (typeEl && typeEl.textContent.toLowerCase().includes('virtual')) return true;

        // Method 4: check for Zwift device name
        if (pageText.includes('Zwift')) return true;

        return false;
    }

    /**
     * Detect the Zwift world from the activity page content.
     */
    function detectWorldFromPage() {
        // Look in the activity title/description
        const title = document.querySelector('h1, [class*="activity-name"], [data-testid*="activity_name"]')?.textContent || '';
        const desc = document.querySelector('[class*="description"], [class*="activity-description"]')?.textContent || '';
        
        return parseWorldName(title, desc);
    }

    /**
     * Replace the map on the activity detail page.
     */
    function replaceActivityPageMap(worldName, extentsData, polyline) {
        // Strava's activity map is typically in a div with specific selectors
        const mapSelectors = [
            '#map-canvas',
            '[class*="MapContainer"]',
            '[class*="map-container"]',
            '[data-testid*="map"]',
            '.activity-map .mapboxgl-map',
            '.mapboxgl-map'
        ];

        let existingMap = null;
        for (const sel of mapSelectors) {
            existingMap = document.querySelector(sel);
            if (existingMap) break;
        }

        if (!existingMap) {
            // Wait for it to render
            const observer = new MutationObserver((mutations, obs) => {
                for (const sel of mapSelectors) {
                    existingMap = document.querySelector(sel);
                    if (existingMap) {
                        obs.disconnect();
                        doReplaceActivityMap(existingMap, worldName, extentsData, polyline);
                        return;
                    }
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            // Also timeout after 10s
            setTimeout(() => observer.disconnect(), 10000);
            return;
        }

        doReplaceActivityMap(existingMap, worldName, extentsData, polyline);
    }

    function doReplaceActivityMap(existingMap, worldName, extentsData, polyline) {
        const container = existingMap.parentElement || existingMap;
        const width = existingMap.offsetWidth || container.offsetWidth || 600;
        const height = existingMap.offsetHeight || container.offsetHeight || 400;

        console.log(`[VirtualMap] Replacing activity page map (${width}x${height})`);

        const mapDiv = document.createElement('div');
        mapDiv.style.width = '100%';
        mapDiv.style.height = height + 'px';
        mapDiv.style.borderRadius = window.getComputedStyle(existingMap).borderRadius || '0';
        mapDiv.style.overflow = 'hidden';
        mapDiv.classList.add('virtualmap-leaflet');

        existingMap.replaceWith(mapDiv);

        // Add badge
        const badge = document.createElement('div');
        badge.className = 'virtualmap-badge';
        badge.textContent = 'Zwift';
        mapDiv.appendChild(badge);

        // Init map
        const map = L.map(mapDiv, {
            zoomControl: true,
            attributionControl: false,
            dragging: true,
            scrollWheelZoom: true,
            doubleClickZoom: true,
            touchZoom: true,
            boxZoom: true
        });

        // World bounds
        const worldBounds = L.latLngBounds(
            L.latLng(extentsData[1][0], extentsData[1][1]),
            L.latLng(extentsData[0][0], extentsData[0][1])
        );

        // OSM background (subtle)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            opacity: 0.3
        }).addTo(map);

        // Basemap overlay
        const basemapUrl = getBasemapUrl(worldName);
        if (basemapUrl) {
            L.imageOverlay(basemapUrl, worldBounds).addTo(map);
        }

        // Route
        const routeLine = L.polyline(polyline, {
            color: '#fc5200',
            weight: 3,
            opacity: 0.9,
            smoothFactor: 1
        }).addTo(map);

        map.fitBounds(routeLine.getBounds(), { padding: [20, 20] });

        // Attribution
        L.control.attribution({
            position: 'bottomright',
            prefix: false
        }).addAttribution('© <a href="https://openstreetmap.org">OSM</a>').addTo(map);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
