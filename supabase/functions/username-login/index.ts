import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
  try {
    const { username, password } = await req.json();
    if (typeof username !== "string" || typeof password !== "string" || !username.trim() || !password) return new Response(JSON.stringify({ error: "أدخل اسم المستخدم وكلمة المرور" }), { status: 400, headers: cors });
    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: profile, error: lookupError } = await admin.from("profiles").select("id,active").ilike("username", username.trim()).maybeSingle();
    if (lookupError || !profile || !profile.active) return new Response(JSON.stringify({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" }), { status: 400, headers: cors });
    const { data: userData, error: userError } = await admin.auth.admin.getUserById(profile.id);
    if (userError || !userData.user?.email) return new Response(JSON.stringify({ error: "تعذر العثور على حساب الدخول المرتبط" }), { status: 400, headers: cors });
    const publicClient = createClient(url, anon, { auth: { persistSession: false } });
    const { data, error } = await publicClient.auth.signInWithPassword({ email: userData.user.email, password });
    if (error || !data.session) return new Response(JSON.stringify({ error: "اسم المستخدم أو كلمة المرور غير صحيحة" }), { status: 400, headers: cors });
    return new Response(JSON.stringify({ access_token: data.session.access_token, refresh_token: data.session.refresh_token }), { status: 200, headers: cors });
  } catch { return new Response(JSON.stringify({ error: "طلب غير صالح" }), { status: 400, headers: cors }); }
});
