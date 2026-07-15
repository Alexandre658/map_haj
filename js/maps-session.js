/**
 * Persistência leve do estado do mapa (sessionStorage).
 * Sobrevive a refresh / restart do separador; perde-se ao fechar o browser.
 */

const KEY = 'maphaj_session_v1';

/**
 * @param {object|null} place
 * @returns {object|null}
 */
export function serializePlace(place) {
  if (!place || place.lat == null || place.lng == null) return null;
  return {
    placeId: place.placeId ?? null,
    name: place.name ?? '',
    address: place.address ?? place.vicinity ?? '',
    lat: Number(place.lat),
    lng: Number(place.lng),
    types: Array.isArray(place.types) ? place.types.slice(0, 8) : undefined,
    rating: place.rating ?? undefined,
    userRatings: place.userRatings ?? undefined,
    source: place.source ?? undefined,
    precise: place.precise === true ? true : undefined
  };
}

/**
 * @param {Array<object>|null} routes
 * @returns {Array<object>|null}
 */
export function serializeRoutes(routes) {
  if (!Array.isArray(routes) || !routes.length) return null;
  return routes.map((r, i) => ({
    coordinates: r.coordinates,
    distanceMeters: r.distanceMeters ?? null,
    durationSeconds: r.durationSeconds ?? null,
    summary: r.summary ?? null,
    primary: Boolean(r.primary) || i === 0,
    index: r.index ?? i
    // raw omitido — evita sessões enormes
  }));
}

/**
 * @returns {object|null}
 */
export function loadMapsSession() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * @param {object} state
 */
export function saveMapsSession(state) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[maphaj] session save:', err);
  }
}

export function clearMapsSession() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Distância aproximada em metros (Haversine light).
 */
export function approxDistanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
