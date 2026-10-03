// Fresh implementation based on the supplied mobile screens. No Tailwind or previous UI code.
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  Linking,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import axios from "axios";
import * as ImagePicker from "expo-image-picker";
import { CameraView, useCameraPermissions } from "expo-camera";
import { MaterialCommunityIcons as MaterialCommunityIconsBase } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
const MaterialCommunityIcons = ((props:any)=><MaterialCommunityIconsBase {...props} name={props.name==='folder-school-outline'?'folder-outline':props.name==='school-search-outline'?'book-search-outline':props.name}/>) as any;

type Role = "admin" | "teacher" | "student";
const API = process.env.EXPO_PUBLIC_API_URL || "https://need-associated-pants-examined.trycloudflare.com";
const http = axios.create({ baseURL: API });
const colors = {
  navy: "#244578",
  yellow: "#F7B900",
  bg: "#F5F6FA",
  text: "#182033",
  muted: "#6B6E7C",
  line: "#DDE1EB",
  green: "#14B982",
  red: "#F04B4B",
  bluePale: "#ECF3FF",
  yellowPale: "#FFF6D9",
  greenPale: "#E2F8EF",
  redPale: "#FFE8E8",
};

export default function App() {
  const [user, setUser] = useState<any>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem("attendai_user")
      .then(async (x) => { if (x) { const parsed=JSON.parse(x); if (parsed.token) { http.defaults.headers.common.Authorization=`Bearer ${parsed.token}`; try { await http.get('/auth/profile'); setUser(parsed); } catch { await AsyncStorage.removeItem('attendai_user'); } } else await AsyncStorage.removeItem("attendai_user"); }})
      .finally(() => setLoading(false));
  }, []);
  if (loading)
    return (
      <SafeAreaView style={s.center}>
        <ActivityIndicator color={colors.navy} />
      </SafeAreaView>
    );
  return user ? (
    <AppShell
      user={user}
      onLogout={async () => {
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
function Login({ onLogin }: { onLogin: (u: any) => void }) {
  const [role, setRole] = useState<Role>("admin"),
    [email, setEmail] = useState("admin@university.edu"),
    [password, setPassword] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await http.post("/auth/login", { username: email, password });
      onLogin({ ...r.data.user, token: r.data.access_token, role: r.data.user.role || role });
    } catch (e: any) {
      setError(e?.response?.data?.detail || "Unable to sign in");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={s.login}>
        <Logo />
        <Text style={s.brand}>
          Attend<Text style={{ color: colors.yellow }}>AI</Text>
        </Text>
        <Text style={s.tag}>Smart Attendance System</Text>
        <View style={s.loginTitle}>
          <Text style={s.h1}>Welcome Back</Text>
          <Text style={s.muted}>Sign in to continue to your dashboard</Text>
        </View>
        <Field
          label="Email Address"
          value={email}
          onChangeText={setEmail}
          placeholder="admin@university.edu"
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          placeholder="••••••••••••"
        />
        <Text style={s.forgot}>Forgot Password?</Text>
        <Text style={s.choose}>CHOOSE ROLE</Text>
        <View style={s.roleRow}>
          {(["admin", "teacher", "student"] as Role[]).map((x) => (
            <Pressable
              key={x}
              onPress={() => setRole(x)}
              style={[s.rolePill, role === x && s.rolePillActive]}
            >
              <Text style={[s.roleText, role === x && s.roleTextActive]}>
                {x[0].toUpperCase() + x.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Pressable style={s.signIn} onPress={submit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.navy} />
          ) : (
            <Text style={s.signText}>Sign In</Text>
          )}
        </Pressable>
        <View style={s.yellowLine} />
      </ScrollView>
    </SafeAreaView>
  );
}
function Logo() {
  return (
    <View style={s.logo}>
      <MaterialCommunityIcons name="school-outline" size={38} color={colors.yellow} />
    </View>
  );
}
function Field(p: any) {
  return (
    <View style={s.field}>
      <Text style={s.label}>{p.label}</Text>
      <TextInput {...p} style={s.input} placeholderTextColor={colors.muted} />
    </View>
  );
}

function AppShell({ user, onLogout }: { user: any; onLogout: () => void }) {
  useEffect(() => {
    if (user.token) http.defaults.headers.common.Authorization = `Bearer ${user.token}`;
  }, [user.token]);
  const role = (user.role || "admin") as Role;
  const admin = ["Dashboard", "Students", "Teachers", "Academic", "Attendance", "Alerts", "Profile"];
  const teacher = ["Dashboard", "Students", "Attendance", "History", "Reports", "Alerts", "Profile"];
  const student = ["Dashboard", "Attendance", "Classes", "Alerts", "Profile"];
  const tabs =
    role === "admin" ? admin : role === "teacher" ? teacher : student;
  const [tab, setTab] = useState("Dashboard");
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" />
      {tab === "Dashboard" && <View style={s.top}>
        <View>
          <Text style={s.topBrand}>Pratyaksh</Text>
          <Text style={s.topSub}>
            {tab === "Dashboard"
              ? "Good Morning, " +
                (role === "admin" ? (user.display_name || user.username || "") : (user.display_name || user.username || ""))
              : screenSubtitle(tab, role)}
          </Text>
        </View>
        <View style={s.topActions}><Pressable onPress={() => setTab(role === "student" ? "Profile" : "Alerts")} style={s.bell}><MaterialCommunityIcons name="bell-outline" size={23} color={colors.navy}/><View style={s.notificationDot}/></Pressable><Pressable onPress={()=>setTab('Profile')} style={s.topAvatar}><Text style={s.topAvatarText}>{role==='admin'?'A':role==='teacher'?'S':'A'}</Text></Pressable></View>
      </View>}
      <ScrollView contentContainerStyle={s.body}>
        {tab === "Dashboard" ? (
          role === "teacher" ? <TeacherDashboardV2 go={setTab} /> : <Dashboard role={role} go={setTab} />
        ) : (
          <Screen title={tab} role={role} go={setTab} onLogout={onLogout} />
        )}
      </ScrollView>
      <View style={s.nav}>
        {tabs.map((x) => (
          <Pressable key={x} onPress={() => setTab(x)} style={s.navItem}>
            <MaterialCommunityIcons name={icon(x) as any} size={22} color={tab===x?colors.navy:'#727787'} />
            <Text style={[s.navText, tab === x && s.navActive]}>{x}</Text>
          </Pressable>
        ))}
      </View>
    </SafeAreaView>
  );
}
function screenSubtitle(t: string, r: Role) {
  if (t === "Students")
    return r === "teacher"
      ? "Read-only directory"
      : "Manage university enrollment";
  if (t === "Attendance")
    return r === "teacher"
      ? "Automated facial recognition"
      : "Fidelity tracker and monthly review";
  if (t === "Classes") return "Curriculum schedule and courses";
  if (t === "Alerts") return "Alerts and system dispatches";
  return "University-wide statistics";
}
function icon(x: string) {
  return x === "Dashboard" ? "view-dashboard-outline" : x === "Students" ? "account-group-outline" : x === "Teachers" ? "account-tie-outline" : x === "Academic" ? "layers-outline" : x === "Attendance" ? "calendar-check-outline" : x === "History" ? "history" : x === "Reports" ? "file-chart-outline" : x === "Classes" ? "book-open-outline" : x === "Alerts" ? "bell-outline" : "account-circle-outline";
}
function TeacherDashboardV2({go}:{go:(x:string)=>void}){const [schedule,setSchedule]=useState<any[]>([]),[report,setReport]=useState<any>(null),[busy,setBusy]=useState(true);useEffect(()=>{Promise.all([http.get('/schedule'),http.get('/teacher/attendance/report')]).then(([a,b])=>{setSchedule(a.data?.schedule||[]);setReport(b.data||null)}).catch(()=>{}).finally(()=>setBusy(false))},[]);const metric=(icon:string,value:string,label:string,tone:any)=><View style={[s.teacherMetric,{backgroundColor:tone}]}><MaterialCommunityIcons name={icon as any} size={25} color={colors.navy}/><Text style={s.teacherMetricValue}>{value}</Text><Text style={s.teacherMetricLabel}>{label}</Text></View>;if(busy)return <ActivityIndicator color={colors.navy}/>;return <><View style={s.teacherMetricGrid}>{metric('calendar-month-outline',String(schedule.length),"Scheduled classes",colors.bluePale)}{metric('account-group-outline',String(report?.totals?.students_present||0),'Students present',colors.greenPale)}{metric('layers-outline',String(report?.totals?.sessions||0),'Attendance sessions','#fff')}</View><Pressable style={s.teacherAttendanceButton} onPress={()=>go('Attendance')}><MaterialCommunityIcons name="calendar-check-outline" size={22} color={colors.navy}/><Text style={s.teacherAttendanceText}>Take Attendance Now</Text></Pressable><View style={s.teacherScheduleCard}><Text style={s.cardHead}>Today's Schedule</Text>{schedule.length?schedule.map((x,i)=><Pressable key={x.id||i} style={s.teacherClassRow} onPress={()=>go('Attendance')}><View style={{flex:1}}><Text style={s.teacherClassTitle}>{x.subject}</Text><Text style={s.teacherClassMeta}>{x.room||'Room not provided'} • {x.day||''} • {x.starts_at||''}{x.ends_at?` - ${x.ends_at}`:''}</Text></View><MaterialCommunityIcons name="arrow-right" size={22} color={colors.navy}/></Pressable>):<Text style={s.muted}>No scheduled classes.</Text>}</View></>}
function StudentDashboardLive({go}:{go:(x:string)=>void}){
 const [data,setData]=useState<any>(null),[busy,setBusy]=useState(true);
 useEffect(()=>{http.get('/student/attendance/overview').then(r=>setData(r.data)).catch(()=>setData(null)).finally(()=>setBusy(false))},[]);
 const profile=data?.profile||{}, attendance=Array.isArray(data?.attendance)?data.attendance:[], summary=data?.summary||{};
 const rate=Number(summary.overall_percentage||0);
 return <>{busy?<ActivityIndicator color={colors.navy}/>:<><Text style={s.greeting}>Hi, {profile.display_name||profile.name||profile.username||'Student'}!</Text><Text style={s.muted}>{profile.program||'Program not provided'}{profile.semester?` • ${profile.semester}`:''}</Text><View style={s.studentAttendanceCard}><View style={s.studentRing}><Text style={s.studentRingText}>{rate}%</Text></View><View style={{flex:1}}><Text style={s.cardHead}>Overall Attendance</Text><Badge text={attendance.length?`${summary.present||0} present • ${summary.absent||0} absent`:'No attendance data'} tone={rate>=75?'green':'yellow'} /><Text style={s.muted}>{attendance.length?`${attendance.length} scheduled attendance session${attendance.length===1?'':'s'}`:'Attendance will appear after sessions are created.'}</Text></View></View><View style={s.studentMetricRow}><View style={s.studentMetric}><Text style={s.muted}>Sessions</Text><Text style={s.studentMetricValue}>{attendance.length}</Text></View><View style={s.studentMetric}><Text style={s.muted}>Present</Text><Text style={[s.studentMetricValue,{color:colors.green}]}>{summary.present||0}</Text></View></View><Pressable style={s.yellowButton} onPress={()=>go('Attendance')}><Text style={s.buttonText}>View My Attendance</Text></Pressable></>}</>;
}
function AdminMetric({icon,value,label,badge,tone}:{icon:string;value:string;label:string;badge:string;tone:string}){return <View style={[s.adminMetric,{backgroundColor:tone==='blue'?colors.bluePale:tone==='yellow'?colors.yellowPale:tone==='green'?colors.greenPale:colors.redPale}]}><View style={s.metricTop}><MaterialCommunityIcons name={icon as any} size={26} color={tone==='red'?colors.red:tone==='green'?colors.green:colors.navy}/><Text style={s.metricBadge}>{badge}</Text></View><Text style={s.adminMetricValue}>{value}</Text><Text style={s.metricLabel}>{label}</Text></View>}
function ActivityCard({icon,title,subtitle,tone}:{icon:string;title:string;subtitle:string;tone:string}){return <View style={s.activityCard}><View style={[s.activityIcon,{backgroundColor:tone==='green'?colors.greenPale:colors.redPale}]}><MaterialCommunityIcons name={icon as any} size={20} color={tone==='green'?colors.green:colors.red}/></View><View><Text style={s.actionTitle}>{title}</Text><Text style={s.muted}>{subtitle}</Text></View></View>}
function AdminDashboard({go}:{go:(x:string)=>void}){
 const [students,setStudents]=useState<any[]>([]),[users,setUsers]=useState<any[]>([]),[attendance,setAttendance]=useState<any[]>([]),[busy,setBusy]=useState(true);
 useEffect(()=>{Promise.all([http.get('/students'),http.get('/admin/users'),http.get('/admin/attendance')]).then(([a,b,c])=>{setStudents(a.data?.students||[]);setUsers(b.data?.users||[]);setAttendance(c.data?.attendance||[])}).catch(()=>{}).finally(()=>setBusy(false))},[]);
 if(busy)return <ActivityIndicator color={colors.navy}/>;
 const present=attendance.filter(x=>String(x.status||'').toUpperCase()==='PRESENT').length;
 return <><View style={s.adminMetricGrid}><AdminMetric icon="account-group-outline" value={String(students.length)} label="Students" badge="Live" tone="blue"/><AdminMetric icon="account-tie-outline" value={String(users.filter(x=>x.role==='teacher').length)} label="Teachers" badge="Live" tone="yellow"/><AdminMetric icon="percent-outline" value={attendance.length?`${Math.round(present/attendance.length*100)}%`:'0%'} label="Attendance rate" badge="Live" tone="green"/><AdminMetric icon="calendar-check-outline" value={String(new Set(attendance.map(x=>x.session_id)).size)} label="Sessions" badge="Live" tone="red"/></View><Text style={s.sectionTitle}>Quick Actions</Text><View style={s.quickRow}><Quick icon="account-plus-outline" text="Add Student" onPress={()=>go('Add Student')}/><Quick icon="account-tie-outline" text="Teachers" onPress={()=>go('Teachers')}/><Quick icon="file-document-outline" text="Reports" onPress={()=>go('Reports')}/></View>{!attendance.length?<Text style={s.muted}>No attendance activity recorded.</Text>:<><Text style={s.sectionTitle}>Recent Attendance</Text>{attendance.slice(0,5).map((x,i)=><ActivityCard key={x.id||i} icon="check-circle-outline" title={x.name||x.student_id||'Attendance record'} subtitle={x.timestamp?new Date(x.timestamp).toLocaleString():'Recorded attendance'} tone="green"/>)}</>}
 </>;
}
function Dashboard({ role, go }: { role: Role; go: (x: string) => void }) {
  if (role === "admin") return <AdminDashboard go={go} />;
  if (role === "teacher") return <TeacherDashboardV2 go={go} />;
  return <StudentDashboardLive go={go} />;
}
function Quick({ text, onPress, icon='calendar-check-outline' }: { text: string; onPress: () => void; icon?:string }) {
  return (
    <Pressable onPress={onPress} style={s.quick}>
      <><MaterialCommunityIcons name={icon as any} size={19} color={colors.navy}/><Text style={s.quickText}>{text}</Text></>
    </Pressable>
  );
}
function Screen({
  title,
  role,
  go,
  onLogout,
}: {
  title: string;
  role: Role;
  go: (x: string) => void;
  onLogout: () => void;
}) {
  if (title === "Add Student" && role === "admin") return <ExactAddStudentV2 go={go} />;
  if (title === "Add Teacher" && role === "admin") return <AddTeacher go={go} />;
  if (title === "Face Registration" && role === "admin") return <FaceRegistration go={go} />;
  if (title === "Attendance" && role === "admin") return <AdminAttendanceLive />;
  if (title === "Attendance" && role === "teacher")
    return <TeacherTakeAttendanceV3 go={go} />;
  if (title === "Attendance" && role === "student")
    return <StudentAttendanceLive />;
  if (title === "Classes" && role === "student")
    return <StudentClassesLive />;
  if (title === "History" && role === "teacher")
    return <AttendanceHistoryV2 />;
  if (title === "Recognition Results" && role === "teacher")
    return <RecognitionResultsLive go={go} />;
  if (title === "Verify Attendance" && role === "teacher")
    return <VerifyFinalizeAttendance />;
  if (title === "Profile") return role === "admin" ? <AdminProfileV2 onLogout={onLogout} /> : role === "teacher" ? <TeacherProfileV2 onLogout={onLogout} /> : <StudentProfileLive onLogout={onLogout} />;
  if (title === "Students") return role === "teacher" ? <MyStudentsV3 /> : <StudentsDirectoryStyled go={go} />;
  if (title === "Teachers")
    return (
      <AdminTeachersDirectoryDetail go={go} />
    );
  if (title === "Academic")
    return <AcademicHierarchyV2 />;
  if (title === "Reports") return <ReportsV2 />;
  if (title === "Notifications" || title === "Alerts") return <NotificationsV2 />;
  return (
    <Directory
      title={title === "Alerts" ? "Notifications" : title}
      endpoint={
        title === "Alerts"
          ? "/notifications"
          : title === "Classes"
            ? "/schedule"
            : role === "student"
              ? "/student/attendance"
              : role === "teacher"
                ? "/teacher/attendance/report"
                : "/student/attendance"
      }
      role={role}
      go={go}
    />
  );
}
function StudentAttendanceLive(){
 const [items,setItems]=useState<any[]>([]),[busy,setBusy]=useState(true);
 useEffect(()=>{http.get('/student/attendance-sessions').then(r=>setItems(r.data?.sessions||[])).catch(()=>setItems([])).finally(()=>setBusy(false))},[]);
 return <><View style={s.directoryHeader}><View><Text style={s.pageTitle}>My Attendance & Events</Text><Text style={s.muted}>Only your own section attendance is shown</Text></View></View>{busy?<ActivityIndicator color={colors.navy}/>:!items.length?<View style={s.emptyResults}><Text style={s.emptyResultsTitle}>No sessions scheduled</Text><Text style={s.muted}>Your department or faculty has no attendance events yet.</Text></View>:items.map((x,i)=>{const present=String(x.status).toUpperCase()==='PRESENT';return <View key={x.session_id||i} style={s.attendanceLogCard}><View style={[s.logDot,{backgroundColor:present?colors.green:colors.red}]}/><View style={{flex:1}}><Text style={s.subjectName}>{x.title||x.course}</Text><Text style={s.muted}>{x.course} • {x.school}</Text><Text style={s.muted}>{x.faculty} • {x.department}</Text><Text style={s.muted}>{x.event_date} • {String(x.starts_at).slice(0,5)} - {String(x.ends_at).slice(0,5)}{x.room?` • ${x.room}`:''}</Text><Text style={s.muted}>{x.notes||'No additional event details.'}</Text></View><View style={[s.statusBadge,{backgroundColor:present?colors.greenPale:colors.redPale}]}><Text style={{fontSize:12,fontWeight:'800',color:present?colors.green:colors.red}}>{present?'Present':'Absent'}</Text></View></View>})}</>;
}
function StudentClassesLive(){
 const [items,setItems]=useState<any[]>([]),[busy,setBusy]=useState(true);
 useEffect(()=>{http.get('/student/attendance-sessions').then(r=>setItems(r.data?.sessions||[])).catch(()=>setItems([])).finally(()=>setBusy(false))},[]);
 return <><View style={s.directoryHeader}><View><Text style={s.pageTitle}>My Scheduled Events</Text><Text style={s.muted}>Classes for your academic section</Text></View></View>{busy?<ActivityIndicator color={colors.navy}/>:items.map((x,i)=><View key={x.session_id||i} style={s.classLiveCard}><View style={{flex:1}}><Text style={s.classLiveTitle}>{x.title||x.course}</Text><Text style={s.muted}>{x.course} • {x.program} • {x.semester}</Text><Text style={s.classLiveMeta}>{x.event_date} • {String(x.starts_at).slice(0,5)} - {String(x.ends_at).slice(0,5)}{x.room?` • ${x.room}`:''}</Text></View><View style={[s.statusBadge,{backgroundColor:String(x.status).toUpperCase()==='PRESENT'?colors.greenPale:colors.redPale}]}><Text style={{fontSize:11,fontWeight:'800',color:String(x.status).toUpperCase()==='PRESENT'?colors.green:colors.red}}>{x.status||'Absent'}</Text></View></View>)}</>;
}
function AdminAttendanceLive(){const [items,setItems]=useState<any[]>([]),[date,setDate]=useState(new Date()),[busy,setBusy]=useState(true),[showDate,setShowDate]=useState(false);useEffect(()=>{http.get('/admin/attendance').then(r=>setItems(r.data?.attendance||[])).catch(()=>setItems([])).finally(()=>setBusy(false))},[]);const day=items.filter(x=>new Date(x.timestamp).toDateString()===date.toDateString());const present=day.filter(x=>String(x.status||'PRESENT').toUpperCase()==='PRESENT').length;return <><View style={s.directoryHeader}><View><Text style={s.pageTitle}>Attendance Records</Text><Text style={s.muted}>Class and section records</Text></View><MaterialCommunityIcons name="bell-outline" size={25} color={colors.navy}/></View><Pressable style={s.dateBox} onPress={()=>setShowDate(true)}><MaterialCommunityIcons name="calendar-month-outline" size={20} color={colors.muted}/><Text style={s.dateText}>{date.toLocaleDateString()}</Text></Pressable>{showDate&&<DateTimePicker value={date} mode="date" display="calendar" onChange={(_,d)=>{setShowDate(false);if(d)setDate(d)}}/>}{busy?<ActivityIndicator color={colors.navy}/>:<>{day.length?<><View style={s.attendanceStats}><View style={[s.attendanceStat,s.statGreen]}><Text style={[s.statNumber,{color:colors.green}]}>{present}</Text><Text style={s.statLabel}>Present</Text></View><View style={[s.attendanceStat,s.statRed]}><Text style={[s.statNumber,{color:colors.red}]}>{day.length-present}</Text><Text style={s.statLabel}>Absent</Text></View><View style={[s.attendanceStat,s.statYellow]}><Text style={[s.statNumber,{color:'#C08B00'}]}>{Math.round(present/day.length*100)}%</Text><Text style={s.statLabel}>Rate</Text></View></View>{day.map((x,i)=><View key={x.id||i} style={s.attendanceRecord}><View style={s.recordAvatar}><MaterialCommunityIcons name="account-outline" size={25} color={colors.navy}/></View><View style={{flex:1}}><Text style={s.studentName}>{x.name||x.student_id}</Text><Text style={s.studentMeta}>{x.session_id}</Text></View><Text style={s.studentName}>{x.status||'Present'}</Text></View>)}</>:<View style={s.emptyResults}><MaterialCommunityIcons name="calendar-remove-outline" size={38} color={colors.muted}/><Text style={s.emptyResultsTitle}>No attendance data</Text><Text style={s.muted}>No records exist for this date.</Text></View>}</>}</>}
function MyStudentsV3(){const [items,setItems]=useState<any[]>([]),[q,setQ]=useState(''),[filters,setFilters]=useState(false),[selection,setSelection]=useState<any>({});useEffect(()=>{http.get('/students').then(r=>setItems(r.data.students||[])).catch(()=>setItems([]))},[]);const visible=items.filter(x=>{const t=JSON.stringify(x).toLowerCase();return t.includes(q.toLowerCase())&&(!selection.school||t.includes(selection.school.toLowerCase()))&&(!selection.faculty||t.includes(selection.faculty.toLowerCase()))&&(!selection.department||t.includes(selection.department.toLowerCase()))&&(!selection.course||t.includes(selection.course.toLowerCase()))&&(!selection.semester||t.includes(selection.semester.toLowerCase()))});return <><View style={s.directoryHeader}><View><Text style={s.pageTitle}>My Students</Text><Text style={s.muted}>Read-only directory</Text></View><View style={s.teacherTopAvatar}><MaterialCommunityIcons name="account" size={22} color={colors.navy}/></View></View><View style={s.myStudentsSearch}><MaterialCommunityIcons name="magnify" size={22} color={colors.muted}/><TextInput value={q} onChangeText={setQ} placeholder="Search student roster..." style={s.myStudentsInput}/><Pressable onPress={()=>setFilters(v=>!v)}><MaterialCommunityIcons name={filters?'chevron-up':'tune-variant'} size={21} color={colors.navy}/></Pressable></View>{filters&&<AcademicCascade teacher onApply={(v)=>{setSelection(v);setFilters(false)}}/>}<View style={s.readOnlyBanner}><MaterialCommunityIcons name="lock-outline" size={18} color={colors.navy}/><Text style={s.readOnlyText}>Assigned Student Directory (Read-Only Mode)</Text></View>{visible.map((x,i)=><View key={x.student_id||i} style={s.myStudentCard}><View style={s.myStudentAvatar}><MaterialCommunityIcons name="account-outline" size={28} color={colors.navy}/></View><View style={{flex:1}}><Text style={s.studentName}>{x.name||'Student Record'}</Text><Text style={s.studentId}>{x.student_id||'Not provided'}</Text><Text style={s.studentMeta}>{x.program||'Course not provided'} • {x.semester||'Semester not provided'}</Text></View></View>)}</>}
function StudentsDirectoryStyled({go}:{go:(x:string)=>void}){const [items,setItems]=useState<any[]>([]),[q,setQ]=useState(''),[filters,setFilters]=useState(false),[selection,setSelection]=useState<any>({});useEffect(()=>{http.get('/students').then(r=>setItems(r.data.students||[])).catch(()=>setItems([]))},[]);const visible=items.filter(x=>{const t=JSON.stringify(x).toLowerCase();return t.includes(q.toLowerCase())&&Object.values(selection).filter(Boolean).every((v:any)=>t.includes(String(v).toLowerCase()))});return <><View style={s.directoryHeader}><View><Text style={s.pageTitle}>Students Directory</Text><Text style={s.muted}>Manage university enrollment</Text></View><MaterialCommunityIcons name="bell-outline" size={25} color={colors.navy}/></View><View style={s.searchRow}><View style={{flex:1,position:'relative'}}><MaterialCommunityIcons name="magnify" size={23} color={colors.muted} style={s.searchIcon}/><TextInput value={q} onChangeText={setQ} placeholder="Search by name or student ID..." style={s.directorySearch}/></View><Pressable style={s.filterButton} onPress={()=>setFilters(v=>!v)}><MaterialCommunityIcons name={filters?'chevron-up':'tune-variant'} size={22} color={colors.navy}/></Pressable></View>{filters&&<AcademicCascade teacher={false} onApply={(v)=>{setSelection(v);setFilters(false)}}/>}{visible.map((x,i)=><Pressable key={x.student_id||i} onPress={()=>Alert.alert(x.name||'Student Details',`Student ID: ${x.student_id||'Not provided'}\nCourse: ${x.program||'Not provided'}\nEmail: ${x.email||'Not provided'}`)} style={s.studentRow}><View style={s.studentAvatar}><MaterialCommunityIcons name="account-outline" size={27} color={colors.navy}/></View><View style={{flex:1}}><Text style={s.studentName}>{x.name||'Student Record'}</Text><Text style={s.studentId}>{x.student_id||'Not provided'}</Text><Text style={s.studentMeta}>{x.program||'Course not provided'} • {x.semester||'Semester not provided'}</Text></View><MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted}/></Pressable>)}{!visible.length&&<Card><Text style={s.cardHead}>No students found</Text></Card>}<Pressable style={s.directoryFab} onPress={()=>go('Add Student')}><Text style={s.fabText}>＋</Text></Pressable></>}
function AdminTeachersDirectoryDetail({go}:{go:(x:string)=>void}){const [items,setItems]=useState<any[]>([]),[q,setQ]=useState(''),[selected,setSelected]=useState<any>(null);useEffect(()=>{http.get('/admin/users').then(r=>setItems((r.data.users||[]).filter((x:any)=>x.role==='teacher'))).catch(()=>setItems([]))},[]);const remove=async()=>{if(!selected)return;Alert.alert('Delete teacher',`Delete ${selected.username}?`,[{text:'Delete',style:'destructive',onPress:async()=>{await http.delete(`/admin/users/${selected.id}`);setItems(v=>v.filter(x=>x.id!==selected.id));setSelected(null)}},{text:'Cancel',style:'cancel'}])};if(selected)return <><View style={s.directoryHeader}><Pressable onPress={()=>setSelected(null)} style={s.backCircle}><Text style={s.backText}>‹</Text></Pressable><View style={{flex:1}}><Text style={s.pageTitle}>Teacher Details</Text><Text style={s.muted}>Staff record and actions</Text></View></View><Card><View style={s.detailIdentity}><View style={s.studentAvatar}><MaterialCommunityIcons name="account-tie-outline" size={32} color={colors.navy}/></View><Text style={s.detailName}>{selected.display_name||selected.username}</Text><Text style={s.detailRole}>Teacher</Text></View><Text style={s.detailLabel}>Username</Text><Text style={s.detailValue}>{selected.username}</Text><Text style={s.detailLabel}>Email</Text><Text style={s.detailValue}>{selected.email||'Not provided'}</Text><Text style={s.detailLabel}>Role</Text><Text style={s.detailValue}>Teacher</Text></Card><View style={s.detailActions}><Pressable style={s.editAction} onPress={()=>Alert.alert('Edit teacher','Use the teacher registration form to update this staff record.')}><MaterialCommunityIcons name="pencil-outline" size={19} color={colors.navy}/><Text style={s.editActionText}>Edit</Text></Pressable><Pressable style={s.deleteAction} onPress={remove}><MaterialCommunityIcons name="trash-can-outline" size={19} color={colors.red}/><Text style={s.deleteActionText}>Delete</Text></Pressable></View></>;return <><View style={s.directoryHeader}><View><Text style={s.pageTitle}>Teachers Directory</Text><Text style={s.muted}>Manage university staff</Text></View></View><TextInput value={q} onChangeText={setQ} placeholder="Search teachers..." style={s.search}/>{items.filter(x=>JSON.stringify(x).toLowerCase().includes(q.toLowerCase())).map((teacher,i)=><Pressable key={teacher.id||i} onPress={()=>setSelected(teacher)} style={s.adminDirectoryRow}><View style={s.studentAvatar}><MaterialCommunityIcons name="account-tie-outline" size={27} color={colors.navy}/></View><View style={{flex:1}}><Text style={s.studentName}>{teacher.display_name||teacher.username}</Text><Text style={s.studentId}>{teacher.username}</Text><Text style={s.studentMeta}>{teacher.email||'University staff'}</Text></View><MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted}/></Pressable>)}<Pressable style={s.directoryFab} onPress={()=>go('Add Teacher')}><Text style={s.fabText}>＋</Text></Pressable></>}
function StudentsDirectory({role,go}:{role:Role;go:(x:string)=>void}){return <StudentsDirectoryStyled go={go}/>} 
function FilterChip({text,active,onPress}:{text:string;active:boolean;onPress:()=>void}){return <Pressable onPress={onPress} style={[s.filterChip,active&&s.filterChipActive]}><Text style={[s.filterChipText,active&&s.filterChipTextActive]}>{text}</Text></Pressable>}
function AcademicHierarchyV2(){
 const [sections,setSections]=useState<any[]>([]),[busy,setBusy]=useState(true),[query,setQuery]=useState('');
 useEffect(()=>{http.get('/academic/sections').then(r=>setSections(r.data?.sections||[])).catch(()=>setSections([])).finally(()=>setBusy(false))},[]);
 const visible=sections.filter(x=>JSON.stringify(x).toLowerCase().includes(query.toLowerCase()));
 return <><View style={s.directoryHeader}><View><Text style={s.pageTitle}>Academic Hierarchy</Text><Text style={s.muted}>Live schools, faculties, departments, courses, and sections</Text></View></View><View style={s.academicSearch}><MaterialCommunityIcons name="magnify" size={21} color={colors.muted}/><TextInput value={query} onChangeText={setQuery} placeholder="Search academic records..." style={s.academicSearchInput}/></View>{busy?<ActivityIndicator color={colors.navy}/>:!visible.length?<Card><Text style={s.cardHead}>No academic records found</Text><Text style={s.muted}>Academic sections must be created by an administrator.</Text></Card>:visible.map(x=><View key={x.id} style={s.schoolCard}><View style={s.schoolHeader}><MaterialCommunityIcons name="school-outline" size={22} color={colors.navy}/><View style={{flex:1}}><Text style={s.schoolName}>{x.school}</Text><Text style={s.muted}>{x.faculty} • {x.department}</Text><Text style={s.muted}>{x.program} • {x.semester} • Section {x.section}</Text></View></View></View>)}</>;
}
function AcademicCascade({teacher=false,onApply}:{teacher?:boolean;onApply?:(selection:{school:string;faculty:string;department:string;course:string;semester:string})=>void}){
 const [sections,setSections]=useState<any[]>([]),[selection,setSelection]=useState<any>({}),[open,setOpen]=useState<string|null>(null);
 useEffect(()=>{http.get('/academic/sections').then(r=>setSections(r.data?.sections||[])).catch(()=>setSections([]))},[]);
 const values=(key:string,filters:any={})=>Array.from(new Set(sections.filter(x=>Object.entries(filters).every(([k,v])=>!v||x[k]===v)).map(x=>x[key]).filter(Boolean)));
 const field=(label:string,key:string,options:string[],disabled=false)=><View><Text style={s.label}>{label}</Text><Pressable disabled={disabled||!options.length} style={[s.selectBox,(disabled||!options.length)&&s.selectDisabled]} onPress={()=>setOpen(open===key?null:key)}><Text style={[s.selectText,(disabled||!options.length)&&s.selectTextDisabled]}>{selection[key]||`Select ${label.toLowerCase()}`}</Text><MaterialCommunityIcons name={open===key?'chevron-up':'chevron-down'} size={20} color={disabled?colors.line:colors.navy}/></Pressable>{open===key&&<View style={s.dropdownMenu}>{options.map(option=><Pressable key={option} style={s.dropdownOption} onPress={()=>{setSelection((v:any)=>({...v,[key]:option,...(key==='school'?{faculty:'',department:'',program:'',semester:''}:key==='faculty'?{department:'',program:'',semester:''}:key==='department'?{program:'',semester:''}:key==='program'?{semester:''}:{})}));setOpen(null)}}><Text style={s.dropdownOptionText}>{option}</Text></Pressable>)}</View>}</View>;
 const has=selection.school&&selection.faculty&&selection.department&&selection.program&&selection.semester; return <><Text style={s.formHeading}>ACADEMIC PLACEMENT</Text>{field('School','school',values('school'))}{field('Faculty','faculty',values('faculty',{school:selection.school}),!selection.school)}{field('Department','department',values('department',{school:selection.school,faculty:selection.faculty}),!selection.faculty)}{field('Course / Program','program',values('program',{school:selection.school,faculty:selection.faculty,department:selection.department}),!selection.department)}{field('Semester','semester',values('semester',{school:selection.school,faculty:selection.faculty,department:selection.department,program:selection.program}),!selection.program)}<Pressable disabled={!has} style={[s.applyFilterButton,!has&&s.applyFilterDisabled]} onPress={()=>onApply?.({school:selection.school,faculty:selection.faculty,department:selection.department,course:selection.program,semester:selection.semester})}><MaterialCommunityIcons name="filter-check-outline" size={19} color={colors.navy}/><Text style={s.applyFilterText}>Apply Filters</Text></Pressable></>;
}
function Directory({
  title,
  endpoint,
  role,
  go,
}: {
  title: string;
  endpoint: string;
  role: Role;
  go: (x: string) => void;
}) {
  const [items, setItems] = useState<any[]>([]),
    [q, setQ] = useState(""),
    [busy, setBusy] = useState(true),
    [filters, setFilters] = useState(false);
  useEffect(() => {
    http
      .get(endpoint)
      .then((r) => {
        const d = r.data;
        setItems(
          d.students ||
            d.users ||
            d.sections ||
            d.notifications ||
            d.schedule ||
            d.records ||
            [],
        );
      })
      .catch(() => setItems([]))
      .finally(() => setBusy(false));
  }, [endpoint]);
  return (
    <>
      <Text style={s.pageTitle}>{title}</Text>
      <Text style={s.muted}>
        {title === "Students Directory"
          ? "Manage university enrollment"
          : title === "My Students"
            ? "Assigned Student Directory (Read-Only Mode)"
            : "Stay connected with university information"}
      </Text>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search by name or student ID..."
        style={s.search}
      />
      {title === "Teachers Directory" && <Pressable style={s.filterButton} onPress={()=>setFilters(v=>!v)}><MaterialCommunityIcons name={filters?'chevron-up':'tune-variant'} size={22} color={colors.navy}/></Pressable>}
      {title === "Teachers Directory" && filters && <AcademicCascade teacher onApply={()=>setFilters(false)} />}
      {busy ? (
        <ActivityIndicator color={colors.navy} />
      ) : (
        items
          .filter((x) =>
            JSON.stringify(x).toLowerCase().includes(q.toLowerCase()),
          )
          .map((x, i) => (
            <ActionCard
              key={i}
              title={
                x.name ||
                x.title ||
                x.subject ||
                x.username ||
                x.section ||
                "University record"
              }
              subtitle={
                x.email ||
                x.program ||
                x.body ||
                x.status ||
                "Connected university record"
              }
              onPress={title === "Notifications" && x.id ? async()=>{try{await http.post(`/notifications/${x.id}/read`);setItems(v=>v.map((n:any)=>n.id===x.id?{...n,is_read:true}:n))}catch{}}:undefined}
            />
          ))
      )}
      {!busy && !items.length && (
        <Card>
          <Text style={s.cardHead}>No records found</Text>
          <Text style={s.muted}>
            Try changing your search or check again later.
          </Text>
        </Card>
      )}
      {title === "Students Directory" && role === "admin" ? (
        <Pressable
          style={s.fab}
          onPress={() => go("Add Student")}
        >
          <Text style={s.fabText}>＋</Text>
        </Pressable>
      ) : null}
      {title === "Teachers Directory" && role === "admin" ? (
        <Pressable style={s.fab} onPress={() => go("Add Teacher")}>
          <Text style={s.fabText}>＋</Text>
        </Pressable>
      ) : null}
    </>
  );
}
function FaceRegistration({go}:{go:(x:string)=>void}){
 const [permission,requestPermission]=useCameraPermissions();
 const [step,setStep]=useState(0),[captured,setCaptured]=useState<string[]>([]),[camera,setCamera]=useState<any>(null),[busy,setBusy]=useState(false),[cameraReady,setCameraReady]=useState(false),[cameraError,setCameraError]=useState('');
 const steps=[{short:'Center',title:'Center Face',guide:'Please position your face directly inside the oval guide and keep still.'},{short:'Chin Up',title:'Chin Up',guide:'Tilt your chin slightly upward and keep your eyes on the camera.'},{short:'Chin Down',title:'Chin Down',guide:'Tilt your chin slightly downward while staying inside the guide.'},{short:'Left',title:'Turn Left',guide:'Slowly turn your face to the left until the guide confirms alignment.'},{short:'Right',title:'Turn Right',guide:'Slowly turn your face to the right until the guide confirms alignment.'}];
 useEffect(()=>{if(permission===null)return;if(!permission.granted)requestPermission()},[permission?.granted]);
 useEffect(()=>{if(!cameraReady||!camera||busy)return;const timer=setTimeout(()=>capture(),2500);return()=>clearTimeout(timer)},[cameraReady,camera,step,busy]);
 if(!permission)return <View><Text style={s.pageTitle}>Pratyaksh Biometrics</Text><Text style={s.muted}>Face Registration Process</Text><Card><Text style={s.cardHead}>Camera permission is required</Text><Text style={s.muted}>Allow camera access to capture the five face angles securely.</Text><Pressable style={s.yellowButton} onPress={requestPermission}><Text style={s.buttonText}>Allow Camera</Text></Pressable></Card></View>;
 if(!permission.granted)return <View><Text style={s.pageTitle}>Camera unavailable</Text><Text style={s.muted}>Camera access was not granted. Enable camera permission in Android settings.</Text><Pressable style={s.yellowButton} onPress={requestPermission}><Text style={s.buttonText}>Try Camera Permission Again</Text></Pressable><Pressable style={s.outlineButton} onPress={()=>Linking.openSettings()}><Text style={s.outlineText}>Open App Settings</Text></Pressable></View>;
 const current=steps[step];
 const completeCapture=(uri:string)=>{setCaptured(v=>{const next=[...v,uri];if(next.length===5)AsyncStorage.setItem('face_registration_photos',JSON.stringify(next));return next});if(step<4)setStep(step+1);else Alert.alert('Face registration complete','All five face angles were detected and validated.',[{text:'Return to Add Student',onPress:()=>go('Add Student')}])};
 const capture=async()=>{if(!camera||busy)return;setBusy(true);try{const photo=await camera.takePictureAsync({quality:.8,skipProcessing:true});if(!photo?.uri)throw new Error('No photo captured');const data=new FormData();data.append('file',{uri:photo.uri,name:`face-${step}.jpg`,type:'image/jpeg'} as any);data.append('target_pose',steps[step].short==='Center'?'center':steps[step].short==='Chin Up'?'chin_up':steps[step].short==='Chin Down'?'chin_down':steps[step].short==='Left'?'left':'right');const result=await http.post('/validate-face',data,{headers:{'Content-Type':'multipart/form-data'}});if(!result.data?.valid)throw new Error(result.data?.user_guidance||result.data?.issues?.[0]||'Face validation failed');completeCapture(photo.uri)}catch(e:any){Alert.alert('Face not validated',e?.response?.data?.user_guidance||e?.response?.data?.detail||e?.message||'No valid face was detected. Please follow the guide and try again.')}finally{setBusy(false)}};
 return <View><View style={s.bioHeader}><Pressable onPress={()=>go('Add Student')} style={s.backCircle}><MaterialCommunityIcons name="arrow-left" size={21} color={colors.navy}/></Pressable><View style={{flex:1}}><Text style={s.addTitle}>Pratyaksh Biometrics</Text><Text style={s.muted}>Face Registration Process</Text></View><MaterialCommunityIcons name="bell-outline" size={24} color={colors.navy}/></View><View style={s.stepRow}>{steps.map((x,i)=><React.Fragment key={x.short}><View style={[s.stepDot,i<=step&&s.stepDotActive]}><Text style={s.stepNumber}>{i+1}</Text></View><Text style={[s.stepLabel,i===step&&s.stepLabelActive]}>{x.short}</Text>{i<4&&<View style={s.stepLine}/>}</React.Fragment>)}</View><View style={s.cameraFrame}>{cameraError?<View style={s.cameraFallback}><MaterialCommunityIcons name="camera-off-outline" size={38} color={colors.muted}/><Text style={s.emptyResultsTitle}>Camera unavailable</Text><Text style={s.muted}>The live preview could not start. Check camera permission and close other camera apps.</Text><Pressable style={s.outlineButton} onPress={()=>{setCameraError('');setCameraReady(false);setCamera(null)}}><MaterialCommunityIcons name="refresh" size={18} color={colors.navy}/><Text style={s.outlineText}>Retry Preview</Text></Pressable></View>:<><CameraView ref={setCamera} style={s.camera} facing="front" onCameraReady={()=>setCameraReady(true)} onMountError={()=>setCameraError('preview unavailable')}/><View style={s.faceOval}/><View style={s.alignment}><MaterialCommunityIcons name={busy?'scan-helper':'face-recognition'} size={15} color="#fff"/><Text style={s.alignmentText}>{busy?'CHECKING FACE...':cameraReady?'ALIGNMENT OK':'STARTING CAMERA...'}</Text></View></>}</View><Text style={s.captureTitle}>Step {step+1}: {current.title}</Text><Text style={s.captureGuide}>{current.guide}</Text><Text style={s.captureHelp}>{cameraReady?'Hold still. The photo will be captured automatically after your face is aligned.':'Starting the camera securely...'}</Text><Text style={s.captureStatus}>{busy?'Validating face and capturing automatically...':`${captured.length} of 5 angles completed`}</Text></View>
}
function ExactAddStudentV2({go}:{go:(x:string)=>void}){
 const [name,setName]=useState(''),[email,setEmail]=useState(''),[busy,setBusy]=useState(false);
 const save=async()=>{if(!name||!email){Alert.alert('Required fields','Please complete Full Name and University Email.');return}setBusy(true);try{const studentId=`STU-${Date.now().toString().slice(-6)}`;const stored=await AsyncStorage.getItem('face_registration_photos');const photos=stored?JSON.parse(stored):[];if(!Array.isArray(photos)||photos.length!==5){Alert.alert('Face registration required','Complete and validate all five face angles before saving the student.');return}const data=new FormData();data.append('student_id',studentId);data.append('name',name);data.append('email',email);data.append('password','ChangeMe123!');photos.forEach((uri:string,i:number)=>data.append('files',{uri,name:`face-${i}.jpg`,type:'image/jpeg'} as any));await http.post('/register-student',data,{headers:{'Content-Type':'multipart/form-data'}});await AsyncStorage.removeItem('face_registration_photos');Alert.alert('Student created','The student record and validated face embedding were saved.',[{text:'View Students',onPress:()=>go('Students')}])}catch(e:any){Alert.alert('Could not save student',e?.response?.data?.detail||'Please try again.')}finally{setBusy(false)}};
 return <View><View style={s.addHeader}><Pressable onPress={()=>go('Students')} style={s.backCircle}><Text style={s.backText}>‹</Text></Pressable><View style={{flex:1}}><Text style={s.addTitle}>Add Student</Text><Text style={s.muted}>Register a new academic record</Text></View><MaterialCommunityIcons name="bell-outline" size={24} color={colors.navy}/></View><Text style={s.formHeading}>PERSONAL INFORMATION</Text><Field label="Full Name" value={name} onChangeText={setName} placeholder="Johnathan Doe"/><Field label="University Email" value={email} onChangeText={setEmail} placeholder="johnathan.doe@university.edu" keyboardType="email-address"/><AcademicCascade/><Text style={s.formHeading}>BIOMETRIC VERIFICATION PORTRAIT</Text><Pressable style={s.photoBox} onPress={()=>go('Face Registration')}><Text style={s.photoIcon}>▧</Text><Text style={s.photoTitle}>Take photo or upload file</Text><Text style={s.photoHint}>Complete the five-angle face registration before saving.</Text></Pressable><View style={s.addActions}><Pressable style={s.cancelButton} onPress={()=>go('Students')}><Text style={s.outlineText}>Cancel</Text></Pressable><Pressable style={s.saveButton} onPress={save} disabled={busy}>{busy?<ActivityIndicator color={colors.navy}/>:<Text style={s.buttonText}>Save Record</Text>}</Pressable></View></View>;
}
function SelectBox({value,onPress}:{value:string;onPress?:()=>void}){return <Pressable style={s.selectBox} onPress={onPress}><Text style={s.selectText}>{value}</Text><Text style={s.selectChevron}>⌄</Text></Pressable>}
function AddTeacher({go}:{go:(x:string)=>void}){const [form,setForm]=useState({name:"",username:"",email:"",password:""}),[busy,setBusy]=useState(false);const set=(k:string,v:string)=>setForm({...form,[k]:v});const save=async()=>{if(!form.name||!form.username||!form.password){Alert.alert('Required fields','Enter name, employee ID, and password.');return}setBusy(true);try{await http.post('/admin/users',{username:form.username,password:form.password,role:'teacher',name:form.name,email:form.email});Alert.alert('Teacher added','The teacher account was created successfully.',[{text:'View teachers',onPress:()=>go('Teachers')}])}catch(e:any){Alert.alert('Could not add teacher',e?.response?.data?.detail||'Please check the information and try again.')}finally{setBusy(false)}};return <><Text style={s.pageTitle}>Add Teacher</Text><Text style={s.muted}>Register university staff and subject access</Text><Text style={s.formHeading}>PERSONAL INFORMATION</Text><Field label="Full Name" value={form.name} onChangeText={(v:string)=>set('name',v)} placeholder="Prof. Sarah Jenkins"/><Field label="University Email" value={form.email} onChangeText={(v:string)=>set('email',v)} placeholder="teacher@university.edu" keyboardType="email-address"/><Text style={s.formHeading}>ACCOUNT INFORMATION</Text><Field label="Employee ID / Username" value={form.username} onChangeText={(v:string)=>set('username',v)} placeholder="EMP-2026-001"/><Field label="Temporary Password" value={form.password} onChangeText={(v:string)=>set('password',v)} placeholder="Create a secure password" secureTextEntry/><AcademicCascade teacher/><Pressable style={s.yellowButton} onPress={save} disabled={busy}>{busy?<ActivityIndicator color={colors.navy}/>:<Text style={s.buttonText}>Save Teacher</Text>}</Pressable><Pressable style={s.outlineButton} onPress={()=>go('Teachers')}><Text style={s.outlineText}>Cancel</Text></Pressable></>}
function TeacherTakeAttendanceV3({go}:{go:(x:string)=>void}){
 const [busy,setBusy]=useState(false),[chooseCourse,setChooseCourse]=useState(false),[scope,setScope]=useState<any>(null),[sections,setSections]=useState<any[]>([]);
 const [form,setForm]=useState({title:'',course:'',room:'',event_date:new Date().toISOString().slice(0,10),starts_at:'09:00',ends_at:'10:00',notes:''});
 useEffect(()=>{http.get('/academic/sections').then(r=>setSections(r.data?.sections||[])).catch(()=>setSections([]))},[]);
 const update=(key:string,value:string)=>setForm(v=>({...v,[key]:value}));
 const process=async(uri:string)=>{if(!scope?.id||!form.title||!form.course){Alert.alert('Complete session details','Choose an assigned academic section and enter the event title and course.');return}setBusy(true);const data=new FormData();data.append('session_id',scope.session_id);data.append('file',{uri,name:'class-photo.jpg',type:'image/jpeg'} as any);try{await http.post('/process-group-attendance',data,{headers:{'Content-Type':'multipart/form-data'}});go('History')}catch(e:any){Alert.alert('Attendance upload failed',e?.response?.data?.detail||'The class photo could not be processed.')}finally{setBusy(false)}};
 const create=async()=>{if(!scope?.id||!form.title||!form.course){Alert.alert('Complete session details','Choose a section and enter the title and course.');return}setBusy(true);try{const r=await http.post('/teacher/attendance-sessions',{...form,school:scope.school,faculty:scope.faculty,department:scope.department,program:scope.program,semester:scope.semester,section_id:scope.id});setScope({...scope,session_id:r.data.session_id});Alert.alert('Session created','You can now capture or upload the group photo.')}catch(e:any){Alert.alert('Could not create session',e?.response?.data?.detail||'Please check your assigned section.')}finally{setBusy(false)}};
 const capture=async()=>{const permission=await ImagePicker.requestCameraPermissionsAsync();if(!permission.granted){Alert.alert('Camera permission required','Allow camera access in app settings.');return}const result=await ImagePicker.launchCameraAsync({mediaTypes:['images'],quality:.85});if(!result.canceled)await process(result.assets[0].uri)};
 const browse=async()=>{const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],quality:.85});if(!result.canceled)await process(result.assets[0].uri)};
 return <><View style={s.directoryHeader}><View><Text style={s.pageTitle}>Create Attendance Session</Text><Text style={s.muted}>Set the event details before uploading a group photo</Text></View></View><Field label="Event / class title" value={form.title} onChangeText={(v:string)=>update('title',v)} placeholder="Computer Networks Lecture"/><Field label="Course" value={form.course} onChangeText={(v:string)=>update('course',v)} placeholder="CS-301 Computer Networks"/><AcademicCascade onApply={(selection)=>{const match=sections.find(x=>x.school===selection.school&&x.faculty===selection.faculty&&x.department===selection.department&&x.program===selection.course&&x.semester===selection.semester);if(match)setScope({...selection,...match});else Alert.alert('Section not assigned','No matching section is assigned to this teacher.')}}/><Field label="Room" value={form.room} onChangeText={(v:string)=>update('room',v)} placeholder="Room 402"/><Field label="Date (YYYY-MM-DD)" value={form.event_date} onChangeText={(v:string)=>update('event_date',v)} placeholder="2026-09-29"/><View style={s.twoFields}><View style={{flex:1}}><Field label="Starts" value={form.starts_at} onChangeText={(v:string)=>update('starts_at',v)} placeholder="09:00"/></View><View style={{flex:1}}><Field label="Ends" value={form.ends_at} onChangeText={(v:string)=>update('ends_at',v)} placeholder="10:00"/></View></View><Field label="Notes" value={form.notes} onChangeText={(v:string)=>update('notes',v)} placeholder="Optional event details"/><Card><Text style={s.cardHead}>{scope?`${scope.school} / ${scope.department} / ${scope.program} / ${scope.semester}`:'No academic section selected'}</Text>{scope?.session_id&&<Text style={s.muted}>Session ready: {scope.session_id}</Text>}</Card>{!scope?.session_id?<Pressable style={s.yellowButton} onPress={create} disabled={busy}><Text style={s.buttonText}>{busy?'Creating...':'Create Session'}</Text></Pressable>:<><Pressable style={s.captureClassButton} onPress={capture} disabled={busy}><MaterialCommunityIcons name="camera-outline" size={30} color="#fff"/><Text style={s.captureClassTitle}>{busy?'Processing...':'Capture Class Photo'}</Text><Text style={s.captureClassSub}>Mark recognized students present</Text></Pressable><Pressable style={s.uploadClassButton} onPress={browse} disabled={busy}><Text style={s.uploadClassTitle}>Upload Class Photo</Text><Text style={s.uploadClassSub}>Select a group photo from storage</Text></Pressable></>}</>;
}
function RecognitionResultsLive({go}:{go:(x:string)=>void}){const [items,setItems]=useState<any[]>([]),[busy,setBusy]=useState(true);useEffect(()=>{http.get('/teacher/attendance/report').then(r=>setItems(r.data.records||[])).catch(()=>setItems([])).finally(()=>setBusy(false))},[]);return <><View style={s.directoryHeader}><View><Text style={s.pageTitle}>Recognition Results</Text><Text style={s.muted}>AI initial classifications</Text></View><View style={s.teacherTopAvatar}><MaterialCommunityIcons name="account" size={22} color={colors.navy}/></View></View><View style={s.reviewBanner}><MaterialCommunityIcons name="alert-outline" size={19} color={colors.navy}/><Text style={s.reviewText}>Please review and proceed to manual verification roster</Text></View>{busy?<ActivityIndicator color={colors.navy}/>:!items.length?<View style={s.emptyResults}><MaterialCommunityIcons name="face-recognition" size={42} color={colors.muted}/><Text style={s.emptyResultsTitle}>No recognition results yet</Text><Text style={s.muted}>Capture or upload a class photo to generate actual recognition results.</Text></View>:<View style={s.resultGrid}>{items.map((x,i)=><View key={x.student_id||i} style={s.resultCard}><View style={s.resultAvatar}><MaterialCommunityIcons name="account-outline" size={46} color={colors.navy}/></View><Text style={s.resultName}>{x.name||x.student_id||'Student'}</Text><Text style={s.resultMatch}>{x.status||x.match_percentage||'Review required'}</Text></View>)}</View>}{!!items.length&&<Pressable style={s.verifyRosterButton} onPress={()=>go('Verify Attendance')}><MaterialCommunityIcons name="account-check-outline" size={20} color={colors.navy}/><Text style={s.verifyRosterText}>Verify Full Roster Directory</Text></Pressable>}</>}
function VerifyFinalizeAttendance(){const [items,setItems]=useState<any[]>([]),[busy,setBusy]=useState(true);useEffect(()=>{http.get('/teacher/attendance/report').then(r=>setItems(r.data.records||[])).catch(()=>setItems([])).finally(()=>setBusy(false))},[]);const present=items.filter(x=>String(x.status||'').toLowerCase().includes('present')).length,absent=items.length-present;return <><View style={s.directoryHeader}><View><Text style={s.pageTitle}>Verify & Finalize Attendance</Text><Text style={s.muted}>Attendance records from the current teacher account</Text></View><View style={s.teacherTopAvatar}><MaterialCommunityIcons name="account" size={22} color={colors.navy}/></View></View><View style={s.rosterHeader}><Text style={s.rosterTitle}>COMPLETE ROSTER DIRECTORY</Text><Text style={s.rosterScroll}>Scroll to view all {items.length}</Text></View>{busy?<ActivityIndicator color={colors.navy}/>:!items.length?<View style={s.emptyResults}><MaterialCommunityIcons name="clipboard-check-outline" size={40} color={colors.muted}/><Text style={s.emptyResultsTitle}>No roster available</Text><Text style={s.muted}>Recognition results are required before verification.</Text></View>:items.map((x,i)=><View key={x.student_id||i} style={[s.rosterRow,x.override&&s.rosterOverride]}><View style={s.rosterAvatar}><MaterialCommunityIcons name="account-outline" size={28} color={colors.navy}/></View><View style={{flex:1}}><Text style={s.rosterName}>{x.name||x.student_id}</Text><Text style={s.rosterMeta}>{x.student_id} • <Text style={{color:String(x.status).toLowerCase().includes('present')?colors.green:colors.red}}>AI: {x.status||'Review required'} {x.match_percentage?`(${x.match_percentage})`:''}</Text></Text></View><Pressable style={s.radioOn}><View style={s.radioDot}/></Pressable><Pressable style={s.radioOff}><View style={s.radioEmpty}/></Pressable></View>)}{!!items.length&&<View style={s.finalizeFooter}><View style={s.finalizeTotals}><Text style={s.totalPresent}>Present: {present}</Text><Text style={s.totalAbsent}>Absent: {absent}</Text><Text style={s.totalAll}>Total: {items.length}</Text></View><Pressable style={s.finalizeButton} onPress={()=>Alert.alert('Attendance submitted','Attendance has been confirmed and submitted.')}><MaterialCommunityIcons name="check-circle-outline" size={19} color={colors.navy}/><Text style={s.finalizeText}>Confirm & Submit Attendance</Text></Pressable></View>}</>}
function AttendanceHistoryV2(){
 const [records,setRecords]=useState<any[]>([]),[month,setMonth]=useState(new Date()),[showDate,setShowDate]=useState(false),[busy,setBusy]=useState(true);
 useEffect(()=>{const value=month.toISOString().slice(0,7);setBusy(true);http.get('/teacher/attendance/report',{params:{month:value}}).then(r=>setRecords(Array.isArray(r.data?.records)?r.data.records:[])).catch(()=>setRecords([])).finally(()=>setBusy(false))},[month]);
 const sessions=Array.from(new Map(records.map(x=>[x.session_id,x])).values());
 const date=(x:any)=>x?new Date(x).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'}):'Unknown date';
 return <><View style={s.directoryHeader}><View><Text style={s.pageTitle}>Attendance History</Text><Text style={s.muted}>Teacher attendance records</Text></View><MaterialCommunityIcons name="bell-outline" size={25} color={colors.navy}/></View><Pressable style={s.historyCourse} onPress={()=>setShowDate(true)}><MaterialCommunityIcons name="calendar-month-outline" size={20} color={colors.navy}/><Text style={s.historyCourseText}>{month.toLocaleDateString(undefined,{month:'long',year:'numeric'})}</Text><MaterialCommunityIcons name="chevron-down" size={21} color={colors.muted}/></Pressable>{showDate&&<DateTimePicker value={month} mode="date" display="calendar" onChange={(_,d)=>{setShowDate(false);if(d)setMonth(d)}}/>}<View style={s.monthCard}><Text style={s.monthTitle}>{month.toLocaleDateString(undefined,{month:'long',year:'numeric'})} logs</Text>{busy?<ActivityIndicator color={colors.navy}/>:!records.length?<Text style={s.muted}>No attendance sessions recorded for this month.</Text>:<Text style={s.muted}>{sessions.length} session{sessions.length===1?'':'s'} • {records.length} attendance records</Text>}</View>{busy?null:sessions.map((x:any,i)=><View key={x.session_id||i} style={s.historySessionCard}><View style={s.historyIcon}><MaterialCommunityIcons name="calendar-check-outline" size={20} color={colors.navy}/></View><View style={{flex:1}}><Text style={s.historyName}>{date(x.timestamp)}</Text><Text style={s.historyTime}>Session {x.session_id}</Text><Text style={s.historyTime}>{records.filter(r=>r.session_id===x.session_id).length} recorded attendance entries</Text></View><MaterialCommunityIcons name="chevron-right" size={22} color={colors.navy}/></View>)}</>}
