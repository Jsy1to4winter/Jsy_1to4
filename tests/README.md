# 验证

应用本身无 npm 依赖。测试工具安装在仓库之外，避免更改应用依赖与锁文件：

```sh
npm install --prefix /tmp/homepage-validation --cache /tmp/npm-cache --no-audit --no-fund playwright @electric-sql/pglite
curl -fsS 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js' -o /tmp/homepage-validation/supabase.js
```

需要系统 Chromium（默认 `/usr/bin/chromium`，可用 `CHROMIUM` 指定），先在项目目录启动 `python -m http.server 8000 --bind 0.0.0.0`，另一个终端执行：

```sh
node tests/browser.cjs
node tests/rls.cjs
```

`browser.cjs` 使用真实 Supabase SDK、模拟 Auth/PostgREST/Storage HTTP，以及真实浏览器 UI。覆盖存储桶缺失且已有内嵌头像时仍可保存文字、访客锁、管理员登录、完整文字保存、留言增改删及头像上传、相册上传/删除/放大、真实 MP3 解码、上传/保存失败、多设备冲突、新访客读取及退出登录。不会接触真实项目数据。

`rls.cjs` 在 PGlite PostgreSQL 中加载完整 `supabase/setup.sql` 两次，模拟 Supabase 的 Auth/Storage 表和角色。验证公共读取、owner 更新/删除文件、服务端时间戳、匿名和非 owner 无法修改数据库/文件；故意加入旧宽松策略，验证新限制策略仍生效。不是对真实 Supabase 项目策略的审计。

可用 `PLAYWRIGHT_MODULE`、`PGLITE_MODULE`、`SUPABASE_SDK` 环境变量指定测试工具位置。`fixtures/tone.mp3` 是生成的 0.3 秒 440Hz 测试音。
