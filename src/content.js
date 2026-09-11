(function initializePropertyExcluder() {
  "use strict";

  const HAZARD_API_URL = "https://zht5wuwzjb.execute-api.ap-northeast-1.amazonaws.com/default/hazard_api_function";
  const HAZARD_RETRY_DELAY_MS = 500;
  const HAZARD_MAX_RETRIES = 20;
  const BUILDING_AREA_OPTION_VALUE = "150";

  const core = globalThis.PropertyExcluderCore;
  if (!core) {
    return;
  }

  installBuildingAreaOptionEnhancement();

  if (!core.isSupportedPathname(location.pathname)) {
    return;
  }

  const state = {
    records: new Map(),
    settings: { ...core.DEFAULT_SETTINGS },
    collapsedRejected: new Set(),
    hazard: {
      coordinateKey: "",
      response: null,
      status: "idle",
      open: false,
      retryCount: 0,
      retryTimer: null
    },
    scanScheduled: false
  };

  function createElement(tagName, options = {}) {
    const element = document.createElement(tagName);
    if (options.className) element.className = options.className;
    if (options.text !== undefined) element.textContent = options.text;
    if (options.type) element.type = options.type;
    if (options.attributes) {
      Object.entries(options.attributes).forEach(([name, value]) => {
        element.setAttribute(name, value);
      });
    }
    return element;
  }

  function enhanceBuildingAreaOptions() {
    document.querySelectorAll('select[name="b10"]').forEach((select) => {
      if (select.querySelector(`option[value="${BUILDING_AREA_OPTION_VALUE}"]`)) {
        return;
      }

      const sourceOption = select.querySelector('option[value="100"]');
      const option = document.createElement("option");
      option.value = BUILDING_AREA_OPTION_VALUE;
      option.textContent = "150平米以上";

      if (sourceOption) {
        [...sourceOption.attributes].forEach((attribute) => {
          if (attribute.name !== "value" && attribute.name !== "selected") {
            option.setAttribute(attribute.name, attribute.value);
          }
        });
      }

      select.append(option);
    });
  }

  function installBuildingAreaOptionEnhancement() {
    enhanceBuildingAreaOptions();

    const observer = new MutationObserver(() => {
      enhanceBuildingAreaOptions();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function currentRecord(propertyId) {
    return state.records.get(propertyId) || core.emptyRecord(propertyId);
  }

  function normalizedUrl(url) {
    try {
      const parsed = new URL(url, location.origin);
      parsed.search = "";
      parsed.hash = "";
      return parsed.href;
    } catch (_error) {
      return location.href;
    }
  }

  function findMapCoordinates() {
    const map = document.querySelector(
      "#detailSurroundingMap[data-latitude][data-longitude]"
    ) || document.querySelector("[data-latitude][data-longitude]");
    if (!map) return null;

    const latitude = Number(map.getAttribute("data-latitude"));
    const longitude = Number(map.getAttribute("data-longitude"));
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return {
      latitude,
      longitude,
      key: `${latitude},${longitude}`
    };
  }

  function findAddressRow() {
    const marker = [...document.querySelectorAll("svg use")].find((use) => {
      const href = use.getAttribute("href") || use.getAttribute("xlink:href") || "";
      return href.includes("#map-marker");
    });
    return marker?.closest(".box.is-flex") || null;
  }

  function ensureHazardPanel() {
    const addressRow = findAddressRow();
    if (!addressRow) return null;

    const parent = addressRow.parentElement;
    const existing = parent?.querySelector(":scope > .pe-hazard-panel");
    if (existing) return existing;

    const panel = createElement("div", {
      className: "pe-root pe-hazard-panel"
    });
    const button = createElement("button", {
      className: "pe-hazard-button",
      text: "ハザード情報",
      type: "button",
      attributes: { "aria-expanded": "false" }
    });
    const popover = createElement("div", {
      className: "pe-hazard-popover",
      attributes: { hidden: "" }
    });

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      state.hazard.open = !state.hazard.open;
      if (state.hazard.open && ["idle", "error", "unavailable"].includes(state.hazard.status)) {
        state.hazard.status = "idle";
        state.hazard.retryCount = 0;
        renderHazardPanel("loading");
        loadHazardInfo();
        return;
      }
      renderHazardPanel(state.hazard.status, state.hazard.response);
    });

    panel.append(button, popover);
    addressRow.insertAdjacentElement("afterend", panel);
    return panel;
  }

  function formatProbability(data) {
    if (!data || typeof data !== "object") return "データなし";

    const format = (value) => {
      const number = Number(value);
      return Number.isFinite(number) ? `${Math.floor(number * 100)}%` : "データなし";
    };
    return `周辺100m最大: ${format(data.max_prob)} / 中心点: ${format(data.center_prob)}`;
  }

  function formatHazardRange(data) {
    if (!data || typeof data !== "object") return "データなし";

    const max = data.max_info ?? "データなし";
    const center = data.center_info ?? "データなし";
    return `周辺100m最大: ${max} / 中心点: ${center}`;
  }

  function formatLandslide(data) {
    if (!data || typeof data !== "object") return "データなし";

    return [
      ["土石流", data.debris_flow],
      ["急傾斜地", data.steep_slope],
      ["地すべり", data.landslide]
    ]
      .map(([label, value]) => `${label}: ${formatHazardRange(value)}`)
      .join("\n");
  }

  function hazardRows(hazardInfo) {
    return [
      ["30年以内に震度5強以上の地震", formatProbability(hazardInfo.jshis_prob_50)],
      ["30年以内に震度6弱以上の地震", formatProbability(hazardInfo.jshis_prob_55)],
      ["30年以内に震度6強以上の地震", formatProbability(hazardInfo.jshis_prob_60)],
      ["想定最大浸水深", formatHazardRange(hazardInfo.inundation_depth)],
      ["浸水継続時間", formatHazardRange(hazardInfo.flood_keizoku)],
      ["内水浸水想定区域", formatHazardRange(hazardInfo.naisui_inundation)],
      ["家屋倒壊等氾濫想定区域（氾濫流）", formatHazardRange(hazardInfo.kaokutoukai_hanran)],
      ["家屋倒壊等氾濫想定区域（河岸侵食）", formatHazardRange(hazardInfo.kaokutoukai_kagan)],
      ["津波浸水想定", formatHazardRange(hazardInfo.tsunami_inundation)],
      ["高潮浸水想定", formatHazardRange(hazardInfo.hightide_inundation)],
      ["土砂災害警戒・特別警戒区域", formatLandslide(hazardInfo.landslide_hazard)],
      ["大規模盛土造成地", formatHazardRange(hazardInfo.large_fill_land)],
      ["雪崩危険箇所", formatHazardRange(hazardInfo.avalanche)]
    ];
  }

  function renderHazardPanel(status, payload = null) {
    const panel = ensureHazardPanel();
    if (!panel) return false;

    const button = panel.querySelector(":scope > .pe-hazard-button");
    const popover = panel.querySelector(":scope > .pe-hazard-popover");
    if (!button || !popover) return false;

    panel.classList.toggle("pe-hazard-panel--error", status === "error");
    button.textContent = "ハザード情報";
    button.setAttribute("aria-expanded", String(state.hazard.open));
    popover.hidden = !state.hazard.open;
    popover.replaceChildren();
    if (!state.hazard.open) return true;

    if (status === "loading") {
      popover.append(createElement("p", {
        className: "pe-hazard-message",
        text: "ハザード情報を取得中…"
      }));
      return true;
    }

    const body = createElement("div", { className: "pe-hazard-body" });
    if (status === "error") {
      body.append(createElement("p", {
        className: "pe-hazard-message",
        text: "ハザード情報を取得できませんでした。"
      }));
      popover.append(body);
      return true;
    }

    if (status === "unavailable") {
      body.append(createElement("p", {
        className: "pe-hazard-message",
        text: "Googleマップの座標を取得できませんでした。"
      }));
      popover.append(body);
      return true;
    }

    const rows = createElement("dl", { className: "pe-hazard-list" });
    hazardRows(payload?.hazard_info || {}).forEach(([label, value]) => {
      rows.append(
        createElement("dt", { className: "pe-hazard-label", text: label }),
        createElement("dd", { className: "pe-hazard-value", text: value })
      );
    });
    body.append(rows);
    popover.append(body);
    return true;
  }

  function scheduleHazardInfo() {
    if (state.hazard.retryTimer || ["loading", "loaded", "error", "unavailable"].includes(state.hazard.status)) {
      return;
    }

    state.hazard.retryTimer = window.setTimeout(() => {
      state.hazard.retryTimer = null;
      loadHazardInfo();
    }, HAZARD_RETRY_DELAY_MS);
  }

  async function loadHazardInfo() {
    const coordinates = findMapCoordinates();
    if (!coordinates) {
      state.hazard.retryCount += 1;
      if (state.hazard.retryCount <= HAZARD_MAX_RETRIES) {
        scheduleHazardInfo();
      } else {
        state.hazard.status = "unavailable";
        renderHazardPanel("unavailable");
      }
      return;
    }

    if (state.hazard.coordinateKey === coordinates.key && state.hazard.status === "loaded") {
      renderHazardPanel("loaded", state.hazard.response);
      return;
    }

    state.hazard.coordinateKey = coordinates.key;
    state.hazard.status = "loading";
    state.hazard.retryCount = 0;
    renderHazardPanel("loading");

    try {
      const url = new URL(HAZARD_API_URL);
      url.searchParams.set("lat", String(coordinates.latitude));
      url.searchParams.set("lon", String(coordinates.longitude));
      url.searchParams.set("precision", "low");

      const response = await fetch(url.href);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const payload = await response.json();
      if (payload.status !== "success") throw new Error("API returned an error");

      state.hazard.response = payload;
      state.hazard.status = "loaded";
      renderHazardPanel("loaded", payload);
    } catch (error) {
      console.error("[逆お気に入り] ハザード情報の取得に失敗しました", error);
      state.hazard.status = "error";
      renderHazardPanel("error");
    }
  }

  function showToast(message, isError = false) {
    const previous = document.querySelector(".pe-toast");
    if (previous) previous.remove();

    const toast = createElement("div", {
      className: `pe-toast${isError ? " pe-toast--error" : ""}`,
      text: message,
      attributes: { role: "status" }
    });
    document.body.append(toast);
    window.setTimeout(() => toast.remove(), 2200);
  }

  function statusBadge(record) {
    const meta = core.STATUS_META[record.status];
    return createElement("span", {
      className: `pe-status pe-status--${record.status}`,
      text: `${meta.symbol} ${meta.label}`
    });
  }

  function recordDescription(record) {
    const parts = [];
    if (record.status === core.STATUS.REJECTED && record.reasons.length) {
      parts.push(record.reasons.join("・"));
    }
    if (record.memo) parts.push(record.memo);
    return parts.join("｜");
  }

  function createEditor(record, context) {
    const form = createElement("form", {
      className: `pe-editor${context.compact ? " pe-editor--compact" : ""}`
    });
    form.dataset.propertyExcluder = "editor";

    const statusFieldset = createElement("fieldset", { className: "pe-fieldset" });
    statusFieldset.append(createElement("legend", { className: "pe-label", text: "状態" }));
    const statusChoices = createElement("div", {
      className: "pe-status-choices",
      attributes: { role: "group", "aria-label": "物件の状態" }
    });

    let selectedStatus = record.status;
    const selectedReasons = new Set(record.reasons);
    const statusButtons = new Map();

    function refreshStatusControls() {
      statusButtons.forEach((button, status) => {
        const selected = status === selectedStatus;
        button.classList.toggle("is-selected", selected);
        button.setAttribute("aria-pressed", String(selected));
      });

      const enabled = selectedStatus === core.STATUS.REJECTED;
      reasonsFieldset.disabled = !enabled;
      reasonsFieldset.classList.toggle("is-disabled", !enabled);
    }

    Object.values(core.STATUS).forEach((status) => {
      const meta = core.STATUS_META[status];
      const button = createElement("button", {
        className: `pe-status-choice pe-status-choice--${status}`,
        text: `${meta.symbol} ${meta.label}`,
        type: "button",
        attributes: { "aria-pressed": "false" }
      });
      button.addEventListener("click", () => {
        selectedStatus = status;
        refreshStatusControls();
      });
      statusButtons.set(status, button);
      statusChoices.append(button);
    });
    statusFieldset.append(statusChoices);

    const reasonsFieldset = createElement("fieldset", { className: "pe-fieldset pe-reasons" });
    reasonsFieldset.append(createElement("legend", { className: "pe-label", text: "却下理由（複数選択可）" }));
    const reasonChoices = createElement("div", { className: "pe-reason-choices" });
    core.REJECTION_REASONS.forEach((reason) => {
      const label = createElement("label", { className: "pe-reason" });
      const checkbox = createElement("input", { type: "checkbox" });
      checkbox.value = reason;
      checkbox.checked = selectedReasons.has(reason);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedReasons.add(reason);
        else selectedReasons.delete(reason);
      });
      label.append(checkbox, createElement("span", { text: reason }));
      reasonChoices.append(label);
    });
    reasonsFieldset.append(reasonChoices);

    const memoLabel = createElement("label", { className: "pe-memo" });
    memoLabel.append(createElement("span", { className: "pe-label", text: "一言メモ" }));
    const memo = createElement("textarea", {
      attributes: {
        maxlength: "200",
        rows: context.compact ? "2" : "3",
        placeholder: "例：前面道路が狭く、車の出し入れが難しそう"
      }
    });
    memo.value = record.memo;
    memoLabel.append(memo);

    const actions = createElement("div", { className: "pe-actions" });
    const saveButton = createElement("button", {
      className: "pe-button pe-button--primary",
      text: "保存",
      type: "submit"
    });
    const resetButton = createElement("button", {
      className: "pe-button pe-button--quiet",
      text: "未評価に戻す",
      type: "button"
    });
    resetButton.addEventListener("click", async () => {
      await persistRecord({
        propertyId: context.propertyId,
        status: core.STATUS.UNRATED,
        reasons: [],
        memo: "",
        title: context.title,
        url: context.url
      });
    });
    actions.append(saveButton, resetButton);

    form.append(statusFieldset, reasonsFieldset, memoLabel, actions);
    refreshStatusControls();

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      saveButton.disabled = true;
      const succeeded = await persistRecord({
        propertyId: context.propertyId,
        status: selectedStatus,
        reasons: [...selectedReasons],
        memo: memo.value,
        title: context.title,
        url: context.url
      });
      if (!succeeded) saveButton.disabled = false;
    });

    return form;
  }

  async function persistRecord(value) {
    try {
      const saved = await core.saveRecord(value);
      if (core.isEffectivelyEmpty(saved)) state.records.delete(saved.propertyId);
      else state.records.set(saved.propertyId, saved);
      renderProperty(saved.propertyId);
      showToast("判断を保存しました");
      return true;
    } catch (error) {
      console.error("[逆お気に入り] 保存に失敗しました", error);
      showToast("保存できませんでした", true);
      return false;
    }
  }

  function findCardRoot(anchor) {
    const preferred = anchor.closest(".card.is-bg-light.is-floating-shadow");
    if (preferred) return preferred;

    const listItem = anchor.closest("li");
    if (!listItem) return null;

    const candidate = listItem.firstElementChild;
    if (candidate?.querySelector('a[href*="/detail_"]')) {
      return candidate;
    }

    return null;
  }

  function cardWrapper(card) {
    return card.parentElement && card.parentElement.tagName === "LI" ? card.parentElement : card;
  }

  function renderCard(card, propertyId) {
    const record = currentRecord(propertyId);
    const rejected = record.status === core.STATUS.REJECTED;
    if (!rejected) state.collapsedRejected.delete(propertyId);
    const collapsed = rejected && state.collapsedRejected.has(propertyId);
    const panel = card.querySelector(":scope > .pe-card-panel") || createElement("div", {
      className: "pe-root pe-card-panel"
    });
    const title = (card.querySelector("h2")?.textContent || record.title || "中古一戸建て")
      .trim()
      .replace(/\s+/g, " ");
    const link = card.querySelector(`a[href*="detail_${propertyId}"]`);
    const url = normalizedUrl(link?.href || record.url || location.href);

    if (!panel.parentElement) card.prepend(panel);
    card.dataset.peCardId = propertyId;
    card.classList.toggle("pe-card--rejected", rejected);
    card.classList.toggle("pe-card--collapsed", collapsed);

    const summary = createElement("button", {
      className: "pe-card-summary",
      type: "button",
      attributes: { "aria-expanded": "false" }
    });
    summary.append(statusBadge(record));
    const description = recordDescription(record);
    summary.append(createElement("span", {
      className: `pe-card-description${description ? "" : " is-empty"}`,
      text: description || "クリックして判断を記録"
    }));
    summary.append(createElement("span", { className: "pe-card-edit", text: "編集" }));

    summary.addEventListener("click", () => {
      const expanded = summary.getAttribute("aria-expanded") === "true";
      if (expanded) {
        renderCard(card, propertyId);
        return;
      }
      summary.setAttribute("aria-expanded", "true");
      panel.append(createEditor(record, {
        compact: true,
        propertyId,
        title,
        url
      }));
    });

    const header = createElement("div", { className: "pe-card-header" });
    header.append(summary);

    if (rejected) {
      const collapseButton = createElement("button", {
        className: "pe-card-collapse",
        text: collapsed ? "展開" : "折り畳む",
        type: "button",
        attributes: {
          "aria-expanded": String(!collapsed),
          "aria-label": collapsed ? "却下済みカードを展開" : "却下済みカードを折り畳む"
        }
      });
      collapseButton.addEventListener("click", () => {
        if (collapsed) state.collapsedRejected.delete(propertyId);
        else state.collapsedRejected.add(propertyId);
        renderCard(card, propertyId);
      });
      header.append(collapseButton);
    }

    panel.replaceChildren(header);
    cardWrapper(card).classList.toggle(
      "pe-is-hidden",
      state.settings.hideRejected && record.status === core.STATUS.REJECTED
    );
  }

  function renderDetail(panel, propertyId) {
    const record = currentRecord(propertyId);
    const title = (document.querySelector("h1")?.textContent || record.title || "中古一戸建て")
      .trim()
      .replace(/\s+/g, " ");
    const url = normalizedUrl(location.href);

    panel.className = `pe-root pe-detail-panel pe-detail-panel--${record.status}`;
    const heading = createElement("div", { className: "pe-detail-heading" });
    const headingText = createElement("div");
    headingText.append(
      createElement("p", { className: "pe-eyebrow", text: "逆お気に入り" }),
      createElement("h2", { className: "pe-title", text: "この物件の判断" })
    );
    heading.append(headingText, statusBadge(record));

    if (record.status === core.STATUS.REJECTED) {
      const warning = createElement("div", {
        className: "pe-rejected-warning",
        text: recordDescription(record) || "この物件は却下済みです。"
      });
      panel.replaceChildren(heading, warning, createEditor(record, {
        compact: false,
        propertyId,
        title,
        url
      }));
      return;
    }

    panel.replaceChildren(heading, createEditor(record, {
      compact: false,
      propertyId,
      title,
      url
    }));
  }

  function renderProperty(propertyId) {
    document.querySelectorAll(`[data-pe-card-id="${propertyId}"]`).forEach((card) => {
      renderCard(card, propertyId);
    });
    document.querySelectorAll(`[data-pe-detail-id="${propertyId}"]`).forEach((panel) => {
      renderDetail(panel, propertyId);
    });
    updateFilterSummary();
  }

  function scanDetailPage() {
    const propertyId = core.extractPropertyId(location.href);
    if (!propertyId) return;

    const existingPanel = document.querySelector(`[data-pe-detail-id="${propertyId}"]`);
    if (existingPanel) {
      ensureHazardPanel();
      return;
    }

    const summary = document.querySelector("#summary");
    const heading = summary?.querySelector("h1") || document.querySelector("main h1");
    if (!heading) return;

    const panel = createElement("section", { className: "pe-root pe-detail-panel" });
    panel.dataset.peDetailId = propertyId;

    if (summary && summary.contains(heading)) {
      let headingBlock = heading;
      while (headingBlock.parentElement && headingBlock.parentElement !== summary) {
        headingBlock = headingBlock.parentElement;
      }
      headingBlock.insertAdjacentElement("afterend", panel);
    } else {
      heading.insertAdjacentElement("afterend", panel);
    }
    renderDetail(panel, propertyId);
    ensureHazardPanel();
  }

  function scanListPage() {
    const seenCards = new Set();
    const resultList = document.querySelector('[data-contents-id="result-bukken-list"]');
    if (!resultList) return;

    resultList.querySelectorAll('a[href*="/chuko-ikkodate/"][href*="/detail_"]').forEach((anchor) => {
      const propertyId = core.extractPropertyId(anchor.href);
      const card = findCardRoot(anchor);
      if (!propertyId || !card || seenCards.has(card)) return;
      seenCards.add(card);
      if (card.dataset.peCardId !== propertyId) {
        card.querySelector(":scope > .pe-card-panel")?.remove();
        card.classList.remove("pe-card--rejected");
        card.dataset.peCardId = propertyId;
        renderCard(card, propertyId);
      }
    });
    ensureFilterControl();
    updateFilterSummary();
  }

  function ensureFilterControl() {
    if (document.querySelector(".pe-filter")) return;
    const firstCard = document.querySelector("[data-pe-card-id]");
    if (!firstCard) return;

    const wrapper = cardWrapper(firstCard);
    const list = wrapper.parentElement;
    if (!list) return;

    const filter = createElement("div", { className: "pe-root pe-filter" });
    filter.dataset.propertyExcluder = "filter";
    const label = createElement("label", { className: "pe-filter-label" });
    const checkbox = createElement("input", { type: "checkbox" });
    checkbox.checked = state.settings.hideRejected;
    checkbox.addEventListener("change", async () => {
      state.settings = await core.saveSettings({ hideRejected: checkbox.checked });
      document.querySelectorAll("[data-pe-card-id]").forEach((card) => {
        const record = currentRecord(card.dataset.peCardId);
        cardWrapper(card).classList.toggle(
          "pe-is-hidden",
          state.settings.hideRejected && record.status === core.STATUS.REJECTED
        );
      });
      updateFilterSummary();
    });
    label.append(checkbox, createElement("span", { text: "却下済みを非表示" }));
    filter.append(
      label,
      createElement("span", { className: "pe-filter-count", text: "" })
    );
    list.insertAdjacentElement("beforebegin", filter);
  }

  function updateFilterSummary() {
    const cards = [...document.querySelectorAll("[data-pe-card-id]")];
    const rejectedCount = cards.filter((card) => (
      currentRecord(card.dataset.peCardId).status === core.STATUS.REJECTED
    )).length;
    const count = document.querySelector(".pe-filter-count");
    const nextText = `このページの却下済み ${rejectedCount}件`;
    if (count && count.textContent !== nextText) count.textContent = nextText;
  }

  function scanPage() {
    state.scanScheduled = false;
    if (core.extractPropertyId(location.href)) scanDetailPage();
    else scanListPage();
  }

  function scheduleScan() {
    if (state.scanScheduled) return;
    state.scanScheduled = true;
    window.setTimeout(scanPage, 100);
  }

  function installRejectedNavigationGuard() {
    document.addEventListener("click", (event) => {
      const anchor = event.target.closest?.("a[href]");
      const card = anchor?.closest?.("[data-pe-card-id]");
      if (!anchor || !card || anchor.closest(".pe-root")) return;
      if (core.extractPropertyId(anchor.href) !== card.dataset.peCardId) return;

      const record = currentRecord(card.dataset.peCardId);
      if (record.status !== core.STATUS.REJECTED) return;

      const detail = recordDescription(record);
      const message = [
        "この物件は却下済みです。",
        detail ? `理由・メモ：${detail}` : "",
        "それでも詳細を開きますか？"
      ].filter(Boolean).join("\n\n");

      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    }, true);
  }

  function installHazardPopoverGuard() {
    document.addEventListener("click", (event) => {
      if (event.target.closest?.(".pe-hazard-panel")) return;
      if (!state.hazard.open) return;

      state.hazard.open = false;
      renderHazardPanel(state.hazard.status, state.hazard.response);
    }, true);

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !state.hazard.open) return;

      state.hazard.open = false;
      renderHazardPanel(state.hazard.status, state.hazard.response);
    });
  }

  async function start() {
    try {
      const [records, settings] = await Promise.all([
        core.loadAllRecords(),
        core.loadSettings()
      ]);
      records.forEach((record) => state.records.set(record.propertyId, record));
      state.settings = settings;
    } catch (error) {
      console.error("[逆お気に入り] 保存データを読み込めませんでした", error);
    }

    scanPage();
    installRejectedNavigationGuard();
    installHazardPopoverGuard();

    const observer = new MutationObserver((mutations) => {
      const hasSiteMutation = mutations.some((mutation) => (
        !mutation.target.closest?.(".pe-root") && mutation.addedNodes.length > 0
      ));
      if (hasSiteMutation) scheduleScan();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== "local") return;

      Object.entries(changes).forEach(([key, change]) => {
        if (key === core.SETTINGS_KEY) {
          state.settings = core.sanitizeSettings(change.newValue);
          const checkbox = document.querySelector(".pe-filter input[type='checkbox']");
          if (checkbox) checkbox.checked = state.settings.hideRejected;
          document.querySelectorAll("[data-pe-card-id]").forEach((card) => {
            renderCard(card, card.dataset.peCardId);
          });
          return;
        }

        if (!key.startsWith(core.STORAGE_PREFIX)) return;
        const propertyId = key.slice(core.STORAGE_PREFIX.length);
        if (change.newValue === undefined) state.records.delete(propertyId);
        else state.records.set(propertyId, core.sanitizeRecord(change.newValue, propertyId));
        renderProperty(propertyId);
      });
    });
  }

  start();
})();
