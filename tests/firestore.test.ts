import { readFileSync } from 'node:fs'
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing'
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing'
import { disableNetwork, doc, enableNetwork, getDoc, getDocs, getDocsFromServer, setDoc, updateDoc } from 'firebase/firestore'
import type { Firestore, Query } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MAX_SLOTS } from '../src/domain/models'
import type { Calendar, Course, DoseRecord, Pause, Row, ScheduleVersion } from '../src/domain/models'
import { buildDoses, dosePlan } from '../src/domain/planning'
import { Tracker } from '../src/services/tracker'
import { at, medicine, schedule, slot } from './fixtures'

let env: RulesTestEnvironment
let alice: Tracker
let bob: Tracker

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-medtracker',
    firestore: { rules: readFileSync('firestore.rules', 'utf8') },
  })
})
afterAll(async () => { await env?.cleanup() })
beforeEach(async () => {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async ctx => {
    for (const uid of ['alice', 'bob']) await setDoc(doc(ctx.firestore(), 'access', uid), { enabled: true })
    await setDoc(doc(ctx.firestore(), 'access', 'disabled'), { enabled: false })
  })
  alice = new Tracker(env.authenticatedContext('alice').firestore() as unknown as Firestore, 'alice')
  bob = new Tracker(env.authenticatedContext('bob').firestore() as unknown as Firestore, 'bob')
  await Promise.all([alice.initialize('Alice'), bob.initialize('Bob')])
})

async function readRows<T>(ref: Query) {
  return (await getDocs(ref)).docs.map(snapshot => ({ ...snapshot.data() as T, id: snapshot.id }))
}

async function plan(tracker: Tracker, day: string) {
  const [versions, calendars, pauses, courses, records] = await Promise.all([
    readRows<ScheduleVersion>(tracker.overlapping('scheduleVersions', day, day)),
    readRows<Calendar>(tracker.overlapping('calendars', day, day)),
    readRows<Pause>(tracker.overlapping('pauses', day, day)),
    readRows<Course>(tracker.group('courses')),
    readRows<DoseRecord>(tracker.doseRange(day, day)),
  ])
  return buildDoses(day, day, { versions, calendars, pauses, courses }, records)
}

