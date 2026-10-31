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

  function createScene(viewer, base, s, opts) {
    var v = s.initialView || DEFAULT_VIEW;
    var source = M.ImageUrlSource.fromString(
      base + 'tiles/' + s.id + '/{z}/{f}/{y}/{x}.jpg',
      { cubeMapPreviewUrl: base + 'tiles/' + s.id + '/preview.jpg' }
    );
    var geometry = new M.CubeGeometry(s.levels);
    var limiter = M.RectilinearView.limit.traditional(s.faceSize, 110 * Math.PI / 180);
    var view = new M.RectilinearView({ yaw: v.yaw, pitch: v.pitch, fov: v.fov }, limiter);
    return viewer.createScene({ source: source, geometry: geometry, view: view, pinFirstLevel: true });
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
  ];

  function chevrons(n) {
    n = Math.max(1, Math.min(3, n || 1));
    var s = '';
    for (var i = 0; i < n; i++) s += CHEV;
    return '<span class="r360-chevs r360-n' + n + '">' + s + '</span>';
  }

  function linkInner(style, arrows) {
    if (style === 'flechas') return chevrons(arrows);
    if (style === 'puerta') return PULSE + '<span class="r360-ring"></span>' + DOOR;
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
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    if (label) el.setAttribute('aria-label', label);
    return el;
  }

  // ¿El punto va "pegado" a una superficie (suelo/pared) en perspectiva?
  function isFlat(h) { return (h.type === 'link' && h.style === 'suelo') || !!h.flat; }

  // Inclinación automática para que quede acostado sobre el suelo: 90° − ángulo bajo el horizonte.
  function autoTilt(h) {
    if (h.style !== 'suelo') return 0;
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
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    }, { passive: false });
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
    textColor: '#f0eee8',
    accent: '#b5122c',
    menuSize: 13,
    uppercase: true,
    buttonBg: '#f0eee8',
    buttonColor: '#1c1d1a',
    showSceneName: true,    // nombre de la escena abajo en el visor
    loaderColor: null,      // null = color de acento
    logoX: 0,               // desplazamiento del logo en px
    logoY: 0,
    menuActive: null,       // color del elemento activo del menú (null = acento)
    hotspotHover: null,     // color de los puntos al pasar el mouse (null = acento)
    menuHover: '#ffffff',   // sombreado al pasar el mouse por el menú
    menuHoverOpacity: 0.08,
    toggleBg: '#111111',    // botón redondo que abre / cierra el menú
    toggleColor: '#ffffff',
    menuActiveBg: '#ffffff',  // fondo del elemento activo del menú
    menuActiveBgOpacity: 0,  // 0 = sin fondo
    backPos: 'top',         // botón Volver: 'top' (arriba de la lista) o 'bottom' (abajo)
    backX: 0,
    backY: 0,
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

  window.R360 = {
    FONTS: FONTS, DEFAULT_THEME: DEFAULT_THEME, theme: theme, rgba: rgba, fontStack: fontStack, loadFont: loadFont,
    esc: esc, createScene: createScene, hotspotEl: hotspotEl, addHotspot: addHotspot, isFlat: isFlat, autoTilt: autoTilt,
    LINK_STYLES: LINK_STYLES, stopPanoEvents: stopPanoEvents, zoomPan: zoomPan, DEFAULT_VIEW: DEFAULT_VIEW,
  };
})();
