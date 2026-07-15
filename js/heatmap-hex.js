/**
 * Converte pontos de procura em polígonos hexagonais (visual Uber / H3-like).
 */

/**
 * @param {number} zoom
 * @returns {number} raio do hex em graus de latitude (~tamanho Uber urbano)
 */
export function hexRadiusForZoom(zoom) {
  if (zoom < 11) return 0.028;
  if (zoom < 12) return 0.018;
  if (zoom < 13) return 0.012;
  if (zoom < 14) return 0.008;
  if (zoom < 15) return 0.0055;
  return 0.0038;
}

/**
 * Vertíces de um hexágono flat-top centrado em [lng, lat].
 * @param {number} lng
 * @param {number} lat
 * @param {number} radiusLatDeg
 * @returns {number[][]}
 */
export function flatTopHexRing(lng, lat, radiusLatDeg) {
  const cosLat = Math.cos((lat * Math.PI) / 180) || 1e-6;
  const rLng = radiusLatDeg / cosLat;
  /** @type {number[][]} */
  const ring = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    ring.push([
      lng + rLng * Math.cos(angle),
      lat + radiusLatDeg * Math.sin(angle)
    ]);
  }
  ring.push(ring[0]);
  return ring;
}

/**
 * Células hexadecimais (axial) que cobrem a bbox.
 * @param {{ minLng:number, maxLng:number, minLat:number, maxLat:number }} bbox
 * @param {number} sizeDeg
 */
function hexGridCenters(bbox, sizeDeg) {
  const hexW = sizeDeg * 1.5;
  const hexH = sizeDeg * Math.sqrt(3);
  /** @type {Array<{ lng: number, lat: number, q: number, r: number }>} */
  const centers = [];
  const pad = sizeDeg * 2;
  const minLng = bbox.minLng - pad;
  const maxLng = bbox.maxLng + pad;
  const minLat = bbox.minLat - pad;
  const maxLat = bbox.maxLat + pad;

  let row = 0;
  for (let lat = minLat; lat <= maxLat; lat += hexH * 0.5) {
    const offset = row % 2 === 0 ? 0 : hexW * 0.5;
    for (let lng = minLng + offset; lng <= maxLng; lng += hexW) {
      centers.push({ lng, lat, q: Math.round(lng / hexW), r: row });
    }
    row += 1;
  }
  return centers;
}

/**
 * Intensidade num hex a partir dos pontos (queda suave estilo Uber).
 * @param {{ lng: number, lat: number }} cell
 * @param {import('./heatmap-client.js').HeatPoint[]} points
 * @param {number} sizeDeg
 */
function sampleIntensity(cell, points, sizeDeg) {
  let best = 0;
  const influence = sizeDeg * 2.2;
  for (const p of points) {
    const dLat = p.lat - cell.lat;
    const dLng = (p.lng - cell.lng) * Math.cos((cell.lat * Math.PI) / 180);
    const dist = Math.sqrt(dLat * dLat + dLng * dLng);
    if (dist > influence) continue;
    const w = p.weight ?? p.intensity ?? 0.5;
    const fall = Math.exp(-(dist * dist) / (2 * (sizeDeg * 0.85) ** 2));
    best = Math.max(best, w * fall);
  }
  return best;
}

/**
 * @param {import('./heatmap-client.js').HeatPoint[]} points
 * @param {{ zoom?: number, center?: {lat:number,lng:number}|null }} [opts]
 */
export function heatPointsToHexGeoJSON(points, opts = {}) {
  const list = Array.isArray(points) ? points : [];
  const zoom = opts.zoom ?? 12;
  const sizeDeg = hexRadiusForZoom(zoom);

  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;

  if (list.length) {
    for (const p of list) {
      minLng = Math.min(minLng, p.lng);
      maxLng = Math.max(maxLng, p.lng);
      minLat = Math.min(minLat, p.lat);
      maxLat = Math.max(maxLat, p.lat);
    }
  } else if (opts.center) {
    const pad = sizeDeg * 8;
    minLng = opts.center.lng - pad;
    maxLng = opts.center.lng + pad;
    minLat = opts.center.lat - pad;
    maxLat = opts.center.lat + pad;
  } else {
    return { type: 'FeatureCollection', features: [] };
  }

  // Expandir um pouco a grelha
  const expand = sizeDeg * 4;
  minLng -= expand;
  maxLng += expand;
  minLat -= expand;
  maxLat += expand;

  const centers = hexGridCenters(
    { minLng, maxLng, minLat, maxLat },
    sizeDeg
  );

  /** @type {object[]} */
  const features = [];
  let i = 0;
  for (const cell of centers) {
    const intensity = sampleIntensity(cell, list, sizeDeg);
    if (intensity < 0.12) continue;
    features.push({
      type: 'Feature',
      properties: {
        intensity: Math.min(1, intensity),
        weight: Math.min(1, intensity),
        id: `hex_${i++}`
      },
      geometry: {
        type: 'Polygon',
        coordinates: [flatTopHexRing(cell.lng, cell.lat, sizeDeg)]
      }
    });
  }

  return { type: 'FeatureCollection', features };
}
