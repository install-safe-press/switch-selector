// ============================================================
// app.js — 主要邏輯
// ============================================================

// ── 狀態 ──────────────────────────────────────────────────
let allProducts = [];
let filters = {
  scene: "office",
  port: 0,
  speed: 0,
  poe: "none",
  mgmt: "0",
  uplink: 0,
  brand: "all",
};

// ── 讀取 Google Sheets ────────────────────────────────────
async function loadProducts() {
  try {
    const res = await fetch(CONFIG.SHEET_URL);
    const csv = await res.text();
    const lines = csv.split("\n").slice(1);

    allProducts = lines
      .filter((l) => l.trim())
      .map((line) => {
        const cols = [];
        let cur = "";
        let inQuote = false;
        for (let i = 0; i < line.length; i++) {
          if (line[i] === '"') {
            inQuote = !inQuote;
          } else if (line[i] === "," && !inQuote) {
            cols.push(cur.trim());
            cur = "";
          } else {
            cur += line[i];
          }
        }
        cols.push(cur.trim());

        return {
          brand: cols[0] || "",
          model: cols[1] || "",
          product_line: cols[2] || "",
          port_count: parseInt(cols[3]) || 0,
          port_speed: parseFloat(cols[4]) || 1,
          poe_type: cols[5] || "none",
          poe_budget_w: parseInt(cols[6]) || 0,
          uplink_speed: parseInt(cols[7]) || 1,
          mgmt_level: cols[8] || "l2",
          scene_office: cols[9] === "TRUE",
          scene_idc: cols[10] === "TRUE",
          scene_smb: cols[11] === "TRUE",
          scene_av: cols[12] === "TRUE",
          highlights: cols[13] ? cols[13].split(",").map((h) => h.trim()).filter(Boolean) : [],
          description: cols[14] || "",
          datasheet_url: cols[15] || "",
          is_active: cols[16] === "TRUE",
          sort_weight: parseInt(cols[17]) || 50,
        };
      })
      .filter((p) => p.is_active && p.model);

    render();
  } catch (e) {
    showError("無法讀取產品資料，請確認 Google Sheets 已正確發布。");
    console.error(e);
  }
}

// ── 評分邏輯 ──────────────────────────────────────────────
function scoreProduct(p) {
  let score = 0;

  // 場景符合 (+30)
  const sceneMap = {
    office: p.scene_office,
    idc: p.scene_idc,
    smb: p.scene_smb,
    av: p.scene_av,
  };
  if (sceneMap[filters.scene]) score += 30;

  // Port 數量（硬篩）
  if (filters.port > 0 && p.port_count < parseInt(filters.port)) return null;
  if (filters.port > 0 && p.port_count >= parseInt(filters.port)) score += 15;
  else if (filters.port == 0) score += 10;

  // Port 速度（硬篩）
  if (filters.speed > 0 && p.port_speed < parseFloat(filters.speed)) return null;
  if (filters.speed > 0) score += 15;
  else score += 8;

  // PoE 需求（硬篩）
  const poeOrder = { none: 0, "poe+": 1, "poe++": 2 };
  const needPoe = poeOrder[filters.poe] || 0;
  const hasPoe = poeOrder[p.poe_type] || 0;
  if (needPoe > 0 && hasPoe === 0) return null;
  if (needPoe > 0 && hasPoe >= needPoe) score += 15;
  else if (needPoe === 0) score += 5;

  // 管理層級（硬篩）
  const mgmtOrder = { unmanaged: 0, l2: 1, "l2+": 2, l3: 3 };
  const needMgmt = mgmtOrder[filters.mgmt] ?? -1;
  const hasMgmt = mgmtOrder[p.mgmt_level] ?? 1;
  if (needMgmt >= 0 && hasMgmt < needMgmt) return null;
  if (needMgmt >= 0 && hasMgmt >= needMgmt) score += 10;
  else score += 5;

  // Uplink（硬篩）
  if (filters.uplink > 0 && p.uplink_speed < parseInt(filters.uplink)) return null;
  if (filters.uplink > 0) score += 10;
  else score += 5;

  // 品牌偏好
  if (filters.brand !== "all" && p.brand !== filters.brand) return null;
  if (filters.brand !== "all") score += 5;

  // sort_weight 加成（最多 +10）
  score += Math.round((p.sort_weight / 100) * 10);

  return Math.min(score, 100);
}

