-- Cluster-level roles shared by every arm.
-- skal_migrator owns the schema and runs migrations; skal_app is what the application connects as.
CREATE ROLE skal_migrator LOGIN PASSWORD 'migrator' CREATEDB;
CREATE ROLE skal_app LOGIN PASSWORD 'app' NOBYPASSRLS;
