// 画面の組み立てとイベント配線

import { CWPlayer } from './audio.js';
import { toMorseString, estimateDuration, tokenize } from './morse.js';
import { ABBREVIATIONS, FREQUENCY_ORDER, KOCH_ORDER } from './data.js';
import { annotateHtml, createTracker, explainText } from './explain.js';
import { DRILL_TYPES, gradeProblem, makeProblem, shouldLevelUp } from './drills.js';
import { LocalResponder, gradeField } from './qso.js';
import { ElectronicKeyer, KEYER_MODES, attachPaddleInput, compareSending } from './keyer.js';
import { ContestRunner, EXCHANGE_TYPES } from './contest.js';
import { Tutorial, TUTORIAL_STEPS } from './tutorial.js';
import {
  loadSettings, saveSettings, loadStats, saveStats, resetStats,
  recordDrill, recordQso, recordKeying, recordContest, weakChars,
} from './stats.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const player = new CWPlayer();
const responder = new LocalResponder();
const keyer = new ElectronicKeyer(player);
const contest = new ContestRunner(player);
const tutorial = new Tutorial();
let settings = loadSettings();
let stats = loadStats();

// ═══════════════════════════════════════════ 起動

function init() {
  applyAudioSettings();
  initTabs();
  initHeaderControls();
  initQso();
  initDrill();
  initContest();
  initKeyer();
  initTools();
  initGlossary();
  initSettings();
  initBeginnerToggles();
  renderStats();
}

/** 各タブに置いた初心者モードのスイッチを、設定と同期させる。 */
function initBeginnerToggles() {
  $$('.js-beginner').forEach((el) => {
    el.addEventListener('change', () => {
      settings.beginnerMode = el.checked;
      persist();
      syncBeginnerToggles();
    });
  });
  syncBeginnerToggles();
}

function syncBeginnerToggles() {
  $$('.js-beginner').forEach((el) => { el.checked = settings.beginnerMode; });
  const master = $('#set-beginner');
  if (master) master.checked = settings.beginnerMode;
}

function applyAudioSettings() {
  player.setSettings({
    charWpm: settings.charWpm,
    effWpm: Math.min(settings.effWpm, settings.charWpm),
    freq: settings.freq,
    volume: settings.volume,
    qrn: settings.qrn / 100,
    qsb: settings.qsb / 100,
    qrm: settings.qrm / 100,
  });
}

function persist() {
  saveSettings(settings);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// ═══════════════════════════════════════════ タブ

function initTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      player.stop();
      $$('.tab').forEach((t) => t.classList.toggle('is-active', t === tab));
      $$('.panel').forEach((p) => {
        p.classList.toggle('is-active', p.id === `panel-${tab.dataset.panel}`);
      });
      // パドル入力は開いているタブでだけ有効にする
      setPaddleActive(tab.dataset.panel === 'keyer');
    });
  });
}

// ═══════════════════════════════════════════ ヘッダーの速度・音量

function initHeaderControls() {
  const charWpm = $('#qa-charwpm');
  const effWpm = $('#qa-effwpm');
  const volume = $('#qa-volume');

  const sync = () => {
    charWpm.value = settings.charWpm;
    effWpm.value = settings.effWpm;
    volume.value = Math.round(settings.volume * 100);
    $('#qa-charwpm-out').textContent = `${settings.charWpm} WPM`;
    $('#qa-effwpm-out').textContent = `${settings.effWpm} WPM`;
    $('#qa-volume-out').textContent = String(Math.round(settings.volume * 100));
  };

  charWpm.addEventListener('input', () => {
    settings.charWpm = Number(charWpm.value);
    // 実効速度が文字速度を上回らないようにする
    if (settings.effWpm > settings.charWpm) settings.effWpm = settings.charWpm;
    sync(); applyAudioSettings(); persist();
  });

  effWpm.addEventListener('input', () => {
    settings.effWpm = Math.min(Number(effWpm.value), settings.charWpm);
    sync(); applyAudioSettings(); persist();
  });

  volume.addEventListener('input', () => {
    settings.volume = Number(volume.value) / 100;
    sync(); applyAudioSettings(); persist();
  });

  $('#btn-stop-all').addEventListener('click', () => player.stop());
  sync();
}

// ═══════════════════════════════════════════ 交信シミュレーター

const qso = { script: null, index: 0, results: [], graded: false };

function initQso() {
  $('#qso-mode').value = settings.qsoMode;
  $('#qso-length').value = settings.qsoLength;

  $('#qso-mode').addEventListener('change', (e) => {
    settings.qsoMode = e.target.value; persist();
  });
  $('#qso-length').addEventListener('change', (e) => {
    settings.qsoLength = e.target.value; persist();
  });

  $('#btn-qso-start').addEventListener('click', startQso);
  updateMyProfileLine();
}

function updateMyProfileLine() {
  $('#qso-myprofile').textContent =
    `${settings.callsign} / ${settings.name} / ${settings.qth}`;
}

