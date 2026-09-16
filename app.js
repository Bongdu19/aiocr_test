var CONFIG = null;
var selectedFile = null;
var uploadedFileId = null;
var currentJobId = null;
var currentChecklistData = null;
var activeChecklistTab = null;
var currentRawPayload = null;
var els = {};

function getEl(id) {
  return document.getElementById(id);
}

function initElements() {
  els.apiKey = getEl("apiKey");
  els.workerUrl = getEl("workerUrl");
  els.configId = getEl("configId");
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
  els.customSampleOption = getEl("customSampleOption");
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
  els.setAsSampleBtn = getEl("setAsSampleBtn");
  els.rawJson = getEl("rawJson");
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

/* API Endpoint Construction via Cloudflare Worker */
function getApiEndpoint(path) {
  var workerBase = trimValue(els.workerUrl ? els.workerUrl.value : "") || (CONFIG ? CONFIG.workerUrl : "");
  if (!workerBase) {
    workerBase = "https://bong.gehunmin19.workers.dev";
  }
  
  if (!/^https?:\/\//i.test(workerBase)) {
    workerBase = "https://" + workerBase;
  }

  workerBase = workerBase.replace(/\/+$/, "");

  if (!workerBase.endsWith("/v2") && !workerBase.endsWith("/v1")) {
    return workerBase + "/v2" + path;
  }
  return workerBase + path;
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
  if (val == null || val === "") {
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

function normalizeResultPayload(parsed) {
  if (parsed && parsed.structured_result) {
    return parsed.structured_result;
  }
  return parsed || {};
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
      html += '<div class="kv-item">';
      html += '<span class="kv-key">' + escapeHtml(displayKey) + ':</span>';
      html += '<span class="kv-value">' + escapeHtml(cleanedVal || "-") + "</span>";
      html += "</div>";
    }
  }

  els.documentKeys.innerHTML = html || "결과 없음";
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
      var res = String(r.result || "").toLowerCase();
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
        res === "match" ||
        res === "ok" ||
        res === "pass"
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

    html += '<table class="data-table">';
    html += '<thead>';
    html += '<tr class="group-subheader-row">';
    html += '<th class="col-item" style="width: 21%;"><i class="bi bi-card-checklist"></i> 검토 항목</th>';
    html += '<th class="col-result" style="width: 8%;"><i class="bi bi-shield-check"></i> 결과</th>';
    html += '<th class="col-doc col-lc" style="width: 11.83%;"><i class="bi bi-file-earmark-text"></i> L/C</th>';
    html += '<th class="col-doc col-inv" style="width: 11.83%;"><i class="bi bi-receipt"></i> 송장</th>';
    html += '<th class="col-doc col-bl" style="width: 11.83%;"><i class="bi bi-water"></i> B/L</th>';
    html += '<th class="col-doc col-pk" style="width: 11.83%;"><i class="bi bi-box-seam"></i> 포장</th>';
    html += '<th class="col-doc col-ins" style="width: 11.83%;"><i class="bi bi-shield-check"></i> 보험</th>';
    html += '<th class="col-doc col-coo" style="width: 11.83%;"><i class="bi bi-bank"></i> COO</th>';
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
      var rowClass = rowHighlightClass(row.result);
      var itemTitle = row.check_item_ko || row.check_item || "-";

      // Table Row
      html += '<tr class="' + rowClass + '">';
      html += '<td><strong class="item-title-cell">' + escapeHtml(cleanText(itemTitle)) + '</strong></td>';
      html += '<td class="' + resultCellClass(row.result) + '">' + escapeHtml(koreanStatus(row.result)) + '</td>';
      html += '<td>' + formatTableCellHtml(row.lc) + '</td>';
      html += '<td>' + formatTableCellHtml(row.commercial_invoice || row.invoice) + '</td>';
      html += '<td>' + formatTableCellHtml(row.bill_of_lading || row.bl) + '</td>';
      html += '<td>' + formatTableCellHtml(row.packing_list) + '</td>';
      html += '<td>' + formatTableCellHtml(row.marine_cargo_insurance || row.insurance) + '</td>';
      html += '<td>' + formatTableCellHtml(row.certificate_of_origin || row.coo) + '</td>';
      html += '</tr>';

      // Mobile Card Item
      cardsHtml += '<div class="mobile-matrix-card ' + rowClass + '">';
      cardsHtml += '<div class="mobile-card-top">';
      cardsHtml += '<span class="mobile-card-title">' + escapeHtml(cleanText(itemTitle)) + '</span>';
      cardsHtml += '<span class="' + badgeClass(row.result) + '">' + escapeHtml(koreanStatus(row.result)) + '</span>';
      cardsHtml += '</div>';
      cardsHtml += '<div class="mobile-card-doc-grid">';

      var docs = [
        { label: "LC", val: row.lc },
        { label: "송장", val: row.commercial_invoice || row.invoice },
        { label: "B/L", val: row.bill_of_lading || row.bl },
        { label: "포장", val: row.packing_list },
        { label: "보험", val: row.marine_cargo_insurance || row.insurance },
        { label: "COO", val: row.certificate_of_origin || row.coo }
      ];

      docs.forEach(function (d) {
        cardsHtml += '<div class="mobile-doc-item">';
        cardsHtml += '<span class="mobile-doc-tag">' + escapeHtml(d.label) + '</span>';
        cardsHtml += '<div class="mobile-doc-val-wrap">' + formatTableCellHtml(d.val) + '</div>';
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
    certificate_of_origin: "원산지증명 (COO)"
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
  var data = normalizeResultPayload(parsed);
  var rows = [];
  var overall = String(data.overall_status || "").toLowerCase();
  var alertLvl = String(data.overall_alert_level || "").toLowerCase();

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

  els.oneLineSummary.textContent = cleanText(data.one_line_summary) || "-";
  els.recommendedAction.textContent = cleanText(data.recommended_action) || "-";

  if (finalJob) {
    renderUsage(finalJob);
  }

  renderDocumentKeys(data.document_keys);
  renderDateTimeline(data.date_checks);
  rows = data.comparison_matrix || [];
  renderComparisonTable(rows);
  renderChecklists(data.document_checklists);
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
      }
    });
}

