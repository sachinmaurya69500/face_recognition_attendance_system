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
  Image,
  Modal,
  Platform,
  Pressable,
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
const CARD_GRID_WIDTH = (SCREEN_WIDTH - 32 - 12) / 2; // Exact 2-column mathematical grid
const STATUS_BAR_HEIGHT =
  Platform.OS === "android" ? (RNStatusBar.currentHeight ?? 24) : 0;
// Most Android emulators expose a virtual back camera but leave the front
// camera unconfigured. Real phones retain the expected selfie-camera default.
const DEFAULT_CAMERA_FACING: "front" | "back" =
  Platform.OS === "android" && !Constants.isDevice ? "back" : "front";

// ---------------------------------------------------------------------------
// DUAL-ENGINE THEME PALETTES (MIDNIGHT COSMOS DARK  +  CLOUD ATLAS LIGHT)
// ---------------------------------------------------------------------------
export const darkTheme = {
  mode: "dark" as const,
  bg: "#070A12",
  bgElevated: "#0D1423",
  card: "#111B2D",
  cardGlass: "rgba(16, 27, 45, 0.94)",
  cardSubtle: "#0A101D",
  cardHover: "#17263E",
  divider: "rgba(255,255,255,0.07)",
  border: "rgba(255, 255, 255, 0.09)",
  borderBright: "rgba(255, 255, 255, 0.17)",
  borderAccent: "rgba(111, 191, 232, 0.42)",
  cyan: "#71C4E8",
  cyanGlow: "rgba(113, 196, 232, 0.16)",
  cyanStrong: "#A6E0F5",
  blue: "#5B8DEF",
  blueDark: "#1B2C51",
  blueGlow: "rgba(91, 141, 239, 0.18)",
  amber: "#F6AD55",
  amberGlow: "rgba(246, 173, 85, 0.18)",
  emerald: "#48BB78",
  emeraldGlow: "rgba(72, 187, 120, 0.18)",
  rose: "#FC8181",
  roseGlow: "rgba(252, 129, 129, 0.18)",
  purple: "#B794F4",
  purpleGlow: "rgba(183, 148, 244, 0.18)",
  gold: "#ECC94B",
  goldGlow: "rgba(236, 201, 75, 0.16)",
  text: "#EDF2F7",
  textSecondary: "#A0AEC0",
  muted: "#4A5568",
  navBg: "rgba(7, 11, 19, 0.97)",
  statusBarStyle: "light" as const,
};

