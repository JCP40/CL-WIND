/* Analyse du vent - thermique.js
 * Chaleur : température, humidité et ressenti dehors et dans le refuge, heure par heure (fichier EPW).
 * Modèle simplifié, pas de 5 min, 3 jours de mise en régime puis la journée choisie :
 * - paroi (briques, lames) découpée en 8 orientations (N, NE… NO), chacune en deux demi-épaisseurs :
 *   soleil sur la face selon son orientation, rayonnement vers le ciel (infrarouge EPW), convection selon le vent,
 *   évaporation si mouillée (goutte-à-goutte : les deux faces et les parois des ouvertures), inertie ;
 *   les faces intérieures rayonnent entre elles (facteurs de
 *   forme d'un cylindre), vers le sol et vers le ciel ou le toit ;
 * - air qui entre par les joints du côté du vent (direction de l'heure) : il prend en partie la température de
 *   ces briques-là ;
 * - air intérieur bien mélangé, renouvelé par le vent calculé (bilan) ; humidité de l'air intérieur, point de rosée,
 *   risque de condensation sur les briques et le sol ;
 * - brumisation vers la température humide, arrêtée au-delà d'une humidité réglable ;
 * - sol intérieur avec inertie et taches de soleil calculées sur la géométrie ;
 * - ressenti : température apparente de Steadman (air, humidité, vent, rayonnement par la température radiante
 *   moyenne), au centre du refuge, dehors au soleil, et cellule par cellule dans le plan ;
 * - été (juin à septembre) : heures de chaleur, eau consommée, pluie recueillie, niveau du réservoir.
 * Hors modèle : rayonnement dans les joints entre deux briques voisines, stratification, inertie de l'air.
 * Les écarts entre variantes sont plus fiables que les degrés absolus.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var TH = CLW.Thermal = {};
  var SIG = 5.67e-8, RHOCP = 1.2 * 1005, LV = 2.45e6, RAD = Math.PI / 180, PATM = 101.325, NK = 8;
  var ORI = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  function $(id) { return document.getElementById(id); }
  function fmt(v, d) { return CLW.fmt ? CLW.fmt(v, d) : (+v).toFixed(d); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function T4(T) { var k = T + 273.15; k *= k; return k * k; }

  // matériaux de la paroi : masse volumique, chaleur massique, conductivité, absorption solaire, émissivité,
  // eau retenue par la surface mouillée (kg/m²), aptitude à être mouillée
  var MATS = TH.MATS = {
    tc: { name: 'Terre cuite absorbante', rho: 1800, c: 840, lam: 0.80, abs: 0.65, eps: 0.92, hold: 2.0, wet: 1.0, note: 'brique poreuse : s\'imbibe du goutte-à-goutte qui ruisselle sur les tuiles et le rend en s\'évaporant ; inertie moyenne' },
  };

  // sols intérieurs : masse volumique, conductivité, chaleur massique, épaisseur qui travaille, absorption solaire,
  // émissivité ; kdeep = liaison au sol profond imposée (lame d'air sous un platelage) ; wet = arrosable par le
  // goutte-à-goutte ; et = part d'évapotranspiration permanente en été (végétal). Valeurs typiques : EN ISO 10456,
  // CIBSE Guide A, ASHRAE Fundamentals, Heat Island Group (LBNL). À remplacer par les fiches des fabricants.
  var FLOORS = TH.FLOORS = {
    beton: { name: 'Béton gris', rho: 2300, lam: 1.8, c: 880, th: 0.15, alpha: 0.70, eps: 0.90, note: 'référence courante' },
    corten: { name: 'Acier Corten sur béton', rho: 2300, lam: 1.8, c: 880, th: 0.15, alpha: 0.85, eps: 0.90, note: 'très absorbant : brûlant au soleil, glacé au toucher l\'hiver (acier : effusivité 14 000)' },
    pierre: { name: 'Pierre calcaire claire', rho: 2300, lam: 1.9, c: 900, th: 0.12, alpha: 0.50, eps: 0.92, note: 'claire et inerte : bon compromis été et hiver' },
    granit: { name: 'Granit', rho: 2650, lam: 2.8, c: 800, th: 0.12, alpha: 0.72, eps: 0.90, note: 'inerte mais sombre' },
    tc: { name: 'Carreaux de terre cuite (arrosables)', rho: 1900, lam: 0.9, c: 850, th: 0.10, alpha: 0.67, eps: 0.92, wet: true, note: 'mouillés par le goutte-à-goutte, ils se refroidissent en s\'évaporant' },
    bois: { name: 'Platelage mélèze sur lambourdes', rho: 550, lam: 0.14, c: 1700, th: 0.03, alpha: 0.62, eps: 0.90, kdeep: 1.0, note: 'peu de masse, tiède au toucher (effusivité 360)' },
    gazon: { name: 'Pavés enherbés, gazon', rho: 1600, lam: 1.0, c: 1500, th: 0.10, alpha: 0.77, eps: 0.95, et: 0.4, note: 'l\'évapotranspiration garde la surface proche de l\'air en été' },
    enrobe: { name: 'Enrobé (à éviter)', rho: 2300, lam: 1.0, c: 900, th: 0.10, alpha: 0.92, eps: 0.92, note: 'le plus chaud au soleil' }
  };
  // toits : absorption de la face au soleil, part de son échauffement qui atteint la sous-face (trans),
  // émissivité de la sous-face (ce que voient les personnes) ; et = évapotranspiration (végétal)
  var ROOFS = TH.ROOFS = {
    corten: { name: 'Tôle Corten simple', alpha: 0.85, trans: 0.95, epsU: 0.90, note: 'sous-face presque aussi chaude que le dessus' },
    zinc: { name: 'Zinc prépatiné, sans sous-face', alpha: 0.65, trans: 0.95, epsU: 0.30, note: 'sous-face métallique peu émissive : rayonne peu vers les personnes' },
    epdm: { name: 'EPDM noir sur bois', alpha: 0.92, trans: 0.35, epsU: 0.90, note: 'dessus jusqu\'à 70 °C, sous-face bois tiédie' },
    ventile: { name: 'Toit ventilé, sous-face bois clair', alpha: 0.80, trans: 0.12, epsU: 0.90, note: 'la lame d\'air emporte l\'essentiel de la chaleur' },
    blanc: { name: 'Membrane blanche sur bois (« cool roof »)', alpha: 0.25, trans: 0.35, epsU: 0.90, note: 'la plus fraîche au soleil' },
    vegetal: { name: 'Toiture végétalisée extensive sur bois', alpha: 0.75, trans: 0.30, epsU: 0.90, et: 0.75, note: 'surface proche de l\'air grâce à l\'évapotranspiration' }
  };
  function floorProps(F) {
    // masse : profondeur atteinte en un jour ; liaison au sol de dessous : profondeur atteinte en une semaine
    var a = F.lam / (F.rho * F.c), d = Math.sqrt(a * 86400 / Math.PI), dw = Math.sqrt(a * 7 * 86400 / Math.PI), de = Math.min(F.th, d);
    return { C: F.rho * F.c * de, k: F.kdeep != null ? F.kdeep : F.lam / Math.max(0.05, dw), b: Math.sqrt(F.lam * F.rho * F.c), d: d };
  }
  TH.floorProps = floorProps;
  // sous-face du toit : échauffement du dessus transmis, puis vue à travers son émissivité (le reste reflète la pièce)
  function roofUnder(Ta, GHI, ho, Tbim, R) {
    var dTop = R.alpha * GHI / (2 * ho + 6) * (1 - (R.et || 0));
    var Tu = Ta + R.trans * dTop;
    return { Ttop: Ta + dTop, Tu: Tu, Teff: R.epsU * Tu + (1 - R.epsU) * (Tbim != null ? Tbim : Ta) };
  }
  TH.roofUnder = roofUnder;

  var O = TH.opts = { mat: 'tc', ep: 0.11, drip: false, dripA: 11, dripB: 19, mist: false, mistEff: 0.6, mistA: 11, mistB: 19, mistRH: 70, mistMax: 40, joint: 0.04, tank: 0, catchA: 0, wsurf: 8, dripMode: 'heures', dripTon: 26, dripRH: 65, dripToff: 22, useWindTable: true, floor: 'beton', roof: 'corten', mapZone: 10 };
  // évaporation de l'eau libre des réservoirs (L sur dt) : fonction de vent de Penman, E (mm/j) = 0,26 (1 + 0,54 u2) (es - ea) hPa ;
  // eau à la température de l'air, vent à 2 m réduit de moitié (cuves sous la grille, au pied du mur)
  // l'eau n'est là qu'en été : goutte-à-goutte et cuves pleines du 1er juin au 30 septembre, cuves vidées le reste de l'année
  function waterSeason(nd) { return nd >= 152 && nd <= 273; }
  TH.waterSeason = waterSeason;
  function resEvap(o, dt) {
    var u2 = 0.5 * 0.75 * ((o.w && o.w.ws) || 0), de = Math.max(0, 10 * (psat(o.Ta) - o.pvo));
    return Math.max(0, O.wsurf) * 0.26 * (1 + 0.54 * u2) * de / 86400 * dt;
  }

  // ---------------------------------------------------------------- outils
  function psat(T) { return 0.6108 * Math.exp(17.27 * T / (T + 237.3)); } // kPa
  function wOf(pv) { return 0.622 * pv / (PATM - pv); }
  function pvOf(w) { return w * PATM / (0.622 + w); }
  function dewPoint(pv) { var g = Math.log(Math.max(1e-4, pv) / 0.6108); return 237.3 * g / (17.27 - g); }
  function wetBulb(T, RH) { // Stull (2011), °C
    return T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) + Math.atan(T + RH) - Math.atan(RH - 1.676331) + 0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) - 4.686035;
  }
  // brumisation : air refroidi vers la température humide (enthalpie constante), arrêtée si l'humidité dépasse rhMax
  function mistAir(Ta, RH, effMax, rhMax) {
    var Twb = wetBulb(Ta, RH), w0 = wOf(RH / 100 * psat(Ta));
    function at(eff) { var Tm = Ta - eff * (Ta - Twb), wm = w0 + 1006 * (Ta - Tm) / LV; return { T: Tm, w: wm, rh: 100 * pvOf(wm) / psat(Tm), eff: eff }; }
    var r = at(effMax); if (r.rh <= rhMax) return r;
    var lo = 0, hi = effMax; for (var it = 0; it < 14; it++) { var mid = 0.5 * (lo + hi); if (at(mid).rh > rhMax) hi = mid; else lo = mid; }
    return at(lo);
  }
  // température apparente de Steadman (1994), avec le rayonnement : air, vapeur (hPa), vent à 10 m, rayonnement net
  // absorbé par le corps estimé d'après la température radiante moyenne
  function apparent(Ta, pv, ws10, Tmrt) {
    var Q = 0.97 * SIG * (T4(Tmrt) - T4(Ta));
    return Ta + 3.48 * pv - 0.70 * ws10 + 0.70 * Q / (ws10 + 10) - 4.25;
  }
  TH.apparent = apparent;
  function fpOf(alt) { return alt > 0 ? 0.308 * Math.cos(alt * RAD * (0.998 - alt * alt / 50000)) : 0; } // surface projetée d'une personne debout
  // température radiante moyenne d'une personne : moitié haute (ciel visible svf, le reste à Tobs), moitié basse (sol Tg)
  function mrt(Lsky, svf, Tobs, Tg, sunlit, alt, DNI, DHI, Kg) {
    var L = 0.5 * (svf * Lsky + (1 - svf) * 0.95 * SIG * T4(Tobs)) + 0.5 * 0.95 * SIG * T4(Tg);
    var K = 0.7 * ((sunlit ? fpOf(alt) * DNI : 0) + 0.5 * svf * DHI + 0.5 * Kg);
    return Math.pow((0.97 * L + K) / (0.97 * SIG), 0.25) - 273.15;
  }
  function inHours(t, a, b) { var h = ((t % 24) + 24) % 24; return a <= b ? h >= a && h < b : h >= a || h < b; }
  function faceAt(arr, az) { var a = (((az % 360) + 360) % 360) / 45, k = Math.floor(a), f = a - k; return arr[k % NK] * (1 - f) + arr[(k + 1) % NK] * f; }
  function hull(pts) {
    pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cr(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [], i;
    for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
    for (i = pts.length - 1; i >= 0; i--) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop(); up.push(pts[i]); }
    up.pop(); lo.pop(); return lo.concat(up);
  }
  function inPoly(x, y, P) { var c = false; for (var i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < (P[j][0] - P[i][0]) * (y - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; }

  // ---------------------------------------------------------------- géométrie de l'ouvrage
  // paroi = écrans (briques, lames) ; intérieur = enveloppe convexe des écrans resserrée de 5 %
  var geoKey = null, GEO = null;
  TH.geometry = function () {
    var key = CLW.Sun ? CLW.Sun.sceneKey() : ''; if (key === geoKey && GEO) return GEO;
    geoKey = key; skyCache.key = null;
    GEO = buildGeo(CLW.Sun.meshes(), CLW.Live && CLW.Live.last);
    return GEO;
  };
  // géométrie d'une saison ('ete' ou 'hiver') : scène gardée par la liaison Grasshopper (entrée « saison »),
  // sinon la géométrie courante
  var geoSeason = {};
  TH.geometryFor = function (s) {
    var L = CLW.Live, d = L && L.bySeason && L.bySeason[s];
    if (!d || !CLW.Sun.meshesOf) return null;
    var k = d.rev + '|' + (L.origin || [0, 0]).join(',');
    if (geoSeason[s] && geoSeason[s].k === k) return geoSeason[s].g;
    var g = buildGeo(CLW.Sun.meshesOf(d), d);
    geoSeason[s] = { k: k, g: g };
    return g;
  };
  TH.seasons = function () { var L = CLW.Live; return L && L.bySeason ? Object.keys(L.bySeason) : []; };
  function buildGeo(M, D) {
    var pts = [], zmax = 0, GEO;
    M.scr.forEach(function (m) { var v = m.v; for (var i = 0; i < v.length; i += 3) { if ((i / 3) % 3 === 0) pts.push([v[i], v[i + 1]]); zmax = Math.max(zmax, v[i + 2]); } });
    if (pts.length < 10) return null;
    var H = hull(pts), cx = 0, cy = 0; H.forEach(function (p) { cx += p[0]; cy += p[1]; }); cx /= H.length; cy /= H.length;
    var Hin = H.map(function (p) { return [cx + 0.95 * (p[0] - cx), cy + 0.95 * (p[1] - cy)]; });
    var A = 0, Pm = 0; for (var i = 0; i < Hin.length; i++) { var a = Hin[i], b = Hin[(i + 1) % Hin.length]; A += a[0] * b[1] - b[0] * a[1]; Pm += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    A = Math.abs(A) / 2;
    var bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity; Hin.forEach(function (p) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); by0 = Math.min(by0, p[1]); by1 = Math.max(by1, p[1]); });
    var res = Math.max(0.03, Math.sqrt(A) / 90), nx = Math.ceil((bx1 - bx0) / res), ny = Math.ceil((by1 - by0) / res), inside = new Uint8Array(nx * ny), nIn = 0;
    for (var j = 0; j < ny; j++) for (var i2 = 0; i2 < nx; i2++) if (inPoly(bx0 + (i2 + 0.5) * res, by0 + (j + 0.5) * res, Hin)) { inside[j * nx + i2] = 1; nIn++; }
    var tris = [];
    M.vol.concat(M.scr).forEach(function (m) { var v = m.v, f = m.f; for (var t = 0; t < f.length; t += 3) tris.push(v, 3 * f[t], 3 * f[t + 1], 3 * f[t + 2]); });
    GEO = { hull: Hin, cx: cx, cy: cy, area: A, perim: Pm, R: Math.sqrt(A / Math.PI), Hw: Math.max(0.5, zmax), grid: { x0: bx0, y0: by0, nx: nx, ny: ny, res: res, inside: inside, nIn: nIn }, tris: tris };
    coverFields(GEO);
    GEO.Awall = Pm * GEO.Hw; // surface de paroi (une face)
    roofSetup(GEO, M, D);
    return GEO;
  }
  // couverture zénithale, facteurs de forme et vue du ciel d'une géométrie (recalculés pour chaque angle des lames du toit)
  function coverFields(GEO) {
    // couverture zénithale (toit) : éléments au-dessus de 60 % de la hauteur projetés à la verticale
    var cover = shade([0, 0, 1], 0.6 * GEO.Hw, GEO);
    GEO.open = 1 - cover.frac; // part du sol intérieur sous le ciel ouvert (vue verticale)
    GEO.roof = cover.frac > 0.15;
    if (!GEO.roof) GEO.open = 1;
    // facteurs de forme d'un cylindre de rayon R et de hauteur Hw : sol → disque du haut, paroi → sol, paroi → paroi
    var X = 2 + Math.pow(GEO.Hw / GEO.R, 2), Fdd = (X - Math.sqrt(X * X - 4)) / 2, Fwf = GEO.R * (1 - Fdd) / (2 * GEO.Hw);
    GEO.Fdd = Fdd; GEO.Fwf = Fwf; GEO.Fww = Math.max(0, 1 - 2 * Fwf);
    GEO.fsky = GEO.open * Fdd; GEO.froof = (1 - GEO.open) * Fdd;
    // personne debout au centre (1,1 m) : part de la demi-sphère haute vers l'ouverture du toit, le toit, la paroi
    var hz = Math.max(0.3, GEO.Hw - 1.1), aO = GEO.R * Math.sqrt(GEO.open);
    GEO.pOpen = 1 - hz / Math.hypot(hz, aO); GEO.pRoof = Math.max(0, 1 - hz / Math.hypot(hz, GEO.R) - GEO.pOpen);
  }

  // ---------------------------------------------------------------- lames du toit mobiles, heure par heure
  // Entrée « lames_toit » de CL-WIND Live : centre, axe (u), longueur, largeur, épaisseur de chaque lame (en m, z depuis
  // le bas de la scène). Leurs triangles reçus sont retirés de la géométrie de base ; à chaque heure, les lames sont
  // reconstruites à l'angle donné par la règle (« lames_regle ») et la couverture du toit est recalculée.
  // Angle a (°) : 0 = à plat ; a > 0 : bord nord relevé ; a < 0 : bord sud relevé (lame dans l'axe d'un soleil au sud).
  function roofSetup(GEO, M, D) {
    var RB = D && D.roofBlades; if (!RB || !RB.length) return;
    var org = CLW.Live && CLW.Live.origin ? CLW.Live.origin : [0, 0];
    var B = RB.map(function (b) {
      var u = [b.u[0], b.u[1], 0], n = [-u[1], u[0], 0];
      if (n[1] < 0 || (n[1] === 0 && n[0] < 0)) { n[0] = -n[0]; n[1] = -n[1]; } // n : horizontale perpendiculaire, côté nord
      return { c: [b.c[0] - org[0], b.c[1] - org[1], b.c[2]], u: u, n: n, L: b.L, W: b.W, t: b.t };
    });
    function isBlade(m) {
      var v = m.v, x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (var i = 0; i < v.length; i += 3) { x0 = Math.min(x0, v[i]); x1 = Math.max(x1, v[i]); y0 = Math.min(y0, v[i + 1]); y1 = Math.max(y1, v[i + 1]); z0 = Math.min(z0, v[i + 2]); z1 = Math.max(z1, v[i + 2]); }
      var cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
      for (var q = 0; q < B.length; q++) if (Math.abs(cx - B[q].c[0]) < 0.05 && Math.abs(cy - B[q].c[1]) < 0.05 && Math.abs(cz - B[q].c[2]) < 0.12) return true;
      return false;
    }
    var base = [], hits = 0;
    function push(m) { var v = m.v, f = m.f; for (var t = 0; t < f.length; t += 3) base.push(v, 3 * f[t], 3 * f[t + 1], 3 * f[t + 2]); }
    M.vol.forEach(push);
    M.scr.forEach(function (m) { if (isBlade(m)) hits++; else push(m); });
    GEO.trisBase = base; GEO.blades = B; GEO.bladeHits = hits; GEO.angCache = {};
  }
  function bladeTris(B, a) {
    var out = [], ca = Math.cos(a * RAD), sa = Math.sin(a * RAD), F = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
    B.forEach(function (b) {
      var w = [b.n[0] * ca, b.n[1] * ca, sa], th = [b.u[1] * w[2], -b.u[0] * w[2], b.u[0] * w[1] - b.u[1] * w[0]]; // largeur, épaisseur (u × w)
      var v = new Float32Array(24), q = 0;
      for (var i = 0; i < 8; i++) {
        var su = (i & 1 ? 0.5 : -0.5) * b.L, sw = (i & 2 ? 0.5 : -0.5) * b.W, st = (i & 4 ? 0.5 : -0.5) * b.t;
        v[q++] = b.c[0] + su * b.u[0] + sw * w[0] + st * th[0]; v[q++] = b.c[1] + su * b.u[1] + sw * w[1] + st * th[1]; v[q++] = b.c[2] + sw * w[2] + st * th[2];
      }
      for (var t = 0; t < F.length; t += 3) out.push(v, 3 * F[t], 3 * F[t + 1], 3 * F[t + 2]);
    });
    return out;
  }
  // géométrie avec les lames du toit à l'angle a (mise en cache au degré près)
  function geoAng(G, a) {
    if (!G || !G.blades || a == null) return G;
    var key = Math.round(a); if (G.angCache[key]) return G.angCache[key];
    var g2 = Object.create(G); // garde l'enveloppe, la grille, la paroi ; seuls les triangles et la couverture changent
    g2.tris = G.trisBase.concat(bladeTris(G.blades, key));
    coverFields(g2);
    return (G.angCache[key] = g2);
  }
  // saison des lames : comme la commande automatique de Grasshopper (été si la moyenne de l'air des 3 jours précédents
  // atteint Te), sinon d'après la date
  function roofSeason(P, nd) {
    var R = P.roofRule; if (R.Te == null) return seasonOf(nd) === 'ete' ? 'ete' : 'hiver';
    if (P.roofSeasonC[nd]) return P.roofSeasonC[nd];
    var s = 0, c = 0;
    for (var d = nd - 3; d < nd; d++) { var dd = ((d - 1) % 365 + 365) % 365; for (var h = 0; h < 24; h++) { var T = P.HR.T[dd * 24 + h]; if (isFinite(T)) { s += T; c++; } } }
    return (P.roofSeasonC[nd] = c && s / c >= R.Te ? 'ete' : 'hiver');
  }
  // angle des lames du toit au jour nd, heure normale hh, air Ta : hiver = dans l'axe des rayons entre Hd et Hf
  // (heure solaire), sinon fermées ; été = Av si l'air dépasse Ts, sinon fermées
  function roofAngle(P, nd, hh, Ta, G) {
    var R = P.roofRule; if (!R || !G || !G.blades) return null;
    if (roofSeason(P, nd) === 'ete') return Ta > R.Ts ? R.Av : 0;
    var p = P.SUN.pos(nd, hh, P.site); if (p.alt <= 0) return 0;
    var hs = 12 + (hh - p.noon); if (hs < R.Hd || hs > R.Hf) return 0;
    var sv = P.SUN.vec(p), n = G.blades[0].n, sn = sv[0] * n[0] + sv[1] * n[1];
    return -Math.max(0, Math.min(90, Math.atan2(sv[2], -sn) / RAD));
  }
  TH.roofAngle = function (nd, hh, Ta) { var P = setup(); return P ? roofAngle(P, nd, hh, Ta, geoAt(P, nd)) : null; };
  // part du sol intérieur à l'ombre pour une direction de soleil SD (projection des triangles sur z = 0)
  function shade(SD, zmin, geo) {
    var GG = geo || GEO, g = GG.grid, mark = new Uint8Array(g.nx * g.ny), tr = GG.tris, sz = Math.max(1e-3, SD[2]), kx = SD[0] / sz, ky = SD[1] / sz;
    for (var q = 0; q < tr.length; q += 4) {
      var v = tr[q], a = tr[q + 1], b = tr[q + 2], c = tr[q + 3];
      if (zmin && v[a + 2] < zmin && v[b + 2] < zmin && v[c + 2] < zmin) continue;
      var ax = v[a] - kx * v[a + 2], ay = v[a + 1] - ky * v[a + 2], bx = v[b] - kx * v[b + 2], by = v[b + 1] - ky * v[b + 2], cx = v[c] - kx * v[c + 2], cy = v[c + 1] - ky * v[c + 2];
      var i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - g.x0) / g.res)), i1 = Math.min(g.nx - 1, Math.floor((Math.max(ax, bx, cx) - g.x0) / g.res));
      var j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - g.y0) / g.res)), j1 = Math.min(g.ny - 1, Math.floor((Math.max(ay, by, cy) - g.y0) / g.res));
      if (i1 < i0 || j1 < j0) continue;
      var den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-12) {
        var nn = Math.max(i1 - i0, j1 - j0) + 1;
        for (var s = 0; s <= nn; s++) { var f2 = s / nn, px = ax + (bx - ax) * f2, py = ay + (by - ay) * f2, ii = Math.floor((px - g.x0) / g.res), jj = Math.floor((py - g.y0) / g.res); if (ii >= 0 && jj >= 0 && ii < g.nx && jj < g.ny) mark[jj * g.nx + ii] = 1; }
        continue;
      }
      for (var j = j0; j <= j1; j++) {
        var py2 = g.y0 + (j + 0.5) * g.res;
        for (var i = i0; i <= i1; i++) {
          var k = j * g.nx + i; if (mark[k] || !g.inside[k]) continue;
          var px2 = g.x0 + (i + 0.5) * g.res;
          var w0 = ((by - cy) * (px2 - cx) + (cx - bx) * (py2 - cy)) / den, w1 = ((cy - ay) * (px2 - cx) + (ax - cx) * (py2 - cy)) / den;
          if (w0 >= -0.02 && w1 >= -0.02 && w0 + w1 <= 1.02) mark[k] = 1;
        }
      }
    }
    var n = 0; for (var k2 = 0; k2 < mark.length; k2++) if (mark[k2] && g.inside[k2]) n++;
    return { frac: g.nIn ? n / g.nIn : 0, mark: mark };
  }
  // géométrie à utiliser le jour nd : celle de la saison si elle a été envoyée, sinon la courante
  function geoAt(P, nd) { var s = seasonOf(nd); return (P.Gs && P.Gs[s]) || P.G; }
  TH.geoAt = function (nd) { var P = { G: TH.geometry(), Gs: { ete: TH.geometryFor('ete'), hiver: TH.geometryFor('hiver') } }; return geoAt(P, nd); };
  TH.shadeMap = function (SD) { if (!TH.geometry()) return null; return shade(SD, 0); };
  // ombre sur une grille du plan (fenêtre de la carte, rangées vers le sud) à la hauteur zref, direction SD
  function shadeWin(SD, W, zref) {
    var mark = new Uint8Array(W.nx * W.ny), tr = GEO.tris, sz = Math.max(1e-3, SD[2]), kx = SD[0] / sz, ky = SD[1] / sz, r = W.res;
    for (var q = 0; q < tr.length; q += 4) {
      var v = tr[q], a = tr[q + 1], b = tr[q + 2], c = tr[q + 3];
      var za = v[a + 2] - zref, zb = v[b + 2] - zref, zc = v[c + 2] - zref;
      if (za <= 0.02 && zb <= 0.02 && zc <= 0.02) continue;
      za = Math.max(0, za); zb = Math.max(0, zb); zc = Math.max(0, zc);
      // coordonnées de cellule (I vers l'est, J vers le sud)
      var ax = (v[a] - kx * za - W.x0) / r, ay = (W.yt - (v[a + 1] - ky * za)) / r, bx = (v[b] - kx * zb - W.x0) / r, by = (W.yt - (v[b + 1] - ky * zb)) / r, cx = (v[c] - kx * zc - W.x0) / r, cy = (W.yt - (v[c + 1] - ky * zc)) / r;
      var i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx))), i1 = Math.min(W.nx - 1, Math.floor(Math.max(ax, bx, cx)));
      var j0 = Math.max(0, Math.floor(Math.min(ay, by, cy))), j1 = Math.min(W.ny - 1, Math.floor(Math.max(ay, by, cy)));
      if (i1 < i0 || j1 < j0) continue;
      if (i0 === i1 && j0 === j1) { mark[j0 * W.nx + i0] = 1; continue; }
      var den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(den) < 1e-9) continue;
      for (var j = j0; j <= j1; j++) {
        var py = j + 0.5;
        for (var i = i0; i <= i1; i++) {
          var k = j * W.nx + i; if (mark[k]) continue;
          var px = i + 0.5, w0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den, w1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den;
          if (w0 >= -0.05 && w1 >= -0.05 && w0 + w1 <= 1.05) mark[k] = 1;
        }
      }
    }
    return mark;
  }

  // ---------------------------------------------------------------- ventilation (calcul du vent)
  function ventilation(G) {
    var E = CLW.engine, S = CLW.state, b = E && E.bilan && E.bilan.res;
    if (b && b.qin > 0 && E.bilan.innerArea > 0) return { achRef: 3600 * b.qin / E.bilan.innerArea, vref: S.wind.speed, src: 'calcul du vent (' + (S.mode3d ? '3D' : 'plan 2D') + ', bilan)', pen: b.pen };
    var pen = 0.2;
    return { achRef: 3600 * pen * S.wind.speed * 2 * G.R / G.area, vref: S.wind.speed, src: 'estimation (pénétration 20 %), lancez le calcul du vent pour la préciser', pen: pen };
  }


  // ---------------------------------------------------------------- vent réel : balayage des directions
  // table : pour chaque direction « venant de », renouvellement d'air par m/s de vent de référence (ach),
  // vitesse intérieure rapportée au vent de référence (u), pénétration ; interpolée en cercle
  // une table par saison de géométrie : 'ete' (juin à septembre), 'hiver' (décembre à février), 'all' (le reste ou à défaut)
  TH.windTables = {}; TH.windTable = null;
  var WKEY = 'clwind-windtables-' + (location.port || 'file');
  try { var wsv = JSON.parse(localStorage.getItem(WKEY) || 'null'); if (wsv) { TH.windTables = wsv; TH.windTable = wsv.all || wsv.ete || wsv.hiver || null; } } catch (e) { /* rien */ }
  TH.clearWindTables = function () { TH.windTables = {}; TH.windTable = null; try { localStorage.removeItem(WKEY); } catch (e) { /* rien */ } };
  function seasonOf(nd) { return nd >= 152 && nd <= 273 ? 'ete' : (nd >= 335 || nd <= 59) ? 'hiver' : 'all'; }
  function windAt(wd, nd) {
    var Ts = TH.windTables, T = (nd != null && Ts[seasonOf(nd)]) || Ts.all || Ts.ete || Ts.hiver;
    if (!T || !T.rows || T.rows.length < 2 || !O.useWindTable) return null;
    var R = T.rows, n = R.length, d = ((wd % 360) + 360) % 360;
    for (var i = 0; i < n; i++) {
      var a = R[i], b = R[(i + 1) % n], da = a.dir, db = b.dir <= a.dir ? b.dir + 360 : b.dir, dd = d < da ? d + 360 : d;
      if (dd >= da && dd <= db) {
        var t = db > da ? (dd - da) / (db - da) : 0;
        return { ach: a.ach + t * (b.ach - a.ach), u: a.u + t * (b.u - a.u), pen: a.pen + t * (b.pen - a.pen) };
      }
    }
    return R[0];
  }
  TH.windAt = windAt;
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  var SW = TH.sweep = { running: false, progress: 0, msg: '' };
  TH.sweepWinds = async function (n, onStep, which) {
    which = which || 'all';
    var E = CLW.engine, S = CLW.state; if (SW.running || !E) return null;
    n = n || 16; SW.running = true; SW.progress = 0; SW.msg = '';
    var dir0 = S.wind.dir, rows = [];
    try {
      for (var i = 0; i < n; i++) {
        var dir = Math.round(i * 360 / n) % 360, tReset = E.t0;
        CLW.setWind(dir === S.wind.dir ? (dir + 1) % 360 : dir, null); // force un nouveau calcul même si la direction est déjà celle-ci
        if (dir !== S.wind.dir) CLW.setWind(dir, null);
        var t0 = performance.now();
        while (E.t0 === tReset && performance.now() - t0 < 15000) await wait(100);
        while (!(E.stable && E.bilan && E.bilan.res) && performance.now() - t0 < 300000) await wait(400);
        if (E.bilan && CLW.Bilan) CLW.Bilan.compute(E, S);
        var b = E.bilan && E.bilan.res;
        if (b && E.bilan.innerArea > 0 && S.wind.speed > 0)
          rows.push({ dir: S.wind.dir, ach: 3600 * b.qin / E.bilan.innerArea / S.wind.speed, u: b.uMean / S.wind.speed, pen: b.pen, calm: b.cls ? b.cls[0] : null, stable: !!E.stable });
        SW.progress = (i + 1) / n; SW.msg = 'Direction ' + (i + 1) + ' / ' + n + ' (' + dir + '°)';
        if (onStep) onStep();
      }
    } finally {
      CLW.setWind(dir0, null); SW.running = false;
    }
    rows.sort(function (a, b) { return a.dir - b.dir; });
    TH.windTable = TH.windTables[which] = { rows: rows, n: n, which: which, speed: CLW.state.wind.speed, date: new Date().toISOString() };
    try { localStorage.setItem(WKEY, JSON.stringify(TH.windTables)); } catch (e) { /* rien */ }
    return TH.windTable;
  };

  // ---------------------------------------------------------------- modèle : réglages, état, pas de temps
  function setup() {
    var G = TH.geometry(), SUN = CLW.Sun, D = CLW.EPW && CLW.EPW.data && CLW.EPW.data(), HR = D && D.hourly;
    if (!G || !HR) return null;
    var mat = MATS[O.mat] || MATS.tc, e = clamp(O.ep, 0.02, 0.6), phi = 0.3, E = CLW.engine;
    if (E && E.rast && E.rast.screens && E.rast.screens.length) phi = clamp(E.rast.screens[0].phi, 0.03, 0.9);
    var Tdeep = 0; for (var q = 0; q < 8760; q++) Tdeep += HR.T[q]; Tdeep /= 8760;
    var P = { G: G, HR: HR, SUN: SUN, site: SUN.site(), mat: mat, e: e, Ch: mat.rho * mat.c * e / 2, Gc: mat.lam / (e / 2), phi: phi,
      Asol: G.Awall * (1 - phi), Af: G.area, V: G.area * G.Hw, vent: ventilation(G), f15: Math.pow(1.5 / 10, 0.25), Tdeep: Tdeep, sunCache: {},
      floor: FLOORS[O.floor] || FLOORS.beton, floorP: floorProps(FLOORS[O.floor] || FLOORS.beton) };
    P.Ak = P.Asol / NK;
    // géométries d'été et d'hiver envoyées par Grasshopper (entrée « saison ») : ombre, toit, facteurs de forme
    P.Gs = { ete: TH.geometryFor('ete'), hiver: TH.geometryFor('hiver') };
    P.station = (CLW.Live && CLW.Live.last && CLW.Live.last.station) || null; // commande automatique (clapets en tempête)
    P.roofRule = (O.roofHourly !== false && CLW.Live && CLW.Live.last && CLW.Live.last.roofRule) || null; // lames du toit heure par heure
    P.roofSeasonC = {};
    // paroi par orientation : par défaut identique partout ; avec l'entrée « briques », profondeur et part couverte
    // mesurées (mur épais, briques solaires, muret) → masse, conduction et surface de chaque face
    P.ChK = []; P.GcK = []; P.AkK = []; P.eK = [];
    var LW = CLW.Live && CLW.Live.last, WK = LW && LW.wallK, dRef = (LW && LW.brick && LW.brick.depth) || 0.3;
    for (var kw = 0; kw < NK; kw++) {
      var wq = WK && WK.length === NK ? WK[kw] : null;
      var ek = wq && wq.n ? clamp(e * wq.depth / dRef, 0.01, 0.8) : e, ak = wq ? G.Awall / NK * clamp(wq.cover, 0, 1) * (1 - phi) : P.Ak;
      P.eK.push(ek); P.ChK.push(mat.rho * mat.c * ek / 2); P.GcK.push(mat.lam / (ek / 2)); P.AkK.push(Math.max(1e-3, ak));
    }
    P.wallK = WK || null;
    if (WK && WK.length === NK) { P.Asol = P.AkK.reduce(function (a, b) { return a + b; }, 0); P.Ak = P.Asol / NK; }
    // vraie brique et lames, mesurées dans Grasshopper (composant CL-WIND Live, entrées « brique » et « lames ») :
    // par orientation k, nombre d'ouvertures, fermeture moyenne des lames, section de passage et rapport surface
    // mouillée / section (parois de l'ouverture sur toute l'épaisseur + deux faces de lame)
    var LD = CLW.Live && CLW.Live.last, BR = LD && LD.brick;
    if (BR && BR.aOpen > 0 && BR.depth > 0) {
      var BL = (LD.blades || []), nb = new Float64Array(NK), cl = new Float64Array(NK), ab = 0;
      BL.forEach(function (b) { var kk = Math.round((((b[0] % 360) + 360) % 360) / 45) % NK; nb[kk]++; cl[kk] += b[1]; ab += b[2]; });
      ab = BL.length ? ab / BL.length : 0;
      var nTot = BL.length || Math.max(1, Math.round(G.Awall / Math.max(0.01, BR.w * BR.h)));
      P.jk = { n: [], aflow: [], aj: [], closed: [], src: BR, nTot: nTot, bladeA: ab };
      for (var kk2 = 0; kk2 < NK; kk2++) {
        var n2 = BL.length ? nb[kk2] : nTot / NK, c2 = nb[kk2] ? cl[kk2] / nb[kk2] : 0;
        var af = BR.aOpen * Math.max(0.1, 1 - 0.9 * c2);
        P.jk.n.push(Math.max(1, n2)); P.jk.closed.push(c2); P.jk.aflow.push(af);
        P.jk.aj.push((BR.pWet * BR.depth + 2 * ab) / af);
      }
    }
    return P;
  }
  // part du sol intérieur au soleil, heure par heure (calcul sur la géométrie, mis en cache par jour)
  function sunFloorDay(P, n) {
    if (P.sunCache[n]) return P.sunCache[n];
    var a = new Float32Array(25), gg = geoAt(P, n);
    for (var h = 0; h <= 24; h++) {
      var p = P.SUN.pos(n, h, P.site), g2 = gg;
      if (p.alt > 1 && P.roofRule && gg && gg.blades) { var wh = P.SUN.epwAt(n, Math.min(23.99, h)); g2 = geoAng(gg, roofAngle(P, n, h, wh ? wh.T : 15, gg)); }
      a[h] = p.alt > 1 ? 1 - shade(P.SUN.vec(p), 0, g2).frac : 0;
    }
    return (P.sunCache[n] = a);
  }
  function newState(T0) {
    var X = { Tbo: new Float64Array(NK), Tbi: new Float64Array(NK), water: new Float64Array(NK), Tf: T0 + 1 };
    for (var k = 0; k < NK; k++) { X.Tbo[k] = T0; X.Tbi[k] = T0; }
    return X;
  }
  // un pas de temps dt (s) au jour nd (1..365), heure hh ; water : l'eau est disponible (réservoir non vide)
  function step(P, X, nd, hh, dt, sunF, water) {
    var G = geoAt(P, nd), mat = P.mat, SUN = P.SUN, HR = P.HR;
    var w = SUN.epwAt(nd, hh); if (!w) return null;
    var hr0 = HR.IR[(nd - 1) * 24 + Math.min(23, Math.floor(hh))];
    var Ta = w.T, RH = clamp(w.RH, 5, 100), v15 = Math.max(0.3, w.ws * P.f15);
    var roofA = P.roofRule ? roofAngle(P, nd, hh, Ta, G) : null; if (roofA != null) G = geoAng(G, roofA); // lames du toit à l'angle de l'heure
    var Lsky = isFinite(hr0) && hr0 > 50 ? hr0 : SIG * T4(Ta - 12), Tsky = Math.pow(Lsky / SIG, 0.25) - 273.15;
    var ps = SUN.pos(nd, hh + dt / 7200, P.site), up = ps.alt > 0, cosA = Math.cos(ps.alt * RAD), sinA = Math.sin(ps.alt * RAD);
    var beam = up ? w.DNI : 0;
    var fsun = up ? sunF[Math.min(24, Math.floor(hh))] * (1 - (hh % 1)) + sunF[Math.min(24, Math.floor(hh) + 1)] * (hh % 1) : 0;
    var If = beam * sinA * fsun + G.fsky * w.DHI + 0.3 * G.froof * w.DHI;
    var ach = Math.max(0.5, P.vent.achRef * v15 / Math.max(0.3, P.vent.vref)), Q = ach * P.V / 3600;
    var vint = Math.max(0.1, P.vent.pen * v15);
    var wt = windAt(w.wd, nd); // vent réel : la direction de l'heure choisit la ligne du balayage
    if (wt) { ach = Math.max(0.5, wt.ach * v15); Q = ach * P.V / 3600; vint = Math.max(0.1, wt.u * v15); }
    // commande automatique (station météo) : par vent de tempête, les clapets se ferment (il ne reste que les fuites)
    var closed = !!(P.station && w.ws >= P.station.Vstorm);
    if (closed) { ach = Math.max(0.5, 0.1 * ach); Q = ach * P.V / 3600; vint = Math.max(0.1, 0.3 * vint); }
    // brumisation (arrêtée au-delà de l'humidité maximale), humidité de l'air entrant
    var pvo = RH / 100 * psat(Ta), Tm = Ta, wm = wOf(pvo), qm = 0;
    if (O.mist && water && inHours(hh, O.mistA, O.mistB) && Ta > 18) {
      var mr = mistAir(Ta, RH, clamp(O.mistEff, 0, 0.95), clamp(O.mistRH, 30, 100));
      Tm = mr.T; wm = mr.w; qm = RHOCP * Q * (Ta - Tm) / LV;
      // débit des buses limité (L/h) : au-delà, tout l'air entrant ne peut pas être brumisé
      var qcap = Math.max(0, O.mistMax) / 3600;
      if (qm > qcap) { qm = qcap; Tm = Ta - qcap * LV / (RHOCP * Q); wm = wOf(pvo) + 1006 * (Ta - Tm) / LV; }
    }
    // air entrant par les joints du côté du vent (pondération par orientation), échange avec ces briques
    var wdr = w.wd, sw = 0, wk = new Float64Array(NK);
    for (var k = 0; k < NK; k++) { wk[k] = Math.max(0, Math.cos((wdr - 45 * k) * RAD)); sw += wk[k]; }
    for (k = 0; k < NK; k++) wk[k] = sw > 0 ? wk[k] / sw : 1 / NK;
    // mouillage (goutte-à-goutte) : l'eau ruisselle sur toute la brique, faces extérieure et intérieure et parois des
    // ouvertures. Pilotage : horaires, ou sonde T / HR (marche au-dessus de dripTon °C et sous dripRH %, arrêt sous
    // dripToff °C ou par pluie)
    var rainNow = HR.P ? HR.P[(nd - 1) * 24 + Math.min(23, Math.floor(hh))] > 0 : false;
    if (O.dripMode === 'sonde') X.pump = X.pump ? (Ta >= O.dripToff && !rainNow) : (Ta > O.dripTon && RH < O.dripRH && !rainNow);
    var dripOn = O.drip && water && mat.wet > 0 && (O.dripMode === 'sonde' ? !!X.pump : inHours(hh, O.dripA, O.dripB));
    var wetK = new Float64Array(NK);
    for (k = 0; k < NK; k++) wetK[k] = dripOn ? mat.wet : (X.water[k] > 0 ? mat.wet * Math.min(1, X.water[k] / Math.max(0.2, mat.hold)) : 0);
    // échange de l'air avec les parois des ouvertures (efficacité par le nombre d'unités de transfert) ; parois
    // mouillées : la chaleur cédée par l'air sert à évaporer l'eau, l'air s'humidifie d'autant (enthalpie constante)
    // sans brique de Grasshopper : fente de largeur « joint » sur l'épaisseur de la paroi ; avec : vraie brique,
    // par orientation (le débit de cette orientation se partage entre ses ouvertures)
    var uj = Math.max(0.05, Q / Math.max(0.1, 0.5 * G.Awall * P.phi)), aj = 2 * P.e / Math.max(0.005, O.joint), hj = 4 + 4 * uj;
    var effJ = 1 - Math.exp(-hj * aj / (RHOCP * uj)), Tsup = Tm, dTlat = 0, effM = 0;
    var TexK = new Float32Array(NK); // air à la sortie des briques de chaque face (avant mélange)
    for (k = 0; k < NK; k++) {
      var eK = effJ;
      if (P.jk) { var uK = Math.max(0.05, Q * wk[k] / (P.jk.n[k] * P.jk.aflow[k])); eK = wk[k] > 0 ? 1 - Math.exp(-(4 + 4 * uK) * P.jk.aj[k] / (RHOCP * uK)) : 0; }
      // face sous le vent : l'air la traverse de l'intérieur vers l'extérieur, avec l'efficacité de la fente type
      var eX = wk[k] > 0 ? eK : effJ;
      TexK[k] = Tm + eX * (0.5 * (X.Tbo[k] + X.Tbi[k]) - Tm);
      effM += wk[k] * eK;
      var dTk = wk[k] * eK * (0.5 * (X.Tbo[k] + X.Tbi[k]) - Tm);
      Tsup += dTk; if (dTk < 0) dTlat -= dTk * wetK[k];
    }
    var wsup = Math.min(wOf(psat(Tsup)), wm + 1006 * dTlat / LV); // humidité de l'air après les ouvertures
    var ho = 5.7 + 3.8 * v15, hi = 3 + 4 * vint, hf = 3 + 3 * vint;
    var sTbi = 0, sTbw = 0, sAw = 0; for (k = 0; k < NK; k++) { sTbi += X.Tbi[k]; sTbw += X.Tbi[k] * P.AkK[k]; sAw += P.AkK[k]; }
    var Tbim = sAw > 0 ? sTbw / sAw : sTbi / NK; // faces pondérées par leur surface (murs épais, muret)
    var RF = ROOFS[O.roof] || ROOFS.corten, ru = roofUnder(Ta, w.GHI, ho, Tbim, RF), Troof = ru.Teff; // sous-face vue par la pièce
    var Ti = (RHOCP * Q * Tsup + hi * P.Asol * Tbim + hf * P.Af * X.Tf) / (RHOCP * Q + hi * P.Asol + hf * P.Af);
    var pvsup = pvOf(wsup), qeiS = 0;
    var Ttop = G.open * Tsky + (1 - G.open) * Troof, qeS = 0, evap = 0, sTbo = 0, Tbmax = -1e9, Tbimin = 1e9;
    for (k = 0; k < NK; k++) {
      var cosI = cosA * Math.cos((ps.az - 45 * k) * RAD);
      var Iout = beam * Math.max(0, cosI) + 0.5 * w.DHI + 0.1 * w.GHI;
      var Iin = P.phi * beam * Math.max(0, -cosI) + G.Fwf * G.open * w.DHI;
      if (dripOn) X.water[k] = mat.hold > 0 ? Math.max(X.water[k], mat.hold) : 0.5;
      var wetF = dripOn ? mat.wet : (X.water[k] > 0 ? mat.wet * Math.min(1, X.water[k] / Math.max(0.2, mat.hold)) : 0);
      var Tbo = X.Tbo[k], Tbi = X.Tbi[k];
      var qe = wetF > 0 ? Math.max(0, 16.5 * ho * (psat(Tbo) - pvo)) * wetF : 0;
      if (!dripOn && qe > 0) { var dw = qe * dt / LV; if (dw > X.water[k]) { qe = X.water[k] * LV / dt; X.water[k] = 0; } else X.water[k] -= dw; }
      var AkK = P.AkK[k], GcK = P.GcK[k], ChK = P.ChK[k];
      qeS += qe; evap += qe * AkK * dt / LV;
      var qJ = RHOCP * Q * wk[k] * effJ * (0.5 * (Tbo + Tbi) - Tm) / Math.max(0.1, AkK); // W/m² cédés à l'air entrant
      // faces intérieures : sol, haut (ciel ou toit), autres faces de la paroi
      var Trin = G.Fwf * X.Tf + G.Fwf * Ttop + G.Fww * (sTbi - Tbi) / (NK - 1);
      var qo = mat.abs * Iout - mat.eps * SIG * (0.5 * (T4(Tbo) - Lsky / SIG) + 0.5 * (T4(Tbo) - T4(Ta))) - ho * 1.3 * (Tbo - Ta) - qe - GcK * (Tbo - Tbi) - 0.5 * qJ;
      // face intérieure mouillée : évaporation vers l'air intérieur (analogie de Lewis, comme la face extérieure)
      var qei = wetF > 0 ? Math.max(0, 16.5 * hi * (psat(Tbi) - pvsup)) * wetF : 0;
      if (!dripOn && qei > 0) { var dwi = qei * dt / LV; if (dwi > X.water[k]) { qei = X.water[k] * LV / dt; X.water[k] = 0; } else X.water[k] -= dwi; }
      qeiS += qei; evap += qei * AkK * dt / LV;
      var qi = mat.abs * Iin - 5 * mat.eps * (Tbi - Trin) - hi * (Tbi - Ti) + GcK * (Tbo - Tbi) - 0.5 * qJ - qei;
      var kO = (4 * mat.eps * SIG * Math.pow(Tbo + 273.15, 3) + ho * 1.3 + GcK) * dt / ChK, kI = (5 + hi + GcK) * dt / ChK;
      X.Tbo[k] = Tbo + qo * dt / ChK / (1 + kO); X.Tbi[k] = Tbi + qi * dt / ChK / (1 + kI);
      sTbo += X.Tbo[k]; Tbmax = Math.max(Tbmax, X.Tbo[k]); Tbimin = Math.min(Tbimin, X.Tbi[k]);
    }
    // sol intérieur : soleil, ciel, parois, toit, air, sol profond
    var Tf = X.Tf, Fdw = 1 - G.Fdd;
    var FL = P.floor, FP = P.floorP, qef = 0;
    // sol de dessous : moyenne glissante de l'air sur 10 jours (initialisée sur les 240 h précédentes du fichier météo)
    if (X.Tref == null) { var i0 = (nd - 1) * 24 + Math.floor(hh), sT = 0; for (var q2 = 1; q2 <= 240; q2++) sT += HR.T[(i0 - q2 + 8760) % 8760]; X.Tref = sT / 240; }
    X.Tref += (Ta - X.Tref) * dt / (10 * 86400);
    // sol mouillé (carreaux arrosés) ou végétal : évaporation par analogie chaleur-masse (h / cp)
    var wetFl = (FL.wet && dripOn ? 1 : 0) + (FL.et && water ? FL.et : 0);
    if (wetFl > 0) { qef = Math.max(0, hf / 1005 * LV * (wOf(psat(Tf)) - wOf(pvOf(wm)))) * Math.min(1, wetFl); evap += qef * P.Af * dt / LV; }
    var qfl = FL.alpha * If - FL.eps * SIG * G.fsky * (T4(Tf) - Lsky / SIG) + 5 * FL.eps * (Fdw * (Tbim - Tf) + G.froof * (Troof - Tf)) - hf * (Tf - Ti) - FP.k * (Tf - X.Tref) - qef;
    X.Tf = Tf + qfl * dt / FP.C / (1 + (hf + FP.k + 5) * dt / FP.C);
    // humidité intérieure, point de rosée, condensation
    // vapeur : air après les ouvertures, plus l'eau évaporée par les faces intérieures, emportée par le renouvellement d'air
    var wi = Math.min(wOf(psat(Ti)), wsup + qeiS * P.Ak / LV / (1.2 * Math.max(0.05, Q)));
    var pvi = pvOf(wi), RHi = Math.min(100, 100 * pvi / psat(Ti)), Tdew = dewPoint(pvi);
    // ressenti au centre, à l'ombre : demi-sphère haute (ouverture, toit, paroi), sol
    var pW = 1 - G.pOpen - G.pRoof, Tobs = (G.pRoof * Troof + pW * Tbim) / Math.max(1e-6, G.pRoof + pW);
    var Tmri = mrt(Lsky, G.pOpen, Tobs, X.Tf, false, ps.alt, beam, w.DHI, (1 - FL.alpha) * If);
    var Top = apparent(Ti, pvi, vint / P.f15, Tmri);
    // ressenti dehors, en plein soleil, loin du refuge
    var Tgo = up ? Ta + 0.022 * w.GHI : Ta - 1;
    var Tmro = mrt(Lsky, 1, Ta, Tgo, up, ps.alt, beam, w.DHI, 0.2 * w.GHI);
    var Tos = apparent(Ta, pvo, w.ws, Tmro);
    return { w: w, roofA: roofA, open: G.open, Ta: Ta, RH: RH, pvo: pvo, Tsky: Tsky, Lsky: Lsky, Troof: Troof, alt: ps.alt, az: ps.az, beam: beam, Ti: Ti, Tsup: Tsup, Tm: Tm,
      Tbo: sTbo / NK, Tbi: (function () { var s = 0; for (var q = 0; q < NK; q++) s += X.Tbi[q]; return s / NK; })(), TboMax: Tbmax, TbiMin: Tbimin,
      Tf: X.Tf, TroofTop: ru.Ttop, TroofU: ru.Tu, qef: qef, fsun: fsun, If: If, ach: ach, Q: Q, vint: vint, qe: qeS / NK, qm: qm, evap: evap, RHi: RHi, pvi: pvi, Tdew: Tdew,
      cond: Math.min(Tbimin, X.Tf) < Tdew, Tmri: Tmri, Top: Top, Tmro: Tmro, Tos: Tos, up: up, ho: ho, hi: hi, effJ: effM, TexK: TexK };
  }

  // ---------------------------------------------------------------- simulation d'une journée
  TH.simulate = function (n) {
    var P = setup(); if (!P) return null;
    var G = P.G, SUN = P.SUN, dt = 300, days = 4, n0 = n - (days - 1), steps = days * 24 * 3600 / dt;
    var Ta0 = SUN.epwAt(((n0 - 1) % 365 + 365) % 365 + 1, 0).T, X = newState(Ta0);
    var KEYS = ['Ta', 'Tos', 'Ti', 'Top', 'Tbo', 'Tbi', 'TboMax', 'Tf', 'Tsup', 'RH', 'RHi', 'Tdew', 'Tmri', 'Tmro', 'ach', 'qe', 'qm'];
    var out = { t: [], sun: [], qin: [], cond: [], TboK: [], TbiK: [], TexK: [], TroofU: [] }; KEYS.forEach(function (k) { out[k] = []; });
    var acc = { evap: 0, mist: 0, res: 0, solAbs: 0, nightIn: 0, nightOut: 0, dayIn: 0, cond: 0 }, Umin = Infinity, Umax = -Infinity;
    var sunF = null, lastDay = null;
    for (var st = 0; st < steps; st++) {
      var tt = st * dt / 3600, dd = n0 + Math.floor(tt / 24), hh = tt - 24 * Math.floor(tt / 24), nd = ((dd - 1) % 365 + 365) % 365 + 1;
      if (nd !== lastDay) { sunF = sunFloorDay(P, dd === n ? nd : ((n - 1) % 365 + 365) % 365 + 1); lastDay = nd; }
      var wet = waterSeason(nd), o = step(P, X, nd, hh, dt, sunF, wet); if (!o) return null;
      if (dd === n) {
        var U = P.Ch * (o.Tbo + o.Tbi) * 2 / 2; Umin = Math.min(Umin, U); Umax = Math.max(Umax, U);
        acc.evap += o.evap; acc.mist += o.qm * dt; acc.res += wet ? resEvap(o, dt) : 0; acc.solAbs += P.mat.abs * (o.beam * Math.cos(o.alt * RAD) / Math.PI + 0.5 * o.w.DHI + 0.1 * o.w.GHI) * dt / 3600;
        var toIn = o.hi * (o.Tbi - o.Ti) + 0.5 * RHOCP * o.Q * (o.Tsup - o.Tm) / Math.max(1, P.Asol);
        if (!o.up) { acc.nightIn += Math.max(0, toIn) * P.Asol * dt / 3600; acc.nightOut += Math.max(0, o.ho * 1.3 * (o.Tbo - o.Ta)) * P.Asol * dt / 3600; }
        else acc.dayIn += toIn * P.Asol * dt / 3600;
        if (o.cond) acc.cond += dt / 3600;
        if (st % 3 === 0) {
          out.t.push(hh); KEYS.forEach(function (k) { out[k].push(o[k]); });
          out.sun.push(o.fsun); out.qin.push(o.Q); out.cond.push(o.cond ? 1 : 0);
          out.TboK.push(Float32Array.from(X.Tbo)); out.TbiK.push(Float32Array.from(X.Tbi)); out.TexK.push(o.TexK); out.TroofU.push(o.Troof);
        }
      }
    }
    out.water = waterSeason(((n - 1) % 365 + 365) % 365 + 1);
    out.n = n; out.geo = G; out.mat = P.mat; out.phi = P.phi; out.vent = P.vent; out.acc = acc; out.Asol = P.Asol; out.jk = P.jk || null;
    out.store = (Umax - Umin) / 3600; // Wh/m² stockés puis rendus sur la journée
    out.sunFloor = sunFloorDay(P, ((n - 1) % 365 + 365) % 365 + 1);
    return out;
  };

  // ---------------------------------------------------------------- résultat courant, valeurs à l'heure
  var RES = null, resKey = null;
  TH.result = function () { return RES; };
  function optKey() { return JSON.stringify(O); }
  function key() { var S = CLW.Sun.state, E = CLW.engine, b = E && E.bilan && E.bilan.res; return [S.m, S.d, optKey(), CLW.Sun.sceneKey(), b ? b.qin.toFixed(3) : '-', CLW.state.wind.speed, CLW.EPW && CLW.EPW.name].join('|'); }
  TH.update = function (force) {
    var k = key();
    if (force || k !== resKey) { resKey = k; try { RES = TH.simulate(CLW.Sun.n()); } catch (e) { console.error(e); RES = null; } }
    TH.render();
  };
  TH.at = function (t) {
    var r = RES; if (!r || !r.t.length) return null;
    var i = Math.max(0, Math.min(r.t.length - 1, Math.round(t * 4))), o = {};
    ['Ta', 'Tos', 'Ti', 'Top', 'Tbo', 'Tbi', 'TboMax', 'Tf', 'Tsup', 'RH', 'RHi', 'Tdew', 'Tmri', 'Tmro', 'sun', 'ach', 'qe', 'qm', 'cond', 'TboK', 'TbiK', 'TexK', 'TroofU'].forEach(function (k) { o[k] = r[k][i]; });
    return o;
  };
  TH.faceName = function (k) { return ORI[((k % NK) + NK) % NK]; };
  // synthèse chiffrée de la journée
  TH.summary = function () {
    var r = RES; if (!r) return null;
    function mx(a, f) { var b = -1e9, i0 = 0; for (var i = 0; i < a.length; i++) if (a[i] > b) { b = a[i]; i0 = i; } return f ? i0 : b; }
    function mn(a) { var b = 1e9; for (var i = 0; i < a.length; i++) b = Math.min(b, a[i]); return b; }
    var iA = mx(r.Ta, true), iB = mx(r.Tbi, true), day = 0, nd = 0, hot = [0, 0], hot32 = [0, 0];
    for (var i = 0; i < r.t.length; i++) {
      if (r.t[i] >= 10 && r.t[i] <= 18) { day += r.Ti[i] - r.Ta[i]; nd++; }
      if (r.Tos[i] > 26) hot[0] += 0.25; if (r.Top[i] > 26) hot[1] += 0.25; if (r.Tos[i] > 32) hot32[0] += 0.25; if (r.Top[i] > 32) hot32[1] += 0.25;
    }
    // face la plus chaude de la journée
    var kMax = 0, vMax = -1e9; r.TboK.forEach(function (a) { for (var k = 0; k < NK; k++) if (a[k] > vMax) { vMax = a[k]; kMax = k; } });
    var ampA = mx(r.Ta) - mn(r.Ta), ampB = mx(r.Tbi) - mn(r.Tbi);
    return {
      TaMax: mx(r.Ta), TosMax: mx(r.Tos), TiMax: mx(r.Ti), TopMax: mx(r.Top), TaMin: mn(r.Ta), TiMin: mn(r.Ti), TopMin: mn(r.Top),
      tAmax: r.t[iA], tBmax: r.t[iB], dDay: nd ? day / nd : 0, hot: hot, hot32: hot32, TboMax: mx(r.Tbo), TbiMax: mx(r.Tbi), TfMax: mx(r.Tf),
      faceMax: vMax, faceMaxName: ORI[kMax], RHiMax: mx(r.RHi), RHMax: mx(r.RH), cond: r.acc.cond,
      lag: ((r.t[iB] - r.t[iA]) + 24) % 24, damp: ampA > 0 ? ampB / ampA : 0, store: r.store * r.Asol / 1000, storeM2: r.store,
      nightIn: r.acc.nightIn / 1000, nightOut: r.acc.nightOut / 1000, evap: r.acc.evap, mist: r.acc.mist, res: r.acc.res, solAbs: r.acc.solAbs,
      ach: r.ach.reduce(function (a, b) { return a + b; }, 0) / r.ach.length, sunMax: mx(r.sun)
    };
  };


  // ---------------------------------------------------------------- UTCI : été et hiver, vent réel heure par heure
  var UT = TH.utciState = { res: null, running: false, progress: 0 };
  function range(a, b) { var r = []; for (var i = a; i <= b; i++) r.push(i); return r; }
  TH.utciSeasons = function (done) {
    var P = setup(); if (!P || UT.running || !CLW.UTCI) return false;
    var U = CLW.UTCI, K = U.CLASSES.length, dt = 300, spin = 3;
    var periods = [{ id: 'ete', name: 'Été (juin à septembre)', days: range(152, 273) },
                   { id: 'hiver', name: 'Hiver (décembre à février)', days: range(335, 365).concat(range(1, 59)) }];
    var total = periods.reduce(function (s, p) { return s + p.days.length + spin; }, 0), doneDays = 0;
    var res = { periods: [], windTable: !!(O.useWindTable && (TH.windTables.all || TH.windTables.ete || TH.windTables.hiver)), tables: Object.keys(TH.windTables), drip: O.drip, dirs: TH.windTable ? TH.windTable.n : 0 };
    var pi = 0, di = -spin, X = null, acc = null;
    function zeros() { var a = []; for (var k = 0; k < K; k++) a.push(0); return a; }
    function start() { var p = periods[pi]; X = newState(P.SUN.epwAt(p.days[0], 0).T); acc = { out: zeros(), inn: zeros(), so: 0, si: 0, h: 0 }; di = -spin; }
    function sunFor(nd) { return sunFloorDay(P, clamp(Math.round(nd / 10) * 10, 1, 365)); }
    UT.running = true; UT.progress = 0; start();
    function run() {
      var t0 = performance.now();
      while (pi < periods.length && performance.now() - t0 < 40) {
        var p = periods[pi], nd = di < 0 ? ((p.days[0] + di - 1 + 365) % 365) + 1 : p.days[di];
        var sunF = sunFor(nd), wet = waterSeason(nd);
        for (var s = 0; s < 24 * 3600 / dt; s++) {
          var hh = s * dt / 3600, o = step(P, X, nd, hh, dt, sunF, wet);
          if (!o) { UT.running = false; return; }
          if (di < 0) continue;
          var uo = U.calc(o.Ta, o.Tmro, Math.max(0.5, o.w.ws), o.RH);
          var ui = U.calc(o.Ti, o.Tmri, Math.max(0.5, U.v10From(o.vint)), o.RHi), h = dt / 3600;
          acc.out[U.classOf(uo)] += h; acc.inn[U.classOf(ui)] += h; acc.so += uo * h; acc.si += ui * h; acc.h += h;
        }
        di++; doneDays++;
        if (di >= p.days.length) {
          res.periods.push({ id: p.id, name: p.name, out: acc.out, inn: acc.inn, meanOut: acc.so / acc.h, meanIn: acc.si / acc.h, hours: acc.h });
          pi++; if (pi < periods.length) start();
        }
        UT.progress = doneDays / total;
      }
      if (pi < periods.length) setTimeout(run, 0);
      else { UT.running = false; UT.res = res; if (done) done(res); }
    }
    setTimeout(run, 0);
    return true;
  };
  // heures de stress : chaleur = au-dessus de 26 °C (classes 6 et plus), froid = sous 0 °C (classes 3 et moins)
  function stressHours(a, lo, hi) { var s = 0; for (var k = lo; k <= hi; k++) s += a[k]; return s; }
  TH.drawUtci = function (cv) {
    if (!cv) return;
    var d = window.devicePixelRatio || 1, W = Math.max(200, Math.round(cv.clientWidth * d)), H = Math.round(190 * d);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    var c = cv.getContext('2d'), U = CLW.UTCI, R = UT.res;
    c.clearRect(0, 0, W, H); c.font = (11 * d) + 'px system-ui, sans-serif'; c.textBaseline = 'middle';
    var mu = getComputedStyle(document.body).getPropertyValue('--muted') || '#999', fg = getComputedStyle(document.body).getPropertyValue('--text') || '#ddd';
    if (UT.running) { c.fillStyle = mu; c.fillText('Calcul en cours : ' + Math.round(100 * UT.progress) + ' %', 6 * d, 16 * d); return; }
    if (!R) { c.fillStyle = mu; c.fillText('Balayez les vents, puis calculez l\'UTCI.', 6 * d, 16 * d); return; }
    var x0 = 110 * d, x1 = W - 8 * d, bh = 16 * d, y = 10 * d;
    R.periods.forEach(function (p) {
      c.fillStyle = fg; c.fillText(p.name, 4 * d, y + 6 * d); y += 16 * d;
      [['Dehors au soleil', p.out], ['Dedans', p.inn]].forEach(function (row) {
        c.fillStyle = mu; c.fillText(row[0], 4 * d, y + bh / 2);
        var x = x0, tot = row[1].reduce(function (a, b) { return a + b; }, 0) || 1;
        row[1].forEach(function (hrs, k) { var w = (x1 - x0) * hrs / tot; if (w > 0) { c.fillStyle = U.CLASSES[k].col; c.fillRect(x, y, w, bh); x += w; } });
        y += bh + 5 * d;
      });
      y += 6 * d;
    });
    // légende des classes présentes
    var used = []; R.periods.forEach(function (p) { p.out.forEach(function (v, k) { if ((v > 0 || p.inn[k] > 0) && used.indexOf(k) < 0) used.push(k); }); });
    used.sort(function (a, b) { return a - b; });
    var lx = 4 * d; y += 2 * d;
    used.forEach(function (k) {
      var t = U.CLASSES[k].name, tw = c.measureText(t).width + 22 * d;
      if (lx + tw > W) { lx = 4 * d; y += 15 * d; }
      c.fillStyle = U.CLASSES[k].col; c.fillRect(lx, y - 5 * d, 10 * d, 10 * d); c.fillStyle = mu; c.fillText(t, lx + 13 * d, y); lx += tw;
    });
  };
  TH.utciHtml = function () {
    var R = UT.res; if (!R) return '';
    function f(v, n) { return fmt(v, n); }
    var h = '';
    R.periods.forEach(function (p) {
      var hotO = stressHours(p.out, 6, 9), hotI = stressHours(p.inn, 6, 9), strO = stressHours(p.out, 7, 9), strI = stressHours(p.inn, 7, 9);
      var coldO = stressHours(p.out, 0, 3), coldI = stressHours(p.inn, 0, 3), okO = p.out[5], okI = p.inn[5];
      h += '<b>' + p.name + '</b><br>';
      h += 'Sans stress : ' + f(okO, 0) + ' h dehors au soleil → ' + f(okI, 0) + ' h dedans (sur ' + f(p.hours, 0) + ' h)<br>';
      if (hotO + hotI > 0) h += 'Chaleur (UTCI > 26 °C) : ' + f(hotO, 0) + ' h → ' + f(hotI, 0) + ' h ; dont forte ou plus (> 32 °C) : ' + f(strO, 0) + ' h → ' + f(strI, 0) + ' h<br>';
      if (coldO + coldI > 0) h += 'Froid modéré ou plus (UTCI < 0 °C) : ' + f(coldO, 0) + ' h → ' + f(coldI, 0) + ' h<br>';
      h += 'UTCI moyen : ' + f(p.meanOut, 1) + ' °C → ' + f(p.meanIn, 1) + ' °C<br>';
    });
    h += '<span class="hint">' + (R.windTable ? 'Vent réel heure par heure : direction et vitesse du fichier météo, ' + R.dirs + ' directions calculées (tables : ' + R.tables.map(function (k) { return { all: "toute l'année", ete: 'été', hiver: 'hiver' }[k]; }).join(', ') + ').' : 'Vent : une seule direction (celle du calcul en cours) ; balayez les vents pour le vent réel.') +
      ' UTCI (Bröde et al., 2012) : dehors avec le soleil sur la personne, dedans avec le vent et le rayonnement intérieurs.' + (R.drip ? ' Goutte-à-goutte en été.' : '') + '</span>';
    return h;
  };

  // ---------------------------------------------------------------- épisode mesuré : canicule ou grand froid
  // e : épisode de CLW.Mesures (dates réelles ms0 → ms1) ; la météo chargée doit être l'année réelle qui le contient.
  // 4 jours de mise en régime avant, 1 jour après ; valeurs horaires ; géométrie de la saison du jour.
  var EP = TH.episodeState = { res: null, running: false, progress: 0 };
  TH.runEpisode = function (e, done) {
    var P = setup(); if (!P || EP.running || !CLW.UTCI) return false;
    var U = CLW.UTCI, dt = 300, MDs = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], DAYMS = 86400000, list = [];
    for (var ms = e.ms0 - 4 * DAYMS; ms <= e.ms1 + DAYMS; ms += DAYMS) {
      var D = new Date(ms), m = D.getUTCMonth() + 1, dd = D.getUTCDate(); if (m === 2 && dd === 29) continue;
      list.push({ ms: ms, n: MDs[m - 1] + dd, inEp: ms >= e.ms0 && ms <= e.ms1 });
    }
    var X = newState(P.SUN.epwAt(list[0].n, 0).T), li = 0;
    var R = { e: e, h: [], geo: {}, wall: P.wallK, hasSeason: !!(P.Gs.ete || P.Gs.hiver) };
    EP.running = true; EP.progress = 0; EP.res = null;
    function run() {
      var t0 = performance.now();
      while (li < list.length && performance.now() - t0 < 40) {
        var L = list[li], sunF = sunFloorDay(P, L.n), wet = waterSeason(L.n), s = seasonOf(L.n);
        R.geo[s] = P.Gs[s] ? 'saison' : 'courante';
        for (var st = 0; st < 24 * 3600 / dt; st++) {
          var hh = st * dt / 3600, o = step(P, X, L.n, hh, dt, sunF, wet);
          if (!o) { EP.running = false; return; }
          if ((st + 1) % 12 === 0 && li >= 4) {
            var uo = U.calc(o.Ta, o.Tmro, Math.max(0.5, o.w.ws), o.RH), ui = U.calc(o.Ti, o.Tmri, Math.max(0.5, U.v10From(o.vint)), o.RHi);
            R.h.push({ ms: L.ms + (hh + dt / 3600) * 3600000, inEp: L.inEp, Ta: o.Ta, Ti: o.Ti, Tos: o.Tos, Top: o.Top, uo: uo, ui: ui, RH: o.RH, RHi: o.RHi, Tbo: o.Tbo, Tbi: o.Tbi, cond: o.cond, ws: o.w.ws, up: o.up, roofA: o.roofA, open: o.open });
          }
        }
        li++; EP.progress = li / list.length;
      }
      if (li < list.length) { setTimeout(run, 0); return; }
      EP.running = false; EP.res = R; if (done) done(R);
    }
    setTimeout(run, 0);
    return true;
  };
  function epSummary(R) {
    var H = R.h.filter(function (x) { return x.inEp; }), S = { n: H.length };
    function mx(k) { return H.reduce(function (a, x) { return Math.max(a, x[k]); }, -Infinity); }
    function mn(k) { return H.reduce(function (a, x) { return Math.min(a, x[k]); }, Infinity); }
    function hrs(f) { return H.reduce(function (a, x) { return a + (f(x) ? 1 : 0); }, 0); }
    S.TaMax = mx('Ta'); S.TiMax = mx('Ti'); S.TaMin = mn('Ta'); S.TiMin = mn('Ti'); S.uoMax = mx('uo'); S.uiMax = mx('ui'); S.uoMin = mn('uo'); S.uiMin = mn('ui');
    S.hot32 = [hrs(function (x) { return x.uo > 32; }), hrs(function (x) { return x.ui > 32; })];
    S.hot38 = [hrs(function (x) { return x.uo > 38; }), hrs(function (x) { return x.ui > 38; })];
    S.hot26 = [hrs(function (x) { return x.uo > 26; }), hrs(function (x) { return x.ui > 26; })];
    S.cold0 = [hrs(function (x) { return x.uo < 0; }), hrs(function (x) { return x.ui < 0; })];
    S.cold13 = [hrs(function (x) { return x.uo < -13; }), hrs(function (x) { return x.ui < -13; })];
    S.cond = hrs(function (x) { return x.cond; });
    // jour (soleil levé) et nuit : écart moyen dedans - dehors
    var dj = 0, nj = 0, dn = 0, nn = 0; H.forEach(function (x) { if (x.up) { dj += x.Ti - x.Ta; nj++; } else { dn += x.Ti - x.Ta; nn++; } });
    S.dDay = nj ? dj / nj : 0; S.dNight = nn ? dn / nn : 0;
    // nuits tropicales dedans / dehors : minimum de la nuit (18 h - 8 h) au-dessus de 20 °C
    var nights = {}; H.forEach(function (x) { var D = new Date(x.ms), h = D.getUTCHours(), key = Math.floor((x.ms - (h < 9 ? 86400000 : 0)) / 86400000); if (h >= 18 || h < 9) { var q = nights[key] || (nights[key] = { a: Infinity, i: Infinity }); q.a = Math.min(q.a, x.Ta); q.i = Math.min(q.i, x.Ti); } });
    S.tropical = [0, 0]; S.nights = 0; Object.keys(nights).forEach(function (k) { var q = nights[k]; S.nights++; if (q.a > 20) S.tropical[0]++; if (q.i > 20) S.tropical[1]++; });
    return S;
  }
  TH.episodeSummary = function () { return EP.res ? epSummary(EP.res) : null; };
  TH.drawEpisode = function (cv, opt) {
    if (!cv) return; opt = opt || {};
    var d = opt.dpr || window.devicePixelRatio || 1, W = opt.W || Math.max(200, Math.round((cv.clientWidth || 300) * d)), Hh = opt.H || Math.round(W * 0.6);
    if (!opt.W) { cv.width = W; cv.height = Hh; }
    var c = cv.getContext('2d'), fg = opt.fg || '#dfe4ec', mu = opt.muted || '#8b95a5', R = EP.res;
    c.fillStyle = opt.bg || '#191d25'; c.fillRect(0, 0, W, Hh); c.font = (10 * d) + 'px system-ui, sans-serif'; c.textBaseline = 'top'; c.textAlign = 'left';
    if (EP.running) { c.fillStyle = mu; c.fillText('Calcul de l\'épisode… ' + Math.round(100 * EP.progress) + ' %', 6 * d, 8 * d); c.fillStyle = '#ffb65c'; c.fillRect(6 * d, 24 * d, (W - 12 * d) * EP.progress, 4 * d); return; }
    if (!R || !R.h.length) { c.fillStyle = mu; c.fillText('Choisissez un épisode, puis « Analyser l\'épisode ».', 6 * d, 8 * d); return; }
    var hot = R.e.kind === 'chaud', keys = ['Ta', 'Ti', 'uo', 'ui'], lo = Infinity, hi = -Infinity;
    R.h.forEach(function (x) { keys.forEach(function (k) { lo = Math.min(lo, x[k]); hi = Math.max(hi, x[k]); }); });
    lo = Math.floor(lo / 5) * 5; hi = Math.ceil(hi / 5) * 5; if (hi - lo < 10) hi = lo + 10;
    var pl = 30 * d, pr = 6 * d, pt = 8 * d, pb = 44 * d, gw = W - pl - pr, gh = Hh - pt - pb, N = R.h.length;
    function X(i) { return pl + i / Math.max(1, N - 1) * gw; } function Y(v) { return pt + gh - (v - lo) / (hi - lo) * gh; }
    // jours de l'épisode
    c.fillStyle = hot ? 'rgba(255,120,60,0.10)' : 'rgba(90,160,255,0.12)';
    var a0 = -1; R.h.forEach(function (x, i) { if (x.inEp && a0 < 0) a0 = i; if ((!x.inEp || i === N - 1) && a0 >= 0) { c.fillRect(X(a0), pt, X(x.inEp ? i : i - 1) - X(a0), gh); a0 = -1; } });
    // seuils UTCI
    c.setLineDash([3 * d, 3 * d]); c.lineWidth = 1 * d;
    (hot ? [[26, 'UTCI 26'], [32, '32'], [38, '38']] : [[0, 'UTCI 0'], [-13, '−13']]).forEach(function (s) { if (s[0] < lo || s[0] > hi) return; c.strokeStyle = 'rgba(255,255,255,0.18)'; c.beginPath(); c.moveTo(pl, Y(s[0])); c.lineTo(pl + gw, Y(s[0])); c.stroke(); c.fillStyle = mu; c.textAlign = 'right'; c.textBaseline = 'bottom'; c.fillText(s[1], pl + gw - 2 * d, Y(s[0]) - 1 * d); });
    c.setLineDash([]);
    c.strokeStyle = 'rgba(255,255,255,0.08)'; c.fillStyle = mu; c.textAlign = 'right'; c.textBaseline = 'middle'; c.font = (9 * d) + 'px system-ui, sans-serif';
    for (var v = lo; v <= hi; v += 5) { c.beginPath(); c.moveTo(pl, Y(v)); c.lineTo(pl + gw, Y(v)); c.stroke(); c.fillText(v + '°', pl - 3 * d, Y(v)); }
    // jours (minuit)
    c.textAlign = 'center'; c.textBaseline = 'top';
    R.h.forEach(function (x, i) { var D = new Date(x.ms); if (D.getUTCHours() === 12) c.fillText(D.getUTCDate() + '/' + (D.getUTCMonth() + 1), X(i), pt + gh + 4 * d); if (D.getUTCHours() === 0) { c.strokeStyle = 'rgba(255,255,255,0.10)'; c.beginPath(); c.moveTo(X(i), pt); c.lineTo(X(i), pt + gh); c.stroke(); } });
    var S = [['uo', 'rgba(217,166,255,0.85)', 'UTCI dehors au soleil', [4, 3]], ['Ta', '#7fb2ff', 'air dehors', null], ['ui', '#ff6b6b', 'UTCI dedans', [4, 3]], ['Ti', '#ffb65c', 'air dedans', null]];
    S.forEach(function (s) { c.strokeStyle = s[1]; c.lineWidth = 1.5 * d; c.setLineDash(s[3] ? s[3].map(function (q) { return q * d; }) : []); c.beginPath(); R.h.forEach(function (x, i) { if (i) c.lineTo(X(i), Y(x[s[0]])); else c.moveTo(X(i), Y(x[s[0]])); }); c.stroke(); });
    c.setLineDash([]); c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = (9.5 * d) + 'px system-ui, sans-serif';
    S.forEach(function (s, q) { var lx = 6 * d + (q % 2) * W * 0.5, ly = pt + gh + 22 * d + Math.floor(q / 2) * 12 * d; c.strokeStyle = s[1]; c.lineWidth = 2 * d; c.setLineDash(s[3] ? s[3].map(function (z) { return z * d; }) : []); c.beginPath(); c.moveTo(lx, ly); c.lineTo(lx + 14 * d, ly); c.stroke(); c.setLineDash([]); c.fillStyle = fg; c.fillText(s[2], lx + 18 * d, ly); });
  };
  TH.episodeHtml = function () {
    var R = EP.res; if (!R) return '';
    var S = epSummary(R), f = fmt, hot = R.e.kind === 'chaud', M = CLW.Mesures;
    function row(l, v) { return '<div class="bil-row"><span>' + l + '</span><b>' + v + '</b></div>'; }
    function sub(l) { return '<div class="bil-row sub"><span>' + l + '</span><span></span></div>'; }
    var h = '<b>' + (hot ? 'Chaleur' : 'Froid') + ' du ' + (M ? M.dateTxt(R.e.ms0) + ' au ' + M.dateTxt(R.e.ms1) : '') + '</b> (' + R.e.len + ' jours)';
    if (hot) {
      h += row('Air : maximum', f(S.TaMax, 1) + ' °C dehors → ' + f(S.TiMax, 1) + ' °C dedans');
      h += row('Écart dedans − dehors', 'jour ' + (S.dDay > 0 ? '+' : '') + f(S.dDay, 1) + ' °C, nuit ' + (S.dNight > 0 ? '+' : '') + f(S.dNight, 1) + ' °C');
      h += row('UTCI : maximum', f(S.uoMax, 1) + ' °C au soleil → ' + f(S.uiMax, 1) + ' °C dedans');
      h += row('Heures de stress > 32 °C', f(S.hot32[0], 0) + ' h → ' + f(S.hot32[1], 0) + ' h') + sub('fort ou plus ; très fort (> 38 °C) : ' + f(S.hot38[0], 0) + ' h → ' + f(S.hot38[1], 0) + ' h');
      h += row('Nuits tropicales (min > 20 °C)', S.tropical[0] + ' dehors → ' + S.tropical[1] + ' dedans, sur ' + S.nights);
    } else {
      h += row('Air : minimum', f(S.TaMin, 1) + ' °C dehors → ' + f(S.TiMin, 1) + ' °C dedans');
      h += row('Écart dedans − dehors', 'jour ' + (S.dDay > 0 ? '+' : '') + f(S.dDay, 1) + ' °C, nuit ' + (S.dNight > 0 ? '+' : '') + f(S.dNight, 1) + ' °C');
      h += row('UTCI : minimum', f(S.uoMin, 1) + ' °C dehors → ' + f(S.uiMin, 1) + ' °C dedans');
      h += row('Heures de froid (UTCI < 0 °C)', f(S.cold0[0], 0) + ' h → ' + f(S.cold0[1], 0) + ' h') + sub('froid fort (< −13 °C) : ' + f(S.cold13[0], 0) + ' h → ' + f(S.cold13[1], 0) + ' h');
      if (S.cond) h += row('Condensation sur les parois', f(S.cond, 0) + ' h');
    }
    var geo = Object.keys(R.geo).map(function (s) { return { ete: 'été', hiver: 'hiver', all: 'mi-saison' }[s] + ' : ' + (R.geo[s] === 'saison' ? 'géométrie envoyée pour cette saison' : 'géométrie courante'); }).join(' ; ');
    h += '<span class="hint">Mesures horaires Météo-France (atlas), 4 jours de mise en régime avant l\'épisode. ' + geo + '.' +
      (R.wall ? ' Paroi par orientation : ' + R.wall.map(function (w, k) { return w.n ? ORI[k] + ' ' + f(w.depth * 100, 0) + ' cm' : null; }).filter(Boolean).join(', ') + '.' : '') +
      ' UTCI dehors avec le soleil sur la personne, dedans avec le vent et le rayonnement intérieurs.</span>';
    return h;
  };

  // ---------------------------------------------------------------- été : juin à septembre, eau et réservoir
  var SEA = TH.seasonState = { res: null, key: null, running: false, progress: 0 };
  TH.tankAuto = function (G) { void G; return Math.round(Math.max(0, O.wsurf) * 0.45 * 1000); }; // cuves sous le mur : 45 cm utiles sur la surface d'eau
  // surface de collecte de la pluie : celle du toit envoyée par Grasshopper (entrée « collecte »), sinon la surface couverte
  TH.catchAuto = function (G) {
    var L = CLW.Live && CLW.Live.last; if (L && L.catch > 0) return L.catch;
    return Math.max(0, G.area * (1 - G.open) + (G.roof ? 0 : 0));
  };
  // seuils de la station météo envoyés par Grasshopper : goutte-à-goutte en mode sonde avec ces seuils
  var stKey = null;
  TH.applyStation = function (st) {
    if (!st) { stKey = null; return; }
    var k = JSON.stringify(st); if (k === stKey) return; stKey = k;
    O.drip = true; O.dripMode = 'sonde'; O.dripTon = st.Ton; O.dripRH = st.HRoff;
    O.dripToff = Math.min(O.dripToff, st.Ton - 2);
    [['th-drip', 'drip'], ['th-dripMode', 'dripMode'], ['th-dripTon', 'dripTon'], ['th-dripRH', 'dripRH'], ['th-dripToff', 'dripToff']].forEach(function (a) {
      var el = $(a[0]); if (!el) return; if (el.type === 'checkbox') el.checked = !!O[a[1]]; else el.value = O[a[1]];
    });
    try { localStorage.setItem('clwind-thermal', JSON.stringify(O)); } catch (e) { /* rien */ }
    if (TH.update) TH.update(true);
  };
  TH.season = function (done) {
    var P = setup(); if (!P || SEA.running) return false;
    var HR = P.HR, G = P.G, dt = 300, d0 = 152, d1 = 273, spin = 3; // pas de 5 min : stable même avec un très fort renouvellement d'air (kiosque ouvert)
    var cap = O.tank > 0 ? O.tank : TH.tankAuto(G), catchA = O.catchA > 0 ? O.catchA : TH.catchAuto(G), useWater = true; // les cuves s'évaporent même sans jets ni brume
    var X = newState(P.SUN.epwAt(d0 - spin, 0).T), level = 0.5 * cap, deficit = 0, // cuves à moitié pleines au 1er juin
      maxDef = 0, demRate = 0, demN = 0;
    var days = [], d = d0 - spin, keyNow = key() + '|' + cap + '|' + catchA;
    SEA.running = true; SEA.progress = 0; SEA.key = keyNow;
    function sunFor(nd) { var s = d0 + Math.round((nd - d0) / 10) * 10; return sunFloorDay(P, clamp(s, 1, 365)); }
    function runDay() {
      var t0 = performance.now();
      while (d <= d1 && performance.now() - t0 < 40) {
        var sunF = sunFor(d), rec = { n: d, hot: [0, 0], hot32: [0, 0], TaMax: -99, TiMax: -99, TosMax: -99, TopMax: -99, use: 0, rain: 0, empty: 0, RHiMax: 0, cond: 0 };
        for (var s = 0; s < 24 * 3600 / dt; s++) {
          var hh = s * dt / 3600, ok = !useWater || level > 0.5;
          var o = step(P, X, d, hh, dt, sunF, ok); if (!o) { SEA.running = false; return; }
          // toute l'eau des jets ruisselle et retourne aux cuves : seule l'eau évaporée est consommée (façade, brume, surface des cuves)
          var use = o.evap + o.qm * dt + resEvap(o, dt);
          var rain = (HR.P ? HR.P[(d - 1) * 24 + Math.floor(hh)] : 0) * dt / 3600 * catchA * 0.8;
          if (d >= d0) {
            var h = dt / 3600;
            if (o.Tos > 26) rec.hot[0] += h; if (o.Top > 26) rec.hot[1] += h; if (o.Tos > 32) rec.hot32[0] += h; if (o.Top > 32) rec.hot32[1] += h;
            rec.TaMax = Math.max(rec.TaMax, o.Ta); rec.TiMax = Math.max(rec.TiMax, o.Ti); rec.TosMax = Math.max(rec.TosMax, o.Tos); rec.TopMax = Math.max(rec.TopMax, o.Top);
            rec.RHiMax = Math.max(rec.RHiMax, o.RHi); if (o.cond) rec.cond += h;
            if (useWater) {
              level = Math.min(cap, level + rain - use); if (level < 0) level = 0;
              if (!ok) rec.empty += h;
              // besoin sans réservoir limité : demande moyenne quand l'eau manque
              if (use > 0) { demRate += use; demN++; }
              var dem = ok ? use : ((O.drip && inHours(hh, O.dripA, O.dripB)) || (O.mist && inHours(hh, O.mistA, O.mistB) && o.Ta > 18) ? (demN ? demRate / demN : 0) : 0);
              deficit = Math.max(0, deficit + dem - rain); maxDef = Math.max(maxDef, deficit);
              rec.use += use;
            }
            rec.rain += rain;
          }
        }
        if (d >= d0) { rec.level = level; days.push(rec); }
        d++;
      }
      SEA.progress = clamp((d - d0 + spin) / (d1 - d0 + 1 + spin), 0, 1);
      if (d <= d1) { setTimeout(runDay, 0); if (done) done(false); return; }
      var tot = { hot: [0, 0], hot32: [0, 0], use: 0, rain: 0, emptyDays: 0, cond: 0, RHiMax: 0 };
      days.forEach(function (r) { tot.hot[0] += r.hot[0]; tot.hot[1] += r.hot[1]; tot.hot32[0] += r.hot32[0]; tot.hot32[1] += r.hot32[1]; tot.use += r.use; tot.rain += r.rain; if (r.empty > 2) tot.emptyDays++; tot.cond += r.cond; tot.RHiMax = Math.max(tot.RHiMax, r.RHiMax); });
      SEA.res = { days: days, tot: tot, cap: cap, catchA: catchA, need: maxDef, useWater: useWater, rainYear: HR.P ? HR.P.reduce(function (a, b) { return a + b; }, 0) : 0 };
      SEA.running = false; SEA.progress = 1;
      if (done) done(true);
    }
    runDay();
    return true;
  };
  TH.seasonStale = function () {
    var G = TH.geometry(); if (!SEA.res || !G) return true;
    return SEA.key !== key() + '|' + (O.tank > 0 ? O.tank : TH.tankAuto(G)) + '|' + (O.catchA > 0 ? O.catchA : TH.catchAuto(G));
  };
  TH.drawSeason = function (cv, opt) {
    opt = opt || {};
    var d = opt.dpr || window.devicePixelRatio || 1, W = opt.W || Math.max(1, Math.round((cv.clientWidth || 280) * d)), H = opt.H || Math.round(W * 0.62);
    if (!opt.W) { cv.width = W; cv.height = H; }
    var c = cv.getContext('2d'), fg = opt.fg || '#dfe4ec', mu = opt.muted || '#8b95a5', R = SEA.res;
    c.fillStyle = opt.bg || '#191d25'; c.fillRect(0, 0, W, H);
    c.font = (10 * d) + 'px system-ui, sans-serif'; c.textBaseline = 'top'; c.textAlign = 'left';
    if (SEA.running) { c.fillStyle = mu; c.fillText('Calcul de l\'été… ' + Math.round(100 * SEA.progress) + ' %', 6 * d, 8 * d); c.fillStyle = '#ffb65c'; c.fillRect(6 * d, 24 * d, (W - 12 * d) * SEA.progress, 4 * d); return; }
    if (!R) { c.fillStyle = mu; c.fillText('Cliquez sur « Calculer l\'été ».', 6 * d, 8 * d); return; }
    var pl = 24 * d, pr = R.useWater ? 30 * d : 6 * d, pt = 8 * d, pb = 40 * d, gw = W - pl - pr, gh = H - pt - pb, n = R.days.length, bw = gw / n;
    function Y(h) { return pt + gh - h / 24 * gh; }
    c.strokeStyle = 'rgba(255,255,255,0.08)'; c.fillStyle = mu; c.textAlign = 'right'; c.textBaseline = 'middle'; c.font = (9 * d) + 'px system-ui, sans-serif';
    [0, 6, 12, 18, 24].forEach(function (h) { c.beginPath(); c.moveTo(pl, Y(h)); c.lineTo(pl + gw, Y(h)); c.stroke(); c.fillText(h + ' h', pl - 3 * d, Y(h)); });
    R.days.forEach(function (r, i) {
      var x = pl + i * bw;
      c.fillStyle = 'rgba(217,166,255,0.45)'; c.fillRect(x, Y(r.hot[0]), Math.max(1, bw - 0.5), Y(0) - Y(r.hot[0]));
      c.fillStyle = '#ff8a5c'; c.fillRect(x + bw * 0.25, Y(r.hot[1]), Math.max(1, bw * 0.5), Y(0) - Y(r.hot[1]));
      if (r.empty > 2) { c.fillStyle = '#e04848'; c.fillRect(x, Y(0) + 2 * d, Math.max(1, bw - 0.5), 3 * d); }
    });
    if (R.useWater) {
      c.strokeStyle = '#6fb4ff'; c.lineWidth = 1.6 * d; c.beginPath();
      R.days.forEach(function (r, i) { var x = pl + (i + 0.5) * bw, y = pt + gh - r.level / R.cap * gh; if (i) c.lineTo(x, y); else c.moveTo(x, y); }); c.stroke();
      c.fillStyle = '#6fb4ff'; c.textAlign = 'left';
      ['100 %', '50 %', '0'].forEach(function (s, q) { c.fillText(s, pl + gw + 3 * d, pt + q * gh / 2); });
    }
    c.fillStyle = mu; c.textAlign = 'center'; c.textBaseline = 'top';
    ['juin', 'juillet', 'août', 'sept.'].forEach(function (m, q) { var i0 = [0, 30, 61, 92][q]; c.fillText(m, pl + (i0 + 15) * bw, pt + gh + 6 * d); });
    c.textAlign = 'left'; c.font = (9.5 * d) + 'px system-ui, sans-serif';
    var ly = pt + gh + 22 * d;
    c.fillStyle = 'rgba(217,166,255,0.7)'; c.fillRect(6 * d, ly, 10 * d, 7 * d); c.fillStyle = fg; c.fillText('h > 26 °C dehors au soleil', 19 * d, ly - d);
    c.fillStyle = '#ff8a5c'; c.fillRect(6 * d + W * 0.5, ly, 10 * d, 7 * d); c.fillStyle = fg; c.fillText('dedans', 19 * d + W * 0.5, ly - d);
    if (R.useWater) { c.strokeStyle = '#6fb4ff'; c.lineWidth = 2 * d; c.beginPath(); c.moveTo(6 * d + W * 0.72, ly + 3 * d); c.lineTo(16 * d + W * 0.72, ly + 3 * d); c.stroke(); c.fillText('réservoir', 19 * d + W * 0.72, ly - d); }
  };
  TH.seasonHtml = function () {
    var R = SEA.res, f = fmt; if (!R) return '';
    function row(l, v) { return '<div class="bil-row"><span>' + l + '</span><b>' + v + '</b></div>'; }
    function sub(l) { return '<div class="bil-row sub"><span>' + l + '</span><span></span></div>'; }
    var T = R.tot, h = '';
    if (TH.seasonStale()) h += '<div class="hint">Réglages ou géométrie modifiés : relancez le calcul de l\'été.</div>';
    h += row('Heures de ressenti > 26 °C', f(T.hot[0], 0) + ' h → ' + f(T.hot[1], 0) + ' h') + sub('dehors au soleil → dedans à l\'ombre, de juin à septembre');
    h += row('Heures de ressenti > 32 °C', f(T.hot32[0], 0) + ' h → ' + f(T.hot32[1], 0) + ' h');
    if (R.useWater) {
      h += row('Eau consommée', f(T.use / 1000, 1) + ' m³') + sub('évaporée seulement (briques mouillées, surface des cuves) : le reste ruisselle et retourne aux cuves ; ' + f(T.use / R.days.length, 0) + ' L/jour en moyenne');
      h += row('Pluie recueillie', f(T.rain / 1000, 1) + ' m³') + sub(f(R.catchA, 1) + ' m² de collecte, rendement 80 %');
      h += row('Réservoir', f(R.cap / 1000, 1) + ' m³') + sub(T.emptyDays ? T.emptyDays + ' jours où il se vide (eau coupée, trait rouge)' : 'ne se vide jamais');
      h += row('Réservoir pour ne jamais manquer', f(R.need / 1000, 1) + ' m³');
    } else h += '<div class="hint">Activez le goutte-à-goutte ou la brumisation pour le bilan d\'eau.</div>';
    if (T.cond > 0) h += row('Condensation possible', f(T.cond, 0) + ' h') + sub('brique ou sol sous le point de rosée de l\'air intérieur');
    h += row('Humidité intérieure, maximum', f(T.RHiMax, 0) + ' %');
    if (!R.rainYear) h += '<div class="hint">Ce fichier EPW ne contient pas la pluie.</div>';
    return h;
  };

  // ---------------------------------------------------------------- affichage : courbes sur 24 h
  var COLS = { Tos: '#d9a6ff', Ta: '#7fb2ff', Ti: '#ff8a5c', Top: '#ffd166', Tbo: '#c46a3a', TboMax: '#ff5a3a', Tf: '#9be08f', Tdew: '#5fd0d0' };
  var LABS = { Tos: 'ressenti dehors (soleil)', Ta: 'air extérieur', Ti: 'air intérieur', Top: 'ressenti dedans (ombre)', Tbo: 'brique ext., moyenne', TboMax: 'brique, face + chaude', Tf: 'sol intérieur', Tdew: 'rosée dedans' };
  function dash(k, d) { return k === 'Tbo' || k === 'Tf' || k === 'TboMax' ? [4 * d, 3 * d] : k === 'Tos' ? [1.5 * d, 2.5 * d] : k === 'Tdew' ? [1 * d, 3 * d] : []; }
  TH.drawCurves = function (cv, opt) {
    opt = opt || {};
    var r = RES, d = opt.dpr || window.devicePixelRatio || 1, W = opt.W || Math.max(1, Math.round((cv.clientWidth || 280) * d)), H = opt.H || Math.round(W * 0.92);
    if (!opt.W) { cv.width = W; cv.height = H; }
    var c = cv.getContext('2d'), fg = opt.fg || '#dfe4ec', mu = opt.muted || '#8b95a5';
    c.fillStyle = opt.bg || '#191d25'; c.fillRect(0, 0, W, H);
    if (!r) { c.fillStyle = mu; c.font = (11 * d) + 'px system-ui, sans-serif'; c.fillText(opt.msg || 'Pas de paroi (briques, lames) ou pas de fichier EPW.', 6 * d, 16 * d); return; }
    var keys = ['Ta', 'Ti', 'Tos', 'Top', 'Tbo', 'TboMax', 'Tf', 'Tdew'], lo = 1e9, hi = -1e9;
    keys.forEach(function (k) { r[k].forEach(function (v) { lo = Math.min(lo, v); hi = Math.max(hi, v); }); });
    lo = Math.floor(lo / 2) * 2 - 1; hi = Math.ceil(hi / 2) * 2 + 1;
    var rows = Math.ceil(keys.length / 2), pl = 30 * d, pr = 6 * d, pt = 8 * d, pb = (30 + rows * 12) * d, gw = W - pl - pr, gh = H - pt - pb;
    function X(t) { return pl + t / 24 * gw; } function Y(T) { return pt + (hi - T) / (hi - lo) * gh; }
    var S0 = CLW.Sun, di = S0.dayInfo(r.n);
    c.fillStyle = 'rgba(0,0,0,0.25)'; if (di.rise != null) { c.fillRect(X(0), pt, X(di.rise) - X(0), gh); c.fillRect(X(di.set), pt, X(24) - X(di.set), gh); }
    c.fillStyle = 'rgba(111,209,142,0.13)'; c.fillRect(X(0), Y(Math.min(hi, 26)), gw, Math.max(0, Y(Math.max(lo, 20)) - Y(Math.min(hi, 26))));
    c.strokeStyle = 'rgba(255,255,255,0.08)'; c.fillStyle = mu; c.font = (9 * d) + 'px system-ui, sans-serif'; c.textAlign = 'right'; c.textBaseline = 'middle';
    var stp = hi - lo > 24 ? 5 : 2;
    for (var T = Math.ceil(lo / stp) * stp; T <= hi; T += stp) { c.beginPath(); c.moveTo(pl, Y(T)); c.lineTo(pl + gw, Y(T)); c.stroke(); c.fillText(T + '°', pl - 3 * d, Y(T)); }
    c.textAlign = 'center'; c.textBaseline = 'top';
    for (var h = 0; h <= 24; h += 3) c.fillText(h + ' h', X(h), pt + gh + 3 * d);
    // heures de condensation possible
    c.fillStyle = 'rgba(95,208,208,0.35)'; r.cond.forEach(function (v, i) { if (v) c.fillRect(X(r.t[i]), pt + gh - 4 * d, gw / r.t.length + 0.5, 4 * d); });
    keys.forEach(function (k) {
      c.strokeStyle = COLS[k]; c.lineWidth = (k === 'Ti' || k === 'Ta' ? 2 : 1.3) * d; c.setLineDash(dash(k, d));
      c.beginPath(); r[k].forEach(function (v, i) { if (i) c.lineTo(X(r.t[i]), Y(v)); else c.moveTo(X(r.t[i]), Y(v)); }); c.stroke();
    });
    c.setLineDash([]);
    var t = S0.state.t, a = TH.at(t);
    c.strokeStyle = 'rgba(255,255,255,0.8)'; c.lineWidth = d; c.beginPath(); c.moveTo(X(t), pt); c.lineTo(X(t), pt + gh); c.stroke();
    if (a) keys.forEach(function (k) { c.fillStyle = COLS[k]; c.beginPath(); c.arc(X(t), Y(a[k]), 2.6 * d, 0, 7); c.fill(); });
    c.textAlign = 'left'; c.textBaseline = 'middle'; c.font = (9.5 * d) + 'px system-ui, sans-serif';
    keys.forEach(function (k, i) {
      var lx = 6 * d + (i % 2) * (W / 2), ly = pt + gh + 20 * d + Math.floor(i / 2) * 12 * d;
      c.strokeStyle = COLS[k]; c.lineWidth = 2 * d; c.setLineDash(dash(k, d)); c.beginPath(); c.moveTo(lx, ly); c.lineTo(lx + 12 * d, ly); c.stroke(); c.setLineDash([]);
      c.fillStyle = fg; c.fillText(LABS[k] + (a ? ' ' + fmt(a[k], 1) + '°' : ''), lx + 15 * d, ly);
    });
    c.fillStyle = 'rgba(111,209,142,0.9)'; c.fillText('bande 20 à 26 °C · ressenti : température apparente', 6 * d, pt + gh + 20 * d + rows * 12 * d);
    if (!opt.W) TH.curveLayout = { X0: pl / d, W: gw / d, dpr: d };
  };

  // ---------------------------------------------------------------- synthèse (colonne Résultats)
  TH.render = function () {
    if (CLW.vdisp && CLW.vdisp() === 'temp' && CLW.drawVcut) { try { CLW.drawVcut(); } catch (e) { console.error(e); } }
    var cv = $('th-curves'); if (cv) TH.drawCurves(cv, { msg: !CLW.EPW.data || !CLW.EPW.data() ? 'Chargez un fichier EPW (onglet Vent).' : 'Pas de paroi en briques ou lames dans la scène.' });
    var box = $('th-sum'); if (box) box.innerHTML = TH.summaryHtml();
    var fi = $('th-floorinfo'), F = FLOORS[O.floor] || FLOORS.beton, Fp = floorProps(F);
    if (fi) fi.textContent = 'α ' + fmt(F.alpha, 2) + ' (albédo ' + fmt(1 - F.alpha, 2) + ') · ε ' + fmt(F.eps, 2) + ' · effusivité ' + fmt(Fp.b, 0) + ' · masse utile ' + fmt(Fp.C / 1000, 0) + ' kJ/m²K. ' + F.note + '.';
    var ri = $('th-roofinfo'), Rr = ROOFS[O.roof] || ROOFS.corten;
    if (ri) ri.textContent = 'α dessus ' + fmt(Rr.alpha, 2) + ' · part transmise à la sous-face ' + fmt(100 * Rr.trans, 0) + ' % · ε sous-face ' + fmt(Rr.epsU, 2) + '. ' + Rr.note + '.';
    var mi = $('th-matinfo'); if (mi) { var m = MATS[O.mat]; mi.textContent = m.name + ', pour les briques et les lames : ' + m.note + '.'; }
    var gi = $('th-geo'), G = TH.geometry();
    if (gi) gi.innerHTML = G ? 'Paroi : ' + fmt(G.Awall, 1) + ' m² (périmètre ' + fmt(G.perim, 1) + ' m, hauteur ' + fmt(G.Hw, 2) + ' m), intérieur ' + fmt(G.area, 1) + ' m². ' +
      (G.roof ? 'Toit détecté : ' + fmt(100 * G.open, 0) + ' % du sol sous le ciel ouvert.' : 'Pas de toit : ciel ouvert.') +
      ' Réservoir auto ' + fmt(TH.tankAuto(G) / 1000, 1) + ' m³ (cuves de ' + fmt(O.wsurf, 1) + ' m², 45 cm utiles, à moitié pleines au 1er juin), collecte auto ' + fmt(TH.catchAuto(G), 1) + ' m².' : 'Pas de paroi (écrans) dans la scène.';
    var sc = $('th-season'); if (sc) TH.drawSeason(sc);
    var ss = $('th-season-sum'); if (ss) ss.innerHTML = TH.seasonHtml();
    if (CLW.engine) { CLW.engine.fieldDirty = true; }
    if (CLW.Sun) CLW.Sun.drawCut();
    feel.hourKey = null;
  };
  TH.summaryHtml = function () {
    var s = TH.summary(), r = RES; if (!s) return '<div class="hint">Résultat disponible avec un fichier EPW et une paroi (briques, lames).</div>';
    var S0 = CLW.Sun, a = TH.at(S0.state.t), f = fmt, h = '';
    function row(l, v, cls) { return '<div class="bil-row' + (cls ? ' ' + cls : '') + '"><span>' + l + '</span><b>' + v + '</b></div>'; }
    function sub(l, v) { return '<div class="bil-row sub"><span>' + l + '</span><span>' + v + '</span></div>'; }
    function dT(x) { return (x >= 0 ? '+' : '−') + f(Math.abs(x), 1) + ' °C'; }
    h += '<div class="th-cards">';
    h += '<div class="th-card"><small>À ' + S0.hhmm(S0.state.t) + '</small><b>' + f(a.Ta, 1) + '° → ' + f(a.Ti, 1) + '°</b><span>air extérieur → intérieur (' + dT(a.Ti - a.Ta) + ') · HR ' + f(a.RH, 0) + ' → ' + f(a.RHi, 0) + ' %</span></div>';
    h += '<div class="th-card"><small>Maximum de la journée, air</small><b>' + f(s.TaMax, 1) + '° → ' + f(s.TiMax, 1) + '°</b><span>dehors → dedans</span></div>';
    h += '<div class="th-card"><small>Ressenti au plus chaud</small><b>' + f(s.TosMax, 1) + '° → ' + f(s.TopMax, 1) + '°</b><span>dehors au soleil → dedans à l\'ombre</span></div>';
    h += '<div class="th-card"><small>Nuit, minimum</small><b>' + f(s.TaMin, 1) + '° → ' + f(s.TiMin, 1) + '°</b><span>ressenti ' + f(s.TopMin, 1) + '°</span></div>';
    h += '<div class="th-card"><small>Heures de ressenti > 26 °C</small><b>' + f(s.hot[0], 1) + ' h → ' + f(s.hot[1], 1) + ' h</b><span>dehors au soleil → dedans</span></div>';
    h += '</div>';
    var fs = feel.stats;
    var us = feel.ustats;
    if (us && CLW.state.display === 'utci' && CLW.UTCI) {
      var cn = function (v) { return v != null && isFinite(v) ? f(v, 1) + ' ° (' + CLW.UTCI.CLASSES[CLW.UTCI.classOf(v)].name + ')' : '–'; };
      h += row('UTCI en plan à ' + S0.hhmm(S0.state.t), cn(us.inn) + ' dedans') + sub('dehors au soleil ' + cn(us.sun) + ', à l\'ombre du refuge ' + cn(us.shade), '');
    }
    if (fs && CLW.state.display === 'feel') h += row('Ressenti en plan à ' + S0.hhmm(S0.state.t), f(fs.inn, 1) + ' ° dedans') + sub('dehors au soleil ' + f(fs.sun, 1) + ' °, à l\'ombre ' + (fs.shade != null ? f(fs.shade, 1) + ' °' : '–'), '');
    var PJ = r.jk;
    if (PJ) {
      var cw = 0, wsum = 0, wd0 = CLW.Sun.epwAt(r.n, S0.state.t), wdir = wd0 ? wd0.wd : 0;
      for (var kq = 0; kq < NK; kq++) { var ww = Math.max(0, Math.cos((wdir - 45 * kq) * RAD)); cw += ww * PJ.closed[kq]; wsum += ww; }
      h += row('Air refroidi par les briques à ' + S0.hhmm(S0.state.t), dT(a.Tsup - a.Ta)) +
        sub('brique de Grasshopper : ' + f(PJ.src.depth * 100, 0) + ' cm, ouverture ' + f(PJ.src.aExt * 1e4, 0) + ' → ' + f(PJ.src.aInt * 1e4, 0) + ' cm² ; ' + PJ.nTot + ' lames, fermées à ' + f(100 * (wsum ? cw / wsum : 0), 0) + ' % face au vent', '');
    } else h += row('Air refroidi par les briques', dT(a.Tsup - a.Ta)) + sub('fente type : paroi ' + f(O.ep * 100, 0) + ' cm, joint ' + f(O.joint * 100, 0) + ' cm (branchez « brique » et « lames » au composant CL-WIND Live)', '');
    h += row('Écart intérieur − extérieur de jour', dT(s.dDay)) + sub('moyenne de 10 h à 18 h, air', '');
    h += row('Brique, face la plus chaude', f(s.faceMax, 1) + ' ° (face ' + s.faceMaxName + ')') + sub('moyenne : ' + f(s.TboMax, 1) + ' ° dehors, ' + f(s.TbiMax, 1) + ' ° dedans', '');
    if (!O.drip && !O.mist) h += sub('déphasage (face intérieure)', f(s.lag, 1) + ' h après le pic d\'air, amplitude × ' + f(s.damp, 2));
    h += row('Chaleur stockée dans la paroi', f(s.store, 1) + ' kWh') + sub('soit ' + f(s.storeM2, 0) + ' Wh/m² de brique ; soleil absorbé ' + f(s.solAbs / 1000, 2) + ' kWh/m²', '');
    h += row('Rendue la nuit', f(s.nightIn, 1) + ' kWh dedans, ' + f(s.nightOut, 1) + ' kWh dehors');
    h += row('Humidité intérieure, maximum', f(s.RHiMax, 0) + ' %') + sub(s.cond > 0 ? 'condensation possible ' + f(s.cond, 1) + ' h (brique ou sol sous le point de rosée)' : 'pas de condensation', '');
    if (!r.water) h += row('Eau', 'hors saison') + sub('goutte-à-goutte arrêté et cuves vidées hors de juin à septembre', '');
    else if (O.drip) h += row('Goutte-à-goutte, eau évaporée par les briques', f(s.evap, 0) + ' L/jour') + sub('le reste ruisselle sur les tuiles et retourne aux cuves', '');
    if (r.water) h += row('Réservoirs, eau évaporée en surface', f(s.res, 0) + ' L/jour') + sub(f(O.wsurf, 1) + ' m² d\'eau libre sous la grille', '');
    if (O.mist) h += row('Brumisation, eau évaporée', f(s.mist, 0) + ' L/jour') + sub('buses : ' + f(O.mistMax, 0) + ' L/h au plus, arrêt au-delà de ' + f(O.mistRH, 0) + ' % d\'humidité', '');
    h += row('Renouvellement d\'air', f(s.ach, 0) + ' vol/h') + sub(r.vent.src, '');
    h += row('Sol intérieur au soleil', f(100 * s.sunMax, 0) + ' % au plus') + sub('taches de soleil calculées sur la géométrie (briques, toit)', '');
    h += '<div class="hint">Modèle simplifié (paroi en 8 orientations à deux nœuds, air bien mélangé, sol avec inertie). Ressenti : température apparente de Steadman (air, humidité, vent, rayonnement). Comparez les variantes plutôt que les degrés absolus.</div>';
    return h;
  };

  // ---------------------------------------------------------------- carte de température (plan)
  // traceur passif émis par la paroi et transporté par le vent moyen (fenêtre autour de l'ouvrage), normalisé pour que
  // la moyenne intérieure donne la température intérieure du modèle : T = Ta + c / c_int × (Ti − Ta)
  var tempField = TH.tempField = { key: null, c: null, win: null, hourT: null };
  function solveTracer() {
    var E = CLW.engine, g = E.grid, G = TH.geometry(); if (!g || !E.mean || !G || !E.samples) return null;
    var key = [g.nx, g.ny, g.dx, E.samples > 0 ? Math.floor(E.samples / (E.stable ? 1e9 : 400)) : 0, CLW.Sun.sceneKey(), E.stable, E.gen].join('|');
    if (tempField.key === key) return tempField;
    if (tempField.key && !E.stable && tempField.gen === E.gen && performance.now() - tempField.time < 15000) return tempField;
    var half = Math.max(12, 4 * G.R), i0 = Math.max(0, Math.floor((G.cx - half - g.x0) / g.dx)), i1 = Math.min(g.nx - 1, Math.ceil((G.cx + half - g.x0) / g.dx));
    var j0 = Math.max(0, Math.floor((g.y0 - (G.cy + half)) / g.dx)), j1 = Math.min(g.ny - 1, Math.ceil((g.y0 - (G.cy - half)) / g.dx));
    var f = Math.max(1, Math.ceil(Math.max(i1 - i0 + 1, j1 - j0 + 1) / 260)), nx = Math.floor((i1 - i0 + 1) / f), ny = Math.floor((j1 - j0 + 1) / f);
    if (nx < 8 || ny < 8) return null;
    var N = nx * ny, u = new Float32Array(N), v = new Float32Array(N), sol = new Uint8Array(N), src = new Float32Array(N), inn = new Uint8Array(N), az = new Float32Array(N);
    var solid = E.rast.solid, mask = E.rast.screenMask, U = CLW.LBM.U_LAT, umax = 1e-6;
    for (var J = 0; J < ny; J++) for (var I = 0; I < nx; I++) {
      var su = 0, sv = 0, ns = 0, nsr = 0, k2 = J * nx + I;
      for (var b = 0; b < f; b++) for (var a2 = 0; a2 < f; a2++) {
        var k = (j0 + J * f + b) * g.nx + i0 + I * f + a2;
        if (solid[k]) { ns++; continue; }
        su += E.mean[3 * k] / U; sv += -E.mean[3 * k + 1] / U; if (mask && mask[k]) nsr++;
      }
      var nf = f * f - ns; sol[k2] = ns > nf ? 1 : 0;
      u[k2] = nf ? su / nf : 0; v[k2] = nf ? sv / nf : 0; umax = Math.max(umax, Math.hypot(u[k2], v[k2]));
      src[k2] = nsr / (f * f);
      var x = g.x0 + (i0 + (I + 0.5) * f) * g.dx, y = g.y0 - (j0 + (J + 0.5) * f) * g.dx;
      inn[k2] = inPoly(x, y, G.hull) ? 1 : 0;
      az[k2] = Math.atan2(x - G.cx, y - G.cy) / RAD;
    }
    var c = new Float32Array(N), c2 = new Float32Array(N), D = 0.12, cfl = 0.45 / (umax + 4 * D), kS = 0.6;
    var it = Math.min(4000, Math.round(3 * Math.max(nx, ny) / (umax * cfl)));
    for (var n = 0; n < it; n++) {
      for (var j = 1; j < ny - 1; j++) for (var i = 1; i < nx - 1; i++) {
        var q = j * nx + i; if (sol[q]) { c2[q] = 0; continue; }
        var uu = u[q], vv = -v[q];
        var cq = c[q], cw = sol[q - 1] ? cq : c[q - 1], ce = sol[q + 1] ? cq : c[q + 1], cn = sol[q - nx] ? cq : c[q - nx], cs = sol[q + nx] ? cq : c[q + nx];
        var adv = (uu > 0 ? uu * (cq - cw) : uu * (ce - cq)) + (vv > 0 ? vv * (cq - cn) : vv * (cs - cq));
        var dif = D * (cw + ce + cn + cs - 4 * cq);
        c2[q] = cq + cfl * (-adv + dif + kS * src[q] * (1 - cq) * (umax + 0.05));
      }
      for (var i3 = 0; i3 < nx; i3++) { c2[i3] = v[i3] > 0 ? c2[nx + i3] : 0; c2[(ny - 1) * nx + i3] = v[(ny - 1) * nx + i3] < 0 ? c2[(ny - 2) * nx + i3] : 0; }
      for (var j3 = 0; j3 < ny; j3++) { c2[j3 * nx] = u[j3 * nx] < 0 ? c2[j3 * nx + 1] : 0; c2[j3 * nx + nx - 1] = u[j3 * nx + nx - 1] > 0 ? c2[j3 * nx + nx - 2] : 0; }
      var tmp = c; c = c2; c2 = tmp;
    }
    var ci = 0, ni = 0; for (var q2 = 0; q2 < N; q2++) if (inn[q2] && !sol[q2] && src[q2] === 0) { ci += c[q2]; ni++; }
    // air rafraîchi face par face : 8 champs de base (un par orientation de paroi). Le champ k vaut 1 dans les briques de
    // la face k, 0 dans les autres et dans l'air qui arrive ; transport linéaire, donc à chaque heure
    // T = Ta + Σ_k φ_k × (T_sortie,k − Ta), sans recalcul. Recalculés quand le vent est stabilisé (ou si absents).
    var sameWin = tempField.phi && tempField.phiN === N && tempField.win && tempField.win.i0 === i0 && tempField.win.j0 === j0;
    if (E.stable || !sameWin) {
      var fk = new Int8Array(N).fill(-1), NKk = NK, phi = new Float32Array(NKk * N), ph2 = new Float32Array(NKk * N);
      for (var qf = 0; qf < N; qf++) if (src[qf] > 0) fk[qf] = Math.round((((az[qf] % 360) + 360) % 360) / 45) % NKk;
      var DP = 0.08;
      for (var n2 = 0; n2 < it; n2++) {
        for (var jp = 1; jp < ny - 1; jp++) for (var ip = 1; ip < nx - 1; ip++) {
          var qp = jp * nx + ip; if (sol[qp]) continue;
          var up2 = u[qp], vp2 = -v[qp], sw = sol[qp - 1], se = sol[qp + 1], sn = sol[qp - nx], ss = sol[qp + nx], rs = src[qp], fq = fk[qp];
          for (var kk = 0; kk < NKk; kk++) {
            var o0 = kk * N, pq = phi[o0 + qp], pw = sw ? pq : phi[o0 + qp - 1], pe = se ? pq : phi[o0 + qp + 1], pn = sn ? pq : phi[o0 + qp - nx], ps = ss ? pq : phi[o0 + qp + nx];
            var ad = (up2 > 0 ? up2 * (pq - pw) : up2 * (pe - pq)) + (vp2 > 0 ? vp2 * (pq - pn) : vp2 * (ps - pq));
            var val = pq + cfl * (-ad + DP * (pw + pe + pn + ps - 4 * pq));
            if (rs > 0) { var tgt = fq === kk ? 1 : 0; val += Math.min(1, cfl * 4 * rs * (umax + 0.05)) * (tgt - val); }
            ph2[o0 + qp] = val;
          }
        }
        var tp = phi; phi = ph2; ph2 = tp; // bords : air entrant = 0 (rien à faire : jamais écrits, restent à 0)
      }
      tempField.phi = phi; tempField.phiN = N; tempField.fk = fk;
    }
    tempField.key = key; tempField.c = c; tempField.src = src; tempField.sol = sol; tempField.inn = inn; tempField.u = u; tempField.v = v; tempField.az = az;
    tempField.cin = ni ? Math.max(1e-3, ci / ni) : 1;
    tempField.win = { i0: i0, j0: j0, f: f, nx: nx, ny: ny, x0: g.x0 + i0 * g.dx, yt: g.y0 - j0 * g.dx, res: f * g.dx }; tempField.gen = E.gen; tempField.time = performance.now();
    return tempField;
  }
  // température de l'air locale (fenêtre de la carte), cellule q
  // avec les champs de base : air sorti des briques de chaque face (T_sortie,k), puis, dedans, le reste de l'écart
  // du modèle (sol, toit, parois intérieures : Ti − Tsup) réparti comme le traceur
  function airAt(q, a) {
    var tf = tempField; if (tf.src[q] > 0.3) return null;
    if (tf.phi && a.TexK && tf.phiN === tf.c.length) {
      var th = 0, N = tf.phiN; for (var k = 0; k < NK; k++) th += tf.phi[k * N + q] * (a.TexK[k] - a.Ta);
      return a.Ta + th + Math.min(1.6, tf.c[q] / tf.cin) * (a.Ti - a.Tsup);
    }
    return a.Ta + Math.min(1.6, tf.c[q] / tf.cin) * (a.Ti - a.Ta);
  }
  TH.airAt = airAt;

  // ---------------------------------------------------------------- coupe verticale en température (calcul 3D)
  // tranche du champ moyen 3D le long du trait de coupe : la température (écart à l'air extérieur) est transportée par
  // le vent de la tranche (composante le long du trait et verticale). Sources : briques (air à la sortie de leur face),
  // sous-face du toit et sol intérieur (échange plus lent). Air entrant : température extérieure.
  // kind : 0 air, 1 brique (écran poreux), 2 toit, 3 sol intérieur, 4 autre solide, 5 sol extérieur
  var secT = { key: null }, secId = 0;
  TH.sectionTemp = function () {
    var E = CLW.engine, G = E && E.vox, vd = E && E.vdata, pp = E && E.vplane && E.vplane[2], a = TH.at(CLW.Sun.state.t), GE = TH.geometry();
    if (!G || !vd || !pp || !a || !GE || !a.TexK) return null;
    if (!vd._id) vd._id = ++secId;
    var key = [E.gen, vd._id, CLW.Sun.state.t, resKey].join('|');
    if (secT.key === key) return secT;
    var w = vd.w, h = vd.h, N = w * h, plane = G.nx * G.ny, sc = 1 / E.uref3, len = Math.hypot(pp.sx, pp.sy) || 1, ex = pp.sx / len, ey = pp.sy / len;
    var us = new Float32Array(N), ws = new Float32Array(N), kind = new Uint8Array(N), tgt = new Float32Array(N), rate = new Float32Array(N), mat = new Float32Array(N).fill(NaN);
    var Ta = a.Ta, umax = 1e-6, zRoof = 0.5 * GE.Hw;
    for (var x = 0; x < w; x++) {
      var ci = Math.min(G.nx - 1, Math.max(0, Math.round(pp.ox + pp.sx * x))), cj = Math.min(G.ny - 1, Math.max(0, Math.round(pp.oy + pp.sy * x)));
      var X = G.x0 + (ci + 0.5) * G.dx, Y = G.ys + (cj + 0.5) * G.dx, inside = inPoly(X, Y, GE.hull);
      var fk = Math.round((((Math.atan2(X - GE.cx, Y - GE.cy) / RAD) % 360 + 360) % 360) / 45) % NK;
      for (var z = 0; z < h; z++) {
        var q = z * w + x, id = z * plane + cj * G.nx + ci;
        if (G.flags[id] & 1) {
          if (z === 0) { kind[q] = inside ? 3 : 5; if (inside) mat[q] = a.Tf; }
          else if ((z + 0.5) * G.dx > zRoof && inside) { kind[q] = 2; mat[q] = a.TroofU != null ? a.TroofU : Ta; }
          else kind[q] = 4;
          continue;
        }
        var o = 4 * (z * w + x);
        us[q] = (vd.data[o] * ex + vd.data[o + 1] * ey) * sc / len; ws[q] = vd.data[o + 2] * sc;
        umax = Math.max(umax, Math.abs(us[q]) + Math.abs(ws[q]));
        var L = G.layers && G.layers[z];
        if (L && L.mask && L.mask[(G.ny - 1 - cj) * G.nx + ci]) { kind[q] = 1; tgt[q] = a.TexK[fk] - Ta; rate[q] = 1; mat[q] = 0.5 * (a.TboK[fk] + a.TbiK[fk]); }
        else if (z === 1 && inside) { tgt[q] = a.Tf - Ta; rate[q] = 0.12; }
        else if (inside && (z + 0.5) * G.dx > zRoof && z + 1 < h && (G.flags[(z + 1) * plane + cj * G.nx + ci] & 1)) { tgt[q] = (a.TroofU != null ? a.TroofU : Ta) - Ta; rate[q] = 0.12; }
      }
    }
    var th = new Float32Array(N), t2 = new Float32Array(N), D = 0.08, cfl = 0.45 / (umax + 4 * D);
    var it = Math.min(3000, Math.round(3 * Math.max(w, h) / (umax * cfl)));
    for (var n = 0; n < it; n++) {
      for (var zz = 1; zz < h - 1; zz++) for (var xx = 1; xx < w - 1; xx++) {
        var p = zz * w + xx, kp = kind[p]; if (kp >= 2) continue;
        var tq = th[p], sl = kind[p - 1] >= 2, sr = kind[p + 1] >= 2, sd = kind[p - w] >= 2, su = kind[p + w] >= 2;
        var tl = sl ? tq : th[p - 1], tr = sr ? tq : th[p + 1], td = sd ? tq : th[p - w], tu = su ? tq : th[p + w];
        var uu = us[p], vv = ws[p];
        var adv = (uu > 0 ? uu * (tq - tl) : uu * (tr - tq)) + (vv > 0 ? vv * (tq - td) : vv * (tu - tq));
        var val = tq + cfl * (-adv + D * (tl + tr + td + tu - 4 * tq));
        if (rate[p] > 0) val += Math.min(1, cfl * 4 * rate[p] * (umax + 0.05)) * (tgt[p] - val);
        t2[p] = val;
      }
      var tmp = th; th = t2; t2 = tmp;
    }
    var T = new Float32Array(N); for (var r = 0; r < N; r++) T[r] = kind[r] >= 2 ? NaN : Ta + th[r];
    secT = { key: key, T: T, kind: kind, mat: mat, w: w, h: h, Ta: Ta, dx: G.dx };
    return secT;
  };
  // couleur d'un pixel de la coupe (null : couleur par défaut)
  TH.sectionColor = function (S2, q) {
    var k = S2.kind[q];
    if (k === 1) return TH.tempColor(S2.mat[q], S2.Ta).map(function (c) { return Math.min(255, c * 0.8 + 40); });
    if (k === 0) return isFinite(S2.T[q]) ? TH.tempColor(S2.T[q], S2.Ta) : null;
    if ((k === 2 || k === 3) && isFinite(S2.mat[q])) return TH.tempColor(S2.mat[q], S2.Ta).map(function (c) { return c * 0.7; });
    return null;
  };
  TH.sectionProbe = function (S2, x, z) {
    if (!S2 || x < 0 || z < 0 || x >= S2.w || z >= S2.h) return '';
    var q = z * S2.w + x, k = S2.kind[q], hz = fmt((z + 0.5) * S2.dx, 1) + ' m';
    if (k === 0) return 'Air ' + fmt(S2.T[q], 1) + ' °C à ' + hz + ' (dehors ' + fmt(S2.Ta, 1) + ' °C)';
    if (k === 1) return 'Brique ' + fmt(S2.mat[q], 1) + ' °C ; air traversant ' + fmt(S2.T[q], 1) + ' °C, à ' + hz;
    if (k === 2) return 'Sous-face du toit ' + fmt(S2.mat[q], 1) + ' °C';
    if (k === 3) return 'Sol intérieur ' + fmt(S2.mat[q], 1) + ' °C';
    return k === 5 ? 'Sol extérieur' : 'Solide (température non calculée)';
  };

  // ---------------------------------------------------------------- ressenti dans le plan
  // ciel visible (personne debout, 1,1 m) : 45 directions du ciel, pondérées par l'angle solide ; mis en cache
  var skyCache = { key: null, svf: null };
  var BANDS = [[10, 12, 0.342], [30, 12, 0.301], [50, 12, 0.223], [70, 8, 0.119], [90, 1, 0.015]];
  function skyView(W) {
    var k = [CLW.Sun.sceneKey(), W.x0, W.yt, W.res, W.nx, W.ny].join('|');
    if (skyCache.key === k) return skyCache.svf;
    var N = W.nx * W.ny, svf = new Float32Array(N), t0 = performance.now();
    BANDS.forEach(function (bd) {
      for (var a = 0; a < bd[1]; a++) {
        var alt = bd[0] * RAD, az = (a + 0.5 * (bd[0] / 10 % 2)) * 2 * Math.PI / bd[1], SD = [Math.cos(alt) * Math.sin(az), Math.cos(alt) * Math.cos(az), Math.sin(alt)];
        var m = shadeWin(SD, W, 1.1), wgt = bd[2] / bd[1];
        for (var q = 0; q < N; q++) if (!m[q]) svf[q] += wgt;
      }
    });
    skyCache.key = k; skyCache.svf = svf; skyCache.ms = performance.now() - t0;
    return svf;
  }
  // feel.AT : ressenti (température apparente) ; feel.UT : UTCI (Bröde et al., 2012), cellule par cellule, mêmes entrées
  var feel = TH.feel = { hourKey: null, AT: null, stats: null, Tfree: null, UT: null, ustats: null, Ufree: null };
  function prepareFeel(a) {
    var tf = tempField, W = tf.win, G = TH.geometry(), r = RES; if (!W || !G || !r || !a) return;
    var S0 = CLW.Sun, n = S0.n(), t = S0.state.t, hk = [n, t, resKey, tf.key, O.mapZone].join('|');
    if (feel.hourKey === hk) return;
    var svf = skyView(W), p = S0.pos(n, t, S0.site()), w = S0.epwAt(n, t), up = p.alt > 0, N = W.nx * W.ny;
    var D = CLW.EPW.data().hourly, ir = D.IR[(n - 1) * 24 + Math.min(23, Math.floor(t))], Lsky = isFinite(ir) && ir > 50 ? ir : SIG * T4(a.Ta - 12);
    var beam = up ? w.DNI : 0, sb = null, sg = null;
    if (up) { var SD = S0.vec(p); sb = shadeWin(SD, W, 1.1); sg = shadeWin(SD, W, 0.03); }
    var pvo = a.RH / 100 * psat(a.Ta), pvi = a.RHi / 100 * psat(a.Ti), ws = w.ws, sinA = Math.sin(Math.max(0, p.alt) * RAD);
    var ho = 5.7 + 3.8 * Math.max(0.3, ws * Math.pow(0.15, 0.25)), Troof = roofUnder(a.Ta, w.GHI, ho, a.Tbi, ROOFS[O.roof] || ROOFS.corten).Teff, FLa = (FLOORS[O.floor] || FLOORS.beton).alpha;
    var AT = new Float32Array(N), sIn = 0, nIn = 0, sSun = 0, nSun = 0, sSh = 0, nSh = 0;
    var UC = CLW.UTCI, UTa = new Float32Array(N), uIn = 0, uSun = 0, uSh = 0;
    // zone de la carte : carré de côté O.mapZone (m) centré sur l'ouvrage ; 0 = toute la fenêtre
    var Zh = O.mapZone > 0 ? O.mapZone / 2 : Infinity, inZ = new Uint8Array(N);
    for (var qz = 0; qz < N; qz++) {
      var xz = W.x0 + ((qz % W.nx) + 0.5) * W.res, yz = W.yt - (Math.floor(qz / W.nx) + 0.5) * W.res;
      inZ[qz] = Math.abs(xz - G.cx) <= Zh && Math.abs(yz - G.cy) <= Zh ? 1 : 0;
    }
    feel.zone = isFinite(Zh) ? inZ : null;
    for (var q = 0; q < N; q++) {
      if (!inZ[q]) { AT[q] = NaN; UTa[q] = NaN; continue; }
      if (tf.sol[q] || tf.src[q] > 0.3) { AT[q] = NaN; UTa[q] = NaN; continue; }
      var Tl = airAt(q, a), cr = Math.min(1, tf.c[q] / tf.cin), pv = pvo + cr * (pvi - pvo);
      var rr = Math.hypot(tf.u[q], tf.v[q]), ws10 = Math.max(0.1, rr * ws);
      var lit = up && !sb[q], glit = up && !sg[q], Tobs, Tg, Kg;
      if (tf.inn[q]) {
        Tobs = G.roof ? (0.5 * a.Tbi + 0.5 * Troof) : a.Tbi;
        Tg = a.Tf + (glit ? 0.02 * beam * sinA * FLa / 0.7 : 0); Kg = (1 - FLa) * (glit ? beam * sinA + w.DHI * svf[q] : w.DHI * svf[q]);
      } else {
        Tobs = a.TboK ? faceAt(a.TboK, tf.az[q]) : a.Tbo;
        Tg = up ? a.Ta + (glit ? 0.022 * w.GHI : 0.004 * w.GHI) : a.Ta - 1; Kg = 0.2 * (glit ? w.GHI : w.DHI * svf[q]);
      }
      var Tm = mrt(Lsky, svf[q], Tobs, Tg, lit, p.alt, beam, w.DHI, Kg), v2 = apparent(Tl, pv, ws10, Tm);
      AT[q] = v2;
      // UTCI : air local, rayonnement (température radiante moyenne), vent local ramené à 10 m (rapport au vent libre
      // appliqué au vent du fichier météo, comme dehors), humidité relative locale
      var u3 = UC ? UC.calc(Tl, Tm, Math.max(0.5, ws10), clamp(100 * pv / psat(Tl), 0, 100)) : NaN;
      UTa[q] = u3;
      if (tf.inn[q]) { sIn += v2; uIn += u3; nIn++; } else if (lit) { sSun += v2; uSun += u3; nSun++; } else if (up) { sSh += v2; uSh += u3; nSh++; }
    }
    // loin de l'ouvrage : champ libre (au soleil le jour)
    var TmFree = mrt(Lsky, 1, a.Ta, up ? a.Ta + 0.022 * w.GHI : a.Ta - 1, up, p.alt, beam, w.DHI, 0.2 * w.GHI);
    feel.Tfree = apparent(a.Ta, pvo, ws, TmFree);
    feel.Ufree = UC ? UC.calc(a.Ta, TmFree, Math.max(0.5, ws), a.RH) : null;
    feel.AT = AT; feel.UT = UC ? UTa : null; feel.hourKey = hk;
    feel.stats = { inn: nIn ? sIn / nIn : NaN, sun: nSun ? sSun / nSun : feel.Tfree, shade: nSh ? sSh / nSh : null };
    feel.ustats = UC ? { inn: nIn ? uIn / nIn : NaN, sun: nSun ? uSun / nSun : feel.Ufree, shade: nSh ? uSh / nSh : null } : null;
  }
  // couleur de la cellule k de la grille du plan (affichages « Temp. » et « Ressenti »)
  var RANGE = 6;
  TH.colorAt = function (k, solidK) {
    var tf = tempField, a = TH.at(CLW.Sun.state.t);
    if (!a) return [60, 64, 72];
    var E = CLW.engine, g = E.grid, mode = CLW.state.display, q = -1;
    if (tf.win) {
      var i = k % g.nx, j = (k / g.nx) | 0, I = Math.floor((i - tf.win.i0) / tf.win.f), J = Math.floor((j - tf.win.j0) / tf.win.f);
      if (I >= 0 && J >= 0 && I < tf.win.nx && J < tf.win.ny) q = J * tf.win.nx + I;
    }
    if (solidK) return null;
    // ressenti et UTCI : hors de la zone de la carte, fond neutre
    if ((mode === 'feel' || mode === 'utci') && feel.zone && (q < 0 || !feel.zone[q])) return [44, 48, 56];
    if (mode === 'feel') {
      if (q >= 0 && feel.AT) { var v = feel.AT[q]; if (isFinite(v)) return feelColor(v); return TH.tempColor(faceAt(a.TboK, tf.az[q]), a.Ta); }
      return feelColor(feel.Tfree != null ? feel.Tfree : a.Tos);
    }
    if (mode === 'utci') {
      // briques : température de leur face, sur la même échelle de couleurs (plus fraîches si mouillées)
      if (q >= 0 && feel.UT) { var u = feel.UT[q]; if (isFinite(u)) return utciColor(u); return utciColor(faceAt(a.TboK, tf.az[q])); }
      return feel.Ufree != null ? utciColor(feel.Ufree) : [60, 64, 72];
    }
    var T = a.Ta;
    if (q >= 0) T = tf.src[q] > 0.3 ? 0.5 * (faceAt(a.TboK, tf.az[q]) + faceAt(a.TbiK, tf.az[q])) : airAt(q, a);
    return TH.tempColor(T, a.Ta);
  };
  // texte de la sonde (survol du plan)
  TH.probeText = function (k) {
    var tf = tempField, a = TH.at(CLW.Sun.state.t), E = CLW.engine, g = E.grid; if (!a || !tf.win) return '';
    var i = k % g.nx, j = (k / g.nx) | 0, I = Math.floor((i - tf.win.i0) / tf.win.f), J = Math.floor((j - tf.win.j0) / tf.win.f);
    if (I < 0 || J < 0 || I >= tf.win.nx || J >= tf.win.ny) return '';
    var q = J * tf.win.nx + I, Tl = airAt(q, a);
    if (Tl == null) {
      var kf = Math.round((((tf.az[q] % 360) + 360) % 360) / 45) % NK;
      return ' · brique ' + fmt(a.TboK[kf], 1) + ' °C dehors / ' + fmt(a.TbiK[kf], 1) + ' °C dedans (face ' + ORI[kf] + ')' +
        (a.TexK ? ' · air sortant des joints ' + fmt(a.TexK[kf], 1) + ' °C (' + (a.TexK[kf] - a.Ta > 0 ? '+' : '') + fmt(a.TexK[kf] - a.Ta, 1) + ' °C)' : '');
    }
    var s = ' · air ' + fmt(Tl, 1) + ' °C';
    if (feel.AT && isFinite(feel.AT[q])) s += ' · ressenti ' + fmt(feel.AT[q], 1) + ' °C';
    if (feel.UT && isFinite(feel.UT[q]) && CLW.UTCI) s += ' · UTCI ' + fmt(feel.UT[q], 1) + ' °C (' + CLW.UTCI.CLASSES[CLW.UTCI.classOf(feel.UT[q])].name + ')';
    if (skyCache.svf) s += ' · ciel visible ' + fmt(100 * skyCache.svf[q], 0) + ' %';
    return s;
  };
  TH.prepareField = function () {
    try { solveTracer(); } catch (e) { console.error(e); }
    var a = TH.at(CLW.Sun.state.t);
    // pas des paliers de couleur : d'après l'écart réel de l'air dans la carte (0,1 à 1 °C), au plus 8 paliers de chaque côté
    if (a) {
      var tf = tempField, spread = Math.abs(a.Ti - a.Ta);
      if (tf.c && tf.win) for (var q = 0; q < tf.c.length; q++) { if (tf.sol[q]) continue; var Tq = airAt(q, a); if (Tq != null) spread = Math.max(spread, Math.abs(Tq - a.Ta)); }
      TSTEPV = 1; for (var si = 0; si < STEPS.length; si++) if (spread / STEPS[si] <= 8) { TSTEPV = STEPS[si]; break; }
      TSPREAD = spread;
      RANGE = clamp(Math.ceil(spread / TSTEPV + 1e-9), 3, 8);
    }
    if (CLW.state.display === 'feel' || CLW.state.display === 'utci') { try { prepareFeel(a); } catch (e) { console.error(e); } var box = $('th-sum'); if (box && feel.stats) box.innerHTML = TH.summaryHtml(); }
  };
  // couleur UTCI : dégradé continu passant par les couleurs officielles des classes (au milieu de chaque classe),
  // pour voir aussi les écarts à l'intérieur d'une même classe (« sans stress » couvre 9 à 26 °C)
  function hexRgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  var UANCH = null;
  function utciColor(u) {
    var U = CLW.UTCI; if (!U) return [60, 64, 72];
    if (!UANCH) { var C = U.CLASSES; UANCH = [[-33.5, 1], [-20, 2], [-6.5, 3], [4.5, 4], [17.5, 5], [29, 6], [35, 7], [42, 8], [50, 9]].map(function (p) { return [p[0], hexRgb(C[p[1]].col)]; }); }
    if (!(u > UANCH[0][0])) return UANCH[0][1];
    for (var i = 1; i < UANCH.length; i++) if (u < UANCH[i][0]) { var a = UANCH[i - 1], b = UANCH[i], f = (u - a[0]) / (b[0] - a[0]); return [0, 1, 2].map(function (c) { return Math.round(a[1][c] + f * (b[1][c] - a[1][c])); }); }
    return UANCH[UANCH.length - 1][1];
  }
  TH.utciColor = utciColor;
  // température de l'air : un palier de couleur par degré (degrés entiers), centré sur le degré de l'air extérieur ;
  // bleus plus frais, crème = degré de l'air extérieur, jaunes → rouges → violets plus chauds ; au-delà de ±8 °C,
  // couleur extrême. Deux paliers voisins ont toujours des couleurs nettement différentes.
  var TSTEP = [[33, 53, 130], [37, 80, 165], [44, 110, 195], [60, 140, 215], [90, 170, 225], [125, 195, 230], [160, 215, 235], [200, 232, 240],
    [240, 238, 220], [252, 228, 150], [250, 200, 100], [245, 165, 70], [235, 125, 50], [218, 88, 42], [188, 55, 48], [150, 30, 62], [110, 20, 82]];
  var STEPS = [0.1, 0.2, 0.25, 0.5, 1], TSTEPV = 1, TSPREAD = 0;
  function tempStep(T, Ta) { var s = TSTEPV; return clamp(Math.floor(T / s + 1e-9) - Math.floor(Ta / s + 1e-9), -8, 8); }
  TH.tempColor = function (T, Ta) { return TSTEP[tempStep(T, Ta) + 8].slice(); };
  // échelle absolue du ressenti (seuils indicatifs de stress thermique)
  var FEEL = [[0, [40, 70, 160]], [12, [70, 130, 210]], [20, [120, 200, 220]], [23, [110, 200, 120]], [26, [190, 215, 90]], [29, [245, 205, 70]], [32, [245, 150, 55]], [38, [225, 70, 45]], [46, [140, 25, 45]]];
  function feelColor(v) {
    if (!(v > FEEL[0][0])) return FEEL[0][1];
    for (var i = 1; i < FEEL.length; i++) if (v < FEEL[i][0]) { var a = FEEL[i - 1], b = FEEL[i], f = (v - a[0]) / (b[0] - a[0]); return [0, 1, 2].map(function (c) { return Math.round(a[1][c] + f * (b[1][c] - a[1][c])); }); }
    return FEEL[FEEL.length - 1][1];
  }
  TH.feelColor = feelColor;
  TH.drawLegend = function (ctx, w, h, fg, font) {
    var a = TH.at(CLW.Sun.state.t), x0 = 6, bw = w - 12, by = font + 8, bh = Math.max(10, h * 0.22), S0 = CLW.Sun;
    ctx.fillStyle = fg; ctx.textBaseline = 'top';
    if (CLW.state.display === 'utci') {
      var UC = CLW.UTCI;
      ctx.fillText(a && UC ? 'UTCI (stress thermique), ' + S0.dateTxt(S0.state.m, S0.state.d) + ' ' + S0.hhmm(S0.state.t) : 'UTCI : fichier EPW et paroi nécessaires', x0, 2);
      if (!a || !UC) return;
      // dégradé de −13 à 50 °C, seuils des classes ; briques : température de surface sur la même échelle
      var ulo = -13, uhi = 50;
      for (var i4 = 0; i4 < bw; i4++) { var c4 = utciColor(ulo + i4 / bw * (uhi - ulo)); ctx.fillStyle = 'rgb(' + c4.join(',') + ')'; ctx.fillRect(x0 + i4, by, 1.5, bh); }
      ctx.fillStyle = fg;
      [0, 9, 26, 32, 38, 46].forEach(function (s) {
        var tx = x0 + (s - ulo) / (uhi - ulo) * bw, lab = s + '°', tw3 = ctx.measureText(lab).width;
        ctx.fillRect(tx - 0.5, by + bh, 1, 4); ctx.fillText(lab, clamp(tx - tw3 / 2, 0, w - tw3), by + bh + 6);
      });
      return;
    }
    if (CLW.state.display === 'feel') {
      ctx.fillText(a ? 'Ressenti (temp. apparente), ' + S0.dateTxt(S0.state.m, S0.state.d) + ' ' + S0.hhmm(S0.state.t) : 'Ressenti : fichier EPW et paroi nécessaires', x0, 2);
      if (!a) return;
      var lo = 10, hi = 46;
      for (var i2 = 0; i2 < bw; i2++) { var c2 = feelColor(lo + i2 / bw * (hi - lo)); ctx.fillStyle = 'rgb(' + c2.join(',') + ')'; ctx.fillRect(x0 + i2, by, 1.5, bh); }
      ctx.fillStyle = fg;
      [[10, ''], [20, 'confort'], [26, 'chaud'], [32, 'très'], [38, 'forte'], [46, '']].forEach(function (s) {
        var tx = x0 + (s[0] - lo) / (hi - lo) * bw, lab = s[0] + '°', tw = ctx.measureText(lab).width;
        ctx.fillRect(tx - 0.5, by + bh, 1, 4); ctx.fillText(lab, clamp(tx - tw / 2, 0, w - tw), by + bh + 6);
      });
      return;
    }
    ctx.fillText(a ? 'Température de l\'air, ' + S0.dateTxt(S0.state.m, S0.state.d) + ' ' + S0.hhmm(S0.state.t) : 'Température : fichier EPW et paroi nécessaires', x0, 2);
    if (!a) return;
    // une case par palier (pas adapté à l'écart réel de l'air), de −RANGE à +RANGE autour du palier de l'air extérieur
    var s = TSTEPV, dec = s >= 1 ? 0 : s >= 0.5 ? 1 : s === 0.25 ? 2 : 1;
    var k0 = Math.floor(a.Ta / s + 1e-9), nC = 2 * RANGE + 1, cw = bw / nC, lw = ctx.measureText(fmt(a.Ta + 10, dec) + '°').width + 10, every = Math.max(1, Math.ceil(lw / cw));
    for (var i = 0; i < nC; i++) {
      var kc = k0 - RANGE + i, c = TH.tempColor((kc + 0.5) * s, a.Ta);
      ctx.fillStyle = 'rgb(' + c.join(',') + ')'; ctx.fillRect(x0 + i * cw, by, cw - 1, bh);
      if (kc === k0) { ctx.strokeStyle = fg; ctx.lineWidth = 1.5; ctx.strokeRect(x0 + i * cw + 0.5, by + 0.5, cw - 2, bh - 1); }
    }
    ctx.fillStyle = fg;
    for (var i5 = 0; i5 <= nC; i5++) {
      var kl = k0 - RANGE + i5, tx = x0 + i5 * cw;
      ctx.fillRect(tx - 0.5, by + bh, 1, 3);
      if ((kl - k0) % every === 0) { var lab = fmt(kl * s, dec) + '°', tw = ctx.measureText(lab).width; ctx.fillText(lab, clamp(tx - tw / 2, 0, w - tw), by + bh + 5); }
    }
    var sTxt = fmt(s, s >= 1 ? 0 : s === 0.25 ? 2 : 1);
    var notes = ['un palier = ' + sTxt + ' °C · encadré : air ext. ' + fmt(a.Ta, 1) + ' °C · écart max ' + fmt(TSPREAD, 1) + ' °C',
      'palier ' + sTxt + ' °C · encadré : air ext. ' + fmt(a.Ta, 1) + ' °C', 'palier ' + sTxt + ' °C'];
    var note = notes.filter(function (t) { return ctx.measureText(t).width <= w - 4; })[0] || notes[2], tn = ctx.measureText(note).width;
    if (by + bh + 5 + 2 * font < h) ctx.fillText(note, Math.max(0, w - tn - 4), by + bh + 7 + font);
  };

  // ---------------------------------------------------------------- coupe solaire : températures
  TH.cutOverlay = function (c, L) {
    var a = TH.at(CLW.Sun.state.t), G = TH.geometry(); if (!a || !G) return;
    var d = L.d, scr = L.segs.scr, mid = L.Lg / 2, tl = -Infinity, tr = Infinity;
    for (var q = 0; q < scr.length; q += 2) { var t = scr[q]; if (t < mid && t > tl) tl = t; if (t > mid && t < tr) tr = t; }
    if (!isFinite(tl) || !isFinite(tr)) return;
    var col = TH.tempColor(a.Ti, a.Ta);
    c.fillStyle = 'rgba(' + col.join(',') + ',0.30)'; c.fillRect(L.X(tl), L.Y(G.Hw), L.X(tr) - L.X(tl), L.Y(0) - L.Y(G.Hw));
    c.fillStyle = 'rgba(' + TH.tempColor(a.Tf, a.Ta).join(',') + ',0.95)'; c.fillRect(L.X(tl), L.Y(0), L.X(tr) - L.X(tl), 5 * d);
    function tag(x, y, txt, colr, align) {
      c.font = 'bold ' + (11 * d) + 'px system-ui, sans-serif'; var w = c.measureText(txt).width + 10 * d;
      var x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      c.fillStyle = 'rgba(11,13,17,0.82)'; c.fillRect(x0, y - 9 * d, w, 18 * d);
      c.strokeStyle = colr; c.lineWidth = d; c.strokeRect(x0, y - 9 * d, w, 18 * d);
      c.fillStyle = '#f2f4f8'; c.textBaseline = 'middle'; c.textAlign = 'left'; c.fillText(txt, x0 + 5 * d, y);
    }
    // orientation des deux parois coupées (direction de la coupe : de gauche à droite)
    var ax = L.axis, azL = null, azR = null;
    if (ax) { var azDir = Math.atan2(ax[0], ax[1]) / RAD; azR = azDir; azL = azDir + 180; }
    var zt = L.Y(Math.min(G.Hw * 0.55, L.zmax * 0.5));
    tag(L.X((tl + tr) / 2), zt, 'Air intérieur ' + fmt(a.Ti, 1) + ' °C · HR ' + fmt(a.RHi, 0) + ' %', '#ff8a5c', 'center');
    tag(L.X((tl + tr) / 2), zt + 22 * d, 'Ressenti à l\'ombre ' + fmt(a.Top, 1) + ' °C', '#ffd166', 'center');
    if (a.cond) tag(L.X((tl + tr) / 2), zt + 44 * d, 'Condensation possible (rosée ' + fmt(a.Tdew, 1) + ' °C)', '#5fd0d0', 'center');
    tag(L.X((tl + tr) / 2), L.Y(0) - 14 * d, 'Sol ' + fmt(a.Tf, 1) + ' °C', '#9be08f', 'center');
    tag(Math.max(L.X(0) + 4 * d, L.X(tl) - 150 * d), L.Y(G.Hw * 0.3), 'Air ext. ' + fmt(a.Ta, 1) + ' °C', '#7fb2ff', 'left');
    if (azL != null) {
      tag(L.X(tl) + 6 * d, L.Y(G.Hw) - 14 * d, 'Brique ' + fmt(faceAt(a.TboK, azL), 1) + ' / ' + fmt(faceAt(a.TbiK, azL), 1) + ' °C', '#e8803e', 'left');
      tag(L.X(tr) - 6 * d, L.Y(G.Hw) - 14 * d, 'Brique ' + fmt(faceAt(a.TboK, azR), 1) + ' / ' + fmt(faceAt(a.TbiK, azR), 1) + ' °C', '#e8803e', 'right');
    } else tag(L.X(tl) + 6 * d, L.Y(G.Hw) - 14 * d, 'Brique ' + fmt(a.Tbo, 1) + ' / ' + fmt(a.Tbi, 1) + ' °C', '#e8803e', 'left');
    if (O.mist && a.qm > 0) tag(L.X(tl) - 6 * d, L.Y(G.Hw * 0.75), 'Brume : air entrant ' + fmt(a.Tsup, 1) + ' °C', '#9cc3ff', 'right');
    else tag(L.X(tl) - 6 * d, L.Y(G.Hw * 0.75), 'Air après les joints ' + fmt(a.Tsup, 1) + ' °C', '#9cc3ff', 'right');
    c.lineWidth = Math.max(2 * d, Math.min(4 * d, 0.05 * L.s)); c.globalAlpha = 0.85;
    [[tl, azL], [tr, azR]].forEach(function (side) {
      var Tb = side[1] != null ? 0.5 * (faceAt(a.TboK, side[1]) + faceAt(a.TbiK, side[1])) : 0.5 * (a.Tbo + a.Tbi);
      c.strokeStyle = 'rgb(' + TH.tempColor(Tb, a.Ta).join(',') + ')'; c.beginPath();
      for (var q2 = 0; q2 < scr.length; q2 += 4) { var left = scr[q2] < mid; if ((side[0] === tl) !== left) continue; c.moveTo(L.X(scr[q2]), L.Y(scr[q2 + 1])); c.lineTo(L.X(scr[q2 + 2]), L.Y(scr[q2 + 3])); }
      c.stroke();
    });
    c.globalAlpha = 1;
  };

  // ---------------------------------------------------------------- interface
  TH.init = function () {
    try { var sv = JSON.parse(localStorage.getItem('clwind-thermal') || 'null'); if (sv) Object.keys(O).forEach(function (k) { if (sv[k] != null) O[k] = sv[k]; }); } catch (e) { /* rien */ }
    if (!FLOORS[O.floor]) O.floor = 'beton'; if (!ROOFS[O.roof]) O.roof = 'corten';
    $('th-floor').innerHTML = Object.keys(FLOORS).map(function (k) { return '<option value="' + k + '">' + FLOORS[k].name + '</option>'; }).join('');
    $('th-roof').innerHTML = Object.keys(ROOFS).map(function (k) { return '<option value="' + k + '">' + ROOFS[k].name + '</option>'; }).join('');
    O.mat = 'tc'; O.mist = false; // une seule paroi (terre cuite absorbante), pas de brumisation
    $('th-mat').innerHTML = Object.keys(MATS).map(function (k) { return '<option value="' + k + '">' + MATS[k].name + '</option>'; }).join('');
    var F = { 'th-mat': 'mat', 'th-ep': 'ep', 'th-drip': 'drip', 'th-dripA': 'dripA', 'th-dripB': 'dripB', 'th-mist': 'mist', 'th-mistEff': 'mistEff', 'th-mistA': 'mistA', 'th-mistB': 'mistB', 'th-mistRH': 'mistRH', 'th-mistMax': 'mistMax', 'th-tank': 'tank', 'th-catch': 'catchA', 'th-wsurf': 'wsurf', 'th-dripMode': 'dripMode', 'th-dripTon': 'dripTon', 'th-dripRH': 'dripRH', 'th-dripToff': 'dripToff', 'th-useWindTable': 'useWindTable', 'th-floor': 'floor', 'th-roof': 'roof', 'th-mapZone': 'mapZone' };
    Object.keys(F).forEach(function (id) {
      var el = $(id), k = F[id]; if (!el) return;
      if (el.type === 'checkbox') el.checked = !!O[k]; else el.value = k === 'ep' ? Math.round(O[k] * 100) : k === 'mistEff' ? Math.round(O[k] * 100) : k === 'tank' ? (O[k] ? O[k] / 1000 : '') : (k === 'catchA' ? (O[k] || '') : O[k]);
      el.addEventListener('change', function () {
        var v = el.type === 'checkbox' ? el.checked : el.tagName === 'SELECT' ? el.value : parseFloat(String(el.value).replace(',', '.'));
        if (k === 'ep') v = clamp(v / 100, 0.02, 0.6); if (k === 'mistEff') v = clamp(v / 100, 0, 0.95);
        if ((k === 'tank' || k === 'catchA') && !isFinite(v)) v = 0;
        if (k === 'tank') v = Math.max(0, v * 1000);
        if (typeof v === 'number' && !isFinite(v)) return;
        if (k === 'mapZone') v = clamp(Math.round(v), 0, 500);
        O[k] = v;
        try { localStorage.setItem('clwind-thermal', JSON.stringify(O)); } catch (e) { /* rien */ }
        TH.update();
        if (k === 'mapZone' && CLW.engine) { feel.hourKey = null; CLW.engine.fieldDirty = true; }
      });
    });
    $('th-curves').addEventListener('click', function (e) {
      var Lc = TH.curveLayout; if (!Lc) return;
      var r = e.target.getBoundingClientRect(), t = (e.clientX - r.left - Lc.X0) / Lc.W * 24;
      if (t >= 0 && t <= 24) CLW.Sun.set({ t: Math.round(t * 4) / 4 });
    });
    var swb = $('th-sweep-run'), utb = $('th-utci-run');
    function sweepMsg() {
      var el = $('th-sweep-msg'); if (!el) return;
      if (SW.running) { el.textContent = 'Balayage : ' + SW.msg + ' (' + Math.round(100 * SW.progress) + ' %). Le calcul du vent tourne pour chaque direction.'; return; }
      var T = TH.windTable; if (!T) { el.textContent = 'Pas encore de balayage : le calcul utilise la seule direction du vent en cours.'; return; }
      el.textContent = 'Tables : ' + Object.keys(TH.windTables).join(', ') + '. Dernière : ' + T.n + ' directions. Vitesse dedans / vent libre : ' + T.rows.map(function (r) { return r.dir + '° ' + fmt(r.u, 2); }).join(' · ');
    }
    if (swb) swb.addEventListener('click', function () { if (SW.running) return; TH.sweepWinds(16, sweepMsg, ($('th-sweep-which') || {}).value || 'all').then(function () { sweepMsg(); TH.update(true); }); sweepMsg(); });
    if (utb) utb.addEventListener('click', function () {
      var cv = $('th-utci'), sm = $('th-utci-sum');
      if (!TH.utciSeasons(function () { TH.drawUtci(cv); if (sm) sm.innerHTML = TH.utciHtml(); })) return;
      var tick = setInterval(function () { TH.drawUtci(cv); if (!UT.running) clearInterval(tick); }, 500);
    });
    sweepMsg();
    var sb = $('th-season-run');
    if (sb) sb.addEventListener('click', function () {
      if (!TH.season(function () { TH.drawSeason($('th-season')); var ss = $('th-season-sum'); if (ss) ss.innerHTML = TH.seasonHtml(); })) return;
      TH.drawSeason($('th-season'));
    });
    CLW.Sun.onChange(function () { TH.update(); });
    setTimeout(function () { TH.update(true); }, 0);
    setInterval(function () { if (key() !== resKey) TH.update(); }, 4000);
  };
})(window);
