export class ThreadLogger {
  private threadIds: string[];
  private savedTop = false;

  constructor(threadIds: string[]) {
    this.threadIds = threadIds;
    // Hide cursor and allocate N lines
    process.stdout.write("\x1b[?25l");
    for (let _ of threadIds) process.stdout.write("\n");
    // Move cursor back up N lines and save the top position
    process.stdout.write(`\x1b[${threadIds.length}A`);
    process.stdout.write("\x1b[s"); // save cursor position (top)
    this.savedTop = true;
  }

  info(threadId: string, message: string) {
    const row = this.threadIds.indexOf(threadId);
    if (row === -1 || !this.savedTop) return;
    const width = process.stdout.columns || 120;
    const text = `[${threadId}] ${message}`.replace(/\n/g, " ");
    const sliced = text.length > width - 1 ? text.slice(0, width - 1) : text;

    // Move to correct row and overwrite
    process.stdout.write("\x1b[u"); // restore top
    if (row > 0) process.stdout.write(`\x1b[${row}B`);
    process.stdout.write("\x1b[2K\r"); // clear line
    process.stdout.write(sliced);
    process.stdout.write("\x1b[u"); // return cursor to top
  }

  finalize() {
    if (!this.savedTop) return;
    process.stdout.write("\x1b[u");
    process.stdout.write(`\x1b[${this.threadIds.length}B`);
    process.stdout.write("\n");
    process.stdout.write("\x1b[?25h"); // show cursor again
    this.savedTop = false;
  }
}
