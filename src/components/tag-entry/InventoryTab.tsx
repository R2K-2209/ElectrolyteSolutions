'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Package, Plus, Minus, BarChart3, TrendingDown, Boxes, ArrowLeft,
  Search, Check, ChevronDown, Loader2, AlertTriangle, CheckCircle2,
  ArrowUpDown, Filter, X, Zap, Trash2, ShoppingCart
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  getProductsWithBomCountAction,
  getBomComponentsByProductIdAction,
  getAllSparePartsAction,
  addStockForComponentsAction,
  getInventorySummaryAction,
} from '@/app/actions/inventory-actions';

import type { StockItem } from '@/lib/pg-db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Product {
  id: number;
  part_code: string;
  description: string;
  component_count: number;
}

interface BomRow {
  id: number;
  location: string;
  description: string;
  quantity: number;
  spare_part_id: number | null;
  current_stock: number | null;
  reorder_threshold: number | null;
}

interface SparePartRow {
  id: number;
  part_name: string;
  description: string | null;
  stock_quantity: number;
  initial_quantity: number;
  reorder_threshold: number;
}

interface Summary {
  totalUniqueComponents: number;
  totalInStock: number;
  totalLowStock: number;
  totalOutOfStock: number;
  totalStockValue: number;
  todayTransactions: number;
}

type ActiveView = 'overview' | 'add-stock' | 'inventory';

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
interface InventoryTabProps {
  dcNumbers: string[];
  dcPartCodes: Record<string, string[]>;
}

