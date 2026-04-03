# 🔥 Huo-Launchpad (火·启动台)

Huo-Launchpad 是一款专为 Windows 设计的 **极速、极简、生产级** 应用启动台。它深度复刻了 macOS Launchpad 的丝滑质感，底层由全球最快的文件搜索引擎 **Everything SDK** 驱动，配合 **SQLite** 进行智能排序，旨在终结 Windows 繁琐的应用查找体验。

---

## ✨ 核心特性

- **🚀 零延迟秒搜**: 深度集成 Everything64.dll 原生 SDK，实现全盘百万文件毫秒级检索。
- **🖥️ 10x5 灵动网格**: 经典的 Launchpad 布局，支持空位留白，自由定制你的桌面阵列。
- **🎯 智能权重排序**: 内置 SQLite 数据库，自动学习你的使用习惯，常用应用永远排在搜索首位。
- **🖱️ 交互式拖拽**: 
  - **外部拖入**: 从桌面或文件夹直接将文件/文件夹拖入窗口即可完成固定。
  - **内部排序**: 采用 `dnd-kit` 实现流畅的图标换位，支持完美的“瞬移交换”逻辑。
- **🛡️ 全权限模式**: 
  - 默认请求管理员权限启动，确保全盘索引无死角。
  - **一键提权**: 从启动台开启的应用默认以管理员身份运行。
- **🎨 极致视觉**: 明亮磨砂玻璃 (Frosted Glass) 材质，支持根据壁纸自动产生呼吸感。
- **⌨️ 自定义热键**: 默认为 `Alt + Q`，支持在设置中实时录制并保存你的专属唤起键。

---

## 🛠️ 技术栈 (The Building Blocks)

- **Shell**: [Electron 34](https://www.electronjs.org/)
- **Frontend**: [React 19](https://react.dev/) + [Tailwind CSS v3](https://tailwindcss.com/)
- **Engine**: [Everything SDK](https://www.voidtools.com/support/everything/sdk/) (via [Koffi FFI](https://koffi.dev/))
- **Database**: [SQLite 3](https://sqlite.org/) (via [better-sqlite3](https://github.com/WiseLibs/better-sqlite3))
- **Drag & Drop**: [@dnd-kit](https://dndkit.com/)
- **Icons**: [Lucide React](https://lucide.dev/)

---

## 🚀 快速开始

### 1. 环境准备
确保你的电脑已安装 [Node.js](https://nodejs.org/) (建议 v20+) 和 [pnpm](https://pnpm.io/)。

### 2. 获取代码
```bash
git clone https://github.com/ID-VerNe/huo-launchpad.git
cd huo-launchpad
```

### 3. 初始化积木 (关键步骤)
由于本项目包含原生二进制文件，请执行以下指令进行重铸：
```bash
# 安装依赖
pnpm install

# 为 Electron 重新编译 SQLite 引擎
pnpm rebuild better-sqlite3
```

### 4. 运行与开发
```bash
pnpm dev
```

---

## ⌨️ 默认快捷键

- **唤起/隐藏**: `Alt + Q` (可在设置中修改)
- **选择图标**: `↑ ↓ ← →`
- **启动应用**: `Enter`
- **快速退出**: `ESC`

---

## 📂 目录结构说明

```text
├── resources/
│   └── bin/            # Everything 引擎及 SDK 核心 (Everything.exe, Everything64.dll)
├── src/
│   ├── main/           # 后端积木: 数据库 (db.ts), SDK 映射 (sdk.ts), 进程生命周期 (index.ts)
│   ├── preload/        # 安全桥接: 暴露 IPC 接口给渲染进程
│   └── renderer/       # 前端积木: 采用模块化设计的 React 组件
└── electron-builder.yml # 提权配置与打包规则
```

---

## 🤝 声明

本项目仅供学习与个人效率提升使用。底层搜索能力归 [voidtools Everything](https://www.voidtools.com/) 所有。

**Enjoy your blazing fast launcher!** 🔥
