# 交付验证记录

日期：2026-10-16。本版在 V19 上加入独立子链接和密码编辑权限。

## 已完成的本地验证

- 原主页 Chromium 回归：通过。真实 Supabase SDK，模拟网络服务；文字、关于我、板块前言、留言及头像、相册上传/删除/预览、MP3 解码/删除、失败回滚、编辑冲突、新访客、导出快照和退出登录。
- 多子链接 Chromium：通过。真实 SDK + 实际 Edge Function handler + 模拟 Auth/数据库/Storage；主站创建两份资料、对应密码、同浏览器会话隔离、独立文字和文件上传、公开阅读/播放、重置密码、旧会话失去写权限、原资料和文件保留。
- 权限 SQL：通过。在 PGlite PostgreSQL 执行实际 `setup.sql`、`multi-profile.sql` 和合并后的 `install.sql`，重复安装；验证跨链接数据和文件写入被拒、私有身份目录和后台 RPC 不公开、限流以及重置后的身份隔离，即使存在旧宽松策略仍生效。
- Edge handler 单元测试：通过。覆盖密码登录、管理员管理接口、错误链接密码、限流、参数校验、重置及失败清理。
- Deno：CLI 入口和网页单文件入口均通过严格类型检查与依赖解析；本地 Deno HTTP 服务已启动验证，GET 405、OPTIONS 204、不支持的操作 400。
- HTML 内联脚本、前端 JS：语法检查通过。静态 HTTP 服务运行正常。

## 尚未由本任务执行的外部步骤

- 未在真实 Supabase 执行本版 `install.sql`，未部署远程 `profile-access` 函数。环境没有提供 Supabase 管理授权；本地测试不代表真实项目已经升级。
- 原项目先前只读排查成功过（HTTP 200），并曾确认缺少 `homepage-media` 桶（`Bucket not found`）。这不是本版后台已安装的证据。
- 未确认 GitHub Pages 发布状态；实际站点访问及 Pages API 检查被当前网络环境拒绝。代码推送不代表 Pages 已经部署成功。
- 未登录、创建或修改真实使用者账号及资料；未向任何人发送链接或密码。

## 上线验收

1. 按 README 在 SQL Editor 执行完整安装 SQL，并部署 `profile-access` 函数，关闭函数网关 JWT 校验。
2. 主站管理员新建两份子链接，分别用对应密码登录，确认交叉密码不能解锁。
3. 各自编辑文字、留言并上传图片及 MP3。用另一个设备/无痕浏览器确认可读、可预览和播放。
4. 重置其中一个密码，确认旧密码和已登录旧会话无法再保存或上传，但原资料及文件仍可公开浏览。
5. 用匿名及另一份资料的账号直接测试数据库和 Storage 写操作，确认被拒绝。不要仅凭按钮隐藏判断权限安全。

前端仅含 Publishable Key；后端依赖平台注入的服务密钥，未将 Secret Key、service_role Key 或任何实际密码写入公开文件。

## GitHub Pages 发布工作流

新增 `.github/workflows/pages.yml`：支持 main 推送和手动运行，仅打包 index.html、cloud-sync.js、profile-access.js。需要在仓库 Settings → Pages 将 Source 切换为 GitHub Actions；实际线上部署结果仍需在 Actions 中确认。
