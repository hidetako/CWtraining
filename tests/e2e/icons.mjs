// アイコンが実際に配信され、描画できるか
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 500 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(400);

// ── head の宣言 ───────────────────────────────────
const head = await page.evaluate(() => ({
  icon: document.querySelector('link[rel="icon"]')?.getAttribute('href'),
  iconType: document.querySelector('link[rel="icon"]')?.getAttribute('type'),
  apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href'),
  theme: document.querySelector('meta[name="theme-color"]')?.getAttribute('content'),
  og: document.querySelector('meta[property="og:image"]')?.getAttribute('content'),
}));
console.log('head:', JSON.stringify(head));
ok('favicon が SVG を指す', head.icon === 'favicon.svg' && head.iconType === 'image/svg+xml');
ok('絵文字の暫定アイコンは残っていない', !String(head.icon).startsWith('data:'));
ok('apple-touch-icon がある', head.apple === 'apple-touch-icon.png');
ok('theme-color が背景と揃っている', head.theme === '#050505');
ok('og:image がある', /icon-512\.png$/.test(head.og ?? ''));

// ── 実際に配信されているか ────────────────────────
for (const [file, type] of [
  ['favicon.svg', 'image/svg+xml'],
  ['icon.svg', 'image/svg+xml'],
  ['apple-touch-icon.png', 'image/png'],
  ['icon-512.png', 'image/png'],
]) {
  const res = await page.request.get(`${BASE}/${file}`);
  const ct = res.headers()['content-type'] ?? '';
  const len = (await res.body()).length;
  console.log(`  ${file.padEnd(22)} ${res.status()} ${ct} ${len} bytes`);
  ok(`${file} が取得できる`, res.ok() && ct.includes(type.split('/')[1]) && len > 200, `${res.status()} ${ct}`);
}

// ── 画像として描けるか（壊れた SVG を弾く）────────
const drawn = await page.evaluate(async () => {
  const load = (src) => new Promise((res) => {
    const im = new Image();
    im.onload = () => res({ src, w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => res({ src, w: 0, h: 0 });
    im.src = src;
  });
  return Promise.all(['favicon.svg', 'icon.svg', 'apple-touch-icon.png', 'icon-512.png'].map(load));
});
console.log('描画:', JSON.stringify(drawn));
ok('すべて画像として読み込める', drawn.every((d) => d.w > 0 && d.h > 0), JSON.stringify(drawn));
ok('正方形になっている', drawn.every((d) => d.w === d.h), JSON.stringify(drawn.map((d) => `${d.w}x${d.h}`)));
ok('apple-touch-icon は 180px', drawn.find((d) => d.src.includes('apple'))?.w === 180);

// ── 中身が真っ黒／真っ白でないか ──────────────────
// SVG が壊れて図形が出ない場合を捕まえる
const ink = await page.evaluate(async () => {
  const im = new Image();
  await new Promise((r) => { im.onload = r; im.onerror = r; im.src = 'favicon.svg'; });
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.drawImage(im, 0, 0, 64, 64);
  const d = g.getImageData(0, 0, 64, 64).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] > 120 && d[i + 1] > 60) lit += 1;   // 橙色の画素
  }
  return { lit, total: 64 * 64 };
});
const ratio = ink.lit / ink.total;
console.log('橙色の画素の割合:', (ratio * 100).toFixed(1) + '%');
ok('図形が描かれている（真っ黒でない）', ratio > 0.03, `${(ratio * 100).toFixed(1)}%`);
ok('塗りつぶしになっていない', ratio < 0.6, `${(ratio * 100).toFixed(1)}%`);

await page.goto(`${BASE}/icon.svg`);
await page.waitForTimeout(300);
await page.screenshot({ path: `${DIR}/i1-icon.png` });

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
