/**
 * Wire Transfer & ACH Payment Screen
 *
 * Allows users to set up wire transfer and ACH payment methods.
 * Closes #1139
 */

import React, { useState, useCallback } from "react";
import {
  View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, Picker,
} from "react-native";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:3001";

type PaymentMethod = "ach" | "wire_transfer";

interface Estimate { fee: number; estimatedSettlementDate: string; }

export default function WireAchPaymentScreen() {
  const [method, setMethod] = useState<PaymentMethod>("ach");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [loading, setLoading] = useState(false);
  const [estimate, setEstimate] = useState<Estimate | null>(null);

  // ACH fields
  const [accountNumber, setAccountNumber] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountType, setAccountType] = useState<"checking" | "savings">("checking");
  const [accountHolderName, setAccountHolderName] = useState("");

  // Wire fields
  const [beneficiaryName, setBeneficiaryName] = useState("");
  const [bankName, setBankName] = useState("");
  const [swiftCode, setSwiftCode] = useState("");
  const [iban, setIban] = useState("");

  const getEstimate = useCallback(async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return;
    try {
      const res = await fetch(`${API_BASE}/payments/wire-ach/estimate?method=${method}&amount=${amt}`);
      const json = await res.json();
      if (json.success) setEstimate(json.data);
    } catch { /* silent */ }
  }, [method, amount]);

  const handleSubmit = useCallback(async () => {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) { Alert.alert("Error", "Enter a valid amount"); return; }

    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        userId: "current-user-id",
        subscriptionId: "current-sub-id",
        amount: amt,
        currency,
        method,
      };

      if (method === "ach") {
        body.bankAccount = { accountNumber, routingNumber, accountType, accountHolderName };
      } else {
        body.wireDetails = { beneficiaryName, bankName, swiftCode: swiftCode || undefined, iban: iban || undefined };
      }

      const res = await fetch(`${API_BASE}/payments/wire-ach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (json.success) {
        Alert.alert("Payment Initiated", `Reference: ${json.data.referenceNumber}\nStatus: ${json.data.status}\nFee: $${json.data.processingFee}`);
      } else {
        Alert.alert("Error", json.error ?? "Payment failed");
      }
    } catch (err) {
      Alert.alert("Error", "Network error occurred");
    } finally {
      setLoading(false);
    }
  }, [method, amount, currency, accountNumber, routingNumber, accountType, accountHolderName, beneficiaryName, bankName, swiftCode, iban]);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.title}>Wire Transfer & ACH Payment</Text>

      <View style={styles.methodSelector}>
        <TouchableOpacity
          style={[styles.methodButton, method === "ach" && styles.methodActive]}
          onPress={() => { setMethod("ach"); setEstimate(null); }}
        >
          <Text style={[styles.methodText, method === "ach" && styles.methodTextActive]}>ACH</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.methodButton, method === "wire_transfer" && styles.methodActive]}
          onPress={() => { setMethod("wire_transfer"); setEstimate(null); }}
        >
          <Text style={[styles.methodText, method === "wire_transfer" && styles.methodTextActive]}>Wire Transfer</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.inputGroup}>
        <Text style={styles.label}>Amount</Text>
        <View style={styles.amountRow}>
          <TextInput style={styles.amountInput} value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="0.00" />
          <TextInput style={styles.currencyInput} value={currency} onChangeText={setCurrency} placeholder="USD" />
        </View>
      </View>

      {method === "ach" ? (
        <>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Account Holder Name</Text>
            <TextInput style={styles.input} value={accountHolderName} onChangeText={setAccountHolderName} placeholder="John Doe" />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Account Number</Text>
            <TextInput style={styles.input} value={accountNumber} onChangeText={setAccountNumber} keyboardType="numeric" placeholder="000123456789" />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Routing Number</Text>
            <TextInput style={styles.input} value={routingNumber} onChangeText={setRoutingNumber} keyboardType="numeric" maxLength={9} placeholder="021000021" />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Account Type</Text>
            <View style={styles.typeSelector}>
              {(["checking", "savings"] as const).map((t) => (
                <TouchableOpacity key={t} style={[styles.typeButton, accountType === t && styles.typeActive]} onPress={() => setAccountType(t)}>
                  <Text style={styles.typeText}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </>
      ) : (
        <>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Beneficiary Name</Text>
            <TextInput style={styles.input} value={beneficiaryName} onChangeText={setBeneficiaryName} placeholder="John Doe" />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Bank Name</Text>
            <TextInput style={styles.input} value={bankName} onChangeText={setBankName} placeholder="Chase Bank" />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>SWIFT Code</Text>
            <TextInput style={styles.input} value={swiftCode} onChangeText={setSwiftCode} placeholder="CHASUS33" autoCapitalize="characters" />
          </View>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>IBAN (optional)</Text>
            <TextInput style={styles.input} value={iban} onChangeText={setIban} placeholder="GB29 NWBK 6016 1331 9268 19" autoCapitalize="characters" />
          </View>
        </>
      )}

      <TouchableOpacity style={styles.estimateButton} onPress={getEstimate}>
        <Text style={styles.estimateButtonText}>Get Fee Estimate</Text>
      </TouchableOpacity>

      {estimate && (
        <View style={styles.estimateCard}>
          <Text style={styles.estimateText}>Fee: ${estimate.fee.toFixed(2)}</Text>
          <Text style={styles.estimateText}>Settlement: {new Date(estimate.estimatedSettlementDate).toLocaleDateString()}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.submitButton} onPress={handleSubmit} disabled={loading}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Initiate Payment</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  title: { fontSize: 24, fontWeight: "700", color: "#111827", padding: 16 },
  methodSelector: { flexDirection: "row", paddingHorizontal: 16, gap: 12, marginBottom: 16 },
  methodButton: { flex: 1, paddingVertical: 12, borderRadius: 8, backgroundColor: "#E5E7EB", alignItems: "center" },
  methodActive: { backgroundColor: "#4F46E5" },
  methodText: { color: "#6B7280", fontWeight: "600" },
  methodTextActive: { color: "#FFFFFF" },
  inputGroup: { paddingHorizontal: 16, marginBottom: 12 },
  label: { fontSize: 13, color: "#374151", marginBottom: 4, fontWeight: "500" },
  input: { backgroundColor: "#FFFFFF", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: "#E5E7EB" },
  amountRow: { flexDirection: "row", gap: 8 },
  amountInput: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: "#E5E7EB" },
  currencyInput: { width: 80, backgroundColor: "#FFFFFF", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: "#E5E7EB" },
  typeSelector: { flexDirection: "row", gap: 8 },
  typeButton: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: "#E5E7EB", alignItems: "center" },
  typeActive: { backgroundColor: "#4F46E5" },
  typeText: { color: "#374151", fontWeight: "500" },
  estimateButton: { marginHorizontal: 16, marginBottom: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: "#E0E7FF", alignItems: "center" },
  estimateButtonText: { color: "#4F46E5", fontWeight: "600" },
  estimateCard: { marginHorizontal: 16, marginBottom: 16, padding: 12, backgroundColor: "#FEF3C7", borderRadius: 8 },
  estimateText: { color: "#92400E", fontSize: 14, marginBottom: 4 },
  submitButton: { marginHorizontal: 16, marginBottom: 32, paddingVertical: 14, borderRadius: 10, backgroundColor: "#4F46E5", alignItems: "center" },
  submitButtonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 16 },
});
