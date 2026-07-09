import dotenv from 'dotenv';
dotenv.config();

import chatwootClient from '../src/clients/chatwoot.client.js';
import rdStationClient from '../src/clients/rdstation.client.js';
import contactExtractionService from '../src/services/contact-extraction.service.js';
import crmSyncService from '../src/services/shared/crm-sync.service.js';
import { normalizePhone } from '../src/utils/phone.utils.js';

const SYSTEM_EMAIL = 'comercial@ichef.uy';
const SYSTEM_NAME = 'iChef';
const INBOX_ARG = process.argv.find(arg => arg.startsWith('--inbox='));
const INBOX_ID = INBOX_ARG ? parseInt(INBOX_ARG.split('=')[1], 10) : 1;
const EXECUTE = process.argv.includes('--execute');
const SKIP_RESTORE = process.argv.includes('--skip-restore');
const CONTACT_ID_ARG = process.argv.find(arg => arg.startsWith('--contact-id='));
const TARGET_CONTACT_ID = CONTACT_ID_ARG ? parseInt(CONTACT_ID_ARG.split('=')[1], 10) : null;
const PERSON_EMAIL_ARG = process.argv.find(arg => arg.startsWith('--person-email='));
const PERSON_EMAIL = PERSON_EMAIL_ARG ? PERSON_EMAIL_ARG.split('=')[1] : null;
const LIMIT_ARG = process.argv.find(arg => arg.startsWith('--limit='));
const PERSON_LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : null;

const SKIP_ARGS = process.argv.filter(arg => arg.startsWith('--skip='));
const SKIP_EMAILS = new Set(SKIP_ARGS.map(arg => arg.split('=')[1].toLowerCase()));

const STATS = {
    conversationsTotal: 0,
    conversationsSkipped: 0,
    personsFound: 0,
    contactsCreated: 0,
    contactsUpdated: 0,
    conversationsCreated: 0,
    conversationsMigrated: 0,
    rdSynced: 0,
    errors: 0
};

