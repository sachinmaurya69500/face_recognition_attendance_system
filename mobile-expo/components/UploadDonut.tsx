import React from "react";
import { Text, View } from "react-native";

export default function UploadDonut({ progress, label }: { progress: number; label: string }) {
  const safeProgress = Math.max(0, Math.min(100, progress));
  const segments = 24;
  return (
    <View style={{ alignItems: "center", marginVertical: 14 }}>
      <View style={{ width: 116, height: 116, justifyContent: "center", alignItems: "center" }}>
        {Array.from({ length: segments }).map((_, index) => {
          const active = index < Math.ceil((safeProgress / 100) * segments);
          return (
            <View key={index} style={{ position: "absolute", width: 8, height: 22, borderRadius: 4, backgroundColor: active ? "#22C55E" : "rgba(148,163,184,0.22)", transform: [{ rotate: `${index * (360 / segments)}deg` }, { translateY: -45 }] }} />
          );
        })}
        <View style={{ width: 76, height: 76, borderRadius: 38, backgroundColor: "#0B1220", alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: "#22C55E", fontSize: 21, fontWeight: "800" }}>{safeProgress}%</Text>
        </View>
      </View>
      <Text style={{ color: "#22C55E", fontSize: 11, fontWeight: "700", letterSpacing: 0.6 }}>{label}</Text>
    </View>
  );
}
