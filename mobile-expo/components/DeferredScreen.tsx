import React, { useEffect, useState } from "react";
import { ActivityIndicator, InteractionManager, View } from "react-native";

type Props = {
  children: React.ReactNode;
  color?: string;
};

/** Defers heavy screen mounting until the current navigation interaction ends. */
export default function DeferredScreen({ children, color = "#22D3EE" }: Props) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setReady(true));
    return () => task.cancel();
  }, []);

  if (!ready) {
    return (
      <View style={{ minHeight: 180, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={color} />
      </View>
    );
  }

  return <>{children}</>;
}
