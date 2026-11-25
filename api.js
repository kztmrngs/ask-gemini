import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CONFIG_DIR = path.join(os.homedir(), '.config', 'gemini');
const MODEL_MAP = {
  'flash-lite': 'gemini-3.5-flash-lite',
  'flash-lite-31': 'gemini-3.1-flash-lite',
  'flash': 'gemini-3.8-flash',
  'gemma': 'gemma-4-31b-it',
  'hydrogen': 'gemini-4-hydrogen',
};

export const DEFAULT_MODEL = 'flash-lite';

export const MODEL_OPTIONS = {
  model: {
    type: 'string',
    short: 'm',
  },
};

export const MODEL_HELP = `  デフォルト: Gemini 3.5 Flash-Lite (gemini-3.5-flash-lite)
  -m flash-lite-31 : Gemini 3.1 Flash-Lite (gemini-3.1-flash-lite)
  -m flash         : Gemini 3.8 Flash (gemini-3.8-flash)
  -m gemma         : Gemma 4 31B (gemma-4-31b-it)
  -m hydrogen      : Gemini 4 Hydrogen (gemini-4-hydrogen)`;

export function validateConfiguredModel(model, configFile) {
  if (typeof model !== 'string' || !model.trim()) {
    throw new Error(`model は空でない文字列にしてください: ${configFile}`);
  }
}

function getApiKey() {
  const keyPath = path.join(CONFIG_DIR, 'api_key');

  if (!fs.existsSync(keyPath)) {
    console.error(`\x1b[31m[エラー] APIキーファイルが見つかりません:\x1b[0m ${keyPath}`);
    process.exit(1);
  }

  const stat = fs.statSync(keyPath);
  const mode = stat.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    console.error(`\x1b[31m[セキュリティエラー] パーミッションが危険です: ${keyPath} (${mode.toString(8)})\x1b[0m`);
    process.exit(1);
  }

  const key = fs.readFileSync(keyPath, 'utf8').trim();
  if (!key) {
    console.error(`\x1b[31m[エラー] ${keyPath} が空です。\x1b[0m`);
    process.exit(1);
  }
  return key;
}

export function createGeminiApi({ configuredModel, requestedModel, systemPrompt }) {
  const modelName = requestedModel ?? configuredModel ?? DEFAULT_MODEL;
  if (typeof modelName !== 'string' || !modelName.trim()) {
    throw new Error('--model には空でないモデル名を指定してください。');
  }

  const model = MODEL_MAP[modelName] || modelName;
  const ai = new GoogleGenAI({ apiKey: getApiKey() });

  return {
    generateContentStream(contents, config = {}) {
      const requestConfig = { ...config };
      if (systemPrompt) {
        requestConfig.systemInstruction = systemPrompt;
      }

      return ai.models.generateContentStream({
        model,
        contents,
        config: requestConfig,
      });
    },
  };
}
