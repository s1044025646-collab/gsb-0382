// 服务层：API 与 CLI 共用。

import { computeUnion, profileAt, Rect, SweepReport } from "./geometry";
import { parseRectBatch, parseRect, ValidationError } from "./validate";
import { Store } from "./store";

export class NotFoundError extends Error {
  code = "NOT_FOUND";
}

export class Service {
  constructor(private store: Store) {}

  /** 导入集合，计算并保存为新版本。 */
  importSet(inputs: unknown[], name: string | null = null): { versionId: number; report: SweepReport } {
    const rects = parseRectBatch(inputs);
    const report = computeUnion(rects);
    const versionId = this.store.createVersion(name, null, rects, report);
    return { versionId, report };
  }

  /** 基于既有版本增删矩形，生成新版本并完整重算。 */
  deriveVersion(
    parentId: number,
    adds: unknown[],
    removes: string[],
    name: string | null = null
  ): { versionId: number; report: SweepReport } {
    const parent = this.store.getVersion(parentId);
    if (!parent) throw new NotFoundError(`版本 ${parentId} 不存在`);
    const rects = this.store.getRectangles(parentId);
    const byId = new Map<string, Rect>(rects.map((r) => [r.id, r]));
    for (const rid of removes) {
      if (!byId.has(rid)) {
        throw new ValidationError("NOT_FOUND", `矩形 ${rid} 在版本 ${parentId} 中不存在`);
      }
      byId.delete(rid);
    }
    for (let i = 0; i < adds.length; i++) {
      const r = parseRect(adds[i], i);
      if (byId.has(r.id)) {
        throw new ValidationError("DUPLICATE_ID", `编号 ${r.id} 已存在，整批拒绝`);
      }
      byId.set(r.id, r);
    }
    const next = [...byId.values()];
    const report = computeUnion(next);
    const versionId = this.store.createVersion(name, parentId, next, report);
    return { versionId, report };
  }

  getReport(versionId: number): SweepReport {
    const report = this.store.getReport(versionId);
    if (!report) throw new NotFoundError(`版本 ${versionId} 不存在`);
    return report;
  }

  listVersions() {
    return this.store.listVersions();
  }

  getBands(versionId: number, page: number, pageSize: number) {
    const report = this.getReport(versionId);
    const total = report.bands.length;
    const start = (page - 1) * pageSize;
    return {
      versionId,
      totalArea: report.totalArea,
      bandCount: total,
      page,
      pageSize,
      bands: report.bands.slice(start, start + pageSize),
    };
  }

  getProfile(versionId: number, x: bigint) {
    if (!this.store.getVersion(versionId)) throw new NotFoundError(`版本 ${versionId} 不存在`);
    return profileAt(this.store.getRectangles(versionId), x);
  }

  compare(a: number, b: number) {
    const ra = this.store.getRectangles(a);
    if (!this.store.getVersion(a)) throw new NotFoundError(`版本 ${a} 不存在`);
    if (!this.store.getVersion(b)) throw new NotFoundError(`版本 ${b} 不存在`);
    const rb = this.store.getRectangles(b);
    const mapA = new Map(ra.map((r) => [r.id, r]));
    const mapB = new Map(rb.map((r) => [r.id, r]));
    const added: string[] = [];
    const removed: string[] = [];
    const changed: string[] = [];
    for (const [id, r] of mapB) {
      const o = mapA.get(id);
      if (!o) added.push(id);
      else if (o.x1 !== r.x1 || o.y1 !== r.y1 || o.x2 !== r.x2 || o.y2 !== r.y2) changed.push(id);
    }
    for (const id of mapA.keys()) if (!mapB.has(id)) removed.push(id);
    const areaA = this.store.getVersion(a)!.totalArea;
    const areaB = this.store.getVersion(b)!.totalArea;
    return {
      a,
      b,
      areaA,
      areaB,
      areaDelta: (BigInt(areaB) - BigInt(areaA)).toString(),
      added: added.sort(),
      removed: removed.sort(),
      changed: changed.sort(),
    };
  }

  exportVersion(versionId: number) {
    const v = this.store.getVersion(versionId);
    if (!v) throw new NotFoundError(`版本 ${versionId} 不存在`);
    const rects = this.store.getRectangles(versionId);
    return {
      version: v,
      rectangles: rects.map((r) => ({
        id: r.id,
        x1: r.x1.toString(),
        y1: r.y1.toString(),
        x2: r.x2.toString(),
        y2: r.y2.toString(),
      })),
    };
  }
}
