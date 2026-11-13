/**
 * Google Places adapter.
 *
 * Turns Google's Place objects into the plain shape the rest of TTF uses, and
 * runs the live Nearby Search. Keeping the normalising separate from the
 * network call means it can be unit-tested without Google.
 */
(function (root) {
  "use strict";

  // Our four categories, mapped to Google place types. Food carts have no
  // dedicated Google type; takeaway is the closest available stand-in.
  var CATEGORY_TYPES = {
    restaurant: ["restaurant"],
    bakery: ["bakery"],
    foodCart: ["meal_takeaway"],
    foodCourt: ["food_court"]
  };

  var CATEGORY_LABEL = {
    restaurant: "Restaurant",
    bakery: "Bakery",
    foodCart: "Food cart",
    foodCourt: "Food court"
  };

  /** Which of our categories a Google type list belongs to. */
  function categoryFor(types) {
    types = types || [];
    for (var key in CATEGORY_TYPES) {
      if (!Object.prototype.hasOwnProperty.call(CATEGORY_TYPES, key)) { continue; }
      for (var i = 0; i < CATEGORY_TYPES[key].length; i++) {
        if (types.indexOf(CATEGORY_TYPES[key][i]) !== -1) { return key; }
      }
    }
    return "restaurant";
  }

  /**
   * Google's opening periods -> our {openDay, openMinute, closeDay, closeMinute}.
   * A period with an open time and no close means the venue never closes;
   * we store that as close === open, which the time engine reads as always open.
   */
  function normalisePeriods(regularOpeningHours) {
    var periods = regularOpeningHours && regularOpeningHours.periods;
    if (!periods || !periods.length) { return null; }

    var out = [];
    for (var i = 0; i < periods.length; i++) {
      var p = periods[i];
      if (!p || !p.open) { continue; }
      var openDay = p.open.day;
      var openMinute = (p.open.hour || 0) * 60 + (p.open.minute || 0);
      var closeDay = p.close ? p.close.day : openDay;
      var closeMinute = p.close ? (p.close.hour || 0) * 60 + (p.close.minute || 0) : openMinute;
      out.push({
        openDay: openDay,
        openMinute: openMinute,
        closeDay: closeDay,
        closeMinute: closeMinute
      });
    }
    return out.length ? out : null;
  }

  /** Metres between two lat/lng points, by the haversine formula. */
  function distanceMetres(a, b) {
    var R = 6371000;
    var toRad = function (d) { return d * Math.PI / 180; };
    var dLat = toRad(b.lat - a.lat);
    var dLng = toRad(b.lng - a.lng);
    var lat1 = toRad(a.lat);
    var lat2 = toRad(b.lat);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /**
   * A Google Place -> our venue shape.
   * `origin` is the search centre, used for the distance readout.
   */
  function toVenue(place, origin) {
    var loc = place.location;
    // Google's LatLng exposes lat/lng as either methods or plain numbers
    // depending on how the object was built; handle both.
    var lat = loc && (typeof loc.lat === "function" ? loc.lat() : loc.lat);
    var lng = loc && (typeof loc.lng === "function" ? loc.lng() : loc.lng);

    var name = place.displayName;
    if (name && typeof name === "object" && name.text) { name = name.text; }

    return {
      id: place.id,
      name: name || "Unnamed place",
      category: categoryFor(place.types),
      lat: lat,
      lng: lng,
      // Current UTC offset at the venue. Google computes this live, so it is
      // already correct for daylight saving today.
      utcOffsetMinutes: typeof place.utcOffsetMinutes === "number" ? place.utcOffsetMinutes : null,
      hours: normalisePeriods(place.regularOpeningHours),
      rating: typeof place.rating === "number" ? place.rating : null,
      address: place.formattedAddress || "",
      metres: (origin && lat != null && lng != null)
        ? distanceMetres(origin, { lat: lat, lng: lng })
        : null
    };
  }

  /**
   * Live nearby search through the Google Maps JavaScript API.
   * Resolves to an array of venues sorted nearest first.
   */
  async function searchNearby(options) {
    var origin = options.origin;
    var radius = options.radius;
    var categories = options.categories && options.categories.length
      ? options.categories
      : Object.keys(CATEGORY_TYPES);

    var includedTypes = [];
    categories.forEach(function (c) {
      (CATEGORY_TYPES[c] || []).forEach(function (t) {
        if (includedTypes.indexOf(t) === -1) { includedTypes.push(t); }
      });
    });

    var placesLib = await google.maps.importLibrary("places");
    var Place = placesLib.Place;
    var SearchNearbyRankPreference = placesLib.SearchNearbyRankPreference;

    var response = await Place.searchNearby({
      // Only these fields are requested. Google bills per field, so the list
      // stays as short as the UI allows.
      fields: ["id", "displayName", "location", "types", "rating",
               "regularOpeningHours", "utcOffsetMinutes", "formattedAddress"],
      locationRestriction: { center: origin, radius: radius },
      includedTypes: includedTypes,
      maxResultCount: 20,
      rankPreference: SearchNearbyRankPreference
        ? SearchNearbyRankPreference.DISTANCE
        : undefined
    });

    var places = response.places || [];
    return places
      .map(function (p) { return toVenue(p, origin); })
      .filter(function (v) { return v.lat != null && v.lng != null; })
      .sort(function (a, b) { return (a.metres || 0) - (b.metres || 0); });
  }

  var api = {
    CATEGORY_TYPES: CATEGORY_TYPES,
    CATEGORY_LABEL: CATEGORY_LABEL,
    categoryFor: categoryFor,
    normalisePeriods: normalisePeriods,
    distanceMetres: distanceMetres,
    toVenue: toVenue,
    searchNearby: searchNearby
  };

  if (typeof module === "object" && module.exports) { module.exports = api; }
  else { root.TTFPlaces = api; }
})(typeof self !== "undefined" ? self : this);
