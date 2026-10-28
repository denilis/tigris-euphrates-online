# Сборка макета экрана партии

1. Позиция из партии ботов (движок и бот из tigris-bot):
   node gen_position.mjs "<путь к tigris-bot>" position.json [seed]
2. Обрезка картинок (фото на белом фоне -> квадратные тайлы, круглые жетоны, монументы без фона):
   python -I prep_images.py ../../assets images.json
3. Сборка одного файла (UTF-8 с BOM, картинки внутри):
   python -I build.py template.html images.json position.json ../../specs/2026-10-28-макет-экрана-партии.html

images.json не храним (около 760 КБ), он пересобирается шагом 2.
