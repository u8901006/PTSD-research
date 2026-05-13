#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const API_BASE = process.env.ZHIPU_API_BASE || "https://open.bigmodel.cn/api/coding/paas/v4";
const MODELS = ["glm-5-turbo", "glm-4.7", "glm-4.7-flash"];
const MAX_TOKENS = 50000;
const TIMEOUT_MS = 480_000;

const SYSTEM_PROMPT = `你是 PTSD（創傷後壓力症候群）研究領域的資深學術摘要與分析專家。你的任務是：
1. 從提供的文獻中精確擷取核心發現，分析其對臨床實務與研究的意涵
2. 每篇文獻需包含中文摘要、關鍵發現、PICO 分析
3. 標註臨床實用性（高/中/低）
4. 生成適合臨床專業人士閱讀的繁體中文報告

輸出格式要求：
- 語言：繁體中文（台灣用語）
- 專業但易讀
- 每篇文獻須包含：中文標題、一句話摘要、PICO分析、臨床實用性、關鍵標籤
- 最後提供今日 TOP 3（最重要/最影響臨床實務的文獻）
- 回傳格式必須是純 JSON，不要用 markdown code block 包裹。`;

function loadPapers(path) {
  const raw = readFileSync(path, "utf-8");
  return JSON.parse(raw);
}

function buildPrompt(papersData) {
  const dateStr = papersData.date;
  const count = papersData.count;
  const papersText = JSON.stringify(papersData.papers, null, 2);

  return `以下是 ${dateStr} 從 PubMed 擷取的最新 PTSD 相關文獻（共 ${count} 篇）。

請進行以下分析，並以 JSON 格式回傳（不要用 markdown code block 包裹，直接回傳純 JSON）：

{
  "date": "${dateStr}",
  "market_summary": "1-2句話總結今日PTSD研究動態與亮點",
  "top_picks": [
    {
      "rank": 1,
      "title_zh": "中文標題",
      "title_en": "English Title",
      "journal": "期刊名",
      "summary": "一句話摘要（繁體中文，點出核心發現與臨床意涵）",
      "pico": {
        "population": "研究對象",
        "intervention": "介入措施",
        "comparison": "對照組",
        "outcome": "主要結果"
      },
      "clinical_utility": "高/中/低",
      "utility_reason": "簡述為何如此評分的理由",
      "tags": ["標籤1", "標籤2"],
      "url": "連結",
      "emoji": "合適emoji"
    }
  ],
  "all_papers": [
    {
      "title_zh": "中文標題",
      "title_en": "English Title",
      "journal": "期刊名",
      "summary": "一句話摘要",
      "clinical_utility": "高/中/低",
      "tags": ["標籤1"],
      "url": "連結",
      "emoji": "emoji"
    }
  ],
  "keywords": ["關鍵詞1", "關鍵詞2"],
  "topic_distribution": {
    "治療": 3,
    "神經生物學": 2
  }
}

原始文獻資料：
${papersText}

請挑出最重要的 TOP 5-8 篇文獻放入 top_picks（按重要性排序），其餘放入 all_papers。
每篇 paper 的 tags 請從以下選擇：治療、心理治療、藥物治療、PTSD、複雜性PTSD、神經生物學、生物標記、基因學、流行病學、兒童創傷、退伍軍人、難民、睡眠、物質使用、自殺、神經影像、道德損傷、社會決定因素、數位健康、實施科學、解離、評估測量、伴侶暴力、災難、急救人員、正念、EMDR、暴露治療、認知處理治療、MDMA輔助治療、rTMS、ketamine。
注意：回傳純 JSON，不要用 \`\`\`json\`\`\` 包裹。`;
}

function sanitizeJson(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    const firstNewline = cleaned.indexOf("\n");
    cleaned = firstNewline >= 0 ? cleaned.slice(firstNewline + 1) : cleaned.slice(3);
    cleaned = cleaned.replace(/```+\s*$/,"");
    cleaned = cleaned.trim();
  }
  if (cleaned.startsWith("json\n")) cleaned = cleaned.slice(5);
  if (cleaned.startsWith("json")) cleaned = cleaned.slice(4);
  return cleaned;
}

async function callZhipu(apiKey, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const resp = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (resp.status === 429) {
      const retryAfter = parseInt(resp.headers.get("retry-after") || "60", 10);
      console.error(`[WARN] Rate limited, waiting ${retryAfter}s...`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return { retry: true };
    }

    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 300)}`);
    }

    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error("Empty response content");
    return { content };
  } finally {
    clearTimeout(timer);
  }
}

