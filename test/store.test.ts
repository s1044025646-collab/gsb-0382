import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Store } from "../src/store";
import { validateBatch } from "../src/validate";

function tmpDb(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "rectunion-")), "test.db");
}

test("版本提交原子，重启后可查旧版本", () => {
  const db = tmpDb();
  const s1 = new Store(db);
  const setId = s1.createSet("t");
  s1.addVersion(setId, validateBatch([{ id: "a", x1: 0, y1: 0, x2: 3, y2: 2 }]));
  s1.mutate(setId, validateBatch([{ id: "b", x1: 2, y1: 1, x2: 5, y2: 3 }]), []);
  s1.close();

  const s2 = new Store(db);
  const versions = s2.listVersions(setId);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].totalArea, "6");
  assert.equal(versions[1].totalArea, "11");
  assert.equal(s2.getReport(setId, 1).strips.length, 1);
  s2.close();
});

test("输入失败不覆盖既有有效结果", () => {
  const s = new Store(":memory:");
  const setId = s.createSet();
  s.addVersion(setId, validateBatch([{ id: "a", x1: 0, y1: 0, x2: 2, y2: 2 }]));
  assert.throws(() => s.mutate(setId, [], ["ghost"]), /ghost/);
  assert.throws(() =>
    s.mutate(setId, validateBatch([{ id: "a", x1: 0, y1: 0, x2: 9, y2: 9 }]), [])
  );
  const versions = s.listVersions(setId);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].totalArea, "4");
  s.close();
});

test("增删创建新版本，比较给出差异", () => {
  const s = new Store(":memory:");
  const setId = s.createSet();
  s.addVersion(
    setId,
    validateBatch([
      { id: "a", x1: 0, y1: 0, x2: 3, y2: 2 },
      { id: "b", x1: 2, y1: 1, x2: 5, y2: 3 },
    ])
  );
  s.mutate(setId, validateBatch([{ id: "c", x1: 1, y1: 0, x2: 2, y2: 1 }]), []);
  const cmp = s.compare(setId, 1, 2);
  assert.deepEqual(cmp.added, ["c"]);
  assert.deepEqual(cmp.removed, []);
  assert.equal(cmp.areaA, "11");
  assert.equal(cmp.areaB, "11");
  assert.equal(cmp.areaDiff, "0");
  s.mutate(setId, [], ["a"]);
  const cmp2 = s.compare(setId, 2, 3);
  assert.deepEqual(cmp2.removed, ["a"]);
  assert.equal(cmp2.areaB, "7");
  s.close();
});
