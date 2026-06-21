const puppeteer = require('puppeteer');
const { spawn } = require('child_process');

(async () => {
    const server = spawn('npx', ['vite', '--port', '5174'], { stdio: 'pipe', shell: true });
    await new Promise(resolve => setTimeout(resolve, 3000));

    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    page.on('console', msg => console.log('LOG:', msg.type(), msg.text()));
    page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
    
    await page.goto('http://localhost:5174', { waitUntil: 'networkidle2' });

    // evaluate inside the page
    await page.evaluate(() => {
        const worker = new Worker(new URL('./src/ai-worker.js', window.location.href), { type: 'module' });
        worker.onmessage = e => console.log('WORKER MSG:', JSON.stringify(e.data));
        worker.onerror = e => console.log('WORKER ERROR:', e.message);
    });
    
    await new Promise(r => setTimeout(r, 4000));
    await browser.close();
    server.kill();
})();