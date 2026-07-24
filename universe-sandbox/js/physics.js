// N-body gravity simulation, decoupled from rendering.
// Integrator: velocity Verlet (kick-drift-kick / leapfrog), which conserves
// orbital energy far better than Euler over long runs.
//
// This module is intentionally renderer-agnostic and self-contained so it can
// later be moved verbatim into a Web Worker, or have computeAccelerations()
// swapped for a Barnes-Hut / WebGPU implementation once N grows large.

// Gaussian gravitational constant squared: k = 0.01720209895
// G = k^2  [ AU^3 / (Msun * day^2) ]
export const G = 2.959122082855911e-4;

export class Simulation {
  /**
   * @param {Array<{massSun:number, pos:[number,number,number], vel:[number,number,number]}>} bodies
   * @param {number} softening  Plummer softening length in AU (avoids 1/r^2 blow-ups).
   */
  constructor(bodies, softening = 1e-3) {
    this.n = bodies.length;
    this.soft2 = softening * softening;
    this.mass = new Float64Array(this.n);
    this.pos = new Float64Array(this.n * 3);
    this.vel = new Float64Array(this.n * 3);
    this.acc = new Float64Array(this.n * 3);

    bodies.forEach((b, i) => {
      this.mass[i] = b.massSun;
      this.pos[3 * i] = b.pos[0];
      this.pos[3 * i + 1] = b.pos[1];
      this.pos[3 * i + 2] = b.pos[2];
      this.vel[3 * i] = b.vel[0];
      this.vel[3 * i + 1] = b.vel[1];
      this.vel[3 * i + 2] = b.vel[2];
    });

    this._computeAccelerations(this.acc);
  }

  // Direct-summation gravity: O(N^2). Fine for N up to a few hundred.
  // Swap this method for a Barnes-Hut tree to reach O(N log N).
  _computeAccelerations(out) {
    const { n, pos, mass, soft2 } = this;
    out.fill(0);
    for (let i = 0; i < n; i++) {
      const ix = 3 * i, iy = ix + 1, iz = ix + 2;
      const xi = pos[ix], yi = pos[iy], zi = pos[iz];
      let ax = 0, ay = 0, az = 0;
      for (let j = 0; j < n; j++) {
        if (j === i) continue;
        const jx = 3 * j;
        const dx = pos[jx] - xi;
        const dy = pos[jx + 1] - yi;
        const dz = pos[jx + 2] - zi;
        const r2 = dx * dx + dy * dy + dz * dz + soft2;
        const invR = 1 / Math.sqrt(r2);
        const f = G * mass[j] * invR * invR * invR; // G*m_j / r^3
        ax += f * dx;
        ay += f * dy;
        az += f * dz;
      }
      out[ix] = ax;
      out[iy] = ay;
      out[iz] = az;
    }
  }

  // One velocity-Verlet step of size h (days).
  step(h) {
    const { n, pos, vel, acc } = this;
    const half = 0.5 * h;
    // Half-kick + drift.
    for (let k = 0; k < n * 3; k++) {
      vel[k] += acc[k] * half;
      pos[k] += vel[k] * h;
    }
    // Recompute acceleration at new positions.
    this._computeAccelerations(acc);
    // Final half-kick.
    for (let k = 0; k < n * 3; k++) {
      vel[k] += acc[k] * half;
    }
  }

  // Advance the simulation by `simDays`, sub-stepping at fixed size `h` so the
  // physics stays stable regardless of frame rate or time scale.
  advance(simDays, h = 1.0, maxSub = 400) {
    if (simDays <= 0) return;
    let steps = Math.ceil(simDays / h);
    if (steps > maxSub) steps = maxSub;     // clamp to avoid the spiral of death
    const hh = simDays / steps;
    for (let s = 0; s < steps; s++) this.step(hh);
  }

  // Append a body at runtime, growing the typed arrays.
  addBody(b) {
    const n = this.n + 1;
    const mass = new Float64Array(n);
    const pos = new Float64Array(n * 3);
    const vel = new Float64Array(n * 3);
    mass.set(this.mass); pos.set(this.pos); vel.set(this.vel);
    const o = this.n * 3;
    mass[this.n] = b.massSun;
    pos[o] = b.pos[0]; pos[o + 1] = b.pos[1]; pos[o + 2] = b.pos[2];
    vel[o] = b.vel[0]; vel[o + 1] = b.vel[1]; vel[o + 2] = b.vel[2];
    this.mass = mass; this.pos = pos; this.vel = vel; this.acc = new Float64Array(n * 3);
    this.n = n;
    this._computeAccelerations(this.acc);
    return this.n - 1;
  }

  // Remove body `idx`, compacting the typed arrays (order preserved).
  removeBody(idx) {
    const n = this.n - 1;
    const mass = new Float64Array(n);
    const pos = new Float64Array(n * 3);
    const vel = new Float64Array(n * 3);
    let w = 0;
    for (let r = 0; r < this.n; r++) {
      if (r === idx) continue;
      mass[w] = this.mass[r];
      pos[3 * w] = this.pos[3 * r]; pos[3 * w + 1] = this.pos[3 * r + 1]; pos[3 * w + 2] = this.pos[3 * r + 2];
      vel[3 * w] = this.vel[3 * r]; vel[3 * w + 1] = this.vel[3 * r + 1]; vel[3 * w + 2] = this.vel[3 * r + 2];
      w++;
    }
    this.mass = mass; this.pos = pos; this.vel = vel; this.acc = new Float64Array(n * 3);
    this.n = n;
    this._computeAccelerations(this.acc);
  }

  // Deep copy of the dynamical state — used to integrate a throwaway future
  // for orbit prediction without disturbing the live simulation.
  clone() {
    const c = Object.create(Simulation.prototype);
    c.n = this.n;
    c.soft2 = this.soft2;
    c.mass = this.mass.slice();
    c.pos = this.pos.slice();
    c.vel = this.vel.slice();
    c.acc = this.acc.slice();
    return c;
  }

  // Total mechanical energy — used as a sanity/drift check (should stay ~const).
  totalEnergy() {
    const { n, pos, vel, mass, soft2 } = this;
    let ke = 0, pe = 0;
    for (let i = 0; i < n; i++) {
      const ix = 3 * i;
      const vx = vel[ix], vy = vel[ix + 1], vz = vel[ix + 2];
      ke += 0.5 * mass[i] * (vx * vx + vy * vy + vz * vz);
      for (let j = i + 1; j < n; j++) {
        const jx = 3 * j;
        const dx = pos[jx] - pos[ix];
        const dy = pos[jx + 1] - pos[ix + 1];
        const dz = pos[jx + 2] - pos[ix + 2];
        const r = Math.sqrt(dx * dx + dy * dy + dz * dz + soft2);
        pe -= G * mass[i] * mass[j] / r;
      }
    }
    return ke + pe;
  }
}
