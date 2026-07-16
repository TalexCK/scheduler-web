"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDaysIcon, ClockIcon, CrownIcon, Gamepad2Icon, MapPinIcon, ServerIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type View = "home" | "players" | "leaderboards";
type Definition = { server_id: string; display_name: string; game_id?: string | null; max_players?: number | null };
type Instance = { server_id: string; state: string; player_count: number; last_heartbeat?: string | null };
type Presence = { player_uuid: string; username: string; server_id?: string | null; observed_at?: string | null };
type Entry = { period: string; metric: string; rank: number; player_id: string; player_uuid: string; username: string; score: number; unit: string };
type Catalog = { game: string; metric: string };
const labels: Record<string, string> = { hard_3: "困难 · 三连线", hard_12: "困难 · 全棋盘", extreme_3: "极难 · 三连线", extreme_12: "极难 · 全棋盘" };
const active = new Set(["ready", "running", "starting", "stopping"]);

async function json<T>(url: string): Promise<T> { const response = await fetch(url); if (!response.ok) throw new Error("数据服务暂时不可用"); return response.json(); }
function ago(value?: string | null) { if (!value) return "刚刚"; const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000)); return seconds < 60 ? `${seconds} 秒前` : seconds < 3600 ? `${Math.floor(seconds / 60)} 分钟前` : `${Math.floor(seconds / 3600)} 小时前`; }
function score(value: number, unit: string) { if (unit !== "ms") return `${value} ${unit}`; const seconds = Math.floor(value / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}.${String(value % 1000).padStart(3, "0")}`; }

export function DashboardPage({ view }: { view: View }) {
  const [definitions, setDefinitions] = useState<Definition[]>([]);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [players, setPlayers] = useState<Presence[]>([]);
  const [catalog, setCatalog] = useState<Catalog[]>([]);
  const [metric, setMetric] = useState("hard_3");
  const [monthly, setMonthly] = useState<Entry[]>([]);
  const [allTime, setAllTime] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [updated, setUpdated] = useState<Date>();
  const load = useCallback(async () => {
    try {
      const [servers, online, modes] = await Promise.all([json<{ definitions: Definition[]; instances: Instance[] }>("/api/servers"), json<{ data: Presence[] }>("/api/players"), json<{ data: Catalog[] }>("/api/leaderboards/catalog")]);
      setDefinitions(servers.definitions); setInstances(servers.instances); setPlayers(online.data); setCatalog(modes.data); setError(""); setUpdated(new Date());
    } catch (reason) { setError(reason instanceof Error ? reason.message : "数据服务暂时不可用"); }
  }, []);
  useEffect(() => { const refresh = () => void load(); const initial = window.setTimeout(refresh, 0); window.addEventListener("scheduler:refresh", refresh); const timer = setInterval(refresh, 15000); return () => { clearTimeout(initial); window.removeEventListener("scheduler:refresh", refresh); clearInterval(timer); }; }, [load]);
  useEffect(() => { if (view !== "leaderboards") return; const month = new Date().toISOString().slice(0, 7); const base = `game=bingo&metric=${metric}&limit=10`; Promise.all([json<{ data: Entry[] }>(`/api/leaderboards?${base}&period=month&period_key=${month}`), json<{ data: Entry[] }>(`/api/leaderboards?${base}&period=all_time`)]).then(([a, b]) => { setMonthly(a.data); setAllTime(b.data); }).catch(() => setError("排行榜暂时不可用")); }, [metric, updated, view]);

  const meta = view === "home" ? ["HOME", "服务器状态", "查看游戏网络中正在运行的服务器。"] : view === "players" ? ["PLAYER", "在线玩家", "查看当前在线玩家及其所在服务器。"] : ["RANKINGS", "游戏排行榜", "按游戏与模式查看本月榜和历史总榜。"];
  const latest = new Map<string, Instance>(); instances.filter((item) => active.has(item.state)).forEach((item) => { if (!latest.has(item.server_id)) latest.set(item.server_id, item); });
  const total = new Set(players.map((player) => player.player_uuid)).size;
  const servers = definitions.flatMap((definition) => { const instance = latest.get(definition.server_id); return instance ? [{ ...definition, ...instance, player_count: definition.server_id.toLowerCase() === "proxy" ? total : instance.player_count }] : []; });
  const names = new Map(definitions.map((item) => [item.server_id, item.display_name]));
  const modes = Array.from(new Set(catalog.filter((item) => item.game === "bingo").map((item) => item.metric)));

  return <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-medium tracking-[.18em] text-muted-foreground">{meta[0]}</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">{meta[1]}</h1><p className="mt-2 text-sm text-muted-foreground">{meta[2]}</p></div><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><ClockIcon className="size-3.5" />{updated ? `更新于 ${updated.toLocaleTimeString("zh-CN")}` : "正在获取数据"}</p></div>
    {error && <Card className="mb-6"><CardHeader><CardTitle className="text-destructive">无法读取数据</CardTitle><CardDescription>{error}，页面会自动重试。</CardDescription></CardHeader></Card>}
    {view === "home" && <Card className="gap-0 py-0"><div className="hidden grid-cols-[1.5fr_100px_130px_1fr_110px] border-b px-4 py-3 text-xs text-muted-foreground md:grid"><span>服务器</span><span>状态</span><span>在线玩家</span><span>游戏</span><span className="text-right">最近心跳</span></div>{servers.map((server) => <div key={server.server_id} className="grid gap-3 border-b px-4 py-4 last:border-0 md:grid-cols-[1.5fr_100px_130px_1fr_110px] md:items-center"><div className="flex items-center gap-3"><span className="grid size-8 place-items-center rounded-lg bg-muted"><ServerIcon className="size-4" /></span><div><p className="font-medium">{server.display_name}</p><p className="text-xs text-muted-foreground">{server.server_id}</p></div></div><Badge variant="secondary">{server.state === "ready" ? "运行中" : server.state}</Badge><p className="font-semibold">{server.player_count} <span className="text-xs font-normal text-muted-foreground">/ {server.max_players ?? "∞"}</span></p><Badge variant="outline"><Gamepad2Icon />{server.game_id ?? "通用"}</Badge><p className="text-right text-xs text-muted-foreground">{ago(server.last_heartbeat)}</p></div>)}</Card>}
    {view === "players" && <Card><CardHeader><CardTitle>在线玩家</CardTitle><CardDescription>当前共 {players.length} 人在线</CardDescription></CardHeader><CardContent className="px-0"><Table><TableHeader><TableRow><TableHead>玩家</TableHead><TableHead>所在服务器</TableHead><TableHead>在线时间</TableHead><TableHead className="hidden md:table-cell">UUID</TableHead></TableRow></TableHeader><TableBody>{players.map((player) => <TableRow key={player.player_uuid}><TableCell className="font-medium">{player.username}</TableCell><TableCell><Badge variant="outline"><MapPinIcon />{player.server_id ? names.get(player.server_id) ?? player.server_id : "等待分配"}</Badge></TableCell><TableCell>{ago(player.observed_at)}</TableCell><TableCell className="hidden text-muted-foreground md:table-cell">{player.player_uuid}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>}
    {view === "leaderboards" && <div className="space-y-4"><Card><CardHeader><CardTitle>选择游戏</CardTitle><CardDescription>目前支持 Bingo</CardDescription></CardHeader><CardContent><Button><Gamepad2Icon />Bingo</Button></CardContent></Card><Card><CardHeader><CardTitle>Bingo 排行榜</CardTitle><CardDescription>选择游戏模式</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2">{(modes.length ? modes : Object.keys(labels)).map((item) => <Button key={item} variant={metric === item ? "default" : "outline"} onClick={() => setMetric(item)}>{labels[item] ?? item}</Button>)}</CardContent></Card><div className="grid gap-4 lg:grid-cols-2"><Ranking title="本月榜" icon={<CalendarDaysIcon />} entries={monthly} /><Ranking title="总榜" icon={<CrownIcon />} entries={allTime} /></div></div>}
  </main>;
}

function Ranking({ title, icon, entries }: { title: string; icon: React.ReactNode; entries: Entry[] }) { return <Card><CardHeader><CardTitle className="flex items-center gap-2">{icon}{title}</CardTitle></CardHeader><CardContent className="px-0"><Table><TableHeader><TableRow><TableHead>排名</TableHead><TableHead>玩家</TableHead><TableHead className="text-right">完成时间</TableHead></TableRow></TableHeader><TableBody>{entries.map((entry) => <TableRow key={`${entry.period}-${entry.player_uuid}`}><TableCell><Badge>#{entry.rank}</Badge></TableCell><TableCell>{entry.player_id}</TableCell><TableCell className="text-right font-semibold">{score(entry.score, entry.unit)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>; }