export const lightTheme = {
  mode: "light" as const,
  bg: "#F7F8FA",
  bgElevated: "#FFFFFF",
  card: "#FFFFFF",
  cardGlass: "rgba(255, 255, 255, 0.94)",
  cardSubtle: "#F3F5F8",
  cardHover: "#EEF3F8",
  divider: "rgba(0,0,0,0.05)",
  border: "#E4E8EE",
  borderBright: "#CDD6E2",
  borderAccent: "rgba(35, 76, 130, 0.25)",
  cyan: "#24558C",
  cyanGlow: "rgba(36, 85, 140, 0.10)",
  cyanStrong: "#183F6D",
  blue: "#315FAD",
  blueDark: "#19375F",
  blueGlow: "rgba(49, 95, 173, 0.10)",
  amber: "#B7791F",
  amberGlow: "rgba(183, 121, 31, 0.12)",
  emerald: "#059669",
  emeraldGlow: "rgba(5, 150, 105, 0.10)",
  rose: "#DC2626",
  roseGlow: "rgba(220, 38, 38, 0.10)",
  purple: "#7656A8",
  purpleGlow: "rgba(118, 86, 168, 0.10)",
  gold: "#A46F18",
  goldGlow: "rgba(183, 121, 31, 0.10)",
  text: "#162235",
  textSecondary: "#526174",
  muted: "#8995A5",
  navBg: "rgba(247, 248, 250, 0.97)",
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

const DEFAULT_TUNNEL_URL = "https://cair-ms-7e06.tail49e3b1.ts.net";

export function resolveApiBaseUrl(): string {
  const envUrl = (process.env.EXPO_PUBLIC_API_URL?.trim() || DEFAULT_TUNNEL_URL).replace(/\/+$/, "");

  // Remote tunnel or custom URL (e.g. Tailscale / Cloudflare / Public HTTPS)
  if (
    envUrl &&
    !envUrl.includes("10.0.2.2") &&
    !envUrl.includes("localhost") &&
    !envUrl.includes("127.0.0.1")
  ) {
    return envUrl;
  }

  // On Web browser, 10.0.2.2 cannot be resolved; use localhost
  if (Platform.OS === "web") {
    if (envUrl && !envUrl.includes("10.0.2.2")) return envUrl;
    if (typeof window !== "undefined" && window.location?.hostname) {
      return `http://${window.location.hostname}:8000`;
    }
    return "http://localhost:8000";
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

  if (envUrl) return envUrl;

  // On Android emulator
  if (Platform.OS === "android") {
    return "http://10.0.2.2:8000";
  }

  return "http://localhost:8000";
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
    // Start in the requested light theme even for users who previously saved
    // the old dark default.
    setIsDark(false);
    AsyncStorage.setItem("pratyaksh_theme", "light");

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
  };

  const submit = async () => {
    if (!username.trim() || !password) {
      setError("Please enter your username and password.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await http.post("/auth/login", {
        username: username.trim(),
        password,
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
        setError("Unable to connect to the server. Please try again later.");
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

  return (
    <SafeAreaView
      style={[
        styles.safeArea,
        { backgroundColor: theme.bg, paddingTop: STATUS_BAR_HEIGHT },
      ]}
    >
      <StatusBar style={theme.statusBarStyle} />

      {/* Ambient glow blobs */}
      <View
        style={[
          styles.loginAmbientCircle,
          {
            backgroundColor: theme.cyanGlow,
            top: -80,
            left: -60,
          },
        ]}
      />
      <View
        style={[
          styles.loginAmbientCircle,
          {
            backgroundColor: theme.purpleGlow,
            top: SCREEN_HEIGHT * 0.4,
            right: -80,
            width: 200,
            height: 200,
            borderRadius: 100,
          },
        ]}
      />

      <ScrollView
        contentContainerStyle={styles.loginScroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Theme Toggle Row */}
        <View style={styles.loginTopControls}>
          <Pressable
            onPress={toggleTheme}
            accessibilityRole="button"
            accessibilityLabel={isDark ? "Switch to light theme" : "Switch to dark theme"}
            style={[
              styles.themePillBtn,
              {
                backgroundColor: isDark
                  ? "rgba(255,255,255,0.07)"
                  : "rgba(37,99,235,0.08)",
                borderColor: theme.border,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={isDark ? "white-balance-sunny" : "moon-waning-crescent"}
              size={17}
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
          {/* Logo with Glow Ring */}
          <View style={styles.loginLogoRingWrap}>
            <View
              style={[
                styles.loginLogoRingOuter,
                { borderColor: theme.borderAccent },
              ]}
            />
            <View
              style={[
                styles.logoBadgeCard,
                {
                  backgroundColor: theme.card,
                  borderColor: theme.borderAccent,
                  shadowColor: theme.cyan,
                  shadowOffset: { width: 0, height: 0 },
                  shadowOpacity: 0.5,
                  shadowRadius: 16,
                  elevation: 8,
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
            PRATYAKSH<Text style={{ color: theme.cyan }}>.AI</Text>
          </Text>
          <Text
            style={[styles.loginBrandTagline, { color: theme.textSecondary }]}
          >
            Intelligent Academic Attendance
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
              SECURE INSTITUTION NETWORK ACTIVE
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
              shadowColor: theme.mode === "dark" ? "#000" : "#9FB3CE",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.25,
              shadowRadius: 20,
              elevation: 8,
            },
          ]}
        >
          <Text style={[styles.cardHeaderTitle, { color: theme.text }]}>
            Welcome Back
          </Text>
          <Text
            style={[styles.cardHeaderSubtitle, { color: theme.textSecondary }]}
          >
            Sign in to your campus portal
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
                        borderColor: theme.borderAccent,
                        shadowColor: theme.cyan,
                        shadowOpacity: 0.25,
                        shadowRadius: 6,
                        elevation: 3,
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
                      active && { fontWeight: "800" },
                    ]}
                  >
                    {item.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Username */}
          <View style={styles.formGroup}>
            <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
              IDENTIFIER
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
                name="account-outline"
                size={19}
                color={username.length > 0 ? theme.cyan : theme.muted}
                style={styles.inputPrefixIcon}
              />
              <TextInput
                style={[styles.textInputBox, { color: theme.text }]}
                value={username}
                onChangeText={setUsername}
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* Password */}
          <View style={styles.formGroup}>
            <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
              PASSWORD
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
              <Text style={[styles.errorBannerText, { color: theme.rose }]}>
                {error}
              </Text>
            </View>
          )}

          {/* Sign-In CTA */}
          <Pressable
            style={[
              styles.submitButtonGlow,
              {
                backgroundColor: theme.cyan,
                shadowColor: theme.cyan,
                shadowOffset: { width: 0, height: 6 },
                shadowOpacity: 0.45,
                shadowRadius: 14,
                elevation: 6,
              },
              busy && { opacity: 0.75 },
            ]}
            onPress={submit}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator
                color={theme.mode === "dark" ? "#070B13" : "#FFFFFF"}
              />
            ) : (
              <View style={styles.submitRow}>
                <Text
                  style={[
                    styles.submitTextAction,
                    { color: theme.mode === "dark" ? "#070B13" : "#FFFFFF" },
                  ]}
                >
                  {role === "admin"
                    ? "SIGN IN AS ADMIN"
                    : role === "teacher"
                      ? "SIGN IN AS FACULTY"
                      : "SIGN IN AS STUDENT"}
                </Text>
                <MaterialCommunityIcons
                  name="arrow-right"
                  size={18}
                  color={theme.mode === "dark" ? "#070B13" : "#FFFFFF"}
                />
              </View>
            )}
          </Pressable>

        </View>

        <Text style={[styles.loginFootnote, { color: theme.muted }]}>
          Secure · Verified · Encrypted
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
                  label: "Tailscale Tunnel (Remote)",
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
      return ["Dashboard", "Students", "Teachers", "Academic", "Attendance"];
    }
    if (role === "teacher") {
      return ["Dashboard", "Attendance", "Students", "History", "Profile"];
    }
    return ["Dashboard", "Attendance", "Classes", "Profile"];
  }, [role]);

  const [activeTab, setActiveTab] = useState("Dashboard");
  const [unreadCount, setUnreadCount] = useState(0);
  const screenOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    screenOpacity.setValue(0.96);
    Animated.timing(screenOpacity, {
      toValue: 1,
      duration: 180,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [activeTab, screenOpacity]);

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
    (role === "admin" ? "Admin" : "User");

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
                borderColor: theme.borderAccent,
                shadowColor: theme.cyan,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.35,
                shadowRadius: 6,
                elevation: 3,
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
                  ? "rgba(255,255,255,0.07)"
                  : "rgba(37,99,235,0.08)",
                borderColor: theme.border,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={isDark ? "white-balance-sunny" : "moon-waning-crescent"}
              size={18}
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
                      ? "rgba(255,255,255,0.07)"
                      : "rgba(37,99,235,0.08)",
                borderColor:
                  activeTab === "Alerts" ? theme.borderAccent : theme.border,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={unreadCount > 0 ? "bell-badge-outline" : "bell-outline"}
              size={18}
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
                shadowColor: theme.cyan,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: activeTab === "Profile" ? 0.4 : 0,
                shadowRadius: 6,
                elevation: activeTab === "Profile" ? 4 : 0,
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
        </View>
      </View>

      {/* ── Main Content ── */}
      <ScrollView
        contentContainerStyle={styles.scrollContentBody}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View style={{ opacity: screenOpacity }}>
          <ScreenRenderer
            screen={activeTab}
            role={role}
            user={user}
            go={setActiveTab}
            onLogout={onLogout}
          />
        </Animated.View>
      </ScrollView>

      {/* ── Premium Floating Island Bottom Navigation ── */}
      <View
        style={[
          styles.bottomFloatingIsland,
          {
            backgroundColor: theme.navBg,
            borderColor: theme.borderBright,
            shadowColor: theme.mode === "dark" ? "#000" : "#1E3A8A",
            shadowOffset: { width: 0, height: -2 },
            shadowOpacity: theme.mode === "dark" ? 0.6 : 0.12,
            shadowRadius: 20,
            elevation: 16,
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
                      borderRadius: 14,
                      paddingHorizontal: 14,
                      shadowColor: theme.cyan,
                      shadowOpacity: 0.4,
                      shadowRadius: 8,
                      elevation: 3,
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
                  size={21}
                  color={isActive ? theme.cyan : theme.muted}
                />
              </View>
              <Text
                style={[
                  styles.tabLabelText,
                  {
                    color: isActive ? theme.cyan : theme.muted,
                    fontWeight: isActive ? "800" : "600",
                    letterSpacing: isActive ? 0.2 : 0,
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
    </SafeAreaView>
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

    case "Profile":
      if (role === "admin")
        return <AdminProfile user={user} onLogout={onLogout} />;
      if (role === "teacher")
        return <TeacherProfile user={user} onLogout={onLogout} />;
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
              ATTENDANCE SYSTEM ACTIVE
            </Text>
          </View>
          <Text style={[styles.executiveDateText, { color: theme.muted }]}>
            {todayDate}
          </Text>
        </View>

        <Text style={[styles.executiveHeroHeading, { color: theme.text }]}>
          Campus Academic Overview
        </Text>
        <Text style={[styles.executiveHeroSub, { color: theme.textSecondary }]}>
          Automated face-recognition attendance across all enrolled faculties
        </Text>
      </View>

      {/* 2x2 KPI Grid (Zero Overflow Math) */}
      <Text style={[styles.sectionHeaderTitle, { color: theme.muted }]}>
        CAMPUS PERFORMANCE
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

      {/* Weekly Trend Sparkline */}
      <View
        style={[
          styles.sparklineContainer,
          { backgroundColor: theme.cardGlass, borderColor: theme.border },
        ]}
      >
        <View style={styles.sparklineHeader}>
          <Text style={[styles.sparklineTitle, { color: theme.text }]}>
            Weekly Attendance Fidelity
          </Text>
          <Text style={[styles.sparklineAvg, { color: theme.cyan }]}>
            Overall {attendanceRate}%
          </Text>
        </View>
        <View style={styles.sparklineBarsRow}>
          {[
            { day: "Mon", rate: 88 },
            { day: "Tue", rate: 94 },
            { day: "Wed", rate: 82 },
            { day: "Thu", rate: 91 },
            { day: "Fri", rate: 86 },
          ].map((bar) => (
            <View key={bar.day} style={styles.sparklineCol}>
              <View
                style={[
                  styles.sparklineBarTrack,
                  { backgroundColor: theme.bgElevated },
                ]}
              >
                <View
                  style={[
                    styles.sparklineBarFill,
                    { height: `${bar.rate}%`, backgroundColor: theme.cyan },
                  ]}
                />
              </View>
              <Text style={[styles.sparklineDayLabel, { color: theme.muted }]}>
                {bar.day}
              </Text>
            </View>
          ))}
        </View>
      </View>

      {/* Rapid Commands Grid */}
      <Text style={[styles.sectionHeaderTitle, { color: theme.muted }]}>
        QUICK ACTIONS
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
          RECENT ATTENDANCE
        </Text>
        <Pressable onPress={() => go("Attendance")}>
          <Text style={[styles.viewAllActionText, { color: theme.cyan }]}>
            View All Records
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
            AUTOMATED RECOGNITION READY
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
              shadowColor: theme.cyan,
            },
          ]}
          onPress={() => go("Attendance")}
        >
          <MaterialCommunityIcons
            name="camera-enhance"
            size={20}
            color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
          />
          <Text
            style={[
              styles.teacherLaunchButtonText,
              { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
            ]}
          >
            START ATTENDANCE SESSION
          </Text>
        </Pressable>
      </View>

      {/* Metrics Row */}
      <Text style={[styles.sectionHeaderTitle, { color: theme.muted }]}>
        TODAY'S STATS
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
          TODAY'S CLASSES
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
          Loading Attendance Fidelity...
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
      {/* Concentric Scorecard Holographic Card */}
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
              ATTENDANCE
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
        RECORD BREAKDOWN
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
  const [selectedStudent, setSelectedStudent] = useState<any>(null);
  const [editingStudent, setEditingStudent] = useState<any>(null);

  useEffect(() => {
    http
      .get("/students")
      .then((r) => setStudents(r.data?.students || []))
      .catch(() => setStudents([]))
      .finally(() => setBusy(false));
  }, []);

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

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Students Directory
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            {students.length} students enrolled
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
      ) : visible.length === 0 ? (
        <HoloEmptyState
          icon="account-search-outline"
          title="No students match criteria"
          desc="Try adjusting search query or enroll a new student."
          actionText="Enroll Student"
          onAction={() => go("Add Student")}
        />
      ) : (
        visible.map((student, i) => (
          <Pressable
            key={student.student_id || i}
            style={[
              styles.rosterItemCard,
              { backgroundColor: theme.cardGlass, borderColor: theme.border },
            ]}
            onPress={() => setSelectedStudent(student)}
          >
            <View
              style={[
                styles.rosterAvatarBox,
                { backgroundColor: theme.cyanGlow },
              ]}
            >
              <Text style={[styles.rosterAvatarInitial, { color: theme.cyan }]}>
                {(student.name || "S").charAt(0).toUpperCase()}
              </Text>
            </View>
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
        ))
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
                <View
                  style={[
                    styles.modalAvatarGlow,
                    {
                      backgroundColor: theme.cyanGlow,
                      borderColor: theme.cyan,
                    },
                  ]}
                >
                  <Text
                    style={[styles.modalAvatarGlowText, { color: theme.cyan }]}
                  >
                    {(selectedStudent.name || "S").charAt(0).toUpperCase()}
                  </Text>
                </View>
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
                  <Text style={[styles.modalDismissBtnText, { color: theme.cyan }]}>EDIT</Text>
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

  useEffect(() => {
    http
      .get("/students")
      .then((r) => setStudents(r.data?.students || []))
      .catch(() => setStudents([]))
      .finally(() => setBusy(false));
  }, []);

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
            Students in your assigned courses
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
      ) : visible.length === 0 ? (
        <HoloEmptyState
          icon="account-group"
          title="No roster students match"
          desc="Ensure you are assigned to active academic department sections."
        />
      ) : (
        visible.map((student, i) => (
          <View
            key={student.student_id || i}
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
              <Text style={[styles.rosterAvatarInitial, { color: theme.cyan }]}>
                {(student.name || "S").charAt(0).toUpperCase()}
              </Text>
            </View>
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
        ))
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
            {teachers.length} academic instructors
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
                  <Text style={styles.nativeCaptureButtonText}>TAKE PHOTO & UPLOAD</Text>
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
                  { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
                ]}
              >
                GRANT CAMERA ACCESS
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
                    ANALYZING FACE...
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
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [showDobPicker, setShowDobPicker] = useState(false);
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
      const apiDate = toApiDate(dateOfBirth);
      data.append("date_of_birth", apiDate);
      data.append("password", apiDate || "welcome123");
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
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>ROLL NUMBER</Text>
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

        {/* Date of Birth and Phone */}
        <View style={styles.twoColumnGridRow}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
              DATE OF BIRTH (DD-MM-YYYY)
            </Text>
            <Pressable
              style={[
                styles.textInputHoloPlain,
                {
                  backgroundColor: theme.bgElevated,
                  borderColor: theme.border,
                  justifyContent: "center",
                },
              ]}
              onPress={() => setShowDobPicker(true)}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <Text style={{ color: dateOfBirth ? theme.text : theme.muted }}>
                  {dateOfBirth || "Select date"}
                </Text>
                <MaterialCommunityIcons name="calendar-month-outline" size={19} color={theme.cyan} />
              </View>
            </Pressable>
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={[styles.fieldLabelText, { color: theme.muted }]}>
              PHONE NUMBER
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
              value={phone}
              onChangeText={setPhone}
              placeholderTextColor={theme.muted}
            />
          </View>
        </View>

        {showDobPicker && (
          <DateTimePicker
            value={parseDisplayDate(dateOfBirth)}
            mode="date"
            display="calendar"
            maximumDate={new Date()}
            onChange={(_, selectedDate) => {
              setShowDobPicker(false);
              if (selectedDate) setDateOfBirth(formatDisplayDate(selectedDate));
            }}
          />
        )}

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
    loadAcademicSections()
      .then(setSections)
      .catch(() => setSections([]));
  }, []);

  const createSession = async () => {
    if (!scope?.id || !form.title.trim() || !form.course.trim()) {
      Alert.alert(
        "Complete Details",
        "Please select an academic section and specify course and title.",
      );
      return;
    }
    setBusy(true);
    setUploadProgress(0);
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
        "Session Created",
        "Attendance session created. You may now capture or upload the classroom photo.",
      );
    } catch (e: any) {
      Alert.alert(
        "Error",
        e?.response?.data?.detail || "Could not initialize session.",
      );
    } finally {
      setBusy(false);
    }
  };

  const processPhoto = async (uri: string) => {
    if (!scope?.session_id) {
      Alert.alert("No Session", "Initialize session details first.");
      return;
    }
    setBusy(true);
    try {
      const data = new FormData();
      data.append("session_id", scope.session_id);
      data.append("file", {
        uri,
        name: "classroom-photo.jpg",
        type: "image/jpeg",
      } as any);

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

      go("Recognition Results");
    } catch (e: any) {
      Alert.alert(
        "Processing Failed",
        e?.response?.data?.detail ||
          "Could not process classroom photo. Please retry.",
      );
    } finally {
      setBusy(false);
      setUploadProgress(0);
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
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Take Attendance
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Classroom group photo attendance
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

        <TeacherHierarchyCheckboxes
          selected={[]}
          onChange={() => {}}
          onScopeChange={(next) => {
            setAcademicScope(next);
            const found = sections.find((s) =>
              Object.entries(next).every(
                ([k, v]: any) => !v.length || v.includes(s[k]),
              ),
            );
            if (found) setScope(found);
          }}
        />

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
                ? `${scope.department} • ${scope.program}`
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
                styles.captureHeroBtn,
                { backgroundColor: theme.cyan },
                busy && { opacity: 0.7 },
              ]}
              onPress={takePhoto}
              disabled={busy}
            >
              <MaterialCommunityIcons
                name="camera"
                size={26}
                color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
              />
              <Text
                style={[
                  styles.captureHeroBtnTitle,
                  { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
                ]}
              >
                TAKE CLASS PHOTO
              </Text>
              <Text
                style={[
                  styles.captureHeroBtnSub,
                  {
                    color:
                      theme.mode === "dark"
                        ? "rgba(8,12,20,0.75)"
                        : "rgba(255,255,255,0.85)",
                  },
                ]}
              >
                Capture students with camera
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.galleryHeroBtn,
                {
                  backgroundColor: theme.bgElevated,
                  borderColor: theme.border,
                },
                busy && { opacity: 0.7 },
              ]}
              onPress={pickFromGallery}
              disabled={busy}
            >
              <MaterialCommunityIcons
                name="image-multiple"
                size={24}
                color={theme.text}
              />
              <Text style={[styles.galleryHeroBtnTitle, { color: theme.text }]}>
                UPLOAD FROM GALLERY
              </Text>
              <Text style={[styles.galleryHeroBtnSub, { color: theme.muted }]}>
                Select an existing photo file
              </Text>
            </Pressable>
          </View>
          {busy && uploadProgress > 0 && (
            <UploadDonut progress={uploadProgress} label="UPLOADING CLASS PHOTO" />
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
  const [statusMap, setStatusMap] = useState<
    Record<string, "PRESENT" | "ABSENT">
  >({});
  const [activeFilter, setActiveFilter] = useState<
    "ALL" | "PRESENT" | "ABSENT"
  >("ALL");
  const [sessionId, setSessionId] = useState("");
  const [busy, setBusy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState("");

  const loadData = useCallback(async () => {
      setBusy(true);
      setLoadError("");
      try {
        const storedSession = await AsyncStorage.getItem(
          "active_attendance_session_id",
        );
        const storedResult = await AsyncStorage.getItem(
          "latest_recognition_result",
        );
        let activeId = storedSession || "";
        let recognizedStudents: any[] = [];

        if (storedResult) {
          const parsed = JSON.parse(storedResult);
          recognizedStudents = parsed.students || [];
          if (!activeId && parsed.session_id) activeId = parsed.session_id;
        }

        if (activeId) setSessionId(activeId);

        // Fetch roster from /students
        let roster: any[] = [];
        try {
          const res = await http.get("/students");
          roster = res.data?.students || [];
        } catch {}

        if (roster.length === 0 && recognizedStudents.length > 0) {
          roster = recognizedStudents;
        }

        // Also check attendance report or session attendance if available
        let reportRecords: any[] = [];
        try {
          const rep = await http.get("/teacher/attendance/report");
          reportRecords = rep.data?.records || [];
          if (
            !activeId &&
            reportRecords.length > 0 &&
            reportRecords[0].session_id
          ) {
            setSessionId(reportRecords[0].session_id);
          }
        } catch {}

        if (roster.length === 0) {
          roster = reportRecords;
        }

        const recognizedIds = new Set(
          recognizedStudents.map((s) => s.student_id),
        );
        reportRecords.forEach((r) => {
          if (String(r.status || "").toUpperCase() === "PRESENT")
            recognizedIds.add(r.student_id);
        });

        const initialMap: Record<string, "PRESENT" | "ABSENT"> = {};
        roster.forEach((row: any) => {
          const isPres =
            recognizedIds.has(row.student_id) ||
            String(row.status || "").toUpperCase() === "PRESENT";
          initialMap[row.student_id] = isPres ? "PRESENT" : "ABSENT";
        });

        setItems(roster);
        setStatusMap(initialMap);
      } catch {
        setItems([]);
        setLoadError("Could not load the selected session roster.");
      } finally {
        setBusy(false);
      }
    }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleStatus = (studentId: string) => {
    setStatusMap((prev) => ({
      ...prev,
      [studentId]: prev[studentId] === "PRESENT" ? "ABSENT" : "PRESENT",
    }));
  };

  const markAllPresent = () => {
    const updated: Record<string, "PRESENT" | "ABSENT"> = {};
    items.forEach((r) => (updated[r.student_id] = "PRESENT"));
    setStatusMap(updated);
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
    Alert.alert(
      "Confirm Attendance",
      `Submit attendance for ${items.length} students? Present: ${presentCount}, Absent: ${absentCount}. You can still edit records later from session history.`,
      [
        { text: "Review", style: "cancel" },
        { text: "Submit", onPress: () => submitAttendance(currentSession) },
      ],
    );
  };

  const submitAttendance = async (currentSession: string) => {
    setSubmitting(true);
    try {
      const records = Object.entries(statusMap).map(([student_id, status]) => ({
        student_id,
        status,
      }));

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
        e?.response?.data?.detail || "Could not finalize attendance records.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (busy) {
    return (
      <View style={styles.screenCenterLoader}>
        <ActivityIndicator size="large" color={theme.cyan} />
        <Text style={[styles.loaderSubText, { color: theme.muted }]}>
          Loading Roster Checklist...
        </Text>
      </View>
    );
  }

  const presentCount = Object.values(statusMap).filter(
    (s) => s === "PRESENT",
  ).length;
  const absentCount = Object.values(statusMap).filter(
    (s) => s === "ABSENT",
  ).length;
  const ratio = items.length
    ? Math.round((presentCount / items.length) * 100)
    : 0;

  const filteredItems = useMemo(
    () => items.filter((student) => {
      if (activeFilter === "ALL") return true;
      const currentStatus = statusMap[student.student_id] || "ABSENT";
      return currentStatus === activeFilter;
    }),
    [items, activeFilter, statusMap],
  );

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Verify Roster
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Review and adjust student status
          </Text>
        </View>
      </View>

      {loadError && (
        <View style={[styles.errorBannerBox, { backgroundColor: theme.roseGlow, borderColor: theme.rose }]}>
          <Text style={[styles.errorBannerText, { color: theme.rose }]}>{loadError}</Text>
          <Pressable onPress={loadData}><Text style={{ color: theme.cyan, fontWeight: "800" }}>RETRY</Text></Pressable>
        </View>
      )}

      {/* Roster Ratio & Tally HUD */}
      <View
        style={[
          styles.tallyHUDCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.border },
        ]}
      >
        <Text style={[styles.tallyRatioSubText, { color: theme.cyan, marginBottom: 8 }]}>Selected session roster: {items.length} students</Text>
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
              {absentCount}
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
              {items.length}
            </Text>
            <Text style={[styles.tallyMeta, { color: theme.muted }]}>
              Total
            </Text>
          </View>
        </View>

        {/* Attendance Ratio Bar */}
        <View
          style={[
            styles.tallyProgressBarTrack,
            { backgroundColor: theme.bgElevated },
          ]}
        >
          <View
            style={[
              styles.tallyProgressBarFill,
              { width: `${ratio}%`, backgroundColor: theme.emerald },
            ]}
          />
        </View>
        <Text style={[styles.tallyRatioSubText, { color: theme.muted }]}>
          {ratio}% Recorded Present
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
                onPress={() => setActiveFilter(filterKey)}
              >
                <Text
                  style={[
                    styles.filterSegmentBtnText,
                    { color: active ? theme.cyan : theme.muted },
                    active && { fontWeight: "800" },
                  ]}
                >
                  {filterKey === "ALL"
                    ? `All (${items.length})`
                    : filterKey === "PRESENT"
                      ? `Present (${presentCount})`
                      : `Absent (${absentCount})`}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          style={[
            styles.quickBulkBtn,
            { backgroundColor: theme.bgElevated, borderColor: theme.border },
          ]}
          onPress={markAllPresent}
        >
          <MaterialCommunityIcons
            name="check-all"
            size={16}
            color={theme.cyan}
          />
          <Text style={[styles.quickBulkBtnText, { color: theme.cyan }]}>
            All Present
          </Text>
        </Pressable>
      </View>

      {/* Checklist Rows */}
      {filteredItems.map((student, i) => {
        const currentStatus = statusMap[student.student_id] || "ABSENT";
        const isPresent = currentStatus === "PRESENT";
        return (
          <View
            key={student.student_id || i}
            style={[
              styles.checklistCard,
              { backgroundColor: theme.cardGlass, borderColor: theme.border },
            ]}
          >
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
              <Text
                style={[
                  styles.rosterAvatarInitial,
                  { color: isPresent ? theme.emerald : theme.rose },
                ]}
              >
                {(student.name || "S").charAt(0).toUpperCase()}
              </Text>
            </View>

            <View style={{ flex: 1, paddingHorizontal: 12 }}>
              <Text style={[styles.checkListName, { color: theme.text }]}>
                {student.name || student.student_id}
              </Text>
              <Text style={[styles.checkListId, { color: theme.muted }]}>
                ID: {student.student_id}
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
              onPress={() => toggleStatus(student.student_id)}
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
      })}

      <Pressable
        style={[
          styles.primaryNeonButton,
          { backgroundColor: theme.cyan, marginTop: 22 },
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
            Verified attendance records by date
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
            My Attendance
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Verified personal attendance records
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
          icon="calendar-check-outline"
          title="No sessions recorded yet"
          desc="Your attendance will appear here as soon as instructors record class sessions."
        />
      ) : (
        items.map((sess, i) => {
          const isPresent = String(sess.status).toUpperCase() === "PRESENT";
          return (
            <View
              key={sess.session_id || i}
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
                  {sess.event_date} • {String(sess.starts_at).slice(0, 5)} -{" "}
                  {String(sess.ends_at).slice(0, 5)}
                  {sess.room ? ` • ${sess.room}` : ""}
                </Text>
              </View>
              <HoloStatusPill
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

  const openSession = async (session: any) => {
    setSelectedSession(session);
    setSessionBusy(true);
    try {
      const response = await http.get(`/attendance/${session.session_id}`);
      setSessionStudents(response.data?.students || []);
    } catch {
      setSessionStudents([]);
      Alert.alert("Unable to load session", "Please try again.");
    } finally {
      setSessionBusy(false);
    }
  };

  const updateAttendance = async (student: any, status: string) => {
    try {
      await http.patch(`/attendance/${selectedSession.session_id}/${student.student_id}`, { status });
      setSessionStudents((items) => items.map((item) => item.student_id === student.student_id ? { ...item, status, is_manual_override: true } : item));
    } catch (e: any) {
      Alert.alert("Update failed", e?.response?.data?.detail || "Could not update attendance.");
    }
  };

  useEffect(() => {
    const monthStr = month.toISOString().slice(0, 7);
    setBusy(true);
    http
      .get("/teacher/attendance/report", { params: { month: monthStr } })
      .then((r) =>
        setRecords(Array.isArray(r.data?.records) ? r.data.records : []),
      )
      .catch(() => setRecords([]))
      .finally(() => setBusy(false));
  }, [month]);

  const sessions = useMemo(
    () => Array.from(new Map(records.map((x) => [x.session_id, x])).values()),
    [records],
  );

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Session History
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Review past attendance events
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
          const count = records.filter(
            (r) => r.session_id === sess.session_id,
          ).length;
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
                  {sess.timestamp ? new Date(sess.timestamp).toLocaleDateString() : "Open session details"}
                </Text>
                <Text style={[styles.rosterItemMeta, { color: theme.muted }]}>
                  {count} verified students
                </Text>
              </View>
              <HoloStatusPill label={`${count} students`} tone="info" />
            </Pressable>
          );
        })
      )}

      <Modal visible={!!selectedSession} animationType="slide" onRequestClose={() => setSelectedSession(null)}>
        <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.bg }]}>
          <View style={[styles.modalSheetCard, { flex: 1, backgroundColor: theme.cardGlass, borderColor: theme.borderBright }]}> 
            <View style={styles.modalSheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.modalSheetTitle, { color: theme.text }]}>{selectedSession?.title || selectedSession?.course}</Text>
                <Text style={{ color: theme.muted }}>Tap Present or Absent to save immediately</Text>
              </View>
              <Pressable onPress={() => setSelectedSession(null)}><MaterialCommunityIcons name="close" size={22} color={theme.text} /></Pressable>
            </View>
            {sessionBusy ? <ActivityIndicator color={theme.cyan} style={{ margin: 24 }} /> : (
              <ScrollView>
                {sessionStudents.map((student) => (
                  <View key={student.student_id} style={[styles.rosterItemCard, { backgroundColor: theme.bgElevated, borderColor: theme.border, marginBottom: 8 }]}>
                    <Pressable style={{ flex: 1 }} onPress={() => setSelectedStudent(student)}>
                      <Text style={[styles.rosterItemName, { color: theme.text }]}>{student.name}</Text>
                      <Text style={[styles.rosterItemId, { color: theme.muted }]}>{student.student_id}</Text>
                    </Pressable>
                    <Pressable onPress={() => updateAttendance(student, "PRESENT")} style={{ padding: 8 }}><HoloStatusPill label="Present" tone={student.status === "PRESENT" ? "success" : "neutral"} /></Pressable>
                    <Pressable onPress={() => updateAttendance(student, "ABSENT")} style={{ padding: 8 }}><HoloStatusPill label="Absent" tone={student.status === "ABSENT" ? "danger" : "neutral"} /></Pressable>
                  </View>
                ))}
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
            {role === "admin" && <Pressable style={[styles.primaryNeonButton, { backgroundColor: theme.cyan, marginTop: 20 }]} onPress={() => setEditingStudent(selectedStudent)}><Text style={[styles.primaryNeonButtonText, { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" }]}>EDIT STUDENT DETAILS</Text></Pressable>}
          </ScrollView>
        </SafeAreaView>
      </Modal>
      {role === "admin" && editingStudent && <StudentEditModal visible student={editingStudent} endpoint={`/admin/students/${editingStudent.student_id}`} onClose={() => setEditingStudent(null)} onSaved={(updated) => { setSelectedStudent(updated); setEditingStudent(null); }} />}
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
    const month =
      period === "This Month"
        ? new Date().toISOString().slice(0, 7)
        : undefined;
    setBusy(true);
    http
      .get(
        "/teacher/attendance/report",
        month ? { params: { month } } : undefined,
      )
      .then((r) =>
        setRecords(Array.isArray(r.data?.records) ? r.data.records : []),
      )
      .catch(() => setRecords([]))
      .finally(() => setBusy(false));
  }, [period]);

  const sessions = Array.from(
    new Map(records.map((x) => [x.session_id, x])).values(),
  );
  const uniqueStudents = new Set(records.map((x) => x.student_id)).size;

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Attendance Reports
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Departmental attendance overview
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
                period === tab && { color: theme.cyan, fontWeight: "800" },
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
          value={String(records.length)}
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
              filter === "all" && { color: theme.cyan, fontWeight: "800" },
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
              filter === "unread" && { color: theme.cyan, fontWeight: "800" },
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
            Schools, Faculties, and Departments
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
    <View style={styles.screenLayout}>
      <ProfileHeroCard
        profile={profile}
        role="FACULTY INSTRUCTOR"
        setProfile={setProfile}
      />

      <View
        style={[
          styles.glassFormCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
        ]}
      >
        <Text style={[styles.formGroupHeading, { color: theme.muted }]}>
          ASSIGNED COURSES
        </Text>
        {assignments.length === 0 ? (
          <Text style={[styles.emptySubText, { color: theme.muted }]}>
            No course sections assigned yet.
          </Text>
        ) : (
          assignments.map((item, i) => (
            <View
              key={i}
              style={[
                styles.assignedCourseRow,
                { borderBottomColor: theme.border },
              ]}
            >
              <MaterialCommunityIcons
                name="book-outline"
                size={19}
                color={theme.cyan}
              />
              <View style={{ flex: 1, paddingLeft: 10 }}>
                <Text
                  style={[styles.assignedCourseTitle, { color: theme.text }]}
                >
                  {item.subject}
                </Text>
                <Text style={[styles.assignedCourseSub, { color: theme.muted }]}>
                  {item.students || 0} Students
                </Text>
              </View>
            </View>
          ))
        )}
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
        <Text style={[styles.modalDismissBtnText, { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" }]}>EDIT DETAILS</Text>
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
      const body = new FormData();
      Object.entries(form).forEach(([key, value]) =>
        body.append(key, key === "date_of_birth" ? toApiDate(String(value ?? "")) : String(value ?? "")),
      );
      const response = await http.patch(endpoint, body, {
        headers: { "Content-Type": "multipart/form-data" },
      });
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
              {busy ? <ActivityIndicator color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"} /> : <Text style={[styles.modalDismissBtnText, { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" }]}>SAVE DETAILS</Text>}
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
      style={[
        styles.rapidCmdCardHolo,
        { backgroundColor: theme.cardGlass, borderColor: theme.border },
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
  const [selection, setSelection] = useState<any>({});
  const [modalOpen, setModalOpen] = useState<string | null>(null);

  useEffect(() => {
    loadAcademicSections()
      .then(setSections)
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

  const has = !!selection.school;

  return (
    <View style={{ marginTop: 14 }}>
      <Text style={[styles.formGroupHeading, { color: theme.muted }]}>
        ACADEMIC PLACEMENT
      </Text>
      {renderSelect("School", "school", getOptions("school"))}
      {renderSelect(
        "Faculty",
        "faculty",
        getOptions("faculty", { school: selection.school }),
        !selection.school,
      )}
      {renderSelect(
        "Department",
        "department",
        getOptions("department", {
          school: selection.school,
          faculty: selection.faculty,
        }),
        !selection.faculty,
      )}
      {renderSelect(
        "Program",
        "program",
        getOptions("program", {
          school: selection.school,
          faculty: selection.faculty,
          department: selection.department,
        }),
        !selection.department,
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
  const { theme } = useAppTheme();
  const [sections, setSections] = useState<any[]>([]);
  const [selection, setSelection] = useState<any>({
    school: [],
    faculty: [],
    department: [],
    program: [],
    semester: [],
  });

  useEffect(() => {
    loadAcademicSections()
      .then(setSections)
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
                  isSelected && { fontWeight: "800" },
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
        Select the academic programs this instructor can manage:
      </Text>
      {renderPhase("1. Select School", "school", getOptions("school"))}
      {selection.school.length > 0 &&
        renderPhase(
          "2. Select Faculty",
          "faculty",
          getOptions("faculty", { school: selection.school }),
        )}
      {selection.faculty.length > 0 &&
        renderPhase(
          "3. Select Department",
          "department",
          getOptions("department", {
            school: selection.school,
            faculty: selection.faculty,
          }),
        )}
      {selection.department.length > 0 &&
        renderPhase(
          "4. Select Program",
          "program",
          getOptions("program", {
            school: selection.school,
            faculty: selection.faculty,
            department: selection.department,
          }),
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
    padding: 32,
    borderRadius: 28,
    borderWidth: 1,
  },
  splashLogo: {
    width: 88,
    height: 88,
    borderRadius: 22,
  },
  splashPulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 18,
    marginBottom: 6,
  },
  splashTitle: {
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 2,
  },
  splashSubtitle: {
    fontSize: 12,
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
    fontWeight: "600",
  },

  // LOGIN SCREEN
  loginAmbientCircle: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    top: -60,
    alignSelf: "center",
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
    borderRadius: 20,
    borderWidth: 1,
    gap: 6,
  },
  themePillText: {
    fontSize: 12,
    fontWeight: "700",
  },
  loginBrandHeader: {
    alignItems: "center",
    marginBottom: 28,
  },
  loginLogoRingWrap: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  loginLogoRingOuter: {
    position: "absolute",
    width: 110,
    height: 110,
    borderRadius: 55,
    borderWidth: 1,
    opacity: 0.4,
  },
  loginBrandTagline: {
    fontSize: 13,
    marginTop: 2,
    marginBottom: 4,
    fontWeight: "500",
    letterSpacing: 0.2,
  },
  brandStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  logoBadgeCard: {
    width: 90,
    height: 90,
    borderRadius: 28,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  loginLogo: {
    width: 74,
    height: 74,
    borderRadius: 22,
  },
  brandTitleText: {
    fontSize: 32,
    fontWeight: "900",
    marginTop: 16,
    letterSpacing: 1.5,
  },
  brandStatusTag: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    marginTop: 8,
    gap: 6,
    borderWidth: 1,
  },
  brandStatusTagText: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  loginSurfaceCard: {
    width: "100%",
    borderRadius: 28,
    padding: 24,
    borderWidth: 1,
  },
  cardHeaderTitle: {
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  cardHeaderSubtitle: {
    fontSize: 13,
    marginTop: 4,
    marginBottom: 18,
  },
  roleTabsWrap: {
    flexDirection: "row",
    borderRadius: 14,
    padding: 4,
    marginBottom: 18,
  },
  roleTabItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 9,
    borderRadius: 10,
    gap: 6,
  },
  roleTabItemActive: {
    borderWidth: 1,
  },
  roleTabLabel: {
    fontSize: 12,
    fontWeight: "700",
  },
  formGroup: {
    marginBottom: 15,
  },
  fieldLabelText: {
    fontSize: 11,
    fontWeight: "800",
    marginBottom: 6,
    letterSpacing: 0.8,
  },
  inputContainerBox: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 48,
  },
  inputPrefixIcon: {
    marginRight: 8,
  },
  textInputBox: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
  },
  textInputHoloPlain: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 46,
    fontSize: 14,
    fontWeight: "600",
  },
  eyeBtn: {
    padding: 6,
  },
  errorBannerBox: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    marginBottom: 14,
    gap: 8,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  submitButtonGlow: {
    height: 50,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 4,
  },
  submitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  submitTextAction: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  demoPresetsBox: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    alignItems: "center",
  },
  demoPresetsTitle: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 10,
  },
  demoChipsRow: {
    flexDirection: "row",
    gap: 8,
  },
  demoChipPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  demoChipPillText: {
    fontSize: 11,
    fontWeight: "800",
  },
  loginFootnote: {
    marginTop: 22,
    fontSize: 11,
    textAlign: "center",
  },

  // TOP BAR
  topGlassBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  topBarLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  brandBadgeWrap: {
    width: 40,
    height: 40,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  brandThumbLogo: {
    width: 28,
    height: 28,
    borderRadius: 7,
  },
  brandNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  brandHeaderTitle: {
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.2,
  },
  roleChipPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  roleChipText: {
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  greetingHeaderSub: {
    fontSize: 11,
    fontWeight: "600",
  },
  topBarRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  topIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    position: "relative",
  },
  badgeDotGlow: {
    position: "absolute",
    top: 7,
    right: 7,
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  topAvatarPill: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    overflow: "hidden",
  },
  avatarImg: {
    width: "100%",
    height: "100%",
  },
  avatarInitialText: {
    fontSize: 14,
    fontWeight: "900",
  },

  // SCROLL CONTENT & FLOATING ISLAND
  scrollContentBody: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 110, // Generous clearance for floating island nav
  },
  bottomFloatingIsland: {
    position: "absolute",
    bottom: Platform.OS === "ios" ? 20 : 12,
    left: 16,
    right: 16,
    borderRadius: 28,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 10,
  },
  bottomTabButton: {
    flex: 1,
    alignItems: "center",
  },
  tabIconContainer: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
  },
  tabIconContainerActive: {},
  tabLabelText: {
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },

  // SCREEN COMMONS
  screenLayout: {
    gap: 18,
  },
  screenTopHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  screenMainTitle: {
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.7,
  },
  screenSubTitle: {
    fontSize: 13,
    marginTop: 2,
  },
  screenAddButtonMini: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    gap: 4,
  },
  screenAddBtnMiniText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  sectionHeaderTitle: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1,
    marginTop: 6,
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 6,
  },
  viewAllActionText: {
    fontSize: 12,
    fontWeight: "800",
  },

  // EXECUTIVE HERO CARDS
  executiveHeroCard: {
    position: "relative",
    borderRadius: 26,
    padding: 20,
    borderWidth: 1,
    shadowColor: "#18375C",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 3,
  },
  heroAccentBar: {
    position: "absolute",
    left: 0,
    top: 18,
    bottom: 18,
    width: 3,
    borderRadius: 2,
    opacity: 0.9,
  },
  executiveHeroHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  executiveStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
    gap: 6,
    borderWidth: 1,
  },
  pulseLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  executiveStatusText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  executiveDateText: {
    fontSize: 11,
    fontWeight: "700",
  },
  executiveHeroHeading: {
    fontSize: 19,
    fontWeight: "900",
  },
  executiveHeroSub: {
    fontSize: 12,
    marginTop: 3,
    lineHeight: 16,
  },

  teacherHeroBanner: {
    borderRadius: 26,
    padding: 20,
    borderWidth: 1,
  },
  teacherHeroPillRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    alignSelf: "flex-start",
    marginBottom: 10,
    gap: 6,
    borderWidth: 1,
  },
  teacherHeroPillText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  teacherHeroMainHeading: {
    fontSize: 21,
    fontWeight: "900",
  },
  teacherHeroDescription: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 17,
    marginBottom: 16,
  },
  teacherLaunchButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 48,
    borderRadius: 13,
    gap: 8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 4,
  },
  teacherLaunchButtonText: {
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.6,
  },

  // KPI GRID
  kpiGridMatrix: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  kpiCardHolo: {
    width: CARD_GRID_WIDTH,
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
    shadowColor: "#173458",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 2,
  },
  kpiIconBadgeHolo: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  kpiValueHolo: {
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  kpiLabelHolo: {
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  kpiDeltaHolo: {
    fontSize: 10,
    marginTop: 2,
  },

  // SPARKLINES
  sparklineContainer: {
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    shadowColor: "#173458",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
  },
  sparklineHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  sparklineTitle: {
    fontSize: 13,
    fontWeight: "800",
  },
  sparklineAvg: {
    fontSize: 12,
    fontWeight: "800",
  },
  sparklineBarsRow: {
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "flex-end",
    height: 70,
  },
  sparklineCol: {
    alignItems: "center",
    gap: 6,
  },
  sparklineBarTrack: {
    width: 22,
    height: 50,
    borderRadius: 6,
    justifyContent: "flex-end",
    overflow: "hidden",
  },
  sparklineBarFill: {
    borderRadius: 6,
  },
  sparklineDayLabel: {
    fontSize: 10,
    fontWeight: "700",
  },

  // RAPID COMMANDS
  rapidCommandsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  rapidCmdCardHolo: {
    width: CARD_GRID_WIDTH,
    borderRadius: 22,
    padding: 16,
    borderWidth: 1,
  },
  rapidCmdIconBadge: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  rapidCmdTitleHolo: {
    fontSize: 13,
    fontWeight: "800",
  },
  rapidCmdDescHolo: {
    fontSize: 11,
    marginTop: 2,
  },

  // STREAM & ROSTER CARDS
  streamEventCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
  },
  streamIconCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  streamItemTitle: {
    fontSize: 13,
    fontWeight: "800",
  },
  streamItemSub: {
    fontSize: 11,
    marginTop: 2,
  },
  rosterItemCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 19,
    padding: 15,
    borderWidth: 1,
  },
  rosterAvatarBox: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  rosterAvatarInitial: {
    fontSize: 16,
    fontWeight: "900",
  },
  rosterItemName: {
    fontSize: 14,
    fontWeight: "800",
  },
  rosterItemId: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
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
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 46,
  },
  searchInputHolo: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    marginLeft: 8,
  },
  filterToggleBox: {
    width: 46,
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  filterDrawerCard: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
  },

  // GLASS FORM CARDS
  glassFormCard: {
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
  },
  formGroupHeading: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1,
    marginBottom: 12,
  },
  formTopHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  backBtnCircle: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  formActionButtonsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
  },
  formCancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 13,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  formCancelBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  formSubmitBtn: {
    flex: 2,
    height: 48,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 3,
  },
  formSubmitBtnText: {
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.6,
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
    borderRadius: 16,
    padding: 16,
    borderWidth: 1.5,
    borderStyle: "dashed",
    marginTop: 4,
    marginBottom: 8,
  },
  biometricIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  biometricCardTitle: {
    fontSize: 14,
    fontWeight: "800",
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
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  hudStepBadgeText: {
    fontSize: 11,
    fontWeight: "800",
  },
  hudCameraViewport: {
    backgroundColor: "#000",
    borderRadius: 24,
    overflow: "hidden",
    height: 380,
    borderWidth: 1.5,
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
    borderColor: "rgba(0, 229, 255, 0.4)",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  hudBiometricEllipseDone: {
    borderStyle: "solid",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 16,
  },
  hudBiometricEllipseScanning: {},
  liveFaceBoundingBox: {
    position: "absolute",
    borderWidth: 3,
    borderColor: "#22C55E",
    borderRadius: 12,
    shadowColor: "#22C55E",
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 8,
  },
  animatedLaserLine: {
    position: "absolute",
    width: "100%",
    height: 2.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 4,
  },
  hudLiveTelemetryBar: {
    position: "absolute",
    bottom: 16,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(8, 12, 20, 0.9)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
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
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  hudInstructionCard: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
  },
  hudInstructionTitle: {
    fontSize: 15,
    fontWeight: "900",
  },
  hudInstructionDesc: {
    fontSize: 12,
    marginTop: 4,
    lineHeight: 16,
    marginBottom: 14,
  },
  hudForceCaptureBtn: {
    height: 46,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  hudForceCaptureBtnText: {
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  permCardHolo: {
    borderRadius: 22,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
  },
  permTitleHolo: {
    fontSize: 17,
    fontWeight: "900",
    marginTop: 14,
  },
  permDescHolo: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 18,
    lineHeight: 17,
  },

  // SECTION SELECTION & ACTIONS
  sectionSelectedCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
  },
  sectionSelectedTitle: {
    fontSize: 13,
    fontWeight: "800",
  },
  sectionSelectedSub: {
    fontSize: 11,
    marginTop: 1,
  },
  dualPhotoActionsCol: {
    gap: 12,
  },
  captureHeroBtn: {
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  captureHeroBtnTitle: {
    fontSize: 14,
    fontWeight: "900",
    marginTop: 6,
    letterSpacing: 0.6,
  },
  captureHeroBtnSub: {
    fontSize: 11,
    marginTop: 2,
    fontWeight: "600",
  },
  galleryHeroBtn: {
    borderRadius: 16,
    padding: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  galleryHeroBtnTitle: {
    fontSize: 14,
    fontWeight: "900",
    marginTop: 6,
    letterSpacing: 0.6,
  },
  galleryHeroBtnSub: {
    fontSize: 11,
    marginTop: 2,
  },

  // RECOGNITION RESULTS
  resultsNoticeBox: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    padding: 12,
    gap: 8,
    borderWidth: 1,
  },
  resultsNoticeText: {
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 15,
  },
  resultsCardsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  resultItemCardHolo: {
    width: CARD_GRID_WIDTH,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  resultAvatarCircleHolo: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  resultItemNameText: {
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  resultItemIdText: {
    fontSize: 10,
    marginTop: 1,
    marginBottom: 8,
  },

  // VERIFY & ROSTER TOOLBAR
  tallyHUDCard: {
    borderRadius: 18,
    padding: 16,
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
    fontWeight: "900",
  },
  tallyMeta: {
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  tallyDividerLine: {
    width: 1,
    height: 30,
  },
  tallyProgressBarTrack: {
    height: 6,
    borderRadius: 3,
    overflow: "hidden",
    marginTop: 14,
    marginBottom: 6,
  },
  tallyProgressBarFill: {
    height: "100%",
    borderRadius: 3,
  },
  tallyRatioSubText: {
    fontSize: 10,
    textAlign: "center",
    fontWeight: "700",
  },
  verifyToolbarRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  filterSegmentPillWrap: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 3,
  },
  filterSegmentBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 9,
  },
  filterSegmentBtnActive: {
    borderWidth: 1,
  },
  filterSegmentBtnText: {
    fontSize: 11,
    fontWeight: "700",
  },
  quickBulkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  quickBulkBtnText: {
    fontSize: 11,
    fontWeight: "800",
  },
  checklistCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
  },
  checkListName: {
    fontSize: 13,
    fontWeight: "800",
  },
  checkListId: {
    fontSize: 11,
    marginTop: 1,
  },
  togglePillHolo: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    gap: 4,
    borderWidth: 1,
  },
  togglePillHoloPresent: {},
  togglePillHoloAbsent: {},
  togglePillHoloText: {
    fontSize: 11,
    fontWeight: "900",
  },

  // STUDENT SCORECARD
  studentScorecardGlass: {
    borderRadius: 22,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    gap: 18,
  },
  radialDialContainer: {
    alignItems: "center",
    justifyContent: "center",
  },
  radialDialOuterRing: {
    width: 92,
    height: 92,
    borderRadius: 46,
    borderWidth: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  radialDialPercent: {
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  radialDialTitle: {
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  studentCardHeading: {
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 6,
  },
  studentDegreeText: {
    fontSize: 11,
    marginTop: 6,
  },
  studentBreakdownGrid: {
    flexDirection: "row",
    gap: 10,
  },
  studentBreakdownBox: {
    flex: 1,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    alignItems: "center",
  },
  studentBreakdownVal: {
    fontSize: 20,
    fontWeight: "900",
  },
  studentBreakdownLbl: {
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
  },
  primaryNeonButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: 48,
    borderRadius: 13,
    gap: 8,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 10,
    elevation: 3,
  },
  primaryNeonButtonText: {
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.6,
  },

  // SCHEDULE & TIMETABLE
  scheduleRowCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
  },
  scheduleTimeBadge: {
    borderRadius: 10,
    paddingHorizontal: 9,
    paddingVertical: 7,
    alignItems: "center",
    borderWidth: 1,
  },
  scheduleTimeStart: {
    fontSize: 12,
    fontWeight: "900",
  },
  scheduleTimeFinish: {
    fontSize: 10,
    marginTop: 1,
  },
  scheduleLectureTitle: {
    fontSize: 13,
    fontWeight: "800",
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
    borderRadius: 8,
    borderWidth: 1,
  },
  roomTagHoloText: {
    fontSize: 10,
    fontWeight: "800",
  },
  teacherMetricsRow: {
    flexDirection: "row",
    gap: 10,
  },
  teacherMetricBox: {
    flex: 1,
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  teacherMetricDigit: {
    fontSize: 18,
    fontWeight: "900",
    marginTop: 4,
  },
  teacherMetricLabel: {
    fontSize: 10,
    fontWeight: "700",
    marginTop: 2,
    textAlign: "center",
  },

  // STUDENT SESSION CARDS
  studentSessionCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
  },
  studentSessionIconBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  studentSessionTitle: {
    fontSize: 13,
    fontWeight: "800",
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
    borderRadius: 14,
    padding: 13,
    borderWidth: 1,
    justifyContent: "space-between",
  },
  datePickerCardText: {
    fontSize: 13,
    fontWeight: "800",
    flex: 1,
    paddingLeft: 10,
  },

  // SEGMENTED CONTROLS
  segmentWrapHolo: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 4,
  },
  segmentBtnHolo: {
    flex: 1,
    paddingVertical: 8,
    alignItems: "center",
    borderRadius: 9,
  },
  segmentBtnHoloActive: {
    borderWidth: 1,
  },
  segmentBtnHoloText: {
    fontSize: 11,
    fontWeight: "700",
  },

  // NOTIFICATIONS
  markAllBtnHolo: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  markAllBtnHoloText: {
    fontSize: 10,
    fontWeight: "800",
  },
  notifCardHolo: {
    flexDirection: "row",
    alignItems: "flex-start",
    borderRadius: 15,
    padding: 13,
    borderWidth: 1,
  },
  notifIconCircleHolo: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  notifTitleHolo: {
    fontSize: 13,
    fontWeight: "800",
  },
  notifBodyHolo: {
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
  notifTimeHolo: {
    fontSize: 9,
    marginTop: 4,
  },
  unreadDotHolo: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    marginTop: 4,
  },

  // ACADEMIC HIERARCHY
  hierarchyBranchCard: {
    borderRadius: 16,
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
    fontWeight: "900",
  },
  hierarchyCountPill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  hierarchyCountPillText: {
    fontSize: 10,
    fontWeight: "800",
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
    fontWeight: "800",
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
    fontWeight: "700",
  },
  hierarchyProgName: {
    fontSize: 10,
  },

  // PROFILE SCREENS
  profileHeroCardHolo: {
    borderRadius: 24,
    padding: 22,
    alignItems: "center",
    borderWidth: 1,
  },
  profileAvatarWrapHolo: {
    position: "relative",
    marginBottom: 12,
  },
  profileAvatarImgHolo: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 2,
  },
  profileAvatarFallbackHolo: {
    width: 82,
    height: 82,
    borderRadius: 41,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  profileAvatarFallbackInitial: {
    fontSize: 30,
    fontWeight: "900",
  },
  avatarEditPillHolo: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  profileHeroNameHolo: {
    fontSize: 19,
    fontWeight: "900",
  },
  profileRoleBadgeHolo: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 5,
    borderWidth: 1,
  },
  profileRoleBadgeText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  profileHeroEmailHolo: {
    fontSize: 12,
    marginTop: 5,
  },
  assignedCourseRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  assignedCourseTitle: {
    fontSize: 13,
    fontWeight: "800",
  },
  assignedCourseSub: {
    fontSize: 11,
    marginTop: 1,
  },
  signOutBtnHolo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    height: 48,
    gap: 8,
    borderWidth: 1,
  },
  signOutBtnHoloText: {
    fontSize: 13,
    fontWeight: "900",
  },

  // COMMON HELPERS & MODALS
  statusPillHolo: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    alignSelf: "flex-start",
  },
  statusPillHoloText: {
    fontSize: 10,
    fontWeight: "800",
  },
  holoDetailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  holoDetailLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  holoDetailValue: {
    fontSize: 12,
    fontWeight: "800",
  },
  emptyCardHolo: {
    borderRadius: 20,
    padding: 28,
    alignItems: "center",
    borderWidth: 1,
    marginVertical: 10,
  },
  emptyIconBadgeHolo: {
    width: 60,
    height: 60,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emptyTitleHolo: {
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  emptyDescHolo: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 5,
    lineHeight: 16,
  },
  emptyActionBtnHolo: {
    marginTop: 14,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 11,
  },
  emptyActionBtnHoloText: {
    fontSize: 12,
    fontWeight: "900",
  },
  selectTriggerHolo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    height: 46,
  },
  selectTriggerHoloDisabled: {
    opacity: 0.5,
  },
  selectTriggerHoloText: {
    fontSize: 13,
    fontWeight: "700",
  },
  applyFilterBtnHolo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    height: 42,
    gap: 6,
    marginTop: 12,
  },
  applyFilterBtnHoloText: {
    fontSize: 12,
    fontWeight: "900",
  },

  // MODAL OVERLAYS
  modalBackdropOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  modalSheetCard: {
    width: "100%",
    borderRadius: 24,
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
    fontWeight: "900",
  },
  modalProfileHero: {
    alignItems: "center",
    marginBottom: 14,
  },
  modalAvatarGlow: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    borderWidth: 1,
  },
  modalAvatarGlowText: {
    fontSize: 24,
    fontWeight: "900",
  },
  modalHeroName: {
    fontSize: 17,
    fontWeight: "900",
  },
  modalIdBadge: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 8,
    marginTop: 5,
    borderWidth: 1,
  },
  modalIdBadgeText: {
    fontSize: 10,
    fontWeight: "900",
  },
  modalDetailsGroup: {
    marginBottom: 16,
  },
  modalDismissBtn: {
    height: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalDismissBtnText: {
    fontSize: 13,
    fontWeight: "900",
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
    borderRadius: 12,
    height: 44,
    gap: 6,
    borderWidth: 1,
  },
  modalDangerBtnText: {
    fontSize: 12,
    fontWeight: "900",
  },
  modalDismissBtnFlex: {
    flex: 1,
    borderRadius: 12,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },

  // DROPDOWNS & HIERARCHY SCOPES
  dropdownModalHolo: {
    width: "100%",
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
  },
  dropdownModalTitle: {
    fontSize: 15,
    fontWeight: "900",
    marginBottom: 12,
  },
  dropdownOptionHolo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  dropdownOptionTextHolo: {
    fontSize: 13,
    fontWeight: "700",
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
    fontWeight: "800",
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
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 5,
    borderWidth: 1,
  },
  phasePillChipActive: {},
  phasePillText: {
    fontSize: 11,
    fontWeight: "700",
  },
  readOnlyTagPill: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
    borderWidth: 1,
  },
  readOnlyTagText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.6,
  },
  reportSessionItemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 9,
    borderBottomWidth: 1,
  },
  reportSessionIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  reportSessionItemTitle: {
    fontSize: 13,
    fontWeight: "800",
  },
  reportSessionItemSub: {
    fontSize: 10,
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
    fontSize: 17,
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
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    marginBottom: 24,
  },
  nativeCaptureTitle: {
    fontSize: 22,
    fontWeight: "800",
    marginBottom: 10,
  },
  nativeCaptureText: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    maxWidth: 310,
    marginBottom: 28,
  },
  nativeCaptureButton: {
    minWidth: 250,
    height: 54,
    borderRadius: 27,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  nativeCaptureButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  nativeCaptureStatus: {
    textAlign: "center",
    marginTop: 20,
    fontSize: 13,
    lineHeight: 19,
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
    color: "rgba(255, 255, 255, 0.75)",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
    marginTop: 14,
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
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderTopWidth: 1,
  },
  cameraFlipBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    zIndex: 10,
  },
  galleryIconBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  shutterOuterRing: {
    minWidth: 174,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1D4ED8",
  },
  captureButtonContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  captureButtonLabel: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  inViewCaptureButton: {
    position: "absolute",
    left: 42,
    right: 42,
    bottom: 24,
    height: 54,
    borderRadius: 27,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    zIndex: 30,
    elevation: 10,
  },
  inViewCaptureButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  biometricPreviewContainer: {
    flex: 1,
    padding: 20,
    justifyContent: "center",
  },
  biometricPreviewCard: {
    borderRadius: 16,
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
  },
  biometricVerifiedText: {
    fontSize: 12,
    fontWeight: "700",
  },
  biometricStatusBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 14,
  },
  biometricStatusBoxText: {
    fontSize: 13,
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
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
  },
  biometricRetakeBtnText: {
    fontSize: 14,
    fontWeight: "600",
  },
  biometricConfirmBtn: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
  },
  biometricConfirmBtnText: {
    fontSize: 14,
    fontWeight: "700",
  },
  photoVerifiedCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  photoVerifiedThumb: {
    width: 60,
    height: 60,
    borderRadius: 10,
  },
  verifiedRow: {
    flex: 1,
  },
  verifiedTitle: {
    fontSize: 14,
    fontWeight: "700",
  },
  verifiedSub: {
    fontSize: 12,
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
    fontSize: 12,
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
    fontWeight: "700",
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
    fontWeight: "700",
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
    borderRadius: 12,
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
    width: 52,
    height: 52,
    borderRadius: 8,
    overflow: "hidden",
    borderWidth: 1,
  },
  capturedThumbImg: {
    width: "100%",
    height: "100%",
  },
  secondaryHoloButton: {
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryHoloButtonText: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
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
    fontWeight: "800",
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  metricCardValue: {
    fontSize: 20,
    fontWeight: "900",
  },
  serverPillBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
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
    fontWeight: "600",
  },
});
