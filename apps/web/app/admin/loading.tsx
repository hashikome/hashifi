"use client"

import { Helix } from "ldrs/react"
import "ldrs/react/Helix.css"

export default function AdminLoading() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[80vh] w-full space-y-6">
      <div className="relative flex items-center justify-center">
        {/* Glow effect behind the loader */}
        <div className="absolute inset-0 bg-primary/10 rounded-full blur-2xl size-16"></div>
        <div className="relative z-10 text-primary">
          <Helix size="45" speed="2.5" color="currentColor" />
        </div>
      </div>
      <p className="text-muted-foreground font-medium animate-pulse">Loading content...</p>
    </div>
  )
}
