var CONFIG = null;
var selectedFile = null;
var uploadedFileId = null;
var currentJobId = null;
var currentChecklistData = null;
var activeChecklistTab = null;
var currentRawPayload = null;
var currentCheckItemEvidence = [];
var currentCheckResults = [];
var els = {};
var currentActiveSampleIndex = 1;

/**
 * Code.md v5/v7 Contract Helpers:
 * 1) getEvidence: 특정 check_item 및 문서 종류(docType)에 대한 근거(Evidence) 탐색 (check_results 우선, check_item_evidence 보조)
 * 2) canHighlight: Bounding Box 및 페이지 정보가 유효한지 검증 (page > 0, boxes.length > 0 또는 field_name 추출 매핑)
 */
function getEvidence(checkItem, docType) {
  var normDoc = typeof normalizeDocType === "function" ? normalizeDocType(docType) : docType;
  var targetKey = String(checkItem || "").trim();

  // 1순위: 최신 v7/v11 check_results 에서 탐색 (check_item 영문 키 및 label 한국어 둘 다 매칭 지원)
  if (currentCheckResults && currentCheckResults.length) {
    var cRow = currentCheckResults.find(function (x) {
      if (!x) return false;
      return x.check_item === targetKey || x.label === targetKey || x.check_item_ko === targetKey ||
        (x.check_item && targetKey.indexOf(x.check_item) >= 0) ||
        (targetKey && x.check_item && x.check_item.indexOf(targetKey) >= 0);
    });
    if (cRow && cRow.documents) {
      if (cRow.documents[docType]) return cRow.documents[docType];
      var cKeys = Object.keys(cRow.documents);
      for (var i = 0; i < cKeys.length; i++) {
        var ck = cKeys[i];
        var normCk = typeof normalizeDocType === "function" ? normalizeDocType(ck) : ck;
        if (normCk === normDoc || ck.indexOf(normDoc) >= 0 || normDoc.indexOf(ck) >= 0) {
          return cRow.documents[ck];
        }
      }
    }
  }

  // 2순위: check_item_evidence 에서 탐색 (check_item 및 check_item_ko 매칭)
  if (currentCheckItemEvidence && currentCheckItemEvidence.length) {
    var row = currentCheckItemEvidence.find(function (x) {
      if (!x) return false;
      return x.check_item === targetKey || x.check_item_ko === targetKey ||
        (x.check_item && targetKey.indexOf(x.check_item) >= 0) ||
        (targetKey && x.check_item && x.check_item.indexOf(targetKey) >= 0);
    });
    if (row && row.documents) {
      if (row.documents[docType]) return row.documents[docType];
      var keys = Object.keys(row.documents);
      for (var j = 0; j < keys.length; j++) {
        var k = keys[j];
        var normK = typeof normalizeDocType === "function" ? normalizeDocType(k) : k;
        if (normK === normDoc || k.indexOf(normDoc) >= 0 || normDoc.indexOf(k) >= 0) {
          return row.documents[k];
        }
      }
    }
  }

  return null;
}

/**
 * 신용장 서류 하이라이트 좌표 연동 명세서 준수:
 * 1) polygonToBox: polygon 4점 배열 [{x, y}, ...]을 bbox {x, y, width, height}로 변환 (0~1 normalized)
 * 2) normalizeSource: coordinates(다각형) 또는 boxes(박스) 입력을 표준 { page, boxes } 형태로 통일
 * 3) toPixelBox: normalized box를 렌더된 캔버스/페이지 크기 기준 픽셀로 변환
 */
function polygonToBox(points) {
  if (!points || !points.length) return null;
  var xs = points.map(function (p) { return p.x; });
  var ys = points.map(function (p) { return p.y; });
  var minX = Math.min.apply(null, xs);
  var maxX = Math.max.apply(null, xs);
  var minY = Math.min.apply(null, ys);
  var maxY = Math.max.apply(null, ys);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY
  };
}

function normalizeSource(source) {
  if (!source) return null;
  var page = typeof source.page === "number" ? source.page : -1;
  var boxes = [];

  // 1순위: word_coordinates (실제 텍스트 토큰 단위 정밀 폴리곤 - 단일 통합 BBox 생성)
  if (Array.isArray(source.word_coordinates) && source.word_coordinates.length > 0) {
    var allPts = [];
    source.word_coordinates.forEach(function (poly) {
      if (Array.isArray(poly)) {
        poly.forEach(function (pt) {
          if (pt && typeof pt.x === "number" && typeof pt.y === "number") {
            allPts.push(pt);
          }
        });
      }
    });
    if (allPts.length > 0) {
      var wb = polygonToBox(allPts);
      if (wb) boxes.push(wb);
    }
  } else if (Array.isArray(source.boxes) && source.boxes.length > 0) {
    boxes = source.boxes;
  } else if (Array.isArray(source.coordinates) && source.coordinates.length > 0) {
    // 4점 polygon 배열인 경우 bbox 변환
    var b = polygonToBox(source.coordinates);
    if (b) boxes.push(b);
  }

  if (page <= 0 || boxes.length === 0) return null;
  return {
    page: page,
    boxes: boxes
  };
}

function toPixelBox(box, pageWidth, pageHeight) {
  if (!box) return null;
  return {
    left: box.x * pageWidth,
    top: box.y * pageHeight,
    width: box.width * pageWidth,
    height: box.height * pageHeight
  };
}

function canHighlight(evidenceDoc, docType, checkItemKey) {
  if (!evidenceDoc) return false;
  var normSrc = normalizeSource(evidenceDoc.source);
  return !!(normSrc && normSrc.page > 0 && normSrc.boxes.length > 0);
}

function getEvidenceTarget(sampleIdx, docType, evidenceDoc, checkItemKey) {
  if (!evidenceDoc) return null;
  var normSrc = normalizeSource(evidenceDoc.source);
  if (normSrc && normSrc.page > 0 && normSrc.boxes.length > 0) {
    return {
      page: normSrc.page,
      box: normSrc.boxes[0],
      boxes: normSrc.boxes,
      label: evidenceDoc.field_name || (evidenceDoc.source && evidenceDoc.source.text) || (evidenceDoc.value ? String(evidenceDoc.value).slice(0, 25) : checkItemKey)
    };
  }
  return null;
}

function getEl(id) {
  return document.getElementById(id);
}

function initElements() {
  els.apiKey = getEl("apiKey");
  els.workerUrl = getEl("workerUrl");
  els.configId = getEl("configId");
  els.forceRefreshBtn = getEl("forceRefreshBtn");
  els.themeToggleBtn = getEl("themeToggleBtn");
  els.themeIcon = getEl("themeIcon");
  els.themeLabel = getEl("themeLabel");
  els.fileInput = getEl("fileInput");
  els.dropzone = getEl("dropzone");
  els.fileInfo = getEl("fileInfo");
  els.runBtn = getEl("runBtn");
  els.sampleBtn = getEl("sampleBtn");
  els.sampleBtn1 = getEl("sampleBtn1");
  els.sampleBtn2 = getEl("sampleBtn2");
  els.sampleBtn3 = getEl("sampleBtn3");
  els.sampleBtn4 = getEl("sampleBtn4");
  els.sampleSelect = getEl("sampleSelect");
  els.clearBtn = getEl("clearBtn");
  els.lookupJobId = getEl("lookupJobId");
  els.lookupBtn = getEl("lookupBtn");
  els.jobStatus = getEl("jobStatus");
  els.jobMeta = getEl("jobMeta");
  els.overallStatus = getEl("overallStatus");
  els.overallStatusCard = getEl("overallStatusCard");
  els.overallStatusDesc = getEl("overallStatusDesc");
  els.alertLevel = getEl("alertLevel");
  els.alertLevelCard = getEl("alertLevelCard");
  els.alertLevelDesc = getEl("alertLevelDesc");
  els.recommendedAction = getEl("recommendedAction");
  els.recommendedActionCard = getEl("recommendedActionCard");
  els.oneLineSummary = getEl("oneLineSummary");
  els.usageCard = getEl("usageCard");
  els.usageStepName = getEl("usageStepName");
  els.usageInputTokens = getEl("usageInputTokens");
  els.usageOutputTokens = getEl("usageOutputTokens");
  els.usageTotalTokens = getEl("usageTotalTokens");
  els.comparisonTableBody = getEl("comparisonTableBody");
  els.comparisonCardsContainer = getEl("comparisonCardsContainer");
  els.comparisonTableWrap = getEl("comparisonTableWrap");
  els.viewCardBtn = getEl("viewCardBtn");
  els.viewTableBtn = getEl("viewTableBtn");
  els.documentKeys = getEl("documentKeys");
  els.dateTimeline = getEl("dateTimeline");
  els.checklistTabs = getEl("checklistTabs");
  els.checklistContent = getEl("checklistContent");
  els.copyJsonBtn = getEl("copyJsonBtn");
  els.downloadJsonBtn = getEl("downloadJsonBtn");
  els.rawJson = getEl("rawJson");

  /* Document Viewer Floating Window Elements */
  els.openDocViewerBtn = getEl("openDocViewerBtn");
  els.docViewerBackdrop = getEl("docViewerBackdrop");
  els.docViewerFloating = getEl("docViewerFloating");
  els.mobileSwipeHandleBar = getEl("mobileSwipeHandleBar");
  els.docViewerHeader = getEl("docViewerHeader");
  els.viewerCloseBtn = getEl("viewerCloseBtn");
  els.viewerMobileBottomBar = getEl("viewerMobileBottomBar");
  els.viewerMobileCloseBtn = getEl("viewerMobileCloseBtn");
  els.viewerDockBtn = getEl("viewerDockBtn");
  els.viewerMaxBtn = getEl("viewerMaxBtn");
  els.docViewerResizer = getEl("docViewerResizer");
  els.viewerDocBadge = getEl("viewerDocBadge");
  els.viewerDocTitle = getEl("viewerDocTitle");
  els.viewerPageIndicator = getEl("viewerPageIndicator");
  els.viewerPrevPageBtn = getEl("viewerPrevPageBtn");
  els.viewerNextPageBtn = getEl("viewerNextPageBtn");
  els.viewerPageInput = getEl("viewerPageInput");
  els.viewerTotalPages = getEl("viewerTotalPages");
  els.viewerZoomInBtn = getEl("viewerZoomInBtn");
  els.viewerZoomOutBtn = getEl("viewerZoomOutBtn");
  els.viewerFitWidthBtn = getEl("viewerFitWidthBtn");
  els.viewerZoomLabel = getEl("viewerZoomLabel");
  els.viewerToggleHighlightBtn = getEl("viewerToggleHighlightBtn");
  els.docQuickNav = getEl("docQuickNav");
  els.viewerHighlightBanner = getEl("viewerHighlightBanner");
  els.viewerHighlightTargetText = getEl("viewerHighlightTargetText");
  els.docViewerBody = getEl("docViewerBody");
  els.docPageStage = getEl("docPageStage");
  els.pdfCanvas = getEl("pdfCanvas");
  els.highlightLayer = getEl("highlightLayer");
  els.viewerLoadingSpinner = getEl("viewerLoadingSpinner");
}

function escapeHtml(value) {
  var str = String(value == null ? "" : value);
  str = str.replace(/&/g, "&amp;");
  str = str.replace(/</g, "&lt;");
  str = str.replace(/>/g, "&gt;");
  str = str.replace(/"/g, "&quot;");
  str = str.replace(/'/g, "&#039;");
  return str;
}

/* Remove raw citation markers like 【†16】, [†80], 【80】 */
function cleanText(value) {
  if (value == null) return "";
  var str = String(value);
  str = str.replace(/【†?\d+】/g, "").replace(/\[†?\d+\]/g, "");
  return str.trim();
}

function trimValue(value) {
  return String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
}

function getCacheBuster() {
  var url = new URL(window.location.href);
  return url.searchParams.get("v") || String(Date.now());
}

/* Theme Toggle */
function initTheme() {
  var savedTheme = localStorage.getItem("theme") || "light";
  setTheme(savedTheme);

  if (els.themeToggleBtn) {
    els.themeToggleBtn.addEventListener("click", function () {
      var currentTheme = document.documentElement.getAttribute("data-theme") || "light";
      var nextTheme = currentTheme === "light" ? "dark" : "light";
      setTheme(nextTheme);
    });
  }
}

function setTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);

  if (els.themeIcon && els.themeLabel) {
    if (theme === "dark") {
      els.themeIcon.innerHTML = '<i class="bi bi-moon-stars-fill"></i>';
      els.themeLabel.textContent = "어두운 화면";
    } else {
      els.themeIcon.innerHTML = '<i class="bi bi-sun-fill"></i>';
      els.themeLabel.textContent = "밝은 화면";
    }
  }
}

/* API Endpoint Construction via Cloudflare Worker with Direct Upstage Fallback */
function getApiEndpoint(path) {
  var workerBase = trimValue(els.workerUrl ? els.workerUrl.value : "") || (CONFIG ? CONFIG.workerUrl : "");
  if (!workerBase) {
    workerBase = "https://bong.gehunmin19.workers.dev";
  }
  
  if (!/^https?:\/\//i.test(workerBase)) {
    workerBase = "https://" + workerBase;
  }

  workerBase = workerBase.replace(/\/+$/, "");

  // 모바일 오타/잘림 자동 보정 (예: 'workers.' 또는 'workers' 로 끝난 경우 .dev 자동 보완)
  if (workerBase.endsWith("workers.") || workerBase.endsWith("workers")) {
    workerBase = workerBase.replace(/workers\.?$/, "workers.dev");
  }

  if (!workerBase.endsWith("/v2") && !workerBase.endsWith("/v1")) {
    return workerBase + "/v2" + path;
  }
  return workerBase + path;
}

function getDirectApiEndpoint(path) {
  var base = (CONFIG && CONFIG.baseUrl) || "https://api.upstage.ai/v2";
  base = base.replace(/\/+$/, "");
  return base + path;
}

function setStatus(text, meta) {
  els.jobStatus.textContent = text || "";
  els.jobMeta.textContent = meta || "";
}

function koreanStatus(statusStr) {
  if (!statusStr) return "-";
  var s = String(statusStr).toLowerCase().trim();

  // Overall & Alert levels
  if (s === "review_required" || s === "review required") return "검토 필요";
  if (s === "proceed") return "진행 가능";
  if (s === "on_hold" || s === "on hold") return "보류";
  if (s === "critical") return "치명";
  if (s === "warning" || s === "warn") return "주의";
  if (s === "info") return "참고";

  // Matrix/Checklist results
  if (s === "match" || s === "ok") return "일치";
  if (s === "mismatch") return "불일치";
  if (s === "missing") return "미제출";
  if (s === "unclear") return "확인 필요";
  if (s === "pass") return "통과";
  if (s === "fail" || s === "crit") return "미비";
  if (s === "not_available" || s === "n/a") return "미해당";
  if (s === "present") return "구비됨";

  return statusStr;
}

function formatDocValue(val) {
  if (val == null) return "-";
  var str = cleanText(val);
  var lower = str.toLowerCase().trim();
  if (lower === "present") return "구비됨";
  if (lower === "missing") return "미제출";
  if (lower === "not_available" || lower === "n/a") return "미해당";
  if (lower === "match") return "일치";
  if (lower === "mismatch") return "불일치";
  if (lower === "unclear") return "확인 필요";
  return str;
}

function formatTableCellHtml(val) {
  if (val == null || val === "" || val === "-") {
    return '<span class="cell-val cell-val-subtle">-</span>';
  }
  var str = cleanText(val);
  var lower = str.toLowerCase().trim();

  if (lower === "present" || lower === "구비됨") {
    return '<span class="cell-val cell-val-ok"><i class="bi bi-check-circle-fill"></i> 구비됨</span>';
  }
  if (lower === "match" || lower === "일치") {
    return '<span class="cell-val cell-val-ok"><i class="bi bi-check-lg"></i> 일치</span>';
  }
  if (lower === "missing" || lower === "미제출") {
    return '<span class="cell-val cell-val-crit"><i class="bi bi-x-circle-fill"></i> 미제출</span>';
  }
  if (lower === "mismatch" || lower === "불일치") {
    return '<span class="cell-val cell-val-crit"><i class="bi bi-exclamation-octagon-fill"></i> 불일치</span>';
  }
  if (lower === "unclear" || lower === "확인 필요" || lower === "확인필요") {
    return '<span class="cell-val cell-val-warn"><i class="bi bi-question-circle-fill"></i> 확인필요</span>';
  }
  if (lower === "not_available" || lower === "n/a" || lower === "미해당") {
    return '<span class="cell-val cell-val-subtle">미해당</span>';
  }
  if (str.indexOf("?") >= 0) {
    return '<span class="cell-val cell-val-warn" title="OCR 판독 불명확"><i class="bi bi-question-diamond"></i> ' + escapeHtml(str) + '</span>';
  }

  return '<span class="cell-val cell-val-text">' + escapeHtml(str) + '</span>';
}

