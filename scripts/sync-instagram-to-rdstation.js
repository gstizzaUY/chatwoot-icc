import dotenv from 'dotenv';
dotenv.config();

import chatwootClient from '../src/clients/chatwoot.client.js';
import rdStationClient from '../src/clients/rdstation.client.js';
import { RD_CONVERSIONS } from '../src/constants/rdstation.constants.js';

const INBOX_ID = 54;
const FAKE_EMAIL_DOMAIN = 'email.com';
const EXECUTE = process.argv.includes('--execute');

const STATS = {
    contactsTotal: 0,
    contactsWithEmail: 0,
    contactsSynced: 0,
    contactsSkipped: 0,
    contactsUpdatedInChatwoot: 0,
    conversionEventsSent: 0,
    errors: 0
};

async function main() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  SINCRONIZACION INSTAGRAM → RD STATION          ║');
    console.log('║  Crea contactos de Instagram en RD Station       ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log(`\nModo: ${EXECUTE ? 'EJECUCION (--execute)' : 'SIMULACION (dry-run)'}`);
    console.log(`Inbox: ${INBOX_ID}`);
    console.log('');

    if (!process.env.API_ACCESS_TOKEN) {
        console.error('❌ API_ACCESS_TOKEN no configurado en .env');
        process.exit(1);
    }

    const instagramContacts = await collectInstagramContacts();
    STATS.contactsTotal = instagramContacts.length;

    console.log(`\n📱 Contactos unicos de Instagram: ${instagramContacts.length}`);
    console.log(`   Con email real: ${STATS.contactsWithEmail}`);
    console.log(`   Sin email (necesitan sincronizacion): ${instagramContacts.filter(c => c.needsSync).length}`);
    console.log('');

    printReport(instagramContacts);

    if (!EXECUTE) {
        console.log('\n💡 Para ejecutar los cambios: node scripts/sync-instagram-to-rdstation.js --execute');
        console.log('   ⚠️  Antes de ejecutar, crea el evento "instagram-message-received" en RD Station');
        return;
    }

    console.log('\n⚠️  MODO EJECUCION - Aplicando cambios...\n');

    await executeChanges(instagramContacts);

    console.log('\n═══════════════════════════════════════════');
    console.log('  RESUMEN');
    console.log('═══════════════════════════════════════════');
    console.log(`  Contactos totales:          ${STATS.contactsTotal}`);
    console.log(`  Con email real (omitidos):  ${STATS.contactsWithEmail}`);
    console.log(`  Creados en RD Station:      ${STATS.contactsSynced}`);
    console.log(`  Ya existian (saltados):     ${STATS.contactsSkipped}`);
    console.log(`  Actualizados en Chatwoot:   ${STATS.contactsUpdatedInChatwoot}`);
    console.log(`  Eventos de conversion:      ${STATS.conversionEventsSent}`);
    console.log(`  Errores:                    ${STATS.errors}`);
    console.log('═══════════════════════════════════════════');
}

async function collectInstagramContacts() {
    try {
        const response = await chatwootClient.client.get('/conversations', {
            params: { inbox_id: INBOX_ID, status: 'all' }
        });
        const conversations = response.data?.data?.payload || [];

        const contactMap = new Map();

        for (const conv of conversations) {
            const contactId = conv.meta?.sender?.id || conv.contact_id;
            if (!contactId || contactMap.has(contactId)) continue;

            try {
                const contact = await chatwootClient.getContactById(contactId);
                if (!contact) continue;

                const hasRealEmail = contact.email
                    && contact.email !== 'null'
                    && contact.email.trim()
                    && !contact.email.includes('@email.com');

                if (hasRealEmail) {
                    STATS.contactsWithEmail++;
                    continue;
                }

                const instagramUsername = contact.additional_attributes?.social_instagram_user_name || '';
                const instagramInbox = (contact.contact_inboxes || []).find(
                    ci => ci.inbox?.id === INBOX_ID || ci.inbox_id === INBOX_ID
                );
                const sourceId = instagramInbox?.source_id || '';

                const fakeEmail = sourceId
                    ? `${sourceId}@${FAKE_EMAIL_DOMAIN}`
                    : instagramUsername
                        ? `${instagramUsername}@${FAKE_EMAIL_DOMAIN}`
                        : null;

                contactMap.set(contactId, {
                    id: contact.id,
                    name: contact.name || 'Usuario Instagram',
                    instagramUsername,
                    sourceId,
                    fakeEmail,
                    needsSync: !!fakeEmail,
                    existingEmail: contact.email
                });

            } catch (error) {
                console.warn(`⚠️ Error obteniendo contacto ${contactId}:`, error.message);
            }
        }

        for (const contact of contactMap.values()) {
            if (!contact.needsSync || !contact.fakeEmail) continue;

            try {
                const existing = await rdStationClient.getContact(contact.fakeEmail);
                contact.existsInRD = !!existing;
            } catch {
                contact.existsInRD = false;
            }
        }

        return Array.from(contactMap.values());

    } catch (error) {
        console.error('❌ Error recolectando contactos:', error.message);
        return [];
    }
}

