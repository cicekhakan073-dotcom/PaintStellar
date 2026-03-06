// utils/supabase.ts
import { createClient } from '@supabase/supabase-js';

// Vercel'e eklediğimiz ortam değişkenlerini çekiyoruz
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wfbjinfihduwgbuhwmeo.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_BI0BSm5EPMAq2jAsMFMJjA_SxJd_w0O';
// Köprüyü kuruyoruz
export const supabase = createClient(supabaseUrl, supabaseKey);