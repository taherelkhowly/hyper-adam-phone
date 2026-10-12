import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const cors = {
  "Access-Control-Allow-Origin": "https://taherelkholy.github.io",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
  "Vary": "Origin",
  "Content-Type": "application/json; charset=utf-8"
};
const roles = ["admin", "sales_supervisor", "sales", "warehouse", "shipping_supervisor", "courier", "accountant"];
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: cors });
  try {
    const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
    if (!token) return new Response(JSON.stringify({ error: "تسجيل الدخول مطلوب" }), { status: 401, headers: cors });
    const url = Deno.env.get("SUPABASE_URL")!; const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!; const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const callerClient = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return new Response(JSON.stringify({ error: "جلسة غير صالحة" }), { status: 401, headers: cors });
    const admin = createClient(url, service, { auth: { persistSession: false } });
    const { data: me } = await admin.from("profiles").select("role,active").eq("id", caller.id).maybeSingle();
    if (!me?.active || !["admin", "owner"].includes(me.role)) return new Response(JSON.stringify({ error: "هذه العملية متاحة للمدير فقط" }), { status: 403, headers: cors });
    const body = await req.json(); const full_name = String(body.full_name || "").trim(); const username = String(body.username || "").trim().toLowerCase(); const email = String(body.email || "").trim().toLowerCase(); const password = String(body.password || ""); const role = String(body.role || "sales");
    if (!full_name || !/^[a-z0-9._-]{3,40}$/.test(username) || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8 || !roles.includes(role)) return new Response(JSON.stringify({ error: "راجع الاسم واسم المستخدم والبريد وكلمة المرور والصلاحية" }), { status: 400, headers: cors });
    const { data: existing } = await admin.from("profiles").select("id").ilike("username", username).maybeSingle();
    if (existing) return new Response(JSON.stringify({ error: "اسم المستخدم مستخدم بالفعل" }), { status: 409, headers: cors });
    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { username, full_name } });
    if (createError || !created.user) return new Response(JSON.stringify({ error: createError?.message || "تعذر إنشاء الحساب" }), { status: 400, headers: cors });
    const { error: profileError } = await admin.from("profiles").insert({ id: created.user.id, full_name, username, role, active: true });
    if (profileError) { await admin.auth.admin.deleteUser(created.user.id); return new Response(JSON.stringify({ error: profileError.message }), { status: 400, headers: cors }); }
    return new Response(JSON.stringify({ ok: true, user_id: created.user.id, username }), { status: 201, headers: cors });
  } catch { return new Response(JSON.stringify({ error: "حدث خطأ أثناء إنشاء المستخدم" }), { status: 400, headers: cors }); }
});
