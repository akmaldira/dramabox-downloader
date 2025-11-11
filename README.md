# dramabox

To install dependencies:

```bash
bun install
```

### Prerequisite: ffmpeg

Install ffmpeg on your machine:

- macOS (Homebrew):

```bash
brew install ffmpeg
```

- Ubuntu/Debian:

```bash
sudo apt update && sudo apt install -y ffmpeg
```

- Windows (Winget):

```powershell
winget install Gyan.FFmpeg
```

- Windows (Chocolatey):

```powershell
choco install ffmpeg
```

Alternatively, download installers from `https://ffmpeg.org/download.html`.

To run:

```bash
bun run index.ts
```

This project was created using `bun init` in bun v1.2.17. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