async function main() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║  LIMPIEZA CANAL 1 - CORREO MARTY                ║');
    console.log('║  Extrae contactos reales del formulario web      ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log(`\nModo: ${EXECUTE ? 'EJECUCION (--execute)' : 'SIMULACION (dry-run)'}`);
    console.log(`Inbox: ${INBOX_ID}`);
    if (PERSON_EMAIL) console.log(`Filtro persona: ${PERSON_EMAIL}`);
    if (PERSON_LIMIT) console.log(`Limite: ${PERSON_LIMIT} persona(s)`);
    if (SKIP_RESTORE) console.log('Omitiendo restauracion del contacto sistema');
    if (SKIP_EMAILS.size > 0) console.log(`Excluyendo: ${[...SKIP_EMAILS].join(', ')}`);
    console.log('');

    if (!process.env.API_ACCESS_TOKEN) {
        console.error('❌ API_ACCESS_TOKEN no configurado en .env');
        process.exit(1);
    }

    const systemContact = await findSystemContact();
    if (!systemContact) {
        console.error('❌ No se pudo encontrar el contacto del sistema');
        process.exit(1);
    }

    console.log(`\n📋 Contacto sistema encontrado:`);
    console.log(`   ID: ${systemContact.id}`);
    console.log(`   Nombre actual: ${systemContact.name}`);
    console.log(`   Email actual: ${systemContact.email}`);

    const conversations = await getInbox1Conversations(systemContact.id);
    console.log(`\n📨 Conversaciones encontradas en inbox ${INBOX_ID}: ${conversations.length}`);

    if (conversations.length === 0) {
        console.log('✅ Nada que limpiar.');
        return;
    }

    const persons = await extractPersonsFromConversations(conversations);
    STATS.personsFound = persons.length;

    if (PERSON_EMAIL) {
        const filtered = persons.filter(p => p.email.toLowerCase() === PERSON_EMAIL.toLowerCase());
        if (filtered.length === 0) {
            console.log(`❌ No se encontro persona con email: ${PERSON_EMAIL}`);
            process.exit(1);
        }
        console.log(`🎯 Filtrado a 1 persona: ${PERSON_EMAIL}`);
        persons.length = 0;
        persons.push(...filtered);
    }

    if (PERSON_LIMIT && persons.length > PERSON_LIMIT) {
        console.log(`🎯 Limitando a ${PERSON_LIMIT} persona(s) (de ${STATS.personsFound} totales)`);
        persons.length = PERSON_LIMIT;
    }

    if (SKIP_EMAILS.size > 0) {
        const before = persons.length;
        const filteredPersons = persons.filter(p => !SKIP_EMAILS.has(p.email.toLowerCase()));
        const skipped = before - filteredPersons.length;
        if (skipped > 0) console.log(`⏭️  ${skipped} persona(s) excluidas (--skip)`);
        persons.length = 0;
        persons.push(...filteredPersons);
    }

    printReport(persons, systemContact);

    if (!EXECUTE) {
        console.log('\n💡 Para ejecutar los cambios, corre: node scripts/cleanup-channel1-contacts.js --execute');
        if (!CONTACT_ID_ARG) {
            console.log('   Tambien podes especificar el contacto: --contact-id=XXXX');
        }
        return;
    }

    console.log('\n⚠️  MODO EJECUCION - Aplicando cambios...\n');

    await executeChanges(persons, systemContact, { skipRestore: SKIP_RESTORE });

    console.log('\n═══════════════════════════════════════════');
    console.log('  RESUMEN DE CAMBIOS');
    console.log('═══════════════════════════════════════════');
    console.log(`  Personas identificadas:     ${STATS.personsFound}`);
    console.log(`  Contactos creados:          ${STATS.contactsCreated}`);
    console.log(`  Contactos actualizados:     ${STATS.contactsUpdated}`);
    console.log(`  Conversaciones nuevas:      ${STATS.conversationsCreated}`);
    console.log(`  Conversaciones migradas:    ${STATS.conversationsMigrated}`);
    console.log(`  Sincronizados a RD Station: ${STATS.rdSynced}`);
    console.log(`  Errores:                    ${STATS.errors}`);
    console.log(`  Conversaciones procesadas:  ${STATS.conversationsTotal}`);
    console.log('═══════════════════════════════════════════');
}

async function findSystemContact() {
    if (TARGET_CONTACT_ID) {
        console.log(`🔍 Buscando contacto por ID: ${TARGET_CONTACT_ID}`);
        const contact = await chatwootClient.getContactById(TARGET_CONTACT_ID);
        if (contact) return contact;
    }

    console.log(`🔍 Buscando contacto por email: ${SYSTEM_EMAIL}`);
    let contact = await chatwootClient.findContact({ email: SYSTEM_EMAIL });
    if (contact) return contact;

    console.log('🔍 Buscando por nombre "Victoria Varela"...');
    contact = await chatwootClient.findContact({
        email: 'victoriavarela@ichef.uy'
    });

    if (contact) return contact;

    const allByName = await searchContactsByName(SYSTEM_NAME);
    if (allByName.length === 1) return allByName[0];

    if (allByName.length > 1) {
        console.log(`⚠️  Encontrados ${allByName.length} contactos con nombre "${SYSTEM_NAME}":`);
        allByName.forEach(c => console.log(`   ID: ${c.id} | Email: ${c.email}`));
        console.log('   Usa --contact-id=XXXX para especificar cual limpiar');
        return null;
    }

    return null;
}

async function searchContactsByName(name) {
    try {
        const response = await chatwootClient.client.post('/contacts/filter', {
            payload: [{
                attribute_key: 'name',
                filter_operator: 'contains',
                values: [name],
                query_operator: null
            }]
        });
        return (response.data.payload || []).slice(0, 20);
    } catch {
        return [];
    }
}

async function getInbox1Conversations(contactId) {
    const allConversations = await chatwootClient.getConversationsByContact(contactId);
    return (allConversations || []).filter(c =>
        c.inbox_id === INBOX_ID || c.inbox?.id === INBOX_ID
    );
}

