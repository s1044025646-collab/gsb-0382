import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store";
import { startServer } from "../src/server";
import { Server } from "node:http";

let server: Server;
let base: string;

before(async () => {
  const store = new Store(":memory:");
  const started = await startServer(store, 0);
  server = started.server;
  base = `http://127.0.0.1:${started.port}`;
});

after(() => server.close());

async function post(pathname: string, body: unknown) {
  const res = await fetch(base + pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

async function getJson(pathname: string): Promise<any> {
  return (await (await fetch(base + pathname)).json()) as any;
}

test("API 全流程: 导入/面积/条带/剖面/增删/比较/导出", async () => {
  const created = await post("/sets", {
    name: "api",
    rectangles: [
      { id: "A", x1: 0, y1: 0, x2: 3, y2: 2 },
      { id: "B", x1: 2, y1: 1, x2: 5, y2: 3 },
    ],
  });
  assert.equal(created.status, 201);
  const setId = created.body.setId;
  assert.equal(created.body.totalArea, "11");

  const area = await getJson(`/sets/${setId}/versions/1/area`);
  assert.equal(area.totalArea, "11");

  const strips = await getJson(`/sets/${setId}/versions/1/strips?offset=1&limit=1`);
  assert.equal(strips.total, 3);
  assert.equal(strips.strips.length, 1);
  assert.equal(strips.strips[0].coveredLength, "3");

  const profile = await getJson(`/sets/${setId}/versions/1/profile?x=3`);
  assert.deepEqual(profile.activeIds, ["B"]);

  const v2 = await post(`/sets/${setId}/versions`, {
    add: [{ id: "C", x1: 1, y1: 0, x2: 2, y2: 1 }],
  });
  assert.equal(v2.body.version, 2);
  assert.equal(v2.body.totalArea, "11");

  const cmp = await getJson(`/sets/${setId}/compare?a=1&b=2`);
  assert.deepEqual(cmp.added, ["C"]);

  const report = await getJson(`/sets/${setId}/versions/2/report`);
  assert.equal(report.totalArea, "11");
  assert.equal(report.algoVersion, "sweep-x/merge-y-v1");
});

test("API 校验错误返回错误码并指出编号", async () => {
  const dup = await post("/sets", {
    rectangles: [
      { id: "x", x1: 0, y1: 0, x2: 1, y2: 1 },
      { id: "x", x1: 0, y1: 0, x2: 2, y2: 2 },
    ],
  });
  assert.equal(dup.status, 400);
  assert.equal(dup.body.error.code, "E_DUP_ID");
  assert.match(dup.body.error.message, /x/);

  const bad = await post("/sets", { rectangles: [{ id: "z", x1: 3, y1: 0, x2: 3, y2: 1 }] });
  assert.equal(bad.body.error.code, "E_BAD_BOUND");

  const missing = await fetch(`${base}/sets/999/versions/1/area`);
  assert.equal(missing.status, 404);
});
