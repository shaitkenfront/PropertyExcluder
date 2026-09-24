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

  function formatUpdatedAt(updatedAt) {
    if (!updatedAt) {
      return "";
    }

    const date = new Date(updatedAt);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat("ja-JP", {
      month: "numeric",
      day: "numeric"
    }).format(date);
  }

  const viewState = {
    status: null,
    visibleLimit: 5
  };

  function sortedRecords(records) {
    return [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  function setTransferBusy(isBusy) {
    document.querySelector("#export-data").disabled = isBusy;
    document.querySelector("#import-data").disabled = isBusy;
  }

  function setTransferStatus(message, isError = false) {
    const status = document.querySelector("#transfer-status");
    status.textContent = message;
    status.dataset.error = String(isError);
  }

  function exportFilename(date = new Date()) {
    const year = String(date.getFullYear());
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `property-excluder-${year}-${month}-${day}.json`;
  }

  function downloadJson(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFilename();
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function renderList(records) {
    const list = document.querySelector("#recent-list");
    const title = document.querySelector("#recent-title");
    const recentView = document.querySelector("#recent-view");
    const listMore = document.querySelector("#list-more");
    const isStatusView = viewState.status !== null;
    const filtered = isStatusView
      ? records.filter((record) => record.status === viewState.status)
      : records;
    const sorted = sortedRecords(filtered);
    const visible = sorted.slice(0, viewState.visibleLimit);

    title.textContent = isStatusView
      ? `${core.STATUS_META[viewState.status].label}の物件 ${sorted.length}件`
      : "最近の判断";
    recentView.hidden = !isStatusView;
    list.replaceChildren();

    if (!sorted.length) {
      list.append(createElement(
        "div",
        "empty",
        isStatusView ? `まだ${core.STATUS_META[viewState.status].label}の物件はありません` : "まだ判断は保存されていません"
      ));
    } else {
      visible.forEach((record) => {
        const item = createElement("article", "recent-item");
        const link = createElement(record.url ? "a" : "div", "recent-link");
        if (record.url) {
          link.href = record.url;
          link.target = "_blank";
          link.rel = "noreferrer";
        }

        const meta = core.STATUS_META[record.status];
        link.append(createElement(
          "span",
          `badge badge--${record.status}`,
          meta.label
        ));

        const text = createElement("div", "recent-text");
        text.append(
          createElement("p", "recent-title", record.title || `物件 ${record.propertyId.slice(0, 8)}`),
          createElement("p", "recent-note", displayNote(record))
        );
        link.append(text);

        const date = formatUpdatedAt(record.updatedAt);
        if (date) {
          link.append(createElement("time", "recent-date", date));
        }

        const actions = createElement("div", "recent-actions");
        const menuButton = createElement("button", "recent-menu-toggle", "…");
        menuButton.type = "button";
        menuButton.setAttribute("aria-label", `${record.title || "物件"}のメニュー`);
        menuButton.setAttribute("aria-haspopup", "true");
        menuButton.setAttribute("aria-expanded", "false");
        const menu = createElement("div", "recent-menu");
        menu.hidden = true;
        menu.setAttribute("role", "menu");
        const rejectButton = createElement("button", "recent-menu-item", "却下する");
        rejectButton.type = "button";
        rejectButton.setAttribute("role", "menuitem");
        rejectButton.disabled = record.status === core.STATUS.REJECTED;
        if (rejectButton.disabled) rejectButton.textContent = "却下済み";
        rejectButton.addEventListener("click", async () => {
          rejectButton.disabled = true;
          try {
            await core.saveRecord({
              ...record,
              status: core.STATUS.REJECTED,
              reasons: record.reasons
            });
            await render();
          } catch (error) {
            console.error("[逆お気に入り] 物件を却下できませんでした", error);
            rejectButton.textContent = "却下できませんでした";
            rejectButton.disabled = false;
          }
        });
        menu.append(rejectButton);
        menuButton.addEventListener("click", () => {
          const open = menu.hidden;
          document.querySelectorAll(".recent-menu").forEach((otherMenu) => {
            otherMenu.hidden = true;
            otherMenu.parentElement?.querySelector(".recent-menu-toggle")?.setAttribute("aria-expanded", "false");
          });
          menu.hidden = !open;
          menuButton.setAttribute("aria-expanded", String(open));
          if (open) rejectButton.focus();
        });
        actions.append(menuButton, menu);
        item.append(link, actions);
        list.append(item);
      });
    }

    listMore.hidden = visible.length >= sorted.length;
    listMore.textContent = `さらに表示（残り${Math.max(0, sorted.length - visible.length)}件）`;
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest(".recent-actions")) return;
    document.querySelectorAll(".recent-menu").forEach((menu) => {
      menu.hidden = true;
      menu.parentElement?.querySelector(".recent-menu-toggle")?.setAttribute("aria-expanded", "false");
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    document.querySelectorAll(".recent-menu:not([hidden])").forEach((menu) => {
      menu.hidden = true;
      const toggle = menu.parentElement?.querySelector(".recent-menu-toggle");
      toggle?.setAttribute("aria-expanded", "false");
      toggle?.focus();
    });
  });

  async function render() {
    await core.migrateMemoContainingSouthToHoldOnce();
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

    document.querySelectorAll(".count[data-status]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.status === viewState.status));
    });

    renderList(records);
  }

  document.querySelectorAll(".count[data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      viewState.status = button.dataset.status;
      viewState.visibleLimit = 5;
      render().catch((error) => {
        console.error("[逆お気に入り] 一覧を表示できませんでした", error);
      });
    });
  });

  document.querySelector("#recent-view").addEventListener("click", () => {
    viewState.status = null;
    viewState.visibleLimit = 5;
    render().catch((error) => {
      console.error("[逆お気に入り] 最近の判断を表示できませんでした", error);
    });
  });

  document.querySelector("#list-more").addEventListener("click", () => {
    viewState.visibleLimit += 5;
    render().catch((error) => {
      console.error("[逆お気に入り] 一覧を追加表示できませんでした", error);
    });
  });

  document.querySelector("#export-data").addEventListener("click", async () => {
    setTransferBusy(true);
    setTransferStatus("");
    try {
      const data = await core.exportData();
      downloadJson(data);
      setTransferStatus(`${data.records.length}件の判定情報を書き出しました`);
    } catch (error) {
      console.error("[逆お気に入り] エクスポートできませんでした", error);
      setTransferStatus("エクスポートできませんでした", true);
    } finally {
      setTransferBusy(false);
    }
  });

  const importFile = document.querySelector("#import-file");
  document.querySelector("#import-data").addEventListener("click", () => {
    importFile.click();
  });

  importFile.addEventListener("change", async () => {
    const [file] = importFile.files;
    importFile.value = "";
    if (!file) {
      return;
    }

    setTransferBusy(true);
    setTransferStatus("");
    try {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error("ファイルサイズが5MBを超えています");
      }

      const data = JSON.parse(await file.text());
      const preview = core.sanitizeImportData(data);
      const shouldImport = globalThis.confirm(
        `${preview.records.length}件の判定情報をインポートします。\n同じ物件IDの情報は上書きされます。`
      );
      if (!shouldImport) {
        setTransferStatus("インポートをキャンセルしました");
        return;
      }

      const result = await core.importData(data);
      const ignoredText = result.ignored ? `（無効な${result.ignored}件を除外）` : "";
      setTransferStatus(`${result.imported}件の判定情報を読み込みました${ignoredText}`);
      await render();
    } catch (error) {
      console.error("[逆お気に入り] インポートできませんでした", error);
      const message = error instanceof SyntaxError
        ? "JSONファイルを読み込めませんでした"
        : error.message || "インポートできませんでした";
      setTransferStatus(message, true);
    } finally {
      setTransferBusy(false);
    }
  });

  render().catch((error) => {
    console.error("[逆お気に入り] ポップアップを表示できませんでした", error);
  });

  chrome.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === "local") render();
  });
})();
