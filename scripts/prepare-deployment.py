"""Generate paste-ready Supabase artifacts from the tested source files."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
parts = []
for name in ('setup.sql', 'multi-profile.sql'):
    source = (root / 'supabase' / name).read_text()
    parts.append('\n'.join(line for line in source.splitlines() if line.strip().lower() not in ('begin;', 'commit;')))
(root / 'supabase/install.sql').write_text('-- Complete installation/update. Preserves existing profiles and files.\nbegin;\n' + '\n\n'.join(parts) + '\ncommit;\n')
handler = (root / 'supabase/functions/profile-access/handler.mjs').read_text()
handler = handler.replace(
    'logger = console}) {',
    'logger = console}: HandlerDependencies) {'
).replace('const reply = (body,', 'const reply = (body: unknown,').replace(
    'return async request =>', 'return async (request: Request) =>'
).replace('let orphanUser = null, admin;', 'let orphanUser: string | null = null, admin: ReturnType<typeof createClient> | undefined;')
types = '''type HandlerDependencies = {
  createClient: typeof createClient;
  env: { get(name: string): string | undefined };
  crypto?: Crypto;
  logger?: Pick<Console, 'error' | 'warn'>;
};
'''
(root / 'supabase/profile-access-dashboard.ts').write_text(
    '// Paste this entire file into the Supabase Edge Function editor.\n'
    "import { createClient } from 'npm:@supabase/supabase-js@2.49.8';\n"
    + types + handler + '\nDeno.serve(createHandler({ createClient, env: Deno.env }));\n'
)
print('Generated supabase/install.sql and supabase/profile-access-dashboard.ts')
