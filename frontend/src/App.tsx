import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import {
  Activity,
  CalendarDays,
  Clock3,
  Crown,
  Gamepad2,
  House,
  MapPin,
  Moon,
  RefreshCw,
  ServerIcon,
  Sun,
  Users,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Server = {
  id: string
  name: string
  status: string
  game_type?: string | null
  online_players: number
  max_players?: number | null
  last_heartbeat?: string | null
}

type Player = {
  uuid: string
  username: string
  server_id: string
  server_name?: string | null
  connected_at?: string | null
}

type LeaderboardEntry = {
  game: string
  metric: string
  period: "month" | "all_time"
  period_key?: string | null
  rank: number
  player_id: string
  player_uuid: string
  username: string
  score: number
  unit: string
  sort_order: "asc" | "desc"
  updated_at: string
}

type ServerDefinition = {
  server_id: string
  display_name: string
  game_id?: string | null
  max_players?: number | null
}

type ServerInstance = {
  instance_id: string
  server_id: string
  state: string
  player_count: number
  last_heartbeat?: string | null
}

type PlayerPresence = {
  player_uuid: string
  username: string
  server_id?: string | null
  observed_at?: string | null
}

type ServersResponse = { definitions: ServerDefinition[]; instances: ServerInstance[] }
type ListResponse<T> = { data: T[]; total: number }
type LeaderboardCatalogEntry = {
  game: string
  metric: string
  display_name?: string | null
  unit: string
  sort_order: "asc" | "desc"
}
type LeaderboardCatalogRecord = LeaderboardCatalogEntry & {
  period: "month" | "all_time"
  period_key?: string | null
}

type MinecraftStatus = {
  online: boolean
  host: string
  port: number
  latency_ms?: number | null
  online_players?: number | null
  max_players?: number | null
  version?: string | null
  motd?: string | null
  checked_at: string
}

type Theme = "light" | "dark"
type Page = "home" | "players" | "leaderboards"

const formatter = new Intl.NumberFormat("zh-CN")
const now = new Date()
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
const bingoMetricLabels: Record<string, string> = {
  hard_3: "困难 · 三连线",
  hard_12: "困难 · 全棋盘",
  extreme_3: "极难 · 三连线",
  extreme_12: "极难 · 全棋盘",
}
const gameLabels: Record<string, string> = { bingo: "Bingo" }
const supportedGames = ["bingo"]
const activeStates = new Set(["ready", "running", "starting", "stopping"])
const stateLabels: Record<string, string> = {
  ready: "运行中",
  running: "运行中",
  starting: "启动中",
  stopping: "停止中",
  exited: "已停止",
  failed: "异常",
  offline: "未运行",
}
const pageMeta: Record<Page, { eyebrow: string; title: string; description: string }> = {
  home: { eyebrow: "HOME", title: "服务器状态", description: "查看游戏网络中正在运行的服务器。" },
  players: { eyebrow: "PLAYER", title: "在线玩家", description: "查看当前在线玩家及其所在服务器。" },
  leaderboards: { eyebrow: "RANKINGS", title: "游戏排行榜", description: "按游戏与模式查看本月榜和历史总榜。" },
}

function initialTheme(): Theme {
  const saved = window.localStorage.getItem("scheduler-theme")
  if (saved === "light" || saved === "dark") return saved
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function pageFromPath(pathname: string): Page {
  if (pathname.startsWith("/player")) return "players"
  if (pathname.startsWith("/leaderboard")) return "leaderboards"
  return "home"
}

function pathForPage(page: Page) {
  if (page === "players") return "/players"
  if (page === "leaderboards") return "/leaderboards"
  return "/"
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

function relativeTime(value?: string | null) {
  if (!value) return "刚刚"
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 60) return `${Math.max(0, seconds)} 秒前`
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  return `${Math.floor(seconds / 86400)} 天前`
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } })
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
  return response.json() as Promise<T>
}

