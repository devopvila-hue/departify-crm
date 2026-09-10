/**
 * DEV seed — creates one DEMO organization with realistic CRM data so a
 * developer can boot the API and immediately see something on every screen.
 *
 * Hard rules:
 *  - All data is fictional. No real names, no real companies, no real
 *    emails. Any resemblance to real persons is coincidental.
 *  - No provider credentials are created and no sequence is actually
 *    scheduled. The seed is safe to run against an empty Postgres.
 *  - Idempotent: re-running deletes the previous DEMO org first.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, sql } from 'drizzle-orm';
import argon2 from 'argon2';
import * as s from './schema/index.js';
import { generateId, Prefixes } from '@departify-crm/shared';

const url = process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/departify_crm';
const client = postgres(url, { max: 4 });
const db = drizzle(client);

const DEMO_ORG_NAME = 'DEPARTIFY (Demo)';
const DEMO_USER_EMAIL = 'demo@departify.app';
const DEMO_PASSWORD = 'departify-demo-2026';

function hashPassword(p: string) {
  return argon2.hash(p, { type: argon2.argon2id });
}

async function reset() {
  // The org delete cascades to every tenant-scoped row; the demo user
  // must be removed explicitly (its email is unique and would block a
  // re-seed) after the org rows are gone.
  await db.execute(sql`DELETE FROM organizations WHERE name = ${DEMO_ORG_NAME}`);
  await db.execute(sql`DELETE FROM users WHERE email = ${DEMO_USER_EMAIL}`);
}

async function main() {
  console.log('Seeding…');
  await reset();

  // --- Org + owner user -----------------------------------------------
  const orgId = generateId(Prefixes.organization);
  await db.insert(s.organizations).values({
    id: orgId,
    name: DEMO_ORG_NAME,
    slug: 'departify-demo',
    externalId: 'departify-demo',
  });

  const userId = generateId(Prefixes.user);
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await db.insert(s.users).values({
    id: userId,
    email: DEMO_USER_EMAIL,
    passwordHash,
    displayName: 'Demo Owner',
  });

  await db.insert(s.memberships).values({
    id: generateId(Prefixes.membership),
    organizationId: orgId,
    userId,
    role: 'owner',
    status: 'active',
  });

  // --- Pipeline + stages ----------------------------------------------
  const pipelineId = generateId(Prefixes.pipeline);
  await db.insert(s.pipelines).values({
    id: pipelineId,
    organizationId: orgId,
    name: 'Ventas',
    purpose: 'sales',
    position: 0,
  });

  const stageNames = [
    { name: 'Nuevo', prob: 5, color: '#9CA3AF', won: 0, lost: 0 },
    { name: 'Contactado', prob: 15, color: '#3B82F6', won: 0, lost: 0 },
    { name: 'Interesado', prob: 35, color: '#8B5CF6', won: 0, lost: 0 },
    { name: 'Propuesta', prob: 60, color: '#F59E0B', won: 0, lost: 0 },
    { name: 'Negociación', prob: 80, color: '#EF4444', won: 0, lost: 0 },
    { name: 'Ganado', prob: 100, color: '#10B981', won: 1, lost: 0 },
    { name: 'Perdido', prob: 0, color: '#6B7280', won: 0, lost: 1 },
  ];
  const stageIds: string[] = [];
  for (let i = 0; i < stageNames.length; i++) {
    const st = stageNames[i]!;
    const id = generateId(Prefixes.stage);
    stageIds.push(id);
    await db.insert(s.stages).values({
      id,
      organizationId: orgId,
      pipelineId,
      name: st.name,
      position: i,
      defaultProbability: st.prob,
      color: st.color,
      isWon: st.won,
      isLost: st.lost,
    });
  }

  // --- Companies -------------------------------------------------------
  const companies = [
    {
      name: 'Bodegas La Ribera',
      domain: 'bodegaslaribera.test',
      country: 'ES',
      city: 'Logroño',
      industry: 'Alimentación',
    },
    {
      name: 'Estudio Norte',
      domain: 'estudionorte.test',
      country: 'ES',
      city: 'Bilbao',
      industry: 'Diseño',
    },
    {
      name: 'Clínica Buenavista',
      domain: 'clinicabuenavista.test',
      country: 'ES',
      city: 'Madrid',
      industry: 'Salud',
    },
    {
      name: 'Cárnicas del Sur',
      domain: 'carnicasdelsur.test',
      country: 'ES',
      city: 'Sevilla',
      industry: 'Alimentación',
    },
    {
      name: 'Logística Litoral',
      domain: 'logisticalitoral.test',
      country: 'ES',
      city: 'Valencia',
      industry: 'Logística',
    },
    {
      name: 'Editorial Verbena',
      domain: 'editorialverbena.test',
      country: 'ES',
      city: 'Barcelona',
      industry: 'Editorial',
    },
    {
      name: 'Talleres Pueblo',
      domain: 'tallerespueblo.test',
      country: 'ES',
      city: 'Zaragoza',
      industry: 'Industrial',
    },
    {
      name: 'Hotel Mirador',
      domain: 'hotelmirador.test',
      country: 'ES',
      city: 'Granada',
      industry: 'Hostelería',
    },
  ];
  const companyIds: string[] = [];
  for (const c of companies) {
    const id = generateId(Prefixes.company);
    companyIds.push(id);
    await db.insert(s.companies).values({
      id,
      organizationId: orgId,
      name: c.name,
      domain: c.domain,
      country: c.country,
      city: c.city,
      industry: c.industry,
      status: 'active',
      size: '11-50',
      ownerId: userId,
    });
  }

  // --- Contacts --------------------------------------------------------
  // Shared "today" anchor: creation/activity dates are staggered across
  // the past weeks so lists, pipeline and feed read like a real operation.
  const today = new Date();
  const isoDays = (d: number) => {
    const dt = new Date(today);
    dt.setDate(dt.getDate() + d);
    return dt;
  };
  const firstNames = [
    'Lucía',
    'Mateo',
    'Sofía',
    'Hugo',
    'Valeria',
    'Martín',
    'Camila',
    'Lucas',
    'Martina',
    'Leo',
    'Emma',
    'Daniel',
    'Alba',
    'Diego',
    'Noa',
    'Pablo',
  ];
  const lastNames = ['Vidal', 'Reyes', 'Castro', 'Domínguez', 'Pardo', 'Sanz', 'Iglesias', 'Mora'];
  const lifecycles: Array<'lead' | 'prospect' | 'customer' | 'partner'> = [
    'lead',
    'prospect',
    'customer',
    'partner',
  ];
  const contactIds: string[] = [];
  for (let i = 0; i < 28; i++) {
    const id = generateId(Prefixes.contact);
    contactIds.push(id);
    const fn = firstNames[i % firstNames.length]!;
    const ln = lastNames[(i * 3) % lastNames.length]!;
    const company = companyIds[i % companyIds.length] ?? null;
    // Stagger creation and last activity so the list reads like a real
    // book of contacts (not 28 rows stamped with the same minute).
    const createdAt = isoDays(-((i % 21) + 1));
    const lastActivityAt = isoDays(-(i % 9));
    await db.insert(s.contacts).values({
      id,
      organizationId: orgId,
      firstName: fn,
      lastName: ln,
      fullName: `${fn} ${ln}`,
      email: `contact-${i.toString().padStart(2, '0')}@example.test`,
      phone: `+34 6${(10_000_000 + i).toString().slice(0, 8)}`,
      jobTitle: [
        'Director General',
        'Responsable de operaciones',
        'Dirección financiera',
        'Dirección de marketing',
        'Responsable de sistemas',
      ][(i * 2) % 5]!,
      companyId: company!,
      lifecycle: lifecycles[i % lifecycles.length]!,
      source: ['web', 'referral', 'event', 'cold-outreach'][i % 4]!,
      ownerId: userId,
      createdAt,
      updatedAt: createdAt,
      lastActivityAt,
    });
  }

  // --- Tags ------------------------------------------------------------
  const tagDefs = [
    { name: 'prospect', color: '#84CC16' },
    { name: 'prioridad-alta', color: '#EF4444' },
    { name: 'q1-2026', color: '#0EA5E9' },
    { name: 'enterprise', color: '#8B5CF6' },
  ];
  for (const t of tagDefs) {
    const tagId = generateId(Prefixes.tag);
    await db.insert(s.tags).values({ id: tagId, organizationId: orgId, ...t });
  }
  const tagRows = await db.select().from(s.tags).where(eq(s.tags.organizationId, orgId));
  for (let i = 0; i < contactIds.length; i++) {
    const tag = tagRows[i % tagRows.length]!;
    const contactId = contactIds[i]!;
    await db.insert(s.contactTags).values({
      organizationId: orgId,
      tagId: tag.id,
      contactId,
    });
  }

  // --- Deals -----------------------------------------------------------
  const dealNames = [
    'Renovación contrato anual',
    'Plan onboarding premium',
    'Migración plataforma',
    'Integración con ERP',
    'Plan marketing Q1',
    'Auditoría de operaciones',
    'Lanzamiento producto',
    'Formación equipo comercial',
    'Ampliación de licencias',
    'Consultoría de procesos',
    'Soporte premium anual',
    'Piloto departamento ventas',
  ];
  const dealIds: string[] = [];
  const dealCreatedAt: Date[] = [];
  for (let i = 0; i < 12; i++) {
    const stageIdx = Math.min(stageIds.length - 1, i % (stageIds.length - 1));
    const stageId = stageIds[stageIdx]!;
    const stageMeta = stageNames[stageIdx]!;
    const companyId = companyIds[i % companyIds.length]!;
    const id = generateId(Prefixes.deal);
    dealIds.push(id);
    // Stagger creation across the past two weeks so the pipeline and the
    // activity feed read like a real commercial operation, not a seed run.
    const created = isoDays(-((i % 12) + 1));
    dealCreatedAt.push(created);
    await db.insert(s.deals).values({
      id,
      organizationId: orgId,
      pipelineId,
      stageId,
      name: dealNames[i % dealNames.length]!,
      companyId,
      ownerId: userId,
      valueMinor: (15_000 + i * 4_300) * 100,
      currency: 'EUR',
      probability: stageMeta.prob,
      status: stageMeta.won ? 'won' : stageMeta.lost ? 'lost' : 'open',
      createdAt: created,
      updatedAt: created,
    });
  }

  // --- Tasks -----------------------------------------------------------
  const taskDefs = [
    { title: 'Llamar a Bodegas La Ribera', offset: 0, contact: 0 },
    { title: 'Revisar propuesta Estudio Norte', offset: 1, contact: 1 },
    { title: 'Enviar follow-up Clínica Buenavista', offset: -1, contact: 2 },
    { title: 'Preparar demo para Logística Litoral', offset: 3, contact: 4 },
    { title: 'Confirmar agendado Hotel Mirador', offset: 2, contact: 7 },
  ];
  for (let i = 0; i < taskDefs.length; i++) {
    const t = taskDefs[i]!;
    await db.insert(s.tasks).values({
      id: generateId(Prefixes.task),
      organizationId: orgId,
      title: t.title,
      dueAt: isoDays(t.offset),
      ownerId: userId,
      subjectType: 'contact',
      subjectId: contactIds[t.contact % contactIds.length]!,
      status: 'open',
      priority: i === 0 ? 'urgent' : 'normal',
    });
  }

  // --- Custom field definition ----------------------------------------
  await db.insert(s.customFieldDefinitions).values({
    id: generateId(Prefixes.customFieldDef),
    organizationId: orgId,
    entity: 'contact',
    key: 'nivel_engagement',
    label: 'Nivel de engagement',
    type: 'select',
    options: ['Bajo', 'Medio', 'Alto'],
    position: 0,
  });

  // --- Activity log ----------------------------------------------------
  // A layered, chronological history so the Activity tab demonstrates the
  // commercial memory: deals created, stage moves, emails, notes and a
  // meeting — all on real records of this demo org.
  const activityRows: Array<{
    type:
      | 'note'
      | 'email'
      | 'call'
      | 'meeting'
      | 'task'
      | 'status_change'
      | 'deal_change'
      | 'sequence_event'
      | 'system_event';
    subjectType: 'contact' | 'company' | 'deal' | 'organization';
    subjectId: string;
    title: string;
    body?: string;
    createdAt: Date;
  }> = [];

  activityRows.push({
    type: 'system_event',
    subjectType: 'organization',
    subjectId: orgId,
    title: 'Organización DEMO creada',
    body: 'Seed inicial con pipeline, contactos, empresas, tareas y tags.',
    createdAt: isoDays(-15),
  });

  // Deal creation + later stage move for the first few deals.
  for (let i = 0; i < dealIds.length; i++) {
    const deal = dealNames[i % dealNames.length]!;
    activityRows.push({
      type: 'deal_change',
      subjectType: 'deal',
      subjectId: dealIds[i]!,
      title: `Oportunidad creada: ${deal}`,
      createdAt: dealCreatedAt[i]!,
    });
    // A few deals moved stage a couple of days later.
    if (i % 4 === 0 && i < 10) {
      const next = new Date(dealCreatedAt[i]!.getTime() + 2 * 86400_000);
      if (next.getTime() < Date.now()) {
        activityRows.push({
          type: 'status_change',
          subjectType: 'deal',
          subjectId: dealIds[i]!,
          title: `${deal} avanzó a Interesado`,
          createdAt: next,
        });
      }
    }
  }

  // Emails to the first contacts (sequence events, no real sends).
  for (let i = 0; i < 5; i++) {
    const c = contactIds[i * 3]!;
    activityRows.push({
      type: 'email',
      subjectType: 'contact',
      subjectId: c,
      title: 'Email de seguimiento enviado',
      body: 'Secuencia demo: primer mensaje de presentación.',
      createdAt: isoDays(-(4 + i)),
    });
  }

  // Notes on two companies and one contact.
  activityRows.push({
    type: 'note',
    subjectType: 'company',
    subjectId: companyIds[0]!,
    title: 'Nota añadida',
    body: 'Hablamos de renovar el contrato anual en el Q1.',
    createdAt: isoDays(-2),
  });
  activityRows.push({
    type: 'note',
    subjectType: 'company',
    subjectId: companyIds[2]!,
    title: 'Nota añadida',
    body: 'Piden presupuesto de onboarding para 20 empleados.',
    createdAt: isoDays(-1),
  });
  activityRows.push({
    type: 'meeting',
    subjectType: 'contact',
    subjectId: contactIds[4]!,
    title: 'Demo agendada',
    body: 'Videollamada de preparación con Logística Litoral.',
    createdAt: isoDays(-1),
  });

  for (const r of activityRows) {
    await db.insert(s.activities).values({
      id: generateId(Prefixes.activity),
      organizationId: orgId,
      type: r.type,
      subjectType: r.subjectType,
      subjectId: r.subjectId,
      actorId: userId,
      title: r.title,
      body: r.body ?? null,
      createdAt: r.createdAt,
    });
  }

  // --- One email sender in fake/provider-safe mode (no creds, no sends) -
  await db.insert(s.emailSenders).values({
    id: generateId('sndr'),
    organizationId: orgId,
    provider: 'fake',
    name: 'DEPARTIFY Demo Sender',
    email: 'demo@departify.app',
    replyTo: 'demo@departify.app',
    credentialsEncrypted: JSON.stringify({ note: 'seed-only-no-credentials' }),
    status: 'paused',
    dailyLimit: 100,
  });

  console.log('Seed done.');
  console.log('Login:');
  console.log(`  email:    ${DEMO_USER_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  await client.end();
}

main().catch(async (err) => {
  console.error(err);
  await client.end();
  process.exit(1);
});
