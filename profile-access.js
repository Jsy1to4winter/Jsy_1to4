/* Password-only child-link access. All authorization is enforced by Supabase. */
'use strict';
const IS_CHILD_PROFILE = PROFILE_SLUG !== 'fuguang';
window.profileAccessRequest = async function(action, values = {}) {
  const headers = {'Content-Type':'application/json', apikey:SUPABASE_PUBLISHABLE_KEY};
  if (action !== 'unlock') {
    const {data:{session}} = await profileSupabase.auth.getSession();
    if(!session) throw Error('请先登录主站管理员账号');
    headers.Authorization = 'Bearer ' + session.access_token;
  }
  let response;
  try { response = await fetch(SUPABASE_URL + '/functions/v1/profile-access', {method:'POST', headers, body:JSON.stringify({action,...values})}); }
  catch { throw Error('暂时无法连接登录服务，请稍后重试'); }
  const result = await response.json().catch(() => ({}));
  if(!response.ok) throw Error(result.error || '子链接服务尚未配置，请联系主页提供者');
  return result;
};
window.profileLogin = async function(email, password) {
  if(!IS_CHILD_PROFILE) {
    const {error} = await profileSupabase.auth.signInWithPassword({email,password});
    if(error) throw error;
  } else {
    const {session} = await window.profileAccessRequest('unlock',{slug:PROFILE_SLUG,password});
    const {error} = await profileSupabase.auth.setSession(session);
    if(error) throw error;
  }
};
if(IS_CHILD_PROFILE) {
  $('lockEmail').hidden=true;
  $('lockEmail').disabled=true;
  $('lockDescription').textContent='输入此专属链接的编辑密码，即可修改资料和上传图片、音乐。';
  $('lockPassword').autocomplete='current-password';
}
window.profileAccessRefresh = function(canEdit) {
  const button=$('manageChildLinks');
  if(button) button.style.display=canEdit && !IS_CHILD_PROFILE ? '' : 'none';
  if(!canEdit) {
    $('distributionDialog')?.classList.remove('open');
    if($('distributionResult')) $('distributionResult').value='';
  }
};
(function addDistributionTools() {
  const button=document.createElement('button');button.id='manageChildLinks';button.className='v16-tool cloud-admin';button.type='button';button.textContent='分发专属子链接';button.style.display='none';
  $('modal').querySelector('.v16-tool-grid').append(button);
  const box=document.createElement('div');box.id='distributionDialog';box.className='editor';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');
  box.innerHTML='<div class="panel"><h2>专属子链接管理</h2><p class="hint">每份资料独立保存。收到链接的人可以浏览，持有对应密码的人可编辑并上传图片、音乐。</p><label class="field">子链接编号<input id="childSlug" autocomplete="off" placeholder="例如 p_123abc"></label><label class="field">独立编辑密码（12–64 个字符）<input id="childPassword" type="password" autocomplete="new-password"></label><div class="row"><button type="button" class="btn" id="generateChildPassword">生成密码</button><button type="button" class="btn" id="createChildLink">创建子链接</button></div><p class="hint" id="distributionStatus" role="status"></p><label class="field">分发资料（密码仅在本次操作后显示，请自行妥善保存）<textarea id="distributionResult" readonly></textarea></label><button type="button" class="btn" id="copyDistribution">复制链接与密码</button><h3>已创建的子链接</h3><div id="childLinkList"></div><div class="row"><button type="button" class="btn" id="closeDistribution">返回</button></div></div>';
  document.body.append(box);
  let busy=false;
  const newPassword=()=>'Aa9!'+Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('');
  function link(slug) {const url=new URL(location.href);url.search='';url.hash='';url.searchParams.set('profile',slug);return url.href;}
  function clearResult() {$('distributionResult').value='';}
  function showResult(slug,password) {$('distributionResult').value='专属主页：'+link(slug)+'\n编辑密码：'+password+'\n任何人可浏览；请勿将密码发给仅需浏览的人。';}
  async function operation(action) {
    if(busy)return;busy=true;box.querySelectorAll('button').forEach(b=>b.disabled=true);
    $('distributionStatus').textContent='正在处理…';clearResult();
    try {await action();} catch(error) {$('distributionStatus').textContent=error.message;}
    finally {busy=false;box.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  async function refreshList() {
    const {profiles}=await window.profileAccessRequest('list');
    $('childLinkList').replaceChildren();
    for(const item of profiles) {
      const row=document.createElement('div');row.className='row';
      const a=document.createElement('a');a.textContent=item.slug;a.href=link(item.slug);a.target='_blank';a.rel='noopener';
      const reset=document.createElement('button');reset.type='button';reset.className='btn small';reset.textContent='重置密码';
      reset.onclick=()=>{
        if(!confirm('重置后，旧密码及已登录的旧编辑会话立即失去编辑权限。资料和文件会保留，继续？'))return;
        void operation(async()=>{
          const password=newPassword();await window.profileAccessRequest('reset',{slug:item.slug,password});
          showResult(item.slug,password);$('distributionStatus').textContent='密码已重置，请保存并重新分发。';
        });
      };
      row.append(a,reset);$('childLinkList').append(row);
    }
  }
  button.onclick=()=>{
    $('childSlug').value='p_'+crypto.randomUUID();$('childPassword').value=newPassword();clearResult();
    $('modal').classList.remove('open');box.classList.add('open');
    void operation(async()=>{await refreshList();$('distributionStatus').textContent='可以创建新的独立主页。';});
  };
  $('generateChildPassword').onclick=()=>{$('childPassword').value=newPassword();};
  $('createChildLink').onclick=()=>void operation(async()=>{
    const slug=$('childSlug').value.trim(),password=$('childPassword').value;
    if(!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(slug) || slug==='fuguang')throw Error('编号须为 3–64 位小写字母、数字、下划线或短横线，且不能使用 fuguang');
    if(password.length<12 || password.length>64 || new TextEncoder().encode(password).length>72)throw Error('密码须为 12–64 个字符且 UTF-8 长度不超过 72 字节');
    await window.profileAccessRequest('create',{slug,password});
    showResult(slug,password);$('childPassword').value='';await refreshList();$('distributionStatus').textContent='已创建。请复制并保存下方链接与密码。';
  });
  $('copyDistribution').onclick=async()=>{
    if(!$('distributionResult').value)return;
    try {await navigator.clipboard.writeText($('distributionResult').value);$('distributionStatus').textContent='已复制';}
    catch {$('distributionResult').focus();$('distributionResult').select();$('distributionStatus').textContent='请复制已选中的文字';}
  };
  function close() {if(busy)return;clearResult();$('childPassword').value='';box.classList.remove('open');$('modal').classList.add('open');}
  $('closeDistribution').onclick=close;
  box.addEventListener('click',e=>{if(e.target===box)close();});
})();
