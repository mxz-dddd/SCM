SCM 同类系统图源包 v0.1

内容
1. diagrams/*.dot  - Graphviz 可编辑源文件（架构图、流程图、状态机、类图）
2. diagrams/*.svg  - 矢量图，可在 draw.io、Figma、Illustrator 或 Inkscape 中继续编辑
3. diagrams/*.png  - 文档中使用的预览图
4. SCM_系统模型与流程图_Mermaid源文件_v0.1.md - 核心模型的 Mermaid 版本
5. create_blueprint.py - 完整生成脚本，包含 241 项功能规格、图表数据与 DOCX 组装逻辑

说明
- 本包是基于公开资料形成的 clean-room 建议模型，不是目标平台的源码、数据库结构或内部设计。
- A=公开证据确认；B=领域增强；C=建议实现。精确菜单、字段、按钮和权限需在获得合法授权的只读演示环境后核验。
- 运行脚本需要 Python、python-docx、Pillow、matplotlib、Graphviz 与 Noto CJK 字体环境。
