// ============================================================
// app.js — 主要邏輯
// v4：比較功能（Modal），移除詢價，修正欄位索引
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

// 比較清單（最多 3 台）
let compareList = [];

// ── 讀取 Google Sheets CSV ────────────────────────────────
async function loadProducts() {
  try {
    const res = await fetch(CONFIG.SHEET_URL);
    const csv = await res.text();

    const lines = csv.split("\n").filter((l) => l.trim());

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

        // port_speed 防呆
        const rawSpeed = cols[4] || "";
        let portSpeed = parseFloat(rawSpeed);
        if (isNaN(portSpeed) || rawSpeed.includes("-") || rawSpeed.includes("/")) {
          portSpeed = 1;
        }

        // mgmt_level 正規化
        let mgmt = (cols[8] || "l2").trim().toLowerCase();
        if (["web", "smart", "簡易網管"].includes(mgmt) || !isNaN(parseFloat(mgmt))) {
          mgmt = "l2";
        } else if (!["unmanaged", "l2", "l2+", "l3"].includes(mgmt)) {
          mgmt = "l2";
        }

        // poe_type 正規化
        let poeType = (cols[5] || "none").trim().toLowerCase();
        if (poeType === "poe") poeType = "poe+";

        // supports_multigig
        const supportsMultigig = portSpeed === 2.5;

        return {
          brand:             (cols[0]  || "").trim(),
          model:             (cols[1]  || "").trim(),
          product_line:      (cols[2]  || "").trim(),
          port_count:        parseInt(cols[3])  || 0,
          port_speed:        portSpeed,
          poe_type:          poeType,
          poe_budget_w:      parseInt(cols[6])  || 0,
          uplink_speed:      parseInt(cols[7])  || 1,
          mgmt_level:        mgmt,
          scene_office:      cols[9]  === "TRUE",
          scene_idc:         cols[10] === "TRUE",
          scene_smb:         cols[11] === "TRUE",
          scene_av:          cols[12] === "TRUE",
          highlights:        cols[13] ? cols[13].split(/[|,]/).map((h) => h.trim()).filter(Boolean) : [],
          description:       (cols[14] || "").trim(),
          datasheet_url:     (cols[15] || "").trim(),
          supports_multigig: supportsMultigig,
          is_active:         cols[16] === "TRUE",
          sort_weight:       parseInt(cols[17]) || 50,
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

  const sceneMap = {
    office: p.scene_office,
    idc:    p.scene_idc,
    smb:    p.scene_smb,
    av:     p.scene_av,
  };
  if (sceneMap[filters.scene]) score += 30;

  // Port 數量（鄰近度遞減）
  if (filters.port > 0) {
    if (p.port_count < parseInt(filters.port)) return null;
    const ratio = p.port_count / parseInt(filters.port);
    if (ratio <= 1.5) score += 15;
    else if (ratio <= 3) score += 8;
    else score += 2;
  } else {
    score += 8;
  }

  // Port 速度（Multi-Gig 獨立路徑）
  if (filters.speed === "multigig") {
    if (!p.supports_multigig) return null;
    score += 15;
  } else if (filters.speed > 0) {
    if (p.port_speed < parseFloat(filters.speed)) return null;
    if (p.supports_multigig && parseFloat(filters.speed) >= 10) return null;
    const ratio = p.port_speed / parseFloat(filters.speed);
    if (ratio <= 2) score += 15;
    else if (ratio <= 10) score += 8;
    else score += 2;
  } else {
    score += 8;
  }

  // PoE 需求
  const poeOrder = { none: 0, "poe+": 1, "poe++": 2 };
  const needPoe = poeOrder[filters.poe] ?? 0;
  const hasPoe  = poeOrder[p.poe_type]  ?? 0;
  if (needPoe > 0 && hasPoe === 0) return null;
  score += needPoe > 0 ? 15 : 5;

  // 管理層級
  if (filters.mgmt === "unmanaged" && p.mgmt_level !== "unmanaged") return null;
  const mgmtOrder = { unmanaged: 0, l2: 1, "l2+": 2, l3: 3 };
  const needMgmt = mgmtOrder[filters.mgmt] ?? -1;
  const hasMgmt  = mgmtOrder[p.mgmt_level] ?? 1;
  if (filters.mgmt !== "unmanaged" && needMgmt >= 0 && hasMgmt < needMgmt) return null;
  score += needMgmt >= 0 ? 10 : 5;

  // Uplink
  if (filters.uplink > 0 && p.uplink_speed < parseInt(filters.uplink)) return null;
  score += filters.uplink > 0 ? 10 : 5;

  // 品牌
  if (filters.brand !== "all" && p.brand !== filters.brand) return null;
  if (filters.brand !== "all") score += 5;

  // sort_weight
  score += Math.round((p.sort_weight / 100) * 10);

  return Math.min(score, 100);
}

// ── 比較清單管理 ──────────────────────────────────────────
function toggleCompare(model) {
  const idx = compareList.findIndex((p) => p.model === model);
  if (idx >= 0) {
    compareList.splice(idx, 1);
  } else {
    if (compareList.length >= 3) {
      alert("最多只能勾選 3 台進行比較");
      return;
    }
    const product = allProducts.find((p) => p.model === model);
    if (product) compareList.push(product);
  }
  updateCompareBar();
  updateCheckboxes();
}

function updateCompareBar() {
  const bar = document.getElementById("compare-bar");
  const btn = document.getElementById("compare-btn");
  const names = document.getElementById("compare-names");
  if (!bar) return;

  if (compareList.length > 0) {
    bar.classList.add("show");
    names.innerHTML = compareList.map((p) =>
      `<span class="cmp-tag">${p.brand} ${p.model}
        <button onclick="removeCompare('${p.model}')" aria-label="移除">×</button>
      </span>`
    ).join("");
    btn.disabled = compareList.length < 2;
    btn.textContent = compareList.length < 2
      ? "再選 1 台即可比較"
      : `比較 ${compareList.length} 台型號`;
  } else {
    bar.classList.remove("show");
  }
}

function removeCompare(model) {
  compareList = compareList.filter((p) => p.model !== model);
  updateCompareBar();
  updateCheckboxes();
}

function updateCheckboxes() {
  document.querySelectorAll(".cmp-checkbox").forEach((cb) => {
    const model = cb.dataset.model;
    const inList = compareList.some((p) => p.model === model);
    cb.checked = inList;
    cb.disabled = !inList && compareList.length >= 3;
  });
}

// ── 比較 Modal ────────────────────────────────────────────
function openCompareModal() {
  if (compareList.length < 2) return;

  const rows = [
    { label: "品牌",     key: (p) => p.brand },
    { label: "產品線",   key: (p) => p.product_line || "—" },
    { label: "Port 數",  key: (p) => p.port_count + " port" },
    { label: "Port 速度", key: (p) => p.port_speed >= 1000 ? p.port_speed + "G" : p.port_speed === 2.5 ? "2.5G (Multi-Gig)" : p.port_speed + "G" },
    { label: "PoE 類型", key: (p) => p.poe_type === "none" ? "無" : p.poe_type.toUpperCase() },
    { label: "PoE 預算", key: (p) => p.poe_budget_w > 0 ? p.poe_budget_w + "W" : "—" },
    { label: "Uplink",   key: (p) => p.uplink_speed + "G" },
    { label: "管理層級", key: (p) => ({ unmanaged: "無網管", l2: "基礎管理 (L2)", "l2+": "進階管理 (L2+)", l3: "完整路由 (L3)" }[p.mgmt_level] || p.mgmt_level) },
    { label: "適用場景", key: (p) => [p.scene_office && "辦公室", p.scene_idc && "機房", p.scene_smb && "SMB", p.scene_av && "監控"].filter(Boolean).join("、") || "—" },
    { label: "亮點規格", key: (p) => p.highlights.join(" / ") || "—" },
    { label: "匹配分數", key: (p) => (p.score !== undefined ? p.score + "%" : "—"), isScore: true },
    { label: "規格書",   key: (p) => p.datasheet_url ? `<a href="${p.datasheet_url}" target="_blank" class="ds-link">開啟 ↗</a>` : "—" },
  ];

  // 找出數值差異欄位（同一欄數值不同的欄位加標記）
  const diffFields = new Set();
  rows.forEach((row, ri) => {
    const vals = compareList.map((p) => row.key(p));
    if (new Set(vals).size > 1) diffFields.add(ri);
  });

  const thCols = compareList.map((p) => {
    const brandClass = p.brand.toLowerCase().replace(/\s/g, "-");
    const score = p.score !== undefined ? `<span class="modal-score">${p.score}%</span>` : "";
    return `<th>
      <span class="brand-tag brand-tag--${brandClass}">${p.brand}</span>
      <div class="modal-model">${p.model}</div>
      ${score}
    </th>`;
  }).join("");

  const bodyRows = rows.map((row, ri) => {
    const isDiff = diffFields.has(ri);
    const tds = compareList.map((p) => {
      const val = row.key(p);
      return `<td class="${isDiff ? "diff-cell" : ""} ${row.isScore ? "score-cell" : ""}">${val}</td>`;
    }).join("");
    return `<tr class="${isDiff ? "diff-row" : ""}">
      <td class="row-label">${row.label} ${isDiff ? '<span class="diff-badge">差異</span>' : ""}</td>
      ${tds}
    </tr>`;
  }).join("");

  const modal = document.getElementById("compare-modal");
  document.getElementById("compare-table-wrap").innerHTML = `
    <table class="cmp-table">
      <thead><tr><th class="row-label">規格項目</th>${thCols}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
  modal.classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeCompareModal() {
  document.getElementById("compare-modal").classList.remove("show");
  document.body.style.overflow = "";
}

// ── 渲染結果 ──────────────────────────────────────────────
const MEDALS = ["🥇", "🥈", "🥉", "4", "5", "6", "7", "8", "9", "10"];

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

  // 重設比較清單的 score 欄位
  compareList.forEach((cp) => {
    const found = results.find((r) => r.model === cp.model);
    if (found) cp.score = found.score;
  });

  el.innerHTML = top.map((p, i) => {
    const brandClass = p.brand.toLowerCase().replace(/\s/g, "-");
    const dsLink = p.datasheet_url
      ? `<a href="${p.datasheet_url}" target="_blank" class="ds-link">規格書 ↗</a>`
      : "";
    const inCompare = compareList.some((c) => c.model === p.model);
    const cbDisabled = !inCompare && compareList.length >= 3 ? "disabled" : "";
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
          <label class="cmp-label" title="${compareList.length >= 3 && !inCompare ? "最多比較3台" : "加入比較"}">
            <input type="checkbox"
              class="cmp-checkbox"
              data-model="${p.model}"
              ${inCompare ? "checked" : ""}
              ${cbDisabled}
              onchange="toggleCompare('${p.model}')">
            比較
          </label>
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

  if (!CONFIG.PROXY_URL || CONFIG.PROXY_URL.includes("YOUR_WORKER") || !CONFIG.PROXY_URL) {
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
{"scene":"office|idc|smb|av","port":0|8|24|48|96,"speed":0|1|"multigig"|10|25|100|400|800,"poe":"none|poe+|poe++","mgmt":"0|unmanaged|l2|l2+|l3","uplink":0|1|10|25|100|400|800,"brand":"all|Dell|HPE|ZyXEL","summary":"一句話說明解析結果"}

判斷規則：
- 場景：監控/攝影機→av，機房/IDC/伺服器/AI/HPC→idc，中小企業/預算有限→smb，其他→office
- PoE：有提到 AP/攝影機/IP Phone/PoE→poe+，有提到 PoE++ 或高瓦數→poe++，否則→none
- Port：依設備數量往上取最近規格（5台→8，20台→24，30台→48，100台→96）
- Speed：有提到 Wi-Fi 6/7 AP 搭配→multigig，25G/100G/400G/800G→對應數字，一般辦公→1，其他→0
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
      mgmt:  { "0": "管理不限", unmanaged: "無網管", l2: "基礎管理", "l2+": "進階管理", l3: "完整路由" },
    };
    const speedLabel = filters.speed === "multigig" ? "Multi-Gig（Wi-Fi 6/7）"
                     : filters.speed > 0 ? `速度 ≥ ${filters.speed}G` : "速度不限";
    const tags = [
      `場景：${labelMap.scene[filters.scene] || filters.scene}`,
      filters.port   > 0       ? `Port ≥ ${filters.port}` : "Port 不限",
      speedLabel,
      labelMap.poe[filters.poe]   || filters.poe,
      labelMap.mgmt[filters.mgmt] || filters.mgmt,
      filters.uplink > 0        ? `Uplink ≥ ${filters.uplink}G` : "Uplink 不限",
      filters.brand !== "all"   ? `品牌：${filters.brand}` : "全部品牌",
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

// ── 初始化 ────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  bindMenuFilters();
  loadProducts();

  // 點 Modal 背景關閉
  const modal = document.getElementById("compare-modal");
  if (modal) {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeCompareModal();
    });
  }

  // ESC 關閉
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeCompareModal();
  });
});
