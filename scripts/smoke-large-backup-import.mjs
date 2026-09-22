import assert from "node:assert/strict";
import { File } from "node:buffer";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { build } from "esbuild";
import { strToU8, zipSync } from "fflate";

const output = join(process.cwd(), "dist", "large-backup-import-smoke.mjs");
await build({
  entryPoints: [join(process.cwd(), "frontend", "src", "lib", "largeBackupImport.ts")],
  outfile: output,
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node18",
});

try {
  const { importLargeBackup } = await import(`${pathToFileURL(output).href}?v=${Date.now()}`);
  const mediaBytes = new Uint8Array(9 * 1024 * 1024 + 37);
  mediaBytes.fill(7);
  const archivePath = "media/demo/1-photo.jpg";
  const memoirs = {
    memoirs: [{
      title: "大备份测试",
      story: "分片导入",
      memoryDate: "2026-09-22",
      location: "",
      mood: "",
      media: [{ archivePath, originalFilename: "photo.jpg", mediaType: "image", mimeType: "image/jpeg", size: mediaBytes.length }],
    }],
  };
  const zip = zipSync({
    "manifest.json": [strToU8(JSON.stringify({ app: "Memoirs", formatVersion: 1 })), { level: 6 }],
    "memoirs.json": [strToU8(JSON.stringify(memoirs)), { level: 6 }],
    [archivePath]: [mediaBytes, { level: 0 }],
  });
  const file = new File([zip], "large-backup.zip", { type: "application/zip" });
  const originalFetch = globalThis.fetch;
  const partSizes = [];
  let startPayload;
  let completedParts;
  globalThis.fetch = async (url, options = {}) => {
    const path = String(url);
    if (path.endsWith("/jobs/")) {
      startPayload = JSON.parse(String(options.body));
      return Response.json({
        jobId: "job-1",
        multipartThreshold: 16,
        media: [{ id: "media-1", archivePath, size: mediaBytes.length, mimeType: "image/jpeg", multipart: true }],
      }, { status: 201 });
    }
    if (path.endsWith("/multipart/")) return Response.json({ uploadId: "upload-1" }, { status: 201 });
    if (path.includes("/parts/")) {
      const blob = options.body;
      partSizes.push(blob.size);
      const partNumber = Number(path.match(/\/parts\/(\d+)\/$/)[1]);
      return Response.json({ partNumber, etag: `etag-${partNumber}` });
    }
    if (path.endsWith("/complete/")) {
      completedParts = JSON.parse(String(options.body)).parts;
      return Response.json({ uploaded: true });
    }
    if (path.endsWith("/finalize/")) {
      return Response.json({ imported: { memoirs: 1, media: 1 }, stats: { memoirs: 1, media: 1, photos: 1, videos: 0 } });
    }
    throw new Error(`Unexpected request: ${path}`);
  };

  try {
    const result = await importLargeBackup({ file, startUrl: "/memoirs/import/jobs/", csrfToken: "sites", onProgress() {} });
    assert.equal(startPayload.memoirs[0].media[0].archiveSize, mediaBytes.length);
    assert.deepEqual(partSizes, [8 * 1024 * 1024, 1024 * 1024 + 37]);
    assert.deepEqual(completedParts, [{ partNumber: 1, etag: "etag-1" }, { partNumber: 2, etag: "etag-2" }]);
    assert.deepEqual(result.imported, { memoirs: 1, media: 1 });
  } finally {
    globalThis.fetch = originalFetch;
  }
} finally {
  await rm(output, { force: true });
}

console.log("Large backup browser import smoke test passed.");
