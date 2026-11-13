const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../js/time.js");

const { MIN_DAY, MIN_WEEK } = T;
const wm = (day, hour, min = 0) => day * MIN_DAY + hour * 60 + min;
const hhmm = (x) => T.formatWeekMinute(x, false);

const daily = (open, close, days = [0, 1, 2, 3, 4, 5, 6]) =>
  days.map((d) => ({
    openDay: d,
    openMinute: open,
    closeDay: close >= MIN_DAY ? (d + 1) % 7 : d,
    closeMinute: close % MIN_DAY
  }));

const ALWAYS = [{ openDay: 0, openMinute: 0, closeDay: 0, closeMinute: 0 }];

test("plain daytime hours, with an exclusive closing minute", () => {
  const p = daily(7 * 60, 15 * 60);
  assert.equal(T.statusAt(wm(5, 7), p).kind, "open");
  assert.equal(T.statusAt(wm(5, 14, 59), p).kind, "open");
  assert.equal(T.statusAt(wm(5, 15), p).kind, "closed");
  assert.equal(T.statusAt(wm(5, 6, 59), p).kind, "closed");
});

test("hours crossing midnight stay open after the date flips", () => {
  const p = daily(17 * 60, 26 * 60);
  assert.equal(T.statusAt(wm(5, 23), p).kind, "open");
  assert.equal(T.statusAt(wm(6, 1, 59), p).kind, "open");
  assert.equal(T.statusAt(wm(6, 2), p).kind, "closed");
  assert.equal(hhmm(T.statusAt(wm(5, 23), p).until), "02:00");
});

test("a period wrapping past Saturday night covers early Sunday", () => {
  const p = [{ openDay: 6, openMinute: 22 * 60, closeDay: 0, closeMinute: 3 * 60 }];
  assert.equal(T.statusAt(wm(0, 1), p).kind, "open");
  assert.equal(T.statusAt(wm(0, 4), p).kind, "closed");
  const b = T.periodBounds(p[0]);
  assert.equal(b.end - b.start, 300, "five hours, not most of a week");
});

test("close === open means always open", () => {
  const s = T.statusAt(wm(3, 3), ALWAYS);
  assert.equal(s.kind, "open");
  assert.equal(s.always, true);
  for (let m = 0; m < MIN_WEEK; m += 13) {
    assert.equal(T.statusAt(m, ALWAYS).kind, "open", `closed at minute ${m}`);
  }
});

test("a same-day midnight close is 15 hours, not 6.6 days", () => {
  const p = [{ openDay: 5, openMinute: 9 * 60, closeDay: 5, closeMinute: 0 }];
  assert.equal(T.periodBounds(p[0]).end - T.periodBounds(p[0]).start, 900);
  assert.equal(T.statusAt(wm(5, 12), p).kind, "open");
  assert.equal(T.statusAt(wm(6, 12), p).kind, "closed");
  assert.equal(T.statusAt(wm(2, 12), p).kind, "closed");
});

test("a next-day midnight close is also 15 hours", () => {
  const p = [{ openDay: 5, openMinute: 9 * 60, closeDay: 6, closeMinute: 0 }];
  assert.equal(T.periodBounds(p[0]).end - T.periodBounds(p[0]).start, 900);
  assert.equal(T.statusAt(wm(5, 23, 59), p).kind, "open");
  assert.equal(T.statusAt(wm(6, 0, 1), p).kind, "closed");
});

test("closed days point at the soonest next opening", () => {
  const p = daily(6 * 60 + 30, 20 * 60, [1, 2, 3, 4, 5, 6]);
  const s = T.statusAt(wm(0, 10), p);
  assert.equal(s.kind, "closed");
  assert.equal(hhmm(s.opensAt), "06:30");
  assert.equal(s.opensIn, 20 * 60 + 30);
});

test("soonest opening wins even when listed out of order", () => {
  const p = [
    { openDay: 6, openMinute: 540, closeDay: 6, closeMinute: 1020 },
    { openDay: 1, openMinute: 540, closeDay: 1, closeMinute: 1020 }
  ];
  const s = T.statusAt(wm(0, 12), p);
  assert.equal(s.opensIn, 21 * 60, "Monday, not next Saturday");
});

test("split lunch and dinner service", () => {
  const p = [
    { openDay: 2, openMinute: 690, closeDay: 2, closeMinute: 840 },
    { openDay: 2, openMinute: 1080, closeDay: 2, closeMinute: 1320 }
  ];
  assert.equal(T.statusAt(wm(2, 12), p).kind, "open");
  assert.equal(T.statusAt(wm(2, 16), p).kind, "closed");
  assert.equal(hhmm(T.statusAt(wm(2, 16), p).opensAt), "18:00");
  assert.equal(T.statusAt(wm(2, 20), p).kind, "open");
});

test("missing hours is unknown, never closed", () => {
  [null, undefined, []].forEach((h) => {
    assert.equal(T.statusAt(wm(2, 12), h).kind, "unknown");
  });
});

