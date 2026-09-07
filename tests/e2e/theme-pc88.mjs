// 画面の見た目の切り替え（PC-88 風）
//
// 設定で選ぶと <html data-theme="pc88"> になり、黒地・8 色・角なしに変わること。
// 保存されて、開き直しても最初の描画から付いていること（ちらつかない）。
// 標準へ戻すと元どおりになること。字体の読み込みは外へ出るので、
// 取れなくても壊れないこと（ここでは取れるかどうかを見ない）。
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';
const DIR = process.env.SHOTS ?? '.';

const errors = [], fails = [];
const ok = (l, c, e = '') => { console.log((c ? '✓ ' : '✗ ') + l + (e ? `  [${e}]` : '')); if (!c) fails.push(l); };

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1300, height: 950 } });
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  // 字体は外（fonts.googleapis.com）から取る。閉じた環境では取れないが、
  // それは想定内（等幅で代用する）なので、失敗としては数えない
  if (/fonts\.g(oogleapis|static)\.com/.test(m.location()?.url ?? '')) return;
  errors.push('console: ' + m.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(`${BASE}/index.html`);
await page.waitForTimeout(600);

const look = () => page.evaluate(() => {
  const cs = (sel) => getComputedStyle(document.querySelector(sel));
  return {
    theme: document.documentElement.dataset.theme ?? '',
    bg: cs('body').backgroundColor,
    text: cs('body').color,
    font: cs('body').fontFamily,
    cardRadius: cs('.card').borderRadius,
    btnRadius: cs('.btn').borderRadius,
    activeTabBg: cs('.tab.is-active').backgroundColor,
    activeTabColor: cs('.tab.is-active').color,
    metaColor: document.querySelector('meta[name="theme-color"]').content,
    fontLink: !!document.querySelector('link[data-theme-font="pc88"]'),
    select: document.querySelector('#set-theme').value,
  };
});

// ── 標準 ──────────────────────────────────────────
const plain = await look();
console.log('標準:', JSON.stringify(plain));
ok('最初は標準', plain.theme === '' && plain.select === 'default', JSON.stringify(plain));
ok('標準では字体を取りに行かない', !plain.fontLink);
ok('標準は角が丸い', plain.cardRadius !== '0px', plain.cardRadius);

// ── PC-88 風に切り替える ───────────────────────────
await page.click('.tab[data-panel="settings"]');
await page.waitForTimeout(200);
const options = await page.$$eval('#set-theme option', (els) => els.map((o) => [o.value, o.textContent]));
console.log('選べる見た目:', JSON.stringify(options));
ok('PC-88 風が選べる', options.some(([v, t]) => v === 'pc88' && /PC-88/.test(t)), JSON.stringify(options));

await page.selectOption('#set-theme', 'pc88');
await page.waitForTimeout(300);
const pc88 = await look();
console.log('PC-88:', JSON.stringify(pc88));
ok('html に data-theme が付く', pc88.theme === 'pc88', pc88.theme);
ok('黒地になる', pc88.bg === 'rgb(0, 0, 0)', pc88.bg);
ok('白い文字になる', pc88.text === 'rgb(255, 255, 255)', pc88.text);
ok('ドット文字を指定する', /DotGothic16/.test(pc88.font), pc88.font);
ok('字体を取りに行く', pc88.fontLink);
ok('角がなくなる', pc88.cardRadius === '0px' && pc88.btnRadius === '0px', `${pc88.cardRadius} / ${pc88.btnRadius}`);
ok('選んだタブは反転表示', pc88.activeTabBg === 'rgb(255, 255, 255)' && pc88.activeTabColor === 'rgb(0, 0, 0)',
  `${pc88.activeTabBg} / ${pc88.activeTabColor}`);
ok('ブラウザの色も黒に', pc88.metaColor === '#000000', pc88.metaColor);

// 8 色の枠内か: 主な色が R/G/B それぞれ 0 か 255（暗い青の下地だけ例外）
const palette = await page.evaluate(() => {
  const cs = (sel, prop) => getComputedStyle(document.querySelector(sel))[prop];
  return {
    accent: cs('.tab.is-active', 'borderBottomColor'),
    line: cs('.card', 'borderColor'),
    dim: cs('.hint', 'color'),
    primary: cs('.btn-primary', 'backgroundColor'),
  };
});
console.log('色:', JSON.stringify(palette));
const digital = (c) => (c.match(/\d+/g) || []).slice(0, 3).every((v) => v === '0' || v === '255');
ok('主な色は 8 色の中', Object.values(palette).every(digital), JSON.stringify(palette));

// 各タブを回って、見えない文字（地と同じ色）が無いことを見る
const unreadable = await page.evaluate(() => {
  const bad = [];
  for (const tab of document.querySelectorAll('.tab')) {
    tab.click();
    const panel = document.querySelector(`#panel-${tab.dataset.panel}`);
    for (const el of panel.querySelectorAll('h2, h3, p, label, button, .hint, output, td, th')) {
      if (!el.textContent.trim() || el.closest('[hidden]')) continue;
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      // 自分の地色か、地が透明なら親の地色と比べる
      let bg = cs.backgroundColor;
      let node = el;
      while ((bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') && node.parentElement) {
        node = node.parentElement; bg = getComputedStyle(node).backgroundColor;
      }
      if (cs.color === bg) bad.push(`${tab.dataset.panel}: ${el.tagName}.${el.className} "${el.textContent.trim().slice(0, 20)}"`);
    }
  }
  document.querySelector('.tab[data-panel="settings"]').click();
  return bad;
});
ok('地と同じ色の文字が無い', unreadable.length === 0, unreadable.slice(0, 5).join(' | '));
await page.screenshot({ path: `${DIR}/theme-pc88-settings.png`, fullPage: true });
await page.click('.tab[data-panel="qso"]');
await page.waitForTimeout(200);
await page.screenshot({ path: `${DIR}/theme-pc88-qso.png`, fullPage: true });
await page.click('.tab[data-panel="drill"]');
await page.waitForTimeout(200);
await page.screenshot({ path: `${DIR}/theme-pc88-drill.png`, fullPage: true });

// ── 開き直しても最初から付いている ─────────────────
// 読み込みの途中で標準の見た目が一瞬出ないよう、先頭のスクリプトで付ける。
// app.js が動く前の時点で確かめる
const early = await page.evaluate(async () => {
  const html = await (await fetch('index.html')).text();
  return /localStorage\.getItem\('cwtraining\.settings\.v1'\)/.test(html)
    && html.indexOf('cwtraining.settings.v1') < html.indexOf('js/app.js');
});
ok('先頭のスクリプトが app.js より前で見た目を付ける', early);
await page.reload();
const earlyTheme = await page.evaluate(() => document.documentElement.dataset.theme ?? '');
await page.waitForTimeout(600);
const after = await look();
console.log('開き直し:', earlyTheme, JSON.stringify(after));
ok('開き直しても PC-88 風のまま', after.theme === 'pc88' && after.select === 'pc88' && after.bg === 'rgb(0, 0, 0)');
ok('描画の最初から付いている', earlyTheme === 'pc88', earlyTheme);

// ── 標準へ戻す ─────────────────────────────────────
await page.click('.tab[data-panel="settings"]');
await page.selectOption('#set-theme', 'default');
await page.waitForTimeout(300);
const back = await look();
console.log('戻す:', JSON.stringify(back));
ok('標準へ戻せる', back.theme === '' && back.bg === plain.bg && back.cardRadius === plain.cardRadius
  && back.metaColor === plain.metaColor, JSON.stringify(back));
await page.reload();
await page.waitForTimeout(600);
ok('戻したことも保存される', (await look()).theme === '');

console.log('\n失敗:', fails.length ? fails.join(' / ') : 'なし');
console.log('ERRORS:', errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length + fails.length ? 1 : 0);
