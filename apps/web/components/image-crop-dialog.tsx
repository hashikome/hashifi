"use client"

import { useState, useRef, useCallback } from "react"
import ReactCrop, { centerCrop, makeAspectCrop, type Crop, type PixelCrop } from "react-image-crop"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Loader } from "lucide-react"

interface ImageCropDialogProps {
  isOpen: boolean
  onClose: () => void
  /** data: URL of the selected image */
  imageSrc: string | null
  /** 1 for logo (square), undefined for background (free-form) */
  aspect?: number
  title: string
  description: string
  /** Called with the cropped blob. Throw to keep dialog open on error. */
  onApply: (blob: Blob) => Promise<void>
}

function initCrop(img: HTMLImageElement, aspect: number | undefined, setCrop: (c: Crop) => void) {
  const { width, height } = img
  const initial: Crop = aspect
    ? centerCrop(makeAspectCrop({ unit: "%", width: 90 }, aspect, width, height), width, height)
    : { unit: "%", x: 5, y: 5, width: 90, height: 90 }
  setCrop(initial)
}

async function cropToBlob(img: HTMLImageElement, px: PixelCrop): Promise<Blob> {
  const scaleX = img.naturalWidth / img.width
  const scaleY = img.naturalHeight / img.height

  const canvas = document.createElement("canvas")
  canvas.width = Math.round(px.width * scaleX)
  canvas.height = Math.round(px.height * scaleY)

  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas not available")

  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(
    img,
    px.x * scaleX,
    px.y * scaleY,
    px.width * scaleX,
    px.height * scaleY,
    0,
    0,
    canvas.width,
    canvas.height,
  )

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas is empty"))),
      "image/jpeg",
      0.92,
    )
  })
}

export function ImageCropDialog({
  isOpen,
  onClose,
  imageSrc,
  aspect,
  title,
  description,
  onApply,
}: ImageCropDialogProps) {
  const [crop, setCrop] = useState<Crop>()
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>()
  const [isApplying, setIsApplying] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  const handleApply = useCallback(async () => {
    if (!imgRef.current || !completedCrop) return
    setIsApplying(true)
    try {
      const blob = await cropToBlob(imgRef.current, completedCrop)
      await onApply(blob)
      onClose()
    } catch {
      // onApply already shows toast — just keep dialog open
    } finally {
      setIsApplying(false)
    }
  }, [completedCrop, onApply, onClose])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {imageSrc && (
          <div className="flex items-center justify-center overflow-hidden rounded-lg bg-muted/40 p-2">
            <ReactCrop
              crop={crop}
              onChange={(_, pct) => setCrop(pct)}
              onComplete={(px) => setCompletedCrop(px)}
              aspect={aspect}
              minWidth={50}
              minHeight={50}
              keepSelection
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={imageSrc}
                alt="Crop preview"
                className="max-h-[460px] max-w-full object-contain"
                onLoad={(e) => initCrop(e.currentTarget, aspect, setCrop)}
              />
            </ReactCrop>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isApplying}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={isApplying || !completedCrop}>
            {isApplying && <Loader className="mr-2 size-4 animate-spin" />}
            Apply & Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
