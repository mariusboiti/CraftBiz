import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Platform,
  SafeAreaView,
  ScrollView,
  Share,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { NavigationContainer, DefaultTheme } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

/**
 * CRAFTBIZ — MVP v2 (Expo + React Native + TypeScript)
 * Tabs: Calculator, Orders, Quick Replies, Settings
 *
 * NEW in v2:
 * - Persistență locală (AsyncStorage) pentru rețete, comenzi, răspunsuri
 * - Export Ofertă ca PDF (expo-print) + Share
 * - Mic „Recipe preset" list (save/load rapid)
 *
 * Compatibil Expo Go (SDK 54+)
 */

const THEME = {
  bg: "#0F372F",
  card: "#1e463f",
  mut: "#9ec2b6",
  text: "#f7faf9",
  accent: "#F2D14B",
  red: "#ff6b6b",
  green: "#12b886",
};

const Tab = createBottomTabNavigator();

export default function App() {
  return (
    <NavigationContainer
      theme={{
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: THEME.bg,
          card: THEME.card,
          text: THEME.text,
          primary: THEME.accent,
        },
      }}
    >
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerStyle: { backgroundColor: THEME.card },
          headerTitleStyle: { color: THEME.text },
          tabBarStyle: { backgroundColor: THEME.card },
          tabBarActiveTintColor: THEME.accent,
          tabBarInactiveTintColor: THEME.mut,
          tabBarIcon: ({ color, size }) => {
            const map: Record<string, keyof typeof Ionicons.glyphMap> = {
              Calculator: "calculator-outline",
              Orders: "clipboard-outline",
              Replies: "chatbubbles-outline",
              Settings: "settings-outline",
            };
            const name = map[route.name] || "ellipse-outline";
            return <Ionicons name={name as any} size={size} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Calculator" component={CalculatorScreen} />
        <Tab.Screen name="Orders" component={OrdersScreen} />
        <Tab.Screen name="Replies" component={RepliesScreen} />
        <Tab.Screen name="Settings" component={SettingsScreen} />
      </Tab.Navigator>
    </NavigationContainer>
  );
}

// ----------------------------
// 1) CALCULATOR (materials + labor + markup + VAT) + PDF export + presets
// ----------------------------

type Recipe = {
  id: string;
  name: string;
  materialCost: number; // lei
  laborMinutes: number;
  hourlyRate: number; // lei/hour
  markupPct: number; // 0..100
  vatPct: number; // 0..100, e.g. 19
  notes?: string;
};

const DEFAULT_RECIPE: Recipe = {
  id: "preset-1",
  name: "Cutie gravată 20×20",
  materialCost: 30,
  laborMinutes: 25,
  hourlyRate: 60,
  markupPct: 30,
  vatPct: 19,
  notes: "Placaj 4 mm; gravură față; bandă dublu-adezivă",
};

function currency(n: number) {
  return `${n.toFixed(2)} lei`;
}

type KB = "default" | "numeric";
function Field({
  id,
  label,
  value,
  setValue,
  kb = "default",
}: {
  id: string;
  label: string;
  value: string | number;
  setValue: (v: string) => void;
  kb?: KB;
}) {
  return (
    <View key={id} style={{ marginBottom: 12 }}>
      <Text style={{ color: THEME.mut, marginBottom: 6 }}>{label}</Text>
      <TextInput
        keyboardType={kb}
        value={String(value)}
        onChangeText={setValue}
        style={{
          backgroundColor: "#244e45",
          color: THEME.text,
          borderRadius: 12,
          padding: 12,
        }}
      />
    </View>
  );
}

function calcPrice(r: Recipe) {
  const laborCost = (r.laborMinutes / 60) * r.hourlyRate;
  const base = r.materialCost + laborCost;
  const withMarkup = base * (1 + r.markupPct / 100);
  const withVat = withMarkup * (1 + r.vatPct / 100);
  return { laborCost, base, withMarkup, withVat };
}

const K_RECIPES = "craftbiz/recipes";

