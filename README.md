# Setup

- Use branch `full-backend` (not `pf-backend`)
- Make sure that you already have DB running, migrated and seeded from `Database` project (branch `full-database`).
- Make `.env` from `.env.example` (use the same `POSTGRES_APP_PASSWORD` as `Database/.env`, ask the team for `OAUTH_*`, keep `AI_PROVIDER=none` if you don't have a DeepSeek key, otherwise set `AI_PROVIDER=deepseek` and `DEEPSEEK_API_KEY`)
- `pnpm install`
- `pnpm run dev`

# Containerization and test

- Make `.env.test` from `.env.test.example` (fill in the same values as `.env`)
- `docker compose --env-file ./.env.test up -d --force-recreate --build`

# Push to dockerhub

- `docker tag preflight-backend [DOCKERHUB_ACCOUNT]/preflight-backend:latest`
- `docker push [DOCKERHUB_ACCOUNT]/preflight-backend:latest`