function badgeClass(result) {
  var v = String(result || "").toLowerCase();

  if (
    v.indexOf("일치") >= 0 ||
    v.indexOf("진행") >= 0 ||
    v.indexOf("통과") >= 0 ||
    v.indexOf("구비") >= 0 ||
    v === "match" ||
    v === "ok" ||
    v === "proceed" ||
    v === "pass" ||
    v === "present"
  ) {
    return "badge badge-ok";
  }
  if (
    v.indexOf("검토") >= 0 ||
    v.indexOf("주의") >= 0 ||
    v.indexOf("확인") >= 0 ||
    v.indexOf("warning") >= 0 ||
    v === "review_required" ||
    v === "unclear" ||
    v === "warn"
  ) {
    return "badge badge-warn";
  }
  if (
    v.indexOf("불일치") >= 0 ||
    v.indexOf("보류") >= 0 ||
    v.indexOf("치명") >= 0 ||
    v.indexOf("미제출") >= 0 ||
    v.indexOf("미비") >= 0 ||
    v.indexOf("critical") >= 0 ||
    v === "mismatch" ||
    v === "on_hold" ||
    v === "missing" ||
    v === "fail"
  ) {
    return "badge badge-crit";
  }
  return "badge badge-neutral";
}

function resultCellClass(result) {
  var v = String(result || "").toLowerCase();
  if (
    v.indexOf("일치") >= 0 ||
    v.indexOf("진행") >= 0 ||
    v.indexOf("통과") >= 0 ||
    v.indexOf("구비") >= 0 ||
    v === "match" ||
    v === "ok" ||
    v === "proceed" ||
    v === "pass" ||
    v === "present"
  ) {
    return "res-cell res-cell-ok";
  }
  if (
    v.indexOf("검토") >= 0 ||
    v.indexOf("주의") >= 0 ||
    v.indexOf("확인") >= 0 ||
    v.indexOf("warning") >= 0 ||
    v === "review_required" ||
    v === "unclear" ||
    v === "warn"
  ) {
    return "res-cell res-cell-warn";
  }
  if (
    v.indexOf("불일치") >= 0 ||
    v.indexOf("보류") >= 0 ||
    v.indexOf("치명") >= 0 ||
    v.indexOf("미제출") >= 0 ||
    v.indexOf("미비") >= 0 ||
    v.indexOf("critical") >= 0 ||
    v === "mismatch" ||
    v === "on_hold" ||
    v === "missing" ||
    v === "fail"
  ) {
    return "res-cell res-cell-crit";
  }
  return "res-cell res-cell-neutral";
}

function rowHighlightClass(result) {
  var v = String(result || "").toLowerCase();

  if (
    v.indexOf("불일치") >= 0 ||
    v.indexOf("보류") >= 0 ||
    v.indexOf("치명") >= 0 ||
    v.indexOf("미제출") >= 0 ||
    v.indexOf("미비") >= 0 ||
    v.indexOf("critical") >= 0 ||
    v === "mismatch" ||
    v === "missing" ||
    v === "fail" ||
    v === "on_hold"
  ) {
    return "row-crit";
  }
  if (
    v.indexOf("검토") >= 0 ||
    v.indexOf("주의") >= 0 ||
    v.indexOf("확인") >= 0 ||
    v.indexOf("warning") >= 0 ||
    v === "review_required" ||
    v === "unclear" ||
    v === "warn"
  ) {
    return "row-warn";
  }
  return "";
}

function applyCardTheme(cardEl, themeClass) {
  if (!cardEl) return;
  cardEl.classList.remove("card-theme-warn", "card-theme-crit", "card-theme-ok", "card-theme-neutral");
  if (themeClass) {
    cardEl.classList.add(themeClass);
  }
}

function clearResult() {
  applyCardTheme(els.overallStatusCard, null);
  applyCardTheme(els.alertLevelCard, null);
  applyCardTheme(els.recommendedActionCard, null);
  uploadedFileId = null;
  currentJobId = null;
  if (els.overallStatus) els.overallStatus.style.display = "none";
  els.overallStatusDesc.textContent = "결과 없음";
  if (els.alertLevel) els.alertLevel.style.display = "none";
  els.alertLevelDesc.textContent = "결과 없음";
  els.recommendedAction.textContent = "결과 없음";
  els.oneLineSummary.textContent = "결과 없음";
  if (els.usageCard) els.usageCard.style.display = "none";
  els.documentKeys.innerHTML = "결과 없음";
  if (els.dateTimeline) els.dateTimeline.innerHTML = "결과 없음";
  var hb = document.getElementById("timelineHeaderBadge");
  if (hb) hb.innerHTML = "";
  if (els.comparisonTableBody) els.comparisonTableBody.innerHTML = '<div class="empty-cell">결과 없음</div>';
  if (els.comparisonCardsContainer) els.comparisonCardsContainer.innerHTML = '<div class="empty-cell">결과 없음</div>';
  if (els.checklistTabs) els.checklistTabs.innerHTML = "";
  if (els.checklistContent) els.checklistContent.innerHTML = '<div class="empty-cell">결과 없음</div>';
  els.rawJson.textContent = "결과 없음";
  currentChecklistData = null;
  activeChecklistTab = null;
  currentRawPayload = null;
  setStatus("대기 중", "");
}

function clearAll() {
  selectedFile = null;
  if (els.fileInput) els.fileInput.value = "";
  if (els.sampleSelect) els.sampleSelect.value = "";
  if (els.fileInfo) els.fileInfo.textContent = "선택된 파일 없음";
  clearResult();
}

/**
 * [방법 B: Normalizer Lookup]
 * Upstage Agent API include: ["all"] 호출 시 반환되는 step_extract의 정밀 OCR additional_values와
 * step_instruct의 check_item_evidence (field_name)를 1:1로 매핑하여 100% 정밀 BBox를 자동 결합합니다.
 */
function enrichEvidenceWithOcrCoordinates(extractResult, structuredResult) {
  if (!extractResult || !structuredResult) return;

  var docs = extractResult.documents || (extractResult.result && extractResult.result.documents) || [];
  if (!Array.isArray(docs) || docs.length === 0) return;

  // 1. 서류 타입별 additional_values 룩업 테이블 구축
  var extractDocMap = {};
  docs.forEach(function (d) {
    if (!d) return;
    var dt = String(d.document_type || d.schema_name || "").toLowerCase().replace(/_schema$/, "").trim();
    if (!extractDocMap[dt]) extractDocMap[dt] = {};
    if (d.schema_name) {
      var sn = String(d.schema_name).toLowerCase().replace(/_schema$/, "").trim();
      if (!extractDocMap[sn]) extractDocMap[sn] = {};
    }
    var addVals = d.additional_values || {};
    Object.keys(addVals).forEach(function (k) {
      extractDocMap[dt][k] = addVals[k];
      if (d.schema_name) {
        var sn = String(d.schema_name).toLowerCase().replace(/_schema$/, "").trim();
        extractDocMap[sn][k] = addVals[k];
      }
    });
  });

  // 문서 타입 매칭 헬퍼 (별칭 및 한글/영문 매핑 통합)
  function findDocAddVals(docKey) {
    var rawKey = String(docKey || "").toLowerCase().trim();
    var normKey = typeof normalizeDocType === "function" ? normalizeDocType(rawKey) : rawKey.replace(/[\s\-_]+/g, "");
    if (extractDocMap[normKey]) return extractDocMap[normKey];
    if (extractDocMap[rawKey]) return extractDocMap[rawKey];

    var aliasMap = {
      lc: ["letterofcredit", "lc", "loc", "신용장"],
      bill_of_lading: ["bl", "billoflading", "bol", "선하증권", "선하증권bl", "선하증권b/l"],
      commercial_invoice: ["commercialinvoice", "invoice", "inv", "ci", "상업송장", "송장"],
      packing_list: ["packinglist", "pl", "packing", "패킹리스트", "포장명세서"],
      marine_cargo_insurance: ["marinecargoinsurance", "insurance", "cargoinsurance", "policy", "해상적하보험증권", "보험증권", "해상보험"],
      certificate_of_origin: ["certificateoforigin", "coo", "co", "원산지증명서"],
      other_document: ["otherdocument", "other", "기타문서", "기타"]
    };

    var matchedGroup = null;
    for (var gKey in aliasMap) {
      if (gKey === normKey || aliasMap[gKey].indexOf(normKey) >= 0) {
        matchedGroup = gKey;
        break;
      }
    }

    var keys = Object.keys(extractDocMap);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var kNorm = k.replace(/[\s\-_]+/g, "");
      if (k === normKey || kNorm === normKey || k.indexOf(normKey) >= 0 || normKey.indexOf(k) >= 0) {
        return extractDocMap[k];
      }
      if (matchedGroup && (matchedGroup === k || matchedGroup === kNorm || aliasMap[matchedGroup].indexOf(kNorm) >= 0)) {
        return extractDocMap[k];
      }
    }
    return null;
  }

  // BBox 좌표를 0~1 normalized Box로 변환하는 헬퍼 (locations, coordinates 폴리곤, bbox 지원)
  function convertOcrLocationToBox(matchedVal) {
    if (!matchedVal) return null;
    var page = typeof matchedVal.page === "number" && matchedVal.page > 0 ? matchedVal.page : 1;
    var boxes = [];

    // 1순위: word_coordinates (최우선: 실제 텍스트 토큰 단위 정밀 BBox - Upstage Studio UI 기준)
    if (Array.isArray(matchedVal.word_coordinates) && matchedVal.word_coordinates.length > 0) {
      var allPts = [];
      matchedVal.word_coordinates.forEach(function (poly) {
        if (Array.isArray(poly)) {
          poly.forEach(function (pt) {
            if (pt && typeof pt.x === "number" && typeof pt.y === "number") {
              allPts.push(pt);
            }
          });
        }
      });
      if (allPts.length > 0) {
        var wordBox = polygonToBox(allPts);
        if (wordBox) boxes.push(wordBox);
      }
    } else if (matchedVal.locations || (Array.isArray(matchedVal) && matchedVal[0] && matchedVal[0].locations)) {
      // 2순위: locations
      var locs = matchedVal.locations || matchedVal[0].locations;
      if (locs && locs.length) {
        var firstLoc = locs[0];
        page = typeof firstLoc.page === "number" ? firstLoc.page : page;
        var bbox = firstLoc.bbox; // [x1, y1, x2, y2]
        if (Array.isArray(bbox) && bbox.length >= 4) {
          var isNormalized = bbox[2] <= 1.05 && bbox[3] <= 1.05 && bbox[0] >= 0 && bbox[1] >= 0;
          var wDoc = isNormalized ? 1 : 595.28;
          var hDoc = isNormalized ? 1 : 841.89;
          var x1 = bbox[0] / wDoc;
          var y1 = bbox[1] / hDoc;
          var x2 = bbox[2] / wDoc;
          var y2 = bbox[3] / hDoc;
          boxes.push({
            x: Math.min(x1, x2),
            y: Math.min(y1, y2),
            width: Math.abs(x2 - x1),
            height: Math.abs(y2 - y1)
          });
        }
      }
    } else if (Array.isArray(matchedVal.bbox) && matchedVal.bbox.length >= 4) {
      // 3순위: bbox
      var bx1 = Number(matchedVal.bbox[0]);
      var by1 = Number(matchedVal.bbox[1]);
      var bx2 = Number(matchedVal.bbox[2]);
      var by2 = Number(matchedVal.bbox[3]);
      boxes.push({
        x: Math.min(bx1, bx2),
        y: Math.min(by1, by2),
        width: Math.abs(bx2 - bx1),
        height: Math.abs(by2 - by1)
      });
    } else if (Array.isArray(matchedVal.coordinates) && matchedVal.coordinates.length > 0) {
      // 4순위: coordinates (블록/영역 폴리곤 폴백)
      var polyBox = polygonToBox(matchedVal.coordinates);
      if (polyBox) boxes.push(polyBox);
    }

    if (boxes.length === 0) return null;

    var txt = matchedVal._value != null ? String(matchedVal._value) : (matchedVal.value != null ? String(matchedVal.value) : "");
    return {
      page: page,
      boxes: boxes,
      text: txt
    };
  }

  // 2. check_item_evidence 순회 및 source 주입 (규칙 2, 3, 4 준수)
  var evidenceList = structuredResult.check_item_evidence || [];
  var generatedCheckResults = [];

  evidenceList.forEach(function (row) {
    if (!row || !row.documents) return;
    var crDocMap = {};
    var isFilePresence = row.check_item === "file_presence" ||
                         row.check_item === "required_documents_presence" ||
                         (row.check_item_ko && (row.check_item_ko.indexOf("서류 구비") >= 0 || row.check_item_ko.indexOf("서류구비") >= 0));

    // 기타(도착통지서 등) 문서가 실제 추출 문서에 존재하지만 row.documents에 없는 경우 보강
    if (isFilePresence && !row.documents.other_document) {
      var otherAddVals = findDocAddVals("other_document");
      if (otherAddVals) {
        row.documents.other_document = {
          field_name: "document_title",
          value: "present"
        };
      }
    }

    Object.keys(row.documents).forEach(function (docKey) {
      var docEv = row.documents[docKey];
      if (!docEv) return;
      var fName = docEv.field_name;
      var addVals = findDocAddVals(docKey);
      var matchedVal = null;

      // 🌟 사용자 코멘트 2 반영:
      // 서류구비현황(file_presence) 항목은 Key No 대신 서류 종류(document_type / document_title)를 타깃으로 하이라이트
      if (isFilePresence) {
        fName = "document_type";
        docEv.field_name = "document_type";
        if (addVals) {
          matchedVal = (addVals["document_type"] && addVals["document_type"].page > 0 ? addVals["document_type"] : null) ||
                       addVals["document_title"] ||
                       addVals["document_type"];
        }
      } else if (addVals && fName) {
        if (fName.indexOf(".") >= 0) {
          // 규칙 3: 테이블 항목 (예: line_items.product_name, cargo_details.cargo_description)
          var parts = fName.split(".");
          var tblName = parts[0];
          var colName = parts[1];
          var rows = Array.isArray(addVals[fName]) ? addVals[fName] : (Array.isArray(addVals[tblName]) ? addVals[tblName] : null);

          if (rows && rows.length > 0) {
            var targetNorm = docEv.value != null ? String(docEv.value).toLowerCase().replace(/\s+/g, " ").trim() : "";
            var selectedRow = null;

            // 규칙 4 1순위: exact normalized match between evidence.value and row.value
            if (targetNorm) {
              for (var ri = 0; ri < rows.length; ri++) {
                var r = rows[ri];
                var cCandidate = (r && typeof r === "object" && colName in r) ? r[colName] : r;
                var cVal = (cCandidate && typeof cCandidate === "object")
                  ? (cCandidate._value != null ? cCandidate._value : cCandidate.value)
                  : cCandidate;
                if (cVal != null && String(cVal).toLowerCase().replace(/\s+/g, " ").trim() === targetNorm) {
                  selectedRow = cCandidate;
                  break;
                }
              }
            }

            // 규칙 4 2순위: fallback to first row
            if (!selectedRow) {
              var firstR = rows[0];
              selectedRow = (firstR && typeof firstR === "object" && colName in firstR) ? firstR[colName] : firstR;
            }

            matchedVal = selectedRow;
          }
        } else {
          // 규칙 2: 스칼라 필드 단일 객체 매핑
          matchedVal = addVals[fName];
        }
      }

      if (matchedVal) {
        var src = convertOcrLocationToBox(matchedVal);
        if (src) {
          docEv.source = src;
        }
      }

      if (isFilePresence) {
        var docNameStr = (matchedVal && (matchedVal._value || matchedVal.value)) || "구비됨";
        docEv.value = "present";
        crDocMap[docKey] = {
          field_name: "document_type",
          label: docNameStr,
          value: "present",
          source: docEv.source || null
        };
      } else {
        crDocMap[docKey] = {
          field_name: fName,
          value: docEv.value,
          source: docEv.source || null
        };
      }
    });

    generatedCheckResults.push({
      check_item: row.check_item,
      label: row.check_item_ko || row.check_item,
      documents: crDocMap
    });
  });

  // check_results가 없거나 비어있는 경우 자동 생성 주입
  if (!structuredResult.check_results || structuredResult.check_results.length === 0) {
    structuredResult.check_results = generatedCheckResults;
  }

  // 3. document_extract_evidence 순회 및 source 주입
  if (structuredResult.document_extract_evidence) {
    Object.keys(structuredResult.document_extract_evidence).forEach(function (docKey) {
      var docGroup = structuredResult.document_extract_evidence[docKey];
      if (!docGroup || typeof docGroup !== "object") return;
      var addVals = findDocAddVals(docKey);
      if (!addVals) return;

      Object.keys(docGroup).forEach(function (fKey) {
        var item = docGroup[fKey];
        if (!item) return;
        var fieldName = item.field_name || fKey;
        var matchedVal = addVals[fieldName] || addVals[fKey];
        if (matchedVal) {
          var src = convertOcrLocationToBox(matchedVal);
          if (src) item.source = src;
        }
      });
    });
  }
}

