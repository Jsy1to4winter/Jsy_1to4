# 验证

应用无需 npm install；测试工具安装在仓库之外：

```sh
npm install --prefix /tmp/homepage-validation --cache /tmp/npm-cache --no-audit --no-fund playwright @electric-sql/pglite deno
curl -fsS 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js' -o /tmp/homepage-validation/supabase.js
```

浏览器测试需要系统 Chromium（默认 `/usr/bin/chromium`，可用 `CHROMIUM` 指定）。先在项目目录启动静态服务：

```sh
python -m http.server 8000 --bind 0.0.0.0 > /tmp/homepage-http.log 2>&1
```

另一个终端执行：

```sh
node tests/browser.cjs
node tests/children.cjs
node tests/access-function.mjs
node tests/rls.cjs
DENO_DIR=/tmp/homepage-deno /tmp/homepage-validation/node_modules/.bin/deno check supabase/functions/profile-access/index.ts supabase/profile-access-dashboard.ts
```

- `browser.cjs`：真实 SDK 和 Chromium，模拟 Auth/数据库/Storage HTTP；验证原 V19 单主页、缺桶情况下的文字保存、个人资料和板块前言、留言增改删和头像、图片上传/删除/放大、MP3 解码/删除、失败回滚、冲突、新访客读取、只读快照及退出登录。
- `children.cjs`：真实 SDK、Chromium 和实际 Edge Function handler，模拟其 Auth/数据库/Storage；验证主站创建两份子链接、密码一一对应、同浏览器不同链接会话隔离、文字/头像/相册/音乐保存、新访客播放/预览、密码重置后旧会话拒绝、文件和数据保留、子链接快照导出、错误链接不读取主站本地草稿。
- `access-function.mjs`：在 Node 执行实际 handler，覆盖管理员鉴权、错误密码/错误链接、创建重名、输入校验、限流、密码重置、创建失败清理；确认响应不泄漏后端密钥或内部邮箱。
- `rls.cjs`：PGlite PostgreSQL 执行实际完整安装 SQL 及分步迁移并重复执行。验证匿名读取、不同 owner 的数据库和文件隔离、私有目录/RPC 权限、旧宽松策略约束、密码重置后旧 token 无法再写入和新身份可管理原文件。
- `deno check`：检查 CLI 函数入口和网页单文件部署入口的类型及 SDK 导入。

这些测试不会修改真实项目。真实 Supabase SQL 执行、Edge Function 部署和真实账号验收仍需项目所有者完成。

可用 `PLAYWRIGHT_MODULE`、`PGLITE_MODULE`、`SUPABASE_SDK` 指定工具位置。`fixtures/tone.mp3` 是生成的 0.3 秒 440Hz 测试音。

修改后端源码后运行 `python scripts/prepare-deployment.py`，同步生成可粘贴的 `supabase/install.sql` 和 `supabase/profile-access-dashboard.ts`。
