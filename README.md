# 交換器選品工具

Dell、HPE、ZyXEL 網路交換器選品網頁，支援選單篩選與 AI 自然語言描述（沒付錢不會啟用）兩種輸入方式。

## 上線前必做的兩件事

### 1. 設定 Google Sheets 網址（`config.js`）

```js
SHEET_URL: "https://docs.google.com/spreadsheets/d/YOUR_SHEET_ID/..."
```

取得方式：Google Sheets → 檔案 → 共用 → 發布到網路 → 選「產品資料」工作表 → CSV → 複製網址

### 2. 設定 Claude API Proxy（`config.js`）

```js
PROXY_URL: "https://YOUR_WORKER.workers.dev"
```

建立 Cloudflare Workers 作為代理，避免 API Key 直接暴露在前端程式碼中。
Workers 程式碼範本請參考部署教學文件。

若暫時只用選單篩選功能（不用 LLM），PROXY_URL 可先留空字串 `""`。

---

## 檔案說明

| 檔案 | 說明 |
|---|---|
| `index.html` | 主頁面結構 |
| `style.css` | 所有樣式 |
| `app.js` | 篩選邏輯、Google Sheets 讀取、LLM 呼叫 |
| `config.js` | 設定檔（Sheets URL、Proxy URL） |

---

## 部署到 GitHub Pages

1. 建立 GitHub Repository（Public）
2. 上傳所有檔案
3. Settings → Pages → Branch: main / (root) → Save
4. 約 1 分鐘後可訪問：`https://yourname.github.io/switch-selector/`

---

## 更新產品資料

直接編輯 Google Sheets，無需重新部署，約 1–5 分鐘後網頁自動更新。

## 調整主推排序

修改 Google Sheets 中的 `sort_weight` 欄位（1–100，數字越大越前）。

## 上下架型號

修改 Google Sheets 中的 `is_active` 欄位（TRUE = 顯示，FALSE = 隱藏）。

---

## 詢價動作設定

`app.js` 中的 `handleInquiry()` 函式，預設開啟 Email。
可修改為開啟 LINE、Google Form、或內部 CRM 連結。

```js
function handleInquiry(brand, model) {
  // 改成你們的業務信箱
  window.location.href = `mailto:sales@yourcompany.com?subject=詢價：${brand} ${model}`;
}
```
