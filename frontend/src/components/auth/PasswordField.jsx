import { useState } from 'react';
import { Check, Circle, Eye, EyeOff } from 'lucide-react';
import { Input } from '../ui/index.js';
import { PASSWORD_RULES } from '../../utils/passwordRules.js';
import { cn } from '../../utils/cn.js';

// Password input with a show/hide button.
export function PasswordField({ label = 'Password', ...rest }) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return (
    <div className="relative">
      <Input label={label} type={visible ? 'text' : 'password'} className="[&_input]:pr-11" {...rest} />
      <button
        type="button"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        aria-pressed={visible}
        className="absolute right-1.5 top-[30px] flex h-8 w-8 items-center justify-center rounded-md text-navy-400 hover:bg-navy-50 hover:text-navy-700"
      >
        <Icon className="h-4.5 w-4.5" aria-hidden="true" />
      </button>
    </div>
  );
}

// Live checklist of the password rules.
export function PasswordChecklist({ value }) {
  return (
    <ul aria-label="Password rules" className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value);
        const Icon = met ? Check : Circle;
        return (
          <li key={rule.id} className={cn('flex items-center gap-1.5', met ? 'text-income' : 'text-navy-500')}>
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {rule.label}
            <span className="sr-only">{met ? ' (met)' : ' (not met yet)'}</span>
          </li>
        );
      })}
    </ul>
  );
}
