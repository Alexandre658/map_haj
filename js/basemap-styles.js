/**
 * Estilos de basemap: Mapa / Satélite / Híbrido (estilo Google Maps).
 * Satélite: Esri World Imagery (uso não-comercial / demo).
 * Híbrido: imagética + vias/labels OpenFreeMap.
 */

const GLYPHS = './assets/glyphs/{fontstack}/{range}.pbf';
const SPRITE = './assets/sprites-modern/maphaj';

const ESRI_IMAGERY = {
  type: 'raster',
  tiles: [
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
  ],
  tileSize: 256,
  maxzoom: 19,
  attribution:
    'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
};

const OPENMAPTILES = {
  type: 'vector',
  url: '/tiles/ofm/planet'
};

/** Estilo vectorial local (Mapa). */
export const STYLE_MAP = './styles/liberty-local.json';

/** Só satélite. */
export function buildSatelliteStyle() {
  return {
    version: 8,
    name: 'maphaj-satellite',
    glyphs: GLYPHS,
    sources: {
      esri: ESRI_IMAGERY
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#0b1a12' }
      },
      {
        id: 'satellite',
        type: 'raster',
        source: 'esri',
        paint: { 'raster-opacity': 1 }
      }
    ]
  };
}

/** Satélite + vias/labels (Híbrido). */
export function buildHybridStyle() {
  return {
    version: 8,
    name: 'maphaj-hybrid',
    glyphs: GLYPHS,
    sprite: SPRITE,
    sources: {
      esri: ESRI_IMAGERY,
      openmaptiles: OPENMAPTILES
    },
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#0b1a12' }
      },
      {
        id: 'satellite',
        type: 'raster',
        source: 'esri',
        paint: { 'raster-opacity': 1 }
      },
      {
        id: 'highway-casing',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 11,
        filter: [
          'all',
          ['!=', 'brunnel', 'tunnel'],
          [
            'in',
            'class',
            'motorway',
            'trunk',
            'primary',
            'secondary',
            'tertiary',
            'minor',
            'service'
          ]
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': 'rgba(0,0,0,0.45)',
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            11,
            2.2,
            16,
            8
          ]
        }
      },
      {
        id: 'highway',
        type: 'line',
        source: 'openmaptiles',
        'source-layer': 'transportation',
        minzoom: 8,
        filter: [
          'all',
          ['!=', 'brunnel', 'tunnel'],
          [
            'in',
            'class',
            'motorway',
            'trunk',
            'primary',
            'secondary',
            'tertiary',
            'minor',
            'service',
            'path',
            'track'
          ]
        ],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': [
            'match',
            ['get', 'class'],
            'motorway',
            '#f5c542',
            'trunk',
            '#f5c542',
            'primary',
            '#ffffff',
            '#e8e8e8'
          ],
          'line-width': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8,
            0.6,
            12,
            1.4,
            16,
            5
          ],
          'line-opacity': 0.92
        }
      },
      {
        id: 'place-city',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'place',
        filter: ['in', 'class', 'city', 'town', 'village'],
        layout: {
          'text-field': ['coalesce', ['get', 'name:pt'], ['get', 'name']],
          'text-font': ['Noto Sans Bold'],
          'text-size': [
            'interpolate',
            ['linear'],
            ['zoom'],
            8,
            11,
            14,
            16
          ],
          'text-max-width': 8,
          'text-anchor': 'center'
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.75)',
          'text-halo-width': 1.4
        }
      },
      {
        id: 'road-label',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'transportation_name',
        minzoom: 13,
        layout: {
          'text-field': ['coalesce', ['get', 'name:pt'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'symbol-placement': 'line',
          'text-size': 11,
          'text-max-angle': 30
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': 'rgba(0,0,0,0.7)',
          'text-halo-width': 1.2
        }
      },
      {
        id: 'poi-label',
        type: 'symbol',
        source: 'openmaptiles',
        'source-layer': 'poi',
        minzoom: 15,
        filter: ['==', ['geometry-type'], 'Point'],
        layout: {
          'text-field': ['coalesce', ['get', 'name:pt'], ['get', 'name']],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-max-width': 9,
          'text-optional': true
        },
        paint: {
          'text-color': '#f0f0f0',
          'text-halo-color': 'rgba(0,0,0,0.8)',
          'text-halo-width': 1.1
        }
      }
    ]
  };
}

/**
 * @param {'map'|'satellite'|'hybrid'} id
 * @returns {string|object}
 */
export function getBasemapStyle(id) {
  switch (id) {
    case 'satellite':
      return buildSatelliteStyle();
    case 'hybrid':
      return buildHybridStyle();
    case 'map':
    default:
      return STYLE_MAP;
  }
}
