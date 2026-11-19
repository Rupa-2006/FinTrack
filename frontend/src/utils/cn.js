// Joins class names, skipping falsy values:  cn('a', isActive && 'b')  ->  'a b'
export function cn(...parts) {
  return parts.filter(Boolean).join(' ');
}
