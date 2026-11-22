/**
 * Invoice Generation Screen
 *
 * Create, view, and email invoices with PDF generation.
 * Closes #1132
 */

import React, { useState, useCallback, useEffect } from "react";
import {
  View, Text, TextInput, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, Alert, FlatList, Modal,
} from "react-native";

const API_BASE = process.env.EXPO_PUBLIC_API_BASE ?? "http://localhost:3001";

interface InvoiceListItem {
  invoice_number: string;
  customer_name: string;
  customer_email: string;
  status: string;
  total: string;
  currency: string;
  invoice_date: string;
  due_date: string;
}

interface LineItemInput { description: string; quantity: string; unitPrice: string; }

export default function InvoiceGenerationScreen() {
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [generating, setGenerating] = useState(false);

  // Form state
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [taxRate, setTaxRate] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<LineItemInput[]>([{ description: "", quantity: "1", unitPrice: "0" }]);

  const fetchInvoices = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/invoices?limit=20`);
      const json = await res.json();
      if (json.success) setInvoices(json.data);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const addLineItem = () => setItems([...items, { description: "", quantity: "1", unitPrice: "0" }]);
  const updateItem = (idx: number, field: keyof LineItemInput, value: string) => {
    const updated = [...items];
    updated[idx] = { ...updated[idx], [field]: value };
    setItems(updated);
  };
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const handleGenerate = useCallback(async () => {
    if (!customerName || !customerEmail) { Alert.alert("Error", "Customer name and email are required"); return; }
    if (items.every((i) => !i.description)) { Alert.alert("Error", "Add at least one line item"); return; }

    setGenerating(true);
    try {
      const body = {
        customerName, customerEmail,
        items: items.filter((i) => i.description).map((i) => ({
          description: i.description,
          quantity: parseInt(i.quantity) || 1,
          unitPrice: parseFloat(i.unitPrice) || 0,
        })),
        taxRate: parseFloat(taxRate) || 0,
        discount: parseFloat(discount) || 0,
        notes: notes || undefined,
      };

      const res = await fetch(`${API_BASE}/invoices/generate`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      const json = await res.json();

      if (json.success) {
        Alert.alert("Success", `Invoice ${json.data.invoice.invoiceNumber} generated!`, [
          { text: "Email Now", onPress: () => emailInvoice(json.data.invoice.invoiceNumber) },
          { text: "OK", onPress: () => { setShowCreate(false); fetchInvoices(); } },
        ]);
      } else {
        Alert.alert("Error", json.error ?? "Generation failed");
      }
    } catch { Alert.alert("Error", "Network error"); }
    finally { setGenerating(false); }
  }, [customerName, customerEmail, items, taxRate, discount, notes]);

  const emailInvoice = useCallback(async (invoiceNumber: string) => {
    try {
      const res = await fetch(`${API_BASE}/invoices/${invoiceNumber}/email`, { method: "POST" });
      const json = await res.json();
      if (json.success && json.data.success) {
        Alert.alert("Sent", `Invoice emailed to ${json.data.recipient}`);
      } else {
        Alert.alert("Error", json.data?.error ?? json.error ?? "Email failed");
      }
    } catch { Alert.alert("Error", "Network error"); }
  }, []);

  const renderItem = ({ item }: { item: InvoiceListItem }) => (
    <View style={styles.invoiceCard}>
      <View style={styles.invoiceHeader}>
        <Text style={styles.invoiceNumber}>{item.invoice_number}</Text>
        <View style={[styles.statusBadge, styles[`status_${item.status}`] ?? styles.status_draft]}>
          <Text style={styles.statusText}>{item.status}</Text>
        </View>
      </View>
      <Text style={styles.invoiceCustomer}>{item.customer_name}</Text>
      <View style={styles.invoiceFooter}>
        <Text style={styles.invoiceTotal}>{item.currency === "USD" ? "$" : ""}{item.total}</Text>
        <Text style={styles.invoiceDue}>Due: {new Date(item.due_date).toLocaleDateString()}</Text>
      </View>
      {item.status === "draft" || item.status === "sent" ? (
        <TouchableOpacity style={styles.emailButton} onPress={() => emailInvoice(item.invoice_number)}>
          <Text style={styles.emailButtonText}>📧 Email Invoice</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  if (loading) {
    return <View style={styles.center}><ActivityIndicator size="large" color="#4F46E5" /></View>;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Invoices</Text>
        <TouchableOpacity style={styles.createButton} onPress={() => setShowCreate(true)}>
          <Text style={styles.createButtonText}>+ New Invoice</Text>
        </TouchableOpacity>
      </View>

      <FlatList data={invoices} renderItem={renderItem} keyExtractor={(item) => item.invoice_number} contentContainerStyle={styles.list} />

      <Modal visible={showCreate} animationType="slide" onRequestClose={() => setShowCreate(false)}>
        <ScrollView style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Create Invoice</Text>

          <Text style={styles.label}>Customer Name</Text>
          <TextInput style={styles.input} value={customerName} onChangeText={setCustomerName} placeholder="John Doe" />

          <Text style={styles.label}>Customer Email</Text>
          <TextInput style={styles.input} value={customerEmail} onChangeText={setCustomerEmail} placeholder="john@example.com" keyboardType="email-address" />

          <Text style={styles.label}>Line Items</Text>
          {items.map((item, idx) => (
            <View key={idx} style={styles.lineItemRow}>
              <TextInput style={styles.lineDesc} value={item.description} onChangeText={(v) => updateItem(idx, "description", v)} placeholder="Description" />
              <TextInput style={styles.lineQty} value={item.quantity} onChangeText={(v) => updateItem(idx, "quantity", v)} keyboardType="numeric" placeholder="Qty" />
              <TextInput style={styles.linePrice} value={item.unitPrice} onChangeText={(v) => updateItem(idx, "unitPrice", v)} keyboardType="numeric" placeholder="Price" />
              {items.length > 1 && <TouchableOpacity onPress={() => removeItem(idx)}><Text style={styles.removeBtn}>✕</Text></TouchableOpacity>}
            </View>
          ))}
          <TouchableOpacity style={styles.addItemBtn} onPress={addLineItem}><Text style={styles.addItemText}>+ Add Item</Text></TouchableOpacity>

          <View style={styles.row}>
            <View style={styles.halfInput}>
              <Text style={styles.label}>Tax Rate</Text>
              <TextInput style={styles.input} value={taxRate} onChangeText={setTaxRate} keyboardType="numeric" placeholder="0.08" />
            </View>
            <View style={styles.halfInput}>
              <Text style={styles.label}>Discount</Text>
              <TextInput style={styles.input} value={discount} onChangeText={setDiscount} keyboardType="numeric" placeholder="0" />
            </View>
          </View>

          <Text style={styles.label}>Notes (optional)</Text>
          <TextInput style={[styles.input, { height: 60 }]} value={notes} onChangeText={setNotes} placeholder="Payment terms..." multiline />

          <TouchableOpacity style={styles.generateButton} onPress={handleGenerate} disabled={generating}>
            {generating ? <ActivityIndicator color="#fff" /> : <Text style={styles.generateButtonText}>Generate & Save</Text>}
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelButton} onPress={() => setShowCreate(false)}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F9FAFB" },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16 },
  title: { fontSize: 24, fontWeight: "700", color: "#111827" },
  createButton: { backgroundColor: "#4F46E5", paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  createButtonText: { color: "#fff", fontWeight: "600" },
  list: { padding: 16, paddingTop: 0 },
  invoiceCard: { backgroundColor: "#fff", borderRadius: 12, padding: 16, marginBottom: 12, elevation: 2 },
  invoiceHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  invoiceNumber: { fontSize: 16, fontWeight: "700", color: "#111827" },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  status_draft: { backgroundColor: "#FEF3C7" },
  status_sent: { backgroundColor: "#DBEAFE" },
  status_paid: { backgroundColor: "#D1FAE5" },
  status_overdue: { backgroundColor: "#FEE2E2" },
  statusText: { fontSize: 11, fontWeight: "600", textTransform: "capitalize" },
  invoiceCustomer: { fontSize: 14, color: "#6B7280", marginTop: 4 },
  invoiceFooter: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  invoiceTotal: { fontSize: 18, fontWeight: "700", color: "#111827" },
  invoiceDue: { fontSize: 12, color: "#9CA3AF" },
  emailButton: { marginTop: 8, paddingVertical: 8, backgroundColor: "#F3F4F6", borderRadius: 6, alignItems: "center" },
  emailButtonText: { color: "#4F46E5", fontWeight: "600", fontSize: 13 },
  modalContainer: { flex: 1, padding: 16, backgroundColor: "#F9FAFB" },
  modalTitle: { fontSize: 22, fontWeight: "700", color: "#111827", marginBottom: 16 },
  label: { fontSize: 13, color: "#374151", marginBottom: 4, fontWeight: "500", marginTop: 12 },
  input: { backgroundColor: "#fff", borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, borderWidth: 1, borderColor: "#E5E7EB" },
  lineItemRow: { flexDirection: "row", gap: 8, marginBottom: 8, alignItems: "center" },
  lineDesc: { flex: 1, backgroundColor: "#fff", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 8, fontSize: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  lineQty: { width: 50, backgroundColor: "#fff", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 8, fontSize: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  linePrice: { width: 70, backgroundColor: "#fff", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 8, fontSize: 14, borderWidth: 1, borderColor: "#E5E7EB" },
  removeBtn: { color: "#DC2626", fontSize: 18, paddingLeft: 4 },
  addItemBtn: { paddingVertical: 8, alignItems: "center", backgroundColor: "#E0E7FF", borderRadius: 6, marginBottom: 8 },
  addItemText: { color: "#4F46E5", fontWeight: "600" },
  row: { flexDirection: "row", gap: 12 },
  halfInput: { flex: 1 },
  generateButton: { backgroundColor: "#4F46E5", paddingVertical: 14, borderRadius: 10, alignItems: "center", marginTop: 16 },
  generateButtonText: { color: "#fff", fontWeight: "700", fontSize: 16 },
  cancelButton: { paddingVertical: 12, alignItems: "center", marginTop: 8, marginBottom: 32 },
  cancelButtonText: { color: "#6B7280", fontWeight: "500" },
});
