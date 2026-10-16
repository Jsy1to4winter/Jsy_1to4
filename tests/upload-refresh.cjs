// Reproduce mobile file-picker return: focus/pageshow refresh starts just before
// the selected file's change event. Hold that GET until the upload is queued.
const assert=require('node:assert/strict');
module.exports=async function uploadDuringRefresh(page,payload,onWaiting){
 const openIds=await page.locator('.editor.open').evaluateAll(nodes=>nodes.map(n=>n.id));
 let release,started,readCount=0;
 const gate=new Promise(resolve=>{release=resolve});
 const seen=new Promise(resolve=>{started=resolve});
 const pattern='**/rest/v1/homepage_profiles*';
 const intercept=async route=>{
  const request=route.request(),url=new URL(request.url());
  if(request.method()==='GET'&&url.searchParams.get('select')?.includes('profile_data')){
   readCount++;started();await gate;
  }
  await route.fallback();
 };
 await page.route(pattern,intercept);
 let state;
 try{
  await page.evaluate(()=>{
   document.querySelectorAll('.editor.open').forEach(node=>node.classList.remove('open'));
   window.dispatchEvent(new Event('focus'));
   window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));
   document.dispatchEvent(new Event('visibilitychange'));
  });
  await seen;
  await page.locator('#musicInput').setInputFiles(payload);
  state=await page.evaluate(()=>({waiting:cloudBusy,ready:cloudReady,message:document.getElementById('toast').textContent}));
  if(onWaiting)await onWaiting();
 }finally{
  release();
  await page.waitForFunction(()=>cloudReady&&!cloudBusy);
  await page.unroute(pattern,intercept);
  await page.evaluate(ids=>ids.forEach(id=>document.getElementById(id)?.classList.add('open')),openIds);
 }
 assert(state.waiting,'MP3 upload was rejected instead of waiting for the file-picker refresh: '+state.message);
 assert.equal(readCount,1,'Focus/pageshow/visibility refreshes must share one in-flight public read');
};
