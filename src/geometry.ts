// 核心几何：轴对齐矩形并集面积 + 按 x 扫描的条带解释。
//
// 坐标约定：
//   矩形为半开区域 [x1,x2) x [y1,y2)，要求 x1<x2 且 y1<y2。
//   坐标为整数，允许范围 ±(2^53 - 1)（JSON 安全整数）。
//   所有面积/长度用 BigInt 精确累计，以十进制字符串返回。
//
// 算法：按 x 事件分组排序，相邻事件横坐标之间形成一个条带；
// 每个条带内对活动矩形的 y 区间排序合并，得到覆盖长度。
// 复杂度：n 个矩形，O(n^2 log n) 最坏（每个条带重新合并）。

export const MAX_COORD = (1n << 53n) - 1n;
export const MIN_COORD = -MAX_COORD;

export interface Rect {
  id: string;
  x1: bigint;
  y1: bigint;
  x2: bigint;
  y2: bigint;
}

export interface MergedInterval {
  y1: string;
  y2: string;
}

export interface Band {
  x1: string;
  x2: string;
  width: string;
  activeIds: string[];
  intervals: MergedInterval[];
  coveredLength: string;
  contribution: string;
  cumulative: string;
}

export interface SweepReport {
  algorithmVersion: string;
  rectCount: number;
  eventXs: string[];
  bands: Band[];
  totalArea: string;
}

export const ALGORITHM_VERSION = "sweep-x-merge-y/v1";

// 合并 y 区间集合，返回不交叠区间与总长度。
export function mergeYIntervals(
  intervals: Array<[bigint, bigint]>
): { merged: Array<[bigint, bigint]>; length: bigint } {
  if (intervals.length === 0) return { merged: [], length: 0n };
  const sorted = [...intervals].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0
  );
  const merged: Array<[bigint, bigint]> = [];
  let curL = sorted[0][0];
  let curR = sorted[0][1];
  for (let i = 1; i < sorted.length; i++) {
    const l = sorted[i][0];
    const r = sorted[i][1];
    if (l <= curR) {
      if (r > curR) curR = r;
    } else {
      merged.push([curL, curR]);
      curL = l;
      curR = r;
    }
  }
  merged.push([curL, curR]);
  let length = 0n;
  for (const m of merged) length += m[1] - m[0];
  return { merged, length };
}

// 对矩形集合执行扫描，返回完整报告。
export function computeUnion(rects: Rect[]): SweepReport {
  const events = new Map<bigint, { starts: Rect[]; ends: Rect[] }>();
  for (const r of rects) {
    let e = events.get(r.x1);
    if (!e) events.set(r.x1, (e = { starts: [], ends: [] }));
    e.starts.push(r);
    e = events.get(r.x2);
    if (!e) events.set(r.x2, (e = { starts: [], ends: [] }));
    e.ends.push(r);
  }
  const xs = [...events.keys()].sort((a, b) => (a < b ? -1 : 1));

  const bands: Band[] = [];
  const active = new Map<string, Rect>();
  let total = 0n;

  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    // 先结算 [prevX, x) 条带，再更新活动集合。同 x 的结束与开始事件
    // 成组处理且都发生在结算之后，因此输入行序与同坐标排序不影响答案。
    if (i > 0) {
      const prevX = xs[i - 1];
      const width = x - prevX;
      if (width > 0n && active.size > 0) {
        const intervals: Array<[bigint, bigint]> = [];
        for (const r of active.values()) intervals.push([r.y1, r.y2]);
        const merged = mergeYIntervals(intervals);
        const contribution = width * merged.length;
        total += contribution;
        bands.push({
          x1: prevX.toString(),
          x2: x.toString(),
          width: width.toString(),
          activeIds: [...active.keys()].sort(),
          intervals: merged.merged.map((m) => ({
            y1: m[0].toString(),
            y2: m[1].toString(),
          })),
          coveredLength: merged.length.toString(),
          contribution: contribution.toString(),
          cumulative: total.toString(),
        });
      }
    }
    const ev = events.get(x)!;
    for (const r of ev.ends) active.delete(r.id);
    for (const r of ev.starts) active.set(r.id, r);
  }

  return {
    algorithmVersion: ALGORITHM_VERSION,
    rectCount: rects.length,
    eventXs: xs.map((x) => x.toString()),
    bands,
    totalArea: total.toString(),
  };
}

// 指定横坐标处的覆盖剖面（半开约定：x == x2 的矩形不算活动）。
export function profileAt(
  rects: Rect[],
  x: bigint
): {
  x: string;
  activeIds: string[];
  intervals: MergedInterval[];
  coveredLength: string;
} {
  const intervals: Array<[bigint, bigint]> = [];
  const ids: string[] = [];
  for (const r of rects) {
    if (r.x1 <= x && x < r.x2) {
      intervals.push([r.y1, r.y2]);
      ids.push(r.id);
    }
  }
  const merged = mergeYIntervals(intervals);
  return {
    x: x.toString(),
    activeIds: ids.sort(),
    intervals: merged.merged.map((m) => ({ y1: m[0].toString(), y2: m[1].toString() })),
    coveredLength: merged.length.toString(),
  };
}
