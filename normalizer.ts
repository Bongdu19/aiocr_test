/**
 * Studio Document Extraction API Response Normalizer
 *
 * Upstage Studio Agent API 및 문서 추출 API의 다양한 응답 규격을
 * 프론트엔드 하이라이트 및 상호작용에 최적화된 고정 계약(Contract) 규격으로 변환합니다.
 */

// ============================================================================
// 1. 타입 정의 (Type Definitions)
// ============================================================================

/** 최상위 정규화 응답 규격 */
export type NormalizedResponse = {
  response_version: "1.0";
  job_id: string;
  workflow_id: string;
  documents: NormalizedDocument[];
};

/** 문서 단위 정규화 규격 */
export type NormalizedDocument = {
  document_id: string;
  file_name: string;
  document_type: string;
  fields: Record<string, FieldResult>;
  tables: Record<string, TableRow[]>;
};

/** 단일 필드 추출 결과 규격 */
export type FieldResult<T = string | number | boolean | string[] | null> = {
  value: T;
  confidence: number | null;
  source: FieldSource | null;
};

/** 원본 문서 위치 정보 (페이지, 바운딩 박스 목록, 원본 텍스트) */
export type FieldSource = {
  page: number;
  boxes: Box[];
  text?: string;
};

/** 0 ~ 1 정규화된 2D 바운딩 박스 */
export type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** 테이블 행 규격 */
export type TableRow = {
  row_index: number;
  cells: Record<string, FieldResult>;
};

// --- 느슨한 원본 API 타입 (Loose / Raw Types) ---
export type RawStudioResponse = Record<string, unknown>;
export type RawDocument = Record<string, unknown>;
export type RawFieldCandidate = Record<string, unknown>;
export type RawSourceCandidate = Record<string, unknown>;
export type RawBoxCandidate = Record<string, unknown>;

// ============================================================================
// 2. 유틸리티 함수 (Utility Functions)
// ============================================================================

/** 일반 객체(Record)인지 확인하는 타입 가드 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 원시 타입(Primitive)인지 확인하는 타입 가드 */
export function isPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

/** 객체들의 배열(Array of Objects)인지 확인하는 타입 가드 (테이블 행 판별용) */
export function isArrayOfObjects(value: unknown): value is Record<string, unknown>[] {
  return Array.isArray(value) && value.length > 0 && value.every(isRecord);
}

/** 안전한 문자열 변환 */
export function toStringSafe(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

/** 안전한 숫자 변환 (NaN 및 Infinity 방어) */
export function toNumberSafe(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** 객체에서 여러 후보 키 중 첫 번째로 발견되는 문자열 값 추출 */
export function pickFirstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key];
    if (typeof val === "string" && val.trim() !== "") {
      return val.trim();
    }
  }
  return null;
}

/** 객체에서 여러 후보 키 중 첫 번째로 발견되는 유효 숫자 추출 */
export function pickFirstNumber(obj: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const num = toNumberSafe(obj[key]);
    if (num !== null) return num;
  }
  return null;
}

/** 숫자를 0 ~ 1 범위로 안전하게 고정 (소수점 정밀도 6자리 보존) */
export function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Math.round(value * 1000000) / 1000000;
}

/** JSON 문자열 안전 파싱 (실패 시 null 반환) */
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

// ============================================================================
// 3. 정규화 핵심 함수 (Normalization Functions)
// ============================================================================

/**
 * 박스 정규화 함수
 * - x, y, width, height / left, top, w, h / x1, y1, x2, y2 / polygon / vertices 지원
 * - "정규화할 수 없는 박스는 버린다" 정책 적용:
 *   - 이미 0~1 범위면 유지 (단, 경계 오차 1.05까지 허용 후 clamp01)
 *   - 픽셀 단위(1 초과)인 경우 pageWidth/pageHeight가 전달되었을 때만 정규화 계산
 *   - 페이지 치수 정보가 없거나 0~1 범위를 벗어난 박스는 버림(null 반환)
 */
