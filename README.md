# 轴对齐矩形并集面积与扫描条带解释后端

TypeScript + Node.js + SQLite（Node 内置 `node:sqlite`，无原生依赖、无外部服务）。
只做 API 与 CLI，不生成网页。Windows 本地直接运行。

## 快速开始

```powershell
npm install        # 安装 typescript 与 @types/node（仅开发依赖）
npm run build      # 编译到 dist/
npm test           # 构建并运行全部测试
npm start          # 启动 API（默认端口 0 = 自动选择空闲端口）
node dist/api.js --port=8080   # 指定端口
npm run demo       # 内置演示：[0,3)x[0,2) 与 [2,5)x[1,3)，并集 11
node dist/cli.js help          # CLI 全部命令
```

数据保存在项目内 `data/rect-union.db`（可用环境变量 `DATA_DIR` 修改），重启后旧版本仍可查询。

## 边界约定与精确范围

- 矩形为半开区域 `[x1,x2) x [y1,y2)`，要求 `x1 < x2` 且 `y1 < y2`；边界相碰不产生额外面积。
- 坐标为整数，接受 JSON 数字或十进制字符串，范围 `±(2^53 - 1)`。
- 所有长度与面积用 BigInt 精确累计，以十进制字符串返回，可表示远超 `Number.MAX_SAFE_INTEGER` 的面积。
- 相同坐标不同编号合法；包含、重复、多重覆盖只计算一次面积。
- 空集合面积为零且没有条带。

## 算法与复杂度

按 x 事件分组排序；相邻事件横坐标之间形成一个条带。同一 x 上的开始/结束事件
成组处理：先结算此前条带，再统一更新活动集合（先删结束、再加开始），因此输入
行序与同坐标事件排序不影响答案。每个条带内对活动矩形的 y 区间排序合并得到覆盖
长度，条带贡献 = 宽度 × 覆盖长度，累计即并集面积。

n 个矩形：事件排序 O(n log n)，最多 2n-1 个条带，每条带重新合并 y 区间 O(n log n)，
总复杂度 O(n² log n)，空间 O(n)。与公开输入上限（数千矩形）相配；不按单位坐标格遍历。

## 报告内容

每个版本的计算报告包含：排序后的事件横坐标 `eventXs`、每个正宽条带的
`x1/x2/width`、活动编号 `activeIds`、合并后不交叠 y 区间 `intervals`、
覆盖长度 `coveredLength`、条带贡献 `contribution` 与累计面积 `cumulative`，
以及 `totalArea`。逐条带贡献之和恒等于总面积（有测试保证）。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/versions` | 导入集合 `{name?, rectangles:[...]}`，计算并保存新版本 |
| GET | `/versions` | 列出全部版本 |
| GET | `/versions/:id/area` | 查询并集面积 |
| GET | `/versions/:id/bands?page=1&pageSize=50` | 分页查询条带解释 |
| GET | `/versions/:id/profile?x=2` | 指定横坐标覆盖剖面（`x == x2` 的矩形按半开约定不活动） |
| POST | `/versions/:id/derive` | `{name?, add:[...], remove:["id"]}` 增删矩形生成新版本并完整重算 |
| GET | `/compare?a=1&b=2` | 比较两个版本（增/删/改与面积差） |
| GET | `/versions/:id/export` | 导出版本（矩形 + 元信息 JSON） |

错误返回 `{"error":{"code","message"}}`，HTTP 状态 400（校验）/404（不存在）。
错误码：`INVALID_JSON`、`INVALID_BODY`、`INVALID_RECT`、`INVALID_ID`、`MISSING_FIELD`、
`INVALID_COORD`、`COORD_OUT_OF_RANGE`、`INVALID_BOUNDS`、`DUPLICATE_ID`、`INVALID_VERSION`、
`NOT_FOUND`、`INTERNAL`。重复编号或非法边界使整批拒绝，且错误信息指出出错编号；
输入失败不会写入数据库，不覆盖既有有效结果。

## CLI

```
node dist/cli.js import <file.json> [name]   # 导入并计算
node dist/cli.js area <versionId>            # 查询面积
node dist/cli.js bands <versionId> [page] [size]  # 文本区间表
node dist/cli.js profile <versionId> <x>     # 覆盖剖面
node dist/cli.js derive <versionId> <ops.json>    # {"add":[...],"remove":["id"]}
node dist/cli.js compare <a> <b>
node dist/cli.js export <versionId>
node dist/cli.js list
node dist/cli.js demo
```

## 持久化与一致性

SQLite 保存不可变输入版本、算法版本（`sweep-x-merge-y/v1`）与完整计算报告；
版本 + 矩形 + 报告在同一事务内原子提交。修改矩形通过 `derive` 生成新版本并完整
重算，不做在线动态结构。

## 测试

`npm test` 覆盖：分离、包含、完全重复、仅边角相触、负坐标、超过安全整数的面积、
空集合、同 x 事件成组、剖面半开约定、校验错误码；随机小坐标与独立单位格集合核对；
大坐标平移不变、整数缩放面积按平方变化、输入重排不变；条带贡献之和等于总面积；
持久化重启可查、失败不覆盖、分页。

## 已知限制

- 算法为每条带独立合并 y 区间，O(n² log n)，适合数千矩形；更大规模可换线段树。
- `node:sqlite` 在 Node 25 仍为实验特性（启动时有 ExperimentalWarning，不影响功能）。
- 仅后端 API/CLI，无网页界面。
