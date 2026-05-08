// Returns [{x, y, z, baseYaw, zone, wallNorm}] — one entry per laser slot.
// baseYaw = base Y-rotation so the beam faces the dance floor regardless of position.
// zone    = which part of the stage ('front'|'side-left'|'side-right'|'corner'|'diagonal')
// wallNorm= normalized position [0..1] along the fixture's own truss/wall row → used for wave/chase patterns
export function computeFormationPositions(count, formation) {
    const slots = [];

    // helpers
    const spread = (n, xMin, xMax) => {
        if (n <= 0) return [];
        return n > 1 ? Array.from({length: n}, (_, i) => xMin + i * (xMax - xMin) / (n - 1)) : [0];
    };
    const zSpread = (n, zMin, zMax) => {
        if (n <= 0) return [];
        return n > 1 ? Array.from({length: n}, (_, i) => zMin + i * (zMax - zMin) / (n - 1)) : [(zMin + zMax) / 2];
    };

    switch (formation) {

        case 'twin': {
            // Two clean parallel front trusses
            const half = Math.floor(count / 2), rem = count - half;
            spread(half, -56, 56).forEach((x, i) =>
                slots.push({ x, y: 17, z: -26, baseYaw: 0, zone: 'front', wallNorm: i / Math.max(half - 1, 1) }));
            spread(rem,  -56, 56).forEach((x, i) =>
                slots.push({ x, y: 11, z: -19, baseYaw: 0, zone: 'front', wallNorm: i / Math.max(rem - 1, 1) }));
            break;
        }

        case 'sides': {
            // Lasers mounted on left & right walls, beams shooting INWARD across the dance floor
            const half = Math.floor(count / 2), rem = count - half;
            const sideRows = [8, 13, 18];
            const genSide = (n, xPos, yaw, zone) => {
                const perRow2 = Math.ceil(n / sideRows.length);
                for (let i = 0; i < n; i++) {
                    const ri  = Math.min(Math.floor(i / perRow2), sideRows.length - 1);
                    const col = i % perRow2;
                    const wn  = col / Math.max(perRow2 - 1, 1);
                    const z   = -30 + wn * 32; // z: back-of-stage to audience area
                    slots.push({ x: xPos, y: sideRows[ri], z, baseYaw: yaw, zone, wallNorm: wn });
                }
            };
            genSide(half, -63,  Math.PI / 2, 'side-left');   // left wall → beams fire right (+X)
            genSide(rem,   63, -Math.PI / 2, 'side-right');   // right wall → beams fire left (−X)
            break;
        }

        case 'surround': {
            // Front rows (55%) + side walls (45%)
            const nFront = Math.round(count * 0.55), nSides = count - nFront;
            const rows = [{ y: 16.5, z: -25 }, { y: 11, z: -19 }];
            const perRow2 = Math.ceil(nFront / rows.length);
            for (let i = 0; i < nFront; i++) {
                const row = rows[Math.min(Math.floor(i / perRow2), rows.length - 1)];
                const col = i % perRow2, wn = col / Math.max(perRow2 - 1, 1);
                slots.push({ x: -56 + wn * 112, y: row.y, z: row.z, baseYaw: 0, zone: 'front', wallNorm: wn });
            }
            const sPerSide = Math.floor(nSides / 2), sideRows = [9, 14];
            const genS = (n, xPos, yaw, zone) => {
                const psr = Math.ceil(n / sideRows.length);
                for (let i = 0; i < n; i++) {
                    const ri = Math.min(Math.floor(i / psr), sideRows.length - 1);
                    const col = i % psr, wn = col / Math.max(psr - 1, 1);
                    slots.push({ x: xPos, y: sideRows[ri], z: -28 + wn * 30, baseYaw: yaw, zone, wallNorm: wn });
                }
            };
            genS(sPerSide,       -63,  Math.PI / 2, 'side-left');
            genS(nSides - sPerSide, 63, -Math.PI / 2, 'side-right');
            break;
        }

        case 'corners': {
            // 4 corner towers, each pointing at center-stage
            const corners = [
                { x: -58, z: -30, zone: 'corner' }, { x:  58, z: -30, zone: 'corner' },
                { x: -58, z:   4, zone: 'corner' }, { x:  58, z:   4, zone: 'corner' },
            ];
            const perC = Math.floor(count / corners.length);
            corners.forEach((c, ci) => {
                const n = ci < corners.length - 1 ? perC : count - ci * perC;
                const yaw = Math.atan2(-c.x, -c.z - 13); // aim toward (0,−,−13)
                for (let j = 0; j < n; j++) {
                    const wn = j / Math.max(n - 1, 1);
                    slots.push({ x: c.x, y: 8 + wn * 10, z: c.z, baseYaw: yaw, zone: c.zone, wallNorm: wn });
                }
            });
            break;
        }

        case 'aerial': {
            // Multi-angle: front 35% + sides 40% + diagonal back-sides 25%
            const nF = Math.round(count * 0.35), nS = Math.round(count * 0.40), nD = count - nF - nS;
            const aerRows = [{ y: 17, z: -26 }, { y: 11, z: -19 }];
            const pFR = Math.ceil(nF / aerRows.length);
            for (let i = 0; i < nF; i++) {
                const row = aerRows[Math.min(Math.floor(i / pFR), aerRows.length - 1)];
                const col = i % pFR, wn = col / Math.max(pFR - 1, 1);
                slots.push({ x: -55 + wn * 110, y: row.y, z: row.z, baseYaw: 0, zone: 'front', wallNorm: wn });
            }
            const pSide = Math.floor(nS / 2);
            zSpread(pSide, -28, 4).forEach((z, i) => slots.push({ x: -63, y: 9 + (i % 3) * 4.5, z, baseYaw: Math.PI / 2 - 0.2, zone: 'side-left', wallNorm: i / Math.max(pSide - 1, 1) }));
            zSpread(nS - pSide, -28, 4).forEach((z, i) => slots.push({ x: 63, y: 9 + (i % 3) * 4.5, z, baseYaw: -(Math.PI / 2 - 0.2), zone: 'side-right', wallNorm: i / Math.max(nS - pSide - 1, 1) }));
            for (let i = 0; i < nD; i++) {
                const side = i % 2 === 0 ? -1 : 1;
                const x = side * (38 + Math.floor(i / 2) * 7);
                slots.push({ x, y: 18, z: -28, baseYaw: Math.atan2(-x * 0.7, 13), zone: 'diagonal', wallNorm: i / Math.max(nD - 1, 1) });
            }
            break;
        }

        case 'front': default: {
            // 4 front trusses spanning full stage width
            const rows = [{ y: 18, z: -28 }, { y: 14, z: -24 }, { y: 11, z: -20 }, { y: 7.5, z: -16 }];
            const perRow2 = Math.ceil(count / rows.length);
            for (let i = 0; i < count; i++) {
                const row = rows[Math.min(Math.floor(i / perRow2), rows.length - 1)];
                const col = i % perRow2, wn = col / Math.max(perRow2 - 1, 1);
                slots.push({ x: -58 + wn * 116, y: row.y, z: row.z, baseYaw: 0, zone: 'front', wallNorm: wn });
            }
            break;
        }

        case 'dancefloor': {
            // ── Tanzflächen-Ring: lasers mounted on all 4 sides of the dance floor,
            //    each aiming INWARD toward the centre of the crowd area.
            //    The dance floor is roughly 80m wide × 40m deep, centred at (0, 0, -5).
            // ──────────────────────────────────────────────────────────────────────────
            const dfCX = 0, dfCZ = -5;          // dance-floor centre
            const dfW = 80, dfD = 40;            // dance-floor width × depth
            const dfY = [5, 9, 13];              // 3 height levels of fixture rails

            // Distribute count across 4 sides proportionally to side length
            const perimeter = 2 * (dfW + dfD);
            const nFront = Math.round(count * dfW / perimeter);
            const nBack  = Math.round(count * dfW / perimeter);
            const nLeft  = Math.round(count * dfD / perimeter);
            const nRight = count - nFront - nBack - nLeft;

            const addSide = (n, side) => {
                const perLevel = Math.ceil(n / dfY.length);
                for (let i = 0; i < n; i++) {
                    const yi = Math.min(Math.floor(i / perLevel), dfY.length - 1);
                    const col = i % perLevel;
                    const wn  = perLevel > 1 ? col / (perLevel - 1) : 0.5;
                    let x, z, baseYaw;
                    if (side === 'front') {
                        // South edge – beams point north (toward stage −Z)
                        x = dfCX - dfW / 2 + wn * dfW;
                        z = dfCZ + dfD / 2 + 2;   // just outside front of dancefloor
                        baseYaw = Math.PI;          // face north (-Z)
                    } else if (side === 'back') {
                        // North edge (behind stage) – beams point south (+Z, toward crowd)
                        x = dfCX - dfW / 2 + wn * dfW;
                        z = dfCZ - dfD / 2 - 2;
                        baseYaw = 0;                // face south (+Z)
                    } else if (side === 'left') {
                        // West edge – beams point east (+X)
                        x = dfCX - dfW / 2 - 2;
                        z = dfCZ - dfD / 2 + wn * dfD;
                        baseYaw = -Math.PI / 2;     // face right (+X)
                    } else {
                        // East edge – beams point west (−X)
                        x = dfCX + dfW / 2 + 2;
                        z = dfCZ - dfD / 2 + wn * dfD;
                        baseYaw = Math.PI / 2;      // face left (−X)
                    }
                    const y = dfY[yi];
                    slots.push({ x, y, z, baseYaw, zone: `side-${side}`, wallNorm: wn });
                }
            };
            addSide(nFront, 'front');
            addSide(nBack,  'back');
            addSide(nLeft,  'left');
            addSide(nRight, 'right');
            break;
        }
    } // end switch
    // Pad if formation returned fewer slots than count (shouldn't happen, but safety)
    while (slots.length < count) {
        if (slots.length > 0) {
            slots.push({ ...slots[slots.length - 1] });
        } else {
            slots.push({ x: 0, y: 0, z: 0, baseYaw: 0, zone: 'front', wallNorm: 0 });
        }
    }
    return slots;
}
