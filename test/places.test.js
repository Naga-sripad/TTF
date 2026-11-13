const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../js/places.js");
const T = require("../js/time.js");

test("maps Google place types onto our categories", () => {
  assert.equal(P.categoryFor(["bakery", "food", "point_of_interest"]), "bakery");
  assert.equal(P.categoryFor(["meal_takeaway"]), "foodCart");
  assert.equal(P.categoryFor(["food_court", "shopping_mall"]), "foodCourt");
  assert.equal(P.categoryFor(["restaurant"]), "restaurant");
  assert.equal(P.categoryFor([]), "restaurant", "falls back rather than throwing");
  assert.equal(P.categoryFor(undefined), "restaurant");
});

test("normalises Google opening periods into minutes", () => {
  const out = P.normalisePeriods({
    periods: [
      { open: { day: 1, hour: 9, minute: 30 }, close: { day: 1, hour: 17, minute: 0 } },
      { open: { day: 5, hour: 18, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }
    ]
  });
  assert.deepEqual(out[0], { openDay: 1, openMinute: 570, closeDay: 1, closeMinute: 1020 });
  assert.deepEqual(out[1], { openDay: 5, openMinute: 1080, closeDay: 6, closeMinute: 120 });
});

test("a period with no close becomes always-open and reads as such", () => {
  const out = P.normalisePeriods({ periods: [{ open: { day: 0, hour: 0, minute: 0 } }] });
  assert.deepEqual(out, [{ openDay: 0, openMinute: 0, closeDay: 0, closeMinute: 0 }]);
  // End to end: the time engine must call this open at every hour of the week.
  for (let m = 0; m < T.MIN_WEEK; m += 97) {
    assert.equal(T.statusAt(m, out).kind, "open");
  }
});

test("absent or empty hours normalise to null, not an empty array", () => {
  assert.equal(P.normalisePeriods(undefined), null);
  assert.equal(P.normalisePeriods(null), null);
  assert.equal(P.normalisePeriods({}), null);
  assert.equal(P.normalisePeriods({ periods: [] }), null);
  // A malformed period with no open time is dropped.
  assert.equal(P.normalisePeriods({ periods: [{ close: { day: 1, hour: 5 } }] }), null);
});

test("missing hour or minute fields default to zero rather than NaN", () => {
  const out = P.normalisePeriods({
    periods: [{ open: { day: 2, hour: 8 }, close: { day: 2, hour: 20 } }]
  });
  assert.deepEqual(out[0], { openDay: 2, openMinute: 480, closeDay: 2, closeMinute: 1200 });
  assert.ok(!Number.isNaN(out[0].openMinute));
});

test("haversine distance is accurate enough to sort by", () => {
  const chicago = { lat: 41.8781, lng: -87.6298 };
  // Roughly one kilometre due north.
  const north = { lat: 41.8871, lng: -87.6298 };
  const d = P.distanceMetres(chicago, north);
  assert.ok(d > 950 && d < 1050, `expected about 1000 m, got ${Math.round(d)}`);
  assert.equal(Math.round(P.distanceMetres(chicago, chicago)), 0);
  // Chicago to Tokyo is about 10,100 km.
  const tokyo = { lat: 35.6762, lng: 139.6503 };
  const far = P.distanceMetres(chicago, tokyo) / 1000;
  assert.ok(far > 9900 && far < 10400, `expected about 10,100 km, got ${Math.round(far)}`);
});

test("toVenue handles a Google Place with method-style coordinates", () => {
  const place = {
    id: "ChIJtest",
    displayName: { text: "Corner Bakery" },
    location: { lat: () => 41.8781, lng: () => -87.6298 },
    types: ["bakery"],
    rating: 4.6,
    utcOffsetMinutes: -360,
    formattedAddress: "1 Main St, Chicago",
    regularOpeningHours: {
      periods: [{ open: { day: 5, hour: 7 }, close: { day: 5, hour: 15 } }]
    }
  };
  const v = P.toVenue(place, { lat: 41.8781, lng: -87.6298 });
  assert.equal(v.name, "Corner Bakery");
  assert.equal(v.category, "bakery");
  assert.equal(v.lat, 41.8781);
  assert.equal(v.utcOffsetMinutes, -360);
  assert.equal(Math.round(v.metres), 0);
  assert.equal(v.hours.length, 1);
});

test("toVenue handles plain-number coordinates and a bare string name", () => {
  const v = P.toVenue({
    id: "x",
    displayName: "Plain Name",
    location: { lat: 35.6762, lng: 139.6503 },
    types: ["restaurant"],
    utcOffsetMinutes: 540
  }, { lat: 35.6762, lng: 139.6503 });
  assert.equal(v.name, "Plain Name");
  assert.equal(v.lat, 35.6762);
  assert.equal(v.hours, null);
  assert.equal(v.rating, null);
});

test("toVenue survives a Place missing everything optional", () => {
  const v = P.toVenue({ id: "y", location: { lat: 0, lng: 0 } }, null);
  assert.equal(v.name, "Unnamed place");
  assert.equal(v.category, "restaurant");
  assert.equal(v.rating, null);
  assert.equal(v.hours, null);
  assert.equal(v.metres, null);
  assert.equal(v.utcOffsetMinutes, null);
});

test("a venue with no utcOffsetMinutes must not be guessed at", () => {
  const v = P.toVenue({
    id: "z", displayName: { text: "No Zone" }, location: { lat: 1, lng: 1 },
    types: ["bakery"],
    regularOpeningHours: { periods: [{ open: { day: 1, hour: 9 }, close: { day: 1, hour: 17 } }] }
  }, null);
  assert.equal(v.utcOffsetMinutes, null,
    "without a time zone we cannot say whether it is open");
});

test("end to end: a real-shaped Tokyo Place reads correctly from Chicago", () => {
  const place = {
    id: "ChIJramen",
    displayName: { text: "Shinjuku Ramen" },
    location: { lat: () => 35.6762, lng: () => 139.6503 },
    types: ["restaurant"],
    utcOffsetMinutes: 540,
    regularOpeningHours: {
      // 11:00 to 01:00 the next morning, every day.
      periods: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
        open: { day: d, hour: 11, minute: 0 },
        close: { day: (d + 1) % 7, hour: 1, minute: 0 }
      }))
    }
  };
  const v = P.toVenue(place, null);

  // 2026-11-13T17:05:00Z is Saturday 02:05 in Tokyo: just closed.
  const closed = new Date("2026-11-13T17:05:00Z");
  assert.equal(T.statusAt(T.venueWeekMinute(closed, v.utcOffsetMinutes), v.hours).kind, "closed");

  // 2026-11-13T15:30:00Z is Saturday 00:30 in Tokyo: still open from Friday.
  const open = new Date("2026-11-13T15:30:00Z");
  const s = T.statusAt(T.venueWeekMinute(open, v.utcOffsetMinutes), v.hours);
  assert.equal(s.kind, "open");
  assert.equal(T.formatWeekMinute(s.until, false), "01:00");
});
