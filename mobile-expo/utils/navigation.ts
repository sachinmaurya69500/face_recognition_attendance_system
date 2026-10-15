export type NavigationRole = "admin" | "teacher" | "student" | "others";
export function getTabIcon(tab: string, role: NavigationRole) {
  const icons: Record<string, { name: string; label: string }> = {
    Dashboard: { name: "view-dashboard-outline", label: "Overview" }, Students: { name: "account-group-outline", label: "Students" }, Teachers: { name: "account-tie-outline", label: "Faculty" }, Academic: { name: "layers-outline", label: "Hierarchy" }, Classes: { name: "book-open-outline", label: "Schedule" }, History: { name: "history", label: "History" }, Reports: { name: "file-chart-outline", label: "Reports" }, QR: { name: "qrcode-scan", label: "QR" }, Connections: { name: "account-multiple-outline", label: "Connections" }, Profile: { name: "account-circle-outline", label: "Profile" },
  };
  if (tab === "Attendance") return { name: role === "teacher" ? "camera-enhance-outline" : "calendar-check-outline", label: "Attendance" };
  return icons[tab] || { name: "circle-outline", label: tab };
}
