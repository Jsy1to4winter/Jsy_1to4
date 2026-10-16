/* Public project settings. Privileged keys must never be added here. */
window.SUPABASE_URL = 'https://nedsvrzbsrethlyyoqey.supabase.co';
window.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_kc6Gyp_6GY0VoCeL3iQ4GA_EtDhQF10';
window.PROFILE_SLUG = new URLSearchParams(location.search).get('profile') ?? 'fuguang';
window.profileSupabase = null;
window.profileSetupError = null;
try {
  if (!window.supabase?.createClient) throw Error('云端组件加载失败，请刷新页面后重试');
  window.profileSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {storageKey: 'homepage-auth:' + encodeURIComponent(PROFILE_SLUG)}
  });
} catch (error) { window.profileSetupError = error; }
window.profileClientReady = function () {
  if (!window.profileSupabase) throw window.profileSetupError || Error('云端组件尚未加载，请刷新页面');
  return window.profileSupabase;
};
