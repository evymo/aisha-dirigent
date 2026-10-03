-- Trigger: on_order_payment_completed
-- Table: orders

CREATE TRIGGER on_order_payment_completed
AFTER UPDATE
ON public.orders
FOR EACH ROW
EXECUTE FUNCTION handle_order_payment_completed();
