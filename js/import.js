/* CL-WIND - import.js
 * Import de plans DXF ASCII, GeoJSON et modèles GLB, en bâtiments, murs et arbres.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var IMP = CLW.Import = {};
  var MAX_BYTES = 60 * 1024 * 1024, MAX_OBJECTS = 20000;
  IMP.MAX_OBJECTS = MAX_OBJECTS;

  // ------------------------------------------------------------------ outils géométriques
  // jonction de segments par table de hachage des extrémités
  IMP.joinSegments = function (segs, tol) {
    tol = tol || 1e-6;
    function key(p) { return Math.round(p[0] / tol) + ',' + Math.round(p[1] / tol); }
    var ends = new Map(), used = new Uint8Array(segs.length), seen = new Set(), list = [];
    // doublons
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i], ka = key(s[0]), kb = key(s[s.length - 1]);
      if (ka === kb && s.length <= 2) continue;
      var sig = s.length === 2 ? (ka < kb ? ka + '|' + kb : kb + '|' + ka) : null;
      if (sig) { if (seen.has(sig)) continue; seen.add(sig); }
      list.push({ pts: s, ka: ka, kb: kb });
    }
    list.forEach(function (s, idx) {
      if (!ends.has(s.ka)) ends.set(s.ka, []); ends.get(s.ka).push(idx);
      if (!ends.has(s.kb)) ends.set(s.kb, []); ends.get(s.kb).push(idx);
    });
    used = new Uint8Array(list.length);
    var rings = [], open = [];
    function takeFrom(k, exclude) {
      var arr = ends.get(k); if (!arr) return -1;
      for (var a = 0; a < arr.length; a++) if (!used[arr[a]] && arr[a] !== exclude) return arr[a];
      return -1;
    }
    for (var j = 0; j < list.length; j++) {
      if (used[j]) continue;
      used[j] = 1;
      var chain = list[j].pts.slice(), kStart = list[j].ka, kEnd = list[j].kb;
      // en avant
      var guard = 0;
      while (kEnd !== kStart && guard++ < 1e6) {
        var n = takeFrom(kEnd, -1); if (n < 0) break;
        used[n] = 1;
        var t = list[n];
        if (t.ka === kEnd) { chain = chain.concat(t.pts.slice(1)); kEnd = t.kb; }
        else { chain = chain.concat(t.pts.slice(0, -1).reverse()); kEnd = t.ka; }
      }
      if (kEnd === kStart && chain.length >= 4) { rings.push(chain.slice(0, -1)); continue; }
      // en arrière
      guard = 0;
      while (guard++ < 1e6) {
        var m = takeFrom(kStart, -1); if (m < 0) break;
        used[m] = 1;
        var u = list[m];
        if (u.kb === kStart) { chain = u.pts.slice(0, -1).concat(chain); kStart = u.ka; }
        else { chain = u.pts.slice(1).reverse().concat(chain); kStart = u.kb; }
        if (kStart === kEnd) break;
      }
      if (kStart === kEnd && chain.length >= 4) rings.push(chain.slice(0, -1));
      else open.push(chain);
    }
    return { rings: rings, open: open };
  };

  // anneaux → bâtiments, l'imbrication décide des trous (pair / impair)
  IMP.ringsToBuildings = function (rings, minArea) {
    minArea = minArea || 0.5;
    var R = rings.filter(function (r) { return r.length >= 3 && Math.abs(CLW.geom.area(r)) >= minArea; })
      .map(function (r) { return { pts: r, area: Math.abs(CLW.geom.area(r)), bb: CLW.geom.bbox(r), parent: -1, depth: 0 }; });
    R.sort(function (a, b) { return b.area - a.area; });
    for (var i = 0; i < R.length; i++) {
      var p = R[i].pts[0];
      for (var j = i - 1; j >= 0; j--) {
        var bb = R[j].bb;
        if (p[0] < bb[0] || p[0] > bb[2] || p[1] < bb[1] || p[1] > bb[3]) continue;
        if (CLW.geom.pointInRings(p[0], p[1], [R[j].pts])) { R[i].parent = j; R[i].depth = R[j].depth + 1; break; }
      }
    }
    var out = [], map = {};
    R.forEach(function (r, i) { if (r.depth % 2 === 0) { map[i] = out.length; out.push({ type: 'building', outer: r.pts, holes: [], height: null }); } });
    R.forEach(function (r) { if (r.depth % 2 === 1 && map[r.parent] != null) out[map[r.parent]].holes.push(r.pts); });
    return out;
  };

  function circlePts(cx, cy, r, n) {
    n = n || 24; var o = [];
    for (var k = 0; k < n; k++) { var a = k / n * Math.PI * 2; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return o;
  }
  function arcPts(cx, cy, r, a0, a1) {
    var sweep = a1 - a0; while (sweep <= 0) sweep += Math.PI * 2;
    var n = Math.max(2, Math.ceil(sweep / (Math.PI / 12))), o = [];
    for (var k = 0; k <= n; k++) { var a = a0 + sweep * k / n; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return o;
  }
  // segment avec bulge (arc DXF)
  function bulgePts(p1, p2, b) {
    if (!b || Math.abs(b) < 1e-9) return [p2];
    var th = 4 * Math.atan(b), dx = p2[0] - p1[0], dy = p2[1] - p1[1], d = Math.hypot(dx, dy);
    if (d < 1e-12) return [p2];
    var h = d / (2 * Math.tan(th / 2));
    var mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
    var cx = mx - dy / d * h, cy = my + dx / d * h;
    var a1 = Math.atan2(p1[1] - cy, p1[0] - cx), r = Math.hypot(p1[0] - cx, p1[1] - cy);
    var n = Math.max(2, Math.ceil(Math.abs(th) / (Math.PI / 12))), o = [];
    for (var k = 1; k < n; k++) { var a = a1 + th * k / n; o.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    o.push(p2);
    return o;
  }
  IMP.bulgePts = bulgePts;
  function polyWithBulges(verts, closed) {
    if (!verts.length) return [];
    var out = [[verts[0].x, verts[0].y]], n = verts.length;
    for (var k = 0; k < n - (closed ? 0 : 1); k++) {
      var a = verts[k], b = verts[(k + 1) % n];
      var seg = bulgePts([a.x, a.y], [b.x, b.y], a.b);
      if (closed && k === n - 1) seg = seg.slice(0, -1);
      out = out.concat(seg);
    }
    return out;
  }

  // ------------------------------------------------------------------ DXF
  var IGNORE_RE = /(cot(e|ation)|dim|text|txt|texte|hach|hatch|motif|parcel|cadast|voirie|voie|route|road|chauss|trottoir|street|\beau\b|water|rivi|courbe|contour|isohyp|niveau|level|toit|roof|couverture|axe|axis|annot|cartouche|title|viewport|defpoints|grille|grid)/i;
  var TREE_RE = /(arbre|tree|v[eé]g[eé]t|plant|feuillu|conif)/i;
  var WALL_RE = /(\bmur|wall|cl[oô]ture|enceinte|muret|fence)/i;
  var BLDG_RE = /(b[aâ]t|build|bldg|emprise|construct|maison|immeuble|logement|house)/i;
  IMP.autoKind = function (name) {
    if (TREE_RE.test(name)) return 'tree';
    if (WALL_RE.test(name)) return 'wall';
    if (BLDG_RE.test(name)) return 'building';
    if (IGNORE_RE.test(name)) return 'ignore';
    return 'auto';
  };
  var UNIT_M = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 };

  IMP.parseDXF = function (text) {
    if (/^AutoCAD Binary DXF/.test(text.slice(0, 22))) throw new Error('DXF binaire non pris en charge. Réenregistrez le fichier en DXF ASCII (texte) depuis votre logiciel de dessin.');
    var lines = text.split(/\r\n|\r|\n/), n = lines.length;
    if (n < 4) throw new Error('Fichier DXF vide ou illisible.');
    var pairs = [];
    for (var i = 0; i + 1 < n; i += 2) {
      var c = parseInt(lines[i], 10);
      if (isNaN(c)) { if (lines[i].trim() === '' && i + 1 < n) { i -= 1; continue; } throw new Error('DXF illisible près de la ligne ' + (i + 1) + '. Est-ce bien un DXF ASCII ?'); }
      pairs.push([c, lines[i + 1].trim()]);
    }
    var res = { insunits: null, layers: {}, ents: [], blocks: {} };
    var section = null, k = 0, curBlock = null;
    function layer(name) { name = name || '0'; if (!res.layers[name]) res.layers[name] = { count: 0, closed: 0, open: 0, circles: 0, inserts: 0 }; return res.layers[name]; }
    function readEntity(type) {
      // lit les paires jusqu'au prochain code 0
      var e = { type: type, layer: '0', v: [], flags: 0 }, cur = null;
      k++;
      while (k < pairs.length && pairs[k][0] !== 0) {
        var p = pairs[k], g = p[0], val = p[1];
        if (g === 8) e.layer = val;
        else if (g === 67) e.paper = val === '1';
        else if (g === 70) e.flags = parseInt(val, 10) || 0;
        else if (g === 2) e.name = val;
        else if (type === 'LWPOLYLINE') {
          if (g === 10) { cur = { x: parseFloat(val), y: 0, b: 0 }; e.v.push(cur); }
          else if (g === 20 && cur) cur.y = parseFloat(val);
          else if (g === 42 && cur) cur.b = parseFloat(val);
        } else {
          if (g === 10) e.x = parseFloat(val); else if (g === 20) e.y = parseFloat(val);
          else if (g === 11) e.x2 = parseFloat(val); else if (g === 21) e.y2 = parseFloat(val);
          else if (g === 40) e.r = parseFloat(val);
          else if (g === 41) e.sx = parseFloat(val); else if (g === 42) { e.sy = parseFloat(val); e.b = parseFloat(val); }
          else if (g === 50) e.a0 = parseFloat(val); else if (g === 51) e.a1 = parseFloat(val);
        }
        k++;
      }
      return e;
    }
    function toGeom(e) {
      var g = null;
      switch (e.type) {
        case 'LWPOLYLINE':
          if (e.v.length >= 2) g = { kind: 'poly', pts: polyWithBulges(e.v, !!(e.flags & 1)), closed: !!(e.flags & 1) };
          break;
        case 'POLYLINE':
          if (e.flags & (16 | 64)) break; // maillages
          if (e.v.length >= 2) g = { kind: 'poly', pts: polyWithBulges(e.v, !!(e.flags & 1)), closed: !!(e.flags & 1) };
          break;
        case 'LINE':
          if (isFinite(e.x) && isFinite(e.x2)) g = { kind: 'poly', pts: [[e.x, e.y], [e.x2, e.y2]], closed: false };
          break;
        case 'CIRCLE':
          if (e.r > 0) g = { kind: 'circle', x: e.x, y: e.y, r: e.r };
          break;
        case 'ARC':
          if (e.r > 0) g = { kind: 'poly', pts: arcPts(e.x, e.y, e.r, (e.a0 || 0) * Math.PI / 180, (e.a1 || 0) * Math.PI / 180), closed: false };
          break;
        case 'INSERT':
          g = { kind: 'insert', x: e.x || 0, y: e.y || 0, sx: e.sx || 1, sy: e.sy || e.sx || 1, block: e.name };
          break;
      }
      if (g) { g.layer = e.layer; }
      return g;
    }
    while (k < pairs.length) {
      var p = pairs[k];
      if (p[0] === 0 && p[1] === 'SECTION') { k++; section = pairs[k] && pairs[k][1]; k++; continue; }
      if (p[0] === 0 && p[1] === 'ENDSEC') { section = null; k++; continue; }
      if (section === 'HEADER') {
        if (p[0] === 9 && p[1] === '$INSUNITS') { k++; if (pairs[k] && pairs[k][0] === 70) res.insunits = parseInt(pairs[k][1], 10); }
        k++; continue;
      }
      if (section === 'TABLES') {
        if (p[0] === 0 && p[1] === 'LAYER') { var le = readEntity('LAYER'); if (le.name) layer(le.name); continue; }
        k++; continue;
      }
      if ((section === 'ENTITIES' || section === 'BLOCKS') && p[0] === 0) {
        var type = p[1];
        if (section === 'BLOCKS' && type === 'BLOCK') { var be = readEntity('BLOCK'); curBlock = { name: be.name, ext: [Infinity, Infinity, -Infinity, -Infinity], rmax: 0 }; continue; }
        if (section === 'BLOCKS' && type === 'ENDBLK') { if (curBlock && curBlock.name) res.blocks[curBlock.name] = curBlock; curBlock = null; readEntity('ENDBLK'); continue; }
        var e = readEntity(type);
        if (type === 'POLYLINE') {
          // sommets jusqu'à SEQEND
          while (k < pairs.length && pairs[k][0] === 0 && pairs[k][1] === 'VERTEX') {
            var vx = readEntity('VERTEX');
            if (!(vx.flags & 128) || (vx.flags & 64)) e.v.push({ x: vx.x, y: vx.y, b: vx.b || 0 });
          }
          if (k < pairs.length && pairs[k][1] === 'SEQEND') readEntity('SEQEND');
        }
        if (e.paper) continue;
        var g = toGeom(e);
        if (!g) continue;
        if (section === 'BLOCKS') {
          if (curBlock) {
            if (g.kind === 'circle') { curBlock.rmax = Math.max(curBlock.rmax, g.r); CLW.geom.bbox([[g.x - g.r, g.y - g.r], [g.x + g.r, g.y + g.r]], curBlock.ext); }
            else if (g.kind === 'poly') CLW.geom.bbox(g.pts, curBlock.ext);
          }
          continue;
        }
        var L = layer(g.layer); L.count++;
        if (g.kind === 'circle') L.circles++; else if (g.kind === 'insert') L.inserts++; else if (g.closed) L.closed++; else L.open++;
        res.ents.push(g);
        continue;
      }
      k++;
    }
    // étendue du dessin (pas la grandeur des coordonnées)
    var bb = [Infinity, Infinity, -Infinity, -Infinity];
    res.ents.forEach(function (g) {
      if (g.kind === 'poly') CLW.geom.bbox(g.pts, bb);
      else if (g.kind === 'circle') CLW.geom.bbox([[g.x - g.r, g.y - g.r], [g.x + g.r, g.y + g.r]], bb);
      else CLW.geom.bbox([[g.x, g.y]], bb);
    });
    res.bbox = bb;
    var ext = Math.max(bb[2] - bb[0], bb[3] - bb[1]);
    res.extent = isFinite(ext) ? ext : 0;
    res.unitGuess = res.extent >= 20000 ? 0.001 : res.extent >= 2500 ? 0.01 : 1;
    res.unitFromHeader = UNIT_M[res.insunits] || null;
    Object.keys(res.layers).forEach(function (nm) { if (!res.layers[nm].count) delete res.layers[nm]; });
    return res;
  };

  // DXF analysé → objets en mètres (non centrés), selon le choix par calque
  IMP.dxfToObjects = function (dxf, layerKinds, unit, wallThick) {
    var s = unit, segs = {}, out = [];
    function kindOf(g) { return layerKinds[g.layer] || 'auto'; }
    dxf.ents.forEach(function (g) {
      var kind = kindOf(g);
      if (kind === 'ignore') return;
      if (g.kind === 'insert') {
        var blk = dxf.blocks[g.block];
        var isTree = kind === 'tree' || (kind === 'auto' && (TREE_RE.test(g.block || '') || TREE_RE.test(g.layer)));
        if (!isTree) return;
        var r = 3;
        if (blk) {
          var br = blk.rmax > 0 ? blk.rmax : (isFinite(blk.ext[0]) ? Math.max(blk.ext[2] - blk.ext[0], blk.ext[3] - blk.ext[1]) / 2 : 0);
          if (br > 0) r = br * Math.abs(g.sx) * s;
        }
        if (!(r > 0.3 && r < 30)) r = 3;
        out.push({ type: 'tree', x: g.x * s, y: g.y * s, r: r, a: CLW.LBM.TREE_A });
        return;
      }
      if (g.kind === 'circle') {
        if (kind === 'tree' || kind === 'auto') { var rr = g.r * s; out.push({ type: 'tree', x: g.x * s, y: g.y * s, r: rr > 0.3 && rr < 30 ? rr : 3, a: CLW.LBM.TREE_A }); }
        else if (kind === 'building') out.push({ type: '_ring', pts: circlePts(g.x * s, g.y * s, g.r * s), layer: g.layer });
        return;
      }
      var pts = g.pts.map(function (p) { return [p[0] * s, p[1] * s]; });
      if (kind === 'tree') { var b = CLW.geom.bbox(pts); out.push({ type: 'tree', x: (b[0] + b[2]) / 2, y: (b[1] + b[3]) / 2, r: Math.max(1, Math.min(15, Math.max(b[2] - b[0], b[3] - b[1]) / 2)), a: CLW.LBM.TREE_A }); return; }
      if (kind === 'wall') { if (g.closed) pts.push(pts[0]); out.push({ type: 'wall', pts: pts, thick: wallThick }); return; }
      if (g.closed) { out.push({ type: '_ring', pts: pts, layer: g.layer }); return; }
      (segs[kind] = segs[kind] || []).push(pts);
    });
    var tol = Math.max(1e-4, 1e-7 * dxf.extent * s);
    var rings = out.filter(function (o) { return o.type === '_ring'; }).map(function (o) { return o.pts; });
    // doublons d'anneaux
    var seen = new Set();
    rings = rings.filter(function (r) {
      var sig = r.map(function (p) { return Math.round(p[0] / tol) + ',' + Math.round(p[1] / tol); }).sort().join(';');
      if (seen.has(sig)) return false; seen.add(sig); return true;
    });
    out = out.filter(function (o) { return o.type !== '_ring'; });
    Object.keys(segs).forEach(function (kind) {
      // découpe en segments élémentaires, jointure par table de hachage
      var elem = [];
      segs[kind].forEach(function (pl) { for (var q = 0; q + 1 < pl.length; q++) elem.push([pl[q], pl[q + 1]]); });
      var J = IMP.joinSegments(elem, tol);
      rings = rings.concat(J.rings);
      J.open.forEach(function (o) {
        var simp = CLW.geom.simplify(o, tol * 10, false);
        if (simp.length >= 2) out.push({ type: 'wall', pts: simp, thick: wallThick });
      });
    });
    out = IMP.ringsToBuildings(rings).concat(out);
    return out;
  };

  // ------------------------------------------------------------------ GeoJSON
  function heightFromProps(p) {
    if (!p) return null;
    var v = p.height != null ? p.height : p.hauteur != null ? p.hauteur : p.HAUTEUR;
    var h = parseFloat(String(v == null ? '' : v).replace(',', '.'));
    if (isFinite(h) && h > 0) return h;
    var lv = p['building:levels'] != null ? p['building:levels'] : p.NB_NIV != null ? p.NB_NIV : p.nb_niv;
    var l = parseFloat(String(lv == null ? '' : lv).replace(',', '.'));
    return isFinite(l) && l > 0 ? l * 3 : null;
  }
  IMP.parseGeoJSON = function (text) {
    var j;
    try { j = JSON.parse(text); } catch (e) { throw new Error('GeoJSON illisible : ' + e.message); }
    var feats = j.type === 'FeatureCollection' ? j.features : j.type === 'Feature' ? [j] : j.type ? [{ type: 'Feature', geometry: j, properties: {} }] : null;
    if (!feats) throw new Error('Ce JSON n\'est pas un GeoJSON (FeatureCollection, Feature ou géométrie).');
    var items = [], bb = [Infinity, Infinity, -Infinity, -Infinity];
    feats.forEach(function (f) {
      var g = f && f.geometry, p = (f && f.properties) || {};
      if (!g) return;
      var geoms = g.type === 'GeometryCollection' ? g.geometries : [g];
      geoms.forEach(function (gg) {
        var t = gg.type, c = gg.coordinates;
        function add(kind, data) { items.push({ kind: kind, data: data, props: p }); }
        function bbAll(a) { if (typeof a[0] === 'number') CLW.geom.bbox([a], bb); else a.forEach(bbAll); }
        if (!c) return;
        bbAll(c);
        if (t === 'Polygon') add('poly', c);
        else if (t === 'MultiPolygon') c.forEach(function (pc) { add('poly', pc); });
        else if (t === 'LineString') add('line', c);
        else if (t === 'MultiLineString') c.forEach(function (lc) { add('line', lc); });
        else if (t === 'Point') add('point', c);
        else if (t === 'MultiPoint') c.forEach(function (pc) { add('point', pc); });
      });
    });
    if (!items.length) throw new Error('Aucune géométrie exploitable dans ce GeoJSON.');
    var degrees = bb[0] >= -180 && bb[2] <= 180 && bb[1] >= -90 && bb[3] <= 90 && (bb[2] - bb[0]) < 2 && (bb[3] - bb[1]) < 2;
    return { items: items, bbox: bb, degrees: degrees };
  };
  IMP.geojsonToObjects = function (gj, site, wallThick) {
    var proj, centered = true;
    if (gj.degrees) {
      if (site) { proj = CLW.OSM.project(site.lat, site.lon); centered = false; }
      else { var lat0 = (gj.bbox[1] + gj.bbox[3]) / 2, lon0 = (gj.bbox[0] + gj.bbox[2]) / 2; proj = CLW.OSM.project(lat0, lon0); }
    } else proj = null;
    function P(c) { return proj ? proj(c[1], c[0]) : [c[0], c[1]]; }
    function ring(r) { var o = r.map(P); if (o.length > 1 && o[0][0] === o[o.length - 1][0] && o[0][1] === o[o.length - 1][1]) o.pop(); return o; }
    var out = [];
    gj.items.forEach(function (it) {
      var p = it.props || {};
      if (it.kind === 'poly') {
        if (p.natural === 'tree' || p.natural === 'wood') return;
        var outer = ring(it.data[0]); if (outer.length < 3) return;
        out.push({ type: 'building', outer: outer, holes: it.data.slice(1).map(ring).filter(function (r) { return r.length >= 3; }), height: heightFromProps(p), name: p.name || null });
      } else if (it.kind === 'line') {
        var pts = it.data.map(P); if (pts.length < 2) return;
        out.push({ type: 'wall', pts: pts, thick: wallThick, height: heightFromProps(p) });
      } else if (it.kind === 'point') {
        var q = P(it.data), cd = parseFloat(p.diameter_crown);
        out.push({ type: 'tree', x: q[0], y: q[1], r: isFinite(cd) && cd > 1 ? cd / 2 : 3, a: CLW.LBM.TREE_A });
      }
    });
    return { objects: out, centered: centered };
  };

  // ------------------------------------------------------------------ GLB
  IMP.parseGLB = function (buf) {
    var dv = new DataView(buf);
    if (buf.byteLength < 20 || dv.getUint32(0, true) !== 0x46546C67) throw new Error('Ce fichier n\'est pas un GLB (glTF binaire).');
    if (dv.getUint32(4, true) !== 2) throw new Error('Seul le glTF 2.0 est pris en charge.');
    var off = 12, json = null, bin = null;
    while (off + 8 <= buf.byteLength) {
      var len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
      if (type === 0x4E4F534A) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, off + 8, len)));
      else if (type === 0x004E4942) bin = new Uint8Array(buf, off + 8, len);
      off += 8 + len;
    }
    if (!json) throw new Error('GLB sans en-tête JSON.');
    var ext = (json.extensionsUsed || []).concat(json.extensionsRequired || []);
    if (ext.some(function (e) { return /draco/i.test(e); })) throw new Error('GLB compressé avec Draco : non pris en charge. Exportez le modèle sans compression.');
    if (ext.some(function (e) { return /meshopt/i.test(e); })) throw new Error('GLB compressé avec Meshopt : non pris en charge. Exportez le modèle sans compression.');
    function accessor(i) {
      var a = json.accessors[i], bv = json.bufferViews[a.bufferView];
      if (!bv || !bin) return null;
      if (bv.buffer !== 0 && bv.buffer != null) throw new Error('GLB avec tampons externes : non pris en charge.');
      var nc = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
      var CT = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
      var bpe = CT.BYTES_PER_ELEMENT, stride = bv.byteStride || nc * bpe, base = (bv.byteOffset || 0) + (a.byteOffset || 0);
      var out = new Float64Array(a.count * nc), dvb = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
      var get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
      for (var e = 0; e < a.count; e++) for (var c = 0; c < nc; c++) out[e * nc + c] = dvb[get](base + e * stride + c * bpe, true);
      return out;
    }
    function mul(a, b) {
      var o = new Array(16);
      for (var r = 0; r < 4; r++) for (var c = 0; c < 4; c++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; }
      return o;
    }
    function trs(n) {
      if (n.matrix) return n.matrix.slice();
      var t = n.translation || [0, 0, 0], q = n.rotation || [0, 0, 0, 1], s = n.scale || [1, 1, 1];
      var x = q[0], y = q[1], z = q[2], w = q[3];
      return [
        (1 - 2 * (y * y + z * z)) * s[0], (2 * (x * y + z * w)) * s[0], (2 * (x * z - y * w)) * s[0], 0,
        (2 * (x * y - z * w)) * s[1], (1 - 2 * (x * x + z * z)) * s[1], (2 * (y * z + x * w)) * s[1], 0,
        (2 * (x * z + y * w)) * s[2], (2 * (y * z - x * w)) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
        t[0], t[1], t[2], 1];
    }
    var tris = [], ntri = 0;
    var I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    function visit(ni, M) {
      var n = json.nodes[ni], m = mul(M, trs(n));
      if (n.mesh != null) {
        json.meshes[n.mesh].primitives.forEach(function (pr) {
          if (pr.mode != null && pr.mode !== 4) return;
          if (pr.attributes.POSITION == null) return;
          var pos = accessor(pr.attributes.POSITION); if (!pos) return;
          var idx = pr.indices != null ? accessor(pr.indices) : null;
          var nv = pos.length / 3, W = new Float64Array(pos.length);
          for (var v = 0; v < nv; v++) {
            var x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2];
            W[3 * v] = m[0] * x + m[4] * y + m[8] * z + m[12];
            W[3 * v + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
            W[3 * v + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
          }
          var nt = idx ? idx.length / 3 : nv / 3;
          tris.push({ W: W, idx: idx, nt: nt });
          ntri += nt;
        });
      }
      (n.children || []).forEach(function (c) { visit(c, m); });
    }
    var sc = json.scenes ? json.scenes[json.scene || 0] : null;
    var roots = sc ? sc.nodes : (json.nodes || []).map(function (_, i) { return i; });
    roots.forEach(function (r) { visit(r, I); });
    if (!ntri) throw new Error('Aucun triangle dans ce GLB.');
    return { meshes: tris, ntri: ntri };
  };
  // coupe horizontale : axis 'y' (standard glTF) ou 'z'
  IMP.glbSection = function (glb, axis, cutAbove) {
    var up = axis === 'z' ? 2 : 1;
    var lo = Infinity, hi = -Infinity;
    glb.meshes.forEach(function (m) { for (var v = up; v < m.W.length; v += 3) { if (m.W[v] < lo) lo = m.W[v]; if (m.W[v] > hi) hi = m.W[v]; } });
    var h = lo + cutAbove;
    function plan(W, v) { return axis === 'z' ? [W[3 * v], W[3 * v + 1]] : [W[3 * v], -W[3 * v + 2]]; }
    var segs = [];
    if (h <= hi) glb.meshes.forEach(function (m) {
      var W = m.W;
      for (var t = 0; t < m.nt; t++) {
        var a = m.idx ? m.idx[3 * t] : 3 * t, b = m.idx ? m.idx[3 * t + 1] : 3 * t + 1, c = m.idx ? m.idx[3 * t + 2] : 3 * t + 2;
        var vs = [a, b, c], pts = [];
        for (var e = 0; e < 3; e++) {
          var i = vs[e], j = vs[(e + 1) % 3];
          if (i > j) { var tmp = i; i = j; j = tmp; } // ordre canonique : mêmes points sur une arête partagée
          var hi_ = W[3 * i + up] - h, hj = W[3 * j + up] - h;
          if ((hi_ < 0) !== (hj < 0)) {
            var s = hi_ / (hi_ - hj), pi = plan(W, i), pj = plan(W, j);
            pts.push([pi[0] + s * (pj[0] - pi[0]), pi[1] + s * (pj[1] - pi[1])]);
          }
        }
        if (pts.length === 2) segs.push(pts);
      }
    });
    return { segs: segs, low: lo, high: hi, cut: h, above: h > hi };
  };
  IMP.glbToObjects = function (glb, axis, cutAbove) {
    var sec = IMP.glbSection(glb, axis, cutAbove);
    var J = IMP.joinSegments(sec.segs, 1e-5);
    var rings = J.rings.map(function (r) { return CLW.geom.simplify(r.concat([r[0]]), 0.05, true).slice(0, -1); });
    var objs = IMP.ringsToBuildings(rings, 0.5);
    return { objects: objs, section: sec, openCount: J.open.length };
  };

  // ------------------------------------------------------------------ finalisation commune
  // centre, applique le nord du plan (degrés horaires depuis le haut, rotation -n)
  IMP.finalize = function (objs, opts) {
    var n = (opts.north || 0) * Math.PI / 180, c = Math.cos(n), s = Math.sin(n);
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    objs.forEach(function (o) { CLW.geom.objBBox(o, b); });
    var cx = opts.center ? (b[0] + b[2]) / 2 : 0, cy = opts.center ? (b[1] + b[3]) / 2 : 0;
    function T(p) { var x = p[0] - cx, y = p[1] - cy; return [c * x - s * y, s * x + c * y]; }
    objs.forEach(function (o) {
      if (o.type === 'building') { o.outer = o.outer.map(T); o.holes = (o.holes || []).map(function (r) { return r.map(T); }); }
      else if (o.type === 'wall') o.pts = o.pts.map(T);
      else if (o.type === 'tree') { var q = T([o.x, o.y]); o.x = q[0]; o.y = q[1]; }
    });
    // recentrage après rotation
    if (opts.center && n) {
      var b2 = [Infinity, Infinity, -Infinity, -Infinity];
      objs.forEach(function (o) { CLW.geom.objBBox(o, b2); });
      var dx = -(b2[0] + b2[2]) / 2, dy = -(b2[1] + b2[3]) / 2;
      objs.forEach(function (o) { CLW.moveObj(o, dx, dy); });
    }
    return objs;
  };

  // ------------------------------------------------------------------ interface
  var pending = null;
  function status(t, cls) { var el = document.getElementById('imp-status'); el.textContent = t; el.className = 'status' + (cls ? ' ' + cls : ''); }
  function opt(html) { document.getElementById('imp-options').innerHTML = html; }
  var esc = function (s) { return CLW.esc(s); };
  var KIND_LAB = { auto: 'auto', building: 'bâtiment', wall: 'mur', tree: 'arbre', ignore: 'ignorer' };

  function northRow() {
    return '<label class="row">Nord du plan, degrés horaires depuis le haut <span class="pair"><input type="number" id="imp-north" value="0" step="1" min="-360" max="360"> °</span></label>';
  }
  function showDXF(name, dxf) {
    var layers = Object.keys(dxf.layers).sort();
    var h = '<div class="hint">' + esc(name) + ' : ' + dxf.ents.length + ' entités, ' + layers.length + ' calques, étendue ' +
      CLW.fmt(dxf.extent, 1) + ' unités.</div>';
    var uSel = dxf.unitFromHeader || dxf.unitGuess;
    h += '<label class="row">Unité du dessin <select id="imp-unit">' +
      [[0.001, 'millimètre'], [0.01, 'centimètre'], [1, 'mètre'], [0.0254, 'pouce'], [0.3048, 'pied']].map(function (u) {
        return '<option value="' + u[0] + '"' + (u[0] === uSel ? ' selected' : '') + '>' + u[1] + '</option>';
      }).join('') + '</select></label>';
    h += '<div class="hint">' + (dxf.unitFromHeader ? 'Unité lue dans le fichier ($INSUNITS).' : 'Unité déduite de l\'étendue du dessin. Vérifiez les dimensions.') + '</div>';
    h += northRow();
    h += '<label class="row">Épaisseur des murs <span class="pair"><input type="number" id="imp-thick" value="0.3" step="0.05" min="0.05" max="5"> m</span></label>';
    h += '<table class="layers"><tr><td><b>Calque</b></td><td><b>Objets</b></td><td><b>Usage</b></td></tr>';
    layers.forEach(function (nm, i) {
      var L = dxf.layers[nm], k = IMP.autoKind(nm);
      h += '<tr><td title="' + esc(nm) + '">' + esc(nm) + '</td><td>' + L.count + '</td><td><select data-layer="' + i + '">' +
        Object.keys(KIND_LAB).map(function (kk) { return '<option value="' + kk + '"' + (kk === k ? ' selected' : '') + '>' + KIND_LAB[kk] + '</option>'; }).join('') +
        '</select></td></tr>';
    });
    h += '</table><div class="hint">Auto : contours fermés en bâtiments, lignes ouvertes en murs, cercles en arbres. Les calques de cotes, textes, hachures, parcelles, voirie, eau, courbes de niveau, niveaux et toitures sont ignorés d\'office.</div>';
    h += '<button id="imp-go" class="primary">Ajouter au plan</button>';
    opt(h);
    pending = { kind: 'dxf', name: name, dxf: dxf, layers: layers };
    document.getElementById('imp-go').onclick = applyPending;
  }
  function showGeo(name, gj) {
    var h = '<div class="hint">' + esc(name) + ' : ' + gj.items.length + ' géométries, coordonnées en ' + (gj.degrees ? 'degrés' : 'mètres') + '.</div>';
    if (gj.degrees) h += '<div class="hint">' + (CLW.state.site ? 'Placées d\'après le site OpenStreetMap.' : 'Pas de site OpenStreetMap : plan centré.') + ' Le nord ne s\'applique pas, ces coordonnées étant déjà orientées.</div>';
    else h += northRow();
    h += '<label class="row">Épaisseur des lignes en murs <span class="pair"><input type="number" id="imp-thick" value="0.3" step="0.05" min="0.05" max="5"> m</span></label>';
    h += '<button id="imp-go" class="primary">Ajouter au plan</button>';
    opt(h);
    pending = { kind: 'geojson', name: name, gj: gj };
    document.getElementById('imp-go').onclick = applyPending;
  }
  function showGLB(name, glb) {
    var h = '<div class="hint">' + esc(name) + ' : ' + glb.ntri + ' triangles.</div>' +
      '<label class="row">Axe vertical <select id="imp-axis"><option value="y">Y (standard glTF)</option><option value="z">Z</option></select></label>' +
      '<label class="row">Hauteur de coupe au-dessus du point le plus bas <span class="pair"><input type="number" id="imp-cut" value="1.5" step="0.1" min="0.1"> m</span></label>' +
      northRow() + '<button id="imp-go" class="primary">Ajouter au plan</button>';
    opt(h);
    pending = { kind: 'glb', name: name, glb: glb };
    document.getElementById('imp-go').onclick = applyPending;
  }
  function val(id, d) { var el = document.getElementById(id); if (!el) return d; var v = CLW.parseNum(el.value); return isFinite(v) ? v : d; }

  // construit les objets selon les options affichées ; renvoie { objects, note } ou lève une erreur
  IMP.buildPending = function (p, o) {
    var objs, note = '', centered = true, north = o.north || 0;
    if (p.kind === 'dxf') {
      var kinds = {};
      p.layers.forEach(function (nm, i) { kinds[nm] = o.layerKinds ? o.layerKinds[nm] || IMP.autoKind(nm) : IMP.autoKind(nm); });
      if (o.layerSel) o.layerSel.forEach(function (v, i) { kinds[p.layers[i]] = v; });
      objs = IMP.dxfToObjects(p.dxf, kinds, o.unit, o.thick);
    } else if (p.kind === 'geojson') {
      var r = IMP.geojsonToObjects(p.gj, CLW.state.site, o.thick);
      objs = r.objects; centered = r.centered;
      if (p.gj.degrees) north = 0;
    } else {
      var g = IMP.glbToObjects(p.glb, o.axis, o.cut);
      if (g.section.above) throw new Error('La coupe (' + CLW.fmt(o.cut, 2) + ' m au-dessus du point le plus bas) est au-dessus du modèle, haut de ' + CLW.fmt(g.section.high - g.section.low, 2) + ' m. Vérifiez l\'axe vertical ou abaissez la coupe.');
      objs = g.objects;
      note = 'Coupe à ' + CLW.fmt(o.cut, 2) + ' m : ' + g.section.segs.length + ' segments, ' + objs.length + ' contours.' + (g.openCount ? ' ' + g.openCount + ' contours ouverts ignorés.' : '');
    }
    if (objs.length > MAX_OBJECTS) throw new Error('Trop d\'objets (' + objs.length + ', maximum ' + MAX_OBJECTS + '). Ignorez des calques ou simplifiez le plan avant l\'import.');
    if (!objs.length) throw new Error('Aucun bâtiment, mur ni arbre reconnu. ' + (p.kind === 'dxf' ? 'Vérifiez l\'usage choisi pour chaque calque.' : 'Vérifiez le fichier.'));
    IMP.finalize(objs, { center: centered, north: north });
    return { objects: objs, note: note };
  };

  function applyPending() {
    if (!pending) return;
    var o = { north: val('imp-north', 0), unit: val('imp-unit', 1), thick: val('imp-thick', 0.3), axis: (document.getElementById('imp-axis') || {}).value || 'y', cut: val('imp-cut', 1.5) };
    if (pending.kind === 'dxf') o.layerSel = Array.prototype.map.call(document.querySelectorAll('#imp-options select[data-layer]'), function (s) { return s.value; });
    var res;
    try { res = IMP.buildPending(pending, o); } catch (e) { status(e.message, 'err'); return; }
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    res.objects.forEach(function (x) { CLW.geom.objBBox(x, b); });
    var counts = { building: 0, wall: 0, tree: 0 };
    res.objects.forEach(function (x) { counts[x.type]++; });
    var grown = CLW.app.addImported(res.objects, pending.name);
    status(pending.name + ' importé : ' + CLW.plur(counts.building, 'bâtiment', 'bâtiments') + ', ' + CLW.plur(counts.wall, 'mur', 'murs') + ', ' + CLW.plur(counts.tree, 'arbre', 'arbres') + '. Emprise ' +
      CLW.fmt(b[2] - b[0], 1) + ' × ' + CLW.fmt(b[3] - b[1], 1) + ' m.' + (res.note ? '\n' + res.note : '') +
      (grown ? '\nDomaine agrandi pour que l\'air puisse contourner le plan.' : '') +
      '\nLe plan forme un groupe déplacé en bloc (Majuscule + glisser : un seul objet).', 'ok');
  }

  IMP.readFile = function (file) {
    if (/\.3dm$/i.test(file.name) && CLW.Import3dm) return CLW.Import3dm.readFile(file);
    status('');
    opt('');
    pending = null;
    if (file.size > MAX_BYTES) { status('Fichier trop lourd (' + CLW.fmt(file.size / 1048576, 0) + ' Mo, maximum 60 Mo). Allégez le plan (calques inutiles, détails) avant l\'import.', 'err'); return; }
    var ext = (file.name.split('.').pop() || '').toLowerCase();
    var rd = new FileReader();
    status('Lecture de ' + file.name + '…');
    rd.onload = function () {
      try {
        if (ext === 'glb') showGLB(file.name, IMP.parseGLB(rd.result));
        else if (ext === 'dxf') {
          if (typeof rd.result !== 'string') throw new Error('lecture');
          showDXF(file.name, IMP.parseDXF(rd.result));
        } else if (ext === 'geojson' || ext === 'json') showGeo(file.name, IMP.parseGeoJSON(rd.result));
        else throw new Error('Format non reconnu : utilisez un fichier .dxf, .geojson, .json, .glb ou .3dm.');
        status('Choisissez les options puis « Ajouter au plan ».');
      } catch (e) { status(e.message, 'err'); }
    };
    rd.onerror = function () { status('Lecture du fichier impossible.', 'err'); };
    if (ext === 'glb') rd.readAsArrayBuffer(file);
    else if (ext === 'dxf') {
      // détecte le DXF binaire avant de le lire en texte
      var head = new FileReader();
      head.onload = function () {
        if (/^AutoCAD Binary DXF/.test(String(head.result))) { status('DXF binaire non pris en charge. Réenregistrez le fichier en DXF ASCII (texte) depuis votre logiciel de dessin.', 'err'); return; }
        rd.readAsText(file);
      };
      head.readAsText(file.slice(0, 22), 'latin1');
    } else rd.readAsText(file);
  };
  IMP.init = function () {
    document.getElementById('imp-file').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (f) IMP.readFile(f);
      e.target.value = '';
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
