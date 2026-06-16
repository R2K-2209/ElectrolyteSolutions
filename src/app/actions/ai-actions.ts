'use server';

import { GoogleGenAI, Type, Schema } from '@google/genai';
import { getAllSpareParts } from '@/lib/pg-db';

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
  try {
    const file = formData.get('file') as File;
    if (!file) {
      return { success: false, error: 'No file provided' };
    }

    // 1. Fetch Master Component List
    const allParts = await getAllSpareParts();
    const partsContext = allParts.map(p => `ID: ${p.id} | Name: ${p.part_name} | Desc: ${p.description || ''}`).join('\n');

    // 2. Prepare file for Gemini
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    // We send the file as an inline part
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
If you find a highly likely match based on your engineering knowledge, return its 'matchedSparePartId' and 'matchedPartName'. If there is no good match, return null for both.

MASTER DATABASE COMPONENTS:
${partsContext}
`;

    // 3. Call Gemini API
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        documentPart,
        prompt
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: InvoiceSchema,
        temperature: 0.1, // Low temperature for factual extraction
      }
    });

    if (!response.text) {
        throw new Error('AI returned an empty response');
    }

    const parsedData = JSON.parse(response.text);

    return { success: true, data: parsedData };
  } catch (error: any) {
    console.error('AI Parsing Error:', error);
    return { success: false, error: error.message || 'Failed to parse invoice with AI' };
  }
}
