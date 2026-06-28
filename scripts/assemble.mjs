// 由 data/_zones/*.json（骨架來源）組裝 data/data.json（產物）。
// 「對應」層（iso27001 對映 / 風險關鍵概念 / edges）在本檔以常數維護 —— 版本控制、可重現。
// 用法：`pnpm build`（= node scripts/assemble.mjs）寫出 data/data.json。
// build() 為純函式（不寫檔），test 用它比對 committed data.json 偵測漂移。
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url)); // repo 根目錄
const ZD = ROOT + "data/_zones";

// ── meta + architectures（產物的固定外殼；非衍生自 zones，故在此維護）──
const META = {
  standard: "CNS/ISO/IEC 27001:2023 (對應 ISO/IEC 27001:2022)",
  version: "0.8.1",
  accent: "#3b82f6",
  note: "所有說明為自行撰寫之白話轉譯，未複製標準正文（版權）。條款編號與標題為事實引用。",
  linkTypes: ["feeds", "treats", "selects", "implements", "aligns", "contains"],
};
const ARCHITECTURES = [
  { id: "pdca", name: "PDCA 管理循環", summary: "ISMS 的運轉引擎：規劃→執行→查核→行動，對應條款 6/7→8→9→10。" },
  { id: "lifecycle", name: "產品/服務生命週期", summary: "先搞懂自己在保護什麼：界定範圍與資產的起點（條款 4）。" },
  { id: "risk", name: "風險管理 (ISO 31000)", summary: "27001 的心臟，採 ISO 31000 方法論，經 ISO 27005 落地到條款 6.1。" },
  { id: "controls", name: "附錄 A 控制措施", summary: "4 主題 93 控制：組織 A.5 / 人員 A.6 / 實體 A.7 / 技術 A.8。" },
];

// ── 每個非條款節點對應到 ISO 27001 哪一條（資料驅動，圖自動標）──
const ISO27001 = {
  "scope-context-criteria": "4.3 / 6.1.2",
  "risk-assessment": "6.1.2", "risk-identification": "6.1.2", "risk-analysis": "6.1.2", "risk-evaluation": "6.1.2",
  "risk-treatment-options": "6.1.3", "select-implement-controls": "6.1.3", "soa": "6.1.3(d)", "risk-treatment-plan": "6.1.3(e)", "residual-risks": "6.1.3(f)",
  "communication-consultation": "7.4", "monitoring-review": "9.1 / 9.3", "documented-information": "7.5",
  "technique-fmea": "6.1.2", "technique-bow-tie": "6.1.2", "technique-hazop": "6.1.2", "technique-brainstorming": "6.1.2", "technique-scenario-analysis": "6.1.2", "technique-checklists": "6.1.2",
  "ai-inception": "4.2 / 6.1", "ai-design-dev": "8.1", "ai-vnv": "8.1 / 9.1", "ai-deployment": "8.1", "ai-operation-monitoring": "8.1 / 9.1", "ai-continuous-validation": "9.1 / 10.1", "ai-reevaluation": "9.3 / 10", "ai-retirement": "8.1",
  "band-devops": "8.1", "band-transparency": "7.4 / 7.5", "band-security-privacy": "8 / 附錄A", "band-risk": "6.1", "band-governance": "5",
};

