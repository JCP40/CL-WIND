/* CL-WIND - import3dm.js
 * Import d'un fichier Rhino .3dm, sans Rhino : la bibliothèque rhino3dm (js/lib/rhino3dm, sinon le CDN jsDelivr)
 * lit le fichier dans le navigateur. Le modèle devient la même scène que celle envoyée par le composant
 * Grasshopper « CL-WIND Live » : coupes horizontales en plan (volumes pleins et éléments d'écran poreux),
 * maillages 3D pour le calcul 3D, le soleil et le zoom. Choix de l'usage calque par calque.
 *
 * Maillages : ceux que Rhino enregistre avec les objets (maillages de rendu). S'il n'y en a pas (fichier
 * enregistré « petit », objets jamais affichés en ombré), chaque face est remaillée ici : faces planes
 * d'après leurs arêtes (trous compris), faces courbes par une grille sur la surface (sans les découpes).
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var I3 = CLW.Import3dm = {};
  var VERSION = '8.35.0';
  var LOCAL = 'js/lib/rhino3dm/', CDN = 'https://cdn.jsdelivr.net/npm/rhino3dm@' + VERSION + '/';
  var MAX_BYTES = 200 * 1024 * 1024;

  function $(id) { return document.getElementById(id); }
  function status(t, cls) { var el = $('imp-status'); if (el) { el.textContent = t; el.className = 'status' + (cls ? ' ' + cls : ''); } }
  function opt(html) { $('imp-options').innerHTML = html; }
  function esc(s) { return CLW.esc ? CLW.esc(s) : String(s); }
  function fmt(x, d) { return CLW.fmt ? CLW.fmt(x, d) : (+x).toFixed(d); }

  // ------------------------------------------------------------------ chargement de rhino3dm
  var libPromise = null;
  function addScript(src) {
    return new Promise(function (ok, ko) {
      var s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = ok; s.onerror = function () { s.remove(); ko(new Error('script ' + src)); };
      document.head.appendChild(s);
    });
  }
  async function tryBase(base) {
    if (typeof root.rhino3dm !== 'function') await addScript(base + 'rhino3dm.min.js');
    return await root.rhino3dm({ locateFile: function (f) { return base + f; } });
  }
  I3.load = function () {
    if (libPromise) return libPromise;
    // page ouverte par double-clic (file://) : le navigateur refuse de lire le .wasm local, on passe par le CDN
    var bases = location.protocol === 'file:' ? [CDN] : [LOCAL, CDN];
    libPromise = (async function () {
      var err = null;
      for (var i = 0; i < bases.length; i++) {
        try { var rh = await tryBase(bases[i]); I3.source = bases[i] === CDN ? 'CDN' : 'copie locale'; return rh; }
        catch (e) { err = e; }
      }
      libPromise = null;
      throw new Error('Bibliothèque rhino3dm introuvable (copie locale js/lib/rhino3dm et CDN). Vérifiez la connexion internet, ou ouvrez CL-WIND par LANCER-CL-WIND.bat.');
    })();
    return libPromise;
  };

  // ------------------------------------------------------------------ unités
  // valeurs de ON::LengthUnitSystem
  var UNIT = { 0: 1, 1: 1e-6, 2: 0.001, 3: 0.01, 4: 1, 5: 1000, 6: 2.54e-8, 7: 2.54e-5, 8: 0.0254, 9: 0.3048, 10: 1609.344,
    12: 1e-10, 13: 1e-9, 14: 0.1, 15: 10, 16: 100, 19: 0.9144 };
  var UNIT_NAME = { 0: 'sans unité (lu en mètres)', 1: 'micromètres', 2: 'millimètres', 3: 'centimètres', 4: 'mètres', 5: 'kilomètres',
    8: 'pouces', 9: 'pieds', 14: 'décimètres', 19: 'yards' };
  function unitOf(doc) {
    var u = doc.settings().modelUnitSystem, v = u && u.value != null ? u.value : u;
    return { k: UNIT[v] != null ? UNIT[v] : 1, name: UNIT_NAME[v] || ('code ' + v + ', lu en mètres'), code: v };
  }

  // ------------------------------------------------------------------ triangulation d'un polygone plan à trous (earcut simplifié)
  // pts : [x, y] ; holes : liste de polygones ; renvoie des indices dans la liste concaténée (contour puis trous)
  function earcut(outer, holes) {
    var data = [], holeIdx = [];
    outer.forEach(function (p) { data.push(p[0], p[1]); });
    holes.forEach(function (h) { holeIdx.push(data.length / 2); h.forEach(function (p) { data.push(p[0], p[1]); }); });
    var tris = [];
    var outerNode = linked(data, 0, outer.length * 2, true);
    if (!outerNode || outerNode.next === outerNode.prev) return tris;
    if (holeIdx.length) outerNode = eliminateHoles(data, holeIdx, outerNode);
    earcutLinked(outerNode, tris, 0);
    return tris;
  }
  function Node(i, x, y) { this.i = i; this.x = x; this.y = y; this.prev = null; this.next = null; this.steiner = false; }
  function insert(i, x, y, last) {
    var p = new Node(i, x, y);
    if (!last) { p.prev = p; p.next = p; } else { p.next = last.next; p.prev = last; last.next.prev = p; last.next = p; }
    return p;
  }
  function removeN(p) { p.next.prev = p.prev; p.prev.next = p.next; }
  function signedArea(data, s, e) { var sum = 0; for (var i = s, j = e - 2; i < e; i += 2) { sum += (data[j] - data[i]) * (data[i + 1] + data[j + 1]); j = i; } return sum; }
  function linked(data, s, e, clockwise) {
    var last = null, i;
    if (clockwise === (signedArea(data, s, e) > 0)) for (i = s; i < e; i += 2) last = insert(i / 2, data[i], data[i + 1], last);
    else for (i = e - 2; i >= s; i -= 2) last = insert(i / 2, data[i], data[i + 1], last);
    if (last && equals(last, last.next)) { removeN(last); last = last.next; }
    return last;
  }
  function equals(a, b) { return a.x === b.x && a.y === b.y; }
  function area(p, q, r) { return (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y); }
  function filterPoints(start, end) {
    if (!start) return start;
    if (!end) end = start;
    var p = start, again;
    do {
      again = false;
      if (!p.steiner && (equals(p, p.next) || area(p.prev, p, p.next) === 0)) {
        removeN(p); p = end = p.prev;
        if (p === p.next) break;
        again = true;
      } else p = p.next;
    } while (again || p !== end);
    return end;
  }
  function pointInTriangle(ax, ay, bx, by, cx, cy, px, py) {
    return (cx - px) * (ay - py) >= (ax - px) * (cy - py) && (ax - px) * (by - py) >= (bx - px) * (ay - py) && (bx - px) * (cy - py) >= (cx - px) * (by - py);
  }
  function isEar(ear) {
    var a = ear.prev, b = ear, c = ear.next;
    if (area(a, b, c) >= 0) return false;
    var p = ear.next.next;
    while (p !== ear.prev) {
      if (pointInTriangle(a.x, a.y, b.x, b.y, c.x, c.y, p.x, p.y) && area(p.prev, p, p.next) >= 0) return false;
      p = p.next;
    }
    return true;
  }
  function earcutLinked(ear, tris, pass) {
    if (!ear) return;
    var stop = ear, prev, next, guard = 0;
    while (ear.prev !== ear.next && guard++ < 1e6) {
      prev = ear.prev; next = ear.next;
      if (isEar(ear)) {
        tris.push(prev.i, ear.i, next.i);
        removeN(ear);
        ear = next.next; stop = next.next;
        continue;
      }
      ear = next;
      if (ear === stop) {
        if (!pass) earcutLinked(filterPoints(ear), tris, 1);
        else if (pass === 1) { ear = cureLocal(filterPoints(ear), tris); earcutLinked(ear, tris, 2); }
        break;
      }
    }
  }
  function intersects(p1, q1, p2, q2) {
    var o1 = Math.sign(area(p1, q1, p2)), o2 = Math.sign(area(p1, q1, q2)), o3 = Math.sign(area(p2, q2, p1)), o4 = Math.sign(area(p2, q2, q1));
    return o1 !== o2 && o3 !== o4;
  }
  function locallyInside(a, b) {
    return area(a.prev, a, a.next) < 0 ? area(a, b, a.next) >= 0 && area(a, a.prev, b) >= 0 : area(a, b, a.prev) < 0 || area(a, a.next, b) < 0;
  }
  function cureLocal(start, tris) {
    var p = start;
    do {
      var a = p.prev, b = p.next.next;
      if (!equals(a, b) && intersects(a, p, p.next, b) && locallyInside(a, b) && locallyInside(b, a)) {
        tris.push(a.i, p.i, b.i); removeN(p); removeN(p.next); p = start = b;
      }
      p = p.next;
    } while (p !== start);
    return filterPoints(p);
  }
  function eliminateHoles(data, holeIdx, outerNode) {
    var queue = [], i, len = holeIdx.length;
    for (i = 0; i < len; i++) {
      var s = holeIdx[i] * 2, e = i < len - 1 ? holeIdx[i + 1] * 2 : data.length;
      var list = linked(data, s, e, false);
      if (!list) continue;
      if (list === list.next) list.steiner = true;
      var left = list, p = list;
      do { if (p.x < left.x || (p.x === left.x && p.y < left.y)) left = p; p = p.next; } while (p !== list);
      queue.push(left);
    }
    queue.sort(function (a, b) { return a.x - b.x; });
    for (i = 0; i < queue.length; i++) outerNode = eliminateHole(queue[i], outerNode);
    return outerNode;
  }
  function eliminateHole(hole, outerNode) {
    var bridge = findHoleBridge(hole, outerNode);
    if (!bridge) return outerNode;
    var bridgeReverse = splitPolygon(bridge, hole);
    filterPoints(bridgeReverse, bridgeReverse.next);
    return filterPoints(bridge, bridge.next);
  }
  function findHoleBridge(hole, outerNode) {
    var p = outerNode, hx = hole.x, hy = hole.y, qx = -Infinity, m = null;
    do {
      if (hy <= p.y && hy >= p.next.y && p.next.y !== p.y) {
        var x = p.x + (hy - p.y) * (p.next.x - p.x) / (p.next.y - p.y);
        if (x <= hx && x > qx) { qx = x; m = p.x < p.next.x ? p : p.next; if (x === hx) return m; }
      }
      p = p.next;
    } while (p !== outerNode);
    if (!m) return null;
    var stop = m, mx = m.x, my = m.y, tanMin = Infinity, tan;
    p = m;
    do {
      if (hx >= p.x && p.x >= mx && hx !== p.x && pointInTriangle(hy < my ? hx : qx, hy, mx, my, hy < my ? qx : hx, hy, p.x, p.y)) {
        tan = Math.abs(hy - p.y) / (hx - p.x);
        if (locallyInside(p, hole) && (tan < tanMin || (tan === tanMin && p.x > m.x))) { m = p; tanMin = tan; }
      }
      p = p.next;
    } while (p !== stop);
    return m;
  }
  function splitPolygon(a, b) {
    var a2 = new Node(a.i, a.x, a.y), b2 = new Node(b.i, b.x, b.y), an = a.next, bp = b.prev;
    a.next = b; b.prev = a; a2.next = an; an.prev = a2; b2.next = a2; a2.prev = b2; bp.next = b2; b2.prev = bp;
    return b2;
  }

  // ------------------------------------------------------------------ maillages
  // accumulateur de triangles (coordonnées du fichier, non converties)
  function Acc() { this.v = []; this.f = []; }
  Acc.prototype.addMesh = function (m) {
    var vs = m.vertices(), fs = m.faces(), nv = vs.count, nf = fs.count, o = this.v.length / 3, i;
    for (i = 0; i < nv; i++) { var p = vs.get(i); this.v.push(p[0], p[1], p[2]); }
    for (i = 0; i < nf; i++) {
      var q = fs.get(i);
      this.f.push(o + q[0], o + q[1], o + q[2]);
      if (q[3] !== q[2]) this.f.push(o + q[0], o + q[2], o + q[3]);
    }
    return nf;
  };
  Acc.prototype.addTri = function (P) { // P : liste de points 3D, triangles par 3
    var o = this.v.length / 3;
    for (var i = 0; i < P.length; i++) this.v.push(P[i][0], P[i][1], P[i][2]);
    for (var j = 0; j + 2 < P.length; j += 3) this.f.push(o + j, o + j + 1, o + j + 2);
  };

  function curvePts(c, n) {
    var nc = null;
    try {
      nc = c.toNurbsCurve();
      if (nc && nc.degree === 1) {
        var P = nc.points(), out = [];
        for (var i = 0; i < P.count; i++) { var q = P.get(i); out.push([q[0], q[1], q[2]]); }
        nc.delete();
        return out;
      }
    } catch (e) { /* courbe non convertible : échantillonnage */ }
    if (nc && nc.delete) nc.delete();
    var d = c.domain, pts = [];
    for (var k = 0; k <= n; k++) pts.push(c.pointAt(d[0] + (d[1] - d[0]) * k / n));
    return pts;
  }
  function d2(a, b) { var x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2]; return x * x + y * y + z * z; }

  // polygone 3D d'une boucle de face : arêtes dans l'ordre de la boucle, orientées par leurs sommets
  function loopPolygon(brep, loop, V) {
    var trims = loop.trims, n = trims.count, poly = [];
    for (var t = 0; t < n; t++) {
      var tr = trims.get(t);
      if (tr.edgeIndex < 0) continue;
      var e = brep.edges().get(tr.edgeIndex), pts = curvePts(e, 24), sv = V[tr.startVertexIndex];
      if (sv && d2(pts[pts.length - 1], sv) < d2(pts[0], sv)) pts.reverse();
      for (var k = 0; k < pts.length - 1; k++) poly.push(pts[k]);
    }
    return poly;
  }
  function planarFace(brep, face, V, acc) {
    var loops = face.loops, polys = [];
    for (var l = 0; l < loops.count; l++) { var p = loopPolygon(brep, loops.get(l), V); if (p.length >= 3) polys.push(p); }
    if (!polys.length) return false;
    // plan de la face : normale de Newell du plus grand contour
    var big = 0, bestA = -1;
    var normals = polys.map(function (P, i) {
      var nx = 0, ny = 0, nz = 0;
      for (var a = 0; a < P.length; a++) {
        var p = P[a], q = P[(a + 1) % P.length];
        nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]);
      }
      var A = Math.hypot(nx, ny, nz);
      if (A > bestA) { bestA = A; big = i; }
      return [nx, ny, nz];
    });
    var N = normals[big], L = Math.hypot(N[0], N[1], N[2]) || 1;
    N = [N[0] / L, N[1] / L, N[2] / L];
    var U = Math.abs(N[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    var ux = [U[1] * N[2] - U[2] * N[1], U[2] * N[0] - U[0] * N[2], U[0] * N[1] - U[1] * N[0]], lu = Math.hypot(ux[0], ux[1], ux[2]);
    ux = [ux[0] / lu, ux[1] / lu, ux[2] / lu];
    var vy = [N[1] * ux[2] - N[2] * ux[1], N[2] * ux[0] - N[0] * ux[2], N[0] * ux[1] - N[1] * ux[0]];
    function to2(p) { return [p[0] * ux[0] + p[1] * ux[1] + p[2] * ux[2], p[0] * vy[0] + p[1] * vy[1] + p[2] * vy[2]]; }
    var outer = polys[big], holes = polys.filter(function (_, i) { return i !== big; });
    var idx = earcut(outer.map(to2), holes.map(function (h) { return h.map(to2); }));
    var all = outer.concat.apply(outer, holes), P3 = [];
    for (var i = 0; i < idx.length; i++) P3.push(all[idx[i]]);
    acc.addTri(P3);
    return idx.length > 0;
  }
  function gridFace(srf, acc, n) {
    var du = srf.domain(0), dv = srf.domain(1), P = [], i, j;
    for (i = 0; i <= n; i++) for (j = 0; j <= n; j++) P.push(srf.pointAt(du[0] + (du[1] - du[0]) * i / n, dv[0] + (dv[1] - dv[0]) * j / n));
    var T = [];
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      var a = P[i * (n + 1) + j], b = P[(i + 1) * (n + 1) + j], c = P[(i + 1) * (n + 1) + j + 1], d = P[i * (n + 1) + j + 1];
      T.push(a, b, c, a, c, d);
    }
    acc.addTri(T);
  }
  // maillage d'un brep : maillages enregistrés par face, sinon remaillage
  function brepMesh(rh, brep, acc, st) {
    var faces = brep.faces(), V = null, nf = faces.count;
    for (var i = 0; i < nf; i++) {
      var f = faces.get(i), m = null;
      try { m = f.getMesh(rh.MeshType.Any); } catch (e) { m = null; }
      if (m && m.faces().count) { acc.addMesh(m); st.cached++; m.delete(); continue; }
      if (m && m.delete) m.delete();
      st.remeshed++;
      if (!V) {
        V = [];
        var vl = brep.vertices();
        for (var k = 0; k < vl.count; k++) V.push(vl.get(k).location);
      }
      var ok = false;
      try { if (f.isPlanar()) ok = planarFace(brep, f, V, acc); } catch (e) { ok = false; }
      if (!ok) { try { gridFace(f, acc, 12); st.grid++; } catch (e2) { st.failed++; } }
    }
  }
  function geomMesh(rh, g, acc, st) {
    if (g instanceof rh.Mesh) { acc.addMesh(g); return true; }
    if (g instanceof rh.Brep) { brepMesh(rh, g, acc, st); return true; }
    if (g instanceof rh.Extrusion) {
      var m = null;
      try { m = g.getMesh(rh.MeshType.Any); } catch (e) { m = null; }
      if (m && m.faces().count) { acc.addMesh(m); st.cached++; m.delete(); return true; }
      var b = g.toBrep(true);
      if (!b) return false;
      brepMesh(rh, b, acc, st); b.delete();
      return true;
    }
    if (g instanceof rh.SubD) {
      var sm = null;
      try { sm = rh.Mesh.createFromSubDControlNet(g); } catch (e) { sm = null; }
      if (sm) { acc.addMesh(sm); sm.delete(); return true; }
      return false;
    }
    if (g instanceof rh.Surface) {
      var bs = rh.Brep.createFromSurface(g);
      if (!bs) return false;
      brepMesh(rh, bs, acc, st); bs.delete();
      return true;
    }
    return false;
  }

  // soudure des sommets (1/100 mm) : arêtes partagées entre faces maillées séparément
  function weld(acc, k) {
    var map = new Map(), V = [], remap = new Int32Array(acc.v.length / 3), q = 1e5;
    for (var i = 0; i < remap.length; i++) {
      var x = acc.v[3 * i] * k, y = acc.v[3 * i + 1] * k, z = acc.v[3 * i + 2] * k;
      var key = Math.round(x * q) + ',' + Math.round(y * q) + ',' + Math.round(z * q), id = map.get(key);
      if (id == null) { id = V.length / 3; map.set(key, id); V.push(x, y, z); }
      remap[i] = id;
    }
    var F = [];
    for (var t = 0; t < acc.f.length; t += 3) {
      var a = remap[acc.f[t]], b = remap[acc.f[t + 1]], c = remap[acc.f[t + 2]];
      if (a !== b && b !== c && a !== c) F.push(a, b, c);
    }
    return { v: V, f: F };
  }
  // maillage fermé ? (chaque arête partagée par un nombre pair de triangles)
  function isClosed(m) {
    var E = new Map();
    for (var t = 0; t < m.f.length; t += 3) for (var e = 0; e < 3; e++) {
      var a = m.f[t + e], b = m.f[t + (e + 1) % 3], key = a < b ? a + ',' + b : b + ',' + a;
      E.set(key, (E.get(key) || 0) + 1);
    }
    var naked = 0;
    E.forEach(function (n) { if (n % 2) naked++; });
    return naked === 0;
  }
  function bboxOf(m) {
    var b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (var i = 0; i < m.v.length; i += 3) for (var a = 0; a < 3; a++) { var x = m.v[i + a]; if (x < b[a]) b[a] = x; if (x > b[a + 3]) b[a + 3] = x; }
    return b;
  }
  // coupe horizontale d'un maillage soudé à la hauteur z : anneaux [x, y] et contours ouverts
  function sectionRings(m, z) {
    var V = m.v, F = m.f, segs = [];
    for (var t = 0; t < F.length; t += 3) {
      var pts = [];
      for (var e = 0; e < 3; e++) {
        var i = F[t + e], j = F[t + (e + 1) % 3];
        if (i > j) { var s0 = i; i = j; j = s0; }
        var hi = V[3 * i + 2] - z, hj = V[3 * j + 2] - z;
        if ((hi < 0) !== (hj < 0)) {
          var s = hi / (hi - hj);
          pts.push([V[3 * i] + s * (V[3 * j] - V[3 * i]), V[3 * i + 1] + s * (V[3 * j + 1] - V[3 * i + 1])]);
        }
      }
      if (pts.length === 2) segs.push(pts);
    }
    if (!segs.length) return { rings: [], open: 0 };
    var J = CLW.Import.joinSegments(segs, 1e-6);
    return {
      rings: J.rings.map(function (r) {
        var q = CLW.geom.simplify ? CLW.geom.simplify(r.concat([r[0]]), 0.002, true).slice(0, -1) : r;
        return (q.length >= 3 ? q : r).map(function (p) { return [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]; });
      }),
      open: J.open.length
    };
  }

  // ------------------------------------------------------------------ lecture du fichier
  var SCREEN_RE = /(brique|lame|[ée]cran|claustra|screen|brise|persienne|louvre|r[ée]sille|treillis|lattis|moucharab|tasseau|ventelle|bardage ajour)/i;
  var TREE_RE = /(arbre|tree|v[ée]g[ée]t|plant|feuillu|conif)/i;
  var WALL_RE = /(cl[oô]ture|fence|muret|enceinte)/i;
  var IGNORE_RE = /(cot(e|ation)|\bdim|text|hach|hatch|annot|cartouche|title|defpoints|grille|grid|\bsol\b|terrain|ground|topo|contexte?\b|\baxe|axis|rep[eè]re|cam[ée]ra|light|lumi[eè]re|personn|human|people|mobilier|furniture|construction|trac[ée])/i;
  var KIND_LAB = { auto: 'auto', volume: 'volume plein', ecran: 'écran poreux', mur: 'mur (courbes)', arbre: 'arbre', ignore: 'ignorer' };

  function layerAuto(name, visible) {
    if (!visible) return 'ignore';
    if (SCREEN_RE.test(name)) return 'ecran';
    if (TREE_RE.test(name)) return 'arbre';
    if (WALL_RE.test(name)) return 'mur';
    if (IGNORE_RE.test(name)) return 'ignore';
    return 'auto';
  }

  // objets du fichier, blocs éclatés (calque de l'insertion), en { g, layer, kind: 'solid' | 'curve' | 'point' }
  function collect(rh, doc) {
    var objs = doc.objects(), out = [], byId = new Map(), skipped = 0, hidden = 0, blocks = 0;
    for (var i = 0; i < objs.count; i++) {
      var o = objs.get(i), a = o.attributes();
      if (a.isInstanceDefinitionObject) { byId.set(a.id, o); continue; }
      var mode = a.mode && a.mode.value != null ? a.mode.value : a.mode;
      if (a.visible === false || mode === 1) { hidden++; continue; }
      out.push({ g: o.geometry(), layer: a.layerIndex });
    }
    // définitions de blocs : objets par identifiant
    var idefs = doc.instanceDefinitions(), defs = new Map();
    for (var d = 0; d < idefs.count; d++) { var D = idefs.get(d); defs.set(D.id, D); }
    if (defs.size) for (var j = 0; j < objs.count; j++) {
      var oj = objs.get(j), aj = oj.attributes();
      if (aj.isInstanceDefinitionObject) byId.set(aj.id, oj);
    }
    var res = [];
    function expand(g, layer, xf, depth) {
      if (g instanceof rh.InstanceReference) {
        var def = defs.get(g.parentIdefId);
        if (!def || depth > 6) { skipped++; return; }
        blocks++;
        var x2 = xf ? rh.Transform.multiply(xf, g.xform) : g.xform, ids = def.getObjectIds();
        for (var q = 0; q < ids.length; q++) {
          var src = byId.get(ids[q]);
          if (src) expand(src.geometry(), layer, x2, depth + 1);
        }
        return;
      }
      if (xf) { g = g.duplicate(); g.transform(xf); }
      var kind = (g instanceof rh.Brep || g instanceof rh.Extrusion || g instanceof rh.Mesh || g instanceof rh.SubD || g instanceof rh.Surface) ? 'solid' :
        g instanceof rh.Curve ? 'curve' : g instanceof rh.Point ? 'point' : null;
      if (!kind) { skipped++; return; }
      res.push({ g: g, layer: layer, kind: kind });
    }
    out.forEach(function (o) { expand(o.g, o.layer, null, 0); });
    return { items: res, skipped: skipped, hidden: hidden, blocks: blocks };
  }

  I3.parse = function (rh, buf, name) {
    var doc = rh.File3dm.fromByteArray(new Uint8Array(buf));
    if (!doc) throw new Error('Fichier .3dm illisible (version trop récente ou fichier abîmé). Réenregistrez-le depuis Rhino 7 ou 8.');
    var unit = unitOf(doc), lt = doc.layers(), layers = [];
    for (var i = 0; i < lt.count; i++) { var L = lt.get(i); layers.push({ index: i, path: L.fullPath || L.name || ('calque ' + i), visible: L.visible !== false, n: { solid: 0, curve: 0, point: 0 } }); }
    var C = collect(rh, doc), byIndex = {};
    layers.forEach(function (L) { byIndex[L.index] = L; });
    C.items.forEach(function (it) { var L = byIndex[it.layer]; if (L) L.n[it.kind]++; });
    var used = layers.filter(function (L) { return L.n.solid + L.n.curve + L.n.point > 0; });
    used.forEach(function (L) { L.auto = layerAuto(L.path, L.visible); });
    return { name: name, doc: doc, unit: unit, layers: used, items: C.items, skipped: C.skipped, hidden: C.hidden, blocks: C.blocks };
  };

  // usage final d'un objet : 'volume' | 'ecran' | 'mur' | 'arbre' | null
  function finalKind(layerKind, it, m, k) {
    if (layerKind === 'ignore') return null;
    if (it.kind === 'curve') return layerKind === 'mur' ? 'mur' : layerKind === 'arbre' ? 'arbre' : null;
    if (it.kind === 'point') return layerKind === 'arbre' ? 'arbre' : null;
    if (layerKind === 'volume' || layerKind === 'ecran') return layerKind;
    if (layerKind === 'arbre') return 'arbre';
    if (layerKind === 'mur') return null;
    // auto : petits éléments (moins de 25 cm d'épaisseur et 60 cm de long en plan) = éléments d'écran
    var b = m.bb, dx = b[3] - b[0], dy = b[4] - b[1];
    return Math.min(dx, dy) < 0.25 && Math.max(dx, dy) < 0.6 ? 'ecran' : 'volume';
  }

  // construit la scène (même format que le composant Grasshopper)
  I3.build = function (rh, P, o) {
    var k = P.unit.k, kinds = o.layerKinds || {}, st = { cached: 0, remeshed: 0, grid: 0, failed: 0 };
    var solids = [], walls = [], trees = [], flat = 0, openVol = 0, noMesh = 0;
    P.items.forEach(function (it) {
      var lk = kinds[it.layer] || 'auto';
      if (lk === 'ignore') return;
      if (it.kind === 'solid') {
        if (lk === 'mur') return;
        var acc = new Acc();
        if (!geomMesh(rh, it.g, acc, st) || !acc.f.length) { noMesh++; return; }
        var m = weld(acc, k);
        if (!m.f.length) { noMesh++; return; }
        m.bb = bboxOf(m);
        m.closed = isClosed(m);
        var fk = finalKind(lk, it, m, k);
        if (!fk) return;
        if (fk === 'arbre') {
          var bb = m.bb;
          trees.push({ x: (bb[0] + bb[3]) / 2, y: (bb[1] + bb[4]) / 2, r: Math.max(0.5, Math.max(bb[3] - bb[0], bb[4] - bb[1]) / 2), a: (CLW.LBM && CLW.LBM.TREE_A) || 0.15 });
          return;
        }
        // surfaces ouvertes et plates (dalle dessinée en surface, sol…) : elles fausseraient le remplissage des volumes
        if (!m.closed && m.bb[5] - m.bb[2] < 0.01) { flat++; return; }
        if (!m.closed) openVol++;
        m.kind = fk;
        solids.push(m);
      } else {
        var fk2 = finalKind(lk, it, null, k);
        if (!fk2) return;
        if (it.kind === 'point') {
          var p = it.g.location;
          trees.push({ x: p[0] * k, y: p[1] * k, r: o.treeR || 5, a: (CLW.LBM && CLW.LBM.TREE_A) || 0.15 });
          return;
        }
        var pts = curvePts(it.g, 48).map(function (q) { return [q[0] * k, q[1] * k]; });
        if (fk2 === 'mur') { if (pts.length >= 2) walls.push({ pts: pts, thick: o.thick || 0.3 }); }
        else {
          var cx = 0, cy = 0;
          pts.forEach(function (q) { cx += q[0]; cy += q[1]; });
          cx /= pts.length; cy /= pts.length;
          var r = 0;
          pts.forEach(function (q) { r += Math.hypot(q[0] - cx, q[1] - cy); });
          r /= pts.length;
          trees.push({ x: cx, y: cy, r: it.g.isClosed && r > 0.5 ? r : (o.treeR || 5), a: (CLW.LBM && CLW.LBM.TREE_A) || 0.15 });
        }
      }
    });
    if (!solids.length && !walls.length && !trees.length) throw new Error('Rien à importer : aucun volume, élément d\'écran, mur ni arbre retenu. Vérifiez l\'usage des calques.');

    var rings = [], screens = [], nOpen = 0, cut = o.cut != null ? o.cut : 1.5, zmin = 0, zmax = 0;
    if (solids.length) {
      zmin = Math.min.apply(null, solids.map(function (m) { return m.bb[2]; }));
      zmax = Math.max.apply(null, solids.map(function (m) { return m.bb[5]; }));
      var z = zmin + cut;
      // la coupe ne doit pas tomber pile sur un lit de briques (faces horizontales) : décalage de 0,3 mm
      for (var tries = 0; tries < 5; tries++) {
        var hit = solids.some(function (m) { for (var i = 2; i < m.v.length; i += 3) if (Math.abs(m.v[i] - z) < 2e-5) return true; return false; });
        if (!hit) break;
        z += 3e-4;
      }
      if (z < zmax) solids.forEach(function (m) {
        if (m.bb[2] > z || m.bb[5] < z) return;
        var S = sectionRings(m, z);
        nOpen += S.open;
        (m.kind === 'ecran' ? screens : rings).push.apply(m.kind === 'ecran' ? screens : rings, S.rings);
      });
    }
    function pack(m) {
      var vv = new Array(m.v.length);
      for (var i = 0; i < m.v.length; i += 3) {
        vv[i] = Math.round(m.v[i] * 1000) / 1000; vv[i + 1] = Math.round(m.v[i + 1] * 1000) / 1000; vv[i + 2] = Math.round((m.v[i + 2] - zmin) * 1000) / 1000;
      }
      return [vv, m.f.slice()];
    }
    var mesh3d = solids.length ? {
      volumes: solids.filter(function (m) { return m.kind === 'volume'; }).map(pack),
      ecrans: solids.filter(function (m) { return m.kind === 'ecran'; }).map(pack),
      zmin: Math.round(zmin * 1000) / 1000
    } : null;
    var warn = [];
    if (solids.length && zmin + cut >= zmax) warn.push('La coupe passe au-dessus de tous les volumes : baissez la hauteur de coupe.');
    if (flat) warn.push(CLW.plur(flat, 'surface plate ouverte ignorée', 'surfaces plates ouvertes ignorées') + ' (sol, dalle dessinée en surface).');
    if (openVol) warn.push(CLW.plur(openVol, 'volume non fermé', 'volumes non fermés') + ' : le calcul 3D peut les remplir de travers. Fermez-les dans Rhino (Cap, Join).');
    if (noMesh) warn.push(CLW.plur(noMesh, 'objet sans maillage lisible', 'objets sans maillage lisible') + ', ignoré' + (noMesh > 1 ? 's' : '') + '.');
    if (P.skipped) warn.push(CLW.plur(P.skipped, 'objet d\'un type non pris en charge ignoré', 'objets d\'un type non pris en charge ignorés') + '.');
    var scene = { rings: rings, screens: screens, walls: walls, trees: trees, wind: null, joint: o.joint > 0 ? o.joint : null,
      cut: cut, open: nOpen, warn: warn.join(' ') || null, mesh3d: mesh3d, doc: P.name, rev: 0 };
    var nv = solids.filter(function (m) { return m.kind === 'volume'; }).length;
    return { scene: scene, stats: st, nVol: nv, nScr: solids.length - nv, nWall: walls.length, nTree: trees.length, height: zmax - zmin };
  };

  // ------------------------------------------------------------------ interface
  var pending = null;
  function show(P) {
    var h = '<div class="hint">' + esc(P.name) + ' : ' + P.items.length + ' objets' + (P.blocks ? ' (dont ' + P.blocks + ' blocs éclatés)' : '') +
      ', unité du fichier : ' + esc(P.unit.name) + '.' + (P.hidden ? ' ' + CLW.plur(P.hidden, 'objet caché ignoré', 'objets cachés ignorés') + '.' : '') + '</div>';
    h += '<label class="row">Hauteur de coupe du plan, au-dessus du point le plus bas <span class="pair"><input type="number" id="i3-cut" value="1.5" step="0.1" min="0.1"> m</span></label>';
    h += '<label class="row">Épaisseur des murs (courbes) <span class="pair"><input type="number" id="i3-thick" value="0.3" step="0.05" min="0.05" max="5"> m</span></label>';
    h += '<table class="layers"><tr><td><b>Calque</b></td><td><b>Objets</b></td><td><b>Usage</b></td></tr>';
    P.layers.forEach(function (L) {
      var n = L.n, parts = [];
      if (n.solid) parts.push(n.solid + ' vol.');
      if (n.curve) parts.push(n.curve + ' courbe' + (n.curve > 1 ? 's' : ''));
      if (n.point) parts.push(n.point + ' pt' + (n.point > 1 ? 's' : ''));
      h += '<tr><td title="' + esc(L.path) + '">' + esc(L.path) + (L.visible ? '' : ' <i>(caché)</i>') + '</td><td>' + parts.join(', ') + '</td><td><select data-l3="' + L.index + '">' +
        Object.keys(KIND_LAB).map(function (kk) { return '<option value="' + kk + '"' + (kk === L.auto ? ' selected' : '') + '>' + KIND_LAB[kk] + '</option>'; }).join('') +
        '</select></td></tr>';
    });
    h += '</table><div class="hint">Volume plein : bâtiment, toit, réservoir, coupé en plan et plein en 3D. Écran poreux : briques, lames, claustras, ' +
      'trop fins pour la grille du plan, soudés en bandes poreuses (en 3D et au zoom, chaque élément reste plein). ' +
      'Auto : les petits éléments (moins de 25 × 60 cm en plan) deviennent des écrans, le reste des volumes ; courbes et points ignorés. ' +
      'Les calques cachés, de cotes, de textes, de sol ou de terrain sont ignorés d\'office (CL-WIND a son propre sol).</div>';
    h += '<button id="i3-go" class="primary">Remplacer la scène par ce modèle</button>';
    opt(h);
    pending = P;
    $('i3-go').onclick = function () { I3.apply(); };
  }

  I3.apply = async function (over) {
    if (!pending) return;
    var o = over || {};
    if (!over) {
      o.cut = CLW.parseNum ? CLW.parseNum($('i3-cut').value) : +$('i3-cut').value;
      o.thick = CLW.parseNum ? CLW.parseNum($('i3-thick').value) : +$('i3-thick').value;
      o.layerKinds = {};
      Array.prototype.forEach.call(document.querySelectorAll('#imp-options select[data-l3]'), function (s) { o.layerKinds[s.getAttribute('data-l3')] = s.value; });
    } else if (!o.layerKinds) {
      o.layerKinds = {};
      pending.layers.forEach(function (L) { o.layerKinds[L.index] = L.auto; });
    }
    if (!(o.cut > 0)) o.cut = 1.5;
    status('Maillage et coupe du modèle…');
    await new Promise(function (r) { setTimeout(r, 30); });
    var rh = await I3.load(), t0 = performance.now(), R;
    try { R = I3.build(rh, pending, o); } catch (e) { status(e.message, 'err'); return null; }
    var LIVE = CLW.Live;
    // Grasshopper relié : on cesse de le suivre, sinon son prochain envoi remplacerait le modèle
    var follow = $('live-follow'), stopped = false;
    if (LIVE.ghLast && follow && follow.checked) { follow.checked = false; stopped = true; }
    LIVE.apply(R.scene, { label: pending.name, src: '3dm', recenter: true });
    var st = R.stats, ms = performance.now() - t0;
    I3.last = R;
    status(pending.name + ' : ' + CLW.plur(R.nVol, 'volume plein', 'volumes pleins') + ', ' + CLW.plur(R.nScr, 'élément d\'écran poreux', 'éléments d\'écran poreux') +
      (R.nWall ? ', ' + CLW.plur(R.nWall, 'mur', 'murs') : '') + (R.nTree ? ', ' + CLW.plur(R.nTree, 'arbre', 'arbres') : '') +
      ', hauteur ' + fmt(R.height, 2) + ' m. Coupe du plan à ' + fmt(o.cut, 2) + ' m : ' + R.scene.rings.length + ' contours pleins, ' + R.scene.screens.length + ' contours d\'écran.' +
      '\nMaillages : ' + (st.cached ? st.cached + ' faces maillées par Rhino' : '') + (st.cached && st.remeshed ? ', ' : '') +
      (st.remeshed ? st.remeshed + ' faces remaillées ici' + (st.grid ? ' (dont ' + st.grid + ' courbes, sans leurs découpes)' : '') : '') + ' (' + fmt(ms / 1000, 1) + ' s).' +
      (R.scene.warn ? '\n' + R.scene.warn : '') +
      (stopped ? '\n« Suivre Grasshopper » est décoché pour garder ce modèle ; recochez-le pour revenir à Grasshopper.' : '') +
      '\nLe modèle remplace la scène reçue de Grasshopper ou d\'un 3DM précédent ; les autres objets du plan restent.', R.scene.warn ? 'warn' : 'ok');
    return R;
  };

  I3.readFile = function (file) {
    status(''); opt(''); pending = null;
    if (file.size > MAX_BYTES) { status('Fichier trop lourd (' + fmt(file.size / 1048576, 0) + ' Mo, maximum 200 Mo). Enregistrez une copie avec seulement les calques utiles.', 'err'); return Promise.resolve(null); }
    status('Chargement de la bibliothèque rhino3dm…');
    return I3.load().then(function (rh) {
      status('Lecture de ' + file.name + '…');
      return file.arrayBuffer().then(function (buf) {
        var P = I3.parse(rh, buf, file.name);
        if (!P.items.length) throw new Error('Aucun objet visible dans ' + file.name + '.');
        show(P);
        status('Choisissez l\'usage de chaque calque puis « Remplacer la scène par ce modèle ». Bibliothèque rhino3dm : ' + I3.source + '.');
        return P;
      });
    }).catch(function (e) { status(e.message, 'err'); return null; });
  };
  // essai automatique : charge une adresse, usages auto, applique
  I3.loadUrl = async function (url, over) {
    var r = await fetch(url);
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
    var b = await r.blob();
    var f = new File([b], url.split('/').pop());
    var P = await I3.readFile(f);
    if (!P) throw new Error($('imp-status').textContent);
    return I3.apply(over || {});
  };
})(window);
