/* Flâneur — services gratuits : recherche (Photon / Nominatim), itinéraires (OSRM FOSSGIS),
   lieux à découvrir (Overpass) et notoriété (Wikidata). */
(function () {
  'use strict';
  const SV = {};

  /* --- file d'attente : 1 requête par seconde max vers le serveur d'itinéraires --- */
  let lastRoute = 0, chain = Promise.resolve();
  function throttled(fn) {
    const run = chain.then(async () => {
      const wait = Math.max(0, lastRoute + 1100 - Date.now());
      if (wait) await new Promise(r => setTimeout(r, wait));
      lastRoute = Date.now();
      return fn();
    });
    chain = run.catch(() => {});
    return run;
  }

  async function getJSON(url, opts) {
    const res = await fetch(url, opts);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  /* --- catégorie, durée de visite et type à partir des tags OSM --- */
  SV.describeTags = function (key, value, tags) {
    tags = tags || {};
    const v = value || '';
    const out = { cats: [], dur: 45, meal: false, label: '' };
    const set = (cats, dur, label, meal) => { out.cats = cats; out.dur = dur; out.label = label; out.meal = !!meal; };
    if (key === 'tourism') {
      if (v === 'museum') set(['musees'], 90, 'Musée');
      else if (v === 'gallery') set(['musees'], 60, 'Galerie');
      else if (v === 'viewpoint') set(['vues'], 25, 'Point de vue');
      else if (v === 'zoo') set(['parcs'], 150, 'Zoo');
      else if (v === 'theme_park') set(['insolite'], 180, 'Parc de loisirs');
      else if (v === 'hotel' || v === 'hostel' || v === 'guest_house' || v === 'apartment') set([], 0, 'Hébergement');
      else set(['incontournable'], 45, 'À voir');
    } else if (key === 'historic') {
      if (v === 'castle' || v === 'fort') set(['histoire'], 75, 'Château');
      else if (v === 'memorial' || v === 'monument') set(['histoire'], 15, v === 'memorial' ? 'Mémorial' : 'Monument');
      else if (v === 'ruins') set(['histoire'], 30, 'Ruines');
      else if (v === 'church' || v === 'cathedral') set(['histoire'], 35, 'Église');
      else set(['histoire'], 30, 'Site historique');
    } else if (key === 'amenity') {
      if (v === 'place_of_worship') set(['histoire'], 35, tags.religion === 'jewish' ? 'Synagogue' : tags.religion === 'muslim' ? 'Mosquée' : 'Lieu de culte');
      else if (v === 'public_bath') set(['bains'], 150, 'Bains');
      else if (v === 'marketplace') set(['food', 'shopping'], 45, 'Marché', true);
      else if (v === 'theatre') set(['incontournable'], 40, 'Théâtre');
      else if (v === 'restaurant') set(['food'], 60, 'Restaurant', true);
      else if (v === 'cafe') set(['food'], 40, 'Café', true);
      else if (v === 'fast_food' || v === 'food_court') set(['food'], 30, 'Street food', true);
      else if (v === 'bar' || v === 'pub' || v === 'biergarten') set(['nuit'], 60, 'Bar');
      else if (v === 'nightclub') set(['nuit'], 120, 'Club');
      else set([], 45, 'Lieu');
    } else if (key === 'leisure') {
      if (v === 'park' || v === 'garden') set(['parcs'], 45, v === 'garden' ? 'Jardin' : 'Parc');
      else if (v === 'water_park' || v === 'sports_centre' && /bath|fürdő|thermal|spa/i.test(tags.name || '')) set(['bains'], 150, 'Bains');
      else set(['parcs'], 45, 'Loisirs');
    } else if (key === 'building' && (v === 'church' || v === 'cathedral')) set(['histoire'], 35, 'Église');
    else if (key === 'place') {
      if (v === 'square') set(['quartiers'], 15, 'Place');
      else if (v === 'island' || v === 'islet') set(['parcs'], 90, 'Île');
      else set(['quartiers'], 45, 'Quartier');
    } else if (key === 'man_made' && v === 'bridge' || key === 'bridge') set(['vues'], 20, 'Pont');
    else if (key === 'shop') set(['shopping'], 30, 'Boutique');
    else if (key === 'natural') set(['parcs'], 45, 'Nature');
    else if (key === 'highway' && v === 'pedestrian') set(['quartiers'], 30, 'Rue piétonne');
    if (tags.amenity === 'public_bath' || /thermal bath|gyógyfürdő|fürdő\b/i.test(tags.name || '')) set(['bains'], 150, 'Bains');
    return out;
  };

  /* --- recherche de lieux --- */
  SV.search = async function (q, bias) {
    q = (q || '').trim(); if (q.length < 2) return [];
    let base = 'https://photon.komoot.io/api/?q=' + encodeURIComponent(q) + '&limit=8';
    if (bias) base += '&lat=' + bias.lat.toFixed(4) + '&lon=' + bias.lng.toFixed(4);
    try {
      let data;
      try { data = await getJSON(base + '&lang=fr'); } catch (e) { data = await getJSON(base); }
      return (data.features || []).map(f => {
        const p = f.properties || {}, c = f.geometry && f.geometry.coordinates;
        if (!c) return null;
        const where = [p.street && (p.street + (p.housenumber ? ' ' + p.housenumber : '')), p.district, p.city || p.town || p.village, p.country].filter(Boolean);
        const name = p.name || where[0] || q;
        return { name, sub: where.filter(w => w !== name).slice(0, 3).join(', '), lat: c[1], lng: c[0], osm: p.osm_type && p.osm_id ? { type: p.osm_type, id: p.osm_id } : null, key: p.osm_key, value: p.osm_value, type: p.type };
      }).filter(Boolean);
    } catch (e) {
      let url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&accept-language=fr&q=' + encodeURIComponent(q);
      if (bias) url += '&viewbox=' + [bias.lng - 0.3, bias.lat + 0.2, bias.lng + 0.3, bias.lat - 0.2].map(x => x.toFixed(3)).join(',');
      const data = await getJSON(url);
      return data.map(r => ({ name: r.name || (r.display_name || '').split(',')[0], sub: (r.display_name || '').split(',').slice(1, 4).join(',').trim(), lat: +r.lat, lng: +r.lon, osm: r.osm_type ? { type: r.osm_type[0].toUpperCase(), id: r.osm_id } : null, key: r.category, value: r.type, type: r.addresstype }));
    }
  };

  SV.findCity = async function (name) {
    const res = await SV.search(name);
    const city = res.find(r => r.key === 'place' && /city|town|village|municipality|county|state/.test(r.value + ' ' + r.type)) || res[0];
    return city ? { name: city.name, lat: city.lat, lng: city.lng } : null;
  };

  /* --- Overpass --- */
  const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  SV.overpass = async function (query) {
    let err;
    for (const url of OVERPASS) {
      try { return await getJSON(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) }); }
      catch (e) { err = e; }
    }
    throw err;
  };

  /* Détails d'un lieu OSM (horaires, wikidata) */
  SV.osmDetails = async function (osm) {
    if (!osm) return null;
    const t = { N: 'node', W: 'way', R: 'relation', node: 'node', way: 'way', relation: 'relation' }[osm.type] || 'node';
    const data = await SV.overpass('[out:json][timeout:15];' + t + '(' + osm.id + ');out tags center;');
    const el = data.elements && data.elements[0];
    return el ? el.tags || {} : null;
  };

  const MAINKEYS = ['tourism', 'historic', 'amenity', 'leisure', 'place', 'building', 'man_made', 'shop', 'natural', 'highway'];
  function mainTag(tags) { for (const k of MAINKEYS) if (tags[k]) return [k, tags[k]]; return ['', '']; }

  /* Lieux intéressants autour d'un point */
  SV.discover = async function (center, radiusM) {
    const a = '(around:' + Math.round(radiusM) + ',' + center.lat.toFixed(5) + ',' + center.lng.toFixed(5) + ')';
    const q = '[out:json][timeout:40];(' +
      'nwr' + a + '["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|theme_park)$"]["name"];' +
      'nwr' + a + '["historic"~"^(castle|fort|monument|memorial|ruins|church|city_gate|building|archaeological_site)$"]["name"]["wikidata"];' +
      'nwr' + a + '["amenity"="place_of_worship"]["name"]["wikidata"];' +
      'nwr' + a + '["leisure"~"^(park|garden)$"]["name"]["wikidata"];' +
      'nwr' + a + '["amenity"~"^(public_bath|marketplace|theatre)$"]["name"];' +
      'nwr' + a + '["amenity"~"^(bar|pub|nightclub|cafe|restaurant)$"]["name"]["wikidata"];' +
      'nwr' + a + '["place"~"^(square|island)$"]["name"]["wikidata"];' +
      'nwr' + a + '["man_made"="bridge"]["name"]["wikidata"];' +
      ');out center tags 500;';
    const data = await SV.overpass(q);
    const seen = new Map();
    for (const el of data.elements || []) {
      const tags = el.tags || {}; const lat = el.lat ?? (el.center && el.center.lat), lng = el.lon ?? (el.center && el.center.lon);
      if (!isFinite(lat) || !tags.name) continue;
      const name = tags['name:fr'] || tags.name;
      const k = (tags.wikidata || '') || name.toLowerCase();
      if (seen.has(k)) continue;
      const [key, value] = mainTag(tags);
      const d = SV.describeTags(key, value, tags);
      if (d.label === 'Hébergement') continue;
      seen.set(k, { name, lat, lng, tags, wikidata: tags.wikidata || null, osm: { type: el.type, id: el.id }, cats: d.cats, dur: d.dur, meal: d.meal, label: d.label });
    }
    const list = [...seen.values()];
    await SV.addFame(list);
    return list;
  };

  /* Notoriété = nombre de langues Wikipédia (Wikidata sitelinks) */
  SV.addFame = async function (list) {
    const ids = [...new Set(list.map(x => x.wikidata).filter(id => /^Q\d+$/.test(id || '')))].slice(0, 250);
    const fame = {};
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      try {
        const data = await getJSON('https://www.wikidata.org/w/api.php?action=wbgetentities&props=sitelinks&format=json&origin=*&ids=' + chunk.join('|'));
        for (const id in (data.entities || {})) fame[id] = Object.keys(data.entities[id].sitelinks || {}).filter(s => /wiki$/.test(s) && !/commons|species/.test(s)).length;
      } catch (e) { /* on continue sans */ }
    }
    list.forEach(x => { x.fame = x.wikidata ? (fame[x.wikidata] || 1) : 0; });
  };

  /* Restaurants autour d'un point */
  SV.foodAround = async function (pt, radiusM) {
    const a = '(around:' + (radiusM || 400) + ',' + pt.lat.toFixed(5) + ',' + pt.lng.toFixed(5) + ')';
    const data = await SV.overpass('[out:json][timeout:20];(nwr' + a + '["amenity"~"^(restaurant|cafe|fast_food)$"]["name"];);out center tags 60;');
    return (data.elements || []).map(el => {
      const t = el.tags || {}; const lat = el.lat ?? (el.center && el.center.lat), lng = el.lon ?? (el.center && el.center.lon);
      return { name: t['name:fr'] || t.name, lat, lng, cuisine: (t.cuisine || '').split(';').slice(0, 2).join(', ').replace(/_/g, ' '), kind: t.amenity, oh: t.opening_hours || '', osm: { type: el.type, id: el.id } };
    }).filter(r => isFinite(r.lat)).sort((a, b) => Planner.hav(pt, a) - Planner.hav(pt, b)).slice(0, 12);
  };

  /* --- Itinéraires OSRM (serveur FOSSGIS) --- */
  const routeCache = new Map();
  SV.route = function (profile, pts, steps) {
    const coords = pts.map(p => p.lng.toFixed(6) + ',' + p.lat.toFixed(6)).join(';');
    const url = 'https://routing.openstreetmap.de/routed-' + profile + '/route/v1/driving/' + coords + '?overview=full&geometries=geojson&steps=' + (steps ? 'true' : 'false');
    if (routeCache.has(url)) return Promise.resolve(routeCache.get(url));
    return throttled(() => getJSON(url)).then(data => {
      if (data.code !== 'Ok' || !data.routes || !data.routes.length) throw new Error(data.message || 'Itinéraire introuvable');
      routeCache.set(url, data.routes[0]);
      return data.routes[0];
    });
  };

  /* --- liens Google Maps --- */
  const GM = { walk: 'walking', transit: 'transit', car: 'driving', bike: 'bicycling' };
  const ll = p => p.lat.toFixed(6) + ',' + p.lng.toFixed(6);
  SV.gmDir = function (pts, mode) {
    const o = pts[0], d = pts[pts.length - 1], w = pts.slice(1, -1);
    let u = 'https://www.google.com/maps/dir/?api=1&origin=' + ll(o) + '&destination=' + ll(d) + '&travelmode=' + (GM[mode] || 'walking');
    if (w.length) u += '&waypoints=' + encodeURIComponent(w.map(ll).join('|'));
    return u;
  };
  SV.gmPlace = (p, city) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.name + (city ? ', ' + city : ''));

  window.Services = SV;
})();
