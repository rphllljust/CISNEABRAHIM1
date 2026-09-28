# CISNE production secrets

The production compose stack is fail-closed and reads sensitive values from
Docker secrets mounted under `/run/secrets`. Never place the secret values in
`.env.prod` or commit files under `secrets/` (the repository ignores that
directory).

The reference compose expects these files by default:

- `secrets/prod/postgres_password`
- `secrets/prod/database_url`
- `secrets/prod/jwt_secret`
- `secrets/prod/document_download_token_secret`
- `secrets/prod/backup_encryption_key`
- `secrets/prod/s3_access_key_id`
- `secrets/prod/s3_secret_access_key`

`database_url` must contain the complete PostgreSQL connection URL that the
application should use. `backup_encryption_key` must contain a base64 value
that decodes to exactly 32 bytes. JWT and document-token secrets must be
independent high-entropy values of at least 32 characters.

For managed infrastructure, replace the local Docker-secret files with the
provider's secret manager / workload identity mounts. For native S3 using an
IAM role, set `OBJECT_STORAGE_IAM_ROLE=true` and omit static S3 credentials.

The production CD gate intentionally refuses promotion when the target runtime
is not configured for a secret store. Do not work around this by copying
secrets into GitHub Actions environment variables.
