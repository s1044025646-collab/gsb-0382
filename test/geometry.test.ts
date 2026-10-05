import { test } from "node:test";
import assert from "node:assert/strict";
import { sweep, profileAt } from "../src/geometry";
import { validateBatch } from "../src/validate";
import { Rect } from "../src/types";

function R(id: string, x1: number, y1: number, x2: number, y2: number): Rect {
  return { id, x1: BigInt(x1), y1: BigInt(y1), x2: BigInt(x2), y2: BigInt(y2) };
}

test("演示用例: 两个 6 面积矩形交叠 1，并集 11", () => {
  const report = sweep([R("A", 0, 0, 3, 2), R("B", 2, 1, 5, 3)]);
  assert.equal(report.totalArea, "11");
  assert.deepEqual(report.eventXs, ["0", "2", "3", "5"]);
  assert.equal(report.strips.length, 3);
  const sum = report.strips.reduce((a, s) => a + BigInt(s.contribution), 0n);
  assert.equal(sum.toString(), report.totalArea);
  assert.equal(report.strips[1].coveredLength, "3");
});

test("空集合: 面积 0 且无条带", () => {
  const report = sweep([]);
  assert.equal(report.totalArea, "0");
  assert.deepEqual(report.strips, []);
  assert.deepEqual(report.eventXs, []);
});

test("分离矩形面积相加", () => {
  const report = sweep([R("A", 0, 0, 1, 1), R("B", 10, 10, 13, 15)]);
  assert.equal(report.totalArea, "16");
});

test("包含关系只算一次", () => {
  const report = sweep([R("outer", 0, 0, 10, 10), R("inner", 2, 2, 5, 5)]);
  assert.equal(report.totalArea, "100");
});

test("完全重复的不同编号矩形只算一次", () => {
  const report = sweep([R("a", 0, 0, 4, 4), R("b", 0, 0, 4, 4), R("c", 0, 0, 4, 4)]);
  assert.equal(report.totalArea, "16");
});

test("仅边相触 / 仅角相触不产生额外面积", () => {
  const edge = sweep([R("a", 0, 0, 2, 2), R("b", 2, 0, 4, 2)]);
  assert.equal(edge.totalArea, "8");
  const corner = sweep([R("a", 0, 0, 2, 2), R("b", 2, 2, 4, 4)]);
  assert.equal(corner.totalArea, "8");
});

test("负坐标", () => {
  const report = sweep([R("a", -5, -5, -1, -1), R("b", -3, -3, 2, 2)]);
  assert.equal(report.totalArea, "37");
});

test("超过 Number.MAX_SAFE_INTEGER 的面积用 BigInt 精确表示", () => {
  const n = 1_000_000_000;
  const report = sweep([R("big", 0, 0, n, n)]);
  assert.equal(report.totalArea, "1000000000000000000");
});

test("同坐标开始/结束事件成组处理，行序不影响结果", () => {
  const base = [R("a", 0, 0, 2, 5), R("b", 2, 0, 4, 5), R("c", 1, 1, 3, 2)];
  const expected = sweep(base).totalArea;
  const reversed = sweep([...base].reverse()).totalArea;
  assert.equal(reversed, expected);
  assert.equal(expected, "20");
});

test("多重覆盖只算一次，移除一个不清空仍被覆盖区间", () => {
  const report = sweep([R("a", 0, 0, 4, 4), R("b", 0, 0, 4, 4), R("c", 1, 1, 2, 2)]);
  assert.equal(report.totalArea, "16");
  const after = sweep([R("a", 0, 0, 4, 4), R("c", 1, 1, 2, 2)]);
  assert.equal(after.totalArea, "16");
});

test("剖面遵守半开约定: 右边界上的矩形不活动", () => {
  const rects = [R("a", 0, 0, 3, 2), R("b", 2, 1, 5, 3)];
  const p2 = profileAt(rects, 2n);
  assert.deepEqual(p2.activeIds, ["a", "b"]);
  assert.equal(p2.coveredLength, "3");
  const p3 = profileAt(rects, 3n);
  assert.deepEqual(p3.activeIds, ["b"]);
  assert.equal(p3.coveredLength, "2");
  const p5 = profileAt(rects, 5n);
  assert.deepEqual(p5.activeIds, []);
  assert.equal(p5.coveredLength, "0");
});

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

test("随机小坐标与单位格集合逐一核对", () => {
  let seed = 42;
  const rand = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed % n;
  };
  for (let iter = 0; iter < 200; iter++) {
    const rects: Rect[] = [];
    const count = 1 + rand(6);
    for (let i = 0; i < count; i++) {
      const x1 = rand(8) - 4;
      const y1 = rand(8) - 4;
      rects.push(R(`r${i}`, x1, y1, x1 + 1 + rand(5), y1 + 1 + rand(5)));
    }
    assert.equal(sweep(rects).totalArea, gridArea(rects).toString(), `iter=${iter}`);
  }
});

test("平移不变性", () => {
  const rects = [R("a", 0, 0, 3, 2), R("b", 2, 1, 5, 3), R("c", -4, -4, -1, 7)];
  const shift = 10n ** 12n;
  const moved = rects.map((r) => ({
    ...r,
    x1: r.x1 + shift,
    x2: r.x2 + shift,
    y1: r.y1 + shift,
    y2: r.y2 + shift,
  }));
  assert.equal(sweep(moved).totalArea, sweep(rects).totalArea);
});

test("整数缩放 k 倍，面积变为 k^2 倍", () => {
  const rects = [R("a", 0, 0, 3, 2), R("b", 2, 1, 5, 3)];
  const k = 1000n;
  const scaled = rects.map((r) => ({
    ...r,
    x1: r.x1 * k,
    x2: r.x2 * k,
    y1: r.y1 * k,
    y2: r.y2 * k,
  }));
  assert.equal(BigInt(sweep(scaled).totalArea), BigInt(sweep(rects).totalArea) * k * k);
});

test("输入重排不变", () => {
  const rects = [R("a", 0, 0, 3, 2), R("b", 2, 1, 5, 3), R("c", 1, 0, 2, 1), R("d", -2, -2, 0, 0)];
  const expected = sweep(rects).totalArea;
  const shuffled = [rects[2], rects[0], rects[3], rects[1]];
  assert.equal(sweep(shuffled).totalArea, expected);
});

test("校验: 重复编号 / 非法边界 / 非法坐标均整批拒绝并指出编号", () => {
  assert.throws(
    () =>
      validateBatch([
        { id: "a", x1: 0, y1: 0, x2: 1, y2: 1 },
        { id: "a", x1: 0, y1: 0, x2: 2, y2: 2 },
      ]),
    (e: Error & { code?: string }) => e.code === "E_DUP_ID" && e.message.includes("a")
  );
  assert.throws(
    () => validateBatch([{ id: "bad", x1: 5, y1: 0, x2: 5, y2: 1 }]),
    (e: Error & { code?: string }) => e.code === "E_BAD_BOUND" && e.message.includes("bad")
  );
  assert.throws(
    () => validateBatch([{ id: "nan", x1: 0.5, y1: 0, x2: 1, y2: 1 }]),
    (e: Error & { code?: string }) => e.code === "E_BAD_COORD" && e.message.includes("nan")
  );
  const ok = validateBatch([
    { id: "p", x1: 0, y1: 0, x2: 1, y2: 1 },
    { id: "q", x1: 0, y1: 0, x2: 1, y2: 1 },
  ]);
  assert.equal(ok.length, 2);
});