// ── 風險相關章節的關鍵概念（資產/當責人/風險擁有者…），面板顯示「關鍵概念」──
const CONCEPTS = {
  "clause-4.4": [
    { label: "Annex SL 共用結構（協調結構 HS）", note: "27001 的條款 4–10 是 ISO 管理系統標準的共用高階結構：9001(品質)、14001(環境)、45001(職安)、42001(AI)、27701(隱私) 同一個殼。懂這結構就能查『整合管理系統(IMS)』——一家公司多套 MS 一起跑、一起稽核。" },
    { label: "整合稽核 Combined audit", note: "因共用結構，文件管制、管理審查、內稽、矯正措施、持續改善等子系統可一次查多套標準；通用稽核方法見 ISO 19011。" },
  ],
  "clause-7.5.3": [
    { label: "文件管制要求（7.5.3）", note: "受控文件須確保：需要時可用且適用；受保護(防失密/誤用/失完整)。並闡明：派送·存取·檢索·使用、儲存與保存(含可讀性)、變更控制(版本控制)、留存(retention)與屆期處置(disposition)。" },
    { label: "外部來源文件", note: "對 ISMS 規劃與運作必要的『外部來源』文件化資訊(法規、客戶規範、供應商文件等)，須一併識別並納入管制。" },
    { label: "存取的兩種層級", note: "『存取』= 僅可檢視(view)，或檢視＋變更(view & change)；依角色決定權限。" },
  ],
  "clause-6.1.1": [
    { label: "計畫產出 → 執行 Plan → Do", note: "規劃(Plan)的產出餵進執行(Do)：風險評鑑結果、風險處理結果、管理系統目標、規劃變更。" },
  ],
  "clause-6.1.2": [
    { label: "風險擁有者 Risk owner（＝風險當責者）", note: "對某『風險』當責(accountable)且有權核准其處理的人(ISO 31000)。中文有譯『風險擁有者』或『風險當責者』——同一個。職位需夠高、能調資源；核准風險處理、接受剩餘風險。每個資安風險都要指定。" },
    { label: "資產擁有者 Asset owner（＝資產當責者）", note: "對某『資產』日常管理與保護負責的人或單位(A.5.9)，常為較基層角色(如管伺服器的 IT 管理員)。與風險擁有者是不同角色、常為不同人。" },
    { label: "風險準則 Risk criteria", note: "判斷風險可不可接受的標準：可能性×衝擊評級，加上組織的風險胃納/容忍度(Risk appetite/tolerance)。" },
  ],
  "clause-6.1.3": [
    { label: "風險擁有者核准/接受", note: "風險處理計畫與剩餘風險，須經風險擁有者核准、知情後接受(6.1.3 f)。" },
    { label: "適用性聲明 SoA", note: "列出附錄A每條控制是否適用、理由、是否實施——風險決定與控制之間的橋樑(6.1.3 d)。" },
  ],
  "risk-identification": [
    { label: "資產 Asset", note: "要保護的標的：資訊、系統、人員、流程、服務。識別風險常從盤點資產開始(A.5.9 資產清冊)。" },
    { label: "資產擁有者 Asset owner", note: "對某資產當責、有權核准其分類/存取/保護層級的人或單位(A.5.9)；個人優先(指名或職稱)。" },
    { label: "威脅 / 脆弱性 Threat / Vulnerability", note: "威脅=可能造成損害的來源；脆弱性=可被威脅利用的弱點。" },
  ],
  "risk-assessment": [
    { label: "Risk owner vs Asset owner（風險擁有者 vs 資產擁有者）", note: "Risk owner 風險擁有者（＝風險當責者）：對『風險』當責＋有權核准處理，職位較高(6.1.2/6.1.3)。Asset owner 資產擁有者：對『資產』日常管理保護，常較基層(A.5.9)。資產擁有者常無權處理風險→需要風險擁有者。兩者不同、常為不同人。" },
    { label: "風險準則 / 風險登錄冊", note: "風險準則=可接受與否的標準；風險登錄冊=記錄所有風險、等級、擁有者、處理狀態的清單。" },
  ],
  "risk-treatment-options": [
    { label: "四種處理選項", note: "降低(導入控制)／接受／移轉(保險、外包)／避免(停止該活動)。" },
    { label: "風險擁有者核准", note: "處理計畫與剩餘風險需經風險擁有者核准(6.1.3 f)。" },
  ],
  "residual-risks": [
    { label: "風險擁有者接受 Risk acceptance", note: "處理後仍殘留的風險，須由風險擁有者『知情後正式接受』並簽核(6.1.3 f)。" },
  ],
};

