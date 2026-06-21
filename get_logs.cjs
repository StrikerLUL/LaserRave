const puppeteer = require('puppeteer');
const path = require('path');
const express = require('express');

const app = express();
app.use(express.static(path.join(__dirname, 'dist')));
const server = app.listen(0, async () => {
  const port = server.address().port;
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('BROWSER ERROR:', msg.text());
    } else {
      console.log('BROWSER LOG:', msg.text());
    }
  });

  page.on('pageerror', error => {
    console.log('PAGE ERROR:', error.stack || error.message);
  });

  try {
      await page.goto('http://localhost:' + port);
      await new Promise(r => setTimeout(r, 4000));
  } finally {
      await browser.close();
      server.close();
  }
});
