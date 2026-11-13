/**
 * TTF application.
 *
 * Two modes. Without a Google Maps API key the page runs on sample venues so
 * it is still usable and demonstrable. With a key it loads the Maps JavaScript
 * API, finds the viewer by geolocation, and searches real places nearby.
 *
 * Either way the clock ticks every second and open/closed status is recomputed
 * continuously, so a venue flips from open to closed while you watch.
 */
(function () {
  "use strict";

  var T = window.TTFTime;
  var P = window.TTFPlaces;
  var DEMO = window.TTFDemo;

  var STORAGE_KEY = "ttf.googleMapsKey";

  var state = {
    apiKey: null,
    live: false,
    hour12: true,
    category: "all",
    openOnly: false,
    radius: 2000,
    origin: null,          // { lat, lng }
    originLabel: "",
    venues: [],
    loading: false,
    activeId: null,
    viewerOffsetMinutes: -new Date().getTimezoneOffset()
  };

  var map = null;
  var markers = [];
  var infoWindow = null;

  var el = {};
  ["yourTime", "yourZone", "setupBanner", "errorBanner", "errorTitle", "errorBody",
   "errorDismiss", "keyForm", "apiKey", "placeSelect", "radiusSelect", "clock12",
   "clock24", "locateBtn", "openNowChip", "resultLine", "results", "map",
   "attribution"].forEach(function (id) { el[id] = document.getElementById(id); });

  // ---------------------------------------------------------------- storage

  function readStoredKey() {
    try { return window.localStorage.getItem(STORAGE_KEY); }
    catch (e) { return null; }   // private mode, blocked storage, etc.
  }

  function storeKey(key) {
    try { window.localStorage.setItem(STORAGE_KEY, key); }
    catch (e) { /* not fatal: the key just won't persist */ }
  }

  // ---------------------------------------------------------------- errors

  function showError(title, body) {
    el.errorTitle.textContent = title;
    el.errorBody.textContent = body;
    el.errorBanner.hidden = false;
  }

  function clearError() { el.errorBanner.hidden = true; }

  // ---------------------------------------------------------------- clock

  function viewerZoneLabel() {
    try {
      var parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
        .formatToParts(new Date());
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === "timeZoneName") { return parts[i].value; }
      }
    } catch (e) { /* fall through */ }
    return T.formatOffset(state.viewerOffsetMinutes);
  }

  /** Runs every second: the header clock and every card clock stay live. */
  function tick() {
    var now = new Date();
    state.viewerOffsetMinutes = -now.getTimezoneOffset();

    var c = T.venueClock(now, state.viewerOffsetMinutes);
    el.yourTime.textContent = T.formatTime(c.hour, c.minute, state.hour12);
    el.yourZone.textContent = viewerZoneLabel();

    updateLiveParts(now);
  }

  /**
   * Refresh only the parts that change with the clock, so typing or scrolling
   * is never interrupted by a full re-render.
   */
  function updateLiveParts(now) {
    var cards = el.results.querySelectorAll(".card[data-venue-id]");
    var changed = false;

    for (var i = 0; i < cards.length; i++) {
      var card = cards[i];
      var venue = findVenue(card.getAttribute("data-venue-id"));
      if (!venue) { continue; }

      var view = describe(venue, now);

      var statusEl = card.querySelector(".status");
      if (statusEl.getAttribute("data-kind") !== view.status.kind) { changed = true; }
      statusEl.className = "status is-" + view.status.kind;
      statusEl.setAttribute("data-kind", view.status.kind);
      statusEl.querySelector(".status-text").textContent = view.statusText;

      card.querySelector(".clock-there .v").textContent = view.venueTime;
      card.querySelector(".clock-yours .v").textContent = view.viewerTime;
      card.querySelector(".note").textContent = view.note;
    }

    // A venue opening or closing can change which cards belong on screen.
    if (changed && state.openOnly) { render(); }
    if (changed) { refreshMarkers(); }
  }

  // ---------------------------------------------------------------- model

  function findVenue(id) {
    for (var i = 0; i < state.venues.length; i++) {
      if (state.venues[i].id === id) { return state.venues[i]; }
    }
    return null;
  }

  /** Everything the UI needs to show one venue at this instant. */
  function describe(venue, now) {
    now = now || new Date();
    var offset = venue.utcOffsetMinutes;
    var hasOffset = typeof offset === "number";

    var status = hasOffset
      ? T.statusAt(T.venueWeekMinute(now, offset), venue.hours)
      : { kind: "unknown" };

    var statusText;
    if (status.kind === "open" && status.always) {
      statusText = "Open 24 hours";
    } else if (status.kind === "open") {
      statusText = "Open · until " + T.formatWeekMinute(status.until, state.hour12);
    } else if (status.kind === "closed" && status.opensAt !== null) {
      statusText = "Closed · opens " + T.formatWeekMinute(status.opensAt, state.hour12);
    } else if (status.kind === "closed") {
      statusText = "Closed";
    } else {
      statusText = "Hours unavailable";
    }

    var venueClock = hasOffset ? T.venueClock(now, offset) : null;
    var viewerClock = T.venueClock(now, state.viewerOffsetMinutes);

    var note;
    if (status.kind === "open" && status.always) {
      note = "Never closes.";
    } else if (status.kind === "open") {
      note = "Closes " + T.describeGap(status.closesIn) + ", their time.";
    } else if (status.kind === "closed" && status.opensIn !== null) {
      note = "Opens " + T.describeGap(status.opensIn) + ", their time.";
    } else if (status.kind === "unknown" && !hasOffset) {
      note = "No time zone published for this place.";
    } else {
      note = "No opening hours published for this place.";
    }

    return {
      status: status,
      statusText: statusText,
      venueTime: venueClock ? T.formatTime(venueClock.hour, venueClock.minute, state.hour12) : "—",
      viewerTime: T.formatTime(viewerClock.hour, viewerClock.minute, state.hour12),
      venueZone: hasOffset ? T.formatOffset(offset) : "",
      difference: hasOffset ? T.describeDifference(offset, state.viewerOffsetMinutes) : "",
      note: note
    };
  }

  function visibleVenues(now) {
    return state.venues.filter(function (v) {
      if (state.category !== "all" && v.category !== state.category) { return false; }
      if (v.metres != null && v.metres > state.radius) { return false; }
      if (state.openOnly && describe(v, now).status.kind !== "open") { return false; }
      return true;
    });
  }

  function formatDistance(metres) {
    if (metres == null) { return ""; }
    if (metres < 950) { return Math.round(metres / 10) * 10 + " m"; }
    return (metres / 1000).toFixed(1) + " km";
  }

  // ---------------------------------------------------------------- render

  function render() {
    var now = new Date();
    var rows = visibleVenues(now);

    el.results.innerHTML = "";

    if (state.loading) {
      el.resultLine.textContent = "Searching…";
      for (var s = 0; s < 3; s++) { el.results.appendChild(skeleton()); }
      return;
    }

    if (!rows.length) {
      el.resultLine.textContent = "";
      var p = document.createElement("p");
      p.className = "empty";
      p.textContent = state.venues.length
        ? "Nothing matches those filters" +
          (state.originLabel ? " near " + state.originLabel : "") +
          ". Try a wider radius, or switch off “Open now”."
        : "No places found here yet.";
      el.results.appendChild(p);
      refreshMarkers();
      return;
    }

    el.resultLine.textContent = rows.length + (rows.length === 1 ? " place" : " places") +
      (state.originLabel ? " near " + state.originLabel : "") +
      " · nearest first" +
      (state.live ? "" : " · sample data");

    rows.forEach(function (venue) {
      el.results.appendChild(card(venue, now));
    });

    refreshMarkers();
  }

  function skeleton() {
    var d = document.createElement("div");
    d.className = "skeleton";
    d.setAttribute("aria-hidden", "true");
    d.innerHTML = '<div class="bar"></div><div class="bar short"></div><div class="bar short"></div>';
    return d;
  }

  function card(venue, now) {
    var view = describe(venue, now);

    var article = document.createElement("article");
    article.className = "card" + (state.activeId === venue.id ? " is-active" : "");
    article.setAttribute("data-venue-id", venue.id);

    var button = document.createElement("button");
    button.type = "button";
    button.className = "card-main";
    button.setAttribute("aria-label", "Show " + venue.name + " on the map");

    var top = document.createElement("div");
    top.className = "card-top";

    var left = document.createElement("div");
    var h = document.createElement("h3");
    h.textContent = venue.name;
    var meta = document.createElement("p");
    meta.className = "meta";
    var bits = [P.CATEGORY_LABEL[venue.category] || "Food"];
    if (venue.metres != null) { bits.push(formatDistance(venue.metres)); }
    if (venue.rating != null) { bits.push(venue.rating.toFixed(1) + " ★"); }
    meta.textContent = bits.join(" · ");
    left.appendChild(h);
    left.appendChild(meta);

    var status = document.createElement("span");
    status.className = "status is-" + view.status.kind;
    status.setAttribute("data-kind", view.status.kind);
    var dot = document.createElement("span");
    dot.className = "dot";
    var stext = document.createElement("span");
    stext.className = "status-text";
    stext.textContent = view.statusText;
    status.appendChild(dot);
    status.appendChild(stext);

    top.appendChild(left);
    top.appendChild(status);
    button.appendChild(top);

    var clocks = document.createElement("div");
    clocks.className = "clocks";
    clocks.appendChild(clockBlock("clock-there", "There", view.venueTime, view.difference || view.venueZone));
    clocks.appendChild(clockBlock("clock-yours", "Your time", view.viewerTime, viewerZoneLabel()));
    button.appendChild(clocks);

    var note = document.createElement("p");
    note.className = "note";
    note.textContent = view.note;
    button.appendChild(note);

    button.addEventListener("click", function () { focusVenue(venue.id); });

    article.appendChild(button);
    return article;
  }

  function clockBlock(cls, label, value, sub) {
    var d = document.createElement("div");
    d.className = "clock " + cls;
    var k = document.createElement("span"); k.className = "k"; k.textContent = label;
    var v = document.createElement("span"); v.className = "v"; v.textContent = value;
    var z = document.createElement("span"); z.className = "z"; z.textContent = sub;
    d.appendChild(k); d.appendChild(v); d.appendChild(z);
    return d;
  }

  // ---------------------------------------------------------------- map

  function statusColour(kind) {
    if (kind === "open") { return "#1F6B4D"; }
    if (kind === "closed") { return "#8A2F1B"; }
    return "#6B6157";
  }

  function refreshMarkers() {
    if (!map) { return; }
    var now = new Date();

    markers.forEach(function (m) { m.setMap(null); });
    markers = [];

    visibleVenues(now).forEach(function (venue) {
      if (venue.lat == null || venue.lng == null) { return; }
      var view = describe(venue, now);
      var marker = new google.maps.Marker({
        map: map,
        position: { lat: venue.lat, lng: venue.lng },
        title: venue.name + " — " + view.statusText,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: state.activeId === venue.id ? 11 : 8,
          fillColor: statusColour(view.status.kind),
          fillOpacity: 1,
          strokeColor: "#FFFFFF",
          strokeWeight: 2
        }
      });
      marker.addListener("click", function () { focusVenue(venue.id); });
      markers.push(marker);
    });

    if (state.origin) {
      var you = new google.maps.Marker({
        map: map,
        position: state.origin,
        title: "You are here",
        zIndex: 999,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#1F1B16",
          fillOpacity: 1,
          strokeColor: "#FFFFFF",
          strokeWeight: 3
        }
      });
      markers.push(you);
    }
  }

  function focusVenue(id) {
    state.activeId = id;
    var venue = findVenue(id);
    render();

    if (map && venue && venue.lat != null) {
      map.panTo({ lat: venue.lat, lng: venue.lng });
      if (map.getZoom() < 15) { map.setZoom(15); }

      var view = describe(venue, new Date());
      if (!infoWindow) { infoWindow = new google.maps.InfoWindow(); }
      var box = document.createElement("div");
      var title = document.createElement("strong");
      title.textContent = venue.name;
      var line = document.createElement("div");
      line.textContent = view.statusText + " · " + view.venueTime + " there";
      box.appendChild(title);
      box.appendChild(line);
      infoWindow.setContent(box);
      infoWindow.setPosition({ lat: venue.lat, lng: venue.lng });
      infoWindow.open(map);
    }

    var card = el.results.querySelector('[data-venue-id="' + id + '"]');
    if (card && card.scrollIntoView) {
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  // ---------------------------------------------------------------- loading Google

  function loadGoogleMaps(key) {
    return new Promise(function (resolve, reject) {
      if (window.google && window.google.maps && window.google.maps.importLibrary) {
        resolve();
        return;
      }
      var script = document.createElement("script");
      script.src = "https://maps.googleapis.com/maps/api/js?key=" +
                   encodeURIComponent(key) + "&libraries=places&v=weekly&loading=async";
      script.async = true;
      script.onerror = function () {
        reject(new Error("The Google Maps script could not be loaded."));
      };
      // Google reports a bad key through this global rather than onerror.
      window.gm_authFailure = function () {
        reject(new Error("Google rejected that API key."));
      };
      script.onload = function () { resolve(); };
      document.head.appendChild(script);
    });
  }

  async function goLive(key) {
    clearError();
    state.loading = true;
    render();

    try {
      await loadGoogleMaps(key);
      await google.maps.importLibrary("maps");

      state.apiKey = key;
      state.live = true;
      storeKey(key);
      el.setupBanner.hidden = true;
      el.attribution.textContent = "Place data © Google. Opening hours and " +
        "time zones come from the Google Places API.";

      el.map.classList.remove("is-placeholder");
      el.map.textContent = "";
      map = new google.maps.Map(el.map, {
        center: state.origin || { lat: 41.8781, lng: -87.6298 },
        zoom: 15,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false
      });

      rebuildPlaceSelect();
      await locate();
    } catch (err) {
      state.live = false;
      state.loading = false;
      showError("Could not connect to Google Maps", err.message +
        " Check that the key is correct, that Maps JavaScript API and Places API (New) " +
        "are enabled on the project, and that this site is allowed under the key's " +
        "HTTP referrer restrictions. The sample data below still works.");
      render();
    }
  }

  // ---------------------------------------------------------------- locating

  function locate() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        showError("Location unavailable",
          "This browser does not support location. Pick a city instead.");
        resolve();
        return;
      }

      el.locateBtn.disabled = true;
      el.locateBtn.textContent = "Locating…";

      navigator.geolocation.getCurrentPosition(function (pos) {
        el.locateBtn.disabled = false;
        el.locateBtn.textContent = "Use my location";
        state.origin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        state.originLabel = "you";
        if (map) { map.setCenter(state.origin); }
        if (el.placeSelect.querySelector('option[value="me"]')) { el.placeSelect.value = "me"; }
        search().then(resolve);
      }, function (err) {
        el.locateBtn.disabled = false;
        el.locateBtn.textContent = "Use my location";
        var why = err.code === 1
          ? "You declined location access."
          : "Your location could not be determined.";
        showError("Using a city instead", why +
          " Pick a city from the menu, or allow location and try again.");
        resolve();
      }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    });
  }

  async function search() {
    if (!state.live || !state.origin) { return; }

    state.loading = true;
    state.activeId = null;
    render();

    try {
      var cats = state.category === "all" ? null : [state.category];
      state.venues = await P.searchNearby({
        origin: state.origin,
        radius: state.radius,
        categories: cats
      });
      clearError();
    } catch (err) {
      state.venues = [];
      showError("Search failed", (err && err.message ? err.message : String(err)) +
        " Check that Places API (New) is enabled on your Google Cloud project.");
    } finally {
      state.loading = false;
      render();
    }
  }

  // ---------------------------------------------------------------- demo mode

  function rebuildPlaceSelect() {
    el.placeSelect.innerHTML = "";

    if (state.live) {
      var me = document.createElement("option");
      me.value = "me";
      me.textContent = "My location";
      el.placeSelect.appendChild(me);
    }

    DEMO.CITIES.forEach(function (c) {
      var o = document.createElement("option");
      o.value = c.id;
      o.textContent = c.name + (state.live ? "" : "");
      el.placeSelect.appendChild(o);
    });
  }

  function loadDemoCity(cityId) {
    var city = null;
    DEMO.CITIES.forEach(function (c) { if (c.id === cityId) { city = c; } });
    if (!city) { return; }

    state.venues = DEMO.venuesFor(cityId);
    state.origin = { lat: city.lat, lng: city.lng };
    state.originLabel = city.name;
    state.activeId = null;

    if (map) { map.setCenter(state.origin); map.setZoom(14); }
    render();
  }

  // ---------------------------------------------------------------- events

  el.keyForm.addEventListener("submit", function (e) {
    e.preventDefault();
    var key = el.apiKey.value.trim();
    if (!key) {
      showError("No key entered", "Paste a Google Maps JavaScript API key to go live.");
      return;
    }
    el.apiKey.value = "";
    goLive(key);
  });

  el.errorDismiss.addEventListener("click", clearError);

  el.placeSelect.addEventListener("change", function () {
    if (this.value === "me") { locate(); return; }
    loadDemoCity(this.value);
    if (state.live) { search(); }
  });

  el.radiusSelect.addEventListener("change", function () {
    state.radius = parseInt(this.value, 10);
    if (state.live) { search(); } else { render(); }
  });

  el.clock12.addEventListener("click", function () { setClock(true); });
  el.clock24.addEventListener("click", function () { setClock(false); });

  function setClock(hour12) {
    state.hour12 = hour12;
    el.clock12.setAttribute("aria-pressed", hour12 ? "true" : "false");
    el.clock24.setAttribute("aria-pressed", hour12 ? "false" : "true");
    tick();
    render();
  }

  var catChips = Array.prototype.slice.call(document.querySelectorAll(".chip[data-cat]"));
  catChips.forEach(function (chip) {
    chip.addEventListener("click", function () {
      state.category = chip.getAttribute("data-cat");
      catChips.forEach(function (c) {
        c.setAttribute("aria-pressed", c === chip ? "true" : "false");
      });
      if (state.live) { search(); } else { render(); }
    });
  });

  el.openNowChip.addEventListener("click", function () {
    state.openOnly = !state.openOnly;
    el.openNowChip.setAttribute("aria-pressed", state.openOnly ? "true" : "false");
    render();
  });

  el.locateBtn.addEventListener("click", function () {
    if (!state.live) {
      showError("Add a Google Maps key first",
        "Live location search needs the Google Places API. Paste a key above, " +
        "or pick a city to explore the sample data.");
      return;
    }
    locate();
  });

  // ---------------------------------------------------------------- start

  function start() {
    rebuildPlaceSelect();
    state.radius = parseInt(el.radiusSelect.value, 10);
    loadDemoCity(DEMO.CITIES[0].id);
    tick();
    setInterval(tick, 1000);

    var saved = readStoredKey();
    if (saved) { goLive(saved); }
  }

  start();

  // Exposed for the test suite.
  window.__ttf = { state: state, describe: describe, visibleVenues: visibleVenues,
                   formatDistance: formatDistance, render: render, tick: tick };
})();
