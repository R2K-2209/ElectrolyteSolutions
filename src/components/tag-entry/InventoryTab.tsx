'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Package, Plus, Minus, BarChart3, TrendingDown, Boxes, ArrowLeft,
  Search, Check, Loader2, AlertTriangle, ArrowUpDown, Filter, X, 
  Zap, Trash2, ShoppingCart, Upload, FileText, Receipt, Keyboard, Calculator, CheckCircle2, Lock, Unlock
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

import {
  getAllSparePartsAction,
  addStockReceiptAction,
  checkDuplicateInvoiceAction,
  uploadInvoicePDFAction,
  getInventorySummaryAction,
  getStockReceiptsAction,
  getStockReceiptDetailsAction
} from '@/app/actions/inventory-actions';
import { parseInvoiceWithAIAction } from '@/app/actions/ai-actions';
import { Sparkles } from 'lucide-react';

// All component categories, in display order
export type ComponentCategory =
  | 'Resistors'
  | 'Capacitors'
  | 'Fuses'
  | 'Diodes'
  | 'Transistors'
  | 'ICs / Regulators'
  | 'Inductors'
  | 'Connectors'
  | 'Others';

export const ALL_CATEGORIES: ComponentCategory[] = [
  'Resistors', 'Capacitors', 'Fuses', 'Diodes', 'Transistors',
  'ICs / Regulators', 'Inductors', 'Connectors', 'Others',
];

/** Keyword → category map used by search to show ALL members of a category */
export const CATEGORY_ALIASES: Record<string, ComponentCategory> = {
  // Resistors
  'resistor': 'Resistors', 'resistors': 'Resistors', 'ohm': 'Resistors',
  'ohms': 'Resistors', 'resistance': 'Resistors', 'preset': 'Resistors',
  'potentiometer': 'Resistors', 'trimmer': 'Resistors',
  // Capacitors
  'capacitor': 'Capacitors', 'capacitors': 'Capacitors', 'cap': 'Capacitors',
  'caps': 'Capacitors', 'farad': 'Capacitors', 'electrolytic': 'Capacitors',
  // Fuses
  'fuse': 'Fuses', 'fuses': 'Fuses',
  // Diodes
  'diode': 'Diodes', 'diodes': 'Diodes', 'led': 'Diodes', 'zener': 'Diodes',
  'schottky': 'Diodes', 'rectifier': 'Diodes', 'avalanche': 'Diodes',
  // Transistors
  'transistor': 'Transistors', 'transistors': 'Transistors', 'bjt': 'Transistors',
  'mosfet': 'Transistors', 'npn': 'Transistors', 'pnp': 'Transistors',
  // ICs / Regulators
  'ic': 'ICs / Regulators', 'ics': 'ICs / Regulators',
  'regulator': 'ICs / Regulators', 'regulators': 'ICs / Regulators',
  'ldo': 'ICs / Regulators', 'opamp': 'ICs / Regulators', 'op-amp': 'ICs / Regulators',
  'voltage regulator': 'ICs / Regulators',
  // Inductors
  'inductor': 'Inductors', 'inductors': 'Inductors', 'transformer': 'Inductors',
  'choke': 'Inductors', 'coil': 'Inductors', 'ferrite': 'Inductors',
  // Connectors
  'connector': 'Connectors', 'connectors': 'Connectors', 'terminal': 'Connectors',
  'socket': 'Connectors', 'header': 'Connectors', 'lug': 'Connectors',
};

/** Per-category Tailwind colour tokens for header bars */
export const CATEGORY_STYLES: Record<ComponentCategory, {
  bg: string; text: string; dot: string; badge: string; shadow: string; border: string;
}> = {
  'Resistors':        { bg:'bg-amber-50/80',   text:'text-amber-700',   dot:'bg-amber-500',   badge:'bg-amber-100 text-amber-800',    shadow:'shadow-[0_0_8px_rgba(245,158,11,0.5)]',  border:'border-amber-100/60'   },
  'Capacitors':       { bg:'bg-blue-50/80',    text:'text-blue-700',    dot:'bg-blue-500',    badge:'bg-blue-100 text-blue-800',      shadow:'shadow-[0_0_8px_rgba(59,130,246,0.5)]',  border:'border-blue-100/60'    },
  'Fuses':            { bg:'bg-red-50/80',     text:'text-red-700',     dot:'bg-red-500',     badge:'bg-red-100 text-red-800',        shadow:'shadow-[0_0_8px_rgba(239,68,68,0.5)]',   border:'border-red-100/60'     },
  'Diodes':           { bg:'bg-orange-50/80',  text:'text-orange-700',  dot:'bg-orange-500',  badge:'bg-orange-100 text-orange-800',  shadow:'shadow-[0_0_8px_rgba(249,115,22,0.5)]',  border:'border-orange-100/60'  },
  'Transistors':      { bg:'bg-emerald-50/80', text:'text-emerald-700', dot:'bg-emerald-500', badge:'bg-emerald-100 text-emerald-800',shadow:'shadow-[0_0_8px_rgba(16,185,129,0.5)]',  border:'border-emerald-100/60' },
  'ICs / Regulators': { bg:'bg-violet-50/80',  text:'text-violet-700',  dot:'bg-violet-500',  badge:'bg-violet-100 text-violet-800',  shadow:'shadow-[0_0_8px_rgba(139,92,246,0.5)]',  border:'border-violet-100/60'  },
  'Inductors':        { bg:'bg-teal-50/80',    text:'text-teal-700',    dot:'bg-teal-500',    badge:'bg-teal-100 text-teal-800',      shadow:'shadow-[0_0_8px_rgba(20,184,166,0.5)]',  border:'border-teal-100/60'    },
  'Connectors':       { bg:'bg-gray-50/80',    text:'text-gray-600',    dot:'bg-gray-400',    badge:'bg-gray-100 text-gray-700',      shadow:'shadow-[0_0_8px_rgba(107,114,128,0.5)]', border:'border-gray-100/60'    },
  'Others':           { bg:'bg-slate-50/80',   text:'text-slate-600',   dot:'bg-slate-400',   badge:'bg-slate-100 text-slate-700',    shadow:'shadow-[0_0_8px_rgba(100,116,139,0.5)]', border:'border-slate-100/60'   },
};

/**
 * Determine the component category for a spare part.
 *
 * Priority:
 * 1. PCB reference designator prefix from bom_new.location (R→Resistors, EC→Capacitors, etc.)
 * 2. Text-based analysis of part_name + description as fallback
 */
