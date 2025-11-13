import readline from "readline";

export function normalizeFolderName(name: string): string {
  return name
    .trim() // remove leading/trailing spaces
    .replace(/[\/\\:*?"<>|]/g, "_") // replace illegal filesystem characters
    .replace(/\s+/g, " ") // collapse multiple spaces
    .replace(/\.+$/, "") // remove trailing dots
    .substring(0, 255); // limit length (safe for most filesystems)
}

export function fmtBytes(n: number | undefined) {
  if (!n || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let val = n;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[i]}`;
}

export function question(q: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(q, (ans) => {
      rl.close();
      resolve(ans);
    });
  });
}
