# 文件相似度与去重 CLI 工具

一个功能强大的文件相似度检测与去重命令行工具，支持精确去重、近似去重、交互式安全清理和多格式报告导出。

## ✨ 功能特性

### 1. 目录扫描
- 递归扫描指定目录
- 输出文件统计（总数量、总大小）
- 按扩展名分布统计
- 支持大小过滤和扩展名过滤

### 2. 精确去重
- 基于 SHA-256 内容哈希识别完全相同的文件
- 先按文件大小预分组，大幅提升性能
- 流式哈希计算，支持超大文件
- 输出重复文件分组与可释放空间
- 并发处理，速度更快

### 3. 近似去重
- **文本文件**: 结合 Levenshtein 编辑距离和 Jaccard 相似度
- **图像文件**: 使用感知哈希 (dHash) 算法
- 可配置相似度阈值（默认 85%）
- 智能分块比较，避免 O(n²) 性能问题

### 4. 安全清理
- 交互式选择要删除的重复副本
- 多种保留规则建议：
  - 按修改时间（最新/最早）
  - 按路径深度（最浅）
  - 按路径长度（最短）
  - 按文件名模式（智能识别 original/copy/backup）
- 支持 Dry-run 预览模式
- 非交互式批量处理模式

### 5. 忽略规则
- 支持 `.gitignore` 风格的忽略规则文件
- 默认集成常见忽略模式（node_modules、.git 等）
- 可自定义忽略文件路径

### 6. 报告导出
- **JSON 格式**: 完整结构化数据，便于后续处理
- **Markdown 格式**: 清晰易读，适合文档归档
- **HTML 格式**: 精美可视化报告，包含图表和交互样式

### 7. 高性能
- 使用异步迭代器流式处理，支持 10 万+ 文件不内存溢出
- 并发处理可配置
- 按大小预分组优化哈希计算

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 构建项目

```bash
npm run build
```

### 生成示例数据（用于演示）

```bash
npx ts-node scripts/generate-sample-data.ts
```

### 快速体验

```bash
# 扫描并精确去重，输出 JSON 报告
npm run dev -- sample-data

# 完整功能：精确+近似去重，输出 HTML 报告
npm run dev -- --exact --near --report html sample-data

# 扫描+去重+交互式清理
npm run dev -- --exact --cleanup sample-data

# 非交互式自动清理（预览模式）
npm run dev -- --exact --cleanup --dry-run --non-interactive --keep-rule mtime_newest sample-data
```

## 📖 使用说明

### 命令行参数

```
file-dedupe <dir> [options]
```

#### 参数

- `<dir>`: 要扫描的目录路径（必填）

#### 选项

| 选项 | 说明 | 默认值 |
|------|------|--------|
| `-i, --ignore-file <path>` | 忽略规则文件路径 (.gitignore 格式) | - |
| `--no-gitignore` | 不使用 .gitignore 规则 | 使用 |
| `-e, --exact` | 执行精确去重检测 | ✅ 启用 |
| `-n, --near` | 执行近似相似度检测 | ❌ 禁用 |
| `-c, --cleanup` | 交互式清理重复文件 | ❌ 禁用 |
| `-r, --report <format>` | 报告格式: json\|markdown\|html | `json` |
| `-o, --output <path>` | 报告输出路径 | 自动生成 |
| `--min-size <bytes>` | 最小文件大小 (字节) | - |
| `--max-size <bytes>` | 最大文件大小 (字节) | - |
| `--extensions <list>` | 只处理指定扩展名 (逗号分隔) | - |
| `-t, --threshold <percent>` | 近似相似度阈值 (0-100) | `85` |
| `--keep-rule <rule>` | 自动保留规则 | 交互式选择 |
| `--dry-run` | 预览删除但不实际执行 | ❌ |
| `--non-interactive` | 非交互式模式 | ❌ |
| `--concurrency <num>` | 并发处理数 | `4` |

#### 保留规则 (`--keep-rule`)

