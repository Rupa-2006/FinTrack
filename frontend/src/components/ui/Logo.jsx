import { cn } from '../../utils/cn.js';

export function Logo({ inverse = false, className }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
        <defs>
          <linearGradient id="logo-gradient" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={inverse ? '#ffffff' : '#344d8c'} />
            <stop offset="1" stopColor={inverse ? '#e4eaf5' : '#14213d'} />
          </linearGradient>
        </defs>
        <rect width="32" height="32" rx="8" fill="url(#logo-gradient)" />
        <path d="M8 21l5-6 4 3 7-9" fill="none" stroke={inverse ? '#14213d' : '#fff'} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="24" cy="9" r="2.2" fill="#34d399" />
      </svg>
      <span className={cn('text-lg font-bold tracking-tight', inverse ? 'text-white' : 'text-navy-900')}>FinTrack</span>
    </span>
  );
}
