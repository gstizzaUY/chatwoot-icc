import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import crypto from 'crypto';
import OpenAI from 'openai';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { makeChatwoot, buildExportFile } from './exportConversationsController.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXPORTS_DIR = path.resolve(__dirname, '..', 'exports');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 120000, maxRetries: 2 });
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';

const TEAM_LABELS = {
    'ventas':                     'Ventas iChef',
    'pre-ventas':                 'Pre-Ventas iChef',
    'satisfacción del cliente':   'Post-Venta iChef',
    'portal':                     'Portal iChef',
    'sin_equipo':                 'Sin equipo asignado',
    'todos':                      'Todos los Canales',
};

const TEAM_KEY_TO_EXCEL = {
    ventas:    'ventas',
    preventa:  'pre-ventas',
    postventa: 'satisfacción del cliente',
    portal:    'portal',
};

function extractRecommendedTo(text) {
    const patterns = [
        /recomend[éeoóaí]?(?:\s+\w+){0,3}\s+a\s+([^,.;:!?\n]{2,60})/i,
        /recomendar(?:\s+\w+){0,3}\s+a\s+([^,.;:!?\n]{2,60})/i,
        /recomiendo(?:\s+\w+){0,3}\s+a\s+([^,.;:!?\n]{2,60})/i,
        /recomendó(?:\s+\w+){0,3}\s+a\s+([^,.;:!?\n]{2,60})/i,
    ];
    for (const re of patterns) {
        const m = text.match(re);
        if (m) {
            let name = m[1].trim();
            name = name.replace(/^(?:mi|tu|su|un|una|el|la|los|las|nuestro|nuestra|vuestro|vuestra)\s+/i, '');
            name = name.replace(/^(?:amigo|amiga|hermano|hermana|conocido|conocida|vecino|vecina|compañero|compañera|colega|cliente|pareja|novio|novia|primo|prima)\s+/i, '');
            name = name.trim();
            if (name.length > 2) return name;
        }
    }
    return null;
}

const TOPIC_TRACKING = {
    'satisfacción del cliente': [
        { label: 'Referidos', keywords: ['referido', 'referidos', 'programa de referidos', 'recomendar', 'recomendé', 'recomendó', 'recomendamos', 'recomendaron', 'recomendado', 'recomendación', 'recomendaciones', 'recomiendo', 'recomendarle', 'recomendaste'], extract: extractRecommendedTo },
        { label: 'Recomendaciones a potenciales clientes', keywords: ['potencial cliente', 'potenciales clientes', 'amigo interesado', 'conocido quiere', 'alguien más quiere', 'recomendar iChef', 'recomendé iChef', 'recomendó iChef'], extract: extractRecommendedTo },
    ],
    'ventas': [
        { label: 'iChef Cuotas', keywords: ['ichef cuotas', 'cuotas sin tarjeta', 'plan de cuotas', 'financiación propia', 'ichefcuotas', 'plan propio'] },
        { label: 'Financiación', keywords: ['financiación', 'financiacion', 'plan de financiación', 'pago en cuotas', 'cuotas', 'tarjeta de crédito', 'tarjeta de credito', 'débito', 'debito'] },
    ],
    'pre-ventas': [
        { label: 'iChef Cuotas', keywords: ['ichef cuotas', 'cuotas sin tarjeta', 'plan de cuotas', 'financiación propia', 'ichefcuotas', 'plan propio'] },
        { label: 'Financiación', keywords: ['financiación', 'financiacion', 'plan de financiación', 'pago en cuotas', 'cuotas', 'tarjeta de crédito', 'tarjeta de credito', 'débito', 'debito'] },
    ],
};

const PIPELINE_STAGES = ['exportando', 'analizando', 'completado'];

const jobs = new Map();

setInterval(() => {
    const FOUR_HOURS = 4 * 60 * 60 * 1000;
    const now = Date.now();
    for (const [jobId, job] of jobs.entries()) {
        if (now - job.createdAt > FOUR_HOURS) {
            if (job.result?.filePath && fs.existsSync(job.result.filePath)) fs.unlink(job.result.filePath, () => {});
            job.result?.reports?.forEach(r => { if (r.path && fs.existsSync(r.path)) fs.unlink(r.path, () => {}); });
            jobs.delete(jobId);
        }
    }
}, 30 * 60 * 1000);

// ─── MCP Client (for upload to NotebookLM) ──────────────────────────────────

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ─── OpenAI qualitative analysis ─────────────────────────────────────────────

