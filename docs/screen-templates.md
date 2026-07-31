# Screen Templates

`src/components/common/ScreenTemplates.tsx` provides shared screen layouts for common app flows.

## Templates

- `ListScreen`: header, analytics tracking, loading/error/empty handling, pull refresh, and repeated item rendering.
- `DetailScreen`: header, analytics tracking, loading/error handling, and scrollable detail content.
- `FormScreen`: header, analytics tracking, loading/error handling, and scrollable keyboard-friendly form content.

## Usage

```tsx
<ListScreen
  title="Support"
  subtitle="Subscription event tickets"
  analyticsName="SupportDashboard"
  data={tickets}
  renderItem={(ticket) => <TicketCard ticket={ticket} />}
  keyExtractor={(ticket) => ticket.id}
  emptyTitle="No tickets"
  emptyMessage="Tickets will appear here when subscription events need attention."
/>
```

Prefer these templates for new screens and when touching existing list, detail, or form screens.
