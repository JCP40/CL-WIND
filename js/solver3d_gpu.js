/* CL-WIND - solver3d_gpu.js
 * Vent 3D : Lattice-Boltzmann D3Q19, BGK + Smagorinsky, en compute shader WGSL (WebGPU seulement).
 * Axes du réseau : x vers l'est, y vers le nord, z vers le haut. Drapeaux : bit 1 plein, bit 2 sol.
 * - Sol glissant (réflexion miroir, couche z = 0 avec drapeau 3) : un sol lisse et collant laisse se
 *   former une couche ralentie irréaliste qui finit par refluer et rendre le calcul instable ; les
 *   obstacles, eux, sont collants (rebond).
 * - Rappel doux vers le profil, F = lam (u_profil − u), lam = uref / lamL : entretient le profil
 *   d'entrée (valeur de réglage 120 m comme en 2D, non calibrée) et stabilise les sorties.
 * - Entrée : faces où le vent entre franchement (composante > 0,2 |vent|), équilibre du profil
 *   u(h) = uref (h / zref)^alpha ; dessus : équilibre du profil ; autres faces : sortie à pression
 *   fixée (rho = 1) avec la vitesse du pas précédent, sans retour d'air (la simple recopie laisse
 *   entrer de l'air à contre-sens quand le sillage arrive, et le calcul part en vrille).
 * - Écrans poreux et arbres : traînée quadratique implicite k = 1 / (1 + d |u|) (d par cellule).
 * - Mode parasite amorti par gam × (u du pas précédent − u), comme en 2D.
 * - Turbulence d'entrée : bruit lisse (échelle zref, temps échelle / uref), intensité 20 % ; sans elle,
 *   l'écoulement reste trop régulier et les sillages sont deux fois trop longs. Cube posé au sol,
 *   H = 20 cellules : recirculation 3,15 H sans turbulence, 2,55 H à 10 %, 1,9 H à 20 % (essais : 1,2 à 1,8 H).
 * - Éponges : max(8, 10 %) cellules sur les faces latérales et 10 % sur le dessus, vers le profil
 *   (en sortie aussi : le sillage est amorti avant d'atteindre la face de sortie).
 * - Moyenne calculée sur la carte (vec4 : ux, uy, uz, |u|) ; seules les coupes sont relues.
 */
