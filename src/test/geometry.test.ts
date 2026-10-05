import { test } from "node:test";
import assert from "node:assert/strict";
import { computeUnion, profileAt, Rect } from "../geometry";
import { parseRectBatch, ValidationError } from "../validate";

function R(id: string, x1: number, y1: number, x2: number, y2: number): Rect {
  return { id, x1: BigInt(x1), y1: BigInt(y1), x2: BigInt(x2), y2: BigInt(y2) };
}

// 独立单位格集合核对（仅用于小整数坐标）。
function gridArea(rects: Rect[]): bigint {
  const cells = new Set<string>();
  for (const r of rects) {
    for (let x = Number(r.x1); x < Number(r.x2); x++) {
      for (let y = Number(r.y1); y < Number(r.y2); y++) {
        cells.add(`${x},${y}`);
      }
    }
  }
  return BigInt(cells.size);
}

test("空集合面积为零且无条带", () => {
  const r = computeUnion([]);
  assert.equal(r.totalArea, "0");
  assert.deepEqual(r.bands, []);
});

test("演示用例：并集为 11", () => {
  const r = computeUnion([R("A", 0, 0, 3, 2), R("B", 2, 1, 5, 3)]);
  assert.equal(r.totalArea, "11");
  assert.deepEqual(r.eventXs, ["0", "2", "3", "5"]);
  assert.equal(r.bands.length, 3);
  // 逐条带贡献之和等于报告总面积
  const sum = r.bands.reduce((a, b) => a + BigInt(b.contribution), 0n);
  assert.equal(sum.toString(), r.totalArea);
  assert.equal(r.bands[r.bands.length - 1].cumulative, r.totalArea);
});

test("加入完全被覆盖的小矩形答案不变", () => {
  const r = computeUnion([R("A", 0, 0, 3, 2), R("B", 2, 1, 5, 3), R("C", 1, 0, 2, 1)]);
  assert.equal(r.totalArea, "11");
});

test("分离矩形面积相加", () => {
  const r = computeUnion([R("A", 0, 0, 1, 1), R("B", 5, 5, 7, 8)]);
  assert.equal(r.totalArea, "7");
});

test("包含关系只算一次", () => {
  const r = computeUnion([R("A", 0, 0, 10, 10), R("B", 2, 2, 5, 5)]);
  assert.equal(r.totalArea, "100");
});

test("完全重复（相同坐标不同编号）只算一次", () => {
  const r = computeUnion([R("A", 0, 0, 4, 4), R("B", 0, 0, 4, 4)]);
  assert.equal(r.totalArea, "16");
  assert.equal(r.bands[0].activeIds.length, 2);
});

test("仅边角相触不产生额外面积", () => {
  const r = computeUnion([R("A", 0, 0, 2, 2), R("B", 2, 2, 4, 4)]);
  assert.equal(r.totalArea, "8");
});

test("负坐标", () => {
  const rects = [R("A", -5, -5, -1, -1), R("B", -3, -3, 2, 2)];
  const r = computeUnion(rects);
  assert.equal(r.totalArea, gridArea(rects).toString());
  assert.equal(r.totalArea, "37");
});

test("超过安全整数的面积用 BigInt 精确累计", () => {
  const big = 1n << 52n;
  const rects: Rect[] = [
    { id: "A", x1: 0n, y1: 0n, x2: big, y2: big },
    { id: "B", x1: big, y1: 0n, x2: big * 2n, y2: big },
  ];
  const r = computeUnion(rects);
  assert.equal(r.totalArea, (2n * big * big).toString());
  assert.ok(BigInt(r.totalArea) > BigInt(Number.MAX_SAFE_INTEGER));
});