function normalizeResultPayload(parsed) {
  if (!parsed) return {};
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch (e) {
      return {};
    }
  }

  // Upstage Studio Agent include: ["all"] steps 또는 output 복합 응답 대응
  var stepsList = (parsed && Array.isArray(parsed.output)) ? parsed.output : ((parsed && Array.isArray(parsed.steps)) ? parsed.steps : null);
  if (stepsList && stepsList.length > 0) {
    var extractDocs = [];
    var instructStructured = null;
    var instructHumanSummary = null;

    for (var si = 0; si < stepsList.length; si++) {
      var st = stepsList[si];
      if (!st) continue;
      var mName = String(st.model || st.step_name || st.step_type || "").toLowerCase();

      // (a) instruct step 탐색
      if (mName.indexOf("instruct") >= 0 || (st.result && st.result.structured_result)) {
        if (st.result && st.result.structured_result) {
          instructStructured = st.result.structured_result;
          instructHumanSummary = st.result.human_summary;
        } else if (Array.isArray(st.content)) {
          for (var ci = 0; ci < st.content.length; ci++) {
            var cItem = st.content[ci];
            if (cItem && cItem.type === "output_text" && typeof cItem.text === "string") {
              try {
                var pInst = JSON.parse(cItem.text);
                if (pInst && pInst.structured_result) {
                  instructStructured = pInst.structured_result;
                  instructHumanSummary = pInst.human_summary;
                }
              } catch (e) {
                try {
                  var pInst2 = JSON.parse(cItem.text + "}");
                  if (pInst2 && pInst2.structured_result) {
                    instructStructured = pInst2.structured_result;
                    instructHumanSummary = pInst2.human_summary;
                  }
                } catch (e2) {}
              }
            }
          }
        }
      }

      // (b) extract step 탐색
      if (st.result && Array.isArray(st.result.documents)) {
        extractDocs = extractDocs.concat(st.result.documents);
      } else if (Array.isArray(st.content)) {
        for (var cj = 0; cj < st.content.length; cj++) {
          var cObj = st.content[cj];
          if (!cObj) continue;
          if (cObj.type === "output_text" && (cObj.additional_values || mName.indexOf("extract") >= 0)) {
            var pData = {};
            if (typeof cObj.text === "string") {
              try { pData = JSON.parse(cObj.text); } catch (e) {}
            }
            var pAv = {};
            if (cObj.additional_values) {
              if (typeof cObj.additional_values === "string") {
                try { pAv = JSON.parse(cObj.additional_values); } catch (e) {}
              } else if (typeof cObj.additional_values === "object") {
                pAv = cObj.additional_values;
              }
            }
            var sType = mName.replace(/^information extract\s*-\s*/i, "").replace(/_schema$/i, "").trim();
            var dType = pData.document_type || pAv.document_type || sType;
            if (dType || sType) {
              extractDocs.push({
                document_type: dType || sType,
                schema_name: sType,
                data: pData,
                additional_values: pAv
              });
            }
          }
        }
      }
    }

    if (instructStructured) {
      if (instructStructured.date_checks) {
        var misplacedKeys = ["comparison_matrix", "document_checklists", "discrepancy_candidates", "check_item_evidence", "document_extract_evidence", "checklist_results"];
        for (var mi = 0; mi < misplacedKeys.length; mi++) {
          var mKey = misplacedKeys[mi];
          if (instructStructured.date_checks[mKey] !== undefined && instructStructured[mKey] === undefined) {
            instructStructured[mKey] = instructStructured.date_checks[mKey];
            delete instructStructured.date_checks[mKey];
          }
        }
      }
      if (extractDocs.length > 0) {
        enrichEvidenceWithOcrCoordinates({ documents: extractDocs }, instructStructured);
      }
      if (instructHumanSummary && !instructStructured.human_summary) {
        instructStructured.human_summary = instructHumanSummary;
      }
      return enrichComparisonMatrix(instructStructured);
    }
  }

  var resolved = null;
  if (parsed && parsed.instruct_result) {
    resolved = parsed.instruct_result.structured_result || parsed.instruct_result;
  } else if (parsed && parsed.structured_result) {
    resolved = parsed.structured_result;
  } else if (parsed && parsed.content) {
    if (typeof parsed.content === "string") {
      try {
        var inner = JSON.parse(parsed.content);
        if (inner.instruct_result) {
          resolved = inner.instruct_result.structured_result || inner.instruct_result;
        } else {
          resolved = inner.structured_result || inner;
        }
      } catch (e) {}
    } else if (typeof parsed.content === "object") {
      if (parsed.content.instruct_result) {
        resolved = parsed.content.instruct_result.structured_result || parsed.content.instruct_result;
      } else {
        resolved = parsed.content.structured_result || parsed.content;
      }
    }
  }

  if (!resolved) resolved = parsed || {};
  return enrichComparisonMatrix(resolved);
}

function enrichComparisonMatrix(structured) {
  if (!structured) return structured;
  var rows = structured.comparison_matrix;
  if (!Array.isArray(rows) || rows.length === 0) return structured;

  var evidenceList = structured.check_item_evidence || structured.check_results || currentCheckItemEvidence || currentCheckResults || [];

  function isPresenceStatusWord(val) {
    if (!val) return false;
    var s = String(val).trim().toLowerCase();
    return s === "present" || s === "missing" || s === "not_available" || s === "n/a" ||
           s === "구비됨" || s === "미제출" || s === "미해당" || s === "있음" || s === "없음";
  }

  rows.forEach(function (row) {
    if (!row) return;
    if (!row.result && (row.status || row.judgment)) {
      row.result = row.status || row.judgment;
    }

    var itemKey = row.check_item || row.check_item_ko || row.label;
    var isFilePresence = itemKey === "file_presence" ||
                         itemKey === "required_documents_presence" ||
                         (row.check_item_ko && (row.check_item_ko.indexOf("서류 구비") >= 0 || row.check_item_ko.indexOf("서류구비") >= 0));

    // 🌟 사용자 코멘트 2 반영:
    // 서류 구비 현황(file_presence)은 문서 번호(Key No)나 일자가 아닌 "구비 여부(present / missing / not_available)"만 표시
    if (isFilePresence) {
      var dp = structured.document_presence || {};
      var docMapPresence = {
        commercial_invoice: dp.commercial_invoice !== false ? "present" : "missing",
        bill_of_lading: dp.bill_of_lading !== false ? "present" : "missing",
        packing_list: dp.packing_list !== false ? "present" : "missing",
        marine_cargo_insurance: dp.marine_cargo_insurance !== false ? "present" : "missing",
        certificate_of_origin: dp.certificate_of_origin ? "present" : "missing",
        lc: dp.lc ? "present" : "not_available"
      };

      Object.keys(docMapPresence).forEach(function (stdKey) {
        var cur = row[stdKey];
        if (!cur || !isPresenceStatusWord(cur)) {
          row[stdKey] = docMapPresence[stdKey];
        }
      });

      // 기타(도착통지서 등) 문서 구비 여부
      if (!row.other_document || !isPresenceStatusWord(row.other_document)) {
        if (currentActiveSampleIndex === 1 || currentActiveSampleIndex === 2 || (structured.date_checks && structured.date_checks.arrival_notice_date)) {
          row.other_document = "present";
        }
      }

      // file_presence 항목은 evidence의 Key No(송장번호, B/L번호 등)로 덮어쓰지 않고 즉시 반환
      return;
    }

    var ev = evidenceList.find(function (e) {
      if (!e) return false;
      return e.check_item === itemKey || e.label === itemKey || e.check_item_ko === itemKey;
    });

    if (ev && ev.documents) {
      var docMap = {
        lc: ["lc"],
        commercial_invoice: ["commercial_invoice", "invoice"],
        bill_of_lading: ["bill_of_lading", "bl"],
        packing_list: ["packing_list"],
        marine_cargo_insurance: ["marine_cargo_insurance", "insurance"],
        certificate_of_origin: ["certificate_of_origin", "coo"],
        other_document: ["other_document", "other", "arrival_notice"]
      };

      Object.keys(docMap).forEach(function (stdKey) {
        var aliases = docMap[stdKey];
        var currentVal = null;
        for (var i = 0; i < aliases.length; i++) {
          if (row[aliases[i]] !== undefined && row[aliases[i]] !== null && row[aliases[i]] !== "") {
            currentVal = row[aliases[i]];
            break;
          }
        }
        if (!currentVal) {
          for (var j = 0; j < aliases.length; j++) {
            var alias = aliases[j];
            if (ev.documents[alias] && hasMeaningfulValue(ev.documents[alias].value)) {
              row[stdKey] = ev.documents[alias].value;
              break;
            }
          }
        }
      });
    }
  });

  return structured;
}

function renderUsage(finalJob) {
  if (!els.usageCard) return;

  var usage = finalJob.usage;
  var stepName = (finalJob.output && finalJob.output[0] && finalJob.output[0].model) || finalJob.model || "Agent Job";

  if (usage || stepName) {
    els.usageCard.style.display = "block";
    els.usageStepName.textContent = stepName;
    els.usageInputTokens.textContent = (usage && usage.input_tokens != null) ? usage.input_tokens.toLocaleString() : "-";
    els.usageOutputTokens.textContent = (usage && usage.output_tokens != null) ? usage.output_tokens.toLocaleString() : "-";
    els.usageTotalTokens.textContent = (usage && usage.total_tokens != null) ? usage.total_tokens.toLocaleString() : "-";
  } else {
    els.usageCard.style.display = "none";
  }
}

function simplifyKeyName(rawKey) {
  if (!rawKey) return "";
  var k = String(rawKey).toLowerCase().trim();
  if (k === "lc_number" || k === "lc_no") return "LC_NO";
  if (k === "invoice_number" || k === "invoice_no" || k === "commercial_invoice_number") return "INV_NO";
  if (k === "bl_number" || k === "bl_no" || k === "bill_of_lading_number") return "BL_NO";
  if (k === "policy_certificate_number" || k === "insurance_policy_number" || k === "insurance_number") return "INS_NO";
  if (k === "certificate_number" || k === "coo_number" || k === "coo_no") return "COO_NO";

  return k.replace(/_number$/, "_no").replace(/_no$/, "_NO").toUpperCase();
}

function renderDocumentKeys(documentKeys) {
  var html = "";
  var key;
  var displayKey;
  var cleanedVal;

  if (!documentKeys || typeof documentKeys !== "object") {
    els.documentKeys.innerHTML = "결과 없음";
    return;
  }

  for (key in documentKeys) {
    if (Object.prototype.hasOwnProperty.call(documentKeys, key)) {
      cleanedVal = cleanText(documentKeys[key]);
      displayKey = simplifyKeyName(key);
      html += '<div class="kv-item clickable-key" data-key="' + escapeHtml(key) + '" title="클릭하여 원본 서류의 해당 번호 위치로 이동 및 하이라이트">';
      html += '<span class="kv-key">' + escapeHtml(displayKey) + ':</span>';
      html += '<span class="kv-value">' + escapeHtml(cleanedVal || "-") + "</span>";
      html += "</div>";
    }
  }

  els.documentKeys.innerHTML = html || "결과 없음";

  var items = els.documentKeys.querySelectorAll(".clickable-key");
  items.forEach(function (el) {
    el.addEventListener("click", function () {
      var k = this.getAttribute("data-key");
      openDocViewerWithField(k);
    });
  });
}

function renderDateTimeline(dateChecks) {
  if (!els.dateTimeline) return;

  var items = [
    { key: "insurance_policy_issue_date", label: "Insurance Issue" },
    { key: "invoice_date", label: "Invoice" },
    { key: "packing_list_date", label: "Packing List" },
    { key: "bl_shipment_date", label: "B/L Shipment" },
    { key: "bl_on_board_date", label: "B/L On Board" },
    { key: "latest_shipment_date", label: "Latest Shipment" },
    { key: "lc_issue_date", label: "LC Issue" },
    { key: "certificate_issue_date", label: "COO Issue" }
  ];

  var html = "";
  var i;
  var item;
  var value;
  var statusClass = "badge-neutral";
  var noteThemeClass = "timeline-note-neutral";
  var cleanedNotes = "";
  var headerBadgeEl = document.getElementById("timelineHeaderBadge");

  if (!dateChecks || typeof dateChecks !== "object") {
    els.dateTimeline.innerHTML = "결과 없음";
    if (headerBadgeEl) headerBadgeEl.innerHTML = "";
    return;
  }

  var st = String(dateChecks.date_sequence_status || "").toLowerCase();
  if (
    st.indexOf("일치") >= 0 ||
    st.indexOf("구비") >= 0 ||
    st === "match" ||
    st === "ok" ||
    st === "pass"
  ) {
    statusClass = "badge-ok";
    noteThemeClass = "timeline-note-ok";
  } else if (
    st.indexOf("불일치") >= 0 ||
    st.indexOf("보류") >= 0 ||
    st === "mismatch" ||
    st === "fail"
  ) {
    statusClass = "badge-crit";
    noteThemeClass = "timeline-note-crit";
  } else if (
    st.indexOf("검토") >= 0 ||
    st.indexOf("주의") >= 0 ||
    st.indexOf("확인") >= 0 ||
    st === "missing" ||
    st === "unclear" ||
    st === "warn"
  ) {
    statusClass = "badge-warn";
    noteThemeClass = "timeline-note-warn";
  }

  if (headerBadgeEl) {
    headerBadgeEl.innerHTML =
      '<span class="badge ' +
      statusClass +
      '"><i class="bi bi-shield-check"></i> 종합 판정: ' +
      escapeHtml(koreanStatus(dateChecks.date_sequence_status)) +
      "</span>";
  }

  cleanedNotes = cleanText(dateChecks.date_sequence_notes || "날짜 흐름 설명 없음");

  if (cleanedNotes) {
    html += '<div class="timeline-note-box ' + noteThemeClass + '">';
    html += '<div>' + escapeHtml(cleanedNotes) + '</div>';
    html += '</div>';
  }

  html += '<div class="doc-comparison-grid">';

  for (i = 0; i < items.length; i += 1) {
    item = items[i];
    value = cleanText(dateChecks[item.key] || "");
    if (!value) {
      continue;
    }

    html += '<div class="doc-box">';
    html += '<div class="doc-box-label">' + escapeHtml(item.label) + '</div>';
    html += '<div class="doc-box-val">' + escapeHtml(value) + '</div>';
    html += '</div>';
  }

  html += '</div>';

  els.dateTimeline.innerHTML = html || "날짜 정보 없음";
}

/**
 * Code.md v5 Contract:
 * comparison_matrix의 셀 표시 및 check_item_evidence 기반 하이라이트 여부 판별 헬퍼
 * - 값은 있으나 위치가 없는 경우(source.page <= 0 등): 값 표시, 클릭 비활성화, "원문 위치 정보 없음"
 * - 문서 슬롯 자체가 없는 경우: "해당 문서 근거 없음"
 * - check_item_evidence가 있는 최신 응답: canHighlight 여부에 따라 셀 스타일 및 툴팁 분기
 * - 레거시 샘플(check_item_evidence 없음): 기존 정적 레지스트리 기반 클릭 지원
 */
