/* CL-WIND - etapes.js
 * Barre latérale par étapes de travail : 1 Modèle, 2 Météo, 3 Vent, 4 Soleil et chaleur, 5 Confort, 6 Comparer et exporter.
 * - la colonne Résultats ne montre que les blocs de l'étape (attribut data-steps ; « * » = toujours), sauf si
 *   « Tous les résultats » est coché (mémorisé : clwind-res-all) ;
 * - boutons « Voir » : changent la vue (data-go="view:…") ou la grandeur affichée (data-go="mode:…") ;
 * - bouton « Étape suivante » en bas de chaque étape ;
 * - état de chaque étape (coche dans la barre et ligne d'état en tête d'étape), relu toutes les secondes.
 * Les sections gardent leurs identifiants : le reste de l'application ne voit pas la différence.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  function $(id) { return document.getElementById(id); }
  function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function fmt(x, d) { return CLW.fmt ? CLW.fmt(x, d) : (+x).toFixed(d); }
  var cur = null;

  function allRes() { var c = $('res-all'); return !!(c && c.checked); }
  function filterResults() {
    var all = allRes();
    qa('#results details[data-steps]').forEach(function (d) {
      var s = d.dataset.steps;
      d.hidden = !(all || s === '*' || (' ' + s + ' ').indexOf(' ' + cur + ' ') >= 0);
    });
  }
  CLW.onStep = function (t) {
    cur = t; filterResults(); refresh();
    var p = $('panel'); if (p) p.scrollTop = 0;
    // les graphiques des blocs qui réapparaissent sont redessinés à leur largeur
    setTimeout(function () { window.dispatchEvent(new Event('resize')); if (CLW.Thermal && CLW.Thermal.render && cur === 'chaleur') try { CLW.Thermal.render(); } catch (e) { /* rien */ } }, 0);
  };

  function go(g) {
    var p = g.split(':'), S = CLW.state || {};
    if (p[0] === 'tool') { var tb = document.querySelector('#toolbar [data-tool="' + p[1] + '"]'); if (tb) tb.click(); return; }
    if (p[0] === 'view') { var b = document.querySelector('#view-mode button[data-view="' + p[1] + '"]'); if (b) b.click(); return; }
    if (p[0] === 'mode') {
      if (S.viewMode === 'soleil' || S.viewMode === 'zoom') { var pl = document.querySelector('#view-mode button[data-view="plan"]'); if (pl) pl.click(); }
      var m = document.querySelector('#disp-mode button[data-mode="' + p[1] + '"]'); if (m) m.click();
    }
  }

  // ---------------------------------------------------------------- état des étapes
  function stepState(k) {
    var S = CLW.state || {}, E = CLW.engine || {}, TH = CLW.Thermal, L = CLW.Live;
    try {
      if (k === 'modele') {
        var n = (S.objects || []).length;
        if (!n) return [false, 'À faire : aucun objet. Lancez le composant CL-WIND Live de Grasshopper, ou importez un plan.'];
        return [true, n + ' objet' + (n > 1 ? 's' : '') + ' dans la scène' + (L && L.last ? ', reçus de Grasshopper' : '') + '.'];
      }
      if (k === 'meteo') {
        var ok = CLW.EPW && CLW.EPW.data && CLW.EPW.data();
        if (!ok) return [false, 'À faire : chargez un fichier EPW (sans lui : pas de soleil, de chaleur ni de confort).'];
        return [true, 'Météo : ' + (CLW.EPW.name || 'fichier chargé') + '.'];
      }
      if (k === 'vent') {
        if (!(S.objects || []).length) return [false, 'À faire après l\'étape 1 : il faut un modèle.'];
        if (E.stable) return [true, 'Moyenne stabilisée' + (S.mode3d ? ' (3D)' : ' (plan 2D)') + ' : le résultat peut être lu.'];
        var bar = $('c-bar'), pc = bar && bar.style.width ? parseFloat(bar.style.width) : 0;
        return [false, (E.paused ? 'En pause' : 'Calcul en cours') + (pc ? ' : ' + Math.round(pc) + ' %' : '') + '. Attendez « Moyenne stabilisée ».'];
      }
      if (k === 'chaleur') {
        var s = TH && TH.summary && TH.summary();
        if (!s) return [false, 'À faire : il faut un fichier EPW (étape 2) et une paroi en briques ou lames.'];
        return [true, 'Journée calculée : air au plus chaud ' + fmt(s.TaMax, 1) + ' °C dehors, ' + fmt(s.TiMax, 1) + ' °C dedans.'];
      }
      if (k === 'confort') {
        var u = TH && TH.utciState, ep = TH && TH.episodeState, t = [];
        if (u && u.running) return [false, 'UTCI en cours : ' + Math.round(100 * u.progress) + ' %.'];
        if (ep && ep.running) return [false, 'Épisode en cours : ' + Math.round(100 * ep.progress) + ' %.'];
        if (u && u.res) t.push('UTCI été et hiver calculé');
        if (ep && ep.res) t.push('épisode analysé');
        return t.length ? [true, t.join(', ') + '.'] : [false, 'À faire : « 1. Balayer les vents », puis « 2. Calculer l\'UTCI », ou analyser un épisode mesuré.'];
      }
      if (k === 'formes') {
        var on = document.querySelector('#toolbar [data-tool].on'), nd = (S.objects || []).filter(function (o) { return o.src === 'draw'; }).length;
        return [null, 'Outil : ' + (on ? on.childNodes[0].textContent.trim() : 'Sélection') + (nd ? ' · ' + nd + ' forme' + (nd > 1 ? 's' : '') + ' dessinée' + (nd > 1 ? 's' : '') : '')];
      }
      if (k === 'reglages') {
        var dim = $('d-dim'), sel = S.mode3d ? $('d-res3d') : $('d-res'), opt = sel && sel.options[sel.selectedIndex];
        return [null, (S.mode3d ? 'Calcul 3D' : 'Plan 2D') + (opt ? ', ' + opt.textContent.toLowerCase() : '') + ' · domaine ' + fmt(S.domain ? S.domain.W : +$('d-w').value, 0) + ' × ' + fmt(S.domain ? S.domain.H : +$('d-h').value, 0) + ' m · zone ressenti ' + ($('th-mapZone') ? $('th-mapZone').value : '?') + ' m'];
      }
      if (k === 'rendu') {
        var v = CLW.Variants && CLW.Variants.list ? CLW.Variants.list.length : 0;
        return v ? [true, v + ' variante' + (v > 1 ? 's' : '') + ' mémorisée' + (v > 1 ? 's' : '') + '.'] : [false, 'Aucune variante mémorisée pour l\'instant.'];
      }
    } catch (e) { /* état inconnu */ }
    return [false, ''];
  }
  function refresh() {
    qa('#tabs button[data-tab]').forEach(function (b) {
      var st = stepState(b.dataset.tab), ss = b.querySelector('.ss');
      b.classList.toggle('done', st[0]);
      if (ss) { ss.textContent = st[0] ? '✓' : ''; }
      b.title = b.querySelector('.sl').textContent + (st[1] ? ' — ' + st[1] : '');
    });
    qa('.step-check[data-check]').forEach(function (d) {
      var st = stepState(d.dataset.check);
      d.textContent = st[1]; d.className = 'step-check ' + (st[0] ? 'ok' : 'todo');
    });
  }

  // ---------------------------------------------------------------- menu « Forme de base » de la barre d'outils
  function initFormsMenu() {
    var btn = $('tb-forms-btn'), pop = $('tb-forms'), cur = $('tb-forms-cur'); if (!btn || !pop) return;
    function place() { var r = btn.getBoundingClientRect(); pop.style.left = Math.round(r.left) + 'px'; pop.style.top = Math.round(r.bottom + 4) + 'px'; }
    function open(v) { pop.hidden = !v; btn.setAttribute('aria-expanded', v ? 'true' : 'false'); if (v) place(); }
    btn.addEventListener('click', function (e) { e.stopPropagation(); open(pop.hidden); });
    pop.addEventListener('click', function (e) { if (e.target.closest('button')) setTimeout(function () { open(false); }, 0); });
    document.addEventListener('mousedown', function (e) { if (!pop.hidden && !pop.contains(e.target) && e.target !== btn && !btn.contains(e.target)) open(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !pop.hidden) open(false); });
    window.addEventListener('resize', function () { if (!pop.hidden) place(); });
    var bar = $('toolbar'); if (bar) bar.addEventListener('scroll', function () { if (!pop.hidden) place(); });
    // l'outil actif (clic, raccourci clavier ou bouton « Sonde P » des étapes) s'affiche sur le bouton du menu
    function label() {
      var on = pop.querySelector('[data-tool].on');
      if (cur) cur.textContent = on ? on.childNodes[0].textContent.trim() : '';
      btn.classList.toggle('on', !!on && on.dataset.tool !== 'select');
    }
    qa('#tb-forms [data-tool]').forEach(function (b) { new MutationObserver(label).observe(b, { attributes: true, attributeFilter: ['class'] }); });
    label();
  }

  // ---------------------------------------------------------------- en haut à droite : temps de calcul, carte graphique
  function calcMini() {
    var el = $('calc-mini'), fill = $('cm-fill'), tx = $('cm-txt'); if (!el) return;
    var TH = CLW.Thermal, u = TH && TH.utciState, ep = TH && TH.episodeState, se = TH && TH.seasonState, E = CLW.engine || {};
    var pc = 0, txt = '', done = false;
    if (u && u.running) { pc = 100 * u.progress; txt = 'UTCI ' + Math.round(pc) + ' %'; }
    else if (ep && ep.running) { pc = 100 * ep.progress; txt = 'Épisode ' + Math.round(pc) + ' %'; }
    else if (se && se.running) { pc = 100 * se.progress; txt = 'Été ' + Math.round(pc) + ' %'; }
    else {
      var bar = $('c-bar'), st = ($('c-status') || {}).textContent || '';
      pc = bar && bar.style.width ? parseFloat(bar.style.width) : 0;
      done = !!E.stable || (bar && bar.classList.contains('done'));
      var m = st.match(/encore\s*≈\s*([^,·.]+?)(?:[,·.]|$)/);
      txt = done ? 'Vent stabilisé' : E.paused ? 'En pause' : 'Vent ' + Math.round(pc) + ' %' + (m ? ' · ≈ ' + m[1].trim() : '');
      if (done) pc = 100;
    }
    fill.style.width = Math.max(0, Math.min(100, pc)) + '%'; tx.textContent = txt; el.classList.toggle('done', done);
  }
  var gpuT = -1e9;
  function gpuTemp() {
    var el = $('gpu-temp'); if (!el || !/^https?:$/.test(location.protocol) || document.hidden) return;
    if (performance.now() - gpuT < 3000) return; gpuT = performance.now();
    fetch('live/gpu', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.ok || j.temp == null) { el.hidden = true; return; }
      el.hidden = false;
      el.textContent = 'GPU ' + Math.round(j.temp) + ' °C' + (j.load != null ? ' · ' + Math.round(j.load) + ' %' : '');
      el.title = (j.name || 'Carte graphique') + ' : ' + Math.round(j.temp) + ' °C, charge ' + Math.round(j.load || 0) + ' %' + (j.power != null ? ', ' + Math.round(j.power) + ' W' : '') + ' (nvidia-smi, lu par le composant CL-WIND Live)';
      el.classList.toggle('warm', j.temp >= 75 && j.temp < 85); el.classList.toggle('hot', j.temp >= 85);
    }).catch(function () { el.hidden = true; });
  }

  // étape 7 : les boutons d'outil du panneau suivent l'outil actif ; « data-click » relaie vers un bouton de la barre
  function initFormsStep() {
    function sync() {
      qa('[data-tool-mirror]').forEach(function (b) {
        var t = document.querySelector('#toolbar [data-tool="' + b.dataset.toolMirror + '"]');
        b.classList.toggle('on', !!(t && t.classList.contains('on')));
      });
    }
    qa('#toolbar [data-tool]').forEach(function (b) { new MutationObserver(sync).observe(b, { attributes: true, attributeFilter: ['class'] }); });
    qa('[data-click]').forEach(function (b) { b.addEventListener('click', function () { var t = $(b.dataset.click); if (t) t.click(); }); });
    sync();
  }

  function init() {
    initFormsMenu(); initFormsStep();
    qa('button[data-go]').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.go); }); });
    qa('[data-goto]').forEach(function (b) { b.addEventListener('click', function () { if (CLW.showTab) CLW.showTab(b.dataset.goto); }); });
    qa('.step-next[data-next]').forEach(function (b) { b.addEventListener('click', function () { if (CLW.showTab) CLW.showTab(b.dataset.next); }); });
    var ra = $('res-all');
    if (ra) {
      try { ra.checked = localStorage.getItem('clwind-res-all') === '1'; } catch (e) { /* rien */ }
      ra.addEventListener('change', function () {
        try { localStorage.setItem('clwind-res-all', ra.checked ? '1' : '0'); } catch (e) { /* rien */ }
        filterResults(); setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 0);
      });
    }
    var on = document.querySelector('#tabs button.on');
    cur = on ? on.dataset.tab : 'modele';
    filterResults(); refresh();
    setInterval(refresh, 1000);
    setInterval(function () { calcMini(); gpuTemp(); }, 1000); calcMini(); gpuTemp();
  }
  // après main.js (qui choisit l'étape mémorisée et appelle CLW.onStep)
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
