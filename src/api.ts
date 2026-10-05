// HTTP API（node:http，无外部依赖）。
// 端口：--port 或 PORT 环境变量；默认 0（操作系统分配空闲端口）。

import * as http from "node:http";
import * as path from "node:path";
import { Store } from "./store";
import { Service, NotFoundError } from "./service";
import { ValidationError } from "./validate";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const dbPath = path.join(DATA_DIR, "rect-union.db");
const service = new Service(new Store(dbPath));

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

function sendError(res: http.ServerResponse, err: unknown): void {
  if (err instanceof ValidationError) {
    send(res, 400, { error: { code: err.code, message: err.message } });
  } else if (err instanceof NotFoundError) {
    send(res, 404, { error: { code: err.code, message: err.message } });
  } else {
    send(res, 500, { error: { code: "INTERNAL", message: String(err) } });
  }
}

async function readBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ValidationError("INVALID_JSON", "请求体不是合法 JSON");
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    // POST /versions            { name?, rectangles: [...] }  导入集合并计算
    if (req.method === "POST" && parts.length === 1 && parts[0] === "versions") {
      const body = (await readBody(req)) as Record<string, unknown> | null;
      if (!body || !Array.isArray(body.rectangles)) {
        throw new ValidationError("INVALID_BODY", "请求体需为 { name?, rectangles: [...] }");
      }
      const { versionId, report } = service.importSet(
        body.rectangles,
        typeof body.name === "string" ? body.name : null
      );
      return send(res, 201, { versionId, totalArea: report.totalArea, bandCount: report.bands.length });
    }
    // GET /versions
    if (req.method === "GET" && parts.length === 1 && parts[0] === "versions") {
      return send(res, 200, { versions: service.listVersions() });
    }
    const vid = parts[0] === "versions" && parts.length >= 2 ? Number(parts[1]) : NaN;
    if (parts[0] === "versions" && (!Number.isSafeInteger(vid) || vid <= 0)) {
      throw new ValidationError("INVALID_VERSION", `非法版本号: ${parts[1]}`);
    }
    // GET /versions/:id/area
    if (req.method === "GET" && parts[2] === "area") {
      const r = service.getReport(vid);
      return send(res, 200, { versionId: vid, totalArea: r.totalArea, rectCount: r.rectCount });
    }
    // GET /versions/:id/bands?page=1&pageSize=50
    if (req.method === "GET" && parts[2] === "bands") {
      const page = Math.max(1, Number(url.searchParams.get("page") ?? "1"));
      const pageSize = Math.min(500, Math.max(1, Number(url.searchParams.get("pageSize") ?? "50")));
      return send(res, 200, service.getBands(vid, page, pageSize));
    }
    // GET /versions/:id/profile?x=2
    if (req.method === "GET" && parts[2] === "profile") {
      const xs = url.searchParams.get("x");
      if (xs === null || !/^-?\d+$/.test(xs)) {
        throw new ValidationError("INVALID_COORD", "查询参数 x 需为整数");
      }
      return send(res, 200, service.getProfile(vid, BigInt(xs)));
    }
    // POST /versions/:id/derive  { name?, add: [...], remove: ["id"] }
    if (req.method === "POST" && parts[2] === "derive") {
      const body = (await readBody(req)) as Record<string, unknown> | null;
      const add = Array.isArray(body?.add) ? body.add : [];
      const remove = Array.isArray(body?.remove) ? body.remove : [];
      for (const r of remove) {
        if (typeof r !== "string") throw new ValidationError("INVALID_ID", "remove 需为编号字符串数组");
      }
      const { versionId, report } = service.deriveVersion(
        vid,
        add,
        remove as string[],
        typeof body?.name === "string" ? body.name : null
      );
      return send(res, 201, { versionId, parentId: vid, totalArea: report.totalArea });
    }
    // GET /versions/:id/export
    if (req.method === "GET" && parts[2] === "export") {
      return send(res, 200, service.exportVersion(vid));
    }
    // GET /compare?a=1&b=2
    if (req.method === "GET" && parts[0] === "compare") {
      const a = Number(url.searchParams.get("a"));
      const b = Number(url.searchParams.get("b"));
      if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
        throw new ValidationError("INVALID_VERSION", "查询参数 a、b 需为整数版本号");
      }
      return send(res, 200, service.compare(a, b));
    }
    send(res, 404, { error: { code: "NOT_FOUND", message: `未知路由: ${req.method} ${url.pathname}` } });
  } catch (err) {
    sendError(res, err);
  }
});

const portArg = process.argv.find((a) => a.startsWith("--port="));
const port = portArg ? Number(portArg.split("=")[1]) : Number(process.env.PORT ?? "0");
server.listen(port, () => {
  const addr = server.address();
  const p = typeof addr === "object" && addr ? addr.port : port;
  console.log(`rect-union API 已启动: http://127.0.0.1:${p}  (数据目录: ${DATA_DIR})`);
});
