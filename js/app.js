// 画面の組み立てとイベント配線

import { CWPlayer } from './audio.js';
import { toMorseString, estimateDuration, tokenize } from './morse.js';
import { ABBREVIATIONS, FREQUENCY_ORDER, KOCH_ORDER } from './data.js';
import { annotateHtml, createTracker, explainText } from './explain.js';
import { DRILL_TYPES, gradeProblem, makeProblem, shouldLevelUp } from './drills.js';
import { LocalResponder, gradeField, REACTION_LABELS } from './qso.js';
import { PHASES, PATTERN_SHEET, makeReplyOptions, readDxTurn } from './qsoguide.js';
import { ElectronicKeyer, KEYER_MODES, attachPaddleInput, compareSending } from './keyer.js';
import { ContestRunner, EXCHANGE_TYPES, RUN_MODES } from './contest.js';
import {
  QSO_ERROR, QSO_ERROR_LABEL, loadHighScores, saveHighScore,
} from './contestlog.js';
import { Tutorial, TUTORIAL_STEPS } from './tutorial.js';
import {
  loadSettings, saveSettings, loadStats, saveStats, resetStats,
  recordDrill, recordQso, recordKeying, recordContest, weakChars,
  paddleAssignment,
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
  initPaddleWidget();
  renderStats();
}

// ═══════════════════════════════════════════ 常時表示のパドルウィジェット
//
// パドル入力を受け付ける範囲を常に画面に示し、どのタブでもこの枠内なら
// 打てるようにする。キーボード(Z/X)はパドル送信タブ側の接続が担当するので
// ここでは繋がない（二重発火防止）。

function initPaddleWidget() {
  const widget = $('#paddle-widget');
  const padBody = $('#pw-pad');

  // 折りたたみ状態を復元
  widget.classList.toggle('is-closed', !settings.paddleWidgetOpen);
  $('#pw-toggle').addEventListener('click', () => {
    settings.paddleWidgetOpen = widget.classList.contains('is-closed');
    widget.classList.toggle('is-closed', !settings.paddleWidgetOpen);
    persist();
  });

  // 最初の操作で側音ラインを開く（AudioContext はユーザー操作が必要）
  const ensureLine = () => { player.openKeyLine(); };
  padBody.addEventListener('mousedown', ensureLine, { capture: true });
  padBody.addEventListener('touchstart', ensureLine, { capture: true, passive: true });

  attachPaddleInput(keyer, padBody, {
    keyboard: false,
    onState: (state) => {
      $('#pw-left').classList.toggle('on', state.left);
      $('#pw-right').classList.toggle('on', state.right);
      $('#lamp-left')?.classList.toggle('on', state.left);
      $('#lamp-right')?.classList.toggle('on', state.right);
    },
  });

  syncPaddleWidget();
}

/** ウィジェットの表示（割り当て・入力範囲の説明）を現在の設定に合わせる。 */
function syncPaddleWidget() {
  const widget = $('#paddle-widget');
  if (!widget) return;
  const map = paddleAssignment(settings);
  const label = (el) => (el === 'dit' ? '・ 短点' : '－ 長点');

  $('#pw-left').textContent = label(map.left);
  $('#pw-right').textContent = label(map.right);
  $('#pw-mini').textContent = `${settings.keyerWpm} WPM`;

  const onKeyerTab = $('#panel-keyer')?.classList.contains('is-active');
  let scope = 'この枠内はいつでもパドル入力を受け付けます（左半分＝左ボタン扱い）。';
  if (onKeyerTab) {
    scope = settings.keyerGlobal
      ? '現在は画面全体でパドル入力を受け付けています（ボタンや入力欄の上を除く）。'
      : 'この枠内と、パドル送信タブのパッドで入力を受け付けています。';
  }
  $('#pw-scope').textContent = scope;
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
    bandwidth: settings.bandwidth,
    qsk: settings.qsk,
    rit: settings.rit ?? 0,
    keyerFreq: settings.keyerFreq ?? 700,
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
      syncPaddleWidget();
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

  const reactionSel = $('#qso-reaction');
  reactionSel.innerHTML = Object.entries(REACTION_LABELS)
    .map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
  reactionSel.value = settings.qsoReaction;

  $('#qso-mode').addEventListener('change', (e) => {
    settings.qsoMode = e.target.value; persist();
  });
  $('#qso-length').addEventListener('change', (e) => {
    settings.qsoLength = e.target.value; persist();
  });
  reactionSel.addEventListener('change', (e) => {
    settings.qsoReaction = e.target.value; persist();
  });

  $('#qso-style').addEventListener('click', (e) => {
    const btn = e.target.closest('.style-option');
    if (!btn) return;
    settings.qsoStyle = btn.dataset.style;
    persist();
    syncQsoStyle();
  });

  $('#btn-pattern-toggle').addEventListener('click', () => {
    const body = $('#pattern-body');
    body.hidden = !body.hidden;
    $('#btn-pattern-toggle').textContent = body.hidden ? '開く' : 'たたむ';
  });

  renderPatternSheet();
  syncQsoStyle();
  $('#btn-qso-start').addEventListener('click', startQso);
  updateMyProfileLine();

  // 実技モードの打鍵表示。#qso-keyed が画面に無ければ何もしない
  const updateLiveKeyed = () => {
    const el = $('#qso-keyed');
    if (!el) return;
    const pending = keyer.buffer;
    if (!keyer.text && !pending) {
      el.innerHTML = '<span class="empty hint">パドルで打ち始めてください。</span>';
      return;
    }
    el.innerHTML = escapeHtml(keyer.text)
      + (pending ? `<span class="pending">${escapeHtml(pending)}</span>` : '');
  };
  keyer.addEventListener('update', updateLiveKeyed);
  keyer.addEventListener('element', updateLiveKeyed);
  keyer.addEventListener('char', updateLiveKeyed);
}

