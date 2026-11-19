// Recorridos360 — funciones compartidas entre el visor y el editor.
(function () {
  'use strict';
  var M = window.Marzipano;
  var DEFAULT_VIEW = { yaw: 0, pitch: 0, fov: Math.PI / 2 };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Límites del zoom. El límite de Marzipano multiplica la altura por la densidad de la pantalla:
  // en una Retina (Mac) el mínimo de campo de visión quedaba por encima del máximo, así que el zoom
  // no respondía y el viaje entre panoramas terminaba con un salto brusco. Aquí se cuenta en
  // píxeles de pantalla normales, igual en todos los equipos, y siempre queda margen para acercarse.
  var MIN_ZOOM_FOV = 60 * Math.PI / 180;
  // Cuánto se puede alejar la vista. Sin ajuste (proyectos de antes) se limita a 110° de alto y de
  // ancho, como siempre; en pantalla completa ancha el tope de ancho recortaba el alejamiento. Con
  // «Alejamiento máximo» (tour.settings.maxFov, en grados) manda el alto y el ancho llega hasta 150°.
  var DEG = Math.PI / 180, FOV_MAX = { v: 110 * DEG, h: 110 * DEG };
  function fovLimits(tour) {
    var m = tour && tour.settings && +tour.settings.maxFov;
    return m > 0 ? { v: m * DEG, h: Math.max(m, 150) * DEG } : { v: 110 * DEG, h: 110 * DEG };
  }
  function setFovLimits(tour) { FOV_MAX = fovLimits(tour); return FOV_MAX; }
  function sceneLimiter(faceSize) { return panoLimiter(faceSize, FOV_MAX.v, FOV_MAX.h); }
  function panoLimiter(faceSize, maxVFov, maxHFov) {
    var L = M.RectilinearView.limit;
    var range = M.util.compose(L.vfov(0, maxVFov), L.hfov(0, maxHFov != null ? maxHFov : maxVFov), L.pitch(-Math.PI / 2, Math.PI / 2));
    return function (p) {
      if (p.height) p.fov = Math.max(p.fov, Math.min(2 * Math.atan(p.height / faceSize), MIN_ZOOM_FOV));
      return range(p);
    };
  }

  // ---------- Gestos de zoom ----------
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  // Chrome, Firefox y Edge envían el pellizco del trackpad como rueda con Ctrl.
  var PINCH_RATE = 0.01, PINCH_MAX = 25;
  function wheelPx(e) { return e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 100 : 1); }
  function pinchFactor(e) { return Math.exp(-clamp(wheelPx(e), -PINCH_MAX, PINCH_MAX) * PINCH_RATE); }
  // Factor para imágenes (>1 acerca): notch por muesca de la rueda y proporcional en el trackpad.
  function wheelFactor(e, notch) {
    return e.ctrlKey ? pinchFactor(e) : Math.pow(notch, -clamp(wheelPx(e), -100, 100) / 100);
  }
  // Safari en Mac envía el pellizco como gesture*. En iPhone y iPad el gesto con los dedos ya lo
  // atiende cada visor por su cuenta: aquí solo se atiende si no hay dedos en la pantalla.
  function safariPinch(el, onStart, onScale) {
    var touches = 0;
    function count(e) { touches = e.touches.length; }
    ['touchstart', 'touchend', 'touchcancel'].forEach(function (ev) { el.addEventListener(ev, count, { capture: true, passive: true }); });
    el.addEventListener('gesturestart', function (e) { if (touches) return; e.preventDefault(); onStart(e); });
    el.addEventListener('gesturechange', function (e) { if (touches) return; e.preventDefault(); onScale(e.scale, e); });
    el.addEventListener('gestureend', function (e) { if (!touches) e.preventDefault(); });
  }
  // Pellizco sobre el panorama. getView() devuelve la vista, o null si ahora no se puede hacer zoom.
  // La rueda sin Ctrl (mouse, Magic Mouse, dos dedos) sigue a cargo de Marzipano.
  function panoGestures(el, getView) {
    var f0 = null;
    el.addEventListener('wheel', function (e) {
      if (!e.ctrlKey) return;
      e.preventDefault(); e.stopPropagation();
      var v = getView();
      if (v) v.setFov(v.fov() / pinchFactor(e));
    }, { capture: true, passive: false });
    safariPinch(el, function () {
      var v = getView();
      f0 = v ? v.fov() : null;
    }, function (scale) {
      var v = getView();
      if (v && f0 != null) v.setFov(2 * Math.atan(Math.tan(f0 / 2) / scale));
    });
  }

  // Carpeta de los mosaicos de un panorama. Al reemplazar su imagen se usa una carpeta nueva
  // (s.tileDir); los proyectos de antes usan la del id de la escena.
  function tileDir(s) { return 'tiles/' + (s.tileDir || s.id); }
  // Formato de los mosaicos: JPG en el editor; WebP en lo exportado con esa opción (tour.exported.tiles).
  var TILE_EXT = 'jpg';
  function setTileExt(e) { TILE_EXT = e === 'webp' ? 'webp' : 'jpg'; }
  function tileExt() { return TILE_EXT; }

  function createScene(viewer, base, s, opts) {
    var v = s.initialView || DEFAULT_VIEW;
    var source = M.ImageUrlSource.fromString(
      base + tileDir(s) + '/{z}/{f}/{y}/{x}.' + TILE_EXT,
      { cubeMapPreviewUrl: base + tileDir(s) + '/preview.' + TILE_EXT }
    );
    var geometry = new M.CubeGeometry(s.levels);
    var limiter = sceneLimiter(s.faceSize);
    var view = new M.RectilinearView({ yaw: v.yaw, pitch: v.pitch, fov: v.fov }, limiter);
    return viewer.createScene({ source: source, geometry: geometry, view: view, pinFirstLevel: true, textureStoreOpts: opts && opts.textureStoreOpts });
  }

  // ---------- Punto de variación ----------
  // Un 360 puede tener otras imágenes de la misma cámara (por ejemplo el mueble en otro color).
  // Van en un punto { type: 'variant', options: [{ id, name, tileDir, faceSize, levels }] }; la
  // primera opción (base: true) es la imagen propia de la escena. Todo es opcional: sin este punto
  // la escena funciona igual que antes.
  function variantOf(s) {
    var l = s && s.hotspots || [];
    for (var i = 0; i < l.length; i++) if (l[i].type === 'variant' && (l[i].options || []).length > 1) return l[i];
    return null;
  }
  // Una vista puede tener varios puntos de variación (por ejemplo la cocina y unas mamparas).
  function variantsOf(s) {
    return (s && s.hotspots || []).filter(function (h) { return h.type === 'variant' && (h.options || []).length > 1; });
  }
  // Imagen que corresponde a lo elegido en cada punto. sel = { idPunto: idOpción }; last = el último
  // punto que se cambió. Con una sola opción distinta de la original se usa su render; con dos o más
  // se busca la combinación (s.combos: [{ id, sel, tileDir, … }]) y, si no hay render para esa mezcla,
  // se ve el render del último punto que se tocó.
  function resolveVariant(s, sel, last) {
    var picked = [];
    variantsOf(s).forEach(function (h) {
      var id = sel && sel[h.id];
      for (var i = 0; id && i < h.options.length; i++) if (h.options[i].id === id && !h.options[i].base) { picked.push({ h: h, o: h.options[i] }); break; }
    });
    if (!picked.length) return s;
    if (picked.length === 1) return optionScene(s, picked[0].o);
    var c = comboFor(s, picked);
    if (c) return optionScene(s, c);
    var p = picked.filter(function (x) { return x.h.id === last; })[0] || picked[picked.length - 1];
    return optionScene(s, p.o);
  }
  // Combinación guardada para esas opciones (lista de { h, o }), o null.
  function comboFor(s, picked) {
    var l = s && s.combos || [];
    for (var i = 0; i < l.length; i++) {
      var c = l[i], keys = Object.keys(c.sel || {});
      if (!c.tileDir || keys.length !== picked.length) continue;
      if (picked.every(function (x) { return c.sel[x.h.id] === x.o.id; })) return c;
    }
    return null;
  }
  // Variaciones ligadas: los puntos con el mismo grupo (h.link) comparten la opción elegida,
  // reconocida por su nombre. Se comparan sin mayúsculas, tildes ni espacios de más.
  function linkKey(t) {
    return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  }
  function optionName(o, i) { return (o && o.name) || (i ? 'Variante ' + (i + 1) : 'Original'); }
  // La escena vista con la imagen de una opción (mismos datos, otra carpeta de mosaicos).
  function optionScene(s, o) {
    if (!o || o.base) return s;
    return Object.assign({}, s, { id: s.id + '~' + o.id, tileDir: o.tileDir, faceSize: o.faceSize || s.faceSize, levels: o.levels || s.levels });
  }
  // Capa extra en la MISMA escena: comparte la vista, así dirección y zoom son exactamente los mismos.
  function createVariantLayer(scene, base, ps, opts) {
    var source = M.ImageUrlSource.fromString(base + tileDir(ps) + '/{z}/{f}/{y}/{x}.' + TILE_EXT, { cubeMapPreviewUrl: base + tileDir(ps) + '/preview.' + TILE_EXT });
    var l = scene.createLayer({ source: source, geometry: new M.CubeGeometry(ps.levels), pinFirstLevel: true, textureStoreOpts: opts && opts.textureStoreOpts });
    l.__ps = ps;
    return l;
  }
  // Zonas de un punto de variación (puede haber varias: por ejemplo la cocina y la isla).
  // Proyectos antiguos guardan una sola en h.zone; los nuevos, una lista en h.zones.
  function zonesOf(h) {
    var l = h && (h.zones || (h.zone ? [h.zone] : [])) || [];
    return l.filter(function (z) { return z && z.length >= 3; });
  }
  // Zona de la variación en pantalla: los bordes se reparten en tramos (en la esfera son arcos).
  function zoneScreen(view, zone) {
    var out = [], n = zone ? zone.length : 0;
    if (n < 3) return null;
    function vec(p) { return [Math.sin(p.yaw) * Math.cos(p.pitch), -Math.sin(p.pitch), Math.cos(p.yaw) * Math.cos(p.pitch)]; }
    for (var i = 0; i < n; i++) {
      var a = vec(zone[i]), b = vec(zone[(i + 1) % n]);
      for (var k = 0; k < 12; k++) {
        var t = k / 12, v = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
        var c = view.coordinatesToScreen({ yaw: Math.atan2(v[0], v[2]), pitch: -Math.atan2(v[1], Math.sqrt(v[0] * v[0] + v[2] * v[2])) });
        if (c) out.push(c);
      }
    }
    return out.length >= 3 ? out : null;
  }
  function inPoly(pts, x, y) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      var a = pts[i], b = pts[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  // Las sombras van dibujadas dentro del SVG (trazo oscuro debajo): sin filtros CSS,
  // que obligan a redibujar el punto en cada cuadro al girar la vista.
  var CHEV = '<svg viewBox="0 0 24 12" aria-hidden="true"><path d="M3 10l9-7 9 7" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<path d="M3 10l9-7 9 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var INFO = '<svg viewBox="0 0 24 24" aria-hidden="true"><g stroke="rgba(0,0,0,.35)" stroke-width="4.6" stroke-linecap="round" fill="none"><path d="M12 6.5v0.01M12 10.5v8"/></g>' +
    '<circle cx="12" cy="6.5" r="1.7" fill="currentColor"/><path d="M12 10.5v8" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
  var PULSE = '<span class="r360-pulse"></span>';
  // Puerta de línea fina: marco fijo + hoja que se abre.
  var DOOR = '<span class="r360-door"><span class="r360-frame"></span><span class="r360-leaf"><i></i></span></span>';

  // Estilos de salto (el editor los muestra en este orden).
  var LINK_STYLES = [
    { id: 'circulo', name: 'Círculo', arrows: true },
    { id: 'suelo', name: 'En el suelo', arrows: true },
    { id: 'flechas', name: 'Solo flechas', arrows: true },
    { id: 'puerta', name: 'Puerta', arrows: false },
    { id: 'anillo', name: 'Solo círculo', arrows: false },
    { id: 'punto', name: 'Círculo con punto', arrows: false },
    { id: 'anillo-suelo', name: 'Círculo en el suelo', arrows: false },
    { id: 'punto-suelo', name: 'Punto en el suelo', arrows: false },
  ];
  // Estilos que van acostados en el suelo (con la inclinación automática).
  function onFloor(style) { return style === 'suelo' || style === 'anillo-suelo' || style === 'punto-suelo'; }
  // Cómo salen los saltos nuevos si el usuario no eligió otra cosa.
  var LINK_DEFAULTS = { style: 'suelo', arrows: 1, size: 1, color: null, animate: true };
  // ¿El salto lleva una flecha que se puede girar libremente? (no va pegado a una superficie)
  function hasArrowAngle(h) {
    return h.type === 'link' && !isFlat(h) && (!h.style || h.style === 'circulo' || h.style === 'flechas');
  }

  function chevrons(n) {
    n = Math.max(1, Math.min(3, n || 1));
    var s = '';
    for (var i = 0; i < n; i++) s += CHEV;
    return '<span class="r360-chevs r360-n' + n + '">' + s + '</span>';
  }

  function linkInner(style, arrows) {
    if (style === 'flechas') return chevrons(arrows);
    if (style === 'puerta') return PULSE + '<span class="r360-ring"></span>' + DOOR;
    if (style === 'anillo' || style === 'anillo-suelo') return PULSE + '<span class="r360-ring"></span>';
    if (style === 'punto' || style === 'punto-suelo') return PULSE + '<span class="r360-ring"></span><span class="r360-dot"></span>';
    return PULSE + '<span class="r360-ring"></span>' + chevrons(arrows);   // circulo y suelo
  }

  // Elemento DOM de un punto. type: 'link' | 'info'.
  // opts: { style, arrows (1-3), animate (true por defecto) }
  function hotspotEl(type, label, opts) {
    opts = typeof opts === 'string' ? { style: opts } : (opts || {});
    var el = document.createElement('div');
    var style = type === 'link' ? (opts.style || 'circulo') : 'info';
    el.className = 'r360-hs r360-' + type + ' r360-s-' + style + (opts.animate === false ? ' r360-static' : '');
    el.innerHTML = '<span class="r360-body">' +
      (type === 'link' ? linkInner(style, opts.arrows) : PULSE + '<span class="r360-ring"></span><span class="r360-icon">' + INFO + '</span>') + '</span>' +
      (label ? '<span class="r360-tip">' + esc(label) + '</span>' : '');
    if (opts.color) el.style.color = opts.color;
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    if (label) el.setAttribute('aria-label', label);
    return el;
  }

  // ¿El punto va "pegado" a una superficie (suelo/pared) en perspectiva?
  function isFlat(h) { return (h.type === 'link' && onFloor(h.style)) || !!h.flat; }

  // Inclinación automática para que quede acostado sobre el suelo: 90° − ángulo bajo el horizonte.
  function autoTilt(h) {
    if (!onFloor(h.style)) return 0;
    var below = Math.max(0, h.pitch * 180 / Math.PI);
    return Math.max(0, Math.min(85, 90 - below));
  }

  // Opciones de Marzipano: perspectiva con inclinación y giro para los puntos "pegados" a una superficie.
  function hotspotOptions(h) {
    if (!isFlat(h)) return undefined;
    var tilt = h.tilt != null ? h.tilt : autoTilt(h);
    return { perspective: { radius: 1000, extraTransforms: 'rotateX(' + tilt + 'deg) rotateY(' + (h.turn || 0) + 'deg) rotateZ(' + (h.rotate || 0) + 'deg)' } };
  }

  // Crea el punto en el panorama. Devuelve { el, handle }.
  function addHotspot(container, h, label) {
    var el = hotspotEl(h.type, label, { style: h.style, arrows: h.arrows, animate: h.animate });
    if (h.size && h.size !== 1) el.style.setProperty('--k', h.size);
    var opts = hotspotOptions(h);
    // En perspectiva Marzipano ya centra el elemento: sin el desplazamiento propio,
    // si no el punto parecería deslizarse al girar la vista.
    if (opts) el.classList.add('r360-persp');
    var handle = container.createHotspot(el, { yaw: h.yaw, pitch: h.pitch }, opts);
    return { el: el, handle: handle };
  }

  // Evita que arrastrar/hacer clic sobre un punto mueva el panorama.
  function stopPanoEvents(el) {
    ['pointerdown', 'touchstart', 'mousedown', 'wheel'].forEach(function (ev) {
      el.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true });
    });
  }

  // Zoom y desplazamiento para imágenes (planos). Devuelve {reset, zoomBy, getScale}.
  function zoomPan(viewport, content, onScale) {
    var s = 1, x = 0, y = 0, min = 1, max = 6, drag = null, pointers = new Map(), pinch = null;
    function apply() {
      var r = viewport.getBoundingClientRect();
      var maxX = (r.width * (s - 1)) / 2, maxY = (r.height * (s - 1)) / 2;
      x = Math.max(-maxX, Math.min(maxX, x));
      y = Math.max(-maxY, Math.min(maxY, y));
      content.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
      if (onScale) onScale(s);
    }
    function zoomAt(f, cx, cy) {
      var r = viewport.getBoundingClientRect();
      var ns = Math.max(min, Math.min(max, s * f));
      var px = cx - r.left - r.width / 2, py = cy - r.top - r.height / 2;
      x = px - (px - x) * (ns / s);
      y = py - (py - y) * (ns / s);
      s = ns;
      apply();
    }
    viewport.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoomAt(wheelFactor(e, 1.15), e.clientX, e.clientY);
    }, { passive: false });
    var s0 = 1;
    safariPinch(viewport, function () { s0 = s; }, function (scale, e) { zoomAt(s0 * scale / s, e.clientX, e.clientY); });
    viewport.addEventListener('pointerdown', function (e) {
      pointers.set(e.pointerId, e);
      if (pointers.size === 1) drag = { sx: e.clientX, sy: e.clientY, x: x, y: y, moved: false };
      if (pointers.size === 2) {
        var p = Array.from(pointers.values());
        pinch = { d: Math.hypot(p[0].clientX - p[1].clientX, p[0].clientY - p[1].clientY), s: s };
      }
    });
    window.addEventListener('pointermove', function (e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, e);
      if (pinch && pointers.size === 2) {
        var p = Array.from(pointers.values());
        var d = Math.hypot(p[0].clientX - p[1].clientX, p[0].clientY - p[1].clientY);
        zoomAt((pinch.s * d / pinch.d) / s, (p[0].clientX + p[1].clientX) / 2, (p[0].clientY + p[1].clientY) / 2);
      } else if (drag && s > 1) {
        if (Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) > 4) drag.moved = true;
        x = drag.x + e.clientX - drag.sx;
        y = drag.y + e.clientY - drag.sy;
        apply();
      }
    });
    function up(e) {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 0) setTimeout(function () { drag = null; }, 0);
    }
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return {
      reset: function () { s = 1; x = 0; y = 0; apply(); },
      zoomBy: function (f) { var r = viewport.getBoundingClientRect(); zoomAt(f, r.left + r.width / 2, r.top + r.height / 2); },
      wasDrag: function () { return !!(drag && drag.moved); },
    };
  }

  // ---------- Diseño del visor ----------
  var FONTS = ['Schibsted Grotesk', 'Newsreader', 'Sistema', 'Inter', 'Montserrat', 'Poppins', 'Raleway', 'Lato', 'Open Sans', 'Roboto', 'DM Sans', 'Work Sans',
    'Josefin Sans', 'Oswald', 'Nunito Sans', 'Playfair Display', 'Cormorant Garamond', 'Libre Baskerville'];
  var DEFAULT_THEME = {
    brand: null,            // nombre de empresa (null = usar el título del recorrido)
    brandColor: null,       // null = color de acento
    brandSize: 26,
    logoHeight: 90,
    font: 'Schibsted Grotesk',
    side: 'left',
    panelWidth: 290,
    panelBg: '#1c1d1a',
    panelOpacity: 0.92,
    panelBlur: 10,          // desenfoque de lo que se ve detrás del menú (px); 0 = sin desenfoque
    textColor: '#f0eee8',
    accent: '#b5122c',
    menuSize: 13,
    menuGap: 10,            // aire arriba y abajo de cada opción del menú (px): la separación vertical entre opciones
    uppercase: true,
    buttonBg: '#f0eee8',
    buttonColor: '#1c1d1a',
    showSceneName: true,    // nombre de la escena abajo en el visor
    loaderColor: null,      // null = color de acento
    logoX: 0,               // desplazamiento del logo en px
    logoY: 0,
    menuActive: null,       // color del elemento activo del menú (null = acento)
    hotspotHover: null,     // color de los puntos al pasar el mouse (null = acento)
    hotspotColor: null,     // color base de todos los puntos (null = blanco); un salto puede tener el suyo
    menuHover: '#ffffff',   // sombreado al pasar el mouse por el menú
    menuHoverOpacity: 0.08,
    toggleBg: '#111111',    // botón redondo que abre / cierra el menú
    toggleColor: '#ffffff',
    toggleBgOpacity: 1,     // opacidad del fondo del botón (0 = transparente)
    toggleIcon: 'circulo',  // 'circulo' (flecha dentro de un círculo) o 'flecha' (solo la flecha)
    toggleSize: 100,        // tamaño del botón (%), 100 = el de siempre
    toggleX: 0,             // mover el botón a los lados (px)
    toggleY: 0,             // subir (−) o bajar (+) el botón (px); 0 = centrado en la altura
    menuActiveBg: '#ffffff',  // fondo del elemento activo del menú
    menuActiveBgOpacity: 0,  // 0 = sin fondo
    backPos: 'top',         // botón Volver: 'top' (arriba de la lista) o 'bottom' (abajo)
    backX: 0,
    backY: 0,
    backCase: 'menu',       // letras de «Volver»: 'menu' (como el menú), 'upper' (MAYÚSCULAS) o 'normal'
    backStyle: 'texto',     // Volver: 'texto' (sencillo), 'acento' (destacado), 'borde' (con borde) o 'relleno'
    backColor: null,        // null = color de acento
    menuLines: 'todas',     // líneas entre opciones del menú: 'todas', 'sub' (sin líneas dentro de las carpetas) o 'ninguna'
    titleStyle: 'texto',    // subtítulo del submenú: 'texto' (sencillo), 'grande', 'acento' (con línea) o 'franja'
    titleColor: null,       // null = el de cada estilo
    titleSize: null,        // null = el de cada estilo
    titleLine: null,        // color de la línea (Con línea) o de la franja (Con franja); null = acento
  };
  function theme(tour) {
    var t = {}, src = tour.theme || {};
    for (var k in DEFAULT_THEME) t[k] = src[k] != null ? src[k] : DEFAULT_THEME[k];
    if (!src.accent && tour.settings && tour.settings.accent) t.accent = tour.settings.accent;  // proyectos antiguos
    return t;
  }
  function rgba(hex, a) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
  }
  function fontStack(name) {
    var sys = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';
    return !name || name === 'Sistema' ? sys : '"' + name + '", ' + sys;
  }
  function loadFont(name) {
    if (!name || name === 'Sistema') return;
    var id = 'gf-' + name.replace(/\s+/g, '-');
    if (document.getElementById(id)) return;
    var l = document.createElement('link');
    l.id = id; l.rel = 'stylesheet';
    l.href = 'https://fonts.googleapis.com/css2?family=' + name.replace(/\s+/g, '+') + ':wght@300;400;500;600;700&display=swap';
    document.head.appendChild(l);
  }

  // Nombre que ve el cliente: el «nombre en el menú» si se puso, si no el nombre de la escena.
  function sceneTitle(s) { return s ? (String(s.menuName || '').trim() || s.name || '') : ''; }

  window.R360 = {
    sceneTitle: sceneTitle,
    FONTS: FONTS, DEFAULT_THEME: DEFAULT_THEME, theme: theme, rgba: rgba, fontStack: fontStack, loadFont: loadFont,
    esc: esc, createScene: createScene, tileDir: tileDir, hotspotEl: hotspotEl, addHotspot: addHotspot, isFlat: isFlat, autoTilt: autoTilt,
    LINK_STYLES: LINK_STYLES, LINK_DEFAULTS: LINK_DEFAULTS, onFloor: onFloor, hasArrowAngle: hasArrowAngle, panoLimiter: panoLimiter, sceneLimiter: sceneLimiter, fovLimits: fovLimits, setFovLimits: setFovLimits, setTileExt: setTileExt, tileExt: tileExt, getFovMax: function () { return FOV_MAX; }, panoGestures: panoGestures, safariPinch: safariPinch, wheelFactor: wheelFactor, stopPanoEvents: stopPanoEvents, zoomPan: zoomPan, DEFAULT_VIEW: DEFAULT_VIEW,
    variantOf: variantOf, variantsOf: variantsOf, resolveVariant: resolveVariant, comboFor: comboFor, optionScene: optionScene, linkKey: linkKey, optionName: optionName, createVariantLayer: createVariantLayer, zoneScreen: zoneScreen, zonesOf: zonesOf, inPoly: inPoly,
  };
})();