async function startQso() {
  player.stop();
  qso.script = await responder.buildScript(settings, {
    mode: settings.qsoMode,
    length: settings.qsoLength,
  });
  qso.index = 0;
  qso.results = [];

  $('#qso-stage').hidden = false;
  $('#qso-log').innerHTML = '';
  renderTurn();
  $('#qso-stage').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function appendLog(turn, { reveal }) {
  const who = turn.side === 'me' ? '自局 TX' : '相手 RX';
  const cls = turn.side === 'me' ? 'tx' : 'rx';
  const el = document.createElement('div');
  el.className = `log-entry ${cls}${reveal ? '' : ' is-hidden'}`;
  el.innerHTML =
    `<span class="who">${who}</span>` +
    `<span class="body">${reveal ? escapeHtml(turn.text) : '（未採点）'}</span>`;
  $('#qso-log').append(el);
  $('#qso-log').scrollTop = $('#qso-log').scrollHeight;
  return el;
}

function renderTurn() {
  const box = $('#qso-turn');
  const turn = qso.script.turns[qso.index];

  if (!turn) return renderQsoSummary();

  qso.graded = false;

  if (turn.side === 'me') {
    box.innerHTML = `
      <div class="turn-head">
        <h3>自局の送信 (${qso.index + 1}/${qso.script.turns.length})</h3>
        <span class="turn-badge tx">送信 TX</span>
      </div>
      <p class="hint">下の内容を送信します。実際に鍵を打つつもりで音を聞いてください。</p>
      <div class="annotated">${annotateHtml(turn.text, escapeHtml)}</div>
      <div class="playing-char" id="qso-playing"></div>
      <div class="explain-live" id="qso-explain"></div>
      <div class="turn-actions">
        <button type="button" class="btn btn-primary" id="btn-turn-send">送信する</button>
        <button type="button" class="btn btn-ghost" id="btn-turn-skip">送信を省略して次へ</button>
      </div>`;

    $('#btn-turn-send').addEventListener('click', async (e) => {
      e.target.disabled = true;
      await playText(turn.text, '#qso-playing', { explainSelector: '#qso-explain' });
      advanceTurn(turn, { reveal: true });
    });
    $('#btn-turn-skip').addEventListener('click', () => {
      player.stop();
      advanceTurn(turn, { reveal: true });
    });
    return;
  }

  // 相手局の送信を聞き取るターン
  const sheet = turn.fields.map((f) => `
    <label class="field">
      <span>${escapeHtml(f.label)}</span>
      <input type="text" data-key="${escapeHtml(f.key)}" autocomplete="off"
             autocapitalize="characters" spellcheck="false">
    </label>`).join('');

  box.innerHTML = `
    <div class="turn-head">
      <h3>相手局の送信 (${qso.index + 1}/${qso.script.turns.length})</h3>
      <span class="turn-badge rx">受信 RX</span>
    </div>
    <p class="hint">「受信する」を押して聞き取り、ログシートに書き取ってください。</p>
    <div class="playing-char" id="qso-playing"></div>
    <div class="explain-live" id="qso-explain"></div>
    <div class="turn-actions">
      <button type="button" class="btn btn-primary" id="btn-turn-rx">受信する</button>
      <button type="button" class="btn" id="btn-turn-again">もう一度</button>
      <button type="button" class="btn btn-ghost" id="btn-turn-slow">ゆっくり</button>
    </div>
    ${sheet ? `<div class="logsheet">${sheet}</div>` : ''}
    <div class="turn-actions">
      <button type="button" class="btn btn-primary" id="btn-turn-grade">答え合わせして次へ</button>
    </div>
    ${settings.showText ? `<div class="tx-preview">${escapeHtml(turn.text)}</div>` : ''}`;

  const rxOpts = { explainSelector: '#qso-explain' };
  $('#btn-turn-rx').addEventListener('click', () => playText(turn.text, '#qso-playing', rxOpts));
  $('#btn-turn-again').addEventListener('click', () => playText(turn.text, '#qso-playing', rxOpts));
  $('#btn-turn-slow').addEventListener('click', () => {
    playText(turn.text, '#qso-playing', {
      ...rxOpts,
      charWpm: Math.max(8, settings.charWpm - 5),
      effWpm: Math.max(6, Math.min(settings.effWpm, settings.charWpm - 5) - 3),
    });
  });
  $('#btn-turn-grade').addEventListener('click', () => gradeTurn(turn, box));

  // 最初のフィールドで Enter を押したら採点する
  const inputs = $$('.logsheet input', box);
  inputs.forEach((input, i) => {
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (i < inputs.length - 1) inputs[i + 1].focus();
      else gradeTurn(turn, box);
    });
  });

  // 自動で受信を始める
  playText(turn.text, '#qso-playing');
}

function gradeTurn(turn, box) {
  if (qso.graded) return;
  qso.graded = true;
  player.stop();

  const inputs = $$('.logsheet input', box);
  const lines = [];
  let correct = 0;

  turn.fields.forEach((f) => {
    const input = inputs.find((el) => el.dataset.key === f.key);
    const grade = gradeField(f.value, input?.value);
    if (grade.correct) correct += 1;
    lines.push(`
      <div class="grade-line ${grade.correct ? 'ok' : 'ng'}">
        <span class="label">${escapeHtml(f.label)}</span>
        <span class="mark">${grade.correct ? '○' : '×'}</span>
        <span>${escapeHtml((input?.value || '（未記入）').toUpperCase())}</span>
        ${grade.correct ? '' : `<span class="truth">→ ${escapeHtml(f.value)}</span>`}
      </div>`);
  });

  qso.results.push({ correct, total: turn.fields.length });

  box.innerHTML = `
    <div class="turn-head">
      <h3>答え合わせ</h3>
      <span class="turn-badge rx">受信 RX</span>
    </div>
    ${lines.join('') || '<p class="hint">この送信に書き取り項目はありません。</p>'}
    <h4>相手が送ってきた内容</h4>
    <div class="annotated">${annotateHtml(turn.text, escapeHtml)}</div>
    <div class="playing-char" id="qso-playing"></div>
    ${termListHtml(turn.text)}
    <div class="turn-actions">
      <button type="button" class="btn" id="btn-turn-relisten">本文を聞き直す</button>
      <button type="button" class="btn btn-primary" id="btn-turn-next">次へ</button>
    </div>`;

  $('#btn-turn-relisten').addEventListener('click', () => playText(turn.text, '#qso-playing'));
  $('#btn-turn-next').addEventListener('click', () => advanceTurn(turn, { reveal: true }));
}

function advanceTurn(turn, opts) {
  appendLog(turn, opts);
  qso.index += 1;
  renderTurn();
}

function renderQsoSummary() {
  const total = qso.results.reduce((n, r) => n + r.total, 0);
  const correct = qso.results.reduce((n, r) => n + r.correct, 0);
  const pct = total ? Math.round((correct / total) * 100) : 100;

  stats = recordQso(stats, {
    correct,
    total,
    station: qso.script.station.callsign,
    wpm: settings.charWpm,
  });
  saveStats(stats);
  renderStats();

  $('#qso-turn').innerHTML = `
    <div class="qso-summary">
      <h3>交信終了 — ${escapeHtml(qso.script.station.callsign)}</h3>
      <div class="score">${pct}%</div>
      <p class="hint">書き取り ${correct} / ${total} 項目</p>
    </div>
    <div class="turn-actions" style="justify-content:center">
      <button type="button" class="btn btn-primary" id="btn-qso-again">もう一局</button>
    </div>`;

  $('#btn-qso-again').addEventListener('click', startQso);
}

