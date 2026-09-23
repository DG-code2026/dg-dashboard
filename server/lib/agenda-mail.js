// ─────────────────────────────────────────────────────────────────────────────
//  AGENDA · AVISOS POR MAIL
//
//  Dos envíos, ambos a los usuarios activos de `allowed_users`:
//
//    - Víspera: el día anterior a que arranque un registro, a las 18:00 AR.
//      Un mail con lo que empieza mañana.
//    - Semanal: domingos 20:00 AR, con todo lo de la semana que viene
//      (lunes a domingo).
//
//  Cada mail trae links para agregar al calendario:
//    - Por evento: link "render" de Google Calendar, que abre el formulario
//      de alta con los datos ya cargados.
//    - De toda la semana / el día: un archivo .ics que Google Calendar, el
//      iPhone y Outlook importan igual. Se sirve desde el propio server.
//
//  Los eventos de la firma (D&G) pueden tener hora; las ausencias son de día
//  completo y en el .ics van como all-day.
// ─────────────────────────────────────────────────────────────────────────────

import nodemailer from 'nodemailer';

const TZ = 'America/Argentina/Buenos_Aires';

// ── Helpers de fecha ──

export function ymdEnAR(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

export function sumarDias(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

// Lunes de la semana que contiene `ymd` (o el lunes siguiente si se pide).
export function lunesDeLaSemana(ymd, offsetSemanas = 0) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();               // 0=Dom
  const alLunes = dow === 0 ? -6 : 1 - dow; // domingo pertenece a la semana que termina
  dt.setUTCDate(dt.getUTCDate() + alLunes + offsetSemanas * 7);
  return dt.toISOString().slice(0, 10);
}

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DIAS   = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];

export function fmtFechaLarga(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${DIAS[dow]} ${d} de ${MESES[m - 1]}`;
}

function fmtRango(r) {
  const base = r.desde === r.hasta
    ? fmtFechaLarga(r.desde)
    : `${fmtFechaLarga(r.desde)} al ${fmtFechaLarga(r.hasta)}`;
  if (!r.hora_desde) return base;
  const hh = (t) => String(t).slice(0, 5);
  return r.hora_hasta
    ? `${base}, de ${hh(r.hora_desde)} a ${hh(r.hora_hasta)}`
    : `${base}, ${hh(r.hora_desde)}`;
}

const TIPO_LABEL = {
  evento: 'Evento', vacaciones: 'Vacaciones', licencia: 'Licencia',
  estudio: 'Estudio', home_office: 'Home office', personal: 'Personal',
};

// ── ICS ──
//
// Formato de fecha ICS. Sin hora → DATE (all-day, y DTEND exclusivo, por eso
// se suma un día). Con hora → hora local con TZID, que es lo que interpretan
// bien Google y Apple sin tener que convertir a UTC a mano.
function icsFechas(r) {
  if (!r.hora_desde) {
    return [
      `DTSTART;VALUE=DATE:${r.desde.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${sumarDias(r.hasta, 1).replace(/-/g, '')}`,
    ];
  }
  const hh = (t) => String(t).slice(0, 8).replace(/:/g, '');
  const fin = r.hora_hasta || r.hora_desde;
  return [
    `DTSTART;TZID=${TZ}:${r.desde.replace(/-/g, '')}T${hh(r.hora_desde)}`,
    `DTEND;TZID=${TZ}:${r.hasta.replace(/-/g, '')}T${hh(fin)}`,
  ];
}

// Escapado ICS: coma, punto y coma, barra y saltos de línea.
function esc(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\r?\n/g, '\\n');
}

export function construirICS(registros, nombrePorPersona) {
  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Delfino Gavina//Agenda//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const r of registros) {
    const quien = nombrePorPersona.get(r.persona_id) || '';
    const esEvento = r.tipo === 'evento';
    const titulo = esEvento
      ? (r.descripcion || 'Evento D&G')
      : `${quien} · ${TIPO_LABEL[r.tipo] || r.tipo}`;
    lineas.push(
      'BEGIN:VEVENT',
      `UID:${r.id}@delfinogavina.com.ar`,
      `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
      ...icsFechas(r),
      `SUMMARY:${esc(titulo)}`,
      ...(r.descripcion && !esEvento ? [`DESCRIPTION:${esc(r.descripcion)}`] : []),
      'END:VEVENT',
    );
  }
  lineas.push('END:VCALENDAR');
  // RFC 5545 pide CRLF.
  return lineas.join('\r\n');
}

