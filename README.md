# 轴对齐矩形并集面积与扫描条带解释后端

纯后端项目（TypeScript + Node.js + SQLite），只提供 HTTP API 与 CLI，不生成网页。
计算一组轴对齐矩形（左闭右开 `[x1,x2) × [y1,y2)`）的并集面积，并解释按横坐标扫描产生的每个条带。

## 运行环境

- Windows 本地，Node.js ≥ 22（使用内置 `node:sqlite`，无需 Docker / WSL / 外部服务 / 原生编译依赖）
- 依赖仅 `typescript` 与 `@types/node`（开发依赖）

## 快速开始

```powershell
npm install
npm run build     # 编译 TypeScript 到 dist/
npm test          # 构建并运行全部测试
npm start         # 启动 HTTP API（默认端口 0：自动选择空闲端口）
npm run demo      # 内置演示：两个 6 面积矩形交叠 1，并集 11；再加被覆盖小矩形面积不变
```

CLI 也可直接使用：`node dist/src/cli.js <命令>`，先执行 `node dist/src/cli.js help` 查看全部命令。

## 边界约定与精确范围

- 矩形为半开区间 `[x1,x2) × [y1,y2)`，要求 `x1 < x2`、`y1 < y2`；边界相碰（共边或共角）不产生额外面积。
- 坐标为整数，范围 `±(2^53 - 1)`（Number.MAX_SAFE_INTEGER）。JSON 中可写 number 或十进制字符串。
- 宽度最大约 `2^54`，面积最大约 `2^108`，全部用 **BigInt** 精确累计，以十进制字符串返回。
- 相同坐标、不同编号的矩形合法；同一集合内编号必须唯一，重复编号或非法边界使**整批拒绝**。

## 算法说明

自行实现的扫描线（`src/geometry.ts`，算法版本 `sweep-x/merge-y-v1`）：

1. 收集所有矩形的 `x1`（开始）与 `x2`（结束）为事件横坐标，排序去重。
2. 同一横坐标上的开始/结束事件**成组处理**：先结算上一条带 `[prevX, x)`，再同时移除结束者、加入开始者。因此输入行序与同坐标事件排序不影响答案。
3. 每个正宽条带内，把活动矩形的 y 区间排序合并为不交叠区间，覆盖长度 = 合并后区间长度之和（**不是**活动矩形高度简单相加，也不用总包围盒代替）。
4. 条带贡献 = 宽度 × 覆盖长度，BigInt 累计。包含、完全重复、多重覆盖均只算一次。

复杂度：设矩形数 `n`，事件数 ≤ `2n`。每个条带对活动 y 区间排序合并，整体约 `O(n^2 log n)` 最坏情况（每个事件处理全部矩形），实际远小于此；空间 `O(n)`。不按单位坐标格遍历，坐标跨度可以很大。

报告包含：排序后的事件位置、每个正宽条带的活动编号、合并后的不交叠 y 区间、覆盖长度、条带贡献与累计面积。所有条带贡献之和恒等于总面积（有测试保证）。

## HTTP API

启动：`node dist/src/cli.js serve [--port N] [--db 路径]`。端口默认 `0`（自动选空闲端口），也可用环境变量 `PORT`。数据库默认在项目内 `data/rectunion.db`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| POST | `/sets` | 导入集合 `{name?, rectangles:[...]}`，创建集合并计算版本 1 |
| GET | `/sets/:id/versions` | 列出版本 |
| POST | `/sets/:id/versions` | 增删创建新版本 `{add:[...], remove:["id",...]}` |
| GET | `/sets/:id/versions/:v/area` | 并集面积（十进制字符串） |
| GET | `/sets/:id/versions/:v/rectangles` | 该版本矩形快照 |
| GET | `/sets/:id/versions/:v/strips?offset=&limit=` | 条带解释（分页） |
| GET | `/sets/:id/versions/:v/profile?x=` | 横坐标 x 处覆盖剖面 |
| GET | `/sets/:id/versions/:v/report` | 导出完整报告 JSON |
| GET | `/sets/:id/compare?a=1&b=2` | 比较两个版本（增/删/改与面积差） |

剖面遵守半开约定：矩形满足 `x1 <= x < x2` 才算活动，处于右边界的矩形不算活动。

### 错误码

错误响应为 `{"error": {"code", "message", "details"}}`，message 中指出出错编号：

- `E_DUP_ID` 编号重复；`E_BAD_BOUND` 边界不满足 `x1<x2 / y1<y2`
- `E_BAD_COORD` 坐标非整数或超出 `±(2^53-1)`；`E_MISSING_FIELD` 缺字段
- `E_BAD_ID` / `E_BAD_SHAPE` / `E_BAD_JSON` / `E_BAD_PARAM` 参数形态错误
- `E_NOT_FOUND` 集合/版本/编号不存在（HTTP 404，其余校验错误为 400）

## CLI

```
node dist/src/cli.js import rects.json [--name 名]   # 导入并计算
node dist/src/cli.js area <setId> [version]          # 面积
node dist/src/cli.js strips <setId> [version]        # 文本区间表展示条带
node dist/src/cli.js profile <setId> [version] <x>   # 剖面
node dist/src/cli.js add <setId> new.json            # 新增矩形 -> 新版本
node dist/src/cli.js remove <setId> <id...>          # 删除矩形 -> 新版本
node dist/src/cli.js compare <setId> <a> <b>         # 版本比较
node dist/src/cli.js export <setId> [version] [文件] # 导出报告
node dist/src/cli.js demo                            # 演示
```

输入 JSON 格式：`{"rectangles": [{"id": "r1", "x1": 0, "y1": 0, "x2": 3, "y2": 2}]}`。

## 持久化与一致性

- SQLite 保存不可变的输入版本（矩形快照）、算法版本与完整计算报告。
- 版本 + 快照 + 报告在**同一事务**中原子提交；输入校验失败不会产生新版本，也不覆盖既有有效结果。
- 修改矩形通过增删产生新版本并完整重算，不做在线动态结构；重启后旧版本可查。

## 测试

`npm test` 覆盖：分离、包含、完全重复、仅边/角相触、负坐标、超过 `2^53` 的面积（BigInt）、
空集合、同坐标事件分组与行序无关、多重覆盖移除、剖面半开约定；
小整数坐标与独立单位格集合逐一核对（200 组随机）；
大坐标平移不变、整数缩放面积按平方变化、输入重排不变；
条带贡献之和等于报告总面积；版本原子提交、重启后可查、失败不覆盖既有结果；API 全流程与错误码。

## 目录结构

```
src/types.ts      类型与 ApiError
src/validate.ts   参数校验（错误码、指出出错编号）
src/geometry.ts   扫描线核心：事件分组、条带、y 区间合并、剖面
src/store.ts      SQLite 持久化：版本/快照/报告，原子提交
src/server.ts     HTTP API（node:http，无外部框架）
src/cli.ts        命令行入口
test/             node:test 测试
data/             默认数据目录（SQLite 文件）
```

## 范围与限制

- 只计算并集面积与扫描条带解释；不求周长、最少覆盖、任意多边形布尔运算或三维体积，不提供网页。
- 坐标限制在安全整数范围 `±(2^53-1)`（面积本身用 BigInt，无此限制）。
- 修改矩形即完整重算，未实现增量在线结构；条带解释全量存储于报告中，查询时分页。
- `node:sqlite` 在 Node 25 仍标记 experimental，但功能稳定可用；如需彻底消除警告可换 `better-sqlite3`（需原生编译）。
