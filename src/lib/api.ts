import { demoApi } from './demoApi';
import { supabaseApi } from './supabaseApi';
import type { Api } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

// The preview build, or a build with no Supabase settings, runs on demo data.
export const api: Api =
  import.meta.env.MODE !== 'preview' && url && key ? supabaseApi(url, key) : demoApi();