/**
 * 共通の再生処理。
 * selector を渡すとその要素に送信中の文字を表示し、
 * explainSelector を渡すと初心者モードで語ごとの解説を追記していく。
 */
async function playText(text, selector, override = {}) {
  const display = selector ? $(selector) : null;
  const explain = override.explainSelector ? $(override.explainSelector) : null;
  if (display) display.innerHTML = '';

  const live = explain && settings.beginnerMode;
  const tracker = live ? createTracker(text) : null;
  if (explain) {
    explain.innerHTML = live
      ? '<p class="explain-empty">送信中の語をここに解説します。</p>'
      : '';
  }

  const opts = { ...override };
  delete opts.explainSelector;

  return player.play(text, {
    ...opts,
    onToken: (token, index) => {
      if (display) {
        display.innerHTML =
          `<span>${escapeHtml(token.text)}</span>` +
          `<span class="pattern">${escapeHtml(token.pattern)}</span>`;
      }
      if (!tracker) return;

      const hit = tracker.step(index);
      if (!hit) return;

      // 直前の語の強調を外し、新しい語を先頭に足す
      $$('.explain-card.is-current', explain).forEach((el) => el.classList.remove('is-current'));
      if (!hit.entry) return;

      const empty = $('.explain-empty', explain);
      if (empty) empty.remove();

      const card = document.createElement('div');
      card.className = 'explain-card is-current';
      card.innerHTML =
        `<span class="code">${escapeHtml(hit.entry.term)}</span>` +
        `<span class="desc">${escapeHtml(hit.entry.ja)}</span>`;
      explain.prepend(card);

      // 増えすぎないよう直近 8 件だけ残す
      while (explain.children.length > 8) explain.lastElementChild.remove();
    },
  });
}

/** 本文に出てきた用語を一覧にした HTML を返す。 */
function termListHtml(text) {
  const terms = explainText(text);
  if (!terms.length) return '';
  return `
    <h4>この送信に出てきた用語</h4>
    <div class="explain-live">
      ${terms.map((t) => `
        <div class="explain-card">
          <span class="code">${escapeHtml(t.term)}</span>
          <span class="desc">${escapeHtml(t.ja)}</span>
        </div>`).join('')}
    </div>`;
}

// ═══════════════════════════════════════════ 聞き取りドリル

const drill = { problem: null };

function initDrill() {
  const typeSel = $('#drill-type');
  typeSel.innerHTML = Object.entries(DRILL_TYPES)
    .map(([key, v]) => `<option value="${key}">${v.label}</option>`)
    .join('');
  typeSel.value = settings.drillType;

  $('#drill-groupsize').value = settings.groupSize;
  $('#drill-groupcount').value = settings.groupCount;
  $('#drill-level').value = settings.kochLevel;

  typeSel.addEventListener('change', () => {
    settings.drillType = typeSel.value; persist(); updateDrillControls();
  });
  $('#drill-level').addEventListener('input', (e) => {
    settings.kochLevel = Number(e.target.value); persist(); updateDrillControls();
  });
  $('#drill-groupsize').addEventListener('change', (e) => {
    settings.groupSize = Math.max(1, Number(e.target.value) || 5); persist();
  });
  $('#drill-groupcount').addEventListener('change', (e) => {
    settings.groupCount = Math.max(1, Number(e.target.value) || 5); persist();
  });

  $('#btn-drill-new').addEventListener('click', newProblem);
  $('#btn-drill-replay').addEventListener('click', () => {
    if (drill.problem) player.play(drill.problem.text);
  });
  $('#btn-drill-slow').addEventListener('click', () => {
    if (!drill.problem) return;
    player.play(drill.problem.text, {
      charWpm: Math.max(8, settings.charWpm - 5),
      effWpm: Math.max(6, Math.min(settings.effWpm, settings.charWpm - 5) - 3),
    });
  });
  $('#drill-answer').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') gradeCurrentProblem();
  });

  updateDrillControls();
}

function isCharDrill(type) {
  return type === 'koch' || type === 'frequency';
}

function updateDrillControls() {
  const type = settings.drillType;
  const charDrill = isCharDrill(type);
  const order = type === 'frequency' ? FREQUENCY_ORDER : KOCH_ORDER;

  $('#drill-level-field').hidden = !charDrill;
  $('#drill-groupsize').closest('.field').hidden = !charDrill;
  $('#drill-groupcount').closest('.field').hidden = !charDrill;
  $('#drill-help').textContent = DRILL_TYPES[type]?.help || '';

  if (!charDrill) {
    $('#drill-alphabet').textContent = '';
    return;
  }

  const slider = $('#drill-level');
  slider.max = String(order.length);
  const level = Math.min(settings.kochLevel, order.length);
  if (Number(slider.value) !== level) slider.value = String(level);

  $('#drill-level-out').textContent = `${level} 文字`;
  $('#drill-alphabet').textContent = `使用文字: ${order.slice(0, level).join(' ')}`;
}

async function newProblem() {
  drill.problem = makeProblem(settings.drillType, {
    level: settings.kochLevel,
    groupSize: settings.groupSize,
    groupCount: settings.groupCount,
  });

  $('#drill-result').hidden = true;
  $('#drill-answer').value = '';
  $('#drill-answer').focus();
  $('#btn-drill-replay').disabled = false;
  $('#btn-drill-slow').disabled = false;

  await player.play(drill.problem.text);
}

