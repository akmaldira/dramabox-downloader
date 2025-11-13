export type Series = {
  id: string;
  title: string;
  unique_title: string;
  description: string;
  cover_path: string;
  source: string;
  source_id: string;
  created_at: number;
};

export type Chapter = {
  id: string;
  series_id: string;
  title: string;
  idx: number;
  description: string | null;
  cover_path: string | null;
  video_url: string;
  video_path: string | null;
  drive_url: string | null;
  error_message: string | null;
  status: string;
  created_at: number;
};

export type Task = {
  source: string;
  sourceId: string;
  idx: number;
  title: string;
  videoUrl: string;
  outputPath: string;
};

export type SlotState = {
  task?: Task;
  received: number;
  total?: number;
};

export type WorkerEventDownload = {
  action: "download";
  title: string;
  threadId: string;
  idx: number;
  received: number;
  total?: number;
};

export type WorkerEventUpload = {
  action: "upload";
  title: string;
  threadId: string;
  idx: number;
  received: number;
  total: number;
};

export type WorkerEventDone = {
  action: "done";
  title: string;
  threadId: string;
  videoUrl: string;
  driveUrl: string | null;
  outputPath: string;
  idx: number;
};

export type WorkerEventError = {
  action: "error";
  title: string;
  threadId: string;
  videoUrl: string;
  idx: number;
  message: string;
};

export type WorkerEvent =
  | WorkerEventDownload
  | WorkerEventUpload
  | WorkerEventDone
  | WorkerEventError;
