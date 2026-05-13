#!/usr/bin/env node

import { readdirSync, writeFileSync } from "node:fs";

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

const files = readdirSync("docs")
  .filter((f) => f.startsWith("ptsd-") && f.endsWith(".html"))
  .sort()
  .reverse();

const links = files.slice(0, 60).map((name) => {
  const dateStr = name.replace("ptsd-", "").replace(".html", "");
  const parts = dateStr.split("-");
  let dateDisplay = dateStr;
  let weekday = "";
  if (parts.length === 3) {
    const [y, m, d] = parts;
    dateDisplay = `${y}年${parseInt(m)}月${parseInt(d)}日`;
    try {
      const dt = new Date(`${y}-${m}-${d}`);
      weekday = WEEKDAYS[dt.getDay()] || "";
    } catch {}
  }
  return `<li><a href="${name}">📅 ${dateDisplay}（週${weekday}）</a></li>`;
}).join("\n");

const total = files.length;

const html = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>PTSD Research Daily &middot; 創傷後壓力研究日報</title>
<style>
  :root { --bg: #f6f1e8; --surface: #fffaf2; --line: #d8c5ab; --text: #2b2118; --muted: #766453; --accent: #8c4f2b; --accent-soft: #ead2bf; }
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: radial-gradient(circle at top, #fff6ea 0, var(--bg) 55%, #ead8c6 100%); color: var(--text); font-family: "Noto Sans TC", "PingFang TC", "Helvetica Neue", Arial, sans-serif; min-height: 100vh; }
  .container { position: relative; z-index: 1; max-width: 640px; margin: 0 auto; padding: 80px 24px; }
  .logo { font-size: 48px; text-align: center; margin-bottom: 16px; }
  h1 { text-align: center; font-size: 24px; color: var(--text); margin-bottom: 8px; }
  .subtitle { text-align: center; color: var(--accent); font-size: 14px; margin-bottom: 48px; }
  .count { text-align: center; color: var(--muted); font-size: 13px; margin-bottom: 32px; }
  ul { list-style: none; }
  li { margin-bottom: 8px; }
  a { color: var(--text); text-decoration: none; display: block; padding: 14px 20px; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; transition: all 0.2s; font-size: 15px; }
  a:hover { background: var(--accent-soft); border-color: var(--accent); transform: translateX(4px); }
  footer { margin-top: 56px; text-align: center; font-size: 12px; color: var(--muted); }
  footer a { display: inline; padding: 0; background: none; border: none; color: var(--muted); }
  footer a:hover { color: var(--accent); }
</style>
</head>
<body>
<div class="container">
  <div class="logo">🧠</div>
  <h1>PTSD Research Daily</h1>
  <p class="subtitle">創傷後壓力研究日報 &middot; 每日自動更新</p>
  <p class="count">共 ${total} 期報告</p>
  <ul>${links}</ul>
  <footer>
    <p>Powered by PubMed + Zhipu AI &middot; <a href="https://github.com/u8901006/PTSD-research">GitHub</a></p>
  </footer>
</div>
</body>
</html>`;

writeFileSync("docs/index.html", html, "utf-8");
console.error("Index page generated");
