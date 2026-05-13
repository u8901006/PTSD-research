#!/usr/bin/env node

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const PUBMED_SEARCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
const PUBMED_FETCH = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
const HEADERS = { "User-Agent": "PTSDResearchBot/1.0 (research aggregator)" };

const JOURNALS = [
  "Journal of Traumatic Stress",
  "European Journal of Psychotraumatology",
  "Psychological Trauma Theory Research Practice and Policy",
  "Traumatology",
  "Journal of Loss and Trauma",
  "Trauma Violence and Abuse",
  "Journal of Aggression Maltreatment and Trauma",
  "Journal of Child and Adolescent Trauma",
  "Military Behavioral Health",
  "Disaster Medicine and Public Health Preparedness",
  "American Journal of Psychiatry",
  "JAMA Psychiatry",
  "Lancet Psychiatry",
  "World Psychiatry",
  "Molecular Psychiatry",
  "Biological Psychiatry",
  "Biological Psychiatry Cognitive Neuroscience and Neuroimaging",
  "Translational Psychiatry",
  "Psychiatry Research",
  "Psychosomatic Medicine",
  "Journal of Clinical Psychiatry",
  "CNS Drugs",
  "Neuropsychopharmacology",
  "Nature Neuroscience",
  "Neuron",
  "Nature Mental Health",
  "Neuroscience and Biobehavioral Reviews",
  "Brain Behavior and Immunity",
  "Psychoneuroendocrinology",
  "Human Brain Mapping",
  "NeuroImage Clinical",
  "Clinical Psychology Review",
  "Clinical Psychological Science",
  "Journal of Consulting and Clinical Psychology",
  "Behaviour Research and Therapy",
  "Cognitive Therapy and Research",
  "Journal of Anxiety Disorders",
  "Depression and Anxiety",
  "Psychological Assessment",
  "Assessment",
  "Journal of EMDR Practice and Research",
  "Emotion",
  "Journal of the American Academy of Child and Adolescent Psychiatry",
  "Child Abuse and Neglect",
  "Development and Psychopathology",
  "Journal of Child Psychology and Psychiatry",
  "Child Maltreatment",
  "Family Process",
  "American Journal of Public Health",
  "Social Psychiatry and Psychiatric Epidemiology",
  "Epidemiology and Psychiatric Sciences",
  "Lancet Public Health",
  "Global Mental Health",
  "BMC Public Health",
  "Conflict and Health",
  "Social Science and Medicine",
  "Qualitative Health Research",
  "Transcultural Psychiatry",
  "Journal of Interpersonal Violence",
  "Violence Against Women",
  "Military Medicine",
  "Occupational Medicine",
  "Sleep",
  "Journal of Clinical Sleep Medicine",
  "Pain",
  "Addiction",
  "Drug and Alcohol Dependence",
  "Journal of Substance Abuse Treatment",
  "Suicide and Life Threatening Behavior",
  "Journal of Affective Disorders",
  "Implementation Science",
  "Psychiatric Services",
  "Journal of Medical Internet Research",
  "Internet Interventions",
  "BMC Psychiatry",
  "Frontiers in Psychiatry",
];

const PTSD_SEARCH_TERMS = [
  '"Stress Disorders, Post-Traumatic"[Mesh]',
  "PTSD[tiab]",
  '"posttraumatic stress disorder"[tiab]',
  '"post-traumatic stress disorder"[tiab]',
  '"posttraumatic stress symptoms"[tiab]',
  '"post-traumatic stress symptoms"[tiab]',
  '"traumatic stress"[tiab]',
  '"complex PTSD"[tiab]',
  "CPTSD[tiab]",
];

function buildQuery(days) {
  const now = new Date();
  const lookback = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const dateStr = `${lookback.getUTCFullYear()}/${String(lookback.getUTCMonth() + 1).padStart(2, "0")}/${String(lookback.getUTCDate()).padStart(2, "0")}`;
  const datePart = `"${dateStr}"[Date - Publication] : "3000"[Date - Publication]`;
  const ptsdPart = PTSD_SEARCH_TERMS.join(" OR ");
  return `(${ptsdPart}) AND ${datePart}`;
}

async function searchPapers(query, retmax = 50) {
  const url = `${PUBMED_SEARCH}?db=pubmed&term=${encodeURIComponent(query)}&retmax=${retmax}&sort=date&retmode=json`;
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    return data?.esearchresult?.idlist || [];
  } catch (e) {
    console.error(`[ERROR] PubMed search failed: ${e.message}`);
    return [];
  }
}

