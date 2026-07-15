/**
 * Decodifica Google Encoded Polyline → [[lng, lat], ...]
 * (formato MapLibre).
 */
export function decodePolyline(encoded, precision = 5) {
  if (!encoded || typeof encoded !== 'string') return [];
  const factor = 10 ** precision;
  const coordinates = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let b;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    result = 0;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    coordinates.push([lng / factor, lat / factor]);
  }
  return coordinates;
}

function readEncoded(raw) {
  if (typeof raw === 'string' && raw) return raw;
  if (raw && typeof raw === 'object') {
    for (const key of ['points', 'encoded', 'polyline', 'value']) {
      if (typeof raw[key] === 'string' && raw[key]) return raw[key];
    }
  }
  return null;
}

function pointsFromEncodedCandidates(source) {
  if (!source || typeof source !== 'object') return [];
  for (const key of [
    'geometry',
    'points',
    'polyline',
    'encoded',
    'encodedPolyline',
    'overview_polyline',
    'overviewPolyline'
  ]) {
    const encoded = readEncoded(source[key]);
    if (!encoded) continue;
    const pts = decodePolyline(encoded);
    if (pts.length >= 2) return pts;
  }
  return [];
}

function pickPrimaryRoute(routes) {
  if (!Array.isArray(routes) || !routes.length) return null;
  const primary = routes.find((r) => r && r.isPrimary === true);
  return primary || routes[0];
}

/**
 * Extrai coordenadas [lng, lat] de um único objecto de rota.
 */
export function extractCoordinatesFromRoute(route) {
  if (!route || typeof route !== 'object') return [];
  const direct = pointsFromEncodedCandidates(route);
  if (direct.length >= 2) return direct;

  const legs = route.legs;
  if (!Array.isArray(legs)) return [];

  const all = [];
  for (const leg of legs) {
    const steps = leg?.steps;
    if (!Array.isArray(steps)) {
      const legPts = pointsFromEncodedCandidates(leg);
      if (legPts.length) {
        if (all.length && samePoint(all[all.length - 1], legPts[0])) {
          all.push(...legPts.slice(1));
        } else {
          all.push(...legPts);
        }
      }
      continue;
    }
    for (const step of steps) {
      const stepPts = pointsFromEncodedCandidates(step);
      if (!stepPts.length) continue;
      if (all.length && samePoint(all[all.length - 1], stepPts[0])) {
        all.push(...stepPts.slice(1));
      } else {
        all.push(...stepPts);
      }
    }
  }
  return all.length >= 2 ? all : [];
}

/**
 * Extrai coordenadas [lng, lat] do payload `data` de /api/directions/route.
 */
export function extractRouteCoordinates(data) {
  if (!data || typeof data !== 'object') return [];

  const top = pointsFromEncodedCandidates(data);
  if (top.length >= 2) return top;

  if (data.primaryRoute) {
    const pts = pointsFromEncodedCandidates(data.primaryRoute);
    if (pts.length >= 2) return pts;
  }

  const all = extractAllRoutes(data);
  return all.find((r) => r.primary)?.coordinates || all[0]?.coordinates || [];
}

function metaFromRouteObject(route) {
  if (!route) return { distanceMeters: null, durationSeconds: null, summary: null };
  const leg = Array.isArray(route.legs) ? route.legs[0] : null;
  let distanceMeters =
    num(route.distanceMeters) ??
    num(route.distance?.value) ??
    num(leg?.distance?.value);
  let durationSeconds =
    num(route.durationSeconds) ??
    num(route.etaSeconds) ??
    (route.durationMs != null ? Number(route.durationMs) / 1000 : null) ??
    num(route.duration?.value) ??
    num(leg?.duration?.value);

  let summary = null;
  if (Array.isArray(route.summary)) summary = route.summary.join(', ');
  else if (typeof route.summary === 'string') summary = route.summary;
  else if (typeof route.description === 'string') summary = route.description;
  else if (Array.isArray(route.description)) summary = route.description.join(', ');

  if ((distanceMeters == null || durationSeconds == null) && Array.isArray(route.legs)) {
    let d = 0;
    let t = 0;
    for (const l of route.legs) {
      d += num(l?.distance?.value) || 0;
      t += num(l?.duration?.value) || 0;
    }
    distanceMeters = distanceMeters ?? (d || null);
    durationSeconds = durationSeconds ?? (t || null);
  }

  return { distanceMeters, durationSeconds, summary };
}

/**
 * Todas as rotas (primária + alternativas) com geometria.
 * @returns {Array<{ coordinates: number[][], primary: boolean, distanceMeters: number|null, durationSeconds: number|null, summary: string|null, index: number }>}
 */
