// Playwright の場所は環境によって違うため動的に読み込む
const { chromium } = await import(process.env.PW ?? 'playwright');

const BASE = process.env.BASE ?? 'http://localhost:8123';

const errors = [];
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const DIR = process.env.SHOTS ?? '.';
const shot = (n) => page.screenshot({ path: `${DIR}/${n}.png`, fullPage: true });

await page.goto(`${BASE}/index.html`);
/** 出題の数え（3 秒）が終わるのを待つ。終わる前に答えても採点されない。 */
const waitDrillReady = async () => {
  const cd = () => page.waitForFunction(
    (want) => document.querySelector('#drill-countdown').hidden === want,
    null, { timeout: 15000 });
  await page.waitForFunction(() => document.querySelector('#drill-countdown').hidden === false,
    null, { timeout: 4000 }).catch(() => {});   // 数えが出る前に終わっていることもある
  await page.waitForFunction(() => document.querySelector('#drill-countdown').hidden === true,
    null, { timeout: 15000 });
};

await page.waitForTimeout(600);

// ── 1. QSO simulator: walk the whole script ────────────────
await page.locator('.style-option[data-style="copy"]').click();   // 聞き取りモードに切替
await page.waitForTimeout(150);
await page.click('#btn-qso-start');
await page.waitForTimeout(300);

const truth = await page.evaluate(() => window.__cw.__qsoScript || null);
for (let step = 0; step < 20; step++) {
  await page.waitForTimeout(250);
  if (await page.locator('#btn-qso-again').count()) { console.log(`QSO finished at step ${step}`); break; }

  if (await page.locator('#btn-turn-skip').count()) {
    await page.click('#btn-turn-skip');                     // TX turn
  } else if (await page.locator('#btn-turn-grade').count()) {
    // RX turn: fill the log sheet with the correct answers via the debug handle
    const answers = await page.evaluate(() => {
      const s = window.__cw.qsoTurn;
      return s ? s.fields.map((f) => [f.key, f.value]) : [];
    });
    for (const [key, value] of answers) {
      await page.fill(`.logsheet input[data-key="${key}"]`, value);
    }
    if (step === 1) { console.log('log sheet fields:', answers.map((a) => a[0]).join(',')); await shot('01-qso-rx'); }
    await page.click('#btn-turn-grade');
    await page.waitForTimeout(200);
    if (step === 1) await shot('02-qso-graded');
    await page.click('#btn-turn-next');
  } else if (await page.locator('#btn-turn-next').count()) {
    await page.click('#btn-turn-next');
  }
}
console.log('QSO summary:', (await page.textContent('#qso-turn')).replace(/\s+/g, ' ').trim().slice(0, 60));
await shot('03-qso-summary');

// ── 2. Drill ───────────────────────────────────────────────
await page.click('.tab[data-panel="drill"]');
await page.click('#btn-drill-new');
await waitDrillReady();
const problem = await page.evaluate(() => window.__cw.drillProblem?.answer);
await page.fill('#drill-answer', problem || 'X');
await page.press('#drill-answer', 'Enter');
await page.waitForTimeout(300);
console.log('drill score (should be 100%):', (await page.textContent('#drill-result .big')));
console.log('drill alphabet:', (await page.textContent('#drill-alphabet')).slice(0, 45));
await shot('04-drill');

// ── 3. Contest: work a real station correctly ──────────────
await page.click('.tab[data-panel="contest"]');
await page.selectOption('#contest-mode', 'pileup');
await page.selectOption('#contest-minutes', '3');
await page.click('#btn-contest-start');
await page.waitForTimeout(2000);

const caller = await page.evaluate(() => {
  const c = window.__cw.contest.stations[0];
  return c ? { call: c.callsign, serial: c.exchangeValue, wpm: c.wpm, offset: c.offset } : null;
});
console.log('first caller:', JSON.stringify(caller));
console.log('score board:', (await page.textContent('#contest-score')).replace(/\s+/g, ' ').trim());
await shot('05-contest');