function syncQsoStyle() {
  $$('#qso-style .style-option').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.style === settings.qsoStyle);
  });
}

/** 型の早見表を描く。自局・相手局のコールサインは実際の設定を当てはめる。 */
function renderPatternSheet() {
  const my = settings.callsign;
  const dx = 'DL1ABC';

  $('#pattern-body').innerHTML = PATTERN_SHEET.map((step) => {
    const info = PHASES[step.phase] || {};
    const who = step.who === '自分' ? 'me' : step.who === '相手' ? 'dx' : 'both';
    const example = step.example.replaceAll('<MY>', my).replaceAll('<DX>', dx);

    return `
      <div class="pattern-step who-${who}">
        <div class="pattern-head">
          <span class="pattern-title">${escapeHtml(info.title || step.phase)}</span>
          <span class="pattern-who">${escapeHtml(step.who)}</span>
        </div>
        <p class="hint" style="margin:.2rem 0">${escapeHtml(info.purpose || '')}</p>
        <div class="pattern-example">${annotateHtml(example, escapeHtml)}</div>
        <div class="pattern-parts">
          ${step.parts.map(([code, meaning]) => `
            <div class="pattern-part">
              <code>${escapeHtml(code.replaceAll('<MY>', my).replaceAll('<DX>', dx))}</code>
              <span>${escapeHtml(meaning)}</span>
            </div>`).join('')}
        </div>
        ${info.tip ? `<p class="hint">${escapeHtml(info.tip)}</p>` : ''}
      </div>`;
  }).join('');
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
    reaction: settings.qsoReaction,
  });
  qso.index = 0;
  qso.results = [];
  qso.choices = [];
  qso.liveScores = [];

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

  if (settings.qsoStyle === 'guided') return renderGuidedTurn(turn, box);
  if (settings.qsoStyle === 'live') return renderLiveTurn(turn, box);

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
      await playText(turn.text, '#qso-playing', {
        explainSelector: '#qso-explain',
        freq: settings.keyerFreq,   // 自局の送信は送信音の高さで鳴らす
      });
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

// ───────── ガイド付き模擬交信 ─────────

/** 現在の段階を示す帯。 */
function phaseBanner(turn) {
  const info = PHASES[turn.phase] || {};
  const total = qso.script.turns.length;
  return `
    <div class="phase-banner">
      <span class="phase-step">${qso.index + 1} / ${total}</span>
      <span class="phase-name">${escapeHtml(info.title || '')}</span>
      <span class="turn-badge ${turn.side === 'me' ? 'tx' : 'rx'}">
        ${turn.side === 'me' ? '自分が送信' : '相手が送信'}</span>
      <span class="phase-purpose">${escapeHtml(info.purpose || '')}</span>
    </div>`;
}

function renderGuidedTurn(turn, box) {
  const info = PHASES[turn.phase] || {};

  if (turn.side === 'dx') {
    // 相手の送信は、聞かせてから中身と意味を明かす
    box.innerHTML = `
      ${phaseBanner(turn)}
      <p class="hint">まず聞いてみてください。そのあと本文と意味を表示します。</p>
      <div class="playing-char" id="qso-playing"></div>
      <div class="explain-live" id="qso-explain"></div>
      <div class="turn-actions">
        <button type="button" class="btn" id="btn-guide-listen">もう一度聞く</button>
        <button type="button" class="btn btn-primary" id="btn-guide-reveal">内容を見る</button>
      </div>`;

    const opts = { explainSelector: '#qso-explain' };
    $('#btn-guide-listen').addEventListener('click', () => playText(turn.text, '#qso-playing', opts));
    $('#btn-guide-reveal').addEventListener('click', () => revealDxTurn(turn, box));
    playText(turn.text, '#qso-playing', opts);
    return;
  }

  // 自分の送信は、選択肢から選ばせる
  const options = makeReplyOptions(turn, qso.script);
  qso.currentOptions = options;

  box.innerHTML = `
    ${phaseBanner(turn)}
    ${info.tip ? `<div class="guide-tip"><strong>ここでのコツ</strong><br>${escapeHtml(info.tip)}</div>` : ''}
    <p class="hint">この場面で送るべきものはどれでしょう。選ぶと理由を表示します。</p>
    <div class="choices" id="qso-choices">
      ${options.map((opt, i) => `
        <button type="button" class="choice" data-index="${i}">
          ${escapeHtml(opt.text)}
        </button>`).join('')}
    </div>`;

  $('#qso-choices').addEventListener('click', (e) => {
    const btn = e.target.closest('.choice');
    if (btn) answerChoice(Number(btn.dataset.index), turn, box);
  });
}

