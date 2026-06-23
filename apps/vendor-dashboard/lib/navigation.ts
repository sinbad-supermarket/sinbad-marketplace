import {
  Boxes,
  ClipboardList,
  Home,
  Radio,
  ReceiptText,
  Settings,
  ShoppingBag,
  UserRound,
  WalletCards
} from "lucide-react";

export const navigationItems = [
  { label: "Home", href: "/dashboard", icon: Home, enabled: true },
  { label: "Product Submissions", href: "/submissions", icon: ClipboardList, enabled: true },
  { label: "Products", href: "/products", icon: Boxes, enabled: true },
  { label: "Orders", href: "/orders", icon: ShoppingBag, enabled: true },
  { label: "Commissions", href: "/commissions", icon: WalletCards, enabled: true },
  { label: "Live", href: "/dashboard/live", icon: Radio, enabled: false },
  { label: "Profile", href: "/dashboard/profile", icon: UserRound, enabled: false },
  { label: "Settings", href: "/dashboard/settings", icon: Settings, enabled: true },
  { label: "Support", href: "/dashboard/support", icon: ReceiptText, enabled: false }
];
