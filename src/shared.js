(function exposePropertyExcluderCore(root, factory) {
  const api = factory();

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }

  root.PropertyExcluderCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCore() {
  "use strict";

  const STORAGE_PREFIX = "propertyExcluder:property:";
  const SETTINGS_KEY = "propertyExcluder:settings";
  const MEMO_SOUTH_TO_HOLD_MIGRATION_KEY = "propertyExcluder:migration:memo-contains-south-to-hold:v1";
  const SCHEMA_VERSION = 1;
  const EXPORT_FORMAT = "property-excluder";
  const EXPORT_VERSION = 1;

  const STATUS = Object.freeze({
    UNRATED: "unrated",
    CANDIDATE: "candidate",
    HOLD: "hold",
    REJECTED: "rejected"
  });

  const STATUS_META = Object.freeze({
    [STATUS.UNRATED]: Object.freeze({ label: "未評価", symbol: "○" }),
    [STATUS.CANDIDATE]: Object.freeze({ label: "候補", symbol: "★" }),
    [STATUS.HOLD]: Object.freeze({ label: "保留", symbol: "△" }),
    [STATUS.REJECTED]: Object.freeze({ label: "却下", symbol: "×" })
  });

  const REJECTION_REASONS = Object.freeze([
    "価格",
    "立地",
    "駅距離",
    "築年数",
    "狭さ",
    "間取り",
    "接道・再建築",
    "災害リスク",
    "周辺環境",
    "建物状態",
    "駐車場",
    "その他"
  ]);

  const MEMO_SHORTCUTS = Object.freeze([
    "部屋数不足",
    "1F部屋数不足",
    "1F南向き部屋不足",
    "2Fトイレなし",
    "ハザード情報未取得",
    "2Fリビング",
    "3階建て"
  ]);

  const DEFAULT_SETTINGS = Object.freeze({
    hideRejected: false
  });

  function extractPropertyId(url) {
    if (typeof url !== "string") {
      return null;
    }

    const match = url.match(/\/(?:chuko-ikkodate|rent)\/[^?#]*\/detail_([a-f0-9]{32})(?:\/|[?#]|$)/i);
    return match ? match[1].toLowerCase() : null;
  }

  function extractDetailPropertyId(url, canonicalUrl) {
    return extractPropertyId(url) || extractPropertyId(canonicalUrl);
  }

  function extractListPropertyId(url, activityLogDetailData) {
    const propertyId = extractPropertyId(url);
    if (propertyId) return propertyId;

    // 外部サイト直リンクのカードにもnifty側の物件IDが付いている。
    // data-detail-id/data-detail-linkは掲載元の別IDなので使用しない。
    if (typeof activityLogDetailData !== "string") return null;
    const match = activityLogDetailData.match(/^([a-f0-9]{32})\|\|buh$/i);
    return match ? match[1].toLowerCase() : null;
  }

  function isSupportedPathname(pathname) {
    if (typeof pathname !== "string") {
      return false;
    }

    return /^\/chuko-ikkodate\/[^/]+\/[^/]+(?:\/|$)/.test(pathname)
      || /^\/rent(?:\/|$)/.test(pathname);
  }

  function propertyStorageKey(propertyId) {
    return `${STORAGE_PREFIX}${propertyId}`;
  }

  function emptyRecord(propertyId) {
    return {
      schemaVersion: SCHEMA_VERSION,
      propertyId,
      status: STATUS.UNRATED,
      reasons: [],
      memo: "",
      title: "",
      url: "",
      updatedAt: ""
    };
  }

  function isKnownStatus(value) {
    return Object.prototype.hasOwnProperty.call(STATUS_META, value);
  }

  function cleanText(value, maximumLength) {
    return typeof value === "string" ? value.trim().slice(0, maximumLength) : "";
  }

  function sanitizeRecord(value, propertyId) {
    const source = value && typeof value === "object" ? value : {};
    const id = propertyId || cleanText(source.propertyId, 64);
    const status = isKnownStatus(source.status) ? source.status : STATUS.UNRATED;
    const allowedReasons = new Set(REJECTION_REASONS);
    const reasons = status === STATUS.REJECTED && Array.isArray(source.reasons)
      ? [...new Set(source.reasons.filter((reason) => allowedReasons.has(reason)))]
      : [];

    return {
      schemaVersion: SCHEMA_VERSION,
      propertyId: id,
      status,
      reasons,
      memo: cleanText(source.memo, 200),
      title: cleanText(source.title, 160),
      url: cleanText(source.url, 500),
      updatedAt: cleanText(source.updatedAt, 40)
    };
  }

  function sanitizeSettings(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      hideRejected: source.hideRejected === true
    };
  }

  function isEffectivelyEmpty(record) {
    return record.status === STATUS.UNRATED && record.memo === "";
  }

  function isValidPropertyId(propertyId) {
    return typeof propertyId === "string" && /^[a-f0-9]{32}$/i.test(propertyId);
  }

  function createExportData(records, settings, exportedAt = new Date().toISOString()) {
    const sanitizedRecords = Array.isArray(records)
      ? records
        .map((record) => {
          const propertyId = cleanText(record && record.propertyId, 64).toLowerCase();
          return isValidPropertyId(propertyId) ? sanitizeRecord(record, propertyId) : null;
        })
        .filter((record) => record && !isEffectivelyEmpty(record))
      : [];

    return {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt,
      records: sanitizedRecords,
      settings: sanitizeSettings(settings)
    };
  }

  function sanitizeImportData(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("バックアップファイルの形式が正しくありません");
    }
    if (value.format !== EXPORT_FORMAT || value.version !== EXPORT_VERSION || !Array.isArray(value.records)) {
      throw new Error("対応していないバックアップファイルです");
    }

    const recordsById = new Map();
    let ignored = 0;
    value.records.forEach((source) => {
      const propertyId = cleanText(source && source.propertyId, 64).toLowerCase();
      if (!isValidPropertyId(propertyId)) {
        ignored += 1;
        return;
      }

      const record = sanitizeRecord(source, propertyId);
      if (isEffectivelyEmpty(record)) {
        ignored += 1;
        return;
      }
      recordsById.set(propertyId, record);
    });

    return {
      records: [...recordsById.values()],
      settings: value.settings === undefined ? null : sanitizeSettings(value.settings),
      ignored
    };
  }

  async function loadRecord(propertyId) {
    const key = propertyStorageKey(propertyId);
    const stored = await chrome.storage.local.get(key);
    return sanitizeRecord(stored[key], propertyId);
  }

  async function loadAllRecords() {
    const stored = await chrome.storage.local.get(null);
    return Object.entries(stored)
      .filter(([key]) => key.startsWith(STORAGE_PREFIX))
      .map(([key, value]) => sanitizeRecord(value, key.slice(STORAGE_PREFIX.length)))
      .filter((record) => record.propertyId);
  }

  async function saveRecord(value) {
    const preserveReasons = value.preserveReasons === true;
    const record = sanitizeRecord({
      ...value,
      updatedAt: new Date().toISOString()
    }, value.propertyId);
    if (preserveReasons && Array.isArray(value.reasons)) {
      record.reasons = [...new Set(value.reasons.filter((reason) => REJECTION_REASONS.includes(reason)))];
    }
    const key = propertyStorageKey(record.propertyId);

    if (isEffectivelyEmpty(record)) {
      await chrome.storage.local.remove(key);
      return emptyRecord(record.propertyId);
    }

    await chrome.storage.local.set({ [key]: record });
    return record;
  }

  async function migrateMemoContainingSouthToHoldOnce() {
    const marker = await chrome.storage.local.get(MEMO_SOUTH_TO_HOLD_MIGRATION_KEY);
    if (marker[MEMO_SOUTH_TO_HOLD_MIGRATION_KEY] === true) {
      return { changed: 0, matched: 0, skipped: true };
    }

    const records = await loadAllRecords();
    const matched = records.filter((record) => (
      !record.url.includes("/rent/") && record.memo.includes("南")
    ));
    const targets = matched.filter((record) => record.status !== STATUS.HOLD);

    await Promise.all(targets.map((record) => saveRecord({
      ...record,
      status: STATUS.HOLD,
      preserveReasons: true
    })));
    await chrome.storage.local.set({ [MEMO_SOUTH_TO_HOLD_MIGRATION_KEY]: true });

    return { changed: targets.length, matched: matched.length, skipped: false };
  }

  async function loadSettings() {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return sanitizeSettings(stored[SETTINGS_KEY]);
  }

  async function saveSettings(patch) {
    const current = await loadSettings();
    const settings = sanitizeSettings({ ...current, ...patch });
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    return settings;
  }

  async function exportData() {
    const [records, settings] = await Promise.all([
      loadAllRecords(),
      loadSettings()
    ]);
    return createExportData(records, settings);
  }

  async function importData(value) {
    const imported = sanitizeImportData(value);
    const values = Object.fromEntries(imported.records.map((record) => [
      propertyStorageKey(record.propertyId),
      record
    ]));

    if (imported.settings) {
      values[SETTINGS_KEY] = imported.settings;
    }
    if (Object.keys(values).length) {
      await chrome.storage.local.set(values);
    }

    return {
      imported: imported.records.length,
      ignored: imported.ignored
    };
  }

  return Object.freeze({
    DEFAULT_SETTINGS,
    EXPORT_FORMAT,
    EXPORT_VERSION,
    MEMO_SHORTCUTS,
    MEMO_SOUTH_TO_HOLD_MIGRATION_KEY,
    REJECTION_REASONS,
    SCHEMA_VERSION,
    SETTINGS_KEY,
    STATUS,
    STATUS_META,
    STORAGE_PREFIX,
    createExportData,
    emptyRecord,
    extractDetailPropertyId,
    extractListPropertyId,
    extractPropertyId,
    exportData,
    importData,
    isValidPropertyId,
    isSupportedPathname,
    isEffectivelyEmpty,
    loadAllRecords,
    loadRecord,
    loadSettings,
    migrateMemoContainingSouthToHoldOnce,
    propertyStorageKey,
    sanitizeRecord,
    sanitizeImportData,
    sanitizeSettings,
    saveRecord,
    saveSettings
  });
});
