/* CL-WIND - export.js
 * Image PNG de 1800 px et plan DXF R12 en millimètres (isovitesses par marching squares).
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var EXP = CLW.Export = {};

  function download(blob, name) {
    var url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }
  function status(t, cls) { var el = document.getElementById('exp-status'); if (el) { el.textContent = t; el.className = 'status' + (cls ? ' ' + cls : ''); } }

  // ------------------------------------------------------------------ PNG
  EXP.renderPNG = function () {
    var S = CLW.state, E = CLW.engine, fmt = CLW.fmt;
    var W = 1800, pad = 40, mapW = W - 2 * pad;
    var g = E.grid, dw = S.domain.W, dh = S.domain.H;
    var sc = mapW / dw, mapH = Math.round(dh * sc);
    var head = 90, foot = 250, H = head + mapH + foot;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#111'; ctx.font = 'bold 30px Segoe UI, system-ui, sans-serif'; ctx.textBaseline = 'top';
    ctx.fillText('Analyse du vent · vent simplifié pour l\'esquisse', pad, 22);
    ctx.font = '18px Segoe UI, system-ui, sans-serif'; ctx.fillStyle = '#444';
    var sub = (S.site ? S.site.label : 'Plan sans localisation') + ' · domaine ' + fmt(dw, 0) + ' × ' + fmt(dh, 0) + ' m · ' + new Date().toLocaleDateString('fr-FR');
    ctx.fillText(sub.length > 160 ? sub.slice(0, 157) + '…' : sub, pad, 60);
    // carte
    var ox = pad, oy = head;
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, mapW, mapH); ctx.clip();
    ctx.fillStyle = '#ddd'; ctx.fillRect(ox, oy, mapW, mapH);
    if (g && E.samples) {
      var gx = ox + (dw / 2 - g.W / 2) * sc, gy = oy + (dh / 2 - g.H / 2) * sc;
      CLW.renderFieldTo(ctx, gx, gy, g.W * sc, g.H * sc);
    }
    // objets : x = ox + (x + dw/2) sc, y = oy + (dh/2 - y) sc
    ctx.setTransform(sc, 0, 0, -sc, ox + dw / 2 * sc, oy + dh / 2 * sc);
    S.objects.forEach(function (o) {
      var p = new Path2D(), k;
      if (o.type === 'building') {
        [o.outer].concat(o.holes || []).forEach(function (r) { for (k = 0; k < r.length; k++) { if (k) p.lineTo(r[k][0], r[k][1]); else p.moveTo(r[k][0], r[k][1]); } p.closePath(); });
        ctx.fillStyle = 'rgba(55,60,70,0.95)'; ctx.fill(p, 'evenodd'); ctx.strokeStyle = '#111'; ctx.lineWidth = 1 / sc; ctx.stroke(p);
      } else if (o.type === 'wall') {
        for (k = 0; k < o.pts.length; k++) { if (k) p.lineTo(o.pts[k][0], o.pts[k][1]); else p.moveTo(o.pts[k][0], o.pts[k][1]); }
        ctx.strokeStyle = '#111'; ctx.lineWidth = Math.max(o.thick || 0.3, 2 / sc); ctx.stroke(p);
      } else if (o.type === 'tree') {
        p.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(10,80,20,0.9)'; ctx.lineWidth = 1.5 / sc; ctx.stroke(p);
      }
    });
    ctx.restore();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 1; ctx.strokeRect(ox + 0.5, oy + 0.5, mapW - 1, mapH - 1);
    // flèche de vent, nord, échelle sur la carte
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(ox + 10, oy + 10, 190, 150);
    CLW.drawWindArrow(ctx, ox + 105, oy + 65, 38, S.wind.dir, '#111');
    ctx.fillStyle = '#111'; ctx.font = '16px Segoe UI, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText('Vent ' + fmt(S.wind.speed, 1) + ' m/s', ox + 105, oy + 130);
    ctx.fillText(CLW.deLe(CLW.dirName(S.wind.dir)) + ' (' + Math.round(S.wind.dir) + '°)', ox + 105, oy + 150);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(ox + mapW - 70, oy + 10, 60, 80);
    CLW.drawNorth(ctx, ox + mapW - 40, oy + 55, 24, '#111');
    var len = (function (m) { var p = Math.pow(10, Math.floor(Math.log10(m))), n = m / p; return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p; })(250 / sc);
    ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(ox + mapW - len * sc - 30, oy + mapH - 50, len * sc + 20, 40);
    ctx.font = '16px Segoe UI, system-ui, sans-serif';
    CLW.drawScaleBar(ctx, ox + mapW - 20, oy + mapH - 18, sc, '#111', 250);
    ctx.restore();
    // pied : légende et avertissements
    var fy = oy + mapH + 18;
    var lg = document.createElement('canvas'); lg.width = 760; lg.height = 90;
    CLW.drawLegend(lg.getContext('2d'), 760, 90, { fg: '#111', font: 16 });
    ctx.drawImage(lg, pad, fy);
    ctx.fillStyle = '#111'; ctx.font = '16px Segoe UI, system-ui, sans-serif'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    var tx = pad + 800, lines = [];
    if (!E.samples) lines.push(['#b00', 'Calcul pas encore commencé : aucun champ de vent sur cette image.']);
    else if (!E.stable) lines.push(['#b00', 'Moyenne non stabilisée (' + fmt(E.trav || 0, 1) + ' / 6 traversées) : résultat provisoire.']);
    else lines.push(['#060', 'Moyenne stabilisée (' + fmt(E.trav, 1) + ' traversées).']);
    lines.push(['#111', 'Simulation 2D très simplifiée à hauteur de piéton : vent moyen sans rafales,']);
    lines.push(['#111', 'bâtiments pleins sans effet de leur hauteur. Ni étude CFD ni soufflerie.']);
    lines.push(['#111', 'Sillages probablement trop longs, vitesses surestimées en tissu dense.']);
    lines.push(['#111', 'Lire au centre du domaine et comparer des variantes plutôt que des valeurs.']);
    if (g) lines.push(['#555', 'Grille ' + g.nx + ' × ' + g.ny + ', cellule ' + fmt(g.dx, 2) + ' m, ' + (E.kind === 'gpu' ? 'WebGPU' : 'processeur') + '.']);
    lines.forEach(function (l, i) { ctx.fillStyle = l[0]; ctx.fillText(l[1], tx, fy + i * 24); });
    var osm = S.objects.some(function (o) { return o.src === 'osm'; });
    ctx.fillStyle = '#333'; ctx.font = '15px Segoe UI, system-ui, sans-serif';
    ctx.fillText((osm ? '© contributeurs OpenStreetMap, ODbL · ' : '') + 'Analyse du vent', pad, H - 34);
    return c;
  };
  EXP.png = function () {
    var c = EXP.renderPNG();
    status('Préparation de l\'image…');
    c.toBlob(function (b) {
      download(b, 'cl-wind-' + stamp() + '.png');
      status(CLW.engine.stable ? 'Image enregistrée.' : 'Image enregistrée, mais la moyenne n\'est pas encore stabilisée.', CLW.engine.stable ? 'ok' : 'err');
    }, 'image/png');
  };

  // ------------------------------------------------------------------ planche A3 (paysage, 150 dpi)
  EXP.a3 = function () {
    var S = CLW.state, E = CLW.engine, fmt = CLW.fmt;
    var W = 2480, H = 1754, m = 60, c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    var F = 'Segoe UI, system-ui, sans-serif';
    function txt(s, px, py, size, col, bold) { x.font = (bold ? 'bold ' : '') + size + 'px ' + F; x.fillStyle = col || '#111'; x.textBaseline = 'top'; x.fillText(s, px, py); }
    // cartouche
    var title = (document.getElementById('exp-title') || {}).value || 'Analyse du vent';
    txt(title, m, 40, 44, '#111', true);
    var mode = S.mode3d && E.vox ? 'Calcul 3D, coupe horizontale à ' + fmt((E.kslice - 0.5) * E.vox.dx, 2) + ' m, cellule ' + fmt(E.vox.dx * 100, 1) + ' cm'
      : 'Plan 2D, cellule ' + (E.grid ? fmt(E.grid.dx * 100, 1) + ' cm' : '?');
    txt('Vent ' + fmt(S.wind.speed, 1) + ' m/s ' + CLW.deLe(CLW.dirName(S.wind.dir)) + ' (' + Math.round(S.wind.dir) + '°) · ' + mode + ' · ' + new Date().toLocaleDateString('fr-FR') +
      (CLW.EPW && CLW.EPW.station ? ' · météo : ' + CLW.EPW.station + ' (' + CLW.EPW.name + ')' : ''), m, 98, 24, '#444');
    var st = !E.samples ? ['Calcul pas commencé', '#b00'] : E.stable ? ['Moyenne stabilisée', '#060'] : ['Résultat provisoire (' + fmt(E.trav || 0, 1) + ' / 6 traversées)', '#b00'];
    x.font = 'bold 24px ' + F; var sw = x.measureText(st[0]).width;
    txt(st[0], W - m - sw, 50, 24, st[1], true);
    x.fillStyle = '#111'; x.fillRect(m, 140, W - 2 * m, 3);
    // carte : rendu PNG recadré sur la carte
    var png = EXP.renderPNG(), pmapW = 1800 - 80, pmapH = png.height - 90 - 250;
    var mx = m, my = 170, mw = 1450, mh = H - my - 300, s = Math.min(mw / pmapW, mh / pmapH);
    x.drawImage(png, 40, 90, pmapW, pmapH, mx, my, pmapW * s, pmapH * s);
    var lg = document.createElement('canvas'); lg.width = 900; lg.height = 100;
    CLW.drawLegend(lg.getContext('2d'), 900, 100, { fg: '#111', font: 18 });
    x.drawImage(lg, mx, my + pmapH * s + 20);
    // colonne de droite
    var rx = mx + mw + 50, rw = W - m - rx, ry = my;
    function head(t) { txt(t, rx, ry, 26, '#111', true); ry += 36; }
    function img(cv, maxH, bg) {
      if (!cv || !cv.width) return;
      var k = Math.min(rw / cv.width, maxH / cv.height), w = cv.width * k, h = cv.height * k;
      if (bg) { x.fillStyle = bg; x.fillRect(rx, ry, w, h); }
      x.imageSmoothingEnabled = true; x.drawImage(cv, rx, ry, w, h); ry += h + 18;
    }
    var vc = document.getElementById('vcut');
    if (vc && !vc.parentNode.hidden && vc.width > 1) { head(S.mode3d ? 'Coupe verticale A → B' : 'Vitesse le long du trait A → B'); img(vc, 300, '#0b0d11'); }
    var r = E.bilan && E.bilan.res;
    if (r) {
      head('Bilan intérieur / extérieur');
      var b = [
        'Vitesse moyenne intérieure : ' + fmt(r.uMean, 2) + ' m/s (' + fmt(100 * r.uMean / r.U, 0) + ' % du vent libre), maximum ' + fmt(r.uMax, 2) + ' m/s',
        'Confort intérieur : ' + CLW.COMFORT.map(function (cc, k) { return r.cls[k] >= 0.005 ? cc.label + ' ' + fmt(100 * r.cls[k], 0) + ' %' : ''; }).filter(Boolean).join(', '),
        'Air entrant : ' + fmt(r.qin, 2) + ' m³/s par m de hauteur, par les briques ' + fmt(r.qin > 0 ? 100 * (r.qin - r.qOpen) / r.qin : 0, 0) + ' %',
        'Taux de pénétration : ' + fmt(100 * r.pen, 0) + ' % (100 % = mur transparent)'];
      var R = CLW.Variants && CLW.Variants.ref;
      if (R && R.bilan) b.push('Écart à « ' + R.name + ' » : vitesse intérieure ' + (r.uMean / r.U - R.bilan.uMean / R.bilan.U >= 0 ? '+' : '−') +
        fmt(Math.abs(100 * (r.uMean / r.U - R.bilan.uMean / R.bilan.U)), 0) + ' points, pénétration ' + (r.pen - R.bilan.pen >= 0 ? '+' : '−') + fmt(Math.abs(100 * (r.pen - R.bilan.pen)), 0) + ' points');
      if (S.mode3d && E.vox && (E.kslice - 0.5) * E.vox.dx > E.vox.hmax) b.unshift('! Coupe au-dessus de l\'ouvrage (' + fmt(E.vox.hmax, 2) + ' m) : ce bilan ne décrit pas l\'intérieur.');
      b.forEach(function (l) { txt(l, rx, ry, 19, l.charAt(0) === '!' ? '#b00' : '#222'); ry += 27; });
      ry += 8;
      var top = ry;
      var rose = document.getElementById('bilan-rose'), prof = document.getElementById('prof-canvas');
      if (rose && rose.style.display !== 'none') { var k2 = 230 / rose.height; x.fillStyle = '#20252f'; x.fillRect(rx, ry, rose.width * k2, 230); x.drawImage(rose, rx, ry, rose.width * k2, 230); }
      if (prof && S.mode3d && E.profile && E.profile.length) { x.fillStyle = '#191d25'; x.fillRect(rx + 260, top, rw - 260, 230); x.drawImage(prof, rx + 260, top, rw - 260, 230); txt('Profil : bleu vitesse intérieure, orange pénétration', rx + 260, top + 236, 16, '#444'); }
      ry = top + 270;
    }
    var VL = CLW.Variants && CLW.Variants.list;
    if (VL && VL.length) {
      head('Variantes comparées');
      VL.slice(0, 6).forEach(function (it) {
        var bb = it.bilan;
        txt((CLW.Variants.ref === it ? '● ' : '○ ') + it.name + ' : ' + (it.mode3d ? '3D' : '2D') + ', vent ' + fmt(it.wind.speed, 1) + ' m/s ' + Math.round(it.wind.dir) + '°' +
          (bb ? ', intérieur ' + fmt(100 * bb.uMean / bb.U, 0) + ' %, pénétration ' + fmt(100 * bb.pen, 0) + ' %' : '') + (it.stable ? '' : ' (provisoire)'), rx, ry, 18, '#222');
        ry += 26;
      });
    }
    // limites du modèle
    var ly = H - 250;
    x.fillStyle = '#eee'; x.fillRect(rx - 10, ly - 10, rw + 20, 190);
    ['Limites du modèle', 'Simulation simplifiée du vent moyen (Lattice-Boltzmann), sans rafales. Ni étude CFD ni soufflerie.',
      S.mode3d ? '3D : sol glissant, turbulence d\'entrée 20 % (réglage), rappel vers le profil sur 120 m.' : '2D : écoulement en plan à une hauteur, sans passage au-dessus des toits.',
      'Briques et lames plus fines que la grille : bande poreuse dont la perte de charge suit la surface ouverte.',
      'Valeurs indicatives : comparer des variantes plutôt que lire des valeurs absolues.']
      .forEach(function (l, i) { txt(l, rx, ly + i * 32, i ? 18 : 22, i ? '#333' : '#111', !i); });
    txt('Analyse du vent' + (S.objects.some(function (o) { return o.src === 'osm'; }) ? ' · © contributeurs OpenStreetMap, ODbL' : ''), m, H - 40, 18, '#555');
    return c;
  };
  EXP.a3png = function () {
    status('Préparation de la planche…');
    setTimeout(function () {
      var c = EXP.a3();
      c.toBlob(function (b) {
        download(b, 'analyse-vent-A3-' + stamp() + '.png');
        status(CLW.engine.stable ? 'Planche A3 enregistrée.' : 'Planche enregistrée, mais la moyenne n\'est pas encore stabilisée.', CLW.engine.stable ? 'ok' : 'err');
      }, 'image/png');
    }, 30);
  };

  // ------------------------------------------------------------------ planche A3 soleil et chaleur
  EXP.a3sun = function () {
    var S = CLW.state, SU = CLW.Sun, TH = CLW.Thermal, fmt = CLW.fmt;
    if (S.viewMode !== 'soleil') CLW.setView('soleil');
    SU.dirty(); SU.frame();
    var W = 2480, H = 1754, m = 60, c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'), F = 'Segoe UI, system-ui, sans-serif';
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    function txt(s2, px, py, size, col, bold) { x.font = (bold ? 'bold ' : '') + size + 'px ' + F; x.fillStyle = col || '#111'; x.textBaseline = 'top'; x.fillText(s2, px, py); }
    var st = SU.state, p = SU.current(), di = SU.dayInfo(SU.n());
    var title = (document.getElementById('exp-title') || {}).value || 'Soleil et chaleur';
    txt(title, m, 40, 44, '#111', true);
    txt(SU.dateTxt(st.m, st.d) + ', ' + SU.hhmm(st.t) + ' (heure d\'hiver UTC + 1) · soleil ' + (p.alt > 0 ? 'à ' + fmt(p.alt, 1) + '° de hauteur, azimut ' + fmt(p.az, 0) + '°' : 'sous l\'horizon') +
      ' · lever ' + (di.rise != null ? SU.hhmm(di.rise) : '–') + ', coucher ' + (di.set != null ? SU.hhmm(di.set) : '–') +
      (CLW.EPW && CLW.EPW.station ? ' · météo : ' + CLW.EPW.station : ''), m, 98, 24, '#444');
    x.fillStyle = '#111'; x.fillRect(m, 140, W - 2 * m, 3);
    // vue 3D (modèle et étiquettes) puis coupe solaire, à gauche
    var a = SU.canvas3d(), lb = SU.labels(), cu = SU.canvasCut(), lw = 1450, y = 170;
    if (a && a.width > 1) {
      var k = Math.min(lw / a.width, 820 / a.height), w = a.width * k, h = a.height * k;
      x.drawImage(a, m, y, w, h); if (lb) x.drawImage(lb, m, y, w, h); y += h + 20;
    }
    if (cu && cu.width > 1) { var k2 = Math.min(lw / cu.width, (H - y - 80) / cu.height); x.drawImage(cu, m, y, cu.width * k2, cu.height * k2); }
    // colonne de droite : courbes, synthèse, réglages
    var rx = m + lw + 50, rw = W - m - rx, ry = 170;
    function head(t) { txt(t, rx, ry, 26, '#111', true); ry += 38; }
    function wrap(l, size, col) { // texte coupé à la largeur de la colonne
      x.font = size + 'px ' + F; var words = l.split(' '), line = '';
      words.forEach(function (w2) { var t2 = line ? line + ' ' + w2 : w2; if (x.measureText(t2).width > rw && line) { txt(line, rx, ry, size, col); ry += size * 1.4; line = w2; } else line = t2; });
      if (line) { txt(line, rx, ry, size, col); ry += size * 1.45; }
    }
    head('Températures sur 24 h, ' + SU.dateTxt(st.m, st.d));
    var cc = document.createElement('canvas'); cc.width = rw; cc.height = Math.round(rw * 0.72);
    TH.drawCurves(cc, { W: rw, H: cc.height, dpr: 2, bg: '#ffffff', fg: '#111', muted: '#555' });
    x.drawImage(cc, rx, ry); ry += cc.height + 20;
    var s2 = TH.summary(), r = TH.result(), O = TH.opts;
    if (s2 && r) {
      head('Synthèse');
      var a2 = TH.at(st.t);
      [
        'À ' + SU.hhmm(st.t) + ' : air ' + fmt(a2.Ta, 1) + ' °C dehors, ' + fmt(a2.Ti, 1) + ' °C dedans ; ressenti ' + fmt(a2.Tos, 1) + ' °C au soleil dehors, ' + fmt(a2.Top, 1) + ' °C à l\'ombre dedans',
        'Air au plus chaud : ' + fmt(s2.TaMax, 1) + ' °C dehors, ' + fmt(s2.TiMax, 1) + ' °C dedans ; nuit : ' + fmt(s2.TaMin, 1) + ' et ' + fmt(s2.TiMin, 1) + ' °C',
        'Ressenti au plus chaud : ' + fmt(s2.TosMax, 1) + ' °C dehors au soleil, ' + fmt(s2.TopMax, 1) + ' °C dedans à l\'ombre',
        'Heures au-dessus de 26 °C (ressenti) : ' + fmt(s2.hot[0], 1) + ' h dehors, ' + fmt(s2.hot[1], 1) + ' h dedans',
        'Brique : face la plus chaude ' + fmt(s2.faceMax, 1) + ' °C (' + s2.faceMaxName + ') ; moyenne ' + fmt(s2.TboMax, 1) + ' °C dehors, ' + fmt(s2.TbiMax, 1) + ' °C dedans' + (O.drip || O.mist ? '' : ', déphasage ' + fmt(s2.lag, 1) + ' h'),
        'Humidité dedans : ' + fmt(s2.RHiMax, 0) + ' % au plus' + (s2.cond > 0 ? ', condensation possible ' + fmt(s2.cond, 1) + ' h' : ', pas de condensation'),
        'Chaleur stockée dans la paroi : ' + fmt(s2.store, 1) + ' kWh (' + fmt(s2.storeM2, 0) + ' Wh/m²), rendue la nuit : ' + fmt(s2.nightIn, 1) + ' kWh dedans, ' + fmt(s2.nightOut, 1) + ' kWh dehors',
        'Renouvellement d\'air : ' + fmt(s2.ach, 0) + ' vol/h (' + r.vent.src + ')',
        'Sol intérieur au soleil : ' + fmt(100 * s2.sunMax, 0) + ' % au plus (taches calculées sur la géométrie)'
      ].concat(TH.feel && TH.feel.stats && isFinite(TH.feel.stats.inn) ? ['Ressenti en plan : ' + fmt(TH.feel.stats.inn, 1) + ' °C dedans, ' + fmt(TH.feel.stats.sun, 1) + ' °C dehors au soleil' + (TH.feel.stats.shade != null ? ', ' + fmt(TH.feel.stats.shade, 1) + ' °C à l\'ombre du refuge' : '')] : []).concat(O.drip ? ['Goutte-à-goutte de ' + O.dripA + ' h à ' + O.dripB + ' h : ' + fmt(s2.evap, 0) + ' L d\'eau évaporée par jour'] : [])
        .concat(O.mist ? ['Brumisation (efficacité ' + fmt(100 * O.mistEff, 0) + ' %, buses ' + fmt(O.mistMax, 0) + ' L/h) de ' + O.mistA + ' h à ' + O.mistB + ' h : ' + fmt(s2.mist, 0) + ' L par jour'] : [])
        .forEach(function (l) { wrap(l, 17, '#222'); });
      var G = r.geo;
      ry += 6;
      wrap('Paroi : ' + r.mat.name + ', ' + fmt(O.ep * 100, 0) + ' cm, surface ouverte ' + fmt(100 * r.phi, 0) + ' %, ' + fmt(G.Awall, 1) + ' m² ; intérieur ' + fmt(G.area, 1) + ' m², hauteur ' + fmt(G.Hw, 2) + ' m' + (G.roof ? ', toit : ' + fmt(100 * G.open, 0) + ' % de ciel ouvert' : ', sans toit'), 17, '#333');
    }
    var ly = H - 175, SR = TH.seasonState && TH.seasonState.res;
    if (SR && ry < ly - 150) {
      ry += 8; head('Été, juin à septembre');
      var hS = Math.min(150, ly - ry - 70), cs = document.createElement('canvas'); cs.width = rw; cs.height = hS;
      TH.drawSeason(cs, { W: rw, H: hS, dpr: 1.6, bg: '#ffffff', fg: '#111', muted: '#555' });
      x.drawImage(cs, rx, ry); ry += hS + 6;
      var T2 = SR.tot;
      wrap('Ressenti > 26 °C : ' + fmt(T2.hot[0], 0) + ' h dehors au soleil, ' + fmt(T2.hot[1], 0) + ' h dedans ; > 32 °C : ' + fmt(T2.hot32[0], 0) + ' h et ' + fmt(T2.hot32[1], 0) + ' h' +
        (SR.useWater ? '. Eau : ' + fmt(T2.use / 1000, 1) + ' m³ consommés, ' + fmt(T2.rain / 1000, 1) + ' m³ de pluie, réservoir ' + fmt(SR.cap / 1000, 1) + ' m³ (' + (T2.emptyDays ? T2.emptyDays + ' jours vide' : 'jamais vide') + '), ' + fmt(SR.need / 1000, 1) + ' m³ pour ne jamais manquer' : ''), 16, '#222');
    }
    x.fillStyle = '#eee'; x.fillRect(rx - 10, ly - 10, rw + 20, 150);
    ['Limites du modèle', 'Soleil : position exacte, ombres sur la géométrie. Rayons de la coupe : schéma.',
      'Paroi en 8 orientations à deux nœuds, air bien mélangé, sol avec inertie, vent EPW de l\'heure.',
      'Ressenti : température apparente de Steadman (air, humidité, vent, rayonnement). Sans stratification.',
      'Valeurs indicatives : comparer des variantes plutôt que lire des degrés absolus.']
      .forEach(function (l, i) { txt(l, rx, ly + i * 27, i ? 15 : 20, i ? '#333' : '#111', !i); });
    txt('Analyse du vent · soleil et chaleur', m, H - 40, 18, '#555');
    return c;
  };
  EXP.a3sunpng = function () {
    status('Préparation de la planche soleil et chaleur…');
    setTimeout(function () {
      var c = EXP.a3sun();
      c.toBlob(function (b) { download(b, 'soleil-chaleur-A3-' + stamp() + '.png'); status('Planche soleil et chaleur enregistrée.', 'ok'); }, 'image/png');
    }, 30);
  };

  // ------------------------------------------------------------------ planche d'analyse complète (A2 paysage, 150 dpi)
  // quatre cartes recadrées sur l'ouvrage (vitesse, température de l'air, ressenti, UTCI), soleil, courbes 24 h,
  // confort UTCI été / hiver, bilan du vent, synthèse thermique, été, limites du modèle
  var FNT = 'Segoe UI, system-ui, sans-serif';
  // carte d'un mode d'affichage, carré de Z m centré sur l'ouvrage, size px ; renvoie la carte et sa légende
  function mapCrop(mode, size, Z) {
    var S = CLW.state, E = CLW.engine, g = E.grid, TH = CLW.Thermal, G = TH && TH.geometry();
    var c = document.createElement('canvas'); c.width = c.height = size; var x = c.getContext('2d');
    x.fillStyle = '#d8dbe0'; x.fillRect(0, 0, size, size);
    var lg = document.createElement('canvas'); lg.width = size; lg.height = 112;
    if (!g || !E.samples || !G) { x.fillStyle = '#b00'; x.font = '24px ' + FNT; x.textBaseline = 'top'; x.fillText('Pas encore de champ de vent', 20, 20); return { map: c, legend: lg }; }
    var prev = S.display; S.display = mode; E.fieldDirty = true;
    var fc = CLW.getFieldCanvas(), X0 = G.cx - Z / 2, Yt = G.cy + Z / 2, sc = size / Z;
    x.imageSmoothingEnabled = mode === 'speed' || mode === 'ratio';
    x.drawImage(fc, (X0 - g.x0) / g.dx, (g.y0 - Yt) / g.dx, Z / g.dx, Z / g.dx, 0, 0, size, size);
    // contours des objets (les briques gardent la couleur de la carte)
    x.save(); x.setTransform(sc, 0, 0, -sc, -X0 * sc, Yt * sc);
    S.objects.forEach(function (o) {
      var p = new Path2D(), k;
      if (o.type === 'building') {
        [o.outer].concat(o.holes || []).forEach(function (r) { for (k = 0; k < r.length; k++) { if (k) p.lineTo(r[k][0], r[k][1]); else p.moveTo(r[k][0], r[k][1]); } p.closePath(); });
        if (!o.screen) { x.fillStyle = 'rgba(55,60,70,0.95)'; x.fill(p, 'evenodd'); }
        x.strokeStyle = 'rgba(20,20,20,0.75)'; x.lineWidth = 0.8 / sc; x.stroke(p);
      } else if (o.type === 'wall') {
        for (k = 0; k < o.pts.length; k++) { if (k) p.lineTo(o.pts[k][0], o.pts[k][1]); else p.moveTo(o.pts[k][0], o.pts[k][1]); }
        x.strokeStyle = '#111'; x.lineWidth = Math.max(o.thick || 0.3, 2 / sc); x.stroke(p);
      }
    });
    x.restore();
    x.strokeStyle = '#333'; x.lineWidth = 2; x.strokeRect(1, 1, size - 2, size - 2);
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(size - 62, 8, 54, 74); CLW.drawNorth(x, size - 35, 48, 20, '#111');
    x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(size - 190, size - 46, 182, 38);
    x.font = '16px ' + FNT; CLW.drawScaleBar(x, size - 18, size - 16, sc, '#111', 150);
    CLW.drawLegend(lg.getContext('2d'), size, 112, { fg: '#111', font: 18 });
    S.display = prev; E.fieldDirty = true;
    return { map: c, legend: lg };
  }
  EXP.full = function () {
    var S = CLW.state, E = CLW.engine, fmt = CLW.fmt, SU = CLW.Sun, TH = CLW.Thermal, O = TH.opts, U = CLW.UTCI;
    var W = 3508, H = 2480, m = 60, c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    function txt(s, px, py, size, col, bold) { x.font = (bold ? 'bold ' : '') + size + 'px ' + FNT; x.fillStyle = col || '#111'; x.textBaseline = 'top'; x.fillText(s, px, py); }
    var st = SU.state, p = SU.current(), G = TH.geometry();
    // cartouche
    var title = (document.getElementById('exp-title') || {}).value || 'Refuge climatique urbain · analyse complète';
    txt(title, m, 36, 50, '#111', true);
    var mode = S.mode3d && E.vox ? 'calcul 3D, coupe à ' + fmt((E.kslice - 0.5) * E.vox.dx, 2) + ' m' : 'plan 2D, coupe à ' + fmt(S.cut || 1.5, 1) + ' m' + (E.grid ? ', cellule ' + fmt(E.grid.dx * 100, 1) + ' cm' : '');
    txt(SU.dateTxt(st.m, st.d) + ', ' + SU.hhmm(st.t) + ' · vent ' + fmt(S.wind.speed, 1) + ' m/s ' + CLW.deLe(CLW.dirName(S.wind.dir)) + ' (' + Math.round(S.wind.dir) + '°) · ' + mode +
      (CLW.EPW && CLW.EPW.station ? ' · météo : ' + CLW.EPW.station : '') + ' · ' + new Date().toLocaleDateString('fr-FR'), m, 100, 26, '#444');
    var stt = !E.samples ? ['Calcul du vent pas commencé', '#b00'] : E.stable ? ['Moyenne du vent stabilisée', '#060'] : ['Vent provisoire (' + fmt(E.trav || 0, 1) + ' / 6 traversées)', '#b00'];
    x.font = 'bold 26px ' + FNT; txt(stt[0], W - m - x.measureText(stt[0]).width, 48, 26, stt[1], true);
    x.fillStyle = '#111'; x.fillRect(m, 146, W - 2 * m, 3);
    // 1. quatre cartes
    var Z = Math.max(O.mapZone > 0 ? O.mapZone : 10, G ? 2.6 * G.R : 10), gap = 40, ms = Math.floor((W - 2 * m - 3 * gap) / 4), my = 210;
    [['speed', 'Vitesse du vent'], ['temp', 'Température de l\'air'], ['feel', 'Ressenti (température apparente)'], ['utci', 'Confort UTCI']].forEach(function (it, i) {
      var mx = m + i * (ms + gap), r = mapCrop(it[0], ms, Z);
      txt((i + 1) + '. ' + it[1], mx, my - 46, 28, '#111', true);
      x.drawImage(r.map, mx, my); x.drawImage(r.legend, mx, my + ms + 10);
    });
    txt('Cartes : carré de ' + fmt(Z, 0) + ' m centré sur l\'ouvrage, à ' + SU.hhmm(st.t) + ' le ' + SU.dateTxt(st.m, st.d) + '. Vent ' + fmt(S.wind.speed, 1) + ' m/s ' + CLW.deLe(CLW.dirName(S.wind.dir)) + '.', m, my + ms + 128, 20, '#555');
    // 2. rangée du bas : soleil (gauche), courbes et UTCI (milieu), textes (droite)
    var y2 = my + ms + 190, colW = Math.floor((W - 2 * m - 2 * gap) / 3), xA = m, xB = m + colW + gap, xC = m + 2 * (colW + gap), yEnd = H - 90;
    function head(t, px, py) { txt(t, px, py, 28, '#111', true); return py + 42; }
    // A. soleil : vue 3D et coupe solaire
    var prevView = S.viewMode, ya = head('5. Soleil, ombres et coupe solaire', xA, y2);
    try {
      if (S.viewMode !== 'soleil') CLW.setView('soleil');
      SU.dirty(); SU.frame();
      var a3 = SU.canvas3d(), lb = SU.labels(), cu = SU.canvasCut();
      if (a3 && a3.width > 1) { var k1 = Math.min(colW / a3.width, 640 / a3.height); x.drawImage(a3, xA, ya, a3.width * k1, a3.height * k1); if (lb) x.drawImage(lb, xA, ya, a3.width * k1, a3.height * k1); ya += a3.height * k1 + 16; }
      if (cu && cu.width > 1) { var k2 = Math.min(colW / cu.width, (yEnd - ya) / cu.height); x.drawImage(cu, xA, ya, cu.width * k2, cu.height * k2); }
    } catch (e) { console.error(e); }
    finally { if (prevView && prevView !== S.viewMode) CLW.setView(prevView); }
    // B. courbes 24 h puis UTCI été / hiver
    var yb = head('6. Températures sur 24 h, ' + SU.dateTxt(st.m, st.d), xB, y2);
    var cc = document.createElement('canvas'); cc.width = colW; cc.height = Math.round(colW * 0.6);
    try { TH.drawCurves(cc, { W: colW, H: cc.height, dpr: 2, bg: '#ffffff', fg: '#111', muted: '#555' }); } catch (e) { console.error(e); }
    x.drawImage(cc, xB, yb); yb += cc.height + 30;
    yb = head('7. Confort UTCI, été et hiver (heures par classe)', xB, yb);
    var UR = TH.utciState && TH.utciState.res;
    if (UR && U) {
      var bx0 = xB + 230, bw = colW - 240, bh = 34;
      UR.periods.forEach(function (pp) {
        txt(pp.name, xB, yb, 22, '#111', true); yb += 32;
        [['Dehors au soleil', pp.out, pp.meanOut], ['Dedans', pp.inn, pp.meanIn]].forEach(function (row) {
          txt(row[0], xB, yb + 6, 20, '#333');
          var tot = row[1].reduce(function (a2, b2) { return a2 + b2; }, 0) || 1, bxx = bx0;
          row[1].forEach(function (hrs, kk) { var ww = bw * hrs / tot; if (ww > 0) { x.fillStyle = U.CLASSES[kk].col; x.fillRect(bxx, yb, ww, bh); bxx += ww; } });
          txt('moy. ' + fmt(row[2], 1) + ' °C', bx0 + 8, yb + 6, 18, '#111'); yb += bh + 10;
        });
        yb += 8;
      });
      var lx = xB; [3, 4, 5, 6, 7, 8, 9].forEach(function (kk) { var nm = U.CLASSES[kk].name; x.font = '17px ' + FNT; var tw = x.measureText(nm).width + 34; if (lx + tw > xB + colW) { lx = xB; yb += 26; } x.fillStyle = U.CLASSES[kk].col; x.fillRect(lx, yb + 2, 18, 18); txt(nm, lx + 24, yb, 17, '#333'); lx += tw; });
      yb += 34;
      UR.periods.forEach(function (pp) {
        var hot = function (a3b) { var s3 = 0; for (var q = 6; q <= 9; q++) s3 += a3b[q]; return s3; };
        txt(pp.name.split(' ')[0] + ' : sans stress ' + fmt(pp.out[5], 0) + ' h dehors → ' + fmt(pp.inn[5], 0) + ' h dedans ; chaleur (> 26 °C) ' + fmt(hot(pp.out), 0) + ' h → ' + fmt(hot(pp.inn), 0) + ' h', xB, yb, 18, '#222'); yb += 26;
      });
    } else { txt('Non calculé : onglet Soleil, « Confort UTCI », boutons 1 puis 2.', xB, yb, 20, '#b00'); yb += 30; }
    // C. textes : bilan du vent, synthèse thermique, été, limites
    var yc = y2, rw = colW;
    function wrap(l, size, col) {
      x.font = size + 'px ' + FNT; var words = l.split(' '), line = '';
      words.forEach(function (w2) { var t2 = line ? line + ' ' + w2 : w2; if (x.measureText(t2).width > rw && line) { txt(line, xC, yc, size, col); yc += size * 1.38; line = w2; } else line = t2; });
      if (line) { txt(line, xC, yc, size, col); yc += size * 1.42; }
    }
    yc = head('8. Vent : intérieur / extérieur', xC, yc);
    var r = E.bilan && E.bilan.res;
    if (r) {
      wrap('Vitesse moyenne intérieure ' + fmt(r.uMean, 2) + ' m/s, soit ' + fmt(100 * r.uMean / r.U, 0) + ' % du vent libre (maximum ' + fmt(r.uMax, 2) + ' m/s).', 19, '#222');
      wrap('Confort au vent : ' + CLW.COMFORT.map(function (cc2, k) { return r.cls[k] >= 0.005 ? cc2.label + ' ' + fmt(100 * r.cls[k], 0) + ' %' : ''; }).filter(Boolean).join(', ') + '.', 19, '#222');
      wrap('Air entrant ' + fmt(r.qin, 2) + ' m³/s par m de hauteur, dont ' + fmt(r.qin > 0 ? 100 * (r.qin - r.qOpen) / r.qin : 0, 0) + ' % par les briques ; pénétration ' + fmt(100 * r.pen, 0) + ' %.', 19, '#222');
      var rose = document.getElementById('bilan-rose');
      if (rose && rose.style.display !== 'none' && rose.width > 1) { var kr = 200 / rose.height; x.fillStyle = '#20252f'; x.fillRect(xC, yc + 4, rose.width * kr, 200); x.drawImage(rose, xC, yc + 4, rose.width * kr, 200); txt('Rose : air entrant (vert) et sortant (orange) par secteur', xC + rose.width * kr + 16, yc + 90, 17, '#555'); yc += 216; }
    } else wrap('Bilan pas encore disponible (calcul du vent en cours).', 19, '#b00');
    yc += 10; yc = head('9. Chaleur et confort à ' + SU.hhmm(st.t), xC, yc);
    var s2 = TH.summary(), a2 = TH.at(st.t);
    if (s2 && a2) {
      wrap('Air ' + fmt(a2.Ta, 1) + ' °C dehors, ' + fmt(a2.Ti, 1) + ' °C dedans ; humidité ' + fmt(a2.RH, 0) + ' → ' + fmt(a2.RHi, 0) + ' %. Soleil ' + (p.alt > 0 ? 'à ' + fmt(p.alt, 0) + '°' : 'couché') + '.', 19, '#222');
      wrap('Ressenti : ' + fmt(a2.Tos, 1) + ' °C dehors au soleil, ' + fmt(a2.Top, 1) + ' °C dedans à l\'ombre ; au plus chaud ' + fmt(s2.TosMax, 1) + ' → ' + fmt(s2.TopMax, 1) + ' °C.', 19, '#222');
      var us = TH.feel && TH.feel.ustats;
      if (us && U) wrap('UTCI en plan : ' + fmt(us.inn, 1) + ' °C dedans (' + U.CLASSES[U.classOf(us.inn)].name + '), ' + fmt(us.sun, 1) + ' °C dehors au soleil' + (us.shade != null ? ', ' + fmt(us.shade, 1) + ' °C à l\'ombre du refuge' : '') + '.', 19, '#222');
      wrap('Brique : face la plus chaude ' + fmt(s2.faceMax, 1) + ' °C (' + s2.faceMaxName + '), moyenne ' + fmt(s2.TboMax, 1) + ' °C dehors, ' + fmt(s2.TbiMax, 1) + ' °C dedans.', 19, '#222');
      wrap('Renouvellement d\'air ' + fmt(s2.ach, 0) + ' vol/h ; humidité dedans ' + fmt(s2.RHiMax, 0) + ' % au plus' + (s2.cond > 0 ? ', condensation possible ' + fmt(s2.cond, 1) + ' h' : '') + '.', 19, '#222');
      wrap(O.drip ? 'Goutte-à-goutte de ' + O.dripA + ' h à ' + O.dripB + ' h : ' + fmt(s2.evap, 0) + ' L évaporés par jour (les deux faces des briques mouillées).' : 'Goutte-à-goutte arrêté.', 19, O.drip ? '#222' : '#b00');
      var Rr = TH.result();
      if (Rr) wrap('Paroi ' + Rr.mat.name + ', ' + fmt(O.ep * 100, 0) + ' cm, surface ouverte ' + fmt(100 * Rr.phi, 0) + ' % ; intérieur ' + fmt(Rr.geo.area, 1) + ' m², hauteur ' + fmt(Rr.geo.Hw, 2) + ' m.', 17, '#444');
    } else wrap('Fichier EPW et paroi nécessaires.', 19, '#b00');
    var SR = TH.seasonState && TH.seasonState.res;
    if (SR && SR.tot) {
      yc += 10; yc = head('10. Été, juin à septembre', xC, yc);
      var T2 = SR.tot;
      wrap('Ressenti > 26 °C : ' + fmt(T2.hot[0], 0) + ' h dehors → ' + fmt(T2.hot[1], 0) + ' h dedans ; > 32 °C : ' + fmt(T2.hot32[0], 0) + ' → ' + fmt(T2.hot32[1], 0) + ' h.' +
        (SR.useWater ? ' Eau : ' + fmt(T2.use / 1000, 1) + ' m³ consommés, ' + fmt(T2.rain / 1000, 1) + ' m³ de pluie, réservoir ' + fmt(SR.cap / 1000, 1) + ' m³ (' + (T2.emptyDays ? T2.emptyDays + ' jours vide' : 'jamais vide') + ').' : ''), 19, '#222');
    }
    // limites
    var ly = Math.max(yc + 20, yEnd - 190);
    x.fillStyle = '#eee'; x.fillRect(xC - 12, ly - 12, rw + 24, 200);
    ['Limites du modèle', 'Vent : simulation simplifiée du vent moyen (Lattice-Boltzmann), sans rafales ; ni CFD ni soufflerie.',
      'Chaleur : paroi en 8 orientations, air bien mélangé, sol avec inertie, vent EPW de l\'heure.',
      'Ressenti : Steadman ; UTCI : Bröde et al. (2012), personne debout à 1,1 m, soleil et ombres réels.',
      'Valeurs indicatives : comparer des variantes plutôt que lire des degrés absolus.']
      .forEach(function (l, i) { txt(l, xC, ly + i * 34, i ? 17 : 22, i ? '#333' : '#111', !i); });
    txt('Analyse du vent · planche d\'analyse complète', m, H - 50, 20, '#555');
    E.fieldDirty = true;
    return c;
  };
  EXP.fullpng = function () {
    status('Préparation de la planche complète…');
    setTimeout(function () {
      try {
        var c = EXP.full();
        c.toBlob(function (b) { download(b, 'analyse-complete-A2-' + stamp() + '.png'); status(CLW.engine.stable ? 'Planche complète enregistrée (A2, 150 dpi).' : 'Planche enregistrée, mais le vent n\'est pas encore stabilisé.', CLW.engine.stable ? 'ok' : 'err'); }, 'image/png');
      } catch (e) { console.error(e); status('Erreur pendant la planche : ' + e.message, 'err'); }
    }, 30);
  };

  // ------------------------------------------------------------------ marching squares
  // champ v (nx × ny, centres de cellule), NaN = obstacle ; renvoie des polylignes en coordonnées du plan
  EXP.isolines = function (v, g, level) {
    var nx = g.nx, ny = g.ny, segs = [];
    function P(i, j) { return [CLW.cellX(g, i), CLW.cellY(g, j)]; }
    function edge(i0, j0, i1, j1) {
      // ordre canonique : un même bord donne le même point
      if (j1 < j0 || (j1 === j0 && i1 < i0)) { var a = i0; i0 = i1; i1 = a; a = j0; j0 = j1; j1 = a; }
      var va = v[j0 * nx + i0], vb = v[j1 * nx + i1], t = (level - va) / (vb - va);
      var pa = P(i0, j0), pb = P(i1, j1);
      return [pa[0] + t * (pb[0] - pa[0]), pa[1] + t * (pb[1] - pa[1])];
    }
    for (var j = 0; j + 1 < ny; j++) for (var i = 0; i + 1 < nx; i++) {
      var a = v[j * nx + i], b = v[j * nx + i + 1], c = v[(j + 1) * nx + i + 1], d = v[(j + 1) * nx + i];
      if (a !== a || b !== b || c !== c || d !== d) continue;
      var code = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
      if (code === 0 || code === 15) continue;
      var T = function () { return edge(i, j, i + 1, j); }, R = function () { return edge(i + 1, j, i + 1, j + 1); };
      var B = function () { return edge(i, j + 1, i + 1, j + 1); }, Lf = function () { return edge(i, j, i, j + 1); };
      var mid = (a + b + c + d) / 4 >= level;
      switch (code) {
        case 1: case 14: segs.push([Lf(), T()]); break;
        case 2: case 13: segs.push([T(), R()]); break;
        case 3: case 12: segs.push([Lf(), R()]); break;
        case 4: case 11: segs.push([R(), B()]); break;
        case 6: case 9: segs.push([T(), B()]); break;
        case 7: case 8: segs.push([Lf(), B()]); break;
        case 5: if (mid) { segs.push([Lf(), B()]); segs.push([T(), R()]); } else { segs.push([Lf(), T()]); segs.push([R(), B()]); } break;
        case 10: if (mid) { segs.push([Lf(), T()]); segs.push([R(), B()]); } else { segs.push([T(), R()]); segs.push([Lf(), B()]); } break;
      }
    }
    var J = CLW.Import.joinSegments(segs, Math.max(1e-6, g.dx * 1e-5));
    return J.rings.map(function (r) { return { pts: r, closed: true }; })
      .concat(J.open.map(function (o) { return { pts: o, closed: false }; }));
  };

  // ------------------------------------------------------------------ DXF R12 en millimètres
  EXP.buildDXF = function () {
    var S = CLW.state, E = CLW.engine;
    var W = S.domain.W, H = S.domain.H, ox = W / 2, oy = H / 2;
    var out = [];
    function w(code, val) { out.push(String(code), String(val)); }
    function X(x) { return ((x + ox) * 1000).toFixed(3); }
    function Y(y) { return ((y + oy) * 1000).toFixed(3); }
    var LAYERS = [['0', 7], ['DOMAINE', 8], ['BATIMENTS', 7], ['MURS', 1], ['ARBRES', 3], ['VENT_2MS', 5], ['VENT_4MS', 3], ['VENT_6MS', 2], ['VENT_8MS', 1]];
    // en-tête
    w(0, 'SECTION'); w(2, 'HEADER');
    w(9, '$ACADVER'); w(1, 'AC1009');
    w(9, '$INSBASE'); w(10, '0.0'); w(20, '0.0'); w(30, '0.0');
    w(9, '$EXTMIN'); w(10, '0.0'); w(20, '0.0'); w(30, '0.0');
    w(9, '$EXTMAX'); w(10, (W * 1000).toFixed(3)); w(20, (H * 1000).toFixed(3)); w(30, '0.0');
    w(9, '$LIMMIN'); w(10, '0.0'); w(20, '0.0');
    w(9, '$LIMMAX'); w(10, (W * 1000).toFixed(3)); w(20, (H * 1000).toFixed(3));
    w(9, '$INSUNITS'); w(70, 4);
    w(9, '$MEASUREMENT'); w(70, 1);
    w(0, 'ENDSEC');
    // tables
    w(0, 'SECTION'); w(2, 'TABLES');
    w(0, 'TABLE'); w(2, 'VPORT'); w(70, 1);
    w(0, 'VPORT'); w(2, '*ACTIVE'); w(70, 0); w(10, '0.0'); w(20, '0.0'); w(11, '1.0'); w(21, '1.0');
    w(12, (W * 500).toFixed(3)); w(22, (H * 500).toFixed(3)); w(13, '0.0'); w(23, '0.0'); w(14, '10.0'); w(24, '10.0');
    w(15, '10.0'); w(25, '10.0'); w(16, '0.0'); w(26, '0.0'); w(36, '1.0'); w(17, '0.0'); w(27, '0.0'); w(37, '0.0');
    w(40, (H * 1100).toFixed(3)); w(41, (W / H).toFixed(4)); w(42, '50.0'); w(43, '0.0'); w(44, '0.0'); w(50, '0.0'); w(51, '0.0');
    w(71, 0); w(72, 100); w(73, 1); w(74, 3); w(75, 0); w(76, 0); w(77, 0); w(78, 0);
    w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'LTYPE'); w(70, 1);
    w(0, 'LTYPE'); w(2, 'CONTINUOUS'); w(70, 0); w(3, 'Solid line'); w(72, 65); w(73, 0); w(40, '0.0');
    w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'LAYER'); w(70, LAYERS.length);
    LAYERS.forEach(function (l) { w(0, 'LAYER'); w(2, l[0]); w(70, 0); w(62, l[1]); w(6, 'CONTINUOUS'); });
    w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'STYLE'); w(70, 1);
    w(0, 'STYLE'); w(2, 'STANDARD'); w(70, 0); w(40, '0.0'); w(41, '1.0'); w(50, '0.0'); w(71, 0); w(42, '2.5'); w(3, 'txt'); w(4, '');
    w(0, 'ENDTAB');
    ['VIEW', 'UCS'].forEach(function (t) { w(0, 'TABLE'); w(2, t); w(70, 0); w(0, 'ENDTAB'); });
    w(0, 'TABLE'); w(2, 'APPID'); w(70, 1); w(0, 'APPID'); w(2, 'ACAD'); w(70, 0); w(0, 'ENDTAB');
    w(0, 'TABLE'); w(2, 'DIMSTYLE'); w(70, 0); w(0, 'ENDTAB');
    w(0, 'ENDSEC');
    w(0, 'SECTION'); w(2, 'BLOCKS'); w(0, 'ENDSEC');
    // entités
    w(0, 'SECTION'); w(2, 'ENTITIES');
    function poly(layer, pts, closed) {
      if (pts.length < 2) return;
      w(0, 'POLYLINE'); w(8, layer); w(66, 1); w(10, '0.0'); w(20, '0.0'); w(30, '0.0'); w(70, closed ? 1 : 0);
      pts.forEach(function (p) { w(0, 'VERTEX'); w(8, layer); w(10, X(p[0])); w(20, Y(p[1])); w(30, '0.0'); });
      w(0, 'SEQEND'); w(8, layer);
    }
    poly('DOMAINE', [[-ox, -oy], [ox, -oy], [ox, oy], [-ox, oy]], true);
    var counts = { b: 0, m: 0, a: 0, iso: 0 };
    S.objects.forEach(function (o) {
      if (o.type === 'building') { poly('BATIMENTS', o.outer, true); (o.holes || []).forEach(function (r) { poly('BATIMENTS', r, true); }); counts.b++; }
      else if (o.type === 'wall') { poly('MURS', o.pts, false); counts.m++; }
      else if (o.type === 'tree') { w(0, 'CIRCLE'); w(8, 'ARBRES'); w(10, X(o.x)); w(20, Y(o.y)); w(30, '0.0'); w(40, (o.r * 1000).toFixed(3)); counts.a++; }
    });
    // isovitesses
    var g = E.grid;
    if (g && E.samples) {
      var N = g.nx * g.ny, v = new Float32Array(N), f = S.wind.speed / CLW.LBM.U_LAT;
      for (var k = 0; k < N; k++) v[k] = E.rast.solid[k] ? NaN : E.mean[3 * k + 2] * f;
      [2, 4, 6, 8].forEach(function (lv) {
        EXP.isolines(v, g, lv).forEach(function (l) {
          if (l.pts.length < 2) return;
          poly('VENT_' + lv + 'MS', CLW.geom.simplify(l.closed ? l.pts.concat([l.pts[0]]) : l.pts, g.dx * 0.05, l.closed).slice(0, l.closed ? -1 : undefined), l.closed);
          counts.iso++;
        });
      });
    }
    w(0, 'ENDSEC');
    w(0, 'EOF');
    return { text: out.join('\r\n') + '\r\n', counts: counts };
  };
  EXP.dxf = function () {
    var r = EXP.buildDXF();
    download(new Blob([r.text], { type: 'application/dxf' }), 'cl-wind-' + stamp() + '.dxf');
    status('DXF enregistré en millimètres (R12), origine au coin sud-ouest du domaine, nord vers +Y : ' + CLW.plur(r.counts.b, 'bâtiment', 'bâtiments') + ', ' + CLW.plur(r.counts.m, 'mur', 'murs') + ', ' + CLW.plur(r.counts.a, 'arbre', 'arbres') + ', ' + CLW.plur(r.counts.iso, 'isovitesse', 'isovitesses') + '.' +
      (CLW.engine.stable ? '' : '\nAttention : moyenne pas encore stabilisée.'), CLW.engine.stable ? 'ok' : 'err');
  };

  EXP.init = function () {
    document.getElementById('exp-png').addEventListener('click', EXP.png);
    document.getElementById('exp-dxf').addEventListener('click', EXP.dxf);
    var a3 = document.getElementById('exp-a3'); if (a3) a3.addEventListener('click', EXP.a3png);
    var a3s = document.getElementById('exp-a3sun'); if (a3s) a3s.addEventListener('click', EXP.a3sunpng);
    var fu = document.getElementById('exp-full'); if (fu) fu.addEventListener('click', EXP.fullpng);
  };
})(typeof window !== 'undefined' ? window : globalThis);
