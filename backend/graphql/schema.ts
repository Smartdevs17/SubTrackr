/**
 * GraphQL schema — Relay-compatible connection types.
 *
 * Follows the Relay cursor-connection spec:
 *   https://relay.dev/graphql/connections.htm
 *
 * All list fields use edges/node/PageInfo.  Legacy offset-based fields are
 * preserved with a @deprecated directive for backward compatibility.
 */

export const typeDefs = /* GraphQL */ `
  # ── Relay pagination types ────────────────────────────────────────────────

  type PageInfo {
    hasNextPage:     Boolean!
    hasPreviousPage: Boolean!
    startCursor:     String
    endCursor:       String
  }

  # ── Subscription ──────────────────────────────────────────────────────────

  type Subscription {
    id:              ID!
    userId:          String!
    name:            String!
    amount:          Float!
    currency:        String!
    billingCycle:    String!
    status:          String!
    nextBillingDate: String!
    createdAt:       String!
    updatedAt:       String!
    transactions(first: Int, after: String): TransactionConnection!
  }

  type SubscriptionEdge {
    cursor: String!
    node:   Subscription!
  }

  type SubscriptionConnection {
    edges:      [SubscriptionEdge!]!
    pageInfo:   PageInfo!
    totalCount: Int!
  }

  # ── Transaction ───────────────────────────────────────────────────────────

  type Transaction {
    id:             ID!
    subscriptionId: String!
    userId:         String!
    amount:         Float!
    currency:       String!
    status:         String!
    timestamp:      String!
    txHash:         String
  }

  type TransactionEdge {
    cursor: String!
    node:   Transaction!
  }

  type TransactionConnection {
    edges:      [TransactionEdge!]!
    pageInfo:   PageInfo!
    totalCount: Int!
  }

  # ── Invoice ───────────────────────────────────────────────────────────────

  type Invoice {
    id:             ID!
    subscriptionId: String!
    userId:         String!
    amount:         Float!
    currency:       String!
    status:         String!
    issuedAt:       String!
    dueAt:          String
    paidAt:         String
  }

  type InvoiceEdge {
    cursor: String!
    node:   Invoice!
  }

  type InvoiceConnection {
    edges:      [InvoiceEdge!]!
    pageInfo:   PageInfo!
    totalCount: Int!
  }

  # ── PaymentMethod ─────────────────────────────────────────────────────────

  type PaymentMethod {
    id:        ID!
    userId:    String!
    type:      String!
    last4:     String
    brand:     String
    expiresAt: String
  }

  type PaymentMethodEdge {
    cursor: String!
    node:   PaymentMethod!
  }

  type PaymentMethodConnection {
    edges:    [PaymentMethodEdge!]!
    pageInfo: PageInfo!
  }

  # ── Plan ──────────────────────────────────────────────────────────────────

  type Plan {
    id:          ID!
    name:        String!
    price:       Float!
    currency:    String!
    billingCycle: String!
  }

  type PlanEdge {
    cursor: String!
    node:   Plan!
  }

  type PlanConnection {
    edges:    [PlanEdge!]!
    pageInfo: PageInfo!
  }

  # ── Query ─────────────────────────────────────────────────────────────────

  type Query {
    """Cursor-based subscription list for a user."""
    subscriptions(
      userId: String!
      first:  Int    = 20
      after:  String
    ): SubscriptionConnection!

    """Single subscription by ID."""
    subscription(id: ID!): Subscription

    """Cursor-based transaction list for a subscription."""
    transactions(
      subscriptionId: String!
      first:          Int    = 20
      after:          String
    ): TransactionConnection!

    """Cursor-based payment methods for a user."""
    paymentMethods(
      userId: String!
      first:  Int    = 10
      after:  String
    ): PaymentMethodConnection!

    """Cursor-based invoice list for a subscription."""
    invoices(
      subscriptionId: String!
      first:          Int    = 20
      after:          String
    ): InvoiceConnection!

    """Available plans."""
    plans(first: Int = 50, after: String): PlanConnection!

    """
    Legacy offset-based subscription list.
    @deprecated Use subscriptions(first, after) instead.
    """
    subscriptionsOffset(
      userId: String!
      limit:  Int = 20
      offset: Int = 0
    ): [Subscription!]! @deprecated(reason: "Use subscriptions with cursor pagination")
  }
`;
