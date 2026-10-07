import React, { useEffect, useState, useMemo } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Platform,
  StatusBar as NativeStatusBar,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import * as ImagePicker from "expo-image-picker";
import { CameraView, useCameraPermissions } from "expo-camera";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";

// ---------------------------------------------------------------------------
// DESIGN SYSTEM & THEME
// ---------------------------------------------------------------------------
export const theme = {
  // Brand Core
  primary: "#1E3A8A", // Deep royal navy
  primaryDark: "#0F172A", // Midnight slate
  primaryLight: "#2563EB", // Vibrant cobalt
  primaryPale: "#EEF4FF", // Soft royal wash
  accent: "#F59E0B", // High-end warm amber
  accentLight: "#FEF3C7", // Soft amber wash
  accentDark: "#D97706",

  // Backgrounds & Canvas
  bg: "#F8FAFC", // Clean slate canvas
  surface: "#FFFFFF", // Elevated card white
  surfaceAlt: "#F1F5F9", // Slate surface
  surfaceHover: "#E2E8F0",

  // Borders & Dividers
  border: "#E2E8F0", // Slate-200 border
  borderSubtle: "#EDF2F7",
  borderActive: "#2563EB",

  // Typography
  text: "#0F172A", // High contrast slate-900
  textSecondary: "#475569", // Slate-600
  muted: "#94A3B8", // Slate-400
  textOnPrimary: "#FFFFFF",

  // Semantic
  success: "#10B981", // Emerald
  successPale: "#ECFDF5",
  successBorder: "#A7F3D0",

  danger: "#EF4444", // Crimson
  dangerPale: "#FEF2F2",
  dangerBorder: "#FECACA",

  warning: "#F59E0B",
  warningPale: "#FFFBEB",
  warningBorder: "#FDE68A",

  info: "#0EA5E9",
  infoPale: "#F0F9FF",
  infoBorder: "#BAE6FD",
};

type Role = "admin" | "teacher" | "student";

//const API = process.env.EXPO_PUBLIC_API_URL || "https://anotherearth.taila10c0b.ts.net";
const API = process.env.EXPO_PUBLIC_API_URL || "http://10.0.2.2:8000";
const http = axios.create({ baseURL: API });