// ── 三張老師圖的 edges（只用真實 id）──
const E = (from, to, rel, note) => (note ? { from, to, rel, note } : { from, to, rel });
const EDGES = [
  // Image 1: ISMS PDCA mandala
  E("clause-4.1", "clause-4.2", "feeds", "全景界定後，識別利害關係人。"),
  E("clause-4.1", "clause-4.3", "feeds", "全景決定 ISMS 範圍。"),
  E("clause-4.3", "clause-4.4", "feeds", "範圍內建立 ISMS。"),
  E("clause-4.2", "clause-6.1.1", "feeds", "利害關係人要求 → 風險與改善機會 → 規劃。"),
  E("clause-6.1.1", "clause-8.1", "feeds", "計畫(Plan) → 執行(Do)。"),
  E("clause-8.1", "clause-9.1", "feeds", "執行(Do) → 查核(Check)。"),
  E("clause-9.1", "clause-10.1", "feeds", "查核(Check) → 行動(Act)。"),
  E("clause-10.1", "clause-6.1.1", "feeds", "行動(Act) → 回到規劃，循環。"),
  E("clause-5.1", "clause-6.1.1", "aligns", "領導 5.1(a)(b) 連到規劃。"),
  E("clause-5.1", "clause-7.1", "aligns", "領導 5.1(c)(d)(e) 連到支援/運作。"),
  E("clause-5.1", "clause-9.1", "aligns", "領導 5.1(e)(f) 連到績效評估。"),
  E("clause-5.1", "clause-10.1", "aligns", "領導 5.1(g) 連到改善。"),
  E("clause-4.2", "control-a.5.31", "treats", "法律/合約義務最終由 A.5.31 控制滿足。"),

  // Image 2: ISO 31000 / 27005 risk process
  E("risk-assessment", "risk-identification", "contains"),
  E("risk-assessment", "risk-analysis", "contains"),
  E("risk-assessment", "risk-evaluation", "contains"),
  E("scope-context-criteria", "risk-identification", "feeds"),
  E("risk-identification", "risk-analysis", "feeds"),
  E("risk-analysis", "risk-evaluation", "feeds"),
  E("risk-evaluation", "risk-treatment-options", "feeds", "決策點1 評鑑滿意 → 處理。"),
  E("risk-treatment-options", "select-implement-controls", "feeds"),
  E("select-implement-controls", "soa", "selects", "選出的控制記入 SoA。"),
  E("soa", "risk-treatment-plan", "feeds"),
  E("risk-treatment-plan", "residual-risks", "feeds", "決策點2 → 剩餘風險。"),
  E("communication-consultation", "scope-context-criteria", "aligns", "建立情境時即開始溝通諮詢。"),
  E("communication-consultation", "risk-assessment", "aligns", "評鑑全程持續溝通諮詢。"),
  E("communication-consultation", "risk-treatment-options", "aligns", "處理決策需與利害關係人溝通。"),
  E("monitoring-review", "risk-assessment", "aligns", "監督審查回饋到風險評鑑。"),
  E("monitoring-review", "risk-treatment-plan", "aligns", "處理計畫的成效需持續監督審查。"),
  E("residual-risks", "monitoring-review", "aligns", "剩餘風險須持續監督與審查，環境變化時重新評鑑。"),
  E("residual-risks", "communication-consultation", "aligns", "剩餘風險須溝通，由風險擁有者知情後正式接受。"),
  E("residual-risks", "documented-information", "feeds", "剩餘風險與接受決定納入記錄與報告。"),
  E("risk-assessment", "documented-information", "feeds"),
  E("risk-treatment-plan", "documented-information", "feeds"),
  E("risk-identification", "technique-brainstorming", "implements"),
  E("risk-identification", "technique-hazop", "implements"),
  E("risk-identification", "technique-checklists", "implements"),
  E("risk-analysis", "technique-fmea", "implements"),
  E("risk-analysis", "technique-bow-tie", "implements"),
  E("risk-evaluation", "technique-scenario-analysis", "implements"),

  // Cross-link: risk process ⇄ 27001
  E("clause-6.1.2", "risk-assessment", "aligns", "27001 6.1.2 即 ISO 31000 風險評鑑。"),
  E("clause-6.1.3", "risk-treatment-options", "aligns", "27001 6.1.3 即風險處理。"),
  E("clause-6.1.3", "soa", "selects", "6.1.3 產出 SoA。"),
  E("clause-4.3", "scope-context-criteria", "aligns"),
  E("clause-7.4", "communication-consultation", "aligns"),
  E("clause-9.1", "monitoring-review", "aligns"),
  E("clause-7.5", "documented-information", "aligns"),
  // 文件化資訊 7.5 的子條款（7.5 contains 7.5.1/7.5.2/7.5.3）
  E("clause-7.5", "clause-7.5.1", "contains", "7.5 文件化資訊 — 一般要求。"),
  E("clause-7.5", "clause-7.5.2", "contains", "7.5 文件化資訊 — 建立與更新。"),
  E("clause-7.5", "clause-7.5.3", "contains", "7.5 文件化資訊 — 管制（含 7.5.3 文件管制要求）。"),

  // 套圖疊圖: SoA → 控制 + 控制錨定到條款
  E("soa", "control-a.5.31", "selects"),
  E("soa", "control-a.8.6", "selects"),
  E("soa", "control-a.5.24", "selects"),
  E("control-a.8.6", "clause-8.1", "implements", "容量管理落實於運作。"),
  E("control-a.8.32", "clause-6.3", "implements", "變更管理對應變更規劃。"),
  E("control-a.5.24", "clause-8.1", "implements", "事故管理落實於運作。"),
  E("control-a.5.29", "clause-8.1", "implements", "中斷期間資安落實於運作。"),
  E("control-a.5.3", "clause-5.3", "implements", "職責分離對應角色責任。"),

  // Image 3/4: AI 系統生命週期 (5338 / 22989)
  E("ai-inception", "ai-design-dev", "feeds"),
  E("ai-design-dev", "ai-vnv", "feeds"),
  E("ai-vnv", "ai-deployment", "feeds"),
  E("ai-deployment", "ai-operation-monitoring", "feeds"),
  E("ai-operation-monitoring", "ai-continuous-validation", "feeds"),
  E("ai-operation-monitoring", "ai-reevaluation", "feeds"),
  E("ai-reevaluation", "ai-design-dev", "feeds", "重新評估 → 回開發。"),
  E("ai-reevaluation", "ai-retirement", "feeds"),
  E("band-governance", "clause-5.1", "aligns", "AI 治理 ⇄ ISMS 領導。"),
  E("band-risk", "risk-assessment", "aligns", "AI 風險管理 ⇄ 風險評鑑。"),
  E("band-security-privacy", "clause-8.1", "aligns", "AI 安全隱私 ⇄ 運作控制。"),
  E("band-transparency", "clause-7.5", "aligns", "透明可解釋 ⇄ 文件化資訊。"),
  E("band-devops", "clause-8.1", "aligns"),
  E("ai-operation-monitoring", "clause-9.1", "aligns", "AI 營運監督 ⇄ 績效評估。"),
  E("ai-reevaluation", "clause-10.1", "aligns", "AI 重新評估 ⇄ 改善。"),
];

