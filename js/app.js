/* Flâneur — application : état, carte, panneaux, guidage */
(function () {
  'use strict';
  const P = window.Planner, SV = window.Services;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => 'p' + Math.random().toString(36).slice(2, 9);
  const isoDate = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const dayLabel = d => d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const dayShort = d => d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
  const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

  const INTERESTS = { incontournable: 'Incontournables', histoire: 'Histoire', musees: 'Musées', vues: 'Points de vue', bains: 'Bains & spas', parcs: 'Parcs & nature', quartiers: 'Quartiers', food: 'Bonnes adresses', nuit: 'Vie nocturne', shopping: 'Shopping', insolite: 'Insolite' };
  const DURS = [10, 15, 20, 30, 45, 60, 75, 90, 120, 150, 180, 240];
  const DOW = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam'];
  const KEY = 'flaneur-app-v1';

  /* ================= état ================= */
  function example() {
    const mk = (name, lat, lng, dur, open, close, closed, cats, why, meal) => ({ id: uid(), name, lat, lng, dur, open, close, closed, cats, why, meal: !!meal, must: false, day: 0, src: 'ex' });
    return [
      mk('Parlement hongrois', 47.50712, 19.04568, 90, '08:00', '18:00', [], ['incontournable', 'histoire'], "Visite guidée de l'intérieur, à réserver à l'avance."),
      mk('Chaussures au bord du Danube', 47.50440, 19.04492, 15, '00:00', '23:59', [], ['histoire'], 'Mémorial aux victimes de 1944-45.'),
      mk('Bastion des Pêcheurs', 47.50221, 19.03475, 40, '00:00', '23:59', [], ['vues'], 'La plus belle vue sur le Parlement.'),
      mk('Église Matthias', 47.50196, 19.03424, 40, '09:00', '17:00', [], ['histoire'], 'Toit en tuiles colorées.'),
      mk('Château de Buda', 47.49621, 19.03962, 75, '00:00', '23:59', [], ['histoire', 'vues'], 'Cours et terrasses en accès libre.'),
      mk('Basilique Saint-Étienne', 47.50085, 19.05395, 50, '09:00', '17:45', [], ['incontournable'], 'Monte à la coupole pour la vue.'),
      mk("Opéra d'État hongrois", 47.50262, 19.05843, 50, '10:00', '17:00', [], ['histoire'], 'Visites guidées des salons.'),
      mk('Place des Héros', 47.51497, 19.07776, 25, '00:00', '23:59', [], ['incontournable'], "À l'entrée du Városliget."),
      mk('Bains Széchenyi', 47.51885, 19.08196, 150, '07:00', '22:00', [], ['bains'], 'Prévoir serviette et tongs.'),
      mk('Grande Synagogue', 47.49590, 19.06068, 60, '10:00', '18:00', [6], ['histoire'], 'Fermée le samedi.'),
      mk('Grand Marché couvert', 47.48702, 19.05870, 60, '06:00', '18:00', [0], ['food'], "Comptoirs pour manger à l'étage.", true),
      mk('Karaván street food', 47.49852, 19.06230, 50, '11:30', '23:00', [], ['food'], 'Cour de food trucks.', true)
    ];
  }
  function defaultState() {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return {
      v: 1, example: true, city: 'Budapest', center: { lat: 47.4979, lng: 19.0544 },
      hotel: { name: 'Hôtel près de Deák tér', lat: 47.49790, lng: 19.05440 },
      start: isoDate(d), days: 2, dstart: '09:00', dend: '19:00', transport: 'mix', pace: 'normal',
      lunch: { on: true, from: '12:00', to: '14:00', dur: 60 }, dinner: { on: false, from: '19:00', to: '21:30', dur: 75 },
      interests: ['incontournable', 'histoire', 'vues', 'bains'], places: example(), done: [], selDay: 0, p3d: true
    };
  }
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
  if (!S || !Array.isArray(S.places)) S = defaultState();
  S = Object.assign(defaultState(), S);
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { } }

  let plan = null, dayRoutes = [], tab = 'map', selected = null, discCands = [];

  function toast(msg, ms) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), ms || 3200);
  }

  /* ================= carte ================= */
  const map = new maplibregl.Map({
    container: 'map', style: 'https://tiles.openfreemap.org/styles/liberty',
    center: [S.center ? S.center.lng : 19.0544, S.center ? S.center.lat : 47.4979], zoom: 13,
    pitch: S.p3d ? 50 : 0, maxPitch: 70, attributionControl: false
  });
  map.addControl(new maplibregl.AttributionControl({ compact: true, customAttribution: 'Itinéraires <a href="https://routing.openstreetmap.de/about.html" target="_blank" rel="noopener">FOSSGIS / OSRM</a>' }), 'bottom-left');
  let mapReady = false;
  map.on('load', () => {
    mapReady = true;
    frenchLabels();
    const empty = { type: 'FeatureCollection', features: [] };
    map.addSource('dayroute', { type: 'geojson', data: empty });
    map.addSource('navroute', { type: 'geojson', data: empty });
    const before = (map.getStyle().layers.find(l => l.type === 'symbol') || {}).id;
    map.addLayer({ id: 'day-casing', type: 'line', source: 'dayroute', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 9, 'line-opacity': 0.9 } }, before);
    map.addLayer({ id: 'day-line', type: 'line', source: 'dayroute', filter: ['!=', ['get', 'mode'], 'transit'], layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['case', ['get', 'done'], '#8C97A8', '#0B7A84'], 'line-width': 5 } }, before);
    map.addLayer({ id: 'day-transit', type: 'line', source: 'dayroute', filter: ['==', ['get', 'mode'], 'transit'], layout: { 'line-join': 'round' }, paint: { 'line-color': ['case', ['get', 'done'], '#8C97A8', '#0B7A84'], 'line-width': 5, 'line-dasharray': [1.6, 1.4] } }, before);
    map.addLayer({ id: 'nav-casing', type: 'line', source: 'navroute', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffffff', 'line-width': 13 } }, before);
    map.addLayer({ id: 'nav-line', type: 'line', source: 'navroute', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0B7A84', 'line-width': 8 } }, before);
    drawDay(true);
  });
  map.on('error', e => { if (e && e.error && /Failed to fetch|NetworkError/.test(String(e.error.message))) toast('Carte indisponible : vérifie ta connexion.'); });

  function frenchLabels() {
    for (const l of map.getStyle().layers) {
      if (l.type !== 'symbol' || !l.layout || !l.layout['text-field']) continue;
      const tf = JSON.stringify(l.layout['text-field']);
      if (!/name/.test(tf) || /housenumber|ref/.test(tf)) continue;
      try { map.setLayoutProperty(l.id, 'text-field', ['coalesce', ['get', 'name:fr'], ['get', 'name:latin'], ['get', 'name']]); } catch (e) { }
    }
  }

  function setOverlay() {
    const mobile = !matchMedia('(min-width: 900px)').matches;
    const sheet = $('#sheet');
    const h = mobile && tab === 'map' && !sheet.hidden ? sheet.offsetHeight + $('#tabbar').offsetHeight : 0;
    document.documentElement.style.setProperty('--overlay-b', h + 'px');
  }
  if (window.ResizeObserver) new ResizeObserver(setOverlay).observe($('#sheet'));
  window.addEventListener('resize', () => { setOverlay(); });

  function mapPadding() {
    const mobile = !matchMedia('(min-width: 900px)').matches;
    return mobile ? { top: 130, bottom: (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--overlay-b')) || 300) + 20, left: 40, right: 70 } : { top: 130, bottom: 60, left: 60, right: 80 };
  }

  let markers = [];
  function clearMarkers() { markers.forEach(m => m.remove()); markers = []; }
  function pinEl(cls, txt, title) { const d = document.createElement('div'); d.className = 'pin ' + cls; d.textContent = txt; if (title) d.title = title; return d; }

  function currentDay() { return plan && plan.days[S.selDay]; }
  function dayStops(day) { return day ? day.r.steps.filter(s => s.it.kind !== 'flex') : []; }
  function nextStepIdx(day) { const st = dayStops(day); return st.findIndex(s => !S.done.includes(s.it.id)); }

  function drawDay(fit) {
    if (!mapReady) return;
    clearMarkers();
    const fc = { type: 'FeatureCollection', features: [] };
    const day = currentDay();
    if (selected && !selected.inPlan) {
      const el = pinEl('sel', '•', selected.name);
      markers.push(new maplibregl.Marker({ element: el }).setLngLat([selected.lng, selected.lat]).addTo(map));
    }
    if (!day) { map.getSource('dayroute').setData(fc); return; }
    const H = day.ctx.hotel;
    const stops = dayStops(day);
    const pts = [H].concat(stops.map(s => s.it), [H]);
    const rt = dayRoutes[S.selDay];
    const geomOk = rt && rt.key === routeKey(pts);
    const nextI = nextStepIdx(day);
    for (let i = 0; i < pts.length - 1; i++) {
      const legMode = i < stops.length ? (stops[i].leg ? stops[i].leg.mode : 'walk') : (day.r.back ? day.r.back.mode : 'walk');
      const coords = geomOk && rt.legs[i] && rt.legs[i].length > 1 ? rt.legs[i] : [[pts[i].lng, pts[i].lat], [pts[i + 1].lng, pts[i + 1].lat]];
      const done = i < stops.length && S.done.includes(stops[i].it.id);
      fc.features.push({ type: 'Feature', properties: { mode: legMode === 'transit' ? 'transit' : 'walk', done }, geometry: { type: 'LineString', coordinates: coords } });
    }
    map.getSource('dayroute').setData(fc);
    const hm = pinEl('hotel', 'H', H.name);
    markers.push(new maplibregl.Marker({ element: hm }).setLngLat([H.lng, H.lat]).addTo(map));
    stops.forEach((s, i) => {
      const done = S.done.includes(s.it.id);
      const el = pinEl((s.it.kind === 'mealplace' ? 'meal ' : '') + (done ? 'done ' : '') + (i === nextI ? 'next' : ''), done ? '✓' : String(i + 1), s.it.name);
      el.addEventListener('click', ev => { ev.stopPropagation(); selectPlace(Object.assign({}, s.it, { inPlan: true, stepIdx: i })); });
      markers.push(new maplibregl.Marker({ element: el }).setLngLat([s.it.lng, s.it.lat]).addTo(map));
    });
    if (fit) {
      const b = new maplibregl.LngLatBounds();
      pts.forEach(p => b.extend([p.lng, p.lat]));
      setOverlay();
      map.fitBounds(b, { padding: mapPadding(), maxZoom: 16, duration: 700, pitch: S.p3d ? 45 : 0 });
    }
  }

  /* ================= calcul + vrais itinéraires ================= */
  const routeKey = pts => P.profileOf(S.transport) + ':' + pts.map(P.key).join(';');
  let rcTimer = null, rtTimer = null;
  function recompute(fit) {
    clearTimeout(rcTimer);
    rcTimer = setTimeout(() => {
      plan = P.planTrip(S);
      if (plan && S.selDay >= plan.days.length) S.selDay = 0;
      renderAll(); drawDay(fit !== false);
      clearTimeout(rtTimer); rtTimer = setTimeout(fetchRoutes, 900);
    }, 150);
  }
  async function fetchRoutes() {
    if (!plan) return;
    const order = [S.selDay].concat(plan.days.map((_, i) => i).filter(i => i !== S.selDay));
    const snapshot = plan;
    for (const i of order) {
      if (plan !== snapshot) return;
      const day = plan.days[i];
      const stops = dayStops(day);
      if (!stops.length) continue;
      const pts = [day.ctx.hotel].concat(stops.map(s => s.it), [day.ctx.hotel]);
      const key = routeKey(pts);
      if (dayRoutes[i] && dayRoutes[i].key === key) continue;
      try {
        const profile = P.profileOf(S.transport);
        const route = await SV.route(profile, pts, true);
        const legs = route.legs.map((leg, li) => {
          P.setLeg(pts[li], pts[li + 1], profile, leg.distance / 1000, leg.duration / 60);
          const c = [];
          leg.steps.forEach(st => (st.geometry.coordinates || []).forEach(xy => { const l = c[c.length - 1]; if (!l || l[0] !== xy[0] || l[1] !== xy[1]) c.push(xy); }));
          return c;
        });
        if (plan !== snapshot) return;
        dayRoutes[i] = { key, legs };
        P.resimulate(day);
        day.realTimes = true;
        if (i === S.selDay) drawDay(false);
        renderProg(); renderSheet();
      } catch (e) { day.routeError = true; if (i === S.selDay) renderProg(); }
    }
  }

  /* ================= onglets ================= */
  function setTab(t) {
    tab = t;
    $$('#tabbar button').forEach(b => { if (b.dataset.tab === t) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    $('#sheet').hidden = t !== 'map';
    $('#panel-prog').hidden = t !== 'prog';
    $('#panel-plan').hidden = t !== 'plan';
    $('#panel-disc').hidden = t !== 'disc';
    if (t === 'map') { renderSheet(); setTimeout(() => { setOverlay(); map.resize(); }, 30); }
    if (t === 'prog') renderProg();
    if (t === 'disc') renderDisc();
  }
  $('#tabbar').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });

  /* ================= bandeau jours ================= */
  function renderDayChips() {
    const el = $('#day-chips');
    if (!plan || plan.days.length < 1) { el.innerHTML = ''; return; }
    el.innerHTML = plan.days.map((d, i) => `<button role="tab" aria-selected="${i === S.selDay}" data-day="${i}">Jour ${i + 1} · ${esc(dayShort(d.ctx.date))}</button>`).join('');
  }
  $('#day-chips').addEventListener('click', e => { const b = e.target.closest('[data-day]'); if (b) selectDay(+b.dataset.day); });
  function selectDay(i) { S.selDay = i; save(); selected = null; renderDayChips(); renderSheet(); renderProg(); drawDay(true); }

  /* ================= feuille Carte ================= */
  function renderSheet() {
    const el = $('#sheet');
    if (tab !== 'map') return;
    if (selected) { el.innerHTML = placeCard(selected); setOverlay(); return; }
    const exampleNote = S.example ? `<p class="small">Exemple : Budapest en 2 jours. <button class="linkbtn" data-act="go-plan">Planifier mon voyage</button></p>` : '';
    if (!plan) {
      el.innerHTML = `<div class="eyebrow">Bienvenue</div><div class="target"><div><h2>Où vas-tu flâner ?</h2><p>Ajoute tes lieux, ou laisse-moi te guider.</p></div></div>
        <div class="btnrow"><button class="btn dark" data-act="go-plan">Planifier</button><button class="btn" data-act="go-disc">Découvrir</button></div>`;
      setOverlay(); return;
    }
    const day = currentDay(), stops = dayStops(day), ni = nextStepIdx(day);
    if (!stops.length) { el.innerHTML = `<div class="eyebrow">Jour ${S.selDay + 1}</div><p class="small">Aucun lieu ce jour-là.</p>`; setOverlay(); return; }
    if (ni < 0) {
      el.innerHTML = `<div class="top"><span class="eyebrow">Jour ${S.selDay + 1} terminé</span><span class="time">${P.fmtT(day.r.endT)}</span></div>
        <div class="target"><span class="pin hotel">H</span><div><h2>Retour à l'hôtel</h2><p>${esc(day.ctx.hotel.name)}</p></div></div>
        <div class="btnrow"><button class="btn dark" data-act="nav-hotel">${ICON_GO}Y aller</button><button class="btn" data-act="reset-day">Recommencer la journée</button></div>`;
      setOverlay(); return;
    }
    const st = stops[ni];
    const leg = st.leg;
    const legTxt = leg && leg.min >= 1 ? `${P.MODE_LABEL[leg.mode]} · ${P.fmtDur(leg.min)} · ${P.fmtKm(leg.km)} · ` : '';
    const after = stops.slice(ni + 1, ni + 3).map(s => `<b>${esc(s.it.name)}</b> ${P.fmtT(s.start)}`).join(' · ');
    const flex = day.r.steps.find(s => s.it.kind === 'flex' && s.start >= (stops[ni - 1] ? stops[ni - 1].end : 0) - 1 && s.start <= st.start);
    el.innerHTML = `
      <div class="top"><span class="eyebrow">Prochaine étape · ${ni + 1} sur ${stops.length}</span><span class="time">${P.fmtT(st.start)}</span></div>
      <div class="target"><span class="pin ${st.it.kind === 'mealplace' ? 'meal' : ''}">${ni + 1}</span><div><h2>${esc(st.it.name)}</h2><p>${legTxt}${st.it.kind === 'mealplace' ? esc(st.it.mealW.label) : 'visite ' + P.fmtDur(st.end - st.start)}</p></div></div>
      <div class="btnrow"><button class="btn dark" data-act="nav-next">${ICON_GO}Y aller</button><button class="btn" data-act="done" data-id="${st.it.id}">C'est fait</button></div>
      ${flex ? `<p class="small">Avant : <b>${esc(flex.it.name)}</b> vers ${P.fmtT(flex.start)}</p>` : ''}
      ${after ? `<p class="small">Ensuite : ${after}</p>` : ''}
      ${exampleNote}`;
    setOverlay();
  }
  const ICON_GO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3 3 10.5l7.5 3 3 7.5z"/></svg>';

  function placeCard(p) {
    const inList = S.places.find(x => x.id === p.id || (Math.abs(x.lat - p.lat) < 1e-5 && Math.abs(x.lng - p.lng) < 1e-5));
    const hours = inList && !inList.hoursUnknown && !(inList.open === '00:00' && inList.close === '23:59') ? `Ouvert ${inList.open}–${inList.close}` : '';
    return `<div class="top"><span class="eyebrow">${p.inPlan ? 'Étape ' + (p.stepIdx + 1) + ' · Jour ' + (S.selDay + 1) : esc(p.label || 'Lieu')}</span><button class="iconbtn" data-act="close-sel" aria-label="Fermer">×</button></div>
      <div class="target"><div><h2>${esc(p.name)}</h2><p>${esc(p.sub || p.why || '')}${hours ? (p.sub || p.why ? ' · ' : '') + hours : ''}</p></div></div>
      <div class="btnrow">
        <button class="btn dark" data-act="nav-sel">${ICON_GO}Y aller</button>
        ${inList ? (p.inPlan ? `<button class="btn" data-act="done" data-id="${inList.id}">${S.done.includes(inList.id) ? 'Pas encore fait' : "C'est fait"}</button>` : `<button class="btn" data-act="remove-sel" data-id="${inList.id}">Retirer de mes lieux</button>`) : `<button class="btn" data-act="add-sel">Ajouter à mes lieux</button>`}
      </div>
      <p class="small"><a href="${SV.gmPlace(p, S.city)}" target="_blank" rel="noopener">Voir dans Google Maps ↗</a></p>`;
  }

  function selectPlace(p) {
    selected = p;
    if (tab !== 'map') setTab('map'); else renderSheet();
    drawDay(false);
    setOverlay();
    map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 15.5), padding: mapPadding(), duration: 600 });
  }

  $('#sheet').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    handleAct(b.dataset.act, b);
  });

  function handleAct(act, b) {
    const day = currentDay();
    if (act === 'go-plan') setTab('plan');
    else if (act === 'go-disc') setTab('disc');
    else if (act === 'close-sel') { selected = null; renderSheet(); drawDay(false); }
    else if (act === 'done') { toggleDone(b.dataset.id); }
    else if (act === 'reset-day') { const ids = dayStops(day).map(s => s.it.id); S.done = S.done.filter(id => !ids.includes(id)); save(); renderSheet(); drawDay(false); renderProg(); }
    else if (act === 'nav-next') {
      const stops = dayStops(day), ni = nextStepIdx(day);
      if (ni >= 0) startNav({ name: stops[ni].it.name, lat: stops[ni].it.lat, lng: stops[ni].it.lng, num: ni + 1, placeId: stops[ni].it.id, from: ni > 0 ? stops[ni - 1].it : day.ctx.hotel, legMode: stops[ni].leg ? stops[ni].leg.mode : 'walk' });
    }
    else if (act === 'nav-hotel') { const H = day.ctx.hotel; startNav({ name: H.name, lat: H.lat, lng: H.lng, num: 'H', from: dayStops(day).slice(-1)[0].it, legMode: day.r.back ? day.r.back.mode : 'walk' }); }
    else if (act === 'nav-sel' && selected) {
      const p = selected; startNav({ name: p.name, lat: p.lat, lng: p.lng, num: p.inPlan ? p.stepIdx + 1 : '•', placeId: p.inPlan ? p.id : null, from: S.hotel || null });
    }
    else if (act === 'add-sel' && selected) { addPlace(selected); renderSheet(); }
    else if (act === 'remove-sel') { removePlace(b.dataset.id); selected = null; renderSheet(); }
  }

  function toggleDone(id) {
    if (!id) return;
    if (S.done.includes(id)) S.done = S.done.filter(x => x !== id); else S.done.push(id);
    save(); if (selected && selected.inPlan) selected = null;
    renderSheet(); drawDay(false); renderProg();
  }

  /* ================= recherche sur la carte ================= */
  function attachSearch(input, list, onPick, biasFn) {
    let t = null, seq = 0;
    input.addEventListener('input', () => {
      clearTimeout(t);
      const q = input.value.trim();
      if (q.length < 2) { list.hidden = true; return; }
      t = setTimeout(async () => {
        const my = ++seq;
        list.hidden = false; list.innerHTML = '<li class="empty"><span class="spin"></span>Recherche…</li>';
        try {
          const res = await SV.search(q, biasFn());
          if (my !== seq) return;
          list.innerHTML = res.length ? res.map((r, i) => `<li><button data-i="${i}"><b>${esc(r.name)}</b><small>${esc(r.sub)}</small></button></li>`).join('') : '<li class="empty">Aucun résultat.</li>';
          list._res = res;
        } catch (e) { if (my === seq) list.innerHTML = '<li class="empty">Recherche indisponible. Vérifie ta connexion.</li>'; }
      }, 350);
    });
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-i]'); if (!b) return;
      const r = list._res[+b.dataset.i]; list.hidden = true; input.blur();
      onPick(r);
    });
    input.addEventListener('keydown', e => { if (e.key === 'Escape') list.hidden = true; });
    document.addEventListener('click', e => { if (!list.contains(e.target) && e.target !== input) list.hidden = true; });
  }
  const mapBias = () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; };
  const tripBias = () => S.hotel || S.center || mapBias();
  attachSearch($('#map-search'), $('#map-results'), r => {
    $('#map-search').value = '';
    const d = SV.describeTags(r.key, r.value, {});
    selectPlace({ name: r.name, sub: r.sub, lat: r.lat, lng: r.lng, osm: r.osm, key: r.key, value: r.value, label: d.label });
  }, mapBias);

  /* ================= lieux ================= */
  function placeFromResult(r) {
    const d = SV.describeTags(r.key, r.value, r.tags || {});
    return { id: uid(), name: r.name, lat: r.lat, lng: r.lng, dur: d.dur || 45, open: '00:00', close: '23:59', hoursUnknown: true, closed: [], cats: d.cats, meal: d.meal, why: r.why || '', must: false, day: 0, osm: r.osm || null, src: r.src || 'user' };
  }
  function addPlace(r, silent) {
    if (S.example) { S.places = S.places.filter(p => p.src !== 'ex'); S.example = false; S.done = []; dayRoutes = []; if (!silent) toast("L'exemple de Budapest est retiré : place à ton voyage."); }
    if (S.places.some(p => Math.abs(p.lat - r.lat) < 1e-5 && Math.abs(p.lng - r.lng) < 1e-5)) { if (!silent) toast('Déjà dans ta liste.'); return; }
    const p = r.id && r.dur ? Object.assign({}, r, { id: uid(), inPlan: undefined, stepIdx: undefined }) : placeFromResult(r);
    S.places.push(p); save();
    if (!silent) toast('« ' + p.name + ' » ajouté.');
    renderPlaces(); recompute(false);
    if (p.osm && p.hoursUnknown) enrich(p);
    return p;
  }
  async function enrich(p) {
    try {
      const tags = await SV.osmDetails(p.osm);
      if (!tags) return;
      const cur = S.places.find(x => x.id === p.id); if (!cur) return;
      const oh = P.parseOpeningHours(tags.opening_hours);
      if (oh) { cur.open = oh.open; cur.close = oh.close; cur.closed = oh.closed; cur.hoursUnknown = false; }
      if (tags['name:fr'] && cur.name === tags.name) cur.name = tags['name:fr'];
      save(); renderPlaces(); recompute(false);
    } catch (e) { }
  }
  function removePlace(id) { S.places = S.places.filter(p => p.id !== id); S.done = S.done.filter(x => x !== id); save(); renderPlaces(); recompute(false); }

  /* ================= panneau Planifier ================= */
  function bindPlan() {
    $('#f-city').value = S.city || '';
    $('#f-hotel').value = S.hotel ? S.hotel.name : '';
    $('#f-start').value = S.start;
    $('#f-dstart').value = S.dstart; $('#f-dend').value = S.dend;
    for (const [k, id] of [['lunch', 'l'], ['dinner', 'd']]) {
      $('#' + id + '-on').checked = S[k].on; $('#' + id + '-from').value = S[k].from; $('#' + id + '-to').value = S[k].to;
      $('#' + id + '-dur').innerHTML = [30, 45, 60, 75, 90, 120].map(m => `<option value="${m}" ${+S[k].dur === m ? 'selected' : ''}>${P.fmtDur(m)}</option>`).join('');
    }
    renderPlanState();
  }
  function renderPlanState() {
    $('#days-o').textContent = S.days + (S.days > 1 ? ' jours' : ' jour');
    $$('#f-transport button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.transport)));
    $$('#f-pace button, #d-pace button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.pace)));
    const hs = $('#hotel-state');
    if (S.hotel) { hs.className = 'hint ok'; hs.textContent = '✓ Localisé · départ et retour de chaque journée'; }
    else { hs.className = 'hint'; hs.textContent = 'Sans hôtel, les journées partent du centre de tes lieux.'; }
  }
  function changed(fit) { save(); renderPlanState(); recompute(fit); }

  $('#f-city').addEventListener('change', async e => {
    const name = e.target.value.trim(); S.city = name; save();
    if (!name) return;
    try { const c = await SV.findCity(name); if (c) { S.center = { lat: c.lat, lng: c.lng }; save(); map.flyTo({ center: [c.lng, c.lat], zoom: 12.5 }); } }
    catch (err) { toast('Ville introuvable pour le moment.'); }
  });
  attachSearch($('#f-hotel'), $('#hotel-results'), r => {
    S.hotel = { name: r.name, lat: r.lat, lng: r.lng }; $('#f-hotel').value = r.name;
    if (!S.city && r.sub) S.city = r.sub.split(',').slice(-2, -1)[0] || '';
    changed(true);
  }, tripBias);
  $('#f-hotel').addEventListener('change', e => { if (!e.target.value.trim()) { S.hotel = null; changed(true); } });
  $('#f-start').addEventListener('change', e => { if (e.target.value) { S.start = e.target.value; changed(false); } });
  $('#f-dstart').addEventListener('change', e => { if (e.target.value) { S.dstart = e.target.value; changed(false); } });
  $('#f-dend').addEventListener('change', e => { if (e.target.value) { S.dend = e.target.value; changed(false); } });
  for (const [k, id] of [['lunch', 'l'], ['dinner', 'd']]) {
    $('#' + id + '-on').addEventListener('change', e => { S[k].on = e.target.checked; changed(false); });
    $('#' + id + '-from').addEventListener('change', e => { if (e.target.value) { S[k].from = e.target.value; changed(false); } });
    $('#' + id + '-to').addEventListener('change', e => { if (e.target.value) { S[k].to = e.target.value; changed(false); } });
    $('#' + id + '-dur').addEventListener('change', e => { S[k].dur = +e.target.value; changed(false); });
  }
  $('#days-m').addEventListener('click', () => { if (S.days > 1) { S.days--; S.places.forEach(p => { if (p.day > S.days) p.day = 0; }); changed(true); renderPlaces(); } });
  $('#days-p').addEventListener('click', () => { if (S.days < 14) { S.days++; changed(true); renderPlaces(); } });
  $('#f-transport').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { S.transport = b.dataset.v; dayRoutes = []; changed(false); } });
  $('#f-pace').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { S.pace = b.dataset.v; changed(false); } });
  $('#d-pace').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (b) { S.pace = b.dataset.v; save(); renderPlanState(); recompute(false); } });
  attachSearch($('#f-add'), $('#add-results'), r => { $('#f-add').value = ''; addPlace(Object.assign({}, r, { src: 'user' })); }, tripBias);
  $('#btn-compute').addEventListener('click', () => { recompute(true); setTab('prog'); });

  function renderPlaces() {
    $('#places-title').textContent = 'Mes lieux' + (S.places.length ? ' · ' + S.places.length : '');
    const ul = $('#places');
    if (!S.places.length) { ul.innerHTML = '<li class="hint">Aucun lieu. Cherche-les ci-dessus, ou utilise l’onglet Découvrir.</li>'; return; }
    ul.innerHTML = S.places.map(p => {
      const durs = DURS.includes(p.dur) ? DURS : DURS.concat(p.dur).sort((a, b) => a - b);
      const always = p.open === '00:00' && p.close === '23:59';
      const hrs = p.hoursUnknown ? 'Horaires inconnus' : always ? 'Accès libre' : 'Ouvert ' + p.open + '–' + p.close;
      const cl = (p.closed || []).length ? ' · fermé ' + p.closed.map(d => DOW[d]).join(', ') : '';
      return `<li class="place" data-id="${p.id}">
        <div class="ph"><span class="nm">${esc(p.name)}</span>
          <button class="iconbtn star" data-act="must" aria-pressed="${!!p.must}" aria-label="Indispensable" title="Indispensable : jamais retiré du programme">★</button>
          <button class="iconbtn" data-act="del" aria-label="Retirer ${esc(p.name)}">×</button></div>
        <div class="meta">
          <select data-f="dur" aria-label="Durée de visite">${durs.map(m => `<option value="${m}" ${m === p.dur ? 'selected' : ''}>${P.fmtDur(m)}</option>`).join('')}</select>
          <select data-f="day" aria-label="Jour">${['Jour auto'].concat([...Array(S.days)].map((_, i) => 'Jour ' + (i + 1))).map((l, i) => `<option value="${i}" ${i === (p.day || 0) ? 'selected' : ''}>${l}</option>`).join('')}</select>
          <button class="mini" data-act="meal" aria-pressed="${!!p.meal}" title="Sert de pause repas">Repas</button>
        </div>
        <details><summary class="hint">${hrs}${cl}</summary>
          <div class="meta" style="margin-top:6px">de <input type="time" data-f="open" value="${p.open}"> à <input type="time" data-f="close" value="${p.close}"></div>
        </details>
      </li>`;
    }).join('');
  }
  $('#places').addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const p = S.places.find(x => x.id === b.closest('[data-id]').dataset.id); if (!p) return;
    if (b.dataset.act === 'del') { removePlace(p.id); return; }
    if (b.dataset.act === 'must') p.must = !p.must;
    if (b.dataset.act === 'meal') p.meal = !p.meal;
    S.example = false; save(); renderPlaces(); recompute(false);
  });
  $('#places').addEventListener('change', e => {
    const el = e.target, li = el.closest('[data-id]'); if (!li) return;
    const p = S.places.find(x => x.id === li.dataset.id); if (!p) return;
    const f = el.dataset.f;
    if (f === 'dur') p.dur = +el.value;
    if (f === 'day') p.day = +el.value;
    if (f === 'open' && el.value) { p.open = el.value; p.hoursUnknown = false; }
    if (f === 'close' && el.value) { p.close = el.value; p.hoursUnknown = false; }
    S.example = false; save(); recompute(false);
  });

  $('#btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'flaneur-' + (S.city || 'voyage').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.json';
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  });
  $('#f-import').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        const d = JSON.parse(rd.result);
        if (!Array.isArray(d.places)) throw new Error();
        S = Object.assign(defaultState(), d); save(); dayRoutes = []; bindPlan(); renderPlaces(); recompute(true);
        toast('Voyage importé.');
      } catch (err) { toast('Ce fichier n’est pas un voyage Flâneur.'); }
    };
    rd.readAsText(f); e.target.value = '';
  });
  $('#btn-clear').addEventListener('click', e => {
    const b = e.currentTarget;
    if (!b.dataset.armed) { b.dataset.armed = '1'; b.textContent = 'Confirmer ?'; setTimeout(() => { delete b.dataset.armed; b.textContent = 'Tout effacer'; }, 3000); return; }
    S.places = []; S.done = []; S.example = false; delete b.dataset.armed; b.textContent = 'Tout effacer';
    save(); dayRoutes = []; renderPlaces(); recompute(false); selected = null;
  });

  /* ================= panneau Programme ================= */
  function renderProg() {
    const el = $('#panel-prog');
    if (tab !== 'prog' && !matchMedia('(min-width: 900px)').matches) { if (el.hidden) return; }
    const head = `<header class="phead split"><div><div class="eyebrow">${esc(S.city || 'Mon voyage')}${plan ? ' · ' + plan.days.length + ' jour' + (plan.days.length > 1 ? 's' : '') : ''}</div><h1>Mon programme</h1></div>${plan ? `<button class="btn dark" data-act="start">${ICON_GO}Démarrer</button>` : ''}</header>`;
    if (!plan) { el.innerHTML = head + `<div class="empty">Ajoute des lieux dans Planifier, ou laisse-moi composer ton programme.<div class="btnrow" style="width:100%"><button class="btn" data-act="go-plan">Planifier</button><button class="btn" data-act="go-disc">Découvrir</button></div></div>`; return; }
    const day = currentDay(), r = day.r, ctx = day.ctx;
    const stops = dayStops(day);
    const tabs = `<div class="dtabs" role="tablist" aria-label="Jours">${plan.days.map((d, i) => { const n = dayStops(d).length; return `<button role="tab" aria-selected="${i === S.selDay}" data-day="${i}"><b>Jour ${i + 1}</b><small>${esc(dayShort(d.ctx.date))} · ${n} lieu${n > 1 ? 'x' : ''}</small></button>`; }).join('')}</div>`;
    const stats = `<div class="stats"><span><b>${stops.length}</b>lieu${stops.length > 1 ? 'x' : ''}</span><span><b>${P.fmtKm(r.km).replace(/ k?m$/, '')}</b>${r.km < 1 ? 'm' : 'km'}</span><span><b>${P.fmtDur(r.tr)}</b>de trajet</span><span><b>${P.fmtT(r.endT)}</b>retour</span></div>`;
    const pts = [ctx.hotel].concat(stops.map(s => s.it), [ctx.hotel]);
    const gmMode = S.transport === 'mix' || S.transport === 'transit' ? 'walk' : S.transport;
    const chunks = []; for (let i = 0; i < pts.length - 1;) { const part = pts.slice(i, i + 10); chunks.push(part); i += part.length - 1; }
    const gm = stops.length ? chunks.map((c, k) => `<a class="btn sm" href="${SV.gmDir(c, gmMode)}" target="_blank" rel="noopener">Google Maps${chunks.length > 1 ? ' · ' + (k + 1) : ''} ↗</a>`).join('') : '';
    let rows = `<li><div class="t">${P.fmtT(ctx.start)}</div><div class="rail"><span class="pin hotel">H</span></div><div class="body"><h3>Départ</h3><p>${esc(ctx.hotel.name)}${ctx.hotel.guessed ? ' · indique ton hôtel dans Planifier' : ''}</p></div></li>`;
    let num = 0, pos = ctx.hotel;
    for (const st of r.steps) {
      const it = st.it;
      if (it.kind === 'flex') {
        rows += `<li><div class="t">${P.fmtT(st.start)}<small>${P.fmtT(st.end)}</small></div><div class="rail"><span class="pin meal">✕</span></div><div class="body"><h3>${esc(it.name)}</h3><p>Pause de ${P.fmtDur(it.mealW.dur)} près de ${esc(st.at.name)}</p>
          <div class="tags"><button class="linkbtn" data-act="food" data-lat="${st.at.lat}" data-lng="${st.at.lng}" data-meal="${it.mealW.key}">Restos autour</button></div><div class="foodlist"></div></div></li>`;
        continue;
      }
      num++;
      if (st.leg && st.leg.min >= 0.5) rows += legRow(st.leg, pos, it);
      const done = S.done.includes(it.id);
      const always = it.open === '00:00' && it.close === '23:59';
      const tags = [];
      tags.push(`<span class="tag">${it.kind === 'mealplace' ? esc(it.mealW.label) : P.fmtDur(st.end - st.start) + ' sur place'}</span>`);
      if (!always && !it.hoursUnknown) tags.push(`<span class="tag">ouvert ${it.open}–${it.close}</span>`);
      if (st.wait > 4) tags.push(`<span class="tag w">attente ${P.fmtDur(st.wait)}</span>`);
      if (st.closed) tags.push('<span class="tag w">fermé ce jour-là</span>');
      if (st.late > 4) tags.push(`<span class="tag w">${it.kind === 'mealplace' ? 'repas tardif' : 'ferme avant la fin'}</span>`);
      rows += `<li class="${done ? 'done' : ''}"><div class="t">${P.fmtT(st.start)}<small>${P.fmtT(st.end)}</small></div><div class="rail"><span class="pin ${it.kind === 'mealplace' ? 'meal' : ''} ${done ? 'done' : ''}">${done ? '✓' : num}</span></div>
        <div class="body"><h3>${esc(it.name)}</h3>${it.why ? `<p>${esc(it.why)}</p>` : ''}<div class="tags">${tags.join('')}
          <button class="linkbtn" data-act="see" data-id="${it.id}">Carte</button>
          <button class="linkbtn" data-act="done" data-id="${it.id}">${done ? 'Annuler' : 'Fait'}</button></div></div></li>`;
      pos = it;
    }
    if (r.back && r.back.min >= 0.5) rows += legRow(r.back, pos, ctx.hotel);
    rows += `<li><div class="t">${P.fmtT(r.endT)}</div><div class="rail"><span class="pin hotel">H</span></div><div class="body"><h3>Retour</h3><p>${esc(ctx.hotel.name)}</p>${r.over > 4 ? `<div class="tags"><span class="tag w">${P.fmtDur(r.over)} après ton heure de retour</span></div>` : ''}</div></li>`;
    const left = plan.left.length ? `<div class="leftover"><b>Pas assez de temps pour ${plan.left.length} lieu${plan.left.length > 1 ? 'x' : ''} :</b> ${plan.left.map(p => esc(p.name)).join(', ')}. Ajoute un jour, élargis tes horaires, ou marque-les ★.</div>` : '';
    const realNote = day.realTimes ? 'Trajets à pied, vélo ou voiture calculés sur les vraies rues.' : day.routeError ? 'Trajets estimés (serveur d’itinéraires injoignable).' : '<span class="spin"></span>Calcul des trajets réels…';
    const transitNote = S.transport === 'mix' || S.transport === 'transit' ? ' Les trajets en transports sont estimés : touche « Itinéraire » pour l’horaire exact.' : '';
    el.innerHTML = head + tabs + left + `<div><h2 style="margin:0 0 4px;font-family:var(--f-display);font-weight:800;font-size:22px">${esc(cap1(dayLabel(ctx.date)))}</h2>${stats}</div>
      <div class="btnrow"><button class="btn sm" data-act="see-day">Voir sur la carte</button>${gm}</div>
      <ol class="tl">${rows}</ol>
      <p class="note">${realNote}${transitNote} Horaires d’ouverture indicatifs.</p>`;
  }
  function legRow(leg, from, to) {
    return `<li class="leg ${leg.mode}"><div class="t"></div><div class="rail"></div><div class="body"><b>${P.MODE_LABEL[leg.mode]}</b><span>${P.fmtDur(leg.min)} · ${P.fmtKm(leg.km)}</span><a href="${SV.gmDir([from, to], leg.mode)}" target="_blank" rel="noopener">Itinéraire ↗</a></div></li>`;
  }
  $('#panel-prog').addEventListener('click', async e => {
    const b = e.target.closest('[data-act],[data-day]'); if (!b) return;
    if (b.dataset.day !== undefined && !b.dataset.act) { selectDay(+b.dataset.day); return; }
    const act = b.dataset.act;
    if (act === 'start') { setTab('map'); handleAct('nav-next', b); }
    else if (act === 'go-plan' || act === 'go-disc') handleAct(act, b);
    else if (act === 'done') toggleDone(b.dataset.id);
    else if (act === 'see-day') { setTab('map'); selected = null; drawDay(true); }
    else if (act === 'see') {
      const st = dayStops(currentDay()); const i = st.findIndex(s => s.it.id === b.dataset.id);
      if (i >= 0) selectPlace(Object.assign({}, st[i].it, { inPlan: true, stepIdx: i }));
    }
    else if (act === 'food') {
      const box = b.closest('.body').querySelector('.foodlist');
      box.innerHTML = '<p class="small"><span class="spin"></span>Je cherche des restos…</p>';
      try {
        const pt = { lat: +b.dataset.lat, lng: +b.dataset.lng };
        const list = await SV.foodAround(pt, 450);
        box.innerHTML = list.length ? '<ul class="spots" style="margin-top:8px">' + list.slice(0, 8).map((f, i) => `<li class="spot"><div class="info"><b>${esc(f.name)}</b><small>${esc([f.kind === 'cafe' ? 'Café' : f.kind === 'fast_food' ? 'Sur le pouce' : 'Restaurant', f.cuisine, P.fmtM(P.hav(pt, f) * 1000)].filter(Boolean).join(' · '))}</small></div><button class="btn sm" data-act="pickfood" data-i="${i}">Choisir</button></li>`).join('') + '</ul>' : '<p class="small">Aucun resto trouvé tout près.</p>';
        box._list = list;
      } catch (err) { box.innerHTML = '<p class="small">Recherche indisponible pour le moment.</p>'; }
    }
    else if (act === 'pickfood') {
      const box = b.closest('.foodlist'); const f = box._list[+b.dataset.i];
      const p = addPlace({ name: f.name, lat: f.lat, lng: f.lng, key: 'amenity', value: f.kind, osm: f.osm, src: 'user' }, true);
      if (p) { p.meal = true; p.day = S.selDay + 1; save(); renderPlaces(); recompute(false); toast('« ' + f.name + ' » prévu pour le repas.'); }
    }
  });

  /* ================= panneau Découvrir ================= */
  function renderDisc() {
    $('#disc-title').textContent = 'Guide-moi' + (S.city ? ' dans ' + S.city : '');
    $('#disc-lead').textContent = 'Dis-moi ce que tu aimes, je compose tes ' + S.days + ' jour' + (S.days > 1 ? 's' : '') + '.';
    $('#f-interests').innerHTML = Object.entries(INTERESTS).map(([k, l]) => `<button data-k="${k}" aria-pressed="${S.interests.includes(k)}">${l}</button>`).join('');
    renderPlanState();
    const ul = $('#disc-list');
    const inList = c => S.places.some(p => Math.abs(p.lat - c.lat) < 1e-4 && Math.abs(p.lng - c.lng) < 1e-4);
    const rest = discCands.slice(0, 40);
    $('#disc-count').textContent = rest.length ? rest.filter(inList).length + ' ajouté' + (rest.filter(inList).length > 1 ? 's' : '') : '';
    ul.innerHTML = rest.length ? rest.map((c, i) => `<li class="spot"><div class="info"><b>${esc(c.name)}</b><small>${esc([c.label, P.fmtDur(c.dur), P.fmtM(c.dist * 1000)].filter(Boolean).join(' · '))}</small></div><button class="add" data-i="${i}" aria-pressed="${inList(c)}" aria-label="${inList(c) ? 'Retirer' : 'Ajouter'} ${esc(c.name)}">${inList(c) ? '✓' : '+'}</button></li>`).join('') : '<li class="hint">Les idées apparaîtront ici après « Proposer mon programme ».</li>';
  }
  $('#f-interests').addEventListener('click', e => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const k = b.dataset.k; S.interests = S.interests.includes(k) ? S.interests.filter(x => x !== k) : S.interests.concat(k);
    save(); if (discCands.length) rankCands(); renderDisc();
  });
  $('#disc-list').addEventListener('click', e => {
    const b = e.target.closest('[data-i]'); if (!b) return;
    const c = discCands[+b.dataset.i];
    const ex = S.places.find(p => Math.abs(p.lat - c.lat) < 1e-4 && Math.abs(p.lng - c.lng) < 1e-4);
    if (ex) removePlace(ex.id); else addPlace(candToPlace(c), true);
    renderDisc();
  });

  function discCenter() { return S.hotel || S.center || mapBias(); }
  function rankCands() {
    const want = new Set(S.interests); const c0 = discCenter();
    discCands.forEach(c => {
      c.dist = P.hav(c0, c);
      let s = Math.log(1 + (c.fame || 0)) * 10;
      c.cats.forEach(k => { if (want.has(k)) s += 12; });
      if (want.has('incontournable') && (c.fame || 0) >= 25) s += 10;
      if (c.meal && !want.has('food')) s -= 30;
      if (c.cats.includes('nuit') && !want.has('nuit')) s -= 25;
      if (c.cats.includes('shopping') && !want.has('shopping')) s -= 10;
      s -= c.dist * 1.5;
      c.score = s;
    });
    discCands.sort((a, b) => b.score - a.score);
  }
  function candToPlace(c) {
    const oh = P.parseOpeningHours(c.tags && c.tags.opening_hours);
    return { id: uid(), name: c.name, lat: c.lat, lng: c.lng, dur: c.dur, open: oh ? oh.open : '00:00', close: oh ? oh.close : '23:59', closed: oh ? oh.closed : [], hoursUnknown: !oh, cats: c.cats, meal: c.meal, why: (c.desc ? cap1(c.desc) : c.label) + (c.fame >= 20 ? ' · très connu' : ''), must: false, day: 0, osm: c.osm, src: 'disc' };
  }
  $('#btn-discover').addEventListener('click', async () => {
    const st = $('#disc-status'), btn = $('#btn-discover');
    btn.disabled = true; st.className = 'status'; st.innerHTML = '<span class="spin"></span>Je cherche les meilleurs endroits autour…';
    try {
      const radius = { walk: 3000, mix: 6000, transit: 8000, bike: 8000, car: 10000 }[S.transport] || 6000;
      discCands = await SV.discover(discCenter(), radius, S.city);
      if (!discCands.length) { st.className = 'status err'; st.textContent = "Je n'ai pas trouvé de lieux connus autour de ton hôtel. Vérifie qu'il est bien placé dans Planifier."; btn.disabled = false; renderDisc(); return; }
      rankCands();
      const per = (P.PACE[S.pace] || P.PACE.normal).perDay;
      const keep = S.places.filter(p => p.must);
      const n = Math.max(0, per * S.days - keep.length);
      const chosen = [];
      for (const c of discCands) {
        if (chosen.length >= n) break;
        if (c.meal) continue;
        if (keep.concat(chosen).some(x => P.hav(x, c) < 0.08)) continue;
        chosen.push(c);
      }
      S.places = keep.concat(chosen.map(candToPlace)); S.example = false; S.done = []; save();
      dayRoutes = []; renderPlaces(); recompute(true);
      st.textContent = chosen.length + ' lieux choisis. Tu peux en ajouter ou en retirer ci-dessous.';
      setTimeout(() => setTab('prog'), 400);
    } catch (e) {
      st.className = 'status err'; st.textContent = 'Recherche impossible : Wikipédia ne répond pas (' + (e && e.message ? e.message : 'erreur réseau') + '). Vérifie ta connexion et réessaie.';
    }
    btn.disabled = false; renderDisc();
  });

  /* ================= position GPS ================= */
  let watchId = null, myPos = null, meMarker = null, followMe = false;
  function meEl() { const d = document.createElement('div'); d.className = 'me'; d.innerHTML = '<b></b><i></i>'; return d; }
  function bearing(a, b) { const r = Math.PI / 180; const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r); const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r); return (Math.atan2(y, x) / r + 360) % 360; }
  function showMe(pos) {
    if (!meMarker) meMarker = new maplibregl.Marker({ element: meEl(), rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([pos.lng, pos.lat]).addTo(map);
    meMarker.setLngLat([pos.lng, pos.lat]);
    if (pos.heading != null && isFinite(pos.heading)) { meMarker.getElement().classList.add('heading'); meMarker.setRotation(pos.heading); }
  }
  function startGPS() {
    if (watchId != null) return true;
    if (!navigator.geolocation) { toast('Ton appareil ne donne pas sa position.'); return false; }
    watchId = navigator.geolocation.watchPosition(p => {
      const np = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now(), heading: null };
      if (myPos && P.hav(myPos, np) * 1000 > 4) np.heading = bearing(myPos, np);
      else if (p.coords.heading != null && !isNaN(p.coords.heading)) np.heading = p.coords.heading;
      else if (myPos) np.heading = myPos.heading;
      const first = !myPos; myPos = np;
      if (nav && nav.sim) return;
      showMe(np);
      if (nav) navUpdate(np);
      else if (followMe) map.easeTo({ center: [np.lng, np.lat], zoom: first ? 16 : map.getZoom(), duration: 600 });
    }, err => {
      if (err.code === 1) toast('Position refusée. Autorise la localisation pour Flâneur dans les réglages.', 5000);
      else toast('Position GPS indisponible pour le moment.');
      $('#btn-locate').classList.remove('on'); followMe = false;
    }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    return true;
  }
  $('#btn-locate').addEventListener('click', () => {
    followMe = !followMe; $('#btn-locate').classList.toggle('on', followMe);
    if (followMe) { startGPS(); if (myPos) map.easeTo({ center: [myPos.lng, myPos.lat], zoom: 16, duration: 700 }); }
  });
  map.on('dragstart', () => { if (followMe && !nav) { followMe = false; $('#btn-locate').classList.remove('on'); } if (nav) { nav.follow = false; $('#btn-recenter').hidden = false; } });

  function set3D(on) {
    S.p3d = on; save();
    $('#btn-3d').textContent = on ? '2D' : '3D'; $('#btn-3d').setAttribute('aria-label', on ? 'Vue 2D' : 'Vue 3D');
    if (!nav) map.easeTo({ pitch: on ? 55 : 0, duration: 700 });
  }
  $('#btn-3d').addEventListener('click', () => set3D(!S.p3d));

  /* ================= guidage ================= */
  let nav = null, wakeLock = null;
  const MOD = { left: 'à gauche', right: 'à droite', 'slight left': 'légèrement à gauche', 'slight right': 'légèrement à droite', 'sharp left': 'franchement à gauche', 'sharp right': 'franchement à droite', straight: 'tout droit', uturn: 'demi-tour' };
  const ICONS = {
    left: '<path d="M17 21V11a3 3 0 0 0-3-3H5"/><path d="m9 4-4 4 4 4"/>',
    right: '<path d="M7 21V11a3 3 0 0 1 3-3h9"/><path d="m15 4 4 4-4 4"/>',
    straight: '<path d="M12 21V4"/><path d="m6 10 6-6 6 6"/>',
    sleft: '<path d="M15 21v-7L8 7"/><path d="M8 13V7h6"/>',
    sright: '<path d="M9 21v-7l7-7"/><path d="M10 7h6v6"/>',
    uturn: '<path d="M7 21V9a5 5 0 0 1 10 0v5"/><path d="m13 11 4 4 4-4"/>',
    round: '<circle cx="12" cy="9" r="4"/><path d="M12 13v8"/><path d="m15 6 4-3"/>',
    arrive: '<path d="M6 21V4"/><path d="M6 4h11l-2.5 4L17 12H6"/>'
  };
  function iconFor(m) {
    if (m.type === 'arrive') return ICONS.arrive;
    if (m.type === 'roundabout' || m.type === 'rotary' || m.type === 'roundabout turn') return ICONS.round;
    const mo = m.modifier || 'straight';
    return mo === 'left' || mo === 'sharp left' ? ICONS.left : mo === 'right' || mo === 'sharp right' ? ICONS.right : mo === 'slight left' ? ICONS.sleft : mo === 'slight right' ? ICONS.sright : mo === 'uturn' ? ICONS.uturn : ICONS.straight;
  }
  function instrText(step, target) {
    const m = step.maneuver || {}; const name = step.name ? (' sur ' + step.name) : '';
    const mod = MOD[m.modifier] || '';
    switch (m.type) {
      case 'depart': return 'Pars' + (name || ' tout droit');
      case 'arrive': return 'Arrivée : ' + target;
      case 'turn': case 'end of road': return (m.type === 'end of road' ? 'Au bout de la rue, tourne ' : (m.modifier === 'uturn' ? 'Fais ' : (m.modifier === 'straight' ? 'Continue ' : 'Tourne '))) + mod + name;
      case 'new name': case 'continue': return (m.modifier && m.modifier !== 'straight' ? 'Continue ' + mod : 'Continue tout droit') + name;
      case 'fork': return "À l'embranchement, garde " + (mod || 'le cap') + name;
      case 'merge': return 'Rejoins' + (name || ' la voie') ;
      case 'on ramp': return 'Prends la bretelle' + name;
      case 'off ramp': return 'Sors' + (mod ? ' ' + mod : '') + name;
      case 'roundabout': case 'rotary': case 'roundabout turn': { const n = m.exit || 1; return 'Au rond-point, prends la ' + (n === 1 ? '1re' : n + 'e') + ' sortie' + name; }
      default: return (mod ? 'Va ' + mod : 'Continue') + name;
    }
  }
  function speak(text) {
    if (!nav || nav.mute || !window.speechSynthesis) return;
    try { const u = new SpeechSynthesisUtterance(text); u.lang = 'fr-FR'; u.rate = 1.02; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch (e) { }
  }

  function buildNavGeometry(route, target) {
    const coords = route.geometry.coordinates.map(c => ({ lng: c[0], lat: c[1] }));
    const cum = [0];
    for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + P.hav(coords[i - 1], coords[i]) * 1000);
    let searchFrom = 0;
    const steps = [];
    (route.legs[0].steps || []).forEach(st => {
      const loc = { lng: st.maneuver.location[0], lat: st.maneuver.location[1] };
      let bi = searchFrom, bd = Infinity;
      for (let i = searchFrom; i < coords.length; i++) { const d = P.hav(loc, coords[i]); if (d < bd) { bd = d; bi = i; } if (d > bd + 0.3) break; }
      searchFrom = bi;
      steps.push({ along: cum[bi], text: instrText(st, target.name), icon: iconFor(st.maneuver), type: st.maneuver.type });
    });
    return { coords, cum, total: cum[cum.length - 1], steps, durationS: route.duration };
  }

  async function startNav(target) {
    if (nav) stopNav(true);
    const air = target.from ? P.hav(target.from, target) : 0;
    nav = { target, follow: true, mute: $('#btn-voice').getAttribute('aria-pressed') === 'true', spoken: {}, offCount: 0, lastReroute: 0, p3d: true, arrived: false };
    document.body.classList.add('nav');
    $('#nav-banner').hidden = false; $('#nav-bottom').hidden = false; $('#nav-ctrl').hidden = false; $('#btn-recenter').hidden = true;
    $('#nb-dist').textContent = ''; $('#nb-instr').textContent = 'Calcul du trajet…'; $('#nb-next').textContent = ''; $('#nb-icon').innerHTML = ICONS.straight;
    $('#nbt-num').textContent = target.num; $('#nbt-name').textContent = target.name; $('#nbt-extra').innerHTML = '';
    $('#btn-nav3d').textContent = '2D';
    try { if (navigator.wakeLock) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { }
    if (window.speechSynthesis) { try { const u = new SpeechSynthesisUtterance("C'est parti vers " + target.name); u.lang = 'fr-FR'; if (!nav.mute) speechSynthesis.speak(u); } catch (e) { } }

    startGPS();
    let origin = myPos && Date.now() - myPos.ts < 120000 ? myPos : null;
    if (!origin) {
      await new Promise(r => { let n = 0; const iv = setInterval(() => { if ((myPos && Date.now() - myPos.ts < 120000) || ++n > 8) { clearInterval(iv); r(); } }, 500); });
      origin = myPos && Date.now() - myPos.ts < 120000 ? myPos : null;
    }
    if (!nav || nav.target !== target) return;
    nav.preview = !origin;
    if (!origin) origin = target.from || S.hotel || mapBias();
    const transitHint = (S.transport === 'mix' || S.transport === 'transit') && (target.legMode === 'transit' || P.hav(origin, target) > 1.6);
    await routeFrom(origin);
    if (!nav) return;
    const extra = [];
    if (transitHint) extra.push(`<a class="btn sm" href="${SV.gmDir([origin, target], 'transit')}" target="_blank" rel="noopener">Y aller en transports (Google Maps) ↗</a>`);
    if (nav.preview) extra.push('<button class="btn sm" id="btn-sim">Simuler le trajet</button><span class="hint">Position GPS indisponible : aperçu depuis l’étape précédente.</span>');
    $('#nbt-extra').innerHTML = extra.join('');
    const sim = $('#btn-sim'); if (sim) sim.addEventListener('click', startSim);
    void air;
  }

  async function routeFrom(origin) {
    const profile = P.profileOf(S.transport);
    try {
      const route = await SV.route(profile, [origin, nav.target], true);
      if (!nav) return;
      Object.assign(nav, buildNavGeometry(route, nav.target));
      nav.lastReroute = Date.now(); nav.offCount = 0; nav.spoken = {};
      map.getSource('navroute').setData({ type: 'Feature', properties: {}, geometry: route.geometry });
      showMe(Object.assign({}, origin, { heading: nav.coords.length > 1 ? bearing(nav.coords[0], nav.coords[1]) : null }));
      navUpdate(origin, true);
    } catch (e) {
      if (!nav) return;
      $('#nb-instr').textContent = 'Trajet indisponible. Essaie Google Maps.';
      $('#nbt-extra').innerHTML = `<a class="btn sm" href="${SV.gmDir([origin, nav.target], S.transport === 'mix' ? 'walk' : S.transport)}" target="_blank" rel="noopener">Ouvrir dans Google Maps ↗</a>`;
    }
  }

  function projectOnRoute(pos) {
    const c = nav.coords; let best = { d: Infinity, along: 0, seg: 0 };
    const kx = Math.cos(pos.lat * Math.PI / 180) * 111320, ky = 110540;
    for (let i = 0; i < c.length - 1; i++) {
      const ax = (c[i].lng - pos.lng) * kx, ay = (c[i].lat - pos.lat) * ky, bx = (c[i + 1].lng - pos.lng) * kx, by = (c[i + 1].lat - pos.lat) * ky;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      let t = L ? -(ax * dx + ay * dy) / L : 0; t = Math.max(0, Math.min(1, t));
      const px = ax + t * dx, py = ay + t * dy, d = Math.sqrt(px * px + py * py);
      if (d < best.d) best = { d, along: nav.cum[i] + t * (nav.cum[i + 1] - nav.cum[i]), seg: i };
    }
    return best;
  }

  function navUpdate(pos, initial) {
    if (!nav || !nav.coords) return;
    const pr = projectOnRoute(pos);
    if (!nav.sim && !nav.preview && pr.d > 40) {
      nav.offCount++;
      if (nav.offCount >= 3 && Date.now() - nav.lastReroute > 15000) { $('#nb-instr').textContent = 'Nouveau calcul du trajet…'; nav.lastReroute = Date.now(); routeFrom(pos); return; }
    } else nav.offCount = 0;
    const along = pr.along, remaining = Math.max(0, nav.total - along);
    const toTarget = P.hav(pos, nav.target) * 1000;
    if (!initial && (toTarget < 25 || remaining < 15)) { arrive(); return; }
    const si = nav.steps.findIndex((s, i) => i > 0 && s.along > along + 3);
    const step = si >= 0 ? nav.steps[si] : nav.steps[nav.steps.length - 1];
    const dist = si >= 0 ? step.along - along : remaining;
    $('#nb-icon').innerHTML = step.icon;
    $('#nb-dist').textContent = P.fmtM(dist);
    $('#nb-instr').textContent = step.text;
    const nxt = si >= 0 ? nav.steps[si + 1] : null;
    $('#nb-next').textContent = nxt && nxt.type !== 'arrive' && nxt.along - step.along < 250 ? 'Puis ' + nxt.text.charAt(0).toLowerCase() + nxt.text.slice(1) : '';
    const leftS = nav.durationS * (remaining / Math.max(1, nav.total));
    const eta = new Date(Date.now() + leftS * 1000);
    $('#nbt-eta').textContent = String(eta.getHours()).padStart(2, '0') + ':' + String(eta.getMinutes()).padStart(2, '0');
    $('#nbt-left').textContent = P.fmtDur(leftS / 60);
    $('#nbt-dist').textContent = P.fmtM(remaining) + ' · ' + P.MODE_LABEL[S.transport === 'mix' || S.transport === 'transit' ? 'walk' : S.transport].toLowerCase();
    if (si >= 0 && step.type !== 'arrive') {
      if (dist < 130 && dist > 40 && !nav.spoken[si + 'f']) { nav.spoken[si + 'f'] = 1; speak('Dans ' + P.fmtM(dist).replace(' m', ' mètres') + ', ' + step.text.charAt(0).toLowerCase() + step.text.slice(1)); }
      if (dist <= 25 && !nav.spoken[si + 'n']) { nav.spoken[si + 'n'] = 1; speak(step.text); }
    }
    if (nav.follow) {
      const c = nav.coords, i = Math.min(pr.seg, c.length - 2);
      const course = c.length > 1 ? bearing(c[i], c[Math.min(c.length - 1, i + 1)]) : map.getBearing();
      const mobile = !matchMedia('(min-width: 900px)').matches;
      map.easeTo({ center: [pos.lng, pos.lat], bearing: course, pitch: nav.p3d ? 60 : 0, zoom: S.transport === 'car' ? 16.3 : 17.4, duration: initial ? 900 : 800, padding: mobile ? { top: 200, bottom: 160, left: 20, right: 20 } : { top: 160, bottom: 60, left: 40, right: 420 } });
    }
  }

  function arrive() {
    if (!nav || nav.arrived) return;
    nav.arrived = true;
    if (nav.sim) { clearInterval(nav.sim); nav.sim = null; }
    $('#nb-icon').innerHTML = ICONS.arrive; $('#nb-dist').textContent = 'Arrivé';
    $('#nb-instr').textContent = nav.target.name; $('#nb-next').textContent = '';
    speak('Tu es arrivé à ' + nav.target.name);
    if (nav.target.placeId && !S.done.includes(nav.target.placeId)) { S.done.push(nav.target.placeId); save(); }
    const day = currentDay(); const ni = day ? nextStepIdx(day) : -1;
    $('#nbt-extra').innerHTML = (ni >= 0 && nav.target.placeId ? '<button class="btn sm" id="btn-nextstop">Étape suivante</button>' : '') + '<button class="btn sm" id="btn-endnav">Terminer</button>';
    const n = $('#btn-nextstop'); if (n) n.addEventListener('click', () => { stopNav(); handleAct('nav-next', n); });
    $('#btn-endnav').addEventListener('click', () => stopNav());
    drawDay(false); renderProg();
  }

  function startSim() {
    if (!nav || !nav.coords) return;
    if (nav.sim) { clearInterval(nav.sim); nav.sim = null; $('#btn-sim').textContent = 'Simuler le trajet'; return; }
    let along = 0; const speed = Math.max({ car: 40, bike: 18 }[S.transport] || 9, nav.total / 45);
    nav.preview = false; nav.follow = true;
    const b = $('#btn-sim'); if (b) b.textContent = 'Arrêter la simulation';
    nav.sim = setInterval(() => {
      along += speed;
      if (!nav) return;
      const c = nav.coords, cum = nav.cum;
      let i = cum.findIndex(x => x >= along); if (i < 0) i = c.length - 1;
      const a = c[Math.max(0, i - 1)], bb = c[i], seg = (cum[i] - cum[Math.max(0, i - 1)]) || 1, t = Math.min(1, Math.max(0, (along - cum[Math.max(0, i - 1)]) / seg));
      const pos = { lat: a.lat + (bb.lat - a.lat) * t, lng: a.lng + (bb.lng - a.lng) * t, heading: bearing(a, bb), ts: Date.now() };
      showMe(pos); navUpdate(pos);
    }, 1000);
  }

  function stopNav(silent) {
    if (!nav) return;
    if (nav.sim) clearInterval(nav.sim);
    nav = null;
    try { window.speechSynthesis && speechSynthesis.cancel(); } catch (e) { }
    try { wakeLock && wakeLock.release(); } catch (e) { } wakeLock = null;
    document.body.classList.remove('nav');
    $('#nav-banner').hidden = true; $('#nav-bottom').hidden = true; $('#nav-ctrl').hidden = true;
    if (mapReady) map.getSource('navroute').setData({ type: 'FeatureCollection', features: [] });
    if (!silent) { selected = null; renderSheet(); drawDay(true); map.easeTo({ bearing: 0, pitch: S.p3d ? 45 : 0, duration: 600 }); }
  }
  $('#btn-stopnav').addEventListener('click', () => stopNav());
  $('#btn-recenter').addEventListener('click', () => { if (nav) { nav.follow = true; $('#btn-recenter').hidden = true; if (myPos && !nav.preview) navUpdate(myPos); } });
  $('#btn-voice').addEventListener('click', e => {
    const b = e.currentTarget; const muted = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(muted)); b.setAttribute('aria-label', muted ? 'Activer la voix' : 'Couper la voix');
    if (nav) nav.mute = muted; if (muted) try { speechSynthesis.cancel(); } catch (err) { }
  });
  $('#btn-nav3d').addEventListener('click', e => {
    if (!nav) return; nav.p3d = !nav.p3d; e.currentTarget.textContent = nav.p3d ? '2D' : '3D';
    map.easeTo({ pitch: nav.p3d ? 60 : 0, duration: 600 });
  });

  /* ================= rendu général ================= */
  function renderAll() { renderDayChips(); renderSheet(); renderProg(); if (tab === 'disc') renderDisc(); }

  bindPlan(); renderPlaces(); set3D(S.p3d);
  $('#btn-3d').textContent = S.p3d ? '2D' : '3D';
  setTab('map');
  plan = P.planTrip(S); renderAll();
  setTimeout(fetchRoutes, 600);

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => { });
  window.__flaneur = { get S() { return S; }, get plan() { return plan; }, map };
})();
