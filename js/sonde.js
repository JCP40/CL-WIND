/* CL-WIND - sonde.js
 * Sonde P liée entre les panneaux : un point (x, y, z) posé par l'outil Sonde (touche P), d'un clic dans le plan
 * ou dans la coupe verticale.
 * - repère dans le plan (cible magenta), dans la coupe verticale (à sa place si P est sur le trait, sinon projeté,
 *   en creux, avec sa distance au trait), et dans la vue 3D (pastille placée par CLW.View3D.project) ;
 * - fiche de valeurs en haut à droite de la vue, relue deux fois par seconde : vent, température, ressenti, UTCI
 *   (champ du plan à la hauteur de coupe), température dans la coupe verticale (3D), date et heure ;
 * - « Coupe par P » fait passer le trait de coupe par P (même direction) ; un clic dans la coupe 3D met aussi la
 *   coupe horizontale à la hauteur de P, pour que plan, coupe et 3D montrent le même point.
 * Mémorisée dans ce navigateur (clwind-sonde).
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var PR = CLW.Probe = { p: null };
  var COL = '#ff4fd8';
  function $(id) { return document.getElementById(id); }
  function fmt(x, d) { return CLW.fmt ? CLW.fmt(x, d) : (+x).toFixed(d); }
  function S() { return CLW.state || {}; }
  function E() { return CLW.engine || {}; }
  // hauteur de P : en 2D, celle de la coupe unique ; en 3D, la sienne, sinon celle de la coupe horizontale
  function zOf() { var p = PR.p, s = S(); if (!s.mode3d) return null; return p && p.z != null ? p.z : s.cut3d; }

  // position de P par rapport au trait de coupe : t le long de A → B (m), d de côté (m)
  function onCut(SL) {
    var p = PR.p, dx = SL.b[0] - SL.a[0], dy = SL.b[1] - SL.a[1], L = Math.hypot(dx, dy) || 1;
    var rx = p.x - SL.a[0], ry = p.y - SL.a[1];
    return { t: (rx * dx + ry * dy) / L, d: (rx * -dy + ry * dx) / L, L: L };
  }
  function tol() { var G = E().vox; return Math.max(0.3, G ? G.dx : 0.3); }

  function save() { try { localStorage.setItem('clwind-sonde', PR.p ? JSON.stringify(PR.p) : ''); } catch (e) { /* rien */ } }
  function redrawAll() {
    if (CLW.redraw) CLW.redraw();
    if (CLW.drawVcut) try { CLW.drawVcut(); } catch (e) { /* rien */ }
    if (CLW.View3D && CLW.View3D.dirty) CLW.View3D.dirty();
    card();
  }
  PR.set = function (q) {
    if (!q) { PR.p = null; save(); redrawAll(); return; }
    PR.p = { x: q.x, y: q.y, z: q.z != null ? q.z : null };
    // clic dans la coupe 3D : la coupe horizontale passe à la hauteur de P (le plan montre alors la même couche)
    if (q.z != null && S().mode3d && $('d-cut')) { $('d-cut').value = (Math.round(q.z * 100) / 100); $('d-cut').dispatchEvent(new Event('change')); }
    save(); redrawAll();
  };
  PR.clear = function () { PR.set(null); };
  // le trait de coupe passe par P, dans la même direction et avec la même longueur
  PR.cutThrough = function () {
    var p = PR.p; if (!p || !CLW.sectionLine || !CLW.setSection) return;
    var SL = CLW.sectionLine(), dx = SL.b[0] - SL.a[0], dy = SL.b[1] - SL.a[1], o = onCut(SL), L = o.L, ux = dx / L, uy = dy / L;
    var half = Math.min(L / 2, 40);
    CLW.setSection({ a: [p.x - ux * half, p.y - uy * half], b: [p.x + ux * half, p.y + uy * half] });
    redrawAll();
  };

  // ---------------------------------------------------------------- repères
  function target(c, x, y, r, lw, hollow) {
    c.save(); c.lineWidth = lw; c.strokeStyle = COL; c.fillStyle = hollow ? 'rgba(255,79,216,0.12)' : 'rgba(255,79,216,0.85)';
    c.beginPath(); c.arc(x, y, r, 0, 2 * Math.PI); c.fill(); c.stroke();
    c.beginPath(); c.moveTo(x - 2 * r, y); c.lineTo(x - r * 0.6, y); c.moveTo(x + r * 0.6, y); c.lineTo(x + 2 * r, y);
    c.moveTo(x, y - 2 * r); c.lineTo(x, y - r * 0.6); c.moveTo(x, y + r * 0.6); c.lineTo(x, y + 2 * r); c.stroke();
    c.restore();
  }
  // plan : contexte en mètres, y vers le haut ; px = taille d'un pixel écran en mètres
  PR.drawPlan = function (ctx, px) {
    var p = PR.p; if (!p) return;
    target(ctx, p.x, p.y, 6 * px, 2 * px, false);
    ctx.save(); ctx.scale(1, -1); ctx.font = 'bold ' + (13 * px) + 'px system-ui, sans-serif'; ctx.fillStyle = COL;
    ctx.fillText('P', p.x + 9 * px, -p.y - 9 * px); ctx.restore();
  };
  function cutLabel(c, x, y, o, dpr) {
    var txt = 'P' + (Math.abs(o.d) > tol() ? ' (à ' + fmt(Math.abs(o.d), 1) + ' m du trait)' : '');
    c.save(); c.font = 'bold ' + (12 * dpr) + 'px system-ui, sans-serif'; c.fillStyle = COL; c.textBaseline = 'bottom';
    c.fillText(txt, x + 9 * dpr, y - 6 * dpr); c.restore();
  }
  // coupe 3D : sx(t en m le long du trait), sy(z en m) donnés par main.js
  PR.drawCut3D = function (c, sx, sy, SL, L, dpr) {
    var p = PR.p; if (!p) return;
    var o = onCut(SL); if (o.t < -0.5 || o.t > L + 0.5) return;
    var z = zOf() || 1.5, X = sx(o.t), Y = sy(z), near = Math.abs(o.d) <= tol();
    c.save(); c.strokeStyle = 'rgba(255,79,216,0.55)'; c.lineWidth = dpr; c.setLineDash([4 * dpr, 4 * dpr]);
    c.beginPath(); c.moveTo(X, sy(0)); c.lineTo(X, Y); c.stroke(); c.restore();
    target(c, X, Y, 6 * dpr, 2 * dpr, !near); cutLabel(c, X, Y, o, dpr);
  };
  // coupe 2D (courbe de vitesse le long du trait)
  PR.drawCut2D = function (c, pl, gw, pt, gh, SL, L, dpr) {
    var p = PR.p; if (!p) return;
    var o = onCut(SL); if (o.t < 0 || o.t > L) return;
    var X = pl + gw * o.t / L;
    c.save(); c.strokeStyle = COL; c.lineWidth = 1.5 * dpr; c.setLineDash([5 * dpr, 4 * dpr]);
    c.beginPath(); c.moveTo(X, pt); c.lineTo(X, pt + gh); c.stroke(); c.restore();
    cutLabel(c, X, pt + 14 * dpr, o, dpr);
  };

  // ---------------------------------------------------------------- fiche de valeurs
  function values() {
    var p = PR.p, s = S(), e = E(), g = e.grid, rows = [];
    if (!g) return rows;
    var i = Math.floor((p.x - g.x0) / g.dx), j = Math.floor((g.y0 - p.y) / g.dx);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.ny) { rows.push(['', 'hors du domaine de calcul']); return rows; }
    var k = j * g.nx + i;
    if (!e.samples) rows.push(['Vent', 'en attente du calcul']);
    else if (e.rast && e.rast.solid[k]) rows.push(['Vent', 'dans un obstacle']);
    else {
      var U = CLW.LBM && CLW.LBM.U_LAT ? CLW.LBM.U_LAT : 0.1, r = e.mean[3 * k + 2] / U;
      rows.push(['Vent', fmt(r * s.wind.speed, 2) + ' m/s · ' + fmt(r, 2) + ' × vent libre' + (e.stable ? '' : ' (provisoire)')]);
    }
    var th = '';
    try { th = CLW.Thermal && CLW.Thermal.probeText ? CLW.Thermal.probeText(k) : ''; } catch (er) { th = ''; }
    if (th) th.split(' · ').filter(Boolean).forEach(function (t) {
      var m = t.match(/^(air sortant des joints|ciel visible|brique|air|ressenti|UTCI)\s+(.*)$/);
      rows.push(m ? [m[1].charAt(0).toUpperCase() + m[1].slice(1), m[2]] : ['', t]);
    });
    else rows.push(['Chaleur', '<span class="pc-hint">air, ressenti et UTCI : affichage Temp., Ressenti ou UTCI</span>']);
    // température dans la coupe verticale 3D, si P est sur le trait
    var TS = e.vcutTemp, Lt = e.vcutLayout, G = e.vox;
    if (s.mode3d && TS && Lt && G && CLW.sectionLine && CLW.Thermal && CLW.Thermal.sectionProbe) {
      var o = onCut(CLW.sectionLine());
      if (Math.abs(o.d) <= tol() && o.t >= 0 && o.t <= o.L) {
        var px = Math.round(o.t / o.L * (Lt.w - 1)), pz = Math.max(0, Math.min(Lt.h - 1, Math.floor((zOf() || 1.5) / G.dx)));
        var tx = CLW.Thermal.sectionProbe(TS, px, pz); if (tx) rows.push(['Coupe', tx]);
      }
    }
    return rows;
  }
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function card() {
    var el = $('probe-card'); if (!el) return;
    var p = PR.p; if (!p) { el.hidden = true; el.innerHTML = ''; return; }
    var z = zOf(), s = S(), ST = CLW.Sun && CLW.Sun.state, h = '';
    var where = 'x ' + fmt(p.x, 1) + ' · y ' + fmt(p.y, 1) + ' m' + (z != null ? ' · z ' + fmt(z, 2) + ' m' : ' · hauteur de coupe');
    var cutTxt = '';
    if (CLW.sectionLine && (s.mode3d || s.section)) { var o = onCut(CLW.sectionLine()); cutTxt = Math.abs(o.d) <= tol() ? 'sur le trait de coupe' : 'à ' + fmt(Math.abs(o.d), 1) + ' m du trait de coupe'; }
    var V = values();
    h += '<div class="pc-head"><b>Sonde P</b><span><button id="pc-f" title="' + (PR.fold ? 'Déplier la fiche' : 'Replier la fiche') + '">' + (PR.fold ? '+' : '–') + '</button> <button id="pc-x" title="Retirer la sonde">×</button></span></div>';
    if (PR.fold) {
      // repliée : une ligne, vent et température de l'air
      var short = V.filter(function (r) { return r[0] === 'Vent' || r[0] === 'Air' || r[0] === 'UTCI'; }).map(function (r) { return r[0] + ' ' + r[1].split(' · ')[0].replace(/\s*\(.*\)$/, ''); }).join(' · ');
      el.innerHTML = h + '<div class="pc-where">' + esc(short || where) + '</div>'; el.hidden = false; el.classList.add('fold');
      $('pc-x').onclick = PR.clear; $('pc-f').onclick = toggleFold; return;
    }
    el.classList.remove('fold');
    h += '<div class="pc-where">' + where + (cutTxt ? '<br>' + cutTxt : '') + '</div>';
    V.forEach(function (r) { h += '<div class="pc-row"><span>' + esc(r[0]) + '</span><b>' + (r[0] === 'Chaleur' ? r[1] : esc(r[1])) + '</b></div>'; });
    if (ST) h += '<div class="pc-where">' + ST.d + (ST.d === 1 ? 'er' : '') + ' ' + ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][ST.m - 1] + ', ' + fmt(ST.t, ST.t % 1 ? 2 : 0) + ' h</div>';
    h += '<div class="pc-btns"><button id="pc-cut" title="Le trait de coupe verticale passe par P, dans la même direction">Coupe par P</button></div>';
    el.innerHTML = h; el.hidden = false;
    $('pc-x').onclick = PR.clear; $('pc-cut').onclick = PR.cutThrough; $('pc-f').onclick = toggleFold;
  }
  function toggleFold() {
    PR.fold = !PR.fold;
    try { localStorage.setItem('clwind-sonde-fold', PR.fold ? '1' : '0'); } catch (e) { /* rien */ }
    card();
  }
  PR.card = card;

  // ---------------------------------------------------------------- pastille 3D
  function pin() {
    var el = $('probe-pin3d'), s = S(), p = PR.p;
    if (el) {
      var q = p && s.view3d && CLW.View3D && CLW.View3D.project ? CLW.View3D.project(p.x, p.y, zOf() || 1.5) : null;
      if (q) { el.style.left = q[0] + 'px'; el.style.top = q[1] + 'px'; el.hidden = false; } else el.hidden = true;
    }
    requestAnimationFrame(pin);
  }

  function init() {
    try { var t = localStorage.getItem('clwind-sonde'); if (t) PR.p = JSON.parse(t); PR.fold = localStorage.getItem('clwind-sonde-fold') === '1'; } catch (e) { PR.p = null; }
    card(); redrawAll();
    setInterval(function () { if (PR.p && !document.hidden) card(); }, 600);
    requestAnimationFrame(pin);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(window);
