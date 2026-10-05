import * as fs from "node:fs";
import { Store, defaultDbPath } from "./store";
import { validateBatch } from "./validate";
import { profileAt } from "./geometry";
import { startServer } from "./server";
import { ApiError, Strip } from "./types";

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      i++;
      continue;
    }
    out.push(args[i]);
  }
  return out;
}

function readJsonFile(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new ApiError("E_BAD_JSON", `无法读取或解析 JSON 文件 ${file}: ${e}`);
  }
}

function latestVersion(store: Store, setId: number): number {
  const list = store.listVersions(setId);
  if (list.length === 0) throw new ApiError("E_NOT_FOUND", `集合 ${setId} 没有任何版本`);
  return list[list.length - 1].version;
}

function printStripTable(strips: Strip[]): void {
  if (strips.length === 0) {
    console.log("（无正宽条带）");
    return;
  }
  console.log("idx | x范围           | 宽度 | 活动编号      | 合并y区间            | 覆盖长度 | 贡献   | 累计");
  console.log("----+-----------------+------+---------------+----------------------+----------+--------+------");
  for (const s of strips) {
    const xr = `[${s.x1}, ${s.x2})`;
    const ys = s.intervals.map((i) => `[${i.y1}, ${i.y2})`).join(" U ");
    console.log(
      `${String(s.index).padEnd(3)} | ${xr.padEnd(15)} | ${s.width.padEnd(4)} | ${s.activeIds
        .join(",")
        .padEnd(13)} | ${ys.padEnd(20)} | ${s.coveredLength.padEnd(8)} | ${s.contribution.padEnd(6)} | ${s.cumulative}`
    );
  }
}

const USAGE = `用法: node dist/src/cli.js <命令> [参数]
命令:
  serve [--port N] [--db 路径]          启动 HTTP API（端口默认 0，即自动选择空闲端口）
  import <文件.json> [--name 名]        导入矩形集合，创建集合并计算版本 1
  versions <setId>                      列出版本
  area <setId> [version]                查询并集面积
  strips <setId> [version] [--offset N --limit N]   文本区间表展示条带
  profile <setId> [version] <x>         查询横坐标 x 处的覆盖剖面
  add <setId> <文件.json>               新增矩形，创建新版本
  remove <setId> <id...>                删除矩形，创建新版本
  compare <setId> <a> <b>               比较两个版本
  export <setId> [version] [输出文件]   导出完整报告 JSON
  demo                                  运行内置演示
JSON 文件格式: { "rectangles": [ { "id": "r1", "x1": 0, "y1": 0, "x2": 3, "y2": 2 } ] }
坐标可写十进制字符串以表达大整数，范围 ±(2^53-1)。`;

function runDemo(store: Store): void {
  console.log("== 演示 1: 两个矩形交叠 ==");
  const setId = store.createSet("demo");
  const v1 = store.addVersion(
    setId,
    validateBatch([
      { id: "A", x1: 0, y1: 0, x2: 3, y2: 2 },
      { id: "B", x1: 2, y1: 1, x2: 5, y2: 3 },
    ])
  );
  console.log("A=[0,3)x[0,2) 面积6, B=[2,5)x[1,3) 面积6, 交叠1, 期望并集 11");
  console.log(`实际并集面积: ${v1.totalArea}`);
  const report = store.getReport(setId, v1.version);
  printStripTable(report.strips);

  console.log("\n== 演示 2: 加入完全被覆盖的小矩形 C=[1,2)x[0,1)，面积不变 ==");
  const v2 = store.mutate(
    setId,
    validateBatch([{ id: "C", x1: 1, y1: 0, x2: 2, y2: 1 }]),
    []
  );
  console.log(`版本 ${v2.version} 并集面积: ${v2.totalArea}（应仍为 11）`);

  console.log("\n== 剖面核对: x=3（A 已结束，B 活动） ==");
  console.log(JSON.stringify(profileAt(store.getRectangles(setId, v2.version), 3n)));
  console.log("\n== 版本比较 v1 -> v2 ==");
  console.log(JSON.stringify(store.compare(setId, 1, 2), null, 2));
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd || cmd === "help" || cmd === "--help") {
    console.log(USAGE);
    return;
  }
  const dbPath = argValue(args, "--db") ?? defaultDbPath();
  const store = new Store(dbPath);
  try {
    const pos = positional(args.slice(1));
    switch (cmd) {
      case "serve": {
        const port = Number(argValue(args, "--port") ?? process.env.PORT ?? 0);
        const { port: actual } = await startServer(store, port);
        console.log(`API 已启动: http://127.0.0.1:${actual}  (数据库: ${dbPath})`);
        return;
      }
      case "import": {
        const data = readJsonFile(pos[0]) as { rectangles?: unknown };
        const rects = validateBatch(data.rectangles);
        const setId = store.createSet(argValue(args, "--name"));
        const info = store.addVersion(setId, rects);
        console.log(JSON.stringify(info, null, 2));
        break;
      }
      case "versions":
        console.log(JSON.stringify(store.listVersions(Number(pos[0])), null, 2));
        break;
      case "area": {
        const setId = Number(pos[0]);
        const v = pos[1] ? Number(pos[1]) : latestVersion(store, setId);
        console.log(store.getVersionInfo(setId, v).totalArea);
        break;
      }
      case "strips": {
        const setId = Number(pos[0]);
        const v = pos[1] ? Number(pos[1]) : latestVersion(store, setId);
        const report = store.getReport(setId, v);
        const offset = Number(argValue(args, "--offset") ?? 0);
        const limit = Number(argValue(args, "--limit") ?? report.strips.length);
        console.log(`事件位置: ${report.eventXs.join(", ")}`);
        console.log(`总面积: ${report.totalArea}  条带数: ${report.strips.length}`);
        printStripTable(report.strips.slice(offset, offset + limit));
        break;
      }
      case "profile": {
        const setId = Number(pos[0]);
        const hasV = pos.length >= 3;
        const v = hasV ? Number(pos[1]) : latestVersion(store, setId);
        const x = BigInt(hasV ? pos[2] : pos[1]);
        console.log(JSON.stringify(profileAt(store.getRectangles(setId, v), x), null, 2));
        break;
      }
      case "add": {
        const data = readJsonFile(pos[1]) as { rectangles?: unknown };
        const info = store.mutate(Number(pos[0]), validateBatch(data.rectangles), []);
        console.log(JSON.stringify(info, null, 2));
        break;
      }
      case "remove": {
        const info = store.mutate(Number(pos[0]), [], pos.slice(1));
        console.log(JSON.stringify(info, null, 2));
        break;
      }
      case "compare":
        console.log(
          JSON.stringify(store.compare(Number(pos[0]), Number(pos[1]), Number(pos[2])), null, 2)
        );
        break;
      case "export": {
        const setId = Number(pos[0]);
        const v = pos[1] ? Number(pos[1]) : latestVersion(store, setId);
        const json = JSON.stringify(store.getReport(setId, v), null, 2);
        if (pos[2]) {
          fs.writeFileSync(pos[2], json);
          console.log(`已导出到 ${pos[2]}`);
        } else {
          console.log(json);
        }
        break;
      }
      case "demo":
        runDemo(store);
        break;
      default:
        console.error(`未知命令: ${cmd}\n${USAGE}`);
        process.exitCode = 2;
    }
  } catch (e) {
    if (e instanceof ApiError) {
      console.error(`错误 [${e.code}] ${e.message}`);
      process.exitCode = 1;
    } else {
      throw e;
    }
  } finally {
    if (args[0] !== "serve") store.close();
  }
}

main();
