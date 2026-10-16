import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/profile-access/handler.mjs';
const users=new Map([['root',{id:'root',email:'root@example.com'}]]),editors=new Map(),profiles=new Map(),attempts=new Map();
const deleted=[];let nextId=0,failRpc=false;
const admin={
 from(table) {
   let filter;
   return {
     select(){return this;},eq(key,value){filter={key,value};return this;},
     async maybeSingle(){
       if(table==='homepage_admins')return {data:filter.value==='root'?{user_id:'root'}:null};
       return {data:editors.get(filter.value)||null};
     },
     async order(){return {data:[...editors].map(([slug])=>({slug,created_at:'2026-10-16T00:00:00Z'}))};}
   };
 },
 auth:{
   async getUser(token){return {data:{user:users.get(token)||null}};},
   admin:{
     async createUser({email,password}) {const user={id:'editor-'+(++nextId),email,password};users.set(user.id,user);return {data:{user}};},
     async deleteUser(id) {deleted.push(id);users.delete(id);return {};}
   }
 },
 async rpc(name,args) {
   if(failRpc)return {error:{code:'TEST_ERROR'}};
   if(name==='homepage_take_login_attempt') {const n=(attempts.get(args.p_slug)||0)+1;attempts.set(args.p_slug,n);return {data:n<=20};}
   if(name==='homepage_create_editor') {
     assert(!editors.has(args.p_slug));editors.set(args.p_slug,{user_id:args.p_user_id,login_email:args.p_email});profiles.set(args.p_slug,{owner_id:args.p_user_id,profile_data:{keep:'media'}});return {};
   }
   assert.equal(name,'homepage_replace_editor');const existing=editors.get(args.p_slug);assert.equal(existing.user_id,args.p_expected_user);
   editors.set(args.p_slug,{user_id:args.p_new_user,login_email:args.p_email});profiles.get(args.p_slug).owner_id=args.p_new_user;attempts.delete(args.p_slug);return {};
 }
};
const publicClient={auth:{async signInWithPassword({email,password}) {
 const user=[...users.values()].find(x=>x.email===email && x.password===password);
 return user?{data:{session:{access_token:user.id,refresh_token:'refresh-'+user.id}}}:{data:{session:null},error:Error('Invalid password')};
}}};
const handler=createHandler({createClient:(_url,key)=>key==='server-secret'?admin:publicClient,env:{get:name=>({SUPABASE_URL:'https://test.supabase.co',SUPABASE_ANON_KEY:'public',SUPABASE_SERVICE_ROLE_KEY:'server-secret'})[name]},logger:{warn(){},error(){}}});
async function call(body,token){const headers={'content-type':'application/json'};if(token)headers.authorization='Bearer '+token;const result=await handler(new Request('https://test/functions/v1/profile-access',{method:'POST',headers,body:JSON.stringify(body)}));return {status:result.status,body:await result.json()};}
assert.equal((await handler(new Request('https://test',{method:'OPTIONS'}))).status,204);
assert.equal((await handler(new Request('https://test',{method:'GET'}))).status,405);
assert.equal((await call({action:'create',slug:'person_a',password:'secure-password-123'})).status,401);
assert.equal((await call({action:'create',slug:'fuguang',password:'secure-password-123'},'root')).status,400);
assert.equal((await call({action:'create',slug:'bad/path',password:'secure-password-123'},'root')).status,400);
assert.equal((await call({action:'create',slug:'person_a',password:'short'},'root')).status,400);
assert.equal((await call({action:'create',slug:'person_a',password:'secure-password-123'},'root')).status,200);
const firstOwner=profiles.get('person_a').owner_id;
assert.equal((await call({action:'create',slug:'person_a',password:'secure-password-123'},'root')).status,409);
assert.equal((await call({action:'unlock',slug:'person_a',password:'wrong'})).status,401);
const login=await call({action:'unlock',slug:'person_a',password:'secure-password-123'});
assert.equal(login.status,200);assert.equal(login.body.session.access_token,firstOwner);assert(!JSON.stringify(login.body).includes('server-secret'));assert(!JSON.stringify(login.body).includes('profiles.invalid'));
assert.equal((await call({action:'list'},firstOwner)).status,403);
assert.equal((await call({action:'create',slug:'person_b',password:'another-password-123'},firstOwner)).status,403);
assert.equal((await call({action:'create',slug:'person_b',password:'another-password-123'},'root')).status,200);
assert.equal((await call({action:'unlock',slug:'person_b',password:'secure-password-123'})).status,401);
const list=await call({action:'list'},'root');assert.deepEqual(list.body.profiles.map(x=>x.slug),['person_a','person_b']);assert(!JSON.stringify(list.body).includes('login_email'));
assert.equal((await call({action:'reset',slug:'person_a',password:'new-password-123'},'root')).status,200);
assert.notEqual(profiles.get('person_a').owner_id,firstOwner);assert(deleted.includes(firstOwner));assert.equal(profiles.get('person_a').profile_data.keep,'media');
assert.equal((await call({action:'unlock',slug:'person_a',password:'secure-password-123'})).status,401);
assert.equal((await call({action:'unlock',slug:'person_a',password:'new-password-123'})).status,200);
attempts.set('person_a',20);assert.equal((await call({action:'unlock',slug:'person_a',password:'new-password-123'})).status,429);
failRpc=true;const count=users.size;assert.equal((await call({action:'create',slug:'person_c',password:'new-password-123'},'root')).status,500);assert.equal(users.size,count);assert(!profiles.has('person_c'));
console.log('PASS: shipped handler logic — password-only unlock, root-only creation/list/reset, cross-link passwords rejected, no privileged/email response leakage, throttling, identity rotation, failed-create cleanup. Mock Auth/database.');
