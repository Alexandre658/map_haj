#!/usr/bin/env python3
"""Gera sprites modernos (estilo circular) para POIs do maphaj."""
from __future__ import annotations

import json
import math
import urllib.request
from io import BytesIO
from pathlib import Path

import cairosvg
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "sprites-modern"
LEGACY = ROOT / "assets" / "sprites"
CDN = "https://cdn.jsdelivr.net/npm/lucide-static@0.468.0/icons"

# nome OpenMapTiles / sprite → (ícone lucide, cor de fundo)
POI_ICONS: dict[str, tuple[str, str]] = {
    # comida & bebida
    "bar": ("wine", "#EA4335"),
    "beer": ("beer", "#F9AB00"),
    "cafe": ("coffee", "#A16207"),
    "restaurant": ("utensils", "#EA4335"),
    "fast_food": ("sandwich", "#F9AB00"),
    "bakery": ("croissant", "#D97706"),
    "alcohol_shop": ("wine", "#7C3AED"),
    "butcher": ("beef", "#B91C1C"),
    # compras
    "shop": ("shopping-bag", "#8B5CF6"),
    "clothing_store": ("shirt", "#7C3AED"),
    "furniture": ("sofa", "#6366F1"),
    "florist": ("flower-2", "#EC4899"),
    "laundry": ("washing-machine", "#0EA5E9"),
    "commercial": ("store", "#8B5CF6"),
    # dinheiro & serviços
    "bank": ("landmark", "#059669"),
    "post": ("mail", "#2563EB"),
    "embassy": ("landmark", "#1D4ED8"),
    "town_hall": ("building-2", "#334155"),
    "police": ("shield", "#1E3A8A"),
    "fire_station": ("flame", "#DC2626"),
    # saúde
    "hospital": ("cross", "#DC2626"),
    "pharmacy": ("pill", "#EF4444"),
    "dentist": ("smile", "#0EA5E9"),
    "doctor": ("stethoscope", "#DC2626"),
    "veterinary": ("paw-print", "#F97316"),
    # transporte
    "fuel": ("fuel", "#64748B"),
    "parking": ("square-parking", "#3B82F6"),
    "parking_garage": ("warehouse", "#3B82F6"),
    "bus": ("bus", "#2563EB"),
    "rail": ("train-front", "#4F46E5"),
    "airport": ("plane", "#0EA5E9"),
    "airfield": ("plane", "#0284C7"),
    "ferry": ("ship", "#0EA5E9"),
    "bicycle": ("bike", "#16A34A"),
    "bicycle_rental": ("bike", "#15803D"),
    "car": ("car", "#475569"),
    "entrance": ("door-open", "#64748B"),
    # educação & cultura
    "school": ("graduation-cap", "#2563EB"),
    "college": ("graduation-cap", "#1D4ED8"),
    "library": ("book-open", "#4F46E5"),
    "museum": ("landmark", "#7C3AED"),
    "cinema": ("clapperboard", "#DB2777"),
    "theatre": ("drama", "#C026D3"),
    "art_gallery": ("palette", "#DB2777"),
    "attraction": ("sparkles", "#F59E0B"),
    "zoo": ("paw-print", "#16A34A"),
    "aquarium": ("fish", "#0EA5E9"),
    # lazer & outdoor
    "park": ("trees", "#16A34A"),
    "dog_park": ("dog", "#65A30D"),
    "amusement_park": ("ferris-wheel", "#EC4899"),
    "stadium": ("trophy", "#F59E0B"),
    "american_football": ("trophy", "#EA580C"),
    "baseball": ("circle", "#EA580C"),
    "basketball": ("circle", "#F97316"),
    "tennis": ("circle", "#84CC16"),
    "golf": ("flag", "#16A34A"),
    "swimming": ("waves", "#0EA5E9"),
    "campsite": ("tent", "#15803D"),
    # alojamento
    "lodging": ("bed", "#0D9488"),
    "hotel": ("bed-double", "#0F766E"),
    # religião / outros
    "place_of_worship": ("church", "#64748B"),
    "cemetery": ("flower", "#78716C"),
    "toilets": ("toilet", "#64748B"),
    "waste_basket": ("trash-2", "#78716C"),
    "information": ("info", "#2563EB"),
    "viewpoint": ("binoculars", "#0EA5E9"),
    "castle": ("castle", "#78716C"),
    "monument": ("landmark", "#78716C"),
    "fountain": ("droplets", "#0EA5E9"),
    "playground": ("toy-brick", "#F59E0B"),
    "building": ("building", "#64748B"),
    "warehouse": ("warehouse", "#64748B"),
    "default_1": ("map-pin", "#1A73E8"),
    "default_2": ("map-pin", "#34A853"),
    "default_3": ("map-pin", "#FBBC04"),
    "default_4": ("map-pin", "#EA4335"),
    "default_5": ("map-pin", "#8B5CF6"),
    "default_6": ("map-pin", "#0EA5E9"),
}

# Sprites do pack antigo que devemos manter (estradas, padrões, geometria)
KEEP_PREFIXES = (
    "road_", "us-", "arrow", "circle", "triangle", "cross", "square",
    "dot", "oneway", "railway", "wetland", "pedestrian", "level_crossing",
    "diamond", "star", "rectangle", "line", "dash",
)


def fetch_lucide(name: str) -> bytes | None:
    url = f"{CDN}/{name}.svg"
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return r.read()
    except Exception:
        return None


def tint_svg(svg: bytes, color: str = "#FFFFFF") -> bytes:
    text = svg.decode("utf-8")
    # Lucide usa stroke="currentColor" — força cor clara
    text = text.replace('stroke="currentColor"', f'stroke="{color}"')
    text = text.replace("stroke='currentColor'", f"stroke='{color}'")
    if "fill=" not in text.split("<svg", 1)[-1][:200]:
        text = text.replace("<svg", f'<svg fill="none"', 1)
    return text.encode("utf-8")


