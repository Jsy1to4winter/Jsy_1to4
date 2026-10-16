// Execute the shipped SQL in embedded PostgreSQL. Auth/Storage schemas emulate Supabase.
const {PGlite} = require(process.env.PGLITE_MODULE || '/tmp/homepage-validation/node_modules/@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const owner='00000000-0000-4000-8000-000000000001', other='00000000-0000-4000-8000-000000000002';
(async()=>{
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create schema auth; create schema storage;
 create table auth.users(id uuid primary key,email text);
 insert into auth.users values ('${owner}','admin@example.com'),('${other}','other@example.com');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 create function storage.foldername(text) returns text[] language sql immutable as $$ select string_to_array($1,'/') $$;
 alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to anon,authenticated;
 grant select,insert,update,delete on storage.objects to anon,authenticated;
 create policy old_unsafe_storage on storage.objects for all to anon,authenticated using(true) with check(true);`);
 const sql=fs.readFileSync(__dirname+'/../supabase/setup.sql','utf8').replaceAll('YOUR_ADMIN_EMAIL','admin@example.com');
 await db.exec(sql);await db.exec(sql); // Repeated setup preserves owner/data and remains executable.
 await db.exec('create policy old_unsafe_table on public.homepage_profiles for all to anon,authenticated using(true) with check(true)');
 async function role(name,id='') {await db.exec(`reset role; set role ${name}; select set_config('request.jwt.claim.sub','${id}',false);`);}
 async function denied(sql) {let error;try{await db.exec(sql)}catch(e){error=e}assert(error,'Expected permission rejection: '+sql);}
 await role('anon');
 assert.equal((await db.query('select * from public.homepage_profiles')).rows.length,1);
 await denied("update public.homepage_profiles set profile_data='{}'");
 await denied("insert into public.homepage_profiles(slug,owner_id) values('x','"+other+"')");
 await denied('delete from public.homepage_profiles');
 await denied("insert into storage.objects(bucket_id,name) values('homepage-media','fuguang/anon.png')");
 await role('authenticated',owner);
 const before=(await db.query('select updated_at from public.homepage_profiles')).rows[0].updated_at;
 await db.exec(`update public.homepage_profiles set profile_data='{"profile":{"name":"owner saved"}}',updated_at='2000-01-01' where slug='fuguang'`);
 const after=(await db.query('select updated_at,profile_data from public.homepage_profiles')).rows[0];
 assert.equal(after.profile_data.profile.name,'owner saved');assert.notEqual(after.updated_at,before);assert(!String(after.updated_at).startsWith('2000'));
 await denied(`update public.homepage_profiles set owner_id='${other}'`);
 await db.exec("insert into storage.objects(bucket_id,name) values('homepage-media','fuguang/owner.png')");
 await role('authenticated',other);
 assert.equal((await db.query("update public.homepage_profiles set profile_data='{}' returning slug")).rows.length,0);
 await denied("insert into storage.objects(bucket_id,name) values('homepage-media','fuguang/outsider.png')");
 assert.equal((await db.query("delete from storage.objects where bucket_id='homepage-media' returning name")).rows.length,0);
 assert.equal((await db.query("update storage.objects set name='fuguang/stolen.png' where bucket_id='homepage-media' returning name")).rows.length,0);
 await role('anon');assert.equal((await db.query("select * from storage.objects where bucket_id='homepage-media'")).rows.length,1);
 assert.equal((await db.query("delete from storage.objects where bucket_id='homepage-media' returning name")).rows.length,0);
 await role('authenticated',owner);assert.equal((await db.query("delete from storage.objects where bucket_id='homepage-media' returning name")).rows.length,1);
 console.log('PASS: SQL repeatability; public reads; owner writes; server version timestamp; anon/other-user database and Storage writes denied even with legacy permissive policies. Embedded PostgreSQL, not live Supabase.');
 await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
