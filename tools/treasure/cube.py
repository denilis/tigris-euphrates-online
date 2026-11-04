# Кубик сокровища для поля (картинка Дениса 04.11, белый деревянный кубик на зеленом фоне):
# зеленый фон и тень на нем становятся прозрачными, зеленая кайма на краях убирается,
# кубик обрезается по краю и сохраняется квадратом в WebP с прозрачностью.
#   python tools/treasure/cube.py <исходник.jpg> <выход.webp> [размер]
import sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 96

im = Image.open(src).convert('RGB')
w, h = im.size
px = im.load()
rgba = Image.new('RGBA', (w, h))
dst = rgba.load()
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        green = g - max(r, b)  # насколько пиксель зеленее остальных каналов: фон и тень сильно, кубик почти нет
        a = 255 if green <= 12 else 0 if green >= 40 else round(255 * (40 - green) / 28)
        if a < 255:
            g = min(g, max(r, b))  # кайма: убрать зеленый отсвет фона
        dst[x, y] = (r, g, b, a)

box = rgba.getchannel('A').point(lambda v: 255 if v > 128 else 0).getbbox()
cube = rgba.crop(box)
side = max(cube.size)
square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
square.paste(cube, ((side - cube.size[0]) // 2, (side - cube.size[1]) // 2))
square.resize((size, size), Image.LANCZOS).save(out, 'WEBP', quality=90, method=6)
print('кубик', box, 'в', out, size)
