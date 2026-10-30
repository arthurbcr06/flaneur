/* Flâneur — calcul des journées (ordre optimisé, horaires, repas, répartition sur plusieurs jours) */
(function () {
  'use strict';
  const P = {};

  P.PACE = { calme: { mult: 1.25, perDay: 4 }, normal: { mult: 1, perDay: 6 }, intense: { mult: 0.8, perDay: 8 } };
  P.MODE_LABEL = { walk: 'À pied', transit: 'Transports', car: 'Voiture', bike: 'Vélo' };

  P.hav = function (a, b) {
    const R = 6371, r = Math.PI / 180;
    const dLa = (b.lat - a.lat) * r, dLo = (b.lng - a.lng) * r;
    const x = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLo / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
  };
  P.toMin = s => { const m = /^(\d{1,2}):(\d{2})/.exec(s || ''); return m ? (+m[1]) * 60 + (+m[2]) : 0; };
  P.fmtT = m => { m = Math.round(m); const h = Math.floor(m / 60), mm = ((m % 60) + 60) % 60; return String(((h % 24) + 24) % 24).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); };
  P.fmtDur = m => { m = Math.max(0, Math.round(m)); if (m < 60) return m + ' min'; const h = Math.floor(m / 60), r = m % 60; return h + ' h' + (r ? ' ' + String(r).padStart(2, '0') : ''); };
  P.fmtKm = k => (k < 1 ? Math.round(k * 1000 / 10) * 10 + ' m' : (k < 10 ? (Math.round(k * 10) / 10).toFixed(1) : String(Math.round(k))).replace('.', ',') + ' km');
  P.fmtM = m => m < 1000 ? (m < 100 ? Math.max(10, Math.round(m / 10) * 10) : Math.round(m / 50) * 50) + ' m' : (Math.round(m / 100) / 10).toFixed(1).replace('.', ',') + ' km';
  P.key = p => p.lat.toFixed(5) + ',' + p.lng.toFixed(5);
  P.profileOf = mode => mode === 'car' ? 'car' : mode === 'bike' ? 'bike' : 'foot';

  /* Durées réelles connues (remplies par les itinéraires OSRM) */
  P.legCache = new Map();
  P.setLeg = (a, b, profile, km, min) => P.legCache.set(P.key(a) + '|' + P.key(b) + '|' + profile, { km, min });

  let tcache = new Map();
  P.travel = function (a, b, mode) {
    const k = P.key(a) + '|' + P.key(b) + '|' + mode;
    let r = tcache.get(k); if (r) return r;
    const d = P.hav(a, b);
    if (d < 0.03) { r = { km: 0, min: 0, mode: 'walk', real: true }; tcache.set(k, r); return r; }
    const prof = P.profileOf(mode);
    const real = P.legCache.get(P.key(a) + '|' + P.key(b) + '|' + prof);
    const walk = (real && prof === 'foot') ? { km: real.km, min: real.min, mode: 'walk', real: true } : { km: d * 1.3, min: d * 1.3 / 4.6 * 60 + 1, mode: 'walk' };
    const transit = { km: d * 1.25, min: d * 1.25 / 19 * 60 + 9, mode: 'transit' };
    if (mode === 'walk') r = walk;
    else if (mode === 'transit') r = d < 0.6 ? walk : transit;
    else if (mode === 'mix') r = (walk.min <= 20 || walk.min <= transit.min) ? walk : transit;
    else if (mode === 'car') r = real ? { km: real.km, min: real.min + 4, mode: 'car', real: true } : { km: d * 1.4, min: d * 1.4 / 24 * 60 + 6, mode: 'car' };
    else r = real ? { km: real.km, min: real.min, mode: 'bike', real: true } : { km: d * 1.3, min: d * 1.3 / 13 * 60 + 2, mode: 'bike' };
    tcache.set(k, r); return r;
  };

  let PACE_MULT = 1;
  P.durEff = p => Math.max(5, Math.round(p.dur * PACE_MULT / 5) * 5);

  P.meals = function (S) {
    const m = [];
    if (S.lunch.on) m.push({ key: 'lunch', label: 'Déjeuner', from: P.toMin(S.lunch.from), to: P.toMin(S.lunch.to), dur: +S.lunch.dur });
    if (S.dinner.on) m.push({ key: 'dinner', label: 'Dîner', from: P.toMin(S.dinner.from), to: P.toMin(S.dinner.to), dur: +S.dinner.dur });
    return m;
  };

  function dayItems(places, ctx) {
    const items = places.map(p => Object.assign({}, p, { kind: 'place', d: P.durEff(p) }));
    const mp = items.filter(i => i.meal);
    ctx.meals.forEach((m, i) => {
      if (mp[i]) { mp[i].kind = 'mealplace'; mp[i].mealW = m; }
      else items.push({ id: 'flex-' + m.key, kind: 'flex', name: m.label, mealW: m, d: m.dur });
    });
    return items;
  }

  function simulate(order, ctx) {
    let t = ctx.start, pos = ctx.hotel, km = 0, tr = 0, pen = 0;
    const steps = [];
    for (const it of order) {
      if (it.kind === 'flex') {
        const w = it.mealW; let wait = 0;
        if (t < w.from) { wait = w.from - t; t = w.from; }
        const late = Math.max(0, t - (w.to - w.dur));
        steps.push({ it, leg: null, start: t, end: t + w.dur, wait, late, at: pos });
        t += w.dur; pen += wait * 0.6 + late * 6; continue;
      }
      const leg = P.travel(pos, it, ctx.mode);
      t += leg.min; km += leg.km; tr += leg.min;
      const open = P.toMin(it.open); let close = P.toMin(it.close); if (close <= open) close += 1440;
      let wait = 0, late = 0, dur = it.d;
      if (it.kind === 'mealplace') {
        const w = it.mealW; dur = w.dur;
        const o = Math.max(open, w.from);
        if (t < o) { wait = o - t; t = o; }
        late = Math.max(0, t - (w.to - w.dur)) + Math.max(0, t + dur - close);
      } else {
        if (t < open) { wait = open - t; t = open; }
        late = Math.max(0, t + dur - close);
      }
      const closed = (it.closed || []).includes(ctx.weekday);
      steps.push({ it, leg, from: pos, start: t, end: t + dur, wait, late, closed });
      t += dur; pos = it; pen += wait * 0.5 + late * 10 + (closed ? 3000 : 0);
    }
    const back = P.travel(pos, ctx.hotel, ctx.mode);
    km += back.km; tr += back.min; t += back.min;
    const over = Math.max(0, t - ctx.end);
    pen += over * 8;
    return { steps, back, last: pos, endT: t, km, tr, over, cost: tr + pen, order };
  }
  P.simulate = simulate;

  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  function permuteBest(items, ctx) {
    const a = items.slice(), n = a.length, c = new Array(n).fill(0);
    let best = simulate(a.slice(), ctx), i = 0;
    while (i < n) {
      if (c[i] < i) {
        if (i % 2 === 0) { const x = a[0]; a[0] = a[i]; a[i] = x; } else { const x = a[c[i]]; a[c[i]] = a[i]; a[i] = x; }
        const r = simulate(a.slice(), ctx); if (r.cost < best.cost) best = r;
        c[i]++; i = 0;
      } else { c[i] = 0; i++; }
    }
    return best;
  }

  function greedy(items, ctx) {
    const flex = items.filter(i => i.kind === 'flex'), rest = items.filter(i => i.kind !== 'flex');
    let pos = ctx.hotel; const out = [];
    while (rest.length) {
      let bi = 0, bd = Infinity;
      rest.forEach((p, i) => { const d = P.travel(pos, p, ctx.mode).min; if (d < bd) { bd = d; bi = i; } });
      pos = rest[bi]; out.push(rest.splice(bi, 1)[0]);
    }
    for (const f of flex) {
      let best = null;
      for (let j = 0; j <= out.length; j++) { const o = out.slice(); o.splice(j, 0, f); const r = simulate(o, ctx); if (!best || r.cost < best.cost) best = r; }
      out.splice(0, out.length, ...best.order);
    }
    return out;
  }

  function optimize(items, ctx) {
    const n = items.length;
    if (n === 0) return simulate([], ctx);
    if (n <= 7) return permuteBest(items, ctx);
    const R = rng(7); let best = null;
    const restarts = n > 12 ? 8 : 12;
    for (let r = 0; r < restarts; r++) {
      let o = r === 0 ? greedy(items, ctx) : items.slice().sort(() => R() - 0.5);
      let cur = simulate(o, ctx), improved = true;
      while (improved) {
        improved = false;
        outer: for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          if (i === j) continue;
          const o2 = o.slice(); const x = o2.splice(i, 1)[0]; o2.splice(j, 0, x);
          const r2 = simulate(o2, ctx);
          if (r2.cost < cur.cost - 1e-6) { o = o2; cur = r2; improved = true; break outer; }
          if (j > i + 1) {
            const o3 = o.slice(0, i).concat(o.slice(i, j + 1).reverse(), o.slice(j + 1));
            const r3 = simulate(o3, ctx);
            if (r3.cost < cur.cost - 1e-6) { o = o3; cur = r3; improved = true; break outer; }
          }
        }
      }
      if (!best || cur.cost < best.cost) best = cur;
    }
    return best;
  }

  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const centroid = ps => ps.length ? { lat: avg(ps.map(p => p.lat)), lng: avg(ps.map(p => p.lng)) } : null;
  P.centroid = centroid;

  function assignDays(places, ctxs) {
    const D = ctxs.length, H = ctxs[0].hotel;
    const buckets = ctxs.map(() => []), free = [];
    for (const p of places) { if (p.day > 0 && p.day <= D) buckets[p.day - 1].push(p); else free.push(p); }
    if (!free.length || D === 1) { free.forEach(p => buckets[0].push(p)); return buckets; }
    const k = Math.min(D, free.length);
    const seeds = [];
    const first = free.reduce((a, b) => P.hav(H, b) > P.hav(H, a) ? b : a);
    seeds.push({ lat: first.lat, lng: first.lng });
    while (seeds.length < k) {
      let far = null, fd = -1;
      for (const p of free) { const d = Math.min(...seeds.map(s => P.hav(s, p))); if (d > fd) { fd = d; far = p; } }
      seeds.push({ lat: far.lat, lng: far.lng });
    }
    let lab = [];
    for (let it = 0; it < 20; it++) {
      lab = free.map(p => { let b = 0, bd = Infinity; seeds.forEach((s, j) => { const d = P.hav(s, p); if (d < bd) { bd = d; b = j; } }); return b; });
      seeds.forEach((s, j) => { const m = free.filter((_, i) => lab[i] === j); if (m.length) { s.lat = avg(m.map(x => x.lat)); s.lng = avg(m.map(x => x.lng)); } });
    }
    free.forEach((p, i) => buckets[lab[i]].push(p));
    for (let d = 0; d < D; d++) {
      for (const p of buckets[d].slice()) {
        if (p.day > 0 || !(p.closed || []).includes(ctxs[d].weekday)) continue;
        let best = -1, bd = Infinity;
        for (let e = 0; e < D; e++) { if ((p.closed || []).includes(ctxs[e].weekday)) continue; const c = centroid(buckets[e]) || H; const dd = P.hav(c, p); if (dd < bd) { bd = dd; best = e; } }
        if (best >= 0) { buckets[d].splice(buckets[d].indexOf(p), 1); buckets[best].push(p); }
      }
    }
    const cap = ctxs.map(c => c.end - c.start - c.meals.reduce((a, m) => a + m.dur, 0));
    const load = b => b.reduce((a, p) => a + P.durEff(p) + 18, 25);
    for (let iter = 0; iter < 80; iter++) {
      const L = buckets.map(load), ex = L.map((l, i) => l - cap[i]);
      const d = ex.indexOf(Math.max(...ex));
      const targets = [...ex.keys()].filter(i => i !== d).sort((a, b) => ex[a] - ex[b]);
      let moved = false;
      for (const e of targets) {
        const gap = ex[d] - ex[e];
        if (!(ex[d] > 0 || gap > 180)) break;
        const c = centroid(buckets[e]) || H;
        const cands = buckets[d].filter(p => !(p.day > 0) && !(p.closed || []).includes(ctxs[e].weekday));
        if (!cands.length) continue;
        const p = cands.reduce((a, b) => P.hav(c, b) < P.hav(c, a) ? b : a);
        if (P.durEff(p) + 18 >= gap) continue;
        buckets[d].splice(buckets[d].indexOf(p), 1); buckets[e].push(p); moved = true; break;
      }
      if (!moved) break;
    }
    return buckets;
  }

  const isBad = r => r.over > 10 || r.steps.some(s => s.late > 20 || s.closed);

  P.addDays = function (iso, n) { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d; };

  /* Calcule tout le séjour. S = état de l'appli. */
  P.planTrip = function (S) {
    tcache = new Map();
    PACE_MULT = (P.PACE[S.pace] || P.PACE.normal).mult;
    const ok = S.places.filter(p => isFinite(p.lat) && isFinite(p.lng));
    if (!ok.length) return null;
    let H;
    if (S.hotel) H = { id: 'hotel', name: S.hotel.name, lat: S.hotel.lat, lng: S.hotel.lng, isHotel: true };
    else { const c = centroid(ok); H = { id: 'hotel', name: 'Point de départ', lat: c.lat, lng: c.lng, isHotel: true, guessed: true }; }
    const D = Math.max(1, S.days);
    const ms = P.meals(S);
    const ctxs = [...Array(D)].map((_, i) => { const date = P.addDays(S.start, i); return { hotel: H, start: P.toMin(S.dstart), end: P.toMin(S.dend), mode: S.transport, weekday: date.getDay(), meals: ms, date }; });

    // Ordre déjà fixé (journée recalculée avec les vrais temps) : on garde l'affectation des jours
    const buckets = assignDays(ok, ctxs);
    let res = buckets.map((ps, i) => optimize(dayItems(ps, ctxs[i]), ctxs[i]));
    const left = [];
    res = res.map((r, i) => {
      let guard = 0;
      while (isBad(r) && guard++ < 30) {
        const cands = r.order.filter(it => it.kind === 'place' && !it.must);
        if (!cands.length) break;
        let bR = null, bIt = null;
        for (const it of cands) { const rr = simulate(r.order.filter(x => x !== it), ctxs[i]); if (!bR || rr.cost < bR.cost) { bR = rr; bIt = it; } }
        left.push(bIt); r = bR;
      }
      return r;
    });
    const stillLeft = [];
    for (const it of left) {
      let best = null, bd = -1;
      for (let d = 0; d < D; d++) {
        if ((it.closed || []).includes(ctxs[d].weekday)) continue;
        const o = res[d].order;
        for (let j = 0; j <= o.length; j++) {
          const o2 = o.slice(); o2.splice(j, 0, it);
          const r2 = simulate(o2, ctxs[d]);
          if (!isBad(r2) && (!best || r2.cost - res[d].cost < best.cost - res[bd].cost)) { best = r2; bd = d; }
        }
      }
      if (best) res[bd] = optimize(best.order, ctxs[bd]); else stillLeft.push(it);
    }
    return { H, days: res.map((r, i) => ({ ctx: ctxs[i], r })), left: stillLeft };
  };

  /* Re-simule une journée dans le même ordre (après réception des vrais temps de trajet) */
  P.resimulate = function (day) { tcache = new Map(); day.r = simulate(day.r.order, day.ctx); return day; };

  /* Horaires OSM simplifiés : premier créneau + jours fermés évidents */
  const DAYS = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 };
  P.parseOpeningHours = function (s) {
    if (!s || typeof s !== 'string') return null;
    if (/24\/7/.test(s)) return { open: '00:00', close: '23:59', closed: [] };
    const m = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(s);
    if (!m) return null;
    const pad = (h, mi) => String(Math.min(23, +h)).padStart(2, '0') + ':' + mi;
    let close = (+m[3] >= 24) ? '23:59' : pad(m[3], m[4]);
    const out = { open: pad(m[1], m[2]), close, closed: [] };
    const off = s.match(/\b(Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su))?\s+(off|closed)\b/g) || [];
    off.forEach(x => { const mm = /(Mo|Tu|We|Th|Fr|Sa|Su)(?:\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su))?/.exec(x); addRange(out.closed, mm[1], mm[2] || mm[1]); });
    const single = /^\s*(Mo|Tu|We|Th|Fr|Sa|Su)\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su)\s+\d/.exec(s);
    if (single && !/;/.test(s)) {
      const open = []; addRange(open, single[1], single[2]);
      for (let d = 0; d < 7; d++) if (!open.includes(d) && !out.closed.includes(d)) out.closed.push(d);
    }
    return out;
  };
  function addRange(arr, a, b) {
    const order = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    let i = order.indexOf(a); const j = order.indexOf(b);
    for (let n = 0; n < 7; n++) { const d = DAYS[order[i]]; if (!arr.includes(d)) arr.push(d); if (i === j) break; i = (i + 1) % 7; }
  }

  window.Planner = P;
})();