function answerChoice(index, turn, box) {
  if (qso.graded) return;
  qso.graded = true;

  const options = qso.currentOptions;
  const chosen = options[index];
  qso.choices.push({ correct: !!chosen.correct, phase: turn.phase });

  // どれがなぜ駄目なのかを学べるよう、全選択肢に理由を出す
  $$('#qso-choices .choice').forEach((btn, i) => {
    const opt = options[i];
    btn.disabled = true;
    btn.classList.add(opt.correct ? 'is-correct' : 'is-wrong');

    const verdict = opt.correct
      ? (i === index ? '正解。これが定型です。' : 'こちらが正しい送信でした。')
      : `${i === index ? 'これを選びました。' : ''}${opt.why}`;
    btn.insertAdjacentHTML('beforeend', `<span class="verdict">${escapeHtml(verdict)}</span>`);
  });

  const correctText = options.find((o) => o.correct).text;
  box.insertAdjacentHTML('beforeend', `
    <h4>実際に送る内容</h4>
    <div class="annotated">${annotateHtml(correctText, escapeHtml)}</div>
    <div class="playing-char" id="qso-playing"></div>
    <div class="explain-live" id="qso-explain"></div>
    <div class="turn-actions">
      <button type="button" class="btn btn-primary" id="btn-guide-send">送信して次へ</button>
      <button type="button" class="btn btn-ghost" id="btn-guide-skip">音を飛ばして次へ</button>
    </div>`);

  $('#btn-guide-send').addEventListener('click', async (e) => {
    e.target.disabled = true;
    await playText(correctText, '#qso-playing', {
      explainSelector: '#qso-explain',
      freq: settings.keyerFreq,
      ...(turn.slow ? { charWpm: Math.max(8, settings.charWpm - 6), effWpm: Math.max(6, settings.effWpm - 4) } : {}),
    });
    advanceTurn({ ...turn, text: correctText }, { reveal: true });
  });
  $('#btn-guide-skip').addEventListener('click', () => {
    player.stop();
    advanceTurn({ ...turn, text: correctText }, { reveal: true });
  });
}

/** 相手の送信内容を明かし、意味と次の一手を説明する。 */
function revealDxTurn(turn, box) {
  player.stop();
  const reaction = readDxTurn(turn);
  const isTwist = reaction.key !== 'normal';

  box.innerHTML = `
    ${phaseBanner(turn)}
    <h4>相手が送ってきた内容</h4>
    <div class="annotated">${annotateHtml(turn.text, escapeHtml)}</div>
    <div class="playing-char" id="qso-playing"></div>

    <div class="reaction-note">
      <span class="rlabel">${escapeHtml(reaction.label)}</span>
      ${escapeHtml(reaction.meaning)}
      <span class="rwhat">→ ${escapeHtml(reaction.whatToDo)}</span>
    </div>

    ${turn.wrongCall ? `<p class="hint">
      相手は <code>${escapeHtml(turn.wrongCall)}</code> と打っています。
      あなたのコールサインは <code>${escapeHtml(qso.script.profile.callsign)}</code> です。</p>` : ''}

    ${termListHtml(turn.text)}

    <div class="turn-actions">
      <button type="button" class="btn" id="btn-guide-relisten">もう一度聞く</button>
      <button type="button" class="btn btn-primary" id="btn-guide-next">次へ</button>
    </div>`;

  $('#btn-guide-relisten').addEventListener('click', () => playText(turn.text, '#qso-playing'));
  $('#btn-guide-next').addEventListener('click', () => advanceTurn(turn, { reveal: true }));

  if (isTwist) qso.hadTwist = true;
}

// ───────── 実技（パドルで打つ） ─────────

/**
 * 実技モード。相手の送信はガイドと同じ流れ（聞く → 内容と意味を見る）で、
 * 自分の送信は実際にパドルで打つ。打った符号は手本と文字単位で照合する。
 */
