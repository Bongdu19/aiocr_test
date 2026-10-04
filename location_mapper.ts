/**
 * Upstage Studio Agent API - Location Mapping & Check Item Highlights
 *
 * include: ["all"] 결과에서 extract step의 additional_values(좌표 및 위치정보)와
 * instruct step의 check_item_evidence를 1:1 매핑하여
 * 프론트엔드 뷰어를 위한 정규화된 하이라이트(locations: [{ page, bbox }]) 정보를 생성합니다.
 */

// ============================================================================
// 1. 타입 정의 (Type Definitions)
// ============================================================================

/** 4점 바운딩 박스 [x1, y1, x2, y2] (0~1 정규화) */
export type BBox = [number, number, number, number];

/** 단일 페이지 및 바운딩 박스 위치 정보 */
export interface LocationInfo {
  page: number;
  bbox: BBox;
}

/** 성공 하이라이트 결과 규격 */
export interface HighlightSuccess {
  found: true;
  docType: string;
  fieldName: string;
  value: unknown;
  rowIndex?: number;
  confidence?: number;
  locations: LocationInfo[];
}

/** 실패 / Fallback 하이라이트 결과 규격 */
export interface HighlightFailure {
  found: false;
  docType: string;
  fieldName: string;
  value?: unknown;
  reason: string;
}

/** 정규화된 하이라이트 유니온 타입 */
export type HighlightResult = HighlightSuccess | HighlightFailure;