function gradeCurrentProblem() {
  if (!drill.problem) return;
  player.stop();

  const input = $('#drill-answer').value;
  const result = gradeProblem(drill.problem, input);
  const pct = Math.round(result.accuracy * 100);
  const levelUp = isCharDrill(settings.drillType)
    && shouldLevelUp(result.accuracy)
    && result.total >= 10;

  stats = recordDrill(stats, {
    type: settings.drillType,
    result,
    level: settings.kochLevel,
  });
  saveStats(stats);
  renderStats();

  const marks = result.marks
    .map((m) => `<span class="${m.ok ? 'ok' : 'ng'}">${escapeHtml(m.actual || m.expected || '_')}</span>`)
    .join('');

  const box = $('#drill-result');
  box.hidden = false;
  box.innerHTML = `
    <div class="score-line">
      <span class="big">${pct}%</span>
      <span class="hint">${result.correct} / ${result.total} 文字</span>
      ${levelUp ? '<span class="levelup">90% 到達 — レベルを上げましょう</span>' : ''}
    </div>
    <div class="marks">${marks}</div>
    <p class="hint">正解: <code>${escapeHtml(drill.problem.answer)}</code>
      ${drill.problem.hint ? ` — ${escapeHtml(drill.problem.hint)}` : ''}</p>
    <p class="hint">モールス: <code>${escapeHtml(toMorseString(drill.problem.answer))}</code></p>
    <div class="drill-actions" style="margin-top:.9rem">
      ${levelUp ? '<button type="button" class="btn" id="btn-levelup">レベルを 1 上げる</button>' : ''}
      <button type="button" class="btn btn-primary" id="btn-drill-next">次の問題</button>
    </div>`;

  $('#btn-drill-next').addEventListener('click', newProblem);
  const levelBtn = $('#btn-levelup');
  if (levelBtn) {
    levelBtn.addEventListener('click', () => {
      const order = settings.drillType === 'frequency' ? FREQUENCY_ORDER : KOCH_ORDER;
      settings.kochLevel = Math.min(settings.kochLevel + 1, order.length);
      persist();
      updateDrillControls();
      newProblem();
    });
  }
}

// ═══════════════════════════════════════════ コンテスト運用

function initContest() {
  const exchangeSel = $('#contest-exchange');
  exchangeSel.innerHTML = Object.entries(EXCHANGE_TYPES)
    .map(([key, v]) => `<option value="${key}">${v.label}</option>`)
    .join('');

  const sync = () => {
    exchangeSel.value = settings.contestExchange;
    $('#contest-minutes').value = String(settings.contestMinutes);
    $('#contest-activity').value = settings.contestActivity;
    $('#contest-activity-out').textContent = `${settings.contestActivity} / 9`;
    $('#contest-flutter').checked = settings.contestFlutter;
    $('#contest-mynumber').value = settings.contestMyNumber;
    $('#contest-exchange-help').textContent = EXCHANGE_TYPES[settings.contestExchange]?.help || '';
    $('#contest-cond').textContent =
      `${settings.qrn}% / QSB ${settings.qsb}% / QRM ${settings.qrm}%`;
  };

  exchangeSel.addEventListener('change', () => {
    settings.contestExchange = exchangeSel.value; persist(); sync();
  });
  $('#contest-minutes').addEventListener('change', (e) => {
    settings.contestMinutes = Number(e.target.value); persist();
  });
  $('#contest-activity').addEventListener('input', (e) => {
    settings.contestActivity = Number(e.target.value); persist(); sync();
  });
  $('#contest-flutter').addEventListener('change', (e) => {
    settings.contestFlutter = e.target.checked; persist();
  });
  $('#contest-mynumber').addEventListener('input', (e) => {
    settings.contestMyNumber = e.target.value.toUpperCase(); persist();
  });

  $('#btn-contest-start').addEventListener('click', startContest);
  $('#btn-contest-stop').addEventListener('click', () => contest.stopSession());

  $('#contest-fkeys').addEventListener('click', (e) => {
    const btn = e.target.closest('.fkey');
    if (btn) runContestAction(btn.dataset.fn);
  });

  // ファンクションキー。コンテストのタブを開いて運用中のときだけ拾う
  document.addEventListener('keydown', (e) => {
    if (!contest.running) return;
    if (!$('#panel-contest').classList.contains('is-active')) return;

    const fnMap = {
      F1: 'cq', F2: 'exchange', F3: 'confirm',
      F4: 'myCall', F5: 'hisCall', F7: 'question', F8: 'again',
    };

    if (fnMap[e.key]) {
      e.preventDefault();
      runContestAction(fnMap[e.key]);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      // 相手が応答済みなら確定、まだなら呼び出しに対する応答を送る
      runContestAction(contest.current ? 'confirm' : 'exchange');
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      $('#contest-call').value = '';
      $('#contest-exch').value = '';
      $('#contest-call').focus();
    }
  });

  contest.addEventListener('tick', renderContestScore);
  contest.addEventListener('state', renderContestScore);
  contest.addEventListener('qso', renderContestLog);
  contest.addEventListener('end', (e) => finishContest(e.detail.score));

  sync();
}

async function startContest() {
  await player.resume();

  contest.start({
    minutes: settings.contestMinutes,
    activity: settings.contestActivity,
    exchange: settings.contestExchange,
    myCall: settings.callsign,
    myNumber: settings.contestMyNumber,
    myWpm: settings.charWpm,
    conditions: {
      qsb: settings.qsb / 100,
      flutter: settings.contestFlutter,
    },
  });

  $('#contest-run').hidden = false;
  $('#contest-result').hidden = true;
  $('#contest-log').innerHTML = '';
  $('#btn-contest-start').disabled = true;
  $('#btn-contest-stop').disabled = false;
  $('#contest-call').value = '';
  $('#contest-exch').value = '';
  $('#contest-call').focus();

  renderContestScore();
  contest.cq();
}

async function runContestAction(action) {
  const call = $('#contest-call').value;
  const exch = $('#contest-exch').value;
  const btn = $(`#contest-fkeys .fkey[data-fn="${action}"]`);

  if (btn) {
    btn.classList.add('is-hot');
    setTimeout(() => btn.classList.remove('is-hot'), 220);
  }

  switch (action) {
    case 'cq':
      $('#contest-call').value = '';
      $('#contest-exch').value = '';
      await contest.cq();
      break;
    case 'exchange':
      await contest.exchange(call);
      break;
    case 'confirm': {
      const entry = await contest.confirm(call, exch);
      if (entry) {
        $('#contest-call').value = '';
        $('#contest-exch').value = '';
        // 実戦と同じく、確定したらすぐ次の CQ に移る
        setTimeout(() => { if (contest.running) contest.cq(); }, 200);
      }
      break;
    }
    case 'myCall': await contest.myCall(); break;
    case 'hisCall': await contest.hisCall(call); break;
    case 'question': await contest.question(); break;
    case 'again': await contest.again(); break;
    default: break;
  }

  $('#contest-call').focus();
}