function formatScore(score: number, unit: string) {
  if (unit !== "ms") return `${formatter.format(score)} ${unit}`.trim()
  const totalSeconds = Math.floor(score / 1000)
  const milliseconds = score % 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`
}

function LeaderboardTable({ title, description, icon, entries, emptyText }: {
  title: string
  description: string
  icon: ReactNode
  entries: LeaderboardEntry[]
  emptyText: string
}) {
  return (
    <Card className="h-full overflow-hidden">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">{icon}{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        {entries.length > 0 ? (
          <Table className="table-fixed">
            <TableHeader><TableRow><TableHead className="w-16">排名</TableHead><TableHead>玩家 ID</TableHead><TableHead className="hidden w-[42%] md:table-cell">UUID</TableHead><TableHead className="w-28 text-right">完成时间</TableHead></TableRow></TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={`${entry.period}-${entry.metric}-${entry.player_uuid}`}>
                  <TableCell><Badge variant={entry.rank <= 3 ? "default" : "secondary"}>#{entry.rank}</Badge></TableCell>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2">
                      <Avatar className="hidden sm:flex"><AvatarFallback>{initials(entry.player_id)}</AvatarFallback></Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{entry.player_id}</p>
                        {entry.username !== entry.player_id && <p className="truncate text-xs text-muted-foreground">{entry.username}</p>}
                        <p className="truncate font-mono text-[10px] text-muted-foreground md:hidden">{entry.player_uuid}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden truncate font-mono text-xs text-muted-foreground md:table-cell">{entry.player_uuid}</TableCell>
                  <TableCell className="text-right font-mono text-base font-semibold tabular-nums">{formatScore(entry.score, entry.unit)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <div className="px-6 py-10 text-center text-sm text-muted-foreground">{emptyText}</div>}
      </CardContent>
    </Card>
  )
}

export default function App() {
  const [page, setPage] = useState<Page>(() => pageFromPath(window.location.pathname))
  const [servers, setServers] = useState<Server[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [catalog, setCatalog] = useState<LeaderboardCatalogEntry[]>([])
  const [selectedGame, setSelectedGame] = useState("bingo")
  const [selectedMetric, setSelectedMetric] = useState("hard_3")
  const [monthlyLeaderboard, setMonthlyLeaderboard] = useState<LeaderboardEntry[]>([])
  const [allTimeLeaderboard, setAllTimeLeaderboard] = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [minecraftStatus, setMinecraftStatus] = useState<MinecraftStatus | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [theme, setTheme] = useState<Theme>(initialTheme)

  useLayoutEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    window.localStorage.setItem("scheduler-theme", theme)
  }, [theme])

  useEffect(() => {
    const syncPage = () => setPage(pageFromPath(window.location.pathname))
    window.addEventListener("popstate", syncPage)
    return () => window.removeEventListener("popstate", syncPage)
  }, [])

  const navigate = (nextPage: Page) => {
    const path = pathForPage(nextPage)
    if (window.location.pathname !== path) window.history.pushState({}, "", path)
    setPage(nextPage)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [dataResult, statusResult] = await Promise.allSettled([
      Promise.all([
        fetchJson<ServersResponse>("/api/servers"),
        fetchJson<ListResponse<PlayerPresence>>("/api/players"),
        fetchJson<ListResponse<LeaderboardCatalogRecord>>("/api/leaderboards/catalog"),
      ]),
      fetchJson<MinecraftStatus>("/api/minecraft-status"),
    ])

    setMinecraftStatus(statusResult.status === "fulfilled" ? statusResult.value : null)

    try {
      if (dataResult.status === "rejected") throw dataResult.reason
      const [serverData, playerData, catalogData] = dataResult.value
      const latestInstances = new Map<string, ServerInstance>()
      for (const instance of serverData.instances) {
        if (!activeStates.has(instance.state)) continue
        const current = latestInstances.get(instance.server_id)
        const currentTime = new Date(current?.last_heartbeat ?? 0).getTime()
        const candidateTime = new Date(instance.last_heartbeat ?? 0).getTime()
        if (!current || candidateTime > currentTime) latestInstances.set(instance.server_id, instance)
      }

      const onlinePlayerCount = new Set(playerData.data.map((player) => player.player_uuid)).size
      setServers(serverData.definitions.flatMap((definition) => {
        const instance = latestInstances.get(definition.server_id)
        if (!instance) return []
        const isProxy = definition.server_id.toLowerCase() === "proxy"
        return [{
          id: definition.server_id,
          name: definition.display_name,
          status: instance.state,
          game_type: definition.game_id,
          online_players: isProxy ? onlinePlayerCount : instance.player_count,
          max_players: definition.max_players,
          last_heartbeat: instance.last_heartbeat,
        }]
      }))

      const names = new Map(serverData.definitions.map((item) => [item.server_id, item.display_name]))
      setPlayers(playerData.data.map((player) => ({
        uuid: player.player_uuid,
        username: player.username,
        server_id: player.server_id ?? "unknown",
        server_name: player.server_id ? names.get(player.server_id) : "等待分配",
        connected_at: player.observed_at,
      })))

      const uniqueCatalog = Array.from(
        new Map(catalogData.data.map((item) => [`${item.game}:${item.metric}`, item])).values(),
      )
      setCatalog(uniqueCatalog)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取网络状态")
    } finally {
      setUpdatedAt(new Date())
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const gameCatalog = useMemo(() => catalog.filter((item) => item.game === selectedGame), [catalog, selectedGame])
  const gameOptions = useMemo(() => {
    const catalogGames = new Set(catalog.map((item) => item.game))
    const available = supportedGames.filter((game) => catalogGames.size === 0 || catalogGames.has(game))
    return available.length > 0 ? available : supportedGames
  }, [catalog])

  useEffect(() => {
    if (gameCatalog.length > 0) {
      setSelectedMetric((current) => gameCatalog.some((item) => item.metric === current) ? current : gameCatalog[0].metric)
    }
  }, [gameCatalog])

  useEffect(() => {
    const query = new URLSearchParams({ game: selectedGame, metric: selectedMetric, limit: "10" })
    const refreshLeaderboards = async () => {
      try {
        const [month, allTime] = await Promise.all([
          fetchJson<ListResponse<LeaderboardEntry>>(`/api/leaderboards?${query}&period=month&period_key=${currentMonth}`),
          fetchJson<ListResponse<LeaderboardEntry>>(`/api/leaderboards?${query}&period=all_time`),
        ])
        setMonthlyLeaderboard(month.data)
        setAllTimeLeaderboard(allTime.data)
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "无法读取排行榜")
      }
    }
    void refreshLeaderboards()
  }, [selectedGame, selectedMetric, updatedAt])

  const meta = pageMeta[page]

  return (
    <main className="min-h-screen">
      <header className="site-header border-b bg-background/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-5 md:px-8">
          <button className="flex items-center gap-3 text-left" onClick={() => navigate("home")} aria-label="返回首页">
            <Avatar className="size-10 rounded-xl">
              <AvatarFallback className="rounded-xl bg-primary text-primary-foreground"><Activity className="size-5" /></AvatarFallback>
            </Avatar>
            <p className="brand-type text-base font-semibold tracking-tight sm:text-lg">SHTechCraft Minigames</p>
          </button>

          <nav className="order-3 flex w-full items-center gap-1 overflow-x-auto sm:order-none sm:w-auto" aria-label="主导航">
            <button className="nav-link" data-active={page === "home"} aria-current={page === "home" ? "page" : undefined} onClick={() => navigate("home")}><House className="size-4" />Home</button>
            <button className="nav-link" data-active={page === "players"} aria-current={page === "players" ? "page" : undefined} onClick={() => navigate("players")}><Users className="size-4" />Player</button>
            <button className="nav-link" data-active={page === "leaderboards"} aria-current={page === "leaderboards" ? "page" : undefined} onClick={() => navigate("leaderboards")}><Crown className="size-4" />排行榜</button>
          </nav>

          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <Badge variant="outline" className="hidden max-w-36 px-2 sm:flex sm:max-w-none sm:px-2.5">
              <span className="status-dot" data-online={minecraftStatus?.online === true} />
              <span className="truncate">{minecraftStatus === null ? "状态检测中" : minecraftStatus.online ? "游戏网络在线" : "游戏网络离线"}</span>
            </Badge>
            <Button variant="outline" size="icon" aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"} onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </Button>
            <Button variant="outline" size="icon" aria-label="刷新数据" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1480px] px-4 py-7 sm:px-5 md:px-8 md:py-10">
        <section className="page-intro mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <p className="section-kicker">{meta.eyebrow}</p>
            <h1 className="brand-type mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{meta.title}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{meta.description}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" />
            {updatedAt ? `更新于 ${updatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "正在获取数据"}
          </div>
        </section>

        {error && (
          <Alert className="mb-6 bg-muted/50">
            <Activity className="size-4" />
            <AlertTitle>暂时无法连接状态服务</AlertTitle>
            <AlertDescription>页面会每 15 秒自动重试。</AlertDescription>
          </Alert>
        )}

        {page === "home" && (
          <Card className="server-list overflow-hidden gap-0 py-0">
            <div className="server-list-heading hidden grid-cols-[minmax(220px,1.5fr)_120px_150px_minmax(140px,1fr)_120px] border-b px-6 py-3 text-xs font-medium text-muted-foreground md:grid">
              <span>服务器</span><span>状态</span><span>在线玩家</span><span>游戏</span><span className="text-right">最近心跳</span>
            </div>
            {servers.map((server) => (
              <div key={server.id} className="server-row grid gap-4 border-b px-5 py-5 last:border-b-0 md:grid-cols-[minmax(220px,1.5fr)_120px_150px_minmax(140px,1fr)_120px] md:items-center md:px-6">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="server-glyph"><ServerIcon className="size-4" /></span>
                  <div className="min-w-0"><p className="truncate font-semibold">{server.name}</p><p className="truncate font-mono text-[11px] text-muted-foreground">{server.id}</p></div>
                </div>
                <div><Badge variant="secondary"><span className="status-dot" data-online={server.status === "ready" || server.status === "running"} />{stateLabels[server.status] ?? server.status}</Badge></div>
                <div className="flex items-baseline gap-1.5"><span className="text-xl font-semibold tabular-nums">{server.online_players}</span><span className="text-xs text-muted-foreground">/ {server.max_players ?? "∞"} 人</span></div>
                <div><Badge variant="outline"><Gamepad2 className="size-3" />{server.game_type ?? "通用"}</Badge></div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground md:justify-end"><Clock3 className="size-3" />{relativeTime(server.last_heartbeat)}</p>
              </div>
            ))}
            {!loading && servers.length === 0 && <div className="p-6"><Alert><ServerIcon className="size-4" /><AlertTitle>暂无服务器</AlertTitle><AlertDescription>Scheduler 尚未发布运行中的服务器。</AlertDescription></Alert></div>}
          </Card>
        )}

        {page === "players" && (
          <Card className="overflow-hidden">
            <CardHeader><CardTitle>在线玩家</CardTitle><CardDescription>当前玩家及其所在服务器，共 {players.length} 人</CardDescription></CardHeader>
            <CardContent className="px-0">
              {players.length > 0 ? <Table className="table-fixed">
                <TableHeader><TableRow><TableHead>玩家</TableHead><TableHead>所在服务器</TableHead><TableHead className="hidden w-24 md:table-cell">在线时间</TableHead><TableHead className="hidden w-[38%] md:table-cell">UUID</TableHead></TableRow></TableHeader>
                <TableBody>
                  {players.map((player) => <TableRow key={player.uuid}>
                    <TableCell><div className="flex min-w-0 items-center gap-3"><Avatar><AvatarFallback>{initials(player.username)}</AvatarFallback></Avatar><div className="min-w-0"><p className="truncate font-medium">{player.username}</p><p className="max-w-44 truncate font-mono text-[11px] text-muted-foreground md:hidden">{player.uuid}</p></div></div></TableCell>
                    <TableCell><Badge variant="outline" className="max-w-44"><MapPin className="size-3" /><span className="truncate">{player.server_name ?? player.server_id}</span></Badge></TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{relativeTime(player.connected_at)}</TableCell>
                    <TableCell className="hidden truncate font-mono text-xs text-muted-foreground md:table-cell">{player.uuid}</TableCell>
                  </TableRow>)}
                </TableBody>
              </Table> : <div className="px-6 py-12 text-center text-sm text-muted-foreground">当前没有在线玩家</div>}
            </CardContent>
          </Card>
        )}

        {page === "leaderboards" && (
          <div className="space-y-5">
            <Card className="gap-5 py-5">
              <CardHeader><CardTitle>选择游戏</CardTitle><CardDescription>排行榜将逐步支持更多 Minigames，目前可选择 Bingo。</CardDescription></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {gameOptions.map((game) => <Button key={game} variant={selectedGame === game ? "default" : "outline"} onClick={() => setSelectedGame(game)}><Gamepad2 className="size-4" />{gameLabels[game] ?? game}</Button>)}
              </CardContent>
            </Card>

            <Card className="gap-4 py-5">
              <CardHeader><CardTitle>{gameLabels[selectedGame] ?? selectedGame} 排行榜</CardTitle><CardDescription>选择要查看的游戏模式</CardDescription></CardHeader>
              <CardContent>
                <Tabs value={selectedMetric} onValueChange={setSelectedMetric}>
                  <TabsList className="grid h-auto w-full grid-cols-2 sm:flex sm:w-fit sm:max-w-full sm:flex-wrap sm:justify-start">
                    {(gameCatalog.length > 0 ? gameCatalog : Object.keys(bingoMetricLabels).map((metric) => ({ metric } as LeaderboardCatalogEntry))).map((item) => (
                      <TabsTrigger key={item.metric} value={item.metric}>{item.display_name ?? bingoMetricLabels[item.metric] ?? item.metric}</TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </CardContent>
            </Card>

            <div className="grid items-stretch gap-5 lg:grid-cols-2">
              <LeaderboardTable title="本月榜" description={`${currentMonth} · ${bingoMetricLabels[selectedMetric] ?? selectedMetric}`} icon={<CalendarDays className="size-4 text-primary" />} entries={monthlyLeaderboard} emptyText="本月暂无完成记录" />
              <LeaderboardTable title="总榜" description={`全部历史 · ${bingoMetricLabels[selectedMetric] ?? selectedMetric}`} icon={<Crown className="size-4 text-primary" />} entries={allTimeLeaderboard} emptyText="暂无历史完成记录" />
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
