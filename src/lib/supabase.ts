import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Server-side client using the service role key (bypasses RLS for API routes)
export const supabase = createClient(supabaseUrl, supabaseServiceKey);
