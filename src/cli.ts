import fs from "fs";
import os from "os";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { chapterDb, initDb, seriesDb } from "./db";
import { DramaboxAPI } from "./dramabox";
import {
  authorizeGoogleApi,
  createFolderOnDrive,
  uploadFolderToDrive,
} from "./google-api";
import { fmtBytes, normalizeFolderName, question } from "./helper";
import { ThreadLogger } from "./logger";
import type { Series, SlotState, Task, WorkerEvent } from "./types";

const NUM_OF_WORKERS = process.env.NUM_OF_WORKERS
  ? parseInt(process.env.NUM_OF_WORKERS)
  : Math.max(1, Math.floor(os.cpus().length / 2));
const downloadsDir =
  process.env.DOWNLOADS_DIR || path.join(process.cwd(), "downloads");

const mainThreadId = "main";
const threads = [
  mainThreadId,
  ...Array.from({ length: NUM_OF_WORKERS }, (_, i) => `thread-${i + 1}`),
];

const logger = new ThreadLogger(threads);

const sources = {
  dramabox: {
    id: "dramabox",
    api: new DramaboxAPI(),
  },
};

await initDb();

const source = sources.dramabox;

async function buildTasks(series: Series) {
  const seriesDetail = await source.api.getBookDetail(series.id);
  const chapterIds = seriesDetail.chapterList
    .map((chapter) => chapter.id)
    .filter((id) => id !== "");
  if (chapterIds.length === 0) {
    return {
      series: seriesDetail,
      tasks: [],
    };
  }

  logger.info(mainThreadId, `Unlocking ${chapterIds.length} chapters`);
  const unlocked = await source.api.batchUnlockEpisode(series.id, chapterIds);

  const folderName = `${series.title} (${series.id})`;
  const seriesDir = path.join(downloadsDir, normalizeFolderName(folderName));
  if (!fs.existsSync(downloadsDir))
    fs.mkdirSync(downloadsDir, { recursive: true });
  if (!fs.existsSync(seriesDir)) fs.mkdirSync(seriesDir, { recursive: true });

  const tasks: Task[] = [];
  for (const ch of unlocked.chapterVoList) {
    if (!ch.cdnList || ch.cdnList.length === 0) continue;

    let selectedUrl: string | null = null;
    let selectedQuality = 0;
    for (const cdn of ch.cdnList) {
      const sorted = [...cdn.videoPathList].sort(
        (a, b) => b.quality - a.quality
      );
      if (sorted.length === 0) continue;
      const vp = sorted[0]!;
      const maybePath = vp.videoPath;
      const base = (cdn.cdnDomain ?? "").replace(/\/+$/, "");
      const pathPart = String(maybePath ?? "").replace(/^\/+/, "");
      const url =
        maybePath.startsWith("http://") || maybePath.startsWith("https://")
          ? maybePath
          : base
          ? `${base}/${pathPart}`
          : maybePath;

      selectedUrl = url;
      selectedQuality = vp.quality;
      break;
    }
    if (!selectedUrl) continue;

    const indexPadded = String(ch.chapterIndex).padStart(3, "0");
    const outputPath = path.join(seriesDir, `${indexPadded}.mp4`);
    if (fs.existsSync(outputPath)) {
      logger.info(mainThreadId, `Skip ${path.basename(outputPath)} (exists)`);
      continue;
    }

    tasks.push({
      source: source.id,
      sourceId: series.id,
      idx: ch.chapterIndex,
      title: ch.chapterName,
      videoUrl: selectedUrl,
      outputPath,
      driveFolderId: series.drive_folder_id,
    });
  }
  return {
    series: seriesDetail,
    tasks,
  };
}

