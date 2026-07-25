// docs/MANUAL.md から Word 文書を生成する。
//
//   node docs/build-manual-docx.js
//
// 説明書の本文は MANUAL.md 側だけを直せばよいよう、ここでは変換だけを行う。

const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
  ExternalHyperlink, PageBreak, LevelFormat, Footer, PageNumber,
} = require('docx');

const SRC = path.join(__dirname, 'MANUAL.md');
const OUT = path.join(__dirname, 'CW交信トレーニング_使い方説明書.docx');

// 日本語が入るため、Windows / macOS の Word に標準で入る書体を指定する
const FONT = 'Yu Gothic';
const MONO = 'Consolas';

// A4 幅 11906 DXA から左右余白 1134 ずつを引いた本文幅
const CONTENT_WIDTH = 11906 - 1134 * 2;

const ACCENT = '8A5A00';
const RULE = 'BFBFBF';
const CODE_BG = 'F2F2F2';
const HEAD_BG = 'EDE7DA';

// ───────── インライン記法 ─────────

/** **太字** / `コード` / [表示文字](URL) を TextRun の配列に変換する。 */
function inline(text, base = {}) {
  const runs = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;
  let last = 0;
  let m;

  const plain = (s) => {
    if (s) runs.push(new TextRun({ text: s, font: FONT, ...base }));
  };

  while ((m = re.exec(text)) !== null) {
    plain(text.slice(last, m.index));
    last = re.lastIndex;

    if (m[1] !== undefined) {
      const [, label, href] = m;
      if (/^https?:/.test(href)) {
        runs.push(new ExternalHyperlink({
          link: href,
          children: [new TextRun({
            text: label, font: FONT, color: '0563C1', underline: {}, ...base,
          })],
        }));
      } else {
        // 文書内アンカーは Word では機能しないので、表示文字だけ残す
        plain(label);
      }
    } else if (m[3] !== undefined) {
      // 太字の中の `コード` も拾えるよう、中身を再帰的に解釈する
      runs.push(...inline(m[3], { ...base, bold: true }));
    } else if (m[4] !== undefined) {
      runs.push(new TextRun({
        text: m[4],
        font: MONO,
        shading: { type: ShadingType.CLEAR, fill: CODE_BG },
        ...base,
      }));
    }
  }
  plain(text.slice(last));
  return runs;
}

// ───────── 表 ─────────

