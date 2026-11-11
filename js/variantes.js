/* CL-WIND - variantes.js
 * Variantes mémorisées : champ affiché (coupe), obstacles, bilan, profil selon la hauteur et vignette.
 * Une variante sert de référence : affichage « Écart » (différence de vitesse, même domaine et même
 * grille) et écarts du bilan. Les variantes vivent dans la page (perdues au rechargement).
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var V = CLW.Variants = { list: [], ref: null };
  var nextId = 1;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // signature de la grille affichée : l'écart carte n'a de sens qu'entre grilles identiques
  function sig(E, S) {
    var g = E.grid; if (!g) return '';
    return [S.mode3d ? '3d' : '2d', g.nx, g.ny, g.dx.toFixed(5), g.x0.toFixed(3), g.y0.toFixed(3), S.mode3d ? E.kslice : ''].join('|');
  }
  function thumb() {
    var src = $('plan'); if (!src || !src.width) return '';
    var w = 160, h = Math.max(1, Math.round(w * src.height / src.width)), c = document.createElement('canvas');
    c.width = w; c.height = h; c.getContext('2d').drawImage(src, 0, 0, w, h);
    try { return c.toDataURL('image/jpeg', 0.7); } catch (e) { return ''; }
  }
  function refresh() {
    var E = CLW.engine, S = CLW.state;
    E.fieldDirty = true;
    if (CLW.updateLegend) CLW.updateLegend();
    if (CLW.Bilan) CLW.Bilan.render(E, S);
    if (CLW.drawProfile) CLW.drawProfile();
    V.render();
  }

  V.save = function () {
    var E = CLW.engine, S = CLW.state;
    if (!E.grid || !E.samples) { $('var-list').textContent = 'Rien à mémoriser : le calcul n\'a pas encore de résultat.'; return; }
    var r = E.bilan && E.bilan.res;
    var it = {
      id: nextId++, name: 'Variante ' + String.fromCharCode(64 + nextId - 1 > 90 ? 90 : 64 + nextId - 1),
      sig: sig(E, S), mean: E.mean.slice(), solid: E.rast.solid.slice(),
      bilan: r ? { uMean: r.uMean, U: r.U, pen: r.pen, qin: r.qin, qOpen: r.qOpen, cls: r.cls.slice() } : null,
      profile: E.profile ? E.profile.map(function (q) { return Object.assign({}, q); }) : null,
      wind: { dir: S.wind.dir, speed: S.wind.speed }, mode3d: S.mode3d, cut: S.cut3d,
      stable: E.stable, trav: E.trav, time: new Date(), thumb: thumb(),
      res: S.mode3d ? 'Finesse 3D ' + ['aperçu', 'normale', 'fine'][S.res3d] : 'Plan 2D, résolution ' + S.res
    };
    V.list.push(it);
    if (!V.ref) V.ref = it;
    refresh();
  };
  V.refFor = function (E) { var S = CLW.state; return V.ref && V.ref.sig === sig(E, S) ? V.ref : null; };
  V.sameGrid = function () { var E = CLW.engine; return !!V.refFor(E); };

  // écarts du bilan courant à la référence (texte pour le panneau Bilan)
  V.deltaHtml = function (r) {
    var R = V.ref; if (!R || !R.bilan || !r) return '';
    var f = CLW.fmt, b = R.bilan;
    function pts(x) { return (x >= 0 ? '+' : '−') + f(Math.abs(x), 0); }
    var du = 100 * (r.uMean / r.U - b.uMean / b.U), dp = 100 * (r.pen - b.pen);
    var dq = b.qin > 0 ? 100 * (r.qin / b.qin - 1) : 0;
    var same = V.sameGrid();
    return '<div class="bil-row" style="margin-top:10px"><span>Écart à « ' + esc(R.name) + ' »</span></div>' +
      '<div class="bil-row sub"><span>vitesse intérieure ' + pts(du) + ' points (' + f(100 * b.uMean / b.U, 0) + ' → ' + f(100 * r.uMean / r.U, 0) + ' % du vent libre)</span></div>' +
      '<div class="bil-row sub"><span>pénétration ' + pts(dp) + ' points, air entrant ' + pts(dq) + ' %</span></div>' +
      (same ? '' : '<div class="bil-row sub"><span>Grille ou hauteur de coupe différentes : écart sur la carte indisponible, bilans comparables.</span></div>');
  };

  V.render = function () {
    var box = $('var-list'); if (!box) return;
    if (!V.list.length) { box.className = 'hint'; box.textContent = 'Aucune variante mémorisée.'; return; }
    box.className = '';
    var f = CLW.fmt;
    box.innerHTML = V.list.map(function (it) {
      var b = it.bilan, isRef = V.ref === it;
      var meta = (it.mode3d ? '3D, coupe ' + f(it.cut, 1) + ' m' : '2D') + ' · vent ' + f(it.wind.speed, 1) + ' m/s de ' + Math.round(it.wind.dir) + '°' +
        (b ? ' · intérieur ' + f(100 * b.uMean / b.U, 0) + ' %, pénétration ' + f(100 * b.pen, 0) + ' %' : '') + (it.stable ? '' : ' · provisoire');
      return '<div class="var-item' + (isRef ? ' ref' : '') + '" data-id="' + it.id + '">' +
        (it.thumb ? '<img src="' + it.thumb + '" alt="">' : '') +
        '<div class="vn"><b title="Cliquer pour renommer">' + esc(it.name) + (isRef ? ' (référence)' : '') + '</b>' + esc(meta) + '</div>' +
        (isRef ? '' : '<button data-act="ref" title="Comparer à cette variante">Réf.</button>') +
        '<button data-act="del" title="Retirer">×</button></div>';
    }).join('');
    box.querySelectorAll('.var-item').forEach(function (el) {
      var it = V.list.filter(function (x) { return x.id === +el.dataset.id; })[0];
      el.querySelector('b').onclick = function () { var n = prompt('Nom de la variante', it.name); if (n) { it.name = n.slice(0, 60); refresh(); } };
      var br = el.querySelector('[data-act="ref"]'); if (br) br.onclick = function () { V.ref = it; refresh(); };
      el.querySelector('[data-act="del"]').onclick = function () {
        V.list = V.list.filter(function (x) { return x !== it; });
        if (V.ref === it) V.ref = V.list[0] || null;
        refresh();
      };
    });
  };

  var btn = $('var-save'); if (btn) btn.addEventListener('click', V.save);
})(window);
