"use client";

import { Edit, Loader, Trash2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface TableEditButtonProps {
  href: string;
  className?: string;
}

export function TableEditButton({ href, className }: TableEditButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isNavigating, setIsNavigating] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on navigation to reset the pending state
  useEffect(() => {
    setIsNavigating(false);
  }, [pathname]);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      disabled={isNavigating}
      onClick={() => {
        setIsNavigating(true);
        router.push(href);
      }}
      aria-label="Edit"
    >
      {isNavigating ? <Loader className="size-4 animate-spin" /> : <Edit className="size-4" />}
    </Button>
  );
}

interface TableDeleteButtonProps {
  onClick: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
}

export function TableDeleteButton({
  onClick,
  isLoading = false,
  disabled = false,
  className,
}: TableDeleteButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={cn("text-destructive hover:text-destructive", className)}
      disabled={isLoading || disabled}
      onClick={onClick}
      aria-label="Delete"
    >
      {isLoading ? <Loader className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
    </Button>
  );
}

interface TableNavButtonProps {
  href: string;
  icon: ReactNode;
  className?: string;
  ariaLabel?: string;
}

export function TableNavButton({
  href,
  icon,
  className,
  ariaLabel = "Navigate",
}: TableNavButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isNavigating, setIsNavigating] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on navigation to reset the pending state
  useEffect(() => {
    setIsNavigating(false);
  }, [pathname]);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      className={className}
      disabled={isNavigating}
      onClick={() => {
        setIsNavigating(true);
        router.push(href);
      }}
      aria-label={ariaLabel}
    >
      {isNavigating ? <Loader className="size-4 animate-spin" /> : icon}
    </Button>
  );
}