def make_badge(icon_svg: bytes | None, bg: str, size: int) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    # círculo suave com sombra leve
    pad = max(1, size // 16)
    draw.ellipse([pad, pad, size - 1 - pad, size - 1 - pad], fill=bg)

    if icon_svg:
        icon_px = int(size * 0.52)
        try:
            tinted = tint_svg(icon_svg, "#FFFFFF")
            png = cairosvg.svg2png(
                bytestring=tinted, output_width=icon_px, output_height=icon_px
            )
            icon = Image.open(BytesIO(png)).convert("RGBA")
            x = (size - icon.width) // 2
            y = (size - icon.height) // 2
            img.alpha_composite(icon, (x, y))
            return img
        except Exception:
            pass

    # fallback: ponto branco
    r = size // 6
    cx = cy = size // 2
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill="#FFFFFF")
    return img


def pack_sprites(items: dict[str, Image.Image], size: int) -> tuple[Image.Image, dict]:
    n = len(items)
    cols = max(1, math.ceil(math.sqrt(n)))
    rows = math.ceil(n / cols)
    atlas = Image.new("RGBA", (cols * size, rows * size), (0, 0, 0, 0))
    meta = {}
    for i, (name, im) in enumerate(sorted(items.items())):
        c, r = i % cols, i // cols
        x, y = c * size, r * size
        atlas.paste(im, (x, y), im)
        meta[name] = {
            "width": size,
            "height": size,
            "x": x,
            "y": y,
            "pixelRatio": 1 if size <= 28 else 2,
        }
    return atlas, meta


def copy_legacy(scale: int) -> dict[str, Image.Image]:
    """Copia sprites não-POI do pack original (shields, wetland, etc.)."""
    suffix = "" if scale == 1 else "@2x"
    sheet = Image.open(LEGACY / f"ofm{suffix}.png").convert("RGBA")
    meta = json.loads((LEGACY / f"ofm{suffix}.json").read_text())
    out = {}
    for name, info in meta.items():
        base = name.replace("_11", "")
        is_poi = base in POI_ICONS or name in POI_ICONS or name.replace("_11", "") in POI_ICONS
        keep = any(name.startswith(p) or name == p for p in KEEP_PREFIXES)
        if is_poi and not keep:
            continue
        if not keep and not name.startswith(("road_", "us-")):
            # manter também ícones geométricos e padrões
            if name not in (
                "arrow", "circle", "circle_11", "circle_11_black", "circle_stroked",
                "circle_stroked_11", "triangle", "triangle_11", "triangle_stroked",
                "triangle_stroked_11", "cross", "cross_11", "wetland", "wetland_11",
                "wetland_bg_11", "pedestrian_polygon", "oneway", "railway",
                "level_crossing", "dot_11", "square_11", "star_11",
            ) and not name.startswith(("road_", "us-")):
                continue
        x, y = info["x"], info["y"]
        w, h = info["width"], info["height"]
        out[name] = sheet.crop((x, y, x + w, y + h))
    return out


def build(scale: int):
    size = 22 if scale == 1 else 44
    cache: dict[str, bytes | None] = {}
    sprites: dict[str, Image.Image] = {}

    # 1) POIs modernos (+ variantes _11)
    for name, (lucide, color) in POI_ICONS.items():
        if lucide not in cache:
            cache[lucide] = fetch_lucide(lucide)
            print(f"  lucide:{lucide} -> {'ok' if cache[lucide] else 'MISS'}")
        badge = make_badge(cache[lucide], color, size)
        sprites[name] = badge
        sprites[f"{name}_11"] = badge.copy()

    # 2) Manter shields / padrões do pack antigo (redimensionados se preciso)
    legacy = copy_legacy(scale)
    for name, im in legacy.items():
        if name in sprites:
            continue
        if im.size != (size, size) and max(im.size) <= size * 2:
            # manter tamanho original — vamos packar com tamanho variável
            sprites[name] = im
        else:
            sprites[name] = im

    # Pack variável: grid pelo maior lado
    # Para sprites com tamanhos diferentes, usar atlas com packing simples em linhas
    entries = sorted(sprites.items(), key=lambda kv: (-kv[1].size[1], kv[0]))
    max_w = max(im.width for _, im in entries)
    max_h = max(im.height for _, im in entries)
    # packing em faixa
    atlas_w = 1024 if scale == 1 else 2048
    x = y = row_h = 0
    positions = {}
    for name, im in entries:
        if x + im.width > atlas_w:
            x = 0
            y += row_h + 1
            row_h = 0
        positions[name] = (x, y, im)
        row_h = max(row_h, im.height)
        x += im.width + 1
    atlas_h = y + row_h + 1
    atlas = Image.new("RGBA", (atlas_w, atlas_h), (0, 0, 0, 0))
    meta = {}
    for name, (px, py, im) in positions.items():
        atlas.paste(im, (px, py), im)
        meta[name] = {
            "width": im.width,
            "height": im.height,
            "x": px,
            "y": py,
            "pixelRatio": scale,
        }

    OUT.mkdir(parents=True, exist_ok=True)
    suffix = "" if scale == 1 else "@2x"
    atlas.save(OUT / f"maphaj{suffix}.png")
    (OUT / f"maphaj{suffix}.json").write_text(json.dumps(meta, separators=(",", ":")))
    print(f"Wrote maphaj{suffix}.png ({atlas.size[0]}x{atlas.size[1]}) — {len(meta)} icons")


if __name__ == "__main__":
    print("Building @1x…")
    build(1)
    print("Building @2x…")
    build(2)
