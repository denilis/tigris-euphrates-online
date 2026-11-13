# Эталон для test/qr.test.js: матрицы библиотеки segno (уровень M, байтовый режим, без ECI).
# Запуск: python tools/qr-fixture.py test/fixtures/qr.json (нужен пакет segno, проверено на 1.6.6).
#
# Одна поправка к segno: после завершающих четырех нулей она дописывает нули до границы байта так,
# что при уже ровной границе добавляет лишний нулевой байт (8 - длина % 8 дает 8, а не 0). Сканеры
# этого не замечают: все, что после завершения, они не читают. Стандарт (ISO/IEC 18004, 7.4.10) в
# таком случае нулей не добавляет, и наш генератор тоже, поэтому здесь функция заменена на точную.
import json
import sys

import segno
from segno import consts, encoder


def padding_bits(buff, version, length):
    if version not in (consts.VERSION_M1, consts.VERSION_M3):
        buff.extend([0] * ((8 - length % 8) % 8))


encoder.write_padding_bits = padding_bits

TOKEN = 'AbC_dE-fGh1234567890xy'
# 'all': все восемь масок, 'one': одна маска (файл не раздувается)
CASES = [
    ('A', 'all'),
    ('tigris-euphrates 20b', 'one'),
    ('x' * 40, 'one'),
    ('https://site.app/#/join/' + 'q' * 36, 'one'),
    ('https://tigris-euphrates-online.vercel.app/#/join/' + TOKEN, 'all'),
    ('y' * 100, 'one'),
    ('Version seven carries the version information blocks: ' + 'z' * 66, 'all'),
    ('8' * 150, 'one'),
    ('nine ' * 35, 'one'),
    ('Ten uses a sixteen bit length field. ' + 'w' * 173, 'all'),
    ('Тигр и Евфрат: приглашение', 'one'),
]


def make(text, **kw):
    return segno.make(text, error='m', micro=False, boost_error=False, mode='byte', encoding='utf-8', **kw)


out = []
for i, (text, how) in enumerate(CASES):
    auto = make(text)
    version = auto.version
    mats = {}
    for m in (range(8) if how == 'all' else [i % 8]):
        q = make(text, version=version, mask=m)
        assert q.version == version and q.mask == m and q.error == 'M'
        mats[str(m)] = [''.join('1' if v else '0' for v in row) for row in q.matrix]
    out.append({'text': text, 'bytes': len(text.encode('utf-8')), 'version': version, 'auto': auto.mask, 'masks': mats})
    print(i, 'version', version, 'bytes', len(text.encode('utf-8')), 'auto mask', auto.mask)

with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump({'made': 'segno ' + segno.__version__ + ', error M, byte mode, padding per ISO 7.4.10', 'cases': out}, f, ensure_ascii=False, separators=(',', ':'))
print('ok')