test("open minutes per week are exact, with no gaps or double counting", () => {
  const count = (p) => {
    let n = 0;
    for (let m = 0; m < MIN_WEEK; m++) { if (T.statusAt(m, p).kind === "open") n++; }
    return n;
  };
  assert.equal(count(daily(9 * 60, 17 * 60)), 7 * 8 * 60);
  assert.equal(count(daily(17 * 60, 26 * 60)), 7 * 9 * 60);
  assert.equal(count(ALWAYS), MIN_WEEK);
});

test("closesIn and opensIn are always sane", () => {
  const sets = [daily(7 * 60, 15 * 60), daily(17 * 60, 26 * 60), ALWAYS,
                daily(6 * 60, 20 * 60, [1, 3, 5])];
  for (const p of sets) {
    for (let m = 0; m < MIN_WEEK; m += 7) {
      const s = T.statusAt(m, p);
      if (s.kind === "open" && !s.always) {
        assert.ok(s.closesIn > 0 && s.closesIn <= MIN_WEEK, `closesIn ${s.closesIn} at ${m}`);
      }
      if (s.kind === "closed") {
        assert.ok(s.opensIn >= 0 && s.opensIn < MIN_WEEK, `opensIn ${s.opensIn} at ${m}`);
      }
    }
  }
});

// ------------------------------------------------------------ clock maths

test("venueWeekMinute reads the venue's wall clock, not the viewer's", () => {
  // 2026-11-13T17:05:00Z. Chicago is UTC-6 -> Friday 11:05. Tokyo is UTC+9 -> Saturday 02:05.
  const d = new Date("2026-11-13T17:05:00Z");
  assert.equal(T.venueWeekMinute(d, -360), wm(5, 11, 5), "Chicago");
  assert.equal(T.venueWeekMinute(d, 540), wm(6, 2, 5), "Tokyo");
  assert.equal(T.venueWeekMinute(d, 345), wm(5, 22, 50), "Kathmandu at UTC+5:45");
});

test("venueClock handles the week boundary in both directions", () => {
  // Sunday 00:30 UTC, seen from a zone three hours behind: Saturday 21:30.
  const d = new Date("2026-11-15T00:30:00Z");
  const back = T.venueClock(d, -180);
  assert.equal(back.day, 6);
  assert.equal(back.hour, 21);
  // And from a zone two hours ahead: still Sunday, 02:30.
  const fwd = T.venueClock(d, 120);
  assert.equal(fwd.day, 0);
  assert.equal(fwd.hour, 2);
});

test("formatTime covers midnight and noon correctly", () => {
  assert.equal(T.formatTime(0, 0, true), "12:00 AM");
  assert.equal(T.formatTime(0, 5, true), "12:05 AM");
  assert.equal(T.formatTime(12, 0, true), "12:00 PM");
  assert.equal(T.formatTime(13, 7, true), "1:07 PM");
  assert.equal(T.formatTime(23, 59, true), "11:59 PM");
  assert.equal(T.formatTime(0, 0, false), "00:00");
  assert.equal(T.formatTime(9, 5, false), "09:05");
  assert.equal(T.formatTime(23, 59, false), "23:59");
});

test("formatOffset renders whole, half and three-quarter hour zones", () => {
  assert.equal(T.formatOffset(0), "UTC+0");
  assert.equal(T.formatOffset(540), "UTC+9");
  assert.equal(T.formatOffset(330), "UTC+5:30");
  assert.equal(T.formatOffset(345), "UTC+5:45");
  assert.equal(T.formatOffset(-360), "UTC−6");
  assert.equal(T.formatOffset(-210), "UTC−3:30");
});

test("describeDifference reads naturally in both directions", () => {
  assert.equal(T.describeDifference(540, -360), "15 hours ahead of you");
  assert.equal(T.describeDifference(-360, 540), "15 hours behind you");
  assert.equal(T.describeDifference(330, 0), "5 hours 30 min ahead of you");
  assert.equal(T.describeDifference(60, 60), "same time as you");
});

test("describeGap rounds to useful units", () => {
  assert.equal(T.describeGap(0), "now");
  assert.equal(T.describeGap(25), "in 25 min");
  assert.equal(T.describeGap(60), "in 1 hour");
  assert.equal(T.describeGap(300), "in 5 hours");
  assert.equal(T.describeGap(60 * 30), "in 1 day");
  assert.equal(T.describeGap(60 * 50), "in 2 days");
});

test("closesIn is measured from now, even when the period wrapped the week", () => {
  // Saturday 17:00 to Sunday 02:00. At Sunday 00:00 the place is open with
  // two hours left, not a week and two hours.
  const p = daily(17 * 60, 26 * 60);
  const s = T.statusAt(wm(0, 0), p);
  assert.equal(s.kind, "open");
  assert.equal(s.closesIn, 120, "two hours left, not 10200 minutes");
  assert.equal(hhmm(s.until), "02:00");
  assert.equal(T.describeGap(s.closesIn), "in 2 hours");
});
