-- Sandbox seed data: 5 plans, 10 subscribers, 20 invoices
-- This is run automatically on first DB init for each sandbox instance

-- Plans
INSERT INTO plans (id, name, description, amount, currency, interval, features, is_active, created_at)
VALUES
  ('plan_basic',     'Basic',      'Essential subscription features',        9.99,  'USD', 'monthly', '["core_api","basic_analytics"]'::jsonb,              true, NOW()),
  ('plan_pro',       'Pro',        'Advanced features for growing teams',   29.99,  'USD', 'monthly', '["core_api","advanced_analytics","webhooks","team"]'::jsonb, true, NOW()),
  ('plan_enterprise','Enterprise', 'Full platform with dedicated support',  99.99,  'USD', 'monthly', '["core_api","advanced_analytics","webhooks","team","sla","audit_log"]'::jsonb, true, NOW()),
  ('plan_starter',   'Starter',    'Best for freelancers and side projects', 4.99,  'USD', 'monthly', '["core_api"]'::jsonb,                                     true, NOW()),
  ('plan_premium',   'Premium',    'Premium tier with crypto payments',     49.99,  'USD', 'monthly', '["core_api","advanced_analytics","crypto_payments","priority_support"]'::jsonb, true, NOW())
ON CONFLICT (id) DO NOTHING;

-- Subscribers (10 mock users)
INSERT INTO subscribers (id, email, name, wallet_address, stellar_account, status, created_at)
VALUES
  ('sub_001', 'alice@example.com',     'Alice Johnson',  '0x1234567890abcdef1234567890abcdef12345678', 'GBPLGZFOZSRG4X2LNHY7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X', 'active',  NOW() - INTERVAL '60 days'),
  ('sub_002', 'bob@example.com',       'Bob Smith',      '0x2345678901abcdef2345678901abcdef23456789', 'GBPLGZFOZSRG4X2LNHY7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7Y', 'active',  NOW() - INTERVAL '45 days'),
  ('sub_003', 'carol@example.com',     'Carol Davis',    '0x3456789012abcdef3456789012abcdef34567890', 'GBPLGZFOZSRG4X2LNHY7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7Z', 'active',  NOW() - INTERVAL '30 days'),
  ('sub_004', 'dave@example.com',      'Dave Wilson',    '0x4567890123abcdef4567890123abcdef45678901', 'GBPLGZFOZSRG4X2LNHY7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y80A', 'paused',  NOW() - INTERVAL '20 days'),
  ('sub_005', 'eve@example.com',       'Eve Martin',     '0x5678901234abcdef5678901234abcdef56789012', 'GBPLGZFOZSRG4X2LNHY7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y81B', 'active',  NOW() - INTERVAL '15 days'),
  ('sub_006', 'frank@example.com',     'Frank Lee',      '0x6789012345abcdef6789012345abcdef67890123', 'GBPLGZFOZSRG4X2LNHY7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y82C', 'active',  NOW() - INTERVAL '10 days'),
  ('sub_007', 'grace@example.com',     'Grace Kim',      '0x7890123456abcdef7890123456abcdef78901234', 'GBPLGZFOZSRG4X2LNHY7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y83D', 'cancelled', NOW() - INTERVAL '90 days'),
  ('sub_008', 'hank@example.com',      'Hank Brown',     '0x8901234567abcdef8901234567abcdef89012345', 'GBPLGZFOZSRG4X2LNHY7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y84E', 'active',  NOW() - INTERVAL '5 days'),
  ('sub_009', 'iris@example.com',      'Iris Chen',      '0x9012345678abcdef9012345678abcdef90123456', 'GBPLGZFOZSRG4X2LNHY7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y85F', 'active',  NOW() - INTERVAL '3 days'),
  ('sub_010', 'jack@example.com',      'Jack Taylor',    '0x0123456789abcdef0123456789abcdef01234567', 'GBPLGZFOZSRG4X2LNHY7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y7X7Y86G', 'active',  NOW() - INTERVAL '1 day')
ON CONFLICT (id) DO NOTHING;

-- Subscriptions (linking subscribers to plans)
INSERT INTO subscriptions (id, subscriber_id, plan_id, status, current_period_start, current_period_end, created_at)
VALUES
  ('sbs_001', 'sub_001', 'plan_pro',       'active',    NOW() - INTERVAL '30 days', NOW() + INTERVAL '20 days',  NOW() - INTERVAL '30 days'),
  ('sbs_002', 'sub_002', 'plan_basic',     'active',    NOW() - INTERVAL '30 days', NOW() + INTERVAL '5 days',   NOW() - INTERVAL '30 days'),
  ('sbs_003', 'sub_003', 'plan_enterprise','active',    NOW() - INTERVAL '30 days', NOW() + INTERVAL '12 days',  NOW() - INTERVAL '30 days'),
  ('sbs_004', 'sub_004', 'plan_starter',   'paused',    NOW() - INTERVAL '30 days', NOW() - INTERVAL '2 days',   NOW() - INTERVAL '30 days'),
  ('sbs_005', 'sub_005', 'plan_premium',   'active',    NOW() - INTERVAL '30 days', NOW() + INTERVAL '25 days',  NOW() - INTERVAL '30 days'),
  ('sbs_006', 'sub_006', 'plan_pro',       'active',    NOW() - INTERVAL '15 days', NOW() + INTERVAL '10 days',  NOW() - INTERVAL '15 days'),
  ('sbs_007', 'sub_007', 'plan_basic',     'cancelled', NOW() - INTERVAL '90 days', NOW() - INTERVAL '60 days',  NOW() - INTERVAL '90 days'),
  ('sbs_008', 'sub_008', 'plan_starter',   'active',    NOW() - INTERVAL '5 days',  NOW() + INTERVAL '25 days',  NOW() - INTERVAL '5 days'),
  ('sbs_009', 'sub_009', 'plan_pro',       'active',    NOW() - INTERVAL '3 days',  NOW() + INTERVAL '20 days',  NOW() - INTERVAL '3 days'),
  ('sbs_010', 'sub_010', 'plan_premium',   'active',    NOW() - INTERVAL '1 day',   NOW() + INTERVAL '28 days',  NOW() - INTERVAL '1 day')
