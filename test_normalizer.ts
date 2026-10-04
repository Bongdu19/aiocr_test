import { normalizeStudioResponse } from "./normalizer.ts";

// ============================================================================
// Sample Raw Input 1: 단일 필드 중심 문서 (Single Field-oriented Document)
// Upstage Studio Agent API 응답 형식 (job_id, model, output_text)
// ============================================================================
export const sampleRaw1 = {
  id: "job_agt_20240922_001",
  object: "response",
  status: "completed",
  model: "agt_hYy33EbPU93zggAb6W9z3G",
  output_text: JSON.stringify({
    document_id: "doc_cert_8821",
    file_name: "certificate_of_origin.pdf",
    document_type: "certificate_of_origin",
    certificate_number: {
      value: "CO-2024-KOR-9912",
      confidence: 0.992,
      location: {
        page: 1,
        boxes: [{ x: 0.68, y: 0.08, width: 0.24, height: 0.035 }],
        text: "CERTIFICATE NO: CO-2024-KOR-9912"
      }
    },
    exporter_name: {
      text: "HANSHIN PRECISION CO., LTD.",
      score: 96.5,
      evidence: {
        page_number: 1,
        bbox: { left: 0.12, top: 0.18, right: 0.45, bottom: 0.22 },
        snippet: "Exporter: HANSHIN PRECISION CO., LTD."
      }
    },
    producer_country: "Republic of Korea",
    issue_date: {
      value: "2024-09-15",
      confidence: 0.91,
      source: {
        page_index: 0, // 0-based index -> 1-based page
        polygon: [
          { x: 0.70, y: 0.85 },
          { x: 0.88, y: 0.85 },
          { x: 0.88, y: 0.89 },
          { x: 0.70, y: 0.89 }
        ],
        text: "Date of Issue: Sep 15, 2024"
      }
    },
    authorized_signature: {
      value: "Signed by Officer Park",
      confidence: 0.85,
      location: {
        page: 1,
        // Pixel coordinates without page dimensions -> should be dropped
        bbox: { left: 520, top: 1200, width: 250, height: 80 }
      }
    },
    applicable_treaties: ["KOR-US FTA", "RCEP"]
  }),
  usage: {
    input_tokens: 1540,
    output_tokens: 380,
    total_tokens: 1920
  }
};

// ============================================================================
// Sample Raw Input 2: 테이블 포함 문서 (Table-oriented Document, e.g., Invoice)
// Upstage Studio Output 배열 형식
// ============================================================================
export const sampleRaw2 = {
  id: "job_agt_20240922_002",
  object: "response",
  status: "completed",
  model: "agt_hYy33EbPU93zggAb6W9z3G",
  output: [
    {
      type: "message",
      status: "completed",
      role: "assistant",
      model: "step_2_extract",
      content: [
        {
          type: "output_text",
          text: JSON.stringify({
            document_id: "doc_inv_10023",
            file_name: "commercial_invoice_sea.pdf",
            doctype: "commercial_invoice",
            invoice_no: {
              value: "CI-2024-9981",
              confidence: 0.985,
              source: {
                page: 1,
                boxes: [{ x: 0.75, y: 0.12, width: 0.18, height: 0.028 }],
                text: "INVOICE NO: CI-2024-9981"
              }
            },
            total_amount: {
              value: 125400.00,
              confidence: 0.97,
              location: {
                page: 1,
                boxes: [{ x: 0.78, y: 0.88, width: 0.15, height: 0.03 }],
                text: "TOTAL: USD 125,400.00"
              }
            },
            currency: "USD",
            line_items: [
              {
                item_code: {
                  value: "SP-50A",
                  confidence: 0.94,
                  source: {
                    page: 1,
                    boxes: [{ x: 0.08, y: 0.45, width: 0.12, height: 0.025 }],
                    text: "SP-50A"
                  }
                },
                description: {
                  value: "SEAMLESS STEEL PIPE 50A",
                  confidence: 0.96,
                  source: {
                    page: 1,
                    boxes: [{ x: 0.22, y: 0.45, width: 0.35, height: 0.025 }],
                    text: "SEAMLESS STEEL PIPE 50A"
                  }
                },
                quantity: {
                  value: 120,
                  confidence: 0.98,
                  source: {
                    page: 1,
                    boxes: [{ x: 0.60, y: 0.45, width: 0.08, height: 0.025 }],
                    text: "120 PCS"
                  }
                },
                unit_price: 450.00,
                amount: {
                  value: 54000.00,
                  confidence: 0.97,
                  source: {
                    page: 1,
                    boxes: [{ x: 0.80, y: 0.45, width: 0.12, height: 0.025 }],
                    text: "$54,000.00"
                  }
                }
              },
              {
                item_code: "SP-80A",
                description: {
                  value: "SEAMLESS STEEL PIPE 80A",
                  confidence: 0.95,
                  source: {
                    page: 1,
                    boxes: [{ x: 0.22, y: 0.49, width: 0.35, height: 0.025 }],
                    text: "SEAMLESS STEEL PIPE 80A"
                  }
                },
                quantity: 80,
                unit_price: 892.50,
                amount: {
                  value: 71400.00,
                  confidence: 0.96,
                  source: {
                    page: 1,
                    boxes: [{ x: 0.80, y: 0.49, width: 0.12, height: 0.025 }],
                    text: "$71,400.00"
                  }
                }
              }
            ]
          })
        }
      ]
    }
  ]
};

console.log("=== Testing Sample 1 Normalization ===");
const norm1 = normalizeStudioResponse(sampleRaw1);
console.log(JSON.stringify(norm1, null, 2));

console.log("\n=== Testing Sample 2 Normalization ===");
const norm2 = normalizeStudioResponse(sampleRaw2);
console.log(JSON.stringify(norm2, null, 2));
