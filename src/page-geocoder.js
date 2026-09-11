(function installPropertyExcluderGeocoderBridge() {
  "use strict";

  const REQUEST_EVENT = "property-excluder:geocode-request";
  const RESPONSE_EVENT = "property-excluder:geocode-response";
  const READY_RETRY_DELAY_MS = 500;
  const READY_MAX_RETRIES = 20;
  const INSTALL_FLAG = "__propertyExcluderGeocoderBridgeInstalled";

  if (window[INSTALL_FLAG]) return;
  window[INSTALL_FLAG] = true;

  function respond(detail) {
    document.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
      detail: JSON.stringify(detail)
    }));
  }

  function waitForGeocoder() {
    return new Promise((resolve, reject) => {
      let retryCount = 0;

      function check() {
        const Geocoder = window.google?.maps?.Geocoder;
        if (typeof Geocoder === "function") {
          resolve(Geocoder);
          return;
        }

        retryCount += 1;
        if (retryCount > READY_MAX_RETRIES) {
          reject(new Error("Google Maps Geocoder is unavailable"));
          return;
        }
        window.setTimeout(check, READY_RETRY_DELAY_MS);
      }

      check();
    });
  }

  document.addEventListener(REQUEST_EVENT, async (event) => {
    let request;
    try {
      request = JSON.parse(event.detail);
    } catch (_error) {
      return;
    }

    const requestId = typeof request?.requestId === "string"
      ? request.requestId
      : "";
    const latitude = Number(request?.latitude);
    const longitude = Number(request?.longitude);

    if (!requestId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return;
    }

    try {
      const Geocoder = await waitForGeocoder();
      const geocoder = new Geocoder();
      geocoder.geocode(
        { location: { lat: latitude, lng: longitude } },
        (results, status) => {
          const okStatus = window.google?.maps?.GeocoderStatus?.OK || "OK";
          const address = status === okStatus && Array.isArray(results)
            ? results[0]?.formatted_address || ""
            : "";

          respond({
            requestId,
            status: address ? "success" : "error",
            address,
            geocoderStatus: String(status || "UNKNOWN")
          });
        }
      );
    } catch (error) {
      respond({
        requestId,
        status: "error",
        address: "",
        geocoderStatus: "UNAVAILABLE"
      });
    }
  });
})();