async function extractPersonsFromConversations(conversations) {
    const personsMap = new Map();

    for (const conv of conversations) {
        STATS.conversationsTotal++;

        const messages = await chatwootClient.getConversationMessages(conv.id);
        const firstIncoming = messages.find(m =>
            (m.message_type === 0 || m.message_type === '0' || m.incoming === true) &&
            m.content && m.content.trim()
        );

        if (!firstIncoming) {
            STATS.conversationsSkipped++;
            console.log(`⏭️  Conversación ${conv.id} - sin mensaje entrante con contenido`);
            continue;
        }

        const body = cleanEmailBody(firstIncoming.content);
        console.log(`\n📧 Conversación ${conv.id} (${conv.status})`);
        console.log(`   Contenido: ${body.substring(0, 120)}...`);

        const extracted = await contactExtractionService.extract(body);
        console.log(`   Extraido: email=${extracted.email} nombre=${extracted.firstname} ${extracted.lastname} tel=${extracted.phone} via=${extracted.source}`);

        if (!extracted.email) {
            STATS.conversationsSkipped++;
            console.log(`   ⚠️  No se pudo extraer email - conversacion saltada`);
            continue;
        }

        const key = extracted.email.toLowerCase();
        if (!personsMap.has(key)) {
            personsMap.set(key, {
                email: extracted.email,
                firstname: extracted.firstname,
                lastname: extracted.lastname,
                phone: extracted.phone,
                conversations: [],
                existingContactId: null,
                existingInRD: false
            });
        }

        personsMap.get(key).conversations.push({
            id: conv.id,
            status: conv.status,
            body: body,
            extracted
        });
    }

    const persons = Array.from(personsMap.values());

    for (const person of persons) {
        const existing = await chatwootClient.findContact({ email: person.email });
        if (existing) {
            person.existingContactId = existing.id;
            person.existingName = existing.name;
        }

        if (!person.existingContactId && person.phone) {
            const phone = normalizePhone(person.phone);
            if (phone) {
                const existingByPhone = await chatwootClient.findContact({ phone_number: phone });
                if (existingByPhone) {
                    person.existingContactId = existingByPhone.id;
                    person.existingName = existingByPhone.name;
                    person.foundByPhone = true;
                }
            }
        }

        try {
            const rd = await rdStationClient.getContact(person.email);
            person.existingInRD = !!rd;
        } catch {
            person.existingInRD = false;
        }
    }

    return persons;
}

function cleanEmailBody(content) {
    const lines = content.split(/\n/);
    const relevant = lines.filter(line => {
        const trimmed = line.trim().toLowerCase();
        if (!trimmed) return false;
        if (trimmed.startsWith('de:')) return false;
        if (trimmed.startsWith('para:')) return false;
        if (trimmed.startsWith('enviado:')) return false;
        if (trimmed.startsWith('asunto:')) return false;
        if (trimmed.startsWith('fecha:')) return false;
        if (trimmed.startsWith('from:')) return false;
        if (trimmed.startsWith('to:')) return false;
        if (trimmed.startsWith('sent:')) return false;
        if (trimmed.startsWith('subject:')) return false;
        if (trimmed.startsWith('date:')) return false;
        if (trimmed.startsWith('cc:')) return false;
        if (trimmed.startsWith('>')) return false;
        if (trimmed.startsWith('--')) return false;
        if (trimmed === 'este mensaje fue enviado desde el formulario de contacto') return false;
        return true;
    });
    return relevant.join('\n').trim();
}

