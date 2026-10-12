-- Hyper Adam Phone - initial schema
-- Apply in a NEW Supabase project via SQL Editor.
-- This migration creates the core data model. Read README.md before production use.

create extension if not exists pgcrypto;

create type public.app_role as enum (
  'owner', 'admin', 'sales_supervisor', 'sales',
  'warehouse', 'shipping_supervisor', 'courier', 'accountant'
);
create type public.order_status as enum (
  'new', 'review', 'approved', 'preparing', 'ready_to_ship',
  'handed_to_courier', 'out_for_delivery', 'delivered',
  'delivery_failed', 'return_pending', 'returned',
  'cancelled', 'completed_in_store'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null,
  role public.app_role not null default 'sales',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  alternate_phone text,
  governorate text,
  city text,
  address text,
  address_notes text,
  created_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  sku text not null unique,
  barcode text unique,
  name text not null,
  category text,
  purchase_cost numeric(12,2) not null default 0 check (purchase_cost >= 0),
  selling_price numeric(12,2) not null check (selling_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.inventory_balances (
  product_id uuid primary key references public.products(id) on delete restrict,
  quantity_on_hand integer not null default 0 check (quantity_on_hand >= 0),
  quantity_reserved integer not null default 0
    check (quantity_reserved >= 0 and quantity_reserved <= quantity_on_hand),
  updated_at timestamptz not null default now()
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_no text not null unique,
  channel text not null check (channel in ('store','online')),
  status public.order_status not null default 'new',
  customer_id uuid references public.customers(id) on delete set null,
  created_by uuid not null references public.profiles(id),
  assigned_sales_id uuid references public.profiles(id),
  subtotal numeric(12,2) not null default 0 check (subtotal >= 0),
  discount numeric(12,2) not null default 0 check (discount >= 0),
  shipping_fee numeric(12,2) not null default 0 check (shipping_fee >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  payment_method text,
  payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','partial','paid','refunded')),
  recipient_name text,
  recipient_phone text,
  governorate text,
  city text,
  delivery_address text,
  address_notes text,
  notes text,
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  sku_snapshot text not null,
  product_name_snapshot text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  unit_cost numeric(12,2) not null check (unit_cost >= 0),
  line_discount numeric(12,2) not null default 0 check (line_discount >= 0),
  line_total numeric(12,2) not null check (line_total >= 0)
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null check (movement_type in (
    'opening','purchase','reserve','release','sale','return_in','damage','adjustment'
  )),
  quantity integer not null check (quantity > 0),
  reference_type text,
  reference_id uuid,
  reason text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  old_status public.order_status,
  new_status public.order_status not null,
  changed_by uuid not null references public.profiles(id),
  note text,
  created_at timestamptz not null default now()
);

create table public.shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete restrict,
  courier_id uuid references public.profiles(id),
  tracking_code text unique,
  status text not null default 'pending',
  cod_amount numeric(12,2) not null default 0 check (cod_amount >= 0),
  collected_amount numeric(12,2) not null default 0 check (collected_amount >= 0),
  handed_at timestamptz,
  delivered_at timestamptz,
  delivery_note text,
  created_at timestamptz not null default now()
);

create table public.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete restrict,
  attempted_by uuid not null references public.profiles(id),
  result text not null check (result in ('delivered','no_answer','refused','wrong_address','reschedule','other')),
  note text,
  attempted_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  amount numeric(12,2) not null check (amount > 0),
  method text not null,
  payment_kind text not null default 'collection' check (payment_kind in ('collection','refund')),
  status text not null default 'confirmed' check (status in ('pending','confirmed','voided')),
  collected_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  return_no text not null unique,
  reason text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','received','refunded','exchanged')),
  created_by uuid not null references public.profiles(id),
  approved_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.returns(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  condition text not null default 'needs_inspection' check (condition in ('sealed','resellable','damaged','needs_inspection')),
  restock boolean not null default false
);

create table public.commissions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.profiles(id),
  order_id uuid references public.orders(id),
  basis_amount numeric(12,2) not null default 0 check (basis_amount >= 0),
  rate numeric(7,4) not null default 0 check (rate >= 0),
  amount numeric(12,2) not null default 0 check (amount >= 0),
  status text not null default 'pending' check (status in ('pending','approved','paid','cancelled')),
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  description text not null,
  category text not null,
  amount numeric(12,2) not null check (amount > 0),
  expense_date date not null default current_date,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  opened_by uuid not null references public.profiles(id),
  opened_at timestamptz not null default now(),
  opening_amount numeric(12,2) not null default 0 check (opening_amount >= 0),
  closed_by uuid references public.profiles(id),
  closed_at timestamptz,
  expected_amount numeric(12,2),
  counted_amount numeric(12,2),
  difference_amount numeric(12,2),
  notes text
);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  action text not null,
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

create table public.notification_logs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  channel text not null default 'whatsapp',
  recipient text not null,
  template_name text,
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now()
);

create index orders_status_created_idx on public.orders(status, created_at desc);
create index orders_customer_idx on public.orders(customer_id);
create index order_items_order_idx on public.order_items(order_id);
create index stock_movements_product_date_idx on public.stock_movements(product_id, created_at desc);
create index shipments_courier_status_idx on public.shipments(courier_id, status);
create index payments_order_status_idx on public.payments(order_id, status);
create index delivery_attempts_shipment_idx on public.delivery_attempts(shipment_id, attempted_at desc);
create index commissions_employee_status_idx on public.commissions(employee_id, status);

-- Security: deny access unless explicit policies are added.
alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.products enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.order_status_history enable row level security;
alter table public.shipments enable row level security;
alter table public.delivery_attempts enable row level security;
alter table public.payments enable row level security;
alter table public.returns enable row level security;
alter table public.return_items enable row level security;
alter table public.commissions enable row level security;
alter table public.expenses enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.audit_logs enable row level security;
alter table public.notification_logs enable row level security;

-- Read-only starter policies. Operational writes should be added through
-- audited SECURITY DEFINER RPC functions with strict role checks.
create policy "staff read own profile" on public.profiles
for select to authenticated using (id = (select auth.uid()));

create policy "active staff read products" on public.products
for select to authenticated using (
  exists(select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active = true)
);

create policy "active staff read inventory" on public.inventory_balances
for select to authenticated using (
  exists(select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active = true)
);

-- Intentionally no broad write policies in this initial migration.
-- Add and test per-role policies/RPCs before real-world operation.
