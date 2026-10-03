import { Navigate } from "react-router-dom";

/**
 * Member calendar route (alias to appointments).
 */
export default function MemberCalendar() {
  return <Navigate to="/member/appointments" replace />;
}
