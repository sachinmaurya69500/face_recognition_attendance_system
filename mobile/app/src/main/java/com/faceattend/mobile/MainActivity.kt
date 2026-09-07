package com.faceattend.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.compose.*
import androidx.navigation.NavHostController

private val Navy = Color(0xFF102A43); private val Blue = Color(0xFF2367A6); private val Gold = Color(0xFFB77A08); private val Surface = Color(0xFFF7F9FC); private val Muted = Color(0xFF65758A); private val Green = Color(0xFF18794E)

class MainActivity : ComponentActivity() { override fun onCreate(state: Bundle?) { super.onCreate(state); setContent { FaceAttendApp() } } }

@Composable fun FaceAttendApp() {
    MaterialTheme(colorScheme = lightColorScheme(primary = Blue, secondary = Gold, background = Surface, surface = Color.White, onSurface = Navy)) { 
        val nav = rememberNavController(); NavHost(nav, startDestination = "entry") {
            composable("entry") { Entry { nav.navigate("onboarding") } }
            composable("onboarding") { Onboarding { nav.navigate("login") } }
            composable("login") { Login { role -> nav.navigate("${role.lowercase()}/dashboard") { popUpTo("login") { inclusive = true } } } }
            composable("student/dashboard") { StudentShell(nav) }; composable("student/attendance") { StudentList(nav) }; composable("student/schedule") { Schedule(nav) }; composable("student/profile") { Profile(nav) }
            composable("teacher/dashboard") { TeacherShell(nav) }; composable("teacher/attendance") { Recognition(nav) }; composable("teacher/reports") { Reports(nav) }; composable("teacher/profile") { Profile(nav) }
            composable("admin/dashboard") { AdminShell(nav) }; composable("admin/users") { Users(nav) }; composable("admin/reports") { Reports(nav) }; composable("admin/profile") { Profile(nav) }
        }
    }
}

@Composable fun Entry(next: () -> Unit) { Center { Logo(); Text("Smart Attendance with Face Recognition", fontSize = 18.sp, color = Muted); Spacer(Modifier.height(28.dp)); CircularProgressIndicator(color = Blue); LaunchedEffect(Unit) { kotlinx.coroutines.delay(900); next() } } }
@Composable fun Onboarding(next: () -> Unit) { Center { Logo(); Text("Attendance that feels effortless.", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Navy); Text("Secure recognition, clear feedback, and everything your campus needs in one place.", color = Muted, modifier = Modifier.padding(16.dp)); Primary("Get started", next) } }
@Composable fun Login(done: (String) -> Unit) { var id by remember { mutableStateOf("") }; var password by remember { mutableStateOf("") }; var error by remember { mutableStateOf(false) }; Center { Logo(); Text("Welcome back", fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Navy); Text("Sign in to continue", color = Muted); Spacer(Modifier.height(20.dp)); OutlinedTextField(id, { id = it }, label = { Text("Email or account ID") }, modifier = Modifier.fillMaxWidth()); OutlinedTextField(password, { password = it }, label = { Text("Password") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth().padding(top = 12.dp)); if (error) Text("Invalid credentials or network error", color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(8.dp)); Primary("Sign in", { if (id.isBlank()) error = true else done(if (id.contains("admin")) "Admin" else if (id.contains("teacher")) "Teacher" else "Student") }); TextButton({}) { Text("Forgot password?", color = Blue) } } }

@Composable fun StudentShell(nav: NavHostController) = Shell(nav, "student", "Good morning", "Your attendance at a glance") { DashboardCard(); Section("Quick actions"); Action("Mark attendance", Icons.Default.Face) { nav.navigate("student/attendance") }; Action("Schedule", Icons.Default.CalendarMonth) { nav.navigate("student/schedule") }; Section("Recent attendance"); Record("Today · 09:02", "Present", Green) }
@Composable fun TeacherShell(nav: NavHostController) = Shell(nav, "teacher", "Today's classes", "Run your classroom in a few taps") { Stats(); Action("Start attendance", Icons.Default.CameraAlt) { nav.navigate("teacher/attendance") }; Action("View reports", Icons.Default.BarChart) { nav.navigate("teacher/reports") } }
@Composable fun AdminShell(nav: NavHostController) = Shell(nav, "admin", "Administration", "Keep every part of FaceAttend under control") { Stats(); Action("Manage users", Icons.Default.People) { nav.navigate("admin/users") }; Action("Attendance reports", Icons.Default.Assessment) { nav.navigate("admin/reports") } }

@Composable fun Shell(nav: NavHostController, role: String, title: String, subtitle: String, content: @Composable ColumnScope.() -> Unit) { Scaffold(bottomBar = { Bottom(role, nav) }) { pad -> LazyColumn(contentPadding = PaddingValues(20.dp), modifier = Modifier.padding(pad).fillMaxSize()) { item { Text("FACEATTEND", color = Gold, fontSize = 12.sp, fontWeight = FontWeight.Bold); Text(title, fontSize = 30.sp, fontWeight = FontWeight.Bold, color = Navy); Text(subtitle, color = Muted); Spacer(Modifier.height(24.dp)) }; item { Column(content = content) } } } }
@Composable fun DashboardCard() { Card(colors = CardDefaults.cardColors(containerColor = Navy), shape = RoundedCornerShape(20.dp)) { Column(Modifier.padding(20.dp)) { Text("TODAY'S ATTENDANCE", color = Color.White.copy(.7f), fontSize = 12.sp); Text("92%", color = Color.White, fontSize = 38.sp, fontWeight = FontWeight.Bold); Text("Present today · 11 of 12 sessions", color = Color.White.copy(.8f)) } } }
@Composable fun Stats() { Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) { Stat(Modifier.weight(1f), "24", "Classes"); Stat(Modifier.weight(1f), "87%", "Attendance"); Stat(Modifier.weight(1f), "3", "Pending") } }
@Composable fun Stat(modifier: Modifier, v: String, l: String) { Card(modifier) { Column(Modifier.padding(12.dp)) { Text(v, fontWeight = FontWeight.Bold, fontSize = 22.sp, color = Navy); Text(l, color = Muted, fontSize = 11.sp) } } }
@Composable fun Action(label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit) { Card(onClick = onClick, modifier = Modifier.fillMaxWidth().padding(vertical = 5.dp)) { Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) { Icon(icon, null, tint = Blue); Text(label, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(start = 14.dp)); Icon(Icons.Default.ChevronRight, null, tint = Muted, modifier = Modifier.weight(1f)) } } }
@Composable fun Section(title: String) { Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = Navy, modifier = Modifier.padding(top = 22.dp, bottom = 8.dp)) }
@Composable fun Record(whenText: String, status: String, color: Color) { Card(Modifier.fillMaxWidth()) { Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(10.dp).background(color, CircleShape)); Column(Modifier.padding(start = 12.dp)) { Text(whenText, fontWeight = FontWeight.SemiBold); Text("Class session", color = Muted, fontSize = 12.sp) }; Spacer(Modifier.weight(1f)); Text(status, color = color, fontWeight = FontWeight.Bold) } } }