// ── Link "agregar a Google Calendar" de un registro ──
export function linkGoogle(r, quien) {
  const esEvento = r.tipo === 'evento';
  const titulo = esEvento ? (r.descripcion || 'Evento D&G') : `${quien} · ${TIPO_LABEL[r.tipo] || r.tipo}`;
  let fechas;
  if (!r.hora_desde) {
    fechas = `${r.desde.replace(/-/g, '')}/${sumarDias(r.hasta, 1).replace(/-/g, '')}`;
  } else {
    const hh = (t) => String(t).slice(0, 8).replace(/:/g, '');
    const fin = r.hora_hasta || r.hora_desde;
    fechas = `${r.desde.replace(/-/g, '')}T${hh(r.hora_desde)}/${r.hasta.replace(/-/g, '')}T${hh(fin)}`;
  }
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: titulo,
    dates: fechas,
    ctz: TZ,
    ...(r.descripcion ? { details: r.descripcion } : {}),
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}

// ── Plantilla HTML ──
//
// Mail en tabla y con estilos inline: es lo único que renderiza parejo en
// Gmail, Outlook y el cliente del iPhone.
const NAVY = '#1A2236';
const CREAM = '#FEF8E6';

function filaRegistro(r, nombrePorPersona, etiquetaPorPersona) {
  const quien = nombrePorPersona.get(r.persona_id) || '—';
  const etiqueta = etiquetaPorPersona.get(r.persona_id) || '';
  const esEvento = r.tipo === 'evento';
  const titulo = esEvento ? (r.descripcion || 'Evento de la firma') : quien;
  const sub = esEvento ? 'Evento D&G' : `${TIPO_LABEL[r.tipo] || r.tipo}${r.descripcion ? ` · ${r.descripcion}` : ''}`;
  return `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #E5E1D8;">
        <div style="font:600 15px/1.3 Arial,sans-serif;color:${NAVY};">
          <span style="display:inline-block;background:${NAVY};color:${CREAM};border-radius:3px;padding:2px 6px;font:700 10px Arial,sans-serif;margin-right:8px;">${etiqueta}</span>
          ${titulo}
        </div>
        <div style="font:400 13px/1.5 Arial,sans-serif;color:#5A6478;margin-top:4px;">${sub}</div>
        <div style="font:400 13px/1.5 Arial,sans-serif;color:#5A6478;">${fmtRango(r)}</div>
        <a href="${linkGoogle(r, quien)}" style="display:inline-block;margin-top:6px;font:600 12px Arial,sans-serif;color:#1D4ED8;text-decoration:none;">+ Agregar a Google Calendar</a>
      </td>
    </tr>`;
}

