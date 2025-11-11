import fs from 'fs';
import path from 'path';
import readline from 'readline';

const headers = {
  accept: 'application/json, text/plain, */*',
  'content-type': 'application/json; charset=UTF-8',
  origin: 'https://dramabox.drama.web.id',
  referer: 'https://dramabox.drama.web.id/',

  // These are required
  'android-id': 'ffffffff02c7834a000000000',
  apn: '1',
  brand: 'Xiaomi',
  cid: 'DAUAF1064291',
  'current-language': 'in',
  'device-id': '70b83a0e-5f70-4643-987d-fcbb61694593',
  language: 'in',
  md: 'Redmi Note 8',
  mf: 'XIAOMI',
  ov: '9',
  'over-flow': 'new-fly',
  p: '48',
  'package-name': 'com.storymatrix.drama',
  'time-zone': '+0700',

  // VERY IMPORTANT AUTH HEADERS
  sn: 'qnW6l508K/XeRoPtceSoDJ+Mhl5Z+qYOqFDrIay3H+kH45vvdXz3PV14TCufevOc+vwJkuud3sR0RAP8NpFJLWPJxPmy+HvDfyZFaftQG5k+/iqA9qaETucPLID948lgIShMfiSoWhXYD8NBQQ/vAN5zesVSUR0KkKPKDq/q0/EMSBMyaEQFr/qa3FXsSUdGV+fGEAu2JxnU2eFMBuF+UinHrFRaD+2BSQxJVUlRoM5pWbdmKx0iY8BxxDmc7MI5B6LBI4gDCRiCwjrNp791uNeFic6aeN4Hxr51I0LloRMn6Ce1PRY6nG3UnslqYrpUlolbh/zyIIu2k4E+uA5yxw==',
  tn: 'Bearer ZXlKMGVYQWlPaUpLVjFRaUxDSmhiR2NpT2lKSVV6STFOaUo5LmV5SnlaV2RwYzNSbGNsUjVjR1VpT2lKVVJVMVFJaXdpZFhObGNrbGtJam96TXpNM016RTFPREI5LkZiTlhjcUgyaFg1dTZ4VkFEdEF1RlVpVVZRV0NxMzJENkZoLVlSQTZWNjg=',
  'user-id': '333731580',
  version: '470',
  vn: '4.7.0',

  // Browser headers
  'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-site': 'cross-site',
  'sec-fetch-mode': 'cors',
};

class DramaboxAPI {
  private headers: Record<string, string> = headers;
  private timestamp: number = Date.now();

  async getSignature(payload: any) {
    this.timestamp = Date.now();
    const deviceId = this.headers['device-id'];
    const androidId = this.headers['android-id'];
    const tn = this.headers['tn'];
    const strPayload = `timestamp=${this.timestamp}${JSON.stringify(payload)}${deviceId}${androidId}${tn}`;
    const signReqBody = { str: strPayload };

    const res = await fetch(`https://dramabox-api.d5studio.site/sign`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: '*/*',
        Origin: 'https://dramabox.drama.web.id',
      },
      body: JSON.stringify(signReqBody),
    });

    if (!res.ok) throw new Error(`sign request failed: ${res.status}`);
    const json = (await res.json()) as any;
    if (!json.success) throw new Error('sign endpoint returned success=false');
    return json.signature;
  }

  async search(keyword: string, pageNo: number = 1, pageSize: number = 20) {
    const payload = {
      searchSource: '搜索按钮',
      pageNo: pageNo,
      pageSize: pageSize,
      from: 'search_sug',
      keyword,
    };
    const signature = await this.getSignature(payload);
    const res = await fetch(`https://dramabox-api.d5studio.site/proxy.php/drama-box/search/search?timestamp=${this.timestamp}`, {
      method: 'POST',
      headers: { ...this.headers, sn: signature },
      body: JSON.stringify(payload),
    });
    return res.json();
  }

  async getDetail(id: string) {
    const res = await fetch(`https://www.webfic.com/webfic/book/detail/v2?id=${id}&timestamp=${this.timestamp}&language=in`, {
      method: 'GET',
      headers: { ...this.headers },
    });
    return res.json() as Promise<any>;
  }

  async batchUnlockEpisode(bookId: string, chapterIdList: string[]) {
    const payload = {
      bookId: bookId,
      chapterIdList: chapterIdList,
    };

    this.timestamp = Date.now();
    const signature = await this.getSignature(payload);
    const res = await fetch(`https://dramabox-api.d5studio.site/proxy.php/drama-box/chapterv2/batchDownload?timestamp=${this.timestamp}`, {
      method: 'POST',
      headers: { ...this.headers, sn: signature },
      body: JSON.stringify(payload),
    });
    return res.json();
  }
}

