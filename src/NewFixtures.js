import * as THREE from 'three';

export class FixtureManager {
    constructor(scene, CFG) {
        this.scene = scene;
        this.CFG = CFG;

        this.ledBarObjects = [];
        this.strobeBlinderObjects = [];
        this.kineticLightObjects = [];
        this.pixelTubeObjects = [];

        this.ledBarsEnabled = true;
        this.strobeBlindersEnabled = true;
        this.kineticLightsEnabled = true;
        this.pixelTubesEnabled = true;
    }

    initAll() {
        this.initLedBars();
        this.initStrobeBlinders();
        this.initKineticLights();
        this.initPixelTubes();
    }

    initLedBars() {
        this.ledBarObjects.forEach(lb => this.scene.remove(lb.group));
        this.ledBarObjects.length = 0;

        const count = 8;
        const geo = new THREE.BoxGeometry(4, 0.4, 0.4);
        for (let i=0; i<count; i++) {
            const x = -28 + (i/(count-1))*56;
            const group = new THREE.Group();
            group.position.set(x, 10, -5);
            
            const mat = new THREE.MeshStandardMaterial({color: 0x000000, emissive: 0x000000, roughness: 0.2});
            const mesh = new THREE.Mesh(geo, mat);
            group.add(mesh);
            
            const beamGeo = new THREE.PlaneGeometry(4, 30);
            beamGeo.translate(0, -15, 0); 
            const beamMat = new THREE.MeshBasicMaterial({
                color: 0xffffff, transparent: true, opacity: 0.15, 
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
            });
            const beamMesh = new THREE.Mesh(beamGeo, beamMat);
            group.add(beamMesh);

            this.scene.add(group);
            this.ledBarObjects.push({ group, mat, beamMat, startX: x });
        }
    }