export function construirHtml({ titulo, bajada, registros, nombrePorPersona, etiquetaPorPersona, linkIcs, vacioTxt }) {
  // El mail diario sale todos los días aunque no haya nada: decirlo de forma
  // explícita también es información — confirma que el sistema está vivo y
  // que no es que alguien se olvidó de cargar algo.
  const filas = registros.length
    ? registros.map(r => filaRegistro(r, nombrePorPersona, etiquetaPorPersona)).join('')
    : `<tr><td style="padding:22px 0;font:400 15px Arial,sans-serif;color:#5A6478;text-align:center;">
         ${vacioTxt || 'Nada agendado.'}
       </td></tr>`;

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F7F5F0;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F5F0;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border:1px solid #E5E1D8;border-radius:8px;">
        <tr><td style="background:${NAVY};padding:20px 24px;border-radius:7px 7px 0 0;">
          <div style="font:700 16px Arial,sans-serif;color:${CREAM};letter-spacing:3px;">DELFINO GAVIÑA</div>
          <div style="font:400 12px Arial,sans-serif;color:#8AC7EA;letter-spacing:2px;margin-top:3px;">AGENDA</div>
        </td></tr>
        <tr><td style="padding:24px;">
          <div style="font:700 18px Arial,sans-serif;color:${NAVY};">${titulo}</div>
          <div style="font:400 14px/1.5 Arial,sans-serif;color:#5A6478;margin-top:6px;">${bajada}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">${filas}</table>
          ${linkIcs ? `
          <div style="margin-top:22px;padding-top:18px;border-top:1px solid #E5E1D8;">
            <a href="${linkIcs}" style="display:inline-block;background:${NAVY};color:${CREAM};font:700 13px Arial,sans-serif;padding:11px 18px;border-radius:5px;text-decoration:none;">Agregar todo al calendario</a>
            <div style="font:400 12px/1.5 Arial,sans-serif;color:#8A8578;margin-top:8px;">Descarga un archivo .ics con todo lo de arriba. Google Calendar, iPhone y Outlook lo importan igual.</div>
          </div>` : ''}
        </td></tr>
        <tr><td style="padding:16px 24px;border-top:1px solid #E5E1D8;font:400 11px/1.5 Arial,sans-serif;color:#8A8578;">
          Enviado automáticamente por el dashboard. Para cambiar o dar de baja un registro, entrá a la sección Agenda.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ── Envío ──
//
// SMTP de Google Workspace. GMAIL_USER es la casilla desde la que sale el
// mail y GMAIL_APP_PASSWORD una "contraseña de aplicación" de 16 caracteres
// generada en la cuenta de Google — nunca la contraseña real.
let transporter = null;

// ── Elección de transporte ──
//
// Resend entrega por HTTPS (443); Gmail, por SMTP (465/587). Render bloquea
// TODA salida SMTP — los tres puertos dan ETIMEDOUT desde el contenedor — así
// que en producción el único camino es HTTP. El SMTP se conserva porque sí
// funciona desde una máquina local y sirve para probar sin depender de nada.
//
// Si hay RESEND_API_KEY se usa Resend; si no, SMTP.
export function transporteMail() {
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) return 'smtp';
  return null;
}

export function mailConfigurado() {
  return transporteMail() !== null;
}

// Dirección remitente. En Resend tiene que pertenecer a un dominio verificado.
function remitenteMail() {
  return process.env.MAIL_FROM || process.env.GMAIL_USER || 'agenda@delfinogavina.com.ar';
}

// Casilla a la que llegan las respuestas. Tiene que existir de verdad.
function respuestasMail() {
  return process.env.MAIL_REPLY_TO || process.env.GMAIL_USER || 'info@delfinogavina.com.ar';
}

// ── Envío por Resend (HTTPS) ──
async function enviarPorResend({ para, asunto, html, adjuntoIcs }) {
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `D&G Agenda <${remitenteMail()}>`,
      to: [para],
      // El remitente puede ser una dirección que no existe como casilla
      // (agenda@): para enviar alcanza con que el dominio esté verificado,
      // pero una respuesta rebotaría. El Reply-To apunta a una casilla real.
      reply_to: [respuestasMail()],
      subject: asunto,
      html,
      ...(adjuntoIcs ? {
        attachments: [{
          filename: 'agenda.ics',
          content: Buffer.from(adjuntoIcs, 'utf8').toString('base64'),
        }],
      } : {}),
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(data?.message || data?.error?.message || `Resend HTTP ${r.status}`);
  }
  return data?.id || null;
}

// Prueba la conexión y el login contra Gmail sin mandar ningún mail. Sirve
// para distinguir un problema de red (puerto bloqueado, IPv6 sin ruta) de uno
// de credenciales, que dan errores muy distintos y se confunden fácil.
//
// Sin argumento usa el transporter real. Con `puerto`, arma uno descartable
// para ese puerto: así se puede averiguar cuál deja pasar el hosting.
export async function verificarSmtp(puerto) {
  if (!mailConfigurado()) return { ok: false, motivo: 'sin_credenciales' };
  const t = puerto ? transporterEnPuerto(puerto) : getTransporter();
  const t0 = Date.now();
  try {
    await t.verify();
    return { ok: true, puerto: puerto || 465, ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, puerto: puerto || 465, error: e.message, code: e.code || null, ms: Date.now() - t0 };
  }
}

