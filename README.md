# map_haj — demo maphaj (Angola)

Mapa tipo Google Maps centrado em **Angola** (Luanda por defeito), com estilo OpenFreeMap Liberty.

## Abrir

```bash
node server.mjs
```

Abre http://localhost:5173

O servidor serve a demo **e** faz proxy dos tiles em `/tiles/ofm/*`
(OpenFreeMap por cima — o app só fala com o teu host).

Atalhos: Luanda, Benguela, Lobito, Huambo, Lubango, Malanje, Cabinda, e vista do país.


## URLs estilo Google Maps

Abre / partilha uma vista assim:

```
https://maphaj.appmoveme.com/maps/@-8.9138601,13.2523099,15z
```

Formato: `/maps/@lat,lng,zoomz` (o resto do path/query do Google, ex. `data=!5m1!1e1?...`, é ignorado).

Ao mover o mapa, a barra de URL actualiza-se automaticamente.


## O que já está na pasta

| Item | Caminho | Notas |
|------|---------|--------|
| Demo | `index.html` | Centrado em Luanda; `maxBounds` à volta de Angola |
| Servidor | `server.mjs` | estático + proxy de tiles |
| Estilos | `styles/` | Liberty com sources em `/tiles/ofm/...` |
| Sprites | `assets/sprites-modern/` | Ícones maphaj |
| Glyphs | `assets/glyphs/` | Fontes Noto Sans |
| Dados OSM Angola | `data/angola-latest.osm.pbf` | ~80 MB (Geofabrik) |

No browser/Flutter, **estilo + sprites + glyphs + tiles** passam por `localhost:5173`.
O proxy busca o PBF no OpenFreeMap; depois podes trocar por PMTiles locais.

## Próximo passo (offline Angola)

Com Java instalado, podes gerar PMTiles a partir do PBF, por exemplo com [Planetiler](https://github.com/onthegomap/planetiler), e apontar o style para o ficheiro local.

Disco necessário: gera facilmente +200–500 MB além do PBF.
