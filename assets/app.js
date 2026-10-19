(function () {
  'use strict';

  const VERSION = 'v1.5', VERSION_DATE = '2026-10-19';   // bump on every upload
  const REMOTE_TIDE = 'https://tomicahuang.github.io/fishing-weather/data/tide-data.js';
  const COUNTER_URL = 'https://abacus.jasoncameron.dev';
  const COUNTER_KEY = 'tomicahuang-fishing-weather/views';
  const DAYS = 14;
  const FISH_FIRST = 4;   // earliest hour a fishing window may start
  const FISH_LAST = 20;   // last hour (20:00-21:00) a window may cover
  const WIN = 3;          // hours in a recommended window
  const BASE = 66;
  const H = 3600e3, D = 86400e3;

  const SPOTS = [
    // wf = how much of the open-sea wave penalty applies at the spot
    { key: 'bx', name: '彰濱八仙', short: '八仙', lat: 24.07, lon: 120.40, tide: '鹿港', tideId: 'T000702', wg: 218505, wgName: '彰濱', boat: true, shore: false, wf: 1, fish: '黑鯛', windPref: 'north', color: '#2747d8' },
    { key: 'jh', name: '雲林金湖', short: '金湖', lat: 23.58, lon: 120.14, tide: '口湖', tideId: 'T000919', wg: 463753, wgName: '台子港', boat: true, shore: false, wf: 1, fish: '黑鯛', windPref: null, color: '#2e7d32' },
    { key: 'bd', name: '布袋南港內', short: '布袋', lat: 23.37, lon: 120.15, tide: '布袋', tideId: 'T001003', wg: 462280, wgName: '布袋港', boat: false, shore: false, wf: 0.35, fish: '黑鯛', windPref: null, color: '#c0503a' },
    { key: 'qg', name: '七股西寮', short: '七股', lat: 23.117, lon: 120.045, tide: '七股', tideId: 'T700015', wg: 286920, wgName: '七股、西寮', boat: false, shore: true, wf: 0.6, fish: '', windPref: null, color: '#8e44ad' },
    { key: 'ap', name: '安平港', short: '安平', lat: 22.988, lon: 120.140, tide: '安平', tideId: 'T700036', wg: 744527, wgName: '安平港', boat: false, shore: true, wf: 0.4, fish: '', windPref: null, color: '#0e7490' }
  ];
  const fishOf = sp => sp.fish || '魚';
  const kindOf = sp => sp.shore ? '岸釣' : '船釣・黑鯛';
  const SPOT = Object.fromEntries(SPOTS.map(s => [s.key, s]));

  const state = {
    settings: loadSettings(),
    tide: window.TIDE_DATA || null,
    wx: loadCache(),
    model: null,
    best: null,
    sel: { spot: 'bx', date: null },
    error: ''
  };

  // ------------------------------------------------------------------ helpers
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');
  const WK = '日一二三四五六';
  const nowL = () => Date.now() + 8 * H;              // Taipei wall clock stored as UTC ms
  function parseL(s) {
    const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
    return Date.UTC(+m[1], m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0);
  }
  const dkey = ms => new Date(ms).toISOString().slice(0, 10);
  const hm = ms => { const d = new Date(ms); return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()); };
  function dlabel(date) { const d = new Date(parseL(date)); return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' (' + WK[d.getUTCDay()] + ')'; }
  const isWeekend = date => { const w = new Date(parseL(date)).getUTCDay(); return w === 0 || w === 6; };
  const fmt1 = v => v == null ? '—' : (Math.round(v * 10) / 10).toFixed(1);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  const nn = a => a.filter(v => v != null && !Number.isNaN(v));

  function loadSettings() {
    const all = SPOTS.map(s => s.key);
    const def = { mode: 'simple', spots: all, known: all };
    try {
      const s = JSON.parse(localStorage.getItem('fw-settings') || '{}');
      // spots added after the user last saved start out checked
      const known = Array.isArray(s.known) ? s.known : ['bx', 'jh', 'bd'];
      const spots = Array.isArray(s.spots) ? all.filter(k => s.spots.includes(k) || !known.includes(k)) : all;
      return { mode: s.mode || def.mode, spots: spots.length ? spots : all, known: all };
    } catch (e) { return def; }
  }
  const shown = () => state.model.filter(m => state.settings.spots.includes(m.spot.key));
  function saveSettings() { try { localStorage.setItem('fw-settings', JSON.stringify(state.settings)); } catch (e) { } }
  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem('fw-wx') || 'null');
      return c && c.fc && c.fc.length === SPOTS.length ? c : null;
    } catch (e) { return null; }
  }
  function saveCache() { try { localStorage.setItem('fw-wx', JSON.stringify(state.wx)); } catch (e) { } }

  const BF = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5, 28.5, 32.7];
  function beaufort(ms) { if (ms == null) return null; let b = 0; while (b < BF.length && ms >= BF[b]) b++; return b; }
  const DIRS = ['北', '北北東', '東北', '東北東', '東', '東南東', '東南', '南南東', '南', '南南西', '西南', '西南西', '西', '西北西', '西北', '北北西'];
  const dirName = deg => deg == null ? '—' : DIRS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16] + '風';
  const arrow = deg => deg == null ? '' : `<span class="arrow" style="transform:rotate(${Math.round(deg)}deg)" title="${dirName(deg)}">↓</span>`;
  function angIn(a, from, to) { a = ((a % 360) + 360) % 360; return from <= to ? (a >= from && a <= to) : (a >= from || a <= to); }
  function windSector(deg) { if (deg == null) return ''; if (angIn(deg, 300, 60)) return 'north'; if (angIn(deg, 120, 240)) return 'south'; return 'side'; }

  function wxIcon(code) {
    if (code == null) return ['', '—'];
    if (code === 0) return ['☀️', '晴'];
    if (code <= 2) return ['🌤️', '晴時多雲'];
    if (code === 3) return ['☁️', '陰'];
    if (code === 45 || code === 48) return ['🌫️', '霧'];
    if (code >= 51 && code <= 57) return ['🌦️', '毛毛雨'];
    if (code >= 61 && code <= 67) return ['🌧️', code >= 65 ? '大雨' : '雨'];
    if (code >= 80 && code <= 82) return ['🌦️', code === 82 ? '大陣雨' : '陣雨'];
    if (code >= 95) return ['⛈️', '雷雨'];
    if (code >= 71 && code <= 86) return ['🌨️', '雪'];
    return ['☁️', '多雲'];
  }
  function moonIcon(lunarDay) {
    const d = lunarDay;
    if (!d) return '';
    if (d === 1 || d >= 30) return '🌑';
    if (d <= 6) return '🌒';
    if (d <= 9) return '🌓';
    if (d <= 13) return '🌔';
    if (d <= 16) return '🌕';
    if (d <= 21) return '🌖';
    if (d <= 24) return '🌗';
    return '🌘';
  }
  const RANGE_TXT = { big: '大潮', mid: '中潮', small: '小潮' };
  function rating(score) {
    if (score == null) return { cls: 'r0', txt: '—' };
    if (score >= 75) return { cls: 'r4', txt: '適合' };
    if (score >= 60) return { cls: 'r3', txt: '尚可' };
    if (score >= 45) return { cls: 'r2', txt: '勉強' };
    return { cls: 'r1', txt: '不適合' };
  }
  const RCOL = { r4: '#2f8a4f', r3: '#a8961e', r2: '#c8693a', r1: '#c0392b', r0: '#94a3b8' };
  const knots = ms => ms == null ? null : Math.round(ms * 1.944);
  const isNarrow = () => window.innerWidth < 700;

  // ------------------------------------------------------------------ data loading
  async function getJson(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }
  const asArr = x => Array.isArray(x) ? x : [x];

  async function fetchWeather() {
    const lat = SPOTS.map(s => s.lat).join(','), lon = SPOTS.map(s => s.lon).join(',');
    const common = `latitude=${lat}&longitude=${lon}&timezone=Asia%2FTaipei&past_days=1&forecast_days=16`;
    const fcUrl = 'https://api.open-meteo.com/v1/forecast?' + common +
      '&hourly=temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,pressure_msl' +
      '&daily=sunrise,sunset,weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,uv_index_max&wind_speed_unit=ms';
    const mrUrl = 'https://marine-api.open-meteo.com/v1/marine?' + common + '&cell_selection=sea' +
      '&hourly=wave_height,wave_direction,wave_period,sea_surface_temperature,sea_level_height_msl';
    const [fc, mr] = await Promise.all([getJson(fcUrl), getJson(mrUrl).catch(() => null)]);
    return { fetched: Date.now(), fc: asArr(fc), mr: mr ? asArr(mr) : null };
  }

  function loadScript(src) {
    return new Promise(res => {
      const prev = window.TIDE_DATA;
      window.TIDE_DATA = undefined;
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => { const got = window.TIDE_DATA; window.TIDE_DATA = prev; el.remove(); res(got || null); };
      el.onerror = () => { window.TIDE_DATA = prev; el.remove(); res(null); };
      document.head.appendChild(el);
    });
  }
  function tideEnd(t) { let e = ''; if (t && t.spots) for (const k in t.spots) { const d = t.spots[k].days; if (d.length && d[d.length - 1].date > e) e = d[d.length - 1].date; } return e; }
  async function reloadTide() {
    const stamp = '?t=' + Date.now();
    const list = [loadScript('data/tide-data.js' + stamp)];
    if (!/github\.io$/.test(location.hostname)) list.push(loadScript(REMOTE_TIDE + stamp));
    const got = (await Promise.all(list)).filter(Boolean);
    if (state.tide) got.push(state.tide);
    const nSpots = t => SPOTS.filter(s => t.spots && t.spots[s.key]).length;
    got.sort((a, b) => nSpots(b) - nSpots(a) || (b.updated || '').localeCompare(a.updated || ''));
    if (got.length) state.tide = got[0];
  }

  // ------------------------------------------------------------------ tide curve
  function cwaEvents(key) {
    const t = state.tide && state.tide.spots && state.tide.spots[key];
    const ev = [], days = {};
    if (!t) return { ev, days };
    for (const d of t.days) {
      days[d.date] = { lunar: d.lunar, range: d.range, src: 'cwa' };
      for (const e of d.events) ev.push({ t: parseL(d.date + 'T' + e.time.padStart(5, '0')), type: e.type, msl: e.msl, chart: e.chart, src: 'cwa' });
    }
    ev.sort((a, b) => a.t - b.t);
    return { ev, days };
  }

  function modelEvents(mr) {
    if (!mr || !mr.hourly || !mr.hourly.sea_level_height_msl) return [];
    const v = mr.hourly.sea_level_height_msl, tm = mr.hourly.time, out = [];
    for (let i = 1; i < v.length - 1; i++) {
      const a = v[i - 1], b = v[i], c = v[i + 1];
      if (a == null || b == null || c == null) continue;
      const isMax = b >= a && b > c, isMin = b <= a && b < c;
      if (!isMax && !isMin) continue;
      const den = a - 2 * b + c;
      const off = den ? clamp(0.5 * (a - c) / den, -0.5, 0.5) : 0;
      out.push({ t: parseL(tm[i]) + off * H, type: isMax ? 'H' : 'L', msl: Math.round((b - 0.25 * (a - c) * off) * 100), chart: null, src: 'model' });
    }
    return out;
  }

  function buildEvents(key, mr) {
    const { ev, days } = cwaEvents(key);
    let model = modelEvents(mr);
    if (ev.length && model.length) {
      const first = ev[0].t, last = ev[ev.length - 1].t;
      const overlap = model.filter(e => e.t > first && e.t < last);
      const cAbs = mean(ev.filter(e => overlap.length && e.t >= overlap[0].t && e.t <= overlap[overlap.length - 1].t).map(e => Math.abs(e.msl)));
      const mAbs = mean(overlap.map(e => Math.abs(e.msl)));
      const k = cAbs && mAbs ? cAbs / mAbs : 1;
      model = model.filter(e => e.t < first - 3 * H || e.t > last + 3 * H).map(e => ({ ...e, msl: Math.round(e.msl * k) }));
    }
    const all = ev.concat(model).sort((a, b) => a.t - b.t);
    return { events: all, cwaDays: days };
  }

  function tideAt(events, t) {
    let lo = 0, hi = events.length - 1;
    if (hi < 1 || t < events[0].t || t > events[hi].t) return null;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (events[m].t <= t) lo = m; else hi = m; }
    const a = events[lo], b = events[hi];
    const f = (t - a.t) / (b.t - a.t);
    return { h: a.msl + (b.msl - a.msl) * (1 - Math.cos(Math.PI * f)) / 2, rising: b.msl > a.msl, f, prev: a, next: b };
  }

  const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14) + 8 * H;
  function calcLunar(date) {
    const age = (((parseL(date) + 12 * H - NEW_MOON) / D) % 29.530588 + 29.530588) % 29.530588;
    const ld = Math.floor(age) + 1;
    const range = [29, 30, 1, 2, 3, 14, 15, 16, 17, 18].includes(ld) ? 'big' : [7, 8, 9, 10, 22, 23, 24, 25].includes(ld) ? 'small' : 'mid';
    return { lunar: '約' + ld + '日', lunarDay: ld, range, src: 'calc' };
  }

  // ------------------------------------------------------------------ scoring (black sea bream)
  function evalHour(spot, x, sun) {
    const c = {};
    const ws = x.ws;
    c.wind = ws == null ? 0 : ws <= 3.3 ? 4 : ws <= 5.4 ? 0 : ws <= 7.9 ? -10 : ws <= 10.7 ? -25 : ws <= 13.8 ? -45 : -70;
    c.gust = x.wg == null ? 0 : x.wg >= 13.9 ? -12 : x.wg >= 10.8 ? -5 : 0;
    c.dir = 0;
    if (spot.windPref === 'north' && ws != null && ws >= 1.5) {
      const sec = windSector(x.wd);
      c.dir = sec === 'north' ? 8 : sec === 'south' ? -18 : 0;
    }
    const wf = spot.wf;
    c.wave = x.wave == null ? 0 : Math.round(wf * (x.wave <= 0.3 ? 2 : x.wave <= 0.6 ? 0 : x.wave <= 1.0 ? -6 : x.wave <= 1.5 ? -15 : x.wave <= 2.0 ? -28 : -45));
    const thunder = x.code != null && x.code >= 95;
    c.rain = thunder ? -40 : x.pr >= 10 ? -35 : x.pr >= 4 ? -20 : x.pr >= 1 ? -10 : (x.pr >= 0.2 || x.pp >= 60) ? -3 : 0;
    c.tide = 0;
    if (x.tide) {
      const f = x.tide.f;
      c.tide = x.tide.rising ? (f < 0.12 ? -3 : f <= 0.85 ? 10 : 5) : (f < 0.18 ? 5 : f <= 0.6 ? 3 : -3);
    }
    const s = x.sst, bream = spot.fish === '黑鯛';
    if (bream) c.sst = s == null ? 0 : s < 13 ? -30 : s < 15 ? -20 : s < 17 ? -10 : s < 19 ? 3 : s < 24 ? 8 : s < 26 ? 4 : s < 27 ? 0 : s < 28 ? -5 : s < 29 ? -10 : -15;
    else c.sst = s == null ? 0 : s < 14 ? -15 : s < 17 ? -6 : s <= 27 ? 0 : s <= 29 ? -3 : -6;
    const ds = x.dsst24;
    c.dsst = ds == null ? 0 : ds <= -1.5 ? (bream ? -10 : -5) : ds <= -0.8 ? (bream ? -5 : -2) : bream && ds >= 0.8 && s != null && s < 20 ? 3 : 0;
    c.light = 0;
    if (sun) {
      const t = x.t + H / 2;
      if ((t >= sun.rise - H && t <= sun.rise + 2 * H) || (t >= sun.set - 2 * H && t <= sun.set + H / 2)) c.light = 5;
      else if (t < sun.rise - H || t > sun.set + H) c.light = -5;
    }
    c.pres = x.dp24 == null ? 0 : x.dp24 <= -4 ? 3 : x.dp24 >= 5 ? -8 : x.dp24 >= 3 ? -3 : 0;
    c.vis = x.vis == null ? 0 : x.vis < 1000 ? -12 : x.vis < 3000 ? -4 : 0;
    c.temp = x.temp == null ? 0 : x.temp >= 34 ? -4 : x.temp <= 10 ? -6 : 0;
    let score = BASE;
    for (const k in c) score += c[k];
    return { score, c, thunder };
  }

  // small tide = gentle current, easiest for black sea bream; big tide runs too fast
  const RANGE_BONUS = { small: 6, mid: 0, big: -6 };

  function tideText(hours) {
    const r = hours.filter(x => x.tide).map(x => x.tide.rising);
    if (!r.length) return { txt: '', short: '' };
    const allUp = r.every(Boolean), allDown = r.every(v => !v);
    let txt, short;
    if (allUp) { txt = '釣漲潮'; short = '漲'; }
    else if (allDown) { txt = '釣退潮'; short = '退'; }
    else if (r[0]) { txt = '釣滿潮前後（漲轉退）'; short = '滿'; }
    else { txt = '釣乾潮前後（退轉漲）'; short = '乾'; }
    const t0 = hours[0].t, t1 = hours[hours.length - 1].t + H;
    const ex = hours.map(x => x.tide && x.tide.next).filter(e => e && e.t >= t0 && e.t <= t1 + 1.5 * H);
    if (ex.length) { const e = ex[0]; txt += `，${e.type === 'H' ? '滿潮' : '乾潮'} ${hm(e.t)}`; }
    return { txt, short };
  }

  const BLOCK_HOURS = { bx: 3, jh: 1 };   // hours either side of low tide the boat can't launch
  const blockHours = spot => spot.boat ? BLOCK_HOURS[spot.key] || 0 : 0;
  function lowBlocked(events, a, b, hrs) {
    return hrs > 0 && events.some(e => e.type === 'L' && e.t - hrs * H < b && e.t + hrs * H > a);
  }
  function waterRanges(events, t0, hrs) {
    const out = [];
    let start = t0;
    const blocks = events.filter(e => e.type === 'L' && hrs > 0 && e.t + hrs * H > t0 && e.t - hrs * H < t0 + D)
      .map(e => [Math.max(t0, e.t - hrs * H), Math.min(t0 + D, e.t + hrs * H)]);
    for (const [a, z] of blocks) {
      if (a > start) out.push([start, a]);
      start = Math.max(start, z);
    }
    if (start < t0 + D) out.push([start, t0 + D]);
    return out;
  }

  function buildSpot(spot, idx) {
    const fc = state.wx && state.wx.fc ? state.wx.fc[idx] : null;
    const mr = state.wx && state.wx.mr ? state.wx.mr[idx] : null;
    const fi = new Map(), mi = new Map();
    if (fc && fc.hourly) fc.hourly.time.forEach((t, i) => fi.set(parseL(t), i));
    if (mr && mr.hourly) mr.hourly.time.forEach((t, i) => mi.set(parseL(t), i));
    const g = (src, map, k, t) => { const i = map.get(t); if (!src || i == null || !src.hourly[k]) return null; const v = src.hourly[k][i]; return v == null ? null : v; };
    const sunMap = {}, dailyMap = {};
    if (fc && fc.daily) fc.daily.time.forEach((d, i) => {
      sunMap[d] = { rise: parseL(fc.daily.sunrise[i]), set: parseL(fc.daily.sunset[i]) };
      dailyMap[d] = {
        code: fc.daily.weather_code[i], tmax: fc.daily.temperature_2m_max[i], tmin: fc.daily.temperature_2m_min[i],
        rain: fc.daily.precipitation_sum[i], pp: fc.daily.precipitation_probability_max[i], uv: fc.daily.uv_index_max[i]
      };
    });

    const { events, cwaDays } = buildEvents(spot.key, mr);
    const hrs = blockHours(spot);
    const now = nowL();
    const today = dkey(now);
    const t0 = parseL(today);
    let lastSst = null;
    const days = [];

    for (let di = 0; di < DAYS; di++) {
      const dayT = t0 + di * D;
      const date = dkey(dayT);
      const sun = sunMap[date] || { rise: dayT + 5.8 * H, set: dayT + 17.5 * H, approx: true };
      const hours = [];
      for (let h = 0; h < 24; h++) {
        const t = dayT + h * H;
        const pres = g(fc, fi, 'pressure_msl', t), pres24 = g(fc, fi, 'pressure_msl', t - D);
        let sst = g(mr, mi, 'sea_surface_temperature', t), sstEst = false;
        const sst24 = g(mr, mi, 'sea_surface_temperature', t - D);
        const dsst24 = sst != null && sst24 != null ? sst - sst24 : null;
        if (sst != null) lastSst = sst; else if (lastSst != null) { sst = lastSst; sstEst = true; }
        const x = {
          t, hour: h, date,
          temp: g(fc, fi, 'temperature_2m', t), pp: g(fc, fi, 'precipitation_probability', t), pr: g(fc, fi, 'precipitation', t) || 0,
          code: g(fc, fi, 'weather_code', t), ws: g(fc, fi, 'wind_speed_10m', t), wd: g(fc, fi, 'wind_direction_10m', t),
          wg: g(fc, fi, 'wind_gusts_10m', t), vis: g(fc, fi, 'visibility', t), pres,
          dp24: pres != null && pres24 != null ? pres - pres24 : null,
          wave: g(mr, mi, 'wave_height', t), wper: g(mr, mi, 'wave_period', t), wdir: g(mr, mi, 'wave_direction', t),
          sst, sstEst, dsst24,
          tide: tideAt(events, t + H / 2)
        };
        x.tideH = x.tide ? x.tide.h : null;
        x.ok = !lowBlocked(events, t, t + H, hrs);
        x.dark = (t + H / 2) < sun.rise - 0.5 * H || (t + H / 2) > sun.set + 0.5 * H;
        x.ev = evalHour(spot, x, sun);
        hours.push(x);
      }

      const info = cwaDays[date] ? { ...cwaDays[date], lunarDay: +(cwaDays[date].lunar.split('/')[1] || 0) } : calcLunar(date);
      const daily = dailyMap[date] || {};
      const fishH = hours.filter(x => x.hour >= FISH_FIRST && x.hour <= FISH_LAST);
      const wsArr = nn(fishH.map(x => x.ws));
      let vx = 0, vy = 0;
      fishH.forEach(x => { if (x.ws != null && x.wd != null) { vx += x.ws * Math.sin(x.wd * Math.PI / 180); vy += x.ws * Math.cos(x.wd * Math.PI / 180); } });
      const domDir = (vx || vy) ? ((Math.atan2(vx, vy) * 180 / Math.PI) + 360) % 360 : null;
      const waves = nn(hours.map(x => x.wave));
      const ssts = nn(hours.map(x => x.sst));
      const dps = nn(fishH.map(x => x.dp24));
      const day = {
        date, di, sun, info, daily, hours,
        events: events.filter(e => dkey(e.t) === date),
        tideSrc: cwaDays[date] ? 'cwa' : 'model',
        windAvg: mean(wsArr), windMax: wsArr.length ? Math.max(...wsArr) : null,
        gustMax: nn(fishH.map(x => x.wg)).reduce((a, b) => Math.max(a, b), -1),
        domDir,
        waveMax: waves.length ? Math.max(...waves) : null,
        sst: mean(ssts), sstEst: hours.every(x => x.sst == null || x.sstEst),
        dsst: nn(hours.map(x => x.dsst24)).reduce((a, b) => Math.min(a, b), Infinity),
        dp: dps.length ? dps[Math.floor(dps.length / 2)] : null,
        visMin: nn(fishH.map(x => x.vis)).reduce((a, b) => Math.min(a, b), Infinity),
        thunder: hours.some(x => x.code != null && x.code >= 95),
        rainSum: daily.rain != null ? daily.rain : nn(hours.map(x => x.pr)).reduce((a, b) => a + b, 0),
        ppMax: daily.pp != null ? daily.pp : nn(hours.map(x => x.pp)).reduce((a, b) => Math.max(a, b), 0),
        boatRanges: spot.boat ? waterRanges(events, dayT, hrs) : null,
        long: di >= 7
      };
      if (day.gustMax < 0) day.gustMax = null;
      if (day.visMin === Infinity) day.visMin = null;
      if (day.dsst === Infinity) day.dsst = null;
      day.isRain = day.thunder || day.rainSum >= 1 || day.ppMax >= 60;
      day.windMaxB = beaufort(day.windMax);

      // best window
      const first = di === 0 ? Math.max(FISH_FIRST, new Date(now).getUTCHours() + 1) : FISH_FIRST;
      let best = null;
      for (let len = WIN; len >= 1 && !best; len--) {
        for (let st = first; st + len - 1 <= FISH_LAST; st++) {
          const w = hours.slice(st, st + len);
          if (!w.every(x => x.ok)) continue;
          const m = mean(w.map(x => x.ev.score));
          if (!best || m > best.mean) best = { st, len, mean: m, hours: w };
        }
      }
      if (best) {
        let score = best.mean + (RANGE_BONUS[info.range] || 0);
        const wMax = Math.max(...nn(best.hours.map(x => x.ws)), 0);
        const notes = [];
        if (wMax >= 10.8) { score = Math.min(score, 40); notes.push('風達 6 級，不宜出船'); }
        if (best.hours.some(x => x.ev.thunder)) { score = Math.min(score, 35); notes.push('雷雨'); }
        if (best.len < WIN) { score -= 8; notes.push('可開船時間短'); }
        day.score = Math.round(clamp(score, 0, 100));
        const tt = tideText(best.hours);
        day.win = {
          st: best.st, len: best.len, hours: best.hours, notes,
          label: pad(best.st) + ':00–' + pad(best.st + best.len) + ':00',
          tideText: tt.txt, tideShort: tt.short
        };
        const comp = {};
        Object.keys(best.hours[0].ev.c).forEach(k => { comp[k] = mean(best.hours.map(x => x.ev.c[k])); });
        comp.range = RANGE_BONUS[info.range] || 0;
        day.comp = comp;
        day.status = 'ok';
      } else {
        day.status = first > FISH_LAST ? 'past' : 'dry';
        day.score = day.status === 'past' ? null : 10;
        day.win = null;
        day.comp = null;
      }
      day.rating = rating(day.score);
      days.push(day);
    }
    return { spot, events, days, fc, mr };
  }

  function rebuild() {
    state.model = SPOTS.map((s, i) => buildSpot(s, i));
    pickBest();
  }

  function pickBest() {
    const vis = shown();
    let best = null;
    for (const m of vis) for (const d of m.days) {
      if (d.score == null) continue;
      if (!best || d.score > best.day.score) best = { spot: m.spot, day: d };
    }
    state.best = best;
    const selOk = vis.some(m => m.spot.key === state.sel.spot) && vis[0].days.some(d => d.date === state.sel.date);
    if (!state.sel.user || !selOk) {
      state.sel = best ? { spot: best.spot.key, date: best.day.date } : { spot: vis[0].spot.key, date: vis[0].days[0].date };
    }
  }

  // ------------------------------------------------------------------ advice text (black sea bream)
  function advice(spot, d) {
    const a = [];
    if (d.status === 'past') return ['今天適合的時段已過，請看明天以後。'];
    if (d.status === 'dry') a.push(`04:00–21:00 都卡在乾潮前後 ${blockHours(spot)} 小時，船出不去會擱淺。`);
    if (d.win) a.push(`建議 <b>${d.win.label}</b> ${d.win.tideText}。`);
    if (d.status !== 'dry' && spot.boat) {
      const lows = d.events.filter(e => e.type === 'L').map(e => `${hm(e.t - blockHours(spot) * H)}–${hm(e.t + blockHours(spot) * H)}`);
      if (lows.length) a.push(`乾潮前後不能開船：${lows.join('、')}，出海要算好回港時間。`);
    }
    if (d.windMaxB != null && d.windMaxB >= 6) a.push('風力達 6 級以上，小船出海危險，建議改天。');
    else if (d.windMaxB === 5) a.push('白天最大風力 5 級，船會晃、線難控制，鉛要加重並注意安全。');
    if (spot.windPref === 'north' && d.windAvg != null && d.windAvg >= 1.5) {
      const sec = windSector(d.domDir);
      if (sec === 'north') a.push('吹北風，是彰濱八仙最好的風向。');
      if (sec === 'south') a.push('吹南風，是彰濱八仙最差的風向，黑鯛不好釣。');
    }
    if (d.thunder) a.push('可能有雷雨，海上無處躲雷，不建議出船。');
    else if (d.rainSum >= 10) a.push(`預估雨量 ${fmt1(d.rainSum)} mm 偏大，河口水變淡變濁太多，${fishOf(spot)}可能暫離。`);
    else if (d.isRain) a.push(`預估會下雨；小雨讓水色混濁、${fishOf(spot)}警戒心降低，反而好釣，記得帶雨具。`);
    if (d.info.range === 'big') a.push('大潮水流很快、難釣，盡量挑滿潮或乾潮轉流前後下竿，鉛錘要加重。');
    else if (d.info.range === 'mid') a.push('中潮水流偏快，挑轉流前後下竿比較好控線。');
    else if (d.info.range === 'small') a.push(`小潮水流緩、好控線，是釣${fishOf(spot)}的好潮。`);
    const st = d.sst, sv = fmt1(st);
    if (st != null && spot.fish === '黑鯛') {
      if (st < 15) a.push(`海水溫約 ${sv}°C 太冷，黑鯛幾乎不開口，建議改天。`);
      else if (st < 17) a.push(`海水溫約 ${sv}°C 偏冷，黑鯛活性差，選中午前後水溫較高的時段。`);
      else if (st < 19) a.push(`海水溫約 ${sv}°C 略低但可以釣，中午前後水溫回升時較好。`);
      else if (st < 24) a.push(`海水溫約 ${sv}°C，正好是黑鯛最活躍的水溫（19–24°C）。`);
      else if (st < 27) a.push(`海水溫約 ${sv}°C，黑鯛還算活躍。`);
      else if (st < 29) a.push(`海水溫約 ${sv}°C 偏高，黑鯛多在清晨、傍晚或陰天覓食，中午咬口差。`);
      else a.push(`海水溫約 ${sv}°C 太熱，黑鯛躲到深處、咬口差，只建議清晨或傍晚短時間釣。`);
    } else if (st != null) {
      if (st < 17) a.push(`海水溫約 ${sv}°C 偏低，${fishOf(spot)}活性差，選中午前後水溫較高的時段。`);
      if (st > 28) a.push(`海水溫約 ${sv}°C 偏高，${fishOf(spot)}多在清晨、傍晚或陰天覓食。`);
    }
    if (d.dsst != null && d.dsst <= -0.8) a.push(`海水溫一天內降了 ${fmt1(-d.dsst)}°C（冷鋒或冷水進來），${fishOf(spot)}容易停口，最好等水溫穩定 2–3 天。`);
    if (d.sstEst) a.push('這天超出海水溫預報範圍，水溫沿用最後一天的預報。');
    if (d.dp != null && d.dp <= -4) a.push('氣壓下降中（鋒面接近前），魚通常比較活躍。');
    if (d.dp != null && d.dp >= 5) a.push(`冷鋒過後氣壓回升，${fishOf(spot)}咬口通常變差。`);
    if (d.visMin != null && d.visMin < 1000) a.push('可能起霧、能見度低，出入港注意安全。');
    if (spot.boat && d.waveMax != null && d.waveMax > 1.5) a.push(`浪高最大約 ${fmt1(d.waveMax)} m，船上不舒適也較危險。`);
    if (spot.shore && d.waveMax != null && d.waveMax > 1.5) a.push(`外海浪高約 ${fmt1(d.waveMax)} m，堤防、消波塊容易被浪打，不要站太前面。`);
    if (d.waveMax == null) a.push('這天超出浪的預報範圍，只用風來評估海況。');
    if (d.long) a.push('這是 7 天後的長期預報，變動大，出發前再確認。');
    if (d.tideSrc === 'model') a.push('這天沒有氣象署潮汐資料，潮時是模型推估。');
    return a;
  }

  function reasonRows(spot, d) {
    if (!d.comp) return '';
    const w = d.win.hours;
    const avg = k => mean(nn(w.map(x => x[k])));
    const ws = avg('ws'), wd = mean(nn(w.map(x => x.wd))), wg = Math.max(...nn(w.map(x => x.wg)), 0);
    const wave = Math.max(...nn(w.map(x => x.wave)), -1);
    const rows = [
      ['基本分', BASE, ''],
      [`潮流（${fishOf(spot)}愛流動的水）`, d.comp.tide, d.win.tideText],
      ['潮差（小潮好釣、大潮水急）', d.comp.range, RANGE_TXT[d.info.range] || ''],
      ['風力', d.comp.wind, ws != null ? `${dirName(w[1] ? w[1].wd : wd)} ${beaufort(ws)} 級（${fmt1(ws)} m/s）` : '無資料'],
      ['陣風', d.comp.gust, wg ? `最大 ${fmt1(wg)} m/s` : ''],
      ['浪高' + (spot.wf < 1 ? (spot.shore ? '（岸釣影響較小）' : '（港內影響小）') : ''), d.comp.wave, wave >= 0 ? `最大 ${fmt1(wave)} m` : '無預報'],
      ['降雨', d.comp.rain, `機率最高 ${Math.max(...nn(w.map(x => x.pp)), 0)}%，${fmt1(w.reduce((s, x) => s + (x.pr || 0), 0))} mm`],
      [spot.fish === '黑鯛' ? '海水溫（黑鯛最愛 19–24°C）' : '海水溫', d.comp.sst, d.sst != null ? fmt1(avg('sst')) + '°C' : ''],
      ['水溫變化', d.comp.dsst, avg('dsst24') != null ? (avg('dsst24') > 0 ? '+' : '') + fmt1(avg('dsst24')) + '°C / 24h' : ''],
      ['晨昏時段', d.comp.light, ''],
      ['氣壓變化', d.comp.pres, avg('dp24') != null ? (avg('dp24') > 0 ? '+' : '') + fmt1(avg('dp24')) + ' hPa / 24h' : ''],
      ['能見度', d.comp.vis, avg('vis') != null ? fmt1(avg('vis') / 1000) + ' km' : ''],
      ['氣溫', d.comp.temp, avg('temp') != null ? fmt1(avg('temp')) + '°C' : '']
    ];
    if (spot.windPref === 'north') rows.splice(5, 0, ['風向（彰濱北風佳、南風差）', d.comp.dir, '']);
    return rows.map(([k, v, note]) => {
      const r = Math.round(v);
      const cls = k === '基本分' ? '' : r > 0 ? 'pos' : r < 0 ? 'neg' : '';
      const val = k === '基本分' ? r : (r > 0 ? '+' + r : r === 0 ? '0' : r);
      return `<li><span>${k}${note ? ` <small style="color:#64748b">${note}</small>` : ''}</span><span class="v ${cls}">${val}</span></li>`;
    }).join('') + (d.win.notes.length ? `<li><span>上限修正</span><span class="v neg">${d.win.notes.join('、')}</span></li>` : '');
  }

  // ------------------------------------------------------------------ render: status / mode
  function renderStatus() {
    const parts = [];
    if (state.tide) {
      const end = tideEnd(state.tide);
      parts.push(`潮汐：中央氣象署（${state.tide.updated} 更新，到 ${end.slice(5).replace('-', '/')}）`);
      const need = dkey(nowL() + (DAYS - 1) * D);
      if (end < need) parts.push('<span class="err">潮汐資料不足兩週，部分日子用模型推估</span>');
    } else parts.push('<span class="err">沒有潮汐資料，改用模型推估</span>');
    if (state.wx) {
      const f = new Date(state.wx.fetched + 8 * H);
      parts.push(`天氣、浪、海水溫：Open-Meteo（${f.getUTCMonth() + 1}/${f.getUTCDate()} ${hm(f.getTime())} 抓取）`);
      if (!state.wx.mr) parts.push('<span class="err">浪與海水溫暫時抓不到</span>');
    }
    if (state.nextAuto) parts.push(`每天 00、06、12、18 點自動更新（下次 ${hm(state.nextAuto)}）`);
    if (state.error) parts.push(`<span class="err">${state.error}</span>`);
    $('status').innerHTML = parts.join('｜');
  }

  function applyMode() {
    const m = state.settings.mode;
    document.querySelectorAll('.mode-switch button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
    $('simpleView').classList.toggle('on', m === 'simple');
    $('fullView').classList.toggle('on', m === 'full');
  }

  function render() {
    renderStatus();
    applyMode();
    if (!state.model) return;
    if (state.settings.mode === 'simple') renderSimple(); else renderFull();
  }

  // ------------------------------------------------------------------ simple mode
  function renderSimple() {
    const b = state.best;
    const card = $('bestCard');
    if (!b) {
      card.className = 'best-card none';
      card.innerHTML = '<div class="lbl">兩週內最佳出釣日</div><div class="day">暫無適合的日子</div>';
      card.onclick = null;
    } else {
      const d = b.day, rt = rating(d.score);
      const [ic, wt] = wxIcon(d.daily.code);
      const tips = advice(b.spot, d).filter(t => !t.startsWith('建議'));
      const others = shown().filter(m => m.spot.key !== b.spot.key).map(m => {
        const bd = m.days.filter(x => x.score != null).sort((x, y) => y.score - x.score)[0];
        return bd ? `<span>${m.spot.name} 最佳：${dlabel(bd.date)} ${bd.score} 分</span>` : '';
      }).join('');
      card.className = 'best-card c' + rt.cls.slice(1);
      card.innerHTML = `
        <div class="lbl">兩週內最佳出釣日</div>
        <div class="day">${dlabel(d.date)}${d.di === 0 ? ' 今天' : d.di === 1 ? ' 明天' : ''}</div>
        <div><span class="spot">${b.spot.name}</span> <small class="kind">${kindOf(b.spot)}</small><span class="score">${rt.txt} ${d.score} 分</span></div>
        <div class="win">⏰ ${d.win.label}　${d.win.tideText}</div>
        <div class="tip">${ic} ${wt}　${RANGE_TXT[d.info.range] || ''}　風 ${dirName(d.domDir)} ${beaufort(d.windAvg) ?? '—'} 級　浪 ${fmt1(d.waveMax)} m　海溫 ${fmt1(d.sst)}°C${d.isRain ? '　<b>🌧 預估下雨</b>' : ''}</div>
        ${tips[0] ? `<div class="tip">💡 ${tips[0]}</div>` : ''}
        <div class="others">${others}</div>`;
      card.onclick = () => openDetail(b.spot.key, d.date);
    }
    $('curveLegend').innerHTML = shown().map(({ spot: s }) => `<span><i class="dot" style="background:${s.color}"></i>${s.name}</span>`).join('');
    $('curve').innerHTML = curveSvg();
    $('curve').querySelectorAll('[data-spot]').forEach(el => el.addEventListener('click', () => openDetail(el.dataset.spot, el.dataset.date)));
    $('sstLegend').innerHTML = $('curveLegend').innerHTML;
    $('sstCurve').innerHTML = sstSvg();
    $('sstCurve').querySelectorAll('[data-spot]').forEach(el => el.addEventListener('click', () => openDetail(el.dataset.spot, el.dataset.date)));
  }

  function dayAxis(days0, X, HH, nar) {
    let s = '';
    days0.forEach((d, i) => {
      const we = isWeekend(d.date), dt = new Date(parseL(d.date));
      const dl = nar && i > 0 && dt.getUTCDate() !== 1 ? String(dt.getUTCDate()) : (dt.getUTCMonth() + 1) + '/' + dt.getUTCDate();
      s += `<text x="${X(i)}" y="${HH - 26}" text-anchor="middle" fill="#334155" font-weight="${we ? 700 : 400}">${dl}</text>`;
      s += `<text x="${X(i)}" y="${HH - 10}" text-anchor="middle" fill="${we ? '#c2410c' : '#64748b'}">${WK[dt.getUTCDay()]}${d.di === 0 && !nar ? '・今' : ''}</text>`;
    });
    return s;
  }

  function sstSvg() {
    const nar = isNarrow();
    const W = nar ? 400 : 1000, HH = nar ? 250 : 290, l = nar ? 34 : 46, r = nar ? 6 : 14, t = 14, b = 46;
    const pw = W - l - r, ph = HH - t - b, n = DAYS;
    const vis = shown(), days0 = vis[0].days;
    const vals = vis.flatMap(m => m.days.map(d => d.sst)).filter(v => v != null);
    if (!vals.length) return '<p class="hint">暫時抓不到海水溫資料，按「更新資料」再試一次。</p>';
    let lo = Math.floor(Math.min(...vals) - 0.5), hi = Math.ceil(Math.max(...vals) + 0.5);
    if (hi - lo < 4) { const mid = (hi + lo) / 2; lo = Math.floor(mid - 2); hi = lo + 4; }
    const X = i => l + (i + 0.5) * pw / n, Y = v => t + (hi - v) / (hi - lo) * ph;
    let s = `<svg viewBox="0 0 ${W} ${HH}" xmlns="http://www.w3.org/2000/svg" font-size="${nar ? 11 : 13}" font-family="inherit">`;
    [[-99, 17, '#dbeafe', '偏冷'], [17, 19, '#e0f2fe', ''], [19, 24, '#dcefe0', '黑鯛最佳 19–24°C'], [24, 27, '#eef5e4', ''], [27, 29, '#fde8d4', '偏熱'], [29, 99, '#fbd5c0', '太熱']].forEach(([a, z, c, txt]) => {
      const a1 = Math.max(a, lo), z1 = Math.min(z, hi);
      if (z1 <= a1) return;
      s += `<rect x="${l}" y="${Y(z1)}" width="${pw}" height="${Y(a1) - Y(z1)}" fill="${c}" opacity=".85"/>`;
      if (txt && Y(a1) - Y(z1) >= 14) s += `<text x="${l + pw - 4}" y="${Y(z1) + 12}" text-anchor="end" fill="#64748b" font-size="${nar ? 9.5 : 11}">${txt}</text>`;
    });
    const step = hi - lo > 6 ? 2 : 1;
    for (let v = lo; v <= hi; v += step) {
      s += `<line x1="${l}" x2="${l + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e5e7eb" opacity=".8"/>`;
      s += `<text x="${l - 5}" y="${Y(v) + 4}" text-anchor="end" fill="#64748b">${v}°</text>`;
    }
    const longX = l + 7 * pw / n;
    s += `<line x1="${longX}" x2="${longX}" y1="${t}" y2="${t + ph}" stroke="#cbd5e1" stroke-dasharray="4 4"/>`;
    s += dayAxis(days0, X, HH, nar);
    vis.forEach(m => {
      m.days.forEach((d, i) => {
        const p = m.days[i - 1];
        if (!p || p.sst == null || d.sst == null) return;
        s += `<line x1="${X(i - 1).toFixed(1)}" y1="${Y(p.sst).toFixed(1)}" x2="${X(i).toFixed(1)}" y2="${Y(d.sst).toFixed(1)}" stroke="${m.spot.color}" stroke-width="2.2" stroke-linecap="round"${d.sstEst ? ' stroke-dasharray="5 4" opacity=".6"' : ''}/>`;
      });
    });
    vis.forEach(m => {
      m.days.forEach((d, i) => {
        if (d.sst == null) return;
        const drop = d.dsst != null && d.dsst <= -0.8;
        if (drop) s += `<text x="${X(i)}" y="${Y(d.sst) + 16}" text-anchor="middle" fill="#1d4ed8" font-weight="700">↓</text>`;
        s += `<circle class="pt" data-spot="${m.spot.key}" data-date="${d.date}" cx="${X(i)}" cy="${Y(d.sst)}" r="${nar ? 6 : 8}" fill="transparent"><title>${m.spot.name} ${dlabel(d.date)}：海水溫 ${fmt1(d.sst)}°C${drop ? `\n一天內降 ${fmt1(-d.dsst)}°C` : ''}${d.sstEst ? '\n超出預報，沿用最後一天' : ''}</title></circle>`;
      });
    });
    return s + '</svg>';
  }

  function curveSvg() {
    const nar = isNarrow();
    const W = nar ? 400 : 1000, HH = nar ? 300 : 340, l = nar ? 28 : 40, r = nar ? 6 : 14, t = 40, b = 46;
    const pw = W - l - r, ph = HH - t - b, n = DAYS;
    const X = i => l + (i + 0.5) * pw / n, Y = s => t + (100 - s) / 100 * ph;
    const vis = shown(), days0 = vis[0].days;
    let s = `<svg viewBox="0 0 ${W} ${HH}" xmlns="http://www.w3.org/2000/svg" font-size="${nar ? 11 : 13}" font-family="inherit">`;
    [[75, 100, '#dcefe0'], [60, 75, '#f3efcc'], [45, 60, '#f8e4d6'], [0, 45, '#f6e0e0']].forEach(([a, z, c]) => {
      s += `<rect x="${l}" y="${Y(z)}" width="${pw}" height="${Y(a) - Y(z)}" fill="${c}" opacity=".75"/>`;
    });
    [0, 45, 60, 75, 100].forEach(v => {
      s += `<line x1="${l}" x2="${l + pw}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e5e7eb"/>`;
      s += `<text x="${l - 6}" y="${Y(v) + 4}" text-anchor="end" fill="#64748b">${v}</text>`;
    });
    const longX = l + 7 * pw / n;
    s += `<line x1="${longX}" x2="${longX}" y1="${t}" y2="${t + ph}" stroke="#cbd5e1" stroke-dasharray="4 4"/>`;
    s += `<text x="${longX + 4}" y="${t + ph - 6}" fill="#94a3b8" font-size="${nar ? 9 : 11}">${nar ? '長期預報→' : '右邊為長期預報，僅供參考'}</text>`;
    s += dayAxis(days0, X, HH, nar);
    days0.forEach((d, i) => {
      const rainy = vis.some(m => m.days[i].isRain), th = vis.some(m => m.days[i].thunder);
      if (rainy) s += `<text x="${X(i)}" y="${t - 20}" text-anchor="middle" font-size="${nar ? 12 : 15}">${th ? '⛈️' : '🌧️'}</text>`;
      const rg = d.info.range;
      if (rg) s += `<text x="${X(i)}" y="${t - 6}" text-anchor="middle" font-size="${nar ? 10 : 11}" fill="#94a3b8">${nar ? RANGE_TXT[rg].slice(0, 1) : RANGE_TXT[rg]}</text>`;
    });
    vis.forEach(m => {
      let path = '', pen = false;
      m.days.forEach((d, i) => {
        if (d.score == null) { pen = false; return; }
        path += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(d.score).toFixed(1) + ' ';
        pen = true;
      });
      s += `<path d="${path}" fill="none" stroke="${m.spot.color}" stroke-width="2.2" stroke-linejoin="round"/>`;
    });
    vis.forEach(m => {
      m.days.forEach((d, i) => {
        if (d.score == null) return;
        const isBest = state.best && state.best.spot.key === m.spot.key && state.best.day.date === d.date;
        if (isBest) {
          s += `<circle cx="${X(i)}" cy="${Y(d.score)}" r="5" fill="${m.spot.color}"/>`;
          s += `<text x="${X(i)}" y="${Y(d.score) - 10}" text-anchor="middle" font-weight="700" fill="${m.spot.color}">${nar ? '★' : '★ 最佳 '}${d.score}</text>`;
        }
        s += `<circle class="pt" data-spot="${m.spot.key}" data-date="${d.date}" cx="${X(i)}" cy="${Y(d.score)}" r="${nar ? 7 : 10}" fill="transparent"><title>${m.spot.name} ${dlabel(d.date)}：${d.score} 分 ${d.rating.txt}${d.win ? '\n' + d.win.label + ' ' + d.win.tideText : ''}${d.isRain ? '\n預估下雨' : ''}</title></circle>`;
      });
    });
    return s + '</svg>';
  }

  // ------------------------------------------------------------------ full mode
  function renderFull() {
    renderNow();
    renderHeatmap();
    $('spotTabs').innerHTML = shown().map(({ spot: s }) => `<button type="button" data-spot="${s.key}" class="${s.key === state.sel.spot ? 'on' : ''}">${s.name}</button>`).join('');
    $('spotTabs').querySelectorAll('button').forEach(b => b.addEventListener('click', () => { state.sel.spot = b.dataset.spot; state.sel.user = true; renderFull(); }));
    renderDayTable();
    renderDetail();
    renderRefs();
    renderSettings();
  }

  function renderNow() {
    const now = nowL();
    $('nowStrip').innerHTML = shown().map(m => {
      const s = tideAt(m.events, now);
      const d0 = m.days[0];
      const x = d0.hours[new Date(now).getUTCHours()];
      let tide = '<small>沒有潮汐資料</small>';
      if (s) {
        const left = s.next.t - now, hh = Math.floor(left / H), mm = Math.round((left % H) / 60e3);
        tide = `<div class="big ${s.rising ? 'rise' : 'fall'}">${s.rising ? '▲ 漲潮中' : '▼ 退潮中'}　${s.h >= 0 ? '+' : ''}${Math.round(s.h)} cm</div>
          <small>下一個${s.next.type === 'H' ? '滿潮' : '乾潮'} ${hm(s.next.t)}（${s.next.msl >= 0 ? '+' : ''}${s.next.msl} cm），還有 ${hh} 小時 ${mm} 分</small>`;
        if (m.spot.boat) {
          const hrs = blockHours(m.spot);
          const low = m.events.find(e => e.type === 'L' && e.t + hrs * H > now);
          if (!lowBlocked(m.events, now, now, hrs)) {
            tide += `<small>✅ 目前可開船${low ? `，${hm(low.t - hrs * H)} 前要回港（乾潮 ${hm(low.t)} 前 ${hrs} 小時）` : ''}</small>`;
          } else {
            tide += `<small>⛔ 乾潮前後水太淺會擱淺${low ? `，${hm(low.t + hrs * H)} 起可開船` : ''}</small>`;
          }
        }
      }
      const wx = x && x.ws != null ? `<small>現在：${dirName(x.wd)} ${beaufort(x.ws)} 級（${fmt1(x.ws)} m/s）、浪 ${fmt1(x.wave)} m、海溫 ${fmt1(x.sst)}°C、氣溫 ${fmt1(x.temp)}°C</small>` : '';
      return `<div class="now-card" style="border-left-color:${m.spot.color}"><b>${m.spot.name}</b>${tide}${wx}</div>`;
    }).join('');
  }

  function renderHeatmap() {
    const vis = shown(), days0 = vis[0].days;
    const top = days0.map((_, i) => Math.max(...vis.map(m => m.days[i].score ?? -1)));
    const cell = (m, d, i) => {
      const cls = 'c' + d.rating.cls.slice(1);
      const sel = state.sel.spot === m.spot.key && state.sel.date === d.date;
      const star = d.score != null && d.score >= 75 && d.score === top[i] ? ' ★' : '';
      const wind = knots(d.windAvg), wave = d.waveMax;
      const meta = [wind != null ? wind + '節' : '', wave != null ? fmt1(wave) + 'm' : ''].filter(Boolean).join(' ');
      const rain = d.ppMax >= 10 || d.isRain ? `<span class="rain${d.isRain ? ' wet' : ''}">${d.thunder ? '⚡' : '💧'}${d.ppMax ?? 0}%</span>` : '';
      return `<td class="${cls}${isWeekend(d.date) ? ' we' : ''}${sel ? ' sel' : ''}" data-spot="${m.spot.key}" data-date="${d.date}" title="${m.spot.name} ${dlabel(d.date)} ${d.rating.txt}${d.win ? '\n' + d.win.label + ' ' + d.win.tideText : ''}">
        <div class="num">${d.score == null ? '—' : d.score}</div><div class="lbl">${d.score == null ? (d.status === 'past' ? '已過' : '無資料') : d.rating.txt + star}</div>
        <div class="meta">${meta}</div>${sstTag(d)}${rain}</td>`;
    };
    const dayHead = d => `<b>${d.date.slice(5).replace('-', '/').replace(/^0/, '')}</b><small>${WK[new Date(parseL(d.date)).getUTCDay()]}・${RANGE_TXT[d.info.range] || ''}${d.di === 0 ? '・今' : ''}</small>`;
    let h;
    if (isNarrow()) {
      h = '<table class="heatmap tall"><thead><tr><th></th>' +
        vis.map(m => `<th class="spot-h"><i class="dot" style="background:${m.spot.color}"></i>${m.spot.short}</th>`).join('') + '</tr></thead><tbody>';
      days0.forEach((d, i) => { h += `<tr><th class="day${isWeekend(d.date) ? ' we' : ''}">${dayHead(d)}</th>${vis.map(m => cell(m, m.days[i], i)).join('')}</tr>`; });
    } else {
      h = '<table class="heatmap"><thead><tr><th></th>' + days0.map(d => `<th class="${isWeekend(d.date) ? 'we' : ''}">${dayHead(d)}</th>`).join('') + '</tr></thead><tbody>';
      vis.forEach(m => { h += `<tr><th class="spot"><i class="dot" style="background:${m.spot.color}"></i>${m.spot.name}</th>${m.days.map((d, i) => cell(m, d, i)).join('')}</tr>`; });
    }
    h += '</tbody></table>';
    h += '<div class="scale"><span class="c4">75+ 適合</span><span class="c3">60–74 尚可</span><span class="c2">45–59 勉強</span><span class="c1">&lt;45 不適合 / 危險</span><span class="c0">無資料</span><span class="note">★＝當天勾選的釣點中最好　虛線框＝週末　節＝白天平均風速　m＝最大浪高　' + (isNarrow() ? '最下方溫度' : '水') + '＝海水溫（綠＝黑鯛最佳 19–24°C、橘＝偏熱、藍＝偏冷、↓＝一天內驟降）</span></div>';
    $('heatmap').innerHTML = h;
    $('heatmap').querySelectorAll('td[data-spot]').forEach(td => td.addEventListener('click', () => openDetail(td.dataset.spot, td.dataset.date)));
  }

  function sstTag(d) {
    if (d.sst == null) return '';
    const s = d.sst, cls = s < 17 ? 'cold' : s < 19 ? 'cool' : s < 24 ? 'best' : s < 27 ? 'ok' : 'hot';
    return `<div class="sst ${cls}${d.dsst != null && d.dsst <= -0.8 ? ' drop' : ''}"><span class="w">水</span>${fmt1(s)}°</div>`;
  }

  function eventsHtml(d) {
    return d.events.map(e => `<span class="${e.type === 'H' ? 'tH' : 'tL'}">${e.type === 'H' ? '滿' : '乾'} ${hm(e.t)}</span> <small>${e.msl >= 0 ? '+' : ''}${e.msl}</small>`).join('<br>');
  }
  const rangesTxt = rs => rs && rs.length ? rs.map(([a, b]) => hm(a) + '–' + (b - a >= D - 60e3 || hm(b) === '00:00' ? '24:00' : hm(b))).join('<br>') : '整天不能開船';

  function dayTags(sp, d) {
    const tags = [];
    if (d.long) tags.push('<span class="tag">長期預報</span>');
    if (d.waveMax == null) tags.push('<span class="tag">浪無預報</span>');
    if (d.tideSrc === 'model') tags.push('<span class="tag">潮汐推估</span>');
    if (sp.windPref === 'north' && d.windAvg >= 1.5) {
      const sec = windSector(d.domDir);
      if (sec === 'north') tags.push('<span class="tag good">北風佳</span>');
      if (sec === 'south') tags.push('<span class="tag warn">南風最差</span>');
    }
    if (d.windMaxB >= 6) tags.push('<span class="tag warn">風大危險</span>');
    if (d.dp != null && d.dp >= 5) tags.push('<span class="tag warn">冷鋒過後</span>');
    if (d.visMin != null && d.visMin < 1000) tags.push('<span class="tag warn">起霧</span>');
    if (d.status === 'dry') tags.push('<span class="tag warn">乾潮擱淺</span>');
    return tags;
  }

  function renderDayCards(m) {
    const sp = m.spot;
    $('dayTable').innerHTML = '<div class="dcards">' + m.days.map(d => {
      const [ic, wt] = wxIcon(d.daily.code);
      const tides = d.events.map(e => `<span class="${e.type === 'H' ? 'tH' : 'tL'}">${e.type === 'H' ? '滿' : '乾'} ${hm(e.t)}</span>`).join('　');
      return `<div class="dcard c${d.rating.cls.slice(1)}${d.date === state.sel.date ? ' sel' : ''}" data-date="${d.date}">
        <div class="dc-top"><div><b class="${isWeekend(d.date) ? 'we' : ''}">${dlabel(d.date)}${d.di === 0 ? ' 今天' : ''}</b>
          <small>${moonIcon(d.info.lunarDay)} ${d.info.lunar}・<span class="range-${d.info.range}">${RANGE_TXT[d.info.range] || ''}</span></small></div>
          <div class="dc-score"><span class="num">${d.score ?? '—'}</span><span class="lbl">${d.rating.txt}</span></div></div>
        <div class="dc-win">${d.win ? `⏰ <b>${d.win.label}</b> ${d.win.tideText}` : d.status === 'past' ? '今日已過' : '⛔ 乾潮不能開船'}</div>
        <div class="dc-row">${tides}</div>
        ${sp.boat ? `<div class="dc-row">🚤 ${rangesTxt(d.boatRanges).replace(/<br>/g, '、')}</div>` : ''}
        <div class="dc-row">${ic} ${wt}　${d.isRain ? `<span class="rain-tag${d.thunder ? ' thunder' : ''}">${d.thunder ? '雷雨' : '有雨'}</span> ` : ''}💧${d.ppMax ?? '—'}%　🌡${fmt1(d.daily.tmin)}–${fmt1(d.daily.tmax)}°</div>
        <div class="dc-row">${arrow(d.domDir)} ${dirName(d.domDir)} ${beaufort(d.windAvg) ?? '—'}–${d.windMaxB ?? '—'} 級（${knots(d.windAvg) ?? '—'} 節）　🌊 ${d.waveMax == null ? '—' : fmt1(d.waveMax) + 'm'}　海溫 ${fmt1(d.sst)}°</div>
        ${dayTags(sp, d).length ? `<div class="dc-row">${dayTags(sp, d).join('')}</div>` : ''}
      </div>`;
    }).join('') + '</div>';
    $('dayTable').querySelectorAll('.dcard').forEach(el => el.addEventListener('click', () => openDetail(sp.key, el.dataset.date)));
  }

  function renderDayTable() {
    const m = state.model.find(x => x.spot.key === state.sel.spot);
    const sp = m.spot;
    if (isNarrow()) return renderDayCards(m);
    let h = `<table class="days"><thead><tr><th>日期</th><th>評分</th><th>建議時段（漲／退）</th><th>乾滿潮（cm）</th><th>潮差</th>${sp.boat ? '<th>可開船時段</th>' : ''}<th>天氣</th><th>降雨</th><th>氣溫</th><th>海水溫</th><th>浪高</th><th>風（白天）</th><th>陣風</th><th>備註</th></tr></thead><tbody>`;
    m.days.forEach(d => {
      const [ic, wt] = wxIcon(d.daily.code);
      const tags = dayTags(sp, d);
      const sel = d.date === state.sel.date;
      const sc = d.score == null ? '—' : d.score;
      h += `<tr class="${sel ? 'sel' : ''} ${d.isRain ? 'rainy' : ''}" data-date="${d.date}">
        <td class="date"><b style="color:${isWeekend(d.date) ? '#c2410c' : 'inherit'}">${dlabel(d.date)}</b>${d.di === 0 ? ' 今天' : ''}<br><span class="lunar">${moonIcon(d.info.lunarDay)} 農曆 ${d.info.lunar}</span></td>
        <td><span class="r ${d.rating.cls}">${d.rating.txt}</span><br><b>${sc}</b><div class="bar"><i style="width:${d.score || 0}%;background:${RCOL[d.rating.cls]}"></i></div></td>
        <td>${d.win ? `<b>${d.win.label}</b><br>${d.win.tideText}` : d.status === 'past' ? '今日已過' : '乾潮不能開船'}</td>
        <td class="tides">${eventsHtml(d)}</td>
        <td class="range-${d.info.range}">${RANGE_TXT[d.info.range] || '—'}</td>
        ${sp.boat ? `<td style="font-size:12.5px;white-space:nowrap">${rangesTxt(d.boatRanges)}</td>` : ''}
        <td class="wx">${ic}<br>${wt}</td>
        <td class="wx">${d.isRain ? `<span class="rain-tag${d.thunder ? ' thunder' : ''}">${d.thunder ? '雷雨' : '有雨'}</span><br>` : ''}${d.ppMax ?? '—'}%・${fmt1(d.rainSum)}mm</td>
        <td>${fmt1(d.daily.tmin)}–${fmt1(d.daily.tmax)}°</td>
        <td>${fmt1(d.sst)}°${d.sstEst ? '<br><small>沿用</small>' : ''}</td>
        <td>${d.waveMax == null ? '—' : fmt1(d.waveMax) + ' m'}</td>
        <td style="white-space:nowrap">${arrow(d.domDir)} ${dirName(d.domDir)}<br>${beaufort(d.windAvg) ?? '—'}–${d.windMaxB ?? '—'} 級</td>
        <td>${d.gustMax == null ? '—' : fmt1(d.gustMax)}<small> m/s</small></td>
        <td>${tags.join('')}</td></tr>`;
    });
    $('dayTable').innerHTML = h + '</tbody></table>';
    $('dayTable').querySelectorAll('tbody tr').forEach(tr => tr.addEventListener('click', () => openDetail(state.sel.spot, tr.dataset.date)));
  }

  function tideSvg(m, d) {
    const nar = isNarrow();
    const W = nar ? 480 : 1000, HH = nar ? 270 : 290, l = nar ? 34 : 50, r = nar ? 8 : 12, t = 30, b = 54;
    const pw = W - l - r, ph = HH - t - b;
    const t0 = parseL(d.date);
    const smp = [];
    for (let q = 0; q <= 144; q++) { const tt = t0 + q * 10 * 60e3; const s = tideAt(m.events, tt); smp.push({ t: tt, s }); }
    const vals = nn(smp.map(p => p.s && p.s.h));
    if (!vals.length) return '<p class="hint">沒有潮汐資料。</p>';
    const hrs = blockHours(m.spot);
    let ymin = Math.min(...vals), ymax = Math.max(...vals);
    ymin -= 25; ymax += 30;
    const X = tt => l + (tt - t0) / D * pw, Y = v => t + (ymax - v) / (ymax - ymin) * ph;
    let s = `<svg viewBox="0 0 ${W} ${HH}" xmlns="http://www.w3.org/2000/svg" font-size="${nar ? 12 : 13}" font-family="inherit">`;
    s += `<rect x="${l}" y="${t}" width="${X(d.sun.rise) - l}" height="${ph}" fill="#1e293b" opacity=".07"/>`;
    s += `<rect x="${X(d.sun.set)}" y="${t}" width="${l + pw - X(d.sun.set)}" height="${ph}" fill="#1e293b" opacity=".07"/>`;
    if (d.win) s += `<rect x="${X(t0 + d.win.st * H)}" y="${t}" width="${d.win.len * H / D * pw}" height="${ph}" fill="#facc15" opacity=".35"/><text x="${X(t0 + (d.win.st + d.win.len / 2) * H)}" y="${t + ph - 6}" text-anchor="middle" fill="#854d0e" font-weight="700">建議時段</text>`;
    let area = `M${X(t0)} ${Y(ymin)} `;
    smp.forEach(p => { if (p.s) area += `L${X(p.t).toFixed(1)} ${Y(p.s.h).toFixed(1)} `; });
    area += `L${X(t0 + D)} ${Y(ymin)} Z`;
    s += `<path d="${area}" fill="#7cc4e8" opacity=".35"/>`;
    let seg = [], up = null;
    const flush = () => { if (seg.length > 1) s += `<polyline points="${seg.join(' ')}" fill="none" stroke="${up ? '#15803d' : '#c2410c'}" stroke-width="2.6"/>`; };
    smp.forEach(p => {
      if (!p.s) return;
      const pt = X(p.t).toFixed(1) + ',' + Y(p.s.h).toFixed(1);
      if (up !== null && p.s.rising !== up) { seg.push(pt); flush(); seg = []; }
      up = p.s.rising; seg.push(pt);
    });
    flush();
    s += `<line x1="${l}" x2="${l + pw}" y1="${Y(0)}" y2="${Y(0)}" stroke="#94a3b8" stroke-dasharray="2 3"/><text x="${l - 4}" y="${Y(0) + 4}" text-anchor="end" fill="#64748b">0</text>`;
    if (m.spot.boat) {
      m.events.filter(e => e.type === 'L' && e.t + hrs * H > t0 && e.t - hrs * H < t0 + D).forEach(e => {
        const a = Math.max(t0, e.t - hrs * H), z = Math.min(t0 + D, e.t + hrs * H);
        s += `<rect x="${X(a)}" y="${t}" width="${X(z) - X(a)}" height="${ph}" fill="#ef4444" opacity=".10"/>`;
        s += `<text x="${(X(a) + X(z)) / 2}" y="${t + 14}" text-anchor="middle" fill="#b91c1c" font-weight="700">不能開船</text>`;
      });
      const by = HH - b + 22;
      s += `<rect x="${l}" y="${by}" width="${pw}" height="9" rx="3" fill="#fca5a5"/>`;
      (d.boatRanges || []).forEach(([a, z]) => { s += `<rect x="${X(a)}" y="${by}" width="${X(z) - X(a)}" height="9" rx="3" fill="#22c55e"/>`; });
      s += `<text x="${l - 4}" y="${by + 8}" text-anchor="end" fill="#334155">出船</text>`;
    }
    for (let q = 0; q <= 24; q += 3) s += `<text x="${X(t0 + q * H)}" y="${HH - b + 14}" text-anchor="middle" fill="#64748b">${pad(q)}</text>`;
    d.events.forEach(e => {
      const yy = Y(e.msl);
      s += `<circle cx="${X(e.t)}" cy="${yy}" r="4" fill="${e.type === 'H' ? '#0b5e8a' : '#a16207'}"/>`;
      const side = e.type === 'L' && yy + 16 > t + ph - 2;
      const tx = side ? X(e.t) + (X(e.t) > W - 110 ? -8 : 8) : X(e.t);
      const anchor = side ? (X(e.t) > W - 110 ? 'end' : 'start') : 'middle';
      s += `<text x="${tx}" y="${side ? yy + 4 : e.type === 'H' ? yy - 8 : yy + 16}" text-anchor="${anchor}" font-weight="700" fill="${e.type === 'H' ? '#0b5e8a' : '#a16207'}">${e.type === 'H' ? '滿' : '乾'} ${hm(e.t)}${nar ? '' : ` ${e.msl >= 0 ? '+' : ''}${e.msl}`}</text>`;
    });
    s += `<text x="${X(d.sun.rise)}" y="${t - 6}" text-anchor="middle" fill="#b45309">☀ ${hm(d.sun.rise)}</text><text x="${X(d.sun.set)}" y="${t - 6}" text-anchor="middle" fill="#7c3aed">☾ ${hm(d.sun.set)}</text>`;
    if (d.di === 0) { const nx = X(nowL()); s += `<line x1="${nx}" x2="${nx}" y1="${t}" y2="${t + ph}" stroke="#0f172a" stroke-width="1.5"/><text x="${nx + 3}" y="${t + 32}" fill="#0f172a">現在</text>`; }
    return s + '</svg>';
  }

  function renderDetail() {
    const m = state.model.find(x => x.spot.key === state.sel.spot);
    const d = m.days.find(x => x.date === state.sel.date) || m.days[0];
    const sp = m.spot;
    const adv = advice(sp, d).map(t => `<p>• ${t}</p>`).join('');
    const boat = sp.boat ? `<div class="boatwin ${d.boatRanges && d.boatRanges.length ? '' : 'no'}">🚤 可開船時段：<b>${rangesTxt(d.boatRanges).replace(/<br>/g, '、')}</b>；乾潮前後 ${blockHours(sp)} 小時水太淺會擱淺${d.events.filter(e => e.type === 'L').map(e => `（乾潮 ${hm(e.t)}：${hm(e.t - blockHours(sp) * H)}–${hm(e.t + blockHours(sp) * H)} 不能開船）`).join('')}</div>`
      : sp.shore ? '<div class="boatwin">🎣 岸釣不用開船，乾潮也能釣，以潮流、風浪與天氣為主。</div>'
      : `<div class="boatwin">🚤 ${sp.name}水位高低影響較小，全天都可釣，以潮流與天氣為主。</div>`;
    let rows = '';
    d.hours.forEach(x => {
      const inWin = d.win && x.hour >= d.win.st && x.hour < d.win.st + d.win.len;
      const [ic, wt] = wxIcon(x.code);
      rows += `<tr class="${!x.ok ? 'dry' : ''} ${inWin ? 'best' : ''} ${x.dark ? 'dark' : ''}">
        <td class="t">${pad(x.hour)}:00${x.dark ? ' ☾' : ''}</td>
        <td class="${x.tide ? (x.tide.rising ? 'rise' : 'fall') : ''}">${x.tide ? (x.tide.rising ? '▲ 漲' : '▼ 退') : '—'}</td>
        <td>${x.tideH == null ? '—' : Math.round(x.tideH)}</td>
        ${sp.boat ? `<td>${x.ok ? '✅' : '⛔'}</td>` : ''}
        <td style="white-space:nowrap">${arrow(x.wd)} ${dirName(x.wd).replace('風', '')} ${beaufort(x.ws) ?? '—'}級<small class="opt"> ${fmt1(x.ws)}</small></td>
        <td class="opt">${fmt1(x.wg)}</td>
        <td>${x.wave == null ? '—' : fmt1(x.wave)}${x.wper ? `<small class="opt"> / ${Math.round(x.wper)}s</small>` : ''}</td>
        <td>${x.pp ?? '—'}%${x.pr ? `<small> ${fmt1(x.pr)}mm</small>` : ''}</td>
        <td>${ic}<span class="opt"> ${wt}</span></td>
        <td class="opt">${fmt1(x.temp)}°</td>
        <td>${x.ok ? Math.round(clamp(x.ev.score, 0, 100)) : '—'}</td></tr>`;
    });
    $('detail').innerHTML = `
      <div class="detail-head">
        <h2 style="border-left:6px solid ${sp.color};padding-left:8px">${sp.name} <small class="kind">${kindOf(sp)}</small>　${dlabel(d.date)}${d.di === 0 ? ' 今天' : ''}</h2>
        <div><span class="r ${d.rating.cls}" style="font-size:15px">${d.rating.txt} ${d.score ?? ''}</span>　${moonIcon(d.info.lunarDay)} 農曆 ${d.info.lunar}　<span class="range-${d.info.range}">${RANGE_TXT[d.info.range] || ''}</span>${d.isRain ? `　<span class="rain-tag${d.thunder ? ' thunder' : ''}">${d.thunder ? '⛈ 雷雨' : '🌧 預估下雨'}</span>` : ''}</div>
      </div>
      <h3>潮汐曲線（${sp.tide}${d.tideSrc === 'model' ? '，模型推估' : '，中央氣象署'}）　<small style="font-weight:400;color:#64748b"><span style="color:#15803d">綠線＝漲潮</span>　<span style="color:#c2410c">橘線＝退潮</span>　黃底＝建議時段　灰底＝夜間　單位 cm（相對平均海平面）</small></h3>
      <div class="tidechart">${tideSvg(m, d)}</div>
      ${boat}
      <div class="detail-grid">
        <div>
          <h3>${sp.fish}出釣建議</h3>
          <div class="advice">${adv}</div>
        </div>
        <div>
          <h3>分數怎麼來（建議時段平均）</h3>
          <ul class="reasons">${reasonRows(sp, d) || '<li>這天沒有可釣時段</li>'}</ul>
        </div>
      </div>
      <h3>逐時資料（黃底＝建議時段${sp.boat ? '，灰字＝乾潮前後不能開船' : ''}）</h3>
      <div class="table-wrap"><table class="hours"><thead><tr><th>時間</th><th>潮</th><th>潮高</th>${sp.boat ? '<th>出船</th>' : ''}<th>風</th><th class="opt">陣風</th><th>浪 m</th><th>降雨</th><th>天氣</th><th class="opt">氣溫</th><th>分數</th></tr></thead><tbody>${rows}</tbody></table></div>
      <button type="button" class="back-btn" id="backBtn">⬆ 回到兩週總覽</button>`;
    $('backBtn').addEventListener('click', () => $('heatmap').scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function renderRefs() {
    const sp = SPOT[state.sel.spot];
    $('refs').innerHTML = `
      <div><h3>釣點的原始網站</h3><ul>
        ${shown().map(({ spot: s }) => `<li><b>${s.name}</b>：<a href="https://www.windguru.cz/${s.wg}" target="_blank" rel="noopener">Windguru ${s.wgName}</a>、<a href="https://www.cwa.gov.tw/V8/C/M/Fishery/tide_30day_MOD/${s.tideId}.html" target="_blank" rel="noopener">氣象署潮汐（${s.tide}）</a></li>`).join('')}
      </ul></div>
      <div><h3>出發前再看一眼</h3><ul>
        <li><a href="https://www.cwa.gov.tw/V8/C/W/OBS_Radar.html" target="_blank" rel="noopener">氣象署雷達回波</a>（看雨帶有沒有往釣點移動）</li>
        <li><a href="https://www.cwa.gov.tw/V8/C/W/analysis.html" target="_blank" rel="noopener">地面天氣圖</a>（看鋒面、東北季風）</li>
        <li><a href="https://www.cwa.gov.tw/V8/C/W/warning.html" target="_blank" rel="noopener">天氣警特報</a>（強風、豪雨、海上警報）</li>
        <li><a href="https://www.windguru.cz/${sp.wg}" target="_blank" rel="noopener">目前選的釣點 Windguru</a></li>
      </ul></div>
      <div><h3>黑鯛小抄</h3><ul>
        <li>適溫約 18–25°C，水溫驟降（冷鋒後）咬口差。</li>
        <li>喜歡有流動、略混濁的水；漲潮中段到滿潮前通常最好。</li>
        <li>警戒心高：陰天、小雨、晨昏比大太陽好。</li>
        <li>蚵棚、堤邊、河口常見；常用餌：蝦、沙蠶、蚵肉、小螃蟹。</li>
        <li>小潮水流緩最好釣；中潮、大潮水流快，挑轉流前後下竿、鉛要加重。</li>
      </ul></div>`;
  }

  function renderSettings() {
    const el = $('settings');
    if (el.dataset.ready) return;
    el.dataset.ready = '1';
    el.innerHTML = `
      <div class="explain"><b>開船限制（固定）</b><ul>
        ${SPOTS.filter(s => s.boat).map(s => `<li>${s.name}：乾潮前後 ${blockHours(s)} 小時水太淺，不能開船。</li>`).join('')}
        <li>布袋南港內：水位高低影響小，不限制開船時間。</li>
      </ul></div>
      <div class="explain"><b>評分方式（船釣以黑鯛為準，岸釣不限魚種）</b><ul>
        <li>七股西寮、安平港為岸釣：不受乾潮限制；浪的扣分七股算 6 成、安平港在港內算 4 成。</li>
        <li>每天在 04:00–21:00、<b>可以開船</b>的時段中，找平均分數最高的連續 3 小時當「建議時段」，再加上潮差分。</li>
        <li>基本分 ${BASE}。潮流：漲潮中段 +10、滿潮前 +5、剛退潮 +5、平潮 −3。</li>
        <li>潮差：小潮 +${RANGE_BONUS.small}（水流緩、最好釣）、中潮 ${RANGE_BONUS.mid}、大潮 ${String(RANGE_BONUS.big).replace('-', '−')}（水流很快、難釣）。</li>
        <li>風：2 級以下 +4、4 級 −10、5 級 −25、6 級 −45（且總分最多 40）；陣風 6 級以上再扣。</li>
        <li>彰濱八仙：北風 +8、南風 −18（最差風向）。</li>
        <li>浪：0.6 m 內不扣，1 m −6、1.5 m −15、2 m −28；布袋南港內在港內，浪的影響只算約三分之一。</li>
        <li>雨：毛毛雨 −3（黑鯛不怕小雨）、1 mm/h −10、4 mm/h −20、10 mm/h −35、雷雨 −40（且總分最多 35）。</li>
        <li><b>海水溫（黑鯛）</b>：19–24°C +8（最活躍）、17–19 / 24–26°C +3 / +4、26–27°C 0、27–28°C −5、28–29°C −10、29°C 以上 −15；17°C 以下 −10、15°C 以下 −20、13°C 以下 −30。</li>
        <li><b>水溫變化（黑鯛）</b>：一天內降 0.8°C −5、降 1.5°C 以上 −10（冷鋒、冷水進來會停口）；20°C 以下回暖 0.8°C +3。</li>
        <li>岸釣海水溫：17–27°C 不扣，偏冷、偏熱小扣；水溫驟降扣一半。</li>
        <li>晨昏 +5、深夜 −5；鋒面前降壓 +3、冷鋒後回升 −8；起霧 −12。</li>
        <li>預估下雨的日子：日雨量 ≥ 1 mm 或降雨機率 ≥ 60%，標 🌧；有雷雨標 ⛈。</li>
      </ul></div>`;
  }

  function openDetail(spot, date) {
    state.sel = { spot, date, user: true };
    if (state.settings.mode !== 'full') { state.settings.mode = 'full'; saveSettings(); }
    render();
    $('detailPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ------------------------------------------------------------------ refresh
  async function refresh() {
    const btn = $('refreshBtn');
    btn.disabled = true;
    btn.textContent = '更新中…';
    state.error = '';
    try {
      const [wx] = await Promise.all([fetchWeather(), reloadTide()]);
      state.wx = wx;
      saveCache();
    } catch (e) {
      state.error = '天氣資料抓取失敗（' + (e.message || e) + '），' + (state.wx ? '先顯示上次的資料' : '請檢查網路後再按「更新資料」');
    }
    rebuild();
    scheduleAuto();
    render();
    btn.disabled = false;
    btn.textContent = '更新資料';
  }

  // auto refresh at 00 / 06 / 12 / 18 Taipei time while the page is open
  const AUTO_HOURS = [0, 6, 12, 18];
  let autoTimer = null;
  function slotAround(ms) {
    const d = new Date(ms), h = d.getUTCHours();
    const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const prev = Math.max(...AUTO_HOURS.filter(x => x <= h));
    const next = AUTO_HOURS.find(x => x > h);
    return { last: day + prev * H, next: next == null ? day + D : day + next * H };
  }
  function scheduleAuto() {
    clearTimeout(autoTimer);
    const now = nowL(), next = slotAround(now).next;
    state.nextAuto = next;
    autoTimer = setTimeout(() => { if (!$('refreshBtn').disabled) refresh(); }, next - now + 5000);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || $('refreshBtn').disabled) return;
    const fetched = state.wx ? state.wx.fetched + 8 * H : 0;
    if (fetched < slotAround(nowL()).last) refresh();
  });

  document.querySelectorAll('.mode-switch button').forEach(b => b.addEventListener('click', () => {
    state.settings.mode = b.dataset.mode;
    saveSettings();
    render();
  }));
  $('refreshBtn').addEventListener('click', refresh);

  function renderPick() {
    const on = state.settings.spots;
    $('spotPick').innerHTML = SPOTS.map(s => `<button type="button" role="checkbox" aria-checked="${on.includes(s.key)}" class="pick${on.includes(s.key) ? ' on' : ''}" style="--c:${s.color}" data-pick="${s.key}">
      <span class="box"></span>${s.name}${s.shore ? '<small>岸</small>' : ''}</button>`).join('');
    $('spotPick').querySelectorAll('button[data-pick]').forEach(btn => btn.addEventListener('click', () => {
      const k0 = btn.dataset.pick;
      const next = SPOTS.map(s => s.key).filter(k => k === k0 ? !on.includes(k) : on.includes(k));
      if (!next.length) return;   // keep at least one spot
      state.settings.spots = next;
      saveSettings();
      renderPick();
      if (state.model) pickBest();
      render();
    }));
  }
  renderPick();

  function renderVer(views) {
    $('verInfo').textContent = `版次 ${VERSION}（${VERSION_DATE.slice(5).replace('-', '/')}）` + (views != null ? `｜瀏覽 ${views.toLocaleString()} 次` : '');
  }
  // only the published page counts a view, once per browser session; local copies just read the number
  async function loadViews() {
    let mode = 'get';
    try { if (/github\.io$/.test(location.hostname) && !sessionStorage.getItem('fw-counted')) mode = 'hit'; } catch (e) { }
    try {
      const r = await fetch(`${COUNTER_URL}/${mode}/${COUNTER_KEY}`, { cache: 'no-store' });
      if (r.status === 404) { renderVer(0); return; }   // counter not created until the first published visit
      if (!r.ok) return;
      const j = await r.json();
      if (mode === 'hit') try { sessionStorage.setItem('fw-counted', '1'); } catch (e) { }
      if (typeof j.value === 'number') renderVer(j.value);
    } catch (e) { }
  }
  renderVer(null);
  loadViews();

  let wasNarrow = isNarrow();
  window.addEventListener('resize', () => {
    if (isNarrow() === wasNarrow) return;
    wasNarrow = isNarrow();
    render();
  });

  rebuild();
  render();
  refresh();
})();
