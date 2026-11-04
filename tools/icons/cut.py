# Вырезка картинок Дениса с зеленого фона (листы иконок, зданий, портретов, печать).
# Прозрачным становится только фон: зеленые области, связанные с краем клетки, и замкнутые
# области чистого цвета фона (дырка в ручке светильника). Зеленое внутри рисунка (тайл рынка,
# зеленая фишка) остается. Кайма полупрозрачная, без зеленого отсвета.
#
#   python tools/icons/cut.py <лист> <папка> [размер] [--grid 3x2] [--box x0,y0,x1,y1]
#          [--names a,b,c] [--keep a,b] [--top 1.0] [--near 70] [--far 120] [--seed 40]
#
# --box: часть листа с сеткой (в долях 0..1), --top: какая доля клетки сверху берется (отрезать
# подписи под иконкой), --keep: у каких картинок зеленый в рисунке есть и отсвет убирать только у края,
# --seed 0: не трогать замкнутые области (зеленая фишка цвета фона внутри темного ободка).
# Иконки главной 04.11: python tools/icons/cut.py лист.jpg public/img/icons 160
import sys
import numpy as np
from PIL import Image, ImageDraw

args = sys.argv[1:]
opt = {}
pos = []
while args:
    a = args.pop(0)
    if a.startswith('--'):
        opt[a[2:]] = args.pop(0)
    else:
        pos.append(a)
src, out = pos[0], pos[1]
size = int(pos[2]) if len(pos) > 2 else 160
gx, gy = (int(v) for v in opt.get('grid', '3x2').split('x'))
box = [float(v) for v in opt.get('box', '0,0,1,1').split(',')]
NAMES = opt.get('names', 'start,tables,stats,rules,learn,codes').split(',')
KEEP_GREEN = set(opt.get('keep', 'tables').split(','))
TOP = float(opt.get('top', '1'))
NEAR, FAR, SEED = float(opt.get('near', 70)), float(opt.get('far', 120)), float(opt.get('seed', 40))

sheet = Image.open(src).convert('RGB')
W, H = sheet.size
bx0, by0, bx1, by1 = round(box[0] * W), round(box[1] * H), round(box[2] * W), round(box[3] * H)
a = np.asarray(sheet).astype(np.int32)[by0:by1, bx0:bx1]
h, w = a.shape[:2]
edge = np.concatenate([a[:6].reshape(-1, 3), a[-6:].reshape(-1, 3), a[:, :6].reshape(-1, 3), a[:, -6:].reshape(-1, 3)])
key = np.median(edge, axis=0)
print('цвет фона', key)

for k, name in enumerate(NAMES):
    cx, cy = k % gx, k // gx
    x0, x1 = round(cx * w / gx), round((cx + 1) * w / gx)
    y0, y1 = round(cy * h / gy), round((cy + 1) * h / gy)
    y1 = y0 + round((y1 - y0) * TOP)
    cell = a[y0:y1, x0:x1]
    d = np.sqrt(((cell - key) ** 2).sum(axis=2))
    # фон: близкие к цвету фона области, связанные с краем клетки, и области с чистым цветом фона
    near = Image.fromarray(np.pad(np.where(d < FAR, 255, 0).astype(np.uint8), 1, constant_values=255)).copy()  # без copy заливка молча не работает
    ImageDraw.floodfill(near, (0, 0), 128)
    seeds = np.pad(d < SEED, 1)
    while True:
        filled = np.asarray(near) == 128
        left = np.argwhere(seeds & ~filled)
        if not len(left):
            break
        y, x = left[0]
        ImageDraw.floodfill(near, (int(x), int(y)), 128)
    bg = (np.asarray(near) == 128)[1:-1, 1:-1]
    alpha = np.full(d.shape, 255.0)
    ramp = np.clip((d - NEAR) / (FAR - NEAR), 0, 1) * 255
    alpha[bg] = ramp[bg]
    # зеленый отсвет фона убираем в полосе 10 точек вокруг фона
    band = bg.copy()
    for _ in range(10):
        band = band | np.roll(band, 1, 0) | np.roll(band, -1, 0) | np.roll(band, 1, 1) | np.roll(band, -1, 1)
    rgb = cell.copy()
    g = rgb[..., 1]
    rgb[..., 1] = np.where(band, np.minimum(g, np.maximum(rgb[..., 0], rgb[..., 2])), g)
    # у картинок без зеленого в рисунке оливковый отсвет (зеленый почти равен красному) уводим в теплый
    if name not in KEEP_GREEN:
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        olive = (g >= r - 5) & (g > b)
        rgb[..., 1] = np.where(olive, np.minimum(g, (0.8 * r + 0.2 * b).astype(np.int32)), g)
    rgba = np.dstack([rgb, alpha]).clip(0, 255).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    bb = im.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox()
    icon = im.crop(bb)
    side = max(icon.size)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.paste(icon, ((side - icon.size[0]) // 2, (side - icon.size[1]) // 2))
    square.resize((size, size), Image.LANCZOS).save(f'{out}/{name}.webp', 'WEBP', quality=90, method=6)
    print(name, bb, icon.size)
