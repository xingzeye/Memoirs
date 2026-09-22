import { inflateSync } from "fflate";
import { apiJson } from "./api";
import type { FormErrors } from "./types";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_EOCD_SEARCH = 65_557;
const MULTIPART_CHUNK_BYTES = 8 * 1024 * 1024;

type ZipEntry = {
  name: string;
  flags: number;
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  directory: boolean;
};

type StartResponse = {
  jobId: string;
  multipartThreshold: number;
  media: Array<{
    id: string;
    archivePath: string;
    size: number;
    mimeType: string;
    multipart: boolean;
  }>;
};

type ImportResult = {
  imported: { memoirs: number; media: number };
  stats?: { memoirs: number; media: number; photos?: number; videos?: number };
};

export type BackupImportProgress = {
  phase: "reading" | "uploading" | "finalizing";
  completedFiles: number;
  totalFiles: number;
  uploadedBytes: number;
  totalBytes: number;
  currentName?: string;
};

type ImportOptions = {
  file: File;
  startUrl: string;
  csrfToken: string;
  onProgress: (progress: BackupImportProgress) => void;
};

export async function importLargeBackup(options: ImportOptions): Promise<ImportResult> {
  const { file, startUrl, csrfToken, onProgress } = options;
  onProgress({ phase: "reading", completedFiles: 0, totalFiles: 0, uploadedBytes: 0, totalBytes: 0 });
  const archive = await openZip(file);
  const manifest = await readJsonEntry(archive, "manifest.json");
  const memoirsPayload = await readJsonEntry(archive, "memoirs.json");
  if (!memoirsPayload || typeof memoirsPayload !== "object" || !Array.isArray((memoirsPayload as { memoirs?: unknown }).memoirs)) {
    throw backupError("memoirs.json 缺少回忆列表。");
  }

  const memoirs = ((memoirsPayload as { memoirs: Array<Record<string, unknown>> }).memoirs).map((memoir) => {
    const media = Array.isArray(memoir.media) ? memoir.media : [];
    return {
      ...memoir,
      media: media.map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) throw backupError("备份回忆中的媒体记录格式不正确。");
        const record = item as Record<string, unknown>;
        const archivePath = String(record.archivePath || "");
        const entry = archive.entries.get(archivePath);
        if (!entry || entry.directory) throw backupError(`备份缺少媒体文件：${archivePath || "未知路径"}`);
        return { ...record, archiveSize: entry.uncompressedSize };
      }),
    };
  });

  const start = await apiJson<StartResponse>(startUrl, csrfToken, { manifest, memoirs });
  const jobBase = `${startUrl}${encodeURIComponent(start.jobId)}/`;
  const totalBytes = start.media.reduce((sum, item) => sum + item.size, 0);
  let uploadedBytes = 0;
  let completedFiles = 0;
  let finalizing = false;

  try {
    for (const item of start.media) {
      const entry = archive.entries.get(item.archivePath);
      if (!entry) throw backupError(`备份缺少媒体文件：${item.archivePath}`);
      const content = await readEntryBlob(archive, entry, item.mimeType || "application/octet-stream");
      if (content.size !== item.size) throw backupError(`媒体文件大小不一致：${item.archivePath}`);
      onProgress({
        phase: "uploading",
        completedFiles,
        totalFiles: start.media.length,
        uploadedBytes,
        totalBytes,
        currentName: item.archivePath.split("/").pop() || item.archivePath,
      });

      const mediaBase = `${jobBase}media/${encodeURIComponent(item.id)}/`;
      if (item.multipart || content.size > start.multipartThreshold) {
        const multipart = await apiJson<{ uploadId: string }>(`${mediaBase}multipart/`, csrfToken, {});
        const parts: Array<{ partNumber: number; etag: string }> = [];
        for (let offset = 0, partNumber = 1; offset < content.size; offset += MULTIPART_CHUNK_BYTES, partNumber += 1) {
          const chunk = content.slice(offset, Math.min(offset + MULTIPART_CHUNK_BYTES, content.size));
          const part = await binaryRequest<{ partNumber: number; etag: string }>(`${mediaBase}parts/${partNumber}/`, csrfToken, "PUT", chunk);
          parts.push(part);
          uploadedBytes += chunk.size;
          onProgress({
            phase: "uploading",
            completedFiles,
            totalFiles: start.media.length,
            uploadedBytes,
            totalBytes,
            currentName: item.archivePath.split("/").pop() || item.archivePath,
          });
        }
        await apiJson(`${mediaBase}complete/`, csrfToken, { parts });
      } else {
        await binaryRequest(mediaBase, csrfToken, "POST", content);
        uploadedBytes += content.size;
      }
      completedFiles += 1;
      onProgress({ phase: "uploading", completedFiles, totalFiles: start.media.length, uploadedBytes, totalBytes });
    }

    finalizing = true;
    onProgress({ phase: "finalizing", completedFiles, totalFiles: start.media.length, uploadedBytes, totalBytes });
    return await apiJson<ImportResult>(`${jobBase}finalize/`, csrfToken, {});
  } catch (error) {
    if (!finalizing) {
      try {
        await apiJson(`${jobBase}cancel/`, csrfToken, {});
      } catch {
        // The original upload error is more useful than cleanup failure.
      }
    }
    throw error;
  }
}

