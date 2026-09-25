#!/usr/bin/env python3
"""Build web-sized game images from the source photos in assets-src/.

The source photos are 1376x768 product shots (object on a white background, ~0.5 MB each).
This script crops each object, squares it and writes small files to public/assets/game/:

  tiles/<name>.jpg          square civilization / catastrophe / unification tiles
  tokens/<dynasty>_<color>.jpg  round leader tokens (the page masks them with border-radius)
  monuments/<a>_<b>.png     monuments with a transparent background
  board.jpg                 the board picture (same size, JPEG instead of PNG)

Usage: python3 tools/prepare-assets.py   (requires Pillow)
"""
from pathlib import Path
from PIL import Image, ImageChops, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets-src'
OUT = ROOT / 'public' / 'assets' / 'game'


def object_box(im, threshold=232, inset=0.0):
    """Bounding box of everything darker than the white backdrop, optionally shrunk."""
    mask = im.convert('L').point(lambda v: 255 if v < threshold else 0)
    left, top, right, bottom = mask.getbbox()
    dx, dy = (right - left) * inset, (bottom - top) * inset
    return int(left + dx), int(top + dy), int(right - dx), int(bottom - dy)


def wood_box(im, inset=0.0):
    """Bounding box of the warm wooden token: red minus blue is high on wood, ~0 on white and grey shadow."""
    r, _, b = im.split()
    mask = ImageChops.subtract(r, b).point(lambda v: 255 if v > 28 else 0)
    left, top, right, bottom = mask.getbbox()
    dx, dy = (right - left) * inset, (bottom - top) * inset
    return int(left + dx), int(top + dy), int(right - dx), int(bottom - dy)


def square(im, box):
    left, top, right, bottom = box
    side = min(right - left, bottom - top)
    cx, cy = (left + right) / 2, (top + bottom) / 2
    return im.crop((int(cx - side / 2), int(cy - side / 2), int(cx + side / 2), int(cy + side / 2)))


def save_jpg(im, path, size, quality=84):
    path.parent.mkdir(parents=True, exist_ok=True)
    im.resize((size, size), Image.LANCZOS).save(path, 'JPEG', quality=quality, optimize=True, progressive=True)


def tiles():
    for src in sorted((SRC / 'tiles').glob('*.jpg')):
        im = Image.open(src).convert('RGB')
        save_jpg(square(im, object_box(im, threshold=215, inset=0.01)), OUT / 'tiles' / src.name, 192)


def tokens():
    for src in sorted((SRC / 'tokens').glob('*.jpg')):
        im = Image.open(src).convert('RGB')
        save_jpg(square(im, wood_box(im, inset=0.012)), OUT / 'tokens' / src.name, 160, quality=86)


def monuments():
    for src in sorted((SRC / 'monuments').glob('*.jpg')):
        im = Image.open(src).convert('RGB')
        im = im.crop(object_box(im, threshold=236))
        # Alpha from "distance to white": the backdrop and its faint shadow fade out.
        grey = im.convert('L')
        sat = im.convert('HSV').split()[1]
        alpha = Image.eval(grey, lambda v: max(0, min(255, (244 - v) * 8)))
        alpha = Image.composite(Image.new('L', im.size, 255), alpha, sat.point(lambda s: 255 if s > 70 else 0))
        alpha = alpha.filter(ImageFilter.GaussianBlur(0.8))
        rgba = im.copy()
        rgba.putalpha(alpha)
        h = 220
        w = round(rgba.width * h / rgba.height)
        path = OUT / 'monuments' / (src.stem + '.png')
        path.parent.mkdir(parents=True, exist_ok=True)
        rgba.resize((w, h), Image.LANCZOS).save(path, 'PNG', optimize=True)


def board():
    im = Image.open(SRC / 'board' / 'field.png').convert('RGB')
    OUT.mkdir(parents=True, exist_ok=True)
    im.save(OUT / 'board.jpg', 'JPEG', quality=80, optimize=True, progressive=True)


if __name__ == '__main__':
    tiles()
    tokens()
    monuments()
    board()
    total = sum(p.stat().st_size for p in OUT.rglob('*') if p.is_file())
    print(f'wrote {sum(1 for p in OUT.rglob("*") if p.is_file())} files, {total / 1024:.0f} KB -> {OUT}')
