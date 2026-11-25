#!/usr/bin/env node
import { parseArgs, styleText } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import wrapAnsi from 'wrap-ansi';
import { fileURLToPath } from 'node:url';
import { convertLatexInMarkdown } from './latex.js';
import { createGeminiApi, DEFAULT_MODEL, MODEL_HELP, MODEL_OPTIONS, validateConfiguredModel } from './api.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = path.join(os.homedir(), '.config', 'gemini');
const HISTORY_FILE = path.join(CONFIG_DIR, 'history.json');
const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
  const defaultConfig = {
    lineWidth: 80,
    markdown: true,
    model: DEFAULT_MODEL,
    systemPrompt: '',
  };

  let data;
  try {
    data = fs.readFileSync(CONFIG_FILE, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw new Error(`設定ファイルを読み込めません (${CONFIG_FILE}): ${error.message}`);
    }

    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2), 'utf8');
    } catch (writeError) {
      console.error(`\x1b[33m[警告] 設定ファイルを作成できませんでした: ${writeError.message}\x1b[0m`);
    }
    return defaultConfig;
  }

  let config;
  try {
    config = JSON.parse(data);
  } catch (error) {
    throw new Error(`設定ファイルのJSONが不正です (${CONFIG_FILE}): ${error.message}`);
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`設定ファイルはJSONオブジェクトである必要があります: ${CONFIG_FILE}`);
  }

  const mergedConfig = { ...defaultConfig, ...config };
  if (!Number.isInteger(mergedConfig.lineWidth) || mergedConfig.lineWidth < 1) {
    throw new Error(`lineWidth は1以上の整数にしてください: ${CONFIG_FILE}`);
  }
  if (typeof mergedConfig.markdown !== 'boolean') {
    throw new Error(`markdown は真偽値にしてください: ${CONFIG_FILE}`);
  }
  validateConfiguredModel(mergedConfig.model, CONFIG_FILE);
  if (typeof mergedConfig.systemPrompt !== 'string') {
    throw new Error(`systemPrompt は文字列にしてください: ${CONFIG_FILE}`);
  }

  return mergedConfig;
}

const appConfig = loadConfig();
const terminalWidth = process.stdout.isTTY && process.stdout.columns > 1
  ? process.stdout.columns - 1
  : appConfig.lineWidth;
const renderWidth = Math.min(appConfig.lineWidth, terminalWidth);

function shouldColorize() {
  const { env } = process;
  if ('FORCE_COLOR' in env) return env.FORCE_COLOR !== '0' && env.FORCE_COLOR !== 'false';
  if ('NO_COLOR' in env || 'NODE_DISABLE_COLORS' in env) return false;
  return process.stdout?.hasColors?.() ?? false;
}

function styleIfEnabled(format, text) {
  return shouldColorize() ? styleText(format, text, { validateStream: false }) : text;
}

function wrapDisplayWidth(text, width) {
  return wrapAnsi(text, Math.max(width, 1), { hard: true, trim: false });
}

marked.use(markedTerminal({
  width: renderWidth,
  reflowText: true,
  paragraph: (text) => {
    // Keep display-width wraps as hard breaks through marked-terminal's later reflow pass.
    const wrapped = wrapDisplayWidth(text.replace(/\r/g, '\n'), renderWidth).replace(/\n/g, '\r');
    return styleIfEnabled('reset', wrapped);
  },
  heading: (text) => styleIfEnabled(['green', 'bold'], wrapDisplayWidth(text, renderWidth)),
  firstHeading: (text) => styleIfEnabled(['magenta', 'underline', 'bold'], wrapDisplayWidth(text, renderWidth)),
  listitem: (text) => styleIfEnabled('reset', wrapDisplayWidth(text, renderWidth - 2)),
}));

function takeCompleteMarkdownBlocks(text) {
  let consumed = 0;
  let lastBoundary = 0;
  for (const token of marked.lexer(text)) {
    consumed += token.raw.length;
    if (token.type === 'space' && /\r?\n[ \t]*\r?\n/.test(token.raw)) {
      lastBoundary = consumed;
    }
  }

  return {
    blocks: lastBoundary ? [text.slice(0, lastBoundary)] : [],
    remainder: text.slice(lastBoundary),
  };
}

