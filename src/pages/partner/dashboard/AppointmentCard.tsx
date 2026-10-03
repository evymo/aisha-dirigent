import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Clock,
  User,
  MapPin,
  Video,
  CheckCircle,
  XCircle,
} from "lucide-react";
import { usePartnerAppointmentNotes } from "@/hooks/usePartners";
import { toast } from "sonner";
import type { PartnerAppointment } from "./partnerDashboardTypes";

interface AppointmentCardProps {
  appointment: PartnerAppointment;
  onStatusChange: (id: string, status: "confirmed" | "cancelled" | "completed") => void;
  showDate?: boolean;
  t: (key: string) => string;
}

export function AppointmentCard({
  appointment,
  onStatusChange,
  showDate = false,
  t,
}: AppointmentCardProps) {
  const statusColors = {
    pending: "bg-warning/10 text-warning",
    confirmed: "bg-primary/10 text-primary",
    completed: "bg-secondary/50 text-secondary-foreground",
    cancelled: "bg-destructive/10 text-destructive",
  };

  const [isNotesOpen, setIsNotesOpen] = useState(false);
  const notesQuery = usePartnerAppointmentNotes(appointment?.id ?? "", {
    enabled: isNotesOpen,
  });

  useEffect(() => {
    if (!notesQuery.error) return;
    toast.error(t("partnerDashboard.notes.loadFailed"));
  }, [notesQuery.error, t]);

  return (
    <div className="p-4 border rounded-lg space-y-3">
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          {/* Member info */}
          {appointment.member && (
            <div className="flex items-center gap-3 pb-2 mb-2 border-b">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                <User className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">
                  {appointment.member.display_name || t("partnerDashboard.member")}
                </p>
              </div>
            </div>
          )}
          
          {showDate && (
            <p className="text-sm font-medium">
              {format(parseISO(appointment.appointment_date), "EEEE, d. MMMM yyyy")}
            </p>
          )}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span>
              {appointment.start_time.slice(0, 5)} - {appointment.end_time.slice(0, 5)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {appointment.appointment_type === "online" ? (
              <Video className="h-4 w-4" />
            ) : (
              <MapPin className="h-4 w-4" />
            )}
            <span>
              {appointment.appointment_type === "online"
                ? t("partnerDashboard.appointmentType.online")
                : t("partnerDashboard.appointmentType.inPerson")}
            </span>
          </div>
          {appointment.service && (
            <p className="text-sm">
              <span className="text-muted-foreground">{t("partnerDashboard.service")}: </span>
              {appointment.service}
            </p>
          )}

          <div className="pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIsNotesOpen((v) => !v)}
            >
              {isNotesOpen
                ? t("partnerDashboard.notes.hide")
                : t("partnerDashboard.notes.show")}
            </Button>

            {isNotesOpen && (
              <div className="mt-2 text-sm text-muted-foreground">
                {notesQuery.isLoading
                  ? t("common.loading")
                  : notesQuery.data
                    ? notesQuery.data
                    : t("partnerDashboard.notes.none")}
              </div>
            )}
          </div>
        </div>
        <Badge className={statusColors[appointment.status as keyof typeof statusColors]}>
          {t(`partnerDashboard.status.${appointment.status}`)}
        </Badge>
      </div>

      {appointment.status === "pending" && (
        <div className="flex gap-2 pt-2 border-t">
          <Button
            size="sm"
            onClick={() => onStatusChange(appointment.id, "confirmed")}
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            {t("partnerDashboard.actions.confirm")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onStatusChange(appointment.id, "cancelled")}
          >
            <XCircle className="h-4 w-4 mr-1" />
            {t("partnerDashboard.actions.cancel")}
          </Button>
        </div>
      )}

      {appointment.status === "confirmed" && (
        <div className="flex gap-2 pt-2 border-t">
          <Button
            size="sm"
            onClick={() => onStatusChange(appointment.id, "completed")}
          >
            <CheckCircle className="h-4 w-4 mr-1" />
            {t("partnerDashboard.actions.complete")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onStatusChange(appointment.id, "cancelled")}
          >
            <XCircle className="h-4 w-4 mr-1" />
            {t("partnerDashboard.actions.cancel")}
          </Button>
        </div>
      )}
    </div>
  );
}
