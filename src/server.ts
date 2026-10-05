import * as http from "node:http";
import { AddressInfo } from "node:net";
import { Store } from "./store";
import { validateBatch } from "./validate";
import { profileAt } from "./geometry";
import { ApiError } from "./types";

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function parseJson(req: http.IncomingMessage): Promise<unknown> {
  const text = await readBody(req);
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError("E_BAD_JSON", "请求体不是合法 JSON");
  }
}

function parseX(raw: string | null): bigint {
  if (raw === null || !/^-?\d+$/.test(raw)) {
    throw new ApiError("E_BAD_COORD", `查询参数 x 必须是整数，得到: ${raw}`);
  }
  return BigInt(raw);
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const parts = url.pathname.split("/").filter(Boolean);
      const method = req.method ?? "GET";

      if (method === "GET" && url.pathname === "/health") {
        return send(res, 200, { ok: true });
      }

      // POST /sets  { name?, rectangles: [...] }
      if (method === "POST" && parts.length === 1 && parts[0] === "sets") {
        const body = (await parseJson(req)) as { name?: string; rectangles?: unknown };
        const rects = validateBatch(body.rectangles);
        const setId = store.createSet(body.name);
        const info = store.addVersion(setId, rects);
        return send(res, 201, info);
      }

      if (parts[0] === "sets" && parts.length >= 2) {
        const setId = Number(parts[1]);
        if (!Number.isInteger(setId)) throw new ApiError("E_BAD_PARAM", "setId 必须是整数");

        // GET /sets/:id/versions
        if (method === "GET" && parts.length === 3 && parts[2] === "versions") {
          return send(res, 200, store.listVersions(setId));
        }

        // POST /sets/:id/versions  { add: [...], remove: [ids] }
        if (method === "POST" && parts.length === 3 && parts[2] === "versions") {
          const body = (await parseJson(req)) as { add?: unknown; remove?: unknown };
          const add = body.add === undefined ? [] : validateBatch(body.add);
          const remove = body.remove === undefined ? [] : body.remove;
          if (!Array.isArray(remove) || remove.some((x) => typeof x !== "string")) {
            throw new ApiError("E_BAD_SHAPE", "remove 必须是编号字符串数组");
          }
          const info = store.mutate(setId, add, remove as string[]);
          return send(res, 201, info);
        }

        if (parts.length >= 4 && parts[2] === "versions") {
          const version = Number(parts[3]);
          if (!Number.isInteger(version)) throw new ApiError("E_BAD_PARAM", "version 必须是整数");
          const sub = parts[4];

          if (method === "GET" && sub === "area") {
            const info = store.getVersionInfo(setId, version);
            return send(res, 200, { setId, version, totalArea: info.totalArea });
          }
          if (method === "GET" && sub === "rectangles") {
            const rects = store.getRectangles(setId, version).map((r) => ({
              id: r.id,
              x1: r.x1.toString(),
              y1: r.y1.toString(),
              x2: r.x2.toString(),
              y2: r.y2.toString(),
            }));
            return send(res, 200, rects);
          }
          if (method === "GET" && sub === "strips") {
            const report = store.getReport(setId, version);
            const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
            const limitRaw = Number(url.searchParams.get("limit") ?? report.strips.length);
            const limit = Math.max(0, limitRaw || report.strips.length);
            return send(res, 200, {
              setId,
              version,
              totalArea: report.totalArea,
              eventXs: report.eventXs,
              total: report.strips.length,
              offset,
              limit,
              strips: report.strips.slice(offset, offset + limit),
            });
          }
          if (method === "GET" && sub === "profile") {
            const x = parseX(url.searchParams.get("x"));
            const rects = store.getRectangles(setId, version);
            return send(res, 200, profileAt(rects, x));
          }
          if (method === "GET" && sub === "report") {
            return send(res, 200, store.getReport(setId, version));
          }
        }

        // GET /sets/:id/compare?a=1&b=2
        if (method === "GET" && parts.length === 3 && parts[2] === "compare") {
          const a = Number(url.searchParams.get("a"));
          const b = Number(url.searchParams.get("b"));
          if (!Number.isInteger(a) || !Number.isInteger(b)) {
            throw new ApiError("E_BAD_PARAM", "compare 需要整数参数 a 和 b");
          }
          return send(res, 200, store.compare(setId, a, b));
        }
      }

      throw new ApiError("E_NOT_FOUND", `路由不存在: ${method} ${url.pathname}`);
    } catch (e) {
      if (e instanceof ApiError) {
        return send(res, e.code === "E_NOT_FOUND" ? 404 : 400, {
          error: { code: e.code, message: e.message, details: e.details ?? null },
        });
      }
      return send(res, 500, {
        error: { code: "E_INTERNAL", message: String(e), details: null },
      });
    }
  });
}

export function startServer(
  store: Store,
  port: number
): Promise<{ server: http.Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(store);
    server.listen(port, () => {
      const addr = server.address() as AddressInfo;
      resolve({ server, port: addr.port });
    });
  });
}
