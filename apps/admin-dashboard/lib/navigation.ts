import {
  BadgeDollarSign,
  ClipboardList,
  FileCheck2,
  Home,
  ListChecks,
  Radio,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Store,
  Truck
} from "lucide-react";

export const sidebarItems = [
  { label: "Home", href: "/dashboard", icon: Home },
  { label: "Vendor Applications", href: "/applications", icon: FileCheck2 },
  { label: "Vendors", href: "/vendors", icon: Store },
  { label: "Product Submissions", href: "/product-submissions", icon: ClipboardList },
  { label: "Products", href: "/dashboard/products", icon: ShoppingBag },
  { label: "Orders", href: "/dashboard/orders", icon: Truck },
  { label: "Commissions", href: "/commissions", icon: BadgeDollarSign },
  { label: "Vendor Live", href: "/vendor-live", icon: Radio },
  { label: "Shopify Connection", href: "/shopify-scope-check", icon: ShieldCheck },
  { label: "Audit Logs", href: "/dashboard/audit-logs", icon: ScrollText },
  { label: "Admin Users", href: "/dashboard/admin-users", icon: Settings }
] as const;

export const homeStats = [
  { label: "Applications", value: "Ready", icon: ListChecks },
  { label: "Product Review", value: "Ready", icon: ClipboardList },
  { label: "Commissions", value: "Ready", icon: BadgeDollarSign }
] as const;
