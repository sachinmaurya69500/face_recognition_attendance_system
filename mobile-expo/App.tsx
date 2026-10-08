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

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
const CARD_GRID_WIDTH = (SCREEN_WIDTH - 32 - 12) / 2; // Exact 2-column mathematical grid
const STATUS_BAR_HEIGHT = Platform.OS === "android" ? (RNStatusBar.currentHeight ?? 24) : 0;

// ---------------------------------------------------------------------------
// DUAL-ENGINE THEME PALETTES (MIDNIGHT COSMOS DARK  +  CLOUD ATLAS LIGHT)
// ---------------------------------------------------------------------------
export const darkTheme = {
  mode: "dark" as const,
  bg: "#070B13",
  bgElevated: "#0C1422",
  card: "#101E35",
  cardGlass: "rgba(14, 24, 48, 0.92)",
  cardSubtle: "#090F1E",
  cardHover: "#152240",
  divider: "rgba(255,255,255,0.06)",
  border: "rgba(255, 255, 255, 0.07)",
  borderBright: "rgba(255, 255, 255, 0.14)",
  borderAccent: "rgba(99, 179, 237, 0.38)",
  cyan: "#63B3ED",
  cyanGlow: "rgba(99, 179, 237, 0.18)",
  cyanStrong: "#90CDF4",
  blue: "#4C9BE8",
  blueDark: "#1A365D",
  blueGlow: "rgba(76, 155, 232, 0.18)",
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
  bg: "#F0F4F8",
  bgElevated: "#FFFFFF",
  card: "#FFFFFF",
  cardGlass: "rgba(255, 255, 255, 0.96)",
  cardSubtle: "#EBF4FF",
  cardHover: "#DBEAFE",
  divider: "rgba(0,0,0,0.05)",
  border: "#E2ECF5",
  borderBright: "#BDD0EA",
  borderAccent: "rgba(37, 99, 235, 0.28)",
  cyan: "#2563EB",
  cyanGlow: "rgba(37, 99, 235, 0.10)",
  cyanStrong: "#1D4ED8",
  blue: "#2563EB",
  blueDark: "#1E3A8A",
  blueGlow: "rgba(37, 99, 235, 0.10)",
  amber: "#D97706",
  amberGlow: "rgba(217, 119, 6, 0.10)",
  emerald: "#059669",
  emeraldGlow: "rgba(5, 150, 105, 0.10)",
  rose: "#DC2626",
  roseGlow: "rgba(220, 38, 38, 0.10)",
  purple: "#7C3AED",
  purpleGlow: "rgba(124, 58, 237, 0.10)",
  gold: "#B7791F",
  goldGlow: "rgba(183, 121, 31, 0.10)",
  text: "#1A202C",
  textSecondary: "#4A5568",
  muted: "#A0AEC0",
  navBg: "rgba(240, 244, 248, 0.97)",
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

type Role = "admin" | "teacher" | "student";

const API =
  process.env.EXPO_PUBLIC_API_URL || "https://anotherearth.taila10c0b.ts.net";
const http = axios.create({ baseURL: API });

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
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    // Load persisted theme preference
    AsyncStorage.getItem("pratyaksh_theme").then((savedTheme) => {
      if (savedTheme === "light") setIsDark(false);
      else if (savedTheme === "dark") setIsDark(true);
    });

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
      <SafeAreaView style={[styles.splashContainer, { backgroundColor: theme.bg }]}>
        <StatusBar style={theme.statusBarStyle} />
        <View style={[styles.splashGlowBg, { backgroundColor: theme.cyanGlow }]} />
        <View
          style={[
            styles.splashCard,
            { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
          ]}
        >
          <Image
            source={require("./assets/pratyaksha-logo.jpg")}
            style={styles.splashLogo}
            resizeMode="contain"
          />
          <View style={[styles.splashPulseDot, { backgroundColor: theme.cyan }]} />
          <Text style={[styles.splashTitle, { color: theme.text }]}>PRATYAKSH</Text>
          <Text style={[styles.splashSubtitle, { color: theme.muted }]}>
            AI Academic Attendance System
          </Text>
          <ActivityIndicator size="large" color={theme.cyan} style={{ marginTop: 24 }} />
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
          "Authentication failed. Please verify your credentials."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.bg, paddingTop: STATUS_BAR_HEIGHT }]}>
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
            style={[
              styles.themePillBtn,
              {
                backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(37,99,235,0.08)",
                borderColor: theme.border,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={isDark ? "white-balance-sunny" : "moon-waning-crescent"}
              size={17}
              color={isDark ? theme.amber : theme.blue}
            />
            <Text style={[styles.themePillText, { color: theme.textSecondary }]}>
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
          <Text style={[styles.loginBrandTagline, { color: theme.textSecondary }]}>
            Intelligent Academic Attendance
          </Text>

          {/* Status Badge */}
          <View
            style={[
              styles.brandStatusTag,
              { backgroundColor: theme.cyanGlow, borderColor: theme.borderAccent },
            ]}
          >
            <View style={[styles.brandStatusDot, { backgroundColor: theme.cyan }]} />
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
          <Text style={[styles.cardHeaderTitle, { color: theme.text }]}>Welcome Back</Text>
          <Text style={[styles.cardHeaderSubtitle, { color: theme.textSecondary }]}>
            Sign in to your campus portal
          </Text>

          {/* Role Selector */}
          <View style={[styles.roleTabsWrap, { backgroundColor: theme.bgElevated }]}>
            {(
              [
                { id: "admin", label: "Admin", icon: "shield-crown-outline" },
                { id: "teacher", label: "Faculty", icon: "teach" },
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
            <Text style={[styles.fieldLabelText, { color: theme.muted }]}>IDENTIFIER</Text>
            <View
              style={[
                styles.inputContainerBox,
                {
                  backgroundColor: theme.bgElevated,
                  borderColor: username.length > 0 ? theme.borderAccent : theme.border,
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
                placeholder="Username or student ID"
                placeholderTextColor={theme.muted}
                autoCapitalize="none"
              />
            </View>
          </View>

          {/* Password */}
          <View style={styles.formGroup}>
            <Text style={[styles.fieldLabelText, { color: theme.muted }]}>PASSWORD</Text>
            <View
              style={[
                styles.inputContainerBox,
                {
                  backgroundColor: theme.bgElevated,
                  borderColor: password.length > 0 ? theme.borderAccent : theme.border,
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
                placeholder="Enter your password"
                placeholderTextColor={theme.muted}
              />
              <Pressable onPress={() => setShowPassword((v) => !v)} style={styles.eyeBtn}>
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
              <MaterialCommunityIcons name="alert-circle-outline" size={17} color={theme.rose} />
              <Text style={[styles.errorBannerText, { color: theme.rose }]}>{error}</Text>
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
              <ActivityIndicator color={theme.mode === "dark" ? "#070B13" : "#FFFFFF"} />
            ) : (
              <View style={styles.submitRow}>
                <Text
                  style={[
                    styles.submitTextAction,
                    { color: theme.mode === "dark" ? "#070B13" : "#FFFFFF" },
                  ]}
                >
                  {role === "admin" ? "SIGN IN AS ADMIN" : role === "teacher" ? "SIGN IN AS FACULTY" : "SIGN IN AS STUDENT"}
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
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.bg, paddingTop: STATUS_BAR_HEIGHT }]}>
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
                  { backgroundColor: theme.cyanGlow, borderColor: theme.borderAccent },
                ]}
              >
                <Text style={[styles.roleChipText, { color: theme.cyan }]}>
                  {role === "admin" ? "ADMIN" : role === "teacher" ? "FACULTY" : "STUDENT"}
                </Text>
              </View>
            </View>
            <Text style={[styles.greetingHeaderSub, { color: theme.textSecondary }]}>
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
                backgroundColor: isDark ? "rgba(255,255,255,0.07)" : "rgba(37,99,235,0.08)",
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
            style={[
              styles.topIconBtn,
              {
                backgroundColor: activeTab === "Alerts"
                  ? theme.cyanGlow
                  : isDark ? "rgba(255,255,255,0.07)" : "rgba(37,99,235,0.08)",
                borderColor: activeTab === "Alerts" ? theme.borderAccent : theme.border,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={unreadCount > 0 ? "bell-badge-outline" : "bell-outline"}
              size={18}
              color={activeTab === "Alerts" ? theme.cyan : unreadCount > 0 ? theme.amber : theme.textSecondary}
            />
            {unreadCount > 0 && (
              <View
                style={[
                  styles.badgeDotGlow,
                  { backgroundColor: theme.rose, borderColor: theme.bg, borderWidth: 1.5 },
                ]}
              />
            )}
          </Pressable>

          {/* Avatar */}
          <Pressable
            onPress={() => setActiveTab("Profile")}
            style={[
              styles.topAvatarPill,
              {
                backgroundColor: activeTab === "Profile" ? theme.cyanGlow : theme.card,
                borderColor: activeTab === "Profile" ? theme.cyan : theme.borderBright,
                shadowColor: theme.cyan,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: activeTab === "Profile" ? 0.4 : 0,
                shadowRadius: 6,
                elevation: activeTab === "Profile" ? 4 : 0,
              },
            ]}
          >
            {user.profile_photo_base64 ? (
              <Image source={{ uri: user.profile_photo_base64 }} style={styles.avatarImg} />
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
        <ScreenRenderer
          screen={activeTab}
          role={role}
          user={user}
          go={setActiveTab}
          onLogout={onLogout}
        />
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
          const iconInfo = getTabIcon(tabName, role);
          return (
            <Pressable
              key={tabName}
              onPress={() => setActiveTab(tabName)}
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
                  name={isActive
                    ? (iconInfo.name.replace("-outline", "") as any)
                    : (iconInfo.name as any)}
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

function getTabIcon(tab: string, role: Role) {
  switch (tab) {
    case "Dashboard":
      return { name: "view-dashboard-outline", label: "Overview" };
    case "Students":
      return { name: "account-group-outline", label: "Students" };
    case "Teachers":
      return { name: "account-tie-outline", label: "Faculty" };
    case "Academic":
      return { name: "layers-outline", label: "Hierarchy" };
    case "Attendance":
      return {
        name: role === "teacher" ? "camera-enhance-outline" : "calendar-check-outline",
        label: "Attendance",
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
      ])
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
    (x) => String(x.status || "").toUpperCase() === "PRESENT"
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
        <View style={styles.executiveHeroHeaderRow}>
          <View
            style={[
              styles.executiveStatusBadge,
              { backgroundColor: theme.cyanGlow, borderColor: theme.borderAccent },
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
          <Text style={[styles.executiveDateText, { color: theme.muted }]}>{todayDate}</Text>
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
              <View style={[styles.sparklineBarTrack, { backgroundColor: theme.bgElevated }]}>
                <View
                  style={[
                    styles.sparklineBarFill,
                    { height: `${bar.rate}%`, backgroundColor: theme.cyan },
                  ]}
                />
              </View>
              <Text style={[styles.sparklineDayLabel, { color: theme.muted }]}>{bar.day}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Rapid Commands Grid */}
      <Text style={[styles.sectionHeaderTitle, { color: theme.muted }]}>QUICK ACTIONS</Text>
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
          <Text style={[styles.viewAllActionText, { color: theme.cyan }]}>View All Records</Text>
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
              <Text style={[styles.streamItemTitle, { color: theme.text }]} numberOfLines={1}>
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
              tone={String(log.status).toUpperCase() === "PRESENT" ? "success" : "danger"}
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
            { backgroundColor: theme.cyanGlow, borderColor: theme.borderAccent },
          ]}
        >
          <MaterialCommunityIcons name="face-recognition" size={14} color={theme.cyan} />
          <Text style={[styles.teacherHeroPillText, { color: theme.cyan }]}>
            AUTOMATED RECOGNITION READY
          </Text>
        </View>

        <Text style={[styles.teacherHeroMainHeading, { color: theme.text }]}>
          Take Class Attendance
        </Text>
        <Text style={[styles.teacherHeroDescription, { color: theme.textSecondary }]}>
          Capture a classroom photo. Verified student attendance is marked instantly.
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
      <Text style={[styles.sectionHeaderTitle, { color: theme.muted }]}>TODAY'S STATS</Text>
      <View style={styles.teacherMetricsRow}>
        <View
          style={[
            styles.teacherMetricBox,
            { backgroundColor: theme.cardGlass, borderColor: theme.border },
          ]}
        >
          <MaterialCommunityIcons name="calendar-month-outline" size={22} color={theme.cyan} />
          <Text style={[styles.teacherMetricDigit, { color: theme.text }]}>{schedule.length}</Text>
          <Text style={[styles.teacherMetricLabel, { color: theme.muted }]}>Classes</Text>
        </View>
        <View
          style={[
            styles.teacherMetricBox,
            { backgroundColor: theme.cardGlass, borderColor: theme.border },
          ]}
        >
          <MaterialCommunityIcons name="account-check-outline" size={22} color={theme.emerald} />
          <Text style={[styles.teacherMetricDigit, { color: theme.emerald }]}>{presentCount}</Text>
          <Text style={[styles.teacherMetricLabel, { color: theme.muted }]}>Present</Text>
        </View>
        <View
          style={[
            styles.teacherMetricBox,
            { backgroundColor: theme.cardGlass, borderColor: theme.border },
          ]}
        >
          <MaterialCommunityIcons name="layers-outline" size={22} color={theme.amber} />
          <Text style={[styles.teacherMetricDigit, { color: theme.text }]}>{sessionsCount}</Text>
          <Text style={[styles.teacherMetricLabel, { color: theme.muted }]}>Sessions</Text>
        </View>
      </View>

      {/* Today's Timetable */}
      <View style={styles.sectionTitleRow}>
        <Text style={[styles.sectionHeaderTitle, { color: theme.muted }]}>TODAY'S CLASSES</Text>
        <Pressable onPress={() => go("Attendance")}>
          <Text style={[styles.viewAllActionText, { color: theme.cyan }]}>Take Attendance</Text>
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
                { backgroundColor: theme.bgElevated, borderColor: theme.border },
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
              <Text style={[styles.scheduleLectureTitle, { color: theme.text }]}>
                {cls.subject || "Class Lecture"}
              </Text>
              <Text style={[styles.scheduleLectureMeta, { color: theme.muted }]}>
                {cls.room || "Room Assigned"} • {cls.day || "Today"}
              </Text>
            </View>
            <View style={styles.scheduleChevronBox}>
              <MaterialCommunityIcons name="chevron-right" size={22} color={theme.cyan} />
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
            <Text style={[styles.radialDialPercent, { color: theme.text }]}>{rate}%</Text>
            <Text style={[styles.radialDialTitle, { color: theme.muted }]}>ATTENDANCE</Text>
          </View>
        </View>

        <View style={{ flex: 1 }}>
          <Text style={[styles.studentCardHeading, { color: theme.text }]}>Academic Standing</Text>
          <HoloStatusPill
            label={isGoodStanding ? "In Good Standing (≥ 75%)" : "Attendance Warning (< 75%)"}
            tone={isGoodStanding ? "success" : "warning"}
          />
          <Text style={[styles.studentDegreeText, { color: theme.muted }]}>
            {profile.program || "Academic Program"}
            {profile.semester ? ` • Semester ${profile.semester}` : ""}
          </Text>
        </View>
      </View>

      {/* Record Tally Grid */}
      <Text style={[styles.sectionHeaderTitle, { color: theme.muted }]}>RECORD BREAKDOWN</Text>
      <View style={styles.studentBreakdownGrid}>
        <View
          style={[
            styles.studentBreakdownBox,
            { backgroundColor: theme.cardGlass, borderColor: theme.border },
          ]}
        >
          <Text style={[styles.studentBreakdownVal, { color: theme.text }]}>{attendance.length}</Text>
          <Text style={[styles.studentBreakdownLbl, { color: theme.muted }]}>Sessions</Text>
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
          <Text style={[styles.studentBreakdownLbl, { color: theme.muted }]}>Present</Text>
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
          <Text style={[styles.studentBreakdownLbl, { color: theme.muted }]}>Absent</Text>
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
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>Students Directory</Text>
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
              <MaterialCommunityIcons name="close-circle" size={17} color={theme.muted} />
            </Pressable>
          )}
        </View>
        <Pressable
          style={[
            styles.filterToggleBox,
            { backgroundColor: theme.cardGlass, borderColor: theme.border },
            showFilters && { backgroundColor: theme.cyan, borderColor: theme.cyan },
          ]}
          onPress={() => setShowFilters((v) => !v)}
        >
          <MaterialCommunityIcons
            name={showFilters ? "filter-check" : "tune-variant"}
            size={19}
            color={showFilters ? (theme.mode === "dark" ? "#080C14" : "#FFFFFF") : theme.cyan}
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
        <ActivityIndicator size="large" color={theme.cyan} style={{ margin: 30 }} />
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
            <View style={[styles.rosterAvatarBox, { backgroundColor: theme.cyanGlow }]}>
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
            <MaterialCommunityIcons name="chevron-right" size={20} color={theme.muted} />
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
                { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalSheetHeader}>
                <Text style={[styles.modalSheetTitle, { color: theme.text }]}>
                  Student Details
                </Text>
                <Pressable onPress={() => setSelectedStudent(null)}>
                  <MaterialCommunityIcons name="close" size={22} color={theme.text} />
                </Pressable>
              </View>

              <View style={styles.modalProfileHero}>
                <View
                  style={[
                    styles.modalAvatarGlow,
                    { backgroundColor: theme.cyanGlow, borderColor: theme.cyan },
                  ]}
                >
                  <Text style={[styles.modalAvatarGlowText, { color: theme.cyan }]}>
                    {(selectedStudent.name || "S").charAt(0).toUpperCase()}
                  </Text>
                </View>
                <Text style={[styles.modalHeroName, { color: theme.text }]}>
                  {selectedStudent.name}
                </Text>
                <View
                  style={[
                    styles.modalIdBadge,
                    { backgroundColor: theme.cyanGlow, borderColor: theme.borderAccent },
                  ]}
                >
                  <Text style={[styles.modalIdBadgeText, { color: theme.cyan }]}>
                    {selectedStudent.student_id}
                  </Text>
                </View>
              </View>

              <View style={styles.modalDetailsGroup}>
                <HoloDetailRow label="University Email" value={selectedStudent.email || "Not registered"} />
                <HoloDetailRow label="Program" value={selectedStudent.program || "Not registered"} />
                <HoloDetailRow label="Department" value={selectedStudent.department || "Not registered"} />
                <HoloDetailRow label="Semester" value={selectedStudent.semester || "Not specified"} />
                <HoloDetailRow label="Face Verification" value="Active & Profile Registered" />
              </View>

              <Pressable
                style={[styles.modalDismissBtn, { backgroundColor: theme.cyan }]}
                onPress={() => setSelectedStudent(null)}
              >
                <Text
                  style={[
                    styles.modalDismissBtnText,
                    { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
                  ]}
                >
                  DONE
                </Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>
      )}
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
    JSON.stringify(x).toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>Assigned Roster</Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Students in your assigned courses
          </Text>
        </View>
        <View
          style={[
            styles.readOnlyTagPill,
            { backgroundColor: theme.cyanGlow, borderColor: theme.borderAccent },
          ]}
        >
          <MaterialCommunityIcons name="lock" size={13} color={theme.cyan} />
          <Text style={[styles.readOnlyTagText, { color: theme.cyan }]}>ROSTER</Text>
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
        <ActivityIndicator size="large" color={theme.cyan} style={{ margin: 30 }} />
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
            <View style={[styles.rosterAvatarBox, { backgroundColor: theme.cyanGlow }]}>
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
        setTeachers((r.data?.users || []).filter((u: any) => u.role === "teacher"))
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
              Alert.alert("Error", e?.response?.data?.detail || "Could not delete instructor.");
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
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>Faculty Directory</Text>
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
        <ActivityIndicator size="large" color={theme.cyan} style={{ margin: 30 }} />
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
            <View style={[styles.rosterAvatarBox, { backgroundColor: theme.amberGlow }]}>
              <MaterialCommunityIcons name="account-tie" size={22} color={theme.amber} />
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
            <MaterialCommunityIcons name="chevron-right" size={20} color={theme.muted} />
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
                { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={styles.modalSheetHeader}>
                <Text style={[styles.modalSheetTitle, { color: theme.text }]}>
                  Faculty Details
                </Text>
                <Pressable onPress={() => setSelected(null)}>
                  <MaterialCommunityIcons name="close" size={22} color={theme.text} />
                </Pressable>
              </View>

              <View style={styles.modalProfileHero}>
                <View style={[styles.modalAvatarGlow, { backgroundColor: theme.amberGlow }]}>
                  <MaterialCommunityIcons name="account-tie" size={36} color={theme.amber} />
                </View>
                <Text style={[styles.modalHeroName, { color: theme.text }]}>
                  {selected.display_name || selected.username}
                </Text>
                <View
                  style={[
                    styles.modalIdBadge,
                    { backgroundColor: theme.amberGlow, borderColor: theme.amber },
                  ]}
                >
                  <Text style={[styles.modalIdBadgeText, { color: theme.amber }]}>
                    FACULTY • {selected.username}
                  </Text>
                </View>
              </View>

              <View style={styles.modalDetailsGroup}>
                <HoloDetailRow label="Username" value={selected.username} />
                <HoloDetailRow label="Email Address" value={selected.email || "Not specified"} />
                <HoloDetailRow label="System Role" value="Faculty Instructor" />
              </View>

              <View style={styles.modalDualActionsRow}>
                <Pressable
                  style={[
                    styles.modalDangerBtn,
                    { backgroundColor: theme.roseGlow, borderColor: theme.rose },
                  ]}
                  onPress={() => deleteTeacher(selected)}
                >
                  <MaterialCommunityIcons name="trash-can-outline" size={17} color={theme.rose} />
                  <Text style={[styles.modalDangerBtnText, { color: theme.rose }]}>Delete</Text>
                </Pressable>
                <Pressable
                  style={[styles.modalDismissBtnFlex, { backgroundColor: theme.cyan }]}
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
// ADD STUDENT & BIOMETRIC ENROLLMENT INTEGRATION
// ---------------------------------------------------------------------------
function AddStudent({ go }: { go: (x: string) => void }) {
  const { theme } = useAppTheme();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [registeredPhotos, setRegisteredPhotos] = useState<string[]>([]);

  useEffect(() => {
    AsyncStorage.getItem("face_registration_photos").then((val) => {
      if (val) {
        try {
          const arr = JSON.parse(val);
          if (Array.isArray(arr)) setRegisteredPhotos(arr);
        } catch {}
      }
    });
  }, []);

  const saveStudent = async () => {
    if (!name.trim() || !email.trim()) {
      Alert.alert("Missing Fields", "Please enter the student's legal name and email.");
      return;
    }
    if (registeredPhotos.length !== 5) {
      Alert.alert(
        "Face Capture Required",
        "Please complete and validate all 5 face angles before saving the student."
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
      data.append("password", "ChangeMe123!");
      registeredPhotos.forEach((uri: string, i: number) => {
        data.append("files", {
          uri,
          name: `face-${i}.jpg`,
          type: "image/jpeg",
        } as any);
      });

      await http.post("/register-student", data, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      await AsyncStorage.removeItem("face_registration_photos");
      Alert.alert(
        "Student Enrolled",
        `Student ${name} successfully enrolled with validated biometric profile.`,
        [{ text: "View Students", onPress: () => go("Students") }]
      );
    } catch (e: any) {
      Alert.alert(
        "Enrollment Failed",
        e?.response?.data?.detail || "Could not register student. Please check input."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screenLayout}>
      <View style={styles.formTopHeaderRow}>
        <Pressable
          onPress={() => go("Students")}
          style={[styles.backBtnCircle, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <MaterialCommunityIcons name="arrow-left" size={19} color={theme.text} />
        </Pressable>
        <View style={{ flex: 1, paddingLeft: 12 }}>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>Enroll Student</Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Register credentials & face profile
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.glassFormCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
        ]}
      >
        <Text style={[styles.formGroupHeading, { color: theme.muted }]}>PERSONAL DETAILS</Text>
        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>FULL LEGAL NAME</Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              { backgroundColor: theme.bgElevated, borderColor: theme.border, color: theme.text },
            ]}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Jonathan Smith"
            placeholderTextColor={theme.muted}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>UNIVERSITY EMAIL</Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              { backgroundColor: theme.bgElevated, borderColor: theme.border, color: theme.text },
            ]}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            placeholder="j.smith@university.edu"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
          />
        </View>

        <AcademicCascade />

        <Text style={[styles.formGroupHeading, { color: theme.muted, marginTop: 22 }]}>
          BIOMETRIC FACE PROFILE
        </Text>
        <Pressable
          style={[
            styles.biometricPromptCardHolo,
            { backgroundColor: theme.bgElevated, borderColor: theme.cyanGlow },
            registeredPhotos.length === 5 && {
              borderColor: theme.emerald,
              backgroundColor: theme.emeraldGlow,
            },
          ]}
          onPress={() => go("Face Registration")}
        >
          <View
            style={[
              styles.biometricIconBadge,
              { backgroundColor: theme.card },
              registeredPhotos.length === 5 && { backgroundColor: theme.emeraldGlow },
            ]}
          >
            <MaterialCommunityIcons
              name={registeredPhotos.length === 5 ? "check-circle" : "face-recognition"}
              size={30}
              color={registeredPhotos.length === 5 ? theme.emerald : theme.cyan}
            />
          </View>
          <View style={{ flex: 1, paddingLeft: 14 }}>
            <Text style={[styles.biometricCardTitle, { color: theme.text }]}>
              {registeredPhotos.length === 5
                ? "5 Face Angles Verified"
                : "Capture 5 Face Angles"}
            </Text>
            <Text style={[styles.biometricCardSub, { color: theme.muted }]}>
              {registeredPhotos.length === 5
                ? "Face profile captured and ready to enroll."
                : "Center, chin up/down, and left/right views"}
            </Text>
          </View>
          <MaterialCommunityIcons name="chevron-right" size={20} color={theme.muted} />
        </Pressable>

        <View style={styles.formActionButtonsRow}>
          <Pressable
            style={[
              styles.formCancelBtn,
              { backgroundColor: theme.bgElevated, borderColor: theme.border },
            ]}
            onPress={() => go("Students")}
          >
            <Text style={[styles.formCancelBtnText, { color: theme.textSecondary }]}>Cancel</Text>
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
              <ActivityIndicator color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"} />
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
      Alert.alert("Faculty Created", `Teacher ${form.name} created successfully.`, [
        { text: "View Faculty", onPress: () => go("Teachers") },
      ]);
    } catch (e: any) {
      Alert.alert("Creation Failed", e?.response?.data?.detail || "Please check inputs.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screenLayout}>
      <View style={styles.formTopHeaderRow}>
        <Pressable
          onPress={() => go("Teachers")}
          style={[styles.backBtnCircle, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <MaterialCommunityIcons name="arrow-left" size={19} color={theme.text} />
        </Pressable>
        <View style={{ flex: 1, paddingLeft: 12 }}>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>Add Faculty</Text>
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
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>FULL LEGAL NAME</Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              { backgroundColor: theme.bgElevated, borderColor: theme.border, color: theme.text },
            ]}
            value={form.name}
            onChangeText={(v) => setForm((p) => ({ ...p, name: v }))}
            placeholder="Dr. Sarah Jenkins"
            placeholderTextColor={theme.muted}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>UNIVERSITY EMAIL</Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              { backgroundColor: theme.bgElevated, borderColor: theme.border, color: theme.text },
            ]}
            value={form.email}
            onChangeText={(v) => setForm((p) => ({ ...p, email: v }))}
            keyboardType="email-address"
            placeholder="s.jenkins@university.edu"
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
              { backgroundColor: theme.bgElevated, borderColor: theme.border, color: theme.text },
            ]}
            value={form.username}
            onChangeText={(v) => setForm((p) => ({ ...p, username: v }))}
            placeholder="EMP-2026-88"
            placeholderTextColor={theme.muted}
            autoCapitalize="none"
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>PASSWORD</Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              { backgroundColor: theme.bgElevated, borderColor: theme.border, color: theme.text },
            ]}
            value={form.password}
            onChangeText={(v) => setForm((p) => ({ ...p, password: v }))}
            secureTextEntry
            placeholder="Create secure password"
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
            <Text style={[styles.formCancelBtnText, { color: theme.textSecondary }]}>Cancel</Text>
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
              <ActivityIndicator color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"} />
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
  const [camera, setCamera] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [faceDetected, setFaceDetected] = useState(false);
  const [faceBox, setFaceBox] = useState<[number, number, number, number] | null>(null);
  const [frameSize, setFrameSize] = useState({ width: 1, height: 1 });
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");

  // Animated Laser Scanner Bar
  const scanAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scanAnim, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, []);

  const laserTranslateY = scanAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-110, 110],
  });

  const steps = [
    { short: "Center", title: "Center View", guide: "Position face directly inside the oval guide." },
    { short: "Chin Up", title: "Tilt Chin Up", guide: "Gently tilt your chin upward toward the camera." },
    { short: "Chin Down", title: "Tilt Chin Down", guide: "Gently tilt your chin downward toward the camera." },
    { short: "Left", title: "Turn Left", guide: "Turn your face slightly toward the left indicator." },
    { short: "Right", title: "Turn Right", guide: "Turn your face slightly toward the right indicator." },
  ];

  useEffect(() => {
    if (permission === null) return;
    if (!permission.granted) requestPermission();
  }, [permission?.granted]);

  useEffect(() => {
    if (!cameraReady || !camera || busy) return;
    const timer = setTimeout(() => capturePhoto(), 2200);
    return () => clearTimeout(timer);
  }, [cameraReady, camera, step, busy]);

  const capturePhoto = async () => {
    if (!camera || busy) return;
    setBusy(true);
    setFaceDetected(false);
    setFaceBox(null);
    try {
      const photo = await camera.takePictureAsync({
        quality: 0.85,
        skipProcessing: true,
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

      const res = await http.post("/validate-face", data, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const bbox = res.data?.face_bbox;
      const imageWidth = Number(res.data?.image_width);
      const imageHeight = Number(res.data?.image_height);
      if (Array.isArray(bbox) && bbox.length === 4 && imageWidth > 0 && imageHeight > 0) {
        setFaceBox(bbox as [number, number, number, number]);
        setFrameSize({ width: imageWidth, height: imageHeight });
      }

      if (!res.data?.valid) {
        throw new Error(
          res.data?.user_guidance ||
            res.data?.issues?.[0] ||
            "Pose not recognized. Please follow on-screen guidance."
        );
      }

      setFaceDetected(true);
      const nextPhotos = [...captured, photo.uri];
      setCaptured(nextPhotos);

      if (step < 4) {
        setStep(step + 1);
      } else {
        await AsyncStorage.setItem("face_registration_photos", JSON.stringify(nextPhotos));
        Alert.alert(
          "Face Profile Validated",
          "All 5 face angles were successfully scanned and validated.",
          [{ text: "Return to Enroll Student", onPress: () => go("Add Student") }]
        );
      }
    } catch (e: any) {
      Alert.alert(
        "Pose Guidance",
        e?.response?.data?.user_guidance ||
          e?.response?.data?.detail ||
          e?.message ||
          "Please realign your face with the guide."
      );
    } finally {
      setBusy(false);
    }
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
          <MaterialCommunityIcons name="camera-off" size={44} color={theme.cyan} />
          <Text style={[styles.permTitleHolo, { color: theme.text }]}>
            Camera Permission Required
          </Text>
          <Text style={[styles.permDescHolo, { color: theme.muted }]}>
            Pratyaksh requires front camera access to record facial verification angles.
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
          style={[styles.backBtnCircle, { backgroundColor: theme.card, borderColor: theme.border }]}
        >
          <MaterialCommunityIcons name="arrow-left" size={19} color={theme.text} />
        </Pressable>
        <View style={{ flex: 1, paddingLeft: 12 }}>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>Biometric Scan</Text>
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

      {/* Viewfinder with Animated Laser Beam */}
      <View style={[styles.hudCameraViewport, { borderColor: theme.borderAccent }]}>
        {cameraError ? (
          <View style={styles.hudCameraErrorWrap}>
            <Text style={{ color: theme.rose }}>Camera Feed Interrupted</Text>
          </View>
        ) : (
          <View style={styles.cameraFrameWrapper}>
            <CameraView
              ref={setCamera}
              style={StyleSheet.absoluteFillObject}
              facing="front"
              onCameraReady={() => setCameraReady(true)}
              onMountError={() => setCameraError("Camera error")}
            />

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
            <View style={[styles.hudCornerTopLeft, { borderColor: theme.cyan }]} />
            <View style={[styles.hudCornerTopRight, { borderColor: theme.cyan }]} />
            <View style={[styles.hudCornerBottomLeft, { borderColor: theme.cyan }]} />
            <View style={[styles.hudCornerBottomRight, { borderColor: theme.cyan }]} />

            {/* Biometric Ellipse */}
            <View
              style={[
                styles.hudBiometricEllipse,
                faceDetected && [styles.hudBiometricEllipseDone, { borderColor: theme.emerald }],
                busy && [styles.hudBiometricEllipseScanning, { borderColor: theme.amber }],
              ]}
            >
              {/* Animated Laser Scanning Beam */}
              <Animated.View
                style={[
                  styles.animatedLaserLine,
                  {
                    backgroundColor: theme.cyan,
                    shadowColor: theme.cyan,
                    transform: [{ translateY: laserTranslateY }],
                  },
                ]}
              />
            </View>

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
                  { backgroundColor: busy ? theme.amber : theme.cyan },
                ]}
              />
              <Text style={styles.hudTelemetryLabel}>
                {busy
                  ? "VALIDATING FACE ANGLE..."
                  : cameraReady
                    ? "ALIGN FACE WITHIN GUIDE"
                    : "STARTING SENSOR..."}
              </Text>
            </View>
          </View>
        )}
      </View>

      {/* Pose Instruction Card */}
      <View
        style={[
          styles.hudInstructionCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.border },
        ]}
      >
        <Text style={[styles.hudInstructionTitle, { color: theme.text }]}>
          Step {step + 1}: {current.title}
        </Text>
        <Text style={[styles.hudInstructionDesc, { color: theme.textSecondary }]}>
          {current.guide}
        </Text>

        <Pressable
          style={[
            styles.hudForceCaptureBtn,
            { backgroundColor: theme.cyan },
            busy && { opacity: 0.7 },
          ]}
          onPress={capturePhoto}
          disabled={busy}
        >
          {busy ? (
            <ActivityIndicator color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"} />
          ) : (
            <View style={styles.submitRow}>
              <MaterialCommunityIcons
                name="camera"
                size={18}
                color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
              />
              <Text
                style={[
                  styles.hudForceCaptureBtnText,
                  { color: theme.mode === "dark" ? "#080C14" : "#FFFFFF" },
                ]}
              >
                CAPTURE ANGLE ({step + 1}/5)
              </Text>
            </View>
          )}
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
        "Session Created",
        "Attendance session created. You may now capture or upload the classroom photo."
      );
    } catch (e: any) {
      Alert.alert("Error", e?.response?.data?.detail || "Could not initialize session.");
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

      await http.post("/process-group-attendance", data, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      go("Recognition Results");
    } catch (e: any) {
      Alert.alert(
        "Processing Failed",
        e?.response?.data?.detail || "Could not process classroom photo. Please retry."
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
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>Take Attendance</Text>
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
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>LECTURE TITLE</Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              { backgroundColor: theme.bgElevated, borderColor: theme.border, color: theme.text },
            ]}
            value={form.title}
            onChangeText={(v) => setForm((p) => ({ ...p, title: v }))}
            placeholder="e.g. Distributed Systems Lab"
            placeholderTextColor={theme.muted}
          />
        </View>

        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>COURSE CODE & TITLE</Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              { backgroundColor: theme.bgElevated, borderColor: theme.border, color: theme.text },
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
                ([k, v]: any) => !v.length || v.includes(s[k])
              )
            );
            if (found) setScope(found);
          }}
        />

        <View style={styles.formGroup}>
          <Text style={[styles.fieldLabelText, { color: theme.muted }]}>LOCATION / ROOM</Text>
          <TextInput
            style={[
              styles.textInputHoloPlain,
              { backgroundColor: theme.bgElevated, borderColor: theme.border, color: theme.text },
            ]}
            value={form.room}
            onChangeText={(v) => setForm((p) => ({ ...p, room: v }))}
            placeholder="Room 101"
            placeholderTextColor={theme.muted}
          />
        </View>

        <View style={styles.twoColumnGridRow}>
          <View style={{ flex: 1, marginRight: 8 }}>
            <Text style={[styles.fieldLabelText, { color: theme.muted }]}>STARTS</Text>
            <TextInput
              style={[
                styles.textInputHoloPlain,
                { backgroundColor: theme.bgElevated, borderColor: theme.border, color: theme.text },
              ]}
              value={form.starts_at}
              onChangeText={(v) => setForm((p) => ({ ...p, starts_at: v }))}
              placeholder="09:00"
              placeholderTextColor={theme.muted}
            />
          </View>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={[styles.fieldLabelText, { color: theme.muted }]}>ENDS</Text>
            <TextInput
              style={[
                styles.textInputHoloPlain,
                { backgroundColor: theme.bgElevated, borderColor: theme.border, color: theme.text },
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
            { backgroundColor: theme.cyanGlow, borderColor: theme.borderAccent },
          ]}
        >
          <MaterialCommunityIcons name="layers" size={20} color={theme.cyan} />
          <View style={{ flex: 1, paddingLeft: 10 }}>
            <Text style={[styles.sectionSelectedTitle, { color: theme.cyan }]}>
              {scope
                ? `${scope.department} • ${scope.program}`
                : "Select an academic section above"}
            </Text>
            <Text style={[styles.sectionSelectedSub, { color: theme.textSecondary }]}>
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
              <ActivityIndicator color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"} />
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
                  { color: theme.mode === "dark" ? "rgba(8,12,20,0.75)" : "rgba(255,255,255,0.85)" },
                ]}
              >
                Capture students with camera
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.galleryHeroBtn,
                { backgroundColor: theme.bgElevated, borderColor: theme.border },
                busy && { opacity: 0.7 },
              ]}
              onPress={pickFromGallery}
              disabled={busy}
            >
              <MaterialCommunityIcons name="image-multiple" size={24} color={theme.text} />
              <Text style={[styles.galleryHeroBtnTitle, { color: theme.text }]}>
                UPLOAD FROM GALLERY
              </Text>
              <Text style={[styles.galleryHeroBtnSub, { color: theme.muted }]}>
                Select an existing photo file
              </Text>
            </Pressable>
          </View>
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
      <View style={styles.screenCenterLoader}>
        <ActivityIndicator size="large" color={theme.cyan} />
        <Text style={[styles.loaderSubText, { color: theme.muted }]}>
          Analyzing Classroom Faces...
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>
            Recognition Results
          </Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            {items.length} students detected and matched
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

      <View
        style={[
          styles.resultsNoticeBox,
          { backgroundColor: theme.cyanGlow, borderColor: theme.borderAccent },
        ]}
      >
        <MaterialCommunityIcons name="information" size={18} color={theme.cyan} />
        <Text style={[styles.resultsNoticeText, { color: theme.cyan }]}>
          Review initial classifications. You can adjust student status on the verification checklist.
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
            const isPresent = String(rec.status || "").toLowerCase().includes("present");
            return (
              <View
                key={rec.student_id || i}
                style={[
                  styles.resultItemCardHolo,
                  { backgroundColor: theme.cardGlass, borderColor: theme.border },
                ]}
              >
                <View
                  style={[
                    styles.resultAvatarCircleHolo,
                    { backgroundColor: isPresent ? theme.emeraldGlow : theme.roseGlow },
                  ]}
                >
                  <MaterialCommunityIcons
                    name="account"
                    size={26}
                    color={isPresent ? theme.emerald : theme.rose}
                  />
                </View>
                <Text style={[styles.resultItemNameText, { color: theme.text }]} numberOfLines={1}>
                  {rec.name || rec.student_id || "Student"}
                </Text>
                <Text style={[styles.resultItemIdText, { color: theme.muted }]}>{rec.student_id}</Text>
                <HoloStatusPill
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
          style={[
            styles.primaryNeonButton,
            { backgroundColor: theme.cyan, marginTop: 24 },
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
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// TEACHER: VERIFY & FINALIZE ATTENDANCE WITH QUICK FILTERS
// ---------------------------------------------------------------------------
function VerifyAttendanceView({ go }: { go: (x: string) => void }) {
  const { theme } = useAppTheme();
  const [items, setItems] = useState<any[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, "PRESENT" | "ABSENT">>({});
  const [activeFilter, setActiveFilter] = useState<"ALL" | "PRESENT" | "ABSENT">("ALL");
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

  const markAllPresent = () => {
    const updated: Record<string, "PRESENT" | "ABSENT"> = {};
    items.forEach((r) => (updated[r.student_id] = "PRESENT"));
    setStatusMap(updated);
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
        "Attendance Confirmed",
        "The finalized attendance records have been successfully submitted to the database.",
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
      <View style={styles.screenCenterLoader}>
        <ActivityIndicator size="large" color={theme.cyan} />
        <Text style={[styles.loaderSubText, { color: theme.muted }]}>
          Loading Roster Checklist...
        </Text>
      </View>
    );
  }

  const presentCount = Object.values(statusMap).filter((s) => s === "PRESENT").length;
  const absentCount = Object.values(statusMap).filter((s) => s === "ABSENT").length;
  const ratio = items.length ? Math.round((presentCount / items.length) * 100) : 0;

  const filteredItems = items.filter((student) => {
    if (activeFilter === "ALL") return true;
    const currentStatus = statusMap[student.student_id] || "ABSENT";
    return currentStatus === activeFilter;
  });

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>Verify Roster</Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Review and adjust student status
          </Text>
        </View>
      </View>

      {/* Roster Ratio & Tally HUD */}
      <View
        style={[
          styles.tallyHUDCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.border },
        ]}
      >
        <View style={styles.tallyStatsRow}>
          <View style={styles.tallyStatCol}>
            <Text style={[styles.tallyDigit, { color: theme.emerald }]}>{presentCount}</Text>
            <Text style={[styles.tallyMeta, { color: theme.muted }]}>Present</Text>
          </View>
          <View style={[styles.tallyDividerLine, { backgroundColor: theme.border }]} />
          <View style={styles.tallyStatCol}>
            <Text style={[styles.tallyDigit, { color: theme.rose }]}>{absentCount}</Text>
            <Text style={[styles.tallyMeta, { color: theme.muted }]}>Absent</Text>
          </View>
          <View style={[styles.tallyDividerLine, { backgroundColor: theme.border }]} />
          <View style={styles.tallyStatCol}>
            <Text style={[styles.tallyDigit, { color: theme.text }]}>{items.length}</Text>
            <Text style={[styles.tallyMeta, { color: theme.muted }]}>Total</Text>
          </View>
        </View>

        {/* Attendance Ratio Bar */}
        <View style={[styles.tallyProgressBarTrack, { backgroundColor: theme.bgElevated }]}>
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
        <View style={[styles.filterSegmentPillWrap, { backgroundColor: theme.bgElevated }]}>
          {(["ALL", "PRESENT", "ABSENT"] as const).map((filterKey) => {
            const active = activeFilter === filterKey;
            return (
              <Pressable
                key={filterKey}
                style={[
                  styles.filterSegmentBtn,
                  active && [
                    styles.filterSegmentBtnActive,
                    { backgroundColor: theme.card, borderColor: theme.borderAccent },
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
          <MaterialCommunityIcons name="check-all" size={16} color={theme.cyan} />
          <Text style={[styles.quickBulkBtnText, { color: theme.cyan }]}>All Present</Text>
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
                { backgroundColor: isPresent ? theme.emeraldGlow : theme.roseGlow },
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
                  ? [styles.togglePillHoloPresent, { backgroundColor: theme.emeraldGlow, borderColor: theme.emerald }]
                  : [styles.togglePillHoloAbsent, { backgroundColor: theme.roseGlow, borderColor: theme.rose }],
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
          <ActivityIndicator color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"} />
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
    (x) => new Date(x.timestamp).toDateString() === date.toDateString()
  );
  const presentCount = dayLogs.filter(
    (x) => String(x.status || "PRESENT").toUpperCase() === "PRESENT"
  ).length;

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>Attendance Audit</Text>
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
        <MaterialCommunityIcons name="chevron-down" size={19} color={theme.muted} />
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
            <Text style={[styles.tallyDigit, { color: theme.emerald }]}>{presentCount}</Text>
            <Text style={[styles.tallyMeta, { color: theme.muted }]}>Present</Text>
          </View>
          <View style={[styles.tallyDividerLine, { backgroundColor: theme.border }]} />
          <View style={styles.tallyStatCol}>
            <Text style={[styles.tallyDigit, { color: theme.rose }]}>
              {dayLogs.length - presentCount}
            </Text>
            <Text style={[styles.tallyMeta, { color: theme.muted }]}>Absent</Text>
          </View>
          <View style={[styles.tallyDividerLine, { backgroundColor: theme.border }]} />
          <View style={styles.tallyStatCol}>
            <Text style={[styles.tallyDigit, { color: theme.text }]}>
              {dayLogs.length ? Math.round((presentCount / dayLogs.length) * 100) : 0}%
            </Text>
            <Text style={[styles.tallyMeta, { color: theme.muted }]}>Rate</Text>
          </View>
        </View>
      </View>

      {busy ? (
        <ActivityIndicator size="large" color={theme.cyan} style={{ margin: 30 }} />
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
            <View style={[styles.rosterAvatarBox, { backgroundColor: theme.cyanGlow }]}>
              <MaterialCommunityIcons name="account" size={20} color={theme.cyan} />
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
              tone={String(log.status).toUpperCase() === "PRESENT" ? "success" : "danger"}
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
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>My Attendance</Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Verified personal attendance records
          </Text>
        </View>
      </View>

      {busy ? (
        <ActivityIndicator size="large" color={theme.cyan} style={{ margin: 30 }} />
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
                  { backgroundColor: isPresent ? theme.emeraldGlow : theme.roseGlow },
                ]}
              >
                <MaterialCommunityIcons
                  name={isPresent ? "check-bold" : "close-thick"}
                  size={16}
                  color={isPresent ? theme.emerald : theme.rose}
                />
              </View>
              <View style={{ flex: 1, paddingLeft: 12 }}>
                <Text style={[styles.studentSessionTitle, { color: theme.text }]}>
                  {sess.title || sess.course}
                </Text>
                <Text style={[styles.studentSessionMeta, { color: theme.textSecondary }]}>
                  {sess.course} • {sess.department || "Academic Dept"}
                </Text>
                <Text style={[styles.studentSessionDate, { color: theme.muted }]}>
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
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>Class Schedule</Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Course lectures & room assignments
          </Text>
        </View>
      </View>

      {busy ? (
        <ActivityIndicator size="large" color={theme.cyan} style={{ margin: 30 }} />
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
                { backgroundColor: theme.bgElevated, borderColor: theme.border },
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
              <Text style={[styles.scheduleLectureTitle, { color: theme.text }]}>
                {cls.title || cls.course}
              </Text>
              <Text style={[styles.scheduleLectureMeta, { color: theme.muted }]}>
                {cls.room || "Room 101"} • {cls.program} • {cls.semester}
              </Text>
            </View>
            <View
              style={[
                styles.roomTagHolo,
                { backgroundColor: theme.cyanGlow, borderColor: theme.borderAccent },
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
function AttendanceHistoryView() {
  const { theme } = useAppTheme();
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

  const sessions = Array.from(new Map(records.map((x) => [x.session_id, x])).values());

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>Session History</Text>
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
        <MaterialCommunityIcons name="calendar-month" size={20} color={theme.cyan} />
        <Text style={[styles.datePickerCardText, { color: theme.text }]}>
          {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
        </Text>
        <MaterialCommunityIcons name="chevron-down" size={19} color={theme.muted} />
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
        <ActivityIndicator size="large" color={theme.cyan} style={{ margin: 30 }} />
      ) : sessions.length === 0 ? (
        <HoloEmptyState
          icon="history"
          title="No records in this month"
          desc="Pick a different month or capture class attendance."
        />
      ) : (
        sessions.map((sess: any, i) => {
          const count = records.filter((r) => r.session_id === sess.session_id).length;
          return (
            <View
              key={sess.session_id || i}
              style={[
                styles.rosterItemCard,
                { backgroundColor: theme.cardGlass, borderColor: theme.border },
              ]}
            >
              <View style={[styles.rosterAvatarBox, { backgroundColor: theme.cyanGlow }]}>
                <MaterialCommunityIcons name="calendar-check" size={20} color={theme.cyan} />
              </View>
              <View style={{ flex: 1, paddingHorizontal: 12 }}>
                <Text style={[styles.rosterItemName, { color: theme.text }]}>
                  {sess.timestamp
                    ? new Date(sess.timestamp).toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })
                    : `Session #${sess.session_id}`}
                </Text>
                <Text style={[styles.rosterItemId, { color: theme.cyan }]}>
                  Session ID: {sess.session_id}
                </Text>
                <Text style={[styles.rosterItemMeta, { color: theme.muted }]}>
                  {count} verified students
                </Text>
              </View>
              <HoloStatusPill label={`${count} students`} tone="info" />
            </View>
          );
        })
      )}
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
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>Attendance Reports</Text>
          <Text style={[styles.screenSubTitle, { color: theme.muted }]}>
            Departmental attendance overview
          </Text>
        </View>
      </View>

      {/* Segment Switcher */}
      <View style={[styles.segmentWrapHolo, { backgroundColor: theme.bgElevated }]}>
        {["This Month", "This Week", "All Time"].map((tab) => (
          <Pressable
            key={tab}
            style={[
              styles.segmentBtnHolo,
              period === tab && [
                styles.segmentBtnHoloActive,
                { backgroundColor: theme.card, borderColor: theme.borderAccent },
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
        <ActivityIndicator size="large" color={theme.cyan} style={{ margin: 30 }} />
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
            { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
          ]}
        >
          <Text style={[styles.formGroupHeading, { color: theme.muted }]}>SESSIONS IN PERIOD</Text>
          {sessions.map((sess: any, i) => (
            <View
              key={sess.session_id || i}
              style={[styles.reportSessionItemRow, { borderBottomColor: theme.border }]}
            >
              <View
                style={[styles.reportSessionIconCircle, { backgroundColor: theme.cyanGlow }]}
              >
                <MaterialCommunityIcons name="calendar-check" size={18} color={theme.cyan} />
              </View>
              <View style={{ flex: 1, paddingLeft: 10 }}>
                <Text style={[styles.reportSessionItemTitle, { color: theme.text }]}>
                  {sess.timestamp ? new Date(sess.timestamp).toLocaleDateString() : "Session"}
                </Text>
                <Text style={[styles.reportSessionItemSub, { color: theme.muted }]}>
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
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>Notifications</Text>
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
          <Text style={[styles.markAllBtnHoloText, { color: theme.cyan }]}>Mark all read</Text>
        </Pressable>
      </View>

      <View style={[styles.segmentWrapHolo, { backgroundColor: theme.bgElevated }]}>
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
        <ActivityIndicator size="large" color={theme.cyan} style={{ margin: 30 }} />
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
                    notif.category === "alert" ? theme.roseGlow : theme.cyanGlow,
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
              <Text style={[styles.notifTitleHolo, { color: theme.text }]}>{notif.title}</Text>
              <Text style={[styles.notifBodyHolo, { color: theme.textSecondary }]}>
                {notif.body}
              </Text>
              <Text style={[styles.notifTimeHolo, { color: theme.muted }]}>
                {notif.created_at ? new Date(notif.created_at).toLocaleString() : ""}
              </Text>
            </View>
            {!notif.is_read && (
              <View style={[styles.unreadDotHolo, { backgroundColor: theme.cyan }]} />
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
    JSON.stringify(s).toLowerCase().includes(search.toLowerCase())
  );
  const schools = Array.from(new Set(visible.map((s) => s.school)));

  return (
    <View style={styles.screenLayout}>
      <View style={styles.screenTopHeader}>
        <View>
          <Text style={[styles.screenMainTitle, { color: theme.text }]}>Academic Structure</Text>
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
        <ActivityIndicator size="large" color={theme.cyan} style={{ margin: 30 }} />
      ) : schools.length === 0 ? (
        <HoloEmptyState
          icon="layers-outline"
          title="No academic sections found"
          desc="Academic sections are managed by university administrators."
        />
      ) : (
        schools.map((school) => {
          const isSchoolOpen = expandedSchool === school || (!!search && schools.length === 1);
          const faculties = Array.from(
            new Set(visible.filter((x) => x.school === school).map((x) => x.faculty))
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
                <MaterialCommunityIcons name="school" size={20} color={theme.cyan} />
                <Text style={[styles.hierarchySchoolTitle, { color: theme.text }]}>
                  {school}
                </Text>
                <View style={[styles.hierarchyCountPill, { backgroundColor: theme.bgElevated }]}>
                  <Text style={[styles.hierarchyCountPillText, { color: theme.muted }]}>
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
                  const isFacOpen = expandedFaculty === key || (!!search && faculties.length === 1);
                  const programs = visible.filter((x) => x.school === school && x.faculty === fac);
                  return (
                    <View
                      key={fac}
                      style={[styles.hierarchyFacultySection, { borderTopColor: theme.border }]}
                    >
                      <Pressable
                        style={styles.hierarchyFacultyBar}
                        onPress={() => setExpandedFaculty(isFacOpen ? null : key)}
                      >
                        <MaterialCommunityIcons
                          name="folder-outline"
                          size={17}
                          color={theme.text}
                        />
                        <Text style={[styles.hierarchyFacultyTitle, { color: theme.text }]}>
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
                            <View key={pIdx} style={styles.hierarchyProgramLine}>
                              <Text style={[styles.hierarchyBulletDot, { color: theme.muted }]}>
                                •
                              </Text>
                              <View style={{ flex: 1 }}>
                                <Text
                                  style={[styles.hierarchyDeptName, { color: theme.text }]}
                                >
                                  {prog.department}
                                </Text>
                                <Text
                                  style={[styles.hierarchyProgName, { color: theme.muted }]}
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
      <ProfileHeroCard profile={profile} role="ADMINISTRATOR" setProfile={setProfile} />

      <View
        style={[
          styles.glassFormCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
        ]}
      >
        <Text style={[styles.formGroupHeading, { color: theme.muted }]}>ACCOUNT PRIVILEGES</Text>
        <HoloDetailRow label="Role Access" value="University Superuser" />
        <HoloDetailRow label="Username" value={profile.username || "admin"} />
        <HoloDetailRow label="Email" value={profile.email || "admin@pratyaksh.edu"} />
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

function TeacherProfile({ user, onLogout }: { user: any; onLogout: () => void }) {
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
      <ProfileHeroCard profile={profile} role="FACULTY INSTRUCTOR" setProfile={setProfile} />

      <View
        style={[
          styles.glassFormCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
        ]}
      >
        <Text style={[styles.formGroupHeading, { color: theme.muted }]}>ASSIGNED COURSES</Text>
        {assignments.length === 0 ? (
          <Text style={[styles.emptySubText, { color: theme.muted }]}>
            No course sections assigned yet.
          </Text>
        ) : (
          assignments.map((item, i) => (
            <View
              key={i}
              style={[styles.assignedCourseRow, { borderBottomColor: theme.border }]}
            >
              <MaterialCommunityIcons name="book-outline" size={19} color={theme.cyan} />
              <View style={{ flex: 1, paddingLeft: 10 }}>
                <Text style={[styles.assignedCourseTitle, { color: theme.text }]}>
                  {item.subject}
                </Text>
                <Text style={[styles.assignedCourseSub, { color: theme.muted }]}>
                  {item.semester || "Semester"} • {item.students || 0} Students
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
        <Text style={[styles.signOutBtnHoloText, { color: theme.rose }]}>Sign Out Account</Text>
      </Pressable>
    </View>
  );
}

function StudentProfile({ user, onLogout }: { user: any; onLogout: () => void }) {
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
      <ProfileHeroCard profile={profile} role="STUDENT SCHOLAR" setProfile={setProfile} />

      <View
        style={[
          styles.glassFormCard,
          { backgroundColor: theme.cardGlass, borderColor: theme.borderBright },
        ]}
      >
        <Text style={[styles.formGroupHeading, { color: theme.muted }]}>ACADEMIC ENROLLMENT</Text>
        <HoloDetailRow label="Student ID" value={profile.student_id || "STU-2026"} />
        <HoloDetailRow label="Department" value={profile.department || "Engineering"} />
        <HoloDetailRow label="Program" value={profile.program || "Computer Science"} />
        <HoloDetailRow label="Semester" value={profile.semester || "Semester 4"} />
        <HoloDetailRow label="Current GPA" value={String(profile.gpa || "3.85")} />
        <HoloDetailRow
          label="Face Profile"
          value={profile.face_registered ? "Active & Verified" : "Active (Profile Registered)"}
        />
      </View>

      <Pressable
        style={[
          styles.signOutBtnHolo,
          { backgroundColor: theme.roseGlow, borderColor: theme.rose },
        ]}
        onPress={onLogout}
      >
        <MaterialCommunityIcons name="logout" size={19} color={theme.rose} />
        <Text style={[styles.signOutBtnHoloText, { color: theme.rose }]}>Sign Out Account</Text>
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
    profile.display_name || profile.name || profile.username || "University Member";

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
            <Text style={[styles.profileAvatarFallbackInitial, { color: theme.cyan }]}>
              {name.charAt(0).toUpperCase()}
            </Text>
          </View>
        )}
        <View style={[styles.avatarEditPillHolo, { backgroundColor: theme.cyan }]}>
          <MaterialCommunityIcons
            name="camera"
            size={12}
            color={theme.mode === "dark" ? "#080C14" : "#FFFFFF"}
          />
        </View>
      </Pressable>

      <Text style={[styles.profileHeroNameHolo, { color: theme.text }]}>{name}</Text>
      <View
        style={[
          styles.profileRoleBadgeHolo,
          { backgroundColor: theme.cyanGlow, borderColor: theme.borderAccent },
        ]}
      >
        <Text style={[styles.profileRoleBadgeText, { color: theme.cyan }]}>{role}</Text>
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
      <Text style={[styles.kpiLabelHolo, { color: theme.textSecondary }]}>{label}</Text>
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
      <View style={[styles.rapidCmdIconBadge, { backgroundColor: `${color}18` }]}>
        <MaterialCommunityIcons name={icon as any} size={22} color={color} />
      </View>
      <Text style={[styles.rapidCmdTitleHolo, { color: theme.text }]}>{title}</Text>
      <Text style={[styles.rapidCmdDescHolo, { color: theme.muted }]}>{desc}</Text>
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
      <Text style={[styles.holoDetailLabel, { color: theme.muted }]}>{label}</Text>
      <Text style={[styles.holoDetailValue, { color: theme.text }]}>{value}</Text>
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
      <View style={[styles.emptyIconBadgeHolo, { backgroundColor: theme.cyanGlow }]}>
        <MaterialCommunityIcons name={icon as any} size={32} color={theme.cyan} />
      </View>
      <Text style={[styles.emptyTitleHolo, { color: theme.text }]}>{title}</Text>
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
function AcademicCascade({ onApply }: { onApply?: (selection: any) => void }) {
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
        <Text style={[styles.fieldLabelText, { color: theme.muted }]}>{label}</Text>
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
            <Pressable style={styles.modalBackdropOverlay} onPress={() => setModalOpen(null)}>
              <Pressable
                style={[
                  styles.dropdownModalHolo,
                  { backgroundColor: theme.card, borderColor: theme.borderBright },
                ]}
                onPress={(e) => e.stopPropagation()}
              >
                <Text style={[styles.dropdownModalTitle, { color: theme.text }]}>
                  Select {label}
                </Text>
                <ScrollView style={{ maxHeight: 250 }} keyboardShouldPersistTaps="handled">
                  {options.map((opt) => (
                    <Pressable
                      key={opt}
                      style={[styles.dropdownOptionHolo, { borderBottomColor: theme.border }]}
                      onPress={() => {
                        setSelection((prev: any) => ({
                          ...prev,
                          [fieldKey]: opt,
                          ...(fieldKey === "school"
                            ? { faculty: "", department: "", program: "", semester: "" }
                            : fieldKey === "faculty"
                              ? { department: "", program: "", semester: "" }
                              : fieldKey === "department"
                                ? { program: "", semester: "" }
                                : fieldKey === "program"
                                  ? { semester: "" }
                                  : {}),
                        }));
                        setModalOpen(null);
                      }}
                    >
                      <Text style={[styles.dropdownOptionTextHolo, { color: theme.text }]}>
                        {opt}
                      </Text>
                      {selection[fieldKey] === opt && (
                        <MaterialCommunityIcons name="check" size={17} color={theme.cyan} />
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
      <Text style={[styles.formGroupHeading, { color: theme.muted }]}>ACADEMIC PLACEMENT</Text>
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
        "Program",
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
      <Text style={[styles.phaseStepLabel, { color: theme.muted }]}>{label}</Text>
      <View style={styles.phaseChipsRow}>
        {opts.map((opt) => {
          const isSelected = selection[fieldKey].includes(opt);
          return (
            <Pressable
              key={opt}
              style={[
                styles.phasePillChip,
                { backgroundColor: theme.bgElevated, borderColor: theme.border },
                isSelected && {
                  backgroundColor: theme.cyanGlow,
                  borderColor: theme.cyan,
                },
              ]}
              onPress={() => toggle(fieldKey, opt)}
            >
              <MaterialCommunityIcons
                name={isSelected ? "checkbox-marked-circle" : "checkbox-blank-circle-outline"}
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
      <Text style={[styles.formGroupHeading, { color: theme.muted }]}>DEPARTMENT PERMISSIONS</Text>
      <Text style={[styles.hierarchyScopeDesc, { color: theme.muted }]}>
        Select the academic programs this instructor can manage:
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
    paddingVertical: 10,
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
    borderRadius: 11,
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
    borderRadius: 24,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 6,
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
    fontWeight: "900",
    letterSpacing: -0.4,
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
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
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
    borderRadius: 22,
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
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
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
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
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
    borderRadius: 18,
    padding: 14,
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
    borderRadius: 15,
    padding: 12,
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
    borderRadius: 16,
    padding: 14,
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
});
