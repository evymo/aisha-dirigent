/**
 * Členské taby. Settings je v hlavičce.
 *
 * ⭐ TABY JSOU SEZNAM, NE ČTYŘI KOPIE JSX. Do 2026-08-19 tu stály čtyři ručně
 * vypsané `<Tabs.Screen>` bloky; dedikovaný build (appka jen pro řidiče, jen
 * pro odečty) by se z nich nedal odvodit jinak než pátou kopií s `if`. Registr
 * níž je JEDINÉ místo, kde je napsané, jaké taby existují — a profil buildu
 * z něj jen vybírá.
 *
 * ⚠️ Vyřazený tab se musí VYKRESLIT s `href: null`, ne vynechat. Route je
 * souborová: kdyby tu jeho `<Tabs.Screen>` chyběl, expo-router mu dá výchozí
 * volby a tab se objeví v liště i tak — tedy přesně to, čemu se tu brání.
 */
import { TouchableOpacity, View } from "react-native";
import { Tabs, router } from "expo-router";
import { useTranslation } from "@/hooks";
import { colors } from "@/theme";
import { appTabs } from "@/config/profile";
import { TABS, visibleTabs } from "./registry";
import {
  LayoutDashboard,
  BookOpen,
  User,
  Settings,
  Wallet,
  DoorClosed,
  type LucideIcon,
} from "lucide-react-native";

/**
 * Ikona ke každému tabu. `Record` nad jmény z registru znamená, že přidaný tab
 * BEZ ikony neprojde typovou kontrolou — jinak by se vykreslil prázdný čtverec
 * a nikdo by si toho do vydání nevšiml.
 */
const ICONS: Record<string, LucideIcon> = {
  index: LayoutDashboard,
  projects: BookOpen,
  monitor: User,
  wallet: Wallet,
};

/**
 * Dveře a nastavení v hlavičce — dostupné z KAŽDÉ obrazovky appky.
 *
 * ⛔ NAMĚŘENO 2026-08-20 a doplněno 2026-09-02. Cesta k ručnímu ťukání vedla
 * nejdřív JEN z banneru po neúspěšném odeslání (`kroky.tsx`), pak přibyl tichý
 * odkaz v patě přihlášení. Po přihlášení ale pořád nebyla — kdo se dostal
 * dovnitř a potřeboval zaťukat znovu (vypršel otvor, změnila se síť), musel jít
 * přes URL. Tenhle symbol to zavírá: táž ikona jako na přihlášení, takže si ji
 * člověk spojí, a nemusí nic opisovat.
 *
 * ⭐ TICHÉ, NE NÁPADNÉ. Ikona je v hlavičce vedle nastavení, ne v liště tabů:
 * break-glass, který lidé vidí denně jako hlavní volbu, přestane být
 * break-glass. `DoorClosed`, ne `DoorOpen` — dveře jsou zavřené a teprve se na
 * ně klepe; otevřené by slibovaly stav, který nastane až PO zaťukání.
 */
function HeaderActions() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16, paddingRight: 4 }}>
      <TouchableOpacity
        onPress={() => router.push("/zaklepat")}
        hitSlop={8}
        testID="header-zaklepat-btn"
        accessibilityRole="button"
      >
        <DoorClosed size={22} color={colors.textSecondary} />
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => router.push("/settings")}
        hitSlop={8}
        testID="header-settings-btn"
      >
        <Settings size={22} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

export default function TabLayout() {
  const { t } = useTranslation();
  const viditelne = visibleTabs(TABS, appTabs());

  return (
    <Tabs
      screenOptions={{
        headerRight: () => <HeaderActions />,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.text,
        headerShadowVisible: false,
      }}
    >
      {TABS.map(({ name, titleKey, testID }) => {
        const Icon = ICONS[name];
        return (
          <Tabs.Screen
            key={name}
            name={name}
            options={{
              title: t(titleKey),
              tabBarButtonTestID: testID,
              tabBarIcon: ({ color, size }) => <Icon size={size} color={color} />,
              // `href: null` = route zůstane, tab z lišty zmizí.
              href: viditelne.includes(name) ? undefined : null,
            }}
          />
        );
      })}
    </Tabs>
  );
}