function hasMeaningfulValue(val) {
  if (val === null || val === undefined) return false;
  var s = String(val).trim();
  return s !== "" && s !== "-" && s !== "미기재" && s !== "null" && s !== "undefined";
}

function isNegationOrStatusValue(val) {
  if (!val) return false;
  var s = String(val).trim().toLowerCase();
  return s === "미해당" || s === "n/a" || s === "not_available" || s === "미제출" || s === "missing";
}

function buildComparisonCellInfo(itemKey, docKey, docTitle, rawVal) {
  var evidenceDoc = getEvidence(itemKey, docKey);
  var hasEvidenceData = (currentCheckResults && currentCheckResults.length > 0) || (currentCheckItemEvidence && currentCheckItemEvidence.length > 0);

  var rawHas = hasMeaningfulValue(rawVal);
  var evHas = evidenceDoc && hasMeaningfulValue(evidenceDoc.value);
  var effectiveVal = rawHas ? rawVal : (evHas ? evidenceDoc.value : null);

  // 1. If neither matrix rawVal nor evidence has any meaningful value
  if (!hasMeaningfulValue(effectiveVal)) {
    return {
      canClick: false,
      cellClass: "non-clickable-cell no-evidence empty-cell",
      tooltip: docTitle + ": 해당 항목 기재 없음",
      htmlVal: formatTableCellHtml("-")
    };
  }

  // 2. Explicit negation or presence status (미해당, 미제출)
  if (isNegationOrStatusValue(effectiveVal)) {
    return {
      canClick: false,
      cellClass: "non-clickable-cell no-evidence",
      tooltip: docTitle + ": " + formatDocValue(effectiveVal),
      htmlVal: formatTableCellHtml(effectiveVal)
    };
  }

  // 3. Highlightable evidence with valid BBox
  var isCorrupted = String(effectiveVal).indexOf("?") >= 0;
  if (hasEvidenceData) {
    if (evidenceDoc && canHighlight(evidenceDoc, docKey, itemKey)) {
      var targetInfo = getEvidenceTarget(currentActiveSampleIndex || 1, docKey, evidenceDoc, itemKey);
      var pNum = (targetInfo && targetInfo.page) ? targetInfo.page : 1;
      var tip = isCorrupted
        ? "클릭 시 " + docTitle + " 위치 확인 (p." + pNum + ") [판독 주의]"
        : "클릭 시 " + docTitle + " 위치 확인 (p." + pNum + ")";
      return {
        canClick: true,
        cellClass: "clickable-cell has-evidence" + (isCorrupted ? " cell-ocr-warn" : ""),
        tooltip: tip,
        htmlVal: formatTableCellHtml(effectiveVal)
      };
    } else {
      return {
        canClick: false,
        cellClass: "non-clickable-cell no-location" + (isCorrupted ? " cell-ocr-warn" : ""),
        tooltip: "원문 위치 정보 없음 (값: " + effectiveVal + ")",
        htmlVal: formatTableCellHtml(effectiveVal)
      };
    }
  }

  return {
    canClick: true,
    cellClass: "clickable-cell",
    tooltip: "클릭 시 " + docTitle + " 위치 확인",
    htmlVal: formatTableCellHtml(effectiveVal)
  };
}

function renderComparisonTable(rows) {
  var html = "";
  var cardsHtml = "";

  if (!rows || !rows.length) {
    if (els.comparisonTableBody) {
      els.comparisonTableBody.innerHTML = '<div class="empty-cell">비교표 데이터가 없습니다.</div>';
    }
    if (els.comparisonCardsContainer) {
      els.comparisonCardsContainer.innerHTML = '<div class="empty-cell">비교표 데이터가 없습니다.</div>';
    }
    return;
  }

  /* Group rows by category */
  var categoryMap = {};
  var categoryOrder = [];

  var hasOtherDoc = rows.some(function (r) {
    return r && r.other_document !== undefined && r.other_document !== null && r.other_document !== "" && r.other_document !== "-";
  }) || (currentActiveSampleIndex === 1 || currentActiveSampleIndex === 2);

  var catIcons = {
    "서류 구비 현황": '<i class="bi bi-folder2-open"></i>',
    "당사자 정보": '<i class="bi bi-people-fill"></i>',
    "물품 및 조건": '<i class="bi bi-box-seam-fill"></i>',
    "식별번호": '<i class="bi bi-hash"></i>',
    "날짜 및 선적": '<i class="bi bi-calendar-range-fill"></i>'
  };

  rows.forEach(function (row) {
    var cat = row.category || "기타 검토 항목";
    if (!categoryMap[cat]) {
      categoryMap[cat] = [];
      categoryOrder.push(cat);
    }
    categoryMap[cat].push(row);
  });

  categoryOrder.forEach(function (catName) {
    var catRows = categoryMap[catName];
    var icon = catIcons[catName] || "📌";

    var matchCount = 0;
    var warnCount = 0;
    var critCount = 0;

    catRows.forEach(function (r) {
      var res = String(r.result || r.status || r.judgment || "").toLowerCase();
      if (
        res.indexOf("불일치") >= 0 ||
        res === "mismatch" ||
        res === "missing" ||
        res === "fail"
      ) {
        critCount += 1;
      } else if (
        res.indexOf("검토") >= 0 ||
        res === "review_required" ||
        res === "unclear" ||
        res === "warn"
      ) {
        warnCount += 1;
      } else if (
        res.indexOf("일치") >= 0 ||
        res.indexOf("구비") >= 0 ||
        res === "match" ||
        res === "ok" ||
        res === "pass" ||
        res === "present"
      ) {
        matchCount += 1;
      }
    });

    var summaryBadgeHtml = "";
    if (critCount > 0) {
      summaryBadgeHtml += '<span class="badge badge-crit">불일치 ' + critCount + '</span> ';
    }
    if (warnCount > 0) {
      summaryBadgeHtml += '<span class="badge badge-warn">검토필요 ' + warnCount + '</span> ';
    }
    if (matchCount > 0) {
      summaryBadgeHtml += '<span class="badge badge-ok">일치 ' + matchCount + '</span>';
    }

    /* Category Table Block (Table View - Nested Group Container) */
    html += '<div class="category-table-block">';
    html += '<div class="category-block-header">';
    html += '<div class="group-header-title">';
    html += '<span class="group-icon">' + icon + '</span> ';
    html += '<strong>' + escapeHtml(catName) + '</strong> ';
    html += '<span class="group-count">(' + catRows.length + '개 항목)</span>';
    html += '</div>';
    html += '<div class="group-header-badges">' + summaryBadgeHtml + '</div>';
    html += '</div>';

    var colWidth = hasOtherDoc ? "10.28%" : "11.83%";
    var itemWidth = hasOtherDoc ? "20%" : "21%";

    html += '<table class="data-table">';
    html += '<thead>';
    html += '<tr class="group-subheader-row">';
    html += '<th class="col-item" style="width: ' + itemWidth + ';"><i class="bi bi-card-checklist"></i> 검토 항목</th>';
    html += '<th class="col-result" style="width: 8%;"><i class="bi bi-shield-check"></i> 결과</th>';
    html += '<th class="col-doc col-lc" style="width: ' + colWidth + ';"><i class="bi bi-file-earmark-text"></i> L/C</th>';
    html += '<th class="col-doc col-inv" style="width: ' + colWidth + ';"><i class="bi bi-receipt"></i> 송장</th>';
    html += '<th class="col-doc col-bl" style="width: ' + colWidth + ';"><i class="bi bi-water"></i> B/L</th>';
    html += '<th class="col-doc col-pk" style="width: ' + colWidth + ';"><i class="bi bi-box-seam"></i> 포장</th>';
    html += '<th class="col-doc col-ins" style="width: ' + colWidth + ';"><i class="bi bi-shield-check"></i> 보험</th>';
    html += '<th class="col-doc col-coo" style="width: ' + colWidth + ';"><i class="bi bi-bank"></i> COO</th>';
    if (hasOtherDoc) {
      html += '<th class="col-doc col-other" style="width: ' + colWidth + ';"><i class="bi bi-bell-fill"></i> 기타(통지)</th>';
    }
    html += '</tr>';
    html += '</thead>';
    html += '<tbody>';

    /* Category Cards Section (Card View - Grid Layout) */
    cardsHtml += '<div class="card-category-section">';
    cardsHtml += '<div class="mobile-group-header">';
    cardsHtml += '<div class="mobile-group-title">';
    cardsHtml += '<span class="group-icon">' + icon + '</span> ';
    cardsHtml += '<strong>' + escapeHtml(catName) + '</strong> ';
    cardsHtml += '<span class="group-count">(' + catRows.length + '개 항목)</span>';
    cardsHtml += '</div>';
    cardsHtml += '<div class="group-header-badges">' + summaryBadgeHtml + '</div>';
    cardsHtml += '</div>';
    cardsHtml += '<div class="card-category-grid">';

    /* Member Rows & Mobile Cards */
    catRows.forEach(function (row) {
      var rowResult = row.result || row.status || row.judgment || "";
      var rowClass = rowHighlightClass(rowResult);
      var itemTitle = row.check_item_ko || row.check_item || "-";

      var docCols = [
        { key: "lc", label: "L/C", title: "L/C", val: row.lc },
        { key: "invoice", label: "송장", title: "상업송장", val: row.commercial_invoice || row.invoice },
        { key: "bl", label: "B/L", title: "선하증권(B/L)", val: row.bill_of_lading || row.bl },
        { key: "packing_list", label: "포장", title: "포장명세서", val: row.packing_list },
        { key: "insurance", label: "보험", title: "해상보험증권", val: row.marine_cargo_insurance || row.insurance },
        { key: "coo", label: "COO", title: "원산지증명서", val: row.certificate_of_origin || row.coo }
      ];
      if (hasOtherDoc) {
        docCols.push({ key: "other_document", label: "기타(통지)", title: "기타서류(도착통지서 등)", val: row.other_document });
      }

      // Table Row
      html += '<tr class="' + rowClass + '">';
      html += '<td><strong class="item-title-cell">' + escapeHtml(cleanText(itemTitle)) + '</strong></td>';
      html += '<td class="' + resultCellClass(rowResult) + '">' + escapeHtml(koreanStatus(rowResult)) + '</td>';

      docCols.forEach(function (d) {
        var cInfo = buildComparisonCellInfo(row.check_item, d.key, d.title, d.val);
        html += '<td class="' + cInfo.cellClass + '" data-check-item="' + escapeHtml(row.check_item) + '" data-doc="' + d.key + '" title="' + escapeHtml(cInfo.tooltip) + '">' + cInfo.htmlVal + '</td>';
      });

      html += '</tr>';

      // Mobile Card Item
      cardsHtml += '<div class="mobile-matrix-card ' + rowClass + '">';
      cardsHtml += '<div class="mobile-card-top">';
      cardsHtml += '<span class="mobile-card-title">' + escapeHtml(cleanText(itemTitle)) + '</span>';
      cardsHtml += '<span class="' + badgeClass(rowResult) + '">' + escapeHtml(koreanStatus(rowResult)) + '</span>';
      cardsHtml += '</div>';
      cardsHtml += '<div class="mobile-card-doc-grid">';

      docCols.forEach(function (d) {
        var cInfo = buildComparisonCellInfo(row.check_item, d.key, d.label, d.val);
        cardsHtml += '<div class="mobile-doc-item ' + cInfo.cellClass + '" data-check-item="' + escapeHtml(row.check_item) + '" data-doc="' + d.key + '" title="' + escapeHtml(cInfo.tooltip) + '">';
        cardsHtml += '<span class="mobile-doc-tag">' + escapeHtml(d.label) + '</span>';
        cardsHtml += '<div class="mobile-doc-val-wrap">' + cInfo.htmlVal + '</div>';
        cardsHtml += '</div>';
      });

      cardsHtml += '</div>';
      cardsHtml += '</div>';
    });

    html += '</tbody>';
    html += '</table>';
    html += '</div>'; // close category-table-block

    cardsHtml += '</div>'; // close card-category-grid
    cardsHtml += '</div>'; // close card-category-section
  });

  if (els.comparisonTableBody) {
    els.comparisonTableBody.innerHTML = html;
  }
  if (els.comparisonCardsContainer) {
    els.comparisonCardsContainer.innerHTML = cardsHtml;
  }

  // Bind click listeners for table & card cells
  var allDocCells = document.querySelectorAll(".data-table td[data-check-item], .mobile-matrix-card .mobile-doc-item[data-check-item]");
  allDocCells.forEach(function (c) {
    c.addEventListener("click", function () {
      if (this.classList.contains("non-clickable-cell") || this.classList.contains("empty-cell") || this.classList.contains("no-evidence") || this.classList.contains("no-location")) {
        return;
      }
      var itemKey = this.getAttribute("data-check-item");
      var doc = this.getAttribute("data-doc");
      openDocViewerWithCheckItem(itemKey, doc);
    });
  });
}

/* Render Per-Document Checklist Tabs & Content */
function selectChecklistTab(docKey) {
  if (!currentChecklistData || !currentChecklistData[docKey]) return;

  activeChecklistTab = docKey;

  // Update tab buttons active state
  var buttons = els.checklistTabs.querySelectorAll(".tab-btn");
  buttons.forEach(function (btn) {
    if (btn.getAttribute("data-key") === docKey) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Render checklist items
  var items = currentChecklistData[docKey];
  var html = "";
  var i;
  var item;
  var statusBadge = "badge-neutral";

  if (!items || !items.length) {
    els.checklistContent.innerHTML = '<div class="empty-cell">해당 서류의 체크리스트 항목이 없습니다.</div>';
    return;
  }

  for (i = 0; i < items.length; i += 1) {
    item = items[i];
    statusBadge = badgeClass(item.status);

    html += '<div class="checklist-item">';
    html += '<div>';
    html += '<div class="checklist-item-title">' + escapeHtml(cleanText(item.item || item.title || "점검 항목")) + '</div>';
    if (item.details || item.desc) {
      html += '<div class="checklist-item-details">' + escapeHtml(cleanText(item.details || item.desc)) + '</div>';
    }
    html += '</div>';
    html += '<div><span class="' + statusBadge + '">' + escapeHtml(koreanStatus(item.status)) + '</span></div>';
    html += '</div>';
  }

  els.checklistContent.innerHTML = html;
}

function renderChecklists(documentChecklists) {
  if (!els.checklistTabs || !els.checklistContent) return;

  if (!documentChecklists || typeof documentChecklists !== "object" || Object.keys(documentChecklists).length === 0) {
    if (currentCheckResults && currentCheckResults.length > 0) {
      var generatedChecklists = {};
      currentCheckResults.forEach(function (cr) {
        if (!cr || !cr.documents) return;
        Object.keys(cr.documents).forEach(function (docKey) {
          var docItem = cr.documents[docKey];
          if (!docItem || (docItem.value === null && docItem.field_name === null)) return;
          if (!generatedChecklists[docKey]) {
            generatedChecklists[docKey] = [];
          }
          var valStr = (docItem.value !== null && docItem.value !== undefined) ? String(docItem.value) : '';
          var msgStr = cr.message ? ' (' + cr.message + ')' : '';
          var finalDetails = valStr ? (valStr + msgStr) : (cr.message || '');
          generatedChecklists[docKey].push({
            item: cr.label || cr.check_item,
            status: cr.status,
            details: finalDetails,
            confidence: docItem.confidence
          });
        });
      });
      if (Object.keys(generatedChecklists).length > 0) {
        documentChecklists = generatedChecklists;
      }
    }
  }

  if (!documentChecklists || typeof documentChecklists !== "object" || Object.keys(documentChecklists).length === 0) {
    els.checklistTabs.innerHTML = "";
    els.checklistContent.innerHTML = '<div class="empty-cell">서류별 체크리스트 데이터가 없습니다.</div>';
    return;
  }

  currentChecklistData = documentChecklists;

  var docLabels = {
    lc: "L/C 신용장",
    invoice: "상업송장 (INV)",
    commercial_invoice: "상업송장 (INV)",
    bl: "선하증권 (B/L)",
    bill_of_lading: "선하증권 (B/L)",
    packing_list: "포장명세서 (PK)",
    insurance: "해상보험 (INS)",
    marine_cargo_insurance: "해상보험 (INS)",
    coo: "원산지증명 (COO)",
    certificate_of_origin: "원산지증명 (COO)",
    other_document: "도착통지서 등 (NOTICE)"
  };

  var tabsHtml = "";
  var keys = Object.keys(documentChecklists);
  var firstKey = keys[0];

  keys.forEach(function (key) {
    var items = documentChecklists[key] || [];
    var label = docLabels[key] || (key.toUpperCase() + " 서류");
    
    var critCount = 0;
    var warnCount = 0;
    var passCount = 0;

    items.forEach(function (it) {
      var st = String(it.status || "").toLowerCase();
      if (st === "fail" || st === "crit" || st === "mismatch" || st === "missing" || st.indexOf("불일치") >= 0) {
        critCount += 1;
      } else if (st === "warning" || st === "warn" || st === "review_required" || st === "unclear" || st.indexOf("검토") >= 0) {
        warnCount += 1;
      } else if (st === "pass" || st === "ok" || st === "match" || st.indexOf("일치") >= 0) {
        passCount += 1;
      }
    });

    var tabClass = "tab-btn-neutral";

    if (critCount > 0) {
      tabClass = "tab-btn-crit";
    } else if (warnCount > 0) {
      tabClass = "tab-btn-warn";
    } else if (passCount > 0) {
      tabClass = "tab-btn-ok";
    }

    tabsHtml += '<button type="button" class="tab-btn ' + tabClass + '" data-key="' + escapeHtml(key) + '">';
    tabsHtml += '<span class="tab-label">' + escapeHtml(label) + '</span>';
    tabsHtml += '</button>';
  });

  els.checklistTabs.innerHTML = tabsHtml;

  // Bind tab click events
  var buttons = els.checklistTabs.querySelectorAll(".tab-btn");
  buttons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var k = this.getAttribute("data-key");
      selectChecklistTab(k);
    });
  });

  // Select first tab default
  selectChecklistTab(firstKey);
}

