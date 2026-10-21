(function() {
    "use strict";

    console.log("[VirtualMap] Initializing virtual map replacement");

    const replacedElements = new WeakSet();
    const virtualActivities = new Map();
    // Cache fetched polylines to avoid re-fetching
    const polylineCache = new Map();

    /**
     * Listen for feed data intercepted by the MAIN world script (feed-interceptor.js).
     * That script hooks fetch/XHR and posts messages with new feed entries.
     */
    function listenForFeedData() {
        window.addEventListener('message', (event) => {
            if (event.source !== window) return;
            if (event.data?.type === 'VIRTUALMAP_FEED_DATA') {
                processIncomingFeedData(event.data.payload);
            }
        });
    }

    /**
     * Process feed data from intercepted network responses.
     * Extracts virtual activities and triggers map replacement.
     */
    function processIncomingFeedData(data) {
        if (!data) return;

        // The response might come in various shapes from the feed API
        let entries = [];
        if (Array.isArray(data)) {
            entries = data;
        } else if (data.entries) {
            entries = data.entries;
        } else if (data.preFetchedEntries) {
            entries = data.preFetchedEntries;
        } else if (data.data && Array.isArray(data.data)) {
            entries = data.data;
        }

        // Also try to recursively find any activity objects in the response
        if (entries.length === 0) {
            entries = findEntriesRecursive(data);
        }

        let newCount = 0;
        for (const entry of entries) {
            const found = extractVirtualFromEntry(entry);
            if (found) newCount++;
        }

        if (newCount > 0) {
            console.log(`[VirtualMap] Intercepted ${newCount} new virtual activities from feed fetch`);
            // Give React time to render the new DOM elements
            setTimeout(scanAndReplace, 500);
            setTimeout(scanAndReplace, 1500);
            setTimeout(scanAndReplace, 3000);
        }
    }

    /**
     * Recursively search an object for things that look like activity entries.
     */
    function findEntriesRecursive(obj, depth = 0) {
        if (depth > 3 || !obj || typeof obj !== 'object') return [];
        
        const results = [];
        
        // If this object looks like a feed entry, return it
        if (obj.entity === 'Activity' && obj.activity) {
            results.push(obj);
            return results;
        }
        if (obj.entity === 'GroupActivity' && obj.rowData) {
            results.push(obj);
            return results;
        }

        // Search arrays and object values
        const values = Array.isArray(obj) ? obj : Object.values(obj);
        for (const val of values) {
            if (val && typeof val === 'object') {
                results.push(...findEntriesRecursive(val, depth + 1));
            }
        }
        return results;
    }

    /**
     * Extract virtual activity info from a single feed entry.
     * Returns true if a new virtual activity was found.
     */
    function extractVirtualFromEntry(entry) {
        if (!entry) return false;

        // GroupActivity entries
        if (entry.entity === "GroupActivity" && entry.rowData?.activities) {
            let found = false;
            for (const activity of entry.rowData.activities) {
                if (activity.is_virtual) {
                    const worldName = parseWorldName(activity.name, activity.description);
                    const actId = String(activity.activity_id || activity.entity_id);
                    if (!virtualActivities.has(actId)) {
                        virtualActivities.set(actId, {
                            polyline: activity.map_polyline || null,
                            worldName: worldName,
                            name: activity.name
                        });
                        found = true;
                    }
                }
            }
            return found;
        }

        // Regular Activity entries
        if (entry.entity === "Activity" && entry.activity) {
            const act = entry.activity;
            const tagKeys = act.tagKeys || [];
            if (act.isVirtual || tagKeys.includes("virtual")) {
                const actId = String(act.id);
                if (!virtualActivities.has(actId)) {
                    const desc = stripHtml(act.description || "");
                    const name = act.activityName || "";
                    const worldName = parseWorldName(name, desc);
                    virtualActivities.set(actId, {
                        polyline: null,
                        worldName: worldName,
                        name: name
                    });
                    return true;
                }
            }
        }

        return false;
    }

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
            extractVirtualFromEntry(entry);
        }

        console.log(`[VirtualMap] Found ${virtualActivities.size} virtual activities from initial props`);
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

    function getBasemapUrl(worldName, style = 'standard') {
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
        const suffix = style === 'standard' ? '' : `.${style}`;
        return chrome.runtime.getURL(`maps/${filename}${suffix}.webp`);
    }

    function getSelectedMapStyle() {
        try {
            const style = localStorage.getItem('virtualmap-style');
            return ['standard', 'oldpaper', 'colourblind'].includes(style) ? style : 'standard';
        } catch (e) {
            return 'standard';
        }
    }

    function addBasemapChooser(mapDiv, worldName, basemapOverlay) {
        if (!basemapOverlay) return;

        const chooser = document.createElement('select');
        chooser.className = 'virtualmap-style-chooser';
        chooser.setAttribute('aria-label', 'Map style');
        chooser.title = 'Map style';
        chooser.innerHTML = '<option value="standard">Standard</option><option value="oldpaper">Old paper</option><option value="colourblind">Colourblind</option>';
        chooser.value = getSelectedMapStyle();

        let activeStyle = chooser.value;
        const updateBasemap = () => {
            activeStyle = chooser.value;
            basemapOverlay.setUrl(getBasemapUrl(worldName, activeStyle));
            try {
                localStorage.setItem('virtualmap-style', activeStyle);
            } catch (e) {
                // The chooser still works for this page if storage is unavailable.
            }
        };

        basemapOverlay.on('error', () => {
            if (activeStyle === 'standard') return;
            activeStyle = 'standard';
            chooser.value = 'standard';
            basemapOverlay.setUrl(getBasemapUrl(worldName));
            try {
                localStorage.setItem('virtualmap-style', 'standard');
            } catch (e) {
                // The fallback still applies for this page if storage is unavailable.
            }
        });
        basemapOverlay.setUrl(getBasemapUrl(worldName, activeStyle));
        chooser.addEventListener('change', updateBasemap);
        chooser.addEventListener('pointerdown', event => event.stopPropagation());
        chooser.addEventListener('click', event => event.stopPropagation());
        mapDiv.appendChild(chooser);
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
        let basemapOverlay = null;
        if (basemapUrl) {
            basemapOverlay = L.imageOverlay(basemapUrl, worldBounds).addTo(map);
        }
        addBasemapChooser(mapDiv, worldName, basemapOverlay);

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
     * Uses two strategies:
     *   1. Match known virtual activities from preFetchedEntries by activity ID links
     *   2. Find any "Virtual" badge/tag in the DOM and replace the adjacent map
     */
    const replacedActivities = new Set();

    function scanAndReplace() {
        // Strategy 1: Replace maps for known virtual activities (from preFetchedEntries)
        for (const [activityId, actData] of virtualActivities) {
            if (replacedActivities.has(activityId)) continue;
            attemptReplaceById(activityId, actData);
        }

        // Strategy 2: Find any map images with the "Virtual" badge that we haven't replaced.
        // This catches activities that weren't in preFetchedEntries (infinite scroll, late render).
        scanForVirtualBadges();
    }

    /**
     * Find the nearest activity card boundary element that contains the given element.
     * This prevents us from walking too far up the DOM and matching a map image
     * that belongs to a different activity.
     */
    function findActivityCard(el) {
        let current = el;
        for (let i = 0; i < 15; i++) {
            current = current.parentElement;
            if (!current || current === document.body) return null;

            // Strava feed cards typically have data-testid or specific class patterns
            const testId = current.getAttribute('data-testid') || '';
            if (testId.includes('activity') || testId.includes('entry') || testId.includes('feed')) {
                return current;
            }

            // Also detect card boundaries by looking for elements that contain
            // exactly one activity link matching our target (scoped card)
            const actLinks = current.querySelectorAll('a[href*="/activities/"]');
            const uniqueIds = new Set();
            for (const l of actLinks) {
                const m = l.getAttribute('href')?.match(/\/activities\/(\d+)/);
                if (m) uniqueIds.add(m[1]);
            }
            // If this container has multiple different activity IDs, we've gone too far
            if (uniqueIds.size > 1) {
                // Return the previous level (the child that contained only our activity)
                return current.previousElementSibling ? null : null;
            }

            // A reasonable card boundary: has a map image AND activity links all for the same ID
            if (uniqueIds.size === 1 && findMapImage(current)) {
                return current;
            }
        }
        return null;
    }

    function attemptReplaceById(activityId, actData) {
        const links = document.querySelectorAll(`a[href*="/activities/${activityId}"]`);
        
        for (const link of links) {
            // First, find the card boundary for this specific activity
            const card = findActivityCard(link);
            let mapImg = null;

            if (card) {
                // Only look for a map image within this activity's card
                mapImg = findMapImage(card);
                // Verify this card doesn't also contain links to OTHER activities
                // (which would mean it's a group container, not a single-activity card)
                if (mapImg) {
                    const cardLinks = card.querySelectorAll('a[href*="/activities/"]');
                    const otherIds = new Set();
                    for (const cl of cardLinks) {
                        const m = cl.getAttribute('href')?.match(/\/activities\/(\d+)/);
                        if (m && m[1] !== activityId) otherIds.add(m[1]);
                    }
                    // If this card has links to other activities, make sure the map image
                    // is spatially closer to our activity link than to others
                    if (otherIds.size > 0) {
                        mapImg = findMapImageClosestTo(card, link, activityId);
                    }
                }
            } else {
                // Fallback: walk up cautiously, but stop if we hit a container 
                // with multiple different activity IDs
                let el = link;
                for (let i = 0; i < 10; i++) {
                    el = el.parentElement;
                    if (!el || el === document.body) break;

                    // Check if this level has links to other activities — if so, stop
                    const siblingLinks = el.querySelectorAll('a[href*="/activities/"]');
                    const idsHere = new Set();
                    for (const sl of siblingLinks) {
                        const m = sl.getAttribute('href')?.match(/\/activities\/(\d+)/);
                        if (m) idsHere.add(m[1]);
                    }
                    if (idsHere.size > 1) break; // multiple activities in this container, stop

                    mapImg = findMapImage(el);
                    if (mapImg && !replacedElements.has(mapImg)) break;
                    mapImg = null;
                }
            }

            if (mapImg && !replacedElements.has(mapImg)) {
                if (mapImg.offsetWidth > 50 && mapImg.offsetHeight > 50) {
                    replacedActivities.add(activityId);
                    replaceMapInCard(mapImg, activityId, actData);
                } else if (!mapImg.complete) {
                    const id = activityId;
                    const data = actData;
                    mapImg.addEventListener('load', function onLoad() {
                        mapImg.removeEventListener('load', onLoad);
                        if (!replacedElements.has(mapImg) && mapImg.offsetWidth > 50) {
                            replacedActivities.add(id);
                            replaceMapInCard(mapImg, id, data);
                        }
                    }, { once: true });
                }
                break;
            }
        }
    }

    /**
     * When a container has multiple activities, find the map image that is
     * closest (in DOM order) to the link for our target activity.
     */
    function findMapImageClosestTo(container, targetLink, activityId) {
        const allMapImgs = container.querySelectorAll(
            'img[src*="d3o5xota0a1fcr.cloudfront.net"], img[srcset*="d3o5xota0a1fcr.cloudfront.net"], img[src*="/v6/maps/"]'
        );
        if (allMapImgs.length === 0) return null;
        if (allMapImgs.length === 1) {
            // Only one map in the container — only use it if there's a strong
            // association (no other activity links between the map and our link)
            return allMapImgs[0];
        }

        // For each map image, find the nearest activity link and check if it's ours
        for (const img of allMapImgs) {
            if (replacedElements.has(img)) continue;

            // Walk up from the image to find the closest activity link sibling
            let parent = img.parentElement;
            for (let i = 0; i < 8; i++) {
                if (!parent) break;
                const nearbyLink = parent.querySelector(`a[href*="/activities/${activityId}"]`);
                if (nearbyLink) return img;
                
                // Check if a DIFFERENT activity link is closer
                const anyLink = parent.querySelector('a[href*="/activities/"]');
                if (anyLink) {
                    const m = anyLink.getAttribute('href')?.match(/\/activities\/(\d+)/);
                    if (m && m[1] !== activityId) break; // belongs to another activity
                }
                parent = parent.parentElement;
            }
        }

        return null;
    }

    /**
     * Scan the DOM for "Virtual" tag badges and replace adjacent map images.
     * This handles activities loaded after the initial page render (infinite scroll)
     * and activities that render their map image after the initial scan.
     */
    function scanForVirtualBadges() {
        // Strava renders a "Virtual" tag/badge on virtual activities' map area.
        // Find all map images from the Strava map CDN that haven't been replaced yet.
        const allMapImgs = document.querySelectorAll(
            'img[src*="d3o5xota0a1fcr.cloudfront.net"]:not(.virtualmap-replaced)'
        );

        for (const img of allMapImgs) {
            if (replacedElements.has(img)) continue;
            if (img.offsetWidth < 50 || img.offsetHeight < 50) continue;

            // Walk up to find the card container and check for a "Virtual" tag
            let card = img;
            for (let i = 0; i < 12; i++) {
                card = card.parentElement;
                if (!card || card === document.body) break;

                // Look for the "Virtual" text badge/tag that Strava renders on virtual activities
                const virtualTag = card.querySelector('[class*="tag"], [class*="Tag"], [data-testid*="tag"]');
                if (virtualTag && virtualTag.textContent.trim().toLowerCase() === 'virtual') {
                    // Found a virtual activity card with an unreplaced map image.
                    // Extract the activity ID from a link in this card.
                    const actLink = card.querySelector('a[href*="/activities/"]');
                    const actMatch = actLink?.getAttribute('href')?.match(/\/activities\/(\d+)/);
                    if (actMatch) {
                        const activityId = actMatch[1];
                        if (replacedActivities.has(activityId)) break;

                        // Check if we already have data for this activity
                        let actData = virtualActivities.get(activityId);
                        if (!actData) {
                            // New activity (from infinite scroll) — extract what we can
                            const nameEl = card.querySelector('a[href*="/activities/"] h3, a[href*="/activities/"] [class*="name"], a[href*="/activities/"] [class*="Name"]');
                            const name = nameEl?.textContent?.trim() || '';
                            const worldName = parseWorldName(name, '');
                            actData = { polyline: null, worldName: worldName, name: name };
                            virtualActivities.set(activityId, actData);
                            console.log(`[VirtualMap] Discovered new virtual activity from DOM: ${activityId} "${name}" → ${worldName || 'unknown'}`);
                        }

                        replacedActivities.add(activityId);
                        replaceMapInCard(img, activityId, actData);
                    }
                    break;
                }
            }
        }
    }

    /**
     * Find a Strava map image within an element.
     * Handles both img src and srcset, picture/source elements, and lazy-loaded images.
     */
    function findMapImage(container) {
        // Direct img with src matching the Strava map CDN
        let img = container.querySelector('img[src*="d3o5xota0a1fcr.cloudfront.net"]');
        if (img && !replacedElements.has(img)) return img;

        // img where srcset references the map CDN (retina images)
        img = container.querySelector('img[srcset*="d3o5xota0a1fcr.cloudfront.net"]');
        if (img && !replacedElements.has(img)) return img;

        // source element inside a picture, then get the sibling img
        const source = container.querySelector('source[srcset*="d3o5xota0a1fcr.cloudfront.net"]');
        if (source) {
            img = source.closest('picture')?.querySelector('img');
            if (img && !replacedElements.has(img)) return img;
        }

        // Also try matching by the map URL pattern in any img (Strava sometimes uses /v6/maps/)
        img = container.querySelector('img[src*="/v6/maps/"]');
        if (img && !replacedElements.has(img)) return img;

        img = container.querySelector('img[srcset*="/v6/maps/"]');
        if (img && !replacedElements.has(img)) return img;

        // Lazy-loaded images that may have data-src instead of src
        img = container.querySelector('img[data-src*="d3o5xota0a1fcr.cloudfront.net"]');
        if (img && !replacedElements.has(img)) return img;

        return null;
    }

    function observeDom() {
        let scanTimeout = null;
        const observer = new MutationObserver(() => {
            if (scanTimeout) clearTimeout(scanTimeout);
            scanTimeout = setTimeout(scanAndReplace, 300);
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

        // Listen for feed data from the MAIN world interceptor
        listenForFeedData();

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
        
        console.log(`[VirtualMap] Dashboard init: ${virtualActivities.size} virtual activities from preFetchedEntries`);

        scanAndReplace();
        observeDom();
        // React renders progressively — retry several times with increasing delays
        const retryDelays = [500, 1000, 2000, 3500, 5000, 8000, 12000];
        for (const delay of retryDelays) {
            setTimeout(() => {
                scanAndReplace();
            }, delay);
        }
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
            '.mapboxgl-map',
            '[class*="MapContainer"]',
            '[class*="map-container"]',
            '[data-testid*="map"]'
        ];

        const findUnreplacedMap = () => {
            for (const selector of mapSelectors) {
                for (const candidate of document.querySelectorAll(selector)) {
                    if (candidate.classList.contains('virtualmap-leaflet') || replacedActivityMaps.has(candidate)) continue;
                    const nestedMap = candidate.querySelector('.mapboxgl-map');
                    const existingMap = nestedMap || candidate;
                    if (existingMap.classList.contains('virtualmap-leaflet') || replacedActivityMaps.has(existingMap)) continue;
                    if (existingMap.querySelector('.virtualmap-leaflet')) continue;
                    return existingMap;
                }
            }
            return null;
        };

        const replaceAvailableMaps = () => {
            let existingMap;
            while ((existingMap = findUnreplacedMap())) {
                replacedActivityMaps.add(existingMap);
                doReplaceActivityMap(existingMap, worldName, extentsData, polyline);
            }
        };

        replaceAvailableMaps();
        if (!activityMapObserver) {
            activityMapObserver = new MutationObserver(replaceAvailableMaps);
            activityMapObserver.observe(document.body, { childList: true, subtree: true });
        }
    }

    const replacedActivityMaps = new WeakSet();
    let activityMapObserver = null;

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
        let basemapOverlay = null;
        if (basemapUrl) {
            basemapOverlay = L.imageOverlay(basemapUrl, worldBounds).addTo(map);
        }
        addBasemapChooser(mapDiv, worldName, basemapOverlay);

        // Route
        const routeLine = L.polyline(polyline, {
            color: '#fc5200',
            weight: 3,
            opacity: 0.9,
            smoothFactor: 1
        }).addTo(map);

        installChartHoverMarker(map, polyline);

        map.fitBounds(routeLine.getBounds(), { padding: [20, 20] });

        // Attribution
        L.control.attribution({
            position: 'bottomright',
            prefix: false
        }).addAttribution('© <a href="https://openstreetmap.org">OSM</a>').addTo(map);
    }

    function installChartHoverMarker(map, polyline) {
        const marker = L.circleMarker(polyline[0], {
            radius: 6,
            color: '#fff',
            weight: 2,
            fillColor: '#fc5200',
            fillOpacity: 1,
            interactive: false
        });

        document.addEventListener('pointermove', event => {
            let chart = event.target.closest?.('svg, canvas');
            if (!chart || !chart.isConnected) {
                if (map.hasLayer(marker)) map.removeLayer(marker);
                return;
            }

            const rect = chart.getBoundingClientRect();
            if (rect.width < 80 || rect.height < 30) return;

            let pointIndex = null;
            let pointElement = event.target;
            while (pointElement && pointElement !== chart) {
                const value = pointElement.getAttribute?.('data-point-index') ?? pointElement.getAttribute?.('data-index');
                if (value !== null && /^\d+$/.test(value)) {
                    pointIndex = Number(value);
                    break;
                }
                pointElement = pointElement.parentElement;
            }

            if (pointIndex === null) {
                const progress = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
                pointIndex = Math.round(progress * (polyline.length - 1));
            }

            marker.setLatLng(polyline[Math.max(0, Math.min(polyline.length - 1, pointIndex))]);
            if (!map.hasLayer(marker)) marker.addTo(map);
            marker.bringToFront();
        }, { passive: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
