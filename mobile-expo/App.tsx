import React, {
  useEffect,
  useState,
  useMemo,
  useRef,
  useContext,
  createContext,
  useCallback,
} from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  Easing,
  FlatList,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { CameraView, useCameraPermissions } from "expo-camera";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import Constants from "expo-constants";
import DeferredScreen from "./components/DeferredScreen";
import UploadDonut from "./components/UploadDonut";
import { formatDisplayDate, fromApiDate, parseDisplayDate, toApiDate } from "./utils/dateFormat";
import { getTabIcon as getNavigationTabIcon } from "./utils/navigation";
import type { Role } from "./utils/types";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const SCREEN_SIDE_PADDING = 18;
const CARD_GRID_GAP = 12;
// Keep every two-column dashboard grid exactly inside the scroll content.
const CARD_GRID_WIDTH =
  (SCREEN_WIDTH - SCREEN_SIDE_PADDING * 2 - CARD_GRID_GAP) / 2;
const STATUS_BAR_HEIGHT =
  Platform.OS === "android" ? (RNStatusBar.currentHeight ?? 24) : 0;
// Most Android emulators expose a virtual back camera but leave the front
// camera unconfigured. Real phones retain the expected selfie-camera default.
const DEFAULT_CAMERA_FACING: "front" | "back" =
  Platform.OS === "android" && !Constants.isDevice ? "back" : "front";

// FastAPI returns validation errors as an array in `detail`. React Native's
// Android Alert bridge only accepts a string message, so normalize API errors
// before they cross the native boundary.
function apiErrorMessage(error: any, fallback: string): string {
  const detail = error?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => typeof item === "string" ? item : item?.msg || item?.message)
      .filter(Boolean);
    return messages.length ? messages.join("\n") : fallback;
  }
  if (detail && typeof detail === "object") return detail.msg || detail.message || fallback;
  return typeof error?.message === "string" ? error.message : fallback;
}

// ---------------------------------------------------------------------------
// ENTERPRISE DESIGN SYSTEM THEMES (SLATE OBSIDIAN DARK + COOL SLATE LIGHT)
// ---------------------------------------------------------------------------
export const darkTheme = {
  mode: "dark" as const,
  bg: "#0B0F19",
  bgElevated: "#111827",
  card: "#151E32",
  cardGlass: "rgba(21, 30, 50, 0.94)",
  cardSubtle: "#0E1524",
  cardHover: "#1A253E",
  divider: "rgba(255, 255, 255, 0.06)",
  border: "rgba(255, 255, 255, 0.08)",
  borderBright: "rgba(255, 255, 255, 0.14)",
  borderAccent: "rgba(59, 130, 246, 0.35)",
  cyan: "#3B82F6",
  cyanGlow: "rgba(59, 130, 246, 0.12)",
  cyanStrong: "#60A5FA",
  blue: "#3B82F6",
  blueDark: "#1D4ED8",
  blueGlow: "rgba(59, 130, 246, 0.12)",
  amber: "#F59E0B",
  amberGlow: "rgba(245, 158, 11, 0.12)",
  emerald: "#10B981",
  emeraldGlow: "rgba(16, 185, 129, 0.12)",
  rose: "#EF4444",
  roseGlow: "rgba(239, 68, 68, 0.12)",
  purple: "#8B5CF6",
  purpleGlow: "rgba(139, 92, 246, 0.12)",
  gold: "#F59E0B",
  goldGlow: "rgba(245, 158, 11, 0.12)",
  text: "#F8FAFC",
  textSecondary: "#94A3B8",
  muted: "#64748B",
  navBg: "rgba(11, 15, 25, 0.95)",
  statusBarStyle: "light" as const,
};

export const lightTheme = {
  mode: "light" as const,
  bg: "#F8FAFC",
  bgElevated: "#FFFFFF",
  card: "#FFFFFF",
  cardGlass: "rgba(255, 255, 255, 0.96)",
  cardSubtle: "#F1F5F9",
  cardHover: "#E2E8F0",
  divider: "rgba(0, 0, 0, 0.05)",
  border: "#E2E8F0",
  borderBright: "#CBD5E1",
  borderAccent: "rgba(37, 99, 235, 0.22)",
  cyan: "#2563EB",
  cyanGlow: "rgba(37, 99, 235, 0.08)",
  cyanStrong: "#1D4ED8",
  blue: "#2563EB",
  blueDark: "#1E40AF",
  blueGlow: "rgba(37, 99, 235, 0.08)",
  amber: "#D97706",
  amberGlow: "rgba(217, 119, 6, 0.08)",
  emerald: "#059669",
  emeraldGlow: "rgba(5, 150, 105, 0.08)",
  rose: "#DC2626",
  roseGlow: "rgba(220, 38, 38, 0.08)",
  purple: "#7C3AED",
  purpleGlow: "rgba(124, 58, 237, 0.08)",
  gold: "#D97706",
  goldGlow: "rgba(217, 119, 6, 0.08)",
  text: "#0F172A",
  textSecondary: "#475569",
  muted: "#64748B",
  navBg: "rgba(255, 255, 255, 0.96)",
  statusBarStyle: "dark" as const,
};

export type AppTheme = typeof darkTheme | typeof lightTheme;

const ThemeContext = createContext<{
  theme: AppTheme;
  isDark: boolean;
  toggleTheme: () => void;
}>({
  theme: darkTheme,
  isDark: true,
  toggleTheme: () => {},
});

export const useAppTheme = () => useContext(ThemeContext);

const DEFAULT_TUNNEL_URL = "http://localhost:8080";

export function resolveApiBaseUrl(): string {
  const envUrl = (process.env.EXPO_PUBLIC_API_URL?.trim() || "").replace(/\/+$/, "");

  // On Web browser
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.location?.hostname) {
      const host = window.location.hostname;
      if (host === "localhost" || host === "127.0.0.1") {
        return "http://localhost:8000";
      }
      return `http://${host}:8000`;
    }
    return "http://localhost:8000";
  }

  // Remote tunnel or custom URL (e.g. Tailscale / Cloudflare / Public HTTPS)
  if (
    envUrl &&
    !envUrl.includes("10.0.2.2") &&
    !envUrl.includes("localhost") &&
    !envUrl.includes("127.0.0.1")
  ) {
    return envUrl;
  }

  // Detect Metro packager host for physical devices running on LAN Wi-Fi
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost ||
    (Constants as any).manifest?.debuggerHost ||
    "";
  const metroHost = hostUri ? hostUri.split(":")[0] : "";

  if (metroHost && metroHost !== "localhost" && metroHost !== "127.0.0.1") {
    return `http://${metroHost}:8000`;
  }

  // On Android emulator
  if (Platform.OS === "android" && !Constants.isDevice) {
    return "http://10.0.2.2:8000";
  }

  return envUrl || "http://localhost:8000";
}

let API = resolveApiBaseUrl();
const http = axios.create({ baseURL: API, timeout: 25000 });

export function updateApiBaseUrl(newUrl: string) {
  API = newUrl.trim();
  http.defaults.baseURL = API;
  academicSectionsCache = null;
  AsyncStorage.setItem("custom_api_url", API).catch(() => {});
}

// Load custom API URL if previously saved
AsyncStorage.getItem("custom_api_url")
  .then((stored) => {
    if (stored && stored.trim()) {
      const val = stored.trim();
      // Only restore if not a stale dead Wi-Fi IP, old tunnel or emulator placeholder
      if (
        !val.includes("10.153.209.171") &&
        !val.includes("10.0.2.2") &&
        !val.includes("anotherearth")
      ) {
        API = val;
        http.defaults.baseURL = API;
      } else {
        // Clear obsolete stored URLs so default tunnel URL takes effect
        AsyncStorage.removeItem("custom_api_url").catch(() => {});
      }
    }
  })
  .catch(() => {});

// The hierarchy is shared by several screens. Fetch it once per app session
// instead of making a full network request each time a selector mounts.
let academicSectionsCache: any[] | null = null;
let academicSectionsRequest: Promise<any[]> | null = null;

// Temporary academic scope while the full university hierarchy is being finalized.
// Program and semester remain selectable for attendance registration.
const DEFAULT_ACADEMIC_SCOPE = {
  school: "School of Technology, Communication and Management",
  faculty: "Faculty of Technology and Management",
  department: "Department of Computer Sciences",
};

function loadAcademicSections(): Promise<any[]> {
  if (academicSectionsCache) return Promise.resolve(academicSectionsCache);
  if (academicSectionsRequest) return academicSectionsRequest;

  academicSectionsRequest = http
    .get("/academic/sections")
    .then((response) => {
      academicSectionsCache = response.data?.sections || [];
      return academicSectionsCache;
    })
    .finally(() => {
      academicSectionsRequest = null;
    });
  return academicSectionsRequest;
}

// ---------------------------------------------------------------------------
// ROOT APPLICATION & THEME PROVIDER
// ---------------------------------------------------------------------------
export default function App() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Restore the user's theme preference; light remains the default for new installs.
    AsyncStorage.getItem("pratyaksh_theme")
      .then((storedTheme) => {
        if (storedTheme === "dark") setIsDark(true);
      })
      .catch(() => {});

    // Load persisted user session
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

  const toggleTheme = () => {
    setIsDark((prev) => {
      const next = !prev;
      AsyncStorage.setItem("pratyaksh_theme", next ? "dark" : "light");
      return next;
    });
  };

  const theme = isDark ? darkTheme : lightTheme;

  if (loading) {
    return (
      <SafeAreaView
        style={[styles.splashContainer, { backgroundColor: theme.bg }]}
      >
        <StatusBar style={theme.statusBarStyle} />
        <View
          style={[styles.splashGlowBg, { backgroundColor: theme.cyanGlow }]}
        />
        <View
          style={[
            styles.splashCard,
            {
              backgroundColor: theme.cardGlass,
              borderColor: theme.borderBright,
            },
          ]}
        >
          <Image
            source={require("./assets/pratyaksha-logo.jpg")}
            style={styles.splashLogo}
            resizeMode="contain"
          />
          <View
            style={[styles.splashPulseDot, { backgroundColor: theme.cyan }]}
          />
          <Text style={[styles.splashTitle, { color: theme.text }]}>
            PRATYAKSH
          </Text>
          <Text style={[styles.splashSubtitle, { color: theme.muted }]}>
            AI Academic Attendance System
          </Text>
          <ActivityIndicator
            size="large"
            color={theme.cyan}
            style={{ marginTop: 24 }}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <ThemeContext.Provider value={{ theme, isDark, toggleTheme }}>
      {user ? (
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
      )}
    </ThemeContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// ELEGANT EXECUTIVE LOGIN SCREEN
// ---------------------------------------------------------------------------
function Login({ onLogin }: { onLogin: (u: any) => void }) {
  const { theme, isDark, toggleTheme } = useAppTheme();
  const [role, setRole] = useState<Role>("admin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showRegistration, setShowRegistration] = useState(false);
  const [registeredVisitor, setRegisteredVisitor] = useState<any>(null);
  const [currentApi, setCurrentApi] = useState(API);
  const [showServerModal, setShowServerModal] = useState(false);
  const [testStatus, setTestStatus] = useState<
    "checking" | "online" | "offline"
  >("checking");
  const [customInput, setCustomInput] = useState(API);
  const [testingCustom, setTestingCustom] = useState(false);

  useEffect(() => {
    setCurrentApi(http.defaults.baseURL || API);
    setCustomInput(http.defaults.baseURL || API);
    http
      .get("/health", { timeout: 4000 })
      .then((res) => {
        if (res.data?.status === "ok") setTestStatus("online");
        else setTestStatus("offline");
      })
      .catch(() => setTestStatus("offline"));
  }, []);

  const handleRoleSelect = (selectedRole: Role) => {
    setRole(selectedRole);
    setUsername("");
    setPassword("");
    setError("");
  };

  const submit = async () => {
    if (!username.trim() || !password) {
      setError(
        role === "others"
          ? "Please enter your email address and password."
          : "Please enter your username and password."
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await http.post("/auth/login", {
        username: username.trim(),
        password,
        role,
      });
      const userData = {
        ...res.data.user,
        token: res.data.access_token,
        role: res.data.user.role || role,
      };
      http.defaults.headers.common.Authorization = `Bearer ${userData.token}`;
      onLogin(userData);
    } catch (e: any) {
      if (!e?.response) {
        setError(
          `Unable to connect to server at ${http.defaults.baseURL || API}. Please verify your connection or configure the server URL.`
        );
      } else {
        const status = e.response.status;
        const detail = e.response.data?.detail;
        if (status === 401) {
          setError(
            detail || "Invalid username or password. Please verify credentials.",
          );
        } else {
          setError(
            detail || "The server could not complete the request. Please try again later.",
          );
        }
      }
    } finally {
      setBusy(false);
    }
  };

  if (showRegistration) {
    if (registeredVisitor) {
      return (
        <OthersRegistrationSuccessView
          visitor={registeredVisitor}
          onContinue={() => {
            setRegisteredVisitor(null);
            setShowRegistration(false);
            setUsername(registeredVisitor.email);
            setRole("others");
          }}
        />
      );
    }
    return (
      <OthersRegistrationView
        onBack={() => setShowRegistration(false)}
        onSuccess={(data) => setRegisteredVisitor(data)}
      />
    );
  }

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        { backgroundColor: theme.bg, paddingTop: STATUS_BAR_HEIGHT },
      ]}
    >
      <StatusBar style={theme.statusBarStyle} />

      <ScrollView
        contentContainerStyle={styles.loginScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Top Controls: Server Status & Theme Toggle */}
        <View style={styles.loginTopControls}>
          <Pressable
            onPress={() => setShowServerModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Configure server connection"
            style={[
              styles.themePillBtn,
              {
                backgroundColor:
                  testStatus === "online"
                    ? theme.emeraldGlow
                    : testStatus === "checking"
                      ? theme.cyanGlow
                      : theme.roseGlow,
                borderColor:
                  testStatus === "online"
                    ? theme.emerald
                    : testStatus === "checking"
                      ? theme.cyan
                      : theme.rose,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={
                testStatus === "online"
                  ? "server-network"
                  : testStatus === "checking"
                    ? "sync"
                    : "server-network-off"
              }
              size={15}
              color={
                testStatus === "online"
                  ? theme.emerald
                  : testStatus === "checking"
                    ? theme.cyan
                    : theme.rose
              }
            />
            <Text
              style={[
                styles.themePillText,
                {
                  color:
                    testStatus === "online"
                      ? theme.emerald
                      : testStatus === "checking"
                        ? theme.cyan
                        : theme.rose,
                  fontWeight: "600",
                },
              ]}
            >
              {testStatus === "online"
                ? "Server: Online"
                : testStatus === "checking"
                  ? "Checking..."
                  : "Server: Offline"}
            </Text>
          </Pressable>

          <Pressable
            onPress={toggleTheme}
            accessibilityRole="button"
            accessibilityLabel={isDark ? "Switch to light theme" : "Switch to dark theme"}
            style={[
              styles.themePillBtn,
              {
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(37,99,235,0.06)",
                borderColor: theme.border,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={isDark ? "white-balance-sunny" : "moon-waning-crescent"}
              size={16}
              color={isDark ? theme.amber : theme.blue}
            />
            <Text
              style={[styles.themePillText, { color: theme.textSecondary }]}
            >
              {isDark ? "Light" : "Dark"}
            </Text>
          </Pressable>
        </View>

        {/* ── Brand Hero Section ── */}
        <View style={styles.loginBrandHeader}>
          {/* Logo Badge */}
          <View style={styles.loginLogoRingWrap}>
            <View
              style={[
                styles.logoBadgeCard,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.borderBright,
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: isDark ? 0.3 : 0.06,
                  shadowRadius: 8,
                  elevation: 2,
                },
              ]}
            >
              <Image
                source={require("./assets/pratyaksha-logo.jpg")}
                style={styles.loginLogo}
                resizeMode="contain"
              />
            </View>
          </View>

          {/* Brand Name */}
          <Text style={[styles.brandTitleText, { color: theme.text }]}>
            Pratyaksh<Text style={{ color: theme.cyan }}>.ai</Text>
          </Text>
          <Text
            style={[styles.loginBrandTagline, { color: theme.textSecondary }]}
          >
            Intelligent Biometric & Attendance Platform
          </Text>

          {/* Status Badge */}
          <View
            style={[
              styles.brandStatusTag,
              {
                backgroundColor: theme.cyanGlow,
                borderColor: theme.borderAccent,
              },
            ]}
          >
            <View
              style={[styles.brandStatusDot, { backgroundColor: theme.cyan }]}
            />
            <Text style={[styles.brandStatusTagText, { color: theme.cyan }]}>
              Verified Campus Network
            </Text>
          </View>
        </View>

        {/* ── Sign-In Card ── */}
        <View
          style={[
            styles.loginSurfaceCard,
            {
              backgroundColor: theme.cardGlass,
              borderColor: theme.borderBright,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: isDark ? 0.3 : 0.06,
              shadowRadius: 16,
              elevation: 3,
            },
          ]}
        >
          <Text style={[styles.cardHeaderTitle, { color: theme.text }]}>
            Welcome Back
          </Text>
          <Text
            style={[styles.cardHeaderSubtitle, { color: theme.textSecondary }]}
          >
            Sign in to access your campus portal
          </Text>

          {/* Role Selector */}
          <View
            style={[styles.roleTabsWrap, { backgroundColor: theme.bgElevated }]}
          >
            {(
              [
                { id: "admin", label: "Admin", icon: "shield-crown-outline" },
                { id: "teacher", label: "Faculty", icon: "account-tie-outline" },
                { id: "student", label: "Student", icon: "school-outline" },
                { id: "others", label: "Others", icon: "badge-account-outline" },
              ] as const
            ).map((item) => {
              const active = role === item.id;
              return (
                <Pressable
                  key={item.id}
                  onPress={() => handleRoleSelect(item.id)}
                  style={[
                    styles.roleTabItem,
                    active && [
                      styles.roleTabItemActive,
                      {
                        backgroundColor: theme.card,
                        borderColor: theme.borderBright,
                      },
                    ],
                  ]}
                >
                  <MaterialCommunityIcons
                    name={item.icon as any}
                    size={17}
                    color={active ? theme.cyan : theme.muted}
                  />
                  <Text
                    style={[
                      styles.roleTabLabel,
                      { color: active ? theme.cyan : theme.muted },
                      active && { fontWeight: "700" },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Username or Email */}
          <View style={styles.formGroup}>
            <Text style={[styles.fieldLabelText, { color: theme.textSecondary }]}>
              {role === "others" ? "Email Address" : "Username or ID"}
            </Text>
            <View
              style={[
                styles.inputContainerBox,
                {
                  backgroundColor: theme.bgElevated,
                  borderColor:
                    username.length > 0 ? theme.borderAccent : theme.border,
                },
              ]}
            >
              <MaterialCommunityIcons
                name={role === "others" ? "email-outline" : "account-outline"}
                size={19}
                color={username.length > 0 ? theme.cyan : theme.muted}
                style={styles.inputPrefixIcon}
              />
              <TextInput
                style={[styles.textInputBox, { color: theme.text }]}
                value={username}
                onChangeText={setUsername}
                placeholderTextColor={theme.muted}
                placeholder={role === "others" ? "Enter email address" : "Enter username"}
                keyboardType={role === "others" ? "email-address" : "default"}
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* Password */}
          <View style={styles.formGroup}>
            <Text style={[styles.fieldLabelText, { color: theme.textSecondary }]}>
              Password
            </Text>
            <View
              style={[
                styles.inputContainerBox,
                {
                  backgroundColor: theme.bgElevated,
                  borderColor:
                    password.length > 0 ? theme.borderAccent : theme.border,
                },
              ]}
            >
              <MaterialCommunityIcons
                name="lock-outline"
                size={19}
                color={password.length > 0 ? theme.cyan : theme.muted}
                style={styles.inputPrefixIcon}
              />
              <TextInput
                style={[styles.textInputBox, { color: theme.text }]}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="Enter password"
                placeholderTextColor={theme.muted}
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                style={styles.eyeBtn}
              >
                <MaterialCommunityIcons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={19}
                  color={theme.muted}
                />
              </Pressable>
            </View>
          </View>

          {/* Error Banner */}
          {!!error && (
            <View
              style={[
                styles.errorBannerBox,
                { backgroundColor: theme.roseGlow, borderColor: theme.rose },
              ]}
            >
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={17}
                color={theme.rose}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.errorBannerText, { color: theme.rose }]}>
                  {error}
                </Text>
                {error.toLowerCase().includes("unable to connect") && (
                  <Pressable
                    onPress={() => setShowServerModal(true)}
                    style={{
                      marginTop: 6,
                      alignSelf: "flex-start",
                      backgroundColor: theme.rose,
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 6,
                    }}
                  >
                    <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>
                      CONFIGURE SERVER URL ⚙
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}

          {/* Sign-In CTA */}
          <Pressable
            style={[
              styles.submitButtonGlow,
              {
                backgroundColor: theme.cyan,
                shadowColor: theme.cyan,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.25,
                shadowRadius: 6,
                elevation: 3,
              },
              busy && { opacity: 0.75 },
            ]}
            onPress={submit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator
                color="#FFFFFF"
              />
            ) : (
              <View style={styles.submitRow}>
                <Text
                  style={[
                    styles.submitTextAction,
                    { color: "#FFFFFF" },
                  ]}
                >
                  {role === "admin"
                    ? "Sign In as Administrator"
                    : role === "teacher"
                      ? "Sign In as Faculty"
                      : role === "others"
                        ? "Sign In as Visitor"
                        : "Sign In as Student"}
                </Text>
                <MaterialCommunityIcons
                  name="arrow-right"
                  size={18}
                  color="#FFFFFF"
                />
              </View>
            )}
          </Pressable>

          {/* Registration link for Others role */}
          {role === "others" && (
            <View style={styles.registerRowWrap}>
              <Text style={[styles.registerPromptText, { color: theme.textSecondary }]}>
                Don't have an account?{" "}
              </Text>
              <Pressable
                onPress={() => {
                  setError("");
                  setShowRegistration(true);
                }}
                accessibilityRole="button"
                accessibilityLabel="Register for a new visitor account"
              >
                <Text style={[styles.registerLinkText, { color: theme.cyan }]}>
                  Register
                </Text>
              </Pressable>
            </View>
          )}

        </View>

        <Text style={[styles.loginFootnote, { color: theme.muted }]}>
          Pratyaksh Academic Portal • Enterprise Biometric Attendance
        </Text>
      </ScrollView>

      {/* Backend Server Configuration Modal */}
      <Modal
        visible={showServerModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowServerModal(false)}
      >
        <Pressable
          style={styles.modalBackdropOverlay}
          onPress={() => setShowServerModal(false)}
        >
          <Pressable
            style={[
              styles.modalSheetCard,
              {
                backgroundColor: theme.cardGlass,
                borderColor: theme.borderBright,
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalSheetHeader}>
              <Text style={[styles.modalSheetTitle, { color: theme.text }]}>
                Server Connection (Docker)
              </Text>
              <Pressable onPress={() => setShowServerModal(false)}>
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color={theme.text}
                />
              </Pressable>
            </View>

            <Text
              style={[
                styles.fieldLabelText,
                { color: theme.muted, marginTop: 10 },
              ]}
            >
              API ADDRESS (HOST OR LAN IP)
            </Text>
            <View
              style={[
                styles.inputContainerBox,
                {
                  backgroundColor: theme.bgElevated,
                  borderColor: theme.borderAccent,
                },
              ]}
            >
              <TextInput
                style={[styles.textInputBox, { color: theme.text }]}
                value={customInput}
                onChangeText={setCustomInput}
                placeholder="https://cair-ms-7e06.tail49e3b1.ts.net"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
              />
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <Pressable
                style={[
                  styles.smallActionBtn,
                  {
                    flex: 1,
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.cyan,
                    paddingVertical: 12,
                  },
                ]}
                onPress={async () => {
                  setTestingCustom(true);
                  try {
                    const cleaned = customInput.trim().replace(/\/+$/, "");
                    const res = await axios.get(`${cleaned}/health`, {
                      timeout: 5000,
                    });
                    if (res.data?.status === "ok") {
                      Alert.alert(
                        "Connection Success ✓",
                        `Successfully connected to Docker backend!\n\nStatus: ${res.data.status}\nModel Loaded: ${res.data.model_loaded}\nDatabase: ${res.data.database}`,
                      );
                    }
                  } catch (err: any) {
                    Alert.alert(
                      "Connection Failed ✗",
                      `Could not reach ${customInput}.\n\nReason: ${err.message}\n\nVerify Docker container is running and port is exposed.`,
                    );
                  } finally {
                    setTestingCustom(false);
                  }
                }}
                disabled={testingCustom}
              >
                {testingCustom ? (
                  <ActivityIndicator size="small" color={theme.cyan} />
                ) : (
                  <>
                    <MaterialCommunityIcons
                      name="lan-connect"
                      size={16}
                      color={theme.cyan}
                    />
                    <Text
                      style={[styles.smallActionBtnText, { color: theme.cyan }]}
                    >
                      TEST PING
                    </Text>
                  </>
                )}
              </Pressable>

              <Pressable
                style={[
                  styles.smallActionBtn,
                  {
                    flex: 1,
                    backgroundColor: theme.cyan,
                    borderColor: theme.cyan,
                    paddingVertical: 12,
                  },
                ]}
                onPress={() => {
                  const cleaned = customInput.trim().replace(/\/+$/, "");
                  updateApiBaseUrl(cleaned);
                  setCurrentApi(cleaned);
                  setShowServerModal(false);
                  axios
                    .get(`${cleaned}/health`, { timeout: 4000 })
                    .then(() => setTestStatus("online"))
                    .catch(() => setTestStatus("offline"));
                  Alert.alert(
                    "Server Configured",
                    `API URL updated to:\n${cleaned}`,
                  );
                }}
              >
                <MaterialCommunityIcons
                  name="content-save-outline"
                  size={16}
                  color="#000"
                />
                <Text
                  style={[
                    styles.smallActionBtnText,
                    { color: "#000", fontWeight: "700" },
                  ]}
                >
                  SAVE & USE
                </Text>
              </Pressable>
            </View>

            <Text
              style={[
                styles.fieldLabelText,
                { color: theme.muted, marginTop: 18 },
              ]}
            >
              QUICK PRESETS
            </Text>

            <View style={{ gap: 8, marginTop: 6 }}>
              {[
                {
                  label: "Tailscale Funnel (Remote)",
                  url: "https://cair-ms-7e06.tail49e3b1.ts.net",
                },
                {
                  label: "Host Wi-Fi Direct (Port 8000)",
                  url: "http://192.168.0.108:8000",
                },
                {
                  label: "Host Wi-Fi Nginx (Port 8080)",
                  url: "http://192.168.0.108:8080",
                },
                {
                  label: "Localhost Direct (Port 8000)",
                  url: "http://localhost:8000",
                },
                {
                  label: "Localhost Nginx (Port 8080)",
                  url: "http://localhost:8080",
                },
                {
                  label: "Android Emulator (Port 8000)",
                  url: "http://10.0.2.2:8000",
                },
              ].map((preset) => (
                <Pressable
                  key={preset.url}
                  style={[
                    styles.rosterItemCard,
                    {
                      paddingVertical: 10,
                      backgroundColor: theme.bgElevated,
                      borderColor:
                        currentApi === preset.url ? theme.cyan : theme.border,
                    },
                  ]}
                  onPress={() => {
                    setCustomInput(preset.url);
                    updateApiBaseUrl(preset.url);
                    setCurrentApi(preset.url);
                    setShowServerModal(false);
                    axios
                      .get(`${preset.url}/health`, { timeout: 4000 })
                      .then(() => setTestStatus("online"))
                      .catch(() => setTestStatus("offline"));
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: theme.text,
                        fontSize: 13,
                        fontWeight: "600",
                      }}
                    >
                      {preset.label}
                    </Text>
                    <Text
                      style={{ color: theme.muted, fontSize: 11, marginTop: 2 }}
                    >
                      {preset.url}
                    </Text>
                  </View>
                  {currentApi === preset.url && (
                    <MaterialCommunityIcons
                      name="check-circle"
                      size={18}
                      color={theme.cyan}
                    />
                  )}
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// OTHERS / VISITOR REGISTRATION VIEW
// ---------------------------------------------------------------------------
function OthersRegistrationView({
  onBack,
  onSuccess,
}: {
  onBack: () => void;
  onSuccess: (data: any) => void;
}) {
  const { theme, isDark } = useAppTheme();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [purposeOfVisit, setPurposeOfVisit] = useState("Interview");
  const [purposeOther, setPurposeOther] = useState("");

  const defaultIn = useMemo(() => {
    const d = new Date();
    d.setHours(9, 30, 0, 0);
    return d.toISOString().slice(0, 16);
  }, []);
  const defaultOut = useMemo(() => {
    const d = new Date();
    d.setHours(17, 30, 0, 0);
    return d.toISOString().slice(0, 16);
  }, []);

  const [expectedCheckIn, setExpectedCheckIn] = useState(defaultIn);
  const [expectedCheckOut, setExpectedCheckOut] = useState(defaultOut);
  const [identificationType, setIdentificationType] = useState(
    "Government-Issued Identity Card",
  );
  const [identificationNumber, setIdentificationNumber] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const PURPOSES = [
    "Interview",
    "Client Meeting",
    "Vendor",
    "Maintenance",
    "Official Meeting",
    "Academic Visit",
    "Other",
  ];

  const ID_TYPES = [
    "Passport",
    "Driver's License",
    "Government-Issued Identity Card",
    "Other Accepted Identification",
  ];

  const handleRegister = async () => {
    if (!fullName.trim() || fullName.trim().length < 2) {
      setError("Please enter your full name (at least 2 characters).");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim() || !emailRegex.test(email.trim())) {
      setError("Please enter a valid email address.");
      return;
    }
    if (!phone.trim() || phone.trim().length < 7) {
      setError("Please enter a valid contact phone number.");
      return;
    }
    if (
      purposeOfVisit === "Other" &&
      (!purposeOther.trim() || purposeOther.trim().length < 2)
    ) {
      setError("Please specify the purpose of your visit.");
      return;
    }
    if (!identificationNumber.trim() || identificationNumber.trim().length < 3) {
      setError("Please enter your identification number.");
      return;
    }
    if (!password || password.length < 6) {
      setError("Password must be at least 6 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Password and confirmation password do not match.");
      return;
    }

    let inIso = expectedCheckIn;
    let outIso = expectedCheckOut;
    try {
      const dIn = new Date(expectedCheckIn);
      const dOut = new Date(expectedCheckOut);
      if (isNaN(dIn.getTime()) || isNaN(dOut.getTime())) {
        setError("Please enter valid check-in and check-out dates and times.");
        return;
      }
      if (dOut <= dIn) {
        setError(
          "Expected Check-Out time must be after Expected Check-In time.",
        );
        return;
      }
      inIso = dIn.toISOString();
      outIso = dOut.toISOString();
    } catch {
      setError("Invalid date/time format.");
      return;
    }

    setBusy(true);
    setError("");
    try {
      const payload = {
        full_name: fullName.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        purpose_of_visit: purposeOfVisit,
        purpose_other:
          purposeOfVisit === "Other" ? purposeOther.trim() : null,
        expected_check_in: inIso,
        expected_check_out: outIso,
        identification_type: identificationType,
        identification_number: identificationNumber.trim(),
        password,
        confirm_password: confirmPassword,
      };

      const res = await http.post("/auth/others/register", payload);
      onSuccess(res.data);
    } catch (e: any) {
      if (!e?.response) {
        setError(
          `Unable to connect to server at ${http.defaults.baseURL || API}. Please check your connection or configure the server URL.`
        );
      } else {
        const detail = e.response.data?.detail;
        setError(
          detail ||
            "Registration failed. Please check the details and try again.",
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        { backgroundColor: theme.bg, paddingTop: STATUS_BAR_HEIGHT },
      ]}
    >
      <StatusBar style={theme.statusBarStyle} />
      <ScrollView
        contentContainerStyle={styles.loginScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Top Back Navigation */}
        <View
          style={{
            width: "100%",
            flexDirection: "row",
            alignItems: "center",
            marginBottom: 16,
          }}
        >
          <Pressable
            onPress={onBack}
            style={[
              styles.smallActionBtn,
              {
                backgroundColor: theme.bgElevated,
                borderColor: theme.border,
                paddingHorizontal: 12,
                paddingVertical: 8,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="arrow-left"
              size={18}
              color={theme.text}
            />
            <Text
              style={{ color: theme.text, fontSize: 13, fontWeight: "600" }}
            >
              Back to Login
            </Text>
          </Pressable>
        </View>

        {/* Card Header */}
        <View
          style={[
            styles.loginSurfaceCard,
            {
              backgroundColor: theme.cardGlass,
              borderColor: theme.borderBright,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: isDark ? 0.3 : 0.06,
              shadowRadius: 16,
              elevation: 3,
            },
          ]}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              marginBottom: 6,
            }}
          >
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: theme.cyanGlow,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: theme.cyan,
              }}
            >
              <MaterialCommunityIcons
                name="badge-account-outline"
                size={20}
                color={theme.cyan}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardHeaderTitle, { color: theme.text }]}>
                Visitor Registration
              </Text>
              <Text style={{ color: theme.textSecondary, fontSize: 12 }}>
                Register for campus visitor access badge
              </Text>
            </View>
          </View>

          {/* System Information Banner */}
          <View
            style={{
              backgroundColor: theme.bgElevated,
              borderRadius: 10,
              padding: 12,
              marginBottom: 16,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginBottom: 4,
              }}
            >
              <MaterialCommunityIcons
                name="shield-check-outline"
                size={15}
                color={theme.cyan}
              />
              <Text
                style={{
                  color: theme.cyan,
                  fontSize: 11,
                  fontWeight: "700",
                  letterSpacing: 0.3,
                }}
              >
                SYSTEM-GENERATED CREDENTIALS
              </Text>
            </View>
            <Text
              style={{
                color: theme.textSecondary,
                fontSize: 11,
                lineHeight: 16,
              }}
            >
              Unique Visitor ID (VIS-YYYY-XXXXXXXX) and authoritative timestamp
              will be generated by the server upon successful submission.
            </Text>
          </View>

          {/* Section: Profile Details */}
          <Text
            style={[
              styles.fieldLabelText,
              { color: theme.cyan, marginTop: 4, letterSpacing: 0.5 },
            ]}
          >
            1. VISITOR PROFILE
          </Text>

          <View style={styles.formGroup}>
            <Text
              style={[styles.fieldLabelText, { color: theme.textSecondary }]}
            >
              Full Name *
            </Text>
            <View
              style={[
                styles.inputContainerBox,
                { backgroundColor: theme.bgElevated, borderColor: theme.border },
              ]}
            >
              <MaterialCommunityIcons
                name="account-outline"
                size={18}
                color={theme.muted}
                style={styles.inputPrefixIcon}
              />
              <TextInput
                style={[styles.textInputBox, { color: theme.text }]}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Dr. / Mr. / Ms. Full Name"
                placeholderTextColor={theme.muted}
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text
              style={[styles.fieldLabelText, { color: theme.textSecondary }]}
            >
              Email Address (Login Identifier) *
            </Text>
            <View
              style={[
                styles.inputContainerBox,
                { backgroundColor: theme.bgElevated, borderColor: theme.border },
              ]}
            >
              <MaterialCommunityIcons
                name="email-outline"
                size={18}
                color={theme.muted}
                style={styles.inputPrefixIcon}
              />
              <TextInput
                style={[styles.textInputBox, { color: theme.text }]}
                value={email}
                onChangeText={setEmail}
                placeholder="visitor@organization.org"
                placeholderTextColor={theme.muted}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text
              style={[styles.fieldLabelText, { color: theme.textSecondary }]}
            >
              Mobile / Phone Number *
            </Text>
            <View
              style={[
                styles.inputContainerBox,
                { backgroundColor: theme.bgElevated, borderColor: theme.border },
              ]}
            >
              <MaterialCommunityIcons
                name="phone-outline"
                size={18}
                color={theme.muted}
                style={styles.inputPrefixIcon}
              />
              <TextInput
                style={[styles.textInputBox, { color: theme.text }]}
                value={phone}
                onChangeText={setPhone}
                placeholder="+91 98765 43210"
                placeholderTextColor={theme.muted}
                keyboardType="phone-pad"
              />
            </View>
          </View>

          {/* Section: Visit Logistics */}
          <Text
            style={[
              styles.fieldLabelText,
              { color: theme.cyan, marginTop: 8, letterSpacing: 0.5 },
            ]}
          >
            2. VISIT LOGISTICS
          </Text>

          <View style={styles.formGroup}>
            <Text
              style={[styles.fieldLabelText, { color: theme.textSecondary }]}
            >
              Purpose of Visit *
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginVertical: 4 }}
            >
              <View style={{ flexDirection: "row", gap: 6 }}>
                {PURPOSES.map((p) => {
                  const sel = purposeOfVisit === p;
                  return (
                    <Pressable
                      key={p}
                      onPress={() => setPurposeOfVisit(p)}
                      style={[
                        styles.demoChipPill,
                        {
                          backgroundColor: sel
                            ? theme.cyanGlow
                            : theme.bgElevated,
                          borderColor: sel ? theme.cyan : theme.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.demoChipPillText,
                          {
                            color: sel ? theme.cyan : theme.textSecondary,
                            fontWeight: sel ? "700" : "500",
                          },
                        ]}
                      >
                        {p}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          {purposeOfVisit === "Other" && (
            <View style={styles.formGroup}>
              <Text
                style={[styles.fieldLabelText, { color: theme.textSecondary }]}
              >
                Specific Purpose *
              </Text>
              <View
                style={[
                  styles.inputContainerBox,
                  {
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.border,
                  },
                ]}
              >
                <TextInput
                  style={[styles.textInputBox, { color: theme.text }]}
                  value={purposeOther}
                  onChangeText={setPurposeOther}
                  placeholder="Describe purpose of campus visit"
                  placeholderTextColor={theme.muted}
                />
              </View>
            </View>
          )}

          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text
                style={[styles.fieldLabelText, { color: theme.textSecondary }]}
              >
                Expected Check-In *
              </Text>
              <View
                style={[
                  styles.inputContainerBox,
                  {
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.border,
                  },
                ]}
              >
                <TextInput
                  style={[
                    styles.textInputBox,
                    { color: theme.text, fontSize: 12 },
                  ]}
                  value={expectedCheckIn}
                  onChangeText={setExpectedCheckIn}
                  placeholder="YYYY-MM-DDTHH:mm"
                  placeholderTextColor={theme.muted}
                />
              </View>
            </View>

            <View style={[styles.formGroup, { flex: 1 }]}>
              <Text
                style={[styles.fieldLabelText, { color: theme.textSecondary }]}
              >
                Expected Check-Out *
              </Text>
              <View
                style={[
                  styles.inputContainerBox,
                  {
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.border,
                  },
                ]}
              >
                <TextInput
                  style={[
                    styles.textInputBox,
                    { color: theme.text, fontSize: 12 },
                  ]}
                  value={expectedCheckOut}
                  onChangeText={setExpectedCheckOut}
                  placeholder="YYYY-MM-DDTHH:mm"
                  placeholderTextColor={theme.muted}
                />
              </View>
            </View>
          </View>

          {/* Section: Identification */}
          <Text
            style={[
              styles.fieldLabelText,
              { color: theme.cyan, marginTop: 8, letterSpacing: 0.5 },
            ]}
          >
            3. IDENTIFICATION & VERIFICATION
          </Text>

          <View style={styles.formGroup}>
            <Text
              style={[styles.fieldLabelText, { color: theme.textSecondary }]}
            >
              Identification Type *
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={{ marginVertical: 4 }}
            >
              <View style={{ flexDirection: "row", gap: 6 }}>
                {ID_TYPES.map((t) => {
                  const sel = identificationType === t;
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setIdentificationType(t)}
                      style={[
                        styles.demoChipPill,
                        {
                          backgroundColor: sel
                            ? theme.cyanGlow
                            : theme.bgElevated,
                          borderColor: sel ? theme.cyan : theme.border,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.demoChipPillText,
                          {
                            color: sel ? theme.cyan : theme.textSecondary,
                            fontWeight: sel ? "700" : "500",
                          },
                        ]}
                      >
                        {t}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          </View>

          <View style={styles.formGroup}>
            <Text
              style={[styles.fieldLabelText, { color: theme.textSecondary }]}
            >
              ID Number *
            </Text>
            <View
              style={[
                styles.inputContainerBox,
                { backgroundColor: theme.bgElevated, borderColor: theme.border },
              ]}
            >
              <MaterialCommunityIcons
                name="card-account-details-outline"
                size={18}
                color={theme.muted}
                style={styles.inputPrefixIcon}
              />
              <TextInput
                style={[styles.textInputBox, { color: theme.text }]}
                value={identificationNumber}
                onChangeText={setIdentificationNumber}
                placeholder="Government ID / License / Passport No."
                placeholderTextColor={theme.muted}
                autoCapitalize="characters"
              />
            </View>
            <Text style={{ color: theme.muted, fontSize: 11, marginTop: 4 }}>
              Security Note: Only masked characters (e.g. ********1234) appear
              on your pass. Complete IDs are never exposed.
            </Text>
          </View>

          {/* Section: Account Password */}
          <Text
            style={[
              styles.fieldLabelText,
              { color: theme.cyan, marginTop: 8, letterSpacing: 0.5 },
            ]}
          >
            4. PORTAL ACCESS PASSWORD
          </Text>

          <View style={styles.formGroup}>
            <Text
              style={[styles.fieldLabelText, { color: theme.textSecondary }]}
            >
              Password (Min. 6 Characters) *
            </Text>
            <View
              style={[
                styles.inputContainerBox,
                { backgroundColor: theme.bgElevated, borderColor: theme.border },
              ]}
            >
              <MaterialCommunityIcons
                name="lock-outline"
                size={18}
                color={theme.muted}
                style={styles.inputPrefixIcon}
              />
              <TextInput
                style={[styles.textInputBox, { color: theme.text }]}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="Create secure password"
                placeholderTextColor={theme.muted}
              />
              <Pressable
                onPress={() => setShowPassword((v) => !v)}
                style={styles.eyeBtn}
              >
                <MaterialCommunityIcons
                  name={showPassword ? "eye-off-outline" : "eye-outline"}
                  size={18}
                  color={theme.muted}
                />
              </Pressable>
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text
              style={[styles.fieldLabelText, { color: theme.textSecondary }]}
            >
              Confirm Password *
            </Text>
            <View
              style={[
                styles.inputContainerBox,
                { backgroundColor: theme.bgElevated, borderColor: theme.border },
              ]}
            >
              <MaterialCommunityIcons
                name="lock-check-outline"
                size={18}
                color={theme.muted}
                style={styles.inputPrefixIcon}
              />
              <TextInput
                style={[styles.textInputBox, { color: theme.text }]}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showPassword}
                placeholder="Confirm password"
                placeholderTextColor={theme.muted}
              />
            </View>
          </View>

          {/* Error Banner */}
          {!!error && (
            <View
              style={[
                styles.errorBannerBox,
                {
                  backgroundColor: theme.roseGlow,
                  borderColor: theme.rose,
                  marginTop: 4,
                },
              ]}
            >
              <MaterialCommunityIcons
                name="alert-circle-outline"
                size={17}
                color={theme.rose}
              />
              <Text style={[styles.errorBannerText, { color: theme.rose }]}>
                {error}
              </Text>
            </View>
          )}

          {/* Submit CTA */}
          <Pressable
            style={[
              styles.submitButtonGlow,
              {
                backgroundColor: theme.cyan,
                marginTop: 8,
                shadowColor: theme.cyan,
              },
              busy && { opacity: 0.75 },
            ]}
            onPress={handleRegister}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <View style={styles.submitRow}>
                <Text
                  style={[styles.submitTextAction, { color: "#FFFFFF" }]}
                >
                  Register & Generate Pass
                </Text>
                <MaterialCommunityIcons
                  name="qrcode-scan"
                  size={18}
                  color="#FFFFFF"
                />
              </View>
            )}
          </Pressable>
        </View>

        <Text
          style={[styles.loginFootnote, { color: theme.muted, marginTop: 16 }]}
        >
          Pratyaksh Academic Portal • Visitor Management System
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// OTHERS / VISITOR REGISTRATION SUCCESS VIEW
// ---------------------------------------------------------------------------
function OthersRegistrationSuccessView({
  visitor,
  onContinue,
}: {
  visitor: any;
  onContinue: () => void;
}) {
  const { theme, isDark } = useAppTheme();

  const handleDownload = async () => {
    const downloadUrl = `${http.defaults.baseURL || API}/visitors/${visitor.visitor_id}/qr`;
    if (Platform.OS === "web") {
      try {
        const link = document.createElement("a");
        link.href = visitor.qr_data_uri || downloadUrl;
        link.download = `visitor_pass_${visitor.visitor_id}.png`;
        link.click();
      } catch {
        if (typeof window !== "undefined") {
          window.open(visitor.qr_data_uri || downloadUrl, "_blank");
        }
      }
    } else {
      try {
        const fileUri = `${FileSystem.documentDirectory}visitor_pass_${visitor.visitor_id}.png`;
        const res = await FileSystem.downloadAsync(downloadUrl, fileUri);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(res.uri);
        } else {
          Alert.alert("Pass Downloaded", `Saved pass to:\n${res.uri}`);
        }
      } catch {
        Linking.openURL(downloadUrl).catch(() => {
          Alert.alert(
            "Pass QR Code",
            `Access your pass online at:\n${downloadUrl}`,
          );
        });
      }
    }
  };

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        { backgroundColor: theme.bg, paddingTop: STATUS_BAR_HEIGHT },
      ]}
    >
      <StatusBar style={theme.statusBarStyle} />
      <ScrollView
        contentContainerStyle={styles.loginScroll}
        showsVerticalScrollIndicator={false}
      >
        <View
          style={[
            styles.loginSurfaceCard,
            {
              backgroundColor: theme.cardGlass,
              borderColor: theme.borderBright,
              alignItems: "center",
              paddingVertical: 28,
            },
          ]}
        >
          {/* Success Checkmark Circle */}
          <View
            style={{
              width: 58,
              height: 58,
              borderRadius: 29,
              backgroundColor: theme.emeraldGlow || "rgba(16, 185, 129, 0.15)",
              borderWidth: 2,
              borderColor: theme.emerald || "#10B981",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
            }}
          >
            <MaterialCommunityIcons
              name="check-bold"
              size={30}
              color={theme.emerald || "#10B981"}
            />
          </View>

          <Text
            style={[
              styles.cardHeaderTitle,
              { color: theme.text, textAlign: "center" },
            ]}
          >
            Registration Successful!
          </Text>
          <Text
            style={{
              color: theme.textSecondary,
              fontSize: 13,
              textAlign: "center",
              marginTop: 4,
              marginBottom: 18,
            }}
          >
            Your official campus visitor pass and credentials have been created.
          </Text>

          {/* Visitor ID Badge */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              backgroundColor: theme.bgElevated,
              paddingHorizontal: 16,
              paddingVertical: 8,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: theme.cyan,
              marginBottom: 20,
            }}
          >
            <MaterialCommunityIcons
              name="badge-account-outline"
              size={18}
              color={theme.cyan}
            />
            <Text
              style={{
                color: theme.cyan,
                fontSize: 14,
                fontWeight: "700",
                letterSpacing: 0.5,
              }}
            >
              {visitor.visitor_id}
            </Text>
          </View>

          {/* Generated QR Code Card */}
          <View
            style={{
              backgroundColor: "#FFFFFF",
              padding: 16,
              borderRadius: 16,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: 0.15,
              shadowRadius: 12,
              elevation: 4,
              marginBottom: 16,
              alignItems: "center",
            }}
          >
            {visitor.qr_data_uri ? (
              <Image
                source={{ uri: visitor.qr_data_uri }}
                style={{ width: 200, height: 200 }}
                resizeMode="contain"
              />
            ) : (
              <ActivityIndicator color="#000" size="large" />
            )}
            <Text
              style={{
                color: "#334155",
                fontSize: 11,
                fontWeight: "600",
                marginTop: 8,
              }}
            >
              OFFICIAL VISITOR PASS
            </Text>
          </View>

          {/* Summary Details */}
          <View
            style={{
              width: "100%",
              backgroundColor: theme.bgElevated,
              borderRadius: 12,
              padding: 14,
              marginBottom: 20,
              borderWidth: 1,
              borderColor: theme.border,
            }}
          >
            <HoloDetailRow label="Visitor Name" value={visitor.full_name} />
            <HoloDetailRow label="Email / Login ID" value={visitor.email} />
            <HoloDetailRow
              label="Registered At"
              value={new Date(visitor.registration_date).toLocaleString()}
            />
          </View>

          {/* Download & Action Buttons */}
          <View style={{ width: "100%", gap: 10 }}>
            <Pressable
              style={[
                styles.submitButtonGlow,
                {
                  backgroundColor: theme.bgElevated,
                  borderColor: theme.cyan,
                  borderWidth: 1,
                },
              ]}
              onPress={handleDownload}
            >
              <View style={styles.submitRow}>
                <MaterialCommunityIcons
                  name="download-outline"
                  size={18}
                  color={theme.cyan}
                />
                <Text style={[styles.submitTextAction, { color: theme.cyan }]}>
                  Download QR Code
                </Text>
              </View>
            </Pressable>

            <Pressable
              style={[
                styles.submitButtonGlow,
                {
                  backgroundColor: theme.cyan,
                },
              ]}
              onPress={onContinue}
            >
              <View style={styles.submitRow}>
                <Text style={[styles.submitTextAction, { color: "#FFFFFF" }]}>
                  Continue to Login
                </Text>
                <MaterialCommunityIcons
                  name="arrow-right"
                  size={18}
                  color="#FFFFFF"
                />
              </View>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// OTHERS / VISITOR DASHBOARD & PASS VIEW
// ---------------------------------------------------------------------------
function OthersDashboardView({
  user,
  onLogout,
  isProfileTab,
}: {
  user: any;
  onLogout: () => void;
  isProfileTab?: boolean;
}) {
  const { theme, isDark } = useAppTheme();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const fetchProfile = useCallback(() => {
    setLoading(true);
    setError("");
    http
      .get("/visitors/me")
      .then((res) => {
        setProfile(res.data);
      })
      .catch((err) => {
        setError(
          err.response?.data?.detail || "Could not load visitor profile.",
        );
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  const handleDownload = async () => {
    if (!profile) return;
    const downloadUrl = `${http.defaults.baseURL || API}/visitors/${profile.visitor_id}/qr`;
    if (Platform.OS === "web") {
      try {
        const link = document.createElement("a");
        link.href = profile.qr_data_uri || downloadUrl;
        link.download = `visitor_pass_${profile.visitor_id}.png`;
        link.click();
      } catch {
        if (typeof window !== "undefined") {
          window.open(profile.qr_data_uri || downloadUrl, "_blank");
        }
      }
    } else {
      try {
        const fileUri = `${FileSystem.documentDirectory}visitor_pass_${profile.visitor_id}.png`;
        const res = await FileSystem.downloadAsync(downloadUrl, fileUri);
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(res.uri);
        } else {
          Alert.alert("Pass Downloaded", `Saved pass to:\n${res.uri}`);
        }
      } catch {
        Linking.openURL(downloadUrl).catch(() => {
          Alert.alert(
            "Pass QR Code",
            `Access your pass online at:\n${downloadUrl}`,
          );
        });
      }
    }
  };

  if (loading && !refreshing) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <ActivityIndicator size="large" color={theme.cyan} />
        <Text
          style={{
            color: theme.textSecondary,
            marginTop: 12,
            fontSize: 13,
          }}
        >
          Loading Visitor Pass...
        </Text>
      </View>
    );
  }

  if (error || !profile) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <MaterialCommunityIcons
          name="alert-circle-outline"
          size={48}
          color={theme.rose}
        />
        <Text
          style={{
            color: theme.text,
            fontSize: 16,
            fontWeight: "700",
            marginTop: 12,
          }}
        >
          Visitor Profile Error
        </Text>
        <Text
          style={{
            color: theme.textSecondary,
            fontSize: 13,
            textAlign: "center",
            marginTop: 6,
          }}
        >
          {error || "Unable to retrieve your visitor details."}
        </Text>
        <Pressable
          style={[
            styles.smallActionBtn,
            {
              backgroundColor: theme.cyan,
              marginTop: 16,
              paddingHorizontal: 20,
            },
          ]}
          onPress={fetchProfile}
        >
          <Text style={{ color: "#FFFFFF", fontWeight: "700" }}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            fetchProfile();
          }}
          tintColor={theme.cyan}
        />
      }
    >
      {/* Visitor Pass Header Card */}
      <View
        style={[
          styles.loginSurfaceCard,
          {
            backgroundColor: theme.cardGlass,
            borderColor: theme.borderBright,
            marginBottom: 16,
            alignItems: "center",
          },
        ]}
      >
        <View
          style={{
            width: "100%",
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <MaterialCommunityIcons
              name="shield-check"
              size={22}
              color={theme.cyan}
            />
            <Text style={{ color: theme.text, fontSize: 16, fontWeight: "700" }}>
              Campus Visitor Pass
            </Text>
          </View>
          <View
            style={[
              styles.statusPillHolo,
              {
                backgroundColor:
                  theme.emeraldGlow || "rgba(16,185,129,0.15)",
                borderColor: theme.emerald || "#10B981",
                borderWidth: 1,
              },
            ]}
          >
            <Text
              style={{
                color: theme.emerald || "#10B981",
                fontSize: 11,
                fontWeight: "700",
              }}
            >
              {profile.status}
            </Text>
          </View>
        </View>

        <Text
          style={{
            color: theme.muted,
            fontSize: 11,
            letterSpacing: 0.5,
            marginBottom: 4,
          }}
        >
          OFFICIAL BADGE IDENTIFIER
        </Text>
        <Text
          style={{
            color: theme.cyan,
            fontSize: 18,
            fontWeight: "800",
            letterSpacing: 1,
            marginBottom: 16,
          }}
        >
          {profile.visitor_id}
        </Text>

        {/* QR Code Presentation Box */}
        <View
          style={{
            backgroundColor: "#FFFFFF",
            padding: 16,
            borderRadius: 16,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.12,
            shadowRadius: 10,
            elevation: 3,
            marginBottom: 16,
            alignItems: "center",
          }}
        >
          {profile.qr_data_uri ? (
            <Image
              source={{ uri: profile.qr_data_uri }}
              style={{ width: 190, height: 190 }}
              resizeMode="contain"
            />
          ) : (
            <ActivityIndicator color="#000" />
          )}
          <Text
            style={{
              color: "#475569",
              fontSize: 10,
              fontWeight: "600",
              marginTop: 6,
              letterSpacing: 0.3,
            }}
          >
            SCAN AT CAMPUS ENTRY GATES
          </Text>
        </View>

        {/* Download Pass Action */}
        <Pressable
          style={[
            styles.submitButtonGlow,
            {
              width: "100%",
              backgroundColor: theme.bgElevated,
              borderColor: theme.cyan,
              borderWidth: 1,
              height: 42,
            },
          ]}
          onPress={handleDownload}
        >
          <View style={styles.submitRow}>
            <MaterialCommunityIcons
              name="download"
              size={17}
              color={theme.cyan}
            />
            <Text
              style={[
                styles.submitTextAction,
                { color: theme.cyan, fontSize: 13 },
              ]}
            >
              Download Pass Image (PNG)
            </Text>
          </View>
        </Pressable>
      </View>

      {/* Visitor Details Card */}
      <View
        style={[
          styles.loginSurfaceCard,
          {
            backgroundColor: theme.cardGlass,
            borderColor: theme.borderBright,
            marginBottom: 16,
          },
        ]}
      >
        <Text
          style={{
            color: theme.cyan,
            fontSize: 12,
            fontWeight: "700",
            letterSpacing: 0.5,
            marginBottom: 12,
          }}
        >
          VISITOR IDENTIFICATION & LOGISTICS
        </Text>
        <HoloDetailRow label="Visitor ID" value={profile.visitor_id} />
        <HoloDetailRow label="Full Name" value={profile.full_name} />
        <HoloDetailRow label="Email Address" value={profile.email} />
        <HoloDetailRow label="Contact Phone" value={profile.phone} />
        <HoloDetailRow
          label="Purpose of Visit"
          value={
            profile.purpose_other
              ? `${profile.purpose_of_visit} (${profile.purpose_other})`
              : profile.purpose_of_visit
          }
        />
        <HoloDetailRow
          label="Expected Check-In"
          value={new Date(profile.expected_check_in).toLocaleString()}
        />
        <HoloDetailRow
          label="Expected Check-Out"
          value={new Date(profile.expected_check_out).toLocaleString()}
        />
        <HoloDetailRow
          label="ID Document Type"
          value={profile.identification_type}
        />
        <HoloDetailRow
          label="ID Number (Masked)"
          value={profile.identification_number_masked}
        />
        <HoloDetailRow
          label="Registration Date"
          value={new Date(profile.registration_date).toLocaleString()}
        />
      </View>

      {/* Security Protection Notice */}
      <View
        style={{
          backgroundColor: theme.bgElevated,
          borderRadius: 12,
          padding: 14,
          marginBottom: 20,
          borderWidth: 1,
          borderColor: theme.border,
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            marginBottom: 6,
          }}
        >
          <MaterialCommunityIcons
            name="shield-lock-outline"
            size={16}
            color={theme.cyan}
          />
          <Text
            style={{ color: theme.cyan, fontSize: 12, fontWeight: "700" }}
          >
            PRIVACY & CREDENTIAL SECURITY
          </Text>
        </View>
        <Text
          style={{
            color: theme.textSecondary,
            fontSize: 11,
            lineHeight: 17,
          }}
        >
          This QR pass contains non-sensitive identity metadata for physical
          campus entry verification. Authoritative access is verified against
          server records by campus security. Complete identification numbers
          are cryptographically hashed and never stored or returned in
          plaintext.
        </Text>
      </View>

      {/* Logout Button */}
      <Pressable
        style={[
          styles.submitButtonGlow,
          {
            backgroundColor: theme.roseGlow || "rgba(244,63,94,0.15)",
            borderColor: theme.rose,
            borderWidth: 1,
            height: 44,
          },
        ]}
        onPress={() => {
          Alert.alert(
            "Sign Out",
            "Are you sure you want to end your visitor session?",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Sign Out",
                style: "destructive",
                onPress: onLogout,
              },
            ],
          );
        }}
      >
        <View style={styles.submitRow}>
          <MaterialCommunityIcons
            name="logout"
            size={18}
            color={theme.rose}
          />
          <Text style={[styles.submitTextAction, { color: theme.rose }]}>
            Sign Out
          </Text>
        </View>
      </Pressable>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// APP SHELL & FLOATING ISLAND NAVIGATION
// ---------------------------------------------------------------------------
function AppShell({ user, onLogout }: { user: any; onLogout: () => void }) {
  const { theme, isDark, toggleTheme } = useAppTheme();

  useEffect(() => {
    if (user.token) {
      http.defaults.headers.common.Authorization = `Bearer ${user.token}`;
    }
  }, [user.token]);

  const role = (user.role || "admin") as Role;

  const tabs = useMemo(() => {
    if (role === "admin") {
      return ["Dashboard", "Students", "Teachers", "Attendance", "QR", "Profile"];
    }
    if (role === "teacher") {
      return ["Dashboard", "Attendance", "History", "QR", "Profile"];
    }
    if (role === "others") {
      return ["Dashboard", "QR", "Profile"];
    }
    return ["Dashboard", "Attendance", "Classes", "QR", "Profile"];
  }, [role]);

  const [activeTab, setActiveTab] = useState("Dashboard");
  const [unreadCount, setUnreadCount] = useState(0);
  const [showTopMenu, setShowTopMenu] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [currentApi, setCurrentApi] = useState(API);
  const [customInput, setCustomInput] = useState(API);
  const [testingCustom, setTestingCustom] = useState(false);
  const [testStatus, setTestStatus] = useState<
    "checking" | "online" | "offline"
  >("online");
  const screenOpacity = useRef(new Animated.Value(1)).current;
  const screenLift = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    screenOpacity.setValue(0.96);
    screenLift.setValue(8);
    Animated.timing(screenOpacity, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
    Animated.timing(screenLift, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [activeTab, screenOpacity, screenLift]);

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
    user.display_name ||
    user.name ||
    user.username ||
    (role === "admin" ? "Admin" : role === "others" ? "Visitor" : "User");

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        { backgroundColor: theme.bg, paddingTop: STATUS_BAR_HEIGHT },
      ]}
    >
      <StatusBar style={theme.statusBarStyle} />

      {/* ── Premium Frosted Glass Top Bar ── */}
      <View
        style={[
          styles.topGlassBar,
          {
            backgroundColor: theme.cardGlass,
            borderBottomColor: theme.divider ?? theme.border,
            shadowColor: theme.mode === "dark" ? "#000" : "#9FB3CE",
            shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.18,
            shadowRadius: 8,
            elevation: 6,
          },
        ]}
      >
        {/* LEFT: Logo + Identity */}
        <View style={styles.topBarLeft}>
          <View
            style={[
              styles.brandBadgeWrap,
              {
                backgroundColor: theme.card,
                borderColor: theme.borderBright,
              },
            ]}
          >
            <Image
              source={require("./assets/pratyaksha-logo.jpg")}
              style={styles.brandThumbLogo}
              resizeMode="contain"
            />
          </View>
          <View style={{ justifyContent: "center" }}>
            <View style={styles.brandNameRow}>
              <Text style={[styles.brandHeaderTitle, { color: theme.text }]}>
                Pratyaksh
              </Text>
              <View
                style={[
                  styles.roleChipPill,
                  {
                    backgroundColor: theme.cyanGlow,
                    borderColor: theme.borderAccent,
                  },
                ]}
              >
                <Text style={[styles.roleChipText, { color: theme.cyan }]}>
                  {role === "admin"
                    ? "ADMIN"
                    : role === "teacher"
                      ? "FACULTY"
                      : role === "others"
                        ? "VISITOR"
                        : "STUDENT"}
                </Text>
              </View>
            </View>
            <Text
              style={[styles.greetingHeaderSub, { color: theme.textSecondary }]}
            >
              {getGreeting()}, {displayName.split(" ")[0]}
            </Text>
          </View>
        </View>

        {/* RIGHT: Actions */}
        <View style={styles.topBarRight}>
          {/* Theme Toggle */}
          <Pressable
            onPress={toggleTheme}
            style={[
              styles.topIconBtn,
              {
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(37,99,235,0.06)",
                borderColor: theme.border,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={isDark ? "white-balance-sunny" : "moon-waning-crescent"}
              size={17}
              color={isDark ? theme.amber : theme.blue}
            />
          </Pressable>

          {/* Notification Bell */}
          <Pressable
            onPress={() => setActiveTab("Alerts")}
            accessibilityRole="button"
            accessibilityLabel={`Notifications${unreadCount > 0 ? `, ${unreadCount} unread` : ""}`}
            style={[
              styles.topIconBtn,
              {
                backgroundColor:
                  activeTab === "Alerts"
                    ? theme.cyanGlow
                    : isDark
                      ? "rgba(255,255,255,0.06)"
                      : "rgba(37,99,235,0.06)",
                borderColor:
                  activeTab === "Alerts" ? theme.borderAccent : theme.border,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={unreadCount > 0 ? "bell-badge-outline" : "bell-outline"}
              size={17}
              color={
                activeTab === "Alerts"
                  ? theme.cyan
                  : unreadCount > 0
                    ? theme.amber
                    : theme.textSecondary
              }
            />
            {unreadCount > 0 && (
              <View
                style={[
                  styles.badgeDotGlow,
                  {
                    backgroundColor: theme.rose,
                    borderColor: theme.bg,
                    borderWidth: 1.5,
                  },
                ]}
              />
            )}
          </Pressable>

          {/* Avatar */}
          <Pressable
            onPress={() => setActiveTab("Profile")}
            accessibilityRole="button"
            accessibilityLabel="Open profile"
            style={[
              styles.topAvatarPill,
              {
                backgroundColor:
                  activeTab === "Profile" ? theme.cyanGlow : theme.card,
                borderColor:
                  activeTab === "Profile" ? theme.cyan : theme.borderBright,
              },
            ]}
          >
            {user.profile_photo_base64 ? (
              <Image
                source={{ uri: user.profile_photo_base64 }}
                style={styles.avatarImg}
              />
            ) : (
              <Text style={[styles.avatarInitialText, { color: theme.cyan }]}>
                {displayName.charAt(0).toUpperCase()}
              </Text>
            )}
          </Pressable>

          {/* Three-Dot Menu (Top-Right) */}
          <Pressable
            onPress={() => setShowTopMenu(true)}
            accessibilityRole="button"
            accessibilityLabel="More options"
            style={[
              styles.topIconBtn,
              {
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.06)"
                  : "rgba(37,99,235,0.06)",
                borderColor: theme.border,
              },
            ]}
          >
            <MaterialCommunityIcons
              name="dots-vertical"
              size={18}
              color={theme.text}
            />
          </Pressable>
        </View>
      </View>

      {/* ── Main Content ── */}
      <ScrollView
        contentContainerStyle={styles.scrollContentBody}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={{ opacity: screenOpacity, transform: [{ translateY: screenLift }] }}
        >
          <ScreenRenderer
            screen={activeTab}
            role={role}
            user={user}
            go={setActiveTab}
            onLogout={onLogout}
          />
        </Animated.View>
      </ScrollView>

      {/* ── Premium Floating Bottom Navigation Dock ── */}
      <View
        style={[
          styles.bottomFloatingIsland,
          {
            backgroundColor: theme.navBg,
            borderColor: theme.borderBright,
            shadowColor: "#000",
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: theme.mode === "dark" ? 0.35 : 0.08,
            shadowRadius: 16,
            elevation: 8,
          },
        ]}
      >
        {tabs.map((tabName) => {
          const isActive = activeTab === tabName;
          const iconInfo = getNavigationTabIcon(tabName, role);
          return (
            <Pressable
              key={tabName}
              onPress={() => setActiveTab(tabName)}
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`${iconInfo.label} tab`}
              style={styles.bottomTabButton}
            >
              <View
                style={[
                  styles.tabIconContainer,
                  isActive && [
                    styles.tabIconContainerActive,
                    {
                      backgroundColor: theme.cyanGlow,
                      borderRadius: 10,
                      paddingHorizontal: 12,
                    },
                  ],
                ]}
              >
                <MaterialCommunityIcons
                  name={
                    isActive
                      ? (iconInfo.name.replace("-outline", "") as any)
                      : (iconInfo.name as any)
                  }
                  size={20}
                  color={isActive ? theme.cyan : theme.muted}
                />
              </View>
              <Text
                style={[
                  styles.tabLabelText,
                  {
                    color: isActive ? theme.cyan : theme.muted,
                    fontWeight: isActive ? "700" : "500",
                  },
                ]}
                numberOfLines={1}
              >
                {iconInfo.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Executive Dropdown Menu Modal */}
      <Modal
        visible={showTopMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowTopMenu(false)}
      >
        <Pressable
          style={styles.modalBackdropOverlay}
          onPress={() => setShowTopMenu(false)}
        >
          <View
            style={[
              styles.topMenuDropdownCard,
              {
                backgroundColor: theme.cardGlass,
                borderColor: theme.borderBright,
              },
            ]}
          >
            <View style={styles.topMenuHeader}>
              <Text style={[styles.topMenuTitle, { color: theme.text }]}>
                {displayName}
              </Text>
              <Text style={{ fontSize: 11, color: theme.muted }}>
                {role.toUpperCase()}
              </Text>
            </View>

            <View style={[styles.menuDivider, { backgroundColor: theme.divider }]} />

            <Pressable
              style={styles.topMenuItem}
              onPress={() => {
                setShowTopMenu(false);
                setActiveTab("Connections");
              }}
            >
              <MaterialCommunityIcons
                name="account-multiple-outline"
                size={18}
                color={theme.cyan}
              />
              <Text style={[styles.topMenuItemText, { color: theme.text }]}>
                My Connections
              </Text>
            </Pressable>

            <Pressable
              style={styles.topMenuItem}
              onPress={() => {
                setShowTopMenu(false);
                setActiveTab("QR");
              }}
            >
              <MaterialCommunityIcons
                name="qrcode-scan"
                size={18}
                color={theme.emerald}
              />
              <Text style={[styles.topMenuItemText, { color: theme.text }]}>
                QR Code & Scanner
              </Text>
            </Pressable>

            <Pressable
              style={styles.topMenuItem}
              onPress={() => {
                setShowTopMenu(false);
                setShowServerModal(true);
              }}
            >
              <MaterialCommunityIcons
                name="server-network"
                size={18}
                color={theme.amber}
              />
              <Text style={[styles.topMenuItemText, { color: theme.text }]}>
                Server Connection
              </Text>
            </Pressable>

            <Pressable
              style={styles.topMenuItem}
              onPress={() => {
                toggleTheme();
                setShowTopMenu(false);
              }}
            >
              <MaterialCommunityIcons
                name={isDark ? "white-balance-sunny" : "moon-waning-crescent"}
                size={18}
                color={isDark ? theme.amber : theme.blue}
              />
              <Text style={[styles.topMenuItemText, { color: theme.text }]}>
                {isDark ? "Light Mode" : "Dark Mode"}
              </Text>
            </Pressable>

            <View style={[styles.menuDivider, { backgroundColor: theme.divider }]} />

            <Pressable
              style={styles.topMenuItem}
              onPress={() => {
                setShowTopMenu(false);
                onLogout();
              }}
            >
              <MaterialCommunityIcons
                name="logout-variant"
                size={18}
                color={theme.rose}
              />
              <Text style={[styles.topMenuItemText, { color: theme.rose }]}>
                Log Out
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Backend Server Configuration Modal */}
      <Modal
        visible={showServerModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowServerModal(false)}
      >
        <Pressable
          style={styles.modalBackdropOverlay}
          onPress={() => setShowServerModal(false)}
        >
          <Pressable
            style={[
              styles.modalSheetCard,
              {
                backgroundColor: theme.cardGlass,
                borderColor: theme.borderBright,
              },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalSheetHeader}>
              <Text style={[styles.modalSheetTitle, { color: theme.text }]}>
                Server Connection (Docker)
              </Text>
              <Pressable onPress={() => setShowServerModal(false)}>
                <MaterialCommunityIcons
                  name="close"
                  size={22}
                  color={theme.text}
                />
              </Pressable>
            </View>

            <Text
              style={[
                styles.fieldLabelText,
                { color: theme.muted, marginTop: 10 },
              ]}
            >
              API ADDRESS (HOST OR LAN IP)
            </Text>
            <View
              style={[
                styles.inputContainerBox,
                {
                  backgroundColor: theme.bgElevated,
                  borderColor: theme.borderAccent,
                },
              ]}
            >
              <TextInput
                style={[styles.textInputBox, { color: theme.text }]}
                value={customInput}
                onChangeText={setCustomInput}
                placeholder="http://localhost:8000"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
              />
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <Pressable
                style={[
                  styles.smallActionBtn,
                  {
                    flex: 1,
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.cyan,
                    paddingVertical: 12,
                  },
                ]}
                onPress={async () => {
                  setTestingCustom(true);
                  try {
                    const cleaned = customInput.trim().replace(/\/+$/, "");
                    const res = await axios.get(`${cleaned}/health`, {
                      timeout: 5000,
                    });
                    if (res.data?.status === "ok") {
                      Alert.alert(
                        "Connection Success ✓",
                        `Successfully connected to Docker backend!\n\nStatus: ${res.data.status}\nModel Loaded: ${res.data.model_loaded}\nDatabase: ${res.data.database}`,
                      );
                    }
                  } catch (err: any) {
                    Alert.alert(
                      "Connection Failed ✗",
                      `Could not reach ${customInput}.\n\nReason: ${err.message}\n\nVerify Docker container is running and port is exposed.`,
                    );
                  } finally {
                    setTestingCustom(false);
                  }
                }}
                disabled={testingCustom}
              >
                {testingCustom ? (
                  <ActivityIndicator size="small" color={theme.cyan} />
                ) : (
                  <>
                    <MaterialCommunityIcons
                      name="lan-connect"
                      size={16}
                      color={theme.cyan}
                    />
                    <Text
                      style={[styles.smallActionBtnText, { color: theme.cyan }]}
                    >
                      TEST PING
                    </Text>
                  </>
                )}
              </Pressable>

              <Pressable
                style={[
                  styles.smallActionBtn,
                  {
                    flex: 1,
                    backgroundColor: theme.cyan,
                    borderColor: theme.cyan,
                    paddingVertical: 12,
                  },
                ]}
                onPress={() => {
                  const cleaned = customInput.trim().replace(/\/+$/, "");
                  updateApiBaseUrl(cleaned);
                  setCurrentApi(cleaned);
                  setShowServerModal(false);
                  axios
                    .get(`${cleaned}/health`, { timeout: 4000 })
                    .then(() => setTestStatus("online"))
                    .catch(() => setTestStatus("offline"));
                  Alert.alert(
                    "Server Configured",
                    `API URL updated to:\n${cleaned}`,
                  );
                }}
              >
                <MaterialCommunityIcons
                  name="content-save-outline"
                  size={16}
                  color="#000"
                />
                <Text
                  style={[
                    styles.smallActionBtnText,
                    { color: "#000", fontWeight: "700" },
                  ]}
                >
                  SAVE & USE
                </Text>
              </Pressable>
            </View>

            <Text
              style={[
                styles.fieldLabelText,
                { color: theme.muted, marginTop: 18 },
              ]}
            >
              QUICK PRESETS
            </Text>

            <View style={{ gap: 8, marginTop: 6 }}>
              {[
                {
                  label: "Localhost Direct (Port 8000)",
                  url: "http://localhost:8000",
                },
                {
                  label: "Localhost Nginx (Port 8080)",
                  url: "http://localhost:8080",
                },
                {
                  label: "Host Wi-Fi Direct (Port 8000)",
                  url: "http://192.168.0.108:8000",
                },
                {
                  label: "Host Wi-Fi Nginx (Port 8080)",
                  url: "http://192.168.0.108:8080",
                },
                {
                  label: "Android Emulator (Port 8000)",
                  url: "http://10.0.2.2:8000",
                },
                {
                  label: "Tailscale Funnel (Remote)",
                  url: "https://cair-ms-7e06.tail49e3b1.ts.net",
                },
              ].map((preset) => (
                <Pressable
                  key={preset.url}
                  style={[
                    styles.rosterItemCard,
                    {
                      paddingVertical: 10,
                      backgroundColor: theme.bgElevated,
                      borderColor:
                        currentApi === preset.url ? theme.cyan : theme.border,
                    },
                  ]}
                  onPress={() => {
                    setCustomInput(preset.url);
                    updateApiBaseUrl(preset.url);
                    setCurrentApi(preset.url);
                    setShowServerModal(false);
                    axios
                      .get(`${preset.url}/health`, { timeout: 4000 })
                      .then(() => setTestStatus("online"))
                      .catch(() => setTestStatus("offline"));
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        color: theme.text,
                        fontSize: 13,
                        fontWeight: "600",
                      }}
                    >
                      {preset.label}
                    </Text>
                    <Text
                      style={{ color: theme.muted, fontSize: 11, marginTop: 2 }}
                    >
                      {preset.url}
                    </Text>
                  </View>
                  {currentApi === preset.url && (
                    <MaterialCommunityIcons
                      name="check-circle"
                      size={18}
                      color={theme.cyan}
                    />
                  )}
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// QR CODE IDENTITY, SCANNER & MUTUAL CONNECTIONS SCREEN
// ---------------------------------------------------------------------------
function QRScreen({
  role,
  user,
  go,
}: {
  role: Role;
  user: any;
  go: (s: string) => void;
}) {
  const { theme, isDark } = useAppTheme();
  const [activeOption, setActiveOption] = useState<"scan" | "view">("scan");

  // Option A (Scan QR) State
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<"front" | "back">(DEFAULT_CAMERA_FACING);
  const [scannedData, setScannedData] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [targetPreview, setTargetPreview] = useState<any | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectSuccess, setConnectSuccess] = useState(false);
  const [scanError, setScanError] = useState("");
  const [showManualModal, setShowManualModal] = useState(false);
  const [manualText, setManualText] = useState("");
  const isCooldownRef = useRef(false);

  // Option B (View My QR) State
  const [myQr, setMyQr] = useState<any | null>(null);
  const [loadingMyQr, setLoadingMyQr] = useState(false);
  const [myQrError, setMyQrError] = useState("");

  const loadMyQr = useCallback(async () => {
    setLoadingMyQr(true);
    setMyQrError("");
    try {
      const res = await http.get("/connections/my-qr");
      setMyQr(res.data);
    } catch (e: any) {
      setMyQrError(apiErrorMessage(e, "Could not load QR identity"));
    } finally {
      setLoadingMyQr(false);
    }
  }, []);

  useEffect(() => {
    if (activeOption === "view") {
      loadMyQr();
    }
  }, [activeOption, loadMyQr]);

  const verifyScannedPayload = async (rawString: string) => {
    if (!rawString || isCooldownRef.current) return;
    isCooldownRef.current = true;
    setVerifying(true);
    setScanError("");
    setTargetPreview(null);
    setConnectSuccess(false);

    try {
      const res = await http.post("/connections/verify-qr", { qr_data: rawString.trim() });
      if (res.data?.target_user) {
        setTargetPreview(res.data.target_user);
      }
    } catch (e: any) {
      setScanError(apiErrorMessage(e, "Unrecognized or invalid QR code."));
    } finally {
      setVerifying(false);
      setTimeout(() => {
        isCooldownRef.current = false;
      }, 1500);
    }
  };

  const handleBarcodeScanned = (scanningResult: any) => {
    if (verifying || isCooldownRef.current || targetPreview) return;
    const data = scanningResult?.data || scanningResult;
    if (typeof data === "string" && data.trim()) {
      setScannedData(data);
      verifyScannedPayload(data);
    }
  };

  const handleConnect = async () => {
    if (!targetPreview || connecting) return;
    setConnecting(true);
    try {
      await http.post("/connections/connect", {
        target_user_id: targetPreview.user_id,
        target_qr_id: targetPreview.qr_id,
      });
      setConnectSuccess(true);
      setTargetPreview((prev: any) => ({ ...prev, is_connected: true }));
      Alert.alert(
        "Connection Established! 🎉",
        `You are now mutually connected with ${targetPreview.display_name}. Both of you can view each other's profile details and photos.`,
        [
          { text: "View Connections", onPress: () => go("Connections") },
          { text: "Done", style: "cancel" },
        ]
      );
    } catch (e: any) {
      Alert.alert("Connection Failed", apiErrorMessage(e, "Unable to establish connection."));
    } finally {
      setConnecting(false);
    }
  };

  const resetScanner = () => {
    setScannedData(null);
    setTargetPreview(null);
    setScanError("");
    setConnectSuccess(false);
    isCooldownRef.current = false;
  };

  const pickQrImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 1,
      });
      if (!result.canceled && result.assets && result.assets.length > 0) {
        setShowManualModal(true);
      }
    } catch (err: any) {
      Alert.alert("Gallery Error", err.message);
    }
  };

  const getRoleBadgeColor = (r: string) => {
    switch ((r || "").toLowerCase()) {
      case "admin":
        return { bg: theme.cyanGlow, text: theme.cyan, border: theme.borderAccent };
      case "teacher":
      case "faculty":
        return { bg: theme.blueGlow, text: theme.blue, border: theme.borderAccent };
      case "student":
        return { bg: theme.emeraldGlow, text: theme.emerald, border: theme.emerald };
      case "others":
      case "other":
      case "visitor":
        return { bg: theme.amberGlow, text: theme.amber, border: theme.amber };
      default:
        return { bg: theme.cardSubtle, text: theme.textSecondary, border: theme.border };
    }
  };

  return (
    <View style={{ paddingBottom: 60 }}>
      {/* ── Top Header ── */}
      <View style={styles.sectionHeadingRow}>
        <View>
          <Text style={[styles.sectionTitleText, { color: theme.text }]}>
            Campus QR Network
          </Text>
          <Text style={[styles.sectionSubtitleText, { color: theme.textSecondary }]}>
            Scan & establish mutual connections across all roles
          </Text>
        </View>
        <Pressable
          style={[styles.smallActionBtn, { borderColor: theme.border, backgroundColor: theme.card }]}
          onPress={() => go("Connections")}
        >
          <MaterialCommunityIcons name="account-multiple-outline" size={16} color={theme.cyan} />
          <Text style={[styles.smallActionBtnText, { color: theme.cyan }]}>
            Connections
          </Text>
        </Pressable>
      </View>

      {/* ── Top Stacked Segment Tabs ── */}
      <View style={[styles.exportTabSegmentWrap, { backgroundColor: theme.bgElevated, borderColor: theme.border }]}>
        <Pressable
          style={[
            styles.exportTabBtn,
            activeOption === "scan" && [
              styles.exportTabBtnActive,
              { backgroundColor: theme.cyan, borderColor: theme.cyan },
            ],
          ]}
          onPress={() => {
            setActiveOption("scan");
            resetScanner();
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <MaterialCommunityIcons
              name="qrcode-scan"
              size={16}
              color={activeOption === "scan" ? "#000" : theme.textSecondary}
            />
            <Text
              style={[
                styles.exportTabBtnText,
                { color: activeOption === "scan" ? "#000" : theme.textSecondary, fontWeight: "700" },
              ]}
            >
              OPTION A: SCAN QR
            </Text>
          </View>
        </Pressable>

        <Pressable
          style={[
            styles.exportTabBtn,
            activeOption === "view" && [
              styles.exportTabBtnActive,
              { backgroundColor: theme.cyan, borderColor: theme.cyan },
            ],
          ]}
          onPress={() => setActiveOption("view")}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <MaterialCommunityIcons
              name="card-account-details-outline"
              size={16}
              color={activeOption === "view" ? "#000" : theme.textSecondary}
            />
            <Text
              style={[
                styles.exportTabBtnText,
                { color: activeOption === "view" ? "#000" : theme.textSecondary, fontWeight: "700" },
              ]}
            >
              OPTION B: VIEW MY QR
            </Text>
          </View>
        </Pressable>
      </View>

      {/* ── OPTION A: SCAN QR CODE ── */}
      {activeOption === "scan" && (
        <View>
          {targetPreview ? (
            <View
              style={[
                styles.exportCardBox,
                {
                  backgroundColor: theme.cardGlass,
                  borderColor: targetPreview.is_connected ? theme.emerald : theme.borderAccent,
                  marginTop: 8,
                },
              ]}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                <View
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 36,
                    borderWidth: 2,
                    borderColor: theme.cyan,
                    overflow: "hidden",
                    backgroundColor: theme.bgElevated,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {targetPreview.profile_photo_url ? (
                    <Image
                      source={{
                        uri: targetPreview.profile_photo_url.startsWith("http")
                          ? targetPreview.profile_photo_url
                          : `${http.defaults.baseURL || API}${targetPreview.profile_photo_url}?token=${user.token}`,
                      }}
                      style={{ width: 72, height: 72 }}
                      resizeMode="cover"
                    />
                  ) : (
                    <Text style={{ fontSize: 26, fontWeight: "700", color: theme.cyan }}>
                      {targetPreview.display_name?.charAt(0)?.toUpperCase() || "U"}
                    </Text>
                  )}
                </View>

                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <Text style={{ fontSize: 18, fontWeight: "700", color: theme.text }}>
                      {targetPreview.display_name}
                    </Text>
                    {(() => {
                      const badge = getRoleBadgeColor(targetPreview.role);
                      return (
                        <View
                          style={{
                            paddingHorizontal: 8,
                            paddingVertical: 2,
                            borderRadius: 6,
                            backgroundColor: badge.bg,
                            borderWidth: 1,
                            borderColor: badge.border,
                          }}
                        >
                          <Text style={{ fontSize: 10, fontWeight: "700", color: badge.text }}>
                            {targetPreview.role?.toUpperCase()}
                          </Text>
                        </View>
                      );
                    })()}
                  </View>

                  <Text style={{ fontSize: 13, color: theme.muted, marginTop: 4 }}>
                    ID: {targetPreview.identifier || targetPreview.username}
                  </Text>
                  {!!targetPreview.department && (
                    <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                      {targetPreview.department}
                    </Text>
                  )}
                </View>
              </View>

              <View style={[styles.menuDivider, { backgroundColor: theme.divider, marginVertical: 14 }]} />

              {targetPreview.is_self ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <MaterialCommunityIcons name="information-outline" size={18} color={theme.amber} />
                  <Text style={{ color: theme.amber, fontSize: 13, flex: 1 }}>
                    This is your own QR code. You cannot establish a connection with yourself.
                  </Text>
                </View>
              ) : targetPreview.is_connected ? (
                <View>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      backgroundColor: theme.emeraldGlow,
                      padding: 10,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: theme.emerald,
                      marginBottom: 12,
                    }}
                  >
                    <MaterialCommunityIcons name="check-decagram" size={18} color={theme.emerald} />
                    <Text style={{ color: theme.emerald, fontSize: 13, fontWeight: "600" }}>
                      Already Mutually Connected
                    </Text>
                  </View>
                  <Pressable
                    style={[styles.primaryNeonButton, { backgroundColor: theme.cyan }]}
                    onPress={() => go("Connections")}
                  >
                    <MaterialCommunityIcons name="account-multiple-check" size={18} color="#000" />
                    <Text style={{ color: "#000", fontWeight: "700", fontSize: 13 }}>
                      VIEW IN MY CONNECTIONS
                    </Text>
                  </Pressable>
                </View>
              ) : (
                <View>
                  <Text style={{ fontSize: 12, color: theme.muted, marginBottom: 12, lineHeight: 17 }}>
                    Connecting will establish a 2-way mutual link. Both you and {targetPreview.display_name} will be able to view each other's full profile cards and profile photos.
                  </Text>
                  <Pressable
                    style={[styles.primaryNeonButton, { backgroundColor: theme.cyan }]}
                    onPress={handleConnect}
                    disabled={connecting}
                  >
                    {connecting ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : (
                      <>
                        <MaterialCommunityIcons name="account-plus-outline" size={18} color="#000" />
                        <Text style={{ color: "#000", fontWeight: "700", fontSize: 13 }}>
                          CONNECT WITH {targetPreview.display_name?.toUpperCase()}
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              )}

              <Pressable
                style={[
                  styles.smallActionBtn,
                  {
                    marginTop: 12,
                    alignSelf: "center",
                    backgroundColor: "transparent",
                    borderColor: theme.border,
                  },
                ]}
                onPress={resetScanner}
              >
                <MaterialCommunityIcons name="refresh" size={15} color={theme.textSecondary} />
                <Text style={[styles.smallActionBtnText, { color: theme.textSecondary }]}>
                  SCAN ANOTHER CODE
                </Text>
              </Pressable>
            </View>
          ) : (
            <View
              style={[
                styles.exportCardBox,
                {
                  backgroundColor: theme.cardGlass,
                  borderColor: theme.borderBright,
                  padding: 14,
                },
              ]}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <Text style={{ fontSize: 13, fontWeight: "700", color: theme.text }}>
                  ALIGN QR CODE WITHIN VIEWFINDER
                </Text>
                <Pressable
                  onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
                  style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
                >
                  <MaterialCommunityIcons name="camera-flip-outline" size={17} color={theme.cyan} />
                  <Text style={{ color: theme.cyan, fontSize: 12, fontWeight: "600" }}>
                    Flip
                  </Text>
                </Pressable>
              </View>

              <View
                style={{
                  height: 300,
                  borderRadius: 14,
                  overflow: "hidden",
                  backgroundColor: "#000",
                  position: "relative",
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: theme.borderAccent,
                }}
              >
                {permission?.granted ? (
                  <CameraView
                    key={`qr-cam-${facing}`}
                    style={StyleSheet.absoluteFillObject}
                    facing={facing}
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    onBarcodeScanned={handleBarcodeScanned}
                  />
                ) : (
                  <View style={{ padding: 24, alignItems: "center" }}>
                    <MaterialCommunityIcons name="camera-off" size={42} color={theme.rose} />
                    <Text style={{ color: theme.text, marginTop: 12, textAlign: "center", fontWeight: "600" }}>
                      Camera Access Required
                    </Text>
                    <Text style={{ color: theme.muted, fontSize: 12, marginTop: 4, textAlign: "center" }}>
                      Camera permission is needed to scan QR codes for mutual connections.
                    </Text>
                    <Pressable
                      style={[
                        styles.smallActionBtn,
                        { backgroundColor: theme.cyan, borderColor: theme.cyan, marginTop: 14, paddingHorizontal: 16 },
                      ]}
                      onPress={requestPermission}
                    >
                      <Text style={{ color: "#000", fontWeight: "700" }}>ENABLE CAMERA</Text>
                    </Pressable>
                  </View>
                )}

                {permission?.granted && (
                  <View
                    style={{
                      width: 190,
                      height: 190,
                      borderWidth: 2,
                      borderColor: theme.cyan,
                      borderRadius: 16,
                      backgroundColor: "rgba(59, 130, 246, 0.05)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <MaterialCommunityIcons name="scan-helper" size={170} color={theme.cyan} style={{ opacity: 0.6 }} />
                  </View>
                )}

                {verifying && (
                  <View
                    style={{
                      ...StyleSheet.absoluteFillObject,
                      backgroundColor: "rgba(0,0,0,0.7)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ActivityIndicator size="large" color={theme.cyan} />
                    <Text style={{ color: "#fff", marginTop: 12, fontWeight: "600" }}>
                      Verifying QR Identity...
                    </Text>
                  </View>
                )}
              </View>

              {!!scanError && (
                <View
                  style={[
                    styles.errorBannerBox,
                    { backgroundColor: theme.roseGlow, borderColor: theme.rose, marginTop: 12 },
                  ]}
                >
                  <MaterialCommunityIcons name="alert-circle-outline" size={16} color={theme.rose} />
                  <Text style={[styles.errorBannerText, { color: theme.rose }]}>{scanError}</Text>
                </View>
              )}

              <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
                <Pressable
                  style={[
                    styles.smallActionBtn,
                    { flex: 1, backgroundColor: theme.bgElevated, borderColor: theme.border },
                  ]}
                  onPress={() => setShowManualModal(true)}
                >
                  <MaterialCommunityIcons name="keyboard-outline" size={16} color={theme.text} />
                  <Text style={[styles.smallActionBtnText, { color: theme.text }]}>
                    ENTER CODE
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.smallActionBtn,
                    { flex: 1, backgroundColor: theme.bgElevated, borderColor: theme.border },
                  ]}
                  onPress={pickQrImage}
                >
                  <MaterialCommunityIcons name="image-outline" size={16} color={theme.text} />
                  <Text style={[styles.smallActionBtnText, { color: theme.text }]}>
                    FROM GALLERY
                  </Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      )}

      {/* ── OPTION B: VIEW MY QR IDENTITY PASS ── */}
      {activeOption === "view" && (
        <View>
          {loadingMyQr ? (
            <View style={{ paddingVertical: 40, alignItems: "center" }}>
              <ActivityIndicator size="large" color={theme.cyan} />
              <Text style={{ color: theme.muted, marginTop: 12 }}>Generating Authenticated QR Pass...</Text>
            </View>
          ) : myQrError ? (
            <View style={[styles.errorBannerBox, { backgroundColor: theme.roseGlow, borderColor: theme.rose }]}>
              <MaterialCommunityIcons name="alert-circle-outline" size={16} color={theme.rose} />
              <Text style={[styles.errorBannerText, { color: theme.rose }]}>{myQrError}</Text>
            </View>
          ) : myQr ? (
            <View
              style={[
                styles.exportCardBox,
                {
                  backgroundColor: theme.cardGlass,
                  borderColor: theme.borderBright,
                  alignItems: "center",
                  paddingVertical: 24,
                  paddingHorizontal: 20,
                },
              ]}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  borderRadius: 20,
                  backgroundColor: theme.cyanGlow,
                  borderColor: theme.borderAccent,
                  borderWidth: 1,
                  marginBottom: 16,
                }}
              >
                <MaterialCommunityIcons name="shield-check-outline" size={14} color={theme.cyan} />
                <Text style={{ fontSize: 11, fontWeight: "700", color: theme.cyan, letterSpacing: 0.8 }}>
                  VERIFIED CAMPUS IDENTITY PASS
                </Text>
              </View>

              <View
                style={{
                  width: 80,
                  height: 80,
                  borderRadius: 40,
                  borderWidth: 3,
                  borderColor: theme.cyan,
                  overflow: "hidden",
                  backgroundColor: theme.bgElevated,
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 10,
                }}
              >
                {user.profile_photo_base64 || myQr.profile_photo_url ? (
                  <Image
                    source={{
                      uri: user.profile_photo_base64 || (myQr.profile_photo_url.startsWith("http")
                        ? myQr.profile_photo_url
                        : `${http.defaults.baseURL || API}${myQr.profile_photo_url}?token=${user.token}`),
                    }}
                    style={{ width: 80, height: 80 }}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={{ fontSize: 30, fontWeight: "700", color: theme.cyan }}>
                    {myQr.display_name?.charAt(0)?.toUpperCase() || "U"}
                  </Text>
                )}
              </View>

              <Text style={{ fontSize: 20, fontWeight: "700", color: theme.text, textAlign: "center" }}>
                {myQr.display_name}
              </Text>

              {(() => {
                const badge = getRoleBadgeColor(myQr.role);
                return (
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 3,
                      borderRadius: 6,
                      backgroundColor: badge.bg,
                      borderWidth: 1,
                      borderColor: badge.border,
                      marginTop: 6,
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: "700", color: badge.text }}>
                      {myQr.role?.toUpperCase()}
                    </Text>
                  </View>
                );
              })()}

              <Text style={{ fontSize: 13, color: theme.muted, marginTop: 6 }}>
                ID: {myQr.identifier || user.username}
              </Text>
              {!!myQr.department && (
                <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
                  {myQr.department}
                </Text>
              )}

              <View
                style={{
                  backgroundColor: "#FFFFFF",
                  padding: 14,
                  borderRadius: 16,
                  marginVertical: 18,
                  shadowColor: "#000",
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.2,
                  shadowRadius: 10,
                  elevation: 5,
                }}
              >
                {myQr.qr_data_uri ? (
                  <Image
                    source={{ uri: myQr.qr_data_uri }}
                    style={{ width: 200, height: 200 }}
                    resizeMode="contain"
                  />
                ) : (
                  <ActivityIndicator size="large" color="#000" />
                )}
              </View>

              <Text
                style={{
                  fontSize: 12,
                  color: theme.muted,
                  textAlign: "center",
                  maxWidth: 280,
                  lineHeight: 18,
                }}
              >
                Present this QR pass to any campus member. Scanning establishes an instant 2-way mutual connection.
              </Text>

              <Pressable
                style={[
                  styles.smallActionBtn,
                  { marginTop: 16, borderColor: theme.border, backgroundColor: theme.bgElevated },
                ]}
                onPress={loadMyQr}
              >
                <MaterialCommunityIcons name="refresh" size={15} color={theme.cyan} />
                <Text style={[styles.smallActionBtnText, { color: theme.cyan }]}>
                  REFRESH PASS
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      )}

      {/* Manual Code Entry Modal */}
      <Modal
        visible={showManualModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowManualModal(false)}
      >
        <Pressable style={styles.modalBackdropOverlay} onPress={() => setShowManualModal(false)}>
          <Pressable
            style={[styles.modalSheetCard, { backgroundColor: theme.cardGlass, borderColor: theme.borderBright }]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={styles.modalSheetHeader}>
              <Text style={[styles.modalSheetTitle, { color: theme.text }]}>Enter QR Code Data</Text>
              <Pressable onPress={() => setShowManualModal(false)}>
                <MaterialCommunityIcons name="close" size={22} color={theme.text} />
              </Pressable>
            </View>

            <Text style={{ fontSize: 12, color: theme.muted, marginBottom: 10 }}>
              Paste raw QR JSON, user UUID, Scholar/Roll ID, or Visitor ID below to verify:
            </Text>

            <TextInput
              style={[
                styles.textInputBox,
                {
                  color: theme.text,
                  backgroundColor: theme.bgElevated,
                  borderColor: theme.border,
                  height: 90,
                  textAlignVertical: "top",
                  padding: 10,
                  fontSize: 12,
                },
              ]}
              multiline
              placeholder='e.g. {"qr_id":"...","uid":1} or UUID'
              placeholderTextColor={theme.muted}
              value={manualText}
              onChangeText={setManualText}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <Pressable
                style={[styles.smallActionBtn, { flex: 1, borderColor: theme.border }]}
                onPress={() => setShowManualModal(false)}
              >
                <Text style={{ color: theme.textSecondary, fontWeight: "600" }}>CANCEL</Text>
              </Pressable>

              <Pressable
                style={[styles.smallActionBtn, { flex: 1, backgroundColor: theme.cyan, borderColor: theme.cyan }]}
                onPress={() => {
                  setShowManualModal(false);
                  verifyScannedPayload(manualText);
                }}
              >
                <Text style={{ color: "#000", fontWeight: "700" }}>VERIFY</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// MUTUAL CONNECTIONS DIRECTORY SCREEN
// ---------------------------------------------------------------------------
function ConnectionsScreen({
  role,
  user,
  go,
}: {
  role: Role;
  user: any;
  go: (s: string) => void;
}) {
  const { theme, isDark } = useAppTheme();
  const [connections, setConnections] = useState<any[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUser, setSelectedUser] = useState<any | null>(null);

  const fetchConnections = useCallback(
    async (q = "") => {
      try {
        const res = await http.get("/connections", {
          params: { q: q.trim() || undefined, limit: 50 },
        });
        setConnections(res.data?.connections || []);
        setTotalCount(res.data?.total_connections || 0);
      } catch (err: any) {
        Alert.alert("Connections Error", apiErrorMessage(err, "Failed to load connections."));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    []
  );

  useEffect(() => {
    fetchConnections(searchQuery);
  }, [fetchConnections, searchQuery]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchConnections(searchQuery);
  };

  const handleRemove = (targetUserId: number, targetName: string) => {
    Alert.alert(
      "Remove Connection",
      `Are you sure you want to remove your mutual connection with ${targetName}? Neither of you will have mutual profile access until connected again.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              await http.delete(`/connections/${targetUserId}`);
              fetchConnections(searchQuery);
            } catch (e: any) {
              Alert.alert("Error", apiErrorMessage(e, "Could not remove connection."));
            }
          },
        },
      ]
    );
  };

  const getRoleBadgeColor = (r: string) => {
    switch ((r || "").toLowerCase()) {
      case "admin":
        return { bg: theme.cyanGlow, text: theme.cyan, border: theme.borderAccent };
      case "teacher":
      case "faculty":
        return { bg: theme.blueGlow, text: theme.blue, border: theme.borderAccent };
      case "student":
        return { bg: theme.emeraldGlow, text: theme.emerald, border: theme.emerald };
      case "others":
      case "other":
      case "visitor":
        return { bg: theme.amberGlow, text: theme.amber, border: theme.amber };
      default:
        return { bg: theme.cardSubtle, text: theme.textSecondary, border: theme.border };
    }
  };

  return (
    <View style={{ paddingBottom: 60 }}>
      {/* ── Screen Header ── */}
      <View style={styles.sectionHeadingRow}>
        <View>
          <Text style={[styles.sectionTitleText, { color: theme.text }]}>
            My Connections — {totalCount}
          </Text>
          <Text style={[styles.sectionSubtitleText, { color: theme.textSecondary }]}>
            Campus network & mutual profile access
          </Text>
        </View>
        <Pressable
          style={[styles.smallActionBtn, { backgroundColor: theme.cyan, borderColor: theme.cyan }]}
          onPress={() => go("QR")}
        >
          <MaterialCommunityIcons name="qrcode-scan" size={16} color="#000" />
          <Text style={[styles.smallActionBtnText, { color: "#000", fontWeight: "700" }]}>
            SCAN QR
          </Text>
        </Pressable>
      </View>

      {/* ── Search Input ── */}
      <View
        style={[
          styles.searchInputWrap,
          {
            backgroundColor: theme.bgElevated,
            borderColor: theme.border,
            marginBottom: 16,
          },
        ]}
      >
        <MaterialCommunityIcons name="magnify" size={18} color={theme.muted} />
        <TextInput
          style={[styles.searchTextInput, { color: theme.text }]}
          placeholder="Search connections by name, ID, or role..."
          placeholderTextColor={theme.muted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery("")}>
            <MaterialCommunityIcons name="close-circle" size={16} color={theme.muted} />
          </Pressable>
        )}
      </View>

      {/* ── Connections List ── */}
      {loading ? (
        <View style={{ paddingVertical: 40, alignItems: "center" }}>
          <ActivityIndicator size="large" color={theme.cyan} />
          <Text style={{ color: theme.muted, marginTop: 10 }}>Loading mutual connections...</Text>
        </View>
      ) : connections.length === 0 ? (
        <View
          style={[
            styles.exportCardBox,
            {
              backgroundColor: theme.cardGlass,
              borderColor: theme.borderBright,
              alignItems: "center",
              paddingVertical: 36,
            },
          ]}
        >
          <MaterialCommunityIcons name="account-group-outline" size={48} color={theme.muted} />
          <Text style={{ fontSize: 16, fontWeight: "700", color: theme.text, marginTop: 12 }}>
            No Connections Found
          </Text>
          <Text
            style={{
              fontSize: 12,
              color: theme.muted,
              textAlign: "center",
              marginTop: 6,
              maxWidth: 260,
              lineHeight: 18,
            }}
          >
            {searchQuery
              ? `No connections matching "${searchQuery}".`
              : "Scan another campus member's QR code to establish a mutual connection."}
          </Text>
          <Pressable
            style={[
              styles.primaryNeonButton,
              { backgroundColor: theme.cyan, marginTop: 18, paddingHorizontal: 20 },
            ]}
            onPress={() => go("QR")}
          >
            <MaterialCommunityIcons name="qrcode-scan" size={16} color="#000" />
            <Text style={{ color: "#000", fontWeight: "700", fontSize: 13 }}>
              SCAN QR CODE
            </Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          {connections.map((c) => {
            const badge = getRoleBadgeColor(c.role);
            const photoUri = c.profile_photo_url
              ? (c.profile_photo_url.startsWith("http")
                ? c.profile_photo_url
                : `${http.defaults.baseURL || API}${c.profile_photo_url}?token=${user.token}`)
              : null;

            return (
              <Pressable
                key={c.connection_id}
                style={[
                  styles.rosterItemCard,
                  {
                    backgroundColor: theme.cardGlass,
                    borderColor: theme.borderBright,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                  },
                ]}
                onPress={() => setSelectedUser(c)}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flex: 1 }}>
                  <View
                    style={{
                      width: 50,
                      height: 50,
                      borderRadius: 25,
                      borderWidth: 1.5,
                      borderColor: badge.border,
                      overflow: "hidden",
                      backgroundColor: theme.bgElevated,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {photoUri ? (
                      <Image source={{ uri: photoUri }} style={{ width: 50, height: 50 }} resizeMode="cover" />
                    ) : (
                      <Text style={{ fontSize: 20, fontWeight: "700", color: badge.text }}>
                        {c.display_name?.charAt(0)?.toUpperCase() || "U"}
                      </Text>
                    )}
                  </View>

                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={{ fontSize: 15, fontWeight: "700", color: theme.text }}>
                        {c.display_name}
                      </Text>
                      <View
                        style={{
                          paddingHorizontal: 7,
                          paddingVertical: 2,
                          borderRadius: 5,
                          backgroundColor: badge.bg,
                          borderWidth: 1,
                          borderColor: badge.border,
                        }}
                      >
                        <Text style={{ fontSize: 10, fontWeight: "700", color: badge.text }}>
                          {c.role?.toUpperCase()}
                        </Text>
                      </View>
                    </View>

                    <Text style={{ fontSize: 12, color: theme.muted, marginTop: 2 }}>
                      ID: {c.identifier}
                      {c.department ? ` • ${c.department}` : ""}
                    </Text>

                    {!!c.connected_at && (
                      <Text style={{ fontSize: 11, color: theme.textSecondary, marginTop: 2 }}>
                        Connected {formatDisplayDate(c.connected_at)}
                      </Text>
                    )}
                  </View>
                </View>

                <Pressable
                  onPress={() => handleRemove(c.user_id, c.display_name)}
                  style={{ padding: 8 }}
                  accessibilityLabel="Remove connection"
                >
                  <MaterialCommunityIcons name="account-remove-outline" size={18} color={theme.muted} />
                </Pressable>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Detail Modal for Selected Connection */}
      {selectedUser && (
        <Modal
          visible={!!selectedUser}
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedUser(null)}
        >
          <Pressable style={styles.modalBackdropOverlay} onPress={() => setSelectedUser(null)}>
            <Pressable
              style={[
                styles.modalSheetCard,
                { backgroundColor: theme.cardGlass, borderColor: theme.borderBright, alignItems: "center" },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={[styles.modalSheetHeader, { width: "100%" }]}>
                <Text style={[styles.modalSheetTitle, { color: theme.text }]}>Connection Profile</Text>
                <Pressable onPress={() => setSelectedUser(null)}>
                  <MaterialCommunityIcons name="close" size={22} color={theme.text} />
                </Pressable>
              </View>

              <View
                style={{
                  width: 90,
                  height: 90,
                  borderRadius: 45,
                  borderWidth: 3,
                  borderColor: theme.cyan,
                  overflow: "hidden",
                  backgroundColor: theme.bgElevated,
                  alignItems: "center",
                  justifyContent: "center",
                  marginVertical: 12,
                }}
              >
                {selectedUser.profile_photo_url ? (
                  <Image
                    source={{
                      uri: selectedUser.profile_photo_url.startsWith("http")
                        ? selectedUser.profile_photo_url
                        : `${http.defaults.baseURL || API}${selectedUser.profile_photo_url}?token=${user.token}`,
                    }}
                    style={{ width: 90, height: 90 }}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={{ fontSize: 36, fontWeight: "700", color: theme.cyan }}>
                    {selectedUser.display_name?.charAt(0)?.toUpperCase() || "U"}
                  </Text>
                )}
              </View>

              <Text style={{ fontSize: 20, fontWeight: "700", color: theme.text, textAlign: "center" }}>
                {selectedUser.display_name}
              </Text>

              {(() => {
                const badge = getRoleBadgeColor(selectedUser.role);
                return (
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 3,
                      borderRadius: 6,
                      backgroundColor: badge.bg,
                      borderWidth: 1,
                      borderColor: badge.border,
                      marginTop: 6,
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: "700", color: badge.text }}>
                      {selectedUser.role?.toUpperCase()}
                    </Text>
                  </View>
                );
              })()}

              <View
                style={{
                  width: "100%",
                  backgroundColor: theme.bgElevated,
                  borderRadius: 10,
                  padding: 14,
                  marginTop: 16,
                  gap: 8,
                }}
              >
                <Text style={{ fontSize: 13, color: theme.textSecondary }}>
                  Identifier: <Text style={{ color: theme.text, fontWeight: "600" }}>{selectedUser.identifier}</Text>
                </Text>
                {!!selectedUser.department && (
                  <Text style={{ fontSize: 13, color: theme.textSecondary }}>
                    Department / Scope: <Text style={{ color: theme.text, fontWeight: "600" }}>{selectedUser.department}</Text>
                  </Text>
                )}
                {!!selectedUser.connected_at && (
                  <Text style={{ fontSize: 13, color: theme.textSecondary }}>
                    Connected Since: <Text style={{ color: theme.text, fontWeight: "600" }}>{formatDisplayDate(selectedUser.connected_at)}</Text>
                  </Text>
                )}
              </View>

              <Pressable
                style={[
                  styles.smallActionBtn,
                  {
                    marginTop: 18,
                    borderColor: theme.rose,
                    backgroundColor: theme.roseGlow,
                    width: "100%",
                    paddingVertical: 12,
                  },
                ]}
                onPress={() => {
                  const uid = selectedUser.user_id;
                  const name = selectedUser.display_name;
                  setSelectedUser(null);
                  handleRemove(uid, name);
                }}
              >
                <MaterialCommunityIcons name="account-remove-outline" size={16} color={theme.rose} />
                <Text style={{ color: theme.rose, fontWeight: "700" }}>REMOVE CONNECTION</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

// Mount heavy screens after navigation animations complete. This keeps the
// login/dashboard transition responsive on low-end devices without changing
// screen behavior or introducing fragile native dynamic imports.
// ---------------------------------------------------------------------------
// ROUTER & SCREEN DISPATCHER
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
      if (role === "others")
        return <OthersDashboardView user={user} onLogout={onLogout} />;
      return <StudentDashboard go={go} />;

    case "Add Student":
      return <AddStudent go={go} />;
    case "Add Teacher":
      return <AddTeacher go={go} />;
    case "Face Registration":
      return <FaceRegistration go={go} />;

    case "Students":
      return role === "teacher" ? (
        <TeacherStudentsRoster />
      ) : (
        <AdminStudentsDirectory go={go} />
      );
    case "Teachers":
      return <AdminTeachersDirectory go={go} />;
    case "Academic":
      return <AcademicHierarchyView />;

    case "Attendance":
      if (role === "admin") return <AttendanceHistoryView role={role} />;
      if (role === "teacher") return <DeferredScreen><TeacherTakeAttendance go={go} /></DeferredScreen>;
      return <StudentAttendanceView />;

    case "Recognition Results":
      return <DeferredScreen><RecognitionResultsView go={go} /></DeferredScreen>;
    case "Verify Attendance":
      return <VerifyAttendanceView go={go} />;

    case "Classes":
      return <StudentClassesView />;
    case "History":
      return <AttendanceHistoryView role={role} />;
    case "Reports":
      return <DeferredScreen><ReportsView /></DeferredScreen>;
    case "Alerts":
    case "Notifications":
      return <NotificationsView />;

    case "QR":
      return <QRScreen role={role} user={user} go={go} />;
    case "Connections":
      return <ConnectionsScreen role={role} user={user} go={go} />;

    case "Profile":
      if (role === "admin")
        return <AdminProfile user={user} onLogout={onLogout} />;
      if (role === "teacher")
        return <TeacherProfile user={user} onLogout={onLogout} />;
      if (role === "others")
        return (
          <OthersDashboardView
            user={user}
            onLogout={onLogout}
            isProfileTab
          />
        );
      return <StudentProfile user={user} onLogout={onLogout} />;

    default:
      return <AdminDashboard go={go} />;
  }
}

// ---------------------------------------------------------------------------
// ADMIN COMMAND CENTER DASHBOARD
// ---------------------------------------------------------------------------
function AdminDashboard({ go }: { go: (x: string) => void }) {
  const { theme } = useAppTheme();
  const [students, setStudents] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Breathing pulse animation for status pill
  const pulseAnim = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.4,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const loadDashboard = useCallback(async () => {
    setBusy(true);
    setLoadError("");
    const results = await Promise.allSettled([
      http.get("/students"),
      http.get("/admin/users"),
      http.get("/admin/attendance"),
    ]);
    const [studentResult, userResult, attendanceResult] = results;

    if (studentResult.status === "fulfilled") {
      setStudents(studentResult.value.data?.students || []);
    }
    if (userResult.status === "fulfilled") {
      setUsers(userResult.value.data?.users || []);
    }
    if (attendanceResult.status === "fulfilled") {
      setAttendance(attendanceResult.value.data?.attendance || []);
    }

    const failed = results.filter((result) => result.status === "rejected");
    if (failed.length) {
      setLoadError(
        failed.length === results.length
          ? "Unable to load dashboard data. Check the API server connection and sign in again if your session has expired."
          : "Some dashboard data could not be loaded. The available information is shown below.",
      );
    }
    setBusy(false);
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (busy) {
    return (
      <View style={styles.screenCenterLoader}>
        <ActivityIndicator size="large" color={theme.cyan} />
        <Text style={[styles.loaderSubText, { color: theme.muted }]}>
          Loading University Dashboard...
        </Text>
      </View>
    );
  }

  const faculty = users.filter((u) => u.role === "teacher");
  const presentCount = attendance.filter(
    (x) => String(x.status || "").toUpperCase() === "PRESENT",
  ).length;
  const attendanceRate = attendance.length
    ? Math.round((presentCount / attendance.length) * 100)
    : 0;
  const uniqueSessions = new Set(attendance.map((x) => x.session_id)).size;

  const todayDate = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  return (
    <View style={styles.screenLayout}>
      {/* Executive Overview Hero Card */}
      <View
        style={[
          styles.executiveHeroCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
        ]}
      >
        <View style={[styles.heroAccentBar, { backgroundColor: theme.cyan }]} />
        <View style={styles.executiveHeroHeaderRow}>
          <View
            style={[
              styles.executiveStatusBadge,
              {
                backgroundColor: theme.cyanGlow,
                borderColor: theme.borderAccent,
              },
            ]}
          >
            <Animated.View
              style={[
                styles.pulseLiveDot,
                { backgroundColor: theme.cyan, opacity: pulseAnim },
              ]}
            />
            <Text style={[styles.executiveStatusText, { color: theme.cyan }]}>
              System Operational • Live Sync
            </Text>
          </View>
          <Text style={[styles.executiveDateText, { color: theme.muted }]}>
            {todayDate}
          </Text>
        </View>

        <Text style={[styles.executiveHeroHeading, { color: theme.text }]}>
          Academic Overview
        </Text>
        <Text style={[styles.executiveHeroSub, { color: theme.textSecondary }]}>
          Real-time biometric attendance across enrolled faculties
        </Text>
      </View>

      {!!loadError && (
        <HoloEmptyState
          icon="cloud-alert-outline"
          title="Dashboard data needs attention"
          desc={loadError}
          actionText="Retry"
          onAction={loadDashboard}
        />
      )}

      {/* 2x2 KPI Grid */}
      <Text style={[styles.sectionHeaderTitle, { color: theme.muted }]}>
        Campus Metrics
      </Text>
      <View style={styles.kpiGridMatrix}>
        <HoloMetricCard
          label="Total Students"
          value={String(students.length)}
          delta="Enrolled scholars"
          icon="account-group"
          color={theme.cyan}
          bgColor={theme.cyanGlow}
        />
        <HoloMetricCard
          label="Faculty Staff"
          value={String(faculty.length)}
          delta="Active instructors"
          icon="account-tie"
          color={theme.amber}
          bgColor={theme.amberGlow}
        />
        <HoloMetricCard
          label="Attendance Rate"
          value={`${attendanceRate}%`}
          delta={`${presentCount} verified logs`}
          icon="check-decagram"
          color={theme.emerald}
          bgColor={theme.emeraldGlow}
        />
        <HoloMetricCard
          label="Sessions Held"
          value={String(uniqueSessions)}
          delta="Attendance events"
          icon="calendar-check"
          color={theme.purple}
          bgColor={theme.purpleGlow}
        />
      </View>

      {/* Rapid Commands Grid */}
      <Text style={[styles.sectionHeaderTitle, { color: theme.muted }]}>
        Quick Actions
      </Text>
      <View style={styles.rapidCommandsGrid}>
        <RapidCommandButton
          title="Add Student"
          desc="Register student"
          icon="account-plus-outline"
          color={theme.cyan}
          onPress={() => go("Add Student")}
        />
        <RapidCommandButton
          title="Add Faculty"
          desc="Register instructor"
          icon="account-tie-outline"
          color={theme.amber}
          onPress={() => go("Add Teacher")}
        />
        <RapidCommandButton
          title="Academic Tree"
          desc="View departments"
          icon="layers-outline"
          color={theme.purple}
          onPress={() => go("Academic")}
        />
        <RapidCommandButton
          title="Audit Reports"
          desc="Attendance exports"
          icon="file-chart-outline"
          color={theme.emerald}
          onPress={() => go("Reports")}
        />
      </View>

      {/* Recent Attendance Stream */}
      <View style={styles.sectionTitleRow}>
        <Text style={[styles.sectionHeaderTitle, { color: theme.muted }]}>
          Recent Attendance Logs
        </Text>
        <Pressable onPress={() => go("Attendance")}>
          <Text style={[styles.viewAllActionText, { color: theme.cyan }]}>
            View all
          </Text>
        </Pressable>
      </View>

      {attendance.length === 0 ? (
        <HoloEmptyState
          icon="calendar-clock-outline"
          title="No attendance events yet"
          desc="Attendance events will appear here automatically when classes take attendance."
        />
      ) : (
        attendance.slice(0, 5).map((log, i) => (
          <View
            key={log.id || i}
            style={[
              styles.streamEventCard,
              { backgroundColor: theme.cardGlass, borderColor: theme.border },
            ]}
          >
            <View
              style={[
                styles.streamIconCircle,
                {
                  backgroundColor:
                    String(log.status).toUpperCase() === "PRESENT"
                      ? theme.emeraldGlow
                      : theme.roseGlow,
                },
              ]}
            >
              <MaterialCommunityIcons
                name={
                  String(log.status).toUpperCase() === "PRESENT"
                    ? "check-circle"
                    : "close-circle"
                }
                size={20}
                color={
                  String(log.status).toUpperCase() === "PRESENT"
                    ? theme.emerald
                    : theme.rose
                }
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                style={[styles.streamItemTitle, { color: theme.text }]}
                numberOfLines={1}
              >
                {log.name || log.student_id || "Student Attendance"}
              </Text>
              <Text style={[styles.streamItemSub, { color: theme.muted }]}>
                {log.session_id ? `Session #${log.session_id} • ` : ""}
                {log.timestamp
                  ? new Date(log.timestamp).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "Recorded today"}
              </Text>
            </View>
            <HoloStatusPill
              label={log.status || "Present"}
              tone={
                String(log.status).toUpperCase() === "PRESENT"
                  ? "success"
                  : "danger"
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
  const { theme } = useAppTheme();
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
      <View style={styles.screenCenterLoader}>
        <ActivityIndicator size="large" color={theme.cyan} />
        <Text style={[styles.loaderSubText, { color: theme.muted }]}>
          Loading Faculty Schedule...
        </Text>
      </View>
    );
  }

  const presentCount = report?.totals?.students_present || 0;
  const sessionsCount = report?.totals?.sessions || 0;

  return (
    <View style={styles.screenLayout}>
      {/* High-Impact Hero Action Banner */}
      <View
        style={[
          styles.teacherHeroBanner,
          { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
        ]}
      >
        <View
          style={[
            styles.teacherHeroPillRow,
            {
              backgroundColor: theme.cyanGlow,
              borderColor: theme.borderAccent,
            },
          ]}
        >
          <MaterialCommunityIcons
            name="face-recognition"
            size={14}
            color={theme.cyan}
          />
          <Text style={[styles.teacherHeroPillText, { color: theme.cyan }]}>
            Facial Recognition Ready
          </Text>
        </View>

        <Text style={[styles.teacherHeroMainHeading, { color: theme.text }]}>
          Take Class Attendance
        </Text>
        <Text
          style={[
            styles.teacherHeroDescription,
            { color: theme.textSecondary },
          ]}
        >
          Capture a classroom photo. Verified student attendance is marked
          instantly.
        </Text>

        <Pressable
          style={[
            styles.teacherLaunchButton,
            {
              backgroundColor: theme.cyan,
            },
          ]}
          onPress={() => go("Attendance")}
        >
          <MaterialCommunityIcons
            name="camera-enhance"
            size={18}
            color="#FFFFFF"
          />
          <Text
            style={[
              styles.teacherLaunchButtonText,
              { color: "#FFFFFF" },
            ]}
          >
            Start Attendance Session
          </Text>
        </Pressable>
      </View>

      {/* Metrics Row */}
      <Text style={[styles.sectionHeaderTitle, { color: theme.muted }]}>
        Today's Stats
      </Text>
      <View style={styles.teacherMetricsRow}>
        <View
          style={[
            styles.teacherMetricBox,
            { backgroundColor: theme.cardGlass, borderColor: theme.border },
          ]}
        >
          <MaterialCommunityIcons
            name="calendar-month-outline"
            size={22}
            color={theme.cyan}
          />
          <Text style={[styles.teacherMetricDigit, { color: theme.text }]}>
            {schedule.length}
          </Text>
          <Text style={[styles.teacherMetricLabel, { color: theme.muted }]}>
            Classes
          </Text>
        </View>
        <View
          style={[
            styles.teacherMetricBox,
            { backgroundColor: theme.cardGlass, borderColor: theme.border },
          ]}
        >
          <MaterialCommunityIcons
            name="account-check-outline"
            size={22}
            color={theme.emerald}
          />
          <Text style={[styles.teacherMetricDigit, { color: theme.emerald }]}>
            {presentCount}
          </Text>
          <Text style={[styles.teacherMetricLabel, { color: theme.muted }]}>
            Present
          </Text>
        </View>
        <View
          style={[
            styles.teacherMetricBox,
            { backgroundColor: theme.cardGlass, borderColor: theme.border },
          ]}
        >
          <MaterialCommunityIcons
            name="layers-outline"
            size={22}
            color={theme.amber}
          />
          <Text style={[styles.teacherMetricDigit, { color: theme.text }]}>
            {sessionsCount}
          </Text>
          <Text style={[styles.teacherMetricLabel, { color: theme.muted }]}>
            Sessions
          </Text>
        </View>
      </View>

      {/* Today's Timetable */}
      <View style={styles.sectionTitleRow}>
        <Text style={[styles.sectionHeaderTitle, { color: theme.muted }]}>
          Today's Classes
        </Text>
        <Pressable onPress={() => go("Attendance")}>
          <Text style={[styles.viewAllActionText, { color: theme.cyan }]}>
            Take Attendance
          </Text>
        </Pressable>
      </View>

      {schedule.length === 0 ? (
        <HoloEmptyState
          icon="calendar-blank-outline"
          title="No lectures scheduled today"
          desc="Your timetable has no classes assigned for this calendar day."
        />
      ) : (
        schedule.map((cls, i) => (
          <Pressable
            key={cls.id || i}
            style={[
              styles.scheduleRowCard,
              { backgroundColor: theme.cardGlass, borderColor: theme.border },
            ]}
            onPress={() => go("Attendance")}
          >
            <View
              style={[
                styles.scheduleTimeBadge,
                {
                  backgroundColor: theme.bgElevated,
                  borderColor: theme.border,
                },
              ]}
            >
              <Text style={[styles.scheduleTimeStart, { color: theme.cyan }]}>
                {cls.starts_at || "09:00"}
              </Text>
              <Text style={[styles.scheduleTimeFinish, { color: theme.muted }]}>
                {cls.ends_at || "10:00"}
              </Text>
            </View>
            <View style={{ flex: 1, paddingLeft: 12 }}>
              <Text
                style={[styles.scheduleLectureTitle, { color: theme.text }]}
              >
                {cls.subject || "Class Lecture"}
              </Text>
              <Text
                style={[styles.scheduleLectureMeta, { color: theme.muted }]}
              >
                {cls.room || "Room Assigned"} • {cls.day || "Today"}
              </Text>
            </View>
            <View style={styles.scheduleChevronBox}>
              <MaterialCommunityIcons
                name="chevron-right"
                size={22}
                color={theme.cyan}
              />
            </View>
          </Pressable>
        ))
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// STUDENT CONCENTRIC RADIAL SCORECARD DASHBOARD
// ---------------------------------------------------------------------------
function StudentDashboard({ go }: { go: (x: string) => void }) {
  const { theme } = useAppTheme();
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
      <View style={styles.screenCenterLoader}>
        <ActivityIndicator size="large" color={theme.cyan} />
        <Text style={[styles.loaderSubText, { color: theme.muted }]}>
          Loading Attendance Overview...
        </Text>
      </View>
    );
  }

  const profile = data?.profile || {};
  const attendance = Array.isArray(data?.attendance) ? data.attendance : [];
  const summary = data?.summary || {};
  const rate = Math.round(Number(summary.overall_percentage || 0));
  const isGoodStanding = rate >= 75;

  return (
    <View style={styles.screenLayout}>
      {/* Concentric Scorecard Card */}
      <View
        style={[
          styles.studentScorecardGlass,
          { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
        ]}
      >
        <View style={styles.radialDialContainer}>
          <View
            style={[
              styles.radialDialOuterRing,
              {
                borderColor: isGoodStanding ? theme.emerald : theme.amber,
                backgroundColor: theme.bgElevated,
              },
            ]}
          >
            <Text style={[styles.radialDialPercent, { color: theme.text }]}>
              {rate}%
            </Text>
            <Text style={[styles.radialDialTitle, { color: theme.muted }]}>
              Attendance
            </Text>
          </View>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={[styles.studentCardHeading, { color: theme.text }]}>
            Academic Standing
          </Text>
          <HoloStatusPill
            label={
              isGoodStanding
                ? "In Good Standing (≥ 75%)"
                : "Attendance Warning (< 75%)"
            }
            tone={isGoodStanding ? "success" : "warning"}
          />
          <Text style={[styles.studentDegreeText, { color: theme.muted }]}>
            {profile.program || "Academic Program"}
            {profile.semester ? ` • Semester ${profile.semester}` : ""}
          </Text>
        </View>
      </View>

      {/* Record Tally Grid */}
      <Text style={[styles.sectionHeaderTitle, { color: theme.muted }]}>
        Attendance Breakdown
      </Text>
      <View style={styles.studentBreakdownGrid}>
        <View
          style={[
            styles.studentBreakdownBox,
            { backgroundColor: theme.cardGlass, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.studentBreakdownVal, { color: theme.text }]}>
            {attendance.length}
          </Text>
          <Text style={[styles.studentBreakdownLbl, { color: theme.muted }]}>
            Sessions
          </Text>
        </View>
        <View
          style={[
            styles.studentBreakdownBox,
            { backgroundColor: theme.cardGlass, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.studentBreakdownVal, { color: theme.emerald }]}>
            {summary.present || 0}
          </Text>
          <Text style={[styles.studentBreakdownLbl, { color: theme.muted }]}>
            Present
          </Text>
        </View>
        <View
          style={[
            styles.studentBreakdownBox,
            { backgroundColor: theme.cardGlass, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.studentBreakdownVal, { color: theme.rose }]}>
            {summary.absent || 0}
          </Text>
          <Text style={[styles.studentBreakdownLbl, { color: theme.muted }]}>
            Absent
          </Text>
        </View>
      </View>

      <Pressable
        style={[
          styles.primaryNeonButton,
          {
            backgroundColor: theme.cyan,
            shadowColor: theme.cyan,
          },
        ]}
        onPress={() => go("Attendance")}
      >
        <MaterialCommunityIcons
          name="calendar-search"
          size={19}
          color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
        />
        <Text
          style={[
            styles.primaryNeonButtonText,
            { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
          ]}
        >
          VIEW COMPLETE ATTENDANCE LOGS
        </Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ADMIN: ENROLLED STUDENTS DIRECTORY
// ---------------------------------------------------------------------------
function AdminStudentsDirectory({ go }: { go: (x: string) => void }) {
  const { theme } = useAppTheme();
  const [students, setStudents] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<any>({});
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [editingStudent, setEditingStudent] = useState<any>(null);

  const loadStudents = useCallback(async () => {
    setBusy(true);
    setLoadError("");
    try {
      const response = await http.get("/students");
      if (!Array.isArray(response.data?.students)) {
        throw new Error("The server returned an invalid student list.");
      }
      setStudents(response.data.students);
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      setLoadError(
        typeof detail === "string"
          ? detail
          : error?.message || "Unable to load students. Check the API connection and sign in again.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    loadStudents();
  }, [loadStudents]);

  const handleDeleteStudent = (studentId: string, studentName: string) => {
    Alert.alert(
      "Confirm Deletion",
      `Are you sure you want to delete student "${studentName}" (${studentId})? This will also remove associated biometrics and attendance records.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await http.delete(`/admin/students/${studentId}`);
              setStudents((prev) =>
                prev.filter((s) => s.student_id !== studentId),
              );
              setSelectedStudent(null);
              Alert.alert(
                "Student Removed",
                `Record for ${studentName} was successfully deleted.`,
              );
            } catch (e: any) {
              Alert.alert(
                "Delete Failed",
                e?.response?.data?.detail || "Could not delete student record.",
              );
            }
          },
        },
      ],
    );
  };

  const visible = students.filter((st) => {
    const raw = JSON.stringify(st).toLowerCase();
    const query = search.toLowerCase();
    const matchesQuery = !search || raw.includes(query);
    const matchesFilters = Object.values(filters)
      .filter(Boolean)
      .every((val: any) => raw.includes(String(val).toLowerCase()));
    return matchesQuery && matchesFilters;
  });
  const hasActiveStudentFilter = Boolean(search.trim() || Object.values(filters).some(Boolean));

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Students Directory
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            {loadError && students.length === 0
              ? "Student data unavailable"
              : hasActiveStudentFilter
              ? `${visible.length} matching student${visible.length === 1 ? "" : "s"}`
              : `${visible.length} students enrolled`}
          </Text>
        </View>
        <Pressable
          style={[styles.screenAddButtonMini, { backgroundColor: theme.cyan }]}
          onPress={() => go("Add Student")}
        >
          <MaterialCommunityIcons
            name="plus"
            size={18}
            color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
          />
          <Text
            style={[
              styles.screenAddBtnMiniText,
              { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
            ]}
          >
            ENROLL
          </Text>
        </Pressable>
      </View>

      {/* Search & Filter Toolbar */}
      <View style={styles.toolbarRow}>
        <View
          style={[
            styles.searchBarGlass,
            { backgroundColor: theme.cardGlass, borderColor: theme.border },
          ]}
        >
          <MaterialCommunityIcons name="magnify" size={20} color={theme.cyan} />
          <TextInput
            style={[styles.searchInputHolo, { color: theme.text }]}
            value={search}
            onChangeText={setSearch}
            placeholder="Search by name, ID or course..."
            placeholderTextColor={theme.muted}
          />
          {!!search && (
            <Pressable onPress={() => setSearch("")}>
              <MaterialCommunityIcons
                name="close-circle"
                size={17}
                color={theme.muted}
              />
            </Pressable>
          )}
        </View>
        <Pressable
          style={[
            styles.filterToggleBox,
            { backgroundColor: theme.cardGlass, borderColor: theme.border },
            showFilters && {
              backgroundColor: theme.cyan,
              borderColor: theme.cyan,
            },
          ]}
          onPress={() => setShowFilters((v) => !v)}
        >
          <MaterialCommunityIcons
            name={showFilters ? "filter-check" : "tune-variant"}
            size={19}
            color={
              showFilters
                ? theme.mode === "dark"
                  ? "#080C14"
                  : "#FFFFFF"
                : theme.cyan
            }
          />
        </Pressable>
      </View>

      {showFilters && (
        <View
          style={[
            styles.filterDrawerCard,
            { backgroundColor: theme.cardGlass, borderColor: theme.border },
          ]}
        >
          <AcademicCascade
            onApply={(f) => {
              setFilters(f);
              setShowFilters(false);
            }}
          />
        </View>
      )}

      {/* Student Record Cards */}
      {busy ? (
        <ActivityIndicator
          size="large"
          color={theme.cyan}
          style={{ margin: 30 }}
        />
      ) : loadError && students.length === 0 ? (
        <HoloEmptyState
          icon="cloud-alert-outline"
          title="Unable to load students"
          desc={loadError}
          actionText="Retry"
          onAction={loadStudents}
        />
      ) : visible.length === 0 ? (
        <HoloEmptyState
          icon="account-search-outline"
          title="No students match criteria"
          desc="Try adjusting search query or enroll a new student."
          actionText="Enroll Student"
          onAction={() => go("Add Student")}
        />
      ) : (
        <>
        {!!loadError && (
          <HoloEmptyState
            icon="cloud-alert-outline"
            title="Student list refresh failed"
            desc={loadError}
            actionText="Retry"
            onAction={loadStudents}
          />
        )}
        {visible.map((student, i) => (
          <Pressable
            key={student.student_id || i}
            style={[
              styles.rosterItemCard,
              { backgroundColor: theme.cardGlass, borderColor: theme.border },
            ]}
            onPress={() => setSelectedStudent(student)}
          >
            {student.profile_photo_base64 ? (
              <Image source={{ uri: student.profile_photo_base64 }} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.cyanGlow }} />
            ) : (
              <View style={[styles.rosterAvatarBox, { backgroundColor: theme.cyanGlow }]}>
                <MaterialCommunityIcons name="account" size={21} color={theme.cyan} />
              </View>
            )}
            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Text style={[styles.rosterItemName, { color: theme.text }]}>
                {student.name || "Student Record"}
              </Text>
              <Text style={[styles.rosterItemId, { color: theme.cyan }]}>
                ID: {student.student_id || "STU-000"}
              </Text>
              <Text style={[styles.rosterItemMeta, { color: theme.muted }]}>
                {student.program || "Course"} • {student.semester || "Semester"}
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={theme.muted}
            />
          </Pressable>
        ))}
        </>
      )}

      {/* Student Profile Detail Modal Sheet */}
      {selectedStudent && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setSelectedStudent(null)}
        >
          <Pressable
            style={styles.modalBackdropOverlay}
            onPress={() => setSelectedStudent(null)}
          >
            <Pressable
              style={[
                styles.modalSheetCard,
                {
                  backgroundColor: theme.cardGlass,
                  borderColor: theme.borderBright,
                },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalSheetHeader}>
                <Text style={[styles.modalSheetTitle, { color: theme.text }]}>
                  Student Details
                </Text>
                <Pressable onPress={() => setSelectedStudent(null)}>
                  <MaterialCommunityIcons
                    name="close"
                    size={22}
                    color={theme.text}
                  />
                </Pressable>
              </View>

              <View style={styles.modalProfileHero}>
                {selectedStudent.profile_photo_base64 ? (
                  <Image source={{ uri: selectedStudent.profile_photo_base64 }} style={{ width: 72, height: 72, borderRadius: 36, borderWidth: 2, borderColor: theme.cyan }} />
                ) : (
                  <View style={[styles.modalAvatarGlow, { backgroundColor: theme.cyanGlow, borderColor: theme.cyan }]}>
                    <MaterialCommunityIcons name="account" size={32} color={theme.cyan} />
                  </View>
                )}
                <Text style={[styles.modalHeroName, { color: theme.text }]}>
                  {selectedStudent.name}
                </Text>
                <View
                  style={[
                    styles.modalIdBadge,
                    {
                      backgroundColor: theme.cyanGlow,
                      borderColor: theme.borderAccent,
                    },
                  ]}
                >
                  <Text
                    style={[styles.modalIdBadgeText, { color: theme.cyan }]}
                  >
                    {selectedStudent.student_id}
                  </Text>
                </View>
              </View>

              <View style={styles.modalDetailsGroup}>
                <HoloDetailRow
                  label="University Email"
                  value={selectedStudent.email || "Not registered"}
                />
                <HoloDetailRow
                  label="Phone"
                  value={selectedStudent.phone || "Not registered"}
                />
                <HoloDetailRow
                  label="Date of Birth"
                  value={selectedStudent.date_of_birth || "Not specified"}
                />
                <HoloDetailRow
                  label="Roll Number"
                  value={selectedStudent.roll_number || "Not assigned"}
                />
                <HoloDetailRow
                  label="School"
                  value={selectedStudent.academic_school || "Not specified"}
                />
                <HoloDetailRow
                  label="Faculty"
                  value={selectedStudent.academic_faculty || "Not specified"}
                />
                <HoloDetailRow
                  label="Program"
                  value={selectedStudent.program || "Not registered"}
                />
                <HoloDetailRow
                  label="Department"
                  value={selectedStudent.department || selectedStudent.academic_department || "Not registered"}
                />
                <HoloDetailRow
                  label="Semester"
                  value={selectedStudent.semester || selectedStudent.academic_semester || "Not specified"}
                />
                <HoloDetailRow
                  label="Current GPA"
                  value={selectedStudent.gpa || "Not specified"}
                />
                <HoloDetailRow
                  label="Enrollment Year"
                  value={selectedStudent.enrollment_year || "Not specified"}
                />
                <HoloDetailRow
                  label="Face Verification"
                  value="Active & Profile Registered"
                />
              </View>

              <View style={styles.modalFooterTwoBtnsRow}>
                <Pressable
                  style={[styles.modalDismissBtnFlex, { backgroundColor: theme.cyanGlow, borderWidth: 1, borderColor: theme.cyan }]}
                  onPress={() => setEditingStudent(selectedStudent)}
                >
                  <Text style={[styles.modalDismissBtnText, { color: theme.cyan }]}>Edit</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.modalDangerBtn,
                    {
                      borderColor: theme.rose,
                      backgroundColor: theme.roseGlow,
                    },
                  ]}
                  onPress={() =>
                    handleDeleteStudent(
                      selectedStudent.student_id,
                      selectedStudent.name || "Student",
                    )
                  }
                >
                  <MaterialCommunityIcons
                    name="trash-can-outline"
                    size={17}
                    color={theme.rose}
                  />
                  <Text
                    style={[styles.modalDangerBtnText, { color: theme.rose }]}
                  >
                    DELETE
                  </Text>
                </Pressable>

                <Pressable
                  style={[
                    styles.modalDismissBtnFlex,
                    { backgroundColor: theme.cyan },
                  ]}
                  onPress={() => setSelectedStudent(null)}
                >
                  <Text
                    style={[
                      styles.modalDismissBtnText,
                      { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
                    ]}
                  >
                    CLOSE
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
      <StudentEditModal
        visible={!!editingStudent}
        student={editingStudent}
        endpoint={editingStudent ? `/admin/students/${editingStudent.student_id}` : "/admin/students/unknown"}
        onClose={() => setEditingStudent(null)}
        onSaved={(updated) => {
          setStudents((current) => current.map((item) => item.student_id === updated.student_id ? { ...item, ...updated } : item));
          setSelectedStudent((current: any) => current ? { ...current, ...updated } : current);
          setEditingStudent(null);
        }}
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// TEACHER: READ-ONLY ROSTER DIRECTORY
// ---------------------------------------------------------------------------
function TeacherStudentsRoster() {
  const { theme } = useAppTheme();
  const [students, setStudents] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(true);
  const [loadError, setLoadError] = useState("");

  const loadStudents = useCallback(async () => {
    setBusy(true);
    setLoadError("");
    try {
      const response = await http.get("/students");
      if (!Array.isArray(response.data?.students)) {
        throw new Error("The server returned an invalid student list.");
      }
      setStudents(response.data.students);
    } catch (error: any) {
      const detail = error?.response?.data?.detail;
      setLoadError(
        typeof detail === "string"
          ? detail
          : error?.message || "Unable to load students. Check the API connection and sign in again.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    loadStudents();
  }, [loadStudents]);

  const visible = students.filter((x) =>
    JSON.stringify(x).toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Assigned Roster
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            {search.trim()
              ? `${visible.length} matching student${visible.length === 1 ? "" : "s"} in your assigned roster`
              : `${visible.length} student${visible.length === 1 ? "" : "s"} in your assigned roster`}
          </Text>
        </View>
        <View
          style={[
            styles.readOnlyTagPill,
            {
              backgroundColor: theme.cyanGlow,
              borderColor: theme.borderAccent,
            },
          ]}
        >
          <MaterialCommunityIcons name="lock" size={13} color={theme.cyan} />
          <Text style={[styles.readOnlyTagText, { color: theme.cyan }]}>
            ROSTER
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.searchBarGlass,
          { backgroundColor: theme.cardGlass, borderColor: theme.border },
        ]}
      >
        <MaterialCommunityIcons name="magnify" size={20} color={theme.cyan} />
        <TextInput
          style={[styles.searchInputHolo, { color: theme.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Search assigned student roster..."
          placeholderTextColor={theme.muted}
        />
      </View>

      {busy ? (
        <ActivityIndicator
          size="large"
          color={theme.cyan}
          style={{ margin: 30 }}
        />
      ) : loadError && students.length === 0 ? (
        <HoloEmptyState
          icon="cloud-alert-outline"
          title="Unable to load roster"
          desc={loadError}
          actionText="Retry"
          onAction={loadStudents}
        />
      ) : visible.length === 0 ? (
        <HoloEmptyState
          icon="account-group"
          title="No roster students match"
          desc="Ensure you are assigned to active academic department sections."
        />
      ) : (
        <>
        {!!loadError && (
          <HoloEmptyState
            icon="cloud-alert-outline"
            title="Roster refresh failed"
            desc={loadError}
            actionText="Retry"
            onAction={loadStudents}
          />
        )}
        {visible.map((student, i) => (
          <View
            key={student.student_id || i}
            style={[
              styles.rosterItemCard,
              { backgroundColor: theme.cardGlass, borderColor: theme.border },
            ]}
          >
            {student.profile_photo_base64 ? (
              <Image source={{ uri: student.profile_photo_base64 }} style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: theme.cyanGlow }} />
            ) : (
              <View style={[styles.rosterAvatarBox, { backgroundColor: theme.cyanGlow }]}>
                <MaterialCommunityIcons name="account" size={21} color={theme.cyan} />
              </View>
            )}
            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Text style={[styles.rosterItemName, { color: theme.text }]}>
                {student.name || "Student Record"}
              </Text>
              <Text style={[styles.rosterItemId, { color: theme.cyan }]}>
                ID: {student.student_id || "STU-000"}
              </Text>
              <Text style={[styles.rosterItemMeta, { color: theme.muted }]}>
                {student.program || "Course"} • {student.semester || "Semester"}
              </Text>
            </View>
          </View>
        ))}
        </>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ADMIN: FACULTY DIRECTORY
// ---------------------------------------------------------------------------
function AdminTeachersDirectory({ go }: { go: (x: string) => void }) {
  const { theme } = useAppTheme();
  const [teachers, setTeachers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    http
      .get("/admin/users")
      .then((r) =>
        setTeachers(
          (r.data?.users || []).filter((u: any) => u.role === "teacher"),
        ),
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
          text: "Delete Instructor",
          style: "destructive",
          onPress: async () => {
            try {
              await http.delete(`/admin/users/${teacher.id}`);
              setTeachers((v) => v.filter((t) => t.id !== teacher.id));
              setSelected(null);
            } catch (e: any) {
              Alert.alert(
                "Error",
                e?.response?.data?.detail || "Could not delete instructor.",
              );
            }
          },
        },
      ],
    );
  };

  const visible = teachers.filter((t) =>
    JSON.stringify(t).toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Faculty Directory
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            {search.trim()
              ? `${visible.length} matching instructor${visible.length === 1 ? "" : "s"}`
              : `${visible.length} academic instructor${visible.length === 1 ? "" : "s"}`}
          </Text>
        </View>
        <Pressable
          style={[styles.screenAddButtonMini, { backgroundColor: theme.cyan }]}
          onPress={() => go("Add Teacher")}
        >
          <MaterialCommunityIcons
            name="plus"
            size={18}
            color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
          />
          <Text
            style={[
              styles.screenAddBtnMiniText,
              { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
            ]}
          >
            ADD STAFF
          </Text>
        </Pressable>
      </View>

      <View
        style={[
          styles.searchBarGlass,
          { backgroundColor: theme.cardGlass, borderColor: theme.border },
        ]}
      >
        <MaterialCommunityIcons name="magnify" size={20} color={theme.cyan} />
        <TextInput
          style={[styles.searchInputHolo, { color: theme.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Search faculty by name, ID or email..."
          placeholderTextColor={theme.muted}
        />
      </View>

      {busy ? (
        <ActivityIndicator
          size="large"
          color={theme.cyan}
          style={{ margin: 30 }}
        />
      ) : visible.length === 0 ? (
        <HoloEmptyState
          icon="account-tie"
          title="No faculty found"
          desc="Add teachers and professors to authorize attendance sessions."
          actionText="Add Faculty"
          onAction={() => go("Add Teacher")}
        />
      ) : (
        visible.map((teacher, i) => (
          <Pressable
            key={teacher.id || i}
            style={[
              styles.rosterItemCard,
              { backgroundColor: theme.cardGlass, borderColor: theme.border },
            ]}
            onPress={() => setSelected(teacher)}
          >
            <View
              style={[
                styles.rosterAvatarBox,
                { backgroundColor: theme.amberGlow },
              ]}
            >
              <MaterialCommunityIcons
                name="account-tie"
                size={22}
                color={theme.amber}
              />
            </View>
            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Text style={[styles.rosterItemName, { color: theme.text }]}>
                {teacher.display_name || teacher.username}
              </Text>
              <Text style={[styles.rosterItemId, { color: theme.cyan }]}>
                ID: {teacher.username}
              </Text>
              <Text style={[styles.rosterItemMeta, { color: theme.muted }]}>
                {teacher.email || "University Faculty"}
              </Text>
            </View>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={theme.muted}
            />
          </Pressable>
        ))
      )}

      {/* Teacher Modal */}
      {selected && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setSelected(null)}
        >
          <Pressable
            style={styles.modalBackdropOverlay}
            onPress={() => setSelected(null)}
          >
            <Pressable
              style={[
                styles.modalSheetCard,
                {
                  backgroundColor: theme.cardGlass,
                  borderColor: theme.borderBright,
                },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalSheetHeader}>
                <Text style={[styles.modalSheetTitle, { color: theme.text }]}>
                  Faculty Details
                </Text>
                <Pressable onPress={() => setSelected(null)}>
                  <MaterialCommunityIcons
                    name="close"
                    size={22}
                    color={theme.text}
                  />
                </Pressable>
              </View>

              <View style={styles.modalProfileHero}>
                <View
                  style={[
                    styles.modalAvatarGlow,
                    { backgroundColor: theme.amberGlow },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="account-tie"
                    size={36}
                    color={theme.amber}
                  />
                </View>
                <Text style={[styles.modalHeroName, { color: theme.text }]}>
                  {selected.display_name || selected.username}
                </Text>
                <View
                  style={[
                    styles.modalIdBadge,
                    {
                      backgroundColor: theme.amberGlow,
                      borderColor: theme.amber,
                    },
                  ]}
                >
                  <Text
                    style={[styles.modalIdBadgeText, { color: theme.amber }]}
                  >
                    FACULTY • {selected.username}
                  </Text>
                </View>
              </View>

              <View style={styles.modalDetailsGroup}>
                <HoloDetailRow label="Username" value={selected.username} />
                <HoloDetailRow
                  label="Email Address"
                  value={selected.email || "Not specified"}
                />
                <HoloDetailRow label="System Role" value="Faculty Instructor" />
              </View>

              <View style={styles.modalDualActionsRow}>
                <Pressable
                  style={[
                    styles.modalDangerBtn,
                    {
                      backgroundColor: theme.roseGlow,
                      borderColor: theme.rose,
                    },
                  ]}
                  onPress={() => deleteTeacher(selected)}
                >
                  <MaterialCommunityIcons
                    name="trash-can-outline"
                    size={17}
                    color={theme.rose}
                  />
                  <Text
                    style={[styles.modalDangerBtnText, { color: theme.rose }]}
                  >
                    Delete
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.modalDismissBtnFlex,
                    { backgroundColor: theme.cyan },
                  ]}
                  onPress={() => setSelected(null)}
                >
                  <Text
                    style={[
                      styles.modalDismissBtnText,
                      { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
                    ]}
                  >
                    Close
                  </Text>
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
// BIOMETRIC CAMERA MODAL (MANUAL PHOTO CAPTURE PIPELINE)
// ---------------------------------------------------------------------------
interface BiometricCameraModalProps {
  visible: boolean;
  onClose: () => void;
  onCaptureSuccess?: (photoUri: string, validationData?: any) => void;
  onCapture?: (photoUri: string, validationData?: any) => void;
  title?: string;
  subtitle?: string;
}

function BiometricCameraModal({
  visible,
  onClose,
  onCaptureSuccess,
  onCapture,
  title = "Student Face Capture",
  subtitle = "Position yourself in frame and tap shutter",
}: BiometricCameraModalProps) {
  const { theme } = useAppTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [facing, setFacing] = useState<"front" | "back">(DEFAULT_CAMERA_FACING);
  const cameraRef = useRef<any>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [busy, setBusy] = useState(false);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [validationInfo, setValidationInfo] = useState<any>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const blankFrameFallbackUsed = useRef(false);

  const recoverFromBlankFrame = () => {
    setCapturedPhoto(null);
    setValidationInfo(null);
    setCameraReady(false);
    if (!blankFrameFallbackUsed.current) {
      blankFrameFallbackUsed.current = true;
      setFacing((current) => (current === "front" ? "back" : "front"));
      setStatusMessage(
        "This camera has no video feed. Switching cameras—wait for the preview before taking another photo.",
      );
      return;
    }
    setStatusMessage(
      "Neither camera is providing an image. In Android Studio Device Manager, set the emulator Front or Back camera to Virtual Scene or Webcam0, then reopen this screen. You can also choose a photo from the gallery.",
    );
  };

  const commitValidatedPhoto = (photoUri: string, validationData: any) => {
    const cb = onCaptureSuccess || onCapture;
    if (cb) cb(photoUri, validationData);
    handleReset();
    onClose();
  };

  const handleCapture = async () => {
    if (busy || (Platform.OS !== "android" && !cameraReady)) return;
    setBusy(true);
    setStatusMessage("Capturing frame & analyzing photo...");
    try {
      let photoUri: string | null = null;
      if (Platform.OS === "android") {
        // CameraView's preview can be live on an Android emulator while its
        // still-image output is black. The system camera uses Android's native
        // capture route and reliably returns the actual sensor image.
        const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
        if (!cameraPermission.granted) {
          throw new Error("Camera permission is required to capture a face photo.");
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing: false,
          quality: 0.9,
          cameraType:
            facing === "front"
              ? ImagePicker.CameraType.front
              : ImagePicker.CameraType.back,
        });
        if (result.canceled) {
          setStatusMessage("Capture cancelled. Tap CAPTURE & PROCESS to try again.");
          return;
        }
        photoUri = result.assets?.[0]?.uri ?? null;
      } else {
        const photo = await cameraRef.current?.takePictureAsync({ quality: 0.9 });
        photoUri = photo?.uri ?? null;
      }
      if (!photoUri) throw new Error("Could not capture image from camera");

      setCapturedPhoto(photoUri);

      // Run detection & embedding pipeline check on complete frame
      const data = new FormData();
      data.append("file", {
        uri: photoUri,
        name: "capture.jpg",
        type: "image/jpeg",
      } as any);
      data.append("target_pose", "any");

      setStatusMessage("Analyzing complete frame for face...");
      const res = await http.post("/validate-face", data, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (res.data?.frame_blank) {
        recoverFromBlankFrame();
        return;
      }

      if (res.data?.valid) {
        blankFrameFallbackUsed.current = false;
        setValidationInfo(res.data);
        setStatusMessage("Face detected and verified! Ready to register.");
        // A verified capture is already the final user intent. Commit it to
        // the parent form immediately so enrollment cannot lose the image
        // behind a second, easily missed confirmation button.
        commitValidatedPhoto(photoUri, res.data);
      } else {
        setValidationInfo(null);
        setStatusMessage(
          res.data?.user_guidance ||
            res.data?.issues?.[0] ||
            "No clear face detected in photo. Please ensure good lighting.",
        );
      }
    } catch (e: any) {
      setStatusMessage(
        e?.response?.data?.detail ||
          e?.message ||
          "Could not detect face in frame. Please retake photo.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = () => {
    if (!capturedPhoto) return;
    if (!validationInfo?.valid) {
      Alert.alert(
        "Face Verification Required",
        statusMessage ||
          "Could not detect a clear face in this photo. Please retake the photo with your face inside the guide.",
        [
          { text: "Retake Photo", onPress: handleRetake },
          { text: "Cancel", style: "cancel" },
        ],
      );
      return;
    }
    commitValidatedPhoto(capturedPhoto, validationInfo);
  };

  const handleRetake = () => {
    setCapturedPhoto(null);
    setValidationInfo(null);
    setStatusMessage("");
    blankFrameFallbackUsed.current = false;
  };

  const handleReset = () => {
    setCapturedPhoto(null);
    setValidationInfo(null);
    setStatusMessage("");
    setBusy(false);
    blankFrameFallbackUsed.current = false;
  };

  const pickFromGallery = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.85,
      });
      if (!res.canceled && res.assets?.[0]?.uri) {
        const uri = res.assets[0].uri;
        setCapturedPhoto(uri);
        setBusy(true);
        setStatusMessage("Validating selected photo...");
        const data = new FormData();
        data.append("file", {
          uri,
          name: "gallery.jpg",
          type: "image/jpeg",
        } as any);
        data.append("target_pose", "any");
        const vRes = await http.post("/validate-face", data, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        if (vRes.data?.valid) {
          setValidationInfo(vRes.data);
          setStatusMessage("Face verified! Ready to register.");
        } else {
          setValidationInfo(null);
          setStatusMessage(
            vRes.data?.issues?.[0] || "No clear face found in image.",
          );
        }
      }
    } catch (e: any) {
      setStatusMessage(
        "Validation error: " + (e?.message || "Please choose another image"),
      );
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <SafeAreaView
        style={[styles.biometricModalContainer, { backgroundColor: theme.bg }]}
      >
        {/* Header Bar */}
        <View
          style={[
            styles.biometricModalHeader,
            { borderBottomColor: theme.border },
          ]}
        >
          <Pressable
            onPress={() => {
              handleReset();
              onClose();
            }}
            style={[
              styles.backBtnCircle,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <MaterialCommunityIcons name="close" size={20} color={theme.text} />
          </Pressable>
          <View style={{ flex: 1, paddingHorizontal: 12 }}>
            <Text
              style={[styles.biometricHeaderTitle, { color: theme.text }]}
              numberOfLines={1}
            >
              {title}
            </Text>
            <Text
              style={[styles.biometricHeaderSub, { color: theme.muted }]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              setCameraReady(false);
              setFacing((prev) => (prev === "front" ? "back" : "front"));
            }}
            style={[
              styles.backBtnCircle,
              { backgroundColor: theme.card, borderColor: theme.border },
            ]}
          >
            <MaterialCommunityIcons
              name="camera-flip"
              size={20}
              color={theme.cyan}
            />
          </Pressable>
        </View>

        {/* Android deliberately uses only the system still-camera. Keeping a
            second in-app preview here caused black output on the emulator and
            made the registration flow look like a recording screen. */}
        {Platform.OS === "android" ? (
          <View style={styles.nativeCaptureScreen}>
            <View
              style={[
                styles.nativeCaptureIcon,
                { backgroundColor: theme.blueGlow, borderColor: theme.borderAccent },
              ]}
            >
              <MaterialCommunityIcons name="camera" size={46} color={theme.blue} />
            </View>
            <Text style={[styles.nativeCaptureTitle, { color: theme.text }]}>
              Take a face photo
            </Text>
            <Text style={[styles.nativeCaptureText, { color: theme.textSecondary }]}>
              Tap the button, take one photo in the system camera, and it will be uploaded for face validation automatically.
            </Text>
            <Pressable
              onPress={handleCapture}
              disabled={busy}
              style={({ pressed }) => [
                styles.nativeCaptureButton,
                { backgroundColor: theme.blue },
                pressed && { opacity: 0.85 },
                busy && { opacity: 0.6 },
              ]}
            >
              {busy ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <MaterialCommunityIcons name="camera" size={21} color="#FFFFFF" />
                  <Text style={styles.nativeCaptureButtonText}>Take Photo & Upload</Text>
                </>
              )}
            </Pressable>
            {!!statusMessage && (
              <Text style={[styles.nativeCaptureStatus, { color: theme.textSecondary }]}>
                {statusMessage}
              </Text>
            )}
          </View>
        ) : !permission?.granted ? (
          <View style={styles.biometricPermWrap}>
            <MaterialCommunityIcons
              name="camera-off"
              size={48}
              color={theme.cyan}
            />
            <Text style={[styles.permTitleHolo, { color: theme.text }]}>
              Camera Access Required
            </Text>
            <Text style={[styles.permDescHolo, { color: theme.muted }]}>
              Please grant camera permission to capture and register facial
              biometrics.
            </Text>
            <Pressable
              style={[
                styles.primaryNeonButton,
                { backgroundColor: theme.cyan },
              ]}
              onPress={requestPermission}
            >
              <Text
                style={[
                  styles.primaryNeonButtonText,
                  { color: "#FFFFFF" },
                ]}
              >
                Grant Camera Access
              </Text>
            </Pressable>
          </View>
        ) : capturedPhoto ? (
          /* Preview Mode with Confirmation */
          <View style={styles.biometricPreviewContainer}>
            <View
              style={[
                styles.biometricPreviewCard,
                {
                  borderColor: busy
                    ? theme.cyan
                    : validationInfo?.valid
                      ? theme.emerald
                      : theme.amber,
                },
              ]}
            >
              <Image
                source={{ uri: capturedPhoto }}
                style={styles.biometricPreviewImg}
                resizeMode="cover"
              />
              {busy ? (
                <View
                  style={[
                    styles.biometricVerifiedBadge,
                    {
                      backgroundColor: theme.cyanGlow,
                      borderColor: theme.cyan,
                    },
                  ]}
                >
                  <ActivityIndicator size="small" color={theme.cyan} />
                  <Text
                    style={[
                      styles.biometricVerifiedText,
                      { color: theme.cyan, marginLeft: 6 },
                    ]}
                  >
                    Analyzing face...
                  </Text>
                </View>
              ) : validationInfo?.valid ? (
                <View
                  style={[
                    styles.biometricVerifiedBadge,
                    {
                      backgroundColor: theme.emeraldGlow,
                      borderColor: theme.emerald,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="check-circle"
                    size={18}
                    color={theme.emerald}
                  />
                  <Text
                    style={[
                      styles.biometricVerifiedText,
                      { color: theme.emerald, marginLeft: 6 },
                    ]}
                  >
                    FACE DETECTED & VERIFIED
                  </Text>
                </View>
              ) : (
                <View
                  style={[
                    styles.biometricVerifiedBadge,
                    {
                      backgroundColor: theme.amberGlow,
                      borderColor: theme.amber,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="alert-circle"
                    size={18}
                    color={theme.amber}
                  />
                  <Text
                    style={[
                      styles.biometricVerifiedText,
                      { color: theme.amber, marginLeft: 6 },
                    ]}
                  >
                    NO FACE DETECTED
                  </Text>
                </View>
              )}
            </View>

            {/* Status Message */}
            {!!statusMessage && (
              <View
                style={[
                  styles.biometricStatusBox,
                  {
                    backgroundColor: busy
                      ? theme.cyanGlow
                      : validationInfo?.valid
                        ? theme.emeraldGlow
                        : theme.amberGlow,
                    borderColor: busy
                      ? theme.cyan
                      : validationInfo?.valid
                        ? theme.emerald
                        : theme.amber,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={
                    busy
                      ? "information-outline"
                      : validationInfo?.valid
                        ? "check-circle-outline"
                        : "alert-circle-outline"
                  }
                  size={18}
                  color={
                    busy
                      ? theme.cyan
                      : validationInfo?.valid
                        ? theme.emerald
                        : theme.amber
                  }
                />
                <Text
                  style={[
                    styles.biometricStatusBoxText,
                    {
                      color: busy
                        ? theme.cyan
                        : validationInfo?.valid
                          ? theme.emerald
                          : theme.amber,
                    },
                  ]}
                >
                  {statusMessage}
                </Text>
              </View>
            )}

            {/* Actions: Confirm or Retake */}
            <View style={styles.biometricActionsRow}>
              <Pressable
                style={[
                  styles.biometricRetakeBtn,
                  {
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.border,
                  },
                ]}
                onPress={handleRetake}
              >
                <MaterialCommunityIcons
                  name="camera-retake-outline"
                  size={18}
                  color={theme.text}
                />
                <Text
                  style={[styles.biometricRetakeBtnText, { color: theme.text }]}
                >
                  Retake Photo
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.biometricConfirmBtn,
                  {
                    backgroundColor: validationInfo?.valid
                      ? theme.emerald
                      : theme.muted,
                  },
                  (busy || !validationInfo?.valid) && { opacity: 0.6 },
                ]}
                onPress={handleConfirm}
                disabled={busy}
              >
                <MaterialCommunityIcons
                  name={validationInfo?.valid ? "check-bold" : "camera-retake"}
                  size={18}
                  color="#FFFFFF"
                />
                <Text
                  style={[
                    styles.biometricConfirmBtnText,
                    { color: "#FFFFFF" },
                  ]}
                >
                  {validationInfo?.valid ? "USE THIS PHOTO" : "RETAKE REQUIRED"}
                </Text>
              </Pressable>
            </View>
          </View>
        ) : (
          /* Live Camera Viewfinder & Fixed Bottom Controls */
          <View style={styles.biometricCameraFullFrame}>
            {/* Viewfinder area (Full Frame) */}
            <View style={styles.biometricViewfinderArea}>
              <CameraView
                key={`biometric-camera-${facing}`}
                ref={cameraRef}
                style={StyleSheet.absoluteFillObject}
                facing={facing}
                onCameraReady={() => {
                  setCameraError("");
                  setCameraReady(true);
                }}
                onMountError={() => setCameraError("Camera unavailable")}
              />

              {/* Viewfinder frame corner markers */}
              <View
                style={[styles.hudCornerTopLeft, { borderColor: theme.cyan }]}
              />
              <View
                style={[styles.hudCornerTopRight, { borderColor: theme.cyan }]}
              />
              <View
                style={[styles.hudCornerBottomLeft, { borderColor: theme.cyan }]}
              />
              <View
                style={[styles.hudCornerBottomRight, { borderColor: theme.cyan }]}
              />

              {/* Telemetry Status Bar */}
              <View
                style={[
                  styles.hudLiveTelemetryBar,
                  { borderColor: theme.borderAccent },
                ]}
              >
                <View
                  style={[
                    styles.hudTelemetryDot,
                    {
                      backgroundColor: busy
                        ? theme.amber
                        : cameraReady
                          ? theme.emerald
                          : theme.cyan,
                    },
                  ]}
                />
                <Text style={styles.hudTelemetryLabel}>
                  {busy
                    ? "ANALYZING BIOMETRICS..."
                    : cameraReady
                      ? "FRAME READY • TAP SHUTTER TO CAPTURE"
                      : "STARTING CAMERA..."}
                </Text>
              </View>

              {/* This lives in the viewfinder layer so Android's camera
                  surface cannot push the actual capture action off-screen. */}
              <Pressable
                onPress={handleCapture}
                disabled={busy || !cameraReady}
                style={({ pressed }) => [
                  styles.inViewCaptureButton,
                  { backgroundColor: theme.blue },
                  pressed && { transform: [{ scale: 0.97 }] },
                  (busy || !cameraReady) && { opacity: 0.6 },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="camera" size={22} color="#FFFFFF" />
                    <Text style={styles.inViewCaptureButtonText}>
                      CAPTURE & PROCESS
                    </Text>
                  </>
                )}
              </Pressable>
            </View>

            {/* Bottom Controls Bar: Pinned Below Viewfinder */}
            <View
              style={[
                styles.biometricBottomControlBar,
                { backgroundColor: theme.bgElevated, borderTopColor: theme.border },
              ]}
            >
              <Pressable
                onPress={pickFromGallery}
                disabled={busy}
                style={({ pressed }) => [
                  styles.galleryIconBtn,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.border,
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <MaterialCommunityIcons
                  name="image-multiple-outline"
                  size={22}
                  color={theme.text}
                />
              </Pressable>

              {/* Shutter Button (Manual Photo Capture) */}
              <Pressable
                onPress={handleCapture}
                disabled={busy || !cameraReady}
                style={({ pressed }) => [
                  styles.shutterOuterRing,
                  { borderColor: theme.cyan },
                  pressed && { transform: [{ scale: 0.94 }] },
                  (busy || !cameraReady) && { opacity: 0.6 },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={theme.cyan} />
                ) : (
                  <View style={styles.captureButtonContent}>
                    <MaterialCommunityIcons name="camera" size={21} color="#FFFFFF" />
                    <Text style={styles.captureButtonLabel}>CAPTURE & PROCESS</Text>
                  </View>
                )}
              </Pressable>

              <Pressable
                onPress={() => {
                  // A flip remounts the native camera. Require its new stream
                  // to report ready before allowing another capture.
                  setCameraReady(false);
                  setFacing((prev) => (prev === "front" ? "back" : "front"));
                }}
                disabled={busy}
                style={({ pressed }) => [
                  styles.galleryIconBtn,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.border,
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <MaterialCommunityIcons
                  name="camera-flip-outline"
                  size={22}
                  color={theme.text}
                />
              </Pressable>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// ADD STUDENT & BIOMETRIC ENROLLMENT INTEGRATION
// ---------------------------------------------------------------------------
function AddStudent({ go }: { go: (x: string) => void }) {
  const { theme } = useAppTheme();
  const [studentId, setStudentId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [program, setProgram] = useState("");
  const [department, setDepartment] = useState("");
  const [semester, setSemester] = useState("");
  const [rollNumber, setRollNumber] = useState("");
  const [sectionId, setSectionId] = useState<number | null>(null);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [photoValidation, setPhotoValidation] = useState<any>(null);
  const [isValidatingPhoto, setIsValidatingPhoto] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    // Check if previously captured photos exist
    AsyncStorage.getItem("face_registration_photos").then((val) => {
      if (val) {
        try {
          const arr = JSON.parse(val);
          if (Array.isArray(arr) && arr.length > 0) {
            setCapturedPhoto(arr[0]);
            setPhotoValidation({ valid: true });
          }
        } catch {}
      }
    });
  }, []);

  const pickFromGallery = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.85,
      });
      if (!res.canceled && res.assets?.[0]?.uri) {
        const uri = res.assets[0].uri;
        setCapturedPhoto(uri);
        setIsValidatingPhoto(true);
        try {
          const data = new FormData();
          data.append("file", {
            uri,
            name: "gallery.jpg",
            type: "image/jpeg",
          } as any);
          data.append("target_pose", "any");
          const vRes = await http.post("/validate-face", data, {
            headers: { "Content-Type": "multipart/form-data" },
          });
          setPhotoValidation(vRes.data);
        } catch (err: any) {
          setPhotoValidation({
            valid: false,
            issues: [
              err?.response?.data?.detail || "Could not validate face in selected photo.",
            ],
          });
        } finally {
          setIsValidatingPhoto(false);
        }
      }
    } catch {}
  };

  const saveStudent = async () => {
    if (!name.trim()) {
      Alert.alert(
        "Missing Name",
        "Please enter the student's legal full name.",
      );
      return;
    }
    if (!capturedPhoto) {
      Alert.alert(
        "Face Photo Required",
        "Please take or upload a face photo to generate biometric embeddings for attendance.",
      );
      return;
    }
    if (photoValidation && !photoValidation.valid) {
      Alert.alert(
        "Face Verification Required",
        photoValidation?.user_guidance ||
          photoValidation?.issues?.[0] ||
          "The selected photo does not contain a clear face. Please retake the photo.",
      );
      return;
    }
    setBusy(true);
    setUploadProgress(0);
    try {
      const sid = studentId.trim() || `STU-${Date.now().toString().slice(-6)}`;
      const data = new FormData();
      data.append("student_id", sid);
      data.append("name", name.trim());
      data.append("email", email.trim());
      data.append("phone", phone.trim());
      data.append("password", phone.trim());
      data.append("program", program.trim() || "Undergraduate Program");
      data.append("department", department.trim());
      data.append("semester", semester.trim());
      data.append("roll_number", rollNumber.trim());
      if (sectionId) {
        data.append("section_id", String(sectionId));
      }
      data.append("files", {
        uri: capturedPhoto,
        name: "face-0.jpg",
        type: "image/jpeg",
      } as any);

      await http.post("/register-student", data, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (event) => {
          if (event.total) setUploadProgress(Math.round((event.loaded / event.total) * 100));
        },
      });

      await AsyncStorage.removeItem("face_registration_photos");
      Alert.alert(
        "Student Enrolled",
        `Student ${name.trim()} (${sid}) was successfully registered with biometric face profile!`,
        [{ text: "View Students", onPress: () => go("Students") }],
      );
    } catch (e: any) {
      Alert.alert(
        "Enrollment Failed",
        e?.response?.data?.detail ||
          "Could not register student. Please check inputs and retry.",
      );
    } finally {
      setBusy(false);
      setUploadProgress(0);
    }
  };

  return (
    <View style={styles.screenLayout}>
      {/* Top Header */}
      <View style={styles.formTopHeaderRow}>
        <Pressable
          onPress={() => go("Students")}
          style={[
            styles.backBtnCircle,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={19}
            color={theme.text}
          />
        </Pressable>
        <View style={{ flex: 1, paddingLeft: 12 }}>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Enroll Student
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Credentials & facial biometric registration
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.glassFormCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
        ]}
      >
        <Text style={[styles.formGroupHeading, { color: theme.muted }]}>
          STUDENT CREDENTIALS
        </Text>

        {/* Student ID */}
        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
            STUDENT IDENTIFIER
          </Text>
          <View style={styles.twoColumnGridRow}>
            <TextInput
              style={[
                styles.textInputHoloPlain,
                {
                  flex: 1,
                  backgroundColor: theme.bgElevated,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              value={studentId}
              onChangeText={setStudentId}
              placeholderTextColor={theme.muted}
            />
            <Pressable
              style={[
                styles.generateIdBtn,
                {
                  backgroundColor: theme.bgElevated,
                  borderColor: theme.border,
                },
              ]}
              onPress={() =>
                setStudentId(`STU-${Date.now().toString().slice(-6)}`)
              }
            >
              <MaterialCommunityIcons
                name="refresh"
                size={18}
                color={theme.cyan}
              />
              <Text style={[styles.generateIdBtnText, { color: theme.cyan }]}>
                New ID
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>Roll Number</Text>
          <TextInput
            style={[styles.textInputHoloPlain, { backgroundColor: theme.bgElevated, borderColor: theme.border, color: theme.text }]}
            value={rollNumber}
            onChangeText={setRollNumber}
            placeholderTextColor={theme.muted}
          />
        </View>

        {/* Full Name */}
        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
            FULL LEGAL NAME *
          </Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              {
                backgroundColor: theme.bgElevated,
                borderColor: theme.border,
                color: theme.text,
              },
            ]}
            value={name}
            onChangeText={setName}
            placeholderTextColor={theme.muted}
          />
        </View>

        {/* University Email */}
        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
            UNIVERSITY EMAIL
          </Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              {
                backgroundColor: theme.bgElevated,
                borderColor: theme.border,
                color: theme.text,
              },
            ]}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
          />
        </View>

        {/* The mobile number is also used as the student's initial password. */}
        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>MOBILE NUMBER / INITIAL PASSWORD *</Text>
          <TextInput
            style={[styles.textInputHoloPlain, { backgroundColor: theme.bgElevated, borderColor: theme.border, color: theme.text }]}
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            placeholder="Enter mobile number"
            placeholderTextColor={theme.muted}
          />
          <Text style={[styles.fieldHintText, { color: theme.muted }]}>The student will use this mobile number as their initial password.</Text>
        </View>

        {/* Academic Placement */}
        <AcademicCascade
          onChange={(sel, match) => {
            if (sel.program) setProgram(sel.program);
            if (sel.department) setDepartment(sel.department);
            if (sel.semester) setSemester(sel.semester);
            if (match?.id) setSectionId(match.id);
          }}
        />

        {/* BIOMETRIC FACE PROFILE SECTION */}
        <Text
          style={[
            styles.formGroupHeading,
            { color: theme.muted, marginTop: 22 },
          ]}
        >
          BIOMETRIC FACE PROFILE
        </Text>

        {capturedPhoto ? (
          /* Face Photo Captured Card */
          <View
            style={[
              styles.photoVerifiedCard,
              {
                backgroundColor: theme.bgElevated,
                borderColor: isValidatingPhoto
                  ? theme.cyan
                  : photoValidation?.valid
                    ? theme.emerald
                    : theme.amber,
              },
            ]}
          >
            <Image
              source={{ uri: capturedPhoto }}
              style={styles.photoVerifiedThumb}
              resizeMode="cover"
            />
            <View style={{ flex: 1, paddingLeft: 14 }}>
              {isValidatingPhoto ? (
                <View style={styles.verifiedRow}>
                  <ActivityIndicator size="small" color={theme.cyan} />
                  <Text style={[styles.verifiedTitle, { color: theme.cyan, marginLeft: 6 }]}>
                    Validating Face...
                  </Text>
                </View>
              ) : photoValidation?.valid ? (
                <>
                  <View style={styles.verifiedRow}>
                    <MaterialCommunityIcons
                      name="check-circle"
                      size={18}
                      color={theme.emerald}
                    />
                    <Text style={[styles.verifiedTitle, { color: theme.emerald, marginLeft: 6 }]}>
                      Face Photo Verified
                    </Text>
                  </View>
                  <Text style={[styles.verifiedSub, { color: theme.muted }]}>
                    Face detected. Biometric embeddings ready for enrollment.
                  </Text>
                </>
              ) : (
                <>
                  <View style={styles.verifiedRow}>
                    <MaterialCommunityIcons
                      name="alert-circle"
                      size={18}
                      color={theme.amber}
                    />
                    <Text style={[styles.verifiedTitle, { color: theme.amber, marginLeft: 6 }]}>
                      Face Not Verified
                    </Text>
                  </View>
                  <Text style={[styles.verifiedSub, { color: theme.amber }]}>
                    {photoValidation?.user_guidance ||
                      photoValidation?.issues?.[0] ||
                      "Could not detect a clear face in this photo. Please retake."}
                  </Text>
                </>
              )}
              <View style={styles.retakeActionsRow}>
                <Pressable
                  style={[
                    styles.smallActionBtn,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                  onPress={() => setIsCameraOpen(true)}
                >
                  <MaterialCommunityIcons
                    name="camera"
                    size={14}
                    color={theme.cyan}
                  />
                  <Text
                    style={[styles.smallActionBtnText, { color: theme.cyan }]}
                  >
                    Retake
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.smallActionBtn,
                    { backgroundColor: theme.card, borderColor: theme.border },
                  ]}
                  onPress={pickFromGallery}
                >
                  <MaterialCommunityIcons
                    name="image"
                    size={14}
                    color={theme.text}
                  />
                  <Text
                    style={[styles.smallActionBtnText, { color: theme.text }]}
                  >
                    Gallery
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : (
          /* Biometric Prompt Card */
          <View
            style={[
              styles.biometricPromptCardEnhanced,
              {
                backgroundColor: theme.bgElevated,
                borderColor: theme.cyanGlow,
              },
            ]}
          >
            <View style={styles.biometricPromptInfoRow}>
              <View
                style={[
                  styles.biometricIconBadge,
                  { backgroundColor: theme.card },
                ]}
              >
                <MaterialCommunityIcons
                  name="face-recognition"
                  size={28}
                  color={theme.cyan}
                />
              </View>
              <View style={{ flex: 1, paddingLeft: 12 }}>
                <Text
                  style={[styles.biometricCardTitle, { color: theme.text }]}
                >
                  Biometric Face Capture
                </Text>
                <Text style={[styles.biometricCardSub, { color: theme.muted }]}>
                  Click photo with camera to generate student face embeddings
                </Text>
              </View>
            </View>

            <View style={styles.biometricButtonsRow}>
              <Pressable
                style={[
                  styles.openCameraBtnPrimary,
                  { backgroundColor: theme.cyan },
                ]}
                onPress={() => setIsCameraOpen(true)}
              >
                <MaterialCommunityIcons
                  name="camera"
                  size={19}
                  color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
                />
                <Text
                  style={[
                    styles.openCameraBtnText,
                    { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
                  ]}
                >
                  TAKE FACE PHOTO
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.chooseGalleryBtn,
                  { backgroundColor: theme.card, borderColor: theme.border },
                ]}
                onPress={pickFromGallery}
              >
                <MaterialCommunityIcons
                  name="image-plus"
                  size={18}
                  color={theme.text}
                />
                <Text
                  style={[styles.chooseGalleryBtnText, { color: theme.text }]}
                >
                  Gallery
                </Text>
              </Pressable>
            </View>
          </View>
        )}

        {busy && uploadProgress > 0 && (
          <UploadDonut progress={uploadProgress} label="UPLOADING PHOTO" />
        )}

        {/* Submit Actions */}
        <View style={styles.formActionButtonsRow}>
          <Pressable
            style={[
              styles.formCancelBtn,
              { backgroundColor: theme.bgElevated, borderColor: theme.border },
            ]}
            onPress={() => go("Students")}
          >
            <Text
              style={[styles.formCancelBtnText, { color: theme.textSecondary }]}
            >
              Cancel
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.formSubmitBtn,
              { backgroundColor: theme.cyan, shadowColor: theme.cyan },
              busy && { opacity: 0.7 },
            ]}
            onPress={saveStudent}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator
                color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
              />
            ) : (
              <Text
                style={[
                  styles.formSubmitBtnText,
                  { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
                ]}
              >
                ENROLL STUDENT
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      {/* Biometric Camera Modal */}
      <BiometricCameraModal
        visible={isCameraOpen}
        onClose={() => setIsCameraOpen(false)}
        onCaptureSuccess={(uri, validationData) => {
          setCapturedPhoto(uri);
          setPhotoValidation(validationData || { valid: true });
        }}
        title="Student Face Capture"
        subtitle="Position student in frame and tap shutter"
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// ADD TEACHER SCREEN
// ---------------------------------------------------------------------------
function AddTeacher({ go }: { go: (x: string) => void }) {
  const { theme } = useAppTheme();
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
      Alert.alert(
        "Missing Fields",
        "Please complete name, employee ID, and password.",
      );
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
        [{ text: "View Faculty", onPress: () => go("Teachers") }],
      );
    } catch (e: any) {
      Alert.alert(
        "Creation Failed",
        e?.response?.data?.detail || "Please check inputs.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screenLayout}>
      <View style={styles.formTopHeaderRow}>
        <Pressable
          onPress={() => go("Teachers")}
          style={[
            styles.backBtnCircle,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={19}
            color={theme.text}
          />
        </Pressable>
        <View style={{ flex: 1, paddingLeft: 12 }}>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Add Faculty
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Register instructor & department assignment
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.glassFormCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
        ]}
      >
        <Text style={[styles.formGroupHeading, { color: theme.muted }]}>
          INSTRUCTOR PROFILE
        </Text>
        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
            FULL LEGAL NAME
          </Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              {
                backgroundColor: theme.bgElevated,
                borderColor: theme.border,
                color: theme.text,
              },
            ]}
            value={form.name}
            onChangeText={(v) => setForm((p) => ({ ...p, name: v }))}
            placeholderTextColor={theme.muted}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
            UNIVERSITY EMAIL
          </Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              {
                backgroundColor: theme.bgElevated,
                borderColor: theme.border,
                color: theme.text,
              },
            ]}
            value={form.email}
            onChangeText={(v) => setForm((p) => ({ ...p, email: v }))}
            keyboardType="email-address"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
            EMPLOYEE ID / USERNAME
          </Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              {
                backgroundColor: theme.bgElevated,
                borderColor: theme.border,
                color: theme.text,
              },
            ]}
            value={form.username}
            onChangeText={(v) => setForm((p) => ({ ...p, username: v }))}
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
            PASSWORD
          </Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              {
                backgroundColor: theme.bgElevated,
                borderColor: theme.border,
                color: theme.text,
              },
            ]}
            value={form.password}
            onChangeText={(v) => setForm((p) => ({ ...p, password: v }))}
            secureTextEntry
            placeholderTextColor={theme.muted}
          />
        </View>

        <TeacherHierarchyCheckboxes
          selected={selectedSections}
          onChange={setSelectedSections}
        />

        <View style={styles.formActionButtonsRow}>
          <Pressable
            style={[
              styles.formCancelBtn,
              { backgroundColor: theme.bgElevated, borderColor: theme.border },
            ]}
            onPress={() => go("Teachers")}
          >
            <Text
              style={[styles.formCancelBtnText, { color: theme.textSecondary }]}
            >
              Cancel
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.formSubmitBtn,
              { backgroundColor: theme.cyan, shadowColor: theme.cyan },
              busy && { opacity: 0.7 },
            ]}
            onPress={save}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator
                color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
              />
            ) : (
              <Text
                style={[
                  styles.formSubmitBtnText,
                  { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
                ]}
              >
                REGISTER FACULTY
              </Text>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ANIMATED SCI-FI BIOMETRIC HUD (FACE REGISTRATION)
// ---------------------------------------------------------------------------
function FaceRegistration({ go }: { go: (x: string) => void }) {
  const { theme } = useAppTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [step, setStep] = useState(0);
  const [captured, setCaptured] = useState<string[]>([]);
  const cameraRef = useRef<any>(null);
  const [busy, setBusy] = useState(false);
  const [facing, setFacing] = useState<"front" | "back">(DEFAULT_CAMERA_FACING);
  const [faceDetected, setFaceDetected] = useState(false);
  const [faceBox, setFaceBox] = useState<
    [number, number, number, number] | null
  >(null);
  const [frameSize, setFrameSize] = useState({ width: 1, height: 1 });
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const blankFrameFallbackUsed = useRef(false);

  const steps = [
    {
      short: "Center",
      title: "Center View",
      guide: "Position face naturally in the frame and click photo.",
    },
    {
      short: "Chin Up",
      title: "Tilt Chin Up",
      guide: "Gently tilt chin upward toward camera and click photo.",
    },
    {
      short: "Chin Down",
      title: "Tilt Chin Down",
      guide: "Gently tilt chin downward toward camera and click photo.",
    },
    {
      short: "Left",
      title: "Turn Left",
      guide: "Turn face slightly left and click photo.",
    },
    {
      short: "Right",
      title: "Turn Right",
      guide: "Turn face slightly right and click photo.",
    },
  ];

  useEffect(() => {
    if (permission === null) return;
    if (!permission.granted) requestPermission();
  }, [permission?.granted]);

  // Manual capture pipeline: User clicks photo -> backend detects face & computes embeddings -> saves
  const validateAndAddPhoto = async (photoUri: string) => {
    setBusy(true);
    setStatusMsg("Analyzing face from frame...");
    setFaceDetected(false);
    setFaceBox(null);
    try {
      const data = new FormData();
      data.append("file", {
        uri: photoUri,
        name: `face-${step}.jpg`,
        type: "image/jpeg",
      } as any);
      data.append("target_pose", "any");

      const res = await http.post("/validate-face", data, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (res.data?.frame_blank) {
        setFaceDetected(false);
        setFaceBox(null);
        setCameraReady(false);
        if (!blankFrameFallbackUsed.current) {
          blankFrameFallbackUsed.current = true;
          setFacing((current) => (current === "front" ? "back" : "front"));
          setStatusMsg(
            "This camera has no video feed. Switching cameras—wait for the preview before trying again.",
          );
        } else {
          setStatusMsg(
            "Neither camera is providing an image. Configure the emulator camera as Virtual Scene or Webcam0, then reopen this screen; or choose a gallery image.",
          );
        }
        return;
      }

      const bbox = res.data?.face_bbox;
      const imageWidth = Number(res.data?.image_width);
      const imageHeight = Number(res.data?.image_height);
      if (
        Array.isArray(bbox) &&
        bbox.length === 4 &&
        imageWidth > 0 &&
        imageHeight > 0
      ) {
        setFaceBox(bbox as [number, number, number, number]);
        setFrameSize({ width: imageWidth, height: imageHeight });
      }

      const isValid =
        res.data?.valid === true ||
        Number(res.data?.faces_detected) > 0;

      if (!isValid) {
        const issuesMsg =
          res.data?.issues?.[0] ||
          res.data?.user_guidance ||
          "No clear face found in frame. Please reposition and click again.";
        setStatusMsg(issuesMsg);
        Alert.alert(
          "Face Not Detected",
          issuesMsg,
        );
        return;
      }

      setFaceDetected(true);
      blankFrameFallbackUsed.current = false;
      setStatusMsg("✓ Face verified successfully!");
      const nextPhotos = [...captured, photoUri];
      setCaptured(nextPhotos);

      if (step < 4) {
        setStep(step + 1);
      } else {
        await AsyncStorage.setItem(
          "face_registration_photos",
          JSON.stringify(nextPhotos),
        );
        Alert.alert(
          "Biometric Scanning Complete",
          "All 5 face angles were recorded and validated.",
          [{ text: "Continue Enrollment", onPress: () => go("Add Student") }],
        );
      }
    } catch (e: any) {
      const msg =
        e?.response?.data?.user_guidance ||
        e?.response?.data?.detail ||
        e?.message ||
        "Face could not be verified. Please retry.";
      setStatusMsg(msg);
      Alert.alert("Biometric Notice", msg);
    } finally {
      setBusy(false);
    }
  };

  const capturePhoto = async () => {
    if (busy || !cameraReady) return;
    try {
      setBusy(true);
      setStatusMsg("Capturing photo from frame...");
      let photoUri: string | null = null;
      if (Platform.OS === "android") {
        const cameraPermission = await ImagePicker.requestCameraPermissionsAsync();
        if (!cameraPermission.granted) {
          throw new Error("Camera permission is required to capture a face photo.");
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: ["images"],
          allowsEditing: false,
          quality: 0.9,
          cameraType:
            facing === "front"
              ? ImagePicker.CameraType.front
              : ImagePicker.CameraType.back,
        });
        if (result.canceled) {
          setStatusMsg("Capture cancelled. Please try again.");
          return;
        }
        photoUri = result.assets?.[0]?.uri ?? null;
      } else {
        const photo = await cameraRef.current?.takePictureAsync({ quality: 0.9 });
        photoUri = photo?.uri ?? null;
      }
      if (!photoUri) throw new Error("Could not acquire image from camera");
      await validateAndAddPhoto(photoUri);
    } catch (e: any) {
      setBusy(false);
      Alert.alert(
        "Camera Error",
        e?.message || "Failed to capture photo from sensor.",
      );
    }
  };

  const pickFromGallery = async () => {
    if (busy) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.88,
    });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    await validateAndAddPhoto(res.assets[0].uri);
  };

  const saveAndFinishEarly = async () => {
    if (captured.length === 0) {
      Alert.alert(
        "No Photos Captured",
        "Please capture at least one face photo before saving.",
      );
      return;
    }
    await AsyncStorage.setItem(
      "face_registration_photos",
      JSON.stringify(captured),
    );
    Alert.alert(
      "Biometrics Saved",
      `${captured.length} photo${captured.length > 1 ? "s" : ""} saved for enrollment.`,
      [{ text: "Continue Enrollment", onPress: () => go("Add Student") }],
    );
  };

  if (!permission || !permission.granted) {
    return (
      <View style={styles.screenLayout}>
        <View
          style={[
            styles.permCardHolo,
            { backgroundColor: theme.cardGlass, borderColor: theme.border },
          ]}
        >
          <MaterialCommunityIcons
            name="camera-off"
            size={44}
            color={theme.cyan}
          />
          <Text style={[styles.permTitleHolo, { color: theme.text }]}>
            Camera Permission Required
          </Text>
          <Text style={[styles.permDescHolo, { color: theme.muted }]}>
            Camera access is needed to capture student face biometrics.
          </Text>
          <Pressable
            style={[styles.primaryNeonButton, { backgroundColor: theme.cyan }]}
            onPress={requestPermission}
          >
            <Text
              style={[
                styles.primaryNeonButtonText,
                { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
              ]}
            >
              GRANT CAMERA ACCESS
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const current = steps[step];

  return (
    <View style={styles.screenLayout}>
      <View style={styles.formTopHeaderRow}>
        <Pressable
          onPress={() => go("Add Student")}
          style={[
            styles.backBtnCircle,
            { backgroundColor: theme.card, borderColor: theme.border },
          ]}
        >
          <MaterialCommunityIcons
            name="arrow-left"
            size={19}
            color={theme.text}
          />
        </Pressable>
        <View style={{ flex: 1, paddingLeft: 12 }}>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Biometric Scan
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Pose {step + 1} of 5: {current.title}
          </Text>
        </View>
      </View>

      {/* 5-Step Holographic Pose Tracker */}
      <View style={styles.hudStepsContainer}>
        {steps.map((s, idx) => (
          <View
            key={s.short}
            style={[
              styles.hudStepBadge,
              { backgroundColor: theme.card, borderColor: theme.border },
              idx === step && {
                borderColor: theme.cyan,
                backgroundColor: theme.cyanGlow,
              },
              idx < step && {
                borderColor: theme.emerald,
                backgroundColor: theme.emeraldGlow,
              },
            ]}
          >
            <Text
              style={[
                styles.hudStepBadgeText,
                { color: theme.muted },
                idx === step && { color: theme.cyan },
                idx < step && { color: theme.emerald },
              ]}
            >
              {idx < step ? "✓" : idx + 1}
            </Text>
          </View>
        ))}
      </View>

      {/* Viewfinder with Animated Laser Beam & Camera Switch */}
      <View
        style={[styles.hudCameraViewport, { borderColor: theme.borderAccent }]}
      >
        {cameraError ? (
          <View style={styles.hudCameraErrorWrap}>
            <Text style={{ color: theme.rose }}>Camera Feed Interrupted</Text>
          </View>
        ) : (
          <View style={styles.cameraFrameWrapper}>
            <CameraView
              key={`registration-camera-${facing}`}
              ref={cameraRef}
              style={StyleSheet.absoluteFillObject}
              facing={facing}
              onCameraReady={() => {
                setCameraError("");
                setCameraReady(true);
              }}
              onMountError={() => setCameraError("Camera error")}
            />

            {/* Camera Flip Overlay Button */}
            <Pressable
              style={[
                styles.cameraFlipBtn,
                {
                  backgroundColor: "rgba(0,0,0,0.6)",
                  borderColor: theme.borderAccent,
                },
              ]}
              onPress={() => {
                setCameraReady(false);
                setFacing((f) => (f === "front" ? "back" : "front"));
              }}
            >
              <MaterialCommunityIcons
                name="camera-flip"
                size={20}
                color="#FFFFFF"
              />
            </Pressable>

            {faceDetected && faceBox && (
              <View
                pointerEvents="none"
                style={[
                  styles.liveFaceBoundingBox,
                  {
                    left: `${Math.max(0, (faceBox[0] / frameSize.width) * 100)}%`,
                    top: `${Math.max(0, (faceBox[1] / frameSize.height) * 100)}%`,
                    width: `${Math.max(1, ((faceBox[2] - faceBox[0]) / frameSize.width) * 100)}%`,
                    height: `${Math.max(1, ((faceBox[3] - faceBox[1]) / frameSize.height) * 100)}%`,
                  },
                ]}
              />
            )}

            {/* Target Reticles */}
            <View
              style={[styles.hudCornerTopLeft, { borderColor: theme.cyan }]}
            />
            <View
              style={[styles.hudCornerTopRight, { borderColor: theme.cyan }]}
            />
            <View
              style={[styles.hudCornerBottomLeft, { borderColor: theme.cyan }]}
            />
            <View
              style={[styles.hudCornerBottomRight, { borderColor: theme.cyan }]}
            />

            {/* Telemetry Status Bar */}
            <View
              style={[
                styles.hudLiveTelemetryBar,
                { borderColor: theme.borderAccent },
              ]}
            >
              <View
                style={[
                  styles.hudTelemetryDot,
                  {
                    backgroundColor: busy
                      ? theme.amber
                      : faceDetected
                        ? theme.emerald
                        : theme.cyan,
                  },
                ]}
              />
              <Text style={styles.hudTelemetryLabel} numberOfLines={1}>
                {statusMsg ||
                  (busy
                    ? "ANALYZING FACE BIOMETRICS..."
                    : cameraReady
                      ? "CLICK PHOTO BUTTON TO CAPTURE"
                      : "STARTING SENSOR...")}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Captured Thumbnails Strip */}
      {captured.length > 0 && (
        <View style={styles.capturedThumbsRow}>
          {captured.map((uri, i) => (
            <View
              key={i}
              style={[styles.capturedThumbWrap, { borderColor: theme.emerald }]}
            >
              <Image source={{ uri }} style={styles.capturedThumbImg} />
            </View>
          ))}
        </View>
      )}

      {/* Pose Instruction & Manual Action Card */}
      <View
        style={[
          styles.hudInstructionCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.border },
        ]}
      >
        <Text style={[styles.hudInstructionTitle, { color: theme.text }]}>
          Step {step + 1}: {current.title}
        </Text>
        <Text
          style={[styles.hudInstructionDesc, { color: theme.textSecondary }]}
        >
          {current.guide}
        </Text>

        {/* Primary Manual Capture Button */}
        <Pressable
          style={[
            styles.hudForceCaptureBtn,
            { backgroundColor: theme.cyan },
            (busy || !cameraReady) && { opacity: 0.7 },
          ]}
          onPress={capturePhoto}
          disabled={busy || !cameraReady}
        >
          {busy ? (
            <ActivityIndicator
              color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
            />
          ) : (
            <View style={styles.submitRow}>
              <MaterialCommunityIcons
                name="camera"
                size={20}
                color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
              />
              <Text
                style={[
                  styles.hudForceCaptureBtnText,
                  { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
                ]}
              >
                CLICK TO CAPTURE PHOTO ({step + 1}/5)
              </Text>
            </View>
          )}
        </Pressable>

        {/* Early Save Biometrics Button */}
        {captured.length > 0 && (
          <Pressable
            style={[
              styles.primaryNeonButton,
              { backgroundColor: theme.emerald, marginTop: 10 },
              busy && { opacity: 0.7 },
            ]}
            onPress={saveAndFinishEarly}
            disabled={busy}
          >
            <View style={styles.submitRow}>
              <MaterialCommunityIcons
                name="check-circle"
                size={18}
                color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
              />
              <Text
                style={[
                  styles.primaryNeonButtonText,
                  { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
                ]}
              >
                SAVE & FINISH ({captured.length} PHOTO
                {captured.length > 1 ? "S" : ""})
              </Text>
            </View>
          </Pressable>
        )}

        {/* Gallery Option */}
        <Pressable
          style={[
            styles.secondaryHoloButton,
            { borderColor: theme.border, marginTop: 10 },
            busy && { opacity: 0.7 },
          ]}
          onPress={pickFromGallery}
          disabled={busy}
        >
          <View style={styles.submitRow}>
            <MaterialCommunityIcons
              name="image-multiple"
              size={17}
              color={theme.text}
            />
            <Text
              style={[styles.secondaryHoloButtonText, { color: theme.text }]}
            >
              CHOOSE FROM GALLERY
            </Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// TEACHER: CLASS ATTENDANCE SESSION CREATOR
// ---------------------------------------------------------------------------
function TeacherTakeAttendance({ go }: { go: (x: string) => void }) {
  const { theme } = useAppTheme();
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [photoCount, setPhotoCount] = useState(0);
  const [scope, setScope] = useState<any>(null);
  const [batchScope, setBatchScope] = useState<any>(null);
  const [attendanceMode, setAttendanceMode] = useState<"BATCH" | "MULTI">("BATCH");
  const [multiSectionIds, setMultiSectionIds] = useState<number[]>([]);
  const [multiScope, setMultiScope] = useState<any>(null);
  const [academicSections, setAcademicSections] = useState<any[]>([]);
  const [selectedPhotos, setSelectedPhotos] = useState<any[]>([]);
  const [batchRequestKey, setBatchRequestKey] = useState<string | null>(null);
  const [showSessionDatePicker, setShowSessionDatePicker] = useState(false);

  const [form, setForm] = useState({
    title: "Class Lecture",
    course: "CS-301 Computer Networks",
    room: "Lab 204",
    // Build the default from local date components so the session date does
    // not shift by a day for teachers in time zones ahead of UTC.
    event_date: toApiDate(formatDisplayDate(new Date())),
    starts_at: "09:00",
    ends_at: "10:00",
    notes: "",
  });

  useEffect(() => {
    const restoreActiveSession = async () => {
      try {
        const activeSessionId = await AsyncStorage.getItem(
          "active_attendance_session_id",
        );
        if (!activeSessionId) return;
        const response = await http.get("/teacher/attendance-sessions");
        const activeSession = (response.data?.sessions || []).find(
          (session: any) => session.session_id === activeSessionId,
        );
        if (activeSession) {
          setScope(activeSession);
          const details = await http.get(`/teacher/attendance-sessions/${activeSessionId}`);
          setPhotoCount((details.data?.batches || []).reduce((total: number, batch: any) => total + Number(batch.total_files || 0), 0));
        }
      } catch {
        // A missing or expired session should not block creation of a new one.
      }
    };
    restoreActiveSession();
  }, []);

  useEffect(() => {
    loadAcademicSections().then(setAcademicSections).catch(() => setAcademicSections([]));
  }, []);

  const multiSections = multiSectionIds
    .map((id) => academicSections.find((section) => section.id === id))
    .filter(Boolean);

  const createSession = async () => {
    const isMulti = attendanceMode === "MULTI";
    if (isMulti && multiSectionIds.length === 0) {
      Alert.alert(
        "Select Programs & Semesters",
        "Please select at least one program and semester section.",
      );
      return;
    }
    const primaryScope = isMulti ? multiSections[0] : batchScope;
    if (!primaryScope?.id || !form.title.trim() || !form.course.trim()) {
      Alert.alert(
        "Complete Details",
        "Please select at least one academic section and specify course and title.",
      );
      return;
    }
    setBusy(true);
    setUploadProgress(0);
    try {
      const distinctSchools = Array.from(new Set(multiSections.map((s) => s.school)));
      const distinctDepts = Array.from(new Set(multiSections.map((s) => s.department)));
      const distinctPrograms = Array.from(new Set(multiSections.map((s) => s.program)));
      const distinctSemesters = Array.from(new Set(multiSections.map((s) => s.semester)));

      const res = await http.post("/teacher/attendance-sessions", {
        ...form,
        school: isMulti
          ? (distinctSchools.length === 1 ? distinctSchools[0] : "University Wide")
          : primaryScope.school,
        faculty: isMulti
          ? (multiSections.every((s) => s.faculty === primaryScope.faculty) ? primaryScope.faculty : "Multiple Faculties")
          : primaryScope.faculty,
        department: isMulti
          ? (distinctDepts.length === 1 ? distinctDepts[0] : "Multiple Departments")
          : primaryScope.department,
        program: isMulti
          ? (distinctPrograms.length === 1 ? distinctPrograms[0] : "Multiple Programs")
          : primaryScope.program,
        semester: isMulti
          ? (distinctSemesters.length === 1 ? distinctSemesters[0] : "Multiple Semesters")
          : primaryScope.semester,
        academic_scope: isMulti
          ? (multiScope || {
              schools: distinctSchools,
              departments: distinctDepts,
              programs: distinctPrograms,
              semesters: distinctSemesters,
              section_ids: multiSectionIds,
            })
          : { school: [primaryScope.school], faculty: [primaryScope.faculty], department: [primaryScope.department], program: [primaryScope.program], semester: [primaryScope.semester] },
        section_id: primaryScope.id,
        section_ids: isMulti ? multiSectionIds : [primaryScope.id],
      });
      const session = { ...res.data, session_id: res.data.session_id };
      setScope(session);
      await AsyncStorage.setItem("active_attendance_session_id", session.session_id);
      Alert.alert(
        "Session Created",
        isMulti
          ? `Attendance session created for ${multiSectionIds.length} programs/semesters across schools and departments. You may now upload multiple classroom photos at once.`
          : "Attendance session created. You may now upload classroom group photos.",
      );
    } catch (e: any) {
      Alert.alert(
        "Error",
        apiErrorMessage(e, "Could not initialize session."),
      );
    } finally {
      setBusy(false);
    }
  };

  const processPhotos = async () => {
    if (!scope?.session_id) {
      Alert.alert("No Session", "Initialize session details first.");
      return;
    }
    const savedSectionIds = Array.isArray(scope?.academic_scope?.section_ids) ? scope.academic_scope.section_ids : [];
    const isMultiMode = attendanceMode === "MULTI" || savedSectionIds.length > 1;
    const targetSectionIds = isMultiMode
      ? (savedSectionIds.length ? savedSectionIds : multiSectionIds)
      : (batchScope?.id ? [batchScope.id] : []);
    if (!targetSectionIds.length || (attendanceMode === "BATCH" && (!batchScope?.program || !batchScope?.semester))) {
      Alert.alert("Select Batch Context", "Select a program and semester for this photo batch.");
      return;
    }
    if (!selectedPhotos.length) {
      Alert.alert("No Photos", "Select one or more classroom photographs first.");
      return;
    }
    setBusy(true);
    try {
      const data = new FormData();
      const requestKey = batchRequestKey || `${scope.session_id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      if (!batchRequestKey) setBatchRequestKey(requestKey);
      data.append("session_id", scope.session_id);
      data.append("section_id", String(targetSectionIds[0]));
      data.append("section_ids", JSON.stringify(targetSectionIds));
      data.append("program", targetSectionIds.length > 1 ? "Multiple programs" : (batchScope?.program || scope.program || "General"));
      data.append("semester", targetSectionIds.length > 1 ? "Multiple semesters" : (batchScope?.semester || scope.semester || "All"));
      data.append("idempotency_key", requestKey);
      selectedPhotos.forEach((asset, index) => data.append("files", {
        uri: asset.uri,
        name: asset.fileName || `classroom-photo-${index + 1}.jpg`,
        type: asset.mimeType || "image/jpeg",
      } as any));

      const res = await http.post("/process-group-attendance", data, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (event) => {
          if (event.total) setUploadProgress(Math.round((event.loaded / event.total) * 100));
        },
      });

      if (res.data) {
        await AsyncStorage.setItem(
          "latest_recognition_result",
          JSON.stringify(res.data),
        );
        await AsyncStorage.setItem(
          "active_attendance_session_id",
          scope.session_id,
        );
      }

      setPhotoCount((count) => count + selectedPhotos.length);
      setSelectedPhotos([]);
      setBatchRequestKey(null);
      Alert.alert(
        "Batch Processed",
        `${res.data.recognized_count || 0} student(s) recognized & marked present across ${targetSectionIds.length > 1 ? `${targetSectionIds.length} programs/semesters` : "the class"}.`,
        [
          { text: "Add More Photos", style: "cancel" },
          { text: "View Results / Finalize", onPress: () => go("Recognition Results") },
        ],
      );
    } catch (e: any) {
      Alert.alert(
        "Processing Failed",
        apiErrorMessage(e, "Could not process classroom photo. Please retry."),
      );
    } finally {
      setBusy(false);
      setUploadProgress(0);
    }
  };

  const pickFromGallery = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });
    if (!res.canceled && res.assets?.length) {
      setSelectedPhotos((current) => [...current, ...res.assets].slice(0, 10));
      setBatchRequestKey(null);
    }
  };

  const deleteSession = () => {
    if (!scope?.session_id) return;
    Alert.alert(
      "Delete Attendance Session?",
      "This will permanently remove the session and all attendance records created from it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete Session",
          style: "destructive",
          onPress: async () => {
            setBusy(true);
            try {
              await http.delete(`/teacher/attendance-sessions/${scope.session_id}`);
              await AsyncStorage.removeItem("active_attendance_session_id");
              setScope(null);
              setPhotoCount(0);
              Alert.alert("Session Deleted", "The attendance session and its records were removed.");
            } catch (e: any) {
              Alert.alert("Delete Failed", apiErrorMessage(e, "Could not delete the session."));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Take Attendance
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Upload classroom group photos to mark attendance
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.glassFormCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
        ]}
      >
        <Text style={[styles.formGroupHeading, { color: theme.muted }]}>
          SESSION CONFIGURATION
        </Text>

        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
            LECTURE TITLE
          </Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              {
                backgroundColor: theme.bgElevated,
                borderColor: theme.border,
                color: theme.text,
              },
            ]}
            value={form.title}
            onChangeText={(v) => setForm((p) => ({ ...p, title: v }))}
            placeholder="e.g. Distributed Systems Lab"
            placeholderTextColor={theme.muted}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
            COURSE CODE & TITLE
          </Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              {
                backgroundColor: theme.bgElevated,
                borderColor: theme.border,
                color: theme.text,
              },
            ]}
            value={form.course}
            onChangeText={(v) => setForm((p) => ({ ...p, course: v }))}
            placeholder="e.g. CS-402 Distributed Systems"
            placeholderTextColor={theme.muted}
          />
        </View>

        <Text style={[styles.formGroupHeading, { color: theme.muted, marginTop: 14 }]}>Attendance Scope</Text>
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 10 }}>
          {(["BATCH", "MULTI"] as const).map((mode) => (
            <Pressable key={mode} onPress={() => setAttendanceMode(mode)} style={[styles.filterSegmentBtn, { flex: 1, borderWidth: 1, borderColor: attendanceMode === mode ? theme.cyan : theme.border, backgroundColor: attendanceMode === mode ? theme.cyanGlow : theme.bgElevated, paddingVertical: 10, borderRadius: 10, alignItems: "center" }]}>
              <Text style={[styles.filterSegmentBtnText, { color: attendanceMode === mode ? theme.cyan : theme.muted }]}>{mode === "BATCH" ? "Single Program / Semester" : "Multiple Programs / Semesters"}</Text>
            </Pressable>
          ))}
        </View>
        {attendanceMode === "BATCH" ? (
          <AcademicCascade
            onChange={(selection, matchedSection) => {
              if (matchedSection && selection.program && selection.semester) setBatchScope(matchedSection);
            }}
          />
        ) : (
          <>
            <MultiProgramAttendanceSelector selected={multiSectionIds} onChange={setMultiSectionIds} onScopeChange={setMultiScope} />
            <Text style={[styles.multiPhotoHint, { color: theme.textSecondary, marginTop: 4 }]}>Select every required program and semester across schools and departments. Uploading multiple photos will match and mark attendance for students across all selected sections.</Text>
          </>
        )}

        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
            LOCATION / ROOM
          </Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              {
                backgroundColor: theme.bgElevated,
                borderColor: theme.border,
                color: theme.text,
              },
            ]}
            value={form.room}
            onChangeText={(v) => setForm((p) => ({ ...p, room: v }))}
            placeholder="Room 101"
            placeholderTextColor={theme.muted}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
            SESSION DATE
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Choose attendance session date"
            onPress={() => setShowSessionDatePicker(true)}
            style={[
              styles.datePickerCardHolo,
              {
                backgroundColor: theme.bgElevated,
                borderColor: theme.border,
                marginBottom: 0,
              },
            ]}
          >
            <MaterialCommunityIcons name="calendar" size={20} color={theme.cyan} />
            <Text style={[styles.datePickerCardText, { color: theme.text }]}>
              {parseDisplayDate(fromApiDate(form.event_date)).toLocaleDateString(undefined, {
                weekday: "short",
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </Text>
            <MaterialCommunityIcons name="chevron-down" size={19} color={theme.muted} />
          </Pressable>
          <Text style={[styles.multiPhotoHint, { color: theme.textSecondary, marginTop: 6 }]}>
            This selected date will appear on the attendance PDF report.
          </Text>
          {showSessionDatePicker && (
            <DateTimePicker
              value={parseDisplayDate(fromApiDate(form.event_date))}
              mode="date"
              display="calendar"
              onChange={(_, date) => {
                setShowSessionDatePicker(false);
                if (date) {
                  setForm((current) => ({
                    ...current,
                    event_date: toApiDate(formatDisplayDate(date)),
                  }));
                }
              }}
            />
          )}
        </View>

        <View style={styles.twoColumnGridRow}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
              STARTS
            </Text>
            <TextInput
              style={[
                styles.textInputHoloPlain,
                {
                  backgroundColor: theme.bgElevated,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              value={form.starts_at}
              onChangeText={(v) => setForm((p) => ({ ...p, starts_at: v }))}
              placeholder="09:00"
              placeholderTextColor={theme.muted}
            />
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
              ENDS
            </Text>
            <TextInput
              style={[
                styles.textInputHoloPlain,
                {
                  backgroundColor: theme.bgElevated,
                  borderColor: theme.border,
                  color: theme.text,
                },
              ]}
              value={form.ends_at}
              onChangeText={(v) => setForm((p) => ({ ...p, ends_at: v }))}
              placeholder="10:00"
              placeholderTextColor={theme.muted}
            />
          </View>
        </View>

        {/* Selected Section Summary */}
        <View
          style={[
            styles.sectionSelectedCard,
            {
              backgroundColor: theme.cyanGlow,
              borderColor: theme.borderAccent,
            },
          ]}
        >
          <MaterialCommunityIcons name="layers" size={20} color={theme.cyan} />
          <View style={{ flex: 1, paddingLeft: 10 }}>
            <Text style={[styles.sectionSelectedTitle, { color: theme.cyan }]}>
              {scope
                ? `${scope.department} • ${scope.academic_scope?.section_ids?.length > 1 ? `${scope.academic_scope.section_ids.length} selected sections` : `${scope.program} • ${scope.semester}`}`
                : attendanceMode === "MULTI"
                  ? multiSections.length > 0
                    ? `${multiSections.length} section(s) selected across ${new Set(multiSections.map((s) => s.school)).size} school(s)`
                    : "Select academic sections below"
                  : batchScope?.program
                    ? `${batchScope.program} • ${batchScope.semester}`
                    : "Select an academic section above"}
            </Text>
            <Text
              style={[
                styles.sectionSelectedSub,
                { color: theme.textSecondary },
              ]}
            >
              {scope?.session_id
                ? `Active Session: #${scope.session_id}`
                : "Ready to create attendance session"}
            </Text>
          </View>
          {scope?.session_id && (
            <Pressable
              onPress={deleteSession}
              disabled={busy}
              style={[styles.sessionDeleteBtn, { borderColor: theme.rose, opacity: busy ? 0.5 : 1 }]}
            >
              <MaterialCommunityIcons name="trash-can-outline" size={17} color={theme.rose} />
            </Pressable>
          )}
        </View>

        {!scope?.session_id ? (
          <Pressable
            style={[
              styles.primaryNeonButton,
              { backgroundColor: theme.cyan },
              busy && { opacity: 0.7 },
            ]}
            onPress={createSession}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator
                color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
              />
            ) : (
              <View style={styles.submitRow}>
                <MaterialCommunityIcons
                  name="plus-circle"
                  size={19}
                  color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
                />
                <Text
                  style={[
                    styles.primaryNeonButtonText,
                    { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
                  ]}
                >
                  CREATE ATTENDANCE SESSION
                </Text>
              </View>
            )}
          </Pressable>
        ) : (
          <>
          <View style={styles.dualPhotoActionsCol}>
            <Pressable
              style={[
                styles.galleryHeroBtn,
                {
                  backgroundColor: theme.cyan,
                  borderColor: theme.cyan,
                },
                busy && { opacity: 0.7 },
              ]}
              onPress={pickFromGallery}
              disabled={busy}
            >
              <MaterialCommunityIcons
                name="image-multiple"
                size={24}
                color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
              />
              <Text style={[styles.galleryHeroBtnTitle, { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" }]}>
                {photoCount > 0 ? "ADD PHOTO" : "UPLOAD GROUP PHOTOS"}
              </Text>
              <Text style={[styles.galleryHeroBtnSub, { color: theme.mode === "dark" ? "rgba(8,12,20,0.75)" : "rgba(255,255,255,0.85)" }]}>
                {photoCount > 0
                  ? "Add more photos to update attendance"
                  : "Select up to 10 photos from gallery"}
              </Text>
            </Pressable>
          </View>
          <Text style={[styles.multiPhotoHint, { color: theme.muted }]}>
            {photoCount > 0 ? `${photoCount} group photo${photoCount === 1 ? "" : "s"} processed. ` : ""}
            You can upload up to 10 group photos for this session. Recognized students are merged automatically.
          </Text>
          {photoCount > 0 && (
            <Text style={[styles.multiPhotoHint, { color: theme.textSecondary, marginTop: 4 }]}>{attendanceMode === "MULTI" ? "This upload uses every selected program and semester in the session." : "Batch context is saved with each upload; choose a new program and semester above before the next batch."}</Text>
          )}
          {photoCount > 0 && (
            <Pressable
              style={[styles.viewResultsBtn, { borderColor: theme.border, backgroundColor: theme.cardSubtle }]}
              onPress={() => go("Recognition Results")}
            >
              <MaterialCommunityIcons name="clipboard-text-outline" size={18} color={theme.text} />
              <Text style={[styles.viewResultsBtnText, { color: theme.text }]}>View Latest Results</Text>
            </Pressable>
          )}
          {busy && uploadProgress > 0 && (
            <UploadDonut progress={uploadProgress} label="Uploading Class Photo" />
          )}
          {selectedPhotos.length > 0 && (
            <View style={{ marginTop: 14 }}>
              <Text style={[styles.fieldLabelText, { color: theme.muted }]}>{selectedPhotos.length} {selectedPhotos.length === 1 ? "Photo" : "Photos"} Selected</Text>
              {selectedPhotos.map((asset, index) => (
                <View key={`${asset.uri}-${index}`} style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
                  <Image source={{ uri: asset.uri }} style={{ width: 38, height: 38, borderRadius: 6 }} />
                  <Text numberOfLines={1} style={{ flex: 1, marginLeft: 9, color: theme.text }}>{asset.fileName || `Photo ${index + 1}`}</Text>
                  <Pressable onPress={() => setSelectedPhotos((items) => items.filter((_, itemIndex) => itemIndex !== index))} disabled={busy}>
                    <MaterialCommunityIcons name="close-circle-outline" size={22} color={theme.rose} />
                  </Pressable>
                </View>
              ))}
              <Pressable style={[styles.primaryNeonButton, { backgroundColor: theme.cyan, marginTop: 14 }, busy && { opacity: .6 }]} onPress={processPhotos} disabled={busy}>
                <Text style={[styles.primaryNeonButtonText, { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" }]}>Process {selectedPhotos.length} {selectedPhotos.length === 1 ? "Photo" : "Photos"}</Text>
              </Pressable>
            </View>
          )}
          </>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// TEACHER: RECOGNITION RESULTS VIEW
// ---------------------------------------------------------------------------
function RecognitionResultsView({ go }: { go: (x: string) => void }) {
  const { theme } = useAppTheme();
  const [result, setResult] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const stored = await AsyncStorage.getItem("latest_recognition_result");
        if (stored) {
          const parsed = JSON.parse(stored);
          setResult(parsed);
          setItems(parsed.students || []);
        } else {
          const r = await http.get("/teacher/attendance/report");
          setItems(r.data?.records || []);
        }
      } catch {
        setItems([]);
      } finally {
        setBusy(false);
      }
    };
    loadData();
  }, []);

  if (busy) {
    return (
      <View style={styles.screenCenterLoader}>
        <ActivityIndicator size="large" color={theme.cyan} />
        <Text style={[styles.loaderSubText, { color: theme.muted }]}>
          Analyzing Classroom Faces...
        </Text>
      </View>
    );
  }

  const detectedCount = result?.total_faces_detected ?? items.length;
  const recognizedCount =
    result?.recognized_count ??
    items.filter((x: any) =>
      String(x.status || "")
        .toLowerCase()
        .includes("present"),
    ).length;
  const unrecognizedCount = Math.max(0, detectedCount - recognizedCount);

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Recognition Results
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            {detectedCount} face{detectedCount === 1 ? "" : "s"} detected •{" "}
            {recognizedCount} matched
          </Text>
        </View>
        <Pressable
          style={[styles.screenAddButtonMini, { backgroundColor: theme.cyan }]}
          onPress={() => go("Verify Attendance")}
        >
          <MaterialCommunityIcons
            name="check-all"
            size={18}
            color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
          />
          <Text
            style={[
              styles.screenAddBtnMiniText,
              { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
            ]}
          >
            VERIFY
          </Text>
        </Pressable>
      </View>

      {/* Annotated AI detection image preview */}
      {result?.annotated_image_base64 && (
        <View
          style={[
            styles.annotatedPreviewCard,
            { borderColor: theme.borderAccent, backgroundColor: "#000" },
          ]}
        >
          <Image
            source={{ uri: result.annotated_image_base64 }}
            style={styles.annotatedPreviewImg}
            resizeMode="contain"
          />
          <View
            style={[
              styles.annotatedOverlayBadge,
              { backgroundColor: "rgba(0,0,0,0.7)" },
            ]}
          >
            <MaterialCommunityIcons
              name="face-recognition"
              size={16}
              color={theme.emerald}
            />
            <Text
              style={{
                color: "#FFF",
                fontSize: 11,
                fontWeight: "700",
                marginLeft: 6,
              }}
            >
              {recognizedCount} MATCHED • {unrecognizedCount} UNKNOWN
            </Text>
          </View>
        </View>
      )}

      {/* Metric Stat Cards */}
      <View style={{ flexDirection: "row", gap: 10, marginBottom: 14 }}>
        <View
          style={[
            styles.metricCardHolo,
            {
              flex: 1,
              backgroundColor: theme.cardGlass,
              borderColor: theme.border,
            },
          ]}
        >
          <Text style={[styles.metricCardLabel, { color: theme.muted }]}>
            DETECTED
          </Text>
          <Text style={[styles.metricCardValue, { color: theme.cyan }]}>
            {detectedCount}
          </Text>
        </View>
        <View
          style={[
            styles.metricCardHolo,
            {
              flex: 1,
              backgroundColor: theme.cardGlass,
              borderColor: theme.border,
            },
          ]}
        >
          <Text style={[styles.metricCardLabel, { color: theme.muted }]}>
            RECOGNIZED
          </Text>
          <Text style={[styles.metricCardValue, { color: theme.emerald }]}>
            {recognizedCount}
          </Text>
        </View>
        <View
          style={[
            styles.metricCardHolo,
            {
              flex: 1,
              backgroundColor: theme.cardGlass,
              borderColor: theme.border,
            },
          ]}
        >
          <Text style={[styles.metricCardLabel, { color: theme.muted }]}>
            UNIDENTIFIED
          </Text>
          <Text
            style={[
              styles.metricCardValue,
              { color: unrecognizedCount > 0 ? theme.amber : theme.muted },
            ]}
          >
            {unrecognizedCount}
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.resultsNoticeBox,
          { backgroundColor: theme.cyanGlow, borderColor: theme.borderAccent },
        ]}
      >
        <MaterialCommunityIcons
          name="information"
          size={18}
          color={theme.cyan}
        />
        <Text style={[styles.resultsNoticeText, { color: theme.cyan }]}>
          Review initial face detections below. You can toggle Present / Absent
          status in the verification checklist.
        </Text>
      </View>

      {items.length === 0 ? (
        <HoloEmptyState
          icon="face-recognition"
          title="No face detections yet"
          desc="Capture or upload a classroom photo to generate attendance detections."
          actionText="Take Attendance"
          onAction={() => go("Attendance")}
        />
      ) : (
        <View style={styles.resultsCardsGrid}>
          {items.map((rec, i) => {
            const isPresent =
              rec.confidence !== undefined ||
              String(rec.status || "")
                .toLowerCase()
                .includes("present");
            const confPercent = rec.confidence
              ? Math.round(rec.confidence * 100)
              : null;
            return (
              <View
                key={rec.student_id || i}
                style={[
                  styles.resultItemCardHolo,
                  {
                    backgroundColor: theme.cardGlass,
                    borderColor: theme.border,
                  },
                ]}
              >
                <View
                  style={[
                    styles.resultAvatarCircleHolo,
                    {
                      backgroundColor: isPresent
                        ? theme.emeraldGlow
                        : theme.roseGlow,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="account-check"
                    size={26}
                    color={isPresent ? theme.emerald : theme.rose}
                  />
                </View>
                <Text
                  style={[styles.resultItemNameText, { color: theme.text }]}
                  numberOfLines={1}
                >
                  {rec.name || rec.student_id || "Student"}
                </Text>
                <Text style={[styles.resultItemIdText, { color: theme.muted }]}>
                  {rec.student_id}
                </Text>
                <HoloStatusPill
                  label={
                    confPercent !== null
                      ? `${confPercent}% Match`
                      : rec.status || (isPresent ? "Present" : "Absent")
                  }
                  tone={isPresent ? "success" : "danger"}
                />
              </View>
            );
          })}
        </View>
      )}

      <Pressable
        style={[
          styles.primaryNeonButton,
          { backgroundColor: theme.cyan, marginTop: 20 },
        ]}
        onPress={() => go("Verify Attendance")}
      >
        <MaterialCommunityIcons
          name="account-check"
          size={19}
          color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
        />
        <Text
          style={[
            styles.primaryNeonButtonText,
            { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
          ]}
        >
          PROCEED TO VERIFICATION CHECKLIST
        </Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// TEACHER: VERIFY & FINALIZE ATTENDANCE WITH QUICK FILTERS
// ---------------------------------------------------------------------------
function VerifyAttendanceView({ go }: { go: (x: string) => void }) {
  const { theme } = useAppTheme();
  const [items, setItems] = useState<any[]>([]);
  const [statusOverrides, setStatusOverrides] = useState<
    Record<string, "PRESENT" | "ABSENT">
  >({});
  const [activeFilter, setActiveFilter] = useState<
    "ALL" | "PRESENT" | "ABSENT"
  >("ALL");
  const [sessionId, setSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: 20,
    total_items: 0,
    total_pages: 1,
    has_next: false,
    has_previous: false,
  });
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");

  const loadData = useCallback(
    async (
      targetPage = page,
      targetPageSize = pageSize,
      targetFilter = activeFilter,
      targetSearch = search,
    ) => {
      setLoadError("");
      try {
        let activeId = sessionId;
        if (!activeId) {
          activeId =
            (await AsyncStorage.getItem("active_attendance_session_id")) || "";
        }
        if (!activeId) {
          const storedResult = await AsyncStorage.getItem(
            "latest_recognition_result",
          );
          if (storedResult) {
            const parsed = JSON.parse(storedResult);
            if (parsed.session_id) activeId = parsed.session_id;
          }
        }
        if (activeId) setSessionId(activeId);

        if (activeId) {
          const params: Record<string, any> = {
            page: targetPage,
            page_size: targetPageSize,
            include_photos: true,
          };
          if (targetFilter !== "ALL") params.status = targetFilter;
          if (targetSearch.trim()) params.search = targetSearch.trim();

          const res = await http.get(
            `/attendance/sessions/${activeId}/records`,
            { params },
          );
          const data = res.data || {};
          setItems(data.items || []);
          if (data.session_title) setSessionTitle(data.session_title);
          if (data.pagination) {
            setPagination(data.pagination);
          } else {
            setPagination({
              page: targetPage,
              page_size: targetPageSize,
              total_items: (data.items || []).length,
              total_pages: 1,
              has_next: false,
              has_previous: false,
            });
          }
        } else {
          // Fallback to general students roster if no session exists yet
          const params: Record<string, any> = {
            page: targetPage,
            page_size: targetPageSize,
          };
          if (targetSearch.trim()) params.search = targetSearch.trim();

          const res = await http.get("/students", { params });
          const stList = res.data?.students || [];
          setItems(stList);
          const total = res.data?.total || stList.length;
          const totalPages = Math.ceil(total / targetPageSize) || 1;
          setPagination({
            page: targetPage,
            page_size: targetPageSize,
            total_items: total,
            total_pages: totalPages,
            has_next: targetPage < totalPages,
            has_previous: targetPage > 1,
          });
        }
      } catch (e: any) {
        setLoadError(
          apiErrorMessage(e, "Could not load session attendance roster."),
        );
      } finally {
        setBusy(false);
        setRefreshing(false);
      }
    },
    [sessionId, page, pageSize, activeFilter, search],
  );

  useEffect(() => {
    loadData(page, pageSize, activeFilter, search);
  }, [loadData, page, pageSize, activeFilter, search]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData(page, pageSize, activeFilter, search);
  };

  const toggleStatus = (studentId: string, current: "PRESENT" | "ABSENT") => {
    const nextStatus = current === "PRESENT" ? "ABSENT" : "PRESENT";
    setStatusOverrides((prev) => ({
      ...prev,
      [studentId]: nextStatus,
    }));
  };

  const markPagePresent = () => {
    setStatusOverrides((prev) => {
      const next = { ...prev };
      items.forEach((st) => {
        next[st.student_id] = "PRESENT";
      });
      return next;
    });
  };

  const finalizeAttendance = async () => {
    let currentSession = sessionId;
    if (!currentSession) {
      currentSession =
        (await AsyncStorage.getItem("active_attendance_session_id")) || "";
    }
    if (!currentSession) {
      Alert.alert(
        "Missing Session",
        "Session identifier not found. Please create an attendance session first.",
      );
      return;
    }

    const overriddenCount = Object.keys(statusOverrides).length;
    Alert.alert(
      "Confirm Attendance",
      `Submit attendance for ${pagination.total_items} students? Overridden changes on ${overriddenCount} student(s) will be applied.`,
      [
        { text: "Review", style: "cancel" },
        { text: "Submit", onPress: () => submitAttendance(currentSession) },
      ],
    );
  };

  const submitAttendance = async (currentSession: string) => {
    setSubmitting(true);
    try {
      // Build records payload merging current page records and overrides
      const records = items.map((student) => ({
        student_id: student.student_id,
        status: statusOverrides[student.student_id] || student.status || "ABSENT",
      }));

      // Add any overrides for students on other pages
      Object.entries(statusOverrides).forEach(([student_id, status]) => {
        if (!records.some((r) => r.student_id === student_id)) {
          records.push({ student_id, status });
        }
      });

      await http.post("/teacher/attendance/finalize", {
        session_id: currentSession,
        records,
      });

      Alert.alert(
        "Attendance Confirmed",
        "The finalized attendance records have been successfully submitted to the database.",
        [{ text: "View History", onPress: () => go("History") }],
      );
    } catch (e: any) {
      Alert.alert(
        "Submission Failed",
        apiErrorMessage(e, "Could not finalize attendance records."),
      );
    } finally {
      setSubmitting(false);
    }
  };

  const pagePresentCount = items.filter(
    (st) => (statusOverrides[st.student_id] ?? st.status) === "PRESENT",
  ).length;
  const pageAbsentCount = items.length - pagePresentCount;
  const pageRatio = items.length
    ? Math.round((pagePresentCount / items.length) * 100)
    : 0;

  if (busy && !refreshing && items.length === 0) {
    return (
      <View style={styles.screenCenterLoader}>
        <ActivityIndicator size="large" color={theme.cyan} />
        <Text style={[styles.loaderSubText, { color: theme.muted }]}>
          Loading Roster Checklist...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.screenLayout, { flex: 1 }]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.student_id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.cyan}
          />
        }
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={
          <View>
            <View style={styles.screenTopHeader}>
              <View>
                <Text style={[styles.screenMainTitle, { color: theme.text }]}>
                  Verify Roster
                </Text>
                <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
                  {sessionTitle ? `${sessionTitle} • ` : ""}Review and adjust student status
                </Text>
              </View>
            </View>

            {/* Live Search Input Bar */}
            <View
              style={[
                styles.searchInputWrap,
                { backgroundColor: theme.bgElevated, borderColor: theme.border },
              ]}
            >
              <MaterialCommunityIcons
                name="magnify"
                size={18}
                color={theme.muted}
              />
              <TextInput
                style={[styles.searchTextInput, { color: theme.text }]}
                placeholder="Search by student name or roll number..."
                placeholderTextColor={theme.muted}
                value={search}
                onChangeText={(val) => {
                  setSearch(val);
                  setPage(1);
                }}
              />
              {search ? (
                <Pressable onPress={() => setSearch("")}>
                  <MaterialCommunityIcons
                    name="close-circle"
                    size={16}
                    color={theme.muted}
                  />
                </Pressable>
              ) : null}
            </View>

            {loadError ? (
              <View
                style={[
                  styles.errorBannerBox,
                  {
                    backgroundColor: theme.roseGlow,
                    borderColor: theme.rose,
                    marginTop: 10,
                  },
                ]}
              >
                <Text style={[styles.errorBannerText, { color: theme.rose }]}>
                  {loadError}
                </Text>
                <Pressable onPress={() => loadData(page)}>
                  <Text style={{ color: theme.cyan, fontWeight: "600" }}>
                    Retry
                  </Text>
                </Pressable>
              </View>
            ) : null}

            {/* Roster Ratio & Tally HUD */}
            <View
              style={[
                styles.tallyHUDCard,
                {
                  backgroundColor: theme.cardGlass,
                  borderColor: theme.border,
                  marginTop: 12,
                },
              ]}
            >
              <Text
                style={[
                  styles.tallyRatioSubText,
                  { color: theme.cyan, marginBottom: 8 },
                ]}
              >
                Page {pagination.page} of {pagination.total_pages || 1} • Total {pagination.total_items} students
              </Text>
              <View style={styles.tallyStatsRow}>
                <View style={styles.tallyStatCol}>
                  <Text style={[styles.tallyDigit, { color: theme.emerald }]}>
                    {pagePresentCount}
                  </Text>
                  <Text style={[styles.tallyMeta, { color: theme.muted }]}>
                    Present (Page)
                  </Text>
                </View>
                <View
                  style={[
                    styles.tallyDividerLine,
                    { backgroundColor: theme.border },
                  ]}
                />
                <View style={styles.tallyStatCol}>
                  <Text style={[styles.tallyDigit, { color: theme.rose }]}>
                    {pageAbsentCount}
                  </Text>
                  <Text style={[styles.tallyMeta, { color: theme.muted }]}>
                    Absent (Page)
                  </Text>
                </View>
                <View
                  style={[
                    styles.tallyDividerLine,
                    { backgroundColor: theme.border },
                  ]}
                />
                <View style={styles.tallyStatCol}>
                  <Text style={[styles.tallyDigit, { color: theme.text }]}>
                    {items.length}
                  </Text>
                  <Text style={[styles.tallyMeta, { color: theme.muted }]}>
                    On Page
                  </Text>
                </View>
              </View>

              {/* Attendance Ratio Bar */}
              <View
                style={[
                  styles.tallyProgressBarTrack,
                  { backgroundColor: theme.bgElevated, marginTop: 10 },
                ]}
              >
                <View
                  style={[
                    styles.tallyProgressBarFill,
                    { width: `${pageRatio}%`, backgroundColor: theme.emerald },
                  ]}
                />
              </View>
              <Text style={[styles.tallyRatioSubText, { color: theme.muted }]}>
                {pageRatio}% Recorded Present on this page
              </Text>
            </View>

            {/* Quick Filter Segment Pills & Bulk Button */}
            <View style={styles.verifyToolbarRow}>
              <View
                style={[
                  styles.filterSegmentPillWrap,
                  { backgroundColor: theme.bgElevated },
                ]}
              >
                {(["ALL", "PRESENT", "ABSENT"] as const).map((filterKey) => {
                  const active = activeFilter === filterKey;
                  return (
                    <Pressable
                      key={filterKey}
                      style={[
                        styles.filterSegmentBtn,
                        active && [
                          styles.filterSegmentBtnActive,
                          {
                            backgroundColor: theme.card,
                            borderColor: theme.borderAccent,
                          },
                        ],
                      ]}
                      onPress={() => {
                        setActiveFilter(filterKey);
                        setPage(1);
                      }}
                    >
                      <Text
                        style={[
                          styles.filterSegmentBtnText,
                          { color: active ? theme.cyan : theme.muted },
                          active && { fontWeight: "600" },
                        ]}
                      >
                        {filterKey === "ALL"
                          ? "All"
                          : filterKey === "PRESENT"
                            ? "Present"
                            : "Absent"}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Pressable
                style={[
                  styles.quickBulkBtn,
                  {
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.border,
                  },
                ]}
                onPress={markPagePresent}
              >
                <MaterialCommunityIcons
                  name="check-all"
                  size={16}
                  color={theme.cyan}
                />
                <Text style={[styles.quickBulkBtnText, { color: theme.cyan }]}>
                  Page Present
                </Text>
              </Pressable>
            </View>

            {/* Page Size Selector Row */}
            <View style={styles.pageSizeSelectorRow}>
              <Text style={{ fontSize: 11, color: theme.muted, marginRight: 4 }}>
                Page Size:
              </Text>
              {[20, 50, 100].map((size) => {
                const isSelected = pageSize === size;
                return (
                  <Pressable
                    key={size}
                    style={[
                      styles.pageSizePill,
                      {
                        backgroundColor: isSelected
                          ? theme.cyanGlow
                          : theme.bgElevated,
                        borderColor: isSelected ? theme.cyan : theme.border,
                      },
                    ]}
                    onPress={() => {
                      setPageSize(size);
                      setPage(1);
                    }}
                  >
                    <Text
                      style={[
                        styles.pageSizePillText,
                        { color: isSelected ? theme.cyan : theme.muted },
                      ]}
                    >
                      {size}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        renderItem={({ item: student }) => {
          const currentStatus =
            statusOverrides[student.student_id] ?? student.status ?? "ABSENT";
          const isPresent = currentStatus === "PRESENT";
          return (
            <View
              style={[
                styles.checklistCard,
                { backgroundColor: theme.cardGlass, borderColor: theme.border },
              ]}
            >
              {student.profile_photo_base64 ? (
                <Image
                  source={{ uri: student.profile_photo_base64 }}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: isPresent
                      ? theme.emeraldGlow
                      : theme.roseGlow,
                  }}
                />
              ) : (
                <View
                  style={[
                    styles.rosterAvatarBox,
                    {
                      backgroundColor: isPresent
                        ? theme.emeraldGlow
                        : theme.roseGlow,
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="account"
                    size={21}
                    color={isPresent ? theme.emerald : theme.rose}
                  />
                </View>
              )}

              <View style={{ flex: 1, paddingHorizontal: 12 }}>
                <Text style={[styles.checkListName, { color: theme.text }]}>
                  {student.name || student.student_id}
                </Text>
                <Text style={[styles.checkListId, { color: theme.muted }]}>
                  ID: {student.student_id}
                  {student.roll_number ? ` • Roll: ${student.roll_number}` : ""}
                </Text>
                <Text style={[styles.rosterItemMeta, { color: theme.muted }]}>
                  {student.program || "Program not set"} •{" "}
                  {student.semester ||
                    student.academic_semester ||
                    "Semester not set"}
                </Text>
              </View>

              <Pressable
                style={[
                  styles.togglePillHolo,
                  isPresent
                    ? [
                        styles.togglePillHoloPresent,
                        {
                          backgroundColor: theme.emeraldGlow,
                          borderColor: theme.emerald,
                        },
                      ]
                    : [
                        styles.togglePillHoloAbsent,
                        {
                          backgroundColor: theme.roseGlow,
                          borderColor: theme.rose,
                        },
                      ],
                ]}
                onPress={() => toggleStatus(student.student_id, currentStatus)}
              >
                <MaterialCommunityIcons
                  name={isPresent ? "check" : "close"}
                  size={15}
                  color={isPresent ? theme.emerald : theme.rose}
                />
                <Text
                  style={[
                    styles.togglePillHoloText,
                    { color: isPresent ? theme.emerald : theme.rose },
                  ]}
                >
                  {currentStatus}
                </Text>
              </Pressable>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={{ padding: 30, alignItems: "center" }}>
            <MaterialCommunityIcons
              name="account-search-outline"
              size={36}
              color={theme.muted}
            />
            <Text
              style={{
                color: theme.muted,
                marginTop: 8,
                fontSize: 14,
                textAlign: "center",
              }}
            >
              {search
                ? `No students matching "${search}"`
                : "No student records found"}
            </Text>
          </View>
        }
        ListFooterComponent={
          <View>
            {/* Pagination Controls Bar */}
            <View
              style={[
                styles.paginationRow,
                {
                  backgroundColor: theme.cardGlass,
                  borderColor: theme.border,
                },
              ]}
            >
              <Pressable
                style={[
                  styles.paginationBtn,
                  {
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.border,
                    opacity: pagination.has_previous ? 1 : 0.4,
                  },
                ]}
                disabled={!pagination.has_previous || busy}
                onPress={() => setPage((p) => Math.max(1, p - 1))}
              >
                <MaterialCommunityIcons
                  name="chevron-left"
                  size={16}
                  color={theme.cyan}
                />
                <Text
                  style={[styles.paginationBtnText, { color: theme.cyan }]}
                >
                  Previous
                </Text>
              </Pressable>

              <Text
                style={[styles.paginationInfoText, { color: theme.muted }]}
              >
                Page {pagination.page} of {pagination.total_pages || 1} (
                {pagination.total_items} students)
              </Text>

              <Pressable
                style={[
                  styles.paginationBtn,
                  {
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.border,
                    opacity: pagination.has_next ? 1 : 0.4,
                  },
                ]}
                disabled={!pagination.has_next || busy}
                onPress={() => setPage((p) => p + 1)}
              >
                <Text
                  style={[styles.paginationBtnText, { color: theme.cyan }]}
                >
                  Next
                </Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={16}
                  color={theme.cyan}
                />
              </Pressable>
            </View>

            {/* Submit Attendance Neon Button */}
            <Pressable
              style={[
                styles.primaryNeonButton,
                { backgroundColor: theme.cyan, marginTop: 20 },
                submitting && { opacity: 0.7 },
              ]}
              onPress={finalizeAttendance}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator
                  color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
                />
              ) : (
                <View style={styles.submitRow}>
                  <MaterialCommunityIcons
                    name="lock-check"
                    size={19}
                    color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
                  />
                  <Text
                    style={[
                      styles.primaryNeonButtonText,
                      { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
                    ]}
                  >
                    CONFIRM & SUBMIT ATTENDANCE
                  </Text>
                </View>
              )}
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// ADMIN ATTENDANCE LIVE AUDIT
// ---------------------------------------------------------------------------
function AdminAttendanceView() {
  const { theme } = useAppTheme();
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
    (x) => new Date(x.timestamp).toDateString() === date.toDateString(),
  );
  const presentCount = dayLogs.filter(
    (x) => String(x.status || "PRESENT").toUpperCase() === "PRESENT",
  ).length;

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Attendance Audit
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            {dayLogs.length} attendance record{dayLogs.length === 1 ? "" : "s"} for the selected date
          </Text>
        </View>
      </View>

      {/* Date Trigger Card */}
      <Pressable
        style={[
          styles.datePickerCardHolo,
          { backgroundColor: theme.cardGlass, borderColor: theme.border },
        ]}
        onPress={() => setShowPicker(true)}
      >
        <MaterialCommunityIcons name="calendar" size={20} color={theme.cyan} />
        <Text style={[styles.datePickerCardText, { color: theme.text }]}>
          {date.toLocaleDateString(undefined, {
            weekday: "short",
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </Text>
        <MaterialCommunityIcons
          name="chevron-down"
          size={19}
          color={theme.muted}
        />
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

      {/* Daily Stats */}
      <View
        style={[
          styles.tallyHUDCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.border },
        ]}
      >
        <View style={styles.tallyStatsRow}>
          <View style={styles.tallyStatCol}>
            <Text style={[styles.tallyDigit, { color: theme.emerald }]}>
              {presentCount}
            </Text>
            <Text style={[styles.tallyMeta, { color: theme.muted }]}>
              Present
            </Text>
          </View>
          <View
            style={[styles.tallyDividerLine, { backgroundColor: theme.border }]}
          />
          <View style={styles.tallyStatCol}>
            <Text style={[styles.tallyDigit, { color: theme.rose }]}>
              {dayLogs.length - presentCount}
            </Text>
            <Text style={[styles.tallyMeta, { color: theme.muted }]}>
              Absent
            </Text>
          </View>
          <View
            style={[styles.tallyDividerLine, { backgroundColor: theme.border }]}
          />
          <View style={styles.tallyStatCol}>
            <Text style={[styles.tallyDigit, { color: theme.text }]}>
              {dayLogs.length
                ? Math.round((presentCount / dayLogs.length) * 100)
                : 0}
              %
            </Text>
            <Text style={[styles.tallyMeta, { color: theme.muted }]}>Rate</Text>
          </View>
        </View>
      </View>

      {busy ? (
        <ActivityIndicator
          size="large"
          color={theme.cyan}
          style={{ margin: 30 }}
        />
      ) : dayLogs.length === 0 ? (
        <HoloEmptyState
          icon="calendar-remove-outline"
          title="No records for this date"
          desc="Select another calendar day or capture attendance in class."
        />
      ) : (
        dayLogs.map((log, i) => (
          <View
            key={log.id || i}
            style={[
              styles.rosterItemCard,
              { backgroundColor: theme.cardGlass, borderColor: theme.border },
            ]}
          >
            <View
              style={[
                styles.rosterAvatarBox,
                { backgroundColor: theme.cyanGlow },
              ]}
            >
              <MaterialCommunityIcons
                name="account"
                size={20}
                color={theme.cyan}
              />
            </View>
            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Text style={[styles.rosterItemName, { color: theme.text }]}>
                {log.name || log.student_id || "Student Attendance"}
              </Text>
              <Text style={[styles.rosterItemId, { color: theme.cyan }]}>
                Session #{log.session_id}
              </Text>
            </View>
            <HoloStatusPill
              label={log.status || "Present"}
              tone={
                String(log.status).toUpperCase() === "PRESENT"
                  ? "success"
                  : "danger"
              }
            />
          </View>
        ))
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// STUDENT: PERSONAL ATTENDANCE LOGS
// ---------------------------------------------------------------------------
function StudentAttendanceView() {
  const { theme } = useAppTheme();
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PRESENT" | "ABSENT">("ALL");
  const [pagination, setPagination] = useState({
    page: 1,
    page_size: 20,
    total_items: 0,
    total_pages: 1,
    has_next: false,
    has_previous: false,
  });

  const loadData = useCallback(async (targetPage = page, targetFilter = statusFilter) => {
    try {
      const params: Record<string, any> = {
        page: targetPage,
        page_size: pageSize,
      };
      if (targetFilter !== "ALL") params.status = targetFilter;

      const res = await http.get("/student/attendance", { params });
      const data = res.data || {};
      const logs = data.items || [];
      setItems(logs);
      if (data.pagination) {
        setPagination(data.pagination);
      } else {
        setPagination({
          page: targetPage,
          page_size: pageSize,
          total_items: logs.length,
          total_pages: 1,
          has_next: false,
          has_previous: false,
        });
      }
    } catch {
      // Fallback to legacy endpoint if /student/attendance fails
      try {
        const r = await http.get("/student/attendance-sessions");
        const list = r.data?.sessions || [];
        setItems(list);
        setPagination({
          page: 1,
          page_size: list.length,
          total_items: list.length,
          total_pages: 1,
          has_next: false,
          has_previous: false,
        });
      } catch {
        setItems([]);
      }
    } finally {
      setBusy(false);
      setRefreshing(false);
    }
  }, [page, pageSize, statusFilter]);

  useEffect(() => {
    loadData(page, statusFilter);
  }, [loadData, page, statusFilter]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData(page, statusFilter);
  };

  if (busy && !refreshing && items.length === 0) {
    return (
      <View style={styles.screenCenterLoader}>
        <ActivityIndicator size="large" color={theme.cyan} />
        <Text style={[styles.loaderSubText, { color: theme.muted }]}>
          Loading Attendance Records...
        </Text>
      </View>
    );
  }

  return (
    <View style={[styles.screenLayout, { flex: 1 }]}>
      <FlatList
        data={items}
        keyExtractor={(item, index) => item.session_id ? `${item.session_id}-${index}` : String(index)}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.cyan}
          />
        }
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={
          <View>
            <View style={styles.screenTopHeader}>
              <View>
                <Text style={[styles.screenMainTitle, { color: theme.text }]}>
                  My Attendance
                </Text>
                <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
                  Verified personal attendance records ({pagination.total_items} total)
                </Text>
              </View>
            </View>

            {/* Quick Filter Segment Pills */}
            <View
              style={[
                styles.filterSegmentPillWrap,
                { backgroundColor: theme.bgElevated, marginVertical: 12 },
              ]}
            >
              {(["ALL", "PRESENT", "ABSENT"] as const).map((f) => {
                const active = statusFilter === f;
                return (
                  <Pressable
                    key={f}
                    style={[
                      styles.filterSegmentBtn,
                      active && [
                        styles.filterSegmentBtnActive,
                        {
                          backgroundColor: theme.card,
                          borderColor: theme.borderAccent,
                        },
                      ],
                    ]}
                    onPress={() => {
                      setStatusFilter(f);
                      setPage(1);
                    }}
                  >
                    <Text
                      style={[
                        styles.filterSegmentBtnText,
                        { color: active ? theme.cyan : theme.muted },
                        active && { fontWeight: "600" },
                      ]}
                    >
                      {f === "ALL" ? "All Sessions" : f === "PRESENT" ? "Present" : "Absent"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        }
        renderItem={({ item: sess }) => {
          const isPresent = String(sess.status).toUpperCase() === "PRESENT";
          return (
            <View
              style={[
                styles.studentSessionCard,
                { backgroundColor: theme.cardGlass, borderColor: theme.border },
              ]}
            >
              <View
                style={[
                  styles.studentSessionIconBadge,
                  {
                    backgroundColor: isPresent
                      ? theme.emeraldGlow
                      : theme.roseGlow,
                  },
                ]}
              >
                <MaterialCommunityIcons
                  name={isPresent ? "check-bold" : "close-thick"}
                  size={16}
                  color={isPresent ? theme.emerald : theme.rose}
                />
              </View>
              <View style={{ flex: 1, paddingLeft: 12 }}>
                <Text
                  style={[styles.studentSessionTitle, { color: theme.text }]}
                >
                  {sess.title || sess.course}
                </Text>
                <Text
                  style={[
                    styles.studentSessionMeta,
                    { color: theme.textSecondary },
                  ]}
                >
                  {sess.course} • {sess.department || "Academic Dept"}
                </Text>
                <Text
                  style={[styles.studentSessionDate, { color: theme.muted }]}
                >
                  {sess.event_date} • {String(sess.starts_at || "").slice(0, 5)} -{" "}
                  {String(sess.ends_at || "").slice(0, 5)}
                  {sess.room ? ` • ${sess.room}` : ""}
                </Text>
              </View>
              <HoloStatusPill
                label={isPresent ? "Present" : "Absent"}
                tone={isPresent ? "success" : "danger"}
              />
            </View>
          );
        }}
        ListEmptyComponent={
          <HoloEmptyState
            icon="calendar-check-outline"
            title="No sessions found"
            desc="No attendance records match the selected criteria."
          />
        }
        ListFooterComponent={
          pagination.total_pages > 1 ? (
            <View
              style={[
                styles.paginationRow,
                {
                  backgroundColor: theme.cardGlass,
                  borderColor: theme.border,
                },
              ]}
            >
              <Pressable
                style={[
                  styles.paginationBtn,
                  {
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.border,
                    opacity: pagination.has_previous ? 1 : 0.4,
                  },
                ]}
                disabled={!pagination.has_previous || busy}
                onPress={() => setPage((p) => Math.max(1, p - 1))}
              >
                <MaterialCommunityIcons
                  name="chevron-left"
                  size={16}
                  color={theme.cyan}
                />
                <Text
                  style={[styles.paginationBtnText, { color: theme.cyan }]}
                >
                  Previous
                </Text>
              </Pressable>

              <Text
                style={[styles.paginationInfoText, { color: theme.muted }]}
              >
                Page {pagination.page} of {pagination.total_pages} (
                {pagination.total_items} records)
              </Text>

              <Pressable
                style={[
                  styles.paginationBtn,
                  {
                    backgroundColor: theme.bgElevated,
                    borderColor: theme.border,
                    opacity: pagination.has_next ? 1 : 0.4,
                  },
                ]}
                disabled={!pagination.has_next || busy}
                onPress={() => setPage((p) => p + 1)}
              >
                <Text
                  style={[styles.paginationBtnText, { color: theme.cyan }]}
                >
                  Next
                </Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={16}
                  color={theme.cyan}
                />
              </Pressable>
            </View>
          ) : null
        }
      />
    </View>
  );
}

// ---------------------------------------------------------------------------
// STUDENT: CLASSES & TIMETABLE
// ---------------------------------------------------------------------------
function StudentClassesView() {
  const { theme } = useAppTheme();
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
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Class Schedule
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Course lectures & room assignments
          </Text>
        </View>
      </View>

      {busy ? (
        <ActivityIndicator
          size="large"
          color={theme.cyan}
          style={{ margin: 30 }}
        />
      ) : items.length === 0 ? (
        <HoloEmptyState
          icon="book-open-outline"
          title="No scheduled lectures"
          desc="Your curriculum currently has no active classes registered."
        />
      ) : (
        items.map((cls, i) => (
          <View
            key={cls.session_id || i}
            style={[
              styles.scheduleRowCard,
              { backgroundColor: theme.cardGlass, borderColor: theme.border },
            ]}
          >
            <View
              style={[
                styles.scheduleTimeBadge,
                {
                  backgroundColor: theme.bgElevated,
                  borderColor: theme.border,
                },
              ]}
            >
              <Text style={[styles.scheduleTimeStart, { color: theme.cyan }]}>
                {String(cls.starts_at || "09:00").slice(0, 5)}
              </Text>
              <Text style={[styles.scheduleTimeFinish, { color: theme.muted }]}>
                {String(cls.ends_at || "10:00").slice(0, 5)}
              </Text>
            </View>
            <View style={{ flex: 1, paddingLeft: 12 }}>
              <Text
                style={[styles.scheduleLectureTitle, { color: theme.text }]}
              >
                {cls.title || cls.course}
              </Text>
              <Text
                style={[styles.scheduleLectureMeta, { color: theme.muted }]}
              >
                {cls.room || "Room 101"}
              </Text>
            </View>
            <View
              style={[
                styles.roomTagHolo,
                {
                  backgroundColor: theme.cyanGlow,
                  borderColor: theme.borderAccent,
                },
              ]}
            >
              <Text style={[styles.roomTagHoloText, { color: theme.cyan }]}>
                {cls.room || "Lab"}
              </Text>
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
function StudentAvatar({
  uri,
  authHeader,
  theme,
}: {
  uri?: string | null;
  authHeader?: any;
  theme: any;
}) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [uri]);

  if (!uri || hasError) {
    return (
      <View
        style={{
          width: 42,
          height: 42,
          borderRadius: 21,
          marginRight: 10,
          backgroundColor: theme.card,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MaterialCommunityIcons name="account" size={20} color={theme.muted} />
      </View>
    );
  }

  const token =
    typeof authHeader === "string"
      ? authHeader.replace(/^Bearer\s+/i, "").trim()
      : "";
  const fullUri =
    uri.includes("?") || !token ? uri : `${uri}?token=${encodeURIComponent(token)}`;

  return (
    <Image
      source={{
        uri: fullUri,
        headers: typeof authHeader === "string" ? { Authorization: authHeader } : undefined,
      }}
      onError={() => setHasError(true)}
      style={{
        width: 42,
        height: 42,
        borderRadius: 21,
        marginRight: 10,
        backgroundColor: theme.card,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
function AttendanceHistoryView({ role }: { role: Role }) {
  const { theme } = useAppTheme();
  const [records, setRecords] = useState<any[]>([]);
  const [month, setMonth] = useState(new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [busy, setBusy] = useState(true);
  const [selectedSession, setSelectedSession] = useState<any>(null);
  const [sessionStudents, setSessionStudents] = useState<any[]>([]);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [editingStudent, setEditingStudent] = useState<any>(null);
  const [editingSession, setEditingSession] = useState<any>(null);
  const [exportingSession, setExportingSession] = useState<any>(null);
  const [sessionActionBusy, setSessionActionBusy] = useState(false);

  // Pagination and caching state
  const [sessionPage, setSessionPage] = useState(1);
  const [sessionTotalPages, setSessionTotalPages] = useState(1);
  const [sessionTotalRecords, setSessionTotalRecords] = useState(0);
  const [sessionHasNext, setSessionHasNext] = useState(false);
  const [sessionHasPrev, setSessionHasPrev] = useState(false);
  const [sessionPageBusy, setSessionPageBusy] = useState(false);
  const [sessionPageError, setSessionPageError] = useState<string | null>(null);

  const sessionCacheRef = useRef<Record<string, any>>({});
  const sessionInFlightRef = useRef<Record<string, Promise<any>>>({});
  const activeSessionIdRef = useRef<string | null>(null);
  const PAGE_SIZE = 10;

  const fetchSessionPageData = useCallback(async (sessionId: string, pageNum: number) => {
    const cacheKey = `session:${sessionId}:page:${pageNum}`;
    if (sessionCacheRef.current[cacheKey]) {
      return sessionCacheRef.current[cacheKey];
    }
    if (sessionInFlightRef.current[cacheKey]) {
      return sessionInFlightRef.current[cacheKey];
    }

    const promise = (async () => {
      const res = await http.get(`/api/sessions/${sessionId}/attendance`, {
        params: { page: pageNum, limit: PAGE_SIZE },
      });
      const data = res.data || {};
      sessionCacheRef.current[cacheKey] = data;
      delete sessionInFlightRef.current[cacheKey];
      return data;
    })().catch((err) => {
      delete sessionInFlightRef.current[cacheKey];
      throw err;
    });

    sessionInFlightRef.current[cacheKey] = promise;
    return promise;
  }, []);

  const prefetchSessionPage = useCallback((sessionId: string, pageNum: number) => {
    const cacheKey = `session:${sessionId}:page:${pageNum}`;
    if (sessionCacheRef.current[cacheKey] || sessionInFlightRef.current[cacheKey]) {
      return;
    }
    fetchSessionPageData(sessionId, pageNum).catch(() => {
      // Ignore background prefetch errors
    });
  }, [fetchSessionPageData]);

  const loadSessionPage = useCallback(async (sessionId: string, pageNum: number) => {
    activeSessionIdRef.current = sessionId;
    setSessionPageError(null);

    const cacheKey = `session:${sessionId}:page:${pageNum}`;
    const cached = sessionCacheRef.current[cacheKey];

    if (cached) {
      if (activeSessionIdRef.current === sessionId) {
        setSessionStudents(cached.records || cached.items || []);
        setSessionPage(cached.page || pageNum);
        setSessionTotalPages(cached.total_pages || 1);
        setSessionTotalRecords(cached.total_records ?? cached.total_items ?? 0);
        setSessionHasNext(!!cached.has_next);
        setSessionHasPrev(!!cached.has_previous);
        setSessionPageBusy(false);

        if (cached.has_next) {
          prefetchSessionPage(sessionId, pageNum + 1);
        }
      }
      return;
    }

    setSessionPageBusy(true);
    try {
      const data = await fetchSessionPageData(sessionId, pageNum);
      if (activeSessionIdRef.current === sessionId) {
        setSessionStudents(data.records || data.items || []);
        setSessionPage(data.page || pageNum);
        setSessionTotalPages(data.total_pages || 1);
        setSessionTotalRecords(data.total_records ?? data.total_items ?? 0);
        setSessionHasNext(!!data.has_next);
        setSessionHasPrev(!!data.has_previous);

        if (data.has_next) {
          prefetchSessionPage(sessionId, pageNum + 1);
        }
      }
    } catch (err: any) {
      if (activeSessionIdRef.current === sessionId) {
        setSessionPageError("Failed to load records. Tap to retry.");
      }
    } finally {
      if (activeSessionIdRef.current === sessionId) {
        setSessionPageBusy(false);
      }
    }
  }, [fetchSessionPageData, prefetchSessionPage]);

  const openSession = async (session: any) => {
    setSelectedSession(session);
    activeSessionIdRef.current = session.session_id;
    setSessionStudents([]);
    setSessionPage(1);
    setSessionTotalPages(1);
    setSessionTotalRecords(0);
    setSessionHasNext(false);
    setSessionHasPrev(false);
    setSessionBusy(true);
    try {
      await loadSessionPage(session.session_id, 1);
    } catch {
      Alert.alert("Unable to load session", "Please try again.");
    } finally {
      setSessionBusy(false);
    }
  };

  const updateAttendance = async (student: any, status: string) => {
    if (!selectedSession) return;
    try {
      await http.patch(`/attendance/${selectedSession.session_id}/${student.student_id}`, { status });
      const prefix = `session:${selectedSession.session_id}:`;
      Object.keys(sessionCacheRef.current).forEach((k) => {
        if (k.startsWith(prefix)) {
          delete sessionCacheRef.current[k];
        }
      });
      setSessionStudents((items) =>
        items.map((item) =>
          item.student_id === student.student_id
            ? { ...item, status, attendance_status: status, is_manual_override: true }
            : item
        )
      );
      if (sessionHasNext) {
        prefetchSessionPage(selectedSession.session_id, sessionPage + 1);
      }
    } catch (e: any) {
      Alert.alert("Update failed", apiErrorMessage(e, "Could not update attendance."));
    }
  };

  const refreshSessions = async () => {
    const monthStr = month.toISOString().slice(0, 7);
    const response = await http.get("/teacher/attendance-sessions");
    setRecords((response.data?.sessions || []).filter((session: any) =>
      String(session.event_date || "").startsWith(monthStr),
    ));
  };

  const setSessionStatus = async (status: "ACTIVE" | "COMPLETED") => {
    if (!selectedSession) return;
    setSessionActionBusy(true);
    try {
      const response = await http.patch(`/teacher/attendance-sessions/${selectedSession.session_id}/status`, { status });
      setSelectedSession((current: any) => ({ ...current, ...response.data }));
      await refreshSessions();
    } catch (e: any) {
      Alert.alert("Session update failed", apiErrorMessage(e, "Could not update the session."));
    } finally {
      setSessionActionBusy(false);
    }
  };

  const deleteSelectedSession = () => {
    if (!selectedSession) return;
    Alert.alert("Delete session?", "This permanently removes the session, its uploaded batches, and its attendance records.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          setSessionActionBusy(true);
          try {
            await http.delete(`/teacher/attendance-sessions/${selectedSession.session_id}`);
            setSelectedSession(null);
            setSessionStudents([]);
            await refreshSessions();
          } catch (e: any) {
            Alert.alert("Delete failed", apiErrorMessage(e, "Could not delete the session."));
          } finally {
            setSessionActionBusy(false);
          }
        },
      },
    ]);
  };

  const exportSessionPdf = async () => {
    if (!selectedSession?.session_id) return;
    setSessionActionBusy(true);
    try {
      const endpoint = `/attendance/${selectedSession.session_id}/pdf`;
      if (Platform.OS === "web") {
        const response = await http.get(endpoint, { responseType: "blob" });
        const url = URL.createObjectURL(response.data);
        const link = document.createElement("a");
        link.href = url;
        link.download = `attendance-${selectedSession.session_id}.pdf`;
        link.click();
        URL.revokeObjectURL(url);
        return;
      }

      const outputDirectory = FileSystem.documentDirectory || FileSystem.cacheDirectory;
      if (!outputDirectory) throw new Error("Device storage is unavailable.");
      const path = `${outputDirectory}attendance-${selectedSession.session_id}.pdf`;
      const authorization = http.defaults.headers.common.Authorization;
      const download = await FileSystem.downloadAsync(`${API}${endpoint}`, path, {
        headers: typeof authorization === "string" ? { Authorization: authorization } : {},
      });
      const contentType = String(download.headers?.["Content-Type"] || download.headers?.["content-type"] || "").toLowerCase();
      if (download.status >= 400 || !contentType.includes("application/pdf")) {
        throw new Error("The server did not return a valid PDF. Restart the backend after rebuilding its dependencies.");
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: "application/pdf", dialogTitle: "Attendance PDF" });
      } else {
        Alert.alert("PDF saved", `Saved attendance PDF to ${path}`);
      }
    } catch (e: any) {
      Alert.alert("PDF export failed", apiErrorMessage(e, "Could not generate the attendance PDF."));
    } finally {
      setSessionActionBusy(false);
    }
  };

  useEffect(() => {
    setBusy(true);
    refreshSessions()
      .catch(() => setRecords([]))
      .finally(() => setBusy(false));
  }, [month]);

  // Sessions, rather than attendance-log rows, are the source of truth here.
  // This includes lectures with no face matches yet and keeps repeated uploads
  // from producing duplicate lecture cards.
  const sessions = records;

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Session History
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            {sessions.length} session{sessions.length === 1 ? "" : "s"} in the selected month
          </Text>
        </View>
      </View>

      <Pressable
        style={[
          styles.datePickerCardHolo,
          { backgroundColor: theme.cardGlass, borderColor: theme.border },
        ]}
        onPress={() => setShowPicker(true)}
      >
        <MaterialCommunityIcons
          name="calendar-month"
          size={20}
          color={theme.cyan}
        />
        <Text style={[styles.datePickerCardText, { color: theme.text }]}>
          {month.toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          })}
        </Text>
        <MaterialCommunityIcons
          name="chevron-down"
          size={19}
          color={theme.muted}
        />
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
        <ActivityIndicator
          size="large"
          color={theme.cyan}
          style={{ margin: 30 }}
        />
      ) : sessions.length === 0 ? (
        <HoloEmptyState
          icon="history"
          title="No records in this month"
          desc="Pick a different month or capture class attendance."
        />
      ) : (
        sessions.map((sess: any, i) => {
          const count = Number(sess.present_count || 0);
          const rosterCount = Number(sess.roster_count || 0);
          return (
            <Pressable
              key={sess.session_id || i}
              style={[
                styles.rosterItemCard,
                { backgroundColor: theme.cardGlass, borderColor: theme.border },
              ]}
              onPress={() => openSession(sess)}
            >
              <View
                style={[
                  styles.rosterAvatarBox,
                  { backgroundColor: theme.cyanGlow },
                ]}
              >
                <MaterialCommunityIcons
                  name="calendar-check"
                  size={20}
                  color={theme.cyan}
                />
              </View>
              <View style={{ flex: 1, paddingHorizontal: 12 }}>
                <Text style={[styles.rosterItemName, { color: theme.text }]}> 
                  {sess.title || sess.course || "Attendance Session"}
                </Text>
                <Text style={[styles.rosterItemId, { color: theme.cyan }]}> 
                  {sess.event_date ? new Date(`${sess.event_date}T00:00:00`).toLocaleDateString() : "Open session details"}
                </Text>
                <Text style={[styles.rosterItemMeta, { color: theme.muted }]}>
                  {count} present of {rosterCount} students
                </Text>
              </View>
              <HoloStatusPill label={`${count}/${rosterCount}`} tone="info" />
            </Pressable>
          );
        })
      )}

      <Modal visible={!!selectedSession} animationType="slide" onRequestClose={() => { activeSessionIdRef.current = null; setSelectedSession(null); }}>
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.bg }]}>
          <View style={[styles.modalSheetCard, { flex: 1, backgroundColor: theme.cardGlass, borderColor: theme.borderBright }]}> 
            <View style={styles.modalSheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalSheetTitle, { color: theme.text }]}>{selectedSession?.title || selectedSession?.course}</Text>
                <Text style={{ color: theme.muted }}>{selectedSession?.course} • {selectedSession?.event_date} • {selectedSession?.room || "Room not set"}</Text>
              </View>
              <Pressable onPress={() => { activeSessionIdRef.current = null; setSelectedSession(null); }}><MaterialCommunityIcons name="close" size={22} color={theme.text} /></Pressable>
            </View>
            {sessionBusy ? <ActivityIndicator color={theme.cyan} style={{ margin: 24 }} /> : (
              <ScrollView>
                {(role === "teacher" || role === "admin") && (
                  <>
                    <Pressable
                      disabled={sessionActionBusy}
                      onPress={() => setExportingSession(selectedSession)}
                      style={[styles.modalDismissBtn, { backgroundColor: theme.emerald, marginBottom: 8 }]}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 }}>
                        <MaterialCommunityIcons name="file-export-outline" size={18} color="#FFFFFF" />
                        <Text style={[styles.modalDismissBtnText, { color: "#FFFFFF" }]}>Export Session</Text>
                      </View>
                    </Pressable>
                  </>
                )}
                {role === "teacher" && (
                  <>
                    <Pressable onPress={() => setEditingSession(selectedSession)} style={[styles.modalDismissBtn, { backgroundColor: theme.purple, marginBottom: 8 }]}>
                      <Text style={[styles.modalDismissBtnText, { color: "#FFFFFF" }]}>Edit Session Details</Text>
                    </Pressable>
                    <View style={{ flexDirection: "row", gap: 8, marginBottom: 14 }}>
                      <Pressable disabled={sessionActionBusy} onPress={() => setSessionStatus(selectedSession?.status === "COMPLETED" ? "ACTIVE" : "COMPLETED")} style={[styles.modalDismissBtn, { flex: 1, backgroundColor: theme.cyan, opacity: sessionActionBusy ? 0.6 : 1 }]}>
                        <Text style={[styles.modalDismissBtnText, { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" }]}>{selectedSession?.status === "COMPLETED" ? "Reopen Session" : "Complete Session"}</Text>
                      </Pressable>
                      <Pressable disabled={sessionActionBusy} onPress={deleteSelectedSession} style={[styles.modalDismissBtn, { flex: 1, backgroundColor: theme.rose, opacity: sessionActionBusy ? 0.6 : 1 }]}>
                        <Text style={[styles.modalDismissBtnText, { color: "#FFFFFF" }]}>Delete Session</Text>
                      </Pressable>
                    </View>
                  </>
                )}
                {sessionPageBusy ? (
                  <ActivityIndicator color={theme.cyan} style={{ margin: 24 }} />
                ) : sessionPageError ? (
                  <View style={{ padding: 24, alignItems: "center" }}>
                    <MaterialCommunityIcons name="alert-circle-outline" size={36} color={theme.rose} />
                    <Text style={{ color: theme.rose, marginTop: 8, marginBottom: 12, textAlign: "center" }}>{sessionPageError}</Text>
                    <Pressable
                      onPress={() => selectedSession && loadSessionPage(selectedSession.session_id, sessionPage)}
                      style={[styles.modalDismissBtn, { backgroundColor: theme.cyan, paddingHorizontal: 24 }]}
                    >
                      <Text style={[styles.modalDismissBtnText, { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" }]}>Retry</Text>
                    </Pressable>
                  </View>
                ) : sessionStudents.length === 0 ? (
                  <View style={{ padding: 28, alignItems: "center", justifyContent: "center" }}>
                    <MaterialCommunityIcons name="account-group-outline" size={44} color={theme.muted} />
                    <Text style={{ color: theme.text, fontSize: 16, fontWeight: "600", marginTop: 10 }}>No attendance records</Text>
                    <Text style={{ color: theme.muted, fontSize: 13, textAlign: "center", marginTop: 4 }}>This session does not contain any student attendance records.</Text>
                  </View>
                ) : (
                  <>
                    {sessionStudents.map((student) => {
                      const photoUri = student.profile_picture
                        ? (student.profile_picture.startsWith("http") ? student.profile_picture : `${API}${student.profile_picture}`)
                        : student.profile_photo_base64;
                      const authHeader = http.defaults.headers.common.Authorization;

                      return (
                        <View key={student.student_id} style={[styles.rosterItemCard, { backgroundColor: theme.bgElevated, borderColor: theme.border, marginBottom: 8 }]}>
                          <StudentAvatar uri={photoUri} authHeader={authHeader} theme={theme} />
                          <Pressable style={{ flex: 1 }} onPress={() => setSelectedStudent(student)}>
                            <Text style={[styles.rosterItemName, { color: theme.text }]}>{student.student_name || student.name}</Text>
                            <Text style={[styles.rosterItemId, { color: theme.muted }]}>{student.student_id}</Text>
                          </Pressable>
                          <Pressable onPress={() => updateAttendance(student, "PRESENT")} style={{ padding: 8 }}>
                            <HoloStatusPill label="Present" tone={(student.attendance_status || student.status) === "PRESENT" ? "success" : "neutral"} />
                          </Pressable>
                          <Pressable onPress={() => updateAttendance(student, "ABSENT")} style={{ padding: 8 }}>
                            <HoloStatusPill label="Absent" tone={(student.attendance_status || student.status) === "ABSENT" ? "danger" : "neutral"} />
                          </Pressable>
                        </View>
                      );
                    })}

                    {sessionTotalPages > 1 && (
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          justifyContent: "space-between",
                          paddingVertical: 14,
                          paddingHorizontal: 4,
                          marginTop: 8,
                          borderTopWidth: 1,
                          borderTopColor: theme.border,
                        }}
                      >
                        <Pressable
                          disabled={!sessionHasPrev || sessionPageBusy}
                          onPress={() => selectedSession && loadSessionPage(selectedSession.session_id, sessionPage - 1)}
                          style={[
                            styles.modalDismissBtn,
                            {
                              flex: 1,
                              marginRight: 8,
                              backgroundColor: sessionHasPrev ? theme.cyan : theme.card,
                              opacity: sessionHasPrev && !sessionPageBusy ? 1 : 0.4,
                            },
                          ]}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 }}>
                            <MaterialCommunityIcons
                              name="chevron-left"
                              size={18}
                              color={sessionHasPrev ? (theme.mode === "dark" ? "#080C14" : "#FFFFFF") : theme.muted}
                            />
                            <Text
                              style={[
                                styles.modalDismissBtnText,
                                { color: sessionHasPrev ? (theme.mode === "dark" ? "#080C14" : "#FFFFFF") : theme.muted },
                              ]}
                            >
                              Previous
                            </Text>
                          </View>
                        </Pressable>

                        <View style={{ paddingHorizontal: 12, alignItems: "center" }}>
                          <Text style={{ color: theme.text, fontWeight: "600", fontSize: 13 }}>
                            Page {sessionPage} of {sessionTotalPages}
                          </Text>
                          <Text style={{ color: theme.muted, fontSize: 11 }}>
                            {sessionTotalRecords} total records
                          </Text>
                        </View>

                        <Pressable
                          disabled={!sessionHasNext || sessionPageBusy}
                          onPress={() => selectedSession && loadSessionPage(selectedSession.session_id, sessionPage + 1)}
                          style={[
                            styles.modalDismissBtn,
                            {
                              flex: 1,
                              marginLeft: 8,
                              backgroundColor: sessionHasNext ? theme.cyan : theme.card,
                              opacity: sessionHasNext && !sessionPageBusy ? 1 : 0.4,
                            },
                          ]}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4 }}>
                            <Text
                              style={[
                                styles.modalDismissBtnText,
                                { color: sessionHasNext ? (theme.mode === "dark" ? "#080C14" : "#FFFFFF") : theme.muted },
                              ]}
                            >
                              Next
                            </Text>
                            <MaterialCommunityIcons
                              name="chevron-right"
                              size={18}
                              color={sessionHasNext ? (theme.mode === "dark" ? "#080C14" : "#FFFFFF") : theme.muted}
                            />
                          </View>
                        </Pressable>
                      </View>
                    )}
                  </>
                )}
              </ScrollView>
            )}
          </View>
        </SafeAreaView>
      </Modal>
      <Modal visible={!!selectedStudent} animationType="slide" onRequestClose={() => setSelectedStudent(null)}>
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.bg }]}>
          <ScrollView contentContainerStyle={{ padding: 20 }}>
            <Pressable onPress={() => setSelectedStudent(null)}><MaterialCommunityIcons name="arrow-left" size={26} color={theme.cyan} /></Pressable>
            <Text style={[styles.screenMainTitle, { color: theme.text, marginTop: 20 }]}>{selectedStudent?.name}</Text>
            <Text style={[styles.screenSubTitle, { color: theme.muted }]}>{selectedStudent?.student_id}</Text>
            {[["Email", selectedStudent?.email], ["Phone", selectedStudent?.phone], ["Date of Birth", selectedStudent?.date_of_birth], ["Program", selectedStudent?.program], ["Department", selectedStudent?.department], ["Semester", selectedStudent?.semester], ["Roll Number", selectedStudent?.roll_number], ["Attendance", selectedStudent?.status]].map(([label, value]) => <HoloDetailRow key={label} label={label} value={String(value || "Not provided")} />)}
            {role === "admin" && <Pressable style={[styles.primaryNeonButton, { backgroundColor: theme.cyan, marginTop: 20 }]} onPress={() => setEditingStudent(selectedStudent)}><Text style={[styles.primaryNeonButtonText, { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" }]}>Edit Student Details</Text></Pressable>}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      {role === "admin" && editingStudent && <StudentEditModal visible student={editingStudent} endpoint={`/admin/students/${editingStudent.student_id}`} onClose={() => setEditingStudent(null)} onSaved={(updated) => { setSelectedStudent(updated); setEditingStudent(null); }} />}
      <SessionEditModal visible={!!editingSession} session={editingSession} onClose={() => setEditingSession(null)} onSaved={async (updated) => { setSelectedSession((current: any) => ({ ...current, ...updated })); setEditingSession(null); await refreshSessions(); }} />
      <ExportSessionModal visible={!!exportingSession} session={exportingSession} onClose={() => setExportingSession(null)} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// ANALYTICS & REPORTS
// ---------------------------------------------------------------------------
function ReportsView() {
  const { theme } = useAppTheme();
  const [period, setPeriod] = useState("This Month");
  const [records, setRecords] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    setBusy(true);
    http
      .get("/teacher/attendance/report")
      .then((r) =>
        setRecords(Array.isArray(r.data?.records) ? r.data.records : []),
      )
      .catch(() => setRecords([]))
      .finally(() => setBusy(false));
  }, [period]);

  const filteredRecords = useMemo(() => {
    if (period === "All Time") return records;
    const now = new Date();
    if (period === "This Month") {
      return records.filter((record) => {
        const value = new Date(record.event_date || record.timestamp);
        return value.getFullYear() === now.getFullYear() && value.getMonth() === now.getMonth();
      });
    }
    const weekStart = new Date(now);
    const daysSinceMonday = (now.getDay() + 6) % 7;
    weekStart.setDate(now.getDate() - daysSinceMonday);
    weekStart.setHours(0, 0, 0, 0);
    return records.filter((record) => new Date(record.event_date || record.timestamp) >= weekStart);
  }, [period, records]);
  const sessions = Array.from(
    new Map(filteredRecords.map((x) => [x.session_id, x])).values(),
  );
  const uniqueStudents = new Set(filteredRecords.map((x) => x.student_id)).size;

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Attendance Reports
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            {filteredRecords.length} attendance record{filteredRecords.length === 1 ? "" : "s"} in {period.toLowerCase()}
          </Text>
        </View>
      </View>

      {/* Segment Switcher */}
      <View
        style={[styles.segmentWrapHolo, { backgroundColor: theme.bgElevated }]}
      >
        {["This Month", "This Week", "All Time"].map((tab) => (
          <Pressable
            key={tab}
            style={[
              styles.segmentBtnHolo,
              period === tab && [
                styles.segmentBtnHoloActive,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.borderAccent,
                },
              ],
            ]}
            onPress={() => setPeriod(tab)}
          >
            <Text
              style={[
                styles.segmentBtnHoloText,
                { color: theme.muted },
                period === tab && { color: theme.cyan, fontWeight: "600" },
              ]}
            >
              {tab}
            </Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.kpiGridMatrix}>
        <HoloMetricCard
          label="Total Records"
          value={String(filteredRecords.length)}
          delta="Verified attendances"
          icon="clipboard-text-outline"
          color={theme.cyan}
          bgColor={theme.cyanGlow}
        />
        <HoloMetricCard
          label="Sessions"
          value={String(sessions.length)}
          delta="Conducted classes"
          icon="calendar-check"
          color={theme.amber}
          bgColor={theme.amberGlow}
        />
        <HoloMetricCard
          label="Attendees"
          value={String(uniqueStudents)}
          delta="Unique scholars"
          icon="account-group"
          color={theme.emerald}
          bgColor={theme.emeraldGlow}
        />
        <HoloMetricCard
          label="Engine Status"
          value="Online"
          delta="High Accuracy AI"
          icon="check-circle"
          color={theme.purple}
          bgColor={theme.purpleGlow}
        />
      </View>

      {busy ? (
        <ActivityIndicator
          size="large"
          color={theme.cyan}
          style={{ margin: 30 }}
        />
      ) : sessions.length === 0 ? (
        <HoloEmptyState
          icon="chart-bar"
          title="No analytics recorded"
          desc="Analytics populate as faculty execute class attendance sessions."
        />
      ) : (
        <View
          style={[
            styles.glassFormCard,
            {
              backgroundColor: theme.cardGlass,
              borderColor: theme.borderBright,
            },
          ]}
        >
          <Text style={[styles.formGroupHeading, { color: theme.muted }]}>
            SESSIONS IN PERIOD
          </Text>
          {sessions.map((sess: any, i) => (
            <View
              key={sess.session_id || i}
              style={[
                styles.reportSessionItemRow,
                { borderBottomColor: theme.border },
              ]}
            >
              <View
                style={[
                  styles.reportSessionIconCircle,
                  { backgroundColor: theme.cyanGlow },
                ]}
              >
                <MaterialCommunityIcons
                  name="calendar-check"
                  size={18}
                  color={theme.cyan}
                />
              </View>
              <View style={{ flex: 1, paddingLeft: 10 }}>
                <Text
                  style={[styles.reportSessionItemTitle, { color: theme.text }]}
                >
                  {sess.timestamp
                    ? new Date(sess.timestamp).toLocaleDateString()
                    : "Session"}
                </Text>
                <Text
                  style={[styles.reportSessionItemSub, { color: theme.muted }]}
                >
                  Session #{sess.session_id}
                </Text>
              </View>
              <HoloStatusPill
                label={`${filteredRecords.filter((r) => r.session_id === sess.session_id).length} logs`}
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
// NOTIFICATIONS VIEW
// ---------------------------------------------------------------------------
function NotificationsView() {
  const { theme } = useAppTheme();
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState(true);

  const fetchNotifs = () => {
    setBusy(true);
    http
      .get("/notifications")
      .then((r) =>
        setItems(
          Array.isArray(r.data?.notifications) ? r.data.notifications : [],
        ),
      )
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
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
    } catch {}
  };

  const visible = items.filter((n) => filter === "all" || !n.is_read);

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Notifications
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Academic alerts & updates
          </Text>
        </View>
        <Pressable
          style={[
            styles.markAllBtnHolo,
            { backgroundColor: theme.bgElevated, borderColor: theme.border },
          ]}
          onPress={markAllRead}
        >
          <Text style={[styles.markAllBtnHoloText, { color: theme.cyan }]}>
            Mark all read
          </Text>
        </Pressable>
      </View>

      <View
        style={[styles.segmentWrapHolo, { backgroundColor: theme.bgElevated }]}
      >
        <Pressable
          style={[
            styles.segmentBtnHolo,
            filter === "all" && [
              styles.segmentBtnHoloActive,
              { backgroundColor: theme.card, borderColor: theme.borderAccent },
            ],
          ]}
          onPress={() => setFilter("all")}
        >
          <Text
            style={[
              styles.segmentBtnHoloText,
              { color: theme.muted },
              filter === "all" && { color: theme.cyan, fontWeight: "600" },
            ]}
          >
            All ({items.length})
          </Text>
        </Pressable>
        <Pressable
          style={[
            styles.segmentBtnHolo,
            filter === "unread" && [
              styles.segmentBtnHoloActive,
              { backgroundColor: theme.card, borderColor: theme.borderAccent },
            ],
          ]}
          onPress={() => setFilter("unread")}
        >
          <Text
            style={[
              styles.segmentBtnHoloText,
              { color: theme.muted },
              filter === "unread" && { color: theme.cyan, fontWeight: "600" },
            ]}
          >
            Unread ({items.filter((x) => !x.is_read).length})
          </Text>
        </Pressable>
      </View>

      {busy ? (
        <ActivityIndicator
          size="large"
          color={theme.cyan}
          style={{ margin: 30 }}
        />
      ) : visible.length === 0 ? (
        <HoloEmptyState
          icon="bell-check-outline"
          title="All caught up!"
          desc="You have no unread notifications."
        />
      ) : (
        visible.map((notif) => (
          <Pressable
            key={notif.id}
            style={[
              styles.notifCardHolo,
              { backgroundColor: theme.cardGlass, borderColor: theme.border },
              !notif.is_read && {
                borderColor: theme.borderAccent,
                backgroundColor: theme.cyanGlow,
              },
            ]}
            onPress={() => !notif.is_read && markOne(notif.id)}
          >
            <View
              style={[
                styles.notifIconCircleHolo,
                {
                  backgroundColor:
                    notif.category === "alert"
                      ? theme.roseGlow
                      : theme.cyanGlow,
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
                size={18}
                color={notif.category === "alert" ? theme.rose : theme.cyan}
              />
            </View>
            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Text style={[styles.notifTitleHolo, { color: theme.text }]}>
                {notif.title}
              </Text>
              <Text
                style={[styles.notifBodyHolo, { color: theme.textSecondary }]}
              >
                {notif.body}
              </Text>
              <Text style={[styles.notifTimeHolo, { color: theme.muted }]}>
                {notif.created_at
                  ? new Date(notif.created_at).toLocaleString()
                  : ""}
              </Text>
            </View>
            {!notif.is_read && (
              <View
                style={[styles.unreadDotHolo, { backgroundColor: theme.cyan }]}
              />
            )}
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
  const { theme } = useAppTheme();
  const [sections, setSections] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [expandedSchool, setExpandedSchool] = useState<string | null>(null);
  const [expandedFaculty, setExpandedFaculty] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    loadAcademicSections()
      .then(setSections)
      .catch(() => setSections([]))
      .finally(() => setBusy(false));
  }, []);

  const visible = sections.filter((s) =>
    JSON.stringify(s).toLowerCase().includes(search.toLowerCase()),
  );
  const schools = Array.from(new Set(visible.map((s) => s.school)));

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Academic Structure
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            {search.trim()
              ? `${visible.length} matching academic section${visible.length === 1 ? "" : "s"}`
              : `${visible.length} academic section${visible.length === 1 ? "" : "s"}`}
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.searchBarGlass,
          { backgroundColor: theme.cardGlass, borderColor: theme.border },
        ]}
      >
        <MaterialCommunityIcons name="magnify" size={20} color={theme.cyan} />
        <TextInput
          style={[styles.searchInputHolo, { color: theme.text }]}
          value={search}
          onChangeText={setSearch}
          placeholder="Search academic departments..."
          placeholderTextColor={theme.muted}
        />
      </View>

      {busy ? (
        <ActivityIndicator
          size="large"
          color={theme.cyan}
          style={{ margin: 30 }}
        />
      ) : schools.length === 0 ? (
        <HoloEmptyState
          icon="layers-outline"
          title="No academic sections found"
          desc="Academic sections are managed by university administrators."
        />
      ) : (
        schools.map((school) => {
          const isSchoolOpen =
            expandedSchool === school || (!!search && schools.length === 1);
          const faculties = Array.from(
            new Set(
              visible.filter((x) => x.school === school).map((x) => x.faculty),
            ),
          );
          return (
            <View
              key={school}
              style={[
                styles.hierarchyBranchCard,
                { backgroundColor: theme.cardGlass, borderColor: theme.border },
              ]}
            >
              <Pressable
                style={styles.hierarchyBranchHeader}
                onPress={() => setExpandedSchool(isSchoolOpen ? null : school)}
              >
                <MaterialCommunityIcons
                  name="school"
                  size={20}
                  color={theme.cyan}
                />
                <Text
                  style={[styles.hierarchySchoolTitle, { color: theme.text }]}
                >
                  {school}
                </Text>
                <View
                  style={[
                    styles.hierarchyCountPill,
                    { backgroundColor: theme.bgElevated },
                  ]}
                >
                  <Text
                    style={[
                      styles.hierarchyCountPillText,
                      { color: theme.muted },
                    ]}
                  >
                    {faculties.length} Depts
                  </Text>
                </View>
                <MaterialCommunityIcons
                  name={isSchoolOpen ? "chevron-up" : "chevron-down"}
                  size={19}
                  color={theme.muted}
                />
              </Pressable>

              {isSchoolOpen &&
                faculties.map((fac) => {
                  const key = `${school}:${fac}`;
                  const isFacOpen =
                    expandedFaculty === key ||
                    (!!search && faculties.length === 1);
                  const programs = visible.filter(
                    (x) => x.school === school && x.faculty === fac,
                  );
                  return (
                    <View
                      key={fac}
                      style={[
                        styles.hierarchyFacultySection,
                        { borderTopColor: theme.border },
                      ]}
                    >
                      <Pressable
                        style={styles.hierarchyFacultyBar}
                        onPress={() =>
                          setExpandedFaculty(isFacOpen ? null : key)
                        }
                      >
                        <MaterialCommunityIcons
                          name="folder-outline"
                          size={17}
                          color={theme.text}
                        />
                        <Text
                          style={[
                            styles.hierarchyFacultyTitle,
                            { color: theme.text },
                          ]}
                        >
                          {fac}
                        </Text>
                        <MaterialCommunityIcons
                          name={isFacOpen ? "chevron-up" : "chevron-down"}
                          size={17}
                          color={theme.muted}
                        />
                      </Pressable>

                      {isFacOpen && (
                        <View style={styles.hierarchyProgramsStack}>
                          {programs.map((prog, pIdx) => (
                            <View
                              key={pIdx}
                              style={styles.hierarchyProgramLine}
                            >
                              <Text
                                style={[
                                  styles.hierarchyBulletDot,
                                  { color: theme.muted },
                                ]}
                              >
                                •
                              </Text>
                              <View style={{ flex: 1 }}>
                                <Text
                                  style={[
                                    styles.hierarchyDeptName,
                                    { color: theme.text },
                                  ]}
                                >
                                  {prog.department}
                                </Text>
                                <Text
                                  style={[
                                    styles.hierarchyProgName,
                                    { color: theme.muted },
                                  ]}
                                >
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
  const { theme } = useAppTheme();
  const [profile, setProfile] = useState<any>(user);

  useEffect(() => {
    http
      .get("/auth/profile")
      .then((r) => setProfile(r.data?.profile || user))
      .catch(() => {});
  }, []);

  return (
    <View style={styles.screenLayout}>
      <ProfileHeroCard
        profile={profile}
        role="ADMINISTRATOR"
        setProfile={setProfile}
      />

      <View
        style={[
          styles.glassFormCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
        ]}
      >
        <Text style={[styles.formGroupHeading, { color: theme.muted }]}>
          ACCOUNT PRIVILEGES
        </Text>
        <HoloDetailRow label="Role Access" value="University Superuser" />
        <HoloDetailRow label="Username" value={profile.username || "admin"} />
        <HoloDetailRow
          label="Email"
          value={profile.email || "admin@pratyaksh.edu"}
        />
        <HoloDetailRow label="Security" value="Encrypted Profile" />
      </View>

      <Pressable
        style={[
          styles.signOutBtnHolo,
          { backgroundColor: theme.roseGlow, borderColor: theme.rose },
        ]}
        onPress={onLogout}
      >
        <MaterialCommunityIcons name="logout" size={19} color={theme.rose} />
        <Text style={[styles.signOutBtnHoloText, { color: theme.rose }]}>
          Sign Out Administrator
        </Text>
      </Pressable>
    </View>
  );
}

function TeacherProfile({
  user,
  onLogout,
}: {
  user: any;
  onLogout: () => void;
}) {
  const { theme } = useAppTheme();
  const [profile, setProfile] = useState<any>(user);

  useEffect(() => {
    http
      .get("/teacher/profile")
      .then((r) => {
        setProfile(r.data?.profile || user);
      })
      .catch(() => {});
  }, []);

  return (
    <View style={styles.screenLayout}>
      <ProfileHeroCard
        profile={profile}
        role="FACULTY INSTRUCTOR"
        setProfile={setProfile}
      />

      <Pressable
        style={[
          styles.signOutBtnHolo,
          { backgroundColor: theme.roseGlow, borderColor: theme.rose },
        ]}
        onPress={onLogout}
      >
        <MaterialCommunityIcons name="logout" size={19} color={theme.rose} />
        <Text style={[styles.signOutBtnHoloText, { color: theme.rose }]}>
          Sign Out Account
        </Text>
      </Pressable>
    </View>
  );
}

function StudentProfile({
  user,
  onLogout,
}: {
  user: any;
  onLogout: () => void;
}) {
  const { theme } = useAppTheme();
  const [profile, setProfile] = useState<any>(user);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    http
      .get("/auth/profile")
      .then((r) => setProfile(r.data?.profile || user))
      .catch(() => {});
  }, []);

  const handleFaceCaptured = async (uri: string) => {
    setCameraOpen(false);
    setRegistering(true);
    try {
      const data = new FormData();
      data.append("files", {
        uri,
        name: "student-face.jpg",
        type: "image/jpeg",
      } as any);

      const res = await http.post("/student/register-face", data, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      Alert.alert(
        "Biometrics Registered",
        res.data?.message ||
          "Your biometric face profile was successfully registered and activated.",
      );
      setProfile((p: any) => ({ ...p, face_registered: true }));
    } catch (e: any) {
      Alert.alert(
        "Registration Failed",
        e?.response?.data?.detail ||
          "Could not register face biometrics. Please ensure proper lighting and retry.",
      );
    } finally {
      setRegistering(false);
    }
  };

  return (
    <View style={styles.screenLayout}>
      <ProfileHeroCard
        profile={profile}
        role="STUDENT SCHOLAR"
        setProfile={setProfile}
      />

      <View
        style={[
          styles.glassFormCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
        ]}
      >
        <Text style={[styles.formGroupHeading, { color: theme.muted }]}>
          ACADEMIC ENROLLMENT
        </Text>
        <HoloDetailRow
          label="Student ID"
          value={profile.student_id || "STU-2026"}
        />
        <HoloDetailRow label="Full Name" value={profile.name || profile.display_name || "Not specified"} />
        <HoloDetailRow label="Email" value={profile.email || "Not registered"} />
        <HoloDetailRow label="Phone" value={profile.phone || "Not registered"} />
        <HoloDetailRow label="Date of Birth" value={profile.date_of_birth || "Not specified"} />
        <HoloDetailRow label="Roll Number" value={profile.roll_number || "Not assigned"} />
        <HoloDetailRow
          label="Department"
          value={profile.department || profile.academic_department || "Not specified"}
        />
        <HoloDetailRow
          label="Program"
          value={profile.program || "Computer Science"}
        />
        <HoloDetailRow
          label="Semester"
          value={profile.semester || profile.academic_semester || "Not specified"}
        />
        <HoloDetailRow
          label="Current GPA"
          value={String(profile.gpa || "Not specified")}
        />
        <HoloDetailRow
          label="Enrollment Year"
          value={profile.enrollment_year || "Not specified"}
        />
        <HoloDetailRow
          label="Face Biometrics"
          value={
            profile.face_registered ? "Active & Verified" : "Not Registered"
          }
        />
      </View>

      <Pressable
        style={[styles.modalDismissBtn, { backgroundColor: theme.cyan, marginBottom: 12 }]}
        onPress={() => setEditing(true)}
      >
        <Text style={[styles.modalDismissBtnText, { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" }]}>Edit Details</Text>
      </Pressable>

      {/* Face Biometrics Registration / Update Button */}
      <Pressable
        style={[
          styles.primaryNeonButton,
          {
            backgroundColor: profile.face_registered
              ? theme.emerald
              : theme.cyan,
            marginBottom: 16,
          },
          registering && { opacity: 0.7 },
        ]}
        onPress={() => setCameraOpen(true)}
        disabled={registering}
      >
        {registering ? (
          <ActivityIndicator
            color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
          />
        ) : (
          <View style={styles.submitRow}>
            <MaterialCommunityIcons
              name="face-recognition"
              size={20}
              color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
            />
            <Text
              style={[
                styles.primaryNeonButtonText,
                { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
              ]}
            >
              {profile.face_registered
                ? "UPDATE FACE BIOMETRICS"
                : "REGISTER FACE BIOMETRICS"}
            </Text>
          </View>
        )}
      </Pressable>

      <BiometricCameraModal
        visible={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={handleFaceCaptured}
      />

      <StudentEditModal
        visible={editing}
        student={profile}
        endpoint="/student/profile"
        onClose={() => setEditing(false)}
        onSaved={(updated) => {
          setProfile((current: any) => ({ ...current, ...updated }));
          setEditing(false);
        }}
      />

      <Pressable
        style={[
          styles.signOutBtnHolo,
          { backgroundColor: theme.roseGlow, borderColor: theme.rose },
        ]}
        onPress={onLogout}
      >
        <MaterialCommunityIcons name="logout" size={19} color={theme.rose} />
        <Text style={[styles.signOutBtnHoloText, { color: theme.rose }]}>
          Sign Out Account
        </Text>
      </Pressable>
    </View>
  );
}

function ExportSessionModal({
  visible,
  session,
  onClose,
}: {
  visible: boolean;
  session: any;
  onClose: () => void;
}) {
  const { theme } = useAppTheme();
  const [activeTab, setActiveTab] = useState<"face_pdf" | "detailed_pdf" | "text_pdf">("face_pdf");
  const [optionsBusy, setOptionsBusy] = useState(true);
  const [sessionDetails, setSessionDetails] = useState<any>(null);
  const [courses, setCourses] = useState<{ id: string; label: string }[]>([]);
  const [overallSummary, setOverallSummary] = useState({ total_students: 0, present_students: 0, absent_students: 0 });

  // Option A state
  const [optACourse, setOptACourse] = useState("all");
  const [optAStatus, setOptAStatus] = useState<"present" | "absent" | "both">("both");

  // Option B state
  const [optBCourse, setOptBCourse] = useState("all");
  const [optBStatus, setOptBStatus] = useState<"present" | "absent" | "both">("both");

  // Option C state
  const [optCCourse, setOptCCourse] = useState("all");
  const [optCStatus, setOptCStatus] = useState<"present" | "absent" | "both">("both");

  // Live preview counts
  const [includedCount, setIncludedCount] = useState<number | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [loadError, setLoadError] = useState("");

  const loadOptions = useCallback(async () => {
    if (!session?.session_id) return;
    setOptionsBusy(true);
    setLoadError("");
    try {
      const res = await http.get(`/attendance/sessions/${session.session_id}/export-options`);
      const data = res.data || {};
      setSessionDetails(data.session || session);
      const cList = data.courses || [{ id: "all", label: "All Courses / Groups" }];
      setCourses(cList);
      if (data.summary) setOverallSummary(data.summary);
    } catch (e: any) {
      setLoadError(apiErrorMessage(e, "Could not load session export configuration."));
    } finally {
      setOptionsBusy(false);
    }
  }, [session?.session_id, session]);

  useEffect(() => {
    if (visible && session?.session_id) {
      loadOptions();
    }
  }, [visible, session?.session_id, loadOptions]);

  // Active filters based on activeTab
  const currentCourse = activeTab === "face_pdf" ? optACourse : activeTab === "detailed_pdf" ? optBCourse : optCCourse;
  const currentStatus = activeTab === "face_pdf" ? optAStatus : activeTab === "detailed_pdf" ? optBStatus : optCStatus;

  // Live included record count calculation
  useEffect(() => {
    if (!visible || !session?.session_id) return;
    let isMounted = true;
    setSummaryBusy(true);
    http.get(`/attendance/sessions/${session.session_id}/export-summary`, {
      params: {
        course_id: currentCourse === "all" ? undefined : currentCourse,
        attendance_status: currentStatus,
      },
    }).then(res => {
      if (isMounted) {
        setIncludedCount(res.data?.records_included ?? null);
      }
    }).catch(() => {
      if (isMounted) setIncludedCount(null);
    }).finally(() => {
      if (isMounted) setSummaryBusy(false);
    });
    return () => { isMounted = false; };
  }, [visible, session?.session_id, activeTab, currentCourse, currentStatus]);

  const generateReport = async () => {
    if (!session?.session_id || generating) return;
    setGenerating(true);
    try {
      const reportType = activeTab;
      const courseId = currentCourse === "all" ? null : currentCourse;
      const attendanceStatus = currentStatus;

      if (Platform.OS === "web") {
        const res = await http.post(
          `/attendance/sessions/${session.session_id}/export`,
          { report_type: reportType, attendance_status: attendanceStatus, course_id: courseId },
          { responseType: "blob" }
        );
        const url = URL.createObjectURL(res.data);
        const link = document.createElement("a");
        link.href = url;
        const filename = `attendance_${session.session_id}_${reportType}_${attendanceStatus}.pdf`;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
        Alert.alert("Report Generated", `Attendance report (${filename}) has been downloaded.`);
        return;
      }

      // React Native Mobile
      const outputDirectory = FileSystem.documentDirectory || FileSystem.cacheDirectory;
      if (!outputDirectory) throw new Error("Device storage is unavailable.");

      const filename = `attendance_${session.session_id}_${reportType}_${attendanceStatus}.pdf`;
      const path = `${outputDirectory}${filename}`;
      const authorization = http.defaults.headers.common.Authorization;

      const queryParams = new URLSearchParams({
        report_type: reportType,
        attendance_status: attendanceStatus,
      });
      if (courseId) queryParams.append("course_id", courseId);

      const downloadEndpoint = `${API}/attendance/sessions/${session.session_id}/export?${queryParams.toString()}`;
      const download = await FileSystem.downloadAsync(downloadEndpoint, path, {
        headers: typeof authorization === "string" ? { Authorization: authorization } : {},
      });

      const contentType = String(download.headers?.["Content-Type"] || download.headers?.["content-type"] || "").toLowerCase();
      if (download.status >= 400 || !contentType.includes("application/pdf")) {
        throw new Error("Server returned an error generating the PDF. Please check your filter criteria.");
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(path, { mimeType: "application/pdf", dialogTitle: "Attendance PDF Report" });
      } else {
        Alert.alert("PDF Saved", `Report saved successfully to ${path}`);
      }
    } catch (err: any) {
      Alert.alert("Export Failed", apiErrorMessage(err, "Could not generate attendance report."));
    } finally {
      setGenerating(false);
    }
  };

  const currentButtonLabel =
    activeTab === "face_pdf"
      ? "Generate Face PDF"
      : activeTab === "detailed_pdf"
        ? "Generate Detailed PDF"
        : "Generate Text Report";

  const currentTabTitle =
    activeTab === "face_pdf"
      ? "OPTION A: Course-Wise Student Face PDF"
      : activeTab === "detailed_pdf"
        ? "OPTION B: Complete Student Details PDF"
        : "OPTION C: Student Text-Only Report";

  const currentTabDesc =
    activeTab === "face_pdf"
      ? "Generates a printable visual PDF containing student facial photographs arranged in a grid, with name and scholar number beneath each photograph."
      : activeTab === "detailed_pdf"
        ? "Generates a comprehensive tabular attendance report with student photo, scholar number, name, mobile number, and attendance status."
        : "Generates a lightweight, clean tabular report containing scholar numbers, names, mobile numbers, and attendance status without biometric photos.";

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.bg }]}>
        <View style={[styles.modalSheetCard, { flex: 1, backgroundColor: theme.bg, borderColor: theme.border }]}>
          {/* Header */}
          <View style={styles.modalSheetHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.modalSheetTitle, { color: theme.text }]}>
                Export Attendance Session
              </Text>
              <Text style={{ color: theme.muted, fontSize: 12 }}>
                {session?.title || session?.course} • ID: {session?.session_id}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <MaterialCommunityIcons name="close" size={24} color={theme.text} />
            </Pressable>
          </View>

          {optionsBusy ? (
            <View style={styles.screenCenterLoader}>
              <ActivityIndicator size="large" color={theme.cyan} />
              <Text style={[styles.loaderSubText, { color: theme.muted }]}>
                Loading Export Configuration...
              </Text>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
              {/* Session Details HUD */}
              <View
                style={[
                  styles.tallyHUDCard,
                  { backgroundColor: theme.cardGlass, borderColor: theme.border, marginBottom: 14 },
                ]}
              >
                <Text style={{ fontSize: 14, fontWeight: "700", color: theme.text, marginBottom: 4 }}>
                  {sessionDetails?.title || session?.title}
                </Text>
                <Text style={{ fontSize: 12, color: theme.muted, marginBottom: 10 }}>
                  Date: {sessionDetails?.event_date || session?.event_date} • Time: {sessionDetails?.starts_at || session?.starts_at} - {sessionDetails?.ends_at || session?.ends_at} • Room: {sessionDetails?.room || session?.room || "—"}
                </Text>

                <View style={styles.tallyStatsRow}>
                  <View style={styles.tallyStatCol}>
                    <Text style={[styles.tallyDigit, { color: theme.emerald }]}>
                      {overallSummary.present_students}
                    </Text>
                    <Text style={[styles.tallyMeta, { color: theme.muted }]}>Present</Text>
                  </View>
                  <View style={[styles.tallyDividerLine, { backgroundColor: theme.border }]} />
                  <View style={styles.tallyStatCol}>
                    <Text style={[styles.tallyDigit, { color: theme.rose }]}>
                      {overallSummary.absent_students}
                    </Text>
                    <Text style={[styles.tallyMeta, { color: theme.muted }]}>Absent</Text>
                  </View>
                  <View style={[styles.tallyDividerLine, { backgroundColor: theme.border }]} />
                  <View style={styles.tallyStatCol}>
                    <Text style={[styles.tallyDigit, { color: theme.text }]}>
                      {overallSummary.total_students}
                    </Text>
                    <Text style={[styles.tallyMeta, { color: theme.muted }]}>Total Enrolled</Text>
                  </View>
                </View>
              </View>

              {/* Three Distinguishable Report Types (Segment Selector) */}
              <View
                style={[
                  styles.exportTabSegmentWrap,
                  { backgroundColor: theme.bgElevated, borderColor: theme.border },
                ]}
              >
                {(
                  [
                    { id: "face_pdf", label: "Face PDF", icon: "face-recognition" },
                    { id: "detailed_pdf", label: "Detailed PDF", icon: "table-large" },
                    { id: "text_pdf", label: "Text-Only", icon: "format-list-text" },
                  ] as const
                ).map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <Pressable
                      key={tab.id}
                      style={[
                        styles.exportTabBtn,
                        isActive && [
                          styles.exportTabBtnActive,
                          {
                            backgroundColor: theme.card,
                            borderColor: theme.borderAccent,
                          },
                        ],
                      ]}
                      onPress={() => setActiveTab(tab.id)}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <MaterialCommunityIcons
                          name={tab.icon as any}
                          size={15}
                          color={isActive ? theme.cyan : theme.muted}
                        />
                        <Text
                          style={[
                            styles.exportTabBtnText,
                            { color: isActive ? theme.cyan : theme.muted },
                            isActive && { fontWeight: "700" },
                          ]}
                        >
                          {tab.label}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              {/* Active Option Configuration Box */}
              <View
                style={[
                  styles.exportCardBox,
                  { backgroundColor: theme.cardGlass, borderColor: theme.border },
                ]}
              >
                <Text style={{ fontSize: 14, fontWeight: "700", color: theme.cyan, marginBottom: 4 }}>
                  {currentTabTitle}
                </Text>
                <Text style={{ fontSize: 12, color: theme.muted, marginBottom: 16, lineHeight: 17 }}>
                  {currentTabDesc}
                </Text>

                {/* OPTION A FILTERS */}
                {activeTab === "face_pdf" && (
                  <View>
                    {/* Course Selection */}
                    <Text style={[styles.exportSectionLabel, { color: theme.textSecondary }]}>
                      1. Course Selection:
                    </Text>
                    <View style={styles.exportPillGroup}>
                      {courses.map((c) => {
                        const isSel = optACourse === c.id;
                        return (
                          <Pressable
                            key={c.id}
                            style={[
                              styles.exportChoicePill,
                              {
                                backgroundColor: isSel ? theme.cyanGlow : theme.bgElevated,
                                borderColor: isSel ? theme.cyan : theme.border,
                              },
                            ]}
                            onPress={() => setOptACourse(c.id)}
                          >
                            <Text
                              style={[
                                styles.exportChoicePillText,
                                { color: isSel ? theme.cyan : theme.muted },
                              ]}
                            >
                              {c.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {/* Attendance Status Selection */}
                    <Text style={[styles.exportSectionLabel, { color: theme.textSecondary }]}>
                      2. Attendance Status:
                    </Text>
                    <View style={styles.exportPillGroup}>
                      {(["both", "present", "absent"] as const).map((st) => {
                        const isSel = optAStatus === st;
                        const label = st === "both" ? "Both (All)" : st === "present" ? "Present Only" : "Absent Only";
                        return (
                          <Pressable
                            key={st}
                            style={[
                              styles.exportChoicePill,
                              {
                                backgroundColor: isSel
                                  ? st === "present"
                                    ? theme.emeraldGlow
                                    : st === "absent"
                                      ? theme.roseGlow
                                      : theme.cyanGlow
                                  : theme.bgElevated,
                                borderColor: isSel
                                  ? st === "present"
                                    ? theme.emerald
                                    : st === "absent"
                                      ? theme.rose
                                      : theme.cyan
                                  : theme.border,
                              },
                            ]}
                            onPress={() => setOptAStatus(st)}
                          >
                            <Text
                              style={[
                                styles.exportChoicePillText,
                                {
                                  color: isSel
                                    ? st === "present"
                                      ? theme.emerald
                                      : st === "absent"
                                        ? theme.rose
                                        : theme.cyan
                                    : theme.muted,
                                },
                              ]}
                            >
                              {label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* OPTION B FILTERS */}
                {activeTab === "detailed_pdf" && (
                  <View>
                    {/* Attendance Status Selection (Default: Both) */}
                    <Text style={[styles.exportSectionLabel, { color: theme.textSecondary }]}>
                      1. Attendance Status:
                    </Text>
                    <View style={styles.exportPillGroup}>
                      {(["both", "present", "absent"] as const).map((st) => {
                        const isSel = optBStatus === st;
                        const label = st === "both" ? "Both (Default)" : st === "present" ? "Present Only" : "Absent Only";
                        return (
                          <Pressable
                            key={st}
                            style={[
                              styles.exportChoicePill,
                              {
                                backgroundColor: isSel
                                  ? st === "present"
                                    ? theme.emeraldGlow
                                    : st === "absent"
                                      ? theme.roseGlow
                                      : theme.cyanGlow
                                  : theme.bgElevated,
                                borderColor: isSel
                                  ? st === "present"
                                    ? theme.emerald
                                    : st === "absent"
                                      ? theme.rose
                                      : theme.cyan
                                  : theme.border,
                              },
                            ]}
                            onPress={() => setOptBStatus(st)}
                          >
                            <Text
                              style={[
                                styles.exportChoicePillText,
                                {
                                  color: isSel
                                    ? st === "present"
                                      ? theme.emerald
                                      : st === "absent"
                                        ? theme.rose
                                        : theme.cyan
                                    : theme.muted,
                                },
                              ]}
                            >
                              {label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {/* Course Selection (Optional) */}
                    <Text style={[styles.exportSectionLabel, { color: theme.textSecondary }]}>
                      2. Course / Academic Group (Optional):
                    </Text>
                    <View style={styles.exportPillGroup}>
                      {courses.map((c) => {
                        const isSel = optBCourse === c.id;
                        return (
                          <Pressable
                            key={c.id}
                            style={[
                              styles.exportChoicePill,
                              {
                                backgroundColor: isSel ? theme.cyanGlow : theme.bgElevated,
                                borderColor: isSel ? theme.cyan : theme.border,
                              },
                            ]}
                            onPress={() => setOptBCourse(c.id)}
                          >
                            <Text
                              style={[
                                styles.exportChoicePillText,
                                { color: isSel ? theme.cyan : theme.muted },
                              ]}
                            >
                              {c.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* OPTION C FILTERS */}
                {activeTab === "text_pdf" && (
                  <View>
                    {/* Attendance Status Selection */}
                    <Text style={[styles.exportSectionLabel, { color: theme.textSecondary }]}>
                      1. Attendance Status:
                    </Text>
                    <View style={styles.exportPillGroup}>
                      {(["both", "present", "absent"] as const).map((st) => {
                        const isSel = optCStatus === st;
                        const label = st === "both" ? "Both (All)" : st === "present" ? "Present Only" : "Absent Only";
                        return (
                          <Pressable
                            key={st}
                            style={[
                              styles.exportChoicePill,
                              {
                                backgroundColor: isSel
                                  ? st === "present"
                                    ? theme.emeraldGlow
                                    : st === "absent"
                                      ? theme.roseGlow
                                      : theme.cyanGlow
                                  : theme.bgElevated,
                                borderColor: isSel
                                  ? st === "present"
                                    ? theme.emerald
                                    : st === "absent"
                                      ? theme.rose
                                      : theme.cyan
                                  : theme.border,
                              },
                            ]}
                            onPress={() => setOptCStatus(st)}
                          >
                            <Text
                              style={[
                                styles.exportChoicePillText,
                                {
                                  color: isSel
                                    ? st === "present"
                                      ? theme.emerald
                                      : st === "absent"
                                        ? theme.rose
                                        : theme.cyan
                                    : theme.muted,
                                },
                              ]}
                            >
                              {label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {/* Course Selection (Optional) */}
                    <Text style={[styles.exportSectionLabel, { color: theme.textSecondary }]}>
                      2. Course / Academic Group (Optional):
                    </Text>
                    <View style={styles.exportPillGroup}>
                      {courses.map((c) => {
                        const isSel = optCCourse === c.id;
                        return (
                          <Pressable
                            key={c.id}
                            style={[
                              styles.exportChoicePill,
                              {
                                backgroundColor: isSel ? theme.cyanGlow : theme.bgElevated,
                                borderColor: isSel ? theme.cyan : theme.border,
                              },
                            ]}
                            onPress={() => setOptCCourse(c.id)}
                          >
                            <Text
                              style={[
                                styles.exportChoicePillText,
                                { color: isSel ? theme.cyan : theme.muted },
                              ]}
                            >
                              {c.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* Pre-Export Record Count Indicator */}
                <View
                  style={[
                    styles.exportSummaryBanner,
                    { backgroundColor: theme.bgElevated, borderColor: theme.border },
                  ]}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <MaterialCommunityIcons name="file-document-outline" size={16} color={theme.cyan} />
                    <Text style={{ fontSize: 12, color: theme.textSecondary }}>
                      Records included in this report:
                    </Text>
                  </View>
                  {summaryBusy ? (
                    <ActivityIndicator size="small" color={theme.cyan} />
                  ) : (
                    <Text style={{ fontSize: 13, fontWeight: "700", color: theme.cyan }}>
                      {includedCount !== null ? `${includedCount} student(s)` : "Calculating..."}
                    </Text>
                  )}
                </View>

                {/* Action Export Button */}
                <Pressable
                  disabled={generating || includedCount === 0}
                  onPress={generateReport}
                  style={[
                    styles.primaryNeonButton,
                    {
                      backgroundColor:
                        activeTab === "face_pdf"
                          ? theme.cyan
                          : activeTab === "detailed_pdf"
                            ? theme.emerald
                            : theme.purple,
                      opacity: generating || includedCount === 0 ? 0.6 : 1,
                    },
                  ]}
                >
                  {generating ? (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <ActivityIndicator color="#FFFFFF" />
                      <Text style={[styles.primaryNeonButtonText, { color: "#FFFFFF" }]}>
                        Generating PDF...
                      </Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <MaterialCommunityIcons name="file-pdf-box" size={19} color="#FFFFFF" />
                      <Text style={[styles.primaryNeonButtonText, { color: "#FFFFFF" }]}>
                        {currentButtonLabel}
                      </Text>
                    </View>
                  )}
                </Pressable>

                {includedCount === 0 && (
                  <Text style={{ fontSize: 11, color: theme.rose, textAlign: "center", marginTop: 8 }}>
                    No students match the current filter criteria.
                  </Text>
                )}
              </View>
            </ScrollView>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function SessionEditModal({
  visible,
  session,
  onClose,
  onSaved,
}: {
  visible: boolean;
  session: any;
  onClose: () => void;
  onSaved: (session: any) => void;
}) {
  const { theme } = useAppTheme();
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setForm({
        title: session?.title || "", course: session?.course || "", room: session?.room || "",
        event_date: String(session?.event_date || "").slice(0, 10),
        starts_at: String(session?.starts_at || "").slice(0, 5),
        ends_at: String(session?.ends_at || "").slice(0, 5), notes: session?.notes || "",
      });
    }
  }, [visible, session]);

  const save = async () => {
    if (!form.title.trim() || !form.course.trim()) {
      Alert.alert("Details required", "Lecture title and course are required.");
      return;
    }
    setBusy(true);
    try {
      const response = await http.patch(`/teacher/attendance-sessions/${session.session_id}`, form);
      onSaved(response.data);
      Alert.alert("Session updated", "Lecture details were saved.");
    } catch (e: any) {
      Alert.alert("Update failed", e?.response?.data?.detail || "Could not update the session.");
    } finally {
      setBusy(false);
    }
  };

  const fields = [
    ["title", "Lecture Title"], ["course", "Course"], ["room", "Room"],
    ["event_date", "Date (YYYY-MM-DD)"], ["starts_at", "Starts (HH:MM)"],
    ["ends_at", "Ends (HH:MM)"], ["notes", "Notes"],
  ];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdropOverlay}>
        <View style={[styles.modalSheetCard, { backgroundColor: theme.cardGlass, borderColor: theme.borderBright, maxHeight: "90%" }]}>
          <View style={styles.modalSheetHeader}>
            <Text style={[styles.modalSheetTitle, { color: theme.text }]}>Edit Session Details</Text>
            <Pressable onPress={onClose} disabled={busy}><MaterialCommunityIcons name="close" size={22} color={theme.text} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {fields.map(([key, label]) => (
              <View key={key} style={{ marginBottom: 10 }}>
                <Text style={[styles.fieldLabelText, { color: theme.muted }]}>{label}</Text>
                <TextInput value={form[key] || ""} onChangeText={(value) => setForm((current: any) => ({ ...current, [key]: value }))} placeholder={label} placeholderTextColor={theme.muted} multiline={key === "notes"} style={[styles.textInputBox, { color: theme.text, backgroundColor: theme.bgElevated, borderColor: theme.border }]} />
              </View>
            ))}
            <Pressable style={[styles.modalDismissBtn, { backgroundColor: theme.cyan, marginTop: 8, opacity: busy ? 0.6 : 1 }]} onPress={save} disabled={busy}>
              {busy ? <ActivityIndicator color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"} /> : <Text style={[styles.modalDismissBtnText, { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" }]}>Save Session</Text>}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function StudentEditModal({
  visible,
  student,
  endpoint,
  onClose,
  onSaved,
}: {
  visible: boolean;
  student: any;
  endpoint: string;
  onClose: () => void;
  onSaved: (student: any) => void;
}) {
  const { theme } = useAppTheme();
  const [form, setForm] = useState<any>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) {
      setForm({
        name: student?.name || student?.display_name || "",
        email: student?.email || "",
        phone: student?.phone || "",
        date_of_birth: fromApiDate(student?.date_of_birth || ""),
        program: student?.program || "",
        department: student?.department || student?.academic_department || "",
        semester: student?.semester || student?.academic_semester || "",
        gpa: student?.gpa || "",
        enrollment_year: student?.enrollment_year || "",
        roll_number: student?.roll_number || "",
      });
    }
  }, [visible, student]);

  const update = (key: string, value: string) =>
    setForm((current: any) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!form.name.trim()) {
      Alert.alert("Name required", "Please enter the student's full name.");
      return;
    }
    setBusy(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(form).map(([key, value]) => [
          key,
          key === "date_of_birth" ? toApiDate(String(value ?? "")) : String(value ?? ""),
        ]),
      );
      // Administrator updates use JSON so every replacement field reaches the
      // API consistently. The student's own legacy profile endpoint still
      // accepts multipart form data.
      const response = endpoint.startsWith("/admin/students/")
        ? await http.patch(endpoint, payload)
        : await (() => {
            const body = new FormData();
            Object.entries(payload).forEach(([key, value]) => body.append(key, String(value)));
            return http.patch(endpoint, body, { headers: { "Content-Type": "multipart/form-data" } });
          })();
      onSaved(response.data);
      Alert.alert("Details updated", "The student profile was saved successfully.");
    } catch (e: any) {
      Alert.alert("Update failed", e?.response?.data?.detail || "Could not save student details.");
    } finally {
      setBusy(false);
    }
  };

  const fields = [
    ["name", "Full Name"], ["email", "Email"], ["phone", "Phone"],
    ["date_of_birth", "Date of Birth (DD-MM-YYYY)"], ["program", "Program"],
    ["department", "Department"], ["semester", "Semester"], ["gpa", "GPA"],
    ["enrollment_year", "Enrollment Year"], ["roll_number", "Roll Number"],
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdropOverlay}>
        <View style={[styles.modalSheetCard, { backgroundColor: theme.cardGlass, borderColor: theme.borderBright, maxHeight: "90%" }]}>
          <View style={styles.modalSheetHeader}>
            <Text style={[styles.modalSheetTitle, { color: theme.text }]}>Edit Student Details</Text>
            <Pressable onPress={onClose}><MaterialCommunityIcons name="close" size={22} color={theme.text} /></Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {fields.map(([key, label]) => (
              <View key={key} style={{ marginBottom: 10 }}>
                <Text style={[styles.fieldLabelText, { color: theme.muted }]}>{label}</Text>
                <TextInput
                  value={form[key] || ""}
                  onChangeText={(value) => update(key, value)}
                  placeholder={label}
                  placeholderTextColor={theme.muted}
                  style={[styles.textInputBox, { color: theme.text, backgroundColor: theme.bgElevated, borderColor: theme.border }]}
                />
              </View>
            ))}
            <Pressable style={[styles.modalDismissBtn, { backgroundColor: theme.cyan, marginTop: 8 }]} onPress={save} disabled={busy}>
              {busy ? <ActivityIndicator color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"} /> : <Text style={[styles.modalDismissBtnText, { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" }]}>Save Details</Text>}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
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
  const { theme } = useAppTheme();

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
      await http.post("/auth/profile/photo", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setProfile({ ...profile, profile_photo_base64: asset.uri });
      Alert.alert("Success", "Profile photo updated successfully.");
    } catch {
      Alert.alert("Error", "Could not upload profile photo.");
    }
  };

  const name =
    profile.display_name ||
    profile.name ||
    profile.username ||
    "University Member";

  return (
    <View
      style={[
        styles.profileHeroCardHolo,
        { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
      ]}
    >
      <Pressable onPress={choosePhoto} style={styles.profileAvatarWrapHolo}>
        {profile.profile_photo_base64 ? (
          <Image
            source={{ uri: profile.profile_photo_base64 }}
            style={[styles.profileAvatarImgHolo, { borderColor: theme.cyan }]}
          />
        ) : (
          <View
            style={[
              styles.profileAvatarFallbackHolo,
              { backgroundColor: theme.card, borderColor: theme.cyan },
            ]}
          >
            <Text
              style={[
                styles.profileAvatarFallbackInitial,
                { color: theme.cyan },
              ]}
            >
              {name.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View
          style={[styles.avatarEditPillHolo, { backgroundColor: theme.cyan }]}
        >
          <MaterialCommunityIcons
            name="camera"
            size={12}
            color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
          />
        </View>
      </Pressable>

      <Text style={[styles.profileHeroNameHolo, { color: theme.text }]}>
        {name}
      </Text>
      <View
        style={[
          styles.profileRoleBadgeHolo,
          { backgroundColor: theme.cyanGlow, borderColor: theme.borderAccent },
        ]}
      >
        <Text style={[styles.profileRoleBadgeText, { color: theme.cyan }]}>
          {role}
        </Text>
      </View>
      <Text style={[styles.profileHeroEmailHolo, { color: theme.muted }]}>
        {profile.email || `${profile.username || "user"}@university.edu`}
      </Text>
    </View>
  );
}

function HoloMetricCard({
  label,
  value,
  delta,
  icon,
  color,
  bgColor,
}: {
  label: string;
  value: string;
  delta: string;
  icon: string;
  color: string;
  bgColor: string;
}) {
  const { theme } = useAppTheme();
  return (
    <View
      style={[
        styles.kpiCardHolo,
        { backgroundColor: theme.cardGlass, borderColor: theme.border },
      ]}
    >
      <View style={[styles.kpiIconBadgeHolo, { backgroundColor: bgColor }]}>
        <MaterialCommunityIcons name={icon as any} size={20} color={color} />
      </View>
      <Text style={[styles.kpiValueHolo, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.kpiLabelHolo, { color: theme.textSecondary }]}>
        {label}
      </Text>
      <Text style={[styles.kpiDeltaHolo, { color: theme.muted }]}>{delta}</Text>
    </View>
  );
}

function RapidCommandButton({
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
  const { theme } = useAppTheme();
  return (
    <Pressable
      style={({ pressed }) => [
        styles.rapidCmdCardHolo,
        { backgroundColor: theme.cardGlass, borderColor: theme.border },
        pressed && styles.dashboardCardPressed,
      ]}
      onPress={onPress}
    >
      <View
        style={[styles.rapidCmdIconBadge, { backgroundColor: `${color}18` }]}
      >
        <MaterialCommunityIcons name={icon as any} size={22} color={color} />
      </View>
      <Text style={[styles.rapidCmdTitleHolo, { color: theme.text }]}>
        {title}
      </Text>
      <Text style={[styles.rapidCmdDescHolo, { color: theme.muted }]}>
        {desc}
      </Text>
    </Pressable>
  );
}

function HoloStatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "danger" | "warning" | "info" | "neutral";
}) {
  const { theme } = useAppTheme();
  const bg =
    tone === "success"
      ? theme.emeraldGlow
      : tone === "danger"
        ? theme.roseGlow
        : tone === "warning"
          ? theme.amberGlow
          : tone === "info"
            ? theme.cyanGlow
            : theme.bgElevated;
  const fg =
    tone === "success"
      ? theme.emerald
      : tone === "danger"
        ? theme.rose
        : tone === "warning"
          ? theme.amber
          : tone === "info"
            ? theme.cyan
            : theme.textSecondary;
  return (
    <View style={[styles.statusPillHolo, { backgroundColor: bg }]}>
      <Text style={[styles.statusPillHoloText, { color: fg }]}>{label}</Text>
    </View>
  );
}

function HoloDetailRow({ label, value }: { label: string; value: string }) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.holoDetailRow, { borderBottomColor: theme.border }]}>
      <Text style={[styles.holoDetailLabel, { color: theme.muted }]}>
        {label}
      </Text>
      <Text style={[styles.holoDetailValue, { color: theme.text }]}>
        {value}
      </Text>
    </View>
  );
}

function HoloEmptyState({
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
  const { theme } = useAppTheme();
  return (
    <View
      style={[
        styles.emptyCardHolo,
        { backgroundColor: theme.cardGlass, borderColor: theme.border },
      ]}
    >
      <View
        style={[styles.emptyIconBadgeHolo, { backgroundColor: theme.cyanGlow }]}
      >
        <MaterialCommunityIcons
          name={icon as any}
          size={32}
          color={theme.cyan}
        />
      </View>
      <Text style={[styles.emptyTitleHolo, { color: theme.text }]}>
        {title}
      </Text>
      <Text style={[styles.emptyDescHolo, { color: theme.muted }]}>{desc}</Text>
      {!!actionText && !!onAction && (
        <Pressable
          style={[styles.emptyActionBtnHolo, { backgroundColor: theme.cyan }]}
          onPress={onAction}
        >
          <Text
            style={[
              styles.emptyActionBtnHoloText,
              { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
            ]}
          >
            {actionText}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ACADEMIC CASCADE COMPONENT
// ---------------------------------------------------------------------------
function AcademicCascade({
  onApply,
  onChange,
}: {
  onApply?: (selection: any) => void;
  onChange?: (selection: any, matchedSection?: any) => void;
}) {
  const { theme } = useAppTheme();
  const [sections, setSections] = useState<any[]>([]);
  const [selection, setSelection] = useState<any>({
    ...DEFAULT_ACADEMIC_SCOPE,
  });
  const [modalOpen, setModalOpen] = useState<string | null>(null);

  useEffect(() => {
    loadAcademicSections()
      .then((loaded) => {
        setSections(loaded);
        const matched = loaded.find(
          (s) =>
            s.school === DEFAULT_ACADEMIC_SCOPE.school &&
            s.faculty === DEFAULT_ACADEMIC_SCOPE.faculty &&
            s.department === DEFAULT_ACADEMIC_SCOPE.department,
        );
        if (matched) onChange?.({ ...DEFAULT_ACADEMIC_SCOPE }, matched);
      })
      .catch(() => setSections([]));
  }, []);

  const getOptions = (key: string, filters: any = {}) => {
    return Array.from(
      new Set(
        sections
          .filter((x) =>
            Object.entries(filters).every(
              ([k, v]: any) => !v?.length || v.includes(x[k]),
            ),
          )
          .map((x) => x[key])
          .filter(Boolean),
      ),
    ) as string[];
  };

  const renderSelect = (
    label: string,
    fieldKey: string,
    options: string[],
    disabled = false,
  ) => {
    const selectedValue = selection[fieldKey] || `Select ${label}`;
    return (
      <View key={fieldKey} style={styles.formGroup}>
        <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
          {label}
        </Text>
        <Pressable
          disabled={disabled || !options.length}
          style={[
            styles.selectTriggerHolo,
            { backgroundColor: theme.bgElevated, borderColor: theme.border },
            (disabled || !options.length) && styles.selectTriggerHoloDisabled,
          ]}
          onPress={() => setModalOpen(fieldKey)}
        >
          <Text
            style={[
              styles.selectTriggerHoloText,
              { color: theme.text },
              (disabled || !options.length) && { color: theme.muted },
            ]}
          >
            {selectedValue}
          </Text>
          <MaterialCommunityIcons
            name="chevron-down"
            size={19}
            color={disabled ? theme.border : theme.cyan}
          />
        </Pressable>

        {modalOpen === fieldKey && (
          <Modal
            transparent
            visible
            animationType="fade"
            onRequestClose={() => setModalOpen(null)}
          >
            <Pressable
              style={styles.modalBackdropOverlay}
              onPress={() => setModalOpen(null)}
            >
              <Pressable
                style={[
                  styles.dropdownModalHolo,
                  {
                    backgroundColor: theme.card,
                    borderColor: theme.borderBright,
                  },
                ]}
                onPress={(e) => e.stopPropagation()}
              >
                <Text
                  style={[styles.dropdownModalTitle, { color: theme.text }]}
                >
                  Select {label}
                </Text>
                <ScrollView
                  style={{ maxHeight: 250 }}
                  keyboardShouldPersistTaps="handled"
                >
                  {options.map((opt) => (
                    <Pressable
                      key={opt}
                      style={[
                        styles.dropdownOptionHolo,
                        { borderBottomColor: theme.border },
                      ]}
                      onPress={() => {
                        setSelection((prev: any) => {
                          const next = {
                            ...prev,
                            [fieldKey]: opt,
                            ...(fieldKey === "school"
                              ? {
                                  faculty: "",
                                  department: "",
                                  program: "",
                                  semester: "",
                                }
                              : fieldKey === "faculty"
                                ? { department: "", program: "", semester: "" }
                                : fieldKey === "department"
                                  ? { program: "", semester: "" }
                                  : fieldKey === "program"
                                    ? { semester: "" }
                                    : {}),
                          };
                          const matched = sections.find(
                            (s) =>
                              (!next.school || s.school === next.school) &&
                              (!next.faculty || s.faculty === next.faculty) &&
                              (!next.department ||
                                s.department === next.department) &&
                              (!next.program || s.program === next.program) &&
                              (!next.semester || s.semester === next.semester),
                          );
                          if (onChange) onChange(next, matched);
                          return next;
                        });
                        setModalOpen(null);
                      }}
                    >
                      <Text
                        style={[
                          styles.dropdownOptionTextHolo,
                          { color: theme.text },
                        ]}
                      >
                        {opt}
                      </Text>
                      {selection[fieldKey] === opt && (
                        <MaterialCommunityIcons
                          name="check"
                          size={17}
                          color={theme.cyan}
                        />
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

  const has = !!selection.program;

  return (
    <View style={{ marginTop: 14 }}>
      <Text style={[styles.formGroupHeading, { color: theme.muted }]}>
        ACADEMIC PLACEMENT
      </Text>
      <View style={[styles.lockedScopeNotice, { backgroundColor: theme.cardSubtle, borderColor: theme.border }]}>
        <MaterialCommunityIcons name="lock-outline" size={16} color={theme.cyan} />
        <Text style={[styles.lockedScopeNoticeText, { color: theme.textSecondary }]}>
          {DEFAULT_ACADEMIC_SCOPE.school} • {DEFAULT_ACADEMIC_SCOPE.faculty} • {DEFAULT_ACADEMIC_SCOPE.department}
        </Text>
      </View>
      {renderSelect(
        "Program",
        "program",
        getOptions("program", {
          school: DEFAULT_ACADEMIC_SCOPE.school,
          faculty: DEFAULT_ACADEMIC_SCOPE.faculty,
          department: DEFAULT_ACADEMIC_SCOPE.department,
        }),
      )}
      {renderSelect(
        "Semester",
        "semester",
        getOptions("semester", {
          school: DEFAULT_ACADEMIC_SCOPE.school,
          faculty: DEFAULT_ACADEMIC_SCOPE.faculty,
          department: DEFAULT_ACADEMIC_SCOPE.department,
          program: selection.program,
        }),
        !selection.program,
      )}

      {onApply && (
        <Pressable
          disabled={!has}
          style={[
            styles.applyFilterBtnHolo,
            { backgroundColor: theme.cyan },
            !has && { opacity: 0.5 },
          ]}
          onPress={() => onApply(selection)}
        >
          <MaterialCommunityIcons
            name="filter-check"
            size={17}
            color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
          />
          <Text
            style={[
              styles.applyFilterBtnHoloText,
              { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
            ]}
          >
            APPLY FILTERS
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// MULTI-PROGRAM / MULTI-SEMESTER ATTENDANCE SELECTOR
// Supports selecting sections across schools, faculties, departments,
// programs, and semesters for cross-enrolled / combined photo recognition.
// ---------------------------------------------------------------------------
function MultiProgramAttendanceSelector({
  selected,
  onChange,
  onScopeChange,
}: {
  selected: number[];
  onChange: (ids: number[]) => void;
  onScopeChange?: (scope: any) => void;
}) {
  const { theme } = useAppTheme();
  const [sections, setSections] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSchool, setSelectedSchool] = useState<string>("ALL");
  const [selectedDepartment, setSelectedDepartment] = useState<string>("ALL");
  const [selectedSemester, setSelectedSemester] = useState<string>("ALL");

  useEffect(() => {
    loadAcademicSections()
      .then((loaded) => setSections(loaded || []))
      .catch(() => setSections([]));
  }, []);

  const handleToggle = (id: number) => {
    const next = selected.includes(id)
      ? selected.filter((x) => x !== id)
      : [...selected, id];
    onChange(next);

    const chosen = sections.filter((s) => next.includes(s.id));
    onScopeChange?.({
      schools: Array.from(new Set(chosen.map((s) => s.school))),
      faculties: Array.from(new Set(chosen.map((s) => s.faculty))),
      departments: Array.from(new Set(chosen.map((s) => s.department))),
      programs: Array.from(new Set(chosen.map((s) => s.program))),
      semesters: Array.from(new Set(chosen.map((s) => s.semester))),
      section_ids: next,
    });
  };

  const handleSelectAllFiltered = (matching: any[]) => {
    const matchingIds = matching.map((s) => s.id);
    const combined = Array.from(new Set([...selected, ...matchingIds]));
    onChange(combined);

    const chosen = sections.filter((s) => combined.includes(s.id));
    onScopeChange?.({
      schools: Array.from(new Set(chosen.map((s) => s.school))),
      faculties: Array.from(new Set(chosen.map((s) => s.faculty))),
      departments: Array.from(new Set(chosen.map((s) => s.department))),
      programs: Array.from(new Set(chosen.map((s) => s.program))),
      semesters: Array.from(new Set(chosen.map((s) => s.semester))),
      section_ids: combined,
    });
  };

  const handleClearAll = () => {
    onChange([]);
    onScopeChange?.({
      schools: [],
      faculties: [],
      departments: [],
      programs: [],
      semesters: [],
      section_ids: [],
    });
  };

  const schools = ["ALL", ...Array.from(new Set(sections.map((s) => s.school))).filter(Boolean)];

  const departments = [
    "ALL",
    ...Array.from(
      new Set(
        sections
          .filter((s) => selectedSchool === "ALL" || s.school === selectedSchool)
          .map((s) => s.department)
      )
    ).filter(Boolean),
  ];

  const semesters = ["ALL", "Semester 1", "Semester 2", "Semester 3", "Semester 4", "Semester 5", "Semester 6", "Semester 7", "Semester 8"];

  const filtered = sections.filter((s) => {
    if (selectedSchool !== "ALL" && s.school !== selectedSchool) return false;
    if (selectedDepartment !== "ALL" && s.department !== selectedDepartment) return false;
    if (selectedSemester !== "ALL" && s.semester !== selectedSemester) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      const match =
        s.program?.toLowerCase().includes(q) ||
        s.semester?.toLowerCase().includes(q) ||
        s.department?.toLowerCase().includes(q) ||
        s.school?.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  const selectedSectionsList = sections.filter((s) => selected.includes(s.id));

  return (
    <View style={{ marginTop: 8, marginBottom: 12 }}>
      {/* Search Input */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: theme.bgElevated,
          borderColor: theme.border,
          borderWidth: 1,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 8,
          marginBottom: 10,
        }}
      >
        <MaterialCommunityIcons name="magnify" size={20} color={theme.muted} />
        <TextInput
          style={{ flex: 1, marginLeft: 8, color: theme.text, fontSize: 13 }}
          placeholder="Search programs, departments, semesters..."
          placeholderTextColor={theme.muted}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery("")}>
            <MaterialCommunityIcons name="close-circle" size={18} color={theme.muted} />
          </Pressable>
        )}
      </View>

      {/* Selected Sections Summary Tray */}
      {selected.length > 0 && (
        <View
          style={{
            backgroundColor: theme.cyanGlow,
            borderColor: theme.cyan,
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <MaterialCommunityIcons name="checkbox-multiple-marked-circle" size={18} color={theme.cyan} />
              <Text style={{ color: theme.cyan, fontWeight: "700", fontSize: 13 }}>
                {selected.length} {selected.length === 1 ? "Section" : "Sections"} Selected
              </Text>
            </View>
            <Pressable onPress={handleClearAll} style={{ paddingHorizontal: 8, paddingVertical: 2 }}>
              <Text style={{ color: theme.rose, fontSize: 12, fontWeight: "600" }}>Clear All</Text>
            </Pressable>
          </View>

          {/* Chips of selected sections */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
            {selectedSectionsList.map((sec) => (
              <Pressable
                key={`sel-${sec.id}`}
                onPress={() => handleToggle(sec.id)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: theme.bgElevated,
                  borderColor: theme.cyan,
                  borderWidth: 1,
                  borderRadius: 20,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  gap: 6,
                }}
              >
                <Text style={{ color: theme.text, fontSize: 11, fontWeight: "600" }}>
                  {sec.program} ({sec.semester})
                </Text>
                <MaterialCommunityIcons name="close" size={14} color={theme.muted} />
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Filter Chips: School Filter */}
      <Text style={{ color: theme.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 6 }}>
        FILTER BY SCHOOL
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 6 }}>
        {schools.map((schoolName) => {
          const isSelected = selectedSchool === schoolName;
          const shortName = schoolName === "ALL" ? "All Schools" : schoolName.replace("School of ", "");
          return (
            <Pressable
              key={`school-${schoolName}`}
              onPress={() => {
                setSelectedSchool(schoolName);
                setSelectedDepartment("ALL");
              }}
              style={{
                backgroundColor: isSelected ? theme.cyan : theme.bgElevated,
                borderColor: isSelected ? theme.cyan : theme.border,
                borderWidth: 1,
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 6,
              }}
            >
              <Text style={{ color: isSelected ? (theme.mode === "dark" ? "#080C14" : "#FFFFFF") : theme.muted, fontSize: 11, fontWeight: isSelected ? "700" : "500" }}>
                {shortName}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Filter Chips: Department Filter */}
      {departments.length > 2 && (
        <>
          <Text style={{ color: theme.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 6 }}>
            FILTER BY DEPARTMENT
          </Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 6 }}>
            {departments.map((deptName) => {
              const isSelected = selectedDepartment === deptName;
              const shortName = deptName === "ALL" ? "All Departments" : deptName.replace("Department of ", "");
              return (
                <Pressable
                  key={`dept-${deptName}`}
                  onPress={() => setSelectedDepartment(deptName)}
                  style={{
                    backgroundColor: isSelected ? theme.cyan : theme.bgElevated,
                    borderColor: isSelected ? theme.cyan : theme.border,
                    borderWidth: 1,
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                  }}
                >
                  <Text style={{ color: isSelected ? (theme.mode === "dark" ? "#080C14" : "#FFFFFF") : theme.muted, fontSize: 11, fontWeight: isSelected ? "700" : "500" }}>
                    {shortName}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </>
      )}

      {/* Filter Chips: Semester Filter */}
      <Text style={{ color: theme.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: 6 }}>
        FILTER BY SEMESTER
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }} contentContainerStyle={{ gap: 6 }}>
        {semesters.map((sem) => {
          const isSelected = selectedSemester === sem;
          return (
            <Pressable
              key={`sem-${sem}`}
              onPress={() => setSelectedSemester(sem)}
              style={{
                backgroundColor: isSelected ? theme.cyan : theme.bgElevated,
                borderColor: isSelected ? theme.cyan : theme.border,
                borderWidth: 1,
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 6,
              }}
            >
              <Text style={{ color: isSelected ? (theme.mode === "dark" ? "#080C14" : "#FFFFFF") : theme.muted, fontSize: 11, fontWeight: isSelected ? "700" : "500" }}>
                {sem === "ALL" ? "All Semesters" : sem}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Actions row: Count + Select All Shown */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8, marginTop: 4 }}>
        <Text style={{ color: theme.muted, fontSize: 12 }}>
          {filtered.length} matching {filtered.length === 1 ? "section" : "sections"}
        </Text>
        {filtered.length > 0 && (
          <Pressable
            onPress={() => handleSelectAllFiltered(filtered)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              backgroundColor: theme.bgElevated,
              borderColor: theme.border,
              borderWidth: 1,
              borderRadius: 6,
              paddingHorizontal: 8,
              paddingVertical: 4,
            }}
          >
            <MaterialCommunityIcons name="checkbox-multiple-marked" size={14} color={theme.cyan} />
            <Text style={{ color: theme.cyan, fontSize: 11, fontWeight: "600" }}>
              Select All Shown ({filtered.length})
            </Text>
          </Pressable>
        )}
      </View>

      {/* Sections List */}
      <View style={{ maxHeight: 320 }}>
        <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={true} style={{ maxHeight: 320 }}>
          {filtered.length === 0 ? (
            <View style={{ padding: 20, alignItems: "center" }}>
              <MaterialCommunityIcons name="layers-off" size={32} color={theme.muted} />
              <Text style={{ color: theme.muted, marginTop: 8, fontSize: 13 }}>No academic sections match filters.</Text>
            </View>
          ) : (
            filtered.map((sec) => {
              const isSelected = selected.includes(sec.id);
              return (
                <Pressable
                  key={`sec-card-${sec.id}`}
                  onPress={() => handleToggle(sec.id)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: isSelected ? theme.cyanGlow : theme.bgElevated,
                    borderColor: isSelected ? theme.cyan : theme.border,
                    borderWidth: 1,
                    borderRadius: 10,
                    padding: 10,
                    marginBottom: 8,
                  }}
                >
                  <MaterialCommunityIcons
                    name={isSelected ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"}
                    size={22}
                    color={isSelected ? theme.cyan : theme.muted}
                  />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <Text style={{ color: isSelected ? theme.cyan : theme.text, fontWeight: "700", fontSize: 13, flex: 1 }}>
                        {sec.program}
                      </Text>
                      <View style={{ backgroundColor: isSelected ? theme.cyan : theme.cardSubtle, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ color: isSelected ? (theme.mode === "dark" ? "#080C14" : "#FFFFFF") : theme.muted, fontSize: 10, fontWeight: "600" }}>
                          {sec.semester} • {sec.section}
                        </Text>
                      </View>
                    </View>
                    <Text style={{ color: theme.muted, fontSize: 11, marginTop: 3 }} numberOfLines={1}>
                      {sec.department} • {sec.school}
                    </Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>
      </View>
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
  departmentWide = false,
}: {
  selected: number[];
  onChange: (ids: number[]) => void;
  onScopeChange?: (scope: any) => void;
  departmentWide?: boolean;
}) {
  const { theme } = useAppTheme();
  const [sections, setSections] = useState<any[]>([]);
  const [selection, setSelection] = useState<any>({
    school: [DEFAULT_ACADEMIC_SCOPE.school],
    faculty: [DEFAULT_ACADEMIC_SCOPE.faculty],
    department: [DEFAULT_ACADEMIC_SCOPE.department],
    program: [],
    semester: [],
  });

  useEffect(() => {
    loadAcademicSections()
      .then((loaded) => {
        setSections(loaded);
        if (departmentWide) {
          const ids = loaded
            .filter(
              (s) =>
                s.school === DEFAULT_ACADEMIC_SCOPE.school &&
                s.faculty === DEFAULT_ACADEMIC_SCOPE.faculty &&
                s.department === DEFAULT_ACADEMIC_SCOPE.department,
            )
            .map((s) => s.id);
          const fixedScope = {
            school: [DEFAULT_ACADEMIC_SCOPE.school],
            faculty: [DEFAULT_ACADEMIC_SCOPE.faculty],
            department: [DEFAULT_ACADEMIC_SCOPE.department],
            program: [],
            semester: [],
          };
          onScopeChange?.(fixedScope);
          onChange(ids);
        }
      })
      .catch(() => setSections([]));
  }, []);

  const getOptions = (key: string, filters: any = {}) => {
    return Array.from(
      new Set(
        sections
          .filter((x) =>
            Object.entries(filters).every(
              ([k, v]: any) => !v?.length || v.includes(x[k]),
            ),
          )
          .map((x) => x[key])
          .filter(Boolean),
      ),
    ) as string[];
  };

  const toggle = (key: string, val: string) => {
    const next = {
      ...selection,
      [key]: selection[key].includes(val)
        ? selection[key].filter((v: string) => v !== val)
        : [...selection[key], val],
    };
    if (key === "school")
      Object.assign(next, {
        faculty: [],
        department: [],
        program: [],
        semester: [],
      });
    if (key === "faculty")
      Object.assign(next, { department: [], program: [], semester: [] });
    if (key === "department")
      Object.assign(next, { program: [], semester: [] });
    if (key === "program") next.semester = [];
    setSelection(next);
    onScopeChange?.(next);
    const ids = sections
      .filter((s) =>
        Object.entries(next).every(
          ([k, v]: any) => !v?.length || v.includes(s[k]),
        ),
      )
      .map((s) => s.id);
    onChange(ids);
  };

  const renderPhase = (label: string, fieldKey: string, opts: string[]) => (
    <View key={fieldKey} style={{ marginBottom: 12 }}>
      <Text style={[styles.phaseStepLabel, { color: theme.muted }]}>
        {label}
      </Text>
      <View style={styles.phaseChipsRow}>
        {opts.map((opt) => {
          const isSelected = selection[fieldKey].includes(opt);
          return (
            <Pressable
              key={opt}
              style={[
                styles.phasePillChip,
                {
                  backgroundColor: theme.bgElevated,
                  borderColor: theme.border,
                },
                isSelected && {
                  backgroundColor: theme.cyanGlow,
                  borderColor: theme.cyan,
                },
              ]}
              onPress={() => toggle(fieldKey, opt)}
            >
              <MaterialCommunityIcons
                name={
                  isSelected
                    ? "checkbox-marked-circle"
                    : "checkbox-blank-circle-outline"
                }
                size={15}
                color={isSelected ? theme.cyan : theme.muted}
              />
              <Text
                style={[
                  styles.phasePillText,
                  { color: isSelected ? theme.cyan : theme.muted },
                  isSelected && { fontWeight: "600" },
                ]}
              >
                {opt}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  return (
    <View style={styles.hierarchyScopeWrap}>
      <Text style={[styles.formGroupHeading, { color: theme.muted }]}>
        DEPARTMENT PERMISSIONS
      </Text>
      <Text style={[styles.hierarchyScopeDesc, { color: theme.muted }]}>
        {departmentWide
          ? "All Computer Science department students will be included in this attendance session."
          : "Select the academic programs this instructor can manage:"}
      </Text>
      <View style={[styles.lockedScopeNotice, { backgroundColor: theme.cardSubtle, borderColor: theme.border }]}>
        <MaterialCommunityIcons name="lock-outline" size={16} color={theme.cyan} />
        <Text style={[styles.lockedScopeNoticeText, { color: theme.textSecondary }]}>
          {DEFAULT_ACADEMIC_SCOPE.school} • {DEFAULT_ACADEMIC_SCOPE.faculty} • {DEFAULT_ACADEMIC_SCOPE.department}
        </Text>
      </View>
      {!departmentWide && renderPhase(
        "1. Select Program",
        "program",
        getOptions("program", {
          school: [DEFAULT_ACADEMIC_SCOPE.school],
          faculty: [DEFAULT_ACADEMIC_SCOPE.faculty],
          department: [DEFAULT_ACADEMIC_SCOPE.department],
        }),
      )}
      {!departmentWide && selection.program.length > 0 &&
        renderPhase(
          "2. Select Semester",
          "semester",
          getOptions("semester", {
            school: [DEFAULT_ACADEMIC_SCOPE.school],
            faculty: [DEFAULT_ACADEMIC_SCOPE.faculty],
            department: [DEFAULT_ACADEMIC_SCOPE.department],
            program: selection.program,
          }),
        )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// MASTER STYLESHEET: BALANCED, ELEVATED, NO OVERFLOW OR UNDERFLOW
// ---------------------------------------------------------------------------
const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  splashContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  splashGlowBg: {
    position: "absolute",
    width: 260,
    height: 260,
    borderRadius: 130,
    top: SCREEN_HEIGHT * 0.3,
  },
  splashCard: {
    alignItems: "center",
    padding: 28,
    borderRadius: 18,
    borderWidth: 1,
  },
  splashLogo: {
    width: 80,
    height: 80,
    borderRadius: 18,
  },
  splashPulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 18,
    marginBottom: 6,
  },
  splashTitle: {
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  splashSubtitle: {
    fontSize: 13,
    marginTop: 4,
    textAlign: "center",
  },
  screenCenterLoader: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
  },
  loaderSubText: {
    marginTop: 14,
    fontSize: 13,
    fontWeight: "500",
  },

  // LOGIN SCREEN
  loginAmbientCircle: {
    position: "absolute",
    width: 0,
    height: 0,
  },
  loginScroll: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    alignItems: "center",
  },
  loginTopControls: {
    width: "100%",
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 16,
  },
  themePillBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  themePillText: {
    fontSize: 12,
    fontWeight: "600",
  },
  loginBrandHeader: {
    alignItems: "center",
    marginBottom: 24,
  },
  loginLogoRingWrap: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  loginLogoRingOuter: {
    position: "absolute",
    width: 0,
    height: 0,
  },
  loginBrandTagline: {
    fontSize: 13,
    marginTop: 2,
    marginBottom: 4,
    fontWeight: "500",
  },
  brandStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  logoBadgeCard: {
    width: 76,
    height: 76,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loginLogo: {
    width: 60,
    height: 60,
    borderRadius: 14,
  },
  brandTitleText: {
    fontSize: 26,
    fontWeight: "700",
    marginTop: 12,
    letterSpacing: -0.4,
  },
  brandStatusTag: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
    gap: 6,
    borderWidth: 1,
  },
  brandStatusTagText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  loginSurfaceCard: {
    width: "100%",
    borderRadius: 18,
    padding: 22,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  cardHeaderTitle: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  cardHeaderSubtitle: {
    fontSize: 13,
    marginTop: 3,
    marginBottom: 16,
  },
  roleTabsWrap: {
    flexDirection: "row",
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
  },
  roleTabItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 8,
    gap: 6,
  },
  roleTabItemActive: {
    borderWidth: 1,
  },
  roleTabLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  formGroup: {
    marginBottom: 14,
  },
  fieldLabelText: {
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
    letterSpacing: 0.1,
  },
  fieldHintText: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  inputContainerBox: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 46,
  },
  inputPrefixIcon: {
    marginRight: 8,
  },
  textInputBox: {
    flex: 1,
    fontSize: 14,
    fontWeight: "500",
  },
  textInputHoloPlain: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 46,
    fontSize: 14,
    fontWeight: "500",
  },
  eyeBtn: {
    padding: 6,
  },
  errorBannerBox: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
    gap: 8,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
  },
  submitButtonGlow: {
    height: 46,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 2,
  },
  submitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  submitTextAction: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  demoPresetsBox: {
    marginTop: 18,
    paddingTop: 14,
    borderTopWidth: 1,
    alignItems: "center",
  },
  demoPresetsTitle: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  demoChipsRow: {
    flexDirection: "row",
    gap: 8,
  },
  demoChipPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  demoChipPillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  registerRowWrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  registerPromptText: {
    fontSize: 13,
    fontWeight: "500",
  },
  registerLinkText: {
    fontSize: 13,
    fontWeight: "700",
  },
  loginFootnote: {
    marginTop: 20,
    fontSize: 12,
    textAlign: "center",
  },

  // TOP BAR
  topGlassBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderBottomWidth: 1,
  },
  topBarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandBadgeWrap: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  brandThumbLogo: {
    width: 24,
    height: 24,
    borderRadius: 6,
  },
  brandNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  brandHeaderTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: -0.2,
  },
  roleChipPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  roleChipText: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  greetingHeaderSub: {
    fontSize: 12,
    fontWeight: "400",
  },
  topBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  topIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    position: "relative",
  },
  badgeDotGlow: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  topAvatarPill: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    overflow: "hidden",
  },
  avatarImg: {
    width: "100%",
    height: "100%",
  },
  avatarInitialText: {
    fontSize: 14,
    fontWeight: "700",
  },

  // SCROLL CONTENT & FLOATING ISLAND
  scrollContentBody: {
    paddingHorizontal: SCREEN_SIDE_PADDING,
    paddingTop: 16,
    paddingBottom: 100,
  },
  bottomFloatingIsland: {
    position: "absolute",
    bottom: Platform.OS === "ios" ? 18 : 10,
    left: 16,
    right: 16,
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 8,
  },
  bottomTabButton: {
    flex: 1,
    alignItems: "center",
  },
  tabIconContainer: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  tabIconContainerActive: {},
  tabLabelText: {
    fontSize: 11,
    fontWeight: "500",
    marginTop: 2,
  },

  // SCREEN COMMONS
  screenLayout: {
    gap: 16,
  },
  screenTopHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  screenMainTitle: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  screenSubTitle: {
    fontSize: 13,
    marginTop: 2,
    lineHeight: 18,
  },
  screenAddButtonMini: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 1,
    gap: 4,
  },
  screenAddBtnMiniText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  sectionHeaderTitle: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginTop: 6,
    textTransform: "uppercase",
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  viewAllActionText: {
    fontSize: 12,
    fontWeight: "600",
  },

  // EXECUTIVE HERO CARDS
  executiveHeroCard: {
    position: "relative",
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  heroAccentBar: {
    position: "absolute",
    left: 0,
    top: 16,
    bottom: 16,
    width: 3,
    borderRadius: 2,
    opacity: 0.9,
  },
  executiveHeroHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  executiveStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 6,
    borderWidth: 1,
  },
  pulseLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  executiveStatusText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  executiveDateText: {
    fontSize: 11,
    fontWeight: "500",
  },
  executiveHeroHeading: {
    fontSize: 18,
    fontWeight: "700",
  },
  executiveHeroSub: {
    fontSize: 13,
    marginTop: 3,
    lineHeight: 17,
  },

  teacherHeroBanner: {
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  teacherHeroPillRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    alignSelf: "flex-start",
    marginBottom: 10,
    gap: 6,
    borderWidth: 1,
  },
  teacherHeroPillText: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  teacherHeroMainHeading: {
    fontSize: 18,
    fontWeight: "700",
  },
  teacherHeroDescription: {
    fontSize: 13,
    marginTop: 4,
    lineHeight: 17,
    marginBottom: 14,
  },
  teacherLaunchButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 44,
    borderRadius: 10,
    gap: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 2,
  },
  teacherLaunchButtonText: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },

  // KPI GRID
  kpiGridMatrix: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: CARD_GRID_GAP,
  },
  kpiCardHolo: {
    width: CARD_GRID_WIDTH,
    minHeight: 125,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  kpiIconBadgeHolo: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  kpiValueHolo: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  kpiLabelHolo: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 2,
  },
  kpiDeltaHolo: {
    fontSize: 11,
    marginTop: 1,
  },

  // SPARKLINES
  sparklineContainer: {
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  sparklineHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  sparklineTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  sparklineAvg: {
    fontSize: 12,
    fontWeight: "600",
  },
  sparklineBarsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "flex-end",
    height: 64,
  },
  sparklineCol: {
    alignItems: "center",
    gap: 6,
  },
  sparklineBarTrack: {
    width: 20,
    height: 46,
    borderRadius: 4,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  sparklineBarFill: {
    borderRadius: 4,
  },
  sparklineDayLabel: {
    fontSize: 10,
    fontWeight: "500",
  },

  // RAPID COMMANDS
  rapidCommandsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: CARD_GRID_GAP,
  },
  rapidCmdCardHolo: {
    width: CARD_GRID_WIDTH,
    minHeight: 115,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  dashboardCardPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.98 }],
  },
  rapidCmdIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  rapidCmdTitleHolo: {
    fontSize: 13,
    fontWeight: "600",
  },
  rapidCmdDescHolo: {
    fontSize: 11,
    marginTop: 2,
  },

  // STREAM & ROSTER CARDS
  streamEventCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    minHeight: 64,
  },
  streamIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  streamItemTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  streamItemSub: {
    fontSize: 11,
    marginTop: 1,
  },
  rosterItemCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
  },
  rosterAvatarBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rosterAvatarInitial: {
    fontSize: 15,
    fontWeight: "700",
  },
  rosterItemName: {
    fontSize: 13,
    fontWeight: "600",
  },
  rosterItemId: {
    fontSize: 11,
    fontWeight: "500",
    marginTop: 1,
  },
  rosterItemMeta: {
    fontSize: 11,
    marginTop: 1,
  },

  // TOOLBAR
  toolbarRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  searchBarGlass: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInputHolo: {
    flex: 1,
    fontSize: 13,
    fontWeight: "500",
    marginLeft: 8,
  },
  filterToggleBox: {
    width: 42,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  filterDrawerCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },

  // GLASS FORM CARDS
  glassFormCard: {
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
  },
  formGroupHeading: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  lockedScopeNotice: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  lockedScopeNoticeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "500",
  },
  formTopHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  backBtnCircle: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  formActionButtonsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  formCancelBtn: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  formCancelBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  formSubmitBtn: {
    flex: 2,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 2,
  },
  formSubmitBtnText: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  twoColumnGridRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },

  // BIOMETRIC PROMPT CARD
  biometricPromptCardHolo: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    marginTop: 4,
    marginBottom: 8,
  },
  biometricIconBadge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  biometricCardTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  biometricCardSub: {
    fontSize: 11,
    marginTop: 2,
  },

  // HUD CAMERA VIEWPORT
  hudStepsContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
  },
  hudStepBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  hudStepBadgeText: {
    fontSize: 11,
    fontWeight: "700",
  },
  hudCameraViewport: {
    backgroundColor: "#000",
    borderRadius: 18,
    overflow: "hidden",
    height: 380,
    borderWidth: 1,
  },
  hudCameraErrorWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cameraFrameWrapper: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  hudCornerTopLeft: {
    position: "absolute",
    top: 20,
    left: 20,
    width: 24,
    height: 24,
    borderTopWidth: 2,
    borderLeftWidth: 2,
  },
  hudCornerTopRight: {
    position: "absolute",
    top: 20,
    right: 20,
    width: 24,
    height: 24,
    borderTopWidth: 2,
    borderRightWidth: 2,
  },
  hudCornerBottomLeft: {
    position: "absolute",
    bottom: 20,
    left: 20,
    width: 24,
    height: 24,
    borderBottomWidth: 2,
    borderLeftWidth: 2,
  },
  hudCornerBottomRight: {
    position: "absolute",
    bottom: 20,
    right: 20,
    width: 24,
    height: 24,
    borderBottomWidth: 2,
    borderRightWidth: 2,
  },
  hudBiometricEllipse: {
    width: 200,
    height: 280,
    borderRadius: 100,
    borderWidth: 2,
    borderColor: "rgba(59, 130, 246, 0.4)",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  hudBiometricEllipseDone: {
    borderStyle: "solid",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
  hudBiometricEllipseScanning: {},
  liveFaceBoundingBox: {
    position: "absolute",
    borderWidth: 2,
    borderColor: "#10B981",
    borderRadius: 8,
    shadowColor: "#10B981",
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 4,
  },
  animatedLaserLine: {
    position: "absolute",
    width: "100%",
    height: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 6,
    elevation: 3,
  },
  hudLiveTelemetryBar: {
    position: "absolute",
    bottom: 16,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(11, 15, 25, 0.9)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    gap: 8,
    borderWidth: 1,
  },
  hudTelemetryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  hudTelemetryLabel: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  hudInstructionCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  hudInstructionTitle: {
    fontSize: 14,
    fontWeight: "600",
  },
  hudInstructionDesc: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
    marginBottom: 12,
  },
  hudForceCaptureBtn: {
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  hudForceCaptureBtnText: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  permCardHolo: {
    borderRadius: 16,
    padding: 22,
    alignItems: "center",
    borderWidth: 1,
  },
  permTitleHolo: {
    fontSize: 16,
    fontWeight: "700",
    marginTop: 12,
  },
  permDescHolo: {
    fontSize: 13,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 16,
    lineHeight: 18,
  },

  // SECTION SELECTION & ACTIONS
  sectionSelectedCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
    borderWidth: 1,
  },
  sectionSelectedTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  sectionSelectedSub: {
    fontSize: 11,
    marginTop: 1,
  },
  sessionDeleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  multiPhotoHint: {
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 10,
  },
  viewResultsBtn: {
    height: 44,
    marginTop: 12,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  viewResultsBtnText: {
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  dualPhotoActionsCol: {
    gap: 12,
  },
  captureHeroBtn: {
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  captureHeroBtnTitle: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
    letterSpacing: 0.2,
  },
  captureHeroBtnSub: {
    fontSize: 11,
    marginTop: 2,
    fontWeight: "500",
  },
  galleryHeroBtn: {
    borderRadius: 14,
    padding: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  galleryHeroBtnTitle: {
    fontSize: 13,
    fontWeight: "600",
    marginTop: 4,
    letterSpacing: 0.2,
  },
  galleryHeroBtnSub: {
    fontSize: 11,
    marginTop: 2,
  },

  // RECOGNITION RESULTS
  resultsNoticeBox: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    padding: 12,
    gap: 8,
    borderWidth: 1,
  },
  resultsNoticeText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 15,
  },
  resultsCardsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  resultItemCardHolo: {
    width: CARD_GRID_WIDTH,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  resultAvatarCircleHolo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  resultItemNameText: {
    fontSize: 13,
    fontWeight: "600",
    textAlign: "center",
  },
  resultItemIdText: {
    fontSize: 10,
    marginTop: 1,
    marginBottom: 6,
  },

  // VERIFY & ROSTER TOOLBAR
  tallyHUDCard: {
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  tallyStatsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
  },
  tallyStatCol: {
    alignItems: "center",
  },
  tallyDigit: {
    fontSize: 22,
    fontWeight: "700",
  },
  tallyMeta: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
  },
  tallyDividerLine: {
    width: 1,
    height: 28,
  },
  tallyProgressBarTrack: {
    height: 5,
    borderRadius: 3,
    overflow: "hidden",
    marginTop: 12,
    marginBottom: 6,
  },
  tallyProgressBarFill: {
    height: "100%",
    borderRadius: 3,
  },
  tallyRatioSubText: {
    fontSize: 10,
    textAlign: "center",
    fontWeight: "600",
  },
  verifyToolbarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  filterSegmentPillWrap: {
    flexDirection: "row",
    borderRadius: 8,
    padding: 2,
  },
  filterSegmentBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  filterSegmentBtnActive: {
    borderWidth: 1,
  },
  filterSegmentBtnText: {
    fontSize: 11,
    fontWeight: "600",
  },
  quickBulkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  quickBulkBtnText: {
    fontSize: 11,
    fontWeight: "600",
  },
  checklistCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
  checkListName: {
    fontSize: 13,
    fontWeight: "600",
  },
  checkListId: {
    fontSize: 11,
    marginTop: 1,
  },
  togglePillHolo: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 4,
    borderWidth: 1,
  },
  togglePillHoloPresent: {},
  togglePillHoloAbsent: {},
  togglePillHoloText: {
    fontSize: 11,
    fontWeight: "600",
  },

  // STUDENT SCORECARD
  studentScorecardGlass: {
    borderRadius: 16,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    gap: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  radialDialContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  radialDialOuterRing: {
    width: 84,
    height: 84,
    borderRadius: 42,
    borderWidth: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  radialDialPercent: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  radialDialTitle: {
    fontSize: 9,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  studentCardHeading: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 6,
  },
  studentDegreeText: {
    fontSize: 11,
    marginTop: 6,
  },
  studentBreakdownGrid: {
    flexDirection: "row",
    gap: 12,
  },
  studentBreakdownBox: {
    flex: 1,
    minHeight: 90,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    alignItems: "center",
  },
  studentBreakdownVal: {
    fontSize: 20,
    fontWeight: "700",
  },
  studentBreakdownLbl: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 3,
  },
  primaryNeonButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 46,
    borderRadius: 10,
    gap: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 2,
  },
  primaryNeonButtonText: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },

  // SCHEDULE & TIMETABLE
  scheduleRowCard: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 74,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  scheduleTimeBadge: {
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
    alignItems: "center",
    borderWidth: 1,
  },
  scheduleTimeStart: {
    fontSize: 12,
    fontWeight: "700",
  },
  scheduleTimeFinish: {
    fontSize: 10,
    marginTop: 1,
  },
  scheduleLectureTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  scheduleLectureMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  scheduleChevronBox: {
    padding: 4,
  },
  roomTagHolo: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
  },
  roomTagHoloText: {
    fontSize: 10,
    fontWeight: "600",
  },
  teacherMetricsRow: {
    flexDirection: "row",
    gap: 12,
  },
  teacherMetricBox: {
    flex: 1,
    minHeight: 96,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  teacherMetricDigit: {
    fontSize: 18,
    fontWeight: "700",
    marginTop: 4,
  },
  teacherMetricLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 2,
    textAlign: "center",
  },

  // STUDENT SESSION CARDS
  studentSessionCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  studentSessionIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  studentSessionTitle: {
    fontSize: 13,
    fontWeight: "700",
  },
  studentSessionMeta: {
    fontSize: 11,
    marginTop: 1,
  },
  studentSessionDate: {
    fontSize: 10,
    marginTop: 2,
  },

  // DATE PICKERS
  datePickerCardHolo: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    justifyContent: "space-between",
  },
  datePickerCardText: {
    fontSize: 13,
    fontWeight: "600",
    flex: 1,
    paddingLeft: 10,
  },

  // SEGMENTED CONTROLS
  segmentWrapHolo: {
    flexDirection: "row",
    borderRadius: 10,
    padding: 3,
  },
  segmentBtnHolo: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 8,
  },
  segmentBtnHoloActive: {
    borderWidth: 1,
  },
  segmentBtnHoloText: {
    fontSize: 11,
    fontWeight: "600",
  },

  // NOTIFICATIONS
  markAllBtnHolo: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  markAllBtnHoloText: {
    fontSize: 11,
    fontWeight: "600",
  },
  notifCardHolo: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
  },
  notifIconCircleHolo: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  notifTitleHolo: {
    fontSize: 13,
    fontWeight: "700",
  },
  notifBodyHolo: {
    fontSize: 11,
    marginTop: 2,
    lineHeight: 16,
  },
  notifTimeHolo: {
    fontSize: 10,
    marginTop: 4,
  },
  unreadDotHolo: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 5,
  },

  // ACADEMIC HIERARCHY
  hierarchyBranchCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
  },
  hierarchyBranchHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 10,
  },
  hierarchySchoolTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: "700",
  },
  hierarchyCountPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  hierarchyCountPillText: {
    fontSize: 10,
    fontWeight: "600",
  },
  hierarchyFacultySection: {
    borderTopWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  hierarchyFacultyBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  hierarchyFacultyTitle: {
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
  },
  hierarchyProgramsStack: {
    marginTop: 8,
    paddingLeft: 24,
    gap: 5,
  },
  hierarchyProgramLine: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  },
  hierarchyBulletDot: {
    fontSize: 13,
  },
  hierarchyDeptName: {
    fontSize: 11,
    fontWeight: "600",
  },
  hierarchyProgName: {
    fontSize: 10,
  },

  // PROFILE SCREENS
  profileHeroCardHolo: {
    borderRadius: 18,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
  },
  profileAvatarWrapHolo: {
    position: "relative",
    marginBottom: 12,
  },
  profileAvatarImgHolo: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 2,
  },
  profileAvatarFallbackHolo: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  profileAvatarFallbackInitial: {
    fontSize: 28,
    fontWeight: "700",
  },
  avatarEditPillHolo: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  profileHeroNameHolo: {
    fontSize: 18,
    fontWeight: "700",
  },
  profileRoleBadgeHolo: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 6,
    borderWidth: 1,
  },
  profileRoleBadgeText: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.4,
  },
  profileHeroEmailHolo: {
    fontSize: 12,
    marginTop: 4,
  },
  assignedCourseRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  assignedCourseTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  assignedCourseSub: {
    fontSize: 11,
    marginTop: 2,
  },
  signOutBtnHolo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    height: 46,
    gap: 8,
    borderWidth: 1,
  },
  signOutBtnHoloText: {
    fontSize: 13,
    fontWeight: "600",
  },

  // COMMON HELPERS & MODALS
  statusPillHolo: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: "flex-start",
  },
  statusPillHoloText: {
    fontSize: 10,
    fontWeight: "600",
  },
  holoDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  holoDetailLabel: {
    fontSize: 12,
    fontWeight: "500",
  },
  holoDetailValue: {
    fontSize: 12,
    fontWeight: "600",
  },
  emptyCardHolo: {
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    marginVertical: 10,
  },
  emptyIconBadgeHolo: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyTitleHolo: {
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyDescHolo: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 5,
    lineHeight: 17,
  },
  emptyActionBtnHolo: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 10,
  },
  emptyActionBtnHoloText: {
    fontSize: 12,
    fontWeight: "600",
  },
  selectTriggerHolo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 44,
  },
  selectTriggerHoloDisabled: {
    opacity: 0.5,
  },
  selectTriggerHoloText: {
    fontSize: 13,
    fontWeight: "500",
  },
  applyFilterBtnHolo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    height: 42,
    gap: 6,
    marginTop: 12,
  },
  applyFilterBtnHoloText: {
    fontSize: 12,
    fontWeight: "600",
  },

  // MODAL OVERLAYS
  modalBackdropOverlay: {
    flex: 1,
    backgroundColor: "rgba(11, 15, 25, 0.7)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalSheetCard: {
    width: "100%",
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
  },
  modalSheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },
  modalSheetTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  modalProfileHero: {
    alignItems: "center",
    marginBottom: 14,
  },
  modalAvatarGlow: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    borderWidth: 1,
  },
  modalAvatarGlowText: {
    fontSize: 22,
    fontWeight: "700",
  },
  modalHeroName: {
    fontSize: 16,
    fontWeight: "700",
  },
  modalIdBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginTop: 5,
    borderWidth: 1,
  },
  modalIdBadgeText: {
    fontSize: 10,
    fontWeight: "600",
  },
  modalDetailsGroup: {
    marginBottom: 16,
  },
  modalDismissBtn: {
    height: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  modalDismissBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  modalDualActionsRow: {
    flexDirection: "row",
    gap: 10,
  },
  modalDangerBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    height: 44,
    gap: 6,
    borderWidth: 1,
  },
  modalDangerBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  modalDismissBtnFlex: {
    flex: 1,
    borderRadius: 10,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },

  // DROPDOWNS & HIERARCHY SCOPES
  dropdownModalHolo: {
    width: "100%",
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
  },
  dropdownModalTitle: {
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 12,
  },
  dropdownOptionHolo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  dropdownOptionTextHolo: {
    fontSize: 13,
    fontWeight: "500",
  },
  hierarchyScopeWrap: {
    marginTop: 10,
  },
  hierarchyScopeDesc: {
    fontSize: 11,
    marginBottom: 10,
    lineHeight: 15,
  },
  phaseStepLabel: {
    fontSize: 11,
    fontWeight: "600",
    marginBottom: 7,
  },
  phaseChipsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  phasePillChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5,
    borderWidth: 1,
  },
  phasePillChipActive: {},
  phasePillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  readOnlyTagPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    gap: 4,
    borderWidth: 1,
  },
  readOnlyTagText: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  reportSessionItemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  reportSessionIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  reportSessionItemTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  reportSessionItemSub: {
    fontSize: 11,
    marginTop: 1,
  },
  emptySubText: {
    fontSize: 12,
    paddingVertical: 10,
  },
  biometricModalContainer: {
    flex: 1,
  },
  biometricModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
  },
  biometricHeaderTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  biometricHeaderSub: {
    fontSize: 12,
    marginTop: 2,
  },
  biometricPermWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  nativeCaptureScreen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  nativeCaptureIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    marginBottom: 20,
  },
  nativeCaptureTitle: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 8,
  },
  nativeCaptureText: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 300,
    marginBottom: 24,
  },
  nativeCaptureButton: {
    minWidth: 220,
    height: 48,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  nativeCaptureButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  nativeCaptureStatus: {
    textAlign: "center",
    marginTop: 16,
    fontSize: 12,
    lineHeight: 18,
  },
  biometricCameraFullFrame: {
    flex: 1,
    flexDirection: "column",
    position: "relative",
    backgroundColor: "#000",
  },
  biometricViewfinderArea: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
    backgroundColor: "#000",
  },
  hudCenteredGuideContainer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  hudCenteredGuideHint: {
    color: "rgba(255, 255, 255, 0.8)",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.8,
    marginTop: 12,
    textTransform: "uppercase",
  },
  biometricCameraViewport: {
    flex: 1,
    position: "relative",
    backgroundColor: "#000",
  },
  biometricBottomControlBar: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-around",
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderTopWidth: 1,
  },
  cameraFlipBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    zIndex: 10,
  },
  galleryIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  shutterOuterRing: {
    minWidth: 160,
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
  },
  captureButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  captureButtonLabel: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  inViewCaptureButton: {
    position: "absolute",
    left: 36,
    right: 36,
    bottom: 24,
    height: 48,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    zIndex: 30,
    elevation: 6,
  },
  inViewCaptureButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  biometricPreviewContainer: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
  },
  biometricPreviewCard: {
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
    aspectRatio: 3 / 4,
    maxHeight: 440,
    alignSelf: "center",
    width: "100%",
  },
  biometricPreviewImg: {
    width: "100%",
    height: "100%",
  },
  biometricVerifiedBadge: {
    position: "absolute",
    top: 14,
    left: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  biometricVerifiedText: {
    fontSize: 11,
    fontWeight: "600",
  },
  biometricStatusBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 14,
  },
  biometricStatusBoxText: {
    fontSize: 12,
    fontWeight: "500",
    flex: 1,
  },
  biometricActionsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  biometricRetakeBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  biometricRetakeBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  biometricConfirmBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  biometricConfirmBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  photoVerifiedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  photoVerifiedThumb: {
    width: 56,
    height: 56,
    borderRadius: 8,
  },
  verifiedRow: {
    flex: 1,
  },
  verifiedTitle: {
    fontSize: 13,
    fontWeight: "600",
  },
  verifiedSub: {
    fontSize: 11,
    marginTop: 2,
  },
  retakeActionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 8,
  },
  smallActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  smallActionBtnText: {
    fontSize: 11,
    fontWeight: "600",
  },
  biometricPromptCardEnhanced: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
  },
  biometricPromptInfoRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    marginBottom: 14,
  },
  biometricButtonsRow: {
    flexDirection: "row",
    gap: 10,
  },
  openCameraBtnPrimary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
  },
  openCameraBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  chooseGalleryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  chooseGalleryBtnText: {
    fontSize: 13,
    fontWeight: "600",
  },
  generateIdBtn: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  generateIdBtnText: {
    fontSize: 11,
    fontWeight: "600",
  },
  annotatedPreviewCard: {
    width: "100%",
    height: 240,
    borderRadius: 14,
    borderWidth: 1,
    overflow: "hidden",
    position: "relative",
    marginBottom: 16,
  },
  annotatedPreviewImg: {
    width: "100%",
    height: "100%",
  },
  annotatedOverlayBadge: {
    position: "absolute",
    bottom: 10,
    left: 10,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  modalFooterTwoBtnsRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 16,
  },
  capturedThumbsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 12,
    paddingVertical: 4,
  },
  capturedThumbWrap: {
    width: 48,
    height: 48,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
  },
  capturedThumbImg: {
    width: "100%",
    height: "100%",
  },
  secondaryHoloButton: {
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryHoloButtonText: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  metricCardHolo: {
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  metricCardLabel: {
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  metricCardValue: {
    fontSize: 18,
    fontWeight: "700",
  },
  serverPillBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 14,
    gap: 8,
  },
  serverStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  serverPillText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "500",
  },
  paginationRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 16,
  },
  paginationBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    gap: 6,
  },
  paginationBtnText: {
    fontSize: 12,
    fontWeight: "600",
  },
  paginationInfoText: {
    fontSize: 12,
    fontWeight: "500",
  },
  pageSizeSelectorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
    marginBottom: 4,
  },
  pageSizePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  pageSizePillText: {
    fontSize: 11,
    fontWeight: "600",
  },
  searchInputWrap: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginTop: 10,
    gap: 8,
  },
  searchTextInput: {
    flex: 1,
    fontSize: 13,
    padding: 0,
  },
  exportTabSegmentWrap: {
    flexDirection: "row",
    borderRadius: 10,
    borderWidth: 1,
    padding: 3,
    marginBottom: 16,
  },
  exportTabBtn: {
    flex: 1,
    paddingVertical: 9,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 7,
  },
  exportTabBtnActive: {
    borderWidth: 1,
  },
  exportTabBtnText: {
    fontSize: 11,
    fontWeight: "600",
  },
  exportCardBox: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  exportSectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  exportPillGroup: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 14,
  },
  exportChoicePill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  exportChoicePillText: {
    fontSize: 12,
    fontWeight: "600",
  },
  exportSummaryBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 16,
  },
  topMenuDropdownCard: {
    position: "absolute",
    top: 65,
    right: 18,
    width: 220,
    borderRadius: 14,
    borderWidth: 1,
    padding: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  topMenuHeader: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  topMenuTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  menuDivider: {
    height: 1,
    marginVertical: 6,
  },
  topMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 9,
    borderRadius: 8,
  },
  topMenuItemText: {
    fontSize: 13,
    fontWeight: "600",
  },
  sectionHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  sectionTitleText: {
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.3,
  },
  sectionSubtitleText: {
    fontSize: 12,
    marginTop: 2,
  },
});
