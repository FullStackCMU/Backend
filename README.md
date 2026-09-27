# Setup

- Use branch `full-backend` (not `pf-backend`)
- Make sure that you already have DB running from `Database` project (branch `full-database`).
- Make `.env` from `.env.example` (fillin the password, ask the team for `OAUTH_*`, set `AI_PROVIDER=none` if you don't have a DeepSeek key)
- `pnpm install`
- `pnpm run dev`

# Containerization and test

- Make `.env.test` from `.env.test.example`
- `docker compose --env-file ./.env.test up -d --force-recreate --build`

# Push to dockerhub

- `docker tag preflight-backend [DOCKERHUB_ACCOUNT]/preflight-backend:latest`
- `docker push [DOCKERHUB_ACCOUNT]/preflight-backend:latest`