export function getCategory(
  name: string,
  description: string | null,
  locationHint?: string | null,
): ComponentCategory {
  // ── 1. Location-prefix classification (most reliable) ────────────────────
  if (locationHint && locationHint.trim()) {
    // Strip trailing digits to get pure prefix: "R4" → "R", "EC1" → "EC"
    const prefix = locationHint.trim().replace(/\d+.*$/, '').toUpperCase();
    if (/^(R|RN|RP|PR)$/.test(prefix))           return 'Resistors';
    if (/^(C|EC|BC|PC|CC)$/.test(prefix))         return 'Capacitors';
    if (/^(F|FU)$/.test(prefix))                  return 'Fuses';
    if (/^(D|ZD|LED|CR|BD|VD)$/.test(prefix))    return 'Diodes';
    if (/^(Q|TR)$/.test(prefix))                  return 'Transistors';
    if (/^(U|IC|VR)$/.test(prefix))               return 'ICs / Regulators';
    if (/^(L|T|TX)$/.test(prefix))                return 'Inductors';
    if (/^(J|P|CN|AC|PL|BT|X)$/.test(prefix))    return 'Connectors';
    // BZ, SW, MOV, RLY, SP, LS → Others
  }

  // ── 2. Text-based fallback ────────────────────────────────────────────────
  const text = `${name} ${description || ''}`.toLowerCase();

  // Resistors
  if (text.includes('ohm') || text.includes('ω') || text.includes('\u03a9') ||
      text.includes('resistor') || text.includes('resister') ||
      text.includes('preset') || text.includes('potentiometer') || text.includes('trimmer') ||
      /\b\d+\s*e\b/.test(text) || /\b\d+e\b/.test(text))
    return 'Resistors';

  // Capacitors
  if (text.includes('uf') || text.includes('nf') || text.includes('pf') ||
      text.includes('µf') || text.includes('capacitor') || text.includes('mylar') ||
      text.includes('polyester') || text.includes('electrolytic'))
    return 'Capacitors';

  // Fuses
  if (text.includes('fuse')) return 'Fuses';

  // Diodes (check before transistors)
  if (text.includes('diode') || text.includes('zener') || text.includes('schottky') ||
      text.includes('avalanche') || text.includes('rectifier') || text.includes('ultra-fast') ||
      text.includes('byv') || text.includes('1n4'))
    return 'Diodes';

  // Transistors
  if (text.includes('transistor') || text.includes('bjt') || text.includes('mosfet') ||
      text.includes('npn') || text.includes('pnp') || text.includes('to-92') ||
      text.includes('to-220') || text.includes('s8050') || text.includes('2n'))
    return 'Transistors';

  // ICs / Regulators
  if (text.includes('regulator') || text.includes('ldo') || text.includes('op-amp') ||
      text.includes('op amp') || text.includes('controller') || text.includes('driver') ||
      text.includes('7805') || text.includes('7812') || text.includes('7815') ||
      text.includes('integrated circuit'))
    return 'ICs / Regulators';

  // Inductors / Transformers
  if (text.includes('inductor') || text.includes('choke') || text.includes('transformer') ||
      text.includes('ferrite') || /\b\d+\s*(mh|\u00b5h|uh)\b/.test(text))
    return 'Inductors';

  // Connectors
  if (text.includes('connector') || text.includes('lug') || text.includes('terminal') ||
      text.includes('socket') || text.includes('header') || text.includes('pcb lug'))
    return 'Connectors';

  return 'Others';
}

function getPrefixFromCategory(category: ComponentCategory): string {
  const map: Record<ComponentCategory, string> = {
    'Resistors': 'R',
    'Capacitors': 'C',
    'Fuses': 'F',
    'Diodes': 'D',
    'Transistors': 'Q',
    'ICs / Regulators': 'U',
    'Inductors': 'L',
    'Connectors': 'J',
    'Others': 'SW'
  };
  return map[category] || 'SW';
}

