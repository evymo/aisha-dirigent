import { useState, useMemo } from "react";
import { safeError } from "@/lib/security/safeLogger";
import { getDateFnsLocale } from "@/lib/i18n/locale";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DataTable } from "@/components/ui/data-table/DataTable";
import { getShipmentColumns } from "./shipments-columns";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExternalLink } from "lucide-react";
import {
  useShipmentsAdmin,
  createPacketaShipment,
  markOrderShipped,
  getPacketaTrackingStatus,
  type ShipmentOrder,
  type ShipmentStatus,
} from "@/hooks/useAdminShipments";
import {
  Package,
  Truck,
  MapPin,
  RefreshCw,
  CheckCircle,
  XCircle,
  Clock,
  Loader2,
  Send,
  Box
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
const SHIPMENT_STATUSES: { value: ShipmentStatus; labelKey: string; icon: typeof Package }[] = [
  { value: "ready_to_ship", labelKey: "admin.shipments.status.readyToShip", icon: Box },
  { value: "shipped", labelKey: "admin.shipments.status.shipped", icon: Truck },
  { value: "in_transit", labelKey: "admin.shipments.status.inTransit", icon: Package },
  { value: "delivered", labelKey: "admin.shipments.status.delivered", icon: CheckCircle },
  { value: "returned", labelKey: "admin.shipments.status.returned", icon: XCircle },
];

export default function AdminShipments() {
  const { t, i18n } = useTranslation();
  const dateLocale = getDateFnsLocale(i18n.language);

  const { orders, refetch: fetchOrders } = useShipmentsAdmin();
  const [statusFilter, setStatusFilter] = useState<ShipmentStatus>('all');
  const [rowSelection, setRowSelection] = useState({});
  const [selectedOrder, setSelectedOrder] = useState<ShipmentOrder | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [createShipmentOpen, setCreateShipmentOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const handleCreateShipment = async (order: ShipmentOrder) => {
    setProcessing(true);
    try {
      await createPacketaShipment(order);
      toast.success(t("admin.shipments.packetCreated"));
      fetchOrders();
    } catch {
      toast.error(t("admin.shipments.createError"));
    } finally {
      setProcessing(false);
      setCreateShipmentOpen(false);
    }
  };

  const bulkCreateShipments = async () => {
    const selectedOrders = Object.keys(rowSelection)
      .map(index => filteredOrders[parseInt(index)]?.id)
      .filter(Boolean);

    if (selectedOrders.length === 0) return;

    setBulkProcessing(true);
    let successCount = 0;
    let errorCount = 0;

    for (const orderId of selectedOrders) {
      const order = orders.find(o => o.id === orderId);
      if (!order || order.packeta_packet_id) continue;

      try {
        await createPacketaShipment(order);
        successCount++;
      } catch (e) {
        errorCount++;
        safeError("AdminShipments.createPacketaShipment", e);
      }
    }

    setBulkProcessing(false);
    setRowSelection({});

    if (successCount > 0) {
      toast.success(t("admin.shipments.bulkCreated", { count: successCount }));
    }
    if (errorCount > 0) {
      toast.error(t("admin.shipments.bulkErrors", { count: errorCount }));
    }

    fetchOrders();
  };

  const markAsShipped = async (orderId: string) => {
    try {
      await markOrderShipped(orderId);
      toast.success(t("admin.shipments.markedShipped"));
      fetchOrders();
    } catch {
      toast.error(t("admin.shipments.updateError"));
    }
  };

  const getTrackingStatus = async (order: ShipmentOrder) => {
    if (!order.packeta_packet_id) return;

    try {
      const data = await getPacketaTrackingStatus(order.packeta_packet_id);
      toast.info(`${t("admin.shipments.trackingStatus")}: ${data.status}`);
    } catch {
      toast.error(t("admin.shipments.trackingError"));
    }
  };

  const getStatusBadge = (order: ShipmentOrder) => {
    if (order.status === 'delivered') {
      return <Badge variant="default" className="bg-green-500"><CheckCircle className="w-3 h-3 mr-1" />{t("admin.shipments.status.delivered")}</Badge>;
    }
    if (order.status === 'shipped' || order.status === 'in_transit') {
      return <Badge variant="default"><Truck className="w-3 h-3 mr-1" />{t("admin.shipments.status.shipped")}</Badge>;
    }
    if (order.packeta_packet_id) {
      return <Badge variant="outline"><Package className="w-3 h-3 mr-1" />{t("admin.shipments.status.processing")}</Badge>;
    }
    return <Badge variant="secondary"><Clock className="w-3 h-3 mr-1" />{t("admin.shipments.status.readyToShip")}</Badge>;
  };

  const filteredOrders = orders.filter(o => {
    let matchesStatus = true;
    if (statusFilter === 'ready_to_ship') {
      matchesStatus = o.status === 'paid' && !o.packeta_packet_id;
    } else if (statusFilter === 'shipped') {
      matchesStatus = o.status === 'shipped' || o.status === 'in_transit';
    } else if (statusFilter === 'delivered') {
      matchesStatus = o.status === 'delivered';
    } else if (statusFilter !== 'all') {
      matchesStatus = o.status === statusFilter;
    }

    return matchesStatus;
  });

  const stats = {
    total: orders.length,
    readyToShip: orders.filter(o => o.status === 'paid' && !o.packeta_packet_id).length,
    processing: orders.filter(o => o.packeta_packet_id && o.status === 'processing').length,
    shipped: orders.filter(o => o.status === 'shipped' || o.status === 'in_transit').length,
    delivered: orders.filter(o => o.status === 'delivered').length,
  };

  // Select all ready to ship logic needs to map to row indices for DataTable
  const selectAllReadyToShip = () => {
    const newSelection: Record<string, boolean> = {};
    filteredOrders.forEach((order, index) => {
      if (order.status === 'paid' && !order.packeta_packet_id) {
        newSelection[index] = true;
      }
    });
    setRowSelection(newSelection);
  };

  const columns = useMemo(() => getShipmentColumns(
    t,
    i18n.language,
    (order) => {
      setSelectedOrder(order);
      setDetailOpen(true);
    },
    (order) => {
      setSelectedOrder(order);
      setCreateShipmentOpen(true);
    },
    markAsShipped
  // eslint-disable-next-line react-hooks/exhaustive-deps -- stable callbacks
  ), [t, i18n.language]);

  const selectedCount = Object.keys(rowSelection).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("admin.shipments.title")}</h1>
          <p className="text-muted-foreground mt-1">{t("admin.shipments.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <Button onClick={bulkCreateShipments} disabled={bulkProcessing}>
              {bulkProcessing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Send className="w-4 h-4 mr-2" />
              {t("admin.shipments.createBulk", { count: selectedCount })}
            </Button>
          )}
          <Button onClick={fetchOrders} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            {t("common.refresh")}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Package className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{t("admin.shipments.stats.total")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.total}</p>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-muted/50" onClick={() => setStatusFilter('ready_to_ship')}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-500" />
              <span className="text-sm text-muted-foreground">{t("admin.shipments.stats.readyToShip")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.readyToShip}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Box className="w-4 h-4 text-blue-500" />
              <span className="text-sm text-muted-foreground">{t("admin.shipments.stats.processing")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.processing}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <Truck className="w-4 h-4 text-primary" />
              <span className="text-sm text-muted-foreground">{t("admin.shipments.stats.shipped")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.shipped}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span className="text-sm text-muted-foreground">{t("admin.shipments.stats.delivered")}</span>
            </div>
            <p className="text-2xl font-semibold mt-1">{stats.delivered}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col md:flex-row gap-4 mb-6">
        <div className="flex-1"></div> {/** Search handled by DataTable internally typically, but we can keep external filters too if we pass filtered data **/}
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ShipmentStatus)}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder={t("admin.shipments.filterStatus")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("admin.shipments.allStatuses")}</SelectItem>
            {SHIPMENT_STATUSES.map((status) => (
              <SelectItem key={status.value} value={status.value}>
                {t(status.labelKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={selectAllReadyToShip}>
          {t("admin.shipments.selectReadyToShip")}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={filteredOrders}
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        searchKey="customer" // We used a custom ID for the customer column
      />
      {/* Create Shipment Dialog */}
      <Dialog open={createShipmentOpen} onOpenChange={setCreateShipmentOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("admin.shipments.createDialog.title")}</DialogTitle>
            <DialogDescription>{t("admin.shipments.createDialog.description")}</DialogDescription>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">{t("admin.shipments.createDialog.recipient")}</Label>
                  <p className="font-medium">
                    {selectedOrder.shipping_address?.firstName} {selectedOrder.shipping_address?.lastName}
                  </p>
                </div>
                <div>
                  <Label className="text-muted-foreground">{t("admin.shipments.createDialog.contact")}</Label>
                  <p className="text-sm">{selectedOrder.profile?.email}</p>
                  <p className="text-sm">{selectedOrder.profile?.phone || '-'}</p>
                </div>
              </div>
              <div>
                <Label className="text-muted-foreground">{t("admin.shipments.createDialog.address")}</Label>
                {selectedOrder.shipping_address?.pickupPointName ? (
                  <div className="flex items-center gap-2 mt-1">
                    <MapPin className="w-4 h-4 text-primary" />
                    <span>{selectedOrder.shipping_address.pickupPointName}</span>
                  </div>
                ) : (
                  <p>
                    {selectedOrder.shipping_address?.address}<br />
                    {selectedOrder.shipping_address?.postalCode} {selectedOrder.shipping_address?.city}<br />
                    {selectedOrder.shipping_address?.country}
                  </p>
                )}
              </div>
              <div>
                <Label className="text-muted-foreground">{t("admin.shipments.createDialog.items")}</Label>
                <ul className="text-sm mt-1">
                  {selectedOrder.order_items.map(item => (
                    <li key={item.id}>
                      {item.quantity}
                      {t("common.multiplierTimes")} {item.product?.name || t("common.unknown")}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="bg-muted/50 p-3 rounded-lg">
                <p className="text-sm text-muted-foreground">
                  {t("admin.shipments.createDialog.apiNote")}
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateShipmentOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => selectedOrder && handleCreateShipment(selectedOrder)}
              disabled={processing}
            >
              {processing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              <Send className="w-4 h-4 mr-2" />
              {t("admin.shipments.createDialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Order Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("admin.shipments.detail.title")}</DialogTitle>
            <DialogDescription>{t("admin.shipments.detail.description")}</DialogDescription>
          </DialogHeader>
          {selectedOrder && (
            <Tabs defaultValue="info">
              <TabsList>
                <TabsTrigger value="info">{t("admin.shipments.detail.tabInfo")}</TabsTrigger>
                <TabsTrigger value="tracking">{t("admin.shipments.detail.tabTracking")}</TabsTrigger>
              </TabsList>
              <TabsContent value="info" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t("admin.shipments.detail.orderId")}</p>
                    <p className="font-mono text-sm">{selectedOrder.id}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("admin.shipments.detail.status")}</p>
                    {getStatusBadge(selectedOrder)}
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("admin.shipments.detail.packetId")}</p>
                    <p className="font-mono text-sm">{selectedOrder.packeta_packet_id || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("admin.shipments.detail.barcode")}</p>
                    <p className="font-mono text-sm">{selectedOrder.packeta_barcode || '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("admin.shipments.detail.shippedAt")}</p>
                    <p>{selectedOrder.shipped_at ? format(new Date(selectedOrder.shipped_at), "PPpp", { locale: dateLocale }) : '-'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t("admin.shipments.detail.deliveredAt")}</p>
                    <p>{selectedOrder.delivered_at ? format(new Date(selectedOrder.delivered_at), "PPpp", { locale: dateLocale }) : '-'}</p>
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-2">{t("admin.shipments.detail.items")}</p>
                  <Table>
                    <TableBody>
                      {selectedOrder.order_items.map(item => (
                        <TableRow key={item.id}>
                          <TableCell>{item.product?.name || t("common.unknown")}</TableCell>
                          <TableCell className="text-right">
                            {item.quantity}
                            {t("common.multiplierTimes")}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>
              <TabsContent value="tracking" className="space-y-4">
                {selectedOrder.packeta_packet_id ? (
                  <div className="space-y-4">
                    <Button onClick={() => getTrackingStatus(selectedOrder)} variant="outline" className="w-full">
                      <RefreshCw className="w-4 h-4 mr-2" />
                      {t("admin.shipments.detail.refreshTracking")}
                    </Button>
                    {selectedOrder.tracking_url && (
                      <Button asChild variant="outline" className="w-full">
                        <a href={selectedOrder.tracking_url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="w-4 h-4 mr-2" />
                          {t("admin.shipments.detail.openTracking")}
                        </a>
                      </Button>
                    )}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <Package className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>{t("admin.shipments.detail.noTracking")}</p>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