ON CONFLICT (id) DO NOTHING;

-- Invoices (20 sample invoices across subscriptions)
INSERT INTO invoices (id, subscription_id, subscriber_id, amount, currency, status, due_date, paid_at, created_at)
VALUES
  ('inv_001', 'sbs_001', 'sub_001', 29.99, 'USD', 'paid',      NOW() - INTERVAL '30 days', NOW() - INTERVAL '28 days', NOW() - INTERVAL '35 days'),
  ('inv_002', 'sbs_001', 'sub_001', 29.99, 'USD', 'paid',      NOW() - INTERVAL '0 days',  NULL,                       NOW() - INTERVAL '5 days'),
  ('inv_003', 'sbs_002', 'sub_002', 9.99,  'USD', 'paid',      NOW() - INTERVAL '25 days', NOW() - INTERVAL '23 days', NOW() - INTERVAL '30 days'),
  ('inv_004', 'sbs_002', 'sub_002', 9.99,  'USD', 'pending',   NOW() + INTERVAL '5 days',  NULL,                       NOW()),
  ('inv_005', 'sbs_003', 'sub_003', 99.99, 'USD', 'paid',      NOW() - INTERVAL '20 days', NOW() - INTERVAL '18 days', NOW() - INTERVAL '25 days'),
  ('inv_006', 'sbs_003', 'sub_003', 99.99, 'USD', 'paid',      NOW() - INTERVAL '0 days',  NOW() - INTERVAL '1 days',  NOW() - INTERVAL '5 days'),
  ('inv_007', 'sbs_004', 'sub_004', 4.99,  'USD', 'overdue',   NOW() - INTERVAL '2 days',  NULL,                       NOW() - INTERVAL '32 days'),
  ('inv_008', 'sbs_005', 'sub_005', 49.99, 'USD', 'paid',      NOW() - INTERVAL '15 days', NOW() - INTERVAL '13 days', NOW() - INTERVAL '20 days'),
  ('inv_009', 'sbs_005', 'sub_005', 49.99, 'USD', 'paid',      NOW() + INTERVAL '15 days', NULL,                       NOW()),
  ('inv_010', 'sbs_006', 'sub_006', 29.99, 'USD', 'paid',      NOW() - INTERVAL '10 days', NOW() - INTERVAL '8 days',  NOW() - INTERVAL '15 days'),
  ('inv_011', 'sbs_006', 'sub_006', 29.99, 'USD', 'pending',   NOW() + INTERVAL '10 days', NULL,                       NOW()),
  ('inv_012', 'sbs_007', 'sub_007', 9.99,  'USD', 'cancelled', NOW() - INTERVAL '90 days', NOW() - INTERVAL '88 days', NOW() - INTERVAL '95 days'),
  ('inv_013', 'sbs_007', 'sub_007', 9.99,  'USD', 'refunded',  NOW() - INTERVAL '60 days', NOW() - INTERVAL '58 days', NOW() - INTERVAL '65 days'),
  ('inv_014', 'sbs_008', 'sub_008', 4.99,  'USD', 'paid',      NOW() - INTERVAL '5 days',  NOW() - INTERVAL '4 days',  NOW() - INTERVAL '5 days'),
  ('inv_015', 'sbs_008', 'sub_008', 4.99,  'USD', 'pending',   NOW() + INTERVAL '25 days', NULL,                       NOW()),
  ('inv_016', 'sbs_009', 'sub_009', 29.99, 'USD', 'paid',      NOW() - INTERVAL '3 days',  NOW() - INTERVAL '2 days',  NOW() - INTERVAL '3 days'),
  ('inv_017', 'sbs_009', 'sub_009', 29.99, 'USD', 'pending',   NOW() + INTERVAL '20 days', NULL,                       NOW()),
  ('inv_018', 'sbs_010', 'sub_010', 49.99, 'USD', 'paid',      NOW() - INTERVAL '1 day',   NOW() - INTERVAL '0 days',  NOW() - INTERVAL '1 day'),
  ('inv_019', 'sbs_010', 'sub_010', 49.99, 'USD', 'pending',   NOW() + INTERVAL '28 days', NULL,                       NOW()),
  ('inv_020', 'sbs_010', 'sub_010', 49.99, 'USD', 'pending',   NOW() + INTERVAL '56 days', NULL,                       NOW())
ON CONFLICT (id) DO NOTHING;
