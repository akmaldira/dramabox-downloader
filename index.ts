import fs from "fs";
import path from "path";
import readline from "readline";
import { DramaboxAPI } from "./src/dramabox";

async function getDramaboxChapterList(
  bookId: string,
  quality: number | null = null
) {
  const dramabox = new DramaboxAPI();
  const detail = await dramabox.getBookDetail(bookId);

  const chapters = detail.chapterList.map((chapter: any) => chapter.id);
  const unlocked = await dramabox.batchUnlockEpisode(bookId, chapters);

  const sortedChapters = unlocked.chapterVoList.sort(
    (a: any, b: any) => a.chapterIndex - b.chapterIndex
  );

  const chapterList = [];
  for (const chapter of sortedChapters) {
    if (chapter.cdnList.length === 0) {
      console.warn(`Chapter ${chapter.chapterIndex} has no cdn list`);
      continue;
    }
    let mp4Url = null;
    let qualitySelected = null;
    if (quality) {
      for (const cdn of chapter.cdnList) {
        const videoPathList = cdn.videoPathList;
        const correctQuality = videoPathList.find(
          (path: any) => path.quality === quality
        );
        if (correctQuality) {
          mp4Url = correctQuality.videoPath;
          qualitySelected = correctQuality.quality;
          break;
        }
      }
    } else {
      for (const cdn of chapter.cdnList) {
        mp4Url = cdn.videoPathList[0]?.videoPath ?? null;
        qualitySelected = cdn.videoPathList[0]?.quality ?? null;
        break;
      }
      if (!mp4Url) {
        process.stdout.write(
          `Chapter ${chapter.chapterIndex} has no mp4 url\n`
        );
        continue;
      }
    }
    chapterList.push({
      chapterIndex: chapter.chapterIndex,
      mp4Url: mp4Url,
      qualitySelected: qualitySelected,
    });
  }

  return chapterList;
}
/**
 * Minimal readline prompt helper
 */
function createPrompter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const question = (q: string) =>
    new Promise<string>((resolve) => rl.question(q, (ans) => resolve(ans)));
  const close = () => rl.close();
  return { question, close };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
}

function renderProgress(prefix: string, received: number, total?: number) {
  const width = 28;
  let ratio = 0;
  if (total && total > 0) {
    ratio = Math.min(1, received / total);
  }
  const filled = Math.round(width * ratio);
  const bar =
    "[" + "#".repeat(filled) + "-".repeat(Math.max(0, width - filled)) + "]";
  const percent = total && total > 0 ? ` ${(ratio * 100).toFixed(0)}%` : "";
  const sizeInfo =
    total && total > 0
      ? ` ${formatBytes(received)} / ${formatBytes(total)}`
      : ` ${formatBytes(received)}`;
  return `${prefix} ${bar}${percent}${sizeInfo}`;
}

