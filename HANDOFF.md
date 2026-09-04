# 项目交接文档（给 AI Agent / 给未来的自己）

> 本文件是**唯一权威交接文档**。无论谁（人或 AI）接手此项目，请先读本文件再动手。
> 配套速查：`README.md`（用户向教程）、本文件（开发/维护向）。

---

## 0. 一句话项目目标

把「已清除签名校验的 **VMOS Pro 3.0.9**」伪装成一个名叫 **「系统桌面」**、无桌面图标、退出后无痕、只能靠一个**伪装成计算器的启动器**（暗码 `1955` + `=`）打开的应用，全程由 **GitHub Actions 云端编译**，用户只负责上传 APK 与安装。

## 1. 用户原始需求（必须逐条满足）

1. 主 APK（VMOS）：
   - 图标伪装成系统桌面启动器样式；
   - 名称在系统设置/应用列表/屏幕使用时间里显示为「系统桌面」，无“虚拟机/多开/VMOS”字样；
   - 安装后桌面**无图标**、常规手段打不开；
   - 退出（Home/划掉）后最近任务完全无痕；再次打开只能通过计算器 APK；
   - **不要改包名**（避免依赖寻址失败/崩溃）。
2. 计算器 APK：
   - 图标/包名/名称/界面都像普通计算器，能正常运算，保留桌面图标；
   - 输入暗码 `1955` 后按 `=` 自动打开主 APK 主界面；
   - 自身同样从最近任务隐藏。
3. 产物源码 + GitHub Actions 一键编译教程；用户自测，遇到问题要能反馈迭代。

## 2. 最终交付形态（已实现）

| 产物 | 说明 |
|---|---|
| `SystemDesktop.apk` | 修补后的 VMOS。清单手术 + 图标替换 + 重打包（**不重编译 dex/resources.arsc**）。 |
| `Calculator.apk` | 计算器伪装 + 暗码启动 + **守卫宿主**（无障碍监听 + 前台服务 + Dhizuku 挂起）。 |

修补主 APK 的机制（全部二进制级，避免崩溃）：
1. `<application android:label>` 改写为「系统桌面」（原始字符串）；
2. 摘除 launcher Activity 的 MAIN/LAUNCHER intent-filter（桌面无入口），入口仍 `exported=true` 可被显式启动；
3. 全部 193 个 `<activity>` 增加 `android:excludeFromRecents="true"`；
4. 全部 193 个 `<activity>` 增加 `android:noHistory="true"`（**回桌面即结束界面**——本 ROM 上 exclude 对老 targetSdk 应用不生效，改用 noHistory 清任务）；
5. 图标 PNG 全部替换成“渐变底 + 白色应用宫格”的桌面样式；
6. `resources.arsc / classes.dex / .so` 逐字节保留。

守卫（解决「exclude/noHistory 后 ROM 仍显示冻结卡片 / 应用自复活」）：
- **无障碍服务**（常驻、防杀、无通知）监听前台窗口；
- 检测到 `com.vmos.pro` 离开前台 → 1.8s 后调用 **Dhizuku（设备所有者）** 的 `DevicePolicyManager.setPackagesSuspended` 把 VMOS 整体**挂起**（任务/进程即刻消失，无法自启）；
- 计算器暗码先解挂再启动（冷启动几秒是预期）。

## 3. 目标设备事实（踩坑结论，改之前必读）

- 设备：联想小新平板 Pro 13（TB376FC），**Android 16 (SDK 36)**，ZUI ROM，默认桌面混用 ZUI 与 Microsoft Launcher。
- 特权：**Dhizuku = 设备所有者**（稳定、后台不被杀）；Shizuku = adb 权限（后台易被杀，不用于常驻）。
- **VMOS targetSdk=30、会自建多任务、自带保活** —— 因此：
  - `excludeFromRecents`（无论清单属性还是启动标志）对它的最近任务**无效**（计算器 targetSdk 35 正常有效）；
  - 只有「挂起」能物理清掉任务/进程；
  - ROM 会在 Home 瞬间截图，即使任务已死，最近任务仍可能短暂显示一张**冻结缩略图**（SystemUI 快照缓存，非活任务；划掉即清；每次使用后可能再现一次）——**已知系统级残留，无法根治，接受**。
- 安装包内 `keys/release.jks` 为固定签名密钥（口令 `vmos-hider-2024`，别名 `vmos`），必须保留才能覆盖升级。

## 4. 仓库结构

```
vmos-hider/
├── .github/workflows/build.yml    # 一键编译（修补主APK + 编译计算器 + 签名 + 上传产物）
├── README.md                      # 用户向教程（建仓/上传/编译/安装/FAQ）
├── HANDOFF.md                     # 本文档
├── inputs/                        # 可选：原版 APK（推荐放 Release(标签 original)）
├── keys/                          # 固定签名密钥 release.jks + 说明
├── lib/
│   ├── axml.mjs                   # AXML 二进制解析/编码
│   ├── axml_patch_core.mjs        # 清单手术核心（label/去LAUNCHER/exclude/noHistory）
│   ├── art.mjs                    # “系统桌面”图标生成器（纯数学光栅化）
│   └── png.mjs                    # 纯 Node PNG 编码器
├── scripts/
│   ├── repack.mjs                 # 主入口：读取原版 APK → 修补 → 重打包
│   └── patch_manifest.mjs         # 清单手术 CLI
├── tools/axml_dump.mjs            # 清单查看/自检工具（CI 也用）
└── app-calculator/                # 计算器+守卫 完整 Android 工程（无第三方 UI 依赖）
    └── app/src/main/
        ├── AndroidManifest.xml
        ├── java/com/lenovo/calculator2/
        │   ├── MainActivity.java          # 计算器 + 暗码(1955=) 启动
        │   ├── Guardian.java              # Dhizuku 挂起/解挂（owner DPM 反射包装）
        │   ├── CalcAccessibilityService.java  # 前台窗口监听 → 离开即挂起
        │   └── GuardForegroundService.java    # 前台常驻（让设置出现“允许后台运行”）
        └── res/…
```