function printReport(persons, systemContact) {
    console.log('\n\n═══════════════════════════════════════════════════════════');
    console.log('                      REPORTE                               ');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log(`📋 Contacto sistema (a restaurar):`);
    console.log(`   Actual: "${systemContact.name}" <${systemContact.email}>`);
    console.log(`   Restaurar a: "${SYSTEM_NAME}" <${SYSTEM_EMAIL}>`);

    console.log(`\n👥 Personas reales identificadas: ${persons.length}\n`);

    persons.forEach((p, i) => {
        const openCount = p.conversations.filter(c => c.status === 'open' || c.status === 'pending').length;
        const name = [p.firstname, p.lastname].filter(Boolean).join(' ') || '(sin nombre)';
        const existingLabel = p.existingContactId
            ? `SI (ID:${p.existingContactId}${p.foundByPhone ? ', por telefono' : ''})`
            : 'NO';
        const rd = p.existingInRD ? 'SI' : 'NO';

        console.log(`${'─'.repeat(55)}`);
        console.log(`👤 #${i + 1} ${name}`);
        console.log(`   Email:     ${p.email}`);
        console.log(`   Telefono:  ${p.phone || '(no detectado)'}`);
        console.log(`   Conversaciones: ${p.conversations.length} (${openCount} abiertas)`);
        console.log(`   Existe en Chatwoot:  ${existingLabel}`);
        console.log(`   Existe en RD Station: ${rd}`);
        p.conversations.forEach(c => {
            console.log(`     ↳ Conv #${c.id} [${c.status}]`);
        });
    });

    console.log(`\n${'─'.repeat(55)}`);
    console.log('Total conversaciones procesadas:', STATS.conversationsTotal);
    console.log('Conversaciones sin email detectable:', STATS.conversationsSkipped);
}

