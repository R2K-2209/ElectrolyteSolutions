'use server';

import { GoogleGenAI, Type, Schema } from '@google/genai';
import { getAllSpareParts } from '@/lib/pg-db';
import fs from 'fs';

const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY });

// Define the expected JSON output schema
const InvoiceSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    vendorName: {
      type: Type.STRING,
      description: "The name of the vendor/supplier from the invoice.",
    },
    invoiceNo: {
      type: Type.STRING,
      description: "The invoice number.",
    },
    receivedDate: {
      type: Type.STRING,
      description: "The date of the invoice in YYYY-MM-DD format.",
    },
    items: {
      type: Type.ARRAY,
      description: "The line items found in the invoice.",
      items: {
        type: Type.OBJECT,
        properties: {
          originalName: {
            type: Type.STRING,
            description: "The exact name or description of the item as written on the invoice.",
          },
          matchedSparePartId: {
            type: Type.NUMBER,
            description: "The ID of the BEST matching component from the master database list provided. If no confident match is found, return null.",
            nullable: true,
          },
          matchedPartName: {
             type: Type.STRING,
             description: "The name of the matched component from the master database. If no match, leave null.",
             nullable: true,
          },
          quantity: {
            type: Type.NUMBER,
            description: "The total quantity of the item.",
          },
          unitCost: {
            type: Type.NUMBER,
            description: "The unit price/cost of the item. Do not include currency symbols.",
          },
        },
        required: ["originalName", "quantity", "unitCost"],
      },
    },
  },
  required: ["vendorName", "invoiceNo", "receivedDate", "items"],
};

