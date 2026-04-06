const puppeteer = require(process.env.TEMP + '/node_modules/puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  // Timer screenshot
  await page.setViewport({ width: 600, height: 750, deviceScaleFactor: 2 });
  await page.goto('http://localhost:8080/preview-timer.html', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'c:/Users/fresh/github/schedule-ui/assets/preview-timer.png', fullPage: true });

  // Schedule screenshot
  await page.setViewport({ width: 600, height: 850, deviceScaleFactor: 2 });
  await page.goto('http://localhost:8080/preview.html', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'c:/Users/fresh/github/schedule-ui/assets/preview.png', fullPage: true });

  await browser.close();
})();