async function getDramaboxChapterList(bookId: string, quality: number | null = null) {
  const dramabox = new DramaboxAPI();
  const detail = await dramabox.getDetail(bookId);

  const chapters = detail.data.chapterList.map((chapter: any) => chapter.id);
  const unlocked = await dramabox.batchUnlockEpisode(bookId, chapters);

  const sortedChapters = (unlocked as any).data.chapterVoList.sort((a: any, b: any) => a.chapterIndex - b.chapterIndex);

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
        const correctQuality = videoPathList.find((path: any) => path.quality === quality);
        if (correctQuality) {
          mp4Url = correctQuality.videoPath;
          qualitySelected = correctQuality.quality;
          break;
        }
      }
    } else {
      for (const cdn of chapter.cdnList) {
        mp4Url = cdn.videoPathList[0].videoPath;
        qualitySelected = cdn.videoPathList[0].quality;
        break;
      }
      if (!mp4Url) {
        console.warn(`Chapter ${chapter.chapterIndex} has no mp4 url`);
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

function createPrompter() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const question = (q: string) => new Promise<string>((resolve) => rl.question(q, (ans) => resolve(ans)));
  const close = () => rl.close();
  return { question, close };
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
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
  const bar = '[' + '#'.repeat(filled) + '-'.repeat(Math.max(0, width - filled)) + ']';
  const percent = total && total > 0 ? ` ${(ratio * 100).toFixed(0)}%` : '';
  const sizeInfo = total && total > 0 ? ` ${formatBytes(received)} / ${formatBytes(total)}` : ` ${formatBytes(received)}`;
  return `${prefix} ${bar}${percent}${sizeInfo}`;
}

async function downloadWithProgress(url: string, outPath: string, label: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download (${res.status})`);
  }
  const total = Number(res.headers.get('content-length') ?? 0) || undefined;
  const reader = res.body.getReader();
  const fd = fs.openSync(outPath, 'w');
  let received = 0;

  try {
    process.stdout.write(renderProgress(label, received, total));
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        received += value.byteLength;
        fs.writeSync(fd, value);
        process.stdout.write('\r' + renderProgress(label, received, total));
      }
    }
    process.stdout.write('\r' + renderProgress(label, received, total) + '\n');
  } finally {
    fs.closeSync(fd);
  }
}

function sanitizeFileName(name: string): string {
  const baseFolder = './downloads';
  if (!fs.existsSync(baseFolder)) {
    fs.mkdirSync(baseFolder);
  }
  const sanitized = name.replace(/[\\/:*?"<>|]+/g, '_').trim();
  const sanitizedPath = path.join(baseFolder, sanitized);
  return sanitizedPath;
}

async function mergeMp4FilesConcat(filePaths: string[], outputPath: string) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new Error('No input files provided for merge.');
  }
  const tempListPath = `${outputPath}.list.txt`;
  const toListLine = (p: string) => {
    const abs = path.resolve(p);
    const escaped = abs.replace(/'/g, "'\\''");
    return `file '${escaped}'`;
  };
  fs.writeFileSync(tempListPath, filePaths.map(toListLine).join('\n'));
  try {
    const fastArgs = ['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', tempListPath, '-fflags', '+discardcorrupt', '-c', 'copy', outputPath];
    const fastProc = Bun.spawn(fastArgs, {
      stdout: 'inherit',
      stderr: 'inherit',
    });
    const fastCode = await fastProc.exited;
    if (fastCode !== 0) {
      console.warn('Fast concat failed; retrying with re-encode to normalize streams...');
      const encodeArgs = [
        'ffmpeg',
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        tempListPath,
        '-map',
        '0:v:0?',
        '-map',
        '0:a:0?',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outputPath,
      ];
      const encProc = Bun.spawn(encodeArgs, {
        stdout: 'inherit',
        stderr: 'inherit',
      });
      const encCode = await encProc.exited;
      if (encCode !== 0) {
        throw new Error(`ffmpeg re-encode concat failed with code ${encCode}`);
      }
    }
  } finally {
    try {
      fs.unlinkSync(tempListPath);
    } catch {}
  }
}

async function downloadSeries(bookId: string, bookName: string, batchMergeNumber: number = 0, mergeAllAfterComplete: boolean = false) {
  const folderName = sanitizeFileName(bookName);
  const targetFolder = `./${folderName}`;
  if (!fs.existsSync(targetFolder)) {
    fs.mkdirSync(targetFolder, { recursive: true });
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📺 Downloading: ${bookName}`);
  console.log(`${'='.repeat(60)}`);

  const chapters = await getDramaboxChapterList(bookId);
  if (!chapters || chapters.length === 0) {
    console.error('❌ No chapters available.');
    return false;
  }

  console.log(`✅ Found ${chapters.length} chapters`);

  let completed = 0;
  const currentBatch: string[] = [];
  const mergedChapters: string[] = [];

  for (const chapter of chapters) {
    const indexPadded = String(chapter.chapterIndex).padStart(3, '0');
    const outPath = `${targetFolder}/${indexPadded}.mp4`;

    if (fs.existsSync(outPath)) {
      console.log(`[${++completed}/${chapters.length}] ⏭️  Skip ${indexPadded}.mp4 (exists)`);
      if (batchMergeNumber > 0) {
        currentBatch.push(outPath);
        if (currentBatch.length === batchMergeNumber) {
          const firstPath = currentBatch[0]!;
          const lastPath = currentBatch[currentBatch.length - 1]!;
          const firstBase = path.basename(firstPath, '.mp4');
          const lastBase = path.basename(lastPath, '.mp4');
          const mergedOut = `${targetFolder}/${firstBase}-${lastBase}.mp4`;
          if (!fs.existsSync(mergedOut)) {
            console.log(`  🔗 Merging -> ${path.basename(mergedOut)}`);
            try {
              await mergeMp4FilesConcat(currentBatch, mergedOut);
              console.log(`  ✅ Merged OK -> ${path.basename(mergedOut)}`);
              mergedChapters.push(mergedOut);
            } catch (e: any) {
              console.error(`  ❌ Merge failed: ${e?.message ?? String(e)}`);
            }
          }
          currentBatch.length = 0;
        }
      }
      continue;
    }

    console.log(`[${completed + 1}/${chapters.length}] ⬇️  Downloading Chapter ${chapter.chapterIndex} ${chapter.qualitySelected ? `(${chapter.qualitySelected}p)` : ''}`);

    try {
      const tempPath = outPath + '.part';
      if (fs.existsSync(tempPath)) {
        fs.unlinkSync(tempPath);
      }
      await downloadWithProgress(chapter.mp4Url, tempPath, '  Progress');
      fs.renameSync(tempPath, outPath);
      completed++;

      if (batchMergeNumber > 0) {
        currentBatch.push(outPath);
        if (currentBatch.length === batchMergeNumber) {
          const firstPath = currentBatch[0]!;
          const lastPath = currentBatch[currentBatch.length - 1]!;
          const firstBase = path.basename(firstPath, '.mp4');
          const lastBase = path.basename(lastPath, '.mp4');
          const mergedOut = `${targetFolder}/${firstBase}-${lastBase}.mp4`;
          if (!fs.existsSync(mergedOut)) {
            console.log(`  🔗 Merging -> ${path.basename(mergedOut)}`);
            try {
              await mergeMp4FilesConcat(currentBatch, mergedOut);
              console.log(`  ✅ Merged OK -> ${path.basename(mergedOut)}`);
              mergedChapters.push(mergedOut);
            } catch (e: any) {
              console.error(`  ❌ Merge failed: ${e?.message ?? String(e)}`);
            }
          }
          currentBatch.length = 0;
        }
      }
    } catch (err: any) {
      console.error(`  ❌ Error: ${err?.message ?? String(err)}`);
    }
  }

  console.log(`\n✅ Done. Downloaded ${completed}/${chapters.length} chapters to "${targetFolder}".`);

  if (mergeAllAfterComplete && mergedChapters.length > 0) {
    console.log(`  🔗 Merging all chapters...`);
    try {
      const mergedOut = `${targetFolder}/all.mp4`;
      await mergeMp4FilesConcat(mergedChapters, mergedOut);
      console.log(`  ✅ Merged all chapters OK -> ${path.basename(mergedOut)}`);
    } catch (e: any) {
      console.error(`  ❌ Merge all chapters failed: ${e?.message ?? String(e)}`);
    }
  }

  return true;
}

