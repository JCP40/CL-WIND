/* CL-WIND - raster.js
 * Grille de calcul, rasterisation des obstacles et préparation du réseau D2Q9.
 * Coordonnées du plan : mètres, x vers l'est, y vers le nord, origine au centre du domaine.
 * Coordonnées de la grille : i vers la droite, j vers le bas (écran).
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};

  CLW.LBM = {
    U_LAT: 0.08,
    TAU0: 0.51,
    CS: 0.2,
    GAM: 0.05,
    L_RAPPEL: 120,      // m, longueur de rappel vers le vent libre (valeur de réglage, non calibrée)
    TREE_A: 0.15,       // 1/m, densité de feuillage par défaut
    // Rapide, Normale, Fine, Très fine, Détail, Détail max, Ultra (plus grand côté, en cellules)
    MAX_GPU: [256, 512, 768, 1024, 1536, 2048, 3072],
    MAX_CPU: [96, 160, 224, 256, 288, 320, 352],
    GPU_MAX_CELLS: 3072 * 3072 // réduit d'après la mémoire de la carte à la création du solveur
  };

  // ---------------------------------------------------------------- grille
  CLW.makeGrid = function (W, H, resIndex, gpu) {
    var list = gpu ? CLW.LBM.MAX_GPU : CLW.LBM.MAX_CPU;
    var nmax = list[Math.min(resIndex, list.length - 1)], want = nmax;
    // la carte doit tenir 9 populations × N cellules dans un seul tampon
    if (gpu) {
      var asp = Math.min(W, H) / Math.max(W, H);
      nmax = Math.min(nmax, Math.floor(Math.sqrt(CLW.LBM.GPU_MAX_CELLS / asp)));
    }
    var dx = Math.max(W, H) / nmax;
    var nx = Math.max(8, Math.round(W / dx));
    var ny = Math.max(8, Math.round(H / dx));
    return { W: W, H: H, nx: nx, ny: ny, dx: dx, x0: -W / 2, y0: H / 2, memCapped: nmax < want };
  };
  // centre de la cellule (i, j) en mètres
  CLW.cellX = function (g, i) { return g.x0 + (i + 0.5) * g.dx; };
  CLW.cellY = function (g, j) { return g.y0 - (j + 0.5) * g.dx; };

  // ---------------------------------------------------------------- géométrie
  var geom = CLW.geom = {};
  geom.bbox = function (pts, b) {
    b = b || [Infinity, Infinity, -Infinity, -Infinity];
    for (var k = 0; k < pts.length; k++) {
      var p = pts[k];
      if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1];
      if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1];
    }
    return b;
  };
  geom.objBBox = function (o, b) {
    b = b || [Infinity, Infinity, -Infinity, -Infinity];
    if (o.type === 'building') geom.bbox(o.outer, b);
    else if (o.type === 'wall') {
      geom.bbox(o.pts, b);
      var t = (o.thick || 0.3) / 2; b[0] -= t; b[1] -= t; b[2] += t; b[3] += t;
    } else if (o.type === 'tree') {
      geom.bbox([[o.x - o.r, o.y - o.r], [o.x + o.r, o.y + o.r]], b);
    }
    return b;
  };
  geom.area = function (ring) {
    var a = 0;
    for (var k = 0, n = ring.length; k < n; k++) {
      var p = ring[k], q = ring[(k + 1) % n];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  };
  geom.pointInRings = function (x, y, rings) {
    var inside = false;
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      for (var a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        var pa = ring[a], pb = ring[b];
        if ((pa[1] > y) !== (pb[1] > y) &&
            x < (pb[0] - pa[0]) * (y - pa[1]) / (pb[1] - pa[1]) + pa[0]) inside = !inside;
      }
    }
    return inside;
  };
  geom.distSeg = function (px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    var ex = ax + t * dx - px, ey = ay + t * dy - py;
    return Math.sqrt(ex * ex + ey * ey);
  };
  // Douglas-Peucker
  geom.simplify = function (pts, tol, closed) {
    if (pts.length < 4) return pts.slice();
    var keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
    var stack = [[0, pts.length - 1]];
    while (stack.length) {
      var s = stack.pop(), a = s[0], b = s[1], dmax = -1, idx = -1;
      for (var k = a + 1; k < b; k++) {
        var d = geom.distSeg(pts[k][0], pts[k][1], pts[a][0], pts[a][1], pts[b][0], pts[b][1]);
        if (d > dmax) { dmax = d; idx = k; }
      }
      if (dmax > tol) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
    }
    var out = [];
    for (var m = 0; m < pts.length; m++) if (keep[m]) out.push(pts[m]);
    if (closed && out.length < 4) return pts.slice();
    return out;
  };

  // ---------------------------------------------------------------- écrans poreux
  // Des éléments trop fins pour la grille (briques, lames, claustras) sont remplacés par une bande
  // poreuse homogène. Leurs sections sont soudées par une fermeture morphologique de rayon « joint »
  // sur une grille fine (bandes connexes, épaisseur W, longueur L = aire / W). La porosité φ d'une
  // bande est la somme des cols (distance minimale entre deux éléments voisins, voisins reliés par
  // l'arbre couvrant minimal) divisée par L : c'est la section la plus étroite des passages, celle qui
  // fixe la perte de charge, exacte pour des lattes, des briques profondes ou des lames à tout angle
  // (col = pas × cos(angle) − épaisseur). Elle est convertie en perte de charge
  //   K = (0,707 √(1-φ) + 1 - φ)² / φ²   (grille mince à arêtes vives, Idelchik)
  // appliquée comme une traînée quadratique a = K / (2 W) : la perte de pression à la traversée vaut
  // alors K ½ ρ U², quelle que soit la grille de calcul.
  var SCR = CLW.Screen = {};
  SCR.lossK = function (phi) {
    phi = Math.min(0.98, Math.max(0.01, phi));
    var t = 0.707 * Math.sqrt(1 - phi) + 1 - phi;
    return t * t / (phi * phi);
  };
  // distance minimale entre deux polygones (sommets contre segments, dans les deux sens), 0 s'ils se coupent
  function polyDist(A, B) {
    var m = Infinity, i, j, n;
    for (i = 0; i < A.length; i++) for (j = 0, n = B.length; j < n; j++) {
      var d = geom.distSeg(A[i][0], A[i][1], B[j][0], B[j][1], B[(j + 1) % n][0], B[(j + 1) % n][1]);
      if (d < m) m = d;
    }
    for (i = 0; i < B.length; i++) for (j = 0, n = A.length; j < n; j++) {
      var d2 = geom.distSeg(B[i][0], B[i][1], A[j][0], A[j][1], A[(j + 1) % n][0], A[(j + 1) % n][1]);
      if (d2 < m) m = d2;
    }
    if (geom.pointInRings(A[0][0], A[0][1], [B]) || geom.pointInRings(B[0][0], B[0][1], [A])) m = 0;
    return m;
  }
  SCR.polyDist = polyDist;
  // arbre couvrant minimal (Prim) des centres : liste [u, v, distance des centres]
  function mst(cs) {
    var n = cs.length, inT = new Uint8Array(n), best = new Float64Array(n).fill(Infinity), from = new Int32Array(n).fill(-1), out = [];
    if (n < 2) return out;
    best[0] = 0;
    for (var it = 0; it < n; it++) {
      var u = -1;
      for (var q = 0; q < n; q++) if (!inT[q] && (u < 0 || best[q] < best[u])) u = q;
      inT[u] = 1;
      if (from[u] >= 0) out.push([from[u], u, Math.sqrt(best[u])]);
      for (var v = 0; v < n; v++) if (!inT[v]) {
        var ddx = cs[v][0] - cs[u][0], ddy = cs[v][1] - cs[u][1], d2 = ddx * ddx + ddy * ddy;
        if (d2 < best[v]) { best[v] = d2; from[v] = u; }
      }
    }
    return out;
  }
  // rings : sections des éléments (m) ; joint : rayon de soudure (m) ou null (automatique)
  SCR.analyse = function (rings, dirDeg, joint, maxFine) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    rings.forEach(function (r) { geom.bbox(r, b); });
    if (!isFinite(b[0])) return null;
    var cs = rings.map(function (r) { var q = geom.bbox(r); return [(q[0] + q[2]) / 2, (q[1] + q[3]) / 2]; });
    var tree = mst(cs);
    // joint automatique : 0,6 × le 90e centile des arêtes de l'arbre. Il relie la chaîne d'éléments
    // (même groupés par paires) sans franchir les vraies ouvertures, qui ne sont que quelques arêtes.
    if (!(joint > 0)) {
      var el = tree.map(function (e) { return e[2]; }).sort(function (a1, b1) { return a1 - b1; });
      joint = el.length ? 0.6 * el[Math.min(el.length - 1, Math.floor(0.9 * el.length))] : 0.1;
      joint = Math.min(0.5, Math.max(0.01, joint));
    }
    var pad = 2 * joint + 0.05;
    var X0 = b[0] - pad, Y1 = b[3] + pad, Wd = b[2] - b[0] + 2 * pad, Hd = b[3] - b[1] + 2 * pad;
    var h = Math.max(0.004, Math.max(Wd, Hd) / (maxFine || 1600));
    var fx = Math.ceil(Wd / h), fy = Math.ceil(Hd / h), FN = fx * fy;
    // 1. masque des éléments (remplissage par lignes, ligne j au centre y = Y1 - (j + 0,5) h)
    var sol = new Uint8Array(FN), xs = [];
    rings.forEach(function (ring) {
      var q = geom.bbox(ring);
      var j0 = Math.max(0, Math.floor((Y1 - q[3]) / h)), j1 = Math.min(fy - 1, Math.ceil((Y1 - q[1]) / h));
      for (var j = j0; j <= j1; j++) {
        var yc = Y1 - (j + 0.5) * h; xs.length = 0;
        for (var a = 0, c = ring.length - 1; a < ring.length; c = a++) {
          var pa = ring[a], pc = ring[c];
          if ((pa[1] > yc) !== (pc[1] > yc)) xs.push(pa[0] + (pc[0] - pa[0]) * (yc - pa[1]) / (pc[1] - pa[1]));
        }
        xs.sort(function (u, v) { return u - v; });
        for (var s = 0; s + 1 < xs.length; s += 2) {
          var i0 = Math.max(0, Math.round((xs[s] - X0) / h)), i1 = Math.min(fx - 1, Math.round((xs[s + 1] - X0) / h) - 1);
          if (i1 < i0) i1 = i0 = Math.min(fx - 1, Math.max(0, Math.floor(((xs[s] + xs[s + 1]) / 2 - X0) / h)));
          for (var i = i0; i <= i1; i++) sol[j * fx + i] = 1;
        }
      }
    });
    // 2. fermeture morphologique : dilatation de « joint », érosion de la moitié seulement
    // (une érosion complète recoupe la bande au milieu des joints entre éléments minces)
    function dist(mask) { // distance chanfrein (en mailles) à la plus proche maille du masque
      var D = new Float32Array(FN), INF = 1e9, i, j, k;
      for (k = 0; k < FN; k++) D[k] = mask[k] ? 0 : INF;
      for (j = 0; j < fy; j++) for (i = 0; i < fx; i++) {
        k = j * fx + i; var v = D[k];
        if (i > 0 && D[k - 1] + 1 < v) v = D[k - 1] + 1;
        if (j > 0) {
          if (D[k - fx] + 1 < v) v = D[k - fx] + 1;
          if (i > 0 && D[k - fx - 1] + 1.4142 < v) v = D[k - fx - 1] + 1.4142;
          if (i < fx - 1 && D[k - fx + 1] + 1.4142 < v) v = D[k - fx + 1] + 1.4142;
        }
        D[k] = v;
      }
      for (j = fy - 1; j >= 0; j--) for (i = fx - 1; i >= 0; i--) {
        k = j * fx + i; var w = D[k];
        if (i < fx - 1 && D[k + 1] + 1 < w) w = D[k + 1] + 1;
        if (j < fy - 1) {
          if (D[k + fx] + 1 < w) w = D[k + fx] + 1;
          if (i < fx - 1 && D[k + fx + 1] + 1.4142 < w) w = D[k + fx + 1] + 1.4142;
          if (i > 0 && D[k + fx - 1] + 1.4142 < w) w = D[k + fx - 1] + 1.4142;
        }
        D[k] = w;
      }
      return D;
    }
    var r = joint / h, D1 = dist(sol), out = new Uint8Array(FN), k;
    for (k = 0; k < FN; k++) out[k] = D1[k] > r ? 1 : 0;
    var D2 = dist(out), band = new Int32Array(FN);
    for (k = 0; k < FN; k++) band[k] = (sol[k] || D2[k] > 0.5 * r) ? -1 : 0;
    // 3. bandes connexes (4-voisinage) : aire, périmètre, épaisseur W = 2 aire / périmètre
    var comps = [], stack = [];
    for (k = 0; k < FN; k++) {
      if (band[k] !== -1) continue;
      var id = comps.length + 1, area = 0, edges = 0;
      band[k] = id; stack.push(k);
      while (stack.length) {
        var p = stack.pop(), pi = p % fx, pj = (p - pi) / fx; area++;
        var nb = [pi > 0 ? p - 1 : -1, pi < fx - 1 ? p + 1 : -1, pj > 0 ? p - fx : -1, pj < fy - 1 ? p + fx : -1];
        for (var e = 0; e < 4; e++) {
          var q2 = nb[e];
          if (q2 < 0 || band[q2] === 0) { edges++; continue; }
          if (band[q2] === -1) { band[q2] = id; stack.push(q2); }
        }
      }
      var A = area * h * h, P = edges * h * Math.PI / 4; // périmètre corrigé de l'effet d'escalier
      comps.push({ id: id, area: A, perim: P, W: P > 0 ? 2 * A / P : h, throat: 0, chain: 0, nGaps: 0 });
    }
    if (!comps.length) return null;
    function labelAt(x, y) {
      var i = Math.floor((x - X0) / h), j = Math.floor((Y1 - y) / h);
      return (i >= 0 && j >= 0 && i < fx && j < fy) ? band[j * fx + i] : 0;
    }
    // 4. cols entre éléments voisins soudés (arêtes de l'arbre dont le col est franchi par la soudure)
    var BS = Math.max(0.5, 4 * joint), bnx = Math.ceil(Wd / BS), bny = Math.ceil(Hd / BS), NB = bnx * bny;
    // longueur de bande = somme des pas (distances entre centres voisins) : φ = Σ cols / Σ pas,
    // exactement col / pas pour une rangée régulière ; W = aire de la bande / longueur
    var binT = new Float64Array(NB), binL = new Float64Array(NB);
    tree.forEach(function (e) {
      var d = polyDist(rings[e[0]], rings[e[1]]);
      if (d > 2 * joint) return; // ouverture : non soudée
      var mx = (cs[e[0]][0] + cs[e[1]][0]) / 2, my = (cs[e[0]][1] + cs[e[1]][1]) / 2;
      var lab = labelAt(cs[e[0]][0], cs[e[0]][1]) || labelAt(mx, my);
      if (lab <= 0) return;
      comps[lab - 1].throat += d; comps[lab - 1].chain += e[2]; comps[lab - 1].nGaps++;
      var bi = Math.floor((mx - X0) / BS), bj = Math.floor((Y1 - my) / BS);
      if (bi >= 0 && bj >= 0 && bi < bnx && bj < bny) { binT[bj * bnx + bi] += d; binL[bj * bnx + bi] += e[2]; }
    });
    comps.forEach(function (C) {
      C.len = C.chain > 0 ? C.chain : C.area / C.W;
      if (C.chain > 0) C.W = C.area / C.chain;
      C.phi = Math.min(0.98, C.len > 0 ? C.throat / C.len : 0);
      C.K = SCR.lossK(C.phi);
      C.nCross = C.nGaps;
    });
    // porosité locale (3 × 3 cases de BS mètres), repli sur celle de la bande
    function phiAt(x, y, lab) {
      var C = comps[lab - 1], bi3 = Math.floor((x - X0) / BS), bj3 = Math.floor((Y1 - y) / BS), st = 0, sa = 0;
      for (var dj = -1; dj <= 1; dj++) for (var di = -1; di <= 1; di++) {
        var u2 = bi3 + di, v2 = bj3 + dj;
        if (u2 < 0 || v2 < 0 || u2 >= bnx || v2 >= bny) continue;
        st += binT[v2 * bnx + u2]; sa += binL[v2 * bnx + u2];
      }
      return sa > 2 * BS ? Math.min(0.98, st / sa) : C.phi;
    }
    return { comps: comps, band: band, fx: fx, fy: fy, h: h, X0: X0, Y1: Y1, joint: joint, phiAt: phiAt };
  };
  var scrCache = { key: null, res: null };
  SCR.analyseCached = function (rings, dirDeg, joint) {
    var key = joint + '|' + rings.length + '|' + rings.map(function (r) { return r.length + ':' + r[0][0].toFixed(3) + ',' + r[0][1].toFixed(3); }).join(';');
    if (scrCache.key !== key) { scrCache.key = key; scrCache.res = SCR.analyse(rings, dirDeg, joint); }
    return scrCache.res;
  };

  // bande analysée (an) → grille g (convention 2D : j vers le bas depuis g.y0) : ajoute la traînée
  // a = K(φ local) / (2 Wr) × dx dans drag, marque mask, renvoie les écrans (φ, K, épaisseurs)
  SCR.toGrid = function (an, g, drag, mask) {
    var nx = g.nx, ny = g.ny, dx = g.dx, N = nx * ny;
    var lab = new Int32Array(N), cnt = new Float64Array(an.comps.length + 1);
    for (var fj = 0; fj < an.fy; fj++) {
      var yy = an.Y1 - (fj + 0.5) * an.h, cj = Math.floor((g.y0 - yy) / dx);
      if (cj < 0 || cj >= ny) continue;
      for (var fi = 0; fi < an.fx; fi++) {
        var L = an.band[fj * an.fx + fi]; if (L <= 0) continue;
        var ci = Math.floor((an.X0 + (fi + 0.5) * an.h - g.x0) / dx);
        if (ci < 0 || ci >= nx) continue;
        var cid = cj * nx + ci;
        if (!lab[cid]) { lab[cid] = L; cnt[L]++; }
      }
    }
    var screens = an.comps.map(function (C) {
      var Wr = C.len > 0 ? cnt[C.id] * dx * dx / C.len : C.W;
      Wr = Math.max(Wr, C.W);
      return { phi: C.phi, K: C.K, W: C.W, Wr: Wr, a: C.K / (2 * Wr), area: C.area, nCross: C.nCross, joint: an.joint, phiMin: 1, phiMax: 0 };
    });
    // perte de charge locale : porosité de la zone (≈ 0,5 m) où tombe la cellule
    for (var sc = 0; sc < N; sc++) if (lab[sc]) {
      var Sx = screens[lab[sc] - 1], sci = sc % nx, scj = (sc - sci) / nx;
      var ph = an.phiAt(CLW.cellX(g, sci), CLW.cellY(g, scj), lab[sc]);
      if (ph < Sx.phiMin) Sx.phiMin = ph;
      if (ph > Sx.phiMax) Sx.phiMax = ph;
      drag[sc] += SCR.lossK(ph) / (2 * Sx.Wr) * dx; mask[sc] = 1;
    }
    return screens;
  };

  // ---------------------------------------------------------------- rasterisation
  // Renvoie { solid: Uint8Array, drag: Float32Array (1/cellule), builtFrac, screens, screenMask }
  // opts.dir : direction du vent « venant de », nécessaire aux écrans poreux
  CLW.rasterize = function (objects, g, opts) {
    opts = opts || {};
    var nx = g.nx, ny = g.ny, dx = g.dx, N = nx * ny;
    var solid = new Uint8Array(N), drag = new Float32Array(N);
    var xs = [];
    var scrRings = [], scrJoint = null;
    // écrans : pleins résolus si leurs éléments font au moins une cellule d'épaisseur (mode auto),
    // sinon bande poreuse. Épaisseur d'un élément ≈ 2 aire / périmètre (lame, brique allongée).
    var scrAll = objects.filter(function (o) { return o.type === 'building' && o.screen; });
    var scrMode = 'porous', tMed = 0;
    if (scrAll.length) {
      var th = scrAll.map(function (o) {
        var r = o.outer, P = 0;
        for (var a = 0; a < r.length; a++) { var q = r[(a + 1) % r.length]; P += Math.hypot(q[0] - r[a][0], q[1] - r[a][1]); }
        return P > 0 ? 2 * Math.abs(geom.area(r)) / P : 0; // rectangle w × t : 2A/P = wt/(w+t) ≈ t
      }).sort(function (u, v) { return u - v; });
      tMed = th[th.length >> 1];
      scrMode = opts.scrMode === 'solid' ? 'solid' : opts.scrMode === 'porous' ? 'porous' : (tMed >= dx ? 'solid' : 'porous');
    }
    for (var n = 0; n < objects.length; n++) {
      var o = objects[n];
      if (o.type === 'building' && o.screen && scrMode === 'porous') {
        scrRings.push(o.outer);
        if (o.joint > 0) scrJoint = o.joint;
        continue;
      }
      if (o.type === 'building' && o.screen) {
        // élément plein résolu ; s'il est plus fin qu'une cellule, il est élargi pour en occuper au moins une
        var ring0 = o.outer, Pp = 0;
        for (var a0 = 0; a0 < ring0.length; a0++) { var q0 = ring0[(a0 + 1) % ring0.length]; Pp += Math.hypot(q0[0] - ring0[a0][0], q0[1] - ring0[a0][1]); }
        var tEl = Pp > 0 ? 2 * Math.abs(geom.area(ring0)) / Pp : 0, grow = Math.max(0, 0.71 * dx - tEl / 2);
        var bb0 = geom.bbox(ring0);
        var ei0 = Math.max(0, Math.floor((bb0[0] - grow - g.x0) / dx - 0.5)), ei1 = Math.min(nx - 1, Math.ceil((bb0[2] + grow - g.x0) / dx - 0.5));
        var ej0 = Math.max(0, Math.floor((g.y0 - bb0[3] - grow) / dx - 0.5)), ej1 = Math.min(ny - 1, Math.ceil((g.y0 - bb0[1] + grow) / dx - 0.5));
        for (var ej = ej0; ej <= ej1; ej++) for (var ei = ei0; ei <= ei1; ei++) {
          var ecx = CLW.cellX(g, ei), ecy = CLW.cellY(g, ej), hit = geom.pointInRings(ecx, ecy, [ring0]);
          if (!hit && grow > 0) for (var s0 = 0; s0 < ring0.length && !hit; s0++) {
            var A0 = ring0[s0], B0 = ring0[(s0 + 1) % ring0.length];
            if (geom.distSeg(ecx, ecy, A0[0], A0[1], B0[0], B0[1]) <= grow) hit = true;
          }
          if (hit) solid[ej * nx + ei] = 1;
        }
        continue;
      }
      if (o.type === 'building') {
        var rings = [o.outer].concat(o.holes || []);
        var b = geom.bbox(o.outer);
        var j0 = Math.max(0, Math.ceil((g.y0 - b[3]) / dx - 0.5));
        var j1 = Math.min(ny - 1, Math.floor((g.y0 - b[1]) / dx - 0.5));
        for (var j = j0; j <= j1; j++) {
          var yc = CLW.cellY(g, j);
          xs.length = 0;
          for (var r = 0; r < rings.length; r++) {
            var ring = rings[r];
            for (var a = 0, c = ring.length - 1; a < ring.length; c = a++) {
              var pa = ring[a], pc = ring[c];
              if ((pa[1] > yc) !== (pc[1] > yc))
                xs.push(pa[0] + (pc[0] - pa[0]) * (yc - pa[1]) / (pc[1] - pa[1]));
            }
          }
          xs.sort(function (u, v) { return u - v; });
          for (var q = 0; q + 1 < xs.length; q += 2) {
            var i0 = Math.max(0, Math.ceil((xs[q] - g.x0) / dx - 0.5));
            var i1 = Math.min(nx - 1, Math.floor((xs[q + 1] - g.x0) / dx - 0.5));
            for (var i = i0; i <= i1; i++) solid[j * nx + i] = 1;
          }
        }
      } else if (o.type === 'wall') {
        var rad = Math.max((o.thick || 0.3) / 2, 0.5 * dx);
        for (var s = 0; s + 1 < o.pts.length; s++) {
          var A = o.pts[s], B = o.pts[s + 1];
          var wi0 = Math.max(0, Math.floor((Math.min(A[0], B[0]) - rad - g.x0) / dx - 0.5));
          var wi1 = Math.min(nx - 1, Math.ceil((Math.max(A[0], B[0]) + rad - g.x0) / dx - 0.5));
          var wj0 = Math.max(0, Math.floor((g.y0 - Math.max(A[1], B[1]) - rad) / dx - 0.5));
          var wj1 = Math.min(ny - 1, Math.ceil((g.y0 - Math.min(A[1], B[1]) + rad) / dx - 0.5));
          for (var wj = wj0; wj <= wj1; wj++) {
            var wy = CLW.cellY(g, wj);
            for (var wi = wi0; wi <= wi1; wi++) {
              if (geom.distSeg(CLW.cellX(g, wi), wy, A[0], A[1], B[0], B[1]) <= rad + 1e-9)
                solid[wj * nx + wi] = 1;
            }
          }
        }
      }
    }
    // arbres : traînée a × taille de cellule
    for (var t = 0; t < objects.length; t++) {
      var tr = objects[t];
      if (tr.type !== 'tree' || tr.noCut) continue; // houppier (ou plante) hors de la hauteur de coupe : pas dans le plan
      var aa = (tr.a != null ? tr.a : CLW.LBM.TREE_A) * dx, R = tr.r;
      var ti0 = Math.max(0, Math.floor((tr.x - R - g.x0) / dx - 0.5));
      var ti1 = Math.min(nx - 1, Math.ceil((tr.x + R - g.x0) / dx - 0.5));
      var tj0 = Math.max(0, Math.floor((g.y0 - tr.y - R) / dx - 0.5));
      var tj1 = Math.min(ny - 1, Math.ceil((g.y0 - tr.y + R) / dx - 0.5));
      var hit = 0;
      for (var tj = tj0; tj <= tj1; tj++) for (var ti = ti0; ti <= ti1; ti++) {
        var ex = CLW.cellX(g, ti) - tr.x, ey = CLW.cellY(g, tj) - tr.y;
        if (ex * ex + ey * ey <= R * R) { drag[tj * nx + ti] += aa; hit++; }
      }
      // colonne plus fine qu'une cellule (plantes grimpantes) : traînée de la cellule qui la contient, au prorata de la surface
      if (!hit) {
        var ci = Math.floor((tr.x - g.x0) / dx), cj = Math.floor((g.y0 - tr.y) / dx);
        if (ci >= 0 && cj >= 0 && ci < nx && cj < ny) drag[cj * nx + ci] += aa * Math.min(1, Math.PI * R * R / (dx * dx));
      }
    }
    // fermeture des fentes d'une seule cellule (bâtiments mitoyens mal jointifs)
    if (opts.closeSlits !== false) {
      var add = [];
      for (var jj = 0; jj < ny; jj++) for (var ii = 0; ii < nx; ii++) {
        var id = jj * nx + ii;
        if (solid[id]) continue;
        var h = ii > 0 && ii < nx - 1 && solid[id - 1] && solid[id + 1];
        var v = jj > 0 && jj < ny - 1 && solid[id - nx] && solid[id + nx];
        if (h || v) add.push(id);
      }
      for (var z = 0; z < add.length; z++) solid[add[z]] = 1;
    }
    // écrans poreux : une cellule appartient à la bande si une maille fine de la bande tombe dedans ;
    // la traînée est rapportée à l'épaisseur de bande effectivement rasterisée (aire / demi-périmètre)
    var screens = null, screenMask = null;
    if (scrRings.length) {
      var an = SCR.analyseCached(scrRings, opts.dir != null ? opts.dir : 270, scrJoint);
      if (an) { screenMask = new Uint8Array(N); screens = SCR.toGrid(an, g, drag, screenMask); }
    }
    var nb = 0;
    for (var m = 0; m < N; m++) { if (solid[m]) { nb++; drag[m] = 0; } }
    return { solid: solid, drag: drag, builtFrac: nb / N, screens: screens, screenMask: screenMask,
      screenMode: scrAll.length ? scrMode : null, screenThick: tMed, screenCount: scrAll.length };
  };

  // Fraction maximale de la largeur barrée face au vent (sur une section perpendiculaire)
  CLW.blockage = function (solid, nx, ny, wux, wuy) {
    var best = 0, i, j, c;
    if (Math.abs(wux) >= Math.abs(wuy)) {
      for (i = 0; i < nx; i++) { c = 0; for (j = 0; j < ny; j++) c += solid[j * nx + i]; if (c / ny > best) best = c / ny; }
    } else {
      for (j = 0; j < ny; j++) { c = 0; for (i = 0; i < nx; i++) c += solid[j * nx + i]; if (c / nx > best) best = c / nx; }
    }
    return best;
  };

  // ---------------------------------------------------------------- réseau D2Q9
  CLW.D2Q9 = {
    EX: [0, 1, 0, -1, 0, 1, -1, -1, 1],
    EY: [0, 0, 1, 0, -1, 1, 1, -1, -1],
    W: [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36],
    OPP: [0, 3, 4, 1, 2, 7, 8, 5, 6]
  };

  CLW.windLattice = function (dirDeg) {
    var U = CLW.LBM.U_LAT, th = dirDeg * Math.PI / 180;
    var wx = -Math.sin(th) * U, wy = Math.cos(th) * U;
    if (Math.abs(wx) < 1e-12) wx = 0; if (Math.abs(wy) < 1e-12) wy = 0;
    return [wx, wy];
  };

  /* Prépare tout ce que les deux solveurs consomment, à l'identique :
   *  cell   : Float32 N, -1 = plein, sinon traînée d
   *  src    : Int32 9N, source de la population k : >=0 indice de cellule, -1 rebond, -2 entrée (équilibre du vent)
   *  sponge : Float32 2N, (sIn, sOut)
   */
  CLW.buildLattice = function (g, rast, dirDeg, opts) {
    opts = opts || {};
    var L = CLW.LBM, Q = CLW.D2Q9, U = L.U_LAT;
    var nx = g.nx, ny = g.ny, N = nx * ny;
    var w = CLW.windLattice(dirDeg), wux = w[0], wuy = w[1];
    var inL = wux > 0.2 * U, inR = -wux > 0.2 * U, inT = wuy > 0.2 * U, inB = -wuy > 0.2 * U;
    var cell = new Float32Array(N);
    for (var i = 0; i < N; i++) cell[i] = rast.solid[i] ? -1 : rast.drag[i];
    var src = new Int32Array(9 * N);
    for (var y = 0; y < ny; y++) for (var x = 0; x < nx; x++) {
      var id = y * nx + x;
      for (var k = 0; k < 9; k++) {
        var sx = x - Q.EX[k], sy = y - Q.EY[k], v;
        if (sx >= 0 && sx < nx && sy >= 0 && sy < ny) {
          var j = sy * nx + sx;
          v = rast.solid[j] ? -1 : j;
        } else if ((sx < 0 && inL) || (sx >= nx && inR) || (sy < 0 && inT) || (sy >= ny && inB)) {
          v = -2;
        } else {
          // côté ouvert : recopie la population de la cellule intérieure voisine
          var cx = sx < 0 ? 0 : sx >= nx ? nx - 1 : sx;
          var cy = sy < 0 ? 0 : sy >= ny ? ny - 1 : sy;
          var jc = cy * nx + cx;
          v = rast.solid[jc] ? id : jc;
        }
        src[k * N + id] = v;
      }
    }
    var sponge = new Float32Array(2 * N);
    var Tx = Math.max(8, 0.07 * nx), Ty = Math.max(8, 0.07 * ny);
    function sp(d, T) { if (d >= T) return 0; var a = 1 - d / T; return 0.5 * a * a; }
    for (var yy = 0; yy < ny; yy++) for (var xx = 0; xx < nx; xx++) {
      var sIn = 0, sOut = 0, s;
      s = sp(xx, Tx); if (inL) sIn = Math.max(sIn, s); else sOut = Math.max(sOut, s);
      s = sp(nx - 1 - xx, Tx); if (inR) sIn = Math.max(sIn, s); else sOut = Math.max(sOut, s);
      s = sp(yy, Ty); if (inT) sIn = Math.max(sIn, s); else sOut = Math.max(sOut, s);
      s = sp(ny - 1 - yy, Ty); if (inB) sIn = Math.max(sIn, s); else sOut = Math.max(sOut, s);
      var q = yy * nx + xx;
      sponge[2 * q] = sIn; sponge[2 * q + 1] = sOut;
    }
    return {
      nx: nx, ny: ny, N: N, cell: cell, src: src, sponge: sponge,
      wux: wux, wuy: wuy,
      lam: opts.lam != null ? opts.lam : U * g.dx / L.L_RAPPEL,
      gam: opts.gam != null ? opts.gam : L.GAM,
      tau0: L.TAU0, cs2: L.CS * L.CS
    };
  };

  // nombre de traversées
  CLW.traversals = function (steps, nx, ny, wux, wuy) {
    var U = CLW.LBM.U_LAT;
    return steps * U * U / (nx * Math.abs(wux) + ny * Math.abs(wuy));
  };
})(typeof window !== 'undefined' ? window : globalThis);
