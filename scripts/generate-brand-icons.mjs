import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

// Run from the repository root after editing the canonical plate artwork.
const mark = await readFile("public/brand/ofb-mark.svg", "utf8");
const artwork = mark.slice(mark.indexOf(">") + 1, mark.lastIndexOf("</svg>"));
const wrap = (background, transform) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120" role="img" aria-label="Open Fantasy Baseball">\n${background}\n<g transform="${transform}">${artwork}</g>\n</svg>\n`;
const tile = wrap('<rect width="120" height="120" rx="26" fill="#14213d" />', "translate(13 13) scale(.783333)");
// All plate corners fit inside the central 80%-diameter maskable safe circle.
const maskable = wrap('<rect width="120" height="120" fill="#14213d" />', "translate(27 25) scale(.55)");
await writeFile("public/brand/ofb-tile.svg", tile);
await writeFile("public/brand/ofb-maskable.svg", maskable);
await writeFile("public/brand/ofb-mark-navy.svg", mark);
await writeFile("app/icon.svg", tile);
for (const size of [32, 192, 512]) {
  await sharp(Buffer.from(tile)).resize(size, size).png().toFile(`public/icons/icon-${size}.png`);
}
await sharp(Buffer.from(tile)).resize(180, 180).png().toFile("public/icons/apple-touch-icon.png");
for (const size of [192, 512]) {
  for (const prefix of ["icon-maskable", "icon-maskable-v2", "icon-maskable-v3"]) {
    await sharp(Buffer.from(maskable)).resize(size, size).png().toFile(`public/icons/${prefix}-${size}.png`);
  }
}
