#!/usr/bin/env node
/* CL-WIND - génère les fichiers d'exemple du dossier exemples/
 *   node scripts/make_examples.js
 * Géométrie de référence (mètres, x vers l'est, y vers le nord, origine au centre) :
 *   - bâtiment A en L : (-60,-10) (0,-10) (0,10) (-20,10) (-20,30) (-60,30)
 *   - bâtiment B à cour : 50 × 40 m de (20,-40) à (70,0), cour 20 × 16 m de (35,-28) à (55,-12)
 *   - bâtiment C, tracé en 4 lignes : de (20,20) à (45,35)
 *   - bâtiment N (repère du nord), triangle pointant au nord : (-10,60) (10,60) (0,80)
 *   - mur : (-80,-40) à (-20,-40) ; arbres r = 4 m en (-40,-60), (-25,-60), (-10,-60)
 */
'use strict';
var fs = require('fs'), path = require('path');
var OUT = path.join(__dirname, '..', 'exemples');
fs.mkdirSync(OUT, { recursive: true });

var BLD = {
  A: [[-60, -10], [0, -10], [0, 10], [-20, 10], [-20, 30], [-60, 30]],
  B: [[20, -40], [70, -40], [70, 0], [20, 0]],
  Bh: [[35, -28], [55, -28], [55, -12], [35, -12]],
  C: [[20, 20], [45, 20], [45, 35], [20, 35]],
  N: [[-10, 60], [10, 60], [0, 80]]
};
var WALL = [[-80, -40], [-20, -40]];
var TREES = [[-40, -60], [-25, -60], [-10, -60]];

// ------------------------------------------------------------------ DXF ASCII
function dxf(opts) {
  var s = opts.scale || 1, ox = opts.ox || 0, oy = opts.oy || 0, rot = (opts.rotCW || 0) * Math.PI / 180;
  // rotCW : le nord du dessin est tourné de rotCW degrés dans le sens horaire
  function T(p) {
    var c = Math.cos(-rot), sn = Math.sin(-rot);
    var x = c * p[0] - sn * p[1], y = sn * p[0] + c * p[1];
    return [(x * s + ox).toFixed(4), (y * s + oy).toFixed(4)];
  }
  var o = [];
  function w(c, v) { o.push(String(c), String(v)); }
  w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$ACADVER'); w(1, 'AC1015');
  if (opts.insunits != null) { w(9, '$INSUNITS'); w(70, opts.insunits); }
  w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'TABLES'); w(0, 'TABLE'); w(2, 'LAYER'); w(70, 6);
  ['BATIMENTS', 'MURS', 'ARBRES', 'COTES', 'TEXTES', 'CONSTRUCTION'].forEach(function (l) { w(0, 'LAYER'); w(2, l); w(70, 0); w(62, 7); w(6, 'CONTINUOUS'); });
  w(0, 'ENDTAB'); w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'BLOCKS');
  w(0, 'BLOCK'); w(8, '0'); w(2, 'ARBRE_TIGE'); w(70, 0); w(10, 0); w(20, 0); w(30, 0); w(3, 'ARBRE_TIGE');
  w(0, 'CIRCLE'); w(8, '0'); w(10, 0); w(20, 0); w(30, 0); w(40, 1);
  w(0, 'ENDBLK'); w(8, '0');
  w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'ENTITIES');
  function lw(layer, pts, closed, bulges) {
    w(0, 'LWPOLYLINE'); w(8, layer); w(90, pts.length); w(70, closed ? 1 : 0);
    pts.forEach(function (p, i) { var q = T(p); w(10, q[0]); w(20, q[1]); if (bulges && bulges[i]) w(42, bulges[i]); });
  }
  function oldPoly(layer, pts, closed) {
    w(0, 'POLYLINE'); w(8, layer); w(66, 1); w(10, 0); w(20, 0); w(30, 0); w(70, closed ? 1 : 0);
    pts.forEach(function (p) { var q = T(p); w(0, 'VERTEX'); w(8, layer); w(10, q[0]); w(20, q[1]); w(30, 0); });
    w(0, 'SEQEND'); w(8, layer);
  }
  function line(layer, a, b) { var p = T(a), q = T(b); w(0, 'LINE'); w(8, layer); w(10, p[0]); w(20, p[1]); w(30, 0); w(11, q[0]); w(21, q[1]); w(31, 0); }
  lw('BATIMENTS', BLD.A, true);
  oldPoly('BATIMENTS', BLD.B, true);
  lw('BATIMENTS', BLD.Bh, true);
  // C en quatre lignes, dont un doublon
  for (var k = 0; k < 4; k++) line('CONSTRUCTION', BLD.C[k], BLD.C[(k + 1) % 4]);
  line('CONSTRUCTION', BLD.C[0], BLD.C[1]);
  lw('BATIMENTS', BLD.N, true);
  line('MURS', WALL[0], WALL[1]);
  TREES.forEach(function (t, i) {
    var q = T(t);
    if (i === 0) { w(0, 'CIRCLE'); w(8, 'ARBRES'); w(10, q[0]); w(20, q[1]); w(30, 0); w(40, (4 * s).toFixed(4)); }
    else { w(0, 'INSERT'); w(8, 'ARBRES'); w(2, 'ARBRE_TIGE'); w(10, q[0]); w(20, q[1]); w(30, 0); w(41, 4 * s); w(42, 4 * s); w(43, 4 * s); }
  });
  // cote et texte, à ignorer
  var a = T([-60, -20]), b = T([0, -20]);
  w(0, 'LINE'); w(8, 'COTES'); w(10, a[0]); w(20, a[1]); w(30, 0); w(11, b[0]); w(21, b[1]); w(31, 0);
  var t = T([-40, 0]); w(0, 'TEXT'); w(8, 'TEXTES'); w(10, t[0]); w(20, t[1]); w(30, 0); w(40, 2 * s); w(1, 'Batiment A');
  w(0, 'ENDSEC'); w(0, 'EOF');
  return o.join('\r\n') + '\r\n';
}
fs.writeFileSync(path.join(OUT, 'plan_metres.dxf'), dxf({ insunits: 6 }));
fs.writeFileSync(path.join(OUT, 'plan_millimetres.dxf'), dxf({ scale: 1000 }));
fs.writeFileSync(path.join(OUT, 'plan_lambert93.dxf'), dxf({ ox: 355120.5, oy: 6689870.25 }));
fs.writeFileSync(path.join(OUT, 'plan_nord_30.dxf'), dxf({ insunits: 6, rotCW: 30 }));

