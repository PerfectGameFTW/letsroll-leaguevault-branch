import * as React from "react"
import * as TogglePrimitive from "@radix-ui/react-toggle"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle-variants"

export interface ToggleProps
  extends React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root>,
    VariantProps<typeof toggleVariants> {
  /**
   * The ARIA label for the toggle button when it is pressed
   */
  ariaLabel?: string;
}

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  ToggleProps
>(({ className, variant, size, ariaLabel, ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(toggleVariants({ variant, size, className }))}
    aria-label={ariaLabel}
    {...props}
  />
))

Toggle.displayName = TogglePrimitive.Root.displayName

export { Toggle }