// ============ NEW AUTOMATED FUNCTIONS ============

async function getAllSeriesByAlphabet(api: DramaboxAPI, letters: string[], maxResultsPerLetter: number = 100) {
  const allSeries: Array<{ bookId: string; bookName: string; letter: string }> = [];
  const processedIds = new Set<string>();

  for (const letter of letters) {
    console.log(`\n🔍 Searching for series starting with "${letter}"...`);

    try {
      // Search with the letter as keyword
      const pageSize = 20;
      let pageNo = 1;
      let foundInPage = 0;

      while (foundInPage < maxResultsPerLetter) {
        const result = (await api.search(letter, pageNo, pageSize)) as any;
        const list = (result?.data?.searchList ?? []) as any[];

        if (!Array.isArray(list) || list.length === 0) {
          break;
        }

        for (const item of list) {
          const bookId = item.bookId ?? item.id;
          const bookName: string = item.bookName ?? item.title ?? 'untitled';

          if (!bookId || processedIds.has(bookId)) {
            continue;
          }

          // Filter: only include if book name starts with the letter
          const firstChar = bookName.trim()[0]?.toUpperCase();
          if (firstChar === letter.toUpperCase()) {
            processedIds.add(bookId);
            allSeries.push({ bookId, bookName, letter });
            foundInPage++;
            console.log(`  ✅ Found: ${bookName}`);
          }
        }

        pageNo++;

        // Stop if no more results
        if (list.length < pageSize) {
          break;
        }
      }

      console.log(`✅ Found ${foundInPage} series for letter "${letter}"`);

      // Small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error: any) {
      console.error(`❌ Error searching letter "${letter}": ${error?.message ?? String(error)}`);
    }
  }

  return allSeries;
}

