/* CL-WIND - mesures.js
 * Mesures horaires Météo-France de l'atlas du site (station 44020001 Nantes-Bouguenais, 2016 à aujourd'hui) :
 * - chargées par le composant CL-WIND Live (relais live/atlas/…, qui lit le serveur de l'atlas ou son dossier),
 *   sinon choisies à la main (fichier CSV de l'atlas : data/meteo/meteofrance_44020001_horaire.csv) ;
 * - épisodes de canicule et de grand froid (moyennes sur 3 jours des minimales et des maximales, comme les
 *   indicateurs biométéorologiques de Météo-France) ;
 * - « année réelle » centrée sur un épisode : 365 jours de mesures, au format des données EPW de CL-WIND
 *   (heure normale UTC + 1, heure de fin), pour que la journée, l'été, l'UTCI et l'épisode tournent sur le vrai temps.
 * Rayonnement : global mesuré (GLO, J/cm² par heure), partagé en direct et diffus par le modèle d'Erbs.
 * Ciel : infrarouge d'après la température de rosée et la nébulosité (Clark et Allen), si la nébulosité est mesurée.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var MES = CLW.Mesures = { raw: null, days: null, src: '', list: [] };
  var MD = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], DAY = 86400000, HOUR = 3600000;
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var SITE = { lat: 47.15, lon: -1.6089, tz: 1 };
  // préréglages : seuils sur les moyennes de 3 jours (min, max), au-dessus pour le chaud, en dessous pour le froid
  MES.PRESETS = {
    canicule: { kind: 'chaud', sn: 20, sx: 34, name: 'Canicules', note: 'seuils de vigilance Météo-France de la Loire-Atlantique' },
    chaleur: { kind: 'chaud', sn: 18, sx: 32, name: 'Vagues de chaleur', note: 'seuils abaissés' },
    froid: { kind: 'froid', sn: -2, sx: 5, name: 'Grands froids', note: 'gel durable' },
    froid2: { kind: 'froid', sn: -1, sx: 6, name: 'Vagues de froid', note: 'seuils relevés' }
  };
  function $(id) { return document.getElementById(id); }
  function fmt(x, d) { return CLW.fmt ? CLW.fmt(x, d) : (+x).toFixed(d); }
  function doyOf(m, d) { return MD[m - 1] + d; }
  MES.dateTxt = function (ms) { var D = new Date(ms); return D.getUTCDate() + (D.getUTCDate() === 1 ? 'er' : '') + ' ' + MOIS[D.getUTCMonth()] + ' ' + D.getUTCFullYear(); };
  function shortTxt(ms) { var D = new Date(ms); return D.getUTCDate() + '/' + (D.getUTCMonth() + 1); }

  // ---------------------------------------------------------------- lecture du CSV (heures UTC)
  MES.parse = function (text) {
    var lines = String(text).split(/\r?\n/), head = (lines[0] || '').split(','), col = {};
    head.forEach(function (h, i) { col[h.trim()] = i; });
    if (col.AAAAMMJJHH == null || col.T == null) throw new Error('Ce fichier n\'est pas le CSV horaire Météo-France de l\'atlas (colonne AAAAMMJJHH ou T absente).');
    function t(s) { return Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10)); }
    var first = null, last = null, k;
    for (k = 1; k < lines.length; k++) { var s = lines[k].slice(0, 10); if (/^\d{10}$/.test(s)) { if (first == null) first = t(s); last = t(s); } }
    if (first == null) throw new Error('Aucune ligne de mesure.');
    var n = Math.round((last - first) / HOUR) + 1, R = { t0: first, n: n };
    ['T', 'U', 'FF', 'DD', 'RR1', 'GLO', 'N', 'TD'].forEach(function (v) { R[v] = new Float32Array(n).fill(NaN); });
    for (k = 1; k < lines.length; k++) {
      var c = lines[k].split(','); if (c.length < 5 || !/^\d{10}$/.test(c[0])) continue;
      var i = Math.round((t(c[0]) - first) / HOUR); if (i < 0 || i >= n) continue;
      ['T', 'U', 'FF', 'DD', 'RR1', 'GLO', 'N', 'TD'].forEach(function (v) { var q = col[v]; if (q != null && c[q] !== '' && c[q] != null) { var f = parseFloat(c[q]); if (isFinite(f)) R[v][i] = f; } });
    }
    return R;
  };
  // jours civils en heure normale (UTC + 1) : heures UTC 0 à 23 = heures de fin 1 à 24 du même jour
  function daily(R) {
    var nd = Math.floor(R.n / 24) + 1, D = [], d0 = Date.UTC(new Date(R.t0).getUTCFullYear(), new Date(R.t0).getUTCMonth(), new Date(R.t0).getUTCDate());
    for (var j = 0; j < nd; j++) {
      var ms = d0 + j * DAY, mn = Infinity, mx = -Infinity, s = 0, c = 0;
      for (var h = 0; h < 24; h++) { var i = Math.round((ms + h * HOUR - R.t0) / HOUR); if (i < 0 || i >= R.n) continue; var v = R.T[i]; if (isFinite(v)) { mn = Math.min(mn, v); mx = Math.max(mx, v); s += v; c++; } }
      D.push(c >= 20 ? { ms: ms, tmin: mn, tmax: mx, tmoy: s / c } : { ms: ms, tmin: NaN, tmax: NaN, tmoy: NaN });
    }
    return D;
  }
  MES.use = function (text, src) {
    MES.raw = MES.parse(text); MES.days = daily(MES.raw); MES.src = src || '';
    return MES.raw;
  };
  MES.span = function () { if (!MES.days) return null; var a = MES.days.filter(function (d) { return isFinite(d.tmoy); }); return a.length ? [a[0].ms, a[a.length - 1].ms] : null; };

  // ---------------------------------------------------------------- épisodes
  // jour retenu si les moyennes sur 3 jours (J, J+1, J+2) des minimales et des maximales dépassent les seuils
  // (chaud : au-dessus ; froid : en dessous) ; les 3 jours de la fenêtre sont dans l'épisode
  MES.detect = function (kind, sn, sx) {
    var D = MES.days; if (!D) return [];
    var fl = new Uint8Array(D.length);
    for (var i = 0; i + 2 < D.length; i++) {
      var a = D[i], b = D[i + 1], c = D[i + 2]; if (!isFinite(a.tmin) || !isFinite(b.tmin) || !isFinite(c.tmin)) continue;
      var ibn = (a.tmin + b.tmin + c.tmin) / 3, ibx = (a.tmax + b.tmax + c.tmax) / 3;
      if (kind === 'chaud' ? (ibn >= sn && ibx >= sx) : (ibn <= sn && ibx <= sx)) { fl[i] = fl[i + 1] = fl[i + 2] = 1; }
    }
    var out = [], s = -1;
    for (i = 0; i <= D.length; i++) {
      if (i < D.length && fl[i]) { if (s < 0) s = i; continue; }
      if (s >= 0) {
        var e = i - 1, pk = s, tx = -Infinity, tn = Infinity, sm = 0;
        for (var j = s; j <= e; j++) { if (kind === 'chaud' ? D[j].tmax > D[pk].tmax : D[j].tmin < D[pk].tmin) pk = j; tx = Math.max(tx, D[j].tmax); tn = Math.min(tn, D[j].tmin); sm += D[j].tmoy; }
        out.push({ kind: kind, i0: s, i1: e, ms0: D[s].ms, ms1: D[e].ms, len: e - s + 1, peak: D[pk].ms, tmax: tx, tmin: tn, tmoy: sm / (e - s + 1) });
        s = -1;
      }
    }
    // les plus intenses d'abord
    out.sort(function (p, q) { return kind === 'chaud' ? q.tmoy - p.tmoy : p.tmoy - q.tmoy; });
    return out;
  };
  MES.label = function (e) {
    return MES.dateTxt(e.ms0).replace(/ \d{4}$/, '') + ' → ' + MES.dateTxt(e.ms1) + ' (' + e.len + ' j) · ' +
      (e.kind === 'chaud' ? 'max ' + fmt(e.tmax, 1) + ' °C, moy. ' + fmt(e.tmoy, 1) : 'min ' + fmt(e.tmin, 1) + ' °C, moy. ' + fmt(e.tmoy, 1)) + ' °C';
  };

  // ---------------------------------------------------------------- année réelle centrée sur une date
  // décomposition du global en direct et diffus (Erbs et al., 1982)
  function erbs(ghi, n, hEnd) {
    if (!(ghi > 0) || !CLW.Sun) return [0, 0];
    var p = CLW.Sun.pos(n, hEnd - 0.5, SITE), cz = Math.sin(p.alt * Math.PI / 180);
    if (p.alt < 2 || cz <= 0.035) return [0, ghi];
    var I0 = 1367 * (1 + 0.033 * Math.cos(2 * Math.PI * n / 365)), kt = Math.min(1.2, ghi / (I0 * cz));
    var kd = kt <= 0.22 ? 1 - 0.09 * kt : kt <= 0.8 ? 0.9511 - 0.1604 * kt + 4.388 * kt * kt - 16.638 * Math.pow(kt, 3) + 12.336 * Math.pow(kt, 4) : 0.165;
    var dhi = Math.min(ghi, kd * ghi), dni = Math.min(1000, Math.max(0, (ghi - dhi) / cz));
    return [dni, dhi];
  }
  function skyIR(T, Td, N) {
    if (!isFinite(T) || !isFinite(Td) || !isFinite(N)) return NaN;
    var n = Math.max(0, Math.min(10, N * 10 / 8)), e = (0.787 + 0.764 * Math.log((Td + 273.15) / 273)) * (1 + 0.0224 * n - 0.0035 * n * n + 0.00028 * n * n * n);
    return e * 5.67e-8 * Math.pow(T + 273.15, 4);
  }
  MES.yearAround = function (centerMs) {
    var R = MES.raw; if (!R) return null;
    var base = CLW.EPW && CLW.EPW.typical && CLW.EPW.typical.hourly, NH = 8760, HR = {};
    ['T', 'RH', 'GHI', 'DNI', 'DHI', 'IR', 'ws', 'wd', 'P'].forEach(function (v) { HR[v] = base ? Float32Array.from(base[v]) : new Float32Array(NH).fill(v === 'T' ? 10 : v === 'RH' ? 80 : v === 'IR' ? NaN : 0); });
    HR.n = NH;
    var meas = new Uint8Array(NH), nMeas = 0, dates = new Float64Array(366).fill(NaN), c0 = Math.floor(centerMs / DAY) * DAY;
    for (var off = -182; off <= 182; off++) {
      var ms = c0 + off * DAY, D = new Date(ms), m = D.getUTCMonth() + 1, d = D.getUTCDate();
      if (m === 2 && d === 29) continue;
      var n = doyOf(m, d); dates[n] = ms;
      for (var hh = 0; hh < 24; hh++) {
        var i = Math.round((ms + hh * HOUR - R.t0) / HOUR); if (i < 0 || i >= R.n || !isFinite(R.T[i])) continue;
        var ih = (n - 1) * 24 + hh, ghi = isFinite(R.GLO[i]) ? Math.max(0, R.GLO[i] * 10000 / 3600) : 0, dd = erbs(ghi, n, hh + 1);
        HR.T[ih] = R.T[i]; if (isFinite(R.U[i])) HR.RH[ih] = R.U[i];
        HR.GHI[ih] = ghi; HR.DNI[ih] = dd[0]; HR.DHI[ih] = dd[1];
        HR.IR[ih] = skyIR(R.T[i], R.TD[i], R.N[i]);
        if (isFinite(R.FF[i])) HR.ws[ih] = R.FF[i]; if (isFinite(R.DD[i])) HR.wd[ih] = R.DD[i] % 360;
        HR.P[ih] = isFinite(R.RR1[i]) ? R.RR1[i] : 0;
        meas[ih] = 1; nMeas++;
      }
    }
    var rec = [];
    for (var q = 0; q < NH; q++) { var nn = Math.floor(q / 24) + 1, mm = 1; while (mm < 12 && MD[mm] < nn) mm++; rec.push({ m: mm, h: q % 24 + 1, dir: HR.wd[q] % 360, v: HR.ws[q] }); }
    var span = [c0 - 182 * DAY, c0 + 182 * DAY];
    return { location: { city: 'Nantes-Bouguenais', region: 'Pays de la Loire', country: 'FRA', source: 'Météo-France 44020001 (atlas)', lat: SITE.lat, lon: SITE.lon, tz: SITE.tz, elev: 26 },
      records: rec, missing: NH - nMeas, hourly: HR, periods: [], measured: { from: span[0], to: span[1], dates: dates, frac: nMeas / NH, center: c0 } };
  };
  // charge l'année réelle centrée sur centerMs comme météo de CL-WIND
  MES.apply = function (centerMs) {
    var y = MES.yearAround(centerMs); if (!y || !CLW.EPW || !CLW.EPW.setData) return null;
    var lab = 'mesures Météo-France ' + MES.dateTxt(y.measured.from).replace(/^\d+(er)? /, '') + ' → ' + MES.dateTxt(y.measured.to).replace(/^\d+(er)? /, '') +
      (y.measured.frac < 0.98 ? ' (' + fmt(100 * y.measured.frac, 0) + ' % mesuré, le reste : année type)' : '');
    CLW.EPW.setData(y, 'meteofrance_44020001_horaire.csv', lab);
    return y;
  };
  // date réelle d'un jour de l'année n de la météo chargée (année réelle), ou null
  MES.dateOf = function (n) { var M = CLW.EPW && CLW.EPW.measured; if (!M) return null; var v = M.dates[n]; return isFinite(v) ? v : null; };

  // ---------------------------------------------------------------- chargement
  MES.loadAtlas = async function () {
    var r = await fetch('live/atlas/meteofrance_44020001_horaire.csv', { cache: 'no-store' });
    if (!r.ok) { var j = null; try { j = await r.json(); } catch (e) { /* rien */ } throw new Error(j && j.erreur ? j.erreur : 'HTTP ' + r.status); }
    var src = decodeURIComponent(r.headers.get('X-Atlas-Source') || 'atlas');
    MES.use(await r.text(), src);
    return src;
  };

  // ---------------------------------------------------------------- interface
  function info(t, cls) { var el = $('ep-info'); if (el) { el.textContent = t; el.className = 'status' + (cls ? ' ' + cls : ''); } }
  function preset() { return MES.PRESETS[($('ep-kind') || {}).value] || MES.PRESETS.canicule; }
  function refreshList() {
    var sel = $('ep-list'); if (!sel) return;
    var p = preset(), sn = parseFloat(($('ep-sn').value || '').replace(',', '.')), sx = parseFloat(($('ep-sx').value || '').replace(',', '.'));
    if (!isFinite(sn)) sn = p.sn; if (!isFinite(sx)) sx = p.sx;
    MES.list = MES.detect(p.kind, sn, sx);
    sel.innerHTML = MES.list.map(function (e, i) { return '<option value="' + i + '">' + MES.label(e) + '</option>'; }).join('') ||
      '<option disabled>Aucun épisode avec ces seuils</option>';
    if (MES.list.length) sel.selectedIndex = 0;
    $('ep-run').disabled = !MES.list.length;
  }
  function loaded(src) {
    var sp = MES.span();
    info('Mesures chargées (' + src + ') : du ' + MES.dateTxt(sp[0]) + ' au ' + MES.dateTxt(sp[1]) + '.', 'ok');
    $('ep-controls').hidden = false; refreshList();
  }
  MES.init = function () {
    if (!$('ep-section')) return;
    var k = $('ep-kind');
    function setSeuils() { var p = preset(); $('ep-sn').value = p.sn; $('ep-sx').value = p.sx; $('ep-note').textContent = (p.kind === 'chaud' ? 'Chaud : moyennes sur 3 jours des minimales ≥ min et des maximales ≥ max' : 'Froid : moyennes sur 3 jours des minimales ≤ min et des maximales ≤ max') + ' (' + p.note + ').'; }
    k.addEventListener('change', function () { setSeuils(); if (MES.days) refreshList(); });
    ['ep-sn', 'ep-sx'].forEach(function (id) { $(id).addEventListener('change', function () { if (MES.days) refreshList(); }); });
    setSeuils();
    $('ep-load').addEventListener('click', function () {
      info('Lecture des mesures de l\'atlas…');
      MES.loadAtlas().then(loaded).catch(function (e) { info('Atlas injoignable (' + e.message + '). Ouvrez CL-WIND par le composant CL-WIND Live de Grasshopper, ou choisissez le fichier CSV de l\'atlas.', 'err'); });
    });
    $('ep-file').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () { try { MES.use(rd.result, 'fichier ' + f.name); loaded('fichier ' + f.name); } catch (er) { info(er.message, 'err'); } };
      rd.readAsText(f);
    });
    $('ep-typical').addEventListener('click', function () { if (CLW.EPW.restoreTypical()) info('Retour à l\'année type (fichier EPW).', 'ok'); });
    $('ep-run').addEventListener('click', function () {
      var e = MES.list[+$('ep-list').value]; if (!e || !CLW.Thermal || !CLW.Thermal.runEpisode) return;
      var y = MES.apply(e.peak); if (!y) return;
      var D = new Date(e.peak); CLW.Sun.set({ m: D.getUTCMonth() + 1, d: D.getUTCDate(), t: e.kind === 'chaud' ? 15 : 7 });
      var cv = $('ep-chart'), sm = $('ep-sum');
      if (!CLW.Thermal.runEpisode(e, function () { CLW.Thermal.drawEpisode(cv); if (sm) sm.innerHTML = CLW.Thermal.episodeHtml(); })) { if (sm) sm.textContent = 'Calcul impossible : il faut une géométrie (envoi de Grasshopper) et un fichier météo.'; return; }
      var tick = setInterval(function () { CLW.Thermal.drawEpisode(cv); if (!CLW.Thermal.episodeState.running) clearInterval(tick); }, 400);
    });
    // chargement automatique quand la page est servie par le composant (relais vers l'atlas)
    if (/^https?:$/.test(location.protocol)) fetch('live/ping', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j && j.clwind && j.version >= 15) MES.loadAtlas().then(loaded).catch(function () { info('Cliquez sur « Charger les mesures de l\'atlas » (atlas éteint ?) ou choisissez le CSV.'); });
    }).catch(function () { /* page servie autrement */ });
  };
  MES.shortTxt = shortTxt;
})(window);