async function analyzePapers(apiKey, papersData) {
  const prompt = buildPrompt(papersData);

  for (const model of MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        console.error(`[INFO] Trying ${model} (attempt ${attempt + 1})...`);
        const payload = {
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          top_p: 0.9,
          max_tokens: MAX_TOKENS,
        };

        const result = await callZhipu(apiKey, payload);

        if (result.retry) {
          attempt--;
          continue;
        }

        const cleaned = sanitizeJson(result.content);

        let parsed;
        try {
          parsed = JSON.parse(cleaned);
        } catch (jsonErr) {
          console.error(`[WARN] JSON parse failed, attempting repair...`);
          const repaired = repairJson(cleaned);
          parsed = JSON.parse(repaired);
        }

        console.error(
          `[INFO] Analysis complete: ${parsed.top_picks?.length || 0} top picks, ${parsed.all_papers?.length || 0} total`
        );
        return parsed;
      } catch (e) {
        console.error(`[WARN] ${model} attempt ${attempt + 1} failed: ${e.message}`);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  console.error("[ERROR] All models and attempts failed");
  return null;
}

function repairJson(text) {
  let s = text;
  s = s.replace(/[\x00-\x1f]+/g, (m) => {
    if (m.includes("\n") || m.includes("\r") || m.includes("\t")) return m;
    return "";
  });

  const lastBrace = s.lastIndexOf("}");
  if (lastBrace >= 0 && lastBrace < s.length - 1) {
    const after = s.slice(lastBrace + 1).trim();
    if (after && !after.startsWith("}") && !after.startsWith("]")) {
      s = s.slice(0, lastBrace + 1);
    }
  }

  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") depth++;
    if (c === "}" || c === "]") depth--;
  }
  while (depth > 0) {
    s += depth > 0 ? "}" : "]";
    depth--;
  }
  while (depth < 0) {
    s = "{" + s;
    depth++;
  }

  s = s.replace(/,\s*([}\]])/g, "$1");

  return s;
}

