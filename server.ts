import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import path from 'path';
import express from 'express';
import type { Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import {
  GoogleGenAI,
  Modality,
  ThinkingLevel,
  Type,
  type FunctionDeclaration,
  type LiveServerMessage,
} from '@google/genai';

const PORT = Number(process.env.PORT || 3000);
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

function createGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'lookup_customer_and_stock',
    description:
      'Lookup a customer Khata account (current_udhaar_balance, credit_limit) and/or an inventory SKU (stock_qty, unit_price, reorder_threshold) in real time. MUST be called immediately whenever a customer or product is mentioned.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        customer_name: {
          type: Type.STRING,
          description: 'Customer or shop name mentioned by user (e.g., Sharma General Store, Verma Traders).',
        },
        item_name: {
          type: Type.STRING,
          description: 'Item name, SKU, or Hinglish alias (e.g., Basmati chawal, Fortune oil, refined oil, atta, cheeni).',
        },
      },
    },
  },
  {
    name: 'check_business_policy',
    description:
      'Checks credit limit breach (current_udhaar_balance + total_amount > credit_limit), single order limit (> 50000 INR), duplicate transactions within 5 minutes, and stock sufficiency.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        customer_id: { type: Type.STRING, description: 'Matched customer document ID.' },
        item_sku: { type: Type.STRING, description: 'Matched inventory SKU.' },
        qty: { type: Type.NUMBER, description: 'Requested quantity in item units.' },
        total_amount: { type: Type.NUMBER, description: 'Total bill or payment amount in INR.' },
        tx_type: {
          type: Type.STRING,
          description: 'Transaction type: UDHAAR, JAMA, or CASH_SALE.',
        },
      },
      required: ['customer_id', 'total_amount', 'tx_type'],
    },
  },
  {
    name: 'request_human_approval',
    description:
      'Triggers a real-time Human-in-the-Loop (HITL) manager approval card on screen whenever credit limit is exceeded or single order exceeds 50,000 INR.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        customer_id: { type: Type.STRING },
        customer_name: { type: Type.STRING },
        item_sku: { type: Type.STRING },
        item_name: { type: Type.STRING },
        unit: { type: Type.STRING },
        qty: { type: Type.NUMBER },
        total_amount: { type: Type.NUMBER },
        tx_type: { type: Type.STRING },
        reason: { type: Type.STRING, description: 'Clear policy breach explanation.' },
      },
      required: [
        'customer_id',
        'customer_name',
        'item_sku',
        'item_name',
        'qty',
        'total_amount',
        'tx_type',
        'reason',
      ],
    },
  },
  {
    name: 'execute_ledger_and_inventory_tx',
    description:
      'Atomically updates customer Khata balance, deducts inventory stock, and writes a transaction ledger record. ONLY call after spoken read-back confirmation and user explicit approval (user_confirmed=true).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        customer_id: { type: Type.STRING },
        item_sku: { type: Type.STRING },
        qty: { type: Type.NUMBER },
        total_amount: { type: Type.NUMBER },
        tx_type: { type: Type.STRING, description: 'UDHAAR, JAMA, or CASH_SALE.' },
        user_confirmed: {
          type: Type.BOOLEAN,
          description: 'Must be true only after explicit spoken user confirmation.',
        },
        note: { type: Type.STRING },
      },
      required: ['customer_id', 'total_amount', 'tx_type', 'user_confirmed'],
    },
  },
  {
    name: 'create_supplier_restock',
    description:
      'Creates a supplier restock purchase order automatically when remaining stock drops below reorder_threshold or when requested.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        item_sku: { type: Type.STRING },
        item_name: { type: Type.STRING },
        order_qty: { type: Type.NUMBER },
        reason: { type: Type.STRING },
      },
      required: ['item_sku', 'reason'],
    },
  },
  {
    name: 'undo_last_transaction',
    description:
      'Atomically rolls back the latest completed ledger and inventory transaction when user says "galti ho gayi", "undo karo", or "pichli entry cancel karo".',
    parameters: {
      type: Type.OBJECT,
      properties: {
        reason: { type: Type.STRING },
      },
    },
  },
];

