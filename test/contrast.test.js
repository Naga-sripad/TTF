// Guards the palette: every text color in the shipped page must clear WCAG AA (4.5:1).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const css = fs.readFileSync(path.join(__dirname, "..", "css", "styles.css"), "utf8");

function tokens() {
  const block = css.match(/:root\s*\{([\s\S]*?)\}/);
  assert.ok(block, ":root block not found");
  const out = {};
  block[1].replace(/--([\w-]+)\s*:\s*(#[0-9A-Fa-f]{6})/g, (_, k, v) => { out[k] = v; return _; });
  return out;
}

const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const lum = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a, b) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

test("every foreground token clears 4.5:1 on both backgrounds", () => {
  const t = tokens();
  const backgrounds = [["page", t.bg], ["card", t.surface]];
  const foregrounds = ["ink", "muted", "faint", "open", "closed", "unknown"];
  const failures = [];
  for (const name of foregrounds) {
    assert.ok(t[name], `token --${name} missing`);
    for (const [bgName, bgHex] of backgrounds) {
      const r = ratio(t[name], bgHex);
      if (r < 4.5) failures.push(`--${name} on ${bgName}: ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(failures, [], "contrast failures:\n" + failures.join("\n"));
});

test("inverted text on the dark chip also clears 4.5:1", () => {
  const t = tokens();
  assert.ok(ratio(t.bg, t.ink) >= 4.5);
});

test("open and closed differ in lightness, not hue alone", () => {
  const t = tokens();
  const d = Math.abs(lum(t.open) - lum(t.closed));
  // Red/green is the classic colour-blind trap, so the two must also be
  // distinguishable by brightness. The status icons differ in shape too.
  assert.ok(d > 0.01, `open and closed are too close in lightness (${d.toFixed(4)})`);
});
