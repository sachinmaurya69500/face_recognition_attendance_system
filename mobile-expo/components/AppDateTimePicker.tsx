import React, { useState, useMemo, useRef } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  StyleProp,
} from "react-native";
import DateTimePicker, {
  DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  formatDisplayDate,
  formatPrettyDate,
  formatTime12,
  formatTime24,
  fromApiDate,
  parseDisplayDate,
  parseTime24,
  toApiDate,
} from "../utils/dateFormat";

export interface AppDatePickerProps {
  value: Date | string;
  onChange: (date: Date, yyyyMmDd: string, ddMmYyyy: string) => void;
  label?: string;
  placeholder?: string;
  minDate?: Date;
  maxDate?: Date;
  theme: any;
  containerStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

export function AppDatePicker({
  value,
  onChange,
  label,
  placeholder = "Select date",
  minDate,
  maxDate,
  theme,
  containerStyle,
  disabled = false,
}: AppDatePickerProps) {
  const [showPicker, setShowPicker] = useState(false);
  const webDateInputRef = useRef<any>(null);

  // Normalize incoming value to a reliable Date object
  const dateObj = useMemo(() => {
    if (!value) return new Date();
    if (value instanceof Date) return isNaN(value.getTime()) ? new Date() : value;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^\d{2}-\d{2}-\d{4}$/.test(trimmed)) {
        return parseDisplayDate(trimmed);
      }
      if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
        const d = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00` : trimmed);
        return isNaN(d.getTime()) ? new Date() : d;
      }
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? new Date() : d;
    }
    return new Date();
  }, [value]);

  const displayString = useMemo(() => {
    if (!value) return placeholder;
    return formatPrettyDate(dateObj);
  }, [value, dateObj, placeholder]);

  const yyyyMmDdString = useMemo(() => {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, [dateObj]);

  const handleNativeChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowPicker(false);
    if (event.type === "set" && selectedDate) {
      const y = selectedDate.getFullYear();
      const m = String(selectedDate.getMonth() + 1).padStart(2, "0");
      const d = String(selectedDate.getDate()).padStart(2, "0");
      const iso = `${y}-${m}-${d}`;
      const display = formatDisplayDate(selectedDate);
      onChange(selectedDate, iso, display);
    }
  };

  const handleWebChange = (e: any) => {
    const val = e.target.value; // "YYYY-MM-DD"
    if (val) {
      const [y, m, d] = val.split("-").map(Number);
      const newD = new Date(y, m - 1, d);
      onChange(newD, val, formatDisplayDate(newD));
    }
  };

  return (
    <View style={containerStyle}>
      {label ? (
        <Text
          style={[
            styles.fieldLabel,
            { color: theme.textSecondary || theme.muted || "#94A3B8" },
          ]}
        >
          {label}
        </Text>
      ) : null}

      <View style={{ position: "relative" }}>
        <Pressable
          disabled={disabled}
          onPress={() => {
            if (Platform.OS === "web") {
              try {
                webDateInputRef.current?.showPicker?.();
              } catch {}
            } else {
              setShowPicker(true);
            }
          }}
          style={[
            styles.pickerButton,
            {
              backgroundColor: theme.bgElevated || "#111827",
              borderColor: showPicker
                ? theme.cyan || "#3B82F6"
                : theme.border || "rgba(255,255,255,0.08)",
              opacity: disabled ? 0.6 : 1,
            },
          ]}
        >
          <View style={styles.iconLabelRow}>
            <MaterialCommunityIcons
              name="calendar"
              size={18}
              color={theme.cyan || "#3B82F6"}
              style={{ marginRight: 8 }}
            />
            <Text
              style={[
                styles.pickerValueText,
                {
                  color: value
                    ? theme.text || "#F8FAFC"
                    : theme.muted || "#64748B",
                },
              ]}
              numberOfLines={1}
            >
              {displayString}
            </Text>
          </View>
          <MaterialCommunityIcons
            name="calendar-month-outline"
            size={18}
            color={theme.muted || "#64748B"}
          />
        </Pressable>

        {Platform.OS === "web" && !disabled && (
          <input
            ref={webDateInputRef}
            type="date"
            value={yyyyMmDdString}
            onChange={handleWebChange}
            min={minDate ? minDate.toISOString().slice(0, 10) : undefined}
            max={maxDate ? maxDate.toISOString().slice(0, 10) : undefined}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              opacity: 0,
              cursor: "pointer",
              zIndex: 10,
            }}
          />
        )}
      </View>

      {Platform.OS !== "web" && showPicker && (
        <DateTimePicker
          value={dateObj}
          mode="date"
          display={Platform.OS === "android" ? "calendar" : "default"}
          minimumDate={minDate}
          maximumDate={maxDate}
          onChange={handleNativeChange}
        />
      )}
    </View>
  );
}

export interface AppTimePickerProps {
  value: Date | string;
  onChange: (date: Date, time24Str: string, time12Str: string) => void;
  label?: string;
  placeholder?: string;
  theme: any;
  containerStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

export function AppTimePicker({
  value,
  onChange,
  label,
  placeholder = "Select time",
  theme,
  containerStyle,
  disabled = false,
}: AppTimePickerProps) {
  const [showPicker, setShowPicker] = useState(false);
  const webTimeInputRef = useRef<any>(null);

  // Normalize incoming value to a reliable Date object with time
  const timeDateObj = useMemo(() => {
    if (!value) {
      const d = new Date();
      d.setHours(9, 0, 0, 0);
      return d;
    }
    if (value instanceof Date) {
      return isNaN(value.getTime()) ? new Date() : value;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (/^\d{1,2}:\d{2}/.test(trimmed)) {
        return parseTime24(trimmed);
      }
      const d = new Date(trimmed);
      return isNaN(d.getTime()) ? new Date() : d;
    }
    return new Date();
  }, [value]);

  const time24Str = useMemo(() => formatTime24(timeDateObj), [timeDateObj]);
  const time12Str = useMemo(() => formatTime12(timeDateObj), [timeDateObj]);

  const handleNativeChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    setShowPicker(false);
    if (event.type === "set" && selectedDate) {
      const t24 = formatTime24(selectedDate);
      const t12 = formatTime12(selectedDate);
      onChange(selectedDate, t24, t12);
    }
  };

  const handleWebChange = (e: any) => {
    const val = e.target.value; // "HH:mm"
    if (val) {
      const newD = parseTime24(val, timeDateObj);
      const t24 = formatTime24(newD);
      const t12 = formatTime12(newD);
      onChange(newD, t24, t12);
    }
  };

  return (
    <View style={containerStyle}>
      {label ? (
        <Text
          style={[
            styles.fieldLabel,
            { color: theme.textSecondary || theme.muted || "#94A3B8" },
          ]}
        >
          {label}
        </Text>
      ) : null}

      <View style={{ position: "relative" }}>
        <Pressable
          disabled={disabled}
          onPress={() => {
            if (Platform.OS === "web") {
              try {
                webTimeInputRef.current?.showPicker?.();
              } catch {}
            } else {
              setShowPicker(true);
            }
          }}
          style={[
            styles.pickerButton,
            {
              backgroundColor: theme.bgElevated || "#111827",
              borderColor: showPicker
                ? theme.cyan || "#3B82F6"
                : theme.border || "rgba(255,255,255,0.08)",
              opacity: disabled ? 0.6 : 1,
            },
          ]}
        >
          <View style={styles.iconLabelRow}>
            <MaterialCommunityIcons
              name="clock-outline"
              size={18}
              color={theme.cyan || "#3B82F6"}
              style={{ marginRight: 8 }}
            />
            <Text
              style={[
                styles.pickerValueText,
                {
                  color: value
                    ? theme.text || "#F8FAFC"
                    : theme.muted || "#64748B",
                },
              ]}
              numberOfLines={1}
            >
              {time12Str}
            </Text>
          </View>
          <MaterialCommunityIcons
            name="clock-time-four-outline"
            size={18}
            color={theme.muted || "#64748B"}
          />
        </Pressable>

        {Platform.OS === "web" && !disabled && (
          <input
            ref={webTimeInputRef}
            type="time"
            value={time24Str}
            onChange={handleWebChange}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              opacity: 0,
              cursor: "pointer",
              zIndex: 10,
            }}
          />
        )}
      </View>

      {Platform.OS !== "web" && showPicker && (
        <DateTimePicker
          value={timeDateObj}
          mode="time"
          display={Platform.OS === "android" ? "clock" : "default"}
          onChange={handleNativeChange}
        />
      )}
    </View>
  );
}

export interface AppDateTimePickerFieldProps {
  label: string;
  value: Date | string;
  onChange: (combinedDate: Date, isoString: string) => void;
  theme: any;
  containerStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
}

export function AppDateTimePickerField({
  label,
  value,
  onChange,
  theme,
  containerStyle,
  disabled = false,
}: AppDateTimePickerFieldProps) {
  // Normalize incoming date/time to a single Date object
  const current = useMemo(() => {
    if (!value) return new Date();
    if (value instanceof Date) return isNaN(value.getTime()) ? new Date() : value;
    const d = new Date(value);
    return isNaN(d.getTime()) ? new Date() : d;
  }, [value]);

  const handleDateChange = (newDate: Date) => {
    const updated = new Date(current);
    updated.setFullYear(newDate.getFullYear(), newDate.getMonth(), newDate.getDate());
    onChange(updated, updated.toISOString());
  };

  const handleTimeChange = (newTime: Date) => {
    const updated = new Date(current);
    updated.setHours(newTime.getHours(), newTime.getMinutes(), 0, 0);
    onChange(updated, updated.toISOString());
  };

  return (
    <View style={containerStyle}>
      <Text
        style={[
          styles.fieldLabel,
          { color: theme.textSecondary || theme.muted || "#94A3B8" },
        ]}
      >
        {label}
      </Text>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1.15 }}>
          <AppDatePicker
            value={current}
            onChange={handleDateChange}
            theme={theme}
            disabled={disabled}
          />
        </View>
        <View style={{ flex: 0.85 }}>
          <AppTimePicker
            value={current}
            onChange={handleTimeChange}
            theme={theme}
            disabled={disabled}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  pickerButton: {
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  iconLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 6,
  },
  pickerValueText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