export async function parseInvoiceWithAIAction(formData: FormData) {
  const debugLog: string[] = [];
  debugLog.push(`[${new Date().toISOString()}] parseInvoiceWithAIAction called`);

  try {
    const file = formData.get('file') as File;
    if (!file) {
      return { success: false, error: 'No file provided' };
    }
    debugLog.push(`File: ${file.name}, size: ${file.size}, type: ${file.type}`);

    // 1. Fetch ONLY real spare_parts (positive IDs) for matching
    let realParts: { id: number; part_name: string; description: string | null }[] = [];
    try {
      const allParts = await getAllSpareParts();
      debugLog.push(`getAllSpareParts returned ${allParts.length} parts`);
      // Filter to only real spare_parts (positive IDs) — getAllSpareParts() also returns
      // unmatched BOM entries with negative IDs which would corrupt our matching
      realParts = allParts.filter(p => p.id > 0).map(p => ({
        id: p.id,
        part_name: p.part_name,
        description: p.description,
      }));
      debugLog.push(`After filtering positive IDs: ${realParts.length} real spare parts`);
    } catch (dbErr: any) {
      debugLog.push(`getAllSpareParts ERROR: ${dbErr.message}`);
    }

    // Fallback: if getAllSpareParts returned 0, try direct pg query
    if (realParts.length === 0) {
      debugLog.push('FALLBACK: getAllSpareParts returned 0 parts, trying direct pg query...');
      try {
        const { Pool } = await import('pg');
        const fallbackPool = new Pool({
          host: process.env.PG_HOST?.replace(/'/g, '') || 'localhost',
          port: parseInt(process.env.PG_PORT || '5432'),
          user: process.env.PG_USER?.replace(/'/g, '') || 'postgres',
          password: process.env.PG_PASSWORD?.replace(/'/g, '') || '2209',
          database: process.env.PG_DATABASE?.replace(/'/g, '') || 'nexscan',
          ssl: false,
        });
        const dbResult = await fallbackPool.query('SELECT id, part_name, description FROM spare_parts ORDER BY id');
        realParts = dbResult.rows;
        debugLog.push(`Fallback query returned ${realParts.length} parts`);
        await fallbackPool.end();
      } catch (fallbackErr: any) {
        debugLog.push(`Fallback DB ERROR: ${fallbackErr.message}`);
      }
    }

    debugLog.push(`Parts for matching: ${JSON.stringify(realParts.map(p => ({ id: p.id, name: p.part_name, desc: p.description })))}`);

    const partsContext = realParts.map(p => `ID: ${p.id} | Name: ${p.part_name} | Desc: ${p.description || ''}`).join('\n');

    // 2. Prepare file for Gemini
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    const documentPart = {
      inlineData: {
        data: buffer.toString('base64'),
        mimeType: file.type || 'application/pdf',
      },
    };

    const prompt = `
You are an expert inventory data extraction assistant.
Attached is a vendor invoice document (PDF or Image).

1. Extract the Vendor Name, Invoice Number, and Date (format as YYYY-MM-DD).
2. Extract all line items (Description, Quantity, and Unit Cost).
3. SMART MATCHING: For each line item, try to find the BEST matching component from our internal Master Database list provided below.
Vendors often use shorthand, alternative names, or manufacturer part numbers. For example, "Red 5mm LED" might match "LED INDICATOR LAMP 5mm", or "R6-5H 2Pin" might match "TACTILE PUSH BUTTON SWITCH". 
CRITICAL INSTRUCTION FOR MATCHING: You MUST be extremely smart and aggressive in assigning parts to the existing database. The biller part names will almost never match our database names exactly. 
Use your engineering knowledge to deduce if a component on the bill is functionally identical to one in the database (e.g. matching capacitance, voltage, package size, component type). 
If there is ANY reasonable match, assign it! Only return null for 'matchedSparePartId' if you are 100% certain it is a completely new component that we do not have.

MASTER DATABASE COMPONENTS:
${partsContext}
`;

    // 3. Call Gemini API
    debugLog.push('Calling Gemini API...');
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        documentPart,
        prompt
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: InvoiceSchema,
        temperature: 0.1,
      }
    });

    if (!response.text) {
        throw new Error('AI returned an empty response');
    }

    debugLog.push('Gemini API returned successfully');
    const parsedData = JSON.parse(response.text);
    debugLog.push(`AI returned ${parsedData.items?.length || 0} items`);

    // Log what the AI returned before fallback
    if (parsedData.items) {
      for (const item of parsedData.items) {
        debugLog.push(`  AI result: "${item.originalName}" -> matchedId=${item.matchedSparePartId}, matchedName=${item.matchedPartName}`);
      }
    }

    // 4. Fallback: For any item the AI did NOT match, try local string matching
    if (parsedData.items && Array.isArray(parsedData.items) && realParts.length > 0) {
      debugLog.push(`Running fallback matching against ${realParts.length} real parts...`);

      for (const item of parsedData.items) {
        if (!item.matchedSparePartId || item.matchedSparePartId <= 0) {
          const original = (item.originalName || "").toLowerCase().trim();
          
          if (original.length < 3) {
            debugLog.push(`  Skipping "${item.originalName}" (too short)`);
            continue;
          }

          let bestMatch: typeof realParts[0] | null = null;

          for (const p of realParts) {
             const pName = (p.part_name || "").toLowerCase().trim();
             const pDesc = (p.description || "").toLowerCase().trim();

             // Exact match on name or description
             if (original === pName || (pDesc.length > 0 && original === pDesc)) {
                bestMatch = p;
                debugLog.push(`  EXACT match: "${item.originalName}" -> "${p.part_name}" (id=${p.id})`);
                break;
             }
             // Original contains the part name or description
             if (pName.length > 3 && original.includes(pName)) {
                bestMatch = p;
                debugLog.push(`  CONTAINS match (original includes pName): "${item.originalName}" -> "${p.part_name}" (id=${p.id})`);
                break;
             }
             if (pDesc.length > 3 && original.includes(pDesc)) {
                bestMatch = p;
                debugLog.push(`  CONTAINS match (original includes pDesc): "${item.originalName}" -> "${p.part_name}" (id=${p.id})`);
                break;
             }
             // Part name or description contains the original
             if (pName.includes(original)) {
                bestMatch = p;
                debugLog.push(`  CONTAINS match (pName includes original): "${item.originalName}" -> "${p.part_name}" (id=${p.id})`);
                break;
             }
             if (pDesc.length > 0 && pDesc.includes(original)) {
                bestMatch = p;
                debugLog.push(`  CONTAINS match (pDesc includes original): "${item.originalName}" -> "${p.part_name}" (id=${p.id})`);
                break;
             }
          }
          
          if (bestMatch) {
            item.matchedSparePartId = bestMatch.id;
            item.matchedPartName = bestMatch.part_name;
          } else {
            debugLog.push(`  NO match found for: "${item.originalName}"`);
          }
        } else {
          debugLog.push(`  Already matched by AI: "${item.originalName}" -> id=${item.matchedSparePartId}`);
        }
      }
    } else {
      debugLog.push(`Skipping fallback: items=${parsedData.items?.length}, realParts=${realParts.length}`);
    }

    // Final state
    debugLog.push('--- FINAL RESULT ---');
    if (parsedData.items) {
      for (const item of parsedData.items) {
        debugLog.push(`  "${item.originalName}" -> matchedId=${item.matchedSparePartId}, matchedName=${item.matchedPartName}`);
      }
    }

    try {
      fs.writeFileSync('debug-ai.log', debugLog.join('\n') + '\n');
    } catch(e) {}

    return { success: true, data: parsedData };
  } catch (error: any) {
    console.error('AI Parsing Error:', error);
    debugLog.push(`FATAL ERROR: ${error.message}`);
    try {
      fs.writeFileSync('debug-ai.log', debugLog.join('\n') + '\n');
    } catch(e) {}
    return { success: false, error: error.message || 'Failed to parse invoice with AI' };
  }
}
