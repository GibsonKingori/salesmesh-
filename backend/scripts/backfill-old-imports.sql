-- One-off: links the deals and contacts from imports made before import tracking existed
-- (4-20 Oct 2026) to rows in the imports table, so they show under Deals -> Past imports and can
-- be deleted. Each old import is known only from its 'deal.import' audit log entry; its deals are
-- told apart by the transaction that wrote them (xmin), checked by hand against the audit counts:
--   SalesMesh Demo  #1 Maven CRM 8,800 + #2 KingG's 3 template rows (both xmin 1494, split by owner)
--                   #3 KingG's 400 (xmin 1540)
--   Mzibezuba       #1 Kaggle 2,823 (xmin 2043-2048, six chunks)  #2 the 100 after it
-- Only valid for this Supabase project's data as of 20 Oct 2026. Run once in the SQL Editor.
begin;
create temp table old_imports on commit drop as
select a.id as audit_id, uuid_generate_v4() as import_id, a.company_id, a.user_id, a.created_at, c.name as company,
       row_number() over (partition by a.company_id order by a.created_at) as n
from audit_logs a join companies c on c.id = a.company_id
where a.action = 'deal.import'
  and not exists (select 1 from imports);  -- does nothing if imports were already recorded

insert into imports (id, company_id, user_id, file_name, created_at)
select import_id, company_id, user_id, null, created_at from old_imports;

update deals d set import_id = o.import_id from old_imports o
where o.company = 'SalesMesh Demo' and o.n = 2 and d.company_id = o.company_id and d.xmin::text = '1494' and d.owner_id = o.user_id;
update deals d set import_id = o.import_id from old_imports o
where o.company = 'SalesMesh Demo' and o.n = 1 and d.company_id = o.company_id and d.xmin::text = '1494' and d.import_id is null;
update deals d set import_id = o.import_id from old_imports o
where o.company = 'SalesMesh Demo' and o.n = 3 and d.company_id = o.company_id and d.xmin::text = '1540';
update deals d set import_id = o.import_id from old_imports o
where o.company = 'Mzibezuba' and o.n = 1 and d.company_id = o.company_id and d.xmin::text::bigint between 2043 and 2048;
update deals d set import_id = o.import_id from old_imports o
where o.company = 'Mzibezuba' and o.n = 2 and d.company_id = o.company_id and d.import_id is null;

-- Contacts whose deals all came from one import, unless someone added them by hand
update contacts ct set import_id = x.import_id
from (select contact_id, min(import_id::text)::uuid as import_id from deals where contact_id is not null
      group by contact_id having count(distinct import_id) = 1 and count(*) = count(import_id)) x
where ct.id = x.contact_id and ct.import_id is null
  and ct.id::text not in (select entity_id from audit_logs where action = 'contact.create' and entity_id is not null);

update imports i set deal_count = s.n, total_value = s.v
from (select import_id, count(*) n, coalesce(sum(value), 0) v from deals where import_id is not null group by import_id) s
where s.import_id = i.id;
update imports i set contact_count = s.n
from (select import_id, count(*) n from contacts where import_id is not null group by import_id) s
where s.import_id = i.id;
commit;

select c.name as company, i.created_at, i.deal_count, i.contact_count, i.total_value
from imports i join companies c on c.id = i.company_id order by i.created_at;
