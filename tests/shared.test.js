const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/shared.js");

const PROPERTY_ID = "6e907341b0de33f3a99e619f642941d4";

test("nifty不動産の中古一戸建て詳細URLから物件番号を抽出する", () => {
  assert.equal(
    core.extractPropertyId(`https://myhome.nifty.com/chuko-ikkodate/osaka/fujiiderashi_ct/detail_${PROPERTY_ID}/`),
    PROPERTY_ID
  );
  assert.equal(
    core.extractPropertyId(`/chuko-ikkodate/osaka/fujiiderashi_ct/detail_${PROPERTY_ID}/?from=list`),
    PROPERTY_ID
  );
});

test("対象外URLからは物件番号を抽出しない", () => {
  assert.equal(core.extractPropertyId("https://myhome.nifty.com/chuko-mansion/osaka/search/"), null);
  assert.equal(core.extractPropertyId("https://example.com/detail_1234/"), null);
  assert.equal(core.extractPropertyId(null), null);
});

test("お気に入り経由のURLではcanonical URLから物件番号を抽出する", () => {
  const favoriteUrl = "https://myhome.nifty.com/chuko-ikkodate/kagawa/takamatsushi_ct/suumof_21474566/";
  const canonicalUrl = `https://myhome.nifty.com/chuko-ikkodate/kagawa/takamatsushi_ct/detail_${PROPERTY_ID}/`;

  assert.equal(core.extractDetailPropertyId(favoriteUrl, canonicalUrl), PROPERTY_ID);
  assert.equal(core.extractDetailPropertyId(canonicalUrl, favoriteUrl), PROPERTY_ID);
});

test("条件設定画面では拡張機能を動作させず、一覧・詳細画面では動作させる", () => {
  assert.equal(core.isSupportedPathname("/chuko-ikkodate/okayama/"), false);
  assert.equal(core.isSupportedPathname("/chuko-ikkodate/okayama/kurashikishi_ct/"), true);
  assert.equal(
    core.isSupportedPathname(
      "/chuko-ikkodate/okayama/kurashikishi_ct/detail_6e907341b0de33f3a99e619f642941d4/"
    ),
    true
  );
});

test("保存レコードを許可された値だけに正規化する", () => {
  const record = core.sanitizeRecord({
    status: core.STATUS.REJECTED,
    reasons: ["価格", "価格", "不明な理由", "災害リスク"],
    memo: `  ${"あ".repeat(220)}  `,
    title: "  テスト物件  ",
    url: " https://example.com/ "
  }, PROPERTY_ID);

  assert.equal(record.status, core.STATUS.REJECTED);
  assert.deepEqual(record.reasons, ["価格", "災害リスク"]);
  assert.equal(record.memo.length, 200);
  assert.equal(record.title, "テスト物件");
  assert.equal(record.url, "https://example.com/");
});

test("一言メモ用ショートカットを定義する", () => {
  assert.deepEqual(core.MEMO_SHORTCUTS, [
    "部屋数不足",
    "1F部屋数不足",
    "1F南向き部屋不足",
    "2Fトイレなし",
    "ハザード情報未取得"
  ]);
});

test("却下以外の状態では却下理由を保持しない", () => {
  const record = core.sanitizeRecord({
    status: core.STATUS.CANDIDATE,
    reasons: ["価格"],
    memo: "比較候補"
  }, PROPERTY_ID);

  assert.deepEqual(record.reasons, []);
  assert.equal(record.memo, "比較候補");
});

test("不正な状態は未評価として扱う", () => {
  const record = core.sanitizeRecord({ status: "unknown" }, PROPERTY_ID);
  assert.equal(record.status, core.STATUS.UNRATED);
  assert.equal(core.isEffectivelyEmpty(record), true);
});

test("判定情報を持ち運び用データへ変換する", () => {
  const exportedAt = "2026-09-12T00:00:00.000Z";
  const data = core.createExportData([
    {
      propertyId: PROPERTY_ID,
      status: core.STATUS.CANDIDATE,
      memo: " 内見候補 ",
      updatedAt: "2026-09-11T12:00:00.000Z"
    },
    {
      propertyId: "invalid-id",
      status: core.STATUS.REJECTED
    }
  ], { hideRejected: true }, exportedAt);

  assert.equal(data.format, core.EXPORT_FORMAT);
  assert.equal(data.version, core.EXPORT_VERSION);
  assert.equal(data.exportedAt, exportedAt);
  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].propertyId, PROPERTY_ID);
  assert.equal(data.records[0].memo, "内見候補");
  assert.deepEqual(data.settings, { hideRejected: true });
});

