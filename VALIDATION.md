# 交付验证记录

日期：2026-10-16

- Chromium + 真实 Supabase JS SDK + 模拟 HTTP：通过。验证云端初始读取、访客编辑拦截、owner 邮箱密码登录、个人资料/三个板块前言/关于我保存、留言增改删及单条头像上传、相册上传/放大/删除、MP3 解码与删除、数据库保存失败、文件上传拒绝、多设备编辑冲突、新访客读取、只读 HTML 导出、退出登录。最终运行无未处理页面脚本错误。
- PGlite PostgreSQL 执行实际 `supabase/setup.sql`：通过。脚本连续执行两次；匿名公开读取；owner 更新和 Storage 删除；服务端更新时间戳；匿名/非 owner 的数据库及文件写入被拒绝；加入旧宽松策略后新限制策略仍生效。
- 所有 HTML 内联 JavaScript 和 `cloud-sync.js` 的 Node 语法检查：通过。
- 静态服务 `index.html` 和 `cloud-sync.js` HTTP 请求：200。
- `git diff --check`：通过。
- 真实 Supabase 项目：初次只读 REST 请求被运行环境网络代理拒绝（CONNECT 403）；后续排查已匿名读取主页（HTTP 200），并确认 Storage 返回 `Bucket not found`，目标桶尚未建立。数据库内含旧版内嵌头像。未执行真实项目 SQL、未登录真实管理员、未写入真实数据。
- 针对此问题新增回归场景：Storage 桶缺失、数据库已有内嵌头像时，文字保存不触发媒体上传；新增图片失败时保留原头像并显示创建桶的具体说明。
- GitHub Pages：提供部署文件及步骤，未推送或发布网站。

云环境配置草稿已保存启动说明及 `nedsvrzbsrethlyyoqey.supabase.co` 网络域名要求。保存草稿不代表运行时设置已应用或环境已发布；需要在环境设置中审阅、保存并发布。

真实项目上线验收按 README.md 执行。测试无需也不包含 Secret Key 或 service_role Key。
