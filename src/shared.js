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
  const SCHEMA_VERSION = 1;

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

  const DEFAULT_SETTINGS = Object.freeze({
    hideRejected: false
  });

  function extractPropertyId(url) {
    if (typeof url !== "string") {
      return null;
    }

    const match = url.match(/\/chuko-ikkodate\/[^?#]*\/detail_([a-f0-9]{32})(?:\/|[?#]|$)/i);
    return match ? match[1].toLowerCase() : null;
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
    const record = sanitizeRecord({
      ...value,
      updatedAt: new Date().toISOString()
    }, value.propertyId);
    const key = propertyStorageKey(record.propertyId);

    if (isEffectivelyEmpty(record)) {
      await chrome.storage.local.remove(key);
      return emptyRecord(record.propertyId);
    }

    await chrome.storage.local.set({ [key]: record });
    return record;
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

  return Object.freeze({
    DEFAULT_SETTINGS,
    REJECTION_REASONS,
    SCHEMA_VERSION,
    SETTINGS_KEY,
    STATUS,
    STATUS_META,
    STORAGE_PREFIX,
    emptyRecord,
    extractPropertyId,
    isEffectivelyEmpty,
    loadAllRecords,
    loadRecord,
    loadSettings,
    propertyStorageKey,
    sanitizeRecord,
    sanitizeSettings,
    saveRecord,
    saveSettings
  });
});
