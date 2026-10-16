# V19 个人主页 · 独立子链接版

基于原 V19 保留页面布局、视觉风格、播放器、图片放大、个人资料和留言管理。新增每人专属链接与独立密码：任何人可浏览，持有对应密码的人可编辑该份文字并上传图片、相册、头像和 MP3。各份资料互不覆盖。

## 已有用户升级：需要更新 Supabase 吗？

**需要做一次后台升级，但不用把 HTML、图片、音乐重新上传到 Supabase。**

- GitHub Pages 放网页文件。本版需要一起更新 `index.html`、`cloud-sync.js`、`profile-access.js`、`supabase-config.js` 和整个 `vendor` 目录。内置 Pages 工作流会自动复制这些文件。
- Supabase 执行一次 `supabase/install.sql`，再部署 `profile-access` Edge Function。
- 原 `fuguang` 主页、管理员账号和现有文件保留。使用者以后在网页内上传文件，无需自行操作 Supabase。

## 第一步：执行完整 SQL

1. 先备份现有 `homepage_profiles` 和相关策略。
2. 在 Supabase SQL Editor → New query 中粘贴 **`supabase/install.sql` 全部内容**，点击 Run。
3. 已有 `slug=fuguang` 且 `owner_id` 正确时无需改管理员邮箱；只有新项目没有此记录时，才把 `YOUR_ADMIN_EMAIL` 换成已有 Auth 管理员邮箱。不是密码。
4. 到 Storage 确认出现公共桶 `homepage-media`。只有要公开展示的文件才应上传到此桶。

`install.sql` 合并了 `setup.sql`、`multi-profile.sql` 和删除功能迁移 `delete-profile.sql`，可以重复执行，不清空原数据。已经安装过多子链接版的项目，新增删除功能只需执行 `delete-profile.sql`，然后更新下方 Edge Function；重新执行完整 `install.sql` 也会保留现有资料。若旧表缺少 `owner_id`、`slug` 唯一约束等，应先核对原表结构；不要删除旧表来解决报错。

## 第二步：部署密码验证服务（必需）

普通使用者只输入子链接密码，不需要注册或填写邮箱。密码通过服务端验证；前端没有 Secret Key 或 service_role Key。

### 在 Supabase 网页操作

1. 打开 **Edge Functions**，选择创建/部署新函数（使用网页编辑器）。
2. 函数名称填写 **`profile-access`**，入口文件使用 `index.ts`。
3. 将 **`supabase/profile-access-dashboard.ts` 的全部内容**复制到入口文件，覆盖编辑器示例代码，然后部署。
4. 在函数设置中将 **Verify JWT / Verify JWT with legacy secret** 关闭。本函数的密码解锁入口在登录前调用；管理员创建、列表和重置操作仍在函数内部使用 Auth 验证 Bearer Token，并检查私有管理员表。
5. 不要把 service_role Key 粘贴进 HTML，也不要发送到聊天。函数直接读取 Supabase 平台提供的 `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY` 后端环境变量。

### 或使用 Supabase CLI

在仓库根目录执行（由你在自己的终端完成项目授权）：

```sh
supabase login
supabase link --project-ref nedsvrzbsrethlyyoqey
supabase functions deploy profile-access --no-verify-jwt
```

部署成功后，再使用主站“分发专属子链接”。如果提示服务尚未配置，请检查函数名称、JWT 设置、SQL 是否执行成功，并查看函数日志。

## 第三步：GitHub Pages

将本项目更新到仓库 `main`。在 GitHub Settings → Pages → Build and deployment 中，将 Source 选择为 **GitHub Actions**。仓库已包含 `.github/workflows/pages.yml`，仅发布网页、配置与本地 SDK，不发布后台安装脚本。无需 npm install 或构建。

进入 Actions → **Deploy homepage to GitHub Pages**，点击 **Run workflow**，选择 `main` 并运行。以后每次推送 `main` 会自动发布；首次切换发布来源后请手动运行一次。绿色成功后可在部署输出或 Settings → Pages 查看正式地址。

