# Hangman 学校英语教学版（MVP）

## 1. 项目文件结构

```text
31_Hangman/
├─ index.html                     # 主页面（学生/老师/排行榜）
├─ style.css                      # 响应式样式
├─ config.js                      # 前端配置
├─ app.js                         # 游戏逻辑 + 存储抽象 + 服务层
├─ db/
│  └─ schema.sql                  # Neon / Postgres 初始化脚本
├─ netlify.toml                   # Netlify 配置
├─ netlify/
│  └─ functions/
│     └─ sheet-proxy.js           # Netlify Function（纯 Neon）
├─ scripts/
│  └─ import-gas-csv.js           # Google Sheets CSV -> Neon 导入脚本
├─ package.json
└─ package-lock.json
```

## 2. MVP 功能清单

- 学生必须先输入姓名+学号（含学号格式校验）
- 标准 Hangman：字母键盘、错误次数、胜负判定、提示扣分、下一题
- 成绩字段完整记录（时间、单词、分类、难度、错猜次数、提示次数、用时、分数、模式等）
- 本地排行榜（按总分排序）
- 老师模式：导入词库（txt/csv/json）-> 本地草稿预览 -> 删除 -> 去重清洗 -> 发布
- 明确状态区分：
  - `当前词库：本地草稿`
  - `当前词库：在线词库`
  - `当前为离线模式，词库尚未发布`
- `file://` 兼容：
  - 双击 `index.html` 可直接游玩
  - 默认词库可用
  - 成绩本地暂存
  - 词库导入默认本地草稿，不会自动全网同步
- 网络恢复后可手动补传待上传数据
- 本地成绩可导出 CSV

## 3. Google Sheets 导出字段参考

### A. 成绩表（sheet 名：`Scores`）

字段顺序：

1. `timestamp`
2. `studentName`
3. `studentId`
4. `word`
5. `category`
6. `difficulty`
7. `result`
8. `wrongGuesses`
9. `hintsUsed`
10. `durationSeconds`
11. `score`
12. `deviceType`
13. `mode`
14. `uploadStatus`

### B. 在线词库表（sheet 名：`SharedWordBank`）

字段顺序：

1. `publishTime`
2. `teacherName`
3. `wordListName`
4. `category`
5. `difficulty`
6. `word`
7. `meaning`
8. `status`
9. `version`
10. `source`

## 4. Netlify 部署说明

### Netlify Functions + Neon

1. 在 `Neon` 新建一个 Postgres 数据库
2. 打开 Neon SQL Editor，执行 `db/schema.sql`
3. 在 Netlify 环境变量中配置：
   - `DATABASE_URL=你的 Neon 连接串`
4. 部署到 Netlify 后，前端仍然请求 `/api/sheet-proxy`
5. `netlify/functions/sheet-proxy.js` 直接使用 `DATABASE_URL`
6. 如需迁移旧数据，先从 Google Sheets 导出 `Scores`、`SharedWordBank`、`Settings` 为 CSV，再运行导入脚本

说明：

- 前端 `action + payload` 协议保持不变
- `config.js` 中现有 `proxyEndpoint` 可继续使用

### Google Sheets CSV 导入 Neon

先确保当前 shell 或项目根目录 `.env` 中已经有可用的 `DATABASE_URL`。

```bash
$env:DATABASE_URL="你的 Neon 连接串"
node scripts/import-gas-csv.js --scores .\Scores.csv --words .\SharedWordBank.csv --settings .\Settings.csv --reset
```

说明：

- `--reset` 会先清空 `scores / word_list_words / word_lists` 后再导入
- 不带 `--reset` 时，`scores` 会追加导入，词库会按 `wordListName + version` 覆盖更新
- `Settings.csv` 可选，但推荐一起导入，这样当前激活词库和模式也会迁过去

## 5. 推荐的本地测试方式（不部署 Netlify）

### Neon 版本地测试

1. 安装依赖：

```bash
npm install
```

2. 在项目根目录创建 `.env`：

```env
DATABASE_URL=postgresql://<user>:<password>@<host>/<database>?sslmode=require&channel_binding=require
```

3. 保持 `config.js` 的 `proxyEndpoint` 为：
   - `"/api/sheet-proxy"`
4. 在项目目录运行：

```bash
npx netlify dev
```

5. 打开：

```text
http://127.0.0.1:8888
```

说明：

- `netlify dev` 会同时提供静态页面和 Functions
- 这样本地浏览器始终走同源接口，也能直接验证 Neon 数据库逻辑
- 本地 `DATABASE_URL` 推荐放在 `.env`，不要写进 `config.js`
- `.env` 已被 `.gitignore` 忽略，不会被默认提交到仓库

## 6. file:// 本地运行说明

1. 直接双击 `index.html`
2. 可完整游玩：录入学生信息、猜词、计分、老师导入草稿词库
3. 在 `file://` 下远程写入默认降级为本地暂存，并出现提示：
   - “当前为本地模式，成绩已暂存到本机”
   - “当前为离线模式，词库尚未发布”
4. 之后把同一浏览器数据带到在线环境，点击“补传未上传成绩”

## 7. Neon 数据库结构

当前项目已经接入 `Neon/Postgres`，建议表结构如下：

- `scores`
  - 对应原 `Scores`
- `word_lists`
  - 一次发布对应一条词库版本记录
- `word_list_words`
  - 词库下的具体单词
- `app_runtime_settings`
  - 当前激活词库、游戏模式、最大错误次数等全局配置

初始化 SQL 已提供在：

- `db/schema.sql`

当前实现策略：

1. 前端接口不变，仍然通过 `SheetStorage -> ApiClient -> /api/sheet-proxy`
2. Netlify Function 内部根据 `action` 直接执行 SQL
3. 项目现在是纯 `Neon/Postgres` 版本
4. `DATABASE_URL` 未配置时，后端会直接报错，不再回退到 Google Sheets / GAS

## 8. 电脑端与手机端适配测试

1. 电脑浏览器打开，检查主流程与老师流程
2. DevTools 切换手机尺寸（iPhone/Android）测试：
   - 字母键盘触控尺寸
   - 表单可输入
   - 按钮不重叠
   - 表格可横向滚动
3. 真机扫码访问 Netlify 地址做触摸测试

## 9. 常见问题与解决方案

 - 远程一直失败：优先检查 `DATABASE_URL`、Neon 表结构是否已执行、Netlify 环境变量是否生效
- `file://` 下无法发布：属于预期，先本地暂存，在线后补传
- 词库读不到：先确认数据库中已有 `word_lists` / `word_list_words` 数据
- 中文乱码：确保文件为 UTF-8 编码

## 10. 增强版建议清单（下一阶段）

- 在线词库版本回滚（按 `version` 筛选回退）
- 练习/正式模式更细分评分策略
- 音效开关、深浅主题切换
- 公共排行榜（远程聚合）
- 老师后台口令管理
- 自动定时补传（在线后无感上传）
- 导入 CSV 更完整解析（支持引号与转义）
