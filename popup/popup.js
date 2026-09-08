(function initializePopup() {
  "use strict";

  const core = globalThis.PropertyExcluderCore;

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function displayNote(record) {
    if (record.status === core.STATUS.REJECTED && record.reasons.length) {
      return record.reasons.join("・");
    }
    return record.memo || "メモなし";
  }

  async function render() {
    const records = await core.loadAllRecords();
    const evaluated = records.filter((record) => record.status !== core.STATUS.UNRATED);

    document.querySelector("#candidate-count").textContent = String(
      evaluated.filter((record) => record.status === core.STATUS.CANDIDATE).length
    );
    document.querySelector("#hold-count").textContent = String(
      evaluated.filter((record) => record.status === core.STATUS.HOLD).length
    );
    document.querySelector("#rejected-count").textContent = String(
      evaluated.filter((record) => record.status === core.STATUS.REJECTED).length
    );

    const recentList = document.querySelector("#recent-list");
    recentList.replaceChildren();
    const recent = [...records]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5);

    if (!recent.length) {
      recentList.append(createElement("div", "empty", "まだ判断は保存されていません"));
      return;
    }

    recent.forEach((record) => {
      const item = createElement(record.url ? "a" : "div", "recent-item");
      if (record.url) {
        item.href = record.url;
        item.target = "_blank";
        item.rel = "noreferrer";
      }

      const meta = core.STATUS_META[record.status];
      item.append(createElement(
        "span",
        `badge badge--${record.status}`,
        meta.label
      ));

      const text = createElement("div", "recent-text");
      text.append(
        createElement("p", "recent-title", record.title || `物件 ${record.propertyId.slice(0, 8)}`),
        createElement("p", "recent-note", displayNote(record))
      );
      item.append(text);
      recentList.append(item);
    });
  }

  render().catch((error) => {
    console.error("[逆お気に入り] ポップアップを表示できませんでした", error);
  });

  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === "local") render();
  });
})();
