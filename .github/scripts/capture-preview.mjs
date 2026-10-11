import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const url = 'https://singer.andreway.ru/';
await mkdir('preview', { recursive: true });

const browser = await chromium.launch({ headless: true });

async function capture(name, viewport) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600,
  });

  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`
  });
  await page.waitForTimeout(1800);
  await page.screenshot({
    path: `preview/${name}.png`,
    fullPage: true
  });
  await context.close();
}

await capture('mobile', { width: 390, height: 844 });
await capture('desktop', { width: 1440, height: 1000 });

await browser.close();