// ── 渲染結果 ──────────────────────────────────────────────
const MEDALS = ["🥇", "🥈", "🥉", "4", "5"];

function render() {
  const results = [];
  allProducts.forEach((p) => {
    const s = scoreProduct(p);
    if (s !== null) results.push({ ...p, score: s });
  });
  results.sort((a, b) => b.score - a.score || b.sort_weight - a.sort_weight);

  const top = results.slice(0, CONFIG.MAX_RESULTS);
  const total = results.length;

  const countEl = document.getElementById("result-count");
  const subtitleEl = document.getElementById("result-subtitle");
  if (countEl) countEl.textContent = Math.min(total, CONFIG.MAX_RESULTS) + (total > CONFIG.MAX_RESULTS ? ` / ${total}` : "");
  if (subtitleEl) subtitleEl.textContent = total > CONFIG.MAX_RESULTS ? `共 ${total} 筆符合，顯示前 ${CONFIG.MAX_RESULTS} 名` : "依匹配度排序";

  const el = document.getElementById("results");
  if (!el) return;

  if (!top.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div><p>無符合條件的型號</p><span>請放寬篩選條件，或清除部分選項</span></div>`;
    return;
  }

  el.innerHTML = top.map((p, i) => {
    const brandClass = p.brand.toLowerCase().replace(/\s/g, "-");
    const dsLink = p.datasheet_url ? `<a href="${p.datasheet_url}" target="_blank" class="ds-link">規格書 ↗</a>` : "";
    return `
    <div class="card ${i === 0 ? "card--top" : ""}">
      <div class="card-rank">${MEDALS[i]}</div>
      <div class="card-body">
        <div class="card-head">
          <span class="brand-tag brand-tag--${brandClass}">${p.brand}</span>
          <span class="model-name">${p.model}</span>
          ${i === 0 ? '<span class="top-badge">最佳推薦</span>' : ""}
        </div>
        <div class="spec-row">
          ${p.highlights.map((h) => `<span class="spec-pill">${h}</span>`).join("")}
        </div>
        ${p.description ? `<p class="card-desc">${p.description}</p>` : ""}
      </div>
      <div class="card-right">
        <span class="score-badge">${p.score}%</span>
        <div class="card-actions">
          ${dsLink}
          <button class="btn-inquiry" onclick="handleInquiry('${p.brand}', '${p.model}')">詢價</button>
        </div>
      </div>
    </div>`;
  }).join("");

  if (total > CONFIG.MAX_RESULTS) {
    el.innerHTML += `<p class="more-hint">另有 ${total - CONFIG.MAX_RESULTS} 筆符合，可縮小條件精準篩選</p>`;
  }
}

function showError(msg) {
  const el = document.getElementById("results");
  if (el) el.innerHTML = `<div class="empty"><p style="color:#d32f2f">${msg}</p></div>`;
}

// ── 篩選事件綁定 ──────────────────────────────────────────
function bindMenuFilters() {
  // 場景 chips
  document.querySelectorAll(".scene-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".scene-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      filters.scene = chip.dataset.val;
      render();
    });
  });

  // 下拉選單
  const selects = ["port", "speed", "poe", "mgmt", "uplink", "brand"];
  selects.forEach((key) => {
    const el = document.getElementById(`f-${key}`);
    if (el) el.addEventListener("change", (e) => { filters[key] = e.target.value; render(); });
  });
}

// ── 模式切換 ──────────────────────────────────────────────
function switchMode(mode) {
  document.querySelectorAll(".mode-tab").forEach((t, i) => {
    t.classList.toggle("active", (mode === "menu" && i === 0) || (mode === "llm" && i === 1));
  });
  document.getElementById("panel-menu").classList.toggle("show", mode === "menu");
  document.getElementById("panel-llm").classList.toggle("show", mode === "llm");
}

// ── LLM 解析 ─────────────────────────────────────────────
function fillExample(el) {
  const input = document.getElementById("llm-input");
  if (input) input.value = el.textContent.trim();
}

async function parseLLM() {
  const input = document.getElementById("llm-input");
  const text = input ? input.value.trim() : "";
  if (!text) return;

  if (!CONFIG.PROXY_URL || CONFIG.PROXY_URL.includes("YOUR_WORKER")) {
    alert("請先在 config.js 設定 PROXY_URL（Cloudflare Workers 網址）");
    return;
  }

  const thinking = document.getElementById("llm-thinking");
  const parsedBar = document.getElementById("llm-parsed");
  const btn = document.getElementById("llm-btn");

  if (thinking) thinking.classList.add("show");
  if (parsedBar) parsedBar.classList.remove("show");
  if (btn) btn.disabled = true;

  const prompt = `你是網路交換器選品助手。根據以下需求描述，解析篩選條件並只回傳 JSON，不要其他文字。

需求：「${text}」

回傳格式：
{"scene":"office|idc|smb|av","port":0|8|24|48,"speed":0|1|2|10,"poe":"none|poe+|poe++","mgmt":"0|unmanaged|l2|l3","uplink":0|1|10|25,"brand":"all|Dell|HPE|ZyXEL","summary":"一句話說明解析結果"}

判斷規則：
- 場景：監控/攝影機→av，機房/IDC/伺服器→idc，中小企業/預算有限→smb，其他→office
- PoE：有提到 AP/攝影機/IP Phone/PoE 需求→poe+，否則→none
- Port：有提到設備數量就往上取最近規格，例如 30 台→48，15 台→24，8 台以下→8
- 沒提到的條件填預設值（port=0, speed=0, mgmt="0", uplink=0, brand="all"）`;

  try {
    const res = await fetch(CONFIG.PROXY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 300,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    const data = await res.json();
    const raw = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());

    // 套用解析結果
    filters.scene = parsed.scene || "office";
    filters.port = parsed.port || 0;
    filters.speed = parsed.speed || 0;
    filters.poe = parsed.poe || "none";
    filters.mgmt = parsed.mgmt || "0";
    filters.uplink = parsed.uplink || 0;
    filters.brand = parsed.brand || "all";

    // 顯示解析摘要
    const labelMap = {
      scene: { office: "辦公室", idc: "機房/IDC", smb: "中小企業", av: "影音監控" },
      poe: { none: "不需 PoE", "poe+": "需要 PoE+", "poe++": "需要 PoE++" },
      mgmt: { "0": "管理不限", unmanaged: "Unmanaged", l2: "L2", "l2+": "L2+", l3: "L3" },
    };
    const tags = [
      `場景：${labelMap.scene[filters.scene] || filters.scene}`,
      filters.port > 0 ? `Port ≥ ${filters.port}` : "Port 不限",
      filters.speed > 0 ? `速度 ≥ ${filters.speed}G` : "速度不限",
      labelMap.poe[filters.poe] || filters.poe,
      labelMap.mgmt[filters.mgmt] || filters.mgmt,
      filters.uplink > 0 ? `Uplink ≥ ${filters.uplink}G` : "Uplink 不限",
      filters.brand !== "all" ? `品牌：${filters.brand}` : "全部品牌",
    ];

    if (parsedBar) {
      parsedBar.innerHTML = `<strong>已解析條件：</strong><div class="parsed-tags">${tags.map((t) => `<span class="parsed-tag">${t}</span>`).join("")}</div>${parsed.summary ? `<p class="parsed-summary">${parsed.summary}</p>` : ""}`;
      parsedBar.classList.add("show");
    }

    render();
  } catch (e) {
    if (parsedBar) {
      parsedBar.innerHTML = `<span style="color:#d32f2f">解析失敗，請重新輸入或改用選單篩選。</span>`;
      parsedBar.classList.add("show");
    }
    console.error(e);
  } finally {
    if (thinking) thinking.classList.remove("show");
    if (btn) btn.disabled = false;
  }
}

// ── 詢價動作 ──────────────────────────────────────────────
function handleInquiry(brand, model) {
  // 可自訂：開啟 Email、表單、或 LINE 連結
  const subject = encodeURIComponent(`詢價：${brand} ${model}`);
  const body = encodeURIComponent(`您好，我想詢問以下產品的報價與庫存：\n\n品牌：${brand}\n型號：${model}\n\n請提供報價，謝謝。`);
  window.location.href = `mailto:sales@yourcompany.com?subject=${subject}&body=${body}`;
}

// ── 初始化 ────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  bindMenuFilters();
  loadProducts();
});
