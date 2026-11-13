# TTF — Time, Travel, Food

Find food near you anywhere in the world, with opening hours judged in **each
venue's own local time**. A bakery in Tokyo reads correctly whether you are
standing outside it or looking from Chicago.

![status](https://img.shields.io/badge/tests-58%20passing-brightgreen)

## Why the time part is hard

Most "open now" features compare a venue's hours against *your* device clock.
That is wrong the moment you travel, and wrong for anyone planning ahead. TTF
shifts the clock to the venue's own UTC offset — which Google computes live, so
daylight saving is already accounted for — and judges the hours there.

It also handles the cases that usually break:

- a food cart open 17:00–02:00 still reads **open** at 1 AM, after the date flips
- a period running past Saturday night covers early Sunday
- a 24-hour diner reads **Open 24 hours**, not "until 12:00 AM"
- a venue with no published hours reads **Hours unavailable**, never "Closed"
- half-hour and three-quarter-hour zones (Kolkata +5:30, Kathmandu +5:45)

## Features

- **Live map** with Google Maps, markers coloured by open/closed status
- **Real places** from the Google Places API, searched around your actual position
- **Live clock** — every clock on the page ticks each second, and a venue flips
  from open to closed while you watch
- **Dual clocks** on every card: the venue's time and yours, with the difference
  spelled out ("15 hours ahead of you")
- **Filters** by type, radius, and open-now
- **AM/PM or 24-hour**, your choice
- Works without a key, on sample data, so the page is never broken

## Running it

    npm install
    npm start          # http://localhost:8080

Then paste a Google Maps API key into the banner at the top. It is stored in
your browser's local storage and never sent anywhere except Google.

Without a key the page runs on sample venues across six cities, clearly labelled
as sample data.

## Getting a Google Maps API key

1. Create a project in the [Google Cloud console](https://console.cloud.google.com/).
2. Enable **Maps JavaScript API** and **Places API (New)**.
3. Create an API key under *Credentials*.
4. **Restrict it.** Under *Application restrictions* choose *Websites* and add
   your domain. Under *API restrictions* limit it to the two APIs above.

### About the key being in the browser

The Maps JavaScript API is designed to run client-side, so the key is visible in
the browser by design. That is safe **only if you restrict it by HTTP referrer**,
which stops anyone else's site from spending your quota. Do not skip step 4.

This differs from a server-side Places key, which must never reach the browser.
If you later build mobile apps, referrer restriction does not apply to them, so
route those through a backend proxy instead.

## Testing

    npm test           # 58 tests, no network needed

| Suite | Covers |
|---|---|
| `test/time.test.js` | the open/closed engine, clock maths, formatting |
| `test/places.test.js` | the Google Places adapter against realistic payloads |
| `test/app.test.js` | the real page in jsdom: statuses, filters, live ticking, accessibility |
| `test/contrast.test.js` | every text colour against WCAG AA |

Two tests sweep all 10,080 minutes of the week to prove there are no gaps or
double-counted minutes in the hours logic.

## Project layout

    index.html          markup only
    css/styles.css      all styling; palette is contrast-checked
    js/time.js          pure time engine, no DOM, no network
    js/places.js        Google Places adapter and nearby search
    js/demo-data.js     sample venues used when no key is set
    js/app.js           state, rendering, map, geolocation
    server.js           static server for local development
    test/               the suites above

`js/time.js` and `js/places.js` are dependency-free and export through
`module.exports` as well as the browser global, which is how the tests load them.

## Deploying

The site is static: no build step, no dependencies at runtime. Any static host
works.

- **Netlify / Vercel / Cloudflare Pages** — connect the repo, no build command,
  publish directory `.`
- **GitHub Pages** — Settings → Pages → deploy from branch
- **S3 + CloudFront** — upload and enable static website hosting

Whichever you pick, add that domain to your API key's referrer restrictions or
the map will refuse to load.

## Accessibility

Every control is a real `<button>`, `<select>` or `<input>` with a label, so the
page works from the keyboard. Status is carried by text and icon shape as well
as colour — open is a circle, closed a square, unknown a diamond — because the
green and red are deliberately different in lightness but should not be the only
signal. All text clears 4.5:1 contrast, enforced by a test.

## Licence

MIT
