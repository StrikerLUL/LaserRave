// Curl Noise and Perlin Noise implementation for Pyro Worker
function _hash(n) { return Math.sin(n) * 43758.5453123; }
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
    const dFzdx = (n(x+eps,y,z) - n(x-eps,y,z)) / (2*eps);
    const dFydz = (n(x,y,z+eps) - n(x,y,z-eps)) / (2*eps);
    const dFxdz = (n(x,y,z+eps) - n(x,y,z-eps)) / (2*eps);
    const dFzdz2= (n(x,y+eps,z) - n(x,y-eps,z)) / (2*eps);
    const dFydx = (n(x+eps,y,z) - n(x-eps,y,z)) / (2*eps);
    const dFxdy = (n(x,y+eps,z) - n(x,y-eps,z)) / (2*eps);
    return {
        x: dFzdz2 - dFydz,
        y: dFxdz  - dFzdx,
        z: dFydx  - dFxdy
    };
}

const systems = new Map();

self.onmessage = function(e) {
    const { type, id, config, data } = e.data;

    if (type === 'init') {
        systems.set(id, {
            ...config,
            px: new Float32Array(config.maxParticles),
            py: new Float32Array(config.maxParticles),
            pz: new Float32Array(config.maxParticles),
            vx: new Float32Array(config.maxParticles),
            vy: new Float32Array(config.maxParticles),
            vz: new Float32Array(config.maxParticles),
            age: new Float32Array(config.maxParticles),
            lifetime: new Float32Array(config.maxParticles),
            size: new Float32Array(config.maxParticles),
            cr: new Float32Array(config.maxParticles),
            cg: new Float32Array(config.maxParticles),
            cb: new Float32Array(config.maxParticles),
            alive: new Uint8Array(config.maxParticles),
            _nextSpawnIndex: 0,
            emitAccum: 0,
            burstIntensity: 0
        });
    } else if (type === 'update') {
        const sys = systems.get(id);
        if (!sys) return;

        const { dt, globalT, energy, bass, kick, windX, windY, pyroIntensity, isPeak } = data;

        // Use transferred buffers
        const posArray = data.posArray;
        const ageArray = data.ageArray;
        const ltArray = data.ltArray;
        const sizeArray = data.sizeArray;
        const colorArray = data.colorArray;

        // Burst triggering logic
        const triggerThreshold = 0.65;
        if (isPeak || energy > triggerThreshold || kick > 0.8) {
            const targetBurst = isPeak ? 1.0 : (energy > triggerThreshold ? 0.7 : 0.4);
            sys.burstIntensity = Math.max(sys.burstIntensity, targetBurst);
        }
        sys.burstIntensity *= Math.pow(0.94, dt * 60);

        const turbulenceStr = 0.8 + energy * 1.5 + sys.burstIntensity * 2.0;
        const thermalStr    = 1.2 + energy * 2.0 + sys.burstIntensity * 3.0;

        const effectiveIntensity = Math.max(sys.burstIntensity, energy * 0.5) * pyroIntensity;
        const emitRateMultiplier = 25.0;
        const emitRate = sys.type === 'flame'
            ? (bass * 150 + (isPeak ? 200 : 0)) * effectiveIntensity * emitRateMultiplier
            : (energy * 100 + (isPeak ? 150 : 0)) * effectiveIntensity * emitRateMultiplier;

        sys.emitAccum += emitRate * dt;
        while (sys.emitAccum >= 1) {
            // _spawnOne logic
            let idx = -1;
            for (let i = 0; i < sys.maxParticles; i++) {
                let chk = (sys._nextSpawnIndex + i) % sys.maxParticles;
                if (!sys.alive[chk]) {
                    idx = chk;
                    sys._nextSpawnIndex = (chk + 1) % sys.maxParticles;
                    break;
                }
            }
            if (idx !== -1) {
                sys.alive[idx] = 1;
                sys.px[idx] = sys.originX + (Math.random() - 0.5) * 0.4;
                sys.py[idx] = sys.originY;
                sys.pz[idx] = sys.originZ + (Math.random() - 0.5) * 0.4;

                const power = 0.5 + sys.burstIntensity * 0.5 + (isPeak ? 0.5 : 0);
                const spd = sys.type === 'flame'
                    ? (1.5 + Math.random() * 2.0 + bass * 5.0) * power
                    : (3.0 + Math.random() * 5.0 + energy * 8.0) * power;

                sys.vx[idx] = (sys.emitDir.x * spd + (Math.random() - 0.5) * sys.spread * spd);
                sys.vy[idx] = (sys.emitDir.y * spd + (Math.random() - 0.5) * sys.spread * spd * 0.5);
                sys.vz[idx] = (sys.emitDir.z * spd + (Math.random() - 0.5) * sys.spread * spd);

                sys.age[idx] = 0;
                sys.lifetime[idx] = sys.type === 'flame'
                    ? (0.6 + Math.random() * 1.2) * (0.8 + power * 0.4)
                    : (0.3 + Math.random() * 0.7) * (0.8 + power * 0.4);

                sys.size[idx] = sys.type === 'flame'
                    ? (0.6 + Math.random() * 1.5) * power
                    : (0.2 + Math.random() * 0.4) * power;
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
            const nx = sys.px[i] * 0.3, ny = sys.py[i] * 0.3, nz = sys.pz[i] * 0.3;
            const curl = curlNoise(nx, ny, nz, globalT * 0.5);

            sys.vx[i] += curl.x * turbulenceStr * dt + windX * 0.04 * dt;
            sys.vy[i] += curl.y * turbulenceStr * dt + thermalStr * life * dt + windY * 0.02 * dt;
            sys.vz[i] += curl.z * turbulenceStr * dt;

            if (sys.type === 'spark') {
                sys.vy[i] -= 6.0 * dt;
            }

            const drag = sys.type === 'flame' ? 0.96 : 0.94;
            sys.vx[i] *= drag; sys.vy[i] *= drag; sys.vz[i] *= drag;

            sys.px[i] += sys.vx[i] * dt;
            sys.py[i] += sys.vy[i] * dt;
            sys.pz[i] += sys.vz[i] * dt;

            if (sys.type === 'flame') {
                if (life > 0.75) {
                    sys.cr[i] = 1.0; sys.cg[i] = 1.0; sys.cb[i] = 0.8;
                } else if (life > 0.5) {
                    const lRel = (life - 0.5) / 0.25;
                    sys.cr[i] = 1.0; sys.cg[i] = 0.5 + lRel * 0.5; sys.cb[i] = lRel * 0.8;
                } else if (life > 0.25) {
                    const lRel = (life - 0.25) / 0.25;
                    sys.cr[i] = 1.0; sys.cg[i] = 0.1 + lRel * 0.4; sys.cb[i] = 0.0;
                } else {
                    const lRel = life / 0.25;
                    sys.cr[i] = 0.3 + lRel * 0.7; sys.cg[i] = 0.0; sys.cb[i] = 0.0;
                }
            } else {
                sys.cr[i] = 1.0;
                sys.cg[i] = 0.6 + life * 0.4;
                sys.cb[i] = life * 0.3;
            }

            posArray[i3]   = sys.px[i];
            posArray[i3+1] = sys.py[i];
            posArray[i3+2] = sys.pz[i];
            ageArray[i]    = sys.age[i];
            ltArray[i]     = sys.lifetime[i];
            sizeArray[i]   = sys.size[i] * life;
            colorArray[i3]  = sys.cr[i];
            colorArray[i3+1]= sys.cg[i];
            colorArray[i3+2]= sys.cb[i];
        }

        self.postMessage({
            type: 'updated',
            id: id,
            posArray,
            ageArray,
            ltArray,
            sizeArray,
            colorArray
        }, [posArray.buffer, ageArray.buffer, ltArray.buffer, sizeArray.buffer, colorArray.buffer]);
    } else if (type === 'dispose') {
        systems.delete(id);
    }
};
