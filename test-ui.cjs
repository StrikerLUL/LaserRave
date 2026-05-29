const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  try {
    await page.goto('http://localhost:5173/');

    // Select the 'toxic' theme
    await page.selectOption('#param-theme', 'toxic');

    // Wait for a short while to ensure rendering happens
    await page.waitForTimeout(2000);

    // Take a screenshot to verify
    await page.screenshot({ path: 'toxic_theme_screenshot.png' });

    console.log('Successfully selected toxic theme and saved screenshot.');
  } catch (error) {
    console.error('Error during Playwright test:', error);
  } finally {
    await browser.close();
  }
})();