test("随机小坐标与单位格集合一致", () => {
  let seed = 42;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed % n;
  };
  for (let t = 0; t < 30; t++) {
    const rects: Rect[] = [];
    for (let i = 0; i < 6; i++) {
      const x1 = rand(10) - 5;
      const y1 = rand(10) - 5;
      rects.push(R(`r${i}`, x1, y1, x1 + 1 + rand(4), y1 + 1 + rand(4)));
    }
    assert.equal(computeUnion(rects).totalArea, gridArea(rects).toString());
  }
});

test("平移不变性", () => {
  const base = [R("A", 0, 0, 3, 2), R("B", 2, 1, 5, 3), R("C", -4, -4, 0, 0)];
  const shift = 1_000_000n;
  const moved = base.map((r) => ({
    ...r,
    x1: r.x1 + shift, x2: r.x2 + shift, y1: r.y1 + shift, y2: r.y2 + shift,
  }));
  assert.equal(computeUnion(base).totalArea, computeUnion(moved).totalArea);
});

test("整数缩放面积按平方变化", () => {
  const base = [R("A", 0, 0, 3, 2), R("B", 2, 1, 5, 3)];
  const k = 1000n;
  const scaled = base.map((r) => ({
    ...r, x1: r.x1 * k, x2: r.x2 * k, y1: r.y1 * k, y2: r.y2 * k,
  }));
  const a = BigInt(computeUnion(base).totalArea);
  const b = BigInt(computeUnion(scaled).totalArea);
  assert.equal(b, a * k * k);
});

test("输入重排不影响答案", () => {
  const rects = [R("A", 0, 0, 3, 2), R("B", 2, 1, 5, 3), R("C", 1, 0, 2, 1), R("D", -2, -2, 0, 0)];
  const a = computeUnion(rects).totalArea;
  const b = computeUnion([...rects].reverse()).totalArea;
  const c = computeUnion([rects[2], rects[0], rects[3], rects[1]]).totalArea;
  assert.equal(a, b);
  assert.equal(a, c);
});

test("同 x 上结束与开始事件成组处理（共享边不重叠）", () => {
  const r = computeUnion([R("A", 0, 0, 2, 2), R("B", 2, 0, 4, 2)]);
  assert.equal(r.totalArea, "8");
});

test("剖面：右边界处矩形不活动", () => {
  const rects = [R("A", 0, 0, 3, 2), R("B", 2, 1, 5, 3)];
  const p2 = profileAt(rects, 2n);
  assert.deepEqual(p2.activeIds, ["A", "B"]);
  assert.equal(p2.coveredLength, "3");
  const p3 = profileAt(rects, 3n);
  assert.deepEqual(p3.activeIds, ["B"]);
  assert.equal(p3.coveredLength, "2");
  const p5 = profileAt(rects, 5n);
  assert.deepEqual(p5.activeIds, []);
  assert.equal(p5.coveredLength, "0");
});

test("校验：重复编号与非法边界整批拒绝并指出编号", () => {
  assert.throws(
    () => parseRectBatch([{ id: "A", x1: 0, y1: 0, x2: 1, y2: 1 }, { id: "A", x1: 0, y1: 0, x2: 2, y2: 2 }]),
    (e: unknown) => e instanceof ValidationError && e.code === "DUPLICATE_ID" && /A/.test(e.message)
  );
  assert.throws(
    () => parseRectBatch([{ id: "B", x1: 3, y1: 0, x2: 3, y2: 1 }]),
    (e: unknown) => e instanceof ValidationError && e.code === "INVALID_BOUNDS" && /B/.test(e.message)
  );
  assert.throws(
    () => parseRectBatch([{ id: "C", x1: 0, y1: 5, x2: 1, y2: 5 }]),
    (e: unknown) => e instanceof ValidationError && e.code === "INVALID_BOUNDS"
  );
  assert.throws(
    () => parseRectBatch([{ id: "D", x1: 0, y1: 0, x2: 1.5, y2: 1 }]),
    (e: unknown) => e instanceof ValidationError && e.code === "INVALID_COORD"
  );
});
