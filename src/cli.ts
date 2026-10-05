// CLI：导入、计算、条带、剖面、派生版本、比较、导出、演示。
// 用法见 README 或 `node dist/cli.js help`。

import * as fs from "node:fs";
import * as path from "node:path";
import { Store } from "./store";
import { Service } from "./service";
import { ValidationError } from "./validate";
import { Band } from "./geometry";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const service = new Service(new Store(path.join(DATA_DIR, "rect-union.db")));

function out(v: unknown): void {
  console.log(JSON.stringify(v, null, 2));
}

function renderBandTable(bands: Band[]): string {
  const header = "x 区间           | 活动编号            | 合并 y 区间          | 覆盖长度 | 贡献     | 累计";
  const sep = "-".repeat(header.length + 20);
  const lines = [header, sep];
  for (const b of bands) {
    const xr = `[${b.x1}, ${b.x2})`.padEnd(15);
    const ids = b.activeIds.join(",").padEnd(20).slice(0, 20);
    const yr = b.intervals.map((i) => `[${i.y1},${i.y2})`).join(",").padEnd(20).slice(0, 20);
    lines.push(`${xr}| ${ids}| ${yr}| ${b.coveredLength.padEnd(8)}| ${b.contribution.padEnd(8)}| ${b.cumulative}`);
  }
  return lines.join("\n");
}

function readJsonFile(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function fail(err: unknown): never {
  if (err instanceof ValidationError) {
    console.error(`错误 [${err.code}] ${err.message}`);
  } else {
    console.error(`错误 ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
}

const HELP = `用法: node dist/cli.js <命令> [参数]
  import <file.json> [name]        导入矩形集合（JSON 数组或 {rectangles:[...]}），计算并保存版本
  area <versionId>                 查询并集面积
  bands <versionId> [page] [size]  分页查看条带（文本区间表）
  profile <versionId> <x>          指定横坐标的覆盖剖面
  derive <versionId> <ops.json>    增删矩形生成新版本，ops: {"add":[...],"remove":["id"]}
  compare <a> <b>                  比较两个版本
  export <versionId>               导出版本（矩形 + 元信息）
  list                             列出全部版本
  demo                             运行内置演示
坐标可用 JSON 数字或十进制字符串；面积以十进制字符串输出。`;

function demo(): void {
  const r1 = service.importSet(
    [
      { id: "A", x1: 0, y1: 0, x2: 3, y2: 2 },
      { id: "B", x1: 2, y1: 1, x2: 5, y2: 3 },
    ],
    "demo-1"
  );
  console.log(`演示 1: [0,3)x[0,2) 与 [2,5)x[1,3)，各自面积 6，交叠 1，并集应为 11`);
  console.log(`版本 ${r1.versionId} 并集面积 = ${r1.report.totalArea}`);
  console.log(renderBandTable(r1.report.bands));
  const r2 = service.deriveVersion(r1.versionId, [{ id: "C", x1: 1, y1: 0, x2: 2, y2: 1 }], [], "demo-2");
  console.log(`\n演示 2: 加入完全被覆盖的小矩形 C=[1,2)x[0,1)，答案应不变`);
  console.log(`版本 ${r2.versionId} 并集面积 = ${r2.report.totalArea}`);
  console.log(renderBandTable(r2.report.bands));
  console.log(`\nx=2 处剖面（版本 ${r2.versionId}）:`);
  out(service.getProfile(r2.versionId, 2n));
}

function main(): void {
  const [cmd, ...args] = process.argv.slice(2);
  try {
    switch (cmd) {
      case "import": {
        const data = readJsonFile(args[0]);
        const rects = Array.isArray(data) ? data : (data as { rectangles: unknown[] }).rectangles;
        const { versionId, report } = service.importSet(rects, args[1] ?? null);
        out({ versionId, totalArea: report.totalArea, bandCount: report.bands.length });
        break;
      }
      case "area": {
        const r = service.getReport(Number(args[0]));
        out({ versionId: Number(args[0]), totalArea: r.totalArea, rectCount: r.rectCount });
        break;
      }
      case "bands": {
        const page = Number(args[1] ?? "1");
        const size = Number(args[2] ?? "50");
        const res = service.getBands(Number(args[0]), page, size);
        console.log(`版本 ${res.versionId} 总面积=${res.totalArea} 条带数=${res.bandCount} 第${page}页`);
        console.log(renderBandTable(res.bands));
        break;
      }
      case "profile":
        out(service.getProfile(Number(args[0]), BigInt(args[1])));
        break;
      case "derive": {
        const ops = readJsonFile(args[1]) as { add?: unknown[]; remove?: string[] };
        const { versionId, report } = service.deriveVersion(
          Number(args[0]),
          ops.add ?? [],
          ops.remove ?? [],
          null
        );
        out({ versionId, parentId: Number(args[0]), totalArea: report.totalArea });
        break;
      }
      case "compare":
        out(service.compare(Number(args[0]), Number(args[1])));
        break;
      case "export":
        out(service.exportVersion(Number(args[0])));
        break;
      case "list":
        out(service.listVersions());
        break;
      case "demo":
        demo();
        break;
      default:
        console.log(HELP);
        if (cmd && cmd !== "help") process.exitCode = 1;
    }
  } catch (err) {
    fail(err);
  }
}

main();
