// Recorridos360 — visor público.
(function () {
  'use strict';
  var R = window.R360, M = window.Marzipano, esc = R.esc;
  var qs = new URLSearchParams(location.search);
  var base = qs.get('tour') || './';
  if (base.slice(-1) !== '/') base += '/';

  var $ = function (id) { return document.getElementById(id); };
  var tour, viewer, autorotate, autoOn = true, current = null;   // current: id de escena o '__cover'
  var scenes = {};           // id -> Marzipano scene (se crean al visitarlas)
  var COVER = '__cover';
  var isMobile = function () { return window.matchMedia('(max-width: 760px)').matches; };

  var ICONS = {
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="7" r="1.6" fill="currentColor"/><path d="M12 11v7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" fill="currentColor"/><circle cx="12" cy="9.5" r="2.6" fill="#fff"/></svg>',
    gallery: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 16l5-5 4 4 3-3 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="16" cy="9" r="1.6" fill="currentColor"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    eye: '<svg viewBox="0 0 24 24"><path d="M12 5l4 7-4 7-4-7z" fill="currentColor"/></svg>',
    max: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    min: '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  };

  function byId(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i]; return null; }
  function sceneData(id) { return byId(tour.scenes, id); }
  // Nombre que se muestra abajo; vacío lo oculta (el diseño también puede ocultarlo en todo el recorrido).
  function sceneLabel(s) { return s.hideName ? '' : s.name || ''; }
  function paragraphs(text) {
    return String(text || '').split(/\n{2,}/).map(function (p) { return '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>'; }).join('');
  }

  // ---------- Carga (barra inferior) ----------
  var loadSeq = 0, barTimer = null;
  function setBar(p) {
    var b = $('loadbar');
    clearTimeout(barTimer);
    b.classList.add('on');
    b.firstElementChild.style.width = Math.max(4, Math.round(p * 100)) + '%';
  }
  function endBar() {
    var b = $('loadbar');
    b.firstElementChild.style.width = '100%';
    barTimer = setTimeout(function () { b.classList.remove('on'); setTimeout(function () { b.firstElementChild.style.width = '0'; }, 300); }, 220);
  }
  // Descarga imágenes a la caché del navegador, de 6 en 6 y en el orden dado. onProgress(0–1).
  // Se piden igual que las pide Marzipano (crossOrigin), así luego las encuentra en la caché.
  function preload(urls, onProgress) {
    return new Promise(function (resolve) {
      var i = 0, done = 0, n = urls.length;
      if (!n) return resolve();
      function next() {
        if (i >= n) return;
        var im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = im.onerror = function () {
          done++;
          if (onProgress) onProgress(done / n);
          if (done === n) resolve(); else next();
        };
        im.src = urls[i++];
      }
      for (var k = 0; k < 6; k++) next();
    });
  }
  function levelUrls(s, z) {
    var lv = s.levels && s.levels[z], urls = [];
    if (!lv || lv.fallbackOnly) return urls;
    var n = Math.round(lv.size / lv.tileSize);
    ['b', 'd', 'f', 'l', 'r', 'u'].forEach(function (f) {
      for (var y = 0; y < n; y++) for (var x = 0; x < n; x++) urls.push(base + R.tileDir(s) + '/' + z + '/' + f + '/' + y + '/' + x + '.jpg');
    });
    return urls;
  }
  // Lo que necesita un panorama para verse completo en esta pantalla: vista previa + su nivel.
  function panoUrls(s) { return [base + R.tileDir(s) + '/preview.jpg'].concat(levelUrls(s, displayLevel(s))); }

  // ---------- Nivel de detalle por pantalla ----------
  // Marzipano pide los cuadros nítidos según hacia dónde se mira y los dibuja según llegan: al girar,
  // lo nuevo aparecía borroso y se afinaba por cuadros. Ahora cada escena se muestra con UN nivel
  // completo, el adecuado a esta pantalla, preparado entero antes de verla. Solo al acercarse mucho
  // se piden cuadros más nítidos, y entonces el nivel completo queda debajo: nunca hay huecos.
  // Celular (pantalla táctil). Se define aquí arriba porque lo usan los cálculos de memoria de abajo.
  var PHONE = window.matchMedia('(pointer: coarse)').matches;
  var PHONE_FACE = 1000;                    // en celular: más nítido casi no se nota y gasta mucha memoria
  var levelIdx = {};
  function baseFov(s) {
    var p = $('pano'), lim = R.panoLimiter(s.faceSize, 110 * Math.PI / 180);
    return lim({ yaw: 0, pitch: 0, roll: 0, fov: R.effectiveFov(tour, s), width: p.clientWidth, height: p.clientHeight }).fov;
  }
  function displayLevel(s) {
    if (levelIdx[s.id] != null) return levelIdx[s.id];
    // Misma regla que Marzipano: el primer nivel con detalle suficiente para la altura de la pantalla.
    var need = (window.devicePixelRatio || 1) * Math.max(1, $('pano').clientHeight), t = Math.tan(baseFov(s) / 2);
    var pick = null, cap = null, last = null;
    s.levels.forEach(function (lv, i) {
      if (lv.fallbackOnly) return;
      last = i;
      if (pick === null && lv.size * t >= need) pick = i;
      if (lv.size <= PHONE_FACE) cap = i;
    });
    if (pick === null) pick = last;
    if (PHONE && cap !== null) pick = Math.min(pick, cap);
    return (levelIdx[s.id] = pick);
  }
  function levelBytes(s) { var lv = s.levels[displayLevel(s)], n = lv.size / lv.tileSize; return 6 * n * n * lv.tileSize * lv.tileSize * 4; }
  // Al acercarse mucho se deja pedir más detalle; si no, la escena usa siempre su nivel completo.
  function applyLevel(sc, s) {
    if (traveling()) return;
    var v = sc.view(), l = sc.layer(), geo = l.geometry(), idx = displayLevel(s);
    var want = geo.levelList.indexOf(v.selectLevel(geo.selectableLevelList));
    l.setFixedLevel(want > idx && v.fov() < baseFov(s) * 0.85 ? null : idx);
  }
  function levelReady(id) {
    var sc = scenes[id];
    if (!sc) return false;
    var l = sc.layer(), geo = l.geometry(), st = l.textureStore();
    var tiles = geo.levelTiles(geo.levelList[displayLevel(sceneData(id))]);
    for (var i = 0; i < tiles.length; i++) if (!st.texture(tiles[i])) return false;
    return true;
  }
  // Escenas con su nivel completo ya preparado en la memoria de imagen, la de mayor prioridad primero.
  // La memoria del celular es limitada: se guardan las que caben (la actual y sus vecinas).
  var GPU_BUDGET = PHONE ? 110e6 : 400e6;
  var resident = [];
  function keepResident(ids) {
    ids = ids.filter(function (id, i) { var s = sceneData(id); return s && s.kind !== 'image' && ids.indexOf(id) === i; });
    ids.forEach(function (id) { if (resident.indexOf(id) < 0) getScene(id).layer().pinLevel(displayLevel(sceneData(id))); });
    var order = ids.concat(resident.filter(function (id) { return ids.indexOf(id) < 0; })), used = 0;
    resident = order.filter(function (id, i) {
      var b = levelBytes(sceneData(id));
      if (i === 0 || used + b <= GPU_BUDGET) { used += b; return true; }
      var l = scenes[id].layer();
      l.unpinLevel(displayLevel(sceneData(id)));
      if (viewer.stage().listLayers().indexOf(l) < 0) l.textureStore().clearNotPinned();
      return false;
    });
  }
  // Escenas a las que se puede saltar desde esta: se preparan de antemano para que el salto no espere.
  function neighbors(s) {
    return (s.hotspots || []).filter(function (h) { return h.type === 'link'; }).map(function (h) { return h.target; });
  }
  function settle(s) { keepResident([s.id].concat(neighbors(s))); }

  // ---------- Panoramas ----------
  function getScene(id) {
    if (!scenes[id]) {
      var s = sceneData(id), sc = R.createScene(viewer, base, s, { textureStoreOpts: { previouslyVisibleCacheSize: TILE_CACHE } });
      sc.__id = id;
      sc.layer().setFixedLevel(displayLevel(s));
      sc.view().addEventListener('change', function () { applyLevel(sc, s); });
      scenes[id] = sc;
    }
    return scenes[id];
  }

  // ---------- Imágenes ya preparadas (memoria de la tarjeta gráfica) ----------
  // Marzipano borra todas las imágenes de una escena al dejarla, así que al volver se preparaban
  // otra vez cuadro por cuadro (muy visible en iPhone). Se conservan las de las últimas escenas
  // visitadas; en celulares menos, porque su memoria es limitada.
  // En celular: la escena actual y la anterior (lo justo para ir y volver), cada una entera.
  // Si se pasa de ahí, el fundido igual espera a que la escena esté lista: no se ven cuadros.
  var KEEP_SCENES = PHONE ? 1 : 4;         // escenas que dejaste y se conservan
  var TILE_CACHE = PHONE ? 128 : 256;      // cuadros fuera de la vista que guarda cada escena
  var keptLayers = [];
  function keepTextures() {
    if (typeof viewer._removeLayerFromStage !== 'function' || typeof viewer._addLayerToStage !== 'function') return;
    var stage = viewer.stage(), add = viewer._addLayerToStage;
    viewer._addLayerToStage = function (l, i) {
      keptLayers = keptLayers.filter(function (k) { return k !== l; });
      return add.call(viewer, l, i);
    };
    viewer._removeLayerFromStage = function (l) {
      stage.removeLayer(l);
      l.unpinFirstLevel();
      keptLayers.unshift(l);
      while (keptLayers.length > KEEP_SCENES) keptLayers.pop().textureStore().clearNotPinned();
    };
  }
  // Termina ya el fundido en curso: quita la escena anterior. Sin esto, cambiar de escena en
  // pleno fundido dejaba dos escenas en pantalla y Marzipano daba error.
  function finishTransition() {
    if (!viewer._cancelCurrentTween) return;
    viewer._cancelCurrentTween(); viewer._cancelCurrentTween = null;
    var old = viewer._replacedScene;
    if (old) {
      viewer._removeSceneEventListeners(old);
      old.listLayers().forEach(function (l) { viewer._removeLayerFromStage(l); });
      viewer._replacedScene = null;
    }
    var cur = viewer.scene();
    if (cur) { cur.listLayers().forEach(function (l) { l.mergeEffects({ opacity: 1 }); }); cur.hotspotContainer().domElement().style.opacity = 1; }
  }
  // Fundido que espera (como mucho HOLD_MAX) a que la escena nueva tenga sus imágenes listas:
  // mientras tanto queda invisible y se sigue viendo la anterior, así no se ven cuadros a medio cargar.
  var HOLD_MAX = 2500;
  // Llama a cb cuando la escena tiene su nivel completo preparado (para que al girar no falte nada).
  function onReady(sc, max, cb) {
    var done = false, t0 = performance.now();
    (function check() {
      if (done) return;
      if (levelReady(sc.__id) || performance.now() - t0 >= max) { done = true; cb(); return; }
      setTimeout(check, 30);
    })();
  }
  function switchWhenReady(sc, fade, onFade) {
    finishTransition();
    var readyAt = null, mine = {};
    switching = mine;
    function setOpacity(op) { sc.listLayers().forEach(function (l) { l.mergeEffects({ opacity: op }); }); sc.hotspotContainer().domElement().style.opacity = op; }
    sc.switchTo({
      transitionDuration: HOLD_MAX + fade + 1000,
      transitionUpdate: function () {
        if (readyAt === null) { setOpacity(0); return; }
        var op = fade > 0 ? Math.min(1, (performance.now() - readyAt) / fade) : 1;
        setOpacity(op);
        if (op >= 1) setTimeout(function () { if (switching === mine && viewer.scene() === sc) finishTransition(); }, 0);
      },
    });
    onReady(sc, HOLD_MAX, function () {
      if (switching !== mine || viewer.scene() !== sc) return;
      readyAt = performance.now();
      if (onFade) onFade(readyAt);
    });
  }
  var switching = null;

  // Los puntos se dibujan en un canvas sincronizado con el panorama (ver hotspots.js).
  var layer = null;
  function makeLayer() {
    layer = new R.HotspotLayer(viewer, $('pano'), {
      gl: true,               // en el mismo lienzo que el panorama: en celular no se desfasan
      labels: 'hover',
      filter: function (h) { return h.type !== 'link' || !!sceneData(h.target); },
      labelFor: function (h) { return h.type === 'link' ? (h.label || (sceneData(h.target) || {}).name || '') : (h.title || ''); },
      onClick: function (h) {
        if (h.type === 'link') goTo(h.target, { hotspot: h }); else openText(h.title || 'Información', h.text);
      },
    });
  }

  // Mientras dura un viaje no se atiende el zoom del usuario: la inercia del trackpad sigue enviando
  // rueda un buen rato después de soltar los dedos y se notaría como un tirón al llegar.
  var travelSeq = 0, wheelHoldUntil = 0, WHEEL_QUIET = 160;
  function traveling() { return travelSeq !== 0 && travelSeq === navSeq; }
  function holdWheel() { wheelHoldUntil = performance.now() + WHEEL_QUIET; }
  function bindPanoGestures() {
    var pano = $('pano');
    pano.addEventListener('wheel', function (e) {
      if (!traveling() && performance.now() > wheelHoldUntil) return;
      holdWheel();                                      // sigue llegando inercia: se espera a que pare
      e.preventDefault(); e.stopImmediatePropagation();
    }, { capture: true, passive: false });
    R.panoGestures(pano, function () {
      if (traveling() || !viewer.scene() || !viewer.controls().enabled()) return null;
      viewer.breakIdleMovement();
      return viewer.view();
    });
    // Pellizcar sobre el menú o los botones no debe agrandar toda la página.
    document.addEventListener('wheel', function (e) { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
    R.safariPinch(document, function () {}, function () {});
  }

  // Viaje entre dos 360 por un salto: UN solo movimiento continuo, sin pausas.
  //  - el origen se acerca (arranca suave y nunca se detiene) en la dirección en la que se mira;
  //  - en cuanto el destino está cargado empieza el fundido, mientras el origen sigue avanzando;
  //  - el destino aparece un poco más abierto y se termina de acercar frenando suave (sigue el avance).
  function easeOutCubic(u) { return 1 - Math.pow(1 - u, 3); }
  function travel(s, h, prev) {
    var seq = ++navSeq, my = ++loadSeq;
    travelSeq = seq;
    var from = scenes[current], pv = from.view();
    // Mientras dura el salto cada escena conserva su nivel completo: el origen se acerca con lo que
    // ya tiene y el destino se prepara entero (si era vecina, ya lo está y no hay espera).
    var fromLayer = from.layer();
    keepResident([s.id, prev.id]);
    var f0 = pv.fov(), y0 = pv.yaw(), p0 = pv.pitch();
    var dest = getScene(s.id), target = R.effectiveFov(tour, s);
    var start;
    // El destino entra un poco más abierto y se sigue cerrando: el avance continúa en la misma dirección.
    // Marzipano limita el campo de visión horizontal (110°); en pantallas anchas eso recortaba la
    // apertura inicial y el movimiento parecía frenarse. Durante el viaje se relaja ese límite.
    var dv = dest.view(), normalLimiter = dv.limiter();
    var fixed = h.keepView || s.arriveFixed;           // el panorama destino pide mirar siempre a su vista inicial
    var yawTo = fixed ? (s.initialView || R.DEFAULT_VIEW).yaw : y0;
    var pitchTo = fixed ? (s.initialView || R.DEFAULT_VIEW).pitch : p0 * 0.5;
    // Zoom real en esta pantalla: el que dejará el límite normal al terminar, para que el final no dé un salto.
    var pano = $('pano');
    target = normalLimiter({ yaw: yawTo, pitch: pitchTo, roll: 0, fov: target, width: pano.clientWidth, height: pano.clientHeight }).fov;
    dv.setParameters({ yaw: yawTo, pitch: pitchTo, fov: target });
    dv.setLimiter(R.panoLimiter(s.faceSize, 130 * Math.PI / 180, 170 * Math.PI / 180));
    start = { yaw: yawTo, pitch: pitchTo, fov: Math.min(target * 1.22, 2.1) };
    var FADE = Math.max(500, tour.settings.transition != null ? tour.settings.transition : 900);
    var ready = false, switched = false, fadeAt = null, t0 = performance.now();
    viewer.stopMovement();
    viewer.setIdleMovement(Infinity);
    layer.setScene(null, []);
    var slow = setTimeout(function () { if (my === loadSeq && !ready) setBar(0.08); }, 150);
    preload(panoUrls(s), function (p) { if (my === loadSeq && fadeAt === null) setBar(p); }).then(function () { ready = true; clearTimeout(slow); });
    function frame(now) {
      if (seq !== navSeq) { dv.setLimiter(normalLimiter); return; }   // el usuario eligió otra cosa
      var e = Math.max(0, now - t0);                    // el primer cuadro puede traer una hora anterior a t0
      // Acercamiento del origen: arranca con suavidad y avanza siempre (se va frenando sin parar).
      var k = 1 - Math.exp(-Math.pow(e / 750, 1.5));
      pv.setFov(Math.max(0.25, f0 * (1 - 0.45 * k)));
      if (ready && !switched && e >= 220) {
        switched = true;
        dest.layer().setFixedLevel(displayLevel(s));
        dest.view().setParameters(start);
        switchWhenReady(dest, FADE, function (at) { if (seq === navSeq) { fadeAt = at; endBar(); } });
      }
      if (fadeAt !== null) {
        var u = Math.min(1, (now - fadeAt) / (FADE + 350));
        dest.view().setFov(start.fov + (target - start.fov) * easeOutCubic(u));
        if (u >= 1) { dv.setFov(target); dv.setLimiter(normalLimiter); travelSeq = 0; applyLevel(dest, s); applyLevel(from, prev); holdWheel(); arrived(s, prev); return; }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // Dos capas para imágenes fijas: la nueva aparece con fundido sobre la anterior.
  var stills = [null, null], stillIdx = 0, cover = null, navSeq = 0;
  function stillView(i) {
    if (!stills[i]) stills[i] = new R.StillView($(i ? 'still2' : 'still'), { interactive: true });
    return stills[i];
  }
  function hideStills() { showLayer('still', false); showLayer('still2', false); }

  function showLayer(id, on) { $(id).classList.toggle('on', on); }

  // Navegar a una escena. opts.hotspot = salto desde el que se llega (continuidad de la vista).
  function goTo(id, opts) {
    opts = opts || {};
    var s = sceneData(id);
    if (!s) return;
    var seq = ++navSeq, my = ++loadSeq;
    var urls = s.kind === 'image' ? [base + s.image] : panoUrls(s);
    var prev = current && current !== COVER ? sceneData(current) : null;
    if (opts.hotspot && prev && prev.kind !== 'image' && s.kind !== 'image' && scenes[current]) { --navSeq; --loadSeq; return travel(s, opts.hotspot, prev); }
    var slow = setTimeout(function () { if (my === loadSeq) setBar(0.08); }, 120);
    preload(urls, function (p) { if (my === loadSeq) setBar(p); }).then(function () {
      clearTimeout(slow);
      if (seq !== navSeq) return;     // el usuario ya eligió otra cosa
      endBar();
      showScene(s, opts, prev);
    });
  }

  function showScene(s, opts, prev) {
    viewer.controls().enable();
    if (s.kind === 'image') {
      var fromImage = prev && prev.kind === 'image' && current !== COVER;
      var next = fromImage ? 1 - stillIdx : stillIdx;
      var nextId = next ? 'still2' : 'still', prevId = stillIdx ? 'still2' : 'still';
      stillView(next).load(base + s.image, s.framing, s.name);
      $(nextId).classList.add('top'); $(prevId).classList.remove('top');
      showLayer(nextId, true); showLayer('cover', false);
      if (fromImage && next !== stillIdx) setTimeout(function () { if (stillIdx === next) showLayer(prevId, false); }, 480);
      stillIdx = next;
      viewer.stopMovement();
      viewer.setIdleMovement(Infinity);
      layer.setScene(null, []);
    } else {
      var sc = getScene(s.id), v = s.initialView || R.DEFAULT_VIEW;
      sc.view().setParameters({ yaw: v.yaw, pitch: v.pitch, fov: R.effectiveFov(tour, s) });
      var fade = (prev && prev.kind !== 'image' && current !== COVER) || (current === COVER && !!coverPano());
      settle(s);
      if (fade) switchWhenReady(sc, tour.settings.transition != null ? tour.settings.transition : 900);
      else { finishTransition(); sc.switchTo({ transitionDuration: 0 }); }
      firstShown(sc);
      layer.setScene(sc, s.hotspots || []);
      hideStills(); showLayer('cover', false);
      if (autoOn && autorotate) viewer.setIdleMovement((tour.settings.idleSeconds || 6) * 1000, autorotate);
      if (!prev && autoOn && autorotate) viewer.startMovement(autorotate);
    }
    document.body.classList.toggle('is-still', s.kind === 'image');
    document.body.classList.remove('is-cover');
    current = s.id;
    $('sceneTitle').textContent = sceneLabel(s);
    try { history.replaceState(null, '', '#' + encodeURIComponent(s.id)); } catch (e) { /* file:// */ }
    renderMenu();
    if (isMobile()) setPanel(false);
  }

  function arrived(s, prev) {
    settle(s);
    viewer.controls().enable();
    layer.setScene(scenes[s.id], s.hotspots || []);
    hideStills(); showLayer('cover', false);
    if (autoOn && autorotate) viewer.setIdleMovement((tour.settings.idleSeconds || 6) * 1000, autorotate);
    document.body.classList.remove('is-still', 'is-cover');
    current = s.id;
    $('sceneTitle').textContent = sceneLabel(s);
    try { history.replaceState(null, '', '#' + encodeURIComponent(s.id)); } catch (e) { /* file:// */ }
    renderMenu();
  }

  // La pantalla de carga se quita cuando la primera escena ya se ve completa (como mucho 6 s),
  // para que el cliente no vea el panorama dibujándose por cuadros al entrar.
  var loaderGone = false;
  function firstShown(sc) {
    if (loaderGone) return;
    loaderGone = true;
    function hide() { setTimeout(function () { $('loader').classList.add('done'); }, 150); }
    if (sc) onReady(sc, 8000, hide); else hide();
  }

  // ---------- Portada ----------
  function coverPano() { var c = tour.cover; return c && c.type === 'pano' && sceneData(c.scene) && sceneData(c.scene).kind !== 'image' ? sceneData(c.scene) : null; }
  function hasCover() { var c = tour.cover; return !!(c && (c.type === 'pano' ? coverPano() : c.image)); }
  // Portada con un panorama 360: vista y zoom elegidos; el cliente puede girarla solo si así se configuró.
  function showCoverPano(s) {
    var c = tour.cover, seq = ++navSeq, my = ++loadSeq;
    preload(panoUrls(s), function (p) { if (my === loadSeq) setBar(p); }).then(function () {
      if (seq !== navSeq) return;
      endBar();
      var sc = getScene(s.id), v = c.view || s.initialView || R.DEFAULT_VIEW;
      settle(s);
      sc.view().setParameters({ yaw: v.yaw, pitch: v.pitch, fov: v.fov != null ? v.fov : R.effectiveFov(tour, s) });
      if (current && current !== COVER) switchWhenReady(sc, 700);
      else { finishTransition(); sc.switchTo({ transitionDuration: 0 }); }
      firstShown(sc);
      showLayer('cover', false); hideStills();
      layer.setScene(null, []);
      if (c.interactive) viewer.controls().enable(); else viewer.controls().disable();
      viewer.stopMovement();
      viewer.setIdleMovement(Infinity);
      if (c.rotate) viewer.startMovement(autorotate);
      current = COVER;
      document.body.classList.add('is-cover');
      document.body.classList.remove('is-still');
      $('sceneTitle').textContent = '';
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* file:// */ }
      renderMenu();
    });
    return true;
  }
  function showCover() {
    var c = tour.cover;
    if (!hasCover()) return false;
    if (c.type === 'pano') return showCoverPano(coverPano());
    var seq = ++navSeq, my = ++loadSeq;
    preload([base + c.image], function (p) { if (my === loadSeq) setBar(p); }).then(function () {
      if (seq !== navSeq) return;
      endBar();
      if (!cover) cover = new R.StillView($('cover'), { interactive: false });
      cover.load(base + c.image, c.framing, tour.title);
      showLayer('cover', true); hideStills();
      viewer.stopMovement();
      viewer.setIdleMovement(Infinity);
      layer.setScene(null, []);
      current = COVER;
      document.body.classList.add('is-cover');
      document.body.classList.remove('is-still');
      $('sceneTitle').textContent = '';
      try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* file:// */ }
      renderMenu();
    });
    return true;
  }
  // Clic en el logo o el nombre: portada (o escena de inicio) y menú principal.
  function goHome() {
    menuStack = [];
    renderMenu();
    if (!showCover()) goTo(startId());
  }
  function startId() { return sceneData(tour.startScene) ? tour.startScene : tour.scenes[0].id; }

  // ---------- Menú lateral (en niveles, como carpetas) ----------
  var menuStack = [];   // ids de las carpetas abiertas, de la raíz hacia adentro

  function nodeLabel(n) {
    if (n.type === 'folder' || n.type === 'link') return n.name;
    var ref = n.type === 'plan' ? byId(tour.plans, n.ref) : sceneData(n.ref);
    return ref ? ref.name : null;
  }
  function visibleChildren(list) { return (list || []).filter(function (n) { return nodeLabel(n) && (n.type !== 'folder' || n.children.length); }); }
  function currentList() {
    var list = tour.menu, title = null;
    for (var i = 0; i < menuStack.length; i++) {
      var f = byId(list, menuStack[i]);
      if (!f || f.type !== 'folder') { menuStack.length = i; break; }
      list = f.children; title = f.name;
    }
    return { list: list, title: title };
  }

  var ARROW_IN = '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var EXT = '<svg class="chev" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function renderMenu() {
    var nav = $('menu'), html = '';
    if (!tour.menu.length) {
      html = '<ul>' + tour.scenes.map(function (s) {
        return '<li><button data-scene="' + esc(s.id) + '"' + (s.id === current ? ' class="active" aria-current="true"' : '') + '><span>' + esc(s.name) + '</span></button></li>';
      }).join('') + '</ul>';
    } else {
      var cur = currentList();
      var th = R.theme(tour), back = menuStack.length ? '<button class="back back-' + (th.backPos === 'bottom' ? 'bottom' : 'top') + '" data-back="1">' + ICONS.back + 'Volver</button>' : '';
      if (back && th.backPos !== 'bottom') html += back;
      if (menuStack.length) html += '<p class="menu-title">' + esc(cur.title) + '</p>';
      html += '<ul>' + visibleChildren(cur.list).map(function (n) {
        var label = esc(nodeLabel(n)), cls = '', extra = '';
        if (n.type === 'folder') { if (R.folderContainsScene(n, current)) cls = 'active'; extra = ARROW_IN; }
        if (n.type === 'scene' && n.ref === current) cls = 'active';
        if (n.type === 'link') extra = n.mode === 'tab' ? EXT : '';
        return '<li><button data-node="' + esc(n.id) + '"' + (cls ? ' class="' + cls + '"' + (n.type === 'scene' ? ' aria-current="true"' : '') : '') + '><span>' + label + '</span>' + extra + '</button></li>';
      }).join('') + '</ul>';
      if (back && th.backPos === 'bottom') html += back;
    }
    nav.innerHTML = html;
  }

  $('menu').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.back) { menuStack.pop(); renderMenu(); return; }
    if (b.dataset.scene) { goTo(b.dataset.scene); return; }
    var found = R.findNode(tour.menu, b.dataset.node);
    if (found) openNode(found.node);
  });
  function openNode(n) {
    if (n.type === 'folder') {
      var kids = visibleChildren(n.children);
      // Carpeta con un solo elemento (que no sea otra carpeta): ir directo.
      if (kids.length === 1 && kids[0].type !== 'folder') return openNode(kids[0]);
      menuStack.push(n.id); renderMenu(); return;
    }
    if (n.type === 'scene') goTo(n.ref);
    else if (n.type === 'plan') openPlan(n.ref);
    else if (n.type === 'link') openLink(n);
  }

  // Enlaces web (lugares de interés, etc.): ventana dentro del recorrido o pestaña nueva.
  function openLink(n) {
    var url = String(n.url || '').trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    if (n.mode === 'tab') { window.open(url, '_blank', 'noopener'); return; }
    openModal(n.name, '<iframe class="modal-web" src="' + esc(url) + '" title="' + esc(n.name) + '" referrerpolicy="no-referrer-when-downgrade" allow="fullscreen; geolocation"></iframe>' +
      '<p class="modal-web-note">¿No se ve la página? Algunas webs no permiten mostrarse dentro de otra. <a href="' + esc(url) + '" target="_blank" rel="noopener">Ábrela en una pestaña nueva</a>.</p>', null, { maximizable: true, slim: true });
    // En el ordenador se abre ya maximizada (en el celular la ventana ya ocupa toda la pantalla).
    if (!isMobile()) { $('modal').classList.add('max'); setMaxIcon(); }
  }

  function setPanel(openIt) {
    document.body.classList.toggle('panel-closed', !openIt);
    $('panelToggle').setAttribute('aria-expanded', String(openIt));
    $('panelToggle').setAttribute('aria-label', openIt ? 'Ocultar menú' : 'Mostrar menú');
  }
  $('panelToggle').addEventListener('click', function () { setPanel(document.body.classList.contains('panel-closed')); });
  $('logo').addEventListener('click', goHome);
  $('logo').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goHome(); } });

  // ---------- Ventana modal ----------
  var lastFocus = null, onClose = null;
  function openModal(title, html, cleanup, mopts) {
    lastFocus = document.activeElement;
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = html;
    $('modal').classList.remove('max');
    $('modal').classList.toggle('slim', !!(mopts && mopts.slim));
    $('modalMax').hidden = !(mopts && mopts.maximizable);
    setMaxIcon();
    $('modal').hidden = false;
    onClose = cleanup || null;
    $('modal').querySelector('.modal-close').focus();
    viewer.stopMovement();
  }
  function closeModal() {
    if ($('modal').hidden) return;
    $('modal').hidden = true;
    $('modal').classList.remove('max', 'slim');
    $('modalBody').innerHTML = '';
    if (onClose) onClose();
    onClose = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function setMaxIcon() {
    var on = $('modal').classList.contains('max');
    $('modalMax').innerHTML = on ? ICONS.min + '<span>Volver al tamaño normal</span>' : ICONS.max;
    $('modalMax').setAttribute('aria-label', on ? 'Restaurar tamaño' : 'Maximizar');
    $('modalMax').title = on ? 'Restaurar tamaño' : 'Maximizar';
  }
  $('modalMax').addEventListener('click', function () {
    var fr = $('modalBody').querySelector('iframe');
    // Página web o mapa: pantalla completa real del navegador, solo la página (se sale con Esc).
    if (fr && fr.requestFullscreen && !isMobile() && !$('modal').classList.contains('max')) {
      var done = false;
      var fallback = function () { if (done) return; done = true; if (!document.fullscreenElement) { $('modal').classList.add('max'); setMaxIcon(); } };
      try { fr.requestFullscreen().then(function () { done = true; }, fallback); } catch (e) { fallback(); }
      setTimeout(fallback, 500);   // algunos navegadores no responden: se maximiza dentro de la página
      return;
    }
    $('modal').classList.toggle('max'); setMaxIcon();
  });
  // Mientras la página está en pantalla completa se muestra un aviso discreto para volver.
  document.addEventListener('fullscreenchange', function () {
    var fs = document.fullscreenElement;
    $('fsHint').hidden = !(fs && fs.tagName === 'IFRAME');
  });
  $('fsHint').addEventListener('click', function () { if (document.fullscreenElement) document.exitFullscreen(); });
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal') || e.target.closest('.modal-close')) closeModal(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeModal(); });

  function openText(title, text) {
    openModal(title, '<div class="modal-text">' + paragraphs(text) + '</div>');
  }

  function mapUrl(addr) {
    addr = String(addr || '').trim();
    if (/^https?:\/\//i.test(addr)) return addr;
    return 'https://www.google.com/maps?q=' + encodeURIComponent(addr) + '&output=embed';
  }

  // ---------- Planos ----------
  function openPlan(id) {
    var p = byId(tour.plans, id);
    if (!p) return;
    var markers = (p.markers || []).filter(function (m) { return sceneData(m.target); }).map(function (m) {
      var name = sceneData(m.target).name;
      return '<button class="plan-marker" style="left:' + (m.x * 100) + '%;top:' + (m.y * 100) + '%" data-target="' + esc(m.target) + '" aria-label="Ver ' + esc(name) + '">' +
        ICONS.eye + '<span class="r360-tip">' + esc(name) + '</span></button>';
    }).join('');
    openModal(p.name, '<div class="plan-view"><div class="plan-content"><img src="' + esc(base + p.image) + '" alt="' + esc(p.name) + '">' + markers +
      '</div><div class="zoom-ctrl"><button data-z="in" aria-label="Acercar">+</button><button data-z="out" aria-label="Alejar">−</button></div></div>', null, { maximizable: true });
    var vp = $('modalBody').querySelector('.plan-view');
    var content = vp.querySelector('.plan-content');
    var img = content.querySelector('img');
    var zp = R.zoomPan(vp, content, function (s) { content.style.setProperty('--inv', String(1 / s)); });
    function fit() {
      if (!img.naturalWidth) return;
      var r = vp.getBoundingClientRect(), ar = img.naturalWidth / img.naturalHeight;
      var w = Math.min(r.width, r.height * ar), h = w / ar;
      content.style.width = w + 'px'; content.style.height = h + 'px';
      content.style.left = (r.width - w) / 2 + 'px'; content.style.top = (r.height - h) / 2 + 'px';
      zp.reset();
    }
    img.onload = fit;
    if (img.complete) fit();
    var ro = new ResizeObserver(fit); ro.observe(vp);
    vp.addEventListener('click', function (e) {
      var z = e.target.closest('[data-z]');
      if (z) { e.stopPropagation(); zp.zoomBy(z.dataset.z === 'in' ? 1.4 : 1 / 1.4); return; }
      var m = e.target.closest('.plan-marker');
      if (m && !zp.wasDrag()) { closeModal(); goTo(m.dataset.target); }
    });
    vp.querySelector('.zoom-ctrl').addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    onClose = function () { ro.disconnect(); };
  }

  // ---------- Galería ----------
  function openGallery(start) {
    var items = tour.gallery || [];
    var i = start || 0;
    openModal('Galería', '<figure class="gallery" style="margin:0"><img alt=""><figcaption></figcaption>' +
      (items.length > 1 ? '<button class="round nav prev" aria-label="Anterior">' + ICONS.back + '</button><button class="round nav next" aria-label="Siguiente" style="transform:translateY(-50%) scaleX(-1)">' + ICONS.back + '</button>' : '') + '</figure>', null, { maximizable: true });
    var fig = $('modalBody').querySelector('.gallery');
    function show() {
      var it = items[i];
      fig.querySelector('img').src = base + it.image;
      fig.querySelector('img').alt = it.caption || ('Imagen ' + (i + 1));
      fig.querySelector('figcaption').innerHTML = (it.caption ? esc(it.caption) + ' · ' : '') + (i + 1) + ' / ' + items.length;
    }
    function step(d) { i = (i + d + items.length) % items.length; show(); }
    fig.addEventListener('click', function (e) {
      if (e.target.closest('.prev')) step(-1);
      if (e.target.closest('.next')) step(1);
    });
    // Deslizar con el dedo en celulares
    var sx = null;
    fig.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
    fig.addEventListener('touchend', function (e) { if (sx == null) return; var dx = e.changedTouches[0].clientX - sx; if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1); sx = null; });
    function key(e) { if (e.key === 'ArrowLeft') step(-1); if (e.key === 'ArrowRight') step(1); }
    document.addEventListener('keydown', key);
    onClose = function () { document.removeEventListener('keydown', key); };
    show();
  }

  // ---------- Herramientas ----------
  function renderTools() {
    var t = [];
    var info = tour.info || {};
    if (info.text) t.push(['info', 'Información', function () { openText(info.title || 'Información', info.text); }]);
    if (tour.location && tour.location.address) t.push(['pin', 'Ubicación', function () {
      openModal('Ubicación', '<iframe class="modal-map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="' + esc(mapUrl(tour.location.address)) + '" title="Mapa"></iframe>', null, { maximizable: true });
    }]);
    if ((tour.gallery || []).length) t.push(['gallery', 'Galería', function () { openGallery(0); }]);
    var foot = $('tools');
    foot.innerHTML = '';
    t.forEach(function (x) {
      var b = document.createElement('button');
      b.className = 'tool'; b.innerHTML = ICONS[x[0]]; b.setAttribute('aria-label', x[1]); b.title = x[1];
      b.addEventListener('click', x[2]);
      foot.appendChild(b);
    });
    foot.hidden = !t.length;
  }

  function setAuto(on) {
    autoOn = on;
    $('btnAuto').setAttribute('aria-pressed', String(on));
    var still360 = (current === COVER && !(tour.cover && tour.cover.rotate && coverPano())) || (current && current !== COVER && sceneData(current) && sceneData(current).kind === 'image');
    if (on) { viewer.setIdleMovement((tour.settings.idleSeconds || 6) * 1000, autorotate); if (!still360) viewer.startMovement(autorotate); }
    else { viewer.setIdleMovement(Infinity); viewer.stopMovement(); }
  }
  $('btnAuto').addEventListener('click', function () { setAuto(!autoOn); });

  $('btnFull').addEventListener('click', function () {
    var d = document, el = d.documentElement;
    if (d.fullscreenElement || d.webkitFullscreenElement) (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else if (el.requestFullscreen) el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  });
  if (!(document.fullscreenEnabled || document.webkitFullscreenEnabled)) $('btnFull').hidden = true;

  // ---------- Diseño ----------
  // Favicon elegido en el editor (en la vista previa; el exportado ya lo trae en su HTML).
  function applyFavicon() {
    var f = tour.favicon && tour.favicon.files;
    document.querySelectorAll('link[data-r360-icon]').forEach(function (l) { l.remove(); });
    if (!f) return;
    [['icon', 32], ['icon', 16], ['apple-touch-icon', 180]].forEach(function (x) {
      if (!f[x[1]]) return;
      var l = document.createElement('link');
      l.rel = x[0]; l.setAttribute('sizes', x[1] + 'x' + x[1]); if (x[0] === 'icon') l.type = 'image/png';
      l.href = base + f[x[1]] + '?v=' + (tour.favicon.v || 1);
      l.setAttribute('data-r360-icon', '');
      document.head.appendChild(l);
    });
  }
  function applyTheme() {
    applyFavicon();
    var t = R.theme(tour), st = document.documentElement.style;
    R.loadFont(t.font);
    st.setProperty('--font', R.fontStack(t.font));
    st.setProperty('--accent', t.accent);
    st.setProperty('--panel', R.rgba(t.panelBg, t.panelOpacity));
    st.setProperty('--panel-solid', t.panelBg);
    st.setProperty('--text', t.textColor);
    st.setProperty('--muted', R.rgba(t.textColor, 0.62));
    st.setProperty('--line', R.rgba(t.textColor, 0.16));
    st.setProperty('--panel-w-user', t.panelWidth + 'px');
    st.setProperty('--menu-size', t.menuSize + 'px');
    st.setProperty('--menu-case', t.uppercase ? 'uppercase' : 'none');
    st.setProperty('--btn-bg', t.buttonBg);
    st.setProperty('--btn-fg', t.buttonColor);
    st.setProperty('--loader', t.loaderColor || t.accent);
    st.setProperty('--logo-x', (t.logoX || 0) + 'px');
    st.setProperty('--menu-active', t.menuActive || t.accent);
    st.setProperty('--hs-accent', t.hotspotHover || t.accent);
    st.setProperty('--menu-hover', R.rgba(t.menuHover || '#ffffff', t.menuHoverOpacity != null ? t.menuHoverOpacity : 0.08));
    st.setProperty('--toggle-bg', t.toggleBg || '#111111');
    st.setProperty('--toggle-fg', t.toggleColor || '#ffffff');
    st.setProperty('--back-x', (t.backX || 0) + 'px');
    st.setProperty('--menu-active-bg', R.rgba(t.menuActiveBg || '#ffffff', t.menuActiveBgOpacity || 0));
    st.setProperty('--back-y', (t.backY || 0) + 'px');
    st.setProperty('--logo-y', (t.logoY || 0) + 'px');
    document.body.classList.toggle('panel-right', t.side === 'right');
    document.body.classList.toggle('hide-scene-name', t.showSceneName === false);
    var brand = t.brand != null ? t.brand : tour.title;
    var logo = (tour.logo ? '<img src="' + esc(base + tour.logo) + '" alt="' + esc(brand || tour.title) + '" style="max-height:' + t.logoHeight + 'px">' : '') +
      (brand ? '<h1 style="color:' + esc(t.brandColor || t.accent) + ';font-size:' + t.brandSize + 'px">' + esc(brand) + '</h1>' : '');
    $('logo').innerHTML = logo;
    $('logo').setAttribute('aria-label', 'Volver al inicio');
    $('madeby').hidden = !!(tour.branding && tour.branding.hidden);
    return logo;
  }

  // El editor envía los cambios en vivo cuando muestra este visor como vista previa.
  window.addEventListener('message', function (e) {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'r360-tour' || !tour) return;
    var keep = current;
    tour = e.data.tour;
    tour.settings = tour.settings || {};
    R.normalizeMenu(tour);
    applyTheme();
    renderTools();
    renderMenu();
    if (keep === COVER) {
      if (!hasCover()) goTo(startId());
      else if (tour.cover.type === 'pano') showCover();
      else if (cover) cover.load(base + tour.cover.image, tour.cover.framing, tour.title);
      return;
    }
    var s = keep && sceneData(keep);
    if (!s) { goHome(); return; }
    $('sceneTitle').textContent = sceneLabel(s);
    if (s.kind === 'image') { if (stills[stillIdx]) stills[stillIdx].load(base + s.image, s.framing, s.name); }
    else if (scenes[keep]) layer.setScene(scenes[keep], s.hotspots || []);
  });

  // ---------- Arranque ----------
  function fail(msg) {
    $('loader').innerHTML = '<p class="loader-msg">' + esc(msg) + '</p>';
  }

  fetch(base + 'tour.json' + (qs.has('draft') ? '?draft=1' : ''), { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('No se encontró tour.json');
    return r.json();
  }).then(function (t) {
    tour = t;
    tour.settings = tour.settings || {};
    R.normalizeMenu(tour);
    if (!tour.scenes || !tour.scenes.length) return fail('Este recorrido todavía no tiene escenas.');
    document.title = tour.title || 'Recorrido virtual';
    var brandHtml = applyTheme();
    // Pantalla de precarga: logo del proyecto o de Ray-B (se elige al exportar)
    $('loaderBrand').innerHTML = tour.settings.loaderBrand === 'rayb'
      ? '<div class="loader-rayb">RAY<span class="dash"></span>B<small>View</small></div>' : brandHtml;

    bindPanoGestures();   // antes que el visor: tiene que ver la rueda primero
    viewer = new M.Viewer($('pano'), { controls: { mouseViewMode: 'drag' } });
    keepTextures();
    makeLayer();
    if (qs.has('debug')) window.__r360 = { viewer: viewer, layer: function () { return layer; }, current: function () { return current; } };   // solo para pruebas
    autorotate = M.autorotate({ yawSpeed: tour.settings.autorotateSpeed || 0.03, targetPitch: 0, targetFov: R.effectiveFov(tour, null) });
    renderTools();
    if (isMobile()) setPanel(false);

    var hash = decodeURIComponent(location.hash.slice(1));
    var first = sceneData(hash) ? sceneData(hash) : null;
    var withCover = !first && hasCover();
    var cp = coverPano();
    var urls = withCover ? (cp ? panoUrls(cp) : [base + tour.cover.image]) : (first || sceneData(startId())).kind === 'image'
      ? [base + (first || sceneData(startId())).image] : panoUrls(first || sceneData(startId()));
    if (tour.logo) urls.push(base + tour.logo);
    // Todos los 360 a la caché antes de entrar, cada uno con su nivel para esta pantalla. Las imágenes
    // fijas, que pesan mucho más, bajan después en segundo plano. Si tarda demasiado se entra igual.
    tour.scenes.forEach(function (s) { if (s.kind !== 'image') urls = urls.concat(panoUrls(s)); });
    urls = urls.filter(function (u, i) { return urls.indexOf(u) === i; });
    var LOADER_MAX = 25000, entered = false, all = preload(urls, function (p) {
      $('loaderBar').style.width = Math.round(p * 100) + '%';
      $('loaderText').textContent = 'Cargando recorrido… ' + Math.round(p * 100) + ' %';
    });
    // En segundo plano, después: las imágenes fijas y, en ordenador, más detalle para cuando el
    // cliente se acerque.
    all.then(function () {
      var more = [];
      tour.scenes.forEach(function (s) { if (s.kind === 'image') more.push(base + s.image); });
      if (!PHONE) tour.scenes.forEach(function (s) { if (s.kind !== 'image') for (var z = displayLevel(s) + 1; z < s.levels.length; z++) more = more.concat(levelUrls(s, z)); });
      preload(more);
    });
    Promise.race([all, new Promise(function (r) { setTimeout(r, LOADER_MAX); })]).then(function () {
      if (entered) return;
      entered = true;
      autoOn = tour.settings.autorotate !== false;
      $('btnAuto').setAttribute('aria-pressed', String(autoOn));
      if (withCover) showCover(); else goTo(first ? first.id : startId());
      if (!autoOn) setAuto(false);
      if (!withCover || !coverPano()) {
        var st = withCover ? null : sceneData(first ? first.id : startId());
        if (!st || st.kind === 'image') firstShown(null);
      }
    });
  }).catch(function (e) {
    fail(location.protocol === 'file:' ? 'Abre este recorrido desde un servidor web (súbelo a tu hosting). Los navegadores no permiten cargarlo como archivo local.' : 'No se pudo cargar el recorrido: ' + e.message);
  });
})();
