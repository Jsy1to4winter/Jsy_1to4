/* Integration test with real Supabase JS SDK + mocked HTTP, not a live RLS test. */
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/tmp/homepage-validation/node_modules/playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const sdk = fs.readFileSync(process.env.SUPABASE_SDK || '/tmp/homepage-validation/supabase.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII=', 'base64');
const legacyAvatar = 'data:image/png;base64,'+png.toString('base64');
const mp3 = fs.readFileSync(__dirname+'/fixtures/tone.mp3');
const owner = '00000000-0000-4000-8000-000000000001';
let row = {owner_id: owner, updated_at: '2026-10-16T00:00:00+00:00', profile_data: {profile: {name:'云端昵称',bio:'云端简介',tags:['保留'],posts:6,fans:128,following:32,email:'hello@example.com',avatar:legacyAvatar,cards:[{icon:'✦',title:'关于我',summary:'简介',detail:'关于我详情'},{icon:'♡',title:'兴趣爱好',summary:'兴趣',detail:'爱好详情'},{icon:'◈',title:'我的经历',summary:'经历',detail:'经历详情'},{icon:'✉',title:'联系我',summary:'联系',detail:'联系详情'}]},about:{title:'云端标题',text:'云端关于我',image:''},sectionIntros:{gallery:'旧兴趣',experience:'旧经历',contact:'旧联系'},comments:[{name:'旧留言',message:'旧内容',time:'昨天',avatar:''}],media:[]}};
let writes = 0, failWrite = false, failUpload = true;
const objects = new Map();
const token = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:owner,exp:4102444800})).toString('base64url')+'.fake';
const user = {id:owner,aud:'authenticated',role:'authenticated',email:'admin@example.com'};
async function context(browser) {
  const ctx = await browser.newContext();
  await ctx.route('https://cdn.jsdelivr.net/**', route => route.fulfill({contentType:'application/javascript',body:sdk}));
  await ctx.route('https://nedsvrzbsrethlyyoqey.supabase.co/**', async route => {
    const req = route.request(), url = new URL(req.url());
    const headers = {'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-expose-headers':'*','content-type':'application/json'};
    const reply = (body, status=200) => route.fulfill({status,headers,body:JSON.stringify(body)});
    if(req.method()==='OPTIONS') return reply({});
    if(url.pathname==='/auth/v1/token') return reply({access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'fake',user});
    if(url.pathname==='/auth/v1/user') return reply(user);
    if(url.pathname==='/auth/v1/logout') return reply({});
    if(url.pathname==='/rest/v1/homepage_profiles') {
      if(req.method()==='PATCH') {
        writes++;
        if(failWrite) return reply({message:'database unavailable'},503);
        if(url.searchParams.get('updated_at') !== 'eq.'+row.updated_at) return reply([]);
        const update=req.postDataJSON(); row={...row,...update,updated_at:new Date(Date.now()+writes).toISOString()};
        return reply([row]);
      }
      return reply(row);
    }
    const base='/storage/v1/object/';
    if(url.pathname.startsWith(base+'public/homepage-media/')) {
      const path=decodeURIComponent(url.pathname.slice((base+'public/homepage-media/').length));
      if(!objects.has(path)) return reply({message:'missing'},404);
      return route.fulfill({headers:{...headers,'content-type':objects.get(path).type},body:objects.get(path).body});
    }
    if(req.method()==='POST' && url.pathname.startsWith(base+'homepage-media/')) {
      if(failUpload) return reply({statusCode:'404',message:'Bucket not found',error:'Bucket not found'},400);
      const path=decodeURIComponent(url.pathname.slice((base+'homepage-media/').length));objects.set(path,req.postDataBuffer()?.includes(Buffer.from('audio/mpeg')) ? {body:mp3,type:'audio/mpeg'} : {body:png,type:'image/png'});return reply({Key:'homepage-media/'+path});
    }
    if(req.method()==='DELETE' && url.pathname===base+'homepage-media') {
      req.postDataJSON().prefixes.forEach(p=>objects.delete(p));return reply([]);
    }
    throw Error('Unhandled '+req.method()+' '+url);
  });
  return ctx;
}
async function waitSaved(page) {await page.waitForFunction(()=>!cloudBusy);}
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM || '/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try {
    const ctx=await context(browser), page=await ctx.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto('http://127.0.0.1:8000');
    await page.waitForFunction(()=>cloudReady);
    assert.equal(await page.locator('#displayName').textContent(),'云端昵称');
    await page.click('#editBtn'); await page.waitForSelector('#lockDialog.open');
    assert.equal(writes,0);
    await page.fill('#lockEmail','admin@example.com');await page.fill('#lockPassword','password');await page.click('#unlockSubmit');
    await page.waitForSelector('body.profile-unlocked');
    await page.click('#editBtn');
    await page.fill('#nameInput','同步昵称');await page.fill('#bioInput','完整个人简介');await page.fill('#bubbleInput','你好呀');
    for(const type of ['gallery','experience','contact']) await page.fill('[data-preface="'+type+'"]','同步'+type);
    await page.click('#saveBtn');await waitSaved(page);
    assert.equal(row.profile_data.profile.name,'同步昵称');assert.equal(row.profile_data.sectionIntros.contact,'同步contact');
    assert.equal(await page.locator('#avatarBubble').textContent(),'你好呀');
    assert.equal(row.profile_data.profile.avatar,legacyAvatar);assert.equal(objects.size,0);failUpload=false;
    await page.click('#editBtn');await page.click('[data-tool="intro"]');
    await page.fill('#aboutTitleInput','同步标题');await page.fill('#aboutTextInput','同步关于我');await page.click('#saveAbout');await waitSaved(page);
    assert.equal(row.profile_data.about.text,'同步关于我');
    await page.click('[data-tool="comments"]');
    await page.locator('#commentRows textarea').fill('编辑留言内容');
    await page.locator('#commentRows input[type=file]').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:png});
    await page.waitForFunction(()=>document.querySelector('#commentRows .comment-editor-row').dataset.avatar.startsWith('data:'));
    await page.click('#addComment');await page.locator('#commentRows input:not([type=file])').last().fill('新留言人');await page.locator('#commentRows textarea').last().fill('新增留言');
    await page.click('#saveComments');await waitSaved(page);
    assert.equal(row.profile_data.comments.length,2);assert.match(row.profile_data.comments[0].avatar,/storage\/v1\/object\/public/);
    // Image upload, public preview and deletion.
    await page.click('[data-tool="gallery"]');
    await page.locator('#galleryInput').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});await waitSaved(page);
    assert.equal(row.profile_data.media.length,1);
    await page.click('.gallery-tile img');await page.waitForSelector('#imageViewer.open');await page.click('#closeViewer');
    const imagePath=row.profile_data.media[0].url.split('/homepage-media/')[1];assert(objects.has(imagePath));
    await page.click('.gallery-delete');await waitSaved(page);assert.equal(row.profile_data.media.length,0);assert(!objects.has(imagePath));
    await page.click('#detailClose');
    // The existing audio element plays a real MP3 returned by mocked Storage.
    await page.locator('#musicInput').setInputFiles({name:'tone.mp3',mimeType:'audio/mpeg',buffer:mp3});await waitSaved(page);
    await page.waitForFunction(()=>document.getElementById('profileAudio').readyState>=2);
    assert(await page.locator('#profileAudio').evaluate(a=>a.duration>0));
    assert.equal(row.profile_data.media.filter(x=>x.type==='music').length,1);
    await page.getByRole('button',{name:'删除音乐',exact:true}).click();await waitSaved(page);
    assert.equal(row.profile_data.media.filter(x=>x.type==='music').length,0);
    // Comment delete retains the other entry and its uploaded avatar.
    await page.click('[data-tool="comments"]');await page.locator('#commentRows .mini-edit').last().click();await page.click('#saveComments');await waitSaved(page);
    assert.equal(row.profile_data.comments.length,1);
    // Database failure retains open editor and does not report success.
    failWrite=true;await page.fill('#nameInput','不应保存');await page.click('#saveBtn');await waitSaved(page);
    assert.equal(row.profile_data.profile.name,'同步昵称');assert(await page.locator('#modal').evaluate(x=>x.classList.contains('open')));
    failWrite=false;
    // Another device wins: optimistic concurrency refuses the stale edit.
    row.updated_at='2030-01-01T00:00:00Z';await page.click('#saveBtn');await waitSaved(page);assert.equal(row.profile_data.profile.name,'同步昵称');
    await page.evaluate(()=>loadCloud());
    // Storage upload denial leaves profile unchanged.
    failUpload=true;await page.locator('#avatarFile').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:png});await waitSaved(page);assert.equal(row.profile_data.profile.avatar,legacyAvatar);assert.match(await page.locator('#toast').textContent(),/homepage-media/);failUpload=false;
    await page.locator('#avatarFile').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:png});await waitSaved(page);assert.match(row.profile_data.profile.avatar,/storage/);
    const visitor=await context(browser), vp=await visitor.newPage();await vp.goto('http://127.0.0.1:8000');await vp.waitForFunction(()=>cloudReady);
    assert.equal(await vp.locator('#displayName').textContent(),'同步昵称');assert.equal(await vp.locator('#homeIntroBody').textContent(),'同步关于我');assert.equal(await vp.locator('#commentWall .comment-item').count(),1);
    assert(!await vp.locator('body').evaluate(x=>x.classList.contains('profile-unlocked')));
    const beforeWrites=writes;await vp.evaluate(()=>cloudAction(()=>{data.name='visitor attempt';}));assert.equal(writes,beforeWrites);
    await vp.locator('#cards .card').nth(2).click();await vp.waitForSelector('.editable-preface p');assert.equal(await vp.locator('.editable-preface p').textContent(),'同步experience');
    const downloadWait=page.waitForEvent('download');await page.click('#publishVisitor');const download=await downloadWait;
    const snapshot=fs.readFileSync(await download.path(),'utf8');assert(!snapshot.includes('<script src="cloud-sync.js"></script>'));
    const sp=await ctx.newPage();await sp.route('**/snapshot.html',r=>r.fulfill({contentType:'text/html',body:snapshot}));
    const exportErrors=[];sp.on('pageerror',e=>exportErrors.push(e.message));await sp.goto('http://127.0.0.1:8000/snapshot.html');
    assert.equal(await sp.locator('#displayName').textContent(),'同步昵称');assert.deepEqual(exportErrors,[]);await sp.close();
    await page.click('#profileLock');await page.waitForSelector('body:not(.profile-unlocked)');
    assert.deepEqual(errors,[]);
    console.log('PASS: text save with legacy inline avatar and missing Storage bucket, cloud reads, visitor lock, owner login, all text, comments/avatar, image preview/upload/delete, database/upload failure, edit conflict, fresh visitor, read-only HTML export, logout; real SDK + mocked HTTP.');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
