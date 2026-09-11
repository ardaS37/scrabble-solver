const fs = require('node:fs');
const assert = require('node:assert/strict');
const { stripTypeScriptTypes } = require('node:module');
const { chromium } = require('playwright');

(async () => {
  const source = fs.readFileSync('packages/scrabble-solver/src/modals/PhotoScanModal/PhotoScanModal.tsx', 'utf8');
  const helpers = source.slice(
    source.indexOf('function createPerspectiveCellSampler('),
    source.indexOf('const PhotoScanModalBase'),
  );
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  try {
    const page = await browser.newPage();
    await page.addScriptTag({
      content: stripTypeScriptTypes(helpers),
    });
    const input = process.argv[2];
    if (!input) throw new Error('Pass the Kelimelik reference JPEG path.');
    const result = await page.evaluate(
      async (url) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const alphabet = Array.from('abcçdefgğhıijklmnoöprsştuüvyz');
        const profile = {
          ink: 'dark',
          isTilePixel: (red, green, blue) => red > green + 8 && green > blue + 40 && red > 160,
        };
        const corners = [
          { x: 0, y: 604 / 2048 },
          { x: 1, y: 1548 / 2048 },
        ];
        const rows = [];
        for (let y = 0; y < 15; y++) {
          let row = '';
          for (let x = 0; x < 15; x++) {
            const cell = getCellImage(image, corners, { x, y, columns: 15, rows: 15 }, 'balanced', profile);
            row += cell.isLikelyTile ? recognizeTileCharacter(cell.imageData, alphabet, 'tr-TR') || '.' : '.';
          }
          rows.push(row);
        }
        const perspective = createPerspectiveCellSampler(image, [
          corners[0],
          { x: 1, y: corners[0].y },
          corners[1],
          { x: 0, y: corners[1].y },
        ]);
        const perspectiveRows = [];
        for (let y = 0; y < 15; y++) {
          let row = '';
          for (let x = 0; x < 15; x++) {
            const cell = getCellImage(
              perspective(x, y, 15, 15),
              [
                { x: 0, y: 0 },
                { x: 1, y: 1 },
              ],
              { x: 0, y: 0, columns: 1, rows: 1 },
              'balanced',
              profile,
            );
            row += cell.isLikelyTile ? recognizeTileCharacter(cell.imageData, alphabet, 'tr-TR') || '.' : '.';
          }
          perspectiveRows.push(row);
        }
        let rack = '';
        for (let x = 0; x < 7; x++) {
          const cell = getCellImage(
            image,
            [
              { x: 22 / 945, y: 1565 / 2048 },
              { x: 924 / 945, y: 1688 / 2048 },
            ],
            { x, y: 0, columns: 7, rows: 1 },
            'balanced',
            profile,
          );
          rack += cell.isLikelyTile ? recognizeTileCharacter(cell.imageData, alphabet, 'tr-TR') || '.' : '.';
        }
        return { size: [image.naturalWidth, image.naturalHeight], rows, perspectiveRows, rack };
      },
      'data:image/jpeg;base64,' + fs.readFileSync(input).toString('base64'),
    );
    console.log(JSON.stringify(result, null, 2));
    const expected = [
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '...............',
      '......futa.....',
      '.......çiğ.....',
      '........mal....',
      '.........ç.....',
      '.........le....',
      '........sırlı..',
      '..........i.ret',
      '..........n..ha',
      '...............',
    ];
    assert.deepEqual(result.rows, expected, 'Board cells must match the reference');
    assert.deepEqual(result.perspectiveRows, expected, 'Four-corner selection must match the reference');
    assert.equal(result.rack, 'rrirlau', 'Rack must match the reference');
    console.log('PASS: 225 board cells in both selection modes and all 7 rack tiles.');
  } finally {
    await browser.close();
  }
})();
