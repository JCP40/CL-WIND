/* CL-WIND - solver_cpu.js
 * Lattice-Boltzmann D2Q9, BGK + Smagorinsky, forçage Exact-Difference.
 * Le coeur CLW_LBM_CORE est autonome (aucune référence extérieure) pour pouvoir
 * tourner dans un Worker créé depuis un Blob, y compris en file://.
 * Le shader WGSL de solver_gpu.js applique exactement le même algorithme.
 */
function CLW_LBM_CORE() {
  'use strict';
  var EX = [0, 1, 0, -1, 0, 1, -1, -1, 1], EY = [0, 0, 1, 0, -1, 1, 1, -1, -1];
  var WT = [4 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 36, 1 / 36, 1 / 36, 1 / 36];
  var OPP = [0, 3, 4, 1, 2, 7, 8, 5, 6];
  var P = null, F = null, G = null, vel = null, N = 0, steps = 0, eqW = new Float64Array(9);

  function init(p) {
    P = p; N = p.nx * p.ny; steps = 0;
    var f = F = new Float32Array(9 * N); G = new Float32Array(9 * N); vel = new Float32Array(2 * N);
    var uu = p.wux * p.wux + p.wuy * p.wuy;
    for (var k = 0; k < 9; k++) {
      var eu = EX[k] * p.wux + EY[k] * p.wuy;
      eqW[k] = WT[k] * (1 + 3 * eu + 4.5 * eu * eu - 1.5 * uu);
    }
    for (var i = 0; i < N; i++) {
      for (var q = 0; q < 9; q++) f[q * N + i] = eqW[q];
      if (p.cell[i] < 0) { vel[2 * i] = 0; vel[2 * i + 1] = 0; }
      else { vel[2 * i] = p.wux; vel[2 * i + 1] = p.wuy; }
    }
    G.set(f);
  }

  var W0 = 4 / 9, W1 = 1 / 9, W2 = 1 / 36;
  function step(n) {
    var cell = P.cell, src = P.src, sponge = P.sponge;
    var wux = P.wux, wuy = P.wuy, lam = P.lam, gam = P.gam, tau0 = P.tau0, cs2 = P.cs2;
    var e0 = eqW[0], e1 = eqW[1], e2 = eqW[2], e3 = eqW[3], e4 = eqW[4], e5 = eqW[5], e6 = eqW[6], e7 = eqW[7], e8 = eqW[8];
    var bad = false;
    for (var st = 0; st < n; st++) {
      var f = F, g = G;
      for (var i = 0; i < N; i++) {
        var d = cell[i];
        if (d < 0) continue;
        var s;
        s = src[i]; var f0 = s >= 0 ? f[s] : (s === -1 ? f[i] : e0);
        s = src[1 * N + i]; var f1 = s >= 0 ? f[1 * N + s] : (s === -1 ? f[3 * N + i] : e1);
        s = src[2 * N + i]; var f2 = s >= 0 ? f[2 * N + s] : (s === -1 ? f[4 * N + i] : e2);
        s = src[3 * N + i]; var f3 = s >= 0 ? f[3 * N + s] : (s === -1 ? f[1 * N + i] : e3);
        s = src[4 * N + i]; var f4 = s >= 0 ? f[4 * N + s] : (s === -1 ? f[2 * N + i] : e4);
        s = src[5 * N + i]; var f5 = s >= 0 ? f[5 * N + s] : (s === -1 ? f[7 * N + i] : e5);
        s = src[6 * N + i]; var f6 = s >= 0 ? f[6 * N + s] : (s === -1 ? f[8 * N + i] : e6);
        s = src[7 * N + i]; var f7 = s >= 0 ? f[7 * N + s] : (s === -1 ? f[5 * N + i] : e7);
        s = src[8 * N + i]; var f8 = s >= 0 ? f[8 * N + s] : (s === -1 ? f[6 * N + i] : e8);
        var rho = f0 + f1 + f2 + f3 + f4 + f5 + f6 + f7 + f8;
        var ux = (f1 - f3 + f5 - f6 - f7 + f8) / rho, uy = (f2 - f4 + f5 + f6 - f7 - f8) / rho;
        var um = Math.sqrt(ux * ux + uy * uy), kk = 1 / (1 + d * um);
        var Fx = lam * (wux - ux) + gam * (vel[2 * i] - ux) + ux * (kk - 1);
        var Fy = lam * (wuy - uy) + gam * (vel[2 * i + 1] - uy) + uy * (kk - 1);
        var vx = ux + 0.5 * Fx, vy = uy + 0.5 * Fy;
        vel[2 * i] = vx; vel[2 * i + 1] = vy;
        var ua = 1.5 * (ux * ux + uy * uy), bx = ux + Fx, by = uy + Fy, ub = 1.5 * (bx * bx + by * by), e;
        e = 0; var a0 = W0 * rho * (1 + 3 * e + 4.5 * e * e - ua);
        e = 0; var b0 = W0 * rho * (1 + 3 * e + 4.5 * e * e - ub);
        e = (+ux); var a1 = W1 * rho * (1 + 3 * e + 4.5 * e * e - ua);
        e = (+bx); var b1 = W1 * rho * (1 + 3 * e + 4.5 * e * e - ub);
        e = (+uy); var a2 = W1 * rho * (1 + 3 * e + 4.5 * e * e - ua);
        e = (+by); var b2 = W1 * rho * (1 + 3 * e + 4.5 * e * e - ub);
        e = (-ux); var a3 = W1 * rho * (1 + 3 * e + 4.5 * e * e - ua);
        e = (-bx); var b3 = W1 * rho * (1 + 3 * e + 4.5 * e * e - ub);
        e = (-uy); var a4 = W1 * rho * (1 + 3 * e + 4.5 * e * e - ua);
        e = (-by); var b4 = W1 * rho * (1 + 3 * e + 4.5 * e * e - ub);
        e = (+ux+uy); var a5 = W2 * rho * (1 + 3 * e + 4.5 * e * e - ua);
        e = (+bx+by); var b5 = W2 * rho * (1 + 3 * e + 4.5 * e * e - ub);
        e = (-ux+uy); var a6 = W2 * rho * (1 + 3 * e + 4.5 * e * e - ua);
        e = (-bx+by); var b6 = W2 * rho * (1 + 3 * e + 4.5 * e * e - ub);
        e = (-ux-uy); var a7 = W2 * rho * (1 + 3 * e + 4.5 * e * e - ua);
        e = (-bx-by); var b7 = W2 * rho * (1 + 3 * e + 4.5 * e * e - ub);
        e = (+ux-uy); var a8 = W2 * rho * (1 + 3 * e + 4.5 * e * e - ua);
        e = (+bx-by); var b8 = W2 * rho * (1 + 3 * e + 4.5 * e * e - ub);
        var n5 = f5 - a5, n6 = f6 - a6, n7 = f7 - a7, n8 = f8 - a8, nd = n5 + n6 + n7 + n8;
        var Pxx = f1 - a1 + f3 - a3 + nd, Pyy = f2 - a2 + f4 - a4 + nd, Pxy = n5 - n6 + n7 - n8;
        var qn = Math.sqrt(2 * (Pxx * Pxx + 2 * Pxy * Pxy + Pyy * Pyy));
        var om = 2 / (tau0 + Math.sqrt(tau0 * tau0 + 18 * cs2 * qn / rho));
        var p0 = f0 - om * (f0 - a0) + b0 - a0;
        var p1 = f1 - om * (f1 - a1) + b1 - a1;
        var p2 = f2 - om * (f2 - a2) + b2 - a2;
        var p3 = f3 - om * (f3 - a3) + b3 - a3;
        var p4 = f4 - om * (f4 - a4) + b4 - a4;
        var p5 = f5 - om * (f5 - a5) + b5 - a5;
        var p6 = f6 - om * (f6 - a6) + b6 - a6;
        var p7 = f7 - om * (f7 - a7) + b7 - a7;
        var p8 = f8 - om * (f8 - a8) + b8 - a8;
        var sIn = sponge[2 * i], sOut = sponge[2 * i + 1];
        if (sIn > 0) {
          p0 += sIn * (e0 - p0);
          p1 += sIn * (e1 - p1);
          p2 += sIn * (e2 - p2);
          p3 += sIn * (e3 - p3);
          p4 += sIn * (e4 - p4);
          p5 += sIn * (e5 - p5);
          p6 += sIn * (e6 - p6);
          p7 += sIn * (e7 - p7);
          p8 += sIn * (e8 - p8);
        }
        if (sOut > 0) {
          var uv = 1.5 * (vx * vx + vy * vy);
          e = 0; p0 += sOut * (W0 * (1 + 3 * e + 4.5 * e * e - uv) - p0);
          e = (+vx); p1 += sOut * (W1 * (1 + 3 * e + 4.5 * e * e - uv) - p1);
          e = (+vy); p2 += sOut * (W1 * (1 + 3 * e + 4.5 * e * e - uv) - p2);
          e = (-vx); p3 += sOut * (W1 * (1 + 3 * e + 4.5 * e * e - uv) - p3);
          e = (-vy); p4 += sOut * (W1 * (1 + 3 * e + 4.5 * e * e - uv) - p4);
          e = (+vx+vy); p5 += sOut * (W2 * (1 + 3 * e + 4.5 * e * e - uv) - p5);
          e = (-vx+vy); p6 += sOut * (W2 * (1 + 3 * e + 4.5 * e * e - uv) - p6);
          e = (-vx-vy); p7 += sOut * (W2 * (1 + 3 * e + 4.5 * e * e - uv) - p7);
          e = (+vx-vy); p8 += sOut * (W2 * (1 + 3 * e + 4.5 * e * e - uv) - p8);
        }
        g[i] = p0;
        g[1 * N + i] = p1;
        g[2 * N + i] = p2;
        g[3 * N + i] = p3;
        g[4 * N + i] = p4;
        g[5 * N + i] = p5;
        g[6 * N + i] = p6;
        g[7 * N + i] = p7;
        g[8 * N + i] = p8;
        if (!(rho > 0)) bad = true;
      }

      F = g; G = f;
      steps++;
    }
    return !bad;
  }

  return {
    init: init,
    step: step,
    velocity: function () { return vel; },
    populations: function () { return F; },
    steps: function () { return steps; }
  };
}

