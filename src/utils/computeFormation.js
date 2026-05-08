/** Returns [{x,y,z,ry}] position for each projector based on formation */
export function computeFormation(count, formation) {
  const pos = [];
  switch (formation) {
    case 'line': {
      const sp = 44 / Math.max(count - 1, 1);
      for (let i = 0; i < count; i++) pos.push({ x: -22 + i * sp, y: 11.85, z: -15, ry: 0 });
      break;
    }
  }
  return pos;
}
