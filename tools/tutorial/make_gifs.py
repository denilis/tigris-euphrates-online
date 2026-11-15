"""Кадры сцен обучения в GIF и PNG.
  python tools/tutorial/make_gifs.py <папка кадров> <папка результата>
В результате: gif/<сцена>.gif (1280 на 720), png/<сцена>-NN.png (шаги сцены, 1600 на 900),
jpg/<сцена>-NN.jpg (те же шаги для PDF). Палитра общая на сцену: иначе кадры мерцают.
"""
import json
import os
import shutil
import sys

from PIL import Image

FADE_STEPS = 3
FADE_MS = 70
SIZE = (1280, 720)


def load(path):
    return Image.open(path).convert('RGB').resize(SIZE, Image.LANCZOS)


def timeline(scene_dir, frames):
    """Кадры и длительности: между шагами короткая смена планов, серия идёт как снята."""
    out = []
    prev = None
    for f in frames:
        im = load(os.path.join(scene_dir, f['file']))
        burst = '-' in f['file']
        if prev is not None and not burst and not prev[1]:
            for k in range(1, FADE_STEPS + 1):
                out.append((Image.blend(prev[0], im, k / (FADE_STEPS + 1)), FADE_MS))
        out.append((im, f['ms']))
        prev = (im, burst)
    return out


def make_gif(scene_dir, frames, path):
    seq = timeline(scene_dir, frames)
    # палитра по всем основным кадрам, склеенным в полосу
    picks = seq[:: max(1, len(seq) // 6)]
    strip = Image.new('RGB', (SIZE[0], SIZE[1] * len(picks)))
    for k, (im, _) in enumerate(picks):
        strip.paste(im, (0, k * SIZE[1]))
    pal = strip.quantize(colors=256, method=Image.MEDIANCUT, dither=Image.NONE)
    ims = [im.quantize(palette=pal, dither=Image.NONE) for im, _ in seq]
    ims[0].save(path, save_all=True, append_images=ims[1:], duration=[ms for _, ms in seq], loop=0, optimize=False, disposal=1)
    return os.path.getsize(path), len(seq)


def main():
    frames_dir, out_dir = sys.argv[1], sys.argv[2]
    for sub in ('gif', 'png', 'jpg'):
        os.makedirs(os.path.join(out_dir, sub), exist_ok=True)
    total = 0
    for name in sorted(os.listdir(frames_dir)):
        scene_dir = os.path.join(frames_dir, name)
        meta = json.load(open(os.path.join(scene_dir, 'frames.json'), encoding='utf8'))
        for f in meta['frames']:
            if '-' in f['file']:
                continue
            stem = f"{name}-{f['file'][:2]}"
            shutil.copyfile(os.path.join(scene_dir, f['file']), os.path.join(out_dir, 'png', stem + '.png'))
            Image.open(os.path.join(scene_dir, f['file'])).convert('RGB').save(os.path.join(out_dir, 'jpg', stem + '.jpg'), quality=84, optimize=True)
        size, n = make_gif(scene_dir, meta['frames'], os.path.join(out_dir, 'gif', name + '.gif'))
        total += size
        print(f'{name}: кадров {n}, {size / 1e6:.1f} МБ')
    print(f'всего GIF {total / 1e6:.1f} МБ')


main()
