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

// ─── HTML Report Generator ───────────────────────────────────────────────────

function generateHTMLPage(teamLabel, rows, dateStr, meta) {
    // Use same Bootstrap version as Chatwoot
    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>iChef Analytics — ${escapeHtml(teamLabel)}</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <style>
        body { background: #f6f9fc; color: #1a1f36; }
        .container { max-width: 1140px; }
        .hero-i { background: linear-gradient(135deg, #1a1f36 0%, #2d3561 100%); padding: 28px 0 22px; color: white; }
        .hero-i h1 { font-size: 1.5rem; font-weight: 700; }
        .kpi-card { background: #fff; border-radius: 10px; padding: 16px 20px; border: 1px solid #e3e8ee; }
        .kpi-card .kpi-val { font-size: 1.5rem; font-weight: 700; color: #1a1f36; }
        .kpi-card .kpi-lbl { font-size: .7rem; color: #697386; text-transform: uppercase; letter-spacing: .4px; font-weight: 600; }
        .kpi-card.green .kpi-val { color: #00ba88; }
        .kpi-card.accent .kpi-val { color: #635bff; }
        .card-dash { border-radius: 12px; border: 1px solid #e3e8ee; overflow: hidden; }
        .card-dash .card-header { background: #fff; border-bottom: 1px solid #e3e8ee; font-weight: 600; font-size: .9rem; display: flex; align-items: center; gap: 8px; padding: 14px 18px; }
        .card-dash .card-body { padding: 18px 20px; font-size: .85rem; line-height: 1.7; color: #2d3348; overflow-wrap: break-word; word-break: break-word; }
        .card-dash .card-body .subtitle { font-size: .7rem; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; color: #635bff; margin: 16px 0 8px; padding-bottom: 5px; border-bottom: 1px solid #eef0ff; overflow: hidden; text-overflow: ellipsis; }
        .card-dash .card-body strong { color: #1a1f36; font-weight: 700; }
        .card-dash .card-body .card-list { padding-left: 18px; list-style: none; margin: 6px 0 12px; }
        .card-dash .card-body .card-list li { position: relative; padding: 3px 0 3px 4px; margin-bottom: 4px; font-size: .82rem; overflow-wrap: break-word; word-break: break-word; }
        .card-dash .card-body .card-list li::before { content: ''; position: absolute; left: -14px; top: 9px; width: 6px; height: 6px; border-radius: 50%; background: #635bff; }
        .card-dash.error { border-left: 3px solid #df1b41; }
        .stat-row { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #f5f5f7; }
        .stat-row:last-child { border-bottom: none; }
        .stat-row .lbl { color: #697386; font-size: .8rem; }
        .stat-row .val { color: #1a1f36; font-weight: 600; font-size: .85rem; }
        .icon-i { width: 30px; height: 30px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; }
        .icon-i.blue { background: #eef0ff; color: #635bff; }
        .icon-i.green { background: #e6faf3; color: #00ba88; }
        .icon-i.amber { background: #fef6e8; color: #f5a623; }
        .icon-i.purple { background: #f3f0ff; color: #7c5cfc; }
        .icon-i.teal { background: #e6faf7; color: #00a3a3; }
    </style>
</head>
<body>
<div class="hero-i">
    <div class="container">
        <div class="d-flex justify-content-between align-items-center">
            <div><strong>iChef</strong> <span style="color:#00d4aa">Analytics</span></div>
            <small style="opacity:.7">${dateStr}</small>
        </div>
        <h1 class="mt-3 mb-1">${escapeHtml(teamLabel)}</h1>
        <small style="opacity:.7">Tablero de Comando — IA (${OPENAI_MODEL})</small>
    </div>
</div>
<div class="container" style="margin-top:-14px">
    <div class="row g-3">
        <div class="col-4 col-md-2"><div class="kpi-card"><div class="kpi-val">${meta.totalConvs ?? '—'}</div><div class="kpi-lbl">Conversaciones</div></div></div>
        <div class="col-4 col-md-2"><div class="kpi-card green"><div class="kpi-val">${meta.openCount ?? '—'}</div><div class="kpi-lbl">Abiertas</div></div></div>
        <div class="col-4 col-md-2"><div class="kpi-card"><div class="kpi-val">${meta.closedCount ?? '—'}</div><div class="kpi-lbl">Cerradas</div></div></div>
        <div class="col-4 col-md-2"><div class="kpi-card accent"><div class="kpi-val">${meta.avgMsgs ?? '—'}</div><div class="kpi-lbl">Msg/Conv</div></div></div>
        <div class="col-4 col-md-2"><div class="kpi-card"><div class="kpi-val">${meta.channels ?? '—'}</div><div class="kpi-lbl">Canales</div></div></div>
        <div class="col-4 col-md-2"><div class="kpi-card"><div class="kpi-val">${meta.agents ?? '—'}</div><div class="kpi-lbl">Agentes</div></div></div>
    </div>
    <div class="row g-3 mt-1">${rows}</div>
    <div class="text-center mt-4 pb-4"><small class="text-muted">iChef Analytics · Generado automaticamente · ${dateStr}</small></div>
</div>
</body>
</html>`;
}

function generateHTMLReport(teamLabel, answers, errors = {}, meta = {}) {
    const sections = [
        { title: 'Volumen', key: 'volumen', icon: '📊', ic: 'blue' },
        { title: 'Estado', key: 'estado', icon: '🏷️', ic: 'green' },
        { title: 'Actividad', key: 'actividad', icon: '👥', ic: 'purple' },
        { title: 'Temas', key: 'recetas', icon: '💬', ic: 'teal' },
        { title: 'Alertas', key: 'alertas', icon: '⚠️', ic: 'amber' },
        { title: 'Análisis General', key: 'analisis', icon: '📋', ic: 'blue' },
    ];

    const rows = sections.map(s => {
        const answer = answers[s.key] || 'Sin datos';
        const error = errors[s.key] || '';
        const isError = !answers[s.key] && error;
        const isStat = ['volumen', 'estado', 'actividad'].includes(s.key);
        const content = isStat ? answer : formatContent(answer);
        return `
        <div class="col-lg-6 mb-3" style="min-width:0">
            <div class="card card-dash${isError ? ' error' : ''}">
                <div class="card-header">
                    <span class="icon-i ${s.ic}">${s.icon}</span> ${escapeHtml(s.title)}
                </div>
                <div class="card-body">${content}</div>
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

function formatContent(text) {
    if (typeof text !== 'string') return '';
    let html = escapeHtml(text);
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^[-•]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>[\s\S]*?<\/li>\s*)+)/g, '<ul class="card-list">$1</ul>');
    html = html.replace(/^([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,]{4,60})$/gm, '<div class="subtitle">$1</div>');
    html = html.replace(/^(.{8,80}):[ \t]*$/gm, '<div class="subtitle">$1</div>');
    html = html.replace(/^\s+/, '').replace(/\s+$/, '');
    html = html.replace(/\n\n+/g, '\n\n');
    html = html.replace(/\n/g, '<br>');
    // Replace double <br> back to double newline for cleanup
    html = html.replace(/<br><br>/g, '\n\n');
    // Remove <br> inside <ul> (between <li> elements)
    html = html.replace(/(<ul class="card-list">[\s\S]*?<\/ul>)/g, m => m.replace(/<br>/g, ''));
    // Remove <br> immediately before/after block elements
    html = html.replace(/(?:<br>)+<(div class="subtitle"|ul class="card-list")/g, '<$1');
    html = html.replace(/<\/(div|ul)>(?:<br>)+/g, '</$1>');
    // Convert remaining \n\n to <br><br>
    html = html.replace(/\n\n/g, '<br><br>');
    html = html.replace(/\n/g, '<br>');
    html = html.replace(/^(<br>)+/, '').replace(/(<br>)+$/, '');
    return html;
}

// ─── Export + Analysis Pipeline ──────────────────────────────────────────────

async function runPipeline(jobId, inboxIds, teamIds, agentIds, dateFrom, dateTo, onProgress) {
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
        allMsgs.get(cid).push({
            senderName: String(row.getCell(col(msgHeaders, 'Remitente')).value || ''),
            content: String(content),
            timestamp: row.getCell(col(msgHeaders, 'Fecha/Hora')).value || '',
        });
    });

    const teams = {};
    for (const [cid, meta] of allConvs) {
        const t = meta.teamName || 'sin_equipo';
        if (!teams[t]) teams[t] = { name: t, cids: [] };
        teams[t].cids.push(cid);
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
        answers['estado'] = formatStatusSection(stats);
        answers['actividad'] = formatActivitySection(stats);

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
            avgMsgs: stats.avgMsgs,
            channels: stats.inboxCounts.length,
            agents: stats.topAgents.filter(a => a.name !== 'Sin agente').length || stats.topAgents.length,
        };
        const html = generateHTMLReport(label, answers, errors, meta);
        const dateStr = new Date().toISOString().slice(0, 10);
        const reportFileName = `reporte_${teamName.replace(/\s+/g, '_')}_${dateStr}.html`;
        const reportPath = path.join(EXPORTS_DIR, reportFileName);
        fs.writeFileSync(reportPath, html, 'utf-8');
        reports.push({ team: teamName, label, path: reportPath, fileName: reportFileName });

        reportProgress++;
        await sleep(1000);
    }

    onProgress({ stage: 'analizando', message: 'Reportes generados', progress: 100 });

    return {
        filePath: exportFilePath,
        fileName: exportFileName,
        reports: reports.map(r => ({ team: r.team, label: r.label, fileName: r.fileName, path: r.path })),
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

    return `
<div class="stat-row"><span class="stat-label">Total conversaciones</span><span class="stat-value">${stats.totalConvs}</span></div>
<div class="stat-row"><span class="stat-label">Promedio msgs / conversación</span><span class="stat-value">${stats.avgMsgs}</span></div>
<div class="stat-row"><span class="stat-label">Rango de fechas</span><span class="stat-value">${stats.dateRange}</span></div>
<div class="subtitle">Conversaciones por canal</div>
<table class="mini-table"><tbody>${inboxRows}</tbody></table>
${stats.perDay.length > 0 ? `<div class="subtitle">Por día</div><table class="mini-table"><tbody>${perDayRows}</tbody></table>` : ''}`;
}

function formatStatusSection(stats) {
    const total = stats.totalConvs || 1;
    const openPct = ((stats.openCount / total) * 100).toFixed(0);
    const closedPct = ((stats.closedCount / total) * 100).toFixed(0);
    const labelRows = stats.topLabels.map(l =>
        `<tr><td class="lbl">${escapeHtml(l.name)}</td><td class="val">${l.count}</td></tr>`
    ).join('');

    return `
<div class="stat-row"><span class="stat-label">Abiertas</span><span class="stat-value">${stats.openCount} <em>(${openPct}%)</em></span></div>
<div class="stat-row"><span class="stat-label">Cerradas / Resueltas</span><span class="stat-value">${stats.closedCount} <em>(${closedPct}%)</em></span></div>
<div class="subtitle">Etiquetas más usadas</div>
<table class="mini-table"><tbody>${labelRows}</tbody></table>`;
}

function formatActivitySection(stats) {
    const agentRows = stats.topAgents.map(a =>
        `<tr><td class="lbl">${escapeHtml(a.name)}</td><td class="val">${a.count} conv.</td></tr>`
    ).join('');
    const contactRows = stats.topContacts.map(c =>
        `<tr><td class="lbl">${escapeHtml(c.name)}</td><td class="val">${c.count} conv.</td></tr>`
    ).join('');

    return `
<div class="stat-row"><span class="stat-label">Rango de fechas</span><span class="stat-value">${stats.dateRange}</span></div>
<div class="subtitle">Agentes más activos</div>
<table class="mini-table"><tbody>${agentRows}</tbody></table>
<div class="subtitle">Contactos con más conversaciones</div>
<table class="mini-table"><tbody>${contactRows}</tbody></table>`;
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

    runPipeline(jobId, inboxIds, teamIds, agentIds, dateFrom, dateTo, (update) => {
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
    return res.sendFile(filePath);
}