function renderLiveTurn(turn, box) {
  if (turn.side === 'dx') return renderGuidedTurn(turn, box);

  const info = PHASES[turn.phase] || {};
  player.openKeyLine();   // 側音のラインを開いておく（初回はここで AudioContext も起きる）
  keyer.reset();

  box.innerHTML = `
    ${phaseBanner(turn)}
    ${info.tip ? `<div class="guide-tip"><strong>ここでのコツ</strong><br>${escapeHtml(info.tip)}</div>` : ''}
    <p class="hint">
      下の内容を、パドルで実際に打って送信してください。
      画面右下の「パドル」枠の左右をクリック（パドルを接続していればそのまま打鍵）できます。
      <code>=</code> は BT（－…－）、<code>&lt;SK&gt;</code> はプロサインとして続けて打ちます。
    </p>
    <h4>打つ内容</h4>
    <div class="annotated">${annotateHtml(turn.text, escapeHtml)}</div>
    <h4>あなたの符号</h4>
    <div class="live-keyed" id="qso-keyed"><span class="empty hint">パドルで打ち始めてください。</span></div>
    <div class="turn-actions">
      <button type="button" class="btn" id="btn-live-example">お手本を聞く</button>
      <button type="button" class="btn btn-ghost" id="btn-live-clear">打ち直す</button>
      <button type="button" class="btn btn-primary" id="btn-live-grade">送信を終える（採点）</button>
      <button type="button" class="btn btn-ghost" id="btn-live-skip">この送信を飛ばす</button>
    </div>
    <div id="qso-live-result"></div>`;

  $('#btn-live-example').addEventListener('click', () => {
    playText(turn.text, null, { freq: settings.keyerFreq, charWpm: settings.keyerWpm, effWpm: settings.keyerWpm });
  });
  $('#btn-live-clear').addEventListener('click', () => keyer.reset());
  $('#btn-live-skip').addEventListener('click', () => {
    player.stop();
    advanceTurn(turn, { reveal: true });
  });
  $('#btn-live-grade').addEventListener('click', () => gradeLiveTurn(turn));
}

function gradeLiveTurn(turn) {
  if (qso.graded) return;
  qso.graded = true;
  player.stop();

  const sent = keyer.flush();
  const result = compareSending(turn.text, sent);
  qso.liveScores.push(result.accuracy);

  const diff = result.marks
    .map((m) => `<span class="${m.type}">${escapeHtml(m.char === ' ' ? '␣' : m.char)}</span>`)
    .join('');

  $('#qso-live-result').innerHTML = `
    <div class="score-line">
      <span class="big">${Math.round(result.accuracy * 100)}%</span>
      <span class="hint">${result.correct} / ${result.total} 文字一致</span>
    </div>
    <div class="diff">${diff}</div>
    <div class="diff-legend">
      <span><span class="diff"><span class="ok">■</span></span> 一致</span>
      <span><span class="diff"><span class="missing">■</span></span> 打ち漏らし</span>
      <span><span class="diff"><span class="extra">■</span></span> 余分・誤り</span>
    </div>
    <div class="turn-actions">
      <button type="button" class="btn" id="btn-live-retry">もう一度打つ</button>
      <button type="button" class="btn btn-primary" id="btn-live-next">この内容で送信して次へ</button>
    </div>`;

  $('#btn-live-retry').addEventListener('click', () => {
    // 直前の採点は取り消して打ち直す
    qso.liveScores.pop();
    qso.graded = false;
    keyer.reset();
    $('#qso-live-result').innerHTML = '';
  });
  $('#btn-live-next').addEventListener('click', () => advanceTurn(turn, { reveal: true }));
}

