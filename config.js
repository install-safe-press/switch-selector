// ============================================================
// config.js — 設定檔
// 使用前請修改以下兩個設定值
// ============================================================

const CONFIG = {
  // Google Sheets CSV 網址
  // 取得方式：Sheets → 檔案 → 共用 → 發布到網路 → 選「產品資料」工作表 → CSV → 複製網址
  //SHEET_URL: "https://docs.google.com/spreadsheets/d/1CM3TklL7dJ3OZ2zRLVnazPtnsmz2ENpk7ajmvm9a1AA/gviz/tq?tqx=out:csv&sheet=產品資料",
SHEET_URL: "https://docs.google.com/spreadsheets/d/1CM3TklL7dJ3OZ2zRLVnazPtnsmz2ENpk7ajmvm9a1AA/gviz/tq?tqx=out:csv&gid=575058480“,
  
  // Claude API Proxy 網址（Cloudflare Workers）
  // 若尚未設定 Proxy，可先留空字串 "" 讓 LLM 功能暫時停用
  // 正式上線前務必改成自己的 Proxy，避免 API Key 外洩
  PROXY_URL: "https://YOUR_WORKER.workers.dev",

  // 最多顯示幾筆推薦結果
  MAX_RESULTS: 5,
};