function splitRow(line) {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

/** 各列の文字数から幅を按分する。極端に狭い・広い列が出ないよう丸める。 */
function columnWidths(rows) {
  const cols = rows[0].length;
  const weights = Array.from({ length: cols }, (_, i) => {
    const longest = Math.max(...rows.map((r) => visualLength(r[i] || '')));
    return Math.min(Math.max(longest, 6), 48);
  });
  const sum = weights.reduce((a, b) => a + b, 0);

  const widths = weights.map((w) => Math.round((w / sum) * CONTENT_WIDTH));
  // 端数を最終列で吸収し、合計を本文幅にそろえる
  widths[cols - 1] += CONTENT_WIDTH - widths.reduce((a, b) => a + b, 0);
  return widths;
}

/** 全角を 2、半角を 1 として数える。列幅の目安に使う。 */
function visualLength(s) {
  const text = s.replace(/\*\*|`/g, '');
  let n = 0;
  for (const ch of text) n += /[　-鿿＀-￯]/.test(ch) ? 2 : 1;
  return n;
}

function buildTable(lines) {
  const rows = lines.filter((l) => !/^\|[\s:|-]+\|$/.test(l)).map(splitRow);
  const widths = columnWidths(rows);

  const cell = (text, isHeader, width) => new TableCell({
    width: { size: width, type: WidthType.DXA },
    shading: isHeader ? { type: ShadingType.CLEAR, fill: HEAD_BG } : undefined,
    margins: { top: 60, bottom: 60, left: 110, right: 110 },
    children: [new Paragraph({
      spacing: { before: 0, after: 0 },
      children: inline(text, isHeader ? { bold: true } : {}),
    })],
  });

  return new Table({
    columnWidths: widths,
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      left: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      right: { style: BorderStyle.SINGLE, size: 4, color: RULE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    },
    rows: rows.map((r, i) => new TableRow({
      tableHeader: i === 0,
      children: r.map((c, j) => cell(c, i === 0, widths[j])),
    })),
  });
}

// ───────── 本文の組み立て ─────────

function build(markdown) {
  const lines = markdown.split('\n');
  const children = [];
  let listInstance = 0;
  let prevWasOrdered = false;
  let firstSection = true;
  let i = 0;

  // Markdown では空行までが 1 段落なので、連続する行はつないでから出力する。
  // 日本語は行末に空白を入れずに連結する。
  let buffer = [];
  const flushParagraph = () => {
    if (!buffer.length) return;
    children.push(new Paragraph({
      spacing: { after: 160, line: 330 },
      children: inline(joinLines(buffer)),
    }));
    buffer = [];
  };

  // 直前のリスト項目に続きの行を足せるよう、組み立て中の項目を保持する
  let listItem = null;
  const flushListItem = () => {
    if (!listItem) return;
    const { kind, level } = listItem;
    const opts = {
      spacing: { after: 90, line: 320 },
      children: inline(joinLines(listItem.lines)),
    };
    if (kind === 'ordered') {
      opts.numbering = { reference: 'ordered', level, instance: listItem.instance };
    } else {
      opts.bullet = { level };
      opts.indent = { left: 640 + level * 460, hanging: 300 };
    }
    children.push(new Paragraph(opts));
    listItem = null;
  };

  const flushAll = () => { flushListItem(); flushParagraph(); };

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // 表
    if (/^\|.*\|$/.test(trimmed)) {
      flushAll();
      const block = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        block.push(lines[i].trim());
        i += 1;
      }
      children.push(buildTable(block));
      children.push(new Paragraph({ spacing: { after: 220 }, children: [] }));
      prevWasOrdered = false;
      continue;
    }

    // ``` で囲まれたコードブロック。中身は解釈せず、改行をそのまま保つ
    if (trimmed.startsWith('```')) {
      flushAll();
      i += 1;
      const code = [];
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1;   // 閉じる側のフェンスを読み飛ばす

      code.forEach((ln, n) => children.push(new Paragraph({
        shading: { type: ShadingType.CLEAR, fill: CODE_BG },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: RULE, space: 8 } },
        indent: { left: 200, right: 200 },
        spacing: {
          before: n === 0 ? 120 : 0,
          after: n === code.length - 1 ? 200 : 0,
          line: 280,
        },
        children: [new TextRun({ text: ln || ' ', font: MONO, size: 19 })],
      })));
      prevWasOrdered = false;
      continue;
    }

    i += 1;

    if (!trimmed) { flushAll(); prevWasOrdered = false; continue; }
    if (trimmed === '---') { flushAll(); continue; }  // 区切りは改ページで表現する
    if (/^<!--/.test(trimmed)) continue;

    // 見出し
    const heading = trimmed.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flushAll();
      const [, hashes, text] = heading;

      if (hashes === '#') {
        children.push(new Paragraph({
          heading: HeadingLevel.TITLE,
          alignment: AlignmentType.CENTER,
          spacing: { before: 2400, after: 280 },
          children: inline(text),
        }));
      } else if (hashes === '##') {
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_1,
          pageBreakBefore: !firstSection,
          spacing: { before: firstSection ? 400 : 0, after: 240 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 6 } },
          children: inline(text),
        }));
        firstSection = false;
      } else {
        children.push(new Paragraph({
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 340, after: 150 },
          children: inline(text),
        }));
      }
      prevWasOrdered = false;
      continue;
    }

    // 引用（> で始まる補足）
    const quote = trimmed.match(/^>\s?(.*)$/);
    if (quote) {
      flushAll();
      const quoted = [quote[1]];
      while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
        quoted.push(lines[i].trim().replace(/^>\s?/, ''));
        i += 1;
      }
      children.push(new Paragraph({
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 10 } },
        indent: { left: 220 },
        spacing: { before: 120, after: 200, line: 320 },
        children: inline(joinLines(quoted), { italics: true, color: '555555' }),
      }));
      prevWasOrdered = false;
      continue;
    }

    // 字下げの深さで、入れ子のリストか本文の続きかを見分ける
    const indent = raw.match(/^ */)[0].length;
    const nested = indent >= 2 ? 1 : 0;

    // 番号付きリスト
    const ordered = trimmed.match(/^\d+\.\s+(.*)$/);
    if (ordered) {
      flushAll();
      // 入れ子は親の番号列を切らない。同じ階層で間が空いたときだけ振り直す
      if (!nested && !prevWasOrdered) listInstance += 1;
      if (!nested) prevWasOrdered = true;
      listItem = {
        kind: 'ordered', level: nested, instance: listInstance, lines: [ordered[1]],
      };
      continue;
    }

    // 箇条書き
    const bullet = trimmed.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      flushAll();
      // 入れ子の箇条書きは、囲んでいる番号付きリストを終わらせない
      if (!nested) prevWasOrdered = false;
      listItem = { kind: 'bullet', level: nested, lines: [bullet[1]] };
      continue;
    }

    // 字下げされた行のうち、リスト記号でないものは直前の項目の続き
    if (listItem && indent >= 2) {
      listItem.lines.push(trimmed);
      continue;
    }

    // 本文（空行が来るまで積む）
    flushListItem();
    prevWasOrdered = false;
    buffer.push(trimmed);
  }

  flushAll();
  return children;
}

