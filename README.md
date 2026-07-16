# scheduler-web

用于展示 Scheduler 发布的服务器定义、运行实例、在线玩家位置和排行榜。
React 前端与 Rust/Axum 后端由同一个容器提供。浏览器只调用同源只读 API，
Rust 后端只通过 PostgreSQL 读取 Scheduler 发布的数据；scheduler-web 不与
Scheduler 建立 HTTP、RPC 或消息队列连接。

## 快速启动

```bash
docker build -t scheduler-web .
docker run --rm -p 8080:8080 \
  -e 'DATABASE_URL=postgresql://scheduler_web_readonly:change-me@postgres.example.com:5432/minigames?sslmode=require' \
  scheduler-web
```

也可以复制 `compose.example.yaml` 后使用 Docker Compose 启动。生产环境应为
Web 单独创建仅具四张 `scheduler_*` 表 `SELECT` 权限的 PostgreSQL 角色。
后端不会执行迁移、建表、更新或删除操作。

仓库内的 GitHub Actions 会在 Pull Request 中验证 Docker 构建，并在推送到
`main`、`master` 或 `v*` 标签时将 `linux/amd64` 镜像发布到
`ghcr.io/<owner>/<repository>`。默认分支同时发布 `latest` 标签。

## 环境变量

- `DATABASE_URL`：必填，PostgreSQL URL；公网数据库建议使用
  `sslmode=require`。
- `BIND_ADDR`：监听地址，默认 `0.0.0.0:8080`。
- `DB_MAX_CONNECTIONS`：连接池上限，默认 `10`。
- `FRONTEND_DIR`：静态资源目录，容器内默认 `/app/frontend`。
- `CORS_ORIGIN`：可选。仅在前后端跨域部署时设置允许的单一来源。
- `MC_STATUS_ADDRESS`：Minecraft Server List Ping 目标，默认
  `frp-hen.com:25568`。连接、读取和写入均受 3 秒整体超时约束。
- `RUST_LOG`：日志过滤器，默认 `info`。

## 只读 API

- `GET /healthz`：数据库健康检查。
- `GET /api/overview`：一次返回定义、实例和玩家快照。
- `GET /api/servers`：服务器定义与实例。
- `GET /api/players`：在线玩家与所在服务器。
- `GET /api/minecraft-status`：通过 Minecraft Server List Ping 返回整体网络
  状态，包括 `online`、`host`、`port`、`latency_ms`、`online_players`、
  `max_players`、`version`、纯文本 `motd` 和 `checked_at`。探测失败仍返回
  `200` 和 `online=false`，不会向浏览器泄露内部错误。
- `GET /api/leaderboards/catalog`：返回可展示的游戏、指标、周期、周期键、
  排序方向和单位。
- `GET /api/leaderboards?game=bingo&metric=<模式>&period=month&period_key=YYYY-MM&limit=10`：
  Bingo 月榜。
- `GET /api/leaderboards?game=bingo&metric=<模式>&period=all_time&limit=10`：
  Bingo 总榜。`limit` 范围为 1 到 500。

排行榜条目返回 `game`、`metric`、`period`、`period_key`、`rank`、
`player_id`、`player_uuid`、`username`、`score`、`sort_order`、`unit` 和
`updated_at`。Bingo 分数是完成用时（`unit=ms`），按 `sort_order=asc`
即时排名，同一用时共享名次。
所有数据库错误都会转换为不泄露连接信息的 `503` 响应。

## 本地开发

```bash
cd frontend
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

```bash
cd backend
export DATABASE_URL='postgresql://...'
cargo run
```

前端开发服务器会把 `/api` 和 `/healthz` 代理到后端；统一容器中由 Axum
直接提供 `frontend/dist`，并支持 React SPA 路由回退。
