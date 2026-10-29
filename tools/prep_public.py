# Картинки для клиента файлами в public/img: тайлы квадратом, жетоны героев кругом
# с прозрачностью (один рисунок на 4 цвета, см. tools/mock/recolor_tokens.py), заставка
# входа и лобби (панорама Месопотамии из старого сайта), сжатая для телефона.
#   python -I tools/prep_public.py
import os
import sys
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'assets')
DST = os.path.join(ROOT, 'public', 'img')


def bbox_nonwhite(im, thr=28):
    diff = ImageChops.difference(im, Image.new('RGB', im.size, (255, 255, 255))).convert('L')
    return diff.point(lambda v: 255 if v > thr else 0).filter(ImageFilter.MedianFilter(5)).getbbox()


def bbox_wood(im):
    # диск жетона: насыщенные тёплые пиксели дерева; белый фон и серая тень отпадают
    sat = im.convert('HSV').getchannel('S').point(lambda v: 255 if v > 38 else 0).filter(ImageFilter.MedianFilter(9))
    return sat.getbbox()


def square(box):
    l, t, r, b = box
    s = max(r - l, b - t)
    cx, cy = (l + r) / 2, (t + b) / 2
    return (int(cx - s / 2), int(cy - s / 2), int(cx + s / 2), int(cy + s / 2))


os.makedirs(os.path.join(DST, 'tiles'), exist_ok=True)
os.makedirs(os.path.join(DST, 'tokens'), exist_ok=True)
sizes = {}

for name in ['temple', 'farm', 'market', 'settlement', 'catastrophe']:
    im = Image.open(os.path.join(SRC, 'tiles', f'{name}.jpg')).convert('RGB')
    l, t, r, b = square(bbox_nonwhite(im))
    k = int((r - l) * 0.035)  # срезаем светлый кант плитки
    out = os.path.join(DST, 'tiles', f'{name}.jpg')
    im.crop((l + k, t + k, r - k, b - k)).resize((128, 128), Image.LANCZOS).save(out, 'JPEG', quality=84, optimize=True)
    sizes[out] = os.path.getsize(out)

for hero in ['lion', 'bull', 'bow', 'pot']:
    for color in ['red', 'blue', 'green', 'black']:
        im = Image.open(os.path.join(SRC, 'tokens', f'{hero}_{color}.jpg')).convert('RGB')
        im = im.crop(square(bbox_wood(im))).resize((112, 112), Image.LANCZOS).convert('RGBA')
        mask = Image.new('L', (448, 448), 0)
        ImageDraw.Draw(mask).ellipse((6, 6, 442, 442), fill=255)
        im.putalpha(mask.resize((112, 112), Image.LANCZOS))
        out = os.path.join(DST, 'tokens', f'{hero}_{color}.png')
        im.save(out, 'PNG', optimize=True)
        sizes[out] = os.path.getsize(out)

bg = Image.open(os.path.join(SRC, 'lobby-bg.jpg')).convert('RGB')
w = 1600
bg = bg.resize((w, round(bg.height * w / bg.width)), Image.LANCZOS)
out = os.path.join(DST, 'lobby-bg.jpg')
bg.save(out, 'JPEG', quality=72, optimize=True, progressive=True)
sizes[out] = os.path.getsize(out)

total = sum(sizes.values())
print(f'файлов {len(sizes)}, всего {total // 1024} КБ, заставка {sizes[out] // 1024} КБ', file=sys.stderr)