function renderResult(parsed, finalJob) {
  var rawSource = parsed || finalJob;
  var data = normalizeResultPayload(rawSource);
  var rows = [];
  var overall = String(data.overall_status || "").toLowerCase();
  var alertLvl = String(data.overall_alert_level || "").toLowerCase();

  // 방법 B (Normalizer Lookup) 지원: data.check_results (자동 생성 포함) 우선 저장
  currentCheckResults = (data && Array.isArray(data.check_results) && data.check_results.length > 0)
    ? data.check_results
    : ((parsed && Array.isArray(parsed.check_results)) ? parsed.check_results : []);

  var structured = (data && data.comparison_matrix)
    ? data
    : ((parsed && parsed.instruct_result && parsed.instruct_result.structured_result)
      || (parsed && parsed.structured_result)
      || data);

  currentCheckItemEvidence = (data && Array.isArray(data.check_item_evidence))
    ? data.check_item_evidence
    : ((structured && Array.isArray(structured.check_item_evidence))
      ? structured.check_item_evidence
      : []);

  currentRawPayload = finalJob || parsed;
  els.rawJson.textContent = JSON.stringify(currentRawPayload, null, 2);

  /* Hide upper duplicated pills, keep only bottom description status badge */
  if (els.overallStatus) els.overallStatus.style.display = "none";
  if (els.alertLevel) els.alertLevel.style.display = "none";

  /* Render Single Korean Status Highlight & Full Card Background Theme */
  if (overall === "review_required" || overall === "검토 필요") {
    els.overallStatusDesc.innerHTML = '<span class="desc-status-highlight warn">진행 전 추가 검토 필요</span>';
    applyCardTheme(els.overallStatusCard, "card-theme-warn");
    applyCardTheme(els.recommendedActionCard, "card-theme-warn");
  } else if (overall === "proceed" || overall === "진행 가능") {
    els.overallStatusDesc.innerHTML = '<span class="desc-status-highlight ok">서류 일치 (진행 가능)</span>';
    applyCardTheme(els.overallStatusCard, "card-theme-ok");
    applyCardTheme(els.recommendedActionCard, "card-theme-ok");
  } else if (overall === "on_hold" || overall === "보류") {
    els.overallStatusDesc.innerHTML = '<span class="desc-status-highlight crit">불일치 발생 (보류)</span>';
    applyCardTheme(els.overallStatusCard, "card-theme-crit");
    applyCardTheme(els.recommendedActionCard, "card-theme-crit");
  } else {
    els.overallStatusDesc.innerHTML = '<span class="desc-status-highlight">' + escapeHtml(cleanText(data.overall_status) || "결과 확인") + '</span>';
    applyCardTheme(els.overallStatusCard, "card-theme-neutral");
    applyCardTheme(els.recommendedActionCard, "card-theme-neutral");
  }

  /* Render Single Korean Alert Level Highlight & Full Card Background Theme */
  if (alertLvl === "critical" || alertLvl === "치명") {
    els.alertLevelDesc.innerHTML = '<span class="desc-status-highlight crit">치명 이슈 포함</span>';
    applyCardTheme(els.alertLevelCard, "card-theme-crit");
  } else if (alertLvl === "warning" || alertLvl === "warn" || alertLvl === "주의") {
    els.alertLevelDesc.innerHTML = '<span class="desc-status-highlight warn">주의 필요</span>';
    applyCardTheme(els.alertLevelCard, "card-theme-warn");
  } else if (alertLvl === "info" || alertLvl === "참고") {
    els.alertLevelDesc.innerHTML = '<span class="desc-status-highlight ok">참고 수준</span>';
    applyCardTheme(els.alertLevelCard, "card-theme-ok");
  } else {
    els.alertLevelDesc.innerHTML = '<span class="desc-status-highlight">' + escapeHtml(cleanText(data.overall_alert_level) || "결과 확인") + '</span>';
    applyCardTheme(els.alertLevelCard, "card-theme-neutral");
  }

  // human_summary 지원 (instruct_result.human_summary, parsed.human_summary 또는 structured.human_summary 우선)
  var summaryText = (parsed && parsed.instruct_result && parsed.instruct_result.human_summary)
    || (parsed && parsed.human_summary)
    || (structured && structured.human_summary)
    || cleanText(data.one_line_summary)
    || "-";
  els.oneLineSummary.textContent = summaryText;
  els.recommendedAction.textContent = cleanText(data.recommended_action) || "-";

  if (finalJob) {
    renderUsage(finalJob);
  }

  renderDocumentKeys(data.document_keys);
  renderDateTimeline(data.date_checks);
  if (structured) enrichComparisonMatrix(structured);
  if (data) enrichComparisonMatrix(data);
  rows = (structured && structured.comparison_matrix) || data.comparison_matrix || [];
  renderComparisonTable(rows);
  renderChecklists(data.document_checklists || (structured && (structured.checklist_results || structured.document_checklists)));
}

function loadConfig() {
  var v = getCacheBuster();

  return fetch("./config.json?v=" + encodeURIComponent(v), {
    cache: "no-store"
  })
    .then(function (res) {
      if (!res.ok) {
        throw new Error("config.json 로드 실패");
      }
      return res.json();
    })
    .then(function (json) {
      CONFIG = json;
      if (CONFIG.defaultApiKey && !els.apiKey.value) {
        els.apiKey.value = CONFIG.defaultApiKey;
      }
      if (CONFIG.workerUrl && els.workerUrl) {
        els.workerUrl.value = CONFIG.workerUrl;
      }
      if (CONFIG.configId && els.configId) {
        els.configId.value = CONFIG.configId;
      } else if (els.configId && !els.configId.value) {
        els.configId.value = "11";
      }
    });
}

function sanitizeUploadFilename(file) {
  var filename = (file && typeof file.name === "string") ? file.name : "";
  var mimeType = (file && typeof file.type === "string") ? file.type.toLowerCase() : "";
  
  var ext = "";
  if (filename) {
    var match = filename.match(/\.([a-zA-Z0-9]+)$/);
    if (match) ext = match[1].toLowerCase();
  }
  
  if (!ext) {
    if (mimeType.indexOf("pdf") >= 0) ext = "pdf";
    else if (mimeType.indexOf("jpeg") >= 0 || mimeType.indexOf("jpg") >= 0) ext = "jpg";
    else if (mimeType.indexOf("png") >= 0) ext = "png";
    else if (mimeType.indexOf("tiff") >= 0) ext = "tiff";
    else ext = "pdf";
  }

  var baseName = filename ? filename.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_") : "document";
  baseName = baseName.replace(/_+/g, "_").slice(0, 30);
  if (!baseName || baseName === "_") {
    baseName = "document_" + Date.now();
  }
  return baseName + "." + ext;
}

function uploadFile(apiKey, file) {
  if (!file || !(file instanceof Blob)) {
    return Promise.reject(new Error("업로드할 파일 객체가 유효하지 않습니다. 파일을 다시 선택해주세요."));
  }

  var safeFilename = sanitizeUploadFilename(file);
  var createForm = function () {
    var form = new FormData();
    try {
      var safeFile = new File([file], safeFilename, { type: file.type || "application/octet-stream" });
      form.append("file", safeFile);
    } catch (e) {
      form.append("file", file, safeFilename);
    }
    form.append("purpose", (CONFIG && CONFIG.filePurpose) || "user_data");
    return form;
  };

  var endpoint = getApiEndpoint("/files");

  var doFetch = function () {
    return fetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: {
        Authorization: "Bearer " + apiKey
      },
      body: createForm()
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          var parsedMsg = text;
          try {
            var j = JSON.parse(text);
            if (j.error && j.error.message) parsedMsg = j.error.message;
            else if (j.message) parsedMsg = j.message;
          } catch (_) {}
          throw new Error("파일 업로드 실패 (HTTP " + res.status + "): " + parsedMsg);
        });
      }
      return res.json();
    });
  };

  return doFetch().catch(function (primaryErr) {
    var msg = String(primaryErr.message || "");
    if (msg.indexOf("HTTP ") >= 0) {
      throw primaryErr;
    }

    console.warn("파일 업로드 1차 실패, 1.5초 후 재시도:", primaryErr);
    setStatus("네트워크 지연 감지, 파일 업로드 재시도 중...", safeFilename);
    return wait(1500).then(function () {
      return doFetch();
    }).catch(function (retryErr) {
      console.error("파일 업로드 최종 실패:", retryErr);
      var retryMsg = String(retryErr.message || "");
      if (retryMsg.indexOf("Failed to fetch") >= 0 || retryMsg.indexOf("NetworkError") >= 0) {
        throw new Error(
          "프록시 서버(" + (els.workerUrl ? els.workerUrl.value : "") + ")에 연결할 수 없습니다. " +
          "모바일 Wi-Fi/데이터 연결 상태를 확인하시거나 상단의 [캐시 새로고침]을 눌러주세요."
        );
      }
      throw retryErr;
    });
  });
}

function validateUploadedFile(uploaded) {
  if (!uploaded || !uploaded.id) {
    throw new Error("업로드 응답에 file id가 없습니다.");
  }
  return uploaded;
}

function createJob(apiKey, fileId, configId) {
  var body = {
    model: (CONFIG && CONFIG.agentId) || "agt_hYy33EbPU93zggAb6W9z3G",
    include: ["all"],
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_file",
            file_id: fileId
          }
        ]
      }
    ]
  };

  var effectiveConfigId = configId || (CONFIG && CONFIG.configId) || "11";
  if (effectiveConfigId) {
    body.config_id = effectiveConfigId;
  }

  var endpoint = getApiEndpoint("/responses");
  var jsonBody = JSON.stringify(body);

  var doFetch = function () {
    return fetch(endpoint, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: {
        Authorization: "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: jsonBody
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (text) {
          var parsedMsg = text;
          try {
            var j = JSON.parse(text);
            if (j.error && j.error.message) parsedMsg = j.error.message;
            else if (j.message) parsedMsg = j.message;
          } catch (_) {}
          throw new Error("Job 생성 실패 (HTTP " + res.status + "): " + parsedMsg);
        });
      }
      return res.json();
    });
  };

  return doFetch().catch(function (primaryErr) {
    var msg = String(primaryErr.message || "");
    if (msg.indexOf("HTTP ") >= 0) {
      throw primaryErr;
    }
    console.warn("Job 생성 1차 실패, 재시도 중:", primaryErr);
    return wait(1500).then(function () {
      return doFetch();
    });
  });
}

function getJob(apiKey, jobId) {
  var queryPath = "/responses/" + encodeURIComponent(jobId) + "?include[]=all";
  var endpoint = getApiEndpoint(queryPath);

  return fetch(endpoint, {
    method: "GET",
    mode: "cors",
    credentials: "omit",
    headers: {
      Authorization: "Bearer " + apiKey
    }
  }).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (text) {
        var parsedMsg = text;
        try {
          var j = JSON.parse(text);
          if (j.error && j.error.message) parsedMsg = j.error.message;
          else if (j.message) parsedMsg = j.message;
        } catch (_) {}
        throw new Error("Job 상태 조회 실패 (HTTP " + res.status + "): " + parsedMsg);
      });
    }
    return res.json();
  });
}