主站地址形如：

```text
https://你的用户名.github.io/仓库名/
```

子链接形如：

```text
https://你的用户名.github.io/仓库名/?profile=p_某个独立编号
```

使用相对文件路径，因此也支持 Pages 的仓库子目录。不要把密码拼进 URL。

## 如何分发和管理

1. 在没有 `?profile=` 参数的主站，用原管理员邮箱和密码登录。
2. 点击“编辑主页”→“分发专属子链接”。
3. 使用自动生成的编号与强密码，点击“创建子链接”。每份新资料从空白模板开始，不复制主站私人草稿、留言或媒体。
4. 复制生成的链接与密码，交给对应的人，并自行妥善保管。这里不会保存可供查询的明文密码。
5. 使用者打开子链接，点击锁或“编辑主页”，只输入对应密码即可编辑文字、留言，上传图片和音乐；其他人打开此链接只能浏览。
6. 持有人保存后，新访客会直接读取无缓存的公开云端资料；刷新、返回页面或从后台恢复（且未打开编辑窗口）时也会刷新。读取失败会持续显示原因和“重新读取”按钮，不会把加载失败误报成空白资料。
7. 密码忘记或需要撤销旧编辑权限时，在主站管理列表点击“重置密码”。资料和文件保留，旧密码及旧会话立即失去写入权限。请重新分发新密码。

### 删除子链接

主站登录 → 编辑主页 → 分发专属子链接 → 对应条目旁的“删除子链接”。确认前会显示编号及永久清空提示。

删除会先停用链接，使公开读取、旧密码及已登录会话都失效；再删除该编号目录中的图片、音乐和未引用文件，清空文字与留言。其他子链接和主站不会受影响。为避免旧分享链接被分配给另一个人，系统保留最小停用记录和被禁用的身份，编号不再复用。

如果文件清理遇到网络问题，链接仍保持停用，管理列表会提供“重试清理”。公共 CDN/浏览器已经缓存的文件可能仍暂时存在于缓存中。

**已有多子链接版的升级顺序：**先在 SQL Editor 执行 `supabase/delete-profile.sql`，再将 Edge Function 替换为最新版 `supabase/profile-access-dashboard.ts`。在升级后台前，公开读取和音乐的前端修复可先随 Pages 发布生效，但删除入口暂不能使用。

每个子链接使用独立的浏览器登录存储，避免同一设备打开多个子链接时串号。拥有密码就拥有该份资料的编辑权；不要把密码交给仅需浏览的人。

## 保存、媒体和旧数据

- 支持个人简介、关于我、三个板块前言、联系邮箱、卡片、统计、留言及每条留言的独立头像。
- 支持 JPG、PNG、WebP、GIF、AVIF、MP3，单个文件最多 50 MB，每板块相册最多 6 张。云端文件目录为 `子链接编号/随机文件名`。
- 数据库和 Storage 都用 `owner_id` 强制隔离写入。访客可读取公开资料和媒体；其他子链接的编辑者不能修改或删除本链接资料。
- 先保存文件引用，再清理旧文件。保存失败时尝试清理本次新上传；若清理同时被网络故障阻断，可在 Storage 后台核对并删除未引用文件。
- 两台设备同时修改同一份资料时，后保存的一方会收到冲突提示，避免悄悄覆盖。先复制未保存输入，再重新读取后编辑。
- 已在数据库中的旧内嵌头像不会因纯文字保存而强制上传，避免缺少存储桶时阻断文字保存。新增媒体仍需完成后台安装。
- 原浏览器本地资料的备份、导入和媒体迁移只在主站提供，防止无意把主站旧数据导入其他人的子链接。不要在迁移前清除原浏览器数据。
- “导出资料”保存完整 JSON（包含媒体 URL），不是独立媒体备份；“导入资料”兼容旧个人资料 JSON。“导出访客版 HTML”是固定只读快照，不会持续更新；对外持续同步请分发正常子链接。
- 普通网页的前端代码本来就可被浏览器查看；密码、内部账号目录和后台密钥不在公开资料中。

