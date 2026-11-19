import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Inbox } from 'lucide-react';
import { renderWithRouter } from '../../test/renderApp.jsx';
import { Alert, Button, EmptyState, Input, Select, Spinner, StatCard } from './index.js';

describe('Button', () => {
  test('is a real button that fires onClick', async () => {
    const onClick = vi.fn();
    renderWithRouter(<Button onClick={onClick}>Save</Button>);
    const button = screen.getByRole('button', { name: 'Save' });
    expect(button).toHaveAttribute('type', 'button'); // never submits a form by accident
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test('renders a link when given `to`', () => {
    renderWithRouter(<Button to="/register">Get started</Button>);
    expect(screen.getByRole('link', { name: 'Get started' })).toHaveAttribute('href', '/register');
  });

  test('while loading it is disabled, marked busy and ignores clicks', async () => {
    const onClick = vi.fn();
    renderWithRouter(<Button loading onClick={onClick}>Saving</Button>);
    const button = screen.getByRole('button', { name: 'Saving' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });
});

describe('form controls', () => {
  test('the label is bound to the input and typing works', async () => {
    renderWithRouter(<Input label="Email" type="email" hint="We never share it." />);
    const input = screen.getByLabelText('Email');
    await userEvent.type(input, 'a@b.test');
    expect(input).toHaveValue('a@b.test');
    expect(input).toHaveAccessibleDescription('We never share it.');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  test('an error marks the input invalid and is announced', () => {
    renderWithRouter(<Input label="Amount" error="Amount must be greater than 0" hint="In your base currency" />);
    const input = screen.getByLabelText('Amount');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Amount must be greater than 0');
    expect(screen.getByRole('alert')).toHaveTextContent('Amount must be greater than 0');
    expect(screen.queryByText('In your base currency')).not.toBeInTheDocument();
  });

  test('required fields carry the native attribute', () => {
    renderWithRouter(<Input label="Full name" required />);
    expect(screen.getByRole('textbox', { name: /full name/i })).toBeRequired();
  });

  test('Select is labelled and selectable', async () => {
    renderWithRouter(
      <Select label="Currency" defaultValue="INR">
        <option>INR</option>
        <option>USD</option>
      </Select>
    );
    const select = screen.getByLabelText('Currency');
    await userEvent.selectOptions(select, 'USD');
    expect(select).toHaveValue('USD');
  });
});

describe('feedback components', () => {
  test('errors and warnings interrupt, info and success are polite', () => {
    renderWithRouter(
      <>
        <Alert tone="error" title="Could not save" />
        <Alert tone="warning" title="Budget almost used" />
        <Alert tone="success" title="Saved" />
        <Alert tone="info">Rates refresh daily</Alert>
      </>
    );
    expect(screen.getAllByRole('alert').map((node) => node.textContent)).toEqual(['Could not save', 'Budget almost used']);
    expect(screen.getAllByRole('status')).toHaveLength(2);
  });

  test('Spinner announces its label; EmptyState shows title, text and action', () => {
    renderWithRouter(
      <>
        <Spinner label="Loading transactions" />
        <EmptyState icon={Inbox} title="No transactions yet" description="Add your first one." action={<Button>Add transaction</Button>} />
      </>
    );
    expect(screen.getByRole('status')).toHaveTextContent('Loading transactions');
    expect(screen.getByText('No transactions yet')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument(); // a status message, not a section
    expect(screen.getByRole('button', { name: 'Add transaction' })).toBeInTheDocument();
  });

  test('StatCard shows label, value and hint', () => {
    renderWithRouter(<StatCard label="Total income" value="₹85,000.00" hint="This month" />);
    expect(screen.getByText('Total income')).toBeInTheDocument();
    expect(screen.getByText('₹85,000.00')).toBeInTheDocument();
    expect(screen.getByText('This month')).toBeInTheDocument();
  });
});
