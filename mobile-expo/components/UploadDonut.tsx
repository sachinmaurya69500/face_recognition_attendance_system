import React from "react";
import { Text, View } from "react-native";

export default function UploadDonut({
  progress,
  label,
}: {
  progress: number;
  label: string;
}) {
  const safeProgress = Math.max(0, Math.min(100, Math.round(progress)));

  return (
    <View style={{ alignItems: "center", marginVertical: 16 }}>
      {/* Outer Circular Progress Container */}
      <View
        style={{
          width: 96,
          height: 96,
          borderRadius: 48,
          borderWidth: 4,
          borderColor: "rgba(59, 130, 246, 0.16)",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "rgba(59, 130, 246, 0.05)",
          position: "relative",
        }}
      >
        <Text
          style={{
            color: "#3B82F6",
            fontSize: 22,
            fontWeight: "700",
            letterSpacing: -0.5,
          }}
        >
          {safeProgress}%
        </Text>
      </View>

      {/* Modern Progress Bar Track */}
      <View
        style={{
          width: 140,
          height: 4,
          borderRadius: 2,
          backgroundColor: "rgba(148, 163, 184, 0.2)",
          marginTop: 12,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            width: `${safeProgress}%`,
            height: "100%",
            backgroundColor: "#3B82F6",
            borderRadius: 2,
          }}
        />
      </View>

      <Text
        style={{
          color: "#64748B",
          fontSize: 12,
          fontWeight: "600",
          marginTop: 6,
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
    </View>
  );
}
