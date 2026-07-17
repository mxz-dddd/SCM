# 澄链 SCM 原创 Design Token 基线

本基线由仓库内原创设计语言定义，未从任何目标产品 CSS、截图、品牌资产、图标或插画提取数值。机器实现位置为 `packages/ui/src/tokens.ts`，兼容入口为 `packages/ui/tokens.ts`。

## 设计方向

- 品牌：澄链协作，使用深海蓝结构面与青绿色协作强调色。
- 信息密度：管理端默认 40px 控件，紧凑表格 32px，移动触控最小 48px。
- 表面层级：应用底色、静默区、内容面板、侧栏和侧栏抬升面分层。
- 状态语义：成功、警告、错误、信息均具有独立前景色与浅色背景，不仅依赖颜色表达。
- 动效：120ms 快速反馈、200ms 常规过渡，尊重稳定和可预测的业务操作节奏。

## 令牌域

| 域 | 覆盖内容 |
| --- | --- |
| color | accent、success、warning、danger、info |
| surface / text / border | 页面、面板、侧栏、正文、弱文本、边界 |
| spacing / radius | 4px 基础间距体系、三档圆角与胶囊圆角 |
| font / density | 字体族、字号、字重、紧凑/舒适/触控高度 |
| status | 四类状态背景 |
| shadow / z-index | 浮层、底部导航、焦点环、顶栏与覆盖层 |
| motion | 时长与缓动函数 |

## 接入方式

- `scmAntdTheme` 连接 Ant Design 5 的颜色、字体、圆角和控件高度。
- `applyScmCssVariables` 将同源令牌写入根节点 CSS variables。
- `apps/web/src/app.css` 只引用 `--scm-*` 视觉变量；布局断点和结构尺寸保留在应用样式中。
- token 单元测试校验域完整、Ant Design 映射和 CSS variable 映射一致。

## 人工卡边界

P0-02 继续保持未勾选：本文件只建立原创基线，最终视觉令牌仍需人类证据审查与批准。
