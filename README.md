# PTSD Research Daily Report

自動化 PTSD（創傷後壓力症候群）研究文獻日報系統。

## 架構

- **文獻來源：** PubMed E-utilities API
- **AI 分析：** 智譜 GLM-5-Turbo（備援：GLM-4.7 → GLM-4.7-Flash）
- **部署：** GitHub Pages
- **排程：** 每日 GMT+8 07:50 自動執行

## 關鍵字範圍

涵蓋 PTSD、Complex PTSD、創傷暴露、治療（PE、CPT、EMDR、TF-CBT）、藥物治療、神經生物學、生物標記、基因學、流行病學、兒童創傷、退伍軍人、難民等研究領域。

## 設定

需在 GitHub repo 設定 Secret：

- `ZHIPU_API_KEY`：智譜 AI API 金鑰
