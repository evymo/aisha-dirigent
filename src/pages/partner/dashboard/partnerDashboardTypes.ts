export interface PartnerAppointment {
  id: string;
  partner_id: string;
  member_id: string;
  appointment_date: string;
  start_time: string;
  end_time: string;
  appointment_type: string;
  status: string;
  service: string | null;
  created_at: string;
  updated_at: string;
  member?: { display_name: string } | null;
}
