const puppeteer = require('puppeteer');

// Takes screenshots of key pages to verify mobile responsiveness
async function testMobileViews() {
  console.log('Starting mobile view test...');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  
  // Set mobile viewport
  await page.setViewport({
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });

  // Test login page
  console.log('Testing login page...');
  await page.goto('http://localhost:5001/login', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: 'login-mobile.png' });
  
  // Test sign-up page
  console.log('Testing sign-up page...');
  await page.goto('http://localhost:5001/sign-up', { waitUntil: 'networkidle0' });
  await page.screenshot({ path: 'signup-mobile.png' });
  
  await browser.close();
  console.log('Screenshots saved to login-mobile.png and signup-mobile.png');
}

testMobileViews().catch(console.error);