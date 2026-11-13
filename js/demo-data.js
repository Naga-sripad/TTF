/**
 * Sample venues, used only until a Google Maps API key is supplied.
 * These are invented, not real listings. Offsets are stated in minutes so the
 * demo exercises the same code path as live Google data, including the
 * half-hour and 45-minute zones that catch naive implementations out.
 */
(function (root) {
  "use strict";

  var MIN_WEEK = 10080;

  // Every day of the week, optionally restricted to certain days.
  function daily(openMin, closeMin, days) {
    return (days || [0, 1, 2, 3, 4, 5, 6]).map(function (d) {
      var crosses = closeMin >= 1440;
      return {
        openDay: d,
        openMinute: openMin,
        closeDay: crosses ? (d + 1) % 7 : d,
        closeMinute: closeMin % 1440
      };
    });
  }

  // An opening time with no closing time: never closes.
  var ALWAYS = [{ openDay: 0, openMinute: 0, closeDay: 0, closeMinute: 0 }];

  var CITIES = [
    { id: "chicago",   name: "Chicago, USA",      lat: 41.8781,  lng: -87.6298, offset: -360 },
    { id: "tokyo",     name: "Tokyo, Japan",      lat: 35.6762,  lng: 139.6503, offset: 540 },
    { id: "paris",     name: "Paris, France",     lat: 48.8566,  lng: 2.3522,   offset: 60 },
    { id: "kolkata",   name: "Kolkata, India",    lat: 22.5726,  lng: 88.3639,  offset: 330 },
    { id: "kathmandu", name: "Kathmandu, Nepal",  lat: 27.7172,  lng: 85.3240,  offset: 345 },
    { id: "auckland",  name: "Auckland, NZ",      lat: -36.8485, lng: 174.7633, offset: 780 }
  ];

  var VENUES = [
    // Chicago
    ["chicago", "Corner Bakery",          "bakery",     300,  4.6, daily(420, 900)],
    ["chicago", "Night Market Tacos",     "foodCart",   800,  4.4, daily(1020, 1560)],
    ["chicago", "Harbor Food Hall",       "foodCourt", 1200,  4.2, null],
    ["chicago", "Lakeside Diner",         "restaurant",2100,  4.1, ALWAYS],
    // Tokyo
    ["tokyo", "Shinjuku Ramen Counter",   "restaurant", 400,  4.7, daily(660, 1500)],
    ["tokyo", "Asakusa Melonpan",         "bakery",    1100,  4.5, daily(420, 1080)],
    ["tokyo", "Station Food Court",       "foodCourt",  600,  4.0, daily(600, 1320)],
    ["tokyo", "Yatai Yakitori Cart",      "foodCart",  2400,  4.3, daily(1080, 1620)],
    // Paris
    ["paris", "Boulangerie Saint-Paul",   "bakery",     200,  4.8, daily(390, 1200, [1,2,3,4,5,6])],
    ["paris", "Le Petit Bistro",          "restaurant", 900,  4.4, daily(720, 1380, [2,3,4,5,6])],
    ["paris", "Crepe Stand Montmartre",   "foodCart",  2800,  4.1, daily(660, 1320)],
    // Kolkata
    ["kolkata", "Park Street Kitchen",    "restaurant", 500,  4.3, daily(660, 1380)],
    ["kolkata", "Sweet Shop and Bakery",  "bakery",    1400,  4.6, daily(480, 1260)],
    ["kolkata", "Kathi Roll Cart",        "foodCart",   700,  4.5, daily(960, 1500)],
    // Kathmandu
    ["kathmandu", "Thamel Momo House",    "restaurant", 400,  4.4, daily(600, 1320)],
    ["kathmandu", "Himalayan Bakery",     "bakery",    1000,  4.2, daily(420, 1140)],
    // Auckland
    ["auckland", "Britomart Food Hall",   "foodCourt",  300,  4.1, daily(540, 1260)],
    ["auckland", "Ponsonby Bakehouse",    "bakery",    2200,  4.7, daily(360, 960)],
    ["auckland", "Night Noodle Cart",     "foodCart",  1600,  4.0, null]
  ];

  /** Venues for one city, in the same shape the Places adapter produces. */
  function venuesFor(cityId) {
    var city = null;
    for (var i = 0; i < CITIES.length; i++) {
      if (CITIES[i].id === cityId) { city = CITIES[i]; break; }
    }
    if (!city) { return []; }

    return VENUES.filter(function (v) { return v[0] === cityId; })
      .map(function (v, index) {
        // Scatter the markers around the city centre so the map reads sensibly.
        var angle = (index * 2.4) % (Math.PI * 2);
        var degrees = v[3] / 111000;
        return {
          id: cityId + "-" + index,
          name: v[1],
          category: v[2],
          metres: v[3],
          rating: v[4],
          hours: v[5],
          utcOffsetMinutes: city.offset,
          lat: city.lat + Math.cos(angle) * degrees,
          lng: city.lng + Math.sin(angle) * degrees * 1.3,
          address: city.name,
          demo: true
        };
      })
      .sort(function (a, b) { return a.metres - b.metres; });
  }

  var api = { CITIES: CITIES, venuesFor: venuesFor, daily: daily, ALWAYS: ALWAYS, MIN_WEEK: MIN_WEEK };

  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TTFDemo = api; }
})(typeof self !== "undefined" ? self : this);