function printReport(contacts) {
    const toSync = contacts.filter(c => c.needsSync);

    console.log('═══════════════════════════════════════════════════════════');
    console.log('                      REPORTE                               ');
    console.log('═══════════════════════════════════════════════════════════\n');

    contacts.forEach((c, i) => {
        const status = !c.needsSync
            ? '⏭️  (sin datos para email falso)'
            : c.existsInRD
                ? '✅ Ya en RD'
                : '❌ Falta en RD';

        console.log(`${'─'.repeat(55)}`);
        console.log(`👤 #${i + 1} ${c.name}`);
        console.log(`   Instagram:  @${c.instagramUsername || '(no detectado)'}`);
        console.log(`   source_id:  ${c.sourceId || '(no)'}`);
        console.log(`   Email Chatwoot: ${c.existingEmail || '(vacio)'}`);
        console.log(`   Email falso:    ${c.fakeEmail || '(no generado)'}`);
        console.log(`   Estado RD:  ${status}`);
    });

    console.log(`\n${'─'.repeat(55)}`);
    console.log('Para sincronizar:', toSync.filter(c => !c.existsInRD).length);
    console.log('Ya en RD:', toSync.filter(c => c.existsInRD).length);
    console.log('Sin datos suficientes:', contacts.filter(c => !c.needsSync).length);
}

async function executeChanges(contacts) {
    for (const contact of contacts) {
        if (!contact.needsSync || !contact.fakeEmail) {
            continue;
        }

        if (contact.existsInRD) {
            console.log(`⏭️  ${contact.name} - ya existe en RD Station`);
            STATS.contactsSkipped++;

            if (!contact.existingEmail) {
                try {
                    await chatwootClient.updateContact(contact.id, {
                        email: contact.fakeEmail,
                        custom_attributes: {
                            email: contact.fakeEmail,
                            instagram: contact.instagramUsername || undefined
                        }
                    });
                    STATS.contactsUpdatedInChatwoot++;
                    console.log(`   ✅ Chatwoot actualizado con email falso e instagram`);
                } catch (error) {
                    console.warn(`   ⚠️ No se pudo actualizar Chatwoot: ${error.message}`);
                }
            }
            continue;
        }

        console.log(`\n🔄 Procesando: ${contact.name} (@${contact.instagramUsername})`);

        try {
            console.log(`   Creando en RD Station: ${contact.fakeEmail}`);
            await rdStationClient.createContact({
                name: contact.name,
                email: contact.fakeEmail,
                cf_instagram: contact.instagramUsername || undefined,
                mobile_phone: ''
            });
            STATS.contactsSynced++;
            console.log(`   ✅ Creado en RD Station`);
        } catch (error) {
            console.error(`   ❌ Error creando en RD Station: ${error.message}`);
            STATS.errors++;
            continue;
        }

        try {
            console.log(`   Enviando evento de conversion...`);
            await rdStationClient.sendConversionEvent(
                contact.fakeEmail,
                RD_CONVERSIONS.INSTAGRAM_MESSAGE_RECEIVED,
                {
                    fuente: 'instagram',
                    instagram_username: contact.instagramUsername || ''
                }
            );
            STATS.conversionEventsSent++;
            console.log(`   ✅ Evento enviado`);
        } catch (error) {
            console.warn(`   ⚠️ Error enviando evento: ${error.message}`);
        }

        try {
            console.log(`   Actualizando Chatwoot...`);
            await chatwootClient.updateContact(contact.id, {
                email: contact.fakeEmail,
                custom_attributes: {
                    email: contact.fakeEmail,
                    instagram: contact.instagramUsername || undefined
                }
            });
            STATS.contactsUpdatedInChatwoot++;
            console.log(`   ✅ Chatwoot actualizado`);
        } catch (error) {
            console.warn(`   ⚠️ No se pudo actualizar Chatwoot: ${error.message}`);
        }
    }
}

main().catch(error => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
});
