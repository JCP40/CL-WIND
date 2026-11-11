/* CL-WIND - epw.js
 * Lecture d'un fichier météo EPW, rose des vents à 16 secteurs, vitesse ramenée à hauteur de piéton.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var EPW = CLW.EPW = {};
  var CLASSES = [[0.5, 2], [2, 4], [4, 6], [6, Infinity]];
  var CLASS_COL = ['#2b6cb0', '#38a169', '#ecc94b', '#e53e3e'];
  var CLASS_LAB = ['0,5 à 2', '2 à 4', '4 à 6', '> 6 m/s'];
  var SEASONS = { all: null, djf: [12, 1, 2], mam: [3, 4, 5], jja: [6, 7, 8], son: [9, 10, 11] };

  // renvoie { location, records: [{m, h, dir, v}] } ou lève une erreur explicite
  EPW.parse = function (text) {
    var lines = String(text).split(/\r?\n/);
    if (!/^LOCATION\s*,/i.test(lines[0] || '')) throw new Error('Ce fichier n\'est pas un EPW : la première ligne doit commencer par LOCATION.');
    var loc = lines[0].split(',');
    var location = {
      city: (loc[1] || '').trim(), region: (loc[2] || '').trim(), country: (loc[3] || '').trim(),
      source: (loc[4] || '').trim(), lat: parseFloat(loc[6]), lon: parseFloat(loc[7]), tz: parseFloat(loc[8]), elev: parseFloat(loc[9])
    };
    var rec = [], bad = 0;
    // données horaires complètes (8760 h, indice (jour - 1) × 24 + heure - 1) pour le soleil et la chaleur :
    // T air sec °C, HR %, rayonnement global, direct normal, diffus W/m², infrarouge du ciel W/m², vent
    var NH = 8760, HR = { T: new Float32Array(NH).fill(NaN), RH: new Float32Array(NH).fill(NaN), GHI: new Float32Array(NH), DNI: new Float32Array(NH),
      DHI: new Float32Array(NH), IR: new Float32Array(NH).fill(NaN), ws: new Float32Array(NH), wd: new Float32Array(NH), P: new Float32Array(NH), n: 0 };
    var MD = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    function num(x, bad) { var f = parseFloat(x); return isFinite(f) && f < bad ? f : NaN; }
    for (var i = 8; i < lines.length; i++) {
      var c = lines[i].split(',');
      if (c.length < 22) continue;
      var m = parseInt(c[1], 10), h = parseInt(c[3], 10), d = parseFloat(c[20]), v = parseFloat(c[21]);
      var dd = parseInt(c[2], 10);
      if (m >= 1 && m <= 12 && h >= 1 && h <= 24 && dd >= 1 && dd <= 31 && !(m === 2 && dd === 29)) {
        var ih = (MD[m - 1] + dd - 1) * 24 + h - 1;
        if (ih < NH) {
          HR.T[ih] = num(c[6], 99); HR.RH[ih] = num(c[8], 999); HR.IR[ih] = num(c[12], 9999);
          HR.GHI[ih] = num(c[13], 9999) || 0; HR.DNI[ih] = num(c[14], 9999) || 0; HR.DHI[ih] = num(c[15], 9999) || 0;
          HR.ws[ih] = num(c[21], 999) || 0; HR.wd[ih] = num(c[20], 999) || 0; HR.P[ih] = c.length > 33 ? (num(c[33], 999) || 0) : 0; HR.n++;
        }
      }
      if (!(m >= 1 && m <= 12) || !(h >= 1 && h <= 24)) { bad++; continue; }
      if (!isFinite(d) || !isFinite(v) || d >= 999 || v >= 999 || d < 0 || d > 360 || v < 0) { bad++; continue; }
      rec.push({ m: m, h: h, dir: d % 360, v: v });
    }
    if (!rec.length) throw new Error('Aucune donnée de vent exploitable dans ce fichier EPW.');
    // heures manquantes : interpolation simple de la température et de l'humidité
    ['T', 'RH'].forEach(function (k) { var a = HR[k], last = NaN; for (var q = 0; q < NH; q++) { if (isFinite(a[q])) last = a[q]; else if (isFinite(last)) a[q] = last; } for (q = NH - 1; q >= 0 && !isFinite(a[q]); q--) a[q] = 10; });
    // périodes types et extrêmes (ligne TYPICAL/EXTREME PERIODS) : [{ name, kind, a: [m, j], b: [m, j] }]
    var periods = [];
    lines.slice(1, 8).forEach(function (l) {
      if (!/^TYPICAL\/EXTREME PERIODS/i.test(l)) return;
      var q = l.split(','), n = parseInt(q[1], 10) || 0;
      for (var k = 0; k < n; k++) {
        var a = (q[4 + 4 * k] || '').trim().split('/'), b = (q[5 + 4 * k] || '').trim().split('/');
        if (a.length === 2 && b.length === 2) periods.push({ name: (q[2 + 4 * k] || '').trim(), kind: (q[3 + 4 * k] || '').trim(), a: [+a[0], +a[1]], b: [+b[0], +b[1]] });
      }
    });
    return { location: location, records: rec, missing: bad, hourly: HR.n > 8000 ? HR : null, periods: periods };
  };

  // rose : 16 secteurs, classes à hauteur de piéton, calme < 0,5 m/s compté à part
  EPW.rose = function (data, f) {
    var months = SEASONS[f.season || 'all'], alpha = f.alpha != null ? f.alpha : 0.25;
    var factor = Math.pow(1.5 / 10, alpha);
    var sec = [], total = 0, calm = 0, k;
    for (k = 0; k < 16; k++) sec.push({ counts: [0, 0, 0, 0], speeds: [] });
    data.records.forEach(function (r) {
      if (months && months.indexOf(r.m) < 0) return;
      var start = r.h - 1, day = start >= 8 && start < 20;
      if (f.hours === 'day' && !day) return;
      if (f.hours === 'night' && day) return;
      total++;
      var v = r.v * factor;
      if (v < 0.5) { calm++; return; }
      var s = Math.round(r.dir / 22.5) % 16;
      sec[s].speeds.push(v);
      for (var c = 0; c < 4; c++) if (v >= CLASSES[c][0] && v < CLASSES[c][1]) { sec[s].counts[c]++; break; }
    });
    sec.forEach(function (s, i) {
      s.dir = i * 22.5;
      s.n = s.speeds.length;
      s.freq = total ? s.n / total : 0;
      s.mean = s.n ? s.speeds.reduce(function (a, b) { return a + b; }, 0) / s.n : 0;
      var sorted = s.speeds.slice().sort(function (a, b) { return a - b; });
      s.p90 = s.n ? sorted[Math.min(s.n - 1, Math.floor(0.9 * s.n))] : 0;
      delete s.speeds;
    });
    return { sectors: sec, total: total, calm: calm, factor: factor };
  };

  // ------------------------------------------------------------------ interface
  var data = null, rose = null, hover = -1;
  function filters() {
    return {
      season: document.getElementById('epw-season').value,
      hours: document.getElementById('epw-hours').value,
      stat: document.getElementById('epw-stat').value,
      alpha: parseFloat(document.getElementById('epw-alpha').value)
    };
  }
  function draw() {
    var cv = document.getElementById('epw-rose'), ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = W / 2 - 26;
    ctx.clearRect(0, 0, W, H);
    if (!rose) return;
    var maxf = 0; rose.sectors.forEach(function (s) { maxf = Math.max(maxf, s.freq); });
    var ringStep = maxf > 0.2 ? 0.1 : maxf > 0.1 ? 0.05 : 0.02, rmax = Math.max(ringStep, Math.ceil(maxf / ringStep) * ringStep);
    ctx.strokeStyle = '#2c3340'; ctx.fillStyle = '#8b95a5'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
    for (var r = ringStep; r <= rmax + 1e-9; r += ringStep) {
      ctx.beginPath(); ctx.arc(cx, cy, r / rmax * R, 0, Math.PI * 2); ctx.stroke();
      ctx.fillText(CLW.fmt(r * 100, 0) + ' %', cx + 3, cy - r / rmax * R + 10);
    }
    var cur = Math.round(CLW.state.wind.dir / 22.5) % 16;
    rose.sectors.forEach(function (s, i) {
      var a0 = (s.dir - 11.25 - 90) * Math.PI / 180 + 0.02, a1 = (s.dir + 11.25 - 90) * Math.PI / 180 - 0.02;
      var acc = 0;
      for (var c = 0; c < 4; c++) {
        var f0 = acc / rose.total, f1 = (acc + s.counts[c]) / rose.total; acc += s.counts[c];
        if (f1 <= f0) continue;
        ctx.beginPath();
        ctx.arc(cx, cy, f1 / rmax * R, a0, a1); ctx.arc(cx, cy, f0 / rmax * R, a1, a0, true); ctx.closePath();
        ctx.fillStyle = CLASS_COL[c]; ctx.globalAlpha = i === hover ? 1 : 0.85; ctx.fill(); ctx.globalAlpha = 1;
      }
      if (i === cur || i === hover) {
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, a0 - 0.02, a1 + 0.02); ctx.closePath();
        ctx.strokeStyle = i === cur ? '#fff' : '#8b95a5'; ctx.lineWidth = 1.2; ctx.stroke(); ctx.lineWidth = 1;
      }
    });
    ctx.fillStyle = '#dfe4ec'; ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    [['N', 0], ['E', 90], ['S', 180], ['O', 270]].forEach(function (d) {
      var a = (d[1] - 90) * Math.PI / 180; ctx.fillText(d[0], cx + Math.cos(a) * (R + 14), cy + Math.sin(a) * (R + 14));
    });
    ctx.textBaseline = 'alphabetic'; ctx.font = '10px sans-serif'; ctx.textAlign = 'left';
    for (var k = 0; k < 4; k++) { ctx.fillStyle = CLASS_COL[k]; ctx.fillRect(4, H - 14 * (4 - k), 9, 9); ctx.fillStyle = '#dfe4ec'; ctx.fillText(CLASS_LAB[k], 16, H - 14 * (4 - k) + 8); }
    ctx.textAlign = 'right'; ctx.fillStyle = '#8b95a5';
    ctx.fillText('calme ' + CLW.fmt(rose.calm / Math.max(1, rose.total) * 100, 1) + ' %', W - 4, H - 6);
  }
  function sectorText(i) {
    var s = rose.sectors[i], f = filters();
    var v = f.stat === 'p90' ? s.p90 : s.mean;
    return 'Secteur ' + CLW.dirAbbr(s.dir) + ' (' + s.dir + '°) : ' + CLW.fmt(s.freq * 100, 1) + ' % du temps, vitesse à 1,5 m : moyenne ' +
      CLW.fmt(s.mean, 1) + ' m/s, dépassée 10 % du temps ' + CLW.fmt(s.p90, 1) + ' m/s.' + (s.n ? ' Clic : applique ' + CLW.fmt(Math.max(0.5, v), 1) + ' m/s.' : '');
  }
  function update() {
    if (!data) return;
    rose = EPW.rose(data, filters());
    draw();
  }
  EPW.current = function () { return rose; };
  EPW.data = function () { return data; };
  function sectorAt(e) {
    var cv = document.getElementById('epw-rose'), r = cv.getBoundingClientRect();
    var x = (e.clientX - r.left) / r.width * cv.width - cv.width / 2, y = (e.clientY - r.top) / r.height * cv.height - cv.height / 2;
    if (Math.hypot(x, y) < 6) return -1;
    var a = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
    return Math.round(a / 22.5) % 16;
  }
  EPW.load = function (text, name, isDefault) {
    var info = document.getElementById('epw-info');
    try {
      data = EPW.parse(text);
    } catch (e) {
      data = null; rose = null;
      info.textContent = e.message; info.className = 'status err';
      document.getElementById('epw-controls').hidden = true;
      return false;
    }
    if (isDefault || !EPW.typical) EPW.typical = data; // année type : base des années mesurées (heures sans mesure)
    EPW.measured = null;
    var L = data.location;
    info.textContent = 'Station : ' + [L.city, L.region, L.country].filter(Boolean).join(', ') +
      (isFinite(L.lat) ? ' (' + CLW.fmt(L.lat, 2) + ', ' + CLW.fmt(L.lon, 2) + ')' : '') +
      '\n' + data.records.length + ' heures exploitables' + (data.missing ? ', ' + data.missing + ' valeurs absentes ignorées' : '') + '.' +
      (name ? '\nFichier : ' + name + (isDefault ? ' (fichier par défaut)' : '') : '');
    info.className = 'status ok';
    EPW.name = name || ''; EPW.station = [L.city.replace(/\./g, ' '), L.region, L.country].filter(Boolean).join(', ');
    var mb = document.getElementById('meteo-badge');
    if (mb) { mb.textContent = 'Météo : ' + EPW.station + (isDefault ? ' (par défaut)' : ''); mb.title = 'Fichier météo : ' + (name || '?') + ' · onglet Vent pour en changer'; }
    document.getElementById('epw-controls').hidden = false;
    update();
    if (CLW.Sun && CLW.Sun.epwChanged) CLW.Sun.epwChanged();
    return true;
  };
  // météo déjà calculée (année mesurée de l'atlas, js/mesures.js) : mêmes structures qu'EPW.parse
  EPW.setData = function (obj, name, label) {
    data = obj; EPW.measured = obj.measured || null;
    EPW.name = name || ''; EPW.station = label || name || '';
    var info = document.getElementById('epw-info');
    if (info) { info.textContent = (label || name) + '\n' + obj.records.length + ' heures de vent exploitables.'; info.className = 'status ok'; }
    var mb = document.getElementById('meteo-badge');
    if (mb) { mb.textContent = 'Météo : ' + (label || name); mb.title = 'Mesures horaires (atlas) · onglet Vent pour revenir au fichier EPW'; }
    var ctl = document.getElementById('epw-controls'); if (ctl) ctl.hidden = false;
    update();
    if (CLW.Sun && CLW.Sun.epwChanged) CLW.Sun.epwChanged();
    return true;
  };
  EPW.restoreTypical = function () {
    if (!EPW.typical) return false;
    data = EPW.typical; EPW.measured = null; EPW.name = (root.CLW_EPW_DEFAUT && root.CLW_EPW_DEFAUT.name) || 'EPW';
    var L = data.location; EPW.station = [L.city.replace(/\./g, ' '), L.region, L.country].filter(Boolean).join(', ');
    var mb = document.getElementById('meteo-badge'); if (mb) mb.textContent = 'Météo : ' + EPW.station + ' (année type)';
    update(); if (CLW.Sun && CLW.Sun.epwChanged) CLW.Sun.epwChanged();
    return true;
  };
  // vent moyen d'un jour du fichier EPW (n = 1..365) sur les 24 h : direction = moyenne vectorielle (pondérée par
  // la vitesse), vitesse = moyenne des vitesses, ramenée de 10 m à 1,5 m comme la rose (α de l'environnement)
  EPW.dayWind = function (n) {
    var HR = data && data.hourly; if (!HR) return null;
    var factor = Math.pow(1.5 / 10, filters().alpha), sx = 0, sy = 0, sv = 0, k = 0;
    for (var h = 0; h < 24; h++) {
      var i = (n - 1) * 24 + h; if (i < 0 || i >= HR.ws.length) continue;
      var v = HR.ws[i], a = HR.wd[i] * Math.PI / 180; sx += v * Math.sin(a); sy += v * Math.cos(a); sv += v; k++;
    }
    if (!k) return null;
    return { dir: Math.round((Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360) % 360, speed: Math.max(0.5, Math.min(20, Math.round(sv / k * factor * 10) / 10)),
      v10: sv / k, steady: sv > 0 ? Math.hypot(sx, sy) / sv : 1 };
  };
  // « Vent du jour » (onglet Soleil) : au changement de jour, le vent du calcul prend la moyenne de ce jour
  var lastDay = null;
  EPW.dayWindOn = function () { var cb = document.getElementById('sun-daywind'); return !!(cb && cb.checked); };
  EPW.applyDayWind = function (force) {
    if (!EPW.dayWindOn() || !CLW.Sun) return;
    var st = CLW.Sun.state, key = st.m + '-' + st.d; if (!force && key === lastDay) return; lastDay = key;
    var w = EPW.dayWind(CLW.Sun.n()), el = document.getElementById('sun-daywind-info'), fmt = CLW.fmt || function (x, d) { return (+x).toFixed(d); };
    if (!w) { if (el) el.textContent = 'Pas de données horaires dans le fichier météo.'; return; }
    CLW.setWind(w.dir, w.speed);
    if (el) el.textContent = 'Vent moyen du ' + CLW.Sun.dateTxt(st.m, st.d) + ' : ' + fmt(w.speed, 1) + ' m/s à 1,5 m (' + fmt(w.v10, 1) + ' m/s à 10 m), ' +
      (CLW.deLe && CLW.dirName ? CLW.deLe(CLW.dirName(w.dir)) : 'direction') + ' (' + w.dir + '°)' + (w.steady < 0.5 ? ' ; direction très variable ce jour-là' : '') + '.';
  };
  EPW.applySector = function (i) {
    if (!rose || i < 0) return;
    var s = rose.sectors[i]; if (!s.n) return;
    var f = filters(), v = f.stat === 'p90' ? s.p90 : s.mean;
    CLW.setWind(s.dir, Math.max(0.5, Math.min(20, Math.round(v * 10) / 10)));
    document.getElementById('epw-sector').textContent = 'Appliqué. ' + sectorText(i);
    draw();
  };
  EPW.init = function () {
    document.getElementById('epw-file').addEventListener('change', function (e) {
      var file = e.target.files[0]; if (!file) return;
      if (file.size > 60 * 1024 * 1024) { var i = document.getElementById('epw-info'); i.textContent = 'Fichier trop lourd (plus de 60 Mo).'; i.className = 'status err'; return; }
      var rd = new FileReader();
      rd.onload = function () { EPW.load(rd.result, file.name); };
      rd.readAsText(file);
    });
    ['epw-season', 'epw-hours', 'epw-stat', 'epw-alpha'].forEach(function (id) { document.getElementById(id).addEventListener('change', update); });
    var cv = document.getElementById('epw-rose');
    cv.addEventListener('mousemove', function (e) {
      if (!rose) return;
      var i = sectorAt(e);
      if (i !== hover) { hover = i; draw(); document.getElementById('epw-sector').textContent = i >= 0 ? sectorText(i) : 'Cliquez sur un secteur pour appliquer sa direction et sa vitesse.'; }
    });
    cv.addEventListener('mouseleave', function () { hover = -1; draw(); });
    cv.addEventListener('click', function (e) { EPW.applySector(sectorAt(e)); });
    // vent du jour : case mémorisée dans ce navigateur (cochée par défaut)
    var dw = document.getElementById('sun-daywind');
    if (dw) {
      try { var sv = localStorage.getItem('clwind-daywind'); if (sv != null) dw.checked = sv === '1'; } catch (e) { /* rien */ }
      dw.addEventListener('change', function () {
        try { localStorage.setItem('clwind-daywind', dw.checked ? '1' : '0'); } catch (e) { /* rien */ }
        if (dw.checked) EPW.applyDayWind(true); else { var el = document.getElementById('sun-daywind-info'); if (el) el.textContent = 'Vent réglé à la main (onglet Vent) ou par Grasshopper.'; }
      });
      setTimeout(function () {
        if (CLW.Sun && CLW.Sun.onChange) CLW.Sun.onChange(function () { EPW.applyDayWind(false); });
        EPW.applyDayWind(true);
      }, 0);
    }
    // fichier météo par défaut (meteo/defaut_epw.js)
    if (root.CLW_EPW_DEFAUT && root.CLW_EPW_DEFAUT.text) EPW.load(root.CLW_EPW_DEFAUT.text, root.CLW_EPW_DEFAUT.name, true);
  };
})(typeof window !== 'undefined' ? window : globalThis);
