// Fixed option lists shared by forms, tables and charts.
export const PAYMENT_METHODS = [
  { value: 'CARD', label: 'Card' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CASH', label: 'Cash' },
  { value: 'BANK_TRANSFER', label: 'Bank transfer' },
  { value: 'WALLET', label: 'Wallet' },
  { value: 'OTHER', label: 'Other' },
];
export const paymentLabel = (value) => PAYMENT_METHODS.find((method) => method.value === value)?.label ?? value;

export const CURRENCY_CODES = ['INR', 'USD', 'EUR', 'GBP', 'JPY'];

export const CATEGORY_PALETTE = ['#1e2e57', '#4664a8', '#0e7490', '#059669', '#d97706', '#be185d', '#7c3aed', '#64748b'];
export const categoryColor = (category, index) => category.color || CATEGORY_PALETTE[index % CATEGORY_PALETTE.length];
