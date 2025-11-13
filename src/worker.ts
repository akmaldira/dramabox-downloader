import fs from "fs";
import path from "path";
import { uploadFileToDrive } from "./google-api";
import type {
  Task,
  WorkerEventDone,
  WorkerEventDownload,
  WorkerEventError,
  WorkerEventUpload,
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
  event: MessageEvent<Task & { threadId: string; googleDriveBasePath?: string }>
) => {
  const msg = event.data;

  const { idx, title, videoUrl, outputPath, threadId } = msg;
  let googleDriveBasePath = msg.googleDriveBasePath;
  if (!googleDriveBasePath) {
    googleDriveBasePath = "Drama";
  }

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
    const total = Number(fs.statSync(outputPath).size) || 0;

    const onUpload = (received: number) => {
      self.postMessage({
        action: "upload",
        idx,
        title,
        threadId,
        received,
        total,
      } as WorkerEventUpload);
    };

    const folderAndFileName = outputPath.split(path.sep).slice(-2) || [];
    const googleDrivePath = path.join(
      googleDriveBasePath,
      folderAndFileName[0] || "",
      folderAndFileName[1] || `${title}.mp4`
    );
    await uploadFileToDrive(outputPath, googleDrivePath, onUpload);

    fs.unlinkSync(outputPath);

    self.postMessage({
      action: "done",
      title,
      idx,
      videoUrl,
      driveUrl: googleDrivePath,
      outputPath,
      threadId,
    } as WorkerEventDone);
  } catch (err) {
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
