import {
  ArrowLeftRight,
  BarChart3,
  Barcode,
  Boxes,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Contact,
  CreditCard,
  Factory,
  FileMinus,
  FileText,
  HandCoins,
  PackageOpen,
  Gauge,
  Hash,
  History,
  Inbox,
  LayoutDashboard,
  ListChecks,
  ListPlus,
  MessagesSquare,
  Lock,
  Package,
  PackageCheck,
  Plug,
  Printer,
  Receipt,
  ReceiptText,
  Ruler,
  ScrollText,
  Send,
  ShieldCheck,
  Ship,
  ShoppingCart,
  Sparkles,
  Tags,
  Truck,
  Upload,
  Users,
  Wallet,
  Warehouse as WarehouseIcon,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Any of these permissions shows the item. Omit for always visible. */
  permissions?: string[];
  /** Roadmap phase that delivers the module (docs/PHASE_PLAN.md). Shown as "coming soon". */
  comingInPhase?: number;
  /** Live counter shown next to the label. */
  badge?: "approvals";
}

export interface NavSection {
  title?: string;
  items: NavItem[];
}

export const NAVIGATION: NavSection[] = [
  {
    items: [
      { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { label: "Approvals", href: "/approvals", icon: Inbox, badge: "approvals" },
    ],
  },
  {
    title: "Operations",
    items: [
      { label: "Stock levels", href: "/inventory/stock", icon: Boxes, permissions: ["inventory.stock.read"] },
      { label: "Stock entries", href: "/inventory/stock-entries", icon: ArrowLeftRight, permissions: ["inventory.stock.read"] },
      { label: "Stock ledger", href: "/inventory/ledger", icon: ScrollText, permissions: ["inventory.stock.read"] },
      { label: "Stock counts", href: "/inventory/stock-counts", icon: ListChecks, permissions: ["inventory.stock.read"] },
      { label: "Labels", href: "/print/labels", icon: Barcode, permissions: ["masters.items.read"] },
      { label: "Purchase requisitions", href: "/purchase/requisitions", icon: ClipboardList, permissions: ["purchase.requisitions.read"] },
      { label: "Purchase orders", href: "/purchase/orders", icon: Truck, permissions: ["purchase.orders.read"] },
      { label: "Goods receipts", href: "/purchase/receipts", icon: PackageCheck, permissions: ["purchase.receipts.read"] },
      { label: "Purchase invoices", href: "/purchase/invoices", icon: ReceiptText, permissions: ["purchase.invoices.read"] },
      { label: "Debit notes", href: "/purchase/debit-notes", icon: FileMinus, permissions: ["purchase.invoices.read"] },
      { label: "Landed costs", href: "/purchase/landed-costs", icon: Ship, permissions: ["purchase.invoices.read"] },
      { label: "RFQs", href: "/purchase/rfqs", icon: MessagesSquare, permissions: ["purchase.rfq.read"] },
      { label: "Vendor performance", href: "/purchase/vendor-performance", icon: Gauge, permissions: ["purchase.orders.read"] },
      { label: "Manufacturing", href: "/manufacturing", icon: Factory, comingInPhase: 5 },
      { label: "Quality", href: "/quality", icon: ClipboardCheck, comingInPhase: 5 },
    ],
  },
  {
    title: "Sales",
    items: [
      { label: "Quotations", href: "/sales/quotations", icon: FileText, permissions: ["sales.quotations.read"] },
      { label: "Sales orders", href: "/sales/orders", icon: ShoppingCart, permissions: ["sales.orders.read"] },
      { label: "Deliveries", href: "/sales/deliveries", icon: PackageOpen, permissions: ["sales.deliveries.read"] },
      { label: "Sales invoices", href: "/sales/invoices", icon: Receipt, permissions: ["sales.invoices.read"] },
      { label: "Credit notes", href: "/sales/credit-notes", icon: FileMinus, permissions: ["sales.invoices.read"] },
      { label: "Receivables", href: "/sales/receivables", icon: HandCoins, permissions: ["sales.invoices.read"] },
    ],
  },
  {
    title: "Masters",
    items: [
      { label: "Items", href: "/masters/items", icon: Package, permissions: ["masters.items.read"] },
      { label: "Customers & vendors", href: "/masters/parties", icon: Contact, permissions: ["masters.parties.read"] },
      { label: "Price lists", href: "/masters/price-lists", icon: Tags, permissions: ["masters.items.read"] },
      { label: "Warehouses", href: "/inventory/warehouses", icon: WarehouseIcon, permissions: ["inventory.warehouses.read"] },
      { label: "Units & item groups", href: "/masters/setup", icon: Ruler, permissions: ["masters.items.read"] },
      { label: "Import data", href: "/masters/import", icon: Upload, permissions: ["masters.items.manage", "masters.parties.manage", "inventory.entries.manage"] },
    ],
  },
  {
    title: "Finance",
    items: [
      { label: "Accounting", href: "/accounting", icon: Wallet, comingInPhase: 4 },
      { label: "GST & Compliance", href: "/gst", icon: Receipt, comingInPhase: 3 },
    ],
  },
  {
    title: "Insights",
    items: [
      { label: "Reports", href: "/reports", icon: BarChart3, comingInPhase: 6 },
      { label: "AI Copilot", href: "/copilot", icon: Sparkles, comingInPhase: 6 },
    ],
  },
  {
    title: "Settings",
    items: [
      { label: "Companies & branches", href: "/settings/companies", icon: Building2, permissions: ["org.companies.read"] },
      { label: "Users & access", href: "/settings/users", icon: Users, permissions: ["iam.users.read"] },
      { label: "Roles & permissions", href: "/settings/roles", icon: ShieldCheck, permissions: ["iam.roles.read"] },
      { label: "Number series", href: "/settings/number-series", icon: Hash, permissions: ["platform.numbering.manage"] },
      { label: "Approval workflows", href: "/settings/approval-workflows", icon: Workflow, permissions: ["platform.workflows.manage"] },
      { label: "Custom fields", href: "/settings/custom-fields", icon: ListPlus, permissions: ["platform.customization.manage"] },
      { label: "Print formats", href: "/settings/print-formats", icon: Printer, permissions: ["platform.customization.manage"] },
      { label: "Audit trail", href: "/settings/audit", icon: History, permissions: ["platform.audit.read"] },
      { label: "Message log", href: "/settings/message-log", icon: Send, permissions: ["platform.settings.manage"] },
      { label: "API & webhooks", href: "/settings/integrations", icon: Plug, permissions: ["platform.integrations.manage"] },
      { label: "Data protection", href: "/settings/privacy", icon: Lock, permissions: ["platform.privacy.manage"] },
      { label: "Billing & plan", href: "/settings/billing", icon: CreditCard, permissions: ["platform.billing.manage"] },
    ],
  },
];
