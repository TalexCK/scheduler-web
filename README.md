# scheduler-web

SHTechCraft Minigames 的服务器状态、在线玩家与排行榜站点。项目已统一为
Next.js App Router：页面、PostgreSQL 只读 API 和 Minecraft Server List Ping
均由同一个 Next.js 进程提供。

## 运行

```bash
docker build -t scheduler-web .
docker run --rm -p 8080:8080 \
  -e 'DATABASE_URL=postgresql://scheduler_web_readonly:change-me@postgres.example.com:5432/minigames?sslmode=require' \
  scheduler-web
```

数据库账号只需四张 `scheduler_*` 表的 `SELECT` 权限。本项目不会迁移、建表、
更新或删除数据库内容。

## 环境变量

- `DATABASE_URL`：必填，PostgreSQL 连接地址。
- `DB_MAX_CONNECTIONS`：连接池上限，默认 `10`。
- `MC_STATUS_ADDRESS`：Minecraft 状态探测目标，默认 `frp-hen.com:25568`。
- `PORT`：HTTP 端口，镜像默认 `8080`。
- `HOSTNAME`：监听地址，镜像默认 `0.0.0.0`。

## 本地开发

```bash
cd frontend
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

## API

- `GET /healthz`
- `GET /api/overview`
- `GET /api/servers`
- `GET /api/players`
- `GET /api/minecraft-status`
- `GET /api/leaderboards/catalog`
- `GET /api/leaderboards?game=bingo&metric=<模式>&period=month&period_key=YYYY-MM`
- `GET /api/leaderboards?game=bingo&metric=<模式>&period=all_time`