// ---------------------------------------------------------------------------
// ROOT COMPONENT & AUTH STATE
// ---------------------------------------------------------------------------
export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem("attendai_user")
      .then(async (stored) => {
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed?.token) {
            http.defaults.headers.common.Authorization = `Bearer ${parsed.token}`;
            try {
              const res = await http.get("/auth/profile");
              setUser({ ...parsed, ...res.data?.profile });
            } catch {
              await AsyncStorage.removeItem("attendai_user");
            }
          } else {
            await AsyncStorage.removeItem("attendai_user");
          }
        }
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <StatusBar style="dark" />
        <View style={styles.loadingCard}>
          <Image
            source={require("./assets/pratyaksha-logo.jpg")}
            style={styles.splashLogo}
            resizeMode="contain"
          />
          <ActivityIndicator size="large" color={theme.primaryLight} style={{ marginTop: 24 }} />
          <Text style={styles.loadingText}>Initializing Pratyaksh...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return user ? (
    <AppShell
      user={user}
      onLogout={async () => {
        delete http.defaults.headers.common.Authorization;
        await AsyncStorage.removeItem("attendai_user");
        setUser(null);
      }}
    />
  ) : (
    <Login
      onLogin={async (u) => {
        await AsyncStorage.setItem("attendai_user", JSON.stringify(u));
        setUser(u);
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// LOGIN SCREEN
// ---------------------------------------------------------------------------
function Login({ onLogin }: { onLogin: (u: any) => void }) {
  const [role, setRole] = useState<Role>("admin");
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleRoleSelect = (selectedRole: Role) => {
    setRole(selectedRole);
    if (selectedRole === "admin") {
      setUsername("admin");
      setPassword("admin123");
    } else if (selectedRole === "teacher") {
      setUsername("demo.teacher");
      setPassword("DemoTeacher123!");
    } else {
      setUsername("DEMO-STUDENT");
      setPassword("2000-01-01");
    }
  };

  const submit = async () => {
    if (!username.trim() || !password) {
      setError("Please enter your username and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await http.post("/auth/login", { username: username.trim(), password });
      const userData = {
        ...res.data.user,
        token: res.data.access_token,
        role: res.data.user.role || role,
      };
      http.defaults.headers.common.Authorization = `Bearer ${userData.token}`;
      onLogin(userData);
    } catch (e: any) {
      setError(
        e?.response?.data?.detail ||
          "Unable to sign in. Please verify your credentials and network connection."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.loginScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Brand Banner */}
        <View style={styles.loginHeader}>
          <View style={styles.logoBadgeContainer}>
            <Image
              source={require("./assets/pratyaksha-logo.jpg")}
              style={styles.loginLogo}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.brandTitle}>
            Pratyaksh<Text style={{ color: theme.accent }}>.AI</Text>
          </Text>
          <View style={styles.brandPill}>
            <MaterialCommunityIcons name="face-recognition" size={14} color={theme.primaryLight} />
            <Text style={styles.brandPillText}>Next-Gen Biometric Attendance</Text>
          </View>
        </View>

        {/* Login Surface Card */}
        <View style={styles.loginCard}>
          <Text style={styles.cardHeaderTitle}>Welcome Back</Text>
          <Text style={styles.cardHeaderSubtitle}>
            Select your portal and sign in to continue
          </Text>

          {/* Role Switcher */}
          <View style={styles.roleTabsContainer}>
            {(
              [
                { id: "admin", label: "Admin", icon: "shield-crown-outline" },
                { id: "teacher", label: "Teacher", icon: "teach" },
                { id: "student", label: "Student", icon: "school-outline" },
              ] as const
            ).map((item) => {
              const active = role === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => handleRoleSelect(item.id)}
                  style={[styles.roleTab, active && styles.roleTabActive]}
                >
                  <MaterialCommunityIcons
                    name={item.icon as any}
                    size={18}
                    color={active ? theme.primaryLight : theme.muted}
                  />
                  <Text style={[styles.roleTabText, active && styles.roleTabTextActive]}>
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Form Fields */}
          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>Username / ID</Text>
            <View style={styles.inputContainer}>
              <MaterialCommunityIcons
                name="account-outline"
                size={20}
                color={theme.muted}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.textInput}
                value={username}
                onChangeText={setUsername}
                placeholder="Enter username or ID"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>Password</Text>
            <View style={styles.inputContainer}>
              <MaterialCommunityIcons
                name="lock-outline"
                size={20}
                color={theme.muted}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.textInput}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="Enter password"
                placeholderTextColor={theme.muted}
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                style={styles.eyeButton}
              >
                <MaterialCommunityIcons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={20}
                  color={theme.muted}
                />
              </Pressable>
            </View>
          </View>

          {/* Error Message */}
          {!!error && (
            <View style={styles.errorBanner}>
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={18}
                color={theme.danger}
              />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Submit Button */}
          <Pressable
            style={[styles.submitButton, busy && { opacity: 0.8 }]}
            onPress={submit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.submitRow}>
                <Text style={styles.submitText}>Sign In to {role.toUpperCase()}</Text>
                <MaterialCommunityIcons name="arrow-right" size={20} color="#fff" />
              </View>
            )}
          </Pressable>

          {/* Quick Demo Credentials Footer */}
          <View style={styles.demoBox}>
            <Text style={styles.demoTitle}>QUICK DEMO PRESETS</Text>
            <View style={styles.demoChipRow}>
              <Pressable
                style={styles.demoChip}
                onPress={() => handleRoleSelect("admin")}
              >
                <Text style={styles.demoChipText}>Admin</Text>
              </Pressable>
              <Pressable
                style={styles.demoChip}
                onPress={() => handleRoleSelect("teacher")}
              >
                <Text style={styles.demoChipText}>Teacher</Text>
              </Pressable>
              <Pressable
                style={styles.demoChip}
                onPress={() => handleRoleSelect("student")}
              >
                <Text style={styles.demoChipText}>Student</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <Text style={styles.loginFooter}>
          Protected by Enterprise Facial Recognition & Biometric Encryption
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// APP SHELL & NAVIGATION
// ---------------------------------------------------------------------------
function AppShell({ user, onLogout }: { user: any; onLogout: () => void }) {
  useEffect(() => {
    if (user.token) {
      http.defaults.headers.common.Authorization = `Bearer ${user.token}`;
    }
  }, [user.token]);

  const role = (user.role || "admin") as Role;

  // Curated 4-to-5 primary bottom tabs for ideal mobile UX ergonomics
  const tabs = useMemo(() => {
    if (role === "admin") {
      return ["Dashboard", "Students", "Teachers", "Academic", "Attendance"];
    }
    if (role === "teacher") {
      return ["Dashboard", "Attendance", "Students", "History", "Profile"];
    }
    return ["Dashboard", "Attendance", "Classes", "Profile"];
  }, [role]);

  const [activeTab, setActiveTab] = useState("Dashboard");
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    http
      .get("/notifications")
      .then((r) => {
        const notifs = r.data?.notifications || [];
        setUnreadCount(notifs.filter((n: any) => !n.is_read).length);
      })
      .catch(() => {});
  }, [activeTab]);

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return "Good Morning";
    if (h < 17) return "Good Afternoon";
    return "Good Evening";
  };

  const displayName =
    user.display_name || user.name || user.username || (role === "admin" ? "Admin" : "User");

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />

      {/* Top App Bar Header */}
      <View style={styles.topBar}>
        <View style={styles.topBarLeft}>
          <View style={styles.brandMiniBadge}>
            <Image
              source={require("./assets/pratyaksha-logo.jpg")}
              style={styles.brandMiniLogo}
              resizeMode="contain"
            />
          </View>
          <View style={styles.topBarIdentity}>
            <View style={styles.topBrandRow}>
              <Text style={styles.topBrandName}>Pratyaksh</Text>
              <View style={styles.roleTag}>
                <Text style={styles.roleTagText}>{role.toUpperCase()}</Text>
              </View>
            </View>
            <Text style={styles.topGreeting} numberOfLines={1}>
              {getGreeting()}, {displayName.split(" ")[0]}
            </Text>
          </View>
        </View>

        <View style={styles.topBarRight}>
          <Pressable
            onPress={() => setActiveTab("Alerts")}
            style={[styles.iconButton, activeTab === "Alerts" && styles.iconButtonActive]}
          >
            <MaterialCommunityIcons
              name="bell-outline"
              size={22}
              color={activeTab === "Alerts" ? theme.primaryLight : theme.text}
            />
            {unreadCount > 0 && <View style={styles.unreadDot} />}
          </Pressable>

          <Pressable
            onPress={() => setActiveTab("Profile")}
            style={[styles.avatarPill, activeTab === "Profile" && styles.avatarPillActive]}
          >
            {user.profile_photo_base64 ? (
              <Image
                source={{ uri: user.profile_photo_base64 }}
                style={styles.avatarImg}
              />
            ) : (
              <Text style={styles.avatarInitial}>
                {displayName.charAt(0).toUpperCase()}
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* Main Screen Content */}
      <ScrollView
        contentContainerStyle={styles.mainContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenRenderer
          screen={activeTab}
          role={role}
          user={user}
          go={setActiveTab}
          onLogout={onLogout}
        />
      </ScrollView>

      {/* Modern Bottom Navigation Bar */}
      <View style={styles.bottomNav}>
        {tabs.map((tabName) => {
          const isActive = activeTab === tabName;
          const iconInfo = getTabIcon(tabName, role);
          return (
            <Pressable
              key={tabName}
              onPress={() => setActiveTab(tabName)}
              style={styles.bottomNavItem}
            >
              <View style={[styles.bottomNavIconWrap, isActive && styles.bottomNavIconWrapActive]}>
                <MaterialCommunityIcons
                  name={iconInfo.name as any}
                  size={22}
                  color={isActive ? theme.primaryLight : theme.muted}
                />
              </View>
              <Text style={[styles.bottomNavText, isActive && styles.bottomNavTextActive]}>
                {iconInfo.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function getTabIcon(tab: string, role: Role) {
  switch (tab) {
    case "Dashboard":
      return { name: "view-dashboard-outline", label: "Home" };
    case "Students":
      return { name: "account-group-outline", label: "Students" };
    case "Teachers":
      return { name: "account-tie-outline", label: "Faculty" };
    case "Academic":
      return { name: "layers-outline", label: "Academic" };
    case "Attendance":
      return {
        name: role === "teacher" ? "camera-enhance-outline" : "calendar-check-outline",
        label: role === "teacher" ? "Attendance" : "Attendance",
      };
    case "Classes":
      return { name: "book-open-outline", label: "Schedule" };
    case "History":
      return { name: "history", label: "History" };
    case "Reports":
      return { name: "file-chart-outline", label: "Reports" };
    case "Profile":
      return { name: "account-circle-outline", label: "Profile" };
    default:
      return { name: "circle-outline", label: tab };
  }
}

// ---------------------------------------------------------------------------
// ROUTER / SCREEN RENDERER
// ---------------------------------------------------------------------------
function ScreenRenderer({
  screen,
  role,
  user,
  go,
  onLogout,
}: {
  screen: string;
  role: Role;
  user: any;
  go: (s: string) => void;
  onLogout: () => void;
}) {
  switch (screen) {
    case "Dashboard":
      if (role === "admin") return <AdminDashboard go={go} />;
      if (role === "teacher") return <TeacherDashboard go={go} />;
      return <StudentDashboard go={go} />;

    case "Add Student":
      return <AddStudent go={go} />;
    case "Add Teacher":
      return <AddTeacher go={go} />;
    case "Face Registration":
      return <FaceRegistration go={go} />;

    case "Students":
      return role === "teacher" ? <TeacherStudentsRoster /> : <AdminStudentsDirectory go={go} />;
    case "Teachers":
      return <AdminTeachersDirectory go={go} />;
    case "Academic":
      return <AcademicHierarchyView />;

    case "Attendance":
      if (role === "admin") return <AdminAttendanceView />;
      if (role === "teacher") return <TeacherTakeAttendance go={go} />;
      return <StudentAttendanceView />;

    case "Recognition Results":
      return <RecognitionResultsView go={go} />;
    case "Verify Attendance":
      return <VerifyAttendanceView go={go} />;

    case "Classes":
      return <StudentClassesView />;
    case "History":
      return <AttendanceHistoryView />;
    case "Reports":
      return <ReportsView />;
    case "Alerts":
    case "Notifications":
      return <NotificationsView />;

    case "Profile":
      if (role === "admin") return <AdminProfile user={user} onLogout={onLogout} />;
      if (role === "teacher") return <TeacherProfile user={user} onLogout={onLogout} />;
      return <StudentProfile user={user} onLogout={onLogout} />;

    default:
      return <AdminDashboard go={go} />;
  }
}

// ---------------------------------------------------------------------------
// ADMIN DASHBOARD
// ---------------------------------------------------------------------------
function AdminDashboard({ go }: { go: (x: string) => void }) {
  const [students, setStudents] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    Promise.all([
      http.get("/students"),
      http.get("/admin/users"),
      http.get("/admin/attendance"),
    ])
      .then(([a, b, c]) => {
        setStudents(a.data?.students || []);
        setUsers(b.data?.users || []);
        setAttendance(c.data?.attendance || []);
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  }, []);

  if (busy) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={theme.primaryLight} />
        <Text style={styles.subtleText}>Loading University Intelligence...</Text>
      </View>
    );
  }

  const faculty = users.filter((u) => u.role === "teacher");
  const presentCount = attendance.filter(
    (x) => String(x.status || "").toUpperCase() === "PRESENT"
  ).length;
  const attendanceRate = attendance.length
    ? Math.round((presentCount / attendance.length) * 100)
    : 0;
  const uniqueSessions = new Set(attendance.map((x) => x.session_id)).size;

  return (
    <View style={styles.screenWrapper}>
      {/* Hero Welcome Banner */}
      <View style={styles.adminHeroCard}>
        <View style={{ flex: 1 }}>
          <View style={styles.systemStatusPill}>
            <View style={styles.liveIndicatorDot} />
            <Text style={styles.systemStatusText}>System Live & Processing</Text>
          </View>
          <Text style={styles.adminHeroTitle}>Enterprise Overview</Text>
          <Text style={styles.adminHeroSubtitle}>
            High-precision facial recognition & faculty roster management
          </Text>
        </View>
        <View style={styles.heroIconBox}>
          <MaterialCommunityIcons name="shield-check" size={32} color="#fff" />
        </View>
      </View>

      {/* Metrics 2x2 Grid */}
      <Text style={styles.sectionHeading}>KEY METRICS</Text>
      <View style={styles.grid2x2}>
        <MetricCard
          label="Total Students"
          value={String(students.length)}
          sub="Registered in database"
          icon="account-group"
          color={theme.primaryLight}
          bgColor={theme.primaryPale}
        />
        <MetricCard
          label="Faculty Staff"
          value={String(faculty.length)}
          sub="Active instructors"
          icon="account-tie"
          color={theme.accent}
          bgColor={theme.accentLight}
        />
        <MetricCard
          label="Attendance Rate"
          value={`${attendanceRate}%`}
          sub={`${presentCount} present logs`}
          icon="percent"
          color={theme.success}
          bgColor={theme.successPale}
        />
        <MetricCard
          label="Sessions Held"
          value={String(uniqueSessions)}
          sub="Biometric events"
          icon="calendar-check"
          color="#8B5CF6"
          bgColor="#F5F3FF"
        />
      </View>

      {/* Quick Action Buttons */}
      <Text style={styles.sectionHeading}>QUICK ACTIONS</Text>
      <View style={styles.quickActionsGrid}>
        <QuickActionButton
          title="Add Student"
          desc="Register & scan face"
          icon="account-plus-outline"
          color={theme.primaryLight}
          onPress={() => go("Add Student")}
        />
        <QuickActionButton
          title="Add Faculty"
          desc="Create teacher account"
          icon="account-tie-outline"
          color={theme.accent}
          onPress={() => go("Add Teacher")}
        />
        <QuickActionButton
          title="Academic Tree"
          desc="Schools & sections"
          icon="layers-outline"
          color="#8B5CF6"
          onPress={() => go("Academic")}
        />
        <QuickActionButton
          title="Reports"
          desc="Audit attendance"
          icon="file-chart-outline"
          color={theme.info}
          onPress={() => go("Reports")}
        />
      </View>

      {/* Recent Activity Feed */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionHeading}>RECENT ATTENDANCE ACTIVITY</Text>
        <Pressable onPress={() => go("Attendance")}>
          <Text style={styles.seeAllLink}>View All</Text>
        </Pressable>
      </View>

      {attendance.length === 0 ? (
        <EmptyState
          icon="calendar-clock-outline"
          title="No attendance events yet"
          desc="Attendance records will appear here as soon as teachers take class attendance."
        />
      ) : (
        attendance.slice(0, 5).map((log, i) => (
          <View key={log.id || i} style={styles.activityRow}>
            <View
              style={[
                styles.activityIconBox,
                {
                  backgroundColor:
                    String(log.status).toUpperCase() === "PRESENT"
                      ? theme.successPale
                      : theme.dangerPale,
                },
              ]}
            >
              <MaterialCommunityIcons
                name={
                  String(log.status).toUpperCase() === "PRESENT"
                    ? "check-circle"
                    : "close-circle"
                }
                size={22}
                color={
                  String(log.status).toUpperCase() === "PRESENT"
                    ? theme.success
                    : theme.danger
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.activityTitle}>
                {log.name || log.student_id || "Student Attendance"}
              </Text>
              <Text style={styles.activitySubtitle}>
                {log.session_id ? `Session #${log.session_id} • ` : ""}
                {log.timestamp
                  ? new Date(log.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "Recorded today"}
              </Text>
            </View>
            <StatusPill
              label={log.status || "Present"}
              tone={
                String(log.status).toUpperCase() === "PRESENT" ? "success" : "danger"
              }
            />
          </View>
        ))
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// TEACHER DASHBOARD
// ---------------------------------------------------------------------------
function TeacherDashboard({ go }: { go: (x: string) => void }) {
  const [schedule, setSchedule] = useState<any[]>([]);
  const [report, setReport] = useState<any>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    Promise.all([http.get("/schedule"), http.get("/teacher/attendance/report")])
      .then(([a, b]) => {
        setSchedule(a.data?.schedule || []);
        setReport(b.data || null);
      })
      .catch(() => {})
      .finally(() => setBusy(false));
  }, []);

  if (busy) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={theme.primaryLight} />
        <Text style={styles.subtleText}>Loading Class Schedule...</Text>
      </View>
    );
  }

  const presentCount = report?.totals?.students_present || 0;
  const sessionsCount = report?.totals?.sessions || 0;

  return (
    <View style={styles.screenWrapper}>
      {/* Primary Action Hero */}
      <View style={styles.teacherHeroCard}>
        <View style={{ flex: 1 }}>
          <View style={styles.teacherBadgePill}>
            <MaterialCommunityIcons name="camera" size={14} color="#fff" />
            <Text style={styles.teacherBadgeText}>Facial Recognition Ready</Text>
          </View>
          <Text style={styles.teacherHeroTitle}>Take Class Attendance</Text>
          <Text style={styles.teacherHeroSub}>
            Snap a single class photo. AI detects and records all students instantly.
          </Text>
          <Pressable
            style={styles.heroCTAButton}
            onPress={() => go("Attendance")}
          >
            <MaterialCommunityIcons name="camera-enhance" size={20} color={theme.primary} />
            <Text style={styles.heroCTAText}>Start Attendance Session</Text>
          </Pressable>
        </View>
      </View>

      {/* Metrics Row */}
      <Text style={styles.sectionHeading}>DAILY STATS</Text>
      <View style={styles.horizontalMetricsRow}>
        <View style={styles.teacherMetricCard}>
          <MaterialCommunityIcons name="calendar-month-outline" size={24} color={theme.primaryLight} />
          <Text style={styles.teacherMetricVal}>{schedule.length}</Text>
          <Text style={styles.teacherMetricLbl}>Scheduled Classes</Text>
        </View>
        <View style={styles.teacherMetricCard}>
          <MaterialCommunityIcons name="account-check-outline" size={24} color={theme.success} />
          <Text style={[styles.teacherMetricVal, { color: theme.success }]}>{presentCount}</Text>
          <Text style={styles.teacherMetricLbl}>Students Present</Text>
        </View>
        <View style={styles.teacherMetricCard}>
          <MaterialCommunityIcons name="layers-outline" size={24} color={theme.accent} />
          <Text style={styles.teacherMetricVal}>{sessionsCount}</Text>
          <Text style={styles.teacherMetricLbl}>Sessions Held</Text>
        </View>
      </View>

      {/* Today's Schedule */}
      <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionHeading}>TODAY'S SCHEDULE</Text>
        <Pressable onPress={() => go("Attendance")}>
          <Text style={styles.seeAllLink}>Take Attendance</Text>
        </Pressable>
      </View>

      {schedule.length === 0 ? (
        <EmptyState
          icon="calendar-blank-outline"
          title="No classes scheduled today"
          desc="Your timetable has no classes assigned for this date."
        />
      ) : (
        schedule.map((cls, i) => (
          <Pressable
            key={cls.id || i}
            style={styles.scheduleCard}
            onPress={() => go("Attendance")}
          >
            <View style={styles.scheduleTimeBox}>
              <Text style={styles.scheduleTimeText}>
                {cls.starts_at || "09:00"}
              </Text>
              <Text style={styles.scheduleTimeEnd}>
                {cls.ends_at || "10:00"}
              </Text>
            </View>
            <View style={{ flex: 1, paddingLeft: 12 }}>
              <Text style={styles.scheduleTitle}>{cls.subject || "Class Lecture"}</Text>
              <Text style={styles.scheduleMeta}>
                {cls.room || "Room Assigned"} • {cls.day || "Today"}
              </Text>
            </View>
            <View style={styles.scheduleArrowBox}>
              <MaterialCommunityIcons name="chevron-right" size={22} color={theme.primaryLight} />
            </View>
          </Pressable>
        ))
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// STUDENT DASHBOARD
// ---------------------------------------------------------------------------
function StudentDashboard({ go }: { go: (x: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    http
      .get("/student/attendance/overview")
      .then((r) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setBusy(false));
  }, []);

  if (busy) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={theme.primaryLight} />
        <Text style={styles.subtleText}>Loading Attendance Summary...</Text>
      </View>
    );
  }

  const profile = data?.profile || {};
  const attendance = Array.isArray(data?.attendance) ? data.attendance : [];
  const summary = data?.summary || {};
  const rate = Math.round(Number(summary.overall_percentage || 0));
  const isGoodStanding = rate >= 75;

  return (
    <View style={styles.screenWrapper}>
      {/* Attendance Ring Score Card */}
      <View style={styles.studentScoreCard}>
        <View style={styles.studentDialWrap}>
          <View
            style={[
              styles.studentDialCircle,
              { borderColor: isGoodStanding ? theme.success : theme.accent },
            ]}
          >
            <Text style={styles.studentDialPercent}>{rate}%</Text>
            <Text style={styles.studentDialLabel}>Attendance</Text>
          </View>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={styles.studentScoreTitle}>Academic Fidelity</Text>
          <StatusPill
            label={isGoodStanding ? "In Good Standing (≥ 75%)" : "Low Attendance (< 75%)"}
            tone={isGoodStanding ? "success" : "warning"}
          />
          <Text style={styles.studentScoreSub}>
            {profile.program || "Academic Program"}
            {profile.semester ? ` • Semester ${profile.semester}` : ""}
          </Text>
        </View>
      </View>

      {/* Breakdown Metrics */}
      <Text style={styles.sectionHeading}>RECORD SUMMARY</Text>
      <View style={styles.studentStatsGrid}>
        <View style={styles.studentStatBox}>
          <Text style={styles.studentStatVal}>{attendance.length}</Text>
          <Text style={styles.studentStatLbl}>Total Sessions</Text>
        </View>
        <View style={styles.studentStatBox}>
          <Text style={[styles.studentStatVal, { color: theme.success }]}>
            {summary.present || 0}
          </Text>
          <Text style={styles.studentStatLbl}>Present</Text>
        </View>
        <View style={styles.studentStatBox}>
          <Text style={[styles.studentStatVal, { color: theme.danger }]}>
            {summary.absent || 0}
          </Text>
          <Text style={styles.studentStatLbl}>Absent</Text>
        </View>
      </View>

      <Pressable style={styles.primaryActionButton} onPress={() => go("Attendance")}>
        <MaterialCommunityIcons name="calendar-search" size={20} color="#fff" />
        <Text style={styles.primaryActionText}>View Full Attendance Logs</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ADMIN STUDENTS DIRECTORY
// ---------------------------------------------------------------------------
function AdminStudentsDirectory({ go }: { go: (x: string) => void }) {
  const [students, setStudents] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<any>({});
  const [busy, setBusy] = useState(true);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);

  useEffect(() => {
    http
      .get("/students")
      .then((r) => setStudents(r.data?.students || []))
      .catch(() => setStudents([]))
      .finally(() => setBusy(false));
  }, []);

  const visible = students.filter((st) => {
    const raw = JSON.stringify(st).toLowerCase();
    const query = search.toLowerCase();
    const matchesQuery = !search || raw.includes(query);
    const matchesFilters = Object.values(filters)
      .filter(Boolean)
      .every((val: any) => raw.includes(String(val).toLowerCase()));
    return matchesQuery && matchesFilters;
  });

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.screenHeader}>
        <View>
          <Text style={styles.screenTitle}>Students Directory</Text>
          <Text style={styles.screenSubtitle}>
            {students.length} registered students in university system
          </Text>
        </View>
        <Pressable
          style={styles.addButtonMini}
          onPress={() => go("Add Student")}
        >
          <MaterialCommunityIcons name="plus" size={20} color="#fff" />
          <Text style={styles.addButtonMiniText}>New</Text>
        </Pressable>
      </View>

      {/* Search & Filter Bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBar}>
          <MaterialCommunityIcons name="magnify" size={22} color={theme.muted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, student ID, email..."
            placeholderTextColor={theme.muted}
          />
          {!!search && (
            <Pressable onPress={() => setSearch("")}>
              <MaterialCommunityIcons name="close-circle" size={18} color={theme.muted} />
            </Pressable>
          )}
        </View>
        <Pressable
          style={[styles.filterToggleBtn, showFilters && styles.filterToggleBtnActive]}
          onPress={() => setShowFilters((v) => !v)}
        >
          <MaterialCommunityIcons
            name={showFilters ? "filter-check" : "tune-variant"}
            size={20}
            color={showFilters ? "#fff" : theme.primaryLight}
          />
        </Pressable>
      </View>

      {showFilters && (
        <View style={styles.filterCascadeCard}>
          <AcademicCascade
            onApply={(f) => {
              setFilters(f);
              setShowFilters(false);
            }}
          />
        </View>
      )}

      {/* Roster List */}
      {busy ? (
        <ActivityIndicator size="large" color={theme.primaryLight} style={{ margin: 30 }} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="account-search-outline"
          title="No students found"
          desc="Try modifying your search or filters, or register a new student."
          actionText="Add Student"
          onAction={() => go("Add Student")}
        />
      ) : (
        visible.map((student, i) => (
          <Pressable
            key={student.student_id || i}
            style={styles.directoryCard}
            onPress={() => setSelectedStudent(student)}
          >
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>
                {(student.name || "S").charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Text style={styles.directoryName}>{student.name || "Student Record"}</Text>
              <Text style={styles.directoryId}>
                ID: {student.student_id || "STU-000"}
              </Text>
              <Text style={styles.directoryMeta}>
                {student.program || "Degree"} • {student.semester || "Semester"}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={theme.muted} />
          </Pressable>
        ))
      )}

      {/* Student Details Modal */}
      {selectedStudent && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedStudent(null)}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setSelectedStudent(null)}
          >
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Student Profile</Text>
                <Pressable onPress={() => setSelectedStudent(null)}>
                  <MaterialCommunityIcons name="close" size={24} color={theme.text} />
                </Pressable>
              </View>

              <View style={styles.modalHero}>
                <View style={styles.modalAvatarLarge}>
                  <Text style={styles.modalAvatarText}>
                    {(selectedStudent.name || "S").charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={styles.modalName}>{selectedStudent.name}</Text>
                <View style={styles.idChip}>
                  <Text style={styles.idChipText}>{selectedStudent.student_id}</Text>
                </View>
              </View>

              <View style={styles.modalDetailsList}>
                <DetailRow label="University Email" value={selectedStudent.email || "Not registered"} />
                <DetailRow label="Course / Program" value={selectedStudent.program || "Not registered"} />
                <DetailRow label="Department" value={selectedStudent.department || "Not registered"} />
                <DetailRow label="Semester" value={selectedStudent.semester || "Not specified"} />
                <DetailRow label="Biometric Status" value="Active (Validated Embedding)" />
              </View>

              <Pressable
                style={styles.modalCloseButton}
                onPress={() => setSelectedStudent(null)}
              >
                <Text style={styles.modalCloseButtonText}>Done</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// TEACHER STUDENTS ROSTER (READ-ONLY)
// ---------------------------------------------------------------------------
function TeacherStudentsRoster() {
  const [students, setStudents] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    http
      .get("/students")
      .then((r) => setStudents(r.data?.students || []))
      .catch(() => setStudents([]))
      .finally(() => setBusy(false));
  }, []);

  const visible = students.filter((x) =>
    JSON.stringify(x).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.screenHeader}>
        <View>
          <Text style={styles.screenTitle}>My Students Roster</Text>
          <Text style={styles.screenSubtitle}>
            Assigned student roster directory
          </Text>
        </View>
        <View style={styles.readOnlyPill}>
          <MaterialCommunityIcons name="lock" size={14} color={theme.primaryLight} />
          <Text style={styles.readOnlyPillText}>Read-Only</Text>
        </View>
      </View>

      <View style={styles.searchBar}>
        <MaterialCommunityIcons name="magnify" size={22} color={theme.muted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search assigned student roster..."
          placeholderTextColor={theme.muted}
        />
      </View>

      {busy ? (
        <ActivityIndicator size="large" color={theme.primaryLight} style={{ margin: 30 }} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="account-group"
          title="No students match query"
          desc="Check your search query or verify your assigned department."
        />
      ) : (
        visible.map((student, i) => (
          <View key={student.student_id || i} style={styles.directoryCard}>
            <View style={styles.avatarCircle}>
              <Text style={styles.avatarInitial}>
                {(student.name || "S").charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Text style={styles.directoryName}>{student.name || "Student Record"}</Text>
              <Text style={styles.directoryId}>ID: {student.student_id || "STU-000"}</Text>
              <Text style={styles.directoryMeta}>
                {student.program || "Course"} • {student.semester || "Semester"}
              </Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ADMIN TEACHERS DIRECTORY
// ---------------------------------------------------------------------------
function AdminTeachersDirectory({ go }: { go: (x: string) => void }) {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    http
      .get("/admin/users")
      .then((r) =>
        setTeachers(
          (r.data?.users || []).filter((u: any) => u.role === "teacher")
        )
      )
      .catch(() => setTeachers([]))
      .finally(() => setBusy(false));
  }, []);

  const deleteTeacher = (teacher: any) => {
    Alert.alert(
      "Confirm Removal",
      `Are you sure you want to remove ${teacher.display_name || teacher.username}? This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Staff",
          style: "destructive",
          onPress: async () => {
            try {
              await http.delete(`/admin/users/${teacher.id}`);
              setTeachers((v) => v.filter((t) => t.id !== teacher.id));
              setSelected(null);
            } catch (e: any) {
              Alert.alert(
                "Error",
                e?.response?.data?.detail || "Could not delete instructor."
              );
            }
          },
        },
      ]
    );
  };

  const visible = teachers.filter((t) =>
    JSON.stringify(t).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.screenHeader}>
        <View>
          <Text style={styles.screenTitle}>Faculty Directory</Text>
          <Text style={styles.screenSubtitle}>
            {teachers.length} academic instructors and professors
          </Text>
        </View>
        <Pressable
          style={styles.addButtonMini}
          onPress={() => go("Add Teacher")}
        >
          <MaterialCommunityIcons name="plus" size={20} color="#fff" />
          <Text style={styles.addButtonMiniText}>Add</Text>
        </Pressable>
      </View>

      <View style={styles.searchBar}>
        <MaterialCommunityIcons name="magnify" size={22} color={theme.muted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search faculty by name, ID or email..."
          placeholderTextColor={theme.muted}
        />
      </View>

      {busy ? (
        <ActivityIndicator size="large" color={theme.primaryLight} style={{ margin: 30 }} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="account-tie"
          title="No faculty found"
          desc="Add professors and teachers to allow them to take attendance."
          actionText="Add Teacher"
          onAction={() => go("Add Teacher")}
        />
      ) : (
        visible.map((teacher, i) => (
          <Pressable
            key={teacher.id || i}
            style={styles.directoryCard}
            onPress={() => setSelected(teacher)}
          >
            <View style={[styles.avatarCircle, { backgroundColor: theme.accentLight }]}>
              <MaterialCommunityIcons name="account-tie" size={22} color={theme.accentDark} />
            </View>
            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Text style={styles.directoryName}>
                {teacher.display_name || teacher.username}
              </Text>
              <Text style={styles.directoryId}>ID: {teacher.username}</Text>
              <Text style={styles.directoryMeta}>
                {teacher.email || "University Faculty"}
              </Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={22} color={theme.muted} />
          </Pressable>
        ))
      )}

      {/* Teacher Detail Modal */}
      {selected && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setSelected(null)}
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={() => setSelected(null)}
          >
            <Pressable style={styles.modalCard} onPress={(e) => e.stopPropagation()}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Faculty Record</Text>
                <Pressable onPress={() => setSelected(null)}>
                  <MaterialCommunityIcons name="close" size={24} color={theme.text} />
                </Pressable>
              </View>

              <View style={styles.modalHero}>
                <View style={[styles.modalAvatarLarge, { backgroundColor: theme.accentLight }]}>
                  <MaterialCommunityIcons name="account-tie" size={40} color={theme.accentDark} />
                </View>
                <Text style={styles.modalName}>
                  {selected.display_name || selected.username}
                </Text>
                <View style={[styles.idChip, { backgroundColor: theme.accentLight }]}>
                  <Text style={[styles.idChipText, { color: theme.accentDark }]}>
                    FACULTY • {selected.username}
                  </Text>
                </View>
              </View>

              <View style={styles.modalDetailsList}>
                <DetailRow label="Username / ID" value={selected.username} />
                <DetailRow label="Email Address" value={selected.email || "Not specified"} />
                <DetailRow label="Role Access" value="Teacher (Face Recognition)" />
              </View>

              <View style={styles.modalActionButtonsRow}>
                <Pressable
                  style={styles.dangerButton}
                  onPress={() => deleteTeacher(selected)}
                >
                  <MaterialCommunityIcons name="trash-can-outline" size={18} color={theme.danger} />
                  <Text style={styles.dangerButtonText}>Delete Faculty</Text>
                </Pressable>
                <Pressable
                  style={styles.modalDoneButton}
                  onPress={() => setSelected(null)}
                >
                  <Text style={styles.modalDoneButtonText}>Close</Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ADD STUDENT SCREEN (WITH FACE REGISTRATION INTEGRATION)
// ---------------------------------------------------------------------------
function AddStudent({ go }: { go: (x: string) => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [sectionId, setSectionId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [registeredPhotos, setRegisteredPhotos] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem("face_registration_photos").then((val) => {
      if (val) {
        try {
          const draft = JSON.parse(val);
          // Captures are biometric data, so do not reuse an old enrollment
          // draft for a different student or keep it indefinitely.
          if (
            Array.isArray(draft?.photos) &&
            draft.photos.length === 5 &&
            Date.now() - Number(draft.createdAt) < 15 * 60 * 1000
          ) {
            setRegisteredPhotos(draft.photos);
          } else {
            AsyncStorage.removeItem("face_registration_photos");
          }
        } catch {}
      }
    });
  }, []);

  const saveStudent = async () => {
    if (!name.trim() || !email.trim() || !sectionId) {
      Alert.alert("Missing Fields", "Enter the student's name, email, and academic placement.");
      return;
    }
    if (registeredPhotos.length !== 5) {
      Alert.alert(
        "Face Registration Required",
        "Please complete the 5-angle biometric face capture before saving."
      );
      return;
    }
    setBusy(true);
    try {
      const studentId = `STU-${Date.now().toString().slice(-6)}`;
      const data = new FormData();
      data.append("student_id", studentId);
      data.append("name", name.trim());
      data.append("email", email.trim());
      data.append("section_id", String(sectionId));
      data.append("password", "ChangeMe123!");
      registeredPhotos.forEach((uri: string, i: number) => {
        data.append("files", {
          uri,
          name: `face-${i}.jpg`,
          type: "image/jpeg",
        } as any);
      });

      await http.post("/register-student", data);

      await AsyncStorage.removeItem("face_registration_photos");
      Alert.alert(
        "Student Created",
        `Student ${name} registered successfully with verified biometric embedding.`,
        [{ text: "View Students", onPress: () => go("Students") }]
      );
    } catch (e: any) {
      Alert.alert(
        "Registration Failed",
        e?.response?.data?.detail || "Could not register student. Please check input."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.formHeader}>
        <Pressable
          onPress={async () => {
            await AsyncStorage.removeItem("face_registration_photos");
            go("Students");
          }}
          style={styles.backButtonCircle}
        >
          <MaterialCommunityIcons name="arrow-left" size={20} color={theme.text} />
        </Pressable>
        <View style={{ flex: 1, paddingLeft: 12 }}>
          <Text style={styles.screenTitle}>Add Student</Text>
          <Text style={styles.screenSubtitle}>
            Enroll student & generate 512-D face embedding
          </Text>
        </View>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.formCardTitle}>PERSONAL INFORMATION</Text>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Full Legal Name</Text>
          <View style={styles.inputContainer}>
            <MaterialCommunityIcons name="account-outline" size={20} color={theme.muted} style={styles.inputIcon} />
            <TextInput
              style={styles.textInput}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Jonathan Smith"
              placeholderTextColor={theme.muted}
            />
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>University Email Address</Text>
          <View style={styles.inputContainer}>
            <MaterialCommunityIcons name="email-outline" size={20} color={theme.muted} style={styles.inputIcon} />
            <TextInput
              style={styles.textInput}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              placeholder="e.g. j.smith@university.edu"
              placeholderTextColor={theme.muted}
              autoCapitalize="none"
            />
          </View>
        </View>

        <AcademicCascade onSectionChange={setSectionId} />

        <Text style={[styles.formCardTitle, { marginTop: 20 }]}>BIOMETRIC VERIFICATION</Text>
        <Pressable
          style={[
            styles.biometricPromptCard,
            registeredPhotos.length === 5 && styles.biometricPromptCardSuccess,
          ]}
          onPress={() => go("Face Registration")}
        >
          <View
            style={[
              styles.biometricIconCircle,
              registeredPhotos.length === 5 && { backgroundColor: theme.successPale },
            ]}
          >
            <MaterialCommunityIcons
              name={registeredPhotos.length === 5 ? "check-circle" : "face-recognition"}
              size={32}
              color={registeredPhotos.length === 5 ? theme.success : theme.primaryLight}
            />
          </View>
          <View style={{ flex: 1, paddingLeft: 14 }}>
            <Text style={styles.biometricTitle}>
              {registeredPhotos.length === 5
                ? "5 Face Angles Captured & Ready"
                : "Capture 5 Face Angles"}
            </Text>
            <Text style={styles.biometricSub}>
              {registeredPhotos.length === 5
                ? "Biometric validation passed. Ready to save student."
                : "Center, chin up/down, left and right poses"}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={22} color={theme.muted} />
        </Pressable>

        <View style={styles.formButtonsRow}>
          <Pressable
            style={styles.cancelButton}
            onPress={async () => {
              await AsyncStorage.removeItem("face_registration_photos");
              go("Students");
            }}
          >
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.saveButton, busy && { opacity: 0.7 }]}
            onPress={saveStudent}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Save Student Record</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ADD TEACHER SCREEN
// ---------------------------------------------------------------------------
function AddTeacher({ go }: { go: (x: string) => void }) {
  const [form, setForm] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
  });
  const [selectedSections, setSelectedSections] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!form.name || !form.username || !form.password) {
      Alert.alert("Missing Fields", "Please complete name, employee ID, and password.");
      return;
    }
    setBusy(true);
    try {
      await http.post("/admin/users", {
        username: form.username,
        password: form.password,
        role: "teacher",
        name: form.name,
        email: form.email,
        academic_section_ids: selectedSections,
      });
      Alert.alert(
        "Faculty Created",
        `Teacher ${form.name} created successfully.`,
        [{ text: "View Faculty", onPress: () => go("Teachers") }]
      );
    } catch (e: any) {
      Alert.alert(
        "Creation Failed",
        e?.response?.data?.detail || "Please check inputs."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.formHeader}>
        <Pressable onPress={() => go("Teachers")} style={styles.backButtonCircle}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={theme.text} />
        </Pressable>
        <View style={{ flex: 1, paddingLeft: 12 }}>
          <Text style={styles.screenTitle}>Add Faculty</Text>
          <Text style={styles.screenSubtitle}>
            Register instructor & assign academic departments
          </Text>
        </View>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.formCardTitle}>INSTRUCTOR CREDENTIALS</Text>
        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Full Legal Name</Text>
          <TextInput
            style={styles.textInputPlain}
            value={form.name}
            onChangeText={(v) => setForm((p) => ({ ...p, name: v }))}
            placeholder="e.g. Dr. Sarah Jenkins"
            placeholderTextColor={theme.muted}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>University Email</Text>
          <TextInput
            style={styles.textInputPlain}
            value={form.email}
            onChangeText={(v) => setForm((p) => ({ ...p, email: v }))}
            keyboardType="email-address"
            placeholder="s.jenkins@university.edu"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Employee ID / Username</Text>
          <TextInput
            style={styles.textInputPlain}
            value={form.username}
            onChangeText={(v) => setForm((p) => ({ ...p, username: v }))}
            placeholder="e.g. EMP-2026-44"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Temporary Password</Text>
          <TextInput
            style={styles.textInputPlain}
            value={form.password}
            onChangeText={(v) => setForm((p) => ({ ...p, password: v }))}
            secureTextEntry
            placeholder="Create password"
            placeholderTextColor={theme.muted}
          />
        </View>

        <TeacherHierarchyCheckboxes
          selected={selectedSections}
          onChange={setSelectedSections}
        />

        <View style={styles.formButtonsRow}>
          <Pressable style={styles.cancelButton} onPress={() => go("Teachers")}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.saveButton, busy && { opacity: 0.7 }]}
            onPress={save}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveButtonText}>Create Faculty</Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// FACE REGISTRATION (HIGH-TECH BIOMETRIC HUD)
// ---------------------------------------------------------------------------
function FaceRegistration({ go }: { go: (x: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState(0);
  const [captured, setCaptured] = useState<string[]>([]);
  const [camera, setCamera] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [completed, setCompleted] = useState(false);

  const steps = [
    { short: "Center", title: "Center View", guide: "Position face directly inside the oval guide." },
    { short: "Chin Up", title: "Tilt Chin Up", guide: "Gently tilt your chin upward." },
    { short: "Chin Down", title: "Tilt Chin Down", guide: "Gently tilt your chin downward." },
    { short: "Left", title: "Turn Left", guide: "Turn your face slightly to the left." },
    { short: "Right", title: "Turn Right", guide: "Turn your face slightly to the right." },
  ];

  useEffect(() => {
    if (permission === null) return;
    if (!permission.granted) requestPermission();
  }, [permission?.granted]);

  const capturePhoto = async (automatic = false) => {
    if (!camera || busy || completed) return;
    setBusy(true);
    setFaceDetected(false);
    try {
      const photo = await camera.takePictureAsync({
        quality: 0.85,
        // Process orientation metadata before upload. This keeps the server's
        // face detector and pose checks consistent across Android devices.
        skipProcessing: false,
      });
      if (!photo?.uri) throw new Error("No photo captured");

      const data = new FormData();
      data.append("file", {
        uri: photo.uri,
        name: `face-${step}.jpg`,
        type: "image/jpeg",
      } as any);

      const poseKey =
        step === 0
          ? "center"
          : step === 1
            ? "chin_up"
            : step === 2
              ? "chin_down"
              : step === 3
                ? "left"
                : "right";

      data.append("target_pose", poseKey);

      const res = await http.post("/validate-face", data);

      if (!res.data?.valid) {
        throw new Error(
          res.data?.user_guidance ||
            res.data?.issues?.[0] ||
            "Pose not recognized. Please follow instructions."
        );
      }

      setFaceDetected(true);
      const nextPhotos = [...captured, photo.uri];
      setCaptured(nextPhotos);

      if (step < 4) {
        setStep(step + 1);
      } else {
        setCompleted(true);
        await AsyncStorage.setItem(
          "face_registration_photos",
          JSON.stringify({ createdAt: Date.now(), photos: nextPhotos })
        );
        Alert.alert(
          "Biometrics Validated",
          "All 5 face angles were successfully scanned and validated.",
          [{ text: "Continue to Add Student", onPress: () => go("Add Student") }]
        );
      }
    } catch (e: any) {
      // The idle scanner deliberately stays quiet for empty/invalid frames.
      // A person only sees guidance after choosing the manual capture button.
      if (!automatic) {
        Alert.alert(
          "Pose Guidance",
          e?.response?.data?.user_guidance ||
            e?.response?.data?.detail ||
            e?.message ||
            "Please realign your face with the guide."
        );
      }
    } finally {
      setBusy(false);
    }
  };

  // Expo Camera does not expose a native face-detector callback in this SDK.
  // Sample a frame at a restrained cadence instead: the API validates that
  // exactly one usable face is present and only then accepts the capture.
  useEffect(() => {
    if (!cameraReady || !camera || busy || completed) return;
    const timer = setTimeout(() => capturePhoto(true), 1200);
    return () => clearTimeout(timer);
  }, [cameraReady, camera, busy, completed, step, captured]);

  if (!permission || !permission.granted) {
    return (
      <View style={styles.screenWrapper}>
        <View style={styles.cameraPermissionCard}>
          <MaterialCommunityIcons name="camera-off" size={48} color={theme.muted} />
          <Text style={styles.cameraPermTitle}>Camera Access Required</Text>
          <Text style={styles.cameraPermDesc}>
            Pratyaksh requires camera access to capture the 5-angle biometric facial embeddings.
          </Text>
          <Pressable style={styles.primaryActionButton} onPress={requestPermission}>
            <Text style={styles.primaryActionText}>Grant Camera Permission</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const current = steps[step];

  return (
    <View style={styles.screenWrapper}>
      {/* Header */}
      <View style={styles.formHeader}>
        <Pressable onPress={() => go("Add Student")} style={styles.backButtonCircle}>
          <MaterialCommunityIcons name="arrow-left" size={20} color={theme.text} />
        </Pressable>
        <View style={{ flex: 1, paddingLeft: 12 }}>
          <Text style={styles.screenTitle}>Biometric Scan</Text>
          <Text style={styles.screenSubtitle}>
            Angle {step + 1} of 5: {current.title}
          </Text>
        </View>
      </View>

      {/* Steps Pill Progress */}
      <View style={styles.hudStepsRow}>
        {steps.map((s, idx) => (
          <View
            key={s.short}
            style={[
              styles.hudStepItem,
              idx === step && styles.hudStepItemActive,
              idx < step && styles.hudStepItemDone,
            ]}
          >
            <Text
              style={[
                styles.hudStepText,
                idx === step && styles.hudStepTextActive,
                idx < step && styles.hudStepTextDone,
              ]}
            >
              {idx < step ? "✓" : idx + 1}
            </Text>
          </View>
        ))}
      </View>

      {/* Futuristic HUD Camera Viewfinder */}
      <View style={styles.hudCameraCard}>
        {cameraError ? (
          <View style={styles.hudCameraError}>
            <Text style={{ color: "#fff" }}>Camera Preview Failed</Text>
          </View>
        ) : (
          <View style={styles.cameraWrapper}>
            <CameraView
              ref={setCamera}
              style={styles.cameraPreview}
              facing="front"
              onCameraReady={() => setCameraReady(true)}
              onMountError={() => setCameraError("Camera failed")}
            />
            {/* Ambient Biometric Oval Overlay */}
            <View
              style={[
                styles.hudOvalGuide,
                faceDetected && styles.hudOvalGuideDetected,
                busy && styles.hudOvalGuideScanning,
              ]}
            />
            {/* Live Status Tag */}
            <View style={styles.hudStatusTag}>
              <View
                style={[
                  styles.hudStatusDot,
                  { backgroundColor: busy ? theme.accent : theme.success },
                ]}
              />
              <Text style={styles.hudStatusTagText}>
                {busy
                  ? "ANALYZING POSE..."
                  : faceDetected
                    ? "FACE VERIFIED"
                    : cameraReady
                    ? "WAITING FOR FACE..."
                    : "WARMING UP..."}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Guide Card */}
      <View style={styles.hudGuideCard}>
        <Text style={styles.hudGuideTitle}>
          Step {step + 1}: {current.title}
        </Text>
        <Text style={styles.hudGuideDesc}>{current.guide}</Text>

        <Pressable
          style={[styles.hudManualCaptureBtn, busy && { opacity: 0.7 }]}
          onPress={() => capturePhoto(false)}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <View style={styles.hudManualRow}>
              <MaterialCommunityIcons name="camera" size={20} color="#fff" />
              <Text style={styles.hudManualBtnText}>Capture Angle ({step + 1}/5)</Text>
            </View>
          )}
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// TEACHER: TAKE ATTENDANCE (SESSION CREATOR & CAMERA/GALLERY PROCESSOR)
// ---------------------------------------------------------------------------
function TeacherTakeAttendance({ go }: { go: (x: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<any>(null);
  const [academicScope, setAcademicScope] = useState<any>({
    school: [],
    faculty: [],
    department: [],
    program: [],
    semester: [],
  });
  const [sections, setSections] = useState<any[]>([]);

  const [form, setForm] = useState({
    title: "Class Lecture",
    course: "CS-301 Computer Networks",
    room: "Lab 204",
    event_date: new Date().toISOString().slice(0, 10),
    starts_at: "09:00",
    ends_at: "10:00",
    notes: "",
  });

  useEffect(() => {
    http
      .get("/academic/sections")
      .then((r) => setSections(r.data?.sections || []))
      .catch(() => setSections([]));
  }, []);

  const createSession = async () => {
    if (!scope?.id || !form.title.trim() || !form.course.trim()) {
      Alert.alert(
        "Complete Details",
        "Please select an academic section and specify course and title."
      );
      return;
    }
    setBusy(true);
    try {
      const res = await http.post("/teacher/attendance-sessions", {
        ...form,
        school: academicScope.school[0] || scope.school,
        faculty: academicScope.faculty[0] || scope.faculty,
        department: academicScope.department[0] || scope.department,
        program: academicScope.program[0] || scope.program,
        semester: academicScope.semester[0] || scope.semester,
        academic_scope: academicScope,
        section_id: scope.id,
      });
      setScope({ ...scope, session_id: res.data.session_id });
      Alert.alert(
        "Session Active",
        "Attendance session created. You may now capture or upload the group photo."
      );
    } catch (e: any) {
      Alert.alert(
        "Error",
        e?.response?.data?.detail || "Could not initialize session."
      );
    } finally {
      setBusy(false);
    }
  };

  const processPhoto = async (uri: string) => {
    if (!scope?.session_id) {
      Alert.alert("No Session", "Create session details first.");
      return;
    }
    setBusy(true);
    try {
      const data = new FormData();
      data.append("session_id", scope.session_id);
      data.append("file", {
        uri,
        name: "class-group-photo.jpg",
        type: "image/jpeg",
      } as any);

      await http.post("/process-group-attendance", data);

      go("Recognition Results");
    } catch (e: any) {
      Alert.alert(
        "Recognition Failed",
        e?.response?.data?.detail || "Could not process class photo. Please retry."
      );
    } finally {
      setBusy(false);
    }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission Needed", "Please enable camera access.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (!res.canceled && res.assets?.[0]?.uri) {
      await processPhoto(res.assets[0].uri);
    }
  };

  const pickFromGallery = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (!res.canceled && res.assets?.[0]?.uri) {
      await processPhoto(res.assets[0].uri);
    }
  };

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.screenHeader}>
        <View>
          <Text style={styles.screenTitle}>Take Attendance</Text>
          <Text style={styles.screenSubtitle}>
            Biometric group photo attendance session
          </Text>
        </View>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.formCardTitle}>SESSION CONFIGURATION</Text>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Class / Event Title</Text>
          <TextInput
            style={styles.textInputPlain}
            value={form.title}
            onChangeText={(v) => setForm((p) => ({ ...p, title: v }))}
            placeholder="e.g. Distributed Systems Lab"
            placeholderTextColor={theme.muted}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Course Code & Name</Text>
          <TextInput
            style={styles.textInputPlain}
            value={form.course}
            onChangeText={(v) => setForm((p) => ({ ...p, course: v }))}
            placeholder="e.g. CS-402 Distributed Systems"
            placeholderTextColor={theme.muted}
          />
        </View>

        <TeacherHierarchyCheckboxes
          selected={[]}
          onChange={() => {}}
          onScopeChange={(next) => {
            setAcademicScope(next);
            const found = sections.find((s) =>
              Object.entries(next).every(
                ([k, v]: any) => !v.length || v.includes(s[k])
              )
            );
            if (found) setScope(found);
          }}
        />

        <View style={styles.formGroup}>
          <Text style={styles.fieldLabel}>Classroom / Lab Location</Text>
          <TextInput
            style={styles.textInputPlain}
            value={form.room}
            onChangeText={(v) => setForm((p) => ({ ...p, room: v }))}
            placeholder="Room 101"
            placeholderTextColor={theme.muted}
          />
        </View>

        <View style={styles.twoColumnRow}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={styles.fieldLabel}>Starts</Text>
            <TextInput
              style={styles.textInputPlain}
              value={form.starts_at}
              onChangeText={(v) => setForm((p) => ({ ...p, starts_at: v }))}
              placeholder="09:00"
              placeholderTextColor={theme.muted}
            />
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.fieldLabel}>Ends</Text>
            <TextInput
              style={styles.textInputPlain}
              value={form.ends_at}
              onChangeText={(v) => setForm((p) => ({ ...p, ends_at: v }))}
              placeholder="10:00"
              placeholderTextColor={theme.muted}
            />
          </View>
        </View>

        {/* Selected Section Summary */}
        <View style={styles.sectionSummaryCard}>
          <MaterialCommunityIcons name="layers" size={20} color={theme.primaryLight} />
          <View style={{ flex: 1, paddingLeft: 10 }}>
            <Text style={styles.sectionSummaryTitle}>
              {scope
                ? `${scope.department} • ${scope.program}`
                : "Select an academic section above"}
            </Text>
            <Text style={styles.sectionSummarySub}>
              {scope?.session_id
                ? `Active Session: #${scope.session_id}`
                : "Ready to initialize attendance session"}
            </Text>
          </View>
        </View>

        {!scope?.session_id ? (
          <Pressable
            style={[styles.primaryActionButton, busy && { opacity: 0.7 }]}
            onPress={createSession}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <View style={styles.submitRow}>
                <MaterialCommunityIcons name="plus-circle" size={20} color="#fff" />
                <Text style={styles.primaryActionText}>Create Attendance Session</Text>
              </View>
            )}
          </Pressable>
        ) : (
          <View style={styles.photoCaptureButtonsWrap}>
            <Pressable
              style={[styles.photoActionButton, styles.cameraBtn, busy && { opacity: 0.7 }]}
              onPress={takePhoto}
              disabled={busy}
            >
              <MaterialCommunityIcons name="camera" size={28} color="#fff" />
              <Text style={styles.photoActionTitle}>Take Class Photo</Text>
              <Text style={styles.photoActionSub}>Capture students with camera</Text>
            </Pressable>

            <Pressable
              style={[styles.photoActionButton, styles.galleryBtn, busy && { opacity: 0.7 }]}
              onPress={pickFromGallery}
              disabled={busy}
            >
              <MaterialCommunityIcons name="image-multiple" size={28} color={theme.text} />
              <Text style={[styles.photoActionTitle, { color: theme.text }]}>Upload From Gallery</Text>
              <Text style={[styles.photoActionSub, { color: theme.textSecondary }]}>
                Select an existing photo
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// TEACHER: RECOGNITION RESULTS
// ---------------------------------------------------------------------------
function RecognitionResultsView({ go }: { go: (x: string) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    http
      .get("/teacher/attendance/report")
      .then((r) => setItems(r.data?.records || []))
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
  }, []);

  if (busy) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={theme.primaryLight} />
        <Text style={styles.subtleText}>Analyzing Facial Embeddings...</Text>
      </View>
    );
  }

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.screenHeader}>
        <View>
          <Text style={styles.screenTitle}>AI Recognition Results</Text>
          <Text style={styles.screenSubtitle}>
            {items.length} faces detected and classified
          </Text>
        </View>
        <Pressable
          style={styles.addButtonMini}
          onPress={() => go("Verify Attendance")}
        >
          <MaterialCommunityIcons name="check-all" size={20} color="#fff" />
          <Text style={styles.addButtonMiniText}>Verify</Text>
        </Pressable>
      </View>

      <View style={styles.resultsNoticeCard}>
        <MaterialCommunityIcons name="information" size={20} color={theme.primaryLight} />
        <Text style={styles.resultsNoticeText}>
          Review initial AI matches. You can manually adjust any student's status on the verification roster.
        </Text>
      </View>

      {items.length === 0 ? (
        <EmptyState
          icon="face-recognition"
          title="No face recognitions logged"
          desc="Take or upload a group photo to populate automated detections."
          actionText="Take Attendance"
          onAction={() => go("Attendance")}
        />
      ) : (
        <View style={styles.resultsGrid}>
          {items.map((rec, i) => {
            const isPresent = String(rec.status || "").toLowerCase().includes("present");
            return (
              <View key={rec.student_id || i} style={styles.resultItemCard}>
                <View
                  style={[
                    styles.resultAvatarCircle,
                    { backgroundColor: isPresent ? theme.successPale : theme.dangerPale },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="account"
                    size={28}
                    color={isPresent ? theme.success : theme.danger}
                  />
                </View>
                <Text style={styles.resultItemName} numberOfLines={1}>
                  {rec.name || rec.student_id || "Student"}
                </Text>
                <Text style={styles.resultItemId}>{rec.student_id}</Text>
                <StatusPill
                  label={rec.status || (isPresent ? "Present" : "Absent")}
                  tone={isPresent ? "success" : "danger"}
                />
              </View>
            );
          })}
        </View>
      )}

      {items.length > 0 && (
        <Pressable
          style={[styles.primaryActionButton, { marginTop: 24 }]}
          onPress={() => go("Verify Attendance")}
        >
          <MaterialCommunityIcons name="account-check" size={20} color="#fff" />
          <Text style={styles.primaryActionText}>Proceed to Final Roster Verification</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// TEACHER: VERIFY & FINALIZE ATTENDANCE
// ---------------------------------------------------------------------------
function VerifyAttendanceView({ go }: { go: (x: string) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, "PRESENT" | "ABSENT">>({});
  const [sessionId, setSessionId] = useState("");
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    http
      .get("/teacher/attendance/report")
      .then((r) => {
        const records = r.data?.records || [];
        setItems(records);
        if (records.length > 0 && records[0].session_id) {
          setSessionId(records[0].session_id);
        }
        const initialMap: Record<string, "PRESENT" | "ABSENT"> = {};
        records.forEach((row: any) => {
          const isPres = String(row.status || "").toUpperCase() === "PRESENT";
          initialMap[row.student_id] = isPres ? "PRESENT" : "ABSENT";
        });
        setStatusMap(initialMap);
      })
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
  }, []);

  const toggleStatus = (studentId: string) => {
    setStatusMap((prev) => ({
      ...prev,
      [studentId]: prev[studentId] === "PRESENT" ? "ABSENT" : "PRESENT",
    }));
  };

  const finalizeAttendance = async () => {
    if (!sessionId) {
      Alert.alert("Missing Session", "Session identifier not found.");
      return;
    }
    setSubmitting(true);
    try {
      const records = Object.entries(statusMap).map(([student_id, status]) => ({
        student_id,
        status,
      }));

      await http.post("/teacher/attendance/finalize", {
        session_id: sessionId,
        records,
      });

      Alert.alert(
        "Attendance Finalized",
        "The finalized roster has been submitted and locked into university records.",
        [{ text: "View History", onPress: () => go("History") }]
      );
    } catch (e: any) {
      Alert.alert(
        "Submission Failed",
        e?.response?.data?.detail || "Could not finalize attendance records."
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (busy) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color={theme.primaryLight} />
        <Text style={styles.subtleText}>Loading Roster Checklist...</Text>
      </View>
    );
  }

  const presentCount = Object.values(statusMap).filter((s) => s === "PRESENT").length;
  const absentCount = Object.values(statusMap).filter((s) => s === "ABSENT").length;

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.screenHeader}>
        <View>
          <Text style={styles.screenTitle}>Verify & Finalize</Text>
          <Text style={styles.screenSubtitle}>
            Toggle student status before permanent submission
          </Text>
        </View>
      </View>

      {/* Roster Live Counter Banner */}
      <View style={styles.tallyCard}>
        <View style={styles.tallyItem}>
          <Text style={[styles.tallyVal, { color: theme.success }]}>{presentCount}</Text>
          <Text style={styles.tallyLbl}>Present</Text>
        </View>
        <View style={styles.tallyDivider} />
        <View style={styles.tallyItem}>
          <Text style={[styles.tallyVal, { color: theme.danger }]}>{absentCount}</Text>
          <Text style={styles.tallyLbl}>Absent</Text>
        </View>
        <View style={styles.tallyDivider} />
        <View style={styles.tallyItem}>
          <Text style={styles.tallyVal}>{items.length}</Text>
          <Text style={styles.tallyLbl}>Total Roster</Text>
        </View>
      </View>

      {/* Checklist Rows */}
      {items.map((student, i) => {
        const currentStatus = statusMap[student.student_id] || "ABSENT";
        const isPresent = currentStatus === "PRESENT";
        return (
          <View key={student.student_id || i} style={styles.verifyRowCard}>
            <View
              style={[
                styles.avatarCircle,
                { backgroundColor: isPresent ? theme.successPale : theme.dangerPale },
              ]}
            >
              <Text
                style={[
                  styles.avatarInitial,
                  { color: isPresent ? theme.success : theme.danger },
                ]}
              >
                {(student.name || "S").charAt(0).toUpperCase()}
              </Text>
            </View>

            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Text style={styles.verifyName}>{student.name || student.student_id}</Text>
              <Text style={styles.verifyMeta}>ID: {student.student_id}</Text>
            </View>

            <Pressable
              style={[
                styles.togglePill,
                isPresent ? styles.togglePillPresent : styles.togglePillAbsent,
              ]}
              onPress={() => toggleStatus(student.student_id)}
            >
              <MaterialCommunityIcons
                name={isPresent ? "check" : "close"}
                size={16}
                color={isPresent ? theme.success : theme.danger}
              />
              <Text
                style={[
                  styles.togglePillText,
                  { color: isPresent ? theme.success : theme.danger },
                ]}
              >
                {currentStatus}
              </Text>
            </Pressable>
          </View>
        );
      })}

      <Pressable
        style={[styles.primaryActionButton, submitting && { opacity: 0.7 }, { marginTop: 20 }]}
        onPress={finalizeAttendance}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <View style={styles.submitRow}>
            <MaterialCommunityIcons name="check-decagram" size={20} color="#fff" />
            <Text style={styles.primaryActionText}>Confirm & Lock Attendance</Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ADMIN ATTENDANCE LIVE
// ---------------------------------------------------------------------------
function AdminAttendanceView() {
  const [items, setItems] = useState<any[]>([]);
  const [date, setDate] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    http
      .get("/admin/attendance")
      .then((r) => setItems(r.data?.attendance || []))
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
  }, []);

  const dayLogs = items.filter(
    (x) => new Date(x.timestamp).toDateString() === date.toDateString()
  );
  const presentCount = dayLogs.filter(
    (x) => String(x.status || "PRESENT").toUpperCase() === "PRESENT"
  ).length;

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.screenHeader}>
        <View>
          <Text style={styles.screenTitle}>Attendance Audit</Text>
          <Text style={styles.screenSubtitle}>
            Daily biometric logs across all schools & sections
          </Text>
        </View>
      </View>

      {/* Date Picker Trigger Card */}
      <Pressable style={styles.datePickerTrigger} onPress={() => setShowPicker(true)}>
        <MaterialCommunityIcons name="calendar" size={22} color={theme.primaryLight} />
        <Text style={styles.datePickerText}>
          {date.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={20} color={theme.muted} />
      </Pressable>

      {showPicker && (
        <DateTimePicker
          value={date}
          mode="date"
          display="calendar"
          onChange={(_, d) => {
            setShowPicker(false);
            if (d) setDate(d);
          }}
        />
      )}

      {/* Daily Metrics */}
      <View style={styles.tallyCard}>
        <View style={styles.tallyItem}>
          <Text style={[styles.tallyVal, { color: theme.success }]}>{presentCount}</Text>
          <Text style={styles.tallyLbl}>Present</Text>
        </View>
        <View style={styles.tallyDivider} />
        <View style={styles.tallyItem}>
          <Text style={[styles.tallyVal, { color: theme.danger }]}>
            {dayLogs.length - presentCount}
          </Text>
          <Text style={styles.tallyLbl}>Absent</Text>
        </View>
        <View style={styles.tallyDivider} />
        <View style={styles.tallyItem}>
          <Text style={styles.tallyVal}>
            {dayLogs.length ? Math.round((presentCount / dayLogs.length) * 100) : 0}%
          </Text>
          <Text style={styles.tallyLbl}>Rate</Text>
        </View>
      </View>

      {busy ? (
        <ActivityIndicator size="large" color={theme.primaryLight} style={{ margin: 30 }} />
      ) : dayLogs.length === 0 ? (
        <EmptyState
          icon="calendar-remove-outline"
          title="No logs for this date"
          desc="No attendance records were found on this specific calendar day."
        />
      ) : (
        dayLogs.map((log, i) => (
          <View key={log.id || i} style={styles.directoryCard}>
            <View style={styles.avatarCircle}>
              <MaterialCommunityIcons name="account" size={22} color={theme.primaryLight} />
            </View>
            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Text style={styles.directoryName}>
                {log.name || log.student_id || "Student Attendance"}
              </Text>
              <Text style={styles.directoryId}>Session #{log.session_id}</Text>
            </View>
            <StatusPill
              label={log.status || "Present"}
              tone={
                String(log.status).toUpperCase() === "PRESENT" ? "success" : "danger"
              }
            />
          </View>
        ))
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// STUDENT ATTENDANCE LOGS
// ---------------------------------------------------------------------------
function StudentAttendanceView() {
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    http
      .get("/student/attendance-sessions")
      .then((r) => setItems(r.data?.sessions || []))
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
  }, []);

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.screenHeader}>
        <View>
          <Text style={styles.screenTitle}>My Attendance Logs</Text>
          <Text style={styles.screenSubtitle}>
            Personal verified attendance events
          </Text>
        </View>
      </View>

      {busy ? (
        <ActivityIndicator size="large" color={theme.primaryLight} style={{ margin: 30 }} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="calendar-check-outline"
          title="No recorded sessions"
          desc="Your attendance logs will populate once your instructors take attendance."
        />
      ) : (
        items.map((sess, i) => {
          const isPresent = String(sess.status).toUpperCase() === "PRESENT";
          return (
            <View key={sess.session_id || i} style={styles.studentLogCard}>
              <View
                style={[
                  styles.studentLogBadge,
                  { backgroundColor: isPresent ? theme.successPale : theme.dangerPale },
                ]}
              >
                <MaterialCommunityIcons
                  name={isPresent ? "check-bold" : "close-thick"}
                  size={18}
                  color={isPresent ? theme.success : theme.danger}
                />
              </View>
              <View style={{ flex: 1, paddingLeft: 12 }}>
                <Text style={styles.studentLogTitle}>{sess.title || sess.course}</Text>
                <Text style={styles.studentLogMeta}>
                  {sess.course} • {sess.department || "Academic Dept"}
                </Text>
                <Text style={styles.studentLogDate}>
                  {sess.event_date} • {String(sess.starts_at).slice(0, 5)} -{" "}
                  {String(sess.ends_at).slice(0, 5)}
                  {sess.room ? ` • ${sess.room}` : ""}
                </Text>
              </View>
              <StatusPill
                label={isPresent ? "Present" : "Absent"}
                tone={isPresent ? "success" : "danger"}
              />
            </View>
          );
        })
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// STUDENT CLASSES SCHEDULE
// ---------------------------------------------------------------------------
function StudentClassesView() {
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    http
      .get("/student/attendance-sessions")
      .then((r) => setItems(r.data?.sessions || []))
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
  }, []);

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.screenHeader}>
        <View>
          <Text style={styles.screenTitle}>My Timetable & Classes</Text>
          <Text style={styles.screenSubtitle}>
            Enrolled course schedule & lecture halls
          </Text>
        </View>
      </View>

      {busy ? (
        <ActivityIndicator size="large" color={theme.primaryLight} style={{ margin: 30 }} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="book-open-outline"
          title="No scheduled classes"
          desc="Your academic curriculum has no assigned classes right now."
        />
      ) : (
        items.map((cls, i) => (
          <View key={cls.session_id || i} style={styles.scheduleCard}>
            <View style={styles.scheduleTimeBox}>
              <Text style={styles.scheduleTimeText}>
                {String(cls.starts_at || "09:00").slice(0, 5)}
              </Text>
              <Text style={styles.scheduleTimeEnd}>
                {String(cls.ends_at || "10:00").slice(0, 5)}
              </Text>
            </View>
            <View style={{ flex: 1, paddingLeft: 12 }}>
              <Text style={styles.scheduleTitle}>{cls.title || cls.course}</Text>
              <Text style={styles.scheduleMeta}>
                {cls.room || "Room 101"} • {cls.program} • {cls.semester}
              </Text>
            </View>
            <View style={styles.roomTag}>
              <Text style={styles.roomTagText}>{cls.room || "Lab"}</Text>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ATTENDANCE HISTORY
// ---------------------------------------------------------------------------
function AttendanceHistoryView() {
  const [records, setRecords] = useState<any[]>([]);
  const [month, setMonth] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const monthStr = month.toISOString().slice(0, 7);
    setBusy(true);
    http
      .get("/teacher/attendance/report", { params: { month: monthStr } })
      .then((r) => setRecords(Array.isArray(r.data?.records) ? r.data.records : []))
      .catch(() => setRecords([]))
      .finally(() => setBusy(false));
  }, [month]);

  const sessions = Array.from(
    new Map(records.map((x) => [x.session_id, x])).values()
  );

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.screenHeader}>
        <View>
          <Text style={styles.screenTitle}>Attendance History</Text>
          <Text style={styles.screenSubtitle}>
            Past class sessions & verified student logs
          </Text>
        </View>
      </View>

      <Pressable style={styles.datePickerTrigger} onPress={() => setShowPicker(true)}>
        <MaterialCommunityIcons name="calendar-month" size={22} color={theme.primaryLight} />
        <Text style={styles.datePickerText}>
          {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={20} color={theme.muted} />
      </Pressable>

      {showPicker && (
        <DateTimePicker
          value={month}
          mode="date"
          display="calendar"
          onChange={(_, d) => {
            setShowPicker(false);
            if (d) setMonth(d);
          }}
        />
      )}

      {busy ? (
        <ActivityIndicator size="large" color={theme.primaryLight} style={{ margin: 30 }} />
      ) : sessions.length === 0 ? (
        <EmptyState
          icon="history"
          title="No sessions in this month"
          desc="Pick a different month or record new class sessions."
        />
      ) : (
        sessions.map((sess: any, i) => {
          const count = records.filter((r) => r.session_id === sess.session_id).length;
          return (
            <View key={sess.session_id || i} style={styles.directoryCard}>
              <View style={styles.avatarCircle}>
                <MaterialCommunityIcons name="calendar-check" size={22} color={theme.primaryLight} />
              </View>
              <View style={{ flex: 1, paddingHorizontal: 12 }}>
                <Text style={styles.directoryName}>
                  {sess.timestamp
                    ? new Date(sess.timestamp).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })
                    : `Session #${sess.session_id}`}
                </Text>
                <Text style={styles.directoryId}>Session ID: {sess.session_id}</Text>
                <Text style={styles.directoryMeta}>{count} registered students verified</Text>
              </View>
              <StatusPill label={`${count} students`} tone="info" />
            </View>
          );
        })
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// REPORTS & ANALYTICS VIEW
// ---------------------------------------------------------------------------
function ReportsView() {
  const [period, setPeriod] = useState("This Month");
  const [records, setRecords] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const month = period === "This Month" ? new Date().toISOString().slice(0, 7) : undefined;
    setBusy(true);
    http
      .get("/teacher/attendance/report", month ? { params: { month } } : undefined)
      .then((r) => setRecords(Array.isArray(r.data?.records) ? r.data.records : []))
      .catch(() => setRecords([]))
      .finally(() => setBusy(false));
  }, [period]);

  const sessions = Array.from(new Map(records.map((x) => [x.session_id, x])).values());
  const uniqueStudents = new Set(records.map((x) => x.student_id)).size;

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.screenHeader}>
        <View>
          <Text style={styles.screenTitle}>Attendance Analytics</Text>
          <Text style={styles.screenSubtitle}>
            Comprehensive university fidelity reporting
          </Text>
        </View>
      </View>

      {/* Period Segment Tabs */}
      <View style={styles.segmentContainer}>
        {["This Month", "This Week", "All Time"].map((tab) => (
          <Pressable
            key={tab}
            style={[styles.segmentTab, period === tab && styles.segmentTabActive]}
            onPress={() => setPeriod(tab)}
          >
            <Text style={[styles.segmentTabText, period === tab && styles.segmentTabTextActive]}>
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Report Cards */}
      <View style={styles.grid2x2}>
        <MetricCard
          label="Total Records"
          value={String(records.length)}
          sub="Verified attendances"
          icon="clipboard-text-outline"
          color={theme.primaryLight}
          bgColor={theme.primaryPale}
        />
        <MetricCard
          label="Sessions"
          value={String(sessions.length)}
          sub="Conducted classes"
          icon="calendar-check"
          color={theme.accent}
          bgColor={theme.accentLight}
        />
        <MetricCard
          label="Attendees"
          value={String(uniqueStudents)}
          sub="Unique students"
          icon="account-group"
          color={theme.success}
          bgColor={theme.successPale}
        />
        <MetricCard
          label="AI Model"
          value="v2.4"
          sub="InsightFace CUDA"
          icon="chip"
          color="#8B5CF6"
          bgColor="#F5F3FF"
        />
      </View>

      {busy ? (
        <ActivityIndicator size="large" color={theme.primaryLight} style={{ margin: 30 }} />
      ) : sessions.length === 0 ? (
        <EmptyState
          icon="chart-bar"
          title="No analytics recorded"
          desc="Analytics will accumulate as teachers run facial attendance sessions."
        />
      ) : (
        <View style={styles.formCard}>
          <Text style={styles.formCardTitle}>RECENT ATTENDANCE SESSIONS</Text>
          {sessions.map((sess: any, i) => (
            <View key={sess.session_id || i} style={styles.reportSessionRow}>
              <View style={styles.reportSessionIcon}>
                <MaterialCommunityIcons name="calendar-check" size={20} color={theme.primaryLight} />
              </View>
              <View style={{ flex: 1, paddingLeft: 10 }}>
                <Text style={styles.reportSessionTitle}>
                  {sess.timestamp ? new Date(sess.timestamp).toLocaleDateString() : "Session"}
                </Text>
                <Text style={styles.reportSessionSub}>Session #{sess.session_id}</Text>
              </View>
              <StatusPill
                label={`${records.filter((r) => r.session_id === sess.session_id).length} logs`}
                tone="info"
              />
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// NOTIFICATIONS & DISPATCHES
// ---------------------------------------------------------------------------
function NotificationsView() {
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);

  const fetchNotifs = () => {
    setBusy(true);
    http
      .get("/notifications")
      .then((r) => setItems(Array.isArray(r.data?.notifications) ? r.data.notifications : []))
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
  };

  useEffect(fetchNotifs, []);

  const markAllRead = async () => {
    try {
      await http.post("/notifications/read-all");
      fetchNotifs();
    } catch {}
  };

  const markOne = async (id: number) => {
    try {
      await http.post(`/notifications/${id}/read`);
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    } catch {}
  };

  const visible = items.filter((n) => filter === "all" || !n.is_read);

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.screenHeader}>
        <View>
          <Text style={styles.screenTitle}>Notifications</Text>
          <Text style={styles.screenSubtitle}>
            System dispatches & biometric alerts
          </Text>
        </View>
        <Pressable style={styles.markAllBtn} onPress={markAllRead}>
          <Text style={styles.markAllBtnText}>Mark all read</Text>
        </Pressable>
      </View>

      <View style={styles.segmentContainer}>
        <Pressable
          style={[styles.segmentTab, filter === "all" && styles.segmentTabActive]}
          onPress={() => setFilter("all")}
        >
          <Text style={[styles.segmentTabText, filter === "all" && styles.segmentTabTextActive]}>
            All ({items.length})
          </Text>
        </Pressable>
        <Pressable
          style={[styles.segmentTab, filter === "unread" && styles.segmentTabActive]}
          onPress={() => setFilter("unread")}
        >
          <Text style={[styles.segmentTabText, filter === "unread" && styles.segmentTabTextActive]}>
            Unread ({items.filter((x) => !x.is_read).length})
          </Text>
        </Pressable>
      </View>

      {busy ? (
        <ActivityIndicator size="large" color={theme.primaryLight} style={{ margin: 30 }} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon="bell-check-outline"
          title="All caught up!"
          desc="No new notifications require your attention."
        />
      ) : (
        visible.map((notif) => (
          <Pressable
            key={notif.id}
            style={[styles.notifCard, !notif.is_read && styles.notifCardUnread]}
            onPress={() => !notif.is_read && markOne(notif.id)}
          >
            <View
              style={[
                styles.notifIconCircle,
                {
                  backgroundColor:
                    notif.category === "alert" ? theme.dangerPale : theme.primaryPale,
                },
              ]}
            >
              <MaterialCommunityIcons
                name={
                  notif.category === "alert"
                    ? "alert-circle"
                    : notif.category === "attendance"
                      ? "calendar-check"
                      : "bell"
                }
                size={20}
                color={notif.category === "alert" ? theme.danger : theme.primaryLight}
              />
            </View>
            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Text style={styles.notifTitle}>{notif.title}</Text>
              <Text style={styles.notifBody}>{notif.body}</Text>
              <Text style={styles.notifTime}>
                {notif.created_at ? new Date(notif.created_at).toLocaleString() : ""}
              </Text>
            </View>
            {!notif.is_read && <View style={styles.unreadPill} />}
          </Pressable>
        ))
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ACADEMIC HIERARCHY TREE
// ---------------------------------------------------------------------------
function AcademicHierarchyView() {
  const [sections, setSections] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [expandedSchool, setExpandedSchool] = useState<string | null>(null);
  const [expandedFaculty, setExpandedFaculty] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    http
      .get("/academic/sections")
      .then((r) => setSections(r.data?.sections || []))
      .catch(() => setSections([]))
      .finally(() => setBusy(false));
  }, []);

  const visible = sections.filter((s) =>
    JSON.stringify(s).toLowerCase().includes(search.toLowerCase())
  );
  const schools = Array.from(new Set(visible.map((s) => s.school)));

  return (
    <View style={styles.screenWrapper}>
      <View style={styles.screenHeader}>
        <View>
          <Text style={styles.screenTitle}>Academic Hierarchy</Text>
          <Text style={styles.screenSubtitle}>
            Schools, Faculties, Departments & Programs
          </Text>
        </View>
      </View>

      <View style={styles.searchBar}>
        <MaterialCommunityIcons name="magnify" size={22} color={theme.muted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search academic branches..."
          placeholderTextColor={theme.muted}
        />
      </View>

      {busy ? (
        <ActivityIndicator size="large" color={theme.primaryLight} style={{ margin: 30 }} />
      ) : schools.length === 0 ? (
        <EmptyState
          icon="layers-outline"
          title="No academic sections found"
          desc="Academic hierarchy branches are managed by university administrators."
        />
      ) : (
        schools.map((school) => {
          const isSchoolOpen = expandedSchool === school || (!!search && schools.length === 1);
          const faculties = Array.from(
            new Set(visible.filter((x) => x.school === school).map((x) => x.faculty))
          );
          return (
            <View key={school} style={styles.hierarchyCard}>
              <Pressable
                style={styles.hierarchyCardHeader}
                onPress={() => setExpandedSchool(isSchoolOpen ? null : school)}
              >
                <MaterialCommunityIcons name="school" size={22} color={theme.primaryLight} />
                <Text style={styles.hierarchySchoolName}>{school}</Text>
                <View style={styles.hierarchyCountBadge}>
                  <Text style={styles.hierarchyCountText}>{faculties.length} Depts</Text>
                </View>
                <MaterialCommunityIcons
                  name={isSchoolOpen ? "chevron-up" : "chevron-down"}
                  size={20}
                  color={theme.muted}
                />
              </Pressable>

              {isSchoolOpen &&
                faculties.map((fac) => {
                  const key = `${school}:${fac}`;
                  const isFacOpen = expandedFaculty === key || (!!search && faculties.length === 1);
                  const programs = visible.filter((x) => x.school === school && x.faculty === fac);
                  return (
                    <View key={fac} style={styles.hierarchyFacultySection}>
                      <Pressable
                        style={styles.hierarchyFacultyHeader}
                        onPress={() => setExpandedFaculty(isFacOpen ? null : key)}
                      >
                        <MaterialCommunityIcons name="folder-outline" size={18} color={theme.text} />
                        <Text style={styles.hierarchyFacultyName}>{fac}</Text>
                        <MaterialCommunityIcons
                          name={isFacOpen ? "chevron-up" : "chevron-down"}
                          size={18}
                          color={theme.muted}
                        />
                      </Pressable>

                      {isFacOpen && (
                        <View style={styles.hierarchyProgramsList}>
                          {programs.map((prog, pIdx) => (
                            <View key={pIdx} style={styles.hierarchyProgramItem}>
                              <Text style={styles.hierarchyBullet}>•</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.hierarchyProgDept}>{prog.department}</Text>
                                <Text style={styles.hierarchyProgTitle}>
                                  {prog.program} • {prog.semester}
                                </Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}
            </View>
          );
        })
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// PROFILE SCREENS
// ---------------------------------------------------------------------------
function AdminProfile({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [profile, setProfile] = useState<any>(user);

  useEffect(() => {
    http
      .get("/auth/profile")
      .then((r) => setProfile(r.data?.profile || user))
      .catch(() => {});
  }, []);

  return (
    <View style={styles.screenWrapper}>
      <ProfileHeroCard profile={profile} role="ADMINISTRATOR" setProfile={setProfile} />

      <View style={styles.formCard}>
        <Text style={styles.formCardTitle}>ADMINISTRATIVE PRIVILEGES</Text>
        <DetailRow label="Role Access" value="Full System Superuser" />
        <DetailRow label="Username" value={profile.username || "admin"} />
        <DetailRow label="Email" value={profile.email || "admin@pratyaksh.edu"} />
        <DetailRow label="AI Server" value="NVIDIA GPU Accelerated (CUDA 12.4)" />
      </View>

      <Pressable style={styles.signOutButton} onPress={onLogout}>
        <MaterialCommunityIcons name="logout" size={20} color={theme.danger} />
        <Text style={styles.signOutButtonText}>Sign Out from Administrator</Text>
      </Pressable>
    </View>
  );
}

function TeacherProfile({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [profile, setProfile] = useState<any>(user);
  const [assignments, setAssignments] = useState<any[]>([]);

  useEffect(() => {
    http
      .get("/teacher/profile")
      .then((r) => {
        setProfile(r.data?.profile || user);
        setAssignments(r.data?.assignments || []);
      })
      .catch(() => {});
  }, []);

  return (
    <View style={styles.screenWrapper}>
      <ProfileHeroCard profile={profile} role="FACULTY INSTRUCTOR" setProfile={setProfile} />

      <View style={styles.formCard}>
        <Text style={styles.formCardTitle}>ASSIGNED COURSES & SECTIONS</Text>
        {assignments.length === 0 ? (
          <Text style={styles.subtleText}>No specific course sections assigned yet.</Text>
        ) : (
          assignments.map((item, i) => (
            <View key={i} style={styles.assignedSubjectRow}>
              <MaterialCommunityIcons name="book-outline" size={20} color={theme.primaryLight} />
              <View style={{ flex: 1, paddingLeft: 10 }}>
                <Text style={styles.assignedSubjectTitle}>{item.subject}</Text>
                <Text style={styles.assignedSubjectSub}>
                  {item.semester || "Semester"} • {item.students || 0} Students
                </Text>
              </View>
            </View>
          ))
        )}
      </View>

      <Pressable style={styles.signOutButton} onPress={onLogout}>
        <MaterialCommunityIcons name="logout" size={20} color={theme.danger} />
        <Text style={styles.signOutButtonText}>Sign Out Account</Text>
      </Pressable>
    </View>
  );
}

function StudentProfile({ user, onLogout }: { user: any; onLogout: () => void }) {
  const [profile, setProfile] = useState<any>(user);

  useEffect(() => {
    http
      .get("/auth/profile")
      .then((r) => setProfile(r.data?.profile || user))
      .catch(() => {});
  }, []);

  return (
    <View style={styles.screenWrapper}>
      <ProfileHeroCard profile={profile} role="STUDENT SCHOLAR" setProfile={setProfile} />

      <View style={styles.formCard}>
        <Text style={styles.formCardTitle}>ACADEMIC ENROLLMENT</Text>
        <DetailRow label="Student ID" value={profile.student_id || "STU-2026"} />
        <DetailRow label="Department" value={profile.department || "Engineering"} />
        <DetailRow label="Program" value={profile.program || "Computer Science"} />
        <DetailRow label="Semester" value={profile.semester || "Semester 4"} />
        <DetailRow label="Current GPA" value={String(profile.gpa || "3.85")} />
        <DetailRow
          label="Biometric Face ID"
          value={profile.face_registered ? "Verified & Registered" : "Active (Embedding Created)"}
        />
      </View>

      <Pressable style={styles.signOutButton} onPress={onLogout}>
        <MaterialCommunityIcons name="logout" size={20} color={theme.danger} />
        <Text style={styles.signOutButtonText}>Sign Out Account</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// REUSABLE HELPER UI PRIMITIVES
// ---------------------------------------------------------------------------
function ProfileHeroCard({
  profile,
  role,
  setProfile,
}: {
  profile: any;
  role: string;
  setProfile: (p: any) => void;
}) {
  const choosePhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    const asset = res.assets[0];
    const form = new FormData();
    form.append("file", {
      uri: asset.uri,
      name: "profile.jpg",
      type: asset.mimeType || "image/jpeg",
    } as any);
    try {
      await http.post("/auth/profile/photo", form);
      setProfile({ ...profile, profile_photo_base64: asset.uri });
      Alert.alert("Success", "Profile photo updated successfully.");
    } catch {
      Alert.alert("Error", "Could not upload profile photo.");
    }
  };

  const name =
    profile.display_name || profile.name || profile.username || "University Member";

  return (
    <View style={styles.profileHeroCard}>
      <Pressable onPress={choosePhoto} style={styles.profileHeroAvatarWrap}>
        {profile.profile_photo_base64 ? (
          <Image
            source={{ uri: profile.profile_photo_base64 }}
            style={styles.profileHeroAvatarImg}
          />
        ) : (
          <View style={styles.profileHeroAvatarFallback}>
            <Text style={styles.profileHeroAvatarInitial}>
              {name.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={styles.avatarEditPill}>
          <MaterialCommunityIcons name="camera" size={12} color="#fff" />
        </View>
      </Pressable>

      <Text style={styles.profileHeroName}>{name}</Text>
      <View style={styles.profileHeroRoleTag}>
        <Text style={styles.profileHeroRoleText}>{role}</Text>
      </View>
      <Text style={styles.profileHeroEmail}>
        {profile.email || `${profile.username || "user"}@university.edu`}
      </Text>
    </View>
  );
}

function MetricCard({
  label,
  value,
  sub,
  icon,
  color,
  bgColor,
}: {
  label: string;
  value: string;
  sub: string;
  icon: string;
  color: string;
  bgColor: string;
}) {
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricIconCircle, { backgroundColor: bgColor }]}>
        <MaterialCommunityIcons name={icon as any} size={22} color={color} />
      </View>
      <Text style={styles.metricCardValue}>{value}</Text>
      <Text style={styles.metricCardLabel}>{label}</Text>
      <Text style={styles.metricCardSub}>{sub}</Text>
    </View>
  );
}

function QuickActionButton({
  title,
  desc,
  icon,
  color,
  onPress,
}: {
  title: string;
  desc: string;
  icon: string;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.quickActionCard} onPress={onPress}>
      <View style={[styles.quickActionIconWrap, { backgroundColor: `${color}15` }]}>
        <MaterialCommunityIcons name={icon as any} size={24} color={color} />
      </View>
      <Text style={styles.quickActionTitle}>{title}</Text>
      <Text style={styles.quickActionDesc}>{desc}</Text>
    </Pressable>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "danger" | "warning" | "info" | "neutral";
}) {
  const bg =
    tone === "success"
      ? theme.successPale
      : tone === "danger"
        ? theme.dangerPale
        : tone === "warning"
          ? theme.warningPale
          : tone === "info"
            ? theme.infoPale
            : theme.surfaceAlt;
  const fg =
    tone === "success"
      ? theme.success
      : tone === "danger"
        ? theme.danger
        : tone === "warning"
          ? theme.warning
          : tone === "info"
            ? theme.info
            : theme.textSecondary;
  return (
    <View style={[styles.statusPill, { backgroundColor: bg }]}>
      <Text style={[styles.statusPillText, { color: fg }]}>{label}</Text>
    </View>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function EmptyState({
  icon,
  title,
  desc,
  actionText,
  onAction,
}: {
  icon: string;
  title: string;
  desc: string;
  actionText?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.emptyStateCard}>
      <View style={styles.emptyIconCircle}>
        <MaterialCommunityIcons name={icon as any} size={36} color={theme.muted} />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDesc}>{desc}</Text>
      {!!actionText && !!onAction && (
        <Pressable style={styles.emptyActionBtn} onPress={onAction}>
          <Text style={styles.emptyActionText}>{actionText}</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ACADEMIC CASCADE FILTER / SELECTION
// ---------------------------------------------------------------------------
function AcademicCascade({
  onApply,
  onSectionChange,
}: {
  onApply?: (selection: any) => void;
  onSectionChange?: (sectionId: number | null) => void;
}) {
  const [sections, setSections] = useState<any[]>([]);
  const [selection, setSelection] = useState<any>({});
  const [modalOpen, setModalOpen] = useState<string | null>(null);

  useEffect(() => {
    http
      .get("/academic/sections")
      .then((r) => setSections(r.data?.sections || []))
      .catch(() => setSections([]));
  }, []);

  const getOptions = (key: string, filters: any = {}) => {
    return Array.from(
      new Set(
        sections
          .filter((x) =>
            Object.entries(filters).every(
              ([k, v]: any) => !v?.length || v.includes(x[k])
            )
          )
          .map((x) => x[key])
          .filter(Boolean)
      )
    ) as string[];
  };

  const renderSelect = (label: string, fieldKey: string, options: string[], disabled = false) => {
    const selectedValue = selection[fieldKey] || `Select ${label}`;
    return (
      <View key={fieldKey} style={styles.formGroup}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Pressable
          disabled={disabled || !options.length}
          style={[
            styles.selectTrigger,
            (disabled || !options.length) && styles.selectTriggerDisabled,
          ]}
          onPress={() => setModalOpen(fieldKey)}
        >
          <Text
            style={[
              styles.selectTriggerText,
              (disabled || !options.length) && { color: theme.muted },
            ]}
          >
            {selectedValue}
          </Text>
          <MaterialCommunityIcons
            name="chevron-down"
            size={20}
            color={disabled ? theme.border : theme.primaryLight}
          />
        </Pressable>

        {modalOpen === fieldKey && (
          <Modal
            transparent
            visible
            animationType="fade"
            onRequestClose={() => setModalOpen(null)}
          >
            <Pressable style={styles.modalOverlay} onPress={() => setModalOpen(null)}>
              <Pressable style={styles.dropdownModal} onPress={(e) => e.stopPropagation()}>
                <Text style={styles.dropdownTitle}>Select {label}</Text>
                <ScrollView style={{ maxHeight: 250 }} keyboardShouldPersistTaps="handled">
                  {options.map((opt) => (
                    <Pressable
                      key={opt}
                      style={styles.dropdownOption}
                      onPress={() => {
                        setSelection((prev: any) => ({
                          ...prev,
                          [fieldKey]: opt,
                          ...(fieldKey === "school"
                            ? { faculty: "", department: "", program: "", semester: "", section: "" }
                            : fieldKey === "faculty"
                              ? { department: "", program: "", semester: "", section: "" }
                              : fieldKey === "department"
                                ? { program: "", semester: "", section: "" }
                                : fieldKey === "program"
                                  ? { semester: "", section: "" }
                                  : fieldKey === "semester"
                                    ? { section: "" }
                                  : {}),
                        }));
                        setModalOpen(null);
                      }}
                    >
                      <Text style={styles.dropdownOptionText}>{opt}</Text>
                      {selection[fieldKey] === opt && (
                        <MaterialCommunityIcons name="check" size={18} color={theme.primaryLight} />
                      )}
                    </Pressable>
                  ))}
                </ScrollView>
              </Pressable>
            </Pressable>
          </Modal>
        )}
      </View>
    );
  };

  const has = !!selection.school;

  useEffect(() => {
    const match = sections.find(
      (section) =>
        section.school === selection.school &&
        section.faculty === selection.faculty &&
        section.department === selection.department &&
        section.program === selection.program &&
        section.semester === selection.semester &&
        section.section === selection.section
    );
    onSectionChange?.(match?.id ?? null);
  }, [sections, selection, onSectionChange]);

  return (
    <View style={{ marginTop: 12 }}>
      <Text style={styles.formCardTitle}>ACADEMIC PLACEMENT</Text>
      {renderSelect("School", "school", getOptions("school"))}
      {renderSelect(
        "Faculty",
        "faculty",
        getOptions("faculty", { school: selection.school }),
        !selection.school
      )}
      {renderSelect(
        "Department",
        "department",
        getOptions("department", { school: selection.school, faculty: selection.faculty }),
        !selection.faculty
      )}
      {renderSelect(
        "Program / Course",
        "program",
        getOptions("program", {
          school: selection.school,
          faculty: selection.faculty,
          department: selection.department,
        }),
        !selection.department
      )}
      {renderSelect(
        "Semester",
        "semester",
        getOptions("semester", {
          school: selection.school,
          faculty: selection.faculty,
          department: selection.department,
          program: selection.program,
        }),
        !selection.program
      )}
      {renderSelect(
        "Section",
        "section",
        getOptions("section", {
          school: selection.school,
          faculty: selection.faculty,
          department: selection.department,
          program: selection.program,
          semester: selection.semester,
        }),
        !selection.semester
      )}

      {onApply && (
        <Pressable
          disabled={!has}
          style={[styles.applyFilterButton, !has && { opacity: 0.5 }]}
          onPress={() => onApply(selection)}
        >
          <MaterialCommunityIcons name="filter-check" size={18} color="#fff" />
          <Text style={styles.applyFilterButtonText}>Apply Filters</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// TEACHER HIERARCHY CHECKBOXES
// ---------------------------------------------------------------------------
function TeacherHierarchyCheckboxes({
  selected,
  onChange,
  onScopeChange,
}: {
  selected: number[];
  onChange: (ids: number[]) => void;
  onScopeChange?: (scope: any) => void;
}) {
  const [sections, setSections] = useState<any[]>([]);
  const [selection, setSelection] = useState<any>({
    school: [],
    faculty: [],
    department: [],
    program: [],
    semester: [],
  });

  useEffect(() => {
    http
      .get("/academic/sections")
      .then((r) => setSections(r.data?.sections || []))
      .catch(() => setSections([]));
  }, []);

  const getOptions = (key: string, filters: any = {}) => {
    return Array.from(
      new Set(
        sections
          .filter((x) =>
            Object.entries(filters).every(
              ([k, v]: any) => !v?.length || v.includes(x[k])
            )
          )
          .map((x) => x[key])
          .filter(Boolean)
      )
    ) as string[];
  };

  const toggle = (key: string, val: string) => {
    const next = {
      ...selection,
      [key]: selection[key].includes(val)
        ? selection[key].filter((v: string) => v !== val)
        : [...selection[key], val],
    };
    if (key === "school") Object.assign(next, { faculty: [], department: [], program: [], semester: [] });
    if (key === "faculty") Object.assign(next, { department: [], program: [], semester: [] });
    if (key === "department") Object.assign(next, { program: [], semester: [] });
    if (key === "program") next.semester = [];
    setSelection(next);
    onScopeChange?.(next);
    const ids = sections
      .filter((s) =>
        Object.entries(next).every(
          ([k, v]: any) => !v?.length || v.includes(s[k])
        )
      )
      .map((s) => s.id);
    onChange(ids);
  };

  const renderPhase = (label: string, fieldKey: string, opts: string[]) => (
    <View key={fieldKey} style={{ marginBottom: 12 }}>
      <Text style={styles.phaseLabel}>{label}</Text>
      <View style={styles.phaseOptionsRow}>
        {opts.map((opt) => {
          const isSelected = selection[fieldKey].includes(opt);
          return (
            <Pressable
              key={opt}
              style={[styles.phaseOptionChip, isSelected && styles.phaseOptionChipActive]}
              onPress={() => toggle(fieldKey, opt)}
            >
              <MaterialCommunityIcons
                name={isSelected ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"}
                size={16}
                color={isSelected ? theme.primaryLight : theme.muted}
              />
              <Text style={[styles.phaseOptionText, isSelected && styles.phaseOptionTextActive]}>
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={styles.hierarchyCheckboxBox}>
      <Text style={styles.formCardTitle}>ACADEMIC ACCESS SCOPE</Text>
      <Text style={styles.hierarchyAccessSub}>
        Progressively select programs and semesters this teacher manages:
      </Text>
      {renderPhase("1. Select School", "school", getOptions("school"))}
      {selection.school.length > 0 &&
        renderPhase("2. Select Faculty", "faculty", getOptions("faculty", { school: selection.school }))}
      {selection.faculty.length > 0 &&
        renderPhase(
          "3. Select Department",
          "department",
          getOptions("department", { school: selection.school, faculty: selection.faculty })
        )}
      {selection.department.length > 0 &&
        renderPhase(
          "4. Select Program",
          "program",
          getOptions("program", {
            school: selection.school,
            faculty: selection.faculty,
            department: selection.department,
          })
        )}
      {selection.program.length > 0 &&
        renderPhase(
          "5. Select Semester",
          "semester",
          getOptions("semester", {
            school: selection.school,
            faculty: selection.faculty,
            department: selection.department,
            program: selection.program,
          })
        )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// STYLESHEET: MODERN, POLISHED, WORLD-CLASS MOBILE STYLES
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.bg,
    // Android's SafeAreaView does not apply insets. Keep controls out of a
    // status bar when Android edge-to-edge is enabled.
    paddingTop: Platform.OS === "android" ? NativeStatusBar.currentHeight || 0 : 0,
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingCard: {
    alignItems: "center",
    padding: 32,
    borderRadius: 24,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: theme.primaryDark,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  splashLogo: {
    width: 90,
    height: 90,
    borderRadius: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 15,
    fontWeight: "700",
    color: theme.textSecondary,
  },
  centerContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 50,
  },
  subtleText: {
    marginTop: 12,
    fontSize: 14,
    color: theme.muted,
  },

  // LOGIN SCREEN
  loginScroll: {
    paddingHorizontal: 20,
    paddingTop: 36,
    paddingBottom: 40,
    alignItems: "center",
  },
  loginHeader: {
    alignItems: "center",
    marginBottom: 28,
  },
  logoBadgeContainer: {
    width: 84,
    height: 84,
    borderRadius: 24,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: theme.primaryLight,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 4,
  },
  loginLogo: {
    width: 72,
    height: 72,
    borderRadius: 18,
  },
  brandTitle: {
    fontSize: 32,
    fontWeight: "900",
    color: theme.primary,
    marginTop: 14,
    letterSpacing: -0.6,
  },
  brandPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.primaryPale,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    marginTop: 6,
    gap: 6,
  },
  brandPillText: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.primaryLight,
  },
  loginCard: {
    width: "100%",
    backgroundColor: theme.surface,
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: theme.primaryDark,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 3,
  },
  cardHeaderTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: theme.text,
    letterSpacing: -0.3,
  },
  cardHeaderSubtitle: {
    fontSize: 13,
    color: theme.textSecondary,
    marginTop: 4,
    marginBottom: 18,
  },
  roleTabsContainer: {
    flexDirection: "row",
    backgroundColor: theme.surfaceAlt,
    borderRadius: 14,
    padding: 4,
    marginBottom: 20,
  },
  roleTab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6,
  },
  roleTabActive: {
    backgroundColor: theme.surface,
    shadowColor: theme.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
  },
  roleTabText: {
    fontSize: 13,
    fontWeight: "700",
    color: theme.muted,
  },
  roleTabTextActive: {
    color: theme.primaryLight,
  },
  formGroup: {
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.textSecondary,
    marginBottom: 6,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  inputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 14,
    height: 50,
  },
  inputIcon: {
    marginRight: 10,
  },
  textInput: {
    flex: 1,
    fontSize: 15,
    color: theme.text,
    fontWeight: "600",
  },
  textInputPlain: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 15,
    color: theme.text,
    fontWeight: "600",
  },
  eyeButton: {
    padding: 6,
  },
  errorBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.dangerPale,
    borderWidth: 1,
    borderColor: theme.dangerBorder,
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    gap: 8,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    color: theme.danger,
    fontWeight: "600",
  },
  submitButton: {
    backgroundColor: theme.primary,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: theme.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 3,
  },
  submitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  submitText: {
    fontSize: 15,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.2,
  },
  demoBox: {
    marginTop: 24,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    alignItems: "center",
  },
  demoTitle: {
    fontSize: 10,
    fontWeight: "900",
    color: theme.muted,
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  demoChipRow: {
    flexDirection: "row",
    gap: 8,
  },
  demoChip: {
    backgroundColor: theme.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  demoChipText: {
    fontSize: 11,
    fontWeight: "800",
    color: theme.textSecondary,
  },
  loginFooter: {
    marginTop: 24,
    fontSize: 11,
    color: theme.muted,
    textAlign: "center",
  },

  // TOP BAR
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 12,
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  topBarLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  topBarIdentity: {
    flex: 1,
    minWidth: 0,
  },
  brandMiniBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
  },
  brandMiniLogo: {
    width: 32,
    height: 32,
    borderRadius: 8,
  },
  topBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  topBrandName: {
    fontSize: 17,
    fontWeight: "900",
    color: theme.primary,
    letterSpacing: -0.3,
  },
  roleTag: {
    backgroundColor: theme.primaryPale,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  roleTagText: {
    fontSize: 9,
    fontWeight: "900",
    color: theme.primaryLight,
  },
  topGreeting: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.muted,
  },
  topBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: theme.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  iconButtonActive: {
    backgroundColor: theme.primaryPale,
  },
  unreadDot: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.danger,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  avatarPill: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarPillActive: {
    borderWidth: 2,
    borderColor: theme.accent,
  },
  avatarImg: {
    width: "100%",
    height: "100%",
  },
  avatarInitial: {
    fontSize: 15,
    fontWeight: "900",
    color: "#fff",
  },

  // MAIN CONTENT & BOTTOM NAV
  mainContent: {
    flexGrow: 1,
    padding: 16,
    paddingBottom: 28,
  },
  bottomNav: {
    flexDirection: "row",
    backgroundColor: theme.surface,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingTop: 8,
    paddingBottom: Platform.OS === "android" ? 12 : 8,
    paddingHorizontal: 8,
    justifyContent: "space-around",
    shadowColor: theme.primaryDark,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 8,
  },
  bottomNavItem: {
    alignItems: "center",
    flex: 1,
  },
  bottomNavIconWrap: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 14,
  },
  bottomNavIconWrapActive: {
    backgroundColor: theme.primaryPale,
  },
  bottomNavText: {
    fontSize: 10,
    fontWeight: "700",
    color: theme.muted,
    marginTop: 2,
  },
  bottomNavTextActive: {
    color: theme.primaryLight,
    fontWeight: "900",
  },

  // COMMON SCREEN HEADERS & WRAPPERS
  screenWrapper: {
    gap: 16,
  },
  screenHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  screenTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: theme.text,
    letterSpacing: -0.4,
  },
  screenSubtitle: {
    fontSize: 13,
    color: theme.muted,
    marginTop: 2,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: "900",
    color: theme.muted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginTop: 8,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  seeAllLink: {
    fontSize: 13,
    fontWeight: "800",
    color: theme.primaryLight,
  },

  // HERO CARDS
  adminHeroCard: {
    backgroundColor: theme.primary,
    borderRadius: 20,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: theme.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 4,
  },
  systemStatusPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: "flex-start",
    marginBottom: 8,
    gap: 6,
  },
  liveIndicatorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.success,
  },
  systemStatusText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#fff",
  },
  adminHeroTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: -0.3,
  },
  adminHeroSubtitle: {
    fontSize: 12,
    color: "#D9E3F8",
    marginTop: 4,
    lineHeight: 16,
  },
  heroIconBox: {
    width: 54,
    height: 54,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 12,
  },

  teacherHeroCard: {
    backgroundColor: theme.primary,
    borderRadius: 20,
    padding: 20,
    shadowColor: theme.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 4,
  },
  teacherBadgePill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    alignSelf: "flex-start",
    marginBottom: 10,
    gap: 6,
  },
  teacherBadgeText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#fff",
  },
  teacherHeroTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: "#fff",
  },
  teacherHeroSub: {
    fontSize: 13,
    color: "#E2E8F0",
    marginTop: 4,
    lineHeight: 18,
    marginBottom: 16,
  },
  heroCTAButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.accent,
    borderRadius: 12,
    paddingVertical: 12,
    gap: 8,
  },
  heroCTAText: {
    fontSize: 14,
    fontWeight: "900",
    color: theme.primaryDark,
  },

  // METRICS & KPIS
  grid2x2: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  metricCard: {
    flexBasis: "48%",
    flexGrow: 1,
    minWidth: 0,
    backgroundColor: theme.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: theme.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  metricIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  metricCardValue: {
    fontSize: 24,
    fontWeight: "900",
    color: theme.text,
    letterSpacing: -0.5,
  },
  metricCardLabel: {
    fontSize: 13,
    fontWeight: "800",
    color: theme.textSecondary,
    marginTop: 2,
  },
  metricCardSub: {
    fontSize: 11,
    color: theme.muted,
    marginTop: 2,
  },

  // QUICK ACTIONS
  quickActionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  quickActionCard: {
    flexBasis: "48%",
    flexGrow: 1,
    minWidth: 0,
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
  },
  quickActionIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  quickActionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.text,
  },
  quickActionDesc: {
    fontSize: 11,
    color: theme.muted,
    marginTop: 2,
  },

  // ACTIVITY ROWS & DIRECTORY CARDS
  activityRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  activityIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  activityTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.text,
  },
  activitySubtitle: {
    fontSize: 12,
    color: theme.muted,
    marginTop: 2,
  },
  directoryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: theme.primaryDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  avatarCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.primaryPale,
    alignItems: "center",
    justifyContent: "center",
  },
  directoryName: {
    fontSize: 15,
    fontWeight: "800",
    color: theme.text,
  },
  directoryId: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.primaryLight,
    marginTop: 2,
  },
  directoryMeta: {
    fontSize: 12,
    color: theme.muted,
    marginTop: 1,
  },

  // SEARCH & FILTERS
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 12,
    height: 48,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: theme.text,
    fontWeight: "600",
    marginLeft: 8,
  },
  filterToggleBtn: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
  },
  filterToggleBtnActive: {
    backgroundColor: theme.primaryLight,
    borderColor: theme.primaryLight,
  },
  filterCascadeCard: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: theme.border,
  },
  addButtonMini: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.primaryLight,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    gap: 4,
  },
  addButtonMiniText: {
    fontSize: 12,
    fontWeight: "800",
    color: "#fff",
  },

  // FORMS & CARDS
  formCard: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: theme.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  formCardTitle: {
    fontSize: 11,
    fontWeight: "900",
    color: theme.muted,
    letterSpacing: 0.8,
    marginBottom: 12,
  },
  formHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  backButtonCircle: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
  },
  formButtonsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginTop: 20,
  },
  cancelButton: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.textSecondary,
  },
  saveButton: {
    flex: 2,
    height: 48,
    borderRadius: 12,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  saveButtonText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#fff",
  },
  twoColumnRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },

  // BIOMETRICS PROMPT CARD
  biometricPromptCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surfaceAlt,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderColor: theme.border,
    borderStyle: "dashed",
    marginTop: 6,
    marginBottom: 10,
  },
  biometricPromptCardSuccess: {
    backgroundColor: theme.successPale,
    borderColor: theme.success,
    borderStyle: "solid",
  },
  biometricIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: theme.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  biometricTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.text,
  },
  biometricSub: {
    fontSize: 12,
    color: theme.muted,
    marginTop: 2,
  },

  // HUD BIOMETRIC CAMERA
  hudStepsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  hudStepItem: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: theme.surface,
    borderWidth: 1.5,
    borderColor: theme.border,
    alignItems: "center",
    justifyContent: "center",
  },
  hudStepItemActive: {
    borderColor: theme.primaryLight,
    backgroundColor: theme.primaryPale,
  },
  hudStepItemDone: {
    borderColor: theme.success,
    backgroundColor: theme.successPale,
  },
  hudStepText: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.muted,
  },
  hudStepTextActive: {
    color: theme.primaryLight,
  },
  hudStepTextDone: {
    color: theme.success,
  },
  hudCameraCard: {
    backgroundColor: "#0B1120",
    borderRadius: 24,
    overflow: "hidden",
    height: 380,
    borderWidth: 2,
    borderColor: "#1E293B",
  },
  hudCameraError: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraWrapper: {
    flex: 1,
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  cameraPreview: {
    ...StyleSheet.absoluteFillObject,
  },
  hudOvalGuide: {
    width: 210,
    height: 290,
    borderRadius: 110,
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.4)",
    borderStyle: "dashed",
  },
  hudOvalGuideDetected: {
    borderColor: theme.success,
    borderStyle: "solid",
    shadowColor: theme.success,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 10,
  },
  hudOvalGuideScanning: {
    borderColor: theme.accent,
  },
  hudStatusTag: {
    position: "absolute",
    bottom: 16,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.85)",
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    gap: 8,
  },
  hudStatusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  hudStatusTagText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  hudGuideCard: {
    backgroundColor: theme.surface,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: theme.border,
  },
  hudGuideTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: theme.text,
  },
  hudGuideDesc: {
    fontSize: 13,
    color: theme.textSecondary,
    marginTop: 4,
    lineHeight: 18,
    marginBottom: 16,
  },
  hudManualCaptureBtn: {
    backgroundColor: theme.primary,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  hudManualRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  hudManualBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#fff",
  },
  cameraPermissionCard: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    textAlign: "center",
    borderWidth: 1,
    borderColor: theme.border,
  },
  cameraPermTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: theme.text,
    marginTop: 14,
  },
  cameraPermDesc: {
    fontSize: 13,
    color: theme.muted,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 18,
  },

  // TEACHER ATTENDANCE ACTIONS
  sectionSummaryCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.primaryPale,
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  sectionSummaryTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: theme.primaryLight,
  },
  sectionSummarySub: {
    fontSize: 11,
    color: theme.textSecondary,
    marginTop: 2,
  },
  photoCaptureButtonsWrap: {
    gap: 12,
  },
  photoActionButton: {
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraBtn: {
    backgroundColor: theme.primaryLight,
  },
  galleryBtn: {
    backgroundColor: theme.surfaceAlt,
    borderWidth: 1,
    borderColor: theme.border,
  },
  photoActionTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: "#fff",
    marginTop: 8,
  },
  photoActionSub: {
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
    marginTop: 2,
  },

  // RECOGNITION RESULTS & VERIFY
  resultsNoticeCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.primaryPale,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  resultsNoticeText: {
    flex: 1,
    fontSize: 12,
    color: theme.primaryLight,
    fontWeight: "600",
    lineHeight: 16,
  },
  resultsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  resultItemCard: {
    flexBasis: "48%",
    flexGrow: 1,
    minWidth: 0,
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
  },
  resultAvatarCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  resultItemName: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.text,
    textAlign: "center",
  },
  resultItemId: {
    fontSize: 11,
    color: theme.muted,
    marginTop: 1,
    marginBottom: 8,
  },
  tallyCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
    justifyContent: "space-around",
  },
  tallyItem: {
    alignItems: "center",
  },
  tallyVal: {
    fontSize: 22,
    fontWeight: "900",
    color: theme.text,
  },
  tallyLbl: {
    fontSize: 11,
    color: theme.muted,
    fontWeight: "700",
    marginTop: 2,
  },
  tallyDivider: {
    width: 1,
    height: 32,
    backgroundColor: theme.border,
  },
  verifyRowCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  verifyName: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.text,
  },
  verifyMeta: {
    fontSize: 12,
    color: theme.muted,
    marginTop: 1,
  },
  togglePill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    gap: 4,
    borderWidth: 1,
  },
  togglePillPresent: {
    backgroundColor: theme.successPale,
    borderColor: theme.successBorder,
  },
  togglePillAbsent: {
    backgroundColor: theme.dangerPale,
    borderColor: theme.dangerBorder,
  },
  togglePillText: {
    fontSize: 12,
    fontWeight: "800",
  },

  // STUDENT SCORE CARD & METRICS
  studentScoreCard: {
    backgroundColor: theme.surface,
    borderRadius: 22,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.border,
    gap: 18,
    shadowColor: theme.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  studentDialWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  studentDialCircle: {
    width: 90,
    height: 90,
    borderRadius: 45,
    borderWidth: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  studentDialPercent: {
    fontSize: 22,
    fontWeight: "900",
    color: theme.text,
  },
  studentDialLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: theme.muted,
  },
  studentScoreTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: theme.text,
    marginBottom: 6,
  },
  studentScoreSub: {
    fontSize: 12,
    color: theme.muted,
    marginTop: 6,
  },
  studentStatsGrid: {
    flexDirection: "row",
    gap: 10,
  },
  studentStatBox: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
  },
  studentStatVal: {
    fontSize: 22,
    fontWeight: "900",
    color: theme.text,
  },
  studentStatLbl: {
    fontSize: 11,
    fontWeight: "700",
    color: theme.muted,
    marginTop: 2,
  },
  primaryActionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.primary,
    height: 50,
    borderRadius: 14,
    gap: 8,
    shadowColor: theme.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 2,
  },
  primaryActionText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#fff",
  },

  // SCHEDULE CARDS
  scheduleCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
  },
  scheduleTimeBox: {
    backgroundColor: theme.surfaceAlt,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center",
  },
  scheduleTimeText: {
    fontSize: 13,
    fontWeight: "900",
    color: theme.primary,
  },
  scheduleTimeEnd: {
    fontSize: 10,
    color: theme.muted,
    marginTop: 1,
  },
  scheduleTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.text,
  },
  scheduleMeta: {
    fontSize: 12,
    color: theme.muted,
    marginTop: 2,
  },
  scheduleArrowBox: {
    padding: 4,
  },
  roomTag: {
    backgroundColor: theme.primaryPale,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  roomTagText: {
    fontSize: 11,
    fontWeight: "800",
    color: theme.primaryLight,
  },
  horizontalMetricsRow: {
    flexDirection: "row",
    gap: 10,
  },
  teacherMetricCard: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: "center",
  },
  teacherMetricVal: {
    fontSize: 20,
    fontWeight: "900",
    color: theme.text,
    marginTop: 6,
  },
  teacherMetricLbl: {
    fontSize: 10,
    fontWeight: "700",
    color: theme.muted,
    marginTop: 2,
    textAlign: "center",
  },

  // STUDENT LOG CARDS
  studentLogCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
  },
  studentLogBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  studentLogTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.text,
  },
  studentLogMeta: {
    fontSize: 12,
    color: theme.textSecondary,
    marginTop: 1,
  },
  studentLogDate: {
    fontSize: 11,
    color: theme.muted,
    marginTop: 2,
  },

  // DATE PICKERS & TRIGGERS
  datePickerTrigger: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
    justifyContent: "space-between",
  },
  datePickerText: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.text,
    flex: 1,
    paddingLeft: 10,
  },

  // SEGMENTS
  segmentContainer: {
    flexDirection: "row",
    backgroundColor: theme.surfaceAlt,
    borderRadius: 12,
    padding: 4,
  },
  segmentTab: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 10,
  },
  segmentTabActive: {
    backgroundColor: theme.surface,
    shadowColor: theme.primaryDark,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 1,
  },
  segmentTabText: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.muted,
  },
  segmentTabTextActive: {
    color: theme.primaryLight,
    fontWeight: "800",
  },

  // NOTIFICATIONS
  markAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: theme.surfaceAlt,
  },
  markAllBtnText: {
    fontSize: 11,
    fontWeight: "800",
    color: theme.primaryLight,
  },
  notifCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: theme.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: theme.border,
  },
  notifCardUnread: {
    borderColor: theme.primaryLight,
    backgroundColor: "#F9FBFF",
  },
  notifIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  notifTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.text,
  },
  notifBody: {
    fontSize: 12,
    color: theme.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  notifTime: {
    fontSize: 10,
    color: theme.muted,
    marginTop: 4,
  },
  unreadPill: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.primaryLight,
    marginTop: 4,
  },

  // ACADEMIC HIERARCHY
  hierarchyCard: {
    backgroundColor: theme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: "hidden",
  },
  hierarchyCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
    gap: 10,
  },
  hierarchySchoolName: {
    flex: 1,
    fontSize: 15,
    fontWeight: "900",
    color: theme.text,
  },
  hierarchyCountBadge: {
    backgroundColor: theme.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  hierarchyCountText: {
    fontSize: 11,
    fontWeight: "800",
    color: theme.muted,
  },
  hierarchyFacultySection: {
    borderTopWidth: 1,
    borderTopColor: theme.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  hierarchyFacultyHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  hierarchyFacultyName: {
    flex: 1,
    fontSize: 13,
    fontWeight: "800",
    color: theme.text,
  },
  hierarchyProgramsList: {
    marginTop: 8,
    paddingLeft: 26,
    gap: 6,
  },
  hierarchyProgramItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  hierarchyBullet: {
    fontSize: 14,
    color: theme.muted,
  },
  hierarchyProgDept: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.text,
  },
  hierarchyProgTitle: {
    fontSize: 11,
    color: theme.muted,
  },

  // PROFILE SCREENS
  profileHeroCard: {
    backgroundColor: theme.surface,
    borderRadius: 24,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.border,
    shadowColor: theme.primaryDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },
  profileHeroAvatarWrap: {
    position: "relative",
    marginBottom: 14,
  },
  profileHeroAvatarImg: {
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 3,
    borderColor: theme.accent,
  },
  profileHeroAvatarFallback: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: theme.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 3,
    borderColor: theme.accent,
  },
  profileHeroAvatarInitial: {
    fontSize: 32,
    fontWeight: "900",
    color: "#fff",
  },
  avatarEditPill: {
    position: "absolute",
    bottom: 0,
    right: 0,
    backgroundColor: theme.primaryLight,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
  profileHeroName: {
    fontSize: 20,
    fontWeight: "900",
    color: theme.text,
  },
  profileHeroRoleTag: {
    backgroundColor: theme.primaryPale,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    marginTop: 6,
  },
  profileHeroRoleText: {
    fontSize: 11,
    fontWeight: "900",
    color: theme.primaryLight,
    letterSpacing: 0.5,
  },
  profileHeroEmail: {
    fontSize: 13,
    color: theme.muted,
    marginTop: 6,
  },
  assignedSubjectRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  assignedSubjectTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.text,
  },
  assignedSubjectSub: {
    fontSize: 12,
    color: theme.muted,
    marginTop: 1,
  },
  signOutButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.dangerPale,
    borderRadius: 14,
    height: 50,
    gap: 8,
    borderWidth: 1,
    borderColor: theme.dangerBorder,
  },
  signOutButtonText: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.danger,
  },

  // COMMON HELPERS & MODALS
  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    alignSelf: "flex-start",
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: "800",
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  detailLabel: {
    fontSize: 13,
    color: theme.textSecondary,
    fontWeight: "600",
  },
  detailValue: {
    fontSize: 13,
    fontWeight: "800",
    color: theme.text,
  },
  emptyStateCard: {
    backgroundColor: theme.surface,
    borderRadius: 20,
    padding: 32,
    alignItems: "center",
    borderWidth: 1,
    borderColor: theme.border,
    marginVertical: 10,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: theme.surfaceAlt,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: theme.text,
    textAlign: "center",
  },
  emptyDesc: {
    fontSize: 13,
    color: theme.muted,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 18,
  },
  emptyActionBtn: {
    marginTop: 16,
    backgroundColor: theme.primaryLight,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
  },
  emptyActionText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#fff",
  },
  selectTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: theme.surfaceAlt,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
    paddingHorizontal: 14,
    height: 48,
  },
  selectTriggerDisabled: {
    opacity: 0.6,
  },
  selectTriggerText: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.text,
  },
  applyFilterButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.primaryLight,
    borderRadius: 12,
    height: 44,
    gap: 8,
    marginTop: 14,
  },
  applyFilterButtonText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#fff",
  },

  // MODAL OVERLAYS
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.6)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalCard: {
    width: "100%",
    backgroundColor: theme.surface,
    borderRadius: 24,
    padding: 20,
    shadowColor: theme.primaryDark,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 20,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: theme.text,
  },
  modalHero: {
    alignItems: "center",
    marginBottom: 16,
  },
  modalAvatarLarge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: theme.primaryPale,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  modalAvatarText: {
    fontSize: 26,
    fontWeight: "900",
    color: theme.primaryLight,
  },
  modalName: {
    fontSize: 18,
    fontWeight: "900",
    color: theme.text,
  },
  idChip: {
    backgroundColor: theme.primaryPale,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    marginTop: 6,
  },
  idChipText: {
    fontSize: 11,
    fontWeight: "900",
    color: theme.primaryLight,
  },
  modalDetailsList: {
    marginBottom: 18,
  },
  modalCloseButton: {
    backgroundColor: theme.primary,
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseButtonText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#fff",
  },
  modalActionButtonsRow: {
    flexDirection: "row",
    gap: 10,
  },
  dangerButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.dangerPale,
    borderRadius: 12,
    height: 46,
    gap: 6,
    borderWidth: 1,
    borderColor: theme.dangerBorder,
  },
  dangerButtonText: {
    fontSize: 13,
    fontWeight: "800",
    color: theme.danger,
  },
  modalDoneButton: {
    flex: 1,
    backgroundColor: theme.primary,
    borderRadius: 12,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
  },
  modalDoneButtonText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#fff",
  },

  // DROPDOWNS & HIERARCHY CHECKBOXES
  dropdownModal: {
    width: "100%",
    backgroundColor: theme.surface,
    borderRadius: 20,
    padding: 20,
  },
  dropdownTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: theme.text,
    marginBottom: 14,
  },
  dropdownOption: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  dropdownOptionText: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.text,
  },
  hierarchyCheckboxBox: {
    marginTop: 10,
  },
  hierarchyAccessSub: {
    fontSize: 12,
    color: theme.muted,
    marginBottom: 12,
    lineHeight: 16,
  },
  phaseLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: theme.textSecondary,
    marginBottom: 8,
  },
  phaseOptionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  phaseOptionChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.surfaceAlt,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: theme.border,
  },
  phaseOptionChipActive: {
    backgroundColor: theme.primaryPale,
    borderColor: theme.primaryLight,
  },
  phaseOptionText: {
    fontSize: 12,
    fontWeight: "700",
    color: theme.muted,
  },
  phaseOptionTextActive: {
    color: theme.primaryLight,
  },
  readOnlyPill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.primaryPale,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    gap: 4,
  },
  readOnlyPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: theme.primaryLight,
  },
  reportSessionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  reportSessionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: theme.primaryPale,
    alignItems: "center",
    justifyContent: "center",
  },
  reportSessionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: theme.text,
  },
  reportSessionSub: {
    fontSize: 11,
    color: theme.muted,
    marginTop: 1,
  },
});