function renderLiveSummary() {
  const scores = qso.liveScores;
  const avg = scores.length
    ? scores.reduce((a, b) => a + b, 0) / scores.length
    : 0;
  const good = scores.filter((a) => a >= 0.9).length;

  stats = recordQso(stats, {
    correct: good,
    total: scores.length,
    station: qso.script.station.callsign,
    wpm: settings.keyerWpm,
  });
  saveStats(stats);
  renderStats();

  $('#qso-turn').innerHTML = `
    <div class="qso-summary">
      <h3>交信終了 — ${escapeHtml(qso.script.station.callsign)}</h3>
      <div class="score">${Math.round(avg * 100)}%</div>
      <p class="hint">
        自分で打った送信の平均一致率（${scores.length} 回中 ${good} 回が 90% 以上）
      </p>
    </div>
    <div class="guide-tip">
      <strong>次の一歩</strong><br>
      一致率が安定して 90% を超えるようになったら、送信速度を 1〜2 WPM 上げてみてください。
      「相手の反応」をおまかせにすると、聞き返しへの対応も含めた通し練習になります。
    </div>
    <div class="turn-actions" style="justify-content:center">
      <button type="button" class="btn btn-primary" id="btn-qso-again">もう一局</button>
    </div>`;

  $('#btn-qso-again').addEventListener('click', startQso);
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
  if (settings.qsoStyle === 'guided') return renderGuidedSummary();
  if (settings.qsoStyle === 'live') return renderLiveSummary();

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

function renderGuidedSummary() {
  const total = qso.choices.length;
  const correct = qso.choices.filter((c) => c.correct).length;
  const pct = total ? Math.round((correct / total) * 100) : 100;

  stats = recordQso(stats, {
    correct,
    total,
    station: qso.script.station.callsign,
    wpm: settings.charWpm,
  });
  saveStats(stats);
  renderStats();

  const reaction = qso.script.reaction;
  const twist = reaction && reaction !== 'normal'
    ? `<p class="hint">今回の相手は「${escapeHtml(REACTION_LABELS[reaction] || reaction)}」でした。</p>`
    : '';

  $('#qso-turn').innerHTML = `
    <div class="qso-summary">
      <h3>交信終了 — ${escapeHtml(qso.script.station.callsign)}</h3>
      <div class="score">${correct} / ${total}</div>
      <p class="hint">送信の選択が正しかった回数（${pct}%）</p>
      ${twist}
    </div>
    <div class="guide-tip">
      <strong>次の一歩</strong><br>
      型に慣れてきたら「相手の反応」を<em>おまかせ</em>にして、
      聞き返しや取り違えへの対処も練習してください。
      その後、上の「聞き取り練習」に切り替えると実力を試せます。
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

const CONDITION_KEYS = ['qrn', 'qrm', 'qsb', 'flutter', 'lids'];

function initContest() {
  const modeSel = $('#contest-mode');
  modeSel.innerHTML = Object.entries(RUN_MODES)
    .map(([key, v]) => `<option value="${key}">${v.label}</option>`).join('');

  const exchangeSel = $('#contest-exchange');
  exchangeSel.innerHTML = Object.entries(EXCHANGE_TYPES)
    .map(([key, v]) => `<option value="${key}">${v.label}</option>`).join('');

  const sync = () => {
    modeSel.value = settings.contestMode;
    exchangeSel.value = settings.contestExchange;
    $('#contest-minutes').value = String(settings.contestMinutes);
    $('#contest-activity').value = settings.contestActivity;
    $('#contest-activity-out').textContent = `${settings.contestActivity} / 9`;
    $('#contest-mynumber').value = settings.contestMyNumber;
    $('#contest-record').checked = settings.contestRecord;
    $('#contest-mode-help').textContent = RUN_MODES[settings.contestMode]?.help || '';
    $('#contest-exchange-help').textContent = EXCHANGE_TYPES[settings.contestExchange]?.help || '';
    CONDITION_KEYS.forEach((k) => { $(`#cond-${k}`).checked = settings[condKey(k)]; });

    // 競技モードは条件と時間が規定で決まるため、設定を触れなくする
    const fixed = settings.contestMode === 'wpx' || settings.contestMode === 'hst';
    $('#contest-minutes-field').hidden = fixed;
    $('#contest-activity-field').hidden = settings.contestMode === 'single';
    $$('#contest-conditions input').forEach((el) => { el.disabled = fixed; });
    $('#contest-cond-note').textContent = fixed
      ? (settings.contestMode === 'wpx'
        ? 'WPX 競技では条件が固定されます（全条件あり・30 分・マルチはプリフィックス）。'
        : 'HST 競技では妨害の無い理想的な条件で 10 分間行います。')
      : 'LID は、呼び回しの割り込み・符号の打ち間違い・おかしな RST などを起こす局です。';

    $('#contest-rit').value = String(settings.rit ?? 0);
    $('#contest-rit-out').textContent = `${settings.rit ?? 0} Hz`;
    $('#contest-bandwidth').value = String(settings.bandwidth);
    $('#contest-qsk').checked = settings.qsk;
  };

  modeSel.addEventListener('change', () => { settings.contestMode = modeSel.value; persist(); sync(); });
  exchangeSel.addEventListener('change', () => { settings.contestExchange = exchangeSel.value; persist(); sync(); });
  $('#contest-minutes').addEventListener('change', (e) => { settings.contestMinutes = Number(e.target.value); persist(); });
  $('#contest-activity').addEventListener('input', (e) => { settings.contestActivity = Number(e.target.value); persist(); sync(); });
  $('#contest-mynumber').addEventListener('input', (e) => { settings.contestMyNumber = e.target.value.toUpperCase(); persist(); });
  $('#contest-record').addEventListener('change', (e) => { settings.contestRecord = e.target.checked; persist(); });

  CONDITION_KEYS.forEach((k) => {
    $(`#cond-${k}`).addEventListener('change', (e) => {
      settings[condKey(k)] = e.target.checked;
      persist();
      applyAudioSettings();
    });
  });

  // 受信系のつまみは運用中でも即座に効く
  $('#contest-rit').addEventListener('input', (e) => {
    settings.rit = Number(e.target.value);
    $('#contest-rit-out').textContent = `${settings.rit} Hz`;
    player.setSettings({ rit: settings.rit });
    persist();
  });
  $('#contest-bandwidth').addEventListener('change', (e) => {
    settings.bandwidth = Number(e.target.value);
    player.setSettings({ bandwidth: settings.bandwidth });
    persist();
  });
  $('#contest-qsk').addEventListener('change', (e) => {
    settings.qsk = e.target.checked;
    player.setSettings({ qsk: settings.qsk });
    if (settings.qsk) player.releaseRx();
    persist();
  });

  $('#btn-contest-start').addEventListener('click', startContest);
  $('#btn-contest-stop').addEventListener('click', () => contest.stopSession());

  $('#contest-fkeys').addEventListener('click', (e) => {
    const btn = e.target.closest('.fkey');
    if (btn) runContestAction(btn.dataset.fn);
  });

  document.addEventListener('keydown', onContestKey);

  contest.addEventListener('tick', renderContestScore);
  contest.addEventListener('state', renderContestScore);
  contest.addEventListener('qso', () => { renderContestScore(); renderContestLog(); });
  contest.addEventListener('end', (e) => finishContest(e.detail.score));

  sync();
}