async function binaryRequest<T = { uploaded: boolean }>(url: string, csrfToken: string, method: "POST" | "PUT", body: Blob): Promise<T> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      "Content-Type": body.type || "application/octet-stream",
      "X-CSRFToken": csrfToken,
      "X-Requested-With": "XMLHttpRequest",
    },
    body,
  });
  const data = (await response.json().catch(() => null)) as T | null;
  if (!response.ok) {
    throw data || backupError(response.status === 413 ? "单个媒体文件仍超过平台限制。" : "媒体上传失败，请重试。");
  }
  return data as T;
}

async function openZip(file: File): Promise<{ file: File; entries: Map<string, ZipEntry> }> {
  if (!file.size) throw backupError("上传的备份文件是空的。");
  const tailStart = Math.max(0, file.size - MAX_EOCD_SEARCH);
  const tail = new Uint8Array(await file.slice(tailStart).arrayBuffer());
  const tailView = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let offset = tail.byteLength - 22; offset >= 0; offset -= 1) {
    if (tailView.getUint32(offset, true) === EOCD_SIGNATURE) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw backupError("请上传有效的备份 ZIP 文件。");
  const entryCount = tailView.getUint16(eocd + 10, true);
  const centralSize = tailView.getUint32(eocd + 12, true);
  const centralOffset = tailView.getUint32(eocd + 16, true);
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw backupError("当前暂不支持超过 4 GB 的 ZIP64 备份，请拆分后导入。");
  }
  if (centralOffset + centralSize > file.size) throw backupError("备份 ZIP 的目录信息已损坏。");
  const central = new Uint8Array(await file.slice(centralOffset, centralOffset + centralSize).arrayBuffer());
  const view = new DataView(central.buffer, central.byteOffset, central.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();
  let offset = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > central.byteLength || view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw backupError("备份 ZIP 的目录信息已损坏。");
    }
    const flags = view.getUint16(offset + 8, true);
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const end = offset + 46 + nameLength + extraLength + commentLength;
    if (end > central.byteLength) throw backupError("备份 ZIP 的目录信息已损坏。");
    const name = decoder.decode(central.subarray(offset + 46, offset + 46 + nameLength));
    if (flags & 0x1) throw backupError("不支持加密的备份 ZIP。");
    entries.set(name, { name, flags, compression, compressedSize, uncompressedSize, localHeaderOffset, directory: name.endsWith("/") });
    offset = end;
  }
  return { file, entries };
}

async function readJsonEntry(archive: { file: File; entries: Map<string, ZipEntry> }, name: string): Promise<Record<string, unknown>> {
  const entry = archive.entries.get(name);
  if (!entry) throw backupError(`备份文件缺少 ${name}。`);
  try {
    const value = JSON.parse(await (await readEntryBlob(archive, entry, "application/json")).text());
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) {
    if ((error as { errors?: FormErrors }).errors) throw error;
    throw backupError(`${name} 不是有效的 JSON。`);
  }
}

async function readEntryBlob(
  archive: { file: File; entries: Map<string, ZipEntry> },
  entry: ZipEntry,
  type: string,
): Promise<Blob> {
  const headerBytes = new Uint8Array(await archive.file.slice(entry.localHeaderOffset, entry.localHeaderOffset + 30).arrayBuffer());
  if (headerBytes.byteLength !== 30) throw backupError(`备份媒体无法读取：${entry.name}`);
  const header = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength);
  if (header.getUint32(0, true) !== LOCAL_SIGNATURE) throw backupError(`备份媒体无法读取：${entry.name}`);
  const dataStart = entry.localHeaderOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  const compressed = archive.file.slice(dataStart, dataStart + entry.compressedSize, type);
  if (entry.compression === 0) return compressed;
  if (entry.compression !== 8) throw backupError(`备份使用了不支持的 ZIP 压缩方式：${entry.name}`);
  const inflated = inflateSync(new Uint8Array(await compressed.arrayBuffer()));
  if (inflated.byteLength !== entry.uncompressedSize) throw backupError(`备份媒体解压后大小不一致：${entry.name}`);
  return new Blob([inflated], { type });
}

function backupError(message: string): { errors: FormErrors } {
  return { errors: { backup: [message] } };
}
