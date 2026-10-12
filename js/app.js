(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const config = window.HAP_CONFIG || {};
  const configured = config.SUPABASE_URL && !config.SUPABASE_URL.includes("YOUR-PROJECT-REF")
    && config.SUPABASE_ANON_KEY && !config.SUPABASE_ANON_KEY.includes("YOUR_SUPABASE");
  let client = null, currentUser = null, currentProfile = null, products = [], orders = [], presenceTimer = null;
  const statusLabels = {
    new:"جديد", review:"تحت المراجعة", approved:"معتمد", preparing:"جاري التجهيز",
    ready_to_ship:"جاهز للشحن", handed_to_courier:"استلمه المندوب",
    out_for_delivery:"خرج للتوصيل", delivered:"تم التسليم", delivery_failed:"تعذر التسليم",
    return_pending:"مرتجع قيد المراجعة", returned:"تم الإرجاع", cancelled:"ملغي",
    completed_in_store:"مكتمل داخل المحل"
  };
  const channelLabels = {online:"أونلاين",store:"داخل المحل"};
  const money = (v) => `${Number(v || 0).toLocaleString("ar-EG",{minimumFractionDigits:2,maximumFractionDigits:2})} ج.م`;
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function toast(message, error=false) {
    const el=$("toast"); el.textContent=message; el.classList.toggle("error-toast",error); el.classList.add("show");
    setTimeout(()=>el.classList.remove("show"),3500);
  }
  function showScreen(id) {
    ["setup-screen","login-screen","app-screen"].forEach(x=>$(x).classList.toggle("hidden",x!==id));
  }
  function setMessage(id, text, error=false) {
    const el=$(id); el.textContent=text; el.style.color=error?"#c24141":"#16845a";
  }
  function showPage(page) {
    document.querySelectorAll(".page").forEach(el=>el.classList.add("hidden"));
    const target=$("page-"+page); if(target) target.classList.remove("hidden");
    document.querySelectorAll(".nav-item").forEach(el=>el.classList.toggle("active",el.dataset.page===page));
    const names={dashboard:"لوحة التحكم",orders:"الأوردرات","new-order":"إنشاء أوردر",products:"المنتجات والمخزون",shipping:"الشحن والتوصيل",users:"إدارة المستخدمين",online:"متصل الآن"};
    $("page-title").textContent=names[page]||"النظام";
    if(page==="dashboard") loadDashboard();
    if(page==="orders") loadOrders();
    if(page==="products") loadProducts();
    if(page==="new-order") prepareOrderForm();
    if(page==="shipping") loadShipping();
    if(page==="users") loadUsers();
    if(page==="online") loadOnline();
    if(currentUser) updatePresence(page, `فتح صفحة ${names[page]||page}`);
  }
  async function loadProfile(user) {
    const {data,error}=await client.from("profiles").select("id,full_name,username,role,active").eq("id",user.id).maybeSingle();
    if(error) throw error;
    if(!data || !data.active) throw new Error("الحساب غير مفعل أو لم يتم إنشاء ملف الموظف. راجع مدير النظام.");
    currentProfile=data;
    $("user-summary").innerHTML=`<strong>${esc(data.full_name)}</strong><br>${esc(roleLabel(data.role))}`;
    applyRoleNavigation(data.role);
  }
  function roleLabel(role) {
    return ({owner:"مالك النظام",admin:"مدير النظام",sales_supervisor:"مشرف المبيعات",sales:"موظف مبيعات",warehouse:"أمين المخزن",shipping_supervisor:"مشرف الشحن",courier:"مندوب توصيل",accountant:"محاسب"})[role]||role;
  }
  function applyRoleNavigation(role) {
    const allowed = {
      owner:["dashboard","orders","new-order","products","shipping","users","online"],
      admin:["dashboard","orders","new-order","products","shipping","users","online"],
      sales_supervisor:["dashboard","orders","new-order"],
      sales:["dashboard","orders","new-order"],
      warehouse:["dashboard","orders","products"],
      shipping_supervisor:["dashboard","orders","shipping"],
      courier:["dashboard","shipping"],
      accountant:["dashboard","orders","shipping"]
    }[role] || ["dashboard"];
    document.querySelectorAll(".nav-item").forEach(el=>el.classList.toggle("hidden",!allowed.includes(el.dataset.page)));
    showPage(allowed[0]);
  }
  async function boot() {
    if(!configured || !window.supabase) { showScreen("setup-screen"); return; }
    client=window.supabase.createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY);
    try {
      const {data:{session},error}=await client.auth.getSession();
      if(error) throw error;
      if(session?.user) await enterApp(session.user); else showScreen("login-screen");
      client.auth.onAuthStateChange((_event,session)=> {
        if(session?.user) enterApp(session.user).catch(e=>{toast(e.message,true);client.auth.signOut();});
        else {currentUser=null;currentProfile=null;showScreen("login-screen");}
      });
    } catch(e) { showScreen("login-screen"); toast(e.message,true); }
  }
  async function enterApp(user) {
    currentUser=user;
    await loadProfile(user);
    showScreen("app-screen");
    await updatePresence("dashboard","تسجيل الدخول إلى النظام");
    if(presenceTimer) clearInterval(presenceTimer);
    presenceTimer=setInterval(()=>updatePresence(document.querySelector(".nav-item.active")?.dataset.page||"dashboard","نشط داخل النظام"),30000);
  }
  $("login-form").addEventListener("submit",async e=>{
    e.preventDefault(); if(!client) return;
    $("login-error").textContent="";
    const username=$("username").value.trim().toLowerCase(),password=$("password").value;
    const {data,error}=await client.functions.invoke("username-login",{body:{username,password}});
    if(!error && data?.access_token && data?.refresh_token){ const {error:setError}=await client.auth.setSession({access_token:data.access_token,refresh_token:data.refresh_token}); if(setError){$("login-error").textContent="تعذر بدء الجلسة: "+setError.message;return;} }
    if(error){$("login-error").textContent="تعذر تسجيل الدخول باسم المستخدم: "+error.message;return;}
    const signedUser=(await client.auth.getUser()).data.user;
    if(!signedUser){$("login-error").textContent="لم يتم إنشاء جلسة دخول. تأكد من نشر وظيفة username-login.";return;}
    try { await enterApp(signedUser); } catch(err) {$("login-error").textContent=err.message;await client.auth.signOut();}
  });
  $("logout-btn").addEventListener("click",async()=>{if(client) await client.auth.signOut();});
  $("main-nav").addEventListener("click",e=>{const b=e.target.closest("[data-page]");if(b&&!b.classList.contains("hidden"))showPage(b.dataset.page);});
  document.addEventListener("click",e=>{const b=e.target.closest("[data-go]");if(b)showPage(b.dataset.go);});
  $("order-status-filter").innerHTML += Object.entries(statusLabels).map(([v,l])=>`<option value="${v}">${l}</option>`).join("");
  async function loadDashboard() {
    if(!client)return;
    try {
      const [o,p]=await Promise.all([
        client.from("orders").select("id,order_no,status,channel,total,created_at,recipient_name,customer_id,customers(full_name,phone)").order("created_at",{ascending:false}).limit(200),
        client.from("products").select("id",{count:"exact",head:true})
      ]);
      if(o.error)throw o.error;if(p.error)throw p.error;
      orders=o.data||[];
      $("stat-orders").textContent=orders.length.toLocaleString("ar-EG");
      $("stat-pending").textContent=orders.filter(x=>!["delivered","returned","cancelled","completed_in_store"].includes(x.status)).length.toLocaleString("ar-EG");
      $("stat-delivered").textContent=orders.filter(x=>x.status==="delivered").length.toLocaleString("ar-EG");
      $("stat-products").textContent=(p.count||0).toLocaleString("ar-EG");
      $("recent-orders").innerHTML=orders.slice(0,8).map(orderRow).join("")||'<tr><td colspan="6" class="empty">لا توجد أوردرات بعد</td></tr>';
    } catch(e){toast("تعذر تحميل لوحة التحكم: "+e.message,true);}
  }
  function badge(status) {
    const cls=["delivered","completed_in_store"].includes(status)?"green":["cancelled","returned"].includes(status)?"red":["delivery_failed","return_pending"].includes(status)?"amber":"";
    return `<span class="badge ${cls}">${esc(statusLabels[status]||status)}</span>`;
  }
  function orderRow(o) {
    const c=o.customers||{};
    return `<tr><td><strong>${esc(o.order_no)}</strong></td><td>${esc(o.recipient_name||c.full_name||"—")}</td><td>${esc(channelLabels[o.channel]||o.channel)}</td><td>${money(o.total)}</td><td>${badge(o.status)}</td><td>${new Date(o.created_at).toLocaleDateString("ar-EG")}</td></tr>`;
  }
  async function loadOrders() {
    if(!client)return;
    try {
      const {data,error}=await client.from("orders").select("id,order_no,status,channel,total,created_at,recipient_name,recipient_phone,customer_id,customers(full_name,phone)").order("created_at",{ascending:false}).limit(500);
      if(error)throw error;orders=data||[];renderOrders();
    } catch(e){toast("تعذر تحميل الأوردرات: "+e.message,true);}
  }
  function renderOrders() {
    const q=$("order-search").value.trim().toLowerCase(),st=$("order-status-filter").value;
    const filtered=orders.filter(o=>{
      const c=o.customers||{},hay=[o.order_no,o.recipient_name,c.full_name,o.recipient_phone,c.phone].join(" ").toLowerCase();
      return (!q||hay.includes(q))&&(!st||o.status===st);
    });
    $("orders-table").innerHTML=filtered.map(o=>{
      const c=o.customers||{};
      return `<tr><td><strong>${esc(o.order_no)}</strong></td><td>${esc(o.recipient_name||c.full_name||"—")}</td><td>${esc(o.recipient_phone||c.phone||"—")}</td><td>${esc(channelLabels[o.channel]||o.channel)}</td><td>${money(o.total)}</td><td>${badge(o.status)}</td><td>${new Date(o.created_at).toLocaleDateString("ar-EG")}</td></tr>`;
    }).join("")||'<tr><td colspan="7" class="empty">لا توجد نتائج</td></tr>';
  }
  $("order-search").addEventListener("input",renderOrders);
  $("order-status-filter").addEventListener("change",renderOrders);

  async function loadProducts() {
    if(!client)return;
    try {
      const {data,error}=await client.from("products").select("id,name,sku,barcode,selling_price,inventory_balances(quantity_on_hand,quantity_reserved)").eq("active",true).order("name").limit(1000);
      if(error)throw error;products=data||[];
      $("products-table").innerHTML=products.map(p=>{
        const inv=Array.isArray(p.inventory_balances)?p.inventory_balances[0]:p.inventory_balances;
        const on=Number(inv?.quantity_on_hand||0),reserved=Number(inv?.quantity_reserved||0);
        return `<tr><td>${esc(p.name)}</td><td>${esc(p.sku)}</td><td>${esc(p.barcode||"—")}</td><td>${money(p.selling_price)}</td><td>${on}</td><td>${on-reserved}</td></tr>`;
      }).join("")||'<tr><td colspan="6" class="empty">لا توجد منتجات مسجلة</td></tr>';
    } catch(e){toast("تعذر تحميل المنتجات: "+e.message,true);}
  }
  $("product-form").addEventListener("submit",async e=>{
    e.preventDefault();if(!client)return;
    const product={name:$("product-name").value.trim(),sku:$("product-sku").value.trim(),barcode:$("product-barcode").value.trim()||null,purchase_cost:Number($("product-cost").value),selling_price:Number($("product-price").value)};
    const {error}=await client.from("products").insert(product);
    if(error){toast("تعذر إضافة المنتج: "+error.message,true);return;}
    e.target.reset();toast("تمت إضافة المنتج. أضف الرصيد الافتتاحي عبر حركة مخزنية معتمدة.");loadProducts();
  });

  const pageLabels={dashboard:"لوحة التحكم",orders:"الأوردرات","new-order":"إنشاء أوردر",products:"المنتجات والمخزون",shipping:"الشحن والتوصيل",users:"إدارة المستخدمين",online:"متصل الآن"};
  async function updatePresence(page, activity) {
    if(!client||!currentUser||!currentProfile)return;
    try { await client.from("online_sessions").upsert({user_id:currentUser.id,username:currentProfile.username||currentUser.user_metadata?.username||"—",full_name:currentProfile.full_name,current_page:pageLabels[page]||page,current_activity:activity,last_seen_at:new Date().toISOString()}, {onConflict:"user_id"}); } catch(e) { console.debug("presence update unavailable",e.message); }
  }
  async function loadUsers() {
    if(!client||!currentProfile||!['admin','owner'].includes(currentProfile.role))return;
    const {data,error}=await client.from("profiles").select("id,full_name,username,role,active,created_at").order("created_at",{ascending:false});
    if(error){toast("تعذر عرض المستخدمين: "+error.message,true);return;}
    $("users-table").innerHTML=(data||[]).map(u=>`<tr><td>${esc(u.full_name)}</td><td>${esc(u.username||"—")}</td><td>${esc(roleLabel(u.role))}</td><td>${u.active?"نشط":"موقوف"}</td></tr>`).join("")||'<tr><td colspan="4" class="empty">لا يوجد مستخدمون</td></tr>';
  }
  async function loadOnline() {
    if(!client||!currentProfile||!['admin','owner'].includes(currentProfile.role))return;
    const cutoff=new Date(Date.now()-90000).toISOString();
    const {data,error}=await client.from("online_sessions").select("user_id,username,full_name,current_page,current_activity,last_seen_at").gte("last_seen_at",cutoff).order("last_seen_at",{ascending:false});
    if(error){toast("تعذر تحميل المتصلين: "+error.message,true);return;}
    $("online-table").innerHTML=(data||[]).map(u=>`<tr><td>${esc(u.full_name||"—")}</td><td>${esc(u.username||"—")}</td><td>${esc(u.current_page||"—")}</td><td>${esc(u.current_activity||"—")}</td><td>${new Date(u.last_seen_at).toLocaleTimeString("ar-EG")}</td></tr>`).join("")||'<tr><td colspan="5" class="empty">لا يوجد مستخدمون نشطون خلال آخر 90 ثانية</td></tr>';
  }
  $("user-create-form").addEventListener("submit",async e=>{
    e.preventDefault(); if(!client||!currentUser)return;
    const submit=e.submitter;submit.disabled=true;setMessage("user-create-message","جارٍ إنشاء الحساب...");
    try {
      const {data,error}=await client.functions.invoke("admin-create-user",{body:{full_name:$("new-user-name").value.trim(),username:$("new-username").value.trim().toLowerCase(),email:$("new-user-email").value.trim(),password:$("new-user-password").value,role:$("new-user-role").value}});
      if(error)throw error; if(data?.error)throw new Error(data.error);
      e.target.reset();setMessage("user-create-message","تم إنشاء المستخدم بنجاح.");await loadUsers();
    } catch(err){setMessage("user-create-message","تعذر إنشاء المستخدم: "+err.message,true);}
    finally{submit.disabled=false;}
  });
  $("refresh-users").addEventListener("click",loadUsers);$("refresh-online").addEventListener("click",loadOnline);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden&&currentUser)updatePresence(document.querySelector(".nav-item.active")?.dataset.page||"dashboard","عاد إلى نافذة النظام");});
  document.addEventListener("click",e=>{const el=e.target.closest("button,input,select");if(el&&currentUser)updatePresence(document.querySelector(".nav-item.active")?.dataset.page||"dashboard",`تفاعل مع ${el.innerText||el.getAttribute("aria-label")||el.id||el.tagName}`);});

  function lineTemplate() {
    const wrap=document.createElement("div");wrap.className="order-line";
    wrap.innerHTML=`<div class="line-product"><label>المنتج</label><select class="line-product-select" required><option value="">اختر المنتج</option></select></div><div><label>الكمية</label><input class="line-qty" type="number" min="1" step="1" value="1" required></div><div><label>سعر الوحدة</label><input class="line-price" type="number" min="0" step="0.01" required></div><button class="remove-line" type="button" title="حذف الصنف" aria-label="حذف الصنف">×</button>`;
    const select=wrap.querySelector("select");
    products.forEach(p=>{const o=document.createElement("option");o.value=p.id;o.textContent=`${p.name} — ${p.sku} — ${money(p.selling_price)}`;o.dataset.price=p.selling_price;select.appendChild(o);});
    select.addEventListener("change",()=>{const opt=select.selectedOptions[0];wrap.querySelector(".line-price").value=opt?.dataset.price||"";updateTotal();});
    wrap.querySelectorAll("input").forEach(i=>i.addEventListener("input",updateTotal));
    wrap.querySelector(".remove-line").addEventListener("click",()=>{wrap.remove();updateTotal();});
    return wrap;
  }
  async function prepareOrderForm() {
    if(!client)return;
    const {data,error}=await client.from("products").select("id,name,sku,selling_price,purchase_cost").eq("active",true).order("name").limit(1000);
    if(error){toast("تعذر تحميل قائمة المنتجات: "+error.message,true);return;}
    products=data||[];
    if(!$("order-lines").children.length)addLine();
  }
  function addLine(){ $("order-lines").appendChild(lineTemplate()); updateTotal(); }
  $("add-line-btn").addEventListener("click",()=>{if(products.length===0){toast("أضف المنتجات أولًا ثم أنشئ الأوردر.",true);return;}addLine();});
  function collectLines() {
    return [...$("order-lines").querySelectorAll(".order-line")].map(el=>{
      const id=el.querySelector(".line-product-select").value;
      const p=products.find(x=>x.id===id);
      return {el,product:p,quantity:Number(el.querySelector(".line-qty").value),price:Number(el.querySelector(".line-price").value)};
    }).filter(x=>x.product&&Number.isInteger(x.quantity)&&x.quantity>0&&Number.isFinite(x.price)&&x.price>=0);
  }
  function updateTotal() {
    const subtotal=collectLines().reduce((s,l)=>s+l.quantity*l.price,0);
    const discount=Math.max(0,Number($("discount").value)||0),shipping=Math.max(0,Number($("shipping-fee").value)||0);
    $("order-total").textContent=money(Math.max(0,subtotal-discount+shipping));
  }
  $("discount").addEventListener("input",updateTotal);$("shipping-fee").addEventListener("input",updateTotal);
  $("new-order-form").addEventListener("reset",()=>setTimeout(()=>{$("order-lines").innerHTML="";if(products.length)addLine();updateTotal();setMessage("order-form-message","");},0));
  $("new-order-form").addEventListener("submit",async e=>{
    e.preventDefault();if(!client||!currentUser)return;
    const lines=collectLines();
    if(!lines.length){setMessage("order-form-message","أضف صنفًا واحدًا على الأقل وتأكد من الكمية والسعر.",true);return;}
    if(lines.length!==$("order-lines").children.length){setMessage("order-form-message","راجع كل الأصناف والكميات والأسعار.",true);return;}
    const subtotal=lines.reduce((s,l)=>s+l.quantity*l.price,0),discount=Number($("discount").value)||0,shipping=Number($("shipping-fee").value)||0;
    if(discount<0||shipping<0||discount>subtotal){setMessage("order-form-message","راجع الخصم ومصاريف التوصيل.",true);return;}
    const orderNo=`HAP-${new Date().getFullYear()}-${Date.now().toString().slice(-8)}`;
    const payload={
      order_no:orderNo,channel:$("channel").value,status:"new",created_by:currentUser.id,assigned_sales_id:currentUser.id,
      subtotal,discount,shipping_fee:shipping,total:subtotal-discount+shipping,
      payment_method:$("payment-method").value,recipient_name:$("customer-name").value.trim(),
      recipient_phone:$("customer-phone").value.trim(),governorate:$("governorate").value.trim()||null,
      city:$("city").value.trim()||null,delivery_address:$("address").value.trim()||null,
      address_notes:$("address-notes").value.trim()||null,notes:$("order-notes").value.trim()||null
    };
    const submit=e.submitter;submit.disabled=true;submit.textContent="جارٍ الحفظ...";
    try {
      const {data:order,error}=await client.from("orders").insert(payload).select("id,order_no").single();
      if(error)throw error;
      const itemPayload=lines.map(l=>({order_id:order.id,product_id:l.product.id,sku_snapshot:l.product.sku,product_name_snapshot:l.product.name,quantity:l.quantity,unit_price:l.price,unit_cost:Number(l.product.purchase_cost)||0,line_discount:0,line_total:l.quantity*l.price}));
      const {error:itemError}=await client.from("order_items").insert(itemPayload);
      if(itemError){toast("تم إنشاء سجل الأوردر لكن تعذر حفظ التفاصيل. أوقف المعالجة وراجع المدير: "+itemError.message,true);return;}
      toast(`تم إنشاء الأوردر ${order.order_no}`);
      e.target.reset();showPage("orders");await loadOrders();
    } catch(err){setMessage("order-form-message","تعذر حفظ الأوردر: "+err.message,true);}
    finally{submit.disabled=false;submit.textContent="حفظ الأوردر";}
  });

  async function loadShipping() {
    if(!client)return;
    try {
      const {data,error}=await client.from("shipments").select("id,order_id,courier_id,status,cod_amount,collected_amount,orders(order_no,recipient_name,recipient_phone)").order("created_at",{ascending:false}).limit(500);
      if(error)throw error;
      $("shipping-table").innerHTML=(data||[]).map(s=>`<tr><td>${esc(s.orders?.order_no||"—")}</td><td>${esc(s.orders?.recipient_name||"—")}<br><span class="muted">${esc(s.orders?.recipient_phone||"")}</span></td><td>${esc(s.courier_id||"غير مسند")}</td><td>${esc(s.status)}</td><td>${money(s.cod_amount)}</td><td><span class="muted">تحديث الحالة عبر إجراء معتمد</span></td></tr>`).join("")||'<tr><td colspan="6" class="empty">لا توجد شحنات مسجلة</td></tr>';
    }catch(e){toast("تعذر تحميل الشحنات: "+e.message,true);}
  }
  // This script is loaded with defer, so the DOM is ready here.
  boot();
  window.HAP={showPage,loadDashboard,loadOrders,loadProducts,loadShipping};
})(); 
