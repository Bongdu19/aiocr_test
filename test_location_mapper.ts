import * as fs from "node:fs";
import * as path from "node:path";
import {
  normalizeText,
  getExtractStep,
  getInstructStep,
  findExtractDocument,
  getScalarFieldLocation,
  getTableFieldLocation,
  resolveFieldLocation,
  buildCheckItemHighlights,
} from "./location_mapper.ts";

console.log("=================================================");
console.log("🧪 Testing Location Mapper (Upstage Agent API v2)");
console.log("=================================================");

// 1. normalizeText Test
console.log("\n[1] Testing normalizeText...");
const t1 = normalizeText("  Static   Converter  /Battery Charger  ");
console.log("  Result 1:", JSON.stringify(t1));
if (t1 !== "static converter /battery charger") {
  throw new Error("normalizeText failed for standard spacing!");
}

const t2 = normalizeText("M0201410ES04828");
console.log("  Result 2:", JSON.stringify(t2));
if (t2 !== "m0201410es04828") {
  throw new Error("normalizeText failed for alphanumeric string!");
}
console.log("  ✅ normalizeText PASSED!");

// Load sample2.json
const sample2Path = path.resolve("./sample2.json");
const sample2Raw = JSON.parse(fs.readFileSync(sample2Path, "utf-8"));

// 2. getExtractStep Test
console.log("\n[2] Testing getExtractStep...");
const extractStep = getExtractStep(sample2Raw);
if (!extractStep || !extractStep.result || !Array.isArray(extractStep.result.documents)) {
  throw new Error("getExtractStep failed to return documents array!");
}
console.log(`  Found ${extractStep.result.documents.length} extract documents:`);
for (const doc of extractStep.result.documents) {
  console.log(`    - ${doc.document_type} (add_vals keys: ${Object.keys(doc.additional_values || {}).length})`);
}
console.log("  ✅ getExtractStep PASSED!");

// 3. getInstructStep Test
console.log("\n[3] Testing getInstructStep...");
const instructStep = getInstructStep(sample2Raw);
if (!instructStep) {
  throw new Error("getInstructStep returned null!");
}
const evidence =
  instructStep.result?.structured_result?.check_item_evidence ||
  instructStep.structured_result?.check_item_evidence;
if (!Array.isArray(evidence) || evidence.length === 0) {
  throw new Error("getInstructStep failed to locate check_item_evidence!");
}
console.log(`  Found ${evidence.length} check_item_evidence items.`);
console.log("  ✅ getInstructStep PASSED!");

// 4. findExtractDocument Test
console.log("\n[4] Testing findExtractDocument...");
const docs = extractStep.result.documents;
const invDoc = findExtractDocument(docs, "commercial_invoice");
const blDoc = findExtractDocument(docs, "bill_of_lading");
const plDoc = findExtractDocument(docs, "packing_list");
const insDoc = findExtractDocument(docs, "marine_cargo_insurance");
const missingDoc = findExtractDocument(docs, "certificate_of_origin");

if (!invDoc) throw new Error("findExtractDocument failed for commercial_invoice");
if (!blDoc) throw new Error("findExtractDocument failed for bill_of_lading");
if (!plDoc) throw new Error("findExtractDocument failed for packing_list");
if (!insDoc) throw new Error("findExtractDocument failed for marine_cargo_insurance");
if (missingDoc !== null) throw new Error("findExtractDocument should return null for missing certificate_of_origin");
console.log("  Successfully matched all 4 present document types and returned null for missing document!");
console.log("  ✅ findExtractDocument PASSED!");

// 5. getScalarFieldLocation Test
console.log("\n[5] Testing getScalarFieldLocation...");
const invLc = getScalarFieldLocation(invDoc, "lc_number", "M0201410ES04828");
console.log("  Invoice LC Highlight:", JSON.stringify(invLc, null, 2));
if (!invLc.found || invLc.locations.length === 0 || invLc.locations[0].page !== 2) {
  throw new Error("getScalarFieldLocation failed for invoice lc_number!");
}

const blNo = getScalarFieldLocation(blDoc, "bl_number", "RKOE076");
console.log("  B/L Number Highlight:", JSON.stringify(blNo, null, 2));
if (!blNo.found || blNo.locations.length === 0 || blNo.locations[0].page !== 8) {
  throw new Error("getScalarFieldLocation failed for bl_number!");
}
console.log("  ✅ getScalarFieldLocation PASSED!");

// 6. getTableFieldLocation Test
console.log("\n[6] Testing getTableFieldLocation...");
// Invoice line_items.product_name
const invProduct = getTableFieldLocation(
  invDoc,
  "line_items.product_name",
  "Static Converter /Battery Charger"
);
console.log("  Invoice Product Highlight:", JSON.stringify(invProduct, null, 2));
if (!invProduct.found || invProduct.locations.length === 0 || invProduct.locations[0].page !== 3) {
  throw new Error("getTableFieldLocation failed for invoice line_items.product_name!");
}

// B/L cargo_details.cargo_description
const blCargo = getTableFieldLocation(blDoc, "cargo_details.cargo_description");
console.log("  B/L Cargo Description Highlight:", JSON.stringify(blCargo, null, 2));
if (!blCargo.found || blCargo.locations.length === 0) {
  throw new Error("getTableFieldLocation failed for cargo_details.cargo_description!");
}
console.log("  ✅ getTableFieldLocation PASSED!");

// 7. resolveFieldLocation Test
console.log("\n[7] Testing resolveFieldLocation...");
const res1 = resolveFieldLocation(invDoc, "commercial_invoice", "invoice_number", "A4631-L032-61");
if (!res1.found || res1.locations[0].page !== 2) {
  throw new Error("resolveFieldLocation failed for scalar invoice_number!");
}

const res2 = resolveFieldLocation(null, "certificate_of_origin", "certificate_number", "");
if (res2.found !== false) {
  throw new Error("resolveFieldLocation should return found:false for null document!");
}
console.log("  ✅ resolveFieldLocation PASSED!");

// 8. buildCheckItemHighlights Test
console.log("\n[8] Testing buildCheckItemHighlights (Full Job Result)...");
const allHighlights = buildCheckItemHighlights(sample2Raw);
console.log(`  Built highlights for ${allHighlights.length} check items.`);

let successCount = 0;
let fallbackCount = 0;

for (const chk of allHighlights) {
  console.log(`\n  📌 Check Item: ${chk.check_item} (${chk.check_item_ko})`);
  for (const [docType, hl] of Object.entries(chk.highlights)) {
    if (hl.found) {
      successCount++;
      const loc = hl.locations[0];
      console.log(`     🟢 [${docType}] ${hl.fieldName} -> Page ${loc.page}, BBox [${loc.bbox.join(", ")}], val="${hl.value}"`);
    } else {
      fallbackCount++;
      console.log(`     ⚪ [${docType}] ${hl.fieldName} -> Not found (${hl.reason})`);
    }
  }
}

console.log(`\nTotal resolved field highlights: ${successCount} found, ${fallbackCount} fallbacks.`);
if (successCount === 0) {
  throw new Error("buildCheckItemHighlights failed to find any locations!");
}
console.log("  ✅ buildCheckItemHighlights PASSED!");

console.log("\n=================================================");
console.log("🎉 ALL TESTS PASSED SUCCESSFULLY! 🚀");
console.log("=================================================");
