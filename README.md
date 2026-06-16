# LINE + GPT API 自動回覆機器人

這是一個給機油品牌/保修廠通路使用的 LINE 官方帳號 webhook 範本。它會接收客戶訊息、用 OpenAI 回答簡易汽車技術問題、依產品規則表推薦自有品牌機油，並在高風險或資訊不足時建立人工技師轉接紀錄。

## 功能

- LINE Messaging API webhook：`POST /webhook/line`
- LINE signature 驗證
- OpenAI Responses API 回覆
- 產品規則表推薦：`data/products.json`
- 高風險問題保守處理與人工轉接
- 本地 JSONL 轉接紀錄：`work/handoffs.jsonl`
- 測試涵蓋 LINE webhook、產品推薦、風險分類

## 快速開始

```bash
npm install
cp .env.example .env
npm run dev
```

LINE Developers Console 的 Webhook URL 設為：

```text
https://你的網域/webhook/line
```

本地測試可用 ngrok 或 Cloudflare Tunnel 暴露 `http://localhost:3000`。

## 必填環境變數

- `LINE_CHANNEL_SECRET`
- `LINE_CHANNEL_ACCESS_TOKEN`
- `OPENAI_API_KEY`

可選：

- `OPENAI_MODEL`，預設 `gpt-4.1-mini`
- `TECH_ESCALATION_TARGET`，設定後會用 LINE push message 通知技師

## 產品規則表

請編輯 `data/products.json`，只放你確定要讓 AI 推薦的自有品牌產品。AI 不會推薦規則表以外的產品。

## 測試與建置

```bash
npm test
npm run build
```
