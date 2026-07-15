/**
 * URLs estilo Google Maps + estado da app:
 *   /maps/@lat,lng,zoomz
 *   /maps/@lat,lng,zoomz?mode=directions&o=me&d=-8.9,13.2&tm=driving
 *   /maps/@lat,lng,zoomz?mode=nav&o=...&d=...
 *   /maps/@lat,lng,zoomz?mode=search&p=-8.9,13.2&pn=Nome
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
 * @param {string} [raw]
 * @returns {{ lat: number, lng: number }|null}
 */
function parseLatLngPair(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.split(',');
  if (parts.length < 2) return null;
  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (![lat, lng].every(Number.isFinite)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/**
 * @param {{ lat: number, lng: number }} ll
 * @returns {string}
 */
function formatLatLngPair(ll) {
  const round = (n) => Math.round(n * 1e6) / 1e6;
  return `${round(ll.lat)},${round(ll.lng)}`;
}

/**
 * Lê estado da app a partir da query string.
 * @param {string} [href]
 * @returns {{
 *   mode: 'search'|'directions'|'nav',
 *   originIsMyLocation: boolean,
 *   origin: {lat:number,lng:number,name?:string}|null,
 *   dest: {lat:number,lng:number,name?:string}|null,
 *   place: {lat:number,lng:number,name?:string}|null,
 *   travelMode: string|null,
 *   routeIndex: number
 * }|null}
 */
export function parseAppState(href = typeof location !== 'undefined' ? location.href : '') {
  try {
    const u = new URL(href, 'http://local');
    const q = u.searchParams;
    if (![...q.keys()].length) return null;

    let mode = q.get('mode') || 'search';
    if (mode !== 'directions' && mode !== 'nav' && mode !== 'search') {
      mode = 'search';
    }

    const oRaw = q.get('o');
    const originIsMyLocation = oRaw === 'me';
    const originCoords = originIsMyLocation ? null : parseLatLngPair(oRaw);
    const destCoords = parseLatLngPair(q.get('d'));
    const placeCoords = parseLatLngPair(q.get('p'));

    const on = q.get('on') || '';
    const dn = q.get('dn') || '';
    const pn = q.get('pn') || '';

    return {
      mode,
      originIsMyLocation,
      origin: originCoords
        ? {
            lat: originCoords.lat,
            lng: originCoords.lng,
            name: on || undefined,
            address: on || undefined,
            placeId: q.get('oid') || undefined,
            source: 'url'
          }
        : null,
      dest: destCoords
        ? {
            lat: destCoords.lat,
            lng: destCoords.lng,
            name: dn || undefined,
            address: dn || undefined,
            placeId: q.get('did') || undefined,
            source: 'url'
          }
        : null,
      place: placeCoords
        ? {
            lat: placeCoords.lat,
            lng: placeCoords.lng,
            name: pn || undefined,
            address: pn || undefined,
            placeId: q.get('pid') || undefined,
            source: 'url'
          }
        : null,
      travelMode: q.get('tm') || null,
      routeIndex: Math.max(0, Number(q.get('r') || 0) || 0)
    };
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   mode?: string,
 *   originIsMyLocation?: boolean,
 *   origin?: {lat:number,lng:number,name?:string,address?:string,placeId?:string}|null,
 *   dest?: {lat:number,lng:number,name?:string,address?:string,placeId?:string}|null,
 *   place?: {lat:number,lng:number,name?:string,address?:string,placeId?:string}|null,
 *   travelMode?: string|null,
 *   routeIndex?: number
 * }} state
 * @returns {string} query string sem `?` (pode ser '')
 */
export function buildAppSearchParams(state) {
  if (!state) return '';
  const p = new URLSearchParams();
  const mode = state.mode || 'search';

  const shortName = (place) => {
    const n = String(place?.name || place?.address || '').trim();
    if (!n) return '';
    return n.length > 48 ? `${n.slice(0, 46)}…` : n;
  };

  if (mode === 'nav' || mode === 'directions') {
    p.set('mode', mode);
    if (state.originIsMyLocation) {
      p.set('o', 'me');
    } else if (state.origin?.lat != null && state.origin?.lng != null) {
      p.set('o', formatLatLngPair(state.origin));
      const on = shortName(state.origin);
      if (on) p.set('on', on);
      if (state.origin.placeId && !String(state.origin.placeId).startsWith('map-')) {
        p.set('oid', String(state.origin.placeId).slice(0, 64));
      }
    }
    if (state.dest?.lat != null && state.dest?.lng != null) {
      p.set('d', formatLatLngPair(state.dest));
      const dn = shortName(state.dest);
      if (dn) p.set('dn', dn);
      if (state.dest.placeId && !String(state.dest.placeId).startsWith('map-')) {
        p.set('did', String(state.dest.placeId).slice(0, 64));
      }
    }
    if (state.travelMode) p.set('tm', state.travelMode);
    if (state.routeIndex != null && state.routeIndex > 0) {
      p.set('r', String(state.routeIndex));
    }
  } else if (state.place?.lat != null && state.place?.lng != null) {
    p.set('mode', 'search');
    p.set('p', formatLatLngPair(state.place));
    const pn = shortName(state.place);
    if (pn) p.set('pn', pn);
    if (state.place.placeId && !String(state.place.placeId).startsWith('map-')) {
      p.set('pid', String(state.place.placeId).slice(0, 64));
    }
  }

  const s = p.toString();
  return s;
}

/**
 * Actualiza a barra de URL sem recarregar (replaceState por defeito).
 * @param {import('maplibre-gl').Map} map
 * @param {{
 *   replace?: boolean,
 *   state?: object|null,
 *   keepSearch?: boolean
 * }} [opts]
 */
export function syncMapsUrl(map, opts = {}) {
  if (typeof history === 'undefined' || !map) return;
  const c = map.getCenter();
  const path = buildMapsPath({
    lat: c.lat,
    lng: c.lng,
    zoom: map.getZoom()
  });

  let search = '';
  if (opts.state != null) {
    const q = buildAppSearchParams(opts.state);
    search = q ? `?${q}` : '';
  } else if (opts.keepSearch !== false) {
    search = location.search || '';
  }

  const hash = location.hash || '';
  const next = `${path}${search}${hash}`;
  if (next === `${location.pathname}${location.search}${location.hash}`) return;
  if (opts.replace === false) history.pushState(null, '', next);
  else history.replaceState(null, '', next);
}

/**
 * Liga o mapa à URL: lê na carga e escreve em moveend.
 * @param {import('maplibre-gl').Map} map
 * @param {{ getState?: () => object|null }} [opts]
 */
export function bindMapsUrl(map, opts = {}) {
  let t = 0;
  const flush = () =>
    syncMapsUrl(map, {
      replace: true,
      state: typeof opts.getState === 'function' ? opts.getState() : null,
      keepSearch: typeof opts.getState !== 'function'
    });
  map.on('moveend', () => {
    clearTimeout(t);
    t = setTimeout(flush, 120);
  });
  if (!parseMapsUrl()) flush();
  window.addEventListener('popstate', () => {
    const v = parseMapsUrl();
    if (!v) return;
    map.jumpTo({ center: v.center, zoom: v.zoom });
    opts.onPopState?.(parseAppState());
  });
}