// Prueba los puertos habituales de salida SMTP en paralelo. 465 es TLS
// directo; 587 y 2525 usan STARTTLS (empiezan en claro y suben a TLS).
// Varios hostings bloquean unos y dejan otros.
export async function probarPuertosSmtp() {
  const puertos = [465, 587, 2525];
  return Promise.all(puertos.map(p => verificarSmtp(p)));
}

// Opciones comunes del transporter. `puerto` 465 = TLS directo; 587 y 2525
// arrancan en claro y suben a TLS con STARTTLS (secure: false + requireTLS).
function opcionesSmtp(puerto = Number(process.env.SMTP_PORT) || 465) {
  return {
    host: 'smtp.gmail.com',
    port: puerto,
    secure: puerto === 465,
    requireTLS: puerto !== 465,
    // IPv4 forzado. El contenedor de Render no tiene ruta IPv6: Node resolvía
    // smtp.gmail.com a una dirección v6 y la conexión moría con ENETUNREACH,
    // o quedaba colgada hasta el timeout. En local no se ve porque la máquina
    // sí tiene IPv6 y conecta por ahí.
    family: 4,
    // Sin estos timeouts, un puerto bloqueado deja el request colgado minutos.
    // Preferimos fallar rápido y que quede en el log.
    connectionTimeout: 15_000,
    greetingTimeout:   10_000,
    socketTimeout:     20_000,
    auth: {
      user: process.env.GMAIL_USER,
      pass: String(process.env.GMAIL_APP_PASSWORD).replace(/\s+/g, ''), // Google las muestra con espacios
    },
  };
}

function transporterEnPuerto(puerto) {
  return nodemailer.createTransport(opcionesSmtp(puerto));
}

function getTransporter() {
  if (transporter) return transporter;
  if (!mailConfigurado()) return null;
  transporter = nodemailer.createTransport(opcionesSmtp());
  return transporter;
}

// Manda UN mail por participante, cada uno dirigido a su propia casilla.
//
// Antes iba un solo mail con To: la casilla de la firma y todos en BCC. Eso
// funciona, pero el mail no le llega dirigido a nadie: aparece como si fuera
// para otro, y los filtros de Gmail miran con más sospecha un mensaje cuyo
// destinatario visible no coincide con quien lo recibe. Un envío por persona
// llega a la casilla personal de cada uno, con su nombre en el To.
//
// Devuelve el detalle por destinatario: un fallo en uno no cancela el resto.
export async function enviarMail({ para, asunto, html, adjuntoIcs }) {
  const transporte = transporteMail();
  if (!transporte) throw new Error('mail no configurado (falta RESEND_API_KEY, o GMAIL_USER + GMAIL_APP_PASSWORD)');
  if (!para?.length) throw new Error('sin destinatarios');

  const remitente = remitenteMail();
  const adjuntosSmtp = adjuntoIcs
    ? [{ filename: 'agenda.ics', content: adjuntoIcs, contentType: 'text/calendar; charset=utf-8' }]
    : [];

  const resultados = [];
  for (const destinatario of para) {
    try {
      let id;
      if (transporte === 'resend') {
        id = await enviarPorResend({ para: destinatario, asunto, html, adjuntoIcs });
      } else {
        const info = await getTransporter().sendMail({
          from: `"D&G Agenda" <${remitente}>`,
          replyTo: respuestasMail(),
          to: destinatario,
          subject: asunto,
          html,
          attachments: adjuntosSmtp,
        });
        id = info.messageId;
      }
      resultados.push({ para: destinatario, ok: true, id, via: transporte });
    } catch (e) {
      console.error(`[agenda] falló el envío a ${destinatario} (${transporte}):`, e.message);
      resultados.push({ para: destinatario, ok: false, error: e.message, via: transporte });
    }
  }
  return resultados;
}
