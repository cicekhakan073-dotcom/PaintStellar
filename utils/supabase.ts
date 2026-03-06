// utils/supabase.ts
import { createClient } from '@supabase/supabase-js';

// Vercel'e eklediğimiz ortam değişkenlerini çekiyoruz
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wfbjinfihduwgbuhwmeo.supabase.co';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndmYmppbmZpaGR1d2didWh3bWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3MTYzOTcsImV4cCI6MjA4ODI5MjM5N30.cL9j3Enj6LZ_Cd-Ki7ox3IE9gMB633b9XcQUzqE09G8';
// Köprüyü kuruyoruz
export const supabase = createClient(supabaseUrl, supabaseKey);