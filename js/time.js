/**
 * TTF time engine.
 *
 * Every judgement about whether a place is open happens in that place's own
 * local time, never the viewer's. Google gives us each venue's current UTC
 * offset, which already accounts for daylight saving at this moment, so we
 * shift the clock by that offset and read the wall time off it.
 *
 * Pure functions only: no DOM, no network. Everything here is unit-tested.
 */
(function (root) {
  "use strict";

  var MIN_DAY = 1440;
  var MIN_WEEK = 10080;

  /**
   * Start and end of an opening period, as minutes from Sunday 00:00 local.
   * The end may run past the end of the week; callers compare modulo a week.
   */
  function periodBounds(p) {
    var start = p.openDay * MIN_DAY + p.openMinute;
    var end = p.closeDay * MIN_DAY + p.closeMinute;

    // Google sends an opening time with no closing time for places that never
    // close. Our normaliser stores that as close === open.
    if (end === start) { return { start: start, end: start + MIN_WEEK }; }

    // Otherwise push the close forward whole days until it follows the open.
    // This covers both "closes after midnight" and a period that runs past
    // Saturday night into Sunday, without inventing an extra week.
    var guard = 0;
    while (end <= start && guard < 8) { end += MIN_DAY; guard++; }
    return { start: start, end: end };
  }

  /**
   * Open/closed at a given minute of the venue's local week.
   * Returns { kind: "open"|"closed"|"unknown", ... }.
   * A venue with no published hours is "unknown" — never "closed".
   */
  function statusAt(weekMinute, periods) {
    if (!periods || !periods.length) { return { kind: "unknown" }; }

    var now = ((weekMinute % MIN_WEEK) + MIN_WEEK) % MIN_WEEK;
    var soonest = null;

    for (var i = 0; i < periods.length; i++) {
      var b = periodBounds(periods[i]);

      // Test this instant and the same instant a week on, so a period that
      // wraps past Saturday still matches early on Sunday.
      if ((now >= b.start && now < b.end) ||
          (now + MIN_WEEK >= b.start && now + MIN_WEEK < b.end)) {
        if (b.end - b.start >= MIN_WEEK) { return { kind: "open", always: true }; }
        return { kind: "open", until: b.end % MIN_WEEK, closesIn: minutesUntil(now, b.end) };
      }

      var wait = b.start - now;
      if (wait < 0) { wait += MIN_WEEK; }
      if (soonest === null || wait < soonest.wait) {
        soonest = { wait: wait, at: b.start % MIN_WEEK };
      }
    }

    return {
      kind: "closed",
      opensAt: soonest ? soonest.at : null,
      opensIn: soonest ? soonest.wait : null
    };
  }

  /**
   * Minutes from `now` to `end`, both minutes-of-week. The period's end may
   * sit a whole week ahead of `now` when the period wrapped past Saturday, so
   * the difference is taken modulo a week rather than used raw.
   */
  function minutesUntil(now, end) {
    return (((end - now) % MIN_WEEK) + MIN_WEEK) % MIN_WEEK;
  }

  /**
   * Minute of the local week at a venue, from a UTC instant and the venue's
   * current UTC offset in minutes (Google's Place.utcOffsetMinutes).
   */
  function venueWeekMinute(date, utcOffsetMinutes) {
    var shifted = new Date(date.getTime() + utcOffsetMinutes * 60000);
    return shifted.getUTCDay() * MIN_DAY +
           shifted.getUTCHours() * 60 +
           shifted.getUTCMinutes();
  }

  /** Wall clock at a venue: { day, hour, minute }. */
  function venueClock(date, utcOffsetMinutes) {
    var shifted = new Date(date.getTime() + utcOffsetMinutes * 60000);
    return {
      day: shifted.getUTCDay(),
      hour: shifted.getUTCHours(),
      minute: shifted.getUTCMinutes(),
      second: shifted.getUTCSeconds()
    };
  }

  /** "9:05 AM" or "09:05". */
  function formatTime(hour, minute, hour12) {
    var mm = minute < 10 ? "0" + minute : String(minute);
    if (!hour12) { return (hour < 10 ? "0" + hour : String(hour)) + ":" + mm; }
    var period = hour < 12 ? "AM" : "PM";
    var h = hour % 12;
    if (h === 0) { h = 12; }
    return h + ":" + mm + " " + period;
  }

  /** Format a minute-of-week as a clock time. */
  function formatWeekMinute(wm, hour12) {
    var m = ((wm % MIN_WEEK) + MIN_WEEK) % MIN_WEEK;
    return formatTime(Math.floor((m % MIN_DAY) / 60), m % 60, hour12);
  }

  /** "in 25 min", "in 3 hours", "in 2 days". */
  function describeGap(minutes) {
    if (minutes === null || minutes === undefined) { return ""; }
    if (minutes < 1) { return "now"; }
    if (minutes < 60) { return "in " + Math.round(minutes) + " min"; }
    var hours = minutes / 60;
    if (hours < 24) {
      var h = Math.round(hours);
      return "in " + h + (h === 1 ? " hour" : " hours");
    }
    var days = Math.round(hours / 24);
    return "in " + days + (days === 1 ? " day" : " days");
  }

  /** "UTC+5:45", from an offset in minutes. */
  function formatOffset(minutes) {
    var sign = minutes < 0 ? "−" : "+";
    var abs = Math.abs(minutes);
    var h = Math.floor(abs / 60);
    var m = abs % 60;
    return "UTC" + sign + h + (m ? ":" + (m < 10 ? "0" + m : m) : "");
  }

  /** Difference between the venue and the viewer, as "3 hours ahead". */
  function describeDifference(venueOffsetMin, viewerOffsetMin) {
    var diff = venueOffsetMin - viewerOffsetMin;
    if (diff === 0) { return "same time as you"; }
    var abs = Math.abs(diff);
    var h = Math.floor(abs / 60);
    var m = abs % 60;
    var parts = [];
    if (h) { parts.push(h + (h === 1 ? " hour" : " hours")); }
    if (m) { parts.push(m + " min"); }
    return parts.join(" ") + (diff > 0 ? " ahead of you" : " behind you");
  }

  var api = {
    MIN_DAY: MIN_DAY,
    MIN_WEEK: MIN_WEEK,
    periodBounds: periodBounds,
    statusAt: statusAt,
    venueWeekMinute: venueWeekMinute,
    venueClock: venueClock,
    formatTime: formatTime,
    formatWeekMinute: formatWeekMinute,
    describeGap: describeGap,
    formatOffset: formatOffset,
    describeDifference: describeDifference
  };

  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TTFTime = api; }
})(typeof self !== "undefined" ? self : this);
