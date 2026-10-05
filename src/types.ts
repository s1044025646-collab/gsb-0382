/** 矩形输入（坐标为安全整数范围内的整数，左闭右开 [x1,x2) x [y1,y2)）。 */
export interface RectInput {
  id: string;
  x1: number | string;
  y1: number | string;
  x2: number | string;
  y2: number | string;
}

/** 校验后的矩形，坐标统一为 BigInt。 */
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

/** 一个正宽扫描条带的解释记录。 */
export interface Strip {
  index: number;
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
  algoVersion: string;
  totalArea: string;
  eventXs: string[];
  strips: Strip[];
}

export interface Profile {
  x: string;
  activeIds: string[];
  intervals: MergedInterval[];
  coveredLength: string;
}

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}
