import { describe, it, expect } from "vitest";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(here, "../data/data.json"), "utf8"));
const schema = JSON.parse(readFileSync(join(here, "../schema/data.schema.json"), "utf8"));

const supplements = JSON.parse(readFileSync(join(here, "../data/supplements.json"), "utf8"));

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
  it("每筆補充的 nodeId 都對應到存在的節點", () => {
    const bad = items.filter((s) => !nodeIds.has(s.nodeId)).map((s) => s.nodeId);
    expect(bad).toEqual([]);
  });
  it("每筆補充都有 title 與 note", () => {
    const bad = items.filter((s) => !(s.title && s.note)).map((s) => s.nodeId || "?");
    expect(bad).toEqual([]);
  });
});
