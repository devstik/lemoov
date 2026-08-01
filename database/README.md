# Banco do módulo de Produção

As alterações do banco são versionadas em `database/migrations`.

## Execução automática

Com as mesmas variáveis usadas pelo servidor (`DB_HOST` ou `DB_SOCKET`, `DB_USER`, `DB_PASS` e `DB_NAME`):

```bash
npm run db:migrate
```

O executor registra cada arquivo aplicado em `lemoov_schema_migrations` e não o executa novamente.

## Execução pelo phpMyAdmin

Quando não houver terminal no servidor, abra o banco da Lemoov no phpMyAdmin, entre na aba **SQL** ou **Importar** e execute o arquivo:

```text
database/migrations/001_production_v2_foundation.sql
```

O arquivo é idempotente (`CREATE TABLE IF NOT EXISTS` e `INSERT IGNORE`). Antes de aplicar em produção, mantenha um backup atual do banco.

## Convenção

Novas alterações devem ser adicionadas como migrations numeradas (`002_...sql`, `003_...sql`). Uma migration já aplicada nunca deve ser reescrita; correções entram em um novo arquivo.

