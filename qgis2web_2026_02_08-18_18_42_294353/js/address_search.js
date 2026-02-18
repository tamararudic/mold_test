// Free geocoding: Nominatim (primary) + Photon (fallback) – no API keys
const searchInput = document.getElementById('address-search');
const searchBtn = document.getElementById('address-search-btn');
const searchMessage = document.getElementById('search-message');
let addressMarker = null;
let searchAsYouTypeTimer = null;
const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 3;
// Baltimore County, MD bounds (restrict geocoding to this area)
const BALTIMORE_COUNTY = { minLat: 39.20, maxLat: 39.72, minLng: -77.00, maxLng: -76.35 };

function setSearchMessage(text, isError) {
  searchMessage.textContent = text || '';
  searchMessage.classList.toggle('error', !!isError);
}

function showResult(lat, lng, displayName, query) {
  if (addressMarker) map.removeLayer(addressMarker);
  addressMarker = L.circleMarker([lat, lng], {
    radius: 12,
    fillColor: '#ef4444',
    color: '#fff',
    weight: 2,
    opacity: 1,
    fillOpacity: 0.9
  }).bindPopup('<div class="popup-title">' + (displayName || query).replace(/</g, '&lt;') + '</div>').addTo(map);
  map.setView([lat, lng], 16);
  addressMarker.openPopup();
  setSearchMessage('');
}

const GEOCODE_TIMEOUT_MS = 6000;
let searchAbortController = null;
const PROXIES = [
  u => 'https://corsproxy.io/?' + encodeURIComponent(u),
  u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u)
];

function fetchWithTimeout(url, timeoutMs, signal) {
  const c = new AbortController();
  const abort = () => c.abort();
  if (signal) signal.addEventListener('abort', abort, { once: true });
  const t = setTimeout(abort, timeoutMs);
  return fetch(url, { signal: c.signal })
    .finally(() => { clearTimeout(t); if (signal) signal.removeEventListener('abort', abort); });
}

function fetchCors(url, signal) {
  let i = 0;
  function next() {
    if (i >= PROXIES.length) return Promise.reject(new Error('proxy failed'));
    return fetchWithTimeout(PROXIES[i](url), GEOCODE_TIMEOUT_MS, signal)
      .then(r => { if (!r.ok) throw new Error(); return r.text(); })
      .then(text => { try { return JSON.parse(text); } catch (e) { throw new Error(); } })
      .catch(() => { i++; return next(); });
  }
  return next();
}

function parsePhotonResponse(data, query) {
  if (data.features && data.features.length > 0) {
    const f = data.features[0];
    const [lng, lat] = f.geometry.coordinates;
    const name = (f.properties.name || '') + (f.properties.street ? ', ' + f.properties.street : '') + (f.properties.city ? ', ' + f.properties.city : '');
    showResult(lat, lng, (name.trim() || f.properties.country || query), query);
    return true;
  }
  return false;
}

function tryPhoton(query, signal) {
  const bbox = [BALTIMORE_COUNTY.minLat, BALTIMORE_COUNTY.minLng, BALTIMORE_COUNTY.maxLat, BALTIMORE_COUNTY.maxLng].join(',');
  const url = 'https://photon.komoot.io/api/?' + new URLSearchParams({ q: query, limit: 1, bbox: bbox });
  return fetchWithTimeout(url, GEOCODE_TIMEOUT_MS, signal)
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(data => parsePhotonResponse(data, query))
    .catch(() => fetchCors(url, signal).then(data => parsePhotonResponse(data, query)))
    .catch(() => false);
}

function tryNominatim(query, signal) {
  const nominatimUrl = 'https://nominatim.openstreetmap.org/search?' + new URLSearchParams({
    q: query,
    format: 'json',
    limit: 1,
    viewbox: [BALTIMORE_COUNTY.minLng, BALTIMORE_COUNTY.maxLat, BALTIMORE_COUNTY.maxLng, BALTIMORE_COUNTY.minLat].join(','),
    bounded: 1
  });
  return fetchCors(nominatimUrl, signal).then(data => {
    if (data && data.length > 0) {
      const r = data[0];
      showResult(parseFloat(r.lat), parseFloat(r.lon), r.display_name || query, query);
      return true;
    }
    return false;
  }).catch(() => false);
}

function doAddressSearch() {
  const query = searchInput.value.trim();
  if (!query) {
    setSearchMessage('Enter an address in Baltimore.', true);
    return;
  }
  runAddressSearch(query);
}

function runAddressSearch(query) {
  if (searchAbortController) searchAbortController.abort();
  searchAbortController = new AbortController();
  const signal = searchAbortController.signal;
  setSearchMessage('Searching…');
  searchBtn.disabled = true;

  let resolved = false;
  let settled = 0;
  let hadError = false;
  function done(ok, failed) {
    if (signal.aborted) return;
    if (searchInput.value.trim() !== query) return;
    if (resolved) return;
    resolved = true;
    searchBtn.disabled = false;
    if (failed) setSearchMessage('Search failed. Please use the full address.', true);
    else if (!ok) setSearchMessage('Address not found. Please use the full address.', true);
  }

  const onSettle = (ok, isError) => {
    if (signal.aborted) return;
    if (ok) { done(true); return; }
    if (isError) hadError = true;
    settled++;
    if (settled === 2) done(false, hadError);
  };

  tryPhoton(query, signal).then(ok => onSettle(ok, false)).catch(() => onSettle(false, true));
  tryNominatim(query, signal).then(ok => onSettle(ok, false)).catch(() => onSettle(false, true));
}

searchBtn.addEventListener('click', doAddressSearch);
searchInput.addEventListener('keydown', function(e) {
  if (e.key === 'Enter') { doAddressSearch(); return; }
});
searchInput.addEventListener('input', function() {
  clearTimeout(searchAsYouTypeTimer);
  const query = searchInput.value.trim();
  if (query.length < MIN_QUERY_LENGTH) {
    setSearchMessage('');
    return;
  }
  searchAsYouTypeTimer = setTimeout(function() {
    runAddressSearch(query);
  }, SEARCH_DEBOUNCE_MS);
});