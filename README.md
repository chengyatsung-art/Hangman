# Hangman 学校英语教学版（MVP）

## 1. 项目文件结构

```text
31_Hangman/
├─ index.html                     # 主页面（学生/老师/排行榜）
├─ style.css                      # 响应式样式
├─ config.js                      # 前端配置（直连/代理/GAS URL）
├─ app.js                         # 游戏逻辑 + 存储抽象 + 服务层
├─ words.json                     # 示例词库文件（可导入）
├─ netlify.toml                   # Netlify 配置
├─ netlify/
│  └─ functions/
│     └─ sheet-proxy.js           # 模式 B: Netlify Function 代理
└─ apps-script/
   └─ Code.gs                     # Google Apps Script 后端示例
```

## 2. MVP 功能清单

- 学生必须先输入姓名+学号（含学号格式校验）
- 标准 Hangman：字母键盘、错误次数、胜负判定、提示扣分、下一题
- 成绩字段完整记录（时间、单词、分类、难度、错猜次数、提示次数、用时、分数、模式等）
- 本地排行榜（按总分排序）
- 老师模式：导入词库（txt/csv/json）-> 本地草稿预览 -> 删除 -> 去重清洗 -> 发布
- 明确状态区分：
  - `当前词库：本地草稿`
  - `当前词库：已发布公共词库`
  - `当前为离线模式，词库尚未发布`
- `file://` 兼容：
  - 双击 `index.html` 可直接游玩
  - 默认词库可用
  - 成绩本地暂存
  - 词库导入默认本地草稿，不会自动全网同步
- 网络恢复后可手动补传待上传数据
- 本地成绩可导出 CSV

## 3. Google Sheets 字段设计

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

### B. 公共词库表（sheet 名：`SharedWordBank`）

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

## 4. Google Apps Script 接入说明

1. 新建 Google Sheet，记下 `SPREADSHEET_ID`
2. 打开 Apps Script，粘贴 `apps-script/Code.gs`
3. 在 Script Properties 增加：
   - `SPREADSHEET_ID=你的表格ID`
4. 部署为 Web App：
   - Execute as: Me
   - Who has access: Anyone with the link
5. 得到 Web App URL，填到 `config.js` 的 `gasWebAppUrl`

### doPost 支持 action

- `saveScore`
- `publishWordList`
- `loadSharedWordList`

## 5. Netlify 部署说明

### 模式 A：纯静态直连 GAS

不推荐作为主方案。浏览器直连 Google Apps Script 时，可能因为 CORS / OPTIONS 预检失败而回退到本地默认词库。

1. `config.js`：
   - `apiMode: "direct"`
   - `gasWebAppUrl: "https://script.google.com/macros/s/xxx/exec"`
2. 将整个目录部署到 Netlify（拖拽或 Git）

### 模式 B：Netlify Function 代理

1. `config.js`：
   - `apiMode: "proxy"`
2. Netlify 环境变量设置：
   - `GAS_WEB_APP_URL=https://script.google.com/macros/s/xxx/exec`
3. 已提供 `netlify/functions/sheet-proxy.js` 与 `netlify.toml`
4. 前端会请求 `/api/sheet-proxy`，再由 Netlify 转发到 `/.netlify/functions/sheet-proxy`

## 6.1 推荐的本地测试方式（不部署 Netlify）

1. 保持 `config.js` 为：
   - `apiMode: "proxy"`
   - `proxyEndpoint: "/api/sheet-proxy"`
2. 在项目目录运行：

```bash
node local-server.js
```

3. 打开：

```text
http://127.0.0.1:8000
```

说明：

- `local-server.js` 会同时提供静态页面和本地代理
- 本地代理会把 `/api/sheet-proxy` 转发到 `config.js` 中的 `gasWebAppUrl`
- 这样本地浏览器始终走同源接口，不依赖 Netlify，也不会触发直连 GAS 的浏览器跨域问题

## 6. file:// 本地运行说明

1. 直接双击 `index.html`
2. 可完整游玩：录入学生信息、猜词、计分、老师导入草稿词库
3. 在 `file://` 下远程写入默认降级为本地暂存，并出现提示：
   - “当前为本地模式，成绩已暂存到本机”
   - “当前为离线模式，词库尚未发布”
4. 之后把同一浏览器数据带到在线环境，点击“补传未上传成绩”

## 7. 后期迁移数据库方案

当前代码已做存储抽象，核心接口在 `app.js`：

- `StorageAdapter`
- `SheetStorage`
- `LocalStorageFallback`
- `ScoreService`
- `WordBankService`
- `ApiClient`

迁移步骤：

1. 新增适配器，如 `SupabaseStorage` / `PostgresStorage` / `MySQLStorage` / `FirebaseStorage`
2. 让新适配器实现与 `StorageAdapter` 同名方法：
   - `saveScore`
   - `saveGameRecord`
   - `loadSharedWordList`
   - `publishWordList`
   - `saveLocalWordList`
   - `loadLocalWordList`
   - `retryPending`
3. 初始化时把 `const storage = new SheetStorage(...)` 换成新适配器实例
4. `ScoreService` / `WordBankService` / 页面逻辑无需改动

## 8. 电脑端与手机端适配测试

1. 电脑浏览器打开，检查主流程与老师流程
2. DevTools 切换手机尺寸（iPhone/Android）测试：
   - 字母键盘触控尺寸
   - 表单可输入
   - 按钮不重叠
   - 表格可横向滚动
3. 真机扫码访问 Netlify 地址做触摸测试

## 9. 常见问题与解决方案

- 远程一直失败：检查 `config.js` 的 `gasWebAppUrl`、GAS 部署权限、CORS
- `file://` 下无法发布：属于预期，先本地暂存，在线后补传
- 词库读不到：先确认 GAS `loadSharedWordList` 返回结构 `data.words`
- 中文乱码：确保文件为 UTF-8 编码

## 10. 增强版建议清单（下一阶段）

- 公共词库版本回滚（按 `version` 筛选回退）
- 练习/正式模式更细分评分策略
- 音效开关、深浅主题切换
- 公共排行榜（远程聚合）
- 老师后台口令管理
- 自动定时补传（在线后无感上传）
- 导入 CSV 更完整解析（支持引号与转义）
