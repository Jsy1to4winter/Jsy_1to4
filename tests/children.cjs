/* Real browser + SDK + actual Edge handler; Auth/PostgREST/Storage are simulated. */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || '/tmp/homepage-validation/node_modules/playwright');
const fs=require('node:fs'), assert=require('node:assert/strict');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aY1cAAAAASUVORK5CYII=','base64');
const mp3=fs.readFileSync(__dirname+'/fixtures/tone.mp3');
const root='00000000-0000-4000-8000-000000000001';let sequence=1,revision=0;
const users=new Map([[root,{id:root,email:'root@example.com',password:'root-password-123',aud:'authenticated',role:'authenticated'}]]);
const profiles=new Map([['fuguang',{owner_id:root,updated_at:'2026-10-16T00:00:00Z',profile_data:{}}]]),editors=new Map(),attempts=new Map(),objects=new Map(),tokens=new Map();
const sessionFor=user=>{const access_token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp:4102444800})).toString('base64url')+'.fixture';tokens.set(access_token,user.id);return {access_token,refresh_token:'r-'+user.id,token_type:'bearer',expires_in:3600,user};};
const userFor=token=>users.get(tokens.get(token));
const backend={
 from(table) {let filter;return {select(){return this},eq(key,value){filter={key,value};return this},async maybeSingle(){if(table==='homepage_admins')return {data:filter.value===root?{user_id:root}:null};return {data:editors.get(filter.value)||null}},async order(){return {data:[...editors.keys()].map(slug=>({slug,created_at:'2026-10-16',deleted_at:editors.get(slug).deleted_at,purged_at:editors.get(slug).purged_at}))}}};},
 auth:{async getUser(token){return {data:{user:userFor(token)||null}}},admin:{async createUser({email,password}){const id='00000000-0000-4000-8000-'+String(++sequence).padStart(12,'0'),user={id,email,password,aud:'authenticated',role:'authenticated'};users.set(id,user);return {data:{user}}},async deleteUser(id){users.delete(id);return {}},async updateUserById(id){users.get(id).banned=true;return {data:{user:users.get(id)}}}}},
 storage:{from(){return {async list(prefix){return {data:[...objects.keys()].filter(key=>key.startsWith(prefix+'/')).map(key=>({id:key,name:key.slice(prefix.length+1)}))}},async remove(paths){paths.forEach(path=>objects.delete(path));return {}}}}},
 async rpc(name,args){
  if(name==='homepage_take_login_attempt'){const n=(attempts.get(args.p_slug)||0)+1;attempts.set(args.p_slug,n);return {data:n<=20}}
  if(name==='homepage_create_editor'){profiles.set(args.p_slug,{owner_id:args.p_user_id,profile_data:{},updated_at:new Date(++revision).toISOString()});editors.set(args.p_slug,{user_id:args.p_user_id,login_email:args.p_email});return {}}
  if(name==='homepage_disable_editor'){const editor=editors.get(args.p_slug);editor.deleted_at='now';profiles.get(args.p_slug).deleted_at='now';return {data:editor.user_id};}
  if(name==='homepage_purge_editor'){editors.get(args.p_slug).purged_at='now';profiles.get(args.p_slug).profile_data={};return {};}
  assert.equal(name,'homepage_replace_editor');assert.equal(editors.get(args.p_slug).user_id,args.p_expected_user);profiles.get(args.p_slug).owner_id=args.p_new_user;profiles.get(args.p_slug).updated_at=new Date(++revision).toISOString();editors.set(args.p_slug,{user_id:args.p_new_user,login_email:args.p_email});return {};
 }
};
const passwordClient={auth:{async signInWithPassword({email,password}){const user=[...users.values()].find(u=>u.email===email&&u.password===password&&!u.banned);return user?{data:{session:sessionFor(user)}}:{data:{session:null},error:Error('wrong password')}}}};
(async()=>{
 const {createHandler}=await import('../supabase/functions/profile-access/handler.mjs');
 const handler=createHandler({createClient:(_url,key)=>key==='service-secret'?backend:passwordClient,env:{get:key=>({SUPABASE_URL:'https://nedsvrzbsrethlyyoqey.supabase.co',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'service-secret'})[key]},logger:{error(){},warn(){}}});
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const errors=[];
 async function context(options={}){const ctx=await browser.newContext(options);
  ctx.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
  await ctx.route('https://cdn.jsdelivr.net/**',r=>r.abort());
  await ctx.route('https://nedsvrzbsrethlyyoqey.supabase.co/**',async route=>{
   const req=route.request(),url=new URL(req.url()),token=req.headers().authorization?.replace(/^Bearer /,''),user=userFor(token);
   const headers={'content-type':'application/json','access-control-allow-origin':'*','access-control-allow-headers':'*'};
   const reply=(body,status=200)=>route.fulfill({status,headers,body:JSON.stringify(body)});
   if(req.method()==='OPTIONS')return reply({});
   if(url.pathname==='/functions/v1/profile-access'){
    const result=await handler(new Request(url,{method:'POST',headers:req.headers(),body:req.postData()}));return route.fulfill({status:result.status,headers:Object.fromEntries(result.headers),body:await result.text()});
   }
   if(url.pathname==='/auth/v1/token'){const result=await passwordClient.auth.signInWithPassword(req.postDataJSON());return result.error?reply({message:'Invalid login credentials'},400):reply(result.data.session)}
   if(url.pathname==='/auth/v1/user')return user?reply(user):reply({message:'Invalid JWT'},401);
   if(url.pathname==='/auth/v1/logout')return reply({});
   if(url.pathname==='/rest/v1/homepage_profiles'){
    const slug=url.searchParams.get('slug')?.slice(3),row=profiles.get(slug);
    if(!row||row.deleted_at)return reply({code:'PGRST116',message:'No rows'},406);
    if(req.method()==='PATCH'){
     if(user?.id!==row.owner_id)return reply({message:'permission denied'},403);
     if(url.searchParams.get('updated_at')!=='eq.'+row.updated_at)return reply([]);
     Object.assign(row,req.postDataJSON(),{updated_at:new Date(++revision+Date.now()).toISOString()});return reply([row]);
    }
    return reply(row);
   }
   const publicPrefix='/storage/v1/object/public/homepage-media/',privatePrefix='/storage/v1/object/homepage-media';
   if(url.pathname.startsWith(publicPrefix)){
    const item=objects.get(decodeURIComponent(url.pathname.slice(publicPrefix.length)));if(!item)return reply({message:'not found'},404);
    return route.fulfill({headers:{...headers,'content-type':item.type},body:item.body});
   }
   if(req.method()==='POST'&&url.pathname.startsWith(privatePrefix+'/')){
    const path=decodeURIComponent(url.pathname.slice(privatePrefix.length+1)),slug=path.split('/')[0];
    if(!user||(profiles.get(slug)?.owner_id!==user.id||profiles.get(slug)?.deleted_at))return reply({message:'RLS denied'},403);
    objects.set(path,req.postDataBuffer()?.includes(Buffer.from('audio/mpeg'))?{type:'audio/mpeg',body:mp3}:{type:'image/png',body:png});return reply({Key:'homepage-media/'+path});
   }
   if(req.method()==='DELETE'&&url.pathname===privatePrefix){
    const paths=req.postDataJSON().prefixes;if(paths.some(path=>!user||(profiles.get(path.split('/')[0])?.owner_id!==user.id||profiles.get(path.split('/')[0])?.deleted_at)))return reply({message:'RLS denied'},403);
    paths.forEach(path=>objects.delete(path));return reply([]);
   }
   throw Error('Unexpected '+req.method()+' '+url);
  });return ctx;
 }
 async function open(ctx,slug){const page=await ctx.newPage();await page.goto('http://127.0.0.1:8000/'+(slug?'?profile='+slug:''));await page.waitForFunction(()=>cloudReady);return page;}
 async function unlock(page,password){await page.click('#editBtn');await page.fill('#lockPassword',password);await page.click('#unlockSubmit');await page.waitForSelector('body.profile-unlocked');await page.click('#editBtn');}
 async function saved(page){await page.waitForFunction(()=>!cloudBusy);}
 try{
  const rootCtx=await context(),rp=await open(rootCtx);
  await rp.click('#editBtn');await rp.fill('#lockEmail','root@example.com');await rp.fill('#lockPassword','root-password-123');await rp.click('#unlockSubmit');await rp.waitForSelector('body.profile-unlocked');await rp.click('#editBtn');await rp.click('#manageChildLinks');
  await rp.fill('#childSlug','person_one');await rp.fill('#childPassword','one-password-123');await rp.click('#createChildLink');await rp.waitForFunction(()=>document.getElementById('distributionResult').value.includes('person_one'));
  assert.equal(profiles.size,2);assert.match(await rp.inputValue('#distributionResult'),/one-password-123/);
  await rp.fill('#childSlug','person_two');await rp.fill('#childPassword','two-password-123');await rp.click('#createChildLink');await rp.waitForFunction(()=>document.getElementById('distributionResult').value.includes('person_two'));
  assert.equal(profiles.size,3);
  const firstCtx=await context();await firstCtx.addInitScript(()=>{if(location.origin==='http://127.0.0.1:8000')localStorage.setItem('my-profile-v1',JSON.stringify({name:'MAIN_LOCAL_SENTINEL'}));});const p1=await open(firstCtx,'person_one');assert(await p1.locator('#lockEmail').isHidden());
  await p1.click('#editBtn');await p1.fill('#lockPassword','two-password-123');await p1.click('#unlockSubmit');await p1.waitForFunction(()=>document.getElementById('lockError').textContent.includes('密码不正确'));assert(!await p1.locator('body').evaluate(b=>b.classList.contains('profile-unlocked')));
  await p1.fill('#lockPassword','one-password-123');await p1.click('#unlockSubmit');await p1.waitForSelector('body.profile-unlocked');await p1.click('#editBtn');
  assert(await p1.locator('#manageChildLinks').isHidden());assert.equal(await p1.getByRole('button',{name:'导入旧浏览器文字',exact:true}).count(),0);
  await p1.fill('#nameInput','一号专属资料');await p1.fill('#bioInput','一号的简介');await p1.fill('[data-preface="gallery"]','一号相册');await p1.click('#saveBtn');await saved(p1);
  await p1.locator('#avatarFile').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:png});await saved(p1);
  await p1.locator('#musicInput').setInputFiles({name:'bad.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('not music')});await saved(p1);assert(!profiles.get('person_one').profile_data.media.some(x=>x.type==='music'));
  await p1.locator('#musicInput').setInputFiles({name:'music.mp3',mimeType:'application/octet-stream',buffer:mp3});await saved(p1);await p1.waitForFunction(()=>document.getElementById('profileAudio').readyState>=2);
  await p1.click('#editBtn');await p1.click('[data-tool="gallery"]');await p1.locator('#galleryInput').setInputFiles({name:'photo.png',mimeType:'image/png',buffer:png});await saved(p1);
  assert(profiles.get('person_one').profile_data.profile.avatar.includes('/person_one/'));assert.equal(profiles.get('person_one').profile_data.media.length,2);
  // The same browser can hold independent credentials in different profile tabs.
  const p2=await open(firstCtx,'person_two');assert(!await p2.locator('body').evaluate(b=>b.classList.contains('profile-unlocked')));
  await unlock(p2,'two-password-123');await p2.fill('#nameInput','二号专属资料');await p2.click('#saveBtn');await saved(p2);
  assert.equal(profiles.get('person_one').profile_data.profile.name,'一号专属资料');assert.equal(profiles.get('person_two').profile_data.profile.name,'二号专属资料');assert.equal(profiles.get('fuguang').profile_data.profile,undefined);
  await p2.locator('#avatarFile').setInputFiles({name:'other.png',mimeType:'image/png',buffer:png});await saved(p2);
  // A fresh public visitor sees latest text, image, gallery and playable music.
  const visitorCtx=await context({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 MicroMessenger/8.0'}),vp=await open(visitorCtx,'person_one');
  assert.equal(await vp.locator('#displayName').textContent(),'一号专属资料');assert.equal(await vp.locator('#displayBio').textContent(),'一号的简介');await vp.waitForFunction(()=>document.getElementById('profileAudio').readyState>=2);
  await vp.locator('#cards .card').nth(1).click();await vp.waitForSelector('.gallery-tile img');await vp.locator('.gallery-tile img').click();assert(await vp.locator('#imageViewer').evaluate(x=>x.classList.contains('open')));
  assert(!await vp.locator('body').evaluate(b=>b.classList.contains('profile-unlocked')));
  await vp.locator('#closeViewer').click();await vp.locator('#detailClose').click();await vp.evaluate(()=>{audio.loop=true;audio.pause();autoplayPending=true;});await vp.locator('.music-play').click();await vp.waitForFunction(()=>!audio.paused&&audio.currentTime>0);await vp.evaluate(()=>audio.pause());
  const noSdkCtx=await context({viewport:{width:393,height:852},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/113.0.0.0 Mobile Safari/537.36 MicroMessenger/8.0'});await noSdkCtx.route('**/vendor/supabase.js*',r=>r.abort());const noSdk=await open(noSdkCtx,'person_one');
  assert.equal(await noSdk.locator('#displayName').textContent(),'一号专属资料');await noSdk.waitForFunction(()=>audio.readyState>=2);assert.equal(await noSdk.evaluate(()=>profileSupabase),null);
  await noSdk.evaluate(()=>{audio.loop=true;audio.pause();autoplayPending=true;});await noSdk.locator('.music-play').click();await noSdk.waitForFunction(()=>!audio.paused&&audio.currentTime>0);await noSdk.evaluate(()=>audio.pause());
  const failingCtx=await context();await failingCtx.route('**/rest/v1/homepage_profiles*',r=>r.fulfill({status:503,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body:JSON.stringify({message:'temporary read failure'})}));
  const failedRead=await failingCtx.newPage();await failedRead.goto('http://127.0.0.1:8000/?profile=person_one');await failedRead.waitForFunction(()=>document.getElementById('cloudReadStatus').textContent.includes('资料读取失败'));
  assert(await failedRead.locator('#cloudReadStatus').isVisible());await failingCtx.unroute('**/rest/v1/homepage_profiles*');await failedRead.locator('#cloudReadStatus button').click();await failedRead.waitForFunction(()=>cloudReady);assert.equal(await failedRead.locator('#displayName').textContent(),'一号专属资料');assert(await failedRead.locator('#cloudReadStatus').isHidden());
  // Reset through root administration, preserve data/files, revoke the old identity.
  const firstUser=profiles.get('person_one').owner_id,oldObjects=objects.size;
  rp.once('dialog',d=>d.accept());await rp.locator('#childLinkList .row').filter({hasText:'person_one'}).getByRole('button',{name:'重置密码',exact:true}).click();await rp.waitForFunction(()=>document.getElementById('distributionResult').value.includes('person_one'));
  const newPassword=(await rp.inputValue('#distributionResult')).split('编辑密码：')[1].split('\n')[0];assert.notEqual(newPassword,'one-password-123');assert.notEqual(profiles.get('person_one').owner_id,firstUser);assert.equal(objects.size,oldObjects);assert.equal(profiles.get('person_one').profile_data.profile.name,'一号专属资料');
  await p1.click('#detailClose');await p1.fill('#nameInput','旧会话攻击');await p1.click('#saveBtn');await saved(p1);assert.equal(profiles.get('person_one').profile_data.profile.name,'一号专属资料');
  const newCtx=await context(),np=await open(newCtx,'person_one');await unlock(np,newPassword);await np.fill('#nameInput','重置后仍可编辑');await np.click('#saveBtn');await saved(np);assert.equal(profiles.get('person_one').profile_data.profile.name,'重置后仍可编辑');
  // Export keeps the child namespace and removes password/admin service scripts.
  await np.click('#editBtn');const [download]=await Promise.all([np.waitForEvent('download'),np.click('#publishVisitor')]);
  const snapshot=fs.readFileSync(await download.path(),'utf8');assert(!snapshot.includes('profile-access.js'));
  const sp=await newCtx.newPage();await sp.route('**/child-snapshot.html',r=>r.fulfill({contentType:'text/html',body:snapshot}));await sp.goto('http://127.0.0.1:8000/child-snapshot.html');
  assert.equal(await sp.locator('#displayName').textContent(),'重置后仍可编辑');await sp.close();
  // Missing child must not display the main profile's local draft.
  const missing=await firstCtx.newPage();await missing.goto('http://127.0.0.1:8000/?profile=missing_child');await missing.waitForFunction(()=>document.getElementById('toast').textContent.includes('不存在'));
  assert.notEqual(await missing.locator('#displayName').textContent(),'MAIN_LOCAL_SENTINEL');
  const retainedFiles=[...objects.keys()].filter(path=>path.startsWith('person_one/'));
  rp.once('dialog',d=>d.accept());await rp.locator('#childLinkList .row').filter({hasText:'person_two'}).getByRole('button',{name:'删除子链接',exact:true}).click();await rp.waitForFunction(()=>document.getElementById('distributionStatus').textContent.includes('子链接已删除'));
  assert(profiles.get('person_two').deleted_at);assert(editors.get('person_two').purged_at);assert.deepEqual(profiles.get('person_two').profile_data,{});assert(![...objects.keys()].some(path=>path.startsWith('person_two/')));assert.deepEqual([...objects.keys()].filter(path=>path.startsWith('person_one/')),retainedFiles);
  const gone=await visitorCtx.newPage();await gone.goto('http://127.0.0.1:8000/?profile=person_two');await gone.waitForFunction(()=>document.getElementById('toast').textContent.includes('不存在或已删除'));
  assert.deepEqual(errors,[]);
  console.log('PASS: root creates two links; password-only child login; wrong-link password rejected; per-link sessions in one browser; isolated text/avatar/gallery/MP3 uploads; public playback/preview; root resets password; old session revoked; data/files preserved; child snapshot export; missing-link local draft isolation; public reads without SDK; one-tap manual music in mobile emulation; visible read-error retry; MIME inference/invalid-file rejection; deletion with scoped file cleanup. Real SDK + actual handler + mock services.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
