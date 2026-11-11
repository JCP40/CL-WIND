/* CL-WIND - view3d.js
 * Vue 3D en orbite (WebGL, sans bibliothèque) du calcul 3D :
 * - modèle : maillages Grasshopper (volumes gris, briques et lames terre cuite) ou, à défaut, faces des
 *   cubes pleins du découpage ;
 * - coupe horizontale (texture du plan) à la hauteur affichée et coupe verticale le long du trait ;
 * - lignes de courant du champ moyen (relu allégé sur la carte), couleur selon la vitesse.
 * Souris : glisser = tourner, clic droit ou molette appuyée = déplacer, molette = zoom.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var V = CLW.View3D = {};
  var cv, gl, P = {}, needs = true, cam = { yaw: -0.6, pitch: 0.55, dist: 40, tx: 0, ty: 0, tz: 1.5 }, scene = null, G = null;
  var lines = null, coarseT = 0, coarseBusy = false, texH = null, texV = null, hintEl = null;

  // ---------------------------------------------------------------- matrices (colonnes, comme WebGL)
  function persp(fovy, asp, n, f) { var t = 1 / Math.tan(fovy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; }
  function lookAt(e, c, u) {
    var z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(u, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  }
  function mul(a, b) { var o = new Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

  // ---------------------------------------------------------------- programmes
  function prog(vs, fs) {
    function sh(t, src) { var s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  function init() {
    cv = document.getElementById('view3d');
    gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) return false;
    P.mesh = prog(
      'attribute vec3 p; attribute vec3 n; attribute vec4 c; uniform mat4 M; varying vec4 vc; varying float l; varying vec3 wp;' +
      'void main(){ gl_Position = M * vec4(p,1.0); wp = p; vc = c; l = 0.45 + 0.55 * max(dot(normalize(n), normalize(vec3(0.4,-0.5,0.8))), 0.0) + 0.15 * abs(n.z); }',
      // CL = (nx, ny, d, actif) : plan de coupe, on retire le côté où n·p > d ; FC = (cx, cy, R²) : seulement dans la zone d'étude
      '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
      'varying vec4 vc; varying float l; varying vec3 wp; uniform float AL; uniform vec4 CL; uniform vec3 FC;' +
      'void main(){ if (CL.w > 0.5) { vec2 q = wp.xy - FC.xy; if (dot(q, q) < FC.z && dot(wp.xy, CL.xy) - CL.z > 0.0) discard; } gl_FragColor = vec4(vc.rgb * min(l,1.1), vc.a * AL); }');
    P.tex = prog(
      'attribute vec3 p; attribute vec2 t; uniform mat4 M; varying vec2 vt; void main(){ gl_Position = M * vec4(p,1.0); vt = t; }',
      'precision mediump float; varying vec2 vt; uniform sampler2D S; uniform float A; void main(){ vec4 c = texture2D(S, vt); gl_FragColor = vec4(c.rgb, A * c.a); }');
    P.line = prog(
      'attribute vec3 p; attribute vec4 c; uniform mat4 M; varying vec4 vc; void main(){ gl_Position = M * vec4(p,1.0); vc = c; }',
      'precision mediump float; varying vec4 vc; void main(){ gl_FragColor = vc; }');
    // souris
    var drag = null;
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('mousedown', function (e) { drag = { x: e.clientX, y: e.clientY, b: e.button, cam: Object.assign({}, cam) }; e.preventDefault(); });
    window.addEventListener('mousemove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.b === 0) { cam.yaw = drag.cam.yaw - dx * 0.006; cam.pitch = Math.max(0.05, Math.min(1.5, drag.cam.pitch + dy * 0.005)); }
      else {
        var s = cam.dist * 0.0015, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
        cam.tx = drag.cam.tx - (dx * cy + dy * sy) * s; cam.ty = drag.cam.ty - (dx * sy - dy * cy) * s;
      }
      needs = true;
    });
    window.addEventListener('mouseup', function () { drag = null; });
    cv.addEventListener('wheel', function (e) { e.preventDefault(); cam.dist = Math.max(2, Math.min(3000, cam.dist * Math.exp(e.deltaY * 0.0012))); needs = true; }, { passive: false });
    return true;
  }
  function buf(data) { var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; }
  // désactive les attributs du programme précédent : un tableau resté actif sur un tampon trop court fait échouer le dessin
  function clearAttrs() { for (var i = 0; i < 8; i++) gl.disableVertexAttribArray(i); }
  function attr(p, name, b, size) { var l = gl.getAttribLocation(p, name); if (l < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0); }

  // ---------------------------------------------------------------- géométrie du modèle
  function addTri(out, a, b, c, col) {
    var n = norm(cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]));
    [a, b, c].forEach(function (v) { out.p.push(v[0], v[1], v[2]); out.n.push(n[0], n[1], n[2]); out.c.push(col[0], col[1], col[2], col[3]); });
  }
  function buildModel() {
    var out = { p: [], n: [], c: [] }, live = CLW.Live && CLW.Live.active ? CLW.Live : null, m3 = live && live.last && live.last.mesh3d;
    var org = live && live.origin ? live.origin : [0, 0];
    if (m3) {
      [[m3.volumes, [0.62, 0.64, 0.68, 1]], [m3.ecrans, [0.80, 0.47, 0.30, 1]]].forEach(function (grp) {
        (grp[0] || []).forEach(function (m) {
          var v = m[0], f = m[1];
          for (var t = 0; t < f.length; t += 3) {
            var a = 3 * f[t], b = 3 * f[t + 1], c = 3 * f[t + 2];
            addTri(out, [v[a] - org[0], v[a + 1] - org[1], v[a + 2]], [v[b] - org[0], v[b + 1] - org[1], v[b + 2]], [v[c] - org[0], v[c + 1] - org[1], v[c + 2]], grp[1]);
          }
        });
      });
    } else if (G) {
      // faces visibles des cubes pleins (au-dessus du sol)
      var nx = G.nx, ny = G.ny, nz = G.nz, pl = nx * ny, d = G.dx, col = [0.62, 0.64, 0.68, 1];
      function solid(i, j, k) { return i >= 0 && j >= 0 && i < nx && j < ny && k >= 1 && k < nz && (G.flags[k * pl + j * nx + i] & 1); }
      for (var k = 1; k < nz; k++) for (var j = 0; j < ny; j++) for (var i = 0; i < nx; i++) {
        if (!solid(i, j, k)) continue;
        var x0 = G.x0 + i * d, y0 = G.ys + j * d, z0 = (k - 1) * d, x1 = x0 + d, y1 = y0 + d, z1 = z0 + d;
        if (!solid(i, j, k + 1)) { addTri(out, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], col); addTri(out, [x0, y0, z1], [x1, y1, z1], [x0, y1, z1], col); }
        if (!solid(i - 1, j, k)) { addTri(out, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], col); addTri(out, [x0, y0, z0], [x0, y1, z1], [x0, y1, z0], col); }
        if (!solid(i + 1, j, k)) { addTri(out, [x1, y0, z0], [x1, y1, z1], [x1, y0, z1], col); addTri(out, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], col); }
        if (!solid(i, j - 1, k)) { addTri(out, [x0, y0, z0], [x1, y0, z1], [x0, y0, z1], col); addTri(out, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], col); }
        if (!solid(i, j + 1, k)) { addTri(out, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], col); addTri(out, [x0, y1, z0], [x1, y1, z1], [x1, y1, z0], col); }
      }
    }
    // sol du domaine
    var W = (G ? G.W : 100) / 2, H = (G ? G.H : 100) / 2, gc = [0.16, 0.18, 0.21, 1];
    addTri(out, [-W, -H, -0.01], [W, -H, -0.01], [W, H, -0.01], gc); addTri(out, [-W, -H, -0.01], [W, H, -0.01], [-W, H, -0.01], gc);
    return { p: buf(new Float32Array(out.p)), n: buf(new Float32Array(out.n)), c: buf(new Float32Array(out.c)), count: out.p.length / 3 };
  }

  // ---------------------------------------------------------------- lignes de courant (champ moyen allégé)
  function streamlines(cf) {
    var E = CLW.engine, S = CLW.state; if (!G || !cf) return null;
    var s = cf.s, dxc = s * G.dx, sc = S.wind.speed / E.uref3;
    function vel(x, y, z) { // interpolation trilinéaire, vitesse réseau
      var fi = (x - G.x0) / G.dx - 0.5, fj = (y - G.ys) / G.dx - 0.5, fk = z / G.dx + 0.5;
      fi /= s; fj /= s; fk /= s;
      var i = Math.floor(fi), j = Math.floor(fj), k = Math.floor(fk);
      if (i < 0 || j < 0 || k < 0 || i >= cf.cx - 1 || j >= cf.cy - 1 || k >= cf.cz - 1) return null;
      var u = fi - i, v = fj - j, w = fk - k, o = [0, 0, 0];
      for (var c = 0; c < 8; c++) {
        var di = c & 1, dj = (c >> 1) & 1, dk = (c >> 2) & 1, wt = (di ? u : 1 - u) * (dj ? v : 1 - v) * (dk ? w : 1 - w);
        var id = 4 * ((i + di) + cf.cx * ((j + dj) + cf.cy * (k + dk)));
        o[0] += wt * cf.data[id]; o[1] += wt * cf.data[id + 1]; o[2] += wt * cf.data[id + 2];
      }
      return o;
    }
    // emprise des obstacles et écrans
    var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity, pl = G.nx * G.ny;
    for (var k = 1; k < G.nz; k++) for (var j = 0; j < G.ny; j += 2) for (var i = 0; i < G.nx; i += 2) {
      var id2 = k * pl + j * G.nx + i;
      if ((G.flags[id2] & 1) || G.drag[id2] > 0) { var x = G.x0 + (i + 0.5) * G.dx, y = G.ys + (j + 0.5) * G.dx; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
    }
    if (!isFinite(bx0)) { bx0 = -G.W / 6; bx1 = G.W / 6; by0 = -G.H / 6; by1 = G.H / 6; }
    var th = S.wind.dir * Math.PI / 180, wx = -Math.sin(th), wy = -Math.cos(th), px = -wy, py = wx;
    var cx = (bx0 + bx1) / 2, cy = (by0 + by1) / 2, rad = Math.max(bx1 - bx0, by1 - by0) / 2 + 1;
    var up = Math.min(rad * 2.5, 0.42 * Math.min(G.W, G.H)), hmax = Math.max(1, G.hmax);
    var heights = [0.3, 0.8, 1.5, 2.2, hmax * 0.8, hmax * 1.3].filter(function (h) { return h < G.Htop * 0.8; });
    var P2 = [], C = [];
    heights.forEach(function (h) {
      for (var t = -1; t <= 1.0001; t += 0.125) {
        var x = cx - wx * up + px * t * rad * 1.3, y = cy - wy * up + py * t * rad * 1.3, z = h, prev = null;
        for (var n = 0; n < 1500; n++) {
          var v = vel(x, y, z); if (!v) break;
          var sp = Math.hypot(v[0], v[1], v[2]); if (sp < 1e-5) break;
          var st = 0.5 * dxc / sp;
          var vm = vel(x + v[0] * st * 0.5, y + v[1] * st * 0.5, z + v[2] * st * 0.5) || v; // RK2
          var nx2 = x + vm[0] * st, ny2 = y + vm[1] * st, nz2 = Math.max(0.05, z + vm[2] * st);
          var r = CLW.ramp(Math.min(1, sp * sc / S.wind.speed / 2));
          P2.push(x, y, z, nx2, ny2, nz2);
          for (var q = 0; q < 2; q++) C.push(r[0] / 255, r[1] / 255, r[2] / 255, 0.95);
          x = nx2; y = ny2; z = nz2; prev = v;
          if (Math.abs(x) > G.W / 2 || Math.abs(y) > G.H / 2 || z > G.Htop) break;
          if (focus && n > 4 && (Math.hypot(x - focus.cx, y - focus.cy) > 1.4 * focus.R || z > 1.2 * focus.zTop)) break; // hors de la zone d'étude
        }
        void prev;
      }
    });
    return { p: buf(new Float32Array(P2)), c: buf(new Float32Array(C)), count: P2.length / 3 };
  }
  function refreshCoarse() {
    var E = CLW.engine; if (!E.s3 || coarseBusy || !E.s3.samples) return;
    coarseBusy = true; coarseT = performance.now();
    var s = Math.max(1, Math.round(0.25 / G.dx)); // ~ 25 cm
    if (G.nx * G.ny * G.nz / (s * s * s) > 3e6) s = Math.ceil(Math.cbrt(G.nx * G.ny * G.nz / 3e6));
    E.s3.readCoarse(s).then(function (cf) { coarseBusy = false; if (!cf) return; lines = streamlines(cf); needs = true; }, function () { coarseBusy = false; });
  }

  // ---------------------------------------------------------------- textures des coupes
  function texFrom(canvas, old) {
    var t = old || gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  // uv = [u0, v0, u1, v1] : partie de la texture posée sur le quadrilatère (v = 0 en haut de l'image)
  function quad(tex, pts, alpha, M, uv) {
    var p = new Float32Array([].concat(pts[0], pts[1], pts[2], pts[0], pts[2], pts[3]));
    var u0 = uv ? uv[0] : 0, v0 = uv ? uv[1] : 0, u1 = uv ? uv[2] : 1, v1 = uv ? uv[3] : 1;
    var t = new Float32Array([u0, v1, u1, v1, u1, v0, u0, v1, u1, v0, u0, v0]);
    gl.useProgram(P.tex); clearAttrs();
    var bp = buf(p), bt = buf(t);
    attr(P.tex, 'p', bp, 3); attr(P.tex, 't', bt, 2);
    gl.uniformMatrix4fv(gl.getUniformLocation(P.tex, 'M'), false, M);
    gl.uniform1f(gl.getUniformLocation(P.tex, 'A'), alpha);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(gl.getUniformLocation(P.tex, 'S'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.deleteBuffer(bp); gl.deleteBuffer(bt);
  }

  // ---------------------------------------------------------------- API
  V.dirty = function () { needs = true; };
  // projection d'un point du monde (m) vers l'écran (px CSS, relatif au canevas) ; null derrière la caméra
  var lastM = null;
  V.project = function (x, y, z) {
    var M = lastM; if (!M || !cv) return null;
    var cx = M[0] * x + M[4] * y + M[8] * z + M[12], cy = M[1] * x + M[5] * y + M[9] * z + M[13], cw = M[3] * x + M[7] * y + M[11] * z + M[15];
    if (cw <= 1e-6) return null;
    var r = cv.getBoundingClientRect();
    return [(cx / cw * 0.5 + 0.5) * r.width, (1 - (cy / cw * 0.5 + 0.5)) * r.height];
  };
  V.resize = function () {
    if (!cv) return;
    var r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    cv.width = Math.max(1, Math.round(r.width * d)); cv.height = Math.max(1, Math.round(r.height * d)); needs = true;
  };
  // zone d'étude : emprise des obstacles et écrans (centre, rayon) ; caméra et coupes cadrées dessus
  var focus = null;
  function findFocus(g) {
    var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity, pl = g.nx * g.ny;
    for (var k = 1; k < g.nz; k++) for (var j = 0; j < g.ny; j += 2) for (var i = 0; i < g.nx; i += 2) {
      var id = k * pl + j * g.nx + i;
      if ((g.flags[id] & 1) || g.drag[id] > 0) { var x = g.x0 + (i + 0.5) * g.dx, y = g.ys + (j + 0.5) * g.dx; bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
    }
    if (!isFinite(bx0)) return { cx: 0, cy: 0, r: Math.min(g.W, g.H) / 4, R: Math.min(g.W, g.H) / 2, zTop: g.Htop };
    var r = Math.max(bx1 - bx0, by1 - by0) / 2 + 0.5;
    // les coupes montrent 3 fois l'emprise (le sillage), sans sortir du domaine ; hauteur : 2,5 fois la plus haute
    return { cx: (bx0 + bx1) / 2, cy: (by0 + by1) / 2, r: r, R: Math.max(8, 3 * r), zTop: Math.min(g.Htop, Math.max(6, 2.5 * g.hmax)) };
  }
  V.sceneChanged = function (g) {
    G = g; scene = null; lines = null; coarseT = 0; needs = true;
    if (g) {
      focus = findFocus(g);
      cam.tx = focus.cx; cam.ty = focus.cy; cam.tz = Math.min(g.hmax / 2, 2);
      cam.dist = Math.max(10, 4.5 * Math.max(focus.r, g.hmax));
      camAim = true; // orientation à fixer d'après le trait de coupe au premier dessin
    }
  };
  var camAim = false;
  // caméra de biais par rapport au trait de coupe : la coupe verticale vue presque de face, le plan en perspective
  function aimCamera(E) {
    var g = E.vcutGeom; if (!g) return;
    var dx = g.b[0] - g.a[0], dy = g.b[1] - g.a[1], L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    // côté de l'observateur : la normale qui regarde vers le sud (plan lisible, nord en haut de la coupe)
    var nx = -dy, ny = dx; if (ny > 0) { nx = -nx; ny = -ny; }
    cam.yaw = Math.atan2(nx, -ny) + 0.5; cam.pitch = 0.72;
    camAim = false;
  }
  V.focus = function () { return focus; };
  window.addEventListener('resize', function () { if (cv && !cv.hidden) V.resize(); });

  V.frame = function (E, S) {
    if (!cv && !init()) return;
    if (!gl) return;
    if (!S.mode3d || !E.vox) return;
    if (G !== E.vox) V.sceneChanged(E.vox);
    var rr = cv.getBoundingClientRect(), dd = window.devicePixelRatio || 1;
    if (Math.abs(cv.width - Math.round(rr.width * dd)) > 1 || Math.abs(cv.height - Math.round(rr.height * dd)) > 1) V.resize();
    if (!coarseT || performance.now() - coarseT > (E.stable ? 60000 : 8000)) refreshCoarse();
    if (!needs && !E.fieldDirty) return;
    needs = false;
    if (!scene) scene = buildModel();
    if (camAim && E.vcutGeom) aimCamera(E);
    gl.viewport(0, 0, cv.width, cv.height);
    gl.clearColor(0.043, 0.051, 0.067, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    var eye = [cam.tx + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw), cam.ty - cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw), cam.tz + cam.dist * Math.sin(cam.pitch)];
    var M = mul(persp(0.8, cv.width / cv.height, 0.1, 10000), lookAt(eye, [cam.tx, cam.ty, cam.tz], [0, 0, 1]));
    lastM = M;
    // réglages du bandeau 3D : coupes, vent, maquette (pleine, transparente, masquée)
    var O3 = S.v3 || { h: true, v: true, l: true, m: 'plein', o: true };
    var Wd = G.W / 2, Hd = G.H / 2;
    var F = focus || { cx: 0, cy: 0, R: Math.max(Wd, Hd), zTop: G.Htop };
    // coupe « ouverte » : on retire du modèle la moitié située du côté de l'observateur par rapport au plan de coupe
    // verticale, pour que le refuge se lise comme une vraie coupe et non comme un bâtiment masqué par un panneau
    var clip = [0, 0, 0, 0];
    if (O3.o !== false && O3.v && E.vcutGeom) {
      var ca = E.vcutGeom.a, cb = E.vcutGeom.b, clen = Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) || 1;
      var cnx = -(cb[1] - ca[1]) / clen, cny = (cb[0] - ca[0]) / clen, cd = cnx * ca[0] + cny * ca[1];
      if (cnx * eye[0] + cny * eye[1] - cd < 0) { cnx = -cnx; cny = -cny; cd = -cd; }
      clip = [cnx, cny, cd, 1];
    }
    function drawModel(alpha, mode) { // mode : 'tout' (maquette, coupée), 'sol' (le sol du domaine seul, jamais coupé)
      gl.useProgram(P.mesh); clearAttrs();
      attr(P.mesh, 'p', scene.p, 3); attr(P.mesh, 'n', scene.n, 3); attr(P.mesh, 'c', scene.c, 4);
      gl.uniformMatrix4fv(gl.getUniformLocation(P.mesh, 'M'), false, M);
      gl.uniform1f(gl.getUniformLocation(P.mesh, 'AL'), alpha);
      // le sol du domaine est le dernier carré (6 sommets) du modèle
      if (mode === 'sol') {
        gl.uniform4f(gl.getUniformLocation(P.mesh, 'CL'), 0, 0, 0, 0);
        gl.drawArrays(gl.TRIANGLES, scene.count - 6, 6);
      } else {
        gl.uniform4f(gl.getUniformLocation(P.mesh, 'CL'), clip[0], clip[1], clip[2], clip[3]);
        gl.uniform3f(gl.getUniformLocation(P.mesh, 'FC'), F.cx, F.cy, F.R * F.R);
        gl.drawArrays(gl.TRIANGLES, 0, scene.count - 6);
      }
    }
    // le sol d'abord ; maquette pleine ensuite (elle cache ce qui est derrière) ; transparente à la fin, sans écrire la profondeur
    drawModel(1, 'sol');
    if (O3.m === 'plein') drawModel(1, 'tout');
    // coupe horizontale (texture du plan : ligne 0 au nord), plus opaque si la maquette ne la cache pas
    var fc = CLW.getFieldCanvas && CLW.getFieldCanvas();
    if (O3.h && fc && fc.width > 1 && E.samples) {
      // température : l'air à la température extérieure (couleur du palier 0) devient presque transparent
      var fcs = fc;
      if (S.display === 'temp' && CLW.Thermal && CLW.Thermal.at && CLW.Thermal.tempColor) {
        var aT = CLW.Thermal.at(CLW.Sun.state.t);
        if (aT) {
          var ac = CLW.Thermal.tempColor(aT.Ta, aT.Ta);
          if (!V._amb) V._amb = document.createElement('canvas');
          var cv2 = V._amb; if (cv2.width !== fc.width || cv2.height !== fc.height) { cv2.width = fc.width; cv2.height = fc.height; }
          var x2 = cv2.getContext('2d'); x2.drawImage(fc, 0, 0);
          var im2 = x2.getImageData(0, 0, cv2.width, cv2.height), dd = im2.data;
          for (var i2 = 0; i2 < dd.length; i2 += 4) if (Math.abs(dd[i2] - ac[0]) < 4 && Math.abs(dd[i2 + 1] - ac[1]) < 4 && Math.abs(dd[i2 + 2] - ac[2]) < 4) dd[i2 + 3] = 22;
          x2.putImageData(im2, 0, 0); fcs = cv2;
        }
      }
      texH = texFrom(fcs, texH);
      var z = (E.kslice - 0.5) * G.dx;
      // carré de la zone d'étude seulement (texture : colonne 0 à l'ouest, ligne 0 au nord)
      var x0 = Math.max(-Wd, F.cx - F.R), x1 = Math.min(Wd, F.cx + F.R), y0 = Math.max(-Hd, F.cy - F.R), y1 = Math.min(Hd, F.cy + F.R);
      quad(texH, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], O3.m === 'plein' ? 0.6 : 0.8, M,
        [(x0 + Wd) / G.W, (Hd - y1) / G.H, (x1 + Wd) / G.W, (Hd - y0) / G.H]);
    }
    // coupe verticale le long du trait, limitée à la zone d'étude (le long du trait et en hauteur)
    if (O3.v && E.vcutCanvas && E.vcutGeom) {
      texV = texFrom(E.vcutCanvas3 || E.vcutCanvas, texV); // vcutCanvas3 : l'air à la température extérieure y est presque transparent
      var a = E.vcutGeom.a, b = E.vcutGeom.b, z0 = -G.dx, z1 = (G.nz - 1) * G.dx, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      var ex = (b[0] - a[0]) / L, ey = (b[1] - a[1]) / L, tc = (F.cx - a[0]) * ex + (F.cy - a[1]) * ey;
      var t0 = Math.max(0, tc - F.R), t1 = Math.min(L, tc + F.R), zt = Math.min(z1, F.zTop);
      if (t1 - t0 < 1) { t0 = 0; t1 = L; }
      var A2 = [a[0] + ex * t0, a[1] + ey * t0], B2 = [a[0] + ex * t1, a[1] + ey * t1];
      quad(texV, [[A2[0], A2[1], z0], [B2[0], B2[1], z0], [B2[0], B2[1], zt], [A2[0], A2[1], zt]], 0.85, M,
        [t0 / L, (z1 - zt) / (z1 - z0), t1 / L, 1]);
    }
    // lignes de courant
    if (O3.l && lines && lines.count) {
      gl.useProgram(P.line); clearAttrs();
      attr(P.line, 'p', lines.p, 3); attr(P.line, 'c', lines.c, 4);
      gl.uniformMatrix4fv(gl.getUniformLocation(P.line, 'M'), false, M);
      gl.drawArrays(gl.LINES, 0, lines.count);
    }
    if (O3.m === 'transp') { gl.depthMask(false); drawModel(0.3, 'tout'); gl.depthMask(true); }
    if (!hintEl) {
      hintEl = document.createElement('div'); hintEl.className = 'v3d-help';
      hintEl.textContent = 'Glisser : tourner · clic droit : déplacer · molette : zoom · réglages en haut : coupes, vent, maquette · lignes de courant : couleur selon la vitesse';
      cv.parentNode.appendChild(hintEl);
    }
  };
})(window);