function getCategoryNameFromPrefix(prefix?: string): string {
  if (!prefix) return 'Others';
  const map: Record<string, string> = {
    'R': 'Resistor',
    'C': 'Capacitor',
    'F': 'Fuse',
    'D': 'Diode',
    'Q': 'Transistor',
    'U': 'IC / Regulator',
    'L': 'Inductor',
    'J': 'Connector',
    'SW': 'Others'
  };
  return map[prefix] || 'Others';
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SparePartRow {
  id: number;
  part_name: string;
  description: string | null;
  stock_quantity: number;
  initial_quantity: number;
  reorder_threshold: number;
  location_hint: string | null; // PCB reference designator from bom_new, e.g. "R4", "EC1"
}

interface Summary {
  totalUniqueComponents: number;
  totalInStock: number;
  totalLowStock: number;
  totalOutOfStock: number;
  totalStockValue: number;
  todayTransactions: number;
}

type ActiveView = 'overview' | 'po-intake' | 'inventory' | 'po-history';

interface StockReceiptRow {
  id: number;
  vendor_name: string;
  invoice_no: string;
  received_date: string;
  invoice_file_path: string | null;
  total_amount: number;
  created_at: string;
  items_count: number;
  subtotal: number; // sum of (quantity * unit_cost) from line items
}

interface CartItem {
  tempId: string;
  sparePartId?: number;
  partName: string;
  description: string;
  quantity: number;
  unitCost: number;
  reorderThreshold: number;
  currentStock?: number;
  componentType?: string;
  isLocked?: boolean;
}

// ---------------------------------------------------------------------------
// Sub-component: Quick Stat Card
// ---------------------------------------------------------------------------
function StatCard({ label, value, color, icon: Icon }: {
  label: string; value: number | string;
  color: 'emerald' | 'blue' | 'amber' | 'red' | 'indigo' | 'violet';
  icon: any;
}) {
  const colorMap: Record<string, string> = {
    emerald: 'text-emerald-600 bg-emerald-50 border-emerald-200 shadow-emerald-100',
    blue: 'text-blue-600 bg-blue-50 border-blue-200 shadow-blue-100',
    amber: 'text-amber-600 bg-amber-50 border-amber-200 shadow-amber-100',
    red: 'text-red-600 bg-red-50 border-red-200 shadow-red-100',
    indigo: 'text-indigo-600 bg-indigo-50 border-indigo-200 shadow-indigo-100',
    violet: 'text-violet-600 bg-violet-50 border-violet-200 shadow-violet-100',
  };

  return (
    <div className={`rounded-2xl border p-5 ${colorMap[color]} transition-all duration-300 hover:shadow-lg hover:-translate-y-1`}>
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-lg bg-white/60`}>
          <Icon className="h-5 w-5" />
        </div>
        <span className="text-sm font-semibold opacity-80">{label}</span>
      </div>
      <p className="text-3xl font-black tracking-tight">{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export function InventoryTab() {
  const { user } = useAuth();
  const { toast } = useToast();

  // Navigation
  const [activeView, setActiveView] = useState<ActiveView>('overview');

  // Summary stats
  const [summary, setSummary] = useState<Summary>({
    totalUniqueComponents: 0, totalInStock: 0, totalLowStock: 0,
    totalOutOfStock: 0, totalStockValue: 0, todayTransactions: 0,
  });
  const [summaryLoading, setSummaryLoading] = useState(true);

  // Global Inventory (Pre-loaded for ultra-fast client-side search)
  const [globalParts, setGlobalParts] = useState<SparePartRow[]>([]);
  const [partsLoading, setPartsLoading] = useState(false);

  const [poInfo, setPoInfo] = useState({
    vendorName: '',
    invoiceNo: '',
    receivedDate: new Date().toISOString().split('T')[0],
  });
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  
  const [cartSearch, setCartSearch] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  
  // Submit state
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // AI Parsing State
  const [aiParsing, setAiParsing] = useState(false);

  // Keyboard navigation refs
  const searchInputRef = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const costRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Inventory view state
  const [invSearch, setInvSearch] = useState('');
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [invSort, setInvSort] = useState<'name' | 'stock' | 'threshold'>('name');

  // PO History State
  const [poHistory, setPoHistory] = useState<StockReceiptRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedReceiptId, setSelectedReceiptId] = useState<number | null>(null);
  const [receiptDetails, setReceiptDetails] = useState<any[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    const res = await getInventorySummaryAction();
    if (res.success) setSummary(res.data);
    setSummaryLoading(false);
  }, []);

  const loadGlobalParts = useCallback(async () => {
    setPartsLoading(true);
    const res = await getAllSparePartsAction(); // get everything unpaginated for quick client search
    if (res.success) setGlobalParts(res.data);
    setPartsLoading(false);
  }, []);

  // Load summary on mount
  useEffect(() => { loadSummary(); }, [loadSummary]);

  // Load parts when entering intake or inventory view
  useEffect(() => {
    if ((activeView === 'po-intake' || activeView === 'inventory') && globalParts.length === 0) {
      loadGlobalParts();
    }
  }, [activeView, globalParts.length, loadGlobalParts]);

  const loadPoHistory = useCallback(async () => {
    setHistoryLoading(true);
    const res = await getStockReceiptsAction();
    if (res.success) setPoHistory(res.data);
    setHistoryLoading(false);
  }, []);

  useEffect(() => {
    if (activeView === 'po-history' && poHistory.length === 0) {
      loadPoHistory();
    }
  }, [activeView, poHistory.length, loadPoHistory]);

  const viewReceiptDetails = async (id: number) => {
    setSelectedReceiptId(id);
    setDetailsLoading(true);
    const res = await getStockReceiptDetailsAction(id);
    if (res.success) setReceiptDetails(res.data);
    setDetailsLoading(false);
  };


  // -------------------------------------------------------------------------
  // PO Intake Handlers
  // -------------------------------------------------------------------------
  const searchResults = useMemo(() => {
    if (!cartSearch.trim()) return [];
    const term = cartSearch.toLowerCase().trim();
    // Exclude parts already in cart
    const cartPartIds = new Set(cart.filter(c => c.sparePartId).map(c => c.sparePartId));
    
    return globalParts
      .filter(p => !cartPartIds.has(p.id))
      .filter(p => {
        const matchesDirect = p.part_name.toLowerCase().includes(term) || 
                             (p.description && p.description.toLowerCase().includes(term));
        if (matchesDirect) return true;
        
        // Category alias match — shows ALL members of a category
        // Supports: exact key ("cap") AND prefix match ("capa" → "capacitor" → Capacitors)
        let aliasCategory = CATEGORY_ALIASES[term];
        if (!aliasCategory && term.length >= 3) {
          // Collect all categories whose alias KEY starts with the typed term
          const matchingCats = new Set(
            (Object.entries(CATEGORY_ALIASES) as [string, ComponentCategory][])
              .filter(([key]) => key.startsWith(term))
              .map(([, cat]) => cat)
          );
          // Only activate if all matching keys agree on ONE category (avoids "trans" ambiguity)
          if (matchingCats.size === 1) aliasCategory = [...matchingCats][0];
        }
        if (aliasCategory) {
          return getCategory(p.part_name, p.description, p.location_hint) === aliasCategory;
        }
        return false;
      }).slice(0, 20); // Top 20 results
  }, [globalParts, cartSearch, cart]);

  const addToCart = (part: SparePartRow | string) => {
    const tempId = Math.random().toString(36).substr(2, 9);
    
    if (typeof part === 'string') {
      const category = getCategory(part, part);
      const compType = getPrefixFromCategory(category);
      // Create brand new part
      setCart(prev => [...prev, {
        tempId,
        partName: part,
        description: part,
        quantity: 1,
        unitCost: 0,
        reorderThreshold: 5,
        componentType: compType,
        isLocked: true,
      }]);
    } else {
      // Add existing part
      setCart(prev => [...prev, {
        tempId,
        sparePartId: part.id,
        partName: part.part_name,
        description: part.description || part.part_name,
        quantity: 1,
        unitCost: 0,
        reorderThreshold: part.reorder_threshold,
        currentStock: part.stock_quantity,
        isLocked: true,
      }]);
    }
    setCartSearch('');
    
    // Auto-focus the quantity input for the newly added item
    setTimeout(() => {
      qtyRefs.current[tempId]?.focus();
      qtyRefs.current[tempId]?.select();
    }, 50);
  };

  const updateCartItem = (tempId: string, field: keyof CartItem, value: any) => {
    setCart(prev => prev.map(item => item.tempId === tempId ? { ...item, [field]: value } : item));
  };

  const removeFromCart = (tempId: string) => {
    setCart(prev => prev.filter(c => c.tempId !== tempId));
  };

  // UX Keyboard Navigation
  const handleKeyDown = (e: React.KeyboardEvent, tempId: string, type: 'qty' | 'cost') => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (type === 'qty') {
        // Jump to cost
        costRefs.current[tempId]?.focus();
        costRefs.current[tempId]?.select();
      } else if (type === 'cost') {
        // Jump back to search
        searchInputRef.current?.focus();
      }
    }
  };

  const subtotal = useMemo(() => cart.reduce((sum, item) => sum + (item.quantity * item.unitCost), 0), [cart]);
  const gstAmount = useMemo(() => subtotal * 0.18, [subtotal]);
  const totalAmount = useMemo(() => subtotal * 1.18, [subtotal]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setInvoiceFile(e.target.files[0]);
    }
  };

  const handleAIParsing = async () => {
    if (!invoiceFile) return;
    setAiParsing(true);
    try {
      const formData = new FormData();
      formData.append('file', invoiceFile);
      const res = await parseInvoiceWithAIAction(formData);
      if (res.success && res.data) {
        const d = res.data;
        setPoInfo({
          vendorName: d.vendorName || poInfo.vendorName,
          invoiceNo: d.invoiceNo || poInfo.invoiceNo,
          receivedDate: d.receivedDate || poInfo.receivedDate,
        });

        if (d.items && Array.isArray(d.items)) {
          const newCartItems = d.items.map((item: any) => {
            const partName = item.matchedPartName || item.originalName;
            const desc = item.originalName;
            const category = getCategory(partName, desc);
            const compType = getPrefixFromCategory(category);
            return {
              tempId: Math.random().toString(36).substr(2, 9),
              sparePartId: item.matchedSparePartId || undefined,
              partName,
              description: desc,
              quantity: Number(item.quantity) || 1,
              unitCost: Number(item.unitCost) || 0,
              reorderThreshold: 5, // default
              componentType: compType,
              isLocked: true,
            };
          });
          setCart(newCartItems);
          toast({ title: 'AI Parsing Complete', description: `Successfully mapped ${newCartItems.length} items from the invoice.` });
        }
      } else {
        toast({ variant: 'destructive', title: 'AI Parsing Failed', description: res.error || 'Could not parse the invoice.' });
      }
    } catch (err: any) {
      toast({ variant: 'destructive', title: 'AI Parsing Failed', description: err.message });
    } finally {
      setAiParsing(false);
    }
  };

  const handleSubmitPO = async () => {
    if (cart.length === 0 || !poInfo.vendorName || !poInfo.invoiceNo) {
      toast({ variant: 'destructive', title: 'Missing Info', description: 'Vendor, Invoice No, and at least one item are required.' });
      return;
    }

    setSubmitting(true);

    // 0. Check for duplicate invoice number
    try {
      const dupCheck = await checkDuplicateInvoiceAction(poInfo.invoiceNo);
      if (dupCheck.exists && dupCheck.existingReceipt) {
        const existing = dupCheck.existingReceipt;
        const dateStr = existing.received_date ? new Date(existing.received_date).toLocaleDateString('en-IN') : 'N/A';
        const amountStr = Number(existing.total_amount).toLocaleString('en-IN', { style: 'currency', currency: 'INR' });
        
        const confirmDuplicate = window.confirm(
          `⚠️ DUPLICATE INVOICE DETECTED!\n\n` +
          `Invoice "${existing.invoice_no}" already exists in the system:\n\n` +
          `  • Vendor: ${existing.vendor_name}\n` +
          `  • Date: ${dateStr}\n` +
          `  • Amount: ${amountStr}\n` +
          `  • Items: ${existing.items_count} parts\n\n` +
          `This invoice has already been processed. Submitting again will create DUPLICATE stock entries.\n\n` +
          `Do you still want to proceed?`
        );
        
        if (!confirmDuplicate) {
          toast({ variant: 'destructive', title: 'Submission Cancelled', description: `Invoice "${existing.invoice_no}" already exists. Duplicate entry prevented.` });
          setSubmitting(false);
          return;
        }
      }
    } catch (err) {
      console.error('Error checking duplicate invoice:', err);
      // Continue even if check fails — don't block the user
    }

    let invoiceFilePath = undefined;

    // 1. Upload PDF if exists
    if (invoiceFile) {
      const formData = new FormData();
      formData.append('file', invoiceFile);
      const uploadRes = await uploadInvoicePDFAction(formData);
      if (uploadRes.success) {
        invoiceFilePath = uploadRes.path;
      } else {
        toast({ variant: 'destructive', title: 'File Upload Failed', description: uploadRes.error });
        setSubmitting(false);
        return; // Stop if upload fails
      }
    }

    // 2. Submit PO
    const res = await addStockReceiptAction({
      vendorName: poInfo.vendorName,
      invoiceNo: poInfo.invoiceNo,
      receivedDate: poInfo.receivedDate,
      invoiceFilePath,
      totalAmount,
      items: cart.map(c => ({
        sparePartId: c.sparePartId,
        partName: c.partName,
        description: c.description,
        quantity: c.quantity,
        unitCost: c.unitCost,
        reorderThreshold: c.reorderThreshold,
        componentType: c.componentType
      }))
    }, user?.name || user?.email || 'Unknown');

    if (res.success) {
      toast({ title: 'PO Received & Processed', description: `Successfully added ${res.count} items to master inventory.`, variant: 'default' });
      setShowConfirm(false);
      
      // Reset form
      setCart([]);
      setPoInfo({ vendorName: '', invoiceNo: '', receivedDate: new Date().toISOString().split('T')[0] });
      setInvoiceFile(null);
      
      // Refresh global data
      loadSummary();
      loadGlobalParts();
      setActiveView('overview');
    } else {
      toast({ variant: 'destructive', title: 'Database Error', description: res.error || 'Failed to write PO.' });
    }
    setSubmitting(false);
  };

  // -------------------------------------------------------------------------
  // Inventory Filtering
  // -------------------------------------------------------------------------
  const sortedInvParts = useMemo(() => {
    let filtered = globalParts;
    if (showLowOnly) filtered = filtered.filter(p => p.stock_quantity <= p.reorder_threshold);
    if (invSearch) {
      const term = invSearch.toLowerCase().trim();
      filtered = filtered.filter(p => {
        const matchesDirect = p.part_name.toLowerCase().includes(term) || 
                             (p.description && p.description.toLowerCase().includes(term));
        if (matchesDirect) return true;
        
        // Category alias match — shows ALL members of a category
        // Supports: exact key ("cap") AND prefix match ("capa" → "capacitor" → Capacitors)
        let aliasCategory = CATEGORY_ALIASES[term];
        if (!aliasCategory && term.length >= 3) {
          const matchingCats = new Set(
            (Object.entries(CATEGORY_ALIASES) as [string, ComponentCategory][])
              .filter(([key]) => key.startsWith(term))
              .map(([, cat]) => cat)
          );
          if (matchingCats.size === 1) aliasCategory = [...matchingCats][0];
        }
        if (aliasCategory) {
          return getCategory(p.part_name, p.description, p.location_hint) === aliasCategory;
        }
        return false;
      });
    }

    const sorted = [...filtered];
    switch (invSort) {
      case 'stock': sorted.sort((a, b) => a.stock_quantity - b.stock_quantity); break;
      case 'threshold': sorted.sort((a, b) => {
        const aRatio = a.reorder_threshold > 0 ? a.stock_quantity / a.reorder_threshold : 999;
        const bRatio = b.reorder_threshold > 0 ? b.stock_quantity / b.reorder_threshold : 999;
        return aRatio - bRatio;
      }); break;
      default: sorted.sort((a, b) => a.part_name.localeCompare(b.part_name));
    }
    return sorted;
  }, [globalParts, showLowOnly, invSearch, invSort]);


  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full gap-6 p-2">
      {/* Header section */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {activeView !== 'overview' && (
            <button 
              onClick={() => setActiveView('overview')}
              className="p-2 rounded-full hover:bg-gray-100 transition-colors bg-white shadow-sm border border-gray-100"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </button>
          )}
          <div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
              {activeView === 'overview' && <><Boxes className="h-6 w-6 text-indigo-600" /> Component Center</>}
              {activeView === 'po-intake' && <><Receipt className="h-6 w-6 text-amber-500" /> Purchase Order Intake</>}
              {activeView === 'inventory' && <><Package className="h-6 w-6 text-blue-600" /> Master Inventory</>}
            </h2>
            <p className="text-sm font-medium text-gray-500 mt-1">
              {activeView === 'overview' && 'Live statistics and intelligent inventory workflows.'}
              {activeView === 'po-intake' && 'Record incoming shipments, vendor pricing, and upload digital invoices.'}
              {activeView === 'inventory' && 'Real-time global view of all tracked components.'}
            </p>
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* OVERVIEW VIEW */}
      {/* ----------------------------------------------------------------- */}
      {activeView === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <button
              onClick={() => setActiveView('po-intake')}
              className="group relative overflow-hidden bg-gradient-to-br from-indigo-900 to-indigo-800 rounded-3xl p-8 text-left transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-900/20 hover:-translate-y-1"
            >
              <div className="absolute top-0 right-0 p-8 opacity-10 transform translate-x-4 -translate-y-4 group-hover:rotate-12 transition-transform duration-500">
                <Receipt className="h-48 w-48 text-white" />
              </div>
              <div className="relative z-10">
                <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center mb-6 backdrop-blur-md border border-white/20">
                  <Plus className="h-7 w-7 text-indigo-300 stroke-[3]" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2 tracking-tight">Receive PO / Refill Stock</h3>
                <p className="text-indigo-200 text-sm font-medium leading-relaxed max-w-sm mb-6">
                  Log incoming shipments from vendors. Enter received quantities, update unit costs, and attach digital invoices for accounting.
                </p>
                <div className="inline-flex items-center gap-2 text-sm font-bold text-white bg-white/10 px-4 py-2 rounded-full group-hover:bg-white group-hover:text-indigo-900 transition-colors">
                  Start Intake Workflow <ArrowLeft className="h-4 w-4 rotate-180" />
                </div>
              </div>
            </button>

            <button
              onClick={() => setActiveView('inventory')}
              className="group relative overflow-hidden bg-white border-2 border-gray-100 rounded-3xl p-8 text-left transition-all duration-300 hover:border-blue-200 hover:shadow-2xl hover:shadow-blue-900/5 hover:-translate-y-1"
            >
               <div className="absolute top-0 right-0 p-8 opacity-5 transform translate-x-4 -translate-y-4 group-hover:-rotate-12 transition-transform duration-500">
                <Boxes className="h-48 w-48 text-blue-900" />
              </div>
              <div className="relative z-10">
                <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mb-6 border border-blue-100 group-hover:bg-blue-600 transition-colors duration-300">
                  <Package className="h-7 w-7 text-blue-600 group-hover:text-white transition-colors" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2 tracking-tight">Master Database</h3>
                <p className="text-gray-500 text-sm font-medium leading-relaxed max-w-sm mb-6">
                  Browse the global catalog of components. Monitor current stock levels, view low-stock alerts, and track reorder thresholds.
                </p>
                <div className="inline-flex items-center gap-2 text-sm font-bold text-gray-700 bg-gray-50 px-4 py-2 rounded-full border border-gray-200 group-hover:bg-blue-50 group-hover:text-blue-700 group-hover:border-blue-200 transition-colors">
                  View Database <ArrowLeft className="h-4 w-4 rotate-180" />
                </div>
              </div>
            </button>

            <button
              onClick={() => setActiveView('po-history')}
              className="group relative overflow-hidden bg-white border-2 border-gray-100 rounded-3xl p-8 text-left transition-all duration-300 hover:border-emerald-200 hover:shadow-2xl hover:shadow-emerald-900/5 hover:-translate-y-1"
            >
               <div className="absolute top-0 right-0 p-8 opacity-5 transform translate-x-4 -translate-y-4 group-hover:-rotate-12 transition-transform duration-500">
                <FileText className="h-48 w-48 text-emerald-900" />
              </div>
              <div className="relative z-10">
                <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mb-6 border border-emerald-100 group-hover:bg-emerald-600 transition-colors duration-300">
                  <Receipt className="h-7 w-7 text-emerald-600 group-hover:text-white transition-colors" />
                </div>
                <h3 className="text-2xl font-bold text-gray-900 mb-2 tracking-tight">Stock Batches</h3>
                <p className="text-gray-500 text-sm font-medium leading-relaxed max-w-sm mb-6">
                  View historical Purchase Orders and restock batches. Verify digital invoices and drill down into received items.
                </p>
                <div className="inline-flex items-center gap-2 text-sm font-bold text-gray-700 bg-gray-50 px-4 py-2 rounded-full border border-gray-200 group-hover:bg-emerald-50 group-hover:text-emerald-700 group-hover:border-emerald-200 transition-colors">
                  View History <ArrowLeft className="h-4 w-4 rotate-180" />
                </div>
              </div>
            </button>
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-800 mb-4 px-1">Live Telemetry</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <StatCard label="Unique Parts" value={summaryLoading ? '...' : summary.totalUniqueComponents} color="indigo" icon={Package} />
              <StatCard label="In Stock" value={summaryLoading ? '...' : summary.totalInStock} color="emerald" icon={Boxes} />
              <StatCard label="Total Vol." value={summaryLoading ? '...' : summary.totalStockValue} color="blue" icon={BarChart3} />
              <StatCard label="Low Stock" value={summaryLoading ? '...' : summary.totalLowStock} color="amber" icon={AlertTriangle} />
              <StatCard label="Critical/Out" value={summaryLoading ? '...' : summary.totalOutOfStock} color="red" icon={TrendingDown} />
              <StatCard label="Today's Txns" value={summaryLoading ? '...' : summary.todayTransactions} color="violet" icon={ArrowUpDown} />
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* PO INTAKE VIEW */}
      {/* ----------------------------------------------------------------- */}
      {activeView === 'po-intake' && (
        <div className="flex-1 flex flex-col gap-6 animate-in fade-in duration-500">
           
           {/* TOP PANE: Metadata & File Upload */}
           <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
             
             {/* PO Details Form */}
             <div className="lg:col-span-2 bg-white rounded-3xl border border-gray-200 p-6 shadow-sm">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><FileText className="h-5 w-5 text-indigo-500"/> Shipment Details</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                   <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Vendor / Supplier <span className="text-red-500">*</span></Label>
                      <Input 
                         value={poInfo.vendorName} onChange={e => setPoInfo({...poInfo, vendorName: e.target.value})} 
                         placeholder="e.g. Digikey, LCSC" className="h-11 bg-gray-50 font-medium"
                      />
                   </div>
                   <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Invoice / PO Number <span className="text-red-500">*</span></Label>
                      <Input 
                         value={poInfo.invoiceNo} onChange={e => setPoInfo({...poInfo, invoiceNo: e.target.value})} 
                         placeholder="INV-2026-8942" className="h-11 bg-gray-50 font-bold text-indigo-700"
                      />
                   </div>
                   <div className="space-y-1.5">
                      <Label className="text-xs font-bold text-gray-500 uppercase tracking-wider">Received Date <span className="text-red-500">*</span></Label>
                      <Input 
                         type="date" value={poInfo.receivedDate} onChange={e => setPoInfo({...poInfo, receivedDate: e.target.value})} 
                         className="h-11 bg-gray-50 font-medium"
                      />
                   </div>
                </div>
             </div>

             {/* File Upload Zone */}
             <div className="bg-white rounded-3xl border border-gray-200 p-6 shadow-sm flex flex-col">
                <h3 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2"><Upload className="h-5 w-5 text-indigo-500"/> Digital Invoice</h3>
                <label className={`flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-2xl cursor-pointer transition-colors ${invoiceFile ? 'border-emerald-400 bg-emerald-50 mb-3' : 'border-gray-300 bg-gray-50 hover:bg-gray-100 hover:border-indigo-400'}`}>
                   <input type="file" className="hidden" accept=".pdf,image/*" onChange={handleFileUpload} />
                   {invoiceFile ? (
                      <div className="text-center p-4 relative w-full group">
                         <button 
                            type="button"
                            onClick={(e) => {
                               e.preventDefault();
                               e.stopPropagation();
                               setInvoiceFile(null);
                            }}
                            className="absolute top-2 right-2 p-1.5 bg-red-100 text-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-all hover:bg-red-200 hover:scale-110"
                            title="Remove file"
                         >
                            <X className="h-4 w-4" />
                         </button>
                         <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-2 shadow-sm"><Check className="h-6 w-6"/></div>
                         <p className="text-sm font-bold text-gray-800 truncate max-w-[200px] mx-auto">{invoiceFile.name}</p>
                         <p className="text-xs text-gray-500 mt-1 font-medium">{(invoiceFile.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                   ) : (
                      <div className="text-center p-4 text-gray-500">
                         <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400"/>
                         <p className="text-sm font-bold text-gray-700">Click to upload PDF</p>
                         <p className="text-xs mt-1">or drag and drop</p>
                      </div>
                   )}
                </label>
                {invoiceFile && (
                   <Button 
                     onClick={handleAIParsing} 
                     disabled={aiParsing}
                     className="w-full bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white font-bold rounded-xl h-12 shadow-lg shadow-indigo-200"
                   >
                     {aiParsing ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Sparkles className="h-5 w-5 mr-2" />}
                     {aiParsing ? 'AI is extracting items...' : '✨ Auto-Fill with AI'}
                   </Button>
                )}
             </div>
           </div>

           {/* BOTTOM PANE: Global Search & Intake Cart */}
           <div className="flex-1 bg-white rounded-3xl border border-gray-200 shadow-sm flex flex-col min-h-[400px] overflow-hidden">
              <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                 <div>
                    <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2"><Keyboard className="h-5 w-5 text-indigo-500"/> Component Intake List</h3>
                    <p className="text-xs font-medium text-gray-500">Press <strong>Enter</strong> to jump to the next input field instantly.</p>
                 </div>
                 
                 {/* Global Search Bar */}
                 <div className="relative w-full md:w-96 z-20">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <Input 
                       ref={searchInputRef}
                       placeholder="Search global database to add..." 
                       value={cartSearch} onChange={e => setCartSearch(e.target.value)}
                       className="pl-10 h-12 rounded-xl border-gray-300 focus:border-indigo-500 focus:ring-indigo-500 bg-white text-base font-medium shadow-sm"
                    />
                    
                    {/* Search Results Dropdown */}
                    {cartSearch.trim() !== '' && (
                       <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden max-h-80 overflow-y-auto">
                          {searchResults.length > 0 ? (
                             searchResults.map(part => (
                                <button key={part.id} onClick={() => addToCart(part)} className="w-full text-left p-4 hover:bg-indigo-50 border-b border-gray-50 flex items-center justify-between group transition-colors">
                                   <div>
                                      <p className="font-bold text-gray-900 group-hover:text-indigo-700">{part.part_name}</p>
                                      {part.description && <p className="text-xs text-gray-500 truncate">{part.description}</p>}
                                   </div>
                                   <div className="text-right">
                                      <p className="text-[10px] font-bold text-gray-400 uppercase">Current Stock</p>
                                      <p className="font-black text-gray-700">{part.stock_quantity}</p>
                                   </div>
                                </button>
                             ))
                          ) : (
                             <div className="p-4">
                                <p className="text-sm text-gray-500 font-medium mb-3">No existing components found.</p>
                                <Button onClick={() => addToCart(cartSearch)} className="w-full bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold border border-indigo-200">
                                   <Plus className="h-4 w-4 mr-2"/> Add "{cartSearch}" as New Part
                                </Button>
                             </div>
                          )}
                       </div>
                    )}
                 </div>
              </div>

              {/* The Cart Table */}
              <div className="flex-1 overflow-y-auto bg-white p-6 relative">
                 {cart.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center">
                       <ShoppingCart className="h-16 w-16 text-gray-200 mb-4" />
                       <p className="text-xl font-bold text-gray-400">Intake List is Empty</p>
                       <p className="text-sm text-gray-400 font-medium max-w-sm mt-2">Use the search bar above to find components and add them to this purchase order.</p>
                    </div>
                 ) : (
                    <div className="space-y-4">
                       {cart.some(item => !item.sparePartId) && (
                           <div className="bg-red-50 border-2 border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3 shadow-sm animate-in fade-in">
                              <AlertTriangle className="h-6 w-6 text-red-500 shrink-0 mt-0.5" />
                              <div>
                                 <p className="font-black text-red-800">New Components Detected!</p>
                                 <p className="text-sm font-medium mt-0.5 opacity-90">
                                    You are adding components that don't currently exist in the master database. 
                                    They will be automatically created as new spare parts once you confirm this PO.
                                 </p>
                              </div>
                           </div>
                        )}

                       {/* Table Header */}
                       <div className="grid grid-cols-[1fr_120px_140px_80px] gap-6 px-4 text-xs font-black text-gray-400 uppercase tracking-wider">
                          <div>Component</div>
                          <div className="text-center">Received Qty</div>
                          <div className="text-right">Unit Cost (₹)</div>
                          <div></div>
                       </div>
                       
                       {cart.map((item, index) => (
                          <div key={item.tempId} className={`grid grid-cols-[1fr_120px_140px_80px] gap-6 items-center bg-white p-4 rounded-2xl border ${item.isLocked ? 'border-gray-300 bg-gray-50 opacity-90' : 'border-gray-200'} shadow-sm hover:border-indigo-300 transition-colors group`}>
                             <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                   <span className="font-bold text-gray-900 truncate text-base">{item.partName}</span>
                                   {!item.sparePartId && <span className="text-[10px] bg-amber-100 text-amber-700 font-bold px-2 py-0.5 rounded-full border border-amber-200">NEW PART</span>}
                                </div>
                                {item.sparePartId ? (
                                   <p className="text-xs font-medium text-gray-500">Current Stock: <span className="font-bold">{item.currentStock}</span></p>
                                ) : (
                                   <div className="mt-2 flex items-center gap-2">
                                      <span className="text-[10px] text-gray-400 font-bold uppercase">Type:</span>
                                      <select 
                                         value={item.componentType || 'SW'} 
                                         onChange={e => updateCartItem(item.tempId, 'componentType', e.target.value)}
                                         disabled={item.isLocked}
                                         className={`text-xs font-bold text-gray-700 bg-gray-50 border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 ${item.isLocked ? 'cursor-not-allowed opacity-70' : ''}`}
                                      >
                                         <option value="R">Resistor (R)</option>
                                         <option value="C">Capacitor (C)</option>
                                         <option value="F">Fuse (F)</option>
                                         <option value="D">Diode (D)</option>
                                         <option value="Q">Transistor (Q)</option>
                                         <option value="U">IC / Regulator (U)</option>
                                         <option value="L">Inductor (L)</option>
                                         <option value="J">Connector (J)</option>
                                         <option value="SW">Others (SW)</option>
                                      </select>
                                   </div>
                                )}
                             </div>
                             
                             <div>
                                <input 
                                   ref={(el) => { qtyRefs.current[item.tempId] = el; }}
                                   type="number" 
                                   disabled={item.isLocked}
                                   className={`w-full h-11 text-center text-base font-black border-2 rounded-xl focus:outline-none transition-colors ${item.isLocked ? 'border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed' : 'border-gray-200 focus:border-indigo-500 focus:bg-indigo-50'}`}
                                   value={item.quantity || ''}
                                   onChange={e => updateCartItem(item.tempId, 'quantity', parseInt(e.target.value) || 0)}
                                   onKeyDown={e => handleKeyDown(e, item.tempId, 'qty')}
                                   placeholder="Qty"
                                />
                             </div>
                             
                             <div className="relative">
                                <span className={`absolute left-3 top-1/2 -translate-y-1/2 font-bold ${item.isLocked ? 'text-gray-300' : 'text-gray-400'}`}>₹</span>
                                <input 
                                   ref={(el) => { costRefs.current[item.tempId] = el; }}
                                   type="number" step="0.01"
                                   disabled={item.isLocked}
                                   className={`w-full h-11 pl-7 pr-3 text-right text-base font-black border-2 rounded-xl focus:outline-none transition-colors ${item.isLocked ? 'border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed' : 'border-gray-200 focus:border-emerald-500 focus:bg-emerald-50'}`}
                                   value={item.unitCost || ''}
                                   onChange={e => updateCartItem(item.tempId, 'unitCost', parseFloat(e.target.value) || 0)}
                                   onKeyDown={e => handleKeyDown(e, item.tempId, 'cost')}
                                   placeholder="0.00"
                                />
                             </div>
                             
                             <div className="flex items-center gap-1">
                                <button 
                                   onClick={() => updateCartItem(item.tempId, 'isLocked', !item.isLocked)} 
                                   className={`p-2 rounded-xl transition-colors ${item.isLocked ? 'text-indigo-500 bg-indigo-50 hover:bg-indigo-100' : 'text-gray-300 hover:text-gray-500 hover:bg-gray-50'}`}
                                   title={item.isLocked ? "Unlock item" : "Lock item to prevent changes"}
                                >
                                   {item.isLocked ? <Lock className="h-5 w-5" /> : <Unlock className="h-5 w-5" />}
                                </button>
                                <button 
                                   onClick={() => !item.isLocked && removeFromCart(item.tempId)} 
                                   disabled={item.isLocked}
                                   className={`p-2 rounded-xl transition-colors ${item.isLocked ? 'text-gray-200 cursor-not-allowed' : 'text-gray-300 hover:text-red-500 hover:bg-red-50'}`}
                                   title={item.isLocked ? "Unlock to delete" : "Remove item"}
                                >
                                   <Trash2 className="h-5 w-5" />
                                </button>
                             </div>
                          </div>
                       ))}
                    </div>
                 )}
              </div>
           </div>
        </div>
      )}

      {/* FAB FOR PO REVIEW */}
      {activeView === 'po-intake' && cart.length > 0 && (
         <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-12 fade-in duration-500">
            <div className="bg-gray-900 text-white rounded-full p-2 pl-6 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.5)] flex items-center gap-6 border border-gray-700/50 backdrop-blur-xl">
               <div className="flex items-center gap-4">
                  <div className="bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)] rounded-full w-9 h-9 flex items-center justify-center font-black text-sm">
                     {cart.length}
                  </div>
                  <div>
                     <p className="text-sm font-bold tracking-wide">Ready for Review</p>
                     <p className="text-xs text-emerald-400 font-bold">Total: ₹{totalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
                  </div>
               </div>
               
               <div className="h-8 w-px bg-gray-700"></div>
               
               <button 
                  onClick={() => setShowConfirm(true)} 
                  className="bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black px-8 py-3 rounded-full transition-all duration-300 flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:scale-105 active:scale-95"
               >
                  <Calculator className="h-5 w-5 stroke-[2.5]" />
                  Review Bill & Commit
               </button>
            </div>
         </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* THE "BILL" REVIEW MODAL */}
      {/* ----------------------------------------------------------------- */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-gray-50 rounded-3xl border-0 shadow-2xl">
          <DialogTitle className="sr-only">Stock Receipt Review</DialogTitle>
          
          {cart.some(item => !item.sparePartId) && (
             <div className="bg-red-600 text-white p-3 flex items-center justify-center gap-2 font-bold shadow-md relative z-10 animate-in slide-in-from-top-full">
                <AlertTriangle className="h-5 w-5" />
                WARNING: This receipt contains NEW components that do not exist in the database yet.
             </div>
          )}

          {/* Header - Looks like a receipt header */}
          <div className="px-8 py-8 bg-white border-b-2 border-dashed border-gray-300 relative">
             <div className="absolute top-0 left-0 w-full h-2 bg-indigo-600"></div>
             <div className="flex justify-between items-start">
                <div>
                   <h2 className="text-3xl font-black text-gray-900 tracking-tight uppercase mb-1">Stock Receipt</h2>
                   <p className="text-sm font-bold text-gray-500">Internal Verification Bill</p>
                </div>
                <div className="text-right">
                   <p className="text-sm font-bold text-gray-500 uppercase">Total Amount</p>
                   <p className="text-3xl font-black text-emerald-600">₹{totalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</p>
                </div>
             </div>
             
             <div className="grid grid-cols-2 gap-4 mt-8 bg-gray-50 p-4 rounded-xl border border-gray-200">
                <div>
                   <p className="text-xs font-bold text-gray-400 uppercase">Vendor</p>
                   <p className="font-bold text-gray-900">{poInfo.vendorName || <span className="text-red-500">Missing</span>}</p>
                </div>
                <div>
                   <p className="text-xs font-bold text-gray-400 uppercase">Invoice No</p>
                   <p className="font-bold text-gray-900">{poInfo.invoiceNo || <span className="text-red-500">Missing</span>}</p>
                </div>
                <div>
                   <p className="text-xs font-bold text-gray-400 uppercase">Date</p>
                   <p className="font-bold text-gray-900">{poInfo.receivedDate}</p>
                </div>
                <div>
                   <p className="text-xs font-bold text-gray-400 uppercase">Attachments</p>
                   <p className="font-bold text-gray-900 flex items-center gap-1">
                      {invoiceFile ? <><Check className="h-4 w-4 text-emerald-500"/> {invoiceFile.name}</> : <span className="text-amber-500 text-xs">No PDF uploaded</span>}
                   </p>
                </div>
             </div>
          </div>
          
          {/* Line Items */}
          <div className="flex-1 overflow-y-auto p-8 bg-white">
             <div className="grid grid-cols-[1fr_80px_100px_120px] gap-4 border-b-2 border-gray-900 pb-3 mb-4 text-xs font-black text-gray-400 uppercase tracking-wider">
                <div>Description</div>
                <div className="text-center">Qty</div>
                <div className="text-right">Unit Price</div>
                <div className="text-right">Amount (Incl. GST)</div>
             </div>
             
             <div className="space-y-3">
                {cart.map(item => (
                   <div 
                      key={item.tempId} 
                      className={`grid grid-cols-[1fr_80px_100px_120px] gap-4 items-center p-3 -mx-3 rounded-xl border ${!item.sparePartId ? 'bg-red-50 border-red-200 shadow-sm' : 'border-transparent hover:bg-gray-50'}`}
                    >
                       <div>
                          <p className={`font-bold ${!item.sparePartId ? 'text-red-900' : 'text-gray-900'}`}>{item.partName}</p>
                          {!item.sparePartId && (
                             <p className="text-[10px] text-red-600 font-bold mt-0.5">
                                Will be created as new part ({getCategoryNameFromPrefix(item.componentType)})
                             </p>
                          )}
                       </div>
                       <div className="text-center font-black text-gray-700">{item.quantity}</div>
                       <div className="text-right font-medium text-gray-600">₹{item.unitCost.toFixed(2)}</div>
                       <div className="text-right">
                          <div className={`font-black ${!item.sparePartId ? 'text-red-900' : 'text-gray-900'}`}>₹{(item.quantity * item.unitCost * 1.18).toLocaleString('en-IN', {minimumFractionDigits: 2})}</div>
                          <div className="text-[10px] text-gray-400 font-bold mt-0.5">
                             (GST: ₹{(item.quantity * item.unitCost * 0.18).toLocaleString('en-IN', {minimumFractionDigits: 2})})
                          </div>
                       </div>
                    </div>
                ))}
             </div>
             
             {/* Financial breakdown including GST */}
             <div className="mt-6 border-t-2 border-gray-200 pt-4 space-y-2">
                <div className="flex justify-between text-sm text-gray-600 font-medium">
                   <span>Subtotal (Excl. GST)</span>
                   <span>₹{subtotal.toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
                </div>
                <div className="flex justify-between text-sm text-gray-600 font-medium">
                   <span>GST (18%)</span>
                   <span>₹{gstAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
                </div>
                <div className="flex justify-between text-base font-black text-gray-900 border-t border-gray-200 pt-2">
                   <span>Grand Total (Incl. GST)</span>
                   <span>₹{totalAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
                </div>
             </div>
          </div>
          
          {/* Footer Actions */}
          <div className="px-8 py-5 bg-gray-50 border-t border-gray-200 flex justify-between items-center">
             <Button variant="outline" onClick={() => setShowConfirm(false)} className="rounded-xl font-bold border-gray-300">
                <ArrowLeft className="h-4 w-4 mr-2" /> Back to Edit
             </Button>
             
             <Button 
                onClick={handleSubmitPO} 
                disabled={submitting || !poInfo.vendorName || !poInfo.invoiceNo} 
                className="bg-indigo-600 hover:bg-indigo-700 text-white font-black px-8 py-6 rounded-xl shadow-lg shadow-indigo-600/30 text-base"
             >
                {submitting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <CheckCircle2 className="h-5 w-5 mr-2" />}
                Confirm & Record Intake
             </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ----------------------------------------------------------------- */}
      {/* MASTER INVENTORY VIEW (Kept from previous) */}
      {/* ----------------------------------------------------------------- */}
      {activeView === 'inventory' && (
         <div className="flex-1 flex flex-col gap-4 animate-in fade-in duration-500">
           <div className="flex items-center gap-3 bg-white p-3 rounded-2xl border border-gray-200 shadow-sm flex-wrap">
             <div className="flex-1 relative min-w-[200px]">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
               <Input value={invSearch} onChange={e => setInvSearch(e.target.value)} placeholder="Search global inventory..." className="pl-10 h-10 bg-gray-50 border-transparent focus:bg-white rounded-xl" />
             </div>
             <Button variant={showLowOnly ? 'default' : 'outline'} size="sm" onClick={() => setShowLowOnly(!showLowOnly)} className={`h-10 rounded-xl px-4 font-bold transition-all ${showLowOnly ? 'bg-amber-500 text-white border-transparent' : 'border-gray-200 text-gray-600'}`}>
               <Filter className="h-4 w-4 mr-2" /> Critical Stock
             </Button>
           </div>
           
           <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm flex-1 flex flex-col">
             <div className="grid grid-cols-[1fr_120px_120px_140px] gap-4 px-6 py-4 bg-gray-50/80 border-b border-gray-200 text-xs font-black text-gray-500 uppercase tracking-wider sticky top-0 z-10 backdrop-blur-sm">
               <div>Component Details</div>
               <div className="text-right">Current Stock</div>
               <div className="text-right">Reorder At</div>
               <div className="text-center">System Status</div>
             </div>
             <div className="overflow-y-auto flex-1">
                {ALL_CATEGORIES.map(category => {
                  const items = sortedInvParts.filter(
                    p => getCategory(p.part_name, p.description, p.location_hint) === category
                  );
                  if (items.length === 0) return null;
                  const s = CATEGORY_STYLES[category];
                  
                  return (
                    <div key={category} className="flex flex-col">
                      {/* Category Header */}
                      <div className={`${s.bg} px-6 py-3.5 text-xs font-black ${s.text} uppercase tracking-wider sticky top-0 z-10 backdrop-blur-sm border-y ${s.border} flex items-center gap-2`}>
                        <span className={`w-2.5 h-2.5 rounded-full ${s.dot} ${s.shadow}`}></span>
                        {category}
                        <span className={`text-[10px] ${s.badge} px-2.5 py-0.5 rounded-full font-black ml-1.5`}>{items.length}</span>
                      </div>
                      
                      {/* Category Rows */}
                      {items.map(sp => {
                        const isLow = sp.stock_quantity > 0 && sp.stock_quantity <= sp.reorder_threshold;
                        const isOut = sp.stock_quantity === 0;
                        return (
                          <div key={sp.id} className="grid grid-cols-[1fr_120px_120px_140px] gap-4 px-6 py-4 border-b border-gray-100 items-center group hover:bg-gray-50/50 transition-colors">
                            <div className="min-w-0">
                              <p className="text-base font-bold text-gray-900 truncate">{sp.part_name}</p>
                              {sp.description && sp.description !== sp.part_name && <p className="text-xs font-medium text-gray-400 truncate mt-0.5">{sp.description}</p>}
                            </div>
                            <div className="text-right font-black text-lg">{sp.stock_quantity}</div>
                            <div className="text-right font-bold text-gray-400">{sp.reorder_threshold}</div>
                            <div className="flex justify-center">
                              {isOut ? <span className="bg-red-50 text-red-700 px-3 py-1 rounded-lg font-bold text-xs border border-red-100">CRITICAL</span> : 
                               isLow ? <span className="bg-amber-50 text-amber-700 px-3 py-1 rounded-lg font-bold text-xs border border-amber-100">WARNING</span> : 
                               <span className="bg-emerald-50 text-emerald-700 px-3 py-1 rounded-lg font-bold text-xs border border-emerald-100">HEALTHY</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
             </div>
           </div>
         </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* PO HISTORY VIEW */}
      {/* ----------------------------------------------------------------- */}
      {activeView === 'po-history' && (
         <div className="flex-1 flex flex-col gap-4 animate-in fade-in duration-500">
           <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm flex-1 flex flex-col">
             <div className="grid grid-cols-[140px_1fr_140px_120px_80px] gap-4 px-6 py-4 bg-gray-50/80 border-b border-gray-200 text-xs font-black text-gray-500 uppercase tracking-wider sticky top-0 z-10 backdrop-blur-sm">
               <div>Date</div>
               <div>Vendor & Invoice</div>
               <div className="text-right">Total Amount</div>
               <div className="text-right">Items</div>
               <div className="text-center">Action</div>
             </div>
             <div className="overflow-y-auto flex-1 p-2">
               {historyLoading ? (
                 <div className="flex items-center justify-center h-40"><Loader2 className="h-8 w-8 animate-spin text-gray-300" /></div>
               ) : poHistory.length === 0 ? (
                 <div className="flex flex-col items-center justify-center h-40 text-gray-400">
                   <Receipt className="h-8 w-8 mb-2 opacity-50" />
                   <p className="font-bold text-sm">No restock history found.</p>
                 </div>
               ) : poHistory.map(po => (
                 <div key={po.id} className="grid grid-cols-[140px_1fr_140px_120px_80px] gap-4 px-4 py-4 border-b border-gray-100 items-center group hover:bg-gray-50/50 transition-colors rounded-xl">
                   <div className="font-bold text-gray-900">{new Date(po.received_date).toLocaleDateString()}</div>
                   <div>
                     <p className="font-bold text-gray-900">{po.vendor_name}</p>
                     <p className="text-xs font-medium text-gray-500 flex items-center gap-1">
                       <FileText className="h-3 w-3" /> {po.invoice_no}
                       {po.invoice_file_path && <a href={po.invoice_file_path} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline ml-2 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> PDF attached</a>}
                     </p>
                   </div>
                    <div className="text-right">
                      {(() => {
                        // Prefer the dynamically-computed subtotal (sum of line items);
                        // fall back to stored total_amount for backward-compat if subtotal is 0.
                        const sub = Number(po.subtotal) > 0 ? Number(po.subtotal) : Number(po.total_amount) / 1.18;
                        const gstInclusive = sub * 1.18;
                        return (
                          <>
                            <div className="font-black text-emerald-600">₹{gstInclusive.toLocaleString('en-IN', {minimumFractionDigits: 2})}</div>
                            <div className="text-[10px] text-gray-400 font-bold mt-0.5">(GST: ₹{(sub * 0.18).toLocaleString('en-IN', {minimumFractionDigits: 2})})</div>
                          </>
                        );
                      })()}
                    </div>
                   <div className="text-right font-bold text-gray-500">{po.items_count} parts</div>
                   <div className="flex justify-center">
                     <Button variant="outline" size="sm" onClick={() => viewReceiptDetails(po.id)} className="h-8 rounded-lg text-xs font-bold border-gray-200">
                       Details
                     </Button>
                   </div>
                 </div>
               ))}
             </div>
           </div>

           {/* Receipt Details Modal */}
           <Dialog open={selectedReceiptId !== null} onOpenChange={(open) => !open && setSelectedReceiptId(null)}>
             <DialogContent className="max-w-2xl bg-white rounded-3xl border-0 shadow-2xl p-0 overflow-hidden">
               <DialogTitle className="sr-only">Receipt Details</DialogTitle>
               <div className="px-6 py-5 bg-gray-50 border-b border-gray-100">
                 <h3 className="text-lg font-black text-gray-900">Batch Line Items</h3>
                 <p className="text-xs font-bold text-gray-500 uppercase">Received Components</p>
               </div>
               <div className="p-6 overflow-y-auto max-h-[60vh]">
                 {detailsLoading ? (
                   <div className="flex items-center justify-center h-32"><Loader2 className="h-6 w-6 animate-spin text-gray-300" /></div>
                 ) : (
                   <div className="space-y-3">
                     <div className="grid grid-cols-[1fr_80px_100px_120px] gap-4 border-b-2 border-gray-100 pb-2 text-xs font-black text-gray-400 uppercase tracking-wider">
                        <div>Component</div>
                        <div className="text-center">Qty</div>
                        <div className="text-right">Unit Price</div>
                        <div className="text-right">Total (Incl. GST)</div>
                     </div>
                     {receiptDetails.map(item => (
                       <div key={item.id} className="grid grid-cols-[1fr_80px_100px_120px] gap-4 py-3 border-b border-gray-50 items-center">
                         <div>
                           <p className="font-bold text-gray-900">{item.part_name}</p>
                           {item.description && item.description !== item.part_name && <p className="text-xs text-gray-500 truncate mt-0.5">{item.description}</p>}
                         </div>
                         <div className="text-center font-black text-gray-700">{item.quantity}</div>
                         <div className="text-right font-medium text-gray-500">₹{Number(item.unit_cost).toFixed(2)}</div>
                         <div className="text-right">
                           <div className="font-black text-gray-900">₹{(item.quantity * item.unit_cost * 1.18).toLocaleString('en-IN', {minimumFractionDigits: 2})}</div>
                           <div className="text-[10px] text-gray-400 font-bold mt-0.5">
                             (GST: ₹{(item.quantity * item.unit_cost * 0.18).toLocaleString('en-IN', {minimumFractionDigits: 2})})
                           </div>
                         </div>
                       </div>
                     ))}
                     
                     {/* Breakdown for Receipt Details */}
                     {receiptDetails.length > 0 && (() => {
                        const sub = receiptDetails.reduce((sum, item) => sum + (item.quantity * Number(item.unit_cost)), 0);
                        const gst = sub * 0.18;
                        const tot = sub * 1.18;
                        return (
                          <div className="mt-4 pt-3 border-t-2 border-dashed border-gray-200 space-y-1.5 text-sm text-gray-600 font-medium">
                            <div className="flex justify-between">
                              <span>Subtotal</span>
                              <span>₹{sub.toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
                            </div>
                            <div className="flex justify-between">
                              <span>GST (18%)</span>
                              <span>₹{gst.toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
                            </div>
                            <div className="flex justify-between font-black text-gray-900 border-t border-gray-100 pt-1.5">
                              <span>Total (Incl. GST)</span>
                              <span>₹{tot.toLocaleString('en-IN', {minimumFractionDigits: 2})}</span>
                            </div>
                          </div>
                        );
                     })()}
                   </div>
                 )}
               </div>
               <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 text-right">
                 <Button onClick={() => setSelectedReceiptId(null)} className="rounded-xl font-bold bg-gray-900 text-white hover:bg-gray-800">Close</Button>
               </div>
             </DialogContent>
           </Dialog>
         </div>
      )}
    </div>
  );
}