function condKey(k) {
  return `cond${k.charAt(0).toUpperCase()}${k.slice(1)}`;
}

const FKEY_MAP = {
  F1: 'cq', F2: 'exchange', F3: 'confirm', F4: 'myCall',
  F5: 'hisCall', F6: 'b4', F7: 'question', F8: 'again',
};

function onContestKey(e) {
  if (!contest.running) return;
  if (!$('#panel-contest').classList.contains('is-active')) return;

  if (FKEY_MAP[e.key]) {
    e.preventDefault();
    runContestAction(FKEY_MAP[e.key]);
    return;
  }

  switch (e.key) {
    case 'Enter':
      e.preventDefault();
      // 相手が応答済みなら確定、まだなら呼び出しに応答する
      runContestAction(contest.current ? 'confirm' : 'exchange');
      break;

    case ' ': {
      // 部分的に打ち込んだコールサインを、呼んでいる局から補完する
      if (e.target !== $('#contest-call')) return;
      e.preventDefault();
      const full = contest.autoComplete($('#contest-call').value);
      if (full) {
        $('#contest-call').value = full;
      } else {
        $('#contest-exch').focus();
      }
      break;
    }

    case 'Escape':
      e.preventDefault();
      player.stop();
      $('#contest-call').value = '';
      $('#contest-exch').value = '';
      $('#contest-call').focus();
      break;

    case 'ArrowUp':
    case 'ArrowDown': {
      e.preventDefault();
      const step = e.key === 'ArrowUp' ? 20 : -20;
      const rit = Math.max(-500, Math.min(500, (settings.rit ?? 0) + step));
      settings.rit = rit;
      $('#contest-rit').value = String(rit);
      $('#contest-rit-out').textContent = `${rit} Hz`;
      player.setSettings({ rit });
      persist();
      break;
    }

    default:
      break;
  }
}

async function startContest() {
  await player.resume();

  player.setSettings({
    bandwidth: settings.bandwidth,
    qsk: settings.qsk,
    rit: settings.rit ?? 0,
  });

  contest.start({
    mode: settings.contestMode,
    minutes: settings.contestMinutes,
    activity: settings.contestActivity,
    exchange: settings.contestExchange,
    myCall: settings.callsign,
    myNumber: settings.contestMyNumber,
    myWpm: settings.charWpm,
    conditions: {
      qrn: settings.condQrn ? 0.5 : 0,
      qrm: settings.condQrm ? 0.5 : 0,
      qsb: settings.condQsb ? 0.6 : 0,
      flutter: settings.condFlutter,
      lids: settings.condLids,
    },
  });

  // 実際に鳴る空電の強さは、運用モードが決めた条件に合わせる
  player.setSettings({ qrn: contest.opts.conditions.qrn ?? 0 });

  if (settings.contestRecord) await player.startRecording();

  $('#contest-run').hidden = false;
  $('#contest-result').hidden = true;
  $('#contest-log').innerHTML = '';
  $('#btn-contest-start').disabled = true;
  $('#btn-contest-stop').disabled = false;
  $('#contest-call').value = '';
  $('#contest-exch').value = '';
  $('#contest-call').focus();

  renderContestScore();
  renderContestLog();
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
        setTimeout(() => { if (contest.running) contest.cq(); }, 200);
      }
      break;
    }
    case 'myCall': await contest.myCall(); break;
    case 'hisCall': await contest.hisCall(call); break;
    case 'b4': await contest.b4(call); break;
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
  const wpx = contest.opts?.mode === 'wpx';

  const tiles = [
    `<div class="stat clock ${remain < 60 ? 'low' : ''}">
       <div class="value">${mm}:${ss}</div><div class="label">残り時間</div></div>`,
    `<div class="stat"><div class="value">${s.points}</div><div class="label">有効 QSO</div></div>`,
    `<div class="stat"><div class="value">${s.errors}</div><div class="label">ミス</div></div>`,
  ];
  if (wpx) {
    tiles.push(`<div class="stat"><div class="value">${s.mults}</div><div class="label">マルチ</div></div>`);
    tiles.push(`<div class="stat"><div class="value">${s.score}</div><div class="label">得点</div></div>`);
  }
  tiles.push(`<div class="stat"><div class="value">${s.rate}</div><div class="label">QSO/時</div></div>`);
  tiles.push(`<div class="stat"><div class="value">${Math.round(s.accuracy * 100)}%</div><div class="label">正確度</div></div>`);
  tiles.push(`<div class="stat"><div class="value">${s.callers}</div><div class="label">呼んでいる局</div></div>`);

  $('#contest-score').innerHTML = tiles.join('');
}