function renderContestScore() {
  const s = contest.score;
  const remain = contest.remaining;
  const mm = String(Math.floor(remain / 60)).padStart(2, '0');
  const ss = String(Math.floor(remain % 60)).padStart(2, '0');

  $('#contest-score').innerHTML = `
    <div class="stat clock ${remain < 60 ? 'low' : ''}">
      <div class="value">${mm}:${ss}</div><div class="label">残り時間</div>
    </div>
    <div class="stat"><div class="value">${s.valid}</div><div class="label">有効 QSO</div></div>
    <div class="stat"><div class="value">${s.errors}</div><div class="label">ミス</div></div>
    <div class="stat"><div class="value">${s.rate ?? '—'}</div><div class="label">QSO/時</div></div>
    <div class="stat"><div class="value">${Math.round(s.accuracy * 100)}%</div><div class="label">正確度</div></div>
    <div class="stat"><div class="value">${contest.callers.length}</div><div class="label">呼んでいる局</div></div>`;
}

function renderContestLog() {
  $('#contest-log').innerHTML = contest.log.length
    ? contest.log.map((q) => `
        <div class="contest-qso ${q.ok ? 'ok' : 'ng'}">
          <span>${escapeHtml(q.call)} <span class="truth">${escapeHtml(q.exchange)}</span></span>
          ${q.ok ? '' : `<span class="why">${escapeHtml(q.reason)}${
            q.truthCall ? ` → ${escapeHtml(q.truthCall)} ${escapeHtml(q.truthExchange || '')}` : ''
          }</span>`}
          <span class="mark">${q.ok ? '○' : '×'}</span>
        </div>`).join('')
    : '<p class="empty">まだ交信がありません。</p>';
}

