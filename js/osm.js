/* CL-WIND - osm.js
 * Localisation (coordonnées ou Nominatim), requête Overpass par relais de serveurs,
 * conversion en bâtiments, arbres et murs en mètres (nord en haut).
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var OSM = CLW.OSM = {};

  OSM.SERVERS = [
    { name: 'overpass-api.de', url: 'https://overpass-api.de/api/interpreter' },
    { name: 'maps.mail.ru', url: 'https://maps.mail.ru/osm/tools/overpass/api/interpreter' },
    { name: 'overpass.private.coffee', url: 'https://overpass.private.coffee/api/interpreter' },
    { name: 'overpass.kumi.systems', url: 'https://overpass.kumi.systems/api/interpreter' }
  ];
  OSM.STAGGER = 20000;   // sans réponse après 20 s, interroge aussi le suivant
  OSM.CAP = 120000;      // attente plafonnée à 2 minutes
  OSM.lastGood = 0;

  // ------------------------------------------------------------------ coordonnées
  function num(s) { s = String(s).trim().replace(',', '.'); return /^[-+]?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN; }
  // renvoie { lat, lon } , { error } ou null si ce ne sont pas des coordonnées
  OSM.parseCoords = function (q) {
    q = String(q || '').trim();
    if (!/^[-+0-9.,;\s°NSEOW]+$/i.test(q) || !/\d/.test(q)) return null;
    var s = q.replace(/°/g, ' ').trim(), parts = null;
    if (/;/.test(s)) parts = s.split(/\s*;\s*/);
    else if (/,\s+/.test(s)) parts = s.split(/\s*,\s+/);
    else if (/\s/.test(s)) parts = s.split(/\s+/);
    else if ((s.match(/,/g) || []).length === 1 && /\./.test(s)) parts = s.split(',');
    else if ((s.match(/,/g) || []).length === 3) { var c = s.split(','); parts = [c[0] + '.' + c[1], c[2] + '.' + c[3]]; }
    else if ((s.match(/,/g) || []).length === 1) parts = s.split(',');
    if (!parts || parts.length !== 2) return { error: 'Coordonnées illisibles. Écrivez par exemple 47.2133, -1.5593.' };
    var lat = num(parts[0]), lon = num(parts[1]);
    if (!isFinite(lat) || !isFinite(lon)) return { error: 'Coordonnées illisibles. Écrivez par exemple 47.2133, -1.5593.' };
    if (Math.abs(lat) > 90) return { error: 'Coordonnées impossibles : la latitude doit être comprise entre -90 et 90 (ici ' + CLW.fmt(lat, 4) + ').' };
    if (Math.abs(lon) > 180) return { error: 'Coordonnées impossibles : la longitude doit être comprise entre -180 et 180 (ici ' + CLW.fmt(lon, 4) + ').' };
    return { lat: lat, lon: lon };
  };

  // longueurs de degré WGS84 à la latitude du site
  OSM.degLengths = function (lat) {
    var r = lat * Math.PI / 180;
    return {
      kx: 111412.84 * Math.cos(r) - 93.5 * Math.cos(3 * r),
      ky: 111132.92 - 559.82 * Math.cos(2 * r) + 1.175 * Math.cos(4 * r)
    };
  };
  OSM.project = function (lat0, lon0) {
    var k = OSM.degLengths(lat0);
    return function (lat, lon) { return [(lon - lon0) * k.kx, (lat - lat0) * k.ky]; };
  };
  OSM.unproject = function (lat0, lon0) {
    var k = OSM.degLengths(lat0);
    return function (x, y) { return [lat0 + y / k.ky, lon0 + x / k.kx]; };
  };

  OSM.geocode = function (q, fetchFn) {
    fetchFn = fetchFn || root.fetch.bind(root);
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&accept-language=fr&q=' + encodeURIComponent(q);
    return fetchFn(url, { headers: { 'Accept': 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('Le service de recherche d\'adresse (Nominatim) a répondu ' + r.status + '. Réessayez dans un moment, ou collez des coordonnées.');
      return r.json();
    }, function () {
      throw new Error('Impossible de joindre le service de recherche d\'adresse. Vérifiez la connexion Internet, ou collez des coordonnées.');
    }).then(function (a) {
      if (!a || !a.length) throw new Error('Adresse introuvable : « ' + q + ' ». Précisez la ville, ou collez des coordonnées (latitude, longitude).');
      return { lat: parseFloat(a[0].lat), lon: parseFloat(a[0].lon), label: a[0].display_name || q };
    });
  };

  // ------------------------------------------------------------------ Overpass
  OSM.buildQuery = function (lat, lon, R) {
    var a = '(around:' + Math.round(1.45 * R) + ',' + lat.toFixed(7) + ',' + lon.toFixed(7) + ')';
    return '[out:json][timeout:60];(' +
      'way["building"]' + a + ';relation["building"]' + a + ';' +
      'node["natural"="tree"]' + a + ';way["barrier"="wall"]' + a + ';' +
      ');out geom;';
  };

  // une réponse 200 portant une remarque d'erreur n'est pas un résultat
  OSM.validate = function (txt) {
    var j;
    try { j = typeof txt === 'string' ? JSON.parse(txt) : txt; } catch (e) { return { error: 'réponse illisible' }; }
    if (!j || !Array.isArray(j.elements)) return { error: 'réponse sans données' };
    if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark)) return { error: 'remarque du serveur : ' + String(j.remark).slice(0, 120) };
    return { data: j };
  };

  /* Relais : sur échec, passe tout de suite au suivant ; sans réponse après STAGGER ms,
   * interroge aussi le suivant sans abandonner le premier. La première réponse valide gagne. */
  OSM.relay = function (query, opts) {
    opts = opts || {};
    var servers = opts.servers || OSM.SERVERS;
    var fetchFn = opts.fetch || root.fetch.bind(root);
    var stagger = opts.stagger != null ? opts.stagger : OSM.STAGGER;
    var cap = opts.cap != null ? opts.cap : OSM.CAP;
    var start = opts.start != null ? opts.start : OSM.lastGood;
    var progress = opts.onProgress || function () {};
    var n = servers.length, launched = 0, failed = 0, done = false, ctrls = [], timers = [], errors = [];
    return new Promise(function (resolve, reject) {
      function finish(ok, val) {
        if (done) return; done = true;
        timers.forEach(clearTimeout);
        ctrls.forEach(function (c) { try { c.abort(); } catch (e) { /* rien */ } });
        if (ok) resolve(val); else reject(val);
      }
      var capTimer = setTimeout(function () {
        finish(false, new Error('Aucun serveur Overpass n\'a répondu en 2 minutes. Réessayez plus tard ; la scène n\'a pas été modifiée.'));
      }, cap);
      timers.push(capTimer);
      function launchNext() {
        if (done || launched >= n) return;
        var idx = (start + launched) % n, srv = servers[idx];
        launched++;
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
        ctrls.push(ctrl);
        progress('Interrogation de ' + srv.name + '…', srv);
        var t = setTimeout(function () {
          if (!done && launched < n) { progress('Pas de réponse de ' + srv.name + ' après ' + Math.round(stagger / 1000) + ' s : essai aussi du serveur suivant.', srv); launchNext(); }
        }, stagger);
        timers.push(t);
        fetchFn(srv.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(query),
          signal: ctrl ? ctrl.signal : undefined
        }).then(function (r) {
          if (!r.ok) throw new Error('code ' + r.status + ({ 406: ' (requête refusée)', 429: ' (trop de requêtes)', 502: ' (passerelle)', 504: ' (délai dépassé)' }[r.status] || ''));
          return r.text();
        }).then(function (txt) {
          var v = OSM.validate(txt);
          if (v.error) throw new Error(v.error);
          OSM.lastGood = idx;
          finish(true, { data: v.data, server: srv.name, index: idx });
        }).catch(function (e) {
          if (done) return;
          clearTimeout(t);
          failed++;
          errors.push(srv.name + ' : ' + (e && e.name === 'AbortError' ? 'annulé' : (e && e.message) || 'échec réseau'));
          progress('Échec de ' + srv.name + ' (' + errors[errors.length - 1].split(' : ')[1] + ').', srv);
          if (failed >= n) finish(false, new Error('Tous les serveurs Overpass ont échoué :\n' + errors.join('\n') + '\nRéessayez plus tard ; la scène n\'a pas été modifiée.'));
          else launchNext();
        });
      }
      launchNext();
    });
  };

  // ------------------------------------------------------------------ conversion
  var SKIP_BUILDING = { no: 1, roof: 1, canopy: 1, carport: 1, proposed: 1, razed: 1, demolished: 1, collapsed: 1 };
  function lvlNeg(v) { if (v == null) return false; var m = String(v).match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) < 0 : false; }
  // n'arrête pas le vent à hauteur de piéton
  OSM.skipTags = function (t) {
    if (!t) return false;
    if (t.building && SKIP_BUILDING[t.building]) return true;
    if (t.location === 'underground' || t.tunnel === 'yes' || t.parking === 'underground') return true;
    if (lvlNeg(t.layer) || lvlNeg(t.level)) return true;
    return false;
  };
  function parseHeight(t) {
    if (!t) return null;
    if (t.height) { var h = parseFloat(String(t.height).replace(',', '.')); if (isFinite(h) && h > 0) return h; }
    if (t['building:levels']) { var l = parseFloat(String(t['building:levels']).replace(',', '.')); if (isFinite(l) && l > 0) return l * 3; }
    return null;
  }
  OSM.parseHeight = parseHeight;

  // assemble des chemins ouverts en anneaux fermés
  function assemble(ways) {
    var segs = ways.filter(function (w) { return w.length >= 2; }).map(function (w) { return w.slice(); });
    var rings = [];
    function key(p) { return p[0].toFixed(7) + ',' + p[1].toFixed(7); }
    while (segs.length) {
      var cur = segs.shift();
      var guard = 0;
      while (key(cur[0]) !== key(cur[cur.length - 1]) && guard++ < 10000) {
        var found = false;
        for (var k = 0; k < segs.length; k++) {
          var s = segs[k], e = key(cur[cur.length - 1]);
          if (key(s[0]) === e) { cur = cur.concat(s.slice(1)); }
          else if (key(s[s.length - 1]) === e) { cur = cur.concat(s.slice(0, -1).reverse()); }
          else continue;
          segs.splice(k, 1); found = true; break;
        }
        if (!found) break;
      }
      if (cur.length >= 4 && key(cur[0]) === key(cur[cur.length - 1])) rings.push(cur.slice(0, -1));
    }
    return rings;
  }
  function geomToPts(g) { return (g || []).map(function (p) { return [p.lat, p.lon]; }); }
  function closeRing(pts) {
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts = pts.slice(0, -1);
    return pts;
  }

  /* Convertit une réponse Overpass en objets CL-WIND autour de (lat, lon), domaine carré de côté 2R. */
  OSM.convert = function (data, lat0, lon0, R) {
    var proj = OSM.project(lat0, lon0);
    function P(ll) { return proj(ll[0], ll[1]); }
    var out = [], heights = [], stats = { buildings: 0, trees: 0, walls: 0, skipped: 0 };
    function touches(pts) {
      var b = CLW.geom.bbox(pts);
      return b[2] >= -R && b[0] <= R && b[3] >= -R && b[1] <= R;
    }
    (data.elements || []).forEach(function (el) {
      var t = el.tags || {};
      if (el.type === 'node' && t.natural === 'tree') {
        if (el.lat == null) return;
        var p = proj(el.lat, el.lon);
        if (Math.abs(p[0]) > R + 3 || Math.abs(p[1]) > R + 3) return;
        var r = 3, cd = parseFloat(String(t.diameter_crown || '').replace(',', '.'));
        if (isFinite(cd) && cd > 1 && cd < 40) r = cd / 2;
        out.push({ type: 'tree', x: p[0], y: p[1], r: r, a: CLW.LBM.TREE_A }); stats.trees++;
        return;
      }
      if (el.type === 'way' && t.barrier === 'wall') {
        if (t.wall === 'retaining_wall' || OSM.skipTags(t)) { stats.skipped++; return; }
        var hw = parseHeight(t);
        if (hw != null && hw < 1.5) { stats.skipped++; return; } // muret
        var pts = geomToPts(el.geometry).map(P);
        if (pts.length < 2 || !touches(pts)) return;
        out.push({ type: 'wall', pts: pts, thick: 0.3, height: hw }); stats.walls++;
        return;
      }
      if (!t.building) return;
      if (OSM.skipTags(t)) { stats.skipped++; return; }
      var h = parseHeight(t), rings = [];
      if (el.type === 'way') {
        var ring = closeRing(geomToPts(el.geometry));
        if (ring.length >= 3) rings.push({ outer: ring.map(P), holes: [] });
      } else if (el.type === 'relation') {
        var outers = [], inners = [];
        (el.members || []).forEach(function (m) {
          if (m.type !== 'way' || !m.geometry) return;
          (m.role === 'inner' ? inners : outers).push(geomToPts(m.geometry));
        });
        var oR = assemble(outers).map(function (r) { return r.map(P); });
        var iR = assemble(inners).map(function (r) { return r.map(P); });
        oR.forEach(function (o) {
          rings.push({ outer: o, holes: iR.filter(function (ir) { return CLW.geom.pointInRings(ir[0][0], ir[0][1], [o]); }) });
        });
      }
      rings.forEach(function (rg) {
        if (!touches(rg.outer)) return;
        out.push({ type: 'building', outer: rg.outer, holes: rg.holes, height: h, name: t.name || null, osm: el.type + '/' + el.id });
        stats.buildings++;
        if (h != null) heights.push(h);
      });
    });
    heights.sort(function (a, b) { return a - b; });
    var median = heights.length ? heights[Math.floor(heights.length / 2)] : 12;
    stats.median = median; stats.knownHeights = heights.length;
    return { objects: out, stats: stats };
  };

  // ------------------------------------------------------------------ interface
  var busy = false;
  function setStatus(txt, cls) {
    var el = document.getElementById('osm-status');
    el.textContent = txt; el.className = 'status' + (cls ? ' ' + cls : '');
  }
  OSM.run = function (q, R) {
    if (busy) return Promise.resolve();
    q = String(q || '').trim();
    if (!q) { setStatus('Saisissez une adresse ou des coordonnées (latitude, longitude).', 'err'); return Promise.resolve(); }
    if (!isFinite(R)) R = 200;
    R = Math.max(80, Math.min(400, R));
    var btn = document.getElementById('osm-go');
    busy = true; btn.disabled = true;
    var c = OSM.parseCoords(q), place;
    if (c && c.error) { setStatus(c.error, 'err'); busy = false; btn.disabled = false; return Promise.resolve(); }
    var t0 = Date.now();
    var p = c ? Promise.resolve({ lat: c.lat, lon: c.lon, label: 'Coordonnées ' + CLW.fmt(c.lat, 5) + ', ' + CLW.fmt(c.lon, 5) })
      : (setStatus('Recherche du lieu…'), OSM.geocode(q));
    return p.then(function (pl) {
      place = pl;
      setStatus('Lieu trouvé : ' + pl.label + '\nTéléchargement du bâti (rayon ' + R + ' m)…');
      return OSM.relay(OSM.buildQuery(pl.lat, pl.lon, R), {
        onProgress: function (m) { setStatus('Lieu trouvé : ' + place.label + '\n' + m + ' (' + Math.round((Date.now() - t0) / 1000) + ' s)'); }
      });
    }).then(function (res) {
      var cv = OSM.convert(res.data, place.lat, place.lon, R);
      var st = cv.stats;
      if (!cv.objects.length) throw new Error('Aucun bâtiment, arbre ou mur trouvé dans ce rayon. Vérifiez le lieu ; la scène n\'a pas été modifiée.');
      var advice = Math.round(Math.max(100, Math.min(300, 10 * st.median)) / 10) * 10;
      CLW.app.replaceOsm(cv.objects, { lat: place.lat, lon: place.lon, label: place.label, radius: R, median: st.median });
      setStatus('Lieu : ' + place.label +
        '\n' + CLW.plur(st.buildings, 'bâtiment', 'bâtiments') + ', ' + CLW.plur(st.trees, 'arbre', 'arbres') + ', ' + CLW.plur(st.walls, 'mur', 'murs') + ' (serveur ' + res.server + ').' +
        '\nHauteur médiane du bâti : ' + CLW.fmt(st.median, 0) + ' m' + (st.knownHeights ? ' (' + st.knownHeights + ' hauteurs connues).' : ' (aucune connue, 12 m par défaut).') +
        '\nRayon conseillé : environ ' + advice + ' m (10 × la hauteur du bâti, entre 100 et 300 m).' +
        '\nVérifiez le lieu sur la carte et lisez le résultat au centre : le tissu est coupé net aux bords, où les vitesses ne sont pas fiables.', 'ok');
    }).catch(function (e) {
      setStatus((e && e.message) || 'Échec de l\'import. La scène n\'a pas été modifiée.', 'err');
    }).then(function () { busy = false; btn.disabled = false; });
  };

  OSM.init = function () {
    var go = document.getElementById('osm-go');
    go.addEventListener('click', function () {
      OSM.run(document.getElementById('osm-query').value, CLW.parseNum(document.getElementById('osm-radius').value));
    });
    document.getElementById('osm-query').addEventListener('keydown', function (e) { if (e.key === 'Enter') go.click(); });
  };
})(typeof window !== 'undefined' ? window : globalThis);