function uploadFile(apiKey, file) {
  if (!file || !(file instanceof Blob)) {
    return Promise.reject(new Error("업로드할 파일 객체가 유효하지 않습니다. 파일을 다시 선택해주세요."));
  }

  var form = new FormData();
  var filename = (file && file.name) ? file.name : "document.pdf";
  form.append("file", file, filename);
  form.append("purpose", (CONFIG && CONFIG.filePurpose) || "user_data");

  var endpoint = getApiEndpoint("/files");

  return fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey
    },
    body: form
  }).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (text) {
        throw new Error("파일 업로드 실패 (" + res.status + "): " + text);
      });
    }
    return res.json();
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
    model: CONFIG.agentId,
    include: ["last"],
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

  if (configId) {
    body.config_id = configId;
  }

  var endpoint = getApiEndpoint("/responses");

  return fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  }).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (text) {
        throw new Error("Job 생성 실패 (" + res.status + "): " + text);
      });
    }
    return res.json();
  });
}

function getJob(apiKey, jobId) {
  var endpoint = getApiEndpoint("/responses/" + encodeURIComponent(jobId) + "?include[]=last");

  return fetch(endpoint, {
    method: "GET",
    headers: {
      Authorization: "Bearer " + apiKey
    }
  }).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (text) {
        throw new Error("Job 조회 실패 (" + res.status + "): " + text);
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
  return new Promise(function (resolve, reject) {
    function loop() {
      getJob(apiKey, jobId)
        .then(function (job) {
          setStatus("실행 상태: " + job.status, "job_id=" + job.id);

          if (job.status === "completed" || job.status === "failed") {
            resolve(job);
            return;
          }

          wait(CONFIG.pollIntervalMs || 2500).then(loop);
        })
        .catch(reject);
    }

    loop();
  });
}

function extractResultText(finalJob) {
  if (finalJob.output_text) {
    return finalJob.output_text;
  }

  if (
    finalJob.output &&
    finalJob.output.length > 0 &&
    finalJob.output[0].content &&
    finalJob.output[0].content.length > 0 &&
    finalJob.output[0].content[0].text
  ) {
    return finalJob.output[0].content[0].text;
  }

  return null;
}

function parseResultText(rawText) {
  try {
    return JSON.parse(rawText);
  } catch (e) {
    throw new Error("결과 JSON 파싱 실패: " + e.message + "\n원문: " + rawText);
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

function updateCustomSampleOptionUI() {
  var savedCustom = localStorage.getItem("myCustomSample");
  var opt = els.customSampleOption || getEl("customSampleOption");
  if (!opt) return;

  if (savedCustom) {
    opt.style.display = "";
    opt.disabled = false;
    opt.hidden = false;
  } else {
    opt.style.display = "none";
    opt.disabled = true;
    opt.hidden = true;
  }
}

function setAsCustomSample() {
  if (!currentRawPayload) {
    alert("샘플로 지정할 결과가 없습니다.");
    return;
  }
  try {
    localStorage.setItem("myCustomSample", JSON.stringify(currentRawPayload));
    updateCustomSampleOptionUI();
    if (els.sampleSelect) {
      els.sampleSelect.value = "5";
    }
    fillSample(5);
    alert("⭐ 현재 결과가 내 커스텀 샘플로 지정되었습니다!\n드롭다운 5번에 '5️⃣ ⭐ 내 지정 커스텀 샘플'이 활성화되었습니다.");
  } catch (e) {
    alert("저장 실패: " + e.message);
  }
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
    if (sampleVal >= 1 && sampleVal <= 5) {
      fillSample(sampleVal);
      return;
    }
    alert("파일을 선택하거나 샘플 데이터셋을 선택하세요.");
    return;
  }

  clearResult();
  els.runBtn.disabled = true;
  setStatus("파일 업로드 중...", "");

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
      console.error(error);
      setStatus("오류 발생", error.message);

      if (String(error.message || "").indexOf("Failed to fetch") >= 0) {
        alert(
          "CORS 통신 오류가 발생했습니다.\n" +
          "Cloudflare Worker 서버 주소 (" + (els.workerUrl ? els.workerUrl.value : "") + ") 연결 상태를 확인해 주세요."
        );
      } else if (String(error.message || "").indexOf("No access to file") >= 0) {
        alert(
          "업로드된 file_id를 현재 에이전트 실행에서 바로 사용할 수 없어 403이 발생했습니다."
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

  selectedFile = null;

  if (els.sampleSelect) {
    els.sampleSelect.value = String(idx);
  }

  if (idx === 5) {
    var savedCustom = localStorage.getItem("myCustomSample");
    if (!savedCustom) {
      alert("지정된 커스텀 샘플이 없습니다. 먼저 결과를 '★ 내 결과 샘플로 지정' 버튼으로 저장해 주세요.");
      return;
    }
    try {
      var customJob = JSON.parse(savedCustom);
      var customRawText = extractResultText(customJob);
      var customParsed = parseResultText(customRawText);
      renderResult(customParsed, customJob);
      if (els.lookupJobId && customJob.id) {
        els.lookupJobId.value = customJob.id;
      }
      if (els.fileInfo) {
        els.fileInfo.innerHTML = "<strong>[샘플선택] ⭐ 내 지정 커스텀 샘플</strong> <span class=\"meta-text\">(저장됨)</span>";
      }
      setStatus("커스텀 샘플 결과 표시 중", "job_id=" + (customJob.id || "custom"));
      return;
    } catch (e) {
      alert("커스텀 샘플 파싱 실패: " + e.message);
      return;
    }
  }

  if (idx === 1) {
    fileName = "sample1.json";
    sampleTitle = "실제샘플1";
  } else if (idx === 2) {
    fileName = "sample2.json";
    sampleTitle = "실제샘플2";
  } else if (idx === 3) {
    fileName = "sample3.json";
    sampleTitle = "가상Match샘플";
  } else if (idx === 4) {
    fileName = "sample4.json";
    sampleTitle = "가상MisMatch샘플";
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
        if (idx === 2 || idx === 4) {
          throw new Error(sampleTitle + " JSON 데이터가 준비 중입니다. 파일 제공 후 바로 확인 가능합니다.");
        }
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

  loadConfig()
    .then(function () {
      bindFileEvents();
      updateCustomSampleOptionUI();
      els.runBtn.addEventListener("click", runWorkflow);
      if (els.sampleBtn) els.sampleBtn.addEventListener("click", function () { fillSample(1); });
      if (els.sampleBtn1) els.sampleBtn1.addEventListener("click", function () { fillSample(1); });
      if (els.sampleBtn2) els.sampleBtn2.addEventListener("click", function () { fillSample(2); });
      if (els.sampleBtn3) els.sampleBtn3.addEventListener("click", function () { fillSample(3); });
      if (els.sampleBtn4) els.sampleBtn4.addEventListener("click", function () { fillSample(4); });
      if (els.sampleBtn5) els.sampleBtn5.addEventListener("click", function () { fillSample(5); });
      if (els.sampleSelect) {
        els.sampleSelect.addEventListener("change", function (e) {
          var val = parseInt(e.target.value, 10);
          if (val >= 1 && val <= 5) {
            fillSample(val);
          }
        });
      }
      els.clearBtn.addEventListener("click", clearAll);
      if (els.lookupBtn) els.lookupBtn.addEventListener("click", lookupExistingJob);
      if (els.copyJsonBtn) els.copyJsonBtn.addEventListener("click", copyJsonToClipboard);
      if (els.downloadJsonBtn) els.downloadJsonBtn.addEventListener("click", downloadJsonFile);
      if (els.setAsSampleBtn) els.setAsSampleBtn.addEventListener("click", setAsCustomSample);
      clearResult();
      setStatus("대기 중", "cache_buster=v=" + getCacheBuster());
    })
    .catch(function (error) {
      console.error(error);
      alert("초기화 실패: " + error.message);
    });
}

document.addEventListener("DOMContentLoaded", init);