function finishContest(score) {
  $('#btn-contest-start').disabled = false;
  $('#btn-contest-stop').disabled = true;

  stats = recordContest(stats, {
    score,
    minutes: settings.contestMinutes,
    exchange: settings.contestExchange,
  });
  saveStats(stats);
  renderStats();

  const box = $('#contest-result');
  box.hidden = false;
  box.innerHTML = `
    <div class="qso-summary">
      <h3>運用終了</h3>
      <div class="score">${score.valid} QSO</div>
      <p class="hint">
        交信 ${score.raw} 局中 ${score.valid} 局が有効（正確度 ${Math.round(score.accuracy * 100)}%）／
        ${score.rate == null ? "毎時ペースは 1 分以上の運用から算出します" : `${score.rate} QSO 毎時ペース`}
      </p>
    </div>
    <div class="turn-actions" style="justify-content:center">
      <button type="button" class="btn btn-primary" id="btn-contest-again">もう一度</button>
    </div>`;

  $('#btn-contest-again').addEventListener('click', startContest);
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ═══════════════════════════════════════════ パドル送信（キーヤー）

const paddle = { detach: null, task: null, elements: '' };

/** 交信の中で実際に打つことの多い定型文。 */
const KEY_PHRASES = [
  'CQ CQ CQ DE {ME} {ME} K',
  '{DX} DE {ME} GE OM TNX FER CALL',
  'UR RST 599 599 = NAME {NAME} {NAME}',
  'QTH {QTH} {QTH} = HW?',
  'R R FB OM ALL SOLID',
  'TNX FER NICE QSO ES 73',
  '{DX} DE {ME} TU 73 <SK>',
  'PSE AGN AGN',
  'QRZ? DE {ME} K',
  'SRI QRM PSE QRS',
];

function initKeyer() {
  const modeSel = $('#keyer-mode');
  modeSel.innerHTML = Object.entries(KEYER_MODES)
    .map(([key, v]) => `<option value="${key}">${v.label}</option>`)
    .join('');

  const pad = $('#keyer-pad');
  const weightOut = $('#keyer-weight-out');
  const wpmOut = $('#keyer-wpm-out');

  const syncKeyer = () => {
    modeSel.value = settings.keyerMode;
    $('#keyer-weight').value = settings.keyerWeight;
    $('#keyer-wpm').value = settings.keyerWpm;
    $('#keyer-swap').checked = settings.keyerSwap;
    $('#keyer-global').checked = settings.keyerGlobal;
    weightOut.textContent = `${settings.keyerWeight}%`;
    wpmOut.textContent = `${settings.keyerWpm} WPM`;
    $('#keyer-mode-help').textContent = KEYER_MODES[settings.keyerMode]?.help || '';
    $('#keyer-pad .pad-hint').innerHTML = settings.keyerSwap
      ? '左ボタン＝長点／右ボタン＝短点（キーボードは <kbd>Z</kbd> / <kbd>X</kbd>）'
      : '左ボタン＝短点／右ボタン＝長点（キーボードは <kbd>Z</kbd> / <kbd>X</kbd>）';

    keyer.setParams({
      mode: settings.keyerMode,
      wpm: settings.keyerWpm,
      weight: settings.keyerWeight,
      swap: settings.keyerSwap,
    });
  };

  // 設定を触ったこと自体がチュートリアルの合格条件になる課題がある
  const touched = (name) => { tutorial.markTouched(name); checkTutorial(); };

  modeSel.addEventListener('change', () => {
    settings.keyerMode = modeSel.value; persist(); syncKeyer(); touched('keyerMode');
  });
  $('#keyer-weight').addEventListener('input', (e) => {
    settings.keyerWeight = Number(e.target.value); persist(); syncKeyer(); touched('keyerWeight');
  });
  $('#keyer-wpm').addEventListener('input', (e) => {
    settings.keyerWpm = Number(e.target.value); persist(); syncKeyer(); touched('keyerWpm');
  });
  $('#keyer-swap').addEventListener('change', (e) => {
    settings.keyerSwap = e.target.checked; persist(); syncKeyer(); touched('keyerSwap');
  });
  $('#keyer-global').addEventListener('change', (e) => {
    settings.keyerGlobal = e.target.checked;
    persist();
    // 取り付け直して捕捉範囲を切り替える
    setPaddleActive(true);
  });

  $('#keyer-task-type').value = settings.keyerTaskType;
  $('#keyer-task-type').addEventListener('change', (e) => {
    settings.keyerTaskType = e.target.value; persist(); newKeyerTask();
  });
  $('#btn-keyer-task').addEventListener('click', newKeyerTask);
  $('#btn-keyer-listen').addEventListener('click', () => {
    if (paddle.task) player.play(paddle.task);
  });
  $('#btn-keyer-grade').addEventListener('click', gradeKeying);
  $('#btn-keyer-clear').addEventListener('click', () => {
    keyer.reset();
    paddle.elements = '';
    $('#keyer-elements').textContent = '';
    $('#keyer-result').innerHTML = '';
    renderKeyedText();
  });

  keyer.addEventListener('element', (e) => {
    paddle.elements = (paddle.elements + e.detail.element).slice(-60);
    $('#keyer-elements').textContent = paddle.elements;
    renderKeyedText();
    tutorial.pushElement(e.detail.element);
    checkTutorial();
  });
  keyer.addEventListener('char', (e) => {
    paddle.elements = '';
    $('#keyer-elements').textContent = '';
    renderKeyedText();
    tutorial.pushChar(e.detail.char);
    checkTutorial();
  });
  keyer.addEventListener('update', renderKeyedText);

  // パッドをクリックしたときにフォーカスを移し、キーボード入力も受けられるようにする
  pad.addEventListener('mousedown', () => pad.focus());

  syncKeyer();
  initTutorial();
  newKeyerTask();
  renderKeyedText();
}

// ───────── チュートリアル ─────────

function initTutorial() {
  $('#btn-tutorial-next').addEventListener('click', () => {
    if (tutorial.isLast) {
      // 最後まで来たら折りたたんで練習に移る
      $('#tutorial').classList.add('is-collapsed');
      $('#btn-tutorial-toggle').textContent = '開く';
      return;
    }
    tutorial.next();
    renderTutorial();
  });
  $('#btn-tutorial-prev').addEventListener('click', () => { tutorial.prev(); renderTutorial(); });
  $('#btn-tutorial-retry').addEventListener('click', () => {
    tutorial.clearInput();
    keyer.reset();
    paddle.elements = '';
    $('#keyer-elements').textContent = '';
    renderTutorial();
  });

  $('#btn-tutorial-toggle').addEventListener('click', () => {
    const card = $('#tutorial');
    const collapsed = card.classList.toggle('is-collapsed');
    $('#btn-tutorial-toggle').textContent = collapsed ? '開く' : 'たたむ';
  });

  // 今のモード・速度・ウェイトで手本を鳴らし、設定の効果を耳で確かめる
  $('#btn-tutorial-sample').addEventListener('click', () => {
    player.play('PARIS PARIS', {
      charWpm: settings.keyerWpm,
      effWpm: settings.keyerWpm,
    });
  });

  $('#tutorial-dots').addEventListener('click', (e) => {
    const dot = e.target.closest('.tutorial-dot');
    if (!dot) return;
    tutorial.goto(Number(dot.dataset.index));
    renderTutorial();
  });

  renderTutorial();
}

function renderTutorial() {
  const step = tutorial.step;
  if (!step) return;

  $('#tutorial-count').textContent = `${tutorial.index + 1} / ${tutorial.total}`;
  $('#tutorial-title').textContent = step.title;
  // 説明文には <strong> のみを意図的に含めている
  $('#tutorial-text').innerHTML = step.body.map((p) => `<p>${p}</p>`).join('');

  $('#tutorial-dots').innerHTML = TUTORIAL_STEPS.map((s, i) => `
    <button type="button" class="tutorial-dot ${
      i === tutorial.index ? 'is-current' : i < tutorial.index ? 'is-done' : ''
    }" data-index="${i}" title="${escapeHtml(s.title)}"></button>`).join('');

  $('#btn-tutorial-prev').disabled = tutorial.index === 0;
  $('#btn-tutorial-next').textContent = tutorial.isLast ? '閉じる' : '次へ';
  $('#btn-tutorial-retry').hidden = !step.check;
  $('#btn-tutorial-sample').hidden = !['speed', 'weight', 'mode'].includes(step.id);

  checkTutorial();
}

/** 合格条件を判定し、満たしていれば表示を更新して自動で次へ進める。 */
function checkTutorial() {
  const step = tutorial.step;
  const goalBox = $('#tutorial-goal');
  if (!step || !goalBox) return;

  if (!step.check) {
    goalBox.className = 'tutorial-goal';
    goalBox.innerHTML =
      `<span class="tag">説明</span><span>${escapeHtml(tutorial.goalText(settings))}</span>`;
    return;
  }

  const cleared = tutorial.isCleared(settings);
  goalBox.className = `tutorial-goal ${cleared ? 'is-cleared' : ''}`;
  goalBox.innerHTML = cleared
    ? '<span class="tag">できました</span><span>次の課題に進みましょう。</span>'
    : `<span class="tag">課題</span><span>${escapeHtml(tutorial.goalText(settings))}</span>`;

  if (cleared && !tutorial.isLast && !tutorial._advancing) {
    // 達成感が残るよう、少し置いてから次のステップへ
    tutorial._advancing = true;
    setTimeout(() => {
      tutorial._advancing = false;
      if (tutorial.isCleared(settings)) { tutorial.next(); renderTutorial(); }
    }, 1400);
  }
}

function renderKeyedText() {
  const box = $('#keyer-decoded');
  const pending = keyer.buffer;
  if (!keyer.text && !pending) {
    box.innerHTML = '<span class="empty">まだ何も打っていません。</span>';
    return;
  }
  box.innerHTML = escapeHtml(keyer.text)
    + (pending ? `<span class="pending">${escapeHtml(pending)}</span>` : '');
}

/** パドル入力の有効・無効を切り替える。 */
function setPaddleActive(active) {
  if (paddle.detach) { paddle.detach(); paddle.detach = null; }
  const pad = $('#keyer-pad');
  if (!pad) return;

  if (!active) {
    keyer.stop();
    pad.classList.remove('is-active');
    $('#lamp-dit')?.classList.remove('on');
    $('#lamp-dah')?.classList.remove('on');
    return;
  }

  keyer.start();
  pad.classList.add('is-active');
  paddle.detach = attachPaddleInput(keyer, pad, {
    global: settings.keyerGlobal,
    onState: (state) => {
      $('#lamp-dit').classList.toggle('on', settings.keyerSwap ? state.right : state.left);
      $('#lamp-dah').classList.toggle('on', settings.keyerSwap ? state.left : state.right);
    },
  });
}

function newKeyerTask() {
  const type = settings.keyerTaskType;
  const preview = $('#keyer-task-text');

  if (type === 'free') {
    paddle.task = null;
    preview.textContent = '自由練習モードです。好きな符号を打ってください。';
    $('#btn-keyer-listen').disabled = true;
  } else if (type === 'phrase') {
    const dx = makeProblem('callsign', {}).answer;
    paddle.task = KEY_PHRASES[Math.floor(Math.random() * KEY_PHRASES.length)]
      .replaceAll('{ME}', settings.callsign)
      .replaceAll('{DX}', dx)
      .replaceAll('{NAME}', settings.name)
      .replaceAll('{QTH}', settings.qth);
    preview.textContent = paddle.task;
    $('#btn-keyer-listen').disabled = false;
  } else {
    paddle.task = makeProblem(type, {}).answer;
    preview.textContent = paddle.task;
    $('#btn-keyer-listen').disabled = false;
  }

  keyer.reset();
  paddle.elements = '';
  $('#keyer-elements').textContent = '';
  $('#keyer-result').innerHTML = '';
  renderKeyedText();
}

function gradeKeying() {
  const sent = keyer.flush();
  const box = $('#keyer-result');

  if (!sent) {
    box.innerHTML = '<p class="hint">まだ符号が解読されていません。パドルで打ってから採点してください。</p>';
    return;
  }
  if (!paddle.task) {
    box.innerHTML = `
      <p class="hint">自由練習では手本との照合はしません。解読結果:</p>
      <div class="diff"><span class="ok">${escapeHtml(sent)}</span></div>`;
    return;
  }

  const result = compareSending(paddle.task, sent);
  const pct = Math.round(result.accuracy * 100);

  stats = recordKeying(stats, {
    correct: result.correct,
    total: result.total,
    target: paddle.task,
    wpm: settings.keyerWpm,
  });
  saveStats(stats);
  renderStats();

  const diff = result.marks
    .map((m) => `<span class="${m.type}">${escapeHtml(m.char === ' ' ? '␣' : m.char)}</span>`)
    .join('');

  box.innerHTML = `
    <div class="score-line">
      <span class="big">${pct}%</span>
      <span class="hint">${result.correct} / ${result.total} 文字一致</span>
    </div>
    <div class="diff">${diff}</div>
    <div class="diff-legend">
      <span><span class="diff"><span class="ok">■</span></span> 一致</span>
      <span><span class="diff"><span class="missing">■</span></span> 打ち漏らし</span>
      <span><span class="diff"><span class="extra">■</span></span> 余分・誤り</span>
    </div>
    <p class="hint">手本: <code>${escapeHtml(paddle.task)}</code></p>
    <p class="hint">あなたの符号: <code>${escapeHtml(sent)}</code></p>
    <div class="drill-actions" style="margin-top:.9rem">
      <button type="button" class="btn btn-primary" id="btn-keyer-next">次の課題</button>
    </div>`;

  $('#btn-keyer-next').addEventListener('click', newKeyerTask);
}

// ═══════════════════════════════════════════ 変換・電鍵

function initTools() {
  const text = $('#tool-text');

  const refresh = () => {
    $('#tool-morse').textContent = toMorseString(text.value);
    const sec = estimateDuration(text.value, settings.charWpm, settings.effWpm);
    $('#tool-duration').textContent = sec ? `約 ${sec.toFixed(1)} 秒` : '';
    $('#tool-annotated').innerHTML = annotateHtml(text.value, escapeHtml);
  };

  text.addEventListener('input', refresh);
  $('#btn-tool-play').addEventListener('click', () => {
    const tokens = tokenize(text.value);
    const patterns = tokens.map((t) => (t.type === 'space' ? '/' : t.pattern));
    const tracker = settings.beginnerMode ? createTracker(text.value) : null;
    const explain = $('#tool-explain');
    explain.innerHTML = tracker
      ? '<p class="explain-empty">送信中の語をここに解説します。</p>'
      : '<p class="explain-empty">初心者モードをオンにすると、送信中の語を順に解説します。</p>';

    player.play(text.value, {
      onToken: (token, index) => {
        $('#tool-morse').innerHTML = patterns
          .map((p, n) => (n === index ? `<span class="cur">${p}</span>` : p))
          .join(' ');
        if (!tracker) return;

        const hit = tracker.step(index);
        if (!hit) return;
        $$('.explain-card.is-current', explain).forEach((el) => el.classList.remove('is-current'));
        if (!hit.entry) return;

        $('.explain-empty', explain)?.remove();
        const card = document.createElement('div');
        card.className = 'explain-card is-current';
        card.innerHTML =
          `<span class="code">${escapeHtml(hit.entry.term)}</span>` +
          `<span class="desc">${escapeHtml(hit.entry.ja)}</span>`;
        explain.prepend(card);
        while (explain.children.length > 10) explain.lastElementChild.remove();
      },
    }).then(() => refresh());
  });
  $('#btn-tool-stop').addEventListener('click', () => { player.stop(); refresh(); });

  // 電鍵
  const key = $('#btn-key');
  const down = (e) => { e.preventDefault(); key.classList.add('is-down'); player.keyOn(); };
  const up = (e) => { e.preventDefault(); key.classList.remove('is-down'); player.keyOff(); };

  key.addEventListener('mousedown', down);
  key.addEventListener('mouseup', up);
  key.addEventListener('mouseleave', up);
  key.addEventListener('touchstart', down, { passive: false });
  key.addEventListener('touchend', up);
  key.addEventListener('touchcancel', up);

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || e.repeat) return;
    if (!$('#panel-tools').classList.contains('is-active')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    e.preventDefault();
    key.classList.add('is-down');
    player.keyOn();
  });
  document.addEventListener('keyup', (e) => {
    if (e.code !== 'Space') return;
    key.classList.remove('is-down');
    player.keyOff();
  });

  refresh();
}