function usePersistedRecipes(initial: Recipe[]) {
  const [recipes, setRecipes] = useState<Recipe[]>(initial);
  const loaded = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(K_RECIPES);
        if (raw) setRecipes(JSON.parse(raw));
      } catch {}
      loaded.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(K_RECIPES, JSON.stringify(recipes)).catch(() => {});
  }, [recipes]);

  return { recipes, setRecipes } as const;
}

function CalculatorScreen() {
  const { recipes, setRecipes } = usePersistedRecipes([DEFAULT_RECIPE]);
  const [r, setR] = useState<Recipe>(recipes[0] || DEFAULT_RECIPE);
  const [client, setClient] = useState("Client Nume SRL");

  // keep local selected recipe in sync if list changes
  useEffect(() => {
    if (!recipes.length) return;
    const found = recipes.find((x) => x.id === r.id) || recipes[0];
    setR(found);
  }, [recipes.length]);

  const res = useMemo(() => calcPrice(r), [r]);

  const shareOffer = async () => {
    const lines = [
      `Ofertă — ${r.name}`,
      `Client: ${client}`,
      "",
      `Materiale: ${currency(r.materialCost)}`,
      `Manoperă (${r.laborMinutes} min @ ${r.hourlyRate} lei/h): ${currency(
        res.laborCost
      )}`,
      `Subtotal: ${currency(res.base)}`,
      `Adaos ${r.markupPct}%: ${currency(res.withMarkup - res.base)}`,
      `TVA ${r.vatPct}%: ${currency(res.withVat - res.withMarkup)}`,
      `TOTAL: ${currency(res.withVat)}`,
      "",
      r.notes ? `Notițe: ${r.notes}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      await Share.share({ message: lines });
    } catch (e) {
      Alert.alert("Nu s-a putut partaja", String(e));
    }
  };

  const exportPdf = async () => {
    const html = `
      <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body{font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; padding:24px;}
          .card{border:1px solid #e6e6e6; border-radius:12px; padding:20px;}
          h1{margin:0 0 8px 0; font-size:20px;}
          h2{margin:18px 0 6px 0; font-size:16px}
          .row{display:flex; justify-content:space-between; margin:6px 0}
          .total{font-weight:800; color:#000}
          .accent{color:#A47F00}
          small{color:#666}
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Ofertă — ${escapeHtml(r.name)}</h1>
          <small>Client: ${escapeHtml(client)}</small>
          <h2>Detalii costuri</h2>
          <div class="row"><span>Materiale</span><span>${currency(
            r.materialCost
          )}</span></div>
          <div class="row"><span>Manoperă (${r.laborMinutes} min @ ${
      r.hourlyRate
    } lei/h)</span><span>${currency(res.laborCost)}</span></div>
          <div class="row"><span>Subtotal</span><span>${currency(
            res.base
          )}</span></div>
          <div class="row"><span>Adaos ${r.markupPct}%</span><span>${currency(
      res.withMarkup - res.base
    )}</span></div>
          <div class="row"><span>TVA ${r.vatPct}%</span><span>${currency(
      res.withVat - res.withMarkup
    )}</span></div>
          <div class="row total"><span>Total</span><span>${currency(
            res.withVat
          )}</span></div>
          ${r.notes ? `<h2>Notițe</h2><div>${escapeHtml(r.notes)}</div>` : ""}
        </div>
      </body>
      </html>`;

    try {
      const { uri } = await Print.printToFileAsync({ html });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare)
        await Sharing.shareAsync(uri, {
          UTI: "com.adobe.pdf",
          mimeType: "application/pdf",
        });
      else Alert.alert("PDF creat", uri);
    } catch (e) {
      Alert.alert("Nu s-a putut genera PDF", String(e));
    }
  };

  const saveAsPreset = () => {
    const id = `preset-${Date.now()}`;
    const preset: Recipe = { ...r, id };
    setRecipes([preset, ...recipes]);
    Alert.alert("Salvat", "Rețeta a fost salvată în listă.");
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text
          style={{
            color: THEME.text,
            fontSize: 22,
            fontWeight: "700",
            marginBottom: 12,
          }}
        >
          Calculator rapid
        </Text>

        {/* Presets quick bar */}
        {!!recipes.length && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={{ marginBottom: 8 }}
          >
            {recipes.map((p) => (
              <TouchableOpacity
                key={p.id}
                onPress={() => setR(p)}
                style={{
                  backgroundColor: r.id === p.id ? "#3a6b60" : "#2c5a50",
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  marginRight: 8,
                }}
              >
                <Text style={{ color: THEME.text }}>
                  {truncate(p.name, 20)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        <Field
          id="prod"
          label="Denumire produs"
          value={r.name}
          setValue={(v) => setR({ ...r, name: v })}
        />
        <Field
          id="mat"
          label="Cost materiale (lei)"
          value={r.materialCost}
          setValue={(v) => setR({ ...r, materialCost: parseFloat(v || "0") })}
          kb="numeric"
        />
        <Field
          id="mins"
          label="Minute manoperă"
          value={r.laborMinutes}
          setValue={(v) => setR({ ...r, laborMinutes: parseFloat(v || "0") })}
          kb="numeric"
        />
        <Field
          id="rate"
          label="Tarif orar (lei/oră)"
          value={r.hourlyRate}
          setValue={(v) => setR({ ...r, hourlyRate: parseFloat(v || "0") })}
          kb="numeric"
        />
        <Field
          id="markup"
          label="Adaos %"
          value={r.markupPct}
          setValue={(v) => setR({ ...r, markupPct: parseFloat(v || "0") })}
          kb="numeric"
        />
        <Field
          id="vat"
          label="TVA %"
          value={r.vatPct}
          setValue={(v) => setR({ ...r, vatPct: parseFloat(v || "0") })}
          kb="numeric"
        />
        <Field
          id="notes"
          label="Notițe"
          value={r.notes || ""}
          setValue={(v) => setR({ ...r, notes: v })}
        />
        <Field
          id="client"
          label="Nume client"
          value={client}
          setValue={setClient}
        />

        <View
          style={{
            backgroundColor: "#264f46",
            borderRadius: 16,
            padding: 14,
            marginTop: 8,
          }}
        >
          <Row label="Manoperă" value={currency(res.laborCost)} />
          <Row label="Subtotal" value={currency(res.base)} />
          <Row
            label={`Adaos ${r.markupPct}%`}
            value={currency(res.withMarkup - res.base)}
          />
          <Row
            label={`TVA ${r.vatPct}%`}
            value={currency(res.withVat - res.withMarkup)}
          />
          <Row label="TOTAL" value={currency(res.withVat)} bold />
        </View>

        <CTA title="Trimite ofertă (Share)" onPress={shareOffer} />
        <CTA title="Exportă PDF" onPress={exportPdf} />
        <CTA title="Salvează ca rețetă" onPress={saveAsPreset} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 6,
      }}
    >
      <Text style={{ color: THEME.text, opacity: 0.9 }}>{label}</Text>
      <Text style={{ color: THEME.accent, fontWeight: bold ? "800" : "600" }}>
        {value}
      </Text>
    </View>
  );
}

function CTA({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{
        backgroundColor: THEME.accent,
        borderRadius: 14,
        padding: 14,
        marginTop: 14,
      }}
    >
      <Text
        style={{ textAlign: "center", fontWeight: "800", color: "#0a201b" }}
      >
        {title}
      </Text>
    </TouchableOpacity>
  );
}

const K_ORDERS = "craftbiz/orders";

type Status = "plasată" | "în lucru" | "livrată" | "plătită";

type Order = {
  id: string;
  client: string;
  item: string;
  dueDate: string; // ISO date
  status: Status;
  total: number;
};

const SEED_ORDERS: Order[] = [
  {
    id: "1",
    client: "Ana Pop",
    item: 'Tablă nume "Mihail"',
    dueDate: new Date(Date.now() + 86400000).toISOString(),
    status: "plasată",
    total: 180,
  },
  {
    id: "2",
    client: "Studio X",
    item: "Cutie gravată 20×20",
    dueDate: new Date().toISOString(),
    status: "în lucru",
    total: 130,
  },
];

function OrdersScreen() {
  const [orders, setOrders] = useState<Order[]>(SEED_ORDERS);
  const [newClient, setNewClient] = useState("");
  const [newItem, setNewItem] = useState("");
  const [newTotal, setNewTotal] = useState("");
  const loaded = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(K_ORDERS);
        if (raw) setOrders(JSON.parse(raw));
      } catch {}
      loaded.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(K_ORDERS, JSON.stringify(orders)).catch(() => {});
  }, [orders]);

  const cycle = (s: Status): Status =>
    s === "plasată"
      ? "în lucru"
      : s === "în lucru"
      ? "livrată"
      : s === "livrată"
      ? "plătită"
      : "plătită";

  const add = () => {
    if (!newClient || !newItem || !newTotal)
      return Alert.alert("Completați client, articol, total");
    const o: Order = {
      id: String(Date.now()),
      client: newClient,
      item: newItem,
      dueDate: new Date().toISOString(),
      status: "plasată",
      total: parseFloat(newTotal),
    };
    setOrders([o, ...orders]);
    setNewClient("");
    setNewItem("");
    setNewTotal("");
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text
          style={{
            color: THEME.text,
            fontSize: 22,
            fontWeight: "700",
            marginBottom: 12,
          }}
        >
          Agenda de comenzi
        </Text>

        <View
          style={{
            backgroundColor: "#244e45",
            borderRadius: 16,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: THEME.mut, marginBottom: 6 }}>
            Adaugă comandă
          </Text>
          <TextInput
            placeholder="Client"
            placeholderTextColor={THEME.mut}
            style={inputStyle()}
            value={newClient}
            onChangeText={setNewClient}
          />
          <TextInput
            placeholder="Articol"
            placeholderTextColor={THEME.mut}
            style={inputStyle()}
            value={newItem}
            onChangeText={setNewItem}
          />
          <TextInput
            placeholder="Total (lei)"
            placeholderTextColor={THEME.mut}
            style={inputStyle()}
            value={newTotal}
            onChangeText={setNewTotal}
            keyboardType="numeric"
          />
          <CTA title="Adaugă" onPress={add} />
        </View>

        {orders.map((o) => (
          <View
            key={o.id}
            style={{
              backgroundColor: "#264f46",
              borderRadius: 16,
              padding: 14,
              marginBottom: 10,
            }}
          >
            <Text style={{ color: THEME.text, fontWeight: "700" }}>
              {o.client}
            </Text>
            <Text style={{ color: THEME.mut }}>{o.item}</Text>
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                marginTop: 8,
              }}
            >
              <Text style={{ color: THEME.mut }}>
                Scadent: {new Date(o.dueDate).toLocaleDateString()}
              </Text>
              <Text style={{ color: THEME.accent, fontWeight: "700" }}>
                {currency(o.total)}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() =>
                setOrders(
                  orders.map((x) =>
                    x.id === o.id ? { ...x, status: cycle(x.status) } : x
                  )
                )
              }
              style={{
                marginTop: 10,
                backgroundColor: "#345e54",
                padding: 10,
                borderRadius: 10,
              }}
            >
              <Text style={{ textAlign: "center", color: THEME.text }}>
                Status: {o.status} → tap pentru următorul
              </Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function inputStyle() {
  return {
    backgroundColor: "#2b5a50",
    color: THEME.text,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  } as const;
}

const K_REPLIES = "craftbiz/replies";

type Reply = { id: string; q: string; a: string; category: string };
const DEFAULT_REPLIES: Reply[] = [
  {
    id: "r1",
    category: "Preț",
    q: "Cât costă?",
    a: "Prețul depinde de dimensiune și personalizare. Exemple: 20×20 cm de la 130 lei. Spune-mi mărimea dorită și personalizez oferta. 😊",
  },
  {
    id: "r2",
    category: "Timp",
    q: "În cât timp livrați?",
    a: "Producția durează 1–3 zile lucrătoare, iar livrarea 1–2 zile. Pentru urgențe, avem opțiune rapidă.",
  },
  {
    id: "r3",
    category: "Culoare",
    q: "Faceți pe albastru?",
    a: "Da, putem face pe aproape orice culoare. Trimite-mi o poză de referință și potrivim nuanța.",
  },
];

function RepliesScreen() {
  const [replies, setReplies] = useState<Reply[]>(DEFAULT_REPLIES);
  const [q, setQ] = useState("");
  const [a, setA] = useState("");
  const [cat, setCat] = useState("General");
  const loaded = useRef(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(K_REPLIES);
        if (raw) setReplies(JSON.parse(raw));
      } catch {}
      loaded.current = true;
    })();
  }, []);

  useEffect(() => {
    if (!loaded.current) return;
    AsyncStorage.setItem(K_REPLIES, JSON.stringify(replies)).catch(() => {});
  }, [replies]);

  const add = () => {
    if (!a) return Alert.alert("Completează răspunsul");
    setReplies([{ id: String(Date.now()), q, a, category: cat }, ...replies]);
    setQ("");
    setA("");
    setCat("General");
  };

  const copyShare = async (text: string) => {
    try {
      await Share.share({ message: text });
    } catch (e) {
      Alert.alert("Eroare partajare", String(e));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text
          style={{
            color: THEME.text,
            fontSize: 22,
            fontWeight: "700",
            marginBottom: 12,
          }}
        >
          Răspunsuri rapide
        </Text>

        <View
          style={{
            backgroundColor: "#244e45",
            borderRadius: 16,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ color: THEME.mut, marginBottom: 6 }}>
            Adaugă răspuns
          </Text>
          <TextInput
            placeholder="Întrebare (opțional)"
            placeholderTextColor={THEME.mut}
            style={inputStyle()}
            value={q}
            onChangeText={setQ}
          />
          <TextInput
            placeholder="Categorie"
            placeholderTextColor={THEME.mut}
            style={inputStyle()}
            value={cat}
            onChangeText={setCat}
          />
          <TextInput
            placeholder="Răspuns"
            placeholderTextColor={THEME.mut}
            style={[inputStyle(), { minHeight: 80 }]}
            value={a}
            onChangeText={setA}
            multiline
          />
          <CTA title="Salvează" onPress={add} />
        </View>

        {replies.map((r) => (
          <View
            key={r.id}
            style={{
              backgroundColor: "#264f46",
              borderRadius: 16,
              padding: 14,
              marginBottom: 10,
            }}
          >
            <Text style={{ color: THEME.text, fontWeight: "700" }}>
              {r.q || "—"}
            </Text>
            <Text style={{ color: THEME.mut, marginBottom: 8 }}>
              {r.category}
            </Text>
            <Text style={{ color: THEME.text }}>{r.a}</Text>
            <TouchableOpacity
              onPress={() => copyShare(r.a)}
              style={{
                marginTop: 10,
                backgroundColor: "#345e54",
                padding: 10,
                borderRadius: 10,
              }}
            >
              <Text style={{ textAlign: "center", color: THEME.text }}>
                Copiază/Trimite
              </Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

// ----------------------------
// 4) SETTINGS — notes & next steps
// ----------------------------
function SettingsScreen() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <Text
          style={{
            color: THEME.text,
            fontSize: 22,
            fontWeight: "700",
            marginBottom: 12,
          }}
        >
          Setări
        </Text>
        <Text style={{ color: THEME.mut, lineHeight: 22 }}>
          Urmează:
          {"\n"}• Template-uri premium PDF (stiluri grafice)
          {"\n"}• Backup în cloud + login
          {"\n"}• Notificări pentru livrări (Expo Notifications)
          {"\n"}• Export contabil (CSV)
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ----------------------------
// helpers
// ----------------------------
function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function escapeHtml(s: string) {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[
        c
      ]!)
  );
}

// ---------------
// KILO CODE PATCH v2 (copy one-by-one)
// ---------------
/**
1) INSTALL deps
"""
In the existing Expo project, install persistence + PDF deps aligned with SDK 54:
- npx expo install @react-native-async-storage/async-storage expo-print expo-sharing
"""

2) REPLACE APP
"""
Open App.tsx and replace its entire contents with the v2 code I provide (this file). Ensure it compiles in Expo Go on Android & iOS.
"""

3) RUN
"""
- npx expo start -c
- Open on Android (emulator) or scan with Expo Go
"""

4) BRANCH + PR WORKFLOW
- git checkout -b feat/persist-pdf
- git add . && git commit -m "feat: persistence (AsyncStorage) + offer PDF export"
- git push -u origin feat/persist-pdf
- Open PR → merge → delete branch
- git checkout main && git pull
*/
