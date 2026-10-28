"use client"

import * as React from "react"
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts"

import { useIsMobile } from "@/hooks/use-mobile"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"

type DailyPoint = {
  date: string
  upload: number
  download: number
}

const chartConfig = {
  transfer: { label: "Data Transfer" },
  upload: { label: "Upload (GB)", color: "var(--primary)" },
  download: { label: "Download (GB)", color: "var(--primary)" },
} satisfies ChartConfig

function bytesToGb(bytes: number): number {
  return parseFloat((bytes / (1024 * 1024 * 1024)).toFixed(2))
}

export function ChartAreaInteractive() {
  const isMobile = useIsMobile()
  const [timeRange, setTimeRange] = React.useState("90d")
  const [chartData, setChartData] = React.useState<DailyPoint[]>([])

  React.useEffect(() => {
    if (isMobile) setTimeRange("7d")
  }, [isMobile])

  React.useEffect(() => {
    const days = timeRange === "7d" ? 7 : timeRange === "30d" ? 30 : 90
    let mounted = true
    fetch(`${API_URL}/api/analytics/daily-usage?days=${days}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (!mounted || !json) return
        const points: DailyPoint[] = (
          json.dailyUsage as { date: string; uploadBytes: number; downloadBytes: number }[]
        ).map((d) => ({
          date: d.date,
          upload: bytesToGb(d.uploadBytes),
          download: bytesToGb(d.downloadBytes),
        }))
        setChartData(points)
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [timeRange])

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Daily Data Transfer</CardTitle>
        <CardDescription>
          <span className="hidden @[540px]/card:block">
            Upload &amp; download in GB for the selected period
          </span>
          <span className="@[540px]/card:hidden">Upload &amp; download</span>
        </CardDescription>
        <CardAction>
          <ToggleGroup
            type="single"
            value={timeRange}
            onValueChange={setTimeRange}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            <ToggleGroupItem value="90d">Last 3 months</ToggleGroupItem>
            <ToggleGroupItem value="30d">Last 30 days</ToggleGroupItem>
            <ToggleGroupItem value="7d">Last 7 days</ToggleGroupItem>
          </ToggleGroup>
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label="Select a value"
            >
              <SelectValue placeholder="Last 3 months" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="90d" className="rounded-lg">
                Last 3 months
              </SelectItem>
              <SelectItem value="30d" className="rounded-lg">
                Last 30 days
              </SelectItem>
              <SelectItem value="7d" className="rounded-lg">
                Last 7 days
              </SelectItem>
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {chartData.length === 0 ? (
          <div className="flex aspect-auto h-[250px] w-full items-center justify-center text-sm text-muted-foreground">
            No data for this period
          </div>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
            <AreaChart data={chartData}>
              <defs>
                <linearGradient id="fillUpload" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-upload)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--color-upload)" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="fillDownload" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-download)" stopOpacity={0.5} />
                  <stop offset="95%" stopColor="var(--color-download)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value) =>
                  new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                }
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(v) => `${v} GB`}
                width={60}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    labelFormatter={(value) =>
                      new Date(value).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })
                    }
                    indicator="dot"
                  />
                }
              />
              <Area
                dataKey="upload"
                type="natural"
                fill="url(#fillUpload)"
                stroke="var(--color-upload)"
                stackId="a"
              />
              <Area
                dataKey="download"
                type="natural"
                fill="url(#fillDownload)"
                stroke="var(--color-download)"
                stackId="a"
              />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