export function normalizeBox(
  raw: unknown,
  pageWidth?: number,
  pageHeight?: number
): Box | null {
  if (!raw) return null;

  let x: number | null = null;
  let y: number | null = null;
  let width: number | null = null;
  let height: number | null = null;

  // 1) 배열 형태인 경우 [x, y, w, h] 또는 [x1, y1, x2, y2]
  if (Array.isArray(raw) && raw.length >= 4) {
    const n0 = toNumberSafe(raw[0]);
    const n1 = toNumberSafe(raw[1]);
    const n2 = toNumberSafe(raw[2]);
    const n3 = toNumberSafe(raw[3]);
    if (n0 !== null && n1 !== null && n2 !== null && n3 !== null) {
      if (n2 >= n0 && n3 >= n1 && (n2 > 1 || n3 > 1 || n0 > 0 || n1 > 0)) {
        // [x1, y1, x2, y2] 형태
        x = n0;
        y = n1;
        width = n2 - n0;
        height = n3 - n1;
      } else {
        // [x, y, width, height] 형태
        x = n0;
        y = n1;
        width = n2;
        height = n3;
      }
    }
  } else if (isRecord(raw)) {
    // 2) Polygon / Vertices / Points 형태인 경우 (최소 바운딩 박스 계산)
    const points = raw.polygon ?? raw.vertices ?? raw.points;
    if (Array.isArray(points) && points.length >= 3) {
      const xs: number[] = [];
      const ys: number[] = [];

      for (const pt of points) {
        if (isRecord(pt)) {
          const px = pickFirstNumber(pt, ["x", "X"]);
          const py = pickFirstNumber(pt, ["y", "Y"]);
          if (px !== null && py !== null) {
            xs.push(px);
            ys.push(py);
          }
        } else if (Array.isArray(pt) && pt.length >= 2) {
          const px = toNumberSafe(pt[0]);
          const py = toNumberSafe(pt[1]);
          if (px !== null && py !== null) {
            xs.push(px);
            ys.push(py);
          }
        }
      }

      if (xs.length > 0 && ys.length > 0) {
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        x = minX;
        y = minY;
        width = maxX - minX;
        height = maxY - minY;
      }
    }

    // 3) Key-Value 기반 바운딩 박스 추출
    if (x === null || y === null || width === null || height === null) {
      // (a) x1, y1, x2, y2 또는 left, top, right, bottom 형태
      const x1 = pickFirstNumber(raw, ["x1", "left", "xmin", "x_min", "left_top_x"]);
      const y1 = pickFirstNumber(raw, ["y1", "top", "ymin", "y_min", "left_top_y"]);
      const x2 = pickFirstNumber(raw, ["x2", "right", "xmax", "x_max", "right_bottom_x"]);
      const y2 = pickFirstNumber(raw, ["y2", "bottom", "ymax", "y_max", "right_bottom_y"]);

      if (x1 !== null && y1 !== null && x2 !== null && y2 !== null) {
        x = Math.min(x1, x2);
        y = Math.min(y1, y2);
        width = Math.abs(x2 - x1);
        height = Math.abs(y2 - y1);
      } else {
        // (b) x, y, width, height 형태
        x = pickFirstNumber(raw, ["x", "left", "x_offset"]);
        y = pickFirstNumber(raw, ["y", "top", "y_offset"]);
        width = pickFirstNumber(raw, ["width", "w"]);
        height = pickFirstNumber(raw, ["height", "h"]);
      }
    }
  }

  // 필수 좌표값이 추출되지 않았거나 너비/높이가 0 이하인 경우 무효 처리
  if (x === null || y === null || width === null || height === null || width <= 0 || height <= 0) {
    return null;
  }

  // 4) 0 ~ 1 좌표 정규화 처리
  const isLikelyPixel = x > 1 || y > 1 || width > 1 || height > 1;

  if (isLikelyPixel) {
    // 픽셀 좌표이지만 페이지 너비/높이가 제공된 경우 정규화 계산
    if (pageWidth && pageHeight && pageWidth > 0 && pageHeight > 0) {
      x = x / pageWidth;
      y = y / pageHeight;
      width = width / pageWidth;
      height = height / pageHeight;
    } else {
      // 정책: 페이지 치수가 없어 0~1로 정규화할 수 없는 박스는 버린다.
      return null;
    }
  }

  // 최종 유효성 검사 (0~1 범위 허용, 부동소수점 오차 감안 1.05 이내)
  if (x < 0 || y < 0 || x > 1.05 || y > 1.05) {
    return null;
  }

  return {
    x: clamp01(x),
    y: clamp01(y),
    width: clamp01(width),
    height: clamp01(height),
  };
}

