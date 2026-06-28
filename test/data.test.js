import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { build } from "../scripts/assemble.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, "../data/data.json"), "utf8"));
const schema = JSON.parse(readFileSync(join(here, "../schema/data.schema.json"), "utf8"));
const suppSchema = JSON.parse(readFileSync(join(here, "../schema/supplements.schema.json"), "utf8"));
const docSchema = JSON.parse(readFileSync(join(here, "../schema/documents.schema.json"), "utf8"));
const stdSchema = JSON.parse(readFileSync(join(here, "../schema/standards.schema.json"), "utf8"));

const supplements = JSON.parse(readFileSync(join(here, "../data/supplements.json"), "utf8"));
const documents = JSON.parse(readFileSync(join(here, "../data/documents.json"), "utf8"));
const standards = JSON.parse(readFileSync(join(here, "../data/standards.json"), "utf8"));

const nodeIds = new Set(data.nodes.map((n) => n.id));
const archIds = new Set(data.architectures.map((a) => a.id));
const linkTypes = new Set(data.meta.linkTypes);

describe("schema", () => {
  it("data.json 通過 JSON Schema 驗證", () => {
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const ok = validate(data);
    if (!ok) console.error(validate.errors);
    expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});

describe("完整性 (改A壞B 守門員)", () => {
  it("節點 id 不重複", () => {
    expect(nodeIds.size).toBe(data.nodes.length);
  });

  it("每個節點都有非空的白話說明", () => {
    const empty = data.nodes.filter((n) => !n.explanation || n.explanation.trim().length < 10);
    expect(empty.map((n) => n.id)).toEqual([]);
  });

  it("每個節點的 layers 都指向真實的架構", () => {
    const bad = [];
    for (const n of data.nodes)
      for (const l of n.layers) if (!archIds.has(l)) bad.push(`${n.id} → ${l}`);
    expect(bad).toEqual([]);
  });
});

describe("參照完整性 (沒有斷掉的連結)", () => {
  it("每條 edge 的 from/to 都指向存在的節點", () => {
    const broken = [];
    for (const e of data.edges) {
      if (!nodeIds.has(e.from)) broken.push(`from:${e.from}`);
      if (!nodeIds.has(e.to)) broken.push(`to:${e.to}`);
    }
    expect(broken).toEqual([]);
  });

  it("每條 edge 的關係類型都在 meta.linkTypes 內", () => {
    const bad = data.edges.filter((e) => !linkTypes.has(e.rel)).map((e) => `${e.from}-[${e.rel}]->${e.to}`);
    expect(bad).toEqual([]);
  });

  it("沒有孤兒節點（控制/條款/AI生命週期靠分組定位除外；風險流程與橋樑節點仍須連線）", () => {
    const referenced = new Set();
    for (const e of data.edges) {
      referenced.add(e.from);
      referenced.add(e.to);
    }
    const grouped = ["architecture", "control", "clause", "lifecycle-stage", "cross-cutting-band"];
    const orphans = data.nodes
      .filter((n) => !grouped.includes(n.type))
      .filter((n) => !referenced.has(n.id))
      .map((n) => n.id);
    expect(orphans).toEqual([]);
  });
});

describe("內容對帳 (覆蓋率 — 隨內容補完逐步收緊)", () => {
  const controls = data.nodes.filter((n) => n.type === "control");

  it("附錄 A 控制數量正好 93", () => {
    expect(controls.length).toBe(93);
  });

  it("附錄 A 四主題數量正確 (A.5=37 / A.6=8 / A.7=14 / A.8=34)", () => {
    const count = (p) => controls.filter((c) => (c.ref || "").startsWith(p)).length;
    expect({ a5: count("A.5"), a6: count("A.6"), a7: count("A.7"), a8: count("A.8") })
      .toEqual({ a5: 37, a6: 8, a7: 14, a8: 34 });
  });

  it("每個控制節點都有 CIA 標註", () => {
    const missing = controls.filter((c) => !c.attributes?.cia?.length).map((c) => c.id);
    expect(missing).toEqual([]);
  });

  it("三大架構內容到齊 (條款/風險流程/AI生命週期)", () => {
    const t = (type) => data.nodes.filter((n) => n.type === type).length;
    expect(t("clause")).toBeGreaterThanOrEqual(25);     // 條款 4-10
    expect(t("risk-step")).toBeGreaterThanOrEqual(10);  // ISO 31000/27005 流程
    expect(t("lifecycle-stage") + t("cross-cutting-band")).toBeGreaterThanOrEqual(13); // AI 5338 階段 + 22989 橫向帶
  });

  it("每個條款/控制都有稽核三件組 (LA 視角：問句/證據/不符合)", () => {
    const auditable = data.nodes.filter((n) => n.type === "control" || n.type === "clause");
    const bad = auditable
      .filter((n) => !(n.audit?.questions?.length && n.audit?.evidence?.length && n.audit?.nonconformities?.length))
      .map((n) => n.id);
    expect(bad).toEqual([]);
  });

  it("每個控制都有 NIST 800-53 對映 (OSCAL 互通)", () => {
    const FAM = /^(AC|AU|AT|CM|CP|IA|IR|MA|MP|PE|PL|PM|PS|PT|RA|SA|SC|SI|SR)(-\d+)?$/;
    const bad = controls
      .filter((c) => !(c.mapping?.nist_800_53?.length && c.mapping.nist_800_53.every((x) => FAM.test(x))))
      .map((c) => c.id);
    expect(bad).toEqual([]);
  });
});

describe("補充活檔 (supplements — 老師補充，防打錯)", () => {
  const items = supplements.items || [];
  it("supplements.json 通過 JSON Schema 驗證", () => {
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(suppSchema);
    const ok = validate(supplements);
    if (!ok) console.error(validate.errors);
    expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
  it("每筆補充的 nodeId 都對應到存在的節點", () => {
    const bad = items.filter((s) => !nodeIds.has(s.nodeId)).map((s) => s.nodeId);
    expect(bad).toEqual([]);
  });
  it("每筆補充都有 title 與 note", () => {
    const bad = items.filter((s) => !(s.title && s.note)).map((s) => s.nodeId || "?");
    expect(bad).toEqual([]);
  });
});

describe("ISO 27001 對應 + 關鍵概念 (對抗式一致性)", () => {
  const find = (id) => data.nodes.find((n) => n.id === id);
  it("風險流程/AI生命週期/橫向帶/技術 節點都標了 iso27001 對應", () => {
    const need = ["risk-step", "bridge", "risk-technique", "lifecycle-stage", "cross-cutting-band"];
    const bad = data.nodes.filter((n) => need.includes(n.type) && !n.iso27001).map((n) => n.id);
    expect(bad).toEqual([]);
  });
  it("風險相關章節都有關鍵概念說明 (資產/資產擁有者/風險擁有者…)", () => {
    const must = ["clause-6.1.2", "clause-6.1.3", "risk-identification", "risk-assessment", "risk-treatment-options", "residual-risks"];
    const bad = must.filter((id) => !(find(id)?.concepts?.length));
    expect(bad).toEqual([]);
  });
  it("剩餘風險接到 監督審查/溝通諮詢/文件化 (圖二關鍵連線必存在)", () => {
    const out = new Set(data.edges.filter((e) => e.from === "residual-risks").map((e) => e.to));
    expect(["monitoring-review", "communication-consultation", "documented-information"].filter((t) => !out.has(t))).toEqual([]);
  });
});

describe("建置可重現性 (zones → data.json，防手改衍生檔漂移)", () => {
  it("data/data.json 與 assemble(_zones) 完全一致 (改 zone 沒重建 / 直接手改 data.json 都會被擋)", () => {
    expect(build()).toEqual(data);
  });

  it("每個 zone 節點都通過 data.schema 的 node 子結構驗證", () => {
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    const validateNode = ajv.compile(schema.properties.nodes.items);
    const zoneDir = join(here, "../data/_zones");
    const bad = [];
    for (const f of readdirSync(zoneDir).filter((f) => f.endsWith(".json"))) {
      const arr = JSON.parse(readFileSync(join(zoneDir, f), "utf8"));
      for (const n of arr) if (!validateNode(n)) bad.push(`${f}:${n.id} ${JSON.stringify(validateNode.errors)}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("版本一致性 (防 sw 快取不失效 / 部署漏更新)", () => {
  const v = data.meta.version;
  it("package.json version === data.meta.version", () => {
    const pkg = JSON.parse(readFileSync(join(here, "../package.json"), "utf8"));
    expect(pkg.version).toBe(v);
  });
  it("sw.js CACHE 版本 === data.meta.version", () => {
    const sw = readFileSync(join(here, "../sw.js"), "utf8");
    const swV = (sw.match(/ismsla-v([\d.]+)/) || [])[1];
    expect(swV).toBe(v);
  });
});

describe("文件化資訊 + ISO 27000 家族 (參考資料)", () => {
  const ajvV = (sch, doc) => {
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    const v = ajv.compile(sch);
    const ok = v(doc);
    if (!ok) console.error(v.errors);
    return { ok, errors: v.errors };
  };
  it("documents.json 通過 JSON Schema 驗證", () => {
    const { ok, errors } = ajvV(docSchema, documents);
    expect(ok, JSON.stringify(errors, null, 2)).toBe(true);
  });
  it("standards.json 通過 JSON Schema 驗證", () => {
    const { ok, errors } = ajvV(stdSchema, standards);
    expect(ok, JSON.stringify(errors, null, 2)).toBe(true);
  });
  it("文件 id 不重複、nodeId 為 null 或指向存在節點", () => {
    const ids = documents.items.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    const bad = documents.items.filter((d) => d.nodeId !== null && !nodeIds.has(d.nodeId)).map((d) => d.id);
    expect(bad).toEqual([]);
  });
  it("標準 id 不重複、view 為 null 或存在的視圖", () => {
    const ids = standards.items.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const views = new Set(["pdca", "risk", "ai", "controls"]);
    const bad = standards.items.filter((s) => s.view !== null && !views.has(s.view)).map((s) => s.id);
    expect(bad).toEqual([]);
  });
  it("涵蓋 27001:2022 強制文件化資訊核心 (4.3/5.2/6.1.2/6.1.3/6.2/8.2/8.3/9.1/9.2/9.3/10.2)", () => {
    const mand = documents.items.filter((d) => d.mandatory).map((d) => d.clause);
    const has = (p) => mand.some((c) => c.startsWith(p));
    const missing = ["4.3", "5.2", "6.1.2", "6.1.3", "6.2", "8.2", "8.3", "9.1", "9.2", "9.3", "10.2"].filter((p) => !has(p));
    expect(missing).toEqual([]);
  });
  it("標準家族含核心 (27002/27005/27701/31000) 且 IEC 31010 標註正確", () => {
    const nums = standards.items.map((s) => s.number).join(" ");
    for (const k of ["27002", "27005", "27701", "31000"]) expect(nums).toContain(k);
    expect(standards.items.find((s) => s.id === "iso-31010")?.number).toContain("IEC 31010");
  });
  it("標準 parent 血緣指向存在標準、nodes 量尺指向存在節點", () => {
    const sids = new Set(standards.items.map((s) => s.id));
    const badP = standards.items.flatMap((s) => (s.parent || []).filter((p) => !sids.has(p)).map((p) => `${s.id}->${p}`));
    const badN = standards.items.flatMap((s) => (s.nodes || []).filter((n) => !nodeIds.has(n)).map((n) => `${s.id}->${n}`));
    expect({ badP, badN }).toEqual({ badP: [], badN: [] });
  });
  it("可驗證(發證)標準限管理系統標準 (27001/42001/27701/9001/14001/45001)", () => {
    const cert = standards.items.filter((s) => s.certifiable).map((s) => s.id).sort();
    expect(cert).toEqual(["iso-14001", "iso-27001", "iso-27701", "iso-42001", "iso-45001", "iso-9001"]);
  });
  it("lifecycle 母標準 + AI 治理 + V&V 都已納入 (5338 血緣接回 15288/12207)", () => {
    const ids = new Set(standards.items.map((s) => s.id));
    expect(["iso-12207", "iso-15288", "iso-42001", "iso-23894", "iso-42005", "ieee-1012"].filter((x) => !ids.has(x))).toEqual([]);
    expect(standards.items.find((s) => s.id === "iso-5338").parent.sort()).toEqual(["iso-12207", "iso-15288"]);
  });
});

const exam = JSON.parse(readFileSync(join(here, "../data/exam.json"), "utf8"));
const examSchema = JSON.parse(readFileSync(join(here, "../schema/exam.schema.json"), "utf8"));

describe("考題 (exam — 練習題庫)", () => {
  it("exam.json 通過 JSON Schema 驗證", () => {
    const ajv = new Ajv({ allErrors: true });
    addFormats(ajv);
    const v = ajv.compile(examSchema);
    const ok = v(exam);
    if (!ok) console.error(v.errors);
    expect(ok, JSON.stringify(v.errors, null, 2)).toBe(true);
  });
  it("題目 id 不重複", () => {
    const ids = exam.items.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("正解都落在選項鍵內，且單選恰一個答案", () => {
    const bad = [];
    for (const q of exam.items) {
      const keys = new Set(q.options.map((o) => o.k));
      for (const a of q.answer) if (!keys.has(a)) bad.push(`${q.id}:正解${a}不在選項`);
      if ((q.type === "single" || q.type === "tf") && q.answer.length !== 1) bad.push(`${q.id}:${q.type}卻有${q.answer.length}個答案`);
    }
    expect(bad, bad.join(", ")).toEqual([]);
  });
  it("refs 都指向存在的節點 (能跳回框架)", () => {
    const bad = [];
    for (const q of exam.items) for (const r of q.refs || []) if (!nodeIds.has(r)) bad.push(`${q.id}→${r}`);
    expect(bad, bad.join(", ")).toEqual([]);
  });
});

describe("PWA / CDN 一致性守門", () => {
  const indexHtml = readFileSync(join(here, "../index.html"), "utf8");
  const swJs = readFileSync(join(here, "../sw.js"), "utf8");
  const unpkg = (s) => [...s.matchAll(/https:\/\/unpkg\.com\/[^"'\s)]+/g)].map((m) => m[0]);
  it("index.html 與 sw.js CORE 的 CDN(unpkg) 版本完全一致 (防只改一處)", () => {
    const inHtml = [...new Set(unpkg(indexHtml))].sort();
    const inSw = [...new Set(unpkg(swJs))].sort();
    expect(inHtml.length).toBeGreaterThan(0);
    expect(inHtml).toEqual(inSw);
  });
  it("sw.js CORE 列的本地資產都實際存在於 repo", () => {
    const core = (swJs.match(/const CORE = \[([\s\S]*?)\]/) || [])[1] || "";
    const paths = [...core.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((p) => !p.startsWith("http") && p !== "./");
    const missing = paths.filter((p) => !existsSync(join(here, "..", p)));
    expect(missing).toEqual([]);
  });
});