if (caller) {
  await page.fill('#contest-call', caller.call);
  await page.keyboard.press('F2');
  await page.waitForTimeout(1200);
  await page.fill('#contest-exch', caller.serial);
  await page.keyboard.press('F3');
  await page.waitForTimeout(800);
}
console.log('contest log:', (await page.textContent('#contest-log')).replace(/\s+/g, ' ').trim().slice(0, 80));
console.log('valid QSOs:', await page.evaluate(() => window.__cw.contest.score.points));
await shot('06-contest-log');
await page.evaluate(() => window.__cw.contest.stopSession());
await page.waitForTimeout(300);
await shot('07-contest-result');

// ── 4. Keyer: iambic behaviour ─────────────────────────────
await page.click('.tab[data-panel="keyer"]');
await page.waitForTimeout(300);
await page.selectOption('#keyer-task-type', 'free');
await page.waitForTimeout(200);

const pad = page.locator('#pw-pad');
await pad.scrollIntoViewIfNeeded();
await page.waitForTimeout(200);
const b = await pad.boundingBox();
const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
await page.mouse.move(cx, cy);

const tap = async (button, ms) => {
  await page.mouse.down({ button });
  await page.waitForTimeout(ms);
  await page.mouse.up({ button });
};

// "A" = dit dah
await tap('left', 60); await page.waitForTimeout(90);
await tap('right', 200);
await page.waitForTimeout(800);
console.log('keyed dit+dah ->', JSON.stringify((await page.textContent('#keyer-decoded')).trim()));

// squeeze both -> iambic alternation (dit dah dit dah ... = should decode to something)
await page.mouse.down({ button: 'left' });
await page.mouse.down({ button: 'right' });
await page.waitForTimeout(500);
await page.mouse.up({ button: 'left' });
await page.mouse.up({ button: 'right' });
await page.waitForTimeout(900);
console.log('after squeeze ->', JSON.stringify((await page.textContent('#keyer-decoded')).trim()));

// dit auto-repeat: hold left -> EEEE...
await page.evaluate(() => window.__cw.keyer.reset());
await tap('left', 500);
await page.waitForTimeout(900);
console.log('held dit ->', JSON.stringify((await page.textContent('#keyer-decoded')).trim()));
await shot('08-keyer');

await page.click('#btn-keyer-grade');
await page.waitForTimeout(300);
await shot('09-keyer-grade');

// ── 5. Tools / glossary / settings ─────────────────────────
await page.click('.tab[data-panel="tools"]');
console.log('tool morse:', (await page.textContent('#tool-morse')).slice(0, 46));
await shot('10-tools');

await page.click('.tab[data-panel="glossary"]');
await page.fill('#glossary-search', 'QT');
await page.waitForTimeout(200);
console.log('glossary filtered count:', await page.locator('.gloss-item').count());
await shot('11-glossary');

await page.click('.tab[data-panel="settings"]');
await page.waitForTimeout(300);
console.log('stat tiles:', await page.locator('#stat-summary .stat').count());
await shot('12-settings');


// ── 6. Beginner mode: live explanations ────────────────────
await page.click('.tab[data-panel="tools"]');
await page.fill('#tool-text', 'CQ CQ DE JA1ABC = UR RST 599 QTH TOKYO = QSB QRM HW? <AR>');
await page.waitForTimeout(200);
console.log('annotated terms:', await page.locator('#tool-annotated .term').count());
console.log('term titles:', await page.locator('#tool-annotated .term').evaluateAll(els => els.slice(0,4).map(e => e.textContent + '=' + e.title.slice(0,22))));
await page.evaluate(() => { window.__cw.settings.charWpm = 38; window.__cw.player.setSettings({charWpm:38, effWpm:38}); });
await page.click('#btn-tool-play');
await page.waitForTimeout(3000);
console.log('live explain cards:', await page.locator('#tool-explain .explain-card').count());
console.log('live explain first:', (await page.locator('#tool-explain .explain-card').first().textContent().catch(()=>'-')).replace(/\s+/g,' ').trim().slice(0,60));
await shot('13-beginner');
await page.evaluate(() => window.__cw.player.stop());

console.log('\n=== ERRORS ===');
console.log(errors.length ? errors.join('\n') : '(none)');
await browser.close();

process.exit(errors.length ? 1 : 0);
