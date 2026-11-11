/* CL-WIND - vues.js
 * Barre de vues enregistrées (sous la barre d'outils) : une vue = disposition (plan, coupe, plan + coupe,
 * plan | coupe, 3D, soleil, zoom mur), grandeur du plan, grandeur de la coupe, hauteur de coupe, trait de coupe,
 * date et heure, particules. Clic : rappeler ; double clic : renommer ; ⟳ : remplacer par l'état actuel ; × : supprimer ;
 * touches 1 à 9 : rappeler. Gardées dans ce navigateur (localStorage). Vues de départ proposées si la liste est vide.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var VB = CLW.Vues = { list: [], cur: -1 };
  var KEY = 'clwind-vues';
  var DEFAUT = [
    { name: 'Vent en plan', view: 'plan', display: 'speed', vdisplay: 'suit' },
    { name: 'Vent : plan + coupe', view: 'both', display: 'speed', vdisplay: 'suit' },
    { name: 'Vent en plan, température en coupe', view: 'both', display: 'speed', vdisplay: 'temp' },
    { name: 'Température : plan | coupe', view: 'cote', display: 'temp', vdisplay: 'temp' },
    { name: 'UTCI en plan', view: 'plan', display: 'utci', vdisplay: 'suit' },
    { name: '3D : vent et coupes', view: '3d', display: 'speed', vdisplay: 'suit', v3: { h: true, v: true, l: true, m: 'plein', o: true } },
    { name: '3D : vent, coupes en température', view: '3d', display: 'temp', vdisplay: 'temp', v3: { h: true, v: true, l: true, m: 'plein', o: true } },
    { name: 'Soleil et ombres', view: 'soleil', display: 'speed', vdisplay: 'suit' }
  ];
  function $(id) { return document.getElementById(id); }
  function S() { return CLW.app.state; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(VB.list)); } catch (e) { /* rien */ } }
  function load() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (Array.isArray(v) && v.length) return v; } catch (e) { /* rien */ }
    return DEFAUT.map(function (d) { return Object.assign({}, d); });
  }
  // état actuel → vue
  VB.capture = function (name) {
    var s = S(), sun = CLW.Sun && CLW.Sun.state;
    return { name: name, view: s.viewMode, display: s.display, vdisplay: s.vdisplay || 'suit', cut: s.cut3d,
      section: s.section ? { a: s.section.a.slice(), b: s.section.b.slice() } : null,
      sun: sun ? { m: sun.m, d: sun.d, t: sun.t, cut: sun.cut, cutAz: sun.cutAz } : null, particles: s.particles, v3: s.v3 ? Object.assign({}, s.v3) : null };
  };
  // vue → état (seulement ce que la vue précise)
  VB.apply = function (i) {
    var v = VB.list[i]; if (!v) return;
    if (v.display && CLW.setDisplay) CLW.setDisplay(v.display);
    if (CLW.setVdisplay) CLW.setVdisplay(v.vdisplay || 'suit');
    if (v.cut != null && $('d-cut')) { $('d-cut').value = v.cut; $('d-cut').dispatchEvent(new Event('change')); }
    if (v.section && CLW.setSection) CLW.setSection({ a: v.section.a.slice(), b: v.section.b.slice() });
    if (v.sun && CLW.Sun) CLW.Sun.set(v.sun);
    if (v.v3 && CLW.setV3) CLW.setV3(v.v3);
    if (v.particles != null && $('disp-particles') && $('disp-particles').checked !== v.particles) { $('disp-particles').checked = v.particles; $('disp-particles').dispatchEvent(new Event('change')); }
    if (v.view && CLW.setView) CLW.setView(v.view);
    VB.cur = i; render();
  };
  function render() {
    var box = $('vb-list'); if (!box) return;
    box.innerHTML = '';
    VB.list.forEach(function (v, i) {
      var chip = document.createElement('span'); chip.className = 'vb-chip' + (i === VB.cur ? ' on' : '');
      var b = document.createElement('button'); b.type = 'button';
      b.innerHTML = (i < 9 ? '<kbd>' + (i + 1) + '</kbd>' : '') + esc(v.name);
      b.title = describe(v) + '\nClic : rappeler · double clic : renommer';
      b.onclick = function () { VB.apply(i); };
      b.ondblclick = function () { var n = prompt('Nom de la vue', v.name); if (n && n.trim()) { v.name = n.trim(); save(); render(); } };
      var up = document.createElement('button'); up.type = 'button'; up.className = 'vb-up'; up.textContent = '⟳'; up.title = 'Remplacer par la vue actuelle';
      up.onclick = function () { VB.list[i] = VB.capture(v.name); VB.cur = i; save(); render(); };
      var x = document.createElement('button'); x.type = 'button'; x.className = 'vb-x'; x.textContent = '×'; x.title = 'Supprimer cette vue';
      x.onclick = function () { if (!confirm('Supprimer la vue « ' + v.name + ' » ?')) return; VB.list.splice(i, 1); if (VB.cur === i) VB.cur = -1; else if (VB.cur > i) VB.cur--; save(); render(); };
      chip.appendChild(b); chip.appendChild(up); chip.appendChild(x); box.appendChild(chip);
    });
  }
  var VIEWS = { plan: 'plan', coupe: 'coupe', both: 'plan + coupe', cote: 'plan | coupe', '3d': '3D', soleil: 'soleil', zoom: 'zoom mur' };
  var DISP = { speed: 'vitesse', ratio: 'rapport', comfort: 'confort', diff: 'écart', temp: 'température', feel: 'ressenti', utci: 'UTCI', suit: 'comme le plan' };
  function describe(v) {
    var t = 'Disposition : ' + (VIEWS[v.view] || v.view);
    if (v.view !== '3d' && v.view !== 'soleil' && v.view !== 'zoom' && v.view !== 'coupe') t += '\nPlan : ' + (DISP[v.display] || v.display);
    if (v.view === 'coupe' || v.view === 'both' || v.view === 'cote') t += '\nCoupe : ' + (DISP[v.vdisplay] || v.vdisplay);
    if (v.sun) t += '\nDate : ' + v.sun.d + '/' + v.sun.m + ', ' + (CLW.Sun && CLW.Sun.hhmm ? CLW.Sun.hhmm(v.sun.t) : v.sun.t + ' h');
    if (v.view === '3d') t += '\nCoupe horizontale : ' + (v.v3 && !v.v3.h ? 'non' : DISP[v.display] || v.display) + ' · coupe verticale : ' + (v.v3 && !v.v3.v ? 'non' : DISP[v.vdisplay] || v.vdisplay) +
      ' · vent : ' + (v.v3 && !v.v3.l ? 'non' : 'oui') + ' · maquette : ' + ({ plein: 'pleine', transp: 'transparente', aucune: 'masquée' }[(v.v3 || {}).m || 'plein']);
    if (v.cut != null) t += '\nCoupe horizontale à ' + String(v.cut).replace('.', ',') + ' m';
    return t;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  VB.init = function () {
    if (!$('viewbar')) return;
    VB.list = load(); render();
    $('vb-add').onclick = function () {
      var n = prompt('Nom de la nouvelle vue', (VIEWS[S().viewMode] || 'vue') + ' · ' + (DISP[S().display] || S().display));
      if (!n || !n.trim()) return;
      VB.list.push(VB.capture(n.trim())); VB.cur = VB.list.length - 1; save(); render();
    };
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var t = e.target, tag = t && t.tagName; if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
      if (/^[1-9]$/.test(e.key) && VB.list[+e.key - 1]) { VB.apply(+e.key - 1); e.preventDefault(); }
    });
  };
})(window);