export function extractAllRoutes(data) {
  if (!data || typeof data !== 'object') return [];

  /** @type {object[]} */
  let routeObjects = [];

  if (Array.isArray(data.routes) && data.routes.length) {
    routeObjects = data.routes;
  } else if (Array.isArray(data.directions?.routes) && data.directions.routes.length) {
    routeObjects = data.directions.routes;
  } else if (Array.isArray(data.alternativeRoutes) || data.primaryRoute) {
    routeObjects = [
      ...(data.primaryRoute ? [data.primaryRoute] : []),
      ...(Array.isArray(data.alternativeRoutes) ? data.alternativeRoutes : [])
    ];
  }

  // Se só houver polyline na root, trata como rota única
  if (!routeObjects.length) {
    const coords = pointsFromEncodedCandidates(data);
    if (coords.length >= 2) {
      const meta = extractRouteMeta(data);
      return [
        {
          coordinates: coords,
          primary: true,
          index: 0,
          ...meta
        }
      ];
    }
    return [];
  }

  const primaryIdx = routeObjects.findIndex((r) => r && r.isPrimary === true);
  const results = [];

  routeObjects.forEach((route, index) => {
    const coordinates = extractCoordinatesFromRoute(route);
    if (coordinates.length < 2) return;
    const meta = metaFromRouteObject(route);
    const primary =
      primaryIdx >= 0 ? index === primaryIdx : index === 0;
    results.push({
      coordinates,
      primary,
      index,
      raw: route,
      ...meta
    });
  });

  // Fallback: se Moveme routes sem geometria, usar directions.routes Google
  if (
    !results.length &&
    Array.isArray(data.directions?.routes) &&
    data.routes !== data.directions.routes
  ) {
    data.directions.routes.forEach((route, index) => {
      const coordinates = extractCoordinatesFromRoute(route);
      if (coordinates.length < 2) return;
      results.push({
        coordinates,
        primary: index === 0,
        index,
        ...metaFromRouteObject(route)
      });
    });
  }

  // Garantir exactamente uma primary
  if (results.length && !results.some((r) => r.primary)) {
    results[0].primary = true;
  }

  // Enriquecer summary a partir de directions.routes (Google)
  const googleRoutes = data.directions?.routes;
  if (Array.isArray(googleRoutes)) {
    results.forEach((r, i) => {
      if (r.summary) return;
      const g = googleRoutes[i];
      if (!g) return;
      if (Array.isArray(g.summary)) r.summary = g.summary.join(', ');
      else if (typeof g.summary === 'string') r.summary = g.summary;
    });
  }

  return results;
}

function samePoint(a, b) {
  return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
}

/**
 * Distância (m) e duração (s) a partir do payload data.
 */
export function extractRouteMeta(data) {
  if (!data) return { distanceMeters: null, durationSeconds: null, summary: null };

  if (data.distanceMeters != null || data.etaSeconds != null) {
    return {
      distanceMeters: num(data.distanceMeters),
      durationSeconds: num(data.etaSeconds ?? data.durationSeconds),
      summary: data.summary || null
    };
  }

  const route =
    pickPrimaryRoute(data.routes) ||
    data.directions?.routes?.[0] ||
    null;

  if (!route) {
    return { distanceMeters: null, durationSeconds: null, summary: null };
  }

  const leg = Array.isArray(route.legs) ? route.legs[0] : null;
  const distanceMeters =
    num(route.distanceMeters) ??
    num(route.distance?.value) ??
    num(leg?.distance?.value);

  const durationSeconds =
    num(route.etaSeconds) ??
    num(route.duration?.value) ??
    num(leg?.duration?.value);

  let summary = null;
  if (Array.isArray(route.summary)) summary = route.summary.join(', ');
  else if (typeof route.summary === 'string') summary = route.summary;

  // Somar todos os legs se necessário
  if ((distanceMeters == null || durationSeconds == null) && Array.isArray(route.legs)) {
    let d = 0;
    let t = 0;
    for (const l of route.legs) {
      d += num(l?.distance?.value) || 0;
      t += num(l?.duration?.value) || 0;
    }
    return {
      distanceMeters: distanceMeters ?? (d || null),
      durationSeconds: durationSeconds ?? (t || null),
      summary
    };
  }

  return { distanceMeters, durationSeconds, summary };
}

function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export function formatDistance(meters) {
  if (meters == null) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
}

export function formatDuration(seconds) {
  if (seconds == null) return '—';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h} h ${rem} min` : `${h} h`;
}