// 履歴の読み込み
function loadHistory() {
  if (!fs.existsSync(HISTORY_FILE)) {
    return [];
  }
  try {
    const data = fs.readFileSync(HISTORY_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

// 履歴の保存
function saveHistory(history) {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (error) {
    console.error(`\x1b[33m[警告] 会話履歴の保存に失敗しました: ${error.message}\x1b[0m`);
  }
}

const options = {
  ...MODEL_OPTIONS,
  'no-think': {
    type: 'boolean',
    default: false,
  },
  search: {
    type: 'boolean',
    short: 's',
    default: false,
  },
  code: {
    type: 'boolean',
    short: 'c',
    default: false,
  },
  markdown: {
    type: 'boolean',
  },
  continue: {
    type: 'boolean',
    short: 'C',
    default: false,
  },
  help: {
    type: 'boolean',
    short: 'h',
    default: false,
  },
};

const { values, positionals } = parseArgs({
  args: process.argv.slice(2),
  options,
  allowPositionals: true,
});

let input = '';
if (!process.stdin.isTTY) {
  input = fs.readFileSync(0, 'utf-8');
}

const fullPrompt = [positionals.join(' '), input].filter(Boolean).join('\n\n');

if (values.help || !fullPrompt) {
  console.log(`
使用法: ask [オプション] "質問内容"
       コマンド | ask [オプション] "質問内容"

設定ファイル:
  アプリケーションディレクトリの config.json に設定を保存できます。
  例: { "lineWidth": 80, "markdown": true, "model": "flash-lite", "systemPrompt": "日本語で簡潔に回答する" }
  - lineWidth: 本文・表の折り返し幅（表示桁数。端末幅を上限とする）
  - markdown: 回答のMarkdown整形（true または false）
  - model: 使用モデル（flash-lite、flash-lite-31、flash、gemma、hydrogen またはモデルID）
  - systemPrompt: Gemini に渡すシステムプロンプト（空文字なら設定なし）

モデル:
${MODEL_HELP}

オプション:
  -C, --continue       前回の会話を継承して実行 (連続して指定可能)
  -m, --model <name>   'flash-lite'、'flash-lite-31'、'flash'、'gemma'、'hydrogen' またはモデルID
  --no-think           拡張思考 (Thinking) を無効化
  -s, --search         Google検索グラウンディングを有効化
  -c, --code           Pythonコード実行ツールを有効化
      --markdown       Markdown整形を有効化（設定を上書き）
      --no-markdown    Markdown整形を無効化（設定を上書き）
  -h, --help           ヘルプ表示

標準入力:
  パイプ入力は質問内容の後に追加されます。

`);
  process.exit(0);
}

const isThinkingDisabled = values['no-think'];
const isMarkdownEnabled = values.markdown ?? appConfig.markdown;
const api = createGeminiApi({
  configuredModel: appConfig.model,
  requestedModel: values.model,
  systemPrompt: appConfig.systemPrompt,
});

async function main() {
  try {
    const tools = [];
    if (values.search) tools.push({ googleSearch: {} });
    if (values.code) tools.push({ codeExecution: {} });

    const config = {};
    if (tools.length > 0) {
      config.tools = tools;
    }

    if (isThinkingDisabled) {
      config.thinkingConfig = { thinkingBudget: 0 };
    }

    // 会話履歴の構成
    let conversationHistory = [];
    if (values.continue) {
      conversationHistory = loadHistory();
      if (conversationHistory.length === 0) {
        console.error('\x1b[33m[情報] 前回の履歴が見つからないため、新規セッションとして開始します。\x1b[0m');
      }
    }

    // 今回のユーザー入力を追加
    const currentContents = [
      ...conversationHistory,
      {
        role: 'user',
        parts: [{ text: fullPrompt }],
      },
    ];

    const responseStream = await api.generateContentStream(currentContents, config);

    let previousPartWasThought = false;
    let previousThoughtEndedWithNewline = false;
    let fullResponseText = ''; // 履歴保存用の回答蓄積バッファ
    let pendingMarkdown = '';
    let hasOutput = false;

    for await (const chunk of responseStream) {
      const candidate = chunk.candidates?.[0];
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if (part.thought) {
            process.stdout.write(`\x1b[90m${part.text}\x1b[0m`);
            previousPartWasThought = true;
            previousThoughtEndedWithNewline = part.text?.endsWith('\n') ?? false;
          } else if (part.text) {
            if (previousPartWasThought && !previousThoughtEndedWithNewline) {
              process.stdout.write('\n');
            }
            previousPartWasThought = false;
            previousThoughtEndedWithNewline = false;
            fullResponseText += part.text;
            if (isMarkdownEnabled) {
              pendingMarkdown += part.text;

              const { blocks, remainder } = takeCompleteMarkdownBlocks(pendingMarkdown);
              for (const block of blocks) {
                process.stdout.write(marked.parse(convertLatexInMarkdown(block)));
                hasOutput = true;
              }
              pendingMarkdown = remainder;
            } else {
              process.stdout.write(part.text);
              hasOutput = true;
            }
          }
        }
      } else if (chunk.text) {
        if (previousPartWasThought && !previousThoughtEndedWithNewline) {
          process.stdout.write('\n');
        }
        previousPartWasThought = false;
        previousThoughtEndedWithNewline = false;
        fullResponseText += chunk.text;
        if (isMarkdownEnabled) {
          pendingMarkdown += chunk.text;

          const { blocks, remainder } = takeCompleteMarkdownBlocks(pendingMarkdown);
          for (const block of blocks) {
            process.stdout.write(marked.parse(convertLatexInMarkdown(block)));
            hasOutput = true;
          }
          pendingMarkdown = remainder;
        } else {
          process.stdout.write(chunk.text);
          hasOutput = true;
        }
      }
    }

    if (previousPartWasThought && !previousThoughtEndedWithNewline) {
      process.stdout.write('\n');
    }

    if (isMarkdownEnabled && pendingMarkdown) {
      process.stdout.write(marked.parse(convertLatexInMarkdown(pendingMarkdown)));
      hasOutput = true;
    }
    if (!hasOutput) {
      console.log();
    }

    // 成功した場合のみ履歴を保存（今回の質問と回答を追加）
    if (fullResponseText) {
      const updatedHistory = [
        ...currentContents,
        {
          role: 'model',
          parts: [{ text: fullResponseText }],
        },
      ];
      saveHistory(updatedHistory);
    }
  } catch (error) {
    if (error.status === 429 || error.message?.includes('429')) {
      console.error('\n\x1b[31m[429 クォータ制限エラー]\x1b[0m');
      console.error('モデルまたはプロジェクトの利用上限に達した可能性があります。');
      console.error('無料枠では検索ツール(-s)を利用できない場合があります。AI Studio で利用条件と上限を確認してください。');
    } else {
      console.error('\nエラーが発生しました:', error.message);
    }
    process.exit(1);
  }
}

main();