async function executeChanges(persons, systemContact, options = {}) {
    for (const person of persons) {
        console.log(`\n🔄 Procesando: ${person.email}`);

        let contactId = person.existingContactId;
        const name = [person.firstname, person.lastname].filter(Boolean).join(' ') || 'Contacto formulario';

        if (!contactId) {
            try {
                const phone = normalizePhone(person.phone);
                console.log(`   Creando contacto en Chatwoot: ${name}`);
                const newContact = await chatwootClient.createContact({
                    name,
                    email: person.email,
                    phone_number: phone || undefined,
                    inbox_id: INBOX_ID
                });
                contactId = newContact.payload?.contact?.id || newContact.id;
                STATS.contactsCreated++;
                console.log(`   ✅ Contacto creado ID: ${contactId}`);
            } catch (error) {
                console.error(`   ❌ Error creando contacto: ${error.message}`);
                STATS.errors++;
                continue;
            }
        } else {
            const foundMsg = person.foundByPhone ? ` (encontrado por telefono)` : '';
            console.log(`   Contacto ya existe ID: ${contactId} (${person.existingName || ''})${foundMsg}`);
            try {
                const phone = normalizePhone(person.phone);
                if (phone) {
                    await chatwootClient.updateContact(contactId, {
                        name,
                        phone_number: phone
                    });
                    STATS.contactsUpdated++;
                }
            } catch (error) {
                console.warn(`   ⚠️  No se pudo actualizar: ${error.message}`);
            }
        }

        const originalConvs = person.conversations.map(c => ({
            id: c.id, status: c.status, body: c.body
        }));

        try {
            console.log(`   📝 Creando conversacion migrada para ${name}...`);

            const newConv = await chatwootClient.createConversation({
                inbox_id: INBOX_ID,
                contact_id: contactId,
                status: 'open'
            });

            const newConvId = newConv.id || newConv.payload?.conversation?.id;
            if (!newConvId) {
                throw new Error('No se pudo obtener ID de la nueva conversacion');
            }

            console.log(`   ✅ Nueva conversacion: #${newConvId}`);

            const convsInfo = originalConvs
                .map(c => `#${c.id} [${c.status}]`)
                .join(', ');

            const allBodies = originalConvs
                .map((c, i) => {
                    const label = originalConvs.length > 1 ? `Mensaje ${i + 1} (conv #${c.id}):` : 'Mensaje original:';
                    return `\n${label}\n${'─'.repeat(40)}\n${c.body || '(sin contenido)'}`;
                })
                .join('\n');

            const note = [
                '🔄 MIGRACION DESDE FORMULARIO WEB',
                '',
                '⚠️ Este mensaje fue migrado automaticamente desde una conversacion agrupada bajo el contacto del sistema. El usuario envio sus datos mediante el formulario de contacto de la pagina web. Se debe contactar nuevamente al usuario.',
                '',
                `Datos extraidos:`,
                `  Nombre: ${name || '(no detectado)'}`,
                `  Email: ${person.email}`,
                `  Telefono: ${person.phone || '(no detectado)'}`,
                `  Contacto creado/actualizado en Chatwoot ID: ${contactId}`,
                `  Conversaciones originales: ${convsInfo}`,
                '',
                '📋 CONTENIDO DEL FORMULARIO:',
                allBodies,
                '',
                '───',
                'Accion requerida: Contactar al usuario para dar seguimiento.',
            ].join('\n');

            await chatwootClient.sendMessage(newConvId, {
                content: `[Agente IA] ${note}`,
                message_type: 'outgoing',
                private: true
            });

            STATS.conversationsCreated++;

        } catch (error) {
            console.error(`   ❌ Error creando conversacion migrada: ${error.message}`);
            STATS.errors++;
        }

        for (const conv of originalConvs) {
            try {
                const migrationNote = [
                    '🔄 MIGRACION DE DATOS',
                    '',
                    `El contacto real de esta conversacion fue identificado como: ${name}`,
                    `Email: ${person.email}`,
                    `Telefono: ${person.phone || 'no detectado'}`,
                    '',
                    `Se creo un nuevo contacto en Chatwoot (ID: ${contactId}) con los datos correctos.`,
                    `Se creo una nueva conversacion bajo ese contacto para que un agente humano tome accion.`,
                    '',
                    'Motivo: error en la captura de datos del formulario web. El remitente del correo era siempre el mismo (sistema), lo que agrupaba contactos distintos bajo un mismo perfil.'
                ].join('\n');

                await chatwootClient.sendMessage(conv.id, {
                    content: `[Agente IA] ${migrationNote}`,
                    message_type: 'outgoing',
                    private: true
                });

                console.log(`   📝 Nota agregada en conv original #${conv.id}`);

                await chatwootClient.setLabels(conv.id, ['migrado']);

                if (conv.status !== 'resolved') {
                    await chatwootClient.changeConversationStatus(conv.id, 'resolved');
                }
                STATS.conversationsMigrated++;
                console.log(`   ✅ Conv #${conv.id} etiquetada y resuelta`);

            } catch (error) {
                console.error(`   ❌ Error procesando conv #${conv.id}: ${error.message}`);
                STATS.errors++;
            }
        }

        try {
            console.log(`   🔄 Sincronizando con RD Station...`);
            const contactForRD = {
                id: contactId,
                name,
                email: person.email,
                phone_number: person.phone || '',
                custom_attributes: {}
            };

            await crmSyncService.syncRDStation(contactForRD, {
                email: person.email,
                firstname: person.firstname,
                lastname: person.lastname,
                mobile_phone: person.phone
            });
            STATS.rdSynced++;
            console.log(`   ✅ RD Station sincronizado`);
        } catch (error) {
            console.error(`   ❌ Error RD Station: ${error.message}`);
            STATS.errors++;
        }
    }

    if (options.skipRestore) {
        console.log('\n⏭️  Omitiendo restauracion del contacto sistema (--skip-restore)');
    } else {
        console.log('\n🔄 Restaurando contacto del sistema...');
        try {
            await chatwootClient.updateContact(systemContact.id, {
                name: SYSTEM_NAME,
                email: SYSTEM_EMAIL,
                custom_attributes: {
                    ...systemContact.custom_attributes,
                    firstname: null,
                    lastname: null,
                    mobile_phone: null,
                    city: null,
                    email: SYSTEM_EMAIL
                }
            });
            console.log(`✅ Contacto sistema restaurado: "${SYSTEM_NAME}" <${SYSTEM_EMAIL}>`);
        } catch (error) {
            console.error(`❌ Error restaurando contacto sistema: ${error.message}`);
            STATS.errors++;
        }

        try {
            const rdSystem = await rdStationClient.getContact(SYSTEM_EMAIL);
            if (rdSystem) {
                await rdStationClient.updateContact(SYSTEM_EMAIL, {
                    name: SYSTEM_NAME,
                    mobile_phone: '',
                    cf_tiene_ichef: 'No'
                });
                console.log('✅ Contacto sistema limpiado en RD Station');
            }
        } catch (error) {
            console.warn(`⚠️  No se pudo limpiar RD Station: ${error.message}`);
        }
    }
}

main().catch(error => {
    console.error('❌ Error fatal:', error);
    process.exit(1);
});
