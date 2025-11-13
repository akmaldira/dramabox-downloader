import fs from "fs";
import { chapterDb } from "./db";
import type {
  Chapter,
  Task,
  WorkerEventDone,
  WorkerEventDownload,
  WorkerEventError,
} from "./types";

declare var self: Worker;

async function downloadFile(
  url: string,
  outPath: string,
  onDownload: (r: number, t?: number) => void
) {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const total = Number(res.headers.get("content-length") || 0) || undefined;

  const file = fs.createWriteStream(outPath, { flags: "w" });
  const reader = res.body.getReader();

  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        file.write(Buffer.from(value));
        onDownload(received, total);
      }
    }
  } catch (e) {
    file.destroy();
    throw e;
  } finally {
    file.end();
  }
}

self.onmessage = async (
  event: MessageEvent<Task & { threadId: string; chapterRecord: Chapter }>
) => {
  const msg = event.data;

  const {
    idx,
    title,
    videoUrl,
    outputPath,
    threadId,
    chapterRecord,
    driveFolderId,
  } = msg;

  try {
    if (fs.existsSync(outputPath)) {
      self.postMessage({
        action: "done",
        title,
        idx,
        threadId,
      } as WorkerEventDone);
      return;
    }

    const tempPath = `${outputPath}.part`;
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}

    self.postMessage({
      action: "download",
      idx,
      title,
      threadId,
      received: 0,
      total: undefined,
    } as WorkerEventDownload);

    const onDownload = (received: number, total?: number) => {
      self.postMessage({
        action: "download",
        idx,
        title,
        threadId,
        received,
        total,
      } as WorkerEventDownload);
    };
    await downloadFile(videoUrl, tempPath, onDownload);
    fs.renameSync(tempPath, outputPath);
    chapterRecord.video_path = outputPath;
    chapterRecord.status = chapterRecord.status + ",downloaded";

    if (driveFolderId) {
      // MALAS
      // chapterRecord.drive_url = await uploadFileToDrive(
      //   outputPath,
      //   driveFolderId
      // );
    }

    chapterDb.updateUnique(chapterRecord);
    self.postMessage({
      action: "done",
      title,
      idx,
      threadId,
    } as WorkerEventDone);
  } catch (err) {
    chapterRecord.status = chapterRecord.status + ",failed";
    chapterRecord.error_message =
      err instanceof Error ? err.message : String(err);
    chapterDb.updateUnique(chapterRecord);
    self.postMessage({
      action: "error",
      title,
      idx,
      videoUrl,
      threadId,
      message: err instanceof Error ? err.message : String(err),
    } as WorkerEventError);
  }
};
