/**
 * Operations screen — appointments, orders, cart, vouchers, and wearables.
 */
import { useCallback, useState } from "react";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack } from "expo-router";
import { CalendarClock, PackageCheck, ShoppingCart, Ticket, Watch } from "lucide-react-native";
import { useAuth, useTranslation } from "@/hooks";
import {
  useMyAppointments,
  useMyCart,
  useMyOrders,
  useMyVouchers,
  useMyWearableConnections,
} from "@/hooks/useMemberOperations";
import { colors, spacing, typography } from "@/theme";
import type { Appointment, AppointmentPartner } from "@/types/schemas";

function partnerOf(appointment: Appointment): AppointmentPartner | null {
  if (Array.isArray(appointment.partner)) return appointment.partner[0] ?? null;
  return appointment.partner ?? null;
}

function Section({
  title,
  empty,
  loading,
  isEmpty,
  children,
}: {
  title: string;
  empty: string;
  loading?: boolean;
  isEmpty: boolean;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.sm }} />
      ) : isEmpty ? (
        <Text style={styles.empty}>{empty}</Text>
      ) : (
        children
      )}
    </View>
  );
}

export default function OperationsScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const appointments = useMyAppointments(user?.id);
  const orders = useMyOrders(user?.id);
  const cart = useMyCart(user?.id);
  const vouchers = useMyVouchers(user?.id);
  const wearables = useMyWearableConnections(user?.id);
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      appointments.refetch(),
      orders.refetch(),
      cart.refetch(),
      vouchers.refetch(),
      wearables.refetch(),
    ]);
    setRefreshing(false);
  }, [appointments, orders, cart, vouchers, wearables]);

  return (
    <>
      <Stack.Screen options={{ title: t("operations.title") }} />
      <ScrollView
        testID="operations-screen"
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <Section
          title={t("operations.appointments")}
          empty={t("operations.no_appointments")}
          loading={appointments.isLoading}
          isEmpty={(appointments.data ?? []).length === 0}
        >
          {(appointments.data ?? []).slice(0, 5).map((item) => {
            const partner = partnerOf(item);
            return (
              <View key={item.id} style={styles.row}>
                <CalendarClock size={16} color={colors.primary} />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>{item.service ?? item.appointment_type ?? t("operations.appointment")}</Text>
                  <Text style={styles.rowMeta}>
                    {item.appointment_date ? new Date(item.appointment_date).toLocaleDateString() : ""}
                    {item.start_time ? ` · ${item.start_time}` : ""}
                    {partner?.display_name ? ` · ${partner.display_name}` : ""}
                  </Text>
                </View>
                {item.status ? <Text style={styles.state}>{item.status}</Text> : null}
              </View>
            );
          })}
        </Section>

        <Section title={t("operations.orders")} empty={t("operations.no_orders")} loading={orders.isLoading} isEmpty={(orders.data ?? []).length === 0}>
          {(orders.data ?? []).slice(0, 5).map((item) => (
            <View key={item.id} style={styles.row}>
              <PackageCheck size={16} color={colors.success} />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{item.status ?? t("operations.order")}</Text>
                <Text style={styles.rowMeta}>
                  {item.created_at ? new Date(item.created_at).toLocaleDateString() : ""}
                  {item.currency ? ` · ${item.currency}` : ""}
                </Text>
              </View>
              <Text style={styles.amount}>{item.total.toFixed(0)}</Text>
            </View>
          ))}
        </Section>

        <Section title={t("operations.cart")} empty={t("operations.no_cart")} loading={cart.isLoading} isEmpty={(cart.data ?? []).length === 0}>
          {(cart.data ?? []).slice(0, 5).map((item) => (
            <View key={item.id} style={styles.row}>
              <ShoppingCart size={16} color={colors.textSecondary} />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{item.product_name}</Text>
                <Text style={styles.rowMeta}>{item.quantity} x {item.product_price.toFixed(0)}</Text>
              </View>
            </View>
          ))}
        </Section>

        <Section title={t("operations.vouchers")} empty={t("operations.no_vouchers")} loading={vouchers.isLoading} isEmpty={(vouchers.data ?? []).length === 0}>
          {(vouchers.data ?? []).slice(0, 5).map((item) => (
            <View key={item.id} style={styles.row}>
              <Ticket size={16} color={colors.warning} />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{item.code}</Text>
                <Text style={styles.rowMeta}>
                  {item.points_cost != null ? `${item.points_cost} pts` : ""}
                  {item.expires_at ? ` · ${new Date(item.expires_at).toLocaleDateString()}` : ""}
                </Text>
              </View>
              <Text style={styles.state}>{item.status}</Text>
            </View>
          ))}
        </Section>

        <Section title={t("operations.wearables")} empty={t("operations.no_wearables")} loading={wearables.isLoading} isEmpty={(wearables.data ?? []).length === 0}>
          {(wearables.data ?? []).slice(0, 5).map((item) => (
            <View key={item.id} style={styles.row}>
              <Watch size={16} color={colors.primary} />
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{item.device_name ?? item.device_model ?? item.device_type ?? t("operations.wearable")}</Text>
                <Text style={styles.rowMeta}>
                  {item.platform ?? ""}
                  {item.last_sync_at ? ` · ${new Date(item.last_sync_at).toLocaleDateString()}` : ""}
                </Text>
              </View>
              <Text style={styles.state}>{item.connection_status}</Text>
            </View>
          ))}
        </Section>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xxl },
  section: { marginBottom: spacing.lg },
  sectionTitle: {
    ...typography.label,
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: spacing.sm,
  },
  empty: { ...typography.bodySmall, color: colors.textMuted, paddingVertical: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { ...typography.bodySmall, color: colors.text, fontWeight: "600" },
  rowMeta: { ...typography.caption, color: colors.textMuted },
  state: { ...typography.caption, color: colors.textSecondary, textTransform: "uppercase", fontWeight: "700" },
  amount: { ...typography.bodySmall, color: colors.success, fontWeight: "700" },
});
