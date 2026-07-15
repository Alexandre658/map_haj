# MoveMe map-lib SDK — guia de implementação

Guia para portar a demo `demo-mapa/` (maphaj + MapLibre) para o **map-lib SDK**, com o mesmo contrato do app passageiro MoveMe.

Documentos irmãos:

- [MAP_LIB_PLACES_SEARCH.md](../../movemeappclient_prod/docs/MAP_LIB_PLACES_SEARCH.md)
- [MAP_LIB_POLYLINE.md](../../movemeappclient_prod/docs/MAP_LIB_POLYLINE.md)

> **Regra de ouro:** o cliente **não** chama Google Places nem Google Directions no happy path. Tudo passa pelo backend MoveMe (`x-api-key` / Bearer).

---

## 1. Visão geral

```
App / host
    ↓  MapLibConfig (baseUrl, apiKey, country, language)
map-lib SDK
    ├── PlacesClient          → GET  /api/places/*
    ├── DirectionsClient      → POST /api/directions/route
    ├── MapController         → câmara, markers, basemap
    ├── RouteController       → polyline, alternativas, manobras
    ├── NavigationController  → GPS, follow, turn-by-turn, off-route
    └── UI (opcional)         → Search, PlaceCard, Settings, TravelModes
```

A pasta `demo-mapa/` é a **referência de comportamento** (JS + MapLibre). No SDK, replica o contrato HTTP e a UX; não copies o HTML à letra.

---

## 2. Mapeamento demo → SDK

| Ficheiro demo | Responsabilidade | Peça no SDK |
|---------------|------------------|-------------|
| `js/places-config.js` | `baseUrl`, `apiKey`, `country` | `MapLibConfig` |
| `js/places-client.js` | HTTP places | `PlacesClient` |
| `js/places-model.js` | Normalizar Place | `MapPlace` |
| `js/places-controller.js` | Debounce + merge | `PlacesSearchController` |
| `js/places-cache.js` | Histórico / export | cache local |
| `js/directions-client.js` | HTTP directions | `DirectionsClient` |
| `js/polyline.js` | Decode + extract routes | `PolylineCodec` |
| `js/route-layer.js` | Overlay da rota | `RouteOverlay` |
| `js/route-maneuvers.js` | Curvas + textos | `ManeuverService` |
| `js/navigation-controller.js` | GPS, follow, off-route | `NavigationController` |
| `js/basemap-styles.js` | Mapa / Satélite / Híbrido | `BasemapController` |
| `js/place-details-card.js` | Labels / rating | util UI ou widget |
| `index.html` | Wiring UX | host app + widgets opcionais |

---

## 3. Configuração

```dart
class MapLibConfig {
  final String baseUrl;     // ex.: https://dev.appmoveme.com
  final String apiKey;      // header x-api-key
  final String country;     // default: ao
  final String language;    // default: pt
  final int searchDebounceMs;   // UI ~200
  final int apiDebounceMs;      // API ~300
}
```

**Auth:** header `x-api-key` (mesmo do resto da app). Não hardcodes Google API key no SDK.

---

## 4. Places

### Endpoints

| Método | Path | Uso |
|--------|------|-----|
| GET | `/api/places/search` | pesquisa textuali |
| GET | `/api/places/details/:placeId` | enriquecer lugar |
| GET | `/api/places/coordinates` | reverse geocode / clique no mapa |
| GET | `/api/places/nearby` | opcional |
| GET | `/api/places/export` | cache offline |

### Modelo

Normalizar aliases da API:

| Campo SDK | Chaves JSON possíveis |
|-----------|------------------------|
| `placeId` | `placeId`, `place_id`, `id` |
| `name` | `name` |
| `address` | `formattedAddress`, `formatted_address`, `address`, `vicinity` |
| `lat` / `lng` | `geometry.location`, `location`, `position` |
| `types` | `types` |
| `rating` | `rating` |
| `userRatings` | `userRatings`, `user_ratings_total` |
| `source` | `source` |

Parser dual: `{ places: [...] }` **ou** `{ data: { results: [...] } }` **ou** `{ results: [...] }`.

### Interface

```dart
abstract class PlacesClient {
  Future<List<MapPlace>> search({
    required String query,
    double? lat,
    double? lng,
    String? country,
    int? maxResults,
  });

  Future<MapPlace?> details(String placeId);

  Future<MapPlace?> fromCoordinates({
    required double lat,
    required double lng,
    int maxResults = 1,
  });
}
```

### Pipeline de pesquisa (UX)

1. Debounce UI ~200 ms  
2. Query vazia → histórico local  
3. Debounce API ~300 ms + cancelar pedidos obsoletos  
4. Merge: cache export + histórico + API  
5. Selecção → `onPlaceSelected(MapPlace)` → marker + PlaceCard  
6. Se faltar lat/lng → `details` ou `coordinates`