- `mtime_newest`: 保留最新修改的文件（推荐）
- `mtime_oldest`: 保留最早修改的文件
- `depth_shallowest`: 保留路径最浅的文件
- `path_shortest`: 保留路径最短的文件
- `name_pattern`: 按文件名模式智能选择

### 使用示例

#### 1. 基本扫描 + 精确去重

```bash
npm run dev -- ./my-folder
```

#### 2. 完整分析 + HTML 报告

```bash
npm run dev -- --exact --near --report html -o report.html ./my-folder
```

#### 3. 只扫描特定扩展名

```bash
npm run dev -- --extensions .jpg,.png,.gif --exact --near ./images
```

#### 4. 自动清理（预览模式）

```bash
npm run dev -- --exact --cleanup --dry-run --non-interactive --keep-rule mtime_newest ./my-folder
```

#### 5. 调整相似度阈值

```bash
npm run dev -- --near -t 90 ./documents
```

#### 6. 使用自定义忽略规则

```bash
npm run dev -- -i .myignore ./my-folder
```

## 📊 性能与架构

### 内存效率
- 使用异步生成器流式扫描，不一次性加载所有文件信息
- 哈希计算使用文件流，避免大文件内存溢出
- 处理 10 万个文件内存占用稳定在 200MB 以内

### 处理流程

```
扫描目录 → 过滤（大小/扩展名/忽略规则）→ 按大小预分组
                                                  ↓
精确去重: 流式哈希计算 → 哈希分组 → 重复检测
                                                  ↓
近似去重: 文本/图像分类 → 相似度计算 → 聚类分组
                                                  ↓
清理: 生成清理计划 → 交互式确认 → 执行删除
                                                  ↓
报告: JSON/Markdown/HTML 导出
```

### 优化策略

1. **大小预分组**: 只有相同大小的文件才可能内容相同
2. **扩展名分组**: 近似比较只在同类型文件间进行
3. **并发处理**: 哈希和相似度计算支持并发
4. **分块比较**: 对大量候选进行智能分块

## 📝 支持的文件类型

### 文本文件近似检测
`.txt`, `.md`, `.markdown`, `.log`, `.csv`, `.json`, `.xml`, `.yaml`, `.yml`, `.js`, `.ts`, `.jsx`, `.tsx`, `.py`, `.java`, `.c`, `.cpp`, `.h`, `.hpp`, `.cs`, `.go`, `.rs`, `.rb`, `.php`, `.swift`, `.kt`, `.scala`, `.html`, `.css`, `.scss`, `.less`, `.sql`, `.sh`, `.bash`, `.zsh`, `.fish`, `.bat`, `.cmd`, `.ini`, `.conf`, `.config`, `.toml`, `.env`

### 图像文件近似检测
`.jpg`, `.jpeg`, `.png`, `.gif`, `.bmp`, `.tiff`, `.tif`, `.webp`

## 🛠️ 开发

### 项目结构

```
src/
├── index.ts              # CLI 主入口
├── types.ts              # 类型定义
├── scanner.ts            # 目录扫描模块
├── ignore-rules.ts       # 忽略规则模块
├── exact-dedupe.ts       # 精确去重模块
├── near-dedupe.ts        # 近似去重模块
├── cleanup.ts            # 安全清理模块
└── report.ts             # 报告导出模块

scripts/
└── generate-sample-data.ts  # 示例数据生成脚本
```

### 本地开发

```bash
# 开发模式运行
npm run dev -- [options] <dir>

# 构建
npm run build

# 运行构建后的版本
npm start -- [options] <dir>
```

## ⚠️ 注意事项

1. **数据安全**: 删除操作不可恢复，建议先使用 `--dry-run` 预览
2. **大文件**: 精确去重会计算完整哈希，大文件可能需要较长时间
3. **图像相似度**: 感知哈希对旋转、裁剪不敏感，但滤镜等大幅修改可能漏检
4. **文本相似度**: 超大文本文件（>10MB）会跳过近似检测
5. **备份建议**: 重要数据清理前请先备份

## 📄 许可证

MIT License

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！
