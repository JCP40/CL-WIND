/* CL-WIND - live.js
 * Liaison Grasshopper en direct. Actif seulement quand la page est servie par le composant
 * « CL-WIND Live » (grasshopper/clwind_live.py) : la page attend chaque nouvelle scène
 * par requête longue sur live/scene, puis remplace les objets reçus et relance le calcul.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  // rev : version de la scène affichée (Grasshopper ou 3DM), ghRev : dernier envoi lu sur le serveur
  var LIVE = CLW.Live = { rev: 0, ghRev: 0, ghLast: null, origin: null, active: false, last: null, count: 0, src: null, bySeason: {} };
  function $(id) { return document.getElementById(id); }
  function status(t, cls) { var el = $('live-status'); if (el) { el.textContent = t; el.className = 'status' + (cls ? ' ' + cls : ''); } }
  function num(x, d) { x = +x; return isFinite(x) ? x : d; }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

  // scène reçue (mètres, y vers le nord) → objets CL-WIND, non décalés
  LIVE.toObjects = function (d) {
    var treeA = (CLW.LBM && CLW.LBM.TREE_A) || 0.15;
    var rings = (d.rings || []).filter(function (r) { return r && r.length >= 3; })
      .map(function (r) { return r.map(function (p) { return [num(p[0], 0), num(p[1], 0)]; }); });
    // seuil bas : les sections de briques ou de lames font quelques cm² ; ce qui est plus petit qu'une cellule disparaît au maillage
    var objs = CLW.Import.ringsToBuildings(rings, 0.002);
    // éléments d'écrans poreux (briques, lames) : non pleins, soudés en bandes poreuses au calcul
    (d.screens || []).forEach(function (r) {
      if (r && r.length >= 3) objs.push({ type: 'building', outer: r.map(function (p) { return [num(p[0], 0), num(p[1], 0)]; }), holes: [], screen: true, joint: d.joint > 0 ? +d.joint : null });
    });
    (d.walls || []).forEach(function (w) {
      if (w && w.pts && w.pts.length >= 2) objs.push({ type: 'wall', pts: w.pts.map(function (p) { return [num(p[0], 0), num(p[1], 0)]; }), thick: clamp(num(w.thick, 0.3), 0.05, 5) });
    });
    (d.trees || []).forEach(function (t) {
      if (!t) return;
      // plantes grimpantes : colonne de feuillage fine (z0 → z1 au-dessus du point le plus bas de la scène)
      var cut = d.cut != null ? +d.cut : null;
      if (t.z1 != null && t.z0 != null) objs.push({ type: 'tree', x: num(t.x, 0), y: num(t.y, 0), r: clamp(num(t.r, 0.15), 0.03, 5), a: clamp(num(t.a, 0.6), 0, 5),
        z0: Math.max(0, num(t.z0, 0)), z1: Math.max(0.05, num(t.z1, 2)), kind: t.kind || 'plante', noCut: cut != null && (cut < +t.z0 || cut > +t.z1) });
      else if (t.zc != null && t.rz != null) objs.push({ type: 'tree', x: num(t.x, 0), y: num(t.y, 0), r: clamp(num(t.r, 5), 0.5, 40), a: clamp(num(t.a, treeA), 0, 2),
        zc: Math.max(0.5, num(t.zc, 5)), rz: clamp(num(t.rz, 3), 0.3, 30), noCut: cut != null && (cut < +t.zc - +t.rz || cut > +t.zc + +t.rz) });
      else objs.push({ type: 'tree', x: num(t.x, 0), y: num(t.y, 0), r: clamp(num(t.r, 5), 0.5, 40), a: clamp(num(t.a, treeA), 0, 2) });
    });
    return objs;
  };

  function center(objs) {
    var b = [Infinity, Infinity, -Infinity, -Infinity];
    objs.forEach(function (o) { CLW.geom.objBBox(o, b); });
    return isFinite(b[0]) ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null;
  }

  // opts : { label: 'V1.3dm', src: '3dm', recenter: true } ; par défaut, envoi de Grasshopper
  LIVE.apply = function (d, opts) {
    opts = opts || d._opts || {};
    d._opts = opts;
    if (opts.recenter) LIVE.origin = null;
    LIVE.last = d; LIVE.rev++; LIVE.active = true; LIVE.src = opts.src || 'gh';
    // géométrie par saison (entrée « saison » du composant) : gardée pour les jours de cette saison
    if (d.saison === 'ete' || d.saison === 'hiver') { LIVE.bySeason[d.saison] = d; LIVE.seasonRev = (LIVE.seasonRev || 0) + 1; }
    var objs = LIVE.toObjects(d);
    // le premier envoi NON VIDE fixe l'origine et ajuste le domaine
    var first = !LIVE.origin && objs.length > 0;
    if (first) LIVE.origin = center(objs);
    var o0 = LIVE.origin || [0, 0];
    objs.forEach(function (o) { CLW.moveObj(o, -o0[0], -o0[1]); });
    var grown = CLW.app.replaceLive(objs, first, opts.label || 'Grasshopper');
    // vent du jour coché (onglet Soleil) : le vent de Grasshopper est ignoré, le jour choisi décide
    if (d.wind && !(CLW.EPW && CLW.EPW.dayWindOn && CLW.EPW.dayWindOn())) CLW.setWind(d.wind.dir != null ? num(d.wind.dir, null) : null, d.wind.speed != null ? clamp(num(d.wind.speed, 5), 0.5, 20) : null);
    LIVE.count++;
    if (CLW.Thermal && CLW.Thermal.applyStation) { try { CLW.Thermal.applyStation(d.station || null); } catch (e) { console.error(e); } }
    var n = { building: 0, wall: 0, tree: 0, screen: 0 };
    objs.forEach(function (o) { n[o.screen ? 'screen' : o.type]++; });
    var fmt = CLW.fmt || function (x) { return String(x); };
    LIVE.lastCounts = n; LIVE.lastGrown = grown;
    if (LIVE.src !== 'gh') return;
    status('Connecté à Grasshopper' + (d.doc ? ' (' + d.doc + ')' : '') + '. Envoi n° ' + d.rev + ' : ' +
      CLW.plur(n.building, 'bâtiment', 'bâtiments') + ', ' + CLW.plur(n.wall, 'mur', 'murs') + ', ' + CLW.plur(n.tree, 'arbre', 'arbres') +
      (n.screen ? ', ' + CLW.plur(n.screen, 'élément d\'écran poreux', 'éléments d\'écran poreux') : '') + '.' +
      (d.saison ? '\nGéométrie d\'' + (d.saison === 'ete' ? 'été' : 'hiver') + ' (gardées : ' + Object.keys(LIVE.bySeason).map(function (s) { return s === 'ete' ? 'été' : 'hiver'; }).join(' et ') + ').' : '') +
      (d.plantes ? '\n' + CLW.plur(d.plantes, 'colonne de plantes grimpantes', 'colonnes de plantes grimpantes') + '.' : '') +
      (d.catch ? '\nToit récupérateur de pluie : ' + fmt(d.catch, 0) + ' m².' : '') +
      (d.station ? '\nStation météo : goutte-à-goutte si l\'air ≥ ' + fmt(d.station.Ton, 0) + ' °C et humidité < ' + fmt(d.station.HRoff, 0) + ' %, clapets fermés si vent ≥ ' + fmt(d.station.Vstorm, 0) + ' m/s.' : '') +
      (d.cut != null ? '\nCoupe à ' + fmt(d.cut, 2) + ' m au-dessus du point le plus bas.' : '') +
      (d.open ? '\n' + CLW.plur(d.open, 'contour ouvert ignoré', 'contours ouverts ignorés') + ' (volume non fermé).' : '') +
      (grown ? '\nDomaine ajusté : ' + CLW.state.domain.W + ' × ' + CLW.state.domain.H + ' m.' : '') +
      (d.warn ? '\n' + d.warn : ''), 'ok');
  };

  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function loop() {
    var fails = 0;
    for (;;) {
      try {
        var r = await fetch('live/scene?since=' + LIVE.ghRev, { cache: 'no-store' });
        if (r.status === 200) {
          var d = await r.json();
          fails = 0;
          if (d.rev !== LIVE.ghRev) { // rev plus petit : Grasshopper a redémarré le serveur
            LIVE.ghRev = d.rev; LIVE.ghLast = d;
            if ($('live-follow').checked) LIVE.apply(d);
            else status('Nouvel envoi n° ' + d.rev + ' en attente : cochez « Suivre Grasshopper ».');
          }
        } else if (r.status !== 204) throw new Error('HTTP ' + r.status);
        else if (fails) { fails = 0; status('Connecté à Grasshopper, en attente d\'un envoi.', 'ok'); }
      } catch (e) {
        fails++;
        status('Grasshopper ne répond plus (composant arrêté, Rhino fermé ?). Nouvel essai…', 'err');
        await wait(Math.min(5000, 500 * fails));
      }
    }
  }

  LIVE.init = function () {
    if (!/^https?:$/.test(location.protocol)) return;
    fetch('live/ping', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.clwind) return;
      LIVE.active = true;
      var sec = $('live-section'); sec.hidden = false; sec.open = true;
      status('Connecté à Grasshopper, en attente d\'un envoi.', 'ok');
      $('live-follow').addEventListener('change', function () { if (this.checked && LIVE.ghLast) LIVE.apply(LIVE.ghLast); });
      $('live-center').onclick = function () { LIVE.origin = null; if (LIVE.last) LIVE.apply(LIVE.last); };
      loop();
    }).catch(function () { /* page servie par autre chose : pas de liaison */ });
  };
})(window);
