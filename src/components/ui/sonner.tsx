"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { InfoIcon, TriangleAlertIcon } from "lucide-react"
import { CheckDraw, CrossDraw, Spinner } from "@/components/ui/status"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        // One vocabulary for "it landed" everywhere: the tick that draws itself, in the gain colour.
        success: (
          <CheckDraw ring className="size-[18px] text-up" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <CrossDraw className="size-4 text-down" />
        ),
        loading: (
          <Spinner className="size-4 text-soft" />
        ),
      }}
      style={
        {
          // A toast floats above everything, so it sits a step above the cards (--raised over --surface) with a real shadow.
          "--normal-bg": "var(--raised)",
          "--normal-text": "var(--ink)",
          "--normal-border": "rgba(255,255,255,0.08)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !shadow-[0_18px_40px_-12px_rgba(0,0,0,0.85)]",
          description: "!text-soft",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
