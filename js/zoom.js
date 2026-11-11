/* CL-WIND - zoom.js
 * Zoom 3D sur un pan de mur : un petit domaine (1 à 2 m de côté, du sol au-dessus du toit) centré sur un point
 * de la paroi, calculé au centimètre environ, où chaque brique (ou lame) est un obstacle plein : l'air passe
 * vraiment dans les joints, au lieu de la bande poreuse du calcul d'ensemble.
 * - Calcul séparé (son propre solveur WebGPU) : le calcul principal est suspendu tant que la vue Zoom est affichée.
 * - Vent : direction et profil du vent libre (rapport à la vitesse à 1,5 m), comme en entrée du calcul d'ensemble ;
 *   le domaine étant petit, l'écoulement qui arrive sur le mur n'est pas modifié par le reste de l'ouvrage.
 * - Découpage : volumes (toit, réservoir…) par parité verticale ; écrans couche par couche (coupe des maillages,
 *   remplissage des sections de chaque brique).
 * - Affichage : coupe horizontale à la hauteur choisie, coupe verticale dans l'axe du vent, chiffres des joints.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var ZM = CLW.Zoom = {};
  var RAD = Math.PI / 180;
  function $(id) { return document.getElementById(id); }
  function fmt(v, d) { return CLW.fmt ? CLW.fmt(v, d) : (+v).toFixed(d); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  var Z = ZM.state = { mode: 'coupes', az: null, L: 10, D: 5, zc: 1.5, s3: null, creating: false, G: null, gen: 0, reading: false, seen: -1, h: null, v: null, stats: null, msg: '' };

  // ---------------------------------------------------------------- géométrie
  function wallInfo() {
    var M = CLW.Sun && CLW.Sun.meshes(); if (!M || !M.scr.length) return null;
    var G = CLW.Thermal && CLW.Thermal.geometry(); if (!G) return null;
    var rs = [];
    M.scr.forEach(function (m) { var v = m.v; for (var i = 0; i < v.length; i += 9) rs.push(Math.hypot(v[i] - G.cx, v[i + 1] - G.cy)); });
    rs.sort(function (a, b) { return a - b; });
    return { cx: G.cx, cy: G.cy, rIn: rs[Math.floor(rs.length * 0.02)], rOut: rs[Math.floor(rs.length * 0.98)], rMid: rs[Math.floor(rs.length / 2)], Hw: G.Hw, M: M };
  }
  function bboxOf(m) { var v = m.v, b = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; for (var i = 0; i < v.length; i += 3) { for (var a = 0; a < 3; a++) { if (v[i + a] < b[a]) b[a] = v[i + a]; if (v[i + a] > b[a + 3]) b[a + 3] = v[i + a]; } } return b; }
  // remplit les sections fermées (anneaux) d'une couche : centre de cellule à l'intérieur (pair-impair par anneau)
  function fillRings(G, rings, k) {
    var plane = G.nx * G.ny;
    rings.forEach(function (R) {
      var x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
      R.forEach(function (p) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); });
      var i0 = Math.max(0, Math.ceil((x0 - G.x0) / G.dx - 0.5)), i1 = Math.min(G.nx - 1, Math.floor((x1 - G.x0) / G.dx - 0.5));
      var j0 = Math.max(0, Math.ceil((y0 - G.ys) / G.dx - 0.5)), j1 = Math.min(G.ny - 1, Math.floor((y1 - G.ys) / G.dx - 0.5));
      for (var j = j0; j <= j1; j++) {
        var py = G.ys + (j + 0.5) * G.dx;
        for (var i = i0; i <= i1; i++) {
          var px = G.x0 + (i + 0.5) * G.dx, c = false;
          for (var a = 0, b = R.length - 1; a < R.length; b = a++) if ((R[a][1] > py) !== (R[b][1] > py) && px < (R[b][0] - R[a][0]) * (py - R[a][1]) / (R[b][1] - R[a][1]) + R[a][0]) c = !c;
          if (c) G.flags[k * plane + j * G.nx + i] = 1;
        }
      }
    });
  }
  // repère du mur : origine au point du mur, x le long du mur, y vers l'extérieur (rayon), z vertical
  function toWall(M, c, az, reach) {
    var ca = Math.cos(az * RAD), sa = Math.sin(az * RAD); // t = (cos, -sin), r = (sin, cos)
    function one(m) {
      var b = bboxOf(m); // objets loin de la boîte : ignorés
      if (Math.hypot((b[0] + b[3]) / 2 - c[0], (b[1] + b[4]) / 2 - c[1]) > reach + Math.hypot(b[3] - b[0], b[4] - b[1])) return null;
      var v = m.v, o = new Float32Array(v.length);
      for (var i = 0; i < v.length; i += 3) {
        var px = v[i] - c[0], py = v[i + 1] - c[1];
        o[i] = px * ca - py * sa; o[i + 1] = px * sa + py * ca; o[i + 2] = v[i + 2];
      }
      return { v: o, f: m.f };
    }
    return { vol: M.vol.map(one).filter(Boolean), scr: M.scr.map(one).filter(Boolean) };
  }
  ZM.build = function () {
    var w0 = wallInfo(); if (!w0) return null;
    var S = CLW.state, t0 = performance.now();
    var az = Z.az != null ? Z.az : S.wind.dir, rm = 0.5 * (w0.rIn + w0.rOut);
    var c = [w0.cx + rm * Math.sin(az * RAD), w0.cy + rm * Math.cos(az * RAD)], W = Z.L, H = Z.D;
    // vent dans le repère du mur : direction « venant de », comptée comme les azimuts
    var th = S.wind.dir * RAD, wx = -Math.sin(th), wy = -Math.cos(th), ca = Math.cos(az * RAD), sa = Math.sin(az * RAD);
    var lx = wx * ca - wy * sa, ly = wx * sa + wy * ca, dirL = ((Math.atan2(-lx, -ly) / RAD) + 360) % 360;
    var w = { cx: 0, cy: -rm, rIn: w0.rIn, rOut: w0.rOut, rMid: w0.rMid, Hw: w0.Hw, M: toWall(w0.M, c, az, Math.hypot(W, H)) };
    var cx = 0, cy = 0;
    var hmax = 0; w.M.vol.concat(w.M.scr).forEach(function (m) { var b = bboxOf(m); if (b[0] < cx + W / 2 && b[3] > cx - W / 2 && b[1] < cy + H / 2 && b[4] > cy - H / 2) hmax = Math.max(hmax, b[5]); });
    var Htop = Math.max(1.5, hmax + Math.max(0.3, 0.12 * hmax));
    var V = CLW.Vox3D, budget = V.BUDGET[Math.min(S.res3d || 0, V.BUDGET.length - 1)];
    var maxC = CLW.Solver3D && CLW.Solver3D.maxCells ? CLW.Solver3D.maxCells() : budget; if (maxC > 0) budget = Math.min(budget, 0.95 * maxC);
    var dx = Math.max(0.004, Math.cbrt(W * H * Htop / budget));
    var nx = Math.round(W / dx), ny = Math.round(H / dx), nz = Math.round(Htop / dx) + 1;
    var G = { W: W, H: H, dx: dx, nx: nx, ny: ny, nz: nz, x0: cx - W / 2, ys: cy - H / 2, Htop: (nz - 1) * dx, hmax: hmax, cx: cx, cy: cy, az: az, wall: w, dirL: dirL, origin: c };
    var plane = nx * ny, N = plane * nz;
    G.flags = new Uint32Array(N); for (var q = 0; q < plane; q++) G.flags[q] = 3;
    function inBox(m) { var b = bboxOf(m); return b[0] < G.x0 + W && b[3] > G.x0 && b[1] < G.ys + H && b[4] > G.ys; }
    var vols = w.M.vol.filter(inBox), scr = w.M.scr.filter(inBox);
    vols.forEach(function (m) { V.fillMesh(G, m, 1); });
    var zs = 1e9, ze = -1e9; scr.forEach(function (m) { var b = bboxOf(m); zs = Math.min(zs, b[2]); ze = Math.max(ze, b[5]); m._bb = b; });
    for (var k = 1; k < nz; k++) {
      var zc = (k - 0.5) * dx + 1e-6; if (zc < zs || zc > ze) continue;
      var rings = [];
      scr.forEach(function (m) { if (zc < m._bb[2] || zc > m._bb[5]) return; V.sliceMesh(m, zc).forEach(function (r) { rings.push(r); }); });
      if (rings.length) fillRings(G, rings, k);
    }
    var ns = 0; for (q = plane; q < N; q++) if (G.flags[q] & 1) ns++;
    G.solidFrac = ns / (N - plane); G.nScr = scr.length; G.nVol = vols.length; G.ms = Math.round(performance.now() - t0);
    return G;
  };

  // ---------------------------------------------------------------- calcul
  ZM.start = function () {
    if (Z.creating) return;
    if (!Z.s3) {
      Z.creating = true; Z.msg = 'Démarrage de WebGPU…'; ZM.draw();
      CLW.Solver3D.create().then(function (s) {
        Z.creating = false;
        if (!s) { Z.msg = 'Le zoom 3D demande WebGPU (Chrome ou Edge récents).'; ZM.draw(); return; }
        Z.s3 = s; ZM.start();
      });
      return;
    }
    Z.msg = 'Découpage des briques…'; ZM.draw();
    setTimeout(function () {
      var G = null; try { G = ZM.build(); } catch (e) { console.error(e); }
      if (!G) { Z.msg = 'Pas de paroi (briques, lames) dans la scène.'; ZM.draw(); return; }
      Z.G = G; Z.gen++; Z.seen = -1; Z.h = Z.v = null; Z.stats = null;
      var L = CLW.LBM, alpha = 0.25, zrefC = 1.5 / G.dx, top = (G.nz - 1) / zrefC;
      var uref = Math.min(0.06, 0.09 / Math.pow(Math.max(1, top), alpha));
      Z.uref = uref;
      Z.s3.reset({ nx: G.nx, ny: G.ny, nz: G.nz, flags: G.flags, drag: null, dir: G.dirL, uref: uref, alpha: alpha, zref: zrefC,
        tau0: L.TAU0, cs: L.CS, gam: L.GAM, lamL: L.L_RAPPEL / G.dx, turbI: 0.2, turbL: Math.max(8, 0.3 / G.dx) });
      Z.msg = ''; Z.t0 = performance.now();
      ZM.draw();
    }, 20);
  };
  ZM.stop = function () { if (Z.s3) Z.s3.pause(); };
  ZM.running = function () { return !!(Z.s3 && Z.s3.running && Z.G); };
  function planeLine(G) { // coupe verticale dans l'axe du vent, par le centre
    var th = G.dirL * RAD, wx = -Math.sin(th), wy = -Math.cos(th);
    var t = Math.min(Math.abs(wx) > 1e-9 ? G.W / 2 / Math.abs(wx) : 1e9, Math.abs(wy) > 1e-9 ? G.H / 2 / Math.abs(wy) : 1e9) * 0.999;
    var ax = (G.cx - wx * t - G.x0) / G.dx - 0.5, ay = (G.cy - wy * t - G.ys) / G.dx - 0.5, bx = (G.cx + wx * t - G.x0) / G.dx - 0.5, by = (G.cy + wy * t - G.ys) / G.dx - 0.5;
    var n = Math.max(2, Math.round(Math.hypot(bx - ax, by - ay)) + 1);
    return { p: [3, 0, { ox: ax, oy: ay, sx: (bx - ax) / (n - 1), sy: (by - ay) / (n - 1), w: n }], wx: wx, wy: wy, t: t, n: n };
  }
  ZM.frame = function () {
    var s3 = Z.s3, G = Z.G;
    if (s3 && G && s3.running) s3.frame();
    if (s3 && G && !Z.reading && s3.samples && s3.samples !== Z.seen) {
      Z.reading = true;
      var gen = Z.gen, seen = s3.samples, k = Math.max(1, Math.min(G.nz - 1, Math.round(Z.zc / G.dx + 0.5))), pl = planeLine(G);
      s3.readPlanes([[0, k], pl.p]).then(function (r) {
        Z.reading = false; if (!r || gen !== Z.gen) return;
        Z.h = r[0]; Z.v = r[1]; Z.k = k; Z.pl = pl; Z.seen = seen;
        Z.stats = stats(); ZM.draw();
      }, function () { Z.reading = false; });
    }
    if (Z.dirty) { Z.dirty = false; ZM.draw(); }
    if (Z.mode === '3d' && CLW.Zoom3D) CLW.Zoom3D.frame();
  };
  // affichage : coupes (plan + coupe verticale) ou vue 3D seule
  ZM.setMode = function (m) {
    Z.mode = m === '3d' ? '3d' : 'coupes';
    var is3 = Z.mode === '3d';
    $('zoom-plan').hidden = is3; $('zoom-cut').hidden = is3; $('zoom-3d').hidden = !is3; $('zoom-bar3d').hidden = !is3;
    Array.prototype.forEach.call(document.querySelectorAll('#zoom-mode [data-zm]'), function (b) { b.classList.toggle('on', b.getAttribute('data-zm') === Z.mode); });
    if (is3 && CLW.Zoom3D) CLW.Zoom3D.reset();
    ZM.draw();
  };
  // chiffres de la coupe horizontale : joints (bande du mur), côté extérieur, côté intérieur
  function stats() {
    var G = Z.G, h = Z.h, w = G.wall, plane = G.nx * G.ny, k = Z.k, U = Z.uref;
    var j = { n: 0, s: 0, mx: 0, fl: 0, nb: 0 }, o = { n: 0, s: 0 }, ii = { n: 0, s: 0 };
    for (var jj = 0; jj < G.ny; jj++) for (var i = 0; i < G.nx; i++) {
      var q = jj * G.nx + i, x = G.x0 + (i + 0.5) * G.dx, y = G.ys + (jj + 0.5) * G.dx, dxr = x - w.cx, dyr = y - w.cy, r = Math.hypot(dxr, dyr);
      var solid = G.flags[k * plane + q] & 1, sp = h.data[4 * q + 3] / U;
      if (r >= w.rIn && r <= w.rOut) {
        j.nb++;
        if (!solid) { j.n++; j.s += sp; j.mx = Math.max(j.mx, sp); j.fl += -(h.data[4 * q] * dxr + h.data[4 * q + 1] * dyr) / r / U; }
      } else if (!solid && r > w.rOut + 0.05 && r < w.rOut + 0.3) { o.n++; o.s += sp; }
      else if (!solid && r < w.rIn - 0.05 && r > w.rIn - 0.3) { ii.n++; ii.s += sp; }
    }
    return { open: j.nb ? j.n / j.nb : 0, joint: j.n ? j.s / j.n : NaN, jointMax: j.mx, inflow: j.nb ? j.fl / j.nb : 0, out: o.n ? o.s / o.n : NaN, inn: ii.n ? ii.s / ii.n : NaN };
  }

  // ---------------------------------------------------------------- affichage
  function col(r) { var c = CLW.ramp ? CLW.ramp(clamp(r / 2, 0, 1)) : [Math.round(255 * r / 2), 80, 200]; return c; }
  function drawSlice(cv, title, data, w, h, solidAt, opt) {
    var d = window.devicePixelRatio || 1, W = Math.max(50, Math.round(cv.clientWidth * d)), H = Math.max(50, Math.round(cv.clientHeight * d));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    var c = cv.getContext('2d'); c.fillStyle = '#0b0d11'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#dfe4ec'; c.font = (12 * d) + 'px system-ui, sans-serif'; c.textBaseline = 'top'; c.fillText(title, 8 * d, 6 * d);
    if (!data) return null;
    var top = 26 * d, bot = 22 * d, s = Math.min((W - 16 * d) / w, (H - top - bot) / h), ox = (W - s * w) / 2, oy = top + (H - top - bot - s * h) / 2;
    var im = new ImageData(w, h);
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      var src = opt.idx(x, y), p = 4 * ((h - 1 - y) * w + x), cc;
      if (solidAt(x, y)) cc = [196, 112, 64]; else cc = col(data[4 * src + 3] / Z.uref);
      im.data[p] = cc[0]; im.data[p + 1] = cc[1]; im.data[p + 2] = cc[2]; im.data[p + 3] = 255;
    }
    var tc = document.createElement('canvas'); tc.width = w; tc.height = h; tc.getContext('2d').putImageData(im, 0, 0);
    c.imageSmoothingEnabled = false; c.drawImage(tc, ox, oy, s * w, s * h);
    // flèches de la vitesse dans le plan
    var st = Math.max(4, Math.round(Math.min(w, h) / 26)), U = Z.uref;
    c.strokeStyle = 'rgba(255,255,255,0.75)'; c.lineWidth = d;
    for (y = Math.floor(st / 2); y < h; y += st) for (x = Math.floor(st / 2); x < w; x += st) {
      if (solidAt(x, y)) continue;
      var v = opt.vec(x, y), L = Math.hypot(v[0], v[1]) / U; if (L < 0.03) continue;
      var px = ox + (x + 0.5) * s, py = oy + (h - y - 0.5) * s, len = Math.min(1, L / 1.5) * st * s * 0.9, ex = v[0] / Math.hypot(v[0], v[1]), ey = -v[1] / Math.hypot(v[0], v[1]);
      c.beginPath(); c.moveTo(px - ex * len / 2, py - ey * len / 2); c.lineTo(px + ex * len / 2, py + ey * len / 2);
      c.lineTo(px + ex * len / 2 - (ex * 0.35 - ey * 0.25) * len * 0.5, py + ey * len / 2 - (ey * 0.35 + ex * 0.25) * len * 0.5); c.stroke();
    }
    return { ox: ox, oy: oy, s: s, W: W, H: H, d: d, c: c };
  }
  ZM.draw = function () {
    var cp = $('zoom-plan'), cc = $('zoom-cut'), info = $('zoom-info'); if (!cp) return;
    var G = Z.G, S = CLW.state, s3 = Z.s3;
    if (!G || !Z.h) {
      drawSlice(cp, Z.msg || 'Choisissez la position sur le mur, puis « Lancer le zoom ».', null);
      drawSlice(cc, '', null);
      if (info) info.innerHTML = Z.msg ? Z.msg : '';
      return;
    }
    var h = Z.h, v = Z.v, nx = G.nx, ny = G.ny, plane = nx * ny, k = Z.k;
    var L1 = drawSlice(cp, 'Coupe horizontale à ' + fmt((k - 0.5) * G.dx, 2) + ' m · mur horizontal, extérieur en haut · cellule ' + fmt(G.dx * 100, 1) + ' cm', h.data, nx, ny,
      function (x, y) { return G.flags[k * plane + y * nx + x] & 1; },
      { idx: function (x, y) { return y * nx + x; }, vec: function (x, y) { var q = 4 * (y * nx + x); return [h.data[q], h.data[q + 1]]; } });
    // échelle 10 cm et direction du vent
    if (L1) {
      var c = L1.c, d = L1.d; c.fillStyle = '#fff'; c.fillRect(L1.ox + 8 * d, L1.oy + ny * L1.s - 12 * d, 0.1 / G.dx * L1.s, 3 * d);
      c.font = (10 * d) + 'px system-ui, sans-serif'; c.textBaseline = 'bottom'; c.fillText('10 cm', L1.ox + 8 * d, L1.oy + ny * L1.s - 14 * d);
      var th = G.dirL * RAD, ax = L1.ox + nx * L1.s - 30 * d, ay = L1.oy + 30 * d, ux = -Math.sin(th), uy = Math.cos(th);
      c.strokeStyle = '#fff'; c.lineWidth = 2 * d; c.beginPath(); c.moveTo(ax - ux * 16 * d, ay - uy * 16 * d); c.lineTo(ax + ux * 16 * d, ay + uy * 16 * d); c.stroke();
      c.beginPath(); c.arc(ax + ux * 16 * d, ay + uy * 16 * d, 3 * d, 0, 7); c.fillStyle = '#fff'; c.fill();
      c.textBaseline = 'top'; c.textAlign = 'center'; c.fillText('vent', ax, ay + 20 * d); c.textAlign = 'left';
    }
    var pl = Z.pl, w = pl.n, nz = G.nz, ln = pl.p[2];
    function cell(x) { return [clamp(Math.round(ln.ox + ln.sx * x), 0, nx - 1), clamp(Math.round(ln.oy + ln.sy * x), 0, ny - 1)]; }
    var L2 = drawSlice(cc, 'Coupe verticale dans l\'axe du vent (vent de gauche à droite) · ' + fmt(G.Htop, 1) + ' m de haut', v.data, w, nz,
      function (x, z) { var p = cell(x); return z === 0 || (G.flags[z * plane + p[1] * nx + p[0]] & 1); },
      { idx: function (x, z) { return z * w + x; }, vec: function (x, z) { var q = 4 * (z * w + x); return [h ? (v.data[q] * pl.wx + v.data[q + 1] * pl.wy) : 0, v.data[q + 2]]; } });
    if (L2) { // hauteur de la coupe horizontale
      var c2 = L2.c, yk = L2.oy + (nz - k - 0.5) * L2.s; c2.strokeStyle = 'rgba(255,255,255,0.6)'; c2.setLineDash([4 * L2.d, 4 * L2.d]); c2.beginPath(); c2.moveTo(L2.ox, yk); c2.lineTo(L2.ox + w * L2.s, yk); c2.stroke(); c2.setLineDash([]);
    }
    var st = Z.stats, sp = S.wind.speed;
    if (info && st) {
      var trav = s3 ? s3.trav : 0;
      info.innerHTML = '<b>Mur à ' + fmt(G.az, 0) + '°</b> (' + (Math.abs(((G.az - S.wind.dir + 540) % 360) - 180) < 45 ? 'face au vent' : Math.abs(((G.az - S.wind.dir + 540) % 360) - 180) > 135 ? 'sous le vent' : 'de côté') + ') · ' +
        'grille ' + nx + ' × ' + ny + ' × ' + nz + ' (' + fmt(nx * ny * nz / 1e6, 1) + ' M cellules), ' + G.nScr + ' briques ou lames découpées, ' + fmt(100 * G.solidFrac, 0) + ' % de plein · ' +
        (trav < 6 ? 'moyenne en cours : ' + fmt(trav, 1) + ' / 6 traversées' : 'moyenne stabilisée') + '<br>' +
        'À ' + fmt((k - 0.5) * G.dx, 2) + ' m : vide dans le mur <b>' + fmt(100 * st.open, 0) + ' %</b> · air dans les joints <b>' + fmt(st.joint * sp, 2) + ' m/s</b> en moyenne (' + fmt(st.joint, 2) + ' × vent libre), ' +
        fmt(st.jointMax * sp, 2) + ' m/s au plus · devant le mur ' + fmt(st.out * sp, 2) + ' m/s, derrière ' + fmt(st.inn * sp, 2) + ' m/s · ' +
        'air qui traverse : <b>' + fmt(Math.abs(st.inflow) * sp, 2) + ' m³/s par m²</b> de mur (' + (st.inflow >= 0 ? 'vers l\'intérieur' : 'vers l\'extérieur') + ')' +
        (Z.mode === '3d' && CLW.Zoom3D && CLW.Zoom3D.info ? '<br>Lignes de courant : ' + CLW.Zoom3D.info : '');
    }
  };

  // ---------------------------------------------------------------- interface
  ZM.init = function () {
    var a = $('zoom-az'), zl = $('zoom-L'), zd = $('zoom-D'), zc = $('zoom-z');
    if (!a) return;
    function setAz(v) { Z.az = ((v % 360) + 360) % 360; a.value = Math.round(Z.az); }
    setAz(CLW.state.wind.dir);
    a.addEventListener('change', function () { var v = parseFloat(a.value); if (isFinite(v)) setAz(v); });
    $('zoom-up').onclick = function () { setAz(CLW.state.wind.dir); ZM.start(); };
    $('zoom-side').onclick = function () { setAz(CLW.state.wind.dir + 90); ZM.start(); };
    $('zoom-down').onclick = function () { setAz(CLW.state.wind.dir + 180); ZM.start(); };
    function dims() { Z.L = clamp(CLW.parseNum ? CLW.parseNum(zl.value) || 10 : parseFloat(zl.value) || 10, 1, 20); Z.D = clamp(CLW.parseNum ? CLW.parseNum(zd.value) || 5 : parseFloat(zd.value) || 5, 1, 20); zl.value = Z.L; zd.value = Z.D; }
    zl.addEventListener('change', dims); zd.addEventListener('change', dims);
    zc.addEventListener('input', function () { Z.zc = parseFloat(zc.value) || 1.5; Z.seen = -1; $('zoom-z-o').textContent = fmt(Z.zc, 2) + ' m'; });
    $('zoom-go').onclick = function () { ZM.start(); };
    $('zoom-pause').onclick = function () { if (!Z.s3 || !Z.G) return; if (Z.s3.running) Z.s3.pause(); else Z.s3.resume(); $('zoom-pause').textContent = Z.s3.running ? 'Pause' : 'Reprendre'; };
    window.addEventListener('resize', function () { Z.dirty = true; });
    Array.prototype.forEach.call(document.querySelectorAll('#zoom-mode [data-zm]'), function (b) { b.onclick = function () { ZM.setMode(b.getAttribute('data-zm')); }; });
    if (CLW.Zoom3D) CLW.Zoom3D.init();
    ZM.draw();
  };
})(window);