## 5. 构建 / 修改流程

### 云端构建（用户实际使用的路径）
1. 仓库 `Release` 标签 **`original`** 上放原版 APK（工作流自动下载；也可放 `inputs/vmos-original.apk`）。
2. `Actions → Build → Run workflow`，参数：`label`（默认 系统桌面）、`calc_pkg`（默认 com.lenovo.calculator2）、`calc_name`（默认 计算器）、`main_smoke`（冒烟：保留桌面图标便于直接验证）。
3. 产物在 Artifacts `hidden-apks`（SystemDesktop.apk + Calculator.apk）。

### ⚠️ 关键限制：`.github/workflows/build.yml` 只能用真实 git 提交或 GitHub 网页编辑器修改
GitHub 的 Contents/Trees **API 一律拒绝**写入 `.github/workflows/*`（本仓库源码上传、日常文件更新都走 Contents API）。**改工作流 = 让用户网页操作**，或让用户用 git。改其它任何文件可用 API。

### 本地验证（无 Java 也能跑）
```bash
node scripts/repack.mjs 原版.apk out.apk --label 系统桌面   # 修补主APK
node tools/axml_dump.mjs AndroidManifest.xml                # 检查清单
```
工作流里自带“自检”步骤（校验 exclude/noHistory 数量、LAUNCHER 清零、label）。

## 6. 安装与使用（用户侧最终版）

1. 先装 `SystemDesktop.apk`，再装 `Calculator.apk`（覆盖升级都行，密钥固定）。
2. 打开一次计算器 → 允许通知权限 + Dhizuku 授权弹窗；在 **Dhizuku App** 里确认计算器已授权。
3. 设置 → 无障碍 → 开启「计算器」的无障碍服务。
4. 设置 → 应用 → 计算器 → 电池/后台 → **允许后台运行/无限制**（守护有前台服务，设置里会出现该入口）。
5. 日常：打开 = 计算器按 `1 9 5 5` 再按 `=`；退出 = 直接 Home（守护自动挂起清理，冷启动重进属预期）。

## 7. 已知问题 / 边界（如实告知用户与后续维护者）

- **进程无法真正“隐藏”**：无 root 做不到；当前用「挂起」实现等效效果（冻结→不可见→无法自启）。
- **冻结缩略图残留**：Home 瞬间 ROM 截图，任务死后可能仍在最近任务显示一次（非活窗口，划掉即清；无法根治）。
- **每次进入都是冷启动**（noHistory + 挂起），约几秒。
- 若在设置里把 SystemDesktop **强行停止**，暗码打不开属正常（挂起解挂流程会重建）；不要手动强停。
- 升级 targetSdk（>30）可以试，但会破坏 VMOS 的旧存储/权限行为，**默认不动**。
- 计算器在无障碍列表里可见（宿主承担守卫功能），属可接受权衡。

## 8. 常见修改点速查（给接手 AI）

| 想改什么 | 改哪里 |
|---|---|
| 主APK 显示名 | `scripts/repack.mjs --label 新名字` 或 workflow 参数 `label` |
| 伪装图标 | `lib/art.mjs`（颜色/图形） |
| 是否留桌面入口（冒烟） | `--keep-launcher` / workflow `main_smoke` |
| 是否加 noHistory | `lib/axml_patch_core.mjs` 的 `addNoHistory` 默认值（当前 true） |
| 暗码数字 | `MainActivity.java` 里 `SECRET = "1955"` |
| 守护目标包名 | `Guardian.java` 里 `TARGET_PKG`（当前 com.vmos.pro） |
| 挂起延迟 | `CalcAccessibilityService.java` 的 `1800`ms |
| 计算器包名/显示名 | workflow 参数 `calc_pkg` / `calc_name`（AGP `-P` 注入） |
| 签名 | `keys/release.jks`（口令 vmos-hider-2024，别改，改了无法覆盖升级） |

## 9. 给其他 AI Agent 的任务示例

“项目在 github.com/uo54/vmos-hider，先读 HANDOFF.md 和 README.md。请把 XXXX 改成 YYYY：涉及文件 A、B；不要改 .github/workflows（要用网页改）；改完用 Contents API（token 见对话）推回 main 触发 Actions；产物在 Actions Artifacts 里。注意：别动 dex、别动 keys/release.jks、别升级 targetSdk。验证口径：自检步骤与安装实测（无痕=Home 后最近任务干净；冻结缩略图残留为 ROM 已知项可忽略）。”
