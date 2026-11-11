/* CL-WIND - zoom3d.js
 * Vue 3D du zoom sur un pan de mur : briques et lames de la boîte, lignes de courant tracées dans le champ moyen
 * relu à pleine résolution (environ 1 cm), couleur selon la vitesse (même échelle que le plan), et tirets qui
 * avancent le long des lignes au ralenti (vitesse proportionnelle à celle de l'air).
 * Départs : nappe à la hauteur de coupe, ou grille dans un plan face au vent, en amont du mur.
 * Souris : glisser = tourner, clic droit = déplacer, molette = zoom.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var Z3 = CLW.Zoom3D = {};
  function $(id) { return document.getElementById(id); }
  function fmt(v, d) { return CLW.fmt ? CLW.fmt(v, d) : (+v).toFixed(d); }
  var SLOW = 20;          // ralenti de l'animation
  var PERIOD = 0.02;      // écart entre deux tirets, en secondes de trajet réel
  var opt = Z3.opt = { seed: 'grille', step: 0.05, band: 0.5, anim: true };
  var cv = null, gl = null, P = {}, cam = { yaw: 0, pitch: 0.35, dist: 3, tx: 0, ty: 0, tz: 1.5 };
  var model = null, lines = null, modelGen = -1, needs = true, t0 = performance.now(), info = '';
  var busy = false, lastRead = 0, lastTrav = -1, lastKey = '';

  // ---------------------------------------------------------------- outils WebGL
  function persp(fovy, asp, n, f) { var t = 1 / Math.tan(fovy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function lookAt(e, c, u) {
    var z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(u, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  }
  function mul(a, b) { var o = new Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
  function prog(vs, fs) {
    function sh(t, src) { var s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  function buf(data) { var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; }
  function clearAttrs() { for (var i = 0; i < 8; i++) gl.disableVertexAttribArray(i); }
  function attr(p, name, b, size) { var l = gl.getAttribLocation(p, name); if (l < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0); }

  function init() {
    cv = $('zoom-3d'); if (!cv) return false;
    gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) return false;
    P.mesh = prog(
      'attribute vec3 p; attribute vec3 n; attribute vec4 c; uniform mat4 M; varying vec4 vc; varying float l;' +
      'void main(){ gl_Position = M * vec4(p,1.0); vc = c; l = 0.5 + 0.5 * abs(dot(normalize(n), normalize(vec3(0.4,-0.5,0.8)))) + 0.1 * abs(n.z); }',
      'precision mediump float; varying vec4 vc; varying float l; void main(){ gl_FragColor = vec4(vc.rgb * min(l,1.1), vc.a); }');
    // lignes : couleur de la vitesse ; tirets qui avancent (temps de trajet t, temps d'animation T)
    P.line = prog(
      'attribute vec3 p; attribute vec4 c; attribute float t; uniform mat4 M; varying vec4 vc; varying float vt; void main(){ gl_Position = M * vec4(p,1.0); vc = c; vt = t; }',
      'precision mediump float; varying vec4 vc; varying float vt; uniform float T; uniform float PER; uniform float A;' +
      'void main(){ float ph = fract((T - vt) / PER); float b = 1.0 - smoothstep(0.0, 0.32, ph);' +
      ' vec3 col = mix(vc.rgb, mix(vc.rgb * 0.35, min(vc.rgb * 1.25 + 0.35, vec3(1.0)), b), A);' +
      ' gl_FragColor = vec4(col, mix(vc.a, 0.5 + 0.5 * b, A)); }');
    var drag = null;
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('mousedown', function (e) { drag = { x: e.clientX, y: e.clientY, b: e.button, cam: Object.assign({}, cam) }; e.preventDefault(); });
    window.addEventListener('mousemove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.b === 0) { cam.yaw = drag.cam.yaw - dx * 0.006; cam.pitch = Math.max(-0.2, Math.min(1.5, drag.cam.pitch + dy * 0.005)); }
      else {
        var s = cam.dist * 0.0015, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
        cam.tx = drag.cam.tx - (dx * cy + dy * sy) * s; cam.ty = drag.cam.ty - (dx * sy - dy * cy) * s;
      }
      needs = true;
    });
    window.addEventListener('mouseup', function () { drag = null; });
    cv.addEventListener('wheel', function (e) { e.preventDefault(); cam.dist = Math.max(0.2, Math.min(20, cam.dist * Math.exp(e.deltaY * 0.0012))); needs = true; }, { passive: false });
    return true;
  }

  // ---------------------------------------------------------------- briques et volumes de la boîte
  function buildModel(G) {
    var M = G.wall.M, p = [], n = [], c = [], X = G.cx, Y = G.cy;
    function add(m, col) {
      var v = m.v, f = m.f;
      for (var t = 0; t < f.length; t += 3) {
        var a = 3 * f[t], b = 3 * f[t + 1], d = 3 * f[t + 2];
        var mx = (v[a] + v[b] + v[d]) / 3, my = (v[a + 1] + v[b + 1] + v[d + 1]) / 3;
        if (mx < G.x0 || mx > G.x0 + G.W || my < G.ys || my > G.ys + G.H) continue;
        var A = [v[a] - X, v[a + 1] - Y, v[a + 2]], B = [v[b] - X, v[b + 1] - Y, v[b + 2]], C = [v[d] - X, v[d + 1] - Y, v[d + 2]];
        var nn = norm(cross([B[0] - A[0], B[1] - A[1], B[2] - A[2]], [C[0] - A[0], C[1] - A[1], C[2] - A[2]]));
        [A, B, C].forEach(function (q) { p.push(q[0], q[1], q[2]); n.push(nn[0], nn[1], nn[2]); c.push(col[0], col[1], col[2], col[3]); });
      }
    }
    M.scr.forEach(function (m) { add(m, [0.80, 0.47, 0.30, 1]); });
    var nOpaque = p.length / 3;
    M.vol.forEach(function (m) { add(m, [0.62, 0.64, 0.68, 0.35]); });
    // sol de la boîte
    var w = G.W / 2, h = G.H / 2, gc = [0.16, 0.18, 0.21, 1], gp = [[-w, -h, 0], [w, -h, 0], [w, h, 0], [-w, -h, 0], [w, h, 0], [-w, h, 0]];
    var pre = { p: [], n: [], c: [] };
    gp.forEach(function (q) { pre.p.push(q[0], q[1], -0.002); pre.n.push(0, 0, 1); pre.c.push(gc[0], gc[1], gc[2], gc[3]); });
    return { p: buf(new Float32Array(pre.p.concat(p))), n: buf(new Float32Array(pre.n.concat(n))), c: buf(new Float32Array(pre.c.concat(c))),
      nOpaque: 6 + nOpaque, count: 6 + p.length / 3 };
  }

  // ---------------------------------------------------------------- départs et tracé
  function seeds(G, w) {
    var Z = CLW.Zoom.state, th = G.dirL * Math.PI / 180, wx = -Math.sin(th), wy = -Math.cos(th), px = -wy, py = wx;
    var half = Math.max(0.05, (w.rOut - w.rIn) / 2), d0 = Math.min(0.38 * Math.min(G.W, G.H), half + 0.12);
    var sx = G.cx - wx * d0, sy = G.cy - wy * d0, span = 0.4 * Math.min(G.W, G.H), st = opt.step, out = [];
    var zs = [], zc = Z.zc, top = Math.min(G.Htop - 0.03, Math.max(G.hmax, 0.3));
    if (opt.seed === 'nappe') zs = [zc];
    else {
      var lo = opt.seed === 'grille-tout' ? 0.03 : Math.max(0.03, zc - opt.band), hi = opt.seed === 'grille-tout' ? top : Math.min(top, zc + opt.band);
      for (var z = lo; z <= hi + 1e-6; z += st) zs.push(z);
    }
    var ds = opt.seed === 'nappe' ? st / 2 : st;
    zs.forEach(function (z) { for (var t = -span; t <= span + 1e-6; t += ds) out.push([sx + px * t, sy + py * t, z]); });
    return out;
  }
  function trace(G, F, list) {
    var nx = G.nx, ny = G.ny, pl = nx * ny, d = G.dx, k0 = F.k0, nk = F.nk, D = F.data, U = CLW.Zoom.state.uref, sp0 = CLW.state.wind.speed;
    var fl = G.flags;
    function vel(x, y, z) {
      var fi = (x - G.x0) / d - 0.5, fj = (y - G.ys) / d - 0.5, fk = z / d + 0.5 - k0;
      var i = Math.floor(fi), j = Math.floor(fj), k = Math.floor(fk);
      if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= nk - 1) return null;
      var u = fi - i, v = fj - j, w = fk - k, o0 = 0, o1 = 0, o2 = 0, ws = 0;
      for (var c = 0; c < 8; c++) {
        var di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1, kk = k + dk + k0;
        if (kk < 1 || (fl[kk * pl + (j + dj) * nx + i + di] & 1)) continue; // cellules pleines : vitesse nulle
        var wt = (di ? u : 1 - u) * (dj ? v : 1 - v) * (dk ? w : 1 - w), id = 4 * ((i + di) + nx * ((j + dj) + ny * (k + dk)));
        o0 += wt * D[id]; o1 += wt * D[id + 1]; o2 += wt * D[id + 2]; ws += wt;
      }
      if (ws < 0.2) return [0, 0, 0];
      return [o0, o1, o2];
    }
    var pos = [], col = [], tim = [], nLines = 0, nJoint = 0, w = G.wall;
    list.forEach(function (s) {
      var x = s[0], y = s[1], z = s[2], t = 0, n = 0, len = 0, crossed = false, seg = [];
      var r0 = Math.hypot(x - w.cx, y - w.cy), side0 = r0 > w.rOut ? 1 : r0 < w.rIn ? -1 : 0;
      for (; n < 5000; n++) {
        var v = vel(x, y, z); if (!v) break;
        var sp = Math.hypot(v[0], v[1], v[2]); if (sp < 0.01 * U) break;
        var st = 0.35 * d / sp;
        var vm = vel(x + v[0] * st * 0.5, y + v[1] * st * 0.5, z + v[2] * st * 0.5) || v;
        var smid = Math.hypot(vm[0], vm[1], vm[2]); if (smid < 0.01 * U) break;
        var x2 = x + vm[0] * st, y2 = y + vm[1] * st, z2 = Math.max(0.005, z + vm[2] * st);
        var dl = Math.hypot(x2 - x, y2 - y, z2 - z), vphys = smid / U * sp0;
        var cc = CLW.ramp ? CLW.ramp(Math.max(0, Math.min(1, smid / U / 2))) : [200, 200, 255];
        seg.push(x - G.cx, y - G.cy, z, x2 - G.cx, y2 - G.cy, z2);
        tim.push(t); t += dl / Math.max(0.02, vphys); tim.push(t);
        for (var q = 0; q < 2; q++) col.push(cc[0] / 255, cc[1] / 255, cc[2] / 255, 0.95);
        x = x2; y = y2; z = z2; len += dl;
        var r = Math.hypot(x - w.cx, y - w.cy), side = r > w.rOut ? 1 : r < w.rIn ? -1 : 0;
        if (side0 && side && side !== side0) crossed = true;
        if (len > 4 * Math.max(G.W, G.H)) break;
      }
      if (seg.length) { nLines++; if (crossed) nJoint++; for (var a = 0; a < seg.length; a++) pos.push(seg[a]); }
    });
    return { pos: new Float32Array(pos), col: new Float32Array(col), tim: new Float32Array(tim), n: nLines, joint: nJoint };
  }
  function zRange(G) {
    var Z = CLW.Zoom.state, top = Math.min(G.Htop, Math.max(G.hmax, 0.3) + 0.1), lo, hi;
    if (opt.seed === 'grille-tout') { lo = 0; hi = top; }
    else { lo = Math.max(0, Z.zc - opt.band - 0.35); hi = Math.min(G.Htop, Z.zc + opt.band + 0.35); }
    var k0 = Math.max(0, Math.floor(lo / G.dx)), k1 = Math.min(G.nz - 1, Math.ceil(hi / G.dx) + 2);
    return [k0, k1 - k0 + 1];
  }
  function refresh(force) {
    var Z = CLW.Zoom.state, G = Z.G, s3 = Z.s3;
    if (busy || !G || !s3 || !s3.samples || !s3.readBox) return;
    var key = [Z.gen, opt.seed, opt.step, Z.zc.toFixed(2), CLW.state.wind.dir].join('|');
    var trav = Math.floor(s3.trav || 0), now = performance.now();
    if (!force && key === lastKey && (trav === lastTrav || now - lastRead < 4000) && (now - lastRead < 20000 || trav >= 6)) return;
    busy = true; lastRead = now; lastTrav = trav; lastKey = key;
    var r = zRange(G), gen = Z.gen;
    s3.readBox(r[0], r[1]).then(function (F) {
      busy = false;
      if (!F || gen !== Z.gen) return;
      var t1 = performance.now(), L = trace(G, F, seeds(G, G.wall));
      if (lines) { gl.deleteBuffer(lines.p); gl.deleteBuffer(lines.c); gl.deleteBuffer(lines.t); }
      lines = { p: buf(L.pos), c: buf(L.col), t: buf(L.tim), count: L.pos.length / 3 };
      info = L.n + ' lignes, dont ' + L.joint + ' traversent le mur · départs ' + (opt.seed === 'nappe' ? 'en nappe à ' + fmt(Z.zc, 2) + ' m' : 'en grille face au vent') +
        ', tous les ' + fmt(opt.step * 100 * (opt.seed === 'nappe' ? 0.5 : 1), 1) + ' cm · tracé ' + fmt((performance.now() - t1) / 1000, 1) + ' s' +
        (trav < 6 ? ' · moyenne en cours (' + fmt(s3.trav, 1) + ' / 6 traversées) : lignes provisoires' : '');
      Z3.info = info; Z3.lines = L.n; Z3.joint = L.joint;
      needs = true;
      if (CLW.Zoom.draw) CLW.Zoom.draw();
    }, function () { busy = false; });
  }

  // ---------------------------------------------------------------- API
  Z3.reset = function () { lastKey = ''; needs = true; };
  Z3.fit = function () {
    var Z = CLW.Zoom.state, G = Z.G; if (!G) return;
    var th = G.dirL * Math.PI / 180, wx = -Math.sin(th), wy = -Math.cos(th), a = 1.25;
    var ox = -(wx * Math.cos(a) - wy * Math.sin(a)), oy = -(wx * Math.sin(a) + wy * Math.cos(a)); // en amont, un peu de côté
    cam.yaw = Math.atan2(ox, -oy); cam.pitch = 0.28; cam.dist = Math.min(2.6 * Math.max(G.W, G.H), 1.1 * Math.max(G.W, G.H) + 1.6); cam.tx = 0; cam.ty = 0; cam.tz = Z.zc;
    needs = true;
  };
  Z3.frame = function () {
    if (!cv && !init()) return;
    if (!gl || cv.hidden) return;
    var Z = CLW.Zoom.state, G = Z.G;
    if (!G) return;
    if (modelGen !== Z.gen) { model = buildModel(G); modelGen = Z.gen; if (lines) { gl.deleteBuffer(lines.p); gl.deleteBuffer(lines.c); gl.deleteBuffer(lines.t); } lines = null; Z3.fit(); lastKey = ''; }
    refresh(false);
    var r = cv.getBoundingClientRect(), dd = window.devicePixelRatio || 1, W = Math.max(1, Math.round(r.width * dd)), H = Math.max(1, Math.round(r.height * dd));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; needs = true; }
    if (!needs && !(opt.anim && lines)) return;
    needs = false;
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0.043, 0.051, 0.067, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    var eye = [cam.tx + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw), cam.ty - cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw), cam.tz + cam.dist * Math.sin(cam.pitch)];
    var M = mul(persp(0.8, cv.width / cv.height, 0.01, 100), lookAt(eye, [cam.tx, cam.ty, cam.tz], [0, 0, 1]));
    gl.useProgram(P.mesh); clearAttrs();
    attr(P.mesh, 'p', model.p, 3); attr(P.mesh, 'n', model.n, 3); attr(P.mesh, 'c', model.c, 4);
    gl.uniformMatrix4fv(gl.getUniformLocation(P.mesh, 'M'), false, M);
    gl.drawArrays(gl.TRIANGLES, 0, model.nOpaque);
    if (lines && lines.count) {
      gl.useProgram(P.line); clearAttrs();
      attr(P.line, 'p', lines.p, 3); attr(P.line, 'c', lines.c, 4); attr(P.line, 't', lines.t, 1);
      gl.uniformMatrix4fv(gl.getUniformLocation(P.line, 'M'), false, M);
      gl.uniform1f(gl.getUniformLocation(P.line, 'T'), (performance.now() - t0) / 1000 / SLOW);
      gl.uniform1f(gl.getUniformLocation(P.line, 'PER'), PERIOD);
      gl.uniform1f(gl.getUniformLocation(P.line, 'A'), opt.anim ? 1 : 0);
      gl.drawArrays(gl.LINES, 0, lines.count);
    }
    // volumes (toit, réservoir) en transparence, par-dessus
    if (model.count > model.nOpaque) {
      gl.useProgram(P.mesh); clearAttrs();
      attr(P.mesh, 'p', model.p, 3); attr(P.mesh, 'n', model.n, 3); attr(P.mesh, 'c', model.c, 4);
      gl.uniformMatrix4fv(gl.getUniformLocation(P.mesh, 'M'), false, M);
      gl.depthMask(false); gl.drawArrays(gl.TRIANGLES, model.nOpaque, model.count - model.nOpaque); gl.depthMask(true);
    }
  };
  Z3.canvas = function () { return cv; };
  Z3.init = function () {
    var sd = $('zoom-seed'), stp = $('zoom-step'), an = $('zoom-anim');
    if (sd) sd.addEventListener('change', function () { opt.seed = sd.value; refresh(true); });
    if (stp) stp.addEventListener('change', function () { opt.step = (parseFloat(stp.value) || 5) / 100; refresh(true); });
    if (an) an.onclick = function () { opt.anim = !opt.anim; an.textContent = opt.anim ? 'Arrêter les tirets' : 'Animer les tirets'; needs = true; };
    var fit = $('zoom-fit'); if (fit) fit.onclick = function () { Z3.fit(); };
  };
  Z3.refresh = function () { refresh(true); };
})(window);
