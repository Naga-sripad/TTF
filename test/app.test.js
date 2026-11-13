// Loads the real index.html in jsdom with the clock frozen, and asserts what
// a visitor would actually see. No network: Google is never contacted, so
// these tests exercise the demo path end to end.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");

const SCRIPTS = ["js/time.js", "js/places.js", "js/demo-data.js", "js/app.js"]
  .map((p) => fs.readFileSync(path.join(ROOT, p), "utf8"));

/**
 * Open the page at a fixed instant, with the viewer in a fixed UTC offset.
 * `offsetMinutes` is east-positive, the way the app stores it.
 */
function openPage(iso, offsetMinutes = -360) {
  // Strip the real <script src> tags; the sources are injected directly so the
  // tests run without a server.
  const stripped = html.replace(/<script src="js\/[^"]+"><\/script>/g, "");

  // A real URL is needed or jsdom gives an opaque origin and localStorage throws.
  const dom = new JSDOM(stripped, {
    url: "https://ttf.example/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const win = dom.window;

  // The clock the page sees. `setNow` moves it so tests can watch a venue
  // close while the page is open.
  let nowMs = new Date(iso).getTime();
  const RealDate = win.Date;              // captured before the swap, or the
                                          // subclass would recurse into itself
  RealDate.prototype.getTimezoneOffset = function () { return -offsetMinutes; };

  class Frozen extends RealDate {
    constructor(...args) {
      return args.length ? new RealDate(...args) : new RealDate(nowMs);
    }
    static now() { return nowMs; }
  }
  win.Date = Frozen;

  const timers = [];
  win.setInterval = (fn) => { timers.push(fn); return timers.length; };
  win.localStorage.clear();

  const errors = [];
  win.addEventListener("error", (e) => errors.push(e.message || String(e)));

  SCRIPTS.forEach((src) => win.eval(src));

  const setNow = (nextIso) => {
    nowMs = new Date(nextIso).getTime();
    timers.forEach((fn) => fn());
  };

  return { dom, win, doc: win.document, errors, timers, setNow };
}

const cards = (doc) =>
  Array.from(doc.querySelectorAll(".card[data-venue-id]")).map((c) => ({
    id: c.getAttribute("data-venue-id"),
    name: c.querySelector("h3").textContent,
    meta: c.querySelector(".meta").textContent,
    status: c.querySelector(".status-text").textContent,
    kind: c.querySelector(".status").getAttribute("data-kind"),
    there: c.querySelector(".clock-there .v").textContent,
    thereSub: c.querySelector(".clock-there .z").textContent,
    yours: c.querySelector(".clock-yours .v").textContent,
    note: c.querySelector(".note").textContent
  }));

const byName = (doc) => Object.fromEntries(cards(doc).map((c) => [c.name, c]));

const click = (win, el) => el.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
const change = (win, el, value) => {
  el.value = value;
  el.dispatchEvent(new win.Event("change"));
};

// ------------------------------------------------------------ boot

test("the page boots into demo mode with no key and no errors", () => {
  const { doc, errors } = openPage("2026-11-13T17:05:00Z");
  assert.deepEqual(errors, []);
  assert.ok(cards(doc).length >= 3, "venues are listed");
  assert.equal(doc.getElementById("setupBanner").hidden, false, "setup prompt is shown");
  assert.equal(doc.getElementById("errorBanner").hidden, true, "no error on a clean boot");
  assert.match(doc.getElementById("resultLine").textContent, /sample data/);
  assert.match(doc.getElementById("map").className, /is-placeholder/);
});

test("the header shows the viewer's own clock", () => {
  const { doc } = openPage("2026-11-13T17:05:00Z", -360);
  assert.equal(doc.getElementById("yourTime").textContent, "11:05 AM");
});

test("a viewer in another zone sees their own time, not the venue's", () => {
  const { doc } = openPage("2026-11-13T17:05:00Z", 330); // India
  assert.equal(doc.getElementById("yourTime").textContent, "10:35 PM");
});

// ------------------------------------------------------------ status

test("Chicago at 11:05: each status is correct and distinct", () => {
  const { win, doc } = openPage("2026-11-13T17:05:00Z");
  change(win, doc.getElementById("radiusSelect"), "5000"); // reach the 2.1 km diner
  const v = byName(doc);
  assert.equal(v["Corner Bakery"].status, "Open · until 3:00 PM");
  assert.equal(v["Corner Bakery"].kind, "open");
  assert.equal(v["Night Market Tacos"].status, "Closed · opens 5:00 PM");
  assert.equal(v["Night Market Tacos"].kind, "closed");
  assert.equal(v["Harbor Food Hall"].status, "Hours unavailable");
  assert.equal(v["Harbor Food Hall"].kind, "unknown");
  assert.equal(v["Lakeside Diner"].status, "Open 24 hours");
  assert.equal(v["Lakeside Diner"].note, "Never closes.");
});

test("a place with no hours is never described as closed", () => {
  const { doc } = openPage("2026-11-13T17:05:00Z");
  const hall = byName(doc)["Harbor Food Hall"];
  assert.ok(!/closed/i.test(hall.status), hall.status);
  assert.match(hall.note, /No opening hours published/);
});

test("the midnight-crossing cart is open at 1 AM the next day", () => {
  const { doc } = openPage("2026-11-14T07:00:00Z"); // Saturday 01:00 Chicago
  const v = byName(doc);
  assert.equal(v["Night Market Tacos"].status, "Open · until 2:00 AM");
  assert.equal(v["Corner Bakery"].status, "Closed · opens 7:00 AM");
});

test("countdown text is sane across the week boundary", () => {
  // Sunday 00:00 Chicago: the cart opened Saturday 17:00 and closes at 02:00.
  const { doc } = openPage("2026-11-15T06:00:00Z");
  const cart = byName(doc)["Night Market Tacos"];
  assert.equal(cart.status, "Open · until 2:00 AM");
  assert.equal(cart.note, "Closes in 2 hours, their time.",
    "must not read as closing in a week");
});

// ------------------------------------------------------------ time zones

test("switching city shows that city's wall clock beside the viewer's", () => {
  const { win, doc } = openPage("2026-11-13T17:05:00Z", -360);
  change(win, doc.getElementById("placeSelect"), "tokyo");
  const c = cards(doc)[0];
  assert.equal(c.yours, "11:05 AM", "viewer clock is unchanged");
  assert.equal(c.there, "2:05 AM", "Tokyo is 15 hours ahead");
  assert.match(c.thereSub, /15 hours ahead of you/);
});

test("half-hour and 45-minute zones are exact", () => {
  const { win, doc } = openPage("2026-11-13T17:05:00Z", 0);
  change(win, doc.getElementById("placeSelect"), "kolkata");
  assert.equal(cards(doc)[0].there, "10:35 PM");
  assert.match(cards(doc)[0].thereSub, /5 hours 30 min ahead/);

  change(win, doc.getElementById("placeSelect"), "kathmandu");
  assert.equal(cards(doc)[0].there, "10:50 PM");
  assert.match(cards(doc)[0].thereSub, /5 hours 45 min ahead/);
});

test("a Chicago viewer gets correct Tokyo statuses in Tokyo time", () => {
  const { win, doc } = openPage("2026-11-13T17:05:00Z", -360);
  change(win, doc.getElementById("radiusSelect"), "5000"); // reach the 2.4 km cart
  change(win, doc.getElementById("placeSelect"), "tokyo");
  const v = byName(doc);
  assert.equal(v["Yatai Yakitori Cart"].status, "Open · until 3:00 AM");
  assert.match(v["Shinjuku Ramen Counter"].status, /^Closed/);
  assert.equal(v["Asakusa Melonpan"].status, "Closed · opens 7:00 AM");
});

// ------------------------------------------------------------ controls

test("the 24-hour toggle rewrites every clock and status", () => {
  const { win, doc } = openPage("2026-11-13T17:05:00Z");
  click(win, doc.getElementById("clock24"));

  assert.equal(doc.getElementById("yourTime").textContent, "11:05");
  assert.equal(byName(doc)["Corner Bakery"].status, "Open · until 15:00");
  cards(doc).forEach((c) => {
    assert.match(c.there, /^\d{2}:\d{2}$/, `bad 24h clock ${c.there}`);
    assert.match(c.yours, /^\d{2}:\d{2}$/);
  });
  assert.equal(doc.getElementById("clock24").getAttribute("aria-pressed"), "true");
  assert.equal(doc.getElementById("clock12").getAttribute("aria-pressed"), "false");

  click(win, doc.getElementById("clock12"));
  assert.equal(doc.getElementById("yourTime").textContent, "11:05 AM");
});

test("category chips are mutually exclusive and filter the list", () => {
  const { win, doc } = openPage("2026-11-13T17:05:00Z");
  const chip = (cat) => doc.querySelector(`.chip[data-cat="${cat}"]`);

  click(win, chip("bakery"));
  assert.ok(cards(doc).length >= 1);
  assert.ok(cards(doc).every((c) => c.meta.startsWith("Bakery")), "only bakeries");
  assert.equal(chip("bakery").getAttribute("aria-pressed"), "true");
  assert.equal(chip("all").getAttribute("aria-pressed"), "false");

  click(win, chip("all"));
  assert.ok(cards(doc).length >= 3, "All restores the full list");
});

test("Open now hides closed and unknown places", () => {
  const { win, doc } = openPage("2026-11-13T17:05:00Z");
  click(win, doc.getElementById("openNowChip"));
  const list = cards(doc);
  assert.ok(list.length >= 1);
  assert.ok(list.every((c) => c.kind === "open"),
    "non-open card survived: " + list.map((c) => c.status).join(" | "));
  assert.ok(!list.some((c) => c.name === "Harbor Food Hall"),
    "a place with unknown hours must not be shown as open");
});

test("radius filters by distance and the list stays nearest-first", () => {
  const { win, doc } = openPage("2026-11-13T17:05:00Z");
  change(win, doc.getElementById("radiusSelect"), "1000");
  const metres = cards(doc).map((c) => {
    const m = c.meta.match(/([\d.]+) (m|km)/);
    return m[2] === "km" ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
  });
  assert.ok(metres.every((d) => d <= 1000), "beyond radius: " + metres.join(","));
  assert.deepEqual(metres, metres.slice().sort((a, b) => a - b), "sorted nearest first");
});

test("an empty result set explains itself", () => {
  const { win, doc } = openPage("2026-11-13T17:05:00Z");
  click(win, doc.querySelector('.chip[data-cat="foodCourt"]'));
  click(win, doc.getElementById("openNowChip"));
  assert.equal(cards(doc).length, 0);
  assert.match(doc.querySelector(".empty").textContent, /Nothing matches those filters/);
});

test("asking for live location without a key explains what is needed", () => {
  const { win, doc } = openPage("2026-11-13T17:05:00Z");
  click(win, doc.getElementById("locateBtn"));
  const banner = doc.getElementById("errorBanner");
  assert.equal(banner.hidden, false);
  assert.match(doc.getElementById("errorTitle").textContent, /Google Maps key/);
  click(win, doc.getElementById("errorDismiss"));
  assert.equal(banner.hidden, true, "the message can be dismissed");
});

test("submitting an empty key is rejected without calling Google", () => {
  const { win, doc } = openPage("2026-11-13T17:05:00Z");
  doc.getElementById("keyForm").dispatchEvent(new win.Event("submit", { cancelable: true }));
  assert.equal(doc.getElementById("errorBanner").hidden, false);
  assert.match(doc.getElementById("errorTitle").textContent, /No key entered/);
  assert.equal(doc.querySelectorAll('script[src*="maps.googleapis.com"]').length, 0);
});

test("the API key is never written into the page", () => {
  const { win, doc } = openPage("2026-11-13T17:05:00Z");
  const input = doc.getElementById("apiKey");
  input.value = "SECRET-KEY-VALUE";
  assert.equal(input.type, "password", "the key field is masked");
  assert.ok(!doc.body.innerHTML.includes("SECRET-KEY-VALUE"),
    "the key must not be serialised into the DOM");
});

// ------------------------------------------------------------ live clock

test("the clock advances without a full re-render, preserving selection", () => {
  const { win, doc, timers } = openPage("2026-11-13T17:05:00Z");
  const first = cards(doc)[0];
  const cardEl = doc.querySelector(`[data-venue-id="${first.id}"]`);
  cardEl.setAttribute("data-probe", "kept");

  assert.ok(timers.length >= 1, "a ticking timer was registered");
  timers.forEach((fn) => fn());

  const same = doc.querySelector(`[data-venue-id="${first.id}"]`);
  assert.equal(same.getAttribute("data-probe"), "kept",
    "the card element was updated in place, not rebuilt");
});

test("a venue flipping to closed is removed while Open now is on", () => {
  // 14:59 Chicago: the bakery (07:00-15:00) is open with one minute left.
  const { win, doc, setNow } = openPage("2026-11-13T20:59:00Z");
  click(win, doc.getElementById("openNowChip"));
  assert.ok(byName(doc)["Corner Bakery"], "bakery is listed while still open");

  // Let the clock run past closing time.
  setNow("2026-11-13T21:01:00Z");

  assert.ok(!byName(doc)["Corner Bakery"],
    "a place that just closed must drop out of an Open-now list");
});

// ------------------------------------------------------------ accessibility

test("controls are real elements, labelled, with pressed state", () => {
  const { doc } = openPage("2026-11-13T17:05:00Z");

  doc.querySelectorAll(".chip, .segmented button, select, .btn").forEach((el) => {
    assert.ok(["BUTTON", "SELECT", "INPUT"].includes(el.tagName),
      `${el.tagName}.${el.className} is not focusable`);
  });

  ["placeSelect", "radiusSelect", "apiKey"].forEach((id) => {
    assert.ok(doc.querySelector(`label[for="${id}"]`), `no label for #${id}`);
  });

  doc.querySelectorAll(".chip, .segmented button").forEach((b) => {
    assert.ok(b.hasAttribute("aria-pressed"), `${b.textContent} has no pressed state`);
  });

  assert.equal(doc.getElementById("resultLine").getAttribute("aria-live"), "polite");
  assert.ok(doc.getElementById("map").getAttribute("aria-label"));

  // Each card is operable from the keyboard and says what it does.
  cards(doc).forEach((c) => {
    const btn = doc.querySelector(`[data-venue-id="${c.id}"] button.card-main`);
    assert.ok(btn, `${c.name} is not a button`);
    assert.match(btn.getAttribute("aria-label"), /Show .+ on the map/);
  });
});

test("the page declares a language and a viewport", () => {
  const { doc } = openPage("2026-11-13T17:05:00Z");
  assert.equal(doc.documentElement.getAttribute("lang"), "en");
  assert.ok(doc.querySelector('meta[name="viewport"]'));
  assert.ok(doc.querySelector('meta[name="description"]'));
});

// ------------------------------------------------------------ robustness

test("every city renders cleanly at six times of day", () => {
  const cities = ["chicago", "tokyo", "paris", "kolkata", "kathmandu", "auckland"];
  const instants = ["2026-11-13T00:30:00Z", "2026-11-13T04:00:00Z", "2026-11-13T08:00:00Z",
                    "2026-11-13T12:00:00Z", "2026-11-13T17:05:00Z", "2026-11-13T22:45:00Z"];
  for (const iso of instants) {
    const { win, doc, errors } = openPage(iso);
    for (const city of cities) {
      change(win, doc.getElementById("placeSelect"), city);
      const list = cards(doc);
      assert.ok(list.length > 0 || doc.querySelector(".empty"), `${city} at ${iso} is blank`);
      list.forEach((c) => {
        assert.ok(/^(Open|Closed|Hours unavailable)/.test(c.status),
          `bad status "${c.status}" for ${c.name} in ${city} at ${iso}`);
        assert.ok(!/NaN|undefined|Invalid|null/.test(c.status + c.note + c.meta + c.there),
          `broken text for ${c.name} in ${city} at ${iso}`);
        assert.match(c.there, /^\d{1,2}:\d{2} (AM|PM)$/, `bad clock "${c.there}"`);
      });
    }
    assert.deepEqual(errors, [], `errors at ${iso}`);
  }
});

test("midnight renders as 12:00 AM, never 24:00", () => {
  const { doc, errors } = openPage("2026-11-14T06:00:00Z"); // 00:00 Chicago
  assert.deepEqual(errors, []);
  assert.equal(doc.getElementById("yourTime").textContent, "12:00 AM");
  cards(doc).forEach((c) => assert.match(c.there, /^\d{1,2}:\d{2} (AM|PM)$/));
});

test("blocked localStorage does not break the page", () => {
  const { win, doc } = openPage("2026-11-13T17:05:00Z");
  Object.defineProperty(win, "localStorage", {
    get() { throw new Error("blocked by browser settings"); }
  });
  // Re-running the app with storage throwing must not take the page down.
  assert.doesNotThrow(() => win.eval(SCRIPTS[3]));
  assert.ok(doc.querySelectorAll(".card").length >= 0);
});