## 微信及音乐播放

浏览器 SDK 已固定版本并放在 `vendor/supabase.js`，与网页同站点发布，不再从外部 CDN 获取。公开读取使用原生 fetch + Publishable Key，独立于 SDK、编辑登录和刷新令牌锁；认证和所有写入仍使用 SDK 与服务端权限。

`supabase-config.js` 保存公开项目 URL、Publishable Key 和子链接选择逻辑；不要在这里填写 Secret Key 或 service_role Key。修改网页文件请一起发布，微信缓存旧页面时可从右上角菜单刷新，或用系统浏览器打开同一链接对照。

从手机文件选择器返回时，微信可能连续触发焦点和前台恢复事件。正在进行的云端读取会被合并，上传会保留已选文件并等待读取完成，再验证文件和保存；不再因刷新中的临时状态误报“云端尚未读取”。读取确实失败或超时（20 秒）时仍不会上传，页面会显示具体原因；再次选择文件会自动重试读取。等待期间如果其他设备修改了资料，会保留冲突保护，请检查最新内容后再保存。

iPhone 微信可能阻止有声音的自动播放，需点击音乐旁的 ▶；手动播放不应被自动播放补偿逻辑再次暂停。切换页面回来、资料未改变时不会重复清空音乐源。上传 MP3 时会先检查浏览器能否解码，手机文件没有 MIME 类型或为通用二进制类型时，会按有效 MP3 处理；错误文件会明确提示，不会保存成一个无法播放的云端记录。

旧音乐会根据文件内容识别真实格式。对实际为 M4A/AAC、却曾以 MP3 名称和 `audio/mpeg` 类型上传的文件，播放器使用正确类型的 Blob 加载，导出的访客页面也保留正确类型。此兼容修复仅需更新 GitHub Pages 前端，无需重传原音乐或修改 Supabase SQL、Edge Function。旧文件识别和下载期间显示“…”；音乐加载不阻塞资料读取和编辑。新上传会拒绝已识别的非 MP3 容器，请用音频转换工具生成真正的 MP3，修改文件名后缀不会转换编码。

本任务验证了 Chromium 手机视口/触摸模拟及播放行为，没有真实 iPhone/安卓微信设备；WebKit 引擎下载被环境网络策略拒绝，未完成真实 WebKit 测试。仍需用实际微信打开同一子链接复测读取、上传和点击播放。

## 权限与密码实现

每份子链接由后端创建独立 Supabase Auth 身份，内部邮箱只存于私有目录。Auth 负责密码哈希及会话；普通浏览器不能读取身份目录或调用管理 RPC。单个子链接的登录尝试限制为每 15 分钟 20 次，另受 Supabase Auth 自身限制。重置密码会轮换身份和 `owner_id`，使旧 access token 也立即失去数据库和文件写入权限。

主站原管理员被登记为分发管理员，可以创建和重置链接；普通持有人不能创建其他链接。`profile_data` 及公共媒体用于公开展示，请勿存放隐私文件。项目中已有的自定义 RPC、安全定义者函数仍应按真实项目检查。

## 开发和验证

每个云任务已经隔离，直接使用已有 checkout，无需额外 Git worktree。

```sh
cd /workspace/Jsy_1to4
python -m http.server 8000 --bind 0.0.0.0
```

网页本身无需安装依赖。测试说明在 `tests/README.md`；生成可粘贴安装文件用 `python scripts/prepare-deployment.py`。

当前环境已测试真实浏览器、Supabase SDK、实际 Edge Function handler 和模拟网络服务；实际权限 SQL 已在嵌入式 PostgreSQL 中验证，包括跨链接隔离和重置后的旧会话拒绝。**尚未在真实 Supabase 项目执行新 SQL 或部署函数，也未确认 GitHub Pages 发布状态。** Git 推送、数据库安装、函数部署和网站发布是不同步骤；详细记录见 `VALIDATION.md`。
