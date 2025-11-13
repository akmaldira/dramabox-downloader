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

export async function createFolderOnDrive(name: string, parentId?: string) {
  const oAuth2Client = await authorizeGoogleApi(true);
  const drive = google.drive({ version: "v3", auth: oAuth2Client });
  return await getOrCreateFolder(drive, name, parentId);
}

export async function listFilesOnDrive(
  drive: ReturnType<typeof google.drive>,
  folderId: string
) {
  const response = await drive.files.list({
    q: `'${folderId}' in parents and trashed = false`,
    fields: "files(id, name, mimeType, size, createdTime)",
    pageSize: 1000,
  });
  return response.data.files;
}

export async function uploadFolderToDrive(
  localFolderPath: string,
  parentId: string
) {
  const oAuth2Client = await authorizeGoogleApi(true);
  const drive = google.drive({ version: "v3", auth: oAuth2Client });
  const driveFiles = await listFilesOnDrive(drive, parentId);
  const localFiles = fs.readdirSync(localFolderPath);
  const newFilePaths = [] as string[];
  for (const filename of localFiles) {
    const driveFilePath = driveFiles?.find((file) => file.name == filename);
    if (!driveFilePath) {
      newFilePaths.push(path.join(localFolderPath, filename));
    }
  }

  await Promise.all(
    newFilePaths.map(async (localPath) => {
      await _uploadFileToDrive(drive, localPath, parentId);
    })
  );

  return newFilePaths;
}

export async function uploadFileToDrive(localPath: string, parentId: string) {
  const oAuth2Client = await authorizeGoogleApi(true);
  const drive = google.drive({ version: "v3", auth: oAuth2Client });
  return await _uploadFileToDrive(drive, localPath, parentId);
}

export async function _uploadFileToDrive(
  drive: ReturnType<typeof google.drive>,
  localPath: string,
  parentId: string
) {
  const fileName = path.basename(localPath);
  const mimeType = guessMimeType(localPath);
  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [parentId],
      mimeType,
    },
    media: {
      mimeType,
      body: fs.createReadStream(localPath),
    },
    fields: "id, name",
  });

  return response.data.id as string;
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
