/* CL-WIND - main.js
 * Interface : état de la scène, dessin, outils, moteur de calcul, moyenne, affichage.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW;
  var L = CLW.LBM;
  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------------ utilitaires
  function fmt(x, d) {
    if (!isFinite(x)) return '–';
    return Number(x).toFixed(d == null ? 1 : d).replace('.', ',').replace(/^-(0,?0*)$/, '$1');
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function parseNum(v) { return parseFloat(String(v).replace(',', '.')); }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function plur(n, one, many) { return n + ' ' + (Math.abs(n) >= 2 ? many : one); }
  CLW.fmt = fmt; CLW.esc = esc; CLW.parseNum = parseNum; CLW.plur = plur;

  var DIR_NAMES = ['nord', 'nord-nord-est', 'nord-est', 'est-nord-est', 'est', 'est-sud-est', 'sud-est', 'sud-sud-est',
    'sud', 'sud-sud-ouest', 'sud-ouest', 'ouest-sud-ouest', 'ouest', 'ouest-nord-ouest', 'nord-ouest', 'nord-nord-ouest'];
  var DIR_ABBR = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
  function dirName(d) { return DIR_NAMES[Math.round(((d % 360) + 360) % 360 / 22.5) % 16]; }
  function dirAbbr(d) { return DIR_ABBR[Math.round(((d % 360) + 360) % 360 / 22.5) % 16]; }
  function deLe(name) { return /^[aeiouéè]/i.test(name) ? "de l'" + name : 'du ' + name; }
  CLW.dirName = dirName; CLW.dirAbbr = dirAbbr; CLW.deLe = deLe;

  // échelle continue bleu foncé, bleu, vert, jaune, orange, rouge (t de 0 à 1)
  var STOPS = [[0, [12, 26, 92]], [0.2, [33, 102, 220]], [0.4, [46, 170, 90]], [0.6, [240, 220, 60]], [0.8, [245, 140, 40]], [1, [215, 40, 40]]];
  function ramp(t) {
    t = clamp(t, 0, 1);
    for (var k = 1; k < STOPS.length; k++) if (t <= STOPS[k][0]) {
      var a = STOPS[k - 1], b = STOPS[k], u = (t - a[0]) / (b[0] - a[0]);
      return [a[1][0] + u * (b[1][0] - a[1][0]), a[1][1] + u * (b[1][1] - a[1][1]), a[1][2] + u * (b[1][2] - a[1][2])];
    }
    return STOPS[STOPS.length - 1][1];
  }
  var COMFORT = [
    { max: 2, label: 'Calme', sub: '≤ 2 m/s', col: [40, 100, 190] },
    { max: 4, label: 'Debout', sub: '2 à 4', col: [60, 170, 100] },
    { max: 6, label: 'Marche', sub: '4 à 6', col: [235, 210, 70] },
    { max: 8, label: 'Gênant', sub: '6 à 8', col: [240, 140, 45] },
    { max: Infinity, label: 'Inconfortable', sub: '> 8', col: [215, 45, 45] }];
  // écart de vitesse (rapport au vent libre) : bleu plus calme, rouge plus venté, blanc inchangé ; ± 0,5
  function diffColor(d) {
    var t = Math.max(-1, Math.min(1, d / 0.5));
    if (t < 0) { t = -t; return [Math.round(245 - 205 * t), Math.round(245 - 145 * t), Math.round(245 - 45 * t)]; }
    return [Math.round(245 - 25 * t), Math.round(245 - 185 * t), Math.round(245 - 195 * t)];
  }
  CLW.diffColor = diffColor;
  function comfortColor(v) { for (var k = 0; k < COMFORT.length; k++) if (v <= COMFORT[k].max) return COMFORT[k].col; return COMFORT[4].col; }
  CLW.ramp = ramp; CLW.COMFORT = COMFORT; CLW.comfortColor = comfortColor;

  // ------------------------------------------------------------------ état
  var S = CLW.state = {
    objects: [],
    site: null,               // { lat, lon, label, radius, median }
    domain: { W: 450, H: 350 },
    res: 1,
    scrMode: 'auto',          // écrans (briques, lames) : auto, porous, solid
    mode3d: false,            // calcul 3D (hauteur réelle) au lieu du plan 2D
    res3d: 1,                 // finesse 3D : 0 aperçu, 1 normale, 2 fine
    h3d: 0,                   // hauteur max du domaine 3D (m) ; 0 = automatique (3 × l'objet le plus haut)
    cut3d: 1.5,               // hauteur de la coupe horizontale affichée en 3D (m)
    section: null,            // coupe verticale : { a: [x, y], b: [x, y] } en m, ou null (axe du vent)
    vcutFrac: 0.3,            // part de la vue occupée par la coupe verticale
    view3d: false,            // vue 3D en orbite au lieu du plan
    viewMode: 'plan',         // plan, coupe, both (plan + coupe), 3d
    wind: { speed: 5, dir: 270 },
    display: 'speed',
    particles: true,
    tool: 'select',
    sel: null,
    view: { cx: 0, cy: 0, scale: 1 },
    example: true
  };
  var nextId = 1, nextGroup = 1, liveGroup = null;
  function newId() { return nextId++; }
  CLW.newGroup = function () { return 'g' + (nextGroup++); };

  // ------------------------------------------------------------------ historique (50 niveaux)
  var history = [];
  function snapshot() { return JSON.stringify({ objects: S.objects, site: S.site, domain: S.domain, example: S.example }); }
  function pushHistory() { history.push(snapshot()); if (history.length > 50) history.shift(); }
  function undo() {
    if (!history.length) { setHint('Rien à annuler.'); return; }
    var st = JSON.parse(history.pop());
    S.objects = st.objects; S.site = st.site; S.domain = st.domain; S.example = st.example;
    S.objects.forEach(function (o) { if (o.id >= nextId) nextId = o.id + 1; delete o._path; });
    S.sel = null;
    syncDomainInputs();
    sceneChanged();
    updateSel();
  }
  CLW.pushHistory = pushHistory;

  // ------------------------------------------------------------------ scène d'exemple
  function rect(x0, y0, x1, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
  function exampleScene() {
    var o = [], g = 'ex';
    function b(pts, h) { o.push({ id: newId(), type: 'building', outer: pts, holes: [], height: h, src: 'example', group: g }); }
    b(rect(-110, 20, -60, 70), 15); b(rect(-50, 20, 0, 55), 12); b(rect(10, 25, 60, 60), 18);
    b(rect(-110, -60, -40, -15), 12); b(rect(-25, -70, 40, -20), 24);
    b([[70, -40], [120, -40], [120, 30], [95, 30], [95, -10], [70, -10]], 15);
    for (var k = 0; k < 6; k++) o.push({ id: newId(), type: 'tree', x: -100 + k * 14, y: 3, r: 5, a: 0.15, src: 'example', group: g });
    o.push({ id: newId(), type: 'wall', pts: [[60, -80], [130, -80], [130, -60]], thick: 0.4, src: 'example', group: g });
    return o;
  }

  // ------------------------------------------------------------------ moteur
  var E = CLW.engine = {
    solver: null, kind: null, creating: false, pending: false,
    grid: null, lat: null, rast: null,
    mean: null, inst: null, steps: 0, weight: 0, samples: 0, gen: 0,
    paused: false, resetTimer: null, nanResets: 0, stable: false, lastSampleAt: 0
  };

  function initEngine() {
    var forceCpu = /[?&]cpu=1/.test(location.search);
    E.creating = true;
    setBadge('…', '');
    var p = forceCpu ? Promise.resolve(null) : CLW.GpuSolver.create(/[?&]gpu=force/.test(location.search));
    p.then(function (gpu) {
      if (gpu) {
        E.solver = gpu; E.kind = 'gpu';
        gpu.onLost = function () { console.warn('Périphérique WebGPU perdu, repli sur le processeur'); switchToCpu(); };
      } else {
        E.solver = new CLW.CpuSolver(); E.kind = 'cpu';
      }
      E.solver.onSample = onSample;
      var vend = E.kind === 'gpu' ? String(E.solver.info || '').split(' ')[0] : '';
      var VN = { nvidia: 'NVIDIA', intel: 'Intel', amd: 'AMD', apple: 'Apple', qualcomm: 'Qualcomm' };
      setBadge(E.kind === 'gpu' ? 'WebGPU' + (vend ? ' · ' + (VN[vend.toLowerCase()] || vend) : '') : 'Processeur (lent)', E.kind);
      $('engine-badge').title = E.kind === 'gpu' ? 'Carte graphique : ' + (E.solver.info || 'inconnue') +
        (/intel/i.test(vend) ? '. Si l\'ordinateur a aussi une carte NVIDIA ou AMD, lancez l\'application par LANCER-CL-WIND.bat (ou depuis Grasshopper) pour l\'utiliser.' : '') : '';
      E.creating = false;
      // demande reçue pendant la création : rejouée avec la scène à jour
      E.pending = false;
      doReset();
    });
  }
  function switchToCpu() {
    if (E.solver) { try { E.solver.destroy(); } catch (e) { /* rien */ } }
    E.solver = new CLW.CpuSolver(); E.kind = 'cpu'; E.solver.onSample = onSample;
    setBadge('Processeur (lent)', 'cpu');
    doReset();
  }
  function setBadge(t, cls) { var b = $('engine-badge'); b.textContent = t; b.className = 'badge ' + (cls || ''); }

  function sceneChanged() {
    invalidatePaths();
    requestReset();
  }
  CLW.sceneChanged = sceneChanged;
  function requestReset(now) {
    if (E.creating) { E.pending = true; return; }
    if (E.resetTimer) clearTimeout(E.resetTimer);
    E.resetTimer = setTimeout(function () { E.resetTimer = null; doReset(); }, now ? 0 : 120);
  }
  CLW.requestReset = requestReset;

  // ------------------------------------------------------------------ calcul 3D
  // La grille 3D est calculée par CLW.Solver3D ; l'affichage du plan montre la coupe horizontale à
  // S.cut3d, convertie dans les conventions du 2D (E.grid, E.rast, E.mean), si bien que couleurs,
  // sonde, particules, bilan et export fonctionnent sur la coupe sans changement.
  function doReset3D() {
    if (E.solver) { try { E.solver.pause(); } catch (e) { /* rien */ } }
    if (!E.s3) {
      if (E.creating3) return;
      E.creating3 = true; setBadge('…', '');
      CLW.Solver3D.create().then(function (s) {
        E.creating3 = false;
        if (!s) {
          S.mode3d = false; $('d-dim').value = '2d'; $('d-3d').hidden = true;
          $('c-status').textContent = 'Le calcul 3D demande WebGPU (Chrome ou Edge récents) : retour au plan 2D.';
          if (E.solver) E.solver.resume(); requestReset(true); return;
        }
        E.s3 = s; doReset3D();
      });
      return;
    }
    var vend = String(E.s3.info || '').split(' ')[0], VN = { nvidia: 'NVIDIA', intel: 'Intel', amd: 'AMD', apple: 'Apple' };
    setBadge('WebGPU 3D' + (vend ? ' · ' + (VN[vend.toLowerCase()] || vend) : ''), 'gpu');
    var live = CLW.Live && CLW.Live.active ? CLW.Live : null;
    var G = CLW.Vox3D.build({ W: S.domain.W, H: S.domain.H, budget: S.res3d, htop: S.h3d, dir: S.wind.dir, objects: S.objects,
      scene: live ? live.last : null, origin: live && live.origin ? live.origin : [0, 0], joint: live && live.last ? live.last.joint : null });
    E.vox = G;
    // profil : vitesse de référence à 1,5 m ; vitesse réseau bornée en haut du domaine (≤ 0,09)
    var alpha = 0.25, zrefC = 1.5 / G.dx, top = (G.nz - 1) / zrefC;
    var uref = Math.min(0.06, 0.09 / Math.pow(Math.max(1, top), alpha));
    E.uref3 = uref;
    E.s3.reset({ nx: G.nx, ny: G.ny, nz: G.nz, flags: G.flags, drag: G.drag, dir: S.wind.dir, uref: uref, alpha: alpha, zref: zrefC,
      tau0: L.TAU0, cs: L.CS, gam: L.GAM, lamL: L.L_RAPPEL / G.dx, turbI: 0.2, turbL: Math.max(8, Math.max(G.hmax, 1.5) / G.dx) });
    if (E.paused) E.s3.pause();
    E.vplane = sectionPlane();
    E.gen++; E.reading3 = false; E.s3seen = -1; E.vdata = null; E.profile = null; E.profStable = false; E.profBusy = false;
    if (CLW.View3D) CLW.View3D.sceneChanged(G);
    E.steps = 0; E.weight = 0; E.samples = 0; E.stable = false; E.trav = 0; E.t0 = performance.now(); E.travSteps = E.s3.travSteps;
    setSlice3D(true);
    updateCalcStatus();
    drawVcut();
  }
  // trait de coupe (plan, m) : choisi par l'outil Coupe, sinon dans l'axe du vent par le centre du bâtiment
  // (milieu des parois, sans le toit débordant ni les arbres), prolongé jusqu'aux bords du domaine
  function sectionLine() {
    if (S.section) return S.section;
    var th = S.wind.dir * Math.PI / 180, ux = -Math.sin(th), uy = -Math.cos(th);
    var hw = S.domain.W / 2 * 0.98, hh = S.domain.H / 2 * 0.98, bc = CLW.Sun && CLW.Sun.buildingCenter ? CLW.Sun.buildingCenter() : null;
    var cx = bc ? Math.max(-hw, Math.min(hw, bc[0])) : 0, cy = bc ? Math.max(-hh, Math.min(hh, bc[1])) : 0;
    function reach(dx, dy) { // distance du centre au bord du domaine dans la direction (dx, dy)
      var tx = Math.abs(dx) > 1e-9 ? ((dx > 0 ? hw : -hw) - cx) / dx : Infinity, ty = Math.abs(dy) > 1e-9 ? ((dy > 0 ? hh : -hh) - cy) / dy : Infinity;
      return Math.max(0, Math.min(tx, ty));
    }
    var tb = reach(ux, uy), ta = reach(-ux, -uy);
    return { a: [cx - ux * ta, cy - uy * ta], b: [cx + ux * tb, cy + uy * tb], auto: true };
  }
  CLW.sectionLine = sectionLine;
  // plan vertical du solveur 3D le long du trait : [3, 0, { ox, oy, sx, sy, w }] en cellules
  function sectionPlane() {
    var G = E.vox; if (!G) return null;
    var L2 = sectionLine(), ax = (L2.a[0] - G.x0) / G.dx - 0.5, ay = (L2.a[1] - G.ys) / G.dx - 0.5;
    var bx = (L2.b[0] - G.x0) / G.dx - 0.5, by = (L2.b[1] - G.ys) / G.dx - 0.5;
    var len = Math.hypot(bx - ax, by - ay), w = Math.max(2, Math.round(len) + 1);
    return [3, 0, { ox: ax, oy: ay, sx: (bx - ax) / (w - 1), sy: (by - ay) / (w - 1), w: w }];
  }
  function setSection(sec) {
    S.section = sec; needDraw = true;
    if (S.mode3d && E.vox) { E.vplane = sectionPlane(); E.s3seen = -1; }
    showVcut(); drawVcut();
    if (CLW.View3D) CLW.View3D.dirty();
  }
  CLW.setSection = setSection;
  // vues fixes : « coupe » occupe toute la vue, « both » partage la vue (plan en haut, coupe en bas)
  // grandeur affichée dans la coupe : la sienne (S.vdisplay), ou celle du plan (« suit ») si la coupe sait la montrer
  function vdisp() { var v = S.vdisplay || 'suit'; if (v === 'suit') v = S.display; return v === 'temp' || v === 'comfort' ? v : 'speed'; }
  CLW.vdisp = vdisp;
  // dispositions : « both » = plan en haut, coupe en bas ; « cote » = plan à gauche, coupe à droite
  function showVcut() {
    var on = S.viewMode === 'coupe' || S.viewMode === 'both' || S.viewMode === 'cote', side = S.viewMode === 'cote';
    var hgt = S.viewMode === 'coupe' || side ? '100%' : '42%', wid = side ? '46%' : '';
    var w = $('vcut-wrap'); if (!w) return;
    if (w.hidden === !on && w.style.height === hgt && w.style.width === wid) return;
    var wasSide = w.classList.contains('side');
    w.hidden = !on; w.style.height = hgt; w.style.width = wid; w.classList.toggle('side', side);
    // coupe étroite (côte à côte) : cadrée d'emblée sur l'ouvrage (milieu du trait), sol en bas ; double clic = coupe entière
    if (side && !wasSide && (!S.vcutView || S.vcutView.z <= 1.01)) S.vcutView = { z: 3, u: 0.5, v: 0.1, ground: true };
    if (!side && wasSide && S.vcutView && S.vcutView.ground) S.vcutView = { z: 1, u: 0.5, v: 0.5 };
    var ph = $('plan-head'); if (ph) ph.style.right = side ? '46%' : '0';
    fit();
  }
  function vcutPx() { var w = $('vcut-wrap'); return w && !w.hidden ? w.getBoundingClientRect().height : 0; }
  function vcutWpx() { var w = $('vcut-wrap'); return w && !w.hidden && S.viewMode === 'cote' ? w.getBoundingClientRect().width : 0; }

  // couche affichée (hauteur S.cut3d) → conventions du plan 2D
  function setSlice3D(fresh) {
    var G = E.vox; if (!G) return;
    var k = CLW.Vox3D.kOf(G, S.cut3d), layer = CLW.Vox3D.layer2D(G, k), g = G.g2, N = g.nx * g.ny;
    E.kslice = k; E.grid = g; E.rast = layer;
    var wl = CLW.windLattice(S.wind.dir);
    E.lat = { wux: wl[0], wuy: wl[1] };
    E.blockFrac = CLW.blockage(layer.solid, g.nx, g.ny, wl[0], wl[1]);
    var visible = S.objects;
    E.bilan = CLW.Bilan ? CLW.Bilan.prepare(visible, g, layer) : null;
    E.screenCanvas = null;
    if (layer.screenMask) {
      var sc = document.createElement('canvas'); sc.width = g.nx; sc.height = g.ny;
      var scx = sc.getContext('2d'), sim = scx.createImageData(g.nx, g.ny);
      for (var q = 0; q < N; q++) if (layer.screenMask[q]) { sim.data[4 * q] = 255; sim.data[4 * q + 1] = 190; sim.data[4 * q + 2] = 80; sim.data[4 * q + 3] = 255; }
      scx.putImageData(sim, 0, 0); E.screenCanvas = sc;
    }
    if (fresh || !E.mean || E.mean.length !== 3 * N) {
      E.mean = new Float32Array(3 * N); E.inst = null;
      fieldCanvas.width = g.nx; fieldCanvas.height = g.ny; fieldImg = fieldCtx.createImageData(g.nx, g.ny);
      resetParticles();
    }
    E.s3seen = -1; // relire la coupe
    if (CLW.Bilan) CLW.Bilan.render(E, S);
    E.fieldDirty = true; needDraw = true;
    updateDomainInfo();
  }
  function frame3d() {
    var s3 = E.s3; if (!s3) return;
    s3.frame();
    if (E.reading3 || !s3.samples || s3.samples === E.s3seen) return;
    E.reading3 = true;
    var gen = E.gen, seen = s3.samples, k = E.kslice;
    s3.readPlanes([[0, k], E.vplane]).then(function (r) {
      E.reading3 = false;
      if (!r || gen !== E.gen) return;
      var h = r[0], g = E.grid, nx = g.nx, ny = g.ny, sc = L.U_LAT / E.uref3, m = E.mean, bad = false;
      for (var j2 = 0; j2 < ny; j2++) {
        var j3 = ny - 1 - j2;
        for (var i = 0; i < nx; i++) {
          var o = 4 * (j3 * nx + i), d = 3 * (j2 * nx + i);
          m[d] = h.data[o] * sc; m[d + 1] = -h.data[o + 1] * sc; m[d + 2] = h.data[o + 3] * sc;
          if (m[d + 2] !== m[d + 2]) bad = true;
        }
      }
      if (bad) { console.warn('Valeur non finie en 3D : calcul réinitialisé'); E.nanResets++; doReset3D(); return; }
      if (k === E.kslice) E.s3seen = seen;
      E.vdata = r[1];
      E.samples = s3.samples; E.steps = s3.steps; E.trav = s3.trav; E.stable = s3.trav >= 6;
      E.fieldDirty = true; needDraw = true;
      if (E.bilan && CLW.Bilan && (!E.bilanT || performance.now() - E.bilanT > 1000 || E.stable)) { E.bilanT = performance.now(); CLW.Bilan.compute(E, S); CLW.Bilan.render(E, S); }
      updateCalcStatus();
      drawVcut();
      if (!E.profT || performance.now() - E.profT > 6000 || (E.stable && !E.profStable)) { E.profT = performance.now(); if (E.stable) E.profStable = true; updateProfile3D(); }
    }, function (e) { E.reading3 = false; console.warn('Lecture 3D :', e); });
  }
  // bilan intérieur à plusieurs hauteurs (coupes relues sur la carte), de 0,25 m au haut de l'ouvrage
  function updateProfile3D() {
    var G = E.vox; if (!S.mode3d || !G || !E.s3 || E.profBusy || !E.s3.samples) return;
    var top = Math.min(G.hmax + 0.3, G.Htop), step = Math.max(0.2, top / 14), ks = [];
    for (var z = 0.25; z <= top + 1e-6; z += step) { var k = CLW.Vox3D.kOf(G, z); if (ks.indexOf(k) < 0) ks.push(k); }
    E.profBusy = true;
    var gen = E.gen;
    E.s3.readPlanes(ks.map(function (k) { return [0, k]; })).then(function (res) {
      E.profBusy = false;
      if (!res || gen !== E.gen) return;
      var g = G.g2, nx = g.nx, ny = g.ny, sc = L.U_LAT / E.uref3, out = [];
      res.forEach(function (r) {
        var layer = CLW.Vox3D.layer2D(G, r.idx), m2 = new Float32Array(3 * nx * ny);
        for (var j2 = 0; j2 < ny; j2++) { var j3 = ny - 1 - j2; for (var i = 0; i < nx; i++) { var o = 4 * (j3 * nx + i), d = 3 * (j2 * nx + i); m2[d] = r.data[o] * sc; m2[d + 1] = -r.data[o + 1] * sc; m2[d + 2] = r.data[o + 3] * sc; } }
        var tmp = { grid: g, rast: layer, mean: m2, samples: 1, stable: E.stable, trav: E.trav };
        tmp.bilan = CLW.Bilan ? CLW.Bilan.prepare(S.objects, g, layer) : null;
        var rr = tmp.bilan ? CLW.Bilan.compute(tmp, S) : null;
        if (rr) out.push({ z: (r.idx - 0.5) * G.dx, u: rr.uMean / rr.U, pen: rr.pen, qin: rr.qin, wall: !!layer.screens });
      });
      E.profile = out.sort(function (a, b) { return a.z - b.z; });
      drawProfile();
    }, function () { E.profBusy = false; });
  }
  function drawProfile() {
    var cv = $('prof-canvas'); if (!cv) return;
    var r = cv.getBoundingClientRect(), W = Math.max(1, Math.round((r.width || 270) * dpr)), H = Math.round(W * 0.66);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    var c = cv.getContext('2d'); c.clearRect(0, 0, W, H);
    var P = S.mode3d ? E.profile : null;
    $('prof-info').textContent = !S.mode3d ? 'Disponible en calcul 3D : vitesse intérieure et pénétration de 0 à la hauteur de l\'ouvrage.' :
      !P || !P.length ? 'Calcul en cours : le profil apparaît après la première traversée.' :
      'Bleu : vitesse moyenne intérieure / vent libre ; orange : pénétration (air entrant / sans mur). Pointillé : coupe affichée.' + (E.stable ? '' : ' Provisoire.');
    if (!P || !P.length) return;
    var pl = 30 * dpr, pb = 22 * dpr, pt = 8 * dpr, pr = 8 * dpr, gw = W - pl - pr, gh = H - pt - pb;
    var zmax = P[P.length - 1].z, xmax = Math.max(0.5, Math.min(1.5, Math.ceil(Math.max.apply(null, P.map(function (q) { return Math.max(q.u, q.pen); })) * 4) / 4));
    c.font = (10 * dpr) + 'px system-ui, sans-serif'; c.fillStyle = '#8b95a5'; c.strokeStyle = '#2c3340'; c.lineWidth = dpr;
    for (var t = 0; t <= 4; t++) { var x = pl + gw * t / 4; c.beginPath(); c.moveTo(x, pt); c.lineTo(x, pt + gh); c.stroke(); c.fillText(fmt(100 * xmax * t / 4, 0) + ' %', x - 10 * dpr, H - 6 * dpr); }
    for (var zz = 0; zz <= zmax + 1e-6; zz += zmax > 3 ? 1 : 0.5) { var y = pt + gh * (1 - zz / zmax); c.beginPath(); c.moveTo(pl, y); c.lineTo(pl + gw, y); c.stroke(); c.fillText(fmt(zz, 1) + ' m', 2 * dpr, y + 3 * dpr); }
    function curve(key, col, dash, list) {
      c.strokeStyle = col; c.lineWidth = 2 * dpr; c.setLineDash(dash ? [5 * dpr, 4 * dpr] : []); c.beginPath();
      list.forEach(function (q, i) { var x = pl + gw * Math.min(1, q[key] / xmax), y = pt + gh * (1 - q.z / zmax); if (i) c.lineTo(x, y); else c.moveTo(x, y); });
      c.stroke(); c.setLineDash([]);
    }
    var ref = CLW.Variants && CLW.Variants.ref && CLW.Variants.ref.profile;
    if (ref && ref.length) { curve('u', 'rgba(150,160,175,0.7)', false, ref); }
    curve('u', '#4fb3ff', false, P); curve('pen', '#f0a050', false, P);
    var yc = pt + gh * (1 - S.cut3d / zmax);
    if (yc >= pt && yc <= pt + gh) { c.strokeStyle = 'rgba(255,255,255,0.6)'; c.setLineDash([4 * dpr, 3 * dpr]); c.beginPath(); c.moveTo(pl, yc); c.lineTo(pl + gw, yc); c.stroke(); c.setLineDash([]); }
  }
  CLW.drawProfile = drawProfile;

  // coupe verticale le long du trait, sous le plan (3D) ; en 2D, profil de vitesse le long du trait
  function drawVcut() {
    var cv = $('vcut'); if (!cv) return;
    showVcut();
    // coupe masquée : on la calcule quand même pour la vue 3D (texture de la coupe verticale)
    if ($('vcut-wrap').hidden && !(S.view3d && S.v3 && S.v3.v)) return;
    if ($('vcut-note')) $('vcut-note').hidden = S.mode3d;
    if (!S.mode3d) { drawLine2D(cv); return; }
    if (!E.vdata || !E.vox) {
      var rq = cv.getBoundingClientRect(), Wq = Math.max(1, Math.round(rq.width * dpr)), Hq = Math.max(1, Math.round(rq.height * dpr));
      if (cv.width !== Wq || cv.height !== Hq) { cv.width = Wq; cv.height = Hq; }
      var cq = cv.getContext('2d'); cq.fillStyle = '#0b0d11'; cq.fillRect(0, 0, Wq, Hq);
      cq.fillStyle = '#8b95a5'; cq.font = (13 * dpr) + 'px system-ui, sans-serif'; cq.textAlign = 'center'; cq.textBaseline = 'middle';
      cq.fillText('Coupe verticale 3D : en attente du premier résultat du calcul…', Wq / 2, Hq / 2); cq.textAlign = 'left';
      return;
    }
    var G = E.vox, vd = E.vdata, w = vd.w, h = vd.h, plane = G.nx * G.ny, pp = E.vplane && E.vplane[2];
    var r = cv.getBoundingClientRect(), W = Math.max(1, Math.round(r.width * dpr)), Hh = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== Hh) { cv.width = W; cv.height = Hh; }
    var c2 = cv.getContext('2d');
    var img = c2.createImageData(w, h), sc = 1 / E.uref3, sp = S.wind.speed;
    // affichage « Temp. » : température de l'air et des matériaux dans la coupe
    var TS = null, dv = vdisp();
    if (dv === 'temp' && CLW.Thermal && CLW.Thermal.sectionTemp) { try { TS = CLW.Thermal.sectionTemp(); } catch (er) { console.error(er); } }
    E.vcutTemp = TS && TS.w === w && TS.h === h ? TS : null; TS = E.vcutTemp;
    for (var z = 0; z < h; z++) for (var x = 0; x < w; x++) {
      var ci = pp ? Math.min(G.nx - 1, Math.max(0, Math.round(pp.ox + pp.sx * x))) : x, cj = pp ? Math.min(G.ny - 1, Math.max(0, Math.round(pp.oy + pp.sy * x))) : vd.idx;
      var o = 4 * ((h - 1 - z) * w + x), id = z * plane + cj * G.nx + ci;
      var col;
      var tc = TS ? CLW.Thermal.sectionColor(TS, z * w + x) : null;
      if (tc) col = tc;
      else if (G.flags[id] & 1) col = z === 0 ? [70, 66, 60] : [40, 44, 52];
      else if (TS) col = [50, 54, 62];
      else {
        var rr = vd.data[4 * ((z * w) + x) + 3] * sc;
        col = dv === 'comfort' ? comfortColor(rr * sp) : ramp(rr / 2);
        if (G.drag[id] > 0) col = [Math.min(255, col[0] + 60), Math.min(255, col[1] + 40), col[2]];
      }
      img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
    }
    var t = document.createElement('canvas'); t.width = w; t.height = h; t.getContext('2d').putImageData(img, 0, 0);
    // copie pour la vue 3D : l'air à la température extérieure (beige) y est presque transparent, pour qu'on voie le refuge derrière la coupe
    E.vcutCanvas3 = null;
    if (TS) {
      var t3 = document.createElement('canvas'); t3.width = w; t3.height = h; var c3 = t3.getContext('2d'), im3 = c3.createImageData(w, h); im3.data.set(img.data);
      for (var z3 = 0; z3 < h; z3++) for (var x3 = 0; x3 < w; x3++) { var q3 = z3 * w + x3; if (TS.kind[q3] === 0 && Math.abs(TS.T[q3] - TS.Ta) < 0.25) im3.data[4 * ((h - 1 - z3) * w + x3) + 3] = 22; }
      c3.putImageData(im3, 0, 0); E.vcutCanvas3 = t3;
    }
    E.vcutCanvas = t; E.vcutGeom = sectionLine();
    if (CLW.View3D) CLW.View3D.dirty();
    c2.fillStyle = '#0b0d11'; c2.fillRect(0, 0, W, Hh);
    // échelle réelle : par défaut la coupe entière tient dans le cadre ; molette = zoom, glisser = déplacer
    var V = S.vcutView || (S.vcutView = { z: 1, u: 0.5, v: 0.5 });
    var top = 22 * dpr, left = 34 * dpr, s0 = Math.min((W - left) / w, (Hh - top) / h), s = s0 * V.z;
    var dw = w * s, dh = h * s;
    if (V.ground) V.v = Math.max(0, Math.min(1, ((Hh - top) / 2 - 26 * dpr) / dh)); // sol calé en bas du cadre
    var ox = left + (W - left) / 2 - V.u * dw, oy = top + (Hh - top) / 2 - (1 - V.v) * dh;
    E.vcutLayout = { ox: ox, oy: oy, s: s, w: w, h: h, left: left, top: top, W: W, Hh: Hh, s0: s0 };
    c2.imageSmoothingEnabled = V.z < 2; c2.drawImage(t, ox, oy, dw, dh);
    // géométrie exacte (maillages Grasshopper) coupée par le plan vertical : briques et lames en terre cuite
    var SLg = sectionLine(), segs = sectionGeometry(SLg), Lg = Math.hypot(SLg.b[0] - SLg.a[0], SLg.b[1] - SLg.a[1]) || 1;
    function sx(tm) { return ox + (tm / Lg) * (w - 1) * s + s / 2; }
    function sy(zm) { return oy + dh - (zm / G.dx + 1) * s; }
    if (segs) {
      c2.lineCap = 'round';
      [['vol', 'rgba(215,220,228,0.95)'], ['scr', 'rgba(232,128,62,1)']].forEach(function (k) {
        var L2 = segs[k[0]]; if (!L2.length) return;
        c2.strokeStyle = k[1]; c2.lineWidth = Math.max(1.5 * dpr, Math.min(3 * dpr, 0.02 * s / G.dx * 6));
        c2.beginPath();
        for (var q = 0; q < L2.length; q += 4) { c2.moveTo(sx(L2[q]), sy(L2[q + 1])); c2.lineTo(sx(L2[q + 2]), sy(L2[q + 3])); }
        c2.stroke();
      });
    }
    var zc = (E.kslice - 0.5) * G.dx, yz = oy + dh - (zc / G.dx + 0.5) * s;
    c2.strokeStyle = 'rgba(255,255,255,0.8)'; c2.setLineDash([6 * dpr, 4 * dpr]); c2.lineWidth = dpr;
    c2.beginPath(); c2.moveTo(Math.max(left, ox), yz); c2.lineTo(Math.min(W, ox + dw), yz); c2.stroke(); c2.setLineDash([]);
    // axe des hauteurs
    if (CLW.Probe) CLW.Probe.drawCut3D(c2, sx, sy, SLg, Lg, dpr);
    c2.fillStyle = '#0b0d11'; c2.fillRect(0, 0, left, Hh); c2.fillRect(0, 0, W, top);
    c2.fillStyle = '#8b95a5'; c2.font = (10 * dpr) + 'px system-ui, sans-serif'; c2.textBaseline = 'middle';
    var stepH = G.Htop / V.z > 12 ? 5 : G.Htop / V.z > 6 ? 2 : G.Htop / V.z > 2.5 ? 1 : 0.5;
    for (var hz = 0; hz <= G.Htop + 1e-6; hz += stepH) { var yy = sy(hz); if (yy > top && yy < Hh) { c2.fillText(fmt(hz, stepH < 1 ? 1 : 0) + ' m', 3 * dpr, yy); c2.fillRect(left - 4 * dpr, yy, 4 * dpr, dpr); } }
    c2.fillStyle = '#c9ced6'; c2.font = (11 * dpr) + 'px system-ui, sans-serif'; c2.textBaseline = 'top';
    var SL = SLg, Lm = Lg;
    c2.fillText('Coupe A → B' + (SL.auto ? ' (axe du vent)' : '') + ', ' + fmt(Lm, 1) + ' m · pointillé : coupe horizontale à ' + fmt(zc, 2) + ' m' +
      (segs ? ' · terre cuite : briques et lames' : '') + (V.z > 1.01 ? ' · zoom × ' + fmt(V.z, 1) : '') +
      (TS ? ' · température de l\'air et des matériaux (air dehors ' + fmt(TS.Ta, 1) + ' °C), survol : valeurs' : dv === 'temp' ? ' · température : en attente du calcul thermique' : ''), 8 * dpr, 4 * dpr);
    c2.fillStyle = 'rgba(14,17,22,0.8)'; var hlp = 'molette : zoom · glisser : déplacer · double clic : coupe entière';
    c2.font = (10 * dpr) + 'px system-ui, sans-serif'; var hw = c2.measureText(hlp).width;
    c2.fillRect(W - hw - 14 * dpr, Hh - 18 * dpr, hw + 10 * dpr, 16 * dpr); c2.fillStyle = '#8b95a5'; c2.fillText(hlp, W - hw - 9 * dpr, Hh - 16 * dpr);
    c2.font = (11 * dpr) + 'px system-ui, sans-serif'; c2.fillStyle = '#c9ced6';
    c2.fillText(ox >= left ? 'A' : '◀ A', Math.max(left, ox) + 4 * dpr, top + 2 * dpr); c2.fillText(ox + dw <= W ? 'B' : 'B ▶', Math.min(W, ox + dw) - 26 * dpr, top + 2 * dpr);
  }
  // intersection des maillages 3D (liaison Grasshopper) avec le plan vertical du trait : segments (t, z) en m
  function sectionGeometry(SL) {
    var live = CLW.Live && CLW.Live.active ? CLW.Live : null, m3 = live && live.last && live.last.mesh3d;
    if (!m3) return null;
    var key = [SL.a[0], SL.a[1], SL.b[0], SL.b[1], live.rev, live.origin && live.origin.join(',')].join('|');
    if (E.vcutSegKey === key) return E.vcutSegs;
    var org = live.origin || [0, 0], ax = SL.a[0], ay = SL.a[1], dxl = SL.b[0] - ax, dyl = SL.b[1] - ay, L2 = Math.hypot(dxl, dyl) || 1;
    var ux = dxl / L2, uy = dyl / L2, nx2 = -uy, ny2 = ux, out = { vol: [], scr: [] };
    [['vol', m3.volumes], ['scr', m3.ecrans]].forEach(function (grp) {
      (grp[1] || []).forEach(function (m) {
        var v = m[0], f = m[1];
        for (var q = 0; q < f.length; q += 3) {
          var pts = [];
          for (var e = 0; e < 3; e++) {
            var i = 3 * f[q + e], j = 3 * f[q + (e + 1) % 3];
            var pix = v[i] - org[0] - ax, piy = v[i + 1] - org[1] - ay, pjx = v[j] - org[0] - ax, pjy = v[j + 1] - org[1] - ay;
            var di = pix * nx2 + piy * ny2, dj = pjx * nx2 + pjy * ny2;
            if ((di < 0) !== (dj < 0)) {
              var k = di / (di - dj), tx = pix + k * (pjx - pix), ty = piy + k * (pjy - piy);
              var tt = tx * ux + ty * uy;
              if (tt >= -0.01 && tt <= L2 + 0.01) pts.push(tt, v[i + 2] + k * (v[j + 2] - v[i + 2]));
            }
          }
          if (pts.length === 4) out[grp[0]].push(pts[0], pts[1], pts[2], pts[3]);
        }
      });
    });
    E.vcutSegKey = key; E.vcutSegs = out;
    return out;
  }
  // zoom et déplacement dans la coupe verticale
  (function () {
    var cv = $('vcut'), drag = null;
    function rel(e) { var r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; }
    cv.addEventListener('wheel', function (e) {
      var Lt = E.vcutLayout; if (!Lt || !S.mode3d) return;
      e.preventDefault();
      var V = S.vcutView, p = rel(e), du = (p[0] - Lt.ox) / (Lt.w * Lt.s), dv = 1 - (p[1] - Lt.oy) / (Lt.h * Lt.s); V.ground = false;
      var z2 = clamp(V.z * Math.exp(-e.deltaY * 0.0015), 1, 12), s2 = Lt.s0 * z2;
      V.u = (Lt.left + (Lt.W - Lt.left) / 2 - (p[0] - du * Lt.w * s2)) / (Lt.w * s2);
      V.v = 1 - (Lt.top + (Lt.Hh - Lt.top) / 2 - (p[1] - (1 - dv) * Lt.h * s2)) / (Lt.h * s2);
      V.z = z2; if (z2 <= 1.001) { V.u = 0.5; V.v = 0.5; }
      drawVcut();
    }, { passive: false });
    cv.addEventListener('mousedown', function (e) { if (E.vcutLayout && S.mode3d) { S.vcutView.ground = false; drag = { p: rel(e), u: S.vcutView.u, v: S.vcutView.v }; e.preventDefault(); } });
    window.addEventListener('mousemove', function (e) {
      if (!drag) return;
      var Lt = E.vcutLayout, p = rel(e);
      S.vcutView.u = drag.u - (p[0] - drag.p[0]) / (Lt.w * Lt.s); S.vcutView.v = drag.v + (p[1] - drag.p[1]) / (Lt.h * Lt.s);
      drawVcut();
    });
    window.addEventListener('mouseup', function () { drag = null; });
    // sonde de température dans la coupe (affichage « Temp. »)
    cv.addEventListener('mousemove', function (e) {
      if (drag) return;
      var Lt = E.vcutLayout, TS = E.vcutTemp;
      if (!Lt || !TS || vdisp() !== 'temp' || !CLW.Thermal.sectionProbe) { if (cv.title) cv.title = ''; return; }
      var p = rel(e), px = Math.floor((p[0] - Lt.ox) / Lt.s), pz = Lt.h - 1 - Math.floor((p[1] - Lt.oy) / Lt.s);
      cv.title = CLW.Thermal.sectionProbe(TS, px, pz);
    });
    cv.addEventListener('dblclick', function () { S.vcutView = { z: 1, u: 0.5, v: 0.5 }; drawVcut(); });
    // outil Sonde : un clic dans la coupe pose la sonde P à cet endroit (position le long du trait et hauteur)
    var down = null;
    cv.addEventListener('mousedown', function (e) { down = rel(e); }, true);
    cv.addEventListener('click', function (e) {
      if (S.tool !== 'probe' || !CLW.Probe) return;
      var p = rel(e); if (down && Math.hypot(p[0] - down[0], p[1] - down[1]) > 4 * dpr) return;
      var SL = sectionLine(), f, z = null, r = cv.getBoundingClientRect(), W = r.width * dpr;
      if (S.mode3d && E.vcutLayout && E.vox) {
        var Lt = E.vcutLayout, G = E.vox, dh = Lt.h * Lt.s;
        f = ((p[0] - Lt.ox - Lt.s / 2) / Lt.s) / Math.max(1, Lt.w - 1);
        z = Math.max(0.05, ((Lt.oy + dh - p[1]) / Lt.s - 1) * G.dx);
      } else { var pl = 40 * dpr, gw = W - pl - 10 * dpr; f = (p[0] - pl) / gw; }
      if (!(f >= 0 && f <= 1)) return;
      CLW.Probe.set({ x: SL.a[0] + (SL.b[0] - SL.a[0]) * f, y: SL.a[1] + (SL.b[1] - SL.a[1]) * f, z: z });
    });
  })();
  // 2D : vitesse moyenne le long du trait (courbe), solides en gris
  function drawLine2D(cv) {
    var r = cv.getBoundingClientRect(), W = Math.max(1, Math.round(r.width * dpr)), Hh = Math.max(1, Math.round(r.height * dpr));
    if (cv.width !== W || cv.height !== Hh) { cv.width = W; cv.height = Hh; }
    var c2 = cv.getContext('2d'); c2.fillStyle = '#0b0d11'; c2.fillRect(0, 0, W, Hh);
    if (!E.grid || !E.samples) return;
    var SL = sectionLine(), Lm = Math.hypot(SL.b[0] - SL.a[0], SL.b[1] - SL.a[1]), n = Math.max(2, Math.round(Lm / E.grid.dx) + 1);
    var pl = 40 * dpr, pr = 10 * dpr, pt = 22 * dpr, pb = 18 * dpr, gw = W - pl - pr, gh = Hh - pt - pb, vmax = 2 * S.wind.speed;
    c2.strokeStyle = '#2c3340'; c2.lineWidth = dpr; c2.fillStyle = '#8b95a5'; c2.font = (10 * dpr) + 'px system-ui, sans-serif';
    for (var t = 0; t <= 4; t++) { var y = pt + gh * (1 - t / 4); c2.beginPath(); c2.moveTo(pl, y); c2.lineTo(pl + gw, y); c2.stroke(); c2.fillText(fmt(vmax * t / 4, 1), 4 * dpr, y - 5 * dpr); }
    var g = E.grid, prev = null;
    c2.strokeStyle = '#4fb3ff'; c2.lineWidth = 2 * dpr; c2.beginPath();
    for (var i = 0; i < n; i++) {
      var f = i / (n - 1), x = SL.a[0] + (SL.b[0] - SL.a[0]) * f, yw = SL.a[1] + (SL.b[1] - SL.a[1]) * f;
      var ci = Math.floor((x - g.x0) / g.dx), cj = Math.floor((g.y0 - yw) / g.dx), px = pl + gw * f;
      if (ci < 0 || cj < 0 || ci >= g.nx || cj >= g.ny) { prev = null; continue; }
      var k = cj * g.nx + ci;
      if (E.rast.solid[k]) { c2.save(); c2.fillStyle = 'rgba(120,130,145,0.5)'; c2.fillRect(px - gw / n, pt, 2 * gw / n + 1, gh); c2.restore(); prev = null; continue; }
      var v = E.mean[3 * k + 2] * S.wind.speed / L.U_LAT, py = pt + gh * (1 - Math.min(1, v / vmax));
      if (prev) c2.lineTo(px, py); else c2.moveTo(px, py);
      prev = [px, py];
    }
    c2.stroke();
    c2.fillStyle = '#c9ced6'; c2.font = (11 * dpr) + 'px system-ui, sans-serif'; c2.textBaseline = 'top';
    if (CLW.Probe) CLW.Probe.drawCut2D(c2, pl, gw, pt, gh, SL, Lm, dpr);
    c2.fillText('Plan 2D : vitesse moyenne (m/s) le long du trait A → B' + (SL.auto ? ' (axe du vent)' : '') + ', ' + fmt(Lm, 1) + ' m · gris : obstacle · outil Coupe (C) pour déplacer le trait', 8 * dpr, 4 * dpr);
  }

  function doReset() {
    if (E.creating) { E.pending = true; return; }
    if (S.mode3d) { doReset3D(); return; }
    if (E.s3) E.s3.pause();
    if ($('vcut')) $('vcut').hidden = true;
    if (!E.solver) return;
    if (!E.paused) E.solver.resume();
    var vend2 = E.kind === 'gpu' ? String(E.solver.info || '').split(' ')[0] : '';
    setBadge(E.kind === 'gpu' ? 'WebGPU' + (vend2 ? ' · ' + ({ nvidia: 'NVIDIA', intel: 'Intel', amd: 'AMD' }[vend2.toLowerCase()] || vend2) : '') : 'Processeur (lent)', E.kind);
    var g = CLW.makeGrid(S.domain.W, S.domain.H, S.res, E.kind === 'gpu');
    var objs = visibleObjects(g);
    var rast = CLW.rasterize(objs, g, { dir: S.wind.dir, scrMode: S.scrMode });
    var lat = CLW.buildLattice(g, rast, S.wind.dir);
    E.grid = g; E.rast = rast; E.lat = lat;
    E.bilan = CLW.Bilan ? CLW.Bilan.prepare(objs, g, rast) : null;
    if (CLW.Bilan) CLW.Bilan.render(E, S);
    E.screenCanvas = null;
    if (rast.screenMask) {
      var sc = document.createElement('canvas'); sc.width = g.nx; sc.height = g.ny;
      var scx = sc.getContext('2d'), sim = scx.createImageData(g.nx, g.ny);
      for (var q = 0; q < rast.screenMask.length; q++) if (rast.screenMask[q]) { sim.data[4 * q] = 255; sim.data[4 * q + 1] = 190; sim.data[4 * q + 2] = 80; sim.data[4 * q + 3] = 255; }
      scx.putImageData(sim, 0, 0); E.screenCanvas = sc;
    }
    E.blockFrac = CLW.blockage(rast.solid, g.nx, g.ny, lat.wux, lat.wuy);
    var N = g.nx * g.ny;
    E.mean = new Float32Array(3 * N); E.inst = null;
    E.steps = 0; E.weight = 0; E.samples = 0; E.stable = false; E.trav = 0; E.t0 = performance.now();
    E.gen++;
    E.travSteps = (g.nx * Math.abs(lat.wux) + g.ny * Math.abs(lat.wuy)) / (L.U_LAT * L.U_LAT);
    var every = Math.max(10, Math.round(E.travSteps / 60));
    E.solver.reset(lat, every);
    if (E.paused) E.solver.pause();
    fieldCanvas.width = g.nx; fieldCanvas.height = g.ny;
    fieldImg = fieldCtx.createImageData(g.nx, g.ny);
    E.fieldDirty = true;
    resetParticles();
    updateDomainInfo();
    updateCalcStatus();
    drawVcut();
  }
  CLW.doReset = doReset;

  // objets touchant le domaine
  function visibleObjects(g) {
    var hw = g.W / 2, hh = g.H / 2;
    return S.objects.filter(function (o) {
      var b = CLW.geom.objBBox(o);
      return b[2] >= -hw && b[0] <= hw && b[3] >= -hh && b[1] <= hh;
    });
  }

  function onSample(vel, dsteps, ok) {
    var N = E.grid.nx * E.grid.ny;
    if (vel.length !== 2 * N) return;
    // valeur non finie : réinitialisation
    var finite = ok;
    for (var i = 0; i < vel.length && finite; i += 7) if (!isFinite(vel[i])) finite = false;
    if (finite) for (var j = 0; j < vel.length; j++) if (vel[j] !== vel[j] || vel[j] === Infinity || vel[j] === -Infinity) { finite = false; break; }
    if (!finite) {
      E.nanResets++;
      console.warn('Valeur non finie : calcul réinitialisé');
      doReset();
      return;
    }
    E.inst = vel;
    E.steps += dsteps;
    var trav = CLW.traversals(E.steps, E.grid.nx, E.grid.ny, E.lat.wux, E.lat.wuy);
    var m = E.mean, a, k;
    if (E.samples === 0) {
      for (k = 0; k < N; k++) {
        var x = vel[2 * k], y = vel[2 * k + 1];
        m[3 * k] = x; m[3 * k + 1] = y; m[3 * k + 2] = Math.sqrt(x * x + y * y);
      }
    } else if (trav < 2) {
      a = 0.12; // mise en régime : moyenne glissante
      for (k = 0; k < N; k++) {
        var x1 = vel[2 * k], y1 = vel[2 * k + 1];
        m[3 * k] += a * (x1 - m[3 * k]); m[3 * k + 1] += a * (y1 - m[3 * k + 1]);
        m[3 * k + 2] += a * (Math.sqrt(x1 * x1 + y1 * y1) - m[3 * k + 2]);
      }
    } else {
      // moyenne cumulée pondérée par le nombre de pas
      if (E.weight === 0) {
        for (k = 0; k < N; k++) {
          var x2 = vel[2 * k], y2 = vel[2 * k + 1];
          m[3 * k] = x2; m[3 * k + 1] = y2; m[3 * k + 2] = Math.sqrt(x2 * x2 + y2 * y2);
        }
        E.weight = dsteps;
      } else {
        var wn = dsteps / (E.weight + dsteps);
        for (k = 0; k < N; k++) {
          var x3 = vel[2 * k], y3 = vel[2 * k + 1];
          m[3 * k] += wn * (x3 - m[3 * k]); m[3 * k + 1] += wn * (y3 - m[3 * k + 1]);
          m[3 * k + 2] += wn * (Math.sqrt(x3 * x3 + y3 * y3) - m[3 * k + 2]);
        }
        E.weight += dsteps;
      }
    }
    E.samples++;
    E.trav = trav;
    E.stable = trav >= 6;
    E.fieldDirty = true;
    // coupe (vues « Coupe » et « Plan + coupe ») : environ une fois par seconde
    if ((S.viewMode === 'coupe' || S.viewMode === 'both' || S.viewMode === 'cote') && (!E.vcutT || performance.now() - E.vcutT > 1000 || E.stable)) { E.vcutT = performance.now(); drawVcut(); }
    // bilan intérieur / extérieur : environ une fois par seconde
    if (E.bilan && CLW.Bilan && (!E.bilanT || performance.now() - E.bilanT > 1000 || E.stable)) {
      E.bilanT = performance.now(); CLW.Bilan.compute(E, S); CLW.Bilan.render(E, S);
    }
    E.lastSampleAt = performance.now();
    updateCalcStatus();
  }

  function updateCalcStatus() {
    var st = $('c-status'), bar = $('c-bar');
    var t = E.trav || 0;
    if (!E.solver) { st.textContent = 'Préparation du calcul…'; return; }
    if (E.samples === 0) t = 0;
    bar.style.width = Math.min(100, t / 6 * 100) + '%';
    bar.className = E.stable ? 'done' : '';
    var txt;
    if (E.samples === 0) txt = 'Démarrage du calcul…';
    else if (t < 2) txt = 'Mise en régime : ' + fmt(t, 1) + ' / 2 traversées';
    else if (!E.stable) txt = 'Moyenne en cours : ' + fmt(t, 1) + ' / 6 traversées';
    else txt = 'Moyenne stabilisée (' + fmt(t, 1) + ' traversées)';
    if (E.paused) txt += ' · en pause';
    // estimation du temps restant jusqu'à la moyenne stabilisée, d'après la vitesse mesurée
    if (!E.stable && !E.paused && E.steps > 0 && E.t0 && E.travSteps) {
      var el = (performance.now() - E.t0) / 1000, rate = E.steps / Math.max(0.5, el);
      var left = Math.max(0, 6 * E.travSteps - E.steps) / Math.max(1, rate);
      if (el > 5) txt += ' · ' + fmt(rate, 0) + ' pas/s, encore ≈ ' + (left < 90 ? fmt(left, 0) + ' s' : fmt(left / 60, 0) + ' min');
    }
    st.textContent = txt;
    st.className = 'status' + (E.stable ? ' ok' : '');
    var bn = $('banner');
    if (bn) {
      if (!E.samples) { bn.hidden = false; bn.className = ''; bn.textContent = 'Calcul en démarrage…'; }
      else if (!E.stable) { bn.hidden = false; bn.className = ''; bn.textContent = 'Résultats provisoires · ' + txt; }
      else { bn.hidden = false; bn.className = 'ok'; bn.textContent = 'Moyenne stabilisée' + (S.mode3d ? ' · 3D, coupe à ' + fmt(S.cut3d, 2) + ' m' : ''); }
    }
  }

  // ------------------------------------------------------------------ panneau Domaine
  function updateDomainInfo() {
    var g = E.grid; if (!g) return;
    if (S.mode3d && E.vox) {
      var V3 = E.vox;
      $('d-info').innerHTML = 'Grille 3D ' + V3.nx + ' × ' + V3.ny + ' × ' + V3.nz + ' cellules (' + fmt(V3.nx * V3.ny * V3.nz / 1e6, 1) + ' M), cellule de ' +
        fmt(V3.dx * 100, 1) + ' cm, domaine haut de ' + fmt(V3.Htop, 1) + ' m. Coupe affichée à ' + fmt((E.kslice - 0.5) * V3.dx, 2) + ' m.' +
        (V3.screenLayers ? ' Écran poreux sur ' + V3.screenLayers + ' couches.' : '') + ' Découpage : ' + fmt(V3.ms / 1000, 1) + ' s.';
    } else
    $('d-info').innerHTML = 'Grille ' + g.nx + ' × ' + g.ny + ' cellules, cellule de ' + (g.dx < 0.1 ? fmt(g.dx * 100, 1) + ' cm.' : fmt(g.dx, 2) + ' m.') +
      (E.kind === 'cpu' ? ' Grille réduite sur processeur.' : '') +
      (g.memCapped ? ' Limitée par la mémoire de la carte graphique.' : '');
    if (E.rast.screenMode === 'solid') $('d-info').innerHTML += '<div class="screen-info">Briques et lames : <b>éléments pleins résolus</b> (épaisseur médiane ' +
      fmt(E.rast.screenThick * 100, 1) + ' cm, soit ' + fmt(E.rast.screenThick / g.dx, 1) + ' cellule(s)) : l\'air passe dans les joints.' +
      (E.rast.screenThick < 1.5 * g.dx ? ' Éléments de moins d\'une cellule et demie : un joint de moins de deux cellules se referme, seuls les joints plus larges laissent passer l\'air.' : '') + '</div>';
    else if (E.rast.screenMode === 'porous' && S.scrMode !== 'porous' && !S.mode3d) $('d-info').innerHTML += '<div class="hint">Briques et lames en bande poreuse : éléments de ' +
      fmt(E.rast.screenThick * 100, 1) + ' cm, plus fins qu\'une cellule. Pour voir l\'air passer dans les joints, il faut des cellules de ' +
      fmt(E.rast.screenThick * 100, 1) + ' cm au plus : résolution plus fine ou domaine plus petit.</div>';
    if (E.rast.screens) {
      $('d-info').innerHTML += E.rast.screens.filter(function (s) { return s.area > 4 * g.dx * g.dx; }).map(function (s, k) {
        var rng = s.phiMax - s.phiMin > 0.05 ? ' (de ' + fmt(s.phiMin * 100, 0) + ' à ' + fmt(s.phiMax * 100, 0) + ' % selon l\'endroit)' : '';
        return '<div class="screen-info">Écran poreux ' + (k + 1) + ' : surface ouverte <b>' + fmt(s.phi * 100, 0) + ' %</b>' + rng + ', perte de charge K = ' + fmt(s.K, 1) +
          ', bande de ' + fmt(s.W, 2) + ' m (joints soudés jusqu\'à ' + fmt(2 * s.joint, 2) + ' m).' +
          (s.nCross < 20 ? ' Peu de traversées mesurées : porosité incertaine.' : '') + '</div>';
      }).join('') + '<div class="hint">Écran = éléments trop fins pour la grille, remplacés par une bande à perte de charge. La surface ouverte est mesurée perpendiculairement à l\'écran : elle change avec l\'angle des lames.</div>';
    }
    var w = [];
    var bf = E.rast.builtFrac;
    if (bf > 0.2) w.push('<div class="warn">Tissu dense : ' + fmt(bf * 100, 0) + ' % de la surface est bâtie. En 2D, le vent ne peut pas passer au-dessus des toits : les vitesses dans les rues sont surestimées.</div>');
    if (E.blockFrac > 0.3) w.push('<div class="warn">Blocage : ' + fmt(E.blockFrac * 100, 0) + ' % de la largeur face au vent est barrée. Agrandissez le domaine pour laisser l\'air contourner.<br><button id="d-grow">Agrandir le domaine × 1,5</button></div>');
    $('d-warn').innerHTML = w.join('');
    var gb = $('d-grow');
    if (gb) gb.onclick = function () {
      pushHistory();
      S.domain.W = Math.min(1500, Math.round(S.domain.W * 1.5)); S.domain.H = Math.min(1500, Math.round(S.domain.H * 1.5));
      syncDomainInputs(); sceneChanged(); fit();
    };
  }
  function syncDomainInputs() { $('d-w').value = S.domain.W; $('d-h').value = S.domain.H; }

  // ------------------------------------------------------------------ champ affiché
  var fieldCanvas = document.createElement('canvas'), fieldCtx = fieldCanvas.getContext('2d'), fieldImg = null;
  // vitesse moyenne (m/s) en cellule (i, j)
  function meanSpeedAt(k) { return E.mean[3 * k + 2] * S.wind.speed / L.U_LAT; }
  function renderField() {
    if (!E.grid || !fieldImg || !E.samples) return;
    var g = E.grid, N = g.nx * g.ny, d = fieldImg.data, solid = E.rast.solid, m = E.mean;
    var U = L.U_LAT, mode = S.display, sp = S.wind.speed;
    var ref = mode === 'diff' && CLW.Variants ? CLW.Variants.refFor(E) : null;
    var TH = (mode === 'temp' || mode === 'feel' || mode === 'utci') && CLW.Thermal ? CLW.Thermal : null;
    if (TH) TH.prepareField();
    for (var k = 0; k < N; k++) {
      var c, p = 4 * k;
      if (solid[k]) { d[p] = 40; d[p + 1] = 44; d[p + 2] = 52; d[p + 3] = 255; continue; }
      var r = m[3 * k + 2] / U;
      if (TH) c = TH.colorAt(k, false);
      else if (mode === 'comfort') c = comfortColor(r * sp);
      else if (mode === 'diff') c = ref ? (ref.solid[k] ? [90, 90, 100] : diffColor((m[3 * k + 2] - ref.mean[3 * k + 2]) / U)) : ramp(r / 2);
      else c = ramp(r / 2);
      d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
    }
    fieldCtx.putImageData(fieldImg, 0, 0);
    E.fieldDirty = false;
  }
  CLW.getFieldCanvas = function () { if (E.fieldDirty) renderField(); return fieldCanvas; };
  CLW.renderFieldTo = function (ctx, x, y, w, h) {
    if (E.fieldDirty) renderField();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(fieldCanvas, x, y, w, h);
  };

  // ------------------------------------------------------------------ légende
  function drawLegend(ctx, w, h, opts) {
    opts = opts || {};
    ctx.clearRect(0, 0, w, h);
    var fg = opts.fg || '#dfe4ec', font = opts.font || 12;
    ctx.font = font + 'px Segoe UI, system-ui, sans-serif';
    ctx.fillStyle = fg; ctx.textBaseline = 'top';
    var sp = S.wind.speed, x0 = 6, bw = w - 12, by = font + 8, bh = Math.max(10, h * 0.22);
    if (S.display === 'comfort') {
      ctx.fillText('Confort piéton, vitesse moyenne (seuils indicatifs)', x0, 2);
      var cw = bw / 5;
      COMFORT.forEach(function (c, k) {
        ctx.fillStyle = 'rgb(' + c.col.join(',') + ')';
        ctx.fillRect(x0 + k * cw, by, cw - 2, bh);
        ctx.fillStyle = fg;
        ctx.fillText(c.label, x0 + k * cw, by + bh + 4);
        ctx.fillText(c.sub, x0 + k * cw, by + bh + 6 + font);
      });
      return;
    }
    if ((S.display === 'temp' || S.display === 'feel' || S.display === 'utci') && CLW.Thermal) { CLW.Thermal.drawLegend(ctx, w, h, fg, font); return; }
    if (S.display === 'diff') {
      var rv = CLW.Variants && CLW.Variants.ref;
      ctx.fillText(rv ? 'Écart à « ' + rv.name + ' » (rapport au vent libre)' : 'Écart : choisissez une variante de référence', x0, 2);
      for (var i2 = 0; i2 < bw; i2++) { var c2 = diffColor((i2 / bw - 0.5)); ctx.fillStyle = 'rgb(' + c2[0] + ',' + c2[1] + ',' + c2[2] + ')'; ctx.fillRect(x0 + i2, by, 1.5, bh); }
      ctx.fillStyle = fg;
      [['−0,5 plus calme', 0], ['0', 0.5], ['+0,5 plus venté', 1]].forEach(function (q) {
        var tx2 = x0 + q[1] * bw, tw2 = ctx.measureText(q[0]).width; ctx.fillText(q[0], clamp(tx2 - tw2 / 2, 0, w - tw2), by + bh + 6);
      });
      return;
    }
    var title = S.display === 'speed' ? 'Vitesse moyenne (m/s), vent libre ' + fmt(sp, 1) + ' m/s' : 'Rapport à la vitesse libre';
    ctx.fillText(title, x0, 2);
    for (var i = 0; i < bw; i++) { var c = ramp(i / bw); ctx.fillStyle = 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; ctx.fillRect(x0 + i, by, 1.5, bh); }
    ctx.fillStyle = fg;
    for (var t = 0; t <= 4; t++) {
      var val = S.display === 'speed' ? t / 2 * sp : t / 2;
      var tx = x0 + t / 4 * bw, lab = fmt(val, S.display === 'speed' && sp * 0.5 >= 10 ? 0 : 1);
      ctx.fillRect(tx - 0.5, by + bh, 1, 4);
      var tw = ctx.measureText(lab).width;
      ctx.fillText(lab, clamp(tx - tw / 2, 0, w - tw), by + bh + 6);
    }
  }
  CLW.drawLegend = drawLegend;
  CLW.updateLegend = function () { updateLegend(); };
  function updateLegend() {
    var c = $('legend'), dpr = window.devicePixelRatio || 1;
    var w = c.clientWidth || 300, h = 64;
    c.width = w * dpr; c.height = h * dpr;
    var ctx = c.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawLegend(ctx, w, h);
  }

  // ------------------------------------------------------------------ vue
  var canvas = $('plan'), ctx = canvas.getContext('2d'), dpr = 1;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    var r = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(r.width * dpr)); canvas.height = Math.max(1, Math.round(r.height * dpr));
    needDraw = true;
    if (fitPending) fit();
  }
  function cw() { return canvas.width / dpr; }
  function ch() { return canvas.height / dpr; }
  function toScreen(x, y) { var v = S.view; return [(x - v.cx) * v.scale + cw() / 2, (v.cy - y) * v.scale + ch() / 2]; }
  function toWorld(sx, sy) { var v = S.view; return [(sx - cw() / 2) / v.scale + v.cx, v.cy - (sy - ch() / 2) / v.scale]; }
  function fit() {
    var W = S.domain.W, H = S.domain.H;
    S.view.cx = 0; S.view.cy = 0;
    // canevas masqué ou minuscule (onglet en arrière-plan) : cadrage reporté au prochain redimensionnement
    if (cw() < 80 || ch() < 80) { fitPending = true; S.view.scale = Math.max(S.view.scale, 1e-3); needDraw = true; return; }
    fitPending = false;
    var vh = S.viewMode === 'both' ? vcutPx() : 0, vw = vcutWpx();
    S.view.scale = Math.min((cw() - vw - 40) / W, (ch() - vh - 40) / H);
    S.view.cy = -vh / (2 * S.view.scale); // centre du domaine au milieu de la zone visible
    S.view.cx = vw / (2 * S.view.scale);
    needDraw = true;
  }
  var fitPending = false;
  CLW.fit = fit;

  // chemins Path2D en coordonnées du plan, mis en cache
  function invalidatePaths() { S.objects.forEach(function (o) { delete o._path; }); needDraw = true; }
  function objPath(o) {
    if (o._path) return o._path;
    var p = new Path2D(), k;
    if (o.type === 'building') {
      [o.outer].concat(o.holes || []).forEach(function (r) {
        for (k = 0; k < r.length; k++) { if (k) p.lineTo(r[k][0], r[k][1]); else p.moveTo(r[k][0], r[k][1]); }
        p.closePath();
      });
    } else if (o.type === 'wall') {
      for (k = 0; k < o.pts.length; k++) { if (k) p.lineTo(o.pts[k][0], o.pts[k][1]); else p.moveTo(o.pts[k][0], o.pts[k][1]); }
    } else if (o.type === 'tree') {
      p.arc(o.x, o.y, o.r, 0, Math.PI * 2);
    }
    Object.defineProperty(o, '_path', { value: p, configurable: true, enumerable: false, writable: true });
    return p;
  }

  var needDraw = true, lastFrame = 0, lastRaf = 0, pauseTimer = null;
  // le navigateur n'anime plus une fenêtre masquée ou réduite : le calcul s'arrête. À la reprise, on le dit.
  function pauseNote(ms) {
    var el = $('pause-note'); if (!el) return;
    el.textContent = 'Calcul en pause pendant ' + (ms > 90000 ? Math.round(ms / 60000) + ' min' : Math.round(ms / 1000) + ' s') + ' (fenêtre masquée ou réduite) : il reprend.';
    el.hidden = false; clearTimeout(pauseTimer); pauseTimer = setTimeout(function () { el.hidden = true; }, 6000);
  }
  function frame(t) {
    requestAnimationFrame(frame);
    if (lastRaf && t - lastRaf > 3000) pauseNote(t - lastRaf);
    lastRaf = t;
    if (S.viewMode === 'zoom') { if (CLW.Zoom) CLW.Zoom.frame(); return; } // calcul principal suspendu pendant le zoom
    if (S.mode3d) { if (E.s3 && !E.creating3 && !E.paused) frame3d(); }
    else if (E.solver && !E.creating) E.solver.frame();
    if (S.viewMode === 'soleil') { if (CLW.Sun) CLW.Sun.frame(); return; }
    if (S.view3d) { if (CLW.View3D) CLW.View3D.frame(E, S); if (!E.fieldDirty) return; }
    var anim = S.particles && E.samples > 0;
    if (!needDraw && !anim && !E.fieldDirty) return;
    needDraw = false;
    draw(t - lastFrame);
    lastFrame = t;
  }

  function draw(dt) {
    var W = cw(), H = ch(), v = S.view;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0d11'; ctx.fillRect(0, 0, W, H);
    var a = toScreen(-S.domain.W / 2, S.domain.H / 2), b = toScreen(S.domain.W / 2, -S.domain.H / 2);
    // champ (sur la grille courante)
    if (E.grid && E.samples) {
      var ga = toScreen(-E.grid.W / 2, E.grid.H / 2), gb = toScreen(E.grid.W / 2, -E.grid.H / 2);
      CLW.renderFieldTo(ctx, ga[0], ga[1], gb[0] - ga[0], gb[1] - ga[1]);
    } else {
      ctx.fillStyle = '#151a22'; ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    }
    ctx.strokeStyle = '#5a6578'; ctx.lineWidth = 1; ctx.setLineDash([6, 4]);
    ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.setLineDash([]);
    // bande des écrans poreux
    if (E.screenCanvas && E.grid) {
      var sa = toScreen(-E.grid.W / 2, E.grid.H / 2), sb = toScreen(E.grid.W / 2, -E.grid.H / 2);
      ctx.save(); ctx.imageSmoothingEnabled = false; ctx.globalAlpha = 0.45;
      ctx.drawImage(E.screenCanvas, sa[0], sa[1], sb[0] - sa[0], sb[1] - sa[1]); ctx.restore();
    }
    // particules
    if (S.particles && E.samples) drawParticles(dt);
    // objets en coordonnées du plan
    ctx.save();
    ctx.setTransform(dpr * v.scale, 0, 0, -dpr * v.scale, dpr * (cw() / 2 - v.cx * v.scale), dpr * (ch() / 2 + v.cy * v.scale));
    var px = 1 / v.scale, selGroup = null, selObj = byId(S.sel);
    if (selObj && selObj.group && !dragSingle) selGroup = selObj.group;
    for (var k = 0; k < S.objects.length; k++) {
      var o = S.objects[k], p = objPath(o), sel = o.id === S.sel, grp = selGroup && o.group === selGroup;
      if (o.type === 'building' && o.screen) {
        ctx.fillStyle = sel ? 'rgba(255,200,90,0.95)' : 'rgba(225,165,60,0.85)'; ctx.fill(p, 'evenodd');
        if (sel || grp) { ctx.strokeStyle = sel ? '#4fb3ff' : '#7fa7d0'; ctx.lineWidth = px; ctx.stroke(p); }
      } else if (o.type === 'building') {
        ctx.fillStyle = sel ? 'rgba(80,95,120,0.95)' : 'rgba(46,52,64,0.92)'; ctx.fill(p, 'evenodd');
        ctx.strokeStyle = sel ? '#4fb3ff' : grp ? '#7fa7d0' : '#9aa5b5'; ctx.lineWidth = (sel ? 2 : 1) * px; ctx.stroke(p);
      } else if (o.type === 'wall') {
        ctx.strokeStyle = sel ? '#4fb3ff' : grp ? '#7fa7d0' : '#c9ced6';
        ctx.lineWidth = Math.max(o.thick || 0.3, 2 * px); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(p);
      } else if (o.type === 'tree') {
        ctx.fillStyle = 'rgba(70,160,80,0.25)'; ctx.fill(p);
        ctx.strokeStyle = sel ? '#4fb3ff' : grp ? '#7fa7d0' : 'rgba(120,210,120,0.9)'; ctx.lineWidth = (sel ? 2 : 1) * px; ctx.stroke(p);
      }
    }
    if (CLW.Bilan) CLW.Bilan.drawOverlay(ctx, E, px);
    // trait de coupe verticale
    var SLd = (S.mode3d || S.section) ? (draft && draft.kind === 'cut' ? { a: draft.a, b: draft.b } : sectionLine()) : null;
    if (SLd) {
      ctx.strokeStyle = 'rgba(255,140,60,0.95)'; ctx.lineWidth = 2 * px; ctx.setLineDash([8 * px, 5 * px]);
      ctx.beginPath(); ctx.moveTo(SLd.a[0], SLd.a[1]); ctx.lineTo(SLd.b[0], SLd.b[1]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,140,60,0.95)';
      [SLd.a, SLd.b].forEach(function (q) { ctx.beginPath(); ctx.arc(q[0], q[1], 5 * px, 0, 2 * Math.PI); ctx.fill(); });
      ctx.save(); ctx.scale(1, -1); ctx.font = (12 * px) + 'px system-ui, sans-serif'; ctx.fillStyle = '#ffd2a8';
      ctx.fillText('A', SLd.a[0] + 7 * px, -SLd.a[1] - 7 * px); ctx.fillText('B', SLd.b[0] + 7 * px, -SLd.b[1] - 7 * px); ctx.restore();
    }
    if (CLW.Probe) CLW.Probe.drawPlan(ctx, px);
    ctx.restore();
    drawDraft();
    drawOverlay(W, H);
  }

  function drawDraft() {
    if (!draft || draft.kind === 'cut') return; // le trait de coupe est dessiné avec les objets
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = '#4fb3ff'; ctx.fillStyle = 'rgba(79,179,255,0.15)'; ctx.lineWidth = 1.5;
    var pts = draft.pts.slice();
    if (draft.kind === 'rect') {
      var a = toScreen(draft.a[0], draft.a[1]), b = toScreen(draft.b[0], draft.b[1]);
      ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    } else {
      if (mouseW) pts.push(mouseW);
      ctx.beginPath();
      pts.forEach(function (p, k) { var s = toScreen(p[0], p[1]); if (k) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); });
      if (draft.kind === 'poly' && pts.length > 2) { ctx.closePath(); ctx.fill(); }
      ctx.stroke();
      draft.pts.forEach(function (p) { var s = toScreen(p[0], p[1]); ctx.fillStyle = '#4fb3ff'; ctx.fillRect(s[0] - 3, s[1] - 3, 6, 6); });
    }
    ctx.restore();
  }

  // flèche de vent, nord, échelle
  function drawOverlay(W, H) {
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(11,13,17,0.78)'; ctx.fillRect(8, 8, 150, 128);
    drawWindArrow(ctx, 83, 52, 30, S.wind.dir, '#fff');
    ctx.font = '12px Segoe UI, system-ui, sans-serif'; ctx.fillStyle = '#dfe4ec'; ctx.textAlign = 'center';
    ctx.fillText('Vent ' + fmt(S.wind.speed, 1) + ' m/s', 83, 108);
    ctx.font = '11px Segoe UI, system-ui, sans-serif';
    ctx.fillText(deLe(dirName(S.wind.dir)) + ' (' + Math.round(S.wind.dir) + '°)', 83, 125);
    var Wv = W - vcutWpx(); // plan | coupe : nord et échelle dans la partie visible du plan
    drawNorth(ctx, Wv - 36, 50, 20, '#fff');
    drawScaleBar(ctx, Wv - 20, H - 18, S.view.scale, '#dfe4ec');
    ctx.restore();
  }
  function drawWindArrow(c, x, y, r, dir, col) {
    // flèche dans le sens de l'écoulement (vers où souffle le vent)
    var th = dir * Math.PI / 180, dx = -Math.sin(th), dy = Math.cos(th); // écran : y vers le bas
    c.save(); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 3;
        c.fillStyle = col;
    c.beginPath(); c.moveTo(x - dx * r, y - dy * r); c.lineTo(x + dx * (r - 10), y + dy * (r - 10)); c.stroke();
    c.beginPath(); c.moveTo(x + dx * r, y + dy * r);
    c.lineTo(x + dx * (r - 14) - dy * 8, y + dy * (r - 14) + dx * 8);
    c.lineTo(x + dx * (r - 14) + dy * 8, y + dy * (r - 14) - dx * 8); c.closePath(); c.fill();
    c.restore();
  }
  function drawNorth(c, x, y, r, col) {
    c.save(); c.fillStyle = col; c.strokeStyle = col; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r * 0.45, y + r * 0.6); c.lineTo(x, y + r * 0.3); c.lineTo(x - r * 0.45, y + r * 0.6); c.closePath(); c.fill();
    c.font = 'bold ' + Math.round(r * 0.75) + 'px Segoe UI, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText('N', x, y - r - 2);
    c.restore();
  }
  function niceLen(m) { var p = Math.pow(10, Math.floor(Math.log10(m))), n = m / p; return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p; }
  function drawScaleBar(c, xr, y, scale, col, target) {
    var len = niceLen((target || 140) / scale), px = len * scale;
    c.save(); c.strokeStyle = col; c.fillStyle = col; c.lineWidth = 2;
    c.beginPath(); c.moveTo(xr - px, y - 5); c.lineTo(xr - px, y); c.lineTo(xr, y); c.lineTo(xr, y - 5); c.stroke();
    c.font = '12px Segoe UI, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText(fmt(len, 0) + ' m', xr - px / 2, y - 4);
    c.restore();
  }
  CLW.drawWindArrow = drawWindArrow; CLW.drawNorth = drawNorth; CLW.drawScaleBar = drawScaleBar;

  // ------------------------------------------------------------------ particules
  var PN = 1400, part = null;
  function resetParticles() {
    part = { x: new Float32Array(PN), y: new Float32Array(PN), age: new Float32Array(PN) };
    for (var k = 0; k < PN; k++) spawn(k, true);
  }
  function spawn(k, any) {
    var g = E.grid; if (!g) return;
    part.x[k] = (Math.random() - 0.5) * g.W; part.y[k] = (Math.random() - 0.5) * g.H;
    part.age[k] = any ? Math.random() * 120 : 0;
  }
  // vitesse moyenne (unités réseau, x vers la droite, y vers le haut) interpolée
  function sampleVec(x, y) {
    var g = E.grid, fi = (x - g.x0) / g.dx - 0.5, fj = (g.y0 - y) / g.dx - 0.5;
    var i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return null;
    var u = fi - i, v = fj - j, m = E.mean, nx = g.nx;
    var k00 = j * nx + i, k10 = k00 + 1, k01 = k00 + nx, k11 = k01 + 1;
    if (E.rast.solid[k00] && E.rast.solid[k10] && E.rast.solid[k01] && E.rast.solid[k11]) return null;
    var vx = (m[3 * k00] * (1 - u) + m[3 * k10] * u) * (1 - v) + (m[3 * k01] * (1 - u) + m[3 * k11] * u) * v;
    var vy = (m[3 * k00 + 1] * (1 - u) + m[3 * k10 + 1] * u) * (1 - v) + (m[3 * k01 + 1] * (1 - u) + m[3 * k11 + 1] * u) * v;
    return [vx, -vy];
  }
  function drawParticles() {
    if (!part || !E.grid) return;
    var sc = S.view.scale, U = L.U_LAT, stepPx = 1.6;
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1; ctx.beginPath();
    for (var k = 0; k < PN; k++) {
      var x = part.x[k], y = part.y[k], v = sampleVec(x, y);
      part.age[k] += 1;
      if (!v || part.age[k] > 140) { spawn(k); continue; }
      var f = stepPx / sc / U;
      var nx = x + v[0] * f, ny = y + v[1] * f;
      var a = toScreen(x, y), b = toScreen(nx, ny);
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0] + (b[0] - a[0]) * 2, b[1] + (b[1] - a[1]) * 2);
      part.x[k] = nx; part.y[k] = ny;
    }
    ctx.stroke(); ctx.restore();
  }

  // ------------------------------------------------------------------ sonde
  function updateProbe(sx, sy) {
    var p = $('probe');
    if (sx == null || !E.grid) { p.textContent = ''; return; }
    var w = toWorld(sx, sy), g = E.grid;
    var i = Math.floor((w[0] - g.x0) / g.dx), j = Math.floor((g.y0 - w[1]) / g.dx);
    var txt = 'x = ' + fmt(w[0], 1) + ' m · y = ' + fmt(w[1], 1) + ' m';
    if (i >= 0 && j >= 0 && i < g.nx && j < g.ny && E.samples) {
      var k = j * g.nx + i;
      if (E.rast.solid[k]) txt += ' · obstacle';
      else {
        var r = E.mean[3 * k + 2] / L.U_LAT;
        txt += ' · ' + fmt(r * S.wind.speed, 2) + ' m/s · ' + fmt(r, 2) + ' × vent libre';
      }
      if ((S.display === 'temp' || S.display === 'feel' || S.display === 'utci') && CLW.Thermal && CLW.Thermal.probeText) txt += CLW.Thermal.probeText(k);
    }
    p.textContent = txt;
  }

  // ------------------------------------------------------------------ objets, sélection
  function byId(id) { if (id == null) return null; for (var k = 0; k < S.objects.length; k++) if (S.objects[k].id === id) return S.objects[k]; return null; }
  CLW.byId = byId;
  function hitTest(w) {
    var tol = 5 / S.view.scale;
    for (var k = S.objects.length - 1; k >= 0; k--) {
      var o = S.objects[k];
      if (o.type === 'tree') { if (Math.hypot(w[0] - o.x, w[1] - o.y) <= Math.max(o.r, tol)) return o; }
      else if (o.type === 'wall') {
        for (var s = 0; s + 1 < o.pts.length; s++)
          if (CLW.geom.distSeg(w[0], w[1], o.pts[s][0], o.pts[s][1], o.pts[s + 1][0], o.pts[s + 1][1]) <= Math.max((o.thick || 0.3) / 2, tol)) return o;
      }
    }
    for (var m = S.objects.length - 1; m >= 0; m--) {
      var b = S.objects[m];
      if (b.type === 'building' && CLW.geom.pointInRings(w[0], w[1], [b.outer].concat(b.holes || []))) return b;
    }
    return null;
  }
  function moveObj(o, dx, dy) {
    function mv(p) { p[0] += dx; p[1] += dy; }
    if (o.type === 'building') { o.outer.forEach(mv); (o.holes || []).forEach(function (r) { r.forEach(mv); }); }
    else if (o.type === 'wall') o.pts.forEach(mv);
    else if (o.type === 'tree') { o.x += dx; o.y += dy; }
    delete o._path;
  }
  CLW.moveObj = moveObj;
  function deleteSel() {
    var o = byId(S.sel); if (!o) return;
    pushHistory();
    S.objects = S.objects.filter(function (x) { return x !== o; });
    S.sel = null; updateSel(); sceneChanged();
  }

  function updateSel() {
    var body = $('sel-body'), o = byId(S.sel);
    if (!o) { body.innerHTML = 'Aucun objet sélectionné.'; body.className = 'hint'; needDraw = true; return; }
    body.className = '';
    var grp = o.group ? S.objects.filter(function (x) { return x.group === o.group; }).length : 1;
    var h = '';
    var srcName = { osm: 'OpenStreetMap', draw: 'dessiné', import: 'importé', example: 'exemple', live: o.importLabel && o.importLabel !== 'Grasshopper' ? 'de ' + o.importLabel : 'de Grasshopper' }[o.src] || '';
    if (o.type === 'tree') {
      h += '<div class="hint">Arbre ' + esc(srcName) + '</div>' +
        '<label class="row">Rayon du houppier <span class="pair"><input type="number" id="s-r" min="0.5" max="40" step="0.5" value="' + o.r + '"> m</span></label>' +
        '<label class="row">Densité de feuillage a <span class="pair"><input type="number" id="s-a" min="0" max="2" step="0.01" value="' + (o.a != null ? o.a : L.TREE_A) + '"> 1/m</span></label>' +
        '<div class="hint">0,15 par défaut ; plus dense, l\'arbre ralentit davantage le vent.</div>';
    } else if (o.type === 'wall') {
      var len = 0; for (var s = 0; s + 1 < o.pts.length; s++) len += Math.hypot(o.pts[s + 1][0] - o.pts[s][0], o.pts[s + 1][1] - o.pts[s][1]);
      h += '<div class="hint">Mur ' + esc(srcName) + ', longueur ' + fmt(len, 1) + ' m</div>' +
        '<label class="row">Épaisseur <span class="pair"><input type="number" id="s-t" min="0.05" max="5" step="0.05" value="' + (o.thick || 0.3) + '"> m</span></label>' +
        '<div class="hint">Le mur est toujours au moins aussi épais qu\'une cellule de la grille.</div>';
    } else if (o.screen) {
      h += '<div class="hint">Élément d\'écran poreux ' + esc(srcName) + ' (brique, lame…)</div>' +
        '<div class="hint">Trop fin pour la grille, il n\'est pas plein : avec ses voisins, il forme une bande poreuse dont la porosité est mesurée face au vent (panneau Domaine).</div>';
    } else {
      var area = Math.abs(CLW.geom.area(o.outer));
      (o.holes || []).forEach(function (r) { area -= Math.abs(CLW.geom.area(r)); });
      var bb = CLW.geom.bbox(o.outer);
      h += '<div class="hint">Bâtiment ' + esc(srcName) + (o.name ? ', ' + esc(o.name) : '') + '</div>' +
        '<div>Emprise : ' + fmt(area, 0) + ' m² (' + fmt(bb[2] - bb[0], 1) + ' × ' + fmt(bb[3] - bb[1], 1) + ' m)</div>' +
        '<label class="row">Hauteur connue <span class="pair"><input type="number" id="s-h" min="0" max="400" step="0.5" value="' + (o.height != null ? o.height : '') + '"> m</span></label>' +
        '<div class="hint">En 2D, la hauteur n\'intervient pas dans le calcul : elle sert au conseil de rayon et à l\'export.</div>';
    }
    if (grp > 1) h += '<div class="hint">Fait partie d\'un groupe de ' + grp + ' objets, déplacé en bloc. Majuscule + glisser déplace cet objet seul.</div>';
    h += '<button id="s-del">Supprimer</button>';
    body.innerHTML = h;
    function bind(id, fn) {
      var el = $(id); if (!el) return;
      el.addEventListener('change', function () {
        var v = parseNum(el.value);
        pushHistory(); fn(v); delete o._path; sceneChanged(); updateSel();
      });
    }
    bind('s-r', function (v) { if (v > 0) o.r = clamp(v, 0.5, 40); });
    bind('s-a', function (v) { if (v >= 0) o.a = clamp(v, 0, 2); });
    bind('s-t', function (v) { if (v > 0) o.thick = clamp(v, 0.05, 5); });
    bind('s-h', function (v) { o.height = isFinite(v) && v > 0 ? v : null; });
    $('s-del').onclick = deleteSel;
    needDraw = true;
  }
  CLW.updateSel = updateSel;

  // ------------------------------------------------------------------ outils
  var draft = null, mouseW = null, drag = null, pan = null, dragSingle = false;
  var HINTS = {
    select: 'Cliquez un objet pour le sélectionner, glissez pour le déplacer (Majuscule : objet seul).',
    rect: 'Glissez pour tracer un bâtiment rectangulaire.',
    poly: 'Un clic par sommet ; double clic ou Entrée pour finir, Échap pour abandonner.',
    tree: 'Cliquez pour planter un arbre (rayon 5 m).',
    wall: 'Un clic par point ; double clic ou Entrée pour finir, Échap pour abandonner.',
    cut: 'Glissez de A vers B pour tracer la coupe verticale ; double clic : revenir à la coupe dans l\'axe du vent.',
    probe: 'Cliquez un point du plan, ou de la coupe verticale, pour y poser la sonde P : elle est repérée dans le plan, la coupe et la 3D, et ses valeurs restent affichées.'
  };
  function setTool(t) {
    S.tool = t; draft = null;
    document.querySelectorAll('#toolbar [data-tool]').forEach(function (b) { b.classList.toggle('on', b.dataset.tool === t); });
    setHint(HINTS[t]);
    canvas.style.cursor = t === 'select' ? 'default' : 'crosshair';
    needDraw = true;
  }
  function setHint(t) { $('tool-hint').textContent = t || ''; }
  CLW.setHint = setHint;

  function addObject(o) {
    pushHistory();
    o.id = newId(); o.src = 'draw';
    S.objects.push(o);
    S.sel = o.id; updateSel(); sceneChanged();
  }
  function finishDraft() {
    if (!draft) return;
    var pts = draft.pts;
    if (draft.kind === 'poly') {
      if (pts.length >= 3 && Math.abs(CLW.geom.area(pts)) > 0.5) addObject({ type: 'building', outer: pts, holes: [], height: null });
      else setHint('Il faut au moins trois sommets.');
    } else if (draft.kind === 'wall') {
      if (pts.length >= 2) addObject({ type: 'wall', pts: pts, thick: 0.3 });
      else setHint('Il faut au moins deux points.');
    }
    draft = null; needDraw = true;
  }

  function evPos(e) { var r = canvas.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('mousedown', function (e) {
    var p = evPos(e), w = toWorld(p[0], p[1]);
    if (e.button === 1 || e.button === 2) { pan = { sx: p[0], sy: p[1], cx: S.view.cx, cy: S.view.cy }; e.preventDefault(); return; }
    if (e.button !== 0) return;
    if (S.tool === 'select') {
      var o = hitTest(w);
      S.sel = o ? o.id : null; updateSel();
      if (o) { dragSingle = e.shiftKey; drag = { obj: o, last: w, moved: false, single: e.shiftKey }; }
      needDraw = true;
    } else if (S.tool === 'rect') {
      draft = { kind: 'rect', a: w, b: w, pts: [] };
    } else if (S.tool === 'cut') {
      draft = { kind: 'cut', a: w, b: w, pts: [] };
    } else if (S.tool === 'probe') {
      if (CLW.Probe) CLW.Probe.set({ x: w[0], y: w[1] });
    }
  });
  canvas.addEventListener('click', function (e) {
    if (e.button !== 0) return;
    var p = evPos(e), w = toWorld(p[0], p[1]);
    if (S.tool === 'tree') { addObject({ type: 'tree', x: w[0], y: w[1], r: 5, a: L.TREE_A }); return; }
    if (S.tool === 'poly' || S.tool === 'wall') {
      if (!draft) draft = { kind: S.tool, pts: [] };
      var last = draft.pts[draft.pts.length - 1];
      // le second clic d'un double clic ne crée pas de point en double
      if (last) { var ls = toScreen(last[0], last[1]); if (Math.hypot(ls[0] - p[0], ls[1] - p[1]) < 4) return; }
      draft.pts.push(w); needDraw = true;
    }
  });
  canvas.addEventListener('dblclick', function (e) {
    if (S.tool === 'poly' || S.tool === 'wall') { e.preventDefault(); finishDraft(); }
    if (S.tool === 'cut') { e.preventDefault(); draft = null; setSection(null); }
  });
  window.addEventListener('mousemove', function (e) {
    var p = evPos(e), inside = p[0] >= 0 && p[1] >= 0 && p[0] <= cw() && p[1] <= ch();
    if (pan) {
      S.view.cx = pan.cx - (p[0] - pan.sx) / S.view.scale; S.view.cy = pan.cy + (p[1] - pan.sy) / S.view.scale;
      needDraw = true; return;
    }
    var w = toWorld(p[0], p[1]);
    if (drag) {
      var dx = w[0] - drag.last[0], dy = w[1] - drag.last[1];
      if (!drag.moved && Math.hypot(dx, dy) * S.view.scale < 3) return;
      if (!drag.moved) { pushHistory(); drag.moved = true; }
      var list = (!drag.single && drag.obj.group) ? S.objects.filter(function (o) { return o.group === drag.obj.group; }) : [drag.obj];
      list.forEach(function (o) { moveObj(o, dx, dy); });
      drag.last = w; needDraw = true; return;
    }
    if (draft && (draft.kind === 'rect' || draft.kind === 'cut')) { draft.b = w; needDraw = true; }
    mouseW = inside ? w : null;
    if (draft) needDraw = true;
    updateProbe(inside ? p[0] : null, p[1]);
  });
  window.addEventListener('mouseup', function (e) {
    if (pan) { pan = null; return; }
    if (drag) { var mv = drag.moved; drag = null; dragSingle = false; if (mv) sceneChanged(); needDraw = true; return; }
    if (draft && draft.kind === 'cut') {
      var ca = draft.a, cb = draft.b; draft = null;
      if (Math.hypot(cb[0] - ca[0], cb[1] - ca[1]) >= 1) setSection({ a: ca, b: cb });
      needDraw = true; return;
    }
    if (draft && draft.kind === 'rect') {
      var a = draft.a, b = draft.b; draft = null;
      if (Math.abs(b[0] - a[0]) >= 1 && Math.abs(b[1] - a[1]) >= 1) {
        var x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), y0 = Math.min(a[1], b[1]), y1 = Math.max(a[1], b[1]);
        addObject({ type: 'building', outer: rect(x0, y0, x1, y1), holes: [], height: null });
      }
      needDraw = true;
    }
  });
  canvas.addEventListener('mouseleave', function () { updateProbe(null); mouseW = null; needDraw = true; });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var p = evPos(e), w = toWorld(p[0], p[1]);
    var f = Math.exp(-e.deltaY * 0.0015);
    S.view.scale = clamp(S.view.scale * f, 0.05, 200);
    var w2 = toWorld(p[0], p[1]);
    S.view.cx += w[0] - w2[0]; S.view.cy += w[1] - w2[1];
    needDraw = true;
  }, { passive: false });

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key;
    if (k === 'Escape') { draft = null; drag = null; needDraw = true; return; }
    if (k === 'Enter') { finishDraft(); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSel(); return; }
    var map = { s: 'select', r: 'rect', b: 'poly', t: 'tree', w: 'wall', c: 'cut', p: 'probe' };
    if (map[k.toLowerCase()]) { setTool(map[k.toLowerCase()]); return; }
    if (k === 'f' || k === 'F') fit();
  });

  // ------------------------------------------------------------------ panneau
  function bindPair(rangeId, numId, min, max, onChange) {
    var r = $(rangeId), n = $(numId);
    r.addEventListener('input', function () { n.value = r.value; onChange(parseNum(r.value), false); });
    n.addEventListener('change', function () {
      var v = parseNum(n.value); if (!isFinite(v)) v = parseNum(r.value);
      v = clamp(v, min, max); n.value = v; r.value = v; onChange(v, true);
    });
  }
  function setWindSpeed(v) {
    S.wind.speed = clamp(v, 0.5, 20);
    $('w-speed').value = S.wind.speed; $('w-speed-r').value = S.wind.speed;
    // seule l'échelle change : pas de nouveau calcul
    E.fieldDirty = true; needDraw = true; updateLegend();
    if (E.bilan && CLW.Bilan) { CLW.Bilan.compute(E, S); CLW.Bilan.render(E, S); }
  }
  function setWindDir(v) {
    v = Math.round(((v % 360) + 360) % 360);
    if (v === 360) v = 0;
    var changed = v !== S.wind.dir;
    S.wind.dir = v;
    $('w-dir').value = v; $('w-dir-r').value = v;
    $('w-dir-name').textContent = dirName(v) + ' (' + dirAbbr(v) + ')';
    $('w-dir-name').parentNode.firstChild.textContent = 'Vent venant ' + (/^[aeiouéè]/i.test(dirName(v)) ? "de l'" : 'du ');
    needDraw = true;
    if (changed) requestReset();
  }
  CLW.setWind = function (dir, speed) { if (speed != null) setWindSpeed(speed); if (dir != null) setWindDir(dir); };

  function initPanel() {
    bindPair('w-speed-r', 'w-speed', 0.5, 20, function (v) { setWindSpeed(v); });
    bindPair('w-dir-r', 'w-dir', 0, 359, function (v) { setWindDir(v); });
    function dom() {
      var W = clamp(parseNum($('d-w').value) || S.domain.W, 10, 1500), H = clamp(parseNum($('d-h').value) || S.domain.H, 10, 1500);
      if (W === S.domain.W && H === S.domain.H) { syncDomainInputs(); return; }
      pushHistory(); S.domain.W = W; S.domain.H = H; syncDomainInputs(); sceneChanged(); fit();
    }
    $('d-w').addEventListener('change', dom); $('d-h').addEventListener('change', dom);
    // résolution et mode des écrans mémorisés dans ce navigateur (confort, facultatif)
    try {
      var savedRes = localStorage.getItem('clwind-res'), savedScr = localStorage.getItem('clwind-scr');
      if (savedRes != null && $('d-res').querySelector('option[value="' + savedRes + '"]')) { S.res = +savedRes; $('d-res').value = savedRes; }
      if (savedScr && $('d-scr').querySelector('option[value="' + savedScr + '"]')) { S.scrMode = savedScr; $('d-scr').value = savedScr; }
    } catch (e) { /* stockage indisponible */ }
    $('d-res').addEventListener('change', function () {
      S.res = +$('d-res').value; requestReset(true);
      try { localStorage.setItem('clwind-res', String(S.res)); } catch (e) { /* rien */ }
    });
    // étapes de travail du panneau gauche (mémorisées dans ce navigateur) ; anciens noms d'onglets acceptés
    var OLD_TABS = { projet: 'modele', soleil: 'chaleur', calcul: 'vent', export: 'rendu' };
    function showTab(t) {
      t = OLD_TABS[t] || t;
      if (!document.querySelector('#tabs button[data-tab="' + t + '"]')) return;
      document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === t); });
      document.querySelectorAll('#panel .tab').forEach(function (s2) { s2.hidden = s2.dataset.tab !== t; });
      try { localStorage.setItem('clwind-tab', t); } catch (e) { /* rien */ }
      if (CLW.onStep) CLW.onStep(t);
    }
    document.querySelectorAll('#tabs button').forEach(function (b) { b.addEventListener('click', function () { showTab(b.dataset.tab); }); });
    try { var st0 = localStorage.getItem('clwind-tab'); if (st0) showTab(st0); } catch (e) { /* rien */ }
    CLW.showTab = showTab;
    // bascule Plan 2D / Vue 3D
    function setView(v) {
      if (v === '2d') v = 'plan';
      S.viewMode = v; S.view3d = v === '3d';
      try { localStorage.setItem('clwind-view', v); } catch (e) { /* rien */ }
      document.querySelectorAll('#view-mode button').forEach(function (b) { b.classList.toggle('on', b.dataset.view === v); });
      $('view3d').hidden = !S.view3d; $('plan').style.visibility = (S.view3d || v === 'coupe' || v === 'soleil' || v === 'zoom') ? 'hidden' : '';
      if ($('plan-head')) $('plan-head').hidden = S.view3d || v === 'coupe' || v === 'soleil' || v === 'zoom';
      if ($('v3d-head')) $('v3d-head').hidden = !(S.view3d && S.mode3d);
      $('zoom-wrap').hidden = v !== 'zoom'; if (v === 'zoom' && CLW.Zoom) CLW.Zoom.draw();
      $('sun-wrap').hidden = v !== 'soleil'; if (v === 'soleil' && CLW.Sun) CLW.Sun.dirty();
      $('banner').style.visibility = v === 'soleil' || v === 'zoom' ? 'hidden' : '';
      var hint = $('v3d-hint');
      if (S.view3d && !S.mode3d) {
        hint.hidden = false;
        hint.innerHTML = 'La vue 3D montre un calcul 3D.<br><button id="v3d-go" class="primary">Lancer le calcul 3D</button>';
        $('v3d-go').onclick = function () { $('d-dim').value = '3d'; $('d-dim').dispatchEvent(new Event('change')); };
      } else hint.hidden = true;
      showVcut(); needDraw = true; drawVcut();
      if (CLW.View3D) { CLW.View3D.resize(); CLW.View3D.dirty(); }
    }
    document.querySelectorAll('#view-mode button').forEach(function (b) { b.addEventListener('click', function () { setView(b.dataset.view); }); });
    CLW.setView = setView;
    $('vcut-3d').onclick = function () { $('d-dim').value = '3d'; $('d-dim').dispatchEvent(new Event('change')); };
    try { var sv = localStorage.getItem('clwind-view'); if (sv && document.querySelector('#view-mode button[data-view="' + sv + '"]')) setTimeout(function () { setView(sv); }, 0); } catch (e) { /* rien */ }
    // poignée : hauteur de la coupe verticale
    (function () {
      var grip = $('vcut-grip'), drag2 = null;
      grip.addEventListener('mousedown', function (e) { drag2 = { y: e.clientY, h: $('vcut-wrap').getBoundingClientRect().height, H: $('view').getBoundingClientRect().height }; e.preventDefault(); });
      window.addEventListener('mousemove', function (e) {
        if (!drag2) return;
        S.vcutFrac = clamp((drag2.h - (e.clientY - drag2.y)) / drag2.H, 0.15, 0.7);
        $('vcut-wrap').style.height = (S.vcutFrac * 100) + '%'; drawVcut();
      });
      window.addEventListener('mouseup', function () { if (drag2) { drag2 = null; fit(); drawVcut(); } });
    })();
    // calcul 3D
    try { var s3r = localStorage.getItem('clwind-res3d'); if (s3r != null && $('d-res3d').querySelector('option[value="' + s3r + '"]')) { S.res3d = +s3r; $('d-res3d').value = s3r; } } catch (e) { /* rien */ }
    $('d-dim').addEventListener('change', function () {
      S.mode3d = $('d-dim').value === '3d'; $('d-3d').hidden = !S.mode3d; $('d-2d').hidden = S.mode3d;
      setView(S.viewMode);
      E.profile = null; E.profStable = false; drawProfile(); showVcut();
      if (!S.mode3d && E.s3) E.s3.pause();
      requestReset(true);
    });
    $('d-res3d').addEventListener('change', function () {
      S.res3d = +$('d-res3d').value; requestReset(true);
      try { localStorage.setItem('clwind-res3d', String(S.res3d)); } catch (e) { /* rien */ }
    });
    // hauteur max du domaine 3D (onglet Réglages) : moins haut = cellules plus fines pour le même nombre de cellules
    if ($('d-h3d')) {
      try { var h3 = parseFloat(localStorage.getItem('clwind-h3d')); if (h3 >= 0) { S.h3d = h3; $('d-h3d').value = h3; } } catch (e) { /* rien */ }
      $('d-h3d').addEventListener('change', function () {
        var v = parseNum($('d-h3d').value); S.h3d = isFinite(v) && v > 0 ? v : 0; $('d-h3d').value = S.h3d;
        try { localStorage.setItem('clwind-h3d', String(S.h3d)); } catch (e) { /* rien */ }
        if (S.mode3d) requestReset(true);
      });
    }
    function setCut(v, fromRange) {
      v = clamp(v, 0.1, 50); S.cut3d = v;
      if (!fromRange) $('d-cut-r').value = v; $('d-cut').value = v; if ($('v3-z')) $('v3-z').value = v;
      if (S.mode3d && E.vox) setSlice3D(false);
      drawProfile();
      if (CLW.View3D) CLW.View3D.dirty();
    }
    $('d-cut-r').addEventListener('input', function () { setCut(parseNum($('d-cut-r').value), true); });
    $('d-cut').addEventListener('change', function () { setCut(parseNum($('d-cut').value) || 1.5, false); });
    $('d-scr').addEventListener('change', function () {
      S.scrMode = $('d-scr').value; sceneChanged();
      try { localStorage.setItem('clwind-scr', S.scrMode); } catch (e) { /* rien */ }
    });
    // grandeur du plan (boutons de la barre latérale et menu du bandeau du plan) et de la coupe (menu de son bandeau)
    function setDisplay(m) {
      if (!document.querySelector('#disp-mode button[data-mode="' + m + '"]')) return;
      S.display = m;
      document.querySelectorAll('#disp-mode button').forEach(function (x) { x.classList.toggle('on', x.dataset.mode === m); });
      if ($('plan-disp')) $('plan-disp').value = m;
      if ($('v3-hdisp') && $('v3-hdisp').querySelector('option[value="' + m + '"]')) $('v3-hdisp').value = m;
      if (CLW.View3D) CLW.View3D.dirty();
      try { localStorage.setItem('clwind-display', m); } catch (e) { /* rien */ }
      E.fieldDirty = true; needDraw = true; updateLegend(); drawVcut();
    }
    function setVdisplay(m) {
      S.vdisplay = m || 'suit'; if ($('vcut-disp')) $('vcut-disp').value = S.vdisplay; if ($('v3-vdisp')) $('v3-vdisp').value = S.vdisplay;
      try { localStorage.setItem('clwind-vdisplay', S.vdisplay); } catch (e) { /* rien */ }
      drawVcut(); if (CLW.View3D) CLW.View3D.dirty();
    }
    // vue 3D : coupes horizontale et verticale, vent, maquette (S.v3, mémorisé)
    S.v3 = { h: true, v: true, l: true, m: 'plein', o: true };
    try { var v3s = JSON.parse(localStorage.getItem('clwind-v3') || 'null'); if (v3s) Object.assign(S.v3, v3s); } catch (e) { /* rien */ }
    function setV3(o) {
      Object.assign(S.v3, o || {});
      if ($('v3-h')) { $('v3-h').checked = S.v3.h; $('v3-v').checked = S.v3.v; $('v3-l').checked = S.v3.l; $('v3-m').value = S.v3.m; if ($('v3-o')) $('v3-o').checked = S.v3.o !== false; }
      try { localStorage.setItem('clwind-v3', JSON.stringify(S.v3)); } catch (e) { /* rien */ }
      if (S.v3.v) drawVcut();
      if (CLW.View3D) CLW.View3D.dirty();
    }
    CLW.setV3 = setV3;
    if ($('v3-h')) {
      ['v3-h', 'v3-v', 'v3-l', 'v3-o'].forEach(function (id) { $(id).addEventListener('change', function () { var o = {}; o[id.slice(3)] = this.checked; setV3(o); }); });
      $('v3-m').addEventListener('change', function () { setV3({ m: this.value }); });
      $('v3-hdisp').addEventListener('change', function () { setDisplay(this.value); });
      $('v3-vdisp').addEventListener('change', function () { setVdisplay(this.value); });
      $('v3-z').addEventListener('change', function () { var z = parseNum(this.value); if (isFinite(z) && z > 0) { $('d-cut').value = z; $('d-cut').dispatchEvent(new Event('change')); } });
      setV3();
    }
    CLW.setDisplay = setDisplay; CLW.setVdisplay = setVdisplay;
    document.querySelectorAll('#disp-mode button').forEach(function (b) { b.addEventListener('click', function () { setDisplay(b.dataset.mode); }); });
    if ($('plan-disp')) $('plan-disp').addEventListener('change', function () { setDisplay(this.value); });
    if ($('vcut-disp')) $('vcut-disp').addEventListener('change', function () { setVdisplay(this.value); });
    try { var d0 = localStorage.getItem('clwind-display'), v0 = localStorage.getItem('clwind-vdisplay'); if (d0) setDisplay(d0); if (v0) setVdisplay(v0); } catch (e) { /* rien */ }
    CLW.drawVcut = drawVcut;
    CLW.redraw = function () { needDraw = true; };
    $('disp-particles').addEventListener('change', function () { S.particles = $('disp-particles').checked; needDraw = true; });
    if ($('bilan-show')) $('bilan-show').addEventListener('change', function () { needDraw = true; });
    document.querySelectorAll('#toolbar [data-tool]').forEach(function (b) { b.addEventListener('click', function () { setTool(b.dataset.tool); }); });
    $('t-undo').onclick = undo; $('t-del').onclick = deleteSel; $('t-fit').onclick = fit;
    $('c-pause').onclick = function () {
      E.paused = !E.paused;
      $('c-pause').textContent = E.paused ? 'Reprendre' : 'Pause';
      if (E.solver) { if (E.paused) E.solver.pause(); else E.solver.resume(); }
      updateCalcStatus();
    };
    $('c-reset').onclick = function () { requestReset(true); };
  }

  // ------------------------------------------------------------------ API pour les autres modules
  CLW.app = {
    state: S, engine: E,
    fmt: fmt, esc: esc,
    replaceOsm: function (objs, site) {
      // remplace l'exemple et l'import OSM précédent, conserve et recentre les autres objets
      pushHistory();
      var keep = S.objects.filter(function (o) { return o.src !== 'example' && o.src !== 'osm'; });
      if (keep.length) {
        var b = [Infinity, Infinity, -Infinity, -Infinity];
        keep.forEach(function (o) { CLW.geom.objBBox(o, b); });
        var cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
        keep.forEach(function (o) { moveObj(o, -cx, -cy); });
      }
      var g = CLW.newGroup();
      objs.forEach(function (o) { o.id = newId(); o.src = 'osm'; o.group = g; });
      S.objects = objs.concat(keep);
      S.site = site; S.example = false;
      S.domain.W = S.domain.H = Math.round(2 * site.radius);
      S.sel = null; updateSel(); syncDomainInputs(); sceneChanged(); fit();
    },
    addImported: function (objs, label) {
      pushHistory();
      if (S.example) { S.objects = S.objects.filter(function (o) { return o.src !== 'example'; }); S.example = false; }
      var g = CLW.newGroup();
      objs.forEach(function (o) { o.id = newId(); o.src = 'import'; o.group = g; o.importLabel = label; });
      S.objects = S.objects.concat(objs);
      // emprise > quart du domaine : agrandir à 4 × la plus grande dimension
      var b = [Infinity, Infinity, -Infinity, -Infinity];
      objs.forEach(function (o) { CLW.geom.objBBox(o, b); });
      var ew = b[2] - b[0], eh = b[3] - b[1], grown = false;
      if (ew * eh > S.domain.W * S.domain.H / 4 || ew > S.domain.W / 2 || eh > S.domain.H / 2) {
        var side = clamp(Math.round(4 * Math.max(ew, eh)), 50, 1500);
        if (side > Math.max(S.domain.W, S.domain.H) || ew * eh > S.domain.W * S.domain.H / 4) { S.domain.W = Math.max(S.domain.W, side); S.domain.H = Math.max(S.domain.H, side); grown = true; }
      }
      S.sel = null; updateSel(); syncDomainInputs(); sceneChanged(); fit();
      return grown;
    },
    // liaison Grasshopper : remplace les objets « live » précédents, sans historique sauf la première fois
    replaceLive: function (objs, first, label) {
      if (first) pushHistory();
      S.objects = S.objects.filter(function (o) { return o.src !== 'example' && o.src !== 'live'; });
      S.example = false;
      if (!liveGroup) liveGroup = CLW.newGroup();
      objs.forEach(function (o) { o.id = newId(); o.src = 'live'; o.group = liveGroup; o.importLabel = label || 'Grasshopper'; });
      S.objects = S.objects.concat(objs);
      // le domaine ne fait que grandir, pour ne pas changer la grille à chaque modification
      var b = [Infinity, Infinity, -Infinity, -Infinity], grown = false;
      objs.forEach(function (o) { CLW.geom.objBBox(o, b); });
      if (objs.length) {
        var ext = Math.max(2 * Math.abs(b[0]), 2 * Math.abs(b[2]), 0), eyt = Math.max(2 * Math.abs(b[1]), 2 * Math.abs(b[3]), 0);
        if (first) {
          // premier envoi : domaine ajusté (4 × l'emprise), y compris vers le bas pour un petit projet
          var s0 = clamp(Math.round(4 * Math.max(ext, eyt) / 5) * 5, 10, 1500);
          grown = s0 !== S.domain.W || s0 !== S.domain.H;
          S.domain.W = S.domain.H = s0;
        } else if (ext > S.domain.W / 2 || eyt > S.domain.H / 2) {
          var side = clamp(Math.round(4 * Math.max(ext, eyt)), 10, 1500); // même règle que l'import : 4 × l'emprise
          if (side > S.domain.W || side > S.domain.H) { S.domain.W = Math.max(S.domain.W, side); S.domain.H = Math.max(S.domain.H, side); grown = true; }
        }
      }
      if (!byId(S.sel)) S.sel = null;
      updateSel(); syncDomainInputs(); sceneChanged();
      if (first || grown) fit();
      return grown;
    },
    hasSite: function () { return !!S.site; },
    snapshotField: function () { return E; },
    drawLegend: drawLegend,
    resize: resize
  };

  // ------------------------------------------------------------------ démarrage
  function start() {
    S.objects = exampleScene();
    initPanel();
    setWindDir(270);
    setTool('select');
    resize(); fit(); updateLegend();
    window.addEventListener('resize', function () { resize(); updateLegend(); drawVcut(); drawProfile(); });
    updateCalcStatus();
    initEngine();
    if (CLW.OSM && CLW.OSM.init) CLW.OSM.init();
    if (CLW.EPW && CLW.EPW.init) CLW.EPW.init();
    if (CLW.Import && CLW.Import.init) CLW.Import.init();
    if (CLW.Export && CLW.Export.init) CLW.Export.init();
    if (CLW.Live && CLW.Live.init) CLW.Live.init();
    if (CLW.Sun && CLW.Sun.init) CLW.Sun.init();
    if (CLW.Thermal && CLW.Thermal.init) CLW.Thermal.init();
    if (CLW.Mesures && CLW.Mesures.init) CLW.Mesures.init();
    if (CLW.Vues && CLW.Vues.init) CLW.Vues.init();
    if (CLW.Zoom && CLW.Zoom.init) CLW.Zoom.init();
    // essai automatique (banc de test) : chargé seulement avec ?autotest=
    if (/[?&]autotest=/.test(location.search)) { var st = document.createElement('script'); st.src = 'tests/autotest.js'; document.head.appendChild(st); }
    requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})(window);
