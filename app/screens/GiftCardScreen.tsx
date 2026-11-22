/**
 * Gift Card Screen
 *
 * Create, redeem, and manage subscription gift cards.
 * Closes #1122
 */

import React, { useState, useCallback, useEffect } from "react";
import {
  View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, FlatList, Modal, Picker,
} from "react-native";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:3001";

type GiftCardType = "subscription_credit" | "plan_upgrade" | "discount";

interface GiftCardItem {
  id: string;
  code: string;
  type: GiftCardType;
  status: string;
  value: number;
  currency: string;
  recipientEmail: string;
  expiresAt: string;
}

export default function GiftCardScreen() {
  const [activeTab, setActiveTab] = useState<"buy" | "redeem" | "mycards">("buy");
  const [cards, setCards] = useState<GiftCardItem[]>([]);
  const [loading, setLoading] = useState(false);

  // Buy form
  const [type, setType] = useState<GiftCardType>("subscription_credit");
  const [value, setValue] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [message, setMessage] = useState("");
  const [quantity, setQuantity] = useState("1");

  // Redeem form
  const [redeemCode, setRedeemCode] = useState("");

  const fetchCards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/gift-cards?purchaserId=current-user`);
      const json = await res.json();
      if (json.success) setCards(json.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { if (activeTab === "mycards") fetchCards(); }, [activeTab, fetchCards]);

  const handleBuy = useCallback(async () => {
    const val = parseFloat(value);
    if (!val || val <= 0) { Alert.alert("Error", "Enter a valid value"); return; }
    if (!recipientEmail) { Alert.alert("Error", "Recipient email is required"); return; }

    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        type, value: val, purchaserId: "current-user",
        recipientEmail, recipientName: recipientName || undefined,
        message: message || undefined, quantity: parseInt(quantity) || 1,
      };

      const res = await fetch(`${API_BASE}/gift-cards`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();

      if (json.success) {
        const cardList = json.data.map((c: GiftCardItem) => c.code).join("\n");
        Alert.alert("Gift Card Created!", `Code(s):\n${cardList}`);
        setValue(""); setRecipientEmail(""); setRecipientName(""); setMessage("");
      } else {
        Alert.alert("Error", json.error ?? "Creation failed");
      }
    } catch { Alert.alert("Error", "Network error"); }
    finally { setLoading(false); }
  }, [type, value, recipientEmail, recipientName, message, quantity]);

  const handleRedeem = useCallback(async () => {
    if (!redeemCode) { Alert.alert("Error", "Enter a gift card code"); return; }

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/gift-cards/redeem`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: redeemCode, redeemedBy: "current-user" }),
      });
      const json = await res.json();

      if (json.success && json.data.success) {
        const d = json.data;
        let msg = "Gift card redeemed successfully!";
        if (d.appliedValue) msg += `\nValue: $${d.appliedValue}`;
        if (d.upgradedPlan) msg += `\nUpgraded to: ${d.upgradedPlan}`;
        Alert.alert("Success", msg);
        setRedeemCode("");
      } else {
        Alert.alert("Error", json.data?.error ?? json.error ?? "Redemption failed");
      }
    } catch { Alert.alert("Error", "Network error"); }
    finally { setLoading(false); }
  }, [redeemCode]);

  const handleCheckBalance = useCallback(async (code: string) => {
    try {
      const res = await fetch(`${API_BASE}/gift-cards/${code}`);
      const json = await res.json();
      if (json.success) {
        const d = json.data;
        Alert.alert("Balance", `Status: ${d.status}\nValue: $${d.value}\nExpires: ${new Date(d.expiresAt).toLocaleDateString()}`);
      }
    } catch { /* silent */ }
  }, []);

  const renderCard = ({ item }: { item: GiftCardItem }) => (
    <View style={styles.cardItem}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardCode}>{item.code}</Text>
        <View style={[styles.statusBadge, styles[`status_${item.status}`] ?? styles.status_active]}>
          <Text style={styles.statusText}>{item.status}</Text>
        </View>
      </View>
      <Text style={styles.cardType}>{item.type.replace(/_/g, " ")}</Text>
      <Text style={styles.cardValue}>{item.currency === "USD" ? "$" : ""}{item.value}</Text>
      <Text style={styles.cardRecipient}>To: {item.recipientEmail}</Text>
      <Text style={styles.cardExpiry}>Expires: {new Date(item.expiresAt).toLocaleDateString()}</Text>
      {item.status === "active" && (
        <TouchableOpacity style={styles.balanceBtn} onPress={() => handleCheckBalance(item.code)}>
          <Text style={styles.balanceBtnText}>Check Balance</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Gift Cards</Text>

      <View style={styles.tabBar}>
        {(["buy", "redeem", "mycards"] as const).map((tab) => (
          <TouchableOpacity key={tab} style={[styles.tab, activeTab === tab && styles.tabActive]} onPress={() => setActiveTab(tab)}>
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === "buy" ? "Buy" : tab === "redeem" ? "Redeem" : "My Cards"}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === "buy" && (
        <ScrollView style={styles.form}>
          <Text style={styles.label}>Gift Card Type</Text>
          <View style={styles.typeRow}>
            {([
              { key: "subscription_credit", label: "Credit" },
              { key: "plan_upgrade", label: "Upgrade" },
              { key: "discount", label: "Discount %" },
            ] as const).map((t) => (
              <TouchableOpacity key={t.key} style={[styles.typeBtn, type === t.key && styles.typeBtnActive]} onPress={() => setType(t.key)}>
                <Text style={[styles.typeBtnText, type === t.key && styles.typeBtnTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>{type === "discount" ? "Discount %" : "Value ($)"}</Text>
          <TextInput style={styles.input} value={value} onChangeText={setValue} keyboardType="numeric" placeholder="50" />

          <Text style={styles.label}>Recipient Email</Text>
          <TextInput style={styles.input} value={recipientEmail} onChangeText={setRecipientEmail} placeholder="recipient@example.com" keyboardType="email-address" />

          <Text style={styles.label}>Recipient Name (optional)</Text>
          <TextInput style={styles.input} value={recipientName} onChangeText={setRecipientName} placeholder="Jane Doe" />

          <Text style={styles.label}>Message (optional)</Text>
          <TextInput style={[styles.input, { height: 60 }]} value={message} onChangeText={setMessage} placeholder="Happy birthday!" multiline />

          <Text style={styles.label}>Quantity</Text>
          <TextInput style={styles.input} value={quantity} onChangeText={setQuantity} keyboardType="numeric" placeholder="1" />

          <TouchableOpacity style={styles.actionButton} onPress={handleBuy} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionButtonText}>Create Gift Card</Text>}
          </TouchableOpacity>
        </ScrollView>
      )}

      {activeTab === "redeem" && (
        <View style={styles.form}>
          <Text style={styles.label}>Gift Card Code</Text>
          <TextInput
            style={[styles.input, styles.codeInput]}
            value={redeemCode}
            onChangeText={setRedeemCode}
            placeholder="SUB-XXXX-XXXX-XXXX-XXXX"
            autoCapitalize="characters"
          />
          <TouchableOpacity style={styles.actionButton} onPress={handleRedeem} disabled={loading}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionButtonText}>Redeem</Text>}
          </TouchableOpacity>
        </View>
      )}

      {activeTab === "mycards" && (
        <FlatList
          data={cards}
          renderItem={renderCard}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={loading}
          onRefresh={fetchCards}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  title: { fontSize: 24, fontWeight: "700", color: "#111827", padding: 16 },
  tabBar: { flexDirection: "row", paddingHorizontal: 16, marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 10, alignItems: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  tabActive: { borderBottomColor: "#4F46E5" },
  tabText: { color: "#6B7280", fontWeight: "500" },
  tabTextActive: { color: "#4F46E5", fontWeight: "700" },
  form: { padding: 16 },
  label: { fontSize: 13, color: "#374151", marginBottom: 4, fontWeight: "500", marginTop: 12 },
  input: { backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: "#E5E7EB" },
  codeInput: { fontFamily: "monospace", fontSize: 16, letterSpacing: 1 },
  typeRow: { flexDirection: "row", gap: 8 },
  typeBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: "#E5E7EB", alignItems: "center" },
  typeBtnActive: { backgroundColor: "#4F46E5" },
  typeBtnText: { color: "#6B7280", fontWeight: "500", fontSize: 13 },
  typeBtnTextActive: { color: "#fff", fontWeight: "600" },
  actionButton: { backgroundColor: "#4F46E5", paddingVertical: 14, borderRadius: 10, alignItems: "center", marginTop: 20, marginBottom: 32 },
  actionButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  list: { padding: 16 },
  cardItem: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, elevation: 2 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  cardCode: { fontSize: 14, fontWeight: "700", fontFamily: "monospace", color: "#111827" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  status_active: { backgroundColor: "#D1FAE5" },
  status_redeemed: { backgroundColor: "#DBEAFE" },
  status_expired: { backgroundColor: "#FEE2E2" },
  status_cancelled: { backgroundColor: "#F3F4F6" },
  statusText: { fontSize: 10, fontWeight: "600", textTransform: "capitalize" },
  cardType: { fontSize: 12, color: "#6B7280", marginTop: 4, textTransform: "capitalize" },
  cardValue: { fontSize: 20, fontWeight: "700", color: "#4F46E5", marginTop: 4 },
  cardRecipient: { fontSize: 12, color: "#6B7280", marginTop: 4 },
  cardExpiry: { fontSize: 11, color: "#9CA3AF", marginTop: 2 },
  balanceBtn: { marginTop: 8, paddingVertical: 6, backgroundColor: "#F3F4F6", borderRadius: 6, alignItems: "center" },
  balanceBtnText: { color: "#4F46E5", fontWeight: "600", fontSize: 12 },
});
