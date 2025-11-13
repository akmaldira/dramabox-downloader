import fs from "fs";
import { google } from "googleapis";
import path from "path";
import { question } from "./helper";

const CREDENTIALS_PATH =
  process.env.GDRIVE_CREDENTIALS_PATH ||
  path.join(process.cwd(), "credentials.json");
const TOKEN_PATH =
  process.env.GDRIVE_TOKEN_PATH || path.join(process.cwd(), "token.json");

export async function authorizeGoogleApi(throwIfNotAuthorized = false) {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const { client_secret, client_id, redirect_uris } = credentials.installed;
  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  }

  if (throwIfNotAuthorized) {
    throw new Error("Google API not authorized");
  }

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: ["https://www.googleapis.com/auth/drive.file"],
  });
  console.log("Authorize this app by visiting:", authUrl);
  const code = await question("Enter the code from that page here: ");
  const { tokens } = await oAuth2Client.getToken(code);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens));
  return oAuth2Client;
}

export async function uploadFileToDrive(
  localPath: string,
  googleDrivePath: string,
  onUpload: (received: number) => void
) {
  const oAuth2Client = await authorizeGoogleApi(true);
  const drive = google.drive({ version: "v3", auth: oAuth2Client });

  // Resolve destination folder and file name
  const { parentId, fileName } = await resolveDriveDestination(
    drive,
    localPath,
    googleDrivePath
  );

  // Start resumable session
  const stat = fs.statSync(localPath);
  const totalSize = stat.size;
  const mimeType = guessMimeType(localPath);
  const accessToken = await getAccessTokenString(oAuth2Client);

  const sessionUrl = await initiateResumableSession({
    accessToken,
    fileName,
    parentId,
    mimeType,
    totalSize,
  });

  // Upload file in chunks; call onUpload with bytes left
  await uploadFileInChunks({
    sessionUrl,
    localPath,
    totalSize,
    onProgress: (uploadedSoFar) => {
      const left = Math.max(0, totalSize - uploadedSoFar);
      onUpload(left);
    },
  });
}

async function resolveDriveDestination(
  drive: ReturnType<typeof google.drive>,
  localPath: string,
  googleDrivePath: string
) {
  const cleaned = googleDrivePath.replace(/^[\\/]+|[\\/]+$/g, "");
  const segments = cleaned.split("/").filter((s) => s.trim().length > 0);

  let fileName = path.basename(localPath);
  let folderSegments: string[] = segments;

  // If the last path segment looks like a filename (has a dot), use it as the target name
  if (
    segments.length > 0 &&
    /\.[A-Za-z0-9]+$/.test(segments[segments.length - 1]!)
  ) {
    fileName = segments[segments.length - 1]!;
    folderSegments = segments.slice(0, -1);
  }

  let parentId: string | undefined = undefined;
  for (const seg of folderSegments) {
    parentId = await getOrCreateFolder(drive, seg, parentId);
  }

  return { parentId, fileName };
}

async function getOrCreateFolder(
  drive: ReturnType<typeof google.drive>,
  name: string,
  parentId?: string
): Promise<string> {
  const qParts = [
    `mimeType = 'application/vnd.google-apps.folder'`,
    `name = '${name.replace(/'/g, "\\'")}'`,
    "trashed = false",
  ];
  if (parentId) {
    qParts.push(`'${parentId}' in parents`);
  }

  const list = await drive.files.list({
    q: qParts.join(" and "),
    fields: "files(id, name)",
    spaces: "drive",
    pageSize: 1,
  });
  const existing = list.data.files?.[0];
  if (existing?.id) return existing.id;

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    },
    fields: "id",
  });
  const id = created.data.id;
  if (!id) throw new Error("Failed to create folder on Google Drive");
  return id;
}

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp4":
      return "video/mp4";
    case ".mkv":
      return "video/x-matroska";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".avi":
      return "video/x-msvideo";
    default:
      return "application/octet-stream";
  }
}

async function getAccessTokenString(
  client: ReturnType<
    typeof google.auth.OAuth2.prototype.refreshAccessToken
  > extends never
    ? any
    : any
): Promise<string> {
  const at = await (client as any).getAccessToken();
  if (typeof at === "string") return at;
  if (
    at &&
    typeof at === "object" &&
    "token" in at &&
    typeof at.token === "string"
  ) {
    return at.token as string;
  }
  // Fallback via getRequestHeaders
  const headers = await (client as any).getRequestHeaders();
  const auth = headers?.Authorization || headers?.authorization;
  if (typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length);
  }
  throw new Error("Unable to obtain access token");
}

async function initiateResumableSession(params: {
  accessToken: string;
  fileName: string;
  parentId?: string;
  mimeType: string;
  totalSize: number;
}): Promise<string> {
  const { accessToken, fileName, parentId, mimeType, totalSize } = params;
  const meta = {
    name: fileName,
    parents: parentId ? [parentId] : undefined,
  };
  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(totalSize),
      },
      body: JSON.stringify(meta),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Failed to start resumable upload: HTTP ${res.status} ${res.statusText} ${text}`
    );
  }
  const location = res.headers.get("Location") || res.headers.get("location");
  if (!location) throw new Error("No upload session URL returned by Drive API");
  return location;
}

async function uploadFileInChunks(params: {
  sessionUrl: string;
  localPath: string;
  totalSize: number;
  onProgress: (uploaded: number) => void;
}) {
  const { sessionUrl, localPath, totalSize, onProgress } = params;
  const fd = fs.openSync(localPath, "r");
  const chunkSize = 10 * 1024 * 1024; // 10 MB
  let uploaded = 0;
  try {
    while (uploaded < totalSize) {
      const remaining = totalSize - uploaded;
      const size = Math.min(chunkSize, remaining);
      const buffer = Buffer.allocUnsafe(size);
      const bytesRead = fs.readSync(fd, buffer, 0, size, uploaded);
      if (bytesRead <= 0) break;

      const start = uploaded;
      const end = uploaded + bytesRead - 1;
      const contentRange = `bytes ${start}-${end}/${totalSize}`;

      const res = await fetch(sessionUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(bytesRead),
          "Content-Range": contentRange,
        },
        body: buffer.subarray(0, bytesRead),
      });

      if (res.status === 308) {
        // Incomplete; server accepted the range
        uploaded = end + 1;
        onProgress(uploaded);
        continue;
      }

      if (res.ok && (res.status === 200 || res.status === 201)) {
        // Completed
        uploaded = totalSize;
        onProgress(uploaded);
        break;
      }

      const text = await res.text().catch(() => "");
      throw new Error(
        `Upload failed: HTTP ${res.status} ${res.statusText} ${text}`
      );
    }
  } finally {
    try {
      fs.closeSync(fd);
    } catch {}
  }
}
