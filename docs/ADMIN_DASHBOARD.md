# Admin Dashboard

## Overview

The admin dashboard provides administrators with comprehensive controls for managing merchants, subscriptions, users, analytics, and system health monitoring.

## Features

### Merchant Management
- View all registered merchants with status indicators
- Suspend or reactivate merchants (admin-only)
- View merchant revenue and active plan counts

### Subscription CRUD
- Create, read, update, and delete subscriptions
- Bulk pause selected subscriptions
- Role-based access: analysts and admins can modify; support is read-only

### User Management
- View all users with their roles
- Rotate user roles (admin-only)
- Role hierarchy: viewer → analyst → support → admin

### Analytics & Reporting
- Payment success rate monitoring
- Transaction volume and gas usage tracking
- Active alert management

### System Health Monitoring
- API response time tracking
- Database connection status
- Memory usage monitoring
- Service uptime tracking

### Audit Logging
- Immutable audit trail for all administrative actions
- Filterable by resource type, action, or actor
- Hash-chain integrity for tamper detection

## Role-Based Access Control

| Action | Admin | Analyst | Support |
|--------|-------|---------|---------|
| View merchants | ✅ | ✅ | ✅ |
| Suspend merchant | ✅ | ❌ | ❌ |
| Create subscription | ✅ | ✅ | ❌ |
| Bulk pause | ✅ | ✅ | ❌ |
| Delete subscription | ✅ | ❌ | ❌ |
| Rotate user roles | ✅ | ❌ | ❌ |
| View audit log | ✅ | ✅ | ✅ |

## Navigation

The admin dashboard is accessible from the Settings tab at route `AdminDashboard`. It requires authentication.

## Technical Details

- **Screen**: `src/screens/AdminDashboardScreen.tsx`
- **Service**: `src/services/adminDashboardService.ts`
- **Monitoring**: `backend/services/shared/monitoring.ts`
- **Audit Types**: `backend/services/shared/auditTypes.ts`
