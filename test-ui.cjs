const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    recordVideo: {
      dir: 'videos/', // Or wherever you want to save the video
      size: { width: 1280, height: 720 }
    }
  });
  const page = await context.newPage();

  try {
    await page.goto('http://localhost:5173');

    // Wait for the theme dropdown to exist and select 'aurora'
    await page.waitForSelector('#param-theme');
    await page.selectOption('#param-theme', 'aurora');

    // Wait for 3 seconds to record the video
    await page.waitForTimeout(3000);

    // Take a screenshot
    await page.screenshot({ path: 'aurora-theme-screenshot.png' });

    console.log('UI test completed successfully.');
  } catch (error) {
    console.error('UI test failed:', error);
  } finally {
    await context.close();
    await browser.close();
  }
})();