/** 추출 문서 규격 */
export interface ExtractDocument {
  document_type: string;
  data?: Record<string, unknown>;
  additional_values?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Extract Step 규격 */
export interface ExtractStep {
  step_name?: string;
  step_type?: string;
  model?: string;
  result: {
    documents: ExtractDocument[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** Check Item Evidence 세부 문서 항목 */
export interface CheckItemEvidenceDoc {
  field_name?: string;
  value?: unknown;
  [key: string]: unknown;
}

/** Check Item Evidence 항목 */
export interface CheckItemEvidenceItem {
  check_item: string;
  check_item_ko?: string;
  category?: string;
  documents?: Record<string, CheckItemEvidenceDoc>;
  [key: string]: unknown;
}

/** Instruct Step 규격 */
export interface InstructStep {
  step_name?: string;
  step_type?: string;
  model?: string;
  result?: {
    structured_result?: {
      check_item_evidence?: CheckItemEvidenceItem[];
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  structured_result?: {
    check_item_evidence?: CheckItemEvidenceItem[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** 단일 점 2D 좌표 */
export interface Point2D {
  x: number;
  y: number;
}

/** 체크 아이템별 하이라이트 맵 결과 */
export interface CheckItemHighlightResult {
  check_item: string;
  check_item_ko?: string;
  highlights: Record<string, HighlightResult>;
}

// ============================================================================
// 2. 헬퍼 함수 (Internal Helpers)
// ============================================================================

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function safeJsonParse(val: unknown): unknown {
  if (typeof val !== "string") return val;
  const trimmed = val.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  return null;
}

/** 다각형 점 배열 [{x, y}, ...]을 [minX, minY, maxX, maxY] BBox로 변환 (0~1 clamp) */
function polygonToBBox(points: Point2D[]): BBox | null {
  if (!Array.isArray(points) || points.length === 0) return null;
  const xs: number[] = [];
  const ys: number[] = [];

  for (const p of points) {
    if (isRecord(p)) {
      const px = typeof p.x === "number" ? p.x : null;
      const py = typeof p.y === "number" ? p.y : null;
      if (px !== null && py !== null) {
        xs.push(px);
        ys.push(py);
      }
    }
  }

  if (xs.length === 0 || ys.length === 0) return null;

  const minX = Math.max(0, Math.min(1, Math.min(...xs)));
  const minY = Math.max(0, Math.min(1, Math.min(...ys)));
  const maxX = Math.max(0, Math.min(1, Math.max(...xs)));
  const maxY = Math.max(0, Math.min(1, Math.max(...ys)));

  return [
    Math.round(minX * 1000000) / 1000000,
    Math.round(minY * 1000000) / 1000000,
    Math.round(maxX * 1000000) / 1000000,
    Math.round(maxY * 1000000) / 1000000,
  ];
}

/** additional_values 필드 객체에서 locations([{page, bbox}]) 추출 */
function extractLocationsFromField(rawField: unknown): LocationInfo[] {
  if (!rawField || !isRecord(rawField)) return [];

  // 1) 이미 locations 배열이 존재하는 경우
  if (Array.isArray(rawField.locations)) {
    const locs: LocationInfo[] = [];
    for (const item of rawField.locations) {
      if (isRecord(item)) {
        const page = typeof item.page === "number" ? item.page : 1;
        if (Array.isArray(item.bbox) && item.bbox.length >= 4) {
          locs.push({
            page,
            bbox: [
              Number(item.bbox[0]),
              Number(item.bbox[1]),
              Number(item.bbox[2]),
              Number(item.bbox[3]),
            ],
          });
        }
      }
    }
    if (locs.length > 0) return locs;
  }

  const page = typeof rawField.page === "number" && rawField.page > 0 ? rawField.page : 1;

  // 2) word_coordinates 다중 단어 폴리곤 배열인 경우 (최우선: 실제 텍스트 토큰 단위 정밀 BBox - Upstage Studio UI 기준)
  if (Array.isArray(rawField.word_coordinates) && rawField.word_coordinates.length > 0) {
    const allPoints: Point2D[] = [];
    for (const poly of rawField.word_coordinates) {
      if (Array.isArray(poly)) {
        for (const pt of poly) {
          if (isRecord(pt) && typeof pt.x === "number" && typeof pt.y === "number") {
            allPoints.push({ x: pt.x, y: pt.y });
          }
        }
      }
    }
    if (allPoints.length > 0) {
      const bbox = polygonToBBox(allPoints);
      if (bbox) return [{ page, bbox }];
    }
  }

  // 3) bbox 배열 [x1, y1, x2, y2]인 경우
  if (Array.isArray(rawField.bbox) && rawField.bbox.length >= 4) {
    return [
      {
        page,
        bbox: [
          Number(rawField.bbox[0]),
          Number(rawField.bbox[1]),
          Number(rawField.bbox[2]),
          Number(rawField.bbox[3]),
        ],
      },
    ];
  }

  // 4) coordinates (4점 polygon) 배열인 경우 (폴백: 블록/표 컨테이너 영역)
  if (Array.isArray(rawField.coordinates) && rawField.coordinates.length > 0) {
    const bbox = polygonToBBox(rawField.coordinates as Point2D[]);
    if (bbox) {
      return [{ page, bbox }];
    }
  }

  return [];
}

/** confidence 추출 및 0~1 정규화 */
function extractConfidence(rawField: unknown): number | undefined {
  if (!rawField || !isRecord(rawField)) return undefined;

  if (typeof rawField.confidence_score === "number") {
    return Math.round(rawField.confidence_score * 10000) / 10000;
  }
  if (typeof rawField.confidence === "number") {
    const num = rawField.confidence;
    return num > 1 && num <= 100
      ? Math.round((num / 100) * 10000) / 10000
      : Math.round(num * 10000) / 10000;
  }
  if (typeof rawField.confidence === "string") {
    const s = rawField.confidence.toLowerCase().trim();
    if (s === "high") return 1.0;
    if (s === "medium" || s === "med") return 0.8;
    if (s === "low") return 0.5;
  }
  return undefined;
}

// ============================================================================
// 3. 요구 함수 구현 (Mandatory Implementations)
// ============================================================================

/**
 * 1) normalizeText
 * - 문자열 공백, 특수문자 공백을 NFKC 정규화 후 소문자 및 단일 공백으로 치환
 * - evidence.value 와 table row.value 간 정확한 비교에 사용
 */
export function normalizeText(text: unknown): string {
  if (text === null || text === undefined) return "";
  const str = String(text);
  return str
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * 2) getExtractStep
 * - jobResult에서 extract step 탐색
 * - result.documents[] 형태, parsed content 형태, 또는 복수 extract step 형태 모두 지원
 */
export function getExtractStep(jobResult: unknown): ExtractStep | null {
  if (!jobResult || !isRecord(jobResult)) return null;

  // Case 1: jobResult 루트에 직접 documents 배열이 있는 경우
  if (Array.isArray(jobResult.documents)) {
    return {
      step_name: "extract",
      step_type: "extract",
      result: { documents: jobResult.documents as ExtractDocument[] },
    };
  }

  // Case 2: jobResult.result.documents 배열이 있는 경우
  if (isRecord(jobResult.result) && Array.isArray(jobResult.result.documents)) {
    return {
      step_name: "extract",
      step_type: "extract",
      result: { documents: jobResult.result.documents as ExtractDocument[] },
    };
  }

  // Case 3: jobResult.output 또는 jobResult.steps 순회
  const stepsList = Array.isArray(jobResult.output)
    ? jobResult.output
    : Array.isArray(jobResult.steps)
    ? jobResult.steps
    : [];

  const individualExtractDocs: ExtractDocument[] = [];

  for (const step of stepsList) {
    if (!isRecord(step)) continue;

    const modelName = String(step.model || step.step_name || step.step_type || "").toLowerCase();

    // (a) 단일 step 내에 result.documents 가 존재하는 경우
    if (isRecord(step.result) && Array.isArray(step.result.documents)) {
      return {
        step_name: String(step.step_name || step.model || "extract"),
        step_type: "extract",
        result: { documents: step.result.documents as ExtractDocument[] },
      };
    }

    // (b) step content 파싱 시 documents 배열이 있는 경우
    if (Array.isArray(step.content)) {
      for (const item of step.content) {
        if (!isRecord(item)) continue;
        if (item.type === "output_text" && typeof item.text === "string") {
          const parsed = safeJsonParse(item.text);
          if (isRecord(parsed) && Array.isArray(parsed.documents)) {
            return {
              step_name: String(step.step_name || step.model || "extract"),
              step_type: "extract",
              result: { documents: parsed.documents as ExtractDocument[] },
            };
          }
        }
      }
    }

    // (c) 개별 스키마 추출 단계인 경우 (예: Information Extract - commercial_invoice_schema)
    if (
      modelName.includes("information extract") ||
      modelName.includes("step_extract") ||
      modelName.includes("step_2_extract") ||
      step.step_type === "extract"
    ) {
      if (Array.isArray(step.content)) {
        for (const item of step.content) {
          if (!isRecord(item)) continue;
          let parsedData: Record<string, unknown> = {};
          if (typeof item.text === "string") {
            const parsed = safeJsonParse(item.text);
            if (isRecord(parsed)) parsedData = parsed;
          }

          let addVals: Record<string, unknown> = {};
          if (isRecord(item.additional_values)) {
            addVals = item.additional_values;
          } else if (typeof item.additional_values === "string") {
            const parsedAv = safeJsonParse(item.additional_values);
            if (isRecord(parsedAv)) addVals = parsedAv;
          }

          const schemaType = modelName
            .replace(/^information extract\s*-\s*/i, "")
            .replace(/_schema$/i, "")
            .trim();

          const docType = String(
            parsedData.document_type ||
              addVals.document_type ||
              schemaType
          ).trim();

          if (docType || schemaType) {
            individualExtractDocs.push({
              document_type: docType || schemaType,
              schema_name: schemaType,
              data: parsedData,
              additional_values: addVals,
            });
          }
        }
      }
    }
  }

  if (individualExtractDocs.length > 0) {
    return {
      step_name: "extract",
      step_type: "extract",
      result: { documents: individualExtractDocs },
    };
  }

  return null;
}

/**
 * 3) getInstructStep
 * - jobResult에서 structured_result.check_item_evidence를 포함하는 instruct step 추출
 */
export function getInstructStep(jobResult: unknown): InstructStep | null {
  if (!jobResult || !isRecord(jobResult)) return null;

  // Case 1: jobResult 루트에 직접 structured_result 또는 check_item_evidence가 있는 경우
  if (isRecord(jobResult.structured_result) && Array.isArray(jobResult.structured_result.check_item_evidence)) {
    return {
      step_name: "instruct",
      step_type: "instruct",
      result: { structured_result: jobResult.structured_result as any },
    };
  }

  if (Array.isArray(jobResult.check_item_evidence)) {
    return {
      step_name: "instruct",
      step_type: "instruct",
      result: { structured_result: { check_item_evidence: jobResult.check_item_evidence as any } },
    };
  }

  const stepsList = Array.isArray(jobResult.output)
    ? jobResult.output
    : Array.isArray(jobResult.steps)
    ? jobResult.steps
    : [];

  // 역순 탐색 (Instruct 단계는 주로 후반부에 위치)
  for (let i = stepsList.length - 1; i >= 0; i--) {
    const step = stepsList[i];
    if (!isRecord(step)) continue;

    // (a) step.result 에 structured_result가 있는 경우
    if (isRecord(step.result)) {
      if (
        isRecord(step.result.structured_result) &&
        Array.isArray(step.result.structured_result.check_item_evidence)
      ) {
        return step as InstructStep;
      }
      if (Array.isArray(step.result.check_item_evidence)) {
        return {
          ...step,
          result: {
            structured_result: {
              check_item_evidence: step.result.check_item_evidence as any,
            },
          },
        };
      }
    }

    // (b) step.content[].text 에 JSON으로 인코딩된 structured_result 가 있는 경우
    if (Array.isArray(step.content)) {
      for (const item of step.content) {
        if (!isRecord(item)) continue;
        if (item.type === "output_text" && typeof item.text === "string") {
          const parsed = safeJsonParse(item.text);
          if (isRecord(parsed)) {
            if (
              isRecord(parsed.structured_result) &&
              Array.isArray(parsed.structured_result.check_item_evidence)
            ) {
              return {
                ...step,
                result: {
                  structured_result: parsed.structured_result as any,
                },
              };
            }
            if (Array.isArray(parsed.check_item_evidence)) {
              return {
                ...step,
                result: {
                  structured_result: {
                    check_item_evidence: parsed.check_item_evidence as any,
                  },
                },
              };
            }
          }
        }
      }
    }
  }

  return null;
}

/**
 * 4) findExtractDocument
 * - Rule 1: instruct docType과 extract document_type 매칭
 * - 스키마 접미사 제거 및 다양한 별칭(LC, B/L 등)을 완벽하게 매칭
 */
export function findExtractDocument(
  documents: ExtractDocument[],
  docType: string
): ExtractDocument | null {
  if (!Array.isArray(documents) || documents.length === 0 || !docType) return null;

  function norm(str: string): string {
    return String(str || "")
      .toLowerCase()
      .replace(/_schema$/, "")
      .replace(/[\s\-_\/]+/g, "");
  }

  const targetNorm = norm(docType);

  // 별칭 매핑 테이블 (영문/약어/한글 서류명 통합)
  const aliases: Record<string, string[]> = {
    lc: ["letterofcredit", "lc", "loc", "신용장"],
    billoflading: ["bl", "billoflading", "bol", "선하증권", "선하증권bl", "선하증권b/l"],
    commercialinvoice: ["commercialinvoice", "invoice", "inv", "ci", "상업송장", "송장"],
    packinglist: ["packinglist", "pl", "packing", "패킹리스트", "포장명세서"],
    marinecargoinsurance: [
      "marinecargoinsurance",
      "insurance",
      "cargoinsurance",
      "policy",
      "해상적하보험증권",
      "보험증권",
      "해상보험",
    ],
    certificateoforigin: ["certificateoforigin", "coo", "co", "원산지증명서"],
    otherdocument: ["otherdocument", "other", "기타문서", "기타"],
  };

  // 1순위: 대소문자 무시 완전 일치 (document_type 또는 schema_name)
  for (const doc of documents) {
    if (!doc) continue;
    const dt = String(doc.document_type || "").toLowerCase().trim();
    const sn = String(doc.schema_name || "").toLowerCase().trim();
    const target = docType.toLowerCase().trim();
    if (dt === target || sn === target) {
      return doc;
    }
  }

  // 2순위: 정규화 문자열 일치
  for (const doc of documents) {
    if (!doc) continue;
    const dtNorm = norm(String(doc.document_type || ""));
    const snNorm = norm(String(doc.schema_name || ""));
    if (dtNorm === targetNorm || snNorm === targetNorm) {
      return doc;
    }
  }

  // 3순위: 별칭 그룹 일치
  let targetGroup: string | null = null;
  for (const [groupKey, groupAliases] of Object.entries(aliases)) {
    if (groupKey === targetNorm || groupAliases.includes(targetNorm)) {
      targetGroup = groupKey;
      break;
    }
  }

  if (targetGroup) {
    const validAliases = aliases[targetGroup];
    for (const doc of documents) {
      if (!doc) continue;
      const dtNorm = norm(String(doc.document_type || ""));
      const snNorm = norm(String(doc.schema_name || ""));
      if (
        dtNorm === targetGroup ||
        validAliases.includes(dtNorm) ||
        snNorm === targetGroup ||
        validAliases.includes(snNorm)
      ) {
        return doc;
      }
    }
  }

  // 4순위: 부분 포함(Substring) 매칭
  for (const doc of documents) {
    if (!doc) continue;
    const dtNorm = norm(String(doc.document_type || ""));
    const snNorm = norm(String(doc.schema_name || ""));
    if (
      dtNorm.includes(targetNorm) ||
      targetNorm.includes(dtNorm) ||
      snNorm.includes(targetNorm) ||
      targetNorm.includes(snNorm)
    ) {
      return doc;
    }
  }

  return null;
}

/**
 * 5) getScalarFieldLocation
 * - Rule 2: field_name이 단일 스칼라 항목일 때 additional_values[field_name]을 단일 객체로 조회
 * - Rule 5, 6: BBox 및 Page 정규화하여 HighlightResult 반환
 */
export function getScalarFieldLocation(
  doc: ExtractDocument,
  fieldName: string,
  evidenceValue?: unknown
): HighlightResult {
  const docType = doc.document_type || "";
  const addVals = doc.additional_values;

  if (!addVals || !isRecord(addVals)) {
    return {
      found: false,
      docType,
      fieldName,
      value: evidenceValue ?? null,
      reason: `Document '${docType}' has no additional_values`,
    };
  }

  // 필드 객체 탐색 (정확한 키 -> 대소문자 무시 키)
  let rawField = addVals[fieldName];
  if (!rawField) {
    const lowerKey = fieldName.toLowerCase();
    for (const [k, v] of Object.entries(addVals)) {
      if (k.toLowerCase() === lowerKey) {
        rawField = v;
        break;
      }
    }
  }

  if (!rawField) {
    return {
      found: false,
      docType,
      fieldName,
      value: evidenceValue ?? null,
      reason: `Field '${fieldName}' not found in additional_values`,
    };
  }

  // 위치 정보 추출
  const locations = extractLocationsFromField(rawField);
  const val = isRecord(rawField)
    ? rawField._value ?? rawField.value ?? evidenceValue ?? null
    : rawField ?? evidenceValue ?? null;
  const confidence = extractConfidence(rawField);

  if (locations.length === 0) {
    return {
      found: false,
      docType,
      fieldName,
      value: val,
      reason: `No valid locations/coordinates found for field '${fieldName}'`,
    };
  }

  return {
    found: true,
    docType,
    fieldName,
    value: val,
    ...(confidence !== undefined ? { confidence } : {}),
    locations,
  };
}

/**
 * 6) getTableFieldLocation
 * - Rule 3: field_name이 테이블 형태(예: line_items.product_name, cargo_details.gross_weight)일 때
 * - Rule 4: 행 선택 규칙:
 *   1순위: evidence.value 와 row.value 의 exact normalized match
 *   2순위: fallback to first row (0번째 행)
 */
export function getTableFieldLocation(
  doc: ExtractDocument,
  fieldName: string,
  evidenceValue?: unknown
): HighlightResult {
  const docType = doc.document_type || "";
  const addVals = doc.additional_values;

  if (!addVals || !isRecord(addVals)) {
    return {
      found: false,
      docType,
      fieldName,
      value: evidenceValue ?? null,
      reason: `Document '${docType}' has no additional_values`,
    };
  }

  let rows: unknown[] = [];
  let colName = fieldName;

  // Format A: additional_values['line_items.product_name'] = [ ... ]
  if (Array.isArray(addVals[fieldName])) {
    rows = addVals[fieldName];
  } else if (fieldName.includes(".")) {
    // Format B: additional_values['line_items'] = [ { product_name: { ... } }, ... ]
    const [tableName, subCol] = fieldName.split(".", 2);
    colName = subCol;

    if (Array.isArray(addVals[tableName])) {
      rows = addVals[tableName];
    } else {
      // 대소문자 무시 탐색
      const lowerTable = tableName.toLowerCase();
      for (const [k, v] of Object.entries(addVals)) {
        if (k.toLowerCase() === lowerTable && Array.isArray(v)) {
          rows = v;
          break;
        }
      }
    }
  }

  if (!rows || rows.length === 0) {
    return {
      found: false,
      docType,
      fieldName,
      value: evidenceValue ?? null,
      reason: `Table rows for '${fieldName}' not found or empty in additional_values`,
    };
  }

  // 행(Row) 선택 알고리즘
  let selectedIndex = -1;
  let selectedCell: unknown = null;

  const targetNormVal = evidenceValue !== undefined && evidenceValue !== null
    ? normalizeText(evidenceValue)
    : "";

  // 1순위: exact normalized match 탐색
  if (targetNormVal !== "") {
    for (let i = 0; i < rows.length; i++) {
      const rowItem = rows[i];
      let cellCandidate: unknown = rowItem;

      if (isRecord(rowItem) && colName in rowItem) {
        cellCandidate = rowItem[colName];
      }

      let cellVal: unknown = cellCandidate;
      if (isRecord(cellCandidate)) {
        cellVal = cellCandidate._value ?? cellCandidate.value ?? cellCandidate.text ?? "";
      }

      if (normalizeText(cellVal) === targetNormVal) {
        selectedIndex = i;
        selectedCell = cellCandidate;
        break;
      }
    }
  }

  // 2순위: 일치하는 행이 없으면 fallback to first row (index 0)
  if (selectedIndex === -1) {
    selectedIndex = 0;
    const firstRow = rows[0];
    if (isRecord(firstRow) && colName in firstRow) {
      selectedCell = firstRow[colName];
    } else {
      selectedCell = firstRow;
    }
  }

  if (!selectedCell || !isRecord(selectedCell)) {
    return {
      found: false,
      docType,
      fieldName,
      value: evidenceValue ?? null,
      rowIndex: selectedIndex,
      reason: `Column '${colName}' not found in row ${selectedIndex}`,
    };
  }

  const locations = extractLocationsFromField(selectedCell);
  const val = selectedCell._value ?? selectedCell.value ?? evidenceValue ?? null;
  const confidence = extractConfidence(selectedCell);

  if (locations.length === 0) {
    return {
      found: false,
      docType,
      fieldName,
      value: val,
      rowIndex: selectedIndex,
      reason: `No valid locations found in table '${fieldName}' at row ${selectedIndex}`,
    };
  }

  return {
    found: true,
    docType,
    fieldName,
    value: val,
    rowIndex: selectedIndex,
    ...(confidence !== undefined ? { confidence } : {}),
    locations,
  };
}

/**
 * 7) resolveFieldLocation
 * - docType 서류 존재 여부 검사
 * - 스칼라 필드와 테이블 필드 분기하여 위치 정보 매핑 수행
 */
export function resolveFieldLocation(
  doc: ExtractDocument | null,
  docType: string,
  fieldName: string,
  evidenceValue?: unknown
): HighlightResult {
  if (!doc) {
    return {
      found: false,
      docType,
      fieldName,
      value: evidenceValue ?? null,
      reason: `Extract document for type '${docType}' not found in extract step`,
    };
  }

  // dot(.)을 포함하거나 배열 형태인 경우 테이블 필드로 분기
  const isTableField =
    fieldName.includes(".") ||
    (doc.additional_values && Array.isArray(doc.additional_values[fieldName]));

  if (isTableField) {
    return getTableFieldLocation(doc, fieldName, evidenceValue);
  }

  return getScalarFieldLocation(doc, fieldName, evidenceValue);
}

/**
 * 8) buildCheckItemHighlights
 * - 최상위 jobResult를 입력받아 extract step과 instruct step을 찾아
 *   check_item_evidence의 모든 문서/필드에 대한 정규화된 하이라이트 목록을 일괄 빌드
 */
export function buildCheckItemHighlights(jobResult: unknown): CheckItemHighlightResult[] {
  const extractStep = getExtractStep(jobResult);
  const instructStep = getInstructStep(jobResult);

  if (!instructStep) return [];

  const extractDocs = extractStep?.result?.documents || [];

  const evidenceList: CheckItemEvidenceItem[] =
    instructStep.result?.structured_result?.check_item_evidence ||
    instructStep.structured_result?.check_item_evidence ||
    [];

  const results: CheckItemHighlightResult[] = [];

  for (const item of evidenceList) {
    if (!item) continue;

    const checkItemKey = item.check_item || "";
    const checkItemKo = item.check_item_ko || checkItemKey;
    const highlightsMap: Record<string, HighlightResult> = {};

    const docs = item.documents || {};
    for (const [docType, docEvidence] of Object.entries(docs)) {
      if (!docEvidence) continue;

      const fieldName = docEvidence.field_name || "";
      const evidenceValue = docEvidence.value;

      if (!fieldName) {
        highlightsMap[docType] = {
          found: false,
          docType,
          fieldName: "",
          value: evidenceValue ?? null,
          reason: "field_name is missing in check_item_evidence",
        };
        continue;
      }

      const matchedDoc = findExtractDocument(extractDocs, docType);
      const highlight = resolveFieldLocation(matchedDoc, docType, fieldName, evidenceValue);
      highlightsMap[docType] = highlight;
    }

    results.push({
      check_item: checkItemKey,
      check_item_ko: checkItemKo,
      highlights: highlightsMap,
    });
  }

  return results;
}
