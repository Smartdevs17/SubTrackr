import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import InvoiceListScreen from '../InvoiceListScreen';
import { ThemeProvider } from '../../context/ThemeContext';
import { useInvoiceStore } from '../../store';
import { Invoice, InvoiceStatus } from '../../types/invoice';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
}));

function makeInvoice(overrides: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-000001',
    subscriptionId: 'sub-1',
    subscriptionName: 'Netflix',
    merchantName: 'Netflix',
    lineItems: [],
    tax: 0,
    total: 15.99,
    subtotal: 15.99,
    dueDate: new Date('2026-01-15T00:00:00.000Z'),
    status: InvoiceStatus.SENT,
    currency: 'USD',
    region: 'US',
    exchangeRate: 1,
    period: {} as Invoice['period'],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function renderScreen() {
  return render(
    <ThemeProvider>
      <InvoiceListScreen />
    </ThemeProvider>
  );
}

describe('InvoiceListScreen accessibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useInvoiceStore.setState({ invoices: [] });
  });

  it('labels the screen itself', () => {
    renderScreen();

    expect(screen.getByLabelText('Invoice list screen')).toBeTruthy();
  });

  it('renders each invoice row as a button with a full spoken label', () => {
    useInvoiceStore.setState({ invoices: [makeInvoice()] });

    renderScreen();

    const row = screen.getByTestId('invoice-row-inv-1');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityLabel).toBe(
      'Invoice INV-000001 from Netflix, total $15.99, Sent'
    );
  });

  it('navigates to the invoice detail when a row is pressed', () => {
    useInvoiceStore.setState({ invoices: [makeInvoice()] });

    renderScreen();

    fireEvent.press(screen.getByTestId('invoice-row-inv-1'));

    expect(mockNavigate).toHaveBeenCalledWith('InvoiceDetail', { id: 'inv-1' });
  });

  it('shows the empty state when there are no invoices', () => {
    renderScreen();

    expect(screen.getByText('No invoices yet')).toBeTruthy();
    expect(screen.queryByTestId(/^invoice-row-/)).toBeNull();
  });
});

describe('InvoiceListScreen list behaviour', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useInvoiceStore.setState({ invoices: [] });
  });

  it('shows the newest invoice first', () => {
    useInvoiceStore.setState({
      invoices: [
        makeInvoice({ id: 'inv-old', createdAt: new Date('2025-12-01T00:00:00.000Z') }),
        makeInvoice({ id: 'inv-new', createdAt: new Date('2026-02-01T00:00:00.000Z') }),
      ],
    });

    renderScreen();

    const rows = screen.getAllByTestId(/^invoice-row-/);
    expect(rows.map((r) => r.props.testID)).toEqual(['invoice-row-inv-new', 'invoice-row-inv-old']);
  });
});