Referência: `demo-mapa/js/places-controller.js`, `place-search-field.js`.

---

## 5. Directions / rotas

### Endpoint

```
POST /api/directions/route
```

Body:

```json
{
  "origin": { "latitude": -8.8383, "longitude": 13.2344 },
  "destination": { "latitude": -8.916, "longitude": 13.196 },
  "options": {
    "mode": "driving",
    "alternatives": true,
    "overview": "full",
    "steps": true,
    "language": "pt"
  }
}
```

### Modos de transporte (UI → API)

| UI | `options.mode` |
|----|----------------|
| Carro | `driving` |
| Moto | `motorcycle` |
| A pé | `walking` |
| Bicicleta | `bicycling` |
| Transportes | `transit` |

> Em alguns ambientes o provider efectivo é GraphHopper e pode devolver geometria semelhante entre modos. O SDK deve **sempre enviar** o `mode` correcto e incluir o modo na chave de cache.

### Interface

```dart
abstract class DirectionsClient {
  Future<RouteBundle> getRoute({
    required LatLng origin,
    required LatLng destination,
    List<LatLng> waypoints = const [],
    String mode = 'driving',
    bool alternatives = true,
  });
}

class RouteBundle {
  final List<RouteOption> routes; // primaria + alternativas
  final Object? raw;
}

class RouteOption {
  final List<LatLng> points;
  final int? distanceMeters;
  final int? durationSeconds;
  final String? summary;
  final bool isPrimary;
}
```

### Polyline

1. Extrair encoded de `polyline` / `overview_polyline.points` / `primaryRoute` / `routes[]`  
2. Decode Google encoded polyline → `List<LatLng>`  
3. **Só** desenhar no mapa depois do decode dentro do SDK  

Referência: `demo-mapa/js/polyline.js`, `directions-client.js`.

### Overlay da rota (comportamento demo)

- Linha principal azul (~10 px) + casing branco  
- Alternativas a **~30%** opacidade; clique selecciona  
- Hover na linha: tempo/distância **restantes até ao destino** + nome da rua (`fromCoordinates`)  
- Após `setStyle` / mudança de basemap: **reaplicar** polyline + pins (o estilo limpa layers)

Referência: `demo-mapa/js/route-layer.js`.

### Manobras nas curvas

O backend GraphHopper actual **pode não** devolver `legs[].steps`. Fallback no SDK:

1. Preferir `legs[].steps` / instructions se existirem  
2. Senão: detectar curvas na geometria + reverse geocode rua  
3. Textos PT: “Curvar ligeiramente à direita…”, “Vire à esquerda…”  
4. Desenhar setas **dentro** da polyline (não medalhões flutuantes grandes)

Referência: `demo-mapa/js/route-maneuvers.js`.

---

## 6. Mapa / basemap

### Modos

| Modo | Conteúdo |
|------|----------|
| `map` | estilo vectorial (ex.: liberty local) |
| `satellite` | raster imagética (ex.: Esri World Imagery) |
| `hybrid` | satélite + vias/labels |

### Settings UI

- Botão **só ícone** (engrenagem)  
- Ao clicar: painel com **Tipo de mapa** + atalhos “Ir para” (cidades)  
- Não deixar o switcher Map/Satélite/Híbrido sempre visível na viewport

### Assets (crítico)

Sprites/glyphs devem usar paths **relativos** ao pacote/app:

```
./assets/sprites-modern/maphaj
./assets/glyphs/{fontstack}/{range}.pbf
```

**Não** usar `/assets/...` absoluto — quebra quando o host serve sob um subpath (`/demo-mapa/`, etc.).

Referência: `demo-mapa/js/basemap-styles.js`, `styles/liberty-local.json`.

---

## 7. Place details + clique no mapa

### Card de detalhes

Mostrar quando um lugar é seleccionado:

- Nome, categoria, rating, morada  
- Distância ao bias / GPS  
- Telefone / website / coordenadas (se houver)  
- Acções: Direções · Copiar · Fechar  

Em modo **direções**:

- **Usar como destino**  
- **Usar como origem**

### Clique no mapa (só em direções)

1. Ignorar cliques na polyline / controlos UI  
2. Opcional: ler POI do vector tile se houver `name`  
3. `GET /api/places/coordinates?lat=&lng=`  
4. Abrir PlaceCard + pin temporário  

Referência: handlers em `demo-mapa/index.html` (`openPlaceFromMapClick`, `showPlaceCard`).

---

## 8. API pública sugerida do SDK