export function InventoryTab({ dcNumbers = [], dcPartCodes = {} }: InventoryTabProps) {
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

  // Add Stock flow
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [bomComponents, setBomComponents] = useState<BomRow[]>([]);
  const [bomLoading, setBomLoading] = useState(false);
  const [bomSearch, setBomSearch] = useState('');
  
  // Map: bomId -> { selected, qty, threshold }
  const [selections, setSelections] = useState<Record<number, { selected: boolean; qty: number; threshold: number }>>({});
  
  const [submitting, setSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  
  // Auto-focus refs
  const inputRefs = useRef<Record<number, HTMLInputElement | null>>({});

  // Inventory view
  const [spareParts, setSpareParts] = useState<SparePartRow[]>([]);
  const [sparePartsLoading, setSparePartsLoading] = useState(false);
  const [invSearch, setInvSearch] = useState('');
  const [showLowOnly, setShowLowOnly] = useState(false);
  const [invSort, setInvSort] = useState<'name' | 'stock' | 'threshold'>('name');

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    const res = await getInventorySummaryAction();
    if (res.success) setSummary(res.data);
    setSummaryLoading(false);
  }, []);

  const loadProducts = useCallback(async () => {
    setProductsLoading(true);
    const res = await getProductsWithBomCountAction();
    if (res.success) setProducts(res.data);
    setProductsLoading(false);
  }, []);

  const loadBomForProduct = useCallback(async (product: Product) => {
    setBomLoading(true);
    setBomSearch('');
    setSelections({});
    const res = await getBomComponentsByProductIdAction(product.id);
    if (res.success) {
      setBomComponents(res.data);
      // Initialize selections
      const init: Record<number, { selected: boolean; qty: number; threshold: number }> = {};
      for (const c of res.data) {
        init[c.id] = { selected: false, qty: 1, threshold: c.reorder_threshold ?? 5 };
      }
      setSelections(init);
    }
    setBomLoading(false);
  }, []);

  const loadSpareParts = useCallback(async () => {
    setSparePartsLoading(true);
    const res = await getAllSparePartsAction({ lowStockOnly: showLowOnly, search: invSearch || undefined });
    if (res.success) setSpareParts(res.data);
    setSparePartsLoading(false);
  }, [showLowOnly, invSearch]);

  // Load summary on mount
  useEffect(() => { loadSummary(); }, [loadSummary]);

  // Load products when entering add-stock view
  useEffect(() => {
    if (activeView === 'add-stock' && products.length === 0) loadProducts();
  }, [activeView, products.length, loadProducts]);

  // Load spare parts when entering inventory view
  useEffect(() => {
    if (activeView === 'inventory') loadSpareParts();
  }, [activeView, loadSpareParts]);

  // -------------------------------------------------------------------------
  // Add Stock handlers
  // -------------------------------------------------------------------------
  const handleSelectProduct = (product: Product) => {
    setSelectedProduct(product);
    loadBomForProduct(product);
  };

  const handleBackToProducts = () => {
    setSelectedProduct(null);
    setBomComponents([]);
    setSelections({});
  };

  const toggleSelect = (bomId: number) => {
    setSelections(prev => {
      const isNowSelected = !prev[bomId]?.selected;
      
      // Auto-focus logic: if we just selected it, focus the input shortly after
      if (isNowSelected) {
        setTimeout(() => {
          inputRefs.current[bomId]?.focus();
          inputRefs.current[bomId]?.select(); // Select all text so they can just type
        }, 50);
      }
      
      return {
        ...prev,
        [bomId]: { ...prev[bomId], selected: isNowSelected }
      };
    });
  };

  const toggleSelectAll = () => {
    const filtered = filteredBom;
    const allSelected = filtered.every(c => selections[c.id]?.selected);
    setSelections(prev => {
      const next = { ...prev };
      for (const c of filtered) {
        next[c.id] = { ...next[c.id], selected: !allSelected };
      }
      return next;
    });
  };

  const updateQty = (bomId: number, qty: number) => {
    setSelections(prev => ({
      ...prev,
      [bomId]: { ...prev[bomId], qty: Math.max(0, qty) }
    }));
  };

  const updateThreshold = (bomId: number, threshold: number) => {
    setSelections(prev => ({
      ...prev,
      [bomId]: { ...prev[bomId], threshold: Math.max(0, threshold) }
    }));
  };

  // Filter BOM by search
  const filteredBom = useMemo(() => {
    if (!bomSearch.trim()) return bomComponents;
    const term = bomSearch.toLowerCase();
    return bomComponents.filter(c =>
      c.location.toLowerCase().includes(term) ||
      c.description.toLowerCase().includes(term)
    );
  }, [bomComponents, bomSearch]);

  // Count selected
  const selectedItems = useMemo(() => {
    return Object.entries(selections)
      .filter(([, v]) => v.selected && v.qty > 0)
      .map(([bomId, v]) => {
        const bom = bomComponents.find(c => c.id === Number(bomId));
        return bom ? { 
          bomId: bom.id, 
          partName: bom.description, 
          description: bom.description, 
          qty: v.qty, 
          threshold: v.threshold, 
          location: bom.location,
          currentStock: bom.current_stock
        } : null;
      })
      .filter(Boolean) as { bomId: number; partName: string; description: string; qty: number; threshold: number; location: string; currentStock: number | null }[];
  }, [selections, bomComponents]);

  // Auto-close modal if no items are selected
  useEffect(() => {
     if (showConfirm && selectedItems.length === 0) {
        setShowConfirm(false);
     }
  }, [selectedItems.length, showConfirm]);

  const handleSubmitStock = async () => {
    if (selectedItems.length === 0) return;

    setSubmitting(true);
    const stockItems: StockItem[] = selectedItems.map(item => ({
      bomId: item.bomId,
      partName: item.partName,
      description: item.description,
      quantity: item.qty,
      reorderThreshold: item.threshold || 5, // Default threshold if not set
    }));

    const res = await addStockForComponentsAction(
      stockItems,
      user?.name || user?.email || 'Unknown'
    );

    if (res.success) {
      toast({ title: 'Stock Added Successfully', description: `${res.count} component(s) added to inventory.`, variant: 'default' });
      // Close modal and clear selections
      setShowConfirm(false);
      setSelections(prev => {
        const next = { ...prev };
        for (const key of Object.keys(next)) {
           next[Number(key)].selected = false;
           next[Number(key)].qty = 1; // reset qty
        }
        return next;
      });
      // Refresh data
      loadSummary();
      if (selectedProduct) loadBomForProduct(selectedProduct);
    } else {
      toast({ variant: 'destructive', title: 'Transaction Failed', description: res.error || 'Could not add stock due to a database error.' });
    }
    setSubmitting(false);
  };

  // Sorted spare parts for inventory view
  const sortedSpareParts = useMemo(() => {
    const sorted = [...spareParts];
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
  }, [spareParts, invSort]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-full gap-6 p-2">
      {/* Header section with breadcrumbs and titles */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {activeView !== 'overview' && (
            <button 
              onClick={() => { setActiveView('overview'); setSelectedProduct(null); }}
              className="p-2 rounded-full hover:bg-gray-100 transition-colors bg-white shadow-sm border border-gray-100"
            >
              <ArrowLeft className="h-5 w-5 text-gray-600" />
            </button>
          )}
          <div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
              {activeView === 'overview' && <><Boxes className="h-6 w-6 text-indigo-600" /> Component Center</>}
              {activeView === 'add-stock' && <><Zap className="h-6 w-6 text-amber-500" /> Rapid Stock Entry</>}
              {activeView === 'inventory' && <><Package className="h-6 w-6 text-blue-600" /> Master Inventory</>}
            </h2>
            <p className="text-sm font-medium text-gray-500 mt-1">
              {activeView === 'overview' && 'Live statistics and intelligent inventory management workflows.'}
              {activeView === 'add-stock' && (selectedProduct ? `Importing to ${selectedProduct.part_code} — ${selectedProduct.description}` : 'Select a PCB profile to begin rapid component entry.')}
              {activeView === 'inventory' && 'Real-time view of all tracked components across all PCBs.'}
            </p>
          </div>
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* OVERVIEW VIEW */}
      {/* ----------------------------------------------------------------- */}
      {activeView === 'overview' && (
        <div className="space-y-6">
          {/* Action Cards (Hero level) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <button
              onClick={() => setActiveView('add-stock')}
              className="group relative overflow-hidden bg-gradient-to-br from-indigo-900 to-indigo-800 rounded-3xl p-8 text-left transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-900/20 hover:-translate-y-1"
            >
              <div className="absolute top-0 right-0 p-8 opacity-10 transform translate-x-4 -translate-y-4 group-hover:rotate-12 transition-transform duration-500">
                <Plus className="h-48 w-48 text-white" />
              </div>
              <div className="relative z-10">
                <div className="w-14 h-14 bg-white/10 rounded-2xl flex items-center justify-center mb-6 backdrop-blur-md border border-white/20">
                  <Zap className="h-7 w-7 text-indigo-300" />
                </div>
                <h3 className="text-2xl font-bold text-white mb-2 tracking-tight">Rapid Stock Entry</h3>
                <p className="text-indigo-200 text-sm font-medium leading-relaxed max-w-sm mb-6">
                  Select a PCB profile, rapidly pick components from its BOM, and batch-add stock quantities securely to the master inventory.
                </p>
                <div className="inline-flex items-center gap-2 text-sm font-bold text-white bg-white/10 px-4 py-2 rounded-full group-hover:bg-white group-hover:text-indigo-900 transition-colors">
                  Launch Workflow <ArrowLeft className="h-4 w-4 rotate-180" />
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
                <h3 className="text-2xl font-bold text-gray-900 mb-2 tracking-tight">Master Inventory</h3>
                <p className="text-gray-500 text-sm font-medium leading-relaxed max-w-sm mb-6">
                  Browse the global catalog of components. Monitor current stock levels, view low-stock alerts, and track reorder thresholds.
                </p>
                <div className="inline-flex items-center gap-2 text-sm font-bold text-gray-700 bg-gray-50 px-4 py-2 rounded-full border border-gray-200 group-hover:bg-blue-50 group-hover:text-blue-700 group-hover:border-blue-200 transition-colors">
                  View Database <ArrowLeft className="h-4 w-4 rotate-180" />
                </div>
              </div>
            </button>
          </div>

          {/* Stats Row */}
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
      {/* ADD STOCK VIEW - PCB SELECTOR */}
      {/* ----------------------------------------------------------------- */}
      {activeView === 'add-stock' && !selectedProduct && (
        <div className="flex-1 animate-in fade-in duration-500">
          {productsLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {products.filter(p => p.component_count > 0).map(product => (
                <button
                  key={product.id}
                  onClick={() => handleSelectProduct(product)}
                  className="bg-white border-2 border-transparent shadow-sm rounded-2xl p-5 text-left hover:border-indigo-500 hover:shadow-xl hover:shadow-indigo-500/10 transition-all duration-300 group relative overflow-hidden"
                >
                  <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-indigo-50 to-transparent rounded-bl-full -z-0 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                  <div className="relative z-10">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-lg font-black text-gray-900 group-hover:text-indigo-600 transition-colors">
                        {product.part_code}
                      </span>
                      <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100">
                        {product.component_count} parts
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 font-medium leading-relaxed">{product.description}</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* ADD STOCK VIEW - COMPONENT LISTING (RICH UX) */}
      {/* ----------------------------------------------------------------- */}
      {activeView === 'add-stock' && selectedProduct && (
        <div className="flex-1 flex flex-col min-h-0 animate-in fade-in duration-500">
          {/* Toolbar */}
          <div className="flex items-center justify-between bg-white p-3 rounded-2xl border border-gray-200 shadow-sm mb-4">
            <div className="flex items-center gap-3 w-full md:w-auto">
              <div className="relative flex-1 md:w-80">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  value={bomSearch}
                  onChange={e => setBomSearch(e.target.value)}
                  placeholder="Search by location or description..."
                  className="pl-9 h-10 bg-gray-50 border-transparent focus:bg-white rounded-xl transition-colors"
                />
                {bomSearch && (
                  <button onClick={() => setBomSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                    <X className="h-4 w-4 text-gray-400 hover:text-gray-600" />
                  </button>
                )}
              </div>
            </div>
            <div className="hidden md:flex items-center gap-3">
               <span className="text-sm font-medium text-gray-500">
                  {filteredBom.length} component{filteredBom.length !== 1 ? 's' : ''} found
               </span>
               <div className="h-6 w-px bg-gray-200"></div>
               <Button variant="ghost" size="sm" onClick={toggleSelectAll} className="font-bold text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 rounded-xl">
                 {filteredBom.every(c => selections[c.id]?.selected) ? 'Deselect All' : 'Select All'}
               </Button>
            </div>
          </div>

          {/* Component Rich List */}
          {bomLoading ? (
            <div className="flex items-center justify-center py-20 flex-1">
              <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            </div>
          ) : (
            <div className="overflow-y-auto flex-1 pr-2 pb-24 space-y-3 scrollbar-hide">
              {filteredBom.length === 0 ? (
                <div className="text-center py-20 bg-gray-50 rounded-3xl border border-dashed border-gray-300">
                  <Search className="h-10 w-10 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 font-medium">No components match your search.</p>
                </div>
              ) : (
                filteredBom.map(comp => {
                  const sel = selections[comp.id];
                  const isSelected = sel?.selected;
                  const hasStock = comp.current_stock !== null && comp.current_stock > 0;
                  const isLow = hasStock && comp.current_stock !== null && comp.reorder_threshold !== null && comp.current_stock <= comp.reorder_threshold;
                  const isOut = comp.current_stock === 0;

                  return (
                    <div
                      key={comp.id}
                      onClick={() => toggleSelect(comp.id)}
                      className={`group flex flex-col md:flex-row md:items-center justify-between p-4 md:p-5 rounded-2xl border transition-all duration-300 cursor-pointer ${
                        isSelected
                          ? 'bg-gradient-to-r from-indigo-50/80 to-white border-indigo-300 shadow-[0_8px_24px_-8px_rgba(99,102,241,0.25)] scale-[1.01] z-10 relative'
                          : 'bg-white border-gray-200 hover:border-gray-300 hover:shadow-lg hover:shadow-gray-200/50'
                      }`}
                    >
                      {/* Left side: Selection & Info */}
                      <div className="flex items-start md:items-center gap-4 md:gap-5 flex-1 min-w-0 mb-4 md:mb-0">
                        <div className={`mt-1 md:mt-0 w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-colors ${
                          isSelected ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm shadow-indigo-600/30' : 'border-gray-300 group-hover:border-indigo-400 bg-white'
                        }`}>
                          {isSelected && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                        </div>
                        
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3 mb-1.5 flex-wrap">
                            <span className={`font-mono text-sm font-bold px-2.5 py-0.5 rounded-lg border ${
                               isSelected ? 'bg-indigo-100 border-indigo-200 text-indigo-800' : 'bg-gray-100 border-gray-200 text-gray-700'
                            }`}>
                              {comp.location}
                            </span>
                            
                            {/* Visual Stock Indicator */}
                            {comp.current_stock !== null ? (
                               <div className={`flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full border ${
                                  isOut ? 'bg-red-50 text-red-700 border-red-200' :
                                  isLow ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                  'bg-emerald-50 text-emerald-700 border-emerald-200'
                               }`}>
                                  <div className={`w-1.5 h-1.5 rounded-full ${isOut ? 'bg-red-500' : isLow ? 'bg-amber-500' : 'bg-emerald-500'}`}></div>
                                  {comp.current_stock} in stock
                               </div>
                            ) : (
                               <div className="flex items-center gap-1.5 text-xs font-bold px-2 py-0.5 rounded-full border bg-gray-50 text-gray-500 border-gray-200">
                                  <div className="w-1.5 h-1.5 rounded-full bg-gray-400"></div>
                                  New Item
                               </div>
                            )}
                          </div>
                          <h4 className={`text-base font-bold truncate transition-colors ${isSelected ? 'text-indigo-950' : 'text-gray-800'}`}>
                             {comp.description}
                          </h4>
                        </div>
                      </div>

                      {/* Right side: Stepper Controls */}
                      <div 
                         className={`flex items-center gap-6 transition-all duration-300 origin-right ${isSelected ? 'opacity-100 scale-100' : 'opacity-40 grayscale scale-95 pointer-events-none'}`}
                         onClick={e => e.stopPropagation()} // Prevent row selection toggle when interacting with controls
                      >
                         {/* Quantity Stepper */}
                         <div className="flex flex-col items-end md:items-center">
                            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5 ml-1">Quantity</span>
                            <div className={`flex items-center rounded-xl overflow-hidden border-2 transition-colors ${isSelected ? 'border-indigo-200 bg-white shadow-sm' : 'border-gray-200 bg-gray-50'}`}>
                               <button 
                                 onClick={() => updateQty(comp.id, sel.qty - 1)} 
                                 className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-600 active:bg-gray-200"
                               >
                                  <Minus className="h-4 w-4 stroke-[2.5]" />
                               </button>
                               <input 
                                 ref={(el) => { inputRefs.current[comp.id] = el; }} // Assign ref for auto-focus
                                 type="number" 
                                 className="w-14 h-10 text-center text-base font-black bg-transparent border-x border-gray-100 focus:outline-none focus:bg-indigo-50 focus:text-indigo-700 transition-colors" 
                                 value={sel.qty} 
                                 onChange={e => updateQty(comp.id, parseInt(e.target.value) || 0)} 
                               />
                               <button 
                                 onClick={() => updateQty(comp.id, sel.qty + 1)} 
                                 className="w-10 h-10 flex items-center justify-center hover:bg-gray-100 transition-colors text-gray-600 active:bg-gray-200"
                               >
                                  <Plus className="h-4 w-4 stroke-[2.5]" />
                               </button>
                            </div>
                         </div>
                         {/* Note: Threshold input was removed from here based on user feedback to declutter the UI */}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* ----------------------------------------------------------------- */}
          {/* FLOATING ACTION BAR (FAB) FOR SUBMISSION */}
          {/* ----------------------------------------------------------------- */}
          {selectedItems.length > 0 && (
             <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-12 fade-in duration-500 ease-out">
                <div className="bg-gray-900 text-white rounded-full p-2 pl-6 shadow-[0_20px_40px_-10px_rgba(0,0,0,0.5)] flex items-center gap-5 border border-gray-700/50 backdrop-blur-xl">
                   <div className="flex items-center gap-4">
                      <div className="bg-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)] rounded-full w-9 h-9 flex items-center justify-center font-black text-sm">
                         {selectedItems.length}
                      </div>
                      <div className="hidden md:block">
                         <p className="text-sm font-bold tracking-wide">Components Selected</p>
                         <p className="text-xs text-gray-400 font-medium">{selectedItems.reduce((s, i) => s + i.qty, 0)} total parts to add</p>
                      </div>
                   </div>
                   
                   <div className="h-8 w-px bg-gray-700 hidden md:block"></div>
                   
                   <button 
                      onClick={() => setShowConfirm(true)} 
                      disabled={submitting}
                      className="bg-gradient-to-r from-emerald-500 to-emerald-400 hover:from-emerald-400 hover:to-emerald-300 text-emerald-950 font-black px-6 py-3 rounded-full transition-all duration-300 flex items-center gap-2 shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_25px_rgba(16,185,129,0.5)] hover:scale-105 active:scale-95 disabled:opacity-50 disabled:pointer-events-none"
                   >
                      <ShoppingCart className="h-5 w-5 stroke-[2.5]" />
                      Review Cart
                   </button>
                </div>
             </div>
          )}

          {/* ----------------------------------------------------------------- */}
          {/* INTERACTIVE CART REVIEW MODAL */}
          {/* ----------------------------------------------------------------- */}
          <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0 overflow-hidden bg-gray-50 rounded-3xl border-0 shadow-2xl">
              <div className="px-8 py-6 bg-white border-b border-gray-200">
                 <DialogHeader>
                    <DialogTitle className="text-2xl font-black text-gray-900 flex items-center gap-3">
                       <ShoppingCart className="h-7 w-7 text-indigo-600" />
                       Review Stock Entry
                    </DialogTitle>
                    <DialogDescription className="text-sm font-medium text-gray-500 mt-1">
                       Review your selections before writing to the master database. You can adjust quantities or remove items here.
                    </DialogDescription>
                 </DialogHeader>
              </div>
              
              {/* Interactive Cart List */}
              <div className="flex-1 overflow-y-auto p-8 space-y-4">
                 {selectedItems.map(item => (
                    <div key={item.bomId} className="flex flex-col md:flex-row md:items-center gap-4 bg-white p-5 rounded-2xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow">
                       
                       {/* Info */}
                       <div className="flex-1 min-w-0">
                          <div className="font-mono text-xs font-bold px-2.5 py-1 rounded-md bg-indigo-50 text-indigo-700 w-max mb-1.5 border border-indigo-100">
                             {item.location}
                          </div>
                          <p className="font-bold text-gray-900 truncate" title={item.description}>{item.description}</p>
                       </div>
                       
                       {/* Math Row */}
                       <div className="flex items-center justify-between md:justify-end gap-6 md:gap-8 bg-gray-50 md:bg-transparent p-4 md:p-0 rounded-xl md:rounded-none">
                          <div className="text-center">
                             <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">Current</p>
                             <p className="font-bold text-gray-600 text-lg">{item.currentStock !== null ? item.currentStock : <span className="text-xs bg-gray-200 px-2 py-0.5 rounded text-gray-600">NEW</span>}</p>
                          </div>
                          
                          <div className="text-gray-300 font-black text-xl">+</div>
                          
                          <div className="text-center">
                             <p className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider mb-1">Add Qty</p>
                             <input 
                                type="number" 
                                className="w-16 h-9 text-center text-base font-black border-2 border-indigo-200 rounded-lg focus:outline-none focus:border-indigo-500 bg-white text-indigo-700 shadow-sm transition-colors" 
                                value={item.qty} 
                                onChange={(e) => updateQty(item.bomId, parseInt(e.target.value) || 0)} 
                             />
                          </div>
                          
                          <div className="text-gray-300 font-black text-xl">=</div>
                          
                          <div className="text-center w-12">
                             <p className="text-[10px] text-emerald-500 font-bold uppercase tracking-wider mb-1">Final</p>
                             <p className="font-black text-emerald-600 text-2xl">
                                {item.currentStock !== null ? item.currentStock + item.qty : item.qty}
                             </p>
                          </div>

                          <div className="h-10 w-px bg-gray-200 hidden md:block ml-2"></div>

                          <div className="text-center hidden md:block">
                             <p className="text-[10px] text-amber-500 font-bold uppercase tracking-wider mb-1">Reorder At</p>
                             <input 
                                type="number" 
                                className="w-14 h-9 text-center text-sm font-bold border border-amber-200 rounded-lg focus:outline-none focus:border-amber-400 focus:bg-amber-50 bg-white transition-colors" 
                                value={item.threshold} 
                                onChange={(e) => updateThreshold(item.bomId, parseInt(e.target.value) || 0)} 
                             />
                          </div>
                       </div>
                       
                       {/* Delete Button */}
                       <button 
                          className="p-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-colors ml-0 md:ml-4 flex justify-center md:inline-flex"
                          onClick={() => toggleSelect(item.bomId)}
                          title="Remove from Cart"
                       >
                          <Trash2 className="h-5 w-5" />
                       </button>
                    </div>
                 ))}
                 
                 {selectedItems.length === 0 && (
                    <div className="text-center py-12 text-gray-500">
                       All items removed.
                    </div>
                 )}
              </div>
              
              {/* Footer */}
              <div className="px-8 py-5 bg-white border-t border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4">
                 <Button 
                    variant="ghost" 
                    onClick={() => setShowConfirm(false)}
                    className="w-full sm:w-auto font-bold text-gray-600 hover:text-gray-900 rounded-xl"
                 >
                    <ArrowLeft className="h-4 w-4 mr-2" /> Continue Selecting
                 </Button>
                 
                 <div className="flex items-center gap-4 w-full sm:w-auto">
                    <div className="text-right hidden sm:block mr-2">
                       <p className="text-sm font-semibold text-gray-500">Total Items: <span className="text-gray-900">{selectedItems.length}</span></p>
                       <p className="text-sm font-semibold text-gray-500">Total Qty: <span className="text-indigo-600">+{selectedItems.reduce((s, i) => s + i.qty, 0)}</span></p>
                    </div>
                    <Button 
                       onClick={handleSubmitStock} 
                       disabled={submitting || selectedItems.length === 0} 
                       className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 text-white font-black px-8 py-6 rounded-xl shadow-lg shadow-emerald-600/30 text-base"
                    >
                       {submitting ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <DatabaseIcon className="h-5 w-5 mr-2" />}
                       Write to Database
                    </Button>
                 </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* INVENTORY VIEW */}
      {/* ----------------------------------------------------------------- */}
      {activeView === 'inventory' && (
         <div className="flex-1 flex flex-col gap-4 animate-in fade-in duration-500">
           {/* Modern Toolbar */}
           <div className="flex items-center gap-3 bg-white p-3 rounded-2xl border border-gray-200 shadow-sm flex-wrap">
             <div className="flex-1 relative min-w-[200px]">
               <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
               <Input
                 value={invSearch}
                 onChange={e => setInvSearch(e.target.value)}
                 placeholder="Search global inventory..."
                 className="pl-10 h-10 bg-gray-50 border-transparent focus:bg-white rounded-xl"
               />
               {invSearch && (
                 <button onClick={() => setInvSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
                   <X className="h-4 w-4 text-gray-400 hover:text-gray-600" />
                 </button>
               )}
             </div>
             
             <div className="h-8 w-px bg-gray-200 hidden sm:block"></div>
             
             <Button
               variant={showLowOnly ? 'default' : 'outline'}
               size="sm"
               onClick={() => setShowLowOnly(!showLowOnly)}
               className={`h-10 rounded-xl px-4 font-bold transition-all ${showLowOnly ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-md shadow-amber-500/20 border-transparent' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}
             >
               <Filter className="h-4 w-4 mr-2" />
               Critical Stock
             </Button>
             
             <div className="flex items-center bg-gray-50 p-1 border border-gray-200 rounded-xl">
               {(['name', 'stock', 'threshold'] as const).map(s => (
                 <button
                   key={s}
                   onClick={() => setInvSort(s)}
                   className={`px-4 py-1.5 text-xs font-bold rounded-lg transition-all ${
                     invSort === s ? 'bg-white text-indigo-700 shadow-sm border border-gray-200' : 'text-gray-500 hover:text-gray-700'
                   }`}
                 >
                   {s === 'name' ? 'A-Z' : s === 'stock' ? 'Quantity' : 'Risk Level'}
                 </button>
               ))}
             </div>
           </div>
 
           {/* Sleek Inventory Table */}
           {sparePartsLoading ? (
             <div className="flex items-center justify-center py-20">
               <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
             </div>
           ) : sortedSpareParts.length === 0 ? (
             <div className="flex-1 flex flex-col items-center justify-center text-gray-400 py-20 bg-gray-50 rounded-3xl border border-dashed border-gray-200">
               <div className="w-20 h-20 bg-white rounded-full flex items-center justify-center shadow-sm mb-4">
                  <Boxes className="h-10 w-10 text-gray-300" />
               </div>
               <p className="text-xl font-bold text-gray-600">Inventory Empty</p>
               <p className="text-sm font-medium mt-1 mb-6 max-w-sm text-center">Your global component tracking system is active, but no stock has been added yet.</p>
               <Button onClick={() => setActiveView('add-stock')} className="rounded-full px-6 bg-indigo-600 hover:bg-indigo-700 font-bold shadow-md shadow-indigo-600/20">
                 <Zap className="h-4 w-4 mr-2" /> Start Rapid Entry
               </Button>
             </div>
           ) : (
             <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden shadow-sm flex-1 flex flex-col">
               {/* Header */}
               <div className="grid grid-cols-[1fr_120px_120px_140px] gap-4 px-6 py-4 bg-gray-50/80 border-b border-gray-200 text-xs font-black text-gray-500 uppercase tracking-wider sticky top-0 z-10 backdrop-blur-sm">
                 <div>Component Details</div>
                 <div className="text-right">Current Stock</div>
                 <div className="text-right">Reorder At</div>
                 <div className="text-center">System Status</div>
               </div>
 
               {/* Rows */}
               <div className="overflow-y-auto flex-1">
                 {sortedSpareParts.map(sp => {
                   const isLow = sp.stock_quantity > 0 && sp.stock_quantity <= sp.reorder_threshold;
                   const isOut = sp.stock_quantity === 0;
                   return (
                     <div key={sp.id} className="grid grid-cols-[1fr_120px_120px_140px] gap-4 px-6 py-4 border-b border-gray-100 items-center group hover:bg-gray-50/50 transition-colors">
                       <div className="min-w-0">
                         <p className="text-base font-bold text-gray-900 truncate group-hover:text-blue-700 transition-colors" title={sp.part_name}>{sp.part_name}</p>
                         {sp.description && sp.description !== sp.part_name && (
                           <p className="text-xs font-medium text-gray-400 truncate mt-0.5" title={sp.description}>{sp.description}</p>
                         )}
                       </div>
                       <div className="text-right flex items-center justify-end gap-2">
                         <span className={`font-black text-lg ${isOut ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-emerald-600'}`}>
                           {sp.stock_quantity}
                         </span>
                       </div>
                       <div className="text-right font-bold text-gray-400">
                          {sp.reorder_threshold}
                       </div>
                       <div className="flex justify-center">
                         {isOut ? (
                           <div className="flex items-center gap-1.5 bg-red-50 text-red-700 px-3 py-1 rounded-lg font-bold text-xs border border-red-100">
                              <span className="relative flex h-2 w-2">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                              </span>
                              CRITICAL
                           </div>
                         ) : isLow ? (
                           <div className="flex items-center gap-1.5 bg-amber-50 text-amber-700 px-3 py-1 rounded-lg font-bold text-xs border border-amber-100">
                              <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                              WARNING
                           </div>
                         ) : (
                           <div className="flex items-center gap-1.5 bg-emerald-50 text-emerald-700 px-3 py-1 rounded-lg font-bold text-xs border border-emerald-100">
                              <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                              HEALTHY
                           </div>
                         )}
                       </div>
                     </div>
                   );
                 })}
               </div>
             </div>
           )}
         </div>
       )}
    </div>
  );
}

// Simple icon for the modal
function DatabaseIcon(props: any) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5V19A9 3 0 0 0 21 19V5" />
      <path d="M3 12A9 3 0 0 0 21 12" />
    </svg>
  );
}
