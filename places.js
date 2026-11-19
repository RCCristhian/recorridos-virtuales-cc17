// Ray-B View — pantalla «Ubicación»: lugares de interés alrededor del proyecto (traída de Ray-B View Total).
// Los datos se buscan UNA vez desde el editor en OpenStreetMap (Overpass) y se guardan en el proyecto
// (tour.places): la lista y el dibujo del mapa funcionan sin internet; los mapas base (Esri) sí lo necesitan.
// En el menú del recorrido es un elemento { type: 'places', name }.
//
// places = { lat, lng, radius, title, address, at,
//            roads: [[clase, x0, y0, x1, y1, …]], parks: [[x0, y0, …]], water: [[…]], coast: [[…]],
//            pois: [{ cat, name, x, y, d }] }      x, y y d en metros desde el proyecto (y hacia el sur)
(function () {
  'use strict';
  var CATS = [
    ['parques', 'Parques', '#6fcf97'], ['colegios', 'Colegios', '#8fb8ff'], ['universidades', 'Universidades e institutos', '#b39cff'],
    ['salud', 'Salud y farmacias', '#ff7a7a'], ['super', 'Supermercados y centros comerciales', '#f3c969'], ['comida', 'Restaurantes y cafés', '#f0a77a'],
    ['bancos', 'Bancos', '#7fd6c8'], ['deporte', 'Gimnasios y deporte', '#e58fd0'], ['transporte', 'Transporte', '#d6d6d6'],
  ];
  var CAT = {}; CATS.forEach(function (c) { CAT[c[0]] = { id: c[0], name: c[1], color: c[2] }; });
  var ICON = { parques: '🌳', colegios: '🎓', universidades: '📚', salud: '🏥', super: '🛒', comida: '🍽️', bancos: '🏦', deporte: '🏋️', transporte: '🚉' };
  var HERE = (function () { var c = document.currentScript; return c && c.src ? c.src.replace(/[^/]*(\?.*)?$/, '') : ''; })();

  // Enlace de Google Maps o coordenadas → { lat, lng }
  function parseLocation(txt) {
    txt = String(txt || '').trim();
    var m = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(txt) || /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(txt) || /[?&](?:q|ll|query|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(txt) || /^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/.exec(txt);
    if (!m) return null;
    var lat = +m[1], lng = +m[2];
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return { lat: lat, lng: lng };
  }
  function proj(lat0, lng0) {
    var kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110574;
    return { xy: function (lat, lng) { return [Math.round((lng - lng0) * kx), Math.round(-(lat - lat0) * ky)]; },
      ll: function (x, y) { return { lat: lat0 - y / ky, lng: lng0 + x / kx }; } };
  }
  function catOf(tags) {
    if (!tags) return null;
    var a = tags.amenity, l = tags.leisure, s = tags.shop;
    if (l === 'park' || l === 'garden') return 'parques';
    if (a === 'school' || a === 'kindergarten') return 'colegios';
    if (a === 'university' || a === 'college') return 'universidades';
    if (a === 'hospital' || a === 'clinic' || a === 'doctors' || a === 'pharmacy') return 'salud';
    if (s === 'supermarket' || s === 'mall' || s === 'department_store') return 'super';
    if (a === 'restaurant' || a === 'cafe') return 'comida';
    if (a === 'bank') return 'bancos';
    if (l === 'fitness_centre' || l === 'sports_centre') return 'deporte';
    if (tags.public_transport === 'station' || tags.railway === 'station' || a === 'bus_station') return 'transporte';
    return null;
  }
  var ROADS = { motorway: 1, trunk: 1, primary: 1, secondary: 2, tertiary: 2, residential: 3, unclassified: 3, living_street: 3, pedestrian: 3, service: 4 };
  // Busca en OpenStreetMap y arma los datos (desde el editor).
  function fetchPlaces(lat, lng, radius) {
    var R = Math.round(radius * 1.35), a = '(around:' + R + ',' + lat + ',' + lng + ')', b = '(around:' + radius + ',' + lat + ',' + lng + ')';
    var q = '[out:json][timeout:60];(' +
      'way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|living_street|pedestrian)$"]' + a + ';' +
      'way["leisure"~"^(park|garden)$"]' + a + ';way["natural"~"^(water|coastline)$"]' + a + ';' +
      ');out geom;(' +
      'nwr["leisure"~"^(park|garden|fitness_centre|sports_centre)$"]' + b + ';' +
      'nwr["amenity"~"^(school|kindergarten|university|college|hospital|clinic|doctors|pharmacy|restaurant|cafe|bank|bus_station)$"]' + b + ';' +
      'nwr["shop"~"^(supermarket|mall|department_store)$"]' + b + ';' +
      'nwr["public_transport"="station"]' + b + ';nwr["railway"="station"]' + b + ';' +
      ');out center tags;';
    return fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) })
      .then(function (r) { if (!r.ok) throw new Error(r.status === 429 || r.status === 504 ? 'OpenStreetMap está ocupado; prueba en un minuto' : 'OpenStreetMap respondió ' + r.status); return r.json(); })
      .then(function (d) { return build(d.elements || [], lat, lng, radius); });
  }
  function thin(pts) {   // quita puntos a menos de 4 m del anterior
    var out = [pts[0], pts[1]];
    for (var i = 2; i < pts.length; i += 2) { var dx = pts[i] - out[out.length - 2], dy = pts[i + 1] - out[out.length - 1]; if (dx * dx + dy * dy >= 16 || i === pts.length - 2) out.push(pts[i], pts[i + 1]); }
    return out;
  }
  function build(els, lat, lng, radius) {
    var P = proj(lat, lng), roads = [], parks = [], water = [], coast = [], pois = [], seen = {}, parkGeo = {};
    els.forEach(function (e) {
      var tg = e.tags || {};
      if (e.geometry && e.geometry.length > 1) {
        var pts = []; e.geometry.forEach(function (g) { var p = P.xy(g.lat, g.lon); pts.push(p[0], p[1]); });
        pts = thin(pts);
        if (tg.highway && ROADS[tg.highway]) roads.push([ROADS[tg.highway]].concat(pts));
        else if (tg.leisure === 'park' || tg.leisure === 'garden') { parks.push(pts); parkGeo[e.type + e.id] = pts; }
        else if (tg.natural === 'water') water.push(pts);
        else if (tg.natural === 'coastline') coast.push(pts);
        return;
      }
      var c = catOf(tg), ll = e.center || (e.lat != null ? { lat: e.lat, lon: e.lon } : null);
      if (!c || !ll) return;
      var xy = P.xy(ll.lat, ll.lon), d = Math.round(Math.hypot(xy[0], xy[1]));
      if (d > radius) return;
      var name = tg.name || tg['name:es'] || ({ parques: 'Parque', colegios: 'Colegio', salud: tg.amenity === 'pharmacy' ? 'Farmacia' : 'Centro de salud', super: 'Supermercado', comida: tg.amenity === 'cafe' ? 'Café' : 'Restaurante', bancos: tg.operator || 'Banco', deporte: 'Gimnasio', transporte: 'Estación', universidades: 'Instituto' })[c];
      if ((c === 'comida' || c === 'bancos') && !tg.name) return;
      var key = c + '|' + name + '|' + Math.round(xy[0] / 40) + '|' + Math.round(xy[1] / 40);
      if (seen[key]) return; seen[key] = 1;
      var poi = { cat: c, name: name, x: xy[0], y: xy[1], d: d };
      if (c === 'parques' && parkGeo[e.type + e.id]) poi.poly = parkGeo[e.type + e.id];   // para iluminar el parque
      pois.push(poi);
    });
    // Por categoría, los más cercanos (hasta 30), para no saturar el mapa.
    var by = {}; pois.sort(function (a, b) { return a.d - b.d; }).forEach(function (p) { (by[p.cat] = by[p.cat] || []).push(p); });
    pois = []; Object.keys(by).forEach(function (k) { pois = pois.concat(by[k].slice(0, 30)); });
    return { lat: lat, lng: lng, radius: radius, at: new Date().toISOString(), roads: roads, parks: parks, water: water, coast: coast, pois: pois };
  }
  function pathOf(pts, close) {
    var s = 'M' + pts[0] + ' ' + pts[1];
    for (var i = 2; i < pts.length; i += 2) s += 'L' + pts[i] + ' ' + pts[i + 1];
    return s + (close ? 'Z' : '');
  }
  function walk(d) { var m = Math.max(1, Math.round(d / 80)); return m < 60 ? m + ' min a pie' : Math.round(m / 6) / 10 + ' h a pie'; }
  function dist(d) { return d < 1000 ? Math.round(d / 10) * 10 + ' m' : (d / 1000).toFixed(1).replace('.', ',') + ' km'; }
  // SVG del mapa. o: { active: cat|null, name, accent, cats: {cat:false} (ocultas) }
  function svg(pl, o) {
    o = o || {};
    var R = pl.radius * 1.12, vb = (-R) + ' ' + (-R) + ' ' + (2 * R) + ' ' + (2 * R), k = R / 600, out = '';
    // Bordes que se funden con el fondo de la pantalla (sin marco oscuro).
    out += '<defs><radialGradient id="rvpFade" r=".5"><stop offset=".78" style="stop-color:var(--rp-bg);stop-opacity:0"/><stop offset=".99" style="stop-color:var(--rp-bg);stop-opacity:1"/></radialGradient></defs>';
    out += '<g class="rvp-base">';
    (pl.water || []).forEach(function (p) { out += '<path class="rvp-water" d="' + pathOf(p, true) + '"/>'; });
    (pl.parks || []).forEach(function (p) { out += '<path class="rvp-park" d="' + pathOf(p, true) + '"/>'; });
    (pl.coast || []).forEach(function (p) { out += '<path class="rvp-coast" d="' + pathOf(p) + '" style="stroke-width:' + 5 * k + '"/>'; });
    [4, 3, 2, 1].forEach(function (cl) {
      (pl.roads || []).forEach(function (r) { if (r[0] === cl) out += '<path class="rvp-road r' + cl + '" d="' + pathOf(r.slice(1)) + '" style="stroke-width:' + ({ 1: 9, 2: 6, 3: 3.2, 4: 2 })[cl] * k + '"/>'; });
    });
    out += '</g>';
    [500, 1000, 1500].forEach(function (r) { if (r <= pl.radius) out += '<circle class="rvp-ring" r="' + r + '" style="stroke-width:' + 1.4 * k + ';stroke-dasharray:' + 6 * k + ' ' + 6 * k + '"/><text class="rvp-rlab" x="' + (r * 0.71 + 6 * k) + '" y="' + (-r * 0.71) + '" style="font-size:' + 13 * k + 'px">' + dist(r) + '</text>'; });
    var shown = {};   // nombre visible solo en los 8 más cercanos de la categoría elegida (no se enciman)
    (pl.pois || []).forEach(function (p, i) {
      if (o.cats && o.cats[p.cat] === false) return;
      var lab = o.active === p.cat && (shown[p.cat] = (shown[p.cat] || 0) + 1) <= 8;
      var on = !o.active || o.active === p.cat, c = CAT[p.cat] || { color: '#fff' };
      out += '<g class="rvp-poi' + (o.active === p.cat ? ' act' : on ? '' : ' dim') + '" data-i="' + i + '" transform="translate(' + p.x + ' ' + p.y + ')"><circle r="' + (o.active === p.cat ? 9 : 6) * k + '" style="fill:' + c.color + ';stroke-width:' + 2 * k + '"/>' +
        (lab ? '<text y="' + (-14 * k) + '" style="font-size:' + 13 * k + 'px;stroke-width:' + 4 * k + 'px">' + esc(p.name) + '</text>' : '') + '<title>' + esc(p.name + ' · ' + dist(p.d)) + '</title></g>';
    });
    out += '<g class="rvp-me"><circle class="rvp-pulse" r="' + 26 * k + '"/><circle r="' + 11 * k + '" style="stroke-width:' + 3 * k + '"/><text y="' + (-22 * k) + '" style="font-size:' + 16 * k + 'px;stroke-width:' + 5 * k + 'px">' + esc(o.name || '') + '</text></g>';
    out += '<rect x="' + (-R) + '" y="' + (-R) + '" width="' + 2 * R + '" height="' + 2 * R + '" fill="url(#rvpFade)" pointer-events="none"/>';
    return { viewBox: vb, html: out };
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function summary(pl) {
    var by = {}; (pl && pl.pois || []).forEach(function (p) { (by[p.cat] = by[p.cat] || []).push(p); });
    return CATS.filter(function (c) { return by[c[0]]; }).map(function (c) { return { id: c[0], name: c[1], color: c[2], list: by[c[0]] }; });
  }
  // ---------- Mapa interactivo (como Google Maps): Leaflet + mapas base de Esri ----------
  // Necesita internet para los mapas base. Fondos: minimal (calles en gris), calles y satélite.
  function loadLeaflet() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (loadLeaflet.p) return loadLeaflet.p;
    loadLeaflet.p = new Promise(function (ok, ko) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = HERE + 'leaflet/leaflet.css'; document.head.appendChild(l);
      var sc = document.createElement('script'); sc.src = HERE + 'leaflet/leaflet.js';
      sc.onload = function () { ok(window.L); }; sc.onerror = function () { loadLeaflet.p = null; ko(new Error('No se pudo cargar el mapa')); };
      document.head.appendChild(sc);
    });
    return loadLeaflet.p;
  }
  var BASES = {
    minimal: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', '© Esri, HERE, Garmin, OpenStreetMap'],
    calles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', '© Esri, HERE, Garmin, OpenStreetMap'],
    satelite: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', '© Esri, Maxar, Earthstar Geographics'],
  };
  function interactive(box, pl, o) {
    o = o || {};
    return loadLeaflet().then(function (L) {
      var P = proj(pl.lat, pl.lng), ctr = [pl.lat, pl.lng], acc = o.accent || '#c5a059';
      box.innerHTML = '<div class="rvl-map"></div>' +
        '<div class="rvl-zoom"><button data-lz="in" aria-label="Acercar">+</button><button data-lz="out" aria-label="Alejar">−</button><button data-lz="me" aria-label="Volver al proyecto" title="Volver al proyecto">◎</button></div>' +
        '<div class="rvl-bases">' + [['minimal', 'Minimalista'], ['satelite', 'Satelital']].map(function (b) { return '<button data-lb="' + b[0] + '">' + b[1] + '</button>'; }).join('') + '</div>' +
        '<div class="rvl-walk"><b>Caminando</b><span><i class="a"></i>5 min (400 m)</span><span><i class="b"></i>10 min (800 m)</span></div>';
      var el = box.querySelector('.rvl-map');
      // Mapa base: zoom 16, de 14 a 19.
      var map = L.map(el, { zoomControl: false, minZoom: 14, maxZoom: 19, scrollWheelZoom: true }).setView(ctr, 16);
      var base = null, labelsLayer = null, polys = L.layerGroup().addTo(map), marks = L.layerGroup().addTo(map), byIdx = {};
      L.circle(ctr, { radius: 800, color: '#999', weight: 1.2, dashArray: '4, 8', fillColor: '#999', fillOpacity: 0.02, interactive: false }).addTo(map);
      L.circle(ctr, { radius: 400, color: '#c5a059', weight: 1.5, dashArray: '5, 8', fillColor: '#c5a059', fillOpacity: 0.04, interactive: false }).addTo(map);
      L.marker(ctr, { zIndexOffset: 10000, icon: L.divIcon({ className: 'rvl-me', iconSize: [48, 48], iconAnchor: [24, 24],
        html: '<div class="rvl-pulse"></div><div class="rvl-core">★</div><div class="rvl-pill">' + esc(o.name || 'Proyecto') + '</div>' }) }).addTo(map);
      function setBase(b) {
        if (base) map.removeLayer(base); if (labelsLayer) { map.removeLayer(labelsLayer); labelsLayer = null; }
        var d = BASES[b] || BASES.minimal;
        base = L.tileLayer(d[0], { maxZoom: 19, maxNativeZoom: 19, attribution: d[1] }).addTo(map);
        if (b === 'satelite') labelsLayer = L.tileLayer('https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
        ['minimal', 'calles', 'satelite'].forEach(function (k) { box.classList.toggle('base-' + k, k === b); });
        box.querySelectorAll('[data-lb]').forEach(function (x) { x.classList.toggle('on', x.dataset.lb === b); });
      }
      var labels = o.labels !== false, cur = null;
      function show(cat) {
        cur = cat; polys.clearLayers(); marks.clearLayers(); byIdx = {};
        (pl.pois || []).forEach(function (p, i) {
          if (o.hide && o.hide[p.cat]) return;
          if (cat && p.cat !== cat) return;
          var c = CAT[p.cat] || { name: '', color: '#888' }, ll = P.ll(p.x, p.y);
          if (p.poly && p.poly.length > 4) {
            var pts = []; for (var k = 0; k < p.poly.length; k += 2) { var q = P.ll(p.poly[k], p.poly[k + 1]); pts.push([q.lat, q.lng]); }
            L.polygon(pts, { color: '#2e7d32', weight: 2, opacity: 0.85, fillColor: '#4caf50', fillOpacity: 0.35, className: 'rvl-park' })
              .bindTooltip('<b>' + esc(p.name) + '</b><br>' + walk(p.d), { sticky: true, direction: 'top' }).addTo(polys);
          }
          var m = L.marker([ll.lat, ll.lng], { icon: L.divIcon({ className: 'rvl-poi', iconSize: [150, 52], iconAnchor: [75, 16], popupAnchor: [0, -18],
            html: '<div class="rvl-pw cat-' + p.cat + (p.cat === 'parques' ? ' glow' : '') + '" style="--c:' + c.color + '"><div class="rvl-ic">' + (ICON[p.cat] || '📍') + '</div>' + (labels ? '<div class="rvl-lb">' + esc(p.name) + '</div>' : '') + '</div>' }) });
          m.bindPopup('<div class="rvl-card"><span>' + esc(c.name) + '</span><h4>' + esc(p.name) + '</h4><div class="rvl-walkinfo"><b>A ' + Math.max(1, Math.round(p.d / 80)) + ' min a pie</b> · ' + Math.round(p.d) + ' metros</div>' +
            '<a class="rvl-go" href="https://www.google.com/maps/dir/?api=1&origin=' + pl.lat + ',' + pl.lng + '&destination=' + ll.lat.toFixed(6) + ',' + ll.lng.toFixed(6) + '&travelmode=walking" target="_blank" rel="noopener">Cómo llegar caminando</a></div>', { maxWidth: 260 });
          m.addTo(marks); byIdx[i] = m;
        });
      }
      box.addEventListener('click', function (e) {
        var z = e.target.closest('[data-lz]'), b = e.target.closest('[data-lb]');
        if (z) { if (z.dataset.lz === 'in') map.zoomIn(); else if (z.dataset.lz === 'out') map.zoomOut(); else map.flyTo(ctr, 16, { duration: 1 }); }
        if (b) { if (b.dataset.lb === 'dibujo') { if (o.onDrawing) o.onDrawing(); } else { setBase(b.dataset.lb); if (o.onBase) o.onBase(b.dataset.lb); } }
      });
      setBase(o.base && BASES[o.base] ? o.base : 'minimal');
      show(o.cat || null);
      // Si el mapa se creó antes de tener tamaño (estilos aún cargando), al tomarlo se vuelve a centrar en el proyecto.
      var lastW = el.clientWidth, lastH = el.clientHeight, ro = null;
      function fit() {
        var w = el.clientWidth, h = el.clientHeight; if (!w || !h) return;
        var wasEmpty = !lastW || !lastH; lastW = w; lastH = h;
        map.invalidateSize(); if (wasEmpty) map.setView(ctr, 16, { animate: false });
      }
      if (window.ResizeObserver) { ro = new ResizeObserver(fit); ro.observe(el); }
      setTimeout(fit, 60);
      return {
        show: show,
        focus: function (i) { var m = byIdx[i]; if (!m) return; map.flyTo(m.getLatLng(), 17, { duration: 0.8 }); m.openPopup(); },
        setLabels: function (v) { labels = v; show(cur); },
        resize: function () { fit(); },
        destroy: function () { if (ro) ro.disconnect(); map.remove(); },
      };
    });
  }

  // ---------- Pantalla completa de Ubicación (lista a un lado y mapa) ----------
  var cssDone = false;
  function loadCss() { if (cssDone) return; cssDone = true; if (document.querySelector('link[href$="places.css"]')) return; var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = HERE + 'places.css'; document.head.appendChild(l); }
  function has(pl) { return !!(pl && (pl.pois || []).length); }
  // box: contenedor; pl: tour.places; o: { name, accent, address }
  function screen(box, pl, o) {
    o = o || {}; loadCss();
    var hide = pl.hide || {}, view = pl.view === 'satelite' ? 'satelite' : 'minimal', lmap = null, cat = null;
    function cats() { return summary(pl).filter(function (c) { return !hide[c.id]; }); }
    var cs = cats(); cat = cs.length ? cs[0].id : null;
    box.innerHTML = '<div class="rpl"><aside class="rpl-side"><div class="rpl-kick">Alrededores</div><h3 class="rpl-title"></h3><div class="rpl-cats"></div><div class="rpl-list"></div></aside>' +
      '<div class="rpl-map"><svg preserveAspectRatio="xMidYMid meet"></svg><div class="rpl-tip" hidden></div><div class="rpl-lmap" hidden></div></div></div>';
    var q = function (sel) { return box.querySelector(sel); };
    function render() {
      var list = cats();
      q('.rpl-title').innerHTML = esc(pl.title || 'Ubicación') + ((pl.address || o.address) ? '<small>' + esc(pl.address || o.address) + '</small>' : '');
      q('.rpl-cats').innerHTML = list.map(function (c) {
        return '<button data-pcat="' + c.id + '" class="' + (cat === c.id ? 'on' : '') + '"><i style="background:' + c.color + '"></i><span>' + esc(c.name) + '<small>El más cercano a ' + esc(dist(c.list[0].d)) + '</small></span><b>' + c.list.length + '</b></button>';
      }).join('');
      var cur = list.filter(function (c) { return c.id === cat; })[0];
      q('.rpl-list').innerHTML = cur ? '<div class="rpl-kick">' + esc(cur.name) + '</div>' + cur.list.map(function (p) { return '<div data-pi="' + pl.pois.indexOf(p) + '"><span>' + esc(p.name) + '</span><small>' + esc(dist(p.d) + ' · ' + walk(p.d)) + '</small></div>'; }).join('')
        : '<p class="rpl-muted">Elige una categoría para verla en el mapa.</p>';
      var online = navigator.onLine !== false, useMap = view !== 'dibujo' && online, lb = q('.rpl-lmap'), sv = q('.rpl-map svg');
      lb.hidden = !useMap; sv.style.display = useMap ? 'none' : '';
      if (useMap) {
        if (lmap) { lmap.then(function (m) { m.show(cat); m.resize(); }); return; }
        lmap = interactive(lb, pl, { name: o.name || '', accent: o.accent, base: view, labels: pl.labels !== false, hide: hide, cat: cat, onBase: function (b) { view = b; } });
        lmap.catch(function () { lmap = null; view = 'dibujo'; render(); });
        return;
      }
      var g = svg(pl, { active: cat, name: o.name || '', cats: Object.keys(hide).reduce(function (a, k) { if (hide[k]) a[k] = false; return a; }, {}) });
      sv.setAttribute('viewBox', g.viewBox); sv.innerHTML = g.html;
    }
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-pcat]');
      if (b) { cat = cat === b.dataset.pcat ? null : b.dataset.pcat; render(); return; }
      var li = e.target.closest('.rpl-list [data-pi]');
      if (li && lmap && !q('.rpl-lmap').hidden) lmap.then(function (m) { m.focus(+li.dataset.pi); });
    });
    box.addEventListener('mouseover', function (e) {
      var tip = q('.rpl-tip'); if (!tip) return;
      var g = e.target.closest('.rvp-poi'), li = e.target.closest('.rpl-list [data-pi]');
      box.querySelectorAll('.rvp-poi.hl').forEach(function (x) { x.classList.remove('hl'); });
      if (li) { var m = box.querySelector('.rvp-poi[data-i="' + li.dataset.pi + '"]'); if (m) m.classList.add('hl'); }
      if (!g) { tip.hidden = true; return; }
      var p = pl.pois[+g.dataset.i], r = g.getBoundingClientRect(), bx = q('.rpl-map').getBoundingClientRect();
      tip.textContent = p.name + ' · ' + dist(p.d); tip.hidden = false;
      tip.style.left = (r.left + r.width / 2 - bx.left) + 'px'; tip.style.top = (r.top - bx.top - 8) + 'px';
    });
    render();
    return {
      resize: function () { if (lmap) lmap.then(function (m) { m.resize(); }); },
      destroy: function () { if (lmap) lmap.then(function (m) { m.destroy(); }, function () {}); lmap = null; },
    };
  }
  window.RPlaces = {
    interactive: interactive, screen: screen, has: has, loadCss: loadCss, ICON: ICON, CATS: CATS, CAT: CAT, parseLocation: parseLocation, fetchPlaces: fetchPlaces, svg: svg, summary: summary, walk: walk, dist: dist, proj: proj };
})();
