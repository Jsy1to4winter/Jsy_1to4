// A server can send headers promptly, then stall while the JSON body loads.
// Exercise the real reader timeout with a stream and a virtual browser clock.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/tmp/homepage-validation/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install();
  await page.addInitScript(()=>{
   const original=window.fetch;
   window.fetch=(input,options={})=>{
    if(String(input).includes('/rest/v1/homepage_profiles')){
     const body=new ReadableStream({start(controller){options.signal?.addEventListener('abort',()=>controller.error(new DOMException('Body read aborted','AbortError')));}});
     window.bodyReadStarted=true;
     return Promise.resolve(new Response(body,{status:200,headers:{'content-type':'application/json'}}));
    }
    return original(input,options);
   };
  });
  await page.goto('http://127.0.0.1:8000/',{waitUntil:'domcontentloaded'});
  assert(await page.evaluate(()=>window.bodyReadStarted));
  await page.clock.fastForward(20001);
  await page.waitForFunction(()=>document.getElementById('cloudReadStatus').textContent.includes('云端读取超时'));
  assert.equal(await page.evaluate(()=>cloudReady),false);
  assert.equal(await page.evaluate(()=>cloudReadPromise),null);
  assert(await page.locator('#cloudReadStatus button').isVisible());
  assert.deepEqual(errors,[]);
  console.log('PASS: stalled JSON body times out with a clear network message, read state is cleared, and retry remains available. Browser clock + synthetic stream.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1});