/**
 * 위치 정규화 함수
 * - page 번호, 박스 목록, 원본 텍스트를 추출
 * - box가 하나도 없고 page도 없으면 null 반환
 */
export function normalizeSource(
  raw: unknown,
  parentContext?: Record<string, unknown>
): FieldSource | null {
  if (!raw && !parentContext) return null;

  const target = isRecord(raw) ? raw : {};
  const parent = isRecord(parentContext) ? parentContext : {};

  // 1) 페이지 번호 추출 (page, pageNumber, page_index 등)
  let page: number | null = null;

  const pageCandidates = [
    target.page,
    target.pageNumber,
    target.page_number,
    target.page_no,
    parent.page,
    parent.pageNumber,
    parent.page_number,
    parent.page_no,
  ];

  for (const c of pageCandidates) {
    const n = toNumberSafe(c);
    if (n !== null && n >= 1) {
      page = Math.floor(n);
      break;
    }
  }

  // 0-indexed page_index 지원 (0이면 1페이지)
  if (page === null) {
    const pageIndexVal =
      target.page_index ??
      target.pageIndex ??
      target.page_idx ??
      parent.page_index ??
      parent.pageIndex ??
      parent.page_idx;

    const pIndex = toNumberSafe(pageIndexVal);
    if (pIndex !== null && pIndex >= 0) {
      page = Math.floor(pIndex) + 1;
    }
  }

  // 2) 텍스트 추출 (text, snippet, content, extracted_text 등)
  const textVal =
    pickFirstString(target, ["text", "snippet", "content", "extracted_text", "value"]) ??
    (isRecord(target.evidence)
      ? pickFirstString(target.evidence as Record<string, unknown>, ["text", "snippet"])
      : null) ??
    (isRecord(target.location)
      ? pickFirstString(target.location as Record<string, unknown>, ["text", "snippet"])
      : null);

  // 3) 페이지 치수 추출 (픽셀 박스 정규화 지원)
  const pageWidth =
    pickFirstNumber(target, ["page_width", "pageWidth", "document_width", "width"]) ??
    pickFirstNumber(parent, ["page_width", "pageWidth", "document_width", "width"]) ??
    undefined;

  const pageHeight =
    pickFirstNumber(target, ["page_height", "pageHeight", "document_height", "height"]) ??
    pickFirstNumber(parent, ["page_height", "pageHeight", "document_height", "height"]) ??
    undefined;

  // 4) 바운딩 박스 목록 추출
  const boxes: Box[] = [];

  // (a) 다중 박스 배열 탐색
  const rawBoxes =
    target.boxes ??
    target.bboxes ??
    target.bounding_boxes ??
    (isRecord(target.evidence) ? (target.evidence as Record<string, unknown>).boxes : null) ??
    (isRecord(target.location) ? (target.location as Record<string, unknown>).boxes : null);

  if (Array.isArray(rawBoxes)) {
    for (const b of rawBoxes) {
      const box = normalizeBox(b, pageWidth, pageHeight);
      if (box) boxes.push(box);
    }
  }

  // (b) 단일 박스 객체 탐색
  if (boxes.length === 0) {
    const singleBoxCandidate =
      target.box ??
      target.bbox ??
      target.bounding_box ??
      target.rect ??
      target.geometry ??
      (isRecord(target.evidence) ? (target.evidence as Record<string, unknown>).bbox : null) ??
      (isRecord(target.location) ? (target.location as Record<string, unknown>).bbox : null);

    const box = normalizeBox(singleBoxCandidate ?? target, pageWidth, pageHeight);
    if (box) boxes.push(box);
  }

  // 조건: box가 하나도 없고 page도 유효하지 않으면 null 반환
  if (boxes.length === 0 && page === null) {
    return null;
  }

  return {
    page: page ?? 1, // 박스는 존재하나 페이지 번호가 누락된 경우 기본값 1
    boxes,
    ...(textVal ? { text: textVal } : {}),
  };
}

