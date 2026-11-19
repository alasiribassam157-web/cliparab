\set ON_ERROR_STOP 0
SET ROLE app;
-- seed two tenants (as superuser-less app role we must set the team to insert)
\set t1 '11111111-1111-1111-1111-111111111111'
\set t2 '22222222-2222-2222-2222-222222222222'
RESET ROLE;
INSERT INTO teams(id,name) VALUES (:'t1','A'),(:'t2','B');
INSERT INTO users(id,email) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','a@x.com'),('bbbbbbbb-0000-0000-0000-000000000002','b@x.com');
SET ROLE app;
BEGIN; SET LOCAL app.team_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO projects(team_id,created_by,name) VALUES ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','proj A');
COMMIT;
BEGIN; SET LOCAL app.team_id = '22222222-2222-2222-2222-222222222222';
INSERT INTO projects(team_id,created_by,name) VALUES ('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-000000000002','proj B');
SELECT 'team B sees' AS who, name FROM projects;
-- cross-tenant write must fail
INSERT INTO projects(team_id,created_by,name) VALUES ('11111111-1111-1111-1111-111111111111','bbbbbbbb-0000-0000-0000-000000000002','intruder');
ROLLBACK;
BEGIN; SET LOCAL app.team_id = '11111111-1111-1111-1111-111111111111';
SELECT 'team A sees' AS who, name FROM projects;
UPDATE projects SET name='hijack' WHERE name='proj B';
SELECT 'rows updated across tenants (expect 0)' AS chk, count(*) FROM projects WHERE name='hijack';
ROLLBACK;
-- no tenant set => nothing visible
SELECT 'no tenant sees' AS who, count(*) FROM projects;
-- constraints
BEGIN; SET LOCAL app.team_id = '11111111-1111-1111-1111-111111111111';
INSERT INTO projects(team_id,created_by,name,retention_days) VALUES ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001','bad',0);
ROLLBACK;