/* Boucle du Worker : messages init / run / pause, envoi d'échantillons de vitesse. */
function CLW_WORKER_MAIN(self, makeCore) {
  var core = makeCore(), running = false, gen = 0, sampleEvery = 50, sinceSample = 0, timer = null;
  function loop() {
    timer = null;
    if (!running) return;
    var t0 = Date.now(), ok = true;
    while (Date.now() - t0 < 40) {
      var n = Math.min(10, sampleEvery - sinceSample);
      ok = core.step(n) && ok;
      sinceSample += n;
      if (sinceSample >= sampleEvery) {
        var v = core.velocity().slice();
        self.postMessage({ type: 'sample', gen: gen, vel: v, steps: sinceSample, total: core.steps(), ok: ok }, [v.buffer]);
        sinceSample = 0;
        break;
      }
    }
    timer = setTimeout(loop, 0);
  }
  self.onmessage = function (e) {
    var m = e.data;
    if (m.type === 'init') {
      gen = m.gen; sampleEvery = m.sampleEvery || 50; sinceSample = 0;
      core.init(m.params);
      running = true;
      if (!timer) timer = setTimeout(loop, 0);
    } else if (m.type === 'run') {
      running = true; if (!timer) timer = setTimeout(loop, 0);
    } else if (m.type === 'pause') {
      running = false;
    } else if (m.type === 'sampleEvery') {
      sampleEvery = m.value;
    }
  };
}