/**
 * 신뢰도(Confidence) 정규화 함수
 * - 0~1 범위는 그대로 유지, 0~100 범위는 0~1로 스케일링
 */
export function normalizeConfidence(raw: unknown): number | null {
  const num = toNumberSafe(raw);
  if (num === null) return null;
  if (num < 0) return 0;
  if (num <= 1) return Math.round(num * 10000) / 10000;
  if (num <= 100) return Math.round((num / 100) * 10000) / 10000;
  return 1;
}

/**
 * 필드 정규화 함수
 * - value, confidence, source 추출
 * - 원본이 단순 primitive, 배열, 또는 { value, confidence, location } 객체인 경우 모두 지원
 */
export function normalizeFieldResult(
  rawField: unknown
): FieldResult<string | number | boolean | string[] | null> {
  // 1) Null / Undefined
  if (rawField === null || rawField === undefined) {
    return { value: null, confidence: null, source: null };
  }

  // 2) Primitive (string, number, boolean)
  if (isPrimitive(rawField)) {
    return {
      value: rawField,
      confidence: null,
      source: null,
    };
  }

  // 3) Array of Primitives (단순 문자열/숫자 배열)
  if (Array.isArray(rawField)) {
    if (rawField.every(isPrimitive)) {
      return {
        value: rawField.map(item => (item === null ? "" : String(item))),
        confidence: null,
        source: null,
      };
    }
    return {
      value: rawField.map(String),
      confidence: null,
      source: null,
    };
  }

  // 4) Record 형태의 복합 객체
  if (isRecord(rawField)) {
    // (a) Value 추출
    let val: string | number | boolean | string[] | null = null;
    if ("value" in rawField) {
      const v = rawField.value;
      if (isPrimitive(v)) {
        val = v;
      } else if (Array.isArray(v) && v.every(isPrimitive)) {
        val = v.map(item => (item === null ? "" : String(item)));
      } else {
        val = v !== undefined && v !== null ? String(v) : null;
      }
    } else if ("text" in rawField && isPrimitive(rawField.text)) {
      val = rawField.text;
    } else if ("content" in rawField && isPrimitive(rawField.content)) {
      val = rawField.content;
    } else if ("normalized_value" in rawField && isPrimitive(rawField.normalized_value)) {
      val = rawField.normalized_value;
    }

    // (b) Confidence 추출
    const confVal =
      rawField.confidence ??
      rawField.score ??
      rawField.probability ??
      rawField.conf;
    const confidence = normalizeConfidence(confVal);

    // (c) Source / Location 추출
    const sourceRaw =
      rawField.source ??
      rawField.location ??
      rawField.evidence ??
      rawField.geometry;

    const source = normalizeSource(sourceRaw ?? rawField, rawField);

    return {
      value: val,
      confidence,
      source,
    };
  }

  return { value: null, confidence: null, source: null };
}