// 讀 zones → 合併 → 注入對應層 → 回傳完整資料物件（純函式，不寫檔）
export function build() {
  const byId = new Map();
  for (const f of readdirSync(ZD).filter((f) => f.endsWith(".json")).sort()) {
    const arr = JSON.parse(readFileSync(`${ZD}/${f}`, "utf8"));
    for (const n of arr) {
      if (byId.has(n.id)) throw new Error(`DUP id: ${n.id} in ${f}`);
      byId.set(n.id, n);
    }
  }
  const nodes = [...byId.values()];
  for (const n of nodes) {
    if (ISO27001[n.id]) n.iso27001 = ISO27001[n.id];
    if (CONCEPTS[n.id]) n.concepts = [...(n.concepts || []), ...CONCEPTS[n.id]];
  }
  const ids = new Set(nodes.map((n) => n.id));
  const broken = EDGES.filter((e) => !ids.has(e.from) || !ids.has(e.to));
  if (broken.length) throw new Error("BROKEN EDGES: " + broken.map((e) => `${e.from}->${e.to}`).join(", "));
  return { meta: META, architectures: ARCHITECTURES, nodes, edges: EDGES };
}

// 直接執行時才寫檔
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = build();
  writeFileSync(`${ROOT}data/data.json`, JSON.stringify(out, null, 2) + "\n");
  const byType = {};
  for (const n of out.nodes) byType[n.type] = (byType[n.type] || 0) + 1;
  console.log("WROTE data/data.json");
  console.log("nodes:", out.nodes.length, "edges:", out.edges.length);
  console.log("byType:", JSON.stringify(byType));
}