async function processTasks(seriesRecord: Series, tasks: Task[]) {
  if (tasks.length === 0) {
    logger.info(
      mainThreadId,
      "Nothing to download. All chapters exist or none available."
    );
    return { completed: 0, failed: 0 };
  }

  const total = tasks.length;
  let nextIdx = 0;
  let completed = 0;
  let failed = 0;

  const workerUrl = import.meta.resolve("./worker.ts");
  const slots: SlotState[] = Array.from({ length: NUM_OF_WORKERS }, () => ({
    task: undefined,
    received: 0,
    total: undefined,
  }));

  const assignNext = (w: Worker, slotIdx: number, threadId: string) => {
    if (nextIdx >= tasks.length) return false;
    const task = tasks[nextIdx++]!;
    const chapterRecord = chapterDb.upsert({
      id: uuidv4(),
      series_id: seriesRecord.id,
      idx: task.idx,
      description: null,
      cover_path: null,
      title: task.title,
      video_url: task.videoUrl,
      video_path: task.outputPath,
      drive_url: null,
      status: "pending",
      error_message: null,
    });
    slots[slotIdx] = { task, received: 0, total: undefined };
    logger.info(threadId, `Assigning task: ${task.title} (${task.idx})`);
    w.postMessage({
      ...task,
      threadId,
      chapterRecord,
      driveFolderId: seriesRecord.drive_folder_id,
    });
    return true;
  };

  await new Promise<void>((resolve) => {
    let liveWorkers = 0;

    for (let i = 0; i < Math.min(NUM_OF_WORKERS, tasks.length); i++) {
      const threadIdx = i + 1;
      const threadId = `thread-${threadIdx}`;
      const w = new Worker(workerUrl);
      liveWorkers++;

      w.onmessage = (ev: MessageEvent<WorkerEvent>) => {
        const msg = ev.data;
        if (!msg || typeof msg !== "object") return;

        if (msg.action === "download") {
          const slot = slots[i]!;
          if (!slot.task || slot.task.idx !== msg.idx) return;
          slot.received = msg.received;
          slot.total = msg.total;
          logger.info(
            msg.threadId,
            `Downloading: ${msg.title} [${fmtBytes(msg.received)}/${fmtBytes(
              msg.total
            )}] (${Math.round((msg.received / (msg.total ?? 0)) * 100)}%)`
          );
          return;
        }

        if (msg.action === "upload") {
          const slot = slots[i]!;
          if (!slot.task || slot.task.idx !== msg.idx) return;
          slot.received = msg.received;
          slot.total = msg.total;
          logger.info(
            msg.threadId,
            `Uploading: ${msg.title} [${fmtBytes(msg.received)}/${fmtBytes(
              msg.total
            )}] (${Math.round((msg.received / (msg.total ?? 0)) * 100)}%)`
          );
          return;
        }

        if (msg.action === "done") {
          completed++;
          if (!assignNext(w, i, threadId)) {
            w.terminate();
            liveWorkers--;
            if (liveWorkers === 0) resolve();
            return;
          }
          return;
        }

        if (msg.action === "error") {
          failed++;
          const s = slots[i]!;
          const name = s.task ? s.task.title : "unknown";
          logger.info(msg.threadId, `ERROR: ${name} — ${msg.message}`);
          // Try next
          if (!assignNext(w, i, threadId)) {
            w.terminate();
            liveWorkers--;
            if (liveWorkers === 0) resolve();
          }
          return;
        }
      };

      assignNext(w, i, threadId);
    }
  });

  logger.info(mainThreadId, `Finished ${completed} tasks, ${failed} failed`);
  return { completed, failed };
}

if (import.meta.main) {
  let uploadToDrive = process.env.UPLOAD_TO_DRIVE === "true";
  let deleteAfterUpload = process.env.DELETE_AFTER_UPLOAD === "true";
  if (!uploadToDrive) {
    const uploadToDrivePrompt = await question(
      "Upload to Google Drive? (y/n): "
    );
    if (/^y(es)?$/i.test(uploadToDrivePrompt.trim())) {
      await authorizeGoogleApi();
      uploadToDrive = true;
      const deleteAfterUploadPrompt = await question(
        "Delete after upload to Drive? (y/n): "
      );
      if (/^y(es)?$/i.test(deleteAfterUploadPrompt.trim())) {
        deleteAfterUpload = true;
      }
    }
  }

  // Ger all series (required: id, title)
  const seriesList = (await Bun.file(
    path.join(process.cwd(), "series.json")
  ).json()) as Series[];
  logger.info(mainThreadId, `Found ${seriesList.length} series`);

  for (const series of seriesList) {
    logger.info(mainThreadId, `Processing ${series.title} (${series.id})`);
    const { series: seriesDetail, tasks } = await buildTasks(series);
    const uniqueFolderName = normalizeFolderName(
      `${seriesDetail.book.bookName} (${series.id})`
    );
    let driveFolderId = null;
    if (uploadToDrive) {
      const baseDriveFolderId = await createFolderOnDrive("Dramabox");
      driveFolderId = await createFolderOnDrive(
        uniqueFolderName,
        baseDriveFolderId
      );
    }
    const seriesRecord = seriesDb.upsert({
      id: uuidv4(),
      title: seriesDetail.book.bookName,
      unique_title: uniqueFolderName,
      description: seriesDetail.book.introduction,
      cover_path: seriesDetail.book.cover,
      drive_folder_id: driveFolderId,
      source: source.id,
      source_id: series.id,
    });
    const { completed, failed } = await processTasks(seriesRecord, tasks);
    if (uploadToDrive && driveFolderId) {
      const seriesDir = path.join(
        downloadsDir,
        normalizeFolderName(seriesRecord.unique_title)
      );
      logger.info(
        mainThreadId,
        `Uploading ${seriesDir} to Drive (${driveFolderId})`
      );
      try {
        await uploadFolderToDrive(seriesDir, driveFolderId);
        logger.info(
          mainThreadId,
          `Uploaded ${seriesDir} to Drive (${driveFolderId})`
        );
        if (deleteAfterUpload) {
          logger.info(mainThreadId, `Deleting ${seriesDir}`);
          fs.rmdirSync(seriesDir, { recursive: true });
        }
      } catch (error) {
        logger.info(
          mainThreadId,
          `Failed to upload ${seriesDir} to Drive (${driveFolderId}): ${error}`
        );
        const oldErrorMessage = await Bun.file(
          path.join(process.cwd(), "logs", "error.log")
        ).text();
        await Bun.write(
          path.join(process.cwd(), "logs", "error.log"),
          `${oldErrorMessage}\n${error}`
        );
      }
    }
    logger.info(mainThreadId, `Finished ${completed} tasks, ${failed} failed`);
  }
}