describe('Firestore Rules and repository', () => {
  it('rejects anonymous, disabled, and unapproved users', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/alice/settings/main')))
    for (const uid of ['disabled', 'unapproved']) {
      const db = env.authenticatedContext(uid).firestore()
      await assertSucceeds(getDoc(doc(db, 'access', uid)))
      await assertFails(getDoc(doc(db, 'users', uid, 'settings', 'main')))
    }
  })

  it('allows own reads but isolates medical data and prevents self-granting access', async () => {
    await assertSucceeds(getDoc(doc(alice.db, 'users/alice/settings/main')))
    await assertFails(getDoc(doc(alice.db, 'access/bob')))
    await assertFails(setDoc(doc(alice.db, 'access/alice'), { enabled: true }))
    await assertFails(getDocs(new Tracker(alice.db, 'bob').group('doses')))
    await assertFails(updateDoc(doc(alice.db, 'users/bob/settings/main'), { reminders: true }))
    const id = await bob.saveMedicine(medicine, schedule, 1000)
    await assertFails(updateDoc(doc(alice.db, 'users/bob/medicines', id), { name: 'Недопустимо' }))
    await assertFails(getDoc(doc(alice.db, 'users/bob/medicines', id)))
  })

  it('rejects malformed records, owner changes, and a direct change to the balance', async () => {
    const id = await alice.saveMedicine(medicine, schedule, 3000)
    const ref = doc(alice.group('medicines'), id)
    await assertFails(updateDoc(ref, { ownerId: 'bob' }))
    await assertFails(updateDoc(ref, { name: '' }))
    await assertFails(updateDoc(ref, { stock: 1 }))
    await assertFails(updateDoc(ref, { stock: 34.12 }))
    const calendar = (await getDocs(alice.group('calendars'))).docs[0]
    await assertFails(updateDoc(calendar.ref, { zone: 'America/New_York' }))
    const version = (await getDocs(alice.group('scheduleVersions'))).docs[0]
    await assertFails(setDoc(doc(alice.group('scheduleVersions')), { ...version.data(), slots: [{ ...slot, quantity: -2 }] }))
    const [dose] = await plan(alice, '2023-11-20')
    await assertFails(setDoc(doc(alice.group('doses'), dose.id), {
      ...dosePlan(dose), status: 'taken', actualAt: null, actualQuantity: 1000,
      revision: 1, recordedAt: at('2023-11-20T09:12Z'),
    }))
  })

  it('validates the full supported slot list and rolls back a rejected medicine', async () => {
    const slots = Array.from({ length: MAX_SLOTS }, (_, index) => ({ ...slot, id: `slot-${index}` }))
    await alice.saveMedicine(medicine, { ...schedule, slots }, 1000)
    const invalid = [...slots.slice(0, -1), { ...slots[MAX_SLOTS - 1], deadline: '29:00' }]
    await assertFails(alice.saveMedicine(medicine, { ...schedule, slots: invalid }, 1000))
    expect((await getDocs(alice.group('medicines'))).size).toBe(1)
    expect((await getDocs(alice.group('stockLedger'))).size).toBe(1)
  })

  it('applies one debit under concurrent confirmation and compensates corrections to an old day', async () => {
    const id = await alice.saveMedicine(medicine, schedule, 3000)
    const ref = doc(alice.group('medicines'), id)
    const day = '2023-11-20'
    const [dose] = await plan(alice, day)
    const at1 = at('2023-11-20T08:35Z')
    const at2 = at('2023-11-20T08:36Z')
    const anotherTab = new Tracker(env.authenticatedContext('alice').firestore() as unknown as Firestore, 'alice')
    await Promise.all([
      alice.saveDose(dose, { status: 'taken', actualAt: at1, actualQuantity: 2000 }, true),
      anotherTab.saveDose(dose, { status: 'taken', actualAt: at2, actualQuantity: 2000 }, true),
    ])
    expect((await getDoc(ref)).data()?.stock).toBe(1000)
    const [taken] = await plan(alice, day)
    expect(taken.record?.revision).toBe(1)
    await assertFails(updateDoc(doc(alice.group('doses'), taken.id), { logicalDate: '2023-11-21' }))
    await alice.saveDose(taken, { status: 'taken', actualAt: null, actualQuantity: 1000 })
    expect((await getDoc(ref)).data()?.stock).toBe(2000)
    let [corrected] = await plan(alice, day)
    expect(corrected.record?.actualAt).toBeNull()
    await alice.saveDose(corrected, { status: 'pending', actualAt: null, actualQuantity: 0 })
    expect((await getDoc(ref)).data()?.stock).toBe(3000)
    ;[corrected] = await plan(alice, day)
    await alice.saveDose(corrected, { status: 'skipped', actualAt: null, actualQuantity: 0 })
    expect((await plan(alice, day))[0].status).toBe('skipped')
    expect((await getDocs(alice.group('stockLedger'))).size).toBe(4)
    expect((await alice.auditHistory('entityId', dose.id)).rows).toHaveLength(4)

    const [first] = await plan(alice, '2023-11-21')
    const [second] = await plan(alice, '2023-11-22')
    const takenChange = { status: 'taken' as const, actualAt: null, actualQuantity: 1000 }
    await Promise.all([alice.saveDose(first, takenChange, true), anotherTab.saveDose(second, takenChange, true)])
    expect((await getDoc(ref)).data()?.stock).toBe(1000)
    expect((await plan(alice, '2023-11-21'))[0].status).toBe('taken')
    expect((await plan(alice, '2023-11-22'))[0].status).toBe('taken')
  })

  it('records inventory and restock, and refuses server-only export without a network', async () => {
    const id = await alice.saveMedicine(medicine, schedule, 3000)
    await alice.updateStock(id, 'restock', 1200)
    await alice.updateStock(id, 'inventory', 2750)
    expect((await getDoc(doc(alice.group('medicines'), id))).data()?.stock).toBe(2750)
    expect((await alice.stockHistory(id)).rows.map(entry => entry.kind)).toEqual(['inventory', 'restock', 'initial'])
    await disableNetwork(alice.db)
    try {
      await expect(getDocsFromServer(alice.group('stockLedger'))).rejects.toMatchObject({ code: 'unavailable' })
      await expect(alice.exportAll()).rejects.toMatchObject({ code: 'unavailable' })
    } finally {
      await enableNetwork(alice.db)
    }
  })

  it('supports schedule versions, calendar changes, pause, restart, and a deletion request', async () => {
    const id = await alice.saveMedicine(medicine, schedule, 0)
    const course = async () => {
      const med = await getDoc(doc(alice.group('medicines'), id))
      const course = await getDoc(doc(alice.group('courses'), med.data()!.currentCourseId))
      return { medicine: { ...med.data(), id: med.id }, course: { ...course.data(), id: course.id } } as {
        medicine: Parameters<Tracker['changeCourse']>[0]; course: Row<Course>
      }
    }
    const original = await course()
    const version = (await readRows<ScheduleVersion>(alice.group('scheduleVersions')))[0]
    await alice.saveMedicine({ ...medicine, name: 'Новое имя' }, schedule, 0, { ...original, version })
    expect((await plan(alice, '2023-11-20'))[0].name).toBe(medicine.name)
    await alice.changeCourse(original.medicine, (await course()).course, 'pause')
    expect((await plan(alice, '2040-11-20'))[0].status).toBe('canceled')
    await alice.changeCourse(original.medicine, (await course()).course, 'resume')
    expect((await plan(alice, '2040-11-20'))[0].status).toBe('pending')
    await alice.changeCourse(original.medicine, (await course()).course, 'end')
    expect(await plan(alice, '2040-11-20')).toEqual([])
    await alice.changeCourse(original.medicine, (await course()).course, 'restart', { first: '2040-11-20', last: '2040-11-20' })
    expect((await plan(alice, '2040-11-20'))[0].courseId).not.toBe(original.course.id)
    const settings = (await getDoc(doc(alice.group('settings'), 'main'))).data()!
    await alice.saveSettings({ zone: 'UTC', boundary: '05:00', reminders: true,
      repeatMinutes: 15, repeats: 5, privateText: true }, settings.calendarId)
    expect((await plan(alice, '2040-11-20'))[0].boundary).toBe('05:00')
    await alice.requestDeletion()
    await assertSucceeds(getDoc(doc(alice.group('deletion'), 'main')))
    await assertFails(getDoc(doc(bob.db, 'users/alice/deletion/main')))
  })
})