test("インポートでは既存データを残し、同じ物件だけ上書きする", async () => {
  const originalChrome = global.chrome;
  const existingOtherId = "1e907341b0de33f3a99e619f642941d4";
  const data = {
    [core.propertyStorageKey(PROPERTY_ID)]: {
      propertyId: PROPERTY_ID,
      status: core.STATUS.REJECTED,
      reasons: ["価格"],
      memo: "旧データ"
    },
    [core.propertyStorageKey(existingOtherId)]: {
      propertyId: existingOtherId,
      status: core.STATUS.HOLD,
      memo: "既存の別物件"
    }
  };

  global.chrome = {
    storage: {
      local: {
        async set(values) {
          Object.assign(data, values);
        }
      }
    }
  };

  try {
    const result = await core.importData({
      format: core.EXPORT_FORMAT,
      version: core.EXPORT_VERSION,
      records: [
        {
          propertyId: PROPERTY_ID.toUpperCase(),
          status: core.STATUS.CANDIDATE,
          memo: "新データ",
          updatedAt: "2026-09-12T00:00:00.000Z"
        },
        {
          propertyId: "invalid-id",
          status: core.STATUS.HOLD
        }
      ],
      settings: { hideRejected: true }
    });

    assert.deepEqual(result, { imported: 1, ignored: 1 });
    assert.equal(data[core.propertyStorageKey(PROPERTY_ID)].status, core.STATUS.CANDIDATE);
    assert.equal(data[core.propertyStorageKey(PROPERTY_ID)].memo, "新データ");
    assert.equal(data[core.propertyStorageKey(existingOtherId)].memo, "既存の別物件");
    assert.deepEqual(data[core.SETTINGS_KEY], { hideRejected: true });
  } finally {
    global.chrome = originalChrome;
  }
});

test("対応外のバックアップ形式はインポートしない", () => {
  assert.throws(
    () => core.sanitizeImportData({ format: core.EXPORT_FORMAT, version: 999, records: [] }),
    /対応していない/
  );
});

test("メモに南を含むレコードだけを保留へ移行する対象にできる", () => {
  const records = [
    core.sanitizeRecord({ status: core.STATUS.REJECTED, memo: "南向き部屋不足" }, PROPERTY_ID),
    core.sanitizeRecord({ status: core.STATUS.HOLD, memo: "南側道路を確認中" }, "1e907341b0de33f3a99e619f642941d4"),
    core.sanitizeRecord({ status: core.STATUS.CANDIDATE, memo: "駅近" }, "2e907341b0de33f3a99e619f642941d4")
  ];
  const targets = records.filter((record) => record.memo.includes("南") && record.status !== core.STATUS.HOLD);

  assert.deepEqual(targets.map((record) => record.propertyId), [PROPERTY_ID]);
});

test("南を含むメモの一括移行は一度だけ実行する", async () => {
  const originalChrome = global.chrome;
  const holdTargetId = PROPERTY_ID;
  const alreadyHoldId = "1e907341b0de33f3a99e619f642941d4";
  const otherId = "2e907341b0de33f3a99e619f642941d4";
  const data = {
    [core.propertyStorageKey(holdTargetId)]: {
      propertyId: holdTargetId,
      status: core.STATUS.REJECTED,
      reasons: ["間取り"],
      memo: "南向き部屋不足"
    },
    [core.propertyStorageKey(alreadyHoldId)]: {
      propertyId: alreadyHoldId,
      status: core.STATUS.HOLD,
      memo: "南側道路を確認中"
    },
    [core.propertyStorageKey(otherId)]: {
      propertyId: otherId,
      status: core.STATUS.CANDIDATE,
      memo: "駅近"
    }
  };

  global.chrome = {
    storage: {
      local: {
        async get(key) {
          if (key === null) return { ...data };
          if (typeof key === "string") return { [key]: data[key] };
          return {};
        },
        async set(values) {
          Object.assign(data, values);
        },
        async remove(key) {
          delete data[key];
        }
      }
    }
  };

  try {
    const first = await core.migrateMemoContainingSouthToHoldOnce();
    assert.deepEqual(first, { changed: 1, matched: 2, skipped: false });
    assert.equal(data[core.propertyStorageKey(holdTargetId)].status, core.STATUS.HOLD);
    assert.deepEqual(data[core.propertyStorageKey(holdTargetId)].reasons, ["間取り"]);
    assert.equal(data[core.propertyStorageKey(otherId)].status, core.STATUS.CANDIDATE);

    const second = await core.migrateMemoContainingSouthToHoldOnce();
    assert.deepEqual(second, { changed: 0, matched: 0, skipped: true });
  } finally {
    global.chrome = originalChrome;
  }
});
