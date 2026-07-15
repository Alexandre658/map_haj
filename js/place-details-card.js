/**
 * Utilitários do card de detalhes do lugar.
 */

const TYPE_LABELS = {
  restaurant: 'Restaurante',
  cafe: 'Café',
  bar: 'Bar',
  bakery: 'Pastelaria',
  food: 'Alimentação',
  meal_takeaway: 'Take-away',
  lodging: 'Alojamento',
  hotel: 'Hotel',
  store: 'Loja',
  shopping_mall: 'Centro comercial',
  supermarket: 'Supermercado',
  grocery_or_supermarket: 'Mercearia',
  hospital: 'Hospital',
  pharmacy: 'Farmácia',
  doctor: 'Médico',
  bank: 'Banco',
  atm: 'Multibanco',
  gas_station: 'Posto de combustível',
  parking: 'Estacionamento',
  airport: 'Aeroporto',
  bus_station: 'Terminal de autocarros',
  transit_station: 'Estação',
  school: 'Escola',
  university: 'Universidade',
  church: 'Igreja',
  place_of_worship: 'Local de culto',
  park: 'Parque',
  gym: 'Ginásio',
  museum: 'Museu',
  tourist_attraction: 'Atracção turística',
  point_of_interest: 'Ponto de interesse',
  establishment: 'Estabelecimento',
  locality: 'Localidade',
  sublocality: 'Bairro',
  neighborhood: 'Bairro',
  route: 'Rua',
  street_address: 'Morada',
  premise: 'Edifício',
  farmyard: 'Fazenda',
  landuse: 'Uso do solo',
  residential: 'Zona residencial'
};

const SKIP_TYPES = new Set([
  'point_of_interest',
  'establishment',
  'geocode',
  'political',
  'plus_code'
]);

export function categoryLabel(types) {
  if (!Array.isArray(types) || !types.length) return 'Lugar';
  for (const t of types) {
    const key = String(t).toLowerCase();
    if (SKIP_TYPES.has(key)) continue;
    if (TYPE_LABELS[key]) return TYPE_LABELS[key];
    // humanizar snake_case
    return key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  }
  return TYPE_LABELS[types[0]] || 'Lugar';
}

export function formatRating(rating, userRatings) {
  if (rating == null || !Number.isFinite(Number(rating))) return null;
  const r = Number(rating);
  const count =
    userRatings != null && Number.isFinite(Number(userRatings))
      ? Number(userRatings)
      : null;
  return {
    value: r,
    text: r.toFixed(1).replace('.', ','),
    count,
    countText:
      count != null
        ? count >= 1000
          ? `${(count / 1000).toFixed(1).replace(/\.0$/, '')} mil`
          : String(count)
        : null
  };
}

export function starsHtml(rating) {
  const r = Math.max(0, Math.min(5, Number(rating) || 0));
  const full = Math.floor(r);
  const half = r - full >= 0.4 && r - full < 0.9;
  const parts = [];
  for (let i = 0; i < 5; i++) {
    if (i < full) parts.push('★');
    else if (i === full && half) parts.push('★');
    else parts.push('☆');
  }
  return parts.join('');
}

export function openingStatus(openingHours) {
  if (!openingHours || typeof openingHours !== 'object') return null;
  if (typeof openingHours.open_now === 'boolean') {
    return openingHours.open_now
      ? { open: true, text: 'Aberto agora' }
      : { open: false, text: 'Fechado agora' };
  }
  if (typeof openingHours.openNow === 'boolean') {
    return openingHours.openNow
      ? { open: true, text: 'Aberto agora' }
      : { open: false, text: 'Fechado agora' };
  }
  return null;
}

export function formatPriceLevel(level) {
  const n = Number(level);
  if (!Number.isFinite(n) || n < 0) return null;
  return '€'.repeat(Math.min(4, Math.max(1, Math.round(n))));
}

export function haversineKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

export function formatDistanceKm(km) {
  if (km == null || !Number.isFinite(km)) return null;
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(km < 10 ? 1 : 0).replace('.', ',')} km`;
}

/**
 * Junta detalhes da API sobre um place base (sem perder nome/coords).
 * @param {import('./places-model.js').MapPlace} base
 * @param {import('./places-model.js').MapPlace|null} detailed
 */
export function mergePlace(base, detailed) {
  if (!detailed) return base;
  return {
    ...base,
    ...detailed,
    name: detailed.name || base.name,
    address: detailed.address || base.address,
    lat: detailed.lat ?? base.lat,
    lng: detailed.lng ?? base.lng,
    placeId: detailed.placeId || base.placeId,
    types:
      detailed.types?.length ? detailed.types : base.types,
    rating: detailed.rating ?? base.rating,
    userRatings: detailed.userRatings ?? base.userRatings,
    photos:
      detailed.photos?.length ? detailed.photos : base.photos
  };
}
