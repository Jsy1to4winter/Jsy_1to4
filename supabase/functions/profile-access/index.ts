import { createClient } from 'npm:@supabase/supabase-js@2.49.8';
import { createHandler } from './handler.mjs';
Deno.serve(createHandler({ createClient, env: Deno.env }));
