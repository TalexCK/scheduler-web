import { useCallback, useEffect, useLayoutEffect, useState } from "react"
import {
  Activity,
  CalendarDays,
  Clock3,
  Crown,
  Gamepad2,
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
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

type Server = {
  id: string
  name: string
  status: string
  game_type?: string | null
  online_players: number
  max_players?: number | null
  started_at?: string | null
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
  started_at?: string | null
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

const formatter = new Intl.NumberFormat("zh-CN")
const now = new Date()
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
const bingoMetricLabels: Record<string, string> = {
  hard_3: "困难 · 三连线",
  hard_12: "困难 · 全棋盘",
  extreme_3: "极难 · 三连线",
  extreme_12: "极难 · 全棋盘",
}
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

function initialTheme(): Theme {
  const saved = window.localStorage.getItem("scheduler-theme")
  if (saved === "light" || saved === "dark") return saved
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
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

export default function App() {
  const [servers, setServers] = useState<Server[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [catalog, setCatalog] = useState<LeaderboardCatalogEntry[]>([])
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

    if (statusResult.status === "fulfilled") setMinecraftStatus(statusResult.value)
    else setMinecraftStatus(null)

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
      setServers(serverData.definitions.flatMap((definition) => {
        const instance = latestInstances.get(definition.server_id)
        if (!instance) return []
        return [{
          id: definition.server_id,
          name: definition.display_name,
          status: instance.state,
          game_type: definition.game_id,
          online_players: instance.player_count,
          max_players: definition.max_players,
          started_at: instance.started_at,
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
      const bingoCatalog = Array.from(
        new Map(catalogData.data.filter((item) => item.game === "bingo").map((item) => [item.metric, item])).values(),
      )
      setCatalog(bingoCatalog)
      if (bingoCatalog.length > 0) {
        setSelectedMetric((current) => bingoCatalog.some((item) => item.metric === current) ? current : bingoCatalog[0].metric)
      }
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

  useEffect(() => {
    const query = new URLSearchParams({ game: "bingo", metric: selectedMetric, limit: "10" })
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
  }, [selectedMetric, updatedAt])

  const leaderboardCount = monthlyLeaderboard.length + allTimeLeaderboard.length

  return (
    <main className="min-h-screen">
      <header className="border-b bg-background/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-4 md:px-8">
          <div className="flex items-center gap-3">
            <Avatar className="size-9 rounded-lg sm:size-10 sm:rounded-xl">
              <AvatarFallback className="rounded-lg bg-primary text-primary-foreground sm:rounded-xl"><Activity className="size-4 sm:size-5" /></AvatarFallback>
            </Avatar>
            <div>
              <p className="brand-type text-base font-semibold tracking-tight sm:text-lg">Scheduler</p>
              <p className="hidden text-xs text-muted-foreground sm:block">网络状态与排行榜</p>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
            <Badge variant="outline" className="max-w-32 px-2 sm:max-w-none sm:px-2.5">
              <span className="status-dot" />
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

      <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-5 md:px-8 md:py-8">
        <section className="mb-5 flex justify-end">
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

        <section className="mb-7 grid gap-3 sm:grid-cols-3 sm:gap-4">
          <Card className="metric-card">
            <CardHeader className="flex-row items-center justify-between">
              <CardDescription>运行中的服务器</CardDescription><ServerIcon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><CardTitle className="metric-value">{formatter.format(servers.length)}</CardTitle></CardContent>
          </Card>
          <Card className="metric-card">
            <CardHeader className="flex-row items-center justify-between">
              <CardDescription>当前在线玩家</CardDescription><Users className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><CardTitle className="metric-value">{formatter.format(players.length)}</CardTitle></CardContent>
          </Card>
          <Card className="metric-card accent-card">
            <CardHeader className="flex-row items-center justify-between">
              <CardDescription>排行榜记录</CardDescription><Crown className="size-4" />
            </CardHeader>
            <CardContent><CardTitle className="metric-value">{formatter.format(leaderboardCount)}</CardTitle></CardContent>
          </Card>
        </section>

        <Tabs defaultValue="overview">
          <TabsList className="grid h-auto w-full grid-cols-3 sm:flex sm:w-fit">
            <TabsTrigger value="overview"><Gamepad2 className="size-3.5" />服务器</TabsTrigger>
            <TabsTrigger value="players"><Users className="size-3.5" />玩家</TabsTrigger>
            <TabsTrigger value="leaderboard"><Crown className="size-3.5" />排行榜</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {servers.map((server) => {
                const load = server.max_players ? Math.round((server.online_players / server.max_players) * 100) : 0
                return (
                  <Card key={server.id} className="server-card">
                    <CardHeader className="flex-row items-start justify-between gap-4">
                      <div className="space-y-2">
                        <CardTitle className="text-base">{server.name}</CardTitle>
                        <CardDescription className="font-mono text-xs">{server.id}</CardDescription>
                      </div>
                      <Badge variant="secondary">{stateLabels[server.status] ?? server.status}</Badge>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <Separator />
                      <div className="flex items-end justify-between">
                        <div><p className="text-xs text-muted-foreground">在线玩家</p><p className="mt-1 text-2xl font-semibold">{server.online_players}<span className="text-sm font-normal text-muted-foreground"> / {server.max_players ?? "∞"}</span></p></div>
                        <Badge variant="outline"><Gamepad2 className="size-3" />{server.game_type ?? "通用"}</Badge>
                      </div>
                      <Progress value={load} />
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="size-3" />心跳 {relativeTime(server.last_heartbeat)}</p>
                    </CardContent>
                  </Card>
                )
              })}
              {!loading && servers.length === 0 && <Alert><ServerIcon className="size-4" /><AlertTitle>暂无服务器</AlertTitle><AlertDescription>Scheduler 尚未发布运行中的服务器。</AlertDescription></Alert>}
            </div>
          </TabsContent>

          <TabsContent value="players">
            <Card className="overflow-hidden">
              <CardHeader><CardTitle>在线玩家</CardTitle><CardDescription>当前玩家及其所在服务器，共 {players.length} 人</CardDescription></CardHeader>
              <CardContent className="px-0">
                {players.length > 0 ? <Table className="table-fixed">
                  <TableHeader><TableRow><TableHead>玩家</TableHead><TableHead>所在服务器</TableHead><TableHead className="hidden w-24 md:table-cell">进入时间</TableHead><TableHead className="hidden w-[38%] md:table-cell">UUID</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {players.map((player) => <TableRow key={player.uuid}>
                      <TableCell><div className="flex min-w-0 items-center gap-3"><Avatar><AvatarFallback>{initials(player.username)}</AvatarFallback></Avatar><div className="min-w-0"><p className="truncate font-medium">{player.username}</p><p className="max-w-44 truncate font-mono text-[11px] text-muted-foreground md:hidden">{player.uuid}</p></div></div></TableCell>
                      <TableCell><Badge variant="outline" className="max-w-44"><MapPin className="size-3" /><span className="truncate">{player.server_name ?? player.server_id}</span></Badge></TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{relativeTime(player.connected_at)}</TableCell>
                      <TableCell className="hidden truncate font-mono text-xs text-muted-foreground md:table-cell">{player.uuid}</TableCell>
                    </TableRow>)}
                  </TableBody>
                </Table> : <div className="px-6 py-8 text-center text-sm text-muted-foreground">当前没有在线玩家</div>}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leaderboard">
            <div className="space-y-5">
              <Card className="gap-4 py-5">
                <CardHeader className="gap-3">
                  <CardTitle>Bingo 排行榜</CardTitle>
                </CardHeader>
                <CardContent>
                  <Tabs value={selectedMetric} onValueChange={setSelectedMetric}>
                    <TabsList className="grid h-auto w-full grid-cols-2 sm:flex sm:w-fit sm:max-w-full sm:flex-wrap sm:justify-start">
                      {(catalog.length > 0 ? catalog : Object.keys(bingoMetricLabels).map((metric) => ({ metric } as LeaderboardCatalogEntry))).map((item) => (
                        <TabsTrigger key={item.metric} value={item.metric}>{item.display_name ?? bingoMetricLabels[item.metric] ?? item.metric}</TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </CardContent>
              </Card>

              <div className="grid items-stretch gap-5 lg:grid-cols-2">
                <Card className="h-full overflow-hidden">
                  <CardHeader className="flex-row items-center justify-between gap-3">
                    <div><CardTitle className="flex items-center gap-2"><CalendarDays className="size-4 text-primary" />本月榜</CardTitle><CardDescription className="mt-1.5">{currentMonth} · {bingoMetricLabels[selectedMetric] ?? selectedMetric}</CardDescription></div>
                  </CardHeader>
                  <CardContent className="px-0">
                    {monthlyLeaderboard.length > 0 ? <Table className="table-fixed">
                      <TableHeader><TableRow><TableHead className="w-16">排名</TableHead><TableHead>玩家 ID</TableHead><TableHead className="hidden w-[42%] md:table-cell">UUID</TableHead><TableHead className="w-28 text-right">完成时间</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {monthlyLeaderboard.map((entry) => <TableRow key={`month-${entry.metric}-${entry.player_uuid}`}>
                          <TableCell><Badge variant={entry.rank <= 3 ? "default" : "secondary"}>#{entry.rank}</Badge></TableCell>
                          <TableCell><div className="flex min-w-0 items-center gap-2"><Avatar className="hidden sm:flex"><AvatarFallback>{initials(entry.player_id)}</AvatarFallback></Avatar><div className="min-w-0"><p className="truncate font-medium">{entry.player_id}</p>{entry.username !== entry.player_id && <p className="truncate text-xs text-muted-foreground">{entry.username}</p>}<p className="truncate font-mono text-[10px] text-muted-foreground md:hidden">{entry.player_uuid}</p></div></div></TableCell>
                          <TableCell className="hidden truncate font-mono text-xs text-muted-foreground md:table-cell">{entry.player_uuid}</TableCell>
                          <TableCell className="text-right font-mono text-base font-semibold tabular-nums">{formatScore(entry.score, entry.unit)}</TableCell>
                        </TableRow>)}
                      </TableBody>
                    </Table> : <div className="px-6 py-8 text-center text-sm text-muted-foreground">本月暂无完成记录</div>}
                  </CardContent>
                </Card>

                <Card className="h-full overflow-hidden">
                  <CardHeader className="flex-row items-center justify-between gap-3">
                    <div><CardTitle className="flex items-center gap-2"><Crown className="size-4 text-primary" />总榜</CardTitle><CardDescription className="mt-1.5">全部历史 · {bingoMetricLabels[selectedMetric] ?? selectedMetric}</CardDescription></div>
                  </CardHeader>
                  <CardContent className="px-0">
                    {allTimeLeaderboard.length > 0 ? <Table className="table-fixed">
                      <TableHeader><TableRow><TableHead className="w-16">排名</TableHead><TableHead>玩家 ID</TableHead><TableHead className="hidden w-[42%] md:table-cell">UUID</TableHead><TableHead className="w-28 text-right">完成时间</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {allTimeLeaderboard.map((entry) => <TableRow key={`all-${entry.metric}-${entry.player_uuid}`}>
                          <TableCell><Badge variant={entry.rank <= 3 ? "default" : "secondary"}>#{entry.rank}</Badge></TableCell>
                          <TableCell><div className="flex min-w-0 items-center gap-2"><Avatar className="hidden sm:flex"><AvatarFallback>{initials(entry.player_id)}</AvatarFallback></Avatar><div className="min-w-0"><p className="truncate font-medium">{entry.player_id}</p>{entry.username !== entry.player_id && <p className="truncate text-xs text-muted-foreground">{entry.username}</p>}<p className="truncate font-mono text-[10px] text-muted-foreground md:hidden">{entry.player_uuid}</p></div></div></TableCell>
                          <TableCell className="hidden truncate font-mono text-xs text-muted-foreground md:table-cell">{entry.player_uuid}</TableCell>
                          <TableCell className="text-right font-mono text-base font-semibold tabular-nums">{formatScore(entry.score, entry.unit)}</TableCell>
                        </TableRow>)}
                      </TableBody>
                    </Table> : <div className="px-6 py-8 text-center text-sm text-muted-foreground">暂无历史完成记录</div>}
                  </CardContent>
                </Card>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  )
}
