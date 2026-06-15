'use server';

import type { StockItem } from '@/lib/pg-db';

// ============================================================================
// INVENTORY SERVER ACTIONS
// ============================================================================

/**
 * Get all PCB products with their BOM component count.
 */
export async function getProductsWithBomCountAction() {
  try {
    const { getProductsWithBomCount } = await import('@/lib/pg-db');
    const products = await getProductsWithBomCount();
    return { success: true, data: products };
  } catch (error) {
    console.error('Error in getProductsWithBomCountAction:', error);
    return { success: false, data: [], error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get all BOM components for a specific product (PCB).
 */
export async function getBomComponentsByProductIdAction(productId: number) {
  try {
    const { getBomComponentsByProductId } = await import('@/lib/pg-db');
    const components = await getBomComponentsByProductId(productId);
    return { success: true, data: components };
  } catch (error) {
    console.error('Error in getBomComponentsByProductIdAction:', error);
    return { success: false, data: [], error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get all spare parts from inventory, with optional filters.
 */
export async function getAllSparePartsAction(options?: { lowStockOnly?: boolean; search?: string }) {
  try {
    const { getAllSpareParts } = await import('@/lib/pg-db');
    const parts = await getAllSpareParts(options);
    return { success: true, data: parts };
  } catch (error) {
    console.error('Error in getAllSparePartsAction:', error);
    return { success: false, data: [], error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Batch add stock for multiple BOM components.
 * This is the main "Add Stock" operation called from the UI.
 */
export async function addStockForComponentsAction(items: StockItem[], addedBy?: string) {
  try {
    const { addStockForComponents } = await import('@/lib/pg-db');
    const result = await addStockForComponents(items, addedBy);
    return result;
  } catch (error) {
    console.error('Error in addStockForComponentsAction:', error);
    return { success: false, count: 0, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get inventory summary statistics.
 */
export async function getInventorySummaryAction() {
  try {
    const { getInventorySummary } = await import('@/lib/pg-db');
    const summary = await getInventorySummary();
    return { success: true, data: summary };
  } catch (error) {
    console.error('Error in getInventorySummaryAction:', error);
    return {
      success: false,
      data: {
        totalUniqueComponents: 0,
        totalInStock: 0,
        totalLowStock: 0,
        totalOutOfStock: 0,
        totalStockValue: 0,
        todayTransactions: 0,
      },
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get recent inventory transactions.
 */
export async function getInventoryTransactionsAction(sparePartId?: number, limit?: number) {
  try {
    const { getInventoryTransactions } = await import('@/lib/pg-db');
    const transactions = await getInventoryTransactions(sparePartId, limit);
    return { success: true, data: transactions };
  } catch (error) {
    console.error('Error in getInventoryTransactionsAction:', error);
    return { success: false, data: [], error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// ============================================================================
// PURCHASE ORDER / RECEIPT ACTIONS
// ============================================================================

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { StockReceiptInput } from '@/lib/pg-db';

/**
 * Handle Purchase Order Intake
 */
export async function addStockReceiptAction(receipt: StockReceiptInput, addedBy?: string) {
  try {
    const { addStockReceipt } = await import('@/lib/pg-db');
    const result = await addStockReceipt(receipt, addedBy);
    return result;
  } catch (error) {
    console.error('Error in addStockReceiptAction:', error);
    return { success: false, count: 0, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Upload an invoice PDF
 */
export async function uploadInvoicePDFAction(formData: FormData) {
  try {
    const file = formData.get('file') as File;
    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Create a safe filename with timestamp to prevent overwrites
    const originalName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const safeName = `${Date.now()}-${originalName}`;
    
    // Save to public directory so it can be served by Next.js
    const uploadDir = join(process.cwd(), 'public', 'uploads', 'invoices');
    
    // Ensure directory exists
    try {
      await mkdir(uploadDir, { recursive: true });
    } catch (e) {
      // Ignore if exists
    }

    const filepath = join(uploadDir, safeName);
    await writeFile(filepath, buffer);

    // Return the relative URL path to save in DB
    const relativePath = `/uploads/invoices/${safeName}`;
    return { success: true, path: relativePath };

  } catch (error) {
    console.error('Error uploading invoice:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Upload failed' };
  }
}

export async function getStockReceiptsAction() {
  try {
    const { getStockReceipts } = await import('@/lib/pg-db');
    const receipts = await getStockReceipts();
    return { success: true, data: receipts };
  } catch (error) {
    console.error('Error in getStockReceiptsAction:', error);
    return { success: false, data: [], error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export async function getStockReceiptDetailsAction(receiptId: number) {
  try {
    const { getStockReceiptDetails } = await import('@/lib/pg-db');
    const details = await getStockReceiptDetails(receiptId);
    return { success: true, data: details };
  } catch (error) {
    console.error('Error in getStockReceiptDetailsAction:', error);
    return { success: false, data: [], error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
