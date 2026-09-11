const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const REQUEST_EVENT = "property-excluder:geocode-request";
const RESPONSE_EVENT = "property-excluder:geocode-response";

class CustomEventMock {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
}

function createDocumentMock() {
  const listeners = new Map();
  return {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach((listener) => listener(event));
      return true;
    }
  };
}

test("Google Geocoderで座標を住所へ変換して応答する", async () => {
  const document = createDocumentMock();
  const geocodeCalls = [];
  const response = new Promise((resolve) => {
    document.addEventListener(RESPONSE_EVENT, (event) => resolve(JSON.parse(event.detail)));
  });
  const window = {
    setTimeout,
    google: {
      maps: {
        GeocoderStatus: { OK: "OK" },
        Geocoder: class GeocoderMock {
          geocode(request, callback) {
            geocodeCalls.push(request);
            callback([{ formatted_address: "日本、〒712-8032 岡山県倉敷市北畝1丁目" }], "OK");
          }
        }
      }
    }
  };
  const source = fs.readFileSync(
    path.join(__dirname, "..", "src", "page-geocoder.js"),
    "utf8"
  );

  vm.runInNewContext(source, { window, document, CustomEvent: CustomEventMock });
  document.dispatchEvent(new CustomEventMock(REQUEST_EVENT, {
    detail: JSON.stringify({
      requestId: "request-1",
      latitude: 34.538418,
      longitude: 133.7475
    })
  }));

  const responseDetail = await response;
  assert.deepEqual(JSON.parse(JSON.stringify(geocodeCalls)), [{
    location: { lat: 34.538418, lng: 133.7475 }
  }]);
  assert.deepEqual(JSON.parse(JSON.stringify(responseDetail)), {
    requestId: "request-1",
    status: "success",
    address: "日本、〒712-8032 岡山県倉敷市北畝1丁目",
    geocoderStatus: "OK"
  });
});
