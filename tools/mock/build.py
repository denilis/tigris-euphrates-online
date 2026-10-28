import json, sys
tpl, img, pos, out = sys.argv[1:5]
s = open(tpl, encoding='utf-8').read()
s = s.replace('/*IMAGES*/', open(img, encoding='utf-8').read()).replace('/*POSITION*/', open(pos, encoding='utf-8').read())
open(out, 'w', encoding='utf-8-sig').write(s)
print(len(s.encode('utf-8')) // 1024, 'КБ')