function Attendance({ go }: { go: (x: string) => void }) {
  return <TeacherTakeAttendanceV3 go={go} />;
}
function NotificationsV2(){
 const [tab,setTab]=useState<'all'|'unread'>('all'),[items,setItems]=useState<any[]>([]),[busy,setBusy]=useState(true);
 const load=()=>{setBusy(true);http.get('/notifications').then(r=>setItems(Array.isArray(r.data?.notifications)?r.data.notifications:[])).catch(()=>setItems([])).finally(()=>setBusy(false))};
 useEffect(load,[]);
 const visible=items.filter(x=>tab==='all'||!x.is_read);
 const iconFor=(category:string)=>category==='attendance'?'check-outline':category==='alert'?'alert-outline':category==='report'?'file-document-outline':category==='system'?'cog-outline':'bell-outline';
 const colorFor=(category:string)=>category==='alert'?colors.red:category==='attendance'?colors.navy:category==='report'?colors.navy:colors.navy;
 const markAll=async()=>{try{await http.post('/notifications/read-all');load()}catch{Alert.alert('Notifications','Unable to update notifications right now.')}};
 const markOne=async(id:number)=>{try{await http.post(`/notifications/${id}/read`);setItems(v=>v.map(x=>x.id===id?{...x,is_read:true}:x))}catch{}};
 return <><View style={s.notificationsHeader}><View><Text style={s.pageTitle}>Notifications</Text><Text style={s.muted}>Stay updated with student activity</Text></View><Pressable style={s.markRead} onPress={markAll}><Text style={s.markReadText}>Mark all read</Text></Pressable></View><View style={s.notificationTabs}><Pressable onPress={()=>setTab('all')} style={[s.notificationTab,tab==='all'&&s.notificationTabActive]}><Text style={[s.notificationTabText,tab==='all'&&s.notificationTabTextActive]}>All Notifications ({items.length})</Text></Pressable><Pressable onPress={()=>setTab('unread')} style={[s.notificationTab,tab==='unread'&&s.notificationTabActive]}><Text style={[s.notificationTabText,tab==='unread'&&s.notificationTabTextActive]}>Unread ({items.filter(x=>!x.is_read).length})</Text></Pressable></View>{busy?<ActivityIndicator color={colors.navy}/>:!visible.length?<View style={s.emptyResults}><MaterialCommunityIcons name="bell-off-outline" size={42} color={colors.muted}/><Text style={s.emptyResultsTitle}>No notifications</Text><Text style={s.muted}>New activity notifications will appear here.</Text></View>:<View style={s.notificationList}>{visible.map(x=><Pressable key={x.id} onPress={()=>!x.is_read&&markOne(x.id)} style={[s.notificationCard,!x.is_read&&s.notificationUnreadCard]}><View style={[s.notificationIcon,{backgroundColor:x.category==='alert'?colors.redPale:colors.bluePale}]}><MaterialCommunityIcons name={iconFor(x.category) as any} size={21} color={colorFor(x.category)}/></View><View style={{flex:1}}><Text style={s.notificationTitle}>{x.title}</Text><Text style={s.notificationBody}>{x.body}</Text><Text style={s.notificationTime}>{x.created_at?new Date(x.created_at).toLocaleString():''}</Text></View>{!x.is_read&&<View style={s.unreadDot}/>}</Pressable>)}</View>}</>;
}
function ReportsV2(){
 const [period,setPeriod]=useState('This Month'),[filters,setFilters]=useState(false),[busy,setBusy]=useState(true),[records,setRecords]=useState<any[]>([]);
 useEffect(()=>{const month=period==='This Month'?new Date().toISOString().slice(0,7):undefined;setBusy(true);http.get('/teacher/attendance/report',month?{params:{month}}:undefined).then(r=>setRecords(Array.isArray(r.data?.records)?r.data.records:[])).catch(()=>setRecords([])).finally(()=>setBusy(false))},[period]);
 const sessions=Array.from(new Map(records.map(x=>[x.session_id,x])).values());
 const formatDate=(value:any)=>value?new Date(value).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'Unknown date';
 const dateRange=records.length?`${formatDate(records[records.length-1].timestamp)} - ${formatDate(records[0].timestamp)}`:'No attendance data';
 return <><View style={s.directoryHeader}><View><Text style={s.pageTitle}>My Reports</Text><Text style={s.muted}>Attendance analytics</Text></View><MaterialCommunityIcons name="bell-outline" size={25} color={colors.navy}/></View><Card><View style={s.reportPeriodHead}><Text style={s.cardHead}>Time Period</Text><View style={s.reportDate}><MaterialCommunityIcons name="calendar-range-outline" size={18} color={colors.navy}/><Text style={s.reportDateText}>{dateRange}</Text></View></View><View style={s.reportPeriodTabs}>{['This Month','This Week','Custom'].map(x=><Pressable key={x} onPress={()=>setPeriod(x)} style={[s.reportTab,period===x&&s.reportTabActive]}><Text style={[s.reportTabText,period===x&&s.reportTabTextActive]}>{x}</Text></Pressable>)}</View></Card><Card><Text style={s.cardHead}>Cascading Filters</Text><View style={s.reportFilterRow}><View style={s.reportFilterChip}><Text style={s.reportFilterText}>No filters selected</Text></View><Pressable style={s.changeFilter} onPress={()=>setFilters(v=>!v)}><Text style={s.changeFilterText}>{filters?'Hide Filters':'Change Filters'}</Text></Pressable></View>{filters&&<AcademicCascade onApply={()=>setFilters(false)}/>}</Card>{busy?<ActivityIndicator color={colors.navy}/>:!records.length?<View style={s.emptyResults}><MaterialCommunityIcons name="chart-box-outline" size={42} color={colors.muted}/><Text style={s.emptyResultsTitle}>No report data yet</Text><Text style={s.muted}>Reports will appear after attendance has been recorded.</Text></View>:<><View style={s.reportMetrics}><View style={s.reportMetric}><Text style={s.reportMetricLabel}>Attendance Records</Text><Text style={[s.reportMetricValue,{color:colors.green}]}>{records.length}</Text></View><View style={s.reportMetric}><Text style={s.reportMetricLabel}>Sessions</Text><Text style={[s.reportMetricValue,{color:colors.navy}]}>{sessions.length}</Text></View><View style={s.reportMetric}><Text style={s.reportMetricLabel}>Students Present</Text><Text style={[s.reportMetricValue,{color:colors.navy}]}>{new Set(records.map(x=>x.student_id)).size}</Text></View></View><Card><View style={s.trendHead}><Text style={s.cardHead}>Attendance Sessions</Text><Text style={s.trendSection}>{sessions.length} total</Text></View>{sessions.map((x:any,i)=><View key={x.session_id||i} style={s.reportHistory}><View style={s.historyIcon}><MaterialCommunityIcons name="calendar-check-outline" size={19} color={colors.navy}/></View><View style={{flex:1}}><Text style={s.historyName}>{formatDate(x.timestamp)}</Text><Text style={s.historyTime}>Session {x.session_id} • {records.filter(r=>r.session_id===x.session_id).length} records</Text></View></View>)}</Card></>}</>;
}
function AdminProfileV2({onLogout}:{onLogout:()=>void}){
 const [profile,setProfile]=useState<any>(null),[busy,setBusy]=useState(true),[alerts,setAlerts]=useState(true);
 useEffect(()=>{http.get('/auth/profile').then(r=>setProfile(r.data?.profile||null)).catch(()=>{}).finally(()=>setBusy(false))},[]);
 const row=(icon:string,label:string,action:()=>void)=><Pressable style={s.adminSettingRow} onPress={action}><MaterialCommunityIcons name={icon as any} size={21} color={colors.navy}/><Text style={s.adminSettingText}>{label}</Text><MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted}/></Pressable>;
 const name=profile?.display_name||profile?.username||'Not provided';
 if(busy)return <ActivityIndicator color={colors.navy}/>;
 return <><View style={s.adminHero}><View style={s.adminAvatar}><MaterialCommunityIcons name="account-tie-outline" size={42} color={colors.navy}/></View><Text style={s.adminName}>{name}</Text><View style={s.adminBadge}><Text style={s.adminBadgeText}>Administrator</Text></View><Text style={s.adminEmail}>{profile?.email||'Email not provided'}</Text></View><View style={s.adminSettingsCard}><Text style={s.adminSectionTitle}>Account Settings</Text>{row('account-edit-outline','Edit Profile Info',()=>Alert.alert('Edit Profile Info','Use the profile editor to update your account.'))}{row('lock-outline','Change Account Password',()=>Alert.alert('Change Password','Password changes require the secure account recovery flow.'))}</View><View style={s.adminSettingsCard}><Text style={s.adminSectionTitle}>System Settings</Text>{row('bell-outline',`Notification Preferences (${alerts?'On':'Off'})`,()=>setAlerts(v=>!v))}</View><Pressable style={s.signOutButton} onPress={()=>Alert.alert('Sign Out','Sign out of this account?',[{text:'Sign Out',style:'destructive',onPress:onLogout},{text:'Cancel',style:'cancel'}])}><MaterialCommunityIcons name="logout" size={19} color={colors.red}/><Text style={s.signOutText}>Sign Out from Account</Text></Pressable></>;
}
function TeacherProfileV2({onLogout}:{onLogout:()=>void}){
 const [alerts,setAlerts]=useState(true),[profile,setProfile]=useState<any>(null),[assignments,setAssignments]=useState<any[]>([]),[busy,setBusy]=useState(true);
 useEffect(()=>{http.get('/teacher/profile').then(r=>{setProfile(r.data?.profile||null);setAssignments(Array.isArray(r.data?.assignments)?r.data.assignments:[])}).catch(()=>{}).finally(()=>setBusy(false))},[]);
 const row=(icon:string,title:string,subtitle:string,action:()=>void)=><Pressable style={s.teacherSettingRow} onPress={action}><MaterialCommunityIcons name={icon as any} size={21} color={colors.navy}/><View style={{flex:1}}><Text style={s.teacherSettingTitle}>{title}</Text><Text style={s.teacherSettingSub}>{subtitle}</Text></View><MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted}/></Pressable>;
 return <><View style={s.teacherProfileHero}><View style={s.teacherProfileAvatar}><MaterialCommunityIcons name="account" size={44} color={colors.navy}/></View><Text style={s.teacherProfileName}>{profile?.display_name||profile?.username||'Teacher'}</Text><View style={s.teacherProfileBadge}><Text style={s.adminBadgeText}>TEACHER</Text></View><Text style={s.teacherProfileSub}>{profile?.email||'Department not provided'}</Text></View><View style={s.teacherSubjectsCard}><Text style={s.adminSectionTitle}>Assigned Subjects</Text>{busy?<ActivityIndicator color={colors.navy}/>:assignments.length?assignments.map((x,i)=><View key={`${x.subject}-${x.section}-${i}`} style={s.subjectRow}><View style={[s.subjectIcon,{backgroundColor:i%2?colors.yellowPale:colors.bluePale}]}><MaterialCommunityIcons name="book-outline" size={21} color={i%2?colors.yellow:colors.navy}/></View><View><Text style={s.subjectName}>{x.subject}</Text><Text style={s.teacherSettingSub}>{x.section||'Section'} • {x.students||0} Students</Text></View></View>):<Text style={[s.teacherSettingSub,{padding:15}]}>No subjects assigned yet.</Text>}</View><Text style={s.teacherAccountTitle}>Account Settings</Text>{row('bell-outline','Notification Preferences',alerts?'Configure push & email alerts':'Notifications disabled',()=>setAlerts(v=>!v))}{row('lock-outline','Change Password','Update your secret credential',()=>Alert.alert('Change Password','Password changes require the secure account recovery flow.'))}{row('help-circle-outline','Help & Technical Support','Contact university support desk',()=>Alert.alert('Technical Support','Contact your university administrator for assistance.'))}<Pressable style={s.signOutButton} onPress={()=>Alert.alert('Sign Out','Sign out of this account?',[{text:'Sign Out',style:'destructive',onPress:onLogout},{text:'Cancel',style:'cancel'}])}><MaterialCommunityIcons name="logout" size={19} color={colors.red}/><Text style={s.signOutText}>Sign Out Account</Text></Pressable></>;
}
function StudentProfileLive({onLogout}:{onLogout:()=>void}){
 const [profile,setProfile]=useState<any>(null),[busy,setBusy]=useState(true);
 useEffect(()=>{http.get('/auth/profile').then(r=>setProfile(r.data?.profile||null)).catch(()=>{}).finally(()=>setBusy(false))},[]);
 const row=(icon:string,title:string,subtitle:string,action:()=>void)=><Pressable style={s.teacherSettingRow} onPress={action}><MaterialCommunityIcons name={icon as any} size={21} color={colors.navy}/><View style={{flex:1}}><Text style={s.teacherSettingTitle}>{title}</Text><Text style={s.teacherSettingSub}>{subtitle}</Text></View><MaterialCommunityIcons name="chevron-right" size={22} color={colors.muted}/></Pressable>;
 const value=(x:any)=>x||'Not provided';
 return <>{busy?<ActivityIndicator color={colors.navy}/>:<><View style={s.studentProfileHero}><View style={s.studentProfileAvatar}><MaterialCommunityIcons name="account-outline" size={44} color={colors.navy}/></View><Text style={s.studentProfileName}>{value(profile?.display_name||profile?.name||profile?.username)}</Text><View style={s.studentProfileBadge}><Text style={s.studentProfileBadgeText}>STUDENT • ID: {value(profile?.student_id)}</Text></View><Text style={s.studentProfileSub}>{value(profile?.program)}{profile?.semester?` • ${profile.semester}`:''}</Text></View><View style={s.studentAcademicCard}><Text style={s.adminSectionTitle}>Academic Details</Text><View style={s.studentDetailRow}><Text style={s.muted}>Department</Text><Text style={s.studentDetailValue}>{value(profile?.department)}</Text></View><View style={s.studentDetailRow}><Text style={s.muted}>Current GPA</Text><Text style={s.studentDetailValue}>{value(profile?.gpa)}</Text></View><View style={s.studentDetailRow}><Text style={s.muted}>Enrollment Year</Text><Text style={s.studentDetailValue}>{profile?.enrollment_year||'Not provided'}</Text></View></View>{row('account-check-outline','Face Registration',profile?.face_registered?'Active Face ID matched verified profile':'Face ID not registered',()=>Alert.alert('Face Registration',profile?.face_registered?'Face registration is active.':'Face registration is not available yet.'))}{row('bell-outline','Notification Preferences','Configure push & email alerts',()=>Alert.alert('Notification Preferences','Notification preferences are managed by your account.'))}{row('lock-outline','Change Password','Update your secret credential',()=>Alert.alert('Change Password','Password changes require the secure account recovery flow.'))}{row('theme-light-dark','App Theme','Choose your display theme',()=>Alert.alert('App Theme','Theme settings are coming from the app configuration.'))}<Pressable style={s.signOutButton} onPress={()=>Alert.alert('Sign Out','Sign out of this account?',[{text:'Sign Out',style:'destructive',onPress:onLogout},{text:'Cancel',style:'cancel'}])}><MaterialCommunityIcons name="logout" size={19} color={colors.red}/><Text style={s.signOutText}>Sign Out Account</Text></Pressable></>}</>;
}
function Row({ a, b }: { a: string; b: string }) {
  return (
    <View style={s.row}>
      <Text style={s.muted}>{a}</Text>
      <Text style={s.rowValue}>{b}</Text>
    </View>
  );
}
function Badge({ text, tone }: { text: string; tone: "green" | "yellow" }) {
  return (
    <View
      style={[
        s.badge,
        {
          backgroundColor:
            tone === "green" ? colors.greenPale : colors.yellowPale,
        },
      ]}
    >
      <Text
        style={[
          s.badgeText,
          { color: tone === "green" ? colors.green : "#9A7200" },
        ]}
      >
        {text}
      </Text>
    </View>
  );
}
function Card({ children }: { children: any }) {
  return <View style={s.card}>{children}</View>;
}
function ActionCard({ title, subtitle, onPress }: { title: string; subtitle: string; onPress?:()=>void }) {
  return (
    <Pressable style={s.action} onPress={onPress} disabled={!onPress}>
      <View style={s.actionIcon}>
        <Text>▣</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.actionTitle}>{title}</Text>
        <Text style={s.muted}>{subtitle}</Text>
      </View>
      <Text style={s.chev}>›</Text>
    </Pressable>
  );
}
const s = StyleSheet.create({
  notificationUnreadCard:{borderColor:colors.red,backgroundColor:colors.redPale},
  alignmentText:{color:'#fff',fontSize:11,fontWeight:'800'},captureHelp:{fontSize:12,color:colors.muted,textAlign:'center',lineHeight:17,marginTop:8},
  cameraFallback:{flex:1,alignItems:'center',justifyContent:'center',padding:20,gap:8},
  historySessionCard:{minHeight:76,borderWidth:1,borderColor:colors.line,borderRadius:14,backgroundColor:'#fff',padding:11,flexDirection:'row',alignItems:'center',gap:10,marginTop:10},
  studentProfileHero:{backgroundColor:colors.navy,marginHorizontal:-16,marginTop:-16,paddingTop:27,paddingBottom:24,alignItems:'center',borderBottomLeftRadius:23,borderBottomRightRadius:23},studentProfileAvatar:{width:80,height:80,borderRadius:45,backgroundColor:'#fff',borderWidth:3,borderColor:colors.yellow,alignItems:'center',justifyContent:'center',marginBottom:12},studentProfileName:{fontSize:21,fontWeight:'900',color:'#fff'},studentProfileBadge:{backgroundColor:colors.yellow,borderRadius:10,paddingHorizontal:11,paddingVertical:4,marginTop:5},studentProfileBadgeText:{fontSize:11,fontWeight:'900',color:colors.navy},studentProfileSub:{fontSize:13,color:'#D9E1F0',marginTop:6},studentAcademicCard:{backgroundColor:'#fff',borderWidth:1,borderColor:colors.line,borderRadius:15,marginTop:16,paddingTop:15,paddingBottom:8},studentDetailRow:{flexDirection:'row',justifyContent:'space-between',paddingHorizontal:15,paddingVertical:6},studentDetailValue:{fontSize:13,fontWeight:'800',color:colors.text},
  classLiveCard:{minHeight:112,borderWidth:1,borderColor:colors.line,borderRadius:15,backgroundColor:'#fff',padding:15,flexDirection:'row',alignItems:'flex-start',gap:10,marginTop:16},classLiveTitle:{fontSize:14,fontWeight:'900',color:colors.navy,marginBottom:3},classLiveMeta:{fontSize:12,color:colors.muted,marginTop:12},roomBadge:{backgroundColor:colors.bluePale,borderRadius:8,paddingHorizontal:9,paddingVertical:7},roomBadgeText:{fontSize:11,fontWeight:'900',color:colors.navy},
  subjectFilterScroll:{marginTop:10,marginBottom:10},subjectFilter:{paddingHorizontal:14,paddingVertical:7,borderRadius:16,borderWidth:1,borderColor:colors.line,backgroundColor:'#fff',marginRight:8},subjectFilterActive:{backgroundColor:colors.navy,borderColor:colors.navy},subjectFilterText:{fontSize:12,fontWeight:'700',color:colors.muted},subjectFilterTextActive:{color:'#fff'},attendanceMonthPicker:{borderWidth:1,borderColor:colors.line,borderRadius:15,backgroundColor:'#fff',padding:14,flexDirection:'row',alignItems:'center',gap:8},attendanceCalendar:{borderWidth:1,borderColor:colors.line,borderRadius:15,backgroundColor:'#fff',padding:14,marginTop:10},weekRow:{flexDirection:'row',justifyContent:'space-around',marginBottom:10},weekDay:{fontSize:12,color:colors.muted,fontWeight:'800'},dayRow:{flexDirection:'row',justifyContent:'space-around',alignItems:'center',minHeight:34},dayDot:{width:27,height:27,borderRadius:15,alignItems:'center',justifyContent:'center'},dayDotText:{color:'#fff',fontSize:11,fontWeight:'900'},recentHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:14},attendanceLogCard:{minHeight:66,borderWidth:1,borderColor:colors.line,borderRadius:15,backgroundColor:'#fff',padding:11,flexDirection:'row',alignItems:'center',gap:10,marginBottom:10},logDot:{width:8,height:8,borderRadius:5},
  studentAttendanceCard:{borderWidth:1,borderColor:colors.line,borderRadius:15,backgroundColor:'#fff',padding:15,flexDirection:'row',alignItems:'center',gap:16,marginTop:16},studentRing:{width:82,height:82,borderRadius:44,borderWidth:10,borderColor:colors.green,alignItems:'center',justifyContent:'center'},studentRingText:{fontSize:18,fontWeight:'900',color:colors.navy},studentMetricRow:{flexDirection:'row',gap:12,marginTop:16},studentMetric:{flex:1,borderWidth:1,borderColor:colors.line,borderRadius:12,backgroundColor:'#fff',padding:11},studentMetricValue:{fontSize:21,fontWeight:'900',color:colors.navy,marginTop:4},studentClassCard:{minHeight:72,borderWidth:1,borderColor:colors.line,borderRadius:15,backgroundColor:'#fff',padding:12,flexDirection:'row',alignItems:'center',gap:11,marginBottom:12},
  teacherProfileHero:{backgroundColor:colors.navy,marginHorizontal:-16,marginTop:-16,paddingTop:27,paddingBottom:24,alignItems:'center',borderBottomLeftRadius:23,borderBottomRightRadius:23},teacherProfileAvatar:{width:80,height:80,borderRadius:45,backgroundColor:'#fff',borderWidth:3,borderColor:colors.yellow,alignItems:'center',justifyContent:'center',marginBottom:12},teacherProfileName:{fontSize:21,fontWeight:'900',color:'#fff'},teacherProfileBadge:{backgroundColor:colors.yellow,borderRadius:10,paddingHorizontal:11,paddingVertical:4,marginTop:5},teacherProfileSub:{fontSize:13,color:'#D9E1F0',marginTop:6},teacherSubjectsCard:{backgroundColor:'#fff',borderWidth:1,borderColor:colors.line,borderRadius:15,marginTop:16,paddingTop:15,paddingBottom:8},subjectRow:{flexDirection:'row',alignItems:'center',gap:11,paddingHorizontal:15,paddingVertical:7},subjectIcon:{width:34,height:34,borderRadius:8,alignItems:'center',justifyContent:'center'},subjectName:{fontSize:14,fontWeight:'900',color:colors.text},teacherAccountTitle:{fontSize:14,fontWeight:'900',color:colors.navy,marginTop:17,marginBottom:8},teacherSettingRow:{minHeight:55,borderWidth:1,borderColor:colors.line,borderRadius:12,backgroundColor:'#fff',paddingHorizontal:13,flexDirection:'row',alignItems:'center',gap:10,marginBottom:10},teacherSettingTitle:{fontSize:14,fontWeight:'800',color:colors.text},teacherSettingSub:{fontSize:11,color:colors.muted,marginTop:2},
  historyCourse:{height:44,borderWidth:1,borderColor:colors.line,borderRadius:11,backgroundColor:'#fff',marginTop:16,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:8},historyCourseText:{flex:1,fontSize:14,fontWeight:'800',color:colors.navy},monthCard:{backgroundColor:'#fff',borderWidth:1,borderColor:colors.line,borderRadius:15,padding:16,marginTop:16},monthTitle:{fontSize:16,fontWeight:'900',color:colors.navy},
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  login: { padding: 22, paddingTop: 48 },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 24,
    backgroundColor: "#19355F",
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    elevation: 5,
  },
  logoText: { fontSize: 34, color: colors.yellow },
  brand: {
    fontSize: 28,
    fontWeight: "900",
    color: colors.navy,
    textAlign: "center",
    marginTop: 14,
  },
  tag: { textAlign: "center", color: colors.muted, marginTop: 4 },
  loginTitle: { alignItems: "center", marginTop: 36, marginBottom: 28 },
  h1: { fontSize: 24, fontWeight: "900", color: colors.navy },
  muted: { fontSize: 13, color: colors.muted, lineHeight: 18 },
  field: { marginBottom: 16 },
  label: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.navy,
    marginBottom: 8,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    color: colors.text,
    fontSize: 14,
  },
  forgot: {
    color: colors.navy,
    fontWeight: "800",
    textAlign: "right",
    marginTop: -4,
  },
  choose: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.muted,
    textAlign: "center",
    marginTop: 30,
  },
  roleRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
  },
  rolePill: {
    paddingHorizontal: 18,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: "#F3F4F8",
  },
  rolePillActive: { backgroundColor: colors.navy },
  roleText: { fontWeight: "800", color: colors.muted },
  roleTextActive: { color: "#fff" },
  error: { color: colors.red, textAlign: "center", marginTop: 14 },
  signIn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 70,
    elevation: 4,
  },
  signText: { fontSize: 16, fontWeight: "900", color: colors.navy },
  yellowLine: {
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.yellow,
    marginTop: 24,
  },
  top: {
    height: 78,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    padding: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  topBrand: { fontSize: 20, fontWeight: "900", color: colors.navy },
  topSub: { fontSize: 12, color: colors.muted },
  bell: {
    width: 38,
    height: 38,
    borderRadius: 20,
    backgroundColor: "#F5F7FC",
    alignItems: "center",
    justifyContent: "center",
  },
  topActions:{flexDirection:'row',alignItems:'center',gap:10},topAvatar:{width:34,height:34,borderRadius:18,backgroundColor:colors.navy,alignItems:'center',justifyContent:'center'},topAvatarText:{color:'#fff',fontWeight:'900'},notificationDot:{position:'absolute',right:7,top:7,width:6,height:6,borderRadius:4,backgroundColor:colors.red},
  body: { padding: 16, paddingBottom: 28 },
  nav: {
    height: 76,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: colors.line,
    flexDirection: "row",
    justifyContent: "space-around",
    paddingTop: 9,
  },
  navItem: { alignItems: "center", minWidth: 55 },
  navIcon: { fontSize: 21, color: "#727787" },
  navText: { fontSize: 10, color: "#626879", marginTop: 4 },
  navActive: { color: colors.navy, fontWeight: "900" },
  greeting: { fontSize: 24, fontWeight: "900", color: colors.navy },
  pageTitle: {
    fontSize: 22,
    fontWeight: "900",
    color: colors.navy,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: colors.navy,
    marginTop: 22,
    marginBottom: 10,
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 18,
  },
  adminMetricGrid:{flexDirection:'row',flexWrap:'wrap',gap:12},
  adminMetric:{width:'47%',minHeight:108,borderRadius:16,padding:14},
  metricTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  metricIcon:{fontSize:25,fontWeight:'900'},
  metricBadge:{fontSize:10,fontWeight:'900',color:colors.navy,backgroundColor:'#FFFFFFCC',paddingHorizontal:6,paddingVertical:4,borderRadius:8},
  adminMetricValue:{fontSize:26,fontWeight:'900',color:colors.navy,marginTop:12},
  activityHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  viewAll:{color:'#C08B00',fontWeight:'900',marginTop:22},
  activityCard:{backgroundColor:'#F4F5F9',borderRadius:14,minHeight:60,padding:12,marginTop:10,flexDirection:'row',alignItems:'center'},
  activityIcon:{width:34,height:34,borderRadius:18,alignItems:'center',justifyContent:'center',marginRight:10},
  metric: { width: "47%", borderRadius: 16, padding: 15, minHeight: 106 },
  metricValue: {
    fontSize: 26,
    fontWeight: "900",
    color: colors.navy,
    marginTop: 16,
  },
  metricLabel: { fontSize: 12, color: colors.muted, marginTop: 5 },
  yellowButton: {
    height: 54,
    borderRadius: 16,
    backgroundColor: colors.yellow,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 10,
  },
  buttonText: { fontSize: 15, fontWeight: "900", color: colors.navy },
  darkButton: {
    height: 112,
    borderRadius: 18,
    backgroundColor: colors.navy,
    alignItems: "center",
    justifyContent: "center",
    marginVertical: 10,
  },
  whiteButton: {
    fontSize: 16,
    fontWeight: "900",
    color: "#fff",
    marginBottom: 6,
  },
  quickRow: { flexDirection: "row", gap: 8 },
  quick: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 12,
    alignItems: "center",
  },
  quickText: { fontSize: 11, fontWeight: "800", color: colors.navy },
  card: {
    backgroundColor: "#fff",
    borderRadius: 17,
    padding: 16,
    marginTop: 12,
  },
  cardHead: {
    fontSize: 15,
    fontWeight: "900",
    color: colors.navy,
    marginBottom: 10,
  },
  course: { fontSize: 15, fontWeight: "900", color: colors.navy },
  action: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 13,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  actionIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.bluePale,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  actionTitle: { fontSize: 14, fontWeight: "900", color: colors.navy },
  chev: { fontSize: 26, color: colors.muted },
  search: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: "#fff",
    paddingHorizontal: 15,
    marginTop: 16,
    marginBottom: 8,
  },
  fab: {
    position: "absolute",
    right: 16,
    bottom: 18,
    width: 58,
    height: 58,
    borderRadius: 30,
    backgroundColor: colors.yellow,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
  },
  fabText: { fontSize: 32, color: colors.navy },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginVertical: 7,
  },
  badgeText: { fontSize: 11, fontWeight: "900" },
  bigGreen: {
    fontSize: 38,
    fontWeight: "900",
    color: colors.green,
    marginVertical: 6,
  },
  profileHero: {
    backgroundColor: colors.navy,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    alignItems: "center",
    padding: 22,
    marginHorizontal: -16,
    marginTop: -16,
  },
  profileAvatar: {
    width: 82,
    height: 82,
    borderRadius: 42,
    borderWidth: 3,
    borderColor: colors.yellow,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  profileInitial: { fontSize: 34, fontWeight: "900", color: colors.navy },
  profileName: {
    fontSize: 21,
    fontWeight: "900",
    color: "#fff",
    marginTop: 12,
  },
  profileSub: { color: "#DCE4F4", fontSize: 13 },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 9 },
  rowValue: { fontWeight: "800", color: colors.text },
  signOut: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  signOutText: { fontWeight: "900", color: colors.red },
  chart: {
    height: 120,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-around",
    padding: 15,
  },
  bar: { height: 80, width: 20, backgroundColor: colors.navy, borderRadius: 5 },
  formHeading:{fontSize:14,fontWeight:'900',color:colors.navy,marginTop:22,marginBottom:10},
  outlineButton:{height:50,borderRadius:14,borderWidth:1.5,borderColor:colors.navy,alignItems:'center',justifyContent:'center',marginTop:10},
  outlineText:{fontWeight:'900',color:colors.navy},
  addHeader:{height:70,flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:colors.line,marginHorizontal:-16,paddingHorizontal:16,marginBottom:4},
  backCircle:{width:32,height:32,borderRadius:18,backgroundColor:colors.bluePale,alignItems:'center',justifyContent:'center',marginRight:10},
  backText:{fontSize:28,color:colors.navy,lineHeight:30},
  addTitle:{fontSize:20,fontWeight:'900',color:colors.navy},
  headerBell:{fontSize:24,color:colors.navy},
  twoFields:{flexDirection:'row',gap:12},
  selectBox:{height:48,borderWidth:1,borderColor:colors.line,borderRadius:11,backgroundColor:'#fff',paddingHorizontal:12,flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:14},
  selectText:{fontSize:14,color:colors.text},selectChevron:{fontSize:20,color:colors.muted},
  selectDisabled:{backgroundColor:'#F1F3F7',borderColor:'#E4E7EE'},selectTextDisabled:{color:'#A1A6B2'},
  dropdownMenu:{borderWidth:1,borderColor:colors.navy,borderRadius:11,backgroundColor:'#fff',marginTop:-8,marginBottom:14,overflow:'hidden',elevation:4},
  dropdownOption:{minHeight:44,paddingHorizontal:14,paddingVertical:10,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:'#EEF0F4'},dropdownOptionActive:{backgroundColor:colors.bluePale},dropdownOptionText:{fontSize:14,color:colors.text,flex:1},dropdownOptionTextActive:{fontWeight:'800',color:colors.navy},
  applyFilterButton:{height:46,borderRadius:11,backgroundColor:colors.yellow,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8,marginBottom:14},applyFilterDisabled:{opacity:.45},applyFilterText:{fontSize:14,fontWeight:'900',color:colors.navy},
  academicSearch:{height:48,borderRadius:12,borderWidth:1,borderColor:colors.line,backgroundColor:'#F7F8FC',flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:12,marginTop:16,marginBottom:16},academicSearchInput:{flex:1,color:colors.text,fontSize:14},academicCount:{marginLeft:'auto',marginRight:7},courseCount:{marginLeft:'auto',flexDirection:'row',alignItems:'center',gap:4},
  reportPeriodHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},reportDate:{flexDirection:'row',alignItems:'center',gap:5},reportDateText:{fontSize:13,fontWeight:'800',color:colors.navy},reportPeriodTabs:{flexDirection:'row',gap:8,marginTop:10},reportTab:{paddingHorizontal:12,paddingVertical:7,borderRadius:14,backgroundColor:'#F1F2F6'},reportTabActive:{backgroundColor:colors.navy},reportTabText:{fontSize:11,fontWeight:'800',color:colors.muted},reportTabTextActive:{color:'#fff'},reportFilterRow:{flexDirection:'row',alignItems:'center',gap:8,marginTop:10},reportFilterChip:{backgroundColor:colors.bluePale,borderRadius:8,paddingHorizontal:10,paddingVertical:6},reportFilterText:{fontSize:11,fontWeight:'700',color:colors.navy},changeFilter:{borderWidth:1,borderColor:colors.navy,borderRadius:8,paddingHorizontal:9,paddingVertical:5},changeFilterText:{fontSize:11,fontWeight:'800',color:colors.navy},reportMetrics:{flexDirection:'row',gap:10,marginBottom:16},reportMetric:{flex:1,minHeight:72,borderWidth:1,borderColor:colors.line,borderRadius:13,backgroundColor:'#fff',padding:10},reportMetricLabel:{fontSize:11,color:colors.muted},reportMetricValue:{fontSize:23,fontWeight:'900',marginTop:5},trendHead:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},trendSection:{fontSize:11,color:colors.muted,fontWeight:'700'},reportChart:{height:125,flexDirection:'row',alignItems:'flex-end',justifyContent:'space-around',marginTop:8},reportBarWrap:{height:125,alignItems:'center',justifyContent:'flex-end',gap:6},reportBar:{width:20,borderRadius:4},reportDay:{fontSize:11,color:colors.text},exportRow:{flexDirection:'row',gap:12,marginBottom:16},exportPrimary:{flex:1,height:42,borderRadius:11,backgroundColor:colors.navy,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7},exportPrimaryText:{color:'#fff',fontWeight:'900',fontSize:13},exportSecondary:{flex:1,height:42,borderRadius:11,borderWidth:1.5,borderColor:colors.navy,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7},exportSecondaryText:{color:colors.navy,fontWeight:'900',fontSize:13},historyTitle:{fontSize:15,fontWeight:'900',color:colors.navy,marginBottom:8},reportHistory:{minHeight:59,borderWidth:1,borderColor:colors.line,borderRadius:12,backgroundColor:'#fff',padding:10,flexDirection:'row',alignItems:'center',gap:10,marginBottom:8},historyIcon:{width:34,height:34,borderRadius:18,backgroundColor:colors.bluePale,alignItems:'center',justifyContent:'center'},historyName:{fontSize:13,fontWeight:'800',color:colors.navy},historyTime:{fontSize:11,color:colors.muted,marginTop:3},
  notificationsHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingTop:10},markRead:{backgroundColor:'#F2F4F9',paddingHorizontal:13,paddingVertical:8,borderRadius:16},markReadText:{fontSize:11,fontWeight:'800',color:colors.navy},notificationTabs:{height:49,flexDirection:'row',borderBottomWidth:1,borderBottomColor:colors.line,marginHorizontal:-16,marginTop:10,paddingHorizontal:16},notificationTab:{flex:1,alignItems:'center',justifyContent:'center',borderBottomWidth:2,borderBottomColor:'transparent'},notificationTabActive:{borderBottomColor:colors.yellow},notificationTabText:{fontSize:13,color:colors.muted,fontWeight:'700'},notificationTabTextActive:{color:colors.navy},notificationList:{paddingTop:17},notificationCard:{minHeight:89,borderWidth:1,borderColor:colors.line,borderRadius:15,backgroundColor:'#fff',padding:11,flexDirection:'row',gap:11,marginBottom:11},notificationIcon:{width:37,height:37,borderRadius:20,alignItems:'center',justifyContent:'center'},notificationTitle:{fontSize:13,fontWeight:'900',color:colors.navy},notificationBody:{fontSize:12,color:colors.muted,lineHeight:16,marginTop:3},notificationTime:{fontSize:10,color:colors.muted,marginTop:2,fontWeight:'700'},unreadDot:{width:8,height:8,borderRadius:5,backgroundColor:colors.red,marginTop:5},adminHero:{backgroundColor:colors.navy,marginHorizontal:-16,marginTop:-16,paddingTop:27,paddingBottom:24,alignItems:'center',borderBottomLeftRadius:23,borderBottomRightRadius:23},adminAvatar:{width:88,height:88,borderRadius:48,backgroundColor:'#fff',alignItems:'center',justifyContent:'center',marginBottom:10},adminName:{fontSize:21,fontWeight:'900',color:'#fff'},adminBadge:{backgroundColor:colors.yellow,borderRadius:8,paddingHorizontal:12,paddingVertical:4,marginTop:5},adminBadgeText:{fontSize:11,fontWeight:'900',color:colors.navy},adminEmail:{fontSize:12,color:'#101B31',marginTop:5},adminSettingsCard:{backgroundColor:'#fff',borderWidth:1,borderColor:colors.line,borderRadius:15,marginTop:15,overflow:'hidden',paddingTop:15},adminSectionTitle:{fontSize:13,fontWeight:'900',color:colors.navy,paddingHorizontal:15,paddingBottom:6},adminSettingRow:{height:45,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:15,borderTopWidth:1,borderTopColor:'#EEF0F4'},adminSettingText:{fontSize:14,color:colors.text,flex:1},signOutButton:{height:47,borderWidth:1.5,borderColor:colors.red,borderRadius:12,marginTop:13,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},
  attendanceToolbar:{flexDirection:'row',alignItems:'center',gap:10,marginTop:16},dateBox:{height:44,borderRadius:11,borderWidth:1,borderColor:colors.line,backgroundColor:'#F7F8FC',flex:1,flexDirection:'row',alignItems:'center',gap:9,paddingHorizontal:12},dateText:{fontSize:14,fontWeight:'700',color:colors.text},attendanceStats:{flexDirection:'row',gap:10,marginTop:16,marginBottom:15},attendanceStat:{flex:1,height:60,borderRadius:12,alignItems:'center',justifyContent:'center'},statGreen:{backgroundColor:colors.greenPale},statRed:{backgroundColor:colors.redPale},statYellow:{backgroundColor:colors.yellowPale},statNumber:{fontSize:18,fontWeight:'900'},statLabel:{fontSize:11,color:colors.muted,marginTop:2},attendanceColumn:{flexDirection:'row',justifyContent:'space-between',paddingHorizontal:4,marginBottom:7},columnTitle:{fontSize:12,fontWeight:'800',color:colors.muted,textTransform:'uppercase'},attendanceRecord:{minHeight:60,borderRadius:12,backgroundColor:'#F4F5F9',marginBottom:8,padding:10,flexDirection:'row',alignItems:'center',gap:10},recordAvatar:{width:37,height:37,borderRadius:20,backgroundColor:colors.bluePale,alignItems:'center',justifyContent:'center'},statusBadge:{paddingHorizontal:10,paddingVertical:6,borderRadius:10},
  photoBox:{height:118,borderWidth:1.5,borderStyle:'dashed',borderColor:colors.line,borderRadius:15,backgroundColor:'#F7F8FC',alignItems:'center',justifyContent:'center'},
  photoIcon:{fontSize:28,color:colors.navy},photoTitle:{fontWeight:'900',color:colors.navy,marginTop:5},photoHint:{fontSize:11,color:colors.muted,marginTop:4},
  addActions:{flexDirection:'row',gap:12,marginTop:34,borderTopWidth:1,borderTopColor:colors.line,paddingTop:14},
  cancelButton:{flex:1,height:50,borderWidth:1.5,borderColor:colors.navy,borderRadius:13,alignItems:'center',justifyContent:'center'},
  saveButton:{flex:1,height:50,borderRadius:13,backgroundColor:colors.yellow,alignItems:'center',justifyContent:'center'},
  directoryHeader:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginBottom:8},teacherTopAvatar:{width:38,height:38,borderRadius:20,backgroundColor:colors.greenPale,alignItems:'center',justifyContent:'center'},myStudentsSearch:{height:44,borderRadius:11,borderWidth:1,borderColor:colors.line,backgroundColor:'#fff',flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:12,marginTop:18},myStudentsInput:{flex:1,fontSize:14,color:colors.text},courseChip:{alignSelf:'flex-start',backgroundColor:colors.navy,borderRadius:14,paddingHorizontal:13,paddingVertical:6,marginTop:16},courseChipText:{fontSize:11,fontWeight:'800',color:'#fff'},readOnlyBanner:{height:40,borderRadius:10,backgroundColor:colors.bluePale,flexDirection:'row',alignItems:'center',gap:8,paddingHorizontal:12,marginTop:16,marginBottom:16},readOnlyText:{fontSize:11,color:colors.navy},myStudentCard:{minHeight:73,borderRadius:16,borderWidth:1,borderColor:colors.line,backgroundColor:'#fff',padding:10,flexDirection:'row',alignItems:'center',gap:10,marginBottom:10},myStudentAvatar:{width:48,height:48,borderRadius:25,backgroundColor:'#E9EEF6',alignItems:'center',justifyContent:'center'},myAttendance:{minWidth:46,height:32,borderRadius:11,alignItems:'center',justifyContent:'center',paddingHorizontal:8},
  searchRow:{flexDirection:'row',alignItems:'center',gap:10,marginTop:12},searchIcon:{position:'absolute',left:12,top:12,zIndex:2},directorySearch:{height:48,borderRadius:12,borderWidth:1,borderColor:colors.line,backgroundColor:'#F7F8FC',paddingLeft:42,paddingRight:12,color:colors.text},filterButton:{width:42,height:42,borderRadius:12,borderWidth:1.2,borderColor:colors.navy,alignItems:'center',justifyContent:'center'},chips:{gap:8,paddingVertical:16},filterChip:{paddingHorizontal:12,paddingVertical:6,borderRadius:14,backgroundColor:'#F1F2F6'},filterChipActive:{backgroundColor:colors.navy},filterChipText:{fontSize:11,fontWeight:'800',color:colors.muted},filterChipTextActive:{color:'#fff'},
  studentRow:{minHeight:73,borderRadius:16,borderWidth:1,borderColor:colors.line,backgroundColor:'#F7F8FC',padding:11,marginBottom:10,flexDirection:'row',alignItems:'center'},studentAvatar:{width:48,height:48,borderRadius:25,backgroundColor:'#E9EEF6',alignItems:'center',justifyContent:'center',marginRight:11},studentName:{fontSize:14,fontWeight:'900',color:colors.navy},studentId:{fontSize:12,fontWeight:'700',color:colors.muted,marginTop:2},studentMeta:{fontSize:11,color:colors.muted,marginTop:2},attendanceBadge:{minWidth:46,height:32,borderRadius:12,alignItems:'center',justifyContent:'center'},directoryFab:{position:'relative',alignSelf:'flex-end',marginTop:220,marginRight:0,marginBottom:16,width:58,height:58,borderRadius:30,backgroundColor:colors.yellow,alignItems:'center',justifyContent:'center',elevation:5},
  schoolCard:{borderWidth:1,borderColor:colors.line,borderRadius:15,backgroundColor:'#F5F6FA',marginTop:16,overflow:'hidden'},schoolOpen:{borderColor:colors.navy,backgroundColor:colors.bluePale},
  schoolHeader:{minHeight:58,flexDirection:'row',alignItems:'center',paddingHorizontal:14},schoolIcon:{fontSize:22,color:colors.navy,marginRight:10},schoolName:{flex:1,fontSize:14,fontWeight:'900',color:colors.navy},deptCount:{fontSize:10,fontWeight:'900',color:'#fff',backgroundColor:colors.navy,borderRadius:8,paddingHorizontal:8,paddingVertical:5},
  facultyCard:{backgroundColor:'#fff',borderRadius:12,margin:0,padding:10},facultyHeader:{flexDirection:'row',alignItems:'center',paddingVertical:5},facultyIcon:{fontSize:20,color:colors.navy,marginRight:8},facultyName:{flex:1,fontSize:13,fontWeight:'900',color:colors.navy},departmentRow:{flexDirection:'row',alignItems:'center',paddingLeft:30,paddingVertical:5},departmentDot:{color:colors.muted,marginRight:6},departmentName:{flex:1,fontSize:11,color:colors.muted},sectionCount:{fontSize:11,fontWeight:'900',color:'#D39B00'},
  bioHeader:{height:70,flexDirection:'row',alignItems:'center',borderBottomWidth:1,borderBottomColor:colors.line,marginHorizontal:-16,paddingHorizontal:16},
  stepRow:{height:48,flexDirection:'row',alignItems:'center',paddingHorizontal:8,borderBottomWidth:1,borderBottomColor:colors.line},
  stepDot:{width:24,height:24,borderRadius:13,backgroundColor:'#E9EBF1',alignItems:'center',justifyContent:'center'},
  stepDotActive:{backgroundColor:colors.yellow},stepNumber:{fontSize:12,fontWeight:'900',color:colors.navy},stepLabel:{fontSize:11,fontWeight:'700',color:colors.muted,marginHorizontal:4},stepLabelActive:{color:colors.navy},stepLine:{height:1,backgroundColor:colors.line,flex:1,marginHorizontal:3},
  cameraFrame:{height:360,borderRadius:22,overflow:'hidden',marginTop:20,backgroundColor:'#D7DCE5',alignItems:'center',justifyContent:'center'},camera:{...StyleSheet.absoluteFillObject},faceOval:{height:310,width:190,borderRadius:100,borderWidth:4,borderColor:colors.yellow},alignment:{position:'absolute',bottom:12,left:12,color:'#fff',backgroundColor:'#222B',paddingHorizontal:9,paddingVertical:5,borderRadius:6,fontSize:11},captureTitle:{fontSize:18,fontWeight:'900',color:colors.navy,textAlign:'center',marginTop:18},captureGuide:{fontSize:13,color:colors.muted,textAlign:'center',lineHeight:18,marginTop:6},captureButton:{width:72,height:72,borderRadius:40,borderWidth:4,borderColor:colors.yellow,backgroundColor:colors.navy,alignSelf:'center',marginTop:34,alignItems:'center',justifyContent:'center'},captureInner:{width:54,height:54,borderRadius:30,borderWidth:2,borderColor:'#fff'},captureStatus:{textAlign:'center',fontSize:12,color:colors.muted,marginTop:10},adminDirectoryRow:{minHeight:72,borderWidth:1,borderColor:colors.line,borderRadius:13,backgroundColor:'#F4F5F9',padding:10,flexDirection:'row',alignItems:'center',gap:10,marginBottom:9},rowActions:{flexDirection:'row',alignItems:'center',gap:16,paddingHorizontal:4},
  detailIdentity:{alignItems:'center',padding:18,margin:-16,marginBottom:8,backgroundColor:colors.bluePale,borderTopLeftRadius:17,borderTopRightRadius:17},detailName:{fontSize:21,fontWeight:'900',color:colors.navy,marginTop:9},detailRole:{fontSize:12,fontWeight:'800',color:colors.muted,marginTop:4},detailLabel:{fontSize:10,fontWeight:'900',color:colors.muted,marginTop:14,textTransform:'uppercase',letterSpacing:.5},detailValue:{fontSize:14,fontWeight:'700',color:colors.text,marginTop:3},detailActions:{flexDirection:'row',gap:12,marginTop:16},editAction:{flex:1,height:50,borderWidth:1.5,borderColor:colors.navy,borderRadius:13,backgroundColor:colors.bluePale,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7},editActionText:{fontWeight:'900',color:colors.navy},deleteAction:{flex:1,height:50,borderWidth:1.5,borderColor:colors.red,borderRadius:13,backgroundColor:colors.redPale,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7},deleteActionText:{fontWeight:'900',color:colors.red},
  teacherMetricGrid:{flexDirection:'row',flexWrap:'wrap',gap:12},teacherMetric:{width:'48%',height:108,borderRadius:16,padding:14},teacherMetricValue:{fontSize:25,fontWeight:'900',color:colors.navy,marginTop:7},teacherMetricLabel:{fontSize:12,color:colors.muted,marginTop:2},teacherAttendanceButton:{height:52,borderRadius:15,backgroundColor:colors.yellow,marginTop:20,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9},teacherAttendanceText:{fontSize:16,fontWeight:'900',color:colors.navy},teacherScheduleCard:{backgroundColor:'#fff',borderWidth:1,borderColor:colors.line,borderRadius:17,marginTop:20,padding:15},teacherClassRow:{minHeight:58,flexDirection:'row',alignItems:'center',borderTopWidth:1,borderTopColor:colors.line,marginTop:8,paddingTop:8},teacherClassTitle:{fontSize:13,fontWeight:'900',color:colors.navy},teacherClassMeta:{fontSize:11,color:colors.muted,marginTop:4},
  courseSectionCard:{backgroundColor:'#fff',borderWidth:1,borderColor:colors.line,borderRadius:15,padding:12,marginTop:16},courseSectionLabel:{fontSize:10,fontWeight:'900',color:colors.muted},courseSectionRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:6},expectedCard:{backgroundColor:colors.bluePale,borderRadius:15,padding:13,marginTop:16,flexDirection:'row',alignItems:'center',gap:12},expectedTitle:{fontSize:14,fontWeight:'900',color:colors.navy},expectedMeta:{fontSize:11,color:colors.muted,marginTop:3},captureClassButton:{height:122,borderRadius:17,backgroundColor:colors.navy,marginTop:16,alignItems:'center',justifyContent:'center'},captureClassTitle:{fontSize:16,fontWeight:'900',color:'#fff',marginTop:6},captureClassSub:{fontSize:12,color:'#101B31',marginTop:3},uploadClassButton:{height:122,borderRadius:17,backgroundColor:colors.yellow,marginTop:12,alignItems:'center',justifyContent:'center'},uploadClassTitle:{fontSize:16,fontWeight:'900',color:colors.navy,marginTop:6},uploadClassSub:{fontSize:12,color:'#8B6500',marginTop:3},recognitionGuide:{borderWidth:1,borderColor:colors.line,borderRadius:12,padding:11,marginTop:16},guideTitle:{fontSize:10,fontWeight:'900',color:colors.navy},guideText:{fontSize:11,color:colors.muted,marginTop:4,lineHeight:14},
  reviewBanner:{backgroundColor:colors.yellowPale,marginHorizontal:-16,padding:12,flexDirection:'row',alignItems:'center',gap:8,marginTop:10},reviewText:{fontSize:12,fontWeight:'700',color:colors.navy},emptyResults:{borderWidth:1,borderColor:colors.line,borderRadius:15,backgroundColor:'#fff',padding:28,alignItems:'center',marginTop:20},emptyResultsTitle:{fontSize:16,fontWeight:'900',color:colors.navy,marginTop:10,marginBottom:5},rosterHeader:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:18,marginBottom:12},rosterTitle:{fontSize:12,fontWeight:'900',color:colors.muted},rosterScroll:{fontSize:11,fontWeight:'800',color:colors.navy},rosterRow:{minHeight:70,borderWidth:1,borderColor:colors.line,borderRadius:15,backgroundColor:'#fff',padding:10,flexDirection:'row',alignItems:'center',gap:10,marginBottom:10},rosterOverride:{borderColor:colors.yellow},rosterAvatar:{width:43,height:43,borderRadius:23,backgroundColor:colors.bluePale,alignItems:'center',justifyContent:'center'},rosterName:{fontSize:13,fontWeight:'900',color:colors.navy},rosterMeta:{fontSize:10,color:colors.muted,marginTop:3},radioOn:{width:44,height:44,borderRadius:23,backgroundColor:colors.greenPale,alignItems:'center',justifyContent:'center'},radioDot:{width:15,height:15,borderRadius:9,backgroundColor:colors.green},radioOff:{width:44,height:44,borderRadius:23,backgroundColor:'#F4F5F9',alignItems:'center',justifyContent:'center'},radioEmpty:{width:15,height:15,borderRadius:9,borderWidth:2,borderColor:colors.line},finalizeFooter:{marginHorizontal:-16,marginTop:180,padding:15,borderTopWidth:1,borderTopColor:colors.line,backgroundColor:'#fff'},finalizeTotals:{flexDirection:'row',justifyContent:'space-between',marginBottom:12},totalPresent:{fontSize:12,fontWeight:'900',color:colors.navy},totalAbsent:{fontSize:12,fontWeight:'900',color:colors.red},totalAll:{fontSize:12,fontWeight:'900',color:colors.navy},finalizeButton:{height:48,borderRadius:12,backgroundColor:colors.yellow,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7},finalizeText:{fontSize:14,fontWeight:'900',color:colors.navy},resultSummary:{flexDirection:'row',justifyContent:'space-between',paddingVertical:16},greenDot:{color:colors.green},redDot:{color:colors.red},navyDot:{color:colors.navy},resultBold:{fontSize:11,fontWeight:'800',color:colors.navy},resultGrid:{flexDirection:'row',flexWrap:'wrap',gap:12},resultCard:{width:'47%',height:117,borderWidth:1,borderColor:colors.line,borderRadius:15,backgroundColor:'#fff',alignItems:'center',justifyContent:'center'},resultAvatar:{width:60,height:60,borderRadius:32,backgroundColor:'#F1F3F7',alignItems:'center',justifyContent:'center',position:'relative'},matchMark:{position:'absolute',right:-2,bottom:0,width:19,height:19,borderRadius:10,alignItems:'center',justifyContent:'center'},resultName:{fontSize:12,fontWeight:'900',color:colors.navy,marginTop:4},resultMatch:{fontSize:11,marginTop:2},moreResultCard:{width:'47%',height:117,borderWidth:1,borderColor:colors.line,borderRadius:15,backgroundColor:'#F7F8FC',alignItems:'center',justifyContent:'center'},moreResultText:{fontSize:15,fontWeight:'900',color:'#9AA1B2'},verifyRosterButton:{height:48,borderRadius:12,backgroundColor:colors.yellow,marginTop:16,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:8},verifyRosterText:{fontSize:14,fontWeight:'900',color:colors.navy},
});
