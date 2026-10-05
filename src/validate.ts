import { ApiError, Rect, RectInput } from "./types";

/**
 * 坐标精确范围：|坐标| <= 2^53-1（Number.MAX_SAFE_INTEGER）。
 * 宽度/高度最大约 2^54，面积最大约 2^108，全部用 BigInt 精确累计。
 */
export const MAX_COORD = BigInt(Number.MAX_SAFE_INTEGER);

function parseCoord(value: number | string, field: string, id: string): bigint {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new ApiError(
        "E_BAD_COORD",
        `矩形 ${id} : 字段 ${field} 不是安全整数: ${value}`,
        { id, field, value }
      );
    }
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) {
    const v = BigInt(value.trim());
    if (v > MAX_COORD || v < -MAX_COORD) {
      throw new ApiError(
        "E_BAD_COORD",
        `矩形 ${id}: 字段 ${field} 超出坐标范围 ±${MAX_COORD}`,
        { id, field, value }
      );
    }
    return v;
  }
  throw new ApiError(
    "E_BAD_COORD",
    `矩形 ${id}: 字段 ${field} 不是合法整数: ${JSON.stringify(value)}`,
    { id, field, value }
  );
}

export function validateRect(raw: unknown): Rect {
  if (typeof raw !== "object" || raw === null) {
    throw new ApiError("E_BAD_SHAPE", "矩形条目必须是对象");
  }
  const r = raw as Partial<RectInput>;
  if (typeof r.id !== "string" || r.id.length === 0) {
    throw new ApiError("E_BAD_ID", "矩形编号必须是非空字符串", { id: r.id });
  }
  const id = r.id;
  for (const f of ["x1", "y1", "x2", "y2"] as const) {
    if (r[f] === undefined || r[f] === null) {
      throw new ApiError("E_MISSING_FIELD", `矩形 ${id}: 缺少字段 ${f}`, { id, field: f });
    }
  }
  const x1 = parseCoord(r.x1!, "x1", id);
  const y1 = parseCoord(r.y1!, "y1", id);
  const x2 = parseCoord(r.x2!, "x2", id);
  const y2 = parseCoord(r.y2!, "y2", id);
  if (!(x1 < x2)) {
    throw new ApiError("E_BAD_BOUND", `矩形 ${id}: 要求 x1 < x2，得到 [${x1}, ${x2})`, { id });
  }
  if (!(y1 < y2)) {
    throw new ApiError("E_BAD_BOUND", `矩形 ${id}: 要求 y1 < y2，得到 [${y1}, ${y2})`, { id });
  }
  return { id, x1, y1, x2, y2 };
}

/** 校验整批矩形；任一失败或编号重复则整批拒绝。 */
export function validateBatch(raw: unknown): Rect[] {
  if (!Array.isArray(raw)) {
    throw new ApiError("E_BAD_SHAPE", "rectangles 必须是数组");
  }
  const seen = new Set<string>();
  const out: Rect[] = [];
  for (const item of raw) {
    const rect = validateRect(item);
    if (seen.has(rect.id)) {
      throw new ApiError("E_DUP_ID", `矩形编号重复: ${rect.id}`, { id: rect.id });
    }
    seen.add(rect.id);
    out.push(rect);
  }
  return out;
}
