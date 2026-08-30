import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

function createPNG(width, height, r, g, b, a = 255) {
    // Basic PNG header and chunks generator in pure Node
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    function createChunk(type, data) {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length, 0);
        const typeBuf = Buffer.from(type, 'ascii');
        const body = Buffer.concat([typeBuf, data]);
        const crcBuf = Buffer.alloc(4);
        crcBuf.writeInt32BE(crc32(body), 0);
        return Buffer.concat([len, body, crcBuf]);
    }

    function crc32(buf) {
        let crc = -1;
        for (let i = 0; i < buf.length; i++) {
            let byte = buf[i];
            for (let j = 0; j < 8; j++) {
                if ((crc ^ byte) & 1) {
                    crc = (crc >>> 1) ^ 0xEDB88320;
                } else {
                    crc = crc >>> 1;
                }
                byte >>>= 1;
            }
        }
        return crc ^ -1;
    }

    // IHDR
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 6; // RGBA
    ihdr[10] = 0; // compression
    ihdr[11] = 0; // filter
    ihdr[12] = 0; // interlace

    // IDAT
    const rowSize = width * 4 + 1;
    const rawData = Buffer.alloc(height * rowSize);

    for (let y = 0; y < height; y++) {
        const rowOffset = y * rowSize;
        rawData[rowOffset] = 0; // Filter: None
        for (let x = 0; x < width; x++) {
            const pxOffset = rowOffset + 1 + x * 4;
            // Draw radial glow / neon laser emblem
            const dx = (x - width / 2) / (width / 2);
            const dy = (y - height / 2) / (height / 2);
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 0.85) {
                const laserEffect = Math.sin(dx * 12) * Math.cos(dy * 12);
                rawData[pxOffset] = Math.min(255, Math.floor(r * (1 - dist * 0.5) + (laserEffect > 0 ? 50 : 0)));
                rawData[pxOffset + 1] = Math.min(255, Math.floor(g * (1 - dist * 0.5) + (laserEffect > 0 ? 80 : 0)));
                rawData[pxOffset + 2] = Math.min(255, Math.floor(b * (1 - dist * 0.3) + 40));
                rawData[pxOffset + 3] = a;
            } else {
                rawData[pxOffset] = 10;
                rawData[pxOffset + 1] = 10;
                rawData[pxOffset + 2] = 15;
                rawData[pxOffset + 3] = 255;
            }
        }
    }

    const compressed = zlib.deflateSync(rawData);
    const ihdrChunk = createChunk('IHDR', ihdr);
    const idatChunk = createChunk('IDAT', compressed);
    const iendChunk = createChunk('IEND', Buffer.alloc(0));

    return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

const iconsDir = path.resolve('public/icons');
if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir, { recursive: true });
}

fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), createPNG(192, 192, 255, 0, 85));
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), createPNG(512, 512, 255, 0, 85));
console.log('PNG icons created successfully.');