function wait(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

function pollJob(apiKey, jobId) {
  var consecutiveErrors = 0;
  var maxConsecutiveErrors = 4;

  return new Promise(function (resolve, reject) {
    function loop() {
      getJob(apiKey, jobId)
        .then(function (job) {
          consecutiveErrors = 0;
          setStatus("실행 상태: " + (job.status || "진행 중"), "job_id=" + job.id);

          if (job.status === "completed" || job.status === "failed") {
            resolve(job);
            return;
          }

          wait((CONFIG && CONFIG.pollIntervalMs) || 2500).then(loop);
        })
        .catch(function (err) {
          consecutiveErrors++;
          console.warn("Job 조회 일시 실패 (" + consecutiveErrors + "/" + maxConsecutiveErrors + "):", err);
          if (consecutiveErrors < maxConsecutiveErrors) {
            setStatus("네트워크 일시 재연결 시도 중 (" + consecutiveErrors + "/" + maxConsecutiveErrors + ")", "job_id=" + jobId);
            wait(3000).then(loop);
          } else {
            reject(err);
          }
        });
    }

    loop();
  });
}

function extractResultText(finalJob) {
  if (!finalJob) return null;

  // 0) steps 또는 output 배열이 여러 단계인 Agent 풀 워크플로우 응답 (include: ["all"])
  if ((Array.isArray(finalJob.steps) && finalJob.steps.length > 0) || (Array.isArray(finalJob.output) && finalJob.output.length > 1)) {
    return finalJob;
  }

  // 1) output_text (최신 Studio Agent shortcut)
  if (finalJob.output_text) {
    return finalJob.output_text;
  }

  // 2) content (sample1, sample2 등 래핑 응답 대응)
  if (finalJob.content) {
    return finalJob.content;
  }

  // 3) structured_result가 최상위에 직접 있는 경우
  if (finalJob.structured_result || finalJob.instruct_result || finalJob.check_results) {
    return finalJob.structured_result || finalJob;
  }

  // 4) output 배열 순회
  if (finalJob.output && Array.isArray(finalJob.output) && finalJob.output.length > 0) {
    for (var i = finalJob.output.length - 1; i >= 0; i--) {
      var item = finalJob.output[i];
      if (item && Array.isArray(item.content)) {
        for (var j = 0; j < item.content.length; j++) {
          var c = item.content[j];
          if (c && c.text) return c.text;
          if (c && c.output_text) return c.output_text;
        }
      }
    }
  }

  // 5) 최상위 자체가 분석 결과 데이터인 경우
  if (finalJob.overall_status || finalJob.document_keys || finalJob.comparison_matrix) {
    return finalJob;
  }

  return null;
}

function parseResultText(rawText) {
  if (!rawText) return {};
  if (typeof rawText === "object") {
    return rawText;
  }
  try {
    return JSON.parse(rawText);
  } catch (e) {
    console.error("결과 JSON 파싱 실패:", e, rawText);
    throw new Error("결과 JSON 파싱 실패: " + e.message + "\n원문: " + String(rawText).slice(0, 100));
  }
}

/* Run Job Lookup by Job ID */
function lookupExistingJob() {
  var apiKey = trimValue(els.apiKey.value);
  var jobId = trimValue(els.lookupJobId ? els.lookupJobId.value : "");

  if (!apiKey) {
    alert("API Key를 입력하세요.");
    return;
  }

  if (!jobId) {
    alert("조회할 Job ID (res_...)를 입력하세요.");
    return;
  }

  clearResult();
  setStatus("Job 조회 중...", "job_id=" + jobId);

  getJob(apiKey, jobId)
    .then(function (finalJob) {
      var rawText;
      var parsed;

      els.rawJson.textContent = JSON.stringify(finalJob, null, 2);

      if (finalJob.status === "failed") {
        setStatus("실행 실패된 Job", "job_id=" + jobId);
        alert("실행 실패된 Job입니다. Raw JSON을 확인하세요.");
        return;
      }

      rawText = extractResultText(finalJob);

      if (!rawText) {
        setStatus("조회 완료 (결과 텍스트 없음)", "job_id=" + jobId);
        return;
      }

      parsed = parseResultText(rawText);
      renderResult(parsed, finalJob);
      setStatus("조회 완료: " + finalJob.status, "job_id=" + jobId);
    })
    .catch(function (error) {
      console.error(error);
      setStatus("조회 실패", error.message);
      alert("Job 조회 실패: " + error.message);
    });
}

/* 1-Click JSON Helpers */
function copyJsonToClipboard() {
  if (!currentRawPayload) {
    alert("복사할 결과가 없습니다.");
    return;
  }
  var jsonStr = JSON.stringify(currentRawPayload, null, 2);
  navigator.clipboard.writeText(jsonStr).then(function () {
    alert("📋 Raw JSON이 클립보드에 복사되었습니다!");
  }).catch(function (err) {
    alert("복사 실패: " + err.message);
  });
}

function downloadJsonFile() {
  if (!currentRawPayload) {
    alert("다운로드할 결과가 없습니다.");
    return;
  }
  var jsonStr = JSON.stringify(currentRawPayload, null, 2);
  var blob = new Blob([jsonStr], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = "upstage_trade_job_result.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function runWorkflow() {
  var apiKey = trimValue(els.apiKey.value);
  var configId = trimValue(els.configId.value);
  var sampleVal = els.sampleSelect ? parseInt(els.sampleSelect.value, 10) : 0;

  if (!apiKey) {
    alert("API Key를 입력하세요.");
    return;
  }

  if (!selectedFile) {
    if (sampleVal >= 1 && sampleVal <= 4) {
      fillSample(sampleVal);
      return;
    }
    alert("파일을 선택하거나 샘플 데이터셋을 선택하세요.");
    return;
  }

  clearResult();
  els.runBtn.disabled = true;
  var fileSizeKb = selectedFile.size ? Math.round(selectedFile.size / 1024) : 0;
  setStatus("파일 업로드 중 (" + fileSizeKb + " KB)...", selectedFile.name || "");

  uploadFile(apiKey, selectedFile)
    .then(validateUploadedFile)
    .then(function (uploaded) {
      uploadedFileId = uploaded.id;

      els.fileInfo.innerHTML =
        "<strong>" + escapeHtml(selectedFile.name) + "</strong><br>" +
        '<span class="meta-text">file_id=' + escapeHtml(uploadedFileId) + "</span>";

      setStatus("Job 생성 중...", "file_id=" + uploadedFileId);
      return createJob(apiKey, uploadedFileId, configId);
    })
    .then(function (job) {
      currentJobId = job.id;
      if (els.lookupJobId) els.lookupJobId.value = currentJobId;
      setStatus("실행 중...", "job_id=" + currentJobId);
      return pollJob(apiKey, currentJobId);
    })
    .then(function (finalJob) {
      var rawText;
      var parsed;

      els.rawJson.textContent = JSON.stringify(finalJob, null, 2);

      if (finalJob.status === "failed") {
        setStatus("실행 실패", "job_id=" + currentJobId);
        alert("실행 실패: Raw JSON을 확인하세요.");
        els.runBtn.disabled = false;
        return;
      }

      rawText = extractResultText(finalJob);

      if (!rawText) {
        setStatus("완료되었지만 결과 텍스트 없음", "job_id=" + currentJobId);
        els.runBtn.disabled = false;
        return;
      }

      parsed = parseResultText(rawText);
      renderResult(parsed, finalJob);
      setStatus("완료", "job_id=" + currentJobId);
      els.runBtn.disabled = false;
    })
    .catch(function (error) {
      console.error("Workflow Error:", error);
      setStatus("오류 발생", error.message);

      var errMsg = String(error.message || "");
      if (errMsg.indexOf("Failed to fetch") >= 0 || errMsg.indexOf("NetworkError") >= 0) {
        alert(
          "통신 연결에 실패했습니다.\n\n" +
          "• 모바일 Wi-Fi / LTE 데이터 연결 상태를 확인해 주세요.\n" +
          "• 상단의 [캐시 새로고침] 버튼을 눌러 최신 버전으로 갱신해 보세요.\n" +
          "• 프록시 Worker 주소 (" + (els.workerUrl ? els.workerUrl.value : "") + ")가 차단되었거나 지연 중일 수 있습니다."
        );
      } else if (errMsg.indexOf("No access to file") >= 0 || errMsg.indexOf("403") >= 0) {
        alert(
          "접근 권한 오류(403): 업로드된 파일 ID에 접근할 수 없거나 API 키 권한이 부족합니다."
        );
      } else {
        alert(error.message || "오류가 발생했습니다.");
      }

      els.runBtn.disabled = false;
    });
}

function fillSample(sampleIndex) {
  var idx = sampleIndex || 1;
  var fileName = "sample1.json";
  var sampleTitle = "실제샘플1";

  currentActiveSampleIndex = idx;
  selectedFile = null;

  if (els.sampleSelect) {
    els.sampleSelect.value = String(idx);
  }

  if (idx === 1) {
    fileName = "sample1.json";
    sampleTitle = "코오롱인더스트리 (실제샘플1)";
  } else if (idx === 2) {
    fileName = "sample2.json";
    sampleTitle = "현대로템 (실제샘플2)";
  } else if (idx === 3) {
    fileName = "sample3.json";
    sampleTitle = "가상Match샘플 (서류 정상 수용, PDF 6p)";
  } else if (idx === 4) {
    fileName = "sample4.json";
    sampleTitle = "가상MisMatch샘플 (양하항·수량 불일치, PDF 6p)";
  }

  if (els.fileInfo) {
    els.fileInfo.innerHTML = "<strong>[샘플선택] " + escapeHtml(sampleTitle) + "</strong> <span class=\"meta-text\">(" + escapeHtml(fileName) + ")</span>";
  }

  setStatus(sampleTitle + " 로딩 중...", fileName);

  fetch("./" + fileName + "?v=" + encodeURIComponent(getCacheBuster()), {
    cache: "no-store"
  })
    .then(function (res) {
      if (!res.ok) {
        throw new Error(fileName + " 로드 실패 (" + res.status + ")");
      }
      return res.json();
    })
    .then(function (sampleData) {
      var rawText = extractResultText(sampleData);
      var parsed = parseResultText(rawText);
      renderResult(parsed, sampleData);
      if (els.lookupJobId && sampleData.id) {
        els.lookupJobId.value = sampleData.id;
      }
      setStatus("샘플 결과 표시 중 (" + sampleTitle + ")", "job_id=" + (sampleData.id || fileName));

      // 뷰어가 열려 있는 경우 새 샘플의 PDF로 즉시 전환
      if (els.docViewerFloating && els.docViewerFloating.style.display !== "none") {
        openDocViewer(idx, 1, null, null);
      }
    })
    .catch(function (error) {
      console.error(error);
      setStatus(sampleTitle + " 로드 대기/실패", error.message);
      alert(error.message);
    });
}

function bindFileEvents() {
  els.dropzone.addEventListener("click", function () {
    els.fileInput.click();
  });

  els.fileInput.addEventListener("change", function (e) {
    selectedFile = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    if (els.sampleSelect && selectedFile) els.sampleSelect.value = "";
    els.fileInfo.textContent = selectedFile ? selectedFile.name : "선택된 파일 없음";
  });

  els.dropzone.addEventListener("dragover", function (e) {
    e.preventDefault();
    els.dropzone.classList.add("dragover");
  });

  els.dropzone.addEventListener("dragleave", function (e) {
    e.preventDefault();
    els.dropzone.classList.remove("dragover");
  });

  els.dropzone.addEventListener("drop", function (e) {
    e.preventDefault();
    els.dropzone.classList.remove("dragover");
    selectedFile = e.dataTransfer.files && e.dataTransfer.files[0] ? e.dataTransfer.files[0] : null;
    if (els.sampleSelect && selectedFile) els.sampleSelect.value = "";
    els.fileInfo.textContent = selectedFile ? selectedFile.name : "선택된 파일 없음";
  });
}

function setComparisonView(viewMode) {
  if (viewMode === "table") {
    if (els.viewTableBtn) els.viewTableBtn.classList.add("active");
    if (els.viewCardBtn) els.viewCardBtn.classList.remove("active");
    if (els.comparisonCardsContainer) els.comparisonCardsContainer.style.display = "none";
    if (els.comparisonTableWrap) {
      els.comparisonTableWrap.style.display = "block";
      els.comparisonTableWrap.classList.add("active-mobile-table");
    }
  } else {
    if (els.viewCardBtn) els.viewCardBtn.classList.add("active");
    if (els.viewTableBtn) els.viewTableBtn.classList.remove("active");
    if (els.comparisonCardsContainer) els.comparisonCardsContainer.style.display = "flex";
    if (els.comparisonTableWrap) {
      els.comparisonTableWrap.style.display = "none";
      els.comparisonTableWrap.classList.remove("active-mobile-table");
    }
  }
}

function initComparisonViewToggle() {
  if (!els.viewCardBtn || !els.viewTableBtn) return;

  els.viewCardBtn.addEventListener("click", function () {
    setComparisonView("card");
  });

  els.viewTableBtn.addEventListener("click", function () {
    setComparisonView("table");
  });

  var isMobile = window.innerWidth < 768;
  setComparisonView(isMobile ? "card" : "table");
}

function initTableColumnHover() {
  if (!els.comparisonTableWrap) return;

  els.comparisonTableWrap.addEventListener("mouseover", function (e) {
    var cell = e.target.closest("td, th");
    if (!cell || cell.getAttribute("colspan")) return;

    var index = cell.cellIndex + 1;
    var table = cell.closest("table");
    if (!table) return;

    var cells = table.querySelectorAll("tr > td:nth-child(" + index + "), tr > th:nth-child(" + index + ")");
    cells.forEach(function (c) {
      c.classList.add("col-hover");
    });
  });

  els.comparisonTableWrap.addEventListener("mouseout", function (e) {
    var cell = e.target.closest("td, th");
    if (!cell) return;

    var table = cell.closest("table");
    if (!table) return;

    var hovered = table.querySelectorAll(".col-hover");
    hovered.forEach(function (c) {
      c.classList.remove("col-hover");
    });
  });
}

function init() {
  initElements();
  initTheme();
  initComparisonViewToggle();
  initTableColumnHover();
  initDocViewerEvents();

  loadConfig()
    .then(function () {
      bindFileEvents();
      if (els.forceRefreshBtn) {
        els.forceRefreshBtn.addEventListener("click", function () {
          if (confirm("모바일/브라우저 캐시를 완전히 비우고 최신 버전으로 새로고침하시겠습니까?")) {
            try {
              if (window.caches) {
                caches.keys().then(function (names) {
                  names.forEach(function (name) { caches.delete(name); });
                });
              }
              localStorage.removeItem("theme");
              sessionStorage.clear();
            } catch (e) {}
            var cleanUrl = window.location.origin + window.location.pathname + "?v=" + Date.now();
            window.location.replace(cleanUrl);
          }
        });
      }
      els.runBtn.addEventListener("click", runWorkflow);
      if (els.sampleBtn) els.sampleBtn.addEventListener("click", function () { fillSample(1); });
      if (els.sampleBtn1) els.sampleBtn1.addEventListener("click", function () { fillSample(1); });
      if (els.sampleBtn2) els.sampleBtn2.addEventListener("click", function () { fillSample(2); });
      if (els.sampleBtn3) els.sampleBtn3.addEventListener("click", function () { fillSample(3); });
      if (els.sampleBtn4) els.sampleBtn4.addEventListener("click", function () { fillSample(4); });
      if (els.sampleSelect) {
        els.sampleSelect.addEventListener("change", function (e) {
          var val = parseInt(e.target.value, 10);
          if (val >= 1 && val <= 4) {
            fillSample(val);
          }
        });
      }
      els.clearBtn.addEventListener("click", clearAll);
      if (els.lookupBtn) els.lookupBtn.addEventListener("click", lookupExistingJob);
      if (els.copyJsonBtn) els.copyJsonBtn.addEventListener("click", copyJsonToClipboard);
      if (els.downloadJsonBtn) els.downloadJsonBtn.addEventListener("click", downloadJsonFile);
      clearResult();
      setStatus("대기 중", "cache_buster=v=" + getCacheBuster());
    })
    .catch(function (error) {
      console.error(error);
      alert("초기화 실패: " + error.message);
    });
}

/* ==========================================================================
   🌟 PDF Document Viewer & Interactive Highlighting Engine (Modeless Floating)
   ========================================================================== */

var SAMPLE_DOC_REGISTRY = {
  1: {
    name: "코오롱인더스트리",
    pdfPath: "./docs/sample1_kolon.pdf",
    totalPages: 12,
    sections: [
      { page: 1, label: "인수통지 (p.1)", title: "선적서류 인수통지 (KDB)" },
      { page: 2, label: "도착통지 (p.2)", title: "선적서류 도착통지 (KDB)" },
      { page: 3, label: "상업송장 (p.3)", title: "COMMERCIAL INVOICE (Domo)" },
      { page: 4, label: "패킹리스트 (p.4)", title: "PACKING LIST (Domo)" },
      { page: 5, label: "선하증권 (p.5)", title: "BILL OF LADING (Pelorus)" },
      { page: 6, label: "B/L첨부 (p.6)", title: "B/L ATTACHED STATEMENT" },
      { page: 7, label: "해상보험 (p.7)", title: "CERTIFICATE OF INSURANCE (CNA)" },
      { page: 9, label: "분석성적서 (p.9)", title: "CERTIFICATE OF ANALYSIS (Domo)" }
    ],
    docPages: {
      lc: 1,
      invoice: 3,
      commercial_invoice: 3,
      bl: 5,
      bill_of_lading: 5,
      packing_list: 4,
      insurance: 7,
      marine_cargo_insurance: 7,
      coo: 1,
      certificate_of_origin: 1,
      other_document: 1
    }
  },
  2: {
    name: "현대로템",
    pdfPath: "./docs/sample2_hyundai_rotem.pdf",
    totalPages: 10,
    sections: [
      { page: 1, label: "도착통지 (p.1)", title: "선적서류 도착통지 (KDB)" },
      { page: 2, label: "상업송장 (p.2)", title: "INVOICE (Mitsubishi Electric)" },
      { page: 3, label: "송장첨부 (p.3)", title: "INVOICE ATTACHED SHEET" },
      { page: 4, label: "패킹리스트 (p.4)", title: "PACKING LIST (Mitsubishi Electric)" },
      { page: 5, label: "패킹첨부 (p.5)", title: "PACKING LIST ATTACHED SHEET" },
      { page: 8, label: "선하증권 (p.8)", title: "BILL OF LADING (Naigai Nitto)" },
      { page: 9, label: "B/L첨부 (p.9)", title: "B/L ATTACHED SHEET" },
      { page: 10, label: "해상보험 (p.10)", title: "MARINE CARGO POLICY (Tokio Marine)" }
    ],
    docPages: {
      lc: 1,
      invoice: 2,
      commercial_invoice: 2,
      bl: 8,
      bill_of_lading: 8,
      packing_list: 4,
      insurance: 10,
      marine_cargo_insurance: 10,
      coo: 1,
      certificate_of_origin: 1,
      other_document: 1
    }
  },
  3: {
    name: "가상Match샘플",
    pdfPath: "./docs/sample3_match.pdf",
    totalPages: 6,
    sections: [
      { page: 1, label: "신용장 (p.1)", title: "SWIFT MT700 DOCUMENTARY CREDIT (신용장 L/C)" },
      { page: 2, label: "상업송장 (p.2)", title: "COMMERCIAL INVOICE (상업송장)" },
      { page: 3, label: "패킹리스트 (p.3)", title: "PACKING LIST (포장명세서)" },
      { page: 4, label: "선하증권 (p.4)", title: "BILL OF LADING (선하증권 B/L)" },
      { page: 5, label: "해상보험 (p.5)", title: "MARINE INSURANCE POLICY (해상적하보험증권)" },
      { page: 6, label: "원산지증명 (p.6)", title: "CERTIFICATE OF ORIGIN (원산지증명서)" }
    ],
    docPages: {
      lc: 1,
      invoice: 2,
      commercial_invoice: 2,
      packing_list: 3,
      bl: 4,
      bill_of_lading: 4,
      insurance: 5,
      marine_cargo_insurance: 5,
      coo: 6,
      certificate_of_origin: 6
    }
  },
  4: {
    name: "가상MisMatch샘플",
    pdfPath: "./docs/sample4_mismatch.pdf",
    totalPages: 6,
    sections: [
      { page: 1, label: "신용장 (p.1)", title: "SWIFT MT700 DOCUMENTARY CREDIT (신용장 L/C)" },
      { page: 2, label: "상업송장 (p.2)", title: "COMMERCIAL INVOICE (상업송장)" },
      { page: 3, label: "패킹리스트 (p.3)", title: "PACKING LIST (포장명세서)" },
      { page: 4, label: "선하증권 (p.4)", title: "BILL OF LADING (선하증권 B/L)" },
      { page: 5, label: "해상보험 (p.5)", title: "MARINE INSURANCE POLICY (해상적하보험증권)" },
      { page: 6, label: "원산지증명 (p.6)", title: "CERTIFICATE OF ORIGIN (원산지증명서)" }
    ],
    docPages: {
      lc: 1,
      invoice: 2,
      commercial_invoice: 2,
      packing_list: 3,
      bl: 4,
      bill_of_lading: 4,
      insurance: 5,
      marine_cargo_insurance: 5,
      coo: 6,
      certificate_of_origin: 6
    }
  }
};

var docViewerState = {
  sampleIdx: 1,
  pdfDoc: null,
  loadedPdfPath: null,
  currentPage: 1,
  totalPages: 1,
  zoom: 1.1,
  showHighlights: true,
  targetBox: null,
  targetLabel: "",
  loading: false,
  renderTask: null,
  isMaximized: false,
  // Floating Window Drag & Resize State
  isDragging: false,
  dragStartX: 0,
  dragStartY: 0,
  winStartLeft: 0,
  winStartTop: 0
};

/* Floating Window Draggable & Resizable Controller */
function initFloatingWindowControls() {
  var win = els.docViewerFloating;
  var header = els.docViewerHeader;
  if (!win || !header) return;

  // 1. Desktop Draggable by Header
  header.addEventListener("mousedown", function (e) {
    if (window.innerWidth <= 768 || docViewerState.isMaximized) return;
    // Don't drag if clicking buttons or inputs in header
    if (e.target.closest("button") || e.target.closest("input")) return;

    docViewerState.isDragging = true;
    docViewerState.dragStartX = e.clientX;
    docViewerState.dragStartY = e.clientY;

    var rect = win.getBoundingClientRect();
    docViewerState.winStartLeft = rect.left;
    docViewerState.winStartTop = rect.top;

    // Switch right positioning to left positioning for precise dragging
    win.style.right = "auto";
    win.style.bottom = "auto";
    win.style.left = rect.left + "px";
    win.style.top = rect.top + "px";

    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  window.addEventListener("mousemove", function (e) {
    if (!docViewerState.isDragging || !win || window.innerWidth <= 768) return;

    var dx = e.clientX - docViewerState.dragStartX;
    var dy = e.clientY - docViewerState.dragStartY;

    var newLeft = docViewerState.winStartLeft + dx;
    var newTop = docViewerState.winStartTop + dy;

    // Boundaries
    var maxLeft = window.innerWidth - 100;
    var maxTop = window.innerHeight - 80;
    if (newLeft < 10) newLeft = 10;
    if (newLeft > maxLeft) newLeft = maxLeft;
    if (newTop < 10) newTop = 10;
    if (newTop > maxTop) newTop = maxTop;

    win.style.left = newLeft + "px";
    win.style.top = newTop + "px";
  });

  window.addEventListener("mouseup", function () {
    if (docViewerState.isDragging) {
      docViewerState.isDragging = false;
      document.body.style.userSelect = "";
    }
  });

  // 2. Mobile Swipe Down to Close Gesture
  var touchStartY = 0;
  var touchCurrentY = 0;
  var swipeTargets = [header, els.mobileSwipeHandleBar].filter(Boolean);

  swipeTargets.forEach(function (targetEl) {
    targetEl.addEventListener("touchstart", function (e) {
      if (window.innerWidth > 768) return;
      if (e.target.closest("button") || e.target.closest("input")) return;
      touchStartY = e.touches[0].clientY;
      touchCurrentY = touchStartY;
    }, { passive: true });

    targetEl.addEventListener("touchmove", function (e) {
      if (window.innerWidth > 768) return;
      touchCurrentY = e.touches[0].clientY;
      var diffY = touchCurrentY - touchStartY;
      if (diffY > 10 && win) {
        win.style.transform = "translateY(" + Math.min(diffY, 150) + "px)";
        win.style.transition = "none";
      }
    }, { passive: true });

    targetEl.addEventListener("touchend", function () {
      if (window.innerWidth > 768) return;
      var diffY = touchCurrentY - touchStartY;
      if (win) {
        win.style.transform = "";
        win.style.transition = "";
      }
      if (diffY > 70) {
        closeDocViewer();
      }
      touchStartY = 0;
      touchCurrentY = 0;
    }, { passive: true });
  });

  // 3. Window Control Buttons
  if (els.viewerDockBtn) {
    els.viewerDockBtn.addEventListener("click", resetFloatingDockPosition);
  }

  if (els.viewerMaxBtn) {
    els.viewerMaxBtn.addEventListener("click", toggleFloatingMaximize);
  }
}

function resetFloatingDockPosition() {
  var win = els.docViewerFloating;
  if (!win) return;
  win.classList.remove("maximized");
  docViewerState.isMaximized = false;
  if (els.viewerMaxBtn) {
    els.viewerMaxBtn.innerHTML = '<i class="bi bi-arrows-fullscreen"></i>';
    els.viewerMaxBtn.title = "최대화";
  }

  if (window.innerWidth <= 768) {
    win.style.left = "";
    win.style.top = "";
    win.style.right = "";
    win.style.bottom = "";
    win.style.width = "";
    win.style.height = "";
    return;
  }

  win.style.left = "auto";
  win.style.bottom = "auto";
  win.style.top = "70px";
  win.style.right = "24px";
  win.style.width = "740px";
  win.style.height = "calc(100vh - 95px)";
}

function toggleFloatingMaximize() {
  var win = els.docViewerFloating;
  if (!win) return;

  if (window.innerWidth <= 768) return; // 모바일은 이미 풀스크린

  docViewerState.isMaximized = !docViewerState.isMaximized;
  if (docViewerState.isMaximized) {
    win.classList.add("maximized");
    if (els.viewerMaxBtn) {
      els.viewerMaxBtn.innerHTML = '<i class="bi bi-fullscreen-exit"></i>';
      els.viewerMaxBtn.title = "이전 크기로 복원";
    }
  } else {
    resetFloatingDockPosition();
  }
  renderViewerPage(docViewerState.currentPage);
}

function fitViewerToWidth() {
  if (!docViewerState.pdfDoc) return;
  docViewerState.pdfDoc.getPage(docViewerState.currentPage).then(function (page) {
    var vp1 = page.getViewport({ scale: 1.0 });
    var bodyWidth = (els.docViewerBody && els.docViewerBody.clientWidth) ? els.docViewerBody.clientWidth : (window.innerWidth - 24);
    var targetWidth = bodyWidth - (window.innerWidth <= 768 ? 16 : 36);
    if (targetWidth > 50 && vp1.width > 0) {
      var calcScale = Math.min(2.5, Math.max(0.4, targetWidth / vp1.width));
      setViewerZoom(calcScale);
    } else {
      setViewerZoom(1.0);
    }
  }).catch(function () {
    setViewerZoom(1.0);
  });
}

function initDocViewerEvents() {
  initFloatingWindowControls();

  if (els.openDocViewerBtn) {
    els.openDocViewerBtn.addEventListener("click", function () {
      openDocViewer(currentActiveSampleIndex || 1);
    });
  }

  // Multiple Close Triggers
  if (els.viewerCloseBtn) {
    els.viewerCloseBtn.addEventListener("click", function () {
      closeDocViewer();
    });
  }

  if (els.viewerMobileCloseBtn) {
    els.viewerMobileCloseBtn.addEventListener("click", function () {
      closeDocViewer();
    });
  }

  if (els.docViewerBackdrop) {
    els.docViewerBackdrop.addEventListener("click", function () {
      closeDocViewer();
    });
  }

  // Android Hardware/Gesture Back Button Integration (popstate)
  window.addEventListener("popstate", function () {
    if (els.docViewerFloating && els.docViewerFloating.style.display !== "none") {
      closeDocViewer(true);
    }
  });

  if (els.viewerPrevPageBtn) {
    els.viewerPrevPageBtn.addEventListener("click", function () {
      if (docViewerState.currentPage > 1) {
        renderViewerPage(docViewerState.currentPage - 1);
      }
    });
  }

  if (els.viewerNextPageBtn) {
    els.viewerNextPageBtn.addEventListener("click", function () {
      if (docViewerState.currentPage < docViewerState.totalPages) {
        renderViewerPage(docViewerState.currentPage + 1);
      }
    });
  }

  if (els.viewerPageInput) {
    els.viewerPageInput.addEventListener("change", function (e) {
      var p = parseInt(e.target.value, 10);
      if (p >= 1 && p <= docViewerState.totalPages) {
        renderViewerPage(p);
      } else {
        e.target.value = docViewerState.currentPage;
      }
    });
  }

  if (els.viewerZoomInBtn) {
    els.viewerZoomInBtn.addEventListener("click", function () {
      setViewerZoom(docViewerState.zoom + 0.2);
    });
  }

  if (els.viewerZoomOutBtn) {
    els.viewerZoomOutBtn.addEventListener("click", function () {
      setViewerZoom(Math.max(0.4, docViewerState.zoom - 0.2));
    });
  }

  if (els.viewerFitWidthBtn) {
    els.viewerFitWidthBtn.addEventListener("click", function () {
      fitViewerToWidth();
    });
  }

  if (els.viewerToggleHighlightBtn) {
    els.viewerToggleHighlightBtn.addEventListener("click", function () {
      docViewerState.showHighlights = !docViewerState.showHighlights;
      if (docViewerState.showHighlights) {
        this.classList.remove("off");
        this.classList.add("btn-highlight-active");
        this.innerHTML = '<i class="bi bi-bounding-box"></i> <span>하이라이트 ON</span>';
      } else {
        this.classList.remove("btn-highlight-active");
        this.classList.add("off");
        this.innerHTML = '<i class="bi bi-bounding-box-circles"></i> <span>하이라이트 OFF</span>';
      }
      renderHighlightLayer(docViewerState.currentPage);
    });
  }

  // Keyboard Navigation: ESC to close, Left/Right or PageUp/PageDown to navigate
  document.addEventListener("keydown", function (e) {
    if (!els.docViewerFloating || els.docViewerFloating.style.display === "none") return;

    if (e.key === "Escape") {
      closeDocViewer();
    } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
      if (docViewerState.currentPage > 1) {
        renderViewerPage(docViewerState.currentPage - 1);
      }
    } else if (e.key === "ArrowRight" || e.key === "PageDown") {
      if (docViewerState.currentPage < docViewerState.totalPages) {
        renderViewerPage(docViewerState.currentPage + 1);
      }
    }
  });

  // Window resize handler: adapt viewer size between mobile and desktop
  window.addEventListener("resize", function () {
    if (!els.docViewerFloating || els.docViewerFloating.style.display === "none") return;
    if (window.innerWidth <= 768) {
      els.docViewerFloating.style.left = "";
      els.docViewerFloating.style.top = "";
      els.docViewerFloating.style.right = "";
      els.docViewerFloating.style.bottom = "";
      els.docViewerFloating.style.width = "";
      els.docViewerFloating.style.height = "";
      if (els.docViewerBackdrop) els.docViewerBackdrop.style.display = "block";
    } else {
      if (els.docViewerBackdrop) els.docViewerBackdrop.style.display = "none";
    }
  });
}

function setViewerZoom(newZoom) {
  docViewerState.zoom = Math.round(newZoom * 10) / 10;
  if (els.viewerZoomLabel) {
    els.viewerZoomLabel.textContent = Math.round(docViewerState.zoom * 100) + "%";
  }
  renderViewerPage(docViewerState.currentPage, docViewerState.targetBox, docViewerState.targetLabel);
}

function openDocViewer(sampleIdx, targetPage, targetBox, targetLabel) {
  var sIdx = sampleIdx || currentActiveSampleIndex || 1;
  var reg = SAMPLE_DOC_REGISTRY[sIdx] || SAMPLE_DOC_REGISTRY[1];

  var pdfSource = null;
  var docDisplayName = reg.name;
  var sourceKey = "";

  // 1) 사용자가 직접 업로드한 로컬 파일이 있는 경우 (GitHub/서버 업로드 없이 브라우저 메모리 Blob URL로 즉시 로드)
  if (selectedFile && selectedFile instanceof Blob) {
    if (!docViewerState.uploadedBlobUrl || docViewerState.loadedFileRef !== selectedFile) {
      if (docViewerState.uploadedBlobUrl) {
        try { URL.revokeObjectURL(docViewerState.uploadedBlobUrl); } catch (e) {}
      }
      docViewerState.uploadedBlobUrl = URL.createObjectURL(selectedFile);
      docViewerState.loadedFileRef = selectedFile;
    }
    pdfSource = docViewerState.uploadedBlobUrl;
    docDisplayName = selectedFile.name;
    sourceKey = "blob:" + selectedFile.name + "_" + selectedFile.size;
  } else {
    // 2) 샘플 데이터셋 모드
    docViewerState.sampleIdx = sIdx;
    pdfSource = reg.pdfPath;
    docDisplayName = reg.name;
    sourceKey = reg.pdfPath;
  }

  docViewerState.currentDocName = docDisplayName;

  var isMobile = window.innerWidth <= 768;

  // Open Window & Reset Mobile inline positioning
  if (els.docViewerFloating) {
    if (isMobile) {
      els.docViewerFloating.style.left = "";
      els.docViewerFloating.style.top = "";
      els.docViewerFloating.style.right = "";
      els.docViewerFloating.style.bottom = "";
      els.docViewerFloating.style.width = "";
      els.docViewerFloating.style.height = "";
    }
    els.docViewerFloating.style.display = "flex";
  }

  // Backdrop on mobile
  if (els.docViewerBackdrop) {
    els.docViewerBackdrop.style.display = isMobile ? "block" : "none";
  }

  // Android back button integration
  if (isMobile) {
    if (!window.history.state || !window.history.state.modalDocViewer) {
      try {
        window.history.pushState({ modalDocViewer: true }, "");
      } catch (e) {}
    }
  }

  // Setup Quick Nav Tabs
  renderQuickNavTabs(sIdx);

  var pageToOpen = targetPage || 1;
  docViewerState.targetBox = targetBox || null;
  docViewerState.targetLabel = targetLabel || "";

  // Set PDF.js Worker
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  // Load PDF if not loaded or if document changed
  if (!docViewerState.pdfDoc || docViewerState.loadedPdfPath !== sourceKey) {
    if (els.viewerLoadingSpinner) els.viewerLoadingSpinner.style.display = "flex";
    
    if (window.pdfjsLib) {
      window.pdfjsLib.getDocument(pdfSource).promise.then(function (pdf) {
        docViewerState.pdfDoc = pdf;
        docViewerState.loadedPdfPath = sourceKey;
        docViewerState.totalPages = pdf.numPages || reg.totalPages || 1;

        if (isMobile) {
          fitViewerToWidth();
        } else {
          renderViewerPage(pageToOpen, targetBox, targetLabel);
        }
      }).catch(function (err) {
        console.error("PDF 로드 실패:", err);
        if (els.viewerLoadingSpinner) els.viewerLoadingSpinner.style.display = "none";
        alert("PDF 서류 로드에 실패했습니다. (" + docDisplayName + ")\n" + err.message);
      });
    } else {
      alert("PDF.js 라이브러리가 로드되지 않았습니다. 네트워크 연결을 확인하세요.");
    }
  } else {
    if (isMobile && !targetBox) {
      fitViewerToWidth();
    } else {
      renderViewerPage(pageToOpen, targetBox, targetLabel);
    }
  }
}

function closeDocViewer(fromPopstate) {
  if (els.docViewerFloating) {
    els.docViewerFloating.style.display = "none";
  }
  if (els.docViewerBackdrop) {
    els.docViewerBackdrop.style.display = "none";
  }

  // Revert history state if closed by button/gesture instead of popstate
  if (!fromPopstate && window.history.state && window.history.state.modalDocViewer) {
    try {
      window.history.back();
    } catch (e) {}
  }
}

function renderQuickNavTabs(sampleIdx) {
  if (!els.docQuickNav) return;
  var sIdx = sampleIdx || currentActiveSampleIndex || 1;
  var reg = SAMPLE_DOC_REGISTRY[sIdx] || SAMPLE_DOC_REGISTRY[1];
  var sections = reg.sections || [];

  // 사용자 업로드 파일인 경우 기본 페이지 섹션 자동 생성
  if (selectedFile && docViewerState.totalPages > 1 && sections.length === 0) {
    sections = [];
    for (var i = 1; i <= docViewerState.totalPages; i++) {
      sections.push({ page: i, label: "p." + i, title: selectedFile.name + " (" + i + "p)" });
    }
  }

  var html = "";
  sections.forEach(function (sec) {
    html += '<button type="button" class="quick-doc-btn" data-page="' + sec.page + '" title="' + escapeHtml(sec.title) + '">';
    html += '<i class="bi bi-file-earmark-text"></i> ' + escapeHtml(sec.label);
    html += '</button>';
  });

  els.docQuickNav.innerHTML = html;

  var btns = els.docQuickNav.querySelectorAll(".quick-doc-btn");
  btns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var p = parseInt(this.getAttribute("data-page"), 10);
      docViewerState.targetBox = null;
      docViewerState.targetLabel = "";
      renderViewerPage(p);
    });
  });
}

