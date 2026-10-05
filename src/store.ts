// SQLite 持久化：不可变输入版本 + 计算报告。
// 使用 Node 内置 node:sqlite，无原生依赖。
// 版本与报告在同一事务内提交（原子）；输入失败不会写入任何数据。

import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { Rect, SweepReport } from "./geometry";

export interface VersionRow {
  id: number;
  name: string | null;
  parentId: number | null;
  algorithmVersion: string;
  rectCount: number;
  totalArea: string;
  createdAt: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        parent_id INTEGER,
        algorithm_version TEXT NOT NULL,
        rect_count INTEGER NOT NULL,
        total_area TEXT NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS rectangles (
        version_id INTEGER NOT NULL REFERENCES versions(id),
        rid TEXT NOT NULL,
        x1 TEXT NOT NULL, y1 TEXT NOT NULL,
        x2 TEXT NOT NULL, y2 TEXT NOT NULL,
        PRIMARY KEY (version_id, rid)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  /** 原子提交：版本 + 矩形 + 报告。任一失败整体回滚。 */
  createVersion(
    name: string | null,
    parentId: number | null,
    rects: Rect[],
    report: SweepReport
  ): number {
    this.db.exec("BEGIN");
    try {
      const stmt = this.db.prepare(
        `INSERT INTO versions (name, parent_id, algorithm_version, rect_count, total_area, report_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      const res = stmt.run(
        name,
        parentId,
        report.algorithmVersion,
        rects.length,
        report.totalArea,
        JSON.stringify(report)
      );
      const vid = Number(res.lastInsertRowid);
      const ins = this.db.prepare(
        `INSERT INTO rectangles (version_id, rid, x1, y1, x2, y2) VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const r of rects) {
        ins.run(vid, r.id, r.x1.toString(), r.y1.toString(), r.x2.toString(), r.y2.toString());
      }
      this.db.exec("COMMIT");
      return vid;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  getVersion(id: number): VersionRow | null {
    const row = this.db
      .prepare(
        `SELECT id, name, parent_id AS parentId, algorithm_version AS algorithmVersion,
                rect_count AS rectCount, total_area AS totalArea, created_at AS createdAt
         FROM versions WHERE id = ?`
      )
      .get(id) as unknown as VersionRow | undefined;
    return row ?? null;
  }

  listVersions(): VersionRow[] {
    return this.db
      .prepare(
        `SELECT id, name, parent_id AS parentId, algorithm_version AS algorithmVersion,
                rect_count AS rectCount, total_area AS totalArea, created_at AS createdAt
         FROM versions ORDER BY id`
      )
      .all() as unknown as VersionRow[];
  }

  getRectangles(versionId: number): Rect[] {
    const rows = this.db
      .prepare(`SELECT rid, x1, y1, x2, y2 FROM rectangles WHERE version_id = ? ORDER BY rid`)
      .all(versionId) as unknown as Array<Record<string, string>>;
    return rows.map((r) => ({
      id: r.rid,
      x1: BigInt(r.x1),
      y1: BigInt(r.y1),
      x2: BigInt(r.x2),
      y2: BigInt(r.y2),
    }));
  }

  getReport(versionId: number): SweepReport | null {
    const row = this.db
      .prepare(`SELECT report_json AS j FROM versions WHERE id = ?`)
      .get(versionId) as unknown as { j: string } | undefined;
    return row ? (JSON.parse(row.j) as SweepReport) : null;
  }
}
