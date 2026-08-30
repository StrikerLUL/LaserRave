// Curl Noise and Perlin Noise implementation for Pyro Worker
import { _hash } from "./utils/math.js";

function _grad(ix, iy, iz, x, y, z) {
    const h = (_hash(ix + _hash(iy + _hash(iz))) * 0.5 + 0.5) % 1.0;
    const angle = h * Math.PI * 2;
    const angle2 = (_hash(ix * 2.1 + iy * 3.7 + iz) * 0.5 + 0.5) * Math.PI;
    return (x - ix) * Math.cos(angle) * Math.sin(angle2)
         + (y - iy) * Math.sin(angle) * Math.sin(angle2)
         + (z - iz) * Math.cos(angle2);
}

function _perlin(x, y, z) {
    const X = Math.floor(x), Y = Math.floor(y), Z = Math.floor(z);
    const u = x - X, v = y - Y, w = z - Z;
    const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
    const fu = fade(u), fv = fade(v), fw = fade(w);
    const lerp = (a, b, t) => a + t * (b - a);
    return lerp(lerp(lerp(_grad(X,Y,Z,x,y,z),_grad(X+1,Y,Z,x,y,z),fu),
                     lerp(_grad(X,Y+1,Z,x,y,z),_grad(X+1,Y+1,Z,x,y,z),fu),fv),
                lerp(lerp(_grad(X,Y,Z+1,x,y,z),_grad(X+1,Y,Z+1,x,y,z),fu),
                     lerp(_grad(X,Y+1,Z+1,x,y,z),_grad(X+1,Y+1,Z+1,x,y,z),fu),fv),fw);
}

function curlNoise(x, y, z, t_offset) {
    const eps = 0.1;
    const n = (a, b, c) => _perlin(a, b, c + t_offset);
    const dFzdx  = (n(x+eps,y,z) - n(x-eps,y,z)) / (2*eps);
    const dFydz  = (n(x,y,z+eps) - n(x,y,z-eps)) / (2*eps);
    const dFxdz  = (n(x,y,z+eps) - n(x,y,z-eps)) / (2*eps);
    const dFzdz2 = (n(x,y+eps,z) - n(x,y-eps,z)) / (2*eps);
    const dFydx  = (n(x+eps,y,z) - n(x-eps,y,z)) / (2*eps);
    const dFxdy  = (n(x,y+eps,z) - n(x,y-eps,z)) / (2*eps);
    return {
        x: dFzdz2 - dFydz,
        y: dFxdz  - dFzdx,
        z: dFydx  - dFxdy
    };
}

const systems = new Map();

