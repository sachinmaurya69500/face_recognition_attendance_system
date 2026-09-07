package com.faceattend.mobile

import okhttp3.MultipartBody
import okhttp3.RequestBody
import okhttp3.Interceptor
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.gson.GsonConverterFactory
import retrofit2.http.*

data class LoginRequest(val username: String, val password: String)
data class LoginResponse(val access_token: String, val user: User)
data class User(val id: Int, val username: String, val role: String, val student_id: String?)
data class FaceValidation(val valid: Boolean, val issues: List<String> = emptyList(), val faces_detected: Int = 0)
data class AttendanceRecord(val id: Int?, val name: String?, val status: String?, val timestamp: String?, val session_id: String?)

interface FaceAttendApi {
    @POST("auth/login") suspend fun login(@Body request: LoginRequest): LoginResponse
    @GET("auth/me") suspend fun me(): User
    @GET("students") suspend fun students(): Map<String, Any>
    @Multipart @POST("validate-face") suspend fun validateFace(@Part file: MultipartBody.Part, @Part("target_pose") pose: RequestBody): FaceValidation
    @Multipart @POST("process-group-attendance") suspend fun processAttendance(@Part file: MultipartBody.Part, @Part("session_id") session: RequestBody): Map<String, Any>
    @GET("teacher/attendance/report") suspend fun report(@Query("date") date: String? = null, @Query("month") month: String? = null): Map<String, Any>
}

object Network {
    private const val BASE_URL = "http://10.0.2.2:8080/"
    @Volatile private var token: String? = null
    private val auth = Interceptor { chain -> chain.proceed(chain.request().newBuilder().apply { token?.let { header("Authorization", "Bearer $it") } }.build()) }
    val api: FaceAttendApi by lazy {
        Retrofit.Builder().baseUrl(BASE_URL).client(OkHttpClient.Builder().addInterceptor(auth).build()).addConverterFactory(GsonConverterFactory.create()).build().create(FaceAttendApi::class.java)
    }
    fun setToken(value: String?) { token = value }
}
