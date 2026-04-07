const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  console.log("Starting browser...");
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  
  const width = 600;
  
  // 1. Timer screenshot
  console.log("Navigating to Timer Preview...");
  await page.setViewport({ width, height: 1000, deviceScaleFactor: 2 });
  await page.goto('http://localhost:8080/preview-timer.html', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));
  
  const timerClip = await page.evaluate(() => {
    const card = document.querySelector('ha-custom-timer-card');
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    return {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height
    };
  });
  console.log("Timer Clip:", timerClip);
  if (timerClip && timerClip.width > 0) {
    await page.screenshot({ path: path.join(__dirname, 'assets', 'preview-timer.png'), clip: timerClip });
  } else {
    await page.screenshot({ path: path.join(__dirname, 'assets', 'preview-timer-fallback.png') });
  }

  // 2. Schedule screenshot
  console.log("Navigating to Schedule Preview...");
  await page.setViewport({ width, height: 1000, deviceScaleFactor: 2 });
  await page.goto('http://localhost:8080/preview.html', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));
  
  const scheduleClip = await page.evaluate(() => {
    const card = document.querySelector('ha-custom-schedule-card');
    if (!card) return null;
    const rect = card.getBoundingClientRect();
    return {
      x: rect.x, y: rect.y, width: rect.width, height: rect.height
    };
  });
  console.log("Schedule Clip:", scheduleClip);
  if (scheduleClip && scheduleClip.width > 0) {
    await page.screenshot({ path: path.join(__dirname, 'assets', 'preview.png'), clip: scheduleClip });
  } else {
    await page.screenshot({ path: path.join(__dirname, 'assets', 'preview-fallback.png') });
  }

  await browser.close();
  console.log("Done!");
})();