function buildBolKhataSystemInstruction(catalogContext?: string): string {
  return `You are "BolKhata", a fast, action-oriented real-time voice operations agent for an Indian wholesale & kirana distribution counter. You execute real business transactions across live inventory, customer credit ledgers (Khata/Udhaar), and supplier restock systems.

CORE LANGUAGE & VOICE RULES:
1. Fluency: Speak natural, warm, concise Hinglish (Hindi + English code-switching) matching the user's language mix. Understand Indian regional trade terms: "bori" (sack/bag), "peti" (carton/box), "udhaar" (credit debit), "jama" (payment received), "parchi" (receipt), "maal" (stock/goods).
2. Brevity: Keep spoken responses under 2 sentences unless reading back transaction details. Never use robotic filler phrases.
3. Interruptions: If the user interrupts you mid-sentence or corrects a number/item, immediately accept the correction without apologizing excessively and recalculate using the updated value.
4. Acoustic & Noise Resilience: If background noise or unclear speech makes a quantity, product name, or customer name ambiguous, NEVER guess. Ask a direct, short clarifying question (e.g., "Aapne 15 peti kaha ya 50 peti? Ek baar confirm kijiye.").

MANDATORY AGENTIC WORKFLOW & SAFETY RULES:
1. Lookup First: Whenever a user mentions a customer or item, IMMEDIATELY call \`lookup_customer_and_stock\` before quoting prices, stock availability, or balances.
2. Policy Check & Exception Enforcement:
   - Always call \`check_business_policy\` before finalizing an order.
   - If \`requires_human_approval\` is true (credit limit exceeded OR single order > ₹50,000), DO NOT call \`execute_ledger_and_inventory_tx\`. Instead, immediately call \`request_human_approval\` and inform the user by voice that Owner/Manager approval has been triggered on screen.
   - If \`insufficient_stock\` is true (\`stock_qty < requested_qty\`), inform the user of the exact available stock and offer to log a partial order + trigger a supplier restock.
   - If \`duplicate_detected\` is true, warn the user clearly before proceeding.
3. Transaction Safety (Read-Back Confirmation):
   - For all valid, within-policy writes, you MUST perform a clear spoken read-back: state the Customer Name, Item & Quantity, Total Rupee Amount, and Transaction Type (Udhaar/Jama/Cash), plus remaining stock if relevant, and ask "Kya main confirm karun?"
   - ONLY call \`execute_ledger_and_inventory_tx\` with \`user_confirmed: true\` AFTER the user explicitly confirms ("Haan", "Confirm", "Theek hai", "Kar do").
4. Automatic Multi-Step Restock: After executing a sale, if \`below_reorder_threshold\` is true, automatically call \`create_supplier_restock\` in the same workflow and mention the generated PO number in your final voice confirmation.
5. Voice Undo: If the user says "galti ho gayi", "undo karo", or "pichli entry cancel karo", immediately call \`undo_last_transaction\` and confirm the restored balance and stock.

PRODUCT & UNIT ALIAS DICTIONARY (LIVE COUNTER CONTEXT):
${catalogContext || 'Use lookup_customer_and_stock to inspect live customer balances and SKUs.'}`;
}