function renderViewerPage(pageNum, targetBox, targetLabel) {
  if (!docViewerState.pdfDoc) return;
  if (pageNum < 1) pageNum = 1;
  if (pageNum > docViewerState.totalPages) pageNum = docViewerState.totalPages;

  docViewerState.currentPage = pageNum;
  if (targetBox !== undefined) docViewerState.targetBox = targetBox;
  if (targetLabel !== undefined) docViewerState.targetLabel = targetLabel;

  if (els.viewerPageInput) els.viewerPageInput.value = pageNum;
  if (els.viewerTotalPages) els.viewerTotalPages.textContent = docViewerState.totalPages;
  if (els.viewerPageIndicator) els.viewerPageIndicator.textContent = "Page " + pageNum + " / " + docViewerState.totalPages;

  var reg = SAMPLE_DOC_REGISTRY[docViewerState.sampleIdx] || SAMPLE_DOC_REGISTRY[1];

  var currentSec = null;
  if (reg.sections) {
    for (var i = 0; i < reg.sections.length; i++) {
      if (reg.sections[i].page === pageNum) {
        currentSec = reg.sections[i];
        break;
      }
    }
  }

  if (els.viewerDocBadge) {
    els.viewerDocBadge.innerHTML = '<i class="bi bi-file-earmark-pdf-fill"></i> ' + escapeHtml(docViewerState.currentDocName || reg.name);
  }
  if (els.viewerDocTitle) {
    els.viewerDocTitle.textContent = currentSec ? currentSec.title : ("서류 페이지 " + pageNum);
  }

  // 🌟 Quick Nav 활성 탭 표시 동기화
  if (els.docQuickNav) {
    var qBtns = els.docQuickNav.querySelectorAll(".quick-doc-btn");
    qBtns.forEach(function (b) {
      var p = parseInt(b.getAttribute("data-page"), 10);
      if (p === pageNum) b.classList.add("active");
      else b.classList.remove("active");
    });
  }

  // 타겟 하이라이트 배너 표시 제어
  if (docViewerState.targetBox && docViewerState.targetLabel) {
    if (els.viewerHighlightBanner) els.viewerHighlightBanner.style.display = "flex";
    if (els.viewerHighlightTargetText) els.viewerHighlightTargetText.textContent = "하이라이트: " + docViewerState.targetLabel;
  } else {
    if (els.viewerHighlightBanner) els.viewerHighlightBanner.style.display = "none";
  }

  if (els.viewerLoadingSpinner) els.viewerLoadingSpinner.style.display = "flex";

  if (docViewerState.renderTask) {
    try { docViewerState.renderTask.cancel(); } catch (e) {}
    docViewerState.renderTask = null;
  }

  docViewerState.pdfDoc.getPage(pageNum).then(function (page) {
    var scale = docViewerState.zoom || 1.1;
    var viewport = page.getViewport({ scale: scale });

    var canvas = els.pdfCanvas;
    var ctx = canvas.getContext("2d");
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    var renderContext = {
      canvasContext: ctx,
      viewport: viewport
    };

    docViewerState.renderTask = page.render(renderContext);

    docViewerState.renderTask.promise.then(function () {
      if (els.viewerLoadingSpinner) els.viewerLoadingSpinner.style.display = "none";
      renderHighlightLayer(pageNum);
    }).catch(function (err) {
      if (err && err.name === "RenderingCancelledException") return;
      console.error("PDF 렌더링 에러:", err);
      if (els.viewerLoadingSpinner) els.viewerLoadingSpinner.style.display = "none";
    });
  }).catch(function (err) {
    console.error("페이지 로드 실패:", err);
    if (els.viewerLoadingSpinner) els.viewerLoadingSpinner.style.display = "none";
  });
}