async function downloadWithProgress(
  url: string,
  outPath: string,
  label: string
): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download (${res.status})`);
  }
  const total = Number(res.headers.get("content-length") ?? 0) || undefined;
  const reader = res.body.getReader();
  const fd = fs.openSync(outPath, "w");
  let received = 0;

  try {
    process.stdout.write(renderProgress(label, received, total));
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        fs.writeSync(fd, value);
        process.stdout.write("\r" + renderProgress(label, received, total));
      }
    }
    process.stdout.write("\r" + renderProgress(label, received, total) + "\n");
  } finally {
    fs.closeSync(fd);
  }
}

function sanitizeFileName(name: string): string {
  const baseFolder = "./downloads";
  if (!fs.existsSync(baseFolder)) {
    fs.mkdirSync(baseFolder);
  }
  const sanitized = name.replace(/[\\/:*?"<>|]+/g, "_").trim();
  const sanitizedPath = path.join(baseFolder, sanitized);
  if (fs.existsSync(sanitizedPath)) {
    return sanitizedPath;
  }
  return sanitizedPath;
}

async function mergeMp4FilesConcat(filePaths: string[], outputPath: string) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error("No input files provided for merge.");
  }
  const tempListPath = `${outputPath}.list.txt`;
  const toListLine = (p: string) => {
    const abs = path.resolve(p);
    // escape single quotes for ffmpeg concat demuxer
    const escaped = abs.replace(/'/g, "'\\''");
    return `file '${escaped}'`;
  };
  fs.writeFileSync(tempListPath, filePaths.map(toListLine).join("\n"));
  try {
    // First attempt: fast remux (stream copy). This may fail when segments have
    // slightly different codec parameters or contain corrupt NAL units.
    const fastArgs = [
      "ffmpeg",
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      tempListPath,
      // be tolerant to minor issues
      "-fflags",
      "+discardcorrupt",
      "-c",
      "copy",
      outputPath,
    ];
    const fastProc = Bun.spawn(fastArgs, {
      stdout: "inherit",
      stderr: "inherit",
    });
    const fastCode = await fastProc.exited;
    if (fastCode !== 0) {
      // Fallback: re-encode to unify bitstreams (robust for mismatched SPS/PPS etc.)
      console.warn(
        "Fast concat failed; retrying with re-encode to normalize streams..."
      );
      const encodeArgs = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        tempListPath,
        "-map",
        "0:v:0?",
        "-map",
        "0:a:0?",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outputPath,
      ];
      const encProc = Bun.spawn(encodeArgs, {
        stdout: "inherit",
        stderr: "inherit",
      });
      const encCode = await encProc.exited;
      console.log(`ffmpeg re-encode concat exited with code ${encCode}`);
      if (encCode !== 0) {
        throw new Error(`ffmpeg re-encode concat failed with code ${encCode}`);
      }
    }
  } catch (e: any) {
    console.error(`  Merge failed: ${e?.message ?? String(e)}`);
  } finally {
    try {
      fs.unlinkSync(tempListPath);
    } catch {
      // ignore
    }
  }
}

async function deleteFiles(filePaths: string[]) {
  for (const filePath of filePaths) {
    try {
      fs.unlinkSync(filePath);
    } catch (e: any) {
      if (e.code === "ENOENT") {
        continue;
      }
      console.error(`  Failed to delete file: ${filePath}`);
    }
  }
}

async function runInteractiveCli() {
  const prompter = createPrompter();
  try {
    const keyword =
      (await prompter.question("Enter search keyword: ")).trim() || "";
    if (!keyword) {
      console.error("Keyword is required.");
      return;
    }

    const api = new DramaboxAPI();
    process.stdout.write("Searching...\n");
    const result = await api.searchBook(keyword);
    const list = (result.searchList ?? []) as any[];
    if (!Array.isArray(list) || list.length === 0) {
      console.error("No results found.");
      return;
    }

    const top = list.slice(0, 10);
    console.log("\nSelect a title:");
    top.forEach((item, idx) => {
      const title = item.bookName ?? item.title ?? `Result ${idx + 1}`;
      const author = item.authorName ? ` — ${item.authorName}` : "";
      console.log(`  [${idx}] ${title}${author}`);
    });
    const selAns = (await prompter.question("\nEnter index [0]: ")).trim();
    const sel =
      selAns === "" ? 0 : Math.max(0, Math.min(top.length - 1, Number(selAns)));
    if (!Number.isFinite(sel)) {
      console.error("Invalid selection.");
      return;
    }
    const chosen = top[sel];
    const bookName: string = chosen.bookName ?? chosen.title ?? "untitled";
    const bookId: string = chosen.bookId ?? chosen.id;
    if (!bookId) {
      console.error("Selected item missing bookId.");
      return;
    }

    process.stdout.write("\nFetching chapters...\n");
    const chapters = await getDramaboxChapterList(bookId);
    if (!chapters || chapters.length === 0) {
      console.error("No chapters available.");
      return;
    }

    const totalChapters = chapters.length;
    console.log(`Found ${totalChapters} chapters for "${bookName}".`);
    const confirm =
      (await prompter.question("Download all chapters? [Y/n]: ")).trim() || "y";

    let batchMergeNumber =
      (await prompter.question(
        "Enter batch merge number (0 = no batch merge): "
      )) || 0;

    batchMergeNumber = Number(batchMergeNumber);
    if (isNaN(batchMergeNumber) || batchMergeNumber < 0) {
      console.error("Invalid batch merge number.");
      return;
    }

    let mergeAllAfterComplete: boolean = false;
    let deleteAfterMerge: boolean = false;
    if (batchMergeNumber > 0) {
      const mergeAllAfterCompletePrompt =
        (await prompter.question("Merge all after complete? [Y/n]: ")) || "n";
      mergeAllAfterComplete = mergeAllAfterCompletePrompt
        .toLowerCase()
        .startsWith("y");

      const deleteAfterMergePrompt =
        (await prompter.question("Delete after merge? [Y/n]: ")) || "n";
      deleteAfterMerge = deleteAfterMergePrompt.toLowerCase().startsWith("y");
    }

    if (!/^y(es)?$/i.test(confirm)) {
      console.log("Cancelled.");
      return;
    }

    const folderName = sanitizeFileName(bookName);
    const targetFolder = `./${folderName}`;
    if (!fs.existsSync(targetFolder)) {
      fs.mkdirSync(targetFolder);
    }

    let completed = 0;
    const currentBatch: string[] = [];
    const mergedChapters: string[] = [];
    for (const chapter of chapters) {
      if (!chapter.mp4Url) {
        process.stdout.write(
          `Chapter ${chapter.chapterIndex} has no mp4 url\n`
        );
        continue;
      }
      const indexPadded = String(chapter.chapterIndex).padStart(3, "0");
      const outPath = `${targetFolder}/${indexPadded}.mp4`;
      if (fs.existsSync(outPath)) {
        console.log(
          `[${++completed}/${chapters.length}] Skip ${indexPadded}.mp4 (exists)`
        );
        if (batchMergeNumber > 0) {
          currentBatch.push(outPath);
          if (currentBatch.length === batchMergeNumber) {
            const firstPath = currentBatch[0]!;
            const lastPath = currentBatch[currentBatch.length - 1]!;
            const firstBase = path.basename(firstPath, ".mp4");
            const lastBase = path.basename(lastPath, ".mp4");
            const mergedOut = `${targetFolder}/${firstBase}-${lastBase}.mp4`;
            if (fs.existsSync(mergedOut)) {
              console.log(
                `  Merged exists, skipping -> ${path.basename(mergedOut)}`
              );
              if (deleteAfterMerge) {
                console.log(`  Deleting -> ${currentBatch.join(", ")}`);
                await deleteFiles(currentBatch);
              }
            } else {
              console.log(`  Merging -> ${path.basename(mergedOut)}`);
              try {
                await mergeMp4FilesConcat(currentBatch, mergedOut);
                console.log(`  Merged OK -> ${path.basename(mergedOut)}`);
                if (deleteAfterMerge) {
                  console.log(`  Deleting -> ${currentBatch.join(", ")}`);
                  await deleteFiles(currentBatch);
                }
                mergedChapters.push(mergedOut);
              } catch (e: any) {
                console.error(`  Merge failed: ${e?.message ?? String(e)}`);
              }
            }
            currentBatch.length = 0;
          }
        }
        continue;
      }
      console.log(
        `[${completed + 1}/${chapters.length}] Downloading Chapter ${
          chapter.chapterIndex
        } ${chapter.qualitySelected ? `(${chapter.qualitySelected}p)` : ""}`
      );
      try {
        const tempPath = outPath + ".part";
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
        await downloadWithProgress(chapter.mp4Url, tempPath, "  Progress");
        fs.renameSync(tempPath, outPath);
        completed++;
        if (batchMergeNumber > 0) {
          currentBatch.push(outPath);
          if (currentBatch.length === batchMergeNumber) {
            const firstPath = currentBatch[0]!;
            const lastPath = currentBatch[currentBatch.length - 1]!;
            const firstBase = path.basename(firstPath, ".mp4");
            const lastBase = path.basename(lastPath, ".mp4");
            const mergedOut = `${targetFolder}/${firstBase}-${lastBase}.mp4`;
            if (fs.existsSync(mergedOut)) {
              console.log(
                `  Merged exists, skipping -> ${path.basename(mergedOut)}`
              );
              if (deleteAfterMerge) {
                console.log(`  Deleting -> ${currentBatch.join(", ")}`);
                await deleteFiles(currentBatch);
              }
            } else {
              console.log(`  Merging -> ${path.basename(mergedOut)}`);
              try {
                await mergeMp4FilesConcat(currentBatch, mergedOut);
                console.log(`  Merged OK -> ${path.basename(mergedOut)}`);
                if (deleteAfterMerge) {
                  console.log(`  Deleting -> ${currentBatch.join(", ")}`);
                  await deleteFiles(currentBatch);
                }
                mergedChapters.push(mergedOut);
              } catch (e: any) {
                console.error(`  Merge failed: ${e?.message ?? String(e)}`);
              }
            }
            currentBatch.length = 0;
          }
        }
      } catch (err: any) {
        console.error(`  Error: ${err?.message ?? String(err)}`);
      }
    }

    // Merge any remaining chapters in the last, smaller-than-batch group
    if (batchMergeNumber > 0 && currentBatch.length > 0) {
      const firstPath = currentBatch[0]!;
      const lastPath = currentBatch[currentBatch.length - 1]!;
      const firstBase = path.basename(firstPath, ".mp4");
      const lastBase = path.basename(lastPath, ".mp4");
      const mergedOut = `${targetFolder}/${firstBase}-${lastBase}.mp4`;
      if (fs.existsSync(mergedOut)) {
        console.log(`  Merged exists, skipping -> ${path.basename(mergedOut)}`);
        if (deleteAfterMerge) {
          console.log(`  Deleting -> ${currentBatch.join(", ")}`);
          await deleteFiles(currentBatch);
        }
      } else {
        console.log(`  Merging -> ${path.basename(mergedOut)}`);
        try {
          await mergeMp4FilesConcat(currentBatch, mergedOut);
          console.log(`  Merged OK -> ${path.basename(mergedOut)}`);
          if (deleteAfterMerge) {
            console.log(`  Deleting -> ${currentBatch.join(", ")}`);
            await deleteFiles(currentBatch);
          }
          mergedChapters.push(mergedOut);
        } catch (e: any) {
          console.error(`  Merge failed: ${e?.message ?? String(e)}`);
        }
      }
      currentBatch.length = 0;
    }

    console.log(
      `\nDone. Downloaded ${completed}/${chapters.length} chapters to "${targetFolder}".`
    );

    if (mergeAllAfterComplete) {
      console.log(`  Merging all chapters...`);
      try {
        const mergedOut = `${targetFolder}/all.mp4`;
        await mergeMp4FilesConcat(mergedChapters, mergedOut);
        console.log(`  Merged all chapters OK -> ${path.basename(mergedOut)}`);
      } catch (e: any) {
        console.error(
          `  Merge all chapters failed: ${e?.message ?? String(e)}`
        );
      }
    }
  } finally {
    prompter.close();
  }
}

const eksit_meseg =
  "Exiting... Some files may be corrupted and cannot be merged.";
process.on("SIGINT", () => {
  console.log(eksit_meseg);
  process.exit(0);
});
process.on("SIGTERM", () => {
  console.log(eksit_meseg);
  process.exit(0);
});
process.on("SIGQUIT", () => {
  console.log(eksit_meseg);
  process.exit(0);
});

await runInteractiveCli();
