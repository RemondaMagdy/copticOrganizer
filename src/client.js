
let supabase_url=import.meta.env.VITE_SUPABASE_URL;
let supabase_key=import.meta.env.VITE_SUPABASE_ANON_KEY;
const client=supabase.createClient(supabase_url,supabase_key);
export{client};