async function askOpenAI(stats, cids, allConvs, allMsgs, teamLabel) {
    const total = stats.totalConvs;

    const MAX_SAMPLE = 25;
    const sampled = [...cids].sort(() => Math.random() - 0.5).slice(0, MAX_SAMPLE);
    const sampleText = sampled.map(cid => {
        const meta = allConvs.get(cid);
        const msgs = (allMsgs.get(cid) || []).slice(0, 5);
        const msgText = msgs.map(m => `${m.senderName || '?'}: ${(m.content || '').substring(0, 200)}`).join('\n');
        return `#${cid} | ${meta?.contactName || '?'} | Canal: ${meta?.inboxName || '?'} | Estado: ${meta?.status || '?'} | Agente: ${meta?.assigneeName || '?'} | Etiquetas: ${meta?.labels || '?'}\n${msgText}`;
    }).join('\n\n---\n\n');

    const perDayText = stats.perDay.slice(0, 14).map(d => `${d.day}: ${d.count}`).join(', ');
    const labelText = stats.topLabels.map(l => `${l.name}(${l.count})`).join(', ');
    const agentText = stats.topAgents.map(a => `${a.name}(${a.count})`).join(', ');
    const contactText = stats.topContacts.map(c => `${c.name}(${c.count})`).join(', ');
    const inboxText = stats.inboxCounts.map(i => `${i.name}(${i.count})`).join(', ');

    const statsText = [
        `Equipo: ${teamLabel}`,
        `Total conversaciones: ${total} | Abiertas: ${stats.openCount} | Cerradas: ${stats.closedCount}`,
        `Promedio msgs/conversacion: ${stats.avgMsgs} | Rango fechas: ${stats.dateRange}`,
        `Canales: ${inboxText}`,
        `Etiquetas: ${labelText}`,
        `Agentes: ${agentText}`,
        `Contactos frecuentes: ${contactText}`,
        `Conversaciones por dia: ${perDayText}`,
    ].join('\n');

    const system = `ERES UN ANALISTA SENIOR DE OPERACIONES para iChef, una empresa uruguaya que desarrolla y vende asistentes de cocina inteligentes. El producto estrella es iChef, un robot de cocina con pantalla de 7" que ofrece mas de 20 funciones (trocear, picar, licuar, sofreir, moler, rallar, amasar, cocinar al vapor, coccion lenta, balanza integrada, etc.). NO fríe. Precio promocional: USD 1450 (original USD 1600). Financiacion: hasta 12 cuotas sin recargo, o iChef Cuotas (plan propio sin tarjeta de credito hasta 24/48 cuotas). Portal con +2500 recetas, acceso vitalicio sin suscripcion. Garantia 24 meses. Incluye IA "Maia". Comunidad "iChef Lovers" en WhatsApp. Ventas en iChef Center, Tienda Inglesa, Geant, Mercado Libre, Santander.

ESTAS ANALIZANDO CONVERSACIONES REALES extraidas de Chatwoot (nuestro contact center). Hay canales como WhatsApp y Api (portal web). Los equipos son Ventas (pre-venta, captacion de nuevos clientes), Post-Venta (soporte, onboarding D+1/D+30/D+90, satisfaccion, fidelizacion), y Portal (comunidad iChef Lovers, recetas, contenido).

Tu rol: generar un TABLERO DE COMANDO SEMANAL que la gerencia operativa usa para tomar decisiones en tiempo real. Debes ayudarlos a detectar cuellos de botella, patrones que se repiten, casos que requieren atencion inmediata, oportunidades de mejora, y tomarle la temperatura a la operacion. Tu analisis debe ser ACCIONABLE: no solo describir lo que paso, sino proponer QUE HACER al respecto.

TU ESTILO DEBE SER COMO EL DE UN CONSULTOR ESTRATEGICO: profundo, estructurado, con datos duros y recomendaciones precisas. Cada observacion debe estar respaldada por ejemplos concretos de las conversaciones.

REGLAS ESTRICTAS:
- SIEMPRE menciona NOMBRE COMPLETO del cliente junto al ID de conversacion. Ej: "Maria Gomez (ID #13542) consulto sobre..."
- Extrae FRASES TEXTUALES entre comillas de las conversaciones reales como evidencia.
- CUANTIFICA todo con porcentajes sobre el total. Ej: "8 de ${total} conversaciones (28%) tratan sobre..."
- Diferencia entre PATRONES (cosas que se repiten consistentemente) y ANOMALIAS (casos puntuales que llaman la atencion).
- Para cada problema identificado, propone UNA ACCION CONCRETA para resolverlo.
- NO INVENTES datos. Si la muestra no tiene suficiente informacion sobre algo, indicalo claramente.
- Responde SIEMPRE en español rioplatense (Uruguay).`;

    const prompt = `Genera un TABLERO DE COMANDO SEMANAL completo para la gerencia de iChef. Analiza ${total} conversaciones reales del equipo "${teamLabel}" extraidas de Chatwoot.

ESTADISTICAS DEL PERIODO:
${statsText}

MUESTRA DE ${sampled.length} CONVERSACIONES:
${sampleText}

Genera un JSON con 3 secciones. Cada seccion debe ser EXTENSA y DETALLADA (minimo 15-20 lineas cada una). SE EXHAUSTIVO.

{
  "recetas": "TEMAS Y PATRONES DETECTADOS\\n\\n📌 MOTIVOS DE CONTACTO (top 10-15 con %):\\nPara cada motivo: porcentaje sobre el total, patron observado, y 2-3 ejemplos concretos con ID, NOMBRE y frase textual.\\n\\n📌 PRODUCTOS/SERVICIOS MENCIONADOS:\\niChef robot, accesorios (starter pack, vaporera, balanza), repuestos, portal de recetas, app iChef, comunidad iChef Lovers, garantia, servicio tecnico CNS, taller/demo, iChef Center.\\n\\n📌 ETAPA DEL CLIENTE EN EL JOURNEY:\\nLeads (primer contacto), oportunidades (interes de compra), onboarding D+1/D+30/D+90, clientes activos, referidos, clientes en riesgo.\\n\\n📌 PATRONES REPETITIVOS:\\nQue situacion, consulta o problema se repite en 3+ conversaciones.\\n\\n📌 RECLAMOS / QUEJAS / INCIDENCIAS:\\nLista cada caso concreto con ID, nombre, frase textual y accion propuesta.\\n\\n📌 CASOS DESTACADOS:\\nConversaciones que se salen de lo normal: muy positivas, muy negativas, complejas, o que revelan una oportunidad de negocio.",

  "alertas": "ALERTAS PARA LA OPERACION\\n\\n⚠️ SIN RESPUESTA DEL AGENTE:\\nLista cada conversacion donde el cliente no recibio respuesta. ID, nombre, ultimo mensaje, tiempo transcurrido.\\n\\n⚠️ INSATISFACCION DETECTADA:\\nClientes frustrados o molestos. Frase textual, ID, nombre, causa raiz inferida.\\n\\n⚠️ CASOS URGENTES:\\nProblemas tecnicos que impiden usar el robot (errores de activacion, fallas de hardware, 'no puedo usar mi iChef'), clientes pidiendo baja del servicio, reclamos formales. REQUIEREN ATENCION INMEDIATA.\\n\\n⚠️ CONTACTOS RECURRENTES:\\nClientes con 2+ conversaciones en el periodo. Indicar si es seguimiento normal de onboarding o si indica un problema cronico no resuelto.\\n\\n⚠️ SIN AGENTE ASIGNADO:\\nCuantas conversaciones no tienen agente responsable. Impacto en tiempos de respuesta.\\n\\n⚠️ CANALES CON PROBLEMAS:\\nAlgun canal muestra patron de abandono, tiempo de respuesta alto, o bajo rendimiento?\\n\\n⚠️ RIESGOS POTENCIALES:\\nSituaciones que hoy no son un problema pero podrian escalar si no se atienden.\\n\\nSi realmente no hay alertas, indica '✅ Sin alertas detectadas en el periodo analizado.'",

  "analisis": "ANALISIS PARA GERENCIA\\n\\n📊 RESUMEN EJECUTIVO (4-5 lineas):\\nRadiografia del periodo: volumen, tendencia, estado general del equipo ${teamLabel}, comparacion con lo esperado. Destaca el dato mas relevante.\\n\\n💡 INSIGHTS CLAVE (6-8):\\nHallazgos que la gerencia necesita saber. Cada insight debe:\\n- Partir de un dato concreto de la muestra\\n- Explicar POR QUE es relevante para el negocio\\n- Incluir IDs, nombres y numeros\\n- Tener un titulo en negrita que resuma el hallazgo\\n\\nEjemplo: '**Concentracion de carga en un solo agente**: Neiff Cardozo atendio 24 de 29 conversaciones (83%). Si bien el equipo es chico, esto representa un riesgo operativo: si Neiff no esta disponible, la operacion de Post-Venta se detiene.'\\n\\n🔧 RECOMENDACIONES (6-8):\\nAcciones concretas, especificas y priorizadas. Para cada una indicar:\\n- QUE hacer exactamente\\n- DONDE (canal, equipo, proceso)\\n- QUIEN deberia ejecutarlo\\n- IMPACTO ESPERADO\\n- PRIORIDAD (Alta/Media/Baja)\\n\\n🌡️ TEMPERATURA DE LA OPERACION:\\nEn escala 1-10, como esta funcionando ${teamLabel} esta semana. Justifica con 3 datos concretos de la muestra.\\n\\n📈 TENDENCIAS Y PROYECCIONES:\\nSi los datos lo permiten, proyecta que puede pasar la proxima semana y que medidas preventivas tomar."
}`;

    const completion = await openai.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 6000,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) throw new Error('OpenAI respuesta vacia');

    const parsed = JSON.parse(content);
    return {
        recetas: (parsed.recetas || 'Sin analisis de temas.').replace(/\\n/g, '\n').trim(),
        alertas: (parsed.alertas || 'Sin alertas detectadas.').replace(/\\n/g, '\n').trim(),
        analisis: (parsed.analisis || 'Sin analisis general.').replace(/\\n/g, '\n').trim(),
    };
}

async function askTopicConclusions(topicStats, allConvs, allMsgs, label) {
    if (!topicStats || topicStats.anyTopicCount === 0) return null;

    // Gather conversation summaries (last 5 messages per conversation)
    const summaries = [];
    for (const topic of topicStats.topics) {
        for (const detail of topic.details) {
            const msgs = allMsgs.get(detail.cid) || [];
            const msgText = msgs.slice(-5).map(m => `${m.senderName || '?'}: ${(m.content || '').substring(0, 200)}`).join('\n');
            summaries.push({
                cid: detail.cid,
                contactName: detail.contactName,
                topicLabel: topic.label,
                messages: msgText,
            });
        }
    }

    // Limit to avoid token overflow
    const MAX = 60;
    const toAnalyze = summaries.slice(0, MAX);

    if (toAnalyze.length === 0) return null;

    const conversationText = toAnalyze.map((s, i) =>
        `**Conv #${s.cid}** | ${s.contactName} | Tema: ${s.topicLabel}\n${s.messages}`
    ).join('\n\n---\n\n');

    const system = `Eres un analista de ventas de iChef. Para cada conversación, determina su CONCLUSIÓN. 
Usa EXACTAMENTE una de estas categorías:
- VENTA: se concretó o está muy cerca
- EVALUANDO: el cliente está considerando la compra
- SIN RESPUESTA: el cliente dejó de responder
- SOLO CONSULTA: solo pidió info, sin intención real de compra
- CALIFICADO: cliente califica para el plan/beneficio mencionado pero aún no definió
- NO CALIFICA: no aplica a este tema

Responde SOLO un JSON válido con este formato: {"conclusions":[{"cid":"13784","conclusion":"EVALUANDO"},...]}. Nada más.`;

    const user = `Analiza estas conversaciones del equipo ${label}:\n\n${conversationText}`;

    try {
        const resp = await openai.chat.completions.create({
            model: OPENAI_MODEL,
            messages: [
                { role: 'system', content: system },
                { role: 'user', content: user },
            ],
            temperature: 0.3,
            max_tokens: 2000,
        });
        const content = resp.choices[0]?.message?.content || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const map = {};
            const list = parsed.conclusions || parsed || [];
            for (const item of list) {
                if (item.cid && item.conclusion) {
                    map[String(item.cid)] = item.conclusion;
                }
            }
            return map;
        }
        return {};
    } catch (err) {
        console.error(`[Pipeline] Error OpenAI para conclusiones: ${err.message}`);
        return {};
    }
}