// ------------------------------------------------------------------ GeoJSON en degrés autour de la place Royale (Nantes), bâti fictif
(function () {
  var lat0 = 47.2133, lon0 = -1.5593, r = lat0 * Math.PI / 180;
  var kx = 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r), ky = 111132.92 - 559.82 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r);
  function ll(p) { return [+(lon0 + p[0] / kx).toFixed(8), +(lat0 + p[1] / ky).toFixed(8)]; }
  function poly(pts) { var c = pts.map(ll); c.push(c[0]); return [c]; }
  var feats = [
    { type: 'Feature', properties: { name: 'Bâtiment A', height: 18 }, geometry: { type: 'Polygon', coordinates: poly(BLD.A) } },
    { type: 'Feature', properties: { name: 'Bâtiment B', 'building:levels': 5 }, geometry: { type: 'Polygon', coordinates: [poly(BLD.B)[0], poly(BLD.Bh)[0]] } },
    { type: 'Feature', properties: { hauteur: '12,5' }, geometry: { type: 'Polygon', coordinates: poly(BLD.C) } },
    { type: 'Feature', properties: { NB_NIV: 2, name: 'Repère nord' }, geometry: { type: 'Polygon', coordinates: poly(BLD.N) } },
    { type: 'Feature', properties: { barrier: 'wall' }, geometry: { type: 'LineString', coordinates: WALL.map(ll) } },
    { type: 'Feature', properties: { natural: 'tree' }, geometry: { type: 'MultiPoint', coordinates: TREES.map(ll) } }
  ];
  fs.writeFileSync(path.join(OUT, 'ilot_degres.geojson'), JSON.stringify({ type: 'FeatureCollection', features: feats }, null, 1));
})();

