/* CL-WIND - bilan.js
 * Bilan intérieur / extérieur d'un ouvrage ajouré (briques, lames, claustras : objets « écran »).
 * - Zone intérieure : enveloppe convexe des éléments d'écran, moins l'épaisseur du mur.
 * - Ligne de contrôle : l'enveloppe décalée vers l'intérieur de l'épaisseur du mur. Le flux de la
 *   vitesse moyenne à travers elle donne l'air qui entre (et qui sort), par secteur de 30°, en
 *   distinguant ce qui passe par les briques de ce qui passe par les ouvertures.
 * Calcul 2D en plan : débits par mètre de hauteur (m³/s par m), à la hauteur de coupe.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  var B = CLW.Bilan = {};
  var SECT = 12, DIRS = ['N', 'NNE', 'ENE', 'E', 'ESE', 'SSE', 'S', 'SSO', 'OSO', 'O', 'ONO', 'NNO'];
  function $(id) { return document.getElementById(id); }

  function hull(pts) { // enveloppe convexe (chaîne monotone), sens trigonométrique
    pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lo = [], up = [], i;
    for (i = 0; i < pts.length; i++) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], pts[i]) <= 0) lo.pop(); lo.push(pts[i]); }
    for (i = pts.length - 1; i >= 0; i--) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], pts[i]) <= 0) up.pop(); up.push(pts[i]); }
    up.pop(); lo.pop();
    return lo.concat(up);
  }
  function distToRing(x, y, ring) {
    var m = Infinity;
    for (var a = 0, n = ring.length; a < n; a++) {
      var p = ring[a], q = ring[(a + 1) % n], d = CLW.geom.distSeg(x, y, p[0], p[1], q[0], q[1]);
      if (d < m) m = d;
    }
    return m;
  }

  // prépare la zone intérieure et la ligne de contrôle pour la grille g ; null s'il n'y a pas d'écran
  B.prepare = function (objects, g, rast) {
    var els = objects.filter(function (o) { return o.type === 'building' && o.screen; });
    if (els.length < 3) return null;
    var pts = [];
    els.forEach(function (o) { o.outer.forEach(function (p) { pts.push(p); }); });
    // petits éléments pleins de la même maquette (poteaux) autour des écrans : ils bordent aussi l'intérieur
    var ex = 0, ey = 0; pts.forEach(function (p) { ex += p[0]; ey += p[1]; }); ex /= pts.length; ey /= pts.length;
    var er = 0; pts.forEach(function (p) { er = Math.max(er, Math.hypot(p[0] - ex, p[1] - ey)); });
    objects.forEach(function (o) {
      if (o.type !== 'building' || o.screen || o.src !== 'live' || !o.outer || o.outer.length < 3) return;
      var s = 0, mx = 0, my = 0;
      for (var i = 0, n = o.outer.length; i < n; i++) { var p = o.outer[i], q = o.outer[(i + 1) % n]; s += p[0] * q[1] - q[0] * p[1]; mx += p[0]; my += p[1]; }
      mx /= o.outer.length; my /= o.outer.length;
      if (Math.abs(s) / 2 < 1.0 && Math.hypot(mx - ex, my - ey) < 1.3 * er) o.outer.forEach(function (p) { pts.push(p); });
    });
    var H = hull(pts);
    if (H.length < 3) return null;
    // centre (centre de gravité du polygone) et aire
    var A = 0, cx = 0, cy = 0;
    for (var a = 0, n = H.length; a < n; a++) {
      var p = H[a], q = H[(a + 1) % n], c = p[0] * q[1] - q[0] * p[1];
      A += c; cx += (p[0] + q[0]) * c; cy += (p[1] + q[1]) * c;
    }
    A /= 2; cx /= 6 * A; cy /= 6 * A; A = Math.abs(A);
    // épaisseur du mur : 1,2 × la longueur médiane des éléments (brique vue en plan), bornée
    var lens = els.map(function (o) {
      var bb = CLW.geom.bbox(o.outer), P = 0, r = o.outer;
      for (var k = 0; k < r.length; k++) { var s = r[(k + 1) % r.length]; P += Math.hypot(s[0] - r[k][0], s[1] - r[k][1]); }
      var t = P > 0 ? 2 * Math.abs(CLW.geom.area(r)) / P : 0;
      return Math.max(t, P / 2 - t);
    }).sort(function (u, v) { return u - v; });
    var dWall = Math.min(1.0, Math.max(0.1, 1.2 * lens[lens.length >> 1]));
    // éléments proches d'un point (ouvertures : rien à moins de 0,25 m sur l'enveloppe)
    var cents = els.map(function (o) { var bb = CLW.geom.bbox(o.outer); return [(bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, Math.hypot(bb[2] - bb[0], bb[3] - bb[1]) / 2]; });
    function nearElement(x, y, lim) {
      for (var e = 0; e < els.length; e++) {
        var c2 = cents[e];
        if (Math.hypot(x - c2[0], y - c2[1]) - c2[2] > lim) continue;
        if (distToRing(x, y, els[e].outer) <= lim || CLW.geom.pointInRings(x, y, [els[e].outer])) return true;
      }
      return false;
    }
    // ligne de contrôle : points de l'enveloppe tous les ds, décalés vers l'intérieur de dWall
    var per = 0;
    for (a = 0; a < H.length; a++) { var q1 = H[(a + 1) % H.length]; per += Math.hypot(q1[0] - H[a][0], q1[1] - H[a][1]); }
    var ds = Math.max(g.dx, per / 1500), samples = [];
    // enveloppe convexe dans le sens trigonométrique : distance au bord = plus petite distance signée
    // aux droites des côtés (positive à l'intérieur)
    var ed = H.map(function (p, k) { var q2 = H[(k + 1) % H.length], L2 = Math.hypot(q2[0] - p[0], q2[1] - p[1]) || 1; return [p[0], p[1], (q2[0] - p[0]) / L2, (q2[1] - p[1]) / L2]; });
    function inset(x, y) { var m = Infinity; for (var e = 0; e < ed.length; e++) { var E2 = ed[e], d = E2[2] * (y - E2[1]) - E2[3] * (x - E2[0]); if (d < m) m = d; } return m; }
    for (a = 0; a < H.length; a++) {
      var P0 = H[a], P1 = H[(a + 1) % H.length], ex = P1[0] - P0[0], ey = P1[1] - P0[1], L = Math.hypot(ex, ey);
      if (L < 1e-9) continue;
      var nx = -ey / L, ny = ex / L; // normale intérieure (enveloppe dans le sens trigonométrique)
      for (var t = ds / 2; t < L; t += ds) {
        var hx = P0[0] + ex * t / L, hy = P0[1] + ey * t / L, x = hx + nx * dWall, y = hy + ny * dWall;
        // près d'un angle, le point décalé déborde au-delà du côté voisin : il n'est pas sur la vraie
        // courbe décalée et créerait un zigzag qui gonfle le débit entrant
        if (inset(x, y) < dWall - 1e-6 * (1 + dWall)) continue;
        var ang = (Math.atan2(x - cx, y - cy) * 180 / Math.PI + 360) % 360;
        samples.push({ x: x, y: y, nx: nx, ny: ny, ds: Math.min(ds, L - t + ds / 2), sec: Math.floor(((ang + 15) % 360) / 30), open: !nearElement(hx, hy, 0.25) });
      }
    }
    // cellules intérieures : dans l'enveloppe, à plus de dWall de son bord, fluides
    var bb2 = CLW.geom.bbox(H), cells = [];
    var i0 = Math.max(0, Math.floor((bb2[0] - g.x0) / g.dx)), i1 = Math.min(g.nx - 1, Math.ceil((bb2[2] - g.x0) / g.dx));
    var j0 = Math.max(0, Math.floor((g.y0 - bb2[3]) / g.dx)), j1 = Math.min(g.ny - 1, Math.ceil((g.y0 - bb2[1]) / g.dx));
    for (var j = j0; j <= j1; j++) for (var i = i0; i <= i1; i++) {
      var X = CLW.cellX(g, i), Y = CLW.cellY(g, j), kk = j * g.nx + i;
      if (rast.solid[kk]) continue;
      var dmin = Infinity;
      for (var e2 = 0; e2 < ed.length && dmin > dWall; e2++) { var E2 = ed[e2], dd = E2[2] * (Y - E2[1]) - E2[3] * (X - E2[0]); if (dd < dmin) dmin = dd; }
      if (dmin > dWall) cells.push(kk);
    }
    var inner = samples.map(function (s) { return [s.x, s.y]; });
    return { hull: H, cx: cx, cy: cy, area: A, dWall: dWall, samples: samples, inner: inner,
      cells: new Int32Array(cells), innerArea: cells.length * g.dx * g.dx, res: null };
  };

  // vitesse moyenne (unités réseau, repère du plan) interpolée
  function meanAt(E, x, y) {
    var g = E.grid, fi = (x - g.x0) / g.dx - 0.5, fj = (g.y0 - y) / g.dx - 0.5;
    var i = Math.floor(fi), j = Math.floor(fj);
    if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.ny - 1) return [0, 0];
    var u = fi - i, v = fj - j, m = E.mean, k = j * g.nx + i, ks = [k, k + 1, k + g.nx, k + g.nx + 1], w = [(1 - u) * (1 - v), u * (1 - v), (1 - u) * v, u * v];
    var vx = 0, vy = 0, ws = 0;
    for (var q = 0; q < 4; q++) { if (E.rast.solid[ks[q]]) continue; vx += w[q] * m[3 * ks[q]]; vy -= w[q] * m[3 * ks[q] + 1]; ws += w[q]; }
    return ws > 0 ? [vx / ws, vy / ws] : [0, 0];
  }

  B.compute = function (E, S) {
    var bl = E.bilan; if (!bl || !E.samples) return null;
    var U = S.wind.speed, sc = U / CLW.LBM.U_LAT, m = E.mean;
    // intérieur
    var sum = 0, mx = 0, cls = [0, 0, 0, 0, 0], C = CLW.COMFORT;
    for (var q = 0; q < bl.cells.length; q++) {
      var s = m[3 * bl.cells[q] + 2] * sc; sum += s; if (s > mx) mx = s;
      for (var c = 0; c < C.length; c++) if (s <= C[c].max) { cls[c]++; break; }
    }
    var n = bl.cells.length || 1;
    // flux à travers la ligne de contrôle : polyligne fermée des points décalés (sens trigonométrique),
    // segment par segment, vitesse au milieu ; flux entrant = v · normale intérieure × longueur
    // = −vx·dy + vy·dx. Exact pour toute polyligne fermée (les recouvrements aux angles se compensent).
    var sin = new Float64Array(SECT), sout = new Float64Array(SECT), qin = 0, qout = 0, qOpen = 0, P = bl.samples, nP = P.length;
    for (var a = 0; a < nP; a++) {
      var p = P[a], p2 = P[(a + 1) % nP], dxs = p2.x - p.x, dys = p2.y - p.y;
      var v = meanAt(E, (p.x + p2.x) / 2, (p.y + p2.y) / 2), vn = (-v[0] * dys + v[1] * dxs) * sc;
      if (vn > 0) { sin[p.sec] += vn; qin += vn; if (p.open) qOpen += vn; } else { sout[p.sec] -= vn; qout -= vn; }
    }
    // largeur de la ligne de contrôle face au vent : sans mur, tout l'air qui la traverse entre (100 %)
    var th = S.wind.dir * Math.PI / 180, px = Math.cos(th), py = -Math.sin(th), lo = Infinity, hi = -Infinity;
    bl.inner.forEach(function (p) { var d = p[0] * px + p[1] * py; if (d < lo) lo = d; if (d > hi) hi = d; });
    var Wp = hi - lo;
    bl.res = { U: U, uMean: sum / n, uMax: mx, cls: cls.map(function (x) { return x / n; }), qin: qin, qout: qout, qOpen: qOpen,
      sin: sin, sout: sout, Wp: Wp, pen: Wp > 0 ? qin / (U * Wp) : 0, ach: bl.innerArea > 0 ? 3600 * qin / bl.innerArea : 0,
      stable: E.stable, trav: E.trav };
    return bl.res;
  };

  // ------------------------------------------------------------------ affichage
  B.render = function (E, S) {
    var box = $('bilan-body'); if (!box) return;
    var bl = E && E.bilan;
    if (!bl) { box.innerHTML = '<div class="hint">Pas d\'écran (briques, lames) dans la scène : branchez-les sur l\'entrée « ecrans » de Grasshopper.</div>'; drawRose(null); return; }
    var r = bl.res;
    if (!r) { box.innerHTML = '<div class="hint">Zone intérieure : ' + CLW.fmt(bl.innerArea, 1) + ' m². Calcul en cours…</div>'; drawRose(null); return; }
    var f = CLW.fmt, h = '';
    // calcul 3D : coupe plus haute que l'ouvrage ou sans écran à cette hauteur
    if (S && S.mode3d && E.vox && E.kslice != null) {
      var zc = (E.kslice - 0.5) * E.vox.dx;
      if (zc > E.vox.hmax) h += '<div class="warn">Coupe à ' + f(zc, 2) + ' m, au-dessus de l\'ouvrage (' + f(E.vox.hmax, 2) + ' m) : ce bilan ne décrit pas l\'intérieur.</div>';
      else if (!E.rast.screens) h += '<div class="warn">Pas de brique ni de lame à ' + f(zc, 2) + ' m : la ligne de contrôle traverse un vide (sous ou entre les modules).</div>';
      h += '<div class="bil-row sub"><span>Calcul 3D, coupe horizontale à ' + f(zc, 2) + ' m</span></div>';
    }
    h += '<div class="bil-row"><span>Vitesse moyenne intérieure</span><b>' + f(r.uMean, 2) + ' m/s</b></div>';
    h += '<div class="bil-row sub"><span>soit ' + f(100 * r.uMean / r.U, 0) + ' % du vent libre ; maximum ' + f(r.uMax, 2) + ' m/s</span></div>';
    h += '<div class="bil-bar">' + CLW.COMFORT.map(function (c, k) {
      var p = r.cls[k]; if (p < 0.005) return '';
      return '<span title="' + c.label + ' ' + c.sub + ' : ' + f(100 * p, 0) + ' %" style="width:' + (100 * p) + '%;background:rgb(' + c.col.join(',') + ')"></span>';
    }).join('') + '</div>';
    h += '<div class="bil-row sub"><span>' + CLW.COMFORT.map(function (c, k) { return r.cls[k] >= 0.005 ? c.label + ' ' + f(100 * r.cls[k], 0) + ' %' : ''; }).filter(Boolean).join(' · ') + ' de la surface intérieure (' + f(bl.innerArea, 1) + ' m²)</span></div>';
    h += '<div class="bil-row"><span>Air entrant</span><b>' + f(r.qin, 2) + ' m³/s par m de hauteur</b></div>';
    var qb = r.qin - r.qOpen;
    h += '<div class="bil-row sub"><span>par les briques ' + f(r.qin > 0 ? 100 * qb / r.qin : 0, 0) + ' %, par les ouvertures ' + f(r.qin > 0 ? 100 * r.qOpen / r.qin : 0, 0) + ' %</span></div>';
    h += '<div class="bil-row"><span>Taux de pénétration</span><b>' + f(100 * r.pen, 0) + ' %</b></div>';
    h += '<div class="bil-row sub"><span>air entrant rapporté à celui qui traverserait l\'intérieur (largeur ' + f(r.Wp, 1) + ' m face au vent) sans mur : 100 % = mur transparent</span></div>';
    h += '<div class="bil-row"><span>Renouvellement d\'air (indicatif)</span><b>' + f(r.ach, 0) + ' vol/h</b></div>';
    if (CLW.Variants) h += CLW.Variants.deltaHtml(r);
    h += '<div class="hint">' + (r.stable ? 'Moyenne stabilisée.' : 'Moyenne en cours (' + f(r.trav, 1) + ' / 6 traversées) : chiffres provisoires.') +
      (S && S.mode3d ? ' Débits par mètre de hauteur, mesurés dans la coupe affichée : déplacez la coupe pour comparer les hauteurs.' : ' Calcul en plan à la hauteur de coupe : débits par mètre de hauteur.') + ' Comparez des variantes plutôt que de lire des valeurs.</div>';
    box.innerHTML = h;
    drawRose(r);
  };
  // rose des entrées d'air par secteur (vers le centre = entrant)
  function drawRose(r) {
    var cv = $('bilan-rose'); if (!cv) return;
    var ctx = cv.getContext('2d'), W = cv.width, Hh = cv.height, cx = W / 2, cy = Hh / 2, R = Math.min(W, Hh) / 2 - 22;
    ctx.clearRect(0, 0, W, Hh);
    cv.style.display = r ? '' : 'none';
    if (!r) return;
    var mxs = 0; for (var s = 0; s < SECT; s++) mxs = Math.max(mxs, r.sin[s], r.sout[s]);
    ctx.strokeStyle = '#3a4250'; ctx.lineWidth = 1;
    [0.33, 0.66, 1].forEach(function (f) { ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, 2 * Math.PI); ctx.stroke(); });
    for (s = 0; s < SECT; s++) {
      var a0 = (s * 30 - 15 - 90) * Math.PI / 180, a1 = a0 + 30 * Math.PI / 180;
      var vi = mxs > 0 ? r.sin[s] / mxs : 0, vo = mxs > 0 ? r.sout[s] / mxs : 0;
      if (vi > 0) { ctx.fillStyle = 'rgba(80,190,120,0.85)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R * vi, a0 + 0.05, a1 - 0.05); ctx.closePath(); ctx.fill(); }
      if (vo > 0) { ctx.strokeStyle = 'rgba(235,140,60,0.95)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, R * vo, a0 + 0.08, a1 - 0.08); ctx.stroke(); }
    }
    ctx.fillStyle = '#c9ced6'; ctx.font = '11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ['N', 'E', 'S', 'O'].forEach(function (t, k) { var an = (k * 90 - 90) * Math.PI / 180; ctx.fillText(t, cx + Math.cos(an) * (R + 12), cy + Math.sin(an) * (R + 12)); });
  }
  B.DIRS = DIRS;

  // tracé sur le plan (contexte en coordonnées du plan) : ligne de contrôle et flèches d'entrée
  B.drawOverlay = function (ctx, E, px) {
    var bl = E && E.bilan; if (!bl || !$('bilan-show') || !$('bilan-show').checked) return;
    ctx.save();
    ctx.setLineDash([6 * px, 4 * px]); ctx.lineWidth = 1.2 * px; ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.beginPath();
    bl.inner.forEach(function (p, k) { if (k) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); });
    ctx.closePath(); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  };
})(window);
