# 本地MVP

项目专用的轻量运行模块，复用AIHOT读取与提取能力，用本机文件连接真实采集和试读页。它不注册到原AI行业worker，不创建应用数据库，不对外发布全文。使用方式、验证与限制见[自动更新](../../docs/自动更新.md)。

- `collect.ts`：读取7个公开来源，检查日期、保存正文与状态。
- `store.ts`：规范化网址、保存快照、单次更新互斥。
- `publish.ts`：核对Agent整理的正文版本，生成展示快照，合并原48篇。
- `service.ts`：本地服务中的每2小时检查；不是电脑关闭后仍工作的云任务。
- `scripts/run.ts`：单次完整运行或只应用整理。
- `tests/pipeline.standalone.test.ts`：不联网、不用数据库的行为测试。

测试：`node --test-isolation=none --test modules/local-mvp/tests/pipeline.standalone.test.ts industry/curation.test.ts`。

英文整理暂由Agent完成；不得把当前流程描述为独立模型API已接通。不得将新增Agent判断写入用户正式标记；生产化时接回框架统一发布层。