if (typeof self !== "undefined") self.onmessage = function(e) {
    const { type, id, config, data } = e.data;

    if (type === 'init') {
        systems.set(id, {
            // Store origin with explicit names so they don't conflict with anything
            originX: config.x,
            originY: config.y,
            originZ: config.z,
            type:    config.type,
            maxParticles: config.maxParticles,
            emitDir: config.emitDir,
            spread:  config.spread,
            px: new Float32Array(config.maxParticles),
            py: new Float32Array(config.maxParticles),
            pz: new Float32Array(config.maxParticles),
            vx: new Float32Array(config.maxParticles),
            vy: new Float32Array(config.maxParticles),
            vz: new Float32Array(config.maxParticles),
            age:      new Float32Array(config.maxParticles),
            lifetime: new Float32Array(config.maxParticles),
            size:     new Float32Array(config.maxParticles),
            cr: new Float32Array(config.maxParticles),
            cg: new Float32Array(config.maxParticles),
            cb: new Float32Array(config.maxParticles),
            alive: new Uint8Array(config.maxParticles),
            posArray: new Float32Array(config.posBuffer),
            ageArray: new Float32Array(config.ageBuffer),
            ltArray: new Float32Array(config.ltBuffer),
            sizeArray: new Float32Array(config.sizeBuffer),
            colorArray: new Float32Array(config.colorBuffer),
            _nextSpawnIndex: 0,
            emitAccum: 0,
            burstIntensity: 0
        });

    } else if (type === 'update') {
        const sys = systems.get(id);
        if (!sys) return;

        const { dt, globalT, energy, bass, mid, high, kick, windX, windY, pyroIntensity, isPeak } = data;

        // SharedArrayBuffer buffers
        let posArray   = sys.posArray;
        let ageArray   = sys.ageArray;
        let ltArray    = sys.ltArray;
        let sizeArray  = sys.sizeArray;
        let colorArray = sys.colorArray;

        // Burst triggering
        const triggerThreshold = 0.75; // Higher threshold so it's off more often
        if (isPeak || (kick > 0.85 && energy > 0.6)) {
            const targetBurst = isPeak ? 1.0 : 0.7;
            sys.burstIntensity = Math.max(sys.burstIntensity, targetBurst);
        }
        sys.burstIntensity *= Math.pow(0.85, dt * 60); // Faster decay to turn off sharply

        const turbulenceStr = 0.8 + energy * 1.5 + sys.burstIntensity * 2.0 + (mid || 0) * 2.5;
        const thermalStr    = 1.5 + energy * 2.0 + sys.burstIntensity * 5.0;

        const effectiveIntensity = sys.burstIntensity * pyroIntensity; // Only active during bursts
        
        // Emit only during active bursts
        const emitRateMultiplier = sys.burstIntensity > 0.1 ? 35.0 : 0.0;
        
        const emitRate = sys.type === 'flame'
            ? (bass * 150 + (isPeak ? 300 : 0)) * effectiveIntensity * emitRateMultiplier
            : (energy * 100 + (isPeak ? 200 : 0)) * effectiveIntensity * emitRateMultiplier;

        sys.emitAccum += emitRate * dt;
        while (sys.emitAccum >= 1) {
            let idx = -1;
            for (let i = 0; i < sys.maxParticles; i++) {
                const chk = (sys._nextSpawnIndex + i) % sys.maxParticles;
                if (!sys.alive[chk]) {
                    idx = chk;
                    sys._nextSpawnIndex = (chk + 1) % sys.maxParticles;
                    break;
                }
            }
            if (idx !== -1) {
                sys.alive[idx] = 1;
                // Use originX/Y/Z — these are the properly named fields
                sys.px[idx] = sys.originX + (Math.random() - 0.5) * 0.4;
                sys.py[idx] = sys.originY;
                sys.pz[idx] = sys.originZ + (Math.random() - 0.5) * 0.4;

                // Dynamic height (speed and lifetime scaled by burstIntensity and bass)
                const power = 0.5 + sys.burstIntensity * 1.5 + (isPeak ? 1.0 : 0);
                const spd = sys.type === 'flame'
                    ? (1.5 + Math.random() * 2.0 + bass * 8.0) * power
                    : (3.0 + Math.random() * 5.0 + energy * 6.0 + (high || 0) * 10.0) * power;

                sys.vx[idx] = sys.emitDir.x * spd + (Math.random() - 0.5) * sys.spread * spd;
                sys.vy[idx] = sys.emitDir.y * spd + (Math.random() - 0.5) * sys.spread * spd * 0.5;
                sys.vz[idx] = sys.emitDir.z * spd + (Math.random() - 0.5) * sys.spread * spd;

                sys.age[idx] = 0;
                // Lifetime scales with power to make high bursts last longer (reach higher)
                sys.lifetime[idx] = sys.type === 'flame'
                    ? (0.4 + Math.random() * 0.8) * (0.6 + power * 0.4)
                    : (0.3 + Math.random() * 0.6) * (0.6 + power * 0.4);

                sys.size[idx] = sys.type === 'flame'
                    ? (0.8 + Math.random() * 2.2) * (0.8 + sys.burstIntensity * 0.5)
                    : (0.2 + Math.random() * 0.5) * (0.8 + sys.burstIntensity * 0.5);
            }
            sys.emitAccum -= 1;
        }

        for (let i = 0; i < sys.maxParticles; i++) {
            const i3 = i * 3;
            if (!sys.alive[i]) {
                sizeArray[i] = 0;
                continue;
            }

            sys.age[i] += dt;
            if (sys.age[i] >= sys.lifetime[i]) {
                sys.alive[i] = 0;
                sizeArray[i] = 0;
                continue;
            }

            const life = 1.0 - sys.age[i] / sys.lifetime[i];
            const curl = curlNoise(sys.px[i] * 0.3, sys.py[i] * 0.3, sys.pz[i] * 0.3, globalT * 0.5);

            // Hot particles rise faster (buoyancy), cool particles (smoke) driven by wind
            const isSmoke = sys.type === 'flame' && life < 0.25;
            
            sys.vx[i] += curl.x * turbulenceStr * dt + (windX || 0) * (isSmoke ? 0.15 : 0.04) * dt;
            sys.vy[i] += curl.y * turbulenceStr * dt + thermalStr * Math.pow(life, 1.5) * dt + (windY || 0) * (isSmoke ? 0.05 : 0.02) * dt;
            sys.vz[i] += curl.z * turbulenceStr * dt;

            if (sys.type === 'spark') {
                sys.vy[i] -= 6.0 * dt; // gravity
            }

            const drag = sys.type === 'flame' ? 0.96 : 0.94;
            sys.vx[i] *= drag;
            sys.vy[i] *= drag;
            sys.vz[i] *= drag;

            sys.px[i] += sys.vx[i] * dt;
            sys.py[i] += sys.vy[i] * dt;
            sys.pz[i] += sys.vz[i] * dt;

            // Colour
            if (sys.type === 'flame') {
                if (life > 0.85) {
                    sys.cr[i] = 1.0; sys.cg[i] = 0.9; sys.cb[i] = 1.0;      // bluish/white core
                } else if (life > 0.6) {
                    const r = (life - 0.6) / 0.25;
                    sys.cr[i] = 1.0; sys.cg[i] = 0.7 + r * 0.2; sys.cb[i] = r * 0.8; // intense yellow
                } else if (life > 0.35) {
                    const r = (life - 0.35) / 0.25;
                    sys.cr[i] = 1.0; sys.cg[i] = 0.2 + r * 0.5; sys.cb[i] = 0.0;     // orange
                } else if (life > 0.2) {
                    const r = (life - 0.2) / 0.15;
                    sys.cr[i] = 0.4 + r * 0.6; sys.cg[i] = r * 0.2; sys.cb[i] = 0.0; // dark red ember
                } else {
                    const r = life / 0.2;
                    sys.cr[i] = r * 0.15; sys.cg[i] = r * 0.15; sys.cb[i] = r * 0.15; // black/dark smoke
                }
            } else {
                sys.cr[i] = 1.0;
                sys.cg[i] = 0.6 + life * 0.4;
                sys.cb[i] = life * 0.3;
            }

            posArray[i3]     = sys.px[i];
            posArray[i3 + 1] = sys.py[i];
            posArray[i3 + 2] = sys.pz[i];
            ageArray[i]      = sys.age[i];
            ltArray[i]       = sys.lifetime[i];
            // Expand size for smoke
            sizeArray[i]     = (sys.type === 'flame' && life < 0.2) ? sys.size[i] * (0.2 + (0.2 - life) * 1.5) : sys.size[i] * life;
            colorArray[i3]     = sys.cr[i];
            colorArray[i3 + 1] = sys.cg[i];
            colorArray[i3 + 2] = sys.cb[i];
        }

        self.postMessage({
            type: 'updated',
            id,
            burstIntensity: sys.burstIntensity
        });

    } else if (type === 'dispose') {
        systems.delete(id);
    }
};