/**
 * 折り返された行をつなぐ。
 * 日本語同士は詰めて、英数字の境目にだけ空白を入れる。
 */
function joinLines(lines) {
  return lines.reduce((acc, line) => {
    if (!acc) return line;
    const needsSpace = /[A-Za-z0-9.,:;)\]}]$/.test(acc) && /^[A-Za-z0-9(\[{`*]/.test(line);
    return acc + (needsSpace ? ' ' : '') + line;
  }, '');
}

// ───────── 出力 ─────────

const markdown = fs.readFileSync(SRC, 'utf8');

const doc = new Document({
  creator: 'CW 交信トレーニング',
  title: 'CW 交信トレーニング 使い方説明書',
  description: 'ブラウザで動くモールス符号練習アプリの操作説明',
  styles: {
    default: {
      document: { run: { font: FONT, size: 21 } },   // 10.5pt
      title: {
        run: { font: FONT, size: 40, bold: true, color: '1A1A1A' },
      },
      heading1: {
        run: { font: FONT, size: 30, bold: true, color: ACCENT },
      },
      heading2: {
        run: { font: FONT, size: 24, bold: true, color: '333333' },
      },
    },
  },
  numbering: {
    config: [{
      reference: 'ordered',
      levels: [
        {
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START,
          // 2 桁の番号でも本文が詰まらないよう、ぶら下げ幅に余裕を持たせる
          style: { paragraph: { indent: { left: 760, hanging: 460 } } },
        },
        {
          level: 1,
          format: LevelFormat.LOWER_ROMAN,
          text: '%2.',
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 1220, hanging: 420 } } },
        },
      ],
    }],
  },
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },       // A4 縦
        margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 },
      },
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({
            children: ['— ', PageNumber.CURRENT, ' —'],
            font: FONT, size: 18, color: '808080',
          })],
        })],
      }),
    },
    children: build(markdown),
  }],
});

Packer.toBuffer(doc).then((buf) => {
  fs.writeFileSync(OUT, buf);
  console.log(`書き出しました: ${OUT} (${(buf.length / 1024).toFixed(0)} KB)`);
});
