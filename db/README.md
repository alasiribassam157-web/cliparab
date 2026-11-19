# قاعدة البيانات / Database

- `schema.sql` — مخطط PostgreSQL الكامل (الهدف عند التوسّع) مع **Row-Level Security** لعزل كل فريق عن الآخر.
- `schema_vector.sql` — اختياري: عمود التضمينات (pgvector) للبحث الدلالي.
- `tests/rls_test.sql` — يتحقق أن فريقًا لا يقرأ ولا يكتب بيانات فريق آخر.

**الحالة:** الـ MVP يعمل افتراضيًا على SQLite (`apps/api/app/db.py`) دون أي إعداد. مخطط Postgres هنا
جرى تحميله واختباره على Postgres 16 حقيقي (RLS + القيود)، لكن طبقة `Db` في الـ API لم تُنقل إليه بعد.

## تجربة المخطط محليًا
```bash
createdb cliparab && psql cliparab -f db/schema.sql
psql cliparab -f db/tests/rls_test.sql   # يجب أن ترى: team B sees = proj B فقط، والكتابة عبر الفريق مرفوضة
```
لاحظ: يجب أن يتصل التطبيق بدور **غير مدير** (`NOSUPERUSER NOBYPASSRLS`) وإلا تُتجاوز السياسات.
