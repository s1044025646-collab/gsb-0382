import { MergedInterval, Profile, Rect, Strip, SweepReport } from "./types";

export const ALGO_VERSION = "sweep-x/merge-y-v1";

/** 合并一组 [y1,y2) 区间，返回不交叠区间与总覆盖长度。 */
export function mergeIntervals(
  intervals: Array<[bigint, bigint]>
): { merged: Array<[bigint, bigint]>; length: bigint } {
  const sorted = [...intervals].sort((a, b) =>
    a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1
  );
  const merged: Array<[bigint, bigint]> = [];
  let length = 0n;
  for (const [lo, hi] of sorted) {
    const last = merged[merged.length - 1];
    if (last && lo <= last[1]) {
      if (hi > last[1]) {
        length += hi - last[1];
        last[1] = hi;
      }
    } else {
      merged.push([lo, hi]);
      length += hi - lo;
    }
  }
  return { merged, length };
}

function toMerged(list: Array<[bigint, bigint]>): MergedInterval[] {
  return list.map(([a, b]) => ({ y1: a.toString(), y2: b.toString() }));
}

/**
 * 扫描线核心：按 x 事件分组，先结算 [prevX, x) 条带，再更新活动集合。
 * 结束事件（x2）与开始事件（x1）同坐标时同组处理：先结算旧条带，
 * 然后同时移除结束者、加入开始者，因此行序与同坐标排序不影响结果。
 */
export function sweep(rects: Rect[]): SweepReport {
  const eventXSet = new Set<string>();
  for (const r of rects) {
    eventXSet.add(r.x1.toString());
    eventXSet.add(r.x2.toString());
  }
  const eventXs = [...eventXSet].map(BigInt).sort((a, b) => (a < b ? -1 : 1));

  const active = new Map<string, Rect>();
  const strips: Strip[] = [];
  let cumulative = 0n;
  let prevX: bigint | null = null;

  for (const x of eventXs) {
    if (prevX !== null && x > prevX && active.size > 0) {
      const width = x - prevX;
      const intervals = [...active.values()].map((r) => [r.y1, r.y2] as [bigint, bigint]);
      const { merged, length } = mergeIntervals(intervals);
      const contribution = width * length;
      cumulative += contribution;
      strips.push({
        index: strips.length,
        x1: prevX.toString(),
        x2: x.toString(),
        width: width.toString(),
        activeIds: [...active.keys()].sort(),
        intervals: toMerged(merged),
        coveredLength: length.toString(),
        contribution: contribution.toString(),
        cumulative: cumulative.toString(),
      });
    }
    // 同坐标事件成组：先移除 x2 == x 的，再加入 x1 == x 的。
    for (const r of rects) if (r.x2 === x) active.delete(r.id);
    for (const r of rects) if (r.x1 === x) active.set(r.id, r);
    prevX = x;
  }

  return {
    algoVersion: ALGO_VERSION,
    totalArea: cumulative.toString(),
    eventXs: eventXs.map((x) => x.toString()),
    strips,
  };
}

/** 指定横坐标 x 的覆盖剖面：矩形满足 x1 <= x < x2 才算活动（右边界半开）。 */
export function profileAt(rects: Rect[], x: bigint): Profile {
  const act = rects.filter((r) => r.x1 <= x && x < r.x2);
  const { merged, length } = mergeIntervals(act.map((r) => [r.y1, r.y2]));
  return {
    x: x.toString(),
    activeIds: act.map((r) => r.id).sort(),
    intervals: toMerged(merged),
    coveredLength: length.toString(),
  };
}