// ═══════════════════════════════════════════ 略語集

function initGlossary() {
  const list = $('#glossary-list');

  const render = (query = '') => {
    const q = query.trim().toLowerCase();
    const items = ABBREVIATIONS.filter(
      (a) => !q || a.code.toLowerCase().includes(q) || a.ja.toLowerCase().includes(q),
    );
    list.innerHTML = items.length
      ? items.map((a) => `
          <button type="button" class="gloss-item" data-code="${escapeHtml(a.code)}">
            <span class="code">${escapeHtml(a.code)}</span>
            <span class="ja">${escapeHtml(a.ja)}</span>
          </button>`).join('')
      : '<p class="empty">該当する略語がありません。</p>';
  };

  list.addEventListener('click', (e) => {
    const item = e.target.closest('.gloss-item');
    if (item) player.play(item.dataset.code);
  });
  $('#glossary-search').addEventListener('input', (e) => render(e.target.value));

  render();
}

// ═══════════════════════════════════════════ 設定・記録

function initSettings() {
  const textFields = ['callsign', 'name', 'qth', 'rig', 'pwr', 'ant', 'wx'];
  textFields.forEach((key) => {
    const el = $(`#set-${key}`);
    el.value = settings[key];
    el.addEventListener('input', () => {
      settings[key] = el.value.toUpperCase();
      persist();
      updateMyProfileLine();
    });
  });

  const ranges = [
    ['freq', (v) => `${v} Hz`, (v) => v],
    ['qrn', (v) => `${v}%`, (v) => v],
    ['qsb', (v) => `${v}%`, (v) => v],
    ['qrm', (v) => `${v}%`, (v) => v],
  ];
  ranges.forEach(([key, fmt]) => {
    const el = $(`#set-${key}`);
    const out = $(`#set-${key}-out`);
    el.value = settings[key];
    out.textContent = fmt(settings[key]);
    el.addEventListener('input', () => {
      settings[key] = Number(el.value);
      out.textContent = fmt(settings[key]);
      applyAudioSettings();
      persist();
    });
  });

  const showText = $('#set-showtext');
  showText.checked = settings.showText;
  showText.addEventListener('change', () => {
    settings.showText = showText.checked; persist();
  });

  const beginner = $('#set-beginner');
  beginner.checked = settings.beginnerMode;
  beginner.addEventListener('change', () => {
    settings.beginnerMode = beginner.checked;
    persist();
    syncBeginnerToggles();
  });

  $('#btn-reset-stats').addEventListener('click', () => {
    if (!confirm('学習の記録をすべて消去します。よろしいですか？')) return;
    stats = resetStats();
    renderStats();
  });
}