```dart
abstract class MapLib {
  Future<void> init(MapLibConfig config);

  PlacesClient get places;
  DirectionsClient get directions;
  MapController get map;
  RouteController get route;
  NavigationController get navigation;

  /// Callbacks para o host
  set onPlaceSelected(void Function(MapPlace place)? cb);
  set onRouteUpdated(void Function(RouteBundle route)? cb);
  set onError(void Function(Object error)? cb);
}

abstract class MapController {
  void setBasemap(BasemapMode mode);
  void flyTo(LatLng target, {double? zoom});
  void setPlaceMarker(MapPlace place);
  void clearPlaceMarker();
  Stream<LatLng> get onMapTap;
}

abstract class RouteController {
  void setRoutes(RouteBundle bundle, {int selectedIndex = 0});
  void selectRoute(int index);
  void clear();
  int get selectedIndex;
}

abstract class NavigationController {
  Future<void> setRoute(RouteBundle route);
  Future<void> start();
  void stop();
  bool get active;

  /// Próxima instrução, ETA restante, off-route, chegada
  set onUpdate(void Function(NavigationState state)? cb);
  set onOffRoute(void Function(LatLng pos)? cb);
  set onArrived(void Function()? cb);
}
```

### Navegação (turn-by-turn)

Fluxo na demo (`js/navigation-controller.js` + `index.html`):

1. Com rota seleccionada → botão **Navegar**
2. `setRoute` resolve manobras (`resolveManeuvers` / API steps ou geometria)
3. `start` → `watchPosition` (high accuracy)
4. Snap à polyline (`nearestPointOnLine`); câmara pitch ~55° + bearing
5. HUD: distância à próxima manobra + instrução + ETA/distância restantes
6. Fora da rota (~45 m, 3 hits) → recálculo origem=GPS → destino
7. Chegada (~35 m) → mensagem e `stop`

### O que fica no SDK vs no host

| No SDK (core) | No host / widgets opcionais |
|---------------|----------------------------|
| HTTP + modelos | Layout da search bar |
| Decode polyline | PlaceCard styling |
| Route overlay | Painel Settings |
| Basemap switch | Travel mode chips UI |
| Manobras | Textos/cores da marca |
| Navigation GPS + progresso | HUD Navegar / Parar |

---

## 9. Ordem de implementação (checklist)

- [ ] `MapLibConfig` + cliente HTTP com `x-api-key`
- [ ] `MapPlace` + parser dual
- [ ] `PlacesClient.search` / `details` / `fromCoordinates`
- [ ] Debounce + cancelamento + histórico
- [ ] Pin de lugar + PlaceCard
- [ ] `DirectionsClient.getRoute` + decode polyline
- [ ] Route overlay + alternativas + selecção
- [ ] Travel modes (`options.mode`)
- [ ] Hover ETA restante + rua
- [ ] Manobras nas curvas
- [ ] Basemap map/satellite/hybrid + restore da rota após `setStyle`
- [ ] Settings (ícone → painel)
- [ ] Map tap → detalhes em modo direções
- [ ] Navegação turn-by-turn (GPS, HUD, off-route recalc, chegada)
- [ ] Sprites/glyphs relativos
- [ ] Testes: sem rede, sem coords, troca de basemap, abort search

---

## 10. Cache sugerido

| Item | Valor |
|------|-------|
| Cache directions | quantizar coords ~4 casas; incluir `mode`; TTL ~120 s |
| Cache search memória | TTL ~5 min |
| Histórico UI | últimos N lugares (local storage / prefs) |
| Export places | sync periódico opcional (`/api/places/export`) |

---

## 11. Erros / edge cases

1. **`/details` not_found** — card funciona só com dados do search; não bloquear UX.  
2. **Sem `legs[].steps`** — usar detector geométrico + `/coordinates`.  
3. **`setStyle` limpa layers** — guardar `lastRoutes` e `setRoutes` no `style.load` / `idle`.  
4. **GPS** — “A sua localização” deve usar GPS real, não o centro do mapa.  
5. **Clique na rota** — não abrir PlaceCard (filtrar hit layers da polyline).
6. **Navegação activa** — não abrir PlaceCard ao tocar no mapa; esconder painel de direções.

---

## 12. Ficheiros de referência neste repo

```
demo-mapa/
  index.html                 # wiring UX completo
  js/places-*.js             # places
  js/directions-client.js
  js/polyline.js
  js/route-layer.js
  js/route-maneuvers.js
  js/navigation-controller.js
  js/basemap-styles.js
  js/place-details-card.js
  styles/liberty-local.json
  assets/sprites-modern/
  assets/glyphs/
```

App MoveMe (comportamento produto):

- `BackendDirectionsService` → `POST /api/directions/route`
- Places store / search card → `/api/places/*`

---

## Resumo

No map-lib SDK: **config + clients HTTP + mapa + rota**.  
A demo prova o contrato. O host liga UI (pesquisa, card, settings, modos) via callbacks.  
Nunca Google no cliente; sempre `dev.appmoveme.com` / failover + `x-api-key`.
