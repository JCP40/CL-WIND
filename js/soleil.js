/* Analyse du vent - soleil.js
 * Soleil : position (date, heure), solstices et équinoxes, journées types du fichier EPW,
 * vue 3D du modèle seul sur un sol avec ombres portées (WebGL, carte d'ombre), courses du soleil,
 * coupe solaire avec rayons schématiques selon la hauteur du soleil.
 * Heure : heure locale normale du fichier EPW (UTC + 1 à Nantes, sans l'heure d'été).
 * Repère du plan : x est, y nord, z vertical. Azimut compté depuis le nord, sens horaire.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var SUN = CLW.Sun = {};
  var MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  var MDAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  var RAD = Math.PI / 180;
  SUN.MONTHS = MONTHS;
  function $(id) { return document.getElementById(id); }
  function fmt(v, d) { return CLW.fmt ? CLW.fmt(v, d) : v.toFixed(d); }
  function doy(m, d) { var n = d; for (var i = 0; i < m - 1; i++) n += MDAYS[i]; return n; }
  function fromDoy(n) { var m = 1; n = Math.max(1, Math.min(365, Math.round(n))); while (m < 12 && n > MDAYS[m - 1]) { n -= MDAYS[m - 1]; m++; } return { m: m, d: n }; }
  SUN.doy = doy; SUN.fromDoy = fromDoy;
  function hhmm(t) { t = ((t % 24) + 24) % 24; var h = Math.floor(t), mn = Math.round((t - h) * 60); if (mn === 60) { h = (h + 1) % 24; mn = 0; } return h + ' h ' + (mn < 10 ? '0' : '') + mn; }
  SUN.hhmm = hhmm;
  function dateTxt(m, d) { return d + (d === 1 ? 'er' : '') + ' ' + MONTHS[m - 1]; }
  SUN.dateTxt = dateTxt;
  function compass(az) { var n = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO']; return n[Math.round(az / 22.5) % 16]; }

  // ---------------------------------------------------------------- position du soleil (formules NOAA)
  SUN.site = function () {
    var D = CLW.EPW && CLW.EPW.data && CLW.EPW.data(), L = D && D.location;
    return { lat: L && isFinite(L.lat) ? L.lat : 47.15, lon: L && isFinite(L.lon) ? L.lon : -1.6089, tz: L && isFinite(L.tz) ? L.tz : 1 };
  };
  // n : jour de l'année (1 à 365), t : heure locale normale (0 à 24)
  SUN.pos = function (n, t, site) {
    site = site || SUN.site();
    var g = 2 * Math.PI / 365 * (n - 1 + (t - 12) / 24);
    var eot = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
    var decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
    var corr = eot + 4 * site.lon - 60 * site.tz, tst = t * 60 + corr, ha = (tst / 4 - 180) * RAD, lat = site.lat * RAD;
    var cz = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
    var alt = Math.asin(Math.max(-1, Math.min(1, cz)));
    var az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) / RAD + 180;
    var a = alt / RAD;
    // réfraction atmosphérique (sensible près de l'horizon)
    if (a > -1) a += 1.02 / Math.tan((a + 10.3 / (a + 5.11)) * RAD) / 60;
    return { alt: a, az: (az + 360) % 360, decl: decl / RAD, noon: 12 - corr / 60 };
  };
  // direction vers le soleil (x est, y nord, z haut)
  function sunVec(p) { var ca = Math.cos(p.alt * RAD); return [ca * Math.sin(p.az * RAD), ca * Math.cos(p.az * RAD), Math.sin(p.alt * RAD)]; }
  SUN.vec = sunVec;
  SUN.dayInfo = function (n, site) {
    site = site || SUN.site();
    var up = null, down = null, prev = SUN.pos(n, 0, site).alt;
    for (var t = 1 / 60; t <= 24; t += 1 / 60) {
      var a = SUN.pos(n, t, site).alt;
      if (prev < -0.833 && a >= -0.833 && up == null) up = t;
      if (prev >= -0.833 && a < -0.833) down = t;
      prev = a;
    }
    var noon = SUN.pos(n, 12, site).noon, pn = SUN.pos(n, noon, site);
    return { rise: up, set: down, noon: noon, altNoon: pn.alt, length: up != null && down != null ? down - up : (pn.alt > 0 ? 24 : 0) };
  };

  // ---------------------------------------------------------------- journées remarquables
  // solstices et équinoxes (dates moyennes), journées extrêmes et types du fichier EPW
  SUN.keyDays = function () {
    var out = [
      { id: 'sol-ete', label: 'Solstice d\'été', m: 6, d: 21, t: 13, astro: true },
      { id: 'eq-print', label: 'Équinoxe de printemps', m: 3, d: 20, t: 13, astro: true },
      { id: 'eq-aut', label: 'Équinoxe d\'automne', m: 9, d: 22, t: 13, astro: true },
      { id: 'sol-hiv', label: 'Solstice d\'hiver', m: 12, d: 21, t: 13, astro: true }
    ];
    var D = CLW.EPW && CLW.EPW.data && CLW.EPW.data(), HR = D && D.hourly;
    if (!HR) return out;
    function stat(n) { var mx = -99, mn = 99, s = 0; for (var h = 0; h < 24; h++) { var v = HR.T[(n - 1) * 24 + h]; mx = Math.max(mx, v); mn = Math.min(mn, v); s += v; } return { max: mx, min: mn, mean: s / 24 }; }
    var hot = 1, cold = 1, bh = -99, bc = 99;
    for (var n = 1; n <= 365; n++) { var st = stat(n); if (st.max > bh) { bh = st.max; hot = n; } if (st.min < bc) { bc = st.min; cold = n; } }
    // semaine type : jour dont la moyenne est la plus proche de la moyenne de la semaine
    function typical(re) {
      var P = (D.periods || []).filter(function (p) { return re.test(p.name) && /typical/i.test(p.kind); })[0];
      if (!P) return null;
      var a = doy(P.a[0], P.a[1]), b = doy(P.b[0], P.b[1]); if (b < a) b += 365;
      var mean = 0, k; for (k = a; k <= b; k++) mean += stat((k - 1) % 365 + 1).mean; mean /= (b - a + 1);
      var best = a, be = 99; for (k = a; k <= b; k++) { var e = Math.abs(stat((k - 1) % 365 + 1).mean - mean); if (e < be) { be = e; best = (k - 1) % 365 + 1; } }
      return best;
    }
    var ts = typical(/^summer/i), tw = typical(/^winter/i);
    function add(id, label, n, t) { var md = fromDoy(n), st2 = stat(n); out.push({ id: id, label: label, m: md.m, d: md.d, t: t, epw: true, tmax: st2.max, tmin: st2.min, tmean: st2.mean }); }
    add('chaud', 'Jour le plus chaud', hot, 15);
    add('froid', 'Jour le plus froid', cold, 8);
    if (ts) add('ete-type', 'Été type (moyenne)', ts, 15);
    if (tw) add('hiver-type', 'Hiver type (moyenne)', tw, 13);
    return out;
  };
  // valeur horaire EPW à l'heure t du jour n (température interpolée, rayonnement de l'heure en cours)
  SUN.epwAt = function (n, t) {
    var D = CLW.EPW && CLW.EPW.data && CLW.EPW.data(), HR = D && D.hourly; if (!HR) return null;
    var i0 = (n - 1) * 24, f = t - Math.floor(t), h = Math.floor(t);
    function T(k) { var q = i0 + k - 1; q = (q % 8760 + 8760) % 8760; return HR.T[q]; } // valeur à l'heure ronde k (fin de l'heure k)
    var ir = Math.min(8759, i0 + Math.min(23, h));
    return { T: T(h) * (1 - f) + T(h + 1) * f, RH: HR.RH[ir], GHI: HR.GHI[ir], DNI: HR.DNI[ir], DHI: HR.DHI[ir], ws: HR.ws[ir], wd: HR.wd[ir] };
  };

  // ---------------------------------------------------------------- état et interface
  // cut : 'sun' (la coupe suit le soleil), 'fixe' (azimut cutAz choisi, ne bouge pas), 'ns' (sud → nord), 'trait' (outil Coupe)
  // cutDx, cutDy : décalage (m) du centre de la coupe par rapport au centre du bâtiment
  var ST = SUN.state = { m: 6, d: 21, t: 13, cut: 'ns', cutAz: 180, cutDx: 0, cutDy: 0, paths: true, play: false };
  var listeners = [];
  SUN.onChange = function (cb) { listeners.push(cb); };
  SUN.n = function () { return doy(ST.m, ST.d); };
  SUN.current = function () { return SUN.pos(SUN.n(), ST.t); };
  SUN.set = function (o, quiet) {
    if (o.m != null) ST.m = Math.max(1, Math.min(12, o.m | 0));
    if (o.d != null) ST.d = Math.max(1, Math.min(MDAYS[ST.m - 1], o.d | 0));
    else ST.d = Math.min(ST.d, MDAYS[ST.m - 1]);
    if (o.t != null) ST.t = Math.max(0, Math.min(24, o.t));
    if (o.cut) ST.cut = o.cut;
    if (o.cutAz != null) ST.cutAz = ((Math.round(o.cutAz) % 360) + 360) % 360;
    if (o.cutDx != null && isFinite(o.cutDx)) ST.cutDx = o.cutDx;
    if (o.cutDy != null && isFinite(o.cutDy)) ST.cutDy = o.cutDy;
    try { localStorage.setItem('clwind-sun', JSON.stringify({ m: ST.m, d: ST.d, t: ST.t, cut: ST.cut, cutAz: ST.cutAz, cutDx: ST.cutDx, cutDy: ST.cutDy, paths: ST.paths })); } catch (e) { /* rien */ }
    syncUI(); needs = true; cutDirty = true;
    if (!quiet) listeners.forEach(function (cb) { try { cb(ST); } catch (e) { console.error(e); } });
  };
  function syncUI() {
    if (!$('sun-m')) return;
    $('sun-m').value = ST.m; $('sun-d').value = ST.d; $('sun-d').max = MDAYS[ST.m - 1];
    $('sun-t').value = ST.t; $('sunb-t').value = ST.t;
    // interrupteur de la coupe (barre de la vue Soleil) : suit le soleil / fixe
    if ($('sun-cut')) $('sun-cut').value = ST.cut;
    if ($('sunb-cut')) {
      [].forEach.call($('sunb-cut').querySelectorAll('button'), function (b) { b.classList.toggle('on', b.dataset.c === (ST.cut === 'sun' ? 'sun' : ST.cut === 'trait' ? 'trait' : 'fixe')); });
      var azl = $('sunb-az-l'); if (azl) azl.hidden = ST.cut === 'sun' || ST.cut === 'trait';
      if ($('sunb-az') && document.activeElement !== $('sunb-az')) $('sunb-az').value = ST.cut === 'ns' ? 180 : ST.cutAz;
    }
    [['scx', ST.cutDx], ['scy', ST.cutDy], ['sca', ST.cut === 'ns' ? 180 : ST.cut === 'sun' ? Math.round(SUN.current().az) : ST.cutAz]].forEach(function (k) { var el = $(k[0]); if (el && document.activeElement !== el) el.value = Math.round(k[1] * 100) / 100; });
    var sca = $('sca'); if (sca) sca.disabled = ST.cut === 'sun' || ST.cut === 'trait';
    document.querySelectorAll('#sun-quick [data-q]').forEach(function (b) { b.classList.toggle('on', (b.dataset.q === 'cut-ns' && (ST.cut === 'ns' || (ST.cut === 'fixe' && ST.cutAz === 180))) || (b.dataset.q === 'cut-eo' && ST.cut === 'fixe' && ST.cutAz === 90)); });
    var p = SUN.current(), n = SUN.n(), di = SUN.dayInfo(n), ete = ST.m >= 4 && ST.m <= 10;
    var hTxt = hhmm(ST.t) + (ete ? ' (' + hhmm(ST.t + 1) + ' à l\'heure d\'été)' : '');
    $('sun-t-o').textContent = hhmm(ST.t);
    $('sunb-date').textContent = dateTxt(ST.m, ST.d) + ' · ' + hhmm(ST.t);
    var e = SUN.epwAt(n, ST.t), ev = '';
    if (e) ev = '<div class="bil-row"><span>Air extérieur (EPW)</span><b>' + fmt(e.T, 1) + ' °C, HR ' + fmt(e.RH, 0) + ' %</b></div>' +
      '<div class="bil-row"><span>Rayonnement global</span><b>' + fmt(e.GHI, 0) + ' W/m²</b></div>' +
      '<div class="bil-row sub"><span>direct normal, diffus</span><span>' + fmt(e.DNI, 0) + ', ' + fmt(e.DHI, 0) + ' W/m²</span></div>';
    $('sun-info').innerHTML =
      '<div class="bil-row"><span>' + dateTxt(ST.m, ST.d) + '</span><b>' + hTxt + '</b></div>' +
      (p.alt > 0 ? '<div class="bil-row"><span>Hauteur du soleil</span><b>' + fmt(p.alt, 1) + '°</b></div>' +
        '<div class="bil-row"><span>Azimut</span><b>' + fmt(p.az, 0) + '° (' + compass(p.az) + ')</b></div>'
        : '<div class="bil-row"><span>Soleil</span><b>sous l\'horizon</b></div>') +
      '<div class="bil-row sub"><span>Lever, coucher</span><span>' + (di.rise != null ? hhmm(di.rise) : '–') + ', ' + (di.set != null ? hhmm(di.set) : '–') + ' (jour ' + fmt(di.length, 1) + ' h)</span></div>' +
      '<div class="bil-row sub"><span>Midi solaire</span><span>' + hhmm(di.noon) + ', hauteur ' + fmt(di.altNoon, 1) + '°</span></div>' + ev;
    document.querySelectorAll('#sun-presets button').forEach(function (b) { b.classList.toggle('on', +b.dataset.m === ST.m && +b.dataset.d === ST.d); });
  }
  function buildPresets() {
    var box = $('sun-presets'); if (!box) return;
    var kd = SUN.keyDays();
    box.innerHTML = kd.map(function (k) {
      return '<button data-m="' + k.m + '" data-d="' + k.d + '" data-t="' + k.t + '" title="' + dateTxt(k.m, k.d) +
        (k.epw ? ', Tmin ' + fmt(k.tmin, 1) + ' °C, Tmax ' + fmt(k.tmax, 1) + ' °C (fichier EPW)' : '') + '">' + k.label + '<small>' + dateTxt(k.m, k.d) + '</small></button>';
    }).join('');
    box.querySelectorAll('button').forEach(function (b) { b.onclick = function () { SUN.set({ m: +b.dataset.m, d: +b.dataset.d, t: +b.dataset.t }); }; });
    syncUI();
  }
  SUN.epwChanged = function () { buildPresets(); listeners.forEach(function (cb) { try { cb(ST); } catch (e) { console.error(e); } }); };
  var playT = 0;
  function togglePlay(on) {
    ST.play = on != null ? on : !ST.play;
    ['sun-play', 'sunb-play'].forEach(function (id) { var b = $(id); if (b) { b.textContent = ST.play ? '❚❚' + (id === 'sun-play' ? ' Arrêter' : '') : '▶' + (id === 'sun-play' ? ' Animer la journée' : ''); } });
    if (ST.play) { var di = SUN.dayInfo(SUN.n()); if (ST.t >= (di.set || 20) - 0.05 || ST.t < (di.rise || 5)) SUN.set({ t: Math.floor(di.rise || 5) }); playT = performance.now(); }
  }
  SUN.init = function () {
    try { var sv = JSON.parse(localStorage.getItem('clwind-sun') || 'null'); if (sv) { ST.m = sv.m || 6; ST.d = sv.d || 21; ST.t = sv.t != null ? sv.t : 13; ST.cut = sv.cut || 'ns'; ST.cutAz = sv.cutAz != null ? sv.cutAz : 180; ST.cutDx = +sv.cutDx || 0; ST.cutDy = +sv.cutDy || 0; ST.paths = sv.paths !== false; } } catch (e) { /* rien */ }
    $('sun-m').innerHTML = MONTHS.map(function (m, i) { return '<option value="' + (i + 1) + '">' + m + '</option>'; }).join('');
    $('sun-m').addEventListener('change', function () { SUN.set({ m: +$('sun-m').value }); });
    $('sun-d').addEventListener('change', function () { SUN.set({ d: +$('sun-d').value }); });
    ['sun-t', 'sunb-t'].forEach(function (id) { $(id).addEventListener('input', function () { SUN.set({ t: +$(id).value }); }); });
    $('sun-play').onclick = function () { togglePlay(); };
    $('sunb-play').onclick = function () { togglePlay(); };
    $('sun-cut').value = ST.cut;
    $('sun-cut').addEventListener('change', function () { ST.cut = $('sun-cut').value; SUN.set({}); });
    // barre de la vue Soleil : la coupe suit le soleil ou reste fixe (azimut au choix, repris du soleil du moment au passage)
    if ($('sunb-cut')) {
      [].forEach.call($('sunb-cut').querySelectorAll('button'), function (b) {
        b.addEventListener('click', function () {
          var c = b.dataset.c;
          if (c === 'fixe') { if (ST.cut === 'sun') { var pp = SUN.current(); if (pp.alt > 0) ST.cutAz = ((Math.round(pp.az / 5) * 5) % 360 + 360) % 360; } else if (ST.cut === 'ns') ST.cutAz = 180; ST.cut = 'fixe'; }
          else ST.cut = c;
          SUN.set({});
        });
      });
      $('sunb-az').addEventListener('change', function () { var v = +$('sunb-az').value; if (isFinite(v)) { ST.cut = 'fixe'; SUN.set({ cutAz: v }); } });
    }
    $('sun-paths').checked = ST.paths;
    $('sun-paths').addEventListener('change', function () { ST.paths = $('sun-paths').checked; SUN.set({}); });
    $('sunb-prev').onclick = function () { var md = fromDoy(SUN.n() - 1 < 1 ? 365 : SUN.n() - 1); SUN.set(md); };
    $('sunb-next').onclick = function () { var md = fromDoy(SUN.n() + 1 > 365 ? 1 : SUN.n() + 1); SUN.set(md); };
    buildPresets();
    window.addEventListener('resize', function () { needs = true; cutDirty = true; });
  };

  // ---------------------------------------------------------------- modèle (maillages Grasshopper ou objets du plan extrudés)
  function earcut(pts) { // triangulation par oreilles d'un polygone simple, renvoie des indices
    var n = pts.length, idx = [], tri = [], i;
    for (i = 0; i < n; i++) idx.push(i);
    var area = 0; for (i = 0; i < n; i++) { var p = pts[i], q = pts[(i + 1) % n]; area += p[0] * q[1] - q[0] * p[1]; }
    if (area < 0) idx.reverse();
    function cr(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
    var guard = 0;
    while (idx.length > 3 && guard++ < 5000) {
      var found = false;
      for (i = 0; i < idx.length; i++) {
        var a = pts[idx[(i + idx.length - 1) % idx.length]], b = pts[idx[i]], c = pts[idx[(i + 1) % idx.length]];
        if (cr(a, b, c) <= 1e-12) continue;
        var inside = false;
        for (var k = 0; k < idx.length && !inside; k++) {
          var pp = pts[idx[k]]; if (pp === a || pp === b || pp === c) continue;
          if (cr(a, b, pp) >= 0 && cr(b, c, pp) >= 0 && cr(c, a, pp) >= 0) inside = true;
        }
        if (inside) continue;
        tri.push(idx[(i + idx.length - 1) % idx.length], idx[i], idx[(i + 1) % idx.length]); idx.splice(i, 1); found = true; break;
      }
      if (!found) break;
    }
    if (idx.length === 3) tri.push(idx[0], idx[1], idx[2]);
    return tri;
  }
  function objMeshes() {
    var S = CLW.state, live = CLW.Live && CLW.Live.active ? CLW.Live : null, m3 = live && live.last && live.last.mesh3d;
    var org = live && live.origin ? live.origin : [0, 0], out = { vol: [], scr: [] };
    function shift(m) { var v = m[0], o = new Float32Array(v.length); for (var i = 0; i < v.length; i += 3) { o[i] = v[i] - org[0]; o[i + 1] = v[i + 1] - org[1]; o[i + 2] = v[i + 2]; } return { v: o, f: m[1] }; }
    if (m3) { (m3.volumes || []).forEach(function (m) { out.vol.push(shift(m)); }); (m3.ecrans || []).forEach(function (m) { out.scr.push(shift(m)); }); }
    (S.objects || []).forEach(function (x) {
      if (m3 && x.src === 'live' && x.type !== 'tree') return;
      if (x.type === 'tree' && x.z1 != null) { out.vol.push(column(x.x, x.y, x.z0, x.z1, x.r)); return; }
      var ring = null, h = 0;
      if (x.type === 'building') { ring = x.outer; h = x.screen ? 2.5 : (x.height || 6); }
      else if (x.type === 'wall' && x.pts && x.pts.length > 1) { // mur : bande de 30 cm
        var t = (x.thick || 0.3) / 2, L = [], R = [];
        for (var s = 0; s < x.pts.length; s++) {
          var a = x.pts[Math.max(0, s - 1)], b = x.pts[Math.min(x.pts.length - 1, s + 1)], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
          L.push([x.pts[s][0] - dy / l * t, x.pts[s][1] + dx / l * t]); R.unshift([x.pts[s][0] + dy / l * t, x.pts[s][1] - dx / l * t]);
        }
        ring = L.concat(R); h = 2;
      } else if (x.type === 'tree') { var zt = x.zc != null ? x.zc : Math.max(3, x.r + 1), vzt = x.rz != null ? x.rz : x.r; out.vol.push(sphere(x.x, x.y, zt, x.r, true, vzt)); out.vol.push(trunk(x.x, x.y, zt - vzt * 0.5)); return; }
      if (!ring || ring.length < 3 || !(h > 0)) return;
      var n = ring.length, v = [], f = [];
      ring.forEach(function (p) { v.push(p[0], p[1], 0); }); ring.forEach(function (p) { v.push(p[0], p[1], h); });
      for (var k = 0; k < n; k++) { var k2 = (k + 1) % n; f.push(k, k2, n + k2, k, n + k2, n + k); }
      var tr = earcut(ring); for (var q = 0; q < tr.length; q += 3) f.push(n + tr[q], n + tr[q + 1], n + tr[q + 2], tr[q], tr[q + 2], tr[q + 1]);
      (x.screen ? out.scr : out.vol).push({ v: new Float32Array(v), f: f });
    });
    return out;
  }
  function sphere(cx, cy, cz, r, tree, rz) {
    var v = [], f = [], NU = 14, NV = 8; rz = rz || r; // rz : demi-hauteur (houppier en ellipsoïde)
    for (var j = 0; j <= NV; j++) for (var i = 0; i <= NU; i++) {
      var th = j / NV * Math.PI, ph = i / NU * 2 * Math.PI;
      v.push(cx + r * Math.sin(th) * Math.cos(ph), cy + r * Math.sin(th) * Math.sin(ph), cz + rz * Math.cos(th));
    }
    for (j = 0; j < NV; j++) for (i = 0; i < NU; i++) { var a = j * (NU + 1) + i, b = a + NU + 1; f.push(a, b, a + 1, a + 1, b, b + 1); }
    return { v: new Float32Array(v), f: f, tree: !!tree };
  }
  // plante grimpante : colonne octogonale de feuillage entre z0 et z1
  function column(cx, cy, z0, z1, r) {
    var v = [], f = [], n = 8;
    for (var i = 0; i < n; i++) { var a = i / n * 2 * Math.PI; v.push(cx + r * Math.cos(a), cy + r * Math.sin(a), z0, cx + r * Math.cos(a), cy + r * Math.sin(a), z1); }
    for (i = 0; i < n; i++) { var i2 = (i + 1) % n; f.push(2 * i, 2 * i2, 2 * i2 + 1, 2 * i, 2 * i2 + 1, 2 * i + 1); }
    for (i = 1; i < n - 1; i++) f.push(0, 2 * (i + 1), 2 * i, 1, 2 * i + 1, 2 * (i + 1) + 1);
    return { v: new Float32Array(v), f: f, tree: true };
  }
  // maillages d'une scène reçue et gardée (géométrie d'une saison) : mêmes conventions que SUN.meshes()
  var sCache = { key: null, out: null };
  SUN.meshesOf = function (d) {
    var org = CLW.Live && CLW.Live.origin ? CLW.Live.origin : [0, 0], key = (d && d.rev) + '|' + org.join(',') + '|' + (d && d.saison);
    if (!d) return null;
    if (sCache[key]) return sCache[key];
    var out = { vol: [], scr: [] }, m3 = d.mesh3d;
    function shift(m) { var v = m[0], o = new Float32Array(v.length); for (var i = 0; i < v.length; i += 3) { o[i] = v[i] - org[0]; o[i + 1] = v[i + 1] - org[1]; o[i + 2] = v[i + 2]; } return { v: o, f: m[1] }; }
    if (m3) { (m3.volumes || []).forEach(function (m) { out.vol.push(shift(m)); }); (m3.ecrans || []).forEach(function (m) { out.scr.push(shift(m)); }); }
    (d.trees || []).forEach(function (t) {
      if (t.z1 != null) out.vol.push(column(t.x - org[0], t.y - org[1], t.z0, t.z1, t.r));
      else { var zt = t.zc != null ? t.zc : Math.max(3, t.r + 1), vzt = t.rz != null ? t.rz : t.r; out.vol.push(sphere(t.x - org[0], t.y - org[1], zt, t.r, true, vzt)); out.vol.push(trunk(t.x - org[0], t.y - org[1], zt - vzt * 0.5)); }
    });
    sCache = {}; sCache[key] = out;
    return out;
  };
  function trunk(cx, cy, h) {
    var v = [], f = [], n = 8, r = 0.18;
    for (var i = 0; i < n; i++) { var a = i / n * 2 * Math.PI; v.push(cx + r * Math.cos(a), cy + r * Math.sin(a), 0, cx + r * Math.cos(a), cy + r * Math.sin(a), h); }
    for (i = 0; i < n; i++) { var i2 = (i + 1) % n; f.push(2 * i, 2 * i2, 2 * i2 + 1, 2 * i, 2 * i2 + 1, 2 * i + 1); }
    return { v: new Float32Array(v), f: f };
  }
  var mKey = null, mCache = null;
  SUN.meshes = function () { var k = sceneKey(); if (k !== mKey) { mCache = objMeshes(); mKey = k; } return mCache; };
  SUN.sceneKey = function () { return sceneKey(); };
  function sceneKey() {
    var S = CLW.state, live = CLW.Live;
    return (live && live.active ? live.rev + '|' + (live.origin || []).join(',') : '-') + '|' + (S.objects || []).map(function (o) {
      return o.id + ':' + (o.height || '') + ':' + (o.screen ? 1 : 0) + ':' + (o.outer ? o.outer.length + ',' + o.outer[0] : o.pts ? o.pts.length + ',' + o.pts[0] : [o.x, o.y, o.r].join(','));
    }).join(';');
  }

  // ---------------------------------------------------------------- WebGL
  var cv, gl, lab, P = {}, scene = null, skey = null, needs = true, shadow = null, failed = false;
  var cam = { yaw: -0.5, pitch: 0.55, dist: 30, tx: 0, ty: 0, tz: 1.5 }, camSet = false, camR = 0, lastM = null; // camR : taille de la scène au dernier cadrage (recadrage si elle change beaucoup)
  function persp(fovy, asp, n, f) { var t = 1 / Math.tan(fovy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; }
  function ortho(l, r, b, t, n, f) { return [2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (f - n), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(f + n) / (f - n), 1]; }
  function lookAt(e, c, u) {
    var z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(u, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  }
  function mul(a, b) { var o = new Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) { var l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
  function project(M, p) {
    var x = M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12], y = M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13], w = M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15];
    if (w <= 1e-6) return null;
    return [(x / w * 0.5 + 0.5) * cv.width, (0.5 - y / w * 0.5) * cv.height];
  }
  function prog(vs, fs) {
    function sh(t, src) { var s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  function buf(data) { var b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); return b; }
  function clearAttrs() { for (var i = 0; i < 8; i++) gl.disableVertexAttribArray(i); }
  function attr(p, name, b, size) { var l = gl.getAttribLocation(p, name); if (l < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, 0, 0); }
  function U(p, n) { return gl.getUniformLocation(p, n); }
  var SM = 2048;
  function init() {
    cv = $('sun3d'); lab = $('sun-lab');
    gl = cv.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) { failed = true; return false; }
    P.depth = prog('attribute vec3 p; uniform mat4 L; void main(){ gl_Position = L * vec4(p, 1.0); }',
      'precision highp float; void main(){ vec4 e = fract(vec4(1.0, 255.0, 65025.0, 16581375.0) * gl_FragCoord.z); e -= e.yzww * vec4(1.0/255.0, 1.0/255.0, 1.0/255.0, 0.0); gl_FragColor = e; }');
    P.mesh = prog(
      'attribute vec3 p; attribute vec3 n; attribute vec4 c; uniform mat4 M; uniform mat4 L; varying vec3 vn; varying vec4 vc; varying vec4 vl; varying vec3 vp;' +
      'void main(){ gl_Position = M * vec4(p, 1.0); vn = n; vc = c; vl = L * vec4(p, 1.0); vp = p; }',
      'precision highp float; varying vec3 vn; varying vec4 vc; varying vec4 vl; varying vec3 vp;' +
      'uniform sampler2D SMap; uniform vec3 SD; uniform float SUNI; uniform float AMB; uniform float TS; uniform float BIAS; uniform vec3 EYE;' +
      'float unpack(vec4 c){ return dot(c, vec4(1.0, 1.0/255.0, 1.0/65025.0, 1.0/16581375.0)); }' +
      'void main(){ vec3 N = normalize(vn); if (dot(N, EYE - vp) < 0.0) N = -N;' +
      ' float ndl = dot(N, SD); float lit = 0.0;' +
      ' if (SUNI > 0.0 && ndl > 0.0) { vec3 q = vl.xyz / vl.w * 0.5 + 0.5;' +
      '  if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 || q.z > 1.0) lit = 1.0; else {' +
      '   float b = BIAS * (1.0 + 4.0 * (1.0 - ndl));' +
      '   for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) { float d = unpack(texture2D(SMap, q.xy + vec2(float(i), float(j)) * TS)); lit += (q.z - b > d) ? 0.0 : 1.0; }' +
      '   lit /= 9.0; } }' +
      ' float sky = AMB * (0.75 + 0.25 * N.z);' +
      ' vec3 col = vc.rgb * (sky + SUNI * max(ndl, 0.0) * lit) + vec3(1.0, 0.85, 0.4) * 0.06 * SUNI * lit * max(ndl, 0.0);' +
      ' gl_FragColor = vec4(col, vc.a); }');
    P.line = prog('attribute vec3 p; attribute vec4 c; uniform mat4 M; varying vec4 vc; void main(){ gl_Position = M * vec4(p, 1.0); vc = c; }',
      'precision mediump float; varying vec4 vc; void main(){ gl_FragColor = vc; }');
    // carte d'ombre
    var tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SM, SM, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var rb = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, rb); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, SM, SM);
    var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    shadow = { tex: tex, fb: fb }; SUN._dbg = { gl: gl, shadow: shadow, P: P };
    // souris
    var drag = null;
    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    cv.addEventListener('mousedown', function (e) { drag = { x: e.clientX, y: e.clientY, b: e.button, cam: Object.assign({}, cam) }; e.preventDefault(); });
    window.addEventListener('mousemove', function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (drag.b === 0) { cam.yaw = drag.cam.yaw - dx * 0.006; cam.pitch = Math.max(-0.05, Math.min(1.55, drag.cam.pitch + dy * 0.005)); }
      else { var s = cam.dist * 0.0015, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw); cam.tx = drag.cam.tx - (dx * cy + dy * sy) * s; cam.ty = drag.cam.ty - (dx * sy - dy * cy) * s; }
      needs = true;
    });
    window.addEventListener('mouseup', function () { drag = null; });
    cv.addEventListener('wheel', function (e) { e.preventDefault(); cam.dist = Math.max(1, Math.min(3000, cam.dist * Math.exp(e.deltaY * 0.0012))); needs = true; }, { passive: false });
    cv.addEventListener('dblclick', function () { camSet = false; needs = true; });
    return true;
  }
  var COL = { vol: [0.86, 0.87, 0.89, 1], scr: [0.80, 0.46, 0.30, 1], tree: [0.36, 0.55, 0.32, 1], ground: [0.84, 0.82, 0.76, 1] };
  // centre du bâtiment : milieu de l'emprise des parois (briques, lames, écrans), sans les arbres ni les plantes ;
  // à défaut, celui des volumes. Le toit débordant ou les arbres ne décalent donc pas la coupe.
  function buildingCenter(M) {
    function bbOf(list) {
      var b = [Infinity, Infinity, -Infinity, -Infinity], n = 0;
      list.forEach(function (m) { if (m.tree) return; var v = m.v; for (var i = 0; i < v.length; i += 3) { b[0] = Math.min(b[0], v[i]); b[1] = Math.min(b[1], v[i + 1]); b[2] = Math.max(b[2], v[i]); b[3] = Math.max(b[3], v[i + 1]); n++; } });
      return n ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2, Math.max(b[2] - b[0], b[3] - b[1])] : null;
    }
    return bbOf(M.scr) || bbOf(M.vol) || [0, 0, 10];
  }
  var bcKey = null, bcVal = null;
  SUN.buildingCenter = function () {
    var k = SUN.sceneKey ? SUN.sceneKey() : ''; if (k === bcKey && bcVal) return bcVal;
    try { bcVal = buildingCenter(SUN.meshes()); bcKey = k; } catch (e) { bcVal = null; }
    return bcVal;
  };
  function buildScene() {
    var M = SUN.meshes(), p = [], n = [], c = [];
    var bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], ntri = 0;
    function add(list, col) {
      list.forEach(function (m) {
        var v = m.v, f = m.f, cc = m.tree ? COL.tree : col;
        for (var t = 0; t < f.length; t += 3) {
          var a = 3 * f[t], b = 3 * f[t + 1], d = 3 * f[t + 2];
          var e1 = [v[b] - v[a], v[b + 1] - v[a + 1], v[b + 2] - v[a + 2]], e2 = [v[d] - v[a], v[d + 1] - v[a + 1], v[d + 2] - v[a + 2]], nn = norm(cross(e1, e2));
          [a, b, d].forEach(function (q) {
            p.push(v[q], v[q + 1], v[q + 2]); n.push(nn[0], nn[1], nn[2]); c.push(cc[0], cc[1], cc[2], cc[3]);
            bb[0] = Math.min(bb[0], v[q]); bb[1] = Math.min(bb[1], v[q + 1]); bb[2] = Math.min(bb[2], v[q + 2]);
            bb[3] = Math.max(bb[3], v[q]); bb[4] = Math.max(bb[4], v[q + 1]); bb[5] = Math.max(bb[5], v[q + 2]);
          });
          ntri++;
        }
      });
    }
    add(M.vol, COL.vol); add(M.scr, COL.scr);
    if (!ntri) bb = [-5, -5, 0, 5, 5, 3];
    var cx = (bb[0] + bb[3]) / 2, cy = (bb[1] + bb[4]) / 2, R = Math.max(2, 0.5 * Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - Math.min(0, bb[2])));
    var gs = Math.max(30, 7 * R), gcol = COL.ground, nCount = p.length / 3;
    // sol (dalle de 7 rayons du modèle)
    [[cx - gs, cy - gs], [cx + gs, cy - gs], [cx + gs, cy + gs], [cx - gs, cy - gs], [cx + gs, cy + gs], [cx - gs, cy + gs]].forEach(function (q) { p.push(q[0], q[1], -0.002); n.push(0, 0, 1); c.push(gcol[0], gcol[1], gcol[2], 1); });
    return { p: buf(new Float32Array(p)), n: buf(new Float32Array(n)), c: buf(new Float32Array(c)), count: p.length / 3, modelCount: nCount,
      ntri: ntri, c0: [cx, cy, (bb[2] + bb[5]) / 2], R: R, hmax: bb[5], gs: gs, bb: bb, meshes: M, cb: buildingCenter(M) };
  }
  function lineBuf(P2, C) { return { p: buf(new Float32Array(P2)), c: buf(new Float32Array(C)), count: P2.length / 3 }; }
  function drawLines(L, M) {
    if (!L || !L.count) return;
    gl.useProgram(P.line); clearAttrs(); attr(P.line, 'p', L.p, 3); attr(P.line, 'c', L.c, 4);
    gl.uniformMatrix4fv(U(P.line, 'M'), false, M); gl.drawArrays(gl.LINES, 0, L.count);
    gl.deleteBuffer(L.p); gl.deleteBuffer(L.c);
  }
  // courses du soleil sur une demi-sphère de rayon Rd autour du modèle
  function pathPts(n, Rd, c0) {
    var out = [];
    for (var t = 0; t <= 24.0001; t += 1 / 6) { var q = SUN.pos(n, t); if (q.alt < -0.5) { out.push(null); continue; } var v = sunVec(q); out.push([c0[0] + v[0] * Rd, c0[1] + v[1] * Rd, Math.max(0, v[2]) * Rd, t]); }
    return out;
  }
  function pushPath(arr, P2, C, col) {
    for (var i = 0; i + 1 < arr.length; i++) { var a = arr[i], b = arr[i + 1]; if (!a || !b) continue; P2.push(a[0], a[1], a[2], b[0], b[1], b[2]); C.push.apply(C, col); C.push.apply(C, col); }
  }

  SUN.frame = function () {
    if (failed) return;
    if (!cv && !init()) return;
    var r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1, W = Math.max(1, Math.round(r.width * d)), H = Math.max(1, Math.round(r.height * d));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; lab.width = W; lab.height = H; needs = true; }
    if (ST.play) {
      var now = performance.now(), dt = Math.min(0.2, (now - playT) / 1000); playT = now;
      var di = SUN.dayInfo(SUN.n()), t2 = ST.t + dt * 1.2; // 1,2 h par seconde
      if (t2 >= (di.set != null ? di.set : 20)) { t2 = di.set != null ? di.set : 20; togglePlay(false); }
      SUN.set({ t: t2 });
    }
    var k = sceneKey();
    if (k !== skey) { if (scene) ['p', 'n', 'c'].forEach(function (q) { gl.deleteBuffer(scene[q]); }); scene = buildScene(); skey = k; needs = true; cutDirty = true; if (camSet && camR && (scene.R / camR > 1.6 || scene.R / camR < 0.6)) camSet = false; }
    if (!camSet) { cam.tx = scene.c0[0]; cam.ty = scene.c0[1]; cam.tz = Math.min(scene.hmax / 2, 3); cam.dist = 3.2 * scene.R; cam.yaw = -0.5; cam.pitch = 0.5; camSet = true; camR = scene.R; }
    if (cutDirty) drawCut();
    if (!needs) return;
    needs = false;
    var p = SUN.current(), SD = sunVec(p), up = p.alt > 0;
    var c0 = scene.c0, R = scene.R * 1.08;
    // passe d'ombre (vue depuis le soleil, projection orthogonale)
    var Lm = null;
    if (up && scene.ntri) {
      var sinA = Math.max(0.03, SD[2]), far = 4 * R + scene.hmax / sinA + 10;
      var eye = [c0[0] + SD[0] * 3 * R, c0[1] + SD[1] * 3 * R, c0[2] + SD[2] * 3 * R];
      Lm = mul(ortho(-R, R, -R, R, 0.05, far), lookAt(eye, c0, Math.abs(SD[2]) > 0.995 ? [0, 1, 0] : [0, 0, 1]));
      gl.bindFramebuffer(gl.FRAMEBUFFER, shadow.fb); gl.viewport(0, 0, SM, SM);
      gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.useProgram(P.depth); clearAttrs(); attr(P.depth, 'p', scene.p, 3);
      gl.uniformMatrix4fv(U(P.depth, 'L'), false, Lm); gl.drawArrays(gl.TRIANGLES, 0, scene.modelCount);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      SUN.lightSpan = far - 0.05;
    }
    // ciel selon la hauteur du soleil
    var day = Math.max(0, Math.min(1, (p.alt + 4) / 20));
    gl.viewport(0, 0, W, H);
    gl.clearColor(0.05 + 0.40 * day, 0.06 + 0.50 * day, 0.08 + 0.60 * day, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    var eyeC = [cam.tx + cam.dist * Math.cos(cam.pitch) * Math.sin(cam.yaw), cam.ty - cam.dist * Math.cos(cam.pitch) * Math.cos(cam.yaw), cam.tz + cam.dist * Math.sin(cam.pitch)];
    var M = mul(persp(0.8, W / H, Math.max(0.05, cam.dist / 500), Math.max(5000, cam.dist * 20)), lookAt(eyeC, [cam.tx, cam.ty, cam.tz], [0, 0, 1]));
    lastM = M;
    gl.useProgram(P.mesh); clearAttrs();
    attr(P.mesh, 'p', scene.p, 3); attr(P.mesh, 'n', scene.n, 3); attr(P.mesh, 'c', scene.c, 4);
    gl.uniformMatrix4fv(U(P.mesh, 'M'), false, M); gl.uniformMatrix4fv(U(P.mesh, 'L'), false, Lm || M);
    gl.uniform3fv(U(P.mesh, 'SD'), SD); gl.uniform3fv(U(P.mesh, 'EYE'), eyeC);
    var inten = up ? Math.min(1, 0.35 + Math.sin(p.alt * RAD) * 1.5) * 1.05 : 0;
    gl.uniform1f(U(P.mesh, 'SUNI'), Lm ? inten : 0); gl.uniform1f(U(P.mesh, 'AMB'), 0.10 + 0.22 * day);
    gl.uniform1f(U(P.mesh, 'TS'), 1 / SM); gl.uniform1f(U(P.mesh, 'BIAS'), Lm ? 0.012 / SUN.lightSpan : 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, shadow.tex); gl.uniform1i(U(P.mesh, 'SMap'), 0);
    gl.drawArrays(gl.TRIANGLES, 0, scene.count);
    // courses du soleil, rayons
    var Rd = Math.max(8, 2.2 * scene.R), P2 = [], C = [];
    if (ST.paths) {
      [[doy(6, 21), [1, 0.75, 0.3, 0.55]], [doy(3, 20), [0.9, 0.9, 0.9, 0.45]], [doy(12, 21), [0.55, 0.75, 1, 0.55]]].forEach(function (q) { pushPath(pathPts(q[0], Rd, c0), P2, C, q[1]); });
    }
    pushPath(pathPts(SUN.n(), Rd, c0), P2, C, [1, 0.88, 0.2, 1]);
    // rose au sol : axes nord-sud et est-ouest
    var gz = 0.01, rr = Rd;
    P2.push(c0[0], c0[1] - rr, gz, c0[0], c0[1] + rr, gz, c0[0] - rr, c0[1], gz, c0[0] + rr, c0[1], gz); for (var q = 0; q < 4; q++) C.push(0.25, 0.27, 0.3, 0.8);
    if (up) { // rayons parallèles vers le modèle
      for (var a = -1; a <= 1; a += 0.5) {
        var side = norm(cross(SD, [0, 0, 1])), o = [c0[0] + side[0] * a * scene.R * 0.6, c0[1] + side[1] * a * scene.R * 0.6, scene.hmax * 0.5];
        P2.push(o[0] + SD[0] * Rd, o[1] + SD[1] * Rd, o[2] + SD[2] * Rd, o[0] + SD[0] * scene.R * 0.9, o[1] + SD[1] * scene.R * 0.9, o[2] + SD[2] * scene.R * 0.9);
        C.push(1, 0.85, 0.2, 0.0, 1, 0.85, 0.2, 0.75);
      }
    }
    drawLines(lineBuf(P2, C), M);
    drawLabels(M, p, SD, Rd, c0);
  };
  function drawLabels(M, p, SD, Rd, c0) {
    var c = lab.getContext('2d'), d = window.devicePixelRatio || 1;
    c.clearRect(0, 0, lab.width, lab.height);
    c.font = 'bold ' + (13 * d) + 'px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    [['N', 0, 1], ['S', 0, -1], ['E', 1, 0], ['O', -1, 0]].forEach(function (k) {
      var s = project(M, [c0[0] + k[1] * Rd * 1.08, c0[1] + k[2] * Rd * 1.08, 0]); if (!s) return;
      c.fillStyle = k[0] === 'N' ? '#ff8a7a' : '#e8ecf2'; c.fillText(k[0], s[0], s[1]);
    });
    // heures sur la course du jour
    c.font = (10 * d) + 'px system-ui, sans-serif'; c.fillStyle = 'rgba(255,240,190,0.95)';
    for (var h = 0; h <= 24; h++) {
      var q = SUN.pos(SUN.n(), h); if (q.alt < 1) continue;
      var v = sunVec(q), s = project(M, [c0[0] + v[0] * Rd, c0[1] + v[1] * Rd, v[2] * Rd]);
      if (s) { c.beginPath(); c.arc(s[0], s[1], 2 * d, 0, 7); c.fill(); if (h % 2 === 0) c.fillText(h + ' h', s[0], s[1] - 9 * d); }
    }
    if (ST.paths) {
      c.font = (10 * d) + 'px system-ui, sans-serif';
      [[doy(6, 21), '21 juin', '#ffc26b'], [doy(3, 20), 'équinoxes', '#dddddd'], [doy(12, 21), '21 déc.', '#9cc3ff']].forEach(function (k) {
        var di = SUN.dayInfo(k[0]), q = SUN.pos(k[0], di.noon), v = sunVec(q), s = project(M, [c0[0] + v[0] * Rd, c0[1] + v[1] * Rd, v[2] * Rd]);
        if (s) { c.fillStyle = k[2]; c.fillText(k[1] + ' ' + fmt(q.alt, 0) + '°', s[0], s[1] + 11 * d); }
      });
    }
    if (p.alt > 0) {
      var ss = project(M, [c0[0] + SD[0] * Rd, c0[1] + SD[1] * Rd, SD[2] * Rd]);
      if (ss) {
        var g = c.createRadialGradient(ss[0], ss[1], 0, ss[0], ss[1], 26 * d); g.addColorStop(0, 'rgba(255,240,170,1)'); g.addColorStop(0.35, 'rgba(255,210,80,0.9)'); g.addColorStop(1, 'rgba(255,200,60,0)');
        c.fillStyle = g; c.beginPath(); c.arc(ss[0], ss[1], 26 * d, 0, 7); c.fill();
      }
    }
    c.textAlign = 'left'; c.textBaseline = 'top'; c.font = (12 * d) + 'px system-ui, sans-serif';
    var txt = dateTxt(ST.m, ST.d) + ', ' + hhmm(ST.t) + (p.alt > 0 ? ' · soleil à ' + fmt(p.alt, 1) + '° de hauteur, azimut ' + fmt(p.az, 0) + '° (' + compass(p.az) + ')' : ' · soleil sous l\'horizon');
    c.fillStyle = 'rgba(11,13,17,0.75)'; var tw = c.measureText(txt).width; c.fillRect(8 * d, 8 * d, tw + 16 * d, 22 * d);
    c.fillStyle = '#f2f4f8'; c.fillText(txt, 16 * d, 13 * d);
    if (!scene.ntri) { c.fillStyle = '#c9ced6'; c.textAlign = 'center'; c.fillText('Aucun objet : ouvrez Grasshopper ou dessinez un bâtiment.', lab.width / 2, lab.height / 2); }
  }

  // ---------------------------------------------------------------- coupe solaire (2D)
  var cutDirty = true;
  // trait de la coupe solaire : toujours par le centre du bâtiment (décalé de cutDx, cutDy), assez long pour le traverser
  function cutLine() {
    var cb = scene && scene.cb ? scene.cb : [0, 0, 10], c0 = [cb[0] + (ST.cutDx || 0), cb[1] + (ST.cutDy || 0)];
    var L = scene ? Math.max(4, cb[2] * 0.75 + Math.hypot(ST.cutDx || 0, ST.cutDy || 0) + 3, scene.R * 1.2) : 10;
    if (ST.cut === 'trait' && CLW.sectionLine) { var s = CLW.sectionLine(); return { a: s.a, b: s.b, kind: 'trait' }; }
    if (ST.cut === 'sun') {
      var p = SUN.current(), ux = Math.sin(p.az * RAD), uy = Math.cos(p.az * RAD);
      return { a: [c0[0] + ux * L, c0[1] + uy * L], b: [c0[0] - ux * L, c0[1] - uy * L], kind: 'sun' };
    }
    if (ST.cut === 'fixe') {
      var fx = Math.sin(ST.cutAz * RAD), fy = Math.cos(ST.cutAz * RAD);
      return { a: [c0[0] + fx * L, c0[1] + fy * L], b: [c0[0] - fx * L, c0[1] - fy * L], kind: 'fixe' };
    }
    return { a: [c0[0], c0[1] - L], b: [c0[0], c0[1] + L], kind: 'ns' };
  }
  SUN.cutLine = cutLine;
  // segments coupés (t, z) en m : tous les maillages de la scène (liaison et objets extrudés), mis en cache
  var segKey = null, segCache = null;
  function cutSegments(SL) {
    var key = skey + '|' + SL.a.join(',') + '|' + SL.b.join(',');
    if (key === segKey) return segCache;
    var ms = scene.meshes, ax = SL.a[0], ay = SL.a[1], dx = SL.b[0] - ax, dy = SL.b[1] - ay, L2 = Math.hypot(dx, dy) || 1, ux = dx / L2, uy = dy / L2, nx = -uy, ny = ux;
    // coupe un peu épaisse (plans à −5, 0 et +5 cm) : un trait qui passe dans un joint montre quand même la paroi ;
    // élévation au-delà du plan (moitié lointaine de l'ouvrage), comme une coupe d'architecte
    var res = { vol: [], scr: [], elev: { vol: [], scr: [] } }, depth = Math.max(2, scene.R * 1.3);
    [['vol', ms.vol], ['scr', ms.scr]].forEach(function (grp) {
      var EP = res.elev[grp[0]];
      grp[1].forEach(function (m) {
        var v = m.v, f = m.f;
        for (var q = 0; q < f.length; q += 3) {
          var ia = 3 * f[q], ib = 3 * f[q + 1], ic = 3 * f[q + 2];
          var da = (v[ia] - ax) * nx + (v[ia + 1] - ay) * ny, db = (v[ib] - ax) * nx + (v[ib + 1] - ay) * ny, dc = (v[ic] - ax) * nx + (v[ic + 1] - ay) * ny;
          if (da > 0.05 && db > 0.05 && dc > 0.05 && da < depth && db < depth && dc < depth) {
            var ta = (v[ia] - ax) * ux + (v[ia + 1] - ay) * uy, tb = (v[ib] - ax) * ux + (v[ib + 1] - ay) * uy, tc = (v[ic] - ax) * ux + (v[ic + 1] - ay) * uy;
            EP.push(ta, v[ia + 2], tb, v[ib + 2], tc, v[ic + 2]);
          }
          for (var off = -0.05; off <= 0.0501; off += 0.05) {
            var pts = [];
            for (var e = 0; e < 3; e++) {
              var i = 3 * f[q + e], j = 3 * f[q + (e + 1) % 3];
              var pix = v[i] - ax, piy = v[i + 1] - ay, pjx = v[j] - ax, pjy = v[j + 1] - ay, di = pix * nx + piy * ny - off, dj = pjx * nx + pjy * ny - off;
              if ((di < 0) !== (dj < 0)) { var k = di / (di - dj), tt = (pix + k * (pjx - pix)) * ux + (piy + k * (pjy - piy)) * uy; if (tt >= -0.01 && tt <= L2 + 0.01) pts.push(tt, v[i + 2] + k * (v[j + 2] - v[i + 2])); }
            }
            if (pts.length === 4) res[grp[0]].push(pts[0], pts[1], pts[2], pts[3]);
          }
        }
      });
    });
    res.elevImg = elevRaster(res.elev, L2);
    segKey = key; segCache = res;
    return res;
  }
  // élévation : triangles projetés (t, z) remplis dans une image (2 cm par pixel au plus fin)
  function elevRaster(EL, L2) {
    var zt = 0.5; ['vol', 'scr'].forEach(function (k) { var a = EL[k]; for (var i = 1; i < a.length; i += 2) if (a[i] > zt) zt = a[i]; });
    var res = Math.max(0.02, Math.max(L2, zt) / 1400), W = Math.ceil(L2 / res), H = Math.ceil(zt / res);
    var cv2 = document.createElement('canvas'); cv2.width = W; cv2.height = H;
    var cx2 = cv2.getContext('2d'), img = cx2.createImageData(W, H), d = img.data;
    [['vol', [200, 205, 215, 26]], ['scr', [214, 120, 70, 80]]].forEach(function (k) {
      var a = EL[k[0]], col = k[1];
      for (var q = 0; q < a.length; q += 6) {
        var ax = a[q] / res, ay = (zt - a[q + 1]) / res, bx = a[q + 2] / res, by = (zt - a[q + 3]) / res, cx = a[q + 4] / res, cy = (zt - a[q + 5]) / res;
        var i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), i1 = Math.min(W - 1, Math.ceil(Math.max(ax, bx, cx)));
        var j0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), j1 = Math.min(H - 1, Math.ceil(Math.max(ay, by, cy)));
        var den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy); if (Math.abs(den) < 1e-9) continue;
        for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) {
          var px = i + 0.5, py = j + 0.5, w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den;
          if (w0 < -0.05 || w1 < -0.05 || w0 + w1 > 1.05) continue;
          var o = 4 * (j * W + i); d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = Math.max(d[o + 3], col[3]);
        }
      }
    });
    cx2.putImageData(img, 0, 0);
    return { canvas: cv2, zt: zt };
  }
  SUN.cutSegments = function (SL) { return scene ? cutSegments(SL) : null; };
  // premier obstacle touché par un rayon (o + s·dir) dans la coupe
  function hitRay(o, dir, segs) {
    var best = Infinity, kind = 'sol';
    if (dir[1] < -1e-9) { var tg = -o[1] / dir[1]; if (tg > 0) best = tg; }
    ['vol', 'scr'].forEach(function (k) {
      var L = segs[k];
      for (var q = 0; q < L.length; q += 4) {
        var ex = L[q + 2] - L[q], ez = L[q + 3] - L[q + 1], den = dir[0] * ez - dir[1] * ex; if (Math.abs(den) < 1e-12) continue;
        var wx = L[q] - o[0], wz = L[q + 1] - o[1], s = (wx * ez - wz * ex) / den, u = (wx * dir[1] - wz * dir[0]) / den;
        if (s > 1e-6 && s < best && u >= -1e-6 && u <= 1 + 1e-6) { best = s; kind = k; }
      }
    });
    return { s: best, kind: kind };
  }
  // vue de la coupe solaire : échelle « fit » (ajustée), fixe (1/N à 96 points par pouce) ou « libre » (zoom à la molette),
  // centre (cx, cz) en m dans le plan de la coupe (null = coupe entière, sol en bas), hauteur dans la vue (40, 70 ou 100 %)
  var CV = SUN.cutView = { scale: 'fit', z: 1, cx: null, cz: null, size: 40, L: null };
  try { var cv0 = JSON.parse(localStorage.getItem('clwind-suncut') || 'null'); if (cv0) { if (cv0.scale && cv0.scale !== 'libre') CV.scale = cv0.scale; if (cv0.size) CV.size = cv0.size; } } catch (e) { /* rien */ }
  var PXM = 96 / 0.0254; // pixels CSS par mètre à l'échelle 1/1
  function drawCut() {
    cutDirty = false;
    var cvc = $('suncut'); if (!cvc || $('sun-wrap').hidden) return;
    var r = cvc.getBoundingClientRect(), d = window.devicePixelRatio || 1, W = Math.max(1, Math.round(r.width * d)), H = Math.max(1, Math.round(r.height * d));
    if (cvc.width !== W || cvc.height !== H) { cvc.width = W; cvc.height = H; }
    renderCut(cvc, d, null);
    var so = $('suncut-scale-o'); if (so && CV.L) so.textContent = CV.scale === 'fit' || CV.scale === 'libre' ? '≈ 1/' + niceN(CV.L.N) : '';
  }
  function niceN(N) { return N >= 100 ? Math.round(N / 5) * 5 : N >= 20 ? Math.round(N) : fmt(N, 1); }
  // opt.full : coupe entière à l'échelle fixe (export) ; sinon la vue courante
  function renderCut(cvc, d, opt) {
    var W = cvc.width, H = cvc.height;
    var c = cvc.getContext('2d'), p = SUN.current();
    c.fillStyle = '#0b0d11'; c.fillRect(0, 0, W, H);
    if (!scene) return;
    var SL = cutLine(), Lg = Math.hypot(SL.b[0] - SL.a[0], SL.b[1] - SL.a[1]) || 1, ux = (SL.b[0] - SL.a[0]) / Lg, uy = (SL.b[1] - SL.a[1]) / Lg;
    var segs = cutSegments(SL), zmax = Math.max(3, scene.hmax * 1.45);
    var top = 34 * d, bot = 24 * d, left = 40 * d, right = 16 * d, aw = W - left - right, ah = H - top - bot;
    var s0 = Math.min(aw / Lg, ah / zmax), fixed = CV.scale !== 'fit' && CV.scale !== 'libre';
    var s = fixed ? PXM / +CV.scale * d : s0 * (CV.scale === 'libre' ? CV.z : 1);
    var full = opt && opt.full, cx = full || CV.cx == null ? Lg / 2 : CV.cx, cz = full || CV.cz == null ? ah / 2 / s : CV.cz;
    var ox = left + aw / 2 - cx * s, oy = top + ah / 2 + cz * s;
    if (!opt) CV.L = { s: s, s0: s0, ox: ox, oy: oy, left: left, top: top, aw: aw, ah: ah, d: d, N: PXM * d / s };
    function X(t) { return ox + t * s; } function Y(z) { return oy - z * s; }
    c.save(); c.beginPath(); c.rect(left, top, aw, ah + bot * 0.5); c.clip();
    // ciel, sol
    var day = Math.max(0, Math.min(1, (p.alt + 4) / 20)), g = c.createLinearGradient(0, top, 0, oy);
    g.addColorStop(0, 'rgb(' + Math.round(20 + 70 * day) + ',' + Math.round(26 + 95 * day) + ',' + Math.round(36 + 120 * day) + ')'); g.addColorStop(1, 'rgb(' + Math.round(16 + 40 * day) + ',' + Math.round(20 + 50 * day) + ',' + Math.round(28 + 60 * day) + ')');
    c.fillStyle = g; c.fillRect(X(0), top, Lg * s, oy - top);
    c.fillStyle = '#4a4238'; c.fillRect(X(0), oy, Lg * s, 8 * d); c.strokeStyle = '#8a7a64'; c.lineWidth = 1.5 * d; c.beginPath(); c.moveTo(X(0), oy); c.lineTo(X(Lg), oy); c.stroke();
    // élévation au-delà du plan de coupe (moitié lointaine), en teinte légère
    if (segs.elevImg) { c.imageSmoothingEnabled = true; c.drawImage(segs.elevImg.canvas, X(0), Y(segs.elevImg.zt), Lg * s, segs.elevImg.zt * s); }
    // rayons : direction du soleil projetée dans le plan vertical de la coupe
    var SD = sunVec(p), cu = SD[0] * ux + SD[1] * uy, ray = null, appAlt = null;
    c.save(); c.beginPath(); c.rect(X(0), top, Lg * s, oy - top + 1); c.clip();
    if (p.alt > 0) {
      var len = Math.hypot(cu, SD[2]);
      ray = [-cu / len, -SD[2] / len]; appAlt = Math.atan2(SD[2], Math.abs(cu)) / RAD;
      // départs répartis perpendiculairement aux rayons, sur toute la coupe
      var per = [-ray[1], ray[0]], span = Lg + zmax, nR = Math.max(16, Math.min(70, Math.round(Lg * s / (14 * d)))), mid = [Lg / 2, zmax / 2];
      var big = 3 * span, hits = { vol: 0, scr: 0, sol: 0 };
      for (var i = 0; i < nR; i++) {
        var a = (i + 0.5) / nR - 0.5, o = [mid[0] + per[0] * a * span * 1.25 - ray[0] * big, mid[1] + per[1] * a * span * 1.25 - ray[1] * big];
        var h = hitRay(o, ray, segs); if (!isFinite(h.s)) continue;
        var e = [o[0] + ray[0] * h.s, o[1] + ray[1] * h.s];
        if (e[0] < -0.01 || e[0] > Lg + 0.01) continue;
        var gr = c.createLinearGradient(X(o[0] + ray[0] * (h.s - 6)), Y(o[1] + ray[1] * (h.s - 6)), X(e[0]), Y(e[1]));
        gr.addColorStop(0, 'rgba(255,214,90,0)'); gr.addColorStop(1, 'rgba(255,214,90,0.95)');
        c.strokeStyle = gr; c.lineWidth = 1.4 * d; c.beginPath(); c.moveTo(X(o[0] + ray[0] * (h.s - big * 0.5)), Y(o[1] + ray[1] * (h.s - big * 0.5))); c.lineTo(X(e[0]), Y(e[1])); c.stroke();
        c.fillStyle = h.kind === 'scr' ? '#ff9a4a' : h.kind === 'vol' ? '#ffe9a0' : '#ffd65a';
        c.beginPath(); c.arc(X(e[0]), Y(e[1]), 2.6 * d, 0, 7); c.fill();
        hits[h.kind]++;
      }
      SUN.cutHits = hits;
    }
    c.restore();
    // géométrie coupée
    c.lineCap = 'round';
    [['vol', 'rgba(220,224,232,0.95)'], ['scr', 'rgba(232,128,62,1)']].forEach(function (k) {
      var L = segs[k[0]]; if (!L.length) return;
      c.strokeStyle = k[1]; c.lineWidth = Math.max(1.5 * d, Math.min(3 * d, 0.04 * s)); c.beginPath();
      for (var q = 0; q < L.length; q += 4) { c.moveTo(X(L[q]), Y(L[q + 1])); c.lineTo(X(L[q + 2]), Y(L[q + 3])); }
      c.stroke();
    });
    if (CLW.Thermal && CLW.Thermal.cutOverlay) { try { CLW.Thermal.cutOverlay(c, { d: d, segs: segs, Lg: Lg, X: X, Y: Y, zmax: zmax, s: s, axis: [ux, uy] }); } catch (e) { console.error(e); } }
    // rayons de midi des solstices et équinoxes, passant par le haut de la paroi côté soleil
    if (ST.paths) {
      var allz = segs.vol.concat(segs.scr), tmin = Infinity, tmax = -Infinity;
      for (var q2 = 0; q2 < allz.length; q2 += 2) { tmin = Math.min(tmin, allz[q2]); tmax = Math.max(tmax, allz[q2]); }
      if (isFinite(tmin)) {
        [[doy(6, 21), '21 juin', '#ffc26b'], [doy(3, 20), 'équinoxes', '#d8d8d8'], [doy(12, 21), '21 déc.', '#9cc3ff']].forEach(function (k, ki) {
          var di = SUN.dayInfo(k[0]), q = SUN.pos(k[0], di.noon), V3 = sunVec(q), cu2 = V3[0] * ux + V3[1] * uy; if (q.alt <= 0) return;
          var l2 = Math.hypot(cu2, V3[2]), rd = [-cu2 / l2, -V3[2] / l2];
          // point d'appui : sommet de la paroi du côté d'où vient le soleil
          var sideT = cu2 < 0 ? tmin : tmax, bestZ = 0, bestT = sideT, band = Math.max(0.3, 0.12 * (tmax - tmin));
          for (var q3 = 0; q3 < allz.length; q3 += 2) if (Math.abs(allz[q3] - sideT) <= band && allz[q3 + 1] > bestZ) { bestZ = allz[q3 + 1]; bestT = allz[q3]; }
          var sg = bestZ / Math.max(1e-6, -rd[1]), end = [bestT + rd[0] * sg, 0], st0 = [bestT - rd[0] * 50, bestZ - rd[1] * 50];
          c.save(); c.beginPath(); c.rect(X(0), top, Lg * s, oy - top + 1); c.clip();
          c.strokeStyle = k[2]; c.setLineDash([7 * d, 5 * d]); c.lineWidth = 1.2 * d;
          c.beginPath(); c.moveTo(X(st0[0]), Y(st0[1])); c.lineTo(X(end[0]), Y(end[1])); c.stroke(); c.setLineDash([]);
          c.restore();
          var ap = Math.atan2(V3[2], Math.abs(cu2)) / RAD;
          c.fillStyle = k[2]; c.font = (10 * d) + 'px system-ui, sans-serif'; c.textAlign = cu2 < 0 ? 'left' : 'right'; c.textBaseline = 'bottom';
          var lx = cu2 < 0 ? Math.max(left, X(0)) + 6 * d : Math.min(W - right, X(Lg)) - 6 * d, ly = top + (14 + 13 * ki) * d;
          c.fillText(k[1] + ', midi : ' + fmt(q.alt, 0) + '°' + (Math.abs(ap - q.alt) > 1 ? ' (vu ' + fmt(ap, 0) + '° dans la coupe)' : '') + ', tache au sol à ' + fmt(Math.abs(end[0] - bestT), 1) + ' m de la paroi', lx, ly);
        });
      }
    }
    c.restore();
    // échelle des hauteurs (marge gauche), pas adapté au zoom
    c.fillStyle = '#0b0d11'; c.fillRect(0, 0, left, H);
    c.fillStyle = '#8b95a5'; c.font = (10 * d) + 'px system-ui, sans-serif'; c.textBaseline = 'middle'; c.textAlign = 'right';
    var stp = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20].filter(function (q) { return q * s >= 26 * d; })[0] || 50;
    for (var hz = 0; hz <= Math.max(zmax, (oy - top) / s) + 1e-6; hz += stp) { var yh = Y(hz); if (yh < top - 2 || yh > H - bot + 2) continue; c.fillText(fmt(hz, stp < 1 ? 1 : 0) + ' m', left - 6 * d, yh); c.fillRect(left - 4 * d, yh, 4 * d, d); }
    // barre d'échelle et échelle
    var sb = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50].filter(function (q) { return q * s >= 70 * d; })[0] || 100, sbx = W - right - sb * s - 8 * d, sby = H - bot - 10 * d;
    c.fillStyle = 'rgba(11,13,17,0.75)'; c.fillRect(sbx - 6 * d, sby - 16 * d, sb * s + 12 * d, 24 * d);
    c.fillStyle = '#e8ecf2'; c.fillRect(sbx, sby, sb * s / 2, 4 * d); c.strokeStyle = '#e8ecf2'; c.lineWidth = d; c.strokeRect(sbx, sby, sb * s, 4 * d);
    c.font = (10 * d) + 'px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'bottom';
    c.fillText(fmt(sb, sb < 1 ? 1 : 0) + ' m' + (fixed ? ' · échelle 1/' + CV.scale : ''), sbx + sb * s / 2, sby - 2 * d);
    // textes
    c.textAlign = 'left'; c.textBaseline = 'top'; c.fillStyle = '#c9ced6'; c.font = (11 * d) + 'px system-ui, sans-serif';
    var dirA = compass(Math.atan2(SL.a[0] - SL.b[0], SL.a[1] - SL.b[1]) / RAD + 360), dirB = compass(Math.atan2(SL.b[0] - SL.a[0], SL.b[1] - SL.a[1]) / RAD + 360);
    var title = 'Coupe solaire ' + (SL.kind === 'ns' ? 'sud → nord (fixe)' : SL.kind === 'sun' ? 'dans l\'axe du soleil (suit le soleil)' : SL.kind === 'fixe' ? 'fixe, azimut ' + ST.cutAz + '° (' + compass(ST.cutAz) + ')' : 'le long du trait A → B') + ' · ' +
      (p.alt > 0 ? 'soleil à ' + fmt(p.alt, 1) + '°' + (appAlt != null && Math.abs(appAlt - p.alt) > 1 ? ', vu à ' + fmt(appAlt, 1) + '° dans ce plan' : '') : 'soleil sous l\'horizon');
    c.fillText(title, left + 4 * d, 4 * d);
    c.fillStyle = '#8b95a5'; c.font = (10 * d) + 'px system-ui, sans-serif';
    c.fillText('Rayons schématiques. Traits : parties coupées ; teinte claire : moitié de l\'ouvrage vue au-delà.' + (appAlt != null && Math.abs(appAlt - p.alt) > 1 ? ' Soleil hors de l\'axe : angle apparent.' : ''), left + 4 * d, 18 * d);
    c.font = 'bold ' + (12 * d) + 'px system-ui, sans-serif'; c.fillStyle = '#e8ecf2'; c.textBaseline = 'bottom';
    var yd = Math.min(oy, H - bot) - 4 * d;
    c.fillText((SL.kind === 'trait' ? 'A ' : '') + dirA, Math.max(left, X(0)) + 4 * d, yd); c.textAlign = 'right'; c.fillText(dirB + (SL.kind === 'trait' ? ' B' : ''), Math.min(W - right, X(Lg)) - 4 * d, yd);
    c.textAlign = 'left'; c.textBaseline = 'top'; c.font = (10 * d) + 'px system-ui, sans-serif'; c.fillStyle = '#8b95a5';
    c.fillText('Points : orange = rayon arrêté par une brique ou une lame, clair = par un volume, jaune = au sol.', 8 * d, H - 18 * d);
  }
  SUN.drawCut = function () { cutDirty = true; };
  // vues de face : la caméra regarde le centre du bâtiment depuis le sud, le nord, l'est ou l'ouest, presque à l'horizontale
  SUN.face = function (dir) {
    var Y = { S: 0, N: Math.PI, E: Math.PI / 2, O: -Math.PI / 2 }; if (!(dir in Y) || !scene) return;
    var cb = scene.cb || scene.c0; cam.tx = cb[0]; cam.ty = cb[1]; cam.tz = Math.min(scene.hmax / 2, 3);
    cam.yaw = Y[dir]; cam.pitch = 0.06; cam.dist = Math.max(cam.dist, 2.6 * scene.R); camSet = true; needs = true; SUN.faceDir = dir;
  };
  // export PNG à 300 dpi : à l'échelle fixe, la coupe entière ; sinon la vue courante
  SUN.exportCut = function () {
    var cvc = $('suncut'); if (!cvc || !scene) return null;
    var k = 300 / 96, out = document.createElement('canvas'), fixed = CV.scale !== 'fit' && CV.scale !== 'libre';
    if (fixed) {
      var SL = cutLine(), Lg = Math.hypot(SL.b[0] - SL.a[0], SL.b[1] - SL.a[1]) || 1, zmax = Math.max(3, scene.hmax * 1.45), s = PXM / +CV.scale * k;
      out.width = Math.min(12000, Math.round(Lg * s + 56 * k)); out.height = Math.min(9000, Math.round(zmax * s + 58 * k));
      renderCut(out, k, { full: true });
    } else {
      var r = cvc.getBoundingClientRect(); out.width = Math.round(r.width * k); out.height = Math.round(r.height * k);
      var keep = CV.L, sx = CV.scale, z = CV.z; renderCut(out, k, { full: false }); CV.L = keep; CV.scale = sx; CV.z = z;
    }
    return out;
  };
  (function () {
    function rel(e, cvc) { var r = cvc.getBoundingClientRect(), d = window.devicePixelRatio || 1; return [(e.clientX - r.left) * d, (e.clientY - r.top) * d]; }
    function centre() { var L = CV.L; if (CV.cx == null && L) { CV.cx = (L.left + L.aw / 2 - L.ox) / L.s; CV.cz = (L.oy - L.top - L.ah / 2) / L.s; } }
    function zoomAt(px, py, f) {
      var L = CV.L; if (!L) return;
      centre();
      var t = (px - L.ox) / L.s, z = (L.oy - py) / L.s, s2 = Math.max(L.s0 * 0.2, Math.min(L.s0 * 60, L.s * f));
      CV.scale = 'libre'; CV.z = s2 / L.s0;
      CV.cx = t - (px - L.left - L.aw / 2) / s2; CV.cz = z + (py - L.top - L.ah / 2) / s2;
      syncCutUI(); cutDirty = true;
    }
    SUN.cutZoom = function (f) { var L = CV.L; if (L) zoomAt(L.left + L.aw / 2, L.top + L.ah / 2, f); };
    SUN.cutFit = function () { CV.scale = 'fit'; CV.z = 1; CV.cx = CV.cz = null; syncCutUI(); cutDirty = true; };
    SUN.cutScale = function (v) { centre(); CV.scale = v; CV.z = 1; if (v === 'fit') { CV.cx = CV.cz = null; } syncCutUI(); cutDirty = true; };
    SUN.cutSize = function (sz) {
      CV.size = sz || (CV.size === 40 ? 70 : CV.size === 70 ? 100 : 40);
      var w = $('sun-wrap'); if (w) { w.style.setProperty('--cuth', CV.size + '%'); w.classList.toggle('cut-full', CV.size === 100); }
      syncCutUI(); needs = true; cutDirty = true; setTimeout(function () { window.dispatchEvent(new Event('resize')); }, 0);
    };
    function syncCutUI() {
      var sel = $('suncut-scale'); if (sel) sel.value = CV.scale;
      var b = $('suncut-size'); if (b) b.textContent = CV.size === 100 ? 'Réduire' : 'Agrandir';
      try { localStorage.setItem('clwind-suncut', JSON.stringify({ scale: CV.scale, size: CV.size })); } catch (e) { /* rien */ }
    }
    function init() {
      var cvc = $('suncut'); if (!cvc) return;
      var drag = null;
      cvc.addEventListener('wheel', function (e) { e.preventDefault(); var p = rel(e, cvc); zoomAt(p[0], p[1], Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
      cvc.addEventListener('mousedown', function (e) { if (e.button !== 0 || !CV.L) return; centre(); drag = { p: rel(e, cvc), cx: CV.cx, cz: CV.cz }; cvc.classList.add('drag'); e.preventDefault(); });
      window.addEventListener('mousemove', function (e) { if (!drag) return; var p = rel(e, cvc), s = CV.L.s; CV.cx = drag.cx - (p[0] - drag.p[0]) / s; CV.cz = drag.cz + (p[1] - drag.p[1]) / s; cutDirty = true; });
      window.addEventListener('mouseup', function () { if (drag) { drag = null; cvc.classList.remove('drag'); } });
      cvc.addEventListener('dblclick', function () { SUN.cutFit(); });
      var sel = $('suncut-scale'); if (sel) sel.addEventListener('change', function () { SUN.cutScale(sel.value); });
      var on = function (id, f) { var b = $(id); if (b) b.addEventListener('click', f); };
      on('suncut-zin', function () { SUN.cutZoom(1.4); }); on('suncut-zout', function () { SUN.cutZoom(1 / 1.4); });
      on('suncut-fit', function () { SUN.cutFit(); }); on('suncut-size', function () { SUN.cutSize(); });
      on('suncut-png', function () {
        var out = SUN.exportCut(); if (!out) return;
        var D = SUN.state, nm = 'coupe-solaire_' + D.d + '-' + D.m + '_' + String(D.t).replace('.', 'h') + (CV.scale !== 'fit' && CV.scale !== 'libre' ? '_1-' + CV.scale : '') + '.png';
        out.toBlob(function (b) { var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = nm; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }, 'image/png');
      });
      // position et rotation de la coupe (décalage par rapport au centre du bâtiment, azimut de l'extrémité A)
      var num = function (id) { var v = parseFloat(String(($(id) || {}).value || '').replace(',', '.')); return isFinite(v) ? v : null; };
      ['scx', 'scy'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('change', function () { SUN.set(id === 'scx' ? { cutDx: num('scx') || 0 } : { cutDy: num('scy') || 0 }); }); });
      var ea = $('sca'); if (ea) ea.addEventListener('change', function () { var v = num('sca'); if (v != null) SUN.set({ cut: 'fixe', cutAz: v }); });
      on('scc', function () { SUN.set({ cutDx: 0, cutDy: 0 }); });
      // accès rapide : vues de face et coupes par le centre du bâtiment
      [].forEach.call(document.querySelectorAll('#sun-quick [data-q]'), function (b) {
        b.addEventListener('click', function () {
          var q = b.dataset.q;
          if (q.indexOf('face-') === 0) SUN.face(q.slice(5));
          else if (q === 'cut-ns') SUN.set({ cut: 'ns', cutAz: 180 });
          else if (q === 'cut-eo') SUN.set({ cut: 'fixe', cutAz: 90 });
        });
      });
      SUN.cutSize(CV.size); syncCutUI();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  })();
  SUN.dirty = function () { needs = true; cutDirty = true; };
  SUN.canvas3d = function () { return cv; };
  SUN.canvasCut = function () { return $('suncut'); };
  SUN.labels = function () { return lab; };
})(window);
