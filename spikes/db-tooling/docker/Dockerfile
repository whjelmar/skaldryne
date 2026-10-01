FROM pgvector/pgvector:pg18
RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-18-pgtap \
 && rm -rf /var/lib/apt/lists/*
COPY init-roles.sql /docker-entrypoint-initdb.d/01-roles.sql