(function (root) {
  'use strict';
  var CLW = root.CLW = root.CLW || {};

  var E = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    [1, 1, 0], [-1, -1, 0], [1, -1, 0], [-1, 1, 0], [1, 0, 1], [-1, 0, -1], [1, 0, -1], [-1, 0, 1],
    [0, 1, 1], [0, -1, -1], [0, 1, -1], [0, -1, 1]];
  var W = E.map(function (e, k) { return k === 0 ? 1 / 3 : (Math.abs(e[0]) + Math.abs(e[1]) + Math.abs(e[2]) === 1 ? 1 / 18 : 1 / 36); });
  var OPP = E.map(function (e) { for (var q = 0; q < 19; q++) if (E[q][0] === -e[0] && E[q][1] === -e[1] && E[q][2] === -e[2]) return q; return -1; });
  // symétrique par rapport au plan horizontal (réflexion miroir sur le sol glissant)
  var MZ = E.map(function (e) { for (var q = 0; q < 19; q++) if (E[q][0] === e[0] && E[q][1] === e[1] && E[q][2] === -e[2]) return q; return -1; });
  CLW.D3Q19 = { E: E, W: W, OPP: OPP, MZ: MZ };
  function arr(t, a) { return 'array<' + t + ', 19>(' + a.map(function (v) { return t === 'f32' ? v.toFixed(9) : String(v) + (t === 'u32' ? 'u' : ''); }).join(', ') + ')'; }

  var WGSL = [
    'struct Params { nx: u32, ny: u32, nz: u32, N: u32,',
    '  wx: f32, wy: f32, uref: f32, alpha: f32,',
    '  zref: f32, tau0: f32, cs2: f32, gam: f32,',
    '  spT: f32, spTop: f32, inMask: u32, lam: f32,',
    '  turbI: f32, turbT: f32, turbL: f32, pad0: f32 };',
    '@group(0) @binding(0) var<uniform> P: Params;',
    '@group(0) @binding(1) var<storage, read> fin: array<f32>;',
    '@group(0) @binding(2) var<storage, read_write> fout: array<f32>;',
    '@group(0) @binding(3) var<storage, read> flags: array<u32>;',
    '@group(0) @binding(4) var<storage, read> drag: array<f32>;',
    '@group(0) @binding(5) var<storage, read_write> vel: array<f32>;',
    '@group(0) @binding(6) var<storage, read> cnt: array<u32>;',
    'var<private> CX: array<i32, 19> = ' + arr('i32', E.map(function (e) { return e[0]; })) + ';',
    'var<private> CY: array<i32, 19> = ' + arr('i32', E.map(function (e) { return e[1]; })) + ';',
    'var<private> CZ: array<i32, 19> = ' + arr('i32', E.map(function (e) { return e[2]; })) + ';',
    'var<private> WT: array<f32, 19> = ' + arr('f32', W) + ';',
    'var<private> OPP: array<u32, 19> = ' + arr('u32', OPP) + ';',
    'var<private> MZ: array<u32, 19> = ' + arr('u32', MZ) + ';',
    'fn cvec(q: u32) -> vec3<f32> { return vec3<f32>(f32(CX[q]), f32(CY[q]), f32(CZ[q])); }',
    'fn feq(q: u32, rho: f32, u: vec3<f32>) -> f32 {',
    '  let cu = 3.0 * dot(cvec(q), u);',
    '  return WT[q] * rho * (1.0 + cu + 0.5 * cu * cu - 1.5 * dot(u, u));',
    '}',
    // profil de vent ; hauteur au-dessus du sol en cellules : z - 0,5 (paroi à mi-chemin, z = 1)
    'fn prof(z: f32) -> vec3<f32> {',
    '  let h = max(z - 0.5, 0.25);',
    '  let s = P.uref * pow(h / P.zref, P.alpha);',
    '  return vec3<f32>(P.wx * s, P.wy * s, 0.0);',
    '}',
    'fn hash3(p: vec3<i32>, s: u32) -> f32 {',
    '  var h = u32(p.x) * 374761393u + u32(p.y) * 668265263u + u32(p.z) * 2246822519u + s * 3266489917u;',
    '  h = (h ^ (h >> 13u)) * 1274126177u; h = h ^ (h >> 16u);',
    '  return f32(h & 16777215u) / 8388608.0 - 1.0;',
    '}',
    'fn vnoise(p: vec3<f32>, s: u32) -> f32 {',
    '  let b = vec3<i32>(floor(p)); let t = fract(p); let w = t * t * (3.0 - 2.0 * t);',
    '  let c000 = hash3(b, s); let c100 = hash3(b + vec3<i32>(1, 0, 0), s);',
    '  let c010 = hash3(b + vec3<i32>(0, 1, 0), s); let c110 = hash3(b + vec3<i32>(1, 1, 0), s);',
    '  let c001 = hash3(b + vec3<i32>(0, 0, 1), s); let c101 = hash3(b + vec3<i32>(1, 0, 1), s);',
    '  let c011 = hash3(b + vec3<i32>(0, 1, 1), s); let c111 = hash3(b + vec3<i32>(1, 1, 1), s);',
    '  let x0 = mix(mix(c000, c100, w.x), mix(c010, c110, w.x), w.y);',
    '  let x1 = mix(mix(c001, c101, w.x), mix(c011, c111, w.x), w.y);',
    '  return mix(x0, x1, w.z);',
    '}',
    '@compute @workgroup_size(8, 8, 4)',
    'fn main(@builtin(global_invocation_id) gid: vec3<u32>) {',
    '  if (gid.x >= P.nx || gid.y >= P.ny || gid.z >= P.nz) { return; }',
    '  let N = P.N;',
    '  let i = gid.x + P.nx * (gid.y + P.ny * gid.z);',
    '  if ((flags[i] & 1u) != 0u) { return; }',
    '  let x = i32(gid.x); let y = i32(gid.y); let z = i32(gid.z);',
    '  let nx = i32(P.nx); let ny = i32(P.ny); let nz = i32(P.nz);',
    '  let pz = prof(f32(z));',
    '  let ptop = prof(f32(nz) - 0.5);',
    '  let up = vec3<f32>(vel[3u * i], vel[3u * i + 1u], vel[3u * i + 2u]);',
    // sortie : pression fixée (rho = 1) et vitesse du pas précédent sans retour d'air
    '  var uo = up;',
    '  if (x == nx - 1 && (P.inMask & 2u) == 0u) { uo.x = max(uo.x, 0.0); }',
    '  if (x == 0 && (P.inMask & 1u) == 0u) { uo.x = min(uo.x, 0.0); }',
    '  if (y == ny - 1 && (P.inMask & 8u) == 0u) { uo.y = max(uo.y, 0.0); }',
    '  if (y == 0 && (P.inMask & 4u) == 0u) { uo.y = min(uo.y, 0.0); }',
    // éponges : faces latérales et dessus, vers le profil (vers le vent turbulent près des entrées)
    '  var sIn = 0.0; var sOut = 0.0; var sTop = 0.0;',
    '  let T = P.spT;',
    '  let dxm = f32(x) + 0.5; let dxp = f32(nx - x) - 0.5; let dym = f32(y) + 0.5; let dyp = f32(ny - y) - 0.5;',
    '  if (dxm < T) { let s = 0.5 * (1.0 - dxm / T) * (1.0 - dxm / T); if ((P.inMask & 1u) != 0u) { sIn = max(sIn, s); } else { sOut = max(sOut, s); } }',
    '  if (dxp < T) { let s = 0.5 * (1.0 - dxp / T) * (1.0 - dxp / T); if ((P.inMask & 2u) != 0u) { sIn = max(sIn, s); } else { sOut = max(sOut, s); } }',
    '  if (dym < T) { let s = 0.5 * (1.0 - dym / T) * (1.0 - dym / T); if ((P.inMask & 4u) != 0u) { sIn = max(sIn, s); } else { sOut = max(sOut, s); } }',
    '  if (dyp < T) { let s = 0.5 * (1.0 - dyp / T) * (1.0 - dyp / T); if ((P.inMask & 8u) != 0u) { sIn = max(sIn, s); } else { sOut = max(sOut, s); } }',
    '  let dzp = f32(nz - z) - 0.5;',
    '  if (dzp < P.spTop) { let s = 0.5 * (1.0 - dzp / P.spTop) * (1.0 - dzp / P.spTop); sTop = s; }',
    // turbulence d'entrée : bruit lisse en espace (échelle turbL) et en temps (turbT pas), intensité turbI
    '  var pin = pz;',
    '  if (sIn > 0.0 && P.turbI > 0.0) {',
    '    let tt = f32(cnt[0]) / P.turbT;',
    '    let a = vec3<f32>((f32(x) + f32(y)) / P.turbL, f32(z) / P.turbL, tt);',
    '    let amp = 2.5 * P.turbI * length(pz);',
    '    pin = pz + amp * vec3<f32>(vnoise(a, 1u), vnoise(a, 2u), 0.6 * vnoise(a, 3u));',
    '  }',
    '  var f: array<f32, 19>;',
    '  var rho = 0.0; var m = vec3<f32>(0.0);',
    '  for (var q = 0u; q < 19u; q++) {',
    '    let sx = x - CX[q]; let sy = y - CY[q]; let sz = z - CZ[q];',
    '    var v: f32;',
    '    if (sz < 0) { v = fin[OPP[q] * N + i]; }',
    '    else if (sz >= nz) { v = feq(q, 1.0, ptop); }',
    '    else if (sx < 0 || sx >= nx || sy < 0 || sy >= ny) {',
    '      var inl = false;',
    '      if (sx < 0 && (P.inMask & 1u) != 0u) { inl = true; }',
    '      if (sx >= nx && (P.inMask & 2u) != 0u) { inl = true; }',
    '      if (sy < 0 && (P.inMask & 4u) != 0u) { inl = true; }',
    '      if (sy >= ny && (P.inMask & 8u) != 0u) { inl = true; }',
    '      if (inl) { v = feq(q, 1.0, pin); } else { v = feq(q, 1.0, uo); }',
    '    } else {',
    '      let s = u32(sx) + P.nx * (u32(sy) + P.ny * u32(sz));',
    '      let fl = flags[s];',
    '      if ((fl & 1u) == 0u) { v = fin[q * N + s]; }',
    // sol (bit 2) et population venant d'en dessous : réflexion miroir depuis la voisine horizontale
    '      else if ((fl & 2u) != 0u && CZ[q] == 1) {',
    '        if (sx < 0 || sx >= nx || sy < 0 || sy >= ny) { v = fin[MZ[q] * N + i]; }',
    '        else {',
    '          let h = u32(sx) + P.nx * (u32(sy) + P.ny * u32(z));',
    '          if ((flags[h] & 1u) != 0u) { v = fin[OPP[q] * N + i]; } else { v = fin[MZ[q] * N + h]; }',
    '        }',
    '      }',
    '      else { v = fin[OPP[q] * N + i]; }',
    '    }',
    '    f[q] = v; rho += v; m += cvec(q) * v;',
    '  }',
    '  let u = m / rho;',
    '  let um = length(u);',
    '  let kk = 1.0 / (1.0 + drag[i] * um);',
    '  let F = u * (kk - 1.0) + P.gam * (up - u) + P.lam * (pz - u);',
    '  let ue = u + 0.5 * F;',
    '  vel[3u * i] = ue.x; vel[3u * i + 1u] = ue.y; vel[3u * i + 2u] = ue.z;',
    '  var a: array<f32, 19>;',
    '  var pxx = 0.0; var pyy = 0.0; var pzz = 0.0; var pxy = 0.0; var pxz = 0.0; var pyz = 0.0;',
    '  for (var q = 0u; q < 19u; q++) {',
    '    a[q] = feq(q, rho, u);',
    '    let ne = f[q] - a[q];',
    '    let c = cvec(q);',
    '    pxx += c.x * c.x * ne; pyy += c.y * c.y * ne; pzz += c.z * c.z * ne;',
    '    pxy += c.x * c.y * ne; pxz += c.x * c.z * ne; pyz += c.y * c.z * ne;',
    '  }',
    '  let qn = sqrt(2.0 * (pxx * pxx + pyy * pyy + pzz * pzz + 2.0 * (pxy * pxy + pxz * pxz + pyz * pyz)));',
    '  let om = 2.0 / (P.tau0 + sqrt(P.tau0 * P.tau0 + 18.0 * P.cs2 * qn / rho));',
    '  let b = u + F;',
    '  for (var q = 0u; q < 19u; q++) {',
    '    var p = f[q] - om * (f[q] - a[q]) + feq(q, rho, b) - a[q];',
    '    if (sIn > 0.0) { p += sIn * (feq(q, 1.0, pin) - p); }',
    '    if (sTop > 0.0) { p += sTop * (feq(q, 1.0, pz) - p); }',
    // éponge de sortie : vers le profil, pour amortir le sillage avant la sortie (sinon il s'y réfléchit)
    '    if (sOut > 0.0) { p += sOut * (feq(q, 1.0, pz) - p); }',
    '    fout[q * N + i] = p;',
    '  }',
    '}'
  ].join('\n');

  // moyenne sur la carte : mean += w (vel, |vel|) − mean ; w = 1 remplace
  var WGSL_ACC = [
    'struct A { N: u32, w: f32, p0: u32, p1: u32 };',
    '@group(0) @binding(0) var<uniform> Q: A;',
    '@group(0) @binding(1) var<storage, read> vel: array<f32>;',
    '@group(0) @binding(2) var<storage, read_write> mean: array<vec4<f32>>;',
    '@compute @workgroup_size(256)',
    'fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nwg: vec3<u32>) {',
    '  let i = gid.x + gid.y * nwg.x * 256u;',
    '  if (i >= Q.N) { return; }',
    '  let v = vec3<f32>(vel[3u * i], vel[3u * i + 1u], vel[3u * i + 2u]);',
    '  let s = vec4<f32>(v, length(v));',
    '  mean[i] = mean[i] + Q.w * (s - mean[i]);',
    '}'
  ].join('\n');
  var WGSL_TICK = [
    '@group(0) @binding(0) var<storage, read_write> cnt: array<u32>;',
    '@compute @workgroup_size(1)',
    'fn main() { cnt[0] = cnt[0] + 1u; }'
  ].join('\n');
  CLW.WGSL3D = WGSL;

  function Solver3D(device, info) {
    this.device = device; this.info = info || '';
    this.pipe = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: WGSL }), entryPoint: 'main' } });
    this.pipeTick = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: WGSL_TICK }), entryPoint: 'main' } });
    this.pipeAcc = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: WGSL_ACC }), entryPoint: 'main' } });
    this.B = null; this.K = 4; this.inFlight = false; this.running = false;
    this.steps = 0; this.weight = 0; this.samples = 0; this.trav = 0; this.since = 0; this.sampleEvery = 50;
  }
  Solver3D.MAX_BYTES = 0;

  Solver3D.create = function () {
    if (!root.navigator || !navigator.gpu) return Promise.resolve(null);
    return navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).then(function (ad) {
      if (!ad) return null;
      var lim = {
        maxStorageBufferBindingSize: ad.limits.maxStorageBufferBindingSize,
        maxBufferSize: ad.limits.maxBufferSize,
        maxStorageBuffersPerShaderStage: Math.max(6, Math.min(ad.limits.maxStorageBuffersPerShaderStage, 8)),
        maxComputeWorkgroupsPerDimension: ad.limits.maxComputeWorkgroupsPerDimension
      };
      return ad.requestDevice({ requiredLimits: lim }).then(function (dev) {
        Solver3D.MAX_BYTES = Math.min(dev.limits.maxStorageBufferBindingSize, dev.limits.maxBufferSize);
        var inf = ad.info || {};
        return new Solver3D(dev, (inf.vendor || '') + ' ' + (inf.architecture || ''));
      });
    }).catch(function (e) { console.warn('WebGPU 3D indisponible :', e); return null; });
  };
  // plus grand nombre de cellules possible (9 populations × 2 → 19 populations par tampon)
  Solver3D.maxCells = function () { return Math.floor(Solver3D.MAX_BYTES / (19 * 4)); };

  Solver3D.prototype._free = function () {
    var B = this.B; if (!B) return;
    ['uni', 'f0', 'f1', 'flags', 'drag', 'vel', 'mean', 'acc', 'cnt'].forEach(function (k) { try { B[k].destroy(); } catch (e) { /* rien */ } });
    this.B = null;
  };

  // p : { nx, ny, nz, flags: Uint32Array(N), drag: Float32Array(N) ou null, dir (vent venant de, degrés),
  //       uref (vitesse réseau à zref), alpha, zref (cellules au-dessus du sol), tau0, cs, gam }
  Solver3D.prototype.reset = function (p) {
    var dev = this.device; this._free();
    var nx = p.nx, ny = p.ny, nz = p.nz, N = nx * ny * nz;
    var th = p.dir * Math.PI / 180, wx = -Math.sin(th), wy = -Math.cos(th);
    var mask = (wx > 0.2 ? 1 : 0) | (wx < -0.2 ? 2 : 0) | (wy > 0.2 ? 4 : 0) | (wy < -0.2 ? 8 : 0);
    var S = GPUBufferUsage.STORAGE, CD = GPUBufferUsage.COPY_DST, CS = GPUBufferUsage.COPY_SRC;
    function buf(size, usage) { return dev.createBuffer({ size: Math.max(16, Math.ceil(size / 16) * 16), usage: usage }); }
    var B = { N: N, nx: nx, ny: ny, nz: nz, parity: 0 };
    B.uni = buf(80, GPUBufferUsage.UNIFORM | CD);
    var ab = new ArrayBuffer(80), U = new Uint32Array(ab), F = new Float32Array(ab);
    U[0] = nx; U[1] = ny; U[2] = nz; U[3] = N;
    F[4] = wx; F[5] = wy; F[6] = p.uref; F[7] = p.alpha;
    F[8] = p.zref; F[9] = p.tau0; F[10] = p.cs * p.cs; F[11] = p.gam;
    // rappel vers le profil sur une longueur lamL (en cellules ; 120 m / taille de cellule par défaut)
    F[12] = Math.max(8, 0.1 * Math.min(nx, ny)); F[13] = Math.max(6, 0.1 * nz); U[14] = mask; F[15] = p.lamL > 0 ? p.uref / p.lamL : 0;
    // turbulence d'entrée : intensité (0,2 par défaut), échelle spatiale (zref) et temporelle (échelle / uref)
    var tL = p.turbL || Math.max(8, p.zref);
    F[16] = p.turbI == null ? 0.2 : p.turbI; F[17] = p.turbT || tL / p.uref; F[18] = tL; F[19] = 0;
    dev.queue.writeBuffer(B.uni, 0, ab);
    B.f0 = buf(19 * N * 4, S | CD); B.f1 = buf(19 * N * 4, S | CD);
    // état initial : équilibre du profil de vent (hors cellules pleines : sans objet)
    var col = new Float32Array(19 * nz);
    var zr = p.zref, al = p.alpha, Q = CLW.D3Q19;
    var ux = new Float32Array(nz), uy = new Float32Array(nz);
    for (var z = 0; z < nz; z++) {
      var s = p.uref * Math.pow(Math.max(z - 0.5, 0.25) / zr, al);
      ux[z] = wx * s; uy[z] = wy * s;
    }
    // écriture par plans q (19 × N flottants) en morceaux pour limiter la mémoire
    var plane = nx * ny, chunk = new Float32Array(plane);
    for (var q = 0; q < 19; q++) {
      for (z = 0; z < nz; z++) {
        var cu = 3 * (Q.E[q][0] * ux[z] + Q.E[q][1] * uy[z]), uu = ux[z] * ux[z] + uy[z] * uy[z];
        chunk.fill(Q.W[q] * (1 + cu + 0.5 * cu * cu - 1.5 * uu));
        var off = (q * N + z * plane) * 4;
        dev.queue.writeBuffer(B.f0, off, chunk); dev.queue.writeBuffer(B.f1, off, chunk);
      }
    }
    B.flags = buf(N * 4, S | CD); dev.queue.writeBuffer(B.flags, 0, p.flags);
    B.drag = buf(N * 4, S | CD); if (p.drag) dev.queue.writeBuffer(B.drag, 0, p.drag);
    B.vel = buf(3 * N * 4, S | CD | CS);
    var vplane = new Float32Array(3 * plane);
    for (z = 0; z < nz; z++) {
      for (var k = 0; k < plane; k++) { vplane[3 * k] = ux[z]; vplane[3 * k + 1] = uy[z]; vplane[3 * k + 2] = 0; }
      dev.queue.writeBuffer(B.vel, z * plane * 12, vplane);
    }
    B.mean = buf(16 * N, S | CD | CS);
    B.cnt = buf(16, S | CD);
    B.acc = buf(16, GPUBufferUsage.UNIFORM | CD);
    var lay = this.pipe.getBindGroupLayout(0), self = this;
    function bg(a, b) {
      return dev.createBindGroup({ layout: lay, entries: [
        { binding: 0, resource: { buffer: B.uni } }, { binding: 1, resource: { buffer: a } }, { binding: 2, resource: { buffer: b } },
        { binding: 3, resource: { buffer: B.flags } }, { binding: 4, resource: { buffer: B.drag } }, { binding: 5, resource: { buffer: B.vel } },
        { binding: 6, resource: { buffer: B.cnt } }] });
    }
    B.bg = [bg(B.f0, B.f1), bg(B.f1, B.f0)];
    B.bgTick = dev.createBindGroup({ layout: this.pipeTick.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: B.cnt } }] });
    B.bgAcc = dev.createBindGroup({ layout: this.pipeAcc.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: B.acc } }, { binding: 1, resource: { buffer: B.vel } }, { binding: 2, resource: { buffer: B.mean } }] });
    B.wg = [Math.ceil(nx / 8), Math.ceil(ny / 8), Math.ceil(nz / 4)];
    var ng = Math.ceil(N / 256); B.wgAcc = ng > 65535 ? [65535, Math.ceil(ng / 65535)] : [ng, 1];
    this.B = B; this.p = p; this.wx = wx; this.wy = wy;
    this.steps = 0; this.weight = 0; this.samples = 0; this.trav = 0; this.since = 0;
    // une traversée : temps pour parcourir le domaine au vent de référence
    this.travSteps = (nx * Math.abs(wx) + ny * Math.abs(wy)) / p.uref;
    this.sampleEvery = Math.max(10, Math.round(this.travSteps / 60));
    this.running = true;
    void self;
  };

  // un lot de pas (K adapté pour ~12 ms de calcul) ; la moyenne est mise à jour tous les sampleEvery pas
  Solver3D.prototype.frame = function () {
    if (!this.running || !this.B || this.inFlight) return null;
    var B = this.B, dev = this.device, self = this;
    var K = Math.max(1, Math.min(this.K, this.sampleEvery - this.since));
    var enc = dev.createCommandEncoder(), pass = enc.beginComputePass();
    for (var s = 0; s < K; s++) {
      pass.setPipeline(this.pipeTick); pass.setBindGroup(0, B.bgTick); pass.dispatchWorkgroups(1);
      pass.setPipeline(this.pipe); pass.setBindGroup(0, B.bg[B.parity]); pass.dispatchWorkgroups(B.wg[0], B.wg[1], B.wg[2]); B.parity ^= 1;
    }
    pass.end();
    this.since += K; this.steps += K;
    if (this.since >= this.sampleEvery) {
      this.trav = this.steps / this.travSteps;
      var w;
      if (this.samples === 0) w = 1;
      else if (this.trav < 2) w = 0.12;
      else { if (this.weight === 0) { w = 1; this.weight = this.since; } else { w = this.since / (this.weight + this.since); this.weight += this.since; } }
      var a = new ArrayBuffer(16); new Uint32Array(a)[0] = B.N; new Float32Array(a)[1] = w;
      dev.queue.writeBuffer(B.acc, 0, a);
      var p2 = enc.beginComputePass(); p2.setPipeline(this.pipeAcc); p2.setBindGroup(0, B.bgAcc); p2.dispatchWorkgroups(B.wgAcc[0], B.wgAcc[1]); p2.end();
      this.samples++; this.since = 0;
    }
    dev.queue.submit([enc.finish()]);
    this.inFlight = true;
    var t0 = performance.now(), Kd = K;
    return dev.queue.onSubmittedWorkDone().then(function () {
      self.inFlight = false;
      var dt = performance.now() - t0;
      // lots d'environ 25 ms : le calcul 3D prime, l'affichage reste à 30 images/s au moins
      if (Kd >= self.K) { if (dt < 20) self.K = Math.min(200, Math.ceil(self.K * 1.3)); else if (dt > 33) self.K = Math.max(1, Math.floor(self.K * 0.7)); }
    });
  };
  Solver3D.prototype.pause = function () { this.running = false; };
  Solver3D.prototype.resume = function () { this.running = true; };

  // relit la moyenne : plan horizontal z = kz (nx × ny) et plan vertical y = jy (nx × nz), vec4 par cellule
  Solver3D.prototype.readSlices = function (kz, jy) {
    var B = this.B, dev = this.device; if (!B) return Promise.resolve(null);
    var plane = B.nx * B.ny, hB = plane * 16, vB = B.nx * B.nz * 16;
    var rb = dev.createBuffer({ size: hB + vB, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    var enc = dev.createCommandEncoder();
    enc.copyBufferToBuffer(B.mean, kz * plane * 16, rb, 0, hB);
    for (var z = 0; z < B.nz; z++) enc.copyBufferToBuffer(B.mean, (z * plane + jy * B.nx) * 16, rb, hB + z * B.nx * 16, B.nx * 16);
    dev.queue.submit([enc.finish()]);
    return rb.mapAsync(GPUMapMode.READ).then(function () {
      var all = new Float32Array(rb.getMappedRange().slice(0));
      rb.unmap(); rb.destroy();
      return { h: all.subarray(0, plane * 4), v: all.subarray(plane * 4), nx: B.nx, ny: B.ny, nz: B.nz };
    });
  };
  // relit une colonne verticale (i, j) de la moyenne
  Solver3D.prototype.readColumn = function (i, j) {
    var B = this.B, dev = this.device, plane = B.nx * B.ny;
    var rb = dev.createBuffer({ size: B.nz * 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    var enc = dev.createCommandEncoder();
    for (var z = 0; z < B.nz; z++) enc.copyBufferToBuffer(B.mean, (z * plane + j * B.nx + i) * 16, rb, z * 16, 16);
    dev.queue.submit([enc.finish()]);
    return rb.mapAsync(GPUMapMode.READ).then(function () { var a = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy(); return a; });
  };
  // plans de coupe de la moyenne, extraits sur la carte : liste de [mode, indice] avec mode 0 = horizontal
  // (z = indice, nx × ny), 1 = vertical est-ouest (y = indice, nx × nz), 2 = vertical nord-sud (x = indice, ny × nz)
  // mode 3 : vertical le long d'un trait (origine ox, oy et pas sx, sy en cellules, w échantillons, plus proche cellule)
  var WGSL_SLICE = [
    'struct S { nx: u32, ny: u32, nz: u32, mode: u32, idx: u32, w: u32, h: u32, p: u32, ox: f32, oy: f32, sx: f32, sy: f32 };',
    '@group(0) @binding(0) var<uniform> Q: S;',
    '@group(0) @binding(1) var<storage, read> mean: array<vec4<f32>>;',
    '@group(0) @binding(2) var<storage, read_write> outp: array<vec4<f32>>;',
    '@compute @workgroup_size(16, 16)',
    'fn main(@builtin(global_invocation_id) gid: vec3<u32>) {',
    '  if (gid.x >= Q.w || gid.y >= Q.h) { return; }',
    '  var x = gid.x; var y = gid.y; var z = Q.idx;',
    '  if (Q.mode == 1u) { x = gid.x; y = Q.idx; z = gid.y; }',
    '  if (Q.mode == 2u) { x = Q.idx; y = gid.x; z = gid.y; }',
    '  if (Q.mode == 3u) {',
    '    let fx = clamp(round(Q.ox + Q.sx * f32(gid.x)), 0.0, f32(Q.nx - 1u));',
    '    let fy = clamp(round(Q.oy + Q.sy * f32(gid.x)), 0.0, f32(Q.ny - 1u));',
    '    x = u32(fx); y = u32(fy); z = gid.y;',
    '  }',
    '  outp[gid.x + Q.w * gid.y] = mean[x + Q.nx * (y + Q.ny * z)];',
    '}'
  ].join('\n');
  Solver3D.prototype.readPlanes = function (list) {
    var B = this.B, dev = this.device; if (!B) return Promise.resolve(null);
    if (!this.pipeSlice) this.pipeSlice = dev.createComputePipeline({ layout: 'auto', compute: { module: dev.createShaderModule({ code: WGSL_SLICE }), entryPoint: 'main' } });
    var self = this, enc = dev.createCommandEncoder(), jobs = [], tmp = [];
    list.forEach(function (it) {
      var mode = it[0], ln = it[2] || null;
      var w = mode === 3 ? ln.w : mode === 2 ? B.ny : B.nx, h = mode === 0 ? B.ny : B.nz, bytes = w * h * 16;
      var uni = dev.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      var ub = new ArrayBuffer(48), uu = new Uint32Array(ub), uf = new Float32Array(ub);
      uu.set([B.nx, B.ny, B.nz, mode, it[1] || 0, w, h, 0]);
      if (ln) { uf[8] = ln.ox; uf[9] = ln.oy; uf[10] = ln.sx; uf[11] = ln.sy; }
      dev.queue.writeBuffer(uni, 0, ub);
      var out = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
      var rb = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
      var bg = dev.createBindGroup({ layout: self.pipeSlice.getBindGroupLayout(0), entries: [
        { binding: 0, resource: { buffer: uni } }, { binding: 1, resource: { buffer: B.mean } }, { binding: 2, resource: { buffer: out } }] });
      var ps = enc.beginComputePass(); ps.setPipeline(self.pipeSlice); ps.setBindGroup(0, bg); ps.dispatchWorkgroups(Math.ceil(w / 16), Math.ceil(h / 16)); ps.end();
      enc.copyBufferToBuffer(out, 0, rb, 0, bytes);
      jobs.push({ rb: rb, w: w, h: h, mode: mode, idx: it[1] }); tmp.push(uni, out);
    });
    dev.queue.submit([enc.finish()]);
    return Promise.all(jobs.map(function (j) {
      return j.rb.mapAsync(GPUMapMode.READ).then(function () {
        var a = new Float32Array(j.rb.getMappedRange().slice(0)); j.rb.unmap(); j.rb.destroy();
        return { data: a, w: j.w, h: j.h, mode: j.mode, idx: j.idx };
      });
    })).then(function (r) { tmp.forEach(function (b) { b.destroy(); }); return r; });
  };
  // champ moyen allégé (une cellule sur s dans chaque direction) pour les lignes de courant
  var WGSL_COARSE = [
    'struct C { nx: u32, ny: u32, nz: u32, s: u32, cx: u32, cy: u32, cz: u32, p: u32 };',
    '@group(0) @binding(0) var<uniform> Q: C;',
    '@group(0) @binding(1) var<storage, read> mean: array<vec4<f32>>;',
    '@group(0) @binding(2) var<storage, read_write> outp: array<vec4<f32>>;',
    '@compute @workgroup_size(4, 4, 4)',
    'fn main(@builtin(global_invocation_id) g: vec3<u32>) {',
    '  if (g.x >= Q.cx || g.y >= Q.cy || g.z >= Q.cz) { return; }',
    '  let x = min(g.x * Q.s, Q.nx - 1u); let y = min(g.y * Q.s, Q.ny - 1u); let z = min(g.z * Q.s, Q.nz - 1u);',
    '  outp[g.x + Q.cx * (g.y + Q.cy * g.z)] = mean[x + Q.nx * (y + Q.ny * z)];',
    '}'
  ].join('\n');
  Solver3D.prototype.readCoarse = function (s) {
    var B = this.B, dev = this.device; if (!B) return Promise.resolve(null);
    if (!this.pipeCoarse) this.pipeCoarse = dev.createComputePipeline({ layout: 'auto', compute: { module: dev.createShaderModule({ code: WGSL_COARSE }), entryPoint: 'main' } });
    var cx = Math.ceil(B.nx / s), cy = Math.ceil(B.ny / s), cz = Math.ceil(B.nz / s), bytes = cx * cy * cz * 16;
    var uni = dev.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(uni, 0, new Uint32Array([B.nx, B.ny, B.nz, s, cx, cy, cz, 0]));
    var out = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    var rb = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    var bg = dev.createBindGroup({ layout: this.pipeCoarse.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: uni } }, { binding: 1, resource: { buffer: B.mean } }, { binding: 2, resource: { buffer: out } }] });
    var enc = dev.createCommandEncoder(), ps = enc.beginComputePass();
    ps.setPipeline(this.pipeCoarse); ps.setBindGroup(0, bg); ps.dispatchWorkgroups(Math.ceil(cx / 4), Math.ceil(cy / 4), Math.ceil(cz / 4)); ps.end();
    enc.copyBufferToBuffer(out, 0, rb, 0, bytes);
    dev.queue.submit([enc.finish()]);
    return rb.mapAsync(GPUMapMode.READ).then(function () {
      var a = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy(); uni.destroy(); out.destroy();
      return { data: a, cx: cx, cy: cy, cz: cz, s: s };
    });
  };
  // relecture d'un pavé du champ moyen à pleine résolution : couches k0 … k0 + nk - 1, toute l'emprise en plan
  var WGSL_BOX = [
    'struct BX { nx: u32, ny: u32, nz: u32, k0: u32, nk: u32, p0: u32, p1: u32, p2: u32 };',
    '@group(0) @binding(0) var<uniform> Q: BX;',
    '@group(0) @binding(1) var<storage, read> mean: array<vec4<f32>>;',
    '@group(0) @binding(2) var<storage, read_write> outp: array<vec4<f32>>;',
    '@compute @workgroup_size(4, 4, 4)',
    'fn main(@builtin(global_invocation_id) g: vec3<u32>) {',
    '  if (g.x >= Q.nx || g.y >= Q.ny || g.z >= Q.nk) { return; }',
    '  let z = min(g.z + Q.k0, Q.nz - 1u);',
    '  outp[g.x + Q.nx * (g.y + Q.ny * g.z)] = mean[g.x + Q.nx * (g.y + Q.ny * z)];',
    '}'
  ].join('\n');
  Solver3D.prototype.readBox = function (k0, nk) {
    var B = this.B, dev = this.device; if (!B) return Promise.resolve(null);
    k0 = Math.max(0, Math.min(B.nz - 1, k0 | 0)); nk = Math.max(1, Math.min(B.nz - k0, nk | 0));
    if (!this.pipeBox) this.pipeBox = dev.createComputePipeline({ layout: 'auto', compute: { module: dev.createShaderModule({ code: WGSL_BOX }), entryPoint: 'main' } });
    var bytes = B.nx * B.ny * nk * 16;
    var uni = dev.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    dev.queue.writeBuffer(uni, 0, new Uint32Array([B.nx, B.ny, B.nz, k0, nk, 0, 0, 0]));
    var out = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    var rb = dev.createBuffer({ size: bytes, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    var bg = dev.createBindGroup({ layout: this.pipeBox.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer: uni } }, { binding: 1, resource: { buffer: B.mean } }, { binding: 2, resource: { buffer: out } }] });
    var enc = dev.createCommandEncoder(), ps = enc.beginComputePass();
    ps.setPipeline(this.pipeBox); ps.setBindGroup(0, bg); ps.dispatchWorkgroups(Math.ceil(B.nx / 4), Math.ceil(B.ny / 4), Math.ceil(nk / 4)); ps.end();
    enc.copyBufferToBuffer(out, 0, rb, 0, bytes);
    dev.queue.submit([enc.finish()]);
    return rb.mapAsync(GPUMapMode.READ).then(function () {
      var a = new Float32Array(rb.getMappedRange().slice(0)); rb.unmap(); rb.destroy(); uni.destroy(); out.destroy();
      return { data: a, nx: B.nx, ny: B.ny, k0: k0, nk: nk };
    });
  };
  Solver3D.prototype.destroy = function () { this._free(); this.running = false; };

  CLW.Solver3D = Solver3D;
})(typeof window !== 'undefined' ? window : globalThis);
