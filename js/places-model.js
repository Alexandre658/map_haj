/**
 * Normalização Place / MapPlace — aceita aliases da API Moveme.
 */

function toNum(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function pickLatLng(raw) {
  if (!raw || typeof raw !== 'object') return { lat: null, lng: null };

  const geo = raw.geometry?.location || raw.geometry;
  if (geo && typeof geo === 'object') {
    const lat = toNum(geo.lat ?? geo.latitude);
    const lng = toNum(geo.lng ?? geo.longitude);
    if (lat != null && lng != null) return { lat, lng };
  }

  if (raw.location && typeof raw.location === 'object') {
    const lat = toNum(raw.location.lat ?? raw.location.latitude);
    const lng = toNum(raw.location.lng ?? raw.location.longitude);
    if (lat != null && lng != null) return { lat, lng };
  }

  if (raw.position && typeof raw.position === 'object') {
    const lat = toNum(raw.position.lat ?? raw.position.latitude);
    const lng = toNum(raw.position.lng ?? raw.position.longitude);
    if (lat != null && lng != null) return { lat, lng };
  }

  return {
    lat: toNum(raw.lat ?? raw.latitude),
    lng: toNum(raw.lng ?? raw.longitude)
  };
}

/**
 * @typedef {object} MapPlace
 * @property {string} placeId
 * @property {string} name
 * @property {string} address
 * @property {number|null} lat
 * @property {number|null} lng
 * @property {string[]} [types]
 * @property {string} [source]
 * @property {string} [id]
 * @property {number|null} [rating]
 * @property {number|null} [userRatings]
 * @property {string|null} [phone]
 * @property {string|null} [website]
 * @property {string|null} [country]
 * @property {object|null} [openingHours]
 * @property {Array<object>} [photos]
 * @property {number|null} [priceLevel]
 * @property {string} [vicinity]
 * @property {string} [subtitle]
 */

/**
 * @param {Record<string, unknown>} raw
 * @returns {MapPlace|null}
 */
export function normalizePlace(raw) {
  if (!raw || typeof raw !== 'object') return null;

  const name = String(raw.name ?? '').trim();
  if (!name) return null;

  const placeIdRaw = raw.placeId ?? raw.place_id ?? raw.id ?? '';
  const placeId = String(placeIdRaw).trim();
  const { lat, lng } = pickLatLng(raw);

  const address =
    raw.formattedAddress ??
    raw.formatted_address ??
    raw.address ??
    raw.vicinity ??
    '';

  const types = Array.isArray(raw.types)
    ? raw.types.map(String)
    : undefined;

  const rating = toNum(raw.rating);
  const userRatings = toNum(
    raw.userRatings ?? raw.user_ratings_total ?? raw.userRatingsTotal
  );
  const priceLevel = toNum(raw.price_level ?? raw.priceLevel);

  return {
    id: raw.id != null ? String(raw.id) : placeId || undefined,
    placeId: placeId || name,
    name,
    address: String(address || ''),
    lat,
    lng,
    types,
    source: raw.source != null ? String(raw.source) : undefined,
    rating,
    userRatings,
    phone:
      raw.formatted_phone_number ||
      raw.international_phone_number ||
      raw.phone ||
      raw.phoneNumber ||
      null,
    website: raw.website || raw.url || null,
    country: raw.country != null ? String(raw.country) : null,
    openingHours: raw.opening_hours || raw.openingHours || null,
    photos: Array.isArray(raw.photos) ? raw.photos : [],
    priceLevel,
    vicinity: raw.vicinity != null ? String(raw.vicinity) : undefined,
    subtitle: raw.subtitle != null ? String(raw.subtitle) : undefined
  };
}

/** Parser dual: `{ places }` ou `{ data: { results } }`. */
export function parseSearchResponse(json) {
  if (!json || typeof json !== 'object') return [];

  let list = null;
  if (Array.isArray(json.places)) list = json.places;
  else if (Array.isArray(json.data?.results)) list = json.data.results;
  else if (Array.isArray(json.results)) list = json.results;
  else if (Array.isArray(json)) list = json;

  if (!list) return [];
  return list.map(normalizePlace).filter(Boolean);
}

export function parseDetailsResponse(json) {
  if (!json || json.success === false) return null;
  if (json.place) return normalizePlace(json.place);
  if (json.data?.place) return normalizePlace(json.data.place);
  return normalizePlace(json);
}

export function hasValidCoords(place) {
  return (
    place &&
    place.lat != null &&
    place.lng != null &&
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lng) &&
    !(place.lat === 0 && place.lng === 0)
  );
}

export function placeKey(place) {
  if (!place) return '';
  if (place.placeId) return String(place.placeId);
  return `${place.name}_${place.lat}_${place.lng}`;
}

/** UI shape used by demo search list. */
export function toUiResult(place) {
  return {
    ...place,
    id: place.placeId || place.id || place.name,
    subtitle: place.address || undefined,
    zoom: 15
  };
}