async function startServer(): Promise<void> {
  const app = express();
  app.use((req: Request, res: Response, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    }
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, hasApiKey: Boolean(GEMINI_API_KEY) });
  });

  app.post('/api/gemini-token', async (_req: Request, res: Response) => {
    if (!GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is missing in Secrets.' });
      return;
    }
    try {
      const tokenClient = new GoogleGenAI({
        apiKey: GEMINI_API_KEY,
        httpOptions: {
          apiVersion: 'v1alpha',
          headers: { 'User-Agent': 'aistudio-build' },
        },
      });
      const expireTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      const newSessionExpireTime = new Date(Date.now() + 2 * 60 * 1000).toISOString();
      const token = await tokenClient.authTokens.create({
        config: {
          uses: 1,
          expireTime,
          newSessionExpireTime,
        },
      });
      res.json({ token: token.name, expireTime });
    } catch (error) {
      console.error('Ephemeral token creation failed:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to mint ephemeral Gemini token.',
      });
    }
  });

  app.post('/api/sentiment/analyze', async (req: Request, res: Response) => {
    if (!GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is missing in Secrets.' });
      return;
    }
    try {
      const { comment, rating } = req.body as { comment?: string; rating?: number };
      if (!comment || typeof comment !== 'string') {
        res.status(400).json({ error: 'Comment is required.' });
        return;
      }

      const ai = createGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Analyze this wholesale counter operator feedback (rating ${rating ?? 5}/5): "${comment}". Classify sentiment, operational category (e.g. Voice Accuracy, Hinglish Fluency, Latency, HITL Workflow, Stock Tracking), and write a 1-sentence actionable summary.`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              sentiment: {
                type: Type.STRING,
                description: 'Must be one of POSITIVE, NEUTRAL, or FRICTION',
              },
              category: { type: Type.STRING },
              ai_summary: { type: Type.STRING },
            },
            required: ['sentiment', 'category', 'ai_summary'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim()) as {
        sentiment?: string;
        category?: string;
        ai_summary?: string;
      };
      const normalizedSentiment =
        parsed.sentiment === 'POSITIVE' || parsed.sentiment === 'NEUTRAL' || parsed.sentiment === 'FRICTION'
          ? parsed.sentiment
          : (rating ?? 5) >= 4
          ? 'POSITIVE'
          : (rating ?? 5) === 3
          ? 'NEUTRAL'
          : 'FRICTION';

      res.json({
        sentiment: normalizedSentiment,
        category: parsed.category || 'Counter Operations',
        ai_summary: parsed.ai_summary || comment.slice(0, 140),
      });
    } catch (error) {
      console.error('Sentiment analysis failed:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to analyze feedback sentiment.',
      });
    }
  });

  app.post('/api/insights/generate', async (req: Request, res: Response) => {
    if (!GEMINI_API_KEY) {
      res.status(500).json({ error: 'GEMINI_API_KEY is missing in Secrets.' });
      return;
    }
    try {
      const { customers, inventory, transactions, restocks, approvals, sentimentLogs } = req.body as {
        customers: unknown[];
        inventory: unknown[];
        transactions: unknown[];
        restocks: unknown[];
        approvals: unknown[];
        sentimentLogs: unknown[];
      };

      const ai = createGeminiClient();
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `You are an operations analyst for an Indian Kirana & Wholesale Distributor using BolKhata Live.
Analyze the following LIVE Firestore counter data and generate structured multi-channel outputs:
- Customers: ${JSON.stringify(customers ?? [])}
- Inventory: ${JSON.stringify(inventory ?? [])}
- Transactions: ${JSON.stringify(transactions ?? [])}
- Restocks: ${JSON.stringify(restocks ?? [])}
- Approvals: ${JSON.stringify(approvals ?? [])}
- Operator Feedback: ${JSON.stringify(sentimentLogs ?? [])}

Produce:
1. whatsapp_reminder: A polite, warm Hinglish WhatsApp payment reminder for the customer with the highest current_udhaar_balance.
2. distributor_po: A concise formal English distributor Purchase Order email/message for the most urgent low-stock item or latest restock PO.
3. eod_summary: Owner End-of-Day financial & risk summary computed strictly from the provided live data.
4. sentiment_digest: Digest of operator feedback & friction points.`,
        config: {
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              whatsapp_reminder: {
                type: Type.OBJECT,
                properties: {
                  customer_name: { type: Type.STRING },
                  phone: { type: Type.STRING },
                  message_hinglish: { type: Type.STRING },
                },
                required: ['customer_name', 'phone', 'message_hinglish'],
              },
              distributor_po: {
                type: Type.OBJECT,
                properties: {
                  supplier_name: { type: Type.STRING },
                  subject: { type: Type.STRING },
                  body_english: { type: Type.STRING },
                  items_summary: { type: Type.STRING },
                },
                required: ['supplier_name', 'subject', 'body_english', 'items_summary'],
              },
              eod_summary: {
                type: Type.OBJECT,
                properties: {
                  headline: { type: Type.STRING },
                  total_volume_inr: { type: Type.NUMBER },
                  credit_issued_inr: { type: Type.NUMBER },
                  collections_inr: { type: Type.NUMBER },
                  risk_alerts: { type: Type.ARRAY, items: { type: Type.STRING } },
                  action_items: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
                required: [
                  'headline',
                  'total_volume_inr',
                  'credit_issued_inr',
                  'collections_inr',
                  'risk_alerts',
                  'action_items',
                ],
              },
              sentiment_digest: {
                type: Type.OBJECT,
                properties: {
                  overall_mood: { type: Type.STRING },
                  top_praise: { type: Type.STRING },
                  top_friction_point: { type: Type.STRING },
                  recommended_tweak: { type: Type.STRING },
                },
                required: ['overall_mood', 'top_praise', 'top_friction_point', 'recommended_tweak'],
              },
            },
            required: ['whatsapp_reminder', 'distributor_po', 'eod_summary', 'sentiment_digest'],
          },
        },
      });

      const report = JSON.parse((response.text ?? '{}').trim());
      res.json(report);
    } catch (error) {
      console.error('Insights generation failed:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to generate insights report.',
      });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: process.env.DISABLE_HMR !== 'true' },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws/live' });

  wss.on('connection', (clientWs: WebSocket) => {
    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let isClosed = false;

    const safeSend = (payload: Record<string, unknown>) => {
      if (!isClosed && clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify(payload));
      }
    };

    clientWs.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          data?: string;
          text?: string;
          catalogContext?: string;
          id?: string;
          name?: string;
          response?: Record<string, unknown>;
          approval?: {
            approval_id: string;
            customer_name: string;
            item_name: string;
            unit: string;
            qty: number;
            total_amount: number;
            status: string;
            restock_po?: string;
          };
        };

        if (msg.type === 'start_session') {
          if (!GEMINI_API_KEY) {
            safeSend({
              type: 'error',
              message: 'GEMINI_API_KEY is not configured in Settings > Secrets.',
            });
            return;
          }

          if (liveSession) {
            try {
              liveSession.close();
            } catch {
              // ignore
            }
          }

          const ai = createGeminiClient();
          liveSession = await ai.live.connect({
            model: 'gemini-3.8-live',
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              tools: [{ functionDeclarations: TOOL_DECLARATIONS }],
              systemInstruction: buildBolKhataSystemInstruction(msg.catalogContext),
            },
            callbacks: {
              onopen: () => {
                safeSend({ type: 'session_ready' });
              },
              onmessage: (liveMsg: LiveServerMessage) => {
                const sc = liveMsg.serverContent;
                if (sc?.inputTranscription?.text) {
                  safeSend({ type: 'input_transcript', text: sc.inputTranscription.text });
                }
                if (sc?.outputTranscription?.text) {
                  safeSend({ type: 'output_transcript', text: sc.outputTranscription.text });
                }
                for (const part of sc?.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    safeSend({ type: 'audio', data: part.inlineData.data });
                  }
                }
                if (sc?.interrupted) {
                  safeSend({ type: 'interrupted' });
                }
                if (sc?.turnComplete) {
                  safeSend({ type: 'turn_complete' });
                }
                for (const call of liveMsg.toolCall?.functionCalls ?? []) {
                  safeSend({
                    type: 'tool_call',
                    id: call.id,
                    name: call.name,
                    args: call.args ?? {},
                  });
                }
              },
              onerror: (err) => {
                console.error('Gemini Live session error:', err);
                safeSend({
                  type: 'error',
                  message: err instanceof Error ? err.message : 'Gemini Live WebSocket error',
                });
              },
              onclose: (ev) => {
                safeSend({
                  type: 'session_closed',
                  reason: ev?.reason || 'Live session closed',
                });
              },
            },
          });
          return;
        }

        if (!liveSession) return;

        if (msg.type === 'audio' && msg.data) {
          liveSession.sendRealtimeInput({
            audio: { data: msg.data, mimeType: 'audio/pcm;rate=16000' },
          });
        } else if (msg.type === 'text_turn' && msg.text) {
          liveSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: msg.text }] }],
            turnComplete: true,
          });
        } else if (msg.type === 'tool_result' && msg.id && msg.name) {
          liveSession.sendToolResponse({
            functionResponses: [
              {
                id: msg.id,
                name: msg.name,
                response: msg.response ?? {},
              },
            ],
          });
        } else if (msg.type === 'hitl_resolution' && msg.approval) {
          const a = msg.approval;
          const prompt =
            a.status === 'APPROVED'
              ? `SYSTEM UPDATE: Owner has APPROVED override ${a.approval_id} for ${a.customer_name} (${a.qty} ${a.unit} ${a.item_name}, Rs ${a.total_amount}). The Khata ledger and inventory have been updated in Firestore${a.restock_po ? `, and distributor restock ${a.restock_po} was automatically created` : ''}. Immediately announce this confirmation in warm concise Hinglish.`
              : `SYSTEM UPDATE: Owner has REJECTED override ${a.approval_id} for ${a.customer_name}. Politely inform the counter staff in Hinglish that the owner declined the credit override.`;

          liveSession.sendClientContent({
            turns: [{ role: 'user', parts: [{ text: prompt }] }],
            turnComplete: true,
          });
        }
      } catch (err) {
        console.error('WS message handler error:', err);
        safeSend({
          type: 'error',
          message: err instanceof Error ? err.message : 'WebSocket processing error',
        });
      }
    });

    clientWs.on('close', () => {
      isClosed = true;
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore
        }
        liveSession = null;
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`BolKhata Live server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