function generateHtml(analysis) {
  const dateStr = analysis.date || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const parts = dateStr.split("-");
  const dateDisplay = parts.length === 3 ? `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日` : dateStr;
  const summary = analysis.market_summary || "";
  const topPicks = analysis.top_picks || [];
  const allPapers = analysis.all_papers || [];
  const keywords = analysis.keywords || [];
  const topicDist = analysis.topic_distribution || {};
  const totalCount = topPicks.length + allPapers.length;

  const topPicksHtml = topPicks.map((p) => {
    const tags = (p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    const util = p.clinical_utility || "中";
    const uc = util === "高" ? "utility-high" : util === "中" ? "utility-mid" : "utility-low";
    const pico = p.pico || {};
    const picoHtml = Object.keys(pico).length
      ? `<div class="pico-grid">
      <div class="pico-item"><span class="pico-label">P</span><span class="pico-text">${esc(pico.population || "-")}</span></div>
      <div class="pico-item"><span class="pico-label">I</span><span class="pico-text">${esc(pico.intervention || "-")}</span></div>
      <div class="pico-item"><span class="pico-label">C</span><span class="pico-text">${esc(pico.comparison || "-")}</span></div>
      <div class="pico-item"><span class="pico-label">O</span><span class="pico-text">${esc(pico.outcome || "-")}</span></div>
    </div>`
      : "";
    return `<div class="news-card featured">
    <div class="card-header">
      <span class="rank-badge">#${p.rank || ""}</span>
      <span class="emoji-icon">${p.emoji || "📄"}</span>
      <span class="${uc}">${esc(util)}實用性</span>
    </div>
    <h3>${esc(p.title_zh || p.title_en || "")}</h3>
    <p class="journal-source">${esc(p.journal || "")} &middot; ${esc(p.title_en || "")}</p>
    <p>${esc(p.summary || "")}</p>
    ${picoHtml}
    <div class="card-footer">
      ${tags}
      <a href="${esc(p.url || "#")}" target="_blank">閱讀原文 &rarr;</a>
    </div>
  </div>`;
  }).join("\n");

  const allPapersHtml = allPapers.map((p) => {
    const tags = (p.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    const util = p.clinical_utility || "中";
    const uc = util === "高" ? "utility-high" : util === "中" ? "utility-mid" : "utility-low";
    return `<div class="news-card">
    <div class="card-header-row">
      <span class="emoji-sm">${p.emoji || "📄"}</span>
      <span class="${uc} utility-sm">${esc(util)}</span>
    </div>
    <h3>${esc(p.title_zh || p.title_en || "")}</h3>
    <p class="journal-source">${esc(p.journal || "")}</p>
    <p>${esc(p.summary || "")}</p>
    <div class="card-footer">
      ${tags}
      <a href="${esc(p.url || "#")}" target="_blank">PubMed &rarr;</a>
    </div>
  </div>`;
  }).join("\n");

  const keywordsHtml = keywords.map((k) => `<span class="keyword">${esc(k)}</span>`).join("");
  const maxCount = Math.max(...Object.values(topicDist), 1);
  const topicBarsHtml = Object.entries(topicDist)
    .map(([topic, count]) => {
      const width = Math.round((count / maxCount) * 100);
      return `<div class="topic-row">
      <span class="topic-name">${esc(topic)}</span>
      <div class="topic-bar-bg"><div class="topic-bar" style="width:${width}%"></div></div>
      <span class="topic-count">${count}</span>
    </div>`;
    })
    .join("\n");

  const modelUsed = "GLM-5-Turbo";

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>PTSD Research Daily &middot; 創傷後壓力研究日報 &middot; ${dateDisplay}</title>
<meta name="description" content="${dateDisplay} PTSD 創傷後壓力研究日報，由 AI 自動彙整 PubMed 最新論文"/>
<style>
  :root { --bg: #f6f1e8; --surface: #fffaf2; --line: #d8c5ab; --text: #2b2118; --muted: #766453; --accent: #8c4f2b; --accent-soft: #ead2bf; --card-bg: color-mix(in srgb, var(--surface) 92%, white); }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(circle at top, #fff6ea 0, var(--bg) 55%, #ead8c6 100%); color: var(--text); font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif; min-height: 100vh; overflow-x: hidden; }
  .container { position: relative; z-index: 1; max-width: 880px; margin: 0 auto; padding: 60px 32px 80px; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 52px; animation: fadeDown 0.6s ease both; }
  .logo { width: 48px; height: 48px; border-radius: 14px; background: var(--accent); display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0; box-shadow: 0 4px 20px rgba(140,79,43,0.25); }
  .header-text h1 { font-size: 22px; font-weight: 700; color: var(--text); letter-spacing: -0.3px; }
  .header-meta { display: flex; gap: 8px; margin-top: 6px; flex-wrap: wrap; align-items: center; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 20px; font-size: 11px; letter-spacing: 0.3px; }
  .badge-date { background: var(--accent-soft); border: 1px solid var(--line); color: var(--accent); }
  .badge-count { background: rgba(140,79,43,0.06); border: 1px solid var(--line); color: var(--muted); }
  .badge-source { background: transparent; color: var(--muted); font-size: 11px; padding: 0 4px; }
  .summary-card { background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; padding: 28px 32px; margin-bottom: 32px; box-shadow: 0 20px 60px rgba(61,36,15,0.06); animation: fadeUp 0.5s ease 0.1s both; }
  .summary-card h2 { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.6px; color: var(--accent); margin-bottom: 16px; }
  .summary-text { font-size: 15px; line-height: 1.8; color: var(--text); }
  .section { margin-bottom: 36px; animation: fadeUp 0.5s ease both; }
  .section-title { display: flex; align-items: center; gap: 10px; font-size: 17px; font-weight: 700; color: var(--text); margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid var(--line); }
  .section-icon { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 14px; flex-shrink: 0; background: var(--accent-soft); }
  .news-card { background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; padding: 22px 26px; margin-bottom: 12px; box-shadow: 0 8px 30px rgba(61,36,15,0.04); transition: background 0.2s, border-color 0.2s, transform 0.2s; }
  .news-card:hover { transform: translateY(-2px); box-shadow: 0 12px 40px rgba(61,36,15,0.08); }
  .news-card.featured { border-left: 3px solid var(--accent); }
  .news-card.featured:hover { border-color: var(--accent); }
  .card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .rank-badge { background: var(--accent); color: #fff7f0; font-weight: 700; font-size: 12px; padding: 2px 8px; border-radius: 6px; }
  .emoji-icon { font-size: 18px; }
  .card-header-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .emoji-sm { font-size: 14px; }
  .news-card h3 { font-size: 15px; font-weight: 600; color: var(--text); margin-bottom: 8px; line-height: 1.5; }
  .journal-source { font-size: 12px; color: var(--accent); margin-bottom: 8px; opacity: 0.8; }
  .news-card p { font-size: 13.5px; line-height: 1.75; color: var(--muted); }
  .card-footer { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .tag { padding: 2px 9px; background: var(--accent-soft); border-radius: 999px; font-size: 11px; color: var(--accent); }
  .news-card a { font-size: 12px; color: var(--accent); text-decoration: none; opacity: 0.7; margin-left: auto; }
  .news-card a:hover { opacity: 1; }
  .utility-high { color: #5a7a3a; font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(90,122,58,0.1); border-radius: 4px; }
  .utility-mid { color: #9f7a2e; font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(159,122,46,0.1); border-radius: 4px; }
  .utility-low { color: var(--muted); font-size: 11px; font-weight: 600; padding: 2px 8px; background: rgba(118,100,83,0.08); border-radius: 4px; }
  .utility-sm { font-size: 10px; }
  .pico-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; padding: 12px; background: rgba(255,253,249,0.8); border-radius: 14px; border: 1px solid var(--line); }
  .pico-item { display: flex; gap: 8px; align-items: baseline; }
  .pico-label { font-size: 10px; font-weight: 700; color: #fff7f0; background: var(--accent); padding: 2px 6px; border-radius: 4px; flex-shrink: 0; }
  .pico-text { font-size: 12px; color: var(--muted); line-height: 1.4; }
  .keywords-section { margin-bottom: 36px; }
  .keywords { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
  .keyword { padding: 5px 14px; background: var(--accent-soft); border: 1px solid var(--line); border-radius: 20px; font-size: 12px; color: var(--accent); cursor: default; transition: background 0.2s; }
  .keyword:hover { background: rgba(140,79,43,0.18); }
  .topic-section { margin-bottom: 36px; }
  .topic-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .topic-name { font-size: 13px; color: var(--muted); width: 100px; flex-shrink: 0; text-align: right; }
  .topic-bar-bg { flex: 1; height: 8px; background: var(--line); border-radius: 4px; overflow: hidden; }
  .topic-bar { height: 100%; background: linear-gradient(90deg, var(--accent), #c47a4a); border-radius: 4px; transition: width 0.6s ease; }
  .topic-count { font-size: 12px; color: var(--accent); width: 24px; }
  .footer-links { margin-top: 48px; display: flex; flex-direction: column; gap: 12px; animation: fadeUp 0.5s ease 0.4s both; }
  .footer-link { display: flex; align-items: center; gap: 14px; padding: 18px 24px; background: var(--card-bg); border: 1px solid var(--line); border-radius: 24px; text-decoration: none; color: var(--text); transition: all 0.2s; box-shadow: 0 8px 30px rgba(61,36,15,0.04); }
  .footer-link:hover { border-color: var(--accent); transform: translateY(-2px); box-shadow: 0 12px 40px rgba(61,36,15,0.08); }
  .footer-link .link-icon { font-size: 28px; flex-shrink: 0; }
  .footer-link .link-name { font-size: 15px; font-weight: 700; color: var(--text); flex: 1; }
  .footer-link .link-arrow { font-size: 18px; color: var(--accent); font-weight: 700; }
  footer { margin-top: 32px; padding-top: 22px; border-top: 1px solid var(--line); font-size: 11.5px; color: var(--muted); display: flex; justify-content: space-between; animation: fadeUp 0.5s ease 0.5s both; }
  footer a { color: var(--muted); text-decoration: none; }
  footer a:hover { color: var(--accent); }
  @keyframes fadeDown { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  @media (max-width: 600px) { .container { padding: 36px 18px 60px; } .summary-card, .news-card { padding: 20px 18px; } .pico-grid { grid-template-columns: 1fr; } footer { flex-direction: column; gap: 6px; text-align: center; } .topic-name { width: 70px; font-size: 11px; } }
</style>
</head>
<body>
<div class="container">
  <header>
    <div class="logo">🧠</div>
    <div class="header-text">
      <h1>PTSD Research Daily &middot; 創傷後壓力研究日報</h1>
      <div class="header-meta">
        <span class="badge badge-date">📅 ${dateDisplay}</span>
        <span class="badge badge-count">📊 ${totalCount} 篇文獻</span>
        <span class="badge badge-source">Powered by PubMed + Zhipu AI</span>
      </div>
    </div>
  </header>

  <div class="summary-card">
    <h2>📋 今日研究動態</h2>
    <p class="summary-text">${esc(summary)}</p>
  </div>

  ${topPicksHtml ? `<div class="section"><div class="section-title"><span class="section-icon">⭐</span>今日精選 TOP Picks</div>${topPicksHtml}</div>` : ""}

  ${allPapersHtml ? `<div class="section"><div class="section-title"><span class="section-icon">📚</span>其他值得關注的文獻</div>${allPapersHtml}</div>` : ""}

  ${topicBarsHtml ? `<div class="topic-section section"><div class="section-title"><span class="section-icon">📊</span>主題分佈</div>${topicBarsHtml}</div>` : ""}

  ${keywordsHtml ? `<div class="keywords-section section"><div class="section-title"><span class="section-icon">🏷️</span>關鍵字</div><div class="keywords">${keywordsHtml}</div></div>` : ""}

  <div class="footer-links">
    <a href="https://www.leepsyclinic.com/" class="footer-link" target="_blank">
      <span class="link-icon">🏥</span>
      <span class="link-name">李政洋身心診所首頁</span>
      <span class="link-arrow">→</span>
    </a>
    <a href="https://blog.leepsyclinic.com/" class="footer-link" target="_blank">
      <span class="link-icon">📬</span>
      <span class="link-name">訂閱電子報</span>
      <span class="link-arrow">→</span>
    </a>
    <a href="https://buymeacoffee.com/CYlee" class="footer-link" target="_blank">
      <span class="link-icon">☕</span>
      <span class="link-name">Buy me a coffee</span>
      <span class="link-arrow">→</span>
    </a>
  </div>

  <footer>
    <span>資料來源：PubMed &middot; 分析模型：${modelUsed}</span>
    <span><a href="https://github.com/u8901006/PTSD-research">GitHub</a></span>
  </footer>
</div>
</body>
</html>`;
}

function esc(s) {
  if (!s) return "";
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function main() {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) {
    console.error("[ERROR] ZHIPU_API_KEY not set");
    process.exit(1);
  }

  const targetDate = process.env.TARGET_DATE || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  const inputPath = "papers.json";
  const outputPath = `docs/ptsd-${targetDate}.html`;

  let papersData;
  try {
    papersData = loadPapers(inputPath);
  } catch {
    console.error("[ERROR] Cannot read papers.json");
    process.exit(1);
  }

  let analysis;
  if (!papersData.papers || papersData.papers.length === 0) {
    console.error("[WARN] No papers found, generating empty report");
    analysis = {
      date: targetDate,
      market_summary: "今日 PubMed 暫無新的 PTSD 相關文獻更新。請明天再查看。",
      top_picks: [],
      all_papers: [],
      keywords: [],
      topic_distribution: {},
    };
  } else {
    analysis = await analyzePapers(apiKey, papersData);
    if (!analysis) {
      console.error("[ERROR] Analysis failed");
      process.exit(1);
    }
  }

  const html = generateHtml(analysis);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, "utf-8");
  console.error(`[INFO] Report saved to ${outputPath}`);
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  process.exit(1);
});
