// 参数校验：把外部输入（JSON 数字或十进制字符串）解析为 Rect。
// 任何一处错误都导致整批拒绝，错误信息指出出错编号。

import { MAX_COORD, MIN_COORD, Rect } from "./geometry";

export class ValidationError extends Error {
  code: string;
  details: string[];
  constructor(code: string, message: string, details: string[] = []) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function parseCoord(value: unknown, field: string, id: string): bigint {
  let v: bigint;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new ValidationError(
        "INVALID_COORD",
        `矩形 ${id}: 字段 ${field} 不是安全整数: ${value}`
      );
    }
    v = BigInt(value);
  } else if (typeof value === "string") {
    if (!/^-?\d+$/.test(value.trim())) {
      throw new ValidationError(
        "INVALID_COORD",
        `矩形 ${id}: 字段 ${field} 不是整数字符串: ${value}`
      );
    }
    v = BigInt(value.trim());
  } else {
    throw new ValidationError(
      "INVALID_COORD",
      `矩形 ${id}: 字段 ${field} 类型非法（需整数或十进制字符串）`
    );
  }
  if (v < MIN_COORD || v > MAX_COORD) {
    throw new ValidationError(
      "COORD_OUT_OF_RANGE",
      `矩形 ${id}: 字段 ${field}=${v} 超出范围 [${MIN_COORD}, ${MAX_COORD}]`
    );
  }
  return v;
}

const ID_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

export function parseRect(input: unknown, index: number): Rect {
  if (typeof input !== "object" || input === null) {
    throw new ValidationError("INVALID_RECT", `第 ${index} 个矩形不是对象`);
  }
  const o = input as Record<string, unknown>;
  const id = o.id;
  if (typeof id !== "string" || !ID_RE.test(id)) {
    throw new ValidationError(
      "INVALID_ID",
      `第 ${index} 个矩形编号非法（需 1-64 位 [A-Za-z0-9_.:-]）: ${JSON.stringify(id)}`
    );
  }
  for (const f of ["x1", "y1", "x2", "y2"]) {
    if (!(f in o)) {
      throw new ValidationError("MISSING_FIELD", `矩形 ${id}: 缺少字段 ${f}`);
    }
  }
  const x1 = parseCoord(o.x1, "x1", id);
  const y1 = parseCoord(o.y1, "y1", id);
  const x2 = parseCoord(o.x2, "x2", id);
  const y2 = parseCoord(o.y2, "y2", id);
  if (x1 >= x2) {
    throw new ValidationError("INVALID_BOUNDS", `矩形 ${id}: 需要 x1 < x2，实际 ${x1} >= ${x2}`);
  }
  if (y1 >= y2) {
    throw new ValidationError("INVALID_BOUNDS", `矩形 ${id}: 需要 y1 < y2，实际 ${y1} >= ${y2}`);
  }
  return { id, x1, y1, x2, y2 };
}

export function parseRectBatch(inputs: unknown[]): Rect[] {
  if (!Array.isArray(inputs)) {
    throw new ValidationError("INVALID_BATCH", "请求体需为矩形数组");
  }
  const rects = inputs.map((r, i) => parseRect(r, i));
  const seen = new Set<string>();
  for (const r of rects) {
    if (seen.has(r.id)) {
      throw new ValidationError("DUPLICATE_ID", `重复编号: ${r.id}，整批拒绝`);
    }
    seen.add(r.id);
  }
  return rects;
}
