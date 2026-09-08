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