@Composable fun StudentList(nav: NavHostController) = Page(nav, "Attendance history") { Section("This month"); repeat(5) { Record("${it + 1} Jun · 09:00", if (it == 3) "Late" else "Present", if (it == 3) Gold else Green) } }
@Composable fun Schedule(nav: NavHostController) = Page(nav, "Class schedule") { Section("Today's classes"); listOf("Mathematics · 09:00 · Room 204", "Computer Science · 11:00 · Lab 2", "English · 14:00 · Room 110").forEach { Action(it, Icons.Default.Event) {} } }
@Composable fun Reports(nav: NavHostController) = Page(nav, "Reports") { Section("Attendance overview"); Stats(); Section("Filters"); OutlinedTextField("June 2026", {}, label = { Text("Date range") }, modifier = Modifier.fillMaxWidth()); Primary("Generate report", {}) }
@Composable fun Users(nav: NavHostController) = Page(nav, "Manage users") { Section("Directory"); listOf("Aarav Sharma · Student", "Meera Iyer · Teacher", "Admin account · Administrator").forEach { Action(it, Icons.Default.Person) {} }; Primary("Add user", {}) }
@Composable fun Recognition(nav: NavHostController) = Page(nav, "Mark attendance") { Text("Camera + location permission check", color = Muted); Box(Modifier.fillMaxWidth().height(260.dp).padding(vertical = 18.dp).background(Navy, RoundedCornerShape(24.dp)), contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally) { Icon(Icons.Default.Face, null, tint = Color.White, modifier = Modifier.size(72.dp)); Text("Align one face in the frame", color = Color.White, fontWeight = FontWeight.Bold); Text("Good lighting · look straight", color = Color.White.copy(.7f)) } }; Primary("Capture and verify", {}) ; Text("Recognition states: searching · detected · verifying · verified · offline", color = Muted, fontSize = 12.sp, modifier = Modifier.padding(top = 12.dp)) }
@Composable fun Profile(nav: NavHostController) = Page(nav, "Profile & settings") { Action("Edit profile", Icons.Default.Edit) {}; Action("Security and 2FA", Icons.Default.Security) {}; Action("Privacy and face consent", Icons.Default.PrivacyTip) {}; Action("Log out", Icons.Default.Logout) { nav.navigate("login") } }

@Composable fun Page(nav: NavHostController, title: String, content: @Composable ColumnScope.() -> Unit) { Column(Modifier.fillMaxSize().padding(20.dp)) { Text("FACEATTEND", color = Gold, fontSize = 12.sp, fontWeight = FontWeight.Bold); Text(title, fontSize = 28.sp, fontWeight = FontWeight.Bold, color = Navy); Spacer(Modifier.height(12.dp)); Column(content = content) } }
@Composable fun Bottom(role: String, nav: NavHostController) { val base = role.lowercase(); NavigationBar { listOf("dashboard" to Icons.Default.Home, "attendance" to Icons.Default.FactCheck, "reports" to Icons.Default.Assessment, "profile" to Icons.Default.Person).forEach { (route, icon) -> NavigationBarItem(selected = false, onClick = { nav.navigate("$base/$route") }, icon = { Icon(icon, null) }, label = { Text(route.replaceFirstChar { it.uppercase() }) }) } } }
@Composable fun Logo() { Row(verticalAlignment = Alignment.CenterVertically) { Box(Modifier.size(44.dp).background(Blue, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) { Text("F", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 24.sp) }; Text("FaceAttend", color = Navy, fontWeight = FontWeight.Bold, fontSize = 24.sp, modifier = Modifier.padding(start = 10.dp)) } }
@Composable fun Primary(label: String, click: () -> Unit) { Button(click, modifier = Modifier.fillMaxWidth().padding(top = 18.dp), shape = RoundedCornerShape(12.dp)) { Text(label) } }
@Composable fun Center(content: @Composable ColumnScope.() -> Unit) { Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally, content = content) }