function extractText(el) {
  if (!el) return "";
  const parts = [];
  for (const node of el.childNodes) {
    parts.push(node.textContent || "");
  }
  return parts.join("").trim();
}

async function fetchDetails(pmids) {
  if (!pmids.length) return [];
  const ids = pmids.join(",");
  const url = `${PUBMED_FETCH}?db=pubmed&id=${ids}&retmode=xml`;
  try {
    const resp = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(60000) });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const xml = await resp.text();
    return parseXmlPapers(xml);
  } catch (e) {
    console.error(`[ERROR] PubMed fetch failed: ${e.message}`);
    return [];
  }
}

function parseXmlPapers(xml) {
  const papers = [];
  const articleRegex = /<PubmedArticle>([\s\S]*?)<\/PubmedArticle>/g;
  let match;
  while ((match = articleRegex.exec(xml)) !== null) {
    const block = match[1];
    try {
      const pmidMatch = block.match(/<PMID[^>]*>(\d+)<\/PMID>/);
      const pmid = pmidMatch ? pmidMatch[1] : "";

      const titleMatch = block.match(/<ArticleTitle>([\s\S]*?)<\/ArticleTitle>/);
      let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";

      const journalMatch = block.match(/<Title>([\s\S]*?)<\/Title>/);
      const journal = journalMatch ? journalMatch[1].trim() : "";

      const abstractParts = [];
      const absRegex = /<AbstractText[^>]*Label="([^"]*)"[^>]*>([\s\S]*?)<\/AbstractText>/g;
      let absMatch;
      while ((absMatch = absRegex.exec(block)) !== null) {
        const label = absMatch[1];
        const text = absMatch[2].replace(/<[^>]+>/g, "").trim();
        if (label && text) abstractParts.push(`${label}: ${text}`);
        else if (text) abstractParts.push(text);
      }
      if (!abstractParts.length) {
        const plainAbsMatch = block.match(/<AbstractText>([\s\S]*?)<\/AbstractText>/);
        if (plainAbsMatch) abstractParts.push(plainAbsMatch[1].replace(/<[^>]+>/g, "").trim());
      }
      const abstract = abstractParts.join(" ").slice(0, 2000);

      const yearMatch = block.match(/<Year>(\d{4})<\/Year>/);
      const monthMatch = block.match(/<Month>([^<]+)<\/Month>/);
      const dayMatch = block.match(/<Day>(\d+)<\/Day>/);
      const parts = [yearMatch?.[1], monthMatch?.[1], dayMatch?.[1]].filter(Boolean);
      const dateStr = parts.join(" ");

      const keywords = [];
      const kwRegex = /<Keyword>([\s\S]*?)<\/Keyword>/g;
      let kwMatch;
      while ((kwMatch = kwRegex.exec(block)) !== null) {
        const kw = kwMatch[1].trim();
        if (kw) keywords.push(kw);
      }

      const doiMatch = block.match(/<ArticleId id-type="doi">([^<]+)<\/ArticleId>/);
      const doi = doiMatch ? doiMatch[1] : "";

      const url = pmid ? `https://pubmed.ncbi.nlm.nih.gov/${pmid}/` : "";

      if (title) {
        papers.push({ pmid, title, journal, date: dateStr, abstract, url, keywords, doi });
      }
    } catch {}
  }
  return papers;
}

async function main() {
  const days = 7;
  const maxPapers = 60;
  const targetDate = process.env.TARGET_DATE || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });

  console.error(`[INFO] Searching PubMed for PTSD papers from last ${days} days...`);
  const query = buildQuery(days);
  const pmids = await searchPapers(query, maxPapers);
  console.error(`[INFO] Found ${pmids.length} papers`);

  if (!pmids.length) {
    console.error("[INFO] No papers found");
    const output = { date: targetDate, count: 0, papers: [] };
    writeFileSync("papers.json", JSON.stringify(output, null, 2));
    return;
  }

  const papers = await fetchDetails(pmids);
  console.error(`[INFO] Fetched details for ${papers.length} papers`);

  const output = { date: targetDate, count: papers.length, papers };
  writeFileSync("papers.json", JSON.stringify(output, null, 2));
  console.error(`[INFO] Saved to papers.json`);
}

main().catch((e) => {
  console.error(`[FATAL] ${e.message}`);
  const targetDate = process.env.TARGET_DATE || new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
  writeFileSync("papers.json", JSON.stringify({ date: targetDate, count: 0, papers: [] }));
});
