// Замер громкости звуков сайта (08.11.2026, выравнивание по просьбе Дениса). Запускать в консоли
// браузера на странице сайта (локально: http://localhost:3019), результат: таблица по звукам.
//
//   maxM  - самое громкое место, окно 0,4 с с K-взвешиванием BS.1770 (как LUFS momentary, без калибровки
//           каналов: важна разница между звуками, а не абсолютное число); по нему выравнивается SFX_GAIN
//   avg   - средняя громкость слышимой части (окна громче -50)
//   peakDb - пик сигнала после усиления, выше -1 будет хрипеть
//
// Файлы и усиления берутся из public/js/signals.js; синтезированные звуки повторены здесь (tone с теми
// же частотами и громкостями, что в EVENT и chimeAt): при их правке поправить и здесь.
(async () => {
  const { SFX, SFX_GAIN } = await import('/js/signals.js?m=' + Date.now());
  const SR = 48000;
  async function measure(build, dur) {
    const len = Math.ceil((dur + 0.3) * SR);
    const raw = new OfflineAudioContext(2, len, SR), kw = new OfflineAudioContext(2, len, SR);
    build(raw, raw.destination);
    const hs = kw.createBiquadFilter(); hs.type = 'highshelf'; hs.frequency.value = 1681.97; hs.gain.value = 4;
    const hp = kw.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38.13; hp.Q.value = 0.5;
    hs.connect(hp).connect(kw.destination);
    build(kw, hs);
    const [a, b] = await Promise.all([raw.startRendering(), kw.startRendering()]);
    let peak = 0;
    for (let c = 0; c < a.numberOfChannels; c++) for (const x of a.getChannelData(c)) peak = Math.max(peak, Math.abs(x));
    const ch = [b.getChannelData(0), b.getChannelData(1)];
    const W = Math.round(0.4 * SR), S = Math.round(0.1 * SR);
    let best = -Infinity, sumE = 0, n = 0;
    for (let i = 0; i + W <= ch[0].length; i += S) {
      let e = 0;
      for (const d of ch) for (let j = i; j < i + W; j++) e += d[j] * d[j];
      e /= W * 2;
      const l = -0.691 + 10 * Math.log10(e + 1e-12);
      best = Math.max(best, l);
      if (l > -50) { sumE += e; n++; }
    }
    return { maxM: +best.toFixed(1), avg: n ? +(-0.691 + 10 * Math.log10(sumE / n)).toFixed(1) : null, peakDb: +(20 * Math.log10(peak)).toFixed(1) };
  }
  const out = {};
  const dec = new OfflineAudioContext(1, 1, SR);
  // у звука может быть несколько вариантов (победа в восстании, 14.11): меряется каждый, строка «имя #N»
  const files = Object.entries(SFX).flatMap(([name, urls]) => [].concat(urls).map((url, i, all) => [name, url, all.length > 1 ? `${name} #${i + 1}` : name]));
  for (const [name, url, row] of files) {
    const buf = await dec.decodeAudioData(await (await fetch(url + '?m=' + Date.now())).arrayBuffer());
    // слышимая часть, как в loadSfx
    const d0 = buf.getChannelData(0);
    let s = 0, z = d0.length - 1;
    while (s < d0.length && Math.abs(d0[s]) < 0.01) s++;
    while (z > s && Math.abs(d0[z]) < 0.01) z--;
    const from = s / buf.sampleRate, to = Math.min(buf.duration, z / buf.sampleRate + 0.25);
    out[row] = {
      gain: SFX_GAIN[name], sec: +(to - from).toFixed(2),
      ...(await measure((ctx, dst) => {
        const src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = buf; g.gain.value = SFX_GAIN[name];
        src.connect(g).connect(dst); src.start(0, from, to - from);
      }, to - from)),
    };
  }
  function tone(ctx, dst, freq, at, dur, gain, type = 'sine', to = null) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to, at + dur);
    g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(gain, at + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dst); o.start(at); o.stop(at + dur + 0.02);
  }
  const SYN = {
    battle: [(c, d) => { tone(c, d, 130, 0, 0.22, 0.26, 'sine', 48); tone(c, d, 120, 0.26, 0.26, 0.24, 'sine', 42); }, 0.6],
    treasure: [(c, d) => { tone(c, d, 2093, 0, 0.12, 0.21); tone(c, d, 2637, 0.07, 0.2, 0.18); }, 0.3],
    arrive: [(c, d) => { tone(c, d, 659, 0, 0.18, 0.26); tone(c, d, 880, 0.14, 0.3, 0.26); }, 0.45],
    chime: [(c, d) => {
      [523, 659, 784].forEach((f, i) => { tone(c, d, f, i * 0.11, 0.3, 0.23); tone(c, d, f * 2, i * 0.11, 0.2, 0.06, 'triangle'); });
      tone(c, d, 1047, 0.33, 0.7, 0.25); tone(c, d, 2094, 0.33, 0.4, 0.06, 'triangle');
    }, 1.05],
  };
  for (const [name, [fn, dur]] of Object.entries(SYN)) out[name] = { gain: 'синтез', sec: dur, ...(await measure(fn, dur)) };
  console.table(out);
  return out;
})();
