# 本地 Google Sheets 模板

这两个 CSV 文件可先在本地准备表结构，再导入 Google Sheets：

- `Scores.csv` 对应成绩表（sheet 名建议：`Scores`）
- `SharedWordBank.csv` 对应公共词库表（sheet 名建议：`SharedWordBank`）

## 导入步骤

1. 新建一个 Google 表格
2. 先导入 `Scores.csv`（导入到新工作表）
3. 再导入 `SharedWordBank.csv`（导入到新工作表）
4. 把两个工作表重命名为：
   - `Scores`
   - `SharedWordBank`
5. 复制该表格 ID，填入 Apps Script 的 `SPREADSHEET_ID`
