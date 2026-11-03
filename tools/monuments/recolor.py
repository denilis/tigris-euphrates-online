# Монументы для сайта (выбор Дениса 03.11, картинки ChatGPT красно-синие): вырезать плитку из
# фона, сделать углы прозрачными и перекрасить красную половину и синюю на 6 пар цветов.
# Запуск из папки сайта:
#   python -I tools/monuments/recolor.py specs/2026-11-03-монумент public/img/monuments
# Нужны numpy, Pillow (с WebP) и matplotlib. Рядом с картинками кладется sheet.png для проверки глазом.
import sys, os
import numpy as np
from PIL import Image, ImageDraw
from matplotlib.colors import rgb_to_hsv, hsv_to_rgb

src, dst = sys.argv[1], sys.argv[2]
SIZE = 512
KEY = ['red', 'blue', 'green', 'black']
PAIRS = [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)]
# style: файл, порог насыщенности для поиска плитки, область, где синий не трогаем (небо в картинке)
# red: центр, полное и нулевое расстояние по оттенку (золото рядом, у эмали окно уже)
STYLES = {
    'enamel': ('монумент-1-печать.jpg', 0.2, None, (5, 9, 16)),
    'frame': ('монумент-2-рамка.jpg', 0.06, (0.22, 0.17, 0.78, 0.82), (12, 12, 22)),
    'ziggurat': ('монумент-3-зиккурат.jpg', 0.06, None, (8, 12, 22)),
}


def bbox(im, sth):
    s = rgb_to_hsv(im)[..., 1]
    m = s > sth
    xs, ys = np.where(m.mean(axis=0) > 0.5)[0], np.where(m.mean(axis=1) > 0.5)[0]
    return xs.min(), ys.min(), xs.max(), ys.max()


def ramp(x, a, b):
    return np.clip((x - a) / (b - a), 0, 1)


def hue_w(h, center, full, fade):
    d = np.abs(((h - center + 180) % 360) - 180)
    return 1 - ramp(d, full, fade)


def recolor(rgb, w, src_hsv, dst_hsv):
    hsv = rgb_to_hsv(rgb)
    h, s, v = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    th, ts, tv = dst_hsv
    sh, ss, sv = src_hsv
    nh = (th + (h - sh) * 0.25) % 360
    ns = np.clip(s * ts / ss, 0, 1)
    nv = np.clip(v * tv / sv, 0, 1)
    out = hsv_to_rgb(np.stack([nh / 360, ns, nv], axis=-1))
    return rgb * (1 - w[..., None]) + out * w[..., None]


def rounded_mask(size, r):
    big = Image.new('L', (size * 4, size * 4), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, size * 4 - 1, size * 4 - 1), radius=r * 4, fill=255)
    return big.resize((size, size), Image.LANCZOS)


os.makedirs(dst, exist_ok=True)
sheet = Image.new('RGB', (SIZE // 2 * 6 + 50, SIZE // 2 * 3 + 20), (30, 26, 22))
for row, (style, (fname, sth, keep, rw)) in enumerate(STYLES.items()):
    im = np.asarray(Image.open(os.path.join(src, fname)).convert('RGB')).astype(float) / 255
    x0, y0, x1, y1 = bbox(im, sth)
    inset = int(0.006 * (x1 - x0))  # срезать край с тенью и фоном
    tile = Image.fromarray((im * 255).astype(np.uint8)).crop((x0 + inset, y0 + inset, x1 - inset + 1, y1 - inset + 1)).resize((SIZE, SIZE), Image.LANCZOS)
    rgb = np.asarray(tile).astype(float) / 255
    hsv = rgb_to_hsv(rgb)
    h, s, v = hsv[..., 0] * 360, hsv[..., 1], hsv[..., 2]
    sat = ramp(s, 0.22, 0.38)
    w_red = hue_w(h, *rw) * sat * ramp(v, 0.08, 0.16)
    w_blue = hue_w(h, 206, 22, 34) * ramp(s, 0.28, 0.42) * (1 - ramp(v, 0.78, 0.86))
    if keep:
        yy, xx = np.mgrid[0:SIZE, 0:SIZE] / SIZE
        inside = (xx > keep[0]) & (xx < keep[2]) & (yy > keep[1]) & (yy < keep[3])
        w_blue = w_blue * ~inside
        w_red = w_red * ~inside
    med = lambda w: (np.median(h[w > 0.8]), np.median(s[w > 0.8]), np.median(v[w > 0.8]))
    red_ref, blue_ref = med(w_red), med(w_blue)
    # цели: синий и красный как на исходнике, зеленый в той же насыщенности и яркости, черный глянцевый
    target = {
        0: red_ref,
        1: blue_ref,
        2: (132, (red_ref[1] + blue_ref[1]) / 2, (red_ref[2] + blue_ref[2]) / 2 * 1.05),
        3: (30, 0.07, 0.19),
    }
    print(style, 'red', np.round(red_ref, 2), 'blue', np.round(blue_ref, 2))
    mask = rounded_mask(SIZE, int(SIZE * 0.045))
    for col, (c1, c2) in enumerate(PAIRS):
        out = rgb
        if c1 != 0: out = recolor(out, w_red, red_ref, target[c1])
        if c2 != 1: out = recolor(out, w_blue, blue_ref, target[c2])
        img = Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)).convert('RGBA')
        img.putalpha(mask)
        os.makedirs(os.path.join(dst, style), exist_ok=True)
        img.save(os.path.join(dst, style, f'{KEY[c1]}-{KEY[c2]}.webp'), 'WEBP', quality=88, method=6)
        sheet.paste(img.resize((SIZE // 2, SIZE // 2), Image.LANCZOS), (col * (SIZE // 2 + 10), row * (SIZE // 2 + 10)), img.resize((SIZE // 2, SIZE // 2), Image.LANCZOS))
sheet.save(os.path.join(dst, 'sheet.png'))
print('ok')
