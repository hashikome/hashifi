"use client"

import { useEffect, useState } from "react"
import { IconTrendingDown, IconTrendingUp } from "@tabler/icons-react"
import { Activity, DollarSign, HardDrive, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"

type Summary = {
  activeSessions: number
  totalSessions: number
  totalCustomers: number
  monthlyRevenueTsh: number
  weeklyUploadBytes: number
  weeklyDownloadBytes: number
}

function bytesToGb(bytes: number): string {
  if (bytes === 0) return "0 GB"
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1000) return `${(gb / 1024).toFixed(1)} TB`
  return `${gb.toFixed(1)} GB`
}

export function SectionCards() {
  const [data, setData] = useState<Summary | null>(null)

  useEffect(() => {
    let mounted = true
    fetch(`${API_URL}/api/analytics/summary`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (mounted && json) setData(json)
      })
      .catch(() => {})
    return () => {
      mounted = false
    }
  }, [])

  const totalWeeklyBytes = (data?.weeklyUploadBytes ?? 0) + (data?.weeklyDownloadBytes ?? 0)

  const cards = [
    {
      label: "Live Sessions",
      value: data ? data.activeSessions.toLocaleString() : "—",
      sub: data ? `${data.totalSessions.toLocaleString()} total sessions` : "Loading…",
      icon: Activity,
      trend: null,
    },
    {
      label: "Monthly Revenue",
      value: data ? `TSH ${Math.floor(data.monthlyRevenueTsh).toLocaleString()}` : "—",
      sub: "This calendar month",
      icon: DollarSign,
      trend: null,
    },
    {
      label: "Total Customers",
      value: data ? data.totalCustomers.toLocaleString() : "—",
      sub: "Registered WiFi users",
      icon: Users,
      trend: null,
    },
    {
      label: "Weekly Data",
      value: data ? bytesToGb(totalWeeklyBytes) : "—",
      sub: data
        ? `↑ ${bytesToGb(data.weeklyUploadBytes)}  ↓ ${bytesToGb(data.weeklyDownloadBytes)}`
        : "Last 7 days",
      icon: HardDrive,
      trend: null,
    },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 @5xl/main:grid-cols-4 dark:*:data-[slot=card]:bg-card">
      {cards.map((card) => (
        <Card key={card.label} className="@container/card">
          <CardHeader>
            <CardDescription className="flex items-center justify-between">
              <span>{card.label}</span>
              <card.icon className="size-4 text-muted-foreground" />
            </CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {card.value}
            </CardTitle>
          </CardHeader>
          <CardFooter className="flex-col items-start gap-1.5 text-sm">
            <div className="text-muted-foreground text-xs">{card.sub}</div>
          </CardFooter>
        </Card>
      ))}
    </div>
  )
}
