import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "../store";
import { Service } from "../service";

function tmpService(): Service {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rect-union-"));
  return new Service(new Store(path.join(dir, "t.db")));
}

test("导入、重开库后旧版本仍可查", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rect-union-"));
  const db = path.join(dir, "t.db");
  const s1 = new Service(new Store(db));
  const v1 = s1.importSet([{ id: "A", x1: 0, y1: 0, x2: 3, y2: 2 }]).versionId;
  const s2 = new Service(new Store(db));
  assert.equal(s2.getReport(v1).totalArea, "6");
});

test("派生版本：增删矩形并完整重算；比较版本", () => {
  const service = tmpService();
  const v1 = service.importSet([
    { id: "A", x1: 0, y1: 0, x2: 3, y2: 2 },
    { id: "B", x1: 2, y1: 1, x2: 5, y2: 3 },
  ]).versionId;
  const v2 = service.deriveVersion(v1, [{ id: "C", x1: 10, y1: 10, x2: 12, y2: 12 }], ["B"]).versionId;
  assert.equal(service.getReport(v2).totalArea, "10");
  const cmp = service.compare(v1, v2);
  assert.deepEqual(cmp.added, ["C"]);
  assert.deepEqual(cmp.removed, ["B"]);
  assert.equal(cmp.areaDelta, "-1");
});

test("输入失败不覆盖既有有效结果", () => {
  const service = tmpService();
  const v1 = service.importSet([{ id: "A", x1: 0, y1: 0, x2: 3, y2: 2 }]).versionId;
  assert.throws(() => service.deriveVersion(v1, [{ id: "A", x1: 0, y1: 0, x2: 1, y2: 1 }], []));
  assert.equal(service.getReport(v1).totalArea, "6");
  assert.equal(service.listVersions().length, 1);
});

test("条带分页", () => {
  const service = tmpService();
  const v = service.importSet([
    { id: "A", x1: 0, y1: 0, x2: 3, y2: 2 },
    { id: "B", x1: 2, y1: 1, x2: 5, y2: 3 },
  ]).versionId;
  const p1 = service.getBands(v, 1, 2);
  assert.equal(p1.bands.length, 2);
  const p2 = service.getBands(v, 2, 2);
  assert.equal(p2.bands.length, 1);
  const sum = [...p1.bands, ...p2.bands].reduce((a, b) => a + BigInt(b.contribution), 0n);
  assert.equal(sum.toString(), "11");
});
