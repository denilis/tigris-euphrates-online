# Один рисунок героя на все 4 цвета: жетон {герой}_black перекрашивается
# в красный, синий и зелёный. Цвет чернил берётся с жетонов быка (у них
# рисунок одинаковый во всех цветах). Оригиналы остаются в git.
#   python -I recolor_tokens.py <assets dir> lion bow pot
import sys
import numpy as np
from PIL import Image

src, heroes = sys.argv[1], sys.argv[2:]
COLORS = ['red', 'blue', 'green']


def lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def ink_color(path):
    a = np.asarray(Image.open(path).convert('RGB'), dtype=np.float32)
    L = lum(a)
    sat = a.max(axis=2) - a.min(axis=2)
    m = (L < 120) & (sat > 40)  # насыщенные тёмные пиксели = чернила
    return np.median(a[m], axis=0)


ink = {c: ink_color(f'{src}/tokens/bull_{c}.jpg') for c in COLORS}
print({c: [int(v) for v in ink[c]] for c in COLORS})

for hero in heroes:
    a = np.asarray(Image.open(f'{src}/tokens/{hero}_black.jpg').convert('RGB'), dtype=np.float32)
    L = lum(a)
    t = np.clip((150.0 - L) / 95.0, 0, 1)[..., None]  # 0 на дереве и фоне, 1 на чёрных чернилах
    for c in COLORS:
        # тень чернил сохраняем: светлее чернила дают светлее цвет
        shade = np.clip(1.0 + (L[..., None] - 40.0) / 255.0, 0.85, 1.25)
        target = np.clip(ink[c] * shade, 0, 255)
        out = a * (1 - t) + target * t
        Image.fromarray(out.astype(np.uint8)).save(f'{src}/tokens/{hero}_{c}.jpg', quality=92)
    print(hero, 'готово')
