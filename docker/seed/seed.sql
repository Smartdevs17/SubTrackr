CREATE TABLE IF NOT EXISTS plans (id VARCHAR PRIMARY KEY, name VARCHAR, price DECIMAL, currency VARCHAR);
CREATE TABLE IF NOT EXISTS users (id VARCHAR PRIMARY KEY, email VARCHAR, name VARCHAR);
CREATE TABLE IF NOT EXISTS invoices (id VARCHAR PRIMARY KEY, user_id VARCHAR, plan_id VARCHAR, amount DECIMAL, status VARCHAR);

INSERT INTO plans (id, name, price, currency) VALUES 
('plan_1', 'Basic', 9.99, 'USD'), ('plan_2', 'Pro', 19.99, 'USD'), ('plan_3', 'Enterprise', 49.99, 'USD'), ('plan_4', 'Starter', 4.99, 'USD'), ('plan_5', 'Premium', 99.99, 'USD') ON CONFLICT DO NOTHING;

INSERT INTO users (id, email, name) VALUES 
('usr_1', 'u1@test.com', 'User 1'), ('usr_2', 'u2@test.com', 'User 2'), ('usr_3', 'u3@test.com', 'User 3'), ('usr_4', 'u4@test.com', 'User 4'), ('usr_5', 'u5@test.com', 'User 5'), ('usr_6', 'u6@test.com', 'User 6'), ('usr_7', 'u7@test.com', 'User 7'), ('usr_8', 'u8@test.com', 'User 8'), ('usr_9', 'u9@test.com', 'User 9'), ('usr_10', 'u10@test.com', 'User 10') ON CONFLICT DO NOTHING;

INSERT INTO invoices (id, user_id, plan_id, amount, status) VALUES 
('inv_1', 'usr_1', 'plan_1', 9.99, 'paid'), ('inv_2', 'usr_2', 'plan_2', 19.99, 'paid'), ('inv_3', 'usr_3', 'plan_3', 49.99, 'paid'), ('inv_4', 'usr_4', 'plan_4', 4.99, 'paid'), ('inv_5', 'usr_5', 'plan_5', 99.99, 'paid'), ('inv_6', 'usr_6', 'plan_1', 9.99, 'pending'), ('inv_7', 'usr_7', 'plan_2', 19.99, 'paid'), ('inv_8', 'usr_8', 'plan_3', 49.99, 'paid'), ('inv_9', 'usr_9', 'plan_4', 4.99, 'failed'), ('inv_10', 'usr_10', 'plan_5', 99.99, 'paid'), ('inv_11', 'usr_1', 'plan_1', 9.99, 'paid'), ('inv_12', 'usr_2', 'plan_2', 19.99, 'paid'), ('inv_13', 'usr_3', 'plan_3', 49.99, 'paid'), ('inv_14', 'usr_4', 'plan_4', 4.99, 'paid'), ('inv_15', 'usr_5', 'plan_5', 99.99, 'paid'), ('inv_16', 'usr_6', 'plan_1', 9.99, 'paid'), ('inv_17', 'usr_7', 'plan_2', 19.99, 'paid'), ('inv_18', 'usr_8', 'plan_3', 49.99, 'paid'), ('inv_19', 'usr_9', 'plan_4', 4.99, 'paid'), ('inv_20', 'usr_10', 'plan_5', 99.99, 'paid') ON CONFLICT DO NOTHING;