# Иконки главной (лист Дениса 04.11: 6 иконок сеткой 3 на 2 на зеленом хромакее).
# Прозрачным становится только зеленый фон, связанный с краями клетки листа: зеленый тайл рынка
# внутри иконки «Мои столы» остается. Кайма на границе полупрозрачная, без зеленого отсвета.
#   python tools/icons/cut.py <лист.jpg> <папка> [размер]
import sys
import numpy as np
from PIL import Image, ImageDraw

src, out = sys.argv[1], sys.argv[2]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 160
NAMES = ['start', 'tables', 'stats', 'rules', 'learn', 'codes']  # слева направо, сверху вниз
KEEP_GREEN = {'tables'}
NEAR, FAR, SEED = 70, 120, 40  # расстояние до цвета фона: ближе NEAR фон, дальше FAR предмет, между ними кайма

sheet = Image.open(src).convert('RGB')
W, H = sheet.size
a = np.asarray(sheet).astype(np.int32)
key = np.median(np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3), a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)]), axis=0)
print('цвет фона', key)

for k, name in enumerate(NAMES):
    cx, cy = k % 3, k // 3
    x0, x1 = round(cx * W / 3), round((cx + 1) * W / 3)
    y0, y1 = round(cy * H / 2), round((cy + 1) * H / 2)
    cell = a[y0:y1, x0:x1]
    d = np.sqrt(((cell - key) ** 2).sum(axis=2))
    # фон: близкие к зеленому области, где есть чистый цвет фона (d < SEED). Так прозрачнеют и
    # замкнутые куски фона (дырка в ручке светильника), а темно-зеленый тайл рынка остается
    near = Image.fromarray(np.where(d < FAR, 255, 0).astype(np.uint8)).copy()  # без copy заливка молча не работает
    seeds = d < SEED
    while True:
        filled = np.asarray(near) == 128
        left = np.argwhere(seeds & ~filled)
        if not len(left):
            break
        y, x = left[0]
        ImageDraw.floodfill(near, (int(x), int(y)), 128)
    bg = np.asarray(near) == 128
    alpha = np.full(d.shape, 255.0)
    ramp = np.clip((d - NEAR) / (FAR - NEAR), 0, 1) * 255
    alpha[bg] = ramp[bg]
    # зеленый отсвет фона убираем в полосе 10 точек вокруг фона (свечение ворот, край светильника)
    band = bg.copy()
    for _ in range(10):
        band = band | np.roll(band, 1, 0) | np.roll(band, -1, 0) | np.roll(band, 1, 1) | np.roll(band, -1, 1)
    rgb = cell.copy()
    g = rgb[..., 1]
    rgb[..., 1] = np.where(band, np.minimum(g, np.maximum(rgb[..., 0], rgb[..., 2])), g)
    # зеленый в рисунке есть только у «Моих столов» (тайл рынка): у остальных оливковый отсвет
    # (зеленый почти равен красному) уводим в теплый, как свечение в проеме ворот
    if name not in KEEP_GREEN:
        r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        olive = (g >= r - 5) & (g > b)
        rgb[..., 1] = np.where(olive, np.minimum(g, (0.8 * r + 0.2 * b).astype(np.int32)), g)
    rgba = np.dstack([rgb, alpha]).clip(0, 255).astype(np.uint8)
    im = Image.fromarray(rgba, 'RGBA')
    box = im.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox()
    icon = im.crop(box)
    side = max(icon.size)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.paste(icon, ((side - icon.size[0]) // 2, (side - icon.size[1]) // 2))
    square.resize((size, size), Image.LANCZOS).save(f'{out}/{name}.webp', 'WEBP', quality=90, method=6)
    print(name, box, icon.size)
