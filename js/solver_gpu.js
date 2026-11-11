/* CL-WIND - solver_gpu.js
 * Même algorithme que solver_cpu.js, en compute shader WGSL.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};

  var WGSL = [
    'struct Params { nx: u32, ny: u32, N: u32, pad0: u32,',
    '  wux: f32, wuy: f32, lam: f32, gam: f32, tau0: f32, cs2: f32, pad1: f32, pad2: f32 };',
    '@group(0) @binding(0) var<uniform> P: Params;',
    '@group(0) @binding(1) var<storage, read> fsrc: array<f32>;',
    '@group(0) @binding(2) var<storage, read_write> fdst: array<f32>;',
    '@group(0) @binding(3) var<storage, read> cell: array<f32>;',
    '@group(0) @binding(4) var<storage, read> srcIdx: array<i32>;',
    '@group(0) @binding(5) var<storage, read> sponge: array<f32>;',
    '@group(0) @binding(6) var<storage, read_write> vel: array<f32>;',
    'var<private> EX: array<f32, 9> = array<f32, 9>(0.0, 1.0, 0.0, -1.0, 0.0, 1.0, -1.0, -1.0, 1.0);',
    'var<private> EY: array<f32, 9> = array<f32, 9>(0.0, 0.0, 1.0, 0.0, -1.0, 1.0, 1.0, -1.0, -1.0);',
    'var<private> WT: array<f32, 9> = array<f32, 9>(4.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/9.0, 1.0/36.0, 1.0/36.0, 1.0/36.0, 1.0/36.0);',
    'var<private> OPP: array<u32, 9> = array<u32, 9>(0u, 3u, 4u, 1u, 2u, 7u, 8u, 5u, 6u);',
    'fn feq(k: u32, rho: f32, ux: f32, uy: f32) -> f32 {',
    '  let e = EX[k] * ux + EY[k] * uy;',
    '  return WT[k] * rho * (1.0 + 3.0 * e + 4.5 * e * e - 1.5 * (ux * ux + uy * uy));',
    '}',
    '@compute @workgroup_size(16, 16)',
    'fn main(@builtin(global_invocation_id) gid: vec3<u32>) {',
    '  if (gid.x >= P.nx || gid.y >= P.ny) { return; }',
    '  let N = P.N;',
    '  let i = gid.y * P.nx + gid.x;',
    '  let d = cell[i];',
    '  if (d < 0.0) { return; }',
    '  var fi: array<f32, 9>;',
    '  var rho = 0.0; var mx = 0.0; var my = 0.0;',
    '  for (var k = 0u; k < 9u; k++) {',
    '    let s = srcIdx[k * N + i];',
    '    var v: f32;',
    '    if (s >= 0) { v = fsrc[k * N + u32(s)]; }',
    '    else if (s == -1) { v = fsrc[OPP[k] * N + i]; }',
    '    else { v = feq(k, 1.0, P.wux, P.wuy); }',
    '    fi[k] = v; rho += v; mx += EX[k] * v; my += EY[k] * v;',
    '  }',
    '  let ux = mx / rho; let uy = my / rho;',
    '  let um = sqrt(ux * ux + uy * uy);',
    '  let kk = 1.0 / (1.0 + d * um);',
    '  let Fx = P.lam * (P.wux - ux) + P.gam * (vel[2u * i] - ux) + ux * (kk - 1.0);',
    '  let Fy = P.lam * (P.wuy - uy) + P.gam * (vel[2u * i + 1u] - uy) + uy * (kk - 1.0);',
    '  let vx = ux + 0.5 * Fx; let vy = uy + 0.5 * Fy;',
    '  vel[2u * i] = vx; vel[2u * i + 1u] = vy;',
    '  var a: array<f32, 9>;',
    '  var Pxx = 0.0; var Pxy = 0.0; var Pyy = 0.0;',
    '  for (var k = 0u; k < 9u; k++) {',
    '    a[k] = feq(k, rho, ux, uy);',
    '    let ne = fi[k] - a[k];',
    '    Pxx += EX[k] * EX[k] * ne; Pxy += EX[k] * EY[k] * ne; Pyy += EY[k] * EY[k] * ne;',
    '  }',
    '  let qn = sqrt(2.0 * (Pxx * Pxx + 2.0 * Pxy * Pxy + Pyy * Pyy));',
    '  let om = 2.0 / (P.tau0 + sqrt(P.tau0 * P.tau0 + 18.0 * P.cs2 * qn / rho));',
    '  let sIn = sponge[2u * i]; let sOut = sponge[2u * i + 1u];',
    '  let bx = ux + Fx; let by = uy + Fy;',
    '  for (var k = 0u; k < 9u; k++) {',
    '    var p = fi[k] - om * (fi[k] - a[k]) + feq(k, rho, bx, by) - a[k];',
    '    if (sIn > 0.0) { p += sIn * (feq(k, 1.0, P.wux, P.wuy) - p); }',
    '    if (sOut > 0.0) { p += sOut * (feq(k, 1.0, vx, vy) - p); }',
    '    fdst[k * N + i] = p;',
    '  }',
    '}'
  ].join('\n');
  CLW.WGSL = WGSL;

  function GpuSolver(device, adapterInfo) {
    this.kind = 'gpu';
    this.device = device;
    this.info = adapterInfo || '';
    this.onSample = null;
    this.onLost = null;
    this.gen = 0;
    this.running = false;
    this.B = null;
    this.K = 20;           // pas par lot, ajusté automatiquement
    this.inFlight = false;
    this.since = 0;
    this.sampleEvery = 50;
    this.reading = false;
    var module = device.createShaderModule({ code: WGSL });
    this.pipeline = device.createComputePipeline({ layout: 'auto', compute: { module: module, entryPoint: 'main' } });
  }

  // allowSoftware : accepte un adaptateur logiciel (SwiftShader), plus lent que le solveur processeur
  GpuSolver.create = function (allowSoftware) {
    if (!root.navigator || !navigator.gpu) return Promise.resolve(null);
    return navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).then(function (adapter) {
      if (!adapter) return null;
      var inf = adapter.info || {};
      var soft = adapter.isFallbackAdapter || inf.isFallbackAdapter || /swiftshader/i.test((inf.architecture || '') + ' ' + (inf.description || ''));
      if (soft && !allowSoftware) { console.info('Adaptateur WebGPU logiciel ignoré : repli sur le processeur'); return null; }
      // plus grande grille : 3072 × 3072, 9 populations (340 Mo par tampon) ; on demande ce que la carte
      // permet, et la taille de grille est ensuite bornée par la limite obtenue
      var need = 9 * 3072 * 3072 * 4;
      var lim = {
        maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, Math.max(need, 134217728)),
        maxBufferSize: Math.min(adapter.limits.maxBufferSize, Math.max(need, 268435456)),
        maxStorageBuffersPerShaderStage: Math.max(6, Math.min(adapter.limits.maxStorageBuffersPerShaderStage, 8))
      };
      return adapter.requestDevice({ requiredLimits: lim }).then(function (device) {
        var cap = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
        CLW.LBM.GPU_MAX_CELLS = Math.min(3072 * 3072, Math.floor(cap / 36));
        var s = new GpuSolver(device, adapter.info ? (adapter.info.vendor + ' ' + adapter.info.architecture) : '');
        device.lost.then(function (e) { if (s.onLost) s.onLost(e); });
        return s;
      });
    }).catch(function (e) { console.warn('WebGPU indisponible :', e); return null; });
  };

  GpuSolver.prototype._free = function () {
    var B = this.B; if (!B) return;
    ['uni', 'f0', 'f1', 'cell', 'src', 'sponge', 'vel'].forEach(function (k) { try { B[k].destroy(); } catch (e) { /* rien */ } });
    // readBuf peut être en cours de lecture : il sera détruit après
    var rb = B.readBuf; if (!this.reading) { try { rb.destroy(); } catch (e) { /* rien */ } } else B.readDead = true;
    this.B = null;
  };

  GpuSolver.prototype.reset = function (p, sampleEvery) {
    var dev = this.device;
    this._free();
    this.gen++;
    this.sampleEvery = sampleEvery || 50;
    this.since = 0;
    var N = p.nx * p.ny;
    var S = GPUBufferUsage.STORAGE, CD = GPUBufferUsage.COPY_DST, CS = GPUBufferUsage.COPY_SRC;
    function buf(size, usage) { return dev.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage: usage }); }
    var B = { N: N, nx: p.nx, ny: p.ny, gen: this.gen };
    B.uni = buf(48, GPUBufferUsage.UNIFORM | CD);
    var u = new ArrayBuffer(48), ui = new Uint32Array(u), uf = new Float32Array(u);
    ui[0] = p.nx; ui[1] = p.ny; ui[2] = N;
    uf[4] = p.wux; uf[5] = p.wuy; uf[6] = p.lam; uf[7] = p.gam; uf[8] = p.tau0; uf[9] = p.cs2;
    dev.queue.writeBuffer(B.uni, 0, u);
    B.f0 = buf(9 * N * 4, S | CD); B.f1 = buf(9 * N * 4, S | CD);
    var f = new Float32Array(9 * N), uu = p.wux * p.wux + p.wuy * p.wuy, Q = CLW.D2Q9;
    for (var k = 0; k < 9; k++) {
      var e = Q.EX[k] * p.wux + Q.EY[k] * p.wuy;
      f.fill(Q.W[k] * (1 + 3 * e + 4.5 * e * e - 1.5 * uu), k * N, (k + 1) * N);
    }
    dev.queue.writeBuffer(B.f0, 0, f); dev.queue.writeBuffer(B.f1, 0, f);
    B.cell = buf(N * 4, S | CD); dev.queue.writeBuffer(B.cell, 0, p.cell);
    B.src = buf(9 * N * 4, S | CD); dev.queue.writeBuffer(B.src, 0, p.src);
    B.sponge = buf(2 * N * 4, S | CD); dev.queue.writeBuffer(B.sponge, 0, p.sponge);
    // vitesse initialisée au vent libre, sinon le premier pas reçoit un à-coup
    B.vel = buf(2 * N * 4, S | CD | CS);
    var v = new Float32Array(2 * N);
    for (var i = 0; i < N; i++) if (p.cell[i] >= 0) { v[2 * i] = p.wux; v[2 * i + 1] = p.wuy; }
    dev.queue.writeBuffer(B.vel, 0, v);
    B.readBuf = buf(2 * N * 4, GPUBufferUsage.MAP_READ | CD);
    var lay = this.pipeline.getBindGroupLayout(0);
    function bg(a, b) {
      return dev.createBindGroup({
        layout: lay, entries: [
          { binding: 0, resource: { buffer: B.uni } }, { binding: 1, resource: { buffer: a } },
          { binding: 2, resource: { buffer: b } }, { binding: 3, resource: { buffer: B.cell } },
          { binding: 4, resource: { buffer: B.src } }, { binding: 5, resource: { buffer: B.sponge } },
          { binding: 6, resource: { buffer: B.vel } }]
      });
    }
    B.bg = [bg(B.f0, B.f1), bg(B.f1, B.f0)];
    B.parity = 0;
    B.total = 0;
    this.B = B;
    this.running = true;
  };

  GpuSolver.prototype.setSampleEvery = function (n) { this.sampleEvery = n; };
  GpuSolver.prototype.pause = function () { this.running = false; };
  GpuSolver.prototype.resume = function () { this.running = true; };

  // à appeler à chaque image : envoie un lot de pas si le précédent est terminé
  GpuSolver.prototype.frame = function () {
    if (!this.running || !this.B || this.inFlight) return;
    var B = this.B, dev = this.device, self = this;
    var want = !this.reading ? this.sampleEvery - this.since : Infinity;
    var K = Math.max(1, Math.min(this.K, want));
    var enc = dev.createCommandEncoder();
    var pass = enc.beginComputePass();
    pass.setPipeline(this.pipeline);
    var wx = Math.ceil(B.nx / 16), wy = Math.ceil(B.ny / 16);
    for (var s = 0; s < K; s++) {
      pass.setBindGroup(0, B.bg[B.parity]);
      pass.dispatchWorkgroups(wx, wy);
      B.parity ^= 1;
    }
    pass.end();
    this.since += K; B.total += K;
    var doRead = !this.reading && this.since >= this.sampleEvery;
    if (doRead) enc.copyBufferToBuffer(B.vel, 0, B.readBuf, 0, 2 * B.N * 4);
    dev.queue.submit([enc.finish()]);
    this.inFlight = true;
    var t0 = performance.now(), Kd = K;
    dev.queue.onSubmittedWorkDone().then(function () {
      self.inFlight = false;
      var dt = performance.now() - t0;
      // vise environ 12 ms de calcul par lot
      if (Kd >= self.K) {
        if (dt < 8) self.K = Math.min(400, Math.ceil(self.K * 1.3));
        else if (dt > 16) self.K = Math.max(1, Math.floor(self.K * 0.7));
      }
    });
    if (doRead) {
      var steps = this.since, gen = this.gen, rb = B.readBuf;
      this.since = 0;
      this.reading = true;
      rb.mapAsync(GPUMapMode.READ).then(function () {
        self.reading = false;
        // lecture arrivée après remplacement du solveur : ignorée
        if (gen !== self.gen || !self.B || self.B.readBuf !== rb) {
          try { rb.unmap(); } catch (e) { /* rien */ }
          if (B.readDead) { try { rb.destroy(); } catch (e) { /* rien */ } }
          return;
        }
        var v = new Float32Array(rb.getMappedRange().slice(0));
        rb.unmap();
        if (self.onSample) self.onSample(v, steps, true);
      }).catch(function () {
        self.reading = false;
      });
    }
  };

  GpuSolver.prototype.destroy = function () {
    this.running = false; this.gen++;
    this._free();
  };

  CLW.GpuSolver = GpuSolver;
})(typeof window !== 'undefined' ? window : globalThis);
