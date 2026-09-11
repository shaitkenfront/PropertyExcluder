(function initializePropertyExcluder() {
  "use strict";

  const core = globalThis.PropertyExcluderCore;
  if (!core || !core.isSupportedPathname(location.pathname)) {
    return;
  }

  const state = {
    records: new Map(),
    settings: { ...core.DEFAULT_SETTINGS },
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
    card.classList.toggle("pe-card--rejected", record.status === core.STATUS.REJECTED);

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

    panel.replaceChildren(summary);
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
    if (!propertyId || document.querySelector(`[data-pe-detail-id="${propertyId}"]`)) return;

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