function renderStats() {
  const d = stats.drills;
  const q = stats.qso;
  const k = stats.keying || { attempts: 0, chars: 0, correct: 0 };
  const c = stats.contest || { sessions: 0, qsos: 0, valid: 0, bestRate: 0 };

  const pct = (num, den) => (den ? `${Math.round((num / den) * 100)}%` : '—');

  $('#stat-summary').innerHTML = [
    ['ドリル回数', d.attempts],
    ['ドリル正答率', pct(d.correct, d.chars)],
    ['受信文字数', d.chars],
    ['交信回数', q.completed],
    ['交信書取率', pct(q.correct, q.fields)],
    ['送信練習', k.attempts],
    ['送信一致率', pct(k.correct, k.chars)],
    ['コンテスト', `${c.valid} QSO`],
    ['最高ペース', c.bestRate ? `${c.bestRate}/h` : '—'],
  ].map(([label, value]) => `
    <div class="stat">
      <div class="value">${escapeHtml(value)}</div>
      <div class="label">${escapeHtml(label)}</div>
    </div>`).join('');

  const weak = weakChars(stats);
  $('#weak-chars').innerHTML = weak.length
    ? weak.map((w) => `
        <span class="weak-char">
          <span class="ch">${escapeHtml(w.char)}</span>${Math.round(w.accuracy * 100)}%
          <span class="hint" style="display:inline">(${w.sent})</span>
        </span>`).join('')
    : '<p class="empty">まだ十分なデータがありません。ドリルを 5 回ほど試してください。</p>';

  $('#history-list').innerHTML = stats.history.length
    ? stats.history.slice(0, 20).map((h) => {
        const when = new Date(h.at).toLocaleString('ja-JP', {
          month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
        });
        let what;
        if (h.kind === 'qso') what = `QSO ${h.station}`;
        else if (h.kind === 'keying') what = `送信 ${h.target || ''}`;
        else if (h.kind === 'contest') what = `コンテスト ${h.minutes}分 ${h.rate ?? 0}/h`;
        else what = `${DRILL_TYPES[h.type]?.label || h.type}${h.level ? ` Lv${h.level}` : ''}`;

        return `<div class="history-item">
            <span>${escapeHtml(when)} ${escapeHtml(what)}</span>
            <span class="acc">${Math.round(h.accuracy * 100)}%</span>
          </div>`;
      }).join('')
    : '<p class="empty">まだ記録がありません。</p>';
}

init();

// 動作確認や自動テストから内部状態を触るためのハンドル。
// 画面の操作には使っていない。
window.__cw = {
  player, keyer, contest, responder,
  get settings() { return settings; },
  get stats() { return stats; },
  get qsoScript() { return qso.script; },
  get qsoTurn() { return qso.script?.turns[qso.index] ?? null; },
  get drillProblem() { return drill.problem; },
  get keyerTask() { return paddle.task; },
};
