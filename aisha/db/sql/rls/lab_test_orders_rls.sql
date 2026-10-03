-- RLS: lab_test_orders
-- Description: Row-level security policies for lab test orders
-- Created: 2026-02-03

-- Users can view their own orders
DROP POLICY IF EXISTS "Users can view own lab test orders" ON lab_test_orders;
CREATE POLICY "Users can view own lab test orders"
  ON lab_test_orders
  FOR SELECT
  USING (auth.uid() = user_id);

-- Users can create their own orders
DROP POLICY IF EXISTS "Users can create own lab test orders" ON lab_test_orders;
CREATE POLICY "Users can create own lab test orders"
  ON lab_test_orders
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own pending orders (cancel only)
DROP POLICY IF EXISTS "Users can update own pending lab test orders" ON lab_test_orders;
CREATE POLICY "Users can update own pending lab test orders"
  ON lab_test_orders
  FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status IN ('pending', 'cancelled'));

-- Admin/staff can view all orders
DROP POLICY IF EXISTS "Admin and staff can view all lab test orders" ON lab_test_orders;
CREATE POLICY "Admin and staff can view all lab test orders"
  ON lab_test_orders
  FOR SELECT
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));

-- Admin/staff can update all orders
DROP POLICY IF EXISTS "Admin and staff can update all lab test orders" ON lab_test_orders;
CREATE POLICY "Admin and staff can update all lab test orders"
  ON lab_test_orders
  FOR UPDATE
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