// ------------------------------------------------------------------ GLB (Y vertical, -Z vers le nord)
(function () {
  var pos = [], idx = [];
  // prisme vertical sur un contour (x, y plan), de z0 à z1 ; glTF : X = x, Y = hauteur, Z = -y
  function prism(ring, z0, z1) {
    var b = pos.length / 3, n = ring.length;
    ring.forEach(function (p) { pos.push(p[0], z0, -p[1]); });
    ring.forEach(function (p) { pos.push(p[0], z1, -p[1]); });
    for (var k = 0; k < n; k++) { var a = k, c = (k + 1) % n; idx.push(b + a, b + c, b + n + c, b + a, b + n + c, b + n + a); }
    // couvercles en éventail (contours convexes ou en étoile suffisent ici)
    for (var m = 1; m + 1 < n; m++) { idx.push(b, b + m + 1, b + m); idx.push(b + n, b + n + m, b + n + m + 1); }
  }
  prism([[-100, -100], [100, -100], [100, 100], [-100, 100]], -0.3, 0); // dalle du terrain
  prism([[-60, -10], [0, -10], [0, 10], [-60, 10]], 0, 15);              // partie basse du L
  prism([[-60, 10], [-20, 10], [-20, 30], [-60, 30]], 0, 15);            // partie haute du L (jointive)
  prism(BLD.C, 0, 12);
  prism(BLD.N, 0, 6);
  prism([[20, -40], [70, -40], [70, -28], [20, -28]], 0, 18);
  prism([[20, -12], [70, -12], [70, 0], [20, 0]], 0, 18);
  prism([[20, -28], [35, -28], [35, -12], [20, -12]], 0, 18);
  prism([[55, -28], [70, -28], [70, -12], [55, -12]], 0, 18);
  prism([[80, 40], [90, 40], [90, 50], [80, 50]], 0, 1);                 // banc bas, sous la coupe
  var P = new Float32Array(pos), I = new Uint32Array(idx);
  var min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (var v = 0; v < P.length; v += 3) for (var c = 0; c < 3; c++) { min[c] = Math.min(min[c], P[v + c]); max[c] = Math.max(max[c], P[v + c]); }
  var bin = Buffer.concat([Buffer.from(P.buffer), Buffer.from(I.buffer)]);
  var json = {
    asset: { version: '2.0', generator: 'CL-WIND make_examples.js' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, translation: [0, 0, 0] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    buffers: [{ byteLength: bin.length }],
    bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: P.byteLength, target: 34962 }, { buffer: 0, byteOffset: P.byteLength, byteLength: I.byteLength, target: 34963 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min: min, max: max }, { bufferView: 1, componentType: 5125, count: I.length, type: 'SCALAR' }]
  };
  var js = Buffer.from(JSON.stringify(json)); var jpad = (4 - js.length % 4) % 4; js = Buffer.concat([js, Buffer.alloc(jpad, 0x20)]);
  var bpad = (4 - bin.length % 4) % 4; bin = Buffer.concat([bin, Buffer.alloc(bpad)]);
  var total = 12 + 8 + js.length + 8 + bin.length, h = Buffer.alloc(12);
  h.writeUInt32LE(0x46546C67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(total, 8);
  function ch(type, data) { var b = Buffer.alloc(8); b.writeUInt32LE(data.length, 0); b.writeUInt32LE(type, 4); return Buffer.concat([b, data]); }
  fs.writeFileSync(path.join(OUT, 'maquette.glb'), Buffer.concat([h, ch(0x4E4F534A, js), ch(0x004E4942, bin)]));
})();

// ------------------------------------------------------------------ EPW fictif
(function () {
  var L = [];
  L.push('LOCATION,VILLE FICTIVE - DONNEES INVENTEES,-,FR,EXEMPLE FICTIF,000000,47.21,-1.56,1.0,20.0');
  L.push('DESIGN CONDITIONS,0');
  L.push('TYPICAL/EXTREME PERIODS,0');
  L.push('GROUND TEMPERATURES,0');
  L.push('HOLIDAYS/DAYLIGHT SAVINGS,No,0,0,0');
  L.push('COMMENTS 1,Fichier EPW FICTIF genere par CL-WIND pour essai. Ne pas utiliser pour un projet.');
  L.push('COMMENTS 2,Vents dominants de sud-ouest inventes.');
  L.push('DATA PERIODS,1,1,Data,Sunday, 1/ 1,12/31');
  var seed = 12345; function rnd() { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }
  var dim = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (var m = 1; m <= 12; m++) for (var d = 1; d <= dim[m - 1]; d++) for (var h = 1; h <= 24; h++) {
    var winter = m <= 3 || m >= 10, u = rnd(), dir;
    if (u < 0.45) dir = 225 + (rnd() - 0.5) * 50; else if (u < 0.7) dir = 270 + (rnd() - 0.5) * 40;
    else if (u < 0.85) dir = 45 + (rnd() - 0.5) * 50; else dir = rnd() * 360;
    var sp = Math.max(0, (winter ? 5.5 : 4) * (0.4 + rnd() * 1.2) * (h > 10 && h < 19 ? 1.15 : 0.85));
    if (rnd() < 0.003) { dir = 999; sp = 999; }
    var row = ['1999', m, d, h, 60, 'FICTIF', 12, 8, 80, 101300, 0, 0, 300, 0, 0, 0, 0, 0, 0, 0, Math.round(((dir % 360) + 360) % 360 === 0 && dir === 999 ? 999 : dir === 999 ? 999 : ((dir % 360) + 360) % 360), sp === 999 ? 999 : sp.toFixed(1), 5, 5, 20, 77777, 9, 999999999, 0, 0, 0, 0, 0, 0];
    L.push(row.join(','));
  }
  fs.writeFileSync(path.join(OUT, 'meteo_FICTIVE_exemple.epw'), L.join('\r\n') + '\r\n');
})();

console.log('Exemples écrits dans', OUT);
fs.readdirSync(OUT).forEach(function (f) { console.log(' ', f, fs.statSync(path.join(OUT, f)).size, 'octets'); });
