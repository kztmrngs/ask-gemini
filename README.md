# ask

Gemini API を使って、ターミナルから質問できるシンプルな CLI です。回答のストリーミング表示、Markdown・数式の整形、会話の継続に対応しています。

## 必要なもの

- Node.js 20 以降
- Gemini API キー（[Google AI Studio](https://aistudio.google.com/apikey) で取得）

## セットアップ

```sh
npm install
mkdir -p ~/.config/gemini
```

API キーを `~/.config/gemini/api_key` に保存してください。Linux/macOS では、他のユーザーから読めないよう権限を設定します。

```sh
printf '%s' 'YOUR_API_KEY' > ~/.config/gemini/api_key
chmod 600 ~/.config/gemini/api_key
```

アプリの設定は、必要なら `config.example.json` を `config.json` にコピーして編集します。`config.json` はローカル設定として Git の対象外です。初回起動時にも既定値で作成されます。

## 使い方

```sh
node app.js "日本の四季について教えて"
npm start -- "日本の四季について教えて"
```

標準入力から質問を渡すこともできます。

```sh
cat article.txt | node app.js "この記事を要約して"
```

### オプション

| オプション | 説明 |
| --- | --- |
| `-m, --model <name>` | モデルの別名または Gemini API のモデルID |
| `-C, --continue` | 前回の会話履歴を継承（連続指定可） |
| `--no-think` | 拡張思考を無効化 |
| `-s, --search` | Google 検索グラウンディングを有効化 |
| `-c, --code` | Python コード実行を有効化 |
| `--markdown` / `--no-markdown` | Markdown 整形を切り替え |
| `-h, --help` | ヘルプを表示 |

### モデル

以下は無料枠が案内されている安定版モデルです。無料枠の利用可能量はモデル、Google AI Studio のプロジェクト、アカウントの状態などで変わるため、最新の上限は [AI Studio のレート制限](https://aistudio.google.com/rate-limit)で確認してください。

| 別名 | モデルID | 用途 |
| --- | --- | --- |
| `flash-lite` | `gemini-3.5-flash-lite` | 既定。軽量・高速な日常利用向け |
| `flash-lite-31` | `gemini-3.1-flash-lite` | 軽量モデルの別候補 |
| `flash` | `gemini-3.8-flash` | より高機能な選択肢。利用上限を確認して使用 |
| `gemma` | `gemma-4-31b-it` | Gemma 4 31B |
| `hydrogen` | `gemini-4-hydrogen` | Gemini 4 Hydrogen。無料枠あり。利用条件・上限を確認して使用 |

例:

```sh
node app.js -m flash-lite-31 "質問"
node app.js -m flash "質問"
node app.js -m gemma "質問"
node app.js -m hydrogen "質問"
```

別名にないモデルは、Google Gemini API で利用可能なモデルIDを直接指定できます。利用可能なモデルや料金・無料枠は変更されることがあるため、[モデル一覧](https://ai.google.dev/gemini-api/docs/models)と[料金ページ](https://ai.google.dev/gemini-api/docs/pricing)を確認してください。

### 設定

`config.json` の設定例:

```json
{
  "lineWidth": 80,
  "markdown": true,
  "model": "flash-lite",
  "systemPrompt": ""
}
```

- `lineWidth`: ターミナル表示の折り返し幅
- `markdown`: Markdown 整形の有効・無効
- `model`: 既定のモデル別名またはモデルID
- `systemPrompt`: システムプロンプト

会話履歴は `~/.config/gemini/history.json` に保存されます。

## 無料枠・プライバシーについて

- 無料枠のレート制限は固定・保証されたものではありません。モデルやプロジェクトによって異なり、変更されることもあります。
- `--search` の Google 検索グラウンディングは、無料枠では利用できない場合があります。Google AI Studio で利用条件を確認してください。
- Google の Gemini API 無料サービスでは、送信した入力と生成結果がサービスの改善に利用される場合があります。API キー、個人情報、機密情報をプロンプトに含めないでください。詳細は[追加利用規約](https://ai.google.dev/gemini-api/docs/terms)を確認してください。
- API キーはこのプロジェクトの設定ファイルやソースコードに保存しないでください。

## GitHub に公開する場合

`node_modules/` とローカル設定の `config.json` は `.gitignore` で除外されています。API キーを含むファイルを追加しないよう確認してからコミットしてください。

## 免責事項

このソフトウェアは作者個人の用途に合わせて作成したものです。使い勝手、品質、動作、回答の正確性、特定環境・モデルとの互換性、継続的な利用や無料枠の提供について、いずれも保証しません。利用者向けのサポートも提供しません。利用者自身の判断と責任で使用してください。本ソフトウェアは Google の公式製品ではありません。

## ライセンス

[MIT License](./LICENSE) です。