/**
 * 테이블 행(TableRow) 목록 정규화 함수
 */
export function normalizeTableRows(rawRows: unknown[]): TableRow[] {
  const result: TableRow[] = [];

  rawRows.forEach((rowRaw, index) => {
    if (!isRecord(rowRaw)) return;

    const cells: Record<string, FieldResult> = {};
    for (const [colKey, colVal] of Object.entries(rowRaw)) {
      // 행 인덱스 메타데이터 제외
      if (colKey === "row_index" || colKey === "_index") continue;
      cells[colKey] = normalizeFieldResult(colVal);
    }

    result.push({
      row_index: index,
      cells,
    });
  });

  return result;
}

/**
 * 단일 문서 정규화 함수
 * - document_id, file_name, document_type 방어 기본값
 * - fields(단일 항목/배열)와 tables(배열<객체>) 분리 구성
 */
export function normalizeDocument(rawDoc: unknown): NormalizedDocument {
  if (!isRecord(rawDoc)) {
    return {
      document_id: "doc_001",
      file_name: "",
      document_type: "",
      fields: {},
      tables: {},
    };
  }

  // 1) 문서 메타데이터 추출
  const document_id =
    pickFirstString(rawDoc, ["document_id", "doc_id", "id", "documentId"]) ?? "doc_001";
  const file_name =
    pickFirstString(rawDoc, ["file_name", "fileName", "filename", "name", "source_file"]) ?? "";
  const document_type =
    pickFirstString(rawDoc, [
      "document_type",
      "documentType",
      "doctype",
      "category",
      "type",
      "classification",
      "class",
    ]) ?? "";

  const fields: Record<string, FieldResult> = {};
  const tables: Record<string, TableRow[]> = {};

  // 메타 키 필터링 목록
  const metaKeys = new Set([
    "document_id",
    "doc_id",
    "id",
    "documentId",
    "file_name",
    "fileName",
    "filename",
    "name",
    "source_file",
    "document_type",
    "documentType",
    "doctype",
    "category",
    "type",
    "classification",
    "class",
    "job_id",
    "workflow_id",
    "status",
  ]);

  // 2) 명시적 fields / tables 객체가 존재하는 경우 처리
  const rawFieldsContainer = isRecord(rawDoc.fields)
    ? rawDoc.fields
    : isRecord(rawDoc.extracted_fields)
    ? rawDoc.extracted_fields
    : null;

  const rawTablesContainer = isRecord(rawDoc.tables) ? rawDoc.tables : null;

  if (rawFieldsContainer) {
    for (const [key, val] of Object.entries(rawFieldsContainer)) {
      fields[key] = normalizeFieldResult(val);
    }
  }

  if (rawTablesContainer) {
    for (const [key, val] of Object.entries(rawTablesContainer)) {
      if (Array.isArray(val)) {
        tables[key] = normalizeTableRows(val);
      }
    }
  }

  // 3) 루트 객체의 키 순회 (명시적 컨테이너가 없거나 추가 필드가 있는 경우)
  for (const [key, val] of Object.entries(rawDoc)) {
    if (metaKeys.has(key) || key === "fields" || key === "tables" || key === "extracted_fields") {
      continue;
    }

    // (a) Array of Objects -> Tables
    if (isArrayOfObjects(val)) {
      tables[key] = normalizeTableRows(val);
      continue;
    }

    // (b) Array of Primitives -> Fields
    if (Array.isArray(val) && (val.length === 0 || val.every(isPrimitive))) {
      fields[key] = normalizeFieldResult(val);
      continue;
    }

    // (c) Record 형태
    if (isRecord(val)) {
      // 테이블처럼 { rows: [...] } 구조를 가지는지 확인
      if (Array.isArray(val.rows) && isArrayOfObjects(val.rows)) {
        tables[key] = normalizeTableRows(val.rows);
        continue;
      }
      // 단일 필드 후보 (value, confidence, source, location 등을 갖추거나 일반 객체)
      fields[key] = normalizeFieldResult(val);
      continue;
    }

    // (d) Primitive -> Fields
    if (isPrimitive(val)) {
      fields[key] = normalizeFieldResult(val);
    }
  }

  return {
    document_id,
    file_name,
    document_type,
    fields,
    tables,
  };
}