function renderContestLog() {
  const qsos = [...contest.log.qsos].reverse();
  $('#contest-log').innerHTML = qsos.length
    ? qsos.map((q) => {
        const ok = q.err === QSO_ERROR.NONE;
        const label = escapeHtml(QSO_ERROR_LABEL[q.err] || q.err);
        // 該当局が無い場合は正解が存在しないので、理由だけを出す
        const why = q.trueCall
          ? `${label} → ${escapeHtml(q.trueCall)} ${escapeHtml(q.trueNr ?? '')}`
          : label;
        return `<div class="contest-qso ${ok ? 'ok' : 'ng'}">
            <span>${escapeHtml(q.call)} <span class="truth">${escapeHtml(q.nr)}</span></span>
            ${ok ? '' : `<span class="why">${why}</span>`}
            <span class="mark">${ok ? '○' : '×'}</span>
          </div>`;
      }).join('')
    : '<p class="empty">まだ交信がありません。</p>';
}

async function finishContest(score) {
  $('#btn-contest-start').disabled = false;
  $('#btn-contest-stop').disabled = true;

  const mode = contest.opts?.mode || 'pileup';
  const wpx = mode === 'wpx';

  stats = recordContest(stats, {
    score,
    minutes: contest.opts?.minutes ?? settings.contestMinutes,
    exchange: settings.contestExchange,
  });
  saveStats(stats);
  renderStats();

  const isHigh = saveHighScore(mode, {
    score: wpx ? score.score : score.points,
    points: score.points,
    mults: score.mults,
    accuracy: score.accuracy,
    rate: score.rate,
    callsign: settings.callsign,
  });
  const best = loadHighScores()[mode];

  // 5 分ごとの交信数
  const blocks = contest.log.histogram(contest.startedAt, contest.stoppedAt || Date.now());
  const peak = Math.max(1, ...blocks.map((b) => b.raw));
  const hist = blocks.map((b) => `
    <div class="rate-bar" style="height:${Math.max(2, (b.valid / peak) * 100)}%"
         title="${b.valid} / ${b.raw} QSO">
      <span class="n">${b.valid || ''}</span>
    </div>`).join('');

  const box = $('#contest-result');
  box.hidden = false;
  box.innerHTML = `
    <div class="qso-summary">
      <h3>運用終了 — ${escapeHtml(RUN_MODES[mode]?.label || mode)}</h3>
      <div class="score">${wpx ? score.score : score.points}</div>
      <p class="hint">${wpx ? '得点（有効 QSO × マルチ）' : '有効 QSO 数'}</p>
      ${isHigh ? '<p class="highscore">自己ベスト更新</p>' : ''}
    </div>

    <table class="score-table">
      <tr><th></th><th>素点</th><th>確定</th></tr>
      <tr><td>QSO 数</td><td>${score.rawPoints}</td><td>${score.points}</td></tr>
      ${wpx ? `<tr><td>マルチ</td><td>${score.rawMults}</td><td>${score.mults}</td></tr>` : ''}
      <tr class="total"><td>${wpx ? '得点' : '有効数'}</td>
        <td>${wpx ? score.rawScore : score.rawPoints}</td>
        <td>${wpx ? score.score : score.points}</td></tr>
    </table>

    <h4>5 分ごとの交信数</h4>
    <div class="rate-hist">${hist}</div>
    <div class="rate-axis"><span>開始</span><span>終了</span></div>

    <p class="hint">
      正確度 ${Math.round(score.accuracy * 100)}%（誤り ${score.errors} 件）／
      ${score.rate} QSO 毎時ペース
      ${best ? `／ 自己ベスト ${best.score}` : ''}
    </p>

    <div class="turn-actions" style="justify-content:center">
      <button type="button" class="btn btn-primary" id="btn-contest-again">もう一度</button>
      <span id="contest-download"></span>
    </div>`;

  $('#btn-contest-again').addEventListener('click', startContest);

  // 録音していれば、ダウンロードできるようにする
  if (player.isRecording) {
    const blob = await player.stopRecording();
    if (blob) {
      const url = URL.createObjectURL(blob);
      const ext = blob.type.includes('ogg') ? 'ogg' : blob.type.includes('mp4') ? 'm4a' : 'webm';
      $('#contest-download').innerHTML =
        `<a class="btn" download="contest-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.${ext}"
            href="${url}">録音を保存</a>`;
    }
  }

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

// initKeyer が設定同期関数をここに登録する（チュートリアルの警告からも呼ぶため）
let syncKeyerControls = () => {};

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
    $('#keyer-hand').value = settings.keyerHand;
    $('#keyer-thumb').checked = settings.keyerThumb === 'dah';
    $('#keyer-global').checked = settings.keyerGlobal;
    weightOut.textContent = `${settings.keyerWeight}%`;
    wpmOut.textContent = `${settings.keyerWpm} WPM`;
    $('#keyer-freq').value = settings.keyerFreq;
    $('#keyer-freq-out').textContent = `${settings.keyerFreq} Hz`;
    $('#keyer-mode-help').textContent = KEYER_MODES[settings.keyerMode]?.help || '';

    renderPaddleAssignment();

    keyer.setParams({
      mode: settings.keyerMode,
      wpm: settings.keyerWpm,
      weight: settings.keyerWeight,
      swap: paddleAssignment(settings).swapped,
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
  $('#keyer-freq').addEventListener('input', (e) => {
    settings.keyerFreq = Number(e.target.value);
    player.setSettings({ keyerFreq: settings.keyerFreq });  // 打鍵中でも即時反映
    persist(); syncKeyer(); touched('keyerFreq');
  });
  $('#keyer-hand').addEventListener('change', (e) => {
    settings.keyerHand = e.target.value; persist(); syncKeyer(); touched('keyerHand');
  });
  $('#keyer-thumb').addEventListener('change', (e) => {
    settings.keyerThumb = e.target.checked ? 'dah' : 'dit';
    persist(); syncKeyer(); touched('keyerThumb');
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

  syncKeyerControls = syncKeyer;
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
      freq: settings.keyerFreq,
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

  // キーヤーの自動送出を使う課題は、縦振り電鍵モードでは成立しない。
  // （縦振りでは符号の長さが押した時間で決まり、送信速度も反映されない）
  if (step.needsKeyer && settings.keyerMode === 'straight') {
    goalBox.className = 'tutorial-goal';
    goalBox.innerHTML =
      '<span class="tag">注意</span>'
      + '<span>キーヤーモードが「縦振り電鍵」になっています。この課題は自動送出が前提で、'
      + '送信速度の設定も縦振りでは音に反映されません。'
      + ' <button type="button" class="btn" id="btn-tutorial-fixmode" style="margin-left:.5rem">'
      + 'アイアンビック B に戻す</button></span>';
    $('#btn-tutorial-fixmode')?.addEventListener('click', () => {
      settings.keyerMode = 'iambicB';
      persist();
      syncKeyerControls();
      checkTutorial();
    });
    return;
  }

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

/** 利き手設定に応じて、ランプ・説明文・パッドの案内をまとめて描き直す。 */
function renderPaddleAssignment() {
  const map = paddleAssignment(settings);
  const label = (element) => (element === 'dit' ? '・ 短点' : '－ 長点');
  const handName = settings.keyerHand === 'left' ? '左手用' : '右手用';

  $('#lamp-left').textContent = `左ボタン ${label(map.left)}`;
  $('#lamp-right').textContent = `右ボタン ${label(map.right)}`;
  $('#keyer-hand-current').textContent = handName;

  $('#keyer-pad .pad-hint').innerHTML =
    `左ボタン＝${map.left === 'dit' ? '短点' : '長点'}／`
    + `右ボタン＝${map.right === 'dit' ? '短点' : '長点'}`
    + '（キーボードは <kbd>Z</kbd> / <kbd>X</kbd>）';

  const thumbSide = map.thumbButton === 'right' ? '右' : '左';
  const thumbElement = settings.keyerThumb === 'dah' ? '長点' : '短点';
  $('#keyer-hand-help').textContent =
    `${handName}では、パドルの${thumbSide}レバーに親指が当たります。`
    + `親指＝${thumbElement}になるよう、${thumbSide}ボタンを${thumbElement}に割り当てています。`;

  syncPaddleWidget();
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
    $('#lamp-left')?.classList.remove('on');
    $('#lamp-right')?.classList.remove('on');
    return;
  }

  keyer.start();
  pad.classList.add('is-active');
  // ランプは物理ボタンに対応させ、どちらの要素かはラベル側で示す
  paddle.detach = attachPaddleInput(keyer, pad, {
    global: settings.keyerGlobal,
    onState: (state) => {
      $('#lamp-left').classList.toggle('on', state.left);
      $('#lamp-right').classList.toggle('on', state.right);
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
      // 早見表の例文にも自局のコールサインを反映する
      if (key === 'callsign') renderPatternSheet();
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
  get qsoOptions() { return qso.currentOptions ?? null; },
  get drillProblem() { return drill.problem; },
  get keyerTask() { return paddle.task; },
};