function renderHighlightLayer(pageNum) {
  if (!els.highlightLayer) return;
  els.highlightLayer.innerHTML = "";

  if (!docViewerState.showHighlights) return;

  var reg = SAMPLE_DOC_REGISTRY[docViewerState.sampleIdx] || SAMPLE_DOC_REGISTRY[1];
  var pageBoxes = [];
  var seenCoords = {};

  // 1. 오직 JSON 데이터(check_results)에서 현재 페이지(pageNum)에 해당하는 모든 BBox 동적 수집 (mock 배제)
  if (currentCheckResults && currentCheckResults.length > 0) {
    currentCheckResults.forEach(function (cr) {
      if (!cr || !cr.documents) return;
      Object.keys(cr.documents).forEach(function (docKey) {
        var docItem = cr.documents[docKey];
        if (!docItem) return;
        var normSrc = normalizeSource(docItem.source);
        if (normSrc && normSrc.page === pageNum && normSrc.boxes.length > 0) {
          normSrc.boxes.forEach(function (box) {
            if (!box) return;
            var coordKey = Math.round(box.x * 1000) + "_" + Math.round(box.y * 1000);
            if (!seenCoords[coordKey]) {
              seenCoords[coordKey] = true;
              pageBoxes.push({
                label: (cr.label || cr.check_item || "") + (docItem.value ? ": " + docItem.value : ""),
                box: box,
                key: cr.check_item
              });
            }
          });
        }
      });
    });
  }

  // 2. 박스 면적 계산 및 면적 내림차순 정렬 (큰 박스가 배경에 먼저 렌더링되고, 작은 박스가 전면에 위치)
  pageBoxes.forEach(function (pb) {
    pb.area = (pb.box.width || 0) * (pb.box.height || 0);
  });
  pageBoxes.sort(function (a, b) {
    return b.area - a.area;
  });

  // 🌟 3. targetBox와 가장 일치하는 "단 1개의 베스트 박스" 인덱스 선별
  var bestTargetIdx = -1;
  var minDistance = 0.022; // 2.2% 이내로 엄격히 제한

  if (docViewerState.targetBox) {
    var tx = docViewerState.targetBox.x;
    var ty = docViewerState.targetBox.y;

    pageBoxes.forEach(function (pb, idx) {
      var bx = pb.box.x;
      var by = pb.box.y;
      var dist = Math.hypot(tx - bx, ty - by);
      if (dist < minDistance) {
        minDistance = dist;
        bestTargetIdx = idx;
      }
    });
  }

  var targetEl = null;

  // 4. 수집된 모든 박스 렌더링: 오직 bestTargetIdx 1개만 파란색(target-active), 나머지는 모두 노란색
  pageBoxes.forEach(function (pb, idx) {
    var b = pb.box;
    var isTarget = (idx === bestTargetIdx);
    var area = pb.area || ((b.width || 0) * (b.height || 0));
    var isLargeBox = area > 0.035; // 전체 페이지 면적의 3.5% 이상을 차지하는 대형 박스 (테이블 블록 등)

    var boxDiv = document.createElement("div");
    // 🌟 사용자 코멘트 1 반영 (큰 박스 내 작은 박스 클릭 지원):
    // 1) 큰 박스가 활성화된 경우 large-target-active 클래스 부여 -> 내부 작은 박스로 클릭 이벤트 통과
    // 2) 작은 박스일수록 높은 z-index를 부여하여 전면에 노출 및 우선 선택 보장
    boxDiv.className = "highlight-box" +
      (isTarget ? " target-active" : "") +
      (isTarget && isLargeBox ? " large-target-active" : "");

    boxDiv.style.left = (b.x * 100) + "%";
    boxDiv.style.top = (b.y * 100) + "%";
    boxDiv.style.width = (b.width * 100) + "%";
    boxDiv.style.height = (b.height * 100) + "%";

    var baseZ = Math.max(10, Math.round(250 - Math.min(area, 1) * 200));
    boxDiv.style.zIndex = isTarget ? (isLargeBox ? baseZ : 255) : baseZ;

    boxDiv.setAttribute("title", pb.label);

    if (isTarget) {
      var l = document.createElement("span");
      l.className = "highlight-box-label";
      l.textContent = docViewerState.targetLabel || pb.label;
      boxDiv.appendChild(l);
      targetEl = boxDiv;
    } else {
      // 기본 노란색 박스: 호버 시 노란색 라벨 표시
      boxDiv.addEventListener("mouseenter", function () {
        if (!boxDiv.classList.contains("target-active") && !boxDiv.querySelector(".highlight-box-label")) {
          var tag = document.createElement("span");
          tag.className = "highlight-box-label highlight-box-label-yellow";
          tag.textContent = pb.label;
          boxDiv.appendChild(tag);
        }
      });
      boxDiv.addEventListener("mouseleave", function () {
        if (!boxDiv.classList.contains("target-active")) {
          var tag = boxDiv.querySelector(".highlight-box-label-yellow");
          if (tag) tag.remove();
        }
      });
    }

    // 박스 직접 클릭 시 파란색 타깃으로 전환
    boxDiv.addEventListener("click", function (e) {
      e.stopPropagation();
      docViewerState.targetBox = b;
      docViewerState.targetLabel = pb.label;
      renderHighlightLayer(pageNum);
      if (els.viewerHighlightBanner) els.viewerHighlightBanner.style.display = "flex";
      if (els.viewerHighlightTargetText) els.viewerHighlightTargetText.textContent = "하이라이트: " + pb.label;
    });

    els.highlightLayer.appendChild(boxDiv);
  });

  // 5. 만약 targetBox가 목록에 없는 임의 위치라면, 파란색 타깃으로 단독 1개 추가 렌더링
  if (docViewerState.targetBox && bestTargetIdx === -1) {
    var tb = docViewerState.targetBox;
    var tbArea = (tb.width || 0) * (tb.height || 0);
    var tbIsLarge = tbArea > 0.035;
    var customDiv = document.createElement("div");
    customDiv.className = "highlight-box target-active" + (tbIsLarge ? " large-target-active" : "");
    customDiv.style.left = (tb.x * 100) + "%";
    customDiv.style.top = (tb.y * 100) + "%";
    customDiv.style.width = (tb.width * 100) + "%";
    customDiv.style.height = (tb.height * 100) + "%";
    customDiv.style.zIndex = tbIsLarge ? 150 : 255;

    if (docViewerState.targetLabel) {
      var customTag = document.createElement("span");
      customTag.className = "highlight-box-label";
      customTag.textContent = docViewerState.targetLabel;
      customDiv.appendChild(customTag);
    }

    els.highlightLayer.appendChild(customDiv);
    targetEl = customDiv;
  }

  // Smooth scroll to target
  if (targetEl && els.docViewerBody) {
    setTimeout(function () {
      targetEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }, 120);
  }
}

/**
 * 정교한 서류 종류(docType)와 검토항목(checkItemKey) 복합 매핑 엔진
 */
function normalizeDocType(docType) {
  if (!docType) return "";
  var d = String(docType).toLowerCase();
  if (d === "commercial_invoice" || d === "inv" || d === "invoice") return "invoice";
  if (d === "bill_of_lading" || d === "bl") return "bl";
  if (d === "marine_cargo_insurance" || d === "ins" || d === "insurance") return "insurance";
  if (d === "certificate_of_origin" || d === "coo") return "coo";
  if (d === "packing" || d === "pack" || d === "pk" || d === "packing_list") return "packing_list";
  if (d === "lc" || d === "letter_of_credit") return "lc";
  if (d === "other_document" || d === "other" || d === "notice") return "other_document";
  return d;
}

function getDocTarget(sampleIdx, docType) {
  var sIdx = sampleIdx || currentActiveSampleIndex || 1;
  var reg = SAMPLE_DOC_REGISTRY[sIdx] || SAMPLE_DOC_REGISTRY[1];
  var normDoc = normalizeDocType(docType);
  var defaultPage = (normDoc && reg.docPages && reg.docPages[normDoc]) ? reg.docPages[normDoc] : 1;
  return {
    page: defaultPage,
    box: null,
    label: ""
  };
}

function openDocViewerWithField(fieldKey) {
  var sIdx = currentActiveSampleIndex || 1;
  // JSON check_results에서 해당 필드 키와 연관된 항목 탐색
  var target = null;
  if (currentCheckResults && currentCheckResults.length > 0) {
    for (var i = 0; i < currentCheckResults.length; i++) {
      var cr = currentCheckResults[i];
      if (!cr || !cr.documents) continue;
      if (cr.check_item === fieldKey || cr.check_item === (fieldKey + "_consistency") || cr.check_item.indexOf(fieldKey) >= 0) {
        var docs = Object.keys(cr.documents);
        for (var j = 0; j < docs.length; j++) {
          var dItem = cr.documents[docs[j]];
          if (dItem && dItem.source && dItem.source.page > 0 && Array.isArray(dItem.source.boxes) && dItem.source.boxes.length > 0) {
            target = {
              page: dItem.source.page,
              box: dItem.source.boxes[0],
              label: (cr.label || fieldKey) + ": " + (dItem.value || "")
            };
            break;
          }
        }
      }
      if (target) break;
    }
  }

  if (target && target.page > 0) {
    openDocViewer(sIdx, target.page, target.box, target.label);
  } else {
    var def = getDocTarget(sIdx, null);
    openDocViewer(sIdx, def.page, null, fieldKey);
  }
}

function openDocViewerWithCheckItem(checkItemKey, docType) {
  var sIdx = currentActiveSampleIndex || 1;
  var evidenceDoc = getEvidence(checkItemKey, docType);
  var target = getEvidenceTarget(sIdx, docType, evidenceDoc, checkItemKey);

  // 1. JSON source BBox를 통한 하이라이트 (100% JSON 파일 기반)
  if (target && target.page > 0) {
    openDocViewer(sIdx, target.page, target.box, target.label);
    return;
  }

  // 2. JSON에 BBox가 없는 경우 명확히 안내
  var hasVal = evidenceDoc && hasMeaningfulValue(evidenceDoc.value);
  if (hasVal) {
    alert("해당 항목(" + (evidenceDoc.field_name || checkItemKey) + ")은 서류 내 원문 위치 정보(BBox)가 제공되지 않았습니다.\n(값: " + evidenceDoc.value + ")");
  } else {
    alert("해당 서류에는 '" + checkItemKey + "' 관련 기재 내용이 없습니다.");
  }
}

function openDocViewerForDoc(docKey) {
  var sIdx = currentActiveSampleIndex || 1;
  var reg = SAMPLE_DOC_REGISTRY[sIdx] || SAMPLE_DOC_REGISTRY[1];
  var page = (reg.docPages && reg.docPages[docKey]) ? reg.docPages[docKey] : 1;
  openDocViewer(sIdx, page, null, null);
}

document.addEventListener("DOMContentLoaded", init);

