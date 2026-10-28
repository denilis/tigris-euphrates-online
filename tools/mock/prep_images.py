# Обрезка ассетов (фото на белом фоне) под поле: тайлы квадратом,
# жетоны лидеров кругом с прозрачностью, монументы без белого фона.
#   python -I prep_images.py <assets dir> <out json>
import base64, io, json, sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

src, out = sys.argv[1], sys.argv[2]


def bbox_nonwhite(im, thr=28):
    g = im.convert('RGB')
    diff = ImageChops.difference(g, Image.new('RGB', g.size, (255, 255, 255))).convert('L')
    mask = diff.point(lambda v: 255 if v > thr else 0).filter(ImageFilter.MedianFilter(5))
    return mask.getbbox()


def bbox_wood(im):
    # диск жетона: насыщенные тёплые пиксели дерева; белый фон и серая тень отпадают
    hsv = im.convert('HSV')
    sat = hsv.getchannel('S').point(lambda v: 255 if v > 38 else 0).filter(ImageFilter.MedianFilter(9))
    return sat.getbbox()


def b64(im, fmt, **kw):
    buf = io.BytesIO()
    im.save(buf, fmt, **kw)
    mime = 'image/png' if fmt == 'PNG' else 'image/jpeg'
    return f'data:{mime};base64,' + base64.b64encode(buf.getvalue()).decode()


def square(box):
    l, t, r, b = box
    s = max(r - l, b - t)
    cx, cy = (l + r) / 2, (t + b) / 2
    return (int(cx - s / 2), int(cy - s / 2), int(cx + s / 2), int(cy + s / 2))


res = {}
for name in ['temple', 'farm', 'market', 'settlement', 'catastrophe']:
    im = Image.open(f'{src}/tiles/{name}.jpg').convert('RGB')
    l, t, r, b = square(bbox_nonwhite(im))
    k = int((r - l) * 0.035)  # срезаем светлый кант плитки
    im = im.crop((l + k, t + k, r - k, b - k)).resize((112, 112), Image.LANCZOS)
    res['tile_' + name] = b64(im, 'JPEG', quality=82)

for sym in ['lion', 'bull', 'bow', 'pot']:
    for col in ['red', 'blue', 'green', 'black']:
        im = Image.open(f'{src}/tokens/{sym}_{col}.jpg').convert('RGB')
        box = square(bbox_wood(im))
        im = im.crop(box).resize((96, 96), Image.LANCZOS).convert('RGBA')
        m = Image.new('L', (384, 384), 0)
        ImageDraw.Draw(m).ellipse((6, 6, 378, 378), fill=255)
        im.putalpha(m.resize((96, 96), Image.LANCZOS))
        res[f'tok_{sym}_{col}'] = b64(im, 'PNG', optimize=True)

for mon in ['red_blue', 'red_green', 'red_black', 'green_blue', 'blue_black', 'green_black']:
    fn = mon if mon != 'red_blue' else 'blue_red'
    im = Image.open(f'{src}/monuments/{fn}.jpg').convert('RGB')
    box = square(bbox_nonwhite(im, 40))
    im = im.crop(box).resize((140, 140), Image.LANCZOS)
    # белый фон -> прозрачность по близости к белому
    g = ImageChops.difference(im, Image.new('RGB', im.size, (255, 255, 255))).convert('L')
    a = g.point(lambda v: 0 if v < 18 else min(255, (v - 18) * 6))
    im = im.convert('RGBA')
    im.putalpha(a)
    res['mon_' + mon] = b64(im, 'PNG', optimize=True)

json.dump(res, open(out, 'w', encoding='utf-8'))
print({k: len(v) // 1024 for k, v in res.items()}, 'КБ всего', sum(len(v) for v in res.values()) // 1024)
