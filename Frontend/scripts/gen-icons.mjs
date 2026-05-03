import sharp from "sharp";
import { mkdirSync } from "node:fs";
mkdirSync("public/icons", { recursive: true });

const sq = "public/agentdir-square-logo.png";
const ls = "public/agentdir-landscape-logo.png";

// Favicons (32, 192, 512), apple-touch (180), maskable
await sharp(sq).resize(32, 32).png().toFile("public/icon-32.png");
await sharp(sq).resize(192, 192).png().toFile("public/icon-192.png");
await sharp(sq).resize(512, 512).png().toFile("public/icon-512.png");
await sharp(sq).resize(180, 180).png().toFile("public/apple-touch-icon.png");
// OG image — landscape 1200x630 with padding
await sharp(ls)
  .resize({ width: 1200, height: 630, fit: "contain", background: { r: 245, g: 242, b: 236 } })
  .jpeg({ quality: 90 })
  .toFile("public/og-image.jpg");
// Twitter / WA card uses same OG
console.log("done");
