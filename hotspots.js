// Recorridos360 — capa de puntos dibujada en canvas.
//
// Por qué canvas y no elementos HTML: en Windows, Chromium muestra los elementos HTML
// un cuadro después que la imagen WebGL del panorama, así que al girar rápido los puntos
// "bailan". Un canvas 2D dibujado en el mismo momento que el panorama (evento afterRender
// de Marzipano) se muestra en el mismo cuadro: quedan clavados en la imagen.
(function () {
  'use strict';

  var RAD = 1000;               // radio de la esfera en px (igual que la perspectiva CSS de Marzipano)
  var DEG = Math.PI / 180;

  // ---------- Geometría ----------
  function dirFrom(yaw, pitch) {   // x derecha, y arriba, z adelante; pitch + = abajo (Marzipano)
    return [Math.sin(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
  }
  function coordsOf(v) {
    return { yaw: Math.atan2(v[0], v[2]), pitch: -Math.atan2(v[1], Math.sqrt(v[0] * v[0] + v[2] * v[2])) };
  }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }

  function autoTilt(h) {
    if (h.style !== 'suelo') return 0;
    var below = Math.max(0, h.pitch * 180 / Math.PI);
    return Math.max(0, Math.min(85, 90 - below));
  }
  function isFlat(h) { return (h.type === 'link' && h.style === 'suelo') || !!h.flat; }

  // Devuelve una función local(x, y) → punto de pantalla {x, y} (o null si queda detrás).
  // Coordenadas locales en px, y hacia abajo, centro del punto en (0,0); igual que la
  // transformación CSS rotateX(inclinación) rotateY(giro) rotateZ(rotación) de Marzipano.
  function projector(view, h, k) {
    var c = view.coordinatesToScreen({ yaw: h.yaw, pitch: h.pitch });
    if (!c) return null;
    if (!isFlat(h)) {
      var aa = window.R360.hasArrowAngle(h) ? (h.arrowAngle || 0) * DEG : 0, ca = Math.cos(aa), sa = Math.sin(aa);
      return { center: c, flat: false, map: function (x, y) { return { x: c.x + (x * ca - y * sa) * k, y: c.y + (x * sa + y * ca) * k }; } };
    }
    var d = dirFrom(h.yaw, h.pitch);
    var R = [Math.cos(h.yaw), 0, -Math.sin(h.yaw)];
    var U = cross(d, R);
    var t = (h.tilt != null ? h.tilt : autoTilt(h)) * DEG, tu = (h.turn || 0) * DEG, ro = (h.rotate || 0) * DEG;
    var ct = Math.cos(t), st = Math.sin(t), cu = Math.cos(tu), su = Math.sin(tu), cr = Math.cos(ro), sr = Math.sin(ro);
    return {
      center: c, flat: true,
      map: function (x, y) {
        x *= k; y *= k;
        var x1 = x * cr - y * sr, y1 = x * sr + y * cr, z1 = 0;          // rotateZ
        var x2 = x1 * cu + z1 * su, z2 = -x1 * su + z1 * cu, y2 = y1;     // rotateY
        var y3 = y2 * ct - z2 * st, z3 = y2 * st + z2 * ct, x3 = x2;      // rotateX
        // local (x derecha, y abajo, z hacia la cámara) → mundo
        var P = [
          d[0] * RAD + R[0] * x3 - U[0] * y3 - d[0] * z3,
          d[1] * RAD + R[1] * x3 - U[1] * y3 - d[1] * z3,
          d[2] * RAD + R[2] * x3 - U[2] * y3 - d[2] * z3,
        ];
        return view.coordinatesToScreen(coordsOf(P));
      },
    };
  }

  // ---------- Animación ----------
  function ease(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }
  function pulse(now) {                           // 2 s: anillo que crece y se desvanece
    var p = (now / 2000) % 1;
    if (p > 0.7) return null;
    var e = 1 - Math.pow(1 - p / 0.7, 3);
    return { scale: 1 + 0.75 * e, alpha: 0.85 * (1 - e) };
  }
  function chevAlpha(now, delay) {                // 1.6 s, se encienden en secuencia
    var p = ((now / 1000 - delay) / 1.6) % 1; if (p < 0) p += 1;
    return p < 0.4 ? 0.25 + 0.75 * ease(p / 0.4) : 1 - 0.75 * ease((p - 0.4) / 0.6);
  }
  function chev1(now) {                           // una sola flecha: sube y baja
    var p = (now / 1600) % 1, e = ease(p < 0.5 ? p * 2 : 2 - p * 2);
    return { alpha: 0.55 + 0.45 * e, dy: 0.12 - 0.26 * e };
  }
  function doorAngle(now) {                       // 3 s: se abre y se cierra
    var p = (now / 3000) % 1;
    if (p < 0.15) return 0;
    if (p < 0.45) return -65 * ease((p - 0.15) / 0.3);
    if (p < 0.7) return -65;
    return -65 * (1 - ease((p - 0.7) / 0.3));
  }

  // ---------- Dibujo ----------
  function polyline(ctx, pr, pts, close) {
    var started = false;
    ctx.beginPath();
    for (var i = 0; i < pts.length; i++) {
      var s = pr.map(pts[i][0], pts[i][1]);
      if (!s) { started = false; continue; }
      if (!started) { ctx.moveTo(s.x, s.y); started = true; } else ctx.lineTo(s.x, s.y);
    }
    if (close) ctx.closePath();
  }
  function circlePts(r, n) {
    var pts = [];
    for (var i = 0; i <= n; i++) { var a = i / n * Math.PI * 2; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
    return pts;
  }
  // Grosor de línea en pantalla: en perspectiva se escala según el tamaño aparente.
  function lw(pr, w, k) {
    if (!pr.flat) return w * k;
    var a = pr.map(0, 0), b = pr.map(10, 0), c = pr.map(0, 10);
    if (!a || !b || !c) return w * k;
    return w * Math.max(0.35, (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - a.x, c.y - a.y)) / 20);
  }

  function drawRing(ctx, pr, r, stroke, k, color, alpha) {
    var pts = circlePts(r, pr.flat ? 64 : 48);
    ctx.globalAlpha = alpha;
    // relleno tenue + sombra para que se lea sobre fondos claros
    polyline(ctx, pr, pts, true);
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fill();
    ctx.lineWidth = lw(pr, stroke + 2, k); ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.stroke();
    ctx.lineWidth = lw(pr, stroke, k); ctx.strokeStyle = color; ctx.stroke();
    ctx.globalAlpha = 1;
  }
  function drawChevrons(ctx, pr, width, n, k, anim, now, color) {
    var s = width / 24;                   // viewBox 24×12 del ícono
    var gap = 6.5 * s;                    // separación vertical entre flechas
    for (var i = 0; i < n; i++) {
      var oy = (i - (n - 1) / 2) * gap, alpha = 1, dy = 0;
      if (anim) {
        if (n === 1) { var c1 = chev1(now); alpha = c1.alpha; dy = c1.dy * 12 * s; }
        else alpha = chevAlpha(now, (n - 1 - i) * 0.22);
      }
      var pts = [[-9 * s, 3.5 * s + oy + dy], [0, -3.5 * s + oy + dy], [9 * s, 3.5 * s + oy + dy]];
      ctx.globalAlpha = alpha; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      polyline(ctx, pr, pts); ctx.lineWidth = lw(pr, 4.6 * s, k); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
      polyline(ctx, pr, pts); ctx.lineWidth = lw(pr, 2.6 * s, k); ctx.strokeStyle = color; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  function drawDoor(ctx, pr, HS, k, anim, now, color) {
    var w = 0.34 * HS, h = 0.5 * HS, x0 = -w / 2, y0 = -h / 2, b = 2;
    // marco (sin línea inferior)
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    polyline(ctx, pr, [[x0, -y0], [x0, y0], [-x0, y0], [-x0, -y0]]);
    ctx.lineWidth = lw(pr, b + 1.5, k); ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.stroke();
    ctx.lineWidth = lw(pr, b, k); ctx.strokeStyle = color; ctx.stroke();
    // hoja: gira sobre la bisagra izquierda (perspectiva aproximada)
    var ang = (anim ? doorAngle(now) : -38) * DEG;
    var lx0 = x0 + b, ly0 = y0 + b, lw0 = w - 2 * b, lh = h - b;
    var xr = lx0 + lw0 * Math.cos(ang), shrink = 0.16 * Math.abs(Math.sin(ang)) * lh;
    var leaf = [[lx0, ly0], [xr, ly0 + shrink / 2], [xr, ly0 + lh - shrink / 2], [lx0, ly0 + lh]];
    ctx.globalAlpha = 0.92; polyline(ctx, pr, leaf, true); ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
    // manija
    var kx = lx0 + (xr - lx0) * 0.78, ky = ly0 + lh * 0.52, kw = Math.max(1, Math.abs(xr - lx0) * 0.14);
    polyline(ctx, pr, [[kx - kw / 2, ky], [kx + kw / 2, ky]]); ctx.lineWidth = lw(pr, 1.6, k); ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
  }
  function drawInfo(ctx, pr, HS, k) {
    var s = 0.46 * HS / 24;
    var line = [[0, (10.5 - 12) * s], [0, (18.5 - 12) * s]], dot = [0, (6.5 - 12) * s];
    ctx.lineCap = 'round';
    polyline(ctx, pr, line); ctx.lineWidth = lw(pr, 4.6 * s, k); ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.stroke();
    polyline(ctx, pr, line); ctx.lineWidth = lw(pr, 2.6 * s, k); ctx.strokeStyle = '#fff'; ctx.stroke();
    var c = pr.map(dot[0], dot[1]);
    if (c) { ctx.beginPath(); ctx.arc(c.x, c.y, Math.max(1.2, lw(pr, 1.9 * s, k)), 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); }
  }
  function drawLabel(ctx, x, y, text, font) {
    ctx.font = font;
    var w = ctx.measureText(text).width + 20, h = 26, r = 4;
    var lx = Math.round(x - w / 2), ly = Math.round(y - h);
    ctx.beginPath();
    ctx.moveTo(lx + r, ly); ctx.arcTo(lx + w, ly, lx + w, ly + h, r); ctx.arcTo(lx + w, ly + h, lx, ly + h, r);
    ctx.arcTo(lx, ly + h, lx, ly, r); ctx.arcTo(lx, ly, lx + w, ly, r); ctx.closePath();
    ctx.fillStyle = 'rgba(28,29,26,0.88)'; ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, x, ly + h / 2 + 0.5);
  }

  // Tamaño base de cada estilo (igual que el CSS de las vistas previas).
  function baseSize(h) {
    if (h.type !== 'link') return { HS: 56, stroke: 3.5 };
    if (h.style === 'suelo') return { HS: 120, stroke: 6 };
    return { HS: 56, stroke: 3.5 };
  }

  // ---------- Capa ----------
  // opts: { onClick(h), labelFor(h) → texto, labels: 'hover' | 'always', accent }
  // opts.gl: los puntos se pintan DENTRO del mismo lienzo WebGL del panorama (visor público).
  // En celulares (sobre todo iPhone) el navegador puede mostrar el lienzo WebGL y cualquier otra
  // capa en cuadros distintos, aunque se dibujen a la vez: los puntos "bailaban" al arrastrar.
  // En un único lienzo la imagen y los puntos salen siempre juntos, en cualquier navegador.
  function HotspotLayer(viewer, host, opts) {
    var self = this;
    this.viewer = viewer; this.host = host; this.opts = opts || {};
    this.scene = null; this.list = []; this.hover = null; this.selected = null; this.hits = [];
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'r360-layer';
    this.canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2';
    this.gl = null;
    if (this.opts.gl) { try { this.gl = new GlOverlay(viewer.stage().webGlContext()); } catch (e) { this.gl = null; } }
    if (!this.gl) host.appendChild(this.canvas);   // sin WebGL: capa canvas aparte, como antes
    this.ctx = this.canvas.getContext('2d');
    this.font = '500 13px "Schibsted Grotesk", "Segoe UI", system-ui, sans-serif';
    this._draw = function () { self.paint(); if (self.gl) self.gl.compose(self.canvas, self._drawn); };
    viewer.renderLoop().addEventListener('afterRender', this._draw);
    // Bucle propio solo para las animaciones cuando el panorama está quieto.
    this._raf = 0;
    var tick = function () { self._raf = requestAnimationFrame(tick); if (self._needsAnim) self.draw(); };
    this._raf = requestAnimationFrame(tick);
    this._bindPointer();
  }

  // Pinta el canvas de los puntos encima de lo que el panorama acaba de dibujar en WebGL.
  // Se llama justo después de que Marzipano dibuja el cuadro (mismo momento, mismo lienzo).
  // Deja el estado de WebGL que Marzipano vuelve a fijar en cada cuadro; las opciones de carga de
  // imágenes quedan como las usa Marzipano (voltear y premultiplicar).
  function GlOverlay(gl) {
    if (!gl) throw new Error('sin WebGL');
    this.g = gl;
    var vs = 'attribute vec2 p;varying vec2 uv;void main(){uv=p*0.5+0.5;gl_Position=vec4(p,0.0,1.0);}';
    var fs = 'precision mediump float;varying vec2 uv;uniform sampler2D t;void main(){gl_FragColor=texture2D(t,uv);}';
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; }
    var pr = gl.createProgram();
    gl.attachShader(pr, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('shader');
    this.prog = pr; this.aP = gl.getAttribLocation(pr, 'p'); this.uT = gl.getUniformLocation(pr, 't');
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  GlOverlay.prototype.compose = function (canvas, drawn) {
    var gl = this.g;
    if (!drawn || !canvas.width || !canvas.height || gl.isContextLost()) return;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.useProgram(this.prog);
    gl.uniform1i(this.uT, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.enableVertexAttribArray(this.aP);
    gl.vertexAttribPointer(this.aP, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disableVertexAttribArray(this.aP);
    gl.enable(gl.DEPTH_TEST);
  };

  HotspotLayer.prototype.setScene = function (scene, list) {
    this.scene = scene; this.list = list || []; this.hover = null;
    this.draw();
  };
  HotspotLayer.prototype.setList = function (list) { this.list = list || []; this.draw(); };
  HotspotLayer.prototype.setSelected = function (id) { this.selected = id; this.draw(); };
  HotspotLayer.prototype.refresh = function () { this.draw(); };

  // Volver a dibujar. Con opts.gl se pide un cuadro nuevo del panorama y los puntos se pintan
  // en ese mismo cuadro (fuera de él, el lienzo WebGL ya se mostró y no se puede retocar).
  HotspotLayer.prototype.draw = function () {
    if (this.gl) { this.viewer.renderLoop().renderOnNextFrame(); return; }
    this.paint();
  };

  HotspotLayer.prototype.paint = function () {
    var cv = this.canvas, ctx = this.ctx, host = this.host;
    var w = host.clientWidth, h = host.clientHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.hits = [];
    this._needsAnim = false;
    this._drawn = false;
    var scene = this.scene;
    if (!scene || this.viewer.scene() !== scene) return;
    var view = scene.view(), now = performance.now();
    var cs = getComputedStyle(document.documentElement);
    var accent = this.opts.accent || cs.getPropertyValue('--hs-accent').trim() || cs.getPropertyValue('--accent').trim() || '#b5122c';
    var labels = [];
    for (var i = 0; i < this.list.length; i++) {
      var hs = this.list[i];
      if (this.opts.filter && !this.opts.filter(hs)) continue;
      var k = hs.size || 1;
      var pr = projector(view, hs, k);
      if (!pr) continue;
      var c = pr.center;
      if (c.x < -200 || c.y < -200 || c.x > w + 200 || c.y > h + 200) continue;
      var bs = baseSize(hs), HS = bs.HS, r = HS / 2 - bs.stroke / 2;
      var anim = hs.animate !== false, style = hs.type === 'link' ? (hs.style || 'circulo') : 'info';
      var isHover = this.hover === hs.id, isSel = this.selected === hs.id;
      var color = (hs.type === 'link' && hs.color) || '#fff';
      var ringColor = isHover ? accent : color;
      if (anim) this._needsAnim = true;
      this._drawn = true;

      if (style !== 'flechas') {
        if (anim) { var p = pulse(now); if (p) drawRing(ctx, pr, r * p.scale, bs.stroke, k, color, p.alpha); }
        drawRing(ctx, pr, r, bs.stroke, k, ringColor, 1);
      }
      if (style === 'circulo' || style === 'suelo') drawChevrons(ctx, pr, 0.52 * HS, Math.max(1, Math.min(3, hs.arrows || 1)), k, anim, now, color);
      else if (style === 'flechas') drawChevrons(ctx, pr, 0.74 * HS, Math.max(1, Math.min(3, hs.arrows || 1)), k, anim, now, color);
      else if (style === 'puerta') drawDoor(ctx, pr, HS, k, anim, now, color);
      else drawInfo(ctx, pr, HS, k);

      // Radio de clic en pantalla
      var rim = pr.flat ? [pr.map(r, 0), pr.map(-r, 0), pr.map(0, r), pr.map(0, -r)].filter(Boolean) : [];
      var rad = rim.length ? Math.max.apply(null, rim.map(function (q) { return Math.hypot(q.x - c.x, q.y - c.y); })) : r * k;
      rad = Math.max(rad, 18);
      var top = rim.length ? Math.min.apply(null, rim.map(function (q) { return q.y; })) : c.y - rad;
      this.hits.push({ h: hs, x: c.x, y: c.y, r: rad, top: top });

      if (isSel) {
        ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.strokeStyle = '#fff';
        ctx.beginPath(); ctx.arc(c.x, c.y, rad + 7, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      var text = this.opts.labelFor ? this.opts.labelFor(hs) : '';
      if (text && (this.opts.labels === 'always' || isHover)) labels.push([c.x, top - 8, text]);
    }
    for (var j = 0; j < labels.length; j++) drawLabel(ctx, labels[j][0], labels[j][1], labels[j][2], this.font);
  };

  // Punto bajo el cursor (el último dibujado queda encima).
  HotspotLayer.prototype.hit = function (clientX, clientY) {
    var b = this.host.getBoundingClientRect(), x = clientX - b.left, y = clientY - b.top;
    for (var i = this.hits.length - 1; i >= 0; i--) {
      var t = this.hits[i];
      if (Math.hypot(x - t.x, y - t.y) <= t.r) return t.h;
    }
    return null;
  };

  // Clic y hover. Los eventos se capturan en el contenedor antes de que lleguen a Marzipano,
  // así hacer clic o arrastrar un punto no mueve el panorama.
  HotspotLayer.prototype._bindPointer = function () {
    var self = this, host = this.host, down = null;
    function block(e) { if (self.hit(e.clientX != null ? e.clientX : e.touches[0].clientX, e.clientY != null ? e.clientY : e.touches[0].clientY)) e.stopPropagation(); }
    this._onDown = function (e) {
      var h = self.hit(e.clientX, e.clientY);
      if (!h) { down = null; return; }
      e.stopPropagation(); e.preventDefault();
      down = { h: h, x: e.clientX, y: e.clientY, id: e.pointerId, moved: false };
      if (self.opts.onDragStart) self.opts.onDragStart(h, e);
    };
    this._onMove = function (e) {
      if (down && e.pointerId === down.id) {
        if (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) > 4) down.moved = true;
        if (down.moved && self.opts.onDrag) self.opts.onDrag(down.h, e);
        return;
      }
      if (e.pointerType === 'touch' || e.buttons) return;
      var h = self.hit(e.clientX, e.clientY), id = h ? h.id : null;
      if (id !== self.hover) { self.hover = id; host.style.cursor = h ? 'pointer' : ''; self.draw(); }
    };
    this._onUp = function (e) {
      if (!down || e.pointerId !== down.id) return;
      var d = down; down = null;
      e.stopPropagation();
      if (d.moved) { if (self.opts.onDragEnd) self.opts.onDragEnd(d.h, e); }
      else if (self.opts.onClick) self.opts.onClick(d.h, e);
    };
    this._onLeave = function () { if (self.hover) { self.hover = null; host.style.cursor = ''; self.draw(); } };
    host.addEventListener('pointerdown', this._onDown, true);
    window.addEventListener('pointermove', this._onMove, true);
    window.addEventListener('pointerup', this._onUp, true);
    host.addEventListener('pointerleave', this._onLeave);
    ['mousedown', 'touchstart'].forEach(function (ev) { host.addEventListener(ev, block, { capture: true, passive: true }); });
    this._block = block;
  };

  HotspotLayer.prototype.destroy = function () {
    cancelAnimationFrame(this._raf);
    this.viewer.renderLoop().removeEventListener('afterRender', this._draw);
    this.host.removeEventListener('pointerdown', this._onDown, true);
    window.removeEventListener('pointermove', this._onMove, true);
    window.removeEventListener('pointerup', this._onUp, true);
    this.host.removeEventListener('pointerleave', this._onLeave);
    var block = this._block, host = this.host;
    ['mousedown', 'touchstart'].forEach(function (ev) { host.removeEventListener(ev, block, { capture: true, passive: true }); });
    this.canvas.remove();
    if (this.gl) { var g = this.gl.g; g.deleteTexture(this.gl.tex); g.deleteBuffer(this.gl.buf); g.deleteProgram(this.gl.prog); this.gl = null; }
  };

  window.R360 = window.R360 || {};
  window.R360.HotspotLayer = HotspotLayer;
})();
