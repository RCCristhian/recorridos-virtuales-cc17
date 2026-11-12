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

  function onFloor(style) { return style === 'suelo' || style === 'anillo-suelo' || style === 'punto-suelo'; }
  function autoTilt(h) {
    if (!onFloor(h.style)) return 0;
    var below = Math.max(0, h.pitch * 180 / Math.PI);
    return Math.max(0, Math.min(85, 90 - below));
  }
  function isFlat(h) { return (h.type === 'link' && onFloor(h.style)) || !!h.flat; }

  // Devuelve una función local(x, y) → punto de pantalla {x, y} (o null si queda detrás).
  // Coordenadas locales en px, y hacia abajo, centro del punto en (0,0); igual que la
  // transformación CSS rotateX(inclinación) rotateY(giro) rotateZ(rotación) de Marzipano.
  function projector(view, h, k) {
    var c = view.coordinatesToScreen({ yaw: h.yaw, pitch: h.pitch });
    if (!c) return null;
    if (!isFlat(h)) {
      var aa = window.R360.hasArrowAngle(h) ? (h.arrowAngle || 0) * DEG : h.type === 'variant' ? (h.rotate || 0) * DEG : 0, ca = Math.cos(aa), sa = Math.sin(aa);
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
  // Puertas corredizas (punto de variación): marco y dos hojas que se abren, una a cada lado.
  function slideOpen(now) {                       // 3 s: se abren, se quedan y se cierran
    var p = (now / 3000) % 1;
    if (p < 0.15) return 0;
    if (p < 0.45) return ease((p - 0.15) / 0.3);
    if (p < 0.7) return 1;
    return 1 - ease((p - 0.7) / 0.3);
  }
  function drawSliding(ctx, pr, HS, k, anim, now, color) {
    var w = 0.5 * HS, h = 0.42 * HS, x0 = -w / 2, y0 = -h / 2, b = 1.8;
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    // marco
    var frame = [[x0, y0], [-x0, y0], [-x0, -y0], [x0, -y0]];
    polyline(ctx, pr, frame, true); ctx.lineWidth = lw(pr, b + 1.5, k); ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.stroke();
    polyline(ctx, pr, frame, true); ctx.lineWidth = lw(pr, b, k); ctx.strokeStyle = color; ctx.stroke();
    // hojas: cada una se corre hacia su lado (cerradas se tocan en el centro)
    var open = anim ? slideOpen(now) : 0.5, gap = 0.6;     // abiertas dejan libre el 60 % del centro
    var ix = x0 + b + 0.8, iy = y0 + b + 0.8, ih = h - 2 * (b + 0.8), half = (w - 2 * (b + 0.8)) / 2;
    var pw = half * (1 - gap * open) - 0.7;            // queda una rendija en el centro: se ven dos hojas
    var left = [[ix, iy], [ix + pw, iy], [ix + pw, iy + ih], [ix, iy + ih]];
    var right = [[-ix - pw, iy], [-ix, iy], [-ix, iy + ih], [-ix - pw, iy + ih]];
    ctx.globalAlpha = 0.92;
    polyline(ctx, pr, left, true); ctx.fillStyle = color; ctx.fill();
    polyline(ctx, pr, right, true); ctx.fill();
    ctx.globalAlpha = 1;
    // tiradores junto al borde que se abre
    var hy0 = iy + ih * 0.38, hy1 = iy + ih * 0.62, hx = Math.min(pw * 0.25, 1.6);
    polyline(ctx, pr, [[ix + pw - hx - 0.8, hy0], [ix + pw - hx - 0.8, hy1]]);
    ctx.lineWidth = lw(pr, 1.4, k); ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.stroke();
    polyline(ctx, pr, [[-ix - pw + hx + 0.8, hy0], [-ix - pw + hx + 0.8, hy1]]); ctx.stroke();
  }
  // Punto relleno en el centro (estilo «Círculo con punto»); sigue la perspectiva del punto.
  function drawDot(ctx, pr, rad, k, color) {
    var pts = [];
    for (var i = 0; i < 28; i++) { var a = i / 28 * Math.PI * 2; pts.push([Math.cos(a) * rad, Math.sin(a) * rad]); }
    polyline(ctx, pr, pts, true);
    ctx.lineWidth = lw(pr, 1.5, k); ctx.strokeStyle = 'rgba(0,0,0,0.2)'; ctx.stroke();
    ctx.fillStyle = color; ctx.fill();
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
  // Paleta de pintor (punto de variación). De frente a la pantalla, salvo que se gire o se ajuste su perspectiva.
  var PALETTE = typeof Path2D !== 'undefined' ? new Path2D('M12 3.5c-4.9 0-8.6 3.6-8.6 8.2 0 4.7 3.9 8.3 8.6 8.3 1 0 1.6-.6 1.6-1.4 0-.5-.2-.8-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.7-1.5 1.6-1.5h2c2.6 0 4.5-1.9 4.5-4.4 0-3.9-3.9-6.8-8.7-6.8z') : null;
  // Sigue el giro y la perspectiva del punto: se aproxima con la transformación local en su centro.
  function drawPalette(ctx, pr, HS) {
    if (!PALETTE) return;
    var u = 0.3 * HS, o = pr.map(0, 0), ax = pr.map(u, 0), ay = pr.map(0, u);
    if (!o || !ax || !ay) return;
    var s = 0.56 * HS / 24;
    ctx.save();
    ctx.transform((ax.x - o.x) / u, (ax.y - o.y) / u, (ay.x - o.x) / u, (ay.y - o.y) / u, o.x, o.y);
    ctx.scale(s, s); ctx.translate(-12, -12);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.6; ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.stroke(PALETTE);
    ctx.lineWidth = 1.9; ctx.strokeStyle = '#fff'; ctx.stroke(PALETTE);
    [[7.6, 11.3], [9.6, 7.6], [14, 7.1]].forEach(function (d) {
      ctx.beginPath(); ctx.arc(d[0], d[1], 1.35, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    });
    ctx.restore();
  }
  // Zona de una variación (editor): contorno y esquinas que se pueden arrastrar.
  function drawZone(ctx, pts, closed, color) {
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    pts.forEach(function (p, i) { if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    if (closed) { ctx.closePath(); ctx.fillStyle = 'rgba(200,32,58,0.10)'; ctx.fill(); }
    ctx.setLineDash([7, 5]); ctx.lineWidth = 2; ctx.strokeStyle = color; ctx.stroke(); ctx.setLineDash([]);
  }
  // Pantalla táctil (celular o tableta): sin mouse no hay «pasar por encima», así que el punto de
  // variación se ve siempre. Se detecta de varias formas, porque algunos teléfonos no avisan igual.
  function mq(q) { return !!(window.matchMedia && window.matchMedia(q).matches); }
  var PHONE = mq('(pointer: coarse)') || mq('(hover: none)') || mq('(any-pointer: coarse)') && !mq('(any-hover: hover)');
  // Si se toca la pantalla, se pasa a modo táctil aunque no se haya detectado antes.
  window.addEventListener('touchstart', function () { PHONE = true; }, { passive: true, capture: true });
  var FADE_MS = 220, TAP_MS = 5000;

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
    if (onFloor(h.style)) return { HS: 120, stroke: 6 };
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
    this.fade = {};           // punto de variación: { id: { a: opacidad, t: hora } }
    this.ptr = null;          // posición del mouse (para la zona de la variación)
    this.tap = null;          // último toque en el celular fuera de un punto
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
    if (scene !== this.scene) { this.fade = {}; this.tap = null; }
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

  // ¿Se ve el punto de variación? Siempre, o solo con el mouse en su zona (o tras tocarla en celular).
  HotspotLayer.prototype._variantWanted = function (hs, view, now) {
    var R = window.R360;
    if (this.opts.showAll) return true;
    if (hs.show === 'never') return false;   // solo ligada: cambia con las otras vistas, sin ícono
    var zones = R.zonesOf(hs);
    // ¿El punto (x, y) de la pantalla cae en alguna de las zonas?
    function inAny(x, y) {
      for (var i = 0; i < zones.length; i++) { var p = R.zoneScreen(view, zones[i]); if (p && R.inPoly(p, x, y)) return true; }
      return false;
    }
    if (PHONE) {
      if (hs.phone !== 'tap' || !zones.length) return true;
      if (!this.tap || now - this.tap.t > TAP_MS) return false;
      this._needsAnim = true;             // para que se apague solo pasado el tiempo
      var b0 = this.host.getBoundingClientRect();
      return inAny(this.tap.x - b0.left, this.tap.y - b0.top);
    }
    if (hs.show !== 'zone' || !zones.length) return true;
    this._hasZone = true;
    if (this.hover === hs.id) return true;
    if (!this.ptr) return false;
    var b = this.host.getBoundingClientRect();
    return inAny(this.ptr.x - b.left, this.ptr.y - b.top);
  };
  // Opacidad del punto: sube y baja en FADE_MS hacia lo que se quiere.
  HotspotLayer.prototype._alpha = function (id, want, now) {
    var f = this.fade[id];
    if (!f) f = this.fade[id] = { a: want ? 1 : 0, t: now };
    var step = Math.max(0, now - f.t) / FADE_MS; f.t = now;
    f.a = want ? Math.min(1, f.a + step) : Math.max(0, f.a - step);
    if (f.a > 0 && f.a < 1) this._needsAnim = true;
    return f.a;
  };

  HotspotLayer.prototype.paint = function () {
    var cv = this.canvas, ctx = this.ctx, host = this.host;
    var w = host.clientWidth, h = host.clientHeight, dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.hits = [];
    this._needsAnim = false;
    this._hasZone = false;
    this._drawn = false;
    var scene = this.scene;
    if (!scene || this.viewer.scene() !== scene) return;
    var view = scene.view(), now = performance.now();
    var cs = getComputedStyle(document.documentElement);
    var oa = typeof this.opts.accent === 'function' ? this.opts.accent() : this.opts.accent;
    var accent = oa || cs.getPropertyValue('--hs-accent').trim() || cs.getPropertyValue('--accent').trim() || '#b5122c';
    // Color base de los puntos (pestaña Diseño); un salto con color propio lo conserva.
    var ob = typeof this.opts.baseColor === 'function' ? this.opts.baseColor() : this.opts.baseColor;
    var baseColor = ob || cs.getPropertyValue('--hs-color').trim() || '#fff';
    var labels = [], R = window.R360, target = ctx;
    var draft = this.opts.zoneDraft ? this.opts.zoneDraft() : null;
    if (draft && draft.length) {
      var dp = draft.map(function (q) { return view.coordinatesToScreen(q); }).filter(Boolean);
      drawZone(ctx, dp, false, '#c8203a');
      dp.forEach(function (q, n) { ctx.beginPath(); ctx.arc(q.x, q.y, n ? 5 : 7, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#c8203a'; ctx.stroke(); });
      this._drawn = true;
    }
    // Vista previa del punto que se va a colocar (sigue al mouse, semitransparente; no se puede pulsar).
    var ghost = this.opts.ghost ? this.opts.ghost() : null, items = ghost ? this.list.concat([ghost]) : this.list;
    for (var i = 0; i < items.length; i++) {
      var hs = items[i], isGhost = hs === ghost;
      if (!isGhost && this.opts.filter && !this.opts.filter(hs)) continue;
      var alpha = 1;
      if (isGhost) {
        alpha = 0.55;
        if (!this.scratch) { this.scratch = document.createElement('canvas'); this.sctx = this.scratch.getContext('2d'); }
        if (this.scratch.width !== cv.width || this.scratch.height !== cv.height) { this.scratch.width = cv.width; this.scratch.height = cv.height; }
        ctx = this.sctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      }
      if (hs.type === 'variant') {
        if (this.opts.zoneEdit && this.opts.zoneEdit(hs)) {
          // Mientras se dibuja otra zona, las esquinas no se pueden arrastrar (para no estorbar los clics).
          var drawing = this.opts.drawing && this.opts.drawing(), zl = R.zonesOf(hs);
          for (var zn = 0; zn < zl.length; zn++) {
            var zone = zl[zn], zp = R.zoneScreen(view, zone);
            if (zp) { drawZone(ctx, zp, true, '#c8203a'); this._drawn = true; }
            for (var zi = 0; zi < zone.length; zi++) {
              var zc = view.coordinatesToScreen(zone[zi]);
              if (!zc) continue;
              ctx.beginPath(); ctx.arc(zc.x, zc.y, 6, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#c8203a'; ctx.stroke();
              if (!drawing) this.hits.push({ h: { id: 'z:' + hs.id + ':' + zn + ':' + zi, zoneOf: hs, zone: zone, idx: zi }, x: zc.x, y: zc.y, r: 11, top: zc.y });
            }
          }
        }
        alpha = this._alpha(hs.id, this._variantWanted(hs, view, now), now);
        if (alpha <= 0) continue;
        if (alpha < 1) {
          if (!this.scratch) { this.scratch = document.createElement('canvas'); this.sctx = this.scratch.getContext('2d'); }
          if (this.scratch.width !== cv.width || this.scratch.height !== cv.height) { this.scratch.width = cv.width; this.scratch.height = cv.height; }
          ctx = this.sctx; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
        }
      }
      var k = hs.size || 1;
      var pr = projector(view, hs, k);
      if (!pr) continue;
      var c = pr.center;
      if (c.x < -200 || c.y < -200 || c.x > w + 200 || c.y > h + 200) continue;
      var bs = baseSize(hs), HS = bs.HS, r = HS / 2 - bs.stroke / 2;
      var anim = hs.animate !== false, style = hs.type === 'link' ? (hs.style || 'circulo') : hs.type === 'variant' ? 'variant' : 'info';
      var isHover = this.hover === hs.id, isSel = Array.isArray(this.selected) ? this.selected.indexOf(hs.id) >= 0 : this.selected === hs.id;
      var color = (hs.type === 'link' && hs.color) || baseColor;
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
      else if (style === 'punto' || style === 'punto-suelo') drawDot(ctx, pr, 0.15 * HS, k, color);
      else if (style === 'anillo' || style === 'anillo-suelo') { /* solo el círculo: no lleva nada dentro */ }
      else if (style === 'variant') { if (hs.icon === 'corrediza') drawSliding(ctx, pr, HS, k, anim, now, '#fff'); else drawPalette(ctx, pr, HS); }
      else drawInfo(ctx, pr, HS, k);

      // Radio de clic en pantalla
      var rim = pr.flat ? [pr.map(r, 0), pr.map(-r, 0), pr.map(0, r), pr.map(0, -r)].filter(Boolean) : [];
      var rad = rim.length ? Math.max.apply(null, rim.map(function (q) { return Math.hypot(q.x - c.x, q.y - c.y); })) : r * k;
      rad = Math.max(rad, 18);
      var top = rim.length ? Math.min.apply(null, rim.map(function (q) { return q.y; })) : c.y - rad;
      if (!isGhost) this.hits.push({ h: hs, x: c.x, y: c.y, r: rad, top: top });

      if (isSel) {
        ctx.setLineDash([5, 4]); ctx.lineWidth = 2; ctx.strokeStyle = '#fff';
        ctx.beginPath(); ctx.arc(c.x, c.y, rad + 7, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
      var text = this.opts.labelFor ? this.opts.labelFor(hs) : '';
      if (text && !isGhost && (this.opts.labels === 'always' || isHover)) labels.push([c.x, top - 8, text]);
      if (ctx !== target) {           // punto a medio aparecer: se pinta aparte y se pega con su opacidad
        target.save(); target.setTransform(1, 0, 0, 1, 0, 0); target.globalAlpha = alpha;
        target.drawImage(this.scratch, 0, 0); target.restore();
        ctx = target;
      }
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
      if (!h) { down = null; self._tdown = e.pointerType === 'touch' ? { x: e.clientX, y: e.clientY } : null; return; }
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
      if (e.pointerType !== 'touch') {
        var inHost = e.target === host || host.contains(e.target);
        self.ptr = inHost ? { x: e.clientX, y: e.clientY } : null;
        if (self._hasZone) self.draw();
      }
      if (e.pointerType === 'touch' || e.buttons) return;
      var h = self.hit(e.clientX, e.clientY), id = h ? h.id : null;
      if (id !== self.hover) { self.hover = id; host.style.cursor = h ? 'pointer' : ''; self.draw(); }
    };
    this._onUp = function (e) {
      var td = self._tdown; self._tdown = null;
      if (td && e.pointerType === 'touch' && Math.abs(e.clientX - td.x) + Math.abs(e.clientY - td.y) < 12) { self.tap = { x: e.clientX, y: e.clientY, t: performance.now() }; self.draw(); }
      if (!down || e.pointerId !== down.id) return;
      var d = down; down = null;
      e.stopPropagation();
      if (d.moved) { if (self.opts.onDragEnd) self.opts.onDragEnd(d.h, e); }
      else if (self.opts.onClick) self.opts.onClick(d.h, e);
    };
    this._onLeave = function () { self.ptr = null; if (self.hover) { self.hover = null; host.style.cursor = ''; } self.draw(); };
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
