/* CL-WIND - vox3d.js
 * Découpage de la scène en cubes pour le calcul 3D.
 * - Maillages Grasshopper (scene.mesh3d) : volumes pleins par parité verticale colonne par colonne ;
 *   écrans (briques, lames) en bande poreuse couche par couche : chaque couche est coupée, analysée
 *   comme en 2D (CLW.Screen.analyse : soudure, cols, porosité locale) et reçoit la traînée K(φ)/(2W).
 * - Objets 2D sans maillage (dessinés, importés, ou liaison sans 3D) : bâtiments extrudés à leur
 *   hauteur (6 m par défaut), écrans à 2,5 m, murs à 2 m, arbres en houppier sphérique.
 * Repère : celui du plan (x est, y nord, origine au centre du domaine), z au-dessus du sol.
 * Grille : x0 = -W/2 (ouest), ys = -H/2 (sud), couche k = 0 pleine (sol), centre de la couche k à (k - 0,5) dx.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var V = CLW.Vox3D = {};
  V.BUDGET = [2e6, 7e6, 20e6]; // cellules : aperçu, normal, fin

  function shiftMesh(m, ox, oy) {
    var v = m[0], out = new Float64Array(v.length);
    for (var i = 0; i < v.length; i += 3) { out[i] = v[i] - ox; out[i + 1] = v[i + 1] - oy; out[i + 2] = v[i + 2]; }
    return { v: out, f: m[1] };
  }
  function meshZmax(m) { var z = 0; for (var i = 2; i < m.v.length; i += 3) if (m.v[i] > z) z = m.v[i]; return z; }

  // volume fermé → cellules pleines (parité des intersections sur la verticale de chaque centre de cellule)
  function fillMesh(G, m, val) {
    var v = m.v, f = m.f, cols = new Map();
    for (var t = 0; t < f.length; t += 3) {
      var a = 3 * f[t], b = 3 * f[t + 1], c = 3 * f[t + 2];
      var ax = v[a], ay = v[a + 1], bx = v[b], by = v[b + 1], cx = v[c], cy = v[c + 1];
      var den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-12) continue; // triangle vertical
      var i0 = Math.max(0, Math.ceil((Math.min(ax, bx, cx) - G.x0) / G.dx - 0.5)), i1 = Math.min(G.nx - 1, Math.floor((Math.max(ax, bx, cx) - G.x0) / G.dx - 0.5));
      var j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - G.ys) / G.dx - 0.5)), j1 = Math.min(G.ny - 1, Math.floor((Math.max(ay, by, cy) - G.ys) / G.dx - 0.5));
      for (var j = j0; j <= j1; j++) {
        var py = G.ys + (j + 0.5) * G.dx;
        for (var i = i0; i <= i1; i++) {
          var px = G.x0 + (i + 0.5) * G.dx;
          var w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den, w2 = 1 - w0 - w1;
          if (w0 < -1e-9 || w1 < -1e-9 || w2 < -1e-9) continue;
          var z = w0 * v[a + 2] + w1 * v[b + 2] + w2 * v[c + 2], key = j * G.nx + i;
          var arr = cols.get(key); if (!arr) cols.set(key, arr = []); arr.push(z);
        }
      }
    }
    var plane = G.nx * G.ny;
    cols.forEach(function (zs, key) {
      zs.sort(function (p, q) { return p - q; });
      var u = [];
      for (var k = 0; k < zs.length; k++) if (!u.length || zs[k] - u[u.length - 1] > 1e-5) u.push(zs[k]);
      for (var s = 0; s + 1 < u.length; s += 2) {
        var k0 = Math.max(1, Math.ceil(u[s] / G.dx + 0.5)), k1 = Math.min(G.nz - 1, Math.floor(u[s + 1] / G.dx + 0.5));
        for (var kk = k0; kk <= k1; kk++) G.flags[kk * plane + key] = val;
      }
    });
  }

  // coupe d'un maillage à la hauteur z → anneaux fermés (plan)
  function sliceMesh(m, z) {
    var v = m.v, f = m.f, segs = [];
    for (var t = 0; t < f.length; t += 3) {
      var p = [3 * f[t], 3 * f[t + 1], 3 * f[t + 2]], pts = [];
      for (var e = 0; e < 3; e++) {
        var i = p[e], j = p[(e + 1) % 3];
        if (i > j) { var tmp = i; i = j; j = tmp; }
        var hi = v[i + 2] - z, hj = v[j + 2] - z;
        if ((hi < 0) !== (hj < 0)) { var s = hi / (hi - hj); pts.push([v[i] + s * (v[j] - v[i]), v[i + 1] + s * (v[j + 1] - v[i + 1])]); }
      }
      if (pts.length === 2) segs.push(pts);
    }
    if (!segs.length) return [];
    return CLW.Import.joinSegments(segs, 1e-5).rings.filter(function (r) { return r.length >= 3; });
  }

  // o : { W, H, budget (indice), dir, objects (plan), scene (données de la liaison) ou null, origin [x, y] }
  V.build = function (o) {
    var t0 = performance.now();
    var W = o.W, H = o.H, org = o.origin || [0, 0];
    var m3 = o.scene && o.scene.mesh3d;
    var solids = [], screens = [];
    if (m3) {
      (m3.volumes || []).forEach(function (m) { solids.push(shiftMesh(m, org[0], org[1])); });
      (m3.ecrans || []).forEach(function (m) { screens.push(shiftMesh(m, org[0], org[1])); });
    }
    // objets du plan à extruder : tous, sauf ceux de la liaison quand elle fournit les maillages (ses arbres et
    // plantes grimpantes n'ont pas de maillage : ils restent)
    var objs = (o.objects || []).filter(function (x) { return !(m3 && x.src === 'live' && x.type !== 'tree'); });
    var hmax = 0;
    solids.forEach(function (m) { hmax = Math.max(hmax, meshZmax(m)); });
    screens.forEach(function (m) { hmax = Math.max(hmax, meshZmax(m)); });
    objs.forEach(function (x) {
      if (x.type === 'building') hmax = Math.max(hmax, x.screen ? 2.5 : (x.height || 6));
      else if (x.type === 'wall') hmax = Math.max(hmax, 2);
      else if (x.type === 'tree') hmax = Math.max(hmax, x.z1 != null ? x.z1 : x.zc != null ? x.zc + x.rz : Math.max(3, x.r + 1) + x.r);
    });
    // hauteur du domaine : 3 × l'objet le plus haut (10 m au moins), ou celle de l'onglet Réglages (o.htop > 0),
    // jamais moins que l'objet le plus haut + 1 m
    var Htop = o.htop > 0 ? Math.max(Math.ceil(hmax + 1), o.htop) : Math.max(10, Math.ceil(3 * hmax));
    var budget = V.BUDGET[Math.min(o.budget || 0, V.BUDGET.length - 1)];
    var maxC = CLW.Solver3D && CLW.Solver3D.maxCells ? CLW.Solver3D.maxCells() : budget;
    if (maxC > 0) budget = Math.min(budget, 0.95 * maxC);
    var dx = Math.cbrt(W * H * Htop / budget);
    var nx = Math.max(16, Math.round(W / dx)), ny = Math.max(16, Math.round(H / dx)), nz = Math.max(12, Math.round(Htop / dx) + 1);
    var G = { W: W, H: H, Htop: (nz - 1) * dx, dx: dx, nx: nx, ny: ny, nz: nz, x0: -W / 2, ys: -H / 2, hmax: hmax };
    var plane = nx * ny, N = plane * nz;
    G.flags = new Uint32Array(N); G.drag = new Float32Array(N);
    for (var q = 0; q < plane; q++) G.flags[q] = 3; // sol glissant
    // grille 2D d'une couche (convention du plan : j vers le bas depuis y0 = H/2)
    var g2 = { W: W, H: H, nx: nx, ny: ny, dx: dx, x0: -W / 2, y0: H / 2 };
    G.g2 = g2;
    function put2D(arr2, k, cb) { // arr2 en convention 2D → couche k (j3 = ny - 1 - j2)
      for (var j2 = 0; j2 < ny; j2++) { var j3 = ny - 1 - j2; for (var i = 0; i < nx; i++) cb(k * plane + j3 * nx + i, arr2[j2 * nx + i]); }
    }
    // volumes maillés
    solids.forEach(function (m) { fillMesh(G, m, 1); });
    // objets du plan extrudés
    objs.forEach(function (x) {
      var h = x.type === 'wall' ? 2 : x.type === 'building' ? (x.screen ? 2.5 : (x.height || 6)) : 0;
      if (x.type === 'tree' && x.z1 != null) {
        // plante grimpante : colonne verticale de rayon r entre z0 et z1 ; plus fine qu'une cellule, sa traînée va
        // à la cellule qui la contient, au prorata de la surface
        var ap = (x.a != null ? x.a : 0.6) * dx, R2 = x.r * x.r, hitP = 0, cells = [];
        var jy = Math.floor((x.y - G.ys) / dx), ix = Math.floor((x.x - G.x0) / dx);
        for (var jj = Math.max(0, jy - 3); jj <= Math.min(ny - 1, jy + 3); jj++) for (var ii = Math.max(0, ix - 3); ii <= Math.min(nx - 1, ix + 3); ii++) {
          var exx = G.x0 + (ii + 0.5) * dx - x.x, eyy = G.ys + (jj + 0.5) * dx - x.y; if (exx * exx + eyy * eyy <= R2) cells.push(jj * nx + ii);
        }
        var wP = 1; if (!cells.length && ix >= 0 && jy >= 0 && ix < nx && jy < ny) { cells.push(jy * nx + ix); wP = Math.min(1, Math.PI * R2 / (dx * dx)); }
        for (var kp = 1; kp < nz; kp++) {
          var zp = (kp - 0.5) * dx; if (zp < x.z0 || zp > x.z1) continue;
          cells.forEach(function (c) { G.drag[kp * plane + c] += ap * wP; }); hitP++;
        }
        return;
      }
      if (x.type === 'tree') {
        // houppier : sphère par défaut, ellipsoïde à sa vraie hauteur si Grasshopper l'a donné en volume (zc, rz)
        var hc = x.zc != null ? x.zc : Math.max(3, x.r + 1), vz = x.rz != null ? x.rz : x.r, aa = (x.a != null ? x.a : CLW.LBM.TREE_A) * dx;
        for (var k = 1; k < nz; k++) {
          var zc = (k - 0.5) * dx, dz = zc - hc; if (Math.abs(dz) > vz) continue;
          var rr = x.r * Math.sqrt(1 - (dz / vz) * (dz / vz));
          for (var j = 0; j < ny; j++) { var yc = G.ys + (j + 0.5) * dx; if (Math.abs(yc - x.y) > rr) continue;
            for (var i = 0; i < nx; i++) { var xc = G.x0 + (i + 0.5) * dx, ex = xc - x.x, ey = yc - x.y; if (ex * ex + ey * ey <= rr * rr) G.drag[k * plane + j * nx + i] += aa; } }
        }
        return;
      }
      if (!(h > 0)) return;
      var r2 = CLW.rasterize([x.screen ? Object.assign({}, x, { screen: false }) : x], g2, { closeSlits: false });
      var kmax = Math.min(nz - 1, Math.floor(h / dx + 0.5));
      for (var k2 = 1; k2 <= kmax; k2++) put2D(r2.solid, k2, function (id, s) { if (s) G.flags[id] = 1; });
    });
    // écrans poreux, couche par couche
    G.layers = [];
    var nScr = 0;
    if (screens.length) {
      var zs = Infinity, ze = -Infinity;
      screens.forEach(function (m) { for (var i = 2; i < m.v.length; i += 3) { zs = Math.min(zs, m.v[i]); ze = Math.max(ze, m.v[i]); } });
      for (var k3 = 1; k3 < nz; k3++) {
        var zc3 = (k3 - 0.5) * dx + 1e-6; if (zc3 < zs || zc3 > ze) continue;
        var rings = [];
        screens.forEach(function (m) { sliceMesh(m, zc3).forEach(function (r) { rings.push(r); }); });
        if (rings.length < 3) continue;
        var an = CLW.Screen.analyse(rings, o.dir, o.joint || null, 1000);
        if (!an) continue;
        var d2 = new Float32Array(plane), m2 = new Uint8Array(plane);
        var scr = CLW.Screen.toGrid(an, g2, d2, m2);
        put2D(d2, k3, function (id, val) { if (val > 0 && !(G.flags[id] & 1)) G.drag[id] += val; });
        G.layers[k3] = { screens: scr, mask: m2, rings: rings.length };
        nScr++;
      }
    }
    G.screenLayers = nScr;
    G.ms = Math.round(performance.now() - t0);
    return G;
  };

  // couche k → données d'affichage en convention 2D du plan (j vers le bas)
  V.layer2D = function (G, k) {
    var nx = G.nx, ny = G.ny, plane = nx * ny, solid = new Uint8Array(plane), drag = new Float32Array(plane), nb = 0;
    for (var j2 = 0; j2 < ny; j2++) { var j3 = ny - 1 - j2; for (var i = 0; i < nx; i++) {
      var id = k * plane + j3 * nx + i, s = (G.flags[id] & 1) ? 1 : 0; solid[j2 * nx + i] = s; nb += s; drag[j2 * nx + i] = G.drag[id]; } }
    // écran le plus proche en hauteur
    var L = null; for (var d = 0; d <= 3 && !L; d++) L = G.layers[k - d] || G.layers[k + d] || null;
    return { solid: solid, drag: drag, builtFrac: nb / plane, screens: L ? L.screens : null, screenMask: L ? L.mask : null, screenMode: L ? 'porous' : null, screenThick: 0, screenCount: L ? L.rings : 0 };
  };
  V.fillMesh = fillMesh; V.sliceMesh = sliceMesh; V.shiftMesh = shiftMesh;
  V.kOf = function (G, z) { return Math.max(1, Math.min(G.nz - 1, Math.round(z / G.dx + 0.5))); };
})(typeof window !== 'undefined' ? window : globalThis);
