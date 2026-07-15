/**
 * URLs estilo Google Maps:
 *   /maps/@lat,lng,zoomz
 *   /maps/@lat,lng,zoomz/data=...?...
 *
 * MapLibre usa [lng, lat]; o path Google usa lat,lng.
 */

/** @typedef {{ lat: number, lng: number, zoom: number, center: [number, number] }} MapsView */

/**
 * @param {string} [href]
 * @returns {MapsView|null}
 */
export function parseMapsUrl(href = typeof location !== 'undefined' ? location.href : '') {
  try {
    const u = new URL(href, 'http://local');
    const path = decodeURIComponent(u.pathname);
    // @lat,lng,zoomz  (+ opcional bearingt / pitchy do Google, ignorados por agora)
    const m = path.match(
      /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?),(\d+(?:\.\d+)?)z(?:(?:,-?\d+(?:\.\d+)?){0,2})?(?:\/|$)/i
    );
    if (!m) return null;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    const zoom = Number(m[3]);
    if (![lat, lng, zoom].every(Number.isFinite)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    if (zoom < 0 || zoom > 22) return null;
    return { lat, lng, zoom, center: [lng, lat] };
  } catch {
    return null;
  }
}

/**
 * @param {{ lat: number, lng: number, zoom: number }} view
 * @returns {string}
 */
export function buildMapsPath(view) {
  const round = (n, d) => {
    const f = 10 ** d;
    return Math.round(n * f) / f;
  };
  const lat = round(view.lat, 7);
  const lng = round(view.lng, 7);
  const zoom = round(view.zoom, 2);
  return `/maps/@${lat},${lng},${zoom}z`;
}

/**
 * Actualiza a barra de URL sem recarregar (replaceState).
 * @param {import('maplibre-gl').Map} map
 * @param {{ replace?: boolean, keepSearch?: boolean }} [opts]
 */
export function syncMapsUrl(map, opts = {}) {
  if (typeof history === 'undefined' || !map) return;
  const c = map.getCenter();
  const path = buildMapsPath({
    lat: c.lat,
    lng: c.lng,
    zoom: map.getZoom()
  });
  const search = opts.keepSearch === false ? '' : location.search || '';
  const hash = location.hash || '';
  const next = `${path}${search}${hash}`;
  if (next === `${location.pathname}${location.search}${location.hash}`) return;
  if (opts.replace === false) history.pushState(null, '', next);
  else history.replaceState(null, '', next);
}

/**
 * Liga o mapa à URL: lê na carga e escreve em moveend.
 * @param {import('maplibre-gl').Map} map
 */
export function bindMapsUrl(map) {
  let t = 0;
  const flush = () => syncMapsUrl(map, { replace: true, keepSearch: true });
  map.on('moveend', () => {
    clearTimeout(t);
    t = setTimeout(flush, 120);
  });
  // Garante path /maps/@… mesmo se abriu em /
  if (!parseMapsUrl()) flush();
  window.addEventListener('popstate', () => {
    const v = parseMapsUrl();
    if (!v) return;
    map.jumpTo({ center: v.center, zoom: v.zoom });
  });
}
