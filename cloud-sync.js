/* V19 cloud adapter. Layout, modal, player and preview code remain in index.html. */
'use strict';
const CLOUD_BUCKET = 'homepage-media';
let cloudRow = null;
let cloudMedia = [];
let cloudBusy = false;
let cloudReady = false;
const localMediaAll = mediaAll;
const legacyText = {profile: structuredClone(data), about: structuredClone(about), sectionIntros: structuredClone(sectionIntros), comments: structuredClone(presetComments)};
const legacyImages = {avatar: data.avatar, about: about.image, comments: structuredClone(presetComments)};
const cloudStatus = document.createElement('p');
cloudStatus.className = 'hint';
cloudStatus.setAttribute('role', 'status');
$('modal').querySelector('.panel h2').after(cloudStatus);
const cloudStyle = document.createElement('style');
cloudStyle.textContent = 'body.cloud-busy .editor button,body.cloud-busy .editor input,body.cloud-busy .editor textarea{pointer-events:none;opacity:.6}body:not(.profile-unlocked) .cloud-admin{display:none!important}';
document.head.append(cloudStyle);
function status(message) { cloudStatus.textContent = message; }
function cloudError(error) { console.error('Cloud operation failed', error); status('云端操作失败：' + error.message); toast('云端操作失败：' + error.message); }
window.cloudCanEdit = async function () {
  try {
    const {data: {user}, error} = await profileSupabase.auth.getUser();
    if (error || !user) return false;
    const {data: row, error: readError} = await profileSupabase.from('homepage_profiles').select('owner_id').eq('slug', PROFILE_SLUG).single();
    return !readError && row.owner_id === user.id;
  } catch { return false; }
};
function applyCloud(row) {
  cloudRow = row;
  const saved = row.profile_data || {};
  const profile = saved.profile || saved;
  data = {...structuredClone(defaults), ...profile};
  about = {...aboutFallback, ...(saved.about || {})};
  sectionIntros = {...(saved.sectionIntros || {})};
  presetComments = Array.isArray(saved.comments) ? structuredClone(saved.comments) : [];
  cloudMedia = Array.isArray(saved.media) ? structuredClone(saved.media) : [];
  render();
  if ($('avatarBubble')) { const text = data.bubbleText ?? '你好'; $('avatarBubble').textContent = text; $('avatarBubble').style.display = text ? 'block' : 'none'; }
}
async function loadCloud() {
  cloudReady = false;
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(PROFILE_SLUG)) throw Error('子链接编号格式不正确');
  const {data: row, error} = await profileSupabase.from('homepage_profiles').select('profile_data,updated_at,owner_id').eq('slug', PROFILE_SLUG).single();
  if (error) {
    if (error.code === 'PGRST116') throw Error('此专属主页不存在，请核对链接或联系提供者创建');
    throw error;
  }
  applyCloud(row); cloudReady = true;
  status('已读取最新云端资料');
  await loadMusic();
}
function documentData() {
  return {...(cloudRow.profile_data || {}), profile: structuredClone(data), about: structuredClone(about),
    sectionIntros: structuredClone(sectionIntros), comments: structuredClone(presetComments), media: structuredClone(cloudMedia)};
}
function ownedPaths(value) {
  const paths = new Set();
  const prefix = SUPABASE_URL + '/storage/v1/object/public/' + CLOUD_BUCKET + '/';
  function visit(x) {
    if (typeof x === 'string' && x.startsWith(prefix)) {
      const path = decodeURIComponent(x.slice(prefix.length).split('?')[0]);
      if (path.startsWith(PROFILE_SLUG + '/')) paths.add(path);
    } else if (Array.isArray(x)) x.forEach(visit);
    else if (x && typeof x === 'object') Object.values(x).forEach(visit);
  }
  visit(value); return paths;
}
async function commitCloud() {
  const next = documentData();
  const previous = cloudRow;
  let query = profileSupabase.from('homepage_profiles').update({profile_data: next, updated_at: new Date().toISOString()}).eq('slug', PROFILE_SLUG);
  query = previous.updated_at === null ? query.is('updated_at', null) : query.eq('updated_at', previous.updated_at);
  const {data: rows, error} = await query.select('profile_data,updated_at,owner_id');
  if (error) throw error;
  if (!rows || rows.length !== 1) throw Error('保存未完成：资料已被其他设备更新或没有权限，请重新读取后再编辑');
  cloudRow = rows[0];
  // Commit references before deleting objects: a failed database save never breaks public media.
  const retained = ownedPaths(next);
  const obsolete = [...ownedPaths(previous.profile_data)].filter(path => !retained.has(path));
  if (obsolete.length) {
    const result = await profileSupabase.storage.from(CLOUD_BUCKET).remove(obsolete).catch(error => ({error}));
    const removeError = result.error;
    if (removeError) { status('资料已同步；旧文件清理失败，请在 Storage 后台清理未引用文件'); toast('已保存，但旧文件清理失败'); return; }
  }
  status('全部资料已同步到 Supabase'); toast('已保存到云端');
}
let newUploads = [];
async function uploadFile(file) {
  if (!(file instanceof Blob) || !/^(image\/(jpeg|png|webp|gif|avif)|audio\/(mpeg|mp3))$/.test(file.type)) throw Error('请使用 JPG、PNG、WebP、GIF、AVIF 或 MP3 文件');
  if (file.size > 50 * 1024 * 1024) throw Error('单个文件不能超过 50 MB');
  const path = PROFILE_SLUG + '/' + crypto.randomUUID();
  const {error} = await profileSupabase.storage.from(CLOUD_BUCKET).upload(path, file, {contentType: file.type, upsert: false});
  if (error) {
    if (/bucket not found/i.test(error.message || '')) throw Error('未找到 homepage-media 存储桶，请先在 Supabase SQL Editor 执行项目内的 supabase/setup.sql');
    throw error;
  }
  newUploads.push(path);
  return profileSupabase.storage.from(CLOUD_BUCKET).getPublicUrl(path).data.publicUrl;
}
async function uploadInlineImages(includeExisting = false) {
  // Legacy images already stored in profile_data must not turn text edits into
  // Storage uploads. Migrate them only when the administrator explicitly asks.
  const previous = cloudRow?.profile_data || {};
  const existing = new Set([
    (previous.profile || previous).avatar,
    previous.about?.image,
    ...(Array.isArray(previous.comments) ? previous.comments.map(c => c.avatar) : [])
  ].filter(Boolean));
  async function convert(url) {
    if (typeof url !== 'string' || !url.startsWith('data:image/')) return url || '';
    if (!includeExisting && existing.has(url)) return url;
    return uploadFile(await (await fetch(url)).blob());
  }
  data.avatar = await convert(data.avatar);
  about.image = await convert(about.image);
  for (const c of presetComments) c.avatar = await convert(c.avatar);
}
async function cloudAction(operation, after) {
  if (cloudBusy) { toast('正在同步，请稍候'); return; }
  cloudBusy = true; document.body.classList.add('cloud-busy'); newUploads = [];
  const before = cloudRow ? structuredClone(cloudRow) : null;
  let committed = false;
  try {
    if (!cloudReady) throw Error('云端尚未读取成功，请点击重新读取');
    if (!await window.cloudCanEdit()) throw Error('仅主页管理员可以修改');
    await operation();
    await uploadInlineImages();
    await commitCloud(); committed = true;
    render(); if ($('avatarBubble')) { $('avatarBubble').textContent = data.bubbleText ?? '你好'; $('avatarBubble').style.display = data.bubbleText === '' ? 'none' : 'block'; } if (after) await after();
  } catch (error) {
    if (!committed) {
      if (before) applyCloud(before);
      if (newUploads.length) {
        const {error: cleanupError} = await profileSupabase.storage.from(CLOUD_BUCKET).remove(newUploads);
        if (cleanupError) console.warn('未引用的上传文件需要管理员清理', cleanupError.message);
      }
    }
    cloudError(error);
  } finally { cloudBusy = false; document.body.classList.remove('cloud-busy'); }
  return committed;
}
// Disable the old local persistence side effects. Only the explicit cloud operations below write.
persist = function () {};
saveAbout = function () { return true; };
saveV5 = function () { return true; };
function interceptSave(id, operation, after) {
  document.addEventListener('click', event => {
    if (!event.target.closest('#' + id)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    void cloudAction(operation, after);
  }, true);
}
interceptSave('saveBtn', () => {
  const bubble = $('bubbleInput') || document.querySelector('#modal input[maxlength]');
  // V19's bubble field is assigned below by its label, without changing the layout.
  const bubbleField = [...$('modal').querySelectorAll('input')].find(x => x.placeholder?.includes('你好'));
  const field = bubble || bubbleField;
  if (field) {
    const value = field.value.trim();
    if (/[\u3400-\u9fff]/.test(value) ? [...value].length > 3 : value.split(/\s+/).filter(Boolean).length > 2) throw Error('气泡文字：中文最多3字，英文最多2个单词');
    data.bubbleText = value;
  }
  Object.assign(data, {name: $('nameInput').value, bio: $('bioInput').value, tags: $('tagsInput').value.split(/[,，]/).map(x => x.trim()).filter(Boolean), posts: +$('postsInput').value, fans: +$('fansInput').value, following: +$('followingInput').value, email: $('emailInput').value});
  document.querySelectorAll('[data-k]').forEach(el => data.cards[+el.dataset.i][el.dataset.k] = el.value);
  document.querySelectorAll('[data-preface]').forEach(el => sectionIntros[el.dataset.preface] = el.value);
}, () => { $('modal').classList.remove('open'); });
interceptSave('saveAbout', () => { about.title = $('aboutTitleInput').value; about.text = $('aboutTextInput').value; }, () => { $('aboutEditor').classList.remove('open'); render(); $('modal').classList.add('open'); });
interceptSave('saveComments', () => {
  presetComments = [...document.querySelectorAll('#commentRows .comment-editor-row')].map(row => ({name: row.querySelector('input:not([type=file])').value.trim() || '匿名', message: row.querySelector('textarea').value.trim(), avatar: row.dataset.avatar || '', time: row.dataset.time || '刚刚'})).filter(c => c.message);
}, () => { $('commentManager').classList.remove('open'); $('modal').classList.add('open'); });
const oldAddCommentRow = addCommentRow;
addCommentRow = function(c) { oldAddCommentRow(c); $('commentRows').lastElementChild.dataset.time = c.time || '刚刚'; };
$('avatarFile').onchange = e => { const file = e.target.files?.[0]; e.target.value = ''; if(file) void cloudAction(async () => { data.avatar = await uploadFile(file); }); };
aboutFile.onchange = e => { const file = e.target.files?.[0]; e.target.value = ''; if(file) void cloudAction(async () => { about.image = await uploadFile(file); }, showAbout); };
mediaAll = async function(type) {
  return Promise.all(cloudMedia.filter(x => x.type === type).map(async item => {
    const response = await fetch(item.url); if (!response.ok) throw Error('云端文件读取失败：' + response.status);
    return {...item, file: await response.blob()};
  }));
};
mediaDelete = async function(id) {
  const saved = await cloudAction(() => { cloudMedia = cloudMedia.filter(x => x.id !== id); });
  if (!saved) throw Error('云端删除未完成');
};
loadMusic = async function() {
  activeMusic = cloudMedia.find(x => x.type === 'music') || null;
  audio.pause(); audio.removeAttribute('src');
  if (activeMusic) audio.src = activeMusic.url;
  const name = $('songName'); if(name) name.textContent = activeMusic?.name?.replace(/\.mp3$/i, '') || 'My Song';
  updatePlayButton(); if(activeMusic) void tryAutoplay();
};
musicFile.onchange = e => {
  const file = e.target.files?.[0]; e.target.value = '';
  if(file) void cloudAction(async () => {
    const url = await uploadFile(file);
    cloudMedia = cloudMedia.filter(x => x.type !== 'music');
    cloudMedia.push({id: crypto.randomUUID(), type: 'music', name: file.name, url});
  }, loadMusic);
};
galleryFile.onchange = e => {
  const files = [...e.target.files]; e.target.value = '';
  const section = sectionInfo.find(x => x.type === galleryFile.dataset.section) || sectionInfo[0];
  void cloudAction(async () => {
    const room = 6 - cloudMedia.filter(x => x.type === section.type).length;
    if(files.length > room) throw Error('每个相册最多 6 张，请减少选择数量');
    for(const file of files) cloudMedia.push({id: crypto.randomUUID(), type: section.type, name: file.name, url: await uploadFile(file)});
  }, () => showSection(section));
};
$('importFile').onchange = async e => {
  const file = e.target.files?.[0]; e.target.value = ''; if(!file) return;
  void cloudAction(async () => {
    const obj = JSON.parse(await file.text());
    const profile = obj.profile || obj;
    if (!Array.isArray(profile.cards) || profile.cards.length !== defaults.cards.length || !Array.isArray(profile.tags)) throw Error('资料文件格式不正确');
    data = {...structuredClone(defaults), ...profile};
    if (obj.about) about = {...aboutFallback, ...obj.about};
    if (obj.sectionIntros) sectionIntros = {...obj.sectionIntros};
    if (Array.isArray(obj.comments)) presetComments = obj.comments;
    if (Array.isArray(obj.media)) cloudMedia = obj.media;
  }, openEditor);
};
function tool(text, action) { const button = document.createElement('button'); button.type = 'button'; button.className = 'v16-tool cloud-admin'; button.textContent = text; button.onclick = action; $('modal').querySelector('.v16-tool-grid').append(button); }

function exportJson(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'}));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('exportBtn').onclick = () => exportJson(documentData(), '个人主页云端资料.json');
if (!IS_CHILD_PROFILE) tool('备份旧浏览器文字', () => exportJson(legacyText, 'V19旧浏览器文字备份.json'));
if (!IS_CHILD_PROFILE) tool('导入旧浏览器文字', () => {
  if (!confirm('仅在原先编辑 V19 的浏览器使用：这会用此浏览器原有文字和留言替换当前云端文字。请先备份，继续？')) return;
  void cloudAction(() => { data = structuredClone(legacyText.profile); about = structuredClone(legacyText.about); sectionIntros = structuredClone(legacyText.sectionIntros); presetComments = structuredClone(legacyText.comments); });
});
tool('删除主页头像', () => void cloudAction(() => {data.avatar = '';}));
tool('更换关于我图片', () => aboutFile.click());
tool('删除关于我图片', () => void cloudAction(() => {about.image = '';}));
tool('删除音乐', () => void cloudAction(() => {cloudMedia = cloudMedia.filter(x => x.type !== 'music');}, loadMusic));
if (!IS_CHILD_PROFILE) tool('上传旧浏览器媒体', () => {
  if(!confirm('将此浏览器的旧相册和音乐上传到云端。请先导出资料备份，继续？')) return;
  void cloudAction(async () => {
    for(const type of ['gallery','experience','contact','music']) {
      const files = await localMediaAll(type);
      for(const item of files) {
        const legacyId = type + ':' + item.id;
        if(cloudMedia.some(x => x.legacyId === legacyId)) continue;
        if(type === 'music' && cloudMedia.some(x => x.type === type)) continue;
        if(type !== 'music' && cloudMedia.filter(x => x.type === type).length >= 6) throw Error('旧相册与云端合计超过 6 张，请先整理');
        cloudMedia.push({id: crypto.randomUUID(), legacyId, type, name: item.name, url: await uploadFile(item.file)});
      }
    }
    if(!data.avatar && legacyImages.avatar) data.avatar = legacyImages.avatar;
    if(!about.image && legacyImages.about) about.image = legacyImages.about;
    await uploadInlineImages(true);
  }, loadMusic);
});
const retry = document.createElement('button'); retry.className = 'btn'; retry.textContent = '重新读取云端';
retry.onclick = () => { if(!cloudBusy && confirm('重新读取会替换尚未保存的输入，继续？')) void loadCloud().catch(cloudError); };
cloudStatus.after(retry);
window.addEventListener('focus', () => { if(!cloudBusy && !document.querySelector('.editor.open')) void loadCloud().catch(cloudError); });
void loadCloud().catch(error => { cloudReady = false; cloudError(error); });