async function runAutomatedDownload() {
  const prompter = createPrompter();

  try {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║        DRAMABOX AUTOMATED DOWNLOADER BY ALPHABET          ║
╚═══════════════════════════════════════════════════════════╝
`);

    // Get letter range
    const rangeInput = (await prompter.question("Enter letter range (e.g., 'A-Z', 'A-C', 'M', or 'A,C,F'): ")).trim().toUpperCase();

    let letters: string[] = [];

    if (rangeInput.includes('-')) {
      // Range like A-Z or A-F
      const [start, end] = rangeInput.split('-');
      const startCode = start.charCodeAt(0);
      const endCode = end.charCodeAt(0);
      for (let i = startCode; i <= endCode; i++) {
        letters.push(String.fromCharCode(i));
      }
    } else if (rangeInput.includes(',')) {
      // Multiple letters like A,C,F
      letters = rangeInput
        .split(',')
        .map((l) => l.trim())
        .filter((l) => l.length === 1);
    } else if (rangeInput.length === 1) {
      // Single letter
      letters = [rangeInput];
    } else {
      console.error("❌ Invalid format. Use 'A-Z', 'A-C', 'M', or 'A,C,F'");
      return;
    }

    console.log(`\n📝 Will search for: ${letters.join(', ')}`);

    const maxPerLetter = Number((await prompter.question('Max results per letter [20]: ')).trim() || '20');

    const batchMergeInput = (await prompter.question('Batch merge number (0 = no batch merge) [0]: ')).trim() || '0';
    const batchMergeNumber = Number(batchMergeInput);

    let mergeAllAfterComplete = false;
    if (batchMergeNumber > 0) {
      const mergeAllPrompt = (await prompter.question('Merge all after complete? [Y/n]: ')).trim() || 'n';
      mergeAllAfterComplete = mergeAllPrompt.toLowerCase().startsWith('y');
    }

    const delayBetweenSeries = Number((await prompter.question('Delay between series downloads (seconds) [5]: ')).trim() || '5');

    const confirm = (await prompter.question(`\n⚠️  This will search and download ALL series starting with ${letters.join(', ')}.\nContinue? [y/N]: `)).trim().toLowerCase();

    if (confirm !== 'y' && confirm !== 'yes') {
      console.log('❌ Cancelled.');
      return;
    }

    // Start automated process
    const api = new DramaboxAPI();

    console.log('\n' + '='.repeat(60));
    console.log('🤖 STARTING AUTOMATED DOWNLOAD');
    console.log('='.repeat(60));

    const allSeries = await getAllSeriesByAlphabet(api, letters, maxPerLetter);

    if (allSeries.length === 0) {
      console.log('\n❌ No series found.');
      return;
    }

    console.log(`\n📊 Total series found: ${allSeries.length}`);
    console.log('='.repeat(60));

    // Create download log
    const logFile = `./download-log-${Date.now()}.txt`;
    fs.writeFileSync(logFile, `Automated Download Log\nStarted: ${new Date().toISOString()}\n\n`);

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < allSeries.length; i++) {
      const series = allSeries[i];
      console.log(`\n[${i + 1}/${allSeries.length}] Processing: ${series.bookName}`);

      try {
        const success = await downloadSeries(series.bookId, series.bookName, batchMergeNumber, mergeAllAfterComplete);

        if (success) {
          successCount++;
          fs.appendFileSync(logFile, `✅ [${new Date().toISOString()}] ${series.bookName}\n`);
        } else {
          failCount++;
          fs.appendFileSync(logFile, `❌ [${new Date().toISOString()}] ${series.bookName} - No chapters\n`);
        }

        // Delay between downloads
        if (i < allSeries.length - 1 && delayBetweenSeries > 0) {
          console.log(`⏳ Waiting ${delayBetweenSeries} seconds before next download...`);
          await new Promise((resolve) => setTimeout(resolve, delayBetweenSeries * 1000));
        }
      } catch (error: any) {
        failCount++;
        console.error(`❌ Failed to download ${series.bookName}: ${error?.message ?? String(error)}`);
        fs.appendFileSync(logFile, `❌ [${new Date().toISOString()}] ${series.bookName} - Error: ${error?.message}\n`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('🎉 AUTOMATED DOWNLOAD COMPLETE');
    console.log('='.repeat(60));
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log(`📝 Log file: ${logFile}`);
    console.log('='.repeat(60));

    fs.appendFileSync(logFile, `\nCompleted: ${new Date().toISOString()}\nSuccess: ${successCount}, Failed: ${failCount}\n`);
  } finally {
    prompter.close();
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
    const keyword = (await prompter.question('Enter search keyword: ')).trim() || '';
    if (!keyword) {
      console.error('Keyword is required.');
      return;
    }

    const api = new DramaboxAPI();
    process.stdout.write('Searching...\n');
    const result = (await api.search(keyword)) as any;
    const list = (result?.data?.searchList ?? []) as any[];
    if (!Array.isArray(list) || list.length === 0) {
      console.error('No results found.');
      return;
    }

    const top = list.slice(0, 10);
    console.log('\nSelect a title:');
    top.forEach((item, idx) => {
      const title = item.bookName ?? item.title ?? `Result ${idx + 1}`;
      const author = item.authorName ? ` — ${item.authorName}` : '';
      console.log(`  [${idx}] ${title}${author}`);
    });
    const selAns = (await prompter.question('\nEnter index [0]: ')).trim();
    const sel = selAns === '' ? 0 : Math.max(0, Math.min(top.length - 1, Number(selAns)));
    if (!Number.isFinite(sel)) {
      console.error('Invalid selection.');
      return;
    }
    const chosen = top[sel];
    const bookName: string = chosen.bookName ?? chosen.title ?? 'untitled';
    const bookId: string = chosen.bookId ?? chosen.id;
    if (!bookId) {
      console.error('Selected item missing bookId.');
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

    if (isNaN(batchMergeNumber) || batchMergeNumber < 0) {
      console.error('Invalid batch merge number.');
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

    const confirm = (await prompter.question('Download all chapters? [Y/n]: ')).trim() || 'y';

    if (!/^y(es)?$/i.test(confirm)) {
      console.log('Cancelled.');
      return;
    }

    await downloadSeries(bookId, bookName, batchMergeNumber, mergeAllAfterComplete);
  } finally {
    prompter.close();
  }
}

    let completed = 0;
    const currentBatch: string[] = [];
    const mergedChapters: string[] = [];
    for (const chapter of chapters) {
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

  try {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║           DRAMABOX DOWNLOADER - ENHANCED VERSION          ║
╚═══════════════════════════════════════════════════════════╝

Select mode:
  [1] Manual mode (search and select single series)
  [2] Automated mode (download by alphabet range)
  [0] Exit
`);

    const choice = (await prompter.question('Enter choice [1]: ')).trim() || '1';

    prompter.close();

    if (choice === '1') {
      await runInteractiveCli();
    } else if (choice === '2') {
      await runAutomatedDownload();
    } else if (choice === '0') {
      console.log('👋 Goodbye!');
      process.exit(0);
    } else {
      console.error('❌ Invalid choice.');
    }
  } catch (error: any) {
    console.error(`❌ Error: ${error?.message ?? String(error)}`);
    prompter.close();
  }
}

const eksit_meseg = '\n⚠️  Exiting... Some files may be corrupted and cannot be merged.';
process.on('SIGINT', () => {
  console.log(eksit_meseg);
  process.exit(0);
});
process.on('SIGTERM', () => {
  console.log(eksit_meseg);
  process.exit(0);
});
process.on('SIGQUIT', () => {
  console.log(eksit_meseg);
  process.exit(0);
});

await mainMenu();
