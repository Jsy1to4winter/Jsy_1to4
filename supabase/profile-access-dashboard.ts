// Paste this entire file into the Supabase Edge Function editor.
import { createClient } from 'npm:@supabase/supabase-js@2.49.8';
type HandlerDependencies = {
  createClient: typeof createClient;
  env: { get(name: string): string | undefined };
  crypto?: Crypto;
  logger?: Pick<Console, 'error' | 'warn'>;
};
// No privileged key is shipped to the browser. Supabase injects backend secrets.
export function createHandler({createClient, env, crypto = globalThis.crypto, logger = console}: HandlerDependencies) {
  const headers = {'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Cache-Control':'no-store', 'Content-Type':'application/json'};
  const reply = (body: unknown, status=200) => new Response(JSON.stringify(body), {status, headers});
  return async (request: Request) => {
    if (request.method === 'OPTIONS') return new Response(null, {status:204, headers});
    if (request.method !== 'POST') return reply({error:'Method not allowed'},405);
    let orphanUser: string | null = null, admin: ReturnType<typeof createClient> | undefined;
    try {
      const text = await request.text();
      if (text.length > 4096) return reply({error:'请求过大'},413);
      let body; try { body=JSON.parse(text); } catch { return reply({error:'请求格式不正确'},400); }
      if (!body || Array.isArray(body) || typeof body !== 'object') return reply({error:'请求格式不正确'},400);
      const {action,slug,password}=body;
      if (!['unlock','list','create','reset'].includes(action)) return reply({error:'操作不支持'},400);
      const url=env.get('SUPABASE_URL'), publicKey=env.get('SUPABASE_ANON_KEY'), serviceKey=env.get('SUPABASE_SERVICE_ROLE_KEY');
      if (!url || !publicKey || !serviceKey) throw Error('Backend environment is incomplete');
      admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
      if (action !== 'list' && (typeof slug!=='string' || !/^[a-z0-9][a-z0-9_-]{2,63}$/.test(slug))) return reply({error:'子链接编号格式不正确'},400);
      if (action === 'unlock') {
        if(typeof password!=='string' || !password || password.length>128) return reply({error:'链接或密码不正确'},401);
        const {data:editor,error:lookupError}=await admin.from('homepage_editors').select('login_email').eq('slug',slug).maybeSingle();
        if(lookupError) throw lookupError;
        if(!editor || typeof editor.login_email!=='string') return reply({error:'链接或密码不正确'},401);
        const {data:allowed,error:limitError}=await admin.rpc('homepage_take_login_attempt',{p_slug:slug});
        if(limitError) throw limitError;
        if(!allowed) return reply({error:'尝试次数过多，请在 15 分钟后重试'},429);
        const client=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
        const {data,error}=await client.auth.signInWithPassword({email:editor.login_email,password});
        if(error || !data.session) return reply({error:'链接或密码不正确'},401);
        return reply({session:{access_token:data.session.access_token,refresh_token:data.session.refresh_token}});
      }
      const bearer=request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
      if(!bearer) return reply({error:'请先用主站管理员账号登录'},401);
      const {data:{user},error:authError}=await admin.auth.getUser(bearer);
      if(authError || !user) return reply({error:'登录已失效'},401);
      const {data:permission,error:permissionError}=await admin.from('homepage_admins').select('user_id').eq('user_id',user.id).maybeSingle();
      if(permissionError) throw permissionError;
      if(!permission) return reply({error:'仅主站管理员可分发或重置子链接'},403);
      if(action==='list') {
        const {data,error}=await admin.from('homepage_editors').select('slug,created_at').order('created_at',{ascending:false});
        if(error) throw error;
        return reply({profiles:data});
      }
      if(slug==='fuguang') return reply({error:'主站管理员继续使用原有邮箱密码登录'},400);
      if(typeof password!=='string' || password.length<12 || password.length>64 || new TextEncoder().encode(password).length>72) return reply({error:'密码须为 12–64 个字符且 UTF-8 长度不超过 72 字节'},400);
      const {data:existing,error:readError}=await admin.from('homepage_editors').select('user_id').eq('slug',slug).maybeSingle();
      if(readError) throw readError;
      const previousUser=existing && typeof existing.user_id==='string' ? existing.user_id : null;
      if(action==='create' && existing) return reply({error:'此子链接已存在，请使用其他编号'},409);
      if(action==='reset' && !previousUser) return reply({error:'子链接不存在'},404);
      const email='profile-'+crypto.randomUUID()+'@profiles.invalid';
      const {data:created,error:createError}=await admin.auth.admin.createUser({email,password,email_confirm:true});
      if(createError || !created.user) throw createError || Error('Auth user creation failed');
      orphanUser=created.user.id;
      const args=action==='create' ? {p_slug:slug,p_user_id:orphanUser,p_email:email} : {p_slug:slug,p_expected_user:previousUser,p_new_user:orphanUser,p_email:email};
      const {error:saveError}=await admin.rpc(action==='create'?'homepage_create_editor':'homepage_replace_editor',args);
      if(saveError) throw saveError;
      orphanUser=null; // Database now owns the identity; do not delete on a later error.
      if(action==='reset' && previousUser) {
        const {error:deleteError}=await admin.auth.admin.deleteUser(previousUser);
        if(deleteError) logger.warn('Old editor identity cleanup failed'); // RLS already revoked access.
      }
      return reply({slug});
    } catch(error) {
      if(orphanUser && admin) {
        try { await admin.auth.admin.deleteUser(orphanUser); } catch { logger.warn('Orphan editor identity cleanup failed'); }
      }
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'BackendError';
      logger.error('profile-access failed',code);
      return reply({error:'服务配置或操作失败，请确认已执行 multi-profile.sql 并检查 Edge Function 日志'},500);
    }
  };
}

Deno.serve(createHandler({ createClient, env: Deno.env }));
