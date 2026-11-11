/* CL-WIND - essai automatique de l'application (chargé seulement avec ?autotest=<adresse du banc>).
 * Paramètres : mode3d=1, res3d=0|1|2, trav=<traversées visées>, maxs=<secondes>.
 * Envoie au banc un résumé JSON et des images du plan et de la coupe verticale. */
(function () {
  'use strict';
  var Q = new URLSearchParams(location.search), POST = Q.get('autotest');
  var out = { start: new Date().toISOString(), erreurs: [] };
  window.addEventListener('error', function (e) { out.erreurs.push(String(e.message)); });
  window.addEventListener('unhandledrejection', function (e) { out.erreurs.push(String(e.reason && e.reason.stack || e.reason)); });
  var ce = console.error, cw = console.warn;
  console.error = function () { out.erreurs.push('console.error ' + Array.prototype.join.call(arguments, ' ')); ce.apply(console, arguments); };
  console.warn = function () { out.erreurs.push('console.warn ' + Array.prototype.join.call(arguments, ' ')); cw.apply(console, arguments); };
  function send(path, body) { return fetch(POST + path, { method: 'POST', body: body }).catch(function () { /* rien */ }); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function img(name, cv) { if (!cv || !cv.width) return; var b = await new Promise(function (r) { cv.toBlob(r, 'image/png'); }); await send('/image?name=' + name, b); }
  (async function () {
    var E = CLW.engine, S = CLW.state;
    // import d'un 3DM : i3dm=<adresse du fichier>, i3cut=<hauteur de coupe>
    if (Q.get('i3dm')) {
      try {
        await wait(500);
        var R3 = await CLW.Import3dm.loadUrl(Q.get('i3dm'), Q.get('i3cut') ? { cut: +Q.get('i3cut') } : null);
        var sc3 = R3 && R3.scene;
        var aire = 0; (sc3 ? sc3.screens : []).forEach(function (r) { aire += Math.abs(CLW.geom.area(r)); });
        out.i3dm = { statut: document.getElementById('imp-status').textContent, aire_ecrans: +aire.toFixed(4),
          contours: sc3 && sc3.rings.length, ecrans: sc3 && sc3.screens.length, volumes3d: sc3 && sc3.mesh3d && sc3.mesh3d.volumes.length,
          ecrans3d: sc3 && sc3.mesh3d && sc3.mesh3d.ecrans.length, objets: S.objects.length, domaine: [S.domain.W, S.domain.H] };
      } catch (e3) { out.erreurs.push('i3dm ' + (e3 && e3.stack || e3)); }
      await send('/result', JSON.stringify(out));
    }
    for (var i = 0; i < 100 && !(CLW.Live && CLW.Live.rev); i++) await wait(200); // scène de la liaison
    out.live = CLW.Live && CLW.Live.rev;
    if (Q.get('mode3d') === '1') {
      var r3 = Q.get('res3d'); if (r3 != null) { document.getElementById('d-res3d').value = r3; S.res3d = +r3; }
      var d = document.getElementById('d-dim'); d.value = '3d'; d.dispatchEvent(new Event('change'));
    }
    if (Q.get('vue')) CLW.setView(Q.get('vue'));
    var target = +(Q.get('trav') || 6), maxs = +(Q.get('maxs') || 300), t0 = performance.now();
    while ((performance.now() - t0) / 1000 < maxs) {
      await wait(2000);
      if (E.trav >= target) break;
      out.progres = { s: Math.round((performance.now() - t0) / 1000), trav: +(E.trav || 0).toFixed(2), pas: E.steps };
      await send('/result', JSON.stringify(out));
    }
    var nraf = 0, tr = performance.now(); await new Promise(function (r) { (function f() { nraf++; if (performance.now() - tr < 2000) requestAnimationFrame(f); else r(); })(); });
    out.images_par_s = +(nraf / ((performance.now() - tr) / 1000)).toFixed(1);
    out.lot_K = E.s3 ? E.s3.K : null;
    var V = E.vox;
    out.fin = { s: Math.round((performance.now() - t0) / 1000), trav: +(E.trav || 0).toFixed(2), pas: E.steps, pas_s: E.steps / ((performance.now() - E.t0) / 1000),
      stable: E.stable, badge: document.getElementById('engine-badge').textContent, statut: document.getElementById('c-status').textContent };
    if (V) out.grille3d = { nx: V.nx, ny: V.ny, nz: V.nz, dx_cm: +(V.dx * 100).toFixed(1), Htop: +V.Htop.toFixed(1), hmax: +V.hmax.toFixed(2), couches_ecran: V.screenLayers, decoupage_ms: V.ms };
    out.domaine = document.getElementById('d-info').innerText;
    out.bilan = E.bilan && E.bilan.res ? { uMean: E.bilan.res.uMean, uMax: E.bilan.res.uMax, qin: E.bilan.res.qin, qout: E.bilan.res.qout, pen: E.bilan.res.pen, cls: E.bilan.res.cls, ouvertures: E.bilan.res.qOpen } : null;
    out.bilan_texte = document.getElementById('bilan-body').innerText;
    // coupes à plusieurs hauteurs : vitesse moyenne à l'intérieur (bilan) selon la hauteur
    if (S.mode3d && E.bilan) {
      out.profil_interieur = [];
      for (var z of [0.3, 0.8, 1.5, 2.2, 3.5]) {
        var c = document.getElementById('d-cut'); c.value = z; c.dispatchEvent(new Event('change'));
        for (var w = 0; w < 30 && E.s3seen !== E.s3.samples; w++) await wait(100);
        await wait(300);
        if (E.bilan) { CLW.Bilan.compute(E, S); var rr = E.bilan.res; out.profil_interieur.push({ z: z, uInt: rr && +rr.uMean.toFixed(2), pen: rr && +(100 * rr.pen).toFixed(0), qin: rr && +rr.qin.toFixed(2) }); }
        if (z === 1.5) { await wait(500); await img('plan_1m5', document.getElementById('plan')); }
      }
      await img('coupe_verticale', document.getElementById('vcut'));
      if (Q.get('zoom')) { S.vcutView = { z: +Q.get('zoom'), u: 0.5, v: 0.15 }; CLW.setView(S.viewMode); await wait(500); await img('coupe_zoom', document.getElementById('vcut')); }
    } else if (S.mode3d) {
      var c2 = document.getElementById('d-cut'); c2.value = 1.5; c2.dispatchEvent(new Event('change'));
      await wait(1500);
      await img('plan_1m5', document.getElementById('plan')); await img('coupe_verticale', document.getElementById('vcut'));
    } else await img('plan', document.getElementById('plan'));
    // nouveautés de l'interface : variantes, écart, coupe libre, vue 3D, planche A3
    if (Q.get('ui') === '1') {
      try {
        var cc = document.getElementById('d-cut'); cc.value = 1.5; cc.dispatchEvent(new Event('change')); await wait(1500);
        CLW.Variants.save();
        out.variante_A = CLW.Variants.list.length;
        // variante B : direction tournée de 20°, puis écart à A
        var wd = document.getElementById('w-dir'); wd.value = (S.wind.dir + 20) % 360; wd.dispatchEvent(new Event('change'));
        await wait(2500);
        var t1 = performance.now(); while (E.trav < Math.min(1, target) && (performance.now() - t1) / 1000 < maxs / 2) await wait(1500);
        await wait(500);
        CLW.Variants.save();
        out.variantes = CLW.Variants.list.map(function (v) { return v.name; });
        document.querySelector('#disp-mode [data-mode="diff"]').click();
        await wait(800);
        out.ecart_meme_grille = CLW.Variants.sameGrid();
        out.bilan_ecart = document.getElementById('bilan-body').innerText.split('\n').filter(function (l) { return /Écart|points/.test(l); });
        await img('plan_ecart', document.getElementById('plan'));
        document.querySelector('#disp-mode [data-mode="speed"]').click();
        // coupe libre : trait diagonal à travers le centre
        CLW.setSection({ a: [-S.domain.W * 0.3, -S.domain.H * 0.25], b: [S.domain.W * 0.3, S.domain.H * 0.25] });
        for (var w2 = 0; w2 < 40 && S.mode3d && E.s3seen !== E.s3.samples; w2++) await wait(100);
        await wait(800);
        await img('plan_coupe_libre', document.getElementById('plan')); await img('coupe_libre', document.getElementById('vcut'));
        // vue 3D
        CLW.setView('3d'); await wait(S.mode3d ? 9000 : 1500);
        await img('vue3d', document.getElementById('view3d'));
        CLW.setView('2d');
        // planche A3
        var a3 = CLW.Export.a3(); await img('planche_A3', a3);
        out.ui_ok = true;
      } catch (e) { out.erreurs.push('ui : ' + (e && e.stack || e)); }
    }
    // soleil et chaleur : vue Soleil, coupe solaire, courbes 24 h, carte de température
    if (Q.get('soleil') === '1') {
      try {
        function comp3d() { var a = document.getElementById('sun3d'), b = document.getElementById('sun-lab'), c = document.createElement('canvas'); c.width = a.width; c.height = a.height; var x = c.getContext('2d'); x.drawImage(a, 0, 0); x.drawImage(b, 0, 0); return c; }
        CLW.setView('soleil'); await wait(1500);
        out.soleil = {}; (function () { var M = CLW.Sun.meshes(), bb = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]; M.vol.concat(M.scr).forEach(function (m) { for (var i = 0; i < m.v.length; i += 3) for (var a = 0; a < 3; a++) { bb[a] = Math.min(bb[a], m.v[i + a]); bb[a + 3] = Math.max(bb[a + 3], m.v[i + a]); } }); out.soleil.scene = { bb: bb, objets: CLW.state.objects.length, vol: M.vol.length, scr: M.scr.length }; })();
        if (Q.get('drip') != null) { var dr = document.getElementById('th-drip'); dr.checked = Q.get('drip') === '1'; dr.dispatchEvent(new Event('change')); }
        Q.forEach(function (v, key) { if (key.indexOf('th_') === 0) { var kk = key.slice(3), nv = parseFloat(v); CLW.Thermal.opts[kk] = isNaN(nv) ? v : nv; } });
        if (Q.get('mist') != null) { var mi = document.getElementById('th-mist'); mi.checked = Q.get('mist') === '1'; mi.dispatchEvent(new Event('change')); }
        var days = CLW.Sun.keyDays();
        out.soleil.jours = days.map(function (k) { return k.label + ' ' + k.d + '/' + k.m + (k.epw ? ' Tmin ' + k.tmin.toFixed(1) + ' Tmax ' + k.tmax.toFixed(1) : ''); });
        var sel = (Q.get('jours') || 'sol-ete,sol-hiv,chaud,froid').split(',');
        for (var di = 0; di < sel.length; di++) {
          var kd = days.filter(function (k) { return k.id === sel[di]; })[0]; if (!kd) continue;
          CLW.Sun.set({ m: kd.m, d: kd.d, t: kd.t }); await wait(1800);
          var p = CLW.Sun.current();
          out.soleil[kd.id] = { date: kd.d + '/' + kd.m, t: kd.t, alt: +p.alt.toFixed(1), az: +p.az.toFixed(0), info: document.getElementById('sun-info').innerText.split(String.fromCharCode(10)).join(' | '),
            synthese: CLW.Thermal.summary(), sol_soleil: CLW.Sun.cutHits };
          await img('soleil3d_' + kd.id, comp3d()); await img('coupe_soleil_' + kd.id, document.getElementById('suncut'));
          await img('courbes_' + kd.id, document.getElementById('th-curves'));
        }
        out.soleil.texte = document.getElementById('th-sum').innerText;
        CLW.setView('plan'); document.querySelector('#disp-mode [data-mode="temp"]').click(); await wait(4000);
        await img('plan_temperature', document.getElementById('plan'));
        await img('legende_temperature', document.getElementById('legend'));
        var tf0 = performance.now(); document.querySelector('#disp-mode [data-mode="feel"]').click(); await wait(3000);
        out.soleil.ressenti = { stats: CLW.Thermal.feel.stats, libre: CLW.Thermal.feel.Tfree, ms: Math.round(performance.now() - tf0) };
        await img('plan_ressenti', document.getElementById('plan'));
        await img('legende_ressenti', document.getElementById('legend'));
        var ts = performance.now(); CLW.Thermal.season(); while (CLW.Thermal.seasonState.running) await wait(500);
        var SR = CLW.Thermal.seasonState.res;
        out.soleil.ete = { ms: Math.round(performance.now() - ts), tot: SR && SR.tot, besoin: SR && SR.need, cap: SR && SR.cap, collecte: SR && SR.catchA };
        CLW.Thermal.render(); await img('ete', document.getElementById('th-season'));
        out.soleil.ete_texte = document.getElementById('th-season-sum').innerText;
        await img('planche_A3_soleil', CLW.Export.a3sun());
      } catch (e) { out.erreurs.push('soleil : ' + (e && e.stack || e)); }
    }
    // variantes de sol et de toit : matvar=sol:toit,sol:toit…  (jour le plus chaud, hiver type, UTCI été et hiver)
    if (Q.get('matvar')) {
      var TH = CLW.Thermal, days = CLW.Sun.specialDays ? CLW.Sun.specialDays() : null;
      out.matvar = [];
      Q.forEach(function (v, key) { if (key.indexOf('th_') === 0) { var nv = parseFloat(v); TH.opts[key.slice(3)] = isNaN(nv) ? v : nv; } });
      if (Q.get('drip') != null) TH.opts.drip = Q.get('drip') === '1';
      for (var mv of Q.get('matvar').split(',')) {
        var fr = mv.split(':'); TH.opts.floor = fr[0]; TH.opts.roof = fr[1];
        var row = { sol: fr[0], toit: fr[1] };
        for (var dd of [{ id: 'chaud', m: 7, d: 20, t: 15 }, { id: 'hiver', m: 12, d: 13, t: 13 }]) {
          CLW.Sun.set({ m: dd.m, d: dd.d, t: dd.t }); await wait(400); TH.update(true); await wait(200);
          var sm = TH.summary(); row[dd.id] = { evap: Math.round(sm.evap || 0), drip: TH.opts.drip, mode: TH.opts.dripMode, TopMax: +sm.TopMax.toFixed(1), TopMin: +sm.TopMin.toFixed(1), TfMax: +sm.TfMax.toFixed(1), TbiMax: +sm.TbiMax.toFixed(1), TiMax: +sm.TiMax.toFixed(1) };
        }
        TH.utciSeasons(); await wait(200); while (TH.utciState.running) await wait(300);
        var R = TH.utciState.res;
        R.periods.forEach(function (pp) { row['utci_' + pp.id] = { chaleur_in: Math.round(pp.inn.slice(6).reduce(function (a, b) { return a + b; }, 0)), forte_in: Math.round(pp.inn.slice(7).reduce(function (a, b) { return a + b; }, 0)), froid_in: Math.round(pp.inn.slice(0, 4).reduce(function (a, b) { return a + b; }, 0)), moyen_in: +pp.meanIn.toFixed(1), chaleur_out: Math.round(pp.out.slice(6).reduce(function (a, b) { return a + b; }, 0)), froid_out: Math.round(pp.out.slice(0, 4).reduce(function (a, b) { return a + b; }, 0)) }; });
        out.matvar.push(row); await send('/result', JSON.stringify(out));
      }
    }
    // vent réel et UTCI : sweep=<nb de directions>, utci=1
    if (Q.get('sweepclear') === '1') CLW.Thermal.clearWindTables();
    if (Q.get('sweep')) {
      var tsw = performance.now();
      var dbgT = setInterval(function () { out.dbg = { t: Math.round((performance.now() - tsw) / 1000), dir: S.wind.dir, trav: +(E.trav || 0).toFixed(2), stable: E.stable, paused: E.paused, steps: E.steps, bilan: !!(E.bilan && E.bilan.res), msg: CLW.Thermal.sweep.msg, mode3d: S.mode3d }; send('/result', JSON.stringify(out)); }, 5000);
      await CLW.Thermal.sweepWinds(+Q.get('sweep'), null, Q.get('sweepwhich') || 'all'); clearInterval(dbgT);
      out.vents = { s: Math.round((performance.now() - tsw) / 1000), rows: CLW.Thermal.windTable && CLW.Thermal.windTable.rows };
      await send('/result', JSON.stringify(out));
    }
    if (Q.get('utci') === '1') {
      out.utci_test = CLW.UTCI.selfTest();
      var tu = performance.now(); CLW.Thermal.utciSeasons(); await wait(200); while (CLW.Thermal.utciState.running) await wait(500);
      out.utci = CLW.Thermal.utciState.res; out.utci_s = Math.round((performance.now() - tu) / 1000);
      CLW.Thermal.drawUtci(document.getElementById('th-utci')); document.getElementById('th-utci-sum').innerHTML = CLW.Thermal.utciHtml();
      out.utci_texte = document.getElementById('th-utci-sum').innerText;
      await img('utci', document.getElementById('th-utci'));
      await send('/result', JSON.stringify(out));
    }
    // zoom 3D sur un pan de mur (briques résolues) : zoom=1, zaz=<azimut>, zmax=<secondes>
    if (Q.get('zoom') === '1') {
      try {
        var Zs = CLW.Zoom.state; CLW.setView('zoom'); if (Q.get('zL')) { Zs.L = +Q.get('zL'); Zs.D = +(Q.get('zD') || Q.get('zL')); }
        if (Q.get('zaz')) { Zs.az = +Q.get('zaz'); } else Zs.az = CLW.state.wind.dir;
        var tz = performance.now(); CLW.Zoom.start();
        while (!(Zs.s3 && Zs.G) && performance.now() - tz < 60000) await wait(300);
        out.zoom = { decoupage_ms: Zs.G && Zs.G.ms, grille: Zs.G && [Zs.G.nx, Zs.G.ny, Zs.G.nz], dx_cm: Zs.G && +(Zs.G.dx * 100).toFixed(2), plein: Zs.G && +Zs.G.solidFrac.toFixed(3), briques: Zs.G && Zs.G.nScr };
        var zmax = +(Q.get('zmax') || 120);
        while (performance.now() - tz < zmax * 1000 && !(Zs.s3.trav >= 6)) { await wait(2000); out.zoom.trav = +Zs.s3.trav.toFixed(2); await send('/result', JSON.stringify(out)); }
        await wait(1500); CLW.Zoom.draw();
        out.zoom.trav = +Zs.s3.trav.toFixed(2); out.zoom.pas_s = Math.round(Zs.s3.steps / ((performance.now() - tz) / 1000)); out.zoom.stats = Zs.stats;
        out.zoom.texte = document.getElementById('zoom-info').innerText;
        await img('zoom_plan', document.getElementById('zoom-plan')); await img('zoom_coupe', document.getElementById('zoom-cut'));
        if (Q.get('z3') === '1') { // vue 3D : lignes de courant
          CLW.Zoom.setMode('3d'); if (Q.get('zseed')) { var zsd = document.getElementById('zoom-seed'); zsd.value = Q.get('zseed'); zsd.dispatchEvent(new Event('change')); }
          var tl = performance.now(); while (!CLW.Zoom3D.lines && performance.now() - tl < 40000) await wait(500);
          await wait(1500); out.zoom.lignes = CLW.Zoom3D.info; out.zoom.lignes_n = CLW.Zoom3D.lines; out.zoom.lignes_mur = CLW.Zoom3D.joint;
          await img('zoom_3d', document.getElementById('zoom-3d'));
        }
      } catch (e) { out.erreurs.push('zoom : ' + (e && e.stack || e)); }
    }
    // température : plan et coupe verticale en « Temp. » (air rafraîchi par les briques, matériaux), tdate=m-j-h
    if (Q.get('temp') === '1') {
      try {
        var td = (Q.get('tdate') || '7-18-15').split('-').map(Number);
        CLW.Sun.set({ m: td[0], d: td[1], t: td[2] }); await wait(1500);
        if (Q.get('drip') != null) { var drT = document.getElementById('th-drip'); drT.checked = Q.get('drip') === '1'; drT.dispatchEvent(new Event('change')); }
        document.querySelector('#disp-mode [data-mode="temp"]').click();
        CLW.Thermal.update(true); await wait(3000);
        if (CLW.setView) CLW.setView('both'); await wait(1500);
        var aT = CLW.Thermal.at(td[2]), tfT = CLW.Thermal.tempField;
        CLW.Thermal.prepareField();
        var mnT = 99, mxT = -99, sI = 0, nI = 0;
        if (tfT.c) for (var qT = 0; qT < tfT.c.length; qT++) { if (tfT.sol[qT]) continue; var TT = CLW.Thermal.airAt(qT, aT); if (TT == null) continue; mnT = Math.min(mnT, TT); mxT = Math.max(mxT, TT); if (tfT.inn[qT]) { sI += TT; nI++; } }
        out.temp = { Ta: aT && +aT.Ta.toFixed(2), Ti: aT && +aT.Ti.toFixed(2), Tsup: aT && +aT.Tsup.toFixed(2), sortie_faces: aT && aT.TexK && Array.from(aT.TexK).map(function (v) { return +(v - aT.Ta).toFixed(2); }),
          station: CLW.Live && CLW.Live.last && CLW.Live.last.station, goutte_a_goutte: { actif: CLW.Thermal.opts.drip, mode: CLW.Thermal.opts.dripMode, Ton: CLW.Thermal.opts.dripTon, HR: CLW.Thermal.opts.dripRH },
          collecte_m2: CLW.Thermal.catchAuto(CLW.Thermal.geometry()), champs_par_face: !!tfT.phi, plan_air_min: +mnT.toFixed(2), plan_air_max: +mxT.toFixed(2), plan_air_dedans: nI ? +(sI / nI).toFixed(2) : null };
        await wait(1500); if (CLW.drawVcut) CLW.drawVcut();
        var ST = E.vcutTemp;
        if (ST) {
          var cnt = [0, 0, 0, 0, 0, 0], tmn = 99, tmx = -99, sB = 0, nB = 0; for (var qs = 0; qs < ST.kind.length; qs++) { cnt[ST.kind[qs]]++; if (ST.kind[qs] <= 1 && isFinite(ST.T[qs])) { tmn = Math.min(tmn, ST.T[qs]); tmx = Math.max(tmx, ST.T[qs]); } if (ST.kind[qs] === 1) { sB += ST.T[qs]; nB++; } }
          out.temp.coupe = { w: ST.w, h: ST.h, pixels_par_type: cnt, air_min: +tmn.toFixed(2), air_max: +tmx.toFixed(2), air_dans_briques: nB ? +(sB / nB).toFixed(2) : null };
        } else out.temp.coupe = 'pas de coupe (calcul 3D ?)';
        await img('temp_plan', document.getElementById('plan')); await img('temp_coupe', document.getElementById('vcut'));
      } catch (e) { out.erreurs.push('temp : ' + (e && e.stack || e)); }
    }
    // vues 3D : réglages du bandeau (v3=JSON) et images de la vue 3D (shot3d=1) pour plusieurs jeux de réglages
    if (Q.get('shot3d') === '1') {
      try {
        CLW.setView('3d'); await wait(2500);
        var jeux = [['pleine_sans_coupe', { h: false, v: false, l: false, m: 'plein' }], ['pleine_coupe_verticale', { h: false, v: true, l: false, m: 'plein' }],
          ['transp_coupes', { h: true, v: true, l: true, m: 'transp' }], ['masquee_coupes', { h: true, v: true, l: false, m: 'aucune' }]];
        for (var ji = 0; ji < jeux.length; ji++) { CLW.setV3(jeux[ji][1]); CLW.View3D.dirty(); await wait(3500); await img('v3d_' + jeux[ji][0], document.getElementById('view3d')); }
        var F = CLW.View3D.focus(); out.focus3d = F && { cx: +F.cx.toFixed(2), cy: +F.cy.toFixed(2), r: +F.r.toFixed(2), R: +F.R.toFixed(2), zTop: +F.zTop.toFixed(2) };
        var Lg = CLW.Live && CLW.Live.last; out.scene3d = { origine: CLW.Live && CLW.Live.origin, trait: CLW.engine.vcutGeom, domaine: [CLW.state.domain.W, CLW.state.domain.H] };
      } catch (e) { out.erreurs.push('shot3d : ' + (e && e.stack || e)); }
    }
    // coupe solaire : suit le soleil ou fixe
    if (Q.get('coupesoleil') === '1') {
      try {
        CLW.setView('soleil'); await wait(1500);
        function ang(l) { return Math.round(((Math.atan2(l.a[0] - l.b[0], l.a[1] - l.b[1]) * 180 / Math.PI) % 360 + 360) % 360); }
        var SU = CLW.Sun, res = { suit: [], fixe: [] };
        document.querySelector('#sunb-cut [data-c="sun"]').click(); await wait(300);
        [9, 12, 15].forEach(function (h) { SU.set({ m: 6, d: 21, t: h }); res.suit.push({ h: h, az_coupe: ang(SU.cutLine()), kind: SU.cutLine().kind }); });
        SU.set({ m: 6, d: 21, t: 9 }); document.querySelector('#sunb-cut [data-c="fixe"]').click(); await wait(300);
        var fz = SU.state.cutAz;
        [9, 12, 15].forEach(function (h) { SU.set({ t: h }); res.fixe.push({ h: h, az_coupe: ang(SU.cutLine()), kind: SU.cutLine().kind }); });
        var az = document.getElementById('sunb-az'); az.value = 90; az.dispatchEvent(new Event('change')); await wait(300);
        res.fixe_gele_a = fz; res.apres_saisie_90 = { az_coupe: ang(SU.cutLine()), kind: SU.cutLine().kind, etat: SU.state.cut };
        res.boutons = Array.from(document.querySelectorAll('#sunb-cut button')).map(function (b) { return b.dataset.c + ':' + b.classList.contains('on'); });
        res.champ_azimut_visible = !document.getElementById('sunb-az-l').hidden;
        await wait(800); await img('coupe_soleil_fixe', document.getElementById('suncut')); await img('barre_soleil', document.getElementById('sun-wrap'));
        out.coupesoleil = res;
      } catch (e) { out.erreurs.push('coupesoleil : ' + (e && e.stack || e)); }
    }
    // barre de vues : rappel de chaque vue de départ, état de la page
    if (Q.get('vues') === '1') {
      try {
        out.vues = { n: CLW.Vues.list.length, noms: CLW.Vues.list.map(function (v) { return v.name; }), essais: [] };
        for (var vi = 0; vi < CLW.Vues.list.length; vi++) {
          CLW.Vues.apply(vi); await wait(2500);
          var vw = document.getElementById('vcut-wrap'), pr = document.getElementById('plan').getBoundingClientRect(), vr = vw.getBoundingClientRect();
          out.vues.essais.push({ vue: CLW.Vues.list[vi].name, mode: S.viewMode, plan: S.display, coupe: CLW.vdisp(), coupe_visible: !vw.hidden, coupe_cote: vw.classList.contains('side'),
            coupe_px: [Math.round(vr.width), Math.round(vr.height)], bandeau_plan: !document.getElementById('plan-head').hidden, vue_active: document.querySelectorAll('.vb-chip.on').length });
          if (CLW.Vues.list[vi].view === '3d') { await wait(6000); CLW.View3D.dirty(); await wait(800); out.vues.essais[out.vues.essais.length - 1].bandeau_3d = !document.getElementById('v3d-head').hidden; out.vues.essais[out.vues.essais.length - 1].v3 = Object.assign({}, S.v3); await img('vue' + (vi + 1) + '_3d', document.getElementById('view3d')); }
          if (CLW.Vues.list[vi].view === 'cote' || CLW.Vues.list[vi].view === 'both') { await img('vue' + (vi + 1) + '_plan', document.getElementById('plan')); await img('vue' + (vi + 1) + '_coupe', document.getElementById('vcut')); }
        }
        CLW.Vues.list.push(CLW.Vues.capture('essai')); out.vues.ajout = CLW.Vues.list.length;
        CLW.Vues.list.pop();
      } catch (e) { out.erreurs.push('vues : ' + (e && e.stack || e)); }
    }
    await send('/result', JSON.stringify(out));
    await send('/done', 'ok');
  })();
})();
