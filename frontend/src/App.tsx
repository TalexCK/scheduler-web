import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Activity,
  CalendarDays,
  Clock3,
  Crown,
  Database,
  Gamepad2,
  MapPin,
  Medal,
  RefreshCw,
  ServerIcon,
  ShieldCheck,
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

const formatter = new Intl.NumberFormat("zh-CN")
const now = new Date()
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`
const bingoMetricLabels: Record<string, string> = {
  hard_3: "困难 · 三连线",
  hard_12: "困难 · 全棋盘",
  extreme_3: "极难 · 三连线",
  extreme_12: "极难 · 全棋盘",
}
const activeStates = new Set(["ready", "running", "online", "starting", "stopping"])
const stateLabels: Record<string, string> = {
  ready: "运行中",
  running: "运行中",
  online: "运行中",
  starting: "启动中",
  stopping: "停止中",
  exited: "已停止",
  failed: "异常",
  offline: "未运行",
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
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [serverData, playerData, catalogData] = await Promise.all([
        fetchJson<ServersResponse>("/api/servers"),
        fetchJson<ListResponse<PlayerPresence>>("/api/players"),
        fetchJson<ListResponse<LeaderboardCatalogRecord>>("/api/leaderboards/catalog"),
      ])
      const latestInstances = new Map<string, ServerInstance>()
      for (const instance of serverData.instances) {
        if (!latestInstances.has(instance.server_id)) latestInstances.set(instance.server_id, instance)
      }
      setServers(serverData.definitions.map((definition) => {
        const instance = latestInstances.get(definition.server_id)
        return {
          id: definition.server_id,
          name: definition.display_name,
          status: instance?.state ?? "offline",
          game_type: definition.game_id,
          online_players: instance?.player_count ?? 0,
          max_players: definition.max_players,
          started_at: instance?.started_at,
          last_heartbeat: instance?.last_heartbeat,
        }
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
      setUpdatedAt(new Date())
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取网络状态")
    } finally {
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

  const onlineServers = useMemo(() => servers.filter((server) => activeStates.has(server.status)), [servers])
  const capacity = useMemo(() => servers.reduce((sum, server) => sum + (server.max_players ?? 0), 0), [servers])
  const utilization = capacity ? Math.round((players.length / capacity) * 100) : 0
  const leaderboardCount = monthlyLeaderboard.length + allTimeLeaderboard.length

  return (
    <main className="min-h-screen">
      <header className="border-b bg-background/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between px-5 py-4 md:px-8">
          <div className="flex items-center gap-3">
            <Avatar className="size-10 rounded-xl">
              <AvatarFallback className="rounded-xl bg-primary text-primary-foreground"><Activity className="size-5" /></AvatarFallback>
            </Avatar>
            <div>
              <p className="brand-type text-lg font-semibold tracking-tight">Scheduler</p>
              <p className="text-xs text-muted-foreground">网络状态与排行榜</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={error ? "warning" : "success"}>
              <span className="status-dot" />
              {error ? "数据连接异常" : "数据同步正常"}
            </Badge>
            <Button variant="outline" size="icon" aria-label="刷新数据" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1480px] px-5 py-8 md:px-8 md:py-12">
        <section className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="max-w-2xl">
            <Badge variant="outline" className="mb-4 border-primary/20 bg-primary/5 text-primary"><ShieldCheck className="size-3" /> PUBLIC STATUS</Badge>
            <h1 className="brand-type text-3xl font-semibold tracking-[-0.035em] text-balance md:text-5xl">整个游戏网络，一眼看清。</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground md:text-base">服务器运行状态、玩家所在位置与排行榜，由 Scheduler 通过公共数据库持续发布。</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock3 className="size-3.5" />
            {updatedAt ? `更新于 ${updatedAt.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "正在获取数据"}
          </div>
        </section>

        {error && (
          <Alert className="mb-6 border-amber-200 bg-amber-50 text-amber-950">
            <Database className="size-4" />
            <AlertTitle>暂时无法连接状态服务</AlertTitle>
            <AlertDescription>页面会每 15 秒自动重试。错误信息：{error}</AlertDescription>
          </Alert>
        )}

        <section className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Card className="metric-card">
            <CardHeader className="flex-row items-center justify-between">
              <CardDescription>运行中的服务器</CardDescription><ServerIcon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><CardTitle className="metric-value">{formatter.format(onlineServers.length)}<span>/ {servers.length}</span></CardTitle></CardContent>
          </Card>
          <Card className="metric-card">
            <CardHeader className="flex-row items-center justify-between">
              <CardDescription>当前在线玩家</CardDescription><Users className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><CardTitle className="metric-value">{formatter.format(players.length)}</CardTitle></CardContent>
          </Card>
          <Card className="metric-card">
            <CardHeader className="flex-row items-center justify-between">
              <CardDescription>网络容量使用</CardDescription><Activity className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="space-y-3"><CardTitle className="metric-value">{utilization}<span>%</span></CardTitle><Progress value={utilization} /></CardContent>
          </Card>
          <Card className="metric-card accent-card">
            <CardHeader className="flex-row items-center justify-between">
              <CardDescription>排行榜记录</CardDescription><Crown className="size-4" />
            </CardHeader>
            <CardContent><CardTitle className="metric-value">{formatter.format(leaderboardCount)}</CardTitle></CardContent>
          </Card>
        </section>

        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview"><Gamepad2 className="size-3.5" />服务器</TabsTrigger>
            <TabsTrigger value="players"><Users className="size-3.5" />玩家</TabsTrigger>
            <TabsTrigger value="leaderboard"><Crown className="size-3.5" />排行榜</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {servers.map((server) => {
                const isOnline = activeStates.has(server.status)
                const load = server.max_players ? Math.round((server.online_players / server.max_players) * 100) : 0
                return (
                  <Card key={server.id} className="server-card">
                    <CardHeader className="flex-row items-start justify-between gap-4">
                      <div className="space-y-2">
                        <CardTitle className="text-base">{server.name}</CardTitle>
                        <CardDescription className="font-mono text-xs">{server.id}</CardDescription>
                      </div>
                      <Badge variant={isOnline ? "success" : "secondary"}>{stateLabels[server.status] ?? server.status}</Badge>
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
              {!loading && servers.length === 0 && <Alert><ServerIcon className="size-4" /><AlertTitle>暂无服务器</AlertTitle><AlertDescription>Scheduler 尚未向数据库发布服务器状态。</AlertDescription></Alert>}
            </div>
          </TabsContent>

          <TabsContent value="players">
            <Card className="overflow-hidden">
              <CardHeader><CardTitle>在线玩家</CardTitle><CardDescription>当前玩家及其所在服务器，共 {players.length} 人</CardDescription></CardHeader>
              <CardContent className="px-0">
                <Table>
                  <TableHeader><TableRow><TableHead>玩家</TableHead><TableHead>所在服务器</TableHead><TableHead className="hidden md:table-cell">进入时间</TableHead><TableHead className="hidden lg:table-cell">UUID</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {players.map((player) => <TableRow key={player.uuid}>
                      <TableCell><div className="flex items-center gap-3"><Avatar><AvatarFallback>{initials(player.username)}</AvatarFallback></Avatar><span className="font-medium">{player.username}</span></div></TableCell>
                      <TableCell><Badge variant="outline"><MapPin className="size-3" />{player.server_name ?? player.server_id}</Badge></TableCell>
                      <TableCell className="hidden text-muted-foreground md:table-cell">{relativeTime(player.connected_at)}</TableCell>
                      <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">{player.uuid}</TableCell>
                    </TableRow>)}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="leaderboard">
            <div className="space-y-5">
              <Card className="gap-4 py-5">
                <CardHeader className="gap-3">
                  <div className="flex flex-col justify-between gap-3 md:flex-row md:items-center">
                    <div><CardTitle>Bingo 排行榜</CardTitle><CardDescription className="mt-1.5">选择玩法，同时查看本月最佳与历史最佳。完成时间越短，排名越高。</CardDescription></div>
                    <Badge variant="outline"><Medal className="size-3" />每榜 TOP 10</Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <Tabs value={selectedMetric} onValueChange={setSelectedMetric}>
                    <TabsList className="h-auto max-w-full flex-wrap justify-start">
                      {(catalog.length > 0 ? catalog : Object.keys(bingoMetricLabels).map((metric) => ({ metric } as LeaderboardCatalogEntry))).map((item) => (
                        <TabsTrigger key={item.metric} value={item.metric}>{item.display_name ?? bingoMetricLabels[item.metric] ?? item.metric}</TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                </CardContent>
              </Card>

              <div className="grid gap-5 2xl:grid-cols-2">
                <Card className="overflow-hidden">
                  <CardHeader className="flex-row items-center justify-between gap-3">
                    <div><CardTitle className="flex items-center gap-2"><CalendarDays className="size-4 text-primary" />本月榜</CardTitle><CardDescription className="mt-1.5">{currentMonth} · {bingoMetricLabels[selectedMetric] ?? selectedMetric}</CardDescription></div>
                    <Badge variant="secondary">MONTH</Badge>
                  </CardHeader>
                  <CardContent className="px-0">
                    <Table>
                      <TableHeader><TableRow><TableHead className="w-16">排名</TableHead><TableHead>玩家 ID</TableHead><TableHead>UUID</TableHead><TableHead className="text-right">完成时间</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {monthlyLeaderboard.map((entry) => <TableRow key={`month-${entry.metric}-${entry.player_uuid}`}>
                          <TableCell><Badge variant={entry.rank <= 3 ? "default" : "secondary"}>#{entry.rank}</Badge></TableCell>
                          <TableCell><div className="flex items-center gap-3"><Avatar><AvatarFallback>{initials(entry.player_id)}</AvatarFallback></Avatar><div><p className="font-medium">{entry.player_id}</p>{entry.username !== entry.player_id && <p className="text-xs text-muted-foreground">{entry.username}</p>}</div></div></TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{entry.player_uuid}</TableCell>
                          <TableCell className="text-right font-mono text-base font-semibold tabular-nums">{formatScore(entry.score, entry.unit)}</TableCell>
                        </TableRow>)}
                      </TableBody>
                    </Table>
                    {monthlyLeaderboard.length === 0 && <div className="px-6 py-10 text-center text-sm text-muted-foreground">本月暂无完成记录</div>}
                  </CardContent>
                </Card>

                <Card className="overflow-hidden">
                  <CardHeader className="flex-row items-center justify-between gap-3">
                    <div><CardTitle className="flex items-center gap-2"><Crown className="size-4 text-primary" />总榜</CardTitle><CardDescription className="mt-1.5">全部历史 · {bingoMetricLabels[selectedMetric] ?? selectedMetric}</CardDescription></div>
                    <Badge variant="secondary">ALL TIME</Badge>
                  </CardHeader>
                  <CardContent className="px-0">
                    <Table>
                      <TableHeader><TableRow><TableHead className="w-16">排名</TableHead><TableHead>玩家 ID</TableHead><TableHead>UUID</TableHead><TableHead className="text-right">完成时间</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {allTimeLeaderboard.map((entry) => <TableRow key={`all-${entry.metric}-${entry.player_uuid}`}>
                          <TableCell><Badge variant={entry.rank <= 3 ? "default" : "secondary"}>#{entry.rank}</Badge></TableCell>
                          <TableCell><div className="flex items-center gap-3"><Avatar><AvatarFallback>{initials(entry.player_id)}</AvatarFallback></Avatar><div><p className="font-medium">{entry.player_id}</p>{entry.username !== entry.player_id && <p className="text-xs text-muted-foreground">{entry.username}</p>}</div></div></TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{entry.player_uuid}</TableCell>
                          <TableCell className="text-right font-mono text-base font-semibold tabular-nums">{formatScore(entry.score, entry.unit)}</TableCell>
                        </TableRow>)}
                      </TableBody>
                    </Table>
                    {allTimeLeaderboard.length === 0 && <div className="px-6 py-10 text-center text-sm text-muted-foreground">暂无历史完成记录</div>}
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
