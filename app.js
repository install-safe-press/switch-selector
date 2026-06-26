// ============================================================
// app.js — 主要邏輯
// v2：修正 mgmt l2+ 支援、port_speed 防呆、LLM prompt 更新
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

// ── 讀取 Google Sheets CSV ────────────────────────────────
async function loadProducts() {
  try {
    const res = await fetch(CONFIG.SHEET_URL);
    const csv = await res.text();

    // 跳過第一列（若是群組標題）並找到真正的 header 列
    const lines = csv.split("\n").filter((l) => l.trim());

    // 找出 brand 欄位所在列（真正的 header），跳過之前所有列
    let dataStart = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes("brand") && lines[i].toLowerCase().includes("model")) {
        dataStart = i + 1;
        break;
      }
    }

    allProducts = lines
      .slice(dataStart)
      .filter((l) => l.trim())
      .map((line) => {
        // CSV 解析：處理引號內含逗號的情況
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

        // port_speed 防呆：若 Sheets 誤存成日期字串則 fallback 為 1
        const rawSpeed = cols[4] || "";
        let portSpeed = parseFloat(rawSpeed);
        if (isNaN(portSpeed) || rawSpeed.includes("-") || rawSpeed.includes("/")) {
          portSpeed = 1; // fallback，避免日期格式破壞篩選
        }

        // mgmt_level 正規化：「簡易網管」→ l2，數字→ l2
        let mgmt = (cols[8] || "l2").trim().toLowerCase();
        if (mgmt === "簡易網管" || mgmt === "smart" || !isNaN(parseFloat(mgmt))) {
          mgmt = "l2";
        }

        // poe_type 正規化：「poe」→「poe+」
        let poeType = (cols[5] || "none").trim().toLowerCase();
        if (poeType === "poe") poeType = "poe+";

        return {
          brand:         (cols[0] || "").trim(),
          model:         (cols[1] || "").trim(),
          product_line:  (cols[2] || "").trim(),
          port_count:    parseInt(cols[3]) || 0,
          port_speed:    portSpeed,
          poe_type:      poeType,
          poe_budget_w:  parseInt(cols[6]) || 0,
          uplink_speed:  parseInt(cols[7]) || 1,
          mgmt_level:    mgmt,
          scene_office:  cols[9]  === "TRUE",
          scene_idc:     cols[10] === "TRUE",
          scene_smb:     cols[11] === "TRUE",
          scene_av:      cols[12] === "TRUE",
          highlights:    cols[13] ? cols[13].split(",").map((h) => h.trim()).filter(Boolean) : [],
          description:   (cols[14] || "").trim(),
          datasheet_url: (cols[15] || "").trim(),
          is_active:     cols[16] === "TRUE",
          sort_weight:   parseInt(cols[17]) || 50,
        };
      })
      .filter((p) => p.is_active && p.model && p.brand);

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
    idc:    p.scene_idc,
    smb:    p.scene_smb,
    av:     p.scene_av,
  };
  if (sceneMap[filters.scene]) score += 30;

  // Port 數量（硬篩：不足直接排除）
  if (filters.port > 0 && p.port_count < parseInt(filters.port)) return null;
  score += filters.port > 0 ? 15 : 8;

  // Port 速度（硬篩）
  if (filters.speed > 0 && p.port_speed < parseFloat(filters.speed)) return null;
  score += filters.speed > 0 ? 15 : 8;

  // PoE 需求（硬篩）
  const poeOrder = { none: 0, "poe+": 1, "poe++": 2 };
  const needPoe = poeOrder[filters.poe] ?? 0;
  const hasPoe  = poeOrder[p.poe_type]  ?? 0;
  if (needPoe > 0 && hasPoe === 0) return null;
  score += needPoe > 0 ? 15 : 5;

  // 管理層級（硬篩）
  // l2+ 介於 l2 與 l3 之間：選 l2 可看到 l2+，選 l3 看不到 l2
  const mgmtOrder = { unmanaged: 0, l2: 1, "l2+": 2, l3: 3 };
  const needMgmt = mgmtOrder[filters.mgmt] ?? -1;
  const hasMgmt  = mgmtOrder[p.mgmt_level] ?? 1;
  if (needMgmt >= 0 && hasMgmt < needMgmt) return null;
  score += needMgmt >= 0 ? 10 : 5;

  // Uplink（硬篩）
  if (filters.uplink > 0 && p.uplink_speed < parseInt(filters.uplink)) return null;
  score += filters.uplink > 0 ? 10 : 5;

  // 品牌偏好（硬篩）
  if (filters.brand !== "all" && p.brand !== filters.brand) return null;
  if (filters.brand !== "all") score += 5;

  // sort_weight 加成（最多 +10，讓業務主推策略影響排序）
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

  const top   = results.slice(0, CONFIG.MAX_RESULTS);
  const total = results.length;

  const countEl    = document.getElementById("result-count");
  const subtitleEl = document.getElementById("result-subtitle");
  if (countEl)    countEl.textContent    = Math.min(total, CONFIG.MAX_RESULTS) + (total > CONFIG.MAX_RESULTS ? ` / ${total}` : "");
  if (subtitleEl) subtitleEl.textContent = total > CONFIG.MAX_RESULTS
    ? `共 ${total} 筆符合，顯示前 ${CONFIG.MAX_RESULTS} 名`
    : "依匹配度排序";

  const el = document.getElementById("results");
  if (!el) return;

  if (!top.length) {
    el.innerHTML = `<div class="empty"><div class="empty-icon">🔍</div><p>無符合條件的型號</p><span>請放寬篩選條件，或清除部分選項</span></div>`;
    return;
  }

  el.innerHTML = top.map((p, i) => {
    const brandClass = p.brand.toLowerCase().replace(/\s/g, "-");
    const dsLink = p.datasheet_url
      ? `<a href="${p.datasheet_url}" target="_blank" class="ds-link">規格書 ↗</a>`
      : "";
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
  document.querySelectorAll(".scene-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll(".scene-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      filters.scene = chip.dataset.val;
      render();
    });
  });

  ["port", "speed", "poe", "mgmt", "uplink", "brand"].forEach((key) => {
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
  const text  = input ? input.value.trim() : "";
  if (!text) return;

  if (!CONFIG.PROXY_URL || CONFIG.PROXY_URL.includes("YOUR_WORKER")) {
    alert("請先在 config.js 設定 PROXY_URL（Cloudflare Workers 網址）");
    return;
  }

  const thinking  = document.getElementById("llm-thinking");
  const parsedBar = document.getElementById("llm-parsed");
  const btn       = document.getElementById("llm-btn");

  if (thinking)  thinking.classList.add("show");
  if (parsedBar) parsedBar.classList.remove("show");
  if (btn)       btn.disabled = true;

  const prompt = `你是網路交換器選品助手。根據以下需求描述，解析篩選條件並只回傳 JSON，不要其他文字。

需求：「${text}」

回傳格式：
{"scene":"office|idc|smb|av","port":0|8|24|48|96,"speed":0|1|2|10|25|100|400|800,"poe":"none|poe+|poe++","mgmt":"0|unmanaged|l2|l2+|l3","uplink":0|1|10|25|100|400|800,"brand":"all|Dell|HPE|ZyXEL","summary":"一句話說明解析結果"}

判斷規則：
- 場景：監控/攝影機→av，機房/IDC/伺服器/AI/HPC→idc，中小企業/預算有限→smb，其他→office
- PoE：有提到 AP/攝影機/IP Phone/PoE→poe+，有提到 PoE++ 或高瓦數→poe++，否則→none
- Port：依設備數量往上取最近規格（5台→8，20台→24，30台→48，100台→96）
- Speed：有提到 25G/100G/400G/800G 就填對應值，Wi-Fi 6→建議 2.5G，一般辦公→1
- mgmt：Web 管理/簡易管理→l2，需要路由 OSPF/BGP→l3，其他→0
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

    const data   = await res.json();
    const raw    = data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim());

    filters.scene  = parsed.scene  || "office";
    filters.port   = parsed.port   || 0;
    filters.speed  = parsed.speed  || 0;
    filters.poe    = parsed.poe    || "none";
    filters.mgmt   = parsed.mgmt   || "0";
    filters.uplink = parsed.uplink || 0;
    filters.brand  = parsed.brand  || "all";

    const labelMap = {
      scene: { office: "辦公室", idc: "機房/IDC", smb: "中小企業", av: "影音監控" },
      poe:   { none: "不需 PoE", "poe+": "需要 PoE+", "poe++": "需要 PoE++" },
      mgmt:  { "0": "管理不限", unmanaged: "Unmanaged", l2: "L2", "l2+": "L2+", l3: "L3" },
    };
    const tags = [
      `場景：${labelMap.scene[filters.scene] || filters.scene}`,
      filters.port   > 0    ? `Port ≥ ${filters.port}`    : "Port 不限",
      filters.speed  > 0    ? `速度 ≥ ${filters.speed}G`  : "速度不限",
      labelMap.poe[filters.poe]   || filters.poe,
      labelMap.mgmt[filters.mgmt] || filters.mgmt,
      filters.uplink > 0    ? `Uplink ≥ ${filters.uplink}G` : "Uplink 不限",
      filters.brand !== "all" ? `品牌：${filters.brand}` : "全部品牌",
    ];

    if (parsedBar) {
      parsedBar.innerHTML = `<strong>已解析條件：</strong>
        <div class="parsed-tags">${tags.map((t) => `<span class="parsed-tag">${t}</span>`).join("")}</div>
        ${parsed.summary ? `<p class="parsed-summary">${parsed.summary}</p>` : ""}`;
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
    if (btn)      btn.disabled = false;
  }
}

// ── 詢價動作 ──────────────────────────────────────────────
function handleInquiry(brand, model) {
  const subject = encodeURIComponent(`詢價：${brand} ${model}`);
  const body    = encodeURIComponent(`您好，我想詢問以下產品的報價與庫存：\n\n品牌：${brand}\n型號：${model}\n\n請提供報價，謝謝。`);
  window.location.href = `mailto:sales@yourcompany.com?subject=${subject}&body=${body}`;
}

// ── 初始化 ────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  bindMenuFilters();
  loadProducts();
});
