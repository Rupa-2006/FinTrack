import {
  ArrowLeftRight, Bell, Coins, LayoutDashboard, LineChart, PiggyBank, Repeat, ShieldCheck, Sparkles, Target, UserRound, Users,
} from 'lucide-react';

// One list drives the sidebar and the route table, so they cannot drift apart.
// `phase` is the development phase that implements the page; routes/AppRoutes.jsx shows a
// clearly labelled notice for pages whose phase has not been built yet.
export const NAV_SECTIONS = [
  {
    title: 'Overview',
    items: [
      { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, phase: 6, description: 'Income, expenses, balance and trends at a glance.' },
    ],
  },
  {
    title: 'Money',
    items: [
      { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight, phase: 6, description: 'Record, search and filter income and expenses.' },
      { to: '/recurring', label: 'Recurring transactions', icon: Repeat, phase: 11, description: 'Rent, salary and subscriptions, recorded automatically.' },
      { to: '/budgets', label: 'Budgets', icon: PiggyBank, phase: 6, description: 'Monthly limits by category with progress and warnings.' },
      { to: '/goals', label: 'Savings goals', icon: Target, phase: 6, description: 'Targets, contributions and deadlines.' },
      { to: '/currencies', label: 'Currencies', icon: Coins, phase: 6, description: 'Base currency, exchange rates and conversion history.' },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/analytics', label: 'Analytics', icon: LineChart, phase: 6, description: 'Reports by period and category, with CSV export.' },
      { to: '/assistant', label: 'AI assistant', icon: Sparkles, phase: 8, description: 'Ask questions about your own spending.' },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/notifications', label: 'Notifications', icon: Bell, phase: 6, description: 'Budget alerts, unusual spending and security notices.' },
      { to: '/security', label: 'Security', icon: ShieldCheck, phase: 7, description: 'Active sessions, sign-in history and password.' },
      { to: '/profile', label: 'Profile', icon: UserRound, phase: 5, description: 'Your name, contact details and preferences.' },
    ],
  },
];

export const ADMIN_NAV = {
  title: 'Administration',
  items: [
    { to: '/admin', label: 'Admin dashboard', icon: Users, phase: 7, description: 'Accounts, roles, usage and security monitoring.' },
  ],
};

// Routes that exist but are not in the sidebar.
export const EXTRA_APP_ROUTES = [
  { to: '/transactions/new', label: 'Add transaction', icon: ArrowLeftRight, phase: 6, description: 'Record a new income or expense.' },
  { to: '/transactions/import', label: 'Import transactions', icon: ArrowLeftRight, phase: 11, description: 'Import from a CSV file.' },
  { to: '/transactions/:id/edit', label: 'Edit transaction', icon: ArrowLeftRight, phase: 6, description: 'Change an income or expense.', hidden: true },
];

export const PUBLIC_AUTH_ROUTES = [
  { to: '/login', label: 'Sign in', phase: 5, description: 'Sign in to your FinTrack account.' },
  { to: '/register', label: 'Create your account', phase: 5, description: 'Open a free FinTrack account.' },
  { to: '/forgot-password', label: 'Reset your password', phase: 5, description: 'Get a link to choose a new password.' },
  { to: '/reset-password', label: 'Choose a new password', phase: 5, description: 'Opened from the link in the reset email.' },
];
