/**
 * Segmentos de polyline com nível de engarrafamento (estilo Google/MoveMe).
 *
 * - heavy  → vermelho  (tráfego / livre >= 1.5)
 * - medium → laranja   (tráfego / livre >= 1.15)
 * - none   → azul      (sem atraso relevante ou sem dados)
 */

import { extractCoordinatesFromRoute } from './polyline.js';

export const TRAFFIC_COLORS = {
  heavy: '#D93025',
  medium: '#FB8C00',
  none: '#1A73E8'
};

/**
 * Lê duração em segundos de formatos Google / Moveme.
 * @param {unknown} raw
 * @returns {number|null}
 */
export function readDurationSeconds(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  if (typeof raw === 'object') {
    const v =
      raw.value ??
      raw.seconds ??
      raw.durationSeconds ??
      raw.duration_in_traffic_value;
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * Classifica engarrafamento pelo rácio tráfego / duração livre.
 * @param {number|null} freeSeconds
 * @param {number|null} trafficSeconds
 * @returns {'heavy'|'medium'|'none'}
 */
export function classifyCongestion(freeSeconds, trafficSeconds) {
  if (
    freeSeconds == null ||
    trafficSeconds == null ||
    !(freeSeconds > 0) ||
    !(trafficSeconds > 0)
  ) {
    return 'none';
  }
  const ratio = trafficSeconds / freeSeconds;
  if (ratio >= 1.5) return 'heavy';
  if (ratio >= 1.15) return 'medium';
  return 'none';
}

/**
 * Nível a partir de um step/leg/rota.
 * @param {object} unit
 */
export function congestionFromUnit(unit) {
  if (!unit || typeof unit !== 'object') return 'none';
  const free = readDurationSeconds(
    unit.duration ?? unit.durationSeconds ?? unit.time ?? unit.etaSeconds
  );
  const traffic = readDurationSeconds(
    unit.duration_in_traffic ??
      unit.durationInTraffic ??
      unit.duration_in_traffic_value ??
      unit.durationInTrafficSeconds
  );
  // Alguns backends mandam congestion explícito
  const explicit = String(
    unit.congestion ?? unit.traffic ?? unit.trafficCondition ?? ''
  ).toLowerCase();
  if (
    explicit.includes('jam') ||
    explicit.includes('heavy') ||
    explicit.includes('severe') ||
    explicit === 'red'
  ) {
    return 'heavy';
  }
  if (
    explicit.includes('slow') ||
    explicit.includes('medium') ||
    explicit.includes('moderate') ||
    explicit === 'orange'
  ) {
    return 'medium';
  }
  return classifyCongestion(free, traffic);
}

function pushSegment(out, coordinates, congestion) {
  if (!coordinates || coordinates.length < 2) return;
  out.push({
    coordinates,
    congestion: congestion || 'none'
  });
}

/**
 * Extrai segmentos coloridos a partir da rota (raw API + coordenadas).
 * @param {{ coordinates?: number[][], raw?: object|null }} route
 * @returns {Array<{ coordinates: number[][], congestion: 'heavy'|'medium'|'none' }>}
 */
export function extractTrafficSegments(route) {
  const fallbackCoords = route?.coordinates || [];
  const raw = route?.raw || route || {};
  const segments = [];

  const routeObjs = [];
  if (raw.legs || raw.steps) {
    routeObjs.push(raw);
  } else if (Array.isArray(raw.routes) && raw.routes[0]) {
    routeObjs.push(raw.routes[0]);
  } else if (raw.directions?.routes?.[0]) {
    routeObjs.push(raw.directions.routes[0]);
  } else {
    routeObjs.push(raw);
  }

  for (const r of routeObjs) {
    const legs = Array.isArray(r.legs) ? r.legs : [];
    if (legs.length) {
      for (const leg of legs) {
        const steps = Array.isArray(leg.steps) ? leg.steps : [];
        if (steps.length) {
          const legLevel = congestionFromUnit(leg);
          for (const step of steps) {
            let coords = extractCoordinatesFromRoute(step);
            if (coords.length < 2) {
              // Google: start_location / end_location só 2 pontos
              const a = step.start_location || step.startLocation;
              const b = step.end_location || step.endLocation;
              if (a && b) {
                const lng1 = a.lng ?? a.longitude;
                const lat1 = a.lat ?? a.latitude;
                const lng2 = b.lng ?? b.longitude;
                const lat2 = b.lat ?? b.latitude;
                if (
                  Number.isFinite(lng1) &&
                  Number.isFinite(lat1) &&
                  Number.isFinite(lng2) &&
                  Number.isFinite(lat2)
                ) {
                  coords = [
                    [lng1, lat1],
                    [lng2, lat2]
                  ];
                }
              }
            }
            const hasStepTraffic =
              step.duration_in_traffic != null ||
              step.durationInTraffic != null ||
              step.duration_in_traffic_value != null ||
              step.durationInTrafficSeconds != null;
            const stepLevel = congestionFromUnit(step);
            pushSegment(
              segments,
              coords,
              hasStepTraffic ? stepLevel : legLevel !== 'none' ? legLevel : stepLevel
            );
          }
        } else {
          let coords = extractCoordinatesFromRoute(leg);
          if (coords.length < 2 && fallbackCoords.length >= 2) {
            // Sem geometria por leg — não fragmentar
            continue;
          }
          pushSegment(segments, coords, congestionFromUnit(leg));
        }
      }
    }
  }

  if (segments.length >= 1) return mergeAdjacentSameCongestion(segments);

  // Rota inteira com rácio global (se existir)
  const whole = congestionFromUnit(raw);
  if (fallbackCoords.length >= 2) {
    return [{ coordinates: fallbackCoords, congestion: whole }];
  }
  return [];
}

/**
 * Junta segmentos consecutivos com o mesmo nível (menos Features).
 * @param {Array<{ coordinates: number[][], congestion: string }>} segments
 */
export function mergeAdjacentSameCongestion(segments) {
  if (!segments.length) return [];
  /** @type {Array<{ coordinates: number[][], congestion: string }>} */
  const out = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && last.congestion === seg.congestion) {
      const add = seg.coordinates.slice(1);
      last.coordinates.push(...add);
    } else {
      out.push({
        congestion: seg.congestion,
        coordinates: seg.coordinates.slice()
      });
    }
  }
  return out;
}

/**
 * GeoJSON FeatureCollection para MapLibre (data-driven color).
 * @param {Array<{ coordinates: number[][], congestion: string }>} segments
 * @param {object} [props]
 */
export function trafficSegmentsToGeoJSON(segments, props = {}) {
  return {
    type: 'FeatureCollection',
    features: (segments || []).map((seg, i) => ({
      type: 'Feature',
      properties: {
        ...props,
        congestion: seg.congestion || 'none',
        index: i
      },
      geometry: {
        type: 'LineString',
        coordinates: seg.coordinates
      }
    }))
  };
}
