-- SQL Schema for SubTrackr RBAC System
-- Migration Timestamp: 20260625

--
-- roles: Defines the available roles in the system.
--
CREATE TABLE IF NOT EXISTS roles (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  description TEXT,
  is_custom BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

--
-- role_permissions: Maps permissions to roles.
--
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id VARCHAR(50) NOT NULL,
  permission VARCHAR(100) NOT NULL,
  PRIMARY KEY (role_id, permission),
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
);

--
-- user_roles: Assigns a single role to each user.
--
CREATE TABLE IF NOT EXISTS user_roles (
  user_id VARCHAR(255) PRIMARY KEY,
  role_id VARCHAR(50) NOT NULL DEFAULT 'viewer',
  FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE SET DEFAULT
);

--
-- permission_audit_logs: Records every permission check for auditing.
--
CREATE TABLE IF NOT EXISTS permission_audit_logs (
  id SERIAL PRIMARY KEY,
  actor_id VARCHAR(255) NOT NULL,
  resource VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  outcome VARCHAR(10) NOT NULL, -- 'ALLOW' or 'DENY'
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

--
-- Seed Data for Predefined Roles
--

-- 1. Roles
INSERT INTO roles (id, name, description, is_custom) VALUES
('admin', 'Administrator', 'Full access to all resources and operations.', FALSE),
('billing', 'Billing Manager', 'Manages billing and invoices.', FALSE),
('support', 'Support Agent', 'Read-only access to subscriptions and invoices for support tasks.', FALSE),
('viewer', 'Viewer', 'Read-only access to all resources.', FALSE)
ON CONFLICT (id) DO NOTHING;

-- 2. Permissions for Predefined Roles
-- Admin: all:*
INSERT INTO role_permissions (role_id, permission) VALUES
('admin', 'all:*')
ON CONFLICT DO NOTHING;

-- Billing: billing:*, invoice:*
INSERT INTO role_permissions (role_id, permission) VALUES
('billing', 'billing:*'),
('billing', 'invoice:*')
ON CONFLICT DO NOTHING;

-- Support: subscription:read, invoice:read
INSERT INTO role_permissions (role_id, permission) VALUES
('support', 'subscription:read'),
('support', 'invoice:read')
ON CONFLICT DO NOTHING;

-- Viewer: *:read
INSERT INTO role_permissions (role_id, permission) VALUES
('viewer', '*:read')
ON CONFLICT DO NOTHING;