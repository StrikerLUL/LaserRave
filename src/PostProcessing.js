import * as THREE from 'three';
import { pass, uniform } from 'three/tsl';
import { bloom } from 'three/examples/jsm/tsl/display/BloomNode.js';
import { afterImage } from 'three/examples/jsm/tsl/display/AfterImageNode.js';
import { film } from 'three/examples/jsm/tsl/display/FilmNode.js';
import { rgbShift } from 'three/examples/jsm/tsl/display/RGBShiftNode.js';

export let postProcessingNode = null;
export let bloomPass = null;
export let blurPass = null;
export let filmPass = null;
export let rgbShiftPass = null;

export function rebuildPostChain(renderer, scene, camera, CFG, fxVHS, fxBlur, fxFlare) {
    if (!renderer || !renderer.backend || renderer.backend.isWebGLBackend) {
        return null;
    }
    const scenePass = pass(scene, camera);
    let finalNode = scenePass;

    bloomPass = bloom(finalNode, 1.5, 0.4, 0.8);
    
    if (fxBlur) {
        blurPass = afterImage(finalNode, 0.7);
        finalNode = blurPass;
    }
    
    finalNode = finalNode.add(bloomPass);

    if (fxVHS) {
        rgbShiftPass = rgbShift(finalNode, 0.003);
        finalNode = rgbShiftPass;
        filmPass = film(finalNode, 0.35, 1.25);
        finalNode = filmPass;
    }

    postProcessingNode = finalNode;
    return postProcessingNode;
}
