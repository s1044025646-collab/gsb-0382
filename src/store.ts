import { DatabaseSync } from "node:sqlite";
import * as fs from "node:fs";
import * as path from "node:path";
import { ApiError, Rect, SweepReport } from "./types";
import { sweep } from "./geometry";

export interface VersionInfo {
  setId: number;
  version: number;
  algoVersion: string;
  createdAt: string;
  rectCount: number;
  totalArea: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS sets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        set_id INTEGER NOT NULL REFERENCES sets(id),
        version INTEGER NOT NULL,
        algo_version TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(set_id, version)
      );
      CREATE TABLE IF NOT EXISTS rectangles (
        version_id INTEGER NOT NULL REFERENCES versions(id),
        rect_id TEXT NOT NULL,
        x1 TEXT NOT NULL, y1 TEXT NOT NULL, x2 TEXT NOT NULL, y2 TEXT NOT NULL,
        PRIMARY KEY(version_id, rect_id)
      );
      CREATE TABLE IF NOT EXISTS reports (
        version_id INTEGER PRIMARY KEY REFERENCES versions(id),
        total_area TEXT NOT NULL,
        report_json TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  createSet(name?: string): number {
    const r = this.db.prepare("INSERT INTO sets(name) VALUES (?)").run(name ?? null);
    return Number(r.lastInsertRowid);
  }

  /** 原子提交：版本 + 不可变矩形快照 + 计算报告，同一事务完成。 */
  addVersion(setId: number, rects: Rect[]): VersionInfo {
    this.ensureSet(setId);
    const report = sweep(rects);
    const tx = this.db;
    tx.exec("BEGIN");
    try {
      const row = tx
        .prepare("SELECT COALESCE(MAX(version), 0) AS v FROM versions WHERE set_id = ?")
        .get(setId) as { v: number };
      const version = row.v + 1;
      const vr = tx
        .prepare("INSERT INTO versions(set_id, version, algo_version) VALUES (?, ?, ?)")
        .run(setId, version, report.algoVersion);
      const versionId = Number(vr.lastInsertRowid);
      const ins = tx.prepare(
        "INSERT INTO rectangles(version_id, rect_id, x1, y1, x2, y2) VALUES (?, ?, ?, ?, ?, ?)"
      );
      for (const r of rects) {
        ins.run(versionId, r.id, r.x1.toString(), r.y1.toString(), r.x2.toString(), r.y2.toString());
      }
      tx.prepare("INSERT INTO reports(version_id, total_area, report_json) VALUES (?, ?, ?)").run(
        versionId,
        report.totalArea,
        JSON.stringify(report)
      );
      tx.exec("COMMIT");
      return this.getVersionInfo(setId, version);
    } catch (e) {
      tx.exec("ROLLBACK");
      throw e;
    }
  }

  private ensureSet(setId: number): void {
    const row = this.db.prepare("SELECT id FROM sets WHERE id = ?").get(setId);
    if (!row) throw new ApiError("E_NOT_FOUND", `集合 ${setId} 不存在`, { setId });
  }

  private versionRow(
    setId: number,
    version: number
  ): { id: number; algo_version: string; created_at: string } {
    const row = this.db
      .prepare("SELECT id, algo_version, created_at FROM versions WHERE set_id = ? AND version = ?")
      .get(setId, version) as
      | { id: number; algo_version: string; created_at: string }
      | undefined;
    if (!row)
      throw new ApiError("E_NOT_FOUND", `集合 ${setId} 的版本 ${version} 不存在`, { setId, version });
    return row;
  }

  getVersionInfo(setId: number, version: number): VersionInfo {
    const v = this.versionRow(setId, version);
    const cnt = this.db
      .prepare("SELECT COUNT(*) AS c FROM rectangles WHERE version_id = ?")
      .get(v.id) as { c: number };
    const rep = this.db
      .prepare("SELECT total_area FROM reports WHERE version_id = ?")
      .get(v.id) as { total_area: string };
    return {
      setId,
      version,
      algoVersion: v.algo_version,
      createdAt: v.created_at,
      rectCount: cnt.c,
      totalArea: rep.total_area,
    };
  }

  listVersions(setId: number): VersionInfo[] {
    this.ensureSet(setId);
    const rows = this.db
      .prepare("SELECT version FROM versions WHERE set_id = ? ORDER BY version")
      .all(setId) as Array<{ version: number }>;
    return rows.map((r) => this.getVersionInfo(setId, r.version));
  }

  getRectangles(setId: number, version: number): Rect[] {
    const v = this.versionRow(setId, version);
    const rows = this.db
      .prepare("SELECT rect_id, x1, y1, x2, y2 FROM rectangles WHERE version_id = ? ORDER BY rect_id")
      .all(v.id) as Array<{ rect_id: string; x1: string; y1: string; x2: string; y2: string }>;
    return rows.map((r) => ({
      id: r.rect_id,
      x1: BigInt(r.x1),
      y1: BigInt(r.y1),
      x2: BigInt(r.x2),
      y2: BigInt(r.y2),
    }));
  }

  getReport(setId: number, version: number): SweepReport {
    const v = this.versionRow(setId, version);
    const row = this.db
      .prepare("SELECT report_json FROM reports WHERE version_id = ?")
      .get(v.id) as { report_json: string } | undefined;
    if (!row) throw new ApiError("E_NOT_FOUND", `集合 ${setId} 版本 ${version} 缺少报告`);
    return JSON.parse(row.report_json) as SweepReport;
  }

  /** 增删矩形产生新版本；删除不存在的编号报错并指出编号。 */
  mutate(setId: number, add: Rect[], removeIds: string[]): VersionInfo {
    const infos = this.listVersions(setId);
    if (infos.length === 0) throw new ApiError("E_NOT_FOUND", `集合 ${setId} 没有任何版本`);
    const current = this.getRectangles(setId, infos[infos.length - 1].version);
    const map = new Map(current.map((r) => [r.id, r]));
    for (const id of removeIds) {
      if (!map.has(id)) {
        throw new ApiError("E_NOT_FOUND", `删除失败：编号 ${id} 在当前版本中不存在`, { id });
      }
      map.delete(id);
    }
    for (const r of add) {
      if (map.has(r.id)) {
        throw new ApiError("E_DUP_ID", `新增失败：编号 ${r.id} 已存在`, { id: r.id });
      }
      map.set(r.id, r);
    }
    return this.addVersion(setId, [...map.values()]);
  }

  compare(setId: number, a: number, b: number) {
    const ra = this.getRectangles(setId, a);
    const rb = this.getRectangles(setId, b);
    const ma = new Map(ra.map((r) => [r.id, r]));
    const mb = new Map(rb.map((r) => [r.id, r]));
    const added = [...mb.keys()].filter((id) => !ma.has(id)).sort();
    const removed = [...ma.keys()].filter((id) => !mb.has(id)).sort();
    const changed = [...ma.keys()]
      .filter((id) => {
        const x = ma.get(id)!;
        const y = mb.get(id);
        return y && (x.x1 !== y.x1 || x.y1 !== y.y1 || x.x2 !== y.x2 || x.y2 !== y.y2);
      })
      .sort();
    const ia = this.getVersionInfo(setId, a);
    const ib = this.getVersionInfo(setId, b);
    return {
      setId,
      versionA: a,
      versionB: b,
      added,
      removed,
      changed,
      areaA: ia.totalArea,
      areaB: ib.totalArea,
      areaDiff: (BigInt(ib.totalArea) - BigInt(ia.totalArea)).toString(),
    };
  }
}

export function defaultDbPath(): string {
  return path.join(process.cwd(), "data", "rectunion.db");
}
