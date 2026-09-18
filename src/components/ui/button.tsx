import * as React from 'react'
import { cn } from '@/lib/utils'

type Wariant = 'glowny' | 'akcent' | 'zwykly' | 'ostrzezenie'

const warianty: Record<Wariant, string> = {
  glowny: 'bg-limonka text-slate-900 hover:bg-limonka-ciemna hover:text-white',
  akcent: 'bg-blekit text-slate-900 hover:bg-blekit-ciemny hover:text-white',
  zwykly: 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100',
  ostrzezenie: 'bg-amber-500 text-white hover:bg-amber-600',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  wariant?: Wariant
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, wariant = 'zwykly', ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium',
        'transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
        'focus-visible:outline-blekit-ciemny disabled:pointer-events-none disabled:opacity-50',
        warianty[wariant],
        className,
      )}
      {...props}
    />
  ),
)
Button.displayName = 'Button'
