"use client"

import * as React from "react"
import { AlertTriangle, Info, AlertCircle, LucideIcon, Loader } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ConfirmModalVariant = "primary" | "destructive" | "warning" | "info"

interface ConfirmModalProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  description: React.ReactNode
  confirmText?: string
  cancelText?: string
  variant?: ConfirmModalVariant
  icon?: LucideIcon
  isLoading?: boolean
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "primary",
  icon: CustomIcon,
  isLoading = false,
}: ConfirmModalProps) {
  const [internalLoading, setInternalLoading] = React.useState(false)

  const handleConfirm = async () => {
    setInternalLoading(true)
    try {
      await onConfirm()
    } finally {
      setInternalLoading(false)
    }
  }

  const getVariantStyles = () => {
    switch (variant) {
      case "destructive":
        return {
          headerBg: "bg-destructive/5",
          headerBorder: "border-destructive/10",
          iconBg: "bg-destructive/10",
          iconColor: "text-destructive",
          buttonVariant: "destructive" as const,
          icon: AlertTriangle,
        }
      case "warning":
        return {
          headerBg: "bg-amber-500/5",
          headerBorder: "border-amber-500/10",
          iconBg: "bg-amber-500/10",
          iconColor: "text-amber-500",
          buttonVariant: "default" as const,
          icon: AlertCircle,
        }
      case "info":
        return {
          headerBg: "bg-blue-500/5",
          headerBorder: "border-blue-500/10",
          iconBg: "bg-blue-500/10",
          iconColor: "text-blue-500",
          buttonVariant: "default" as const,
          icon: Info,
        }
      default:
        return {
          headerBg: "bg-primary/5",
          headerBorder: "border-primary/10",
          iconBg: "bg-primary/10",
          iconColor: "text-primary",
          buttonVariant: "default" as const,
          icon: Info,
        }
    }
  }

  const styles = getVariantStyles()
  const Icon = CustomIcon || styles.icon

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[400px] p-0 overflow-hidden border-none shadow-2xl">
        <div
          className={cn(
            styles.headerBg,
            "pt-8 pb-6 flex flex-col items-center justify-center border-b",
            styles.headerBorder,
          )}
        >
          <div
            className={cn(
              styles.iconBg,
              "size-16 rounded-full flex items-center justify-center mb-4",
              variant === "destructive" && "animate-pulse",
            )}
          >
            <Icon className={cn("size-8", styles.iconColor)} />
          </div>
          <DialogHeader className="px-6 space-y-2">
            <DialogTitle className="text-xl font-bold text-center">{title}</DialogTitle>
            <DialogDescription className="text-center text-muted-foreground leading-relaxed">
              {description}
            </DialogDescription>
          </DialogHeader>
        </div>
        <DialogFooter className="p-6 flex-col sm:flex-row gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isLoading || internalLoading}
            className="flex-1 mt-0 border-muted-foreground/20 hover:bg-muted hover:text-foreground transition-all duration-200"
          >
            {cancelText}
          </Button>
          <Button
            type="button"
            variant={styles.buttonVariant}
            onClick={handleConfirm}
            disabled={isLoading || internalLoading}
            className={cn(
              "flex-1 transition-all duration-200 active:scale-95",
              variant === "destructive"
                ? "bg-destructive text-white hover:bg-red-600 shadow-lg shadow-destructive/20"
                : "shadow-lg shadow-primary/20",
            )}
          >
            {isLoading || internalLoading ? (
              <>
                <Loader className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              confirmText
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
