import {
  ActivitySquare,
  Handshake,
  Siren,
  BookOpenCheck,
  ClipboardPen,
  Crosshair,
  HardHat,
  ShieldAlert,
  BadgeCheck,
  Smartphone,
  DatabaseBackup,
  KeyRound,
  Palette,
  FolderOpen,
  FileBox,
  ChartGantt,
  FolderKanban,
  Split,
  Layers,
  FileChartColumn,
  Recycle,
  Leaf,
  Cpu,
  Shirt,
  Award,
  Tag,
  Undo2,
  Wheat,
  Salad,
  TriangleAlert,
  FileStack,
  Milestone,
  GitPullRequestArrow,
  MessageSquareWarning,
  CalendarClock,
  FileWarning,
  FlaskRound,
  CalendarRange,
  FileCog,
  LayoutGrid,
  PencilRuler,
  Combine,
  LineChart,
  FlaskConical,
  LifeBuoy,
  Rocket,
  Tablet,
  TrendingDown,
  GitBranch,
  Factory,
  MonitorPlay,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpFromLine,
  BarChart3,
  BookOpen,
  CalendarDays,
  Barcode,
  Boxes,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Contact,
  CreditCard,
  Network,
  Cog,
  FileBarChart,
  FileDiff,
  Percent,
  Building,
  FileMinus,
  FileCheck2,
  FileSpreadsheet,
  FileText,
  HandCoins,
  PackageOpen,
  Gauge,
  Lightbulb,
  PieChart,
  Target,
  CalendarCheck,
  Hammer,
  Hash,
  History,
  Inbox,
  Landmark,
  Landmark as BankIcon,
  Repeat,
  Hourglass,
  Banknote,
  LayoutDashboard,
  ListChecks,
  ListTree,
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
  Scale,
  ScrollText,
  Settings2,
  NotebookPen,
  Send,
  ShieldCheck,
  Ship,
  ShoppingCart,
  Sparkles,
  Tags,
  Truck,
  Upload,
  Users,
  Warehouse as WarehouseIcon,
  Workflow,
  Wrench,
  ScanLine,
  type LucideIcon,
  Database,
  UserCog,
  Settings,
  ShoppingBag,
  IdCard,
  FileSignature,
  UsersRound,
  Clock,
  Plane,
  CalendarCog,
  Fingerprint,
  Activity,
  BellRing,
  Cable,
  Router,
  Tv,
  TimerOff,
  Zap,
  AudioWaveform,
  Thermometer,
  MonitorSmartphone,
  Map as MapIcon,
  GitCompare,
  ScanEye,
  Wind,
  ScanText,
  Mic,
  Bot,
  Radio,
  Route,
  RotateCcw,
  Disc3,
  Cylinder,
  ArrowDownUp,
  Flame,
  Grid3x3,
  Warehouse,
  Globe,
  Timer,
  PackageX,
  ScanBarcode,
  Headset,
  Navigation,
  BadgePercent,
  Store,
  Puzzle,
  SlidersHorizontal,
  Kanban,
  Magnet,
  Radar,
  ReceiptIndianRupee,
  House,
  GraduationCap,
  DoorOpen,
  UserPlus,
  Wallet,
  IndianRupee,
  Calculator,
} from "lucide-react";

export interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Any of these permissions shows the item. Omit for always visible. */
  permissions?: string[];
  /** Roadmap phase that delivers the module (docs/PHASE_PLAN.md). Shown as "coming soon". */
  comingInPhase?: number;
  /** Opens the copilot panel instead of navigating. */
  opensCopilot?: boolean;
  /** Live counter shown next to the label. */
  badge?: "approvals";
  /** Optional module the screen belongs to; hidden when the workspace has it switched off. */
  module?: string;
}

export interface NavSection {
  /** Sub-heading inside a group; omit for the first or only section. */
  title?: string;
  /** Optional module of every item in the section. */
  module?: string;
  items: NavItem[];
}

/** A top-level module in the sidebar: a heading that expands to its screens. */
export interface NavGroup {
  title: string;
  /** Caption the group sits under in the sidebar; consecutive groups share it. */
  category: string;
  icon: LucideIcon;
  /** Optional module of the whole group. */
  module?: string;
  sections: NavSection[];
}

/** Always visible above the groups. */
export const PINNED: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Approvals", href: "/approvals", icon: Inbox, badge: "approvals" },
];

