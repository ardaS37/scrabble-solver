const fs = require('node:fs');
const assert = require('node:assert/strict');
const sass = require('sass');
const { chromium } = require('playwright');

(async () => {
  const css = sass.compile('packages/scrabble-solver/src/modals/PhotoScanModal/PhotoScanModal.module.scss').css;
  const image = 'data:image/jpeg;base64,' + fs.readFileSync(process.argv[2]).toString('base64');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const width of [390, 800, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
      await page.setContent(
        `<style>${css}</style><div style="width: min(600px, 100%)"><div class="preview"><img class="image" src="${image}"></div></div>`,
      );
      const geometry = await page.evaluate(async () => {
        const img = document.querySelector('img');
        await img.decode();
        const bounds = img.getBoundingClientRect();
        const preview = img.parentElement.getBoundingClientRect();
        const scale = Math.min(bounds.width / img.naturalWidth, bounds.height / img.naturalHeight);
        return {
          boxWidth: bounds.width,
          paintedWidth: img.naturalWidth * scale,
          boxHeight: bounds.height,
          paintedHeight: img.naturalHeight * scale,
          previewWidth: preview.width,
          previewHeight: preview.height,
        };
      });
      console.log(width, geometry);
      assert.ok(
        Math.abs(geometry.boxWidth - geometry.paintedWidth) < 1,
        'Click coordinates must exclude horizontal letterboxing',
      );
      assert.ok(
        Math.abs(geometry.boxHeight - geometry.paintedHeight) < 1,
        'Click coordinates must exclude vertical letterboxing',
      );
      assert.ok(Math.abs(geometry.previewWidth - geometry.boxWidth) < 1, 'Grid and image widths must match');
      assert.ok(Math.abs(geometry.previewHeight - geometry.boxHeight) < 1, 'Grid and image heights must match');
      await page.close();
    }
    console.log('PASS: image, click area and grid share bounds at all three viewport widths.');
  } finally {
    await browser.close();
  }
})();
