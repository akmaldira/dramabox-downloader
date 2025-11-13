import { Database } from "bun:sqlite";
import path from "path";
import type { Chapter, Series } from "./types";

const DB_PATH =
  process.env.DB_PATH || path.join(process.cwd(), "dracin.sqlite");

export class SeriesModel {
  id: string;
  title: string;
  unique_title: string;
  description: string;
  cover_path: string;
  source: string;
  source_id: string;
  created_at: number;

  constructor(data: Series) {
    this.id = data.id;
    this.title = data.title;
    this.unique_title = data.unique_title;
    this.description = data.description;
    this.cover_path = data.cover_path;
    this.source = data.source;
    this.source_id = data.source_id;
    this.created_at = data.created_at;
  }

  toJSON() {
    return {
      id: this.id,
      title: this.title,
      unique_title: this.unique_title,
      description: this.description,
      cover_path: this.cover_path,
      source: this.source,
      source_id: this.source_id,
      created_at: this.created_at,
    };
  }
}

export class ChapterModel {
  id: string;
  series_id: string;
  title: string;
  idx: number;
  description: string | null;
  cover_path: string | null;
  video_url: string;
  video_path: string | null;
  drive_url: string | null;
  status: string;
  error_message: string | null;
  created_at: number;

  constructor(data: Chapter) {
    this.id = data.id;
    this.series_id = data.series_id;
    this.title = data.title;
    this.idx = data.idx;
    this.description = data.description;
    this.cover_path = data.cover_path;
    this.video_url = data.video_url;
    this.video_path = data.video_path;
    this.drive_url = data.drive_url;
    this.status = data.status;
    this.error_message = data.error_message;
    this.created_at = data.created_at;
  }

  toJSON() {
    return {
      id: this.id,
      series_id: this.series_id,
      title: this.title,
      idx: this.idx,
      description: this.description,
      cover_path: this.cover_path,
      video_url: this.video_url,
      video_path: this.video_path,
      drive_url: this.drive_url,
      status: this.status,
      error_message: this.error_message,
      created_at: this.created_at,
    };
  }
}

const db = new Database(DB_PATH, { create: true });

export async function initDb() {
  db.query(
    `CREATE TABLE IF NOT EXISTS series (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  unique_title TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  cover_path TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_series_source_source_id ON series (source, source_id);`
  ).run();
  db.query(
    `CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  series_id TEXT NOT NULL,
  title TEXT NOT NULL,
  idx INTEGER NOT NULL,
  description TEXT,
  cover_path TEXT,
  video_url TEXT NOT NULL,
  video_path TEXT,
  drive_url TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE(series_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_chapters_series_id_idx ON chapters (series_id, idx);`
  ).run();
}

class SeriesDb {
  getAll() {
    const getQuery = db
      .query(
        `SELECT id, title, unique_title, description, cover_path, source, source_id, created_at FROM series`
      )
      .as(SeriesModel);
    return getQuery.all();
  }

  getUnique(source: string, source_id: string) {
    const getQuery = db
      .query(
        `SELECT id, title, unique_title, description, cover_path, source, source_id, created_at FROM series WHERE source = $source AND source_id = $source_id`
      )
      .as(SeriesModel);

    return getQuery.get({ $source: source, $source_id: source_id });
  }

  upsert(series: Omit<Series, "created_at">) {
    const existingSeries = this.getUnique(series.source, series.source_id);
    if (existingSeries) {
      return existingSeries;
    }

    const insertQuery = db.query(`
    INSERT INTO series (id, title, unique_title, description, cover_path, source, source_id, created_at)
    VALUES ($id, $title, $unique_title, $description, $cover_path, $source, $source_id, $created_at)
  `);
    insertQuery.run({
      $id: series.id,
      $title: series.title,
      $unique_title: series.unique_title,
      $description: series.description,
      $cover_path: series.cover_path,
      $source: series.source,
      $source_id: series.source_id,
      $created_at: Math.floor(Date.now() / 1000),
    });

    return series;
  }

  insertMany(seriesList: Omit<Series, "created_at">[]) {
    const insertQuery =
      db.prepare(`INSERT INTO series (id, title, unique_title, description, cover_path, source, source_id, created_at)
    VALUES ($id, $title, $unique_title, $description, $cover_path, $source, $source_id, $created_at)`);
    const insertRun = db.transaction(
      (seriesList: Omit<Series, "created_at">[]) => {
        for (const series of seriesList) {
          insertQuery.run({
            $id: series.id,
            $title: series.title,
            $unique_title: series.unique_title,
            $description: series.description,
            $cover_path: series.cover_path,
            $source: series.source,
            $source_id: series.source_id,
            $created_at: Math.floor(Date.now() / 1000),
          });
        }
        return seriesList.length;
      }
    );

    const total = insertRun(seriesList);
    return total;
  }
}
export const seriesDb = new SeriesDb();

class ChapterDb {
  getAll() {
    const getQuery = db
      .query(
        `SELECT id, series_id, title, idx, description, cover_path, video_url, video_path, drive_url, status, error_message, created_at FROM chapters`
      )
      .as(ChapterModel);
    return getQuery.all();
  }

  getUnique(series_id: string, idx: number) {
    const getQuery = db
      .query(
        `SELECT id, series_id, title, idx, description, cover_path, video_url, video_path, drive_url, status, error_message, created_at FROM chapters WHERE series_id = $series_id AND idx = $idx`
      )
      .as(ChapterModel);

    return getQuery.get({ $series_id: series_id, $idx: idx });
  }

  upsert(chapter: Chapter) {
    const existingChapter = this.getUnique(chapter.series_id, chapter.idx);
    if (existingChapter) {
      return existingChapter;
    }

    const insertQuery = db.query(`
    INSERT INTO chapters (id, series_id, title, idx, description, cover_path, video_url, video_path, drive_url, status, error_message, created_at)
    VALUES ($id, $series_id, $title, $idx, $description, $cover_path, $video_url, $video_path, $drive_url, $status, $error_message, $created_at)
  `);
    insertQuery.run({
      $id: chapter.id,
      $series_id: chapter.series_id,
      $title: chapter.title,
      $idx: chapter.idx,
      $description: chapter.description,
      $cover_path: chapter.cover_path,
      $video_url: chapter.video_url,
      $video_path: chapter.video_path,
      $drive_url: chapter.drive_url,
      $status: chapter.status,
      $error_message: chapter.error_message,
      $created_at: Math.floor(Date.now() / 1000),
    });

    return chapter;
  }
}
export const chapterDb = new ChapterDb();
