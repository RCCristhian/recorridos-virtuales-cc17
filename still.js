// Recorridos360 — imágenes fijas (renders estáticos), zoom general y menú en niveles.
(function () {
  'use strict';
  var R = window.R360 = window.R360 || {};
  var DEG = Math.PI / 180;

  // ---------- Zoom (campo de visión) ----------
  // Cada panorama usa el zoom general del recorrido salvo que tenga uno propio (initialView.fov).
  R.DEFAULT_FOV_DEG = 90;
  R.effectiveFov = function (tour, s) {
    if (s && s.initialView && s.initialView.fov != null) return s.initialView.fov;
    var g = tour && tour.settings && tour.settings.defaultFov;
    return (g || R.DEFAULT_FOV_DEG) * DEG;
  };

  // ---------- Menú en niveles ----------
  // Nodo: { id, type: 'folder', name, children: [...] }
  //       { id, type: 'scene' | 'plan', ref }
  //       { id, type: 'link', name, url, mode: 'popup' | 'tab' }
  function nid() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  R.newNodeId = nid;
  // Convierte menús de versiones anteriores (categorías con items) al formato en árbol.
  R.normalizeMenu = function (tour) {
    function fix(node) {
      if (!node || typeof node !== 'object') return null;
      if (!node.id) node.id = nid();
      if (node.type === 'folder' || (!node.type && Array.isArray(node.items))) {
        var kids = node.children || node.items || [];
        return { id: node.id, type: 'folder', name: node.name || 'Carpeta', children: kids.map(fix).filter(Boolean) };
      }
      if (node.type === 'scene' || node.type === 'plan') return { id: node.id, type: node.type, ref: node.ref };
      if (node.type === 'link') return { id: node.id, type: 'link', name: node.name || 'Enlace', url: node.url || '', mode: node.mode === 'tab' ? 'tab' : 'popup' };
      return null;
    }
    tour.menu = (tour.menu || []).map(fix).filter(Boolean);
    return tour.menu;
  };
  // Recorre el árbol. fn(node, parentArray, index, depth) — si devuelve true, se detiene.
  R.walkMenu = function (list, fn, depth) {
    depth = depth || 0;
    for (var i = 0; i < list.length; i++) {
      if (fn(list[i], list, i, depth)) return true;
      if (list[i].type === 'folder' && R.walkMenu(list[i].children, fn, depth + 1)) return true;
    }
    return false;
  };
  R.findNode = function (list, id) {
    var found = null;
    R.walkMenu(list, function (n, arr, i) { if (n.id === id) { found = { node: n, list: arr, index: i }; return true; } });
    return found;
  };
  R.folderContainsScene = function (folder, sceneId) {
    var yes = false;
    R.walkMenu(folder.children || [], function (n) { if (n.type === 'scene' && n.ref === sceneId) { yes = true; return true; } });
    return yes;
  };

  // ---------- Visor de imagen fija ----------
  // Encuadre: { cx, cy } = punto de la imagen (0–1) que queda al centro de la pantalla;
  // zoom 1 = la imagen cubre toda la pantalla; menos de 1 deja ver la imagen completa.
  function StillView(host, opts) {
    opts = opts || {};
    var self = this;
    this.host = host; this.opts = opts;
    this.f = { cx: 0.5, cy: 0.5, zoom: 1 };
    this.iw = 0; this.ih = 0;
    host.classList.add('r360-still');
    this.img = document.createElement('img');
    this.img.className = 'r360-still-img';
    this.img.alt = '';
    this.img.draggable = false;
    host.appendChild(this.img);
    this.img.addEventListener('load', function () { self.iw = self.img.naturalWidth; self.ih = self.img.naturalHeight; self.layout(); if (opts.onLoad) opts.onLoad(); });
    this._ro = new ResizeObserver(function () { self.layout(); });
    this._ro.observe(host);
    if (opts.interactive !== false) this._bind();
  }
  StillView.prototype.load = function (url, framing, alt) {
    this.setFraming(framing, true);
    this.img.alt = alt || '';
    if (this.img.getAttribute('src') !== url) { this.iw = this.ih = 0; this.img.src = url; }
    else this.layout();
  };
  StillView.prototype.setFraming = function (f, silent) {
    f = f || {};
    this.f = { cx: f.cx != null ? f.cx : 0.5, cy: f.cy != null ? f.cy : 0.5, zoom: f.zoom || 1 };
    this.layout(silent);
  };
  StillView.prototype.getFraming = function () {
    return { cx: +this.f.cx.toFixed(4), cy: +this.f.cy.toFixed(4), zoom: +this.f.zoom.toFixed(3) };
  };
  StillView.prototype.limits = function () {
    var W = this.host.clientWidth, H = this.host.clientHeight;
    if (!this.iw || !W || !H) return null;
    var cover = Math.max(W / this.iw, H / this.ih), contain = Math.min(W / this.iw, H / this.ih);
    return { W: W, H: H, cover: cover, min: contain / cover, max: 6 };
  };
  StillView.prototype.layout = function (silent) {
    var L = this.limits();
    if (!L) return;
    var f = this.f;
    f.zoom = Math.max(L.min, Math.min(L.max, f.zoom));
    var s = L.cover * f.zoom, dw = this.iw * s, dh = this.ih * s;
    // Si la imagen es más grande que la pantalla no se puede salir de borde; si es más chica, se centra.
    if (dw > L.W) { var hx = L.W / 2 / dw; f.cx = Math.max(hx, Math.min(1 - hx, f.cx)); } else f.cx = 0.5;
    if (dh > L.H) { var hy = L.H / 2 / dh; f.cy = Math.max(hy, Math.min(1 - hy, f.cy)); } else f.cy = 0.5;
    var tx = L.W / 2 - f.cx * dw, ty = L.H / 2 - f.cy * dh;
    var img = this.img;
    img.style.width = this.iw + 'px';
    img.style.height = this.ih + 'px';
    img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
    if (!silent && this.opts.onChange) this.opts.onChange(this.getFraming());
  };
  // Zoom manteniendo fijo el punto de la pantalla (px, py).
  StillView.prototype.zoomAt = function (factor, px, py) {
    var L = this.limits(); if (!L) return;
    var f = this.f, s = L.cover * f.zoom;
    var ix = f.cx + (px - L.W / 2) / (this.iw * s), iy = f.cy + (py - L.H / 2) / (this.ih * s);
    f.zoom = Math.max(L.min, Math.min(L.max, f.zoom * factor));
    var s2 = L.cover * f.zoom;
    f.cx = ix - (px - L.W / 2) / (this.iw * s2);
    f.cy = iy - (py - L.H / 2) / (this.ih * s2);
    this.layout();
  };
  StillView.prototype.setZoom = function (z) {
    var L = this.limits(); if (!L) { this.f.zoom = z; return; }
    this.zoomAt(z / this.f.zoom, L.W / 2, L.H / 2);
  };
  StillView.prototype._bind = function () {
    var self = this, host = this.host, ptrs = new Map(), drag = null, pinch = null;
    host.addEventListener('wheel', function (e) {
      e.preventDefault();
      var b = host.getBoundingClientRect();
      self.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - b.left, e.clientY - b.top);
    }, { passive: false });
    host.addEventListener('pointerdown', function (e) {
      ptrs.set(e.pointerId, e);
      host.setPointerCapture(e.pointerId);
      if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, cx: self.f.cx, cy: self.f.cy };
      if (ptrs.size === 2) { var p = Array.from(ptrs.values()); pinch = { d: Math.hypot(p[0].clientX - p[1].clientX, p[0].clientY - p[1].clientY), z: self.f.zoom }; }
      host.classList.add('dragging');
    });
    host.addEventListener('pointermove', function (e) {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, e);
      var L = self.limits(); if (!L) return;
      if (pinch && ptrs.size === 2) {
        var p = Array.from(ptrs.values()), b = host.getBoundingClientRect();
        var d = Math.hypot(p[0].clientX - p[1].clientX, p[0].clientY - p[1].clientY);
        self.zoomAt((pinch.z * d / pinch.d) / self.f.zoom, (p[0].clientX + p[1].clientX) / 2 - b.left, (p[0].clientY + p[1].clientY) / 2 - b.top);
      } else if (drag) {
        var s = L.cover * self.f.zoom;
        self.f.cx = drag.cx - (e.clientX - drag.x) / (self.iw * s);
        self.f.cy = drag.cy - (e.clientY - drag.y) / (self.ih * s);
        self.layout();
      }
    });
    function up(e) {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (ptrs.size === 1) { var q = Array.from(ptrs.values())[0]; drag = { x: q.clientX, y: q.clientY, cx: self.f.cx, cy: self.f.cy }; }
      if (!ptrs.size) { drag = null; host.classList.remove('dragging'); if (self.opts.onEnd) self.opts.onEnd(self.getFraming()); }
    }
    host.addEventListener('pointerup', up);
    host.addEventListener('pointercancel', up);
  };
  StillView.prototype.destroy = function () { this._ro.disconnect(); this.img.remove(); };
  R.StillView = StillView;
})();