    initStrobeBlinders() {
        this.strobeBlinderObjects.forEach(sb => this.scene.remove(sb.mesh));
        this.strobeBlinderObjects.length = 0;

        const count = 4;
        const geo = new THREE.BoxGeometry(4.0, 2.0, 0.5);
        for (let i=0; i<count; i++) {
            const x = -18 + (i/(count-1))*36;
            const mat = new THREE.MeshStandardMaterial({color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.1});
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, 7, -6);
            
            // Real light source to illuminate stage
            const light = new THREE.PointLight(0xffffff, 0, 150, 1.5);
            mesh.add(light);
            
            // Fake glare/flare plane
            const glareGeo = new THREE.PlaneGeometry(35, 35);
            const glareMat = new THREE.MeshBasicMaterial({
                color: 0xffffff, transparent: true, opacity: 0.0, 
                blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide
            });
            const glareMesh = new THREE.Mesh(glareGeo, glareMat);
            glareMesh.position.z = 1;
            mesh.add(glareMesh);

            this.scene.add(mesh);
            this.strobeBlinderObjects.push({ mesh, mat, light, glareMat });
        }
    }

    initKineticLights() {
        this.kineticLightObjects.forEach(kl => this.scene.remove(kl.mesh));
        this.kineticLightObjects.length = 0;

        const count = 20;
        const geo = new THREE.SphereGeometry(0.8, 16, 16);
        for(let i=0; i<count; i++) {
            const x = -25 + (i/(count-1))*50;
            // Spread z from -10 to 10
            const z = -10 + (Math.random() * 20);
            const mat = new THREE.MeshStandardMaterial({color: 0x000000, emissive: 0x000000});
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, 15, z);
            this.scene.add(mesh);
            this.kineticLightObjects.push({ mesh, mat, baseX: x, baseZ: z, startOffset: i * 0.4 });
        }
    }

    initPixelTubes() {
        this.pixelTubeObjects.forEach(pt => this.scene.remove(pt.mesh));
        this.pixelTubeObjects.length = 0;

        const count = 10;
        const geo = new THREE.CylinderGeometry(0.08, 0.08, 3.5, 8);
        for (let i=0; i<count; i++) {
            const angle = (i/(count-1)) * Math.PI; 
            const radius = 6;
            const x = Math.cos(angle) * radius;
            const z = -20 + Math.sin(angle) * radius * 0.5;
            const mat = new THREE.MeshBasicMaterial({color: 0x000000});
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, 1.75, z);
            this.scene.add(mesh);
            this.pixelTubeObjects.push({ mesh, mat, index: i });
        }
    }

    update(state) {
        const { t, energy, bass, kick, isSilent, isPeakDrop, buildUp, secPat, beatState, hasVideoColor, videoBaseHue, sectionLaserHues, playing, hueToHex } = state;
        const globalCols = this.CFG.themes[this.CFG.theme] || [0xffffff];

        if (this.ledBarObjects.length > 0) {
            const elToggle = document.getElementById('param-ledbars');
            const isEnabled = elToggle ? elToggle.checked : true;
            
            const phase = Math.floor(t / 5) % 3; // Switch animation modes every 5 seconds
            
            this.ledBarObjects.forEach((lb, i) => {
                lb.group.visible = isEnabled;
                if (!isEnabled) return;
                
                // Complex rotation logic
                let targetRotX = 0;
                let targetRotY = 0;
                
                if (phase === 0) {
                    targetRotX = Math.sin(t * 2.0) * (energy * 2.0); // Sweep together
                } else if (phase === 1) {
                    targetRotX = Math.sin(t * 4.0 + i * 0.5) * (energy * 2.5); // Wave pattern
                } else {
                    targetRotX = Math.sin(t * 1.5 + i) * energy; // Chaos
                    if (kick > 0.8) targetRotX += (Math.random() - 0.5) * 2.5; // Snap on kicks
                }
                
                targetRotY = Math.sin(t * 1.0 + i * 0.2) * 0.4; // Pan
                
                // Smooth interpolation for snappy but fluid movement
                lb.group.rotation.x += (targetRotX - lb.group.rotation.x) * 0.15;
                lb.group.rotation.y += (targetRotY - lb.group.rotation.y) * 0.1;

                // Chase effect
                const chase = (t * 12 + i) % this.ledBarObjects.length;
                const isChase = Math.abs(chase - this.ledBarObjects.length / 2) < 1.5;

                let intensity = playing ? (energy * 2.0 + bass * 1.5) : 0;
                if (isChase && playing) intensity += 2.5;
                if (isSilent) intensity = 0;
                if (beatState.isBeat && energy > 0.4) intensity += 3.0; // Flash heavily on beat
                
                let hHex = globalCols[i % globalCols.length];
                if (this.CFG.theme === 'dynamic') {
                    const hueOffset = (kick > 0.7) ? (Math.random() * 40) : 0; // Jump color on kick
                    const bh = ((hasVideoColor && videoBaseHue !== null ? videoBaseHue : (sectionLaserHues && sectionLaserHues[0] ? sectionLaserHues[0] : 0)) + t*20 + i*30 + hueOffset) % 360;
                    if(hueToHex) hHex = hueToHex(bh, 0.95, 0.5);
                }
                
                lb.mat.color.setHex(hHex);
                lb.mat.emissive.setHex(hHex);
                lb.mat.emissiveIntensity = intensity * 3.0;
                lb.beamMat.color.setHex(hHex);
                lb.beamMat.opacity = intensity * 0.3;
                
                if (playing && secPat === 'strobe' && !beatState.strobeOn) {
                     lb.mat.emissiveIntensity = 0;
                     lb.beamMat.opacity = 0;
                }
            });
        }

        if (this.strobeBlinderObjects.length > 0) {
            const elToggle = document.getElementById('param-strobes');
            const isEnabled = elToggle ? elToggle.checked : true;
            const elSlider = document.getElementById('param-strobe-intensity');
            const strobeMax = elSlider ? parseInt(elSlider.value) : 50;
            
            this.strobeBlinderObjects.forEach((sb) => {
                sb.mesh.visible = isEnabled;
                if (!isEnabled) return;

                let intensity = 0;
                if (playing && isPeakDrop) {
                    intensity = Math.random() > 0.3 ? strobeMax : 0.0;
                } else if (playing && buildUp > 0.7) {
                    intensity = Math.random() > (1.1 - buildUp) ? (strobeMax * 0.5) : 0.0;
                } else if (playing && secPat === 'strobe' && beatState.strobeOn) {
                    intensity = strobeMax * 0.8;
                }
                sb.mat.emissiveIntensity = intensity;
                sb.light.intensity = intensity * 20.0; // Massively lights up the whole stage
                sb.glareMat.opacity = intensity > 0 ? (intensity / strobeMax * 0.9) : 0; // Creates a huge flare on camera
            });
        }

        if (this.kineticLightObjects.length > 0) {
            const elToggle = document.getElementById('param-kinetics');
            const isEnabled = elToggle ? elToggle.checked : true;

            this.kineticLightObjects.forEach((kl, i) => {
                kl.mesh.visible = isEnabled;
                if (!isEnabled) return;

                const yOffset = Math.sin(t * 1.5 + kl.startOffset) * 4.0;
                kl.mesh.position.y = 12 + yOffset - (kick * 2.0); 
                
                let intensity = playing ? (energy * 1.5 + 0.5) : 0.5;
                if (isSilent) intensity = 0;
                
                let hHex = globalCols[(i+1) % globalCols.length];
                if (this.CFG.theme === 'dynamic') {
                    const bh = ((hasVideoColor && videoBaseHue !== null ? videoBaseHue : (sectionLaserHues && sectionLaserHues[0] ? sectionLaserHues[0] : 0)) + t*8 + i*25) % 360;
                    if(hueToHex) hHex = hueToHex(bh, 0.95, 0.5);
                }

                kl.mat.color.setHex(hHex);
                kl.mat.emissive.setHex(hHex);
                kl.mat.emissiveIntensity = intensity * 3.0;
            });
        }

        if (this.pixelTubeObjects.length > 0) {
            const elToggle = document.getElementById('param-pixeltubes');
            const isEnabled = elToggle ? elToggle.checked : true;

            this.pixelTubeObjects.forEach((pt, i) => {
                pt.mesh.visible = isEnabled;
                if (!isEnabled) return;

                const chase = (t * 12 + pt.index) % this.pixelTubeObjects.length;
                const distance = Math.abs(chase - (this.pixelTubeObjects.length / 2));
                
                let intensity = playing ? (1.0 - distance * 0.2) : 0;
                intensity = Math.max(0, intensity) + (bass * 0.8);
                if (isSilent) intensity = 0;

                let hHex = globalCols[i % globalCols.length];
                if (this.CFG.theme === 'dynamic') {
                    const bh = ((hasVideoColor && videoBaseHue !== null ? videoBaseHue : (sectionLaserHues && sectionLaserHues[0] ? sectionLaserHues[0] : 0)) + t*10 + i*30) % 360;
                    if(hueToHex) hHex = hueToHex(bh, 0.95, 0.5);
                }
                
                const colObj = new THREE.Color(hHex);
                if (intensity > 0) {
                    colObj.multiplyScalar(intensity * 2.0);
                    pt.mat.color.copy(colObj);
                } else {
                    pt.mat.color.setHex(0x000000);
                }
            });
        }
    }
}