(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};
  CLW.makeCpuCore = CLW_LBM_CORE;

  /* Solveur processeur : Worker (Blob) si possible, sinon calcul par tranches dans la page. */
  function CpuSolver() {
    this.kind = 'cpu';
    this.onSample = null;
    this.gen = 0;
    this.running = false;
    this.worker = null;
    this.local = null;
    try {
      var code = '(' + CLW_WORKER_MAIN.toString() + ')(self, ' + CLW_LBM_CORE.toString() + ');';
      var url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      this.worker = new Worker(url);
      var self = this;
      this.worker.onmessage = function (e) {
        var m = e.data;
        if (m.type === 'sample' && m.gen === self.gen && self.onSample) self.onSample(m.vel, m.steps, m.ok);
      };
      this.worker.onerror = function () { self._fallback(); };
    } catch (err) {
      this._fallback();
    }
  }
  CpuSolver.prototype._fallback = function () {
    if (this.worker) { try { this.worker.terminate(); } catch (e) { /* rien */ } }
    this.worker = null;
    this.local = { core: CLW_LBM_CORE(), timer: null, since: 0, every: 50 };
    if (this._last) this.reset(this._last.params, this._last.sampleEvery);
  };
  CpuSolver.prototype.reset = function (params, sampleEvery) {
    this.gen++;
    this._last = { params: params, sampleEvery: sampleEvery };
    this.running = true;
    if (this.worker) {
      // copies : le Worker garde ses propres tableaux
      this.worker.postMessage({ type: 'init', gen: this.gen, sampleEvery: sampleEvery, params: params });
    } else {
      var L = this.local, self = this;
      L.core.init(params); L.since = 0; L.every = sampleEvery;
      var gen = this.gen;
      var tick = function () {
        L.timer = null;
        if (!self.running || gen !== self.gen) return;
        var t0 = performance.now(), ok = true;
        while (performance.now() - t0 < 12) {
          var n = Math.min(5, L.every - L.since);
          ok = L.core.step(n) && ok; L.since += n;
          if (L.since >= L.every) {
            if (self.onSample) self.onSample(L.core.velocity().slice(), L.since, ok);
            L.since = 0; break;
          }
        }
        L.timer = setTimeout(tick, 4);
      };
      if (L.timer) clearTimeout(L.timer);
      L.timer = setTimeout(tick, 0);
      this._tick = tick;
    }
  };
  CpuSolver.prototype.setSampleEvery = function (n) {
    if (this.worker) this.worker.postMessage({ type: 'sampleEvery', value: n });
    else if (this.local) this.local.every = n;
  };
  CpuSolver.prototype.pause = function () {
    this.running = false;
    if (this.worker) this.worker.postMessage({ type: 'pause' });
  };
  CpuSolver.prototype.resume = function () {
    this.running = true;
    if (this.worker) this.worker.postMessage({ type: 'run' });
    else if (this.local && !this.local.timer && this._tick) this.local.timer = setTimeout(this._tick, 0);
  };
  CpuSolver.prototype.frame = function () { /* rien : le calcul est autonome */ };
  CpuSolver.prototype.destroy = function () {
    this.running = false; this.gen++;
    if (this.worker) this.worker.terminate();
    if (this.local && this.local.timer) clearTimeout(this.local.timer);
  };
  CLW.CpuSolver = CpuSolver;
})(typeof window !== 'undefined' ? window : globalThis);
