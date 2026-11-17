/**
 * Refresh the small, licensed catalogue images from sources.json.
 * Only CC BY, CC BY-SA, CC0 and public-domain photographs are accepted.
 * No paid stock images or credentials are used.
 */
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";

const directory = path.resolve("client/public/photos/catalog");
const manifest = JSON.parse(await readFile(path.join(directory, "sources.json"), "utf8"));
await mkdir(directory, { recursive: true });
let next = 0;
const failures = [];

async function worker() {
  while (next < manifest.length) {
    const photo = manifest[next++];
    const target = path.join(directory, `${photo.key}.jpg`);
    try {
      if ((await stat(target)).size > 0) continue;
    } catch {
      // The missing photo is downloaded below.
    }
    let source = photo.downloadUrl;
    // Flickr offers smaller licensed copies; avoid multi-megabyte originals.
    if (/staticflickr\.com/.test(source)) {
      source = source.replace(/_[bkhzo]\.(jpe?g)$/i, "_z.$1");
    }
    try {
      let response = await fetch(source, { signal: AbortSignal.timeout(25000) });
      if (
        (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) &&
        photo.thumbnailUrl
      ) {
        response = await fetch(photo.thumbnailUrl, { signal: AbortSignal.timeout(25000) });
      }
      if (!response.ok || !response.headers.get("content-type")?.startsWith("image/")) {
        throw new Error(`Invalid image response: ${response.status}`);
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 600_000) throw new Error("Image exceeds the catalogue size budget");
      await writeFile(target, bytes);
      console.log(`${photo.key}: ${Math.round(bytes.length / 1024)} KB`);
    } catch (error) {
      failures.push(photo.key);
      console.error(`${photo.key}: ${error.message}`);
    }
  }
}

await Promise.all([worker(), worker(), worker()]);
if (failures.length) {
  console.error("Photos not downloaded:", failures.join(", "));
  process.exitCode = 1;
}