/**
 * 최상위 Studio 응답 정규화 함수 (메인 진입점)
 * - 원본 JSON이 Upstage Studio Agent 응답, OpenAI SDK 응답, 단일 문서,
 *   documents 배열 등 어떤 형태라도 NormalizedResponse 규격으로 안전하게 변환
 * - 비정상 입력 시에도 throw를 방지하고 기본 구조 보장
 */
export function normalizeStudioResponse(raw: unknown): NormalizedResponse {
  const defaultResponse: NormalizedResponse = {
    response_version: "1.0",
    job_id: "",
    workflow_id: "",
    documents: [],
  };

  if (!raw) {
    return defaultResponse;
  }

  // 문자열 JSON인 경우 우선 파싱 시도
  let data: unknown = raw;
  if (typeof raw === "string") {
    const parsed = safeJsonParse(raw);
    if (parsed) {
      data = parsed;
    } else {
      return defaultResponse;
    }
  }

  if (!isRecord(data)) {
    return defaultResponse;
  }

  // 1) Upstage Agent API / Studio 메타데이터 추출
  const job_id =
    pickFirstString(data, ["id", "job_id", "jobId", "task_id", "taskId", "requestId"]) ?? "";
  const workflow_id =
    pickFirstString(data, [
      "model",
      "workflow_id",
      "workflowId",
      "agt_id",
      "agent_id",
      "pipeline_id",
    ]) ?? "";

  // 2) Upstage Studio Agent API 구조 풀기 (output_text 또는 output[].content[].text)
  let extractedContent: unknown = data;

  // (a) shortcut 필드인 output_text가 존재하는 경우
  if ("output_text" in data && typeof data.output_text === "string") {
    const parsed = safeJsonParse(data.output_text);
    if (parsed) {
      extractedContent = parsed;
    }
  } else if (Array.isArray(data.output) && data.output.length > 0) {
    // (b) output 메시지 배열에서 마지막 assistant 메시지의 content 추출
    const lastOutput = data.output[data.output.length - 1];
    if (isRecord(lastOutput) && Array.isArray(lastOutput.content)) {
      for (const item of lastOutput.content) {
        if (isRecord(item)) {
          if (item.type === "output_text" && typeof item.text === "string") {
            const parsed = safeJsonParse(item.text);
            if (parsed) {
              extractedContent = parsed;
              break;
            }
          }
        }
      }
    }
  }

  // 3) Documents 탐색
  let documents: NormalizedDocument[] = [];

  const sourceForDocs = isRecord(extractedContent) ? extractedContent : data;
  const rawDocs =
    sourceForDocs.documents ??
    sourceForDocs.docs ??
    sourceForDocs.results ??
    sourceForDocs.data;

  if (Array.isArray(rawDocs)) {
    documents = rawDocs.map(doc => normalizeDocument(doc));
  } else {
    // documents 배열 없이 루트 자체가 단일 문서 결과인 경우 대응
    const singleDoc = normalizeDocument(sourceForDocs);
    if (
      singleDoc.file_name ||
      singleDoc.document_type ||
      Object.keys(singleDoc.fields).length > 0 ||
      Object.keys(singleDoc.tables).length > 0
    ) {
      documents = [singleDoc];
    }
  }

  return {
    response_version: "1.0",
    job_id,
    workflow_id,
    documents,
  };
}

// ============================================================================
// 4. 위치 정보 매핑 및 하이라이트 모듈 (Location Mapping & Highlights)
// ============================================================================
export * from "./location_mapper.ts";