// ─── HTML Report Generator ───────────────────────────────────────────────────

function generateHTMLPage(teamLabel, rows, dateStr, meta) {
    // Use same Bootstrap version as Chatwoot
    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
    <meta http-equiv="Expires" content="0">
    <title>iChef Analytics — ${escapeHtml(teamLabel)}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        :root {
            --primary: #509F2C;
            --primary-light: #eef7ea;
            --secondary: #37564E;
            --secondary-light: #e8eeec;
            --coral: #FC846B;
            --coral-light: #fff0ed;
            --success: #509F2C;
            --success-light: #eef7ea;
            --warning: #FC846B;
            --warning-light: #fff0ed;
            --danger: #FC846B;
            --danger-light: #fff0ed;
            --info: #37564E;
            --info-light: #e8eeec;
            --purple: #37564E;
            --purple-light: #e8eeec;
            --dark: #373737;
            --gray: #6b7280;
            --light-bg: #f8faf7;
            --card-border: #e5ebe3;
        }
        body { background: var(--light-bg); color: var(--dark); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
        .container { max-width: 1280px; }

        .hero-i { 
            background: linear-gradient(135deg, #37564E 0%, #509F2C 100%); 
            padding: 32px 0 28px; 
            color: white; 
            box-shadow: 0 4px 20px rgba(55,86,78,0.18);
        }
        .hero-i .brand { font-size: 1.1rem; font-weight: 700; letter-spacing: 0.3px; }
        .hero-i .brand span { color: #FC846B; }
        .hero-i h1 { font-size: 1.75rem; font-weight: 700; margin-top: 18px; margin-bottom: 4px; }
        .hero-i .subtitle { opacity: .8; font-size: .9rem; color: rgba(255,255,255,.9); }
        .hero-i .date { opacity: .85; font-size: .85rem; font-weight: 500; }

        .kpi-card { 
            background: #fff; 
            border-radius: 14px; 
            padding: 20px 18px; 
            border: 1px solid var(--card-border); 
            box-shadow: 0 2px 8px rgba(55,86,78,0.06);
            transition: transform 0.15s ease, box-shadow 0.15s ease;
            height: 100%;
            position: relative;
            overflow: hidden;
        }
        .kpi-card:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(55,86,78,0.1); }
        .kpi-card::before {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 3px;
            background: var(--primary);
        }
        .kpi-card.green::before { background: var(--secondary); }
        .kpi-card.accent::before { background: var(--coral); }
        .kpi-card .kpi-val { font-size: 1.8rem; font-weight: 800; color: var(--dark); line-height: 1.2; }
        .kpi-card .kpi-lbl { font-size: .68rem; color: var(--gray); text-transform: uppercase; letter-spacing: .6px; font-weight: 700; margin-top: 6px; }
        .kpi-card.green .kpi-val { color: var(--secondary); }
        .kpi-card.accent .kpi-val { color: var(--coral); }
        .kpi-icon {
            position: absolute;
            top: 14px;
            right: 14px;
            width: 32px;
            height: 32px;
            border-radius: 8px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            font-size: 14px;
            background: var(--primary-light);
            color: var(--primary);
        }
        .kpi-card.green .kpi-icon { background: var(--secondary-light); color: var(--secondary); }
        .kpi-card.accent .kpi-icon { background: var(--coral-light); color: var(--coral); }

        .card-dash { 
            border-radius: 14px; 
            border: 1px solid var(--card-border); 
            overflow: hidden; 
            background: #fff;
            box-shadow: 0 2px 8px rgba(55,86,78,0.05);
            transition: box-shadow 0.2s ease;
            height: 100%;
            display: flex;
            flex-direction: column;
        }
        .card-dash:hover { box-shadow: 0 8px 20px rgba(55,86,78,0.1); }
        .card-dash .card-header { 
            background: #fff; 
            border-bottom: 1px solid var(--card-border); 
            font-weight: 700; 
            font-size: .92rem; 
            display: flex; 
            align-items: center; 
            gap: 10px; 
            padding: 14px 18px;
            color: var(--dark);
            flex-shrink: 0;
        }
        .card-dash .card-body { 
            padding: 14px 18px; 
            font-size: .82rem; 
            line-height: 1.5; 
            color: #2d3348; 
            overflow-wrap: break-word; 
            word-break: break-word; 
            flex: 1 1 auto;
        }
        .card-dash .card-body strong { color: var(--dark); font-weight: 700; }
        .card-dash .card-body p { margin-bottom: 0.7rem; }
        .card-dash .card-body p:last-child { margin-bottom: 0; }
        .card-dash.error { border-left: 4px solid var(--coral); }

        .icon-i { width: 34px; height: 34px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; font-size: 15px; flex-shrink: 0; }
        .icon-i.blue { background: var(--primary-light); color: var(--primary); }
        .icon-i.green { background: var(--secondary-light); color: var(--secondary); }
        .icon-i.amber { background: var(--coral-light); color: var(--coral); }
        .icon-i.purple { background: var(--secondary-light); color: var(--secondary); }
        .icon-i.teal { background: var(--info-light); color: var(--info); }
        .icon-i.red { background: var(--coral-light); color: var(--coral); }

        .subtitle { 
            font-size: .68rem; 
            font-weight: 800; 
            text-transform: uppercase; 
            letter-spacing: .6px; 
            color: var(--primary); 
            margin: 12px 0 8px; 
            padding-bottom: 4px; 
            border-bottom: 1px solid var(--primary-light);
        }
        .subtitle:first-child { margin-top: 0; }

        .mini-table { width: 100%; border-collapse: separate; border-spacing: 0; }
        .mini-table tr { border-bottom: 1px solid #f0f2f5; }
        .mini-table tr:last-child { border-bottom: none; }
        .mini-table td { padding: 7px 0; font-size: .85rem; }
        .mini-table td.lbl { color: var(--gray); }
        .mini-table td.val { color: var(--dark); font-weight: 700; text-align: right; }

        .card-list { padding-left: 0; list-style: none; margin: 6px 0 8px; }
        .card-list li { 
            position: relative; 
            padding: 4px 0 4px 16px; 
            margin-bottom: 3px; 
            font-size: .8rem; 
            overflow-wrap: break-word; 
            word-break: break-word; 
            line-height: 1.45;
        }
        .card-list li::before { 
            content: ''; 
            position: absolute; 
            left: 0; 
            top: 9px; 
            width: 6px; 
            height: 6px; 
            border-radius: 50%; 
            background: var(--primary); 
        }
        .card-list li strong { color: var(--dark); }

        .accordion-i { --bs-accordion-bg: transparent; --bs-accordion-border-width: 0; --bs-accordion-btn-padding-x: 0; --bs-accordion-btn-padding-y: 6px; --bs-accordion-btn-bg: transparent; --bs-accordion-active-bg: transparent; --bs-accordion-active-color: var(--dark); --bs-accordion-btn-focus-box-shadow: none; --bs-accordion-body-padding-x: 0; --bs-accordion-body-padding-y: 4px; }
        .accordion-i .accordion-item { background: transparent; border: none; border-bottom: 1px solid #f0f2f5; }
        .accordion-i .accordion-item:last-child { border-bottom: none; }
        .accordion-i .accordion-button { font-size: .72rem; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: var(--primary); padding-left: 0; padding-right: 0; box-shadow: none; }
        .accordion-i .accordion-button::after { width: 12px; height: 12px; background-size: 12px; }
        .accordion-i .accordion-button:not(.collapsed) { color: var(--dark); background: transparent; }
        .accordion-i .accordion-body { padding-top: 0; padding-bottom: 6px; }

        .stat-compact { display: flex; justify-content: space-between; align-items: baseline; padding: 3px 0; font-size: .75rem; border-bottom: 1px solid #f5f5f7; }
        .stat-compact:last-child { border-bottom: none; }
        .stat-compact .lbl { color: var(--gray); }
        .stat-compact .val { color: var(--dark); font-weight: 700; }
        .stat-compact .val em { color: var(--gray); font-style: normal; font-weight: 500; font-size: .68rem; }

        .mini-table { width: 100%; border-collapse: separate; border-spacing: 0; margin: 0; }
        .mini-table tr { border-bottom: 1px solid #f0f2f5; }
        .mini-table tr:last-child { border-bottom: none; }
        .mini-table td { padding: 3px 0; font-size: .73rem; }
        .mini-table td.lbl { color: var(--gray); }
        .mini-table td.val { color: var(--dark); font-weight: 700; text-align: right; }

        .stat-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-bottom: 1px solid #f0f2f5; font-size: .78rem; }
        .stat-row:last-child { border-bottom: none; }
        .stat-row .stat-label { color: var(--gray); font-size: .76rem; }
        .stat-row .stat-value { color: var(--dark); font-weight: 700; font-size: .78rem; }
        .stat-row .stat-value em { color: var(--gray); font-style: normal; font-weight: 500; font-size: .68rem; }

        .alert-box {
            background: var(--danger-light);
            border-left: 3px solid var(--danger);
            border-radius: 8px;
            padding: 10px 14px;
            color: var(--danger);
            font-size: .83rem;
            font-weight: 500;
        }

        .footer-text { color: #8b95a5; font-size: .78rem; margin-top: 20px; }

        @media (max-width: 768px) {
            .kpi-card .kpi-val { font-size: 1.5rem; }
            .hero-i h1 { font-size: 1.4rem; }
        }
    </style>
</head>
<body>
<div class="hero-i">
    <div class="container">
        <div class="d-flex justify-content-between align-items-center">
            <div class="brand"><strong>iChef</strong> <span>Analytics</span></div>
            <div class="date">${dateStr}</div>
        </div>
        <h1 class="mt-3 mb-1">${escapeHtml(teamLabel)}</h1>
        <div class="subtitle">Tablero de Comando — Análisis con IA (${OPENAI_MODEL})</div>
    </div>
</div>
<div class="container" style="margin-top:-14px">
    <div class="row g-3">
        <div class="col-6 col-md-4 col-lg"><div class="kpi-card"><span class="kpi-icon">💬</span><div class="kpi-val">${meta.totalConvs ?? '—'}</div><div class="kpi-lbl">Conversaciones</div></div></div>
        <div class="col-6 col-md-4 col-lg"><div class="kpi-card green"><span class="kpi-icon">📥</span><div class="kpi-val">${meta.openCount ?? '—'}</div><div class="kpi-lbl">Abiertas</div></div></div>
        <div class="col-6 col-md-4 col-lg"><div class="kpi-card"><span class="kpi-icon">✅</span><div class="kpi-val">${meta.closedCount ?? '—'}</div><div class="kpi-lbl">Cerradas</div></div></div>
        <div class="col-6 col-md-4 col-lg"><div class="kpi-card accent"><span class="kpi-icon">📱</span><div class="kpi-val">${meta.channels ?? '—'}</div><div class="kpi-lbl">Canales</div></div></div>
        <div class="col-6 col-md-4 col-lg"><div class="kpi-card"><span class="kpi-icon">👤</span><div class="kpi-val">${meta.agents ?? '—'}</div><div class="kpi-lbl">Agentes</div></div></div>
    </div>
    <div class="row g-4 mt-1">${rows}</div>
    <div class="text-center footer-text pb-4">iChef Analytics · Generado automáticamente · ${dateStr}</div>
</div>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>`;
}

function generateHTMLReport(teamLabel, answers, errors = {}, meta = {}, topicStats = null) {
    const sections = [
        { title: 'Volumen', key: 'volumen', icon: '📊', ic: 'blue' },
        { title: 'Seguimiento de Temas', key: 'topicTracking', icon: '🎯', ic: 'amber' },
        { title: 'Actividad', key: 'actividad', icon: '👥', ic: 'purple' },
        { title: 'Temas', key: 'recetas', icon: '💬', ic: 'teal' },
        { title: 'Alertas', key: 'alertas', icon: '⚠️', ic: 'red' },
        { title: 'Análisis General', key: 'analisis', icon: '📋', ic: 'blue' },
    ];

    const rows = sections.map(s => {
        let answer = answers[s.key] || 'Sin datos';
        if (s.key === 'topicTracking') answer = formatTopicTrackingSection(topicStats);
        const error = errors[s.key] || '';
        const isError = !answers[s.key] && error && s.key !== 'topicTracking';
        const isStat = ['volumen', 'actividad', 'topicTracking'].includes(s.key);
        const content = isStat ? answer : wrapTopicsInAccordions(s.key, formatContent(answer));
        const extraClass = s.key === 'analisis' ? ' admin-only-card' : '';
        return `
        <div class="col-12 col-md-6 col-lg-4 mb-3 d-flex align-items-stretch${extraClass}" style="min-width:0">
            <div class="card card-dash w-100${isError ? ' error' : ''}">
                <div class="card-header">
                    <span class="icon-i ${s.ic}">${s.icon}</span> ${escapeHtml(s.title)}
                </div>
                <div class="card-body d-flex flex-column">${content}</div>
                ${error ? `<div class="px-3 pb-3"><div class="text-danger small bg-danger bg-opacity-10 rounded p-2">⚠️ ${escapeHtml(error)}</div></div>` : ''}
            </div>
        </div>`;
    }).join('\n');

    const dateStr = new Date().toLocaleString('es-UY', { dateStyle: 'medium', timeStyle: 'short' });

    return generateHTMLPage(teamLabel, rows, dateStr, meta);
}

function escapeHtml(text) {
    if (typeof text !== 'string') return String(text || '');
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildAccordion(groupId, items) {
    if (!items || items.length === 0) return '';
    const list = items.map((it, idx) => {
        const id = `acc-${groupId}-${idx}`;
        return `
        <div class="accordion-item">
            <h2 class="accordion-header">
                <button class="accordion-button py-1 px-0" type="button" data-bs-toggle="collapse" data-bs-target="#${id}" aria-expanded="true" aria-controls="${id}">
                    ${escapeHtml(it.title)}
                </button>
            </h2>
            <div id="${id}" class="accordion-collapse collapse show" data-bs-parent="#accordion-${groupId}">
                <div class="accordion-body">${it.body}</div>
            </div>
        </div>`;
    }).join('');
    return `<div class="accordion accordion-flush accordion-i" id="accordion-${groupId}">${list}</div>`;
}

function extractExcerpt(text, keywords) {
    const normalizedText = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    for (const kw of keywords) {
        const normalizedKw = kw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const idx = normalizedText.indexOf(normalizedKw);
        if (idx >= 0) {
            const start = Math.max(0, idx - 60);
            const end = Math.min(text.length, idx + kw.length + 80);
            return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
        }
    }
    return text.slice(0, 120).trim() + (text.length > 120 ? '…' : '');
}

function formatContent(text) {
    if (typeof text !== 'string') return '';
    if (!text.trim()) return '<p class="text-muted fst-italic">Sin datos.</p>';

    // Escape first to avoid HTML injection, then format
    let html = escapeHtml(text.trim());

    // Bold markup
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Split into blocks separated by blank lines
    const blocks = html.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);

    const listPrefix = /^(?:[-•]|\d+[.\)])\s+/;
    const isListLine = (l) => /^[-•]\s+/.test(l) || /^\d+[.\)]\s+/.test(l);

    const out = blocks.map(block => {
        const lines = block.split('\n').map(l => l.trim()).filter(Boolean);

        // List block: every line starts with -, •, or number.
        if (lines.length > 1 && lines.every(isListLine)) {
            const items = lines.map(l => `<li>${l.replace(listPrefix, '')}</li>`).join('');
            return `<ul class="card-list">${items}</ul>`;
        }

        // Single line that looks like a heading
        if (lines.length === 1 && (
            /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9\s,:]{3,50}$/.test(lines[0]) ||
            /^.{5,60}:[ \t]*$/.test(lines[0])
        )) {
            return `<div class="subtitle">${lines[0].replace(/:$/, '')}</div>`;
        }

        // Mixed block: detect inline subtitles, lists, and paragraphs
        let inner = block;
        inner = inner.replace(/^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9\s,:]{3,50})$/gm, '<div class="subtitle">$1</div>');
        inner = inner.replace(/^(.{5,60}):[ \t]*$/gm, '<div class="subtitle">$1</div>');
        inner = inner.replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>');
        inner = inner.replace(/^\d+[.\)]\s+(.+)$/gm, '<li>$1</li>');
        // Wrap contiguous list items
        inner = inner.replace(/((?:<li>[\s\S]*?<\/li>\s*)+)/g, '<ul class="card-list">$1</ul>');
        // Convert remaining newlines to <br>
        inner = inner.replace(/\n/g, '<br>');
        // Remove <br> next to block elements
        inner = inner.replace(/(?:<br>)+<(div class="subtitle")/g, '<$1');
        inner = inner.replace(/<\/(div)>(?:<br>)+/g, '</$1>');
        inner = inner.replace(/(?:<br>)+<(ul class="card-list")/g, '<$1');
        inner = inner.replace(/<\/(ul)>(?:<br>)+/g, '</$1>');
        return `<p>${inner}</p>`;
    });

    return out.join('');
}

function wrapTopicsInAccordions(groupId, html) {
    if (!html.trim()) return html;
    // Split before each subtitle marker, keeping the marker in the token
    const tokens = html.split(/(?=<div class="subtitle">)/).map(t => t.trim()).filter(Boolean);
    if (tokens.length <= 1 && !tokens[0].startsWith('<div class="subtitle">')) {
        return html; // No topics, return as-is
    }

    const items = [];
    tokens.forEach(token => {
        const m = token.match(/^<div class="subtitle">([^<]+)<\/div>([\s\S]*)$/);
        if (m) {
            const body = m[2].trim();
            items.push({ title: m[1].trim(), body: body || '<p class="text-muted fst-italic small mb-0">Sin detalles.</p>' });
        } else {
            items.push({ title: 'General', body: token });
        }
    });

    return buildAccordion(groupId, items);
}

// ─── Export + Analysis Pipeline ──────────────────────────────────────────────

async function runPipeline(jobId, inboxIds, teamIds, agentIds, dateFrom, dateTo, teamKey, onProgress) {
    const accountId = parseInt(process.env.CHATWOOT_ACCOUNT_ID || 2);

    // ─ Step 1: Export Excel ─
    onProgress({ stage: 'exportando', message: 'Exportando conversaciones...', progress: 0 });

    const chatwoot = makeChatwoot(accountId);
    const inboxLabel = `canales_${inboxIds.join('_')}`;

    const exportResult = await buildExportFile(chatwoot, inboxIds, inboxLabel, teamIds, agentIds, (processed) => {
        onProgress({ stage: 'exportando', message: `Exportando conversaciones (${processed} procesadas)...`, progress: Math.min(95, Math.round((processed || 0) / 20)) });
    }, dateFrom, dateTo);

    const exportFilePath = exportResult.filePath;
    const exportFileName = exportResult.fileName;
    onProgress({ stage: 'exportando', message: 'Exportacion completada', progress: 100 });

    // ─ Step 2: Read Excel and group by team ─
    onProgress({ stage: 'subiendo_a_notebooklm', message: 'Leyendo conversaciones...', progress: 0 });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(exportFilePath);
    const convSheet = workbook.getWorksheet('Conversaciones');
    const msgSheet = workbook.getWorksheet('Mensajes');

    const convHeaders = {};
    convSheet.getRow(1).eachCell((cell, col) => { convHeaders[cell.value] = col; });
    const msgHeaders = {};
    msgSheet.getRow(1).eachCell((cell, col) => { msgHeaders[cell.value] = col; });
    const col = (h, name) => h[name] || 0;

    const allConvs = new Map();
    convSheet.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const cid = String(row.getCell(col(convHeaders, 'ID Conversación')).value || '');
        allConvs.set(cid, {
            teamName: String(row.getCell(col(convHeaders, 'Equipo Asignado')).value || '').trim().toLowerCase(),
            inboxName: String(row.getCell(col(convHeaders, 'Canal')).value || '').trim(),
            contactName: String(row.getCell(col(convHeaders, 'Nombre Completo')).value || ''),
            contactEmail: String(row.getCell(col(convHeaders, 'Email')).value || ''),
            status: String(row.getCell(col(convHeaders, 'Estado')).value || ''),
            createdAt: row.getCell(col(convHeaders, 'Fecha Creación')).value || '',
            assigneeName: String(row.getCell(col(convHeaders, 'Agente Asignado')).value || ''),
            labels: String(row.getCell(col(convHeaders, 'Etiquetas')).value || ''),
        });
    });

    const allMsgs = new Map();
    msgSheet.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const cid = String(row.getCell(col(msgHeaders, 'ID Conversación')).value || '');
        const content = row.getCell(col(msgHeaders, 'Contenido')).value || '';
        if (!content) return;
        if (!allMsgs.has(cid)) allMsgs.set(cid, []);
        const isPrivateVal = row.getCell(col(msgHeaders, 'Mensaje Privado')).value;
        const isPrivate = String(isPrivateVal || '').toLowerCase() === 'true' || String(isPrivateVal || '').toLowerCase() === 'sí' || isPrivateVal === true || isPrivateVal === 1;
        allMsgs.get(cid).push({
            senderName: String(row.getCell(col(msgHeaders, 'Remitente')).value || ''),
            content: String(content),
            timestamp: row.getCell(col(msgHeaders, 'Fecha/Hora')).value || '',
            isPrivate,
        });
    });

    let teams = {};
    for (const [cid, meta] of allConvs) {
        const t = meta.teamName || 'sin_equipo';
        if (!teams[t]) teams[t] = { name: t, cids: [] };
        teams[t].cids.push(cid);
    }

    // Merge conversations without a team into the largest assigned team
    // so they are not reported separately.
    if (teams['sin_equipo'] && Object.keys(teams).length > 1) {
        const assigned = Object.entries(teams).filter(([key]) => key !== 'sin_equipo');
        const largest = assigned.sort((a, b) => b[1].cids.length - a[1].cids.length)[0];
        if (largest) {
            largest[1].cids.push(...teams['sin_equipo'].cids);
            delete teams['sin_equipo'];
        }
    }

    // Filter by teamKey (from frontend selection)
    if (teamKey === 'todos') {
        // Merge all teams into one consolidated report
        const allCids = [];
        for (const t of Object.values(teams)) {
            allCids.push(...t.cids);
        }
        if (allCids.length > 0) {
            teams = { todos: { name: 'todos', cids: allCids } };
        }
    } else if (teamKey && TEAM_KEY_TO_EXCEL[teamKey]) {
        // Only keep the matching team
        const targetName = TEAM_KEY_TO_EXCEL[teamKey];
        const targetTeam = teams[targetName];
        if (targetTeam) {
            // Merge sin_equipo into target if it exists (already merged above, but just in case)
            if (teams['sin_equipo']) {
                targetTeam.cids.push(...teams['sin_equipo'].cids);
            }
            teams = { [targetName]: targetTeam };
        } else {
            // No matching team found, create a dummy team from unassigned
            const allCids = [];
            for (const t of Object.values(teams)) { allCids.push(...t.cids); }
            if (allCids.length > 0) {
                teams = { [targetName]: { name: targetName, cids: allCids } };
            }
        }
    }

    const teamNames = Object.keys(teams);

    // ─ Step 3: Analyze each team with OpenAI ─
    onProgress({ stage: 'analizando', message: 'Generando reportes con IA...', progress: 80 });

    const SECTION_KEYS = ['volumen', 'estado', 'actividad', 'recetas', 'alertas', 'analisis'];

    const reports = [];
    let reportProgress = 0;

    for (const teamName of teamNames) {
        const label = TEAM_LABELS[teamName] || teamName;
        const { cids } = teams[teamName];

        onProgress({
            stage: 'analizando',
            message: `Generando reporte para ${label}...`,
            progress: 80 + Math.round((reportProgress / teamNames.length) * 15),
        });

        const answers = {};
        const errors = {};

        // Sections 1-3: local stats from Excel
        const stats = computeLocalStats(cids, allConvs, allMsgs);
        answers['volumen'] = formatVolumeSection(stats);
        answers['actividad'] = formatActivitySection(stats);

        // Topic tracking (local, no AI)
        const topicStats = computeTopicStats(teamName, cids, allConvs, allMsgs);

        // AI conclusions for topic-tracked conversations
        if (topicStats && topicStats.anyTopicCount > 0) {
            topicStats.conclusions = await askTopicConclusions(topicStats, allConvs, allMsgs, label);
        }

        // Sections 4-6: OpenAI qualitative analysis
        try {
            const ai = await askOpenAI(stats, cids, allConvs, allMsgs, label);
            answers['recetas'] = ai.recetas;
            answers['alertas'] = ai.alertas;
            answers['analisis'] = ai.analisis;
        } catch (err) {
            answers['recetas'] = 'No se pudo realizar el analisis con IA.';
            answers['alertas'] = 'No se pudo realizar el analisis con IA.';
            answers['analisis'] = `Error: ${err.message}`;
            console.error(`[Pipeline] Error OpenAI para ${label}: ${err.message}`);
        }

        onProgress({
            stage: 'analizando',
            message: `Reporte generado para ${label}`,
            progress: 80 + Math.round(((reportProgress + 1) / teamNames.length) * 15),
        });

        // Generate HTML with KPI meta
        const meta = {
            totalConvs: stats.totalConvs,
            openCount: stats.openCount,
            closedCount: stats.closedCount,
            channels: stats.inboxCounts.length,
            agents: stats.topAgents.filter(a => a.name !== 'Sin agente').length || stats.topAgents.length,
        };
        const html = generateHTMLReport(label, answers, errors, meta, topicStats);
        const dateStr = new Date().toISOString().slice(0, 10);
        const reportFileName = `reporte_${teamName.replace(/\s+/g, '_')}_${dateStr}.html`;
        const reportPath = path.join(EXPORTS_DIR, reportFileName);
        fs.writeFileSync(reportPath, html, 'utf-8');
        reports.push({ team: teamName, label, path: reportPath, fileName: reportFileName, data: { stats, topicStats, meta, answers } });

        reportProgress++;
        await sleep(1000);
    }

    onProgress({ stage: 'analizando', message: 'Reportes generados', progress: 100 });

    return {
        filePath: exportFilePath,
        fileName: exportFileName,
        reports: reports.map(r => ({ team: r.team, label: r.label, fileName: r.fileName, path: r.path, data: r.data })),
    };
}

// ─── Local stats computation (from Excel data, no AI needed) ────────────────

function computeLocalStats(cids, allConvs, allMsgs) {
    let openCount = 0, closedCount = 0;
    const inboxMap = new Map();
    const labelMap = new Map();
    const agentMap = new Map();
    const contactMap = new Map();
    const dateMap = new Map();
    let totalMsgs = 0;
    let minDate = null, maxDate = null;

    for (const cid of cids) {
        const meta = allConvs.get(cid);
        if (!meta) continue;
        if (meta.status === 'open') openCount++;
        else if (meta.status === 'resolved') closedCount++;
        else openCount++;

        const inbox = (meta.inboxName || 'Sin canal').replace(/^Channel::/, '');
        inboxMap.set(inbox, (inboxMap.get(inbox) || 0) + 1);

        if (meta.labels) {
            meta.labels.split(',').forEach(l => {
                const lbl = l.trim();
                if (lbl) labelMap.set(lbl, (labelMap.get(lbl) || 0) + 1);
            });
        }

        const agent = meta.assigneeName || 'Sin agente';
        agentMap.set(agent, (agentMap.get(agent) || 0) + 1);

        const contact = meta.contactName || 'Sin nombre';
        contactMap.set(contact, (contactMap.get(contact) || 0) + 1);

        if (meta.createdAt) {
            try {
                // Excel stores dates as es-UY localized strings like "11/6/2026, 7:29:11 a. m."
                let d = new Date(meta.createdAt);
                if (isNaN(d.getTime())) {
                    // Try parsing DD/MM/YYYY format
                    const m = String(meta.createdAt).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
                    if (m) d = new Date(+m[3], +m[2] - 1, +m[1]);
                }
                if (!isNaN(d.getTime())) {
                    const dayKey = d.toISOString().slice(0, 10);
                    dateMap.set(dayKey, (dateMap.get(dayKey) || 0) + 1);
                    if (!minDate || d < minDate) minDate = d;
                    if (!maxDate || d > maxDate) maxDate = d;
                }
            } catch { /* skip */ }
        }

        totalMsgs += (allMsgs.get(cid) || []).length;
    }

    const totalConvs = cids.length;
    const avgMsgs = totalConvs > 0 ? (totalMsgs / totalConvs).toFixed(1) : '0';
    const dateRange = minDate && maxDate
        ? `${minDate.toLocaleDateString('es-UY')} - ${maxDate.toLocaleDateString('es-UY')}`
        : 'Sin rango';
    const sortMap = (map) => [...map.entries()].sort((a, b) => b[1] - a[1]);

    return {
        totalConvs, openCount, closedCount, avgMsgs, dateRange,
        inboxCounts: sortMap(inboxMap).map(([name, count]) => ({ name, count })),
        topLabels: sortMap(labelMap).slice(0, 10).map(([name, count]) => ({ name, count })),
        topAgents: sortMap(agentMap).slice(0, 10).map(([name, count]) => ({ name, count })),
        topContacts: sortMap(contactMap).slice(0, 5).map(([name, count]) => ({ name, count })),
        perDay: sortMap(dateMap).map(([day, count]) => ({ day, count })),
    };
}

function formatVolumeSection(stats) {
    const inboxRows = stats.inboxCounts.map(i =>
        `<tr><td class="lbl">${escapeHtml(i.name)}</td><td class="val">${i.count}</td></tr>`
    ).join('');
    const perDayRows = stats.perDay.slice(0, 10).map(pd =>
        `<tr><td class="lbl">${pd.day}</td><td class="val">${pd.count}</td></tr>`
    ).join('');

    const top = `<div class="stat-compact"><span class="lbl">Rango de fechas</span><span class="val">${stats.dateRange}</span></div>`;

    const accordions = buildAccordion('volumen', [
        { title: 'Conversaciones por canal', body: `<table class="mini-table"><tbody>${inboxRows}</tbody></table>` },
        ...(stats.perDay.length > 0 ? [{ title: 'Por día', body: `<table class="mini-table"><tbody>${perDayRows}</tbody></table>` }] : []),
    ]);

    return top + accordions;
}

function formatStatusSection(stats) {
    const total = stats.totalConvs || 1;
    const openPct = ((stats.openCount / total) * 100).toFixed(0);
    const closedPct = ((stats.closedCount / total) * 100).toFixed(0);
    const labelRows = stats.topLabels.map(l =>
        `<tr><td class="lbl">${escapeHtml(l.name)}</td><td class="val">${l.count}</td></tr>`
    ).join('');

    const top = `
<div class="stat-compact"><span class="lbl">Abiertas</span><span class="val">${stats.openCount} <em>(${openPct}%)</em></span></div>
<div class="stat-compact"><span class="lbl">Cerradas / Resueltas</span><span class="val">${stats.closedCount} <em>(${closedPct}%)</em></span></div>`;

    const accordions = buildAccordion('estado', [
        { title: 'Etiquetas más usadas', body: `<table class="mini-table"><tbody>${labelRows}</tbody></table>` },
    ]);

    return top + accordions;
}

function formatActivitySection(stats) {
    const agentRows = stats.topAgents.map(a =>
        `<tr><td class="lbl">${escapeHtml(a.name)}</td><td class="val">${a.count} conv.</td></tr>`
    ).join('');
    const contactRows = stats.topContacts.map(c =>
        `<tr><td class="lbl">${escapeHtml(c.name)}</td><td class="val">${c.count} conv.</td></tr>`
    ).join('');

    const top = `<div class="stat-compact"><span class="lbl">Rango de fechas</span><span class="val">${stats.dateRange}</span></div>`;

    const accordions = buildAccordion('actividad', [
        { title: 'Agentes más activos', body: `<table class="mini-table"><tbody>${agentRows}</tbody></table>` },
        { title: 'Contactos con más conversaciones', body: `<table class="mini-table"><tbody>${contactRows}</tbody></table>` },
    ]);

    return top + accordions;
}

function computeTopicStats(teamName, cids, allConvs, allMsgs) {
    const topics = TOPIC_TRACKING[teamName];
    if (!topics || topics.length === 0) return null;

    const counts = topics.map(t => ({ ...t, count: 0, details: [] }));
    let anyTopicCount = 0;

    for (const cid of cids) {
        const meta = allConvs.get(cid);
        const contactName = meta?.contactName || 'Sin nombre';
        const contactEmail = meta?.contactEmail || '';
        const msgs = allMsgs.get(cid) || [];
        // Filter: only client messages (not internal notes/automations)
        const clientMsgs = msgs.filter(m => !m.isPrivate && String(m.content || '').trim().length > 0);
        const originalText = clientMsgs.map(m => String(m.content || '')).join(' ');
        const fullText = originalText.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        let matchedAny = false;

        for (const topic of counts) {
            const matchedKeywords = topic.keywords.filter(kw => {
                const normalizedKw = kw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                return fullText.includes(normalizedKw);
            });
            if (matchedKeywords.length > 0) {
                topic.count++;
                const extracted = typeof topic.extract === 'function' ? topic.extract(originalText) : null;
                topic.details.push({
                    cid,
                    contactName,
                    contactEmail,
                    matchedKeywords,
                    excerpt: escapeHtml(extractExcerpt(originalText, topic.keywords)),
                    extracted: extracted ? escapeHtml(extracted) : null,
                });
                matchedAny = true;
            }
        }
        if (matchedAny) anyTopicCount++;
    }

    return { topics: counts, anyTopicCount, totalConvs: cids.length };
}

function formatTopicTrackingSection(topicStats) {
    if (!topicStats || topicStats.topics.length === 0) {
        return '<p class="text-muted fst-italic small mb-0">No hay temas de seguimiento configurados para este equipo.</p>';
    }

    const total = topicStats.totalConvs || 1;
    const anyPct = ((topicStats.anyTopicCount / total) * 100).toFixed(0);
    const conclusions = topicStats.conclusions || {};

    const conclusionLabel = (c) => {
        const map = {
            'VENTA': '✅ Venta',
            'EVALUANDO': '⏳ Evaluando',
            'SIN RESPUESTA': '📭 Sin respuesta',
            'SOLO CONSULTA': '💬 Solo consulta',
            'CALIFICADO': '📋 Calificado',
            'NO CALIFICA': '➖ No califica',
        };
        return map[c] || c || '—';
    };

    const conclusionBadge = (c) => {
        const colors = {
            'VENTA': '#509F2C',
            'EVALUANDO': '#f5a623',
            'SIN RESPUESTA': '#df1b41',
            'SOLO CONSULTA': '#6b7280',
            'CALIFICADO': '#635bff',
            'NO CALIFICA': '#bbb',
        };
        return colors[c] || '#999';
    };

    // Count conclusions per type for stats
    const conclusionCounts = {};
    let totalConclusions = 0;
    for (const topic of topicStats.topics) {
        for (const d of topic.details) {
            const c = conclusions[d.cid] || '—';
            conclusionCounts[c] = (conclusionCounts[c] || 0) + 1;
            totalConclusions++;
        }
    }
    const conclusionStats = Object.entries(conclusionCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([conclusion, count]) => {
            const pct = totalConclusions > 0 ? ((count / totalConclusions) * 100).toFixed(0) : 0;
            return `<span style="display:inline-block;margin-right:10px;font-size:.75rem"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${conclusionBadge(conclusion)};margin-right:4px"></span>${conclusionLabel(conclusion)}: <strong>${count}</strong> <em style="color:var(--gray);font-weight:400;font-size:.7rem">(${pct}%)</em></span>`;
        }).join('');

    const stats = `
<div class="stat-compact"><span class="lbl">Total conversaciones analizadas</span><span class="val">${topicStats.totalConvs}</span></div>
<div class="stat-compact"><span class="lbl">Conversaciones con temas de seguimiento</span><span class="val">${topicStats.anyTopicCount} <em>(${anyPct}%)</em></span></div>
${totalConclusions > 0 ? `<div style="padding:6px 0 2px;line-height:1.8">${conclusionStats}</div>` : ''}`;

    const topicAccordions = topicStats.topics.map((t, idx) => {
        const pct = ((t.count / total) * 100).toFixed(0);
        const detailRows = t.details.map(d => {
            const conclusion = conclusions[d.cid] || '—';
            const extra = d.extracted ? `<br><span style="color:var(--primary);font-weight:600">→ Recomendó a: ${d.extracted}</span>` : '';
            return `<tr>
                <td style="width:1%;white-space:nowrap;padding-right:8px"><span style="font-weight:700;color:var(--primary)">#${d.cid}</span></td>
                <td style="white-space:nowrap;padding-right:10px"><strong>${escapeHtml(d.contactName)}</strong>${d.contactEmail ? `<br><small class="text-muted">${escapeHtml(d.contactEmail)}</small>` : ''}</td>
                <td style="white-space:nowrap"><span style="font-size:.7rem;font-weight:700;color:${conclusionBadge(conclusion)};padding:2px 8px;border-radius:10px;background:${conclusionBadge(conclusion)}18">${conclusionLabel(conclusion)}</span>${extra}</td>
            </tr>`;
        }).join('');

        const table = t.details.length > 0
            ? `<table class="mini-table"><tbody>${detailRows}</tbody></table>`
            : '<p class="text-muted fst-italic small mb-0">Sin conversaciones con este tema.</p>';

        return {
            title: `${t.label} — ${t.count} conversaci${t.count === 1 ? 'ón' : 'ones'} (${pct}%)`,
            body: table,
        };
    });

    const accordion = buildAccordion('topic-tracking', topicAccordions);
    return stats + accordion;
}

// ─── HTTP Handlers ───────────────────────────────────────────────────────────

function requireToken(req, res) {
    const secret = process.env.EXPORT_SECRET;
    if (!secret) return true;
    const token = req.headers['x-export-token'] || req.query.token;
    if (token !== secret) {
        res.status(401).json({ error: 'Token invalido' });
        return false;
    }
    return true;
}

export async function StartPipeline(req, res) {
    if (!requireToken(req, res)) return;

    const accountId = parseInt(req.query.accountId);
    if (!accountId) return res.status(400).json({ error: 'accountId requerido' });

    const inboxIds = req.query.inboxId
        ? (Array.isArray(req.query.inboxId) ? req.query.inboxId.map(Number) : req.query.inboxId.split(',').map(Number))
        : [];
    const teamIds = req.query.teamId
        ? (Array.isArray(req.query.teamId) ? req.query.teamId.map(Number) : req.query.teamId.split(',').map(Number))
        : [];
    const agentIds = req.query.agentId
        ? (Array.isArray(req.query.agentId) ? req.query.agentId.map(Number) : req.query.agentId.split(',').map(Number))
        : [];
    const dateFrom = req.query.dateFrom || null;
    const dateTo = req.query.dateTo || null;
    const teamKey = req.query.teamKey || null;

    if (inboxIds.length === 0) {
        return res.status(400).json({ error: 'Se requiere al menos un inboxId' });
    }

    const jobId = crypto.randomUUID();
    const job = {
        status: 'processing',
        stage: 'iniciando',
        message: 'Iniciando pipeline...',
        progress: 0,
        result: null,
        error: null,
        createdAt: Date.now(),
    };
    jobs.set(jobId, job);

    res.status(202).json({
        jobId,
        status: 'processing',
        stage: 'iniciando',
        statusUrl: `/api/export/notebooklm/status/${jobId}`,
    });

    runPipeline(jobId, inboxIds, teamIds, agentIds, dateFrom, dateTo, teamKey, (update) => {
        const j = jobs.get(jobId);
        if (j) {
            j.stage = update.stage;
            j.message = update.message;
            j.progress = update.progress;
        }
    }).then(result => {
        const j = jobs.get(jobId);
        if (j) {
            j.status = 'done';
            j.stage = 'completado';
            j.message = 'Pipeline completada';
            j.progress = 100;
            j.result = result;
        }
    }).catch(err => {
        const j = jobs.get(jobId);
        if (j) {
            j.status = 'error';
            j.stage = 'error';
            j.message = err.message;
            j.error = err.message;
        }
        console.error(`[Pipeline ${jobId}] Error:`, err.message);
    });
}

export async function GetPipelineStatus(req, res) {
    if (!requireToken(req, res)) return;

    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ error: 'Job no encontrado o expirado' });
    }

    res.json({
        jobId,
        status: job.status,
        stage: job.stage,
        message: job.message,
        progress: job.progress,
        result: job.status === 'done' ? job.result : null,
        error: job.error || null,
    });
}

export async function DownloadPipelineResult(req, res) {
    if (!requireToken(req, res)) return;

    const { jobId, type } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).json({ error: 'Job no encontrado o expirado' });
    }

    if (job.status !== 'done' || !job.result) {
        return res.status(400).json({ error: 'Pipeline no completada aun' });
    }

    if (type === 'xlsx') {
        if (!job.result.filePath || !fs.existsSync(job.result.filePath)) {
            return res.status(404).json({ error: 'Archivo no disponible' });
        }
        return res.download(job.result.filePath, job.result.fileName);
    }

    const idx = parseInt(req.query.i);
    let report;
    if (!isNaN(idx)) {
        report = job.result.reports?.[idx];
    } else {
        const teamName = req.query.team;
        report = job.result.reports?.find(r => r.team === teamName);
    }
    if (!report || !fs.existsSync(report.path)) {
        return res.status(404).json({ error: 'Reporte no encontrado' });
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.sendFile(report.path);
}

// SetupNotebooks kept for backward compatibility, returns config info
export async function SetupNotebooks(req, res) {
    if (!requireToken(req, res)) return;
    res.json({
        success: true,
        message: 'El dashboard usa OpenAI para el analisis. No se requiere configuracion adicional.',
    });
}

export async function ExportDashboardExcel(req, res) {
    if (!requireToken(req, res)) return;

    const { jobId } = req.params;
    const job = jobs.get(jobId);
    if (!job || job.status !== 'done' || !job.result) {
        return res.status(404).json({ error: 'Job no encontrado o pipeline no completado' });
    }

    const teamName = req.query.team;
    const report = teamName
        ? job.result.reports?.find(r => r.team === teamName)
        : job.result.reports?.[0];
    if (!report || !report.data) {
        return res.status(404).json({ error: 'Datos del reporte no disponibles' });
    }

    const { stats, topicStats, meta } = report.data;
    const conclusions = topicStats?.conclusions || {};
    const topicData = topicStats;
    const aiAnswers = report.data.answers || {};

    const workbook = new ExcelJS.Workbook();
    const headerStyle = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF509F2C' } } };

    // Sheet 1: Resumen (KPIs)
    const sh1 = workbook.addWorksheet('Resumen');
    sh1.columns = [
        { header: 'Indicador', key: 'label', width: 30 },
        { header: 'Valor', key: 'value', width: 20 },
    ];
    sh1.getRow(1).eachCell(c => { c.font = headerStyle.font; c.fill = headerStyle.fill; });
    sh1.addRow({ label: 'Conversaciones totales', value: meta.totalConvs });
    sh1.addRow({ label: 'Abiertas', value: meta.openCount });
    sh1.addRow({ label: 'Cerradas / Resueltas', value: meta.closedCount });
    sh1.addRow({ label: 'Canales', value: meta.channels });
    sh1.addRow({ label: 'Agentes', value: meta.agents });
    sh1.addRow({ label: 'Rango de fechas', value: stats?.dateRange || '' });
    sh1.addRow({ label: 'Equipo', value: report.label });

    // Sheet 2: Volumen
    const sh2 = workbook.addWorksheet('Volumen');
    sh2.columns = [
        { header: 'Canal', key: 'name', width: 30 },
        { header: 'Conversaciones', key: 'count', width: 15 },
    ];
    sh2.getRow(1).eachCell(c => { c.font = headerStyle.font; c.fill = headerStyle.fill; });
    (stats?.inboxCounts || []).forEach(i => sh2.addRow({ name: i.name, count: i.count }));
    sh2.addRow({}); sh2.addRow({ name: 'Por día', count: '' });
    (stats?.perDay || []).forEach(d => sh2.addRow({ name: d.day, count: d.count }));

    // Sheet 3: Actividad
    const sh3 = workbook.addWorksheet('Actividad');
    sh3.columns = [
        { header: 'Agente', key: 'name', width: 30 },
        { header: 'Conversaciones', key: 'count', width: 15 },
    ];
    sh3.getRow(1).eachCell(c => { c.font = headerStyle.font; c.fill = headerStyle.fill; });
    (stats?.topAgents || []).forEach(a => sh3.addRow({ name: a.name, count: a.count }));
    sh3.addRow({});
    (stats?.topContacts || []).forEach(c => sh3.addRow({ name: c.name, count: c.count }));

    // Sheet 4: Seguimiento de Temas
    const sh4 = workbook.addWorksheet('Seguimiento de Temas');
    sh4.columns = [
        { header: 'Tema', key: 'topic', width: 22 },
        { header: 'ID Conversación', key: 'cid', width: 12 },
        { header: 'Contacto', key: 'contact', width: 25 },
        { header: 'Email', key: 'email', width: 30 },
        { header: 'Conclusión', key: 'conclusion', width: 18 },
        { header: 'Recomendó a', key: 'extracted', width: 25 },
    ];
    sh4.getRow(1).eachCell(c => { c.font = headerStyle.font; c.fill = headerStyle.fill; });
    if (topicData?.topics) {
        for (const t of topicData.topics) {
            for (const d of (t.details || [])) {
                sh4.addRow({
                    topic: t.label,
                    cid: d.cid,
                    contact: d.contactName,
                    email: d.contactEmail,
                    conclusion: conclusions[d.cid] || '—',
                    extracted: d.extracted || '',
                });
            }
        }
    }

    // Sheets 5-7: AI analysis (plain text). Hoja 7 solo para admin.
    const aiSheets = [
        { name: 'Temas IA', content: aiAnswers.recetas || 'No disponible' },
        { name: 'Alertas IA', content: aiAnswers.alertas || 'No disponible' },
    ];
    const isAdmin = String(req.query.isAdmin || '').toLowerCase() === 'true';
    if (isAdmin) {
        aiSheets.push({ name: 'Análisis General IA', content: aiAnswers.analisis || 'No disponible' });
    }
    for (const sheet of aiSheets) {
        const sh = workbook.addWorksheet(sheet.name);
        sh.columns = [{ header: 'Contenido', key: 'content', width: 100 }];
        sh.getRow(1).eachCell(c => { c.font = headerStyle.font; c.fill = headerStyle.fill; });
        sheet.content.split('\n').forEach(line => sh.addRow({ content: line }));
    }

    const buf = await workbook.xlsx.writeBuffer();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="dashboard_${report.team}_${new Date().toISOString().slice(0, 10)}.xlsx"`);
    return res.send(Buffer.from(buf));
}

export async function ListDashboards(req, res) {
    if (!requireToken(req, res)) return;
    try {
        if (!fs.existsSync(EXPORTS_DIR)) return res.json([]);
        const files = fs.readdirSync(EXPORTS_DIR).filter(f => f.startsWith('reporte_') && f.endsWith('.html'));
        const grouped = new Map();
        for (const f of files) {
            const match = f.match(/^reporte_(.+)_(\d{4}-\d{2}-\d{2})\.html$/);
            if (!match) continue;
            const [, team, dateStr] = match;
            if (!grouped.has(dateStr)) grouped.set(dateStr, { date: dateStr, teams: [], files: [] });
            const g = grouped.get(dateStr);
            if (!g.teams.includes(team)) g.teams.push(team);
            g.files.push({ team, file: f });
        }
        const result = [...grouped.values()].sort((a, b) => b.date.localeCompare(a.date));
        res.json(result.map(g => ({ date: g.date, teams: g.teams, files: g.files })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

export async function DownloadHistoryReport(req, res) {
    if (!requireToken(req, res)) return;
    const file = req.query.file;
    if (!file) return res.status(400).json({ error: 'file requerido' });
    const filePath = path.join(EXPORTS_DIR, path.basename(file));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    return res.sendFile(filePath);
}
