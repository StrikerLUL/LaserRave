const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
        recordVideo: { dir: './playwright-videos' },
        viewport: { width: 1280, height: 720 }
    });
    const page = await context.newPage();

    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));

    console.log("Navigating to app...");
    await page.goto('http://localhost:5173');

    // Wait until initial app setup completes and DOM is stable
    await page.waitForTimeout(3000);

    console.log("Changing theme to nebula...");
    await page.selectOption('#param-theme', 'nebula');

    // Wait to capture video with the new theme
    await page.waitForTimeout(3000);

    console.log("Taking screenshot...");
    await page.screenshot({ path: 'frontend-verification.png' });

    // Check if console output showed fallback correctly or WebGPURenderer initialization
    console.log("Waiting for video recording to settle...");
    await page.waitForTimeout(1000);

    await context.close();
    await browser.close();
    console.log("Done.");
})();