/** Shown at the foot of the sidebar. */
export const FOOTER: NavItem[] = [
  { label: "Set up", href: "/setup", icon: Rocket },
  { label: "Help", href: "/help", icon: LifeBuoy },
];

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Master data",
    category: "Operations",
    icon: Database,
    sections: [
      {
        items: [
          { label: "Items", href: "/masters/items", icon: Package, permissions: ["masters.items.read"] },
          { label: "Customers & vendors", href: "/masters/parties", icon: Contact, permissions: ["masters.parties.read"] },
          { label: "Price lists", href: "/masters/price-lists", icon: Tags, permissions: ["masters.items.read"] },
          { label: "Units & item groups", href: "/masters/setup", icon: Ruler, permissions: ["masters.items.read"] },
          { label: "Warehouses", href: "/inventory/warehouses", icon: WarehouseIcon, permissions: ["inventory.warehouses.read"] },
          { label: "Companies & branches", href: "/settings/companies", icon: Building2, permissions: ["org.companies.read"] },
          { label: "Labels", href: "/print/labels", icon: Barcode, permissions: ["masters.items.read"] },
          { label: "Import data", href: "/masters/import", icon: Upload, permissions: ["masters.items.manage", "masters.parties.manage", "inventory.entries.manage"] },
        ],
      },
    ],
  },
  {
    title: "Sales",
    category: "Operations",
    icon: ShoppingCart,
    sections: [
      {
        items: [
          { label: "Quotations", href: "/sales/quotations", icon: FileText, permissions: ["sales.quotations.read"] },
          { label: "Sales orders", href: "/sales/orders", icon: ShoppingCart, permissions: ["sales.orders.read"] },
          { label: "Customer schedules", href: "/sales/schedules", icon: CalendarRange, permissions: ["sales.schedules.read"] },
          { label: "Deliveries", href: "/sales/deliveries", icon: PackageOpen, permissions: ["sales.deliveries.read"] },
          { label: "Sales invoices", href: "/sales/invoices", icon: Receipt, permissions: ["sales.invoices.read"] },
          { label: "Credit notes", href: "/sales/credit-notes", icon: FileMinus, permissions: ["sales.invoices.read"] },
          { label: "Receivables", href: "/sales/receivables", icon: HandCoins, permissions: ["sales.invoices.read"] },
        ],
      },
      {
        title: "Channels",
        items: [
          { label: "Point of sale", href: "/pos", icon: ReceiptText, module: "pos", permissions: ["pos.sales.use"] },
          { label: "Customer portal", href: "/sales/portal", icon: Globe, module: "portal", permissions: ["portal.orders.manage", "portal.users.manage"] },
        ],
      },
    ],
  },
  {
    title: "CRM",
    category: "Operations",
    icon: Radar,
    module: "crm",
    sections: [
      {
        items: [
          { label: "CRM home", href: "/crm", icon: Radar, permissions: ["crm.leads.read"] },
          { label: "Leads", href: "/crm/leads", icon: Magnet, permissions: ["crm.leads.read"] },
          { label: "Pipeline", href: "/crm/pipeline", icon: Kanban, permissions: ["crm.opportunities.read"] },
          { label: "Estimates", href: "/crm/estimates", icon: Calculator, permissions: ["cpq.estimates.read"] },
          { label: "Configurator", href: "/crm/configurator", icon: Puzzle, permissions: ["cpq.estimates.read"] },
          { label: "CRM setup", href: "/crm/setup", icon: SlidersHorizontal, permissions: ["crm.opportunities.read"] },
        ],
      },
    ],
  },
  {
    title: "Purchase",
    category: "Operations",
    icon: ShoppingBag,
    sections: [
      {
        items: [
          { label: "Purchase requisitions", href: "/purchase/requisitions", icon: ClipboardList, permissions: ["purchase.requisitions.read"] },
          { label: "RFQs", href: "/purchase/rfqs", icon: MessagesSquare, permissions: ["purchase.rfq.read"] },
          { label: "Purchase orders", href: "/purchase/orders", icon: Truck, permissions: ["purchase.orders.read"] },
          { label: "Goods receipts", href: "/purchase/receipts", icon: PackageCheck, permissions: ["purchase.receipts.read"] },
          { label: "Purchase invoices", href: "/purchase/invoices", icon: ReceiptText, permissions: ["purchase.invoices.read"] },
          { label: "Debit notes", href: "/purchase/debit-notes", icon: FileMinus, permissions: ["purchase.invoices.read"] },
          { label: "Landed costs", href: "/purchase/landed-costs", icon: Ship, permissions: ["purchase.invoices.read"] },
          { label: "Bills of Entry", href: "/purchase/bills-of-entry", icon: Landmark, permissions: ["purchase.invoices.read"] },
          { label: "Vendor performance", href: "/purchase/vendor-performance", icon: Gauge, permissions: ["purchase.orders.read"] },
        ],
      },
      {
        title: "Job work",
        items: [
          { label: "Job-work challans", href: "/job-work/challans", icon: Wrench, permissions: ["jobwork.challans.read"] },
          { label: "Job-work receipts", href: "/job-work/receipts", icon: Hammer, permissions: ["jobwork.challans.read"] },
        ],
      },
    ],
  },
  {
    title: "Inventory",
    category: "Operations",
    icon: Boxes,
    sections: [
      {
        items: [
          { label: "Stock levels", href: "/inventory/stock", icon: Boxes, permissions: ["inventory.stock.read"] },
          { label: "Stock entries", href: "/inventory/stock-entries", icon: ArrowLeftRight, permissions: ["inventory.stock.read"] },
          { label: "Stock ledger", href: "/inventory/ledger", icon: ScrollText, permissions: ["inventory.stock.read"] },
          { label: "Stock counts", href: "/inventory/stock-counts", icon: ListChecks, permissions: ["inventory.stock.read"] },
        ],
      },
    ],
  },
  {
    title: "Warehouse",
    category: "Operations",
    icon: Warehouse,
    module: "wms",
    sections: [
      {
        items: [
          { label: "Warehouses", href: "/wms", icon: Warehouse, permissions: ["inventory.stock.read"] },
          { label: "Dock schedule", href: "/wms/docks", icon: CalendarClock, permissions: ["inventory.stock.read"] },
          { label: "Receiving", href: "/wms/receiving", icon: PackageOpen, permissions: ["wms.tasks.execute"] },
          { label: "Picking & packing", href: "/wms/waves", icon: PackageCheck, permissions: ["inventory.stock.read"] },
          { label: "Floor tasks", href: "/wms/tasks", icon: ClipboardCheck, permissions: ["inventory.stock.read"] },
          { label: "Scan", href: "/wms/scan", icon: ScanLine, permissions: ["inventory.stock.read"] },
          { label: "Cycle counts", href: "/wms/counts", icon: ListChecks, permissions: ["inventory.stock.read"] },
          { label: "Replenish & slotting", href: "/wms/slotting", icon: ArrowDownUp, permissions: ["inventory.stock.read"] },
        ],
      },
      {
        title: "Storage",
        items: [
          { label: "Bins & zones", href: "/wms/bins", icon: Grid3x3, permissions: ["inventory.stock.read"] },
          { label: "Item storage", href: "/wms/items", icon: Boxes, permissions: ["inventory.stock.read"] },
          { label: "Tanks", href: "/wms/tanks", icon: Cylinder, permissions: ["inventory.stock.read"] },
          { label: "Reels (MSL)", href: "/wms/reels", icon: Disc3, permissions: ["inventory.stock.read"] },
          { label: "Returnables", href: "/wms/returnables", icon: RotateCcw, permissions: ["inventory.stock.read"] },
          { label: "Consignment", href: "/wms/consignments", icon: Handshake, permissions: ["inventory.stock.read"] },
          { label: "3PL warehousing", href: "/wms/3pl", icon: Building2, permissions: ["inventory.stock.read"] },
        ],
      },
      {
        title: "Insights",
        items: [
          { label: "Heat map", href: "/wms/heatmap", icon: Flame, permissions: ["inventory.stock.read"] },
          { label: "Floor insights", href: "/wms/insights", icon: Gauge, permissions: ["inventory.stock.read"] },
          { label: "RFID gate", href: "/wms/rfid", icon: Radio, permissions: ["inventory.stock.read"] },
        ],
      },
    ],
  },
  {
    title: "Manufacturing",
    category: "Production",
    icon: Factory,
    module: "manufacturing",
    sections: [
      {
        items: [
          { label: "Work orders", href: "/manufacturing/work-orders", icon: Factory, permissions: ["manufacturing.production.read"] },
          { label: "Shop floor", href: "/manufacturing/shop-floor", icon: MonitorPlay, permissions: ["manufacturing.production.read"] },
          { label: "Shop-floor kiosk", href: "/manufacturing/kiosk", icon: Tablet, permissions: ["manufacturing.shopfloor.record"] },
          { label: "Scrap and rejects", href: "/manufacturing/scrap", icon: TrendingDown, permissions: ["manufacturing.production.read"] },
        ],
      },
      {
        title: "Engineering",
        items: [
          { label: "Bills of materials", href: "/manufacturing/boms", icon: Network, permissions: ["manufacturing.engineering.read"] },
          { label: "Work centres & tools", href: "/manufacturing/resources", icon: Cog, permissions: ["manufacturing.engineering.read"] },
          { label: "Engineering changes", href: "/engineering/changes", icon: FileCog, permissions: ["manufacturing.engineering.read"] },
          { label: "Drawings", href: "/engineering/drawings", icon: PencilRuler, permissions: ["manufacturing.engineering.read"] },
        ],
      },
      {
        title: "Process industries",
        module: "process",
        items: [
          { label: "Formulas", href: "/process/formulas", icon: FlaskConical, permissions: ["manufacturing.engineering.read"] },
          { label: "Packing", href: "/process/packing", icon: PackageOpen, permissions: ["manufacturing.production.read"] },
          { label: "Blends", href: "/process/blends", icon: Combine, permissions: ["inventory.stock.read"] },
          { label: "Process equipment", href: "/process/equipment", icon: Sparkles, permissions: ["manufacturing.production.read"] },
        ],
      },
    ],
  },
  {
    title: "Planning",
    category: "Production",
    icon: CalendarRange,
    module: "manufacturing",
    sections: [
      {
        items: [
          { label: "MRP planning", href: "/planning", icon: CalendarRange, permissions: ["planning.mrp.read"] },
          { label: "Demand forecast", href: "/planning/forecast", icon: LineChart, permissions: ["planning.mrp.read"] },
          { label: "Production schedule", href: "/planning/schedule", icon: CalendarClock, permissions: ["planning.mrp.read"] },
          { label: "Capacity", href: "/planning/capacity", icon: Gauge, permissions: ["planning.mrp.read"] },
          { label: "Kanban", href: "/planning/kanban", icon: LayoutGrid, permissions: ["planning.mrp.read"] },
        ],
      },
    ],
  },
  {
    title: "Shop floor & IoT",
    category: "Production",
    icon: Activity,
    module: "mes_iot",
    sections: [
      {
        items: [
          { label: "Machine terminal", href: "/mes/terminal", icon: MonitorSmartphone, permissions: ["mes.shopfloor.use"] },
          { label: "Andon board", href: "/mes/andon", icon: Tv, permissions: ["mes.oee.read"] },
          { label: "OEE", href: "/mes/oee", icon: PieChart, permissions: ["mes.oee.read"] },
          { label: "Downtime", href: "/mes/downtime", icon: TimerOff, permissions: ["mes.oee.read"] },
          { label: "Work instructions", href: "/mes/instructions", icon: ListChecks, permissions: ["mes.oee.read"] },
          { label: "Recipes", href: "/mes/recipes", icon: FlaskConical, permissions: ["mes.oee.read"] },
          { label: "Shifts, reasons & skills", href: "/mes/setup", icon: SlidersHorizontal, permissions: ["mes.oee.read"] },
        ],
      },
      {
        title: "Machines",
        items: [
          { label: "Live machines", href: "/iot", icon: Activity, permissions: ["iot.data.read"] },
          { label: "Alarms", href: "/iot/alarms", icon: BellRing, permissions: ["iot.data.read"] },
          { label: "Condition monitoring", href: "/plant/condition", icon: AudioWaveform, permissions: ["iot.data.read"] },
          { label: "Energy", href: "/plant/energy", icon: Zap, permissions: ["iot.data.read"] },
          { label: "Cold chain", href: "/plant/cold-chain", icon: Thermometer, permissions: ["iot.data.read"] },
          { label: "Vision inspection", href: "/vision", icon: ScanEye, permissions: ["vision.inspections.read"] },
          { label: "Signals", href: "/iot/signals", icon: Cable, permissions: ["iot.data.read"] },
          { label: "Edge gateways", href: "/iot/gateways", icon: Router, permissions: ["iot.data.read"] },
        ],
      },
      {
        title: "Digital twin",
        items: [
          { label: "Digital twin", href: "/twin", icon: MapIcon, permissions: ["mes.oee.read"] },
          { label: "What-if", href: "/twin/simulate", icon: GitCompare, permissions: ["twin.schedule.simulate"] },
        ],
      },
    ],
  },
  {
    title: "Quality",
    category: "Production",
    icon: ShieldCheck,
    module: "quality",
    sections: [
      {
        items: [
          { label: "Quality cockpit", href: "/quality", icon: ShieldCheck, permissions: ["quality.inspections.read"] },
          { label: "Inspections", href: "/quality/inspections", icon: ClipboardCheck, permissions: ["quality.inspections.read"] },
          { label: "Inspection plans", href: "/quality/plans", icon: Ruler, permissions: ["quality.inspections.read"] },
          { label: "Lot status", href: "/quality/lots", icon: BadgeCheck, permissions: ["quality.inspections.read"] },
          { label: "Traceability", href: "/quality/traceability", icon: GitBranch, permissions: ["quality.inspections.read"] },
          { label: "SPC charts", href: "/quality/spc", icon: ActivitySquare, permissions: ["quality.inspections.read"] },
          { label: "Retain samples", href: "/quality/retain-samples", icon: FlaskRound, permissions: ["quality.inspections.read"] },
        ],
      },
      {
        title: "Issues & improvement",
        items: [
          { label: "Non-conformance", href: "/quality/ncrs", icon: FileWarning, permissions: ["quality.inspections.read"] },
          { label: "CAPA", href: "/quality/capas", icon: GitPullRequestArrow, permissions: ["quality.inspections.read"] },
          { label: "Customer complaints", href: "/quality/complaints", icon: MessageSquareWarning, permissions: ["quality.inspections.read"] },
          { label: "Deviations", href: "/quality/deviations", icon: ShieldAlert, permissions: ["quality.inspections.read"] },
          { label: "Supplier quality", href: "/quality/suppliers", icon: Truck, permissions: ["quality.inspections.read"] },
        ],
      },
      {
        title: "System",
        items: [
          { label: "Calibration", href: "/quality/calibration", icon: Crosshair, permissions: ["quality.inspections.read"] },
          { label: "Internal audits", href: "/quality/audits", icon: ClipboardPen, permissions: ["quality.inspections.read"] },
          { label: "SOPs", href: "/quality/sops", icon: BookOpenCheck, permissions: ["quality.inspections.read"] },
        ],
      },
    ],
  },
  {
    title: "Maintenance",
    category: "Production",
    icon: Wrench,
    module: "maintenance",
    sections: [
      {
        items: [
          { label: "Maintenance orders", href: "/maintenance/orders", icon: Siren, permissions: ["maintenance.orders.read"] },
          { label: "Assets", href: "/maintenance/assets", icon: Building2, permissions: ["maintenance.orders.read"] },
          { label: "Preventive maintenance", href: "/maintenance/pm", icon: CalendarClock, permissions: ["maintenance.orders.read"] },
          { label: "Reliability & OEE", href: "/maintenance/reliability", icon: Gauge, permissions: ["maintenance.orders.read"] },
          { label: "AMC contracts", href: "/maintenance/amc", icon: Handshake, permissions: ["maintenance.orders.read"] },
          { label: "TPM", href: "/maintenance/tpm", icon: Sparkles, permissions: ["maintenance.orders.read"] },
        ],
      },
    ],
  },
  {
    title: "Logistics",
    category: "Supply chain & service",
    icon: Truck,
    sections: [
      {
        title: "Transport",
        module: "logistics",
        items: [
          { label: "Trips", href: "/tms", icon: Truck, permissions: ["sales.deliveries.read"] },
          { label: "Freight bills", href: "/tms/freight", icon: ReceiptIndianRupee, permissions: ["tms.freight.manage"] },
          { label: "Transport setup", href: "/tms/setup", icon: Route, permissions: ["sales.deliveries.read"] },
        ],
      },
      {
        title: "Distribution",
        module: "distribution",
        items: [
          { label: "Network", href: "/dms", icon: Network, permissions: ["dms.network.read"] },
          { label: "Secondary sales", href: "/dms/sales", icon: Store, permissions: ["dms.network.read"] },
          { label: "Claims", href: "/dms/claims", icon: BadgePercent, permissions: ["dms.network.read"] },
          { label: "My beat", href: "/dms/field", icon: Navigation, permissions: ["dms.field.use"] },
        ],
      },
    ],
  },
  {
    title: "Service",
    category: "Supply chain & service",
    icon: Headset,
    module: "service",
    sections: [
      {
        items: [
          { label: "Service desk", href: "/service", icon: Headset, permissions: ["service.tickets.read"] },
          { label: "Service visits", href: "/service/visits", icon: Wrench, permissions: ["service.tickets.read"] },
          { label: "Installed base", href: "/service/installed-base", icon: ScanBarcode, permissions: ["service.tickets.read"] },
          { label: "Returns (RMA)", href: "/service/rmas", icon: PackageX, permissions: ["service.tickets.read"] },
          { label: "Knowledge base", href: "/service/kb", icon: BookOpen, permissions: ["service.tickets.read"] },
          { label: "Service levels", href: "/service/sla", icon: Timer, permissions: ["service.tickets.read"] },
        ],
      },
    ],
  },
  {
    title: "Projects & documents",
    category: "Supply chain & service",
    icon: FolderKanban,
    sections: [
      {
        items: [
          { label: "Projects", href: "/projects", icon: FolderKanban, module: "projects", permissions: ["projects.reports.read"] },
          { label: "Resource load", href: "/projects/resources", icon: ChartGantt, module: "projects", permissions: ["projects.reports.read"] },
          { label: "Product lifecycle", href: "/plm", icon: GitBranch, module: "projects", permissions: ["plm.data.read"] },
          { label: "CAD vault", href: "/plm/cad", icon: FileBox, module: "projects", permissions: ["plm.data.read"] },
          { label: "Documents", href: "/documents", icon: FolderOpen, permissions: ["docs.files.read"] },
        ],
      },
    ],
  },
  {
    title: "Finance",
    category: "Finance",
    icon: Landmark,
    sections: [
      {
        title: "Transactions",
        items: [
          { label: "Journal vouchers", href: "/accounting/journals", icon: NotebookPen, permissions: ["accounting.accounts.read"] },
          { label: "Receipts", href: "/accounting/receipts", icon: ArrowDownToLine, permissions: ["accounting.accounts.read"] },
          { label: "Payments", href: "/accounting/payments", icon: ArrowUpFromLine, permissions: ["accounting.accounts.read"] },
          { label: "Contra", href: "/accounting/contra", icon: Repeat, permissions: ["accounting.accounts.read"] },
          { label: "Payment run", href: "/accounting/payment-run", icon: Banknote, permissions: ["accounting.money.manage"] },
          { label: "Bank reconciliation", href: "/accounting/bank", icon: BankIcon, permissions: ["accounting.accounts.read"] },
        ],
      },
      {
        title: "Books & statements",
        items: [
          { label: "Chart of accounts", href: "/accounting/accounts", icon: ListTree, permissions: ["accounting.accounts.read"] },
          { label: "Ledger", href: "/accounting/ledger", icon: BookOpen, permissions: ["accounting.accounts.read"] },
          { label: "Day book", href: "/accounting/day-book", icon: CalendarDays, permissions: ["accounting.accounts.read"] },
          { label: "Trial balance", href: "/accounting/trial-balance", icon: Scale, permissions: ["accounting.accounts.read"] },
          { label: "Financial statements", href: "/accounting/statements", icon: PieChart, permissions: ["accounting.accounts.read"] },
          { label: "Ageing", href: "/accounting/ageing", icon: Hourglass, permissions: ["accounting.accounts.read"] },
        ],
      },
      {
        title: "Control",
        items: [
          { label: "Budgets", href: "/accounting/budgets", icon: Target, permissions: ["accounting.accounts.read"] },
          { label: "Cost allocation", href: "/accounting/allocations", icon: Split, permissions: ["finance.group.read"] },
          { label: "Period close", href: "/accounting/close", icon: CalendarCheck, permissions: ["accounting.accounts.read"] },
          { label: "Finance insights", href: "/accounting/insights", icon: Lightbulb, permissions: ["accounting.accounts.read"] },
          { label: "Books & periods", href: "/accounting/settings", icon: Settings2, permissions: ["accounting.accounts.read"] },
        ],
      },
      {
        title: "Group & treasury",
        items: [
          { label: "Inter-company", href: "/accounting/intercompany", icon: Network, permissions: ["finance.group.read"] },
          { label: "Consolidation", href: "/accounting/consolidation", icon: Layers, permissions: ["finance.group.read"] },
          { label: "Treasury", href: "/accounting/treasury", icon: Landmark, permissions: ["finance.treasury.read"] },
          { label: "Fixed assets", href: "/assets", icon: Building, permissions: ["assets.register.read"] },
        ],
      },
    ],
  },
  {
    title: "Tax & GST",
    category: "Finance",
    icon: ReceiptIndianRupee,
    sections: [
      {
        items: [
          { label: "e-Invoices", href: "/gst/einvoices", icon: FileCheck2, permissions: ["gst.reports.read"] },
          { label: "e-Way bills", href: "/gst/eway-bills", icon: Truck, permissions: ["gst.reports.read"] },
          { label: "GSTR-1", href: "/gst/gstr1", icon: FileBarChart, permissions: ["gst.reports.read"] },
          { label: "GSTR-3B", href: "/gst/gstr3b", icon: FileBarChart, permissions: ["gst.reports.read"] },
          { label: "GSTR-2B reconciliation", href: "/gst/gstr2b", icon: FileDiff, permissions: ["gst.reports.read"] },
          { label: "HSN & documents issued", href: "/gst/returns", icon: FileSpreadsheet, permissions: ["gst.reports.read"] },
          { label: "ITC-04", href: "/gst/itc-04", icon: ScanLine, permissions: ["gst.reports.read"] },
          { label: "TDS", href: "/accounting/tds", icon: Percent, permissions: ["accounting.accounts.read"] },
          { label: "GST e-compliance", href: "/gst/settings", icon: Receipt, permissions: ["gst.reports.read"] },
        ],
      },
    ],
  },
  {
    title: "People",
    category: "People",
    icon: UsersRound,
    module: "hr",
    sections: [
      {
        title: "Self service",
        items: [
          { label: "My HR", href: "/hr/me", icon: House, permissions: ["hr.self.use"] },
          { label: "Punch", href: "/hr/punch", icon: Fingerprint, permissions: ["hr.self.use"] },
          { label: "Leave", href: "/hr/leave", icon: Plane, permissions: ["hr.self.use"] },
          { label: "Regularisation", href: "/hr/regularisations", icon: ClipboardPen, permissions: ["hr.self.use"] },
          { label: "Expense claims", href: "/hr/claims", icon: ReceiptIndianRupee, permissions: ["hr.self.use"] },
          { label: "My pay", href: "/payroll/my", icon: Wallet, permissions: ["hr.self.use"] },
        ],
      },
      {
        title: "Workforce",
        items: [
          { label: "HR overview", href: "/hr", icon: UsersRound, permissions: ["hr.employees.read"] },
          { label: "Employees", href: "/hr/employees", icon: IdCard, permissions: ["hr.employees.read"] },
          { label: "Organisation", href: "/hr/org", icon: Network, permissions: ["hr.employees.read"] },
          { label: "Org chart", href: "/hr/org-chart", icon: Users, permissions: ["hr.employees.read"] },
          { label: "Recruitment", href: "/hr/recruitment", icon: UserPlus, permissions: ["hr.recruitment.read"] },
          { label: "Onboarding & exit", href: "/hr/lifecycle", icon: ListChecks, permissions: ["hr.exit.read"] },
          { label: "Separations", href: "/hr/separations", icon: DoorOpen, permissions: ["hr.self.use"] },
          { label: "Performance", href: "/hr/performance", icon: Target, permissions: ["hr.self.use"] },
          { label: "Skills & training", href: "/hr/skills", icon: GraduationCap, permissions: ["hr.training.read"] },
          { label: "Contract labour", href: "/hr/contract", icon: HardHat, permissions: ["hr.contract.read"] },
          { label: "Letter templates", href: "/hr/letters", icon: FileSignature, permissions: ["hr.letters.manage"] },
        ],
      },
      {
        title: "Time & compliance",
        items: [
          { label: "Attendance", href: "/hr/attendance", icon: CalendarClock, permissions: ["hr.attendance.read"] },
          { label: "Shifts & holidays", href: "/hr/shifts", icon: Clock, permissions: ["hr.attendance.read"] },
          { label: "Leave setup", href: "/hr/leave/types", icon: CalendarCog, permissions: ["hr.leave.read"] },
          { label: "Statutory registers", href: "/hr/registers", icon: BookOpenCheck, permissions: ["hr.registers.read"] },
        ],
      },
      {
        title: "Payroll",
        items: [
          { label: "Payroll runs", href: "/payroll", icon: Calculator, permissions: ["payroll.runs.read"] },
          { label: "Salaries", href: "/payroll/salaries", icon: IndianRupee, permissions: ["payroll.salaries.read"] },
          { label: "Inputs & loans", href: "/payroll/inputs", icon: HandCoins, permissions: ["payroll.salaries.read"] },
          { label: "Payroll setup", href: "/payroll/setup", icon: Settings2, permissions: ["payroll.salaries.read"] },
        ],
      },
    ],
  },
  {
    title: "Industry compliance",
    category: "Compliance",
    icon: BadgeCheck,
    sections: [
      {
        title: "GMP & pharma",
        module: "pharma",
        items: [
          { label: "GMP controls", href: "/gmp", icon: ShieldCheck, permissions: ["quality.inspections.read"] },
          { label: "Line clearance", href: "/gmp/line-clearance", icon: ClipboardCheck, permissions: ["quality.inspections.read"] },
          { label: "Batch record review", href: "/gmp/batch-reviews", icon: FileCheck2, permissions: ["gmp.batchrecords.review"] },
          { label: "Environmental monitoring", href: "/gmp/environment", icon: Wind, permissions: ["quality.inspections.read"] },
          { label: "Stability studies", href: "/pharma/stability", icon: FlaskRound, permissions: ["pharma.reports.read"] },
          { label: "Product quality review", href: "/pharma/apqr", icon: BookOpenCheck, permissions: ["pharma.reports.read"] },
          { label: "Serialisation & DPCO", href: "/pharma/serialisation", icon: Barcode, permissions: ["pharma.reports.read"] },
          { label: "System validation", href: "/validation", icon: BadgeCheck, permissions: ["validation.projects.manage"] },
        ],
      },
      {
        title: "Food safety",
        module: "food",
        items: [
          { label: "HACCP", href: "/food/haccp", icon: Salad, permissions: ["food.reports.read"] },
          { label: "Allergens", href: "/food/allergens", icon: Wheat, permissions: ["food.reports.read"] },
          { label: "Recalls & drills", href: "/food/recalls", icon: Undo2, permissions: ["food.reports.read"] },
          { label: "Labels & FSSAI", href: "/food/labels", icon: Tag, permissions: ["food.reports.read"] },
          { label: "Certificates", href: "/compliance/certificates", icon: Award, permissions: ["quality.inspections.read"] },
        ],
      },
      {
        title: "Health, safety & environment",
        module: "hse",
        items: [
          { label: "HSE register", href: "/hse", icon: HardHat, permissions: ["hse.register.read"] },
          { label: "Safety data sheets", href: "/hse/sds", icon: FlaskConical, permissions: ["hse.register.read"] },
          { label: "Hazardous storage", href: "/hse/storage", icon: Warehouse, permissions: ["hse.register.read"] },
          { label: "Permits to work", href: "/hse/permits", icon: HardHat, permissions: ["hse.register.read"] },
        ],
      },
      {
        title: "Sustainability",
        module: "esg",
        items: [
          { label: "Carbon footprint", href: "/esg", icon: Leaf, permissions: ["esg.reports.read"] },
          { label: "EPR certificates", href: "/esg/epr", icon: Recycle, permissions: ["esg.reports.read"] },
          { label: "BRSR-lite", href: "/esg/brsr", icon: FileChartColumn, permissions: ["esg.reports.read"] },
          { label: "Materials compliance", href: "/compliance/materials", icon: Cpu, permissions: ["esg.reports.read"] },
        ],
      },
      {
        title: "Automotive",
        module: "automotive",
        items: [
          { label: "APQP", href: "/auto/apqp", icon: Milestone, permissions: ["auto.quality.read"] },
          { label: "PPAP", href: "/auto/ppap", icon: FileStack, permissions: ["auto.quality.read"] },
          { label: "FMEA & control plans", href: "/auto/fmea", icon: TriangleAlert, permissions: ["auto.quality.read"] },
          { label: "Layered audits", href: "/auto/lpa", icon: ClipboardList, permissions: ["auto.quality.read"] },
          { label: "EDI & customer requirements", href: "/auto/edi", icon: ArrowLeftRight, permissions: ["auto.quality.read"] },
        ],
      },
      {
        title: "Textile export",
        module: "textile",
        items: [
          { label: "Buyer orders", href: "/textile/orders", icon: ClipboardList, permissions: ["textile.orders.read"] },
          { label: "Tech packs", href: "/textile/tech-packs", icon: Shirt, permissions: ["textile.orders.read"] },
          { label: "Social audits", href: "/textile/audits", icon: Users, permissions: ["textile.orders.read"] },
        ],
      },
    ],
  },
  {
    title: "Reports & AI",
    category: "Insights",
    icon: BarChart3,
    sections: [
      {
        items: [
          { label: "Reports", href: "/reports", icon: BarChart3 },
          { label: "Dashboards", href: "/dashboards", icon: LayoutGrid },
          { label: "Owner's phone", href: "/m", icon: Smartphone },
        ],
      },
      {
        title: "AI",
        module: "ai",
        items: [
          { label: "AI Copilot", href: "#copilot", icon: Sparkles, opensCopilot: true },
          { label: "AI Inbox", href: "/ai/inbox", icon: Inbox, permissions: ["ai.inbox.use"] },
          { label: "AI agents", href: "/ai/agents", icon: Bot, permissions: ["ai.inbox.use"] },
          { label: "Predictions & why", href: "/ai/insights", icon: LineChart, permissions: ["ai.insights.read"] },
          { label: "Document AI", href: "/ai/documents", icon: ScanText, permissions: ["ai.documents.use"] },
          { label: "Voice commands", href: "/ai/voice", icon: Mic },
          { label: "AI governance", href: "/ai/governance", icon: Scale, permissions: ["ai.governance.manage"] },
        ],
      },
    ],
  },
  {
    title: "Administration",
    category: "System",
    icon: UserCog,
    sections: [
      {
        items: [
          { label: "Users & access", href: "/settings/users", icon: Users, permissions: ["iam.users.read"] },
          { label: "Roles & permissions", href: "/settings/roles", icon: ShieldCheck, permissions: ["iam.roles.read"] },
          { label: "Audit trail", href: "/settings/audit", icon: History, permissions: ["platform.audit.read"] },
          { label: "Message log", href: "/settings/message-log", icon: Send, permissions: ["platform.settings.manage"] },
          { label: "Single sign-on", href: "/settings/sso", icon: KeyRound, permissions: ["platform.sso.manage"] },
          { label: "Data protection", href: "/settings/privacy", icon: Lock, permissions: ["platform.privacy.manage"] },
          { label: "Data and sandbox", href: "/settings/data", icon: DatabaseBackup, permissions: ["platform.data.export"] },
          { label: "Billing & plan", href: "/settings/billing", icon: CreditCard, permissions: ["platform.billing.manage"] },
        ],
      },
    ],
  },
  {
    title: "Configuration",
    category: "System",
    icon: Settings,
    sections: [
      {
        items: [
          { label: "Number series", href: "/settings/number-series", icon: Hash, permissions: ["platform.numbering.manage"] },
          { label: "Approval workflows", href: "/settings/approval-workflows", icon: Workflow, permissions: ["platform.workflows.manage"] },
          { label: "Custom fields", href: "/settings/custom-fields", icon: ListPlus, permissions: ["platform.customization.manage"] },
          { label: "Print formats", href: "/settings/print-formats", icon: Printer, permissions: ["platform.customization.manage"] },
          { label: "Branding", href: "/settings/branding", icon: Palette, permissions: ["settings.branding.manage"] },
          { label: "Automations", href: "/settings/automations", icon: Workflow, permissions: ["automation.rules.manage"] },
          { label: "API & webhooks", href: "/settings/integrations", icon: Plug, permissions: ["platform.integrations.manage"] },
          { label: "App marketplace", href: "/settings/apps", icon: Store, permissions: ["apps.connectors.read"] },
          { label: "Modules", href: "/settings/modules", icon: Puzzle, permissions: ["platform.settings.manage"] },
          { label: "Partner portal", href: "/partner", icon: Handshake },
        ],
      },
    ],
  },
];

/** Every destination, for search and breadcrumbs. */
export const NAV_ITEMS: { item: NavItem; group: string | null; section: string | null; module: string | null }[] = [
  ...PINNED.map((item) => ({ item, group: null, section: null, module: null })),
  ...NAV_GROUPS.flatMap((g) => g.sections.flatMap((s) => s.items.map((item) => ({ item, group: g.title, section: s.title ?? null, module: item.module ?? s.module ?? g.module ?? null })))),
  ...FOOTER.map((item) => ({ item, group: null, section: null, module: null })),
];

/** The menu entry a path belongs to: the longest href that is the path or a parent of it. */
export function findNav(pathname: string) {
  let best: (typeof NAV_ITEMS)[number] | null = null;
  for (const n of NAV_ITEMS) {
    const h = n.item.href;
    if (h.startsWith("#")) continue;
    if ((pathname === h || pathname.startsWith(`${h}/`)) && (!best || h.length > best.item.href.length)) best = n;
  }
  return best;
}
